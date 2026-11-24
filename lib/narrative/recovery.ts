import type { CreativeProject } from '../../shared/types.ts';
import { migrateProjectPayload } from '../storageEngine.ts';
import { recordProjectRevision } from '../historyEngine.ts';

const prefix = 'pcc-narrative-backup:';

export interface ProjectBackup {
  format: 'pcc-project-backup';
  version: 1;
  id: string;
  projectId: string;
  revision: number;
  schemaVersion: number;
  label: string;
  createdAt: number;
  bytes: number;
  sha256: string;
  payload: string;
  completeness: 'project';
  pinned: boolean;
}

async function checksum(data: Uint8Array<ArrayBuffer>): Promise<string> {
  const hash = await crypto.subtle.digest('SHA-256', data);
  return Array.from(new Uint8Array(hash), byte => byte.toString(16).padStart(2, '0')).join('');
}

async function verifyRetainedOriginalBytes(project: CreativeProject): Promise<void> {
  for (const source of project.narrative?.sources ?? []) {
    if (!source.originalBytesBase64) continue;
    let bytes: Uint8Array;
    try {
      const binary = atob(source.originalBytesBase64);
      bytes = Uint8Array.from(binary, character => character.charCodeAt(0));
    } catch {
      throw new Error(`Retained source bytes for ${source.filename ?? source.id} are not valid base64.`);
    }
    if (bytes.byteLength !== source.byteLength) throw new Error(`Retained source byte length does not match for ${source.filename ?? source.id}.`);
    if (await checksum(bytes as Uint8Array<ArrayBuffer>) !== source.digest) {
      throw new Error(`Retained source checksum does not match for ${source.filename ?? source.id}.`);
    }
  }
}

export async function createBackup(project: CreativeProject, label: string): Promise<ProjectBackup> {
  const payload = JSON.stringify(project, null, 2);
  const data = new TextEncoder().encode(payload);
  return {
    format: 'pcc-project-backup',
    version: 1,
    id: crypto.randomUUID(),
    projectId: project.id,
    revision: project.revision,
    schemaVersion: project.schemaVersion,
    label,
    createdAt: Date.now(),
    bytes: data.byteLength,
    sha256: await checksum(data),
    payload,
    completeness: 'project',
    pinned: false,
  };
}

export async function verifyBackup(backup: ProjectBackup): Promise<CreativeProject> {
  if (backup.format !== 'pcc-project-backup' || backup.version !== 1 ||
    backup.completeness !== 'project' || typeof backup.payload !== 'string' || !backup.id) {
    throw new Error('Unsupported backup manifest.');
  }
  const data = new TextEncoder().encode(backup.payload);
  if (data.byteLength !== backup.bytes || (await checksum(data)) !== backup.sha256) {
    throw new Error('Backup checksum or size differs from the manifest.');
  }
  const project = migrateProjectPayload(JSON.parse(backup.payload));
  await verifyRetainedOriginalBytes(project);
  if (project.id !== backup.projectId || project.revision !== backup.revision ||
    project.schemaVersion !== backup.schemaVersion) {
    throw new Error('The backup metadata differs from the stored project.');
  }
  return project;
}

export async function saveBackup(project: CreativeProject, label: string, pinned = false): Promise<ProjectBackup> {
  const backup = { ...(await createBackup(project, label)), pinned };
  await verifyBackup(backup);
  const key = prefix + backup.id;
  const value = JSON.stringify(backup);
  localStorage.setItem(key, value);
  if (localStorage.getItem(key) !== value) throw new Error('Could not verify the backup after writing it.');
  return backup;
}

export async function listBackups(projectId: string): Promise<ProjectBackup[]> {
  const keys = Array.from({ length: localStorage.length }, (_, index) => localStorage.key(index))
    .filter((key): key is string => Boolean(key?.startsWith(prefix)));
  const records = await Promise.all(keys.map(async key => {
    try {
      const record = JSON.parse(localStorage.getItem(key) ?? 'null') as ProjectBackup | null;
      if (!record || record.projectId !== projectId || prefix + record.id !== key) return null;
      await verifyBackup(record);
      return record;
    } catch {
      return null;
    }
  }));
  return records.filter((record): record is ProjectBackup => record !== null)
    .sort((a, b) => b.createdAt - a.createdAt || a.id.localeCompare(b.id));
}

export function setBackupPin(backup: ProjectBackup, pinned: boolean): void {
  const key = prefix + backup.id;
  const current = localStorage.getItem(key);
  if (!current) throw new Error('This backup no longer exists.');
  const value = JSON.stringify({ ...JSON.parse(current), pinned });
  localStorage.setItem(key, value);
  if (localStorage.getItem(key) !== value) throw new Error('Could not verify the updated backup.');
}

export async function deleteBackup(backup: ProjectBackup): Promise<void> {
  if (!navigator.locks) throw new Error('Backup deletion requires browser lock support.');
  await navigator.locks.request(prefix + backup.projectId, async () => {
    const verified = await listBackups(backup.projectId);
    const current = verified.find(({ id }) => id === backup.id);
    if (!current || current.pinned || verified.length <= 1) {
      throw new Error('Keep at least one verified backup. Unpin a backup before deleting it.');
    }
    localStorage.removeItem(prefix + backup.id);
  });
}

export function prepareBackupCopy(project: CreativeProject): CreativeProject {
  const id = crypto.randomUUID();
  return {
    ...project,
    id,
    name: `${project.name} (restored copy)`,
    updatedAt: Date.now(),
    persistedRevision: undefined,
    artifacts: project.artifacts.map(artifact => ({ ...artifact, projectId: id })),
  };
}

export async function parseProjectBackup(rawJson: string): Promise<CreativeProject> {
  const parsed = JSON.parse(rawJson) as unknown;
  const project = parsed && typeof parsed === 'object' && 'format' in parsed
    ? verifyBackup(parsed as ProjectBackup)
    : Promise.resolve(migrateProjectPayload(parsed));
  const verified = await project;
  await verifyRetainedOriginalBytes(verified);
  return verified;
}

export function prepareBackupReplacement(current: CreativeProject, backup: CreativeProject): CreativeProject {
  if (current.id !== backup.id) throw new Error('Replacement requires a backup from the same project.');
  if (backup.schemaVersion < current.schemaVersion) {
    throw new Error('An older schema can be restored as a copy. Replacement requires the current schema.');
  }
  return recordProjectRevision({
    ...backup,
    revision: Math.max(current.revision, backup.revision),
    persistedRevision: current.revision,
  }, 'Restore project backup', `Restored backup revision ${backup.revision} after creating a separate safety checkpoint.`);
}

export function safeFilename(name: string, suffix: string, extension: 'json' | 'md' | 'txt'): string {
  const clean = name.normalize('NFC').replace(/[^\p{L}\p{N}\p{M}_-]+/gu, '-').replace(/^-+|-+$/g, '');
  const base = Array.from(clean).slice(0, 64).join('') || 'project';
  const safeBase = /^(con|prn|aux|nul|com[0-9¹²³]|lpt[0-9¹²³])$/i.test(base) ? 'project-' + base : base;
  return `${safeBase}${suffix ? '-' + suffix : ''}.${extension}`;
}

export function registryReport(project: CreativeProject, format: 'json' | 'md'): string {
  const { claims = [], issues = [], audit = [], sources = [] } = project.narrative ?? {};
  const data = {
    projectId: project.id,
    revision: project.revision,
    sources: sources.map(source => ({
      id: source.id,
      version: source.version,
      digest: source.digest,
      filename: source.filename,
      mediaType: source.mediaType,
      byteLength: source.byteLength,
      retention: source.retention,
      parserVersion: source.parserVersion,
      createdAt: source.createdAt,
      characterCount: source.text.length,
      blocks: source.blocks,
      analysisCoverage: source.analysisCoverage,
    })),
    claims,
    issues,
    audit,
  };
  const json = JSON.stringify(data, null, 2);
  if (format === 'json') return json;
  let fenceSize = 3;
  for (const match of json.matchAll(/`+/g)) fenceSize = Math.max(fenceSize, match[0].length + 1);
  const fence = '`'.repeat(fenceSize);
  return `# Evidence, issues and audit\n\n${fence}json\n${json}\n${fence}\n`;
}
