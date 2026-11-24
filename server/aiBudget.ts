import { GEMINI_MODELS } from './models.ts';

export type AiOperation =
  | 'analyze'
  | 'clarify'
  | 'polish'
  | 'story'
  | 'image'
  | 'batch-edit'
  | 'narrative-import'
  | 'diagnostics'
  | 'sync'
  | 'writing'
  | 'opportunities'
  | 'import-enhance';

export type CapabilityProvenance =
  | { state: 'verified' | 'documented-conservative-bound'; evidenceRef: string }
  | { state: 'unverified' | 'unsupported' }
  | { state: 'legacy-only'; legacyGuardId: string };

export interface TokenReserve {
  tokens: number;
  evidenceRef: string;
}

export interface AiBudgetPolicy {
  capability: {
    model: string;
    operation: AiOperation;
    modalities: readonly string[];
    provenance: CapabilityProvenance;
  };
  reserves?: {
    schema?: TokenReserve;
    reasoning?: TokenReserve;
    systemInstruction?: TokenReserve;
  };
  limits: {
    maxContextTokens: number;
    maxOutputTokens: number;
    maxRequestBytes: number;
    countTimeoutMs: number;
    maxRequests: number;
    maxInputTokens: number;
    maxAggregateInputTokens: number;
    maxChunks: number;
    maxRetries: number;
    maxElapsedMs: number;
    maxConcurrency: number;
  };
}

export interface AiTransportPayload {
  contents: unknown;
  systemInstruction?: unknown;
  generationConfig?: {
    responseSchema?: unknown;
    maxOutputTokens?: number;
    [key: string]: unknown;
  };
  [key: string]: unknown;
}

export interface AiBudgetRequest {
  model: string;
  operation: AiOperation;
  modalities: readonly string[];
  transportPayload: AiTransportPayload;
  legacyGuard?: { id: string; accepted: boolean };
}

export type TokenMeasurement =
  | {
      kind: 'provider-count';
      inputTokens: number;
      covered: ReadonlyArray<'contents' | 'systemInstruction'>;
    }
  | { kind: 'estimate'; estimatedTokens: number; basis: string }
  | { kind: 'actual-usage'; inputTokens: number; outputTokens: number; source: string };

export type AiBudgetRejectionReason =
  | 'CANCELLED'
  | 'UNKNOWN_MODEL'
  | 'UNKNOWN_OPERATION'
  | 'UNSUPPORTED_MODALITY'
  | 'CAPABILITY_UNVERIFIED'
  | 'CAPABILITY_UNSUPPORTED'
  | 'LEGACY_GUARD_REQUIRED'
  | 'INVALID_REQUEST'
  | 'MISSING_RESERVE'
  | 'BUDGET_EXCEEDED'
  | 'COUNT_UNAVAILABLE'
  | 'COUNT_TIMEOUT';

export type AiBudgetDecision =
  | {
      kind: 'allowed';
      contextTokens: number;
      inputTokens: number;
      requestBytes: number;
      transportPayload: Readonly<AiTransportPayload>;
      serializedPayload: string;
    }
  | { kind: 'legacy-allowed' }
  | { kind: 'rejected'; reason: AiBudgetRejectionReason };

export interface AggregateUsage {
  requests: number;
  inputTokens: number;
  chunks: number;
  retries: number;
  elapsedMs: number;
  concurrency: number;
}

export type AggregateRejectionReason =
  | 'INVALID_USAGE'
  | 'REQUEST_LIMIT'
  | 'INPUT_TOKEN_LIMIT'
  | 'CHUNK_LIMIT'
  | 'RETRY_LIMIT'
  | 'TIME_LIMIT'
  | 'CONCURRENCY_LIMIT';

export type AggregateBudgetDecision =
  | { kind: 'allowed' }
  | { kind: 'rejected'; reason: AggregateRejectionReason };

const utf8Encoder = new TextEncoder();

export function measureJsonBytes(value: unknown): number {
  return utf8Encoder.encode(JSON.stringify(value)).byteLength;
}

function deepFreeze<T>(value: T): T {
  if (value && typeof value === 'object') {
    Object.freeze(value);
    for (const child of Object.values(value as Record<string, unknown>)) {
      deepFreeze(child);
    }
  }
  return value;
}

function isValidReserve(reserve: TokenReserve | undefined): reserve is TokenReserve {
  return Boolean(
    reserve &&
      typeof reserve.tokens === 'number' &&
      Number.isInteger(reserve.tokens) &&
      reserve.tokens >= 0 &&
      typeof reserve.evidenceRef === 'string' &&
      reserve.evidenceRef.trim().length > 0
  );
}

export async function evaluateAiBudget(params: {
  request: AiBudgetRequest;
  policy: AiBudgetPolicy;
  countTokens: (
    args: { model: string; contents: unknown; systemInstruction?: unknown },
    signal: AbortSignal
  ) => Promise<TokenMeasurement>;
  signal?: AbortSignal;
}): Promise<AiBudgetDecision> {
  const { request, policy, countTokens, signal } = params;
  if (signal?.aborted) return { kind: 'rejected', reason: 'CANCELLED' };

  if (request.model !== policy.capability.model) {
    return { kind: 'rejected', reason: 'UNKNOWN_MODEL' };
  }
  if (request.operation !== policy.capability.operation) {
    return { kind: 'rejected', reason: 'UNKNOWN_OPERATION' };
  }
  if (request.modalities.some((m) => !policy.capability.modalities.includes(m))) {
    return { kind: 'rejected', reason: 'UNSUPPORTED_MODALITY' };
  }

  const provenance = policy.capability.provenance;
  if (provenance.state === 'unverified') {
    return { kind: 'rejected', reason: 'CAPABILITY_UNVERIFIED' };
  }
  if (provenance.state === 'unsupported') {
    return { kind: 'rejected', reason: 'CAPABILITY_UNSUPPORTED' };
  }
  if (provenance.state === 'legacy-only') {
    if (
      request.legacyGuard?.accepted === true &&
      request.legacyGuard.id === provenance.legacyGuardId
    ) {
      return { kind: 'legacy-allowed' };
    }
    return { kind: 'rejected', reason: 'LEGACY_GUARD_REQUIRED' };
  }

  // Synchronously snapshot ONLY transportPayload so caller mutations cannot skew counting or sending
  let serializedPayload: string;
  let frozenPayload: AiTransportPayload;
  try {
    serializedPayload = JSON.stringify(request.transportPayload);
    if (!serializedPayload) return { kind: 'rejected', reason: 'INVALID_REQUEST' };
    frozenPayload = deepFreeze(JSON.parse(serializedPayload) as AiTransportPayload);
  } catch {
    return { kind: 'rejected', reason: 'INVALID_REQUEST' };
  }

  const maxOutputTokens = frozenPayload.generationConfig?.maxOutputTokens;
  if (
    typeof maxOutputTokens !== 'number' ||
    !Number.isInteger(maxOutputTokens) ||
    maxOutputTokens <= 0
  ) {
    return { kind: 'rejected', reason: 'INVALID_REQUEST' };
  }
  if (maxOutputTokens > policy.limits.maxOutputTokens) {
    return { kind: 'rejected', reason: 'BUDGET_EXCEEDED' };
  }

  const requestBytes = utf8Encoder.encode(serializedPayload).byteLength;
  if (requestBytes > policy.limits.maxRequestBytes) {
    return { kind: 'rejected', reason: 'BUDGET_EXCEEDED' };
  }

  const hasSchema = frozenPayload.generationConfig?.responseSchema !== undefined;
  if (hasSchema && !isValidReserve(policy.reserves?.schema)) {
    return { kind: 'rejected', reason: 'MISSING_RESERVE' };
  }
  if (!isValidReserve(policy.reserves?.reasoning)) {
    return { kind: 'rejected', reason: 'MISSING_RESERVE' };
  }

  const countController = new AbortController();
  let timedOut = false;
  let cancelled = false;
  const onExternalAbort = () => {
    cancelled = true;
    countController.abort();
  };
  if (signal) {
    if (signal.aborted) {
      return { kind: 'rejected', reason: 'CANCELLED' };
    }
    signal.addEventListener('abort', onExternalAbort, { once: true });
  }

  const timer = setTimeout(() => {
    timedOut = true;
    countController.abort();
  }, Math.max(1, policy.limits.countTimeoutMs));

  let measurement: TokenMeasurement;
  try {
    measurement = await new Promise<TokenMeasurement>((resolve, reject) => {
      const onAbort = () => reject(new Error(cancelled ? 'cancelled' : 'timeout'));
      countController.signal.addEventListener('abort', onAbort, { once: true });
      Promise.resolve(
        countTokens(
          {
            model: request.model,
            contents: frozenPayload.contents,
            ...(frozenPayload.systemInstruction !== undefined
              ? { systemInstruction: frozenPayload.systemInstruction }
              : {}),
          },
          countController.signal
        )
      ).then(
        (res) => {
          countController.signal.removeEventListener('abort', onAbort);
          resolve(res);
        },
        (err) => {
          countController.signal.removeEventListener('abort', onAbort);
          reject(err);
        }
      );
    });
  } catch {
    if (cancelled || signal?.aborted) return { kind: 'rejected', reason: 'CANCELLED' };
    if (timedOut) return { kind: 'rejected', reason: 'COUNT_TIMEOUT' };
    return { kind: 'rejected', reason: 'COUNT_UNAVAILABLE' };
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener('abort', onExternalAbort);
  }

  if (cancelled || signal?.aborted) return { kind: 'rejected', reason: 'CANCELLED' };
  if (timedOut) return { kind: 'rejected', reason: 'COUNT_TIMEOUT' };

  if (
    !measurement ||
    measurement.kind !== 'provider-count' ||
    typeof measurement.inputTokens !== 'number' ||
    !Number.isInteger(measurement.inputTokens) ||
    measurement.inputTokens < 0 ||
    !Array.isArray(measurement.covered) ||
    !measurement.covered.includes('contents')
  ) {
    return { kind: 'rejected', reason: 'COUNT_UNAVAILABLE' };
  }

  let systemInstructionReserve = 0;
  if (
    frozenPayload.systemInstruction !== undefined &&
    !measurement.covered.includes('systemInstruction')
  ) {
    if (!isValidReserve(policy.reserves?.systemInstruction)) {
      return { kind: 'rejected', reason: 'MISSING_RESERVE' };
    }
    systemInstructionReserve = policy.reserves.systemInstruction.tokens;
  }

  const schemaReserve = hasSchema ? (policy.reserves?.schema?.tokens ?? 0) : 0;
  const reasoningReserve = policy.reserves?.reasoning?.tokens ?? 0;
  const contextTokens =
    measurement.inputTokens +
    maxOutputTokens +
    schemaReserve +
    reasoningReserve +
    systemInstructionReserve;

  if (
    measurement.inputTokens > policy.limits.maxInputTokens ||
    contextTokens > policy.limits.maxContextTokens
  ) {
    return { kind: 'rejected', reason: 'BUDGET_EXCEEDED' };
  }

  return {
    kind: 'allowed',
    contextTokens,
    inputTokens: measurement.inputTokens,
    requestBytes,
    transportPayload: frozenPayload,
    serializedPayload,
  };
}

export function evaluateAggregateBudget(
  policy: AiBudgetPolicy,
  usage: AggregateUsage
): AggregateBudgetDecision {
  const fields: Array<keyof AggregateUsage> = [
    'requests',
    'inputTokens',
    'chunks',
    'retries',
    'elapsedMs',
    'concurrency',
  ];
  for (const field of fields) {
    const val = usage?.[field];
    if (typeof val !== 'number' || !Number.isFinite(val) || val < 0) {
      return { kind: 'rejected', reason: 'INVALID_USAGE' };
    }
  }
  if (usage.requests > policy.limits.maxRequests) {
    return { kind: 'rejected', reason: 'REQUEST_LIMIT' };
  }
  if (usage.inputTokens > policy.limits.maxAggregateInputTokens) {
    return { kind: 'rejected', reason: 'INPUT_TOKEN_LIMIT' };
  }
  if (usage.chunks > policy.limits.maxChunks) {
    return { kind: 'rejected', reason: 'CHUNK_LIMIT' };
  }
  if (usage.retries > policy.limits.maxRetries) {
    return { kind: 'rejected', reason: 'RETRY_LIMIT' };
  }
  if (usage.elapsedMs > policy.limits.maxElapsedMs) {
    return { kind: 'rejected', reason: 'TIME_LIMIT' };
  }
  if (usage.concurrency > policy.limits.maxConcurrency) {
    return { kind: 'rejected', reason: 'CONCURRENCY_LIMIT' };
  }
  return { kind: 'allowed' };
}

// ---------------------------------------------------------------------------
// Application-level per-operation policies, rate/concurrency slots & usage reports
// ---------------------------------------------------------------------------

export interface AiOperationPolicy {
  operation: AiOperation;
  model: string;
  maxInputChars: number;
  maxInputTokens: number;
  maxOutputTokens: number;
  timeoutMs: number;
  maxConcurrent: number;
  maxCallsPerMinute: number;
  maxAggregateCalls: number;
  maxAggregateTokens: number;
  maxAggregateElapsedMs: number;
  description: string;
}

export const AI_OPERATION_POLICIES: Readonly<Record<AiOperation, AiOperationPolicy>> = Object.freeze({
  analyze: {
    operation: 'analyze',
    model: GEMINI_MODELS.text,
    maxInputChars: 8_000,
    maxInputTokens: 4_000,
    maxOutputTokens: 4_096,
    timeoutMs: 45_000,
    maxConcurrent: 2,
    maxCallsPerMinute: 20,
    maxAggregateCalls: 4,
    maxAggregateTokens: 16_000,
    maxAggregateElapsedMs: 120_000,
    description: 'Belief graph extraction from idea prompt',
  },
  clarify: {
    operation: 'clarify',
    model: GEMINI_MODELS.text,
    maxInputChars: 8_000,
    maxInputTokens: 4_000,
    maxOutputTokens: 2_048,
    timeoutMs: 45_000,
    maxConcurrent: 2,
    maxCallsPerMinute: 20,
    maxAggregateCalls: 4,
    maxAggregateTokens: 16_000,
    maxAggregateElapsedMs: 120_000,
    description: 'Clarifying questions generation',
  },
  polish: {
    operation: 'polish',
    model: GEMINI_MODELS.text,
    maxInputChars: 8_000,
    maxInputTokens: 4_000,
    maxOutputTokens: 4_096,
    timeoutMs: 45_000,
    maxConcurrent: 2,
    maxCallsPerMinute: 20,
    maxAggregateCalls: 4,
    maxAggregateTokens: 16_000,
    maxAggregateElapsedMs: 120_000,
    description: 'Refined prompt polish',
  },
  story: {
    operation: 'story',
    model: GEMINI_MODELS.text,
    maxInputChars: 8_000,
    maxInputTokens: 4_000,
    maxOutputTokens: 8_192,
    timeoutMs: 60_000,
    maxConcurrent: 2,
    maxCallsPerMinute: 12,
    maxAggregateCalls: 2,
    maxAggregateTokens: 20_000,
    maxAggregateElapsedMs: 120_000,
    description: 'Story draft generation',
  },
  image: {
    operation: 'image',
    model: GEMINI_MODELS.image,
    maxInputChars: 8_000,
    maxInputTokens: 2_500,
    maxOutputTokens: 1_024,
    timeoutMs: 60_000,
    maxConcurrent: 1,
    maxCallsPerMinute: 10,
    maxAggregateCalls: 4,
    maxAggregateTokens: 10_000,
    maxAggregateElapsedMs: 120_000,
    description: 'Image batch generation',
  },
  'batch-edit': {
    operation: 'batch-edit',
    model: GEMINI_MODELS.text,
    maxInputChars: 16_000,
    maxInputTokens: 6_000,
    maxOutputTokens: 4_096,
    timeoutMs: 45_000,
    maxConcurrent: 2,
    maxCallsPerMinute: 20,
    maxAggregateCalls: 4,
    maxAggregateTokens: 24_000,
    maxAggregateElapsedMs: 120_000,
    description: 'Natural-language batch edit interpretation',
  },
  'narrative-import': {
    operation: 'narrative-import',
    model: GEMINI_MODELS.text,
    maxInputChars: 32_000,
    maxInputTokens: 12_000,
    maxOutputTokens: 4_096,
    timeoutMs: 60_000,
    maxConcurrent: 2,
    maxCallsPerMinute: 30,
    maxAggregateCalls: 12,
    maxAggregateTokens: 120_000,
    maxAggregateElapsedMs: 240_000,
    description: 'Faithful narrative extraction chunk',
  },
  diagnostics: {
    operation: 'diagnostics',
    model: GEMINI_MODELS.text,
    maxInputChars: 40_000,
    maxInputTokens: 14_000,
    maxOutputTokens: 4_096,
    timeoutMs: 55_000,
    maxConcurrent: 2,
    maxCallsPerMinute: 15,
    maxAggregateCalls: 6,
    maxAggregateTokens: 60_000,
    maxAggregateElapsedMs: 180_000,
    description: 'Semantic consistency analysis and fix suggestions',
  },
  sync: {
    operation: 'sync',
    model: GEMINI_MODELS.text,
    maxInputChars: 40_000,
    maxInputTokens: 14_000,
    maxOutputTokens: 4_096,
    timeoutMs: 55_000,
    maxConcurrent: 2,
    maxCallsPerMinute: 15,
    maxAggregateCalls: 6,
    maxAggregateTokens: 60_000,
    maxAggregateElapsedMs: 180_000,
    description: 'Manuscript and canonical model synchronization proposals',
  },
  writing: {
    operation: 'writing',
    model: GEMINI_MODELS.text,
    maxInputChars: 24_000,
    maxInputTokens: 9_000,
    maxOutputTokens: 3_072,
    timeoutMs: 50_000,
    maxConcurrent: 2,
    maxCallsPerMinute: 20,
    maxAggregateCalls: 8,
    maxAggregateTokens: 48_000,
    maxAggregateElapsedMs: 180_000,
    description: 'Contextual manuscript writing assistant',
  },
  opportunities: {
    operation: 'opportunities',
    model: GEMINI_MODELS.text,
    maxInputChars: 36_000,
    maxInputTokens: 12_000,
    maxOutputTokens: 4_096,
    timeoutMs: 55_000,
    maxConcurrent: 2,
    maxCallsPerMinute: 15,
    maxAggregateCalls: 4,
    maxAggregateTokens: 48_000,
    maxAggregateElapsedMs: 180_000,
    description: 'Creative opportunities exploration',
  },
  'import-enhance': {
    operation: 'import-enhance',
    model: GEMINI_MODELS.text,
    maxInputChars: 28_000,
    maxInputTokens: 10_000,
    maxOutputTokens: 4_096,
    timeoutMs: 55_000,
    maxConcurrent: 2,
    maxCallsPerMinute: 12,
    maxAggregateCalls: 4,
    maxAggregateTokens: 40_000,
    maxAggregateElapsedMs: 180_000,
    description: 'Post-faithful import enhancement proposals',
  },
});

export interface AiUsageReport {
  inputChars: number;
  estimatedInputTokens: number;
  providerInputTokens?: number;
  actualPromptTokens?: number;
  actualOutputTokens?: number;
  actualTotalTokens?: number;
  maxInputChars: number;
  maxInputTokens: number;
  maxOutputTokens: number;
  model: string;
  operation: AiOperation;
}

export function estimateTokensFromText(text: string): number {
  if (!text) return 0;
  return Math.max(1, Math.ceil(text.length / 4));
}

export function evaluateOperationBudget(input: {
  operation: AiOperation;
  model: string;
  inputChars: number;
  countedInputTokens?: number;
  estimatedInputTokens?: number;
  maxInputTokens: number;
  maxOutputTokens: number;
}): {
  ok: boolean;
  inputTokens: number;
  tokenSource: 'provider-count' | 'estimate';
  reason?: string;
} {
  const tokenSource = typeof input.countedInputTokens === 'number' ? 'provider-count' : 'estimate';
  const inputTokens =
    input.countedInputTokens ?? input.estimatedInputTokens ?? Math.ceil(input.inputChars / 4);
  if (!Number.isFinite(inputTokens) || inputTokens < 0 || !Number.isFinite(input.maxInputTokens) || input.maxInputTokens <= 0) {
    return { ok: false, inputTokens: 0, tokenSource, reason: 'Invalid AI budget parameters.' };
  }
  if (inputTokens > input.maxInputTokens) {
    return {
      ok: false,
      inputTokens,
      tokenSource,
      reason: `Input (${inputTokens} ${tokenSource === 'provider-count' ? 'counted' : 'estimated'} tokens) exceeds the ${input.maxInputTokens}-token budget for ${input.operation}.`,
    };
  }
  return { ok: true, inputTokens, tokenSource };
}

const activeInFlightByOp = new Map<AiOperation, number>();
const recentTimestampsByOp = new Map<AiOperation, number[]>();

export function acquireAiSlot(
  operation: AiOperation,
  nowMs: number = Date.now()
):
  | { ok: true; policy: AiOperationPolicy; release: () => void }
  | { ok: false; policy: AiOperationPolicy; retryAfterMs: number; reason: string } {
  const policy = AI_OPERATION_POLICIES[operation];
  const currentInFlight = activeInFlightByOp.get(operation) ?? 0;
  if (currentInFlight >= policy.maxConcurrent) {
    return {
      ok: false,
      policy,
      retryAfterMs: 1_500,
      reason: `Too many concurrent ${operation} requests (limit: ${policy.maxConcurrent}). Wait for the current request to finish.`,
    };
  }
  const windowStart = nowMs - 60_000;
  const recent = (recentTimestampsByOp.get(operation) ?? []).filter((t) => t > windowStart);
  if (recent.length >= policy.maxCallsPerMinute) {
    const oldest = recent[0] ?? nowMs;
    return {
      ok: false,
      policy,
      retryAfterMs: Math.max(1_000, oldest + 60_000 - nowMs),
      reason: `Rate budget reached for ${operation} (${policy.maxCallsPerMinute} calls/minute). Please wait briefly before retrying.`,
    };
  }
  recent.push(nowMs);
  recentTimestampsByOp.set(operation, recent);
  activeInFlightByOp.set(operation, currentInFlight + 1);
  let released = false;
  return {
    ok: true,
    policy,
    release: () => {
      if (released) return;
      released = true;
      const count = activeInFlightByOp.get(operation) ?? 1;
      activeInFlightByOp.set(operation, Math.max(0, count - 1));
    },
  };
}

export function resetAiSlotsForTests(): void {
  activeInFlightByOp.clear();
  recentTimestampsByOp.clear();
}

export function getAiCapabilitiesSnapshot(configured: boolean) {
  return {
    configured,
    textModel: GEMINI_MODELS.text,
    imageModel: GEMINI_MODELS.image,
    providerLimitsVerifiedLive: false,
    note: configured
      ? 'Conservative application budgets are enforced server-side. Exact provider token counts are requested via countTokens before model execution.'
      : 'GEMINI_API_KEY is not configured on the server. Deterministic local tools remain available; AI features require a server-side key.',
    operations: Object.fromEntries(
      Object.values(AI_OPERATION_POLICIES).map((p) => [
        p.operation,
        {
          model: p.model,
          maxInputChars: p.maxInputChars,
          maxInputTokens: p.maxInputTokens,
          maxOutputTokens: p.maxOutputTokens,
          timeoutMs: p.timeoutMs,
          maxConcurrent: p.maxConcurrent,
          maxCallsPerMinute: p.maxCallsPerMinute,
          description: p.description,
        },
      ])
    ),
  };
}
