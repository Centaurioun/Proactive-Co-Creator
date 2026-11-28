import type { ApprovalStatus, EntityCategory, EpistemicKind } from './types';

export const NARRATIVE_MEMORY_INDEX_VERSION = 1;
export const NARRATIVE_CHUNKER_VERSION = 'pcc-chunker-v1';

export type NarrativeChunkSourceKind = 'immutable-source' | 'manuscript';
export type NarrativeChunkSectionKind = 'chapter' | 'scene' | 'source-block';

export interface NarrativeChunkRecord {
  id: string;
  projectId: string;
  sourceKind: NarrativeChunkSourceKind;
  /** For immutable-source: source.id; for manuscript: manuscriptVersionId */
  sourceId: string;
  versionId: string;
  projectRevision: number;
  sectionId: string;
  chapterId?: string;
  sectionTitle: string;
  kind: NarrativeChunkSectionKind;
  /** Zero-based chunk ordinal within the source or manuscript */
  ordinal: number;
  /** Zero-based section presentation order in manuscript or source list */
  presentationOrder: number;
  /** Optional explicit story chronology marker when verified; never fabricated */
  chronologyOrder?: string;
  /** Zero-based paragraph index within the section */
  paragraphIndex: number;
  /** Exact UTF-16 start offset within the section or immutable source text */
  startOffset: number;
  /** Exact UTF-16 end offset within the section or immutable source text */
  endOffset: number;
  text: string;
  /** Deterministic content digest of (text + chunkerVersion) */
  digest: string;
  tokenCountEstimate: number;
  /** IDs of non-excluded narrative entities mentioned in this chunk */
  entityIds: string[];
}

export interface IndexedEntityAttributeRecord {
  key: string;
  normalizedKey: string;
  value: string;
  normalizedValue: string;
}

export interface IndexedEntityRecord {
  id: string;
  name: string;
  normalizedName: string;
  foldedName: string;
  aliases: string[];
  normalizedAliases: string[];
  foldedAliases: string[];
  category: EntityCategory;
  description: string;
  status?: ApprovalStatus;
  excluded?: boolean;
  epistemicKind?: EpistemicKind;
  tags: string[];
  attributes: IndexedEntityAttributeRecord[];
  mentionChunkIds: string[];
  /** Lowest verified presentationOrder where this entity appears or is anchored */
  firstPresentationOrder?: number;
}

export interface IndexedRelationshipRecord {
  id: string;
  sourceEntityId: string;
  targetEntityId: string;
  sourceEntityName: string;
  targetEntityName: string;
  type: string;
  normalizedType: string;
  description: string;
  directed: boolean;
  mentionChunkIds: string[];
  firstPresentationOrder?: number;
}

export interface IndexedEpistemicFactRecord {
  id: string;
  holderEntityId: string;
  holderEntityName: string;
  kind: EpistemicKind;
  description: string;
  normalizedDescription: string;
  targetEntityId?: string;
  claimId?: string;
  validFromChapterId?: string;
  validToChapterId?: string;
  firstPresentationOrder?: number;
}

export interface LexicalPostingEntry {
  chunkId: string;
  tf: number;
}

export interface NarrativeIndexCoverageSummary {
  totalManuscriptSections: number;
  indexedManuscriptSections: number;
  totalImmutableSources: number;
  indexedImmutableSources: number;
  totalChunks: number;
  reusedChunksFromPreviousRevision: number;
  totalEntities: number;
  activeEntities: number;
  excludedEntities: number;
  totalRelationships: number;
  totalEpistemicFacts: number;
  uniqueTerms: number;
}

export type NarrativeMemoryIndexStatus = 'ready' | 'building' | 'stale' | 'partial' | 'error';

export interface NarrativeMemoryIndexSnapshot {
  indexVersion: number;
  chunkerVersion: string;
  projectId: string;
  projectRevision: number;
  manuscriptVersionId: string;
  sourceVersionsDigest: string;
  builtAt: number;
  status: NarrativeMemoryIndexStatus;
  errorMessage?: string;
  chunks: NarrativeChunkRecord[];
  entities: IndexedEntityRecord[];
  relationships: IndexedRelationshipRecord[];
  epistemicFacts: IndexedEpistemicFactRecord[];
  /** Inverted index mapping normalized/folded token -> posting list */
  postings: Record<string, LexicalPostingEntry[]>;
  /** Token length per chunkId for BM25 document length normalization */
  docLengths: Record<string, number>;
  avgDocLength: number;
  coverage: NarrativeIndexCoverageSummary;
}
