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

export function resolveAbortError(signal?: AbortSignal): AppApiError {
  if (signal?.aborted && signal.reason instanceof AppApiError) {
    return signal.reason;
  }
  return new AppApiError('CANCELLED', 'The request was cancelled.', 499, false);
}

export function defaultSleep(ms: number, signal?: AbortSignal): Promise<void> {
  if (signal?.aborted) {
    return Promise.reject(resolveAbortError(signal));
  }
  return new Promise((resolve, reject) => {
    const onAbort = () => {
      clearTimeout(timer);
      reject(resolveAbortError(signal));
    };
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}

function readRetryAfterHeader(headers: unknown): string | undefined {
  if (!headers || typeof headers !== 'object') return undefined;
  if (typeof (headers as { get?: unknown }).get === 'function') {
    const val = (headers as { get: (name: string) => string | null }).get('retry-after');
    return typeof val === 'string' ? val : undefined;
  }
  const record = headers as Record<string, unknown>;
  for (const key of Object.keys(record)) {
    if (key.toLowerCase() === 'retry-after' && typeof record[key] === 'string') {
      return record[key] as string;
    }
  }
  return undefined;
}

export function extractRetryAfterMs(error: unknown, nowMs: number = Date.now()): number | null {
  if (typeof error !== 'object' || error === null) return null;
  const raw = readRetryAfterHeader((error as { headers?: unknown }).headers);
  if (typeof raw !== 'string') return null;
  const trimmed = raw.trim();
  if (!trimmed) return null;
  const seconds = Number(trimmed);
  if (Number.isFinite(seconds) && seconds >= 0) {
    return Math.min(seconds * 1000, 30000);
  }
  const parsedDateMs = Date.parse(trimmed);
  if (Number.isFinite(parsedDateMs)) {
    return Math.min(Math.max(0, parsedDateMs - nowMs), 30000);
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
      throw resolveAbortError(options.signal);
    }

    try {
      const value = await fn();
      if (options.signal?.aborted) {
        throw resolveAbortError(options.signal);
      }
      return value;
    } catch (error) {
      lastError = error;
      if (options.signal?.aborted) {
        throw resolveAbortError(options.signal);
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
