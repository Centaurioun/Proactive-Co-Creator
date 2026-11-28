import { z } from 'zod';
import { EntityCategory } from './types';

export const CREATIVE_LOCK_SCOPES = ['project', 'session'] as const;
export type CreativeLockScope = (typeof CREATIVE_LOCK_SCOPES)[number];

export const CREATIVE_LOCK_HARDNESS = ['hard-structural', 'soft-advisory'] as const;
export type CreativeLockHardness = (typeof CREATIVE_LOCK_HARDNESS)[number];

export const CREATIVE_LOCK_TARGET_KINDS = [
  'entity',
  'attribute',
  'relationship',
  'story_bible',
  'section',
  'custom-rule',
] as const;
export type CreativeLockTargetKind = (typeof CREATIVE_LOCK_TARGET_KINDS)[number];

export const creativeLockSchema = z.strictObject({
  id: z.string().min(1).max(160),
  projectId: z.string().min(1).max(160),
  scope: z.enum(CREATIVE_LOCK_SCOPES).default('project'),
  hardness: z.enum(CREATIVE_LOCK_HARDNESS),
  targetKind: z.enum(CREATIVE_LOCK_TARGET_KINDS),
  targetId: z.string().min(1).max(160).optional(),
  targetLabel: z.string().min(1).max(240),
  attributeKey: z.string().min(1).max(160).optional(),
  /** When set on a hard-structural lock, any mutation changing away from expectedValue or deleting target is blocked */
  expectedValue: z.string().max(4000).optional(),
  /** Prevent deleting or modifying the locked target altogether */
  forbidMutation: z.boolean().default(true),
  ruleText: z.string().min(1).max(1000),
  active: z.boolean().default(true),
  version: z.number().int().min(1).default(1),
  createdAt: z.number(),
  updatedAt: z.number(),
});

export type CreativeLock = z.infer<typeof creativeLockSchema>;

export const UNIFIED_PROPOSAL_ORIGINS = [
  'writing-assist',
  'batch-edit',
  'diagnostics-fix',
  'narrative-sync',
  'manual',
] as const;
export type UnifiedProposalOrigin = (typeof UNIFIED_PROPOSAL_ORIGINS)[number];

export const UNIFIED_PROPOSAL_STATUSES = [
  'draft',
  'ready',
  'applied',
  'stale',
  'rejected',
] as const;
export type UnifiedProposalStatus = (typeof UNIFIED_PROPOSAL_STATUSES)[number];

export const unifiedManuscriptHunkSchema = z.strictObject({
  id: z.string().min(1).max(160),
  sectionId: z.string().min(1).max(160),
  sectionTitle: z.string().min(1).max(240),
  operation: z.enum(['replace', 'insert', 'delete']),
  startOffset: z.number().int().min(0),
  endOffset: z.number().int().min(0),
  expectedText: z.string().max(100000),
  replacementText: z.string().max(100000),
  rationale: z.string().max(2000),
  dependencyIds: z.array(z.string().min(1).max(160)).default([]),
});

export type UnifiedManuscriptHunk = z.infer<typeof unifiedManuscriptHunkSchema>;

export const unifiedModelOperationSchema = z.strictObject({
  id: z.string().min(1).max(160),
  targetType: z.enum(['entity', 'attribute', 'relationship', 'story_bible']),
  action: z.enum(['create', 'update', 'delete']),
  targetId: z.string().min(1).max(160),
  targetLabel: z.string().min(1).max(240),
  entityCategory: z.enum(['character', 'location', 'object', 'event', 'group', 'scene'] as [EntityCategory, ...EntityCategory[]]).optional(),
  field: z.string().min(1).max(160).optional(),
  beforeValue: z.string().max(50000).optional(),
  afterValue: z.string().max(50000).optional(),
  sourceEntityId: z.string().min(1).max(160).optional(),
  targetEntityId: z.string().min(1).max(160).optional(),
  relationshipType: z.string().min(1).max(160).optional(),
  rationale: z.string().max(2000),
  evidenceQuote: z.string().max(4000).optional(),
  evidenceSectionId: z.string().max(160).optional(),
  dependencyIds: z.array(z.string().min(1).max(160)).default([]),
});

export type UnifiedModelOperation = z.infer<typeof unifiedModelOperationSchema>;

export const unifiedProposalSchema = z.strictObject({
  schemaVersion: z.number().int().min(1).default(1),
  id: z.string().min(1).max(160),
  idempotencyKey: z.string().min(1).max(240),
  projectId: z.string().min(1).max(160),
  baseRevision: z.number().int().min(1),
  baseSnapshotDigest: z.string().min(1).max(240),
  baseManuscriptVersionId: z.string().min(1).max(160),
  originOperation: z.enum(UNIFIED_PROPOSAL_ORIGINS),
  title: z.string().min(1).max(320),
  rationale: z.string().max(4000),
  manuscriptHunks: z.array(unifiedManuscriptHunkSchema),
  modelOperations: z.array(unifiedModelOperationSchema),
  /** Explicitly selected hunk and model operation IDs for partial apply */
  selectedIds: z.array(z.string().min(1).max(160)),
  /** Deterministically recomputed digest of (baseRevision + selected edited operations) */
  patchDigest: z.string().min(1).max(240),
  status: z.enum(UNIFIED_PROPOSAL_STATUSES),
  createdAt: z.number(),
  updatedAt: z.number(),
  appliedAtRevision: z.number().int().min(1).optional(),
  appliedAt: z.number().optional(),
});

export type UnifiedProposal = z.infer<typeof unifiedProposalSchema>;

export interface ProposalConflictDiagnostic {
  id: string;
  severity: 'hard-block' | 'soft-warning';
  code:
    | 'STALE_BASE_REVISION'
    | 'INVALID_UTF16_SPAN'
    | 'EXPECTED_TEXT_MISMATCH'
    | 'OVERLAPPING_MANUSCRIPT_HUNKS'
    | 'UNMET_DEPENDENCY'
    | 'DANGLING_ENTITY_REFERENCE'
    | 'CONTRADICTORY_MODEL_MUTATION'
    | 'HARD_CREATIVE_LOCK_VIOLATION'
    | 'SOFT_CREATIVE_LOCK_ADVISORY';
  operationIds: string[];
  lockId?: string;
  message: string;
}
