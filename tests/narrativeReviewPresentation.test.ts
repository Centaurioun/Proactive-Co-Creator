import assert from 'node:assert/strict';
import test from 'node:test';
import { createSampleProject } from '../lib/canonicalModel.ts';
import {
  captureProposalReviewContext,
  isProposalReviewContextCurrent,
} from '../components/workspace/review/proposalReviewContext.ts';

test('proposal review context becomes stale after project, revision, or snapshot changes', () => {
  const project = createSampleProject();
  const context = captureProposalReviewContext(project);

  assert.equal(isProposalReviewContextCurrent(project, context), true);
  assert.equal(isProposalReviewContextCurrent({ ...project, revision: project.revision + 1 }, context), false);
  assert.equal(isProposalReviewContextCurrent({ ...project, id: `${project.id}-other` }, context), false);

  const changedSnapshot = structuredClone(project);
  changedSnapshot.snapshot.originalIdea += ' An intervening author edit.';
  assert.equal(isProposalReviewContextCurrent(changedSnapshot, context), false);
});
