import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import * as promptBuilder from '../lib/promptBuilder.ts';
import { createSampleProject } from '../lib/canonicalModel.ts';
import { analyzePromptToBeliefGraph, generateClarifications } from '../services/apiClient.ts';

test('startup analysis and explanation provider arguments use the safe resolved prompt', async () => {
  const buildInputs = (promptBuilder as typeof promptBuilder & {
    buildStartupAnalysisProviderInputs?: (project: ReturnType<typeof createSampleProject>) =>
      | { ok: true; prompt: string; mode: 'story' | 'image'; askedQuestions: string[]; confirmedFacts: string[] }
      | { ok: false; reason: string };
  }).buildStartupAnalysisProviderInputs;
  assert.equal(typeof buildInputs, 'function', 'startup provider inputs must come from the shared safety boundary');
  if (!buildInputs) return;

  const project = createSampleProject();
  project.snapshot.originalIdea = 'A cartographer crosses a winter sea.';
  const character = project.snapshot.entities.find(entity => entity.category === 'character')!;
  character.attributes.push(
    { id: 'source-explicit', name: 'occupation', presence_in_prompt: true, value: [{ name: 'cartographer' }], confirmedValue: 'cartographer', status: 'confirmed', provenance: 'accepted-suggestion', epistemicKind: 'explicit', sourceBacked: true },
    { id: 'source-belief', name: 'secret', presence_in_prompt: true, value: [{ name: 'the island is alive' }], confirmedValue: 'the island is alive', status: 'confirmed', provenance: 'accepted-suggestion', epistemicKind: 'belief', sourceBacked: true },
  );
  project.snapshot.refinedPrompt = 'Legacy prompt that must not be reused';

  const inputs = buildInputs(project);
  assert.equal(inputs.ok, true);
  if (!inputs.ok) return;
  assert.match(inputs.prompt, /occupation: cartographer/);
  assert.equal(inputs.prompt.includes('the island is alive'), false);

  const calls: Array<{ url: string; body: Record<string, unknown> }> = [];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (input, init) => {
    calls.push({ url: String(input), body: JSON.parse(String(init?.body)) as Record<string, unknown> });
    const payload = String(input).endsWith('/api/analyze')
      ? { graph: { entities: [], relationships: [], prompt: inputs.prompt } }
      : { clarifications: [] };
    return new Response(JSON.stringify(payload), { status: 200, headers: { 'Content-Type': 'application/json' } });
  };
  try {
    await Promise.all([
      analyzePromptToBeliefGraph(inputs.prompt, inputs.mode),
      generateClarifications(inputs.prompt, inputs.askedQuestions, inputs.mode, undefined, inputs.confirmedFacts),
    ]);
  } finally {
    globalThis.fetch = originalFetch;
  }

  assert.deepEqual(calls.map(call => call.url).sort(), ['/api/analyze', '/api/clarify']);
  for (const call of calls) {
    assert.equal(call.body.prompt, inputs.prompt, `${call.url} receives the resolved safe prompt`);
    assert.equal(String(call.body.prompt).includes('the island is alive'), false, `${call.url} excludes the unattributed belief`);
  }
  assert.deepEqual(calls.find(call => call.url.endsWith('/api/clarify'))?.body.confirmedFacts, inputs.confirmedFacts);
  assert.equal(inputs.confirmedFacts.some(fact => fact.includes('the island is alive')), false);
});

test('unknown legacy startup context stops affected provider calls without disabling an unrelated AI operation', async () => {
  const buildInputs = (promptBuilder as typeof promptBuilder & {
    buildStartupAnalysisProviderInputs?: (project: ReturnType<typeof createSampleProject>) =>
      | { ok: true; prompt: string; mode: 'story' | 'image'; askedQuestions: string[]; confirmedFacts: string[] }
      | { ok: false; reason: string };
  }).buildStartupAnalysisProviderInputs;
  assert.equal(typeof buildInputs, 'function');
  if (!buildInputs) return;

  const legacy = createSampleProject();
  const character = legacy.snapshot.entities.find(entity => entity.category === 'character')!;
  character.attributes.push({
    id: 'legacy-unknown-claim', name: 'secret', value: [{ name: 'PALER COMET' }], confirmedValue: 'PALER COMET',
    status: 'confirmed', provenance: 'accepted-suggestion', sourceBacked: true, presence_in_prompt: true,
  });
  const blocked = buildInputs(legacy);
  assert.equal(blocked.ok, false, 'unknown source-backed legacy context fails closed for startup prompts');
  if (blocked.ok) return;

  // Characterize the real App handler's operation-local guard: it returns before either provider wrapper.
  const app = readFileSync(new URL('../App.tsx', import.meta.url), 'utf8');
  const start = app.indexOf('const handleAnalyzeIdea = useCallback(async () => {');
  const end = app.indexOf('\n  const handle', start + 1);
  assert.notEqual(start, -1, 'the actual startup handler must exist');
  assert.notEqual(end, -1, 'the startup handler must have a bounded source span');
  const handler = app.slice(start, end);
  const failClosedGuard = handler.indexOf('if (!providerInputs.ok)');
  const analyzeCall = handler.indexOf('analyzePromptToBeliefGraph(');
  const clarificationCall = handler.indexOf('generateClarifications(');
  assert.ok(failClosedGuard >= 0 && failClosedGuard < analyzeCall && failClosedGuard < clarificationCall,
    'the actual App handler checks the blocked decision before both provider call sites');
  assert.match(handler.slice(failClosedGuard, analyzeCall), /return;/,
    'the blocked path returns without dispatching analysis');

  const calls: string[] = [];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async input => {
    calls.push(String(input));
    return new Response(JSON.stringify({ clarifications: [] }), { status: 200, headers: { 'Content-Type': 'application/json' } });
  };
  try {
    // The guarded startup operation above has no dispatch; an independent, safe clarification operation remains usable.
    const unrelated = buildInputs(createSampleProject());
    assert.equal(unrelated.ok, true, 'safe projects are not globally denied provider access');
    await generateClarifications('Suggest one question for a separate safe draft.', [], 'story', undefined, []);
  } finally {
    globalThis.fetch = originalFetch;
  }
  assert.deepEqual(calls, ['/api/clarify'], 'only the unrelated operation reaches a provider wrapper');
  assert.equal(legacy.snapshot.entities.find(entity => entity.id === character.id)?.attributes.at(-1)?.confirmedValue, 'PALER COMET',
    'prompt gating leaves persisted legacy content untouched');
});
