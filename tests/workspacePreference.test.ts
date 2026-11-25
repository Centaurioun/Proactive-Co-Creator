import test from 'node:test';
import assert from 'node:assert/strict';
import { readWorkspacePreference, writeWorkspacePreference, type WorkspacePreferenceStorage } from '../lib/workspacePreference';

function storageWith(value: string | null): WorkspacePreferenceStorage & { value: string | null } {
  return {
    value,
    getItem() { return this.value; },
    setItem(_key, next) { this.value = next; },
  };
}

test('workspace preference validates the versioned stable mode and safely falls back to Write', () => {
  assert.equal(readWorkspacePreference(null), 'write');
  assert.equal(readWorkspacePreference(storageWith('{')), 'write');
  assert.equal(readWorkspacePreference(storageWith('{"version":2,"mode":"plan"}')), 'write');
  assert.equal(readWorkspacePreference(storageWith('{"version":1,"mode":"projects"}')), 'write');
  assert.equal(readWorkspacePreference(storageWith('{"version":1,"mode":"review"}')), 'review');
});

test('workspace preference reads and writes tolerate unavailable storage', () => {
  const storage = storageWith(null);
  storage.getItem = () => { throw new Error('unavailable'); };
  storage.setItem = () => { throw new Error('quota'); };
  assert.equal(readWorkspacePreference(storage), 'write');
  assert.equal(writeWorkspacePreference(storage, 'plan'), false);
});

test('workspace preference write stores only version and stable mode', () => {
  const storage = storageWith(null);
  assert.equal(writeWorkspacePreference(storage, 'review'), true);
  assert.deepEqual(JSON.parse(storage.value ?? '{}'), { version: 1, mode: 'review' });
});
