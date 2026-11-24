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
import { extractNarrativeChunk } from './narrative/extractionService.ts';

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
}

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
      const story = await handlers.generateStoryText(
        parsed.data.prompt,
        controller.signal
      );
      res.json({ story });
    } catch (err) {
      sendErrorResponse(res, err);
    }
  });

  return router;
}
