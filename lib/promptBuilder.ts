/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { getEffectiveAttributeValue, isSceneEntityName } from './beliefGraphUtils.ts';
import type { GenerationMode, ProjectSnapshot, StoryBibleFields } from '../shared/types.ts';

const STORY_FIELD_LABELS: Record<keyof StoryBibleFields, string> = {
  genre: 'Genre',
  tone: 'Tone & Mood',
  narrativePerspective: 'Narrative Perspective',
  intendedAudience: 'Audience',
  setting: 'Setting',
  themes: 'Themes',
  centralConflict: 'Central Conflict',
  pacing: 'Pacing',
  continuityRules: 'Continuity & Notes',
  explicitExclusions: 'Explicit Exclusions',
  visualStyle: 'Visual Style',
  cameraAndLighting: 'Camera & Lighting',
};

/**
 * Synthesizes a clean, authoritative generation prompt from confirmed creative decisions.
 * Never includes rejected suggestions or unconfirmed AI guesses.
 * Respects mode-specific fields while sharing core story facts.
 */
export function synthesizeRefinedPrompt(
  snapshot: ProjectSnapshot,
  targetMode: GenerationMode = snapshot.mode
): string {
  const baseIdea = snapshot.originalIdea.trim();
  if (!baseIdea) return '';

  const sections: string[] = [baseIdea];

  // 1. Confirmed Story Bible properties
  const bibleLines: string[] = [];
  const relevantBibleKeys: Array<keyof StoryBibleFields> =
    targetMode === 'image'
      ? [
          'setting',
          'tone',
          'visualStyle',
          'cameraAndLighting',
          'genre',
        ]
      : [
          'genre',
          'tone',
          'setting',
          'narrativePerspective',
          'intendedAudience',
          'themes',
          'centralConflict',
          'pacing',
          'continuityRules',
        ];

  for (const key of relevantBibleKeys) {
    const field = snapshot.storyBible[key];
    if (field && field.status === 'confirmed' && field.value.trim()) {
      bibleLines.push(`${STORY_FIELD_LABELS[key]}: ${field.value.trim()}`);
    }
  }

  if (bibleLines.length > 0) {
    sections.push(`Creative Direction:\n- ${bibleLines.join('\n- ')}`);
  }

  // 2. Confirmed Entities and Attributes (excluding excluded entities and scene meta-entity)
  const entityLines: string[] = [];
  const excludedNames: string[] = [];

  for (const entity of snapshot.entities) {
    if (isSceneEntityName(entity.name) || entity.category === 'scene') continue;

    const exAttr = entity.attributes.find(
      (a) => a.name === 'existence' || a.name === 'existence_in_image'
    );
    const isExcluded =
      entity.excluded ||
      (exAttr && exAttr.status === 'confirmed' && exAttr.confirmedValue === 'false');

    if (isExcluded) {
      excludedNames.push(entity.name);
      continue;
    }

    const confirmedAttrs = entity.attributes.filter(
      (a) =>
        a.name !== 'existence' &&
        a.name !== 'existence_in_image' &&
        a.status === 'confirmed' &&
        getEffectiveAttributeValue(a) !== 'Unknown'
    );

    if (confirmedAttrs.length > 0 || entity.provenance === 'user-edit') {
      const attrSummary = confirmedAttrs
        .map((a) => `${a.name.replace(/_/g, ' ')}: ${getEffectiveAttributeValue(a)}`)
        .join(', ');
      if (attrSummary) {
        entityLines.push(`${entity.name} (${attrSummary})`);
      } else if (entity.status === 'confirmed' && !entity.presence_in_prompt) {
        entityLines.push(`${entity.name}${entity.description ? ` — ${entity.description}` : ''}`);
      }
    }
  }

  if (entityLines.length > 0) {
    sections.push(`Confirmed Elements:\n- ${entityLines.join('\n- ')}`);
  }

  // 3. Confirmed Relationships between active (non-excluded) entities
  const excludedSet = new Set(excludedNames.map((n) => n.toLowerCase()));
  const relLines: string[] = [];

  for (const rel of snapshot.relationships) {
    if (excludedSet.has(rel.source.toLowerCase()) || excludedSet.has(rel.target.toLowerCase())) {
      continue;
    }
    if (rel.status === 'confirmed' && rel.provenance !== 'prompt-explicit') {
      relLines.push(`${rel.source} ${rel.label} ${rel.target}`);
    } else if (rel.status === 'confirmed' && rel.provenance === 'prompt-explicit') {
      relLines.push(`${rel.source} ${rel.label} ${rel.target}`);
    }
  }

  if (relLines.length > 0) {
    sections.push(`Relationships & Dynamics:\n- ${relLines.join('\n- ')}`);
  }

  // 4. Explicit Exclusions
  const manualExclusions =
    snapshot.storyBible.explicitExclusions.status === 'confirmed'
      ? snapshot.storyBible.explicitExclusions.value
          .split(',')
          .map((s) => s.trim())
          .filter(Boolean)
      : [];
  const allExclusions = Array.from(new Set([...excludedNames, ...manualExclusions]));
  if (allExclusions.length > 0) {
    sections.push(`Do NOT include (Explicit Exclusions): ${allExclusions.join(', ')}.`);
  }

  // 5. Freeform user notes (never overwritten by AI analysis)
  if (snapshot.freeformNotes.trim()) {
    sections.push(`Additional Author Notes:\n${snapshot.freeformNotes.trim()}`);
  }

  return sections.join('\n\n');
}
