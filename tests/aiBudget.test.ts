import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  evaluateAggregateBudget,
  evaluateAiBudget,
  measureJsonBytes,
  type AiBudgetPolicy,
  type AiBudgetRequest,
  type AggregateUsage,
  type TokenMeasurement,
} from '../server/aiBudget.ts';

const text = 'Türkçe anlatı 🦉';

function reasonOf(result: Awaited<ReturnType<typeof evaluateAiBudget>>): string | undefined {
  return result.kind === 'rejected' ? result.reason : undefined;
}

function contextTokensOf(result: Awaited<ReturnType<typeof evaluateAiBudget>>): number | undefined {
  return result.kind === 'allowed' ? result.contextTokens : undefined;
}

function request(overrides: Partial<AiBudgetRequest> = {}): AiBudgetRequest {
  const contents = { parts: [{ text }] };
  const systemInstruction = { parts: [{ text: 'Only analyze supplied details.' }] };
  const schema = { type: 'OBJECT', properties: { result: { type: 'STRING' } } };
  return {
    model: 'fixture-text-model',
    operation: 'analyze',
    modalities: ['text'],
    contents,
    systemInstruction,
    schema,
    transportPayload: { contents, systemInstruction, generationConfig: { responseSchema: schema } },
    ...overrides,
  };
}

function policy(overrides: Partial<AiBudgetPolicy> = {}): AiBudgetPolicy {
  return {
    capability: {
      model: 'fixture-text-model',
      operation: 'analyze',
      modalities: ['text'],
      provenance: { state: 'verified', evidenceRef: 'fixture evidence only' },
    },
    reserves: {
      schema: { tokens: 2, evidenceRef: 'fixture schema reserve' },
      reasoning: { tokens: 2, evidenceRef: 'fixture reasoning reserve' },
    },
    limits: {
      maxContextTokens: 18,
      maxOutputTokens: 4,
      maxRequestBytes: 4096,
      countTimeoutMs: 100,
      maxRequests: 3,
      maxInputTokens: 20,
      maxAggregateInputTokens: 40,
      maxChunks: 2,
      maxRetries: 1,
      maxElapsedMs: 1000,
      maxConcurrency: 2,
    },
    ...overrides,
  };
}

function providerCount(
  inputTokens: number,
  covered: Array<'contents' | 'systemInstruction'> = ['contents', 'systemInstruction']
): TokenMeasurement {
  return { kind: 'provider-count', inputTokens, covered };
}

describe('network-free shared AI budget contract', () => {
  it('accepts an exact context boundary and rejects one token over', async () => {
    const countTokens = async () => providerCount(10);
    const exact = await evaluateAiBudget({ request: request(), policy: policy(), countTokens });
    const over = await evaluateAiBudget({
      request: request(),
      policy: policy({ limits: { ...policy().limits, maxContextTokens: 17 } }),
      countTokens: async () => providerCount(10),
    });

    assert.equal(exact.kind, 'allowed');
    assert.equal(contextTokensOf(exact), 18);
    assert.equal(over.kind, 'rejected');
    assert.equal(reasonOf(over), 'BUDGET_EXCEEDED');
  });

  it('preserves Turkish/Unicode and epistemic/coverage markers as opaque counted input', async () => {
    const largeText = `[epistemicClass=reported; approval=confirmed; verifiedTruth=false; analysisCoverage=partial; missingFindings=unknown; chronology=unmodeled]\nİstanbul: ${'öykü 🦉 '.repeat(1100)}`;
    const contents = { parts: [{ text: largeText }] };
    const systemInstruction = { parts: [{ text: 'Only analyze supplied details.' }] };
    const schema = { type: 'OBJECT', properties: { result: { type: 'STRING' } } };
    const transportPayload = { contents, systemInstruction, generationConfig: { responseSchema: schema } };
    const input = request({ contents, transportPayload });
    let counted: unknown;
    const decision = await evaluateAiBudget({
      request: input,
      policy: policy({ limits: {
        ...policy().limits,
        maxContextTokens: 100,
        maxRequestBytes: measureJsonBytes(transportPayload),
      } }),
      countTokens: async (args) => {
        counted = args.contents;
        return providerCount(10);
      },
    });

    assert.equal(decision.kind, 'allowed');
    assert.deepEqual(counted, input.contents);
    assert.equal((counted as { parts: Array<{ text: string }> }).parts[0].text, largeText);
    assert.equal(decision.requestBytes, Buffer.byteLength(JSON.stringify(input.transportPayload), 'utf8'));
    assert.equal(measureJsonBytes({ text: 'İpek 🦉' }), Buffer.byteLength(JSON.stringify({ text: 'İpek 🦉' }), 'utf8'));
  });

  it('accepts exact serialized request bytes and rejects one byte under the requirement', async () => {
    const input = request();
    const bytes = measureJsonBytes(input.transportPayload);
    let countCalls = 0;
    const exact = await evaluateAiBudget({
      request: input,
      policy: policy({ limits: { ...policy().limits, maxRequestBytes: bytes } }),
      countTokens: async () => { countCalls += 1; return providerCount(1); },
    });
    const over = await evaluateAiBudget({
      request: input,
      policy: policy({ limits: { ...policy().limits, maxRequestBytes: bytes - 1 } }),
      countTokens: async () => { countCalls += 1; return providerCount(1); },
    });

    assert.equal(exact.kind, 'allowed');
    assert.equal(over.kind, 'rejected');
    assert.equal(reasonOf(over), 'BUDGET_EXCEEDED');
    assert.equal(countCalls, 1);
  });

  it('rejects exact model, operation, or modality mismatches before counting', async () => {
    let calls = 0;
    const countTokens = async () => { calls += 1; return providerCount(1); };
    const model = await evaluateAiBudget({ request: request({ model: 'unknown-model' }), policy: policy(), countTokens });
    const operation = await evaluateAiBudget({ request: request({ operation: 'image' }), policy: policy(), countTokens });
    const modality = await evaluateAiBudget({ request: request({ modalities: ['text', 'image'] }), policy: policy(), countTokens });

    assert.deepEqual([reasonOf(model), reasonOf(operation), reasonOf(modality)], [
      'UNKNOWN_MODEL', 'UNKNOWN_OPERATION', 'UNSUPPORTED_MODALITY',
    ]);
    assert.equal(calls, 0);
  });

  it('fails closed when capability provenance or schema/reasoning reserves are missing', async () => {
    const countTokens = async () => providerCount(1);
    const unverified = await evaluateAiBudget({
      request: request(),
      policy: policy({ capability: { ...policy().capability, provenance: { state: 'unverified' } } }),
      countTokens,
    });
    const noSchemaReserve = await evaluateAiBudget({
      request: request(),
      policy: policy({ reserves: { reasoning: { tokens: 1, evidenceRef: 'fixture reasoning reserve' } } }),
      countTokens,
    });

    assert.equal(reasonOf(unverified), 'CAPABILITY_UNVERIFIED');
    assert.equal(reasonOf(noSchemaReserve), 'MISSING_RESERVE');

    const unsupported = await evaluateAiBudget({
      request: request(),
      policy: policy({ capability: { ...policy().capability, provenance: { state: 'unsupported' } } }),
      countTokens,
    });
    const documented = await evaluateAiBudget({
      request: request(),
      policy: policy({ capability: {
        ...policy().capability,
        provenance: { state: 'documented-conservative-bound', evidenceRef: 'fixture conservative bound' },
      } }),
      countTokens,
    });
    assert.equal(reasonOf(unsupported), 'CAPABILITY_UNSUPPORTED');
    assert.equal(documented.kind, 'allowed');
  });

  it('requires a scoped reserve for system instructions omitted from a provider partial count', async () => {
    const partial = async () => providerCount(8, ['contents']);
    const noReserve = await evaluateAiBudget({ request: request(), policy: policy(), countTokens: partial });
    const withReserve = await evaluateAiBudget({
      request: request(),
      policy: policy({
        reserves: {
          schema: { tokens: 2, evidenceRef: 'fixture schema reserve' },
          reasoning: { tokens: 1, evidenceRef: 'fixture reasoning reserve' },
          systemInstruction: { tokens: 3, evidenceRef: 'fixture system reserve' },
        },
        limits: { ...policy().limits, maxContextTokens: 18 },
      }),
      countTokens: partial,
    });

    assert.equal(reasonOf(noReserve), 'MISSING_RESERVE');
    assert.equal(withReserve.kind, 'allowed');
    assert.equal(contextTokensOf(withReserve), 18);
  });

  it('keeps estimates and actual usage distinct from provider preflight counts', async () => {
    for (const measurement of [
      { kind: 'estimate', estimatedTokens: 10, basis: 'fixture estimator' },
      { kind: 'actual-usage', inputTokens: 10, outputTokens: 2, source: 'provider response' },
    ] as unknown as TokenMeasurement[]) {
      const decision = await evaluateAiBudget({
        request: request(),
        policy: policy(),
        countTokens: async () => measurement,
      });
      assert.equal(decision.kind, 'rejected');
      assert.equal(reasonOf(decision), 'COUNT_UNAVAILABLE');
    }
  });

  it('returns safe typed results for unavailable, timed out, and cancelled counts', async () => {
    const unavailable = await evaluateAiBudget({
      request: request(),
      policy: policy(),
      countTokens: async () => { throw new Error(`COUNT_TIMEOUT private prompt: ${text}`); },
    });
    let timeoutSignal: AbortSignal | undefined;
    const timedOut = await evaluateAiBudget({
      request: request(),
      policy: policy({ limits: { ...policy().limits, countTimeoutMs: 5 } }),
      countTokens: async (_args, signal) => {
        timeoutSignal = signal;
        return new Promise<TokenMeasurement>(() => {});
      },
    });
    const controller = new AbortController();
    controller.abort();
    let calls = 0;
    const cancelled = await evaluateAiBudget({
      request: request(), policy: policy(), signal: controller.signal,
      countTokens: async () => { calls += 1; return providerCount(1); },
    });

    assert.equal(reasonOf(unavailable), 'COUNT_UNAVAILABLE');
    assert.equal(reasonOf(timedOut), 'COUNT_TIMEOUT');
    assert.equal(reasonOf(cancelled), 'CANCELLED');
    assert.equal(timeoutSignal?.aborted, true);
    assert.equal(calls, 0);
    assert.equal(JSON.stringify(unavailable).includes(text), false);

    const inFlightController = new AbortController();
    let resolveCountStarted!: () => void;
    const countStarted = new Promise<void>((resolve) => { resolveCountStarted = resolve; });
    const pending = evaluateAiBudget({
      request: request(), policy: policy(), signal: inFlightController.signal,
      countTokens: async (_args, signal) => {
        resolveCountStarted();
        return new Promise<TokenMeasurement>((_resolve, reject) => {
          signal.addEventListener('abort', () => reject(new Error('cancelled')), { once: true });
        });
      },
    });
    await countStarted;
    inFlightController.abort();
    assert.equal(reasonOf(await pending), 'CANCELLED');
  });

  it('permits legacy-only policy solely after the named existing guard attests acceptance', async () => {
    let calls = 0;
    const legacyPolicy = policy({
      capability: {
        model: 'fixture-text-model', operation: 'analyze', modalities: ['text'],
        provenance: { state: 'legacy-only', legacyGuardId: 'existing-prompt-guard' },
      },
      reserves: undefined,
    });
    const noGuard = await evaluateAiBudget({
      request: request(), policy: legacyPolicy, countTokens: async () => { calls += 1; return providerCount(1); },
    });
    const wrongGuard = await evaluateAiBudget({
      request: request({ legacyGuard: { id: 'different-guard', accepted: true } }),
      policy: legacyPolicy, countTokens: async () => { calls += 1; return providerCount(1); },
    });
    const guarded = await evaluateAiBudget({
      request: request({ legacyGuard: { id: 'existing-prompt-guard', accepted: true } }),
      policy: legacyPolicy, countTokens: async () => { calls += 1; return providerCount(1); },
    });

    assert.equal(reasonOf(noGuard), 'LEGACY_GUARD_REQUIRED');
    assert.equal(reasonOf(wrongGuard), 'LEGACY_GUARD_REQUIRED');
    assert.equal(guarded.kind, 'legacy-allowed');
    assert.equal(calls, 0);
  });

  it('enforces every aggregate request, token, chunk, retry, time, and concurrency limit', () => {
    const base: AggregateUsage = {
      requests: 2, inputTokens: 12, chunks: 1, retries: 1, elapsedMs: 500, concurrency: 2,
    };
    assert.equal(evaluateAggregateBudget(policy(), base).kind, 'allowed');

    const cases: Array<[keyof AggregateUsage, number, string]> = [
      ['requests', 4, 'REQUEST_LIMIT'],
      ['inputTokens', 41, 'INPUT_TOKEN_LIMIT'],
      ['chunks', 3, 'CHUNK_LIMIT'],
      ['retries', 2, 'RETRY_LIMIT'],
      ['elapsedMs', 1001, 'TIME_LIMIT'],
      ['concurrency', 3, 'CONCURRENCY_LIMIT'],
    ];
    for (const [key, value, reason] of cases) {
      const result = evaluateAggregateBudget(policy(), { ...base, [key]: value });
      assert.equal(result.kind, 'rejected', key);
      assert.equal(result.kind === 'rejected' ? result.reason : undefined, reason, key);
    }
    const missingConcurrency = { ...base } as Partial<AggregateUsage>;
    delete missingConcurrency.concurrency;
    assert.deepEqual(
      evaluateAggregateBudget(policy(), missingConcurrency as AggregateUsage),
      { kind: 'rejected', reason: 'INVALID_USAGE' }
    );
  });
});
