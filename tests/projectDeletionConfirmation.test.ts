import assert from 'node:assert/strict';
import test from 'node:test';

import { confirmProjectDeletion } from '../components/inspector/SavedProjectsSection';

test('project deletion requires confirmation and preserves the project when cancelled', () => {
  const deleted: string[] = [];
  let message = '';

  const confirmed = confirmProjectDeletion(
    'synthetic-project-id',
    'Synthetic Alpha',
    (prompt) => {
      message = prompt;
      return false;
    },
    (projectId) => deleted.push(projectId),
  );

  assert.equal(confirmed, false);
  assert.match(message, /Synthetic Alpha/);
  assert.match(message, /removes it from this browser/i);
  assert.deepEqual(deleted, []);
});

test('confirmed project deletion invokes the existing deletion workflow once', () => {
  const deleted: string[] = [];
  let message = '';

  const confirmed = confirmProjectDeletion(
    'synthetic-project-id',
    'Synthetic Alpha',
    (prompt) => {
      message = prompt;
      return true;
    },
    (projectId) => deleted.push(projectId),
  );

  assert.equal(confirmed, true);
  assert.match(message, /Synthetic Alpha/);
  assert.match(message, /removes it from this browser/i);
  assert.deepEqual(deleted, ['synthetic-project-id']);
});
