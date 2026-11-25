/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { AppApiError, isRetryableGeminiError } from './errors.ts';
import { getAiProviderRequestContext } from './providers/requestContext.ts';

export interface RetryOptions {
  maxAttempts?: number;
  initialDelayMs?: number;
  maxDelayMs?: number;
  signal?: AbortSignal;
  sleep?: (ms: number, signal?: AbortSignal) => Promise<void>;
  random?: () => number;
}

export function defaultSleep(ms: number, signal?: AbortSignal): Promise<void> {
  if (signal?.aborted) {
    return Promise.reject(new AppApiError('CANCELLED', 'The request was cancelled.', 499, false));
  }
  return new Promise((resolve, reject) => {
    const onAbort = () => {
      clearTimeout(timer);
      reject(new AppApiError('CANCELLED', 'The request was cancelled.', 499, false));
    };
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}

export function extractRetryAfterMs(error: unknown): number | null {
  if (typeof error === 'object' && error !== null) {
    const headers = (error as { headers?: Record<string, string> }).headers;
    const retryAfter = headers?.['retry-after'] ?? headers?.['Retry-After'];
    if (typeof retryAfter === 'string') {
      const seconds = Number(retryAfter);
      if (Number.isFinite(seconds) && seconds >= 0) {
        return Math.min(seconds * 1000, 30000);
      }
    }
  }
  return null;
}

export async function withRetry<T>(
  fn: () => Promise<T>,
  options: RetryOptions = {}
): Promise<T> {
  const selectedConnection = getAiProviderRequestContext()?.selection.connectionId;
  const maxAttempts = selectedConnection === 'chatgpt-plan' ? 1 : Math.max(1, options.maxAttempts ?? 3);
  const initialDelayMs = options.initialDelayMs ?? 800;
  const maxDelayMs = options.maxDelayMs ?? 12000;
  const sleep = options.sleep ?? defaultSleep;
  const random = options.random ?? Math.random;

  let currentDelay = initialDelayMs;
  let lastError: unknown;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    if (options.signal?.aborted) {
      throw new AppApiError('CANCELLED', 'The request was cancelled.', 499, false);
    }

    try {
      return await fn();
    } catch (error) {
      lastError = error;
      if (options.signal?.aborted) {
        throw new AppApiError('CANCELLED', 'The request was cancelled.', 499, false);
      }

      if (attempt >= maxAttempts || !isRetryableGeminiError(error)) {
        throw error;
      }

      const retryAfterMs = extractRetryAfterMs(error);
      const jitter = Math.floor(random() * 400);
      const delayMs = retryAfterMs ?? Math.min(maxDelayMs, currentDelay + jitter);
      await sleep(delayMs, options.signal);
      currentDelay = Math.min(maxDelayMs, currentDelay * 2);
    }
  }

  throw lastError;
}
