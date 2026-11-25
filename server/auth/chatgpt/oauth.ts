import { createPublicKey, verify as verifySignature } from 'node:crypto';
import { createOAuthSecret, createPkcePair, readTokenResponse, type ChatGptTokenSet } from './sessionStore.ts';

export const CHATGPT_OAUTH_ISSUER = 'https://auth.openai.com/';
const AUTH_ORIGIN = 'https://auth.openai.com';
const DISCOVERY_URL = `${AUTH_ORIGIN}/.well-known/openid-configuration`;
const AUTHORIZE_URL = `${AUTH_ORIGIN}/api/accounts/authorize`;
const TOKEN_URL = `${AUTH_ORIGIN}/api/accounts/oauth/token`;
const DYNAMIC_CLIENT_ID = 'dynamic_agent_client';
const OPENAI_RESOURCE = 'https://api.openai.com/v1';
const FLOW_TTL_MS = 10 * 60_000;
const REQUIRED_SCOPES = ['openid', 'chatgpt.tokens.use.direct', 'resource.invoke', 'offline_access'] as const;

export interface OpenIdConfiguration {
  issuer: string;
  authorization_endpoint: string;
  token_endpoint: string;
  jwks_uri: string;
  revocation_endpoint?: string;
  response_types_supported?: string[];
  code_challenge_methods_supported?: string[];
  id_token_signing_alg_values_supported?: string[];
}

export interface ChatGptOAuthOptions {
  /** Issued client ID for a returning account, otherwise use dynamic registration. */
  clientId?: string;
  redirectUri: string;
  extAgentHostId: string;
  agentNameHint: string;
  fetch?: typeof fetch;
  now?: () => number;
}

interface PendingFlow {
  state: string;
  nonce: string;
  verifier: string;
  requestedClientId: string;
  expiresAt: number;
}

export interface VerifiedOpenIdClaims {
  iss: string;
  sub: string;
  aud: string | string[];
  exp: number;
  iat: number;
  nonce: string;
  [claim: string]: unknown;
}

function trustedHttpsUrl(value: unknown): string {
  if (typeof value !== 'string') throw new Error('OpenID metadata is invalid.');
  let parsed: URL;
  try { parsed = new URL(value); } catch { throw new Error('OpenID metadata is invalid.'); }
  if (parsed.protocol !== 'https:' || parsed.origin !== AUTH_ORIGIN || parsed.username || parsed.password || parsed.hash) {
    throw new Error('OpenID metadata contains an untrusted endpoint.');
  }
  return parsed.toString();
}

function decodeJsonPart(part: string): Record<string, unknown> {
  try {
    const value: unknown = JSON.parse(Buffer.from(part, 'base64url').toString('utf8'));
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error();
    return value as Record<string, unknown>;
  } catch { throw new Error('OpenID token is invalid.'); }
}

export async function discoverOpenId(fetchImpl: typeof fetch = fetch): Promise<OpenIdConfiguration> {
  let response: Response;
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    response = await Promise.race([
      fetchImpl(DISCOVERY_URL, { headers: { accept: 'application/json' }, signal: controller.signal }),
      new Promise<never>((_resolve, reject) => {
        timer = setTimeout(() => { controller.abort(); reject(new Error('OpenID discovery timed out.')); }, 5_000);
      }),
    ]);
  } catch { throw new Error('OpenID discovery failed.'); }
  finally { if (timer) clearTimeout(timer); controller.abort(); }
  if (!response.ok) throw new Error('OpenID discovery failed.');
  let raw: unknown;
  try { raw = await response.json(); } catch { throw new Error('OpenID discovery metadata is invalid.'); }
  if (!raw || typeof raw !== 'object') throw new Error('OpenID discovery metadata is invalid.');
  const meta = raw as Record<string, unknown>;
  if (meta.issuer !== CHATGPT_OAUTH_ISSUER) throw new Error('OpenID issuer did not match the trusted issuer.');
  const configuration: OpenIdConfiguration = {
    issuer: CHATGPT_OAUTH_ISSUER,
    authorization_endpoint: trustedHttpsUrl(meta.authorization_endpoint),
    token_endpoint: trustedHttpsUrl(meta.token_endpoint),
    jwks_uri: trustedHttpsUrl(meta.jwks_uri),
    ...(meta.revocation_endpoint === undefined ? {} : { revocation_endpoint: trustedHttpsUrl(meta.revocation_endpoint) }),
    ...(Array.isArray(meta.response_types_supported) ? { response_types_supported: meta.response_types_supported.filter((x): x is string => typeof x === 'string') } : {}),
    ...(Array.isArray(meta.code_challenge_methods_supported) ? { code_challenge_methods_supported: meta.code_challenge_methods_supported.filter((x): x is string => typeof x === 'string') } : {}),
    ...(Array.isArray(meta.id_token_signing_alg_values_supported) ? { id_token_signing_alg_values_supported: meta.id_token_signing_alg_values_supported.filter((x): x is string => typeof x === 'string') } : {}),
  };
  if (configuration.response_types_supported && !configuration.response_types_supported.includes('code')) throw new Error('OpenID provider does not support authorization code flow.');
  if (configuration.code_challenge_methods_supported && !configuration.code_challenge_methods_supported.includes('S256')) throw new Error('OpenID provider does not support secure PKCE.');
  return configuration;
}

export class ChatGptOAuthClient {
  private readonly fetchImpl: typeof fetch;
  private readonly now: () => number;
  private readonly pending = new Map<string, PendingFlow>();
  private readonly options: ChatGptOAuthOptions;

  constructor(options: ChatGptOAuthOptions) {
    this.options = options;
    if (!options.extAgentHostId.trim() || !options.agentNameHint.trim()) throw new Error('OAuth host identity is required.');
    const redirect = new URL(options.redirectUri);
    if (redirect.protocol !== 'http:' || !['localhost', '127.0.0.1', '[::1]'].includes(redirect.hostname)) {
      throw new Error('OAuth redirect URI must use loopback HTTP.');
    }
    this.fetchImpl = options.fetch ?? fetch;
    this.now = options.now ?? Date.now;
  }

  async createAuthorizationRequest(): Promise<{ url: string; state: string }> {
    this.pruneFlows();
    await discoverOpenId(this.fetchImpl);
    const pkce = createPkcePair();
    const state = createOAuthSecret();
    const nonce = createOAuthSecret();
    const requestedClientId = this.options.clientId ?? DYNAMIC_CLIENT_ID;
    this.pending.set(state, { state, nonce, verifier: pkce.verifier, requestedClientId, expiresAt: this.now() + FLOW_TTL_MS });
    const params = new URLSearchParams({
      response_type: 'code', client_id: requestedClientId,
      redirect_uri: this.options.redirectUri, scope: [...REQUIRED_SCOPES, 'profile', 'email', 'offline_access', 'resource.invoke'].join(' '),
      resource: OPENAI_RESOURCE,
      ext_agent_host_id: this.options.extAgentHostId,
      state, nonce, code_challenge: pkce.challenge, code_challenge_method: 'S256',
    });
    if (!this.options.clientId) params.set('agent_name_hint', this.options.agentNameHint);
    const url = new URL(AUTHORIZE_URL);
    url.search = params.toString();
    return { url: url.toString(), state };
  }

  cancelAuthorization(state: string): boolean {
    this.pruneFlows();
    if (!this.pending.has(state)) return false;
    this.pending.delete(state);
    return true;
  }

  async completeAuthorization(input: { code: string; state: string; clientId?: string }): Promise<{ tokens: ChatGptTokenSet; claims: VerifiedOpenIdClaims; clientId: string }> {
    this.pruneFlows();
    const flow = this.pending.get(input.state);
    this.pending.delete(input.state); // state is one-use, including failed attempts
    if (!flow || !input.code || input.code.length > 4096) throw new Error('OAuth callback state is invalid or expired.');
    await discoverOpenId(this.fetchImpl);
    const clientId = flow.requestedClientId === DYNAMIC_CLIENT_ID ? input.clientId : flow.requestedClientId;
    if (!clientId || clientId === DYNAMIC_CLIENT_ID || (flow.requestedClientId === DYNAMIC_CLIENT_ID && !/^oaiapp_[A-Za-z0-9_-]{4,128}$/.test(clientId)) || (flow.requestedClientId !== DYNAMIC_CLIENT_ID && input.clientId && input.clientId !== flow.requestedClientId)) {
      throw new Error('OAuth callback client registration is invalid.');
    }
    let response: Response;
    try {
      response = await this.fetchImpl(TOKEN_URL, {
        method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded', accept: 'application/json' },
        body: new URLSearchParams({ grant_type: 'authorization_code', code: input.code, redirect_uri: this.options.redirectUri, client_id: clientId, code_verifier: flow.verifier, resource: OPENAI_RESOURCE }),
      });
    } catch { throw new Error('OAuth token exchange failed.'); }
    const tokens = await readTokenResponse(response, this.now);
    if (!tokens.idToken) throw new Error('OpenID token response did not include an ID token.');
    if (!tokens.refreshToken) throw new Error('ChatGPT authorization did not include a renewable session token.');
    const grantedScopes = new Set((tokens.scope ?? '').split(/\s+/).filter(Boolean));
    if (!REQUIRED_SCOPES.every((scope) => grantedScopes.has(scope))) {
      throw new Error('OAuth response did not grant the required ChatGPT authorization scopes.');
    }
    const claims = await verifyIdToken(tokens.idToken, {
      clientId, expectedNonce: flow.nonce,
      fetch: this.fetchImpl, now: this.now,
    });
    return { tokens, claims, clientId };
  }

  async revoke(token: string): Promise<void> {
    if (!token) return;
    const metadata = await discoverOpenId(this.fetchImpl);
    if (!metadata.revocation_endpoint) throw new Error('OpenID provider does not advertise token revocation.');
    try {
      const response = await this.fetchImpl(metadata.revocation_endpoint, {
        method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded', accept: 'application/json' },
        body: new URLSearchParams({ token, client_id: this.options.clientId ?? DYNAMIC_CLIENT_ID }),
      });
      if (!response.ok) throw new Error();
    } catch { throw new Error('OAuth token revocation failed.'); }
  }

  private pruneFlows(): void {
    const now = this.now();
    for (const [key, flow] of this.pending) if (flow.expiresAt <= now) this.pending.delete(key);
  }
}

export async function verifyIdToken(idToken: string, options: {
  clientId: string; expectedNonce: string; fetch?: typeof fetch; now?: () => number;
}): Promise<VerifiedOpenIdClaims> {
  if (idToken.length > 32_768) throw new Error('OpenID token is invalid.');
  const parts = idToken.split('.');
  if (parts.length !== 3) throw new Error('OpenID token is invalid.');
  const header = decodeJsonPart(parts[0]);
  const claims = decodeJsonPart(parts[1]) as unknown as VerifiedOpenIdClaims;
  const alg = header.alg;
  if (!['RS256', 'ES256'].includes(String(alg)) || typeof header.kid !== 'string') throw new Error('OpenID token algorithm is not supported.');
  const metadata = await discoverOpenId(options.fetch ?? fetch);
  let response: Response;
  try { response = await (options.fetch ?? fetch)(metadata.jwks_uri, { headers: { accept: 'application/json' } }); }
  catch { throw new Error('OpenID signing keys could not be loaded.'); }
  if (!response.ok) throw new Error('OpenID signing keys could not be loaded.');
  let raw: unknown;
  try { raw = await response.json(); } catch { throw new Error('OpenID signing keys are invalid.'); }
  const keys = raw && typeof raw === 'object' && Array.isArray((raw as { keys?: unknown }).keys) ? (raw as { keys: unknown[] }).keys : [];
  const jwk = keys.find((item) => item && typeof item === 'object' && (item as Record<string, unknown>).kid === header.kid) as JsonWebKey | undefined;
  if (!jwk || jwk.use !== 'sig' || (jwk.alg && jwk.alg !== alg)) throw new Error('OpenID signing key is unavailable.');
  let signatureValid: boolean;
  try {
    const key = createPublicKey({ key: jwk as import('node:crypto').JsonWebKey, format: 'jwk' });
    const data = Buffer.from(`${parts[0]}.${parts[1]}`);
    const signature = Buffer.from(parts[2], 'base64url');
    signatureValid = alg === 'RS256'
      ? verifySignature('RSA-SHA256', data, key, signature)
      : verifySignature('sha256', data, { key, dsaEncoding: 'ieee-p1363' }, signature);
  } catch { signatureValid = false; }
  if (!signatureValid) throw new Error('OpenID token signature is invalid.');
  const nowSeconds = Math.floor((options.now ?? Date.now)() / 1000);
  const aud = Array.isArray(claims.aud) ? claims.aud : [claims.aud];
  if (claims.iss !== metadata.issuer || !aud.includes(options.clientId) ||
      (aud.length > 1 && claims.azp !== options.clientId) ||
      typeof claims.sub !== 'string' || !claims.sub ||
      !Number.isFinite(claims.exp) || claims.exp <= nowSeconds ||
      !Number.isFinite(claims.iat) || claims.iat > nowSeconds + 60 ||
      claims.nonce !== options.expectedNonce) {
    throw new Error('OpenID token claims are invalid.');
  }
  return claims;
}
