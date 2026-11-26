import { createHash, randomBytes } from 'node:crypto';
import { fetchBoundedHttpBody, parseOAuthJson } from '../../http.ts';

/** OAuth credentials are deliberately process-local. A restart clears the session. */
export interface ChatGptTokenSet {
  accessToken: string;
  refreshToken?: string;
  expiresAt: number;
  tokenType: 'Bearer';
  scope?: string;
  idToken?: string;
}

export interface ChatGptSessionSnapshot {
  connected: boolean;
  expiresAt?: number;
  scope?: string;
}

export interface ChatGptSessionStoreOptions {
  fetch?: typeof fetch;
  now?: () => number;
  refreshSkewMs?: number;
  requestTimeoutMs?: number;
  maxRevocationAttempts?: number;
  revocationRetryBaseDelayMs?: number;
  wait?: (milliseconds: number) => Promise<void>;
}

/** Minimal temporary snapshot detached from all locally usable session tokens. */
export interface ChatGptRevocationSnapshot {
  refreshToken?: string;
  generation: number;
  tokenRotationVersion: number;
  refreshInProgress: boolean;
}

export interface ChatGptRequestLease {
  signal: AbortSignal;
  release: () => void;
}

const AUTH_ORIGIN = 'https://auth.openai.com';

function safeTokenSet(value: ChatGptTokenSet): ChatGptTokenSet {
  if (!value || typeof value.accessToken !== 'string' || value.accessToken.length < 1 ||
      (value.refreshToken !== undefined && typeof value.refreshToken !== 'string') ||
      !Number.isFinite(value.expiresAt) || value.expiresAt <= 0 || value.tokenType !== 'Bearer') {
    throw new Error('Invalid OAuth token response.');
  }
  return { ...value };
}

export class ChatGptSessionStore {
  private tokens: ChatGptTokenSet | undefined;
  private refreshInFlight: Promise<string> | undefined;
  private activeRefresh: AbortController | undefined;
  private readonly fetchImpl: typeof fetch;
  private readonly now: () => number;
  private readonly refreshSkewMs: number;
  private readonly requestTimeoutMs: number;
  private readonly maxRevocationAttempts: number;
  private readonly revocationRetryBaseDelayMs: number;
  private readonly wait: (milliseconds: number) => Promise<void>;
  private generation = 0;
  private tokenRotationVersion = 0;
  private readonly activeRequests = new Set<AbortController>();
  private readonly activeRevocations = new Set<AbortController>();

  constructor(options: ChatGptSessionStoreOptions = {}) {
    this.fetchImpl = options.fetch ?? fetch;
    this.now = options.now ?? Date.now;
    this.refreshSkewMs = options.refreshSkewMs ?? 60_000;
    this.requestTimeoutMs = options.requestTimeoutMs ?? 5_000;
    this.maxRevocationAttempts = Math.max(1, Math.min(3, Math.floor(options.maxRevocationAttempts ?? 3)));
    this.revocationRetryBaseDelayMs = Math.max(1, Math.min(1_000, Math.floor(options.revocationRetryBaseDelayMs ?? 250)));
    this.wait = options.wait ?? (milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds)));
  }

  /** Installs a new authorization grant and invalidates all authority from its predecessor. */
  install(tokens: ChatGptTokenSet): void {
    this.abortActiveRequests();
    this.abortActiveRefresh();
    this.abortActiveRevocations();
    this.generation += 1;
    this.tokenRotationVersion += 1;
    this.tokens = safeTokenSet(tokens);
    this.refreshInFlight = undefined;
  }

  snapshot(): ChatGptSessionSnapshot {
    return this.tokens ? { connected: true, expiresAt: this.tokens.expiresAt, ...(this.tokens.scope ? { scope: this.tokens.scope } : {}) } : { connected: false };
  }

  getGeneration(): number { return this.generation; }
  getTokenRotationVersion(): number { return this.tokenRotationVersion; }

  clear(): void {
    this.abortActiveRequests();
    this.abortActiveRefresh();
    this.abortActiveRevocations();
    this.generation += 1;
    this.tokenRotationVersion += 1;
    this.tokens = undefined;
    this.refreshInFlight = undefined;
  }

  createRequestLease(parentSignal?: AbortSignal, expectedGeneration = this.generation): ChatGptRequestLease {
    if (expectedGeneration !== this.generation) throw new Error('ChatGPT session changed before the request started.');
    const controller = new AbortController();
    const abortFromParent = () => controller.abort(parentSignal?.reason);
    if (parentSignal?.aborted) abortFromParent();
    else parentSignal?.addEventListener('abort', abortFromParent, { once: true });
    this.activeRequests.add(controller);
    let released = false;
    return {
      signal: controller.signal,
      release: () => {
        if (released) return;
        released = true;
        parentSignal?.removeEventListener('abort', abortFromParent);
        this.activeRequests.delete(controller);
        controller.abort();
      },
    };
  }

  private abortActiveRequests(): void {
    for (const controller of this.activeRequests) controller.abort(new Error('ChatGPT session changed.'));
    this.activeRequests.clear();
  }

  private abortActiveRefresh(): void {
    this.activeRefresh?.abort(new Error('ChatGPT session changed.'));
    this.activeRefresh = undefined;
  }

  private abortActiveRevocations(): void {
    for (const controller of this.activeRevocations) controller.abort(new Error('ChatGPT session changed.'));
    this.activeRevocations.clear();
  }

  /** Invalidates local use immediately and returns the prior set only for one explicit revocation attempt. */
  takeForRevocation(): ChatGptRevocationSnapshot | undefined {
    const current = this.tokens;
    if (!current) return undefined;
    const refreshToken = current.refreshToken;
    const tokenRotationVersion = this.tokenRotationVersion;
    const refreshInProgress = this.refreshInFlight !== undefined;
    this.clear();
    return { ...(refreshToken ? { refreshToken } : {}), generation: this.generation, tokenRotationVersion, refreshInProgress };
  }

  async getAccessToken(clientId: string, tokenEndpoint: string, expectedGeneration = this.generation): Promise<string> {
    if (expectedGeneration !== this.generation) throw new Error('ChatGPT session changed before access was granted.');
    const current = this.tokens;
    if (!current) throw new Error('ChatGPT authorization is required.');
    if (current.expiresAt > this.now() + this.refreshSkewMs) return current.accessToken;
    if (!current.refreshToken) {
      this.clear();
      throw new Error('ChatGPT authorization expired; reconnect the account.');
    }
    if (!this.refreshInFlight) {
      const oldRefreshToken = current.refreshToken;
      const controller = new AbortController();
      this.activeRefresh = controller;
      this.refreshInFlight = this.refresh(clientId, oldRefreshToken, tokenEndpoint, this.generation, this.tokenRotationVersion, controller.signal);
    }
    return this.refreshInFlight;
  }

  private async refresh(clientId: string, refreshToken: string, tokenEndpoint: string, generation: number, tokenRotationVersion: number, signal: AbortSignal): Promise<string> {
    let terminalFailure = false;
    try {
      const endpoint = trustedEndpoint(tokenEndpoint);
      const response = await fetchBoundedHttpBody(this.fetchImpl, endpoint, {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded', accept: 'application/json' },
        body: new URLSearchParams({ grant_type: 'refresh_token', refresh_token: refreshToken, client_id: clientId, resource: 'https://api.openai.com/v1' }),
      }, { timeoutMs: this.requestTimeoutMs, maxBodyBytes: 32 * 1024, signal });
      if (!response.ok) {
        const payload = parseOAuthJson(response.body, 'OAuth token refresh was rejected.') as { error?: unknown } | null;
        const code = payload && typeof payload.error === 'string' ? payload.error : '';
        terminalFailure = ['invalid_grant', 'invalid_refresh_token', 'token_expired', 'refresh_token_expired', 'refresh_token_invalidated', 'refresh_token_reused'].includes(code);
        if (terminalFailure && this.generation === generation && this.tokens?.refreshToken === refreshToken) this.clear();
        throw new Error('OAuth token refresh was rejected.');
      }
      const payload = await readTokenResponse(new Response(response.body, { status: response.status, headers: response.headers }));
      if (this.generation !== generation || this.tokenRotationVersion !== tokenRotationVersion || !this.tokens || this.tokens.refreshToken !== refreshToken) throw new Error('OAuth session changed during refresh.');
      if (!payload.refreshToken) throw new Error('OAuth refresh did not return a replacement refresh token.');
      if (payload.scope !== undefined && this.tokens.scope) {
        const refreshedScopes = new Set(payload.scope.split(/\s+/).filter(Boolean));
        if (this.tokens.scope.split(/\s+/).filter(Boolean).some(scope => !refreshedScopes.has(scope))) {
          terminalFailure = true;
          this.clear();
          throw new Error('OAuth refresh scope was reduced.');
        }
      }
      const refreshed = {
        ...payload,
        ...(payload.scope === undefined && this.tokens.scope ? { scope: this.tokens.scope } : {}),
        ...(payload.idToken === undefined && this.tokens.idToken ? { idToken: this.tokens.idToken } : {}),
      };
      if (this.generation !== generation || this.tokenRotationVersion !== tokenRotationVersion || !this.tokens || this.tokens.refreshToken !== refreshToken) {
        throw new Error('OAuth session changed during refresh.');
      }
      this.tokens = safeTokenSet(refreshed);
      this.tokenRotationVersion += 1;
      return refreshed.accessToken;
    } catch {
      throw new Error(terminalFailure
        ? 'ChatGPT authorization expired or was revoked; reconnect the account.'
        : 'ChatGPT token refresh is temporarily unavailable. The current session was retained; retry later.');
    } finally {
      if (this.generation === generation) this.refreshInFlight = undefined;
      if (this.activeRefresh?.signal === signal) this.activeRefresh = undefined;
    }
  }

  /** Revokes the renewable refresh token; callers clear local state before awaiting discovery or network. */
  async revoke(clientId: string, revocationEndpoint: string, current: ChatGptRevocationSnapshot | undefined = this.takeForRevocation()): Promise<void> {
    if (!current) return;
    const token = current.refreshToken;
    if (current.refreshInProgress) {
      current.refreshToken = undefined;
      throw new Error('ChatGPT authorization was cleared locally, but remote revocation could not be confirmed while token refresh was in flight. Disconnect the app from ChatGPT Settings to revoke any remaining authorization.');
    }
    if (!token) {
      current.refreshToken = undefined;
      throw new Error('ChatGPT authorization was cleared locally, but no renewable token was available for remote revocation.');
    }
    try {
      const endpoint = trustedEndpoint(revocationEndpoint);
      for (let attempt = 1; attempt <= this.maxRevocationAttempts; attempt += 1) {
        if (this.generation !== current.generation) throw new Error('ChatGPT authorization changed during revocation.');
        const controller = new AbortController();
        this.activeRevocations.add(controller);
        let retryable = false;
        let responseReceived = false;
        try {
          const response = await fetchBoundedHttpBody(this.fetchImpl, endpoint, {
              method: 'POST',
              headers: { 'content-type': 'application/x-www-form-urlencoded', accept: 'application/json' },
              body: new URLSearchParams({ token, token_type_hint: 'refresh_token', client_id: clientId }),
            }, { timeoutMs: this.requestTimeoutMs, maxBodyBytes: 8 * 1024, signal: controller.signal });
          responseReceived = true;
          if (response.ok) return;
          retryable = response.status >= 500;
          if (!retryable || attempt === this.maxRevocationAttempts) throw new Error('Revocation was rejected.');
        } catch (error) {
          if (this.generation !== current.generation) throw error;
          if (responseReceived && !retryable) {
            throw error;
          } else if (!controller.signal.aborted && !(error instanceof Error && error.message === 'Revocation attempt timed out.')) {
            retryable = true;
          } else if (controller.signal.aborted && controller.signal.reason instanceof Error && controller.signal.reason.message !== 'Revocation attempt timed out.') {
            throw error;
          } else {
            retryable = true;
          }
          if (!retryable || attempt === this.maxRevocationAttempts) throw error;
        } finally {
          this.activeRevocations.delete(controller);
          controller.abort();
        }
        if (this.generation !== current.generation) throw new Error('ChatGPT authorization changed during revocation.');
        await this.wait(this.revocationRetryBaseDelayMs * (2 ** (attempt - 1)));
      }
    } catch {
      throw new Error('ChatGPT authorization was cleared locally, but remote revocation could not be confirmed.');
    } finally {
      current.refreshToken = undefined;
    }
  }
}

function trustedEndpoint(value: string): string {
  try {
    const url = new URL(value);
    if (url.protocol !== 'https:' || url.origin !== AUTH_ORIGIN || url.username || url.password || url.hash) throw new Error();
    return url.toString();
  } catch { throw new Error('OAuth endpoint is not trusted.'); }
}

export function createPkcePair(): { verifier: string; challenge: string } {
  const verifier = randomBytes(32).toString('base64url');
  const challenge = createHash('sha256').update(verifier).digest('base64url');
  return { verifier, challenge };
}

export function createOAuthSecret(): string {
  return randomBytes(32).toString('base64url');
}

export async function readTokenResponse(response: Response, now: () => number = Date.now): Promise<ChatGptTokenSet> {
  if (!response.ok) throw new Error('OAuth token request failed.');
  let raw: unknown;
  try { raw = await response.json(); } catch { throw new Error('OAuth token response was invalid.'); }
  if (!raw || typeof raw !== 'object') throw new Error('OAuth token response was invalid.');
  const value = raw as Record<string, unknown>;
  const expiresIn = value.expires_in;
  if (typeof value.access_token !== 'string' || typeof expiresIn !== 'number' || !Number.isFinite(expiresIn) || expiresIn <= 0 ||
      (value.refresh_token !== undefined && typeof value.refresh_token !== 'string') ||
      (value.id_token !== undefined && typeof value.id_token !== 'string') ||
      (value.scope !== undefined && typeof value.scope !== 'string') ||
      (value.token_type !== undefined && value.token_type !== 'Bearer')) {
    throw new Error('OAuth token response was invalid.');
  }
  return safeTokenSet({
    accessToken: value.access_token,
    ...(typeof value.refresh_token === 'string' ? { refreshToken: value.refresh_token } : {}),
    expiresAt: now() + expiresIn * 1000,
    tokenType: 'Bearer',
    ...(typeof value.scope === 'string' ? { scope: value.scope } : {}),
    ...(typeof value.id_token === 'string' ? { idToken: value.id_token } : {}),
  });
}
