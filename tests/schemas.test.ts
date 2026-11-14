import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  AnalyzeRequestSchema,
  ClarifyRequestSchema,
  GenerateMediaRequestSchema,
  RefineRequestSchema,
  parseAndValidateBeliefGraph,
  parseAndValidateClarifications,
  stripMarkdownCodeFence,
} from '../shared/schemas.ts';

describe('shared/schemas', () => {
  it('validates AnalyzeRequestSchema and rejects empty or oversized prompts', () => {
    const valid = AnalyzeRequestSchema.safeParse({
      prompt: '  a cat hosting a party  ',
      mode: 'image',
    });
    assert.equal(valid.success, true);
    if (valid.success) {
      assert.equal(valid.data.prompt, 'a cat hosting a party');
    }

    assert.equal(AnalyzeRequestSchema.safeParse({ prompt: '   ', mode: 'image' }).success, false);
    assert.equal(
      AnalyzeRequestSchema.safeParse({ prompt: 'a'.repeat(8001), mode: 'story' }).success,
      false
    );
    assert.equal(
      AnalyzeRequestSchema.safeParse({ prompt: 'hello', mode: 'audio' }).success,
      false
    );
  });

  it('validates ClarifyRequestSchema, RefineRequestSchema, and GenerateMediaRequestSchema defaults', () => {
    const clarify = ClarifyRequestSchema.parse({ prompt: 'A city at dusk', mode: 'video' });
    assert.deepEqual(clarify.askedQuestions, []);

    const refine = RefineRequestSchema.parse({ originalPrompt: 'A city at dusk' });
    assert.deepEqual(refine.clarifications, []);
    assert.deepEqual(refine.graphUpdates, []);

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

  it('parses valid clarifications and rejects empty or malformed clarifications', () => {
    const valid = parseAndValidateClarifications(
      JSON.stringify([
        { question: 'What breed is the cat?', options: ['Tabby', 'Siamese', 'Calico'] },
      ])
    );
    assert.equal(valid.length, 1);
    assert.equal(valid[0].question, 'What breed is the cat?');

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
