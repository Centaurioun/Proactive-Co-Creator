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

test('W3-NEW-09: parseAndVerifyAllProjectsArchive terminates ZIP stream immediately on expansion bomb', async () => {
  const { zipSync, strToU8, Unzip } = await import('fflate');
  const { parseAndVerifyAllProjectsArchive } = await import('../lib/narrative/recovery/allProjectsArchive.ts');
  // Create a highly compressible 50 MiB zero payload so a single 64 KiB compressed chunk exceeds 48 MiB
  const huge = new Uint8Array(50 * 1024 * 1024);
  const zip = zipSync({ 'manifest.json': strToU8('{}'), 'projects/bomb.json': huge }, { level: 9 });
  const view = new DataView(zip.buffer, zip.byteOffset, zip.byteLength);
  // Zero out declared originalSize in local/central headers so the streaming inflater guard must catch it
  for (let i = 0; i <= zip.length - 30; i += 1) {
    if (view.getUint32(i, true) === 0x04034b50) view.setUint32(i + 22, 100, true);
    if (i <= zip.length - 46 && view.getUint32(i, true) === 0x02014b50) view.setUint32(i + 24, 100, true);
  }
  let terminateCalls = 0;
  let postTerminateDataCalls = 0;
  await assert.rejects(() => parseAndVerifyAllProjectsArchive(zip, new Set(), {
    createUnzip: () => {
      const inner = new Unzip();
      const origRegister = inner.register.bind(inner);
      return {
        register: origRegister,
        push: inner.push.bind(inner),
        set onfile(handler: typeof inner.onfile) {
          inner.onfile = (file) => {
            const origTerminate = file.terminate.bind(file);
            let terminated = false;
            file.terminate = () => {
              terminated = true;
              terminateCalls += 1;
              origTerminate();
            };
            handler(file);
            const wrapped = file.ondata;
            if (wrapped) {
              file.ondata = (err, data, final) => {
                if (terminated) postTerminateDataCalls += 1;
                wrapped(err, data, final);
              };
            }
          };
        },
        get onfile() { return inner.onfile; },
      } as unknown as InstanceType<typeof Unzip>;
    },
  }), /48 MiB/i);
  assert.ok(terminateCalls >= 1, 'file.terminate() must be called on ZIP bomb overflow');
  assert.equal(postTerminateDataCalls, 0, 'No further chunks may be inflated after file.terminate()');
});

test('W3-NEW-10: setBackupPin validates backup identity and coordinates with deleteBackup', async () => {
  const { createSampleProject } = await import('../lib/canonicalModel.ts');
  const { saveBackup, setBackupPin, deleteBackup } = await import('../lib/narrative/recovery.ts');
  const { MockLocalStorage } = await import('./helpers/mockBrowserStorage.ts');

  const mockLocal = new MockLocalStorage();
  const prevLocal = globalThis.localStorage;
  const prevNavigator = globalThis.navigator;
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: mockLocal });
  Object.defineProperty(globalThis, 'navigator', {
    configurable: true,
    value: {
      locks: {
        request: async (_name: string, cb: () => Promise<void>) => cb(),
      },
    },
  });
  try {
    const project = createSampleProject(100);
    const b1 = await saveBackup(project, 'First');
    const b2 = await saveBackup(project, 'Second');
    // Corrupt stored record id mismatch
    const key = `pcc-narrative-backup:${b1.id}`;
    const parsed = JSON.parse(mockLocal.getItem(key)!);
    mockLocal.setItem(key, JSON.stringify({ ...parsed, id: 'different-id' }));
    assert.throws(() => setBackupPin(b1, true), /mismatch|valid|backup/i);
    // Restore b1 and verify deleteBackup re-checks latest pinned state after async listBackups
    mockLocal.setItem(key, JSON.stringify(parsed));
    const origGetItem = mockLocal.getItem.bind(mockLocal);
    let flipped = false;
    mockLocal.getItem = (k: string) => {
      const val = origGetItem(k);
      // After listBackups reads both backups, simulate concurrent pin of b2 before deleteBackup removes it
      if (!flipped && k === `pcc-narrative-backup:${b2.id}`) {
        flipped = true;
        queueMicrotask(() => {
          setBackupPin(b2, true);
        });
      }
      return val;
    };
    await assert.rejects(() => deleteBackup(b2), /pin/i);
  } finally {
    Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: prevLocal });
    Object.defineProperty(globalThis, 'navigator', { configurable: true, value: prevNavigator });
  }
});
