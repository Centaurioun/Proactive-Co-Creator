import assert from 'node:assert/strict';
import { createSign, generateKeyPairSync } from 'node:crypto';
import fs from 'node:fs/promises';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import express from 'express';
import { createApiRouter } from '../server/routes.ts';
import { createProviderHubRouter, type ProviderHubRouterOptions } from '../server/providerHubRoutes.ts';
import { ChatGptSessionStore } from '../server/auth/chatgpt/sessionStore.ts';
import { createChatGptAdapter, getChatGptModels, getPreferences, setChatGptModels, setOpenAiApiKey, setPersonalGeminiKey, setPreferences } from '../server/providers/runtime.ts';
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

test('default provider preferences can select a verified ChatGPT text model without enabling operations', async () => {
  const previousPreferences = getPreferences();
  const previousModels = getChatGptModels();
  try {
    setChatGptModels([describeChatGptModel({ id: 'gpt-6.2-sol', displayName: 'Sol' }, 'chatgpt-plan')]);
    await withServer(async (baseUrl) => {
      const response = await fetch(`${baseUrl}/api/ai/provider-hub/preferences`, {
        method: 'PUT', headers: { ...sameOrigin(baseUrl), 'content-type': 'application/json' },
        body: JSON.stringify({ preferences: { defaultConnectionId: 'chatgpt-plan', defaultTextModelId: 'gpt-6.2-sol', defaultReasoningLevel: 'default' } }),
      });
      assert.equal(response.status, 200, await response.clone().text());
      const saved = (await response.json() as { preferences: Record<string, unknown> }).preferences;
      assert.equal(saved.defaultConnectionId, 'chatgpt-plan');
      assert.equal(saved.defaultTextModelId, 'gpt-6.2-sol');

      const unconfiguredDefault = await fetch(`${baseUrl}/api/ai/provider-hub/preferences`, {
        method: 'PUT', headers: { ...sameOrigin(baseUrl), 'content-type': 'application/json' },
        body: JSON.stringify({ preferences: { defaultConnectionId: 'chatgpt-plan' } }),
      });
      assert.equal(unconfiguredDefault.status, 200, await unconfiguredDefault.clone().text());
      assert.equal((await unconfiguredDefault.json() as { preferences: Record<string, unknown> }).preferences.defaultTextModelId, undefined);

      const unsupported = await fetch(`${baseUrl}/api/ai/provider-hub/preferences`, {
        method: 'PUT', headers: { ...sameOrigin(baseUrl), 'content-type': 'application/json' },
        body: JSON.stringify({ preferences: { defaultConnectionId: 'chatgpt-plan', defaultTextModelId: 'gpt-6-luna' } }),
      });
      assert.equal(unsupported.status, 400);
      assert.match(await unsupported.text(), /currently verified text model/i);
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

test('ChatGPT Story override accepts only the saved GPT-6 Luna and Default combination', async () => {
  const previousPreferences = getPreferences();
  const previousModels = getChatGptModels();
  try {
    setChatGptModels([describeChatGptModel({ id: 'gpt-6-luna', displayName: 'GPT-6 Luna' }, 'chatgpt-plan')]);
    await withServer(async (baseUrl) => {
      const save = (reasoningLevel: string) => fetch(`${baseUrl}/api/ai/provider-hub/preferences`, {
        method: 'PUT', headers: { ...sameOrigin(baseUrl), 'content-type': 'application/json' },
        body: JSON.stringify({ preferences: {
          defaultConnectionId: 'gemini-managed',
          preferredTextModelsByConnection: { 'chatgpt-plan': 'gpt-6-luna' },
          preferredReasoningLevelsByConnection: { 'chatgpt-plan': reasoningLevel },
          operationOverrides: { story: { connectionId: 'chatgpt-plan', modelId: 'gpt-6-luna', reasoningLevel: 'default' } },
        } }),
      });
      const qualified = await save('default');
      assert.equal(qualified.status, 200, await qualified.clone().text());
      const unqualified = await save('medium');
      assert.equal(unqualified.status, 400);
      assert.match(await unqualified.text(), /requires the saved GPT-6 Luna preference with Default reasoning/i);
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

test('W1-D01 & W1-D17: preferences accept polish (reject refine), validate standalone ChatGPT reasoning, and normalize stored shape', async () => {
  const previousPreferences = getPreferences();
  const previousModels = getChatGptModels();
  try {
    setChatGptModels([describeChatGptModel({ id: 'gpt-6-luna', displayName: 'GPT-6 Luna' }, 'chatgpt-plan')]);
    await withServer(async (baseUrl) => {
      const refineOverride = await fetch(`${baseUrl}/api/ai/provider-hub/preferences`, {
        method: 'PUT', headers: { ...sameOrigin(baseUrl), 'content-type': 'application/json' },
        body: JSON.stringify({ preferences: {
          defaultConnectionId: 'gemini-managed',
          operationOverrides: { refine: { connectionId: 'gemini-managed', modelId: 'gemini-4-hydrogen', reasoningLevel: 'default' } },
        } }),
      });
      assert.equal(refineOverride.status, 400);

      const reasoningWithoutModel = await fetch(`${baseUrl}/api/ai/provider-hub/preferences`, {
        method: 'PUT', headers: { ...sameOrigin(baseUrl), 'content-type': 'application/json' },
        body: JSON.stringify({ preferences: {
          defaultConnectionId: 'gemini-managed',
          preferredReasoningLevelsByConnection: { 'chatgpt-plan': 'high' },
        } }),
      });
      assert.equal(reasoningWithoutModel.status, 400);

      const withExtra = await fetch(`${baseUrl}/api/ai/provider-hub/preferences`, {
        method: 'PUT', headers: { ...sameOrigin(baseUrl), 'content-type': 'application/json' },
        body: JSON.stringify({ preferences: {
          defaultConnectionId: 'gemini-managed',
          preferredTextModelsByConnection: { 'chatgpt-plan': 'gpt-6-luna' },
          preferredReasoningLevelsByConnection: { 'chatgpt-plan': 'default' },
          operationOverrides: { story: { connectionId: 'chatgpt-plan', modelId: 'gpt-6-luna', reasoningLevel: 'default' } },
          unexpectedField: 'should-not-persist',
        } }),
      });
      assert.equal(withExtra.status, 200, await withExtra.clone().text());
      const saved = (await withExtra.json() as { preferences: Record<string, unknown> }).preferences;
      assert.equal('unexpectedField' in saved, false);
    });
  } finally {
    setChatGptModels(previousModels);
    setPreferences(previousPreferences);
  }
});

test('W1-D17: OAuth callback rejects Origin with userinfo', async () => {
  await withServer(async (baseUrl) => {
    const port = new URL(baseUrl).port;
    const res = await fetch(`${baseUrl}/api/ai/provider-hub/auth/callback?state=missing`, {
      headers: { origin: `http://evil@127.0.0.1:${port}` },
    });
    assert.equal(res.status, 403);
  });
});

test('W1-D05 (R11): isolated host identity repairs malformed hostId, OAuth callback registers adapter factory, and duplicate callback cannot clobber winner', async () => {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'pcc-provider-hub-test-'));
  const identityFilePath = path.join(tmpDir, 'host-identity.json');
  await fs.writeFile(identityFilePath, JSON.stringify({ hostId: '', issuedClientId: 123 }), 'utf8');
  const originalHome = process.env.HOME;
  const originalFetch = globalThis.fetch;
  process.env.HOME = tmpDir;

  const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
  const jwk = { ...publicKey.export({ format: 'jwk' }), kid: 'test-key', use: 'sig', alg: 'RS256' };
  const sessionStore = new ChatGptSessionStore();
  let releaseTokenExchange!: () => void;
  let markTokenExchangeStarted!: () => void;
  const tokenExchangeStarted = new Promise<void>(resolve => { markTokenExchangeStarted = resolve; });
  let expectedNonce = '';

  const oauthFetch: typeof fetch = async (input, init) => {
    const url = String(input);
    if (url.endsWith('/.well-known/openid-configuration')) {
      return new Response(JSON.stringify({
        issuer: 'https://auth.openai.com',
        authorization_endpoint: 'https://auth.openai.com/oauth/authorize',
        token_endpoint: 'https://auth.openai.com/oauth/token',
        jwks_uri: 'https://auth.openai.com/.well-known/jwks.json',
        response_types_supported: ['code'],
        code_challenge_methods_supported: ['S256'],
      }), { status: 200, headers: { 'content-type': 'application/json' } });
    }
    if (url.endsWith('/api/accounts/oauth/token')) {
      markTokenExchangeStarted();
      await new Promise<void>(resolve => { releaseTokenExchange = resolve; });
      const body = new URLSearchParams(String(init?.body ?? ''));
      const clientId = body.get('client_id') ?? 'oaiapp_test';
      const nowSec = Math.floor(Date.now() / 1000);
      const header = Buffer.from(JSON.stringify({ alg: 'RS256', kid: 'test-key', typ: 'JWT' })).toString('base64url');
      const claims = Buffer.from(JSON.stringify({
        iss: 'https://auth.openai.com', sub: 'user-1', aud: clientId, exp: nowSec + 600, iat: nowSec, nonce: expectedNonce,
      })).toString('base64url');
      const signer = createSign('RSA-SHA256');
      signer.update(`${header}.${claims}`);
      signer.end();
      const idToken = `${header}.${claims}.${signer.sign(privateKey).toString('base64url')}`;
      return new Response(JSON.stringify({
        access_token: 'synthetic-access',
        refresh_token: 'synthetic-refresh',
        id_token: idToken,
        token_type: 'Bearer',
        expires_in: 3600,
        scope: 'openid profile email offline_access resource.invoke chatgpt.tokens.use.direct',
      }), { status: 200, headers: { 'content-type': 'application/json' } });
    }
    if (url.endsWith('/.well-known/jwks.json')) {
      return new Response(JSON.stringify({ keys: [jwk] }), { status: 200, headers: { 'content-type': 'application/json' } });
    }
    return originalFetch(input, init);
  };

  globalThis.fetch = oauthFetch;
  const app = express();
  app.use(express.json());
  app.use('/api/ai/provider-hub', createProviderHubRouter({
    sessionStore,
    disconnectSessionStore: sessionStore,
    identityFilePath,
    oauthFetch,
  } as ProviderHubRouterOptions));
  const server = http.createServer(app);
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  assert.ok(address && typeof address !== 'string');
  const baseUrl = `http://127.0.0.1:${address.port}`;

  try {
    const authRes = await originalFetch(`${baseUrl}/api/ai/provider-hub/chatgpt/authorize`, {
      method: 'POST', headers: sameOrigin(baseUrl),
    });
    assert.equal(authRes.status, 200);
    const { authorizationUrl } = await authRes.json() as { authorizationUrl: string };
    const authUrl = new URL(authorizationUrl);
    const state = authUrl.searchParams.get('state')!;
    expectedNonce = authUrl.searchParams.get('nonce')!;
    assert.match(authUrl.searchParams.get('ext_agent_host_id') ?? '', /^urn:uuid:/);

    const savedIdentity = JSON.parse(await fs.readFile(identityFilePath, 'utf8')) as { hostId: string; issuedClientId?: unknown };
    assert.match(savedIdentity.hostId, /^urn:uuid:/);
    assert.equal(savedIdentity.issuedClientId, undefined);

    const firstCallback = originalFetch(`${baseUrl}/api/ai/provider-hub/auth/callback?code=code-1&state=${encodeURIComponent(state)}&client_id=oaiapp_test`);
    await tokenExchangeStarted;
    const duplicateCallback = await originalFetch(`${baseUrl}/api/ai/provider-hub/auth/callback?code=code-2&state=${encodeURIComponent(state)}&client_id=oaiapp_test`);
    assert.equal(duplicateCallback.status, 400);
    releaseTokenExchange();
    const firstResult = await firstCallback;
    assert.equal(firstResult.status, 200);
    assert.equal(sessionStore.snapshot().connected, true);
    assert.doesNotThrow(() => createChatGptAdapter(sessionStore.getGeneration()));
  } finally {
    globalThis.fetch = originalFetch;
    process.env.HOME = originalHome;
    await new Promise<void>((resolve, reject) => server.close(err => err ? reject(err) : resolve()));
    await fs.rm(tmpDir, { recursive: true, force: true });
  }
});
