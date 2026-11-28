import { z } from 'zod';

const nonBlank = (maximum: number) => z.string().min(1).max(maximum).refine(value => value.trim().length > 0, 'Must not be blank.');

export const ExtractionEvidenceSchema = z.strictObject({
  start: z.number().int().nonnegative().optional(),
  end: z.number().int().positive().optional(),
  quote: z.string().min(1).max(1200),
});

const kind = z.enum(['explicit', 'interpretation', 'belief', 'reported', 'ambiguous']);
const finding = z.strictObject({
  id: z.string().min(1).max(120),
  title: nonBlank(240),
  value: z.string().max(2000),
  category: z.enum(['character', 'location', 'object', 'event', 'theme', 'style', 'story-bible', 'other']),
  kind,
  rationale: z.string().max(500),
  evidence: ExtractionEvidenceSchema,
});

export const NarrativeExtractionSchema = z.strictObject({
  findings: z.array(finding).max(300),
  entities: z.array(z.strictObject({
    id: z.string().min(1).max(120),
    name: nonBlank(200),
    category: z.enum(['character', 'location', 'object', 'event', 'group', 'scene']),
    description: z.string().max(2000),
    aliases: z.array(z.string().max(200)).max(20),
    attributes: z.array(z.strictObject({
      id: z.string().min(1).max(120), name: nonBlank(120), value: z.string().max(1000),
      kind, rationale: z.string().max(500), evidence: ExtractionEvidenceSchema,
    })).max(50),
    kind,
    rationale: z.string().max(500),
    evidence: ExtractionEvidenceSchema,
  })).max(150),
  relationships: z.array(z.strictObject({
    id: z.string().min(1).max(120), source: nonBlank(200), target: nonBlank(200),
    label: nonBlank(200), kind, rationale: z.string().max(500), evidence: ExtractionEvidenceSchema,
  })).max(250),
  ambiguities: z.array(z.strictObject({
    id: z.string().min(1).max(120), title: nonBlank(240), detail: z.string().max(1000),
    severity: z.enum(['info', 'low', 'medium', 'high']), certainty: z.enum(['uncertain', 'possible', 'likely', 'confirmed']),
    rationale: z.string().max(500), evidence: ExtractionEvidenceSchema,
  })).max(100),
});

export const NarrativeExtractionRequestSchema = z.strictObject({
  sourceId: z.string().min(1).max(120),
  sourceVersion: z.string().min(1).max(120),
  digest: z.string().min(1).max(128),
  chunkId: z.string().min(1).max(120),
  text: z.string().min(1).max(36_000),
  scope: z.enum(['complete', 'selective']),
  categories: z.array(z.enum(['characters', 'attributes', 'relationships', 'locations', 'objects', 'events', 'story-bible', 'themes-style', 'continuity'])).max(9)
    .refine(categories => new Set(categories).size === categories.length, 'Extraction categories must be unique.'),
  instruction: z.string().max(1000).default(''),
  providerPlanBinding: z.object({
    connectionId: z.enum(['gemini-managed', 'gemini-personal', 'chatgpt-plan', 'openai-api']),
    modelId: z.string().min(1).max(160),
    reasoningLevel: z.enum(['default', 'none', 'minimal', 'low', 'medium', 'high', 'extra-high', 'max']),
    capabilityPolicyVersion: z.string().min(1).max(100),
    credentialAuthorityId: z.string().min(1).max(256),
  }).strict().optional(),
}).superRefine((request, context) => {
  if (request.scope === 'selective' && request.categories.length === 0) {
    context.addIssue({ code: 'custom', message: 'Choose at least one extraction category for selective analysis.', path: ['categories'] });
  }
});

export type NarrativeExtraction = z.infer<typeof NarrativeExtractionSchema>;
export type NarrativeExtractionRequest = z.infer<typeof NarrativeExtractionRequestSchema>;
