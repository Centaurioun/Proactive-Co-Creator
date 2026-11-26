import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { AI_OPERATION_POLICIES, maxAttemptsWithinOperationBudget, reserveAggregateOperationUsage } from '../server/aiBudget.ts';
import { runBudgetedJsonOperation, runWritingAssistant, type NarrativeAiClientLike } from '../server/narrative/narrativeAiService.ts';
import { extractNarrativeChunk } from '../server/narrative/extractionService.ts';
import { runWithAiProviderContext } from '../server/providers/requestContext.ts';
import { createLegacyAiClient } from '../server/providers/runtime.ts';
import { ChatGptResponsesAdapter } from '../server/providers/chatgptResponses.ts';

const request = {
  projectId: 'synthetic-project', baseRevision: 1, sectionId: 'scene-1', sectionTitle: 'Scene 1',
  action: 'rewrite' as const, contextBefore: '', contextAfter: '', confirmedEntities: [], confirmedStoryBible: {},
};

describe('narrative AI budget enforcement', () => {
  it('limits retry attempts by aggregate generation calls and counted input plus output allowance', () => {
    const story = AI_OPERATION_POLICIES.story;
    assert.equal(maxAttemptsWithinOperationBudget(story, 4_000), 1);
    assert.equal(maxAttemptsWithinOperationBudget(story, 100), 2);
    assert.equal(maxAttemptsWithinOperationBudget(story, 12_000), 0);
  });

  it('enforces aggregate narrative import call, token, and elapsed limits across requests', () => {
    const policy = AI_OPERATION_POLICIES['narrative-import'];
    const key = `aggregate-test-${Date.now()}-${Math.random()}`;
    assert.equal(reserveAggregateOperationUsage({ policy, operationKey: key, inputTokens: 1, now: 1_000 }).ok, true);
    assert.equal(reserveAggregateOperationUsage({ policy, operationKey: key, inputTokens: policy.maxAggregateTokens, now: 1_001 }).ok, false);
    assert.equal(reserveAggregateOperationUsage({ policy, operationKey: `${key}-time`, inputTokens: 1, now: 1_000 }).ok, true);
    const expired = reserveAggregateOperationUsage({ policy, operationKey: `${key}-time`, inputTokens: 1, now: 1_000 + policy.maxAggregateElapsedMs });
    assert.equal(expired.ok, false);
  });

  it('stops extraction at the configured aggregate call budget without a provider call', async () => {
    let generateCalls = 0;
    const client = {
      models: {
        countTokens: async () => ({ totalTokens: 10 }),
        generateContent: async () => {
          generateCalls += 1;
          return { text: JSON.stringify({ findings: [], entities: [], relationships: [], ambiguities: [] }) };
        },
      },
    } as unknown as ReturnType<typeof import('../server/geminiClient.ts').getGeminiClient>;
    const digest = `f${Date.now().toString(16).padStart(63, '0')}`;
    const policy = AI_OPERATION_POLICIES['narrative-import'];
    for (let index = 0; index < policy.maxAggregateCalls; index += 1) {
      await extractNarrativeChunk({
        sourceId: 'synthetic-source', sourceVersion: 'v1', digest, chunkId: `chunk-${index}`,
        text: 'Synthetic text.', scope: 'complete', categories: [], instruction: '',
      }, undefined, client);
    }
    await assert.rejects(() => extractNarrativeChunk({
      sourceId: 'synthetic-source', sourceVersion: 'v1', digest, chunkId: 'over-budget',
      text: 'Synthetic text.', scope: 'complete', categories: [], instruction: '',
    }, undefined, client), /call limit/i);
    assert.equal(generateCalls, policy.maxAggregateCalls);
  });

  it('passes the configured output-token cap to generation after provider preflight count', async () => {
    let generateConfig: Record<string, unknown> | undefined;
    const client: NarrativeAiClientLike = {
      models: {
        countTokens: async () => ({ totalTokens: 20 }),
        generateContent: async (params) => {
          generateConfig = params.config;
          return { text: JSON.stringify({ proposals: [{ id: 'p1', label: 'Clearer', text: 'Synthetic text', rationale: 'Focused rewrite', assumptions: [] }] }) };
        },
      },
    };
    await runWritingAssistant(request, undefined, client);
    assert.equal(generateConfig?.maxOutputTokens, AI_OPERATION_POLICIES.writing.maxOutputTokens);
  });

  it('does not start generation when provider counting times out', async () => {
    let generated = false;
    const client: NarrativeAiClientLike = {
      models: {
        countTokens: async () => new Promise(() => undefined),
        generateContent: async () => { generated = true; return { text: '' }; },
      },
    };
    await assert.rejects(() => runWritingAssistant(request, undefined, client), /timed out/i);
    assert.equal(generated, false);
  });

  it('fails closed for ChatGPT plan narrative operations when only an estimated token count is available', async () => {
    let generated = false;
    const client: NarrativeAiClientLike = {
      models: {
        countTokens: async () => ({ totalTokens: 10, source: 'estimate' }),
        generateContent: async () => { generated = true; return { text: '{}' }; },
      },
    };
    await assert.rejects(() => runWithAiProviderContext({
      selection: { connectionId: 'chatgpt-plan', modelId: 'gpt-6.2-sol' }, operation: 'writing',
    }, () => runBudgetedJsonOperation({ operation: 'writing', prompt: 'Synthetic prompt', parse: value => value, client })), /exact count.*Generation was not started/i);
    assert.equal(generated, false);
  });

  it('fails closed for ChatGPT plan narrative extraction when only an estimated token count is available', async () => {
    let generated = false;
    const client = {
      models: {
        countTokens: async () => ({ totalTokens: 10, source: 'estimate' }),
        generateContent: async () => { generated = true; return { text: '{}' }; },
      },
    } as unknown as ReturnType<typeof import('../server/geminiClient.ts').getGeminiClient>;
    await assert.rejects(() => runWithAiProviderContext({
      selection: { connectionId: 'chatgpt-plan', modelId: 'gpt-6.2-sol' }, operation: 'narrative-import',
    }, () => extractNarrativeChunk({
      sourceId: 'synthetic-source', sourceVersion: 'v1', digest: `e${Date.now().toString(16).padStart(63, '0')}`,
      chunkId: 'chatgpt-plan-estimate', text: 'Synthetic narrative.', scope: 'complete', categories: [], instruction: '',
    }, undefined, client)), /exact count.*Generation was not started/i);
    assert.equal(generated, false);
  });

  it('keeps Gemini native token counting within its documented config and applies schema at generation', async () => {
    let countConfig: Record<string, unknown> | undefined;
    let generationConfig: Record<string, unknown> | undefined;
    const client = {
      models: {
        countTokens: async (params: { config?: Record<string, unknown> }) => {
          countConfig = params.config;
          return { totalTokens: 10, source: 'provider-count' as const };
        },
        generateContent: async (params: { config?: Record<string, unknown> }) => {
          generationConfig = params.config;
          return { text: JSON.stringify({ findings: [], entities: [], relationships: [], ambiguities: [] }) };
        },
      },
    } as unknown as ReturnType<typeof import('../server/geminiClient.ts').getGeminiClient>;
    await extractNarrativeChunk({
      sourceId: 'synthetic-source', sourceVersion: 'v1', digest: `f${Date.now().toString(16).padStart(63, '0')}`,
      chunkId: 'schema-preflight', text: 'Synthetic narrative.', scope: 'complete', categories: [], instruction: '',
    }, undefined, client);
    assert.equal(countConfig?.responseSchema, undefined);
    assert.ok(generationConfig?.responseSchema);
  });

  it('uses the same OpenAI extraction input and schema constraints for preflight and blocks over-budget inference', async () => {
    const requests: Array<{ url: string; body: Record<string, unknown> }> = [];
    let count = 12;
    const adapter = new ChatGptResponsesAdapter('synthetic-openai-key', async (input, init) => {
      const url = String(input);
      const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
      requests.push({ url, body });
      if (url.endsWith('/responses/input_tokens')) return Response.json({ object: 'response.input_tokens', input_tokens: count });
      return new Response([
        `event: response.output_text.delta\ndata: ${JSON.stringify({ type: 'response.output_text.delta', delta: JSON.stringify({ findings: [], entities: [], relationships: [], ambiguities: [] }) })}\n\n`,
        `event: response.completed\ndata: ${JSON.stringify({ type: 'response.completed', response: {} })}\n\n`,
      ].join(''), { headers: { 'content-type': 'text/event-stream' } });
    }, undefined, 'openai-api');
    const client = createLegacyAiClient(
      { connectionId: 'openai-api', modelId: 'gpt-6.2-sol' }, 'narrative-import', undefined,
      () => { throw new Error('managed Gemini must not be used'); },
      () => adapter,
    ) as unknown as ReturnType<typeof import('../server/geminiClient.ts').getGeminiClient>;
    const extraction = {
      sourceId: 'synthetic-source', sourceVersion: 'v1', digest: `a${Date.now().toString(16).padStart(63, '0')}`,
      chunkId: 'openai-extraction-preflight', text: 'Synthetic narrative.', scope: 'complete' as const, categories: [], instruction: '',
    };
    await runWithAiProviderContext({ selection: { connectionId: 'openai-api', modelId: 'gpt-6.2-sol' }, operation: 'narrative-import' }, () => extractNarrativeChunk(extraction, undefined, client));
    const preflight = requests.find(item => item.url.endsWith('/responses/input_tokens'))?.body;
    const generation = requests.find(item => item.url.endsWith('/responses'))?.body;
    assert.deepEqual(preflight?.input, generation?.input);
    assert.equal(preflight?.instructions, generation?.instructions);
    assert.ok(typeof preflight?.instructions === 'string' && preflight.instructions.includes('conforms to this response schema'));
    assert.equal(generation?.max_output_tokens, 2048);

    requests.length = 0;
    count = 8_001;
    await assert.rejects(() => runWithAiProviderContext({ selection: { connectionId: 'openai-api', modelId: 'gpt-6.2-sol' }, operation: 'narrative-import' }, () => extractNarrativeChunk({ ...extraction, digest: `b${Date.now().toString(16).padStart(63, '0')}`, chunkId: 'openai-extraction-over-budget' }, undefined, client)), /exceeds the safe 8,000.*input-token budget/i);
    assert.equal(requests.filter(item => item.url.endsWith('/responses')).length, 0);
  });

  it('releases the AI concurrency slot when provider initialization throws', async () => {
    for (let attempt = 0; attempt < 2; attempt += 1) {
      await assert.rejects(() => runBudgetedJsonOperation({
        operation: 'writing', prompt: 'Synthetic prompt', parse: (value) => value,
        clientFactory: () => { throw new Error('synthetic provider initialization failure'); },
      }));
    }
    const client: NarrativeAiClientLike = {
      models: {
        countTokens: async () => ({ totalTokens: 20 }),
        generateContent: async () => ({ text: JSON.stringify({ proposals: [{ id: 'p1', label: 'Clearer', text: 'Synthetic text', rationale: 'Focused rewrite', assumptions: [] }] }) }),
      },
    };
    await runWritingAssistant(request, undefined, client);
  });
});
