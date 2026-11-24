import type { ApprovalStatus, DecisionProvenance, EntityCategory, ProjectSnapshot } from '../../../shared/types.ts';

export type RelationshipProjectionOmissionReason =
  | 'missing-relationship-id'
  | 'invalid-relationship-id'
  | 'duplicate-relationship-id'
  | 'missing-source-id'
  | 'invalid-source-id'
  | 'unknown-source-id'
  | 'ambiguous-source-id'
  | 'missing-target-id'
  | 'invalid-target-id'
  | 'unknown-target-id'
  | 'ambiguous-target-id'
  | 'empty-relationship-label';

export interface RelationshipProjectionNode {
  id: string;
  name: string;
  category?: EntityCategory;
  status?: ApprovalStatus;
  provenance?: DecisionProvenance;
  excluded?: boolean;
}

export interface RelationshipProjectionEdge {
  id: string;
  sourceId: string;
  targetId: string;
  label: string;
  status?: ApprovalStatus;
  provenance?: DecisionProvenance;
}

export interface OmittedRelationshipProjection {
  relationshipId?: string;
  sourceId?: string;
  targetId?: string;
  label: string;
  reasons: RelationshipProjectionOmissionReason[];
}

export interface RelationshipProjection {
  nodes: RelationshipProjectionNode[];
  edges: RelationshipProjectionEdge[];
  omissions: OmittedRelationshipProjection[];
}

type StableIdRead = { id: string; issue?: never } | { id?: never; issue: 'missing' | 'invalid' };

function readStableId(value: unknown): StableIdRead {
  if (value === undefined) return { issue: 'missing' };
  if (typeof value !== 'string' || !value || value.trim() !== value) return { issue: 'invalid' };
  return { id: value };
}

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function compareOptionalText(left: string | undefined, right: string | undefined): number {
  if (left === undefined) return right === undefined ? 0 : -1;
  if (right === undefined) return 1;
  return compareText(left, right);
}

function compareOmissions(left: OmittedRelationshipProjection, right: OmittedRelationshipProjection): number {
  const fields = [
    compareOptionalText(left.relationshipId, right.relationshipId),
    compareOptionalText(left.sourceId, right.sourceId),
    compareOptionalText(left.targetId, right.targetId),
    compareText(left.label, right.label),
  ];
  for (const result of fields) if (result !== 0) return result;
  const sharedLength = Math.min(left.reasons.length, right.reasons.length);
  for (let index = 0; index < sharedLength; index += 1) {
    const result = compareText(left.reasons[index] ?? '', right.reasons[index] ?? '');
    if (result !== 0) return result;
  }
  return left.reasons.length - right.reasons.length;
}

export function projectRelationships(snapshot: ProjectSnapshot): RelationshipProjection {
  const entitiesById = new Map<string, RelationshipProjectionNode[]>();
  for (const entity of snapshot.entities) {
    const { id } = readStableId(entity.id);
    if (!id) continue;
    const candidates = entitiesById.get(id) ?? [];
    candidates.push({
      id,
      name: entity.name,
      ...(entity.category === undefined ? {} : { category: entity.category }),
      ...(entity.status === undefined ? {} : { status: entity.status }),
      ...(entity.provenance === undefined ? {} : { provenance: entity.provenance }),
      ...(entity.excluded === undefined ? {} : { excluded: entity.excluded }),
    });
    entitiesById.set(id, candidates);
  }

  const relationshipIdCounts = new Map<string, number>();
  for (const relationship of snapshot.relationships) {
    const { id } = readStableId(relationship.id);
    if (id) relationshipIdCounts.set(id, (relationshipIdCounts.get(id) ?? 0) + 1);
  }

  const edges: RelationshipProjectionEdge[] = [];
  const omissions: OmittedRelationshipProjection[] = [];
  const projectedNodes = new Map<string, RelationshipProjectionNode>();

  for (const relationship of snapshot.relationships) {
    const relationshipIdentity = readStableId(relationship.id);
    const sourceIdentity = readStableId(relationship.sourceId);
    const targetIdentity = readStableId(relationship.targetId);
    const relationshipId = relationshipIdentity.id;
    const sourceId = sourceIdentity.id;
    const targetId = targetIdentity.id;
    const reasons: RelationshipProjectionOmissionReason[] = [];

    if (!relationshipId) reasons.push(relationshipIdentity.issue === 'invalid' ? 'invalid-relationship-id' : 'missing-relationship-id');
    else if (relationshipIdCounts.get(relationshipId) !== 1) reasons.push('duplicate-relationship-id');

    const sourceMatches = sourceId ? entitiesById.get(sourceId) ?? [] : [];
    if (!sourceId) reasons.push(sourceIdentity.issue === 'invalid' ? 'invalid-source-id' : 'missing-source-id');
    else if (sourceMatches.length === 0) reasons.push('unknown-source-id');
    else if (sourceMatches.length > 1) reasons.push('ambiguous-source-id');

    const targetMatches = targetId ? entitiesById.get(targetId) ?? [] : [];
    if (!targetId) reasons.push(targetIdentity.issue === 'invalid' ? 'invalid-target-id' : 'missing-target-id');
    else if (targetMatches.length === 0) reasons.push('unknown-target-id');
    else if (targetMatches.length > 1) reasons.push('ambiguous-target-id');

    if (typeof relationship.label !== 'string' || relationship.label.trim().length === 0) {
      reasons.push('empty-relationship-label');
    }

    if (reasons.length > 0 || !relationshipId || !sourceId || !targetId || typeof relationship.label !== 'string') {
      omissions.push({
        ...(relationshipId ? { relationshipId } : {}),
        ...(sourceId ? { sourceId } : {}),
        ...(targetId ? { targetId } : {}),
        label: typeof relationship.label === 'string' ? relationship.label : '',
        reasons,
      });
      continue;
    }

    const source = sourceMatches[0];
    const target = targetMatches[0];
    if (!source || !target) throw new Error('Validated relationship endpoints are unavailable.');
    edges.push({
      id: relationshipId,
      sourceId,
      targetId,
      label: relationship.label,
      ...(relationship.status === undefined ? {} : { status: relationship.status }),
      ...(relationship.provenance === undefined ? {} : { provenance: relationship.provenance }),
    });
    projectedNodes.set(sourceId, source);
    projectedNodes.set(targetId, target);
  }

  edges.sort((left, right) => compareText(left.id, right.id));
  omissions.sort(compareOmissions);
  const nodes = [...projectedNodes.values()].sort((left, right) => compareText(left.id, right.id));
  return { nodes, edges, omissions };
}
