import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { AppApiError, classifyGeminiError } from '../server/errors.ts';
import { extractRetryAfterMs, withRetry } from '../server/retry.ts';
import { runWithAiProviderContext } from '../server/providers/requestContext.ts';
import { generateImagesBatch } from '../server/aiService.ts';
import { acquireAiSlot, resetAiSlotsForTests } from '../server/aiBudget.ts';

describe('server/errors & server/retry', () => {
  it('classifies auth, rate limit, model unsupported, safety, timeout, abort, and invalid responses', () => {
    const auth = classifyGeminiError({ status: 403, message: 'PERMISSION_DENIED' });
    assert.equal(auth.code, 'AUTH_ERROR');
    assert.equal(auth.statusCode, 403);
    assert.equal(auth.retryable, false);

    const rate = classifyGeminiError({ status: 429, message: 'RESOURCE_EXHAUSTED' });
    assert.equal(rate.code, 'RATE_LIMITED');
    assert.equal(rate.statusCode, 429);
    assert.equal(rate.retryable, true);

    const model = classifyGeminiError({ status: 404, message: 'models/foo is not found' });
    assert.equal(model.code, 'MODEL_UNSUPPORTED');
    assert.equal(model.statusCode, 502);

    const safety = classifyGeminiError(new Error('Prompt blocked due to safety policy'));
    assert.equal(safety.code, 'SAFETY_BLOCKED');
    assert.equal(safety.statusCode, 422);

    const invalid = classifyGeminiError(new Error('INVALID_RESPONSE: bad json'));
    assert.equal(invalid.code, 'INVALID_RESPONSE');
    assert.equal(invalid.statusCode, 502);

    const timeout = classifyGeminiError(new Error('Request timed out after 45s'));
    assert.equal(timeout.code, 'TIMEOUT');
    assert.equal(timeout.statusCode, 504);

    const aborted = classifyGeminiError(new DOMException('The operation was aborted', 'AbortError'));
    assert.equal(aborted.code, 'CANCELLED');
    assert.equal(aborted.statusCode, 499);

    const passthrough = new AppApiError('MISSING_API_KEY', 'missing key', 503, false);
    assert.equal(classifyGeminiError(passthrough), passthrough);
  });

  it('extracts Retry-After headers cleanly', () => {
    assert.equal(extractRetryAfterMs({ headers: { 'retry-after': '2' } }), 2000);
    assert.equal(extractRetryAfterMs({ headers: { 'Retry-After': '120' } }), 30000);
    assert.equal(extractRetryAfterMs({}), null);
  });

  it('retries transient errors with exponential backoff and respects Retry-After', async () => {
    let attempts = 0;
    const delays: number[] = [];

    const result = await withRetry(
      async () => {
        attempts += 1;
        if (attempts === 1) {
          throw { status: 503, message: '503 Unavailable' };
        }
        if (attempts === 2) {
          throw { status: 429, message: '429 Rate limit', headers: { 'retry-after': '1' } };
        }
        return 'ok';
      },
      {
        maxAttempts: 4,
        initialDelayMs: 100,
        random: () => 0,
        sleep: async (ms) => {
          delays.push(ms);
        },
      }
    );

    assert.equal(result, 'ok');
    assert.equal(attempts, 3);
    assert.deepEqual(delays, [100, 1000]);
  });

  it('does not retry non-retryable errors and stops immediately on AbortSignal', async () => {
    let attempts = 0;
    await assert.rejects(
      () =>
        withRetry(
          async () => {
            attempts += 1;
            throw new AppApiError('AUTH_ERROR', 'invalid key', 403, false);
          },
          { maxAttempts: 3, sleep: async () => undefined }
        ),
      (err: unknown) => err instanceof AppApiError && err.code === 'AUTH_ERROR'
    );
    assert.equal(attempts, 1);

    const controller = new AbortController();
    controller.abort();
    await assert.rejects(
      () => withRetry(async () => 'never', { signal: controller.signal }),
      (err: unknown) => err instanceof AppApiError && err.code === 'CANCELLED'
    );
  });

  it('W1-D08 (R15): ignores blank Retry-After, parses Headers and HTTP-date, checks abort after fn resolves, and caps chatgpt-plan to 1 attempt', async () => {
    assert.equal(extractRetryAfterMs({ headers: { 'retry-after': '' } }), null);
    assert.equal(extractRetryAfterMs({ headers: { 'retry-after': '   ' } }), null);
    assert.equal(extractRetryAfterMs({ headers: new Headers({ 'Retry-After': '3' }) }), 3000);
    const nowMs = Date.UTC(2026, 10, 26, 12, 0, 0);
    const httpDate = new Date(nowMs + 5_000).toUTCString();
    const parseWithNow = extractRetryAfterMs as (err: unknown, now?: number) => number | null;
    assert.equal(parseWithNow({ headers: new Headers({ 'Retry-After': httpDate }) }, nowMs), 5000);

    const controller = new AbortController();
    await assert.rejects(
      () => withRetry(async () => {
        controller.abort();
        return 'late-result';
      }, { signal: controller.signal }),
      (err: unknown) => err instanceof AppApiError && err.code === 'CANCELLED'
    );

    let chatGptAttempts = 0;
    await assert.rejects(
      () => runWithAiProviderContext(
        { selection: { connectionId: 'chatgpt-plan', modelId: 'gpt-6-luna' }, operation: 'story' },
        () => withRetry(async () => {
          chatGptAttempts += 1;
          throw { status: 503, message: '503 Unavailable' };
        }, { maxAttempts: 4, sleep: async () => undefined })
      ),
      (err: unknown) => (err as { status?: number }).status === 503
    );
    assert.equal(chatGptAttempts, 1);
  });

  it('W1-D16: generateImagesBatch settles all sibling workers before releasing the AI concurrency slot on fatal error', async () => {
    resetAiSlotsForTests();
    let worker2StartedResolve!: () => void;
    const worker2Started = new Promise<void>(resolve => { worker2StartedResolve = resolve; });
    let worker2Settled = false;
    let call = 0;
    const fakeClient = {
      models: {
        generateContent: async (params: { config?: { abortSignal?: AbortSignal } }) => {
          const idx = ++call;
          if (idx === 1) {
            await worker2Started;
            throw { status: 403, message: 'PERMISSION_DENIED' };
          }
          worker2StartedResolve();
          return await new Promise((_resolve, reject) => {
            const abort = () => {
              worker2Settled = true;
              reject(new DOMException('Aborted', 'AbortError'));
            };
            if (params.config?.abortSignal?.aborted) abort();
            else params.config?.abortSignal?.addEventListener('abort', abort, { once: true });
          });
        },
      },
    };
    const fn = generateImagesBatch as (prompt: string, signal?: AbortSignal, client?: unknown) => Promise<unknown>;
    await assert.rejects(() => fn('A cat painting', undefined, fakeClient), (err: unknown) =>
      err instanceof AppApiError && err.code === 'AUTH_ERROR');
    assert.equal(worker2Settled, true, 'sibling worker must settle before generateImagesBatch rejects and releases slot');
    const slot = acquireAiSlot('image');
    assert.equal(slot.ok, true);
    if (slot.ok) slot.release();
  });
});
