/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { isSceneEntityName } from './beliefGraphUtils.ts';
import type { DecisionItem, ProjectSnapshot } from '../shared/types.ts';

/** Shared projection context; the order of phases is part of inbox behavior. */
interface ProjectionContext {
  existingById: Map<string, DecisionItem>;
  items: DecisionItem[];
  now: number;
}

function appendClarificationDecisions(snapshot: ProjectSnapshot, context: ProjectionContext): void {
  const { existingById, items, now } = context;
  // 1. Clarifications (active and resolved)
  for (const clar of snapshot.clarifications) {
    const id = `dec_clar_${clar.id ?? clar.question}`;
    const prev = existingById.get(id);
    if (clar.status === 'answered' || clar.status === 'skipped') {
      if (prev) {
        items.push({
          ...prev,
          status: clar.status === 'answered' ? 'accepted' : 'rejected',
        });
      }
      continue;
    }

    const groupKey =
      clar.category === 'character'
        ? 'character'
        : clar.category === 'setting'
          ? 'setting'
          : clar.category === 'plot'
            ? 'plot'
            : clar.category === 'visual'
              ? 'visual'
              : 'story';

    items.push({
      id,
      category: 'clarification',
      title: clar.question,
      description: clar.impact || 'Clarify this creative detail to enrich the story plan.',
      explanation: clar.outdatedReason
        ? `Note: ${clar.outdatedReason}`
        : clar.target?.entityName
          ? `Targets ${clar.target.entityName}${clar.target.attributeName ? ` → ${clar.target.attributeName}` : ''}`
          : clar.target?.storyField
            ? `Targets Story Bible → ${clar.target.storyField}`
            : 'Clarification question',
      provenance: 'ai-inferred',
      status:
        clar.status === 'outdated'
          ? 'outdated'
          : clar.status === 'deferred'
            ? 'deferred'
            : prev?.status && prev.status !== 'pending'
              ? prev.status
              : 'pending',
      groupKey,
      targetEntityId: clar.target?.entityId,
      targetEntityName: clar.target?.entityName,
      targetAttributeName: clar.target?.attributeName,
      targetStoryField: clar.target?.storyField,
      questionId: clar.id ?? clar.question,
      proposedValue: prev?.proposedValue ?? clar.options[0] ?? '',
      options: clar.options,
      createdAt: prev?.createdAt ?? now,
    });
  }
}

function appendAttributeDecisions(snapshot: ProjectSnapshot, context: ProjectionContext): void {
  const { existingById, items, now } = context;
  // 2. Entity Attributes (inferred by AI or previously resolved via Decision Inbox)
  for (const entity of snapshot.entities) {
    if (entity.excluded || entity.status === 'rejected') continue;
    const isScene = isSceneEntityName(entity.name) || entity.category === 'scene';
    for (const attr of entity.attributes) {
      if (attr.name === 'existence' || attr.name === 'existence_in_image') continue;
      const id = `dec_attr_${entity.id ?? entity.name}_${attr.name}`;
      const prev = existingById.get(id);

      if (attr.status === 'confirmed' || attr.status === 'rejected') {
        if (prev && (prev.status === 'accepted' || prev.status === 'rejected')) {
          items.push({
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

      // Avoid duplicating if an active pending clarification already targets this exact entity+attribute
      const coveredByClar = items.some(
        (d) =>
          d.category === 'clarification' &&
          d.status === 'pending' &&
          d.targetEntityName?.toLowerCase() === entity.name.toLowerCase() &&
          d.targetAttributeName?.toLowerCase() === attr.name.toLowerCase()
      );
      if (coveredByClar) continue;

      items.push({
        id,
        category: isScene ? 'story-bible' : 'attribute',
        title: `${entity.name}: ${attr.name.replace(/_/g, ' ')}`,
        description: `Suggested value: "${prev?.proposedValue ?? candidateVal}"`,
        explanation: entity.presence_in_prompt
          ? `Inferred attribute for explicit entity "${entity.name}".`
          : `Suggested attribute for inferred entity "${entity.name}".`,
        provenance: attr.provenance ?? 'ai-inferred',
        status: prev?.status ?? 'pending',
        groupKey: isScene
          ? 'story'
          : entity.category === 'character' || entity.category === 'group'
            ? 'character'
            : entity.category === 'location'
              ? 'setting'
              : 'plot',
        targetEntityId: entity.id,
        targetEntityName: entity.name,
        targetAttributeName: attr.name,
        currentValue: attr.confirmedValue ?? 'Unconfirmed',
        proposedValue: prev?.proposedValue ?? candidateVal,
        options: attr.value.map((v) => v.name),
        createdAt: prev?.createdAt ?? now,
      });
    }
  }
}

function appendRelationshipDecisions(snapshot: ProjectSnapshot, context: ProjectionContext): void {
  const { existingById, items, now } = context;
  // 3. Inferred / Pending Relationships (and previously resolved relationship decisions)
  const entityById = new Map(snapshot.entities.map((e) => [e.id, e]));
  for (const rel of snapshot.relationships) {
    const srcEnt = rel.sourceId ? entityById.get(rel.sourceId) : undefined;
    const tgtEnt = rel.targetId ? entityById.get(rel.targetId) : undefined;
    if (srcEnt?.excluded || tgtEnt?.excluded) continue;

    const relId = rel.id ?? `rel_${rel.source}_${rel.target}_${rel.label}`;
    const id = `dec_rel_${relId}`;
    const prev = existingById.get(id);

    if (rel.status === 'confirmed' || rel.status === 'rejected') {
      if (prev && (prev.status === 'accepted' || prev.status === 'rejected')) {
        items.push({
          ...prev,
          status: rel.status === 'confirmed' ? 'accepted' : 'rejected',
          proposedValue: rel.label,
        });
      }
      continue;
    }

    const srcName = srcEnt?.name ?? rel.source;
    const tgtName = tgtEnt?.name ?? rel.target;
    const options = Array.from(
      new Set([rel.label, ...(rel.alternatives?.map((a) => a.name) ?? [])])
    );

    items.push({
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
      options,
      createdAt: prev?.createdAt ?? now,
    });
  }
}

function appendRetainedDecisions(snapshot: ProjectSnapshot, context: ProjectionContext): void {
  const { items } = context;
  // 4. Preserve any explicitly staged conflict, batch-operation, or terminal decisions not already in items
  for (const existing of snapshot.decisions) {
    if (!items.some((i) => i.id === existing.id)) {
      if (
        existing.category === 'conflict' ||
        existing.category === 'batch-operation' ||
        existing.status === 'accepted' ||
        existing.status === 'rejected' ||
        existing.status === 'deferred'
      ) {
        items.push(existing);
      }
    }
  }
}

/**
 * Project canonical state into the decision inbox without mutating the snapshot.
 * Clarifications must precede attributes so pending targeted questions suppress
 * duplicate suggestions. Terminal and staged decisions are retained last.
 */
export function buildDecisionInboxFromSnapshot(snapshot: ProjectSnapshot): DecisionItem[] {
  const context: ProjectionContext = {
    existingById: new Map(snapshot.decisions.map((d) => [d.id, d])),
    items: [],
    now: Date.now(),
  };
  appendClarificationDecisions(snapshot, context);
  appendAttributeDecisions(snapshot, context);
  appendRelationshipDecisions(snapshot, context);
  appendRetainedDecisions(snapshot, context);
  return context.items;
}
