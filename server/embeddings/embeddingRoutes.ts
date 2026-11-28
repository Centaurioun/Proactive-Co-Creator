import { Router, Request, Response } from 'express';
import {
  cloudflareCredentialsInputSchema,
  embeddingBatchRequestSchema,
  embeddingPreferencesUpdateSchema,
  embeddingTestRequestSchema,
  geminiEmbeddingConfigInputSchema,
  lmStudioConfigInputSchema,
} from '../../shared/embeddingSchema';
import { defaultEmbeddingHubRuntime, EmbeddingHubRuntime } from './embeddingRuntime';

export function createEmbeddingRouter(runtime: EmbeddingHubRuntime = defaultEmbeddingHubRuntime): Router {
  const router = Router();

  router.get('/status', (req: Request, res: Response) => {
    const projectId = typeof req.query.projectId === 'string' ? req.query.projectId : undefined;
    res.json(runtime.getStatus(projectId));
  });

  router.put('/preferences', (req: Request, res: Response) => {
    const parsed = embeddingPreferencesUpdateSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.issues[0]?.message || 'Invalid embedding preferences payload.' });
      return;
    }
    const status = runtime.updatePreferences(parsed.data);
    res.json(status);
  });

  router.post('/credentials/cloudflare', (req: Request, res: Response) => {
    const parsed = cloudflareCredentialsInputSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.issues[0]?.message || 'Invalid Cloudflare credentials payload.' });
      return;
    }
    try {
      const status = runtime.configureCloudflare(parsed.data);
      res.json(status);
    } catch (error) {
      res.status(400).json({ error: error instanceof Error ? error.message : 'Failed to configure Cloudflare Workers AI.' });
    }
  });

  router.delete('/credentials/cloudflare', (_req: Request, res: Response) => {
    const status = runtime.clearCloudflareCredentials();
    res.json(status);
  });

  router.post('/config/lm-studio', (req: Request, res: Response) => {
    const parsed = lmStudioConfigInputSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.issues[0]?.message || 'Invalid LM Studio configuration payload.' });
      return;
    }
    try {
      const status = runtime.configureLmStudio(parsed.data);
      res.json(status);
    } catch (error) {
      res.status(400).json({ error: error instanceof Error ? error.message : 'Rejected LM Studio endpoint URL.' });
    }
  });

  router.post('/credentials/gemini', (req: Request, res: Response) => {
    const parsed = geminiEmbeddingConfigInputSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.issues[0]?.message || 'Invalid Gemini Embedding configuration.' });
      return;
    }
    const status = runtime.configureGemini(parsed.data);
    res.json(status);
  });

  router.delete('/credentials/gemini', (_req: Request, res: Response) => {
    const status = runtime.clearGeminiCredentials();
    res.json(status);
  });

  router.post('/test', async (req: Request, res: Response) => {
    const parsed = embeddingTestRequestSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.issues[0]?.message || 'Invalid test connection payload.' });
      return;
    }
    const result = await runtime.testProviderConnection(parsed.data.providerId, parsed.data.sampleText);
    res.status(result.ok ? 200 : 502).json(result);
  });

  router.post('/embed', async (req: Request, res: Response) => {
    const parsed = embeddingBatchRequestSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.issues[0]?.message || 'Invalid embedding batch payload.' });
      return;
    }
    try {
      const result = await runtime.embedBatch(parsed.data);
      res.json(result);
    } catch (error) {
      res.status(400).json({ error: error instanceof Error ? error.message : 'Embedding batch failed.' });
    }
  });

  return router;
}
