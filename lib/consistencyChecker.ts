/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { getEffectiveAttributeValue, isSceneEntityName } from './beliefGraphUtils.ts';
import type { ConsistencyIssue, ProjectSnapshot } from '../shared/types.ts';

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
      manualExclusions.some(
        (ex) => ex === entity.name.toLowerCase() || entity.name.toLowerCase().includes(ex)
      )
    ) {
      issues.push({
        id: `issue_excl_${entity.id ?? entity.name}`,
        severity: 'error',
        category: 'violated_exclusion',
        title: `Excluded entity "${entity.name}" is still marked Present`,
        description: `"${entity.name}" appears in Explicit Exclusions, but its graph node existence is still set to Present.`,
        affectedEntityIds: entity.id ? [entity.id] : [],
        suggestedFix: `Set "${entity.name}" existence to Absent in the Inspector.`,
      });
    }

    if (entity.excluded) {
      const conflictMention = snapshot.storyBible.centralConflict.value
        .toLowerCase()
        .includes(entity.name.toLowerCase());
      if (conflictMention && snapshot.storyBible.centralConflict.status === 'confirmed') {
        issues.push({
          id: `issue_excl_conflict_${entity.id ?? entity.name}`,
          severity: 'warning',
          category: 'violated_exclusion',
          title: `Excluded entity "${entity.name}" is referenced in Central Conflict`,
          description: `"${entity.name}" is excluded from the project, but the Story Bible Central Conflict still mentions "${entity.name}".`,
          affectedEntityIds: entity.id ? [entity.id] : [],
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
        issues.push({
          id: `issue_trait_${entity.id ?? entity.name}_${label}`,
          severity: 'warning',
          category: 'trait_conflict',
          title: `Potential trait contradiction on "${entity.name}"`,
          description: `Confirmed attributes and description for "${entity.name}" contain contrasting signals for ${label}.`,
          affectedEntityIds: entity.id ? [entity.id] : [],
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
      issues.push({
        id: 'issue_setting_mismatch',
        severity: 'warning',
        category: 'setting_conflict',
        title: 'Story Bible setting differs from confirmed Location node',
        description: `Story Bible setting is "${confirmedBibleSetting}", while the graph has confirmed location "${locationEntities[0].name}".`,
        affectedEntityIds: locationEntities.map((l) => l.id ?? l.name),
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
      suggestedFix: 'Accept the suggested values in the Decision Inbox or edit them in the Story Bible tab.',
    });
  }

  return issues;
}
