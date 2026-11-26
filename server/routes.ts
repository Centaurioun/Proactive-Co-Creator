/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import express from 'express';
import type { Request, Response, Router } from 'express';
import { createHash } from 'node:crypto';
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
import { getAiCapabilitiesSnapshot } from './aiBudget.ts';
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
import { createProviderHubRouter, resolveClientSelection } from './providerHubRoutes.ts';
import { getAiProviderRequestContext, runWithAiProviderContext } from './providers/requestContext.ts';
import { CAPABILITY_POLICY_VERSION, assertModelOperation, assertProviderOperation, assertReasoningSelection } from './providers/policy.ts';
import { createChatGptAdapter, getCachedProviderModel, getCredentialAuthorityId } from './providers/runtime.ts';
import { chatGptSessionStore } from './auth/chatgpt/runtime.ts';
import { createChatGptStorySrbAuthority, type ChatGptStorySrbAuthority } from './providers/subscriptionResourceBudget.ts';
import type { ChatGptResponsesAdapter } from './providers/chatgptResponses.ts';
import type { AiOperation } from './aiBudget.ts';
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

function attachRequestAbortSignal(_req: Request, res: Response): AbortController {
  const controller = new AbortController();
  const onClose = () => {
    if (!res.writableEnded) {
      controller.abort();
    }
  };
  res.on('close', onClose);
  res.once('finish', () => {
    res.off('close', onClose);
  });
  return controller;
}

function sendErrorResponse(res: Response, err: unknown): void {
  if (res.headersSent) return;
  const classified = classifyGeminiError(err);
  res.status(classified.statusCode).json({ error: classified.toPayload() });
}

export interface ApiRouterOptions {
  rateLimitWindowMs?: number;
  maxRequestsPerWindow?: number;
  /** Trusted deterministic qualification seam. Production createApiRouter() never supplies it. */
  chatGptStorySrbTestInjection?: {
    authority: ChatGptStorySrbAuthority;
    currentGrantGeneration: () => number;
    adapterFactory: (generation: number) => Pick<ChatGptResponsesAdapter, 'generateStoryText'>;
  };
}

const defaultChatGptStorySrbAuthority = createChatGptStorySrbAuthority();
const CHATGPT_STORY_INSTRUCTIONS = 'Write a vivid, engaging, well-structured story based only on the supplied story brief and its creative constraints. Preserve confirmed details and exclusions. Return story text only.';

export function createApiRouter(
  handlers: AiServiceHandlers = defaultHandlers,
  options: ApiRouterOptions = {}
): Router {
  const router = express.Router();
  const windowMs = options.rateLimitWindowMs ?? 60_000;
  const maxRequests = options.maxRequestsPerWindow ?? 60;
  const clientWindows = new Map<string, { count: number; resetAt: number }>();

  router.get('/health', (_req, res) => {
    res.json({
      ok: true,
      configured: handlers.hasConfiguredGeminiKey(),
      models: GEMINI_MODELS,
    });
  });

  router.use((req, res, next) => {
    if (maxRequests <= 0) {
      next();
      return;
    }
    const now = Date.now();
    const clientIp = req.ip || req.socket?.remoteAddress || 'local';
    const existing = clientWindows.get(clientIp);
    if (!existing || now >= existing.resetAt) {
      clientWindows.set(clientIp, { count: 1, resetAt: now + windowMs });
      next();
      return;
    }
    if (existing.count >= maxRequests) {
      const retryAfterSec = Math.max(1, Math.ceil((existing.resetAt - now) / 1000));
      res.setHeader('Retry-After', String(retryAfterSec));
      const err = new AppApiError(
        'RATE_LIMITED',
        `Rate limit exceeded (${maxRequests} requests per ${Math.round(windowMs / 1000)}s). Please wait ${retryAfterSec}s before retrying.`,
        429,
        true
      );
      res.status(429).json({ error: err.toPayload() });
      return;
    }
    existing.count += 1;
    next();
  });

  router.use((req, res, next) => {
    if (req.path === '/health' || req.path.startsWith('/ai/provider-hub/')) { next(); return; }
    const isNarrativeExtraction = req.method === 'POST' && req.path === '/narrative/import/extract';
    const hasSelection = ['x-pcc-ai-connection', 'x-pcc-ai-model', 'x-pcc-ai-reasoning'].some((name) => req.get(name) !== undefined);
    if (!hasSelection && !isNarrativeExtraction) { next(); return; }
    const selection = resolveClientSelection(req);
    if (!selection) {
      res.status(403).json({ error: { code: 'PROVIDER_SELECTION_INVALID', message: 'The selected AI connection is unavailable in this environment. Choose an available connection explicitly.' } });
      return;
    }
    const path = req.path;
    const operation: AiOperation = path === '/analyze' ? 'analyze'
      : path === '/clarify' ? 'clarify'
      : path === '/refine' ? 'polish'
      : path === '/batch-edit' ? 'batch-edit'
      : path === '/generate/story' ? 'story'
      : path === '/generate/images' ? 'image'
      : path === '/narrative/import/extract' ? 'narrative-import'
      : path.startsWith('/narrative/diagnostics/') ? 'diagnostics'
      : path.startsWith('/narrative/sync/') ? 'sync'
      : path.startsWith('/narrative/writing/') ? 'writing'
      : path.startsWith('/narrative/opportunities/') ? 'opportunities'
      : path.startsWith('/narrative/import/enhance') ? 'import-enhance'
      : 'story';
    try {
      const injectedStoryQualification = operation === 'story' && selection.connectionId === 'chatgpt-plan' &&
        options.chatGptStorySrbTestInjection !== undefined;
      if (injectedStoryQualification && (selection.reasoningLevel ?? 'default') !== 'default') {
        throw new AppApiError('MODEL_UNSUPPORTED', 'The story pilot uses Default reasoning only.', 422, false);
      }
      const providerPlanBinding = isNarrativeExtraction && req.body && typeof req.body === 'object'
        ? (req.body as { providerPlanBinding?: unknown }).providerPlanBinding
        : undefined;
      if (isNarrativeExtraction) {
        if (!providerPlanBinding || typeof providerPlanBinding !== 'object' || Array.isArray(providerPlanBinding)) {
          throw new AppApiError('VALIDATION_ERROR', 'Narrative extraction requires its approved provider plan identity.', 400, false);
        }
        const binding = providerPlanBinding as {
          connectionId?: unknown; modelId?: unknown; reasoningLevel?: unknown;
          capabilityPolicyVersion?: unknown; credentialAuthorityId?: unknown;
        };
        const selectedReasoning = selection.reasoningLevel ?? 'default';
        const selectedModel = selection.modelId ? getCachedProviderModel(selection.connectionId, selection.modelId) : undefined;
        const managedModelMatches = selection.connectionId === 'gemini-managed' &&
          selection.modelId === GEMINI_MODELS.text && binding.capabilityPolicyVersion === CAPABILITY_POLICY_VERSION &&
          selectedReasoning === 'default';
        if (binding.connectionId !== selection.connectionId || binding.modelId !== selection.modelId ||
            binding.reasoningLevel !== selectedReasoning ||
            !(selectedModel?.capabilityPolicyVersion === binding.capabilityPolicyVersion || managedModelMatches) ||
            binding.credentialAuthorityId !== getCredentialAuthorityId(selection.connectionId)) {
          throw new AppApiError('CANCELLED', 'The provider, model, reasoning, policy, or credential session changed after the analysis plan was approved. Preview and confirm a new plan.', 409, false);
        }
      }
      if (!injectedStoryQualification) assertProviderOperation(selection.connectionId, operation);
      if (selection.connectionId !== 'gemini-managed' && !selection.modelId) {
        throw new AppApiError('MODEL_UNSUPPORTED', 'Refresh this connection’s model list and select a model before using it.', 422, false);
      }
      if (selection.modelId) {
        const model = getCachedProviderModel(selection.connectionId, selection.modelId);
        if (!model) {
          const managedDefault = selection.connectionId === 'gemini-managed' && selection.modelId === GEMINI_MODELS.text &&
            (selection.reasoningLevel ?? 'default') === 'default';
          if (!managedDefault) throw new AppApiError('MODEL_UNSUPPORTED', 'The selected model is not in the latest server-verified account catalog. Refresh the model list.', 422, false);
        } else {
          if (!injectedStoryQualification) assertModelOperation(model, operation);
          assertReasoningSelection(model, selection.reasoningLevel);
        }
      }
    } catch (error) {
      const failure = error instanceof AppApiError ? error : new AppApiError('MODEL_UNSUPPORTED', 'The selected AI model cannot run this operation.', 422, false);
      res.status(failure.statusCode).json({ error: failure.toPayload() });
      return;
    }
    const providerPlanBinding = isNarrativeExtraction
      ? (req.body as { providerPlanBinding?: NarrativeExtractionRequest['providerPlanBinding'] } | undefined)?.providerPlanBinding
      : undefined;
    runWithAiProviderContext({ selection, operation, ...(providerPlanBinding ? { providerPlanBinding } : {}) }, next);
  });

  router.use('/ai/provider-hub', createProviderHubRouter());

  router.post('/analyze', async (req, res) => {
    const parsed = AnalyzeRequestSchema.safeParse(req.body);
    if (!parsed.success) {
      const err = new AppApiError(
        'VALIDATION_ERROR',
        parsed.error.issues[0]?.message ?? 'Invalid analysis request.',
        400,
        false
      );
      res.status(400).json({ error: err.toPayload() });
      return;
    }

    const controller = attachRequestAbortSignal(req, res);
    try {
      const graph = await handlers.analyzeBeliefGraph(
        parsed.data.prompt,
        parsed.data.mode,
        controller.signal
      );
      res.json({ graph });
    } catch (err) {
      sendErrorResponse(res, err);
    }
  });

  router.post('/narrative/import/extract', async (req, res) => {
    const parsed = NarrativeExtractionRequestSchema.safeParse(req.body);
    if (!parsed.success) {
      const err = new AppApiError('VALIDATION_ERROR', parsed.error.issues[0]?.message ?? 'Invalid narrative import request.', 400, false);
      res.status(400).json({ error: err.toPayload() });
      return;
    }
    const controller = attachRequestAbortSignal(req, res);
    try {
      const handler = handlers.extractNarrativeChunk;
      if (!handler) throw new AppApiError('INTERNAL_ERROR', 'Narrative extraction is unavailable.', 503, false);
      const result = await handler(parsed.data, controller.signal);
      res.json({ extraction: result });
    } catch (err) {
      sendErrorResponse(res, err);
    }
  });

  router.post('/clarify', async (req, res) => {
    const parsed = ClarifyRequestSchema.safeParse(req.body);
    if (!parsed.success) {
      const err = new AppApiError(
        'VALIDATION_ERROR',
        parsed.error.issues[0]?.message ?? 'Invalid clarification request.',
        400,
        false
      );
      res.status(400).json({ error: err.toPayload() });
      return;
    }

    const controller = attachRequestAbortSignal(req, res);
    try {
      const clarifications = await handlers.generateClarificationsList(
        parsed.data.prompt,
        parsed.data.askedQuestions,
        parsed.data.mode,
        controller.signal,
        parsed.data.confirmedFacts
      );
      res.json({ clarifications });
    } catch (err) {
      sendErrorResponse(res, err);
    }
  });

  router.post('/refine', async (req, res) => {
    const parsed = RefineRequestSchema.safeParse(req.body);
    if (!parsed.success) {
      const err = new AppApiError(
        'VALIDATION_ERROR',
        parsed.error.issues[0]?.message ?? 'Invalid prompt refinement request.',
        400,
        false
      );
      res.status(400).json({ error: err.toPayload() });
      return;
    }

    const controller = attachRequestAbortSignal(req, res);
    try {
      const refinedPrompt = await handlers.refinePromptText(
        parsed.data.originalPrompt,
        parsed.data.clarifications,
        parsed.data.graphUpdates,
        controller.signal
      );
      res.json({ refinedPrompt });
    } catch (err) {
      sendErrorResponse(res, err);
    }
  });

  router.post('/batch-edit', async (req, res) => {
    const parsed = BatchEditRequestSchema.safeParse(req.body);
    if (!parsed.success) {
      const err = new AppApiError(
        'VALIDATION_ERROR',
        parsed.error.issues[0]?.message ?? 'Invalid batch-edit request.',
        400,
        false
      );
      res.status(400).json({ error: err.toPayload() });
      return;
    }

    const controller = attachRequestAbortSignal(req, res);
    try {
      const handler = handlers.interpretBatchEditInstruction ?? interpretBatchEditInstruction;
      const result = await handler(
        parsed.data.instruction,
        {
          prompt: parsed.data.prompt,
          entities: parsed.data.entities,
          relationships: parsed.data.relationships,
        },
        controller.signal
      );
      res.json(result);
    } catch (err) {
      sendErrorResponse(res, err);
    }
  });

  router.post('/generate/images', async (req, res) => {
    const parsed = GenerateMediaRequestSchema.safeParse(req.body);
    if (!parsed.success) {
      const err = new AppApiError(
        'VALIDATION_ERROR',
        parsed.error.issues[0]?.message ?? 'Invalid image generation request.',
        400,
        false
      );
      res.status(400).json({ error: err.toPayload() });
      return;
    }

    const controller = attachRequestAbortSignal(req, res);
    try {
      const result = await handlers.generateImagesBatch(
        parsed.data.prompt,
        controller.signal
      );
      res.json(result);
    } catch (err) {
      sendErrorResponse(res, err);
    }
  });

  router.post('/generate/story', async (req, res) => {
    const parsed = GenerateMediaRequestSchema.safeParse(req.body);
    if (!parsed.success) {
      const err = new AppApiError(
        'VALIDATION_ERROR',
        parsed.error.issues[0]?.message ?? 'Invalid story generation request.',
        400,
        false
      );
      res.status(400).json({ error: err.toPayload() });
      return;
    }

    const controller = attachRequestAbortSignal(req, res);
    try {
      const providerContext = getAiProviderRequestContext();
      if (providerContext?.operation === 'story' && providerContext.selection.connectionId === 'chatgpt-plan') {
        const selectedModelId = providerContext.selection.modelId;
        if (!selectedModelId) throw new AppApiError('MODEL_UNSUPPORTED', 'Select a current ChatGPT account model before using the story route.', 422, false);
        const injection = options.chatGptStorySrbTestInjection;
        const authority = injection?.authority ?? defaultChatGptStorySrbAuthority;
        const currentGrantGeneration = injection?.currentGrantGeneration ?? (() => chatGptSessionStore.getGeneration());
        const grantGeneration = currentGrantGeneration();
        const sourceDigest = createHash('sha256')
          .update(`${CHATGPT_STORY_INSTRUCTIONS}\n${parsed.data.prompt}`)
          .digest('hex');
        const plan = authority.prepare({
          modelId: selectedModelId,
          grantGeneration,
          sourceDigest,
          sourceText: parsed.data.prompt,
          instructions: CHATGPT_STORY_INSTRUCTIONS,
        });
        const result = await authority.run({
          plan,
          currentGrantGeneration,
          signal: controller.signal,
          transport: ({ body, limits }, signal) => {
            const adapter = injection?.adapterFactory(grantGeneration) ?? createChatGptAdapter(grantGeneration);
            return adapter.generateStoryText({
              operation: 'story',
              modelId: plan.modelId,
              input: plan.sourceText,
              ...(plan.instructions ? { instructions: plan.instructions } : {}),
              reasoningLevel: 'default',
              maxInputBytes: limits.maxRequestBodyBytes,
              maxOutputBytes: limits.maxAcceptedOutputBytes,
              timeoutMs: limits.timeoutMs,
              signal,
            }, body, {
              maxStreamBytes: limits.maxStreamBytes,
              maxAcceptedOutputBytes: limits.maxAcceptedOutputBytes,
              maxStreamEvents: limits.maxStreamEvents,
            });
          },
        });
        if (result.terminalEvent !== 'response.completed' || result.refusal || !result.text.trim()) {
          throw new AppApiError('INVALID_RESPONSE', 'The ChatGPT story response did not contain accepted completed story text.', 502, false);
        }
        res.json({ story: result.text });
        return;
      }
      const story = await handlers.generateStoryText(
        parsed.data.prompt,
        controller.signal
      );
      res.json({ story });
    } catch (err) {
      sendErrorResponse(res, err);
    }
  });

  router.get('/ai/capabilities', (_req, res) => {
    res.json(getAiCapabilitiesSnapshot(handlers.hasConfiguredGeminiKey()));
  });

  router.post('/narrative/diagnostics/analyze', async (req, res) => {
    const parsed = DiagnosticsAnalyzeRequestSchema.safeParse(req.body);
    if (!parsed.success) {
      const err = new AppApiError('VALIDATION_ERROR', parsed.error.issues[0]?.message ?? 'Invalid diagnostics analysis request.', 400, false);
      res.status(400).json({ error: err.toPayload() });
      return;
    }
    const controller = attachRequestAbortSignal(req, res);
    try {
      const fn = handlers.analyzeSemanticDiagnostics ?? analyzeSemanticDiagnostics;
      res.json(await fn(parsed.data, controller.signal));
    } catch (err) {
      sendErrorResponse(res, err);
    }
  });

  router.post('/narrative/diagnostics/suggest-fixes', async (req, res) => {
    const parsed = DiagnosticsSuggestFixesRequestSchema.safeParse(req.body);
    if (!parsed.success) {
      const err = new AppApiError('VALIDATION_ERROR', parsed.error.issues[0]?.message ?? 'Invalid fix suggestion request.', 400, false);
      res.status(400).json({ error: err.toPayload() });
      return;
    }
    const controller = attachRequestAbortSignal(req, res);
    try {
      const fn = handlers.suggestDiagnosticFixes ?? suggestDiagnosticFixes;
      res.json(await fn(parsed.data, controller.signal));
    } catch (err) {
      sendErrorResponse(res, err);
    }
  });

  router.post('/narrative/sync/analyze', async (req, res) => {
    const parsed = SyncAnalyzeRequestSchema.safeParse(req.body);
    if (!parsed.success) {
      const err = new AppApiError('VALIDATION_ERROR', parsed.error.issues[0]?.message ?? 'Invalid sync analysis request.', 400, false);
      res.status(400).json({ error: err.toPayload() });
      return;
    }
    const controller = attachRequestAbortSignal(req, res);
    try {
      const fn = handlers.analyzeNarrativeSync ?? analyzeNarrativeSync;
      res.json(await fn(parsed.data, controller.signal));
    } catch (err) {
      sendErrorResponse(res, err);
    }
  });

  router.post('/narrative/writing/assist', async (req, res) => {
    const parsed = WritingAssistRequestSchema.safeParse(req.body);
    if (!parsed.success) {
      const err = new AppApiError('VALIDATION_ERROR', parsed.error.issues[0]?.message ?? 'Invalid writing assistant request.', 400, false);
      res.status(400).json({ error: err.toPayload() });
      return;
    }
    const controller = attachRequestAbortSignal(req, res);
    try {
      const fn = handlers.runWritingAssistant ?? runWritingAssistant;
      res.json(await fn(parsed.data, controller.signal));
    } catch (err) {
      sendErrorResponse(res, err);
    }
  });

  router.post('/narrative/opportunities/explore', async (req, res) => {
    const parsed = OpportunitiesExploreRequestSchema.safeParse(req.body);
    if (!parsed.success) {
      const err = new AppApiError('VALIDATION_ERROR', parsed.error.issues[0]?.message ?? 'Invalid opportunity exploration request.', 400, false);
      res.status(400).json({ error: err.toPayload() });
      return;
    }
    const controller = attachRequestAbortSignal(req, res);
    try {
      const fn = handlers.exploreCreativeOpportunities ?? exploreCreativeOpportunities;
      res.json(await fn(parsed.data, controller.signal));
    } catch (err) {
      sendErrorResponse(res, err);
    }
  });

  router.post('/narrative/import/enhance', async (req, res) => {
    const parsed = ImportEnhanceRequestSchema.safeParse(req.body);
    if (!parsed.success) {
      const err = new AppApiError('VALIDATION_ERROR', parsed.error.issues[0]?.message ?? 'Invalid import enhancement request.', 400, false);
      res.status(400).json({ error: err.toPayload() });
      return;
    }
    const controller = attachRequestAbortSignal(req, res);
    try {
      const fn = handlers.proposeImportEnhancements ?? proposeImportEnhancements;
      res.json(await fn(parsed.data, controller.signal));
    } catch (err) {
      sendErrorResponse(res, err);
    }
  });

  return router;
}
