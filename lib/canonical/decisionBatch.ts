/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { isSceneEntityName } from '../beliefGraphUtils.ts';
import { buildDecisionInboxFromSnapshot } from '../decisionInboxProjection.ts';
import { synthesizeRefinedPrompt } from '../promptBuilder.ts';
import type { DecisionItem, ProjectSnapshot } from '../../shared/types.ts';
import {
  mutateEntityAttributeInPlace,
  mutateUpdateRelationshipByIdInPlace,
  mutateUpdateStoryBibleFieldInPlace,
} from './mutators.ts';
import { syncStoryBibleWithSceneEntityInPlace } from './storyBibleSync.ts';

function getDecisionConflictKey(dec: DecisionItem): string {
  if (dec.targetStoryField) return `sb:${dec.targetStoryField}`;
  if (dec.targetRelationshipId) return `rel:${dec.targetRelationshipId}`;
  if (dec.targetEntityName && dec.targetAttributeName) {
    return `ent:${dec.targetEntityName.toLowerCase()}:${dec.targetAttributeName.toLowerCase()}`;
  }
  return `q:${dec.id}`;
}

function validateDecisionBatchConflicts(
  targetDecisions: DecisionItem[],
  customValues: Record<string, string>
): string[] {
  const conflicts: string[] = [];
  const seenTargets = new Map<string, string>();
  for (const dec of targetDecisions) {
    const valueToApply = (customValues[dec.id] ?? dec.proposedValue).trim();
    if (!valueToApply) continue;
    const targetKey = getDecisionConflictKey(dec);
    const prior = seenTargets.get(targetKey);
    if (prior && prior.toLowerCase() !== valueToApply.toLowerCase()) {
      conflicts.push(
        `Conflicting batch selections for ${dec.title}: "${prior}" vs "${valueToApply}".`
      );
    }
    seenTargets.set(targetKey, valueToApply);
  }
  return conflicts;
}

function applyUntargetedClarificationAnswerInPlace(
  next: ProjectSnapshot,
  question: string,
  answer: string
): void {
  const qLower = question.toLowerCase();

  for (const ent of next.entities) {
    if (isSceneEntityName(ent.name)) continue;
    if (qLower.includes(ent.name.toLowerCase())) {
      const attrName =
        qLower.includes('personality') || qLower.includes('like') || qLower.includes('behave')
          ? 'personality'
          : qLower.includes('age') || qLower.includes('old') || qLower.includes('young')
            ? 'age'
            : qLower.includes('role') || qLower.includes('motivation') || qLower.includes('goal')
              ? 'motivation'
              : 'detail';
      mutateEntityAttributeInPlace(next, ent.id ?? ent.name, attrName, answer, 'accepted-suggestion');
      return;
    }
  }

  if (qLower.includes('tone') || qLower.includes('mood') || qLower.includes('atmosphere')) {
    mutateUpdateStoryBibleFieldInPlace(next, 'tone', answer, 'accepted-suggestion');
    return;
  }
  if (qLower.includes('where') || qLower.includes('setting') || qLower.includes('location')) {
    mutateUpdateStoryBibleFieldInPlace(next, 'setting', answer, 'accepted-suggestion');
    return;
  }
  if (qLower.includes('conflict') || qLower.includes('problem') || qLower.includes('tension')) {
    mutateUpdateStoryBibleFieldInPlace(next, 'centralConflict', answer, 'accepted-suggestion');
    return;
  }
  if (qLower.includes('genre')) {
    mutateUpdateStoryBibleFieldInPlace(next, 'genre', answer, 'accepted-suggestion');
    return;
  }

  const noteLine = `${question} -> ${answer}`;
  if (!next.storyBible.continuityRules.value.includes(noteLine)) {
    const prev = next.storyBible.continuityRules.value;
    next.storyBible.continuityRules = {
      value: prev ? `${prev}\n${noteLine}` : noteLine,
      status: 'confirmed',
      provenance: 'accepted-suggestion',
      updatedAt: Date.now(),
    };
  }
}

function rejectDecisionInPlace(next: ProjectSnapshot, dec: DecisionItem): void {
  dec.status = 'rejected';
  if (dec.category === 'clarification' && dec.questionId) {
    const clar = next.clarifications.find(
      (c) => c.id === dec.questionId || c.question === dec.title
    );
    if (clar) {
      clar.status = 'skipped';
      if (!next.skippedQuestions.includes(clar.question)) {
        next.skippedQuestions.push(clar.question);
      }
    }
  } else if (dec.category === 'relationship' && dec.targetRelationshipId) {
    const rel = next.relationships.find((r) => r.id === dec.targetRelationshipId);
    if (rel) rel.status = 'rejected';
  } else if (dec.targetEntityName && dec.targetAttributeName) {
    const ent = next.entities.find(
      (e) =>
        e.id === dec.targetEntityId ||
        e.name.toLowerCase() === dec.targetEntityName?.toLowerCase()
    );
    const attr = ent?.attributes.find(
      (a) => a.name.toLowerCase() === dec.targetAttributeName?.toLowerCase()
    );
    if (attr) attr.status = 'rejected';
  }
}

function acceptDecisionInPlace(
  next: ProjectSnapshot,
  dec: DecisionItem,
  valueToApply: string
): void {
  dec.status = 'accepted';
  dec.proposedValue = valueToApply;

  if (dec.category === 'relationship' && dec.targetRelationshipId) {
    mutateUpdateRelationshipByIdInPlace(
      next,
      dec.targetRelationshipId,
      { label: valueToApply, status: 'confirmed' },
      'accepted-suggestion'
    );
  } else if (dec.targetStoryField) {
    mutateUpdateStoryBibleFieldInPlace(
      next,
      dec.targetStoryField,
      valueToApply,
      'accepted-suggestion'
    );
  } else if (dec.targetEntityId || dec.targetEntityName) {
    const entRef = dec.targetEntityId ?? dec.targetEntityName!;
    const attrName = dec.targetAttributeName ?? 'detail';
    mutateEntityAttributeInPlace(next, entRef, attrName, valueToApply, 'accepted-suggestion');
  }

  if (dec.category === 'clarification') {
    const clar = next.clarifications.find(
      (c) => c.id === dec.questionId || c.question === dec.title
    );
    if (clar) {
      clar.status = 'answered';
      if (!next.answeredQuestions.includes(clar.question)) {
        next.answeredQuestions.push(clar.question);
      }
      if (!dec.targetStoryField && !dec.targetEntityId && !dec.targetEntityName) {
        applyUntargetedClarificationAnswerInPlace(next, clar.question, valueToApply);
      }
    }
  }
}

export function applyDecisionBatch(
  snapshot: ProjectSnapshot,
  decisionIds: string[],
  action: 'accept' | 'reject' | 'defer',
  customValues: Record<string, string> = {}
): { snapshot: ProjectSnapshot; appliedCount: number; conflicts: string[] } {
  const next = structuredClone(snapshot);
  const idSet = new Set(decisionIds);
  const targetDecisions = next.decisions.filter((d) => idSet.has(d.id));
  if (targetDecisions.length === 0) {
    return { snapshot: next, appliedCount: 0, conflicts: [] };
  }

  if (action === 'accept') {
    const conflicts = validateDecisionBatchConflicts(targetDecisions, customValues);
    if (conflicts.length > 0) {
      return { snapshot, appliedCount: 0, conflicts };
    }
  }

  let appliedCount = 0;
  for (const dec of targetDecisions) {
    const valueToApply = (customValues[dec.id] ?? dec.proposedValue).trim();

    if (action === 'reject') {
      rejectDecisionInPlace(next, dec);
      appliedCount++;
    } else if (action === 'defer') {
      dec.status = 'deferred';
      if (dec.category === 'clarification' && dec.questionId) {
        const clar = next.clarifications.find(
          (c) => c.id === dec.questionId || c.question === dec.title
        );
        if (clar) clar.status = 'deferred';
      }
      appliedCount++;
    } else if (action === 'accept' && valueToApply) {
      acceptDecisionInPlace(next, dec, valueToApply);
      appliedCount++;
    }
  }

  syncStoryBibleWithSceneEntityInPlace(next);
  const updatedStatusById = new Map(
    targetDecisions.map((d) => [d.id, { status: d.status, val: customValues[d.id] ?? d.proposedValue }])
  );
  next.decisions = buildDecisionInboxFromSnapshot(next).map((d) => {
    const u = updatedStatusById.get(d.id);
    return u ? { ...d, status: u.status, proposedValue: u.val } : d;
  });
  next.refinedPrompt = synthesizeRefinedPrompt(next);

  return { snapshot: next, appliedCount, conflicts: [] };
}
