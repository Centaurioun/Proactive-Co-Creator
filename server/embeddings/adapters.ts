import { GoogleGenAI } from '@google/genai';
import {
  buildEmbeddingNamespaceKey,
  CLOUDFLARE_EMBEDDING_MODELS,
  DEFAULT_CLOUDFLARE_EMBEDDING_MODEL,
  DEFAULT_GEMINI_EMBEDDING_MODEL,
  DEFAULT_LM_STUDIO_EMBEDDING_MODEL,
  DEFAULT_LM_STUDIO_ENDPOINT,
  EmbeddingNamespaceDescriptor,
  EmbeddingProviderId,
  EmbeddingTaskType,
} from '../../shared/embeddingSchema';
import { NARRATIVE_CHUNKER_VERSION } from '../../shared/narrativeMemoryTypes';

export interface ValidatedVectorsResult {
  vectors: number[][];
  dimensions: number;
  normalized: boolean;
}

/**
 * Validates raw embedding vectors returned by any provider:
 * - exact expected count
 * - consistent dimensions (>= 8)
 * - finite numbers only (no NaN/Infinity)
 * - non-zero L2 norm
 * - L2 normalizes vectors deterministically so cosine similarity is an exact dot product
 */
export function validateAndNormalizeEmbeddingVectors(
  rawVectors: unknown,
  expectedCount: number
): ValidatedVectorsResult {
  if (!Array.isArray(rawVectors)) {
    throw new Error('Provider returned a non-array embeddings payload.');
  }
  if (rawVectors.length !== expectedCount) {
    throw new Error(
      `Provider returned ${rawVectors.length} embedding vector(s), but ${expectedCount} were requested.`
    );
  }
  if (expectedCount === 0) {
    return { vectors: [], dimensions: 0, normalized: true };
  }

  let dimensions = -1;
  const normalizedVectors: number[][] = [];

  for (let idx = 0; idx < rawVectors.length; idx += 1) {
    const vec = rawVectors[idx];
    if (!Array.isArray(vec) || vec.length < 8) {
      throw new Error(`Embedding vector at index ${idx} is invalid or has fewer than 8 dimensions.`);
    }
    if (dimensions === -1) {
      dimensions = vec.length;
    } else if (vec.length !== dimensions) {
      throw new Error(
        `Inconsistent embedding dimensions in batch: expected ${dimensions}, received ${vec.length} at index ${idx}.`
      );
    }

    let sumSq = 0;
    const numericRow: number[] = new Array(dimensions);
    for (let d = 0; d < dimensions; d += 1) {
      const val = Number(vec[d]);
      if (!Number.isFinite(val)) {
        throw new Error(`Embedding vector at index ${idx}, dimension ${d} is not a finite number.`);
      }
      numericRow[d] = val;
      sumSq += val * val;
    }

    const norm = Math.sqrt(sumSq);
    if (!Number.isFinite(norm) || norm < 1e-12) {
      throw new Error(`Embedding vector at index ${idx} has a zero or near-zero L2 norm.`);
    }

    for (let d = 0; d < dimensions; d += 1) {
      numericRow[d] = numericRow[d] / norm;
    }
    normalizedVectors.push(numericRow);
  }

  return {
    vectors: normalizedVectors,
    dimensions,
    normalized: true,
  };
}

const ALLOWED_LOOPBACK_HOSTS = new Set(['127.0.0.1', 'localhost', '[::1]', '::1']);

/**
 * Strict SSRF guard for local LM Studio endpoints (`NEW-EMB`, `securecoder-persona`).
 * Allows ONLY http://127.0.0.1:<port>, http://localhost:<port>, or http://[::1]:<port>
 * with no credentials, no query parameters, no fragments, and no arbitrary subpaths.
 */
export function validateLmStudioLoopbackBaseUrl(rawUrl: string): string {
  const trimmed = (rawUrl || '').trim();
  if (!trimmed) {
    throw new Error('LM Studio endpoint URL cannot be empty.');
  }
  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    throw new Error('LM Studio endpoint URL is not a valid URL.');
  }

  if (parsed.protocol !== 'http:') {
    throw new Error('LM Studio local loopback endpoint must use http: scheme.');
  }
  if (parsed.username || parsed.password) {
    throw new Error('LM Studio endpoint URL must not include embedded credentials.');
  }
  if (!ALLOWED_LOOPBACK_HOSTS.has(parsed.hostname.toLowerCase())) {
    throw new Error(
      `LM Studio endpoint hostname "${parsed.hostname}" is rejected. Only local loopback addresses (127.0.0.1, localhost, [::1]) are permitted.`
    );
  }
  const portNum = parsed.port ? Number(parsed.port) : 80;
  if (!Number.isInteger(portNum) || portNum < 1 || portNum > 65535) {
    throw new Error('LM Studio endpoint port must be between 1 and 65535.');
  }
  if (parsed.search || parsed.hash) {
    throw new Error('LM Studio endpoint URL must not contain query parameters or fragments.');
  }
  const cleanPath = parsed.pathname.replace(/\/+$/, '');
  if (cleanPath !== '' && cleanPath !== '/v1') {
    throw new Error('LM Studio base endpoint path must be root ("/") or "/v1".');
  }
  const hostWithPort = parsed.port ? `${parsed.hostname}:${parsed.port}` : parsed.hostname;
  return `http://${hostWithPort}`;
}

export interface EmbeddingAdapterEmbedParams {
  texts: string[];
  modelId?: string;
  taskType: EmbeddingTaskType;
  taskInstruction?: string;
  signal?: AbortSignal;
}

export interface EmbeddingAdapterEmbedOutput {
  vectors: number[][];
  namespace: EmbeddingNamespaceDescriptor;
  discoveredModels?: string[];
}

export interface EmbeddingProviderAdapter {
  readonly providerId: EmbeddingProviderId;
  discoverModels(signal?: AbortSignal): Promise<string[]>;
  embedTexts(params: EmbeddingAdapterEmbedParams): Promise<EmbeddingAdapterEmbedOutput>;
}

export type FetchLike = (input: string | URL, init?: RequestInit) => Promise<Response>;

/**
 * 1. LM Studio Local Loopback Adapter (`/v1/models` and `/v1/embeddings`)
 */
export class LmStudioEmbeddingAdapter implements EmbeddingProviderAdapter {
  readonly providerId: EmbeddingProviderId = 'lm-studio-local';
  private baseUrl: string;
  private selectedModelId: string;
  private readonly fetchImpl: FetchLike;

  constructor(options?: {
    endpointUrl?: string;
    selectedModelId?: string;
    fetchImpl?: FetchLike;
  }) {
    this.baseUrl = validateLmStudioLoopbackBaseUrl(options?.endpointUrl ?? DEFAULT_LM_STUDIO_ENDPOINT);
    this.selectedModelId = (options?.selectedModelId ?? DEFAULT_LM_STUDIO_EMBEDDING_MODEL).trim();
    this.fetchImpl = options?.fetchImpl ?? fetch;
  }

  public setConfiguration(endpointUrl: string, selectedModelId?: string): void {
    this.baseUrl = validateLmStudioLoopbackBaseUrl(endpointUrl);
    if (selectedModelId && selectedModelId.trim()) {
      this.selectedModelId = selectedModelId.trim();
    }
  }

  public getBaseUrl(): string {
    return this.baseUrl;
  }

  public getSelectedModelId(): string {
    return this.selectedModelId;
  }

  async discoverModels(signal?: AbortSignal): Promise<string[]> {
    const modelsUrl = `${this.baseUrl}/v1/models`;
    const response = await this.fetchImpl(modelsUrl, {
      method: 'GET',
      headers: { Accept: 'application/json' },
      redirect: 'error',
      signal,
    });
    if (!response.ok) {
      throw new Error(`LM Studio /v1/models returned HTTP ${response.status}`);
    }
    const payload = (await response.json()) as { data?: Array<{ id?: string }> };
    const models = (payload.data ?? [])
      .map((item) => (typeof item?.id === 'string' ? item.id.trim() : ''))
      .filter(Boolean);
    return models;
  }

  async embedTexts(params: EmbeddingAdapterEmbedParams): Promise<EmbeddingAdapterEmbedOutput> {
    const modelId = (params.modelId || this.selectedModelId || DEFAULT_LM_STUDIO_EMBEDDING_MODEL).trim();
    const embeddingsUrl = `${this.baseUrl}/v1/embeddings`;
    const response = await this.fetchImpl(embeddingsUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      redirect: 'error',
      signal: params.signal,
      body: JSON.stringify({
        model: modelId,
        input: params.texts,
      }),
    });

    if (!response.ok) {
      const errText = await response.text().catch(() => '');
      throw new Error(
        `LM Studio /v1/embeddings failed with HTTP ${response.status}: ${errText.slice(0, 200) || response.statusText}`
      );
    }

    const payload = (await response.json()) as {
      model?: string;
      data?: Array<{ index?: number; embedding?: number[] }>;
    };

    const items = Array.isArray(payload.data) ? [...payload.data] : [];
    items.sort((a, b) => (a.index ?? 0) - (b.index ?? 0));
    const rawVectors = items.map((item) => item.embedding);

    const validated = validateAndNormalizeEmbeddingVectors(rawVectors, params.texts.length);
    const resolvedModel = (payload.model || modelId).trim();
    const taskInstruction = params.taskInstruction || 'default';
    const namespaceKey = buildEmbeddingNamespaceKey({
      providerId: this.providerId,
      modelId: resolvedModel,
      modelRevision: 'local-v1',
      dimensions: validated.dimensions,
      normalized: true,
      taskInstruction,
      chunkerVersion: NARRATIVE_CHUNKER_VERSION,
    });

    return {
      vectors: validated.vectors,
      namespace: {
        providerId: this.providerId,
        modelId: resolvedModel,
        modelRevision: 'local-v1',
        dimensions: validated.dimensions,
        normalized: true,
        taskInstruction,
        chunkerVersion: NARRATIVE_CHUNKER_VERSION,
        namespaceKey,
      },
    };
  }
}

/**
 * 2. Cloudflare Workers AI Embedding Adapter
 * Uses official REST endpoint:
 * https://api.cloudflare.com/client/v4/accounts/{account_id}/ai/run/{model_id}
 */
export class CloudflareEmbeddingAdapter implements EmbeddingProviderAdapter {
  readonly providerId: EmbeddingProviderId = 'cloudflare-workers-ai';
  private accountId: string | null = null;
  private apiToken: string | null = null;
  private selectedModelId: string = DEFAULT_CLOUDFLARE_EMBEDDING_MODEL;
  private readonly fetchImpl: FetchLike;

  constructor(options?: {
    accountId?: string;
    apiToken?: string;
    selectedModelId?: string;
    fetchImpl?: FetchLike;
  }) {
    if (options?.accountId && options?.apiToken) {
      this.setCredentials(options.accountId, options.apiToken, options.selectedModelId);
    }
    this.fetchImpl = options?.fetchImpl ?? fetch;
  }

  public setCredentials(accountId: string, apiToken: string, selectedModelId?: string): void {
    const cleanAccount = accountId.trim();
    if (!/^[a-fA-F0-9]{16,64}$/.test(cleanAccount)) {
      throw new Error('Invalid Cloudflare Account ID format.');
    }
    const cleanToken = apiToken.trim();
    if (cleanToken.length < 16) {
      throw new Error('Invalid Cloudflare API token length.');
    }
    this.accountId = cleanAccount;
    this.apiToken = cleanToken;
    if (selectedModelId && selectedModelId.trim()) {
      this.selectedModelId = selectedModelId.trim();
    }
  }

  public clearCredentials(): void {
    this.accountId = null;
    this.apiToken = null;
  }

  public isConfigured(): boolean {
    return Boolean(this.accountId && this.apiToken);
  }

  public getMaskedAccountId(): string | undefined {
    if (!this.accountId) return undefined;
    if (this.accountId.length <= 8) return '****';
    return `${this.accountId.slice(0, 4)}…${this.accountId.slice(-4)}`;
  }

  public getSelectedModelId(): string {
    return this.selectedModelId;
  }

  public setSelectedModelId(modelId: string): void {
    if (modelId && modelId.trim()) {
      this.selectedModelId = modelId.trim();
    }
  }

  async discoverModels(): Promise<string[]> {
    return [...CLOUDFLARE_EMBEDDING_MODELS];
  }

  async embedTexts(params: EmbeddingAdapterEmbedParams): Promise<EmbeddingAdapterEmbedOutput> {
    if (!this.accountId || !this.apiToken) {
      throw new Error('Cloudflare Workers AI credentials (Account ID and API Token) are not configured.');
    }
    const modelId = (params.modelId || this.selectedModelId || DEFAULT_CLOUDFLARE_EMBEDDING_MODEL).trim();
    if (!modelId.startsWith('@cf/')) {
      throw new Error(`Unsupported Cloudflare Workers AI model identifier: ${modelId}`);
    }

    const url = `https://api.cloudflare.com/client/v4/accounts/${encodeURIComponent(this.accountId)}/ai/run/${modelId}`;
    const response = await this.fetchImpl(url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${this.apiToken}`,
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      redirect: 'error',
      signal: params.signal,
      body: JSON.stringify({
        text: params.texts,
      }),
    });

    if (response.status === 401 || response.status === 403) {
      throw new Error(`Cloudflare Workers AI authentication failed (HTTP ${response.status}). Verify Account ID and Workers AI API Token permissions.`);
    }
    if (!response.ok) {
      const errText = await response.text().catch(() => '');
      throw new Error(`Cloudflare Workers AI request failed with HTTP ${response.status}: ${errText.slice(0, 200)}`);
    }

    const payload = (await response.json()) as {
      success?: boolean;
      result?: {
        shape?: number[];
        data?: number[][];
      };
      data?: Array<{ embedding?: number[] }>;
      errors?: Array<{ message?: string }>;
    };

    if (payload.success === false) {
      const errMsg = payload.errors?.[0]?.message || 'Cloudflare Workers AI returned success=false.';
      throw new Error(errMsg);
    }

    const rawVectors =
      payload.result?.data ??
      (Array.isArray(payload.data) ? payload.data.map((d) => d.embedding) : undefined);

    const validated = validateAndNormalizeEmbeddingVectors(rawVectors, params.texts.length);
    const taskInstruction = params.taskInstruction || 'default';
    const namespaceKey = buildEmbeddingNamespaceKey({
      providerId: this.providerId,
      modelId,
      modelRevision: 'cf-workers-ai-v1',
      dimensions: validated.dimensions,
      normalized: true,
      taskInstruction,
      chunkerVersion: NARRATIVE_CHUNKER_VERSION,
    });

    return {
      vectors: validated.vectors,
      namespace: {
        providerId: this.providerId,
        modelId,
        modelRevision: 'cf-workers-ai-v1',
        dimensions: validated.dimensions,
        normalized: true,
        taskInstruction,
        chunkerVersion: NARRATIVE_CHUNKER_VERSION,
        namespaceKey,
      },
    };
  }
}

export type GeminiEmbedFn = (params: {
  apiKey: string;
  modelId: string;
  texts: string[];
  taskType: EmbeddingTaskType;
}) => Promise<number[][]>;

/**
 * 3. Gemini Embedding 2 Adapter (`gemini-embedding-2` via `@google/genai`)
 */
export class GeminiEmbeddingAdapter implements EmbeddingProviderAdapter {
  readonly providerId: EmbeddingProviderId = 'gemini-embedding';
  private customApiKey: string | null = null;
  private useManagedKey = false;
  private selectedModelId: string = DEFAULT_GEMINI_EMBEDDING_MODEL;
  private readonly embedFn: GeminiEmbedFn;

  constructor(options?: {
    apiKey?: string;
    useManagedKey?: boolean;
    selectedModelId?: string;
    embedFn?: GeminiEmbedFn;
  }) {
    if (options?.apiKey) {
      this.customApiKey = options.apiKey.trim();
    }
    if (options?.useManagedKey !== undefined) {
      this.useManagedKey = options.useManagedKey;
    }
    if (options?.selectedModelId) {
      this.selectedModelId = options.selectedModelId.trim();
    }
    this.embedFn = options?.embedFn ?? defaultGeminiEmbedFn;
  }

  public configure(options: { apiKey?: string; useManagedKeyIfAvailable?: boolean; selectedModelId?: string }): void {
    if (options.apiKey !== undefined) {
      this.customApiKey = options.apiKey.trim() || null;
    }
    if (options.useManagedKeyIfAvailable !== undefined) {
      this.useManagedKey = options.useManagedKeyIfAvailable;
    }
    if (options.selectedModelId && options.selectedModelId.trim()) {
      this.selectedModelId = options.selectedModelId.trim();
    }
  }

  public clearCredentials(): void {
    this.customApiKey = null;
    this.useManagedKey = false;
  }

  private resolveApiKey(): string | null {
    if (this.customApiKey) {
      return this.customApiKey;
    }
    if (this.useManagedKey) {
      const envKey = (process.env.GEMINI_API_KEY || process.env.API_KEY || '').trim();
      return envKey || null;
    }
    return null;
  }

  public isConfigured(): boolean {
    return Boolean(this.resolveApiKey());
  }

  public getSelectedModelId(): string {
    return this.selectedModelId;
  }

  public setSelectedModelId(modelId: string): void {
    if (modelId && modelId.trim()) {
      this.selectedModelId = modelId.trim();
    }
  }

  async discoverModels(): Promise<string[]> {
    return [DEFAULT_GEMINI_EMBEDDING_MODEL, 'text-embedding-004'];
  }

  async embedTexts(params: EmbeddingAdapterEmbedParams): Promise<EmbeddingAdapterEmbedOutput> {
    const apiKey = this.resolveApiKey();
    if (!apiKey) {
      throw new Error('Gemini Embedding API key is not configured or enabled.');
    }
    const modelId = (params.modelId || this.selectedModelId || DEFAULT_GEMINI_EMBEDDING_MODEL).trim();
    const rawVectors = await this.embedFn({
      apiKey,
      modelId,
      texts: params.texts,
      taskType: params.taskType,
    });

    const validated = validateAndNormalizeEmbeddingVectors(rawVectors, params.texts.length);
    const taskInstruction = params.taskInstruction || 'default';
    const namespaceKey = buildEmbeddingNamespaceKey({
      providerId: this.providerId,
      modelId,
      modelRevision: 'gemini-emb-v2',
      dimensions: validated.dimensions,
      normalized: true,
      taskInstruction,
      chunkerVersion: NARRATIVE_CHUNKER_VERSION,
    });

    return {
      vectors: validated.vectors,
      namespace: {
        providerId: this.providerId,
        modelId,
        modelRevision: 'gemini-emb-v2',
        dimensions: validated.dimensions,
        normalized: true,
        taskInstruction,
        chunkerVersion: NARRATIVE_CHUNKER_VERSION,
        namespaceKey,
      },
    };
  }
}

async function defaultGeminiEmbedFn(params: {
  apiKey: string;
  modelId: string;
  texts: string[];
  taskType: EmbeddingTaskType;
}): Promise<number[][]> {
  const ai = new GoogleGenAI({ apiKey: params.apiKey });
  const response = await ai.models.embedContent({
    model: params.modelId,
    contents: params.texts,
    config: {
      taskType: params.taskType === 'query' ? 'RETRIEVAL_QUERY' : 'RETRIEVAL_DOCUMENT',
    },
  });
  const embeddings = response.embeddings ?? [];
  return embeddings.map((entry) => entry.values ?? []);
}
