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
  assert.doesNotMatch(markdown.text, /AQID|originalBytesBase64/u);
});

test('exports are deterministic and do not mutate project records', () => {
  const project = projectFixture();
  const before = JSON.stringify(project);
  const selection = { kind: 'source-text', sourceId: 'source-1', version: 'source-v1' } as const;
  assert.deepEqual(projectContentExport(project, selection), projectContentExport(project, selection));
  assert.equal(JSON.stringify(project), before);
});

test('rejects duplicate generated artifact IDs as ambiguous', () => {
  const project = projectFixture();
  project.artifacts.push({ ...project.artifacts[0], storyText: 'Conflicting second artifact.' });
  assert.throws(() => projectContentExport(project, { kind: 'generated-story', artifactId: 'artifact-1' }), /ambiguous/i);
});

test('uses project artifact collection membership when an optional projectId is absent', () => {
  const project = projectFixture();
  delete project.artifacts[0].projectId;
  const result = projectContentExport(project, { kind: 'generated-story', artifactId: 'artifact-1' });
  assert.equal(result.text, 'Üretilmiş öykü.');
});

test('rejects non-story and empty generated artifacts', () => {
  const nonStory = projectFixture();
  nonStory.artifacts[0].mode = 'image';
  assert.throws(() => projectContentExport(nonStory, { kind: 'generated-story', artifactId: 'artifact-1' }), /artifact/i);

  const emptyStory = projectFixture();
  emptyStory.artifacts[0].storyText = '';
  assert.throws(() => projectContentExport(emptyStory, { kind: 'generated-story', artifactId: 'artifact-1' }), /artifact/i);
});

test('sanitizes reserved and control filenames and bounds long base names', () => {
  const reservedProject = projectFixture();
  reservedProject.name = 'CON';
  assert.equal(projectContentExport(reservedProject, { kind: 'manuscript' }).name, 'project-CON-manuscript.md');

  const controlProject = projectFixture();
  controlProject.name = 'A\u0000B';
  const controlName = projectContentExport(controlProject, { kind: 'manuscript' }).name;
  assert.equal(controlName, 'A-B-manuscript.md');
  const hasUnsafeCharacter = Array.from(controlName).some(character => {
    const codePoint = character.codePointAt(0) ?? 0;
    return codePoint <= 0x1f || codePoint === 0x7f || character === '/' || character === '\\';
  });
  assert.equal(hasUnsafeCharacter, false);

  const longProject = projectFixture();
  longProject.name = 'a'.repeat(100);
  assert.equal(projectContentExport(longProject, { kind: 'manuscript' }).name, `${'a'.repeat(64)}-manuscript.md`);
});

test('W3-NEW-15: DOCX export strips XML 1.0 illegal control characters and lone surrogates', async () => {
  const { buildManuscriptDocxBytes } = await import('../lib/narrative/recovery/docxExport.ts');
  const { unzipSync, strFromU8 } = await import('fflate');
  const docx = buildManuscriptDocxBytes('Title\u0000Bell', [{
    id: 's1', kind: 'scene', title: 'Scene\u0007One', text: `Line\u000bBreak\u000cForm\ud800End`,
  }]);
  const files = unzipSync(docx);
  const docXml = strFromU8(files['word/document.xml']);
  const hasIllegalXmlControl = [...docXml].some((ch) => {
    const code = ch.charCodeAt(0);
    return code <= 0x08 || code === 0x0b || code === 0x0c || (code >= 0x0e && code <= 0x1f);
  });
  assert.equal(hasIllegalXmlControl, false, 'XML must not contain illegal control chars');
  assert.equal(/[\ud800-\udfff]/.test(docXml), false, 'XML must not contain lone surrogates');
  assert.ok(docXml.includes('TitleBell'));
  assert.ok(docXml.includes('LineBreakFormEnd'));
});
