import type { ArtifactAnchor, ManuscriptSection } from '../../shared/narrativeTypes.ts';
import type { CreativeProject } from '../../shared/types.ts';
import type { UndoRedoState } from '../historyEngine.ts';
import { commitSnapshotTransaction } from '../projectController.ts';
import { NARRATIVE_SCHEMA_VERSION } from '../storageEngine.ts';
import { recordNarrativeChange } from './changeAudit.ts';
import { isTextBoundary, validateNarrativeRecords, verifyTextSpan } from './evidenceRegistry.ts';
import { invalidateTargetEvidence } from './issueRegistry.ts';
import { createStyleProfile, type StyleProfile } from './context/styleProfile.ts';

const empty: ManuscriptSection[] = [];
export function manuscriptSections(project: CreativeProject): ManuscriptSection[] {
  const records = project.narrative;
  const version = records?.versions.find(({ id }) => id === project.snapshot.manuscriptVersionId);
  if (!records || !version) return empty;
  const indices = new Set(version.sectionVersionIds);
  const byId = new Map(records.sectionVersions.filter(record => indices.has(record.id))
    .map(record => [record.id, record.section]));
  return version.sectionVersionIds.map(id => {
    const section = byId.get(id);
    if (!section) throw new Error('Missing manuscript section version.');
    return section;
  });
}

type Operation =
  | { kind: 'add'; section: ManuscriptSection }
  | { kind: 'edit'; id: string; updates: Partial<Pick<ManuscriptSection, 'title' | 'text' | 'chapterId' | 'synopsis' | 'pov' | 'status' | 'location' | 'chronology' | 'purpose' | 'characters'>> }
  | { kind: 'delete' | 'merge'; id: string }
  | { kind: 'move'; id: string; direction: -1 | 1 }
  | { kind: 'split'; id: string; offset: number };

export function applyManuscriptOperation(sections: ManuscriptSection[], operation: Operation): ManuscriptSection[] {
  if (operation.kind === 'add') return [...sections, operation.section];
  const index = sections.findIndex(({ id }) => id === operation.id);
  if (index < 0) throw new Error('This manuscript section no longer exists.');
  const current = sections[index];
  const next = [...sections];
  switch (operation.kind) {
    case 'edit':
      next[index] = { ...current, ...operation.updates };
      return next;
    case 'delete':
      return sections.filter(({ id }) => id !== current.id)
        .map(section => section.chapterId === current.id ? { ...section, chapterId: undefined } : section);
    case 'move': {
      const target = index + operation.direction;
      if (target >= 0 && target < next.length) [next[index], next[target]] = [next[target], next[index]];
      return next;
    }
    case 'split': {
      const { offset } = operation;
      if (current.kind !== 'scene' || !Number.isInteger(offset) || offset <= 0 ||
        offset >= current.text.length || !isTextBoundary(current.text, offset)) {
        throw new Error('Choose a valid text boundary inside the scene.');
      }
      next.splice(index, 1, { ...current, text: current.text.slice(0, offset) }, {
        ...current,
        id: crypto.randomUUID(),
        title: '',
        derivedFrom: [current.id],
        text: current.text.slice(offset),
      });
      return next;
    }
    case 'merge': {
      const following = next[index + 1];
      if (current.kind !== 'scene' || following?.kind !== 'scene' || current.chapterId !== following.chapterId) {
        throw new Error('Merge requires the next scene to belong to the same chapter.');
      }
      next.splice(index, 2, {
        ...current,
        text: current.text + following.text,
        derivedFrom: [...new Set([...(current.derivedFrom ?? []), following.id, ...(following.derivedFrom ?? [])])]
          .filter(id => id !== current.id),
      });
      return next;
    }
  }
}

export interface NarrativeBase {
  projectId: string;
  revision: number;
  manuscriptVersionId?: string;
}

export function narrativeBase(project: CreativeProject): NarrativeBase {
  return { projectId: project.id, revision: project.revision, manuscriptVersionId: project.snapshot.manuscriptVersionId };
}

export function prepareManuscriptChange(
  project: CreativeProject,
  undo: UndoRedoState,
  base: NarrativeBase,
  sections: ManuscriptSection[],
  artifact?: ArtifactAnchor,
  styleProfile?: StyleProfile,
) {
  if (base.projectId !== project.id || base.revision !== project.revision ||
    base.manuscriptVersionId !== project.snapshot.manuscriptVersionId) {
    throw new Error('The project changed. Keep a copy of the draft and reopen the latest version before applying it.');
  }
  const id = crypto.randomUUID();
  const records = project.narrative ?? { versions: [], sectionVersions: [], sources: [], claims: [], issues: [], audit: [] };
  const previousVersion = records.versions.find(version => version.id === base.manuscriptVersionId);
  const previousStyleProfile = previousVersion?.styleProfile ?? createStyleProfile(project.id);
  if (styleProfile && styleProfile.projectId !== project.id) throw new Error('Style profile belongs to a different project.');
  const styleProfileChanged = styleProfile !== undefined && JSON.stringify(styleProfile) !== JSON.stringify(previousStyleProfile);
  if (JSON.stringify(manuscriptSections(project)) === JSON.stringify(sections) && !styleProfileChanged) return null;
  const nextStyleProfile = styleProfile?.observations.length ? styleProfile : previousVersion?.styleProfile;
  const previousSectionRefs = new Set(previousVersion?.sectionVersionIds);
  const previousBySectionId = new Map(records.sectionVersions
    .filter(record => previousSectionRefs.has(record.id))
    .map(record => [record.section.id, record]));
  const previousSections = manuscriptSections(project);
  const oldSections = new Map(previousSections.map(section => [section.id, JSON.stringify(section)]));
  const nextSections = new Map(sections.map(section => [section.id, JSON.stringify(section)]));
  const changedTargets = new Set<string>();
  for (const [id, value] of oldSections) if (nextSections.get(id) !== value) changedTargets.add(id);
  for (const id of nextSections.keys()) if (!oldSections.has(id)) changedTargets.add(id);
  const sectionVersions = [...records.sectionVersions];
  const sectionVersionIds = sections.map(section => {
    const previous = previousBySectionId.get(section.id);
    if (previous && JSON.stringify(previous.section) === JSON.stringify(section)) return previous.id;
    const next = { id: crypto.randomUUID(), section };
    sectionVersions.push(next);
    return next.id;
  });
  const label = artifact ? 'Adopt generated story' : 'Edit manuscript';
  const result = commitSnapshotTransaction(
    { ...project, schemaVersion: NARRATIVE_SCHEMA_VERSION, narrative: { ...invalidateTargetEvidence(records, [...changedTargets]), sectionVersions, versions: [...records.versions, { id, sectionVersionIds, ...(nextStyleProfile ? { styleProfile: nextStyleProfile } : {}) }] } },
    undo,
    { ...project.snapshot, manuscriptVersionId: id },
    label,
  );
  const audited = recordNarrativeChange(project, result.project, artifact ? 'adopt' : 'write', label, artifact);
  validateNarrativeRecords(audited);
  return { ...result, project: audited };
}

export function adoptGeneratedText(
  project: CreativeProject,
  anchor: ArtifactAnchor,
  operation: 'append' | 'new-scene' | 'replace',
  sectionId: string,
): ManuscriptSection[] {
  const artifact = project.artifacts.find(({ id }) => id === anchor.artifactId);
  if (!artifact || artifact.projectId !== project.id || artifact.mode !== 'story' ||
    !verifyTextSpan(artifact.storyText ?? '', anchor)) {
    throw new Error('The selected generated passage is no longer available in this project.');
  }
  const sections = manuscriptSections(project);
  if (operation === 'new-scene') {
    return [...sections, { id: crypto.randomUUID(), kind: 'scene', title: '', text: anchor.excerpt }];
  }
  const section = sections.find(({ id }) => id === sectionId);
  if (!section || section.kind !== 'scene') throw new Error('Select a manuscript scene.');
  const text = operation === 'replace' || !section.text ? anchor.excerpt : section.text + '\n\n' + anchor.excerpt;
  return applyManuscriptOperation(sections, { kind: 'edit', id: section.id, updates: { text } });
}

export function manuscriptText(sections: ManuscriptSection[]): string {
  return sections.map(section => {
    const heading = section.title ? `${section.kind === 'chapter' ? '#' : '##'} ${section.title}\n\n` : '';
    return heading + section.text;
  }).join('\n\n');
}
