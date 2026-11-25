/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import {
  getEffectiveAttributeValue,
  inferEntityCategory,
} from '../../lib/beliefGraphUtils';
import type {
  RelationshipProjection,
  RelationshipProjectionEdge,
  RelationshipProjectionNode,
} from '../../lib/narrative/projections/relationshipProjection';
import type {
  ConsistencyIssue,
  Entity,
  EntityCategory,
  Relationship,
} from '../../shared/types';

export interface GraphFilterOptions {
  showExcluded: boolean;
  showInferred: boolean;
  categoryFilter: 'all' | EntityCategory;
  collapseGuestGroup: boolean;
  searchQuery: string;
}

export interface TableRelationshipRow {
  edge: RelationshipProjectionEdge;
  source: RelationshipProjectionNode;
  target: RelationshipProjectionNode;
  relationship: Relationship;
}

export function filterVisibleGraphEntities(
  rawObjectEntities: Entity[],
  allRelationships: Relationship[] | undefined,
  options: GraphFilterOptions
): Entity[] {
  let list: Entity[] = rawObjectEntities.map((e) => ({
    ...e,
    category: inferEntityCategory(e),
  }));

  if (!options.showExcluded) {
    list = list.filter((e) => !e.excluded);
  }
  if (!options.showInferred) {
    list = list.filter((e) => e.presence_in_prompt || e.status === 'confirmed');
  }
  if (options.categoryFilter !== 'all') {
    list = list.filter((e) => e.category === options.categoryFilter);
  }

  // Generic group collapse when toggled: collapses explicit groupId clusters first,
  // or falls back to collapsing secondary character/category clusters of >= 2 members.
  if (options.collapseGuestGroup) {
    const explicitGroupMembers = list.filter((e) => Boolean(e.groupId));
    if (explicitGroupMembers.length > 1) {
      const nonGrouped = list.filter((e) => !e.groupId);
      const syntheticGroup: Entity = {
        id: 'ent_group_guests_synthetic',
        name: `Grouped Entities (${explicitGroupMembers.length})`,
        category: 'group',
        presence_in_prompt: true,
        description: `Grouped view of: ${explicitGroupMembers.map((m) => m.name).join(', ')}`,
        alternatives: null,
        status: 'confirmed',
        attributes: [],
        aliases: explicitGroupMembers.map((m) => m.name),
      };
      list = [...nonGrouped, syntheticGroup];
    } else {
      const chars = list.filter((e) => e.category === 'character');
      if (chars.length > 2) {
        const primaryChar = chars[0];
        const secondaryChars = chars.slice(1);
        const others = list.filter((e) => e.category !== 'character');
        const syntheticGroup: Entity = {
          id: 'ent_group_guests_synthetic',
          name: `Character Group (${secondaryChars.length})`,
          category: 'group',
          presence_in_prompt: true,
          description: `Grouped view of: ${secondaryChars.map((m) => m.name).join(', ')}`,
          alternatives: null,
          status: 'confirmed',
          attributes: [],
          aliases: secondaryChars.map((m) => m.name),
        };
        list = [primaryChar, ...others, syntheticGroup];
      }
    }
  }

  if (options.searchQuery.trim()) {
    const q = options.searchQuery.toLowerCase();
    list = list.filter((e) => {
      const attrText = e.attributes
        .map((a) => `${a.name} ${getEffectiveAttributeValue(a)}`)
        .join(' ');
      const relMatch = (allRelationships ?? []).some(
        (r) =>
          (r.source.toLowerCase() === e.name.toLowerCase() ||
            r.target.toLowerCase() === e.name.toLowerCase()) &&
          r.label.toLowerCase().includes(q)
      );
      return (
        e.name.toLowerCase().includes(q) ||
        e.description.toLowerCase().includes(q) ||
        attrText.toLowerCase().includes(q) ||
        relMatch
      );
    });
  }

  return list;
}

export function buildTableRelationshipRows(
  relationshipProjection: RelationshipProjection,
  allRelationships: Relationship[] | undefined,
  selectedEntityId: string | undefined,
  selectedEntityRelationshipsOnly: boolean
): TableRelationshipRow[] {
  const projectedNodesById = new Map(
    relationshipProjection.nodes.map((node) => [node.id, node])
  );
  return relationshipProjection.edges.flatMap((edge) => {
    if (
      selectedEntityRelationshipsOnly &&
      selectedEntityId &&
      edge.sourceId !== selectedEntityId &&
      edge.targetId !== selectedEntityId
    ) {
      return [];
    }
    const source = projectedNodesById.get(edge.sourceId);
    const target = projectedNodesById.get(edge.targetId);
    const relationship = allRelationships?.find((item) => item.id === edge.id);
    return source && target && relationship
      ? [{ edge, source, target, relationship }]
      : [];
  });
}

export function countIssuesByEntityId(
  consistencyIssues: ConsistencyIssue[]
): Map<string, number> {
  const counts = new Map<string, number>();
  for (const issue of consistencyIssues) {
    if (issue.category === 'unresolved_decision') continue;
    for (const id of issue.affectedEntityIds) {
      counts.set(id, (counts.get(id) ?? 0) + 1);
    }
  }
  return counts;
}
