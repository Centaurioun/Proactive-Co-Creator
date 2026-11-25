import assert from 'node:assert/strict';
import test from 'node:test';
import { AppApiError } from '../server/errors.ts';
import {
  createGeminiAdapter,
  type GeminiAdapterFactoryInput,
  type GeminiSdkClient,
} from '../server/providers/geminiAdapter.ts';
import { createLegacyAiClient } from '../server/providers/runtime.ts';

function clientWith(models: Partial<GeminiSdkClient['models']>): GeminiSdkClient {
  return { models: models as GeminiSdkClient['models'] };
}

function baseInput(overrides: Partial<GeminiAdapterFactoryInput> = {}): GeminiAdapterFactoryInput {
  return {
    connectionId: 'gemini-personal',
    personalApiKey: 'session-personal-key',
    clientFactory: () => clientWith({}),
    ...overrides,
  };
}

test('personal connection constructs an ephemeral SDK client from the supplied key', async () => {
  const calls: string[] = [];
  const client = clientWith({ list: async () => (async function* () {})() });
  const adapter = createGeminiAdapter(baseInput({
    personalApiKey: '  session-personal-key  ',
    clientFactory: ({ apiKey }) => {
      calls.push(apiKey);
      return client;
    },
  }));

  await adapter.listModels();

  assert.deepEqual(calls, ['session-personal-key']);
  assert.equal(adapter.connectionId, 'gemini-personal');
  assert.equal(adapter.billing, 'gemini-api-key');
  assert.equal(JSON.stringify(adapter).includes('session-personal-key'), false);
});

test('personal and subscription adapters do not resolve the host-managed Gemini client eagerly', () => {
  let managedCalls = 0;
  const client = createLegacyAiClient(
    { connectionId: 'gemini-personal', modelId: 'gemini-text' },
    'story',
    'synthetic-session-key-1234567890',
    () => { managedCalls += 1; throw new Error('managed key must not be required'); },
  );

  assert.equal(typeof client.models.generateContent, 'function');
  assert.equal(managedCalls, 0);
});

test('managed connection uses the host client factory and ignores personal key input', async () => {
  const managedClient = clientWith({ list: async () => (async function* () {})() });
  let managedCalls = 0;
  const adapter = createGeminiAdapter(baseInput({
    connectionId: 'gemini-managed',
    personalApiKey: 'must-not-be-used',
    clientFactory: undefined,
    managedClientFactory: () => {
      managedCalls += 1;
      return managedClient;
    },
  }));

  await adapter.listModels();

  assert.equal(managedCalls, 1);
  assert.equal(adapter.billing, 'host-managed-gemini');
});

test('model listing maps only SDK-reported supported actions and reasoning support', async () => {
  const adapter = createGeminiAdapter(baseInput({
    clientFactory: () => clientWith({
      list: async () => (async function* () {
        yield { name: 'models/gemini-text', displayName: 'Gemini Text', supportedActions: ['generateContent'], thinking: true, inputTokenLimit: 16_000, outputTokenLimit: 2_000 };
        yield { name: 'models/imagen-test', displayName: 'Imagen', supportedActions: ['generateImages'] };
        yield { name: 'models/unknown' };
      })(),
    }),
  }));

  const models = await adapter.listModels();

  assert.equal(models[0].availability.state, 'supported');
  assert.deepEqual(models[0].textGeneration, {
    state: 'supported', value: true, evidence: [{
      source: 'account-catalog', reference: 'Gemini API models.list response',
      checkedAt: models[0].textGeneration.state === 'supported' ? models[0].textGeneration.evidence[0].checkedAt : '',
      transport: 'gemini-api-models-list', modelSlug: 'gemini-text',
    }],
  });
  assert.deepEqual(models[0].reasoning, {
    state: 'unknown', reason: 'The catalog thinking boolean does not identify supported levels for this exact model.',
  });
  assert.deepEqual(models[0].contextLimit, { state: 'supported', value: 16_000, evidence: models[0].contextLimit.state === 'supported' ? models[0].contextLimit.evidence : [] });
  assert.deepEqual(models[0].outputLimit, { state: 'supported', value: 2_000, evidence: models[0].outputLimit.state === 'supported' ? models[0].outputLimit.evidence : [] });
  assert.equal(models[0].operationCapabilities.story?.state, 'supported');
  assert.equal(models[0].operationCapabilities.analyze?.state, 'unknown');
  assert.equal(models[0].capabilityPolicyVersion, '2026-11-25.1');
  assert.equal(models[1].imageGeneration.state, 'supported');
  assert.equal(models[1].operationCapabilities.image?.state, 'supported');
  assert.equal(models[2].textGeneration.state, 'unknown');
  assert.equal(models[2].reasoning.state, 'unknown');
});

test('countTokens forwards abort signal and returns provider count', async () => {
  const controller = new AbortController();
  let args: unknown;
  const adapter = createGeminiAdapter(baseInput({
    clientFactory: () => clientWith({
      countTokens: async (params) => {
        args = params;
        return { totalTokens: 17 };
      },
    }),
  }));

  assert.deepEqual(await adapter.countTokens('gemini-text', 'prompt', controller.signal), {
    tokens: 17, source: 'provider-count',
  });
  assert.deepEqual(args, { model: 'gemini-text', contents: 'prompt', config: { abortSignal: controller.signal } });
});

test('generateText maps instructions, reasoning, schema, output budget and observed usage', async () => {
  let args: unknown;
  const adapter = createGeminiAdapter(baseInput({
    clientFactory: () => clientWith({
      generateContent: async (params) => {
        args = params;
        return { text: '{"ok":true}', usageMetadata: { promptTokenCount: 5, candidatesTokenCount: 3 } };
      },
    }),
  }));
  const schema = { type: 'OBJECT' };

  const result = await adapter.generateText({
    operation: 'analyze', modelId: 'gemini-text', input: 'prompt', instructions: 'system rules',
    reasoningLevel: 'extra-high', maxInputBytes: 100, maxOutputBytes: 400, timeoutMs: 1_000,
    responseSchema: schema,
  });

  assert.deepEqual(result, {
    text: '{"ok":true}',
    usage: { inputTokens: 5, outputTokens: 3, source: 'provider-observed' },
  });
  assert.ok(args && typeof args === 'object');
  const contentArgs = args as { model: string; contents: string; config: Record<string, unknown> };
  assert.equal(contentArgs.model, 'gemini-text');
  assert.equal(contentArgs.contents, 'prompt');
  assert.ok(contentArgs.config.abortSignal instanceof AbortSignal);
  assert.equal(contentArgs.config.systemInstruction, 'system rules');
  assert.equal(contentArgs.config.maxOutputTokens, 100);
  assert.equal(contentArgs.config.responseMimeType, 'application/json');
  assert.equal(contentArgs.config.responseSchema, schema);
  assert.deepEqual(contentArgs.config.thinkingConfig, { thinkingLevel: 'xhigh' });
});

test('generateText omits provider thinking config for default reasoning', async () => {
  let config: Record<string, unknown> | undefined;
  const adapter = createGeminiAdapter(baseInput({
    clientFactory: () => clientWith({ generateContent: async ({ config: value }) => {
      config = value;
      return { text: 'ok' };
    } }),
  }));

  await adapter.generateText({
    operation: 'writing', modelId: 'gemini-text', input: 'prompt', reasoningLevel: 'default',
    maxInputBytes: 100, maxOutputBytes: 100, timeoutMs: 1_000,
  });

  assert.equal(config?.thinkingConfig, undefined);
});

test('generateImage uses SDK image generation when available and rejects if unavailable', async () => {
  let args: unknown;
  const adapter = createGeminiAdapter(baseInput({
    clientFactory: () => clientWith({ generateImages: async (params) => {
      args = params;
      return { generatedImages: [{ image: { imageBytes: 'aW1n', mimeType: 'image/png' } }] };
    } }),
  }));
  const imageRequest = {
    operation: 'image' as const, modelId: 'imagen-test', input: 'a red kite',
    maxInputBytes: 100, maxOutputBytes: 100, timeoutMs: 1_000,
  };

  assert.deepEqual(await adapter.generateImage!(imageRequest), {
    generatedImages: [{ image: { imageBytes: 'aW1n', mimeType: 'image/png' } }],
  });
  assert.ok(args && typeof args === 'object');
  const imageArgs = args as { model: string; prompt: string; config: Record<string, unknown> };
  assert.equal(imageArgs.model, 'imagen-test');
  assert.equal(imageArgs.prompt, 'a red kite');
  assert.ok(imageArgs.config.abortSignal instanceof AbortSignal);
  assert.equal(imageArgs.config.numberOfImages, 1);

  const unsupported = createGeminiAdapter(baseInput({ clientFactory: () => clientWith({}) }));
  await assert.rejects(unsupported.generateImage!(imageRequest), (error: unknown) =>
    error instanceof AppApiError && error.code === 'MODEL_UNSUPPORTED');
});

test('provider errors normalize safely and do not expose credentials or upstream messages', async () => {
  const secret = 'AIza-secret-session-key';
  const adapter = createGeminiAdapter(baseInput({
    personalApiKey: secret,
    clientFactory: () => clientWith({ countTokens: async () => {
      throw Object.assign(new Error(`401 unauthorized key=${secret}`), { status: 401 });
    } }),
  }));

  await assert.rejects(adapter.countTokens('gemini-text', 'prompt'), (error: unknown) => {
    assert.ok(error instanceof AppApiError);
    assert.equal(error.code, 'AUTH_ERROR');
    assert.equal(error.message.includes(secret), false);
    assert.equal(error.message.includes('401 unauthorized'), false);
    return true;
  });
});

test('generation deadline rejects even when the SDK ignores its abort signal', async () => {
  const adapter = createGeminiAdapter(baseInput({
    clientFactory: () => clientWith({ generateContent: async () => new Promise(() => undefined) }),
  }));

  await assert.rejects(adapter.generateText({
    operation: 'story', modelId: 'gemini-text', input: 'prompt',
    maxInputBytes: 100, maxOutputBytes: 100, timeoutMs: 10,
  }), (error: unknown) => error instanceof AppApiError && error.code === 'TIMEOUT');
});

test('text generation enforces input byte budget before SDK dispatch', async () => {
  let calls = 0;
  const adapter = createGeminiAdapter(baseInput({
    clientFactory: () => clientWith({ generateContent: async () => {
      calls += 1;
      return { text: 'unexpected' };
    } }),
  }));

  await assert.rejects(adapter.generateText({
    operation: 'story', modelId: 'gemini-text', input: 'oversized',
    maxInputBytes: 2, maxOutputBytes: 100, timeoutMs: 100,
  }), (error: unknown) => error instanceof AppApiError && error.code === 'VALIDATION_ERROR');
  assert.equal(calls, 0);
});

test('missing personal key fails with a safe configuration error', () => {
  assert.throws(() => createGeminiAdapter({
    connectionId: 'gemini-personal',
  }), (error: unknown) => error instanceof AppApiError && error.code === 'MISSING_API_KEY');
});
