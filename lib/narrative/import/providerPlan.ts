import type { NarrativeExtractionRequest } from '../../../shared/importSchemas.ts';
import {
  PROVIDER_PREFERENCES_STORAGE_KEY,
  readProviderPreferencesSnapshot,
  type AiConnectionId,
  type AiReasoningLevel,
  type ProviderHubStatus,
  type ProviderPreferences,
} from '../../../services/apiClient.ts';
import type { ImportCheckpointIdentityInput } from './analysisCheckpoints.ts';
import type { VerifiedExtraction } from './proposalValidator.ts';
import type { SourceChunk } from './segmentation.ts';
import type { ParsedNarrativeSource } from './sourceParser.ts';

export const MAX_EXTRACTION_CALLS = 12;
export { PROVIDER_PREFERENCES_STORAGE_KEY };

export type Category = NarrativeExtractionRequest['categories'][number];

export interface AnalysisConfiguration {
  scope: 'complete' | 'selective';
  categories: Category[];
  instruction: string;
}

export const IMPORT_CATEGORY_OPTIONS: Array<[Category, string]> = [
  ['characters', 'Characters and identities'],
  ['attributes', 'Attributes and aliases'],
  ['relationships', 'Relationships'],
  ['locations', 'Locations and worldbuilding'],
  ['objects', 'Objects'],
  ['events', 'Events and plot'],
  ['story-bible', 'Story Bible'],
  ['themes-style', 'Themes and style'],
  ['continuity', 'Ambiguity and possible continuity issues'],
];

export const ALL_IMPORT_CATEGORIES: Category[] = IMPORT_CATEGORY_OPTIONS.map(([id]) => id);

const VALID_CONNECTION_IDS = new Set<AiConnectionId>([
  'gemini-managed',
  'gemini-personal',
  'chatgpt-plan',
  'openai-api',
]);

const VALID_REASONING_LEVELS = new Set<AiReasoningLevel>([
  'default',
  'none',
  'minimal',
  'low',
  'medium',
  'high',
  'extra-high',
  'max',
]);

export interface ImportProviderPlanContext {
  connectionId: AiConnectionId;
  modelId: string;
  reasoningLevel: AiReasoningLevel;
  contextLimitTokens?: number;
  operationEligible: boolean;
  capabilityPolicyVersion: string;
  credentialAuthorityId: string;
}

export function emptyExtraction(): VerifiedExtraction {
  return { findings: [], entities: [], relationships: [], ambiguities: [], rejectedEvidenceCount: 0 };
}

export function isImportConnectionId(value: string): value is AiConnectionId {
  return VALID_CONNECTION_IDS.has(value as AiConnectionId);
}

export function isImportReasoningLevel(value: string): value is AiReasoningLevel {
  return VALID_REASONING_LEVELS.has(value as AiReasoningLevel);
}

export function resolveProviderPlanContext(
  status: ProviderHubStatus,
  prefs: ProviderPreferences | undefined,
): ImportProviderPlanContext {
  const override = prefs?.operationOverrides?.['narrative-import'];
  const rawConnectionId = override?.connectionId ?? prefs?.defaultConnectionId ?? 'gemini-managed';
  const rawReasoningLevel = override?.reasoningLevel ?? prefs?.defaultReasoningLevel ?? 'default';
  if (!isImportConnectionId(rawConnectionId) || !isImportReasoningLevel(rawReasoningLevel)) {
    throw new Error('Provider selection is invalid.');
  }
  const connectionId = rawConnectionId;
  const reasoningLevel = rawReasoningLevel;
  const credentialAuthorityId = status.credentialAuthorityIds?.[connectionId];
  const connection = status.connections?.find(item => item.id === connectionId);
  const modelId = override?.modelId ?? prefs?.defaultTextModelId ?? connection?.selectedModelId;
  if (!connection || typeof modelId !== 'string' || !modelId || !status.capabilityPolicyVersion || !credentialAuthorityId) {
    throw new Error('Provider identity is incomplete.');
  }
  const model = connection.models?.find(item => item.id === modelId);
  const operation = model?.operationCapabilities?.['narrative-import'];
  return {
    connectionId,
    modelId,
    reasoningLevel,
    contextLimitTokens: model?.contextLimit?.state === 'supported' ? model.contextLimit.value : undefined,
    operationEligible: connectionId === 'gemini-managed' || (operation?.state === 'supported' && operation.value === true),
    capabilityPolicyVersion: status.capabilityPolicyVersion,
    credentialAuthorityId,
  };
}

export async function fetchImportProviderPlanContext(signal?: AbortSignal): Promise<ImportProviderPlanContext | null> {
  const response = await fetch('/api/ai/provider-hub/status', { signal });
  if (!response.ok) throw new Error('Provider context is unavailable.');
  const status = await response.json() as ProviderHubStatus;
  const { preferences } = readProviderPreferencesSnapshot();
  return resolveProviderPlanContext(status, preferences);
}

export function readCurrentProviderPreferencesRaw(): string | null {
  try {
    return readProviderPreferencesSnapshot().raw;
  } catch {
    return null;
  }
}

export function buildAdaptivePlanOptions(contextLimitTokens?: number):
  | { maxInputTokens: number; envelopeReserveTokens: number }
  | undefined {
  if (!contextLimitTokens) return undefined;
  return {
    maxInputTokens: Math.min(8_000, contextLimitTokens),
    envelopeReserveTokens: Math.min(1_500, Math.floor(contextLimitTokens * 0.2)),
  };
}

export function buildCheckpointIdentityInput(params: {
  source: ParsedNarrativeSource;
  configuration: AnalysisConfiguration;
  providerPlanContext: ImportProviderPlanContext;
  plan: {
    completeWithinCallBudget: boolean;
    limits: { maxInputTokens: number; envelopeReserveTokens: number };
    chunks: SourceChunk[];
  };
  maxCalls?: number;
}): ImportCheckpointIdentityInput {
  const { source, configuration, providerPlanContext, plan, maxCalls = MAX_EXTRACTION_CALLS } = params;
  return {
    source: {
      digest: source.digest,
      filename: source.filename,
      mediaType: source.mediaType,
      byteLength: source.byteLength,
    },
    scope: configuration.scope,
    categories: configuration.scope === 'complete' ? ALL_IMPORT_CATEGORIES : configuration.categories,
    instruction: configuration.instruction,
    provider: {
      connectionId: providerPlanContext.connectionId,
      ...(providerPlanContext.modelId ? { modelId: providerPlanContext.modelId } : {}),
      reasoningLevel: providerPlanContext.reasoningLevel,
      ...(providerPlanContext.capabilityPolicyVersion ? { capabilityPolicyVersion: providerPlanContext.capabilityPolicyVersion } : {}),
      credentialAuthorityId: providerPlanContext.credentialAuthorityId,
    },
    complete: plan.completeWithinCallBudget,
    maxCalls,
    maxInputTokens: plan.limits.maxInputTokens,
    envelopeReserveTokens: plan.limits.envelopeReserveTokens,
    ...(providerPlanContext.contextLimitTokens ? { contextLimitTokens: providerPlanContext.contextLimitTokens } : {}),
    totalCharacters: source.text.length,
    chunks: plan.chunks.map(({ id, index, start, end }) => ({ id, index, start, end })),
  };
}
