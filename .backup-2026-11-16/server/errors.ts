/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import type { ApiErrorCode, ApiErrorPayload } from '../shared/types.ts';

export class AppApiError extends Error {
  readonly code: ApiErrorCode;
  readonly statusCode: number;
  readonly retryable: boolean;

  constructor(
    code: ApiErrorCode,
    message: string,
    statusCode: number = 500,
    retryable: boolean = false
  ) {
    super(message);
    this.name = 'AppApiError';
    this.code = code;
    this.statusCode = statusCode;
    this.retryable = retryable;
  }

  toPayload(): ApiErrorPayload {
    return {
      code: this.code,
      message: this.message,
      retryable: this.retryable,
    };
  }
}

export function extractErrorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === 'string') return error;
  try {
    return JSON.stringify(error);
  } catch {
    return 'Unknown error';
  }
}

export function extractStatusCode(error: unknown): number | undefined {
  if (typeof error === 'object' && error !== null) {
    const maybeStatus = (error as { status?: unknown; statusCode?: unknown }).status ??
      (error as { statusCode?: unknown }).statusCode;
    if (typeof maybeStatus === 'number') return maybeStatus;
  }
  return undefined;
}

export function isRetryableGeminiError(error: unknown): boolean {
  if (error instanceof AppApiError) {
    return error.retryable;
  }
  const status = extractStatusCode(error);
  if (status === 429 || status === 500 || status === 502 || status === 503 || status === 504) {
    return true;
  }
  const msg = extractErrorMessage(error).toLowerCase();
  return (
    msg.includes('429') ||
    msg.includes('resource_exhausted') ||
    msg.includes('503') ||
    msg.includes('unavailable') ||
    msg.includes('502') ||
    msg.includes('bad gateway') ||
    msg.includes('504') ||
    msg.includes('gateway timeout') ||
    msg.includes('500') ||
    msg.includes('fetch failed') ||
    msg.includes('econnreset') ||
    msg.includes('etimedout') ||
    msg.includes('rpc failed')
  );
}

export function classifyGeminiError(error: unknown): AppApiError {
  if (error instanceof AppApiError) return error;

  const rawMsg = extractErrorMessage(error);
  const lower = rawMsg.toLowerCase();
  const status = extractStatusCode(error);

  if (lower.includes('aborted') || lower.includes('cancelled') || lower.includes('canceled')) {
    return new AppApiError('CANCELLED', 'The request was cancelled.', 499, false);
  }

  if (lower.includes('timeout') || lower.includes('timed out') || status === 504) {
    return new AppApiError(
      'TIMEOUT',
      'The AI service took too long to respond. Please try again.',
      504,
      true
    );
  }

  if (
    status === 401 ||
    status === 403 ||
    lower.includes('permission_denied') ||
    lower.includes('api_key_invalid') ||
    lower.includes('api key not valid') ||
    lower.includes('unauthorized')
  ) {
    return new AppApiError(
      'AUTH_ERROR',
      'Gemini API authentication failed. Please check the server GEMINI_API_KEY configuration in Settings > Secrets.',
      403,
      false
    );
  }

  if (status === 429 || lower.includes('resource_exhausted') || lower.includes('rate limit') || lower.includes('quota')) {
    return new AppApiError(
      'RATE_LIMITED',
      'Gemini API rate limit or quota exceeded. Wait a moment before retrying or check your billing tier in Settings > Secrets.',
      429,
      true
    );
  }

  if (status === 404 || lower.includes('not_found') || lower.includes('is not found for api version') || lower.includes('unsupported model')) {
    return new AppApiError(
      'MODEL_UNSUPPORTED',
      'The configured AI model is unavailable or unsupported for this request.',
      502,
      false
    );
  }

  if (lower.includes('safety') || lower.includes('blocked') || lower.includes('prohibited_content')) {
    return new AppApiError(
      'SAFETY_BLOCKED',
      'The prompt or generated output was blocked by content safety filters. Please adjust your prompt and try again.',
      422,
      false
    );
  }

  if (rawMsg.startsWith('INVALID_RESPONSE:')) {
    return new AppApiError(
      'INVALID_RESPONSE',
      'The AI model returned an unexpected response format. Please try again.',
      502,
      false
    );
  }

  if (isRetryableGeminiError(error)) {
    return new AppApiError(
      'UPSTREAM_ERROR',
      'The Gemini service is temporarily unavailable. Please try again shortly.',
      503,
      true
    );
  }

  return new AppApiError(
    'INTERNAL_ERROR',
    'An unexpected error occurred while communicating with Gemini.',
    500,
    false
  );
}
