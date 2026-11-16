/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import type { GraphUpdate, Relationship } from '../shared/types';

/**
 * Collision-safe composite key encoding (handles ':' or any characters in entity/attribute names).
 */
export function encodePairKey(first: string, second: string): string {
  return JSON.stringify([first, second]);
}

export function decodePairKey(key: string): [string, string] | null {
  try {
    const parsed: unknown = JSON.parse(key);
    if (
      Array.isArray(parsed) &&
      parsed.length === 2 &&
      typeof parsed[0] === 'string' &&
      typeof parsed[1] === 'string'
    ) {
      return [parsed[0], parsed[1]];
    }
  } catch {
    // Fall through
  }
  return null;
}

export function buildGraphUpdates(
  pendingAttributeUpdates: Record<string, string>,
  pendingRelationshipUpdates: Record<string, string>,
  relationships: Relationship[]
): GraphUpdate[] {
  const updates: GraphUpdate[] = [];

  for (const [key, value] of Object.entries(pendingAttributeUpdates)) {
    const pair = decodePairKey(key);
    if (!pair) continue;
    const [entity, attribute] = pair;
    updates.push({ type: 'attribute', entity, attribute, value });
  }

  for (const [key, newLabel] of Object.entries(pendingRelationshipUpdates)) {
    const pair = decodePairKey(key);
    if (!pair) continue;
    const [source, target] = pair;
    const originalRel = relationships.find(
      (r) => r.source === source && r.target === target
    );
    if (originalRel) {
      updates.push({
        type: 'relationship',
        source,
        target,
        oldLabel: originalRel.label,
        newLabel,
      });
    }
  }

  return updates;
}
