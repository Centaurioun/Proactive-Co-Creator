/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { getEntityGraphKey } from '../../lib/graphLayout';
import type { Entity, Relationship } from '../../shared/types';

export function buildGraphTopologySignature(
  visibleEntities: Entity[],
  relationships: Relationship[]
): string {
  const nodeKeys = visibleEntities
    .map((e) => `${getEntityGraphKey(e)}:${e.name}`)
    .sort()
    .join('|');
  const edgeKeys = relationships
    .map((r) => `${r.sourceId ?? r.source}->${r.targetId ?? r.target}::${r.label}`)
    .sort()
    .join('|');
  return `${nodeKeys}::${edgeKeys}`;
}

export function isRelationshipSelected(
  selectedRelationship: Relationship | null,
  rel: Relationship
): boolean {
  if (!selectedRelationship) return false;
  if (selectedRelationship.id && rel.id) {
    return selectedRelationship.id === rel.id;
  }
  return (
    selectedRelationship.source === rel.source &&
    selectedRelationship.target === rel.target &&
    selectedRelationship.label === rel.label
  );
}

export function removeTrackedPointer(
  activePointers: Map<number, { x: number; y: number }>,
  pointerId: number
): {
  remainingCount: number;
  nextDragStart: { x: number; y: number } | null;
  shouldResetPinch: boolean;
} {
  activePointers.delete(pointerId);
  const remainingCount = activePointers.size;
  const shouldResetPinch = remainingCount < 2;
  if (remainingCount === 1) {
    const remaining = activePointers.values().next().value;
    return {
      remainingCount,
      nextDragStart: remaining ? { x: remaining.x, y: remaining.y } : null,
      shouldResetPinch,
    };
  }
  return {
    remainingCount,
    nextDragStart: null,
    shouldResetPinch,
  };
}

export function buildEntityKeyByNameMap(entities: Entity[]): Map<string, string> {
  const map = new Map<string, string>();
  for (const entity of entities) {
    if (!map.has(entity.name)) {
      map.set(entity.name, getEntityGraphKey(entity));
    }
  }
  return map;
}

export function resolveRelationshipEndpointKeys(
  rel: Relationship,
  entityKeyByName: Map<string, string>
): { sourceKey: string; targetKey: string } {
  return {
    sourceKey: rel.sourceId ?? entityKeyByName.get(rel.source) ?? rel.source,
    targetKey: rel.targetId ?? entityKeyByName.get(rel.target) ?? rel.target,
  };
}

export function computeNeighborKeys(
  focusKey: string | null,
  relationships: Relationship[],
  entityKeyByName: Map<string, string>
): Set<string> | null {
  if (!focusKey) return null;
  const neighbors = new Set<string>();
  for (const rel of relationships) {
    const { sourceKey, targetKey } = resolveRelationshipEndpointKeys(rel, entityKeyByName);
    if (sourceKey === focusKey) neighbors.add(targetKey);
    if (targetKey === focusKey) neighbors.add(sourceKey);
  }
  return neighbors;
}
