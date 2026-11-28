import { afterEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { AppApiError } from '../server/errors.ts';
import { defaultSleep, withRetry } from '../server/retry.ts';
import { AI_OPERATION_POLICIES, resetAiSlotsForTests } from '../server/aiBudget.ts';
import { analyzeBeliefGraph, generateStoryText } from '../server/aiService.ts';
import { runWithAiProviderContext } from '../server/providers/requestContext.ts';
import { createLegacyAiClient, providerHubStatus } from '../server/providers/runtime.ts';
import type { getGeminiClient } from '../server/geminiClient.ts';

type FakeClient = ReturnType<typeof getGeminiClient>;

describe('WP01 M1 — Provider Operation Reliability & Truthful Errors', () => {
  afterEach(() => {
    resetAiSlotsForTests();
  });

  it('preserves trusted AppApiError TIMEOUT across all abort points (before attempt, in-flight, retry sleep, after response)', async () => {
    const timeoutErr = new AppApiError('TIMEOUT', 'The AI request timed out.', 504, true);

    // 1. Aborted before attempt
    const preAborted = new AbortController();
    preAborted.abort(timeoutErr);
    await assert.rejects(
      () => withRetry(async () => 'never', { signal: preAborted.signal }),
      (err: unknown) => err instanceof AppApiError && err.code === 'TIMEOUT' && err.statusCode === 504 && err.retryable === true,
    );

    // 2. Aborted during in-flight call
    const inFlightController = new AbortController();
    await assert.rejects(
      () =>
        withRetry(
          async () => {
            inFlightController.abort(timeoutErr);
            throw new Error('upstream fetch aborted');
          },
          { signal: inFlightController.signal, maxAttempts: 3 },
        ),
      (err: unknown) => err instanceof AppApiError && err.code === 'TIMEOUT' && err.statusCode === 504 && err.retryable === true,
    );

    // 3. Aborted during retry sleep delay
    const sleepController = new AbortController();
    let attempts = 0;
    await assert.rejects(
      () =>
        withRetry(
          async () => {
            attempts += 1;
            setTimeout(() => sleepController.abort(timeoutErr), 15);
            throw Object.assign(new Error('503 Service Unavailable'), { status: 503 });
          },
          { signal: sleepController.signal, maxAttempts: 3, initialDelayMs: 500, random: () => 0 },
        ),
      (err: unknown) => err instanceof AppApiError && err.code === 'TIMEOUT' && err.statusCode === 504 && err.retryable === true,
    );
    assert.equal(attempts, 1);

    // 4. Aborted after response resolves
    const afterController = new AbortController();
    await assert.rejects(
      () =>
        withRetry(
          async () => {
            afterController.abort(timeoutErr);
            return 'late-response';
          },
          { signal: afterController.signal },
        ),
      (err: unknown) => err instanceof AppApiError && err.code === 'TIMEOUT' && err.statusCode === 504 && err.retryable === true,
    );
  });

  it('classifies user cancellations and untrusted abort reasons strictly as CANCELLED (499, retryable: false)', async () => {
    const userAbort = new AbortController();
    userAbort.abort('arbitrary-untrusted-string-secret');
    await assert.rejects(
      () => defaultSleep(50, userAbort.signal),
      (err: unknown) =>
        err instanceof AppApiError &&
        err.code === 'CANCELLED' &&
        err.statusCode === 499 &&
        err.retryable === false &&
        !err.message.includes('arbitrary-untrusted-string-secret'),
    );

    const domAbort = new AbortController();
    domAbort.abort(new DOMException('User cancelled', 'AbortError'));
    await assert.rejects(
      () => withRetry(async () => 'never', { signal: domAbort.signal }),
      (err: unknown) => err instanceof AppApiError && err.code === 'CANCELLED' && err.statusCode === 499 && err.retryable === false,
    );
  });

  it('retries transient 503 on Gemini up to budget bound, but stays strictly single-attempt on chatgpt-plan', async () => {
    let geminiAttempts = 0;
    const geminiResult = await withRetry(
      async () => {
        geminiAttempts += 1;
        if (geminiAttempts < 2) {
          throw Object.assign(new Error('503 temporary outage'), { status: 503 });
        }
        return 'recovered';
      },
      { maxAttempts: 3, initialDelayMs: 5, random: () => 0 },
    );
    assert.equal(geminiResult, 'recovered');
    assert.equal(geminiAttempts, 2);

    let chatGptAttempts = 0;
    await assert.rejects(
      () =>
        runWithAiProviderContext(
          { selection: { connectionId: 'chatgpt-plan', modelId: 'gpt-6-luna' }, operation: 'story' },
          () =>
            withRetry(
              async () => {
                chatGptAttempts += 1;
                throw Object.assign(new Error('503 temporary outage'), { status: 503 });
              },
              { maxAttempts: 3, initialDelayMs: 5, random: () => 0 },
            ),
        ),
      /503 temporary outage/,
    );
    assert.equal(chatGptAttempts, 1);
  });

  it('generateStoryText reports 504 TIMEOUT (never 499 CANCELLED), caps maxOutputTokens, and does not force LOW thinking', async () => {
    let capturedConfig: Record<string, unknown> | undefined;
    const hangingClient = {
      models: {
        generateContent: async ({ config }: { config?: Record<string, unknown> }) => {
          capturedConfig = config;
          const sig = config?.abortSignal as AbortSignal | undefined;
          return new Promise<never>((_, reject) => {
            sig?.addEventListener('abort', () => reject(new Error('aborted by timeout')), { once: true });
          });
        },
      },
    } as unknown as FakeClient;

    await assert.rejects(
      () => generateStoryText('A lighthouse keeper waits for a ship.', undefined, hangingClient, 25),
      (err: unknown) => err instanceof AppApiError && err.code === 'TIMEOUT' && err.statusCode === 504 && err.retryable === true,
    );
    assert.equal(capturedConfig?.maxOutputTokens, AI_OPERATION_POLICIES.story.maxOutputTokens);
    assert.equal(capturedConfig?.thinkingConfig, undefined);
  });

  it('analyzeBeliefGraph honors selected model/reasoning without forcing LOW thinking and rejects oversized input', async () => {
    let seenModel: string | undefined;
    let seenConfig: Record<string, unknown> | undefined;
    const mockClient = {
      models: {
        generateContent: async (params: { model: string; config?: Record<string, unknown> }) => {
          seenModel = params.model;
          seenConfig = params.config;
          return {
            text: JSON.stringify({
              entities: [
                {
                  name: 'The Story',
                  category: 'scene',
                  presence_in_prompt: true,
                  description: 'Test scene',
                  attributes: [{ name: 'existence', presence_in_prompt: true, value: ['true', 'false'] }],
                },
              ],
              relationships: [],
            }),
          };
        },
      },
    } as unknown as FakeClient;

    await runWithAiProviderContext(
      {
        selection: { connectionId: 'gemini-personal', modelId: 'gemini-custom-test', reasoningLevel: 'high' },
        operation: 'analyze',
      },
      () => analyzeBeliefGraph('A quiet harbor at dusk.', 'story', undefined, mockClient),
    );
    assert.equal(seenModel, 'gemini-custom-test');
    assert.equal(seenConfig?.maxOutputTokens, AI_OPERATION_POLICIES.analyze.maxOutputTokens);
    assert.equal(seenConfig?.thinkingConfig, undefined);

    await assert.rejects(
      () => analyzeBeliefGraph('x'.repeat(AI_OPERATION_POLICIES.analyze.maxInputChars + 10), 'story', undefined, mockClient),
      (err: unknown) => err instanceof AppApiError && err.code === 'VALIDATION_ERROR' && err.statusCode === 400,
    );
  });

  it('createLegacyAiClient records observedByConnection for default gemini-managed requests', async () => {
    const before = providerHubStatus(true).usage.observedByConnection['gemini-managed'] ?? 0;
    const managedMock = {
      models: {
        countTokens: async () => ({ totalTokens: 10 }),
        generateContent: async () => ({ text: 'ok' }),
      },
    };
    const client = createLegacyAiClient(
      { connectionId: 'gemini-managed' },
      'story',
      undefined,
      () => managedMock,
    );
    const res = await client.models.generateContent({ model: 'gemini-4-hydrogen', contents: 'hello' });
    assert.equal(res.text, 'ok');
    const after = providerHubStatus(true).usage.observedByConnection['gemini-managed'] ?? 0;
    assert.equal(after, before + 1);
  });
});
