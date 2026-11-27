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

export const MAX_PROMPT_CHARS = 8000;

export const NonEmptyPromptSchema = z
  .string()
  .trim()
  .min(1, 'Prompt cannot be empty.')
  .max(MAX_PROMPT_CHARS, `Prompt must be ${MAX_PROMPT_CHARS} characters or fewer.`);

export function validateEffectivePromptLength(
  prompt: string,
  maxChars: number = MAX_PROMPT_CHARS
): {
  ok: boolean;
  length: number;
  maxChars: number;
  overBy: number;
  error?: string;
} {
  const trimmed = prompt.trim();
  const length = trimmed.length;
  if (length === 0) {
    return {
      ok: false,
      length: 0,
      maxChars,
      overBy: 0,
      error: 'Prompt cannot be empty.',
    };
  }
  if (length > maxChars) {
    const overBy = length - maxChars;
    return {
      ok: false,
      length,
      maxChars,
      overBy,
      error: `Compiled prompt is ${length.toLocaleString()} characters, exceeding the ${maxChars.toLocaleString()}-character API limit by ${overBy.toLocaleString()} character(s). Shorten your seed idea, author notes, or Story Bible entries before submitting. Your local draft remains safely saved.`,
    };
  }
  return {
    ok: true,
    length,
    maxChars,
    overBy: 0,
  };
}

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
  presence_in_prompt: z.boolean().optional(),
  evidence_excerpt: z.string().trim().optional(),
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
  unhandledClauses: z.array(z.string()).default([]),
});

export function stripMarkdownCodeFence(text: string): string {
  const trimmed = text.trim();
  const fenced = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
  if (fenced) {
    return fenced[1].trim();
  }
  return trimmed;
}

const ENTITY_CATEGORY_MAP: Record<string, EntityCategory> = {
  character: 'character',
  person: 'character',
  protagonist: 'character',
  antagonist: 'character',
  creature: 'character',
  location: 'location',
  place: 'location',
  setting: 'location',
  environment: 'location',
  object: 'object',
  item: 'object',
  prop: 'object',
  artifact: 'object',
  event: 'event',
  action: 'event',
  group: 'group',
  faction: 'group',
  organization: 'group',
  crowd: 'group',
  scene: 'scene',
  story: 'scene',
  image: 'scene',
};

function nonEmptyString(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function normalizeNullableStringList(value: unknown): string[] | null | undefined {
  if (value === null || value === undefined) return value;
  if (!Array.isArray(value)) return undefined;
  return value.map((item) => nonEmptyString(item)).filter((item): item is string => Boolean(item));
}

function normalizeBeliefGraphPayload(raw: unknown): unknown {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return raw;
  const record = raw as Record<string, unknown>;
  const entities = Array.isArray(record.entities)
    ? record.entities.map((entry) => {
        if (!entry || typeof entry !== 'object' || Array.isArray(entry)) return entry;
        const entity = entry as Record<string, unknown>;
        const rawCategory = nonEmptyString(entity.category)?.toLowerCase();
        const category = rawCategory ? ENTITY_CATEGORY_MAP[rawCategory] : undefined;
        const attributes = Array.isArray(entity.attributes)
          ? entity.attributes
              .map((attrEntry) => {
                if (!attrEntry || typeof attrEntry !== 'object' || Array.isArray(attrEntry)) return attrEntry;
                const attr = attrEntry as Record<string, unknown>;
                const values = Array.isArray(attr.value)
                  ? attr.value.map((v) => nonEmptyString(v)).filter((v): v is string => Boolean(v))
                  : typeof attr.value === 'string' && attr.value.trim()
                    ? [attr.value.trim()]
                    : [];
                return {
                  ...attr,
                  presence_in_prompt: typeof attr.presence_in_prompt === 'boolean' ? attr.presence_in_prompt : false,
                  value: values.length > 0 ? values : ['unspecified'],
                };
              })
          : [];
        return {
          ...entity,
          ...(category ? { category } : { category: undefined }),
          presence_in_prompt: typeof entity.presence_in_prompt === 'boolean' ? entity.presence_in_prompt : false,
          description: typeof entity.description === 'string' ? entity.description.trim() : '',
          alternatives: normalizeNullableStringList(entity.alternatives),
          attributes,
        };
      })
    : record.entities;
  const relationships = Array.isArray(record.relationships)
    ? record.relationships.map((entry) => {
        if (!entry || typeof entry !== 'object' || Array.isArray(entry)) return entry;
        const rel = entry as Record<string, unknown>;
        return {
          ...rel,
          presence_in_prompt: typeof rel.presence_in_prompt === 'boolean' ? rel.presence_in_prompt : undefined,
          evidence_excerpt: nonEmptyString(rel.evidence_excerpt),
          alternatives: normalizeNullableStringList(rel.alternatives),
        };
      })
    : record.relationships;
  return { entities, relationships };
}

export function parseAndValidateBeliefGraph(rawText: string, prompt: string): BeliefState {
  const cleaned = stripMarkdownCodeFence(rawText);
  let parsedJson: unknown;
  try {
    parsedJson = JSON.parse(cleaned);
  } catch {
    throw new Error('INVALID_RESPONSE: Model returned malformed JSON for belief graph.');
  }

  const normalized = normalizeBeliefGraphPayload(parsedJson);
  const validated = RawBeliefGraphSchema.safeParse(normalized);
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
      presence_in_prompt: rel.presence_in_prompt,
      evidenceExcerpt: rel.evidence_excerpt,
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

const VALID_CLARIFY_TARGET_TYPES = new Set(['entity_attribute', 'relationship', 'story_bible', 'general']);
const VALID_CLARIFY_CATEGORIES = new Set(['character', 'setting', 'plot', 'tone', 'visual', 'general']);

function normalizeClarificationsPayload(raw: unknown): unknown {
  if (!Array.isArray(raw)) return raw;
  return raw.map((entry) => {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) return entry;
    const item = entry as Record<string, unknown>;
    const rawTargetType = nonEmptyString(item.targetType)?.toLowerCase();
    const rawCategory = nonEmptyString(item.category)?.toLowerCase();
    const rawStoryField = nonEmptyString(item.targetStoryField);
    const options = Array.isArray(item.options)
      ? item.options.map((o) => nonEmptyString(o)).filter((o): o is string => Boolean(o))
      : item.options;
    return {
      question: nonEmptyString(item.question) ?? item.question,
      options,
      targetType: rawTargetType && VALID_CLARIFY_TARGET_TYPES.has(rawTargetType) ? rawTargetType : undefined,
      targetEntityName: nonEmptyString(item.targetEntityName),
      targetAttributeName: nonEmptyString(item.targetAttributeName),
      targetStoryField: rawStoryField && VALID_STORY_FIELDS.has(rawStoryField as keyof StoryBibleFields) ? rawStoryField : undefined,
      category: rawCategory && VALID_CLARIFY_CATEGORIES.has(rawCategory) ? rawCategory : undefined,
      impact: nonEmptyString(item.impact),
    };
  });
}

export function parseAndValidateClarifications(rawText: string): Clarification[] {
  const cleaned = stripMarkdownCodeFence(rawText);
  let parsedJson: unknown;
  try {
    parsedJson = JSON.parse(cleaned);
  } catch {
    throw new Error('INVALID_RESPONSE: Model returned malformed JSON for clarifications.');
  }

  const normalized = normalizeClarificationsPayload(parsedJson);
  const validated = RawClarificationsSchema.safeParse(normalized);
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

function normalizeBatchEditPayload(raw: unknown): unknown {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return raw;
  const record = raw as Record<string, unknown>;
  const operations = Array.isArray(record.operations)
    ? record.operations.map((entry) => {
        if (!entry || typeof entry !== 'object' || Array.isArray(entry)) return entry;
        const op = entry as Record<string, unknown>;
        const rawCategory = nonEmptyString(op.entityCategory)?.toLowerCase();
        const normalizedCategory = rawCategory ? ENTITY_CATEGORY_MAP[rawCategory] : undefined;
        let nextValue = nonEmptyString(op.nextValue);
        let targetEntityName = nonEmptyString(op.targetEntityName);
        if (op.type === 'update_story_bible' && !nextValue && targetEntityName) {
          nextValue = targetEntityName;
          targetEntityName = undefined;
        }
        return {
          ...op,
          summary: nonEmptyString(op.summary) ?? op.summary,
          entityName: nonEmptyString(op.entityName),
          newEntityName: nonEmptyString(op.newEntityName),
          entityCategory: normalizedCategory,
          attributeName: nonEmptyString(op.attributeName),
          nextValue,
          sourceEntityName: nonEmptyString(op.sourceEntityName),
          targetEntityName,
          storyField: nonEmptyString(op.storyField),
        };
      })
    : [];
  const ambiguities = Array.isArray(record.ambiguities) ? record.ambiguities : [];
  const warnings = Array.isArray(record.warnings) ? record.warnings : [];
  const unhandledClauses = Array.isArray(record.unhandledClauses) ? record.unhandledClauses : [];
  return { operations, ambiguities, warnings, unhandledClauses };
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

  const normalized = normalizeBatchEditPayload(parsedJson);
  const validated = RawBatchEditResponseSchema.safeParse(normalized);
  if (!validated.success) {
    throw new Error(
      `INVALID_RESPONSE: Batch edit schema mismatch (${validated.error.issues[0]?.message ?? 'invalid structure'}).`
    );
  }

  const operations = validated.data.operations.map((op, index) => ({
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
  }));

  return {
    proposalId: `batch_ai_${Date.now()}`,
    instruction,
    operations,
    ambiguities: validated.data.ambiguities,
    warnings: validated.data.warnings,
    unhandledClauses: validated.data.unhandledClauses,
    coverageComplete:
      validated.data.unhandledClauses.length === 0 &&
      validated.data.ambiguities.length === 0 &&
      operations.length > 0,
  };
}
