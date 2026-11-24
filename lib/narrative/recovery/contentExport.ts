import type { CreativeProject } from '../../../shared/types.ts';
import { manuscriptSections, manuscriptText } from '../manuscriptModel.ts';
import { registryReport, safeFilename } from '../recovery.ts';

export type ContentExportSelection =
  | { kind: 'manuscript'; sectionIds?: string[] }
  | { kind: 'source-text'; sourceId: string; version: string }
  | { kind: 'generated-story'; artifactId: string }
  | { kind: 'evidence-report'; format: 'json' | 'md' };

export type ContentExportProvenance =
  | 'working-manuscript'
  | 'original-extracted-text'
  | 'generated-artifact'
  | 'evidence-report';

export interface ProjectedExportFile {
  name: string;
  mediaType: 'text/markdown;charset=utf-8' | 'text/plain;charset=utf-8' | 'application/json;charset=utf-8';
  text: string;
  provenance: ContentExportProvenance;
}

function unsupportedSelection(): never {
  throw new Error('Unsupported content export selection.');
}

export function projectContentExport(
  project: CreativeProject,
  selection: ContentExportSelection,
): ProjectedExportFile {
  if (!project || !selection || typeof selection !== 'object') return unsupportedSelection();

  switch (selection.kind) {
    case 'manuscript': {
      const sections = manuscriptSections(project);
      if (new Set(sections.map(section => section.id)).size !== sections.length) {
        throw new Error('The current manuscript contains ambiguous section IDs.');
      }
      let selectedSections = sections;
      if (selection.sectionIds !== undefined) {
        const ids = selection.sectionIds;
        if (!Array.isArray(ids) || ids.length === 0 || ids.some(id => typeof id !== 'string' || !id.trim())) {
          throw new Error('Select at least one valid manuscript section.');
        }
        if (new Set(ids).size !== ids.length) throw new Error('Duplicate manuscript section IDs are not allowed.');
        const wanted = new Set(ids);
        selectedSections = sections.filter(section => wanted.has(section.id));
        if (selectedSections.length !== ids.length) throw new Error('A selected manuscript section does not exist in this version.');
      }
      const selected = selection.sectionIds !== undefined;
      return {
        name: safeFilename(project.name, selected ? 'selected-manuscript' : 'manuscript', 'md'),
        mediaType: 'text/markdown;charset=utf-8',
        text: manuscriptText(selectedSections),
        provenance: 'working-manuscript',
      };
    }
    case 'source-text': {
      if (!selection.sourceId || !selection.version) throw new Error('A source ID and version are required.');
      const matches = project.narrative?.sources.filter(item => item.id === selection.sourceId && item.version === selection.version) ?? [];
      if (matches.length !== 1) throw new Error('The selected source version is missing or ambiguous in this project.');
      const [source] = matches;
      return {
        name: safeFilename(`${project.name}-${source.filename ?? source.id}-${source.version}`, 'original-text', 'txt'),
        mediaType: 'text/plain;charset=utf-8',
        text: source.text,
        provenance: 'original-extracted-text',
      };
    }
    case 'generated-story': {
      if (!selection.artifactId) throw new Error('A generated artifact ID is required.');
      const matches = project.artifacts.filter(item => item.id === selection.artifactId);
      if (matches.length !== 1) throw new Error('The selected generated story artifact is missing or ambiguous in this project.');
      const [artifact] = matches;
      if ((artifact.projectId !== undefined && artifact.projectId !== project.id) ||
        artifact.mode !== 'story' || typeof artifact.storyText !== 'string' || !artifact.storyText) {
        throw new Error('The selected generated story artifact does not exist in this project.');
      }
      return {
        name: safeFilename(`${project.name}-${artifact.id}`, 'generated-story', 'txt'),
        mediaType: 'text/plain;charset=utf-8',
        text: artifact.storyText,
        provenance: 'generated-artifact',
      };
    }
    case 'evidence-report': {
      if (selection.format !== 'json' && selection.format !== 'md') return unsupportedSelection();
      const extension = selection.format === 'json' ? 'json' : 'md';
      return {
        name: safeFilename(project.name, `evidence-report-${selection.format}`, extension),
        mediaType: selection.format === 'json' ? 'application/json;charset=utf-8' : 'text/markdown;charset=utf-8',
        text: registryReport(project, selection.format),
        provenance: 'evidence-report',
      };
    }
    default:
      return unsupportedSelection();
  }
}
