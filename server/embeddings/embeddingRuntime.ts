import {
  CLOUDFLARE_EMBEDDING_MODELS,
  DEFAULT_EMBEDDING_PRIORITY_ORDER,
  DEFAULT_GEMINI_EMBEDDING_MODEL,
  DEFAULT_LM_STUDIO_EMBEDDING_MODEL,
  EmbeddingBatchRequest,
  EmbeddingBatchResponse,
  EmbeddingHubStatusResponse,
  EmbeddingPreferencesUpdate,
  EmbeddingProviderBatchResult,
  EmbeddingProviderId,
  EmbeddingProviderStatusSummary,
  EmbeddingRoutingMode,
} from '../../shared/embeddingSchema';
import {
  CloudflareEmbeddingAdapter,
  FetchLike,
  GeminiEmbedFn,
  GeminiEmbeddingAdapter,
  LmStudioEmbeddingAdapter,
} from './adapters';

export interface EmbeddingRuntimeOptions {
  fetchImpl?: FetchLike;
  geminiEmbedFn?: GeminiEmbedFn;
}

interface ProviderRuntimeMeta {
  enabled: boolean;
  credentialEpoch: number;
  connectionState: EmbeddingProviderStatusSummary['connectionState'];
  catalogState: EmbeddingProviderStatusSummary['catalogState'];
  availableModels: string[];
  lastVerifiedAt?: number;
  lastObservedDimensions?: number;
  lastError?: string;
}

export class EmbeddingHubRuntime {
  private routingMode: EmbeddingRoutingMode = 'off';
  private priorityOrder: EmbeddingProviderId[] = [...DEFAULT_EMBEDDING_PRIORITY_ORDER];
  private consentedProjectIds = new Set<string>();
  private maxBatchSize = 24;
  private maxBatchChars = 32000;
  private requestBudgetPerSession = 120;
  private consumedRequestsInSession = 0;

  private readonly cloudflareAdapter: CloudflareEmbeddingAdapter;
  private readonly lmStudioAdapter: LmStudioEmbeddingAdapter;
  private readonly geminiAdapter: GeminiEmbeddingAdapter;

  private readonly meta: Record<EmbeddingProviderId, ProviderRuntimeMeta> = {
    'cloudflare-workers-ai': {
      enabled: false,
      credentialEpoch: 1,
      connectionState: 'unconfigured',
      catalogState: 'static-catalog',
      availableModels: [...CLOUDFLARE_EMBEDDING_MODELS],
    },
    'lm-studio-local': {
      enabled: false,
      credentialEpoch: 1,
      connectionState: 'unconfigured',
      catalogState: 'unknown',
      availableModels: [DEFAULT_LM_STUDIO_EMBEDDING_MODEL],
    },
    'gemini-embedding': {
      enabled: false,
      credentialEpoch: 1,
      connectionState: 'unconfigured',
      catalogState: 'static-catalog',
      availableModels: [DEFAULT_GEMINI_EMBEDDING_MODEL, 'text-embedding-004'],
    },
  };

  constructor(options?: EmbeddingRuntimeOptions) {
    this.cloudflareAdapter = new CloudflareEmbeddingAdapter({
      fetchImpl: options?.fetchImpl,
    });
    this.lmStudioAdapter = new LmStudioEmbeddingAdapter({
      fetchImpl: options?.fetchImpl,
    });
    this.geminiAdapter = new GeminiEmbeddingAdapter({
      embedFn: options?.geminiEmbedFn,
    });
  }

  public getStatus(activeProjectId?: string): EmbeddingHubStatusResponse {
    const hasConsent = activeProjectId ? this.consentedProjectIds.has(activeProjectId) : this.consentedProjectIds.size > 0;

    const cfMeta = this.meta['cloudflare-workers-ai'];
    const lmMeta = this.meta['lm-studio-local'];
    const gmMeta = this.meta['gemini-embedding'];

    const cfConfigured = this.cloudflareAdapter.isConfigured();
    const gmConfigured = this.geminiAdapter.isConfigured();

    return {
      routingMode: this.routingMode,
      priorityOrder: [...this.priorityOrder],
      consentedProjectIds: Array.from(this.consentedProjectIds),
      maxBatchSize: this.maxBatchSize,
      maxBatchChars: this.maxBatchChars,
      requestBudgetPerSession: this.requestBudgetPerSession,
      consumedRequestsInSession: this.consumedRequestsInSession,
      providers: {
        'cloudflare-workers-ai': {
          providerId: 'cloudflare-workers-ai',
          label: 'Cloudflare Workers AI',
          enabled: cfMeta.enabled,
          configured: cfConfigured,
          credentialEpoch: cfMeta.credentialEpoch,
          selectedModelId: this.cloudflareAdapter.getSelectedModelId(),
          availableModels: cfMeta.availableModels,
          maskedAccountId: this.cloudflareAdapter.getMaskedAccountId(),
          connectionState: cfConfigured ? cfMeta.connectionState : 'unconfigured',
          catalogState: cfMeta.catalogState,
          eligibilityState: !cfMeta.enabled
            ? 'disabled'
            : !hasConsent
              ? 'consent-required'
              : cfConfigured
                ? 'eligible'
                : 'disabled',
          lastVerifiedAt: cfMeta.lastVerifiedAt,
          lastObservedDimensions: cfMeta.lastObservedDimensions,
          lastError: cfMeta.lastError,
          costDisclosure:
            'Cloudflare Workers AI includes 10,000 free Neurons/day pooled across Workers AI models; remaining daily account Neurons are not exposed by the embedding endpoint.',
        },
        'lm-studio-local': {
          providerId: 'lm-studio-local',
          label: 'LM Studio (Local Loopback)',
          enabled: lmMeta.enabled,
          configured: true,
          credentialEpoch: lmMeta.credentialEpoch,
          selectedModelId: this.lmStudioAdapter.getSelectedModelId(),
          availableModels: lmMeta.availableModels,
          endpointUrl: this.lmStudioAdapter.getBaseUrl(),
          connectionState: lmMeta.connectionState,
          catalogState: lmMeta.catalogState,
          eligibilityState: !lmMeta.enabled
            ? 'disabled'
            : lmMeta.connectionState === 'unavailable'
              ? 'unreachable-local'
              : 'eligible',
          lastVerifiedAt: lmMeta.lastVerifiedAt,
          lastObservedDimensions: lmMeta.lastObservedDimensions,
          lastError: lmMeta.lastError,
          costDisclosure:
            'Runs 100% locally over loopback (127.0.0.1 / localhost). No external network egress or token cost. Requires LM Studio running on the same machine as the server.',
        },
        'gemini-embedding': {
          providerId: 'gemini-embedding',
          label: 'Gemini Embedding 2',
          enabled: gmMeta.enabled,
          configured: gmConfigured,
          credentialEpoch: gmMeta.credentialEpoch,
          selectedModelId: this.geminiAdapter.getSelectedModelId(),
          availableModels: gmMeta.availableModels,
          connectionState: gmConfigured ? gmMeta.connectionState : 'unconfigured',
          catalogState: gmMeta.catalogState,
          eligibilityState: !gmMeta.enabled
            ? 'disabled'
            : !hasConsent
              ? 'consent-required'
              : gmConfigured
                ? 'eligible'
                : 'disabled',
          lastVerifiedAt: gmMeta.lastVerifiedAt,
          lastObservedDimensions: gmMeta.lastObservedDimensions,
          lastError: gmMeta.lastError,
          costDisclosure:
            'Sends selected text chunks to Google Gemini Embedding API (gemini-embedding-2). Requires explicit per-project external embedding consent.',
        },
      },
    };
  }

  public updatePreferences(update: EmbeddingPreferencesUpdate): EmbeddingHubStatusResponse {
    if (update.routingMode) {
      this.routingMode = update.routingMode;
    }
    if (update.priorityOrder) {
      const unique = Array.from(new Set(update.priorityOrder));
      for (const id of DEFAULT_EMBEDDING_PRIORITY_ORDER) {
        if (!unique.includes(id)) unique.push(id);
      }
      this.priorityOrder = unique;
    }
    if (update.providerSettings) {
      for (const [id, cfg] of Object.entries(update.providerSettings) as Array<
        [EmbeddingProviderId, { enabled?: boolean; selectedModelId?: string }]
      >) {
        const meta = this.meta[id];
        if (!meta || !cfg) continue;
        if (cfg.enabled !== undefined) {
          meta.enabled = cfg.enabled;
        }
        if (cfg.selectedModelId) {
          if (id === 'cloudflare-workers-ai') {
            this.cloudflareAdapter.setSelectedModelId(cfg.selectedModelId);
          } else if (id === 'lm-studio-local') {
            this.lmStudioAdapter.setConfiguration(this.lmStudioAdapter.getBaseUrl(), cfg.selectedModelId);
          } else if (id === 'gemini-embedding') {
            this.geminiAdapter.setSelectedModelId(cfg.selectedModelId);
          }
        }
      }
    }
    if (update.projectConsent) {
      if (update.projectConsent.consented) {
        this.consentedProjectIds.add(update.projectConsent.projectId);
      } else {
        this.consentedProjectIds.delete(update.projectConsent.projectId);
      }
    }
    if (update.requestBudgetPerSession !== undefined) {
      this.requestBudgetPerSession = update.requestBudgetPerSession;
    }
    return this.getStatus(update.projectConsent?.projectId);
  }

  public configureCloudflare(input: {
    accountId: string;
    apiToken: string;
    selectedModelId?: string;
  }): EmbeddingHubStatusResponse {
    this.cloudflareAdapter.setCredentials(input.accountId, input.apiToken, input.selectedModelId);
    const meta = this.meta['cloudflare-workers-ai'];
    meta.credentialEpoch += 1;
    meta.connectionState = 'ready';
    meta.lastError = undefined;
    return this.getStatus();
  }

  public clearCloudflareCredentials(): EmbeddingHubStatusResponse {
    this.cloudflareAdapter.clearCredentials();
    const meta = this.meta['cloudflare-workers-ai'];
    meta.credentialEpoch += 1;
    meta.connectionState = 'unconfigured';
    meta.enabled = false;
    meta.lastError = undefined;
    return this.getStatus();
  }

  public configureLmStudio(input: {
    endpointUrl: string;
    selectedModelId?: string;
  }): EmbeddingHubStatusResponse {
    this.lmStudioAdapter.setConfiguration(input.endpointUrl, input.selectedModelId);
    const meta = this.meta['lm-studio-local'];
    meta.credentialEpoch += 1;
    meta.connectionState = 'ready';
    meta.lastError = undefined;
    return this.getStatus();
  }

  public configureGemini(input: {
    apiKey?: string;
    useManagedKeyIfAvailable?: boolean;
    selectedModelId?: string;
  }): EmbeddingHubStatusResponse {
    this.geminiAdapter.configure(input);
    const meta = this.meta['gemini-embedding'];
    meta.credentialEpoch += 1;
    meta.connectionState = this.geminiAdapter.isConfigured() ? 'ready' : 'unconfigured';
    meta.lastError = undefined;
    return this.getStatus();
  }

  public clearGeminiCredentials(): EmbeddingHubStatusResponse {
    this.geminiAdapter.clearCredentials();
    const meta = this.meta['gemini-embedding'];
    meta.credentialEpoch += 1;
    meta.connectionState = 'unconfigured';
    meta.enabled = false;
    meta.lastError = undefined;
    return this.getStatus();
  }

  public async testProviderConnection(
    providerId: EmbeddingProviderId,
    sampleText = 'Narrative memory diagnostic probe.'
  ): Promise<{
    providerId: EmbeddingProviderId;
    ok: boolean;
    dimensions?: number;
    modelId?: string;
    discoveredModels?: string[];
    latencyMs: number;
    message: string;
    status: EmbeddingHubStatusResponse;
  }> {
    const start = Date.now();
    const meta = this.meta[providerId];
    try {
      if (providerId === 'lm-studio-local') {
        const models = await this.lmStudioAdapter.discoverModels().catch(() => []);
        if (models.length > 0) {
          meta.availableModels = models;
          meta.catalogState = 'discovered';
        }
        const out = await this.lmStudioAdapter.embedTexts({
          texts: [sampleText],
          taskType: 'query',
        });
        meta.connectionState = 'ready';
        meta.lastVerifiedAt = Date.now();
        meta.lastObservedDimensions = out.namespace.dimensions;
        meta.lastError = undefined;
        return {
          providerId,
          ok: true,
          dimensions: out.namespace.dimensions,
          modelId: out.namespace.modelId,
          discoveredModels: meta.availableModels,
          latencyMs: Date.now() - start,
          message: `Verified LM Studio loopback embedding (${out.namespace.modelId}, ${out.namespace.dimensions} dims).`,
          status: this.getStatus(),
        };
      }

      if (providerId === 'cloudflare-workers-ai') {
        const out = await this.cloudflareAdapter.embedTexts({
          texts: [sampleText],
          taskType: 'query',
        });
        meta.connectionState = 'ready';
        meta.lastVerifiedAt = Date.now();
        meta.lastObservedDimensions = out.namespace.dimensions;
        meta.lastError = undefined;
        return {
          providerId,
          ok: true,
          dimensions: out.namespace.dimensions,
          modelId: out.namespace.modelId,
          discoveredModels: meta.availableModels,
          latencyMs: Date.now() - start,
          message: `Verified Cloudflare Workers AI embedding (${out.namespace.modelId}, ${out.namespace.dimensions} dims).`,
          status: this.getStatus(),
        };
      }

      const out = await this.geminiAdapter.embedTexts({
        texts: [sampleText],
        taskType: 'query',
      });
      meta.connectionState = 'ready';
      meta.lastVerifiedAt = Date.now();
      meta.lastObservedDimensions = out.namespace.dimensions;
      meta.lastError = undefined;
      return {
        providerId,
        ok: true,
        dimensions: out.namespace.dimensions,
        modelId: out.namespace.modelId,
        discoveredModels: meta.availableModels,
        latencyMs: Date.now() - start,
        message: `Verified Gemini Embedding 2 (${out.namespace.modelId}, ${out.namespace.dimensions} dims).`,
        status: this.getStatus(),
      };
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      meta.lastError = msg;
      if (providerId === 'lm-studio-local') {
        meta.connectionState = 'unavailable';
      } else if (/401|403|authentication|api key/i.test(msg)) {
        meta.connectionState = 'invalid-credentials';
      } else {
        meta.connectionState = 'error';
      }
      return {
        providerId,
        ok: false,
        latencyMs: Date.now() - start,
        message: msg,
        status: this.getStatus(),
      };
    }
  }

  /**
   * Executes a bounded batch embedding request according to the current routingMode
   * ('off', 'priority', or 'all') or an explicit providerId override.
   * Never automatically fails over to a different provider after an uncertain remote dispatch.
   */
  public async embedBatch(request: EmbeddingBatchRequest): Promise<EmbeddingBatchResponse> {
    if (this.routingMode === 'off' && !request.providerId) {
      return {
        projectId: request.projectId,
        projectRevision: request.projectRevision,
        routingMode: this.routingMode,
        results: [],
      };
    }

    if (request.items.length > this.maxBatchSize) {
      throw new Error(`Batch size ${request.items.length} exceeds maximum allowed batch size of ${this.maxBatchSize}.`);
    }
    const totalChars = request.items.reduce((acc, item) => acc + item.text.length, 0);
    if (totalChars > this.maxBatchChars) {
      throw new Error(`Batch payload (${totalChars} chars) exceeds maximum allowed ${this.maxBatchChars} chars.`);
    }
    if (this.consumedRequestsInSession >= this.requestBudgetPerSession) {
      throw new Error(
        `Session embedding request budget (${this.requestBudgetPerSession}) reached. Increase the budget in AI Settings → Embeddings & Search.`
      );
    }

    const candidateProviders: EmbeddingProviderId[] = request.providerId
      ? [request.providerId]
      : [...this.priorityOrder];

    const results: EmbeddingProviderBatchResult[] = [];
    const hasProjectConsent = this.consentedProjectIds.has(request.projectId);

    for (const providerId of candidateProviders) {
      const meta = this.meta[providerId];
      if (!meta.enabled && !request.providerId) {
        results.push({
          providerId,
          status: 'skipped',
          credentialEpoch: meta.credentialEpoch,
          reason: 'Provider is disabled in Embeddings & Search settings.',
        });
        continue;
      }

      // External providers require explicit per-project consent
      const isExternalCloud = providerId === 'cloudflare-workers-ai' || providerId === 'gemini-embedding';
      if (isExternalCloud && !hasProjectConsent) {
        results.push({
          providerId,
          status: 'skipped',
          credentialEpoch: meta.credentialEpoch,
          reason: `Project "${request.projectId}" has not granted explicit external embedding consent.`,
        });
        continue;
      }

      if (providerId === 'cloudflare-workers-ai' && !this.cloudflareAdapter.isConfigured()) {
        results.push({
          providerId,
          status: 'skipped',
          credentialEpoch: meta.credentialEpoch,
          reason: 'Cloudflare Workers AI credentials are not configured.',
        });
        continue;
      }

      if (providerId === 'gemini-embedding' && !this.geminiAdapter.isConfigured()) {
        results.push({
          providerId,
          status: 'skipped',
          credentialEpoch: meta.credentialEpoch,
          reason: 'Gemini Embedding credentials are not configured.',
        });
        continue;
      }

      const epochBefore = meta.credentialEpoch;
      const start = Date.now();
      try {
        this.consumedRequestsInSession += 1;
        const adapter =
          providerId === 'cloudflare-workers-ai'
            ? this.cloudflareAdapter
            : providerId === 'lm-studio-local'
              ? this.lmStudioAdapter
              : this.geminiAdapter;

        const out = await adapter.embedTexts({
          texts: request.items.map((item) => item.text),
          taskType: request.taskType,
          taskInstruction: request.taskInstruction,
        });

        if (meta.credentialEpoch !== epochBefore) {
          results.push({
            providerId,
            status: 'error',
            credentialEpoch: meta.credentialEpoch,
            reason: 'Credentials changed while embedding request was in flight; discarding response.',
            latencyMs: Date.now() - start,
          });
        } else {
          meta.connectionState = 'ready';
          meta.lastVerifiedAt = Date.now();
          meta.lastObservedDimensions = out.namespace.dimensions;
          meta.lastError = undefined;

          results.push({
            providerId,
            status: 'ok',
            namespace: out.namespace,
            credentialEpoch: epochBefore,
            latencyMs: Date.now() - start,
            vectors: request.items.map((item, idx) => ({
              id: item.id,
              chunkDigest: item.chunkDigest,
              vector: out.vectors[idx],
            })),
          });
        }

        // In 'priority' mode, stop at the first eligible provider that we dispatched to.
        // We never silently fallback to a second cloud provider after dispatching text!
        if (this.routingMode === 'priority' && !request.providerId) {
          break;
        }
      } catch (error) {
        const msg = error instanceof Error ? error.message : String(error);
        meta.lastError = msg;
        meta.connectionState = providerId === 'lm-studio-local' ? 'unavailable' : 'error';
        results.push({
          providerId,
          status: 'error',
          credentialEpoch: epochBefore,
          reason: msg,
          latencyMs: Date.now() - start,
        });

        // Do not automatically retry or fallback to another provider after dispatch failure
        if (this.routingMode === 'priority' && !request.providerId) {
          break;
        }
      }
    }

    return {
      projectId: request.projectId,
      projectRevision: request.projectRevision,
      routingMode: this.routingMode,
      results,
    };
  }
}

export const defaultEmbeddingHubRuntime = new EmbeddingHubRuntime();
