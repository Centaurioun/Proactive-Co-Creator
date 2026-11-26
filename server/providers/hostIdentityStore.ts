import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

export interface HostIdentity {
  hostId: string;
  issuedClientId?: string;
}

export interface HostIdentityStore {
  load(): Promise<HostIdentity>;
  save(value: HostIdentity): Promise<HostIdentity>;
  getCached(): HostIdentity | undefined;
}

function defaultIdentityPath(): string {
  return path.join(os.homedir(), '.config', 'proactive-co-creator', 'host-identity.json');
}

function parseValidHostIdentity(raw: unknown): HostIdentity | undefined {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return undefined;
  const record = raw as { hostId?: unknown; issuedClientId?: unknown };
  if (typeof record.hostId !== 'string' || !record.hostId.trim()) return undefined;
  const issuedClientId = typeof record.issuedClientId === 'string' && record.issuedClientId.trim()
    ? record.issuedClientId.trim()
    : undefined;
  return {
    hostId: record.hostId.trim(),
    ...(issuedClientId ? { issuedClientId } : {}),
  };
}

export function createHostIdentityStore(filePath?: string): HostIdentityStore {
  const resolveFilePath = () => filePath ?? defaultIdentityPath();
  let cached: HostIdentity | undefined;
  let pendingOperation: Promise<HostIdentity> | undefined;

  async function writeIdentity(value: HostIdentity): Promise<HostIdentity> {
    const file = resolveFilePath();
    await fs.mkdir(path.dirname(file), { recursive: true, mode: 0o700 });
    await fs.writeFile(file, `${JSON.stringify(value)}\n`, { mode: 0o600 });
    await fs.chmod(file, 0o600);
    cached = value;
    return value;
  }

  async function loadFromDiskOrCreate(): Promise<HostIdentity> {
    if (cached) return cached;
    try {
      const parsed: unknown = JSON.parse(await fs.readFile(resolveFilePath(), 'utf8'));
      const valid = parseValidHostIdentity(parsed);
      if (valid) {
        cached = valid;
        return valid;
      }
    } catch {
      /* create the non-secret stable host identifier on first authorization or repair invalid JSON */
    }
    const created: HostIdentity = { hostId: `urn:uuid:${crypto.randomUUID()}` };
    return writeIdentity(created);
  }

  function enqueue(work: () => Promise<HostIdentity>): Promise<HostIdentity> {
    const next = (pendingOperation ?? Promise.resolve(undefined as unknown as HostIdentity))
      .then(() => work(), () => work());
    pendingOperation = next;
    return next.finally(() => {
      if (pendingOperation === next) pendingOperation = undefined;
    });
  }

  return {
    load(): Promise<HostIdentity> {
      if (cached) return Promise.resolve(cached);
      return enqueue(loadFromDiskOrCreate);
    },
    save(value: HostIdentity): Promise<HostIdentity> {
      const valid = parseValidHostIdentity(value);
      if (!valid) throw new Error('Host identity is invalid.');
      return enqueue(() => writeIdentity(valid));
    },
    getCached(): HostIdentity | undefined {
      return cached;
    },
  };
}
