import { createHash, randomUUID } from 'node:crypto';
import { AppApiError } from '../errors.ts';

export const CHATGPT_STORY_SRB_V1 = Object.freeze({
  version: 'pcc-srb-story-v1',
  operation: 'story' as const,
  maxSourceChars: 8_000,
  maxEstimatedInputTokens: 4_000,
  maxRequestBodyBytes: 32 * 1024,
  maxAcceptedOutputBytes: 16 * 1024,
  maxStreamBytes: 256 * 1024,
  maxStreamEvents: 4_096,
  timeoutMs: 60_000,
  maxConcurrent: 1,
  maxAttemptsPerRun: 1,
  maxAttemptsPerMinute: 2,
  maxAutomaticRetries: 0,
  maxAutomaticContinuations: 0,
  reasoning: 'default' as const,
  automaticFallback: false,
});

export const CHATGPT_STORY_SRB_ENABLED_BY_DEFAULT = false;
const MAX_STORED_STORY_PLANS = 64;
const STORY_PLAN_LIFETIME_MS = 60_000;
const MAX_REQUEST_BINDINGS = 4_096;
const utf8Encoder = new TextEncoder();

export interface ChatGptStoryPlanInput {
  requestId: string;
  modelId: string;
  grantGeneration: number;
  sourceDigest: string;
  sourceText: string;
  instructions?: string;
}

export interface ChatGptStoryPlan {
  id: string;
  requestId: string;
  operation: 'story';
  modelId: string;
  grantGeneration: number;
  sourceDigest: string;
  policyVersion: string;
  sourceText: string;
  instructions?: string;
  requestBody: string;
  requestBodyBytes: number;
  estimatedInputTokens: number;
  createdAt: number;
  expiresAt: number;
}

export interface ChatGptStoryTransportResult {
  text: string;
  terminalEvent: 'response.completed' | 'response.failed' | 'response.incomplete' | 'missing';
  refusal: boolean;
  streamBytes: number;
  eventCount: number;
  usage?: { inputTokens?: number; outputTokens?: number; source?: 'provider-observed' | 'estimate' | 'unknown' };
}

export interface ChatGptStorySrbAuthority {
  prepare(input: ChatGptStoryPlanInput): ChatGptStoryPlan;
  run(input: {
    plan: ChatGptStoryPlan;
    currentGrantGeneration: () => number;
    signal?: AbortSignal;
    transport: (
      request: { body: string; limits: typeof CHATGPT_STORY_SRB_V1 },
      signal: AbortSignal,
    ) => Promise<ChatGptStoryTransportResult>;
  }): Promise<ChatGptStoryTransportResult>;
  /** Explicit operator recovery only; never called by a retry path. */
  recoverQuotaBlock(): void;
}

interface StoredPlan {
  value: ChatGptStoryPlan;
  attempted: boolean;
}

export function estimateSrbInputTokens(text: string): number {
  let tokens = 0;
  for (const character of text) tokens += character.codePointAt(0)! <= 0x7f ? 0.25 : 1;
  return Math.ceil(tokens);
}

function fail(code: string, message: string, statusCode: number): AppApiError {
  return new AppApiError(code as ConstructorParameters<typeof AppApiError>[0], message, statusCode, false);
}

function validateStoryPlanInput(input: ChatGptStoryPlanInput): void {
  if (!/^[A-Za-z0-9._:-]{16,128}$/.test(input.requestId)) {
    throw fail('VALIDATION_ERROR', 'The ChatGPT story request identity is invalid.', 400);
  }
  const hasInvalidIdentity = !input.modelId.trim() || !input.sourceDigest.trim() ||
    !Number.isSafeInteger(input.grantGeneration) || input.grantGeneration < 0;
  if (hasInvalidIdentity) {
    throw fail('VALIDATION_ERROR', 'The ChatGPT story plan identity is invalid.', 400);
  }
  if (input.sourceText.length > CHATGPT_STORY_SRB_V1.maxSourceChars) {
    throw fail('VALIDATION_ERROR', 'This ChatGPT story plan exceeds the 8,000-character source limit.', 413);
  }
}

function buildPinnedStoryRequest(input: ChatGptStoryPlanInput): {
  requestBody: string;
  requestBodyBytes: number;
  estimatedInputTokens: number;
} {
  const requestBody = JSON.stringify({
    model: input.modelId,
    input: [{ role: 'user', content: input.sourceText }],
    ...(input.instructions ? { instructions: input.instructions } : {}),
    store: false,
    stream: true,
  });
  const requestBodyBytes = utf8Encoder.encode(requestBody).byteLength;
  const estimatedInputTokens = estimateSrbInputTokens(`${input.instructions ?? ''}\n${input.sourceText}`);
  if (requestBodyBytes > CHATGPT_STORY_SRB_V1.maxRequestBodyBytes) {
    throw fail('VALIDATION_ERROR', 'The complete serialized ChatGPT story request exceeds 32 KiB.', 413);
  }
  if (estimatedInputTokens > CHATGPT_STORY_SRB_V1.maxEstimatedInputTokens) {
    throw fail('VALIDATION_ERROR', 'The conservative ChatGPT story input estimate exceeds 4,000 tokens.', 413);
  }
  return { requestBody, requestBodyBytes, estimatedInputTokens };
}

function validateStoryResult(result: ChatGptStoryTransportResult): ChatGptStoryTransportResult {
  const visibleOutputBytes = utf8Encoder.encode(result.text).byteLength;
  if (result.terminalEvent !== 'response.completed' || result.refusal || !result.text.trim()) {
    throw fail('INVALID_RESPONSE', 'The ChatGPT story stream did not complete with a non-refusal text result.', 502);
  }
  const invalidStreamStats = !Number.isSafeInteger(result.streamBytes) || result.streamBytes < 0 ||
    result.streamBytes > CHATGPT_STORY_SRB_V1.maxStreamBytes ||
    !Number.isSafeInteger(result.eventCount) || result.eventCount < 1 ||
    result.eventCount > CHATGPT_STORY_SRB_V1.maxStreamEvents;
  if (invalidStreamStats || visibleOutputBytes > CHATGPT_STORY_SRB_V1.maxAcceptedOutputBytes) {
    throw fail('VALIDATION_ERROR', 'The ChatGPT story response exceeded an SRB v1 stream or output limit.', 413);
  }
  return result;
}

export function createChatGptStorySrbAuthority(options: {
  enabled?: boolean;
  now?: () => number;
  makeId?: () => string;
} = {}) {
  const enabled = options.enabled ?? CHATGPT_STORY_SRB_ENABLED_BY_DEFAULT;
  const now = options.now ?? Date.now;
  const makeId = options.makeId ?? randomUUID;
  const plans = new Map<string, StoredPlan>();
  const requestBindings = new Map<string, string>();
  const attempts: Array<{ at: number; estimatedInputTokens: number }> = [];
  let activePlanId: string | undefined;
  let quotaBlocked = false;

  const prunePlans = (timestamp: number) => {
    for (const [id, stored] of plans) {
      if (stored.value.expiresAt <= timestamp && id !== activePlanId) plans.delete(id);
    }
  };

  const assertEnabled = () => {
    if (!enabled) throw fail('MODEL_UNSUPPORTED', 'ChatGPT story generation is not activated for production admission.', 422);
  };

  const checkRequestBindingAndCapacity = (input: ChatGptStoryPlanInput, requestBody: string): string => {
    const requestBinding = JSON.stringify({
      operation: 'story', requestId: input.requestId, sourceDigest: input.sourceDigest,
      approvedPayloadDigest: createHash('sha256').update(requestBody).digest('hex'),
      modelId: input.modelId, grantGeneration: input.grantGeneration,
      policyVersion: CHATGPT_STORY_SRB_V1.version,
    });
    const previousBinding = requestBindings.get(input.requestId);
    if (previousBinding) {
      throw fail('RATE_LIMITED', previousBinding === requestBinding
        ? 'This explicit story request was already admitted and cannot be replayed.'
        : 'This story request identity is already bound to a different approved payload or provider selection.', 409);
    }
    if (requestBindings.size >= MAX_REQUEST_BINDINGS) {
      throw fail('RATE_LIMITED', 'The ChatGPT story request identity ledger is full for this server process.', 429);
    }
    if (quotaBlocked) {
      throw fail('RATE_LIMITED', 'ChatGPT plan quota is blocked after a provider quota response; an explicit recovery decision is required.', 429);
    }
    return requestBinding;
  };

  function prepare(input: ChatGptStoryPlanInput): ChatGptStoryPlan {
    assertEnabled();
    const timestamp = now();
    prunePlans(timestamp);
    if (plans.size >= MAX_STORED_STORY_PLANS) {
      throw fail('RATE_LIMITED', 'The ChatGPT story pilot has no available bounded plan capacity.', 429);
    }
    validateStoryPlanInput(input);
    const { requestBody, requestBodyBytes, estimatedInputTokens } = buildPinnedStoryRequest(input);
    const requestBinding = checkRequestBindingAndCapacity(input, requestBody);
    requestBindings.set(input.requestId, requestBinding);
    const value: ChatGptStoryPlan = Object.freeze({
      id: makeId(), requestId: input.requestId, operation: 'story', modelId: input.modelId,
      grantGeneration: input.grantGeneration, sourceDigest: input.sourceDigest,
      policyVersion: CHATGPT_STORY_SRB_V1.version, sourceText: input.sourceText,
      ...(input.instructions ? { instructions: input.instructions } : {}),
      requestBody, requestBodyBytes, estimatedInputTokens, createdAt: timestamp,
      expiresAt: timestamp + STORY_PLAN_LIFETIME_MS,
    });
    plans.set(value.id, { value, attempted: false });
    return value;
  }

  const validateRunAdmission = (
    plan: ChatGptStoryPlan,
    currentGrantGeneration: () => number,
    signal?: AbortSignal,
  ): { stored: StoredPlan; timestamp: number } => {
    const timestamp = now();
    prunePlans(timestamp);
    const stored = plans.get(plan.id);
    const isValidStored = stored && stored.value === plan &&
      stored.value.policyVersion === CHATGPT_STORY_SRB_V1.version && stored.value.expiresAt > timestamp;
    if (!isValidStored) {
      if (stored && stored.value.expiresAt <= timestamp) plans.delete(plan.id);
      throw fail('VALIDATION_ERROR', 'The ChatGPT story plan is missing, stale, or was not issued by this server.', 409);
    }
    if (currentGrantGeneration() !== stored.value.grantGeneration) {
      plans.delete(stored.value.id);
      throw fail('CANCELLED', 'The ChatGPT account session changed after this story plan was prepared.', 499);
    }
    if (signal?.aborted) throw fail('CANCELLED', 'The ChatGPT story operation was cancelled before admission.', 499);
    while (attempts.length && timestamp - attempts[0].at >= 60_000) attempts.shift();
    if (stored.attempted) throw fail('RATE_LIMITED', 'This approved ChatGPT story plan has already used its one inference attempt.', 429);
    if (activePlanId) throw fail('RATE_LIMITED', 'A ChatGPT story inference is already in progress in this server process.', 429);
    if (attempts.length >= CHATGPT_STORY_SRB_V1.maxAttemptsPerMinute) {
      throw fail('RATE_LIMITED', 'The ChatGPT story pilot reached its two-attempts-per-minute limit.', 429);
    }
    const totalEstimatedTokens = attempts.reduce(
      (total, attempt) => total + attempt.estimatedInputTokens,
      stored.value.estimatedInputTokens,
    );
    if (totalEstimatedTokens > CHATGPT_STORY_SRB_V1.maxEstimatedInputTokens * CHATGPT_STORY_SRB_V1.maxAttemptsPerMinute) {
      throw fail('RATE_LIMITED', 'The ChatGPT story pilot reached its aggregate estimated-input limit.', 429);
    }
    return { stored, timestamp };
  };

  async function run(input: {
    plan: ChatGptStoryPlan;
    currentGrantGeneration: () => number;
    signal?: AbortSignal;
    transport: (request: { body: string; limits: typeof CHATGPT_STORY_SRB_V1 }, signal: AbortSignal) => Promise<ChatGptStoryTransportResult>;
  }): Promise<ChatGptStoryTransportResult> {
    assertEnabled();
    const { stored, timestamp } = validateRunAdmission(input.plan, input.currentGrantGeneration, input.signal);

    // Charge the attempt before transport begins. Failures, cancellation and
    // ambiguous upstream outcomes cannot be retried with a fresh task id.
    stored.attempted = true;
    attempts.push({ at: timestamp, estimatedInputTokens: stored.value.estimatedInputTokens });
    activePlanId = stored.value.id;
    const controller = new AbortController();
    const abort = () => controller.abort(input.signal?.reason);
    input.signal?.addEventListener('abort', abort, { once: true });
    const timeout = setTimeout(() => controller.abort(fail('TIMEOUT', 'The ChatGPT story pilot exceeded its 60-second deadline.', 504)), CHATGPT_STORY_SRB_V1.timeoutMs);
    const aborted = new Promise<never>((_resolve, reject) => {
      const rejectAbort = () => reject(controller.signal.reason instanceof AppApiError
        ? controller.signal.reason
        : fail('CANCELLED', 'The ChatGPT story operation was cancelled.', 499));
      if (controller.signal.aborted) rejectAbort();
      else controller.signal.addEventListener('abort', rejectAbort, { once: true });
    });
    const transportPromise = Promise.resolve().then(() => input.transport(
      { body: stored.value.requestBody, limits: CHATGPT_STORY_SRB_V1 }, controller.signal,
    ));
    // A caller timeout/cancel revokes result authority immediately, but the
    // single-flight slot stays held until this local transport really settles.
    // Late RATE_LIMITED errors arriving after caller abort still engage quotaBlocked.
    void transportPromise.then(
      () => { if (activePlanId === stored.value.id) activePlanId = undefined; },
      (error: unknown) => {
        if (error instanceof AppApiError && error.code === 'RATE_LIMITED') quotaBlocked = true;
        if (activePlanId === stored.value.id) activePlanId = undefined;
      },
    );
    try {
      let result: ChatGptStoryTransportResult;
      try {
        result = await Promise.race([transportPromise, aborted]);
      } catch (error) {
        if (error instanceof AppApiError && error.code === 'RATE_LIMITED') quotaBlocked = true;
        throw error;
      }
      if (input.currentGrantGeneration() !== stored.value.grantGeneration || controller.signal.aborted) {
        throw fail('CANCELLED', 'The ChatGPT story result is stale and was discarded.', 499);
      }
      return validateStoryResult(result);
    } finally {
      clearTimeout(timeout);
      input.signal?.removeEventListener('abort', abort);
      controller.abort();
    }
  }

  function recoverQuotaBlock(): void { quotaBlocked = false; }

  return { prepare, run, recoverQuotaBlock } satisfies ChatGptStorySrbAuthority;
}
