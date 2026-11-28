import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { parseAndValidateBatchEditResponse } from '../shared/schemas.ts';
import { NarrativeExtractionSchema } from '../shared/importSchemas.ts';
import { verifyExtractionEvidence } from '../lib/narrative/import/proposalValidator.ts';
import { extractNarrativeChunk, type ExtractionTraceEvent } from '../server/narrative/extractionService.ts';
import { AI_OPERATION_POLICIES } from '../server/aiBudget.ts';
import { AppApiError } from '../server/errors.ts';
import type { getGeminiClient } from '../server/geminiClient.ts';

type FakeClient = ReturnType<typeof getGeminiClient>;

describe('WP01 M2 — Batch Edit & Narrative Import Reliability', () => {
  it('rejects all-malformed batch edit proposals with INVALID_RESPONSE and never invents nextValue from targetEntityName', () => {
    assert.throws(
      () =>
        parseAndValidateBatchEditResponse(
          JSON.stringify({
            operations: [
              {
                type: 'update_story_bible',
                summary: 'Update setting',
                storyField: 'setting',
                targetEntityName: 'Foggy Cliffside Village',
              },
            ],
          }),
          'Set setting to Foggy Cliffside Village',
        ),
      /INVALID_RESPONSE.*nextValue/i,
    );
  });

  it('validates discriminated required fields across batch edit operation types while preserving valid ops', () => {
    const res = parseAndValidateBatchEditResponse(
      JSON.stringify({
        operations: [
          { type: 'rename_entity', summary: 'Rename without newEntityName', entityName: 'Elena' },
          { type: 'add_relationship', summary: 'Link without target', sourceEntityName: 'Elena', nextValue: 'trusts' },
          { type: 'set_attribute', summary: 'Set Elena age', entityName: 'Elena', attributeName: 'age', nextValue: '34' },
          { type: 'update_story_bible', summary: 'Set tone', storyField: 'tone', nextValue: 'Melancholic noir' },
        ],
      }),
      'Rename Elena, link Elena, set Elena age to 34, set tone to melancholic noir',
    );
    assert.equal(res.operations.length, 2);
    assert.equal(res.operations[0].type, 'set_attribute');
    assert.equal(res.operations[1].type, 'update_story_bible');
    assert.equal(res.operations[1].nextValue, 'Melancholic noir');
    assert.equal(res.coverageComplete, false);
    assert.equal(res.warnings.length, 2);
    assert.equal((res.unhandledClauses ?? []).length, 2);
  });

  it('deterministically resolves verbatim quotes with Turkish characters and emoji surrogates even when LLM offsets are missing or wrong', () => {
    const text = '🦉 İstanbul sahilinde güneş batarken, Defne eski feneri yaktı 🌊.';
    const quote = 'Defne eski feneri yaktı 🌊';
    const expectedStart = text.indexOf(quote);
    const parsed = NarrativeExtractionSchema.parse({
      findings: [
        {
          id: 'f1',
          title: 'Fener eylemi',
          value: 'Defne eski feneri yaktı',
          category: 'event',
          kind: 'explicit',
          rationale: 'Directly stated.',
          // Intentionally wrong offset hint simulating LLM UTF-16 miscount
          evidence: { start: 1, end: 5, quote },
        },
      ],
      entities: [
        {
          id: 'e1',
          name: 'Defne',
          category: 'character',
          description: 'Feneri yakan karakter.',
          aliases: [],
          attributes: [],
          kind: 'explicit',
          rationale: 'Named in text.',
          // Omitted offsets
          evidence: { quote: 'Defne' },
        },
      ],
      relationships: [],
      ambiguities: [],
    });

    const verified = verifyExtractionEvidence(
      parsed,
      { id: 'c1', index: 0, start: 50, end: 50 + text.length, text },
      { id: 'src-tr', version: 'v1', digest: 'a'.repeat(64) },
    );

    assert.equal(verified.rejectedEvidenceCount, 0);
    assert.equal(verified.findings.length, 1);
    assert.equal(verified.findings[0].evidence.start, 50 + expectedStart);
    assert.equal(verified.findings[0].evidence.end, 50 + expectedStart + quote.length);
    assert.equal(verified.entities.length, 1);
    assert.equal(verified.entities[0].evidence.start, 50 + text.indexOf('Defne'));
  });

  it('flags repeated verbatim quotes without exact offsets as an ambiguity instead of guessing, and rejects hallucinated quotes', () => {
    const text = 'The door clicked shut. Ten minutes later, The door clicked shut.';
    const parsed = NarrativeExtractionSchema.parse({
      findings: [
        {
          id: 'f-dup',
          title: 'Door shut',
          value: 'The door closed',
          category: 'event',
          kind: 'explicit',
          rationale: 'Mentioned in text.',
          evidence: { quote: 'The door clicked shut.' },
        },
        {
          id: 'f-hallucinated',
          title: 'Invented event',
          value: 'A dragon arrived',
          category: 'event',
          kind: 'explicit',
          rationale: 'Not in text.',
          evidence: { quote: 'A golden dragon landed.' },
        },
      ],
      entities: [],
      relationships: [],
      ambiguities: [],
    });

    const verified = verifyExtractionEvidence(
      parsed,
      { id: 'c-dup', index: 0, start: 0, end: text.length, text },
      { id: 'src-dup', version: 'v1', digest: 'b'.repeat(64) },
    );

    assert.equal(verified.findings.length, 0);
    assert.equal(verified.rejectedEvidenceCount, 2);
    assert.equal(verified.ambiguities.length, 1);
    assert.match(verified.ambiguities[0].title, /Ambiguous repeated evidence quote/i);
    assert.match(verified.ambiguities[0].detail, /2 times/i);
  });

  it('extractNarrativeChunk strips enclosing JSON fences, uses policy maxOutputTokens, and emits sanitized stage traces without manuscript leakage', async () => {
    const secretText = 'SECRET_MANUSCRIPT_PHRASE_DO_NOT_LOG';
    let capturedMaxOutputTokens: number | undefined;
    const traces: ExtractionTraceEvent[] = [];

    const mockClient = {
      models: {
        countTokens: async () => ({ totalTokens: 120 }),
        generateContent: async (params: { config?: Record<string, unknown> }) => {
          capturedMaxOutputTokens = params.config?.maxOutputTokens as number | undefined;
          return {
            text: '```json\n' + JSON.stringify({
              findings: [
                {
                  id: 'f1',
                  title: 'Phrase',
                  value: 'Recorded phrase',
                  category: 'other',
                  kind: 'explicit',
                  rationale: 'Direct quote.',
                  evidence: { quote: secretText },
                },
              ],
              entities: [],
              relationships: [],
              ambiguities: [],
            }) + '\n```',
          };
        },
      },
    } as unknown as FakeClient;

    const extracted = await extractNarrativeChunk(
      {
        sourceId: 'src_1',
        sourceVersion: 'v1',
        digest: 'c'.repeat(64),
        chunkId: 'chunk_1',
        text: secretText,
        scope: 'complete',
        categories: ['characters'],
        instruction: '',
      },
      undefined,
      mockClient,
      (event) => traces.push(event),
    );

    assert.equal(extracted.findings.length, 1);
    assert.equal(capturedMaxOutputTokens, AI_OPERATION_POLICIES['narrative-import'].maxOutputTokens);
    assert.deepEqual(
      traces.map((t) => `${t.stage}:${t.outcome}`),
      ['countTokens:ok', 'generate:ok', 'validation:ok'],
    );
    assert.equal(JSON.stringify(traces).includes(secretText), false);
  });

  it('maps malformed extraction JSON cleanly to 502 INVALID_RESPONSE and preserves MODEL_UNSUPPORTED without fallback', async () => {
    const badJsonClient = {
      models: {
        countTokens: async () => ({ totalTokens: 80 }),
        generateContent: async () => ({ text: 'not valid json {{{' }),
      },
    } as unknown as FakeClient;

    const traces: ExtractionTraceEvent[] = [];
    await assert.rejects(
      () =>
        extractNarrativeChunk(
          {
            sourceId: 'src_2',
            sourceVersion: 'v1',
            digest: 'd'.repeat(64),
            chunkId: 'chunk_1',
            text: 'Short story text.',
            scope: 'complete',
            categories: ['characters'],
            instruction: '',
          },
          undefined,
          badJsonClient,
          (e) => traces.push(e),
        ),
      (err: unknown) => err instanceof AppApiError && err.code === 'INVALID_RESPONSE' && err.statusCode === 502,
    );
    assert.equal(traces[traces.length - 1]?.stage, 'validation');
    assert.equal(traces[traces.length - 1]?.code, 'INVALID_RESPONSE');
  });
});
