/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { z } from 'zod';
import type {
  BatchEditProposalResult,
  BeliefState,
  Clarification,
  EntityCategory,
  QuestionTarget,
  StoryBibleFields,
} from './types.ts';

export const GenerationModeSchema = z.enum(['story', 'image']);

export const NonEmptyPromptSchema = z
  .string()
  .trim()
  .min(1, 'Prompt cannot be empty.')
  .max(8000, 'Prompt must be 8000 characters or fewer.');

export const AnalyzeRequestSchema = z.object({
  prompt: NonEmptyPromptSchema,
  mode: GenerationModeSchema,
});

export const ClarifyRequestSchema = z.object({
  prompt: NonEmptyPromptSchema,
  mode: GenerationModeSchema,
  askedQuestions: z.array(z.string().max(1000)).max(100).default([]),
  confirmedFacts: z.array(z.string().max(1000)).max(200).optional().default([]),
});

export const ClarificationAnswerSchema = z.object({
  question: z.string().trim().min(1).max(1000),
  answer: z.string().trim().min(1).max(2000),
});

export const GraphUpdateSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('attribute'),
    entity: z.string().trim().min(1).max(300),
    attribute: z.string().trim().min(1).max(300),
    value: z.string().trim().min(1).max(1000),
  }),
  z.object({
    type: z.literal('relationship'),
    source: z.string().trim().min(1).max(300),
    target: z.string().trim().min(1).max(300),
    oldLabel: z.string().trim().min(1).max(300),
    newLabel: z.string().trim().min(1).max(300),
  }),
]);

export const RefineRequestSchema = z.object({
  originalPrompt: NonEmptyPromptSchema,
  clarifications: z.array(ClarificationAnswerSchema).max(50).default([]),
  graphUpdates: z.array(GraphUpdateSchema).max(100).default([]),
});

export const GenerateMediaRequestSchema = z.object({
  prompt: NonEmptyPromptSchema,
});

export const BatchEditRequestSchema = z.object({
  instruction: z.string().trim().min(1, 'Instruction cannot be empty.').max(2000),
  prompt: z.string().max(8000).default(''),
  entities: z
    .array(
      z.object({
        id: z.string().optional(),
        name: z.string(),
        category: z.string().optional(),
        excluded: z.boolean().optional(),
        attributes: z
          .array(
            z.object({
              name: z.string(),
              value: z.string(),
              status: z.string().optional(),
            })
          )
          .default([]),
      })
    )
    .default([]),
  relationships: z
    .array(
      z.object({
        id: z.string().optional(),
        source: z.string(),
        target: z.string(),
        label: z.string(),
      })
    )
    .default([]),
});

// --- Untrusted Gemini JSON output validation schemas ---

const RawAttributeSchema = z.object({
  name: z.string().trim().min(1),
  presence_in_prompt: z.boolean(),
  value: z.array(z.string().trim().min(1)).min(1),
});

const RawEntitySchema = z.object({
  name: z.string().trim().min(1),
  category: z
    .enum(['character', 'location', 'object', 'event', 'group', 'scene'])
    .optional(),
  presence_in_prompt: z.boolean(),
  description: z.string().default(''),
  alternatives: z.array(z.string().trim().min(1)).nullable().optional(),
  attributes: z.array(RawAttributeSchema).default([]),
});

const RawRelationshipSchema = z.object({
  source: z.string().trim().min(1),
  target: z.string().trim().min(1),
  label: z.string().trim().min(1),
  alternatives: z.array(z.string().trim().min(1)).nullable().optional(),
});

export const RawBeliefGraphSchema = z.object({
  entities: z.array(RawEntitySchema),
  relationships: z.array(RawRelationshipSchema),
});

export const RawClarificationItemSchema = z.object({
  question: z.string().trim().min(1),
  options: z.array(z.string().trim().min(1)).min(1),
  targetType: z
    .enum(['entity_attribute', 'relationship', 'story_bible', 'general'])
    .optional(),
  targetEntityName: z.string().trim().optional(),
  targetAttributeName: z.string().trim().optional(),
  targetStoryField: z.string().trim().optional(),
  category: z
    .enum(['character', 'setting', 'plot', 'tone', 'visual', 'general'])
    .optional(),
  impact: z.string().trim().optional(),
});

export const RawClarificationsSchema = z.array(RawClarificationItemSchema).min(1).max(6);

export const RawBatchEditResponseSchema = z.object({
  operations: z
    .array(
      z.object({
        type: z.enum([
          'set_attribute',
          'add_attribute',
          'add_entity',
          'rename_entity',
          'exclude_entity',
          'add_relationship',
          'update_relationship',
          'remove_relationship',
          'update_story_bible',
        ]),
        summary: z.string().trim().min(1),
        entityName: z.string().optional(),
        newEntityName: z.string().optional(),
        entityCategory: z
          .enum(['character', 'location', 'object', 'event', 'group', 'scene'])
          .optional(),
        attributeName: z.string().optional(),
        nextValue: z.string().optional(),
        sourceEntityName: z.string().optional(),
        targetEntityName: z.string().optional(),
        storyField: z.string().optional(),
      })
    )
    .default([]),
  ambiguities: z
    .array(
      z.object({
        phrase: z.string(),
        reason: z.string(),
        candidates: z.array(z.string()).default([]),
        clarifyingQuestion: z.string(),
      })
    )
    .default([]),
  warnings: z.array(z.string()).default([]),
});

export function stripMarkdownCodeFence(text: string): string {
  const trimmed = text.trim();
  const fenced = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
  if (fenced) {
    return fenced[1].trim();
  }
  return trimmed;
}

export function parseAndValidateBeliefGraph(rawText: string, prompt: string): BeliefState {
  const cleaned = stripMarkdownCodeFence(rawText);
  let parsedJson: unknown;
  try {
    parsedJson = JSON.parse(cleaned);
  } catch {
    throw new Error('INVALID_RESPONSE: Model returned malformed JSON for belief graph.');
  }

  const validated = RawBeliefGraphSchema.safeParse(parsedJson);
  if (!validated.success) {
    throw new Error(
      `INVALID_RESPONSE: Belief graph schema mismatch (${validated.error.issues[0]?.message ?? 'invalid structure'}).`
    );
  }

  return {
    prompt,
    entities: validated.data.entities.map((entity) => ({
      name: entity.name,
      category: entity.category as EntityCategory | undefined,
      presence_in_prompt: entity.presence_in_prompt,
      description: entity.description,
      alternatives: (entity.alternatives ?? []).map((name) => ({ name })),
      attributes: entity.attributes.map((attr) => ({
        name: attr.name,
        presence_in_prompt: attr.presence_in_prompt,
        value: attr.value.map((name) => ({ name })),
      })),
    })),
    relationships: validated.data.relationships.map((rel) => ({
      source: rel.source,
      target: rel.target,
      label: rel.label,
      alternatives: (rel.alternatives ?? []).map((name) => ({ name })),
    })),
  };
}

const VALID_STORY_FIELDS = new Set<keyof StoryBibleFields>([
  'genre',
  'tone',
  'narrativePerspective',
  'intendedAudience',
  'setting',
  'themes',
  'centralConflict',
  'pacing',
  'continuityRules',
  'explicitExclusions',
  'visualStyle',
  'cameraAndLighting',
]);

export function parseAndValidateClarifications(rawText: string): Clarification[] {
  const cleaned = stripMarkdownCodeFence(rawText);
  let parsedJson: unknown;
  try {
    parsedJson = JSON.parse(cleaned);
  } catch {
    throw new Error('INVALID_RESPONSE: Model returned malformed JSON for clarifications.');
  }

  const validated = RawClarificationsSchema.safeParse(parsedJson);
  if (!validated.success) {
    throw new Error(
      `INVALID_RESPONSE: Clarifications schema mismatch (${validated.error.issues[0]?.message ?? 'invalid structure'}).`
    );
  }

  return validated.data.map((item, idx) => {
    let target: QuestionTarget | undefined;
    if (item.targetType) {
      const storyField =
        item.targetStoryField && VALID_STORY_FIELDS.has(item.targetStoryField as keyof StoryBibleFields)
          ? (item.targetStoryField as keyof StoryBibleFields)
          : undefined;
      target = {
        type: item.targetType,
        entityName: item.targetEntityName || undefined,
        attributeName: item.targetAttributeName || undefined,
        storyField,
      };
    }

    return {
      id: `clar_${Date.now()}_${idx}`,
      question: item.question,
      options: item.options,
      target,
      category: item.category ?? 'general',
      impact: item.impact,
      status: 'unanswered',
    };
  });
}

export function parseAndValidateBatchEditResponse(
  rawText: string,
  instruction: string
): BatchEditProposalResult {
  const cleaned = stripMarkdownCodeFence(rawText);
  let parsedJson: unknown;
  try {
    parsedJson = JSON.parse(cleaned);
  } catch {
    throw new Error('INVALID_RESPONSE: Model returned malformed JSON for batch edit.');
  }

  const validated = RawBatchEditResponseSchema.safeParse(parsedJson);
  if (!validated.success) {
    throw new Error(
      `INVALID_RESPONSE: Batch edit schema mismatch (${validated.error.issues[0]?.message ?? 'invalid structure'}).`
    );
  }

  return {
    instruction,
    operations: validated.data.operations.map((op, index) => ({
      id: `op_${Date.now()}_${index}`,
      type: op.type,
      summary: op.summary,
      entityName: op.entityName,
      newEntityName: op.newEntityName,
      entityCategory: op.entityCategory,
      attributeName: op.attributeName,
      nextValue: op.nextValue,
      sourceEntityName: op.sourceEntityName,
      targetEntityName: op.targetEntityName,
      storyField:
        op.storyField && VALID_STORY_FIELDS.has(op.storyField as keyof StoryBibleFields)
          ? (op.storyField as keyof StoryBibleFields)
          : undefined,
      destructive: op.type === 'exclude_entity' || op.type === 'remove_relationship',
      selected: true,
    })),
    ambiguities: validated.data.ambiguities,
    warnings: validated.data.warnings,
  };
}
