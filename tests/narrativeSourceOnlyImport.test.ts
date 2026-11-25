import assert from 'node:assert/strict';
import test from 'node:test';
import { createSampleProject } from '../lib/canonicalModel.ts';
import { applyAppendToExistingProject, appendTargetBase } from '../lib/narrative/import/appendApply.ts';
import { buildSourceOnlyImportedProject } from '../components/narrativeImport/ImportWorkflow.tsx';
import { parseNarrativeSource } from '../lib/narrative/import/sourceParser.ts';
import { manuscriptSections } from '../lib/narrative/manuscriptModel.ts';
import { migrateProjectPayload } from '../lib/storageEngine.ts';

test('source-only import preserves parsed text and provenance without claims, proposals, coverage, or provider requests', async () => {
  const text = '# Bölüm 1\n\nİpek sees a star. 🦉\n\nA second paragraph stays exact.\n';
  const source = await parseNarrativeSource(new TextEncoder().encode(text), 'öykü.md');
  const originalFetch = globalThis.fetch;
  let providerRequests = 0;
  globalThis.fetch = (async (...args: Parameters<typeof fetch>) => {
    providerRequests += 1;
    return originalFetch(...args);
  }) as typeof fetch;
  try {
    const project = buildSourceOnlyImportedProject(source, 'source-only-test', 'Faithful import', 1234);
    assert.equal(providerRequests, 0);
    assert.equal(project.narrative?.sources[0].text, text);
    assert.equal(project.narrative?.sources[0].digest, source.digest);
    assert.equal(project.narrative?.sources[0].filename, 'öykü.md');
    assert.equal(project.narrative?.sources[0].retention, 'original-and-extracted');
    assert.deepEqual(project.narrative?.sources[0].blocks, source.blocks);
    assert.equal(project.narrative?.sources[0].analysisCoverage, undefined);
    assert.deepEqual(manuscriptSections(project).map(({ text: sectionText }) => sectionText), [text]);
    assert.deepEqual(project.snapshot.entities, []);
    assert.deepEqual(project.snapshot.relationships, []);
    assert.deepEqual(project.narrative?.claims, []);
    assert.deepEqual(project.narrative?.issues, []);
    assert.deepEqual(project.narrative?.proposals, []);
    const reloaded = migrateProjectPayload(project);
    assert.equal(reloaded.narrative?.sources[0].text, text);
    assert.equal(reloaded.narrative?.sources[0].digest, source.digest);
    assert.equal(reloaded.narrative?.sources[0].analysisCoverage, undefined);
    assert.deepEqual(manuscriptSections(reloaded).map(({ text: sectionText }) => sectionText), [text]);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('source-only append retains the full manuscript and existing duplicate-source guard', async () => {
  const text = 'The source remains the only authority.\n\nNo entities are inferred.';
  const source = await parseNarrativeSource(new TextEncoder().encode(text), 'source.txt');
  const incoming = buildSourceOnlyImportedProject(source, 'source-append-test', 'Source only', 2000);
  const target = createSampleProject(1000);
  const reviewedTarget = appendTargetBase(target);

  const result = applyAppendToExistingProject({
    targetProject: target,
    incomingProject: incoming,
    insertPosition: 'end',
    identityDecisions: {},
    expectedBaseRevision: reviewedTarget.expectedBaseRevision,
    expectedManuscriptVersionId: reviewedTarget.expectedManuscriptVersionId,
    expectedBaseSnapshotDigest: reviewedTarget.expectedBaseSnapshotDigest,
  });
  assert.equal(result.addedEntityCount, 0);
  assert.equal(result.addedSectionCount, 1);
  assert.ok(manuscriptSections(result.candidateProject).some((section) => section.text === text));
  assert.ok(result.candidateProject.narrative?.sources.some((record) => record.digest === source.digest && record.text === text));

  const duplicateIncoming = buildSourceOnlyImportedProject(source, 'source-append-duplicate', 'Duplicate', 3000);
  const nextTarget = result.candidateProject;
  const nextReview = appendTargetBase(nextTarget);
  assert.throws(() => applyAppendToExistingProject({
    targetProject: nextTarget,
    incomingProject: duplicateIncoming,
    insertPosition: 'end',
    identityDecisions: {},
    expectedBaseRevision: nextReview.expectedBaseRevision,
    expectedManuscriptVersionId: nextReview.expectedManuscriptVersionId,
    expectedBaseSnapshotDigest: nextReview.expectedBaseSnapshotDigest,
  }), /exact source digest already exists/i);
});
