import { z } from 'zod';
import { creativeLockSchema } from './unifiedProposalTypes';

/**
 * PCC-EV-WP03 — Engine E2: Persistent CreativeSession, Idea Card Lineage,
 * Voluntary Adaptive Interview (Grill Me), and Reading Margin Notes Schemas.
 *
 * All creative exploration, directions, idea versions, interview rounds, and
 * non-canonical draft sketches remain non-canonical until explicitly staged and
 * applied through Engine E3 (UnifiedProposalEngine).
 */

export const CREATIVE_STUDIO_MODES = [
  'discover',
  'guided',
  'focused',
  'story-lab',
] as const;
export const creativeStudioModeSchema = z.enum(CREATIVE_STUDIO_MODES);
export type CreativeStudioMode = z.infer<typeof creativeStudioModeSchema>;

export const INTERVIEW_BEHAVIORAL_MODES = [
  'inspire',
  'explore',
  'grill',
  'challenge',
] as const;
export const interviewBehavioralModeSchema = z.enum(INTERVIEW_BEHAVIORAL_MODES);
export type InterviewBehavioralMode = z.infer<typeof interviewBehavioralModeSchema>;

export const CREATIVE_INTENSITY_LEVELS = [
  'subtle',
  'balanced',
  'bold',
  'radical',
] as const;
export const creativeIntensityLevelSchema = z.enum(CREATIVE_INTENSITY_LEVELS);
export type CreativeIntensityLevel = z.infer<typeof creativeIntensityLevelSchema>;

export const CREATIVE_SESSION_STATUSES = [
  'active',
  'paused',
  'completed',
  'archived',
  'dismissed',
] as const;
export const creativeSessionStatusSchema = z.enum(CREATIVE_SESSION_STATUSES);
export type CreativeSessionStatus = z.infer<typeof creativeSessionStatusSchema>;

export const CREATIVE_SCOPE_KINDS = [
  'seed',
  'project',
  'section',
  'passage',
  'entity',
  'relationship',
  'event',
  'location',
  'object',
  'multi-target',
] as const;
export const creativeScopeKindSchema = z.enum(CREATIVE_SCOPE_KINDS);
export type CreativeScopeKind = z.infer<typeof creativeScopeKindSchema>;

export const creativePassageSelectionSchema = z.strictObject({
  sectionId: z.string().min(1),
  sectionTitle: z.string().default(''),
  startOffset: z.number().int().min(0),
  endOffset: z.number().int().min(0),
  selectedText: z.string(),
  sectionDigest: z.string().min(1),
});
export type CreativePassageSelection = z.infer<typeof creativePassageSelectionSchema>;

export const creativeSessionScopeSchema = z.strictObject({
  kind: creativeScopeKindSchema.default('project'),
  seedPrompt: z.string().default(''),
  sectionIds: z.array(z.string()).default([]),
  entityIds: z.array(z.string()).default([]),
  relationshipIds: z.array(z.string()).default([]),
  eventIds: z.array(z.string()).default([]),
  passage: creativePassageSelectionSchema.optional(),
  focusSummary: z.string().default('Whole project canon'),
});
export type CreativeSessionScope = z.infer<typeof creativeSessionScopeSchema>;

export const CREATIVE_DIRECTION_ORIGINS = [
  'ai-suggested',
  'user-custom',
  'surprise-me',
] as const;
export const creativeDirectionOriginSchema = z.enum(CREATIVE_DIRECTION_ORIGINS);
export type CreativeDirectionOrigin = z.infer<typeof creativeDirectionOriginSchema>;

export const creativeDirectionOptionSchema = z.strictObject({
  id: z.string().min(1),
  label: z.string().min(1),
  description: z.string().default(''),
  category: z.string().default('Plot & Tension'),
  selected: z.boolean().default(false),
  origin: creativeDirectionOriginSchema.default('ai-suggested'),
  createdAt: z.string().min(1),
});
export type CreativeDirectionOption = z.infer<typeof creativeDirectionOptionSchema>;

export const EPISTEMIC_IDEA_STATUSES = [
  'inspiration',
  'hypothesis',
  'confirmed-fact',
  'concrete-patch',
] as const;
export const epistemicIdeaStatusSchema = z.enum(EPISTEMIC_IDEA_STATUSES);
export type EpistemicIdeaStatus = z.infer<typeof epistemicIdeaStatusSchema>;

export const creativeIdeaSourceRefSchema = z.strictObject({
  sourceId: z.string().min(1),
  sourceKind: z.enum(['manuscript-section', 'entity', 'relationship', 'memory-chunk', 'session-answer']),
  label: z.string().min(1),
  excerpt: z.string().default(''),
  sectionDigest: z.string().optional(),
});
export type CreativeIdeaSourceRef = z.infer<typeof creativeIdeaSourceRefSchema>;

export const creativeIdeaPatchBlueprintSchema = z.strictObject({
  targetSectionId: z.string().optional(),
  targetSectionTitle: z.string().optional(),
  proposedProse: z.string().default(''),
  operationMode: z.enum(['append-section', 'replace-selection', 'create-entity', 'update-entity', 'world-note']).default('append-section'),
  entityName: z.string().optional(),
  entityType: z.string().optional(),
  entitySummary: z.string().optional(),
});
export type CreativeIdeaPatchBlueprint = z.infer<typeof creativeIdeaPatchBlueprintSchema>;

export const creativeIdeaVersionSchema = z.strictObject({
  versionId: z.string().min(1),
  versionNumber: z.number().int().min(1),
  title: z.string().min(1),
  summary: z.string().min(1),
  rationale: z.string().default(''),
  directionIds: z.array(z.string()).default([]),
  epistemicStatus: epistemicIdeaStatusSchema.default('hypothesis'),
  sourceRefs: z.array(creativeIdeaSourceRefSchema).default([]),
  assumptions: z.array(z.string()).default([]),
  possibleConsequences: z.array(z.string()).default([]),
  challengeCritique: z.string().optional(),
  alternativeExplanation: z.string().optional(),
  craftNote: z.string().optional(),
  patchBlueprint: creativeIdeaPatchBlueprintSchema.optional(),
  stagedProposalId: z.string().optional(),
  isOutdated: z.boolean().default(false),
  createdAt: z.string().min(1),
});
export type CreativeIdeaVersion = z.infer<typeof creativeIdeaVersionSchema>;

export const CREATIVE_IDEA_CARD_STATUSES = [
  'draft',
  'bookmarked',
  'selected',
  'in-collection',
  'staged',
  'applied',
  'dismissed',
  'archived',
] as const;
export const creativeIdeaCardStatusSchema = z.enum(CREATIVE_IDEA_CARD_STATUSES);
export type CreativeIdeaCardStatus = z.infer<typeof creativeIdeaCardStatusSchema>;

export const creativeIdeaCardSchema = z.strictObject({
  id: z.string().min(1),
  projectId: z.string().min(1),
  sessionId: z.string().min(1),
  branchId: z.string().min(1),
  activeVersionId: z.string().min(1),
  versions: z.array(creativeIdeaVersionSchema).min(1),
  parentIdeaId: z.string().optional(),
  combinedFromIdeaIds: z.array(z.string()).default([]),
  status: creativeIdeaCardStatusSchema.default('draft'),
  previousStatusBeforeDismiss: creativeIdeaCardStatusSchema.optional(),
  tags: z.array(z.string()).default([]),
  notes: z.string().default(''),
  baseRevision: z.number().int().min(0),
  baseSnapshotDigest: z.string().min(1),
  createdAt: z.string().min(1),
  updatedAt: z.string().min(1),
});
export type CreativeIdeaCard = z.infer<typeof creativeIdeaCardSchema>;

export const GUIDED_QUESTION_ANSWER_STATUSES = [
  'unanswered',
  'answered',
  'skipped',
  'deferred-mystery',
] as const;
export const guidedQuestionAnswerStatusSchema = z.enum(GUIDED_QUESTION_ANSWER_STATUSES);
export type GuidedQuestionAnswerStatus = z.infer<typeof guidedQuestionAnswerStatusSchema>;

export const guidedQuestionItemSchema = z.strictObject({
  id: z.string().min(1),
  roundNumber: z.number().int().min(1),
  mode: interviewBehavioralModeSchema.default('explore'),
  question: z.string().min(1),
  rationale: z.string().default(''),
  recommendedAnswer: z.string().default(''),
  recommendedWhy: z.string().default(''),
  options: z.array(z.string()).default([]),
  allowMultiple: z.boolean().default(true),
  knownFactsUsed: z.array(z.string()).default([]),
  answerStatus: guidedQuestionAnswerStatusSchema.default('unanswered'),
  selectedOptions: z.array(z.string()).default([]),
  customAnswer: z.string().default(''),
  answeredAt: z.string().optional(),
  branchId: z.string().min(1),
  isOutdated: z.boolean().default(false),
});
export type GuidedQuestionItem = z.infer<typeof guidedQuestionItemSchema>;

export const DRAFT_SKETCH_EPISTEMIC_LABELS = [
  'known-canon',
  'hypothesized',
  'author-chosen',
  'open-mystery',
] as const;
export const draftSketchEpistemicLabelSchema = z.enum(DRAFT_SKETCH_EPISTEMIC_LABELS);
export type DraftSketchEpistemicLabel = z.infer<typeof draftSketchEpistemicLabelSchema>;

export const draftSketchNodeSchema = z.strictObject({
  id: z.string().min(1),
  label: z.string().min(1),
  kind: z.enum(['character', 'location', 'event', 'conflict', 'theme', 'mystery', 'rule']).default('conflict'),
  epistemicLabel: draftSketchEpistemicLabelSchema.default('hypothesized'),
  detail: z.string().default(''),
  sourceQuestionId: z.string().optional(),
});
export type DraftSketchNode = z.infer<typeof draftSketchNodeSchema>;

export const draftSketchEdgeSchema = z.strictObject({
  id: z.string().min(1),
  fromNodeId: z.string().min(1),
  toNodeId: z.string().min(1),
  relationLabel: z.string().min(1),
  epistemicLabel: draftSketchEpistemicLabelSchema.default('hypothesized'),
});
export type DraftSketchEdge = z.infer<typeof draftSketchEdgeSchema>;

export const creativeDraftSketchSchema = z.strictObject({
  nodes: z.array(draftSketchNodeSchema).default([]),
  edges: z.array(draftSketchEdgeSchema).default([]),
});
export type CreativeDraftSketch = z.infer<typeof creativeDraftSketchSchema>;

export const creativeConceptPreviewSchema = z.strictObject({
  title: z.string().min(1),
  summary: z.string().min(1),
  possibleConnections: z.array(z.string()).default([]),
  unresolvedQuestions: z.array(z.string()).default([]),
  craftNote: z.string().optional(),
  alternativeFraming: z.string().optional(),
  updatedAt: z.string().min(1),
});
export type CreativeConceptPreview = z.infer<typeof creativeConceptPreviewSchema>;

export const creativeSessionBranchSchema = z.strictObject({
  id: z.string().min(1),
  label: z.string().min(1),
  parentBranchId: z.string().optional(),
  forkedFromQuestionId: z.string().optional(),
  createdAt: z.string().min(1),
});
export type CreativeSessionBranch = z.infer<typeof creativeSessionBranchSchema>;

export const creativeSessionSchema = z.strictObject({
  id: z.string().min(1),
  projectId: z.string().min(1),
  title: z.string().min(1),
  mode: creativeStudioModeSchema.default('discover'),
  interviewMode: interviewBehavioralModeSchema.default('explore'),
  status: creativeSessionStatusSchema.default('active'),
  baseRevision: z.number().int().min(0),
  baseSnapshotDigest: z.string().min(1),
  scope: creativeSessionScopeSchema,
  goal: z.string().default(''),
  customInstruction: z.string().default(''),
  intensity: creativeIntensityLevelSchema.default('balanced'),
  compassSummary: z.string().default('Grounded literary character & tension focus'),
  preservationConstraints: z.array(z.string()).default([]),
  sessionLocks: z.array(creativeLockSchema).default([]),
  activeBranchId: z.string().min(1),
  branches: z.array(creativeSessionBranchSchema).min(1),
  directions: z.array(creativeDirectionOptionSchema).default([]),
  ideaCardIds: z.array(z.string()).default([]),
  questions: z.array(guidedQuestionItemSchema).default([]),
  draftSketch: creativeDraftSketchSchema.default({ nodes: [], edges: [] }),
  conceptPreview: creativeConceptPreviewSchema.optional(),
  stagedProposalIds: z.array(z.string()).default([]),
  createdAt: z.string().min(1),
  updatedAt: z.string().min(1),
});
export type CreativeSession = z.infer<typeof creativeSessionSchema>;

export const READING_MARGIN_NOTE_STATUSES = [
  'open',
  'resolved',
  'archived',
] as const;
export const readingMarginNoteStatusSchema = z.enum(READING_MARGIN_NOTE_STATUSES);
export type ReadingMarginNoteStatus = z.infer<typeof readingMarginNoteStatusSchema>;

export const readingMarginNoteSchema = z.strictObject({
  id: z.string().min(1),
  projectId: z.string().min(1),
  sectionId: z.string().min(1),
  sectionTitle: z.string().default(''),
  baseRevision: z.number().int().min(0),
  textDigest: z.string().min(1),
  startOffset: z.number().int().min(0),
  endOffset: z.number().int().min(0),
  quotedExcerpt: z.string(),
  noteText: z.string().min(1),
  status: readingMarginNoteStatusSchema.default('open'),
  linkedSessionId: z.string().optional(),
  createdAt: z.string().min(1),
  updatedAt: z.string().min(1),
});
export type ReadingMarginNote = z.infer<typeof readingMarginNoteSchema>;
