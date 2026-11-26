/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { buildDecisionInboxFromSnapshot } from './decisionInboxProjection.ts';
import { synthesizeRefinedPrompt } from './promptBuilder.ts';
import type {
  ApprovalStatus,
  DecisionProvenance,
  EntityCategory,
  ProjectSnapshot,
  StoryBibleFields,
} from '../shared/types.ts';
import {
  finalizeSnapshotInPlace,
  mutateAddEntityInPlace,
  mutateEntityAttributeInPlace,
  mutateEntityExistenceInPlace,
  mutateRemoveRelationshipInPlace,
  mutateRenameEntityInPlace,
  mutateUpdateRelationshipByIdInPlace,
  mutateUpdateStoryBibleFieldInPlace,
  mutateUpsertRelationshipInPlace,
} from './canonical/mutators.ts';

export { makeStableId } from './canonical/ids.ts';
export { buildDecisionInboxFromSnapshot } from './decisionInboxProjection.ts';
export {
  createEmptyStoryBible,
  createSampleProject,
  SAMPLE_STORY_PROMPT,
} from './canonical/sampleProject.ts';
export {
  SCENE_ATTR_TO_BIBLE_FIELD,
  STORY_FIELD_TO_SCENE_ATTRS,
  syncStoryBibleWithSceneEntity,
  validateStoryBibleUpdate,
  type StoryBibleValidationResult,
} from './canonical/storyBibleSync.ts';
export { mergeAnalysisIntoSnapshot } from './canonical/analysisMerge.ts';
export { applyDecisionBatch } from './canonical/decisionBatch.ts';

export function setEntityAttribute(
  snapshot: ProjectSnapshot,
  entityIdOrName: string,
  attributeName: string,
  newValue: string,
  provenance: DecisionProvenance = 'user-edit'
): ProjectSnapshot {
  const next = structuredClone(snapshot);
  const changed = mutateEntityAttributeInPlace(next, entityIdOrName, attributeName, newValue, provenance);
  if (!changed && attributeName !== 'existence' && attributeName !== 'existence_in_image') {
    const normTarget = entityIdOrName.trim().toLowerCase();
    const matched = next.entities.find(
      (e) =>
        e.id === entityIdOrName ||
        e.name.trim().toLowerCase() === normTarget ||
        e.aliases?.some((a) => a.trim().toLowerCase() === normTarget)
    );
    if (matched) return snapshot;
  }
  finalizeSnapshotInPlace(next);
  return next;
}

export function setEntityExistence(
  snapshot: ProjectSnapshot,
  entityIdOrName: string,
  exists: boolean,
  provenance: DecisionProvenance = 'user-edit'
): ProjectSnapshot {
  const next = structuredClone(snapshot);
  const found = mutateEntityExistenceInPlace(next, entityIdOrName, exists, provenance);
  if (!found) return next;
  finalizeSnapshotInPlace(next);
  return next;
}

export function renameEntity(
  snapshot: ProjectSnapshot,
  entityIdOrOldName: string,
  newName: string,
  provenance: DecisionProvenance = 'user-edit'
): ProjectSnapshot {
  if (!newName.trim()) return snapshot;
  const next = structuredClone(snapshot);
  const changed = mutateRenameEntityInPlace(next, entityIdOrOldName, newName, provenance);
  if (!changed) return next;
  finalizeSnapshotInPlace(next);
  return next;
}

export function addEntity(
  snapshot: ProjectSnapshot,
  name: string,
  category: EntityCategory = 'character',
  description: string = '',
  provenance: DecisionProvenance = 'user-edit',
  initialAttributes: Record<string, string> = {}
): ProjectSnapshot {
  if (!name.trim()) return snapshot;
  const next = structuredClone(snapshot);
  mutateAddEntityInPlace(next, name, category, description, provenance, initialAttributes);
  finalizeSnapshotInPlace(next);
  return next;
}

export function upsertRelationship(
  snapshot: ProjectSnapshot,
  sourceNameOrId: string,
  targetNameOrId: string,
  newLabel: string,
  provenance: DecisionProvenance = 'user-edit',
  options?: {
    relationshipId?: string;
    status?: ApprovalStatus;
    replaceSameDirectionSingle?: boolean;
  }
): ProjectSnapshot {
  if (!newLabel.trim()) return snapshot;
  const next = structuredClone(snapshot);
  const changed = mutateUpsertRelationshipInPlace(
    next,
    sourceNameOrId,
    targetNameOrId,
    newLabel,
    provenance,
    options
  );
  if (!changed) return snapshot;
  finalizeSnapshotInPlace(next);
  return next;
}

export function updateRelationshipById(
  snapshot: ProjectSnapshot,
  relationshipId: string,
  updates: {
    label?: string;
    status?: ApprovalStatus;
    reverseDirection?: boolean;
  },
  provenance: DecisionProvenance = 'user-edit'
): ProjectSnapshot {
  const next = structuredClone(snapshot);
  const changed = mutateUpdateRelationshipByIdInPlace(next, relationshipId, updates, provenance);
  if (!changed) return snapshot;
  finalizeSnapshotInPlace(next);
  return next;
}

export function removeRelationship(
  snapshot: ProjectSnapshot,
  sourceNameOrId: string,
  targetNameOrId?: string,
  label?: string
): ProjectSnapshot {
  const next = structuredClone(snapshot);
  mutateRemoveRelationshipInPlace(next, sourceNameOrId, targetNameOrId, label);
  finalizeSnapshotInPlace(next);
  return next;
}

export function isRelationshipExplicitInPrompt(
  sourceName: string,
  label: string,
  targetName: string,
  originalIdea: string,
  rawPresenceFlag?: boolean
): boolean {
  if (rawPresenceFlag === false) return false;
  const promptLower = originalIdea.toLowerCase();
  if (!promptLower.trim()) return false;

  const cleanEndpoint = (n: string) =>
    n.toLowerCase().replace(/^(the|a|an)\s+/, '').trim();
  const srcClean = cleanEndpoint(sourceName);
  const tgtClean = cleanEndpoint(targetName);

  const stopWords = new Set(['of', 'to', 'with', 'for', 'in', 'on', 'at', 'by', 'from', 'the', 'a', 'an', 'is', 'are']);
  const labelTokens = label
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((tok) => tok.length > 2 && !stopWords.has(tok));

  if (labelTokens.length === 0) return Boolean(rawPresenceFlag);

  const hasLabelToken = labelTokens.some((tok) => {
    const stem = tok.replace(/(ing|ed|es|s)$/, '');
    return stem.length >= 3 ? promptLower.includes(stem) : promptLower.includes(tok);
  });

  if (!hasLabelToken) return false;

  const hasSource = srcClean.length > 0 && promptLower.includes(srcClean);
  const hasTarget =
    (tgtClean.length > 0 && promptLower.includes(tgtClean)) ||
    promptLower.includes('friends') ||
    promptLower.includes('animals') ||
    promptLower.includes('guests');

  return hasSource && hasTarget;
}

export function updateStoryBibleField(
  snapshot: ProjectSnapshot,
  field: keyof StoryBibleFields,
  value: string,
  provenance: DecisionProvenance = 'user-edit'
): ProjectSnapshot {
  const next = structuredClone(snapshot);
  const changed = mutateUpdateStoryBibleFieldInPlace(next, field, value, provenance);
  if (!changed) return snapshot;
  next.decisions = buildDecisionInboxFromSnapshot(next);
  next.refinedPrompt = synthesizeRefinedPrompt(next);
  return next;
}
