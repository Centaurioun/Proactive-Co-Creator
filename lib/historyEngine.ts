/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { recordNarrativeChange } from './narrative/changeAudit.ts';
import { makeStableId } from './canonicalModel.ts';
import { areSnapshotsSemanticallyEqual } from './canonical/snapshotEquality.ts';
import type {
  Clarification,
  CreativeProject,
  DecisionItem,
  Entity,
  PersistedUndoHistory,
  ProjectRevision,
  ProjectSnapshot,
  Relationship,
} from '../shared/types.ts';

export interface UndoRedoEntry {
  id: string;
  label: string;
  timestamp: number;
  coalesceKey?: string;
  snapshot: ProjectSnapshot;
}

export interface UndoRedoState {
  past: UndoRedoEntry[];
  present: ProjectSnapshot;
  future: UndoRedoEntry[];
}

const MAX_UNDO_STACK = 40;
const MAX_REVISIONS = 25;

export function serializeUndoHistory(state: UndoRedoState): PersistedUndoHistory {
  return {
    past: state.past.slice(-MAX_UNDO_STACK).map((entry) => ({
      label: entry.label,
      snapshot: entry.snapshot,
    })),
    future: state.future.slice(0, MAX_UNDO_STACK).map((entry) => ({
      label: entry.label,
      snapshot: entry.snapshot,
    })),
  };
}

function reconstructFromPersistedHistory(
  initialSnapshot: ProjectSnapshot,
  persistedUndoHistory: PersistedUndoHistory
): UndoRedoState {
  const now = Date.now();
  return {
    past: persistedUndoHistory.past.slice(-MAX_UNDO_STACK).map((entry, idx) => ({
      id: makeStableId(`undo_${idx}`),
      label: entry.label || `Step ${idx + 1}`,
      timestamp: now,
      snapshot: structuredClone(entry.snapshot),
    })),
    present: structuredClone(initialSnapshot),
    future: persistedUndoHistory.future.slice(0, MAX_UNDO_STACK).map((entry, idx) => ({
      id: makeStableId(`redo_${idx}`),
      label: entry.label || `Redo ${idx + 1}`,
      timestamp: now,
      snapshot: structuredClone(entry.snapshot),
    })),
  };
}

function applyRevisionStep(state: UndoRedoState, rev: ProjectRevision, idx: number): UndoRedoState {
  const label = rev.label || `Revision #${rev.revisionNumber ?? idx}`;
  if (
    label.startsWith('Undo: ') &&
    state.past.length > 0 &&
    isSnapshotSemanticallyEqual(state.past[state.past.length - 1].snapshot, rev.snapshot)
  ) {
    return performUndo(state).state;
  }
  if (
    label.startsWith('Redo: ') &&
    state.future.length > 0 &&
    isSnapshotSemanticallyEqual(state.future[0].snapshot, rev.snapshot)
  ) {
    return performRedo(state).state;
  }
  return pushUndoableTransaction(state, rev.snapshot, label, rev.coalesceKey);
}

function reconstructFromRevisions(
  initialSnapshot: ProjectSnapshot,
  revisions: ProjectRevision[]
): UndoRedoState | null {
  const oldest = revisions[revisions.length - 1];
  if (!oldest?.snapshot) return null;

  let state: UndoRedoState = {
    past: [],
    present: structuredClone(oldest.snapshot),
    future: [],
  };
  for (let i = revisions.length - 2; i >= 0; i--) {
    const rev = revisions[i];
    if (rev?.snapshot) {
      state = applyRevisionStep(state, rev, i);
    }
  }
  return {
    past: state.past.slice(-MAX_UNDO_STACK),
    present: structuredClone(initialSnapshot),
    future: state.future.slice(0, MAX_UNDO_STACK),
  };
}

export function createUndoRedoState(
  initialSnapshot: ProjectSnapshot,
  revisions?: ProjectRevision[],
  persistedUndoHistory?: PersistedUndoHistory
): UndoRedoState {
  const hasPersisted =
    persistedUndoHistory &&
    Array.isArray(persistedUndoHistory.past) &&
    Array.isArray(persistedUndoHistory.future);
  if (hasPersisted) {
    return reconstructFromPersistedHistory(initialSnapshot, persistedUndoHistory);
  }

  if (Array.isArray(revisions) && revisions.length > 1) {
    const reconstructed = reconstructFromRevisions(initialSnapshot, revisions);
    if (reconstructed) return reconstructed;
  }

  return {
    past: [],
    present: structuredClone(initialSnapshot),
    future: [],
  };
}

export function createUndoRedoStateFromProject(project: CreativeProject): UndoRedoState {
  return createUndoRedoState(project.snapshot, project.revisions, project.undoHistory);
}

function normalizeEntityForComparison(e: Entity) {
  return {
    id: e.id,
    name: e.name,
    category: e.category,
    presence_in_prompt: Boolean(e.presence_in_prompt),
    description: e.description,
    alternatives: Array.isArray(e.alternatives) ? e.alternatives.map((c) => c.name) : null,
    excluded: Boolean(e.excluded),
    status: e.status,
    provenance: e.provenance,
    epistemicKind: e.epistemicKind,
    ...(e.sourceBacked ? { sourceBacked: true } : {}),
    groupId: e.groupId,
    aliases: e.aliases ?? [],
    attributes: e.attributes.map((a) => ({
      id: a.id,
      name: a.name,
      presence_in_prompt: Boolean(a.presence_in_prompt),
      confirmedValue: a.confirmedValue,
      status: a.status,
      provenance: a.provenance,
      epistemicKind: a.epistemicKind,
      ...(a.sourceBacked ? { sourceBacked: true } : {}),
      value: a.value.map((v) => v.name),
    })),
  };
}

function normalizeRelationshipForComparison(r: Relationship) {
  return {
    id: r.id,
    sourceId: r.sourceId,
    targetId: r.targetId,
    source: r.source,
    target: r.target,
    label: r.label,
    alternatives: Array.isArray(r.alternatives) ? r.alternatives.map((c) => c.name) : [],
    status: r.status,
    provenance: r.provenance,
    epistemicKind: r.epistemicKind,
    ...(r.sourceBacked ? { sourceBacked: true } : {}),
    presence_in_prompt: Boolean(r.presence_in_prompt),
    evidenceExcerpt: r.evidenceExcerpt,
  };
}

function normalizeClarificationForComparison(c: Clarification) {
  return {
    id: c.id,
    question: c.question,
    options: c.options ?? [],
    target: c.target
      ? {
          type: c.target.type,
          entityId: c.target.entityId,
          entityName: c.target.entityName,
          attributeName: c.target.attributeName,
          relationshipId: c.target.relationshipId,
          storyField: c.target.storyField,
        }
      : undefined,
    category: c.category,
    impact: c.impact,
    status: c.status,
    outdatedReason: c.outdatedReason,
  };
}

function normalizeDecisionForComparison(d: DecisionItem) {
  return {
    id: d.id,
    category: d.category,
    title: d.title,
    description: d.description,
    explanation: d.explanation,
    provenance: d.provenance,
    status: d.status,
    groupKey: d.groupKey,
    targetEntityId: d.targetEntityId,
    targetEntityName: d.targetEntityName,
    targetAttributeName: d.targetAttributeName,
    targetRelationshipId: d.targetRelationshipId,
    targetSourceEntityName: d.targetSourceEntityName,
    targetTargetEntityName: d.targetTargetEntityName,
    targetStoryField: d.targetStoryField,
    questionId: d.questionId,
    currentValue: d.currentValue,
    proposedValue: d.proposedValue,
    options: d.options ?? [],
    conflictWith: d.conflictWith,
  };
}

/**
 * Normalizes a ProjectSnapshot for semantic comparison, ignoring only ephemeral timestamps.
 */
export function normalizeSnapshotForComparison(snapshot: ProjectSnapshot): unknown {
  return {
    manuscriptVersionId: snapshot.manuscriptVersionId,
    originalIdea: snapshot.originalIdea,
    refinedPrompt: snapshot.refinedPrompt,
    freeformNotes: snapshot.freeformNotes,
    mode: snapshot.mode,
    entities: snapshot.entities.map(normalizeEntityForComparison),
    relationships: snapshot.relationships.map(normalizeRelationshipForComparison),
    storyBible: Object.fromEntries(
      Object.entries(snapshot.storyBible).map(([k, v]) => [
        k,
        {
          value: v.value,
          status: v.status,
          provenance: v.provenance,
          epistemicKind: v.epistemicKind,
          ...(v.sourceBacked ? { sourceBacked: true } : {}),
        },
      ])
    ),
    clarifications: snapshot.clarifications.map(normalizeClarificationForComparison),
    decisions: snapshot.decisions.map(normalizeDecisionForComparison),
    answeredQuestions: snapshot.answeredQuestions ?? [],
    skippedQuestions: snapshot.skippedQuestions ?? [],
  };
}

export function isSnapshotSemanticallyEqual(a: ProjectSnapshot, b: ProjectSnapshot): boolean {
  return areSnapshotsSemanticallyEqual(a, b);
}

/**
 * Deterministic lightweight digest of a normalized ProjectSnapshot for CAS exact-base validation.
 */
export function computeSnapshotDigest(snapshot: ProjectSnapshot): string {
  const serialized = JSON.stringify(normalizeSnapshotForComparison(snapshot));
  let h1 = 0x811c9dc5;
  let h2 = 0x811c9dc5;
  for (let i = 0; i < serialized.length; i += 1) {
    const code = serialized.charCodeAt(i);
    h1 ^= code;
    h1 = Math.imul(h1, 0x01000193) >>> 0;
    h2 ^= code ^ ((i + 1) & 0xff);
    h2 = Math.imul(h2, 0x01000193) >>> 0;
  }
  return `snap_${h1.toString(16).padStart(8, '0')}${h2.toString(16).padStart(8, '0')}`;
}

/**
 * Commits a new confirmed snapshot onto the Undo/Redo stack and invalidates any incompatible redo branch.
 */
export function pushUndoableTransaction(
  state: UndoRedoState,
  nextSnapshot: ProjectSnapshot,
  label: string,
  coalesceKey?: string
): UndoRedoState {
  if (isSnapshotSemanticallyEqual(state.present, nextSnapshot)) {
    return state;
  }

  const entry: UndoRedoEntry = {
    id: makeStableId('undo'),
    label,
    timestamp: Date.now(),
    coalesceKey,
    snapshot: structuredClone(state.present),
  };

  return {
    past: [...state.past, entry].slice(-MAX_UNDO_STACK),
    present: structuredClone(nextSnapshot),
    future: [],
  };
}

/**
 * Commits a transaction while coalescing rapid consecutive edits sharing the same coalesceKey.
 */
export function pushCoalescedTransaction(
  state: UndoRedoState,
  nextSnapshot: ProjectSnapshot,
  label: string,
  coalesceKey: string,
  windowMs: number = 1500
): { state: UndoRedoState; coalesced: boolean; changed: boolean } {
  if (isSnapshotSemanticallyEqual(state.present, nextSnapshot)) {
    return { state, coalesced: false, changed: false };
  }

  const now = Date.now();
  const lastEntry = state.past[state.past.length - 1];
  const canCoalesce =
    Boolean(lastEntry) &&
    lastEntry.coalesceKey === coalesceKey &&
    state.future.length === 0 &&
    now - lastEntry.timestamp <= windowMs;

  if (canCoalesce && lastEntry) {
    const updatedPast = [...state.past];
    updatedPast[updatedPast.length - 1] = {
      ...lastEntry,
      label,
      timestamp: now,
    };
    return {
      state: {
        past: updatedPast,
        present: structuredClone(nextSnapshot),
        future: [],
      },
      coalesced: true,
      changed: true,
    };
  }

  return {
    state: pushUndoableTransaction(state, nextSnapshot, label, coalesceKey),
    coalesced: false,
    changed: true,
  };
}

function stepHistoryCursor(
  state: UndoRedoState,
  direction: 'undo' | 'redo'
): { state: UndoRedoState; label: string | null } {
  const source = direction === 'undo' ? state.past : state.future;
  if (source.length === 0) {
    return { state, label: null };
  }

  const targetEntry = direction === 'undo' ? source[source.length - 1] : source[0];
  const oppositeEntry: UndoRedoEntry = {
    id: targetEntry.id,
    label: targetEntry.label,
    timestamp: Date.now(),
    snapshot: structuredClone(state.present),
  };

  if (direction === 'undo') {
    return {
      state: {
        past: state.past.slice(0, -1),
        present: structuredClone(targetEntry.snapshot),
        future: [oppositeEntry, ...state.future],
      },
      label: targetEntry.label,
    };
  }

  return {
    state: {
      past: [...state.past, oppositeEntry].slice(-MAX_UNDO_STACK),
      present: structuredClone(targetEntry.snapshot),
      future: state.future.slice(1),
    },
    label: targetEntry.label,
  };
}

export function performUndo(state: UndoRedoState): {
  state: UndoRedoState;
  undoneLabel: string | null;
} {
  const stepped = stepHistoryCursor(state, 'undo');
  return { state: stepped.state, undoneLabel: stepped.label };
}

export function performRedo(state: UndoRedoState): {
  state: UndoRedoState;
  redoneLabel: string | null;
} {
  const stepped = stepHistoryCursor(state, 'redo');
  return { state: stepped.state, redoneLabel: stepped.label };
}

/**
 * Records a durable named revision in the project's persistent version history.
 */
export function recordProjectRevision(
  project: CreativeProject,
  label: string,
  summary: string,
  changeCount: number = 1,
  options?: {
    coalesceKey?: string;
    windowMs?: number;
  }
): CreativeProject {
  const now = Date.now();
  const nextRevisionNumber = (project.revision ?? 1) + 1;
  const windowMs = options?.windowMs ?? 1500;
  const latestRev = project.revisions[0];
  const canCoalesce =
    Boolean(options?.coalesceKey) &&
    Boolean(latestRev) &&
    latestRev.coalesceKey === options?.coalesceKey &&
    now - latestRev.timestamp <= windowMs;

  if (canCoalesce && latestRev) {
    const updatedLatest: ProjectRevision = {
      ...latestRev,
      revisionNumber: nextRevisionNumber,
      timestamp: now,
      label,
      summary,
      snapshot: structuredClone(project.snapshot),
    };
    return {
      ...project,
      revision: nextRevisionNumber,
      updatedAt: now,
      revisions: [updatedLatest, ...project.revisions.slice(1)].slice(0, MAX_REVISIONS),
    };
  }

  const rev: ProjectRevision = {
    id: makeStableId('rev'),
    revisionNumber: nextRevisionNumber,
    timestamp: now,
    label,
    summary,
    changeCount,
    coalesceKey: options?.coalesceKey,
    snapshot: structuredClone(project.snapshot),
  };

  return {
    ...project,
    revision: nextRevisionNumber,
    updatedAt: now,
    revisions: [rev, ...project.revisions].slice(0, MAX_REVISIONS),
  };
}

/**
 * Safely restores a historical revision while preserving the state immediately preceding the restore.
 */
export function restoreProjectRevision(
  project: CreativeProject,
  undoState: UndoRedoState,
  revisionId: string
): { project: CreativeProject; undoState: UndoRedoState } | null {
  const targetRev = project.revisions.find((r) => r.id === revisionId);
  if (!targetRev) return null;

  const now = Date.now();
  const backupRevNum = (project.revision ?? 1) + 1;
  const restoredRevNum = backupRevNum + 1;

  const preRestoreRev: ProjectRevision = {
    id: makeStableId('rev_backup'),
    revisionNumber: backupRevNum,
    timestamp: now,
    label: `Before restoring "${targetRev.label}"`,
    summary: 'Automatic safety checkpoint created prior to version restore.',
    changeCount: 0,
    snapshot: structuredClone(project.snapshot),
  };

  const restoredSnapshot = structuredClone(targetRev.snapshot);
  const nextUndoState = pushUndoableTransaction(
    undoState,
    restoredSnapshot,
    `Restore revision: ${targetRev.label}`
  );

  const restoredRevEntry: ProjectRevision = {
    id: makeStableId('rev'),
    revisionNumber: restoredRevNum,
    timestamp: now + 1,
    label: `Restored: ${targetRev.label}`,
    summary: `Restored project state from revision "${targetRev.label}".`,
    changeCount: 1,
    snapshot: structuredClone(restoredSnapshot),
  };

  const nextProject: CreativeProject = {
    ...project,
    revision: restoredRevNum,
    updatedAt: now + 1,
    snapshot: restoredSnapshot,
    revisions: [restoredRevEntry, preRestoreRev, ...project.revisions].slice(0, MAX_REVISIONS),
    undoHistory: serializeUndoHistory(nextUndoState),
  };

  return {
    project: recordNarrativeChange(project, nextProject, 'restore', targetRev.label),
    undoState: nextUndoState,
  };
}
