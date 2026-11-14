/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import type { Attribute, Entity, Relationship } from '../shared/types';

const SCENE_ENTITY_NAMES = new Set([
  'image',
  'the image',
  'story',
  'the story',
  'video',
  'the video',
]);

export function isSceneEntityName(name: string): boolean {
  return SCENE_ENTITY_NAMES.has(name.trim().toLowerCase());
}

export function splitSceneAndObjectEntities(entities: Entity[]): {
  sceneEntity: Entity | undefined;
  objectEntities: Entity[];
} {
  const sceneEntity = entities.find((e) => isSceneEntityName(e.name));
  const objectEntities = entities.filter((e) => !isSceneEntityName(e.name));
  return { sceneEntity, objectEntities };
}

export function getHighestProbabilityValue(attribute: Attribute): string {
  if (!attribute.value || attribute.value.length === 0) return 'Unknown';
  return attribute.value[0].name;
}

export function getCanonicalEntityName(
  name: string,
  objectEntities: Entity[]
): string | null {
  if (!name) return null;
  const lowerName = name.toLowerCase();
  const cleanName = lowerName.replace(/^(the|a|an)\s+/, '').trim();

  let match = objectEntities.find((e) => e.name.toLowerCase() === lowerName);
  if (!match) {
    match = objectEntities.find(
      (e) =>
        e.name
          .toLowerCase()
          .replace(/^(the|a|an)\s+/, '')
          .trim() === cleanName
    );
  }
  if (!match && cleanName.length > 2) {
    match = objectEntities.find((e) => {
      const cleanEntity = e.name
        .toLowerCase()
        .replace(/^(the|a|an)\s+/, '')
        .trim();
      return cleanEntity.includes(cleanName);
    });
    if (!match) {
      match = objectEntities.find((e) => {
        const cleanEntity = e.name
          .toLowerCase()
          .replace(/^(the|a|an)\s+/, '')
          .trim();
        return cleanName.includes(cleanEntity) && cleanEntity.length > 2;
      });
    }
  }

  return match ? match.name : null;
}

export function normalizeAndDeduplicateRelationships(
  rawRelationships: Relationship[] | undefined,
  objectEntities: Entity[]
): Relationship[] {
  if (!rawRelationships || rawRelationships.length === 0) return [];

  const validRels = rawRelationships.filter(
    (r) => !isSceneEntityName(r.source) && !isSceneEntityName(r.target)
  );

  const uniqueRels: Relationship[] = [];
  const pairSet = new Set<string>();

  for (const rel of validRels) {
    const canonicalSource = getCanonicalEntityName(rel.source, objectEntities);
    const canonicalTarget = getCanonicalEntityName(rel.target, objectEntities);
    if (!canonicalSource || !canonicalTarget || canonicalSource === canonicalTarget) {
      continue;
    }

    const sortedPair = [canonicalSource, canonicalTarget].sort();
    const pairKey = JSON.stringify(sortedPair);
    if (!pairSet.has(pairKey)) {
      pairSet.add(pairKey);
      uniqueRels.push({
        ...rel,
        source: canonicalSource,
        target: canonicalTarget,
      });
    }
  }

  return uniqueRels;
}

export function truncateLabel(str: string, maxLength: number): string {
  if (str.length <= maxLength) return str;
  return `${str.substring(0, maxLength)}...`;
}
