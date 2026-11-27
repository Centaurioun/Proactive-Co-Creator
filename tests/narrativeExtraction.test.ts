import assert from 'node:assert/strict';
import test from 'node:test';
import { NarrativeExtractionSchema } from '../shared/importSchemas.ts';
import { segmentNarrativeSource } from '../lib/narrative/import/segmentation.ts';
import { verifyExtractionEvidence } from '../lib/narrative/import/proposalValidator.ts';
import { findPossibleIdentityMatches } from '../lib/narrative/import/identityResolver.ts';
import { assembleImportedProject } from '../lib/narrative/import/assembleProject.ts';
import { setEntityAttribute } from '../lib/canonicalModel.ts';
import { appendAuthoredAttributeClaims } from '../lib/projectController.ts';
import { parseNarrativeSource } from '../lib/narrative/import/sourceParser.ts';
import { createBackup, registryReport, verifyBackup } from '../lib/narrative/recovery.ts';
import { filterExtractionScope } from '../lib/narrative/import/scope.ts';
import { migrateProjectPayload } from '../lib/storageEngine.ts';

const raw = (quote: string, start: number) => ({
  findings: [{ id: 'f1', title: 'A character believes', value: 'the letter is false', category: 'other', kind: 'belief', rationale: 'The narrator attributes this thought.', evidence: { start, end: start + quote.length, quote } }],
  entities: [
    { id: 'e1', name: 'Ada', category: 'character', description: '', aliases: [], attributes: [{ id: 'a1', name: 'belief', value: 'letter is false', kind: 'belief', rationale: 'Attributed thought.', evidence: { start, end: start + quote.length, quote } }], kind: 'belief', rationale: 'Point of view is attributed to Ada.', evidence: { start, end: start + quote.length, quote } },
    { id: 'e2', name: 'Ada', category: 'character', description: '', aliases: [], attributes: [], kind: 'explicit', rationale: 'A distinct Ada occurs later.', evidence: { start, end: start + quote.length, quote } },
  ],
  relationships: [{ id: 'r1', source: 'Ada', target: 'Mina', label: 'parent of', kind: 'explicit', rationale: 'The sentence states the direction.', evidence: { start, end: start + quote.length, quote } }],
  ambiguities: [],
});

test('extracts narrative chunks on structural boundaries with overlap and reports unprocessed coverage', () => {
  const text = ('paragraph one\n\nparagraph two\n\n').repeat(100);
  const chunks = segmentNarrativeSource(text, [], 250, 30, 2);
  assert.equal(chunks.complete, false);
  assert.ok(chunks.unprocessedStart! >= chunks.chunks[1].end);
  assert.ok(chunks.chunks[1].start < chunks.chunks[0].end);
  const complete = segmentNarrativeSource(text, [], 250, 30, 100);
  assert.equal(complete.complete, true);
  assert.equal(complete.chunks[0].text, text.slice(complete.chunks[0].start, complete.chunks[0].end));
});

test('validates source excerpts deterministically and rejects fabricated quotes', () => {
  const sourceText = 'Ada thinks the letter lies. Mina is her parent.';
  const quote = 'Ada thinks the letter lies.';
  const chunk = { id: 'chunk-1', index: 0, start: 100, end: 100 + sourceText.length, text: sourceText };
  const response = NarrativeExtractionSchema.parse(raw(quote, sourceText.indexOf(quote)));
  const valid = verifyExtractionEvidence(response, chunk, { id: 'source', version: 'v1', digest: 'sha256' });
  assert.equal(valid.entities.length, 2);
  assert.equal(valid.entities[0].evidence.start, 100);
  assert.equal(valid.relationships[0].source, 'Ada');
  assert.equal(valid.relationships[0].target, 'Mina');
  assert.equal(valid.findings[0].kind, 'belief');
  const fabricated = NarrativeExtractionSchema.parse(raw('Ada hates Mina.', 0));
  const rejected = verifyExtractionEvidence(fabricated, chunk, { id: 'source', version: 'v1', digest: 'sha256' });
  assert.equal(rejected.entities.length, 0);
  assert.equal(rejected.relationships.length, 0);
  assert.ok(rejected.rejectedEvidenceCount >= 4);
});

test('selective extraction filters categories and keeps parent entities required for selected attributes', () => {
  const extracted = NarrativeExtractionSchema.parse(raw('Ada thinks the letter lies.', 0));
  const attributesOnly = filterExtractionScope(extracted, { scope: 'selective', categories: ['attributes'] });
  assert.equal(attributesOnly.entities.length, 1);
  assert.equal(attributesOnly.entities[0].attributes.length, 1);
  assert.deepEqual(attributesOnly.findings, []);
  assert.deepEqual(attributesOnly.relationships, []);
  const storiesOnly = filterExtractionScope(extracted, { scope: 'selective', categories: ['story-bible'] });
  assert.deepEqual(storiesOnly.entities, []);
  assert.deepEqual(storiesOnly.relationships, []);
});

test('same-name entities remain distinct and identity matching stays unresolved', () => {
  const quote = 'Ada opens the old door.';
  const text = `${quote} ${quote}`;
  const response = raw(quote, 0);
  response.entities[1].evidence = { start: quote.length + 1, end: text.length, quote };
  const extraction = verifyExtractionEvidence(NarrativeExtractionSchema.parse(response),
    { id: 'chunk-1', index: 0, start: 0, end: text.length, text }, { id: 'source', version: 'v1', digest: 'sha256' });
  const matches = findPossibleIdentityMatches(extraction.entities);
  assert.equal(extraction.entities.length, 2);
  assert.equal(matches.length, 1);
  assert.equal(matches[0].status, 'unresolved');
  assert.notEqual(matches[0].leftId, matches[0].rightId);
});

test('project assembly preserves source and manuscript, confirms only reviewed findings, and leaves ambiguous identity unresolved', async () => {
  const text = 'Ada was a mapmaker.\n\nAda said she distrusts the letter.\n\nMina is Ada’s parent.';
  const source = await parseNarrativeSource(text);
  const first = 'Ada was a mapmaker.';
  const second = 'Ada said she distrusts the letter.';
  const relationText = 'Mina is Ada’s parent.';
  const rawResponse = {
    findings: [{ id: 'f', title: 'tone', value: 'Uneasy', category: 'story-bible', kind: 'interpretation', rationale: 'The narration is wary.', evidence: { start: text.indexOf(second), end: text.indexOf(second) + second.length, quote: second } }],
    entities: [
      { id: 'e1', name: 'Ada', category: 'character', description: 'A mapmaker.', aliases: [], attributes: [{ id: 'a1', name: 'occupation', value: 'mapmaker', kind: 'explicit', rationale: 'Directly stated.', evidence: { start: 0, end: first.length, quote: first } }], kind: 'explicit', rationale: 'The sentence identifies Ada.', evidence: { start: 0, end: first.length, quote: first } },
      { id: 'e2', name: 'Ada', category: 'character', description: 'Distrusts a letter.', aliases: [], attributes: [], kind: 'explicit', rationale: 'A second supported occurrence.', evidence: { start: text.indexOf(second), end: text.indexOf(second) + second.length, quote: second } },
      { id: 'e3', name: 'Mina', category: 'character', description: '', aliases: [], attributes: [], kind: 'explicit', rationale: 'The sentence names Mina.', evidence: { start: text.indexOf(relationText), end: text.length, quote: relationText } },
    ],
    relationships: [{ id: 'r', source: 'Mina', target: 'Ada', label: 'parent of', kind: 'explicit', rationale: 'The text specifies direction.', evidence: { start: text.indexOf(relationText), end: text.length, quote: relationText } }],
    ambiguities: [],
  };
  const extraction = verifyExtractionEvidence(NarrativeExtractionSchema.parse(rawResponse),
    { id: 'chunk-1', index: 0, start: 0, end: text.length, text }, { id: 'src', version: 'v1', digest: source.digest });
  const matches = findPossibleIdentityMatches(extraction.entities);
  const project = assembleImportedProject(source, extraction, matches, {
    sourceId: 'src',
    projectName: 'Imported novel',
    acceptedIds: new Set([extraction.entities[0].id, extraction.entities[0].attributes[0].id, extraction.entities[1].id, extraction.entities[2].id,
      extraction.findings[0].id, extraction.relationships[0].id]),
    rejectedIds: new Set(),
    coverage: { complete: true, scope: 'complete', categories: ['characters'], totalCharacters: text.length,
      processedSpans: [{ start: 0, end: text.length }], failedSegments: 0, calls: 1 },
  }, 100);
  assert.equal(project.schemaVersion, 4);
  assert.equal(project.narrative?.sources[0].text, text);
  assert.equal(project.narrative?.sources[0].digest, source.digest);
  const report = JSON.parse(registryReport(project, 'json')) as { sources: Array<Record<string, unknown>> };
  assert.equal(report.sources[0].filename, source.filename);
  assert.equal(report.sources[0].retention, 'extracted-only');
  assert.equal(report.sources[0].characterCount, text.length);
  assert.equal('text' in report.sources[0], false, 'audit reports must not duplicate full source text');
  assert.equal(project.narrative?.sources[0].analysisCoverage?.calls, 1);
  const restoredProject = migrateProjectPayload(project);
  assert.equal(restoredProject.narrative?.sources[0].text, text, 'schema-4 migration must retain the source after reload');
  assert.equal(restoredProject.snapshot.entities[0].attributes[0].epistemicKind, 'explicit', 'schema-4 reload preserves the imported attribute class');
  assert.equal(restoredProject.narrative?.claims.length, 6, 'schema-4 migration must retain all evidence claims');
  const sections = project.narrative!.versions[0].sectionVersionIds.map(id => project.narrative!.sectionVersions.find(section => section.id === id)!.section);
  assert.equal(sections.map(section => section.text).join(''), text);
  assert.equal(project.snapshot.entities.length, 3);
  assert.equal(project.snapshot.relationships.length, 0, 'ambiguous endpoint names must not create a directed edge');
  assert.ok(project.snapshot.entities.every(entity => !('chronology' in entity)), 'source order is not inferred as chronology');
  const targets = new Set([...project.snapshot.entities.map(entity => entity.id), ...(project.narrative?.proposals ?? []).map(proposal => proposal.id)]);
  assert.ok(project.narrative?.claims.every(claim => targets.has(claim.targetId)), 'evidence claims must target a persisted entity or proposal');
  assert.ok(project.narrative?.proposals?.some(proposal => proposal.label === 'Ada' && proposal.approval === 'confirmed'));
  assert.ok(project.narrative?.proposals?.some(proposal => proposal.label === 'occupation' && proposal.approval === 'confirmed'));
  assert.ok(project.narrative?.proposals?.every(proposal => project.narrative?.sources.some(sourceRecord => sourceRecord.id === proposal.evidence.sourceId)));
  assert.equal(project.snapshot.storyBible.tone.value, 'Uneasy');
  assert.equal(project.snapshot.storyBible.tone.status, 'confirmed');
  const importedAttribute = project.snapshot.entities[0].attributes[0];
  assert.equal(importedAttribute.epistemicKind, 'explicit');
  const sourceClaim = project.narrative!.claims.find(claim => claim.targetId === importedAttribute.id)!;
  assert.equal(sourceClaim.epistemicKind, 'explicit');
  const noOp = setEntityAttribute(project.snapshot, project.snapshot.entities[0].id!, 'occupation', 'mapmaker');
  assert.equal(noOp.entities[0].attributes[0].epistemicKind, 'explicit', 'no-op edit preserves source class');
  const editedSnapshot = setEntityAttribute(project.snapshot, project.snapshot.entities[0].id!, 'occupation', 'navigator');
  assert.equal(editedSnapshot.entities[0].attributes[0].epistemicKind, 'user-authored');
  const editedProject = appendAuthoredAttributeClaims(project, editedSnapshot);
  assert.equal(editedProject.narrative!.claims.includes(sourceClaim), true, 'historical source evidence is retained');
  const authoredClaim = editedProject.narrative!.claims.find(claim => claim.epistemicKind === 'user-authored');
  assert.equal(authoredClaim?.authoredText, 'navigator');
  assert.equal(authoredClaim?.supersedesClaimId, sourceClaim.id);
  assert.equal(authoredClaim?.anchors[0].excerpt, first);
  const restoredEdit = await verifyBackup(await createBackup({ ...editedProject, snapshot: editedSnapshot }, 'Authored attribute change'));
  assert.equal(restoredEdit.narrative!.claims.find(claim => claim.id === sourceClaim.id)?.anchors[0].excerpt, first);
  assert.equal(restoredEdit.narrative!.claims.find(claim => claim.epistemicKind === 'user-authored')?.authoredText, 'navigator');
  assert.equal(project.narrative?.issues.some(issue => issue.title.startsWith('Possible same identity: Ada')), true);
  assert.ok(project.narrative?.claims.every(claim => claim.anchors[0].excerpt.length > 0));
});

test('W3-NEW-07 & W3-NEW-08: append preserves issues & Stage 2 opportunities, and overlapping/same-span IDs do not collide', async () => {
  const { applyAppendToExistingProject, appendTargetBase } = await import('../lib/narrative/import/appendApply.ts');
  const { attachAcceptedStage2Opportunities } = await import('../lib/narrative/import/stage2Enhancements.ts');
  const { validateNarrativeRecords } = await import('../lib/narrative/evidenceRegistry.ts');
  const { createSampleProject } = await import('../lib/canonicalModel.ts');

  const text = 'Ada met Mina at the harbor. Mina carried a lantern.';
  const source = await parseNarrativeSource(new TextEncoder().encode(text), 'harbor.txt');
  const sharedQuote = 'Ada met Mina at the harbor.';
  const rawCollision = NarrativeExtractionSchema.parse({
    findings: [],
    entities: [
      {
        id: 'e-ada', name: 'Ada', category: 'character', description: 'Harbor visitor.', aliases: [],
        attributes: [{ id: 'a1', name: 'role', value: 'visitor', kind: 'explicit', rationale: 'Direct.', evidence: { start: 0, end: sharedQuote.length, quote: sharedQuote } }],
        kind: 'explicit', rationale: 'Named.', evidence: { start: 0, end: sharedQuote.length, quote: sharedQuote },
      },
      {
        id: 'e-mina', name: 'Mina', category: 'character', description: 'Lantern bearer.', aliases: [],
        attributes: [{ id: 'a2', name: 'item', value: 'lantern', kind: 'explicit', rationale: 'Direct.', evidence: { start: 0, end: sharedQuote.length, quote: sharedQuote } }],
        kind: 'explicit', rationale: 'Named.', evidence: { start: 0, end: sharedQuote.length, quote: sharedQuote },
      },
    ],
    relationships: [
      { id: 'r1', source: 'Ada', target: 'Ghost1', label: 'met', kind: 'explicit', rationale: 'Unresolved target 1.', evidence: { start: 0, end: sharedQuote.length, quote: sharedQuote } },
      { id: 'r2', source: 'Ada', target: 'Ghost2', label: 'knew', kind: 'explicit', rationale: 'Unresolved target 2.', evidence: { start: 0, end: sharedQuote.length, quote: sharedQuote } },
    ],
    ambiguities: [
      { id: 'amb1', title: 'Same title', detail: 'First.', severity: 'medium', certainty: 'possible', rationale: 'First.', evidence: { start: 0, end: sharedQuote.length, quote: sharedQuote } },
      { id: 'amb2', title: 'Same title', detail: 'Second.', severity: 'medium', certainty: 'possible', rationale: 'Second.', evidence: { start: 0, end: sharedQuote.length, quote: sharedQuote } },
    ],
  });
  const checked = verifyExtractionEvidence(rawCollision, { id: 'chunk-1', index: 0, start: 0, end: text.length, text }, { id: 'src-col', version: 'v1', digest: source.digest });
  const accepted = new Set([checked.entities[0].id, checked.relationships[0].id, checked.relationships[1].id]);
  const incoming = assembleImportedProject(source, checked, [], {
    sourceId: 'src-col',
    acceptedIds: accepted,
    rejectedIds: new Set(),
    projectName: 'Collision Test',
    coverage: { complete: false, scope: 'complete', categories: ['characters'], totalCharacters: text.length, processedSpans: [{ start: 0, end: sharedQuote.length }], failedSegments: 1, calls: 1 },
  }, 5000);
  validateNarrativeRecords(incoming);

  attachAcceptedStage2Opportunities(incoming, [
    { id: 'enhancement-alpha-1', category: 'pacing', title: 'Tighten 1', rationale: 'R1', beforeExcerpt: sharedQuote, afterExcerpt: 'Ada met Mina.', assumptions: [] },
    { id: 'enhancement-alpha-2', category: 'clarity', title: 'Tighten 2', rationale: 'R2', beforeExcerpt: sharedQuote, afterExcerpt: 'Mina held the light.', assumptions: [] },
  ], 'src-col', 5000);
  const oppIds = (incoming.narrative?.opportunities ?? []).map(o => o.id);
  assert.equal(new Set(oppIds).size, 2, 'Stage 2 opportunity IDs must be unique even with shared 12-char prefix');
  validateNarrativeRecords(incoming);

  const overlapA = verifyExtractionEvidence(NarrativeExtractionSchema.parse({
    findings: [],
    entities: [{ id: 'e1', name: 'Ada', category: 'character', description: '', aliases: [], attributes: [{ id: 'a1', name: 'role', value: 'guard', kind: 'explicit', rationale: 'A', evidence: { start: 0, end: sharedQuote.length, quote: sharedQuote } }], kind: 'explicit', rationale: 'R', evidence: { start: 0, end: sharedQuote.length, quote: sharedQuote } }],
    relationships: [], ambiguities: [],
  }), { id: 'c1', index: 0, start: 0, end: text.length, text }, { id: 's1', version: 'v1', digest: 'd'.repeat(64) });
  const overlapB = verifyExtractionEvidence(NarrativeExtractionSchema.parse({
    findings: [],
    entities: [{ id: 'e2', name: 'Mina', category: 'character', description: '', aliases: [], attributes: [{ id: 'a2', name: 'role', value: 'guard', kind: 'explicit', rationale: 'B', evidence: { start: 0, end: sharedQuote.length, quote: sharedQuote } }], kind: 'explicit', rationale: 'R', evidence: { start: 0, end: sharedQuote.length, quote: sharedQuote } }],
    relationships: [], ambiguities: [],
  }), { id: 'c2', index: 1, start: 0, end: text.length, text }, { id: 's1', version: 'v1', digest: 'd'.repeat(64) });
  assert.notEqual(overlapA.entities[0].attributes[0].id, overlapB.entities[0].attributes[0].id, 'Distinct entities across chunks must not share identical attribute.id');

  const target = createSampleProject(1000);
  const base = appendTargetBase(target);
  const appended = applyAppendToExistingProject({
    targetProject: target,
    incomingProject: incoming,
    insertPosition: 'end',
    identityDecisions: {},
    expectedBaseRevision: base.expectedBaseRevision,
    expectedManuscriptVersionId: base.expectedManuscriptVersionId,
    expectedBaseSnapshotDigest: base.expectedBaseSnapshotDigest,
  });
  assert.ok((appended.candidateProject.narrative?.issues.length ?? 0) >= incoming.narrative!.issues.length, 'Appended project must retain incoming issues');
  assert.ok(appended.candidateProject.narrative!.issues.some(i => i.title === 'Narrative analysis incomplete'));
  assert.equal(appended.candidateProject.narrative?.opportunities?.length, 2, 'Appended project must retain Stage 2 opportunities');
  assert.ok(appended.candidateProject.narrative!.opportunities!.every(o => o.projectId === target.id));
});
