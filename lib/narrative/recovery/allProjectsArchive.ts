import { strFromU8, strToU8, Unzip, UnzipInflate, zipSync } from 'fflate';
import type { CreativeProject } from '../../../shared/types.ts';
import { makeStableId } from '../../canonicalModel.ts';
import { migrateProjectPayload } from '../../storageEngine.ts';

export const ARCHIVE_FORMAT_VERSION = 1;
const MAX_ARCHIVE_PROJECTS = 100;
const MAX_ARCHIVE_EXPANDED_BYTES = 48 * 1024 * 1024;

export interface PortableWorkspacePreferences {
  darkMode?: boolean;
  retentionEnabled?: boolean;
  retentionMaxBackups?: number;
  autoBackupEnabled?: boolean;
}

export interface PortableArchiveManifestEntry {
  projectId: string;
  name: string;
  revision: number;
  schemaVersion: number;
  filePath: string;
  sha256: string;
  byteLength: number;
  extractedOnlySources: number;
  retainedOriginalSources: number;
}

export interface PortableAllProjectsManifest {
  formatVersion: number;
  exportedAt: string;
  projectCount: number;
  entries: PortableArchiveManifestEntry[];
  preferences?: PortableWorkspacePreferences;
  notes: string[];
}

export interface VerifiedArchiveRestoreResult {
  ok: true;
  manifest: PortableAllProjectsManifest;
  projects: CreativeProject[];
  remappedIds: Array<{ oldId: string; newId: string; name: string }>;
  warnings: string[];
}

async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  const digest = await crypto.subtle.digest('SHA-256', copy.buffer);
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('');
}

function isSafeArchivePath(path: string): boolean {
  if (!path || path.startsWith('/') || path.includes('\\') || path.includes('..')) return false;
  if (path.split('/').some((part) => part.length === 0 || part === '.')) return false;
  return /^[a-z0-9._/-]+$/i.test(path);
}

/**
 * Exports all projects (plus optional non-secret workspace preferences — never credentials)
 * as a verified portable ZIP archive with manifest and SHA-256 checksums.
 */
export async function buildAllProjectsArchiveZip(
  projects: readonly CreativeProject[],
  preferences?: PortableWorkspacePreferences
): Promise<{ bytes: Uint8Array; manifest: PortableAllProjectsManifest; filename: string }> {
  if (projects.length === 0) throw new Error('There are no projects to archive.');
  if (projects.length > MAX_ARCHIVE_PROJECTS) {
    throw new Error(`Archive export is limited to ${MAX_ARCHIVE_PROJECTS} projects at once.`);
  }

  const files: Record<string, Uint8Array> = {};
  const entries: PortableArchiveManifestEntry[] = [];
  const notes: string[] = [
    'Contains full project snapshots, revisions, narrative records, and artifacts. Never includes API keys or server secrets.',
  ];
  let totalExtractedOnly = 0;

  for (let idx = 0; idx < projects.length; idx += 1) {
    const proj = projects[idx];
    const safeId = proj.id.replace(/[^a-z0-9_-]/gi, '_').slice(0, 60) || `project_${idx + 1}`;
    const filePath = `projects/${String(idx + 1).padStart(2, '0')}-${safeId}.json`;
    const jsonBytes = strToU8(JSON.stringify(proj, null, 2));
    const checksum = await sha256Hex(jsonBytes);
    const sources = proj.narrative?.sources ?? [];
    const extractedOnlySources = sources.filter((s) => s.retention !== 'original-and-extracted').length;
    const retainedOriginalSources = sources.filter((s) => s.retention === 'original-and-extracted').length;
    totalExtractedOnly += extractedOnlySources;

    files[filePath] = jsonBytes;
    entries.push({
      projectId: proj.id,
      name: proj.name,
      revision: proj.revision,
      schemaVersion: proj.schemaVersion,
      filePath,
      sha256: checksum,
      byteLength: jsonBytes.byteLength,
      extractedOnlySources,
      retainedOriginalSources,
    });
  }

  if (totalExtractedOnly > 0) {
    notes.push(
      `${totalExtractedOnly} imported source(s) use extracted-only retention; original binary file bytes were omitted at import time and are not in this archive.`
    );
  }

  const manifest: PortableAllProjectsManifest = {
    formatVersion: ARCHIVE_FORMAT_VERSION,
    exportedAt: new Date().toISOString(),
    projectCount: entries.length,
    entries,
    ...(preferences ? { preferences } : {}),
    notes,
  };
  files['manifest.json'] = strToU8(JSON.stringify(manifest, null, 2));

  const bytes = zipSync(files, { level: 6 });
  const stamp = new Date().toISOString().replace(/[:.]/g, '').replace('T', '-').slice(0, 15) + 'Z';
  return {
    bytes,
    manifest,
    filename: `proactive-co-creator-all-projects-${entries.length}-${stamp}.zip`,
  };
}

/**
 * Remaps a colliding project ID cleanly across the project record and internal narrative references.
 */
export function remapProjectIdOnCollision(
  project: CreativeProject,
  existingIds: ReadonlySet<string>
): { project: CreativeProject; remapped: boolean; oldId: string } {
  const oldId = project.id;
  if (!existingIds.has(oldId)) {
    return { project, remapped: false, oldId };
  }
  const newId = makeStableId('proj_restored');
  const nextArtifacts = project.artifacts.map((art) => ({
    ...art,
    projectId: art.projectId === oldId ? newId : art.projectId,
  }));
  const nextNarrative = project.narrative
    ? {
        ...project.narrative,
        versions: project.narrative.versions.map((v) =>
          v.styleProfile
            ? {
                ...v,
                styleProfile: {
                  ...v.styleProfile,
                  projectId: v.styleProfile.projectId === oldId ? newId : v.styleProfile.projectId,
                },
              }
            : v
        ),
        opportunities: project.narrative.opportunities?.map((o) => ({
          ...o,
          projectId: o.projectId === oldId ? newId : o.projectId,
        })),
      }
    : undefined;

  return {
    project: {
      ...project,
      id: newId,
      name: `${project.name} (Restored Copy)`,
      persistedRevision: undefined,
      artifacts: nextArtifacts,
      ...(nextNarrative ? { narrative: nextNarrative } : {}),
    },
    remapped: true,
    oldId,
  };
}

/**
 * Parses and verifies an All-Projects Portable Archive (ZIP), enforcing path safety,
 * expanded size bounds, duplicate entry checks, SHA-256 checksum verification, schema
 * migration/validation, and collision ID remapping.
 */
export async function parseAndVerifyAllProjectsArchive(
  zipBytes: Uint8Array,
  existingProjectIds: ReadonlySet<string>
): Promise<VerifiedArchiveRestoreResult> {
  if (!zipBytes.byteLength) throw new Error('The archive file is empty.');
  if (zipBytes.byteLength > MAX_ARCHIVE_EXPANDED_BYTES) {
    throw new Error('The archive exceeds the maximum safe size limit (48 MiB).');
  }

  const entriesMap: Record<string, Uint8Array> = Object.create(null) as Record<string, Uint8Array>;
  let totalExpanded = 0;
  let entryCount = 0;
  const unzipper = new Unzip();
  unzipper.register(UnzipInflate);
  const extraction = new Promise<void>((resolve, reject) => {
    let settled = false;
    const fail = (error: Error) => { if (!settled) { settled = true; reject(error); } };
    unzipper.onfile = (file) => {
      const path = file.name;
      entryCount += 1;
      if (entryCount > MAX_ARCHIVE_PROJECTS + 1) return fail(new Error('Archive contains more entries than the supported project limit.'));
      if (!isSafeArchivePath(path)) return fail(new Error(`Archive contains an unsafe path: "${path}".`));
      if (Object.hasOwn(entriesMap, path)) return fail(new Error(`Archive contains a duplicate entry: "${path}".`));
      if (typeof file.originalSize === 'number' && file.originalSize > MAX_ARCHIVE_EXPANDED_BYTES) {
        return fail(new Error('Archive entry expands beyond the safe 48 MiB restoration limit.'));
      }
      const chunks: Uint8Array[] = [];
      let entrySize = 0;
      file.ondata = (error, chunk, final) => {
        if (error) return fail(new Error('The selected file is not a valid ZIP archive.'));
        entrySize += chunk.byteLength;
        totalExpanded += chunk.byteLength;
        if (entrySize > MAX_ARCHIVE_EXPANDED_BYTES || totalExpanded > MAX_ARCHIVE_EXPANDED_BYTES) {
          return fail(new Error('Archive expands beyond the safe 48 MiB restoration limit.'));
        }
        chunks.push(chunk);
        if (final && !settled) {
          const data = new Uint8Array(entrySize);
          let offset = 0;
          for (const part of chunks) { data.set(part, offset); offset += part.byteLength; }
          entriesMap[path] = data;
        }
      };
      file.start();
    };
    try {
      const inputChunkBytes = 64 * 1024;
      for (let offset = 0; offset < zipBytes.byteLength && !settled; offset += inputChunkBytes) {
        const end = Math.min(offset + inputChunkBytes, zipBytes.byteLength);
        unzipper.push(zipBytes.subarray(offset, end), end === zipBytes.byteLength);
      }
      if (!settled) { settled = true; resolve(); }
    } catch {
      fail(new Error('The selected file is not a valid ZIP archive.'));
    }
  });
  await extraction;

  const manifestBytes = entriesMap['manifest.json'];
  if (!manifestBytes) {
    throw new Error('Archive is missing manifest.json.');
  }

  let manifest: PortableAllProjectsManifest;
  try {
    manifest = JSON.parse(strFromU8(manifestBytes)) as PortableAllProjectsManifest;
  } catch {
    throw new Error('Archive manifest.json is malformed JSON.');
  }

  if (manifest.formatVersion !== ARCHIVE_FORMAT_VERSION || !Array.isArray(manifest.entries)) {
    throw new Error('Unsupported or malformed archive manifest format.');
  }
  if (
    manifest.entries.length === 0 ||
    manifest.entries.length > MAX_ARCHIVE_PROJECTS ||
    manifest.projectCount !== manifest.entries.length
  ) {
    throw new Error('Archive project count is empty or exceeds the supported limit.');
  }

  const seenPaths = new Set<string>();
  const seenIds = new Set<string>(existingProjectIds);
  const projects: CreativeProject[] = [];
  const remappedIds: Array<{ oldId: string; newId: string; name: string }> = [];
  const warnings: string[] = [];

  for (const entry of manifest.entries) {
    if (
      !entry ||
      typeof entry.filePath !== 'string' ||
      !isSafeArchivePath(entry.filePath) ||
      seenPaths.has(entry.filePath) ||
      typeof entry.projectId !== 'string' ||
      typeof entry.name !== 'string' ||
      !Number.isSafeInteger(entry.revision) || entry.revision < 1 ||
      !Number.isSafeInteger(entry.schemaVersion) || entry.schemaVersion < 1 ||
      !Number.isSafeInteger(entry.byteLength) || entry.byteLength < 0 ||
      typeof entry.sha256 !== 'string' || !/^[a-f0-9]{64}$/i.test(entry.sha256) ||
      !Number.isSafeInteger(entry.extractedOnlySources) || entry.extractedOnlySources < 0 ||
      !Number.isSafeInteger(entry.retainedOriginalSources) || entry.retainedOriginalSources < 0
    ) {
      throw new Error(`Archive manifest contains an invalid or duplicate path: "${typeof entry?.filePath === 'string' ? entry.filePath : '(unknown)'}".`);
    }
    seenPaths.add(entry.filePath);

    const payloadBytes = entriesMap[entry.filePath];
    if (!payloadBytes) {
      throw new Error(`Archive is missing project file "${entry.filePath}".`);
    }
    if (payloadBytes.byteLength !== entry.byteLength) {
      throw new Error(`Byte length mismatch for "${entry.filePath}".`);
    }
    const actualHash = await sha256Hex(payloadBytes);
    if (actualHash !== entry.sha256) {
      throw new Error(`SHA-256 checksum verification failed for "${entry.filePath}".`);
    }

    let rawProject: unknown;
    try {
      rawProject = JSON.parse(strFromU8(payloadBytes));
    } catch {
      throw new Error(`Project file "${entry.filePath}" is not valid JSON.`);
    }
    if (!rawProject || typeof rawProject !== 'object' || Array.isArray(rawProject)) {
      throw new Error(`Project file "${entry.filePath}" is not a valid project object.`);
    }
    const archivedProject = rawProject as Record<string, unknown>;
    if (
      archivedProject.id !== entry.projectId ||
      archivedProject.name !== entry.name ||
      archivedProject.revision !== entry.revision ||
      archivedProject.schemaVersion !== entry.schemaVersion
    ) {
      throw new Error(`Manifest metadata does not match project file "${entry.filePath}".`);
    }
    const migrated = migrateProjectPayload(rawProject);
    const { project: safeProj, remapped, oldId } = remapProjectIdOnCollision(migrated, seenIds);
    seenIds.add(safeProj.id);
    if (remapped) {
      remappedIds.push({ oldId, newId: safeProj.id, name: safeProj.name });
    }
    if (entry.extractedOnlySources > 0) {
      warnings.push(
        `"${safeProj.name}" has ${entry.extractedOnlySources} source(s) stored as extracted text only (original file bytes were not retained).`
      );
    }
    projects.push(safeProj);
  }

  const expectedArchivePaths = new Set(['manifest.json', ...seenPaths]);
  for (const path of Object.keys(entriesMap)) {
    if (!expectedArchivePaths.has(path)) {
      throw new Error(`Archive contains an unlisted entry: "${path}".`);
    }
  }

  return {
    ok: true,
    manifest,
    projects,
    remappedIds,
    warnings,
  };
}
