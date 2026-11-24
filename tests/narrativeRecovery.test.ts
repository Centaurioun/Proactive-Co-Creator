import assert from 'node:assert/strict';
import test from 'node:test';
import { createSampleProject } from '../lib/canonicalModel.ts';
import { createBackup, verifyBackup, prepareBackupCopy, safeFilename } from '../lib/narrative/recovery.ts';

test('backup verification detects corruption and copy preserves scoped history', async () => {
  const project = createSampleProject(100);
  const backup = await createBackup(project, 'Before editing');
  assert.equal((await verifyBackup(backup)).revisions[0].id, project.revisions[0].id);
  await assert.rejects(() => verifyBackup({ ...backup, payload: backup.payload.replace('Cat', 'Rat') }), /checksum/i);
  const copy = prepareBackupCopy(await verifyBackup(backup));
  assert.notEqual(copy.id, project.id);
  assert.deepEqual(copy.revisions, (await verifyBackup(backup)).revisions);
  assert.equal(copy.persistedRevision, undefined);
});

test('filenames contain no path separators and handle reserved names', () => {
  assert.match(safeFilename('../İpek/Öykü', 'manuscript', 'md'), /^İpek-Öykü-manuscript\.md$/u);
  assert.equal(safeFilename('CON', '', 'json'), 'project-CON.json');
});

test('replacement keeps the target identity, advances the revision and rejects cross-project backups', async () => {
  const { prepareBackupReplacement } = await import('../lib/narrative/recovery.ts');
  const backup = createSampleProject(100);
  const current = { ...backup, revision: 9, persistedRevision: 9, name: 'Current working copy' };
  assert.throws(() => prepareBackupReplacement(current, { ...backup, id: 'elsewhere' }), /same project/i);
  const replacement = prepareBackupReplacement(current, backup);
  assert.equal(replacement.id, current.id);
  assert.equal(replacement.revision, 10);
  assert.equal(replacement.persistedRevision, 9);
  assert.equal(replacement.name, backup.name);
  assert.equal(replacement.revisions[1].id, backup.revisions[0].id);
});
