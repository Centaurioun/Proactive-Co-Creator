import test from 'node:test';
import assert from 'node:assert/strict';
import { ChatGptResponsesAdapter } from '../server/providers/chatgptResponses';
import { createOpenAiApiAdapter, setOpenAiApiKey } from '../server/providers/runtime.ts';

function sse(...events: Array<{ type: string; [key: string]: unknown }>): Response {
  const body = events.map((event) => `event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`).join('');
  return new Response(body, { headers: { 'content-type': 'text/event-stream' } });
}

function request(overrides: Partial<Parameters<ChatGptResponsesAdapter['generateText']>[0]> = {}) {
  return {
    operation: 'story' as const,
    modelId: 'gpt-6.2-sol',
    input: 'Write one sentence.',
    maxInputBytes: 1024,
    maxOutputBytes: 1024,
    timeoutMs: 1000,
    ...overrides,
  };
}

test('lists the account catalog without claiming unverified model capabilities', async () => {
  const urls: string[] = [];
  const adapter = new ChatGptResponsesAdapter('local-token', async (input) => {
    urls.push(String(input));
    return Response.json({ models: [
      { slug: 'gpt-a', display_name: 'Model A', visibility: 'list' },
      { slug: 'hidden', display_name: 'Hidden', visibility: 'hide' },
    ] });
  });

  const models = await adapter.listModels();
  assert.deepEqual(models.map(({ id, displayName }) => ({ id, displayName })), [
    { id: 'gpt-a', displayName: 'Model A' },
  ]);
  assert.deepEqual(models[0].availability.state, 'supported');
  assert.deepEqual(models[0].textGeneration.state, 'unknown');
  assert.deepEqual(models[0].operationCapabilities.story?.state, 'unknown');
  assert.deepEqual(models[0].operationCapabilities.analyze?.state, 'unknown');
  assert.deepEqual(models[0].reasoning.state, 'unknown');
  assert.deepEqual(models[0].structuredOutput.state, 'unknown');
  assert.deepEqual(urls, ['https://api.openai.com/v1/models']);
});

test('lists OpenAI API account models under the separate API billing identity', async () => {
  let requestHeaders: Headers | undefined;
  const adapter = new ChatGptResponsesAdapter('synthetic-api-key-for-test', async (_input, init) => {
    requestHeaders = new Headers(init?.headers);
    return Response.json({ data: [
      { id: 'gpt-6.2-sol', name: 'GPT 6.2 Sol' },
      { id: 'unknown-account-model' },
    ] });
  }, undefined, 'openai-api');

  const models = await adapter.listModels();
  assert.equal(adapter.connectionId, 'openai-api');
  assert.equal(adapter.billing, 'openai-api-key');
  assert.equal(requestHeaders?.get('authorization'), 'Bearer synthetic-api-key-for-test');
  assert.deepEqual(models.map(model => model.id), ['gpt-6.2-sol', 'unknown-account-model']);
  assert.equal(models[0].textGeneration.state, 'supported');
  assert.equal(models[0].reasoning.state, 'supported');
  assert.equal(models[1].availability.state, 'supported');
  assert.equal(models[1].textGeneration.state, 'unknown');
  assert.equal(models[0].operationCapabilities.story?.state, 'supported');
  assert.equal(models[0].imageGeneration.state, 'unsupported');
});

test('OpenAI API responses keep the API billing path and do not set a ChatGPT plan identity', async () => {
  let sent: { url: string; init: RequestInit } | undefined;
  const adapter = new ChatGptResponsesAdapter('synthetic-api-key-for-test', async (input, init) => {
    sent = { url: String(input), init: init ?? {} };
    return sse(
      { type: 'response.output_text.delta', delta: 'API result' },
      { type: 'response.completed', response: {} },
    );
  }, undefined, 'openai-api');
  const result = await adapter.generateText(request({ reasoningLevel: 'default' }));
  assert.equal(result.text, 'API result');
  assert.equal(adapter.billing, 'openai-api-key');
  assert.equal(sent?.url, 'https://api.openai.com/v1/responses');
  assert.equal(new Headers(sent?.init.headers).get('authorization'), 'Bearer synthetic-api-key-for-test');
  const body = JSON.parse(String(sent?.init.body));
  assert.equal(body.store, false);
  assert.equal(body.stream, true);
  assert.equal(body.reasoning, undefined);
});

test('removing an OpenAI API key aborts its in-flight response', async () => {
  let markStarted!: () => void;
  const started = new Promise<void>(resolve => { markStarted = resolve; });
  setOpenAiApiKey('synthetic-openai-key-for-test');
  const adapter = createOpenAiApiAdapter(async (_input, init) => new Promise<Response>((_resolve, reject) => {
    markStarted();
    init?.signal?.addEventListener('abort', () => reject(new Error('aborted')), { once: true });
  }));
  const pending = adapter.generateText(request());
  await started;
  setOpenAiApiKey(undefined);
  await assert.rejects(pending, /cancel/i);
});

test('removing an OpenAI API key aborts an in-flight account catalog refresh', async () => {
  let markStarted!: () => void;
  const started = new Promise<void>(resolve => { markStarted = resolve; });
  setOpenAiApiKey('synthetic-openai-key-for-test');
  const adapter = createOpenAiApiAdapter(async (_input, init) => new Promise<Response>((_resolve, reject) => {
    markStarted();
    init?.signal?.addEventListener('abort', () => reject(new Error('aborted')), { once: true });
  }));
  const pending = adapter.listModels();
  await started;
  setOpenAiApiKey(undefined);
  await assert.rejects(pending, /cancel/i);
});

test('token count is a local estimate and does not call a provider endpoint', async () => {
  let calls = 0;
  const adapter = new ChatGptResponsesAdapter('local-token', async () => { calls += 1; throw new Error('unexpected'); });
  const count = await adapter.countTokens('gpt-a', 'abcdefgh');
  assert.equal(count.source, 'estimate');
  assert.ok(count.tokens > 0);
  assert.equal(calls, 0);
});

test('streams Responses text and requires the completed terminal event', async () => {
  let sent: { url: string; init: RequestInit } | undefined;
  const adapter = new ChatGptResponsesAdapter('secret-for-test', async (input, init) => {
    sent = { url: String(input), init: init ?? {} };
    return sse(
      { type: 'response.created', response: { id: 'r1' } },
      { type: 'response.output_text.delta', delta: 'Hello' },
      { type: 'response.output_text.delta', delta: ' world' },
      { type: 'response.completed', response: { usage: { input_tokens: 3, output_tokens: 2 } } },
    );
  });

  const result = await adapter.generateText(request({ instructions: 'Be concise.', reasoningLevel: 'high', responseSchema: { type: 'object' } }));
  assert.equal(result.text, 'Hello world');
  assert.deepEqual(result.usage, { inputTokens: 3, outputTokens: 2, source: 'provider-observed' });
  assert.equal(sent?.url, 'https://api.openai.com/v1/responses');
  assert.equal(new Headers(sent?.init.headers).get('authorization'), 'Bearer secret-for-test');
  const body = JSON.parse(String(sent?.init.body));
  assert.equal(body.store, false);
  assert.equal(body.stream, true);
  assert.equal(body.model, 'gpt-6.2-sol');
  assert.deepEqual(body.input, [{ role: 'user', content: 'Write one sentence.' }]);
  assert.match(body.instructions, /^Be concise\./);
  assert.match(body.instructions, /Return exactly one JSON value/);
  assert.deepEqual(body.reasoning, { effort: 'high' });
  assert.equal('text' in body, false);
  assert.equal('max_output_tokens' in body, false);
});

test('rejects streams that end without response.completed', async () => {
  const adapter = new ChatGptResponsesAdapter('local-token', async () => sse(
    { type: 'response.output_text.delta', delta: 'partial' },
  ));
  await assert.rejects(adapter.generateText(request()), /response.completed/);
});

test('rejects malformed SSE JSON and mismatched event envelopes', async () => {
  const malformed = new ChatGptResponsesAdapter('local-token', async () => new Response('event: response.completed\ndata: {nope}\n\n'));
  await assert.rejects(malformed.generateText(request()), /malformed/i);
  const mismatch = new ChatGptResponsesAdapter('local-token', async () => new Response('event: response.completed\ndata: {"type":"response.failed"}\n\n'));
  await assert.rejects(mismatch.generateText(request()), /event type/i);
});

test('fails on Responses errors and incomplete terminal responses without retrying', async () => {
  let calls = 0;
  const failed = new ChatGptResponsesAdapter('local-token', async () => {
    calls += 1;
    return sse({ type: 'response.failed', response: { error: { code: 'subscription_sharing_user_not_eligible' } } });
  });
  await assert.rejects(failed.generateText(request()), /failed/);
  assert.equal(calls, 1);

  const incomplete = new ChatGptResponsesAdapter('local-token', async () => sse(
    { type: 'response.incomplete', response: { status: 'incomplete' } },
  ));
  await assert.rejects(incomplete.generateText(request()), /incomplete/);
});

test('preserves safe ChatGPT error codes, parameters and request IDs without surfacing raw payload text', async () => {
  const adapter = new ChatGptResponsesAdapter('local-token', async () => new Response(JSON.stringify({
    error: { code: 'subscription_sharing_unsupported_capability', param: 'reasoning.effort', message: 'private provider detail' },
    detail: 'private admission detail',
  }), { status: 400, headers: { 'content-type': 'application/json', 'x-request-id': 'req_pcc_test_42' } }));
  await assert.rejects(adapter.generateText(request()), (error: Error) => {
    assert.match(error.message, /subscription_sharing_unsupported_capability/);
    assert.match(error.message, /reasoning\.effort/);
    assert.match(error.message, /req_pcc_test_42/);
    assert.doesNotMatch(error.message, /private provider detail|private admission detail/);
    return true;
  });
});

test('enforces input and streamed output byte bounds', async () => {
  const adapter = new ChatGptResponsesAdapter('local-token', async () => sse(
    { type: 'response.output_text.delta', delta: 'ééé' },
    { type: 'response.completed', response: {} },
  ));
  await assert.rejects(adapter.generateText(request({ input: 'too long', maxInputBytes: 2 })), /input.*byte/i);
  await assert.rejects(adapter.generateText(request({ maxOutputBytes: 5 })), /output.*byte/i);
});

test('propagates cancellation and never retries a failed request', async () => {
  let calls = 0;
  let observedSignal: AbortSignal | null | undefined;
  const adapter = new ChatGptResponsesAdapter('local-token', async (_input, init) => {
    calls += 1;
    observedSignal = init?.signal as AbortSignal;
    return new Promise<Response>((_resolve, reject) => {
      observedSignal?.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')), { once: true });
    });
  });
  const controller = new AbortController();
  const pending = adapter.generateText(request({ signal: controller.signal }));
  await new Promise((resolve) => setTimeout(resolve, 0));
  controller.abort();
  await assert.rejects(pending, /cancel/i);
  assert.equal(calls, 1);
  assert.equal(observedSignal?.aborted, true);
});

test('enforces the elapsed-time bound even if the transport ignores AbortSignal', async () => {
  let calls = 0;
  const adapter = new ChatGptResponsesAdapter('local-token', async () => {
    calls += 1;
    return new Promise<Response>(() => {});
  });
  await assert.rejects(adapter.generateText(request({ timeoutMs: 10 })), /time limit/i);
  assert.equal(calls, 1);
});

test('uses only allowlisted public API paths and rejects invalid request bounds', async () => {
  const urls: string[] = [];
  const adapter = new ChatGptResponsesAdapter('local-token', async (input) => {
    urls.push(String(input));
    return sse({ type: 'response.completed', response: {} });
  });
  await assert.rejects(adapter.generateText(request({ modelId: '   ' })), /model/i);
  await assert.rejects(adapter.generateText(request({ timeoutMs: 0 })), /timeout/i);
  await adapter.generateText(request());
  assert.deepEqual(urls, ['https://api.openai.com/v1/responses']);
});

test('does not call Responses for unverified model operations or reasoning controls', async () => {
  let calls = 0;
  const adapter = new ChatGptResponsesAdapter('local-token', async () => {
    calls += 1;
    return sse({ type: 'response.completed', response: {} });
  });
  await assert.rejects(adapter.generateText(request({ modelId: 'gpt-unmapped', operation: 'analyze' })), /no verified capability/i);
  await assert.rejects(adapter.generateText(request({ modelId: 'gpt-unmapped', reasoningLevel: 'high' })), /no verified capability|not verified/i);
  assert.equal(calls, 0);
});
