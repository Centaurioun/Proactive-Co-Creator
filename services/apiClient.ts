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
  const data = await postJson<{ graph: BeliefState }>('/api/analyze', { prompt, mode }, signal);
  return data.graph;
}

export async function generateClarifications(
  prompt: string,
  askedQuestions: string[],
  mode: GenerationMode,
  signal?: AbortSignal,
  confirmedFacts: string[] = []
): Promise<Clarification[]> {
  const data = await postJson<{ clarifications: Clarification[] }>(
    '/api/clarify',
    { prompt, askedQuestions, mode, confirmedFacts },
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
  const data = await postJson<{ refinedPrompt: string }>(
    '/api/refine',
    { originalPrompt, clarifications, graphUpdates },
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
  return postJson<BatchEditProposalResult>(
    '/api/batch-edit',
    {
      instruction,
      ...context,
    },
    signal
  );
}

export async function generateImagesFromPrompt(
  prompt: string,
  signal?: AbortSignal
): Promise<ImageGenerationResult> {
  return postJson<ImageGenerationResult>('/api/generate/images', { prompt }, signal);
}

export async function generateStoryFromPrompt(
  prompt: string,
  signal?: AbortSignal
): Promise<string> {
  const data = await postJson<{ story: string }>('/api/generate/story', { prompt }, signal);
  return data.story;
}
