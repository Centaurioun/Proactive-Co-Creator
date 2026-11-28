import assert from 'node:assert/strict';
import test from 'node:test';
import * as apiClient from '../services/apiClient.ts';
import { ClientApiError, generateClarifications, generateImagesFromPrompt, generateStoryFromPrompt, invalidateAiProviderRequests, invalidateAiProviderRequestsForPreferenceChange, refinePromptWithAllUpdates } from '../services/apiClient.ts';

function installPreferences(raw: string | null) {
  Object.defineProperty(globalThis, 'window', {
    configurable: true,
    value: { localStorage: { getItem: () => raw, setItem: () => undefined, removeItem: () => undefined } },
  });
}

test('text follows the selected provider while images stay on the disclosed existing Gemini Managed route', async () => {
  const originalWindow = globalThis.window;
  const originalFetch = globalThis.fetch;
  installPreferences(JSON.stringify({ defaultConnectionId: 'chatgpt-plan', defaultTextModelId: 'gpt-6-luna' }));
  const calls: Array<{ url: string; connection: string | null; model: string | null }> = [];
  globalThis.fetch = async (input, init) => {
    const headers = new Headers(init?.headers);
    calls.push({ url: String(input), connection: headers.get('x-pcc-ai-connection'), model: headers.get('x-pcc-ai-model') });
    const isImage = String(input).endsWith('/api/generate/images');
    return new Response(JSON.stringify(isImage
      ? { images: [], requestedCount: 4, failedCount: 4, warning: 'Synthetic no-output response.' }
      : { clarifications: [] }), { status: 200, headers: { 'Content-Type': 'application/json' } });
  };
  try {
    await generateClarifications('A safe question prompt.', [], 'story');
    await generateImagesFromPrompt('A safe image prompt.');
    assert.deepEqual(calls, [
      { url: '/api/clarify', connection: 'chatgpt-plan', model: 'gpt-6-luna' },
      { url: '/api/generate/images', connection: 'gemini-managed', model: null },
    ]);
  } finally {
    globalThis.fetch = originalFetch;
    Object.defineProperty(globalThis, 'window', { configurable: true, value: originalWindow });
  }
});

test('a saved ChatGPT preference does not change active provider routing or start inference', async () => {
  const originalWindow = globalThis.window;
  const originalFetch = globalThis.fetch;
  installPreferences(JSON.stringify({
    defaultConnectionId: 'gemini-managed',
    preferredTextModelsByConnection: { 'chatgpt-plan': 'gpt-6-luna' },
    preferredReasoningLevelsByConnection: { 'chatgpt-plan': 'medium' },
  }));
  const calls: Array<{ connection: string | null; model: string | null; reasoning: string | null }> = [];
  globalThis.fetch = async (_input, init) => {
    const headers = new Headers(init?.headers);
    calls.push({
      connection: headers.get('x-pcc-ai-connection'),
      model: headers.get('x-pcc-ai-model'),
      reasoning: headers.get('x-pcc-ai-reasoning'),
    });
    return new Response(JSON.stringify({ clarifications: [] }), { status: 200, headers: { 'Content-Type': 'application/json' } });
  };
  try {
    await generateClarifications('A safe question prompt.', [], 'story');
    assert.deepEqual(calls, [{ connection: 'gemini-managed', model: null, reasoning: null }]);
  } finally {
    globalThis.fetch = originalFetch;
    Object.defineProperty(globalThis, 'window', { configurable: true, value: originalWindow });
  }
});

test('normal Story uses the saved ChatGPT default with Use default, exact model and stable action identity', async () => {
  const originalWindow = globalThis.window;
  const originalFetch = globalThis.fetch;
  installPreferences(JSON.stringify({
    defaultConnectionId: 'chatgpt-plan', defaultTextModelId: 'gpt-6-luna', defaultReasoningLevel: 'default',
    preferredTextModelsByConnection: { 'chatgpt-plan': 'gpt-6-luna' },
    preferredReasoningLevelsByConnection: { 'chatgpt-plan': 'default' },
    operationOverrides: {},
  }));
  const calls: Array<{ connection: string | null; model: string | null; reasoning: string | null; requestId: string | null }> = [];
  globalThis.fetch = async (_input, init) => {
    const headers = new Headers(init?.headers);
    calls.push({ connection: headers.get('x-pcc-ai-connection'), model: headers.get('x-pcc-ai-model'), reasoning: headers.get('x-pcc-ai-reasoning'), requestId: headers.get('x-pcc-story-request-id') });
    return new Response(JSON.stringify({ story: 'Synthetic story.' }), { status: 200, headers: { 'Content-Type': 'application/json' } });
  };
  try {
    assert.deepEqual(await generateStoryFromPrompt('A safe synthetic story.', undefined, 'ui-story-action-0001'), { story: 'Synthetic story.' });
    assert.deepEqual(calls, [{ connection: 'chatgpt-plan', model: 'gpt-6-luna', reasoning: null, requestId: 'ui-story-action-0001' }]);
  } finally {
    globalThis.fetch = originalFetch;
    Object.defineProperty(globalThis, 'window', { configurable: true, value: originalWindow });
  }
});

test('normal Story gives an explicit provider override precedence over the saved default', async () => {
  const originalWindow = globalThis.window;
  const originalFetch = globalThis.fetch;
  installPreferences(JSON.stringify({
    defaultConnectionId: 'chatgpt-plan', defaultTextModelId: 'gpt-6-luna', defaultReasoningLevel: 'default',
    operationOverrides: { story: { connectionId: 'gemini-managed', modelId: 'gemini-4-hydrogen', reasoningLevel: 'default' } },
  }));
  let selectedConnection: string | null = null;
  globalThis.fetch = async (_input, init) => {
    selectedConnection = new Headers(init?.headers).get('x-pcc-ai-connection');
    return new Response(JSON.stringify({ story: 'Synthetic Gemini override.' }), { status: 200, headers: { 'Content-Type': 'application/json' } });
  };
  try {
    await generateStoryFromPrompt('Synthetic story.', undefined, 'ui-story-action-0002');
    assert.equal(selectedConnection, 'gemini-managed');
  } finally {
    globalThis.fetch = originalFetch;
    Object.defineProperty(globalThis, 'window', { configurable: true, value: originalWindow });
  }
});

test('normal Story forwards documented ChatGPT non-default reasoning with exact model and action identity', async () => {
  const originalWindow = globalThis.window;
  const originalFetch = globalThis.fetch;
  installPreferences(JSON.stringify({ defaultConnectionId: 'chatgpt-plan', defaultTextModelId: 'gpt-6-luna', defaultReasoningLevel: 'medium' }));
  let observedHeaders: Headers | undefined;
  globalThis.fetch = async (_input, init) => {
    observedHeaders = new Headers(init?.headers);
    return new Response(JSON.stringify({ story: 'Medium reasoning story.' }), { status: 200, headers: { 'Content-Type': 'application/json' } });
  };
  try {
    const res = await generateStoryFromPrompt('Synthetic story.', undefined, 'ui-story-action-0003');
    assert.equal(res.story, 'Medium reasoning story.');
    assert.equal(observedHeaders?.get('x-pcc-ai-connection'), 'chatgpt-plan');
    assert.equal(observedHeaders?.get('x-pcc-ai-model'), 'gpt-6-luna');
    assert.equal(observedHeaders?.get('x-pcc-ai-reasoning'), 'medium');
    assert.equal(observedHeaders?.get('x-pcc-story-request-id'), 'ui-story-action-0003');
  } finally {
    globalThis.fetch = originalFetch;
    Object.defineProperty(globalThis, 'window', { configurable: true, value: originalWindow });
  }
});

test('normal Story rejects an incomplete ChatGPT default instead of silently selecting a model', async () => {
  const originalWindow = globalThis.window;
  const originalFetch = globalThis.fetch;
  installPreferences(JSON.stringify({ defaultConnectionId: 'chatgpt-plan' }));
  let calls = 0;
  globalThis.fetch = async () => { calls += 1; return new Response('{}', { status: 200 }); };
  try {
    await assert.rejects(() => generateStoryFromPrompt('Synthetic story.', undefined, 'ui-story-action-0004'), /Choose an account model explicitly/);
    assert.equal(calls, 0);
  } finally {
    globalThis.fetch = originalFetch;
    Object.defineProperty(globalThis, 'window', { configurable: true, value: originalWindow });
  }
});

test('passive preference writes preserve active Gemini requests while same-tab and cross-tab execution changes cancel them', async () => {
  const originalWindow = globalThis.window;
  const originalFetch = globalThis.fetch;
  let raw = JSON.stringify({ defaultConnectionId: 'gemini-managed' });
  let storageListener: ((event: { key: string; oldValue: string | null; newValue: string | null }) => void) | undefined;
  Object.defineProperty(globalThis, 'window', { configurable: true, value: {
    localStorage: { getItem: () => raw, setItem: (_key: string, value: string) => { raw = value; }, removeItem: () => undefined },
    addEventListener: (name: string, listener: typeof storageListener) => { if (name === 'storage') storageListener = listener; },
  } });
    const signals: AbortSignal[] = [];
  globalThis.fetch = async (_input, init) => new Promise<Response>((resolve, reject) => {
    const signal = init?.signal as AbortSignal;
    signals.push(signal);
    signal.addEventListener('abort', () => reject(signal.reason), { once: true });
    setTimeout(() => resolve(new Response(JSON.stringify({ clarifications: [] }), { status: 200, headers: { 'Content-Type': 'application/json' } })), 20);
  });
  try {
    const first = generateClarifications('A safe question prompt.', [], 'story');
    await new Promise(resolve => setTimeout(resolve, 0));
    const passive = JSON.stringify({ defaultConnectionId: 'gemini-managed', preferredTextModelsByConnection: { 'chatgpt-plan': 'gpt-6-luna' } });
    invalidateAiProviderRequestsForPreferenceChange(raw, passive);
    raw = passive;
    storageListener?.({ key: 'pcc.ai.providerPreferences.v1', oldValue: null, newValue: passive });
    assert.equal(signals[0]?.aborted, false);
    await first;

    const second = generateClarifications('A second safe question prompt.', [], 'story');
    await new Promise(resolve => setTimeout(resolve, 0));
    const execution = JSON.stringify({ defaultConnectionId: 'gemini-managed', operationOverrides: { story: { connectionId: 'gemini-managed', modelId: 'gemini-4-hydrogen', reasoningLevel: 'default' } }, preferredTextModelsByConnection: { 'chatgpt-plan': 'gpt-6-luna' } });
    storageListener?.({ key: 'pcc.ai.providerPreferences.v1', oldValue: passive, newValue: execution });
    await assert.rejects(second, (error: unknown) => error instanceof DOMException && error.name === 'AbortError');
    assert.equal(signals[1]?.aborted, true);

    const third = generateClarifications('A third safe question prompt.', [], 'story');
    await new Promise(resolve => setTimeout(resolve, 0));
    const changed = JSON.stringify({ defaultConnectionId: 'gemini-managed', operationOverrides: { story: { connectionId: 'chatgpt-plan', modelId: 'gpt-6-luna', reasoningLevel: 'default' } }, preferredTextModelsByConnection: { 'chatgpt-plan': 'gpt-6-luna' } });
    invalidateAiProviderRequestsForPreferenceChange(execution, changed);
    await assert.rejects(third, (error: unknown) => error instanceof DOMException && error.name === 'AbortError');
  } finally {
    globalThis.fetch = originalFetch;
    Object.defineProperty(globalThis, 'window', { configurable: true, value: originalWindow });
  }
});

test('malformed saved preferences fail before any provider request', async () => {
  const originalWindow = globalThis.window;
  const originalFetch = globalThis.fetch;
  installPreferences('{broken');
  let dispatched = false;
  globalThis.fetch = async () => { dispatched = true; return new Response('{}'); };
  try {
    await assert.rejects(generateClarifications('A safe question prompt.', [], 'story'), /preferences are invalid/i);
    assert.equal(dispatched, false);
  } finally {
    globalThis.fetch = originalFetch;
    Object.defineProperty(globalThis, 'window', { configurable: true, value: originalWindow });
  }
});

test('provider preference changes abort pending requests so stale responses cannot be applied', async () => {
  const originalWindow = globalThis.window;
  const originalFetch = globalThis.fetch;
  installPreferences(JSON.stringify({ defaultConnectionId: 'gemini-managed' }));
  let observedSignal: AbortSignal | undefined;
  globalThis.fetch = async (_input, init) => new Promise<Response>((_resolve, reject) => {
    observedSignal = init?.signal as AbortSignal | undefined;
    observedSignal?.addEventListener('abort', () => reject(observedSignal?.reason), { once: true });
  });
  try {
    const pending = generateClarifications('A safe question prompt.', [], 'story');
    await new Promise(resolve => setTimeout(resolve, 0));
    invalidateAiProviderRequests();
    await assert.rejects(pending, (error: unknown) => error instanceof DOMException && error.name === 'AbortError');
    assert.equal(observedSignal?.aborted, true);
  } finally {
    globalThis.fetch = originalFetch;
    Object.defineProperty(globalThis, 'window', { configurable: true, value: originalWindow });
  }
});

test('W1-D03 (R06): image provider override error is preserved instead of masked as invalid preferences', async () => {
  const originalWindow = globalThis.window;
  const originalFetch = globalThis.fetch;
  installPreferences(JSON.stringify({
    defaultConnectionId: 'gemini-managed',
    operationOverrides: { image: { connectionId: 'gemini-personal', modelId: 'imagen-test' } },
  }));
  let calls = 0;
  globalThis.fetch = async () => { calls += 1; return new Response('{}', { status: 200 }); };
  try {
    await assert.rejects(generateImagesFromPrompt('A safe image prompt.'), /Image provider overrides are unavailable/);
    assert.equal(calls, 0);
  } finally {
    globalThis.fetch = originalFetch;
    Object.defineProperty(globalThis, 'window', { configurable: true, value: originalWindow });
  }
});

test('W1-D03 (R06): refinePromptWithAllUpdates reads polish operation override', async () => {
  const originalWindow = globalThis.window;
  const originalFetch = globalThis.fetch;
  installPreferences(JSON.stringify({
    defaultConnectionId: 'gemini-managed',
    operationOverrides: { polish: { connectionId: 'openai-api', modelId: 'gpt-6.2-sol', reasoningLevel: 'low' } },
  }));
  let observedHeaders: Headers | undefined;
  globalThis.fetch = async (_input, init) => {
    observedHeaders = new Headers(init?.headers);
    return new Response(JSON.stringify({ refinedPrompt: 'Polished.' }), { status: 200, headers: { 'content-type': 'application/json' } });
  };
  try {
    await refinePromptWithAllUpdates('Original prompt', [], []);
    assert.equal(observedHeaders?.get('x-pcc-ai-connection'), 'openai-api');
    assert.equal(observedHeaders?.get('x-pcc-ai-model'), 'gpt-6.2-sol');
    assert.equal(observedHeaders?.get('x-pcc-ai-reasoning'), 'low');
  } finally {
    globalThis.fetch = originalFetch;
    Object.defineProperty(globalThis, 'window', { configurable: true, value: originalWindow });
  }
});

test('W1-D03 (R06): localStorage.clear() (key: null) aborts pending requests even on a swapped window object', async () => {
  const originalWindow = globalThis.window;
  const originalFetch = globalThis.fetch;
  const raw = JSON.stringify({ defaultConnectionId: 'gemini-managed' });
  let storageListener: ((event: { key: string | null; oldValue: string | null; newValue: string | null }) => void) | undefined;
  Object.defineProperty(globalThis, 'window', {
    configurable: true,
    value: {
      localStorage: { getItem: () => raw, setItem: () => undefined, removeItem: () => undefined },
      addEventListener: (name: string, listener: typeof storageListener) => { if (name === 'storage') storageListener = listener; },
    },
  });
  let observedSignal: AbortSignal | undefined;
  globalThis.fetch = async (_input, init) => new Promise<Response>((_resolve, reject) => {
    observedSignal = init?.signal as AbortSignal;
    observedSignal.addEventListener('abort', () => reject(observedSignal?.reason), { once: true });
  });
  try {
    const pending = generateClarifications('A safe question prompt.', [], 'story');
    await new Promise(resolve => setTimeout(resolve, 0));
    assert.ok(storageListener, 'storage listener must attach to the current window');
    storageListener({ key: null, oldValue: null, newValue: null });
    await assert.rejects(pending, (error: unknown) => error instanceof DOMException && error.name === 'AbortError');
    assert.equal(observedSignal?.aborted, true);
  } finally {
    globalThis.fetch = originalFetch;
    Object.defineProperty(globalThis, 'window', { configurable: true, value: originalWindow });
  }
});

test('W1-D04 (R03): tryGetEffectiveStoryProviderSelection returns structured error without throwing on invalid or unreadable storage', () => {
  const originalWindow = globalThis.window;
  const helper = (apiClient as Record<string, unknown>).tryGetEffectiveStoryProviderSelection as
    | (() => { ok: true; selection: { connectionId: string } } | { ok: false; error: { code: string } })
    | undefined;
  assert.equal(typeof helper, 'function');
  try {
    installPreferences('{broken');
    const badJson = helper!();
    assert.equal(badJson.ok, false);
    if (!badJson.ok) assert.equal(badJson.error.code, 'VALIDATION_ERROR');

    Object.defineProperty(globalThis, 'window', {
      configurable: true,
      value: { localStorage: { getItem: () => { throw new DOMException('blocked', 'SecurityError'); } } },
    });
    const blocked = helper!();
    assert.equal(blocked.ok, false);
    if (!blocked.ok) assert.equal(blocked.error.code, 'UPSTREAM_ERROR');
  } finally {
    Object.defineProperty(globalThis, 'window', { configurable: true, value: originalWindow });
  }
});

test('W6-D01: caller abort while awaiting response.json() surfaces CANCELLED instead of returning stale data or INVALID_RESPONSE', async () => {
  const originalWindow = globalThis.window;
  const originalFetch = globalThis.fetch;
  installPreferences(JSON.stringify({ defaultConnectionId: 'gemini-managed' }));

  const callerAbortOnResolve = new AbortController();
  const callerAbortOnReject = new AbortController();
  let mode: 'resolve' | 'reject' = 'resolve';

  globalThis.fetch = async () => {
    const controller = mode === 'resolve' ? callerAbortOnResolve : callerAbortOnReject;
    return {
      ok: true,
      status: 200,
      json: async () => {
        controller.abort();
        if (mode === 'reject') {
          throw new DOMException('Body stream aborted', 'AbortError');
        }
        return { clarifications: [] };
      },
    } as unknown as Response;
  };

  try {
    mode = 'resolve';
    await assert.rejects(
      generateClarifications('A safe question prompt.', [], 'story', callerAbortOnResolve.signal),
      (error: unknown) => error instanceof ClientApiError && error.code === 'CANCELLED',
    );

    mode = 'reject';
    await assert.rejects(
      generateClarifications('A safe question prompt.', [], 'story', callerAbortOnReject.signal),
      (error: unknown) => error instanceof ClientApiError && error.code === 'CANCELLED',
    );
  } finally {
    globalThis.fetch = originalFetch;
    Object.defineProperty(globalThis, 'window', { configurable: true, value: originalWindow });
  }
});
