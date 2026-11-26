import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  AnalyzeRequestSchema,
  BatchEditRequestSchema,
  ClarifyRequestSchema,
  GenerateMediaRequestSchema,
  GenerationModeSchema,
  RawBatchEditResponseSchema,
  RefineRequestSchema,
  parseAndValidateBatchEditResponse,
  parseAndValidateBeliefGraph,
  parseAndValidateClarifications,
  stripMarkdownCodeFence,
} from '../shared/schemas.ts';

describe('shared/schemas', () => {
  it('validates AnalyzeRequestSchema, accepts only story/image modes, and rejects video or empty/oversized prompts', () => {
    const valid = AnalyzeRequestSchema.safeParse({
      prompt: '  a cat hosting a party  ',
      mode: 'image',
    });
    assert.equal(valid.success, true);
    if (valid.success) {
      assert.equal(valid.data.prompt, 'a cat hosting a party');
    }

    assert.equal(GenerationModeSchema.safeParse('story').success, true);
    assert.equal(GenerationModeSchema.safeParse('image').success, true);
    assert.equal(GenerationModeSchema.safeParse('video').success, false);
    assert.equal(AnalyzeRequestSchema.safeParse({ prompt: '   ', mode: 'image' }).success, false);
    assert.equal(
      AnalyzeRequestSchema.safeParse({ prompt: 'a'.repeat(8001), mode: 'story' }).success,
      false
    );
    assert.equal(
      AnalyzeRequestSchema.safeParse({ prompt: 'hello', mode: 'video' }).success,
      false
    );
  });

  it('validates ClarifyRequestSchema, RefineRequestSchema, BatchEditRequestSchema, and GenerateMediaRequestSchema defaults', () => {
    const clarify = ClarifyRequestSchema.parse({ prompt: 'A city at dusk', mode: 'story' });
    assert.deepEqual(clarify.askedQuestions, []);
    assert.equal(ClarifyRequestSchema.safeParse({ prompt: 'A city at dusk', mode: 'video' }).success, false);

    const refine = RefineRequestSchema.parse({ originalPrompt: 'A city at dusk' });
    assert.deepEqual(refine.clarifications, []);
    assert.deepEqual(refine.graphUpdates, []);

    const batchReq = BatchEditRequestSchema.parse({
      instruction: 'Make all animal guests elderly',
      mode: 'story',
    });
    assert.equal(batchReq.instruction, 'Make all animal guests elderly');

    assert.equal(GenerateMediaRequestSchema.safeParse({ prompt: '' }).success, false);
  });

  it('strips markdown JSON fences cleanly', () => {
    assert.equal(stripMarkdownCodeFence('```json\n{"a": 1}\n```'), '{"a": 1}');
    assert.equal(stripMarkdownCodeFence('```\n[1, 2]\n```'), '[1, 2]');
    assert.equal(stripMarkdownCodeFence('  {"raw": true}  '), '{"raw": true}');
  });

  it('parses and normalizes valid belief graph JSON including fenced output', () => {
    const raw = `\`\`\`json
    {
      "entities": [
        {
          "name": "The Image",
          "presence_in_prompt": false,
          "description": "Overall scene",
          "alternatives": null,
          "attributes": [
            { "name": "existence", "presence_in_prompt": false, "value": ["true", "false"] },
            { "name": "lighting", "presence_in_prompt": false, "value": ["warm", "cool"] }
          ]
        },
        {
          "name": "Cat",
          "presence_in_prompt": true,
          "description": "Main host",
          "alternatives": ["Kitten"],
          "attributes": [
            { "name": "existence", "presence_in_prompt": true, "value": ["true", "false"] },
            { "name": "color", "presence_in_prompt": false, "value": ["orange", "black"] }
          ]
        }
      ],
      "relationships": [
        { "source": "Cat", "target": "Friends", "label": "hosting", "alternatives": ["welcoming"] }
      ]
    }
    \`\`\``;

    const graph = parseAndValidateBeliefGraph(raw, 'a cat hosting a party');
    assert.equal(graph.prompt, 'a cat hosting a party');
    assert.equal(graph.entities.length, 2);
    assert.deepEqual(graph.entities[0].alternatives, []);
    assert.deepEqual(graph.entities[1].alternatives, [{ name: 'Kitten' }]);
    assert.deepEqual(graph.entities[1].attributes[1].value, [
      { name: 'orange' },
      { name: 'black' },
    ]);
    assert.deepEqual(graph.relationships[0].alternatives, [{ name: 'welcoming' }]);
  });

  it('throws INVALID_RESPONSE error for malformed JSON or schema mismatch in belief graph', () => {
    assert.throws(
      () => parseAndValidateBeliefGraph('{not json', 'prompt'),
      /INVALID_RESPONSE:.*malformed JSON/
    );
    assert.throws(
      () => parseAndValidateBeliefGraph('{"entities": []}', 'prompt'),
      /INVALID_RESPONSE:.*schema mismatch/
    );
  });

  it('parses valid clarifications with structured targets and parses batch edit responses', () => {
    const valid = parseAndValidateClarifications(
      JSON.stringify([
        {
          question: 'What breed is the cat?',
          options: ['Tabby', 'Siamese', 'Calico'],
          category: 'character',
          rationale: 'Defines visual identity',
          targetType: 'entity_attribute',
          targetEntityName: 'Cat Host',
          targetAttributeName: 'breed',
        },
      ])
    );
    assert.equal(valid.length, 1);
    assert.equal(valid[0].question, 'What breed is the cat?');
    assert.equal(valid[0].target?.type, 'entity_attribute');
    assert.equal(valid[0].target?.entityName, 'Cat Host');

    const batchParsed = parseAndValidateBatchEditResponse(
      JSON.stringify({
        summary: 'Update tone and cat age',
        warnings: [],
        operations: [
          {
            type: 'update_story_bible',
            summary: 'Set tone to mysterious',
            storyField: 'tone',
            nextValue: 'mysterious',
          },
        ],
      }),
      'Make party mysterious'
    );
    assert.equal(batchParsed.operations.length, 1);
    assert.equal(batchParsed.operations[0].type, 'update_story_bible');
    assert.equal(batchParsed.operations[0].storyField, 'tone');
    assert.equal(batchParsed.operations[0].nextValue, 'mysterious');

    // Invalid / legacy keys (e.g. storyBibleField / proposedValue) are stripped by RawBatchEditResponseSchema
    // and never silently mapped into storyField / nextValue; invalid operation types are rejected.
    const legacyKeyParse = RawBatchEditResponseSchema.safeParse({
      operations: [
        {
          type: 'update_story_bible',
          summary: 'Set tone to mysterious',
          storyBibleField: 'tone',
          proposedValue: 'mysterious',
        },
      ],
    });
    assert.equal(legacyKeyParse.success, true);
    if (legacyKeyParse.success) {
      assert.equal(legacyKeyParse.data.operations[0].storyField, undefined);
      assert.equal(legacyKeyParse.data.operations[0].nextValue, undefined);
      assert.equal('storyBibleField' in legacyKeyParse.data.operations[0], false);
      assert.equal('proposedValue' in legacyKeyParse.data.operations[0], false);
    }
    assert.equal(
      RawBatchEditResponseSchema.safeParse({
        operations: [{ type: 'invalid_operation', summary: 'Bad op' }],
      }).success,
      false
    );

    assert.throws(
      () => parseAndValidateClarifications('[]'),
      /INVALID_RESPONSE:.*schema mismatch/
    );
    assert.throws(
      () => parseAndValidateClarifications('not-json'),
      /INVALID_RESPONSE:.*malformed JSON/
    );
  });
});
