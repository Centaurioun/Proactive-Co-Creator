/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { splitSceneAndObjectEntities } from '../beliefGraphUtils.ts';
import type {
  Attribute,
  DecisionProvenance,
  ProjectSnapshot,
  StoryBible,
  StoryBibleField,
  StoryBibleFields,
} from '../../shared/types.ts';
import { isUserClearedStoryField } from './ids.ts';

export const SCENE_ATTR_TO_BIBLE_FIELD: Record<string, keyof StoryBibleFields> = {
  genre: 'genre',
  tone: 'tone',
  atmosphere: 'tone',
  narrative_perspective: 'narrativePerspective',
  perspective: 'narrativePerspective',
  audience: 'intendedAudience',
  setting: 'setting',
  location: 'setting',
  themes: 'themes',
  theme: 'themes',
  central_conflict: 'centralConflict',
  conflict: 'centralConflict',
  pacing: 'pacing',
  image_style: 'visualStyle',
  style: 'visualStyle',
  camera_angle: 'cameraAndLighting',
  lighting: 'cameraAndLighting',
};

export const STORY_FIELD_TO_SCENE_ATTRS: Partial<Record<keyof StoryBibleFields, string[]>> = {
  genre: ['genre'],
  tone: ['tone', 'atmosphere'],
  narrativePerspective: ['narrative_perspective', 'perspective'],
  intendedAudience: ['audience'],
  setting: ['setting', 'location'],
  themes: ['themes', 'theme'],
  centralConflict: ['central_conflict', 'conflict'],
  pacing: ['pacing'],
  visualStyle: ['image_style', 'style'],
  cameraAndLighting: ['lighting', 'camera_angle'],
};

function containsUnsupportedControlChars(value: string): boolean {
  for (let i = 0; i < value.length; i++) {
    const code = value.charCodeAt(i);
    if (
      (code >= 0 && code <= 8) ||
      code === 11 ||
      code === 12 ||
      (code >= 14 && code <= 31) ||
      code === 127
    ) {
      return true;
    }
  }
  return false;
}

export interface StoryBibleValidationResult {
  ok: boolean;
  normalized: string;
  intent: 'set' | 'clear' | 'invalid';
  error?: string;
}

/**
 * Validates Story Bible input without imposing artificial enums or genre caps.
 * Preserves Unicode, punctuation, newlines (\n/\r), and tabs (\t); rejects non-strings
 * and unsupported ASCII control characters; separates deliberate clear from valid values.
 */
export function validateStoryBibleUpdate(
  _field: keyof StoryBibleFields,
  rawInput: unknown
): StoryBibleValidationResult {
  if (typeof rawInput !== 'string') {
    return {
      ok: false,
      normalized: '',
      intent: 'invalid',
      error: 'Field value must be valid text.',
    };
  }
  if (containsUnsupportedControlChars(rawInput)) {
    return {
      ok: false,
      normalized: '',
      intent: 'invalid',
      error: 'Unsupported control characters are not allowed in Story Bible fields.',
    };
  }
  if (rawInput.trim().length === 0) {
    return {
      ok: true,
      normalized: '',
      intent: 'clear',
    };
  }
  return {
    ok: true,
    normalized: rawInput,
    intent: 'set',
  };
}

function syncSingleSceneAttribute(
  attr: Attribute,
  mappedField: keyof StoryBibleFields,
  storyBible: StoryBible,
  now: number
): void {
  const bibleEntry = storyBible[mappedField];
  const attrVal = attr.confirmedValue ?? attr.value[0]?.name ?? '';
  const attrUpdatedAt = attr.updatedAt ?? 0;
  const bibleClearedByUser = isUserClearedStoryField(bibleEntry);
  const sceneEditedExplicitlyAfterClear =
    bibleClearedByUser &&
    attrUpdatedAt > bibleEntry.updatedAt &&
    (attr.provenance === 'user-edit' || attr.provenance === 'accepted-suggestion') &&
    attr.status === 'confirmed' &&
    Boolean(attrVal.trim());

  if (bibleClearedByUser && !sceneEditedExplicitlyAfterClear) {
    attr.confirmedValue = undefined;
    attr.status = 'pending';
    attr.provenance = 'user-edit';
    attr.updatedAt = Math.max(attrUpdatedAt, bibleEntry.updatedAt);
    attr.value = [];
    delete attr.epistemicKind;
    delete attr.sourceBacked;
    return;
  }

  const bibleIsNewerConfirmed =
    bibleEntry.status === 'confirmed' &&
    Boolean(bibleEntry.value.trim()) &&
    bibleEntry.updatedAt > attrUpdatedAt;

  if (bibleIsNewerConfirmed) {
    const cleanVal = bibleEntry.value.trim();
    attr.confirmedValue = cleanVal;
    attr.status = 'confirmed';
    attr.provenance = bibleEntry.provenance;
    attr.updatedAt = bibleEntry.updatedAt;
    if (bibleEntry.epistemicKind !== undefined) {
      attr.epistemicKind = bibleEntry.epistemicKind;
    } else if (bibleEntry.provenance === 'user-edit' && (attr.sourceBacked || attr.epistemicKind)) {
      attr.epistemicKind = 'user-authored';
    }
    if (bibleEntry.sourceBacked) {
      attr.sourceBacked = true;
    }
    if (!attr.value.some((v) => v.name === cleanVal)) {
      attr.value = [{ name: cleanVal }, ...attr.value];
    }
    return;
  }

  const epistemicFields: Partial<Pick<StoryBibleField<string>, 'epistemicKind' | 'sourceBacked'>> = {
    ...(attr.epistemicKind !== undefined ? { epistemicKind: attr.epistemicKind } : {}),
    ...(attr.sourceBacked ? { sourceBacked: true } : {}),
  };

  if (attr.status === 'confirmed' && attrVal.trim()) {
    if (
      bibleEntry.status === 'confirmed' &&
      bibleEntry.updatedAt >= attrUpdatedAt &&
      bibleEntry.value.trim() === attrVal.trim()
    ) {
      return;
    }
    storyBible[mappedField] = {
      value: attrVal.trim(),
      status: 'confirmed',
      provenance: attr.provenance ?? 'user-edit',
      updatedAt: attrUpdatedAt || bibleEntry.updatedAt || now,
      ...epistemicFields,
    };
  } else if (!bibleEntry.value.trim() && attrVal.trim()) {
    storyBible[mappedField] = {
      value: attrVal.trim(),
      status: attr.status ?? 'pending',
      provenance: attr.provenance ?? 'ai-inferred',
      updatedAt: attrUpdatedAt || bibleEntry.updatedAt || now,
      ...epistemicFields,
    };
  }
}

export function syncStoryBibleWithSceneEntityInPlace(
  next: ProjectSnapshot,
  now: number = Date.now()
): void {
  const { sceneEntity } = splitSceneAndObjectEntities(next.entities);
  if (sceneEntity) {
    for (const attr of sceneEntity.attributes) {
      const mappedField = SCENE_ATTR_TO_BIBLE_FIELD[attr.name.toLowerCase()];
      if (mappedField) {
        syncSingleSceneAttribute(attr, mappedField, next.storyBible, now);
      }
    }
  }

  const excludedNames = next.entities
    .filter((e) => e.excluded)
    .map((e) => e.name);
  if (excludedNames.length > 0) {
    const existingExclusions = next.storyBible.explicitExclusions.value
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
    const merged = Array.from(new Set([...existingExclusions, ...excludedNames])).join(', ');
    next.storyBible.explicitExclusions = {
      value: merged,
      status: 'confirmed',
      provenance: 'user-edit',
      updatedAt: now,
    };
  }
}

export function syncStoryBibleWithSceneEntity(snapshot: ProjectSnapshot): ProjectSnapshot {
  const next = structuredClone(snapshot);
  syncStoryBibleWithSceneEntityInPlace(next, Date.now());
  return next;
}

export function removeNamesFromExplicitExclusionsInPlace(
  next: ProjectSnapshot,
  namesToRemove: string[],
  provenance: DecisionProvenance,
  now: number
): void {
  const removeSet = new Set(namesToRemove.map((n) => n.trim().toLowerCase()).filter(Boolean));
  if (removeSet.size === 0 || !next.storyBible.explicitExclusions.value.trim()) return;

  const currentItems = next.storyBible.explicitExclusions.value
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  const filtered = currentItems.filter((item) => !removeSet.has(item.toLowerCase()));
  if (filtered.length === currentItems.length) return;

  const nextValue = filtered.join(', ');
  next.storyBible.explicitExclusions = {
    value: nextValue,
    status: nextValue ? next.storyBible.explicitExclusions.status : 'pending',
    provenance,
    updatedAt: Math.max(now, (next.storyBible.explicitExclusions.updatedAt ?? 0) + 1),
  };
}
