export type AiOperation =
  | 'analyze'
  | 'clarify'
  | 'polish'
  | 'story'
  | 'image'
  | 'batch-edit'
  | 'narrative-import';

export type AiModality = 'text' | 'image' | 'audio' | 'video' | 'document';
export type CapabilityProvenanceState =
  | 'verified'
  | 'documented-conservative-bound'
  | 'legacy-only'
  | 'unverified'
  | 'unsupported';

export type CapabilityProvenance =
  | { state: 'verified' | 'documented-conservative-bound'; evidenceRef: string }
  | { state: 'legacy-only'; legacyGuardId: string }
  | { state: 'unverified' | 'unsupported'; evidenceRef?: string };

export interface AiCapability {
  model: string;
  operation: AiOperation;
  modalities: readonly AiModality[];
  provenance: CapabilityProvenance;
}

export interface AiBudgetReserves {
  schema?: { tokens: number; evidenceRef: string };
  reasoning?: { tokens: number; evidenceRef: string };
  contents?: { tokens: number; evidenceRef: string };
  systemInstruction?: { tokens: number; evidenceRef: string };
}

export interface AiBudgetLimits {
  maxContextTokens: number;
  maxInputTokens: number;
  maxAggregateInputTokens: number;
  maxOutputTokens: number;
  maxRequestBytes: number;
  countTimeoutMs: number;
  maxRequests: number;
  maxChunks: number;
  maxRetries: number;
  maxElapsedMs: number;
  maxConcurrency: number;
}

export interface AiBudgetPolicy {
  capability: AiCapability;
  reserves?: AiBudgetReserves;
  limits: AiBudgetLimits;
}

export interface AiBudgetRequest {
  model: string;
  operation: AiOperation;
  modalities: readonly AiModality[];
  contents: unknown;
  systemInstruction?: unknown;
  schema?: unknown;
  transportPayload: unknown;
  legacyGuard?: { id: string; accepted: true };
}

export type TokenMeasurement =
  | {
      kind: 'provider-count';
      inputTokens: number;
      covered: readonly ('contents' | 'systemInstruction')[];
    }
  | { kind: 'estimate'; estimatedTokens: number; basis: string }
  | { kind: 'actual-usage'; inputTokens?: number; outputTokens?: number; source: string };

export type CountTokens = (
  input: { model: string; contents: unknown; systemInstruction?: unknown },
  signal: AbortSignal
) => Promise<TokenMeasurement>;

export type AiBudgetRejectionReason =
  | 'UNKNOWN_MODEL'
  | 'UNKNOWN_OPERATION'
  | 'UNSUPPORTED_MODALITY'
  | 'CAPABILITY_UNVERIFIED'
  | 'CAPABILITY_UNSUPPORTED'
  | 'LEGACY_GUARD_REQUIRED'
  | 'MISSING_RESERVE'
  | 'INVALID_POLICY'
  | 'INVALID_REQUEST'
  | 'COUNT_UNAVAILABLE'
  | 'COUNT_TIMEOUT'
  | 'CANCELLED'
  | 'BUDGET_EXCEEDED';

export type AiBudgetDecision =
  | { kind: 'allowed'; requestBytes: number; inputTokens: number; contextTokens: number }
  | { kind: 'legacy-allowed'; requestBytes: number }
  | { kind: 'rejected'; reason: AiBudgetRejectionReason };

export interface AggregateUsage {
  requests: number;
  inputTokens: number;
  chunks: number;
  retries: number;
  elapsedMs: number;
  concurrency: number;
}

export type AggregateBudgetDecision =
  | { kind: 'allowed' }
  | {
      kind: 'rejected';
      reason:
        | 'INVALID_POLICY'
        | 'INVALID_USAGE'
        | 'REQUEST_LIMIT'
        | 'INPUT_TOKEN_LIMIT'
        | 'CHUNK_LIMIT'
        | 'RETRY_LIMIT'
        | 'TIME_LIMIT'
        | 'CONCURRENCY_LIMIT';
    };

function rejected(reason: AiBudgetRejectionReason): AiBudgetDecision {
  return { kind: 'rejected', reason };
}

function isFiniteNonNegativeInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
}

function hasFiniteBounds(policy: AiBudgetPolicy): boolean {
  if (!policy?.limits || !policy?.capability) return false;
  const bounds = [
    policy.limits.maxContextTokens,
    policy.limits.maxInputTokens,
    policy.limits.maxAggregateInputTokens,
    policy.limits.maxOutputTokens,
    policy.limits.maxRequestBytes,
    policy.limits.countTimeoutMs,
    policy.limits.maxRequests,
    policy.limits.maxChunks,
    policy.limits.maxRetries,
    policy.limits.maxElapsedMs,
    policy.limits.maxConcurrency,
  ];
  return bounds.every(isFiniteNonNegativeInteger) && policy.limits.countTimeoutMs > 0;
}

function sameValues(left: readonly string[], right: readonly string[]): boolean {
  const sortedLeft = [...left].sort();
  const sortedRight = [...right].sort();
  return sortedLeft.length === sortedRight.length && sortedLeft.every((value, index) => value === sortedRight[index]);
}

const supportedModalities = new Set<AiModality>(['text', 'image', 'audio', 'video', 'document']);
const supportedOperations = new Set<AiOperation>([
  'analyze', 'clarify', 'polish', 'story', 'image', 'batch-edit', 'narrative-import',
]);

function isEvidenceBackedReserve(reserve: AiBudgetReserves[keyof AiBudgetReserves]): boolean {
  return reserve !== undefined && isFiniteNonNegativeInteger(reserve.tokens) &&
    typeof reserve.evidenceRef === 'string' && reserve.evidenceRef.trim().length > 0;
}

export function measureJsonBytes(value: unknown): number {
  const serialized = JSON.stringify(value);
  if (serialized === undefined) throw new TypeError('Value is not JSON serializable.');
  return Buffer.byteLength(serialized, 'utf8');
}

function classifyCapability(
  request: AiBudgetRequest,
  policy: AiBudgetPolicy
): AiBudgetRejectionReason | 'LEGACY_ALLOWED' | undefined {
  const capability = policy.capability;
  if (!capability || !Array.isArray(capability.modalities) || !capability.modalities.length ||
      !Array.isArray(request.modalities) || !request.modalities.length) return 'INVALID_POLICY';
  if (!capability.provenance || typeof capability.provenance.state !== 'string') return 'INVALID_POLICY';
  if (typeof capability.model !== 'string' || !capability.model.trim() ||
      !supportedOperations.has(capability.operation) ||
      capability.modalities.some((modality) => !supportedModalities.has(modality))) return 'INVALID_POLICY';
  if (request.modalities.some((modality) => !supportedModalities.has(modality))) return 'UNSUPPORTED_MODALITY';
  if (!capability.model || request.model !== capability.model) return 'UNKNOWN_MODEL';
  if (request.operation !== capability.operation) return 'UNKNOWN_OPERATION';
  if (!sameValues(request.modalities, capability.modalities)) return 'UNSUPPORTED_MODALITY';

  switch (capability.provenance.state) {
    case 'verified':
    case 'documented-conservative-bound':
      return typeof capability.provenance.evidenceRef === 'string' && capability.provenance.evidenceRef.trim()
        ? undefined
        : 'CAPABILITY_UNVERIFIED';
    case 'legacy-only':
      return typeof capability.provenance.legacyGuardId === 'string' &&
        request.legacyGuard?.accepted === true &&
        request.legacyGuard.id === capability.provenance.legacyGuardId
        ? 'LEGACY_ALLOWED'
        : 'LEGACY_GUARD_REQUIRED';
    case 'unverified':
      return 'CAPABILITY_UNVERIFIED';
    case 'unsupported':
      return 'CAPABILITY_UNSUPPORTED';
    default:
      return 'CAPABILITY_UNVERIFIED';
  }
}

function validReserves(
  request: AiBudgetRequest,
  reserves: AiBudgetReserves,
  covered: ReadonlySet<'contents' | 'systemInstruction'>
): boolean {
  if (!isEvidenceBackedReserve(reserves.reasoning)) return false;
  if (request.schema !== undefined && !isEvidenceBackedReserve(reserves.schema)) return false;
  if (request.contents !== undefined && !covered.has('contents') &&
      !isEvidenceBackedReserve(reserves.contents)) return false;
  if (request.systemInstruction !== undefined && !covered.has('systemInstruction') &&
      !isEvidenceBackedReserve(reserves.systemInstruction)) return false;
  return true;
}

function countWithDeadline(
  countTokens: CountTokens,
  input: { model: string; contents: unknown; systemInstruction?: unknown },
  externalSignal: AbortSignal | undefined,
  timeoutMs: number
): Promise<TokenMeasurement> {
  return new Promise((resolve, reject) => {
    if (externalSignal?.aborted) {
      reject(new CountFailure('CANCELLED'));
      return;
    }

    const controller = new AbortController();
    let settled = false;
    const finish = (fn: () => void) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      externalSignal?.removeEventListener('abort', onAbort);
      fn();
    };
    const timer = setTimeout(() => {
      controller.abort();
      finish(() => reject(new CountFailure('COUNT_TIMEOUT')));
    }, timeoutMs);
    const onAbort = () => {
      controller.abort(externalSignal?.reason);
      finish(() => reject(new CountFailure('CANCELLED')));
    };
    externalSignal?.addEventListener('abort', onAbort, { once: true });

    Promise.resolve()
      .then(() => settled ? undefined : countTokens(input, controller.signal))
      .then((measurement) => {
        if (measurement !== undefined) finish(() => resolve(measurement));
      })
      .catch(() => finish(() => reject(new Error('COUNT_UNAVAILABLE'))));
  });
}

class CountFailure extends Error {
  constructor(readonly reason: 'COUNT_TIMEOUT' | 'CANCELLED') {
    super(reason);
  }
}

export async function evaluateAiBudget(args: {
  request: AiBudgetRequest;
  policy: AiBudgetPolicy;
  countTokens: CountTokens;
  signal?: AbortSignal;
}): Promise<AiBudgetDecision> {
  const { request, policy, countTokens, signal } = args;
  if (!request || typeof request !== 'object' || typeof countTokens !== 'function') {
    return rejected('INVALID_REQUEST');
  }
  if (!hasFiniteBounds(policy)) return rejected('INVALID_POLICY');

  const capabilityResult = classifyCapability(request, policy);
  if (capabilityResult && capabilityResult !== 'LEGACY_ALLOWED') return rejected(capabilityResult);

  let requestBytes: number;
  try {
    requestBytes = measureJsonBytes(request.transportPayload);
  } catch {
    return rejected('INVALID_REQUEST');
  }

  if (capabilityResult === 'LEGACY_ALLOWED') {
    return { kind: 'legacy-allowed', requestBytes };
  }

  const { reserves } = policy;
  if (!reserves || !isEvidenceBackedReserve(reserves.reasoning) ||
      (request.schema !== undefined && !isEvidenceBackedReserve(reserves.schema))) {
    return rejected('MISSING_RESERVE');
  }
  if (requestBytes > policy.limits.maxRequestBytes) return rejected('BUDGET_EXCEEDED');
  if (signal?.aborted) return rejected('CANCELLED');

  let measurement: TokenMeasurement;
  try {
    measurement = await countWithDeadline(
      countTokens,
      { model: request.model, contents: request.contents, systemInstruction: request.systemInstruction },
      signal,
      policy.limits.countTimeoutMs
    );
  } catch (error) {
    if (error instanceof CountFailure) return rejected(error.reason);
    return rejected('COUNT_UNAVAILABLE');
  }

  if (signal?.aborted) return rejected('CANCELLED');
  if (!measurement || typeof measurement !== 'object' || measurement.kind !== 'provider-count' ||
      !isFiniteNonNegativeInteger(measurement.inputTokens) || !Array.isArray(measurement.covered)) {
    return rejected('COUNT_UNAVAILABLE');
  }

  const covered = new Set(measurement.covered);
  if ([...covered].some((part) => part !== 'contents' && part !== 'systemInstruction')) {
    return rejected('COUNT_UNAVAILABLE');
  }
  if (!validReserves(request, reserves, covered)) return rejected('MISSING_RESERVE');
  const inputTokens = measurement.inputTokens +
    (covered.has('contents') ? 0 : reserves.contents!.tokens) +
    (request.systemInstruction === undefined || covered.has('systemInstruction') ? 0 : reserves.systemInstruction!.tokens);
  const schemaTokens = request.schema === undefined ? 0 : reserves.schema!.tokens;
  const contextTokens = inputTokens + schemaTokens + reserves.reasoning!.tokens + policy.limits.maxOutputTokens;

  if (inputTokens > policy.limits.maxInputTokens || contextTokens > policy.limits.maxContextTokens) {
    return rejected('BUDGET_EXCEEDED');
  }
  return { kind: 'allowed', requestBytes, inputTokens, contextTokens };
}

export function evaluateAggregateBudget(
  policy: AiBudgetPolicy,
  usage: AggregateUsage
): AggregateBudgetDecision {
  if (!hasFiniteBounds(policy)) return { kind: 'rejected', reason: 'INVALID_POLICY' };
  if (!usage || typeof usage !== 'object' || ![
    usage.requests, usage.inputTokens, usage.chunks, usage.retries, usage.elapsedMs, usage.concurrency,
  ].every(isFiniteNonNegativeInteger)) {
    return { kind: 'rejected', reason: 'INVALID_USAGE' };
  }
  if (usage.requests > policy.limits.maxRequests) return { kind: 'rejected', reason: 'REQUEST_LIMIT' };
  if (usage.inputTokens > policy.limits.maxAggregateInputTokens) {
    return { kind: 'rejected', reason: 'INPUT_TOKEN_LIMIT' };
  }
  if (usage.chunks > policy.limits.maxChunks) return { kind: 'rejected', reason: 'CHUNK_LIMIT' };
  if (usage.retries > policy.limits.maxRetries) return { kind: 'rejected', reason: 'RETRY_LIMIT' };
  if (usage.elapsedMs > policy.limits.maxElapsedMs) return { kind: 'rejected', reason: 'TIME_LIMIT' };
  if (usage.concurrency > policy.limits.maxConcurrency) return { kind: 'rejected', reason: 'CONCURRENCY_LIMIT' };
  return { kind: 'allowed' };
}
