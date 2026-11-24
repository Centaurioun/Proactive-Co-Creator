import { z } from 'zod';

const id = z.string().min(1);
const offset = z.number().int().nonnegative();

export const sectionSchema = z.strictObject({
  id,
  kind: z.enum(['chapter', 'scene']),
  title: z.string(),
  text: z.string(),
  chapterId: id.optional(),
  derivedFrom: z.array(id).optional(),
  synopsis: z.string().optional(),
  pov: z.string().optional(),
  location: z.string().optional(),
  chronology: z.string().optional(),
  purpose: z.string().optional(),
  characters: z.string().optional(),
  status: z.enum(['draft', 'revised', 'final']).optional(),
});

export const artifactAnchorSchema = z.strictObject({
  artifactId: id,
  start: offset,
  end: offset,
  excerpt: z.string(),
});

const sourceSchema = z.strictObject({
  id,
  version: id,
  digest: id,
  text: z.string(),
  filename: z.string().optional(),
  mediaType: z.string().optional(),
  byteLength: offset.optional(),
  parserVersion: z.string().optional(),
  createdAt: offset.optional(),
  retention: z.enum(['original-and-extracted', 'extracted-only']).default('extracted-only'),
  originalBytesBase64: z.string().regex(/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/).optional(),
  blocks: z.array(z.strictObject({
    id, start: offset, end: offset, kind: z.enum(['paragraph', 'heading']), label: z.string().optional(), pageNumber: offset.optional(),
  })).default([]),
  analysisCoverage: z.strictObject({
    complete: z.boolean(), scope: z.enum(['complete', 'selective']), categories: z.array(z.string()),
    totalCharacters: offset,
    processedSpans: z.array(z.strictObject({ start: offset, end: offset })),
    failedSegments: offset, calls: offset, instruction: z.string().max(1000).optional(),
  }).optional(),
}).superRefine((source, context) => {
  if (source.retention === 'original-and-extracted' && !source.originalBytesBase64) {
    context.addIssue({ code: 'custom', message: 'Original file retention requires the original bytes.', path: ['originalBytesBase64'] });
  }
  if (source.originalBytesBase64 !== undefined) {
    const decodedLength = Math.floor(source.originalBytesBase64.length * 3 / 4) - (source.originalBytesBase64.endsWith('==') ? 2 : source.originalBytesBase64.endsWith('=') ? 1 : 0);
    if (decodedLength !== source.byteLength) context.addIssue({ code: 'custom', message: 'Original file byte length does not match the retained bytes.', path: ['byteLength'] });
    if (source.retention !== 'original-and-extracted') context.addIssue({ code: 'custom', message: 'Retained original bytes require original-and-extracted retention.', path: ['retention'] });
  }
});

const styleProfileSchema = z.strictObject({
  projectId: id,
  observations: z.array(z.strictObject({
    id,
    trait: z.enum(['pov', 'voice', 'tense', 'rhythm', 'dialogue', 'atmosphere']),
    value: z.string().min(1).max(240),
    interpretation: z.enum(['observation', 'interpretation']),
    scope: z.union([
      z.strictObject({ kind: z.literal('manuscript') }),
      z.strictObject({ kind: z.literal('section'), sectionId: id }),
    ]),
    evidence: z.strictObject({ kind: z.literal('source'), recordId: id, version: id, digest: id, start: offset, end: offset, excerpt: z.string().max(2000) }),
    status: z.enum(['pending', 'confirmed', 'rejected']),
  })),
});

const evidenceSchema = z.strictObject({
  sourceId: id,
  version: id,
  digest: id,
  start: offset,
  end: offset,
  excerpt: z.string(),
});

const importProposalSchema = z.strictObject({
  id,
  kind: z.enum(['entity', 'attribute', 'relationship', 'finding', 'ambiguity']),
  label: z.string(),
  detail: z.string(),
  category: z.string(),
  approval: z.enum(['pending', 'confirmed', 'rejected']),
  rationale: z.string(),
  evidence: evidenceSchema,
});

export const narrativeSchema = z.strictObject({
  versions: z.array(z.strictObject({ id, sectionVersionIds: z.array(id), styleProfile: styleProfileSchema.optional() })),
  sectionVersions: z.array(z.strictObject({ id, section: sectionSchema })),
  sources: z.array(sourceSchema),
  claims: z.array(z.strictObject({
    id,
    targetId: id,
    rationale: z.string(),
    approval: z.enum(['pending', 'confirmed', 'rejected']),
    freshness: z.enum(['current', 'needs-recheck', 'historical']),
    anchors: z.array(evidenceSchema).min(1),
  })),
  proposals: z.array(importProposalSchema).optional(),
  issues: z.array(z.strictObject({
    id,
    fingerprint: id,
    title: z.string(),
    disposition: z.enum(['open', 'deferred', 'needs-clarification', 'proposed-fix', 'resolved', 'dismissed']),
    freshness: z.enum(['current', 'needs-recheck', 'historical']),
    reason: z.string(),
    anchors: z.array(evidenceSchema),
    affectedTargetIds: z.array(id).default([]),
    severity: z.enum(['info', 'low', 'medium', 'high']).default('medium'),
    certainty: z.enum(['uncertain', 'possible', 'likely', 'confirmed']).default('possible'),
    dispositionReason: z.string().optional(),
    updatedAt: offset.optional(),
    history: z.array(z.strictObject({
      disposition: z.enum(['open', 'deferred', 'needs-clarification', 'proposed-fix', 'resolved', 'dismissed']),
      time: offset,
      reason: z.string(),
      projectRevision: offset,
    })).default([]),
  })),
  audit: z.array(z.strictObject({
    id,
    action: z.enum(['write', 'adopt', 'undo', 'redo', 'restore', 'issue']),
    time: offset,
    baseRevision: offset,
    resultRevision: offset,
    before: id.optional(),
    after: id.optional(),
    issueId: id.optional(),
    issueDisposition: z.enum(['open', 'deferred', 'needs-clarification', 'proposed-fix', 'resolved', 'dismissed']).optional(),
    reason: z.string(),
    artifact: artifactAnchorSchema.optional(),
  })),
});
