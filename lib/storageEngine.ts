/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { createSampleProject } from './canonicalModel.ts';
import type { UndoRedoState } from './historyEngine.ts';
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
import { evaluateCasConflict, mergeIntentIds } from './storage/casPolicy.ts';
import { planCacheCompaction, verifyProjectCacheParity } from './storage/cacheParity.ts';
import {
  browserStorage,
  readProjectCache,
  setCachedProjectSelection,
  writeProjectCache,
} from './storage/localProjectCache.ts';
import {
  deleteIdbProject,
  getIndexedDb,
  readIdbProjects,
  writeIdbProject,
} from './storage/indexedDbOperations.ts';
import { reconcileHydratedProjectsCore } from './storage/hydrationReconciliation.ts';
import {
  addDeletedProjectIdInMemory,
  clearDeletedProjectId,
  getDeletedProjectIds,
  recordDeletedProjectId,
  simulateBrowserProcessRestartForTesting,
} from './storage/tombstoneRegistry.ts';
import {
  coordinateStorageReload,
  type ReloadLatestProjectsOptions,
  type ReloadLatestProjectsResult,
} from './storage/reloadCoordinator.ts';

export {
  CURRENT_SCHEMA_VERSION,
  LOCAL_STORAGE_ACTIVE_ID_KEY,
  LOCAL_STORAGE_BACKUP_V2_KEY,
  LOCAL_STORAGE_DELETED_IDS_KEY,
  LOCAL_STORAGE_PROJECTS_KEY,
  NARRATIVE_SCHEMA_VERSION,
  clearDeletedProjectId,
  exportProjectToJson,
  exportStoryBibleMarkdown,
  getDeletedProjectIds,
  migrateProjectPayload,
  recordDeletedProjectId,
  setCachedProjectSelection,
  simulateBrowserProcessRestartForTesting,
  verifyProjectCacheParity,
  type DurableWriteOptions,
  type IndexedDbLoadResult,
  type IndexedDbLoadStatus,
  type StorageSaveResult,
};

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

function safeMigrateEntries(
  rawValues: unknown[],
  deletedIds: ReadonlySet<string>
): { projects: CreativeProject[]; needsPreMigrationBackup: boolean } {
  const projects: CreativeProject[] = [];
  let needsPreMigrationBackup = false;

  for (const val of rawValues) {
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
      // Ignore corrupted or unsupported individual entry without crashing workspace
    }
  }

  return { projects, needsPreMigrationBackup };
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
    const { projects, needsPreMigrationBackup } = safeMigrateEntries(Object.values(parsed), deletedIds);

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
  addDeletedProjectIdInMemory(projectId);
  const local = browserStorage('localStorage');
  if (!local) {
    return { remaining: [], localDeleted: false };
  }
  try {
    const raw = local.getItem(LOCAL_STORAGE_PROJECTS_KEY);
    if (!raw) {
      return { remaining: [], localDeleted: true };
    }
    const map = JSON.parse(raw) as Record<string, unknown>;
    const existed = Object.prototype.hasOwnProperty.call(map, projectId);
    delete map[projectId];

    let localDeleted = !existed;
    try {
      local.setItem(LOCAL_STORAGE_PROJECTS_KEY, JSON.stringify(map));
      localDeleted = true;
    } catch {
      localDeleted = !existed;
    }

    const deletedIds = getDeletedProjectIds();
    const { projects: remaining } = safeMigrateEntries(Object.values(map), deletedIds);
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

async function tryQuotaCompactionAfterDelete(
  local: Storage,
  projectId: string
): Promise<{ compacted: boolean; tombstonePersisted: boolean; remaining?: CreativeProject[] }> {
  try {
    const observedCache = local.getItem(LOCAL_STORAGE_PROJECTS_KEY);
    if (!observedCache) {
      return { compacted: false, tombstonePersisted: false };
    }
    const idbCheck = await loadProjectsFromIndexedDbDetailed();
    const canCompact = planCacheCompaction(observedCache, projectId, idbCheck);
    if (!canCompact || local.getItem(LOCAL_STORAGE_PROJECTS_KEY) !== observedCache) {
      return { compacted: false, tombstonePersisted: false };
    }

    let verifiedCache = observedCache;
    let compacted = false;
    let tombstonePersisted = false;

    try {
      local.setItem(LOCAL_STORAGE_PROJECTS_KEY, canCompact);
      verifiedCache = canCompact;
      compacted = true;
      tombstonePersisted = recordDeletedProjectId(projectId);
    } catch {
      // Retry by evicting only the cache already verified against IndexedDB.
    }

    if (!tombstonePersisted && local.getItem(LOCAL_STORAGE_PROJECTS_KEY) === verifiedCache) {
      local.removeItem(LOCAL_STORAGE_PROJECTS_KEY);
      compacted = true;
      tombstonePersisted = recordDeletedProjectId(projectId);
    }

    return {
      compacted,
      tombstonePersisted,
      remaining: idbCheck.projects.length > 0 ? idbCheck.projects : undefined,
    };
  } catch {
    return { compacted: false, tombstonePersisted: false };
  }
}

/**
 * Deletes a project from both localStorage and IndexedDB and records a deletion tombstone
 * so neither hydration nor in-flight autosave timers can resurrect it (F-06).
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
    const compaction = await tryQuotaCompactionAfterDelete(local, projectId);
    if (compaction.compacted) localDeleted = true;
    if (compaction.tombstonePersisted) tombstonePersisted = true;
    if (compaction.remaining) remaining = compaction.remaining;
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
    } catch (err) {
      corruptRecordErrors.push(err instanceof Error ? err.message : 'Corrupt or unsupported project record.');
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
  options?: ReloadLatestProjectsOptions
): Promise<ReloadLatestProjectsResult> {
  return coordinateStorageReload(
    {
      loadLocalProjects: () => loadProjectsFromLocalStorage({ skipAutoSeedIfEmpty: true }),
      loadIdbProjectsDetailed: loadProjectsFromIndexedDbDetailed,
      saveToIndexedDb: (project, opts) => saveProjectToIndexedDb(project, opts),
      saveToLocalStorage: (project, opts) => saveProjectToLocalStorage(project, opts),
    },
    preferredActiveProjectId,
    options
  );
}
