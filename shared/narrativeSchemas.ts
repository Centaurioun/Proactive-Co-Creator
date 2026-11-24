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
});

const evidenceSchema = z.strictObject({
  sourceId: id,
  version: id,
  digest: id,
  start: offset,
  end: offset,
  excerpt: z.string(),
});

export const narrativeSchema = z.strictObject({
  versions: z.array(z.strictObject({ id, sectionVersionIds: z.array(id) })),
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
  issues: z.array(z.strictObject({
    id,
    fingerprint: id,
    title: z.string(),
    disposition: z.enum(['open', 'deferred', 'needs-clarification', 'proposed-fix', 'resolved', 'dismissed']),
    freshness: z.enum(['current', 'needs-recheck', 'historical']),
    reason: z.string(),
    anchors: z.array(evidenceSchema),
  })),
  audit: z.array(z.strictObject({
    id,
    action: z.enum(['write', 'adopt', 'undo', 'redo', 'restore', 'issue']),
    time: offset,
    baseRevision: offset,
    resultRevision: offset,
    before: id.optional(),
    after: id.optional(),
    reason: z.string(),
    artifact: artifactAnchorSchema.optional(),
  })),
});
