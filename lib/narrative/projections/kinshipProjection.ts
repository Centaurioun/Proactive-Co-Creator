import type { CreativeProject, Entity, Relationship } from '../../../shared/types.ts';
import type { ExploredOpportunity } from '../../../shared/narrativeAiSchemas.ts';
import type { OpportunityProposalInput } from '../opportunityProposals.ts';
import { manuscriptSections } from '../manuscriptModel.ts';

export type KinshipRelationKind =
  | 'parent'
  | 'child'
  | 'sibling'
  | 'spouse'
  | 'adoptive'
  | 'step'
  | 'extended';

export interface VerifiedKinshipEdge {
  relationship: Relationship;
  sourceEntity: Entity;
  targetEntity: Entity;
  kinshipKind: KinshipRelationKind;
  isNonTreeQualification: boolean;
  qualificationNote?: string;
}

export interface VerifiedKinshipProjection {
  edges: VerifiedKinshipEdge[];
  nodes: Entity[];
  hasCycles: boolean;
  cycleEntityNames: string[];
  omittedNonKinshipCount: number;
  omittedPendingCount: number;
}

const KINSHIP_PATTERNS: Array<{ pattern: RegExp; kind: KinshipRelationKind; nonTree?: boolean; note?: string }> = [
  { pattern: /\b(adoptive\s+parent|adopted\s+by|adoptive\s+mother|adoptive\s+father|adopted\s+child)\b/i, kind: 'adoptive', nonTree: true, note: 'Adoptive tie (non-biological)' },
  { pattern: /\b(step-?parent|step-?mother|step-?father|step-?child|step-?sister|step-?brother|step-?sibling)\b/i, kind: 'step', nonTree: true, note: 'Blended/step-family tie' },
  { pattern: /\b(parent\s+of|mother\s+of|father\s+of|sire\s+of|dam\s+of)\b/i, kind: 'parent' },
  { pattern: /\b(child\s+of|son\s+of|daughter\s+of)\b/i, kind: 'child' },
  { pattern: /\b(sibling\s+of|brother\s+of|sister\s+of|twin\s+of)\b/i, kind: 'sibling' },
  { pattern: /\b(spouse\s+of|married\s+to|husband\s+of|wife\s+of|partner\s+of)\b/i, kind: 'spouse', nonTree: true, note: 'Partner/spousal tie' },
  { pattern: /\b(grandparent\s+of|grandmother\s+of|grandfather\s+of|grandchild\s+of|cousin\s+of|aunt\s+of|uncle\s+of|niece\s+of|nephew\s+of|kin\s+of|related\s+to)\b/i, kind: 'extended' },
];

export function classifyExplicitKinshipPredicate(
  label: string
): { kind: KinshipRelationKind; isNonTreeQualification: boolean; qualificationNote?: string } | null {
  const trimmed = label.trim();
  if (!trimmed) return null;
  for (const rule of KINSHIP_PATTERNS) {
    if (rule.pattern.test(trimmed)) {
      return {
        kind: rule.kind,
        isNonTreeQualification: Boolean(rule.nonTree),
        qualificationNote: rule.note,
      };
    }
  }
  return null;
}

/**
 * Projects ONLY explicitly verified (confirmed, canonical-ID-backed) kinship relationships.
 * Never infers kinship from generic social labels and never forces cyclic/step/adoptive
 * relationships into an artificial tree.
 */
export function buildVerifiedKinshipProjection(
  entities: readonly Entity[],
  relationships: readonly Relationship[]
): VerifiedKinshipProjection {
  const byId = new Map(entities.filter((e) => !e.excluded && e.id).map((e) => [e.id!, e]));
  const edges: VerifiedKinshipEdge[] = [];
  let omittedNonKinshipCount = 0;
  let omittedPendingCount = 0;

  for (const rel of relationships) {
    const kinship = classifyExplicitKinshipPredicate(rel.label);
    if (!kinship) {
      omittedNonKinshipCount += 1;
      continue;
    }
    if (rel.status !== 'confirmed') {
      omittedPendingCount += 1;
      continue;
    }
    if (!rel.sourceId || !rel.targetId) continue;
    const sourceEntity = byId.get(rel.sourceId);
    const targetEntity = byId.get(rel.targetId);
    if (!sourceEntity || !targetEntity) continue;
    edges.push({
      relationship: rel,
      sourceEntity,
      targetEntity,
      kinshipKind: kinship.kind,
      isNonTreeQualification: kinship.isNonTreeQualification,
      qualificationNote: kinship.qualificationNote,
    });
  }

  const nodeMap = new Map<string, Entity>();
  const adjacency = new Map<string, string[]>();
  for (const edge of edges) {
    nodeMap.set(edge.sourceEntity.id!, edge.sourceEntity);
    nodeMap.set(edge.targetEntity.id!, edge.targetEntity);
    if (edge.kinshipKind === 'parent' || edge.kinshipKind === 'child') {
      const from = edge.kinshipKind === 'parent' ? edge.sourceEntity.id! : edge.targetEntity.id!;
      const to = edge.kinshipKind === 'parent' ? edge.targetEntity.id! : edge.sourceEntity.id!;
      adjacency.set(from, [...(adjacency.get(from) ?? []), to]);
    }
  }

  // Honest cycle detection in directed lineage edges
  const visited = new Set<string>();
  const inStack = new Set<string>();
  const cycleNames = new Set<string>();
  const dfs = (id: string) => {
    visited.add(id);
    inStack.add(id);
    for (const next of adjacency.get(id) ?? []) {
      if (inStack.has(next)) {
        const entity = nodeMap.get(next);
        if (entity) cycleNames.add(entity.name);
      } else if (!visited.has(next)) {
        dfs(next);
      }
    }
    inStack.delete(id);
  };
  for (const id of adjacency.keys()) {
    if (!visited.has(id)) dfs(id);
  }

  return {
    edges,
    nodes: Array.from(nodeMap.values()),
    hasCycles: cycleNames.size > 0,
    cycleEntityNames: Array.from(cycleNames),
    omittedNonKinshipCount,
    omittedPendingCount,
  };
}

/**
 * Computes a 1-hop or 2-hop character ego network strictly from canonical IDs.
 */
export function buildCharacterEgoNetwork(
  entities: readonly Entity[],
  relationships: readonly Relationship[],
  focusEntityId: string,
  hops: 1 | 2 = 1
): { nodeIds: Set<string>; edges: Relationship[] } {
  const activeIds = new Set(entities.filter((e) => !e.excluded && e.id).map((e) => e.id!));
  if (!activeIds.has(focusEntityId)) return { nodeIds: new Set(), edges: [] };

  const nodeIds = new Set<string>([focusEntityId]);
  const collectHop = (frontier: Set<string>): Set<string> => {
    const next = new Set<string>();
    for (const rel of relationships) {
      if (!rel.sourceId || !rel.targetId) continue;
      if (!activeIds.has(rel.sourceId) || !activeIds.has(rel.targetId)) continue;
      if (frontier.has(rel.sourceId) && !nodeIds.has(rel.targetId)) next.add(rel.targetId);
      if (frontier.has(rel.targetId) && !nodeIds.has(rel.sourceId)) next.add(rel.sourceId);
    }
    for (const id of next) nodeIds.add(id);
    return next;
  };

  const hop1 = collectHop(new Set([focusEntityId]));
  if (hops === 2 && hop1.size > 0) {
    collectHop(hop1);
  }

  const edges = relationships.filter(
    (r) => r.sourceId && r.targetId && nodeIds.has(r.sourceId) && nodeIds.has(r.targetId)
  );
  return { nodeIds, edges };
}

/**
 * Validates AI-explored opportunity suggestions against real project IDs,
 * removes duplicate titles, and converts them into Proposal inputs with explicit AI origin.
 */
export function validateExploredOpportunities(
  project: CreativeProject,
  explored: readonly ExploredOpportunity[]
): {
  validInputs: Array<OpportunityProposalInput & { origin: 'ai'; category: string; options: string[]; targetKind?: 'project' | 'section' | 'entity'; targetId?: string }>;
  droppedDuplicates: number;
  strippedInvalidRefs: number;
} {
  const validIds = new Set<string>([
    project.id,
    ...project.snapshot.entities.flatMap((e) => (e.id ? [e.id] : [])),
    ...project.snapshot.relationships.flatMap((r) => (r.id ? [r.id] : [])),
    ...manuscriptSections(project).map((s) => s.id),
    ...(project.narrative?.sources.map((s) => s.id) ?? []),
  ]);

  const existingDescriptions = new Set(
    (project.narrative?.opportunities ?? []).map((o) => o.description.trim().toLowerCase())
  );

  let droppedDuplicates = 0;
  let strippedInvalidRefs = 0;
  const validInputs: Array<OpportunityProposalInput & { origin: 'ai'; category: string; options: string[]; targetKind?: 'project' | 'section' | 'entity'; targetId?: string }> = [];

  for (const item of explored) {
    const key = item.title.trim().toLowerCase();
    if (!key || existingDescriptions.has(key)) {
      droppedDuplicates += 1;
      continue;
    }
    existingDescriptions.add(key);

    const verifiedRefs = item.sourceRefs.filter((ref) => {
      if (validIds.has(ref)) return true;
      strippedInvalidRefs += 1;
      return false;
    });

    const verifiedTargetId = item.targetId && validIds.has(item.targetId) ? item.targetId : undefined;
    validInputs.push({
      description: item.title.trim(),
      sourceRefs: verifiedRefs,
      rationale: item.rationale.trim(),
      benefit: `AI suggestion (${item.category}): ${item.options[0] ?? 'Explore this creative angle.'}`,
      tradeOff: 'Optional creative direction — review against your confirmed canon before acting.',
      assumptions: ['Generated as an AI creative suggestion; does not modify canonical facts or manuscript.'],
      origin: 'ai',
      category: item.category,
      options: item.options,
      ...(item.targetKind && verifiedTargetId ? { targetKind: item.targetKind, targetId: verifiedTargetId } : {}),
    });
  }

  return { validInputs, droppedDuplicates, strippedInvalidRefs };
}
