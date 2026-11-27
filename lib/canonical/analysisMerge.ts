/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import {
  getCanonicalEntityName,
  inferEntityCategory,
  isSceneEntityName,
} from '../beliefGraphUtils.ts';
import { buildDecisionInboxFromSnapshot } from '../decisionInboxProjection.ts';
import { synthesizeRefinedPrompt } from '../promptBuilder.ts';
import type {
  Attribute,
  BeliefState,
  Clarification,
  Entity,
  ProjectSnapshot,
} from '../../shared/types.ts';
import { makeStableId, isUserClearedStoryField } from './ids.ts';
import { SCENE_ATTR_TO_BIBLE_FIELD, syncStoryBibleWithSceneEntityInPlace } from './storyBibleSync.ts';

function isRelationshipExplicitInPromptLocal(
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

function mergeEntityAttributes(
  matched: Entity,
  rawEnt: BeliefState['entities'][number],
  next: ProjectSnapshot,
  now: number
): void {
  const matchedIsScene = isSceneEntityName(matched.name) || matched.category === 'scene';
  for (const rawAttr of rawEnt.attributes) {
    const mappedField = matchedIsScene
      ? SCENE_ATTR_TO_BIBLE_FIELD[rawAttr.name.toLowerCase()]
      : undefined;
    const mappedFieldClearedByUser = Boolean(
      mappedField && isUserClearedStoryField(next.storyBible[mappedField])
    );

    const existingAttr = matched.attributes.find(
      (a) => a.name.toLowerCase() === rawAttr.name.toLowerCase()
    );
    if (existingAttr) {
      if (existingAttr.status === 'rejected' || mappedFieldClearedByUser) {
        continue;
      }
      if (existingAttr.status === 'confirmed') {
        const existingNames = new Set(existingAttr.value.map((v) => v.name));
        for (const cand of rawAttr.value) {
          if (!existingNames.has(cand.name)) {
            existingAttr.value.push(cand);
          }
        }
      } else {
        existingAttr.value = rawAttr.value;
        existingAttr.presence_in_prompt = rawAttr.presence_in_prompt;
      }
      continue;
    }

    if (mappedFieldClearedByUser) continue;

    matched.attributes.push({
      id: makeStableId('attr'),
      name: rawAttr.name,
      presence_in_prompt: rawAttr.presence_in_prompt,
      value: rawAttr.value,
      confirmedValue: rawAttr.presence_in_prompt ? rawAttr.value[0]?.name : undefined,
      status: rawAttr.presence_in_prompt ? 'confirmed' : 'pending',
      provenance: rawAttr.presence_in_prompt ? 'prompt-explicit' : 'ai-inferred',
      updatedAt: now,
    });
  }
}

function mergeIncomingEntities(
  next: ProjectSnapshot,
  incomingEntities: BeliefState['entities'],
  now: number
): void {
  const existingEntities = next.entities;
  for (const rawEnt of incomingEntities) {
    const canonicalName = getCanonicalEntityName(rawEnt.name, existingEntities);
    const matched = canonicalName
      ? existingEntities.find((e) => e.name === canonicalName)
      : existingEntities.find(
          (e) =>
            e.name.toLowerCase() === rawEnt.name.toLowerCase() ||
            e.aliases?.some((a) => a.toLowerCase() === rawEnt.name.toLowerCase())
        );

    if (matched) {
      if (matched.excluded || matched.status === 'rejected') {
        continue;
      }
      if (!matched.description && rawEnt.description) {
        matched.description = rawEnt.description;
      }
      if (!matched.category) {
        matched.category = inferEntityCategory(rawEnt);
      }
      mergeEntityAttributes(matched, rawEnt, next, now);
      continue;
    }

    const category = inferEntityCategory(rawEnt);
    const newEntity: Entity = {
      id: makeStableId('ent'),
      name: rawEnt.name,
      category,
      presence_in_prompt: rawEnt.presence_in_prompt,
      description: rawEnt.description,
      alternatives: rawEnt.alternatives,
      status: rawEnt.presence_in_prompt ? 'confirmed' : 'pending',
      provenance: rawEnt.presence_in_prompt ? 'prompt-explicit' : 'ai-inferred',
      excluded: false,
      attributes: rawEnt.attributes.map((a): Attribute => ({
        id: makeStableId('attr'),
        name: a.name,
        presence_in_prompt: a.presence_in_prompt,
        value: a.value,
        confirmedValue:
          a.name === 'existence'
            ? 'true'
            : a.presence_in_prompt
              ? a.value[0]?.name
              : undefined,
        status: a.presence_in_prompt ? 'confirmed' : 'pending',
        provenance: a.presence_in_prompt ? 'prompt-explicit' : 'ai-inferred',
        updatedAt: now,
      })),
    };
    existingEntities.push(newEntity);
  }
}

function mergeIncomingRelationships(
  next: ProjectSnapshot,
  incomingRelationships: BeliefState['relationships']
): void {
  const existingEntities = next.entities;
  for (const rawRel of incomingRelationships) {
    const srcName = getCanonicalEntityName(rawRel.source, existingEntities) ?? rawRel.source;
    const tgtName = getCanonicalEntityName(rawRel.target, existingEntities) ?? rawRel.target;
    const srcEnt = existingEntities.find((e) => e.name === srcName);
    const tgtEnt = existingEntities.find((e) => e.name === tgtName);
    if (!srcEnt || !tgtEnt || srcEnt.id === tgtEnt.id) continue;
    if (srcEnt.excluded || tgtEnt.excluded) continue;
    if (srcEnt.status === 'rejected' || tgtEnt.status === 'rejected') continue;

    const cleanLabel = rawRel.label.trim();
    const sameDirRels = next.relationships.filter(
      (r) =>
        (r.sourceId === srcEnt.id && r.targetId === tgtEnt.id) ||
        (r.source.toLowerCase() === srcEnt.name.toLowerCase() &&
          r.target.toLowerCase() === tgtEnt.name.toLowerCase())
    );

    const exactMatch = sameDirRels.find(
      (r) => r.label.trim().toLowerCase() === cleanLabel.toLowerCase()
    );
    if (exactMatch) {
      if (exactMatch.status !== 'rejected' && exactMatch.status !== 'confirmed') {
        exactMatch.alternatives = rawRel.alternatives;
      }
      continue;
    }

    const pendingSameDir = sameDirRels.find((r) => r.status === 'pending');
    if (pendingSameDir) {
      pendingSameDir.label = cleanLabel;
      pendingSameDir.alternatives = rawRel.alternatives;
      continue;
    }

    if (sameDirRels.some((r) => r.status === 'confirmed' || r.status === 'rejected')) {
      continue;
    }

    const isExplicit = isRelationshipExplicitInPromptLocal(
      srcEnt.name,
      cleanLabel,
      tgtEnt.name,
      next.originalIdea,
      rawRel.presence_in_prompt
    );

    next.relationships.push({
      id: makeStableId('rel'),
      sourceId: srcEnt.id,
      targetId: tgtEnt.id,
      source: srcEnt.name,
      target: tgtEnt.name,
      label: cleanLabel,
      presence_in_prompt: isExplicit,
      evidenceExcerpt: rawRel.evidenceExcerpt,
      alternatives: rawRel.alternatives,
      status: isExplicit ? 'confirmed' : 'pending',
      provenance: isExplicit ? 'prompt-explicit' : 'ai-inferred',
    });
  }
}

function normalizeClarificationQuestion(q: string): string {
  return q.toLowerCase().replace(/[^a-z0-9\s]/g, '').replace(/\s+/g, ' ').trim();
}

function getSemanticClarificationTargetKey(
  clar: Clarification,
  entities: Entity[]
): string | null {
  if (!clar.target) return null;
  if (clar.target.type === 'story_bible' && clar.target.storyField) {
    return `sb:${clar.target.storyField}`;
  }
  if (clar.target.type === 'entity_attribute' && clar.target.attributeName) {
    const canonicalEntName = clar.target.entityName
      ? getCanonicalEntityName(clar.target.entityName, entities) ?? clar.target.entityName
      : '';
    const ent = entities.find(
      (e) =>
        (clar.target?.entityId && e.id === clar.target.entityId) ||
        e.name.toLowerCase() === canonicalEntName.toLowerCase()
    );
    const entKey = ent?.id ?? canonicalEntName.toLowerCase();
    if (entKey) {
      return `ent:${entKey}:${clar.target.attributeName.toLowerCase()}`;
    }
  }
  return null;
}

function resolveIncomingClarification(
  rawClar: Clarification,
  next: ProjectSnapshot
): Clarification | null {
  if (rawClar.target?.type === 'entity_attribute' && rawClar.target.entityName && rawClar.target.attributeName) {
    const canonicalEntName =
      getCanonicalEntityName(rawClar.target.entityName, next.entities) ?? rawClar.target.entityName;
    const targetEnt = next.entities.find(
      (e) => e.name.toLowerCase() === canonicalEntName.toLowerCase()
    );
    if (targetEnt?.excluded || targetEnt?.status === 'rejected') {
      return null;
    }
    const targetAttr = targetEnt?.attributes.find(
      (a) => a.name.toLowerCase() === rawClar.target?.attributeName?.toLowerCase()
    );
    if (
      (targetAttr?.status === 'confirmed' && targetAttr.confirmedValue) ||
      targetAttr?.status === 'rejected'
    ) {
      return null;
    }
    if (targetEnt) {
      return {
        ...rawClar,
        target: {
          ...rawClar.target,
          entityId: targetEnt.id,
          entityName: targetEnt.name,
        },
      };
    }
    return rawClar;
  }

  if (rawClar.target?.type === 'story_bible' && rawClar.target.storyField) {
    const sbField = next.storyBible[rawClar.target.storyField];
    if ((sbField?.status === 'confirmed' && sbField.value) || sbField?.status === 'rejected') {
      return null;
    }
  }

  return rawClar;
}

function mergeIncomingClarifications(
  next: ProjectSnapshot,
  incomingClarifications: Clarification[],
  pendingDraftAnswers: Record<string, string>
): void {
  const answeredSet = new Set(next.answeredQuestions.map(normalizeClarificationQuestion));
  const skippedSet = new Set(next.skippedQuestions.map(normalizeClarificationQuestion));
  const resolvedTargetKeys = new Set<string>();

  for (const oldClar of next.clarifications) {
    if (oldClar.status === 'answered' || oldClar.status === 'skipped') {
      answeredSet.add(normalizeClarificationQuestion(oldClar.question));
      const tKey = getSemanticClarificationTargetKey(oldClar, next.entities);
      if (tKey) resolvedTargetKeys.add(tKey);
    }
  }

  const preservedClarifications = next.clarifications.filter((c) => {
    if (c.status === 'answered' || c.status === 'skipped' || c.status === 'deferred') {
      return true;
    }
    const draft =
      pendingDraftAnswers[c.id ?? c.question] ??
      pendingDraftAnswers[`dec_clar_${c.id ?? c.question}`] ??
      pendingDraftAnswers[c.question];
    return Boolean(draft && draft.trim().length > 0);
  });

  const mergedClarifications: Clarification[] = [...preservedClarifications];
  const seenNorm = new Set(mergedClarifications.map((c) => normalizeClarificationQuestion(c.question)));
  const seenTargets = new Set(
    mergedClarifications
      .map((c) => getSemanticClarificationTargetKey(c, next.entities))
      .filter((k): k is string => Boolean(k))
  );

  for (const rawClar of incomingClarifications) {
    const normQ = normalizeClarificationQuestion(rawClar.question);
    if (seenNorm.has(normQ) || answeredSet.has(normQ) || skippedSet.has(normQ)) {
      continue;
    }

    const normalizedClar = resolveIncomingClarification(rawClar, next);
    if (!normalizedClar) continue;

    const targetKey = getSemanticClarificationTargetKey(normalizedClar, next.entities);
    if (targetKey && (resolvedTargetKeys.has(targetKey) || seenTargets.has(targetKey))) {
      continue;
    }

    const priorMatch = next.clarifications.find(
      (c) =>
        normalizeClarificationQuestion(c.question) === normQ ||
        (targetKey && getSemanticClarificationTargetKey(c, next.entities) === targetKey)
    );

    seenNorm.add(normQ);
    if (targetKey) seenTargets.add(targetKey);
    mergedClarifications.push({
      ...normalizedClar,
      id: priorMatch?.id ?? normalizedClar.id ?? makeStableId('clar'),
      status: priorMatch?.status === 'deferred' ? 'deferred' : 'unanswered',
    });
  }

  next.clarifications = mergedClarifications;
}

/**
 * Reconciles new AI analysis (BeliefGraph + Clarifications) with the existing canonical snapshot.
 * Strictly enforces User Authority:
 * - Never overwrites confirmed attribute values, confirmed entity renames, or explicit exclusions.
 * - Never resurrects rejected attributes or rejected relationships.
 * - Marks AI-inferred relationships not explicitly stated in originalIdea as status: 'pending'.
 * - Deduplicates clarifications by semantic target and preserves stable clarification IDs and draft answers.
 */
export function mergeAnalysisIntoSnapshot(
  current: ProjectSnapshot,
  incomingGraph: BeliefState | null,
  incomingClarifications: Clarification[] | null,
  pendingDraftAnswers: Record<string, string> = {}
): ProjectSnapshot {
  const next = structuredClone(current);
  const now = Date.now();

  if (incomingGraph) {
    mergeIncomingEntities(next, incomingGraph.entities, now);
    mergeIncomingRelationships(next, incomingGraph.relationships);
  }

  if (incomingClarifications) {
    mergeIncomingClarifications(next, incomingClarifications, pendingDraftAnswers);
  }

  syncStoryBibleWithSceneEntityInPlace(next, now);
  next.decisions = buildDecisionInboxFromSnapshot(next).map((dec) => {
    const draft =
      pendingDraftAnswers[dec.id] ??
      (dec.questionId ? pendingDraftAnswers[dec.questionId] : undefined);
    if (draft && draft.trim().length > 0 && dec.status === 'pending') {
      return {
        ...dec,
        proposedValue: draft.trim(),
      };
    }
    return dec;
  });
  next.refinedPrompt = synthesizeRefinedPrompt(next);
  return next;
}
