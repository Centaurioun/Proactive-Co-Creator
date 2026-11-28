import { EmbeddingNamespaceDescriptor } from '../../../shared/embeddingSchema';
import {
  NarrativeChunkRecord,
  NarrativeChunkSourceKind,
  NarrativeMemoryIndexSnapshot,
} from '../../../shared/narrativeMemoryTypes';
import {
  foldDiacritics,
  normalizeUnicodeText,
  tokenizeSearchQuery,
} from './textNormalization';
import { StoredChunkVectorRecord } from './vectorRepository';

export type HybridSearchScopeFilter = 'all' | 'manuscript' | 'immutable-source' | 'story-model';

export interface QueryVectorInput {
  namespace: EmbeddingNamespaceDescriptor;
  vector: number[];
}

export interface HybridSearchQueryOptions {
  query: string;
  scope?: HybridSearchScopeFilter;
  /** Optional explicit sectionId allowlist */
  sectionIds?: string[];
  /**
   * Optional Reader Spoiler Boundary (`maxPresentationOrder`).
   * When specified, excludes any chunk with `presentationOrder > maxPresentationOrder`
   * AND conservatively excludes any structured entity/relationship/fact whose
   * `firstPresentationOrder` is undefined or `> maxPresentationOrder`.
   */
  maxPresentationOrder?: number;
  /** Optional pre-computed query vectors keyed by their isolated `EmbeddingNamespaceDescriptor` */
  queryVectors?: QueryVectorInput[];
  /** Optional stored chunk vectors to consider for semantic retrieval */
  storedVectors?: StoredChunkVectorRecord[];
  limit?: number;
  bm25K1?: number;
  bm25B?: number;
  rrfK?: number;
}

export type HybridResultItemKind = 'chunk' | 'entity' | 'relationship';

export interface HybridMatchChannelBadge {
  channel: 'structured-exact' | 'lexical-bm25' | 'semantic-vector';
  label: string;
  rank: number;
  score: number;
  namespaceKey?: string;
}

export interface HybridSearchResultItem {
  /** Deterministic deduplication anchor key */
  anchorKey: string;
  kind: HybridResultItemKind;
  projectId: string;
  projectRevision: number;
  title: string;
  subtitle: string;
  excerpt: string;
  /** Exact UTF-16 match span inside `excerpt` when deterministic substring exists */
  highlightSpan?: { start: number; end: number };
  sourceKind?: NarrativeChunkSourceKind;
  sourceId?: string;
  sectionId?: string;
  chapterId?: string;
  startOffset?: number;
  endOffset?: number;
  presentationOrder?: number;
  entityId?: string;
  relationshipId?: string;
  rrfScore: number;
  channels: HybridMatchChannelBadge[];
}

export interface HybridSearchNamespaceDiagnostics {
  namespaceKey: string;
  providerId: string;
  modelId: string;
  dimensions: number;
  status: 'used' | 'skipped-no-vectors' | 'skipped-dimension-mismatch';
  matchedCount: number;
  reason?: string;
}

export interface HybridSearchResponse {
  query: string;
  projectId: string;
  projectRevision: number;
  scope: HybridSearchScopeFilter;
  maxPresentationOrder?: number;
  results: HybridSearchResultItem[];
  namespaceDiagnostics: HybridSearchNamespaceDiagnostics[];
  spoilerFilteredCount: number;
}

function isChunkAllowedByFilters(
  chunk: NarrativeChunkRecord,
  options: HybridSearchQueryOptions,
  sectionAllowSet: Set<string> | null
): { allowed: boolean; spoilerFiltered: boolean } {
  if (chunk.projectId !== options.projectIdContext) {
    // Handled by caller snapshot check
  }
  const scope = options.scope ?? 'all';
  if (scope === 'manuscript' && chunk.sourceKind !== 'manuscript') {
    return { allowed: false, spoilerFiltered: false };
  }
  if (scope === 'immutable-source' && chunk.sourceKind !== 'immutable-source') {
    return { allowed: false, spoilerFiltered: false };
  }
  if (scope === 'story-model') {
    return { allowed: false, spoilerFiltered: false };
  }
  if (sectionAllowSet && !sectionAllowSet.has(chunk.sectionId) && (!chunk.chapterId || !sectionAllowSet.has(chunk.chapterId))) {
    return { allowed: false, spoilerFiltered: false };
  }
  if (options.maxPresentationOrder !== undefined && chunk.presentationOrder > options.maxPresentationOrder) {
    return { allowed: false, spoilerFiltered: true };
  }
  return { allowed: true, spoilerFiltered: false };
}

function findHighlightSpan(text: string, rawQuery: string, exactTerms: string[]): { start: number; end: number } | undefined {
  if (!text || !rawQuery.trim()) return undefined;
  const normText = normalizeUnicodeText(text);
  const normPhrase = normalizeUnicodeText(rawQuery.trim());
  if (normPhrase.length >= 2 && normText.length === text.length) {
    const phraseIdx = normText.indexOf(normPhrase);
    if (phraseIdx !== -1) {
      return { start: phraseIdx, end: phraseIdx + normPhrase.length };
    }
  }
  if (normText.length === text.length) {
    for (const term of exactTerms) {
      const idx = normText.indexOf(term);
      if (idx !== -1) {
        return { start: idx, end: idx + term.length };
      }
    }
  }
  return undefined;
}

/**
 * Computes dot-product cosine similarity between two L2-normalized vectors of identical dimensionality.
 */
function computeCosineSimilarity(a: number[], b: number[]): number {
  if (a.length !== b.length || a.length === 0) return -1;
  let dot = 0;
  for (let i = 0; i < a.length; i += 1) {
    dot += a[i] * b[i];
  }
  return dot;
}

declare module './hybridSearch' {
  interface HybridSearchQueryOptions {
    projectIdContext?: string;
  }
}

/**
 * Executes deterministic E1 Hybrid Search over a `NarrativeMemoryIndexSnapshot`:
 * 1. Exact structured entity/alias/attribute/relationship & exact phrase match
 * 2. Lexical BM25 ranked retrieval over inverted postings (with Turkish diacritic folding)
 * 3. Per-namespace semantic cosine top-k (never mixing vectors across namespaces)
 * 4. Reciprocal Rank Fusion (`RRF`) with exact anchor deduplication and reader spoiler boundary enforcement
 */
export function executeHybridNarrativeSearch(
  snapshot: NarrativeMemoryIndexSnapshot,
  options: HybridSearchQueryOptions
): HybridSearchResponse {
  const rawQuery = (options.query || '').trim();
  const scope = options.scope ?? 'all';
  const limit = Math.max(1, Math.min(100, options.limit ?? 25));
  const k1 = options.bm25K1 ?? 1.2;
  const b = options.bm25B ?? 0.75;
  const rrfK = options.rrfK ?? 60;

  if (!rawQuery) {
    return {
      query: rawQuery,
      projectId: snapshot.projectId,
      projectRevision: snapshot.projectRevision,
      scope,
      maxPresentationOrder: options.maxPresentationOrder,
      results: [],
      namespaceDiagnostics: [],
      spoilerFilteredCount: 0,
    };
  }

  const normalizedQuery = normalizeUnicodeText(rawQuery);
  const foldedQuery = foldDiacritics(rawQuery);
  const { exactTerms, foldedTerms } = tokenizeSearchQuery(rawQuery);
  const sectionAllowSet =
    options.sectionIds && options.sectionIds.length > 0 ? new Set(options.sectionIds) : null;

  let spoilerFilteredCount = 0;
  const allowedChunksById = new Map<string, NarrativeChunkRecord>();

  for (const chunk of snapshot.chunks) {
    if (chunk.projectId !== snapshot.projectId) continue;
    const check = isChunkAllowedByFilters(chunk, options, sectionAllowSet);
    if (check.spoilerFiltered) {
      spoilerFilteredCount += 1;
    }
    if (check.allowed) {
      allowedChunksById.set(chunk.id, chunk);
    }
  }

  // Candidate accumulator keyed by deterministic anchorKey
  const candidates = new Map<string, HybridSearchResultItem>();

  const upsertCandidate = (
    base: Omit<HybridSearchResultItem, 'rrfScore' | 'channels'>,
    badge: HybridMatchChannelBadge
  ) => {
    const existing = candidates.get(base.anchorKey);
    const rrfContribution = 1 / (rrfK + badge.rank);
    if (!existing) {
      candidates.set(base.anchorKey, {
        ...base,
        rrfScore: rrfContribution,
        channels: [badge],
      });
    } else {
      existing.rrfScore += rrfContribution;
      if (!existing.channels.some((c) => c.channel === badge.channel && c.namespaceKey === badge.namespaceKey)) {
        existing.channels.push(badge);
      }
      if (!existing.highlightSpan && base.highlightSpan) {
        existing.highlightSpan = base.highlightSpan;
      }
    }
  };

  // --- CHANNEL 1: Structured Entity, Alias, Attribute, Relationship & Exact Phrase Lookup ---
  const structuredMatches: Array<{
    score: number;
    tieKey: string;
    item: Omit<HybridSearchResultItem, 'rrfScore' | 'channels'>;
  }> = [];

  if (scope === 'all' || scope === 'story-model') {
    for (const entity of snapshot.entities) {
      if (entity.excluded) continue;
      // Conservative Reader Boundary / Spoiler filter for derived records
      if (options.maxPresentationOrder !== undefined) {
        if (
          entity.firstPresentationOrder === undefined ||
          entity.firstPresentationOrder > options.maxPresentationOrder
        ) {
          spoilerFilteredCount += 1;
          continue;
        }
      }

      let score = 0;
      if (entity.normalizedName === normalizedQuery || entity.foldedName === foldedQuery) {
        score = 100;
      } else if (
        entity.normalizedAliases.includes(normalizedQuery) ||
        entity.foldedAliases.includes(foldedQuery)
      ) {
        score = 95;
      } else if (
        entity.normalizedName.includes(normalizedQuery) ||
        (foldedQuery.length >= 2 && entity.foldedName.includes(foldedQuery))
      ) {
        score = 80;
      } else if (
        entity.normalizedAliases.some((a) => a.includes(normalizedQuery)) ||
        entity.foldedAliases.some((a) => a.includes(foldedQuery))
      ) {
        score = 75;
      } else {
        for (const attr of entity.attributes) {
          if (
            attr.normalizedKey.includes(normalizedQuery) ||
            attr.normalizedValue.includes(normalizedQuery)
          ) {
            score = 65;
            break;
          }
        }
        if (score === 0 && normalizeUnicodeText(entity.description).includes(normalizedQuery)) {
          score = 55;
        }
      }

      if (score > 0) {
        const attrSummary =
          entity.attributes.length > 0
            ? ` · ${entity.attributes.map((a) => `${a.key}: ${a.value}`).join(', ')}`
            : '';
        const excerpt = `${entity.description || entity.name}${attrSummary}`;
        structuredMatches.push({
          score,
          tieKey: `1_entity_${entity.id}`,
          item: {
            anchorKey: `entity::${entity.id}`,
            kind: 'entity',
            projectId: snapshot.projectId,
            projectRevision: snapshot.projectRevision,
            title: entity.name,
            subtitle: `${entity.category.toUpperCase()}${entity.aliases.length > 0 ? ` (Aliases: ${entity.aliases.join(', ')})` : ''}`,
            excerpt,
            highlightSpan: findHighlightSpan(excerpt, rawQuery, exactTerms),
            presentationOrder: entity.firstPresentationOrder,
            entityId: entity.id,
          },
        });
      }
    }

    for (const rel of snapshot.relationships) {
      if (options.maxPresentationOrder !== undefined) {
        if (
          rel.firstPresentationOrder === undefined ||
          rel.firstPresentationOrder > options.maxPresentationOrder
        ) {
          spoilerFilteredCount += 1;
          continue;
        }
      }

      const combinedNorm = normalizeUnicodeText(
        `${rel.sourceEntityName} ${rel.type} ${rel.targetEntityName} ${rel.description}`
      );
      const combinedFold = foldDiacritics(combinedNorm);
      let score = 0;
      if (rel.normalizedType === normalizedQuery) {
        score = 85;
      } else if (combinedNorm.includes(normalizedQuery) || (foldedQuery.length >= 2 && combinedFold.includes(foldedQuery))) {
        score = 60;
      }

      if (score > 0) {
        const excerpt = `${rel.sourceEntityName} → [${rel.type}] → ${rel.targetEntityName}${rel.description ? `: ${rel.description}` : ''}`;
        structuredMatches.push({
          score,
          tieKey: `2_rel_${rel.id}`,
          item: {
            anchorKey: `relationship::${rel.id}`,
            kind: 'relationship',
            projectId: snapshot.projectId,
            projectRevision: snapshot.projectRevision,
            title: `${rel.sourceEntityName} ↔ ${rel.targetEntityName}`,
            subtitle: `Relationship · ${rel.type}`,
            excerpt,
            highlightSpan: findHighlightSpan(excerpt, rawQuery, exactTerms),
            presentationOrder: rel.firstPresentationOrder,
            relationshipId: rel.id,
          },
        });
      }
    }
  }

  // Exact phrase or entity-mention matches inside allowed text chunks
  if (scope !== 'story-model' && normalizedQuery.length >= 2) {
    for (const chunk of allowedChunksById.values()) {
      const normText = normalizeUnicodeText(chunk.text);
      const foldText = foldDiacritics(chunk.text);
      if (normText.includes(normalizedQuery) || (foldedQuery.length >= 2 && foldText.includes(foldedQuery))) {
        const anchorKey = `chunk::${chunk.sourceKind}::${chunk.sourceId}::${chunk.sectionId}::${chunk.startOffset}::${chunk.endOffset}`;
        structuredMatches.push({
          score: 70,
          tieKey: `3_chunk_${chunk.ordinal.toString().padStart(6, '0')}`,
          item: {
            anchorKey,
            kind: 'chunk',
            projectId: snapshot.projectId,
            projectRevision: snapshot.projectRevision,
            title: chunk.sectionTitle,
            subtitle:
              chunk.sourceKind === 'manuscript'
                ? `Working Manuscript · Scene #${chunk.presentationOrder + 1} · UTF-16 [${chunk.startOffset}..${chunk.endOffset}]`
                : `Immutable Source · Block #${chunk.presentationOrder + 1} · UTF-16 [${chunk.startOffset}..${chunk.endOffset}]`,
            excerpt: chunk.text,
            highlightSpan: findHighlightSpan(chunk.text, rawQuery, exactTerms),
            sourceKind: chunk.sourceKind,
            sourceId: chunk.sourceId,
            sectionId: chunk.sectionId,
            chapterId: chunk.chapterId,
            startOffset: chunk.startOffset,
            endOffset: chunk.endOffset,
            presentationOrder: chunk.presentationOrder,
          },
        });
      }
    }
  }

  structuredMatches.sort((a, b) => b.score - a.score || a.tieKey.localeCompare(b.tieKey));
  for (let i = 0; i < structuredMatches.length; i += 1) {
    const match = structuredMatches[i];
    upsertCandidate(match.item, {
      channel: 'structured-exact',
      label: 'Exact / Structured',
      rank: i + 1,
      score: match.score,
    });
  }

  // --- CHANNEL 2: Lexical BM25 Ranked Retrieval ---
  if (scope !== 'story-model' && (exactTerms.length > 0 || foldedTerms.length > 0)) {
    const N = Math.max(1, snapshot.chunks.length);
    const avgdl = Math.max(1, snapshot.avgDocLength || 1);
    const bm25Scores = new Map<string, number>();

    const scoreTermList = (terms: string[], weight: number) => {
      for (const term of terms) {
        const postingList = snapshot.postings[term];
        if (!postingList || postingList.length === 0) continue;
        const df = postingList.length;
        const idf = Math.log(1 + (N - df + 0.5) / (df + 0.5));
        for (const entry of postingList) {
          if (!allowedChunksById.has(entry.chunkId)) continue;
          const dl = snapshot.docLengths[entry.chunkId] ?? avgdl;
          const tfNorm = (entry.tf * (k1 + 1)) / (entry.tf + k1 * (1 - b + b * (dl / avgdl)));
          const termScore = weight * idf * tfNorm;
          bm25Scores.set(entry.chunkId, (bm25Scores.get(entry.chunkId) ?? 0) + termScore);
        }
      }
    };

    scoreTermList(exactTerms, 1.0);
    scoreTermList(foldedTerms, 0.75);

    const rankedBm25 = Array.from(bm25Scores.entries())
      .map(([chunkId, score]) => ({
        chunk: allowedChunksById.get(chunkId)!,
        score,
      }))
      .sort((a, b) => b.score - a.score || a.chunk.ordinal - b.chunk.ordinal);

    for (let i = 0; i < rankedBm25.length; i += 1) {
      const { chunk, score } = rankedBm25[i];
      const anchorKey = `chunk::${chunk.sourceKind}::${chunk.sourceId}::${chunk.sectionId}::${chunk.startOffset}::${chunk.endOffset}`;
      upsertCandidate(
        {
          anchorKey,
          kind: 'chunk',
          projectId: snapshot.projectId,
          projectRevision: snapshot.projectRevision,
          title: chunk.sectionTitle,
          subtitle:
            chunk.sourceKind === 'manuscript'
              ? `Working Manuscript · Scene #${chunk.presentationOrder + 1} · UTF-16 [${chunk.startOffset}..${chunk.endOffset}]`
              : `Immutable Source · Block #${chunk.presentationOrder + 1} · UTF-16 [${chunk.startOffset}..${chunk.endOffset}]`,
          excerpt: chunk.text,
          highlightSpan: findHighlightSpan(chunk.text, rawQuery, exactTerms),
          sourceKind: chunk.sourceKind,
          sourceId: chunk.sourceId,
          sectionId: chunk.sectionId,
          chapterId: chunk.chapterId,
          startOffset: chunk.startOffset,
          endOffset: chunk.endOffset,
          presentationOrder: chunk.presentationOrder,
        },
        {
          channel: 'lexical-bm25',
          label: 'Lexical BM25',
          rank: i + 1,
          score: Number(score.toFixed(4)),
        }
      );
    }
  }

  // --- CHANNEL 3: Namespace-Isolated Semantic Vector Retrieval ---
  const namespaceDiagnostics: HybridSearchNamespaceDiagnostics[] = [];
  if (
    scope !== 'story-model' &&
    options.queryVectors &&
    options.queryVectors.length > 0 &&
    options.storedVectors &&
    options.storedVectors.length > 0
  ) {
    // Index allowed chunks by digest for fast resolution
    const allowedChunksByDigest = new Map<string, NarrativeChunkRecord[]>();
    for (const chunk of allowedChunksById.values()) {
      let bucket = allowedChunksByDigest.get(chunk.digest);
      if (!bucket) {
        bucket = [];
        allowedChunksByDigest.set(chunk.digest, bucket);
      }
      bucket.push(chunk);
    }

    for (const qv of options.queryVectors) {
      const nsKey = qv.namespace.namespaceKey;
      // Filter stored vectors strictly to the EXACT same namespaceKey and projectId
      const matchingNamespaceVectors = options.storedVectors.filter(
        (sv) => sv.projectId === snapshot.projectId && sv.namespace.namespaceKey === nsKey
      );

      if (matchingNamespaceVectors.length === 0) {
        namespaceDiagnostics.push({
          namespaceKey: nsKey,
          providerId: qv.namespace.providerId,
          modelId: qv.namespace.modelId,
          dimensions: qv.namespace.dimensions,
          status: 'skipped-no-vectors',
          matchedCount: 0,
          reason: 'No stored chunk vectors exist for this exact provider/model namespace.',
        });
        continue;
      }

      if (qv.vector.length !== qv.namespace.dimensions) {
        namespaceDiagnostics.push({
          namespaceKey: nsKey,
          providerId: qv.namespace.providerId,
          modelId: qv.namespace.modelId,
          dimensions: qv.namespace.dimensions,
          status: 'skipped-dimension-mismatch',
          matchedCount: 0,
          reason: `Query vector length (${qv.vector.length}) does not match namespace dimensions (${qv.namespace.dimensions}).`,
        });
        continue;
      }

      const scoredChunks: Array<{ chunk: NarrativeChunkRecord; similarity: number }> = [];
      let dimensionMismatchSeen = false;

      for (const sv of matchingNamespaceVectors) {
        if (sv.vector.length !== qv.vector.length) {
          dimensionMismatchSeen = true;
          continue;
        }
        const chunksForDigest = allowedChunksByDigest.get(sv.chunkDigest);
        if (!chunksForDigest || chunksForDigest.length === 0) continue;

        const sim = computeCosineSimilarity(qv.vector, sv.vector);
        if (sim <= 0) continue;

        for (const chunk of chunksForDigest) {
          scoredChunks.push({ chunk, similarity: sim });
        }
      }

      if (dimensionMismatchSeen && scoredChunks.length === 0) {
        namespaceDiagnostics.push({
          namespaceKey: nsKey,
          providerId: qv.namespace.providerId,
          modelId: qv.namespace.modelId,
          dimensions: qv.namespace.dimensions,
          status: 'skipped-dimension-mismatch',
          matchedCount: 0,
          reason: 'Stored vectors in namespace had mismatched dimensionality.',
        });
        continue;
      }

      scoredChunks.sort((a, b) => b.similarity - a.similarity || a.chunk.ordinal - b.chunk.ordinal);

      namespaceDiagnostics.push({
        namespaceKey: nsKey,
        providerId: qv.namespace.providerId,
        modelId: qv.namespace.modelId,
        dimensions: qv.namespace.dimensions,
        status: 'used',
        matchedCount: scoredChunks.length,
      });

      for (let i = 0; i < scoredChunks.length; i += 1) {
        const { chunk, similarity } = scoredChunks[i];
        const anchorKey = `chunk::${chunk.sourceKind}::${chunk.sourceId}::${chunk.sectionId}::${chunk.startOffset}::${chunk.endOffset}`;
        upsertCandidate(
          {
            anchorKey,
            kind: 'chunk',
            projectId: snapshot.projectId,
            projectRevision: snapshot.projectRevision,
            title: chunk.sectionTitle,
            subtitle:
              chunk.sourceKind === 'manuscript'
                ? `Working Manuscript · Scene #${chunk.presentationOrder + 1} · UTF-16 [${chunk.startOffset}..${chunk.endOffset}]`
                : `Immutable Source · Block #${chunk.presentationOrder + 1} · UTF-16 [${chunk.startOffset}..${chunk.endOffset}]`,
            excerpt: chunk.text,
            highlightSpan: findHighlightSpan(chunk.text, rawQuery, exactTerms),
            sourceKind: chunk.sourceKind,
            sourceId: chunk.sourceId,
            sectionId: chunk.sectionId,
            chapterId: chunk.chapterId,
            startOffset: chunk.startOffset,
            endOffset: chunk.endOffset,
            presentationOrder: chunk.presentationOrder,
          },
          {
            channel: 'semantic-vector',
            label: `Semantic (${qv.namespace.providerId})`,
            rank: i + 1,
            score: Number(similarity.toFixed(4)),
            namespaceKey: nsKey,
          }
        );
      }
    }
  }

  // Final deterministic RRF ranking & tie-break
  const allResults = Array.from(candidates.values()).sort((a, b) => {
    const scoreDiff = b.rrfScore - a.rrfScore;
    if (Math.abs(scoreDiff) > 1e-9) return scoreDiff;
    const orderA = a.presentationOrder ?? 999999;
    const orderB = b.presentationOrder ?? 999999;
    if (orderA !== orderB) return orderA - orderB;
    return a.anchorKey.localeCompare(b.anchorKey);
  });

  // Post-selection verification: double-check project, scope, and spoiler boundary
  const verifiedResults = allResults.filter((item) => {
    if (item.projectId !== snapshot.projectId) return false;
    if (
      options.maxPresentationOrder !== undefined &&
      (item.presentationOrder === undefined || item.presentationOrder > options.maxPresentationOrder)
    ) {
      return false;
    }
    return true;
  });

  return {
    query: rawQuery,
    projectId: snapshot.projectId,
    projectRevision: snapshot.projectRevision,
    scope,
    maxPresentationOrder: options.maxPresentationOrder,
    results: verifiedResults.slice(0, limit),
    namespaceDiagnostics,
    spoilerFilteredCount,
  };
}
