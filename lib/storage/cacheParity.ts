/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { isSnapshotSemanticallyEqual } from '../historyEngine.ts';
import type {
  CreativeProject,
  GenerationArtifact,
  PersistedUndoHistoryEntry,
} from '../../shared/types.ts';

export function isAutoSeededUntouchedSample(project: CreativeProject): boolean {
  return (
    project.id === 'proj_default_cat_party' &&
    (project.revision ?? 1) === 1 &&
    project.revisions.length <= 1 &&
    project.artifacts.length === 0
  );
}

export function hasRevisionLineage(newer: CreativeProject, older: CreativeProject): boolean {
  const olderRev = older.revision ?? 1;
  if (olderRev <= 1 && older.revisions.length <= 1) {
    return true;
  }
  const olderHeadId = older.revisions[0]?.id;
  if (olderHeadId && newer.revisions.some((r) => r.id === olderHeadId)) {
    return true;
  }
  return newer.revisions.some(
    (r) =>
      r.revisionNumber === olderRev &&
      isSnapshotSemanticallyEqual(r.snapshot, older.snapshot)
  );
}

function areStringArraysExactEqual(a?: string[], b?: string[]): boolean {
  const listA = Array.isArray(a) ? a : [];
  const listB = Array.isArray(b) ? b : [];
  if (listA.length !== listB.length) return false;
  for (let i = 0; i < listA.length; i++) {
    if (listA[i] !== listB[i]) return false;
  }
  return true;
}

function areArtifactsContentEqual(
  localArt: GenerationArtifact,
  idbArt: GenerationArtifact,
  requireSameOutdated: boolean
): boolean {
  if (localArt.id !== idbArt.id) return false;
  if (localArt.mode !== idbArt.mode) return false;
  if (localArt.revisionId !== idbArt.revisionId) return false;
  if ((localArt.sourceRevision ?? null) !== (idbArt.sourceRevision ?? null)) return false;
  if (localArt.promptUsed !== idbArt.promptUsed) return false;
  if ((localArt.promptDigest ?? null) !== (idbArt.promptDigest ?? null)) return false;
  if ((localArt.storyText ?? null) !== (idbArt.storyText ?? null)) return false;
  if ((localArt.warning ?? null) !== (idbArt.warning ?? null)) return false;
  if (!areStringArraysExactEqual(localArt.images, idbArt.images)) return false;
  if (requireSameOutdated && Boolean(localArt.isOutdated) !== Boolean(idbArt.isOutdated)) {
    return false;
  }
  return true;
}

function areUndoEntriesEqual(
  a: PersistedUndoHistoryEntry[] = [],
  b: PersistedUndoHistoryEntry[] = []
): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (a[i].label !== b[i].label) return false;
    if (!isSnapshotSemanticallyEqual(a[i].snapshot, b[i].snapshot)) return false;
  }
  return true;
}

function verifyArtifactsParity(
  localArtifacts: GenerationArtifact[],
  idbArtifacts: GenerationArtifact[],
  sameRevision: boolean
): boolean {
  if (sameRevision && localArtifacts.length !== idbArtifacts.length) {
    return false;
  }
  for (const localArt of localArtifacts) {
    const idbArt = idbArtifacts.find((candidate) => candidate.id === localArt.id);
    if (!idbArt || !areArtifactsContentEqual(localArt, idbArt, sameRevision)) {
      return false;
    }
  }
  return true;
}

function verifyRevisionsParity(
  localRevs: CreativeProject['revisions'],
  idbRevs: CreativeProject['revisions'],
  sameRevision: boolean
): boolean {
  if (sameRevision && localRevs.length !== idbRevs.length) {
    return false;
  }
  for (const localRevEntry of localRevs) {
    const idbRevEntry = idbRevs.find((candidate) => candidate.id === localRevEntry.id);
    if (!idbRevEntry) return false;
    if ((localRevEntry.revisionNumber ?? null) !== (idbRevEntry.revisionNumber ?? null)) {
      return false;
    }
    if (localRevEntry.label !== idbRevEntry.label) return false;
    if (localRevEntry.summary !== idbRevEntry.summary) return false;
    if (localRevEntry.changeCount !== idbRevEntry.changeCount) return false;
    if ((localRevEntry.coalesceKey ?? null) !== (idbRevEntry.coalesceKey ?? null)) return false;
    if (!isSnapshotSemanticallyEqual(localRevEntry.snapshot, idbRevEntry.snapshot)) {
      return false;
    }
  }
  return true;
}

function verifyUndoHistoryParity(
  localProject: CreativeProject,
  idbProject: CreativeProject,
  idbRevs: CreativeProject['revisions'],
  sameRevision: boolean
): boolean {
  const localPast = localProject.undoHistory?.past ?? [];
  const localFuture = localProject.undoHistory?.future ?? [];
  const idbPast = idbProject.undoHistory?.past ?? [];
  const idbFuture = idbProject.undoHistory?.future ?? [];

  if (sameRevision) {
    return areUndoEntriesEqual(localPast, idbPast) && areUndoEntriesEqual(localFuture, idbFuture);
  }

  for (const pastEntry of localPast) {
    const recoveredInPastOrRevs =
      idbPast.some(
        (candidate) =>
          candidate.label === pastEntry.label &&
          isSnapshotSemanticallyEqual(candidate.snapshot, pastEntry.snapshot)
      ) ||
      idbRevs.some((revEntry) =>
        isSnapshotSemanticallyEqual(revEntry.snapshot, pastEntry.snapshot)
      );
    if (!recoveredInPastOrRevs) return false;
  }
  for (const futureEntry of localFuture) {
    const recoveredInFutureOrRevs =
      idbFuture.some(
        (candidate) =>
          candidate.label === futureEntry.label &&
          isSnapshotSemanticallyEqual(candidate.snapshot, futureEntry.snapshot)
      ) ||
      idbRevs.some((revEntry) =>
        isSnapshotSemanticallyEqual(revEntry.snapshot, futureEntry.snapshot)
      ) ||
      isSnapshotSemanticallyEqual(idbProject.snapshot, futureEntry.snapshot);
    if (!recoveredInFutureOrRevs) return false;
  }
  return true;
}

/**
 * Verifies strict full-content parity before local cache compaction or eviction (T4 / ST-04..ST-08).
 * Compares identity, name, snapshot / lineage, every artifact's payload & images, every revision
 * snapshot, and persisted Undo/Redo stacks. Fails closed on any mismatch.
 */
export function verifyProjectCacheParity(
  localProject: CreativeProject,
  idbProject: CreativeProject
): boolean {
  if (!localProject || !idbProject) return false;
  if (localProject.id !== idbProject.id) return false;
  if ((localProject.name ?? '') !== (idbProject.name ?? '')) return false;
  if (JSON.stringify(localProject.narrative) !== JSON.stringify(idbProject.narrative)) return false;

  const localRev = localProject.revision ?? 1;
  const idbRev = idbProject.revision ?? 1;
  if (idbRev < localRev) return false;

  const sameRevision = idbRev === localRev;
  if (sameRevision) {
    if (!isSnapshotSemanticallyEqual(localProject.snapshot, idbProject.snapshot)) {
      return false;
    }
  } else if (!hasRevisionLineage(idbProject, localProject)) {
    return false;
  }

  const localArtifacts = Array.isArray(localProject.artifacts) ? localProject.artifacts : [];
  const idbArtifacts = Array.isArray(idbProject.artifacts) ? idbProject.artifacts : [];
  if (!verifyArtifactsParity(localArtifacts, idbArtifacts, sameRevision)) {
    return false;
  }

  const localRevs = Array.isArray(localProject.revisions) ? localProject.revisions : [];
  const idbRevs = Array.isArray(idbProject.revisions) ? idbProject.revisions : [];
  if (!verifyRevisionsParity(localRevs, idbRevs, sameRevision)) {
    return false;
  }

  return verifyUndoHistoryParity(localProject, idbProject, idbRevs, sameRevision);
}
