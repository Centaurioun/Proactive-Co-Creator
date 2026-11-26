/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { getEffectiveAttributeValue, isSceneEntityName } from './beliefGraphUtils.ts';
import type {
  CreativeProject,
  DecisionProvenance,
  Entity,
  EpistemicKind,
  GenerationMode,
  ProjectSnapshot,
  StoryBibleFields,
} from '../shared/types.ts';

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

const IMAGE_BIBLE_KEYS: Array<keyof StoryBibleFields> = [
  'setting',
  'tone',
  'visualStyle',
  'cameraAndLighting',
  'genre',
];

const STORY_BIBLE_KEYS: Array<keyof StoryBibleFields> = [
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

interface EpistemicRecord {
  status?: string;
  sourceBacked?: boolean;
  epistemicKind?: EpistemicKind;
  provenance?: DecisionProvenance;
}

const promptEligibleKind = (kind: EpistemicKind | undefined): boolean =>
  kind === 'explicit' || kind === 'user-authored';

function isUnknownImportedRecord(record: EpistemicRecord): boolean {
  return (
    record.status === 'confirmed' &&
    Boolean(record.sourceBacked) &&
    record.epistemicKind === undefined
  );
}

function needsEpistemicSuppression(record: EpistemicRecord): boolean {
  if (promptEligibleKind(record.epistemicKind)) return false;
  if (record.sourceBacked) return true;
  return Boolean(record.epistemicKind) && record.provenance !== 'user-edit';
}

function isConfirmedUnreviewed(record: EpistemicRecord): boolean {
  return record.status === 'confirmed' && needsEpistemicSuppression(record);
}

function hasUnknownImportedContext(snapshot: ProjectSnapshot): boolean {
  if (snapshot.storyBible && Object.values(snapshot.storyBible).some(isUnknownImportedRecord)) {
    return true;
  }
  for (const entity of snapshot.entities) {
    if (isUnknownImportedRecord(entity) || entity.attributes.some(isUnknownImportedRecord)) {
      return true;
    }
  }
  return snapshot.relationships.some(isUnknownImportedRecord);
}

function hasSuppressedImportedContext(snapshot: ProjectSnapshot): boolean {
  if (Object.values(snapshot.storyBible).some(isConfirmedUnreviewed)) {
    return true;
  }
  for (const entity of snapshot.entities) {
    if (needsEpistemicSuppression(entity) || entity.attributes.some(isConfirmedUnreviewed)) {
      return true;
    }
  }
  return snapshot.relationships.some(isConfirmedUnreviewed);
}

function filterImportedContext(snapshot: ProjectSnapshot): {
  contextSnapshot: ProjectSnapshot;
  withheld: boolean;
} {
  if (!hasSuppressedImportedContext(snapshot)) {
    return { contextSnapshot: snapshot, withheld: false };
  }

  const filtered = structuredClone(snapshot);
  for (const field of Object.values(filtered.storyBible)) {
    if (isConfirmedUnreviewed(field)) {
      field.status = 'pending';
    }
  }
  filtered.entities = filtered.entities.flatMap((entity) => {
    if (needsEpistemicSuppression(entity)) return [];
    entity.attributes = entity.attributes.map((attribute) =>
      isConfirmedUnreviewed(attribute)
        ? { ...attribute, status: 'pending' as const, confirmedValue: undefined, presence_in_prompt: false }
        : attribute
    );
    return [entity];
  });
  filtered.relationships = filtered.relationships.map((relationship) =>
    isConfirmedUnreviewed(relationship)
      ? { ...relationship, status: 'pending' as const, presence_in_prompt: false }
      : relationship
  );
  return { contextSnapshot: filtered, withheld: true };
}

export type ProviderPromptDecision =
  | { ok: true; prompt: string; contextSnapshot: ProjectSnapshot; warning?: string }
  | { ok: false; reason: string };

export function resolveProviderPrompt(project: CreativeProject, targetMode: GenerationMode): ProviderPromptDecision {
  if (hasUnknownImportedContext(project.snapshot)) {
    return {
      ok: false,
      reason: 'Prompt review required: imported context has an unknown epistemic class. Review or edit it before using this AI operation.',
    };
  }
  const { contextSnapshot, withheld } = filterImportedContext(project.snapshot);
  const prompt = synthesizeRefinedPromptCore(contextSnapshot, targetMode);
  return {
    ok: true,
    prompt: withheld ? prompt : (project.snapshot.refinedPrompt || prompt),
    contextSnapshot,
    ...(withheld
      ? { warning: 'Unattributed or non-explicit imported claims were withheld from AI context; source evidence remains available in Review.' }
      : {}),
  };
}

export type StartupAnalysisProviderInputs =
  | { ok: true; prompt: string; mode: GenerationMode; askedQuestions: string[]; confirmedFacts: string[]; warning?: string }
  | { ok: false; reason: string };

export function buildStartupAnalysisProviderInputs(project: CreativeProject): StartupAnalysisProviderInputs {
  const decision = resolveProviderPrompt(project, project.snapshot.mode);
  if (!decision.ok) return decision;
  const confirmedFacts = [
    ...Object.entries(decision.contextSnapshot.storyBible)
      .filter(([, field]) => field.status === 'confirmed' && field.value)
      .map(([key, field]) => `${key}: ${field.value}`),
    ...decision.contextSnapshot.entities
      .filter((entity) => !entity.excluded)
      .flatMap((entity) =>
        entity.attributes
          .filter((attribute) => attribute.status === 'confirmed' && attribute.confirmedValue)
          .map((attribute) => `${entity.name} ${attribute.name}: ${attribute.confirmedValue}`)
      ),
  ];
  return {
    ok: true,
    prompt: decision.prompt,
    mode: project.snapshot.mode,
    askedQuestions: [...project.snapshot.answeredQuestions, ...project.snapshot.skippedQuestions],
    confirmedFacts,
    ...(decision.warning ? { warning: decision.warning } : {}),
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

function formatStoryBibleSection(snapshot: ProjectSnapshot, targetMode: GenerationMode): string | null {
  const keys = targetMode === 'image' ? IMAGE_BIBLE_KEYS : STORY_BIBLE_KEYS;
  const lines: string[] = [];
  for (const key of keys) {
    const field = snapshot.storyBible[key];
    if (field && field.status === 'confirmed' && field.value.trim()) {
      lines.push(`${STORY_FIELD_LABELS[key]}: ${field.value.trim()}`);
    }
  }
  return lines.length > 0 ? `Creative Direction:\n- ${lines.join('\n- ')}` : null;
}

function isEntityExcludedForPrompt(entity: Entity): boolean {
  if (entity.excluded) return true;
  const exAttr = entity.attributes.find(
    (a) => a.name === 'existence' || a.name === 'existence_in_image'
  );
  return Boolean(exAttr && exAttr.status === 'confirmed' && exAttr.confirmedValue === 'false');
}

function formatEntitiesAndOverrides(
  snapshot: ProjectSnapshot,
  baseIdeaLower: string
): { entityLines: string[]; excludedNames: string[]; seedOverrides: string[] } {
  const entityLines: string[] = [];
  const excludedNames: string[] = [];
  const seedOverrides: string[] = [];

  for (const entity of snapshot.entities) {
    if (isSceneEntityName(entity.name) || entity.category === 'scene') continue;
    if (entity.status === 'rejected') {
      excludedNames.push(entity.name);
      continue;
    }

    if (isEntityExcludedForPrompt(entity)) {
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
        baseIdeaLower.includes(alias.trim().toLowerCase())
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

  return { entityLines, excludedNames, seedOverrides };
}

function formatRelationshipsSection(
  snapshot: ProjectSnapshot,
  entityById: Map<string, Entity>,
  excludedNames: string[]
): string | null {
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

  return relLines.length > 0 ? `Relationships & Dynamics:\n- ${relLines.join('\n- ')}` : null;
}

function synthesizeRefinedPromptCore(
  snapshot: ProjectSnapshot,
  targetMode: GenerationMode
): string {
  const baseIdea = snapshot.originalIdea.trim();
  if (!baseIdea) return '';

  const sections: string[] = [baseIdea];
  const bibleSection = formatStoryBibleSection(snapshot, targetMode);
  if (bibleSection) sections.push(bibleSection);

  const entityById = new Map<string, Entity>();
  for (const e of snapshot.entities) {
    if (e.id) entityById.set(e.id, e);
  }
  const { entityLines, excludedNames, seedOverrides } = formatEntitiesAndOverrides(
    snapshot,
    baseIdea.toLowerCase()
  );

  if (seedOverrides.length > 0) {
    sections.push(`Seed Overrides & Canonical Identity:\n- ${seedOverrides.join('\n- ')}`);
  }
  if (entityLines.length > 0) {
    sections.push(`Confirmed Elements:\n- ${entityLines.join('\n- ')}`);
  }

  const relSection = formatRelationshipsSection(snapshot, entityById, excludedNames);
  if (relSection) sections.push(relSection);

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

  if (snapshot.freeformNotes.trim()) {
    sections.push(`Additional Author Notes:\n${snapshot.freeformNotes.trim()}`);
  }

  return sections.join('\n\n');
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
  const { contextSnapshot } = filterImportedContext(snapshot);
  return synthesizeRefinedPromptCore(contextSnapshot, targetMode);
}
