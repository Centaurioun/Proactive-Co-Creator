import { GoogleGenAI } from '@google/genai';
import type { AiOperation } from '../aiBudget.ts';
import { getGeminiClient } from '../geminiClient.ts';
import { AppApiError } from '../errors.ts';
import type {
  AiCapability,
  AiCapabilityEvidence,
  AiModelDescriptor,
  AiProviderAdapter,
  AiProviderRequest,
  AiProviderTextResult,
  AiTokenCount,
} from './contracts.ts';
import { assertProviderOperation, CAPABILITY_POLICY_VERSION } from './policy.ts';

type GeminiConnectionId = 'gemini-managed' | 'gemini-personal';

interface GeminiModelRecord {
  name?: string;
  displayName?: string;
  supportedActions?: string[];
  thinking?: boolean;
  inputTokenLimit?: number;
  outputTokenLimit?: number;
}

interface GeminiSdkClient {
  models: {
    list: (params?: { config?: { abortSignal?: AbortSignal } }) => Promise<AsyncIterable<GeminiModelRecord>>;
    countTokens: (params: {
      model: string;
      contents: string;
      config?: { abortSignal?: AbortSignal; systemInstruction?: string; responseSchema?: unknown; responseMimeType?: string; thinkingConfig?: unknown };
    }) => Promise<{ totalTokens?: number }>;
    generateContent: (params: {
      model: string;
      contents: string;
      config?: Record<string, unknown>;
    }) => Promise<{
      text?: string;
      usageMetadata?: { promptTokenCount?: number; candidatesTokenCount?: number };
    }>;
    generateImages?: (params: {
      model: string;
      prompt: string;
      config?: { abortSignal?: AbortSignal; numberOfImages?: number };
    }) => Promise<unknown>;
  };
}

export interface GeminiAdapterFactoryInput {
  connectionId: GeminiConnectionId;
  /** Session-scoped credential. It is only passed to the SDK constructor and is never retained by the adapter. */
  personalApiKey?: string;
  /** Test seam for personal connections; production uses GoogleGenAI directly. */
  clientFactory?: (options: { apiKey: string }) => GeminiSdkClient;
  /** Test seam for managed connections; production resolves the host-managed GEMINI_API_KEY client. */
  managedClientFactory?: () => GeminiSdkClient;
}

export type { GeminiSdkClient };

const TEXT_OPERATIONS: AiOperation[] = [
  'analyze', 'clarify', 'polish', 'story', 'batch-edit', 'narrative-import',
  'diagnostics', 'sync', 'writing', 'opportunities', 'import-enhance',
];

const GEMINI_REASONING_LEVELS = ['minimal', 'low', 'medium', 'high', 'extra-high'] as const;

function modelIdFromName(name: string): string {
  return name.startsWith('models/') ? name.slice('models/'.length) : name;
}

function accountEvidence(modelSlug: string): AiCapabilityEvidence[] {
  return [{
    source: 'account-catalog',
    reference: 'Gemini API models.list response',
    checkedAt: new Date().toISOString().slice(0, 10),
    transport: 'gemini-api-models-list',
    modelSlug,
  }];
}

function unknownCapability<T>(reason: string): AiCapability<T> {
  return { state: 'unknown', reason };
}

function catalogCapability(value: boolean, evidence: AiCapabilityEvidence[]): AiCapability<boolean> {
  return value ? { state: 'supported', value: true, evidence } : { state: 'unsupported', evidence };
}

function catalogLimit(value: number | undefined, evidence: AiCapabilityEvidence[], label: string): AiCapability<number> {
  return typeof value === 'number' && Number.isSafeInteger(value) && value > 0
    ? { state: 'supported', value, evidence }
    : unknownCapability(`Gemini account catalog did not provide a verified ${label} for this exact model.`);
}

function toModelDescriptor(model: GeminiModelRecord): AiModelDescriptor | null {
  if (!model.name?.trim()) return null;
  const id = modelIdFromName(model.name.trim());
  const actions = new Set(model.supportedActions ?? []);
  const supportsText = actions.has('generateContent');
  const supportsImage = actions.has('generateImages');
  const evidence = accountEvidence(id);
  const availability = catalogCapability(true, evidence);
  const textGeneration = Array.isArray(model.supportedActions)
    ? catalogCapability(supportsText, evidence)
    : unknownCapability<boolean>('The Gemini account catalog did not report supportedActions for this exact model.');
  const imageGeneration = Array.isArray(model.supportedActions)
    ? catalogCapability(supportsImage, evidence)
    : unknownCapability<boolean>('The Gemini account catalog did not report supportedActions for this exact model.');
  const operationCapabilities: AiModelDescriptor['operationCapabilities'] = {};
  for (const operation of TEXT_OPERATIONS) {
    operationCapabilities[operation] = textGeneration;
  }
  // PCC image generation uses the dedicated image generation route rather than
  // per-operation text preferences.
  operationCapabilities.image = { state: 'unsupported', evidence };

  const structuredOutput: AiCapability<boolean> = textGeneration.state === 'supported'
    ? { state: 'supported', value: true, evidence }
    : textGeneration.state === 'unsupported'
      ? { state: 'unsupported', evidence }
      : unknownCapability('Structured-output compatibility is not verified for this exact Gemini model.');

  const reasoning: AiModelDescriptor['reasoning'] = model.thinking === true
    ? { state: 'supported', value: GEMINI_REASONING_LEVELS, evidence }
    : model.thinking === false
      ? { state: 'unsupported', evidence }
      : unknownCapability('The Gemini account catalog did not specify thinking support for this exact model.');

  return {
    id,
    displayName: model.displayName?.trim() || id,
    availability,
    textGeneration,
    imageGeneration,
    structuredOutput,
    contextLimit: catalogLimit(model.inputTokenLimit, evidence, 'input-token limit'),
    outputLimit: catalogLimit(model.outputTokenLimit, evidence, 'output-token limit'),
    reasoning,
    operationCapabilities,
    capabilityPolicyVersion: CAPABILITY_POLICY_VERSION,
  };
}

function errorStatus(error: unknown): number | undefined {
  if (!error || typeof error !== 'object') return undefined;
  const value = error as { status?: unknown; statusCode?: unknown; code?: unknown };
  for (const candidate of [value.status, value.statusCode, value.code]) {
    const parsed = typeof candidate === 'number' ? candidate : typeof candidate === 'string' ? Number(candidate) : NaN;
    if (Number.isInteger(parsed) && parsed >= 100 && parsed <= 599) return parsed;
  }
  return undefined;
}

function internalErrorText(error: unknown): string {
  if (error instanceof Error) return `${error.name} ${error.message}`.toLowerCase();
  if (typeof error === 'string') return error.toLowerCase();
  return '';
}

function normalizeGeminiError(error: unknown): AppApiError {
  if (error instanceof AppApiError) {
    const safeByCode: Record<AppApiError['code'], { message: string; status: number; retryable: boolean }> = {
      MISSING_API_KEY: { message: 'A Gemini credential is required for this connection.', status: 503, retryable: false },
      AUTH_ERROR: { message: 'Gemini authentication failed for the selected connection.', status: 403, retryable: false },
      RATE_LIMITED: { message: 'Gemini rate limit or quota was reached. Retry later.', status: 429, retryable: true },
      MODEL_UNSUPPORTED: { message: 'The selected Gemini model is unavailable for this request.', status: 502, retryable: false },
      SAFETY_BLOCKED: { message: 'Gemini blocked the request with a safety filter.', status: 422, retryable: false },
      INVALID_RESPONSE: { message: 'Gemini returned an unexpected response.', status: 502, retryable: false },
      VALIDATION_ERROR: { message: 'The Gemini request is invalid for the selected connection.', status: 400, retryable: false },
      TIMEOUT: { message: 'The Gemini request timed out.', status: 504, retryable: true },
      CANCELLED: { message: 'The request was cancelled.', status: 499, retryable: false },
      UPSTREAM_ERROR: { message: 'Gemini is temporarily unavailable.', status: 503, retryable: true },
      INTERNAL_ERROR: { message: 'An unexpected error occurred while communicating with Gemini.', status: 500, retryable: false },
    };
    const safe = safeByCode[error.code];
    return new AppApiError(error.code, safe.message, safe.status, safe.retryable);
  }
  const text = internalErrorText(error);
  const status = errorStatus(error);

  if (text.includes('abort') || text.includes('cancel')) {
    return new AppApiError('CANCELLED', 'The request was cancelled.', 499, false);
  }
  if (status === 401 || status === 403 || /unauthorized|api.?key|permission.?denied/.test(text)) {
    return new AppApiError('AUTH_ERROR', 'Gemini authentication failed for the selected connection.', 403, false);
  }
  if (status === 429 || /quota|rate.?limit|resource.?exhausted/.test(text)) {
    return new AppApiError('RATE_LIMITED', 'Gemini rate limit or quota was reached. Retry later.', 429, true);
  }
  if (status === 404 || /not.?found|unsupported.?model|model.*unavailable/.test(text)) {
    return new AppApiError('MODEL_UNSUPPORTED', 'The selected Gemini model is unavailable for this request.', 502, false);
  }
  if (/safety|blocked|prohibited.?content/.test(text)) {
    return new AppApiError('SAFETY_BLOCKED', 'Gemini blocked the request with a safety filter.', 422, false);
  }
  if (status === 408 || status === 504 || /timeout|timed out/.test(text)) {
    return new AppApiError('TIMEOUT', 'The Gemini request timed out.', 504, true);
  }
  if (status !== undefined && status >= 500) {
    return new AppApiError('UPSTREAM_ERROR', 'Gemini is temporarily unavailable.', 503, true);
  }
  return new AppApiError('INTERNAL_ERROR', 'An unexpected error occurred while communicating with Gemini.', 500, false);
}

function makeTimedSignal(signal: AbortSignal | undefined, timeoutMs: number): {
  signal: AbortSignal;
  cleanup: () => void;
  timedOut: () => boolean;
  timeout: Promise<never>;
  aborted: Promise<never>;
} {
  const controller = new AbortController();
  let didTimeout = false;
  let rejectTimeout!: (reason: unknown) => void;
  const onAbort = () => controller.abort(signal?.reason);
  if (signal?.aborted) onAbort();
  else signal?.addEventListener('abort', onAbort, { once: true });
  const timeout = new Promise<never>((_, reject) => { rejectTimeout = reject; });
  const timer = setTimeout(() => {
    didTimeout = true;
    controller.abort(new Error('timeout'));
    rejectTimeout(new AppApiError('TIMEOUT', 'The Gemini request timed out.', 504, true));
  }, Math.max(1, timeoutMs));
  const aborted = new Promise<never>((_, reject) => {
    const rejectOnAbort = () => reject(controller.signal.reason ?? new Error('aborted'));
    if (controller.signal.aborted) rejectOnAbort();
    else controller.signal.addEventListener('abort', rejectOnAbort, { once: true });
  });
  return {
    signal: controller.signal,
    timedOut: () => didTimeout,
    timeout,
    aborted,
    cleanup: () => {
      clearTimeout(timer);
      signal?.removeEventListener('abort', onAbort);
    },
  };
}

function supportsThinkingLevel(modelId: string): boolean {
  const normalized = modelIdFromName(modelId).toLowerCase();
  return !/^gemini-(1\.|2\.)/.test(normalized);
}

const GEMINI_25_THINKING_BUDGETS: Record<string, number> = {
  none: 0,
  minimal: 512,
  low: 1024,
  medium: 8192,
  high: 16384,
  'extra-high': 24576,
  max: 24576,
};

function reasoningConfig(
  modelId: string,
  level: AiProviderRequest['reasoningLevel'],
): { thinkingLevel: string } | { thinkingBudget: number } | undefined {
  if (!level || level === 'default') return undefined;
  if (!supportsThinkingLevel(modelId)) {
    const budget = GEMINI_25_THINKING_BUDGETS[level];
    return budget !== undefined ? { thinkingBudget: budget } : undefined;
  }
  return { thinkingLevel: level === 'extra-high' ? 'xhigh' : level };
}

function asOptionalCount(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : undefined;
}

function validateRequestBounds(request: AiProviderRequest): void {
  let schemaBytes = 0;
  if (request.responseSchema !== undefined) {
    try {
      schemaBytes = Buffer.byteLength(JSON.stringify(request.responseSchema) ?? '', 'utf8');
    } catch {
      throw new AppApiError('VALIDATION_ERROR', 'The Gemini response schema is not serializable.', 400, false);
    }
  }
  const inputBytes = Buffer.byteLength(request.input, 'utf8') +
    Buffer.byteLength(request.instructions ?? '', 'utf8') + schemaBytes;
  if (inputBytes > request.maxInputBytes) {
    throw new AppApiError('VALIDATION_ERROR', 'The Gemini input exceeds the configured byte limit.', 400, false);
  }
  if (!Number.isSafeInteger(request.maxOutputBytes) || request.maxOutputBytes < 1) {
    throw new AppApiError('VALIDATION_ERROR', 'The Gemini output byte limit must be a positive integer.', 400, false);
  }
  if (!Number.isFinite(request.timeoutMs) || request.timeoutMs <= 0) {
    throw new AppApiError('VALIDATION_ERROR', 'The Gemini request timeout must be positive.', 400, false);
  }
}

export function createGeminiAdapter(input: GeminiAdapterFactoryInput): AiProviderAdapter {
  const client = resolveClient(input);
  const connectionId = input.connectionId;

  return {
    connectionId,
    family: 'gemini',
    billing: connectionId === 'gemini-managed' ? 'host-managed-gemini' : 'gemini-api-key',

    async listModels(signal?: AbortSignal): Promise<AiModelDescriptor[]> {
      try {
        const pager = await client.models.list({ config: { abortSignal: signal } });
        const descriptors: AiModelDescriptor[] = [];
        for await (const model of pager) {
          if (signal?.aborted) throw new AppApiError('CANCELLED', 'The request was cancelled.', 499, false);
          const descriptor = toModelDescriptor(model);
          if (descriptor) descriptors.push(descriptor);
        }
        return descriptors;
      } catch (error) {
        throw normalizeGeminiError(error);
      }
    },

    async countTokens(modelId: string, inputText: string, signal?: AbortSignal, instructions?: string, _generation?: { responseSchema?: unknown; responseMimeType?: string; thinkingConfig?: unknown }): Promise<AiTokenCount> {
      try {
        // Gemini Developer API countTokens accepts contents/systemInstruction only;
        // response schema and other generation settings are not part of this count.
        const result = await client.models.countTokens({
          model: modelIdFromName(modelId),
          contents: inputText,
          config: { abortSignal: signal, ...(instructions ? { systemInstruction: instructions } : {}) },
        });
        const tokens = asOptionalCount(result.totalTokens);
        if (tokens === undefined) {
          throw new AppApiError('INVALID_RESPONSE', 'Gemini returned an invalid token count.', 502, false);
        }
        return { tokens, source: 'provider-count' };
      } catch (error) {
        throw normalizeGeminiError(error);
      }
    },

    async generateText(request: AiProviderRequest): Promise<AiProviderTextResult> {
      assertProviderOperation(connectionId, request.operation);
      if (request.operation === 'image') {
        throw new AppApiError('MODEL_UNSUPPORTED', 'Text generation cannot run the image operation.', 422, false);
      }
      validateRequestBounds(request);
      const timed = makeTimedSignal(request.signal, request.timeoutMs);
      const config: Record<string, unknown> = {
        abortSignal: timed.signal,
        maxOutputTokens: Math.max(1, Math.min(request.maxOutputTokens ?? Number.MAX_SAFE_INTEGER, Math.floor(request.maxOutputBytes / 4))),
      };
      if (request.instructions) config.systemInstruction = request.instructions;
      if (request.responseMimeType) config.responseMimeType = request.responseMimeType;
      if (request.responseSchema !== undefined) {
        config.responseMimeType ??= 'application/json';
        config.responseSchema = request.responseSchema;
      }
      const thinkingConfig = reasoningConfig(request.modelId, request.reasoningLevel);
      if (thinkingConfig) {
        config.thinkingConfig = thinkingConfig;
      } else if (request.thinkingConfig !== undefined) {
        const callerThinking = request.thinkingConfig as Record<string, unknown>;
        if (!supportsThinkingLevel(request.modelId) && 'thinkingLevel' in callerThinking && !('thinkingBudget' in callerThinking)) {
          // Omit Gemini 3+/4+-only thinkingLevel when targeting Gemini 1.x/2.x models.
        } else {
          config.thinkingConfig = request.thinkingConfig;
        }
      }

      try {
        const response = await Promise.race([
          client.models.generateContent({
            model: modelIdFromName(request.modelId),
            contents: request.input,
            config,
          }),
          timed.timeout,
          timed.aborted,
        ]);
        const text = response.text?.trim();
        if (!text) throw new AppApiError('INVALID_RESPONSE', 'Gemini returned an empty text response.', 502, false);
        if (Buffer.byteLength(text, 'utf8') > request.maxOutputBytes) {
          throw new AppApiError('INVALID_RESPONSE', 'Gemini output exceeded the configured byte limit.', 502, false);
        }
        const inputTokens = asOptionalCount(response.usageMetadata?.promptTokenCount);
        const outputTokens = asOptionalCount(response.usageMetadata?.candidatesTokenCount);
        const hasUsage = inputTokens !== undefined || outputTokens !== undefined;
        return {
          text,
          usage: {
            ...(inputTokens !== undefined ? { inputTokens } : {}),
            ...(outputTokens !== undefined ? { outputTokens } : {}),
            source: hasUsage ? 'provider-observed' : 'unknown',
          },
        };
      } catch (error) {
        if (timed.timedOut()) throw new AppApiError('TIMEOUT', 'The Gemini request timed out.', 504, true);
        throw normalizeGeminiError(error);
      } finally {
        timed.cleanup();
      }
    },

    async generateImage(request: AiProviderRequest): Promise<unknown> {
      assertProviderOperation(connectionId, request.operation);
      if (request.operation !== 'image') {
        throw new AppApiError('MODEL_UNSUPPORTED', 'Image generation is only available for image operations.', 422, false);
      }
      validateRequestBounds(request);
      if (typeof client.models.generateImages !== 'function') {
        throw new AppApiError('MODEL_UNSUPPORTED', 'This Gemini SDK does not support image generation.', 422, false);
      }
      const timed = makeTimedSignal(request.signal, request.timeoutMs);
      try {
        return await Promise.race([
          client.models.generateImages({
            model: modelIdFromName(request.modelId),
            prompt: request.instructions ? `${request.instructions}\n\n${request.input}` : request.input,
            config: { abortSignal: timed.signal, numberOfImages: 1 },
          }),
          timed.timeout,
          timed.aborted,
        ]);
      } catch (error) {
        if (timed.timedOut()) throw new AppApiError('TIMEOUT', 'The Gemini request timed out.', 504, true);
        throw normalizeGeminiError(error);
      } finally {
        timed.cleanup();
      }
    },
  };
}

function resolveClient(input: GeminiAdapterFactoryInput): GeminiSdkClient {
  if (input.connectionId === 'gemini-managed') {
    if (input.managedClientFactory) return input.managedClientFactory();
    return getGeminiClient() as unknown as GeminiSdkClient;
  }

  const apiKey = input.personalApiKey?.trim();
  if (!apiKey) {
    throw new AppApiError('MISSING_API_KEY', 'A personal Gemini API key is required for this connection.', 503, false);
  }
  if (input.clientFactory) return input.clientFactory({ apiKey });
  return new GoogleGenAI({ apiKey }) as unknown as GeminiSdkClient;
}
