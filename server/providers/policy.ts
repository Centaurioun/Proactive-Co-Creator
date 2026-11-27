import type { AiOperation } from '../aiBudget.ts';
import type { AiCapability, AiCapabilityEvidence, AiConnectionId, AiModelDescriptor, AiReasoningLevel } from './contracts.ts';
import { AppApiError } from '../errors.ts';

export const TEXT_OPERATIONS: AiOperation[] = [
  'analyze', 'clarify', 'polish', 'story', 'batch-edit', 'narrative-import',
  'diagnostics', 'sync', 'writing', 'opportunities', 'import-enhance',
];

const PROVIDER_OPERATIONS: Record<AiConnectionId, AiOperation[]> = {
  'gemini-managed': [...TEXT_OPERATIONS, 'image'],
  'gemini-personal': [...TEXT_OPERATIONS, 'image'],
  'chatgpt-plan': TEXT_OPERATIONS,
  'openai-api': TEXT_OPERATIONS,
};

export const CAPABILITY_POLICY_VERSION = '2026-11-27.1';
export const SIWC_MODELS_DOCUMENTATION = 'https://developers.openai.com/siwc/token-sharing-open-source/models-and-inference';
export const SIWC_PREVIEW_LIMITATIONS = 'https://developers.openai.com/siwc/token-sharing-open-source/preview-limitations';
export const OPENAI_MODEL_CATALOG_ENDPOINT = 'https://api.openai.com/v1/models';
export const GEMINI_THINKING_DOCUMENTATION = 'https://ai.google.dev/gemini-api/docs/thinking';

function evidence(connectionId: AiConnectionId, modelSlug: string, reference: string, source: AiCapabilityEvidence['source'] = 'official-documentation'): AiCapabilityEvidence[] {
  return [{
    source, reference,
    checkedAt: '2026-11-27',
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
  'gpt-5.4': { reasoning: ['none', 'minimal', 'low', 'medium', 'high', 'extra-high'], context: 1_050_000, output: 128_000, structuredOutput: true },
  'gpt-5.4-mini': { reasoning: ['none', 'minimal', 'low', 'medium', 'high', 'extra-high'], context: 400_000, output: 128_000, structuredOutput: true },
  'gpt-5.2': { reasoning: ['minimal', 'low', 'medium', 'high'], context: 400_000, output: 128_000, structuredOutput: true },
  'gpt-5': { reasoning: ['minimal', 'low', 'medium', 'high'], context: 400_000, output: 128_000, structuredOutput: true },
  'gpt-5-mini': { reasoning: ['minimal', 'low', 'medium', 'high'], context: 400_000, output: 128_000, structuredOutput: true },
  'gpt-5-nano': { reasoning: ['minimal', 'low', 'medium', 'high'], context: 400_000, output: 128_000, structuredOutput: true },
  'gpt-4.1': { reasoning: [], context: 1_047_576, output: 32_768, structuredOutput: true },
  'gpt-4.1-mini': { reasoning: [], context: 1_047_576, output: 32_768, structuredOutput: true },
  'gpt-4o': { reasoning: [], context: 128_000, output: 16_384, structuredOutput: true },
  'o3': { reasoning: ['low', 'medium', 'high'], context: 200_000, output: 100_000, structuredOutput: true },
  'o4-mini': { reasoning: ['low', 'medium', 'high'], context: 200_000, output: 100_000, structuredOutput: true },
};

/**
 * Account discovery proves that a model is selectable for the signed-in account.
 * Known documented OpenAI models are qualified across PCC text/structured-JSON
 * workflows using Responses API (`store: false`, `stream: true`) with conservative
 * local input budgets on SIWC and exact preflight + `max_output_tokens` on API key.
 */
export function describeChatGptModel(model: { id: string; displayName: string }, connectionId: 'chatgpt-plan' | 'openai-api' = 'chatgpt-plan'): AiModelDescriptor {
  const slug = model.id;
  const known = OPENAI_MODEL_EVIDENCE[slug];
  const modelDocumentation = `${API_MODEL_DOCS}${encodeURIComponent(slug)}`;
  const catalogProof = evidence(connectionId, slug, connectionId === 'chatgpt-plan' ? SIWC_MODELS_DOCUMENTATION : OPENAI_MODEL_CATALOG_ENDPOINT, 'account-catalog');
  const textProof = evidence(connectionId, slug, modelDocumentation);
  const supported = <T>(value: T, ev: AiCapabilityEvidence[]): AiCapability<T> => ({ state: 'supported', value, evidence: ev });
  const textGeneration: AiCapability<boolean> = known
    ? supported(true, textProof)
    : { state: 'unknown', reason: 'This exact account model slug has no verified text-generation mapping.' };
  const reasoning: AiCapability<readonly AiReasoningLevel[]> = !known
    ? { state: 'unknown', reason: 'This exact account model slug has no verified reasoning mapping.' }
    : known.reasoning.length > 0
      ? { state: 'supported', value: known.reasoning, evidence: textProof }
      : { state: 'unsupported', evidence: textProof };
  const operationEvidence = connectionId === 'chatgpt-plan'
    ? [...catalogProof, ...textProof]
    : textProof;
  const operationCapabilities = Object.fromEntries(TEXT_OPERATIONS.map((operation) => [operation,
    known
      ? supported(true, operationEvidence)
      : { state: 'unknown', reason: `This exact model has no verified PCC text-operation compatibility for ${operation}.` },
  ])) as AiModelDescriptor['operationCapabilities'];
  operationCapabilities.image = { state: 'unsupported', evidence: catalogProof };

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
      : { state: 'unknown', reason: connectionId === 'chatgpt-plan' ? 'SIWC uses conservative local stream/output byte limits because max_output_tokens is not forwarded.' : 'No hard output-token limit is verified for this exact model.' },
    reasoning,
    operationCapabilities,
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
