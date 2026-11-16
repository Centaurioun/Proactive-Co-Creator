/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

export type GenerationMode = 'story' | 'image';

export type DecisionProvenance =
  | 'prompt-explicit'
  | 'user-edit'
  | 'accepted-suggestion'
  | 'ai-inferred'
  | 'imported'
  | 'derived';

export type ApprovalStatus = 'confirmed' | 'pending' | 'rejected';

export type EntityCategory = 'character' | 'location' | 'object' | 'event' | 'group' | 'scene';

export interface Candidate {
  name: string;
}

export interface Attribute {
  id?: string;
  name: string;
  presence_in_prompt: boolean;
  value: Candidate[];
  confirmedValue?: string;
  status?: ApprovalStatus;
  provenance?: DecisionProvenance;
  updatedAt?: number;
}

export interface Entity {
  id?: string;
  name: string;
  category?: EntityCategory;
  presence_in_prompt: boolean;
  description: string;
  alternatives: Candidate[] | null;
  attributes: Attribute[];
  status?: ApprovalStatus;
  provenance?: DecisionProvenance;
  excluded?: boolean;
  groupId?: string;
  aliases?: string[];
}

export interface Relationship {
  id?: string;
  sourceId?: string;
  targetId?: string;
  source: string;
  target: string;
  label: string;
  alternatives?: Candidate[];
  status?: ApprovalStatus;
  provenance?: DecisionProvenance;
  presence_in_prompt?: boolean;
  evidenceExcerpt?: string;
}

export interface BeliefState {
  entities: Entity[];
  relationships: Relationship[];
  prompt?: string;
}

export interface QuestionTarget {
  type: 'entity_attribute' | 'relationship' | 'story_bible' | 'general';
  entityId?: string;
  entityName?: string;
  attributeName?: string;
  relationshipId?: string;
  storyField?: keyof StoryBibleFields;
}

export interface Clarification {
  id?: string;
  question: string;
  options: string[];
  target?: QuestionTarget;
  category?: 'character' | 'setting' | 'plot' | 'tone' | 'visual' | 'general';
  impact?: string;
  status?: 'unanswered' | 'pending' | 'answered' | 'skipped' | 'deferred' | 'outdated';
  outdatedReason?: string;
}

export interface ClarificationAnswer {
  questionId?: string;
  question: string;
  answer: string;
  target?: QuestionTarget;
}

export type GraphUpdate =
  | { type: 'attribute'; entityId?: string; entity: string; attribute: string; value: string }
  | {
      type: 'relationship';
      relationshipId?: string;
      source: string;
      target: string;
      oldLabel: string;
      newLabel: string;
    };

// --- Canonical Creative Project Model (Proactive Co-Creator 2.0) ---

export interface StoryBibleField<T = string> {
  value: T;
  status: ApprovalStatus;
  provenance: DecisionProvenance;
  updatedAt: number;
}

export interface StoryBibleFields {
  genre: string;
  tone: string;
  narrativePerspective: string;
  intendedAudience: string;
  setting: string;
  themes: string;
  centralConflict: string;
  pacing: string;
  continuityRules: string;
  explicitExclusions: string;
  visualStyle: string;
  cameraAndLighting: string;
}

export type StoryBible = {
  [K in keyof StoryBibleFields]: StoryBibleField<StoryBibleFields[K]>;
};

export type DecisionCategory =
  | 'clarification'
  | 'entity'
  | 'attribute'
  | 'relationship'
  | 'story-bible'
  | 'conflict'
  | 'batch-operation';

export type DecisionStatus = 'pending' | 'accepted' | 'rejected' | 'deferred' | 'outdated';

export interface DecisionItem {
  id: string;
  category: DecisionCategory;
  title: string;
  description: string;
  explanation?: string;
  provenance: DecisionProvenance;
  status: DecisionStatus;
  groupKey: 'character' | 'setting' | 'plot' | 'story' | 'visual';
  targetEntityId?: string;
  targetEntityName?: string;
  targetAttributeName?: string;
  targetRelationshipId?: string;
  targetSourceEntityName?: string;
  targetTargetEntityName?: string;
  targetStoryField?: keyof StoryBibleFields;
  questionId?: string;
  currentValue?: string;
  proposedValue: string;
  options?: string[];
  conflictWith?: string;
  createdAt: number;
}

export type ProposedOperationType =
  | 'set_attribute'
  | 'add_attribute'
  | 'add_entity'
  | 'rename_entity'
  | 'exclude_entity'
  | 'add_relationship'
  | 'update_relationship'
  | 'remove_relationship'
  | 'update_story_bible';

export interface ProposedOperation {
  id: string;
  type: ProposedOperationType;
  summary: string;
  clauseId?: string;
  clauseText?: string;
  entityId?: string;
  entityName?: string;
  newEntityName?: string;
  entityCategory?: EntityCategory;
  attributeName?: string;
  previousValue?: string;
  nextValue?: string;
  sourceEntityName?: string;
  targetEntityName?: string;
  relationshipId?: string;
  storyField?: keyof StoryBibleFields;
  destructive?: boolean;
  conflictWarning?: string;
  selected: boolean;
}

export interface BatchEditAmbiguity {
  phrase: string;
  reason: string;
  candidates: string[];
  clarifyingQuestion: string;
  clauseId?: string;
}

export interface BatchInstructionClause {
  id?: string;
  spanId?: string;
  text: string;
  status: 'covered' | 'parsed' | 'ambiguous' | 'unhandled';
  operationIds: string[];
  reason?: string;
}

export type BatchValidationIssueCode =
  | 'STALE_BASE'
  | 'MISSING_TARGET'
  | 'CONFLICT'
  | 'INVALID_VALUE'
  | 'UNHANDLED_CLAUSE';

export interface BatchValidationIssue {
  code: BatchValidationIssueCode;
  message: string;
  operationId?: string;
  clauseId?: string;
}

export interface BatchEditProposalResult {
  instruction: string;
  operations: ProposedOperation[];
  ambiguities: BatchEditAmbiguity[];
  warnings: string[];
  clauses?: BatchInstructionClause[];
  unhandledClauses?: string[];
  coverageComplete?: boolean;
  baseProjectId?: string;
  baseRevision?: number;
}

export interface ConsistencyIssue {
  id: string;
  severity: 'error' | 'warning';
  category:
    | 'trait_conflict'
    | 'setting_conflict'
    | 'relationship_conflict'
    | 'violated_exclusion'
    | 'unresolved_decision';
  title: string;
  description: string;
  affectedEntityIds: string[];
  suggestedFix?: string;
}

export interface GenerationArtifact {
  id: string;
  projectId?: string;
  mode: GenerationMode;
  createdAt: number;
  revisionId: string;
  sourceRevision?: number;
  promptUsed: string;
  promptDigest?: string;
  storyText?: string;
  images?: string[];
  warning?: string | null;
  isOutdated: boolean;
}

export interface ProjectRevision {
  id: string;
  revisionNumber?: number;
  timestamp: number;
  label: string;
  summary: string;
  changeCount: number;
  coalesceKey?: string;
  snapshot: ProjectSnapshot;
}

export interface ProjectSnapshot {
  originalIdea: string;
  refinedPrompt: string;
  freeformNotes: string;
  mode: GenerationMode;
  entities: Entity[];
  relationships: Relationship[];
  storyBible: StoryBible;
  clarifications: Clarification[];
  decisions: DecisionItem[];
  answeredQuestions: string[];
  skippedQuestions: string[];
}

export interface CreativeProject {
  schemaVersion: number;
  id: string;
  revision: number;
  persistedRevision?: number;
  name: string;
  createdAt: number;
  updatedAt: number;
  snapshot: ProjectSnapshot;
  artifacts: GenerationArtifact[];
  revisions: ProjectRevision[];
}

export type AiRequestAction =
  | 'analyze'
  | 'clarify'
  | 'batch'
  | 'batch-edit'
  | 'polish'
  | 'generate'
  | 'story'
  | 'image';

export interface AiRequestTicket {
  requestId: string;
  projectId: string;
  baseRevision: number;
  action: AiRequestAction;
  mode?: GenerationMode;
  promptUsed?: string;
  promptDigest?: string;
  startedAt: number;
}

export interface AiPolishProposal {
  requestId?: string;
  projectId: string;
  baseRevision: number;
  originalPrompt: string;
  polishedPrompt: string;
  proposedPrompt?: string;
  isNoOp?: boolean;
  createdAt: number;
}

export type ApiErrorCode =
  | 'MISSING_API_KEY'
  | 'AUTH_ERROR'
  | 'RATE_LIMITED'
  | 'MODEL_UNSUPPORTED'
  | 'SAFETY_BLOCKED'
  | 'INVALID_RESPONSE'
  | 'VALIDATION_ERROR'
  | 'TIMEOUT'
  | 'CANCELLED'
  | 'UPSTREAM_ERROR'
  | 'INTERNAL_ERROR';

export interface ApiErrorPayload {
  code: ApiErrorCode;
  message: string;
  retryable: boolean;
}

export interface ImageGenerationResult {
  images: string[];
  requestedCount: number;
  failedCount: number;
  warning: string | null;
}

