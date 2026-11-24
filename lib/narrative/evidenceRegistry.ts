import { narrativeSchema } from '../../shared/narrativeSchemas.ts';
import type { CreativeProject } from '../../shared/types.ts';

export function isTextBoundary(text: string, offset: number): boolean {
  const next = text.charCodeAt(offset);
  const previous = text.charCodeAt(offset - 1);
  return !(previous >= 0xd800 && previous <= 0xdbff && next >= 0xdc00 && next <= 0xdfff);
}

export function verifyTextSpan(
  text: string,
  { start, end, excerpt }: { start: number; end: number; excerpt: string },
): boolean {
  return Number.isInteger(start) && Number.isInteger(end) && start >= 0 && end <= text.length &&
    start < end && isTextBoundary(text, start) && isTextBoundary(text, end) &&
    text.slice(start, end) === excerpt;
}

function assertUnique(ids: string[], label: string) {
  if (new Set(ids).size !== ids.length) throw new Error(`Duplicate ${label} ID.`);
}

export function validateNarrativeRecords(project: CreativeProject): void {
  const records = narrativeSchema.parse(project.narrative);
  const versions = new Set(records.versions.map(({ id }) => id));
  assertUnique(records.versions.map(({ id }) => id), 'manuscript version');
  assertUnique(records.sources.map(({ id, version }) => JSON.stringify([id, version])), 'source version');
  assertUnique(records.claims.map(({ id }) => id), 'claim');
  assertUnique(records.issues.map(({ id }) => id), 'issue');
  assertUnique(records.issues.map(({ fingerprint }) => fingerprint), 'issue fingerprint');
  assertUnique(records.audit.map(({ id }) => id), 'audit');
  assertUnique(records.sectionVersions.map(({ id }) => id), 'section version');
  const allSectionIds = new Set(records.sectionVersions.map(({ section }) => section.id));
  const sectionByVersionId = new Map(records.sectionVersions.map(({ id, section }) => [id, section]));
  for (const version of records.versions) {
    const sections = version.sectionVersionIds.map(id => {
      const section = sectionByVersionId.get(id);
      if (!section) throw new Error('Missing manuscript section version.');
      return section;
    });
    assertUnique(sections.map(({ id }) => id), 'section');
    const chapters = new Set(sections.filter(({ kind }) => kind === 'chapter').map(({ id }) => id));
    for (const section of sections) {
      if (section.chapterId && (section.kind !== 'scene' || !chapters.has(section.chapterId))) {
        throw new Error('Missing manuscript chapter.');
      }
    }
    if (version.styleProfile) {
      if (version.styleProfile.projectId !== project.id) throw new Error('Style profile belongs to a different project.');
      assertUnique(version.styleProfile.observations.map(({ id }) => id), 'style observation');
      for (const observation of version.styleProfile.observations) {
        if (observation.scope.kind === 'section' && !allSectionIds.has(observation.scope.sectionId)) {
          throw new Error('Style observation references an unknown manuscript section.');
        }
        const source = records.sources.find(({ id, version: sourceVersion, digest }) =>
          id === observation.evidence.recordId && sourceVersion === observation.evidence.version && digest === observation.evidence.digest);
        if (!source || observation.evidence.end - observation.evidence.start !== observation.evidence.excerpt.length ||
          source.text.slice(observation.evidence.start, observation.evidence.end) !== observation.evidence.excerpt) {
          throw new Error('Invalid style observation source evidence.');
        }
      }
    }
  }
  const checkVersion = (id: unknown) => {
    if (id !== undefined && (typeof id !== 'string' || !versions.has(id))) {
      throw new Error('Missing manuscript version referenced by project history.');
    }
  };
  checkVersion(project.snapshot.manuscriptVersionId);
  for (const entry of [
    ...project.revisions, ...(project.undoHistory?.past ?? []), ...(project.undoHistory?.future ?? []),
  ]) {
    checkVersion(entry.snapshot.manuscriptVersionId);
  }
  for (const entry of records.audit) {
    checkVersion(entry.before);
    checkVersion(entry.after);
    if (entry.artifact) {
      const artifact = project.artifacts.find(({ id }) => id === entry.artifact?.artifactId);
      if (!artifact || artifact.mode !== 'story' || artifact.projectId !== project.id ||
        !verifyTextSpan(artifact.storyText ?? '', entry.artifact)) {
        throw new Error('Invalid generated story evidence.');
      }
    }
  }
  for (const record of [...records.claims, ...records.issues]) {
    for (const anchor of record.anchors) {
      const source = records.sources.find(({ id, version, digest }) =>
        id === anchor.sourceId && version === anchor.version && digest === anchor.digest);
      if (!source || !verifyTextSpan(source.text, anchor)) throw new Error('Invalid original source evidence.');
    }
  }
  for (const proposal of records.proposals ?? []) {
    const source = records.sources.find(({ id, version, digest }) =>
      id === proposal.evidence.sourceId && version === proposal.evidence.version && digest === proposal.evidence.digest);
    if (!source || !verifyTextSpan(source.text, proposal.evidence)) throw new Error('Invalid proposal source evidence.');
  }
}
