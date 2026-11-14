/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import type {
  ApiErrorCode,
  ApiErrorPayload,
  BeliefState,
  Clarification,
  ClarificationAnswer,
  GenerationMode,
  GraphUpdate,
  ImageGenerationResult,
  VideoJobStatusResult,
} from '../shared/types';

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

async function getJson<TResponse>(url: string, signal?: AbortSignal): Promise<TResponse> {
  const response = await fetch(url, { method: 'GET', signal });
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

function sleepWithAbort(ms: number, signal?: AbortSignal): Promise<void> {
  if (signal?.aborted) {
    return Promise.reject(new DOMException('Aborted', 'AbortError'));
  }
  return new Promise((resolve, reject) => {
    const onAbort = () => {
      clearTimeout(timer);
      reject(new DOMException('Aborted', 'AbortError'));
    };
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    signal?.addEventListener('abort', onAbort, { once: true });
  });
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
  signal?: AbortSignal
): Promise<Clarification[]> {
  const data = await postJson<{ clarifications: Clarification[] }>(
    '/api/clarify',
    { prompt, askedQuestions, mode },
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

const MAX_VIDEO_POLL_ATTEMPTS = 60;
const VIDEO_POLL_INTERVAL_MS = 5000;

export async function generateVideoFromPrompt(
  prompt: string,
  onStatusUpdate?: (message: string) => void,
  signal?: AbortSignal
): Promise<string> {
  onStatusUpdate?.('Starting video generation...');
  let job = await postJson<VideoJobStatusResult>('/api/generate/video', { prompt }, signal);

  if (job.status === 'completed' && job.videoUrl) {
    return job.videoUrl;
  }
  if (job.status === 'failed' || job.status === 'cancelled') {
    throw new ClientApiError(
      'UPSTREAM_ERROR',
      job.error ?? 'Video generation failed.',
      false,
      502
    );
  }

  const interactionId = job.interactionId;
  const cancelRemote = () => {
    void fetch(`/api/generate/video/${encodeURIComponent(interactionId)}/cancel`, {
      method: 'POST',
    }).catch(() => undefined);
  };

  signal?.addEventListener('abort', cancelRemote, { once: true });

  try {
    for (let attempt = 1; attempt <= MAX_VIDEO_POLL_ATTEMPTS; attempt++) {
      onStatusUpdate?.(
        `Generating video frames (check ${attempt}/${MAX_VIDEO_POLL_ATTEMPTS})...`
      );
      await sleepWithAbort(VIDEO_POLL_INTERVAL_MS, signal);

      job = await getJson<VideoJobStatusResult>(
        `/api/generate/video/${encodeURIComponent(interactionId)}`,
        signal
      );

      if (job.status === 'completed' && job.videoUrl) {
        return job.videoUrl;
      }
      if (job.status === 'failed' || job.status === 'cancelled') {
        throw new ClientApiError(
          'UPSTREAM_ERROR',
          job.error ?? 'Video generation did not complete.',
          false,
          502
        );
      }
    }

    cancelRemote();
    throw new ClientApiError(
      'TIMEOUT',
      'Video generation exceeded the maximum wait time. Please try again.',
      true,
      504
    );
  } finally {
    signal?.removeEventListener('abort', cancelRemote);
  }
}
