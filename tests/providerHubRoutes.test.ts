import assert from 'node:assert/strict';
import http from 'node:http';
import test from 'node:test';
import express from 'express';
import { createApiRouter } from '../server/routes.ts';
import { createProviderHubRouter } from '../server/providerHubRoutes.ts';
import { ChatGptSessionStore } from '../server/auth/chatgpt/sessionStore.ts';
import { getChatGptModels, getPreferences, setChatGptModels, setOpenAiApiKey, setPersonalGeminiKey, setPreferences } from '../server/providers/runtime.ts';
import { describeChatGptModel } from '../server/providers/policy.ts';
import { setSessionGeminiKey } from '../server/geminiClient.ts';

async function withServer<T>(run: (baseUrl: string) => Promise<T>): Promise<T> {
  const app = express();
  app.use(express.json());
  app.use('/api', createApiRouter());
  const server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Failed to bind provider hub test server.');
  try { return await run(`http://127.0.0.1:${address.port}`); }
  finally { await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve())); }
}

function sameOrigin(baseUrl: string): HeadersInit {
  return { origin: baseUrl, 'sec-fetch-site': 'same-origin' };
}

test('provider settings are loopback and same-origin guarded and keep personal keys session-only', async () => {
  setPersonalGeminiKey(undefined);
  setSessionGeminiKey(undefined);
  try {
    await withServer(async (baseUrl) => {
      const status = await fetch(`${baseUrl}/api/ai/provider-hub/status`);
      assert.equal(status.status, 200);
      assert.equal((await status.json() as { localPersonalConnectionsAvailable: boolean }).localPersonalConnectionsAvailable, true);

      const crossOrigin = await fetch(`${baseUrl}/api/ai/provider-hub/gemini-key`, {
        method: 'POST', headers: { 'content-type': 'application/json', origin: 'https://attacker.example' },
        body: JSON.stringify({ apiKey: 'synthetic-not-a-real-provider-key-1234' }),
      });
      assert.equal(crossOrigin.status, 403);

      const setKey = await fetch(`${baseUrl}/api/ai/provider-hub/gemini-key`, {
        method: 'POST', headers: { ...sameOrigin(baseUrl), 'content-type': 'application/json' },
        body: JSON.stringify({ apiKey: 'synthetic-not-a-real-provider-key-1234' }),
      });
      assert.equal(setKey.status, 200);
      assert.deepEqual(await setKey.json(), { acceptedForThisSession: true, persistentStorage: false });

      const removeKey = await fetch(`${baseUrl}/api/ai/provider-hub/gemini-key`, {
        method: 'DELETE', headers: sameOrigin(baseUrl),
      });
      assert.deepEqual(await removeKey.json(), { cleared: true });

      const unavailableCatalog = await fetch(`${baseUrl}/api/ai/provider-hub/models?connectionId=gemini-personal`);
      assert.equal(unavailableCatalog.status, 503);
      assert.match((await unavailableCatalog.text()), /Enter a Gemini API key/);
    });
  } finally {
    setPersonalGeminiKey(undefined);
    setSessionGeminiKey(undefined);
  }
});

test('preference routes reject disabled billing and unqualified image overrides', async () => {
  const previous = getPreferences();
  try {
    await withServer(async (baseUrl) => {
      const disabledDefault = await fetch(`${baseUrl}/api/ai/provider-hub/preferences`, {
        method: 'PUT', headers: { ...sameOrigin(baseUrl), 'content-type': 'application/json' },
        body: JSON.stringify({ preferences: { defaultConnectionId: 'openai-api' } }),
      });
      assert.equal(disabledDefault.status, 400);

      const imageOverride = await fetch(`${baseUrl}/api/ai/provider-hub/preferences`, {
        method: 'PUT', headers: { ...sameOrigin(baseUrl), 'content-type': 'application/json' },
        body: JSON.stringify({ preferences: {
          defaultConnectionId: 'gemini-managed',
          operationOverrides: { image: { connectionId: 'gemini-personal', modelId: 'imagen-test' } },
        } }),
      });
      assert.equal(imageOverride.status, 400);
    });
  } finally {
    setPreferences(previous);
  }
});

test('preference routes reject ChatGPT models with no effective PCC operation capability', async () => {
  const previousPreferences = getPreferences();
  const previousModels = getChatGptModels();
  try {
    setChatGptModels([describeChatGptModel({ id: 'gpt-6.2-sol', displayName: 'Sol' }, 'chatgpt-plan')]);
    await withServer(async (baseUrl) => {
      const response = await fetch(`${baseUrl}/api/ai/provider-hub/preferences`, {
        method: 'PUT', headers: { ...sameOrigin(baseUrl), 'content-type': 'application/json' },
        body: JSON.stringify({ preferences: { defaultConnectionId: 'chatgpt-plan', defaultTextModelId: 'gpt-6.2-sol' } }),
      });
      assert.equal(response.status, 400);
      assert.match(await response.text(), /not verified for an available PCC operation/i);
    });
  } finally {
    setChatGptModels(previousModels);
    setPreferences(previousPreferences);
  }
});

test('ChatGPT text-model preferences are saved independently from active routing eligibility', async () => {
  const previousPreferences = getPreferences();
  const previousModels = getChatGptModels();
  try {
    setChatGptModels([describeChatGptModel({ id: 'gpt-6-luna', displayName: 'GPT-6 Luna' }, 'chatgpt-plan')]);
    await withServer(async (baseUrl) => {
      const response = await fetch(`${baseUrl}/api/ai/provider-hub/preferences`, {
        method: 'PUT', headers: { ...sameOrigin(baseUrl), 'content-type': 'application/json' },
        body: JSON.stringify({ preferences: {
          defaultConnectionId: 'gemini-managed',
          preferredTextModelsByConnection: { 'chatgpt-plan': 'gpt-6-luna' },
          preferredReasoningLevelsByConnection: { 'chatgpt-plan': 'medium' },
        } }),
      });
      assert.equal(response.status, 200, await response.clone().text());
      const saved = (await response.json() as { preferences: Record<string, unknown> }).preferences;
      assert.equal(saved.defaultConnectionId, 'gemini-managed');
      assert.deepEqual(saved.preferredTextModelsByConnection, { 'chatgpt-plan': 'gpt-6-luna' });
      assert.deepEqual(saved.preferredReasoningLevelsByConnection, { 'chatgpt-plan': 'medium' });

      const status = await fetch(`${baseUrl}/api/ai/provider-hub/status`, { headers: sameOrigin(baseUrl) });
      const reloaded = (await status.json() as { preferences: Record<string, unknown> }).preferences;
      assert.equal(reloaded.defaultConnectionId, 'gemini-managed');
      assert.deepEqual(reloaded.preferredTextModelsByConnection, { 'chatgpt-plan': 'gpt-6-luna' });
      assert.deepEqual(reloaded.preferredReasoningLevelsByConnection, { 'chatgpt-plan': 'medium' });

      const invalid = await fetch(`${baseUrl}/api/ai/provider-hub/preferences`, {
        method: 'PUT', headers: { ...sameOrigin(baseUrl), 'content-type': 'application/json' },
        body: JSON.stringify({ preferences: {
          defaultConnectionId: 'gemini-managed',
          preferredTextModelsByConnection: { 'openai-api': 'gpt-6-luna' },
        } }),
      });
      assert.equal(invalid.status, 400);
    });
  } finally {
    setChatGptModels(previousModels);
    setPreferences(previousPreferences);
  }
});

test('OpenAI API key management is local-only, session-only, and makes no provider request', async () => {
  setOpenAiApiKey(undefined);
  try {
    await withServer(async (baseUrl) => {
      const crossOrigin = await fetch(`${baseUrl}/api/ai/provider-hub/openai-api-key`, {
        method: 'POST', headers: { 'content-type': 'application/json', origin: 'https://attacker.example' },
        body: JSON.stringify({ apiKey: 'synthetic-openai-key-for-provider-hub-tests' }),
      });
      assert.equal(crossOrigin.status, 403);

      const setKey = await fetch(`${baseUrl}/api/ai/provider-hub/openai-api-key`, {
        method: 'POST', headers: { ...sameOrigin(baseUrl), 'content-type': 'application/json' },
        body: JSON.stringify({ apiKey: 'synthetic-openai-key-for-provider-hub-tests' }),
      });
      assert.deepEqual(await setKey.json(), { acceptedForThisSession: true, persistentStorage: false });
      const status = await fetch(`${baseUrl}/api/ai/provider-hub/status`, { headers: sameOrigin(baseUrl) });
      const body = await status.text();
      assert.match(body, /"id":"openai-api","family":"openai","billing":"openai-api-key","state":"available"/);
      assert.doesNotMatch(body, /synthetic-openai-key-for-provider-hub-tests/);

      const remove = await fetch(`${baseUrl}/api/ai/provider-hub/openai-api-key`, { method: 'DELETE', headers: sameOrigin(baseUrl) });
      assert.deepEqual(await remove.json(), { cleared: true });
      const afterRemove = await fetch(`${baseUrl}/api/ai/provider-hub/status`, { headers: sameOrigin(baseUrl) });
      assert.match(await afterRemove.text(), /"id":"openai-api","family":"openai","billing":"openai-api-key","state":"unconfigured"/);
    });
  } finally { setOpenAiApiKey(undefined); }
});

test('ChatGPT disconnect completes locally when issuer discovery has no revocation endpoint', async () => {
  const sessionStore = new ChatGptSessionStore({ fetch: async () => { throw new Error('revocation must not be sent'); } });
  sessionStore.install({ accessToken: 'synthetic-access', refreshToken: 'synthetic-refresh', expiresAt: Date.now() + 60_000, tokenType: 'Bearer' });
  let discoveryCalls = 0;
  const app = express();
  app.use(express.json());
  app.use('/api/ai/provider-hub', createProviderHubRouter({
    disconnectSessionStore: sessionStore,
    issuedClientId: () => 'synthetic-client-id',
    discoverOpenId: async () => { discoveryCalls += 1; return { revocation_endpoint: undefined } as never; },
  }));
  const server = http.createServer(app);
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  assert.ok(address && typeof address !== 'string');
  const baseUrl = `http://127.0.0.1:${address.port}`;
  try {
    const response = await fetch(`${baseUrl}/api/ai/provider-hub/chatgpt/disconnect`, { method: 'POST', headers: sameOrigin(baseUrl) });
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { clearedLocally: true, remoteRevocation: 'endpoint-unavailable' });
    assert.deepEqual(sessionStore.snapshot(), { connected: false });
    const repeated = await fetch(`${baseUrl}/api/ai/provider-hub/chatgpt/disconnect`, { method: 'POST', headers: sameOrigin(baseUrl) });
    assert.deepEqual(await repeated.json(), { clearedLocally: true, remoteRevocation: 'not-connected' });
    assert.equal(discoveryCalls, 1);
  } finally { await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve())); }
});

test('explicit ChatGPT selection without a verified catalog model fails before provider dispatch', async () => {
  await withServer(async (baseUrl) => {
    const response = await fetch(`${baseUrl}/api/analyze`, {
      method: 'POST',
      headers: {
        ...sameOrigin(baseUrl), 'content-type': 'application/json',
        'x-pcc-ai-connection': 'chatgpt-plan',
      },
      body: JSON.stringify({}),
    });
    assert.equal(response.status, 422);
    assert.match((await response.text()), /select a model|model list/i);
  });
});
