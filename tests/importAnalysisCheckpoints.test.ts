import assert from 'node:assert/strict';
import test from 'node:test';
import type { VerifiedExtraction } from '../lib/narrative/import/proposalValidator.ts';
import {
  createImportCheckpoint, getImportCheckpoint, listImportCheckpoints,
  matchesImportCheckpointIdentity, reserveImportSegmentAttempt, saveImportCheckpoint,
  sha256HexSync, sha256Text, validateCheckpoint, validateCheckpointEvidence,
  type ImportCheckpointIdentityInput,
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

test('checkpoint persists a bounded 12-segment schedule and binds omitted suggestions for resume', async () => {
  const chunks = Array.from({ length: 20 }, (_, index) => ({
    id: `chunk-${index + 1}`, index, start: index * 9, end: index * 9 + 10,
  }));
  const input: ImportCheckpointIdentityInput = {
    ...identity,
    source: { digest: 'long-source', filename: 'long.txt', mediaType: 'text/plain', byteLength: 200 },
    complete: false, maxCalls: 12, totalCharacters: 200, chunks,
  };
  const checkpoint = await createImportCheckpoint(input);
  assert.equal(checkpoint.plan.suggestedSegments.length, 20);
  assert.equal(checkpoint.plan.suggestedSegmentCount, 20);
  assert.equal(checkpoint.plan.scheduledSegmentCount, 12);
  assert.equal(checkpoint.plan.scheduledEnd, checkpoint.segments.at(-1)!.end);
  assert.equal(checkpoint.plan.omittedCharacters, input.totalCharacters - checkpoint.plan.scheduledEnd);
  assert.equal(checkpoint.segments.length, 12);
  assert.equal(checkpoint.budget.maxCalls, 12);
  assert.equal(checkpoint.plan.complete, false);
  assert.equal(validateCheckpoint(checkpoint), true);
  assert.equal(validateCheckpoint({ ...checkpoint, plan: { ...checkpoint.plan, scheduledSegmentCount: 13 } }), false);
  assert.equal(await matchesImportCheckpointIdentity(checkpoint, input), true);
  assert.equal(await matchesImportCheckpointIdentity(checkpoint, { ...input, chunks: chunks.slice(0, 19) }), false);

  const attempted = structuredClone(checkpoint);
  attempted.budget.callsUsed = 1;
  attempted.segments[0].attempts = 1;
  attempted.segments[0].attemptId = 'failed-attempt-1';
  attempted.segments[0].status = 'failed';
  assert.equal(validateCheckpoint(attempted), true);
  assert.equal(await matchesImportCheckpointIdentity(attempted, input), true, 'failed attempts restore under the same immutable plan identity');
  assert.equal(attempted.budget.callsUsed, 1);
  assert.equal(attempted.segments[0].attempts, 1);
});

function createCheckpointFakeIdb(options: { fireOnBlockedThenLateSuccess?: boolean } = {}) {
  const records = new Map<string, unknown>();
  let dbClosed = false;
  let postBlockedPutCount = 0;
  let lateSuccessTrigger: (() => void) | null = null;
  let blockedFired = false;

  const createTx = () => {
    const tx = {
      error: null as Error | null,
      oncomplete: null as (() => void) | null,
      onerror: null as (() => void) | null,
      onabort: null as (() => void) | null,
      aborted: false,
      pendingOps: 0,
      hasScheduledCompletion: false,
      abort() {
        if (tx.aborted) return;
        tx.aborted = true;
        tx.error = tx.error ?? new Error('Transaction aborted');
        setTimeout(() => tx.onabort?.(), 0);
      },
      objectStore: () => storeApi,
    };
    const scheduleCompleteIfIdle = () => {
      if (tx.aborted || tx.pendingOps > 0 || tx.hasScheduledCompletion) return;
      tx.hasScheduledCompletion = true;
      setTimeout(() => {
        tx.hasScheduledCompletion = false;
        if (!tx.aborted && tx.pendingOps === 0) tx.oncomplete?.();
      }, 0);
    };
    const makeReq = <T,>(runOp: () => T) => {
      tx.pendingOps += 1;
      const req = { result: undefined as unknown as T, error: null as Error | null, onsuccess: null as (() => void) | null, onerror: null as (() => void) | null };
      setTimeout(() => {
        if (tx.aborted) return;
        req.result = runOp();
        req.onsuccess?.();
        tx.pendingOps -= 1;
        scheduleCompleteIfIdle();
      }, 0);
      return req;
    };
    const storeApi = {
      get: (key: string) => makeReq(() => {
        const val = records.get(key);
        return val ? structuredClone(val) : undefined;
      }),
      getAll: () => makeReq(() => Array.from(records.values()).map(v => structuredClone(v))),
      put: (val: { id: string }) => makeReq(() => {
        if (blockedFired) postBlockedPutCount += 1;
        records.set(val.id, structuredClone(val));
        return val.id;
      }),
      delete: (key: string) => makeReq(() => {
        records.delete(key);
        return undefined;
      }),
    };
    return tx;
  };

  const factory = {
    open() {
      const db = {
        objectStoreNames: { contains: () => true },
        createObjectStore: () => ({}),
        transaction: createTx,
        close: () => { dbClosed = true; },
      };
      const req: Record<string, unknown> = {
        result: db,
        error: null,
        onsuccess: null,
        onerror: null,
        onblocked: null,
        onupgradeneeded: null,
      };
      setTimeout(() => {
        if (options.fireOnBlockedThenLateSuccess) {
          blockedFired = true;
          (req.onblocked as (() => void) | null)?.();
          lateSuccessTrigger = () => { (req.onsuccess as (() => void) | null)?.(); };
        } else {
          (req.onupgradeneeded as (() => void) | null)?.();
          (req.onsuccess as (() => void) | null)?.();
        }
      }, 0);
      return req as unknown as IDBOpenDBRequest;
    },
  } as unknown as IDBFactory;

  return {
    factory,
    records,
    get dbClosed() { return dbClosed; },
    get postBlockedPutCount() { return postBlockedPutCount; },
    triggerLateSuccess: () => lateSuccessTrigger?.(),
  };
}

test('R04: onblocked followed by late onsuccess must not mutate IDB or leak open handle', async () => {
  const idb = createCheckpointFakeIdb({ fireOnBlockedThenLateSuccess: true });
  const cp = await createImportCheckpoint(identity);
  const res = await saveImportCheckpoint(idb.factory, cp);
  assert.equal(res.ok, false);
  idb.triggerLateSuccess();
  await new Promise(resolve => setTimeout(resolve, 25));
  assert.equal(idb.postBlockedPutCount, 0, 'Late onsuccess after onblocked must not write to IDB');
  assert.equal(idb.dbClosed, true, 'Late onsuccess after onblocked must close the leaked IDBDatabase handle');
});

test('R05: checkpoint eviction protects live leases and consumed-budget checkpoints, failing closed if all 8 hold live leases', async () => {
  const idb = createCheckpointFakeIdb();
  const makeCp = (tag: string) => createImportCheckpoint({
    ...identity,
    source: { digest: `digest-${tag}`, filename: `${tag}.txt`, mediaType: 'text/plain', byteLength: 31 },
  });

  // (a) cp0 has live in-flight lease, cp1..cp8 are idle -> cp0 must be preserved, oldest idle cp1 evicted
  const cp0 = await makeCp('live-0');
  assert.equal((await saveImportCheckpoint(idb.factory, cp0)).ok, true);
  assert.equal((await reserveImportSegmentAttempt(idb.factory, cp0.id, 'chunk-1', 'tab-a', false, 60_000)).ok, true);

  const idleIds: string[] = [];
  for (let i = 1; i <= 8; i += 1) {
    const idle = await makeCp(`idle-${i}`);
    idleIds.push(idle.id);
    assert.equal((await saveImportCheckpoint(idb.factory, idle)).ok, true);
  }
  const listedA = await listImportCheckpoints(idb.factory);
  assert.equal(listedA.ok, true);
  if (listedA.ok) {
    assert.equal(listedA.value.length, 8);
    assert.equal(listedA.value.some(item => item.id === cp0.id), true, 'Live in-flight checkpoint must not be evicted');
    assert.equal(listedA.value.some(item => item.id === idleIds[0]), false, 'Oldest idle checkpoint should be evicted first');
  }

  // (b) cpUsed has callsUsed=1 (failed, non-active), saved before 8 idle callsUsed=0 checkpoints -> cpUsed preserved
  const idbB = createCheckpointFakeIdb();
  const cpUsed = await makeCp('used-0');
  cpUsed.budget.callsUsed = 1;
  cpUsed.segments[0].attempts = 1;
  cpUsed.segments[0].attemptId = 'att-1';
  cpUsed.segments[0].status = 'failed';
  assert.equal((await saveImportCheckpoint(idbB.factory, cpUsed)).ok, true);
  for (let i = 1; i <= 8; i += 1) {
    const idle = await makeCp(`used-idle-${i}`);
    assert.equal((await saveImportCheckpoint(idbB.factory, idle)).ok, true);
  }
  const gotUsed = await getImportCheckpoint(idbB.factory, cpUsed.id);
  assert.equal(gotUsed.ok && Boolean(gotUsed.value), true, 'Consumed-budget checkpoint must not be evicted before unused callsUsed=0 checkpoints');

  // (c) 8 live in-flight checkpoints + 9th save -> fails closed
  const idbC = createCheckpointFakeIdb();
  for (let i = 0; i < 8; i += 1) {
    const live = await makeCp(`all-live-${i}`);
    assert.equal((await saveImportCheckpoint(idbC.factory, live)).ok, true);
    assert.equal((await reserveImportSegmentAttempt(idbC.factory, live.id, 'chunk-1', `tab-${i}`, false, 60_000)).ok, true);
  }
  const ninth = await makeCp('ninth');
  const ninthRes = await saveImportCheckpoint(idbC.factory, ninth);
  assert.equal(ninthRes.ok, false, 'Saving a 9th checkpoint when all 8 hold live leases must fail closed');
});

test('W3-NEW-02: corrupt record missing updatedAt does not poison saveImportCheckpoint with NaN', async () => {
  const idb = createCheckpointFakeIdb();
  idb.records.set('corrupt-legacy', { id: 'corrupt-legacy' });
  const cp = await createImportCheckpoint(identity);
  const saved = await saveImportCheckpoint(idb.factory, cp);
  assert.equal(saved.ok, true);
  const fetched = await getImportCheckpoint(idb.factory, cp.id);
  assert.equal(fetched.ok, true);
  if (fetched.ok) {
    assert.ok(fetched.value, 'Saved checkpoint must remain valid and retrievable despite corrupt sibling record');
    assert.equal(Number.isFinite(fetched.value?.updatedAt), true);
  }
});

test('R10: sha256HexSync matches WebCrypto and node:crypto bit-for-bit across NIST and UTF-8 vectors', async () => {
  const { createHash } = await import('node:crypto');
  const vectors = [
    '',
    'abc',
    'a'.repeat(55),
    'a'.repeat(56),
    'a'.repeat(63),
    'a'.repeat(64),
    'a'.repeat(65),
    'a'.repeat(119),
    'a'.repeat(120),
    'a'.repeat(128),
    'İpek 🦉 🇹🇷 👩🏽‍🚀 şafakta rüzgâr kıyıdaki feneri söndürdü.',
    'Türkçe öykü '.repeat(400),
  ];
  for (const vector of vectors) {
    const expected = createHash('sha256').update(vector, 'utf8').digest('hex');
    assert.equal(sha256HexSync(vector), expected);
    assert.equal(await sha256Text(vector), expected);
  }
});
