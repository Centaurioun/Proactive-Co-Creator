/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { getDeletedProjectIds, type IndexedDbLoadStatus } from '../storageEngine.ts';
import type { CreativeProject } from '../../shared/types.ts';

/**
 * Merges a project version into `savedProjects` without ever regressing a newer
 * in-memory revision or resurrecting a deleted project.
 */
export function upsertProjectInSavedList(
  savedProjects: CreativeProject[],
  candidate: CreativeProject
): CreativeProject[] {
  const deletedIds = getDeletedProjectIds();
  const filtered = savedProjects.filter((p) => !deletedIds.has(p.id));
  if (deletedIds.has(candidate.id)) {
    return filtered;
  }

  const idx = filtered.findIndex((p) => p.id === candidate.id);
  if (idx === -1) {
    return [candidate, ...filtered];
  }

  const existing = filtered[idx];
  const candidateRev = candidate.revision ?? 1;
  const existingRev = existing.revision ?? 1;
  const maxPersisted = Math.max(
    candidate.persistedRevision ?? 0,
    existing.persistedRevision ?? 0
  );
  const resolvedPersisted = maxPersisted > 0 ? maxPersisted : undefined;

  let merged: CreativeProject;
  if (candidateRev > existingRev) {
    merged = { ...candidate, persistedRevision: resolvedPersisted };
  } else if (candidateRev < existingRev) {
    merged = { ...existing, persistedRevision: resolvedPersisted };
  } else if (candidate.updatedAt >= existing.updatedAt) {
    merged = { ...candidate, persistedRevision: resolvedPersisted };
  } else {
    merged = { ...existing, persistedRevision: resolvedPersisted };
  }

  const next = [...filtered];
  next[idx] = merged;
  return next;
}

/**
 * Prepares a safe project switch (e.g., A -> B) when the current project may have
 * unpersisted in-memory edits or a pending debounced autosave timer:
 * - Synchronously commits the latest in-memory `currentProject` into `savedProjects`
 *   so switching back B -> A never reads a stale revision.
 * - Flags `projectToFlush` whenever `currentProject` has unpersisted edits so the
 *   caller flushes the durable save immediately rather than discarding it on timer cleanup.
 */
export function prepareProjectSwitch(params: {
  currentProject: CreativeProject;
  savedProjects: CreativeProject[];
  targetProjectId: string;
}): {
  savedProjects: CreativeProject[];
  targetProject: CreativeProject | null;
  projectToFlush: CreativeProject | null;
} {
  const { currentProject, savedProjects, targetProjectId } = params;
  const deletedIds = getDeletedProjectIds();
  const nextSaved = upsertProjectInSavedList(savedProjects, currentProject);
  const targetProject = nextSaved.find((p) => p.id === targetProjectId) ?? null;

  const isDirty =
    currentProject.persistedRevision === undefined ||
    (currentProject.revision ?? 1) > currentProject.persistedRevision;
  const projectToFlush =
    !deletedIds.has(currentProject.id) &&
    currentProject.id !== targetProjectId &&
    isDirty
      ? currentProject
      : null;

  return {
    savedProjects: nextSaved,
    targetProject,
    projectToFlush,
  };
}

/**
 * Reconciles an asynchronous durable-save acknowledgement without ever overwriting
 * newer in-memory revisions of either `currentActiveProject` or `savedProjects`.
 */
export function reconcileAsyncSaveAcknowledgement(params: {
  acknowledgedProject: CreativeProject;
  acknowledgedRevision: number;
  currentActiveProject: CreativeProject;
  savedProjects: CreativeProject[];
}): {
  activeProject: CreativeProject;
  savedProjects: CreativeProject[];
} {
  const {
    acknowledgedProject,
    acknowledgedRevision,
    currentActiveProject,
    savedProjects,
  } = params;

  const syncedProject: CreativeProject = {
    ...acknowledgedProject,
    persistedRevision: Math.max(
      acknowledgedProject.persistedRevision ?? 0,
      acknowledgedRevision
    ),
  };

  const nextSaved = upsertProjectInSavedList(savedProjects, syncedProject);

  let nextActive = currentActiveProject;
  if (currentActiveProject.id === acknowledgedProject.id) {
    const nextPersisted = Math.max(
      currentActiveProject.persistedRevision ?? 0,
      acknowledgedRevision
    );
    if (currentActiveProject.persistedRevision !== nextPersisted) {
      nextActive = {
        ...currentActiveProject,
        persistedRevision: nextPersisted,
      };
    }
  }

  return {
    activeProject: nextActive,
    savedProjects: nextSaved,
  };
}

export type HydrationWriteGate =
  | 'pending'
  | 'ready'
  | 'unavailable'
  | 'blocked-read-error';

export function resolveHydrationWriteGate(status: IndexedDbLoadStatus): HydrationWriteGate {
  if (status === 'ok' || status === 'empty') {
    return 'ready';
  }
  if (status === 'unavailable') {
    return 'unavailable';
  }
  return 'blocked-read-error';
}

export function shouldAllowUnsolicitedPersistence(params: {
  hydrationGate: HydrationWriteGate;
  hasLocalEditsSinceMount: boolean;
  isDeleted: boolean;
  storageAlertType?: 'conflict' | 'quota' | 'error' | null;
  storageAlertProjectId?: string | null;
  activeProjectId: string;
}): boolean {
  if (params.isDeleted) {
    return false;
  }
  if (
    params.storageAlertType === 'conflict' &&
    params.storageAlertProjectId === params.activeProjectId
  ) {
    return false;
  }
  if (params.hydrationGate === 'blocked-read-error') {
    return false;
  }
  if (params.hydrationGate === 'pending' && !params.hasLocalEditsSinceMount) {
    return false;
  }
  return true;
}
