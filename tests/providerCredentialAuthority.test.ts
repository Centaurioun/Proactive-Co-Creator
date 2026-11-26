import test from 'node:test';
import assert from 'node:assert/strict';
import type { AiProviderAdapter, AiProviderTextResult } from '../server/providers/contracts.ts';
import { createLegacyAiClient, createOpenAiApiAdapter, getCachedProviderModel, getChatGptModels, listProviderModels, setChatGptModels, setOpenAiApiKey, setPersonalGeminiKey } from '../server/providers/runtime.ts';
import { setSessionGeminiKey } from '../server/geminiClient.ts';
import { chatGptSessionStore } from '../server/auth/chatgpt/runtime.ts';
import { AI_OPERATION_POLICIES } from '../server/aiBudget.ts';
import { AppApiError } from '../server/errors.ts';

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(done => { resolve = done; });
  return { promise, resolve };
}

function fakeAdapter(overrides: Partial<AiProviderAdapter> = {}): AiProviderAdapter {
  return {
    connectionId: 'gemini-personal', family: 'gemini', billing: 'gemini-api-key',
    listModels: async () => [],
    countTokens: async () => ({ tokens: 1, source: 'provider-count' }),
    generateText: async () => ({ text: 'fresh result' }),
    ...overrides,
  };
}

test('personal credential replacement rejects a late inference result even if the adapter ignores abort', async () => {
  setPersonalGeminiKey('synthetic-personal-key-before');
  setSessionGeminiKey('synthetic-personal-key-before');
  const completion = deferred<AiProviderTextResult>();
  let signal: AbortSignal | undefined;
  const client = createLegacyAiClient(
    { connectionId: 'gemini-personal', modelId: 'gemini-fictional-test' }, 'story', 'synthetic-personal-key-before',
    () => { throw new Error('managed Gemini should not be selected'); },
    () => fakeAdapter({ generateText: async request => { signal = request.signal; return completion.promise; } }),
  );
  const pending = client.models.generateContent({ model: 'gemini-fictional-test', contents: 'synthetic prompt' });
  await new Promise<void>(resolve => setImmediate(resolve));
  setPersonalGeminiKey('synthetic-personal-key-after');
  setSessionGeminiKey('synthetic-personal-key-after');
  assert.equal(signal?.aborted, true);
  completion.resolve({ text: 'late private-era result' });
  await assert.rejects(pending, (error: unknown) => error instanceof AppApiError && error.code === 'CANCELLED');
});

test('legacy operations inherit the exact policy token cap without converting it to a byte or spend limit', async () => {
  setPersonalGeminiKey('synthetic-personal-key-for-output-cap');
  const caps: Array<{ maxOutputTokens?: number; maxOutputBytes: number }> = [];
  const client = createLegacyAiClient(
    { connectionId: 'gemini-personal', modelId: 'gemini-fictional-test' }, 'story', 'synthetic-personal-key-for-output-cap',
    () => { throw new Error('managed Gemini should not be selected'); },
    () => fakeAdapter({ generateText: async request => {
      caps.push({ maxOutputTokens: request.maxOutputTokens, maxOutputBytes: request.maxOutputBytes });
      return { text: 'synthetic result' };
    } }),
  );
  await client.models.generateContent({ model: 'gemini-fictional-test', contents: 'prompt' });
  await client.models.generateContent({ model: 'gemini-fictional-test', contents: 'prompt', config: { maxOutputTokens: 7 } });
  assert.deepEqual(caps, [
    { maxOutputTokens: AI_OPERATION_POLICIES.story.maxOutputTokens, maxOutputBytes: 128 * 1024 },
    { maxOutputTokens: 7, maxOutputBytes: 128 * 1024 },
  ]);
  setPersonalGeminiKey(undefined);
});

test('personal credential replacement prevents a signal-ignoring stale catalog from being cached', async () => {
  setPersonalGeminiKey('synthetic-personal-key-before');
  const completion = deferred<Awaited<ReturnType<AiProviderAdapter['listModels']>>>();
  const pending = listProviderModels('gemini-personal', undefined, () => fakeAdapter({ listModels: () => completion.promise }));
  await new Promise<void>(resolve => setImmediate(resolve));
  setPersonalGeminiKey('synthetic-personal-key-after');
  completion.resolve([{
    id: 'stale-model', displayName: 'Stale model', availability: { state: 'supported', value: true, evidence: [] },
    textGeneration: { state: 'supported', value: true, evidence: [] }, imageGeneration: { state: 'unsupported', evidence: [] },
    structuredOutput: { state: 'unknown', reason: 'test' }, contextLimit: { state: 'unknown', reason: 'test' },
    outputLimit: { state: 'unknown', reason: 'test' }, reasoning: { state: 'unknown', reason: 'test' },
    operationCapabilities: {}, capabilityPolicyVersion: 'test',
  }]);
  await assert.rejects(pending, (error: unknown) => error instanceof AppApiError && error.code === 'CANCELLED');
  assert.equal(getCachedProviderModel('gemini-personal', 'stale-model'), undefined);
});

test('an adapter captured before OpenAI API key replacement cannot send with either credential', async () => {
  setOpenAiApiKey('synthetic-openai-key-before');
  let calls = 0;
  const staleAdapter = createOpenAiApiAdapter(async () => { calls += 1; return Response.json({ data: [] }); });
  setOpenAiApiKey('synthetic-openai-key-after');
  await assert.rejects(staleAdapter.listModels(), (error: unknown) => error instanceof AppApiError && error.code === 'CANCELLED');
  assert.equal(calls, 0);
  setOpenAiApiKey(undefined);
  setPersonalGeminiKey(undefined);
  setSessionGeminiKey(undefined);
});

test('a stale ChatGPT account catalog cannot replace the catalog for a reconnected session', async () => {
  chatGptSessionStore.install({ accessToken: 'synthetic-before', expiresAt: Date.now() + 60_000, tokenType: 'Bearer' });
  setChatGptModels([]);
  const completion = deferred<Awaited<ReturnType<AiProviderAdapter['listModels']>>>();
  const pending = listProviderModels('chatgpt-plan', undefined, () => fakeAdapter({
    connectionId: 'chatgpt-plan', billing: 'chatgpt-plan', family: 'openai', listModels: () => completion.promise,
  }));
  await new Promise<void>(resolve => setImmediate(resolve));
  chatGptSessionStore.install({ accessToken: 'synthetic-after', expiresAt: Date.now() + 60_000, tokenType: 'Bearer' });
  completion.resolve([{
    id: 'stale-chatgpt-model', displayName: 'Stale account model', availability: { state: 'supported', value: true, evidence: [] },
    textGeneration: { state: 'supported', value: true, evidence: [] }, imageGeneration: { state: 'unsupported', evidence: [] },
    structuredOutput: { state: 'unknown', reason: 'test' }, contextLimit: { state: 'unknown', reason: 'test' },
    outputLimit: { state: 'unknown', reason: 'test' }, reasoning: { state: 'unknown', reason: 'test' },
    operationCapabilities: {}, capabilityPolicyVersion: 'test',
  }]);
  await assert.rejects(pending, (error: unknown) => error instanceof AppApiError && error.code === 'CANCELLED');
  assert.deepEqual(getChatGptModels(), []);
  chatGptSessionStore.clear();
});
