/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import express from 'express';
import type { Request, Response, Router } from 'express';
import {
  AnalyzeRequestSchema,
  BatchEditRequestSchema,
  ClarifyRequestSchema,
  GenerateMediaRequestSchema,
  RefineRequestSchema,
} from '../shared/schemas.ts';
import { NarrativeExtractionRequestSchema } from '../shared/importSchemas.ts';
import type { NarrativeExtraction, NarrativeExtractionRequest } from '../shared/importSchemas.ts';
import type {
  BatchEditProposalResult,
  BeliefState,
  Clarification,
  ClarificationAnswer,
  GenerationMode,
  GraphUpdate,
  ImageGenerationResult,
} from '../shared/types.ts';
import {
  DiagnosticsAnalyzeRequestSchema,
  DiagnosticsSuggestFixesRequestSchema,
  ImportEnhanceRequestSchema,
  OpportunitiesExploreRequestSchema,
  SyncAnalyzeRequestSchema,
  WritingAssistRequestSchema,
  type DiagnosticsAnalyzeRequest,
  type DiagnosticsAnalyzeResponse,
  type DiagnosticsSuggestFixesRequest,
  type DiagnosticsSuggestFixesResponse,
  type ImportEnhanceRequest,
  type ImportEnhanceResponse,
  type OpportunitiesExploreRequest,
  type OpportunitiesExploreResponse,
  type SyncAnalyzeRequest,
  type SyncAnalyzeResponse,
  type WritingAssistRequest,
  type WritingAssistResponse,
} from '../shared/narrativeAiSchemas.ts';
import { getAiCapabilitiesSnapshot, type AiOperation } from './aiBudget.ts';
import {
  analyzeBeliefGraph,
  generateClarificationsList,
  generateImagesBatch,
  generateStoryText,
  interpretBatchEditInstruction,
  refinePromptText,
} from './aiService.ts';
import { AppApiError, classifyGeminiError } from './errors.ts';
import { hasConfiguredGeminiKey } from './geminiClient.ts';
import { GEMINI_MODELS } from './models.ts';
import { createProviderHubRouter, resolveClientSelection, type ProviderHubRouterOptions } from './providerHubRoutes.ts';
import { getAiProviderRequestContext, runWithAiProviderContext } from './providers/requestContext.ts';
import { CAPABILITY_POLICY_VERSION, assertModelOperation, assertProviderOperation, assertReasoningSelection } from './providers/policy.ts';
import { getCachedProviderModel, getCredentialAuthorityId } from './providers/runtime.ts';
import { createChatGptStorySrbAuthority } from './providers/subscriptionResourceBudget.ts';
import { handleChatGptStoryGeneration, type ChatGptStorySrbInjection } from './providers/storyRouteHandler.ts';
import { extractNarrativeChunk } from './narrative/extractionService.ts';
import {
  analyzeNarrativeSync,
  analyzeSemanticDiagnostics,
  exploreCreativeOpportunities,
  proposeImportEnhancements,
  runWritingAssistant,
  suggestDiagnosticFixes,
} from './narrative/narrativeAiService.ts';

export interface AiServiceHandlers {
  analyzeBeliefGraph: (
    prompt: string,
    mode: GenerationMode,
    signal?: AbortSignal
  ) => Promise<BeliefState>;
  generateClarificationsList: (
    prompt: string,
    askedQuestions: string[],
    mode: GenerationMode,
    signal?: AbortSignal,
    confirmedFacts?: string[]
  ) => Promise<Clarification[]>;
  refinePromptText: (
    originalPrompt: string,
    clarifications: ClarificationAnswer[],
    graphUpdates: GraphUpdate[],
    signal?: AbortSignal
  ) => Promise<string>;
  interpretBatchEditInstruction?: (
    instruction: string,
    context: {
      prompt: string;
      entities: Array<{
        id?: string;
        name: string;
        category?: string;
        excluded?: boolean;
        attributes: Array<{ name: string; value: string; status?: string }>;
      }>;
      relationships: Array<{ id?: string; source: string; target: string; label: string }>;
    },
    signal?: AbortSignal
  ) => Promise<BatchEditProposalResult>;
  generateStoryText: (prompt: string, signal?: AbortSignal) => Promise<string>;
  generateImagesBatch: (prompt: string, signal?: AbortSignal) => Promise<ImageGenerationResult>;
  hasConfiguredGeminiKey: () => boolean;
  extractNarrativeChunk?: (request: NarrativeExtractionRequest, signal?: AbortSignal) => Promise<NarrativeExtraction>;
  analyzeSemanticDiagnostics?: (request: DiagnosticsAnalyzeRequest, signal?: AbortSignal) => Promise<DiagnosticsAnalyzeResponse>;
  suggestDiagnosticFixes?: (request: DiagnosticsSuggestFixesRequest, signal?: AbortSignal) => Promise<DiagnosticsSuggestFixesResponse>;
  analyzeNarrativeSync?: (request: SyncAnalyzeRequest, signal?: AbortSignal) => Promise<SyncAnalyzeResponse>;
  runWritingAssistant?: (request: WritingAssistRequest, signal?: AbortSignal) => Promise<WritingAssistResponse>;
  exploreCreativeOpportunities?: (request: OpportunitiesExploreRequest, signal?: AbortSignal) => Promise<OpportunitiesExploreResponse>;
  proposeImportEnhancements?: (request: ImportEnhanceRequest, signal?: AbortSignal) => Promise<ImportEnhanceResponse>;
}

const defaultHandlers: AiServiceHandlers = {
  analyzeBeliefGraph,
  generateClarificationsList,
  refinePromptText,
  interpretBatchEditInstruction,
  generateStoryText,
  generateImagesBatch,
  hasConfiguredGeminiKey,
  extractNarrativeChunk,
  analyzeSemanticDiagnostics,
  suggestDiagnosticFixes,
  analyzeNarrativeSync,
  runWritingAssistant,
  exploreCreativeOpportunities,
  proposeImportEnhancements,
};

export interface ApiRouterOptions {
  rateLimitWindowMs?: number;
  maxRequestsPerWindow?: number;
  /** Trusted development-process gate; no HTTP endpoint can enable it. */
  chatGptStoryLocalActivation?: boolean;
  /** Trusted deterministic qualification seam. Production createApiRouter() never supplies it. */
  chatGptStorySrbTestInjection?: ChatGptStorySrbInjection;
  /** In-process synthetic account catalog for key-free browser qualification only. */
  chatGptProviderHubTestInjection?: Pick<ProviderHubRouterOptions, 'chatGptStoryQualificationCatalog'>;
}

const MAX_RATE_LIMIT_CLIENTS = 4_096;
const defaultChatGptStorySrbAuthority = createChatGptStorySrbAuthority();

function attachRequestAbortSignal(_req: Request, res: Response): AbortController {
  const controller = new AbortController();
  const onClose = () => {
    if (!res.writableEnded) controller.abort();
  };
  res.on('close', onClose);
  res.once('finish', () => res.off('close', onClose));
  return controller;
}

function sendErrorResponse(res: Response, err: unknown): void {
  if (res.headersSent) return;
  const classified = classifyGeminiError(err);
  res.status(classified.statusCode).json({ error: classified.toPayload() });
}

interface ParseSchema<T> {
  safeParse(input: unknown): { success: true; data: T } | { success: false; error: { issues: Array<{ message: string }> } };
}

function registerJsonPostRoute<T>(
  router: Router,
  routePath: string,
  schema: ParseSchema<T>,
  fallbackError: string,
  execute: (data: T, signal: AbortSignal, req: Request) => Promise<unknown>,
): void {
  router.post(routePath, async (req, res) => {
    const parsed = schema.safeParse(req.body);
    if (!parsed.success) {
      const err = new AppApiError('VALIDATION_ERROR', parsed.error.issues[0]?.message ?? fallbackError, 400, false);
      res.status(400).json({ error: err.toPayload() });
      return;
    }
    const controller = attachRequestAbortSignal(req, res);
    try {
      res.json(await execute(parsed.data, controller.signal, req));
    } catch (err) {
      sendErrorResponse(res, err);
    }
  });
}

export function createIpRateLimiter(windowMs: number, maxRequests: number, maxClients: number = MAX_RATE_LIMIT_CLIENTS) {
  const clientWindows = new Map<string, { count: number; resetAt: number }>();

  const pruneOrEvict = (now: number) => {
    for (const [ip, entry] of clientWindows) {
      if (now >= entry.resetAt) clientWindows.delete(ip);
    }
    while (clientWindows.size >= maxClients) {
      const oldestIp = clientWindows.keys().next().value;
      if (oldestIp === undefined) break;
      clientWindows.delete(oldestIp);
    }
  };

  return {
    size: () => clientWindows.size,
    check(clientIp: string, now: number = Date.now()): { allowed: true } | { allowed: false; retryAfterSec: number } {
      if (maxRequests <= 0) return { allowed: true };
      const existing = clientWindows.get(clientIp);
      if (!existing || now >= existing.resetAt) {
        if (!existing && clientWindows.size >= maxClients) pruneOrEvict(now);
        clientWindows.set(clientIp, { count: 1, resetAt: now + windowMs });
        return { allowed: true };
      }
      if (existing.count >= maxRequests) {
        return { allowed: false, retryAfterSec: Math.max(1, Math.ceil((existing.resetAt - now) / 1000)) };
      }
      existing.count += 1;
      return { allowed: true };
    },
  };
}

const EXACT_OPERATION_PATHS: Record<string, AiOperation> = {
  '/analyze': 'analyze',
  '/clarify': 'clarify',
  '/refine': 'polish',
  '/batch-edit': 'batch-edit',
  '/generate/story': 'story',
  '/generate/images': 'image',
  '/narrative/import/extract': 'narrative-import',
};

const PREFIX_OPERATION_PATHS: ReadonlyArray<readonly [string, AiOperation]> = [
  ['/narrative/diagnostics/', 'diagnostics'],
  ['/narrative/sync/', 'sync'],
  ['/narrative/writing/', 'writing'],
  ['/narrative/opportunities/', 'opportunities'],
  ['/narrative/import/enhance', 'import-enhance'],
];

function resolveOperationForPath(routePath: string): AiOperation | undefined {
  const exact = EXACT_OPERATION_PATHS[routePath];
  if (exact) return exact;
  return PREFIX_OPERATION_PATHS.find(([prefix]) => routePath.startsWith(prefix))?.[1];
}

function validateNarrativePlanBinding(
  req: Request,
  selection: { connectionId: 'gemini-managed' | 'gemini-personal' | 'chatgpt-plan' | 'openai-api'; modelId?: string; reasoningLevel?: string },
): NarrativeExtractionRequest['providerPlanBinding'] {
  const providerPlanBinding = req.body && typeof req.body === 'object'
    ? (req.body as { providerPlanBinding?: unknown }).providerPlanBinding
    : undefined;
  if (!providerPlanBinding || typeof providerPlanBinding !== 'object' || Array.isArray(providerPlanBinding)) {
    throw new AppApiError('VALIDATION_ERROR', 'Narrative extraction requires its approved provider plan identity.', 400, false);
  }
  const binding = providerPlanBinding as Record<string, unknown>;
  const selectedReasoning = selection.reasoningLevel ?? 'default';
  const selectedModel = selection.modelId ? getCachedProviderModel(selection.connectionId, selection.modelId) : undefined;
  const managedMatches = selection.connectionId === 'gemini-managed' &&
    selection.modelId === GEMINI_MODELS.text &&
    binding.capabilityPolicyVersion === CAPABILITY_POLICY_VERSION &&
    selectedReasoning === 'default';
  const versionMatches = selectedModel?.capabilityPolicyVersion === binding.capabilityPolicyVersion || managedMatches;
  if (binding.connectionId !== selection.connectionId || binding.modelId !== selection.modelId ||
      binding.reasoningLevel !== selectedReasoning || !versionMatches ||
      binding.credentialAuthorityId !== getCredentialAuthorityId(selection.connectionId)) {
    throw new AppApiError(
      'CANCELLED',
      'The provider, model, reasoning, policy, or credential session changed after the analysis plan was approved. Preview and confirm a new plan.',
      409,
      false,
    );
  }
  return providerPlanBinding as NarrativeExtractionRequest['providerPlanBinding'];
}

function admitProviderRequest(
  req: Request,
  operation: AiOperation,
  isNarrativeExtraction: boolean,
  options: ApiRouterOptions,
): NarrativeExtractionRequest['providerPlanBinding'] | undefined {
  const selection = resolveClientSelection(req);
  if (!selection) {
    throw new AppApiError(
      'PROVIDER_SELECTION_INVALID' as AppApiError['code'],
      'The selected AI connection is unavailable in this environment. Choose an available connection explicitly.',
      403,
      false,
    );
  }
  const isChatGptPlan = selection.connectionId === 'chatgpt-plan';
  const authorizedBoundedStory = isChatGptPlan && operation === 'story' &&
    (options.chatGptStorySrbTestInjection !== undefined || options.chatGptStoryLocalActivation === true);
  // Never derive execution authority from an environment mode or cached model descriptor.
  if (isChatGptPlan && !authorizedBoundedStory) {
    throw new AppApiError('MODEL_UNSUPPORTED', 'ChatGPT plan is qualified only for the explicitly enabled local Story operation. Choose a compatible connection explicitly for other operations.', 422, false);
  }
  if (authorizedBoundedStory && (selection.modelId !== 'gpt-6-luna' || (selection.reasoningLevel ?? 'default') !== 'default')) {
    throw new AppApiError('MODEL_UNSUPPORTED', 'ChatGPT Story is qualified only for GPT-6 Luna with Default reasoning.', 422, false);
  }
  const providerPlanBinding = isNarrativeExtraction ? validateNarrativePlanBinding(req, selection) : undefined;
  if (!authorizedBoundedStory) assertProviderOperation(selection.connectionId, operation);
  if (selection.connectionId !== 'gemini-managed' && !selection.modelId) {
    throw new AppApiError('MODEL_UNSUPPORTED', 'Refresh this connection’s model list and select a model before using it.', 422, false);
  }
  if (selection.modelId) {
    const model = getCachedProviderModel(selection.connectionId, selection.modelId);
    if (!model) {
      const managedDefault = selection.connectionId === 'gemini-managed' && selection.modelId === GEMINI_MODELS.text &&
        (selection.reasoningLevel ?? 'default') === 'default';
      if (!managedDefault) {
        throw new AppApiError('MODEL_UNSUPPORTED', 'The selected model is not in the latest server-verified account catalog. Refresh the model list.', 422, false);
      }
    } else {
      if (!authorizedBoundedStory) assertModelOperation(model, operation);
      assertReasoningSelection(model, selection.reasoningLevel);
    }
  }
  return providerPlanBinding;
}

export function createApiRouter(
  handlers: AiServiceHandlers = defaultHandlers,
  options: ApiRouterOptions = {}
): Router {
  const router = express.Router();
  const localStoryAuthority = options.chatGptStoryLocalActivation
    ? createChatGptStorySrbAuthority({ enabled: true })
    : defaultChatGptStorySrbAuthority;
  const windowMs = options.rateLimitWindowMs ?? 60_000;
  const maxRequests = options.maxRequestsPerWindow ?? 60;
  const rateLimiter = createIpRateLimiter(windowMs, maxRequests);

  router.get('/health', (_req, res) => {
    res.json({ ok: true, configured: handlers.hasConfiguredGeminiKey(), models: GEMINI_MODELS });
  });

  router.use((req, res, next) => {
    const clientIp = req.ip || req.socket?.remoteAddress || 'local';
    const result = rateLimiter.check(clientIp);
    if (result.allowed) { next(); return; }
    res.setHeader('Retry-After', String(result.retryAfterSec));
    const err = new AppApiError(
      'RATE_LIMITED',
      `Rate limit exceeded (${maxRequests} requests per ${Math.round(windowMs / 1000)}s). Please wait ${result.retryAfterSec}s before retrying.`,
      429,
      true,
    );
    res.status(429).json({ error: err.toPayload() });
  });

  router.use((req, res, next) => {
    if (req.path === '/health' || req.path === '/ai/capabilities' || req.path.startsWith('/ai/provider-hub/')) {
      next();
      return;
    }
    const operation = resolveOperationForPath(req.path);
    if (!operation) { next(); return; }
    const isNarrativeExtraction = req.method === 'POST' && req.path === '/narrative/import/extract';
    const hasSelection = ['x-pcc-ai-connection', 'x-pcc-ai-model', 'x-pcc-ai-reasoning'].some((name) => req.get(name) !== undefined);
    if (!hasSelection && !isNarrativeExtraction) { next(); return; }
    const selection = resolveClientSelection(req);
    if (!selection) {
      res.status(403).json({ error: { code: 'PROVIDER_SELECTION_INVALID', message: 'The selected AI connection is unavailable in this environment. Choose an available connection explicitly.' } });
      return;
    }
    try {
      const providerPlanBinding = admitProviderRequest(req, operation, isNarrativeExtraction, options);
      runWithAiProviderContext({ selection, operation, ...(providerPlanBinding ? { providerPlanBinding } : {}) }, next);
    } catch (error) {
      const failure = error instanceof AppApiError ? error : new AppApiError('MODEL_UNSUPPORTED', 'The selected AI model cannot run this operation.', 422, false);
      res.status(failure.statusCode).json({ error: failure.toPayload() });
    }
  });

  router.use('/ai/provider-hub', createProviderHubRouter(options.chatGptProviderHubTestInjection));

  registerJsonPostRoute(router, '/analyze', AnalyzeRequestSchema, 'Invalid analysis request.', async (data, signal) => ({
    graph: await handlers.analyzeBeliefGraph(data.prompt, data.mode, signal),
  }));

  registerJsonPostRoute(router, '/narrative/import/extract', NarrativeExtractionRequestSchema, 'Invalid narrative import request.', async (data, signal) => {
    if (!handlers.extractNarrativeChunk) throw new AppApiError('INTERNAL_ERROR', 'Narrative extraction is unavailable.', 503, false);
    return { extraction: await handlers.extractNarrativeChunk(data, signal) };
  });

  registerJsonPostRoute(router, '/clarify', ClarifyRequestSchema, 'Invalid clarification request.', async (data, signal) => ({
    clarifications: await handlers.generateClarificationsList(data.prompt, data.askedQuestions, data.mode, signal, data.confirmedFacts),
  }));

  registerJsonPostRoute(router, '/refine', RefineRequestSchema, 'Invalid prompt refinement request.', async (data, signal) => ({
    refinedPrompt: await handlers.refinePromptText(data.originalPrompt, data.clarifications, data.graphUpdates, signal),
  }));

  registerJsonPostRoute(router, '/batch-edit', BatchEditRequestSchema, 'Invalid batch-edit request.', (data, signal) => {
    const handler = handlers.interpretBatchEditInstruction ?? interpretBatchEditInstruction;
    return handler(data.instruction, { prompt: data.prompt, entities: data.entities, relationships: data.relationships }, signal);
  });

  registerJsonPostRoute(router, '/generate/images', GenerateMediaRequestSchema, 'Invalid image generation request.', (data, signal) =>
    handlers.generateImagesBatch(data.prompt, signal),
  );

  registerJsonPostRoute(router, '/generate/story', GenerateMediaRequestSchema, 'Invalid story generation request.', async (data, signal, req) => {
    const providerContext = getAiProviderRequestContext();
    if (providerContext?.operation === 'story' && providerContext.selection.connectionId === 'chatgpt-plan') {
      return handleChatGptStoryGeneration({
        req,
        prompt: data.prompt,
        signal,
        providerContext,
        localActivation: options.chatGptStoryLocalActivation === true,
        localAuthority: localStoryAuthority,
        injection: options.chatGptStorySrbTestInjection,
      });
    }
    return { story: await handlers.generateStoryText(data.prompt, signal) };
  });

  router.get('/ai/capabilities', (_req, res) => {
    res.json({
      ...getAiCapabilitiesSnapshot(handlers.hasConfiguredGeminiKey()),
      chatGptStoryLocalActivation: options.chatGptStoryLocalActivation === true,
    });
  });

  registerJsonPostRoute(router, '/narrative/diagnostics/analyze', DiagnosticsAnalyzeRequestSchema, 'Invalid diagnostics analysis request.', (data, signal) =>
    (handlers.analyzeSemanticDiagnostics ?? analyzeSemanticDiagnostics)(data, signal),
  );
  registerJsonPostRoute(router, '/narrative/diagnostics/suggest-fixes', DiagnosticsSuggestFixesRequestSchema, 'Invalid fix suggestion request.', (data, signal) =>
    (handlers.suggestDiagnosticFixes ?? suggestDiagnosticFixes)(data, signal),
  );
  registerJsonPostRoute(router, '/narrative/sync/analyze', SyncAnalyzeRequestSchema, 'Invalid sync analysis request.', (data, signal) =>
    (handlers.analyzeNarrativeSync ?? analyzeNarrativeSync)(data, signal),
  );
  registerJsonPostRoute(router, '/narrative/writing/assist', WritingAssistRequestSchema, 'Invalid writing assistant request.', (data, signal) =>
    (handlers.runWritingAssistant ?? runWritingAssistant)(data, signal),
  );
  registerJsonPostRoute(router, '/narrative/opportunities/explore', OpportunitiesExploreRequestSchema, 'Invalid opportunity exploration request.', (data, signal) =>
    (handlers.exploreCreativeOpportunities ?? exploreCreativeOpportunities)(data, signal),
  );
  registerJsonPostRoute(router, '/narrative/import/enhance', ImportEnhanceRequestSchema, 'Invalid import enhancement request.', (data, signal) =>
    (handlers.proposeImportEnhancements ?? proposeImportEnhancements)(data, signal),
  );

  return router;
}
