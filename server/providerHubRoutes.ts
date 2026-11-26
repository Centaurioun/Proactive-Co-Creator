import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import express, { type Request, type Response, type Router } from 'express';
import type { AiOperation } from './aiBudget.ts';
import { ChatGptOAuthClient, discoverOpenId } from './auth/chatgpt/oauth.ts';
import { chatGptSessionStore } from './auth/chatgpt/runtime.ts';
import type { ChatGptSessionStore } from './auth/chatgpt/sessionStore.ts';
import { setSessionGeminiKey } from './geminiClient.ts';
import type { AiConnectionId, AiReasoningLevel } from './providers/contracts.ts';
import { getCachedProviderModel, getPreferences, listProviderModels, providerHubStatus, setChatGptModels, setOpenAiApiKey, setPersonalGeminiKey, setPreferences, registerChatGptAdapterFactory } from './providers/runtime.ts';
import { ChatGptResponsesAdapter } from './providers/chatgptResponses.ts';
import { assertReasoningSelection, hasSupportedOperation } from './providers/policy.ts';

const AUTH_ORIGIN = 'https://auth.openai.com';
const TOKEN_ENDPOINT = `${AUTH_ORIGIN}/api/accounts/oauth/token`;
const CALLBACK_PATH = '/api/ai/provider-hub/auth/callback';
const PERSONAL_IDS: AiConnectionId[] = ['gemini-personal', 'chatgpt-plan', 'openai-api'];
const VALID_IDS: AiConnectionId[] = ['gemini-managed', 'gemini-personal', 'chatgpt-plan', 'openai-api'];
const SELECTABLE_IDS: AiConnectionId[] = ['gemini-managed', 'gemini-personal', 'chatgpt-plan', 'openai-api'];
const VALID_OPERATIONS = new Set<AiOperation>([
  'analyze', 'clarify', 'polish', 'story', 'image', 'batch-edit', 'narrative-import',
  'diagnostics', 'sync', 'writing', 'opportunities', 'import-enhance',
]);
const REASONING: AiReasoningLevel[] = ['default', 'none', 'minimal', 'low', 'medium', 'high', 'extra-high', 'max'];
const validModelId = (value: unknown): boolean => typeof value === 'string' && value.length > 0 && value.length <= 160 && /^[A-Za-z0-9._:/-]+$/.test(value);

interface HostIdentity { hostId: string; issuedClientId?: string }
let identityCache: HostIdentity | undefined;
let oauthClient: ChatGptOAuthClient | undefined;
let pendingOAuthState: string | undefined;
let authGeneration = 0;

function identityPath(): string { return path.join(os.homedir(), '.config', 'proactive-co-creator', 'host-identity.json'); }

async function loadIdentity(): Promise<HostIdentity> {
  if (identityCache) return identityCache;
  try {
    const parsed: unknown = JSON.parse(await fs.readFile(identityPath(), 'utf8'));
    if (parsed && typeof parsed === 'object' && typeof (parsed as HostIdentity).hostId === 'string') {
      identityCache = parsed as HostIdentity;
      return identityCache;
    }
  } catch { /* create the non-secret stable host identifier on first authorization */ }
  identityCache = { hostId: `urn:uuid:${crypto.randomUUID()}` };
  await saveIdentity(identityCache);
  return identityCache;
}

async function saveIdentity(value: HostIdentity): Promise<void> {
  const file = identityPath();
  await fs.mkdir(path.dirname(file), { recursive: true, mode: 0o700 });
  await fs.writeFile(file, `${JSON.stringify(value)}\n`, { mode: 0o600 });
  await fs.chmod(file, 0o600);
}

function portForRequest(req: Request): number {
  const explicit = Number(process.env.PORT);
  if (Number.isInteger(explicit) && explicit > 0 && explicit < 65536) return explicit;
  const host = req.get('host') ?? '';
  const match = /:(\d+)$/.exec(host);
  return match ? Number(match[1]) : 3000;
}

function isLoopbackAddress(value: string | undefined): boolean {
  if (!value) return false;
  const address = value.toLowerCase().replace(/^::ffff:/, '').split('%')[0];
  return address === '127.0.0.1' || address === '::1' || address === '::ffff:127.0.0.1';
}

function isLoopbackHost(value: string | undefined): boolean {
  if (!value) return false;
  try {
    const parsed = new URL(`http://${value}`);
    return ['127.0.0.1', 'localhost', '[::1]'].includes(parsed.hostname);
  } catch { return false; }
}

function hasSameOriginLocalRequest(req: Request): boolean {
  const host = req.get('host');
  if (!isLoopbackAddress(req.socket.remoteAddress) || !isLoopbackHost(host)) return false;
  const origin = req.get('origin');
  if (origin) {
    try {
      const parsed = new URL(origin);
      if (parsed.protocol !== 'http:' || parsed.host !== host || !isLoopbackHost(parsed.host)) return false;
    } catch { return false; }
  } else if (req.method !== 'GET' && req.method !== 'HEAD') {
    return false;
  }
  const fetchSite = req.get('sec-fetch-site');
  return !fetchSite || fetchSite === 'same-origin' || fetchSite === 'none';
}

function requireLoopback(req: Request, res: Response, next: (error?: unknown) => void): void {
  if (!hasSameOriginLocalRequest(req)) {
    res.status(403).json({ error: { code: 'LOCAL_ONLY', message: 'Personal provider connections are only available from this local PCC instance.' } });
    return;
  }
  next();
}

function requireLoopbackOAuthCallback(req: Request, res: Response, next: (error?: unknown) => void): void {
  const origin = req.get('origin');
  const validOrigin = !origin || (() => {
    try { const parsed = new URL(origin); return parsed.protocol === 'http:' && isLoopbackHost(parsed.host); }
    catch { return false; }
  })();
  if (req.method !== 'GET' || !isLoopbackAddress(req.socket.remoteAddress) || !isLoopbackHost(req.get('host')) || !validOrigin) {
    res.status(403).send('This authorization callback is only available to the local PCC process.');
    return;
  }
  next();
}

async function createOAuthClient(req: Request): Promise<ChatGptOAuthClient> {
  const identity = await loadIdentity();
  const redirectUri = `http://127.0.0.1:${portForRequest(req)}${CALLBACK_PATH}`;
  return new ChatGptOAuthClient({
      ...(identity.issuedClientId ? { clientId: identity.issuedClientId } : {}),
      redirectUri,
      extAgentHostId: identity.hostId,
      agentNameHint: 'Proactive Co-Creator',
    });
}

function authAdapter(): ChatGptResponsesAdapter {
  registerChatGptAdapterFactory((requestedGeneration) => {
    const clientId = identityCache?.issuedClientId;
    if (!clientId || !chatGptSessionStore.snapshot().connected) throw new Error('ChatGPT authorization is required.');
    const generation = requestedGeneration ?? chatGptSessionStore.getGeneration();
    return new ChatGptResponsesAdapter(
      () => chatGptSessionStore.getAccessToken(clientId, TOKEN_ENDPOINT, generation),
      fetch,
      (signal) => chatGptSessionStore.createRequestLease(signal, generation),
    );
  });
  const generation = chatGptSessionStore.getGeneration();
  return new ChatGptResponsesAdapter(async () => {
    const clientId = identityCache?.issuedClientId;
    if (!clientId) throw new Error('ChatGPT authorization is required.');
    return chatGptSessionStore.getAccessToken(clientId, TOKEN_ENDPOINT, generation);
  }, fetch, (signal) => chatGptSessionStore.createRequestLease(signal, generation));
}

export interface ProviderHubRouterOptions {
  disconnectSessionStore?: ChatGptSessionStore;
  discoverOpenId?: typeof discoverOpenId;
  issuedClientId?: () => string | undefined;
}

export function createProviderHubRouter(options: ProviderHubRouterOptions = {}): Router {
  const router = express.Router();
  const disconnectSessionStore = options.disconnectSessionStore ?? chatGptSessionStore;
  const discoverIssuer = options.discoverOpenId ?? discoverOpenId;

  router.get('/status', (_req, res) => {
    const local = hasSameOriginLocalRequest(_req as Request);
    res.json(providerHubStatus(local));
  });

  router.get('/models', requireLoopback, async (req, res) => {
    const connectionId = req.query.connectionId;
    if (typeof connectionId !== 'string' || !VALID_IDS.includes(connectionId as AiConnectionId)) {
      res.status(400).json({ error: { code: 'VALIDATION_ERROR', message: 'Choose a supported connection to refresh its model catalog.' } });
      return;
    }
    try {
      if (connectionId === 'chatgpt-plan') { await loadIdentity(); authAdapter(); }
      const requestGeneration = authGeneration;
      const models = await listProviderModels(connectionId as AiConnectionId);
      if (connectionId === 'chatgpt-plan' && (requestGeneration !== authGeneration || !chatGptSessionStore.snapshot().connected)) {
        res.status(409).json({ error: { code: 'AUTH_CANCELLED', message: 'The ChatGPT connection changed while its model catalog was loading. Refresh connection status.' } });
        return;
      }
      res.json({ models });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'The model catalog could not be refreshed.';
      res.status(503).json({ error: { code: 'MODEL_CATALOG_UNAVAILABLE', message } });
    }
  });

  router.put('/preferences', requireLoopback, (req, res) => {
    const value = req.body?.preferences;
    if (!value || typeof value !== 'object' || Array.isArray(value) || !SELECTABLE_IDS.includes(value.defaultConnectionId)) {
      res.status(400).json({ error: { code: 'VALIDATION_ERROR', message: 'AI preferences are invalid.' } });
      return;
    }
    if (value.defaultTextModelId !== undefined && !validModelId(value.defaultTextModelId)) {
      res.status(400).json({ error: { code: 'VALIDATION_ERROR', message: 'The selected default model is invalid.' } });
      return;
    }
    if (value.defaultReasoningLevel !== undefined && !REASONING.includes(value.defaultReasoningLevel)) {
      res.status(400).json({ error: { code: 'VALIDATION_ERROR', message: 'The selected reasoning preference is invalid.' } });
      return;
    }
    const preferredModels = value.preferredTextModelsByConnection;
    if (preferredModels !== undefined && (!preferredModels || typeof preferredModels !== 'object' || Array.isArray(preferredModels) ||
      Object.entries(preferredModels).some(([connectionId, modelId]) => connectionId !== 'chatgpt-plan' || !validModelId(modelId)))) {
      res.status(400).json({ error: { code: 'VALIDATION_ERROR', message: 'Connection-scoped preferred text models are invalid.' } });
      return;
    }
    const preferredReasoning = value.preferredReasoningLevelsByConnection;
    if (preferredReasoning !== undefined && (!preferredReasoning || typeof preferredReasoning !== 'object' || Array.isArray(preferredReasoning) ||
      Object.entries(preferredReasoning).some(([connectionId, level]) => connectionId !== 'chatgpt-plan' || !REASONING.includes(level as AiReasoningLevel)))) {
      res.status(400).json({ error: { code: 'VALIDATION_ERROR', message: 'Connection-scoped preferred reasoning levels are invalid.' } });
      return;
    }
    if (value.defaultConnectionId !== 'gemini-managed' && !value.defaultTextModelId) {
      res.status(400).json({ error: { code: 'VALIDATION_ERROR', message: 'Choose a model from the refreshed account catalog before saving this default connection.' } });
      return;
    }
    if (!value.defaultTextModelId && value.defaultReasoningLevel && value.defaultReasoningLevel !== 'default') {
      res.status(400).json({ error: { code: 'VALIDATION_ERROR', message: 'Choose a verified model before setting a non-default reasoning level.' } });
      return;
    }
    if (value.defaultTextModelId) {
      const model = getCachedProviderModel(value.defaultConnectionId, value.defaultTextModelId);
      if (!model || model.availability.state !== 'supported' || model.textGeneration.state !== 'supported' || !hasSupportedOperation(model)) {
        res.status(400).json({ error: { code: 'VALIDATION_ERROR', message: 'The default model is not verified for an available PCC operation. Refresh its catalog and choose a model with a supported operation.' } });
        return;
      }
      try { assertReasoningSelection(model, value.defaultReasoningLevel); }
      catch {
        res.status(400).json({ error: { code: 'VALIDATION_ERROR', message: 'The default reasoning preference is not verified for this model.' } });
        return;
      }
    }
    if (value.operationOverrides !== undefined && (!value.operationOverrides || typeof value.operationOverrides !== 'object' || Array.isArray(value.operationOverrides))) {
      res.status(400).json({ error: { code: 'VALIDATION_ERROR', message: 'Operation preferences are invalid.' } });
      return;
    }
    if (value.operationOverrides && Object.entries(value.operationOverrides).some(([operation, rawOverride]) => {
      if (!VALID_OPERATIONS.has(operation as AiOperation) || !rawOverride || typeof rawOverride !== 'object' || Array.isArray(rawOverride)) return true;
      if (operation === 'image') return true;
      const override = rawOverride as Record<string, unknown>;
      if (!SELECTABLE_IDS.includes(override.connectionId as AiConnectionId)) return true;
      if (override.modelId !== undefined && !validModelId(override.modelId)) return true;
      if (typeof override.modelId !== 'string') return true;
      if (override.reasoningLevel !== undefined && !REASONING.includes(override.reasoningLevel as AiReasoningLevel)) return true;
      const model = getCachedProviderModel(override.connectionId as AiConnectionId, override.modelId);
      if (!model || model.availability.state !== 'supported' || model.operationCapabilities[operation as AiOperation]?.state !== 'supported') return true;
      try { assertReasoningSelection(model, override.reasoningLevel as AiReasoningLevel | undefined); }
      catch { return true; }
      return false;
    })) {
      res.status(400).json({ error: { code: 'VALIDATION_ERROR', message: 'One or more operation preferences are invalid.' } });
      return;
    }
    setPreferences(value);
    res.json({ preferences: getPreferences() });
  });

  router.post('/gemini-key', requireLoopback, (req, res) => {
    const apiKey = req.body?.apiKey;
    if (typeof apiKey !== 'string' || apiKey.trim().length < 20 || apiKey.length > 512 || /[\r\n]/.test(apiKey)) {
      res.status(400).json({ error: { code: 'VALIDATION_ERROR', message: 'Enter a valid-looking Gemini key. The key is not sent to Google until you refresh its model catalog or use it for an explicit request.' } });
      return;
    }
    setPersonalGeminiKey(apiKey.trim());
    setSessionGeminiKey(apiKey.trim());
    res.json({ acceptedForThisSession: true, persistentStorage: false });
  });
  router.delete('/gemini-key', requireLoopback, (_req, res) => {
    setPersonalGeminiKey(undefined);
    setSessionGeminiKey(undefined);
    res.json({ cleared: true });
  });

  router.post('/openai-api-key', requireLoopback, (req, res) => {
    const apiKey = req.body?.apiKey;
    if (typeof apiKey !== 'string' || apiKey.trim().length < 20 || apiKey.length > 512 || /[\r\n]/.test(apiKey)) {
      res.status(400).json({ error: { code: 'VALIDATION_ERROR', message: 'Enter a valid-looking OpenAI API key. Saving it does not contact OpenAI; only a catalog refresh or explicitly selected AI request will use it.' } });
      return;
    }
    setOpenAiApiKey(apiKey.trim());
    res.json({ acceptedForThisSession: true, persistentStorage: false });
  });
  router.delete('/openai-api-key', requireLoopback, (_req, res) => {
    setOpenAiApiKey(undefined);
    res.json({ cleared: true });
  });

  router.post('/chatgpt/authorize', requireLoopback, async (req, res) => {
    const generation = ++authGeneration;
    try {
      const client = await createOAuthClient(req);
      const result = await client.createAuthorizationRequest();
      if (generation !== authGeneration) {
        client.cancelAuthorization(result.state);
        res.status(409).json({ error: { code: 'AUTH_CANCELLED', message: 'ChatGPT authorization was cancelled. Start again if you still want to connect.' } });
        return;
      }
      if (oauthClient && pendingOAuthState) oauthClient.cancelAuthorization(pendingOAuthState);
      oauthClient = client;
      pendingOAuthState = result.state;
      res.json({ authorizationUrl: result.url });
    } catch {
      res.status(503).json({ error: { code: 'AUTH_UNAVAILABLE', message: 'Official ChatGPT authorization could not be started. Check the local connection and try again.' } });
    }
  });

  router.get('/auth/callback', requireLoopbackOAuthCallback, async (req, res) => {
    const { code, state, client_id: clientId, error } = req.query;
    if (typeof state !== 'string') { res.status(400).send('Authorization state is invalid. Return to PCC and try again.'); return; }
    if (typeof error === 'string') {
      const callbackClient = oauthClient;
      const cancelled = callbackClient?.cancelAuthorization(state) ?? false;
      if (!cancelled) { res.status(400).send('ChatGPT authorization state is invalid or expired. Return to PCC and try again.'); return; }
      if (callbackClient === oauthClient && pendingOAuthState === state) { oauthClient = undefined; pendingOAuthState = undefined; }
      res.status(400).send('ChatGPT authorization was cancelled or declined. You may close this tab.'); return;
    }
    if (typeof code !== 'string' || (clientId !== undefined && typeof clientId !== 'string') || !oauthClient) {
      res.status(400).send('ChatGPT authorization could not be completed. Return to PCC and retry.'); return;
    }
    try {
      const callbackClient = oauthClient;
      const callbackGeneration = authGeneration;
      const completed = await callbackClient.completeAuthorization({ code, state, ...(typeof clientId === 'string' ? { clientId } : {}) });
      if (callbackGeneration !== authGeneration || callbackClient !== oauthClient || pendingOAuthState !== state) {
        res.status(409).send('ChatGPT authorization was cancelled before it could be connected. Return to PCC and start again.');
        return;
      }
      const identity = await loadIdentity();
      const updated = { ...identity, issuedClientId: completed.clientId };
      await saveIdentity(updated);
      if (callbackGeneration !== authGeneration || callbackClient !== oauthClient || pendingOAuthState !== state) {
        res.status(409).send('ChatGPT authorization was cancelled before it could be connected. Return to PCC and start again.');
        return;
      }
      identityCache = updated;
      chatGptSessionStore.install(completed.tokens);
      oauthClient = undefined;
      pendingOAuthState = undefined;
      setChatGptModels([]);
      res.type('html').send('<!doctype html><html><head><meta charset="utf-8"><title>PCC connected</title></head><body><main><h1>ChatGPT account connected</h1><p>Return to Proactive Co-Creator and refresh connection status. You may close this tab.</p></main></body></html>');
    } catch {
      if (pendingOAuthState === state) { oauthClient = undefined; pendingOAuthState = undefined; }
      res.status(400).send('ChatGPT authorization could not be verified. Return to PCC and start a new authorization.');
    }
  });

  router.post('/chatgpt/disconnect', requireLoopback, async (_req, res) => {
    const tokens = disconnectSessionStore.takeForRevocation();
    authGeneration += 1;
    if (oauthClient && pendingOAuthState) oauthClient.cancelAuthorization(pendingOAuthState);
    oauthClient = undefined;
    pendingOAuthState = undefined;
    setChatGptModels([]);
    if (!tokens) { res.json({ clearedLocally: true, remoteRevocation: 'not-connected' }); return; }
    const clientId = options.issuedClientId?.() ?? identityCache?.issuedClientId;
    if (!clientId || !tokens.refreshToken) { tokens.refreshToken = undefined; res.json({ clearedLocally: true, remoteRevocation: 'endpoint-unavailable' }); return; }
    try {
      const metadata = await discoverIssuer();
      if (!metadata.revocation_endpoint) { tokens.refreshToken = undefined; res.json({ clearedLocally: true, remoteRevocation: 'endpoint-unavailable' }); return; }
      await disconnectSessionStore.revoke(clientId, metadata.revocation_endpoint, tokens);
      res.json({ clearedLocally: true, remoteRevocation: 'acknowledged' });
    } catch {
      tokens.refreshToken = undefined;
      res.json({ clearedLocally: true, remoteRevocation: 'not-confirmed' });
    }
  });

  return router;
}

export function resolveClientSelection(req: Request): { connectionId: AiConnectionId; modelId?: string; reasoningLevel?: AiReasoningLevel } | undefined {
  const rawConnection = req.get('x-pcc-ai-connection');
  const rawModel = req.get('x-pcc-ai-model');
  const rawReasoning = req.get('x-pcc-ai-reasoning');
  if (!rawConnection && !rawModel && !rawReasoning) return undefined;
  const connectionId = rawConnection && VALID_IDS.includes(rawConnection as AiConnectionId) ? rawConnection as AiConnectionId : undefined;
  if (!connectionId) return undefined;
  if (PERSONAL_IDS.includes(connectionId) && !hasSameOriginLocalRequest(req)) return undefined;
  if (rawModel && (rawModel.length > 160 || /[^A-Za-z0-9._:/-]/.test(rawModel))) return undefined;
  if (rawReasoning && !REASONING.includes(rawReasoning as AiReasoningLevel)) return undefined;
  return { connectionId, ...(rawModel ? { modelId: rawModel } : {}), ...(rawReasoning ? { reasoningLevel: rawReasoning as AiReasoningLevel } : {}) };
}
