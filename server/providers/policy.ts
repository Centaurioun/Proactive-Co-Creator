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
  'chatgpt-plan': TEXT_OPERATIONS,
  'openai-api': TEXT_OPERATIONS,
};

export const CAPABILITY_POLICY_VERSION = '2026-11-25.1';
export const SIWC_MODELS_DOCUMENTATION = 'https://developers.openai.com/siwc/token-sharing-open-source/models-and-inference';
export const OPENAI_REASONING_DOCUMENTATION = 'https://developers.openai.com/api/docs/guides/reasoning';
export const GEMINI_THINKING_DOCUMENTATION = 'https://ai.google.dev/gemini-api/docs/thinking';
export const OPENAI_MODELS_DOCUMENTATION = 'https://developers.openai.com/api/docs/models';

function evidence(connectionId: AiConnectionId, modelSlug: string, reference: string): AiCapabilityEvidence[] {
  return [{
    source: 'official-documentation', reference,
    checkedAt: '2026-11-25',
    transport: connectionId === 'chatgpt-plan' ? 'siwc-responses' : connectionId === 'openai-api' ? 'openai-api-responses' : 'gemini-generate-content',
    modelSlug,
  }];
}

const OPENAI_REASONING: Record<string, readonly AiReasoningLevel[]> = {
  'gpt-6.2-astra': ['low', 'medium', 'high', 'extra-high', 'max'],
  'gpt-6.2-sol': ['low', 'medium', 'high', 'extra-high', 'max'],
  'gpt-6.1-terra': ['none', 'low', 'medium', 'high', 'extra-high', 'max'],
  'gpt-6-luna': ['none', 'low', 'medium', 'high', 'extra-high', 'max'],
};
const OPENAI_TEXT_MODELS = new Set(['gpt-6.2-astra', 'gpt-6.2-sol', 'gpt-6.1-terra', 'gpt-6-luna']);

/**
 * Account discovery proves that a model is selectable for the signed-in account,
 * not that the model supports every PCC operation or request parameter. This
 * registry deliberately uses exact slugs and a versioned documentation source.
 */
export function describeChatGptModel(model: { id: string; displayName: string }, connectionId: 'chatgpt-plan' | 'openai-api' = 'chatgpt-plan'): AiModelDescriptor {
  const slug = model.id;
  const knownReasoning = OPENAI_REASONING[slug];
  const proof = evidence(connectionId, slug, OPENAI_REASONING_DOCUMENTATION);
  const catalogProof = evidence(connectionId, slug, connectionId === 'chatgpt-plan' ? SIWC_MODELS_DOCUMENTATION : OPENAI_MODELS_DOCUMENTATION);
  const textProof = [...evidence(connectionId, slug, OPENAI_MODELS_DOCUMENTATION), ...catalogProof];
  const knownText = OPENAI_TEXT_MODELS.has(slug);
  const supported = (value: boolean, ev: AiCapabilityEvidence[]): AiCapability<boolean> => ({ state: 'supported', value, evidence: ev });
  const textGeneration: AiCapability<boolean> = knownText
    ? supported(true, textProof)
    : { state: 'unknown', reason: 'This exact account model slug has no verified text-generation mapping.' };
  const reasoning: AiCapability<readonly AiReasoningLevel[]> = knownReasoning
    ? { state: 'supported', value: knownReasoning, evidence: proof }
    : { state: 'unknown', reason: 'This exact account model slug has no verified reasoning mapping.' };
  return {
    id: slug,
    displayName: model.displayName,
    availability: supported(true, catalogProof),
    textGeneration,
    imageGeneration: { state: 'unsupported', evidence: catalogProof },
    structuredOutput: { state: 'unknown', reason: 'Native structured-output support is not verified for this model through the account catalog.' },
    contextLimit: { state: 'unknown', reason: 'The account model catalog does not expose a verified context limit.' },
    outputLimit: { state: 'unknown', reason: connectionId === 'chatgpt-plan' ? 'SIWC does not support max_output_tokens; no hard output-token limit is asserted.' : 'No hard output-token limit is asserted for this account model.' },
    reasoning,
    // SIWC model discovery verifies account availability; official Responses docs
    // establish text generation. PCC's existing operation schemas and mutation
    // guards remain the authority for each structured result. The adapter uses a
    // constrained JSON instruction and callers perform their existing validation.
    operationCapabilities: Object.fromEntries(TEXT_OPERATIONS.map((operation) => [operation,
      knownText ? supported(true, textProof) : { state: 'unknown', reason: `This exact model has no verified PCC text-operation compatibility for ${operation}.` },
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
