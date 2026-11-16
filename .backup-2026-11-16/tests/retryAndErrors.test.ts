import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { AppApiError, classifyGeminiError } from '../server/errors.ts';
import { extractRetryAfterMs, withRetry } from '../server/retry.ts';

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
});
