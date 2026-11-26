/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { isSceneEntityName, splitSceneAndObjectEntities } from '../beliefGraphUtils.ts';
import { buildDecisionInboxFromSnapshot } from '../decisionInboxProjection.ts';
import { synthesizeRefinedPrompt } from '../promptBuilder.ts';
import type {
  ApprovalStatus,
  Attribute,
  DecisionProvenance,
  Entity,
  EntityCategory,
  ProjectSnapshot,
  Relationship,
  StoryBibleFields,
} from '../../shared/types.ts';
import { findEntityByRef, makeStableId } from './ids.ts';
import {
  removeNamesFromExplicitExclusionsInPlace,
  SCENE_ATTR_TO_BIBLE_FIELD,
  STORY_FIELD_TO_SCENE_ATTRS,
  syncStoryBibleWithSceneEntityInPlace,
  validateStoryBibleUpdate,
} from './storyBibleSync.ts';

export function finalizeSnapshotInPlace(next: ProjectSnapshot, now: number = Date.now()): void {
  syncStoryBibleWithSceneEntityInPlace(next, now);
  next.decisions = buildDecisionInboxFromSnapshot(next);
  next.refinedPrompt = synthesizeRefinedPrompt(next);
}

export function mutateEntityExistenceInPlace(
  next: ProjectSnapshot,
  entityIdOrName: string,
  exists: boolean,
  provenance: DecisionProvenance = 'user-edit'
): boolean {
  const now = Date.now();
  const entity = findEntityByRef(next.entities, entityIdOrName);
  if (!entity) return false;

  const wasExcluded = Boolean(entity.excluded);
  entity.excluded = !exists;
  entity.status = 'confirmed';
  entity.provenance = provenance;

  const strVal = exists ? 'true' : 'false';
  const exAttr = entity.attributes.find(
    (a) => a.name === 'existence' || a.name === 'existence_in_image'
  );
  if (exAttr) {
    exAttr.confirmedValue = strVal;
    exAttr.status = 'confirmed';
    exAttr.provenance = provenance;
    exAttr.updatedAt = now;
    exAttr.value = [{ name: strVal }, { name: exists ? 'false' : 'true' }];
  } else {
    entity.attributes.unshift({
      id: makeStableId('attr'),
      name: 'existence',
      presence_in_prompt: entity.presence_in_prompt,
      value: [{ name: 'true' }, { name: 'false' }],
      confirmedValue: strVal,
      status: 'confirmed',
      provenance,
      updatedAt: now,
    });
  }

  if (exists && (wasExcluded || next.storyBible.explicitExclusions.value.trim())) {
    removeNamesFromExplicitExclusionsInPlace(
      next,
      [entity.name, ...(entity.aliases ?? [])],
      provenance,
      now
    );
  }

  return true;
}

function updateExistingAttributeInPlace(
  attr: Attribute,
  newValue: string,
  provenance: DecisionProvenance,
  monotonicNow: number,
  isClearingSceneAttr: boolean
): void {
  attr.confirmedValue = isClearingSceneAttr ? undefined : newValue;
  attr.status = isClearingSceneAttr ? 'pending' : 'confirmed';
  attr.provenance = provenance;
  attr.updatedAt = monotonicNow;
  if (provenance === 'user-edit' && (attr.sourceBacked || attr.epistemicKind)) {
    attr.epistemicKind = 'user-authored';
  }
  attr.value = isClearingSceneAttr
    ? []
    : [{ name: newValue }, ...attr.value.filter((v) => v.name !== newValue)];
}

function markAttributeDecisionsAndClarifications(
  next: ProjectSnapshot,
  entity: Entity,
  normAttr: string,
  newValue: string
): void {
  const entLower = entity.name.toLowerCase();
  next.decisions = next.decisions.map((dec) => {
    const matchesEntity =
      dec.targetEntityId === entity.id || dec.targetEntityName?.toLowerCase() === entLower;
    if (matchesEntity && dec.targetAttributeName?.toLowerCase() === normAttr) {
      return { ...dec, proposedValue: newValue, status: 'accepted' };
    }
    return dec;
  });

  next.clarifications = next.clarifications.map((clar) => {
    const matchesEntity =
      clar.target?.entityId === entity.id || clar.target?.entityName?.toLowerCase() === entLower;
    if (
      clar.target?.type === 'entity_attribute' &&
      matchesEntity &&
      clar.target.attributeName?.toLowerCase() === normAttr
    ) {
      return { ...clar, status: 'answered' };
    }
    return clar;
  });
}

export function mutateEntityAttributeInPlace(
  next: ProjectSnapshot,
  entityIdOrName: string,
  attributeName: string,
  newValue: string,
  provenance: DecisionProvenance = 'user-edit'
): boolean {
  const entity = findEntityByRef(next.entities, entityIdOrName);
  if (!entity) return false;

  if (attributeName === 'existence' || attributeName === 'existence_in_image') {
    return mutateEntityExistenceInPlace(next, entity.id ?? entity.name, newValue === 'true', provenance);
  }

  const normAttr = attributeName.trim().toLowerCase();
  const mappedBibleField = isSceneEntityName(entity.name)
    ? SCENE_ATTR_TO_BIBLE_FIELD[normAttr]
    : undefined;
  const attr = entity.attributes.find((a) => a.name.trim().toLowerCase() === normAttr);
  if (attr && newValue === (attr.confirmedValue ?? '') && provenance === 'user-edit') {
    return false;
  }

  const monotonicNow = Math.max(
    Date.now(),
    (attr?.updatedAt ?? 0) + 1,
    mappedBibleField ? (next.storyBible[mappedBibleField]?.updatedAt ?? 0) + 1 : 0
  );
  const isClearingSceneAttr = Boolean(mappedBibleField && newValue.trim().length === 0);

  if (attr) {
    updateExistingAttributeInPlace(attr, newValue, provenance, monotonicNow, isClearingSceneAttr);
  } else {
    entity.attributes.push({
      id: makeStableId('attr'),
      name: attributeName.trim(),
      presence_in_prompt: false,
      value: isClearingSceneAttr ? [] : [{ name: newValue }],
      confirmedValue: isClearingSceneAttr ? undefined : newValue,
      status: isClearingSceneAttr ? 'pending' : 'confirmed',
      provenance,
      updatedAt: monotonicNow,
    });
  }

  if (isClearingSceneAttr && mappedBibleField) {
    next.storyBible[mappedBibleField] = {
      value: '',
      status: 'pending',
      provenance,
      updatedAt: monotonicNow,
    };
  }

  entity.status = 'confirmed';
  markAttributeDecisionsAndClarifications(next, entity, normAttr, newValue);
  return true;
}

export function mutateRenameEntityInPlace(
  next: ProjectSnapshot,
  entityIdOrOldName: string,
  newName: string,
  provenance: DecisionProvenance = 'user-edit'
): boolean {
  const trimmedNew = newName.trim();
  if (!trimmedNew) return false;

  const normTarget = entityIdOrOldName.trim().toLowerCase();
  const entity = next.entities.find(
    (e) => e.id === entityIdOrOldName || e.name.trim().toLowerCase() === normTarget
  );
  if (!entity || entity.name === trimmedNew) return false;

  const oldName = entity.name;
  const oldLower = oldName.toLowerCase();
  entity.aliases = Array.from(new Set([...(entity.aliases ?? []), oldName]));
  entity.name = trimmedNew;
  entity.status = 'confirmed';
  entity.provenance = provenance;

  for (const rel of next.relationships) {
    if (rel.sourceId === entity.id || rel.source.toLowerCase() === oldLower) {
      rel.sourceId = entity.id;
      rel.source = trimmedNew;
    }
    if (rel.targetId === entity.id || rel.target.toLowerCase() === oldLower) {
      rel.targetId = entity.id;
      rel.target = trimmedNew;
    }
  }

  for (const clar of next.clarifications) {
    const matchesTarget =
      clar.target &&
      (clar.target.entityId === entity.id || clar.target.entityName?.toLowerCase() === oldLower);
    if (matchesTarget && clar.target) {
      clar.target.entityId = entity.id;
      clar.target.entityName = trimmedNew;
    }
  }

  return true;
}

export function mutateAddEntityInPlace(
  next: ProjectSnapshot,
  name: string,
  category: EntityCategory = 'character',
  description: string = '',
  provenance: DecisionProvenance = 'user-edit',
  initialAttributes: Record<string, string> = {}
): boolean {
  const trimmed = name.trim();
  if (!trimmed) return false;

  const existing = next.entities.find((e) => e.name.toLowerCase() === trimmed.toLowerCase());
  if (existing) {
    existing.excluded = false;
    existing.status = 'confirmed';
    if (description) existing.description = description;
    for (const [k, v] of Object.entries(initialAttributes)) {
      mutateEntityAttributeInPlace(next, existing.id ?? existing.name, k, v, provenance);
    }
    return true;
  }

  const now = Date.now();
  next.entities.push({
    id: makeStableId('ent'),
    name: trimmed,
    category,
    presence_in_prompt: false,
    description: description || `${category} added to the story plan.`,
    alternatives: [],
    status: 'confirmed',
    provenance,
    excluded: false,
    attributes: [
      {
        id: makeStableId('attr'),
        name: 'existence',
        presence_in_prompt: false,
        value: [{ name: 'true' }, { name: 'false' }],
        confirmedValue: 'true',
        status: 'confirmed',
        provenance,
        updatedAt: now,
      },
      ...Object.entries(initialAttributes).map(([attrName, attrVal]) => ({
        id: makeStableId('attr'),
        name: attrName,
        presence_in_prompt: false,
        value: [{ name: attrVal }],
        confirmedValue: attrVal,
        status: 'confirmed' as ApprovalStatus,
        provenance,
        updatedAt: now,
      })),
    ],
  });
  return true;
}

function findMatchingRelationshipForUpsert(
  relationships: Relationship[],
  sourceEnt: Entity | undefined,
  targetEnt: Entity | undefined,
  sourceName: string,
  targetName: string,
  trimmedLabel: string,
  options?: { relationshipId?: string; replaceSameDirectionSingle?: boolean }
): Relationship | undefined {
  if (options?.relationshipId) {
    const byId = relationships.find((r) => r.id === options.relationshipId);
    if (byId) return byId;
  }

  const srcLower = sourceName.toLowerCase();
  const tgtLower = targetName.toLowerCase();
  const matchesSameDirection = (r: Relationship) =>
    (Boolean(r.sourceId && sourceEnt?.id) &&
      r.sourceId === sourceEnt?.id &&
      r.targetId === targetEnt?.id) ||
    (r.source.toLowerCase() === srcLower && r.target.toLowerCase() === tgtLower);

  const labelLower = trimmedLabel.toLowerCase();
  const exact = relationships.find(
    (r) => matchesSameDirection(r) && r.label.trim().toLowerCase() === labelLower
  );
  if (exact) return exact;

  if (options?.replaceSameDirectionSingle) {
    const sameDir = relationships.filter(matchesSameDirection);
    if (sameDir.length === 1) return sameDir[0];
  }
  return undefined;
}

export function mutateUpsertRelationshipInPlace(
  next: ProjectSnapshot,
  sourceNameOrId: string,
  targetNameOrId: string,
  newLabel: string,
  provenance: DecisionProvenance = 'user-edit',
  options?: {
    relationshipId?: string;
    status?: ApprovalStatus;
    replaceSameDirectionSingle?: boolean;
  }
): boolean {
  const trimmedLabel = newLabel.trim();
  if (!trimmedLabel) return false;

  const sourceEnt = findEntityByRef(next.entities, sourceNameOrId);
  const targetEnt = findEntityByRef(next.entities, targetNameOrId);
  const sourceName = sourceEnt?.name ?? sourceNameOrId.trim();
  const targetName = targetEnt?.name ?? targetNameOrId.trim();
  const isSelfLoop =
    Boolean(sourceEnt?.id && targetEnt?.id && sourceEnt.id === targetEnt.id) ||
    sourceName.toLowerCase() === targetName.toLowerCase();
  if (isSelfLoop) return false;

  const desiredStatus: ApprovalStatus = options?.status ?? 'confirmed';
  const existing = findMatchingRelationshipForUpsert(
    next.relationships,
    sourceEnt,
    targetEnt,
    sourceName,
    targetName,
    trimmedLabel,
    options
  );

  if (existing) {
    existing.sourceId = sourceEnt?.id ?? existing.sourceId;
    existing.targetId = targetEnt?.id ?? existing.targetId;
    existing.source = sourceName;
    existing.target = targetName;
    existing.label = trimmedLabel;
    existing.status = desiredStatus;
    existing.provenance = provenance;
    if (!existing.alternatives?.some((a) => a.name === trimmedLabel)) {
      existing.alternatives = [{ name: trimmedLabel }, ...(existing.alternatives ?? [])];
    }
    return true;
  }

  next.relationships.push({
    id: options?.relationshipId ?? makeStableId('rel'),
    sourceId: sourceEnt?.id,
    targetId: targetEnt?.id,
    source: sourceName,
    target: targetName,
    label: trimmedLabel,
    alternatives: [{ name: trimmedLabel }],
    status: desiredStatus,
    provenance,
  });
  return true;
}

export function mutateUpdateRelationshipByIdInPlace(
  next: ProjectSnapshot,
  relationshipId: string,
  updates: {
    label?: string;
    status?: ApprovalStatus;
    reverseDirection?: boolean;
  },
  provenance: DecisionProvenance = 'user-edit'
): boolean {
  const rel = next.relationships.find((r) => r.id === relationshipId);
  if (!rel) return false;

  if (updates.reverseDirection) {
    const prevSource = rel.source;
    const prevSourceId = rel.sourceId;
    rel.source = rel.target;
    rel.sourceId = rel.targetId;
    rel.target = prevSource;
    rel.targetId = prevSourceId;
  }

  const trimmed = updates.label?.trim();
  if (trimmed) {
    const changed = trimmed !== rel.label || Boolean(updates.reverseDirection);
    rel.label = trimmed;
    if (changed && provenance === 'user-edit' && (rel.sourceBacked || rel.epistemicKind)) {
      rel.epistemicKind = 'user-authored';
    }
    if (!rel.alternatives?.some((a) => a.name === trimmed)) {
      rel.alternatives = [{ name: trimmed }, ...(rel.alternatives ?? [])];
    }
  }

  rel.status = updates.status ?? 'confirmed';
  rel.provenance = provenance;
  return true;
}

export function mutateRemoveRelationshipInPlace(
  next: ProjectSnapshot,
  sourceNameOrId: string,
  targetNameOrId?: string,
  label?: string
): boolean {
  if (!targetNameOrId) {
    next.relationships = next.relationships.filter((r) => r.id !== sourceNameOrId);
    return true;
  }

  const sLower = sourceNameOrId.trim().toLowerCase();
  const tLower = targetNameOrId.trim().toLowerCase();
  const labelLower = label?.trim().toLowerCase();
  next.relationships = next.relationships.filter((r) => {
    const matchesSrc = r.sourceId?.toLowerCase() === sLower || r.source.toLowerCase() === sLower;
    const matchesTgt = r.targetId?.toLowerCase() === tLower || r.target.toLowerCase() === tLower;
    if (!matchesSrc || !matchesTgt) return true;
    return Boolean(labelLower && r.label.trim().toLowerCase() !== labelLower);
  });
  return true;
}

export function mutateUpdateStoryBibleFieldInPlace(
  next: ProjectSnapshot,
  field: keyof StoryBibleFields,
  value: string,
  provenance: DecisionProvenance = 'user-edit'
): boolean {
  const validation = validateStoryBibleUpdate(field, value);
  if (!validation.ok) return false;

  const { sceneEntity } = splitSceneAndObjectEntities(next.entities);
  const mappedAliases = new Set(STORY_FIELD_TO_SCENE_ATTRS[field] ?? []);
  const matchingSceneAttrs = sceneEntity
    ? sceneEntity.attributes.filter(
        (attr) =>
          mappedAliases.has(attr.name.toLowerCase()) ||
          SCENE_ATTR_TO_BIBLE_FIELD[attr.name.toLowerCase()] === field
      )
    : [];

  let maxSceneAttrUpdatedAt = 0;
  for (const attr of matchingSceneAttrs) {
    maxSceneAttrUpdatedAt = Math.max(maxSceneAttrUpdatedAt, attr.updatedAt ?? 0);
  }

  const now = Math.max(
    Date.now(),
    (next.storyBible[field]?.updatedAt ?? 0) + 1,
    maxSceneAttrUpdatedAt + 1
  );

  if (validation.intent === 'clear') {
    next.storyBible[field] = { value: '', status: 'pending', provenance, updatedAt: now };
    for (const attr of matchingSceneAttrs) {
      attr.confirmedValue = undefined;
      attr.status = 'pending';
      attr.provenance = provenance;
      attr.updatedAt = now;
      attr.value = [];
      delete attr.epistemicKind;
      delete attr.sourceBacked;
    }
    return true;
  }

  const storedValue = validation.normalized;
  const displayValue = storedValue.trim();
  const priorField = next.storyBible[field];
  if (priorField.value === storedValue && priorField.status === 'confirmed' && provenance === 'user-edit') {
    return false;
  }

  const hasEpistemicContext = Boolean(
    priorField.sourceBacked ||
      priorField.epistemicKind ||
      matchingSceneAttrs.some((attr) => attr.sourceBacked || attr.epistemicKind)
  );
  const upgradeToUserAuthored = provenance === 'user-edit' && hasEpistemicContext;

  next.storyBible[field] = {
    value: storedValue,
    status: 'confirmed',
    provenance,
    updatedAt: now,
    ...(upgradeToUserAuthored ? { epistemicKind: 'user-authored' as const } : {}),
  };

  const primaryAttrName = STORY_FIELD_TO_SCENE_ATTRS[field]?.[0];
  if (sceneEntity && primaryAttrName) {
    for (const attr of matchingSceneAttrs) {
      attr.confirmedValue = displayValue;
      attr.status = 'confirmed';
      attr.provenance = provenance;
      attr.updatedAt = now;
      if (upgradeToUserAuthored) attr.epistemicKind = 'user-authored';
      if (!attr.value.some((v) => v.name === displayValue)) {
        attr.value = [{ name: displayValue }, ...attr.value];
      }
    }
    if (matchingSceneAttrs.length === 0) {
      sceneEntity.attributes.push({
        id: makeStableId('attr'),
        name: primaryAttrName,
        presence_in_prompt: false,
        value: [{ name: displayValue }],
        confirmedValue: displayValue,
        status: 'confirmed',
        provenance,
        updatedAt: now,
        ...(upgradeToUserAuthored ? { epistemicKind: 'user-authored' as const } : {}),
      });
    }
  }

  next.clarifications = next.clarifications.map((c) =>
    c.target?.type === 'story_bible' && c.target.storyField === field
      ? { ...c, status: 'answered' }
      : c
  );

  return true;
}
