/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { getDeletedProjectIds, type IndexedDbLoadStatus } from '../storageEngine.ts';
import { areStableValuesEqual } from '../storage/casPolicy.ts';
import { isSnapshotSemanticallyEqual } from '../historyEngine.ts';
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
  const selected = candidateRev > existingRev ||
    (candidateRev === existingRev && candidate.updatedAt >= existing.updatedAt) ? candidate : existing;
  const other = selected === candidate ? existing : candidate;
  const sameRevisionDiverged = candidateRev === existingRev && !sameProjectVersion(candidate, existing);
  const inheritedRevision = sameRevisionDiverged ? 0 : other.persistedRevision ?? 0;
  const persistedRevision = Math.max(selected.persistedRevision ?? 0, inheritedRevision) || undefined;

  const next = [...filtered];
  next[idx] = { ...selected, persistedRevision };
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

export function sameProjectVersion(first: CreativeProject, second: CreativeProject): boolean {
  if (first === second) return true;
  return first.id === second.id && first.revision === second.revision &&
    first.name === second.name &&
    isSnapshotSemanticallyEqual(first.snapshot, second.snapshot) &&
    areStableValuesEqual(first.narrative, second.narrative) &&
    areStableValuesEqual(first.artifacts, second.artifacts) &&
    areStableValuesEqual(first.revisions, second.revisions) &&
    areStableValuesEqual(first.undoHistory, second.undoHistory);
}

function acknowledges(project: CreativeProject, committed: CreativeProject): boolean {
  if (project.id !== committed.id) return false;
  if (sameProjectVersion(project, committed)) return true;
  const committedHead = committed.revisions[0];
  return Boolean(project.revision > committed.revision && committedHead &&
    project.revisions.some(revision => revision.id === committedHead.id &&
      revision.revisionNumber === committed.revision &&
      isSnapshotSemanticallyEqual(revision.snapshot, committed.snapshot)));
}

/** Reconcile a durable acknowledgement against the projects that still own those edits. */
export function reconcileAsyncSaveAcknowledgement(params: {
  acknowledgedProject: CreativeProject;
  acknowledgedRevision: number;
  currentActiveProject: CreativeProject;
  savedProjects: CreativeProject[];
}): {
  activeProject: CreativeProject;
  savedProjects: CreativeProject[];
} {
  const { acknowledgedProject, acknowledgedRevision, currentActiveProject, savedProjects } = params;
  if (acknowledgedRevision !== acknowledgedProject.revision || getDeletedProjectIds().has(acknowledgedProject.id)) {
    return { activeProject: currentActiveProject, savedProjects };
  }
  const sync = (project: CreativeProject) =>
    (project.persistedRevision ?? 0) < acknowledgedRevision && acknowledges(project, acknowledgedProject)
      ? { ...project, persistedRevision: acknowledgedRevision }
      : project;
  const active = sync(currentActiveProject);
  const existing = savedProjects.find(project => project.id === acknowledgedProject.id);
  const baseline = active.id === acknowledgedProject.id && active.revision >= (existing?.revision ?? 0)
    ? active : existing;
  const durable = { ...acknowledgedProject, persistedRevision: acknowledgedRevision };
  const selected = baseline && baseline.revision >= acknowledgedRevision ? sync(baseline) : durable;
  const next = existing
    ? savedProjects.map(project => project.id === selected.id ? selected : project)
    : [selected, ...savedProjects];
  return { activeProject: active, savedProjects: next };
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
