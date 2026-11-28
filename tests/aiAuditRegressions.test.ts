import { afterEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import express from 'express';
import {
  parseAndValidateBatchEditResponse,
  parseAndValidateBeliefGraph,
  parseAndValidateClarifications,
} from '../shared/schemas.ts';
import { DiagnosticsSuggestFixesRequestSchema } from '../shared/narrativeAiSchemas.ts';
import {
  analyzeSemanticDiagnostics,
  analyzeNarrativeSync,
  runWritingAssistant,
  proposeImportEnhancements,
  exploreCreativeOpportunities,
  suggestDiagnosticFixes,
  type NarrativeAiClientLike,
} from '../server/narrative/narrativeAiService.ts';
import { createChatGptStorySrbAuthority } from '../server/providers/subscriptionResourceBudget.ts';
import { runWithAiProviderContext } from '../server/providers/requestContext.ts';
import { describeChatGptModel } from '../server/providers/policy.ts';
import { createApiRouter, type AiServiceHandlers, type ApiRouterOptions } from '../server/routes.ts';
import { getChatGptModels, setChatGptModels } from '../server/providers/runtime.ts';
import { chatGptSessionStore } from '../server/auth/chatgpt/runtime.ts';
import { AppApiError } from '../server/errors.ts';

function createNarrativeClient(
  payload: unknown,
  options: {
    tokenSource?: 'provider-count' | 'estimate';
    onGenerate?: (callCount: number) => Promise<{ text?: string }> | { text?: string };
  } = {},
): { client: NarrativeAiClientLike; getGenerateCalls: () => number } {
  let generateCalls = 0;
  const client: NarrativeAiClientLike = {
    models: {
      countTokens: async () => ({
        totalTokens: 120,
        source: options.tokenSource ?? 'provider-count',
      }),
      generateContent: async () => {
        generateCalls += 1;
        if (options.onGenerate) {
          return options.onGenerate(generateCalls);
        }
        return { text: JSON.stringify(payload) };
      },
    },
  };
  return { client, getGenerateCalls: () => generateCalls };
}

async function startRouteServer(handlers: Partial<AiServiceHandlers> = {}, options: ApiRouterOptions = {}) {
  const fullHandlers: AiServiceHandlers = {
    analyzeBeliefGraph: async () => ({
      prompt: 'test',
      entities: [],
      relationships: [],
    }),
    generateClarificationsList: async () => [],
    refinePromptText: async (prompt) => prompt,
    interpretBatchEditInstruction: async (instruction) => ({
      proposalId: 'p1',
      instruction,
      operations: [],
      ambiguities: [],
      warnings: [],
      unhandledClauses: [],
      coverageComplete: true,
    }),
    generateStoryText: async () => 'A calm story.',
    generateImagesBatch: async () => ({
      images: ['data:image/png;base64,AAA'],
      requestedCount: 4,
      failedCount: 0,
      warning: null,
    }),
    hasConfiguredGeminiKey: () => true,
    ...handlers,
  };
  const app = express();
  app.use(express.json());
  app.use('/api', createApiRouter(fullHandlers, options));
  const server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (!address || typeof address === 'string') {
    throw new Error('Failed to bind test server');
  }
  return {
    baseUrl: `http://127.0.0.1:${address.port}`,
    close: () => new Promise<void>((resolve, reject) => server.close((err) => (err ? reject(err) : resolve()))),
  };
}

describe('AI Audit Regressions — Schemas, Normalizers, SRB, and Security Boundaries', () => {
  const originalChatGptModels = getChatGptModels();

  afterEach(() => {
    setChatGptModels(originalChatGptModels);
    chatGptSessionStore.clear();
  });

  it('accepts realistic >160-character diagnostic issue IDs up to 512 chars and rejects >512 chars', () => {
    const realisticId = `issue:diagnostic:v1:trait_conflict:entity:ent_protagonist_elena:${'a'.repeat(180)}`;
    assert.ok(realisticId.length > 160 && realisticId.length < 512);

    const valid = DiagnosticsSuggestFixesRequestSchema.safeParse({
      projectId: 'proj_1',
      baseRevision: 3,
      issue: {
        id: realisticId,
        title: 'Conflicting eye color',
        description: 'Scene 2 calls Elena green-eyed, contradicting her confirmed amber eyes.',
      },
      entities: [],
      relationships: [],
      storyBible: {},
    });
    assert.equal(valid.success, true);

    const tooLong = DiagnosticsSuggestFixesRequestSchema.safeParse({
      projectId: 'proj_1',
      baseRevision: 3,
      issue: {
        id: `issue:${'x'.repeat(520)}`,
        title: 'Too long id',
        description: 'Should fail max(512).',
      },
      entities: [],
      relationships: [],
      storyBible: {},
    });
    assert.equal(tooLong.success, false);
  });

  it('normalizes Belief Graph category aliases, blank optional strings, and scalar attribute values', () => {
    const raw = JSON.stringify({
      entities: [
        {
          name: 'Elena',
          category: 'person',
          presence_in_prompt: true,
          description: '  Lead cartographer  ',
          alternatives: ['  ', 'Nora'],
          attributes: [
            { name: 'role', presence_in_prompt: true, value: 'cartographer' },
            { name: 'mood', value: ['   '] },
          ],
        },
        {
          name: 'Harbor Tower',
          category: 'setting',
          presence_in_prompt: false,
          attributes: [],
        },
      ],
      relationships: [
        {
          source: 'Elena',
          target: 'Harbor Tower',
          label: 'works in',
          evidence_excerpt: '   ',
          alternatives: ['guards', ''],
        },
      ],
    });

    const parsed = parseAndValidateBeliefGraph(raw, 'Elena maps the harbor tower.');
    assert.equal(parsed.entities[0].category, 'character');
    assert.equal(parsed.entities[0].description, 'Lead cartographer');
    assert.deepEqual(parsed.entities[0].alternatives, [{ name: 'Nora' }]);
    assert.deepEqual(parsed.entities[0].attributes[0].value, [{ name: 'cartographer' }]);
    assert.deepEqual(parsed.entities[0].attributes[1].value, [{ name: 'unspecified' }]);
    assert.equal(parsed.entities[1].category, 'location');
    assert.equal(parsed.relationships[0].evidenceExcerpt, undefined);
    assert.deepEqual(parsed.relationships[0].alternatives, [{ name: 'guards' }]);
  });

  it('normalizes clarifications and rejects malformed update_story_bible without fabricating nextValue from targetEntityName', () => {
    const clarifications = parseAndValidateClarifications(
      JSON.stringify([
        {
          question: 'What tone should anchor the opening chapter?',
          options: ['Melancholic noir', '', 'Warm mystery'],
          targetType: 'STORY_BIBLE',
          targetStoryField: 'tone',
          category: 'TONE',
          targetEntityName: '   ',
          impact: 'Sets prose cadence.',
        },
      ]),
    );
    assert.equal(clarifications.length, 1);
    assert.deepEqual(clarifications[0].options, ['Melancholic noir', 'Warm mystery']);
    assert.equal(clarifications[0].target?.type, 'story_bible');
    assert.equal(clarifications[0].target?.storyField, 'tone');
    assert.equal(clarifications[0].target?.entityName, undefined);

    const batch = parseAndValidateBatchEditResponse(
      JSON.stringify({
        operations: [
          {
            type: 'update_story_bible',
            summary: 'Update tone to taut nocturnal mystery',
            storyField: 'tone',
            targetEntityName: 'Taut nocturnal mystery',
          },
          {
            type: 'add_entity',
            summary: 'Add Harbor Beacon',
            entityName: 'Harbor Beacon',
            entityCategory: 'place',
          },
        ],
      }),
      'Set tone to taut nocturnal mystery and add Harbor Beacon.',
    );
    assert.equal(batch.operations.length, 1);
    assert.equal(batch.operations[0].type, 'add_entity');
    assert.equal(batch.operations[0].entityCategory, 'location');
    assert.equal(batch.coverageComplete, false);
    assert.ok(batch.warnings.some((w) => /update_story_bible/i.test(w) && /nextValue/i.test(w)));
    assert.ok((batch.unhandledClauses ?? []).includes('Update tone to taut nocturnal mystery'));
  });

  it('normalizes all 6 narrative AI responses (diagnostics, suggest-fixes, sync, writing, opportunities, import-enhance)', async () => {
    const diagClient = createNarrativeClient({
      findings: [
        {
          title: 'Conflicting weather',
          description: 'Dry noon conflicts with storm in Story Bible.',
          category: 'setting_conflict',
          severity: 'warning',
          certainty: 'confirmed',
          targetKind: 'story_bible',
          storyField: 'setting',
          targetId: '   ',
          evidenceQuote: 'The noon sun beat down on dry cobblestones.',
        },
      ],
      coverageNote: '',
    });
    const diagRes = await analyzeSemanticDiagnostics(
      {
        projectId: 'p1',
        baseRevision: 1,
        scope: 'full',
        entities: [],
        relationships: [],
        storyBible: { setting: 'Perpetual storm' },
      },
      undefined,
      diagClient.client,
    );
    assert.equal(diagRes.findings.length, 1);
    assert.equal(diagRes.findings[0].targetId, undefined);
    assert.ok(diagRes.coverageNote.length > 0);

    const fixClient = createNarrativeClient({
      alternatives: [
        {
          id: '  ',
          title: 'Update scene weather',
          reason: 'Align scene with perpetual storm.',
          assumptions: ['Storm stays constant', ''],
          evidenceSummary: 'Story Bible specifies storm.',
          affectedScope: 'Scene 1',
          kind: 'manuscript_patch',
          sectionId: 'sec_1',
          beforeText: 'The noon sun beat down.',
          afterText: 'Rain hammered the cobblestones.',
        },
      ],
    });
    const fixRes = await suggestDiagnosticFixes(
      {
        projectId: 'p1',
        baseRevision: 1,
        issue: { id: 'issue:1', title: 'Weather', description: 'Mismatch' },
        entities: [],
        relationships: [],
        storyBible: {},
      },
      undefined,
      fixClient.client,
    );
    assert.equal(fixRes.alternatives[0].id, 'fix_1');
    assert.deepEqual(fixRes.alternatives[0].assumptions, ['Storm stays constant']);

    const syncClient = createNarrativeClient({
      direction: 'invalid-direction',
      modelProposals: [
        {
          id: '',
          kind: 'add_entity',
          title: 'Add Lantern Pier scene',
          rationale: 'Introduced in chapter 1.',
          evidenceQuote: 'She stepped onto Lantern Pier.',
          entityName: 'Lantern Pier',
          entityCategory: 'scene',
          proposedValue: 'Opening dock confrontation',
        },
      ],
      manuscriptPatches: [
        {
          id: '',
          sectionId: 'sec_1',
          sectionTitle: 'Chapter 1',
          rationale: 'Reflect renamed character',
          linkedModelChange: 'Renamed Mara to Elena',
          originalExcerpt: 'Mara looked out.',
          proposedExcerpt: 'Elena looked out.',
          conflictNote: '   ',
        },
      ],
      coverageNote: '',
    });
    const syncRes = await analyzeNarrativeSync(
      {
        direction: 'manuscript-to-model',
        projectId: 'p1',
        baseRevision: 2,
        sections: [{ id: 'sec_1', title: 'Chapter 1', kind: 'chapter', text: 'She stepped onto Lantern Pier.' }],
        entities: [],
        relationships: [],
        storyBible: {},
      },
      undefined,
      syncClient.client,
    );
    assert.equal(syncRes.direction, 'manuscript-to-model');
    assert.equal(syncRes.modelProposals[0].id, 'sync_model_1');
    assert.equal(syncRes.modelProposals[0].entityCategory, 'scene');
    assert.deepEqual(syncRes.manuscriptPatches, [], 'manuscript-to-model sync must strictly suppress manuscriptPatches');

    const writeClient = createNarrativeClient({
      proposals: [
        {
          id: '',
          label: 'Atmospheric continuation',
          text: 'Lanterns swayed in the harbor squall.',
          rationale: 'Preserves tense pacing.',
          assumptions: ['Nighttime setting', '   '],
        },
      ],
    });
    const writeRes = await runWritingAssistant(
      {
        projectId: 'p1',
        baseRevision: 2,
        sectionId: 'sec_1',
        sectionTitle: 'Chapter 1',
        action: 'continue',
        contextBefore: 'She reached the pier.',
        contextAfter: '',
        confirmedEntities: [],
        confirmedStoryBible: {},
      },
      undefined,
      writeClient.client,
    );
    assert.equal(writeRes.proposals[0].id, 'write_1');
    assert.deepEqual(writeRes.proposals[0].assumptions, ['Nighttime setting']);

    const oppClient = createNarrativeClient({
      opportunities: [
        {
          title: 'Deepen rival motive',
          category: 'character',
          rationale: 'Gives the harbor dispute personal stakes.',
          options: ['Shared apprenticeship', '', 'Stolen chart'],
          sourceRefs: ['ent_elena', ''],
          targetKind: 'ENTITY',
          targetId: 'ent_elena',
        },
      ],
      coverageNote: '',
    });
    const oppRes = await exploreCreativeOpportunities(
      {
        projectId: 'p1',
        baseRevision: 2,
        scope: 'project',
        categories: ['character'],
        entities: [],
        relationships: [],
        storyBible: {},
      },
      undefined,
      oppClient.client,
    );
    assert.equal(oppRes.opportunities[0].targetKind, 'entity');
    assert.deepEqual(oppRes.opportunities[0].options, ['Shared apprenticeship', 'Stolen chart']);

    const enhClient = createNarrativeClient({
      proposals: [
        {
          id: '',
          category: 'clarity',
          title: 'Clarify timeline transition',
          rationale: 'Makes the jump from dusk to dawn unmistakable.',
          targetSectionTitle: 'Chapter 1',
          beforeExcerpt: '   ',
          afterExcerpt: 'By dawn, the tide had retreated.',
          assumptions: ['Overnight passage'],
        },
      ],
      coverageNote: '',
    });
    const enhRes = await proposeImportEnhancements(
      {
        filename: 'chapter1.txt',
        sourceTextExcerpt: 'The tide retreated.',
        entities: [],
        sections: [{ title: 'Chapter 1', excerpt: 'The tide retreated.' }],
        goals: 'clarity',
      },
      undefined,
      enhClient.client,
    );
    assert.equal(enhRes.proposals[0].id, 'enhance_1');
    assert.equal(enhRes.proposals[0].beforeExcerpt, undefined);
  });

  it('enforces zero automatic retries (maxAttempts = 1) and accepts estimate token preflight for chatgpt-plan', async () => {
    const { client, getGenerateCalls } = createNarrativeClient(
      {},
      {
        tokenSource: 'estimate',
        onGenerate: async () => {
          throw new AppApiError('UPSTREAM_ERROR', 'Transient upstream error', 503, true);
        },
      },
    );

    await assert.rejects(
      () =>
        runWithAiProviderContext(
          {
            selection: {
              connectionId: 'chatgpt-plan',
              modelId: 'gpt-6-luna',
              reasoningLevel: 'high',
            },
            operation: 'diagnostics',
          },
          () =>
            analyzeSemanticDiagnostics(
              {
                projectId: 'p1',
                baseRevision: 1,
                scope: 'full',
                entities: [],
                relationships: [],
                storyBible: {},
              },
              undefined,
              client,
            ),
        ),
      /Transient upstream error/,
    );
    assert.equal(getGenerateCalls(), 1);
  });

  it('pins documented non-default reasoning level in SRB ChatGPT Story approved request body', () => {
    const authority = createChatGptStorySrbAuthority({ enabled: true });
    const plan = authority.prepare({
      requestId: 'story_req_high_reasoning_001',
      modelId: 'gpt-6-luna',
      reasoningLevel: 'high',
      grantGeneration: 1,
      sourceDigest: 'digest_abc',
      sourceText: 'Write a short scene about a lantern keeper.',
      instructions: 'Keep it concise.',
    });
    const parsedBody = JSON.parse(plan.requestBody) as Record<string, unknown>;
    assert.equal(parsedBody.model, 'gpt-6-luna');
    assert.deepEqual(parsedBody.reasoning, { effort: 'high' });
    assert.equal(parsedBody.store, false);
    assert.equal(parsedBody.stream, true);
    assert.equal('max_output_tokens' in parsedBody, false);
  });

  it('enforces security boundaries: rejects chatgpt-plan image generation (422) and cross-origin personal provider requests (403)', async () => {
    chatGptSessionStore.install({
      accessToken: 'tok_test',
      refreshToken: 'ref_test',
      expiresAt: Date.now() + 60_000,
      tokenType: 'Bearer',
    });
    setChatGptModels([describeChatGptModel({ id: 'gpt-6-luna', displayName: 'GPT-6 Luna' }, 'chatgpt-plan')]);

    const srv = await startRouteServer();
    try {
      const imgRes = await fetch(`${srv.baseUrl}/api/generate/images`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Origin: srv.baseUrl,
          'x-pcc-ai-connection': 'chatgpt-plan',
          'x-pcc-ai-model': 'gpt-6-luna',
        },
        body: JSON.stringify({ prompt: 'A quiet harbor at dusk' }),
      });
      assert.equal(imgRes.status, 422);

      const crossOriginImgRes = await fetch(`${srv.baseUrl}/api/generate/images`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Origin: 'https://evil.example',
          'x-pcc-ai-connection': 'chatgpt-plan',
          'x-pcc-ai-model': 'gpt-6-luna',
        },
        body: JSON.stringify({ prompt: 'A quiet harbor at dusk' }),
      });
      assert.equal(crossOriginImgRes.status, 403);

      const crossOriginPrefRes = await fetch(`${srv.baseUrl}/api/ai/provider-hub/preferences`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          Origin: 'https://evil.example',
        },
        body: JSON.stringify({ preferences: { defaultConnectionId: 'gemini-managed' } }),
      });
      assert.equal(crossOriginPrefRes.status, 403);
    } finally {
      await srv.close();
    }
  });
});
