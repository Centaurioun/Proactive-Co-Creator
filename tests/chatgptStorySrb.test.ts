import assert from 'node:assert/strict';
import test from 'node:test';
import {
  CHATGPT_STORY_SRB_ENABLED_BY_DEFAULT,
  CHATGPT_STORY_SRB_V1,
  createChatGptStorySrbAuthority,
  type ChatGptStoryPlanInput,
  type ChatGptStoryTransportResult,
} from '../server/providers/subscriptionResourceBudget.ts';
import { ChatGptResponsesAdapter } from '../server/providers/chatgptResponses.ts';
import { AppApiError } from '../server/errors.ts';

const goodResult: ChatGptStoryTransportResult = {
  text: 'A reviewed draft.', terminalEvent: 'response.completed', refusal: false, streamBytes: 1024, eventCount: 4,
};
const planInput: ChatGptStoryPlanInput = {
  requestId: 'test-story-request-0001', modelId: 'gpt-6.2-sol', grantGeneration: 7, sourceDigest: 'source-sha256', sourceText: 'A short story brief.',
};
let requestSequence = 0;
const nextPlanInput = (): ChatGptStoryPlanInput => ({ ...planInput, requestId: `test-story-request-${String(++requestSequence).padStart(4, '0')}` });

test('story SRB v1 is disabled by default and a disabled authority rejects preparation', () => {
  assert.equal(CHATGPT_STORY_SRB_ENABLED_BY_DEFAULT, false);
  assert.throws(() => createChatGptStorySrbAuthority().prepare(planInput), /not activated/);
});

test('story SRB plan pins exact model, grant, source and policy and omits unsupported fields', () => {
  const authority = createChatGptStorySrbAuthority({ enabled: true, makeId: () => 'plan-1', now: () => 100 });
  const plan = authority.prepare(nextPlanInput());
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
    const plan = authority.prepare(nextPlanInput());
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
  const plan = authority.prepare(nextPlanInput());
  await assert.rejects(authority.run({ plan, currentGrantGeneration: () => 7, transport: async () => { throw new Error('network uncertainty'); } }), /network uncertainty/);
  await assert.rejects(authority.run({ plan, currentGrantGeneration: () => 7, transport: async () => goodResult }), /already used its one inference attempt/);
});

test('story SRB binds one explicit request identity to its approved payload and rejects HTTP replay before transport', async () => {
  const authority = createChatGptStorySrbAuthority({ enabled: true });
  const plan = authority.prepare(planInput);
  let transportCalls = 0;
  await authority.run({ plan, currentGrantGeneration: () => 7, transport: async () => { transportCalls += 1; return goodResult; } });
  assert.throws(() => authority.prepare(planInput), /already admitted/);
  assert.throws(() => authority.prepare({ ...planInput, sourceText: 'Different approved prompt.' }), /different approved payload/);
  assert.equal(transportCalls, 1);
});

test('subscription quota error blocks new admission until explicit recovery and never retries automatically', async () => {
  const authority = createChatGptStorySrbAuthority({ enabled: true });
  const plan = authority.prepare(nextPlanInput());
  let transportCalls = 0;
  await assert.rejects(authority.run({ plan, currentGrantGeneration: () => 7, transport: async () => {
    transportCalls += 1;
    throw new AppApiError('RATE_LIMITED', 'Synthetic subscription quota exhausted.', 429, false);
  } }), /Synthetic subscription quota exhausted/);
  assert.throws(() => authority.prepare(nextPlanInput()), /explicit recovery decision/);
  assert.equal(transportCalls, 1);
  authority.recoverQuotaBlock();
  await authority.run({ plan: authority.prepare(nextPlanInput()), currentGrantGeneration: () => 7, transport: async () => {
    transportCalls += 1;
    return goodResult;
  } });
  assert.equal(transportCalls, 2);
});

test('a real SSE response.failed SIWC quota event flows through the Responses adapter and blocks the next SRB admission', async () => {
  for (const [index, code] of ['subscription_sharing_usage_limit_exceeded', 'subscription_sharing_usage_unavailable'].entries()) {
    let providerCalls = 0;
    const adapter = new ChatGptResponsesAdapter('local-token', async () => {
      providerCalls += 1;
      return new Response([
        'event: response.failed',
        `data: {"type":"response.failed","response":{"error":{"code":"${code}","request_id":"req_quota_test_${index}"}}}`,
        '', '',
      ].join('\n'), { headers: { 'content-type': 'text/event-stream' } });
    });
    const authority = createChatGptStorySrbAuthority({ enabled: true });
    const plan = authority.prepare(nextPlanInput());
    const transport = (args: { body: string; limits: typeof CHATGPT_STORY_SRB_V1 }, signal: AbortSignal) =>
      adapter.generateStoryText({
        operation: 'story', modelId: plan.modelId, input: plan.sourceText, reasoningLevel: 'default',
        maxInputBytes: args.limits.maxRequestBodyBytes, maxOutputBytes: args.limits.maxAcceptedOutputBytes,
        timeoutMs: args.limits.timeoutMs, signal,
      }, args.body, {
        maxStreamBytes: args.limits.maxStreamBytes,
        maxAcceptedOutputBytes: args.limits.maxAcceptedOutputBytes,
        maxStreamEvents: args.limits.maxStreamEvents,
      });

    await assert.rejects(authority.run({ plan, currentGrantGeneration: () => 7, transport }), (error: unknown) => {
      assert.ok(error instanceof AppApiError);
      assert.equal(error.code, 'RATE_LIMITED');
      assert.match(error.message, new RegExp(`req_quota_test_${index}`));
      return true;
    });
    assert.throws(() => authority.prepare(nextPlanInput()), /explicit recovery decision/);
    assert.equal(providerCalls, 1);
  }
});

test('story SRB uses process-wide single-flight and two-attempt rate limits across plan IDs', async () => {
  let now = 1_000;
  let release: (() => void) | undefined;
  const authority = createChatGptStorySrbAuthority({ enabled: true, now: () => now, makeId: (() => { let i = 0; return () => `p-${++i}`; })() });
  const first = authority.prepare(nextPlanInput());
  const firstRun = authority.run({ plan: first, currentGrantGeneration: () => 7, transport: () => new Promise(resolve => { release = () => resolve(goodResult); }) });
  await assert.rejects(authority.run({ plan: authority.prepare(nextPlanInput()), currentGrantGeneration: () => 7, transport: async () => goodResult }), /already in progress/);
  release?.();
  await firstRun;
  const second = authority.prepare(nextPlanInput());
  await authority.run({ plan: second, currentGrantGeneration: () => 7, transport: async () => goodResult });
  await assert.rejects(authority.run({ plan: authority.prepare(nextPlanInput()), currentGrantGeneration: () => 7, transport: async () => goodResult }), /two-attempts-per-minute/);
  now += 60_000;
  await authority.run({ plan: authority.prepare(nextPlanInput()), currentGrantGeneration: () => 7, transport: async () => goodResult });
});

test('story SRB aborts authority even if transport ignores abort and discards a stale grant result', async () => {
  const authority = createChatGptStorySrbAuthority({ enabled: true });
  const plan = authority.prepare(nextPlanInput());
  const controller = new AbortController();
  const pending = authority.run({
    plan, currentGrantGeneration: () => 7, signal: controller.signal,
    transport: () => new Promise(resolve => setTimeout(() => resolve(goodResult), 15)),
  });
  controller.abort();
  await assert.rejects(pending, /cancelled/);
  await assert.rejects(authority.run({
    plan: authority.prepare(nextPlanInput()), currentGrantGeneration: () => 7,
    transport: async () => goodResult,
  }), /already in progress/);
  await new Promise(resolve => setTimeout(resolve, 20));
  const afterTermination = authority.prepare(nextPlanInput());
  await authority.run({ plan: afterTermination, currentGrantGeneration: () => 7, transport: async () => goodResult });

  const stale = authority.prepare(nextPlanInput());
  await assert.rejects(authority.run({ plan: stale, currentGrantGeneration: () => 8, transport: async () => goodResult }), /session changed/);
});

test('story plans expire and the retained plan set is bounded', async () => {
  let now = 0;
  const authority = createChatGptStorySrbAuthority({ enabled: true, now: () => now, makeId: (() => {
    let id = 0;
    return () => `bounded-${++id}`;
  })() });
  const expired = authority.prepare(nextPlanInput());
  now += 60_000;
  await assert.rejects(authority.run({ plan: expired, currentGrantGeneration: () => 7, transport: async () => goodResult }), /missing, stale/);
  for (let index = 0; index < 64; index += 1) authority.prepare(nextPlanInput());
  assert.throws(() => authority.prepare(nextPlanInput()), /bounded plan capacity/);
  now += 60_000;
  assert.doesNotThrow(() => authority.prepare(nextPlanInput()));
});

test('story SRB keeps its slot while the actual adapter has an abort-ignoring fetch in flight', async () => {
  let finishFetch!: (response: Response) => void;
  let markFetchStarted!: () => void;
  const started = new Promise<void>(resolve => { markFetchStarted = resolve; });
  let fetchCalls = 0;
  const adapter = new ChatGptResponsesAdapter('local-token', async () => {
    fetchCalls += 1;
    if (fetchCalls > 1) return new Response('event: response.completed\ndata: {"type":"response.completed","response":{}}\n\n', { headers: { 'content-type': 'text/event-stream' } });
    markFetchStarted();
    return new Promise<Response>(resolve => { finishFetch = resolve; });
  });
  const authority = createChatGptStorySrbAuthority({ enabled: true });
  const makePlan = () => authority.prepare(nextPlanInput());
  const makeTransport = (plan: ReturnType<typeof makePlan>) => (args: { body: string; limits: typeof CHATGPT_STORY_SRB_V1 }, signal: AbortSignal) =>
    adapter.generateStoryText({
      operation: 'story', modelId: plan.modelId, input: plan.sourceText, reasoningLevel: 'default',
      maxInputBytes: args.limits.maxRequestBodyBytes,
      maxOutputBytes: args.limits.maxAcceptedOutputBytes,
      timeoutMs: args.limits.timeoutMs, signal,
    }, args.body, {
      maxStreamBytes: args.limits.maxStreamBytes,
      maxAcceptedOutputBytes: args.limits.maxAcceptedOutputBytes,
      maxStreamEvents: args.limits.maxStreamEvents,
    });
  const firstPlan = makePlan();
  const controller = new AbortController();
  let transportPromise: Promise<ChatGptStoryTransportResult> | undefined;
  const firstRun = authority.run({
    plan: firstPlan, currentGrantGeneration: () => 7, signal: controller.signal,
    transport: (args, signal) => {
      const pendingTransport = makeTransport(firstPlan)(args, signal);
      transportPromise = pendingTransport;
      return pendingTransport;
    },
  });
  await started;
  controller.abort();
  await assert.rejects(firstRun, /cancelled/);
  // Run through the authority and verify that cancelling the first operation
  // did not release its slot while the adapter's underlying fetch remains live.
  const secondController = new AbortController();
  const secondPlan = makePlan();
  const run = authority.run({ plan: secondPlan, currentGrantGeneration: () => 7, signal: secondController.signal, transport: makeTransport(secondPlan) });
  await assert.rejects(run, /already in progress/);
  let adapterSettled = false;
  void transportPromise!.then(
    () => { adapterSettled = true; },
    () => { adapterSettled = true; },
  );
  await new Promise(resolve => setTimeout(resolve, 10));
  assert.equal(adapterSettled, false);
  finishFetch!(new Response('event: response.output_text.delta\ndata: {"type":"response.output_text.delta","delta":"ok"}\n\nevent: response.completed\ndata: {"type":"response.completed","response":{}}\n\n', { headers: { 'content-type': 'text/event-stream' } }));
  await assert.rejects(transportPromise!, /cancelled/);
});
