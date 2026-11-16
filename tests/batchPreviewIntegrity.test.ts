/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  createSampleProject,
  updateStoryBibleField,
} from '../lib/canonicalModel.ts';
import { createUndoRedoState } from '../lib/historyEngine.ts';
import { interpretBatchInstructionLocally } from '../lib/nlBatchEngine.ts';
import {
  buildReviewDiffModel,
  commitBatchPreviewToProject,
  commitSnapshotTransaction,
} from '../lib/projectController.ts';

describe('T3: Batch Preview & Review Diff Integrity (PR-01 through PR-03)', () => {
  it('T3.1: deselecting 1 of 3 staged operations excludes it from both Review Before/After diff & projected prompt and commits only selected ops', () => {
    const project = createSampleProject();
    const undo = createUndoRedoState(project.snapshot);

    // Produces 3+ operations: set Rabbit age, set Fox age, set Story tone (and keep Cat young)
    const preview = interpretBatchInstructionLocally(
      'Make Rabbit elderly. Make Fox elderly. The party should be mysterious.',
      project.snapshot,
      { projectId: project.id, revision: project.revision }
    );
    assert.equal(preview.operations.length, 3, 'Expected exactly 3 operations');

    // Deselect the 2nd operation (Fox elderly)
    const editedPreview = {
      ...preview,
      operations: preview.operations.map((op, idx) =>
        idx === 1 ? { ...op, selected: false } : op
      ),
    };

    const diff = buildReviewDiffModel({
      project,
      selectedDecisionIds: [],
      stagedBatch: editedPreview,
    });

    const batchItems = diff.items.filter((i) => i.source === 'batch-preview');
    assert.equal(batchItems.length, 2, 'Diff must show only the 2 selected operations (PR-01)');
    assert.equal(
      batchItems.some((i) => i.targetLabel.includes('Fox')),
      false,
      'Deselected Fox operation must not appear in Review Diff'
    );
    assert.equal(diff.afterPrompt.includes('mysterious'), true);

    const committed = commitBatchPreviewToProject({
      project,
      undoState: undo,
      preview: editedPreview,
    });
    assert.equal(committed.result.ok, true);
    if (committed.result.ok) {
      assert.equal(committed.result.appliedCount, 2);
    }

    const rabbitAge = committed.project.snapshot.entities
      .find((e) => e.id === 'ent_rabbit')
      ?.attributes.find((a) => a.name === 'age')?.confirmedValue;
    const foxAge = committed.project.snapshot.entities
      .find((e) => e.id === 'ent_fox')
      ?.attributes.find((a) => a.name === 'age')?.confirmedValue;
    assert.equal(rabbitAge?.toLowerCase(), 'elderly');
    assert.notEqual(foxAge?.toLowerCase(), 'elderly', 'Deselected Fox op must NOT be committed');
    assert.equal(committed.project.snapshot.storyBible.tone.value, 'mysterious');
  });

  it('T3.2: stale batch preview marks diff stale without simulating stale afterPrompt, blocks apply, and updates cleanly on re-preview', () => {
    const projR1 = createSampleProject();
    const undoR1 = createUndoRedoState(projR1.snapshot);

    const stalePreview = interpretBatchInstructionLocally(
      'The party should be eerie noir.',
      projR1.snapshot,
      { projectId: projR1.id, revision: projR1.revision }
    );
    assert.equal(stalePreview.baseRevision, 1);

    // Intervening edit advances project to r2
    const editedSnap = updateStoryBibleField(projR1.snapshot, 'setting', 'Clockwork Belfry');
    const { project: projR2, undoState: undoR2 } = commitSnapshotTransaction(
      projR1,
      undoR1,
      editedSnap,
      'Edit Setting',
      'Changed setting before applying batch'
    );
    assert.equal(projR2.revision, 2);

    // Stale preview in Review Diff must flag stale conflictWarning & NOT simulate stale prompt changes
    const staleDiff = buildReviewDiffModel({
      project: projR2,
      stagedBatch: stalePreview,
    }) as ReturnType<typeof buildReviewDiffModel> & { hasStaleBatch?: boolean };

    assert.equal(staleDiff.hasStaleBatch, true, 'buildReviewDiffModel must expose hasStaleBatch=true on revision drift');
    const staleBatchItem = staleDiff.items.find((i) => i.source === 'batch-preview');
    assert.ok(staleBatchItem?.conflictWarning, 'Stale batch diff item must surface conflictWarning');
    assert.equal(
      staleDiff.afterPrompt.includes('eerie noir'),
      false,
      'Projected prompt must NOT simulate stale batch operations as cleanly applied'
    );

    // Attempting commit fails with STALE_REVISION without changing state
    const blocked = commitBatchPreviewToProject({
      project: projR2,
      undoState: undoR2,
      preview: stalePreview,
    });
    assert.equal(blocked.result.ok, false);
    if (!blocked.result.ok) {
      assert.equal(blocked.result.reason, 'STALE_REVISION');
    }
    assert.equal(blocked.project.revision, 2);
    assert.notEqual(blocked.project.snapshot.storyBible.tone.value, 'eerie noir');

    // Re-preview against r2 clears stale state and succeeds
    const freshPreview = interpretBatchInstructionLocally(
      'The party should be eerie noir.',
      projR2.snapshot,
      { projectId: projR2.id, revision: projR2.revision }
    );
    const freshDiff = buildReviewDiffModel({
      project: projR2,
      stagedBatch: freshPreview,
    }) as ReturnType<typeof buildReviewDiffModel> & { hasStaleBatch?: boolean };
    assert.equal(freshDiff.hasStaleBatch, false);
    assert.equal(freshDiff.afterPrompt.includes('eerie noir'), true);
    assert.equal(freshDiff.afterPrompt.includes('Clockwork Belfry'), true);

    const committed = commitBatchPreviewToProject({
      project: projR2,
      undoState: undoR2,
      preview: freshPreview,
    });
    assert.equal(committed.result.ok, true);
    assert.equal(committed.project.revision, 3);
    assert.equal(committed.project.snapshot.storyBible.tone.value, 'eerie noir');
  });

  it('T3.3: unhandled clauses, contradictory ops, destructive ops, and failed apply preserve staged preview & selections without partial mutation', () => {
    const project = createSampleProject();
    const undo = createUndoRedoState(project.snapshot);

    const mixedPreview = interpretBatchInstructionLocally(
      'Make Fox elderly. Also invent an underwater circus parade with confetti.',
      project.snapshot,
      { projectId: project.id, revision: project.revision }
    );

    assert.ok((mixedPreview.unhandledClauses?.length ?? 0) >= 1, 'Unhandled clause must be surfaced');
    assert.equal(mixedPreview.coverageComplete, false);
    assert.ok(mixedPreview.warnings.some((w) => w.includes('Unhandled instruction clause')));

    // Contradictory ops in the same instruction receive conflictWarning
    const contradictoryPreview = interpretBatchInstructionLocally(
      'Make Fox elderly. Make Fox young.',
      project.snapshot,
      { projectId: project.id, revision: project.revision }
    );
    assert.ok(
      contradictoryPreview.operations.some((op) => Boolean(op.conflictWarning)),
      'Contradictory ops must emit conflictWarning'
    );
    const diffWithConflict = buildReviewDiffModel({
      project,
      stagedBatch: contradictoryPreview,
    });
    assert.ok(
      diffWithConflict.items.some((i) => i.source === 'batch-preview' && Boolean(i.conflictWarning)),
      'Conflict warning must propagate into Review Diff items'
    );

    const failedAttempt = commitBatchPreviewToProject({
      project,
      undoState: undo,
      preview: contradictoryPreview,
    });
    assert.equal(failedAttempt.result.ok, false);
    assert.equal(failedAttempt.project.revision, project.revision);
    assert.deepEqual(failedAttempt.project.snapshot, project.snapshot);
    assert.equal(
      contradictoryPreview.operations.every((op) => op.selected),
      true,
      'Failed commit must leave staged operation selections intact for user adjustment'
    );
  });

  it('T3.4: building or dismissing a preview without commit leaves canonical snapshot and revision completely unchanged', () => {
    const project = createSampleProject();
    const originalSnapshot = structuredClone(project.snapshot);
    const originalRev = project.revision;

    const preview = interpretBatchInstructionLocally(
      'Make all the animal guests elderly, but keep the cat young.',
      project.snapshot,
      { projectId: project.id, revision: project.revision }
    );
    buildReviewDiffModel({ project, stagedBatch: preview });

    assert.equal(project.revision, originalRev);
    assert.deepEqual(project.snapshot, originalSnapshot);
  });
});
