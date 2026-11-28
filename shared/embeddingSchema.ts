import { z } from 'zod';
import { NARRATIVE_CHUNKER_VERSION } from './narrativeMemoryTypes';

export const EMBEDDING_PROVIDER_IDS = [
  'cloudflare-workers-ai',
  'lm-studio-local',
  'gemini-embedding',
] as const;

export type EmbeddingProviderId = (typeof EMBEDDING_PROVIDER_IDS)[number];

export const EMBEDDING_ROUTING_MODES = ['off', 'priority', 'all'] as const;
export type EmbeddingRoutingMode = (typeof EMBEDDING_ROUTING_MODES)[number];

export const DEFAULT_EMBEDDING_PRIORITY_ORDER: EmbeddingProviderId[] = [
  'cloudflare-workers-ai',
  'lm-studio-local',
  'gemini-embedding',
];

export const CLOUDFLARE_EMBEDDING_MODELS = [
  '@cf/qwen/qwen3-embedding-0.6b',
  '@cf/baai/bge-m3',
] as const;

export const DEFAULT_CLOUDFLARE_EMBEDDING_MODEL = '@cf/qwen/qwen3-embedding-0.6b';
export const DEFAULT_LM_STUDIO_EMBEDDING_MODEL = 'text-embedding-qwen3-embedding-0.6b';
export const DEFAULT_LM_STUDIO_ENDPOINT = 'http://127.0.0.1:1234';
export const DEFAULT_GEMINI_EMBEDDING_MODEL = 'gemini-embedding-2';

export const embeddingTaskTypeSchema = z.enum(['passage', 'query']);
export type EmbeddingTaskType = z.infer<typeof embeddingTaskTypeSchema>;

export const embeddingNamespaceDescriptorSchema = z.object({
  providerId: z.enum(EMBEDDING_PROVIDER_IDS),
  modelId: z.string().min(1).max(160),
  modelRevision: z.string().min(1).max(120).default('v1'),
  dimensions: z.number().int().min(8).max(8192),
  normalized: z.boolean().default(true),
  taskInstruction: z.string().max(320).default('default'),
  chunkerVersion: z.string().min(1).max(80).default(NARRATIVE_CHUNKER_VERSION),
  namespaceKey: z.string().min(1).max(512),
});

export type EmbeddingNamespaceDescriptor = z.infer<typeof embeddingNamespaceDescriptorSchema>;

export function buildEmbeddingNamespaceKey(input: {
  providerId: EmbeddingProviderId;
  modelId: string;
  modelRevision?: string;
  dimensions: number;
  normalized?: boolean;
  taskInstruction?: string;
  chunkerVersion?: string;
}): string {
  const rev = (input.modelRevision || 'v1').trim();
  const norm = input.normalized !== false ? 'l2' : 'raw';
  const instr = (input.taskInstruction || 'default').trim().toLowerCase().replace(/[^a-z0-9_-]+/g, '-');
  const chunker = (input.chunkerVersion || NARRATIVE_CHUNKER_VERSION).trim();
  return `${input.providerId}::${input.modelId.trim()}::${rev}::d${input.dimensions}::${norm}::${instr}::${chunker}`;
}

export interface EmbeddingProviderStatusSummary {
  providerId: EmbeddingProviderId;
  label: string;
  enabled: boolean;
  configured: boolean;
  credentialEpoch: number;
  selectedModelId: string;
  availableModels: string[];
  endpointUrl?: string;
  maskedAccountId?: string;
  connectionState: 'unconfigured' | 'ready' | 'unavailable' | 'invalid-credentials' | 'error';
  catalogState: 'unknown' | 'discovered' | 'static-catalog' | 'empty';
  eligibilityState: 'disabled' | 'consent-required' | 'eligible' | 'unreachable-local';
  lastVerifiedAt?: number;
  lastObservedDimensions?: number;
  lastError?: string;
  costDisclosure: string;
}

export interface EmbeddingHubStatusResponse {
  routingMode: EmbeddingRoutingMode;
  priorityOrder: EmbeddingProviderId[];
  consentedProjectIds: string[];
  maxBatchSize: number;
  maxBatchChars: number;
  requestBudgetPerSession: number;
  consumedRequestsInSession: number;
  providers: Record<EmbeddingProviderId, EmbeddingProviderStatusSummary>;
}

export const embeddingPreferencesUpdateSchema = z.object({
  routingMode: z.enum(EMBEDDING_ROUTING_MODES).optional(),
  priorityOrder: z.array(z.enum(EMBEDDING_PROVIDER_IDS)).min(1).max(3).optional(),
  providerSettings: z
    .record(
      z.enum(EMBEDDING_PROVIDER_IDS),
      z.object({
        enabled: z.boolean().optional(),
        selectedModelId: z.string().min(1).max(160).optional(),
      })
    )
    .optional(),
  projectConsent: z
    .object({
      projectId: z.string().min(1).max(160),
      consented: z.boolean(),
    })
    .optional(),
  requestBudgetPerSession: z.number().int().min(1).max(500).optional(),
});

export type EmbeddingPreferencesUpdate = z.infer<typeof embeddingPreferencesUpdateSchema>;

export const cloudflareCredentialsInputSchema = z.object({
  accountId: z
    .string()
    .trim()
    .regex(/^[a-fA-F0-9]{16,64}$/, 'Cloudflare Account ID must be a 16-64 character hexadecimal identifier.'),
  apiToken: z.string().trim().min(16, 'Cloudflare API token must be at least 16 characters.').max(512),
  selectedModelId: z.string().trim().min(1).max(160).optional(),
});

export const lmStudioConfigInputSchema = z.object({
  endpointUrl: z.string().trim().min(7).max(256),
  selectedModelId: z.string().trim().min(1).max(160).optional(),
});

export const geminiEmbeddingConfigInputSchema = z.object({
  apiKey: z.string().trim().min(12).max(512).optional(),
  useManagedKeyIfAvailable: z.boolean().optional(),
  selectedModelId: z.string().trim().min(1).max(160).optional(),
});

export const embeddingTestRequestSchema = z.object({
  providerId: z.enum(EMBEDDING_PROVIDER_IDS),
  sampleText: z.string().trim().min(1).max(400).optional(),
});

export const embeddingBatchRequestSchema = z.object({
  projectId: z.string().trim().min(1).max(160),
  projectRevision: z.number().int().min(1),
  taskType: embeddingTaskTypeSchema.default('passage'),
  taskInstruction: z.string().max(320).default('default'),
  /** Optional explicit provider target; if omitted, uses active routingMode (priority or all) */
  providerId: z.enum(EMBEDDING_PROVIDER_IDS).optional(),
  items: z
    .array(
      z.object({
        id: z.string().min(1).max(240),
        chunkDigest: z.string().min(1).max(160),
        text: z.string().min(1).max(8000),
      })
    )
    .min(1)
    .max(32),
});

export type EmbeddingBatchRequest = z.infer<typeof embeddingBatchRequestSchema>;

export interface EmbeddingProviderBatchResult {
  providerId: EmbeddingProviderId;
  status: 'ok' | 'skipped' | 'error';
  namespace?: EmbeddingNamespaceDescriptor;
  credentialEpoch: number;
  vectors?: Array<{
    id: string;
    chunkDigest: string;
    vector: number[];
  }>;
  reason?: string;
  latencyMs?: number;
}

export interface EmbeddingBatchResponse {
  projectId: string;
  projectRevision: number;
  routingMode: EmbeddingRoutingMode;
  results: EmbeddingProviderBatchResult[];
}
