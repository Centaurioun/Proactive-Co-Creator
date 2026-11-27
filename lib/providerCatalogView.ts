import type { AiCapability, AiConnectionId, AiModelDescriptor, AiReasoningLevel, ProviderPreferences } from '../server/providers/contracts';
import type { AiOperation } from '../server/aiBudget';

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
