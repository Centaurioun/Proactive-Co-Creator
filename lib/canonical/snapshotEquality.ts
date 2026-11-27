/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import type {
  Attribute,
  Clarification,
  DecisionItem,
  Entity,
  ProjectSnapshot,
  Relationship,
  StoryBibleField,
} from '../../shared/types.ts';

function areStringArraysEqual(a?: readonly string[], b?: readonly string[]): boolean {
  const listA = a ?? [];
  const listB = b ?? [];
  if (listA.length !== listB.length) return false;
  for (let i = 0; i < listA.length; i++) {
    if (listA[i] !== listB[i]) return false;
  }
  return true;
}

function areNamedListsEqual(
  a: ReadonlyArray<{ name: string }> | null | undefined,
  b: ReadonlyArray<{ name: string }> | null | undefined,
  nullDistinct: boolean
): boolean {
  const isArrA = Array.isArray(a);
  const isArrB = Array.isArray(b);
  if (nullDistinct && isArrA !== isArrB) return false;
  const listA = isArrA ? a : [];
  const listB = isArrB ? b : [];
  if (listA.length !== listB.length) return false;
  for (let i = 0; i < listA.length; i++) {
    if (listA[i].name !== listB[i].name) return false;
  }
  return true;
}

function areArraysEqualBy<T>(
  a: readonly T[],
  b: readonly T[],
  eq: (itemA: T, itemB: T) => boolean
): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (!eq(a[i], b[i])) return false;
  }
  return true;
}

function areAttributesEqual(a: Attribute, b: Attribute): boolean {
  if (a.id !== b.id || a.name !== b.name) return false;
  if (Boolean(a.presence_in_prompt) !== Boolean(b.presence_in_prompt)) return false;
  if (a.confirmedValue !== b.confirmedValue || a.status !== b.status) return false;
  if (a.provenance !== b.provenance || a.epistemicKind !== b.epistemicKind) return false;
  if (Boolean(a.sourceBacked) !== Boolean(b.sourceBacked)) return false;
  return areNamedListsEqual(a.value, b.value, false);
}

function areEntitiesEqual(a: Entity, b: Entity): boolean {
  if (a.id !== b.id || a.name !== b.name || a.category !== b.category) return false;
  if (Boolean(a.presence_in_prompt) !== Boolean(b.presence_in_prompt)) return false;
  if (a.description !== b.description || Boolean(a.excluded) !== Boolean(b.excluded)) return false;
  if (a.status !== b.status || a.provenance !== b.provenance) return false;
  if (a.epistemicKind !== b.epistemicKind || Boolean(a.sourceBacked) !== Boolean(b.sourceBacked)) return false;
  if (a.groupId !== b.groupId) return false;
  if (!areNamedListsEqual(a.alternatives, b.alternatives, true)) return false;
  if (!areStringArraysEqual(a.aliases, b.aliases)) return false;
  return areArraysEqualBy(a.attributes, b.attributes, areAttributesEqual);
}

function areRelationshipsEqual(a: Relationship, b: Relationship): boolean {
  if (a.id !== b.id || a.sourceId !== b.sourceId || a.targetId !== b.targetId) return false;
  if (a.source !== b.source || a.target !== b.target || a.label !== b.label) return false;
  if (a.status !== b.status || a.provenance !== b.provenance) return false;
  if (a.epistemicKind !== b.epistemicKind || Boolean(a.sourceBacked) !== Boolean(b.sourceBacked)) return false;
  if (Boolean(a.presence_in_prompt) !== Boolean(b.presence_in_prompt)) return false;
  if (a.evidenceExcerpt !== b.evidenceExcerpt) return false;
  return areNamedListsEqual(a.alternatives, b.alternatives, false);
}

function areStoryBibleFieldEqual(a: StoryBibleField<string>, b: StoryBibleField<string>): boolean {
  if (a.value !== b.value || a.status !== b.status || a.provenance !== b.provenance) return false;
  if (a.epistemicKind !== b.epistemicKind) return false;
  return Boolean(a.sourceBacked) === Boolean(b.sourceBacked);
}

function areStoryBiblesEqual(
  a: Record<string, StoryBibleField<string>>,
  b: Record<string, StoryBibleField<string>>
): boolean {
  const keysA = Object.keys(a);
  const keysB = Object.keys(b);
  if (keysA.length !== keysB.length) return false;
  for (const key of keysA) {
    if (!Object.prototype.hasOwnProperty.call(b, key)) return false;
    if (!areStoryBibleFieldEqual(a[key], b[key])) return false;
  }
  return true;
}

function areClarificationsEqual(a: Clarification, b: Clarification): boolean {
  if (a.id !== b.id || a.question !== b.question) return false;
  if (a.category !== b.category || a.impact !== b.impact) return false;
  if (a.status !== b.status || a.outdatedReason !== b.outdatedReason) return false;
  if (!areStringArraysEqual(a.options, b.options)) return false;
  if (Boolean(a.target) !== Boolean(b.target)) return false;
  if (!a.target || !b.target) return true;
  if (a.target.type !== b.target.type || a.target.entityId !== b.target.entityId) return false;
  if (a.target.entityName !== b.target.entityName || a.target.attributeName !== b.target.attributeName) return false;
  return a.target.relationshipId === b.target.relationshipId && a.target.storyField === b.target.storyField;
}

function areDecisionsEqual(a: DecisionItem, b: DecisionItem): boolean {
  if (a.id !== b.id || a.category !== b.category || a.title !== b.title) return false;
  if (a.description !== b.description || a.explanation !== b.explanation) return false;
  if (a.provenance !== b.provenance || a.status !== b.status || a.groupKey !== b.groupKey) return false;
  if (a.targetEntityId !== b.targetEntityId || a.targetEntityName !== b.targetEntityName) return false;
  if (a.targetAttributeName !== b.targetAttributeName || a.targetRelationshipId !== b.targetRelationshipId) return false;
  if (a.targetSourceEntityName !== b.targetSourceEntityName || a.targetTargetEntityName !== b.targetTargetEntityName) return false;
  if (a.targetStoryField !== b.targetStoryField || a.questionId !== b.questionId) return false;
  if (a.currentValue !== b.currentValue || a.proposedValue !== b.proposedValue) return false;
  if (a.conflictWith !== b.conflictWith) return false;
  return areStringArraysEqual(a.options, b.options);
}

export function areSnapshotsSemanticallyEqual(a: ProjectSnapshot, b: ProjectSnapshot): boolean {
  if (a === b) return true;
  if (a.manuscriptVersionId !== b.manuscriptVersionId || a.originalIdea !== b.originalIdea) return false;
  if (a.refinedPrompt !== b.refinedPrompt || a.freeformNotes !== b.freeformNotes || a.mode !== b.mode) return false;
  if (!areArraysEqualBy(a.entities, b.entities, areEntitiesEqual)) return false;
  if (!areArraysEqualBy(a.relationships, b.relationships, areRelationshipsEqual)) return false;
  if (
    !areStoryBiblesEqual(
      a.storyBible as unknown as Record<string, StoryBibleField<string>>,
      b.storyBible as unknown as Record<string, StoryBibleField<string>>
    )
  ) {
    return false;
  }
  if (!areArraysEqualBy(a.clarifications, b.clarifications, areClarificationsEqual)) return false;
  if (!areArraysEqualBy(a.decisions, b.decisions, areDecisionsEqual)) return false;
  if (!areStringArraysEqual(a.answeredQuestions, b.answeredQuestions)) return false;
  return areStringArraysEqual(a.skippedQuestions, b.skippedQuestions);
}
