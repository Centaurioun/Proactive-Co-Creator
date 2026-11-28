import { CreativeProject } from '../../../shared/types';
import { UnifiedProposal } from '../../../shared/unifiedProposalTypes';
import { manuscriptSections } from '../manuscriptModel';
import { normalizeUnicodeText } from '../memory/textNormalization';
import { CompiledProposalPreviewResult, compileUnifiedProposalPreview } from './unifiedProposalEngine';

export type ChangeMapDiffState = 'added' | 'modified' | 'removed' | 'unchanged';

export interface ChangeMapNode {
  id: string;
  label: string;
  category: 'section' | 'entity' | 'story_bible';
  diffState: ChangeMapDiffState;
  beforeSummary: string;
  afterSummary: string;
  x: number;
  y: number;
}

export interface ChangeMapEdge {
  id: string;
  sourceNodeId: string;
  targetNodeId: string;
  sourceLabel: string;
  targetLabel: string;
  label: string;
  diffState: ChangeMapDiffState;
  beforeLabel?: string;
  afterLabel?: string;
}

export interface SpeculativeDownstreamNote {
  id: string;
  targetLabel: string;
  reason: string;
}

export interface VisualChangeMapProjection {
  patchDigest: string;
  nodes: ChangeMapNode[];
  edges: ChangeMapEdge[];
  speculativeDownstreamNotes: SpeculativeDownstreamNote[];
  summaryCounts: {
    addedNodes: number;
    modifiedNodes: number;
    removedNodes: number;
    addedEdges: number;
    modifiedEdges: number;
    removedEdges: number;
  };
}

/**
 * Deterministically builds the `V7` Visual Change Map (`CE-04.3`, `S-06`, `V7`)
 * strictly from `baseProject + compiledProposalPreview`.
 * Never invokes a second AI request or fabricates unverified canon changes.
 */
export function buildVisualChangeMap(
  baseProject: CreativeProject,
  proposal: UnifiedProposal,
  precompiled?: CompiledProposalPreviewResult
): VisualChangeMapProjection {
  const compiled = precompiled ?? compileUnifiedProposalPreview(baseProject, proposal);
  const baseSections = manuscriptSections(baseProject);
  const candidateSections = compiled.candidateSections;

  const nodes: ChangeMapNode[] = [];
  const edges: ChangeMapEdge[] = [];
  const speculativeDownstreamNotes: SpeculativeDownstreamNote[] = [];

  // 1. Compare Manuscript Sections touched by selected hunks
  const selectedSet = new Set(proposal.selectedIds);
  const touchedSectionIds = new Set(
    proposal.manuscriptHunks.filter((h) => selectedSet.has(h.id)).map((h) => h.sectionId)
  );

  for (const baseSec of baseSections) {
    if (!touchedSectionIds.has(baseSec.id)) continue;
    const nextSec = candidateSections.find((s) => s.id === baseSec.id);
    if (!nextSec) continue;
    const changed = baseSec.text !== nextSec.text;
    nodes.push({
      id: `node_sec_${baseSec.id}`,
      label: baseSec.title || `Scene ${baseSec.id}`,
      category: 'section',
      diffState: changed ? 'modified' : 'unchanged',
      beforeSummary: `${baseSec.text.length} chars`,
      afterSummary: `${nextSec.text.length} chars (${nextSec.text.length - baseSec.text.length >= 0 ? '+' : ''}${nextSec.text.length - baseSec.text.length})`,
      x: 0,
      y: 0,
    });
  }

  // 2. Compare Entities between baseProject.snapshot.entities and candidateProject.snapshot.entities
  const baseEntities = baseProject.snapshot.entities ?? [];
  const nextEntities = compiled.candidateProject.snapshot.entities ?? [];

  const baseEntityByKey = new Map(
    baseEntities.map((e) => [normalizeUnicodeText(e.id || e.name), e])
  );
  const nextEntityByKey = new Map(
    nextEntities.map((e) => [normalizeUnicodeText(e.id || e.name), e])
  );

  const entityNodeIdByName = new Map<string, string>();
  const modifiedEntityNames = new Set<string>();

  for (const [key, nextEnt] of nextEntityByKey.entries()) {
    const baseEnt = baseEntityByKey.get(key);
    const nodeId = `node_ent_${key}`;
    entityNodeIdByName.set(normalizeUnicodeText(nextEnt.name), nodeId);

    const nextAttrs = (nextEnt.attributes ?? [])
      .map((a) => `${a.name}: ${a.confirmedValue ?? a.value?.[0]?.name ?? ''}`)
      .join(', ');

    if (!baseEnt) {
      nodes.push({
        id: nodeId,
        label: nextEnt.name,
        category: 'entity',
        diffState: 'added',
        beforeSummary: '(Not present)',
        afterSummary: nextAttrs || nextEnt.description || 'Added entity',
        x: 0,
        y: 0,
      });
      modifiedEntityNames.add(normalizeUnicodeText(nextEnt.name));
    } else {
      const baseAttrs = (baseEnt.attributes ?? [])
        .map((a) => `${a.name}: ${a.confirmedValue ?? a.value?.[0]?.name ?? ''}`)
        .join(', ');
      const wasExcluded = Boolean(baseEnt.excluded);
      const isExcluded = Boolean(nextEnt.excluded);

      if (!wasExcluded && isExcluded) {
        nodes.push({
          id: nodeId,
          label: nextEnt.name,
          category: 'entity',
          diffState: 'removed',
          beforeSummary: baseAttrs || baseEnt.description || 'Active entity',
          afterSummary: '(Excluded / Removed)',
          x: 0,
          y: 0,
        });
        modifiedEntityNames.add(normalizeUnicodeText(nextEnt.name));
      } else if (
        baseEnt.name !== nextEnt.name ||
        baseEnt.description !== nextEnt.description ||
        baseAttrs !== nextAttrs ||
        wasExcluded !== isExcluded
      ) {
        nodes.push({
          id: nodeId,
          label: nextEnt.name,
          category: 'entity',
          diffState: 'modified',
          beforeSummary: baseAttrs || baseEnt.description || 'Active',
          afterSummary: nextAttrs || nextEnt.description || 'Updated',
          x: 0,
          y: 0,
        });
        modifiedEntityNames.add(normalizeUnicodeText(nextEnt.name));
      }
    }
  }

  // 3. Compare Relationships and include endpoints in node graph
  const baseRels = baseProject.snapshot.relationships ?? [];
  const nextRels = compiled.candidateProject.snapshot.relationships ?? [];

  const relKey = (r: { source: string; target: string }) =>
    `${normalizeUnicodeText(r.source)}__${normalizeUnicodeText(r.target)}`;

  const baseRelByKey = new Map(baseRels.map((r) => [relKey(r), r]));
  const nextRelByKey = new Map(nextRels.map((r) => [relKey(r), r]));

  const ensureEndpointNode = (entityName: string): string => {
    const norm = normalizeUnicodeText(entityName);
    const existingNodeId = entityNodeIdByName.get(norm);
    if (existingNodeId && nodes.some((n) => n.id === existingNodeId)) {
      return existingNodeId;
    }
    const nodeId = `node_ent_${norm}`;
    entityNodeIdByName.set(norm, nodeId);
    if (!nodes.some((n) => n.id === nodeId)) {
      nodes.push({
        id: nodeId,
        label: entityName,
        category: 'entity',
        diffState: 'unchanged',
        beforeSummary: 'Unchanged endpoint',
        afterSummary: 'Unchanged endpoint',
        x: 0,
        y: 0,
      });
    }
    return nodeId;
  };

  for (const [k, nextRel] of nextRelByKey.entries()) {
    const baseRel = baseRelByKey.get(k);
    if (!baseRel) {
      const srcId = ensureEndpointNode(nextRel.source);
      const tgtId = ensureEndpointNode(nextRel.target);
      edges.push({
        id: `edge_${k}`,
        sourceNodeId: srcId,
        targetNodeId: tgtId,
        sourceLabel: nextRel.source,
        targetLabel: nextRel.target,
        label: nextRel.label,
        diffState: 'added',
        afterLabel: nextRel.label,
      });
    } else if (baseRel.label !== nextRel.label) {
      const srcId = ensureEndpointNode(nextRel.source);
      const tgtId = ensureEndpointNode(nextRel.target);
      edges.push({
        id: `edge_${k}`,
        sourceNodeId: srcId,
        targetNodeId: tgtId,
        sourceLabel: nextRel.source,
        targetLabel: nextRel.target,
        label: `${baseRel.label} → ${nextRel.label}`,
        diffState: 'modified',
        beforeLabel: baseRel.label,
        afterLabel: nextRel.label,
      });
    } else if (
      modifiedEntityNames.has(normalizeUnicodeText(nextRel.source)) ||
      modifiedEntityNames.has(normalizeUnicodeText(nextRel.target))
    ) {
      const srcId = ensureEndpointNode(nextRel.source);
      const tgtId = ensureEndpointNode(nextRel.target);
      edges.push({
        id: `edge_${k}`,
        sourceNodeId: srcId,
        targetNodeId: tgtId,
        sourceLabel: nextRel.source,
        targetLabel: nextRel.target,
        label: nextRel.label,
        diffState: 'unchanged',
        beforeLabel: baseRel.label,
        afterLabel: nextRel.label,
      });
    }
  }

  for (const [k, baseRel] of baseRelByKey.entries()) {
    if (!nextRelByKey.has(k)) {
      const srcId = ensureEndpointNode(baseRel.source);
      const tgtId = ensureEndpointNode(baseRel.target);
      edges.push({
        id: `edge_rem_${k}`,
        sourceNodeId: srcId,
        targetNodeId: tgtId,
        sourceLabel: baseRel.source,
        targetLabel: baseRel.target,
        label: baseRel.label,
        diffState: 'removed',
        beforeLabel: baseRel.label,
      });
    }
  }

  // 4. Compare Story Bible fields
  for (const [fieldKey, nextField] of Object.entries(compiled.candidateProject.snapshot.storyBible)) {
    const baseField = baseProject.snapshot.storyBible[fieldKey as keyof typeof baseProject.snapshot.storyBible];
    if (baseField && baseField.value !== nextField.value) {
      nodes.push({
        id: `node_sb_${fieldKey}`,
        label: `Story Bible: ${fieldKey}`,
        category: 'story_bible',
        diffState: baseField.value ? 'modified' : 'added',
        beforeSummary: baseField.value || '(Empty)',
        afterSummary: nextField.value || '(Cleared)',
        x: 0,
        y: 0,
      });
    }
  }

  // 5. Compute deterministic circular / layered SVG layout coordinates (680 x 320 viewport)
  const totalNodes = Math.max(1, nodes.length);
  const centerX = 340;
  const centerY = 160;
  const radiusX = totalNodes === 1 ? 0 : 210;
  const radiusY = totalNodes === 1 ? 0 : 105;

  for (let i = 0; i < nodes.length; i += 1) {
    const angle = (2 * Math.PI * i) / totalNodes - Math.PI / 2;
    nodes[i].x = Math.round(centerX + radiusX * Math.cos(angle));
    nodes[i].y = Math.round(centerY + radiusY * Math.sin(angle));
  }

  // 6. Compute separately labeled speculative downstream impact notes (deterministic, no AI call)
  if (modifiedEntityNames.size > 0) {
    for (const sec of baseSections) {
      if (touchedSectionIds.has(sec.id)) continue;
      const normSecText = normalizeUnicodeText(sec.text);
      for (const modName of modifiedEntityNames) {
        if (modName.length >= 2 && normSecText.includes(modName)) {
          speculativeDownstreamNotes.push({
            id: `spec_${sec.id}_${modName}`,
            targetLabel: sec.title || `Scene ${sec.id}`,
            reason: `Unmodified scene mentions modified entity "${modName}"; consider running Consistency Diagnostics after apply.`,
          });
        }
      }
    }
  }

  return {
    patchDigest: compiled.patchDigest,
    nodes,
    edges,
    speculativeDownstreamNotes,
    summaryCounts: {
      addedNodes: nodes.filter((n) => n.diffState === 'added').length,
      modifiedNodes: nodes.filter((n) => n.diffState === 'modified').length,
      removedNodes: nodes.filter((n) => n.diffState === 'removed').length,
      addedEdges: edges.filter((e) => e.diffState === 'added').length,
      modifiedEdges: edges.filter((e) => e.diffState === 'modified').length,
      removedEdges: edges.filter((e) => e.diffState === 'removed').length,
    },
  };
}
