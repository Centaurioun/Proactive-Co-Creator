/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import {
  createUndoRedoState,
  isSnapshotSemanticallyEqual,
  type UndoRedoState,
} from '../historyEngine.ts';
import type { CreativeProject } from '../../shared/types.ts';
import { hasRevisionLineage, isAutoSeededUntouchedSample } from './cacheParity.ts';

function ensureUndoStateFromProject(
  project: CreativeProject,
  currentUndo: UndoRedoState
): UndoRedoState {
  if (
    currentUndo.past.length === 0 &&
    currentUndo.future.length === 0 &&
    (project.revisions.length > 1 || Boolean(project.undoHistory))
  ) {
    return createUndoRedoState(project.snapshot, project.revisions, project.undoHistory);
  }
  return currentUndo;
}

function chooseEqualRevisionWinner(
  localProject: CreativeProject,
  idbProject: CreativeProject
): CreativeProject {
  const preferIdb =
    idbProject.artifacts.length > localProject.artifacts.length ||
    idbProject.revisions.length > localProject.revisions.length ||
    Boolean(idbProject.undoHistory && !localProject.undoHistory) ||
    idbProject.updatedAt >= localProject.updatedAt;
  return preferIdb ? idbProject : localProject;
}

function mergeLocalAndIdbProjects(params: {
  validLocal: CreativeProject[];
  validIdb: CreativeProject[];
  localWasOnlyAutoSample: boolean;
  ignoreDivergenceConflict: boolean;
}): {
  mergedById: Map<string, CreativeProject>;
  divergenceConflictsById: Map<string, CreativeProject>;
} {
  const { validLocal, validIdb, localWasOnlyAutoSample, ignoreDivergenceConflict } = params;
  const mergedById = new Map<string, CreativeProject>();
  if (!localWasOnlyAutoSample) {
    for (const lp of validLocal) {
      mergedById.set(lp.id, lp);
    }
  }

  const divergenceConflictsById = new Map<string, CreativeProject>();

  for (const ip of validIdb) {
    const normalizedIp: CreativeProject = {
      ...ip,
      persistedRevision: ip.persistedRevision ?? ip.revision,
    };
    const lp = mergedById.get(ip.id);
    if (!lp) {
      mergedById.set(ip.id, normalizedIp);
      continue;
    }

    const idbRev = ip.revision ?? 1;
    const localRev = lp.revision ?? 1;

    if (idbRev > localRev) {
      if (!ignoreDivergenceConflict && !hasRevisionLineage(ip, lp)) {
        divergenceConflictsById.set(ip.id, normalizedIp);
      } else {
        mergedById.set(ip.id, normalizedIp);
      }
    } else if (idbRev === localRev) {
      const sameSnapshot =
        isSnapshotSemanticallyEqual(lp.snapshot, ip.snapshot) &&
        JSON.stringify(lp.narrative) === JSON.stringify(ip.narrative);
      if (!sameSnapshot && !ignoreDivergenceConflict) {
        divergenceConflictsById.set(ip.id, normalizedIp);
      } else {
        const winner = chooseEqualRevisionWinner(lp, normalizedIp);
        mergedById.set(ip.id, {
          ...winner,
          undoHistory: winner.undoHistory ?? ip.undoHistory ?? lp.undoHistory,
          persistedRevision: Math.max(
            ip.persistedRevision ?? idbRev,
            lp.persistedRevision ?? localRev
          ),
        });
      }
    } else {
      if (!ignoreDivergenceConflict && !hasRevisionLineage(lp, ip)) {
        divergenceConflictsById.set(lp.id, normalizedIp);
      }
      mergedById.set(lp.id, {
        ...lp,
        persistedRevision: Math.max(
          lp.persistedRevision ?? localRev,
          ip.persistedRevision ?? idbRev
        ),
      });
    }
  }

  return { mergedById, divergenceConflictsById };
}

/**
 * Pure reconciliation of initial localStorage projects with asynchronous IndexedDB hydration
 * (F-02, IA-04, IA-05). Callers pass the authoritative deleted-ID set from storageEngine.
 */
export function reconcileHydratedProjectsCore(params: {
  localProjects: CreativeProject[];
  idbProjects: CreativeProject[];
  activeProject: CreativeProject;
  activeUndoState: UndoRedoState;
  deletedSet: ReadonlySet<string>;
  hasLocalEditsSinceMount?: boolean;
  localWasAutoSeededSample?: boolean;
  ignoreDivergenceConflict?: boolean;
}): {
  savedProjects: CreativeProject[];
  activeProject: CreativeProject;
  activeUndoState: UndoRedoState;
  upgradedFromIndexedDb: boolean;
  conflictWithHydrated: CreativeProject | null;
} {
  const {
    localProjects,
    idbProjects,
    activeProject,
    activeUndoState,
    deletedSet,
    hasLocalEditsSinceMount = false,
    localWasAutoSeededSample = false,
    ignoreDivergenceConflict = false,
  } = params;

  const validLocal = localProjects.filter((p) => !deletedSet.has(p.id));
  const validIdb = idbProjects.filter((p) => !deletedSet.has(p.id));

  if (validIdb.length === 0) {
    return {
      savedProjects: validLocal,
      activeProject,
      activeUndoState: ensureUndoStateFromProject(activeProject, activeUndoState),
      upgradedFromIndexedDb: false,
      conflictWithHydrated: null,
    };
  }

  const localWasOnlyAutoSample =
    !hasLocalEditsSinceMount &&
    validLocal.length === 1 &&
    isAutoSeededUntouchedSample(validLocal[0]) &&
    (localWasAutoSeededSample || !validIdb.some((ip) => ip.id === validLocal[0].id));

  const { mergedById, divergenceConflictsById } = mergeLocalAndIdbProjects({
    validLocal,
    validIdb,
    localWasOnlyAutoSample,
    ignoreDivergenceConflict,
  });

  const savedProjects = Array.from(mergedById.values()).sort((a, b) => b.updatedAt - a.updatedAt);

  const idbMatch = validIdb.find((ip) => ip.id === activeProject.id);
  const localMatch = validLocal.find((lp) => lp.id === activeProject.id);
  const reconciledActiveCandidate = mergedById.get(activeProject.id);

  if (!reconciledActiveCandidate) {
    const fallback = savedProjects[0] ?? activeProject;
    return {
      savedProjects,
      activeProject: fallback,
      activeUndoState: createUndoRedoState(
        fallback.snapshot,
        fallback.revisions,
        fallback.undoHistory
      ),
      upgradedFromIndexedDb: true,
      conflictWithHydrated: null,
    };
  }

  const idbRev = idbMatch?.revision ?? 0;
  const activeRev = activeProject.revision ?? 1;
  const basePersistedRev = activeProject.persistedRevision ?? 1;

  if (hasLocalEditsSinceMount) {
    const idbDivergedFromBase =
      Boolean(idbMatch) &&
      (idbRev > basePersistedRev ||
        (idbRev === basePersistedRev &&
          localMatch !== undefined &&
          !isSnapshotSemanticallyEqual(idbMatch!.snapshot, localMatch.snapshot)));

    if (idbDivergedFromBase && idbMatch) {
      return {
        savedProjects,
        activeProject,
        activeUndoState,
        upgradedFromIndexedDb: false,
        conflictWithHydrated: idbMatch,
      };
    }
    return {
      savedProjects: savedProjects.map((p) => (p.id === activeProject.id ? activeProject : p)),
      activeProject,
      activeUndoState,
      upgradedFromIndexedDb: false,
      conflictWithHydrated: null,
    };
  }

  const divergenceConflict = divergenceConflictsById.get(activeProject.id) ?? null;
  if (divergenceConflict) {
    return {
      savedProjects,
      activeProject,
      activeUndoState: ensureUndoStateFromProject(activeProject, activeUndoState),
      upgradedFromIndexedDb: false,
      conflictWithHydrated: divergenceConflict,
    };
  }

  const upgradedFromIndexedDb =
    Boolean(idbMatch) &&
    (localWasOnlyAutoSample ||
      idbRev > activeRev ||
      (idbRev === activeRev &&
        (idbMatch!.updatedAt > activeProject.updatedAt ||
          idbMatch!.artifacts.length > activeProject.artifacts.length ||
          idbMatch!.revisions.length > activeProject.revisions.length)));

  if (upgradedFromIndexedDb) {
    return {
      savedProjects,
      activeProject: reconciledActiveCandidate,
      activeUndoState: createUndoRedoState(
        reconciledActiveCandidate.snapshot,
        reconciledActiveCandidate.revisions,
        reconciledActiveCandidate.undoHistory
      ),
      upgradedFromIndexedDb: true,
      conflictWithHydrated: null,
    };
  }

  return {
    savedProjects,
    activeProject: reconciledActiveCandidate,
    activeUndoState: ensureUndoStateFromProject(reconciledActiveCandidate, activeUndoState),
    upgradedFromIndexedDb: false,
    conflictWithHydrated: null,
  };
}

/**
 * Pure authoritative source selector used by reloadLatestProjectsFromStorage
 * after conflict resolution or clean reconciliation.
 */
export function selectReloadActiveProject(params: {
  reconciledActive: CreativeProject;
  localMatch: CreativeProject | undefined;
  idbMatch: CreativeProject | undefined;
  resolution?: 'prefer-idb' | 'prefer-local';
}): CreativeProject {
  const { reconciledActive, localMatch, idbMatch, resolution } = params;
  if (!localMatch || !idbMatch) {
    return reconciledActive;
  }
  const idbRev = idbMatch.revision ?? 1;
  const localRev = localMatch.revision ?? 1;
  if (resolution === 'prefer-idb') {
    return { ...idbMatch, persistedRevision: idbRev };
  }
  if (resolution === 'prefer-local') {
    return { ...localMatch, persistedRevision: localRev };
  }
  if (idbRev > localRev) {
    return { ...idbMatch, persistedRevision: idbRev };
  }
  if (localRev > idbRev) {
    return { ...localMatch, persistedRevision: localRev };
  }
  const winner = chooseEqualRevisionWinner(localMatch, idbMatch);
  return {
    ...winner,
    undoHistory: winner.undoHistory ?? idbMatch.undoHistory ?? localMatch.undoHistory,
    persistedRevision: idbRev,
  };
}
