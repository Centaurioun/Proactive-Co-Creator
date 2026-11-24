import { afterEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import express from 'express';
import { AppApiError } from '../server/errors.ts';
import { createApiRouter, type AiServiceHandlers } from '../server/routes.ts';
import type { BeliefState } from '../shared/types.ts';

function createStubHandlers(overrides: Partial<AiServiceHandlers> = {}): AiServiceHandlers {
  const sampleGraph: BeliefState = {
    prompt: 'a cat hosting a party',
    entities: [
      {
        name: 'The Story',
        presence_in_prompt: false,
        description: 'Scene attributes',
        alternatives: null,
        attributes: [
          { name: 'existence', presence_in_prompt: false, value: [{ name: 'true' }, { name: 'false' }] },
          { name: 'lighting', presence_in_prompt: false, value: [{ name: 'warm' }, { name: 'neon' }] },
        ],
      },
      {
        name: 'Cat',
        presence_in_prompt: true,
        description: 'Party host',
        alternatives: [{ name: 'Tabby' }],
        attributes: [
          { name: 'existence', presence_in_prompt: true, value: [{ name: 'true' }, { name: 'false' }] },
          { name: 'color', presence_in_prompt: false, value: [{ name: 'orange' }, { name: 'black' }] },
        ],
      },
    ],
    relationships: [],
  };

  return {
    analyzeBeliefGraph: async () => sampleGraph,
    generateClarificationsList: async () => [
      { question: 'What is the theme?', options: ['Birthday', 'Garden', 'Tea'] },
    ],
    refinePromptText: async (orig) => `${orig}, warm lighting`,
    interpretBatchEditInstruction: async (instruction) => ({
      instruction,
      warnings: [],
      ambiguities: [],
      operations: [
        {
          id: 'op_1',
          type: 'update_story_bible',
          summary: 'Set tone to mysterious',
          storyField: 'tone',
          nextValue: 'mysterious',
          selected: true,
        },
      ],
    }),
    generateStoryText: async () => 'Once upon a time, a cat threw a party.',
    generateImagesBatch: async () => ({
      images: ['data:image/png;base64,AAA', 'data:image/png;base64,BBB'],
      requestedCount: 4,
      failedCount: 2,
      warning: '2 of 4 images succeeded',
    }),
    hasConfiguredGeminiKey: () => false,
    ...overrides,
  };
}

async function startTestServer(handlers: AiServiceHandlers) {
  const app = express();
  app.use(express.json());
  app.use('/api', createApiRouter(handlers));
  const server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (!address || typeof address === 'string') {
    throw new Error('Failed to bind test server');
  }
  return {
    baseUrl: `http://127.0.0.1:${address.port}`,
    close: () => new Promise<void>((resolve, reject) => server.close((e) => (e ? reject(e) : resolve()))),
  };
}

describe('server/routes API contract', () => {
  let closeServer: (() => Promise<void>) | null = null;

  afterEach(async () => {
    if (closeServer) {
      await closeServer();
      closeServer = null;
    }
  });

  it('serves /api/health without exposing secrets or removed video model', async () => {
    const srv = await startTestServer(createStubHandlers());
    closeServer = srv.close;

    const res = await fetch(`${srv.baseUrl}/api/health`);
    assert.equal(res.status, 200);
    const body = (await res.json()) as { ok: boolean; configured: boolean; models: Record<string, string> };
    assert.equal(body.ok, true);
    assert.equal(body.configured, false);
    assert.equal(body.models.text, 'gemini-4-hydrogen');
    assert.equal(body.models.image, 'gemini-3.1-flash-lite-image');
    assert.equal('video' in body.models, false);
  });

  it('validates narrative import extraction requests and returns only the mocked scoped result', async () => {
    let observedText = '';
    let observedScope = '';
    let handlerCalls = 0;
    const srv = await startTestServer(createStubHandlers({
      extractNarrativeChunk: async request => {
        handlerCalls += 1;
        observedText = request.text;
        observedScope = request.scope;
        return { findings: [{ id: 'other-1', title: 'Unclassified', value: 'Kept for review', category: 'other', kind: 'reported', rationale: 'No reporter attributed.', evidence: { sourceId: 's', version: 'v1', digest: 'd', start: 0, end: 1, excerpt: 'A' } }], entities: [], relationships: [], ambiguities: [] } as never;
      },
    }));
    closeServer = srv.close;
    const bad = await fetch(`${srv.baseUrl}/api/narrative/import/extract`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sourceId: 's', sourceVersion: 'v1', digest: 'd', chunkId: 'c', text: 'narrative', scope: 'selective', categories: [] }),
    });
    assert.equal(bad.status, 400);
    for (const invalid of [
      { sourceId: 's', sourceVersion: 'v1', digest: 'd', chunkId: 'c', text: '', scope: 'complete', categories: [] },
      { sourceId: 's', sourceVersion: 'v1', digest: 'd', chunkId: 'c', text: 'narrative', scope: 'selective', categories: ['not-a-category'] },
      { sourceId: 's', sourceVersion: 'v1', digest: 'd', chunkId: 'c', text: 'narrative', scope: 'complete', categories: [], unexpected: true },
      { sourceId: 's', sourceVersion: 'v1', digest: 'd', chunkId: 'c', text: 'x'.repeat(36_001), scope: 'complete', categories: [] },
    ]) {
      const response = await fetch(`${srv.baseUrl}/api/narrative/import/extract`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(invalid),
      });
      assert.equal(response.status, 400);
      const payload = await response.json() as { error?: { code?: string } };
      assert.equal(payload.error?.code, 'VALIDATION_ERROR');
    }
    const good = await fetch(`${srv.baseUrl}/api/narrative/import/extract`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sourceId: 's', sourceVersion: 'v1', digest: 'd', chunkId: 'c', text: 'Ada enters.', scope: 'complete', categories: [], instruction: 'Keep it faithful.' }),
    });
    assert.equal(good.status, 200);
    assert.equal(observedText, 'Ada enters.');
    assert.equal(observedScope, 'complete');
    const result = await good.json() as { extraction: { findings: Array<{ category: string }> } };
    assert.equal(result.extraction.findings[0].category, 'other', 'complete-scope route returns retained unclassified findings');
    assert.equal(handlerCalls, 1, 'invalid requests must not reach the extraction handler');
  });

  it('passes client disconnect cancellation to the narrative extraction handler', async () => {
    let startedResolve: (() => void) | undefined;
    let abortedResolve: (() => void) | undefined;
    const started = new Promise<void>(resolve => { startedResolve = resolve; });
    const aborted = new Promise<void>(resolve => { abortedResolve = resolve; });
    const srv = await startTestServer(createStubHandlers({
      extractNarrativeChunk: async (_request, signal) => {
        startedResolve?.();
        return await new Promise(resolve => {
          const onAbort = () => {
            abortedResolve?.();
            resolve({ findings: [], entities: [], relationships: [], ambiguities: [] });
          };
          if (signal?.aborted) onAbort();
          else signal?.addEventListener('abort', onAbort, { once: true });
        });
      },
    }));
    closeServer = srv.close;
    const controller = new AbortController();
    const request = fetch(`${srv.baseUrl}/api/narrative/import/extract`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, signal: controller.signal,
      body: JSON.stringify({ sourceId: 's', sourceVersion: 'v1', digest: 'd', chunkId: 'c', text: 'Ada enters.', scope: 'complete', categories: [] }),
    });
    await started;
    controller.abort();
    await assert.rejects(request, /abort/i);
    let timeout: ReturnType<typeof setTimeout> | undefined;
    await Promise.race([aborted, new Promise<never>((_, reject) => { timeout = setTimeout(() => reject(new Error('server handler did not receive abort')), 1000); })]);
    if (timeout) clearTimeout(timeout);
  });

  it('returns a structured safe error when narrative extraction fails', async () => {
    const srv = await startTestServer(createStubHandlers({
      extractNarrativeChunk: async () => { throw new Error('provider token do-not-expose-test-secret'); },
    }));
    closeServer = srv.close;
    const response = await fetch(`${srv.baseUrl}/api/narrative/import/extract`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sourceId: 's', sourceVersion: 'v1', digest: 'd', chunkId: 'c', text: 'Ada enters.', scope: 'complete', categories: [] }),
    });
    assert.equal(response.status, 500);
    const payload = await response.json() as { error?: { code?: string; message?: string } };
    assert.equal(payload.error?.code, 'INTERNAL_ERROR');
    assert.equal(payload.error?.message, 'An unexpected error occurred while communicating with Gemini.');
    assert.equal(JSON.stringify(payload).includes('do-not-expose-test-secret'), false);
  });

  it('handles /api/analyze, /api/clarify, /api/refine, and /api/batch-edit validation and success', async () => {
    let observedAbortedSignal: boolean | undefined;
    const srv = await startTestServer(
      createStubHandlers({
        analyzeBeliefGraph: async (_prompt, _mode, signal) => {
          await new Promise((r) => setTimeout(r, 15));
          observedAbortedSignal = signal?.aborted;
          return createStubHandlers().analyzeBeliefGraph(_prompt, _mode, signal);
        },
      })
    );
    closeServer = srv.close;

    const badAnalyze = await fetch(`${srv.baseUrl}/api/analyze`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ prompt: '   ', mode: 'image' }),
    });
    assert.equal(badAnalyze.status, 400);

    const videoModeAnalyze = await fetch(`${srv.baseUrl}/api/analyze`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ prompt: 'a cat hosting a party', mode: 'video' }),
    });
    assert.equal(videoModeAnalyze.status, 400);

    const okAnalyze = await fetch(`${srv.baseUrl}/api/analyze`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ prompt: 'a cat hosting a party', mode: 'story' }),
    });
    assert.equal(okAnalyze.status, 200);
    assert.equal(observedAbortedSignal, false);
    const analyzeJson = (await okAnalyze.json()) as { graph: BeliefState };
    assert.equal(analyzeJson.graph.entities.length, 2);

    const okClarify = await fetch(`${srv.baseUrl}/api/clarify`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ prompt: 'a cat', askedQuestions: ['Old?'], mode: 'story' }),
    });
    assert.equal(okClarify.status, 200);
    const clarifyJson = (await okClarify.json()) as { clarifications: Array<{ question: string }> };
    assert.equal(clarifyJson.clarifications.length, 1);

    const okRefine = await fetch(`${srv.baseUrl}/api/refine`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        originalPrompt: 'a cat',
        clarifications: [{ question: 'Theme?', answer: 'Garden' }],
        graphUpdates: [{ type: 'attribute', entity: 'Cat', attribute: 'existence', value: 'false' }],
      }),
    });
    assert.equal(okRefine.status, 200);
    const refineJson = (await okRefine.json()) as { refinedPrompt: string };
    assert.equal(refineJson.refinedPrompt, 'a cat, warm lighting');

    const okBatch = await fetch(`${srv.baseUrl}/api/batch-edit`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        instruction: 'Make the party mysterious',
        prompt: 'a cat hosting a party',
        mode: 'story',
      }),
    });
    assert.equal(okBatch.status, 200);
    const batchJson = (await okBatch.json()) as { operations: Array<{ storyField?: string }> };
    assert.equal(batchJson.operations.length, 1);
    assert.equal(batchJson.operations[0].storyField, 'tone');
  });

  it('handles /api/generate/images and /api/generate/story and returns 404 for removed video routes', async () => {
    const srv = await startTestServer(createStubHandlers());
    closeServer = srv.close;

    const imgRes = await fetch(`${srv.baseUrl}/api/generate/images`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ prompt: 'a cat' }),
    });
    assert.equal(imgRes.status, 200);
    const imgJson = (await imgRes.json()) as { images: string[]; failedCount: number; warning: string | null };
    assert.equal(imgJson.images.length, 2);
    assert.equal(imgJson.failedCount, 2);
    assert.match(imgJson.warning ?? '', /2 of 4/);

    const storyRes = await fetch(`${srv.baseUrl}/api/generate/story`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ prompt: 'a cat' }),
    });
    assert.equal(storyRes.status, 200);
    const storyJson = (await storyRes.json()) as { story: string };
    assert.match(storyJson.story, /cat threw a party/);

    const removedVideoStart = await fetch(`${srv.baseUrl}/api/generate/video`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ prompt: 'a cat dancing' }),
    });
    assert.equal(removedVideoStart.status, 404);

    const removedVideoPoll = await fetch(`${srv.baseUrl}/api/generate/video/int-123`);
    assert.equal(removedVideoPoll.status, 404);

    const removedVideoStream = await fetch(`${srv.baseUrl}/api/videos/vid-1`);
    assert.equal(removedVideoStream.status, 404);
  });

  it('returns structured MISSING_API_KEY error without leaking secrets', async () => {
    const srv = await startTestServer(
      createStubHandlers({
        analyzeBeliefGraph: async () => {
          throw new AppApiError(
            'MISSING_API_KEY',
            'GEMINI_API_KEY is not configured on the server.',
            503,
            false
          );
        },
      })
    );
    closeServer = srv.close;

    const res = await fetch(`${srv.baseUrl}/api/analyze`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ prompt: 'a cat', mode: 'image' }),
    });
    assert.equal(res.status, 503);
    const json = (await res.json()) as { error: { code: string; message: string; retryable: boolean } };
    assert.equal(json.error.code, 'MISSING_API_KEY');
    assert.equal(json.error.retryable, false);
  });
});
