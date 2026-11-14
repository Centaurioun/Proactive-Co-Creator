/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { z } from 'zod';
import type { BeliefState, Clarification } from './types.ts';

export const GenerationModeSchema = z.enum(['image', 'story', 'video']);

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

// --- Untrusted Gemini JSON output validation schemas ---

const RawAttributeSchema = z.object({
  name: z.string().trim().min(1),
  presence_in_prompt: z.boolean(),
  value: z.array(z.string().trim().min(1)).min(1),
});

const RawEntitySchema = z.object({
  name: z.string().trim().min(1),
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
});

export const RawClarificationsSchema = z.array(RawClarificationItemSchema).min(1);

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

  return validated.data.map((item) => ({
    question: item.question,
    options: item.options,
  }));
}
