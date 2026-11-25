import test from 'node:test';
import assert from 'node:assert/strict';
import { getSavePresentation } from '../lib/workspace/savePresentation';

const base = { restoring: false, draftDirty: false, savePending: false, projectPersisted: true, storageState: null as 'conflict' | 'failed' | null };

test('global save presentation distinguishes draft, pending durable save, persisted revision and storage errors', () => {
  assert.equal(getSavePresentation({ ...base, draftDirty: true }), 'draft-unsaved');
  assert.equal(getSavePresentation({ ...base, savePending: true, projectPersisted: false }), 'saving');
  assert.equal(getSavePresentation({ ...base, projectPersisted: false }), 'project-unsaved');
  assert.equal(getSavePresentation({ ...base }), 'saved');
  assert.equal(getSavePresentation({ ...base, storageState: 'conflict' }), 'conflict');
  assert.equal(getSavePresentation({ ...base, storageState: 'failed' }), 'failed');
  assert.equal(getSavePresentation({ ...base, restoring: true }), 'restoring');
});

test('global save presentation reports outstanding draft ahead of a durable-save acknowledgement', () => {
  assert.equal(getSavePresentation({ ...base, draftDirty: true, savePending: true }), 'draft-unsaved');
});
