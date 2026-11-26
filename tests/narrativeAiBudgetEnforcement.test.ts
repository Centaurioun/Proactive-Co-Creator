import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { AI_OPERATION_POLICIES, maxAttemptsWithinOperationBudget, reserveAggregateOperationUsage } from '../server/aiBudget.ts';
import { runBudgetedJsonOperation, runWritingAssistant, type NarrativeAiClientLike } from '../server/narrative/narrativeAiService.ts';
import { extractNarrativeChunk } from '../server/narrative/extractionService.ts';
import { runWithAiProviderContext } from '../server/providers/requestContext.ts';

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
