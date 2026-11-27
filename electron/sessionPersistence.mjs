import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';

/** Read only a successfully decrypted session. Never interpret disk bytes as plaintext. */
export function readEncryptedSession(file, storage) {
  try {
    if (!storage.isEncryptionAvailable() || !fs.existsSync(file)) return undefined;
    const tokens = JSON.parse(storage.decryptString(fs.readFileSync(file)));
    return tokens && typeof tokens.accessToken === 'string' ? tokens : undefined;
  } catch {
    return undefined;
  }
}

/** Persist atomically using OS-backed encryption; never leave an old session as a fallback. */
export function persistEncryptedSession(file, tokens, storage) {
  let temporary;
  try {
    if (!tokens) {
      fs.rmSync(file, { force: true });
      return true;
    }
    if (!storage.isEncryptionAvailable()) {
      fs.rmSync(file, { force: true });
      return false;
    }
    const encrypted = storage.encryptString(JSON.stringify(tokens));
    fs.mkdirSync(path.dirname(file), { recursive: true });
    temporary = `${file}.${randomUUID()}.tmp`;
    fs.writeFileSync(temporary, encrypted, { mode: 0o600, flag: 'wx' });
    fs.renameSync(temporary, file);
    return true;
  } catch {
    // Best effort: a failed update must not intentionally restore a superseded grant.
    try { if (temporary) fs.rmSync(temporary, { force: true }); } catch { /* inaccessible */ }
    try { fs.rmSync(file, { force: true }); } catch { /* caller reports failure */ }
    return false;
  }
}
