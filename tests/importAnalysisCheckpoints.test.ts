import assert from 'node:assert/strict';
import test from 'node:test';
import type { VerifiedExtraction } from '../lib/narrative/import/proposalValidator.ts';
import {
  createImportCheckpoint, markInterruptedSegmentsUncertain, matchesImportCheckpointIdentity,
  validateCheckpoint, validateCheckpointEvidence, type ImportCheckpointIdentityInput,
} from '../lib/narrative/import/analysisCheckpoints.ts';

const identity: ImportCheckpointIdentityInput = {
  source: { digest: 'sha256-source', filename: 'chapter.txt', mediaType: 'text/plain', byteLength: 31 },
  scope: 'selective', categories: ['characters', 'events'], instruction: 'Keep beliefs separate from facts.',
  provider: { connectionId: 'gemini-managed', modelId: 'model-x', reasoningLevel: 'default', capabilityPolicyVersion: 'cap-v3' },
  complete: true, maxCalls: 12, maxInputTokens: 8_000, envelopeReserveTokens: 1_500,
  contextLimitTokens: 24_000, totalCharacters: 31,
  chunks: [{ id: 'chunk-1', index: 0, start: 0, end: 31 }],
};

test('checkpoint binds exact source, plan, provider identity and stores no manuscript or raw guidance', async () => {
  const checkpoint = await createImportCheckpoint(identity);
  assert.equal(validateCheckpoint(checkpoint), true);
  const serialized = JSON.stringify(checkpoint);
  assert.equal(serialized.includes(identity.instruction), false);
  assert.equal(serialized.includes('sourceText'), false);
  assert.equal(await matchesImportCheckpointIdentity(checkpoint, identity), true);
  assert.equal(await matchesImportCheckpointIdentity(checkpoint, {
    ...identity, provider: { ...identity.provider, modelId: 'different-model' },
  }), false);
  assert.equal(await matchesImportCheckpointIdentity(checkpoint, {
    ...identity, provider: { ...identity.provider, capabilityPolicyVersion: 'changed-policy' },
  }), false);
  assert.equal(await matchesImportCheckpointIdentity(checkpoint, { ...identity, instruction: 'Different guidance.' }), false);
  assert.equal(await matchesImportCheckpointIdentity(checkpoint, { ...identity, source: { ...identity.source, digest: 'changed-source' } }), false);
  assert.equal(await matchesImportCheckpointIdentity(checkpoint, { ...identity, maxInputTokens: 7_999 }), false);
});

test('interrupted in-flight segments become uncertain without refunding consumed attempts', async () => {
  const checkpoint = await createImportCheckpoint(identity);
  checkpoint.budget.callsUsed = 1;
  checkpoint.segments[0].status = 'in-flight';
  checkpoint.segments[0].attempts = 1;
  const recovered = markInterruptedSegmentsUncertain(checkpoint);
  assert.equal(recovered.segments[0].status, 'uncertain');
  assert.equal(recovered.budget.callsUsed, 1);
  assert.equal(recovered.segments[0].attempts, 1);
});

test('checkpoint schema rejects malformed bounds, unknown status and budget reset attempts', async () => {
  const checkpoint = await createImportCheckpoint(identity);
  assert.equal(validateCheckpoint({ ...checkpoint, budget: { callsUsed: 13, maxCalls: 12 } }), false);
  assert.equal(validateCheckpoint({
    ...checkpoint,
    segments: [{ ...checkpoint.segments[0], status: 'running' }],
  }), false);
  assert.equal(validateCheckpoint({
    ...checkpoint,
    segments: [{ ...checkpoint.segments[0], status: 'complete' }],
  }), false);
});

test('checkpoint rejects completed evidence when the source digest is stale', async () => {
  const checkpoint = await createImportCheckpoint(identity);
  checkpoint.segments[0].status = 'complete';
  checkpoint.segments[0].result = {
    findings: [{ evidence: { sourceId: 'old-id', version: 'v1', digest: 'sha256-source', start: 0, end: 3, excerpt: 'abc' } }],
    entities: [], relationships: [], ambiguities: [], rejectedEvidenceCount: 0,
  } as unknown as VerifiedExtraction;
  assert.equal(validateCheckpointEvidence(checkpoint, 'abc chapter one.', 'sha256-source'), true);
  assert.equal(validateCheckpointEvidence(checkpoint, 'xyz chapter one.', 'sha256-source'), false);
  assert.equal(validateCheckpointEvidence(checkpoint, 'A different manuscript source, not chapter one.', 'changed-digest'), false);
});
