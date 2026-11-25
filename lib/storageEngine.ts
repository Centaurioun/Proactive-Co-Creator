/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { createSampleProject } from './canonicalModel.ts';
import { createUndoRedoState, type UndoRedoState } from './historyEngine.ts';
import type { CreativeProject } from '../shared/types.ts';
import {
  CURRENT_SCHEMA_VERSION,
  LOCAL_STORAGE_ACTIVE_ID_KEY,
  LOCAL_STORAGE_BACKUP_V2_KEY,
  LOCAL_STORAGE_DELETED_IDS_KEY,
  LOCAL_STORAGE_PROJECTS_KEY,
  NARRATIVE_SCHEMA_VERSION,
  type DurableWriteOptions,
  type IndexedDbLoadResult,
  type IndexedDbLoadStatus,
  type StorageSaveResult,
} from './storage/constants.ts';
import {
  exportProjectToJson,
  exportStoryBibleMarkdown,
  migrateProjectPayload,
} from './storage/migration.ts';
import { evaluateCasConflict, matchesObservedProject, mergeIntentIds } from './storage/casPolicy.ts';
import { planCacheCompaction, verifyProjectCacheParity } from './storage/cacheParity.ts';
import {
  browserStorage, readProjectCache, setCachedProjectSelection, writeProjectCache,
} from './storage/localProjectCache.ts';
import { deleteIdbProject, getIndexedDb, readIdbProjects, writeIdbProject } from './storage/indexedDbOperations.ts';
import {
  reconcileHydratedProjectsCore,
  planStorageReload,
  upsertReloadedProject,
} from './storage/hydrationReconciliation.ts';

export {
  CURRENT_SCHEMA_VERSION,
  LOCAL_STORAGE_ACTIVE_ID_KEY,
  LOCAL_STORAGE_BACKUP_V2_KEY,
  LOCAL_STORAGE_DELETED_IDS_KEY,
  LOCAL_STORAGE_PROJECTS_KEY,
  NARRATIVE_SCHEMA_VERSION,
  exportProjectToJson,
  exportStoryBibleMarkdown,
  migrateProjectPayload,
  verifyProjectCacheParity,
  setCachedProjectSelection,
  type DurableWriteOptions,
  type IndexedDbLoadResult,
  type IndexedDbLoadStatus,
  type StorageSaveResult,
};

// Single mutable tombstone/deletion authority for the browser runtime.
const deletedProjectIdsMemorySet = new Set<string>();

export function getDeletedProjectIds(): Set<string> {
  const combined = new Set<string>(deletedProjectIdsMemorySet);
  if (typeof window === 'undefined') return combined;

  const readFromStorage = (storage: Storage | undefined) => {
    if (!storage) return;
    try {
      const raw = storage.getItem(LOCAL_STORAGE_DELETED_IDS_KEY);
      if (!raw) return;
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) {
        for (const id of parsed) {
          if (typeof id === 'string') {
            combined.add(id);
            deletedProjectIdsMemorySet.add(id);
          }
        }
      }
    } catch {
      // Ignore storage read error
    }
  };

  readFromStorage(browserStorage('localStorage'));
  readFromStorage(browserStorage('sessionStorage'));
  return combined;
}

export function recordDeletedProjectId(projectId: string): boolean {
  deletedProjectIdsMemorySet.add(projectId);
  if (typeof window === 'undefined') return false;

  const set = getDeletedProjectIds();
  set.add(projectId);
  const serialized = JSON.stringify(Array.from(set).slice(-200));

  try {
    browserStorage('sessionStorage')?.setItem(LOCAL_STORAGE_DELETED_IDS_KEY, serialized);
  } catch {
    // Ignore sessionStorage error
  }

  const local = browserStorage('localStorage');
  if (!local) return false;

  try {
    local.setItem(LOCAL_STORAGE_DELETED_IDS_KEY, serialized);
    return true;
  } catch {
    // Non-destructive under quota pressure: never delete backups or strip/evict
    // surviving projects here when IndexedDB availability and parity are unverified.
    // In-memory and sessionStorage tombstones remain active.
    return false;
  }
}

export function clearDeletedProjectId(projectId: string): void {
  deletedProjectIdsMemorySet.delete(projectId);
  if (typeof window === 'undefined') return;
  for (const storage of [browserStorage('localStorage'), browserStorage('sessionStorage')]) {
    if (!storage) continue;
    try {
      const raw = storage.getItem(LOCAL_STORAGE_DELETED_IDS_KEY);
      const parsed = raw ? (JSON.parse(raw) as unknown) : [];
      const list = Array.isArray(parsed)
        ? parsed.filter((id): id is string => typeof id === 'string' && id !== projectId)
        : [];
      storage.setItem(LOCAL_STORAGE_DELETED_IDS_KEY, JSON.stringify(list));
    } catch {
      // Ignore storage error
    }
  }
}

export function simulateBrowserProcessRestartForTesting(): void {
  deletedProjectIdsMemorySet.clear();
  try {
    browserStorage('sessionStorage')?.removeItem(LOCAL_STORAGE_DELETED_IDS_KEY);
  } catch {
    // Ignore sessionStorage error
  }
}

function normalizeWriteOptions(
  expectedBaseRevisionOrOptions?: number | DurableWriteOptions,
  options?: { forceOverwrite?: boolean; allowDeleted?: boolean }
) {
  const opts =
    typeof expectedBaseRevisionOrOptions === 'object' && expectedBaseRevisionOrOptions !== null
      ? expectedBaseRevisionOrOptions
      : undefined;
  return {
    opts,
    normalizedForce: opts ? Boolean(opts.forceOverwrite) : Boolean(options?.forceOverwrite),
    allowDeleted: opts ? Boolean(opts.allowDeleted) : Boolean(options?.allowDeleted),
    requireExactBase: opts?.requireExactBase,
    rawExpected:
      typeof expectedBaseRevisionOrOptions === 'number'
        ? expectedBaseRevisionOrOptions
        : opts?.expectedPersistedRevision,
  };
}

export function saveProjectToLocalStorage(
  project: CreativeProject,
  expectedBaseRevisionOrOptions?: number | DurableWriteOptions,
  options?: { forceOverwrite?: boolean; allowDeleted?: boolean }
): StorageSaveResult {
  const local = browserStorage('localStorage');
  if (!local) return { ok: false, saved: false, error: 'Browser localStorage is unavailable.' };

  const { opts, normalizedForce, allowDeleted, requireExactBase, rawExpected } =
    normalizeWriteOptions(expectedBaseRevisionOrOptions, options);

  if (allowDeleted) {
    clearDeletedProjectId(project.id);
  } else if (getDeletedProjectIds().has(project.id)) {
    return {
      ok: false,
      saved: false,
      error: `Project "${project.id}" was deleted and cannot be resurrected by an in-flight save.`,
    };
  }

  try {
    const map = readProjectCache(local);
    const existing = map[project.id];

    const casConflict = evaluateCasConflict({
      ...opts,
      existing,
      candidate: project,
      rawExpected,
      expectedManuscriptVersionId: opts?.expectedManuscriptVersionId,
      expectedBaseSnapshotDigest: opts?.expectedBaseSnapshotDigest,
      expectedBaseProject: opts?.expectedBaseProject,
      intentId: opts?.intentId,
      requireExactBase,
      forceOverwrite: normalizedForce,
      storeLabel: 'localStorage',
    });
    if (casConflict) {
      return casConflict;
    }

    const nextRevision = project.revision ?? 1;
    const mergedIntents = mergeIntentIds(existing, project, opts?.intentId, rawExpected);
    const projectToStore: CreativeProject = {
      ...project,
      revision: nextRevision,
      persistedRevision: nextRevision,
      ...(mergedIntents ? { recentIntentIds: mergedIntents } : {}),
    };

    map[project.id] = projectToStore;
    try {
      writeProjectCache(local, map);
    } catch (quotaErr) {
      const isQuota =
        (quotaErr instanceof Error &&
          (quotaErr.name === 'QuotaExceededError' || /quota/i.test(quotaErr.message))) ||
        false;
      // Never silently delete or strip user media on quota errors (AC15, F12).
      return {
        ok: false,
        saved: false,
        quotaExceeded: isQuota,
        persistedRevision: project.persistedRevision,
        error:
          quotaErr instanceof Error && quotaErr.message
            ? isQuota
              ? `Browser localStorage quota exceeded (${quotaErr.message}). Full project media remains intact in memory and IndexedDB. Export JSON or remove older image outputs to free space.`
              : quotaErr.message
            : 'Browser localStorage write failed.',
      };
    }

    const cacheWarning = opts?.selectProject !== false ? setCachedProjectSelection(project.id) : undefined;
    return { ok: true, saved: true, persistedRevision: nextRevision, ...(cacheWarning ? { cacheWarning } : {}) };
  } catch (err) {
    return {
      ok: false,
      saved: false,
      error: err instanceof Error ? err.message : 'Failed to write to local storage.',
    };
  }
}

export function loadProjectsFromLocalStorage(options?: {
  skipAutoSeedIfEmpty?: boolean;
  readOnly?: boolean;
}): {
  projects: CreativeProject[];
  activeProjectId: string | null;
  autoSeededSample?: boolean;
} {
  const local = browserStorage('localStorage');
  if (!local) {
    if (options?.skipAutoSeedIfEmpty) {
      return { projects: [], activeProjectId: null, autoSeededSample: false };
    }
    const sample = createSampleProject();
    return { projects: [sample], activeProjectId: sample.id, autoSeededSample: true };
  }

  try {
    const raw = local.getItem(LOCAL_STORAGE_PROJECTS_KEY);
    const activeId = local.getItem(LOCAL_STORAGE_ACTIVE_ID_KEY);
    const deletedIds = getDeletedProjectIds();
    if (!raw) {
      if (options?.skipAutoSeedIfEmpty) {
        return { projects: [], activeProjectId: activeId, autoSeededSample: false };
      }
      const sample = createSampleProject();
      saveProjectToLocalStorage(sample, undefined, { forceOverwrite: true, allowDeleted: true });
      return { projects: [sample], activeProjectId: sample.id, autoSeededSample: true };
    }

    const parsed = JSON.parse(raw) as Record<string, unknown>;
    const projects: CreativeProject[] = [];
    let needsPreMigrationBackup = false;

    for (const val of Object.values(parsed)) {
      if (
        val &&
        typeof val === 'object' &&
        typeof (val as { schemaVersion?: unknown }).schemaVersion === 'number' &&
        (val as { schemaVersion: number }).schemaVersion < CURRENT_SCHEMA_VERSION
      ) {
        needsPreMigrationBackup = true;
      }
      try {
        const migrated = migrateProjectPayload(val);
        if (!deletedIds.has(migrated.id)) {
          projects.push(migrated);
        }
      } catch {
        // Ignore corrupted individual entry without crashing workspace
      }
    }

    if (needsPreMigrationBackup && !options?.readOnly) {
      try {
        if (!local.getItem(LOCAL_STORAGE_BACKUP_V2_KEY)) {
          local.setItem(LOCAL_STORAGE_BACKUP_V2_KEY, raw);
        }
      } catch {
        // Best-effort backup if quota is tight
      }
    }

    if (projects.length === 0) {
      if (options?.skipAutoSeedIfEmpty) {
        return { projects: [], activeProjectId: activeId, autoSeededSample: false };
      }
      const sample = createSampleProject();
      saveProjectToLocalStorage(sample, undefined, { forceOverwrite: true, allowDeleted: true });
      return { projects: [sample], activeProjectId: sample.id, autoSeededSample: true };
    }

    projects.sort((a, b) => b.updatedAt - a.updatedAt);
    const resolvedActiveId =
      activeId && projects.some((p) => p.id === activeId) ? activeId : projects[0].id;
    return { projects, activeProjectId: resolvedActiveId, autoSeededSample: false };
  } catch {
    if (options?.skipAutoSeedIfEmpty) {
      return { projects: [], activeProjectId: null, autoSeededSample: false };
    }
    const sample = createSampleProject();
    return { projects: [sample], activeProjectId: sample.id, autoSeededSample: true };
  }
}

function removeProjectEntryFromLocalStorage(projectId: string): {
  remaining: CreativeProject[];
  localDeleted: boolean;
} {
  deletedProjectIdsMemorySet.add(projectId);
  const local = browserStorage('localStorage');
  if (!local) {
    return { remaining: [], localDeleted: false };
  }
  try {
    const raw = local.getItem(LOCAL_STORAGE_PROJECTS_KEY);
    if (!raw) {
      return { remaining: [], localDeleted: true };
    }
    const map = JSON.parse(raw) as Record<string, CreativeProject>;
    const existed = Object.prototype.hasOwnProperty.call(map, projectId);
    delete map[projectId];

    let localDeleted = !existed;
    // Write the smaller projects map first so freeing space allows tombstone persistence even near quota
    try {
      local.setItem(LOCAL_STORAGE_PROJECTS_KEY, JSON.stringify(map));
      localDeleted = true;
    } catch {
      localDeleted = !existed;
    }

    const deletedIds = getDeletedProjectIds();
    const remaining = Object.values(map)
      .map((p) => migrateProjectPayload(p))
      .filter((p) => !deletedIds.has(p.id));
    if (remaining.length === 0) {
      const sample = createSampleProject();
      clearDeletedProjectId(sample.id);
      map[sample.id] = sample;
      try {
        local.setItem(LOCAL_STORAGE_PROJECTS_KEY, JSON.stringify(map));
        local.setItem(LOCAL_STORAGE_ACTIVE_ID_KEY, sample.id);
      } catch {
        // Ignore quota error on fallback sample write
      }
      return { remaining: [sample], localDeleted };
    }
    const sorted = remaining.sort((a, b) => b.updatedAt - a.updatedAt);
    const currentActiveId = local.getItem(LOCAL_STORAGE_ACTIVE_ID_KEY);
    if (currentActiveId === projectId) {
      try {
        local.setItem(LOCAL_STORAGE_ACTIVE_ID_KEY, sorted[0].id);
      } catch {
        // Ignore quota error on active ID update
      }
    }
    return { remaining: sorted, localDeleted };
  } catch {
    return { remaining: [], localDeleted: false };
  }
}

export function deleteProjectFromLocalStorage(projectId: string): CreativeProject[] {
  const { remaining } = removeProjectEntryFromLocalStorage(projectId);
  recordDeletedProjectId(projectId);
  return remaining;
}

export async function deleteProjectFromIndexedDb(
  projectId: string
): Promise<{ ok: boolean; error?: string }> {
  recordDeletedProjectId(projectId);
  const { factory, error } = getIndexedDb();
  return factory ? deleteIdbProject(factory, projectId)
    : { ok: false, error: error ?? 'IndexedDB is unavailable in this environment.' };
}

/**
 * Deletes a project from both localStorage and IndexedDB and records a deletion tombstone
 * so neither hydration nor in-flight autosave timers can resurrect it (F-06).
 *
 * Under localStorage quota pressure, backups (`LOCAL_STORAGE_BACKUP_V2_KEY`) and unverified
 * surviving projects are NEVER deleted or stripped. Cache compaction only runs if an
 * immediate IndexedDB read verifies strict full-content parity for every surviving local project
 * with zero corrupt IDB records.
 */
export async function deleteProjectCompletely(projectId: string): Promise<{
  remaining: CreativeProject[];
  localDeleted: boolean;
  idbDeleted: boolean;
  tombstonePersisted: boolean;
  incompleteDeletion: boolean;
  preservedBackups: boolean;
  error?: string;
}> {
  let { remaining, localDeleted } = removeProjectEntryFromLocalStorage(projectId);
  let tombstonePersisted = recordDeletedProjectId(projectId);
  const idbRes = await deleteProjectFromIndexedDb(projectId);

  const local = browserStorage('localStorage');
  if (!tombstonePersisted && local) {
    try {
      const observedCache = local.getItem(LOCAL_STORAGE_PROJECTS_KEY);
      if (observedCache) {
        const idbCheck = await loadProjectsFromIndexedDbDetailed();
        const canCompact = planCacheCompaction(observedCache, projectId, idbCheck);
        // localStorage has no cross-tab transaction. Recheck immediately before each
        // destructive action so an edit observed since the IDB read stays intact.
        if (canCompact && local.getItem(LOCAL_STORAGE_PROJECTS_KEY) === observedCache) {
          let verifiedCache = observedCache;
          try {
            local.setItem(LOCAL_STORAGE_PROJECTS_KEY, canCompact);
            verifiedCache = canCompact;
            localDeleted = true;
            tombstonePersisted = recordDeletedProjectId(projectId);
          } catch {
            // Retry by evicting only the cache already verified against IndexedDB.
          }

          if (!tombstonePersisted && local.getItem(LOCAL_STORAGE_PROJECTS_KEY) === verifiedCache) {
            local.removeItem(LOCAL_STORAGE_PROJECTS_KEY);
            localDeleted = true;
            tombstonePersisted = recordDeletedProjectId(projectId);
          }
          if (idbCheck.projects.length > 0) remaining = idbCheck.projects;
        }
      }
    } catch {
      // Preserve cache and backups when verification or storage access fails.
    }
  }

  const incompleteDeletion = !localDeleted || !idbRes.ok || !tombstonePersisted;
  const fallbackQuotaError = !tombstonePersisted
    ? 'LocalStorage quota prevented persisting the deletion tombstone; unrelated backups and unverified local projects were preserved.'
    : !localDeleted
      ? 'LocalStorage quota prevented removing the deleted project entry while preserving other projects and backups.'
      : undefined;

  return {
    remaining,
    localDeleted,
    idbDeleted: idbRes.ok,
    tombstonePersisted,
    incompleteDeletion,
    preservedBackups: true,
    error: idbRes.error ?? fallbackQuotaError,
  };
}

/**
 * Atomic IndexedDB read-check-put write transaction.
 * Retained strictly as a single live `readwrite` transaction (`getReq.onsuccess` -> `evaluateCasConflict` -> `store.put`)
 * with zero async gaps inserted inside the transaction.
 */
export async function saveProjectToIndexedDb(
  project: CreativeProject,
  expectedBaseRevisionOrOptions?: number | DurableWriteOptions,
  options?: { forceOverwrite?: boolean; allowDeleted?: boolean }
): Promise<StorageSaveResult> {
  const { factory, error } = getIndexedDb();
  if (!factory) return { ok: false, saved: false, error: error ?? 'IndexedDB is unavailable in this environment.' };
  const { opts, normalizedForce, allowDeleted, rawExpected } = normalizeWriteOptions(expectedBaseRevisionOrOptions, options);
  return writeAuthoritativeProject(factory, project, {
    ...opts, expectedPersistedRevision: rawExpected, forceOverwrite: normalizedForce, allowDeleted,
  });
}

async function writeAuthoritativeProject(
  factory: IDBFactory,
  project: CreativeProject,
  options: DurableWriteOptions,
): Promise<StorageSaveResult> {
  const isDeleted = () => !options.allowDeleted && getDeletedProjectIds().has(project.id);
  if (options.allowDeleted) clearDeletedProjectId(project.id);
  const result = await writeIdbProject(factory, project, options, isDeleted);
  if (!result.saved || !isDeleted()) return result;
  const cleanup = await deleteProjectFromIndexedDb(project.id);
  return {
    ok: false,
    saved: false,
    error: cleanup.ok
      ? `Project "${project.id}" was deleted concurrently; the committed record was removed.`
      : `Project "${project.id}" was deleted concurrently; IndexedDB cleanup is incomplete: ${cleanup.error ?? 'unknown error'}`,
  };
}

/**
 * Persists a project with revision-based Compare-And-Swap (CAS) protection.
 * IndexedDB is the single authoritative durable store when available; localStorage is
 * synchronized as a non-authoritative fast-hydration cache and legacy fallback.
 */
export async function persistProjectDurably(
  project: CreativeProject,
  expectedBaseRevisionOrOptions?: number | DurableWriteOptions,
  options?: { forceOverwrite?: boolean; allowDeleted?: boolean }
): Promise<StorageSaveResult> {
  const { opts, normalizedForce, allowDeleted, requireExactBase, rawExpected } =
    normalizeWriteOptions(expectedBaseRevisionOrOptions, options);

  if (allowDeleted) {
    clearDeletedProjectId(project.id);
  } else if (getDeletedProjectIds().has(project.id)) {
    return {
      ok: false,
      saved: false,
      error: `Project "${project.id}" was deleted and cannot be resurrected by an in-flight save.`,
    };
  }

  const local = browserStorage('localStorage');
  let observedCache: CreativeProject | null = null;
  try {
    observedCache = local ? readProjectCache(local)[project.id] ?? null : null;
  } catch {
    // A malformed or inaccessible cache is handled separately after the durable write.
  }
  const hasIndexedDb = getIndexedDb();

  if (hasIndexedDb.error) {
    return { ok: false, saved: false, authoritativeStore: 'indexeddb', idbSaved: false, error: hasIndexedDb.error };
  }
  if (!hasIndexedDb.factory && project.narrative) {
    return { ok: false, saved: false, error: 'IndexedDB is required for manuscript saves.' };
  }

  if (hasIndexedDb.factory) {
    const idbRes = await writeAuthoritativeProject(hasIndexedDb.factory, project, {
      ...opts, expectedPersistedRevision: rawExpected, forceOverwrite: normalizedForce, allowDeleted,
    });
    const authoritative = { ...idbRes, authoritativeStore: 'indexeddb' as const, idbSaved: Boolean(idbRes.saved) };
    if (!idbRes.saved) return authoritative;

    const committed = idbRes.storedProject ?? project;
    const cache = saveProjectToLocalStorage({
      ...committed, persistedRevision: idbRes.persistedRevision,
    }, {
      forceOverwrite: true, selectProject: false, expectedBaseProject: observedCache,
    });
    const cacheSynced = Boolean(cache.saved);
    return {
      ...authoritative,
      localSaved: cacheSynced,
      cacheSynced,
      ...(!cacheSynced ? { quotaExceeded: cache.quotaExceeded, cacheWarning: cache.error } : {}),
    };
  }

  const fallbackRes = saveProjectToLocalStorage(project, {
    ...opts,
    selectProject: false,
    expectedPersistedRevision: rawExpected,
    expectedManuscriptVersionId: opts?.expectedManuscriptVersionId,
    expectedBaseSnapshotDigest: opts?.expectedBaseSnapshotDigest,
    expectedBaseProject: opts?.expectedBaseProject,
    intentId: opts?.intentId,
    requireExactBase,
    forceOverwrite: normalizedForce,
    allowDeleted,
  });
  return {
    ...fallbackRes,
    authoritativeStore: 'localstorage',
    idbSaved: false,
    localSaved: Boolean(fallbackRes.saved),
    cacheSynced: Boolean(fallbackRes.saved),
  };
}

/**
 * Loads projects from IndexedDB with explicit status differentiation (`ok`, `empty`, `unavailable`, `read_error`).
 */
export async function loadProjectsFromIndexedDbDetailed(): Promise<IndexedDbLoadResult> {
  const { factory, error } = getIndexedDb();
  if (!factory) {
    return {
      ok: false, status: error ? 'read_error' : 'unavailable', projects: [],
      corruptRecordCount: 0, corruptRecordErrors: [],
      error: error ?? 'IndexedDB is unavailable in this environment.',
    };
  }

  const read = await readIdbProjects(factory);
  if (!read.ok) {
    return { ok: false, status: 'read_error', projects: [], corruptRecordCount: 0, corruptRecordErrors: [], error: read.error };
  }
  const deletedIds = getDeletedProjectIds();
  const projects: CreativeProject[] = [];
  const corruptRecordErrors: string[] = [];
  for (const item of read.entries) {
    try {
      const project = migrateProjectPayload(item);
      if (!deletedIds.has(project.id)) projects.push(project);
    } catch (error) {
      corruptRecordErrors.push(error instanceof Error ? error.message : 'Corrupt or unsupported project record.');
    }
  }
  const corruptRecordCount = corruptRecordErrors.length;
  const unreadable = projects.length === 0 && corruptRecordCount > 0;
  return {
    ok: !unreadable,
    status: unreadable ? 'read_error' : projects.length > 0 ? 'ok' : 'empty',
    projects: projects.sort((a, b) => b.updatedAt - a.updatedAt),
    corruptRecordCount,
    corruptRecordErrors,
    ...(unreadable ? { error: 'No IndexedDB project could be read. Existing records were preserved.' } : {}),
  };
}

export async function loadProjectsFromIndexedDb(): Promise<CreativeProject[]> {
  const res = await loadProjectsFromIndexedDbDetailed();
  return res.projects;
}

/**
 * Reconciles initial localStorage projects with asynchronous IndexedDB hydration (F-02, IA-04, IA-05).
 */
export function reconcileHydratedProjects(params: {
  localProjects: CreativeProject[];
  idbProjects: CreativeProject[];
  activeProject: CreativeProject;
  activeUndoState: UndoRedoState;
  hasLocalEditsSinceMount?: boolean;
  localWasAutoSeededSample?: boolean;
  deletedProjectIds?: Iterable<string>;
  ignoreDivergenceConflict?: boolean;
}): {
  savedProjects: CreativeProject[];
  activeProject: CreativeProject;
  activeUndoState: UndoRedoState;
  upgradedFromIndexedDb: boolean;
  conflictWithHydrated: CreativeProject | null;
} {
  const deletedSet = new Set<string>(params.deletedProjectIds ?? getDeletedProjectIds());
  return reconcileHydratedProjectsCore({
    ...params,
    deletedSet,
  });
}

/**
 * Reloads the truly latest valid projects across both IndexedDB and localStorage,
 * preserving complete snapshots, revisions, Undo/Redo history, and media artifacts.
 */
export async function reloadLatestProjectsFromStorage(
  preferredActiveProjectId?: string | null,
  options?: {
    resolution?: 'prefer-idb' | 'prefer-local';
    inMemoryActiveProject?: CreativeProject;
    hasLocalEditsSinceMount?: boolean;
    observedConflictProject?: CreativeProject;
    isCurrent?: () => boolean;
    commit?: (project: CreativeProject, options: DurableWriteOptions) => Promise<StorageSaveResult>;
  }
): Promise<{
  projects: CreativeProject[];
  activeProject: CreativeProject;
  activeUndoState: UndoRedoState;
  upgradedFromIndexedDb: boolean;
  idbStatus: IndexedDbLoadStatus;
  idbError?: string;
  corruptRecordCount?: number;
  conflictDetected?: boolean;
  conflictProject?: CreativeProject | null;
  alternateProject?: CreativeProject | null;
  persisted?: boolean;
  persistenceWarning?: string;
}> {
  const localData = loadProjectsFromLocalStorage({ skipAutoSeedIfEmpty: true });
  const idbLoad = await loadProjectsFromIndexedDbDetailed();
  const idbProjects = idbLoad.projects;
  const inMemoryActive = options?.inMemoryActiveProject;
  const hasUnsyncedMemoryEdits = Boolean(options?.hasLocalEditsSinceMount && inMemoryActive);
  const targetId = preferredActiveProjectId ?? inMemoryActive?.id ?? localData.activeProjectId;

  const effectiveLocalProjects = [...localData.projects];
  if (hasUnsyncedMemoryEdits && inMemoryActive) {
    const existingIdx = effectiveLocalProjects.findIndex((p) => p.id === inMemoryActive.id);
    if (existingIdx >= 0) {
      effectiveLocalProjects[existingIdx] = inMemoryActive;
    } else {
      effectiveLocalProjects.unshift(inMemoryActive);
    }
  }

  // FIX 1: On IndexedDB read failure, never seed or overwrite IndexedDB
  if (idbLoad.status === 'read_error') {
    const fallbackProjects =
      effectiveLocalProjects.length > 0 ? effectiveLocalProjects : [createSampleProject()];
    const activeFallback = fallbackProjects.find((p) => p.id === targetId) ?? fallbackProjects[0];
    return {
      projects: fallbackProjects,
      activeProject: activeFallback,
      activeUndoState: createUndoRedoState(
        activeFallback.snapshot,
        activeFallback.revisions,
        activeFallback.undoHistory
      ),
      upgradedFromIndexedDb: false,
      idbStatus: 'read_error',
      idbError: idbLoad.error,
      corruptRecordCount: idbLoad.corruptRecordCount,
      conflictDetected: false,
      conflictProject: null,
      persisted: false,
      persistenceWarning: idbLoad.error,
    };
  }

  const { reconciled, localMatch, idbMatch, chosen } = planStorageReload({
    localProjects: effectiveLocalProjects,
    idbProjects,
    targetId,
    inMemoryActive: hasUnsyncedMemoryEdits ? inMemoryActive : undefined,
    resolution: options?.resolution,
    deletedSet: getDeletedProjectIds(),
  });
  const observedCache = localData.projects.find((project) => project.id === chosen.id);

  // FIX 2: If a semantic divergence or lineage conflict exists and no explicit resolution was requested,
  // preserve both stores intact without destructive overwrites.
  if (reconciled.conflictWithHydrated && !options?.resolution) {
    const preservedLocal = localMatch ?? reconciled.activeProject;
    return {
      projects: reconciled.savedProjects,
      activeProject: preservedLocal,
      activeUndoState: createUndoRedoState(
        preservedLocal.snapshot,
        preservedLocal.revisions,
        preservedLocal.undoHistory
      ),
      upgradedFromIndexedDb: false,
      idbStatus: idbLoad.status,
      corruptRecordCount: idbLoad.corruptRecordCount,
      conflictDetected: true,
      conflictProject: reconciled.conflictWithHydrated,
      alternateProject: preservedLocal,
      persisted: false,
    };
  }

  let chosenActive = chosen;
  const finalProjects = upsertReloadedProject(reconciled.savedProjects, chosen);
  const conflict = (current: CreativeProject | undefined, warning: string) => ({
    projects: finalProjects,
    activeProject: localMatch ?? chosen,
    activeUndoState: createUndoRedoState(
      (localMatch ?? chosen).snapshot, (localMatch ?? chosen).revisions, (localMatch ?? chosen).undoHistory
    ),
    upgradedFromIndexedDb: false,
    idbStatus: idbLoad.status,
    corruptRecordCount: idbLoad.corruptRecordCount,
    conflictDetected: true,
    conflictProject: current ?? null,
    alternateProject: localMatch ?? chosen,
    persisted: false,
    persistenceWarning: warning,
  });

  if (options?.observedConflictProject &&
      !matchesObservedProject(idbLoad.status === 'unavailable' ? observedCache : idbMatch, options.observedConflictProject)) {
    return conflict(idbMatch ?? observedCache, 'Storage changed since this conflict was shown. Review the latest versions.');
  }
  if (options?.isCurrent?.() === false) {
    return conflict(idbMatch, 'The active project changed while reloading.');
  }

  let persisted = Boolean(idbMatch && matchesObservedProject(idbMatch, chosen));
  let persistenceWarning: string | undefined;
  if (options?.resolution === 'prefer-local' && localMatch && idbMatch && !persisted) {
    chosenActive = {
      ...localMatch,
      revision: Math.max(localMatch.revision, idbMatch.revision) + 1,
      updatedAt: Math.max(Date.now(), localMatch.updatedAt, idbMatch.updatedAt),
    };
    const result = await (options.commit ?? saveProjectToIndexedDb)(
      chosenActive, { expectedBaseProject: idbMatch, expectedPersistedRevision: idbMatch.revision }
    );
    if (!result.saved) return conflict(result.storedProject ?? idbMatch, result.error ?? 'The conflict resolution could not be saved.');
    chosenActive = { ...chosenActive, persistedRevision: result.persistedRevision };
    persisted = true;
  }

  if (idbLoad.status === 'empty' && !options?.resolution && options?.commit) {
    const initialized = await options.commit(chosenActive, { expectedBaseProject: null });
    if (!initialized.saved) {
      return {
        ...conflict(initialized.storedProject, initialized.error ?? 'Could not initialize durable storage.'),
        idbStatus: 'read_error' as const,
        idbError: initialized.error,
      };
    }
    chosenActive = { ...chosenActive, persistedRevision: initialized.persistedRevision };
    persisted = true;
  }

  if (idbLoad.status === 'unavailable') {
    persisted = Boolean(observedCache && matchesObservedProject(observedCache, chosenActive));
    if (options?.resolution === 'prefer-local' && options.observedConflictProject && !chosenActive.narrative) {
      const base = options.observedConflictProject;
      chosenActive = { ...chosenActive, revision: Math.max(chosenActive.revision, base.revision) + 1 };
      const saved = saveProjectToLocalStorage(chosenActive, { expectedBaseProject: base });
      if (!saved.saved) return conflict(saved.storedProject ?? observedCache, saved.error ?? 'The conflict resolution could not be saved.');
      chosenActive = { ...chosenActive, persistedRevision: saved.persistedRevision };
      persisted = true;
    }
  } else if (persisted && !matchesObservedProject(observedCache, chosenActive) && options?.isCurrent?.() !== false) {
    const cached = saveProjectToLocalStorage(chosenActive, { expectedBaseProject: observedCache ?? null, forceOverwrite: true, selectProject: false });
    if (!cached.saved) persistenceWarning = cached.error;
  }

  return {
    projects: upsertReloadedProject(finalProjects, chosenActive),
    activeProject: chosenActive,
    activeUndoState: createUndoRedoState(
      chosenActive.snapshot,
      chosenActive.revisions,
      chosenActive.undoHistory
    ),
    upgradedFromIndexedDb:
      reconciled.upgradedFromIndexedDb || options?.resolution === 'prefer-idb',
    idbStatus: idbLoad.status,
    corruptRecordCount: idbLoad.corruptRecordCount,
    conflictDetected: false,
    conflictProject: null,
    persisted,
    persistenceWarning,
  };
}
