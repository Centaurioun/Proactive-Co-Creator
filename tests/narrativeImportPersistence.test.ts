import assert from 'node:assert/strict';
import test from 'node:test';
import { assembleImportedProject } from '../lib/narrative/import/assembleProject.ts';
import { parseNarrativeSource } from '../lib/narrative/import/sourceParser.ts';
import { createBackup, verifyBackup } from '../lib/narrative/recovery.ts';
import { migrateProjectPayload } from '../lib/storageEngine.ts';
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
    }],
    entities: [],
    relationships: [],
    ambiguities: [],
    rejectedEvidenceCount: 0,
  };

  const imported = assembleImportedProject(source, extraction, [], {
    sourceId,
    projectName: 'Synthetic import',
    acceptedIds: new Set(['finding-tone']),
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
  assert.equal(restored.narrative!.issues[0].title, 'Narrative analysis incomplete');

  const altered = { ...backup, payload: backup.payload.replace(text, 'İpek sees a moon. 🦉') };
  await assert.rejects(() => verifyBackup(altered), /checksum or size/i);
});
