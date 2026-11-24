import assert from 'node:assert/strict';
import test from 'node:test';
import { createSampleProject } from '../lib/canonicalModel.ts';
import { projectContentExport } from '../lib/narrative/recovery/contentExport.ts';

function projectFixture() {
  const project = createSampleProject(1);
  project.name = '../İpek/CON';
  project.snapshot.manuscriptVersionId = 'mv-1';
  project.narrative = {
    versions: [{ id: 'mv-1', sectionVersionIds: ['sec-2-version', 'sec-1-version'] }],
    sectionVersions: [
      { id: 'sec-1-version', section: { id: 'sec-1', kind: 'scene', title: 'İlk', text: 'Birinci sahne.' } },
      { id: 'sec-2-version', section: { id: 'sec-2', kind: 'chapter', title: 'İkinci', text: 'İkinci bölüm.' } },
    ],
    sources: [{
      id: 'source-1', version: 'source-v1', digest: 'digest-1', text: 'Özgün kaynak.',
      filename: '../İpek.txt', mediaType: 'text/plain', byteLength: 3, parserVersion: '1', createdAt: 1,
      retention: 'original-and-extracted', originalBytesBase64: 'AQID', blocks: [],
    }],
    claims: [], proposals: [], issues: [], audit: [],
  };
  project.artifacts = [{
    id: 'artifact-1', projectId: project.id, mode: 'story', createdAt: 2, revisionId: 'rev-1',
    promptUsed: '', storyText: 'Üretilmiş öykü.', isOutdated: false,
  }];
  return project;
}

test('manuscript exports preserve canonical order and filter exact unique section ids', () => {
  const project = projectFixture();
  const full = projectContentExport(project, { kind: 'manuscript' });
  assert.equal(full.text, '# İkinci\n\nİkinci bölüm.\n\n## İlk\n\nBirinci sahne.');
  assert.equal(full.name, 'İpek-CON-manuscript.md');
  assert.equal(full.mediaType, 'text/markdown;charset=utf-8');
  assert.equal(full.provenance, 'working-manuscript');
  const selected = projectContentExport(project, { kind: 'manuscript', sectionIds: ['sec-1'] });
  assert.equal(selected.text, '## İlk\n\nBirinci sahne.');
  const selectedInCanonicalOrder = projectContentExport(project, { kind: 'manuscript', sectionIds: ['sec-1', 'sec-2'] });
  assert.equal(selectedInCanonicalOrder.text, '# İkinci\n\nİkinci bölüm.\n\n## İlk\n\nBirinci sahne.');
  assert.throws(() => projectContentExport(project, { kind: 'manuscript', sectionIds: [] }), /at least one/i);
  assert.throws(() => projectContentExport(project, { kind: 'manuscript', sectionIds: ['sec-1', 'sec-1'] }), /duplicate/i);
  assert.throws(() => projectContentExport(project, { kind: 'manuscript', sectionIds: ['missing'] }), /section/i);
});

test('source and generated exports resolve exact identities and produce safe matching names and media types', () => {
  const project = projectFixture();
  const source = projectContentExport(project, { kind: 'source-text', sourceId: 'source-1', version: 'source-v1' });
  assert.equal(source.text, 'Özgün kaynak.');
  assert.equal(source.provenance, 'original-extracted-text');
  assert.equal(source.mediaType, 'text/plain;charset=utf-8');
  assert.equal(source.name.endsWith('.txt'), true);
  assert.match(source.name, /^İpek/u);
  assert.equal(/[\\/]/u.test(source.name), false);
  const generated = projectContentExport(project, { kind: 'generated-story', artifactId: 'artifact-1' });
  assert.equal(generated.text, 'Üretilmiş öykü.');
  assert.equal(generated.provenance, 'generated-artifact');
  assert.equal(generated.mediaType, 'text/plain;charset=utf-8');
  assert.equal(generated.name.endsWith('.txt'), true);
  assert.throws(() => projectContentExport(project, { kind: 'source-text', sourceId: 'source-1', version: 'stale' }), /source/i);
  assert.throws(() => projectContentExport(project, { kind: 'generated-story', artifactId: 'missing' }), /artifact/i);
  const duplicateSource = projectFixture();
  duplicateSource.narrative?.sources.push({ ...duplicateSource.narrative.sources[0] });
  assert.throws(() => projectContentExport(duplicateSource, { kind: 'source-text', sourceId: 'source-1', version: 'source-v1' }), /ambiguous/i);
  const wrongProjectArtifact = projectFixture();
  wrongProjectArtifact.artifacts[0].projectId = 'another-project';
  assert.throws(() => projectContentExport(wrongProjectArtifact, { kind: 'generated-story', artifactId: 'artifact-1' }), /artifact/i);
});

test('evidence reports use shared records without embedding retained original bytes', () => {
  const project = projectFixture();
  const file = projectContentExport(project, { kind: 'evidence-report', format: 'json' });
  assert.equal(file.mediaType, 'application/json;charset=utf-8');
  assert.equal(file.provenance, 'evidence-report');
  assert.equal(file.name.endsWith('.json'), true);
  assert.match(file.text, /"id": "source-1"/u);
  assert.doesNotMatch(file.text, /AQID/u);
  const markdown = projectContentExport(project, { kind: 'evidence-report', format: 'md' });
  assert.equal(markdown.mediaType, 'text/markdown;charset=utf-8');
  assert.equal(markdown.name.endsWith('.md'), true);
});

test('exports are deterministic and do not mutate project records', () => {
  const project = projectFixture();
  const before = JSON.stringify(project);
  const selection = { kind: 'source-text', sourceId: 'source-1', version: 'source-v1' } as const;
  assert.deepEqual(projectContentExport(project, selection), projectContentExport(project, selection));
  assert.equal(JSON.stringify(project), before);
});
