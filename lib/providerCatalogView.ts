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
  ['diagnostics', 'Diagnostics & fixes'],
  ['sync', 'Narrative sync'],
  ['opportunities', 'Opportunities'],
  ['import-enhance', 'Import enhancements'],
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
  model: {
    id: string;
    availability: { state: string };
    textGeneration: { state: string };
    reasoning?: Pick<AiCapability<readonly AiReasoningLevel[]>, 'state'> & { value?: unknown };
    operationCapabilities?: Partial<Record<AiOperation, { state: string; value?: unknown }>>;
  },
  preferredReasoning?: string,
): boolean {
  if (model.availability.state !== 'supported' || model.textGeneration.state !== 'supported') {
    return false;
  }
  const storyCap = model.operationCapabilities?.story;
  if (storyCap && (storyCap.state !== 'supported' || storyCap.value !== true)) {
    return false;
  }
  const targetReasoning = (preferredReasoning ?? 'default') as AiReasoningLevel;
  return supportedReasoningLevels(model.reasoning).includes(targetReasoning);
}

export function buildDefaultConnectionPreferences(
  connectionId: AiConnectionId,
  models: readonly AiModelDescriptor[],
  preferences: ProviderPreferences,
): { ok: true; preferences: ProviderPreferences } | { ok: false; error: string } {
  if (connectionId === 'chatgpt-plan') {
    const preferredModelId = preferences.preferredTextModelsByConnection?.['chatgpt-plan'];
    const preferredModel = models.find(model => model.id === preferredModelId && isEligibleTextModel(model))
      ?? models.find(isEligibleTextModel)
      ?? models.find(model => model.id === preferredModelId && isSelectableTextPreferenceModel(model));
    const preferredReasoning = preferences.preferredReasoningLevelsByConnection?.['chatgpt-plan'];
    const resolvedReasoning: AiReasoningLevel = preferredModel && preferredReasoning &&
      supportedReasoningLevels(preferredModel.reasoning).includes(preferredReasoning)
      ? preferredReasoning
      : 'default';
    return {
      ok: true,
      preferences: {
        ...preferences,
        defaultConnectionId: connectionId,
        defaultTextModelId: preferredModel?.id,
        defaultReasoningLevel: preferredModel ? resolvedReasoning : undefined,
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
  const opCap = model.operationCapabilities[operation as AiOperation];
  if (!(opCap?.state === 'supported' && opCap.value === true)) return false;
  if (connectionId === 'chatgpt-plan' && preferredChatGptReasoning) {
    return supportedReasoningLevels(model.reasoning).includes(preferredChatGptReasoning as AiReasoningLevel);
  }
  return true;
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
