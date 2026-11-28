/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import type { AiOperation } from '../server/aiBudget';
import type {
  AiCapabilitiesResponse,
  AiConnectionId,
  AiProviderSelection,
  AiReasoningLevel,
  ProviderHubStatus,
  ProviderPreferences,
} from '../server/providers/contracts';
import type {
  ApiErrorCode,
  ApiErrorPayload,
  BatchEditProposalResult,
  BeliefState,
  Clarification,
  ClarificationAnswer,
  GenerationMode,
  GraphUpdate,
  ImageGenerationResult,
} from '../shared/types';
import { NarrativeExtractionSchema, type NarrativeExtractionRequest } from '../shared/importSchemas';
import {
  AnalyzeRequestSchema,
  BatchEditRequestSchema,
  ClarifyRequestSchema,
  GenerateMediaRequestSchema,
  RefineRequestSchema,
} from '../shared/schemas';
import {
  DiagnosticsAnalyzeRequestSchema,
  DiagnosticsSuggestFixesRequestSchema,
  ImportEnhanceRequestSchema,
  OpportunitiesExploreRequestSchema,
  SyncAnalyzeRequestSchema,
  WritingAssistRequestSchema,
  type DiagnosticsAnalyzeRequest,
  type DiagnosticsAnalyzeResponse,
  type DiagnosticsSuggestFixesRequest,
  type DiagnosticsSuggestFixesResponse,
  type ImportEnhanceRequest,
  type ImportEnhanceResponse,
  type OpportunitiesExploreRequest,
  type OpportunitiesExploreResponse,
  type SyncAnalyzeRequest,
  type SyncAnalyzeResponse,
  type WritingAssistRequest,
  type WritingAssistResponse,
} from '../shared/narrativeAiSchemas';

export type {
  AiCapabilitiesResponse,
  AiConnectionId,
  AiProviderSelection,
  AiReasoningLevel,
  ProviderHubStatus,
  ProviderPreferences,
};

export const PROVIDER_PREFERENCES_STORAGE_KEY = 'pcc.ai.providerPreferences.v1';
const VALID_CONNECTION_IDS = new Set<AiConnectionId>([
  'gemini-managed',
  'gemini-personal',
  'chatgpt-plan',
  'openai-api',
]);

type RequestParseResult<T> =
  | { success: true; data: T }
  | { success: false; error: { issues: Array<{ message: string }> } };

function enforceOperationRequestBounds<T>(
  parse: (input: unknown) => RequestParseResult<T>,
  body: unknown,
): T {
  const result = parse(body);
  if (!result.success) {
    throw new ClientApiError(
      'VALIDATION_ERROR',
      result.error.issues[0]?.message ?? 'This AI request exceeds the supported operation limits.',
      false,
      400,
    );
  }
  return result.data;
}

export class ClientApiError extends Error {
  readonly code: ApiErrorCode;
  readonly retryable: boolean;
  readonly status: number;

  constructor(code: ApiErrorCode, message: string, retryable: boolean, status: number) {
    super(message);
    this.name = 'ClientApiError';
    this.code = code;
    this.retryable = retryable;
    this.status = status;
  }
}

let providerRequestGeneration = 0;
const registeredStorageWindows = new WeakSet<object>();
const activeProviderRequests = new Set<AbortController>();
let observedExecutionPreferenceFingerprint: string | undefined;

function executionPreferenceFingerprint(raw: string | null): string {
  if (!raw) return '';
  try {
    const value = JSON.parse(raw) as Record<string, unknown>;
    return JSON.stringify({
      defaultConnectionId: value.defaultConnectionId,
      defaultTextModelId: value.defaultTextModelId,
      defaultReasoningLevel: value.defaultReasoningLevel,
      operationOverrides: value.operationOverrides,
    });
  } catch {
    return 'invalid';
  }
}

export function invalidateAiProviderRequestsForPreferenceChange(previousRaw: string | null, nextRaw: string | null): void {
  const previous = executionPreferenceFingerprint(previousRaw);
  const next = executionPreferenceFingerprint(nextRaw);
  observedExecutionPreferenceFingerprint = next;
  if (previous !== next) invalidateAiProviderRequests();
}

export interface ProviderPreferencesSnapshot {
  preferences: ProviderPreferences | undefined;
  raw: string | null;
  fingerprint: string;
}

export function readProviderPreferencesSnapshot(): ProviderPreferencesSnapshot {
  if (typeof window === 'undefined') {
    return { preferences: undefined, raw: null, fingerprint: '' };
  }
  let raw: string | null;
  try {
    raw = window.localStorage.getItem(PROVIDER_PREFERENCES_STORAGE_KEY);
  } catch {
    throw new ClientApiError(
      'UPSTREAM_ERROR',
      'AI provider preferences could not be read. Open AI Settings and confirm the selected billing path before retrying.',
      false,
      503,
    );
  }
  if (!raw) return { preferences: undefined, raw: null, fingerprint: '' };
  try {
    const value = JSON.parse(raw) as Partial<ProviderPreferences>;
    const validConnection = value && typeof value === 'object' && !Array.isArray(value) &&
      typeof value.defaultConnectionId === 'string' &&
      VALID_CONNECTION_IDS.has(value.defaultConnectionId as AiConnectionId);
    if (!validConnection) {
      throw new Error('Invalid provider preferences');
    }
    return {
      preferences: value as ProviderPreferences,
      raw,
      fingerprint: executionPreferenceFingerprint(raw),
    };
  } catch {
    throw new ClientApiError(
      'VALIDATION_ERROR',
      'AI provider preferences are invalid. Open AI Settings and confirm the selected billing path before retrying.',
      false,
      400,
    );
  }
}

export function getEffectiveStoryProviderSelection(): AiProviderSelection {
  const { preferences } = readProviderPreferencesSnapshot();
  const override = preferences?.operationOverrides?.story;
  return {
    connectionId: override?.connectionId ?? preferences?.defaultConnectionId ?? 'gemini-managed',
    modelId: override?.modelId ?? preferences?.defaultTextModelId,
    reasoningLevel: override?.reasoningLevel ?? preferences?.defaultReasoningLevel,
  };
}

export function tryGetEffectiveStoryProviderSelection():
  | { ok: true; selection: AiProviderSelection }
  | { ok: false; error: ClientApiError } {
  try {
    return { ok: true, selection: getEffectiveStoryProviderSelection() };
  } catch (error) {
    if (error instanceof ClientApiError) {
      return { ok: false, error };
    }
    return {
      ok: false,
      error: new ClientApiError(
        'VALIDATION_ERROR',
        error instanceof Error ? error.message : 'AI provider preferences are invalid.',
        false,
        400,
      ),
    };
  }
}

export function validateStoryProviderSelection(
  selection: AiProviderSelection,
  localActivation: boolean,
): { ok: true } | { ok: false; reason: string } {
  if (selection.connectionId !== 'chatgpt-plan') return { ok: true };
  if (!localActivation) {
    return {
      ok: false,
      reason: 'ChatGPT Story is disabled unless the local development server is started with its Story activation flag.',
    };
  }
  if (!selection.modelId) {
    return {
      ok: false,
      reason: 'Choose a verified ChatGPT account model explicitly in AI Settings; no substitution or provider fallback is available.',
    };
  }
  return { ok: true };
}

export function invalidateAiProviderRequests(): void {
  providerRequestGeneration += 1;
  for (const controller of activeProviderRequests) {
    controller.abort(new DOMException('AI provider settings changed.', 'AbortError'));
  }
  activeProviderRequests.clear();
}

export function isAbortError(error: unknown): boolean {
  if (error instanceof DOMException && error.name === 'AbortError') return true;
  if (error instanceof ClientApiError && error.code === 'CANCELLED') return true;
  return false;
}

function ensureStorageListener(): void {
  if (typeof window === 'undefined' || typeof window.addEventListener !== 'function') return;
  if (registeredStorageWindows.has(window)) return;
  registeredStorageWindows.add(window);
  window.addEventListener('storage', (event) => {
    if (event.key === null) {
      observedExecutionPreferenceFingerprint = '';
      invalidateAiProviderRequests();
      return;
    }
    if (event.key !== PROVIDER_PREFERENCES_STORAGE_KEY) return;
    const next = executionPreferenceFingerprint(event.newValue);
    const previous = observedExecutionPreferenceFingerprint ?? executionPreferenceFingerprint(event.oldValue);
    observedExecutionPreferenceFingerprint = next;
    if (previous !== next) invalidateAiProviderRequests();
  });
}

function applyOperationProviderHeaders(
  providerHeaders: Record<string, string>,
  operation: AiOperation,
  preferences: ProviderPreferences,
): void {
  const override = preferences.operationOverrides?.[operation];
  if (operation === 'image' && override) {
    throw new ClientApiError(
      'VALIDATION_ERROR',
      'Image provider overrides are unavailable until the image capability and budget path is qualified.',
      false,
      400,
    );
  }
  const connectionId = operation === 'image' ? 'gemini-managed' : override?.connectionId ?? preferences.defaultConnectionId;
  const modelId = override?.modelId ?? (operation === 'image' ? undefined : preferences.defaultTextModelId);
  const reasoning = override?.reasoningLevel ?? preferences.defaultReasoningLevel;
  if (connectionId) providerHeaders['x-pcc-ai-connection'] = connectionId;
  if (modelId) providerHeaders['x-pcc-ai-model'] = modelId;
  if (operation !== 'image' && reasoning && reasoning !== 'default') {
    providerHeaders['x-pcc-ai-reasoning'] = reasoning;
  }
}

function applyNarrativePlanBindingHeaders(
  providerHeaders: Record<string, string>,
  body: unknown,
): void {
  if (!body || typeof body !== 'object') return;
  const binding = (body as { providerPlanBinding?: NarrativeExtractionRequest['providerPlanBinding'] }).providerPlanBinding;
  if (!binding) return;
  providerHeaders['x-pcc-ai-connection'] ??= binding.connectionId;
  providerHeaders['x-pcc-ai-model'] ??= binding.modelId;
  if (binding.reasoningLevel !== 'default') {
    providerHeaders['x-pcc-ai-reasoning'] ??= binding.reasoningLevel;
  }
}

function resolveProviderHeaders(
  operation: AiOperation,
  body: unknown,
  snapshot: ProviderPreferencesSnapshot,
  requestId?: string,
): Record<string, string> {
  const providerHeaders: Record<string, string> = {};
  if (snapshot.preferences) {
    observedExecutionPreferenceFingerprint = snapshot.fingerprint;
    applyOperationProviderHeaders(providerHeaders, operation, snapshot.preferences);
  }
  if (operation === 'narrative-import') {
    applyNarrativePlanBindingHeaders(providerHeaders, body);
  }
  if (operation === 'story' && providerHeaders['x-pcc-ai-connection'] === 'chatgpt-plan' && requestId) {
    providerHeaders['x-pcc-story-request-id'] = requestId;
  }
  return providerHeaders;
}

async function parseJsonResponse<TResponse>(
  response: Response,
  requestGeneration: number,
  signal?: AbortSignal,
): Promise<TResponse> {
  const payload = (await response.json().catch(() => null)) as { error?: ApiErrorPayload } | TResponse | null;
  if (requestGeneration !== providerRequestGeneration) {
    throw new ClientApiError('CANCELLED', 'The AI response was discarded because its provider selection changed.', false, 499);
  }
  if (signal?.aborted) {
    throw new ClientApiError('CANCELLED', 'The AI request was cancelled.', false, 499);
  }
  if (!response.ok) {
    const errPayload = payload && typeof payload === 'object' && 'error' in payload ? payload.error : undefined;
    throw new ClientApiError(
      errPayload?.code ?? 'UPSTREAM_ERROR',
      errPayload?.message ?? `Request failed with status ${response.status}.`,
      errPayload?.retryable ?? response.status >= 500,
      response.status,
    );
  }
  if (!payload || typeof payload !== 'object') {
    throw new ClientApiError('INVALID_RESPONSE', 'Server returned an invalid JSON payload.', false, response.status);
  }
  return payload as TResponse;
}

interface PostJsonOptions {
  operation: AiOperation;
  signal?: AbortSignal;
  requestId?: string;
}

async function postJson<TResponse>(url: string, body: unknown, options: PostJsonOptions): Promise<TResponse> {
  ensureStorageListener();
  const snapshot = readProviderPreferencesSnapshot();
  const providerHeaders = resolveProviderHeaders(options.operation, body, snapshot, options.requestId);

  const requestGeneration = providerRequestGeneration;
  const controller = new AbortController();
  const abortFromCaller = () => controller.abort(new DOMException('The request was cancelled.', 'AbortError'));
  if (options.signal?.aborted) abortFromCaller();
  else options.signal?.addEventListener('abort', abortFromCaller, { once: true });
  activeProviderRequests.add(controller);

  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...providerHeaders },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    return await parseJsonResponse<TResponse>(response, requestGeneration, controller.signal);
  } finally {
    activeProviderRequests.delete(controller);
    options.signal?.removeEventListener('abort', abortFromCaller);
  }
}

export async function extractNarrativeChunk(
  request: NarrativeExtractionRequest,
  signal?: AbortSignal,
) {
  const data = await postJson<{ extraction: unknown }>('/api/narrative/import/extract', request, { operation: 'narrative-import', signal });
  return NarrativeExtractionSchema.parse(data.extraction);
}

export async function analyzePromptToBeliefGraph(
  prompt: string,
  mode: GenerationMode,
  signal?: AbortSignal
): Promise<BeliefState> {
  const request = enforceOperationRequestBounds(value => AnalyzeRequestSchema.safeParse(value), { prompt, mode });
  const data = await postJson<{ graph: BeliefState }>('/api/analyze', request, { operation: 'analyze', signal });
  return data.graph;
}

export async function generateClarifications(
  prompt: string,
  askedQuestions: string[],
  mode: GenerationMode,
  signal?: AbortSignal,
  confirmedFacts: string[] = []
): Promise<Clarification[]> {
  const request = enforceOperationRequestBounds(value => ClarifyRequestSchema.safeParse(value), {
    prompt, askedQuestions, mode, confirmedFacts,
  });
  const data = await postJson<{ clarifications: Clarification[] }>('/api/clarify', request, { operation: 'clarify', signal });
  return data.clarifications;
}

export async function refinePromptWithAllUpdates(
  originalPrompt: string,
  clarifications: ClarificationAnswer[],
  graphUpdates: GraphUpdate[],
  signal?: AbortSignal
): Promise<string> {
  const request = enforceOperationRequestBounds(value => RefineRequestSchema.safeParse(value), {
    originalPrompt, clarifications, graphUpdates,
  });
  const data = await postJson<{ refinedPrompt: string }>('/api/refine', request, { operation: 'polish', signal });
  return data.refinedPrompt;
}

export async function requestBatchEditInterpretation(
  instruction: string,
  context: {
    prompt: string;
    entities: Array<{
      id?: string;
      name: string;
      category?: string;
      excluded?: boolean;
      attributes: Array<{ name: string; value: string; status?: string }>;
    }>;
    relationships: Array<{ id?: string; source: string; target: string; label: string }>;
  },
  signal?: AbortSignal
): Promise<BatchEditProposalResult> {
  const request = enforceOperationRequestBounds(value => BatchEditRequestSchema.safeParse(value), {
    instruction,
    ...context,
  });
  return postJson<BatchEditProposalResult>('/api/batch-edit', request, { operation: 'batch-edit', signal });
}

export async function generateImagesFromPrompt(
  prompt: string,
  signal?: AbortSignal
): Promise<ImageGenerationResult> {
  const request = enforceOperationRequestBounds(value => GenerateMediaRequestSchema.safeParse(value), { prompt });
  return postJson<ImageGenerationResult>('/api/generate/images', request, { operation: 'image', signal });
}

export async function generateStoryFromPrompt(
  prompt: string,
  signal?: AbortSignal,
  requestId: string | undefined = globalThis.crypto?.randomUUID?.(),
): Promise<{ story: string; usage?: { inputTokens?: number; outputTokens?: number; source: 'provider-observed' | 'estimate' | 'unknown' } }> {
  const request = enforceOperationRequestBounds(value => GenerateMediaRequestSchema.safeParse(value), { prompt });
  const selected = getEffectiveStoryProviderSelection();
  const effectiveStoryConnection = selected.connectionId;
  if (effectiveStoryConnection === 'chatgpt-plan') {
    if (!requestId) throw new ClientApiError('VALIDATION_ERROR', 'A stable identity is required for this ChatGPT story action.', false, 400);
    if (!selected.modelId) {
      throw new ClientApiError('MODEL_UNSUPPORTED', 'Choose an account model explicitly for ChatGPT Story; no default substitution is available.', false, 422);
    }
  }
  const data = await postJson<{ story: string; usage?: { inputTokens?: number; outputTokens?: number; source: 'provider-observed' | 'estimate' | 'unknown' } }>(
    '/api/generate/story',
    request,
    { operation: 'story', signal, ...(effectiveStoryConnection === 'chatgpt-plan' ? { requestId } : {}) },
  );
  return { story: data.story, ...(data.usage ? { usage: data.usage } : {}) };
}

export async function fetchAiCapabilities(signal?: AbortSignal): Promise<AiCapabilitiesResponse> {
  const res = await fetch('/api/ai/capabilities', { signal });
  if (!res.ok) {
    throw new ClientApiError('INTERNAL_ERROR', 'Could not fetch AI capabilities.', true, res.status);
  }
  return (await res.json()) as AiCapabilitiesResponse;
}

export async function requestSemanticDiagnostics(
  payload: DiagnosticsAnalyzeRequest,
  signal?: AbortSignal
): Promise<DiagnosticsAnalyzeResponse> {
  const validated = enforceOperationRequestBounds((v) => DiagnosticsAnalyzeRequestSchema.safeParse(v), payload);
  return postJson<DiagnosticsAnalyzeResponse>('/api/narrative/diagnostics/analyze', validated, { operation: 'diagnostics', signal });
}

export async function requestDiagnosticFixSuggestions(
  payload: DiagnosticsSuggestFixesRequest,
  signal?: AbortSignal
): Promise<DiagnosticsSuggestFixesResponse> {
  const validated = enforceOperationRequestBounds((v) => DiagnosticsSuggestFixesRequestSchema.safeParse(v), payload);
  return postJson<DiagnosticsSuggestFixesResponse>('/api/narrative/diagnostics/suggest-fixes', validated, { operation: 'diagnostics', signal });
}

export async function requestNarrativeSyncAnalysis(
  payload: SyncAnalyzeRequest,
  signal?: AbortSignal
): Promise<SyncAnalyzeResponse> {
  const validated = enforceOperationRequestBounds((v) => SyncAnalyzeRequestSchema.safeParse(v), payload);
  return postJson<SyncAnalyzeResponse>('/api/narrative/sync/analyze', validated, { operation: 'sync', signal });
}

export async function requestWritingAssist(
  payload: WritingAssistRequest,
  signal?: AbortSignal
): Promise<WritingAssistResponse> {
  const validated = enforceOperationRequestBounds((v) => WritingAssistRequestSchema.safeParse(v), payload);
  return postJson<WritingAssistResponse>('/api/narrative/writing/assist', validated, { operation: 'writing', signal });
}

export async function requestCreativeOpportunities(
  payload: OpportunitiesExploreRequest,
  signal?: AbortSignal
): Promise<OpportunitiesExploreResponse> {
  const validated = enforceOperationRequestBounds((v) => OpportunitiesExploreRequestSchema.safeParse(v), payload);
  return postJson<OpportunitiesExploreResponse>('/api/narrative/opportunities/explore', validated, { operation: 'opportunities', signal });
}

export async function requestImportEnhancements(
  payload: ImportEnhanceRequest,
  signal?: AbortSignal
): Promise<ImportEnhanceResponse> {
  const validated = enforceOperationRequestBounds((v) => ImportEnhanceRequestSchema.safeParse(v), payload);
  return postJson<ImportEnhanceResponse>('/api/narrative/import/enhance', validated, { operation: 'import-enhance', signal });
}
