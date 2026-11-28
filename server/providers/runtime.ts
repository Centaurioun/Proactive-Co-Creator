import type { AiConnectionDescriptor, AiConnectionId, AiModelDescriptor, AiProviderAdapter, AiProviderSelection, ProviderPreferences } from './contracts.ts';
import { AI_OPERATION_POLICIES, type AiOperation } from '../aiBudget.ts';
import { createGeminiAdapter } from './geminiAdapter.ts';
import { ChatGptResponsesAdapter } from './chatgptResponses.ts';
import { chatGptSessionStore } from '../auth/chatgpt/runtime.ts';
import { getGeminiClient, hasConfiguredGeminiKey } from '../geminiClient.ts';
import { AppApiError } from '../errors.ts';
import { randomUUID } from 'node:crypto';
import { CAPABILITY_POLICY_VERSION } from './policy.ts';

export type { ProviderPreferences };

const DEFAULT_PREFERENCES: ProviderPreferences = { defaultConnectionId: 'gemini-managed' };
let preferences: ProviderPreferences = { ...DEFAULT_PREFERENCES };
let personalGeminiKey: string | undefined;
let openAiApiKey: string | undefined;
let openAiApiVerified = false;
let personalGeminiVerified = false;
let personalGeminiModels: AiModelDescriptor[] = [];
let managedGeminiModels: AiModelDescriptor[] = [];
let chatGptModels: AiModelDescriptor[] = [];
let openAiApiModels: AiModelDescriptor[] = [];
const observed = new Map<AiConnectionId, number>();
// Opaque, non-secret runtime identity. It intentionally changes on process
// restart so persisted work cannot silently resume against an unqualified
// credential authority.
const processAuthorityId = randomUUID();
interface CredentialAuthorityState { generation: number; active: Set<AbortController> }
const credentialAuthorities = new Map<AiConnectionId, CredentialAuthorityState>([
  ['gemini-personal', { generation: 0, active: new Set() }],
  ['openai-api', { generation: 0, active: new Set() }],
]);

function authorityState(connectionId: AiConnectionId): CredentialAuthorityState {
  let state = credentialAuthorities.get(connectionId);
  if (!state) { state = { generation: 0, active: new Set() }; credentialAuthorities.set(connectionId, state); }
  return state;
}

export function getCredentialAuthorityId(connectionId: AiConnectionId): string {
  const generation = connectionId === 'chatgpt-plan'
    ? chatGptSessionStore.getGeneration()
    : authorityState(connectionId).generation;
  return `${processAuthorityId}:${connectionId}:${generation}`;
}

function invalidateCredentialAuthority(connectionId: AiConnectionId): void {
  const state = authorityState(connectionId);
  state.generation += 1;
  for (const controller of state.active) controller.abort(new AppApiError('CANCELLED', 'Provider credential change cancelled this operation.', 499, false));
  state.active.clear();
}

function beginCredentialRequest(connectionId: AiConnectionId, parentSignal?: AbortSignal, expectedGeneration = authorityState(connectionId).generation) {
  const state = authorityState(connectionId);
  if (state.generation !== expectedGeneration || parentSignal?.aborted) {
    throw new AppApiError('CANCELLED', 'The provider credential changed before this operation could start.', 499, false);
  }
  const controller = new AbortController();
  const abortParent = () => controller.abort(parentSignal?.reason);
  parentSignal?.addEventListener('abort', abortParent, { once: true });
  state.active.add(controller);
  let released = false;
  return {
    generation: expectedGeneration,
    signal: controller.signal,
    assertCurrent: () => {
      if (state.generation !== expectedGeneration || controller.signal.aborted) {
        throw new AppApiError('CANCELLED', 'The provider credential changed; the stale result was discarded.', 499, false);
      }
    },
    release: () => {
      if (released) return;
      released = true;
      parentSignal?.removeEventListener('abort', abortParent);
      state.active.delete(controller);
      controller.abort();
    },
  };
}

export function getPreferences(): ProviderPreferences {
  return structuredClone(preferences);
}

export function setPreferences(value: ProviderPreferences): void {
  preferences = structuredClone(value);
}

export function setPersonalGeminiKey(value: string | undefined): void {
  invalidateCredentialAuthority('gemini-personal');
  personalGeminiKey = value;
  personalGeminiVerified = false;
  personalGeminiModels = [];
}

export function hasPersonalGeminiKey(): boolean { return Boolean(personalGeminiKey); }

export function setOpenAiApiKey(value: string | undefined): void {
  invalidateCredentialAuthority('openai-api');
  openAiApiKey = value;
  openAiApiVerified = false;
  openAiApiModels = [];
}

export function hasOpenAiApiKey(): boolean { return Boolean(openAiApiKey); }

export function createOpenAiApiAdapter(fetchImpl: typeof fetch = fetch): ChatGptResponsesAdapter {
  const keySnapshot = openAiApiKey;
  const credentialGeneration = authorityState('openai-api').generation;
  return new ChatGptResponsesAdapter(keySnapshot ?? (() => {
    throw new AppApiError('AUTH_ERROR', 'Add an OpenAI API key for this server session before using OpenAI API billing.', 401, false);
  }), fetchImpl, (parentSignal) => {
    const lease = beginCredentialRequest('openai-api', parentSignal, credentialGeneration);
    return { signal: lease.signal, release: lease.release };
  }, 'openai-api');
}

export function getChatGptModels(): AiModelDescriptor[] { return structuredClone(chatGptModels); }
export function setChatGptModels(value: AiModelDescriptor[]): void { chatGptModels = structuredClone(value); }
export function hasCachedProviderModels(connectionId: AiConnectionId): boolean {
  const list = connectionId === 'gemini-managed' ? managedGeminiModels
    : connectionId === 'gemini-personal' ? personalGeminiModels
    : connectionId === 'chatgpt-plan' ? chatGptModels : openAiApiModels;
  return list.length > 0;
}
export function getCachedProviderModel(connectionId: AiConnectionId, modelId: string): AiModelDescriptor | undefined {
  const list = connectionId === 'gemini-managed' ? managedGeminiModels
    : connectionId === 'gemini-personal' ? personalGeminiModels
    : connectionId === 'chatgpt-plan' ? chatGptModels : openAiApiModels;
  const model = list.find((item) => item.id === modelId);
  return model ? structuredClone(model) : undefined;
}

export async function listProviderModels(connectionId: AiConnectionId, signal?: AbortSignal, adapterFactory?: (id: AiConnectionId) => AiProviderAdapter): Promise<AiModelDescriptor[]> {
  if (connectionId === 'gemini-managed') {
    managedGeminiModels = await createGeminiAdapter({ connectionId, managedClientFactory: () => getGeminiClient() as never }).listModels(signal);
    return managedGeminiModels;
  }
  if (connectionId === 'gemini-personal') {
    if (!personalGeminiKey) throw new AppApiError('MISSING_API_KEY', 'Enter a Gemini API key for this session before refreshing its model list.', 503, false);
    const keySnapshot = personalGeminiKey;
    const lease = beginCredentialRequest(connectionId, signal);
    try {
      const models = await (adapterFactory?.(connectionId) ?? createGeminiAdapter({ connectionId, personalApiKey: keySnapshot })).listModels(lease.signal);
      lease.assertCurrent();
      personalGeminiVerified = true;
      personalGeminiModels = structuredClone(models);
      return structuredClone(models);
    } finally { lease.release(); }
  }
  if (connectionId === 'chatgpt-plan') {
    if (!chatGptSessionStore.snapshot().connected) throw new AppApiError('AUTH_ERROR', 'Connect a ChatGPT account before refreshing its model list.', 401, false);
    const generation = chatGptSessionStore.getGeneration();
    const adapter = adapterFactory?.(connectionId) ?? createChatGptAdapter(generation);
    const models = await adapter.listModels(signal);
    if (chatGptSessionStore.getGeneration() !== generation || !chatGptSessionStore.snapshot().connected) {
      throw new AppApiError('CANCELLED', 'The ChatGPT session changed; its stale model catalog was discarded.', 499, false);
    }
    setChatGptModels(models);
    return models;
  }
  if (!openAiApiKey) throw new AppApiError('MISSING_API_KEY', 'Enter an OpenAI API key for this session before refreshing its model list.', 503, false);
  const keySnapshot = openAiApiKey;
  const lease = beginCredentialRequest(connectionId, signal);
  try {
    const models = await (adapterFactory?.(connectionId) ?? createOpenAiApiAdapter()).listModels(lease.signal);
    lease.assertCurrent();
    if (openAiApiKey !== keySnapshot) throw new AppApiError('CANCELLED', 'The OpenAI API key changed; its stale model catalog was discarded.', 499, false);
    openAiApiVerified = true;
    openAiApiModels = structuredClone(models);
    return structuredClone(models);
  } finally { lease.release(); }
}

let chatGptAdapterFactory: ((expectedGeneration?: number) => ChatGptResponsesAdapter) | undefined;
export function registerChatGptAdapterFactory(factory: (expectedGeneration?: number) => ChatGptResponsesAdapter): void { chatGptAdapterFactory = factory; }
export function createChatGptAdapter(expectedGeneration?: number): ChatGptResponsesAdapter {
  if (!chatGptAdapterFactory) throw new AppApiError('AUTH_ERROR', 'ChatGPT account authorization is not available in this process.', 503, false);
  return chatGptAdapterFactory(expectedGeneration);
}

export function connectionDescriptors(localPersonalConnectionsAvailable: boolean): AiConnectionDescriptor[] {
  const managedConfigured = hasConfiguredGeminiKey();
  const chatGptState = chatGptSessionStore.snapshot().connected ? 'connected' : localPersonalConnectionsAvailable ? 'authorization-required' : 'unsupported-environment';
  return [
    { id: 'gemini-managed', family: 'gemini', billing: 'host-managed-gemini', state: managedConfigured ? 'available' : 'unconfigured', selectedModelId: 'gemini-4-hydrogen', models: managedGeminiModels, message: managedConfigured ? 'A server-managed Gemini credential is configured; provider reachability has not been checked.' : 'No host-managed Gemini credential is configured.' },
    { id: 'gemini-personal', family: 'gemini', billing: 'gemini-api-key', state: personalGeminiVerified ? 'connected' : personalGeminiKey ? 'available' : localPersonalConnectionsAvailable ? 'unconfigured' : 'unsupported-environment', models: personalGeminiModels, message: personalGeminiKey ? 'Session-only key is held in server memory; it is cleared on restart.' : localPersonalConnectionsAvailable ? 'Add a key for this server session. Secure persistent storage is not configured.' : 'Personal provider credentials are unavailable on a remote host.' },
    { id: 'chatgpt-plan', family: 'openai', billing: 'chatgpt-plan', state: chatGptState, models: chatGptModels, message: chatGptSessionStore.snapshot().connected ? 'Using ChatGPT plan access. Quota is not exposed to this app.' : localPersonalConnectionsAvailable ? 'Sign in through the official ChatGPT authorization flow.' : 'ChatGPT account connections are limited to local loopback access.' },
    { id: 'openai-api', family: 'openai', billing: 'openai-api-key', state: localPersonalConnectionsAvailable ? openAiApiVerified ? 'connected' : openAiApiKey ? 'available' : 'unconfigured' : 'unsupported-environment', models: openAiApiModels, message: !localPersonalConnectionsAvailable ? 'OpenAI API credentials are only available in a local PCC runtime.' : openAiApiKey ? 'The API key is held in server memory only. OpenAI API usage is billed separately from a ChatGPT plan.' : 'Optional OpenAI API billing is off until you add a key and explicitly select this connection.' },
  ];
}

export function providerHubStatus(localPersonalConnectionsAvailable: boolean) {
  return {
    localPersonalConnectionsAvailable,
    capabilityPolicyVersion: CAPABILITY_POLICY_VERSION,
    credentialAuthorityIds: Object.fromEntries(
      (['gemini-managed', 'gemini-personal', 'chatgpt-plan', 'openai-api'] as const)
        .map(connectionId => [connectionId, getCredentialAuthorityId(connectionId)]),
    ),
    connections: connectionDescriptors(localPersonalConnectionsAvailable),
    preferences: getPreferences(),
    usage: {
      observedByConnection: Object.fromEntries(observed.entries()),
      quota: { state: 'unknown' as const },
    },
  };
}

export interface LegacyAiClientLike {
  models: {
    countTokens(params: { model: string; contents: unknown; config?: { abortSignal?: AbortSignal; systemInstruction?: unknown; responseSchema?: unknown; responseMimeType?: string; thinkingConfig?: unknown } }): Promise<{ totalTokens?: number; source?: 'provider-count' | 'estimate' }>;
    generateContent(params: { model: string; contents: unknown; config?: Record<string, unknown> }): Promise<{ text?: string; usageMetadata?: Record<string, unknown> }>;
    generateImages?(params: { model: string; prompt: string; config?: Record<string, unknown> }): Promise<unknown>;
  };
}

/** Creates the legacy SDK-shaped boundary without changing any public AI route schemas. */
export function createLegacyAiClient(selection: AiProviderSelection, operation: AiOperation, personalKey: string | undefined, getManagedClient: () => LegacyAiClientLike, adapterFactory?: (id: AiConnectionId) => AiProviderAdapter): LegacyAiClientLike {
  if (selection.connectionId === 'gemini-managed' && !selection.modelId && !selection.reasoningLevel) {
    return {
      models: {
        countTokens(params) {
          return getManagedClient().models.countTokens(params);
        },
        async generateContent(params) {
          const result = await getManagedClient().models.generateContent(params);
          observed.set('gemini-managed', (observed.get('gemini-managed') ?? 0) + 1);
          return result;
        },
        async generateImages(params) {
          const managed = getManagedClient();
          if (!managed.models.generateImages) {
            throw new AppApiError('MODEL_UNSUPPORTED', 'The selected connection cannot generate images.', 422, false);
          }
          const result = await managed.models.generateImages(params);
          observed.set('gemini-managed', (observed.get('gemini-managed') ?? 0) + 1);
          return result;
        },
      },
    };
  }
  const credentialGeneration = authorityState(selection.connectionId).generation;
  const chatGptGeneration = selection.connectionId === 'chatgpt-plan' ? chatGptSessionStore.getGeneration() : undefined;
  const adapter: AiProviderAdapter = adapterFactory?.(selection.connectionId) ?? (selection.connectionId.startsWith('gemini-')
    ? createGeminiAdapter({ connectionId: selection.connectionId as 'gemini-managed' | 'gemini-personal', personalApiKey: personalKey, managedClientFactory: () => getManagedClient() as never })
    : selection.connectionId === 'chatgpt-plan' ? createChatGptAdapter(chatGptGeneration) : createOpenAiApiAdapter());
  const withCredentialAuthority = async <T>(signal: AbortSignal | undefined, work: (requestSignal: AbortSignal) => Promise<T>): Promise<T> => {
    const lease = beginCredentialRequest(selection.connectionId, signal, credentialGeneration);
    try {
      if (chatGptGeneration !== undefined && chatGptSessionStore.getGeneration() !== chatGptGeneration) {
        throw new AppApiError('CANCELLED', 'The ChatGPT session changed; its stale operation was discarded.', 499, false);
      }
      const result = await work(lease.signal);
      lease.assertCurrent();
      if (chatGptGeneration !== undefined && chatGptSessionStore.getGeneration() !== chatGptGeneration) {
        throw new AppApiError('CANCELLED', 'The ChatGPT session changed; its stale result was discarded.', 499, false);
      }
      return result;
    } finally { lease.release(); }
  };

  return {
    models: {
      async countTokens(params) {
        const contents = typeof params.contents === 'string' ? params.contents : JSON.stringify(params.contents);
        const instructions = typeof params.config?.systemInstruction === 'string' ? params.config.systemInstruction : undefined;
        const result = await withCredentialAuthority(params.config?.abortSignal, requestSignal => adapter.countTokens(selection.modelId ?? params.model, contents, requestSignal, instructions, {
          responseSchema: params.config?.responseSchema,
          responseMimeType: params.config?.responseMimeType,
          thinkingConfig: params.config?.thinkingConfig,
        }));
        return { totalTokens: result.tokens, source: result.source };
      },
      async generateContent(params) {
        const contents = typeof params.contents === 'string' ? params.contents : JSON.stringify(params.contents);
        const config = params.config ?? {};
        if (config.maxOutputTokens !== undefined && (!Number.isSafeInteger(config.maxOutputTokens) || Number(config.maxOutputTokens) <= 0)) {
          throw new AppApiError('VALIDATION_ERROR', 'The generation output-token cap must be a positive integer.', 400, false);
        }
        const maxOutputTokens = Math.min(
          typeof config.maxOutputTokens === 'number' ? config.maxOutputTokens : AI_OPERATION_POLICIES[operation].maxOutputTokens,
          AI_OPERATION_POLICIES[operation].maxOutputTokens,
        );
        const effectiveModelId = selection.modelId ?? params.model;
        const cachedModel = getCachedProviderModel(selection.connectionId, effectiveModelId);
        const omitUnsupportedThinking = cachedModel?.reasoning.state === 'unsupported' && (!selection.reasoningLevel || selection.reasoningLevel === 'default');
        const result = await withCredentialAuthority(config.abortSignal instanceof AbortSignal ? config.abortSignal : undefined, requestSignal => adapter.generateText({
          operation,
          modelId: effectiveModelId,
          input: contents,
          instructions: typeof config.systemInstruction === 'string' ? config.systemInstruction : undefined,
          responseSchema: config.responseSchema,
          responseMimeType: typeof config.responseMimeType === 'string' ? config.responseMimeType : undefined,
          thinkingConfig: omitUnsupportedThinking ? undefined : config.thinkingConfig,
          reasoningLevel: selection.reasoningLevel ?? 'default',
          maxInputBytes: 512 * 1024,
          maxOutputBytes: 128 * 1024,
          maxOutputTokens,
          timeoutMs: 120_000,
          signal: requestSignal,
        }));
        observed.set(selection.connectionId, (observed.get(selection.connectionId) ?? 0) + 1);
        return { text: result.text, usageMetadata: result.usage?.source === 'provider-observed' ? { promptTokenCount: result.usage.inputTokens, candidatesTokenCount: result.usage.outputTokens } : undefined };
      },
      async generateImages(params) {
        if (!adapter.generateImage) throw new AppApiError('MODEL_UNSUPPORTED', 'The selected connection cannot generate images.', 422, false);
        return withCredentialAuthority(undefined, requestSignal => adapter.generateImage!({ operation: 'image', modelId: selection.modelId ?? params.model, input: params.prompt, maxInputBytes: 64 * 1024, maxOutputBytes: 8 * 1024 * 1024, timeoutMs: 120_000, signal: requestSignal }));
      },
    },
  };
}
