import assert from 'node:assert/strict';
import test from 'node:test';
import { transitionIssue, invalidateTargetEvidence } from '../lib/narrative/issueRegistry.ts';
import type { CreativeProject } from '../shared/types.ts';
import { createEmptyStoryBible } from '../lib/canonicalModel.ts';

function project(): CreativeProject {
  return {
    schemaVersion: 4, id: 'p1', revision: 7, name: 'Fixture', createdAt: 1, updatedAt: 1,
    snapshot: { originalIdea: '', refinedPrompt: '', freeformNotes: '', mode: 'story', entities: [], relationships: [], storyBible: createEmptyStoryBible(), clarifications: [], decisions: [], answeredQuestions: [], skippedQuestions: [] },
    artifacts: [], revisions: [],
    narrative: { versions: [], sectionVersions: [], sources: [], claims: [], audit: [], issues: [
      { id: 'i1', fingerprint: 'f1', title: 'Unclear event', disposition: 'open', freshness: 'current', reason: 'Two readings', anchors: [], affectedTargetIds: ['scene-1'], severity: 'medium', certainty: 'possible', history: [] },
      { id: 'i2', fingerprint: 'f2', title: 'Other', disposition: 'open', freshness: 'current', reason: 'Separate', anchors: [], affectedTargetIds: ['scene-2'], severity: 'medium', certainty: 'possible', history: [] },
    ] },
  } as CreativeProject;
}

test('issue lifecycle requires reasons for author dispositions and retains history', () => {
  const original = project();
  const deferred = transitionIssue(original, 'i1', 'deferred', 'Review after chapter 2', 20, 8);
  assert.equal(original.narrative?.issues[0].disposition, 'open');
  assert.equal(deferred.issues[0].disposition, 'deferred');
  assert.equal(deferred.issues[0].dispositionReason, 'Review after chapter 2');
  assert.equal(deferred.issues[0].history.length, 1);
  assert.throws(() => transitionIssue(original, 'i1', 'dismissed', '', 21, 8), /reason/i);
  const resolved = { ...original, narrative: { ...original.narrative!, issues: original.narrative!.issues.map(issue => ({ ...issue, disposition: 'resolved' as const })) } };
  assert.throws(() => transitionIssue(resolved, 'i1', 'deferred', 'later', 22, 8), /invalid/i);
  const reopened = transitionIssue({ ...original, narrative: { ...original.narrative!, issues: deferred.issues } }, 'i1', 'open', 'New evidence', 23, 9);
  assert.equal(reopened.issues[0].history.length, 2);
  assert.equal(reopened.issues[0].history[1].projectRevision, 9);
});

test('freshness invalidation marks only records linked to changed targets', () => {
  const records = project().narrative!;
  const next = invalidateTargetEvidence(records, ['scene-1']);
  assert.equal(next.issues[0].freshness, 'needs-recheck');
  assert.equal(next.issues[1].freshness, 'current');
  assert.equal(records.issues[0].freshness, 'current');
});
