import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { readEncryptedSession, persistEncryptedSession } from '../electron/sessionPersistence.mjs';

test('desktop session persistence never reads or writes plaintext without encryption', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pcc-session-test-'));
  const file = path.join(dir, 'session.enc');
  const unavailable = {
    isEncryptionAvailable: () => false,
    encryptString: () => { throw new Error('unexpected encryption'); },
    decryptString: () => { throw new Error('unexpected decryption'); },
  };
  try {
    fs.writeFileSync(file, JSON.stringify({ accessToken: 'synthetic-legacy' }), { mode: 0o600 });
    assert.equal(readEncryptedSession(file, unavailable), undefined);
    assert.equal(persistEncryptedSession(file, { accessToken: 'synthetic-new' }, unavailable), false);
    assert.equal(fs.existsSync(file), false);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('encrypted session round trip, failure and disconnect do not retain stale tokens', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pcc-session-test-'));
  const file = path.join(dir, 'session.enc');
  const storage = {
    isEncryptionAvailable: () => true,
    encryptString: (value: string) => Buffer.from('test-envelope:' + Buffer.from(value).toString('base64')),
    decryptString: (value: Buffer) => {
      const encoded = value.toString();
      if (!encoded.startsWith('test-envelope:')) throw new Error('invalid envelope');
      return Buffer.from(encoded.slice('test-envelope:'.length), 'base64').toString();
    },
  };
  const tokens = { accessToken: 'synthetic-only', expiresAt: 42 };
  try {
    assert.equal(persistEncryptedSession(file, tokens, storage), true);
    assert.equal(fs.readFileSync(file).includes(Buffer.from('synthetic-only')), false);
    assert.deepEqual(readEncryptedSession(file, storage), tokens);
    assert.equal(persistEncryptedSession(file, tokens, { ...storage, encryptString: () => { throw new Error('failed'); } }), false);
    assert.equal(fs.existsSync(file), false);
    assert.equal(persistEncryptedSession(file, tokens, storage), true);
    assert.equal(persistEncryptedSession(file, null, storage), true);
    assert.equal(fs.existsSync(file), false);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});
