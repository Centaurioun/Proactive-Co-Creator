/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { createSampleProject } from '../canonicalModel.ts';
import { createUndoRedoState, type UndoRedoState } from '../historyEngine.ts';
import type { CreativeProject } from '../../shared/types.ts';
import type {
  DurableWriteOptions,
  IndexedDbLoadResult,
  IndexedDbLoadStatus,
  StorageSaveResult,
} from './constants.ts';
import { matchesObservedProject } from './casPolicy.ts';
import { planStorageReload, upsertReloadedProject } from './hydrationReconciliation.ts';
import { getDeletedProjectIds } from './tombstoneRegistry.ts';

export interface ReloadLatestProjectsOptions {
  resolution?: 'prefer-idb' | 'prefer-local';
  inMemoryActiveProject?: CreativeProject;
  hasLocalEditsSinceMount?: boolean;
  observedConflictProject?: CreativeProject;
  isCurrent?: () => boolean;
  commit?: (project: CreativeProject, options: DurableWriteOptions) => Promise<StorageSaveResult>;
}

export interface ReloadLatestProjectsResult {
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
}

export interface ReloadCoordinatorDeps {
  loadLocalProjects: () => { projects: CreativeProject[]; activeProjectId: string | null };
  loadIdbProjectsDetailed: () => Promise<IndexedDbLoadResult>;
  saveToIndexedDb: (project: CreativeProject, options: DurableWriteOptions) => Promise<StorageSaveResult>;
  saveToLocalStorage: (project: CreativeProject, options: DurableWriteOptions) => StorageSaveResult;
}

function buildConflictResult(params: {
  finalProjects: CreativeProject[];
  fallbackActive: CreativeProject;
  idbStatus: IndexedDbLoadStatus;
  corruptRecordCount?: number;
  current: CreativeProject | undefined;
  warning: string;
}): ReloadLatestProjectsResult {
  const { finalProjects, fallbackActive, idbStatus, corruptRecordCount, current, warning } = params;
  return {
    projects: finalProjects,
    activeProject: fallbackActive,
    activeUndoState: createUndoRedoState(
      fallbackActive.snapshot,
      fallbackActive.revisions,
      fallbackActive.undoHistory
    ),
    upgradedFromIndexedDb: false,
    idbStatus,
    corruptRecordCount,
    conflictDetected: true,
    conflictProject: current ?? null,
    alternateProject: fallbackActive,
    persisted: false,
    persistenceWarning: warning,
  };
}

function buildEffectiveLocalProjects(
  localProjects: CreativeProject[],
  inMemoryActive: CreativeProject | undefined,
  hasUnsyncedMemoryEdits: boolean,
  deletedSet: ReadonlySet<string>
): CreativeProject[] {
  const effective = localProjects.filter((p) => !deletedSet.has(p.id));
  if (hasUnsyncedMemoryEdits && inMemoryActive && !deletedSet.has(inMemoryActive.id)) {
    const existingIdx = effective.findIndex((p) => p.id === inMemoryActive.id);
    if (existingIdx >= 0) {
      effective[existingIdx] = inMemoryActive;
    } else {
      effective.unshift(inMemoryActive);
    }
  }
  return effective;
}

function buildReadErrorResult(
  effectiveLocalProjects: CreativeProject[],
  targetId: string | null | undefined,
  idbLoad: IndexedDbLoadResult
): ReloadLatestProjectsResult {
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

function buildHydrationConflictResult(
  savedProjects: CreativeProject[],
  preservedLocal: CreativeProject,
  conflictWithHydrated: CreativeProject,
  idbLoad: IndexedDbLoadResult
): ReloadLatestProjectsResult {
  return {
    projects: savedProjects,
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
    conflictProject: conflictWithHydrated,
    alternateProject: preservedLocal,
    persisted: false,
  };
}

async function commitReloadPersistence(params: {
  deps: ReloadCoordinatorDeps;
  options: ReloadLatestProjectsOptions | undefined;
  idbStatus: IndexedDbLoadStatus;
  localMatch: CreativeProject | undefined;
  idbMatch: CreativeProject | undefined;
  observedCache: CreativeProject | undefined;
  chosenActive: CreativeProject;
  persisted: boolean;
  makeConflict: (current: CreativeProject | undefined, warning: string) => ReloadLatestProjectsResult;
}): Promise<{
  conflictResult?: ReloadLatestProjectsResult;
  chosenActive: CreativeProject;
  persisted: boolean;
  cacheAlreadySynced: boolean;
}> {
  const { deps, options, idbStatus, localMatch, idbMatch, observedCache, makeConflict } = params;
  let { chosenActive, persisted } = params;
  let cacheAlreadySynced = false;

  if (idbStatus === 'unavailable') {
    persisted = Boolean(observedCache && matchesObservedProject(observedCache, chosenActive));
    if (
      options?.resolution === 'prefer-local' &&
      options.observedConflictProject &&
      !chosenActive.narrative
    ) {
      const base = options.observedConflictProject;
      chosenActive = {
        ...chosenActive,
        revision: Math.max(chosenActive.revision, base.revision) + 1,
      };
      const saved = deps.saveToLocalStorage(chosenActive, { expectedBaseProject: base });
      if (!saved.saved) {
        return {
          conflictResult: makeConflict(
            saved.storedProject ?? observedCache,
            saved.error ?? 'The conflict resolution could not be saved.'
          ),
          chosenActive,
          persisted,
          cacheAlreadySynced,
        };
      }
      chosenActive = { ...chosenActive, persistedRevision: saved.persistedRevision };
      persisted = true;
    }
    return { chosenActive, persisted, cacheAlreadySynced };
  }

  if (options?.resolution === 'prefer-local' && localMatch && !persisted) {
    chosenActive = {
      ...localMatch,
      revision: Math.max(localMatch.revision, idbMatch?.revision ?? 0) + 1,
      updatedAt: Math.max(Date.now(), localMatch.updatedAt, idbMatch?.updatedAt ?? 0),
    };
    const result = await (options.commit ?? deps.saveToIndexedDb)(chosenActive, {
      expectedBaseProject: idbMatch ?? null,
      expectedPersistedRevision: idbMatch?.revision,
    });
    if (options.isCurrent?.() === false) {
      return {
        conflictResult: makeConflict(idbMatch, 'The active project changed while reloading.'),
        chosenActive,
        persisted,
        cacheAlreadySynced,
      };
    }
    if (!result.saved) {
      return {
        conflictResult: makeConflict(
          result.storedProject ?? idbMatch,
          result.error ?? 'The conflict resolution could not be saved.'
        ),
        chosenActive,
        persisted,
        cacheAlreadySynced,
      };
    }
    chosenActive = result.storedProject ?? {
      ...chosenActive,
      persistedRevision: result.persistedRevision,
    };
    persisted = true;
    cacheAlreadySynced = Boolean(result.cacheSynced);
  }

  const requiresSynchronization = !idbMatch || idbMatch.revision < chosenActive.revision;
  if (requiresSynchronization && !options?.resolution && options?.commit) {
    const initialized = await options.commit(chosenActive, {
      expectedBaseProject: idbMatch ?? null,
      expectedPersistedRevision: idbMatch?.revision,
    });
    if (options.isCurrent?.() === false) {
      return {
        conflictResult: makeConflict(idbMatch, 'The active project changed while reloading.'),
        chosenActive,
        persisted,
        cacheAlreadySynced,
      };
    }
    if (!initialized.saved) {
      return {
        conflictResult: {
          ...makeConflict(
            initialized.storedProject,
            initialized.error ?? 'Could not initialize durable storage.'
          ),
          idbStatus: 'read_error' as const,
          idbError: initialized.error,
        },
        chosenActive,
        persisted,
        cacheAlreadySynced,
      };
    }
    chosenActive = initialized.storedProject ?? {
      ...chosenActive,
      persistedRevision: initialized.persistedRevision,
    };
    persisted = true;
    cacheAlreadySynced = Boolean(initialized.cacheSynced);
  }

  return { chosenActive, persisted, cacheAlreadySynced };
}

export async function coordinateStorageReload(
  deps: ReloadCoordinatorDeps,
  preferredActiveProjectId?: string | null,
  options?: ReloadLatestProjectsOptions
): Promise<ReloadLatestProjectsResult> {
  const localData = deps.loadLocalProjects();
  const idbLoad = await deps.loadIdbProjectsDetailed();
  const deletedSet = getDeletedProjectIds();

  const inMemoryActive = options?.inMemoryActiveProject;
  const hasUnsyncedMemoryEdits = Boolean(options?.hasLocalEditsSinceMount && inMemoryActive);
  const effectiveLocalProjects = buildEffectiveLocalProjects(
    localData.projects,
    inMemoryActive,
    hasUnsyncedMemoryEdits,
    deletedSet
  );
  const idbProjects = idbLoad.projects.filter((p) => !deletedSet.has(p.id));
  const targetId = preferredActiveProjectId ?? inMemoryActive?.id ?? localData.activeProjectId;

  if (idbLoad.status === 'read_error') {
    return buildReadErrorResult(effectiveLocalProjects, targetId, idbLoad);
  }

  const activeMemory =
    hasUnsyncedMemoryEdits && inMemoryActive && !deletedSet.has(inMemoryActive.id)
      ? inMemoryActive
      : undefined;
  const { reconciled, localMatch, idbMatch, chosen } = planStorageReload({
    localProjects: effectiveLocalProjects,
    idbProjects,
    targetId,
    inMemoryActive: activeMemory,
    resolution: options?.resolution,
    deletedSet,
  });
  const observedCache = localData.projects.find((project) => project.id === chosen.id);

  if (reconciled.conflictWithHydrated && !options?.resolution) {
    return buildHydrationConflictResult(
      reconciled.savedProjects,
      localMatch ?? reconciled.activeProject,
      reconciled.conflictWithHydrated,
      idbLoad
    );
  }

  const finalProjects = upsertReloadedProject(reconciled.savedProjects, chosen);
  const makeConflict = (current: CreativeProject | undefined, warning: string) =>
    buildConflictResult({
      finalProjects,
      fallbackActive: localMatch ?? chosen,
      idbStatus: idbLoad.status,
      corruptRecordCount: idbLoad.corruptRecordCount,
      current,
      warning,
    });

  if (
    options?.observedConflictProject &&
    !matchesObservedProject(
      idbLoad.status === 'unavailable' ? observedCache : idbMatch,
      options.observedConflictProject
    )
  ) {
    return makeConflict(
      idbMatch ?? observedCache,
      'Storage changed since this conflict was shown. Review the latest versions.'
    );
  }
  if (options?.isCurrent?.() === false) {
    return makeConflict(idbMatch, 'The active project changed while reloading.');
  }

  const commitOutcome = await commitReloadPersistence({
    deps,
    options,
    idbStatus: idbLoad.status,
    localMatch,
    idbMatch,
    observedCache,
    chosenActive: chosen,
    persisted: Boolean(idbMatch && matchesObservedProject(idbMatch, chosen)),
    makeConflict,
  });
  if (commitOutcome.conflictResult) {
    return commitOutcome.conflictResult;
  }

  const { chosenActive, persisted, cacheAlreadySynced } = commitOutcome;
  let persistenceWarning: string | undefined;
  const shouldUpdateCache =
    idbLoad.status !== 'unavailable' &&
    persisted &&
    !cacheAlreadySynced &&
    !matchesObservedProject(observedCache, chosenActive) &&
    options?.isCurrent?.() !== false;
  if (shouldUpdateCache) {
    const cached = deps.saveToLocalStorage(chosenActive, {
      expectedBaseProject: observedCache ?? null,
      forceOverwrite: true,
      selectProject: false,
    });
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
