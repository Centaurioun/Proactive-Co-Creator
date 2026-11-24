/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

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

export function isAbortError(error: unknown): boolean {
  if (error instanceof DOMException && error.name === 'AbortError') return true;
  if (error instanceof ClientApiError && error.code === 'CANCELLED') return true;
  return false;
}

export async function extractNarrativeChunk(
  request: NarrativeExtractionRequest,
  signal?: AbortSignal,
) {
  const data = await postJson<{ extraction: unknown }>('/api/narrative/import/extract', request, signal);
  return NarrativeExtractionSchema.parse(data.extraction);
}

async function postJson<TResponse>(
  url: string,
  body: unknown,
  signal?: AbortSignal
): Promise<TResponse> {
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal,
  });

  const payload = (await response.json().catch(() => null)) as
    | { error?: ApiErrorPayload }
    | TResponse
    | null;

  if (!response.ok) {
    const errPayload =
      payload && typeof payload === 'object' && 'error' in payload ? payload.error : undefined;
    throw new ClientApiError(
      errPayload?.code ?? 'UPSTREAM_ERROR',
      errPayload?.message ?? `Request failed with status ${response.status}.`,
      errPayload?.retryable ?? response.status >= 500,
      response.status
    );
  }

  if (!payload || typeof payload !== 'object') {
    throw new ClientApiError(
      'INVALID_RESPONSE',
      'Server returned an invalid JSON payload.',
      false,
      response.status
    );
  }

  return payload as TResponse;
}

export async function analyzePromptToBeliefGraph(
  prompt: string,
  mode: GenerationMode,
  signal?: AbortSignal
): Promise<BeliefState> {
  const request = enforceOperationRequestBounds(value => AnalyzeRequestSchema.safeParse(value), { prompt, mode });
  const data = await postJson<{ graph: BeliefState }>('/api/analyze', request, signal);
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
  const data = await postJson<{ clarifications: Clarification[] }>(
    '/api/clarify',
    request,
    signal
  );
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
  const data = await postJson<{ refinedPrompt: string }>(
    '/api/refine',
    request,
    signal
  );
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
  return postJson<BatchEditProposalResult>(
    '/api/batch-edit',
    request,
    signal
  );
}

export async function generateImagesFromPrompt(
  prompt: string,
  signal?: AbortSignal
): Promise<ImageGenerationResult> {
  const request = enforceOperationRequestBounds(value => GenerateMediaRequestSchema.safeParse(value), { prompt });
  return postJson<ImageGenerationResult>('/api/generate/images', request, signal);
}

export async function generateStoryFromPrompt(
  prompt: string,
  signal?: AbortSignal
): Promise<string> {
  const request = enforceOperationRequestBounds(value => GenerateMediaRequestSchema.safeParse(value), { prompt });
  const data = await postJson<{ story: string }>('/api/generate/story', request, signal);
  return data.story;
}

export interface AiCapabilitiesResponse {
  configured: boolean;
  textModel: string;
  imageModel: string;
  providerLimitsVerifiedLive: boolean;
  note: string;
  operations: Record<
    string,
    {
      model: string;
      maxInputChars: number;
      maxInputTokens: number;
      maxOutputTokens: number;
      timeoutMs: number;
      maxConcurrent: number;
      maxCallsPerMinute: number;
      description: string;
    }
  >;
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
  return postJson<DiagnosticsAnalyzeResponse>('/api/narrative/diagnostics/analyze', validated, signal);
}

export async function requestDiagnosticFixSuggestions(
  payload: DiagnosticsSuggestFixesRequest,
  signal?: AbortSignal
): Promise<DiagnosticsSuggestFixesResponse> {
  const validated = enforceOperationRequestBounds((v) => DiagnosticsSuggestFixesRequestSchema.safeParse(v), payload);
  return postJson<DiagnosticsSuggestFixesResponse>('/api/narrative/diagnostics/suggest-fixes', validated, signal);
}

export async function requestNarrativeSyncAnalysis(
  payload: SyncAnalyzeRequest,
  signal?: AbortSignal
): Promise<SyncAnalyzeResponse> {
  const validated = enforceOperationRequestBounds((v) => SyncAnalyzeRequestSchema.safeParse(v), payload);
  return postJson<SyncAnalyzeResponse>('/api/narrative/sync/analyze', validated, signal);
}

export async function requestWritingAssist(
  payload: WritingAssistRequest,
  signal?: AbortSignal
): Promise<WritingAssistResponse> {
  const validated = enforceOperationRequestBounds((v) => WritingAssistRequestSchema.safeParse(v), payload);
  return postJson<WritingAssistResponse>('/api/narrative/writing/assist', validated, signal);
}

export async function requestCreativeOpportunities(
  payload: OpportunitiesExploreRequest,
  signal?: AbortSignal
): Promise<OpportunitiesExploreResponse> {
  const validated = enforceOperationRequestBounds((v) => OpportunitiesExploreRequestSchema.safeParse(v), payload);
  return postJson<OpportunitiesExploreResponse>('/api/narrative/opportunities/explore', validated, signal);
}

export async function requestImportEnhancements(
  payload: ImportEnhanceRequest,
  signal?: AbortSignal
): Promise<ImportEnhanceResponse> {
  const validated = enforceOperationRequestBounds((v) => ImportEnhanceRequestSchema.safeParse(v), payload);
  return postJson<ImportEnhanceResponse>('/api/narrative/import/enhance', validated, signal);
}
