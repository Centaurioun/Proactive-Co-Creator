export interface BoundedHttpBody {
  ok: boolean;
  status: number;
  statusText: string;
  headers: Headers;
  body: string;
}

export interface BoundedHttpOptions {
  timeoutMs: number;
  maxBodyBytes: number;
  signal?: AbortSignal;
}

function sanitizedHttpError(message: string): Error {
  // Avoid retaining raw transport errors that may include endpoint or credential details.
  return new Error(message);
}

/** Fetches one endpoint, rejects redirects, and keeps cancellation active through bounded body consumption. */
export async function fetchBoundedHttpBody(
  fetchImpl: typeof fetch,
  input: RequestInfo | URL,
  init: RequestInit,
  options: BoundedHttpOptions,
): Promise<BoundedHttpBody> {
  const { timeoutMs, maxBodyBytes, signal: parentSignal } = options;
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs <= 0 || !Number.isSafeInteger(maxBodyBytes) || maxBodyBytes <= 0) {
    throw new Error('OAuth HTTP bounds are invalid.');
  }
  if (parentSignal?.aborted) throw new Error('OAuth HTTP request was cancelled.');

  const controller = new AbortController();
  let timedOut = false;
  let rejectTimeout!: (error: Error) => void;
  const timeout = new Promise<never>((_resolve, reject) => { rejectTimeout = reject; });
  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort(new Error('OAuth HTTP request timed out.'));
    rejectTimeout(new Error('OAuth HTTP request timed out.'));
  }, timeoutMs);
  let rejectCancelled!: (error: Error) => void;
  const cancelled = new Promise<never>((_resolve, reject) => { rejectCancelled = reject; });
  const onParentAbort = () => {
    controller.abort(parentSignal?.reason);
    rejectCancelled(new Error('OAuth HTTP request was cancelled.'));
  };
  parentSignal?.addEventListener('abort', onParentAbort, { once: true });

  const operation = (async (): Promise<BoundedHttpBody> => {
    const response = await fetchImpl(input, { ...init, redirect: 'error', signal: controller.signal });
    const reader = response.body?.getReader();
    const chunks: Uint8Array[] = [];
    let totalBytes = 0;
    try {
      while (reader) {
        const { done, value } = await reader.read();
        if (done) break;
        totalBytes += value.byteLength;
        if (totalBytes > maxBodyBytes) {
          controller.abort(new Error('OAuth HTTP response exceeded its size limit.'));
          throw new Error('OAuth HTTP response exceeded its size limit.');
        }
        chunks.push(value);
      }
    } catch (error) {
      try { await reader?.cancel(); } catch { /* The transport may already have closed. */ }
      throw error;
    } finally {
      reader?.releaseLock();
    }
    const bytes = new Uint8Array(totalBytes);
    let offset = 0;
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
    return {
      ok: response.ok,
      status: response.status,
      statusText: response.statusText,
      headers: response.headers,
      body: new TextDecoder('utf-8', { fatal: true }).decode(bytes),
    };
  })();

  try {
    return await Promise.race([operation, timeout, cancelled]);
  } catch (error) {
    if (timedOut) throw sanitizedHttpError('OAuth HTTP request timed out.');
    if (parentSignal?.aborted) throw sanitizedHttpError('OAuth HTTP request was cancelled.');
    if (error instanceof TypeError && /fetch failed/i.test(error.message)) throw sanitizedHttpError('OAuth HTTP request failed.');
    throw error;
  } finally {
    clearTimeout(timer);
    parentSignal?.removeEventListener('abort', onParentAbort);
    controller.abort();
  }
}

export function parseOAuthJson(body: string, message: string): unknown {
  try { return JSON.parse(body) as unknown; }
  catch { throw new Error(message); }
}
