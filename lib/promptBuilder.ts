/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { getEffectiveAttributeValue, isSceneEntityName } from './beliefGraphUtils.ts';
import type { GenerationMode, ProjectSnapshot, StoryBibleFields } from '../shared/types.ts';
import type { CreativeProject, EpistemicKind } from '../shared/types.ts';

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

const promptEligibleKind = (kind: EpistemicKind | undefined) => kind === 'explicit' || kind === 'user-authored';

function hasUnknownImportedContext(snapshot: ProjectSnapshot): boolean {
  return snapshot.storyBible && Object.values(snapshot.storyBible).some(field =>
    field.status === 'confirmed' && field.sourceBacked && field.epistemicKind === undefined
  ) || snapshot.entities.some(entity =>
    (entity.status === 'confirmed' && entity.sourceBacked && entity.epistemicKind === undefined) ||
    entity.attributes.some(attribute => attribute.status === 'confirmed' && attribute.sourceBacked && attribute.epistemicKind === undefined)
  ) || snapshot.relationships.some(relationship =>
    relationship.status === 'confirmed' && relationship.sourceBacked && relationship.epistemicKind === undefined
  );
}

function withoutUnreviewedImportedContext(snapshot: ProjectSnapshot): ProjectSnapshot {
  const filtered = structuredClone(snapshot);
  for (const field of Object.values(filtered.storyBible)) {
    if (field.status === 'confirmed' && field.sourceBacked && !promptEligibleKind(field.epistemicKind) ||
      field.status === 'confirmed' && field.epistemicKind && !promptEligibleKind(field.epistemicKind) && field.provenance !== 'user-edit') field.status = 'pending';
  }
  filtered.entities = filtered.entities.flatMap(entity => {
    if ((entity.sourceBacked && !promptEligibleKind(entity.epistemicKind)) ||
      (entity.epistemicKind && !promptEligibleKind(entity.epistemicKind) && entity.provenance !== 'user-edit')) return [];
    entity.attributes = entity.attributes.map(attribute => {
      if (attribute.status === 'confirmed' && (attribute.sourceBacked && !promptEligibleKind(attribute.epistemicKind) ||
        attribute.epistemicKind && !promptEligibleKind(attribute.epistemicKind) && attribute.provenance !== 'user-edit')) {
        return { ...attribute, status: 'pending' as const, confirmedValue: undefined, presence_in_prompt: false };
      }
      return attribute;
    });
    return [entity];
  });
  filtered.relationships = filtered.relationships.map(relationship =>
    relationship.status === 'confirmed' && (relationship.sourceBacked && !promptEligibleKind(relationship.epistemicKind) ||
      relationship.epistemicKind && !promptEligibleKind(relationship.epistemicKind) && relationship.provenance !== 'user-edit')
      ? { ...relationship, status: 'pending' as const, presence_in_prompt: false }
      : relationship
  );
  return filtered;
}

function hasSuppressedImportedContext(snapshot: ProjectSnapshot): boolean {
  return Object.values(snapshot.storyBible).some(field => field.status === 'confirmed' &&
    (field.sourceBacked && !promptEligibleKind(field.epistemicKind) || field.epistemicKind && !promptEligibleKind(field.epistemicKind) && field.provenance !== 'user-edit')) ||
    snapshot.entities.some(entity => entity.sourceBacked && !promptEligibleKind(entity.epistemicKind) ||
      entity.attributes.some(attribute => attribute.status === 'confirmed' &&
        (attribute.sourceBacked && !promptEligibleKind(attribute.epistemicKind) || attribute.epistemicKind && !promptEligibleKind(attribute.epistemicKind) && attribute.provenance !== 'user-edit'))) ||
    snapshot.relationships.some(relationship => relationship.status === 'confirmed' &&
      (relationship.sourceBacked && !promptEligibleKind(relationship.epistemicKind) || relationship.epistemicKind && !promptEligibleKind(relationship.epistemicKind) && relationship.provenance !== 'user-edit'));
}

export type ProviderPromptDecision =
  | { ok: true; prompt: string; contextSnapshot: ProjectSnapshot; warning?: string }
  | { ok: false; reason: string };

export function resolveProviderPrompt(project: CreativeProject, targetMode: GenerationMode): ProviderPromptDecision {
  if (hasUnknownImportedContext(project.snapshot)) {
    return { ok: false, reason: 'Prompt review required: imported context has an unknown epistemic class. Review or edit it before using this AI operation.' };
  }
  const contextSnapshot = withoutUnreviewedImportedContext(project.snapshot);
  const prompt = synthesizeRefinedPrompt(contextSnapshot, targetMode);
  const withheld = hasSuppressedImportedContext(project.snapshot);
  return {
    ok: true,
    prompt: withheld ? prompt : (project.snapshot.refinedPrompt || prompt),
    contextSnapshot,
    ...(withheld ? { warning: 'Unattributed or non-explicit imported claims were withheld from AI context; source evidence remains available in Review.' } : {}),
  };
}

/**
 * Deterministic fast hash for comparing prompt + mode across revisions and artifacts.
 */
export function computePromptDigest(prompt: string, mode: GenerationMode): string {
  const normalized = `${mode}::${prompt.trim().replace(/\s+/g, ' ')}`;
  let h1 = 0xdeadbeef ^ normalized.length;
  let h2 = 0x41c6ce57 ^ normalized.length;
  for (let i = 0; i < normalized.length; i++) {
    const ch = normalized.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return `pd_${(h2 >>> 0).toString(16).padStart(8, '0')}${(h1 >>> 0).toString(16).padStart(8, '0')}`;
}

/**
 * Synthesizes a clean, authoritative generation prompt from confirmed creative decisions.
 * Never includes rejected suggestions or unconfirmed AI guesses.
 * Emits explicit Seed Overrides when seed entities are renamed or excluded so downstream
 * generation never reintroduces stale seed names or excluded subjects.
 */
export function synthesizeRefinedPrompt(
  snapshot: ProjectSnapshot,
  targetMode: GenerationMode = snapshot.mode
): string {
  snapshot = withoutUnreviewedImportedContext(snapshot);
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

  // 2. Confirmed Entities, Attributes, and Seed Overrides
  const entityLines: string[] = [];
  const excludedNames: string[] = [];
  const seedOverrides: string[] = [];
  const entityById = new Map(snapshot.entities.map((e) => [e.id, e]));

  for (const entity of snapshot.entities) {
    if (isSceneEntityName(entity.name) || entity.category === 'scene') continue;
    if (entity.status === 'rejected') {
      excludedNames.push(entity.name);
      continue;
    }

    const exAttr = entity.attributes.find(
      (a) => a.name === 'existence' || a.name === 'existence_in_image'
    );
    const isExcluded =
      entity.excluded ||
      (exAttr && exAttr.status === 'confirmed' && exAttr.confirmedValue === 'false');

    if (isExcluded) {
      excludedNames.push(entity.name);
      if (entity.aliases && entity.aliases.length > 0) {
        excludedNames.push(...entity.aliases);
      }
      seedOverrides.push(
        `Exclude "${entity.name}" from the output (override any seed mention of "${entity.name}").`
      );
      continue;
    }

    const priorAliases = (entity.aliases ?? []).filter(
      (alias) => alias.trim().toLowerCase() !== entity.name.trim().toLowerCase()
    );
    if (entity.provenance === 'user-edit' && priorAliases.length > 0) {
      const seedMatchingAliases = priorAliases.filter((alias) =>
        baseIdea.toLowerCase().includes(alias.trim().toLowerCase())
      );
      const relevantAliases =
        seedMatchingAliases.length > 0
          ? seedMatchingAliases
          : [priorAliases[priorAliases.length - 1]];
      seedOverrides.push(
        `Canonical name for ${relevantAliases.map((a) => `"${a}"`).join(' / ')} is "${entity.name}" (use "${entity.name}" instead of ${relevantAliases.map((a) => `"${a}"`).join(' or ')}).`
      );
    }

    const confirmedAttrs = entity.attributes.filter(
      (a) =>
        a.name !== 'existence' &&
        a.name !== 'existence_in_image' &&
        a.status === 'confirmed' &&
        getEffectiveAttributeValue(a) !== 'Unknown'
    );

    if (
      confirmedAttrs.length > 0 ||
      entity.provenance === 'user-edit' ||
      priorAliases.length > 0 ||
      (entity.status === 'confirmed' && !entity.presence_in_prompt)
    ) {
      const attrSummary = confirmedAttrs
        .map((a) => `${a.name.replace(/_/g, ' ')}: ${getEffectiveAttributeValue(a)}`)
        .join(', ');
      if (attrSummary) {
        entityLines.push(`${entity.name} (${attrSummary})`);
      } else if (entity.status === 'confirmed') {
        entityLines.push(`${entity.name}${entity.description ? ` — ${entity.description}` : ''}`);
      }
    }
  }

  if (seedOverrides.length > 0) {
    sections.push(`Seed Overrides & Canonical Identity:\n- ${seedOverrides.join('\n- ')}`);
  }

  if (entityLines.length > 0) {
    sections.push(`Confirmed Elements:\n- ${entityLines.join('\n- ')}`);
  }

  // 3. Confirmed Relationships between active (non-excluded) entities
  const excludedSet = new Set(excludedNames.map((n) => n.toLowerCase()));
  const relLines: string[] = [];

  for (const rel of snapshot.relationships) {
    if (rel.status !== 'confirmed') continue;

    const sourceEntity = rel.sourceId ? entityById.get(rel.sourceId) : undefined;
    const targetEntity = rel.targetId ? entityById.get(rel.targetId) : undefined;

    if (sourceEntity?.excluded || targetEntity?.excluded) continue;
    if (sourceEntity?.status === 'rejected' || targetEntity?.status === 'rejected') continue;

    const sourceName = sourceEntity?.name ?? rel.source;
    const targetName = targetEntity?.name ?? rel.target;

    if (excludedSet.has(sourceName.toLowerCase()) || excludedSet.has(targetName.toLowerCase())) {
      continue;
    }

    relLines.push(`${sourceName} ${rel.label} ${targetName}`);
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
