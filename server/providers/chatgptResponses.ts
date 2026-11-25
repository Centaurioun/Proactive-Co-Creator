import type {
  AiBillingPath,
  AiConnectionId,
  AiModelDescriptor,
  AiProviderAdapter,
  AiProviderRequest,
  AiProviderTextResult,
  AiTokenCount,
} from './contracts.ts';
import { AppApiError } from '../errors.ts';
import {
  assertModelOperation,
  assertReasoningSelection,
  describeChatGptModel,
  reasoningParameter,
} from './policy.ts';

const API_ORIGIN = 'https://api.openai.com/v1';
const HARD_MAX_TIMEOUT_MS = 120_000;
const HARD_MAX_INPUT_BYTES = 2 * 1024 * 1024;
const HARD_MAX_OUTPUT_BYTES = 2 * 1024 * 1024;
const HARD_MAX_STREAM_BYTES = 4 * 1024 * 1024;
const MAX_SSE_LINE_CHARS = 128 * 1024;

type TokenSource = string | (() => string | Promise<string>);
type FetchLike = typeof fetch;

interface SseEvent {
  type: string;
  [key: string]: unknown;
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined;
}

function positiveBound(value: number, name: string, hardMaximum: number): number {
  if (!Number.isSafeInteger(value) || value < 1) {
    throw new AppApiError('VALIDATION_ERROR', `A positive ${name} limit is required.`, 400, false);
  }
  return Math.min(value, hardMaximum);
}

function diagnosticToken(value: unknown): string | undefined {
  return typeof value === 'string' && value.length <= 128 && /^[A-Za-z0-9_.:-]+$/.test(value) ? value : undefined;
}

function diagnosticSuffix(code?: string, parameter?: string, requestId?: string): string {
  const fields = [code && `code=${code}`, parameter && `param=${parameter}`, requestId && `request=${requestId}`].filter(Boolean);
  return fields.length ? ` (${fields.join('; ')})` : '';
}

function abortError(signal?: AbortSignal): AppApiError {
  if (signal?.reason instanceof AppApiError) return signal.reason;
  return new AppApiError('CANCELLED', 'The request was cancelled.', 499, false);
}

function readUsage(value: unknown): AiProviderTextResult['usage'] {
  const usage = asRecord(value);
  if (!usage) return { source: 'unknown' };
  const inputTokens = usage.input_tokens;
  const outputTokens = usage.output_tokens;
  const inputValid = Number.isSafeInteger(inputTokens) && (inputTokens as number) >= 0;
  const outputValid = Number.isSafeInteger(outputTokens) && (outputTokens as number) >= 0;
  if (!inputValid && !outputValid) return { source: 'unknown' };
  return {
    ...(inputValid ? { inputTokens: inputTokens as number } : {}),
    ...(outputValid ? { outputTokens: outputTokens as number } : {}),
    source: 'provider-observed',
  };
}

function validateSseEvent(eventName: string, data: string): SseEvent {
  let parsed: unknown;
  try {
    parsed = JSON.parse(data);
  } catch {
    throw new AppApiError('INVALID_RESPONSE', 'The Responses stream contained malformed SSE JSON.', 502, false);
  }
  const record = asRecord(parsed);
  if (!record || typeof record.type !== 'string') {
    throw new AppApiError('INVALID_RESPONSE', 'The Responses stream event did not contain a valid type.', 502, false);
  }
  if (eventName && eventName !== record.type) {
    throw new AppApiError('INVALID_RESPONSE', 'The Responses SSE event type did not match its JSON envelope.', 502, false);
  }
  return record as SseEvent;
}

/**
 * Parse SSE frames strictly. We accept standard comments/fields and multi-line data,
 * but every dispatched frame must be valid JSON with a Responses event type.
 */
async function* readSseEvents(
  response: Response,
  limits: { maxStreamBytes: number; maxOutputBytes: number },
): AsyncGenerator<SseEvent> {
  if (!response.body) {
    throw new AppApiError('INVALID_RESPONSE', 'The Responses endpoint returned no stream body.', 502, false);
  }
  const reader = response.body.getReader();
  const decoder = new TextDecoder('utf-8', { fatal: true });
  let pending = '';
  let eventName = '';
  let dataLines: string[] = [];
  let streamBytes = 0;
  let outputBytes = 0;
  let terminal = false;

  const dispatch = (): SseEvent | undefined => {
    if (dataLines.length === 0) {
      eventName = '';
      return undefined;
    }
    if (terminal) {
      throw new AppApiError('INVALID_RESPONSE', 'The Responses stream emitted data after a terminal event.', 502, false);
    }
    const event = validateSseEvent(eventName, dataLines.join('\n'));
    eventName = '';
    dataLines = [];
    if (event.type === 'response.output_text.delta') {
      if (typeof event.delta !== 'string') {
        throw new AppApiError('INVALID_RESPONSE', 'The Responses stream contained a malformed text delta.', 502, false);
      }
      outputBytes += new TextEncoder().encode(event.delta).byteLength;
      if (outputBytes > limits.maxOutputBytes) {
        throw new AppApiError('VALIDATION_ERROR', 'The Responses output exceeded the configured output byte limit.', 413, false);
      }
    }
    if (event.type === 'response.completed' || event.type === 'response.failed' || event.type === 'response.incomplete') {
      terminal = true;
    }
    return event;
  };

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      streamBytes += value.byteLength;
      if (streamBytes > limits.maxStreamBytes) {
        throw new AppApiError('VALIDATION_ERROR', 'The Responses stream exceeded the adapter byte limit.', 413, false);
      }
      pending += decoder.decode(value, { stream: true });
      if (pending.length > MAX_SSE_LINE_CHARS && !/[\r\n]/.test(pending)) {
        throw new AppApiError('INVALID_RESPONSE', 'The Responses stream contained an oversized SSE line.', 502, false);
      }
      let newlineIndex: number;
      while ((newlineIndex = pending.search(/[\r\n]/)) >= 0) {
        const char = pending[newlineIndex];
        if (char === '\r' && newlineIndex === pending.length - 1) break;
        const line = pending.slice(0, newlineIndex);
        const lineEndingLength = char === '\r' && pending[newlineIndex + 1] === '\n' ? 2 : 1;
        pending = pending.slice(newlineIndex + lineEndingLength);
        if (line.length > MAX_SSE_LINE_CHARS) {
          throw new AppApiError('INVALID_RESPONSE', 'The Responses stream contained an oversized SSE line.', 502, false);
        }
        if (line === '') {
          const event = dispatch();
          if (event) yield event;
          continue;
        }
        if (line.startsWith(':')) continue;
        const colon = line.indexOf(':');
        const field = colon < 0 ? line : line.slice(0, colon);
        let fieldValue = colon < 0 ? '' : line.slice(colon + 1);
        if (fieldValue.startsWith(' ')) fieldValue = fieldValue.slice(1);
        if (field === 'event') eventName = fieldValue;
        else if (field === 'data') dataLines.push(fieldValue);
      }
    }
    pending += decoder.decode();
    if (pending.length > 0) {
      const line = pending.replace(/\r$/, '');
      if (line === '') {
        const event = dispatch();
        if (event) yield event;
      } else if (!line.startsWith(':')) {
        const colon = line.indexOf(':');
        const field = colon < 0 ? line : line.slice(0, colon);
        let fieldValue = colon < 0 ? '' : line.slice(colon + 1);
        if (fieldValue.startsWith(' ')) fieldValue = fieldValue.slice(1);
        if (field === 'event') eventName = fieldValue;
        else if (field === 'data') dataLines.push(fieldValue);
      }
    }
    const finalEvent = dispatch();
    if (finalEvent) yield finalEvent;
  } catch (error) {
    try { await reader.cancel(error); } catch { /* best-effort stream cleanup */ }
    if (error instanceof AppApiError) throw error;
    throw new AppApiError('INVALID_RESPONSE', 'The Responses stream could not be decoded.', 502, false);
  } finally {
    reader.releaseLock();
  }
}

export class ChatGptResponsesAdapter implements AiProviderAdapter {
  readonly connectionId: AiConnectionId;
  readonly family = 'openai' as const;
  readonly billing: AiBillingPath;
  private readonly tokenSource: TokenSource;
  private readonly fetchImpl: FetchLike;
  private readonly requestLease?: (signal?: AbortSignal) => { signal: AbortSignal; release: () => void };

  private get providerLabel(): string {
    return this.connectionId === 'chatgpt-plan' ? 'ChatGPT plan' : 'OpenAI API';
  }

  constructor(
    tokenSource: TokenSource,
    fetchImpl: FetchLike = fetch,
    requestLease?: (signal?: AbortSignal) => { signal: AbortSignal; release: () => void },
    connectionId: 'chatgpt-plan' | 'openai-api' = 'chatgpt-plan',
  ) {
    this.tokenSource = tokenSource;
    this.fetchImpl = fetchImpl;
    this.requestLease = requestLease;
    this.connectionId = connectionId;
    this.billing = connectionId === 'chatgpt-plan' ? 'chatgpt-plan' : 'openai-api-key';
  }

  private async accessToken(): Promise<string> {
    const token = typeof this.tokenSource === 'function' ? await this.tokenSource() : this.tokenSource;
    if (!token.trim()) throw new AppApiError('AUTH_ERROR', this.connectionId === 'chatgpt-plan' ? 'Connect a ChatGPT account before using its plan.' : 'Add an OpenAI API key for this server session before using OpenAI API billing.', 401, false);
    return token;
  }

  async listModels(signal?: AbortSignal): Promise<AiModelDescriptor[]> {
    const lease = this.requestLease?.(signal);
    try {
      return await this.listModelsWithSignal(lease?.signal ?? signal);
    } finally {
      lease?.release();
    }
  }

  private async listModelsWithSignal(signal?: AbortSignal): Promise<AiModelDescriptor[]> {
    if (signal?.aborted) throw abortError(signal);
    const token = await this.accessToken();
    let response: Response;
    try {
      response = await this.fetchImpl(`${API_ORIGIN}/models`, {
        method: 'GET',
        headers: { authorization: `Bearer ${token}` },
        signal,
      });
    } catch {
      if (signal?.aborted) throw abortError(signal);
      throw new AppApiError('UPSTREAM_ERROR', `Could not retrieve the ${this.connectionId === 'chatgpt-plan' ? 'ChatGPT account' : 'OpenAI API'} model catalog.`, 503, true);
    }
    if (!response.ok) throw await this.httpError(response);
    let payload: unknown;
    try { payload = await response.json(); } catch {
      throw new AppApiError('INVALID_RESPONSE', 'The ChatGPT account model catalog was malformed.', 502, false);
    }
    const models = this.connectionId === 'chatgpt-plan' ? asRecord(payload)?.models : asRecord(payload)?.data;
    if (!Array.isArray(models)) {
      throw new AppApiError('INVALID_RESPONSE', 'The account model catalog did not contain a valid model array.', 502, false);
    }
    return models.flatMap((item): AiModelDescriptor[] => {
      const model = asRecord(item);
      const id = this.connectionId === 'chatgpt-plan' ? model?.slug : model?.id;
      if (!model || typeof id !== 'string' || (this.connectionId === 'chatgpt-plan' && model.visibility !== 'list')) return [];
      return [describeChatGptModel({
        id,
        displayName: typeof model.display_name === 'string' && model.display_name.trim()
          ? model.display_name
          : typeof model.name === 'string' && model.name.trim() ? model.name : id,
      }, this.connectionId as 'chatgpt-plan' | 'openai-api')];
    });
  }

  async countTokens(_modelId: string, input: string, signal?: AbortSignal): Promise<AiTokenCount> {
    if (signal?.aborted) throw abortError(signal);
    // SIWC documents no token-count route. This rough estimate is not provider evidence.
    return { tokens: Math.ceil(new TextEncoder().encode(input).byteLength / 4), source: 'estimate' };
  }

  async generateText(request: AiProviderRequest): Promise<AiProviderTextResult> {
    const maxInputBytes = positiveBound(request.maxInputBytes, 'input byte', HARD_MAX_INPUT_BYTES);
    const maxOutputBytes = positiveBound(request.maxOutputBytes, 'output byte', HARD_MAX_OUTPUT_BYTES);
    const timeoutMs = positiveBound(request.timeoutMs, 'timeout', HARD_MAX_TIMEOUT_MS);
    if (!request.modelId.trim()) throw new AppApiError('VALIDATION_ERROR', 'A model is required.', 400, false);
    const constrainedJsonInstruction = request.responseSchema === undefined ? '' :
      `Return exactly one JSON value that conforms to this response schema. Do not add markdown fences, commentary, or extra fields. Validate internally before answering. Schema: ${JSON.stringify(request.responseSchema)}`;
    const instructions = [request.instructions, constrainedJsonInstruction].filter(Boolean).join('\n\n');
    const inputBytes = new TextEncoder().encode(request.input).byteLength +
      new TextEncoder().encode(instructions).byteLength;
    if (inputBytes > maxInputBytes) {
      throw new AppApiError('VALIDATION_ERROR', 'The request input exceeded the configured input byte limit.', 413, false);
    }
    const model = describeChatGptModel({ id: request.modelId, displayName: request.modelId }, this.connectionId as 'chatgpt-plan' | 'openai-api');
    assertModelOperation(model, request.operation);
    assertReasoningSelection(model, request.reasoningLevel);
    const lease = this.requestLease?.(request.signal);
    const operationSignal = lease?.signal ?? request.signal;
    if (operationSignal?.aborted) { lease?.release(); throw abortError(operationSignal); }

    const controller = new AbortController();
    let timeoutError: AppApiError | undefined;
    const onExternalAbort = () => controller.abort(operationSignal?.reason);
    operationSignal?.addEventListener('abort', onExternalAbort, { once: true });
    const timer = setTimeout(() => {
      timeoutError = new AppApiError('TIMEOUT', `The ${this.providerLabel} Responses request exceeded its time limit.`, 504, true);
      controller.abort(timeoutError);
    }, timeoutMs);

    const perform = async (): Promise<AiProviderTextResult> => {
      const token = await this.accessToken();
      if (controller.signal.aborted) throw timeoutError ?? abortError(operationSignal);
      const reasoning = reasoningParameter(model, request.reasoningLevel);
      let response: Response;
      try {
        response = await this.fetchImpl(`${API_ORIGIN}/responses`, {
          method: 'POST',
          headers: {
            authorization: `Bearer ${token}`,
            'content-type': 'application/json',
            accept: 'text/event-stream',
          },
          body: JSON.stringify({
            model: request.modelId,
            input: [{ role: 'user', content: request.input }],
            ...(instructions ? { instructions } : {}),
            ...reasoning,
            store: false,
            stream: true,
          }),
          signal: controller.signal,
        });
      } catch {
        if (timeoutError) throw timeoutError;
        if (operationSignal?.aborted) throw abortError(operationSignal);
        if (controller.signal.aborted) throw abortError(controller.signal);
          throw new AppApiError('UPSTREAM_ERROR', `The ${this.providerLabel} Responses request failed before streaming.`, 503, true);
      }
      if (!response.ok) throw await this.httpError(response);

      const text: string[] = [];
      let completedEvent: SseEvent | undefined;
      for await (const event of readSseEvents(response, {
        maxStreamBytes: Math.min(HARD_MAX_STREAM_BYTES, maxOutputBytes * 8 + 64 * 1024),
        maxOutputBytes,
      })) {
        if (controller.signal.aborted) throw timeoutError ?? abortError(operationSignal);
        if (event.type === 'response.output_text.delta') text.push(event.delta as string);
        else if (event.type === 'response.failed') {
          const responseBody = asRecord(event.response);
          const error = asRecord(responseBody?.error);
          const suffix = diagnosticSuffix(
            diagnosticToken(error?.code), diagnosticToken(error?.param),
            diagnosticToken(error?.request_id) ?? diagnosticToken(responseBody?.id),
          );
          throw new AppApiError('UPSTREAM_ERROR', `The ${this.providerLabel} Responses request failed${suffix}.`, 502, false);
        } else if (event.type === 'response.incomplete') {
          throw new AppApiError('INVALID_RESPONSE', `The ${this.providerLabel} Responses request ended incomplete.`, 502, false);
        } else if (event.type === 'response.completed') {
          completedEvent = event;
        }
      }
      if (!completedEvent) {
        throw new AppApiError('INVALID_RESPONSE', 'The Responses stream ended without response.completed.', 502, false);
      }
      const completedResponse = asRecord(completedEvent.response);
      return { text: text.join(''), usage: readUsage(completedResponse?.usage) };
    };

    let cleanupTimeoutListener = () => {};
    const timeout = new Promise<never>((_resolve, reject) => {
      const check = () => {
        if (timeoutError) reject(timeoutError);
        else if (operationSignal?.aborted) reject(abortError(operationSignal));
      };
      const onAbort = () => check();
      controller.signal.addEventListener('abort', onAbort, { once: true });
      cleanupTimeoutListener = () => controller.signal.removeEventListener('abort', onAbort);
    });

    try {
      return await Promise.race([perform(), timeout]);
    } finally {
      clearTimeout(timer);
      operationSignal?.removeEventListener('abort', onExternalAbort);
      cleanupTimeoutListener();
      controller.abort();
      lease?.release();
    }
  }

  private async httpError(response: Response): Promise<AppApiError> {
    let error: Record<string, unknown> | undefined;
    try { error = asRecord(asRecord(await response.clone().json())?.error); } catch { /* Admission failures may return plain diagnostic text. */ }
    const code = diagnosticToken(error?.code);
    const parameter = diagnosticToken(error?.param);
    const requestId = diagnosticToken(response.headers.get('x-request-id')) ?? diagnosticToken(error?.request_id);
    const suffix = diagnosticSuffix(code, parameter, requestId);
    const status = response.status;
    if (status === 401 || status === 403) {
      return new AppApiError('AUTH_ERROR', `${this.providerLabel} access was not authorized for this request${suffix}.`, status, false);
    }
    if (status === 429) {
      return new AppApiError('RATE_LIMITED', `${this.providerLabel} usage is currently limited${suffix}.`, status, false);
    }
    if (status === 400) {
      return new AppApiError('VALIDATION_ERROR', `The ${this.providerLabel} Responses request was not accepted${suffix}.`, status, false);
    }
    return new AppApiError('UPSTREAM_ERROR', `The ChatGPT endpoint returned an unsuccessful response${suffix}.`, status, status >= 500);
  }
}
