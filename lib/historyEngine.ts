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
  snapshot: ProjectSnapshot;
}

export interface UndoRedoState {
  past: UndoRedoEntry[];
  present: ProjectSnapshot;
  future: UndoRedoEntry[];
}

const MAX_UNDO_STACK = 40;
const MAX_REVISIONS = 25;

export function createUndoRedoState(initialSnapshot: ProjectSnapshot): UndoRedoState {
  return {
    past: [],
    present: structuredClone(initialSnapshot),
    future: [],
  };
}

/**
 * Commits a new confirmed snapshot onto the Undo/Redo stack and invalidates any incompatible redo branch.
 */
export function pushUndoableTransaction(
  state: UndoRedoState,
  nextSnapshot: ProjectSnapshot,
  label: string
): UndoRedoState {
  const entry: UndoRedoEntry = {
    id: makeStableId('undo'),
    label,
    timestamp: Date.now(),
    snapshot: structuredClone(state.present),
  };

  const nextPast = [...state.past, entry].slice(-MAX_UNDO_STACK);
  return {
    past: nextPast,
    present: structuredClone(nextSnapshot),
    future: [],
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
 * Records a durable named revision in the project's persistent version history.
 */
export function recordProjectRevision(
  project: CreativeProject,
  label: string,
  summary: string,
  changeCount: number = 1
): CreativeProject {
  const now = Date.now();
  const rev: ProjectRevision = {
    id: makeStableId('rev'),
    timestamp: now,
    label,
    summary,
    changeCount,
    snapshot: structuredClone(project.snapshot),
  };

  return {
    ...project,
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
  // First save a pre-restore checkpoint revision so nothing is ever lost
  const preRestoreRev: ProjectRevision = {
    id: makeStableId('rev_backup'),
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
    timestamp: now + 1,
    label: `Restored: ${targetRev.label}`,
    summary: `Restored project state from revision "${targetRev.label}".`,
    changeCount: 1,
    snapshot: structuredClone(restoredSnapshot),
  };

  const nextProject: CreativeProject = {
    ...project,
    updatedAt: now + 1,
    snapshot: restoredSnapshot,
    revisions: [restoredRevEntry, preRestoreRev, ...project.revisions].slice(0, MAX_REVISIONS),
  };

  return { project: nextProject, undoState: nextUndoState };
}
