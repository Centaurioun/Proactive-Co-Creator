/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { makeStableId } from './canonicalModel.ts';
import type {
  CreativeProject,
  PersistedUndoHistory,
  ProjectRevision,
  ProjectSnapshot,
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
      snapshot: structuredClone(entry.snapshot),
    })),
    future: state.future.slice(0, MAX_UNDO_STACK).map((entry) => ({
      label: entry.label,
      snapshot: structuredClone(entry.snapshot),
    })),
  };
}

export function createUndoRedoState(
  initialSnapshot: ProjectSnapshot,
  revisions?: ProjectRevision[],
  persistedUndoHistory?: PersistedUndoHistory
): UndoRedoState {
  if (
    persistedUndoHistory &&
    Array.isArray(persistedUndoHistory.past) &&
    Array.isArray(persistedUndoHistory.future)
  ) {
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

  if (Array.isArray(revisions) && revisions.length > 1) {
    const oldest = revisions[revisions.length - 1];
    if (oldest?.snapshot) {
      let state: UndoRedoState = {
        past: [],
        present: structuredClone(oldest.snapshot),
        future: [],
      };
      for (let i = revisions.length - 2; i >= 0; i--) {
        const rev = revisions[i];
        if (!rev?.snapshot) continue;
        const label = rev.label || `Revision #${rev.revisionNumber ?? i}`;
        if (
          label.startsWith('Undo: ') &&
          state.past.length > 0 &&
          isSnapshotSemanticallyEqual(state.past[state.past.length - 1].snapshot, rev.snapshot)
        ) {
          state = performUndo(state).state;
        } else if (
          label.startsWith('Redo: ') &&
          state.future.length > 0 &&
          isSnapshotSemanticallyEqual(state.future[0].snapshot, rev.snapshot)
        ) {
          state = performRedo(state).state;
        } else {
          state = pushUndoableTransaction(state, rev.snapshot, label, rev.coalesceKey);
        }
      }
      return {
        past: state.past.slice(-MAX_UNDO_STACK),
        present: structuredClone(initialSnapshot),
        future: state.future.slice(0, MAX_UNDO_STACK),
      };
    }
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

/**
 * Normalizes a ProjectSnapshot for semantic comparison, ignoring only ephemeral timestamps.
 */
export function normalizeSnapshotForComparison(snapshot: ProjectSnapshot): unknown {
  return {
    originalIdea: snapshot.originalIdea,
    refinedPrompt: snapshot.refinedPrompt,
    freeformNotes: snapshot.freeformNotes,
    mode: snapshot.mode,
    entities: snapshot.entities.map((e) => ({
      id: e.id,
      name: e.name,
      category: e.category,
      presence_in_prompt: Boolean(e.presence_in_prompt),
      description: e.description,
      alternatives: Array.isArray(e.alternatives) ? e.alternatives.map((c) => c.name) : null,
      excluded: Boolean(e.excluded),
      status: e.status,
      provenance: e.provenance,
      groupId: e.groupId,
      aliases: e.aliases ?? [],
      attributes: e.attributes.map((a) => ({
        id: a.id,
        name: a.name,
        presence_in_prompt: Boolean(a.presence_in_prompt),
        confirmedValue: a.confirmedValue,
        status: a.status,
        provenance: a.provenance,
        value: a.value.map((v) => v.name),
      })),
    })),
    relationships: snapshot.relationships.map((r) => ({
      id: r.id,
      sourceId: r.sourceId,
      targetId: r.targetId,
      source: r.source,
      target: r.target,
      label: r.label,
      alternatives: Array.isArray(r.alternatives) ? r.alternatives.map((c) => c.name) : [],
      status: r.status,
      provenance: r.provenance,
      presence_in_prompt: Boolean(r.presence_in_prompt),
      evidenceExcerpt: r.evidenceExcerpt,
    })),
    storyBible: Object.fromEntries(
      Object.entries(snapshot.storyBible).map(([k, v]) => [
        k,
        { value: v.value, status: v.status, provenance: v.provenance },
      ])
    ),
    clarifications: snapshot.clarifications.map((c) => ({
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
    })),
    decisions: snapshot.decisions.map((d) => ({
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
    })),
    answeredQuestions: snapshot.answeredQuestions ?? [],
    skippedQuestions: snapshot.skippedQuestions ?? [],
  };
}

export function isSnapshotSemanticallyEqual(a: ProjectSnapshot, b: ProjectSnapshot): boolean {
  return (
    JSON.stringify(normalizeSnapshotForComparison(a)) ===
    JSON.stringify(normalizeSnapshotForComparison(b))
  );
}

/**
 * Commits a new confirmed snapshot onto the Undo/Redo stack and invalidates any incompatible redo branch.
 * Skips no-op commits when nextSnapshot is semantically identical to state.present.
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

  const nextPast = [...state.past, entry].slice(-MAX_UNDO_STACK);
  return {
    past: nextPast,
    present: structuredClone(nextSnapshot),
    future: [],
  };
}

/**
 * Commits a transaction while coalescing rapid consecutive edits sharing the same coalesceKey
 * within windowMs (e.g. typing in seed prompt, freeform notes, or Story Bible fields).
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

  if (
    lastEntry &&
    lastEntry.coalesceKey === coalesceKey &&
    state.future.length === 0 &&
    now - lastEntry.timestamp <= windowMs
  ) {
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

export function performUndo(state: UndoRedoState): {
  state: UndoRedoState;
  undoneLabel: string | null;
} {
  if (state.past.length === 0) {
    return { state, undoneLabel: null };
  }

  const previousEntry = state.past[state.past.length - 1];
  const nextPast = state.past.slice(0, -1);
  const redoEntry: UndoRedoEntry = {
    id: previousEntry.id,
    label: previousEntry.label,
    timestamp: Date.now(),
    snapshot: structuredClone(state.present),
  };

  return {
    state: {
      past: nextPast,
      present: structuredClone(previousEntry.snapshot),
      future: [redoEntry, ...state.future],
    },
    undoneLabel: previousEntry.label,
  };
}

export function performRedo(state: UndoRedoState): {
  state: UndoRedoState;
  redoneLabel: string | null;
} {
  if (state.future.length === 0) {
    return { state, redoneLabel: null };
  }

  const nextEntry = state.future[0];
  const remainingFuture = state.future.slice(1);
  const undoEntry: UndoRedoEntry = {
    id: nextEntry.id,
    label: nextEntry.label,
    timestamp: Date.now(),
    snapshot: structuredClone(state.present),
  };

  return {
    state: {
      past: [...state.past, undoEntry].slice(-MAX_UNDO_STACK),
      present: structuredClone(nextEntry.snapshot),
      future: remainingFuture,
    },
    redoneLabel: nextEntry.label,
  };
}

/**
 * Records a durable named revision in the project's persistent version history
 * and increments the monotonic logical revision counter.
 * Supports coalescing rapid text edits sharing a coalesceKey so keystrokes do not flood revision history.
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

  if (
    options?.coalesceKey &&
    latestRev &&
    latestRev.coalesceKey === options.coalesceKey &&
    now - latestRev.timestamp <= windowMs
  ) {
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
 * Safely restores a historical revision while preserving the state immediately preceding the restore
 * as a recoverable revision and undo entry.
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

  // First save a pre-restore checkpoint revision so nothing is ever lost
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

  return { project: nextProject, undoState: nextUndoState };
}
