/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { manuscriptSections } from '../narrative/manuscriptModel';
import { safeFilename } from '../narrative/recovery';
import type { ContentExportSelection } from '../narrative/recovery/contentExport';
import {
  exportProjectToJson,
  exportStoryBibleMarkdown,
} from '../storageEngine';
import type { CreativeProject } from '../../shared/types';

export interface ContentExportEntry {
  id: string;
  label: string;
  selection: ContentExportSelection;
}

export function downloadTextFile(
  filename: string,
  content: string,
  mimeType: string = 'text/plain;charset=utf-8'
): void {
  const element = document.createElement('a');
  const file = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(file);
  element.href = url;
  element.download = filename;
  document.body.appendChild(element);
  element.click();
  document.body.removeChild(element);
  setTimeout(() => URL.revokeObjectURL(url), 100);
}

export function downloadBinaryFile(
  filename: string,
  content: Uint8Array,
  mimeType: string
): void {
  const blob = new Blob([content as BlobPart], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const element = document.createElement('a');
  element.href = url;
  element.download = filename;
  document.body.appendChild(element);
  element.click();
  document.body.removeChild(element);
  setTimeout(() => URL.revokeObjectURL(url), 100);
}

export function buildContentExportEntries(project: CreativeProject): ContentExportEntry[] {
  return [
    ...(project.snapshot.manuscriptVersionId
      ? [
          {
            id: 'manuscript:full',
            label: 'Working manuscript · Markdown',
            selection: { kind: 'manuscript', format: 'md' } as const,
          },
          {
            id: 'manuscript:txt',
            label: 'Working manuscript · Plain Text',
            selection: { kind: 'manuscript', format: 'txt' } as const,
          },
        ]
      : []),
    ...manuscriptSections(project).map((section) => ({
      id: `manuscript-section:${section.id}`,
      label: `${section.kind === 'chapter' ? 'Chapter' : 'Scene'} · ${section.title}`,
      selection: { kind: 'manuscript' as const, sectionIds: [section.id] },
    })),
    ...project.artifacts.flatMap((artifact) =>
      artifact.mode === 'story' && artifact.storyText
        ? [
            {
              id: `artifact:${artifact.id}`,
              label: `Generated story · ${new Date(artifact.createdAt).toLocaleString()}`,
              selection: { kind: 'generated-story', artifactId: artifact.id } as const,
            },
          ]
        : []
    ),
    ...(project.narrative?.sources ?? []).map((source) => ({
      id: `source:${JSON.stringify([source.id, source.version])}`,
      label: `Original source text · ${source.id} / ${source.version}`,
      selection: {
        kind: 'source-text',
        sourceId: source.id,
        version: source.version,
      } as const,
    })),
    { id: 'story-bible:md', label: 'Story Bible · Markdown', selection: { kind: 'story-bible' } },
    { id: 'prompt:txt', label: 'Refined Prompt · Text', selection: { kind: 'prompt' } },
    {
      id: 'issues-audit:md',
      label: 'Issues & Audit · Markdown',
      selection: { kind: 'issues-audit', format: 'md' },
    },
    {
      id: 'evidence-report:md',
      label: 'Evidence report · Markdown',
      selection: { kind: 'evidence-report', format: 'md' },
    },
    {
      id: 'evidence-report:json',
      label: 'Evidence report · JSON',
      selection: { kind: 'evidence-report', format: 'json' },
    },
  ];
}

export async function triggerManuscriptMarkdownDownload(project: CreativeProject): Promise<void> {
  const { projectContentExport } = await import('../narrative/recovery/contentExport');
  const file = projectContentExport(project, { kind: 'manuscript', format: 'md' });
  downloadTextFile(file.name, file.text, file.mediaType);
}

export async function triggerManuscriptTextDownload(project: CreativeProject): Promise<void> {
  const { projectContentExport } = await import('../narrative/recovery/contentExport');
  const file = projectContentExport(project, { kind: 'manuscript', format: 'txt' });
  downloadTextFile(file.name, file.text, file.mediaType);
}

export async function triggerManuscriptDocxDownload(project: CreativeProject): Promise<void> {
  const { buildDeterministicExportFilename, buildManuscriptDocxBytes } = await import('../narrative/recovery/docxExport');
  const sections = manuscriptSections(project);
  const bytes = buildManuscriptDocxBytes(project.name, sections);
  const filename = buildDeterministicExportFilename({
    projectName: project.name,
    projectId: project.id,
    kind: 'manuscript',
    revision: project.revision,
    ext: 'docx',
  });
  downloadBinaryFile(
    filename,
    bytes,
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
  );
}

export function triggerProjectBackupDownload(
  project: CreativeProject,
  suffix = 'project'
): void {
  downloadTextFile(
    safeFilename(project.name, suffix, 'json'),
    exportProjectToJson(project),
    'application/json;charset=utf-8'
  );
}

export function triggerStoryBibleMarkdownDownload(project: CreativeProject): void {
  downloadTextFile(
    safeFilename(project.name, 'story-bible', 'md'),
    exportStoryBibleMarkdown(project),
    'text/markdown;charset=utf-8'
  );
}

export function triggerRefinedPromptDownload(project: CreativeProject): void {
  downloadTextFile(
    safeFilename(project.name, 'refined-prompt', 'txt'),
    project.snapshot.refinedPrompt,
    'text/plain;charset=utf-8'
  );
}
