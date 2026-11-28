import {
  IndexedEntityRecord,
  IndexedEpistemicFactRecord,
  IndexedRelationshipRecord,
  LexicalPostingEntry,
  NARRATIVE_CHUNKER_VERSION,
  NARRATIVE_MEMORY_INDEX_VERSION,
  NarrativeChunkRecord,
  NarrativeMemoryIndexSnapshot,
} from '../../../shared/narrativeMemoryTypes';
import { CreativeProject } from '../../../shared/types';
import { manuscriptSections } from '../manuscriptModel';
import { chunkNarrativeSection, ChunkerOptions } from './chunker';
import {
  computeDeterministicDigest,
  foldDiacritics,
  normalizeUnicodeText,
  tokenizeForLexicalIndex,
} from './textNormalization';

export interface BuildNarrativeIndexOptions extends ChunkerOptions {
  /** Optional previous index snapshot to reuse unchanged chunks and track incremental reuse */
  previousIndex?: NarrativeMemoryIndexSnapshot | null;
}

/**
 * Checks whether an entity name or alias appears as a whole word/phrase inside normalized chunk text.
 */
function chunkContainsNormalizedTerm(
  normalizedChunkText: string,
  foldedChunkText: string,
  normalizedTerm: string,
  foldedTerm: string
): boolean {
  if (!normalizedTerm || normalizedTerm.length < 2) return false;
  const checkIn = (haystack: string, needle: string): boolean => {
    let idx = haystack.indexOf(needle);
    while (idx !== -1) {
      const before = idx === 0 ? ' ' : haystack[idx - 1];
      const afterIdx = idx + needle.length;
      const after = afterIdx >= haystack.length ? ' ' : haystack[afterIdx];
      const isBoundaryBefore = !/[\p{L}\p{N}]/u.test(before);
      const isBoundaryAfter = !/[\p{L}\p{N}]/u.test(after);
      if (isBoundaryBefore && isBoundaryAfter) {
        return true;
      }
      idx = haystack.indexOf(needle, idx + 1);
    }
    return false;
  };
  return checkIn(normalizedChunkText, normalizedTerm) || (foldedTerm.length >= 2 && checkIn(foldedChunkText, foldedTerm));
}

/**
 * Deterministically builds or incrementally updates the E1 Narrative Memory Index
 * for a CreativeProject without any silent 80-entity or 100-relationship truncation.
 */
export function buildNarrativeMemoryIndex(
  project: CreativeProject,
  options: BuildNarrativeIndexOptions = {}
): NarrativeMemoryIndexSnapshot {
  const projectRevision = project.revision ?? 1;
  const manuscriptVersionId = project.snapshot?.manuscriptVersionId || 'default-manuscript';
  const sections = manuscriptSections(project);
  const sources = project.narrative?.sources ?? [];

  const sourceVersionsDigest = computeDeterministicDigest(
    sources.map((s) => `${s.id}:${s.version}:${s.digest}`).join('|')
  );

  // Build lookup map of reusable chunks from previousIndex if available
  const previousChunkMap = new Map<string, NarrativeChunkRecord>();
  if (
    options.previousIndex &&
    options.previousIndex.projectId === project.id &&
    options.previousIndex.chunkerVersion === NARRATIVE_CHUNKER_VERSION
  ) {
    for (const prevChunk of options.previousIndex.chunks) {
      const reuseKey = `${prevChunk.sourceKind}::${prevChunk.sourceId}::${prevChunk.sectionId}::${prevChunk.startOffset}::${prevChunk.endOffset}::${prevChunk.digest}`;
      previousChunkMap.set(reuseKey, prevChunk);
    }
  }

  const allChunks: NarrativeChunkRecord[] = [];
  let reusedChunksFromPreviousRevision = 0;
  let globalOrdinal = 0;

  // 1. Index working manuscript sections distinctly (`sourceKind: 'manuscript'`)
  let indexedManuscriptSections = 0;
  const sectionOrderBySectionId = new Map<string, number>();

  for (let sIdx = 0; sIdx < sections.length; sIdx += 1) {
    const section = sections[sIdx];
    const presentationOrder = sIdx;
    sectionOrderBySectionId.set(section.id, presentationOrder);
    if (section.chapterId && !sectionOrderBySectionId.has(section.chapterId)) {
      sectionOrderBySectionId.set(section.chapterId, presentationOrder);
    }

    const sectionChunks = chunkNarrativeSection(
      {
        projectId: project.id,
        sourceKind: 'manuscript',
        sourceId: manuscriptVersionId,
        versionId: manuscriptVersionId,
        projectRevision,
        sectionId: section.id,
        chapterId: section.chapterId,
        sectionTitle: section.title || `Section ${sIdx + 1}`,
        kind: section.kind === 'chapter' ? 'chapter' : 'scene',
        presentationOrder,
        chronologyOrder: section.chronology,
        text: section.text || '',
      },
      globalOrdinal,
      options
    );

    if (sectionChunks.length > 0) {
      indexedManuscriptSections += 1;
    }

    for (const chunk of sectionChunks) {
      const reuseKey = `${chunk.sourceKind}::${chunk.sourceId}::${chunk.sectionId}::${chunk.startOffset}::${chunk.endOffset}::${chunk.digest}`;
      if (previousChunkMap.has(reuseKey)) {
        reusedChunksFromPreviousRevision += 1;
      }
      allChunks.push(chunk);
      globalOrdinal += 1;
    }
  }

  // 2. Index immutable source snapshots distinctly (`sourceKind: 'immutable-source'`)
  let indexedImmutableSources = 0;
  for (let srcIdx = 0; srcIdx < sources.length; srcIdx += 1) {
    const source = sources[srcIdx];
    const sourceText = source.text || '';
    if (!sourceText.trim()) continue;

    let producedForSource = 0;
    if (source.blocks && source.blocks.length > 0) {
      for (let bIdx = 0; bIdx < source.blocks.length; bIdx += 1) {
        const block = source.blocks[bIdx];
        const sliceText = sourceText.slice(block.start, block.end);
        if (!sliceText.trim()) continue;
        const blockChunks = chunkNarrativeSection(
          {
            projectId: project.id,
            sourceKind: 'immutable-source',
            sourceId: source.id,
            versionId: source.version,
            projectRevision,
            sectionId: block.id,
            sectionTitle: block.label || source.filename || `Source ${srcIdx + 1}`,
            kind: 'source-block',
            presentationOrder: bIdx,
            text: sliceText,
            baseStartOffset: block.start,
          },
          globalOrdinal,
          options
        );
        for (const chunk of blockChunks) {
          const reuseKey = `${chunk.sourceKind}::${chunk.sourceId}::${chunk.sectionId}::${chunk.startOffset}::${chunk.endOffset}::${chunk.digest}`;
          if (previousChunkMap.has(reuseKey)) {
            reusedChunksFromPreviousRevision += 1;
          }
          allChunks.push(chunk);
          globalOrdinal += 1;
          producedForSource += 1;
        }
      }
    } else {
      const sourceChunks = chunkNarrativeSection(
        {
          projectId: project.id,
          sourceKind: 'immutable-source',
          sourceId: source.id,
          versionId: source.version,
          projectRevision,
          sectionId: source.id,
          sectionTitle: source.filename || `Source ${srcIdx + 1}`,
          kind: 'source-block',
          presentationOrder: srcIdx,
          text: sourceText,
        },
        globalOrdinal,
        options
      );
      for (const chunk of sourceChunks) {
        const reuseKey = `${chunk.sourceKind}::${chunk.sourceId}::${chunk.sectionId}::${chunk.startOffset}::${chunk.endOffset}::${chunk.digest}`;
        if (previousChunkMap.has(reuseKey)) {
          reusedChunksFromPreviousRevision += 1;
        }
        allChunks.push(chunk);
        globalOrdinal += 1;
        producedForSource += 1;
      }
    }

    if (producedForSource > 0) {
      indexedImmutableSources += 1;
    }
  }

  // Precompute normalized and folded chunk texts for fast entity linkage & lexical indexing
  const chunkNormalizedMap = new Map<string, { normalized: string; folded: string }>();
  for (const chunk of allChunks) {
    chunkNormalizedMap.set(chunk.id, {
      normalized: normalizeUnicodeText(chunk.text),
      folded: foldDiacritics(chunk.text),
    });
  }

  // 3. Index all structured Entities from project.snapshot.entities (no silent 80-item truncation!)
  const rawEntities = project.snapshot?.entities ?? [];
  const indexedEntities: IndexedEntityRecord[] = [];
  const entityByIdOrName = new Map<string, IndexedEntityRecord>();
  let activeEntitiesCount = 0;
  let excludedEntitiesCount = 0;

  for (let eIdx = 0; eIdx < rawEntities.length; eIdx += 1) {
    const entity = rawEntities[eIdx];
    const entityId = entity.id || `entity_${eIdx}_${normalizeUnicodeText(entity.name).replace(/\s+/g, '_')}`;
    const isExcluded = Boolean(entity.excluded || entity.status === 'rejected');
    if (isExcluded) {
      excludedEntitiesCount += 1;
    } else {
      activeEntitiesCount += 1;
    }

    const normalizedName = normalizeUnicodeText(entity.name);
    const foldedName = foldDiacritics(entity.name);
    const aliases = entity.aliases ?? [];
    const normalizedAliases = aliases.map((a) => normalizeUnicodeText(a)).filter(Boolean);
    const foldedAliases = aliases.map((a) => foldDiacritics(a)).filter(Boolean);

    const mentionChunkIds: string[] = [];
    let firstPresentationOrder: number | undefined;

    if (!isExcluded) {
      for (const chunk of allChunks) {
        const normEntry = chunkNormalizedMap.get(chunk.id)!;
        let matched = chunkContainsNormalizedTerm(
          normEntry.normalized,
          normEntry.folded,
          normalizedName,
          foldedName
        );
        if (!matched) {
          for (let i = 0; i < normalizedAliases.length; i += 1) {
            if (
              chunkContainsNormalizedTerm(
                normEntry.normalized,
                normEntry.folded,
                normalizedAliases[i],
                foldedAliases[i] ?? ''
              )
            ) {
              matched = true;
              break;
            }
          }
        }
        if (matched) {
          mentionChunkIds.push(chunk.id);
          if (!chunk.entityIds.includes(entityId)) {
            chunk.entityIds.push(entityId);
          }
          if (firstPresentationOrder === undefined || chunk.presentationOrder < firstPresentationOrder) {
            firstPresentationOrder = chunk.presentationOrder;
          }
        }
      }
    }

    const attributes = (entity.attributes ?? []).map((attr) => {
      const val = attr.confirmedValue ?? attr.value?.[0]?.name ?? '';
      return {
        key: attr.name,
        normalizedKey: normalizeUnicodeText(attr.name),
        value: val,
        normalizedValue: normalizeUnicodeText(val),
      };
    });

    const record: IndexedEntityRecord = {
      id: entityId,
      name: entity.name,
      normalizedName,
      foldedName,
      aliases,
      normalizedAliases,
      foldedAliases,
      category: entity.category ?? 'character',
      description: entity.description || '',
      status: entity.status,
      excluded: isExcluded,
      epistemicKind: entity.epistemicKind,
      tags: [],
      attributes,
      mentionChunkIds,
      firstPresentationOrder,
    };

    indexedEntities.push(record);
    entityByIdOrName.set(entityId, record);
    entityByIdOrName.set(entity.name, record);
    entityByIdOrName.set(normalizedName, record);
  }

  // 4. Index all Relationships from project.snapshot.relationships (no silent 100-item truncation!)
  const rawRelationships = project.snapshot?.relationships ?? [];
  const indexedRelationships: IndexedRelationshipRecord[] = [];

  for (let rIdx = 0; rIdx < rawRelationships.length; rIdx += 1) {
    const rel = rawRelationships[rIdx];
    const relId = rel.id || `rel_${rIdx}`;
    const srcEntity =
      (rel.sourceId ? entityByIdOrName.get(rel.sourceId) : undefined) ??
      entityByIdOrName.get(rel.source) ??
      entityByIdOrName.get(normalizeUnicodeText(rel.source));
    const tgtEntity =
      (rel.targetId ? entityByIdOrName.get(rel.targetId) : undefined) ??
      entityByIdOrName.get(rel.target) ??
      entityByIdOrName.get(normalizeUnicodeText(rel.target));

    const srcMentions = new Set(srcEntity?.mentionChunkIds ?? []);
    const coMentionChunkIds = (tgtEntity?.mentionChunkIds ?? []).filter((cid) => srcMentions.has(cid));

    let firstPresentationOrder: number | undefined;
    for (const cid of coMentionChunkIds) {
      const ch = allChunks.find((c) => c.id === cid);
      if (ch && (firstPresentationOrder === undefined || ch.presentationOrder < firstPresentationOrder)) {
        firstPresentationOrder = ch.presentationOrder;
      }
    }
    if (firstPresentationOrder === undefined) {
      if (srcEntity?.firstPresentationOrder !== undefined && tgtEntity?.firstPresentationOrder !== undefined) {
        firstPresentationOrder = Math.max(srcEntity.firstPresentationOrder, tgtEntity.firstPresentationOrder);
      }
    }

    indexedRelationships.push({
      id: relId,
      sourceEntityId: srcEntity?.id ?? rel.sourceId ?? rel.source,
      targetEntityId: tgtEntity?.id ?? rel.targetId ?? rel.target,
      sourceEntityName: srcEntity?.name ?? rel.source,
      targetEntityName: tgtEntity?.name ?? rel.target,
      type: rel.label,
      normalizedType: normalizeUnicodeText(rel.label),
      description: rel.evidenceExcerpt || '',
      directed: true,
      mentionChunkIds: coMentionChunkIds,
      firstPresentationOrder,
    });
  }

  // 5. Index all Epistemic Claims from project.narrative.claims
  const rawClaims = project.narrative?.claims ?? [];
  const indexedEpistemicFacts: IndexedEpistemicFactRecord[] = [];
  for (const claim of rawClaims) {
    const holder = entityByIdOrName.get(claim.targetId);
    let firstPresentationOrder: number | undefined = holder?.firstPresentationOrder;
    for (const anchor of claim.anchors ?? []) {
      if (anchor.sourceId && sectionOrderBySectionId.has(anchor.sourceId)) {
        const ord = sectionOrderBySectionId.get(anchor.sourceId)!;
        if (firstPresentationOrder === undefined || ord < firstPresentationOrder) {
          firstPresentationOrder = ord;
        }
      }
    }

    indexedEpistemicFacts.push({
      id: claim.id,
      holderEntityId: claim.targetId,
      holderEntityName: holder?.name ?? claim.targetId,
      kind: claim.epistemicKind ?? 'explicit',
      description: claim.authoredText || claim.rationale,
      normalizedDescription: normalizeUnicodeText(claim.authoredText || claim.rationale),
      claimId: claim.id,
      firstPresentationOrder,
    });
  }

  // 6. Build Inverted Lexical Postings & Document Lengths for BM25
  const postings: Record<string, LexicalPostingEntry[]> = Object.create(null);
  const docLengths: Record<string, number> = Object.create(null);
  let totalTokensAcrossChunks = 0;

  for (const chunk of allChunks) {
    const tokens = tokenizeForLexicalIndex(`${chunk.sectionTitle} ${chunk.text}`);
    const exactTokenCount = tokens.filter((t) => !t.startsWith('f:')).length;
    docLengths[chunk.id] = Math.max(1, exactTokenCount);
    totalTokensAcrossChunks += docLengths[chunk.id];

    const termCounts = new Map<string, number>();
    for (const token of tokens) {
      termCounts.set(token, (termCounts.get(token) ?? 0) + 1);
    }

    for (const [term, tf] of termCounts.entries()) {
      let bucket = postings[term];
      if (!bucket) {
        bucket = [];
        postings[term] = bucket;
      }
      bucket.push({ chunkId: chunk.id, tf });
    }
  }

  const avgDocLength =
    allChunks.length > 0 ? totalTokensAcrossChunks / allChunks.length : 1;
  const uniqueTerms = Object.keys(postings).length;

  return {
    indexVersion: NARRATIVE_MEMORY_INDEX_VERSION,
    chunkerVersion: NARRATIVE_CHUNKER_VERSION,
    projectId: project.id,
    projectRevision,
    manuscriptVersionId,
    sourceVersionsDigest,
    builtAt: Date.now(),
    status: 'ready',
    chunks: allChunks,
    entities: indexedEntities,
    relationships: indexedRelationships,
    epistemicFacts: indexedEpistemicFacts,
    postings: { ...postings },
    docLengths: { ...docLengths },
    avgDocLength,
    coverage: {
      totalManuscriptSections: sections.length,
      indexedManuscriptSections,
      totalImmutableSources: sources.length,
      indexedImmutableSources,
      totalChunks: allChunks.length,
      reusedChunksFromPreviousRevision,
      totalEntities: rawEntities.length,
      activeEntities: activeEntitiesCount,
      excludedEntities: excludedEntitiesCount,
      totalRelationships: rawRelationships.length,
      totalEpistemicFacts: rawClaims.length,
      uniqueTerms,
    },
  };
}

/**
 * Checks whether a persisted NarrativeMemoryIndexSnapshot is fresh for the given project.
 */
export function isNarrativeMemoryIndexFresh(
  snapshot: NarrativeMemoryIndexSnapshot | null | undefined,
  project: CreativeProject
): boolean {
  if (!snapshot) return false;
  if (snapshot.indexVersion !== NARRATIVE_MEMORY_INDEX_VERSION) return false;
  if (snapshot.chunkerVersion !== NARRATIVE_CHUNKER_VERSION) return false;
  if (snapshot.status !== 'ready') return false;
  if (snapshot.projectId !== project.id) return false;
  const currentRevision = project.revision ?? 1;
  if (snapshot.projectRevision !== currentRevision) return false;
  const manuscriptVersionId = project.snapshot?.manuscriptVersionId || 'default-manuscript';
  if (snapshot.manuscriptVersionId !== manuscriptVersionId) return false;
  const sources = project.narrative?.sources ?? [];
  const sourceVersionsDigest = computeDeterministicDigest(
    sources.map((s) => `${s.id}:${s.version}:${s.digest}`).join('|')
  );
  return snapshot.sourceVersionsDigest === sourceVersionsDigest;
}
