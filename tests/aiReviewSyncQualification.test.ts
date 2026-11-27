import test from 'node:test';
import assert from 'node:assert/strict';
import { ChatGptResponsesAdapter } from '../server/providers/chatgptResponses.ts';
import { createLegacyAiClient } from '../server/providers/runtime.ts';
import { runWithAiProviderContext } from '../server/providers/requestContext.ts';
import {
  analyzeNarrativeSync,
  analyzeSemanticDiagnostics,
  suggestDiagnosticFixes,
  type NarrativeAiClientLike,
} from '../server/narrative/narrativeAiService.ts';
import { AI_OPERATION_POLICIES } from '../server/aiBudget.ts';

const selection = { connectionId: 'openai-api' as const, modelId: 'gpt-6.2-sol' };

function sse(text: string): Response {
  const events = [
    { type: 'response.created', response: { id: 'synthetic-response' } },
    { type: 'response.output_text.delta', delta: text },
    { type: 'response.completed', response: { usage: { input_tokens: 32, output_tokens: 18 } } },
  ];
  return new Response(events.map(event => `event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`).join(''), {
    headers: { 'content-type': 'text/event-stream' },
  });
}

function createSyntheticOpenAiClient(responses: readonly unknown[]) {
  const requests: Array<{ url: string; body: Record<string, unknown>; transport: 'input-tokens' | 'responses' }> = [];
  let generationIndex = 0;
  const adapter = new ChatGptResponsesAdapter('synthetic-openai-key-ai04', async (input, init) => {
    const url = String(input);
    const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
    if (url === 'https://api.openai.com/v1/responses/input_tokens') {
      requests.push({ url, body, transport: 'input-tokens' });
      return Response.json({ object: 'response.input_tokens', input_tokens: 96 });
    }
    if (url === 'https://api.openai.com/v1/responses') {
      requests.push({ url, body, transport: 'responses' });
      const value = responses[generationIndex++];
      if (value === undefined) throw new Error('Unexpected synthetic generation attempt.');
      return sse(JSON.stringify(value));
    }
    throw new Error(`Unexpected synthetic provider URL: ${url}`);
  }, undefined, 'openai-api');
  const clientFor = (operation: 'diagnostics' | 'sync') => createLegacyAiClient(selection, operation, undefined, () => {
    throw new Error('The managed Gemini client must not be used.');
  }, () => adapter) as NarrativeAiClientLike;
  return { clientFor, requests, generationCount: () => generationIndex };
}

test('AI-04 synthetic OpenAI transport qualifies diagnostics, fixes, and both sync directions', async () => {
  const syntheticResponses = [
    {
      findings: [{
        title: 'Lantern timeline needs review', description: 'The passage may place the lantern before it is introduced.',
        category: 'timeline', severity: 'warning', certainty: 'possible', targetKind: 'section',
        sectionId: 'scene-1', evidenceQuote: 'At dawn Mara raised the lantern.', suggestedAction: 'Review the order of events.',
      }],
      coverageNote: 'One synthetic scene checked.',
    },
    {
      alternatives: [{
        id: 'fix-1', title: 'Make the sequence explicit', reason: 'Clarifies event order.', assumptions: [],
        evidenceSummary: 'Scene 1', affectedScope: 'Scene 1', kind: 'manual_guidance',
        beforeText: 'At dawn Mara raised the lantern.', afterText: 'Review the sequence before revising.',
      }],
    },
    {
      direction: 'manuscript-to-model',
      modelProposals: [{
        id: 'model-1', kind: 'add_entity', title: 'Review Mara as a character', rationale: 'Mara is named in the scene.',
        evidenceQuote: 'Mara raised the lantern.', entityName: 'Mara', entityCategory: 'character',
        proposedValue: 'A traveler carrying a lantern.', isAssumption: false,
      }],
      manuscriptPatches: [], coverageNote: 'One synthetic scene checked.',
    },
    {
      direction: 'model-to-manuscript', modelProposals: [],
      manuscriptPatches: [{
        id: 'patch-1', sectionId: 'scene-1', sectionTitle: 'Scene 1', rationale: 'Reflects the confirmed model fact.',
        linkedModelChange: 'Confirmed lantern detail', originalExcerpt: 'raised the lantern',
        proposedExcerpt: 'lifted the silver lantern',
      }],
      coverageNote: 'One synthetic scene checked.',
    },
  ];
  const synthetic = createSyntheticOpenAiClient(syntheticResponses);
  const base = {
    projectId: 'ai04-synthetic-project', baseRevision: 3,
    entities: [], relationships: [], storyBible: {},
    sections: [{ id: 'scene-1', kind: 'scene' as const, title: 'Scene 1', text: 'At dawn Mara raised the lantern.' }],
  };
  const context = (operation: 'diagnostics' | 'sync') => ({ selection, operation });
  const diagnosticsClient = synthetic.clientFor('diagnostics');
  const syncClient = synthetic.clientFor('sync');

  const diagnostics = await runWithAiProviderContext(context('diagnostics'), () =>
    analyzeSemanticDiagnostics({ ...base, scope: 'scene', scopeTargetId: 'scene-1' }, undefined, diagnosticsClient));
  assert.equal(diagnostics.findings[0]?.evidenceQuote, 'At dawn Mara raised the lantern.');
  assert.match(diagnostics.coverageNote, /synthetic scene/);

  const fixes = await runWithAiProviderContext(context('diagnostics'), () =>
    suggestDiagnosticFixes({
      projectId: base.projectId, baseRevision: base.baseRevision,
      issue: { id: 'issue-1', title: diagnostics.findings[0]!.title, description: diagnostics.findings[0]!.description, sectionId: 'scene-1' },
      entities: [], relationships: [], storyBible: {}, sections: base.sections,
    }, undefined, diagnosticsClient));
  assert.equal(fixes.alternatives[0]?.kind, 'manual_guidance');

  const manuscriptToModel = await runWithAiProviderContext(context('sync'), () =>
    analyzeNarrativeSync({ ...base, direction: 'manuscript-to-model' }, undefined, syncClient));
  assert.equal(manuscriptToModel.modelProposals[0]?.kind, 'add_entity');
  assert.equal(manuscriptToModel.manuscriptPatches.length, 0);

  const modelToManuscript = await runWithAiProviderContext(context('sync'), () =>
    analyzeNarrativeSync({ ...base, direction: 'model-to-manuscript' }, undefined, syncClient));
  assert.equal(modelToManuscript.modelProposals.length, 0);
  assert.equal(modelToManuscript.manuscriptPatches[0]?.originalExcerpt, 'raised the lantern');

  assert.equal(synthetic.generationCount(), 4, 'one generation attempt per explicit user operation');
  assert.equal(synthetic.requests.length, 8, 'each operation performs one exact token preflight and one generation request');
  assert.deepEqual(
    synthetic.requests.reduce((counts, request) => ({ ...counts, [request.transport]: counts[request.transport] + 1 }), { 'input-tokens': 0, responses: 0 }),
    { 'input-tokens': 4, responses: 4 },
  );
  assert.ok(synthetic.requests.every(request => request.url.startsWith('https://api.openai.com/v1/')));
  assert.ok(synthetic.requests.filter(request => request.transport === 'responses').every(request => request.body.store === false));
  assert.deepEqual(
    synthetic.requests.filter(request => request.transport === 'responses').map(request => request.body.max_output_tokens),
    [AI_OPERATION_POLICIES.diagnostics.maxOutputTokens, AI_OPERATION_POLICIES.diagnostics.maxOutputTokens,
      AI_OPERATION_POLICIES.sync.maxOutputTokens, AI_OPERATION_POLICIES.sync.maxOutputTokens],
    'diagnostics and synchronization retain their existing distinct operation caps',
  );
});
