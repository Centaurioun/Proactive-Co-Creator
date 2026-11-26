import assert from 'node:assert/strict';
import test from 'node:test';
import {
  CHATGPT_STORY_SRB_ENABLED_BY_DEFAULT,
  CHATGPT_STORY_SRB_V1,
  createChatGptStorySrbAuthority,
  type ChatGptStoryPlanInput,
  type ChatGptStoryTransportResult,
} from '../server/providers/subscriptionResourceBudget.ts';

const goodResult: ChatGptStoryTransportResult = {
  text: 'A reviewed draft.', terminalEvent: 'response.completed', refusal: false, streamBytes: 1024, eventCount: 4,
};
const planInput: ChatGptStoryPlanInput = {
  modelId: 'gpt-6.2-sol', grantGeneration: 7, sourceDigest: 'source-sha256', sourceText: 'A short story brief.',
};

test('story SRB v1 is disabled by default and a disabled authority rejects preparation', () => {
  assert.equal(CHATGPT_STORY_SRB_ENABLED_BY_DEFAULT, false);
  assert.throws(() => createChatGptStorySrbAuthority().prepare(planInput), /not activated/);
});

test('story SRB plan pins exact model, grant, source and policy and omits unsupported fields', () => {
  const authority = createChatGptStorySrbAuthority({ enabled: true, makeId: () => 'plan-1', now: () => 100 });
  const plan = authority.prepare(planInput);
  const body = JSON.parse(plan.requestBody) as Record<string, unknown>;
  assert.equal(plan.operation, 'story');
  assert.equal(plan.modelId, planInput.modelId);
  assert.equal(plan.grantGeneration, planInput.grantGeneration);
  assert.equal(plan.sourceDigest, planInput.sourceDigest);
  assert.equal(plan.policyVersion, CHATGPT_STORY_SRB_V1.version);
  assert.equal(body.store, false);
  assert.equal(body.stream, true);
  assert.equal(body.reasoning, undefined);
  assert.equal(body.max_output_tokens, undefined);
  assert.ok(plan.requestBodyBytes <= CHATGPT_STORY_SRB_V1.maxRequestBodyBytes);
});

test('story SRB enforces source, whole serialized body, and conservative input estimate limits', () => {
  const authority = createChatGptStorySrbAuthority({ enabled: true });
  assert.throws(() => authority.prepare({ ...planInput, sourceText: 'x'.repeat(8_001) }), /8,000-character/);
  assert.throws(() => authority.prepare({ ...planInput, instructions: 'x'.repeat(32 * 1024) }), /serialized.*32 KiB/);
  assert.throws(() => authority.prepare({ ...planInput, instructions: 'x'.repeat(16_001) }), /estimate exceeds 4,000/);
});

test('story SRB enforces accepted output, SSE bytes, event count and terminal completion', async () => {
  const run = async (response: ChatGptStoryTransportResult) => {
    const authority = createChatGptStorySrbAuthority({ enabled: true });
    const plan = authority.prepare(planInput);
    return authority.run({ plan, currentGrantGeneration: () => 7, transport: async () => response });
  };
  assert.equal((await run({ ...goodResult, text: 'x'.repeat(16 * 1024) })).text.length, 16 * 1024);
  await assert.rejects(run({ ...goodResult, text: 'x'.repeat(16 * 1024 + 1) }), /exceeded an SRB/);
  await assert.rejects(run({ ...goodResult, streamBytes: 256 * 1024 + 1 }), /exceeded an SRB/);
  await assert.rejects(run({ ...goodResult, eventCount: 4_097 }), /exceeded an SRB/);
  await assert.rejects(run({ ...goodResult, terminalEvent: 'response.incomplete' }), /did not complete/);
  await assert.rejects(run({ ...goodResult, refusal: true }), /did not complete/);
});

test('story SRB reserves one attempt before transport and rejects replay, including after transport failure', async () => {
  const authority = createChatGptStorySrbAuthority({ enabled: true });
  const plan = authority.prepare(planInput);
  await assert.rejects(authority.run({ plan, currentGrantGeneration: () => 7, transport: async () => { throw new Error('network uncertainty'); } }), /network uncertainty/);
  await assert.rejects(authority.run({ plan, currentGrantGeneration: () => 7, transport: async () => goodResult }), /already used its one inference attempt/);
});

test('story SRB uses process-wide single-flight and two-attempt rate limits across plan IDs', async () => {
  let now = 1_000;
  let release: (() => void) | undefined;
  const authority = createChatGptStorySrbAuthority({ enabled: true, now: () => now, makeId: (() => { let i = 0; return () => `p-${++i}`; })() });
  const first = authority.prepare(planInput);
  const firstRun = authority.run({ plan: first, currentGrantGeneration: () => 7, transport: () => new Promise(resolve => { release = () => resolve(goodResult); }) });
  await assert.rejects(authority.run({ plan: authority.prepare(planInput), currentGrantGeneration: () => 7, transport: async () => goodResult }), /already in progress/);
  release?.();
  await firstRun;
  const second = authority.prepare(planInput);
  await authority.run({ plan: second, currentGrantGeneration: () => 7, transport: async () => goodResult });
  await assert.rejects(authority.run({ plan: authority.prepare(planInput), currentGrantGeneration: () => 7, transport: async () => goodResult }), /two-attempts-per-minute/);
  now += 60_000;
  await authority.run({ plan: authority.prepare(planInput), currentGrantGeneration: () => 7, transport: async () => goodResult });
});

test('story SRB aborts authority even if transport ignores abort and discards a stale grant result', async () => {
  const authority = createChatGptStorySrbAuthority({ enabled: true });
  const plan = authority.prepare(planInput);
  const controller = new AbortController();
  const pending = authority.run({
    plan, currentGrantGeneration: () => 7, signal: controller.signal,
    transport: () => new Promise(resolve => setTimeout(() => resolve(goodResult), 15)),
  });
  controller.abort();
  await assert.rejects(pending, /cancelled/);

  const stale = authority.prepare(planInput);
  await assert.rejects(authority.run({ plan: stale, currentGrantGeneration: () => 8, transport: async () => goodResult }), /session changed/);
});
