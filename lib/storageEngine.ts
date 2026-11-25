/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { createSampleProject } from './canonicalModel.ts';
import { createUndoRedoState, type UndoRedoState } from './historyEngine.ts';
import type { CreativeProject } from '../shared/types.ts';
import {
  CURRENT_SCHEMA_VERSION,
  IDB_NAME,
  IDB_STORE,
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
import { verifyProjectCacheParity } from './storage/cacheParity.ts';
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

  readFromStorage(window.localStorage);
  readFromStorage(window.sessionStorage);
  return combined;
}

export function recordDeletedProjectId(projectId: string): boolean {
  deletedProjectIdsMemorySet.add(projectId);
  if (typeof window === 'undefined') return false;

  const set = getDeletedProjectIds();
  set.add(projectId);
  const serialized = JSON.stringify(Array.from(set).slice(-200));

  try {
    window.sessionStorage?.setItem(LOCAL_STORAGE_DELETED_IDS_KEY, serialized);
  } catch {
    // Ignore sessionStorage error
  }

  if (!window.localStorage) return false;

  try {
    window.localStorage.setItem(LOCAL_STORAGE_DELETED_IDS_KEY, serialized);
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
  for (const storage of [window.localStorage, window.sessionStorage]) {
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
  if (typeof window !== 'undefined' && window.sessionStorage) {
    try {
      window.sessionStorage.removeItem(LOCAL_STORAGE_DELETED_IDS_KEY);
    } catch {
      // Ignore sessionStorage error
    }
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
  if (typeof window === 'undefined' || !window.localStorage) {
    return { ok: false, saved: false, error: 'Browser localStorage is unavailable.' };
  }

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
    const raw = window.localStorage.getItem(LOCAL_STORAGE_PROJECTS_KEY);
    const map: Record<string, CreativeProject> = raw
      ? (JSON.parse(raw) as Record<string, CreativeProject>)
      : {};
    const existing = map[project.id];

    const casConflict = evaluateCasConflict({
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
      window.localStorage.setItem(LOCAL_STORAGE_PROJECTS_KEY, JSON.stringify(map));
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

    window.localStorage.setItem(LOCAL_STORAGE_ACTIVE_ID_KEY, project.id);
    return {
      ok: true,
      saved: true,
      persistedRevision: nextRevision,
    };
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
  if (typeof window === 'undefined' || !window.localStorage) {
    deletedProjectIdsMemorySet.clear();
    if (options?.skipAutoSeedIfEmpty) {
      return { projects: [], activeProjectId: null, autoSeededSample: false };
    }
    const sample = createSampleProject();
    return { projects: [sample], activeProjectId: sample.id, autoSeededSample: true };
  }

  try {
    const rawDeleted = window.localStorage.getItem(LOCAL_STORAGE_DELETED_IDS_KEY);
    const raw = window.localStorage.getItem(LOCAL_STORAGE_PROJECTS_KEY);
    const activeId = window.localStorage.getItem(LOCAL_STORAGE_ACTIVE_ID_KEY);
    if (!rawDeleted && !raw && !activeId) {
      deletedProjectIdsMemorySet.clear();
    }
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
        if (!window.localStorage.getItem(LOCAL_STORAGE_BACKUP_V2_KEY)) {
          window.localStorage.setItem(LOCAL_STORAGE_BACKUP_V2_KEY, raw);
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
  if (typeof window === 'undefined' || !window.localStorage) {
    return { remaining: [], localDeleted: false };
  }
  try {
    const raw = window.localStorage.getItem(LOCAL_STORAGE_PROJECTS_KEY);
    if (!raw) {
      return { remaining: [], localDeleted: true };
    }
    const map = JSON.parse(raw) as Record<string, CreativeProject>;
    const existed = Object.prototype.hasOwnProperty.call(map, projectId);
    delete map[projectId];

    let localDeleted = !existed;
    // Write the smaller projects map first so freeing space allows tombstone persistence even near quota
    try {
      window.localStorage.setItem(LOCAL_STORAGE_PROJECTS_KEY, JSON.stringify(map));
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
        window.localStorage.setItem(LOCAL_STORAGE_PROJECTS_KEY, JSON.stringify(map));
        window.localStorage.setItem(LOCAL_STORAGE_ACTIVE_ID_KEY, sample.id);
      } catch {
        // Ignore quota error on fallback sample write
      }
      return { remaining: [sample], localDeleted };
    }
    const sorted = remaining.sort((a, b) => b.updatedAt - a.updatedAt);
    const currentActiveId = window.localStorage.getItem(LOCAL_STORAGE_ACTIVE_ID_KEY);
    if (currentActiveId === projectId) {
      try {
        window.localStorage.setItem(LOCAL_STORAGE_ACTIVE_ID_KEY, sorted[0].id);
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
  if (typeof window === 'undefined' || !('indexedDB' in window) || !window.indexedDB) {
    return { ok: false, error: 'IndexedDB is unavailable in this environment.' };
  }

  return new Promise((resolve) => {
    let settled = false;
    const finish = (result: { ok: boolean; error?: string }) => {
      if (settled) return;
      settled = true;
      resolve(result);
    };
    const safeClose = (db: IDBDatabase) => {
      try {
        db.close();
      } catch {
        // Ignore close error
      }
    };

    try {
      const req = window.indexedDB.open(IDB_NAME, 1);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains(IDB_STORE)) {
          db.createObjectStore(IDB_STORE, { keyPath: 'id' });
        }
      };
      req.onsuccess = () => {
        const db = req.result;
        try {
          const tx = db.transaction(IDB_STORE, 'readwrite');
          const store = tx.objectStore(IDB_STORE);
          const delReq = store.delete(projectId);
          delReq.onerror = () => {
            const errMsg =
              delReq.error?.message ?? tx.error?.message ?? 'IndexedDB delete request failed.';
            safeClose(db);
            finish({ ok: false, error: errMsg });
          };
          tx.oncomplete = () => {
            safeClose(db);
            finish({ ok: true });
          };
          tx.onerror = () => {
            const errMsg = tx.error?.message ?? 'IndexedDB delete transaction failed.';
            safeClose(db);
            finish({ ok: false, error: errMsg });
          };
          tx.onabort = () => {
            const errMsg = tx.error?.message ?? 'IndexedDB delete transaction aborted.';
            safeClose(db);
            finish({ ok: false, error: errMsg });
          };
        } catch (txErr) {
          safeClose(db);
          finish({
            ok: false,
            error: txErr instanceof Error ? txErr.message : 'IndexedDB transaction setup failed.',
          });
        }
      };
      req.onerror = () =>
        finish({
          ok: false,
          error: req.error?.message ?? 'Failed to open IndexedDB for deletion.',
        });
    } catch (err) {
      finish({
        ok: false,
        error: err instanceof Error ? err.message : 'IndexedDB delete exception.',
      });
    }
  });
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

  if (!tombstonePersisted && typeof window !== 'undefined' && window.localStorage) {
    try {
      const rawProjects = window.localStorage.getItem(LOCAL_STORAGE_PROJECTS_KEY);
      if (rawProjects) {
        const parsed = JSON.parse(rawProjects) as Record<string, CreativeProject>;
        delete parsed[projectId];
        const survivingEntries = Object.entries(parsed).filter(
          ([id, proj]) => id !== projectId && Boolean(proj) && typeof proj === 'object'
        );

        const idbCheck = await loadProjectsFromIndexedDbDetailed();
        const idbById = new Map(idbCheck.projects.map((p) => [p.id, p]));
        const idbReadableAndClean =
          idbCheck.corruptRecordCount === 0 &&
          (idbCheck.status === 'ok' ||
            (idbCheck.status === 'empty' && survivingEntries.length === 0));

        const allSurvivingVerifiedInIdb =
          idbReadableAndClean &&
          survivingEntries.every(([id, rawLocalProj]) => {
            const idbProj = idbById.get(id);
            if (!idbProj) return false;
            try {
              const normalizedLocal = migrateProjectPayload(rawLocalProj);
              return verifyProjectCacheParity(normalizedLocal, idbProj);
            } catch {
              return false;
            }
          });

        if (allSurvivingVerifiedInIdb) {
          // Safe compaction: strip only redundant cached artifacts first, never deleting backups.
          const compacted: Record<string, CreativeProject> = {};
          for (const [id, proj] of survivingEntries) {
            compacted[id] = {
              ...proj,
              artifacts: [],
            };
          }
          try {
            window.localStorage.setItem(LOCAL_STORAGE_PROJECTS_KEY, JSON.stringify(compacted));
            localDeleted = true;
            tombstonePersisted = recordDeletedProjectId(projectId);
          } catch {
            // Still over tight quota; every surviving project is content-verified present in IndexedDB
          }

          if (!tombstonePersisted) {
            try {
              window.localStorage.removeItem(LOCAL_STORAGE_PROJECTS_KEY);
              localDeleted = true;
              tombstonePersisted = recordDeletedProjectId(projectId);
            } catch {
              // Keep in-memory + sessionStorage tombstone and leave backup untouched
            }
          }

          if (idbCheck.projects.length > 0) {
            const deletedIds = getDeletedProjectIds();
            deletedIds.add(projectId);
            const verifiedRemaining = idbCheck.projects
              .filter((p) => !deletedIds.has(p.id))
              .sort((a, b) => b.updatedAt - a.updatedAt);
            if (verifiedRemaining.length > 0) {
              remaining = verifiedRemaining;
            }
          }
        }
      }
    } catch {
      // Preserve existing localStorage records and backup on parse/storage error
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
  if (typeof window === 'undefined' || !('indexedDB' in window) || !window.indexedDB) {
    return { ok: false, saved: false, error: 'IndexedDB is unavailable in this environment.' };
  }
  const { opts, normalizedForce, allowDeleted, requireExactBase, rawExpected } =
    normalizeWriteOptions(expectedBaseRevisionOrOptions, options);

  if (allowDeleted) {
    clearDeletedProjectId(project.id);
  } else if (getDeletedProjectIds().has(project.id)) {
    return {
      ok: false,
      saved: false,
      error: `Project "${project.id}" was deleted and cannot be written to IndexedDB.`,
    };
  }

  return new Promise((resolve) => {
    let settled = false;
    const finish = (result: StorageSaveResult) => {
      if (settled) return;
      settled = true;
      resolve(result);
    };
    const safeClose = (db: IDBDatabase) => {
      try {
        db.close();
      } catch {
        // Ignore close error
      }
    };

    try {
      const req = window.indexedDB.open(IDB_NAME, 1);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains(IDB_STORE)) {
          db.createObjectStore(IDB_STORE, { keyPath: 'id' });
        }
      };
      req.onsuccess = () => {
        const db = req.result;
        if (!allowDeleted && getDeletedProjectIds().has(project.id)) {
          safeClose(db);
          finish({
            ok: false,
            saved: false,
            error: `Project "${project.id}" was deleted while opening IndexedDB.`,
          });
          return;
        }

        try {
          const tx = db.transaction(IDB_STORE, 'readwrite');
          const store = tx.objectStore(IDB_STORE);
          const getReq = store.get(project.id);

          getReq.onsuccess = () => {
            try {
              // Guard against delayed saves resurrecting a project deleted while `get` was in flight
              if (!allowDeleted && getDeletedProjectIds().has(project.id)) {
                try {
                  tx.abort();
                } catch {
                  // Ignore abort error
                }
                safeClose(db);
                finish({
                  ok: false,
                  saved: false,
                  error: `Project "${project.id}" was deleted before IndexedDB write could commit.`,
                });
                return;
              }

              const existing = getReq.result as CreativeProject | undefined;
              const casConflict = evaluateCasConflict({
                existing,
                candidate: project,
                rawExpected,
                expectedManuscriptVersionId: opts?.expectedManuscriptVersionId,
                expectedBaseSnapshotDigest: opts?.expectedBaseSnapshotDigest,
                expectedBaseProject: opts?.expectedBaseProject,
                intentId: opts?.intentId,
                requireExactBase,
                forceOverwrite: normalizedForce,
                storeLabel: 'IndexedDB',
              });

              if (casConflict) {
                try {
                  tx.abort();
                } catch {
                  // Ignore abort error
                }
                safeClose(db);
                finish(casConflict);
                return;
              }

              const nextRev = project.revision ?? 1;
              const mergedIntents = mergeIntentIds(existing, project, opts?.intentId, rawExpected);
              const putReq = store.put({
                ...project,
                revision: nextRev,
                persistedRevision: nextRev,
                ...(mergedIntents ? { recentIntentIds: mergedIntents } : {}),
              });
              putReq.onerror = () => {
                const errObj = putReq.error ?? tx.error;
                const errMsg = errObj?.message ?? 'IndexedDB put request failed.';
                const isQuota =
                  errObj?.name === 'QuotaExceededError' || /quota/i.test(errMsg);
                safeClose(db);
                finish({
                  ok: false,
                  saved: false,
                  quotaExceeded: isQuota,
                  persistedRevision: project.persistedRevision,
                  error: errMsg,
                });
              };
            } catch (error) {
              // A synchronous put/validation exception leaves no write request in the transaction.
              // Abort it explicitly so oncomplete cannot acknowledge an unwritten project.
              try {
                tx.abort();
              } catch {
                /* Transaction already closed. */
              }
              safeClose(db);
              const message = error instanceof Error ? error.message : 'IndexedDB write failed.';
              finish({
                ok: false,
                saved: false,
                error: message,
                quotaExceeded:
                  error instanceof Error &&
                  (error.name === 'QuotaExceededError' || /quota/i.test(message)),
              });
            }
          };

          getReq.onerror = () => {
            const errMsg =
              getReq.error?.message ?? tx.error?.message ?? 'IndexedDB read before write failed.';
            safeClose(db);
            finish({ ok: false, saved: false, error: errMsg });
          };

          tx.oncomplete = () => {
            safeClose(db);
            if (!allowDeleted && getDeletedProjectIds().has(project.id)) {
              void deleteProjectFromIndexedDb(project.id);
              finish({
                ok: false,
                saved: false,
                error: `Project "${project.id}" was deleted concurrently; rolled back IndexedDB write.`,
              });
              return;
            }
            finish({ ok: true, saved: true, persistedRevision: project.revision ?? 1 });
          };

          tx.onerror = () => {
            const errObj = tx.error;
            const errMsg = errObj?.message ?? 'IndexedDB transaction failed.';
            const isQuota = errObj?.name === 'QuotaExceededError' || /quota/i.test(errMsg);
            safeClose(db);
            finish({
              ok: false,
              saved: false,
              quotaExceeded: isQuota,
              persistedRevision: project.persistedRevision,
              error: errMsg,
            });
          };

          tx.onabort = () => {
            const errObj = tx.error;
            const errMsg = errObj?.message ?? 'IndexedDB transaction aborted.';
            const isQuota = errObj?.name === 'QuotaExceededError' || /quota/i.test(errMsg);
            safeClose(db);
            finish({
              ok: false,
              saved: false,
              quotaExceeded: isQuota,
              persistedRevision: project.persistedRevision,
              error: errMsg,
            });
          };
        } catch (txErr) {
          safeClose(db);
          finish({
            ok: false,
            saved: false,
            error: txErr instanceof Error ? txErr.message : 'IndexedDB transaction exception.',
          });
        }
      };
      req.onerror = () =>
        finish({ ok: false, saved: false, error: req.error?.message ?? 'Failed to open IndexedDB.' });
    } catch (err) {
      finish({
        ok: false,
        saved: false,
        error: err instanceof Error ? err.message : 'IndexedDB exception.',
      });
    }
  });
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

  const hasLocalStorage = typeof window !== 'undefined' && Boolean(window.localStorage);
  const hasIndexedDb =
    typeof window !== 'undefined' && 'indexedDB' in window && Boolean(window.indexedDB);

  if (!hasIndexedDb && project.narrative) {
    return { ok: false, saved: false, error: 'IndexedDB is required for manuscript saves.' };
  }

  if (hasIndexedDb) {
    const idbRes = await saveProjectToIndexedDb(project, {
      expectedPersistedRevision: rawExpected,
      expectedManuscriptVersionId: opts?.expectedManuscriptVersionId,
      expectedBaseSnapshotDigest: opts?.expectedBaseSnapshotDigest,
      expectedBaseProject: opts?.expectedBaseProject,
      intentId: opts?.intentId,
      requireExactBase,
      forceOverwrite: normalizedForce,
      allowDeleted,
    });

    if (!idbRes.saved) {
      return {
        ...idbRes,
        authoritativeStore: 'indexeddb',
        idbSaved: false,
      };
    }

    if (idbRes.idempotentHit) {
      const localRes =
        hasLocalStorage && idbRes.storedProject
          ? saveProjectToLocalStorage(idbRes.storedProject, { forceOverwrite: true, allowDeleted })
          : undefined;
      const cacheSynced = Boolean(localRes?.saved);
      return {
        ...idbRes,
        authoritativeStore: 'indexeddb',
        idbSaved: true,
        localSaved: cacheSynced,
        cacheSynced,
        ...(!cacheSynced && hasLocalStorage
          ? {
              quotaExceeded: Boolean(localRes?.quotaExceeded),
              cacheWarning:
                localRes?.error ??
                'The authoritative IndexedDB result could not be synchronized to the localStorage cache.',
            }
          : {}),
      };
    }

    if (!allowDeleted && getDeletedProjectIds().has(project.id)) {
      await deleteProjectFromIndexedDb(project.id);
      return {
        ok: false,
        saved: false,
        authoritativeStore: 'indexeddb',
        idbSaved: false,
        error: `Project "${project.id}" was deleted during persistence.`,
      };
    }

    const committedRevision = idbRes.persistedRevision ?? (project.revision ?? 1);
    const mergedIntents = mergeIntentIds(undefined, project, opts?.intentId, rawExpected);

    if (hasLocalStorage) {
      const localRes = saveProjectToLocalStorage(
        {
          ...project,
          revision: committedRevision,
          persistedRevision: committedRevision,
          ...(mergedIntents ? { recentIntentIds: mergedIntents } : {}),
        },
        {
          forceOverwrite: true,
          allowDeleted,
        }
      );

      if (!localRes.saved) {
        return {
          ok: true,
          saved: true,
          authoritativeStore: 'indexeddb',
          idbSaved: true,
          localSaved: false,
          cacheSynced: false,
          quotaExceeded: Boolean(localRes.quotaExceeded),
          cacheWarning:
            localRes.error ??
            'Authoritative IndexedDB save succeeded, but localStorage cache synchronization failed.',
          persistedRevision: committedRevision,
          error: localRes.error,
        };
      }

      return {
        ok: true,
        saved: true,
        authoritativeStore: 'indexeddb',
        idbSaved: true,
        localSaved: true,
        cacheSynced: true,
        persistedRevision: committedRevision,
      };
    }

    return {
      ok: true,
      saved: true,
      authoritativeStore: 'indexeddb',
      idbSaved: true,
      localSaved: false,
      cacheSynced: false,
      persistedRevision: committedRevision,
    };
  }

  const fallbackRes = saveProjectToLocalStorage(project, {
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
  if (typeof window === 'undefined' || !('indexedDB' in window) || !window.indexedDB) {
    return {
      ok: false,
      status: 'unavailable',
      projects: [],
      corruptRecordCount: 0,
      corruptRecordErrors: [],
      error: 'IndexedDB is unavailable in this environment.',
    };
  }
  const deletedIds = getDeletedProjectIds();
  return new Promise((resolve) => {
    let settled = false;
    const finish = (res: IndexedDbLoadResult) => {
      if (settled) return;
      settled = true;
      resolve(res);
    };
    const failRead = (db: IDBDatabase | null, error: string) => {
      if (db) {
        try {
          db.close();
        } catch {
          // Ignore close error
        }
      }
      finish({
        ok: false,
        status: 'read_error',
        projects: [],
        corruptRecordCount: 0,
        corruptRecordErrors: [],
        error,
      });
    };

    try {
      const req = window.indexedDB.open(IDB_NAME, 1);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains(IDB_STORE)) {
          db.createObjectStore(IDB_STORE, { keyPath: 'id' });
        }
      };
      req.onsuccess = () => {
        const db = req.result;
        try {
          const tx = db.transaction(IDB_STORE, 'readonly');
          const store = tx.objectStore(IDB_STORE);
          const allReq = store.getAll();
          allReq.onsuccess = () => {
            const rawList = Array.isArray(allReq.result) ? allReq.result : [];
            const migrated: CreativeProject[] = [];
            let corruptRecordCount = 0;
            const corruptRecordErrors: string[] = [];

            for (const item of rawList) {
              try {
                const p = migrateProjectPayload(item);
                if (!deletedIds.has(p.id)) {
                  migrated.push(p);
                }
              } catch (migErr) {
                corruptRecordCount += 1;
                corruptRecordErrors.push(
                  migErr instanceof Error ? migErr.message : 'Corrupt or unsupported project record.'
                );
              }
            }
            try {
              db.close();
            } catch {
              // Ignore close error
            }
            const sorted = migrated.sort((a, b) => b.updatedAt - a.updatedAt);
            const unreadable = sorted.length === 0 && corruptRecordCount > 0;
            finish({
              ok: !unreadable,
              status: unreadable ? 'read_error' : sorted.length > 0 ? 'ok' : 'empty',
              projects: sorted,
              corruptRecordCount,
              corruptRecordErrors,
              ...(unreadable ? { error: 'No IndexedDB project could be read. Existing records were preserved.' } : {}),
            });
          };
          allReq.onerror = () =>
            failRead(
              db,
              allReq.error?.message ?? tx.error?.message ?? 'IndexedDB getAll read failed.'
            );
          tx.onerror = () => failRead(db, tx.error?.message ?? 'IndexedDB read transaction failed.');
          tx.onabort = () =>
            failRead(db, tx.error?.message ?? 'IndexedDB read transaction aborted.');
        } catch (txErr) {
          failRead(
            db,
            txErr instanceof Error ? txErr.message : 'IndexedDB read transaction exception.'
          );
        }
      };
      req.onerror = () => failRead(null, req.error?.message ?? 'Failed to open IndexedDB for reading.');
    } catch (err) {
      failRead(null, err instanceof Error ? err.message : 'IndexedDB read exception.');
    }
  });
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
    const cached = saveProjectToLocalStorage(chosenActive, { expectedBaseProject: observedCache ?? null, forceOverwrite: true });
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
