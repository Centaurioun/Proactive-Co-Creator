import { strToU8, zipSync } from 'fflate';
import type { CreativeProject } from '../../../shared/types.ts';
import { projectContentExport, type ContentExportSelection } from './contentExport.ts';
import { safeFilename } from '../recovery.ts';

export interface ContentBundle {
  name: string;
  bytes: Uint8Array;
  manifest: string;
}

/** Build a portable content bundle. This deliberately does not represent a full project backup. */
export async function projectContentBundle(
  project: CreativeProject,
  selections: ContentExportSelection[],
): Promise<ContentBundle> {
  if (!Array.isArray(selections) || selections.length === 0) {
    throw new Error('Select at least one content item for the bundle.');
  }
  const files = selections.map(selection => projectContentExport(project, selection));
  const names = files.map(file => file.name);
  if (new Set(names).size !== names.length) throw new Error('Selected content produces duplicate filenames.');

  const manifestEntries = await Promise.all(files.map(async file => {
    const digest = await globalThis.crypto.subtle.digest('SHA-256', new TextEncoder().encode(file.text));
    const sha256 = Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('');
    return { path: file.name, mediaType: file.mediaType, provenance: file.provenance, byteLength: new TextEncoder().encode(file.text).byteLength, sha256 };
  }));
  const manifest = `${JSON.stringify({ format: 'proactive-co-creator-content-bundle', version: 1, projectId: project.id, files: manifestEntries }, null, 2)}\n`;
  const archive: Record<string, Uint8Array> = { 'manifest.json': strToU8(manifest) };
  for (const file of files) archive[file.name] = strToU8(file.text);
  return {
    name: safeFilename(project.name, 'selected-content-bundle', 'json').replace(/\.json$/u, '.zip'),
    bytes: zipSync(archive, { level: 6 }),
    manifest,
  };
}
