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
