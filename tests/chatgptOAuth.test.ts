import test from 'node:test';
import assert from 'node:assert/strict';
import { createSign, generateKeyPairSync } from 'node:crypto';
import { ChatGptOAuthClient, CHATGPT_OAUTH_ISSUER, discoverOpenId, verifyIdToken } from '../server/auth/chatgpt/oauth.ts';
import { ChatGptSessionStore, createPkcePair, readTokenResponse } from '../server/auth/chatgpt/sessionStore.ts';
import { ChatGptResponsesAdapter } from '../server/providers/chatgptResponses.ts';

const CLIENT_ID = 'test-client';
const ISSUED_CLIENT_ID = 'oaiapp_test-client';
const OFFICIAL_ISSUER = 'https://auth.openai.com';
const REDIRECT = 'http://127.0.0.1:43129/auth/callback';
const fixedNow = () => 1_800_000_000_000;

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

function formBody(init?: RequestInit): URLSearchParams {
  return new URLSearchParams(String(init?.body ?? ''));
}

test('PKCE uses random verifier and S256 challenge', () => {
  const pair = createPkcePair();
  assert.match(pair.verifier, /^[A-Za-z0-9_-]{43}$/);
  assert.match(pair.challenge, /^[A-Za-z0-9_-]{43}$/);
  assert.notEqual(pair.verifier, pair.challenge);
});

test('token response parser accepts documented OAuth token fields and hides provider error bodies', async () => {
  const token = await readTokenResponse(jsonResponse({ access_token: 'raw-access', refresh_token: 'raw-refresh', id_token: 'raw-id', token_type: 'Bearer', expires_in: 3600, scope: 'openid' }), fixedNow);
  assert.deepEqual(token, { accessToken: 'raw-access', refreshToken: 'raw-refresh', idToken: 'raw-id', tokenType: 'Bearer', expiresAt: fixedNow() + 3_600_000, scope: 'openid' });
  await assert.rejects(() => readTokenResponse(jsonResponse({ error: 'invalid_grant', error_description: 'raw-secret' }, 400), fixedNow), (err: Error) => {
    assert.equal(err.message, 'OAuth token request failed.');
    assert.equal(err.message.includes('raw-secret'), false);
    return true;
  });
});

test('OpenID discovery rejects endpoints outside the fixed official host', async () => {
  await assert.rejects(() => discoverOpenId(async () => jsonResponse({
    issuer: OFFICIAL_ISSUER,
    authorization_endpoint: 'https://evil.example/authorize',
    token_endpoint: 'https://auth.openai.com/oauth/token',
    jwks_uri: 'https://auth.openai.com/.well-known/jwks.json',
  })), /untrusted endpoint/);
});

test('authorization code flow uses state, nonce, PKCE, verifies JWKS signature, and consumes state once', async () => {
  assert.equal(CHATGPT_OAUTH_ISSUER, OFFICIAL_ISSUER);
  const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
  const jwk = { ...publicKey.export({ format: 'jwk' }), kid: 'test-key', use: 'sig', alg: 'RS256' };
  let now = fixedNow();
  const seen: Array<{ url: string; init?: RequestInit }> = [];
  const mockFetch: typeof fetch = async (input, init) => {
    const url = String(input);
    seen.push({ url, init });
    if (url.endsWith('/.well-known/openid-configuration')) return jsonResponse({
      issuer: OFFICIAL_ISSUER,
      authorization_endpoint: 'https://auth.openai.com/oauth/authorize',
      token_endpoint: 'https://auth.openai.com/oauth/token',
      jwks_uri: 'https://auth.openai.com/.well-known/jwks.json',
      revocation_endpoint: 'https://auth.openai.com/oauth/revoke',
      response_types_supported: ['code'], code_challenge_methods_supported: ['S256'],
    });
    if (url.endsWith('/api/accounts/oauth/token')) {
      const body = formBody(init);
      assert.equal(body.get('grant_type'), 'authorization_code');
      assert.equal(body.get('client_id'), ISSUED_CLIENT_ID);
      assert.equal(body.get('redirect_uri'), REDIRECT);
      assert.ok(body.get('code_verifier'));
      const header = Buffer.from(JSON.stringify({ alg: 'RS256', kid: 'test-key', typ: 'JWT' })).toString('base64url');
      const claims = Buffer.from(JSON.stringify({ iss: OFFICIAL_ISSUER, sub: 'user-1', aud: ISSUED_CLIENT_ID, exp: Math.floor(now / 1000) + 600, iat: Math.floor(now / 1000), nonce: authorizationNonce })).toString('base64url');
      const signer = createSign('RSA-SHA256');
      signer.update(`${header}.${claims}`);
      signer.end();
      const idToken = `${header}.${claims}.${signer.sign(privateKey).toString('base64url')}`;
      return jsonResponse({ access_token: 'access-value', refresh_token: 'refresh-value', id_token: idToken, token_type: 'Bearer', expires_in: 3600, scope: 'openid profile email offline_access resource.invoke chatgpt.tokens.use.direct' });
    }
    if (url.endsWith('/.well-known/jwks.json')) return jsonResponse({ keys: [jwk] });
    throw new Error('unexpected mocked URL');
  };
  let authorizationNonce = '';
  const client = new ChatGptOAuthClient({ redirectUri: REDIRECT, extAgentHostId: 'urn:uuid:host-test', agentNameHint: 'Proactive Co-Creator', fetch: mockFetch, now: () => now });
  const request = await client.createAuthorizationRequest();
  const authUrl = new URL(request.url);
  authorizationNonce = authUrl.searchParams.get('nonce')!;
  assert.equal(authUrl.origin, 'https://auth.openai.com');
  assert.equal(authUrl.pathname, '/api/accounts/authorize');
  assert.equal(authUrl.searchParams.get('client_id'), 'dynamic_agent_client');
  assert.equal(authUrl.searchParams.get('agent_name_hint'), 'Proactive Co-Creator');
  assert.equal(authUrl.searchParams.get('ext_agent_host_id'), 'urn:uuid:host-test');
  assert.equal(authUrl.searchParams.get('resource'), 'https://api.openai.com/v1');
  const requestedScopes = authUrl.searchParams.get('scope')?.split(/\s+/) ?? [];
  assert.deepEqual(new Set(requestedScopes), new Set([
    'openid', 'profile', 'email', 'offline_access', 'resource.invoke', 'chatgpt.tokens.use.direct',
  ]));
  assert.equal(requestedScopes.length, new Set(requestedScopes).size);
  assert.equal(authUrl.searchParams.get('state'), request.state);
  assert.equal(authUrl.searchParams.get('code_challenge_method'), 'S256');
  assert.match(authUrl.searchParams.get('code_challenge') ?? '', /^[A-Za-z0-9_-]{43}$/);
  const result = await client.completeAuthorization({ code: 'one-time-code', state: request.state, clientId: ISSUED_CLIENT_ID });
  assert.equal(result.tokens.accessToken, 'access-value');
  assert.equal(result.claims.sub, 'user-1');
  assert.equal(result.clientId, ISSUED_CLIENT_ID);
  assert.equal(seen.some((x) => x.url.includes('evil.example')), false);
  await assert.rejects(() => client.completeAuthorization({ code: 'one-time-code', state: request.state }), /invalid or expired/);
  now += 1;
});

test('a stale OAuth callback cannot exchange a cancelled authorization state', async () => {
  let calls = 0;
  const client = new ChatGptOAuthClient({
    redirectUri: REDIRECT,
    extAgentHostId: 'urn:uuid:host-test',
    agentNameHint: 'Proactive Co-Creator',
    fetch: async (input) => {
      calls += 1;
      if (String(input).endsWith('/.well-known/openid-configuration')) return jsonResponse({
        issuer: OFFICIAL_ISSUER,
        authorization_endpoint: 'https://auth.openai.com/oauth/authorize',
        token_endpoint: 'https://auth.openai.com/oauth/token',
        jwks_uri: 'https://auth.openai.com/.well-known/jwks.json',
        response_types_supported: ['code'], code_challenge_methods_supported: ['S256'],
      });
      throw new Error('cancelled callback must not fetch');
    },
  });
  const request = await client.createAuthorizationRequest();
  assert.equal(client.cancelAuthorization(request.state), true);
  await assert.rejects(client.completeAuthorization({ code: 'late-code', state: request.state }), /invalid or expired/i);
  assert.equal(calls, 1);
});

test('session store serializes refresh, keeps rotated token, and clears in-memory session on restart', async () => {
  let calls = 0;
  const now = fixedNow();
  let resolveFetch!: (response: Response) => void;
  const pending = new Promise<Response>((resolve) => { resolveFetch = resolve; });
  const store = new ChatGptSessionStore({ now: () => now, refreshSkewMs: 1000, fetch: async (input, init) => {
    calls++;
    assert.equal(String(input), 'https://auth.openai.com/oauth/token');
    assert.equal(formBody(init).get('refresh_token'), 'old-refresh');
    return pending;
  } });
  store.install({ accessToken: 'old-access', refreshToken: 'old-refresh', expiresAt: now + 500, tokenType: 'Bearer' });
  const first = store.getAccessToken(CLIENT_ID, 'https://auth.openai.com/oauth/token');
  const second = store.getAccessToken(CLIENT_ID, 'https://auth.openai.com/oauth/token');
  resolveFetch(jsonResponse({ access_token: 'new-access', refresh_token: 'new-refresh', token_type: 'Bearer', expires_in: 3600 }));
  assert.deepEqual(await Promise.all([first, second]), ['new-access', 'new-access']);
  assert.equal(calls, 1);
  assert.equal(store.snapshot().connected, true);
  assert.equal(new ChatGptSessionStore({ now: () => now }).snapshot().connected, false);
});

test('successful token rotation preserves the authorized session epoch and active request authority', async () => {
  const now = fixedNow();
  const store = new ChatGptSessionStore({ now: () => now, refreshSkewMs: 1000, fetch: async () => jsonResponse({
    access_token: 'fresh-access', refresh_token: 'fresh-refresh', token_type: 'Bearer', expires_in: 3600,
  }) });
  store.install({ accessToken: 'expiring-access', refreshToken: 'old-refresh', expiresAt: now + 500, tokenType: 'Bearer' });
  const epoch = store.getGeneration();
  const rotationBefore = store.getTokenRotationVersion();
  const lease = store.createRequestLease(undefined, epoch);
  await store.getAccessToken(CLIENT_ID, 'https://auth.openai.com/oauth/token', epoch);
  assert.equal(store.getGeneration(), epoch);
  assert.equal(store.getTokenRotationVersion(), rotationBefore + 1);
  assert.equal(lease.signal.aborted, false);
  assert.equal(await store.getAccessToken(CLIENT_ID, 'https://auth.openai.com/oauth/token', epoch), 'fresh-access');
  lease.release();
});

test('a successful refresh can immediately serve inference and account catalog requests', async () => {
  const now = fixedNow();
  const store = new ChatGptSessionStore({ now: () => now, refreshSkewMs: 1000, fetch: async () => jsonResponse({
    access_token: 'rotated-access', refresh_token: 'rotated-refresh', expires_in: 3600, token_type: 'Bearer',
  }) });
  store.install({ accessToken: 'expired-access', refreshToken: 'before-refresh', expiresAt: now - 1, tokenType: 'Bearer' });
  const epoch = store.getGeneration();
  let inferenceLeaseWasLive = false;
  const adapter = new ChatGptResponsesAdapter(
    () => store.getAccessToken(CLIENT_ID, 'https://auth.openai.com/oauth/token', epoch),
    async (input, init) => {
      const url = String(input);
      assert.equal(new Headers(init?.headers).get('authorization'), 'Bearer rotated-access');
      if (url.endsWith('/models')) return Response.json({ models: [{ slug: 'gpt-6.2-sol', display_name: 'Sol', visibility: 'list' }] });
      inferenceLeaseWasLive = init?.signal?.aborted === false;
      return new Response([
        'event: response.output_text.delta\ndata: {"type":"response.output_text.delta","delta":"safe result"}\n\n',
        'event: response.completed\ndata: {"type":"response.completed","response":{}}\n\n',
      ].join(''), { headers: { 'content-type': 'text/event-stream' } });
    },
    signal => store.createRequestLease(signal, epoch),
  );
  const generated = await adapter.generateText({ operation: 'story', modelId: 'gpt-6.2-sol', input: 'synthetic', maxInputBytes: 100, maxOutputBytes: 100, timeoutMs: 1000 });
  assert.equal(generated.text, 'safe result');
  assert.equal(inferenceLeaseWasLive, true);
  assert.equal(store.getGeneration(), epoch);
  const models = await adapter.listModels();
  assert.deepEqual(models.map(model => model.id), ['gpt-6.2-sol']);
  assert.equal(store.getGeneration(), epoch);
});

test('clearing a session aborts in-flight provider request leases', () => {
  const store = new ChatGptSessionStore();
  store.install({ accessToken: 'access', refreshToken: 'refresh', expiresAt: fixedNow() + 10_000, tokenType: 'Bearer' });
  const lease = store.createRequestLease();
  assert.equal(lease.signal.aborted, false);
  store.clear();
  assert.equal(lease.signal.aborted, true);
  lease.release();
});

test('revocation retries bounded transient failures with documented form fields and clears local credentials first', async () => {
  let calls = 0;
  const waits: number[] = [];
  const store = new ChatGptSessionStore({ fetch: async (_input, init) => {
    assert.equal(formBody(init).get('token'), 'sensitive-refresh');
    assert.equal(formBody(init).get('token_type_hint'), 'refresh_token');
    assert.equal(formBody(init).get('client_id'), CLIENT_ID);
    assert.deepEqual(store.snapshot(), { connected: false });
    calls += 1;
    return jsonResponse({}, calls < 3 ? 503 : 200);
  }, maxRevocationAttempts: 3, revocationRetryBaseDelayMs: 125, wait: async ms => { waits.push(ms); } });
  store.install({ accessToken: 'sensitive-access', refreshToken: 'sensitive-refresh', expiresAt: fixedNow() + 10000, tokenType: 'Bearer' });
  const detached = store.takeForRevocation();
  assert.deepEqual(detached, { refreshToken: 'sensitive-refresh', generation: 2, tokenRotationVersion: 1, refreshInProgress: false });
  await store.revoke(CLIENT_ID, 'https://auth.openai.com/oauth/revoke', detached);
  assert.equal(calls, 3);
  assert.deepEqual(waits, [125, 250]);
  assert.deepEqual(store.snapshot(), { connected: false });
});

test('remote revocation retries bounded timeouts and then reports an unconfirmed result', async () => {
  let calls = 0;
  const store = new ChatGptSessionStore({ requestTimeoutMs: 5, maxRevocationAttempts: 2, revocationRetryBaseDelayMs: 50, wait: async () => {}, fetch: async (_input, init) => {
    calls += 1;
    return new Promise<Response>((_resolve, reject) => init?.signal?.addEventListener('abort', () => reject(new Error('transport aborted')), { once: true }));
  } });
  store.install({ accessToken: 'access', refreshToken: 'refresh', expiresAt: fixedNow() + 10000, tokenType: 'Bearer' });
  const detached = store.takeForRevocation();
  await assert.rejects(store.revoke(CLIENT_ID, 'https://auth.openai.com/oauth/revoke', detached), /could not be confirmed/i);
  assert.equal(calls, 2);
  assert.equal(store.snapshot().connected, false);
});

test('remote revocation rejection is not retried and does not expose provider detail', async () => {
  let calls = 0;
  const store = new ChatGptSessionStore({ wait: async () => {}, fetch: async () => {
    calls += 1;
    return jsonResponse({ error: 'secret-provider-detail' }, 400);
  } });
  store.install({ accessToken: 'access', refreshToken: 'refresh', expiresAt: fixedNow() + 10000, tokenType: 'Bearer' });
  await assert.rejects(store.revoke(CLIENT_ID, 'https://auth.openai.com/oauth/revoke'), (error: Error) => {
    assert.match(error.message, /could not be confirmed/i);
    assert.equal(error.message.includes('secret-provider-detail'), false);
    return true;
  });
  assert.equal(calls, 1);
  assert.equal(store.snapshot().connected, false);
});

test('late refresh completion cannot reinstall credentials after disconnect', async () => {
  let resolveFetch!: (response: Response) => void;
  const store = new ChatGptSessionStore({ now: fixedNow, refreshSkewMs: 1000, fetch: async () => new Promise<Response>(resolve => { resolveFetch = resolve; }) });
  store.install({ accessToken: 'old', refreshToken: 'refresh-old', expiresAt: fixedNow() - 1, tokenType: 'Bearer' });
  const pending = store.getAccessToken(CLIENT_ID, 'https://auth.openai.com/oauth/token');
  store.takeForRevocation();
  resolveFetch(jsonResponse({ access_token: 'late-access', refresh_token: 'late-refresh', expires_in: 3600, token_type: 'Bearer' }));
  await assert.rejects(pending, /temporarily unavailable/i);
  assert.equal(store.snapshot().connected, false);
});

test('disconnect immediately aborts an in-flight refresh request', async () => {
  let refreshSignal: AbortSignal | undefined;
  const store = new ChatGptSessionStore({ now: fixedNow, refreshSkewMs: 1000, fetch: async (_input, init) => new Promise<Response>((_resolve, reject) => {
    refreshSignal = init?.signal as AbortSignal;
    refreshSignal.addEventListener('abort', () => reject(new Error('refresh aborted')), { once: true });
  }) });
  store.install({ accessToken: 'old', refreshToken: 'refresh-old', expiresAt: fixedNow() - 1, tokenType: 'Bearer' });
  const pending = store.getAccessToken(CLIENT_ID, 'https://auth.openai.com/oauth/token');
  await new Promise<void>(resolve => setImmediate(resolve));
  store.takeForRevocation();
  assert.equal(refreshSignal?.aborted, true);
  await assert.rejects(pending, /temporarily unavailable/i);
  assert.equal(store.snapshot().connected, false);
});

test('disconnect during refresh clears locally and does not claim remote revocation', async () => {
  let resolveFetch!: (response: Response) => void;
  let calls = 0;
  const store = new ChatGptSessionStore({ now: fixedNow, refreshSkewMs: 1000, fetch: async () => {
    calls += 1;
    return new Promise<Response>(resolve => { resolveFetch = resolve; });
  } });
  store.install({ accessToken: 'old', refreshToken: 'refresh-old', expiresAt: fixedNow() - 1, tokenType: 'Bearer' });
  const pendingRefresh = store.getAccessToken(CLIENT_ID, 'https://auth.openai.com/oauth/token');
  const detached = store.takeForRevocation();
  await assert.rejects(store.revoke(CLIENT_ID, 'https://auth.openai.com/oauth/revoke', detached), /could not be confirmed while token refresh was in flight/i);
  resolveFetch(jsonResponse({ access_token: 'late', refresh_token: 'rotated', expires_in: 3600, token_type: 'Bearer' }));
  await assert.rejects(pendingRefresh, /temporarily unavailable/i);
  assert.equal(calls, 1);
  assert.equal(store.snapshot().connected, false);
});

test('reconnect during refresh prevents the old refresh result from replacing the new grant', async () => {
  let resolveFetch!: (response: Response) => void;
  const store = new ChatGptSessionStore({ now: fixedNow, refreshSkewMs: 1000, fetch: async () => new Promise<Response>(resolve => { resolveFetch = resolve; }) });
  store.install({ accessToken: 'old', refreshToken: 'old-refresh', expiresAt: fixedNow() - 1, tokenType: 'Bearer' });
  const oldRefresh = store.getAccessToken(CLIENT_ID, 'https://auth.openai.com/oauth/token');
  store.install({ accessToken: 'new-grant-access', refreshToken: 'new-grant-refresh', expiresAt: fixedNow() + 60_000, tokenType: 'Bearer' });
  resolveFetch(jsonResponse({ access_token: 'late-old-access', refresh_token: 'late-old-refresh', expires_in: 3600, token_type: 'Bearer' }));
  await assert.rejects(oldRefresh, /temporarily unavailable/i);
  assert.equal(await store.getAccessToken(CLIENT_ID, 'https://auth.openai.com/oauth/token'), 'new-grant-access');
  assert.equal(store.snapshot().connected, true);
});

test('new session aborts an older remote revocation and remains connected', async () => {
  let calls = 0;
  let resolveFetch!: (response: Response) => void;
  let revocationSignal: AbortSignal | undefined;
  const store = new ChatGptSessionStore({ wait: async () => {}, fetch: async (_input, init) => {
    calls += 1;
    revocationSignal = init?.signal as AbortSignal;
    return new Promise<Response>(resolve => { resolveFetch = resolve; });
  } });
  store.install({ accessToken: 'old-access', refreshToken: 'old-refresh', expiresAt: fixedNow() + 10000, tokenType: 'Bearer' });
  const detached = store.takeForRevocation();
  const pending = store.revoke(CLIENT_ID, 'https://auth.openai.com/oauth/revoke', detached);
  await new Promise(resolve => setImmediate(resolve));
  store.install({ accessToken: 'new-access', refreshToken: 'new-refresh', expiresAt: fixedNow() + 10000, tokenType: 'Bearer' });
  assert.equal(revocationSignal?.aborted, true);
  resolveFetch(jsonResponse({}, 200));
  await assert.rejects(pending, /could not be confirmed/i);
  assert.equal(calls, 1);
  assert.equal(store.snapshot().connected, true);
});

test('late inference completion is rejected after local disconnect even if transport ignores abort', async () => {
  let resolveResponse!: (response: Response) => void;
  let markFetchStarted!: () => void;
  const fetchStarted = new Promise<void>(resolve => { markFetchStarted = resolve; });
  const store = new ChatGptSessionStore({ now: fixedNow, refreshSkewMs: 0 });
  store.install({ accessToken: 'access-for-test', refreshToken: 'refresh-for-test', expiresAt: fixedNow() + 10000, tokenType: 'Bearer' });
  const adapter = new ChatGptResponsesAdapter(
    () => store.getAccessToken(CLIENT_ID, 'https://auth.openai.com/oauth/token'),
    async () => new Promise<Response>(resolve => { resolveResponse = resolve; markFetchStarted(); }),
    signal => store.createRequestLease(signal),
  );
  const pending = adapter.generateText({ operation: 'story', modelId: 'gpt-6.2-sol', input: 'test', maxInputBytes: 100, maxOutputBytes: 100, timeoutMs: 1000 });
  await fetchStarted;
  store.takeForRevocation();
  resolveResponse(new Response([
    'event: response.output_text.delta\ndata: {"type":"response.output_text.delta","delta":"late"}\n\n',
    'event: response.completed\ndata: {"type":"response.completed","response":{}}\n\n',
  ].join(''), { headers: { 'content-type': 'text/event-stream' } }));
  await assert.rejects(pending, /cancel/i);
  assert.equal(store.snapshot().connected, false);
});

test('invalid revocation endpoint still discards detached refresh credential and repeated disconnect is idempotent', async () => {
  const store = new ChatGptSessionStore({ fetch: async () => { throw new Error('must not fetch'); } });
  store.install({ accessToken: 'access', refreshToken: 'detached-refresh', expiresAt: fixedNow() + 10000, tokenType: 'Bearer' });
  const detached = store.takeForRevocation();
  await assert.rejects(store.revoke(CLIENT_ID, 'https://attacker.example/revoke', detached), /could not be confirmed/i);
  assert.equal(detached?.refreshToken, undefined);
  assert.equal(store.takeForRevocation(), undefined);
  assert.equal(store.snapshot().connected, false);
});

test('transient refresh failure preserves credentials and releases the refresh lock', async () => {
  let calls = 0;
  const now = fixedNow();
  const store = new ChatGptSessionStore({ now: () => now, refreshSkewMs: 1000, fetch: async () => {
    calls += 1;
    if (calls === 1) return jsonResponse({ error: 'temporarily_unavailable' }, 503);
    return jsonResponse({ access_token: 'fresh-access', refresh_token: 'fresh-refresh', expires_in: 3600, token_type: 'Bearer' });
  } });
  store.install({ accessToken: 'old-access', refreshToken: 'old-refresh', expiresAt: now + 500, tokenType: 'Bearer' });

  await assert.rejects(store.getAccessToken(CLIENT_ID, 'https://auth.openai.com/oauth/token'), /temporarily unavailable/);
  assert.equal(store.snapshot().connected, true);
  assert.equal(await store.getAccessToken(CLIENT_ID, 'https://auth.openai.com/oauth/token'), 'fresh-access');
  assert.equal(calls, 2);
});

test('timed-out refresh releases its lock and keeps the current in-memory session', async () => {
  let calls = 0;
  const now = fixedNow();
  const store = new ChatGptSessionStore({ now: () => now, refreshSkewMs: 1000, requestTimeoutMs: 5, fetch: async () => {
    calls += 1;
    if (calls === 1) return new Promise<Response>(() => {});
    return jsonResponse({ access_token: 'fresh-access', refresh_token: 'fresh-refresh', expires_in: 3600, token_type: 'Bearer' });
  } });
  store.install({ accessToken: 'old-access', refreshToken: 'old-refresh', expiresAt: now + 500, tokenType: 'Bearer' });

  await assert.rejects(store.getAccessToken(CLIENT_ID, 'https://auth.openai.com/oauth/token'), /temporarily unavailable/);
  assert.equal(store.snapshot().connected, true);
  assert.equal(await store.getAccessToken(CLIENT_ID, 'https://auth.openai.com/oauth/token'), 'fresh-access');
  assert.equal(calls, 2);
});

test('session store rejects untrusted OAuth endpoint and malformed token fields', async () => {
  const store = new ChatGptSessionStore({ now: fixedNow, fetch: async () => { throw new Error('must not fetch'); } });
  store.install({ accessToken: 'a', expiresAt: fixedNow() - 1, refreshToken: 'r', tokenType: 'Bearer' });
  await assert.rejects(() => store.getAccessToken(CLIENT_ID, 'https://attacker.example/token'), /temporarily unavailable/);
  assert.equal(store.snapshot().connected, true);
  assert.throws(() => store.install({ accessToken: '', expiresAt: 1, tokenType: 'Bearer' }));
});

test('W1-D06: OAuth client bounds pending authorization flows and verifyIdToken enforces nbf and JWK key type', async () => {
  const now = fixedNow();
  const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
  const jwk = { ...publicKey.export({ format: 'jwk' }), kid: 'test-key', use: 'sig', alg: 'RS256' };
  const mockFetch: typeof fetch = async (input) => {
    const url = String(input);
    if (url.endsWith('/.well-known/openid-configuration')) return jsonResponse({
      issuer: OFFICIAL_ISSUER,
      authorization_endpoint: 'https://auth.openai.com/oauth/authorize',
      token_endpoint: 'https://auth.openai.com/oauth/token',
      jwks_uri: 'https://auth.openai.com/.well-known/jwks.json',
      response_types_supported: ['code'],
      code_challenge_methods_supported: ['S256'],
    });
    if (url.endsWith('/.well-known/jwks.json')) return jsonResponse({ keys: [jwk] });
    throw new Error('unexpected url');
  };

  const client = new ChatGptOAuthClient({
    redirectUri: REDIRECT,
    extAgentHostId: 'urn:uuid:host-test',
    agentNameHint: 'Proactive Co-Creator',
    fetch: mockFetch,
    now: () => now,
  });
  const first = await client.createAuthorizationRequest();
  for (let i = 0; i < 64; i += 1) {
    await client.createAuthorizationRequest();
  }
  await assert.rejects(
    client.completeAuthorization({ code: 'code-1', state: first.state, clientId: ISSUED_CLIENT_ID }),
    /invalid or expired/i,
  );

  const header = Buffer.from(JSON.stringify({ alg: 'RS256', kid: 'test-key', typ: 'JWT' })).toString('base64url');
  const futureNbfClaims = Buffer.from(JSON.stringify({
    iss: OFFICIAL_ISSUER,
    sub: 'user-1',
    aud: ISSUED_CLIENT_ID,
    exp: Math.floor(now / 1000) + 7200,
    iat: Math.floor(now / 1000),
    nbf: Math.floor(now / 1000) + 3600,
    nonce: 'nonce-1',
  })).toString('base64url');
  const signer = createSign('RSA-SHA256');
  signer.update(`${header}.${futureNbfClaims}`);
  signer.end();
  const futureNbfToken = `${header}.${futureNbfClaims}.${signer.sign(privateKey).toString('base64url')}`;
  await assert.rejects(
    verifyIdToken(futureNbfToken, { clientId: ISSUED_CLIENT_ID, expectedNonce: 'nonce-1', fetch: mockFetch, now: () => now }),
    /claims are invalid/i,
  );
});
