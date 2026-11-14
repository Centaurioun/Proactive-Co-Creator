/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import express from 'express';
import type { Request, Response, Router } from 'express';
import {
  AnalyzeRequestSchema,
  ClarifyRequestSchema,
  GenerateMediaRequestSchema,
  RefineRequestSchema,
} from '../shared/schemas.ts';
import type {
  BeliefState,
  Clarification,
  ClarificationAnswer,
  GenerationMode,
  GraphUpdate,
  ImageGenerationResult,
  VideoJobStatusResult,
} from '../shared/types.ts';
import {
  analyzeBeliefGraph,
  cancelVideoGeneration,
  generateClarificationsList,
  generateImagesBatch,
  generateStoryText,
  getVideoGenerationStatus,
  refinePromptText,
  startVideoGeneration,
} from './aiService.ts';
import { AppApiError, classifyGeminiError } from './errors.ts';
import { hasConfiguredGeminiKey } from './geminiClient.ts';
import { GEMINI_MODELS } from './models.ts';
import { videoStore } from './videoStore.ts';

export interface AiServiceHandlers {
  analyzeBeliefGraph: (prompt: string, mode: GenerationMode, signal?: AbortSignal) => Promise<BeliefState>;
  generateClarificationsList: (
    prompt: string,
    askedQuestions: string[],
    mode: GenerationMode,
    signal?: AbortSignal
  ) => Promise<Clarification[]>;
  refinePromptText: (
    originalPrompt: string,
    clarifications: ClarificationAnswer[],
    graphUpdates: GraphUpdate[],
    signal?: AbortSignal
  ) => Promise<string>;
  generateStoryText: (prompt: string, signal?: AbortSignal) => Promise<string>;
  generateImagesBatch: (prompt: string, signal?: AbortSignal) => Promise<ImageGenerationResult>;
  startVideoGeneration: (prompt: string, signal?: AbortSignal) => Promise<VideoJobStatusResult>;
  getVideoGenerationStatus: (interactionId: string, signal?: AbortSignal) => Promise<VideoJobStatusResult>;
  cancelVideoGeneration: (interactionId: string) => Promise<void>;
  hasConfiguredGeminiKey: () => boolean;
}

const defaultHandlers: AiServiceHandlers = {
  analyzeBeliefGraph,
  generateClarificationsList,
  refinePromptText,
  generateStoryText,
  generateImagesBatch,
  startVideoGeneration,
  getVideoGenerationStatus,
  cancelVideoGeneration,
  hasConfiguredGeminiKey,
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

export function createApiRouter(handlers: AiServiceHandlers = defaultHandlers): Router {
  const router = express.Router();

  router.get('/health', (_req, res) => {
    res.json({
      ok: true,
      configured: handlers.hasConfiguredGeminiKey(),
      models: GEMINI_MODELS,
    });
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
        controller.signal
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

  router.post('/generate/video', async (req, res) => {
    const parsed = GenerateMediaRequestSchema.safeParse(req.body);
    if (!parsed.success) {
      const err = new AppApiError(
        'VALIDATION_ERROR',
        parsed.error.issues[0]?.message ?? 'Invalid video generation request.',
        400,
        false
      );
      res.status(400).json({ error: err.toPayload() });
      return;
    }

    const controller = attachRequestAbortSignal(req, res);
    try {
      const result = await handlers.startVideoGeneration(
        parsed.data.prompt,
        controller.signal
      );
      res.json(result);
    } catch (err) {
      sendErrorResponse(res, err);
    }
  });

  router.get('/generate/video/:interactionId', async (req, res) => {
    const interactionId = req.params.interactionId?.trim();
    if (!interactionId || interactionId.length > 200) {
      const err = new AppApiError('VALIDATION_ERROR', 'Invalid interaction ID.', 400, false);
      res.status(400).json({ error: err.toPayload() });
      return;
    }

    const controller = attachRequestAbortSignal(req, res);
    try {
      const result = await handlers.getVideoGenerationStatus(interactionId, controller.signal);
      res.json(result);
    } catch (err) {
      sendErrorResponse(res, err);
    }
  });

  router.post('/generate/video/:interactionId/cancel', async (req, res) => {
    const interactionId = req.params.interactionId?.trim();
    if (!interactionId || interactionId.length > 200) {
      res.status(400).json({
        error: new AppApiError('VALIDATION_ERROR', 'Invalid interaction ID.', 400, false).toPayload(),
      });
      return;
    }

    await handlers.cancelVideoGeneration(interactionId);
    res.json({ cancelled: true });
  });

  router.get('/videos/:videoId', (req, res) => {
    const videoId = req.params.videoId?.trim();
    if (!videoId) {
      res.status(404).json({ error: 'Video not found.' });
      return;
    }

    const entry = videoStore.get(videoId);
    if (!entry) {
      res.status(404).json({ error: 'Video not found or expired.' });
      return;
    }

    res.setHeader('Content-Type', entry.mimeType);
    res.setHeader('Content-Length', entry.buffer.length.toString());
    res.setHeader('Cache-Control', 'private, max-age=1800');
    res.send(entry.buffer);
  });

  return router;
}
