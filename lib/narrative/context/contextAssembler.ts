import {
  IndexedEntityRecord,
  IndexedRelationshipRecord,
  NarrativeChunkRecord,
  NarrativeMemoryIndexSnapshot,
} from '../../../shared/narrativeMemoryTypes';
import { CreativeProject } from '../../../shared/types';
import { CreativeLock } from '../../../shared/unifiedProposalTypes';
import { executeHybridNarrativeSearch } from '../memory/hybridSearch';
import { getOrBuildNarrativeMemoryIndexSync } from '../memory/indexRepository';
import { estimateTokenCount } from '../memory/textNormalization';

export type ContextOperationIntent =
  | 'writing-assist'
  | 'diagnostics'
  | 'narrative-sync'
  | 'plan-bridge'
  | 'batch-edit';

export type ContextItemDisposition =
  | 'planned'
  | 'sent'
  | 'completed'
  | 'omitted';

export type ContextOmissionReason =
  | 'scope-excluded'
  | 'spoiler-boundary'
  | 'budget-cap'
  | 'excluded-entity'
  | 'locked-protected'
  | 'duplicate-anchor';

export interface ContextInspectorSpanItem {
  id: string;
  kind: 'section' | 'chunk' | 'entity' | 'relationship' | 'story-bible' | 'creative-lock';
  label: string;
  subtitle: string;
  excerpt: string;
  estimatedTokens: number;
  disposition: ContextItemDisposition;
  omissionReason?: ContextOmissionReason;
  sectionId?: string;
  startOffset?: number;
  endOffset?: number;
  lockedById?: string;
}

export interface ContextSegmentRecord {
  segmentIndex: number;
  status: 'planned' | 'sent' | 'completed' | 'failed';
  includedItemIds: string[];
  estimatedTokens: number;
  measuredTokens?: number;
}

export interface ContextInspectorReport {
  projectId: string;
  projectRevision: number;
  manuscriptVersionId: string;
  operationIntent: ContextOperationIntent;
  scopeLabel: string;
  activeSectionId?: string;
  maxPresentationOrder?: number;
  tokenBudget: number;
  estimatedPlannedTokens: number;
  measuredSentTokens?: number;
  counts: {
    requested: number;
    eligible: number;
    planned: number;
    sent: number;
    completed: number;
    omitted: number;
  };
  activeLocks: CreativeLock[];
  items: ContextInspectorSpanItem[];
  segments: ContextSegmentRecord[];
  builtAt: number;
}

export interface AssembleOperationContextOptions {
  operationIntent: ContextOperationIntent;
  activeSectionId?: string;
  scope?: 'scene' | 'changed' | 'full';
  changedSectionIds?: string[];
  queryHint?: string;
  maxPresentationOrder?: number;
  tokenBudget?: number;
  indexSnapshot?: NarrativeMemoryIndexSnapshot;
  executionStage?: 'planned' | 'sent' | 'completed';
  measuredSentTokens?: number;
}

/**
 * Reusable E1 Context Assembly Engine (`IR-02`, `UIC-01`, `R-05/09/10/11`).
 * Consumes the persistent Narrative Memory Index without silent 80/100 item truncation,
 * enforces explicit scope, reader spoiler boundary, creative locks, and token budgets,
 * and records every included and omitted span/entity/relationship with its exact reason.
 */
export function assembleOperationContext(
  project: CreativeProject,
  options: AssembleOperationContextOptions
): ContextInspectorReport {
  const index = options.indexSnapshot ?? getOrBuildNarrativeMemoryIndexSync(project);
  const tokenBudget = Math.max(10, options.tokenBudget ?? 8000);
  const stage = options.executionStage ?? 'planned';
  const activeLocks = (project.narrative?.creativeLocks ?? []).filter((l) => l.active);

  const items: ContextInspectorSpanItem[] = [];
  let requestedCount = 0;
  let eligibleCount = 0;
  let plannedTokens = 0;

  const activeSectionChunks = options.activeSectionId
    ? index.chunks.filter((c) => c.sectionId === options.activeSectionId)
    : [];
  const activePresentationOrder =
    options.maxPresentationOrder ??
    (activeSectionChunks.length > 0 ? activeSectionChunks[0].presentationOrder : undefined);

  const changedSet =
    options.changedSectionIds && options.changedSectionIds.length > 0
      ? new Set(options.changedSectionIds)
      : null;

  // 1. Always include active Creative Locks at top of context budget
  for (const lock of activeLocks) {
    requestedCount += 1;
    eligibleCount += 1;
    const lockText = `[${lock.hardness.toUpperCase()}] ${lock.targetLabel}: ${lock.ruleText}${
      lock.expectedValue ? ` (Required: ${lock.expectedValue})` : ''
    }`;
    const est = estimateTokenCount(lockText);
    plannedTokens += est;
    items.push({
      id: `lock_${lock.id}`,
      kind: 'creative-lock',
      label: `Lock: ${lock.targetLabel}`,
      subtitle: `${lock.hardness} · ${lock.targetKind}`,
      excerpt: lockText,
      estimatedTokens: est,
      disposition: stage,
      lockedById: lock.id,
    });
  }

  // 2. Evaluate Manuscript & Source Chunks
  // Prioritize chunks matching activeSectionId or hybrid search queryHint first
  const priorityChunkIds = new Set<string>();
  if (options.activeSectionId) {
    for (const c of activeSectionChunks) priorityChunkIds.add(c.id);
  }
  if (options.queryHint && options.queryHint.trim()) {
    const searchRes = executeHybridNarrativeSearch(index, {
      query: options.queryHint,
      scope: 'all',
      maxPresentationOrder: options.maxPresentationOrder,
      limit: 20,
    });
    for (const r of searchRes.results) {
      if (r.kind === 'chunk' && r.sectionId) {
        for (const c of index.chunks) {
          if (
            c.sectionId === r.sectionId &&
            c.startOffset === r.startOffset &&
            c.endOffset === r.endOffset
          ) {
            priorityChunkIds.add(c.id);
          }
        }
      }
    }
  }

  const orderedChunks: NarrativeChunkRecord[] = [
    ...index.chunks.filter((c) => priorityChunkIds.has(c.id)),
    ...index.chunks.filter((c) => !priorityChunkIds.has(c.id)),
  ];

  const includedEntityIdsFromChunks = new Set<string>();

  for (const chunk of orderedChunks) {
    requestedCount += 1;

    // Scope check
    if (options.scope === 'scene' && options.activeSectionId && chunk.sectionId !== options.activeSectionId) {
      if (!priorityChunkIds.has(chunk.id)) {
        items.push({
          id: chunk.id,
          kind: 'chunk',
          label: chunk.sectionTitle,
          subtitle: `${chunk.sourceKind} · UTF-16 [${chunk.startOffset}..${chunk.endOffset}]`,
          excerpt: chunk.text.slice(0, 220),
          estimatedTokens: chunk.tokenCountEstimate,
          disposition: 'omitted',
          omissionReason: 'scope-excluded',
          sectionId: chunk.sectionId,
          startOffset: chunk.startOffset,
          endOffset: chunk.endOffset,
        });
        continue;
      }
    }

    if (options.scope === 'changed' && changedSet && !changedSet.has(chunk.sectionId)) {
      if (!priorityChunkIds.has(chunk.id)) {
        items.push({
          id: chunk.id,
          kind: 'chunk',
          label: chunk.sectionTitle,
          subtitle: `${chunk.sourceKind} · UTF-16 [${chunk.startOffset}..${chunk.endOffset}]`,
          excerpt: chunk.text.slice(0, 220),
          estimatedTokens: chunk.tokenCountEstimate,
          disposition: 'omitted',
          omissionReason: 'scope-excluded',
          sectionId: chunk.sectionId,
          startOffset: chunk.startOffset,
          endOffset: chunk.endOffset,
        });
        continue;
      }
    }

    // Spoiler boundary check
    if (
      options.maxPresentationOrder !== undefined &&
      chunk.presentationOrder > options.maxPresentationOrder
    ) {
      items.push({
        id: chunk.id,
        kind: 'chunk',
        label: chunk.sectionTitle,
        subtitle: `${chunk.sourceKind} · Scene #${chunk.presentationOrder + 1}`,
        excerpt: chunk.text.slice(0, 220),
        estimatedTokens: chunk.tokenCountEstimate,
        disposition: 'omitted',
        omissionReason: 'spoiler-boundary',
        sectionId: chunk.sectionId,
        startOffset: chunk.startOffset,
        endOffset: chunk.endOffset,
      });
      continue;
    }

    eligibleCount += 1;

    // Reserve at least 25% of token budget for structured entities & relationships
    const chunkBudgetCeiling = Math.floor(tokenBudget * 0.72);
    if (plannedTokens + chunk.tokenCountEstimate > chunkBudgetCeiling && items.some((i) => i.kind === 'chunk' && i.disposition !== 'omitted')) {
      items.push({
        id: chunk.id,
        kind: 'chunk',
        label: chunk.sectionTitle,
        subtitle: `${chunk.sourceKind} · UTF-16 [${chunk.startOffset}..${chunk.endOffset}]`,
        excerpt: chunk.text.slice(0, 220),
        estimatedTokens: chunk.tokenCountEstimate,
        disposition: 'omitted',
        omissionReason: 'budget-cap',
        sectionId: chunk.sectionId,
        startOffset: chunk.startOffset,
        endOffset: chunk.endOffset,
      });
      continue;
    }

    plannedTokens += chunk.tokenCountEstimate;
    for (const eid of chunk.entityIds) {
      includedEntityIdsFromChunks.add(eid);
    }

    items.push({
      id: chunk.id,
      kind: 'chunk',
      label: chunk.sectionTitle,
      subtitle: `${chunk.sourceKind} · Scene #${chunk.presentationOrder + 1} · UTF-16 [${chunk.startOffset}..${chunk.endOffset}]`,
      excerpt: chunk.text,
      estimatedTokens: chunk.tokenCountEstimate,
      disposition: stage,
      sectionId: chunk.sectionId,
      startOffset: chunk.startOffset,
      endOffset: chunk.endOffset,
    });
  }

  // 3. Evaluate ALL Entities via E1 index (relevance-ranked, never arbitrary .slice(0, 80))
  const rankedEntities: IndexedEntityRecord[] = [...index.entities].sort((a, b) => {
    const aMentioned = includedEntityIdsFromChunks.has(a.id) ? 1 : 0;
    const bMentioned = includedEntityIdsFromChunks.has(b.id) ? 1 : 0;
    if (aMentioned !== bMentioned) return bMentioned - aMentioned;
    return b.mentionChunkIds.length - a.mentionChunkIds.length || a.name.localeCompare(b.name);
  });

  const plannedEntityIds = new Set<string>();

  for (const entity of rankedEntities) {
    requestedCount += 1;
    const summaryText = `${entity.name} (${entity.category}): ${entity.description}${
      entity.attributes.length > 0
        ? ` [${entity.attributes.map((a) => `${a.key}=${a.value}`).join('; ')}]`
        : ''
    }`;
    const est = estimateTokenCount(summaryText);

    if (entity.excluded) {
      items.push({
        id: `entity_${entity.id}`,
        kind: 'entity',
        label: entity.name,
        subtitle: `${entity.category} · Excluded`,
        excerpt: summaryText,
        estimatedTokens: est,
        disposition: 'omitted',
        omissionReason: 'excluded-entity',
      });
      continue;
    }

    if (
      options.maxPresentationOrder !== undefined &&
      (entity.firstPresentationOrder === undefined ||
        entity.firstPresentationOrder > options.maxPresentationOrder)
    ) {
      items.push({
        id: `entity_${entity.id}`,
        kind: 'entity',
        label: entity.name,
        subtitle: `${entity.category} · Spoiler Filtered`,
        excerpt: summaryText,
        estimatedTokens: est,
        disposition: 'omitted',
        omissionReason: 'spoiler-boundary',
      });
      continue;
    }

    eligibleCount += 1;

    if (plannedTokens + est > tokenBudget) {
      items.push({
        id: `entity_${entity.id}`,
        kind: 'entity',
        label: entity.name,
        subtitle: `${entity.category}`,
        excerpt: summaryText,
        estimatedTokens: est,
        disposition: 'omitted',
        omissionReason: 'budget-cap',
      });
      continue;
    }

    plannedTokens += est;
    plannedEntityIds.add(entity.id);
    items.push({
      id: `entity_${entity.id}`,
      kind: 'entity',
      label: entity.name,
      subtitle: `${entity.category} · ${entity.mentionChunkIds.length} mention(s)`,
      excerpt: summaryText,
      estimatedTokens: est,
      disposition: stage,
    });
  }

  // 4. Evaluate ALL Relationships via E1 index (relevance-ranked, never arbitrary .slice(0, 100))
  const rankedRelationships: IndexedRelationshipRecord[] = [...index.relationships].sort((a, b) => {
    const aActive =
      (plannedEntityIds.has(a.sourceEntityId) ? 1 : 0) +
      (plannedEntityIds.has(a.targetEntityId) ? 1 : 0);
    const bActive =
      (plannedEntityIds.has(b.sourceEntityId) ? 1 : 0) +
      (plannedEntityIds.has(b.targetEntityId) ? 1 : 0);
    if (aActive !== bActive) return bActive - aActive;
    return b.mentionChunkIds.length - a.mentionChunkIds.length || a.id.localeCompare(b.id);
  });

  for (const rel of rankedRelationships) {
    requestedCount += 1;
    const relText = `${rel.sourceEntityName} -> [${rel.type}] -> ${rel.targetEntityName}${
      rel.description ? ` (${rel.description})` : ''
    }`;
    const est = estimateTokenCount(relText);

    if (
      options.maxPresentationOrder !== undefined &&
      (rel.firstPresentationOrder === undefined ||
        rel.firstPresentationOrder > options.maxPresentationOrder)
    ) {
      items.push({
        id: `rel_${rel.id}`,
        kind: 'relationship',
        label: `${rel.sourceEntityName} → ${rel.targetEntityName}`,
        subtitle: rel.type,
        excerpt: relText,
        estimatedTokens: est,
        disposition: 'omitted',
        omissionReason: 'spoiler-boundary',
      });
      continue;
    }

    eligibleCount += 1;

    if (plannedTokens + est > tokenBudget) {
      items.push({
        id: `rel_${rel.id}`,
        kind: 'relationship',
        label: `${rel.sourceEntityName} → ${rel.targetEntityName}`,
        subtitle: rel.type,
        excerpt: relText,
        estimatedTokens: est,
        disposition: 'omitted',
        omissionReason: 'budget-cap',
      });
      continue;
    }

    plannedTokens += est;
    items.push({
      id: `rel_${rel.id}`,
      kind: 'relationship',
      label: `${rel.sourceEntityName} → ${rel.targetEntityName}`,
      subtitle: `Relationship · ${rel.type}`,
      excerpt: relText,
      estimatedTokens: est,
      disposition: stage,
    });
  }

  const includedItems = items.filter((i) => i.disposition !== 'omitted');
  const omittedItems = items.filter((i) => i.disposition === 'omitted');

  const scopeLabel =
    options.scope === 'scene'
      ? `Scene Scope${options.activeSectionId ? ` (${options.activeSectionId})` : ''}`
      : options.scope === 'changed'
        ? `Changed Sections (${options.changedSectionIds?.length ?? 0})`
        : `Full Manuscript & Memory${
            activePresentationOrder !== undefined && options.maxPresentationOrder !== undefined
              ? ` (Up to Scene #${options.maxPresentationOrder + 1})`
              : ''
          }`;

  return {
    projectId: project.id,
    projectRevision: index.projectRevision,
    manuscriptVersionId: index.manuscriptVersionId,
    operationIntent: options.operationIntent,
    scopeLabel,
    activeSectionId: options.activeSectionId,
    maxPresentationOrder: options.maxPresentationOrder,
    tokenBudget,
    estimatedPlannedTokens: plannedTokens,
    measuredSentTokens: options.measuredSentTokens,
    counts: {
      requested: requestedCount,
      eligible: eligibleCount,
      planned: includedItems.length,
      sent: stage === 'sent' || stage === 'completed' ? includedItems.length : 0,
      completed: stage === 'completed' ? includedItems.length : 0,
      omitted: omittedItems.length,
    },
    activeLocks,
    items,
    segments: [
      {
        segmentIndex: 0,
        status: stage,
        includedItemIds: includedItems.map((i) => i.id),
        estimatedTokens: plannedTokens,
        measuredTokens: options.measuredSentTokens,
      },
    ],
    builtAt: Date.now(),
  };
}
