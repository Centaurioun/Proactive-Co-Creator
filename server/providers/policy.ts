import type { AiOperation } from '../aiBudget.ts';
import type { AiCapability, AiCapabilityEvidence, AiConnectionId, AiModelDescriptor, AiReasoningLevel } from './contracts.ts';
import { AppApiError } from '../errors.ts';

const TEXT_OPERATIONS: AiOperation[] = [
  'analyze', 'clarify', 'polish', 'story', 'batch-edit', 'narrative-import',
  'diagnostics', 'sync', 'writing', 'opportunities', 'import-enhance',
];

const PROVIDER_OPERATIONS: Record<AiConnectionId, AiOperation[]> = {
  'gemini-managed': [...TEXT_OPERATIONS, 'image'],
  'gemini-personal': [...TEXT_OPERATIONS, 'image'],
  'chatgpt-plan': ['story'],
  'openai-api': TEXT_OPERATIONS,
};

export const CAPABILITY_POLICY_VERSION = '2026-11-26.3';
export const SIWC_MODELS_DOCUMENTATION = 'https://developers.openai.com/siwc/token-sharing-open-source/models-and-inference';
export const SIWC_PREVIEW_LIMITATIONS = 'https://developers.openai.com/siwc/token-sharing-open-source/preview-limitations';
export const OPENAI_MODEL_CATALOG_ENDPOINT = 'https://api.openai.com/v1/models';
export const GEMINI_THINKING_DOCUMENTATION = 'https://ai.google.dev/gemini-api/docs/thinking';

function evidence(connectionId: AiConnectionId, modelSlug: string, reference: string, source: AiCapabilityEvidence['source'] = 'official-documentation'): AiCapabilityEvidence[] {
  return [{
    source, reference,
    checkedAt: '2026-11-26',
    transport: source === 'account-catalog' ? (connectionId === 'chatgpt-plan' ? 'siwc-model-catalog' : 'openai-api-model-catalog') : connectionId === 'chatgpt-plan' ? 'openai-api-responses' : connectionId === 'openai-api' ? 'openai-api-responses' : 'gemini-generate-content',
    modelSlug,
  }];
}

const API_MODEL_DOCS = 'https://developers.openai.com/api/docs/models/';
const OPENAI_MODEL_EVIDENCE: Record<string, { reasoning: readonly AiReasoningLevel[]; context?: number; output?: number; structuredOutput: boolean }> = {
  'gpt-6.2-astra': { reasoning: ['low', 'medium', 'high', 'extra-high', 'max'], context: 1_050_000, output: 128_000, structuredOutput: true },
  'gpt-6.2-sol': { reasoning: ['low', 'medium', 'high', 'extra-high', 'max'], context: 1_050_000, output: 128_000, structuredOutput: true },
  'gpt-6.1-terra': { reasoning: ['none', 'low', 'medium', 'high', 'extra-high', 'max'], context: 1_050_000, output: 128_000, structuredOutput: true },
  'gpt-6.1-sol': { reasoning: ['low', 'medium', 'high', 'extra-high', 'max'], context: 1_050_000, output: 128_000, structuredOutput: true },
  'gpt-6-astra': { reasoning: ['low', 'medium', 'high', 'extra-high', 'max'], context: 1_050_000, output: 128_000, structuredOutput: true },
  'gpt-6-sol': { reasoning: ['none', 'low', 'medium', 'high', 'extra-high', 'max'], context: 1_050_000, output: 128_000, structuredOutput: true },
  'gpt-6-luna': { reasoning: ['none', 'low', 'medium', 'high', 'extra-high', 'max'], context: 1_050_000, output: 128_000, structuredOutput: true },
  'gpt-5.6-sol': { reasoning: ['none', 'low', 'medium', 'high', 'extra-high', 'max'], context: 1_050_000, output: 128_000, structuredOutput: true },
  'gpt-5.6-terra': { reasoning: ['none', 'low', 'medium', 'high', 'extra-high', 'max'], context: 1_050_000, output: 128_000, structuredOutput: true },
  'gpt-5.6-luna': { reasoning: ['none', 'low', 'medium', 'high', 'extra-high', 'max'], context: 1_050_000, output: 128_000, structuredOutput: true },
};

/**
 * Account discovery proves that a model is selectable for the signed-in account,
 * not that the model supports every PCC operation or request parameter. This
 * registry deliberately uses exact slugs and a versioned documentation source.
 */
export function describeChatGptModel(model: { id: string; displayName: string }, connectionId: 'chatgpt-plan' | 'openai-api' = 'chatgpt-plan'): AiModelDescriptor {
  const slug = model.id;
  const known = OPENAI_MODEL_EVIDENCE[slug];
  const modelDocumentation = `${API_MODEL_DOCS}${encodeURIComponent(slug)}`;
  const catalogProof = evidence(connectionId, slug, connectionId === 'chatgpt-plan' ? SIWC_MODELS_DOCUMENTATION : OPENAI_MODEL_CATALOG_ENDPOINT, 'account-catalog');
  const textProof = evidence(connectionId, slug, modelDocumentation);
  const siwcLimitProof = evidence(connectionId, slug, SIWC_PREVIEW_LIMITATIONS);
  const supported = <T>(value: T, ev: AiCapabilityEvidence[]): AiCapability<T> => ({ state: 'supported', value, evidence: ev });
  const textGeneration: AiCapability<boolean> = known
    ? supported(true, textProof)
    : { state: 'unknown', reason: 'This exact account model slug has no verified text-generation mapping.' };
  const reasoning: AiCapability<readonly AiReasoningLevel[]> = known
    ? { state: 'supported', value: known.reasoning, evidence: textProof }
    : { state: 'unknown', reason: 'This exact account model slug has no verified reasoning mapping.' };
  return {
    id: slug,
    displayName: model.displayName,
    availability: supported(true, catalogProof),
    textGeneration,
    imageGeneration: { state: 'unsupported', evidence: catalogProof },
    structuredOutput: known?.structuredOutput
      ? supported(true, textProof)
      : { state: 'unknown', reason: 'Native structured-output support is not verified for this exact model.' },
    contextLimit: known?.context ? supported(known.context, textProof) : { state: 'unknown', reason: 'No context limit is verified for this exact model.' },
    outputLimit: known?.output && connectionId === 'openai-api'
      ? supported(known.output, textProof)
      : { state: 'unknown', reason: connectionId === 'chatgpt-plan' ? 'The OpenAI API model page documents this limit, but SIWC does not establish that it can be enforced through this transport.' : 'No hard output-token limit is verified for this exact model.' },
    reasoning,
    // SIWC documents inference but no exact input-token preflight or hard
    // max_output_tokens control. PCC operations require both budget controls,
    // so model availability/text modality cannot qualify an operation here.
    operationCapabilities: Object.fromEntries(TEXT_OPERATIONS.map((operation) => [operation,
      connectionId === 'chatgpt-plan'
        ? { state: 'unsupported', evidence: [...catalogProof, ...siwcLimitProof] }
        : known
          ? supported(true, textProof)
          : { state: 'unknown', reason: `This exact model has no verified PCC text-operation compatibility for ${operation}.` },
    ])) as AiModelDescriptor['operationCapabilities'],
    capabilityPolicyVersion: CAPABILITY_POLICY_VERSION,
  };
}

export function getDefaultConnectionForOperation(_operation: AiOperation): AiConnectionId {
  return 'gemini-managed';
}

export function assertProviderOperation(connectionId: AiConnectionId, operation: AiOperation): void {
  if (!PROVIDER_OPERATIONS[connectionId]?.includes(operation)) {
    throw new AppApiError('MODEL_UNSUPPORTED', `The selected connection does not support ${operation}. Choose a compatible connection explicitly.`, 422, false);
  }
}

export function getSupportedReasoningLevels(model: AiModelDescriptor): AiReasoningLevel[] {
  if (model.reasoning.state !== 'supported') return ['default'];
  return ['default', ...model.reasoning.value];
}

export function assertModelOperation(model: AiModelDescriptor, operation: AiOperation): void {
  const capability = model.operationCapabilities[operation];
  if (capability?.state !== 'supported' || capability.value !== true) {
    throw new AppApiError('MODEL_UNSUPPORTED', `The selected model has no verified capability for ${operation}.`, 422, false);
  }
}

export function hasSupportedOperation(model: AiModelDescriptor): boolean {
  return Object.values(model.operationCapabilities).some(capability => capability?.state === 'supported' && capability.value === true);
}

export function assertReasoningSelection(model: AiModelDescriptor, selected?: AiReasoningLevel): void {
  if (!selected || selected === 'default') return;
  if (model.reasoning.state !== 'supported' || !model.reasoning.value.includes(selected)) {
    throw new AppApiError('MODEL_UNSUPPORTED', 'The selected reasoning level is not verified for this model. Choose a supported level explicitly.', 422, false);
  }
}

export function reasoningParameter(model: AiModelDescriptor, selected?: AiReasoningLevel): { reasoning?: { effort: string } } {
  assertReasoningSelection(model, selected);
  if (!selected || selected === 'default') return {};
  const effort = selected === 'extra-high' ? 'xhigh' : selected;
  return { reasoning: { effort } };
}
