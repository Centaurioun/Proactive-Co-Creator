/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { getEffectiveAttributeValue, isSceneEntityName } from './beliefGraphUtils.ts';
import type {
  ConsistencyIssue,
  ConsistencyIssueTarget,
  Entity,
  ProjectSnapshot,
  Relationship,
  StoryBibleFields,
} from '../shared/types.ts';

export type ResolvedConsistencyTarget =
  | { ok: true; kind: 'entity'; entity: Entity }
  | { ok: true; kind: 'relationship'; relationship: Relationship }
  | { ok: true; kind: 'story_bible'; storyField: keyof StoryBibleFields }
  | { ok: false; reason: string };

/**
 * Resolves an issue navigation target strictly by stable ID or canonical Story Bible key.
 * Pure & read-only: never guesses another entity or mutates the snapshot.
 */
export function resolveConsistencyIssueTarget(
  snapshot: ProjectSnapshot,
  target: ConsistencyIssueTarget | null | undefined
): ResolvedConsistencyTarget {
  if (!target) {
    return { ok: false, reason: 'This target is no longer available.' };
  }

  if (target.kind === 'story_bible') {
    if (target.storyField && target.storyField in snapshot.storyBible) {
      return { ok: true, kind: 'story_bible', storyField: target.storyField };
    }
    return { ok: false, reason: 'Target Story Bible field is unavailable.' };
  }

  if (target.kind === 'entity') {
    if (!target.entityId) {
      return { ok: false, reason: 'Entity target lacks a stable entity identifier.' };
    }
    const found = snapshot.entities.find((e) => e.id === target.entityId);
    if (!found) {
      return {
        ok: false,
        reason: 'This entity is no longer available (it may have been deleted).',
      };
    }
    return { ok: true, kind: 'entity', entity: found };
  }

  if (target.kind === 'relationship') {
    if (!target.relationshipId) {
      return { ok: false, reason: 'Relationship target lacks a stable relationship identifier.' };
    }
    const found = snapshot.relationships.find((r) => r.id === target.relationshipId);
    if (!found) {
      return {
        ok: false,
        reason: 'This relationship is no longer available (it may have been removed).',
      };
    }
    return { ok: true, kind: 'relationship', relationship: found };
  }

  return { ok: false, reason: 'This target is no longer available.' };
}

/**
 * Lightweight deterministic consistency checker for the Story Bible and Belief Graph.
 * Detects:
 * 1. Conflicting character traits (e.g., attribute contradicts entity description or another attribute).
 * 2. Incompatible setting information (Story Bible setting vs Location entity).
 * 3. Contradictory relationships.
 * 4. Violated explicit exclusions (an excluded entity is still referenced in active story elements).
 * 5. Unresolved core story-level decisions.
 */
export function evaluateProjectConsistency(snapshot: ProjectSnapshot): ConsistencyIssue[] {
  const issues: ConsistencyIssue[] = [];
  const entityIds = new Set(snapshot.entities.flatMap((entity) => entity.id ? [entity.id] : []));

  // Structural check only: never infer an endpoint from a relationship's display name.
  // Pending, rejected, or legacy name-only relationships remain outside this assertion.
  for (const relationship of snapshot.relationships) {
    if (relationship.status !== 'confirmed' || !relationship.id) continue;
    const missingEndpoints = [
      relationship.sourceId && !entityIds.has(relationship.sourceId) ? `source ID "${relationship.sourceId}"` : undefined,
      relationship.targetId && !entityIds.has(relationship.targetId) ? `target ID "${relationship.targetId}"` : undefined,
    ].filter((endpoint): endpoint is string => Boolean(endpoint));
    if (missingEndpoints.length === 0) continue;

    const validEndpointIds = [relationship.sourceId, relationship.targetId]
      .filter((id): id is string => Boolean(id && entityIds.has(id)));
    issues.push({
      id: `issue_relationship_missing_endpoint_${relationship.id}`,
      severity: 'error',
      category: 'relationship_conflict',
      title: 'Confirmed relationship points to an unavailable entity',
      description: `The confirmed relationship "${relationship.label}" references unavailable ${missingEndpoints.join(' and ')}.`,
      affectedEntityIds: validEndpointIds,
      relationshipId: relationship.id,
      targets: [{
        id: `target_relationship_${relationship.id}`,
        kind: 'relationship',
        label: `Inspect ${relationship.source} → ${relationship.target}`,
        relationshipId: relationship.id,
      }],
      suggestedFix: 'Review the relationship endpoints and select existing entities before confirming it.',
    });
  }

  // 1. Check for violated explicit exclusions
  const manualExclusions = snapshot.storyBible.explicitExclusions.value
    .split(',')
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);

  for (const entity of snapshot.entities) {
    if (isSceneEntityName(entity.name)) continue;

    const exAttr = entity.attributes.find(
      (a) => a.name === 'existence' || a.name === 'existence_in_image'
    );
    const isMarkedPresent =
      !entity.excluded &&
      (!exAttr || getEffectiveAttributeValue(exAttr) === 'true');

    if (
      isMarkedPresent &&
      manualExclusions.includes(entity.name.toLowerCase())
    ) {
      const targets: ConsistencyIssueTarget[] = [];
      if (entity.id) {
        targets.push({
          id: `target_entity_${entity.id}`,
          kind: 'entity',
          label: `Inspect ${entity.name}`,
          entityId: entity.id,
        });
      }
      targets.push({
        id: 'target_bible_explicitExclusions',
        kind: 'story_bible',
        label: 'Edit Explicit Exclusions',
        storyField: 'explicitExclusions',
      });
      issues.push({
        id: `issue_excl_${entity.id ?? entity.name}`,
        severity: 'error',
        category: 'violated_exclusion',
        title: `Excluded entity "${entity.name}" is still marked Present`,
        description: `"${entity.name}" appears in Explicit Exclusions, but its graph node existence is still set to Present.`,
        affectedEntityIds: entity.id ? [entity.id] : [],
        targets,
        suggestedFix: `Set "${entity.name}" existence to Absent in the Inspector.`,
      });
    }

    if (entity.excluded) {
      const conflictMention = snapshot.storyBible.centralConflict.value
        .toLowerCase()
        .includes(entity.name.toLowerCase());
      if (conflictMention && snapshot.storyBible.centralConflict.status === 'confirmed') {
        const targets: ConsistencyIssueTarget[] = [
          {
            id: 'target_bible_centralConflict',
            kind: 'story_bible',
            label: 'Edit Central Conflict',
            storyField: 'centralConflict',
          },
        ];
        if (entity.id) {
          targets.push({
            id: `target_entity_${entity.id}`,
            kind: 'entity',
            label: `Inspect ${entity.name}`,
            entityId: entity.id,
          });
        }
        issues.push({
          id: `issue_excl_conflict_${entity.id ?? entity.name}`,
          severity: 'warning',
          category: 'violated_exclusion',
          title: `Excluded entity "${entity.name}" is referenced in Central Conflict`,
          description: `"${entity.name}" is excluded from the project, but the Story Bible Central Conflict still mentions "${entity.name}".`,
          affectedEntityIds: entity.id ? [entity.id] : [],
          targets,
          suggestedFix: `Update Central Conflict in the Story Bible to remove references to "${entity.name}".`,
        });
      }
    }
  }

  // 2. Check for conflicting character traits (e.g., age or personality contradictions)
  const antonymPairs: Array<[RegExp, RegExp, string]> = [
    [/\byoung\b/i, /\belderly|ancient|old\b/i, 'age (young vs. elderly)'],
    [/\bfriendly|warm|gracious\b/i, /\bhostile|cruel|violent\b/i, 'demeanor (friendly vs. hostile)'],
    [/\bcheerful|joyful\b/i, /\bgrim|miserable|bleak\b/i, 'mood (cheerful vs. grim)'],
  ];

  for (const entity of snapshot.entities) {
    if (entity.excluded || isSceneEntityName(entity.name)) continue;
    const confirmedSummary = entity.attributes
      .filter((a) => a.status === 'confirmed')
      .map((a) => `${a.name}: ${getEffectiveAttributeValue(a)}`)
      .join(' | ');
    const fullText = `${entity.description} | ${confirmedSummary}`;

    for (const [patA, patB, label] of antonymPairs) {
      if (patA.test(confirmedSummary) && patB.test(fullText)) {
        const targets: ConsistencyIssueTarget[] = entity.id
          ? [
              {
                id: `target_entity_${entity.id}`,
                kind: 'entity',
                label: `Inspect ${entity.name}`,
                entityId: entity.id,
              },
            ]
          : [];
        issues.push({
          id: `issue_trait_${entity.id ?? entity.name}_${label}`,
          severity: 'warning',
          category: 'trait_conflict',
          title: `Potential trait contradiction on "${entity.name}"`,
          description: `Confirmed attributes and description for "${entity.name}" contain contrasting signals for ${label}.`,
          affectedEntityIds: entity.id ? [entity.id] : [],
          targets,
          suggestedFix: `Inspect "${entity.name}" to align its description and confirmed attributes.`,
        });
      }
    }
  }

  // 3. Setting consistency check
  const confirmedBibleSetting =
    snapshot.storyBible.setting.status === 'confirmed'
      ? snapshot.storyBible.setting.value.trim()
      : '';
  const locationEntities = snapshot.entities.filter(
    (e) => !e.excluded && e.category === 'location' && e.status === 'confirmed'
  );
  if (confirmedBibleSetting && locationEntities.length > 0) {
    const matchesAnyLocation = locationEntities.some(
      (loc) =>
        confirmedBibleSetting.toLowerCase().includes(loc.name.toLowerCase()) ||
        loc.name.toLowerCase().includes(confirmedBibleSetting.toLowerCase())
    );
    if (!matchesAnyLocation) {
      const targets: ConsistencyIssueTarget[] = [
        {
          id: 'target_bible_setting',
          kind: 'story_bible',
          label: 'Edit Primary Setting',
          storyField: 'setting',
        },
        ...locationEntities
          .filter((loc): loc is Entity & { id: string } => Boolean(loc.id))
          .map((loc) => ({
            id: `target_entity_${loc.id}`,
            kind: 'entity' as const,
            label: `Inspect ${loc.name}`,
            entityId: loc.id,
          })),
      ];
      issues.push({
        id: 'issue_setting_mismatch',
        severity: 'warning',
        category: 'setting_conflict',
        title: 'Story Bible setting differs from confirmed Location node',
        description: `Story Bible setting is "${confirmedBibleSetting}", while the graph has confirmed location "${locationEntities[0].name}".`,
        affectedEntityIds: locationEntities.map((l) => l.id ?? l.name),
        targets,
        suggestedFix: 'Align the Location node name or update the Story Bible setting.',
      });
    }
  }

  // 4. Unresolved foundational story properties
  const requiredCoreFields: Array<{ key: 'genre' | 'tone' | 'setting'; label: string }> = [
    { key: 'genre', label: 'Genre' },
    { key: 'tone', label: 'Tone' },
    { key: 'setting', label: 'Setting' },
  ];
  const unconfirmedCore = requiredCoreFields.filter(
    (f) => snapshot.storyBible[f.key].status !== 'confirmed' || !snapshot.storyBible[f.key].value.trim()
  );
  if (unconfirmedCore.length > 0) {
    issues.push({
      id: 'issue_unresolved_core_bible',
      severity: 'warning',
      category: 'unresolved_decision',
      title: `${unconfirmedCore.length} core Story Bible property(${unconfirmedCore.map((u) => u.label).join(', ')}) awaiting confirmation`,
      description: `Confirming ${unconfirmedCore.map((u) => u.label).join(', ')} in the Decision Inbox or Story Bible locks them into the refined prompt.`,
      affectedEntityIds: [],
      targets: unconfirmedCore.map((f) => ({
        id: `target_bible_${f.key}`,
        kind: 'story_bible' as const,
        label: `Edit ${f.label}`,
        storyField: f.key,
      })),
      suggestedFix: 'Accept the suggested values in the Decision Inbox or edit them in the Story Bible tab.',
    });
  }

  return issues;
}
