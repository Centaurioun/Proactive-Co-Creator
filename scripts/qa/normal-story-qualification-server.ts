/**
 * Local-only browser qualification host. Its trusted ChatGPT catalog and
 * Responses adapter are in-process mocks; the production entry point never
 * installs either test injection.
 */
import http from 'node:http';
import { createServer as createViteServer } from 'vite';
import { createApp } from '../../server.ts';
import { describeChatGptModel } from '../../server/providers/policy.ts';
import { createChatGptStorySrbAuthority, CHATGPT_STORY_SRB_V1, type ChatGptStoryTransportResult } from '../../server/providers/subscriptionResourceBudget.ts';

const model = describeChatGptModel({ id: 'gpt-6-luna', displayName: 'GPT-6 Luna' });
const observations: Array<{ model: string; requestId: string; reasoning: string; store: boolean; stream: boolean }> = [];
const app = createApp({
  chatGptProviderHubTestInjection: { chatGptStoryQualificationCatalog: [model] },
  chatGptStorySrbTestInjection: {
    authority: createChatGptStorySrbAuthority({ enabled: true }),
    currentGrantGeneration: () => 1,
    adapterFactory: () => ({
      generateStoryText: async (request, approvedBody, limits): Promise<ChatGptStoryTransportResult> => {
        const body = JSON.parse(approvedBody) as Record<string, unknown>;
        observations.push({
          model: String(body.model), requestId: String(request.requestId ?? 'browser-story-action'),
          reasoning: request.reasoningLevel ?? 'default', store: body.store === false, stream: body.stream === true,
        });
        if (body.model !== 'gpt-6-luna' || body.store !== false || body.stream !== true ||
          limits.maxStreamBytes !== CHATGPT_STORY_SRB_V1.maxStreamBytes) throw new Error('Mock received an unqualified story request.');
        return { text: 'Sentetik tarayıcı doğrulama öyküsü.', terminalEvent: 'response.completed', refusal: false, streamBytes: 96, eventCount: 2 };
      },
    }),
  },
});

app.get('/__qa/story-observations', (_req, res) => res.json({ count: observations.length, calls: observations }));
const vite = await createViteServer({ server: { middlewareMode: true, hmr: false }, appType: 'spa' });
app.use(vite.middlewares);
const port = Number(process.env.PORT || 4311);
if (!Number.isInteger(port) || port < 1 || port > 65535) {
  throw new Error(`Invalid PORT value: ${process.env.PORT}`);
}
const server = http.createServer(app);
server.listen(port, '127.0.0.1', () => console.log(`Synthetic Story qualification at http://127.0.0.1:${port}`));
for (const signal of ['SIGINT', 'SIGTERM'] as const) process.on(signal, () => {
  void vite.close().finally(() => {
    server.close(() => process.exit(0));
    server.closeAllConnections?.();
  });
});
