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
import { fetchBoundedHttpBody, parseOAuthJson } from '../http.ts';
import type { ChatGptStoryTransportResult } from './subscriptionResourceBudget.ts';
import {
  assertModelOperation,
  assertReasoningSelection,
  describeChatGptModel,
  reasoningParameter,
} from './policy.ts';
import { asRecord, readSseEvents, type SseEvent } from './responsesSseParser.ts';

const API_ORIGIN = 'https://api.openai.com/v1';
const HARD_MAX_TIMEOUT_MS = 120_000;
const HARD_MAX_INPUT_BYTES = 2 * 1024 * 1024;
const HARD_MAX_OUTPUT_BYTES = 2 * 1024 * 1024;
const HARD_MAX_STREAM_BYTES = 4 * 1024 * 1024;
const LIST_MODELS_TIMEOUT_MS = 15_000;
const LIST_MODELS_MAX_BYTES = 1024 * 1024;
const utf8Encoder = new TextEncoder();

type TokenSource = string | (() => string | Promise<string>);
type FetchLike = typeof fetch;

interface StoryStreamLimits {
  maxStreamBytes: number;
  maxAcceptedOutputBytes: number;
  maxStreamEvents: number;
}

interface ValidatedTextRequest {
  model: AiModelDescriptor;
  instructions: string;
  maxOutputBytes: number;
  timeoutMs: number;
}

interface StreamExecutionContext {
  response: Response;
  maxOutputBytes: number;
  signal: AbortSignal;
  getTimeoutError: () => AppApiError | undefined;
  operationSignal?: AbortSignal;
  storyLimits?: StoryStreamLimits;
}

interface StreamFetchContext {
  token: string;
  body: string;
  signal: AbortSignal;
  getTimeoutError: () => AppApiError | undefined;
  operationSignal?: AbortSignal;
}

function constrainedJsonInstruction(responseSchema: unknown): string {
  return `Return exactly one JSON value that conforms to this response schema. Do not add markdown fences, commentary, or extra fields. Validate internally before answering. Schema: ${JSON.stringify(responseSchema)}`;
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

function isChatGptPlanQuotaError(code?: string): boolean {
  return code === 'subscription_sharing_usage_limit_exceeded' || code === 'subscription_sharing_usage_unavailable';
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

function extractRefusalFromCompletedResponse(completedResponse: Record<string, unknown> | undefined): boolean {
  const output = Array.isArray(completedResponse?.output) ? completedResponse.output : [];
  return output.some((item) => {
    const record = asRecord(item);
    if (record?.type === 'refusal') return true;
    return Array.isArray(record?.content) && record.content.some((part) => asRecord(part)?.type === 'refusal');
  });
}

function mapCatalogModelEntry(
  item: unknown,
  connectionId: 'chatgpt-plan' | 'openai-api',
): AiModelDescriptor[] {
  const model = asRecord(item);
  const id = connectionId === 'chatgpt-plan' ? model?.slug : model?.id;
  if (!model || typeof id !== 'string' || (connectionId === 'chatgpt-plan' && model.visibility !== 'list')) {
    return [];
  }
  const rawDisplay = typeof model.display_name === 'string' && model.display_name.trim() ? model.display_name : model.name;
  const displayName = typeof rawDisplay === 'string' && rawDisplay.trim() ? rawDisplay : id;
  return [describeChatGptModel({ id, displayName }, connectionId)];
}

function formatFailedSseEventError(
  event: SseEvent,
  connectionId: AiConnectionId,
  providerLabel: string,
): AppApiError {
  const responseBody = asRecord(event.response);
  const error = asRecord(responseBody?.error);
  const errorCode = diagnosticToken(error?.code);
  const suffix = diagnosticSuffix(
    errorCode,
    diagnosticToken(error?.param),
    diagnosticToken(error?.request_id) ?? diagnosticToken(responseBody?.id),
  );
  if (connectionId === 'chatgpt-plan' && isChatGptPlanQuotaError(errorCode)) {
    return new AppApiError(
      'RATE_LIMITED',
      `ChatGPT plan usage is currently unavailable or exhausted; an explicit recovery decision is required${suffix}.`,
      429,
      false,
    );
  }
  return new AppApiError('UPSTREAM_ERROR', `The ${providerLabel} Responses request failed${suffix}.`, 502, false);
}

function createAbortTimeoutRace(
  controller: AbortController,
  getTimeoutError: () => AppApiError | undefined,
  operationSignal?: AbortSignal,
): { promise: Promise<never>; cleanup: () => void } {
  let cleanup = () => {};
  const promise = new Promise<never>((_resolve, reject) => {
    const onAbort = () => {
      const timeoutError = getTimeoutError();
      if (timeoutError) reject(timeoutError);
      else if (operationSignal?.aborted) reject(abortError(operationSignal));
    };
    controller.signal.addEventListener('abort', onAbort, { once: true });
    cleanup = () => controller.signal.removeEventListener('abort', onAbort);
  });
  return { promise, cleanup };
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
    if (!token.trim()) {
      throw new AppApiError(
        'AUTH_ERROR',
        this.connectionId === 'chatgpt-plan'
          ? 'Connect a ChatGPT account before using its plan.'
          : 'Add an OpenAI API key for this server session before using OpenAI API billing.',
        401,
        false,
      );
    }
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
    const response = await this.fetchCatalogResponse(token, signal);
    if (!response.ok) throw await this.boundedHttpError(response);
    let payload: unknown;
    try {
      payload = parseOAuthJson(response.body, 'malformed');
    } catch {
      throw new AppApiError('INVALID_RESPONSE', `The ${this.providerLabel} model catalog was malformed.`, 502, false);
    }
    const models = this.connectionId === 'chatgpt-plan' ? asRecord(payload)?.models : asRecord(payload)?.data;
    if (!Array.isArray(models)) {
      throw new AppApiError('INVALID_RESPONSE', 'The account model catalog did not contain a valid model array.', 502, false);
    }
    const targetConnection = this.connectionId as 'chatgpt-plan' | 'openai-api';
    return models.flatMap((item) => mapCatalogModelEntry(item, targetConnection));
  }

  private async fetchCatalogResponse(token: string, signal?: AbortSignal) {
    try {
      return await fetchBoundedHttpBody(this.fetchImpl, `${API_ORIGIN}/models`, {
        method: 'GET',
        headers: { authorization: `Bearer ${token}`, accept: 'application/json' },
      }, { timeoutMs: LIST_MODELS_TIMEOUT_MS, maxBodyBytes: LIST_MODELS_MAX_BYTES, signal });
    } catch (error) {
      if (signal?.aborted) throw abortError(signal);
      const message = error instanceof Error ? error.message : '';
      if (message.includes('timed out')) {
        throw new AppApiError('TIMEOUT', `The ${this.providerLabel} model catalog request exceeded its time limit.`, 504, true);
      }
      if (message.includes('size limit')) {
        throw new AppApiError('INVALID_RESPONSE', `The ${this.providerLabel} model catalog exceeded the response size limit.`, 502, false);
      }
      const catalogLabel = this.connectionId === 'chatgpt-plan' ? 'ChatGPT account' : 'OpenAI API';
      throw new AppApiError('UPSTREAM_ERROR', `Could not retrieve the ${catalogLabel} model catalog.`, 503, true);
    }
  }

  async countTokens(
    modelId: string,
    input: string,
    signal?: AbortSignal,
    instructions?: string,
    generation?: { responseSchema?: unknown },
  ): Promise<AiTokenCount> {
    if (signal?.aborted) throw abortError(signal);
    if (this.connectionId === 'chatgpt-plan') {
      const schemaSuffix = generation?.responseSchema === undefined ? '' : JSON.stringify(generation.responseSchema);
      const totalBytes = utf8Encoder.encode(`${input}${instructions ?? ''}${schemaSuffix}`).byteLength;
      return { tokens: Math.ceil(totalBytes / 4), source: 'estimate' };
    }
    return this.countOpenAiApiTokens({ modelId, input, signal, instructions, responseSchema: generation?.responseSchema });
  }

  private async countOpenAiApiTokens(params: {
    modelId: string;
    input: string;
    signal?: AbortSignal;
    instructions?: string;
    responseSchema?: unknown;
  }): Promise<AiTokenCount> {
    const token = await this.accessToken();
    const schemaInstruction = params.responseSchema === undefined ? '' : constrainedJsonInstruction(params.responseSchema);
    const completeInstructions = [params.instructions, schemaInstruction].filter(Boolean).join('\n\n');
    let response;
    try {
      response = await fetchBoundedHttpBody(this.fetchImpl, `${API_ORIGIN}/responses/input_tokens`, {
        method: 'POST',
        headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json', accept: 'application/json' },
        body: JSON.stringify({
          model: params.modelId,
          input: [{ role: 'user', content: params.input }],
          ...(completeInstructions ? { instructions: completeInstructions } : {}),
        }),
      }, { timeoutMs: 10_000, maxBodyBytes: 16 * 1024, signal: params.signal });
    } catch {
      if (params.signal?.aborted) throw abortError(params.signal);
      throw new AppApiError('UPSTREAM_ERROR', 'OpenAI API input-token preflight failed; generation was not started.', 503, true);
    }
    if (!response.ok) {
      throw new AppApiError(
        response.status === 401 || response.status === 403 ? 'AUTH_ERROR' : 'UPSTREAM_ERROR',
        'OpenAI API input-token preflight was not accepted; generation was not started.',
        response.status,
        response.status >= 500,
      );
    }
    const payload = asRecord(parseOAuthJson(response.body, 'OpenAI API input-token response was invalid.'));
    const count = payload?.input_tokens;
    if (payload?.object !== 'response.input_tokens' || typeof count !== 'number' || !Number.isSafeInteger(count) || count < 0) {
      throw new AppApiError('INVALID_RESPONSE', 'OpenAI API did not return a verified input-token count.', 502, false);
    }
    return { tokens: count, source: 'provider-count' };
  }

  async generateText(request: AiProviderRequest): Promise<AiProviderTextResult> {
    return this.generateTextInternal(request);
  }

  /** Story-only bounded Responses call. The pinned body must match the exact
   * request fields, and limits are enforced while reading the SSE stream. */
  async generateStoryText(
    request: AiProviderRequest & { requestId?: string },
    approvedBody: string,
    limits: StoryStreamLimits,
  ): Promise<ChatGptStoryTransportResult> {
    const wrongConnectionOrOp = this.connectionId !== 'chatgpt-plan' || request.operation !== 'story';
    const hasRestrictedFields = (request.reasoningLevel !== undefined && request.reasoningLevel !== 'default') ||
      request.responseSchema !== undefined || request.maxOutputTokens !== undefined;
    if (wrongConnectionOrOp || hasRestrictedFields) {
      throw new AppApiError('MODEL_UNSUPPORTED', 'The bounded ChatGPT story transport accepts only the default-reasoning text story request.', 422, false);
    }
    const expectedBody = JSON.stringify({
      model: request.modelId,
      input: [{ role: 'user', content: request.input }],
      ...(request.instructions ? { instructions: request.instructions } : {}),
      store: false,
      stream: true,
    });
    if (expectedBody !== approvedBody || utf8Encoder.encode(approvedBody).byteLength > 32 * 1024) {
      throw new AppApiError('VALIDATION_ERROR', 'The ChatGPT story request does not match its approved serialized plan.', 409, false);
    }
    return this.generateTextInternal(request, limits, approvedBody);
  }

  private validateTextRequest(request: AiProviderRequest): ValidatedTextRequest {
    const maxInputBytes = positiveBound(request.maxInputBytes, 'input byte', HARD_MAX_INPUT_BYTES);
    const maxOutputBytes = positiveBound(request.maxOutputBytes, 'output byte', HARD_MAX_OUTPUT_BYTES);
    const timeoutMs = positiveBound(request.timeoutMs, 'timeout', HARD_MAX_TIMEOUT_MS);
    if (!request.modelId.trim()) throw new AppApiError('VALIDATION_ERROR', 'A model is required.', 400, false);
    const schemaInstruction = request.responseSchema === undefined ? '' : constrainedJsonInstruction(request.responseSchema);
    const instructions = [request.instructions, schemaInstruction].filter(Boolean).join('\n\n');
    const inputBytes = utf8Encoder.encode(request.input).byteLength + utf8Encoder.encode(instructions).byteLength;
    if (inputBytes > maxInputBytes) {
      throw new AppApiError('VALIDATION_ERROR', 'The request input exceeded the configured input byte limit.', 413, false);
    }
    const model = describeChatGptModel({ id: request.modelId, displayName: request.modelId }, this.connectionId as 'chatgpt-plan' | 'openai-api');
    if (this.connectionId === 'openai-api') assertModelOperation(model, request.operation);
    else if (model.textGeneration.state !== 'supported' || model.textGeneration.value !== true) {
      throw new AppApiError('MODEL_UNSUPPORTED', 'The selected account model has no verified capability for text generation.', 422, false);
    }
    assertReasoningSelection(model, request.reasoningLevel);
    const invalidOutputCap = !Number.isSafeInteger(request.maxOutputTokens) || (request.maxOutputTokens ?? 0) <= 0;
    if (this.connectionId === 'openai-api' && invalidOutputCap) {
      throw new AppApiError('VALIDATION_ERROR', 'OpenAI API generation requires an explicit provider-enforced output-token limit.', 503, false);
    }
    return { model, instructions, maxOutputBytes, timeoutMs };
  }

  private buildRequestBody(request: AiProviderRequest, validated: ValidatedTextRequest, approvedBody?: string): string {
    if (approvedBody !== undefined) return approvedBody;
    const reasoning = reasoningParameter(validated.model, request.reasoningLevel);
    return JSON.stringify({
      model: request.modelId,
      input: [{ role: 'user', content: request.input }],
      ...(validated.instructions ? { instructions: validated.instructions } : {}),
      ...reasoning,
      ...(this.connectionId === 'openai-api' ? { max_output_tokens: request.maxOutputTokens } : {}),
      store: false,
      stream: true,
    });
  }

  private async fetchResponsesStream(ctx: StreamFetchContext): Promise<Response> {
    try {
      return await this.fetchImpl(`${API_ORIGIN}/responses`, {
        method: 'POST',
        headers: {
          authorization: `Bearer ${ctx.token}`,
          'content-type': 'application/json',
          accept: 'text/event-stream',
        },
        body: ctx.body,
        redirect: 'error',
        signal: ctx.signal,
      });
    } catch {
      const timeoutError = ctx.getTimeoutError();
      if (timeoutError) throw timeoutError;
      if (ctx.operationSignal?.aborted) throw abortError(ctx.operationSignal);
      if (ctx.signal.aborted) throw abortError(ctx.signal);
      throw new AppApiError('UPSTREAM_ERROR', `The ${this.providerLabel} Responses request failed before streaming.`, 503, true);
    }
  }

  private processStreamEvent(
    event: SseEvent,
    acc: { text: string[]; completedEvent?: SseEvent; refusal: boolean },
  ): void {
    if (event.type === 'response.output_text.delta') acc.text.push(event.delta as string);
    else if (event.type === 'response.refusal.delta') acc.refusal = true;
    else if (event.type === 'response.failed') throw formatFailedSseEventError(event, this.connectionId, this.providerLabel);
    else if (event.type === 'response.incomplete') {
      throw new AppApiError('INVALID_RESPONSE', `The ${this.providerLabel} Responses request ended incomplete.`, 502, false);
    } else if (event.type === 'response.completed') acc.completedEvent = event;
  }

  private async consumeResponsesStream(ctx: StreamExecutionContext): Promise<AiProviderTextResult | ChatGptStoryTransportResult> {
    const acc: { text: string[]; completedEvent?: SseEvent; refusal: boolean } = { text: [], refusal: false };
    const streamStats = { streamBytes: 0, eventCount: 0 };
    const sseLimits = {
      maxStreamBytes: ctx.storyLimits?.maxStreamBytes ?? Math.min(HARD_MAX_STREAM_BYTES, ctx.maxOutputBytes * 8 + 64 * 1024),
      maxOutputBytes: ctx.storyLimits?.maxAcceptedOutputBytes ?? ctx.maxOutputBytes,
      ...(ctx.storyLimits ? { maxEvents: ctx.storyLimits.maxStreamEvents } : {}),
    };
    for await (const event of readSseEvents(ctx.response, sseLimits, ctx.storyLimits ? streamStats : undefined)) {
      if (ctx.signal.aborted) {
        if (!ctx.storyLimits) {
          throw ctx.getTimeoutError() ?? abortError(ctx.operationSignal);
        }
        if (event.type === 'response.failed') {
          const failedError = formatFailedSseEventError(event, this.connectionId, this.providerLabel);
          if (failedError.code === 'RATE_LIMITED') throw failedError;
          throw ctx.getTimeoutError() ?? abortError(ctx.operationSignal);
        }
        if (event.type === 'response.completed' || event.type === 'response.incomplete') {
          throw ctx.getTimeoutError() ?? abortError(ctx.operationSignal);
        }
        continue;
      }
      this.processStreamEvent(event, acc);
    }
    if (ctx.signal.aborted) {
      throw ctx.getTimeoutError() ?? abortError(ctx.operationSignal);
    }
    if (!acc.completedEvent) {
      throw new AppApiError('INVALID_RESPONSE', 'The Responses stream ended without response.completed.', 502, false);
    }
    const completedResponse = asRecord(acc.completedEvent.response);
    const refusal = acc.refusal || extractRefusalFromCompletedResponse(completedResponse);
    const textValue = acc.text.join('');
    const usage = readUsage(completedResponse?.usage);
    if (ctx.storyLimits) {
      return {
        text: textValue,
        terminalEvent: 'response.completed',
        refusal,
        streamBytes: streamStats.streamBytes,
        eventCount: streamStats.eventCount,
        usage,
      };
    }
    return { text: textValue, usage };
  }

  private generateTextInternal(request: AiProviderRequest): Promise<AiProviderTextResult>;
  private generateTextInternal(
    request: AiProviderRequest,
    storyLimits: StoryStreamLimits,
    approvedBody: string,
  ): Promise<ChatGptStoryTransportResult>;
  private async generateTextInternal(
    request: AiProviderRequest,
    storyLimits?: StoryStreamLimits,
    approvedBody?: string,
  ): Promise<AiProviderTextResult | ChatGptStoryTransportResult> {
    const validated = this.validateTextRequest(request);
    const lease = this.requestLease?.(request.signal);
    const operationSignal = lease?.signal ?? request.signal;
    if (operationSignal?.aborted) {
      lease?.release();
      throw abortError(operationSignal);
    }

    const controller = new AbortController();
    let timeoutError: AppApiError | undefined;
    const onExternalAbort = () => controller.abort(operationSignal?.reason);
    operationSignal?.addEventListener('abort', onExternalAbort, { once: true });
    const timer = setTimeout(() => {
      timeoutError = new AppApiError('TIMEOUT', `The ${this.providerLabel} Responses request exceeded its time limit.`, 504, true);
      controller.abort(timeoutError);
    }, validated.timeoutMs);

    const body = this.buildRequestBody(request, validated, approvedBody);
    const performPromise = (async () => {
      const token = await this.accessToken();
      if (controller.signal.aborted) throw timeoutError ?? abortError(operationSignal);
      const response = await this.fetchResponsesStream({
        token,
        body,
        signal: controller.signal,
        getTimeoutError: () => timeoutError,
        operationSignal,
      });
      if (!response.ok) throw await this.httpError(response);
      return this.consumeResponsesStream({
        response,
        maxOutputBytes: validated.maxOutputBytes,
        signal: controller.signal,
        getTimeoutError: () => timeoutError,
        operationSignal,
        storyLimits,
      });
    })();

    const timeoutRace = createAbortTimeoutRace(controller, () => timeoutError, operationSignal);
    let primaryResult: AiProviderTextResult | ChatGptStoryTransportResult | undefined;
    let primaryError: unknown;
    let hasPrimaryError = false;
    try {
      primaryResult = await Promise.race([performPromise, timeoutRace.promise]);
    } catch (err) {
      hasPrimaryError = true;
      primaryError = err;
    } finally {
      clearTimeout(timer);
      operationSignal?.removeEventListener('abort', onExternalAbort);
      timeoutRace.cleanup();
      controller.abort();
    }
    if (storyLimits && controller.signal.aborted) {
      const lateError = await performPromise.then(() => undefined, (err: unknown) => err);
      lease?.release();
      if (lateError instanceof AppApiError && lateError.code === 'RATE_LIMITED') throw lateError;
    } else {
      lease?.release();
    }
    if (hasPrimaryError) throw primaryError;
    return primaryResult as AiProviderTextResult | ChatGptStoryTransportResult;
  }

  private async httpError(response: Response): Promise<AppApiError> {
    let error: Record<string, unknown> | undefined;
    try {
      error = asRecord(asRecord(await response.clone().json())?.error);
    } catch { /* Admission failures may return plain diagnostic text. */ }
    return this.buildHttpError(response.status, response.headers, error);
  }

  private async boundedHttpError(response: { status: number; headers: Headers; body: string }): Promise<AppApiError> {
    let error: Record<string, unknown> | undefined;
    try {
      error = asRecord(asRecord(JSON.parse(response.body))?.error);
    } catch { /* Admission failures may return plain diagnostic text. */ }
    return this.buildHttpError(response.status, response.headers, error);
  }

  private buildHttpError(status: number, headers: Headers, error?: Record<string, unknown>): AppApiError {
    const code = diagnosticToken(error?.code);
    const parameter = diagnosticToken(error?.param);
    const requestId = diagnosticToken(headers.get('x-request-id')) ?? diagnosticToken(error?.request_id);
    const suffix = diagnosticSuffix(code, parameter, requestId);
    if (status === 401 || status === 403) {
      return new AppApiError('AUTH_ERROR', `${this.providerLabel} access was not authorized for this request${suffix}.`, status, false);
    }
    if (status === 429) {
      return new AppApiError('RATE_LIMITED', `${this.providerLabel} usage is currently limited${suffix}.`, status, false);
    }
    if (status === 400) {
      return new AppApiError('VALIDATION_ERROR', `The ${this.providerLabel} Responses request was not accepted${suffix}.`, status, false);
    }
    const endpointLabel = this.connectionId === 'openai-api' ? 'OpenAI API endpoint' : 'ChatGPT endpoint';
    return new AppApiError('UPSTREAM_ERROR', `The ${endpointLabel} returned an unsuccessful response${suffix}.`, status, status >= 500);
  }
}
