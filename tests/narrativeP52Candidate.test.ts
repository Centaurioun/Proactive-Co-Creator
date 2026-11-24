import assert from 'node:assert/strict';
import test from 'node:test';
import type { ManuscriptSection } from '../shared/narrativeTypes.ts';
import { parseNarrativeSource } from '../lib/narrative/import/sourceParser.ts';
import { createAppendPreview, revalidateAppendPreview } from '../lib/narrative/import/appendPreview.ts';
import { createStyleObservation, createStyleProfile, reviewStyleObservation, selectStyleContext } from '../lib/narrative/context/styleProfile.ts';
import { buildManuscriptNavigation, filterManuscriptSections } from '../lib/narrative/manuscriptNavigation.ts';

const chapter: ManuscriptSection = { id: 'target-chapter', kind: 'chapter', title: 'Başlangıç', text: '' };
const targetScene: ManuscriptSection = { id: 'target-scene', kind: 'scene', title: 'Sahil', text: 'Leyla bekledi.', chapterId: chapter.id, characters: 'Leyla', status: 'draft' };
const incomingChapter: ManuscriptSection = { id: 'source-chapter', kind: 'chapter', title: 'Dönüş', text: '' };
const incomingScene: ManuscriptSection = { id: 'source-scene', kind: 'scene', title: 'Akşam', text: 'Leyla kapıyı açtı.', chapterId: incomingChapter.id, characters: 'Leyla' };

function targetSnapshot() {
  return {
    projectId: 'project-a',
    revision: 7,
    manuscriptVersionId: 'manuscript-v7',
    manuscriptDigest: 'sha256-target-v7',
    sections: [chapter, targetScene],
    sources: [{ id: 'source-old', version: 'v1', digest: 'sha256-old' }],
  };
}

test('append preview keeps source and target distinct, preserves order, and leaves identity matches unresolved', () => {
  const target = targetSnapshot();
  const before = structuredClone(target);
  const preview = createAppendPreview({
    target,
    source: { id: 'source-new', version: 'v1', digest: 'sha256-new' },
    incomingSections: [incomingChapter, incomingScene],
    insertAfterSectionId: targetScene.id,
    identityCandidates: [{ incomingEntityId: 'new-leyla', existingEntityId: 'old-leyla', matchedName: 'Leyla' }],
    proposalId: 'append-1',
    createId: (() => { let id = 0; return () => `append-${++id}`; })(),
  });

  assert.equal(preview.status, 'needs-identity-review');
  assert.equal(preview.canApply, false);
  assert.deepEqual(preview.sections.map(section => section.text).filter(Boolean), ['Leyla bekledi.', 'Leyla kapıyı açtı.']);
  assert.deepEqual(preview.sections.map(section => section.id), ['target-chapter', 'target-scene', 'append-1', 'append-2']);
  assert.equal(preview.sections[3].chapterId, preview.sections[2].id);
  assert.deepEqual(preview.identityConflicts, [{ incomingEntityId: 'new-leyla', existingEntityId: 'old-leyla', matchedName: 'Leyla', status: 'unresolved' }]);
  assert.deepEqual(target, before);
});

test('append preview detects duplicate source versions and stale or wrong-project bases', () => {
  const target = { ...targetSnapshot(), sources: [...targetSnapshot().sources, { id: 'source-new', version: 'v1', digest: 'sha256-new' }] };
  const request = {
    target,
    source: { id: 'source-new', version: 'v1', digest: 'sha256-new' },
    incomingSections: [incomingChapter],
    insertAfterSectionId: null,
    proposalId: 'append-duplicate',
    createId: () => 'append-copy',
  };
  const duplicate = createAppendPreview(request);
  assert.equal(duplicate.status, 'duplicate-source');
  assert.equal(duplicate.sections.length, target.sections.length);

  const ready = createAppendPreview({ ...request, target: targetSnapshot(), identityCandidates: [] });
  assert.equal(ready.status, 'ready');
  assert.equal(revalidateAppendPreview(ready, { ...targetSnapshot(), revision: 8 }), 'stale');
  assert.equal(revalidateAppendPreview(ready, { ...targetSnapshot(), projectId: 'project-b' }), 'wrong-project');
  assert.equal(revalidateAppendPreview(ready, targetSnapshot()), 'ready');
});

test('style review requires a live exact evidence span and only confirmed relevant guidance is selected', () => {
  const sourceText = 'Aylin konuşurken kısa cümleler kurar.';
  const profile = createStyleProfile('project-a');
  const observation = createStyleObservation({
    id: 'style-1', trait: 'rhythm', value: 'Kısa cümleler', interpretation: 'interpretation',
    scope: { kind: 'manuscript' }, evidence: {
      kind: 'source', recordId: 'source-1', version: 'v2', digest: 'sha256-source-v2',
      start: 18, end: 38, excerpt: sourceText.slice(18, 38),
    },
  });
  const pending = { ...profile, observations: [observation] };
  assert.deepEqual(selectStyleContext(pending, 'project-a', 'scene-a').guidance, []);

  const resolver = (ref: { recordId: string; version: string; digest: string }) =>
    ref.recordId === 'source-1' && ref.version === 'v2' && ref.digest === 'sha256-source-v2' ? sourceText : undefined;
  const confirmed = reviewStyleObservation(pending, observation.id, 'confirmed', resolver);
  assert.equal(selectStyleContext(confirmed, 'project-a', 'scene-a').guidance[0].value, 'Kısa cümleler');
  assert.throws(() => reviewStyleObservation(pending, observation.id, 'confirmed', () => 'tamamen başka metin'), /evidence|source|span/i);
  assert.deepEqual(pending.observations[0].status, 'pending');
});

test('style context excludes other sections and suppresses conflicting confirmed trait values', () => {
  const sourceText = 'Measured evidence.';
  const base = createStyleProfile('project-a');
  const make = (id: string, value: string, sectionId: string) => createStyleObservation({
    id, trait: 'voice', value, interpretation: 'observation', scope: { kind: 'section', sectionId },
    evidence: { kind: 'source', recordId: id, version: 'v1', digest: `sha-${id}`, start: 0, end: sourceText.length, excerpt: sourceText },
  });
  const profile = { ...base, observations: [make('voice-a', 'Sakin', 'scene-a'), make('voice-b', 'Keskin', 'scene-a'), make('voice-c', 'Şakacı', 'scene-b')] };
  const resolver = (ref: { recordId: string; version: string; digest: string }) => ({ digest: ref.digest, text: sourceText });
  const reviewed = profile.observations.reduce((current, observation) => reviewStyleObservation(current, observation.id, 'confirmed', resolver), profile);
  const context = selectStyleContext(reviewed, 'project-a', 'scene-a');
  assert.deepEqual(context.guidance, []);
  assert.deepEqual(context.conflicts.map(conflict => conflict.trait), ['voice']);
  assert.equal(selectStyleContext(reviewed, 'project-a', 'scene-b').guidance[0].value, 'Şakacı');
  assert.deepEqual(selectStyleContext(reviewed, 'project-b', 'scene-b').guidance, []);
});

test('navigation preserves authored order while grouping chapters and surfacing unchaptered and orphan scenes', () => {
  const orphan: ManuscriptSection = { id: 'orphan', kind: 'scene', title: 'Yitik', text: 'Eski iz.', chapterId: 'missing-chapter' };
  const unchaptered: ManuscriptSection = { id: 'free-scene', kind: 'scene', title: 'Serbest', text: 'Serbest sahne.', chronology: 'flashback' };
  const sections = [targetScene, chapter, orphan, unchaptered, incomingChapter, incomingScene];
  const index = buildManuscriptNavigation(sections);
  assert.deepEqual(index.chapters.map(group => group.chapter.id), ['target-chapter', 'source-chapter']);
  assert.deepEqual(index.chapters[0].scenes.map(scene => scene.id), ['target-scene']);
  assert.deepEqual(index.unchaptered.map(scene => scene.id), ['free-scene']);
  assert.deepEqual(index.orphaned.map(scene => scene.id), ['orphan']);

  const filtered = filterManuscriptSections(sections, { query: 'LEYLA', chapterId: 'source-chapter' });
  assert.deepEqual(filtered.map(section => section.id), ['source-scene']);
  assert.deepEqual(filterManuscriptSections(sections, { chronology: 'flashback' }).map(section => section.id), ['free-scene']);
});

test('product EPUB source dispatch rejects malformed ZIP bytes with a typed error', async () => {
  await assert.rejects(() => parseNarrativeSource(new Uint8Array([1, 2, 3]), 'book.epub'), {
    name: 'NarrativeSourceParseError',
    kind: 'malformed',
    message: /EPUB ZIP archive is too short/i,
  });
});
