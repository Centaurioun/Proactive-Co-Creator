/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import type { Attribute, Entity, EntityCategory, Relationship } from '../shared/types';

const SCENE_ENTITY_NAMES = new Set(['image', 'the image', 'story', 'the story', 'scene', 'the scene']);

export function isSceneEntityName(name: string): boolean {
  return SCENE_ENTITY_NAMES.has(name.trim().toLowerCase());
}

export function inferEntityCategory(entity: Entity): EntityCategory {
  if (entity.category) return entity.category;
  if (isSceneEntityName(entity.name)) return 'scene';

  const text = `${entity.name} ${entity.description} ${entity.attributes.map((a) => a.name).join(' ')}`.toLowerCase();

  if (
    /\b(friends|guests|crowd|group|audience|family|team|pack|animals|visitors)\b/.test(
      entity.name.toLowerCase()
    )
  ) {
    return 'group';
  }
  if (
    /\b(room|garden|cabin|house|forest|city|hall|kitchen|park|mountain|setting|location|venue|restaurant|table area)\b/.test(
      text
    ) &&
    !/\b(personality|motivation|age|gender|species)\b/.test(text)
  ) {
    return 'location';
  }
  if (/\b(party|celebration|dinner|feast|festival|gathering|banquet|conflict|event)\b/.test(entity.name.toLowerCase())) {
    return 'event';
  }
  if (
    /\b(personality|motivation|emotional_state|age|role|expression|pose|species|breed)\b/.test(text) ||
    /\b(cat|dog|rabbit|fox|wolf|bear|owl|mouse|bird|man|woman|child|person|host|guest|friend)\b/.test(
      entity.name.toLowerCase()
    )
  ) {
    return 'character';
  }
  return 'object';
}

export function splitSceneAndObjectEntities(entities: Entity[]): {
  sceneEntity: Entity | undefined;
  objectEntities: Entity[];
} {
  const sceneEntity = entities.find((e) => isSceneEntityName(e.name) || e.category === 'scene');
  const objectEntities = entities.filter((e) => !isSceneEntityName(e.name) && e.category !== 'scene');
  return { sceneEntity, objectEntities };
}

export function getHighestProbabilityValue(attribute: Attribute): string {
  if (attribute.confirmedValue !== undefined) return attribute.confirmedValue;
  if (!attribute.value || attribute.value.length === 0) return 'Unknown';
  return attribute.value[0].name;
}

export function getEffectiveAttributeValue(
  attribute: Attribute,
  pendingValue?: string
): string {
  if (pendingValue !== undefined) return pendingValue;
  if (attribute.confirmedValue !== undefined) return attribute.confirmedValue;
  const isExistence =
    attribute.name === 'existence' || attribute.name === 'existence_in_image';
  if (isExistence) {
    const val = getHighestProbabilityValue(attribute);
    return val === 'Unknown' ? 'true' : val;
  }
  if (attribute.status === 'confirmed' || attribute.presence_in_prompt) {
    return getHighestProbabilityValue(attribute);
  }
  return getHighestProbabilityValue(attribute);
}

export function findCandidateEntities(
  name: string,
  objectEntities: Entity[]
): Entity[] {
  if (!name) return [];
  const lowerName = name.toLowerCase().trim();
  const cleanName = lowerName.replace(/^(the|a|an)\s+/, '').trim();

  // 1. Exact ID match is always unique
  const idMatch = objectEntities.filter((e) => e.id === name);
  if (idMatch.length > 0) return idMatch;

  // Helper to check if cleanName appears as a standalone word token in an entity name
  const escapedClean = cleanName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const wordTokenRegex =
    cleanName.length >= 3 ? new RegExp(`\\b${escapedClean}\\b`, 'i') : null;

  // 2. Exact name/alias match (with or without leading article)
  const exactMatches = objectEntities.filter(
    (e) =>
      e.name.toLowerCase().trim() === lowerName ||
      e.name.toLowerCase().replace(/^(the|a|an)\s+/, '').trim() === cleanName ||
      e.aliases?.some(
        (a) =>
          a.toLowerCase().trim() === lowerName ||
          a.toLowerCase().replace(/^(the|a|an)\s+/, '').trim() === cleanName
      )
  );

  if (exactMatches.length > 0) {
    // If cleanName is a single noun (e.g. "fox") and another entity also has "fox" as a word token (e.g. "Red Fox"), include it as an ambiguity candidate while keeping exactMatches[0] first
    if (!/\s/.test(cleanName) && wordTokenRegex) {
      const exactSet = new Set(exactMatches);
      const extraWordMatches = objectEntities.filter(
        (e) => !exactSet.has(e) && wordTokenRegex.test(e.name)
      );
      if (extraWordMatches.length > 0) {
        return [...exactMatches, ...extraWordMatches];
      }
    }
    return exactMatches;
  }

  // 3. Partial substring matches (may return multiple candidates when ambiguous)
  if (cleanName.length > 2) {
    const partialMatches = objectEntities.filter((e) => {
      const cleanEntity = e.name
        .toLowerCase()
        .replace(/^(the|a|an)\s+/, '')
        .trim();
      const aliasHit = e.aliases?.some((a) => {
        const cleanAlias = a.toLowerCase().replace(/^(the|a|an)\s+/, '').trim();
        return cleanAlias.includes(cleanName) || (cleanName.includes(cleanAlias) && cleanAlias.length > 2);
      });
      return (
        cleanEntity.includes(cleanName) ||
        (cleanName.includes(cleanEntity) && cleanEntity.length > 2) ||
        Boolean(aliasHit)
      );
    });
    return partialMatches;
  }

  return [];
}

export function getCanonicalEntityName(
  name: string,
  objectEntities: Entity[]
): string | null {
  const candidates = findCandidateEntities(name, objectEntities);
  return candidates.length > 0 ? candidates[0].name : null;
}

export function normalizeAndDeduplicateRelationships(
  rawRelationships: Relationship[] | undefined,
  objectEntities: Entity[]
): Relationship[] {
  if (!rawRelationships || rawRelationships.length === 0) return [];

  const validRels = rawRelationships.filter(
    (r) =>
      r.status !== 'rejected' &&
      !isSceneEntityName(r.source) &&
      !isSceneEntityName(r.target)
  );

  const uniqueRels: Relationship[] = [];
  const directedKeySet = new Set<string>();

  for (const rel of validRels) {
    let sourceEntity = rel.sourceId
      ? objectEntities.find((e) => e.id === rel.sourceId)
      : undefined;
    let targetEntity = rel.targetId
      ? objectEntities.find((e) => e.id === rel.targetId)
      : undefined;

    const canonicalSource =
      sourceEntity?.name ?? getCanonicalEntityName(rel.source, objectEntities);
    const canonicalTarget =
      targetEntity?.name ?? getCanonicalEntityName(rel.target, objectEntities);

    if (!canonicalSource || !canonicalTarget || canonicalSource === canonicalTarget) {
      continue;
    }

    if (!sourceEntity) {
      sourceEntity = objectEntities.find((e) => e.name === canonicalSource);
    }
    if (!targetEntity) {
      targetEntity = objectEntities.find((e) => e.name === canonicalTarget);
    }

    if (sourceEntity?.excluded || targetEntity?.excluded) {
      continue;
    }

    const cleanLabel = rel.label.trim();
    const directedKey = `${(sourceEntity?.id ?? canonicalSource).toLowerCase()}->${(targetEntity?.id ?? canonicalTarget).toLowerCase()}::${cleanLabel.toLowerCase()}`;
    if (!directedKeySet.has(directedKey)) {
      directedKeySet.add(directedKey);
      uniqueRels.push({
        ...rel,
        id: rel.id ?? `rel_${canonicalSource}_${canonicalTarget}_${cleanLabel.replace(/\s+/g, '_')}`,
        sourceId: sourceEntity?.id,
        targetId: targetEntity?.id,
        source: canonicalSource,
        target: canonicalTarget,
        label: cleanLabel,
      });
    }
  }

  return uniqueRels;
}

export function truncateLabel(str: string, maxLength: number): string {
  if (str.length <= maxLength) return str;
  return `${str.substring(0, maxLength)}...`;
}
