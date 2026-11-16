/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { makeStableId } from './canonicalModel.ts';
import type { CreativeProject, ProjectRevision, ProjectSnapshot } from '../shared/types.ts';

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

export function createUndoRedoState(
  initialSnapshot: ProjectSnapshot,
  revisions?: ProjectRevision[]
): UndoRedoState {
  const past: UndoRedoEntry[] = [];
  if (Array.isArray(revisions) && revisions.length > 1) {
    for (let i = revisions.length - 1; i >= 1; i--) {
      const older = revisions[i];
      const newer = revisions[i - 1];
      if (older?.snapshot && newer) {
        past.push({
          id: newer.id || makeStableId('undo'),
          label: newer.label || `Revision #${newer.revisionNumber ?? i}`,
          timestamp: typeof newer.timestamp === 'number' ? newer.timestamp : Date.now(),
          coalesceKey: newer.coalesceKey,
          snapshot: structuredClone(older.snapshot),
        });
      }
    }
  }
  return {
    past: past.slice(-MAX_UNDO_STACK),
    present: structuredClone(initialSnapshot),
    future: [],
  };
}

export function createUndoRedoStateFromProject(project: CreativeProject): UndoRedoState {
  return createUndoRedoState(project.snapshot, project.revisions);
}

/**
 * Normalizes a ProjectSnapshot for semantic comparison, ignoring ephemeral timestamps.
 */
function normalizeSnapshotForComparison(snapshot: ProjectSnapshot): unknown {
  return {
    originalIdea: snapshot.originalIdea,
    refinedPrompt: snapshot.refinedPrompt,
    freeformNotes: snapshot.freeformNotes,
    mode: snapshot.mode,
    entities: snapshot.entities.map((e) => ({
      id: e.id,
      name: e.name,
      category: e.category,
      description: e.description,
      excluded: Boolean(e.excluded),
      status: e.status,
      aliases: e.aliases ?? [],
      attributes: e.attributes.map((a) => ({
        name: a.name,
        confirmedValue: a.confirmedValue,
        status: a.status,
        value: a.value.map((v) => v.name),
      })),
    })),
    relationships: snapshot.relationships.map((r) => ({
      id: r.id,
      source: r.source,
      target: r.target,
      label: r.label,
      status: r.status,
    })),
    storyBible: Object.fromEntries(
      Object.entries(snapshot.storyBible).map(([k, v]) => [
        k,
        { value: v.value, status: v.status },
      ])
    ),
    clarifications: snapshot.clarifications.map((c) => ({
      id: c.id,
      question: c.question,
      status: c.status,
    })),
    decisions: snapshot.decisions.map((d) => ({
      id: d.id,
      status: d.status,
      proposedValue: d.proposedValue,
    })),
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
  };

  return { project: nextProject, undoState: nextUndoState };
}
