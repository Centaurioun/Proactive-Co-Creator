import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { AI_OPERATION_POLICIES } from '../server/aiBudget.ts';
import { runWritingAssistant, type NarrativeAiClientLike } from '../server/narrative/narrativeAiService.ts';

const request = {
  projectId: 'synthetic-project', baseRevision: 1, sectionId: 'scene-1', sectionTitle: 'Scene 1',
  action: 'rewrite' as const, contextBefore: '', contextAfter: '', confirmedEntities: [], confirmedStoryBible: {},
};

describe('narrative AI budget enforcement', () => {
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
});
