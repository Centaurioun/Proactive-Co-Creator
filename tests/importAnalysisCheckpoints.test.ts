import assert from 'node:assert/strict';
import test from 'node:test';
import type { VerifiedExtraction } from '../lib/narrative/import/proposalValidator.ts';
import {
  createImportCheckpoint, matchesImportCheckpointIdentity,
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
  assert.equal(await matchesImportCheckpointIdentity(checkpoint, {
    ...identity, provider: { ...identity.provider, credentialAuthorityId: 'different-server-session' },
  }), false);
  assert.equal(await matchesImportCheckpointIdentity(checkpoint, { ...identity, instruction: 'Different guidance.' }), false);
  assert.equal(await matchesImportCheckpointIdentity(checkpoint, { ...identity, source: { ...identity.source, digest: 'changed-source' } }), false);
  assert.equal(await matchesImportCheckpointIdentity(checkpoint, { ...identity, maxInputTokens: 7_999 }), false);
});

test('active attempt must carry a fenced owner and uncertainty never refunds attempts', async () => {
  const checkpoint = await createImportCheckpoint(identity);
  checkpoint.budget.callsUsed = 1;
  checkpoint.segments[0].status = 'in-flight';
  checkpoint.segments[0].attempts = 1;
  assert.equal(validateCheckpoint(checkpoint), false);
  checkpoint.segments[0].attemptId = 'attempt-1';
  checkpoint.segments[0].ownerId = 'tab-a';
  checkpoint.segments[0].leaseExpiresAt = Date.now() + 10_000;
  assert.equal(validateCheckpoint(checkpoint), true);
  checkpoint.segments[0].status = 'uncertain';
  delete checkpoint.segments[0].ownerId;
  delete checkpoint.segments[0].leaseExpiresAt;
  assert.equal(validateCheckpoint(checkpoint), true);
  assert.equal(checkpoint.budget.callsUsed, 1);
  assert.equal(checkpoint.segments[0].attempts, 1);
});

test('restore identity recomputes immutable plan fields instead of trusting the stored digest', async () => {
  const checkpoint = await createImportCheckpoint(identity);
  assert.equal(await matchesImportCheckpointIdentity(checkpoint, identity), true);
  const corrupted = { ...checkpoint, plan: { ...checkpoint.plan, maxInputTokens: 7_999 } };
  assert.equal(await matchesImportCheckpointIdentity(corrupted, identity), false);
  const alteredDigest = { ...checkpoint, identityDigest: 'a'.repeat(64) };
  assert.equal(await matchesImportCheckpointIdentity(alteredDigest, identity), false);
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

test('checkpoint evidence must stay inside the segment that asserted it', async () => {
  const checkpoint = await createImportCheckpoint({
    ...identity,
    source: { digest: 'small-source', filename: 'small.txt', mediaType: 'text/plain', byteLength: 3 },
    totalCharacters: 3,
    chunks: [
      { id: 'chunk-1', index: 0, start: 0, end: 2 },
      { id: 'chunk-2', index: 1, start: 1, end: 3 },
    ],
  });
  checkpoint.budget.callsUsed = 1;
  checkpoint.segments[0].status = 'complete';
  checkpoint.segments[0].attempts = 1;
  checkpoint.segments[0].attemptId = 'attempt-1';
  checkpoint.segments[0].result = {
    findings: [{
      id: 'finding-2-3-example', title: 'A fact', value: '', category: 'other', kind: 'explicit', rationale: '',
      evidence: { sourceId: 'source-1', version: 'v1', digest: 'small-source', start: 2, end: 3, excerpt: 'c' },
    }],
    entities: [], relationships: [], ambiguities: [], rejectedEvidenceCount: 0,
  } as unknown as VerifiedExtraction;
  checkpoint.coverage.processedCharacters = 2;
  assert.equal(validateCheckpoint(checkpoint), true);
  assert.equal(validateCheckpointEvidence(checkpoint, 'abc', 'small-source'), false);
});
