import express, { type Request, type Response, type Router } from 'express';
import { ChatGptOAuthClient, discoverOpenId } from './auth/chatgpt/oauth.ts';
import { chatGptSessionStore } from './auth/chatgpt/runtime.ts';
import type { ChatGptSessionStore } from './auth/chatgpt/sessionStore.ts';
import { setSessionGeminiKey } from './geminiClient.ts';
import type { AiConnectionId, AiModelDescriptor, AiProviderSelection, AiReasoningLevel } from './providers/contracts.ts';
import { ChatGptResponsesAdapter } from './providers/chatgptResponses.ts';
import { createHostIdentityStore, type HostIdentityStore } from './providers/hostIdentityStore.ts';
import {
  hasSameOriginLocalRequest,
  portForRequest,
  requireLoopback,
  requireLoopbackOAuthCallback,
} from './providers/localOriginGuard.ts';
import {
  isValidModelId,
  PERSONAL_CONNECTION_IDS,
  REASONING_LEVELS,
  VALID_CONNECTION_IDS,
  validateAndNormalizePreferences,
} from './providers/preferenceValidation.ts';
import {
  getPreferences,
  listProviderModels,
  providerHubStatus,
  registerChatGptAdapterFactory,
  setChatGptModels,
  setOpenAiApiKey,
  setPersonalGeminiKey,
  setPreferences,
} from './providers/runtime.ts';

const AUTH_ORIGIN = 'https://auth.openai.com';
const TOKEN_ENDPOINT = `${AUTH_ORIGIN}/api/accounts/oauth/token`;
const CALLBACK_PATH = '/api/ai/provider-hub/auth/callback';

export { hasSameOriginLocalRequest };

export interface ProviderHubRouterOptions {
  sessionStore?: ChatGptSessionStore;
  disconnectSessionStore?: ChatGptSessionStore;
  discoverOpenId?: typeof discoverOpenId;
  issuedClientId?: () => string | undefined;
  identityFilePath?: string;
  oauthFetch?: typeof fetch;
  /** In-process synthetic catalog for browser qualification; never configured by the production entry point. */
  chatGptStoryQualificationCatalog?: readonly AiModelDescriptor[];
}

interface PendingOAuthFlow {
  client: ChatGptOAuthClient;
  state: string;
  generation: number;
}

function isValidApiKeyInput(apiKey: unknown): apiKey is string {
  return typeof apiKey === 'string' && apiKey.trim().length >= 20 && apiKey.length <= 512 && !/[\r\n]/.test(apiKey);
}

function registerSessionKeyRoute(
  router: Router,
  path: string,
  invalidMessage: string,
  applyKey: (key: string | undefined) => void,
): void {
  router.post(path, requireLoopback, (req, res) => {
    const apiKey = req.body?.apiKey;
    if (!isValidApiKeyInput(apiKey)) {
      res.status(400).json({ error: { code: 'VALIDATION_ERROR', message: invalidMessage } });
      return;
    }
    applyKey(apiKey.trim());
    res.json({ acceptedForThisSession: true, persistentStorage: false });
  });
  router.delete(path, requireLoopback, (_req, res) => {
    applyKey(undefined);
    res.json({ cleared: true });
  });
}

function createChatGptOAuthRouterState(
  options: ProviderHubRouterOptions,
  identityStore: HostIdentityStore,
  sessionStore: ChatGptSessionStore,
) {
  let pendingFlow: PendingOAuthFlow | undefined;
  let inFlightFlow: PendingOAuthFlow | undefined;
  let authGeneration = 0;

  const registerAdapter = () => {
    registerChatGptAdapterFactory((requestedGeneration) => {
      const clientId = identityStore.getCached()?.issuedClientId;
      if (!clientId || !sessionStore.snapshot().connected) {
        throw new Error('ChatGPT authorization is required.');
      }
      const generation = requestedGeneration ?? sessionStore.getGeneration();
      return new ChatGptResponsesAdapter(
        () => sessionStore.getAccessToken(clientId, TOKEN_ENDPOINT, generation),
        fetch,
        (signal) => sessionStore.createRequestLease(signal, generation),
      );
    });
  };

  const cancelPendingFlow = () => {
    if (pendingFlow) {
      pendingFlow.client.cancelAuthorization(pendingFlow.state);
      pendingFlow = undefined;
    }
    inFlightFlow = undefined;
  };

  const createOAuthClientForRequest = async (req: Request): Promise<ChatGptOAuthClient> => {
    const identity = await identityStore.load();
    return new ChatGptOAuthClient({
      ...(identity.issuedClientId ? { clientId: identity.issuedClientId } : {}),
      redirectUri: `http://127.0.0.1:${portForRequest(req)}${CALLBACK_PATH}`,
      extAgentHostId: identity.hostId,
      agentNameHint: 'Proactive Co-Creator',
      ...(options.oauthFetch ? { fetch: options.oauthFetch } : {}),
    });
  };

  return {
    getGeneration: () => authGeneration,
    bumpGenerationAndCancel: () => {
      authGeneration += 1;
      cancelPendingFlow();
    },
    registerAdapter,
    async handleAuthorize(req: Request, res: Response): Promise<void> {
      const generation = ++authGeneration;
      try {
        const client = await createOAuthClientForRequest(req);
        const result = await client.createAuthorizationRequest();
        if (generation !== authGeneration) {
          client.cancelAuthorization(result.state);
          res.status(409).json({ error: { code: 'AUTH_CANCELLED', message: 'ChatGPT authorization was cancelled. Start again if you still want to connect.' } });
          return;
        }
        cancelPendingFlow();
        pendingFlow = { client, state: result.state, generation };
        res.json({ authorizationUrl: result.url });
      } catch {
        res.status(503).json({ error: { code: 'AUTH_UNAVAILABLE', message: 'Official ChatGPT authorization could not be started. Check the local connection and try again.' } });
      }
    },
    async handleCallback(req: Request, res: Response): Promise<void> {
      const { code, state, client_id: clientId, error } = req.query;
      if (typeof state !== 'string') {
        res.status(400).send('Authorization state is invalid. Return to PCC and try again.');
        return;
      }
      if (typeof error === 'string') {
        const cancelled = pendingFlow?.state === state && pendingFlow.client.cancelAuthorization(state);
        if (!cancelled) {
          res.status(400).send('ChatGPT authorization state is invalid or expired. Return to PCC and try again.');
          return;
        }
        pendingFlow = undefined;
        res.status(400).send('ChatGPT authorization was cancelled or declined. You may close this tab.');
        return;
      }
      if (typeof code !== 'string' || (clientId !== undefined && typeof clientId !== 'string') || pendingFlow?.state !== state) {
        res.status(400).send('ChatGPT authorization could not be completed. Return to PCC and retry.');
        return;
      }
      const claimed = pendingFlow;
      pendingFlow = undefined;
      inFlightFlow = claimed;
      try {
        const completed = await claimed.client.completeAuthorization({
          code,
          state,
          ...(typeof clientId === 'string' ? { clientId } : {}),
        });
        if (claimed.generation !== authGeneration || inFlightFlow !== claimed) {
          res.status(409).send('ChatGPT authorization was cancelled before it could be connected. Return to PCC and start again.');
          return;
        }
        const identity = await identityStore.load();
        await identityStore.save({ ...identity, issuedClientId: completed.clientId });
        if (claimed.generation !== authGeneration || inFlightFlow !== claimed) {
          res.status(409).send('ChatGPT authorization was cancelled before it could be connected. Return to PCC and start again.');
          return;
        }
        sessionStore.install(completed.tokens);
        registerAdapter();
        inFlightFlow = undefined;
        setChatGptModels([]);
        res.type('html').send('<!doctype html><html><head><meta charset="utf-8"><title>PCC connected</title></head><body><main><h1>ChatGPT account connected</h1><p>Return to Proactive Co-Creator and refresh connection status. You may close this tab.</p></main></body></html>');
      } catch {
        if (inFlightFlow === claimed) inFlightFlow = undefined;
        res.status(400).send('ChatGPT authorization could not be verified. Return to PCC and start a new authorization.');
      }
    },
  };
}

export function createProviderHubRouter(options: ProviderHubRouterOptions = {}): Router {
  const router = express.Router();
  const sessionStore = options.sessionStore ?? chatGptSessionStore;
  const disconnectSessionStore = options.disconnectSessionStore ?? sessionStore;
  const discoverIssuer = options.discoverOpenId ?? discoverOpenId;
  const identityStore = createHostIdentityStore(options.identityFilePath);
  const oauthState = createChatGptOAuthRouterState(options, identityStore, sessionStore);

  if (options.chatGptStoryQualificationCatalog) {
    setChatGptModels([...options.chatGptStoryQualificationCatalog]);
  }

  router.get('/status', (req, res) => {
    const local = hasSameOriginLocalRequest(req);
    const status = providerHubStatus(local);
    if (options.chatGptStoryQualificationCatalog) {
      status.connections = status.connections.map(connection => connection.id === 'chatgpt-plan'
        ? { ...connection, state: 'connected', models: [...options.chatGptStoryQualificationCatalog!], message: 'Synthetic, key-free browser qualification connection.' }
        : connection);
    }
    res.json(status);
  });

  router.get('/models', requireLoopback, async (req, res) => {
    const connectionId = req.query.connectionId;
    if (typeof connectionId !== 'string' || !VALID_CONNECTION_IDS.includes(connectionId as AiConnectionId)) {
      res.status(400).json({ error: { code: 'VALIDATION_ERROR', message: 'Choose a supported connection to refresh its model catalog.' } });
      return;
    }
    try {
      if (connectionId === 'chatgpt-plan' && options.chatGptStoryQualificationCatalog) {
        res.json({ models: options.chatGptStoryQualificationCatalog });
        return;
      }
      if (connectionId === 'chatgpt-plan') {
        await identityStore.load();
        oauthState.registerAdapter();
      }
      const requestGeneration = oauthState.getGeneration();
      const models = await listProviderModels(connectionId as AiConnectionId);
      if (connectionId === 'chatgpt-plan' && (requestGeneration !== oauthState.getGeneration() || !sessionStore.snapshot().connected)) {
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
    const result = validateAndNormalizePreferences(req.body?.preferences, getPreferences());
    if (!result.ok) {
      res.status(400).json({ error: { code: 'VALIDATION_ERROR', message: result.message } });
      return;
    }
    setPreferences(result.preferences);
    res.json({ preferences: getPreferences() });
  });

  registerSessionKeyRoute(
    router,
    '/gemini-key',
    'Enter a valid-looking Gemini key. The key is not sent to Google until you refresh its model catalog or use it for an explicit request.',
    (key) => {
      setPersonalGeminiKey(key);
      setSessionGeminiKey(key);
    },
  );

  registerSessionKeyRoute(
    router,
    '/openai-api-key',
    'Enter a valid-looking OpenAI API key. Saving it does not contact OpenAI; only a catalog refresh or explicitly selected AI request will use it.',
    (key) => setOpenAiApiKey(key),
  );

  router.post('/chatgpt/authorize', requireLoopback, (req, res) => void oauthState.handleAuthorize(req, res));
  router.get('/auth/callback', requireLoopbackOAuthCallback, (req, res) => void oauthState.handleCallback(req, res));

  router.post('/chatgpt/disconnect', requireLoopback, async (_req, res) => {
    const tokens = disconnectSessionStore.takeForRevocation();
    oauthState.bumpGenerationAndCancel();
    setChatGptModels([]);
    if (!tokens) {
      res.json({ clearedLocally: true, remoteRevocation: 'not-connected' });
      return;
    }
    const clientId = options.issuedClientId?.() ?? identityStore.getCached()?.issuedClientId;
    if (!clientId || !tokens.refreshToken) {
      tokens.refreshToken = undefined;
      res.json({ clearedLocally: true, remoteRevocation: 'endpoint-unavailable' });
      return;
    }
    try {
      const metadata = await discoverIssuer();
      if (!metadata.revocation_endpoint) {
        tokens.refreshToken = undefined;
        res.json({ clearedLocally: true, remoteRevocation: 'endpoint-unavailable' });
        return;
      }
      await disconnectSessionStore.revoke(clientId, metadata.revocation_endpoint, tokens);
      res.json({ clearedLocally: true, remoteRevocation: 'acknowledged' });
    } catch {
      tokens.refreshToken = undefined;
      res.json({ clearedLocally: true, remoteRevocation: 'not-confirmed' });
    }
  });

  return router;
}

export function resolveClientSelection(req: Request): AiProviderSelection | undefined {
  const rawConnection = req.get('x-pcc-ai-connection');
  const rawModel = req.get('x-pcc-ai-model');
  const rawReasoning = req.get('x-pcc-ai-reasoning');
  if (!rawConnection && !rawModel && !rawReasoning) return undefined;
  const connectionId = rawConnection && VALID_CONNECTION_IDS.includes(rawConnection as AiConnectionId)
    ? rawConnection as AiConnectionId
    : undefined;
  if (!connectionId) return undefined;
  if (PERSONAL_CONNECTION_IDS.includes(connectionId) && !hasSameOriginLocalRequest(req)) return undefined;
  if (rawModel !== undefined && !isValidModelId(rawModel)) return undefined;
  if (rawReasoning !== undefined && !REASONING_LEVELS.includes(rawReasoning as AiReasoningLevel)) return undefined;
  return {
    connectionId,
    ...(rawModel ? { modelId: rawModel } : {}),
    ...(rawReasoning ? { reasoningLevel: rawReasoning as AiReasoningLevel } : {}),
  };
}
