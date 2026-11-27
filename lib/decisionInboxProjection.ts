/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { isSceneEntityName } from './beliefGraphUtils.ts';
import type {
  Attribute,
  Clarification,
  DecisionItem,
  Entity,
  ProjectSnapshot,
  Relationship,
} from '../shared/types.ts';

type DecisionGroupKey = DecisionItem['groupKey'];

interface ProjectionContext {
  snapshot: ProjectSnapshot;
  existingById: Map<string, DecisionItem>;
  items: DecisionItem[];
  emittedIds: Set<string>;
  pendingClarTargetKeys: Set<string>;
  now: number;
}

function makeClarTargetKey(entityName?: string, attributeName?: string): string | null {
  if (!entityName || !attributeName) return null;
  return `${entityName.toLowerCase()}::${attributeName.toLowerCase()}`;
}

function pushProjectionItem(ctx: ProjectionContext, item: DecisionItem): void {
  ctx.items.push(item);
  ctx.emittedIds.add(item.id);
}

function resolveClarificationGroupKey(category: Clarification['category']): DecisionGroupKey {
  if (category === 'character') return 'character';
  if (category === 'setting') return 'setting';
  if (category === 'plot') return 'plot';
  if (category === 'visual') return 'visual';
  return 'story';
}

function buildClarificationExplanation(clar: Clarification): string {
  if (clar.outdatedReason) return `Note: ${clar.outdatedReason}`;
  if (clar.target?.entityName) {
    return `Targets ${clar.target.entityName}${clar.target.attributeName ? ` → ${clar.target.attributeName}` : ''}`;
  }
  if (clar.target?.storyField) return `Targets Story Bible → ${clar.target.storyField}`;
  return 'Clarification question';
}

function resolveClarificationStatus(
  clar: Clarification,
  prev: DecisionItem | undefined
): DecisionItem['status'] {
  if (clar.status === 'outdated') return 'outdated';
  if (clar.status === 'deferred') return 'deferred';
  return prev?.status && prev.status !== 'pending' ? prev.status : 'pending';
}

function buildClarificationDecision(
  clar: Clarification,
  prev: DecisionItem | undefined,
  now: number
): DecisionItem {
  const id = `dec_clar_${clar.id ?? clar.question}`;
  return {
    id,
    category: 'clarification',
    title: clar.question,
    description: clar.impact || 'Clarify this creative detail to enrich the story plan.',
    explanation: buildClarificationExplanation(clar),
    provenance: 'ai-inferred',
    status: resolveClarificationStatus(clar, prev),
    groupKey: resolveClarificationGroupKey(clar.category),
    targetEntityId: clar.target?.entityId,
    targetEntityName: clar.target?.entityName,
    targetAttributeName: clar.target?.attributeName,
    targetStoryField: clar.target?.storyField,
    questionId: clar.id ?? clar.question,
    proposedValue: prev?.proposedValue ?? clar.options[0] ?? '',
    options: clar.options,
    createdAt: prev?.createdAt ?? now,
  };
}

function appendClarificationDecisions(ctx: ProjectionContext): void {
  for (const clar of ctx.snapshot.clarifications) {
    const id = `dec_clar_${clar.id ?? clar.question}`;
    const prev = ctx.existingById.get(id);
    if (clar.status === 'answered' || clar.status === 'skipped') {
      if (prev) {
        pushProjectionItem(ctx, {
          ...prev,
          status: clar.status === 'answered' ? 'accepted' : 'rejected',
        });
      }
      continue;
    }

    const item = buildClarificationDecision(clar, prev, ctx.now);
    pushProjectionItem(ctx, item);
    if (item.status === 'pending') {
      const targetKey = makeClarTargetKey(item.targetEntityName, item.targetAttributeName);
      if (targetKey) ctx.pendingClarTargetKeys.add(targetKey);
    }
  }
}

function resolveEntityGroupKey(entity: Entity, isScene: boolean): DecisionGroupKey {
  if (isScene) return 'story';
  if (entity.category === 'character' || entity.category === 'group') return 'character';
  if (entity.category === 'location') return 'setting';
  return 'plot';
}

function buildAttributeDecision(
  entity: Entity,
  attr: Attribute,
  candidateVal: string,
  prev: DecisionItem | undefined,
  isScene: boolean,
  now: number
): DecisionItem {
  return {
    id: `dec_attr_${entity.id ?? entity.name}_${attr.name}`,
    category: isScene ? 'story-bible' : 'attribute',
    title: `${entity.name}: ${attr.name.replace(/_/g, ' ')}`,
    description: `Suggested value: "${prev?.proposedValue ?? candidateVal}"`,
    explanation: entity.presence_in_prompt
      ? `Inferred attribute for explicit entity "${entity.name}".`
      : `Suggested attribute for inferred entity "${entity.name}".`,
    provenance: attr.provenance ?? 'ai-inferred',
    status: prev?.status ?? 'pending',
    groupKey: resolveEntityGroupKey(entity, isScene),
    targetEntityId: entity.id,
    targetEntityName: entity.name,
    targetAttributeName: attr.name,
    currentValue: attr.confirmedValue ?? 'Unconfirmed',
    proposedValue: prev?.proposedValue ?? candidateVal,
    options: attr.value.map((v) => v.name),
    createdAt: prev?.createdAt ?? now,
  };
}

function appendEntityAttributeDecisions(ctx: ProjectionContext, entity: Entity): void {
  const isScene = isSceneEntityName(entity.name) || entity.category === 'scene';
  for (const attr of entity.attributes) {
    if (attr.name === 'existence' || attr.name === 'existence_in_image') continue;
    const id = `dec_attr_${entity.id ?? entity.name}_${attr.name}`;
    const prev = ctx.existingById.get(id);

    if (attr.status === 'confirmed' || attr.status === 'rejected') {
      if (prev && (prev.status === 'accepted' || prev.status === 'rejected')) {
        pushProjectionItem(ctx, {
          ...prev,
          status: attr.status === 'confirmed' ? 'accepted' : 'rejected',
          proposedValue: attr.confirmedValue ?? prev.proposedValue,
        });
      }
      continue;
    }
    if (attr.presence_in_prompt && attr.confirmedValue) continue;

    const candidateVal = attr.confirmedValue ?? attr.value[0]?.name;
    if (!candidateVal || candidateVal === 'Unknown') continue;

    const targetKey = makeClarTargetKey(entity.name, attr.name);
    if (targetKey && ctx.pendingClarTargetKeys.has(targetKey)) continue;

    pushProjectionItem(ctx, buildAttributeDecision(entity, attr, candidateVal, prev, isScene, ctx.now));
  }
}

function appendAttributeDecisions(ctx: ProjectionContext): void {
  for (const entity of ctx.snapshot.entities) {
    if (!entity.excluded && entity.status !== 'rejected') {
      appendEntityAttributeDecisions(ctx, entity);
    }
  }
}

function buildRelationshipDecision(
  rel: Relationship,
  id: string,
  srcName: string,
  tgtName: string,
  prev: DecisionItem | undefined,
  now: number
): DecisionItem {
  return {
    id,
    category: 'relationship',
    title: `${srcName} → ${tgtName}`,
    description: `Suggested relationship: "${prev?.proposedValue ?? rel.label}"`,
    explanation: `AI-inferred directed relationship from "${srcName}" to "${tgtName}".`,
    provenance: rel.provenance ?? 'ai-inferred',
    status: prev?.status ?? 'pending',
    groupKey: 'character',
    targetRelationshipId: rel.id,
    targetSourceEntityName: srcName,
    targetTargetEntityName: tgtName,
    currentValue: 'Unconfirmed',
    proposedValue: prev?.proposedValue ?? rel.label,
    options: Array.from(new Set([rel.label, ...(rel.alternatives?.map((a) => a.name) ?? [])])),
    createdAt: prev?.createdAt ?? now,
  };
}

function appendRelationshipDecisions(ctx: ProjectionContext): void {
  const entityById = new Map(ctx.snapshot.entities.map((e) => [e.id, e]));
  for (const rel of ctx.snapshot.relationships) {
    const srcEnt = rel.sourceId ? entityById.get(rel.sourceId) : undefined;
    const tgtEnt = rel.targetId ? entityById.get(rel.targetId) : undefined;
    if (srcEnt?.excluded || tgtEnt?.excluded) continue;

    const relId = rel.id ?? `rel_${rel.source}_${rel.target}_${rel.label}`;
    const id = `dec_rel_${relId}`;
    const prev = ctx.existingById.get(id);

    if (rel.status === 'confirmed' || rel.status === 'rejected') {
      if (prev && (prev.status === 'accepted' || prev.status === 'rejected')) {
        pushProjectionItem(ctx, {
          ...prev,
          status: rel.status === 'confirmed' ? 'accepted' : 'rejected',
          proposedValue: rel.label,
        });
      }
      continue;
    }

    const srcName = srcEnt?.name ?? rel.source;
    const tgtName = tgtEnt?.name ?? rel.target;
    pushProjectionItem(ctx, buildRelationshipDecision(rel, id, srcName, tgtName, prev, ctx.now));
  }
}

function isRetainableExistingDecision(decision: DecisionItem): boolean {
  return (
    decision.category === 'conflict' ||
    decision.category === 'batch-operation' ||
    decision.status === 'accepted' ||
    decision.status === 'rejected' ||
    decision.status === 'deferred'
  );
}

function appendRetainedDecisions(ctx: ProjectionContext): void {
  for (const existing of ctx.snapshot.decisions) {
    if (!ctx.emittedIds.has(existing.id) && isRetainableExistingDecision(existing)) {
      pushProjectionItem(ctx, existing);
    }
  }
}

export function buildDecisionInboxFromSnapshot(snapshot: ProjectSnapshot): DecisionItem[] {
  const ctx: ProjectionContext = {
    snapshot,
    existingById: new Map(snapshot.decisions.map((d) => [d.id, d])),
    items: [],
    emittedIds: new Set<string>(),
    pendingClarTargetKeys: new Set<string>(),
    now: Date.now(),
  };

  appendClarificationDecisions(ctx);
  appendAttributeDecisions(ctx);
  appendRelationshipDecisions(ctx);
  appendRetainedDecisions(ctx);

  return ctx.items;
}
