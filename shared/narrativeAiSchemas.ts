import { z } from 'zod';

const storyFieldEnum = z.enum([
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

const compactEntitySchema = z.object({
  id: z.string().min(1).max(120),
  name: z.string().min(1).max(160),
  category: z.string().max(40).optional(),
  description: z.string().max(1_000).optional(),
  excluded: z.boolean().optional(),
  status: z.string().max(40).optional(),
  attributes: z.array(z.object({
    id: z.string().max(120).optional(),
    name: z.string().min(1).max(120),
    value: z.string().max(500),
    status: z.string().max(40).optional(),
  })).max(40),
});

const compactRelationshipSchema = z.object({
  id: z.string().max(120).optional(),
  sourceId: z.string().max(120).optional(),
  targetId: z.string().max(120).optional(),
  source: z.string().min(1).max(160),
  target: z.string().min(1).max(160),
  label: z.string().min(1).max(160),
  status: z.string().max(40).optional(),
});

const compactSectionSchema = z.object({
  id: z.string().min(1).max(120),
  title: z.string().min(1).max(200),
  kind: z.enum(['chapter', 'scene']),
  text: z.string().max(12_000),
});

export const AiUsageReportSchema = z.object({
  inputChars: z.number().int().nonnegative(),
  estimatedInputTokens: z.number().int().nonnegative(),
  providerInputTokens: z.number().int().nonnegative().optional(),
  actualPromptTokens: z.number().int().nonnegative().optional(),
  actualOutputTokens: z.number().int().nonnegative().optional(),
  actualTotalTokens: z.number().int().nonnegative().optional(),
  maxInputChars: z.number().int().positive(),
  maxInputTokens: z.number().int().positive(),
  maxOutputTokens: z.number().int().positive(),
  model: z.string().min(1),
  operation: z.string().min(1),
});

// 1. Diagnostics: Semantic Consistency Analysis
export const DiagnosticsAnalyzeRequestSchema = z.object({
  projectId: z.string().min(1).max(120),
  baseRevision: z.number().int().positive(),
  scope: z.enum(['full', 'scene', 'entity', 'changed']),
  scopeTargetId: z.string().max(120).optional(),
  entities: z.array(compactEntitySchema).max(80),
  relationships: z.array(compactRelationshipSchema).max(120),
  storyBible: z.record(z.string(), z.string().max(1_000)),
  sections: z.array(compactSectionSchema).max(20).optional(),
});

export const SemanticDiagnosticFindingSchema = z.object({
  title: z.string().min(1).max(200),
  description: z.string().min(1).max(1_200),
  category: z.enum([
    'trait_conflict',
    'setting_conflict',
    'relationship_conflict',
    'violated_exclusion',
    'continuity',
    'timeline',
    'manuscript_mismatch',
    'ambiguity',
  ]),
  severity: z.enum(['error', 'warning']),
  certainty: z.enum(['confirmed', 'inferred', 'possible']),
  targetKind: z.enum(['entity', 'relationship', 'story_bible', 'section']),
  targetId: z.string().max(120).optional(),
  storyField: storyFieldEnum.optional(),
  sectionId: z.string().max(120).optional(),
  evidenceQuote: z.string().max(400).optional(),
  suggestedAction: z.string().max(400).optional(),
});

export const DiagnosticsAnalyzeResponseSchema = z.object({
  findings: z.array(SemanticDiagnosticFindingSchema).max(20),
  coverageNote: z.string().min(1).max(500),
  usage: AiUsageReportSchema.optional(),
});

// 2. Diagnostics: Suggest Fixes (0-3 safe alternatives)
export const DiagnosticsSuggestFixesRequestSchema = z.object({
  projectId: z.string().min(1).max(120),
  baseRevision: z.number().int().positive(),
  issue: z.object({
    id: z.string().min(1).max(512),
    title: z.string().min(1).max(240),
    description: z.string().min(1).max(1_200),
    category: z.string().max(80).optional(),
    targetKind: z.string().max(40).optional(),
    targetId: z.string().max(120).optional(),
    storyField: storyFieldEnum.optional(),
    sectionId: z.string().max(120).optional(),
  }),
  entities: z.array(compactEntitySchema).max(60),
  relationships: z.array(compactRelationshipSchema).max(80),
  storyBible: z.record(z.string(), z.string().max(1_000)),
  sections: z.array(compactSectionSchema).max(6).optional(),
});

export const DiagnosticFixAlternativeSchema = z.object({
  id: z.string().min(1).max(120),
  title: z.string().min(1).max(180),
  reason: z.string().min(1).max(800),
  assumptions: z.array(z.string().min(1).max(300)).max(6),
  evidenceSummary: z.string().max(500),
  affectedScope: z.string().min(1).max(200),
  kind: z.enum([
    'story_bible',
    'entity_attribute',
    'entity_exclude',
    'relationship_update',
    'manuscript_patch',
    'manual_guidance',
  ]),
  storyField: storyFieldEnum.optional(),
  entityId: z.string().max(120).optional(),
  attributeName: z.string().max(120).optional(),
  relationshipId: z.string().max(120).optional(),
  sectionId: z.string().max(120).optional(),
  beforeText: z.string().max(1_500),
  afterText: z.string().max(1_500),
});

export const DiagnosticsSuggestFixesResponseSchema = z.object({
  alternatives: z.array(DiagnosticFixAlternativeSchema).max(3),
  usage: AiUsageReportSchema.optional(),
});

// 3. Manuscript <-> Canonical Model Sync
export const SyncAnalyzeRequestSchema = z.object({
  direction: z.enum(['manuscript-to-model', 'model-to-manuscript']),
  projectId: z.string().min(1).max(120),
  baseRevision: z.number().int().positive(),
  manuscriptVersionId: z.string().max(120).optional(),
  sections: z.array(compactSectionSchema).min(1).max(12),
  entities: z.array(compactEntitySchema).max(80),
  relationships: z.array(compactRelationshipSchema).max(100),
  storyBible: z.record(z.string(), z.string().max(1_000)),
  changedSectionIds: z.array(z.string().max(120)).max(20).optional(),
  changedEntityIds: z.array(z.string().max(120)).max(20).optional(),
});

export const SyncModelProposalSchema = z.object({
  id: z.string().min(1).max(120),
  kind: z.enum(['add_entity', 'update_attribute', 'add_relationship', 'update_story_bible', 'ambiguity']),
  title: z.string().min(1).max(200),
  rationale: z.string().min(1).max(800),
  evidenceQuote: z.string().min(1).max(500),
  sectionId: z.string().max(120).optional(),
  entityId: z.string().max(120).optional(),
  entityName: z.string().max(160).optional(),
  entityCategory: z.enum(['character', 'location', 'object', 'event', 'group', 'scene']).optional(),
  attributeName: z.string().max(120).optional(),
  sourceEntityName: z.string().max(160).optional(),
  targetEntityName: z.string().max(160).optional(),
  storyField: storyFieldEnum.optional(),
  currentValue: z.string().max(500).optional(),
  proposedValue: z.string().min(1).max(800),
  isAssumption: z.boolean(),
});

export const SyncManuscriptPatchSchema = z.object({
  id: z.string().min(1).max(120),
  sectionId: z.string().min(1).max(120),
  sectionTitle: z.string().min(1).max(200),
  rationale: z.string().min(1).max(800),
  linkedModelChange: z.string().min(1).max(240),
  originalExcerpt: z.string().min(1).max(1_500),
  proposedExcerpt: z.string().min(1).max(1_500),
  conflictNote: z.string().max(400).optional(),
});

export const SyncAnalyzeResponseSchema = z.object({
  direction: z.enum(['manuscript-to-model', 'model-to-manuscript']),
  modelProposals: z.array(SyncModelProposalSchema).max(15),
  manuscriptPatches: z.array(SyncManuscriptPatchSchema).max(10),
  coverageNote: z.string().min(1).max(500),
  usage: AiUsageReportSchema.optional(),
});

// 4. Contextual AI Writing Assistant
export const WritingAssistRequestSchema = z.object({
  projectId: z.string().min(1).max(120),
  baseRevision: z.number().int().positive(),
  manuscriptVersionId: z.string().max(120).optional(),
  sectionId: z.string().min(1).max(120),
  sectionTitle: z.string().min(1).max(200),
  action: z.enum(['continue', 'rewrite', 'clarity', 'shorten', 'expand', 'dialogue', 'alternatives', 'custom']),
  customInstruction: z.string().max(600).optional(),
  selectedText: z.string().max(6_000).optional(),
  contextBefore: z.string().max(4_000),
  contextAfter: z.string().max(4_000),
  confirmedEntities: z.array(z.object({
    name: z.string().max(160),
    summary: z.string().max(400),
  })).max(30),
  confirmedStoryBible: z.record(z.string(), z.string().max(500)),
  styleGuidance: z.array(z.string().max(300)).max(10).optional(),
});

export const WritingAssistProposalSchema = z.object({
  id: z.string().min(1).max(120),
  label: z.string().min(1).max(120),
  text: z.string().min(1).max(8_000),
  rationale: z.string().min(1).max(600),
  assumptions: z.array(z.string().max(240)).max(5),
});

export const WritingAssistResponseSchema = z.object({
  proposals: z.array(WritingAssistProposalSchema).min(1).max(3),
  usage: AiUsageReportSchema.optional(),
});

// 5. Creative Opportunities Exploration
export const OpportunitiesExploreRequestSchema = z.object({
  projectId: z.string().min(1).max(120),
  baseRevision: z.number().int().positive(),
  scope: z.enum(['project', 'scene', 'character']),
  scopeTargetId: z.string().max(120).optional(),
  categories: z.array(z.string().min(1).max(60)).min(1).max(10),
  customGoal: z.string().max(500).optional(),
  entities: z.array(compactEntitySchema).max(60),
  relationships: z.array(compactRelationshipSchema).max(80),
  storyBible: z.record(z.string(), z.string().max(1_000)),
  sections: z.array(compactSectionSchema).max(10).optional(),
  existingTitles: z.array(z.string().max(200)).max(50).optional(),
});

export const ExploredOpportunitySchema = z.object({
  title: z.string().min(1).max(180),
  category: z.string().min(1).max(60),
  rationale: z.string().min(1).max(900),
  options: z.array(z.string().min(1).max(300)).min(1).max(4),
  sourceRefs: z.array(z.string().min(1).max(120)).max(8),
  targetKind: z.enum(['project', 'section', 'entity']).optional(),
  targetId: z.string().max(120).optional(),
});

export const OpportunitiesExploreResponseSchema = z.object({
  opportunities: z.array(ExploredOpportunitySchema).max(6),
  coverageNote: z.string().min(1).max(400),
  usage: AiUsageReportSchema.optional(),
});

// 6. Post-Faithful Import Enhancement
export const ImportEnhanceRequestSchema = z.object({
  filename: z.string().min(1).max(200),
  sourceTextExcerpt: z.string().min(1).max(16_000),
  entities: z.array(z.object({
    name: z.string().max(160),
    category: z.string().max(40),
  })).max(50),
  sections: z.array(z.object({
    title: z.string().max(200),
    excerpt: z.string().max(2_000),
  })).max(12),
  goals: z.string().max(500).optional(),
});

export const ImportEnhancementProposalSchema = z.object({
  id: z.string().min(1).max(120),
  category: z.enum(['correction', 'clarity', 'pacing', 'character', 'continuity']),
  title: z.string().min(1).max(180),
  rationale: z.string().min(1).max(800),
  targetSectionTitle: z.string().max(200).optional(),
  beforeExcerpt: z.string().max(1_000).optional(),
  afterExcerpt: z.string().min(1).max(1_500),
  assumptions: z.array(z.string().max(240)).max(5),
});

export const ImportEnhanceResponseSchema = z.object({
  proposals: z.array(ImportEnhancementProposalSchema).max(8),
  coverageNote: z.string().min(1).max(400),
  usage: AiUsageReportSchema.optional(),
});

export type DiagnosticsAnalyzeRequest = z.infer<typeof DiagnosticsAnalyzeRequestSchema>;
export type DiagnosticsAnalyzeResponse = z.infer<typeof DiagnosticsAnalyzeResponseSchema>;
export type SemanticDiagnosticFinding = z.infer<typeof SemanticDiagnosticFindingSchema>;

export type DiagnosticsSuggestFixesRequest = z.infer<typeof DiagnosticsSuggestFixesRequestSchema>;
export type DiagnosticsSuggestFixesResponse = z.infer<typeof DiagnosticsSuggestFixesResponseSchema>;
export type DiagnosticFixAlternative = z.infer<typeof DiagnosticFixAlternativeSchema>;

export type SyncAnalyzeRequest = z.infer<typeof SyncAnalyzeRequestSchema>;
export type SyncAnalyzeResponse = z.infer<typeof SyncAnalyzeResponseSchema>;
export type SyncModelProposal = z.infer<typeof SyncModelProposalSchema>;
export type SyncManuscriptPatch = z.infer<typeof SyncManuscriptPatchSchema>;

export type WritingAssistRequest = z.infer<typeof WritingAssistRequestSchema>;
export type WritingAssistAction = WritingAssistRequest['action'];
export type WritingAssistResponse = z.infer<typeof WritingAssistResponseSchema>;
export type WritingAssistProposal = z.infer<typeof WritingAssistProposalSchema>;

export type OpportunitiesExploreRequest = z.infer<typeof OpportunitiesExploreRequestSchema>;
export type OpportunitiesExploreResponse = z.infer<typeof OpportunitiesExploreResponseSchema>;
export type ExploredOpportunity = z.infer<typeof ExploredOpportunitySchema>;

export type ImportEnhanceRequest = z.infer<typeof ImportEnhanceRequestSchema>;
export type ImportEnhanceResponse = z.infer<typeof ImportEnhanceResponseSchema>;
export type ImportEnhancementProposal = z.infer<typeof ImportEnhancementProposalSchema>;
export type AiUsageReport = z.infer<typeof AiUsageReportSchema>;
