import assert from 'node:assert/strict';
import test from 'node:test';
import { generateClarifications, generateImagesFromPrompt, invalidateAiProviderRequests } from '../services/apiClient.ts';

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
