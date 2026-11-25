import type { AiConnectionDescriptor, AiConnectionId, AiModelDescriptor, AiProviderAdapter, AiProviderSelection } from './contracts.ts';
import type { AiOperation } from '../aiBudget.ts';
import { createGeminiAdapter } from './geminiAdapter.ts';
import { ChatGptResponsesAdapter } from './chatgptResponses.ts';
import { chatGptSessionStore } from '../auth/chatgpt/runtime.ts';
import { getGeminiClient, hasConfiguredGeminiKey } from '../geminiClient.ts';
import { AppApiError } from '../errors.ts';

export interface ProviderPreferences {
  defaultConnectionId: AiConnectionId;
  defaultTextModelId?: string;
  defaultReasoningLevel?: AiProviderSelection['reasoningLevel'];
  operationOverrides?: Record<string, AiProviderSelection>;
}

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
const activeOpenAiRequests = new Set<AbortController>();

export function getPreferences(): ProviderPreferences {
  return structuredClone(preferences);
}

export function setPreferences(value: ProviderPreferences): void {
  preferences = structuredClone(value);
}

export function setPersonalGeminiKey(value: string | undefined): void {
  personalGeminiKey = value;
  personalGeminiVerified = false;
  personalGeminiModels = [];
}

export function hasPersonalGeminiKey(): boolean { return Boolean(personalGeminiKey); }

export function setOpenAiApiKey(value: string | undefined): void {
  for (const controller of activeOpenAiRequests) controller.abort(new Error('OpenAI API key changed.'));
  activeOpenAiRequests.clear();
  openAiApiKey = value;
  openAiApiVerified = false;
  openAiApiModels = [];
}

export function hasOpenAiApiKey(): boolean { return Boolean(openAiApiKey); }

export function createOpenAiApiAdapter(fetchImpl: typeof fetch = fetch): ChatGptResponsesAdapter {
  return new ChatGptResponsesAdapter(() => {
    if (!openAiApiKey) throw new AppApiError('AUTH_ERROR', 'Add an OpenAI API key for this server session before using OpenAI API billing.', 401, false);
    return openAiApiKey;
  }, fetchImpl, (parentSignal) => {
    const controller = new AbortController();
    const abortFromParent = () => controller.abort(parentSignal?.reason);
    if (parentSignal?.aborted) abortFromParent();
    else parentSignal?.addEventListener('abort', abortFromParent, { once: true });
    activeOpenAiRequests.add(controller);
    let released = false;
    return {
      signal: controller.signal,
      release: () => {
        if (released) return;
        released = true;
        parentSignal?.removeEventListener('abort', abortFromParent);
        activeOpenAiRequests.delete(controller);
        controller.abort();
      },
    };
  }, 'openai-api');
}

export function getChatGptModels(): AiModelDescriptor[] { return structuredClone(chatGptModels); }
export function setChatGptModels(value: AiModelDescriptor[]): void { chatGptModels = structuredClone(value); }
export function getCachedProviderModel(connectionId: AiConnectionId, modelId: string): AiModelDescriptor | undefined {
  const list = connectionId === 'gemini-managed' ? managedGeminiModels
    : connectionId === 'gemini-personal' ? personalGeminiModels
    : connectionId === 'chatgpt-plan' ? chatGptModels : openAiApiModels;
  const model = list.find((item) => item.id === modelId);
  return model ? structuredClone(model) : undefined;
}

export async function listProviderModels(connectionId: AiConnectionId, signal?: AbortSignal): Promise<AiModelDescriptor[]> {
  if (connectionId === 'gemini-managed') {
    managedGeminiModels = await createGeminiAdapter({ connectionId, managedClientFactory: () => getGeminiClient() as never }).listModels(signal);
    return managedGeminiModels;
  }
  if (connectionId === 'gemini-personal') {
    if (!personalGeminiKey) throw new AppApiError('MISSING_API_KEY', 'Enter a Gemini API key for this session before refreshing its model list.', 503, false);
    const models = await createGeminiAdapter({ connectionId, personalApiKey: personalGeminiKey }).listModels(signal);
    personalGeminiVerified = true;
    personalGeminiModels = models;
    return models;
  }
  if (connectionId === 'chatgpt-plan') {
    if (!chatGptSessionStore.snapshot().connected) throw new AppApiError('AUTH_ERROR', 'Connect a ChatGPT account before refreshing its model list.', 401, false);
    const adapter = createChatGptAdapter();
    const models = await adapter.listModels(signal);
    setChatGptModels(models);
    return models;
  }
  if (!openAiApiKey) throw new AppApiError('MISSING_API_KEY', 'Enter an OpenAI API key for this session before refreshing its model list.', 503, false);
  const models = await createOpenAiApiAdapter().listModels(signal);
  openAiApiVerified = true;
  openAiApiModels = models;
  return models;
}

let chatGptAdapterFactory: (() => ChatGptResponsesAdapter) | undefined;
export function registerChatGptAdapterFactory(factory: () => ChatGptResponsesAdapter): void { chatGptAdapterFactory = factory; }
export function createChatGptAdapter(): ChatGptResponsesAdapter {
  if (!chatGptAdapterFactory) throw new AppApiError('AUTH_ERROR', 'ChatGPT account authorization is not available in this process.', 503, false);
  return chatGptAdapterFactory();
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
    countTokens(params: { model: string; contents: unknown; config?: { abortSignal?: AbortSignal } }): Promise<{ totalTokens?: number; source?: 'provider-count' | 'estimate' }>;
    generateContent(params: { model: string; contents: unknown; config?: Record<string, unknown> }): Promise<{ text?: string; usageMetadata?: Record<string, unknown> }>;
    generateImages?(params: { model: string; prompt: string; config?: Record<string, unknown> }): Promise<unknown>;
  };
}

/** Creates the legacy SDK-shaped boundary without changing any public AI route schemas. */
export function createLegacyAiClient(selection: AiProviderSelection, operation: AiOperation, personalKey: string | undefined, getManagedClient: () => LegacyAiClientLike): LegacyAiClientLike {
  if (selection.connectionId === 'gemini-managed' && !selection.modelId && !selection.reasoningLevel) return getManagedClient();
  const adapter: AiProviderAdapter = selection.connectionId.startsWith('gemini-')
    ? createGeminiAdapter({ connectionId: selection.connectionId as 'gemini-managed' | 'gemini-personal', personalApiKey: personalKey, managedClientFactory: () => getManagedClient() as never })
    : selection.connectionId === 'chatgpt-plan' ? createChatGptAdapter() : createOpenAiApiAdapter();

  return {
    models: {
      async countTokens(params) {
        const contents = typeof params.contents === 'string' ? params.contents : JSON.stringify(params.contents);
        const result = await adapter.countTokens(selection.modelId ?? params.model, contents, params.config?.abortSignal);
        return { totalTokens: result.tokens, source: result.source };
      },
      async generateContent(params) {
        const contents = typeof params.contents === 'string' ? params.contents : JSON.stringify(params.contents);
        const config = params.config ?? {};
        const result = await adapter.generateText({
          operation,
          modelId: selection.modelId ?? params.model,
          input: contents,
          instructions: typeof config.systemInstruction === 'string' ? config.systemInstruction : undefined,
          responseSchema: config.responseSchema,
          reasoningLevel: selection.reasoningLevel ?? 'default',
          maxInputBytes: 512 * 1024,
          maxOutputBytes: typeof config.maxOutputTokens === 'number' ? config.maxOutputTokens * 4 : 128 * 1024,
          timeoutMs: 120_000,
          signal: config.abortSignal instanceof AbortSignal ? config.abortSignal : undefined,
        });
        observed.set(selection.connectionId, (observed.get(selection.connectionId) ?? 0) + 1);
        return { text: result.text, usageMetadata: result.usage?.source === 'provider-observed' ? { promptTokenCount: result.usage.inputTokens, candidatesTokenCount: result.usage.outputTokens } : undefined };
      },
      async generateImages(params) {
        if (!adapter.generateImage) throw new AppApiError('MODEL_UNSUPPORTED', 'The selected connection cannot generate images.', 422, false);
        return adapter.generateImage({ operation: 'image', modelId: selection.modelId ?? params.model, input: params.prompt, maxInputBytes: 64 * 1024, maxOutputBytes: 8 * 1024 * 1024, timeoutMs: 120_000 });
      },
    },
  };
}
