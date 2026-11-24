import assert from 'node:assert/strict';
import test from 'node:test';
import { assembleImportedProject } from '../lib/narrative/import/assembleProject.ts';
import { parseNarrativeSource } from '../lib/narrative/import/sourceParser.ts';
import { createBackup, verifyBackup } from '../lib/narrative/recovery.ts';
import { migrateProjectPayload } from '../lib/storageEngine.ts';
import { resolveProviderPrompt } from '../lib/promptBuilder.ts';
import { setEntityAttribute } from '../lib/canonicalModel.ts';
import { appendAuthoredAttributeClaims } from '../lib/projectController.ts';
import type { VerifiedExtraction } from '../lib/narrative/import/proposalValidator.ts';

test('schema-4 import keeps original bytes, verified evidence, partial coverage, and issues through migration and portable backup', async t => {
  const text = 'İpek sees a star. 🦉';
  const originalBytes = new TextEncoder().encode(text);
  const source = await parseNarrativeSource(originalBytes, 'öykü.txt');
  const sourceId = 'synthetic-import-source';
  const evidence = {
    sourceId,
    version: 'v1',
    digest: source.digest,
    start: 0,
    end: text.length,
    excerpt: text,
  };
  const extraction: VerifiedExtraction = {
    findings: [{
      id: 'finding-tone',
      title: 'tone',
      value: 'Wonder',
      category: 'story-bible',
      kind: 'interpretation',
      rationale: 'The source uses a curious observation.',
      evidence,
    }, {
      id: 'finding-other', title: 'Unclassified observation', value: 'An unnamed voice reports a pale comet.', category: 'other', kind: 'reported',
      rationale: 'The report is retained for review without inventing a reporter.', evidence,
    }],
    entities: [],
    relationships: [],
    ambiguities: [],
    rejectedEvidenceCount: 0,
  };

  const imported = assembleImportedProject(source, extraction, [], {
    sourceId,
    projectName: 'Synthetic import',
    acceptedIds: new Set(['finding-tone', 'finding-other']),
    rejectedIds: new Set(),
    coverage: {
      complete: false,
      scope: 'selective',
      categories: ['story-bible'],
      totalCharacters: text.length,
      processedSpans: [{ start: 0, end: 5 }],
      failedSegments: 1,
      calls: 2,
    },
  }, 1_700_000_000_000);

  const migrated = migrateProjectPayload(imported);
  const migratedSource = migrated.narrative!.sources[0];
  assert.equal(migratedSource.text, text);
  assert.equal(migratedSource.retention, 'original-and-extracted');
  assert.equal(migratedSource.originalBytesBase64, source.originalBytesBase64);
  assert.deepEqual(new Uint8Array(Array.from(atob(migratedSource.originalBytesBase64!), char => char.charCodeAt(0))), originalBytes);
  assert.equal(migratedSource.analysisCoverage?.complete, false);
  assert.equal(migratedSource.analysisCoverage?.failedSegments, 1);
  assert.equal(migrated.narrative!.claims[0].anchors[0].excerpt, text);
  assert.equal(migrated.narrative!.claims[0].anchors[0].sourceId, sourceId);
  assert.ok(migrated.narrative!.issues.some(issue => issue.title === 'Narrative analysis incomplete'));
  assert.equal(migrated.narrative!.proposals?.[0].epistemicKind, 'interpretation');
  assert.equal(migrated.narrative!.claims[0].epistemicKind, 'interpretation');
  assert.equal(migrated.snapshot.storyBible.tone.epistemicKind, 'interpretation');
  const otherProposal = migrated.narrative!.proposals!.find(proposal => proposal.id === 'finding-other')!;
  assert.equal(otherProposal.category, 'other');
  assert.equal(otherProposal.epistemicKind, 'reported');
  assert.equal(migrated.narrative!.claims.find(claim => claim.targetId === 'finding-other')?.epistemicKind, 'reported');
  assert.equal(migrated.snapshot.storyBible.tone.value, 'Wonder', 'unclassified finding is not projected into Story Bible');
  assert.equal(migrated.snapshot.entities.length, 0, 'partial analysis does not infer missing entities as negative evidence');
  const invalidKind = structuredClone(imported);
  (invalidKind.narrative!.proposals![0] as { epistemicKind?: string }).epistemicKind = 'invented';
  assert.throws(() => migrateProjectPayload(invalidKind), /Invalid option|epistemicKind|enum/i);
  const invalidCanonicalKind = structuredClone(imported);
  (invalidCanonicalKind.snapshot.storyBible.tone as { epistemicKind?: string }).epistemicKind = 'invented';
  assert.throws(() => migrateProjectPayload(invalidCanonicalKind), /Invalid option|epistemicKind|enum/i);

  const assertInvalidOriginalIsNotRetained = (raw: typeof imported, caseName: string) => {
    let restored;
    try {
      restored = migrateProjectPayload(raw);
    } catch {
      return;
    }
    const restoredSource = restored.narrative!.sources[0];
    assert.equal(restoredSource.retention, 'extracted-only', `${caseName}: invalid original bytes must not be labeled retained`);
    assert.equal(restoredSource.originalBytesBase64, undefined, `${caseName}: invalid original bytes must not remain stored`);
  };

  await t.test('raw schema-4 restore rejects or downgrades malformed Base64', () => {
    const malformed = structuredClone(imported);
    malformed.narrative!.sources[0].originalBytesBase64 = '%%%not-base64%%%';
    assertInvalidOriginalIsNotRetained(malformed, 'malformed Base64');
  });

  await t.test('raw schema-4 restore rejects or downgrades decoded bytes with the wrong length', () => {
    const wrongLength = structuredClone(imported);
    wrongLength.narrative!.sources[0].byteLength = originalBytes.byteLength - 1;
    assertInvalidOriginalIsNotRetained(wrongLength, 'decoded length mismatch');
  });

  await t.test('raw schema-4 restore rejects or downgrades original bytes whose digest differs', () => {
    const wrongDigest = structuredClone(imported);
    const oldDigest = wrongDigest.narrative!.sources[0].digest;
    const digest = '0'.repeat(64);
    wrongDigest.narrative!.sources[0].digest = digest;
    for (const record of [...wrongDigest.narrative!.claims, ...wrongDigest.narrative!.issues]) {
      for (const anchor of record.anchors) {
        if (anchor.digest === oldDigest) anchor.digest = digest;
      }
    }
    assertInvalidOriginalIsNotRetained(wrongDigest, 'digest mismatch');
  });

  const backup = await createBackup(imported, 'Synthetic import portability');
  const restored = await verifyBackup(backup);
  assert.equal(restored.narrative!.sources[0].originalBytesBase64, source.originalBytesBase64);
  assert.deepEqual(restored.narrative!.sources[0].analysisCoverage, migratedSource.analysisCoverage);
  assert.equal(restored.narrative!.claims[0].anchors[0].excerpt, text);
  assert.equal(restored.narrative!.proposals!.find(proposal => proposal.id === 'finding-other')?.category, 'other');
  assert.equal(restored.narrative!.proposals!.find(proposal => proposal.id === 'finding-other')?.epistemicKind, 'reported');
  assert.equal(restored.narrative!.issues[0].title, 'Narrative analysis incomplete');

  const altered = { ...backup, payload: backup.payload.replace(text, 'İpek sees a moon. 🦉') };
  await assert.rejects(() => verifyBackup(altered), /checksum or size/i);

  const legacyUnknown = structuredClone(imported);
  legacyUnknown.snapshot.refinedPrompt = 'Legacy prompt with unsupported PALER COMET context';
  legacyUnknown.snapshot.entities.push({
    id: 'legacy-entity', name: 'Ipek', category: 'character', presence_in_prompt: true, description: '', alternatives: null,
    attributes: [{ id: 'legacy-attribute', name: 'secret', presence_in_prompt: true, value: [{ name: 'PALER COMET' }], confirmedValue: 'PALER COMET', status: 'confirmed', provenance: 'accepted-suggestion' }],
    status: 'confirmed', provenance: 'accepted-suggestion', epistemicKind: 'explicit', sourceBacked: true,
  });
  legacyUnknown.narrative!.claims.push({ id: 'legacy-source-claim', targetId: 'legacy-attribute', rationale: 'Legacy source claim.', approval: 'confirmed', freshness: 'current', anchors: structuredClone(legacyUnknown.narrative!.claims[0].anchors) });
  const legacyReloaded = migrateProjectPayload(legacyUnknown);
  assert.equal(legacyReloaded.snapshot.refinedPrompt, legacyUnknown.snapshot.refinedPrompt, 'old prompt text remains available after load');
  assert.equal(resolveProviderPrompt(legacyReloaded, 'story').ok, false, 'legacy unknown context blocks dependent provider use after load');
  const legacyBackup = await createBackup(legacyReloaded, 'Legacy unknown class');
  const legacyRestored = await verifyBackup(legacyBackup);
  assert.equal(legacyRestored.snapshot.refinedPrompt, legacyUnknown.snapshot.refinedPrompt);
  assert.equal(resolveProviderPrompt(legacyRestored, 'image').ok, false, 'unknown context remains blocked after backup restore');
  const historicalSourceClaim = structuredClone(legacyRestored.narrative!.claims.find(claim => claim.id === 'legacy-source-claim')!);
  const editedLegacySnapshot = setEntityAttribute(legacyRestored.snapshot, 'legacy-entity', 'secret', 'Reviewed PALER COMET');
  const editedLegacyProject = appendAuthoredAttributeClaims(legacyRestored, editedLegacySnapshot);
  assert.equal(resolveProviderPrompt({ ...legacyRestored, snapshot: editedLegacySnapshot }, 'image').ok, true, 'explicit local edit unlocks only the reviewed value');
  assert.deepEqual(editedLegacyProject.narrative!.claims.find(claim => claim.id === historicalSourceClaim.id), historicalSourceClaim,
    'editing an unknown legacy attribute must leave its historical claim and evidence byte-for-byte equivalent');
  const authoredClaim = editedLegacyProject.narrative!.claims.find(claim => claim.epistemicKind === 'user-authored' && claim.targetId === 'legacy-attribute');
  assert.ok(authoredClaim, 'a distinct user-authored claim is created for the edited value');
  assert.notEqual(authoredClaim.id, historicalSourceClaim.id);
  assert.equal(authoredClaim.authoredText, 'Reviewed PALER COMET');
  assert.equal(authoredClaim.supersedesClaimId, historicalSourceClaim.id);
  assert.equal(authoredClaim.anchors[0].excerpt, historicalSourceClaim.anchors[0].excerpt, 'the new claim may point to retained evidence without reclassifying it');
  assert.equal(historicalSourceClaim.epistemicKind, undefined, 'legacy unknown evidence remains epistemically unknown');
});
