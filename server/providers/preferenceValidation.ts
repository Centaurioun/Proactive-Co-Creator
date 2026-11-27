import type { AiOperation } from '../aiBudget.ts';
import type { AiConnectionId, AiProviderSelection, AiReasoningLevel, ProviderPreferences } from './contracts.ts';
import { assertReasoningSelection, hasSupportedOperation } from './policy.ts';
import { getCachedProviderModel } from './runtime.ts';

export const PERSONAL_CONNECTION_IDS: readonly AiConnectionId[] = ['gemini-personal', 'chatgpt-plan', 'openai-api'];
export const VALID_CONNECTION_IDS: readonly AiConnectionId[] = ['gemini-managed', 'gemini-personal', 'chatgpt-plan', 'openai-api'];
export const SELECTABLE_CONNECTION_IDS: readonly AiConnectionId[] = ['gemini-managed', 'gemini-personal', 'chatgpt-plan', 'openai-api'];
export const REASONING_LEVELS: readonly AiReasoningLevel[] = ['default', 'none', 'minimal', 'low', 'medium', 'high', 'extra-high', 'max'];
export const VALID_OPERATIONS = new Set<AiOperation>([
  'analyze', 'clarify', 'polish', 'story', 'image', 'batch-edit', 'narrative-import',
  'diagnostics', 'sync', 'writing', 'opportunities', 'import-enhance',
]);

export function isValidModelId(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= 160 && /^[A-Za-z0-9._:/-]+$/.test(value);
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function isValidChatGptMap<V>(
  raw: unknown,
  isValidValue: (value: unknown) => value is V,
): raw is Record<string, V> | undefined {
  if (raw === undefined) return true;
  if (!isPlainRecord(raw)) return false;
  return Object.entries(raw).every(([connectionId, val]) => connectionId === 'chatgpt-plan' && isValidValue(val));
}

function isReasoningLevel(value: unknown): value is AiReasoningLevel {
  return typeof value === 'string' && REASONING_LEVELS.includes(value as AiReasoningLevel);
}

function validateChatGptModelPreference(modelId: string | undefined, priorModelId: string | undefined): string | undefined {
  if (!modelId || modelId === priorModelId) return undefined;
  const model = getCachedProviderModel('chatgpt-plan', modelId);
  if (!model || model.availability.state !== 'supported' || model.textGeneration.state !== 'supported') {
    return 'Choose a currently verified text model from the connected ChatGPT account catalog.';
  }
  return undefined;
}

function validateChatGptReasoningPreference(
  reasoningLevel: AiReasoningLevel | undefined,
  effectiveModelId: string | undefined,
  changed: boolean,
): string | undefined {
  if (!changed || reasoningLevel === undefined) return undefined;
  const model = effectiveModelId ? getCachedProviderModel('chatgpt-plan', effectiveModelId) : undefined;
  try {
    if (!model) throw new Error('missing');
    assertReasoningSelection(model, reasoningLevel);
    return undefined;
  } catch {
    return 'The preferred reasoning level is not documented for the selected ChatGPT account model.';
  }
}

function validateChatGptConnectionPreferences(
  preferredModels: Record<string, string> | undefined,
  preferredReasoning: Record<string, AiReasoningLevel> | undefined,
  priorPreferences: ProviderPreferences,
): {
  ok: true;
  preferredTextModelsByConnection?: Partial<Record<AiConnectionId, string>>;
  preferredReasoningLevelsByConnection?: Partial<Record<AiConnectionId, AiReasoningLevel>>;
} | { ok: false; message: string } {
  const preferredModelId = preferredModels?.['chatgpt-plan'];
  const priorModelId = priorPreferences.preferredTextModelsByConnection?.['chatgpt-plan'];
  const modelError = validateChatGptModelPreference(preferredModelId, priorModelId);
  if (modelError) return { ok: false, message: modelError };

  const preferredReasoningLevel = preferredReasoning?.['chatgpt-plan'];
  const priorReasoningLevel = priorPreferences.preferredReasoningLevelsByConnection?.['chatgpt-plan'];
  const reasoningChanged = preferredReasoningLevel !== priorReasoningLevel || preferredModelId !== priorModelId;
  const reasoningError = validateChatGptReasoningPreference(preferredReasoningLevel, preferredModelId ?? priorModelId, reasoningChanged);
  if (reasoningError) return { ok: false, message: reasoningError };

  return {
    ok: true,
    ...(preferredModelId ? { preferredTextModelsByConnection: { 'chatgpt-plan': preferredModelId } } : {}),
    ...(preferredReasoningLevel ? { preferredReasoningLevelsByConnection: { 'chatgpt-plan': preferredReasoningLevel } } : {}),
  };
}

function validateDefaultSelection(
  defaultConnectionId: AiConnectionId,
  defaultTextModelId: string | undefined,
  defaultReasoningLevel: AiReasoningLevel | undefined,
): string | undefined {
  const requiresExplicitModel = defaultConnectionId !== 'gemini-managed' && defaultConnectionId !== 'chatgpt-plan';
  if (requiresExplicitModel && !defaultTextModelId) {
    return 'Choose a model from the refreshed account catalog before saving this default connection.';
  }
  if (!defaultTextModelId && defaultReasoningLevel && defaultReasoningLevel !== 'default') {
    return 'Choose a verified model before setting a non-default reasoning level.';
  }
  if (!defaultTextModelId) return undefined;

  const model = getCachedProviderModel(defaultConnectionId, defaultTextModelId);
  const textCapable = model && model.availability.state === 'supported' && model.textGeneration.state === 'supported';
  const opCapable = defaultConnectionId === 'chatgpt-plan' || (model ? hasSupportedOperation(model) : false);
  if (!textCapable || !opCapable) {
    return defaultConnectionId === 'chatgpt-plan'
      ? 'Choose a currently verified text model from the connected ChatGPT account catalog.'
      : 'The default model is not verified for an available PCC operation. Refresh its catalog and choose a model with a supported operation.';
  }
  try {
    assertReasoningSelection(model, defaultReasoningLevel);
    return undefined;
  } catch {
    return 'The default reasoning preference is not verified for this model.';
  }
}

function validateSingleOverride(operation: string, rawOverride: unknown): AiProviderSelection | undefined {
  if (!VALID_OPERATIONS.has(operation as AiOperation) || operation === 'image' || !isPlainRecord(rawOverride)) {
    return undefined;
  }
  const { connectionId, modelId, reasoningLevel } = rawOverride;
  if (!SELECTABLE_CONNECTION_IDS.includes(connectionId as AiConnectionId) || !isValidModelId(modelId)) return undefined;
  if (reasoningLevel !== undefined && !isReasoningLevel(reasoningLevel)) return undefined;

  const conn = connectionId as AiConnectionId;
  const model = getCachedProviderModel(conn, modelId);
  if (!model || model.availability.state !== 'supported') return undefined;

  if (operation === 'story' && conn === 'chatgpt-plan') {
    if (modelId !== 'gpt-6-luna' || reasoningLevel !== 'default' || model.textGeneration.state !== 'supported') {
      return undefined;
    }
    return { connectionId: conn, modelId, reasoningLevel };
  }

  const capability = model.operationCapabilities[operation as AiOperation];
  if (capability?.state !== 'supported' || capability.value !== true) return undefined;
  try {
    assertReasoningSelection(model, reasoningLevel);
  } catch {
    return undefined;
  }
  return { connectionId: conn, modelId, ...(reasoningLevel !== undefined ? { reasoningLevel } : {}) };
}

function validateAndNormalizeOverrides(
  rawOverrides: unknown,
  preferredModelId: string | undefined,
  preferredReasoningLevel: AiReasoningLevel | undefined,
): { ok: true; operationOverrides?: Record<string, AiProviderSelection> } | { ok: false; message: string } {
  if (rawOverrides === undefined) return { ok: true };
  if (!isPlainRecord(rawOverrides)) return { ok: false, message: 'Operation preferences are invalid.' };

  const normalized: Record<string, AiProviderSelection> = {};
  for (const [operation, rawOverride] of Object.entries(rawOverrides)) {
    const validated = validateSingleOverride(operation, rawOverride);
    if (!validated) return { ok: false, message: 'One or more operation preferences are invalid.' };
    normalized[operation] = validated;
  }
  if (normalized.story?.connectionId === 'chatgpt-plan') {
    const qualifiedChatGpt = preferredModelId === 'gpt-6-luna' && (preferredReasoningLevel ?? 'default') === 'default';
    if (!qualifiedChatGpt) {
      return { ok: false, message: 'ChatGPT Story requires the saved GPT-6 Luna preference with Default reasoning.' };
    }
  }
  return { ok: true, operationOverrides: normalized };
}

function validateBaseFields(rawValue: unknown): { ok: true; record: Record<string, unknown> } | { ok: false; message: string } {
  if (!isPlainRecord(rawValue) || !SELECTABLE_CONNECTION_IDS.includes(rawValue.defaultConnectionId as AiConnectionId)) {
    return { ok: false, message: 'AI preferences are invalid.' };
  }
  if (rawValue.defaultTextModelId !== undefined && !isValidModelId(rawValue.defaultTextModelId)) {
    return { ok: false, message: 'The selected default model is invalid.' };
  }
  if (rawValue.defaultReasoningLevel !== undefined && !isReasoningLevel(rawValue.defaultReasoningLevel)) {
    return { ok: false, message: 'The selected reasoning preference is invalid.' };
  }
  if (!isValidChatGptMap(rawValue.preferredTextModelsByConnection, isValidModelId)) {
    return { ok: false, message: 'Connection-scoped preferred text models are invalid.' };
  }
  if (!isValidChatGptMap(rawValue.preferredReasoningLevelsByConnection, isReasoningLevel)) {
    return { ok: false, message: 'Connection-scoped preferred reasoning levels are invalid.' };
  }
  return { ok: true, record: rawValue };
}

export function validateAndNormalizePreferences(
  rawValue: unknown,
  priorPreferences: ProviderPreferences,
): { ok: true; preferences: ProviderPreferences } | { ok: false; message: string } {
  const base = validateBaseFields(rawValue);
  if (!base.ok) return base;
  const record = base.record;

  const chatGptPrefs = validateChatGptConnectionPreferences(
    record.preferredTextModelsByConnection as Record<string, string> | undefined,
    record.preferredReasoningLevelsByConnection as Record<string, AiReasoningLevel> | undefined,
    priorPreferences,
  );
  if (!chatGptPrefs.ok) return chatGptPrefs;

  const defaultConnectionId = record.defaultConnectionId as AiConnectionId;
  const defaultTextModelId = record.defaultTextModelId as string | undefined;
  const defaultReasoningLevel = record.defaultReasoningLevel as AiReasoningLevel | undefined;
  const defaultError = validateDefaultSelection(defaultConnectionId, defaultTextModelId, defaultReasoningLevel);
  if (defaultError) return { ok: false, message: defaultError };

  const overridesResult = validateAndNormalizeOverrides(
    record.operationOverrides,
    chatGptPrefs.preferredTextModelsByConnection?.['chatgpt-plan'],
    chatGptPrefs.preferredReasoningLevelsByConnection?.['chatgpt-plan'],
  );
  if (!overridesResult.ok) return overridesResult;

  return {
    ok: true,
    preferences: {
      defaultConnectionId,
      ...(defaultTextModelId !== undefined ? { defaultTextModelId } : {}),
      ...(defaultReasoningLevel !== undefined ? { defaultReasoningLevel } : {}),
      ...(chatGptPrefs.preferredTextModelsByConnection ? { preferredTextModelsByConnection: chatGptPrefs.preferredTextModelsByConnection } : {}),
      ...(chatGptPrefs.preferredReasoningLevelsByConnection ? { preferredReasoningLevelsByConnection: chatGptPrefs.preferredReasoningLevelsByConnection } : {}),
      ...(overridesResult.operationOverrides !== undefined ? { operationOverrides: overridesResult.operationOverrides } : {}),
    },
  };
}
