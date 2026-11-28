import assert from 'node:assert/strict';
import test from 'node:test';
import { runImportAnalysisSession } from '../lib/narrative/import/analysisRunner.ts';
import {
  ALL_IMPORT_CATEGORIES,
  resolveProviderPlanContext,
  type ImportProviderPlanContext,
} from '../lib/narrative/import/providerPlan.ts';
import { createImportCheckpoint, getImportCheckpoint, saveImportCheckpoint } from '../lib/narrative/import/analysisCheckpoints.ts';
import type { ParsedNarrativeSource } from '../lib/narrative/import/sourceParser.ts';
import type { ProviderHubStatus } from '../services/apiClient.ts';

function createRunnerFakeIdb(options: { onGetDelayMs?: (key: string, callIndex: number) => number } = {}) {
  const records = new Map<string, unknown>();
  let getCallCount = 0;
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
    const scheduleComplete = () => {
      if (tx.aborted || tx.pendingOps > 0 || tx.hasScheduledCompletion) return;
      tx.hasScheduledCompletion = true;
      setTimeout(() => {
        tx.hasScheduledCompletion = false;
        if (!tx.aborted && tx.pendingOps === 0) tx.oncomplete?.();
      }, 0);
    };
    const makeReq = <T,>(op: () => T, delayMs = 0) => {
      tx.pendingOps += 1;
      const req = { result: undefined as unknown as T, error: null as Error | null, onsuccess: null as (() => void) | null, onerror: null as (() => void) | null };
      setTimeout(() => {
        if (tx.aborted) return;
        req.result = op();
        req.onsuccess?.();
        tx.pendingOps -= 1;
        scheduleComplete();
      }, delayMs);
      return req;
    };
    const storeApi = {
      get: (key: string) => {
        const idx = ++getCallCount;
        const delayMs = options.onGetDelayMs ? options.onGetDelayMs(key, idx) : 0;
        return makeReq(() => {
          const val = records.get(key);
          return val ? structuredClone(val) : undefined;
        }, delayMs);
      },
      getAll: () => makeReq(() => Array.from(records.values()).map(v => structuredClone(v))),
      put: (val: { id: string }) => makeReq(() => {
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
        close: () => {},
      };
      const req: Record<string, unknown> = { result: db, error: null, onsuccess: null, onerror: null, onblocked: null, onupgradeneeded: null };
      setTimeout(() => { (req.onupgradeneeded as (() => void) | null)?.(); (req.onsuccess as (() => void) | null)?.(); }, 0);
      return req as unknown as IDBOpenDBRequest;
    },
  } as unknown as IDBFactory;
  return { factory, records };
}

const sampleProviderContext: ImportProviderPlanContext = {
  connectionId: 'gemini-managed',
  modelId: 'gemini-2.5-flash',
  reasoningLevel: 'default',
  contextLimitTokens: 200,
  operationEligible: true,
  capabilityPolicyVersion: 'cap-v3',
  credentialAuthorityId: 'cred-managed-1',
};

function makeSource(text: string): ParsedNarrativeSource {
  return {
    text,
    filename: 'story.txt',
    mediaType: 'text/plain',
    byteLength: new TextEncoder().encode(text).byteLength,
    digest: 'a'.repeat(64),
    blocks: [],
    warnings: [],
    retention: 'extracted-only',
  };
}

function makeHarness(overrides: {
  source?: ParsedNarrativeSource;
  providerPlanContext?: ImportProviderPlanContext | null;
  callsUsed?: number;
  idbFactory?: IDBFactory;
  getIdbFactory?: () => IDBFactory;
  extractChunk?: (req: { chunkId: string; text: string }, signal?: AbortSignal) => Promise<unknown>;
  readProviderSnapshotRaw?: () => string | null;
  leaseRenewIntervalMs?: number;
  initialCheckpoint?: Awaited<ReturnType<typeof createImportCheckpoint>> | null;
  isStaleEpoch?: () => boolean;
} = {}) {
  let busy = false;
  let cancelled = false;
  let requestError = '';
  let callsUsed = overrides.callsUsed ?? 0;
  let completedSessionCount = 0;
  const results: unknown[] = [];
  const completedChunkIds = new Set<string>();
  let failedChunks: Array<{ id: string }> = [];
  let activeCheckpointId: string | null = null;
  let currentCheckpoint = overrides.initialCheckpoint ?? null;
  const controller = new AbortController();

  const run = () => runImportAnalysisSession({
    source: overrides.source ?? makeSource('Ada opens the door.'),
    sourceId: 'source-1',
    providerPlanContext: overrides.providerPlanContext === undefined ? sampleProviderContext : overrides.providerPlanContext,
    configuration: { scope: 'complete', categories: ALL_IMPORT_CATEGORIES, instruction: '' },
    hasExistingConfiguration: false,
    retry: false,
    callsUsed,
    failedChunks: [],
    rejectedEvidenceCount: 0,
    initialCheckpoint: currentCheckpoint,
    initialProviderSnapshotRaw: '{"defaultConnectionId":"gemini-managed"}',
    ownerId: 'owner-1',
    controller,
    isStaleEpoch: overrides.isStaleEpoch ?? (() => false),
    deps: {
      getIdbFactory: overrides.getIdbFactory ?? (() => overrides.idbFactory!),
      extractChunk: overrides.extractChunk ?? (async () => ({ findings: [], entities: [], relationships: [], ambiguities: [] })),
      isAbortError: (err) => err instanceof Error && err.name === 'AbortError',
      readProviderSnapshotRaw: overrides.readProviderSnapshotRaw ?? (() => '{"defaultConnectionId":"gemini-managed"}'),
      leaseRenewIntervalMs: overrides.leaseRenewIntervalMs ?? 30_000,
    },
    callbacks: {
      setBusy: (v) => { busy = v; },
      setCancelled: (v) => { cancelled = v; },
      setRequestError: (v) => { requestError = v; },
      setSourceOnlyMode: () => {},
      setAnalysisConfiguration: () => {},
      setActiveCheckpointId: (v) => { activeCheckpointId = v; },
      setChunks: () => {},
      setSegmentationComplete: () => {},
      setResults: (u) => {
        const next = typeof u === 'function' ? u(results as never) : u;
        results.splice(0, results.length, ...next);
      },
      setCompletedChunkIds: (u) => {
        const next = typeof u === 'function' ? u(completedChunkIds) : u;
        completedChunkIds.clear();
        for (const id of next) completedChunkIds.add(id);
      },
      setFailedChunks: (u) => {
        failedChunks = typeof u === 'function' ? u(failedChunks as never) : u;
      },
      setRejectedEvidenceCount: () => {},
      setCallsUsed: (v) => { callsUsed = v; },
      onCheckpointUpdated: (cp) => { currentCheckpoint = cp; },
      onCompleteSession: () => { completedSessionCount += 1; },
    },
  });

  return {
    run,
    controller,
    state: () => ({ busy, cancelled, requestError, callsUsed, completedSessionCount, results, completedChunkIds, failedChunks, activeCheckpointId, currentCheckpoint }),
  };
}

test('R01: pre-loop indexedDB SecurityError resets busy and inProgress session with 0 provider calls and allows subsequent retry', async () => {
  let providerCalls = 0;
  let shouldThrowIdb = true;
  const idb = createRunnerFakeIdb();
  const h = makeHarness({
    getIdbFactory: () => {
      if (shouldThrowIdb) throw new Error('SecurityError: indexedDB access denied');
      return idb.factory;
    },
    extractChunk: async () => {
      providerCalls += 1;
      return { findings: [], entities: [], relationships: [], ambiguities: [] };
    },
  });

  await h.run();
  assert.equal(h.state().busy, false, 'busy must reset to false after pre-loop IDB throw');
  assert.equal(h.state().completedSessionCount, 1, 'onCompleteSession must run in finally so inProgress resets');
  assert.match(h.state().requestError, /SecurityError/);
  assert.equal(providerCalls, 0);

  // Retry after storage recovers
  shouldThrowIdb = false;
  await h.run();
  assert.equal(h.state().busy, false);
  assert.equal(h.state().completedSessionCount, 2);
  assert.equal(providerCalls, 1);
  assert.equal(h.state().completedChunkIds.has('chunk-1'), true);
});

test('R01 & pre-loop abort: cancelling while awaiting pre-loop checkpoint lookup skips save/provider calls and resets busy', async () => {
  let providerCalls = 0;
  const idb = createRunnerFakeIdb();
  const text = 'Ada opens the door.';
  const cp = await createImportCheckpoint({
    source: { digest: 'a'.repeat(64), filename: 'story.txt', mediaType: 'text/plain', byteLength: text.length },
    scope: 'complete',
    categories: ALL_IMPORT_CATEGORIES,
    instruction: '',
    provider: {
      connectionId: sampleProviderContext.connectionId,
      modelId: sampleProviderContext.modelId,
      reasoningLevel: sampleProviderContext.reasoningLevel,
      capabilityPolicyVersion: sampleProviderContext.capabilityPolicyVersion,
      credentialAuthorityId: sampleProviderContext.credentialAuthorityId,
    },
    complete: true,
    maxCalls: 12,
    maxInputTokens: 200,
    envelopeReserveTokens: 40,
    contextLimitTokens: 200,
    totalCharacters: text.length,
    chunks: [{ id: 'chunk-1', index: 0, start: 0, end: text.length }],
  });
  await saveImportCheckpoint(idb.factory, cp);
  const origOpen = idb.factory.open.bind(idb.factory);
  let abortedOnce = false;
  const h = makeHarness({
    source: makeSource(text),
    idbFactory: idb.factory,
    initialCheckpoint: cp,
    extractChunk: async () => {
      providerCalls += 1;
      return { findings: [], entities: [], relationships: [], ambiguities: [] };
    },
  });
  idb.factory.open = (...args: Parameters<IDBFactory['open']>) => {
    if (!abortedOnce) {
      abortedOnce = true;
      queueMicrotask(() => h.controller.abort());
    }
    return origOpen(...args);
  };

  await h.run();
  assert.equal(h.state().busy, false);
  assert.equal(h.state().completedSessionCount, 1);
  assert.equal(providerCalls, 0);
  const after = await getImportCheckpoint(idb.factory, cp.id);
  assert.equal(after.ok && after.value?.budget.callsUsed, 0, 'Aborted pre-loop run must not reserve attempts');
});

test('W3-NEW-03: slow lease renewal completing after chunk 1 finishes must not abort chunk 2', async () => {
  const text = 'Ada opened the harbor gate at dawn.\n\n'.repeat(30);
  const source = makeSource(text);
  let chunk1InFlight = false;
  let delayedOnce = false;
  let renewGetStarted = false;
  let chunk2Started = false;

  const idb = createRunnerFakeIdb({
    onGetDelayMs: () => {
      // When chunk 1 is inside extractChunk, the 5ms lease timer triggers renewImportSegmentAttempt -> store.get
      if (chunk1InFlight && !delayedOnce) {
        delayedOnce = true;
        renewGetStarted = true;
        return 60; // Resolves AFTER chunk 1 finishes (at ~20ms) and while chunk 2 is running!
      }
      return 0;
    },
  });

  const h = makeHarness({
    source,
    idbFactory: idb.factory,
    leaseRenewIntervalMs: 5,
    extractChunk: async (req) => {
      if (req.chunkId === 'chunk-1') {
        chunk1InFlight = true;
        await new Promise(resolve => setTimeout(resolve, 20));
        chunk1InFlight = false;
        assert.equal(renewGetStarted, true, 'keepLease must have started renewImportSegmentAttempt while chunk 1 was in flight');
        return { findings: [], entities: [], relationships: [], ambiguities: [] };
      }
      chunk2Started = true;
      await new Promise(resolve => setTimeout(resolve, 80));
      assert.equal(h.controller.signal.aborted, false, 'Zombie keepLease from chunk 1 must not abort chunk 2');
      return { findings: [], entities: [], relationships: [], ambiguities: [] };
    },
  });

  await h.run();
  assert.equal(chunk2Started, true);
  assert.equal(h.state().completedChunkIds.size, 2, 'Both chunks must complete without zombie timer abort');
  assert.equal(h.state().requestError, '');
  assert.equal(h.state().cancelled, false);
});

test('provider selection change mid-run stops remaining segments before next reservation', async () => {
  const idb = createRunnerFakeIdb();
  const text = 'Ada opened the harbor gate at dawn.\n\n'.repeat(30);
  let snapshot = '{"defaultConnectionId":"gemini-managed"}';
  const calls: string[] = [];
  const h = makeHarness({
    source: makeSource(text),
    idbFactory: idb.factory,
    readProviderSnapshotRaw: () => snapshot,
    extractChunk: async (req) => {
      calls.push(req.chunkId);
      snapshot = '{"defaultConnectionId":"openai-api"}';
      return { findings: [], entities: [], relationships: [], ambiguities: [] };
    },
  });

  await h.run();
  assert.deepEqual(calls, ['chunk-1']);
  assert.match(h.state().requestError, /provider selection changed/i);
  assert.equal(h.state().busy, false);
  const cp = await getImportCheckpoint(idb.factory, h.state().activeCheckpointId!);
  assert.equal(cp.ok && cp.value?.budget.callsUsed, 1);
});

test('providerPlan resolves W1 ProviderHubStatus DTOs cleanly and flags incomplete identity', () => {
  const status: ProviderHubStatus = {
    localPersonalConnectionsAvailable: true,
    capabilityPolicyVersion: 'cap-v4',
    credentialAuthorityIds: {
      'gemini-managed': 'auth-managed',
      'gemini-personal': 'auth-personal',
      'chatgpt-plan': 'auth-chatgpt',
      'openai-api': 'auth-openai',
    },
    connections: [
      {
        id: 'gemini-managed',
        family: 'gemini',
        billing: 'host-managed-gemini',
        state: 'available',
        selectedModelId: 'gemini-2.5-pro',
        models: [
          {
            id: 'gemini-2.5-pro',
            displayName: 'Gemini 2.5 Pro',
            availability: { state: 'supported', value: true, evidence: [] },
            textGeneration: { state: 'supported', value: true, evidence: [] },
            imageGeneration: { state: 'unsupported', evidence: [] },
            structuredOutput: { state: 'supported', value: true, evidence: [] },
            contextLimit: { state: 'supported', value: 32_000, evidence: [] },
            outputLimit: { state: 'supported', value: 8_192, evidence: [] },
            reasoning: { state: 'supported', value: ['default', 'medium'], evidence: [] },
            operationCapabilities: { 'narrative-import': { state: 'supported', value: true, evidence: [] } },
            capabilityPolicyVersion: 'cap-v4',
          },
        ],
      },
    ],
    preferences: { defaultConnectionId: 'gemini-managed' },
    usage: { observedByConnection: {}, quota: { state: 'unknown' } },
  };
  const resolved = resolveProviderPlanContext(status, {
    defaultConnectionId: 'gemini-managed',
    defaultReasoningLevel: 'medium',
  });
  assert.equal(resolved.connectionId, 'gemini-managed');
  assert.equal(resolved.modelId, 'gemini-2.5-pro');
  assert.equal(resolved.reasoningLevel, 'medium');
  assert.equal(resolved.contextLimitTokens, 32_000);
  assert.equal(resolved.operationEligible, true);
  assert.equal(resolved.credentialAuthorityId, 'auth-managed');

  assert.throws(
    () => resolveProviderPlanContext(status, { defaultConnectionId: 'openai-api' }),
    /incomplete/i,
  );
  void saveImportCheckpoint;
});

test('W6-D08: early return on ineligible provider or budget cap invokes onCompleteSession and avoids inProgress deadlock', async () => {
  const ineligible = makeHarness({
    providerPlanContext: { ...sampleProviderContext, operationEligible: false },
  });
  await ineligible.run();
  assert.equal(ineligible.state().completedSessionCount, 1, 'onCompleteSession must run on ineligible provider early return');
  assert.equal(ineligible.state().busy, false);
  assert.match(ineligible.state().requestError, /verified eligible provider/i);

  const chatgptIneligible = makeHarness({
    providerPlanContext: { ...sampleProviderContext, connectionId: 'chatgpt-plan', operationEligible: false },
  });
  await chatgptIneligible.run();
  assert.equal(chatgptIneligible.state().completedSessionCount, 1, 'onCompleteSession must run on ineligible chatgpt-plan early return');
  assert.equal(chatgptIneligible.state().busy, false);

  const budgetCapped = makeHarness({ callsUsed: 12 });
  await budgetCapped.run();
  assert.equal(budgetCapped.state().completedSessionCount, 1, 'onCompleteSession must run on budget-cap early return');
  assert.equal(budgetCapped.state().busy, false);
  assert.match(budgetCapped.state().requestError, /12-call safety budget/i);
});
