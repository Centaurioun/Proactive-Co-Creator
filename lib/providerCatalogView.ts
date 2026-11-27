import type { AiCapability, AiConnectionId, AiModelDescriptor, AiProviderSelection, AiReasoningLevel, ProviderPreferences } from '../server/providers/contracts';
import type { AiOperation } from '../server/aiBudget';
import { GEMINI_MODELS } from '../server/models';

export const PROVIDER_PREFERENCE_OPERATIONS = [
  ['analyze', 'Analysis'],
  ['clarify', 'Clarifications'],
  ['polish', 'Prompt refinement'],
  ['batch-edit', 'Batch editing'],
  ['story', 'Story generation'],
  ['image', 'Image generation'],
  ['narrative-import', 'Narrative import'],
  ['writing', 'Writing assistance'],
] as const;

export function safeEvidenceHref(reference: string): string | undefined {
  try {
    const parsed = new URL(reference);
    return parsed.protocol === 'http:' || parsed.protocol === 'https:' ? parsed.toString() : undefined;
  } catch {
    return undefined;
  }
}

export function supportedReasoningLevels(
  capability?: Pick<AiCapability<readonly AiReasoningLevel[]>, 'state'> & { value?: unknown },
): AiReasoningLevel[] {
  return capability?.state === 'supported' && Array.isArray(capability.value)
    ? ['default', ...capability.value.filter((level): level is AiReasoningLevel => typeof level === 'string')]
    : ['default'];
}

export function catalogPhasesForStatusRefresh(
  connections: readonly { id: string; models: unknown[] }[],
  currentPhases: Partial<Record<string, CatalogRefreshPhase>>,
  preserveFresh: boolean,
): Partial<Record<AiConnectionId, CatalogRefreshPhase>> {
  const next: Partial<Record<AiConnectionId, CatalogRefreshPhase>> = {};
  for (const connection of connections) {
    const existing = currentPhases[connection.id];
    if (preserveFresh && existing === 'fresh') {
      next[connection.id as AiConnectionId] = 'fresh';
    } else if (connection.models.length > 0 || preserveFresh) {
      next[connection.id as AiConnectionId] = 'stale';
    }
  }
  return next;
}

export function isChatGptStoryModelSelectable(
  model: { id: string; availability: { state: string }; textGeneration: { state: string } },
  preferredReasoning?: string,
): boolean {
  return model.id === 'gpt-6-luna' &&
    model.availability.state === 'supported' &&
    model.textGeneration.state === 'supported' &&
    (preferredReasoning ?? 'default') === 'default';
}

export function buildDefaultConnectionPreferences(
  connectionId: AiConnectionId,
  models: readonly AiModelDescriptor[],
  preferences: ProviderPreferences,
): { ok: true; preferences: ProviderPreferences } | { ok: false; error: string } {
  if (connectionId === 'chatgpt-plan') {
    const preferredModelId = preferences.preferredTextModelsByConnection?.['chatgpt-plan'];
    const preferredModel = models.find(model => model.id === preferredModelId && isSelectableTextPreferenceModel(model));
    const preferredReasoning = preferences.preferredReasoningLevelsByConnection?.['chatgpt-plan'];
    const reasoningIsValid = Boolean(preferredModel && preferredReasoning &&
      supportedReasoningLevels(preferredModel.reasoning).includes(preferredReasoning));
    return {
      ok: true,
      preferences: {
        ...preferences,
        defaultConnectionId: connectionId,
        defaultTextModelId: reasoningIsValid ? preferredModel!.id : undefined,
        defaultReasoningLevel: reasoningIsValid ? preferredReasoning : undefined,
      },
    };
  }
  const modelId = models.find(isEligibleTextModel)?.id;
  if (!modelId) {
    return {
      ok: false,
      error: 'No model has a verified PCC operation for this connection. Refresh its catalog or choose another connection.',
    };
  }
  return {
    ok: true,
    preferences: { ...preferences, defaultConnectionId: connectionId, defaultTextModelId: modelId, defaultReasoningLevel: 'default' },
  };
}

export function isModelSupportedForOperation(
  operation: string,
  connectionId: AiConnectionId,
  model: AiModelDescriptor | undefined,
  preferredChatGptReasoning?: string,
): boolean {
  if (!model || model.availability.state !== 'supported') return false;
  if (operation === 'story' && connectionId === 'chatgpt-plan') {
    return isChatGptStoryModelSelectable(model, preferredChatGptReasoning);
  }
  const opCap = model.operationCapabilities[operation as AiOperation];
  return opCap?.state === 'supported' && opCap.value === true;
}

/** The inspected catalog never changes the active connection's model options. */
export function modelsForConnection<M>(connections: readonly { id: string; models: M[] }[], connectionId?: string): M[] {
  return connections.find(connection => connection.id === connectionId)?.models ?? [];
}

export type CatalogRefreshPhase = 'loading' | 'fresh' | 'failed' | 'stale';

export function isCatalogSelectable(connectionState: string, refreshPhase?: CatalogRefreshPhase): boolean {
  return ['available', 'connected'].includes(connectionState) && refreshPhase !== 'failed' && refreshPhase !== 'loading' && refreshPhase !== 'stale';
}

/** Account catalog display state stays separate from routing eligibility. */
export function catalogStateLabel(connectionState: string, modelCount: number, refreshPhase?: CatalogRefreshPhase): string {
  if (connectionState !== 'available' && connectionState !== 'connected') {
    return `connection ${connectionState}; catalog unavailable`;
  }
  if (refreshPhase === 'loading') return 'refreshing';
  if (refreshPhase === 'failed') return modelCount > 0 ? 'refresh failed; showing stale cached entries' : 'refresh failed; no cached entries';
  if (refreshPhase === 'fresh') return modelCount > 0 ? 'refreshed' : 'refreshed; empty catalog';
  if (refreshPhase === 'stale') return modelCount > 0 ? 'stale cached entries; refresh to verify' : 'status refreshed; model catalog not verified';
  return modelCount > 0 ? 'cached; refresh to verify current availability' : 'not yet refreshed';
}

interface EligibilityDescriptor {
  availability: { state: string };
  textGeneration: { state: string };
  operationCapabilities: Record<string, { state: string; value?: unknown }>;
}

export function isEligibleTextModel(model: EligibilityDescriptor): boolean {
  return model.availability.state === 'supported' && model.textGeneration.state === 'supported' &&
    Object.values(model.operationCapabilities).some(capability => capability.state === 'supported' && capability.value === true);
}

/** A saved preference needs verified text capability, not an enabled operation. */
export function isSelectableTextPreferenceModel(model: Pick<EligibilityDescriptor, 'availability' | 'textGeneration'>): boolean {
  return model.availability.state === 'supported' && model.textGeneration.state === 'supported';
}

/** A local status refresh can confirm an in-memory explicit catalog refresh,
 * never promote a disk cache or another credential authority to fresh. */
export function catalogVerificationFingerprint(
  status: {
    capabilityPolicyVersion: string;
    credentialAuthorityIds: Partial<Record<AiConnectionId, string>>;
    connections: readonly { id: string; state: string; models: unknown[] }[];
  },
  connectionId: AiConnectionId,
): string | undefined {
  const connection = status.connections.find(item => item.id === connectionId);
  const authority = status.credentialAuthorityIds[connectionId];
  if (!authority || !status.capabilityPolicyVersion || !connection ||
      !['available', 'connected'].includes(connection.state)) return undefined;
  return JSON.stringify([connectionId, authority, status.capabilityPolicyVersion, connection.models]);
}

/** UI-only early rejection. Final admission remains on the server.
 * Image retains the existing managed-Gemini route; Story has its own preflight. */
export function chatGptOperationBlockReason(
  operation: AiOperation,
  preferences?: ProviderPreferences,
): string | undefined {
  if (operation === 'story' || operation === 'image') return undefined;
  const selectedConnection = preferences?.operationOverrides?.[operation]?.connectionId ?? preferences?.defaultConnectionId;
  return selectedConnection === 'chatgpt-plan'
    ? 'ChatGPT plan is currently qualified only for local Story with GPT-6 Luna and Default reasoning. Choose a compatible connection explicitly for ' + operation + ' in AI Settings.'
    : undefined;
}


export interface OperationEligibility {
  eligible: boolean;
  connectionId: AiConnectionId;
  modelId?: string;
  reasoningLevel?: AiReasoningLevel;
  reason?: string;
}

/** Resolves the UI's effective route and explains catalog eligibility. This is
 * advisory only; request admission remains enforced by the server. */
export function resolveOperationEligibility(
  status: {
    connections: readonly {
      id: AiConnectionId;
      state: string;
      selectedModelId?: string;
      models: readonly {
        id: string;
        availability: { state: string };
        textGeneration: { state: string };
        reasoning?: { state: string; value?: unknown };
        operationCapabilities: Partial<Record<AiOperation, { state: string; value?: unknown; reason?: string }>>;
      }[];
    }[];
    preferences: {
      defaultConnectionId: AiConnectionId;
      defaultTextModelId?: string;
      defaultReasoningLevel?: AiReasoningLevel;
      operationOverrides?: Partial<Record<AiOperation, Partial<AiProviderSelection>>>;
    };
  },
  operation: AiOperation,
  chatGptStoryLocalActivation = false,
): OperationEligibility {
  const { preferences } = status;
  const override = preferences.operationOverrides?.[operation];
  const connectionId = override?.connectionId ?? preferences.defaultConnectionId;
  const modelId = override?.modelId ?? preferences.defaultTextModelId ??
    (connectionId === 'gemini-managed' ? status.connections.find(item => item.id === connectionId)?.selectedModelId : undefined);
  const reasoningLevel = override?.reasoningLevel ?? preferences.defaultReasoningLevel ?? 'default';
  const connection = status.connections.find(item => item.id === connectionId);
  const fail = (reason: string): OperationEligibility => ({ eligible: false, connectionId, modelId, reasoningLevel, reason });
  const managedGemini = connectionId === 'gemini-managed';
  if (connectionId === 'chatgpt-plan' && operation !== 'story') {
    return fail(`ChatGPT plan is qualified only for local Story; ${operation} is unsupported.`);
  }
  const connectionReady = managedGemini
    ? connection?.state === 'available' || connection?.state === 'connected'
    : connection?.state === 'connected';
  if (!connection || !connectionReady) {
    const state = connection?.state ?? 'unknown';
    return fail(state === 'unconfigured'
      ? `${connectionId} is not configured. Add its credentials in AI Settings.`
      : state === 'authorization-required'
        ? `${connectionId} requires authorization before using ${operation}. Authorize it in AI Settings.`
        : state === 'available' && !managedGemini
          ? `${connectionId} credentials are present; refresh its model catalog to verify and select a model for ${operation}.`
          : `${connectionId} is ${state}; reconnect it before using ${operation}.`);
  }
  if (connectionId === 'chatgpt-plan') {
    if (!chatGptStoryLocalActivation) return fail('ChatGPT Story is not activated for this local server process.');
    if (modelId !== 'gpt-6-luna' || reasoningLevel !== 'default') return fail('ChatGPT Story is qualified only for GPT-6 Luna with Default reasoning.');
    const model = connection.models.find(item => item.id === modelId);
    if (!model || !isChatGptStoryModelSelectable(model, reasoningLevel)) return fail('GPT-6 Luna is not currently verified as available for Story. Refresh the connected ChatGPT catalog.');
    return { eligible: true, connectionId, modelId, reasoningLevel };
  }
  if (managedGemini && operation === 'image') return { eligible: true, connectionId, modelId, reasoningLevel };
  // The host-managed route can use its provider default without a selected catalog
  // model; personal/API connections require an explicit, verified model.
  if (!modelId) return managedGemini && reasoningLevel === 'default'
    ? { eligible: true, connectionId, reasoningLevel }
    : fail('Choose a text model explicitly in AI Settings.');
  const model = connection.models.find(item => item.id === modelId);
  if (!model) return managedGemini && modelId === GEMINI_MODELS.text && reasoningLevel === 'default'
    ? { eligible: true, connectionId, modelId, reasoningLevel }
    : fail(`Model ${modelId} is not present in the ${connectionId} catalog. Refresh the catalog or choose another model.`);
  if (model.availability.state !== 'supported') return fail(model.availability.state === 'unknown'
    ? `Availability of ${modelId} is unknown; refresh the catalog to verify it.`
    : `${modelId} is unavailable for this connection.`);
  if (operation !== 'image' && reasoningLevel !== 'default' &&
      (model.reasoning?.state !== 'supported' || !Array.isArray(model.reasoning.value) || !model.reasoning.value.includes(reasoningLevel))) {
    return fail(`Reasoning level ${reasoningLevel} is not verified for ${modelId}; choose Default or a supported level.`);
  }
  const capability = model.operationCapabilities[operation];
  if (capability?.state !== 'supported' || capability.value !== true) {
    return fail(capability?.state === 'unknown'
      ? capability.reason ?? `Support for ${operation} on ${modelId} is unknown.`
      : capability?.state === 'unsupported'
        ? `${modelId} does not support ${operation}.`
        : `Support for ${operation} on ${modelId} is not verified; refresh the catalog.`);
  }
  return { eligible: true, connectionId, modelId, reasoningLevel };
}
