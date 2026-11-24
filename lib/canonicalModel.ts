/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import {
  getCanonicalEntityName,
  inferEntityCategory,
  isSceneEntityName,
  splitSceneAndObjectEntities,
} from './beliefGraphUtils.ts';
import { synthesizeRefinedPrompt } from './promptBuilder.ts';
import type {
  ApprovalStatus,
  Attribute,
  BeliefState,
  Clarification,
  CreativeProject,
  DecisionItem,
  DecisionProvenance,
  Entity,
  EntityCategory,
  ProjectSnapshot,
  Relationship,
  StoryBible,
  StoryBibleFields,
} from '../shared/types.ts';

let idCounter = 1;
export function makeStableId(prefix: string): string {
  const ts = Date.now().toString(36);
  const seq = (idCounter++).toString(36);
  return `${prefix}_${ts}_${seq}`;
}

export function createEmptyStoryBible(now: number = Date.now()): StoryBible {
  const emptyField = () => ({
    value: '',
    status: 'pending' as ApprovalStatus,
    provenance: 'derived' as DecisionProvenance,
    updatedAt: now,
  });

  return {
    genre: emptyField(),
    tone: emptyField(),
    narrativePerspective: emptyField(),
    intendedAudience: emptyField(),
    setting: emptyField(),
    themes: emptyField(),
    centralConflict: emptyField(),
    pacing: emptyField(),
    continuityRules: emptyField(),
    explicitExclusions: emptyField(),
    visualStyle: emptyField(),
    cameraAndLighting: emptyField(),
  };
}

export const SAMPLE_STORY_PROMPT =
  'A cat hosting a party for its animal friends, sitting around a table eating and chatting.';

export function createSampleProject(now: number = Date.now()): CreativeProject {
  const storyBible = createEmptyStoryBible(now);
  storyBible.genre = {
    value: 'Cozy Anthropomorphic Fable',
    status: 'confirmed',
    provenance: 'prompt-explicit',
    updatedAt: now,
  };
  storyBible.tone = {
    value: 'Warm and whimsical',
    status: 'pending',
    provenance: 'ai-inferred',
    updatedAt: now,
  };
  storyBible.setting = {
    value: 'Lantern-lit conservatory dining room',
    status: 'pending',
    provenance: 'ai-inferred',
    updatedAt: now,
  };
  storyBible.narrativePerspective = {
    value: 'Third-person limited (following the Cat)',
    status: 'pending',
    provenance: 'ai-inferred',
    updatedAt: now,
  };
  storyBible.pacing = {
    value: 'Unhurried, conversational',
    status: 'pending',
    provenance: 'ai-inferred',
    updatedAt: now,
  };
  storyBible.centralConflict = {
    value: 'Keeping a surprise dessert secret while old woodland rivalries surface at the table',
    status: 'pending',
    provenance: 'ai-inferred',
    updatedAt: now,
  };

  const entities: Entity[] = [
    {
      id: 'ent_story_scene',
      name: 'The Story',
      category: 'scene',
      presence_in_prompt: true,
      description: 'High-level narrative properties and scene atmosphere.',
      alternatives: null,
      status: 'confirmed',
      provenance: 'prompt-explicit',
      attributes: [
        {
          id: 'attr_story_existence',
          name: 'existence',
          presence_in_prompt: true,
          value: [{ name: 'true' }, { name: 'false' }],
          confirmedValue: 'true',
          status: 'confirmed',
          provenance: 'prompt-explicit',
        },
        {
          id: 'attr_story_genre',
          name: 'genre',
          presence_in_prompt: true,
          value: [
            { name: 'Cozy Anthropomorphic Fable' },
            { name: 'Woodland Mystery' },
            { name: 'Satirical Comedy' },
          ],
          confirmedValue: 'Cozy Anthropomorphic Fable',
          status: 'confirmed',
          provenance: 'prompt-explicit',
        },
        {
          id: 'attr_story_tone',
          name: 'tone',
          presence_in_prompt: false,
          value: [{ name: 'Warm and whimsical' }, { name: 'Mysterious' }, { name: 'Chaotic' }],
          status: 'pending',
          provenance: 'ai-inferred',
        },
        {
          id: 'attr_story_setting',
          name: 'setting',
          presence_in_prompt: false,
          value: [
            { name: 'Lantern-lit conservatory dining room' },
            { name: 'Sunlit garden courtyard' },
            { name: 'Snowy mountain cabin' },
          ],
          status: 'pending',
          provenance: 'ai-inferred',
        },
      ],
    },
    {
      id: 'ent_cat',
      name: 'Cat',
      category: 'character',
      presence_in_prompt: true,
      description: 'The attentive host of the dinner party.',
      alternatives: [{ name: 'Tabby Cat' }, { name: 'Tuxedo Cat' }],
      status: 'confirmed',
      provenance: 'prompt-explicit',
      aliases: ['The Cat', 'Host Cat'],
      attributes: [
        {
          id: 'attr_cat_existence',
          name: 'existence',
          presence_in_prompt: true,
          value: [{ name: 'true' }, { name: 'false' }],
          confirmedValue: 'true',
          status: 'confirmed',
          provenance: 'prompt-explicit',
        },
        {
          id: 'attr_cat_role',
          name: 'role',
          presence_in_prompt: true,
          value: [{ name: 'Party Host' }, { name: 'Master of Ceremonies' }],
          confirmedValue: 'Party Host',
          status: 'confirmed',
          provenance: 'prompt-explicit',
        },
        {
          id: 'attr_cat_personality',
          name: 'personality',
          presence_in_prompt: false,
          value: [{ name: 'Gracious' }, { name: 'Mischievous' }, { name: 'Mysterious' }],
          status: 'pending',
          provenance: 'ai-inferred',
        },
        {
          id: 'attr_cat_age',
          name: 'age',
          presence_in_prompt: false,
          value: [{ name: 'Young adult' }, { name: 'Young' }, { name: 'Elderly' }],
          status: 'pending',
          provenance: 'ai-inferred',
        },
      ],
    },
    {
      id: 'ent_rabbit',
      name: 'Rabbit',
      category: 'character',
      presence_in_prompt: false,
      description: 'An animal friend invited to the cat’s table.',
      alternatives: [{ name: 'Hare' }, { name: 'Dormouse' }],
      status: 'confirmed',
      provenance: 'prompt-explicit',
      groupId: 'group_animal_guests',
      aliases: ['The Rabbit'],
      attributes: [
        {
          id: 'attr_rabbit_existence',
          name: 'existence',
          presence_in_prompt: true,
          value: [{ name: 'true' }, { name: 'false' }],
          confirmedValue: 'true',
          status: 'confirmed',
          provenance: 'prompt-explicit',
        },
        {
          id: 'attr_rabbit_personality',
          name: 'personality',
          presence_in_prompt: false,
          value: [{ name: 'Excitable storyteller' }, { name: 'Cautious' }, { name: 'Friendly' }],
          status: 'pending',
          provenance: 'ai-inferred',
        },
        {
          id: 'attr_rabbit_age',
          name: 'age',
          presence_in_prompt: false,
          value: [{ name: 'Adult' }, { name: 'Elderly' }, { name: 'Young' }],
          status: 'pending',
          provenance: 'ai-inferred',
        },
      ],
    },
    {
      id: 'ent_fox',
      name: 'Fox',
      category: 'character',
      presence_in_prompt: false,
      description: 'A sharp-witted woodland friend seated at the dinner table.',
      alternatives: [{ name: 'Badger' }, { name: 'Owl' }],
      status: 'confirmed',
      provenance: 'prompt-explicit',
      groupId: 'group_animal_guests',
      aliases: ['The Fox'],
      attributes: [
        {
          id: 'attr_fox_existence',
          name: 'existence',
          presence_in_prompt: true,
          value: [{ name: 'true' }, { name: 'false' }],
          confirmedValue: 'true',
          status: 'confirmed',
          provenance: 'prompt-explicit',
        },
        {
          id: 'attr_fox_personality',
          name: 'personality',
          presence_in_prompt: false,
          value: [{ name: 'Charming raconteur' }, { name: 'Sly' }, { name: 'Friendly' }],
          status: 'pending',
          provenance: 'ai-inferred',
        },
        {
          id: 'attr_fox_age',
          name: 'age',
          presence_in_prompt: false,
          value: [{ name: 'Middle-aged' }, { name: 'Elderly' }, { name: 'Young' }],
          status: 'pending',
          provenance: 'ai-inferred',
        },
      ],
    },
    {
      id: 'ent_table',
      name: 'Banquet Table',
      category: 'object',
      presence_in_prompt: true,
      description: 'The central table where the cat and animal friends dine and chat.',
      alternatives: [{ name: 'Oak Dining Table' }, { name: 'Picnic Table' }],
      status: 'confirmed',
      provenance: 'prompt-explicit',
      aliases: ['Table'],
      attributes: [
        {
          id: 'attr_table_existence',
          name: 'existence',
          presence_in_prompt: true,
          value: [{ name: 'true' }, { name: 'false' }],
          confirmedValue: 'true',
          status: 'confirmed',
          provenance: 'prompt-explicit',
        },
        {
          id: 'attr_table_spread',
          name: 'food_spread',
          presence_in_prompt: true,
          value: [
            { name: 'Artisanal pastries, fish tartlets, and herbal tea' },
            { name: 'Rustic woodland harvest feast' },
            { name: 'Midnight mystery banquet' },
          ],
          status: 'pending',
          provenance: 'ai-inferred',
        },
      ],
    },
    {
      id: 'ent_conservatory',
      name: 'Conservatory Dining Room',
      category: 'location',
      presence_in_prompt: false,
      description: 'The setting where the dinner party takes place.',
      alternatives: [{ name: 'Garden Patio' }, { name: 'Snowy Mountain Cabin' }],
      status: 'pending',
      provenance: 'ai-inferred',
      aliases: ['Party Setting', 'Dining Room'],
      attributes: [
        {
          id: 'attr_loc_existence',
          name: 'existence',
          presence_in_prompt: false,
          value: [{ name: 'true' }, { name: 'false' }],
          confirmedValue: 'true',
          status: 'pending',
          provenance: 'ai-inferred',
        },
        {
          id: 'attr_loc_atmosphere',
          name: 'atmosphere',
          presence_in_prompt: false,
          value: [{ name: 'Candlelit and inviting' }, { name: 'Mysterious' }, { name: 'Festive' }],
          status: 'pending',
          provenance: 'ai-inferred',
        },
      ],
    },
  ];

  const relationships: Relationship[] = [
    {
      id: 'rel_cat_rabbit',
      sourceId: 'ent_cat',
      targetId: 'ent_rabbit',
      source: 'Cat',
      target: 'Rabbit',
      label: 'hosting',
      alternatives: [{ name: 'welcoming' }, { name: 'pouring tea for' }],
      status: 'confirmed',
      provenance: 'prompt-explicit',
    },
    {
      id: 'rel_cat_fox',
      sourceId: 'ent_cat',
      targetId: 'ent_fox',
      source: 'Cat',
      target: 'Fox',
      label: 'hosting',
      alternatives: [{ name: 'chatting with' }, { name: 'watching closely' }],
      status: 'confirmed',
      provenance: 'prompt-explicit',
    },
    {
      id: 'rel_rabbit_fox',
      sourceId: 'ent_rabbit',
      targetId: 'ent_fox',
      source: 'Rabbit',
      target: 'Fox',
      label: 'chatting with',
      alternatives: [{ name: 'debating with' }, { name: 'hidden rivalry with' }],
      status: 'confirmed',
      provenance: 'prompt-explicit',
    },
    {
      id: 'rel_cat_table',
      sourceId: 'ent_cat',
      targetId: 'ent_table',
      source: 'Cat',
      target: 'Banquet Table',
      label: 'presiding over',
      alternatives: [{ name: 'sitting at' }, { name: 'serving dishes at' }],
      status: 'confirmed',
      provenance: 'prompt-explicit',
    },
    {
      id: 'rel_table_conservatory',
      sourceId: 'ent_table',
      targetId: 'ent_conservatory',
      source: 'Banquet Table',
      target: 'Conservatory Dining Room',
      label: 'set inside',
      alternatives: [{ name: 'centerpiece of' }],
      status: 'pending',
      provenance: 'ai-inferred',
    },
  ];

  const clarifications: Clarification[] = [
    {
      id: 'clar_cat_personality',
      question: "What is the cat's personality as the party host?",
      options: ['Gracious and attentive', 'Mischievous', 'Mysterious and observant', 'Fussy perfectionist'],
      target: {
        type: 'entity_attribute',
        entityId: 'ent_cat',
        entityName: 'Cat',
        attributeName: 'personality',
      },
      category: 'character',
      impact: 'Shapes how the Cat interacts with every guest around the table.',
      status: 'unanswered',
    },
    {
      id: 'clar_party_tone',
      question: 'What overall tone and atmosphere should the dinner party have?',
      options: ['Warm and whimsical', 'Mysterious with hidden secrets', 'Lively comedic banter', 'Cozy autumn nostalgia'],
      target: {
        type: 'story_bible',
        storyField: 'tone',
      },
      category: 'tone',
      impact: 'Determines the narrative mood, dialogue style, and pacing.',
      status: 'unanswered',
    },
    {
      id: 'clar_party_setting',
      question: 'Where is the cat hosting this gathering?',
      options: [
        'Lantern-lit conservatory dining room',
        'Sunlit garden under string lights',
        'Snowy mountain cabin by a fireplace',
        'Hollowed-out ancient oak treehouse',
      ],
      target: {
        type: 'story_bible',
        storyField: 'setting',
      },
      category: 'setting',
      impact: 'Establishes the sensory backdrop and environmental details.',
      status: 'unanswered',
    },
    {
      id: 'clar_central_conflict',
      question: 'What sparks tension or intrigue during the dinner conversation?',
      options: [
        'A missing heirloom recipe card that someone at the table took',
        'Trying to keep a surprise midnight dish secret from the curious Fox',
        'An unexpected knock at the door from an uninvited Wolf',
        'Purely slice-of-life storytelling with gentle humor',
      ],
      target: {
        type: 'story_bible',
        storyField: 'centralConflict',
      },
      category: 'plot',
      impact: 'Drives the narrative arc of the scene.',
      status: 'unanswered',
    },
  ];

  const snapshot: ProjectSnapshot = {
    originalIdea: SAMPLE_STORY_PROMPT,
    refinedPrompt: '',
    freeformNotes: '',
    mode: 'story',
    entities,
    relationships,
    storyBible,
    clarifications,
    decisions: [],
    answeredQuestions: [],
    skippedQuestions: [],
  };

  snapshot.decisions = buildDecisionInboxFromSnapshot(snapshot);
  snapshot.refinedPrompt = synthesizeRefinedPrompt(snapshot);

  const initialRevisionId = 'rev_initial';
  return {
    schemaVersion: 3,
    id: 'proj_default_cat_party',
    name: 'Cat’s Woodland Dinner Party',
    createdAt: now,
    updatedAt: now,
    revision: 1,
    persistedRevision: 1,
    snapshot,
    artifacts: [],
    revisions: [
      {
        id: initialRevisionId,
        revisionNumber: 1,
        timestamp: now,
        label: 'Initial Story Plan',
        summary: 'Baseline analysis for "A cat hosting a party for its animal friends"',
        changeCount: 0,
        snapshot: structuredClone(snapshot),
      },
    ],
  };
}

export function buildDecisionInboxFromSnapshot(snapshot: ProjectSnapshot): DecisionItem[] {
  const existingById = new Map(snapshot.decisions.map((d) => [d.id, d]));
  const items: DecisionItem[] = [];
  const now = Date.now();

  // 1. Clarifications (active and resolved)
  for (const clar of snapshot.clarifications) {
    const id = `dec_clar_${clar.id ?? clar.question}`;
    const prev = existingById.get(id);
    if (clar.status === 'answered' || clar.status === 'skipped') {
      if (prev) {
        items.push({
          ...prev,
          status: clar.status === 'answered' ? 'accepted' : 'rejected',
        });
      }
      continue;
    }

    const groupKey =
      clar.category === 'character'
        ? 'character'
        : clar.category === 'setting'
          ? 'setting'
          : clar.category === 'plot'
            ? 'plot'
            : clar.category === 'visual'
              ? 'visual'
              : 'story';

    items.push({
      id,
      category: 'clarification',
      title: clar.question,
      description: clar.impact || 'Clarify this creative detail to enrich the story plan.',
      explanation: clar.outdatedReason
        ? `Note: ${clar.outdatedReason}`
        : clar.target?.entityName
          ? `Targets ${clar.target.entityName}${clar.target.attributeName ? ` → ${clar.target.attributeName}` : ''}`
          : clar.target?.storyField
            ? `Targets Story Bible → ${clar.target.storyField}`
            : 'Clarification question',
      provenance: 'ai-inferred',
      status:
        clar.status === 'outdated'
          ? 'outdated'
          : clar.status === 'deferred'
            ? 'deferred'
            : prev?.status && prev.status !== 'pending'
              ? prev.status
              : 'pending',
      groupKey,
      targetEntityId: clar.target?.entityId,
      targetEntityName: clar.target?.entityName,
      targetAttributeName: clar.target?.attributeName,
      targetStoryField: clar.target?.storyField,
      questionId: clar.id ?? clar.question,
      proposedValue: prev?.proposedValue ?? clar.options[0] ?? '',
      options: clar.options,
      createdAt: prev?.createdAt ?? now,
    });
  }

  // 2. Entity Attributes (inferred by AI or previously resolved via Decision Inbox)
  for (const entity of snapshot.entities) {
    if (entity.excluded || entity.status === 'rejected') continue;
    const isScene = isSceneEntityName(entity.name) || entity.category === 'scene';
    for (const attr of entity.attributes) {
      if (attr.name === 'existence' || attr.name === 'existence_in_image') continue;
      const id = `dec_attr_${entity.id ?? entity.name}_${attr.name}`;
      const prev = existingById.get(id);

      if (attr.status === 'confirmed' || attr.status === 'rejected') {
        if (prev && (prev.status === 'accepted' || prev.status === 'rejected')) {
          items.push({
            ...prev,
            status: attr.status === 'confirmed' ? 'accepted' : 'rejected',
            proposedValue: attr.confirmedValue ?? prev.proposedValue,
          });
        }
        continue;
      }
      if (attr.presence_in_prompt && attr.confirmedValue) continue;

      const candidateVal = attr.confirmedValue ?? attr.value[0]?.name;
      if (!candidateVal || candidateVal === 'Unknown') continue;

      // Avoid duplicating if an active pending clarification already targets this exact entity+attribute
      const coveredByClar = items.some(
        (d) =>
          d.category === 'clarification' &&
          d.status === 'pending' &&
          d.targetEntityName?.toLowerCase() === entity.name.toLowerCase() &&
          d.targetAttributeName?.toLowerCase() === attr.name.toLowerCase()
      );
      if (coveredByClar) continue;

      items.push({
        id,
        category: isScene ? 'story-bible' : 'attribute',
        title: `${entity.name}: ${attr.name.replace(/_/g, ' ')}`,
        description: `Suggested value: "${prev?.proposedValue ?? candidateVal}"`,
        explanation: entity.presence_in_prompt
          ? `Inferred attribute for explicit entity "${entity.name}".`
          : `Suggested attribute for inferred entity "${entity.name}".`,
        provenance: attr.provenance ?? 'ai-inferred',
        status: prev?.status ?? 'pending',
        groupKey: isScene
          ? 'story'
          : entity.category === 'character' || entity.category === 'group'
            ? 'character'
            : entity.category === 'location'
              ? 'setting'
              : 'plot',
        targetEntityId: entity.id,
        targetEntityName: entity.name,
        targetAttributeName: attr.name,
        currentValue: attr.confirmedValue ?? 'Unconfirmed',
        proposedValue: prev?.proposedValue ?? candidateVal,
        options: attr.value.map((v) => v.name),
        createdAt: prev?.createdAt ?? now,
      });
    }
  }

  // 3. Inferred / Pending Relationships (and previously resolved relationship decisions)
  const entityById = new Map(snapshot.entities.map((e) => [e.id, e]));
  for (const rel of snapshot.relationships) {
    const srcEnt = rel.sourceId ? entityById.get(rel.sourceId) : undefined;
    const tgtEnt = rel.targetId ? entityById.get(rel.targetId) : undefined;
    if (srcEnt?.excluded || tgtEnt?.excluded) continue;

    const relId = rel.id ?? `rel_${rel.source}_${rel.target}_${rel.label}`;
    const id = `dec_rel_${relId}`;
    const prev = existingById.get(id);

    if (rel.status === 'confirmed' || rel.status === 'rejected') {
      if (prev && (prev.status === 'accepted' || prev.status === 'rejected')) {
        items.push({
          ...prev,
          status: rel.status === 'confirmed' ? 'accepted' : 'rejected',
          proposedValue: rel.label,
        });
      }
      continue;
    }

    const srcName = srcEnt?.name ?? rel.source;
    const tgtName = tgtEnt?.name ?? rel.target;
    const options = Array.from(
      new Set([rel.label, ...(rel.alternatives?.map((a) => a.name) ?? [])])
    );

    items.push({
      id,
      category: 'relationship',
      title: `${srcName} → ${tgtName}`,
      description: `Suggested relationship: "${prev?.proposedValue ?? rel.label}"`,
      explanation: `AI-inferred directed relationship from "${srcName}" to "${tgtName}".`,
      provenance: rel.provenance ?? 'ai-inferred',
      status: prev?.status ?? 'pending',
      groupKey: 'character',
      targetRelationshipId: rel.id,
      targetSourceEntityName: srcName,
      targetTargetEntityName: tgtName,
      currentValue: 'Unconfirmed',
      proposedValue: prev?.proposedValue ?? rel.label,
      options,
      createdAt: prev?.createdAt ?? now,
    });
  }

  // 4. Preserve any explicitly staged conflict, batch-operation, or terminal decisions not already in items
  for (const existing of snapshot.decisions) {
    if (!items.some((i) => i.id === existing.id)) {
      if (
        existing.category === 'conflict' ||
        existing.category === 'batch-operation' ||
        existing.status === 'accepted' ||
        existing.status === 'rejected' ||
        existing.status === 'deferred'
      ) {
        items.push(existing);
      }
    }
  }

  return items;
}

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

function isUserClearedStoryField(entry: { value: string; provenance?: DecisionProvenance }): boolean {
  return entry.provenance === 'user-edit' && entry.value.trim().length === 0;
}

export function syncStoryBibleWithSceneEntity(snapshot: ProjectSnapshot): ProjectSnapshot {
  const next = structuredClone(snapshot);
  const { sceneEntity } = splitSceneAndObjectEntities(next.entities);
  const now = Date.now();

  if (sceneEntity) {
    for (const attr of sceneEntity.attributes) {
      const mappedField = SCENE_ATTR_TO_BIBLE_FIELD[attr.name.toLowerCase()];
      if (!mappedField) continue;
      const bibleEntry = next.storyBible[mappedField];
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
        continue;
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
        if (!attr.value.some((v) => v.name === cleanVal)) {
          attr.value = [{ name: cleanVal }, ...attr.value];
        }
      } else if (attr.status === 'confirmed' && attrVal.trim()) {
        next.storyBible[mappedField] = {
          value: attrVal.trim(),
          status: 'confirmed',
          provenance: attr.provenance ?? 'user-edit',
          updatedAt: attrUpdatedAt || bibleEntry.updatedAt || now,
        };
      } else if (!bibleEntry.value.trim() && attrVal.trim()) {
        next.storyBible[mappedField] = {
          value: attrVal.trim(),
          status: attr.status ?? 'pending',
          provenance: attr.provenance ?? 'ai-inferred',
          updatedAt: attrUpdatedAt || bibleEntry.updatedAt || now,
        };
      }
    }
  }

  // Also ensure exclusions list reflects excluded entities
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

  return next;
}

export function setEntityAttribute(
  snapshot: ProjectSnapshot,
  entityIdOrName: string,
  attributeName: string,
  newValue: string,
  provenance: DecisionProvenance = 'user-edit'
): ProjectSnapshot {
  let next = structuredClone(snapshot);
  const now = Date.now();
  const normTarget = entityIdOrName.trim().toLowerCase();
  const entity = next.entities.find(
    (e) =>
      e.id === entityIdOrName ||
      e.name.trim().toLowerCase() === normTarget ||
      e.aliases?.some((a) => a.trim().toLowerCase() === normTarget)
  );

  if (!entity) return next;

  const isExistence =
    attributeName === 'existence' || attributeName === 'existence_in_image';
  if (isExistence) {
    return setEntityExistence(next, entity.id ?? entity.name, newValue === 'true', provenance);
  }

  const normAttr = attributeName.trim().toLowerCase();
  const mappedBibleField = isSceneEntityName(entity.name)
    ? SCENE_ATTR_TO_BIBLE_FIELD[normAttr]
    : undefined;
  let attr = entity.attributes.find((a) => a.name.trim().toLowerCase() === normAttr);
  if (attr && newValue === (attr.confirmedValue ?? '') && provenance === 'user-edit') return snapshot;
  const monotonicNow = Math.max(
    now,
    (attr?.updatedAt ?? 0) + 1,
    mappedBibleField ? (next.storyBible[mappedBibleField]?.updatedAt ?? 0) + 1 : 0
  );
  const isClearingSceneAttr = Boolean(mappedBibleField && newValue.trim().length === 0);

  if (!attr) {
    attr = {
      id: makeStableId('attr'),
      name: attributeName.trim(),
      presence_in_prompt: false,
      value: isClearingSceneAttr ? [] : [{ name: newValue }],
      confirmedValue: isClearingSceneAttr ? undefined : newValue,
      status: isClearingSceneAttr ? 'pending' : 'confirmed',
      provenance,
      updatedAt: monotonicNow,
    };
    entity.attributes.push(attr);
  } else {
    attr.confirmedValue = isClearingSceneAttr ? undefined : newValue;
    attr.status = isClearingSceneAttr ? 'pending' : 'confirmed';
    attr.provenance = provenance;
    attr.updatedAt = monotonicNow;
    if (provenance === 'user-edit' && (attr.sourceBacked || attr.epistemicKind)) attr.epistemicKind = 'user-authored';
    if (isClearingSceneAttr) {
      attr.value = [];
    } else if (!attr.value.some((v) => v.name === newValue)) {
      attr.value = [{ name: newValue }, ...attr.value];
    } else {
      attr.value = [
        { name: newValue },
        ...attr.value.filter((v) => v.name !== newValue),
      ];
    }
  }

  if (isClearingSceneAttr && mappedBibleField) {
    next.storyBible[mappedBibleField] = {
      value: '',
      status: 'pending',
      provenance,
      updatedAt: monotonicNow,
    };
  }

  entity.status = 'confirmed';

  // Mark matching decisions as accepted
  next.decisions = next.decisions.map((dec) => {
    if (
      (dec.targetEntityId === entity.id ||
        dec.targetEntityName?.toLowerCase() === entity.name.toLowerCase()) &&
      dec.targetAttributeName?.toLowerCase() === normAttr
    ) {
      return { ...dec, proposedValue: newValue, status: 'accepted' };
    }
    return dec;
  });

  // Mark matching clarifications as answered
  next.clarifications = next.clarifications.map((clar) => {
    if (
      clar.target?.type === 'entity_attribute' &&
      (clar.target.entityId === entity.id ||
        clar.target.entityName?.toLowerCase() === entity.name.toLowerCase()) &&
      clar.target.attributeName?.toLowerCase() === normAttr
    ) {
      return { ...clar, status: 'answered' };
    }
    return clar;
  });

  next = syncStoryBibleWithSceneEntity(next);
  next.decisions = buildDecisionInboxFromSnapshot(next);
  next.refinedPrompt = synthesizeRefinedPrompt(next);
  return next;
}

export function setEntityExistence(
  snapshot: ProjectSnapshot,
  entityIdOrName: string,
  exists: boolean,
  provenance: DecisionProvenance = 'user-edit'
): ProjectSnapshot {
  let next = structuredClone(snapshot);
  const now = Date.now();
  const normTarget = entityIdOrName.trim().toLowerCase();
  const entity = next.entities.find(
    (e) =>
      e.id === entityIdOrName ||
      e.name.trim().toLowerCase() === normTarget ||
      e.aliases?.some((a) => a.trim().toLowerCase() === normTarget)
  );
  if (!entity) return next;

  entity.excluded = !exists;
  entity.status = 'confirmed';
  entity.provenance = provenance;

  let exAttr = entity.attributes.find(
    (a) => a.name === 'existence' || a.name === 'existence_in_image'
  );
  const strVal = exists ? 'true' : 'false';
  if (!exAttr) {
    exAttr = {
      id: makeStableId('attr'),
      name: 'existence',
      presence_in_prompt: entity.presence_in_prompt,
      value: [{ name: 'true' }, { name: 'false' }],
      confirmedValue: strVal,
      status: 'confirmed',
      provenance,
      updatedAt: now,
    };
    entity.attributes.unshift(exAttr);
  } else {
    exAttr.confirmedValue = strVal;
    exAttr.status = 'confirmed';
    exAttr.provenance = provenance;
    exAttr.updatedAt = now;
    exAttr.value = [{ name: strVal }, { name: exists ? 'false' : 'true' }];
  }

  next = syncStoryBibleWithSceneEntity(next);
  next.decisions = buildDecisionInboxFromSnapshot(next);
  next.refinedPrompt = synthesizeRefinedPrompt(next);
  return next;
}

export function renameEntity(
  snapshot: ProjectSnapshot,
  entityIdOrOldName: string,
  newName: string,
  provenance: DecisionProvenance = 'user-edit'
): ProjectSnapshot {
  const trimmedNew = newName.trim();
  if (!trimmedNew) return snapshot;

  const next = structuredClone(snapshot);
  const normTarget = entityIdOrOldName.trim().toLowerCase();
  const entity = next.entities.find(
    (e) =>
      e.id === entityIdOrOldName ||
      e.name.trim().toLowerCase() === normTarget
  );
  if (!entity) return next;

  const oldName = entity.name;
  if (oldName === trimmedNew) return next;

  entity.aliases = Array.from(new Set([...(entity.aliases ?? []), oldName]));
  entity.name = trimmedNew;
  entity.status = 'confirmed';
  entity.provenance = provenance;

  // Update all relationships referencing this entity by ID or old name
  for (const rel of next.relationships) {
    if (rel.sourceId === entity.id || rel.source.toLowerCase() === oldName.toLowerCase()) {
      rel.sourceId = entity.id;
      rel.source = trimmedNew;
    }
    if (rel.targetId === entity.id || rel.target.toLowerCase() === oldName.toLowerCase()) {
      rel.targetId = entity.id;
      rel.target = trimmedNew;
    }
  }

  // Update clarification targets referencing this entity
  for (const clar of next.clarifications) {
    if (
      clar.target &&
      (clar.target.entityId === entity.id ||
        clar.target.entityName?.toLowerCase() === oldName.toLowerCase())
    ) {
      clar.target.entityId = entity.id;
      clar.target.entityName = trimmedNew;
    }
  }

  next.decisions = buildDecisionInboxFromSnapshot(next);
  next.refinedPrompt = synthesizeRefinedPrompt(next);
  return next;
}

export function addEntity(
  snapshot: ProjectSnapshot,
  name: string,
  category: EntityCategory = 'character',
  description: string = '',
  provenance: DecisionProvenance = 'user-edit',
  initialAttributes: Record<string, string> = {}
): ProjectSnapshot {
  const trimmed = name.trim();
  if (!trimmed) return snapshot;

  let next = structuredClone(snapshot);
  const existing = next.entities.find(
    (e) => e.name.toLowerCase() === trimmed.toLowerCase()
  );
  if (existing) {
    existing.excluded = false;
    existing.status = 'confirmed';
    if (description) existing.description = description;
    for (const [k, v] of Object.entries(initialAttributes)) {
      next = setEntityAttribute(next, existing.id ?? existing.name, k, v, provenance);
    }
    next.decisions = buildDecisionInboxFromSnapshot(next);
    next.refinedPrompt = synthesizeRefinedPrompt(next);
    return next;
  }

  const now = Date.now();
  const newEntity: Entity = {
    id: makeStableId('ent'),
    name: trimmed,
    category,
    presence_in_prompt: false,
    description: description || `${category} added to the story plan.`,
    alternatives: [],
    status: 'confirmed',
    provenance,
    excluded: false,
    attributes: [
      {
        id: makeStableId('attr'),
        name: 'existence',
        presence_in_prompt: false,
        value: [{ name: 'true' }, { name: 'false' }],
        confirmedValue: 'true',
        status: 'confirmed',
        provenance,
        updatedAt: now,
      },
      ...Object.entries(initialAttributes).map(([attrName, attrVal]) => ({
        id: makeStableId('attr'),
        name: attrName,
        presence_in_prompt: false,
        value: [{ name: attrVal }],
        confirmedValue: attrVal,
        status: 'confirmed' as ApprovalStatus,
        provenance,
        updatedAt: now,
      })),
    ],
  };

  next.entities.push(newEntity);
  next.decisions = buildDecisionInboxFromSnapshot(next);
  next.refinedPrompt = synthesizeRefinedPrompt(next);
  return next;
}

export function upsertRelationship(
  snapshot: ProjectSnapshot,
  sourceNameOrId: string,
  targetNameOrId: string,
  newLabel: string,
  provenance: DecisionProvenance = 'user-edit',
  options?: {
    relationshipId?: string;
    status?: ApprovalStatus;
    replaceSameDirectionSingle?: boolean;
  }
): ProjectSnapshot {
  const trimmedLabel = newLabel.trim();
  if (!trimmedLabel) return snapshot;

  const next = structuredClone(snapshot);
  const findEnt = (ref: string) =>
    next.entities.find(
      (e) =>
        e.id === ref ||
        e.name.toLowerCase() === ref.trim().toLowerCase() ||
        e.aliases?.some((a) => a.toLowerCase() === ref.trim().toLowerCase())
    );

  const sourceEnt = findEnt(sourceNameOrId);
  const targetEnt = findEnt(targetNameOrId);
  const sourceName = sourceEnt?.name ?? sourceNameOrId.trim();
  const targetName = targetEnt?.name ?? targetNameOrId.trim();
  if (
    (sourceEnt?.id && targetEnt?.id && sourceEnt.id === targetEnt.id) ||
    sourceName.toLowerCase() === targetName.toLowerCase()
  ) {
    return snapshot;
  }
  const desiredStatus: ApprovalStatus = options?.status ?? 'confirmed';

  // Directed multigraph lookup: never match reverse direction (target -> source)!
  const matchesSameDirection = (r: Relationship) =>
    (r.sourceId && sourceEnt?.id && r.sourceId === sourceEnt.id && r.targetId === targetEnt?.id) ||
    (r.source.toLowerCase() === sourceName.toLowerCase() &&
      r.target.toLowerCase() === targetName.toLowerCase());

  let existing: Relationship | undefined;
  if (options?.relationshipId) {
    existing = next.relationships.find((r) => r.id === options.relationshipId);
  }
  if (!existing) {
    // Exact directed + label match
    existing = next.relationships.find(
      (r) =>
        matchesSameDirection(r) &&
        r.label.trim().toLowerCase() === trimmedLabel.toLowerCase()
    );
  }
  if (!existing && options?.replaceSameDirectionSingle) {
    const sameDir = next.relationships.filter(matchesSameDirection);
    if (sameDir.length === 1) {
      existing = sameDir[0];
    }
  }

  if (existing) {
    existing.sourceId = sourceEnt?.id ?? existing.sourceId;
    existing.targetId = targetEnt?.id ?? existing.targetId;
    existing.source = sourceName;
    existing.target = targetName;
    existing.label = trimmedLabel;
    existing.status = desiredStatus;
    existing.provenance = provenance;
    if (!existing.alternatives?.some((a) => a.name === trimmedLabel)) {
      existing.alternatives = [{ name: trimmedLabel }, ...(existing.alternatives ?? [])];
    }
  } else {
    next.relationships.push({
      id: options?.relationshipId ?? makeStableId('rel'),
      sourceId: sourceEnt?.id,
      targetId: targetEnt?.id,
      source: sourceName,
      target: targetName,
      label: trimmedLabel,
      alternatives: [{ name: trimmedLabel }],
      status: desiredStatus,
      provenance,
    });
  }

  next.decisions = buildDecisionInboxFromSnapshot(next);
  next.refinedPrompt = synthesizeRefinedPrompt(next);
  return next;
}

export function updateRelationshipById(
  snapshot: ProjectSnapshot,
  relationshipId: string,
  updates: {
    label?: string;
    status?: ApprovalStatus;
    reverseDirection?: boolean;
  },
  provenance: DecisionProvenance = 'user-edit'
): ProjectSnapshot {
  const next = structuredClone(snapshot);
  const rel = next.relationships.find((r) => r.id === relationshipId);
  if (!rel) return snapshot;

  if (updates.reverseDirection) {
    const prevSource = rel.source;
    const prevSourceId = rel.sourceId;
    rel.source = rel.target;
    rel.sourceId = rel.targetId;
    rel.target = prevSource;
    rel.targetId = prevSourceId;
  }

  if (updates.label !== undefined && updates.label.trim()) {
    const trimmed = updates.label.trim();
    const changed = trimmed !== rel.label || Boolean(updates.reverseDirection);
    rel.label = trimmed;
    if (changed && provenance === 'user-edit' && (rel.sourceBacked || rel.epistemicKind)) rel.epistemicKind = 'user-authored';
    if (!rel.alternatives?.some((a) => a.name === trimmed)) {
      rel.alternatives = [{ name: trimmed }, ...(rel.alternatives ?? [])];
    }
  }

  if (updates.status !== undefined) {
    rel.status = updates.status;
  } else {
    rel.status = 'confirmed';
  }
  rel.provenance = provenance;

  next.decisions = buildDecisionInboxFromSnapshot(next);
  next.refinedPrompt = synthesizeRefinedPrompt(next);
  return next;
}

export function removeRelationship(
  snapshot: ProjectSnapshot,
  sourceNameOrId: string,
  targetNameOrId?: string,
  label?: string
): ProjectSnapshot {
  const next = structuredClone(snapshot);
  if (!targetNameOrId) {
    next.relationships = next.relationships.filter((r) => r.id !== sourceNameOrId);
  } else {
    const sLower = sourceNameOrId.trim().toLowerCase();
    const tLower = targetNameOrId.trim().toLowerCase();
    const labelLower = label?.trim().toLowerCase();
    next.relationships = next.relationships.filter((r) => {
      const sameDir =
        (r.sourceId?.toLowerCase() === sLower || r.source.toLowerCase() === sLower) &&
        (r.targetId?.toLowerCase() === tLower || r.target.toLowerCase() === tLower);
      if (!sameDir) return true;
      if (labelLower && r.label.trim().toLowerCase() !== labelLower) return true;
      return false;
    });
  }
  next.decisions = buildDecisionInboxFromSnapshot(next);
  next.refinedPrompt = synthesizeRefinedPrompt(next);
  return next;
}

export function isRelationshipExplicitInPrompt(
  sourceName: string,
  label: string,
  targetName: string,
  originalIdea: string,
  rawPresenceFlag?: boolean
): boolean {
  if (rawPresenceFlag === false) return false;
  const promptLower = originalIdea.toLowerCase();
  if (!promptLower.trim()) return false;

  const cleanEndpoint = (n: string) =>
    n.toLowerCase().replace(/^(the|a|an)\s+/, '').trim();
  const srcClean = cleanEndpoint(sourceName);
  const tgtClean = cleanEndpoint(targetName);

  // Check if the label words (ignoring common prepositions) appear in the prompt
  const stopWords = new Set(['of', 'to', 'with', 'for', 'in', 'on', 'at', 'by', 'from', 'the', 'a', 'an', 'is', 'are']);
  const labelTokens = label
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((tok) => tok.length > 2 && !stopWords.has(tok));

  if (labelTokens.length === 0) return Boolean(rawPresenceFlag);

  const hasLabelToken = labelTokens.some((tok) => {
    const stem = tok.replace(/(ing|ed|es|s)$/, '');
    return stem.length >= 3 ? promptLower.includes(stem) : promptLower.includes(tok);
  });

  if (!hasLabelToken) return false;

  // At least one of the endpoints (or a collective noun like "friends"/"animals") should be in the prompt
  const hasSource = srcClean.length > 0 && promptLower.includes(srcClean);
  const hasTarget =
    (tgtClean.length > 0 && promptLower.includes(tgtClean)) ||
    promptLower.includes('friends') ||
    promptLower.includes('animals') ||
    promptLower.includes('guests');

  return hasSource && hasTarget;
}

export function updateStoryBibleField(
  snapshot: ProjectSnapshot,
  field: keyof StoryBibleFields,
  value: string,
  provenance: DecisionProvenance = 'user-edit'
): ProjectSnapshot {
  const validation = validateStoryBibleUpdate(field, value);
  if (!validation.ok) {
    return snapshot;
  }

  const next = structuredClone(snapshot);
  const { sceneEntity } = splitSceneAndObjectEntities(next.entities);
  const mappedAliases = new Set(STORY_FIELD_TO_SCENE_ATTRS[field] ?? []);
  let maxSceneAttrUpdatedAt = 0;
  if (sceneEntity) {
    for (const attr of sceneEntity.attributes) {
      if (
        mappedAliases.has(attr.name.toLowerCase()) ||
        SCENE_ATTR_TO_BIBLE_FIELD[attr.name.toLowerCase()] === field
      ) {
        maxSceneAttrUpdatedAt = Math.max(maxSceneAttrUpdatedAt, attr.updatedAt ?? 0);
      }
    }
  }

  const now = Math.max(
    Date.now(),
    (next.storyBible[field]?.updatedAt ?? 0) + 1,
    maxSceneAttrUpdatedAt + 1
  );

  if (validation.intent === 'clear') {
    next.storyBible[field] = {
      value: '',
      status: 'pending',
      provenance,
      updatedAt: now,
    };

    if (sceneEntity) {
      for (const attr of sceneEntity.attributes) {
        if (
          mappedAliases.has(attr.name.toLowerCase()) ||
          SCENE_ATTR_TO_BIBLE_FIELD[attr.name.toLowerCase()] === field
        ) {
          attr.confirmedValue = undefined;
          attr.status = 'pending';
          attr.provenance = provenance;
          attr.updatedAt = now;
          attr.value = [];
        }
      }
    }

    // Never mark unanswered clarifications as 'answered' when clearing a Story Bible field (R4 / SB-04)
    next.decisions = buildDecisionInboxFromSnapshot(next);
    next.refinedPrompt = synthesizeRefinedPrompt(next);
    return next;
  }

  const storedValue = validation.normalized;
  const displayValue = storedValue.trim();
  const priorField = next.storyBible[field];
  if (priorField.value === storedValue && priorField.status === 'confirmed' && provenance === 'user-edit') return snapshot;
  next.storyBible[field] = {
    value: storedValue,
    status: 'confirmed',
    provenance,
    updatedAt: now,
    ...(provenance === 'user-edit' && (priorField.sourceBacked || priorField.epistemicKind) ? { epistemicKind: 'user-authored' as const } : {}),
  };

  // Synchronize back to "The Story" / "The Image" scene entity and all mapped alias attributes
  const primaryAttrName = STORY_FIELD_TO_SCENE_ATTRS[field]?.[0];
  if (sceneEntity && primaryAttrName) {
    let updatedAny = false;
    for (const attr of sceneEntity.attributes) {
      if (
        mappedAliases.has(attr.name.toLowerCase()) ||
        SCENE_ATTR_TO_BIBLE_FIELD[attr.name.toLowerCase()] === field
      ) {
        attr.confirmedValue = displayValue;
        attr.status = 'confirmed';
        attr.provenance = provenance;
        attr.updatedAt = now;
        if (!attr.value.some((v) => v.name === displayValue)) {
          attr.value = [{ name: displayValue }, ...attr.value];
        }
        updatedAny = true;
      }
    }
    if (!updatedAny) {
      sceneEntity.attributes.push({
        id: makeStableId('attr'),
        name: primaryAttrName,
        presence_in_prompt: false,
        value: [{ name: displayValue }],
        confirmedValue: displayValue,
        status: 'confirmed',
        provenance,
        updatedAt: now,
      });
    }
  }

  // Mark matching clarifications as answered only for non-empty values
  next.clarifications = next.clarifications.map((c) => {
    if (c.target?.type === 'story_bible' && c.target.storyField === field) {
      return { ...c, status: 'answered' };
    }
    return c;
  });

  next.decisions = buildDecisionInboxFromSnapshot(next);
  next.refinedPrompt = synthesizeRefinedPrompt(next);
  return next;
}

/**
 * Reconciles new AI analysis (BeliefGraph + Clarifications) with the existing canonical snapshot.
 * Strictly enforces User Authority:
 * - Never overwrites confirmed attribute values, confirmed entity renames, or explicit exclusions.
 * - Never resurrects rejected attributes or rejected relationships.
 * - Marks AI-inferred relationships not explicitly stated in originalIdea as status: 'pending'.
 * - Deduplicates clarifications by semantic target and preserves stable clarification IDs and draft answers.
 */
export function mergeAnalysisIntoSnapshot(
  current: ProjectSnapshot,
  incomingGraph: BeliefState | null,
  incomingClarifications: Clarification[] | null,
  pendingDraftAnswers: Record<string, string> = {}
): ProjectSnapshot {
  let next = structuredClone(current);
  const now = Date.now();

  if (incomingGraph) {
    const existingEntities = next.entities;

    for (const rawEnt of incomingGraph.entities) {
      const canonicalName = getCanonicalEntityName(rawEnt.name, existingEntities);
      const matched = canonicalName
        ? existingEntities.find((e) => e.name === canonicalName)
        : existingEntities.find(
            (e) =>
              e.name.toLowerCase() === rawEnt.name.toLowerCase() ||
              e.aliases?.some((a) => a.toLowerCase() === rawEnt.name.toLowerCase())
          );

      if (matched) {
        // Preserve confirmed exclusion or rejection!
        if (matched.excluded || matched.status === 'rejected') {
          continue;
        }
        if (!matched.description && rawEnt.description) {
          matched.description = rawEnt.description;
        }
        if (!matched.category) {
          matched.category = inferEntityCategory(rawEnt);
        }

        // Merge attributes without overwriting confirmed, rejected, or user-cleared scene attributes
        const matchedIsScene = isSceneEntityName(matched.name) || matched.category === 'scene';
        for (const rawAttr of rawEnt.attributes) {
          const mappedField = matchedIsScene
            ? SCENE_ATTR_TO_BIBLE_FIELD[rawAttr.name.toLowerCase()]
            : undefined;
          const mappedFieldClearedByUser = Boolean(
            mappedField && isUserClearedStoryField(next.storyBible[mappedField])
          );

          const existingAttr = matched.attributes.find(
            (a) => a.name.toLowerCase() === rawAttr.name.toLowerCase()
          );
          if (existingAttr) {
            if (existingAttr.status === 'rejected' || mappedFieldClearedByUser) {
              // Never resurrect rejected attributes or user-cleared Story Bible scene properties
              continue;
            }
            if (existingAttr.status === 'confirmed') {
              // Keep confirmed value, only append new alternative candidates
              const existingNames = new Set(existingAttr.value.map((v) => v.name));
              for (const cand of rawAttr.value) {
                if (!existingNames.has(cand.name)) {
                  existingAttr.value.push(cand);
                }
              }
            } else {
              existingAttr.value = rawAttr.value;
              existingAttr.presence_in_prompt = rawAttr.presence_in_prompt;
            }
          } else {
            if (mappedFieldClearedByUser) {
              continue;
            }
            matched.attributes.push({
              id: makeStableId('attr'),
              name: rawAttr.name,
              presence_in_prompt: rawAttr.presence_in_prompt,
              value: rawAttr.value,
              confirmedValue: rawAttr.presence_in_prompt ? rawAttr.value[0]?.name : undefined,
              status: rawAttr.presence_in_prompt ? 'confirmed' : 'pending',
              provenance: rawAttr.presence_in_prompt ? 'prompt-explicit' : 'ai-inferred',
              updatedAt: now,
            });
          }
        }
      } else {
        // New entity discovered by AI
        const category = inferEntityCategory(rawEnt);
        const newEntity: Entity = {
          id: makeStableId('ent'),
          name: rawEnt.name,
          category,
          presence_in_prompt: rawEnt.presence_in_prompt,
          description: rawEnt.description,
          alternatives: rawEnt.alternatives,
          status: rawEnt.presence_in_prompt ? 'confirmed' : 'pending',
          provenance: rawEnt.presence_in_prompt ? 'prompt-explicit' : 'ai-inferred',
          excluded: false,
          attributes: rawEnt.attributes.map((a): Attribute => ({
            id: makeStableId('attr'),
            name: a.name,
            presence_in_prompt: a.presence_in_prompt,
            value: a.value,
            confirmedValue:
              a.name === 'existence'
                ? 'true'
                : a.presence_in_prompt
                  ? a.value[0]?.name
                  : undefined,
            status: a.presence_in_prompt ? 'confirmed' : 'pending',
            provenance: a.presence_in_prompt ? 'prompt-explicit' : 'ai-inferred',
            updatedAt: now,
          })),
        };
        existingEntities.push(newEntity);
      }
    }

    // Merge relationships as directed multigraph while respecting provenance and rejected status
    for (const rawRel of incomingGraph.relationships) {
      const srcName = getCanonicalEntityName(rawRel.source, existingEntities) ?? rawRel.source;
      const tgtName = getCanonicalEntityName(rawRel.target, existingEntities) ?? rawRel.target;
      const srcEnt = existingEntities.find((e) => e.name === srcName);
      const tgtEnt = existingEntities.find((e) => e.name === tgtName);
      if (!srcEnt || !tgtEnt || srcEnt.id === tgtEnt.id) continue;
      if (srcEnt.excluded || tgtEnt.excluded) continue;
      if (srcEnt.status === 'rejected' || tgtEnt.status === 'rejected') continue;

      const cleanLabel = rawRel.label.trim();
      const sameDirRels = next.relationships.filter(
        (r) =>
          (r.sourceId === srcEnt.id && r.targetId === tgtEnt.id) ||
          (r.source.toLowerCase() === srcEnt.name.toLowerCase() &&
            r.target.toLowerCase() === tgtEnt.name.toLowerCase())
      );

      const exactMatch = sameDirRels.find(
        (r) => r.label.trim().toLowerCase() === cleanLabel.toLowerCase()
      );
      if (exactMatch) {
        if (exactMatch.status === 'rejected') {
          continue;
        }
        if (exactMatch.status !== 'confirmed') {
          exactMatch.alternatives = rawRel.alternatives;
        }
        continue;
      }

      // If any rejected relationship in the same direction existed with this label, skip
      const pendingSameDir = sameDirRels.find((r) => r.status === 'pending');
      if (pendingSameDir) {
        pendingSameDir.label = cleanLabel;
        pendingSameDir.alternatives = rawRel.alternatives;
        continue;
      }

      // If a confirmed relationship already exists in this exact direction, do not overwrite it;
      // only add a new pending proposal if none exists
      if (sameDirRels.some((r) => r.status === 'confirmed' || r.status === 'rejected')) {
        continue;
      }

      const isExplicit = isRelationshipExplicitInPrompt(
        srcEnt.name,
        cleanLabel,
        tgtEnt.name,
        next.originalIdea,
        rawRel.presence_in_prompt
      );

      next.relationships.push({
        id: makeStableId('rel'),
        sourceId: srcEnt.id,
        targetId: tgtEnt.id,
        source: srcEnt.name,
        target: tgtEnt.name,
        label: cleanLabel,
        presence_in_prompt: isExplicit,
        evidenceExcerpt: rawRel.evidenceExcerpt,
        alternatives: rawRel.alternatives,
        status: isExplicit ? 'confirmed' : 'pending',
        provenance: isExplicit ? 'prompt-explicit' : 'ai-inferred',
      });
    }
  }

  if (incomingClarifications) {
    const normalizeQuestion = (q: string) =>
      q.toLowerCase().replace(/[^a-z0-9\s]/g, '').replace(/\s+/g, ' ').trim();

    const getSemanticTargetKey = (clar: Clarification): string | null => {
      if (!clar.target) return null;
      if (clar.target.type === 'story_bible' && clar.target.storyField) {
        return `sb:${clar.target.storyField}`;
      }
      if (clar.target.type === 'entity_attribute' && clar.target.attributeName) {
        const canonicalEntName = clar.target.entityName
          ? getCanonicalEntityName(clar.target.entityName, next.entities) ?? clar.target.entityName
          : '';
        const ent = next.entities.find(
          (e) =>
            (clar.target?.entityId && e.id === clar.target.entityId) ||
            e.name.toLowerCase() === canonicalEntName.toLowerCase()
        );
        const entKey = ent?.id ?? canonicalEntName.toLowerCase();
        if (entKey) {
          return `ent:${entKey}:${clar.target.attributeName.toLowerCase()}`;
        }
      }
      return null;
    };

    const answeredSet = new Set(next.answeredQuestions.map(normalizeQuestion));
    const skippedSet = new Set(next.skippedQuestions.map(normalizeQuestion));
    const resolvedTargetKeys = new Set<string>();

    for (const oldClar of next.clarifications) {
      if (oldClar.status === 'answered' || oldClar.status === 'skipped') {
        answeredSet.add(normalizeQuestion(oldClar.question));
        const tKey = getSemanticTargetKey(oldClar);
        if (tKey) resolvedTargetKeys.add(tKey);
      }
    }

    // Preserve existing clarifications that have pending draft answers or were already answered/deferred
    const preservedClarifications = next.clarifications.filter((c) => {
      if (c.status === 'answered' || c.status === 'skipped' || c.status === 'deferred') {
        return true;
      }
      const draft =
        pendingDraftAnswers[c.id ?? c.question] ??
        pendingDraftAnswers[`dec_clar_${c.id ?? c.question}`] ??
        pendingDraftAnswers[c.question];
      return Boolean(draft && draft.trim().length > 0);
    });

    const mergedClarifications: Clarification[] = [...preservedClarifications];
    const seenNorm = new Set(mergedClarifications.map((c) => normalizeQuestion(c.question)));
    const seenTargets = new Set(
      mergedClarifications.map(getSemanticTargetKey).filter((k): k is string => Boolean(k))
    );

    for (const rawClar of incomingClarifications) {
      const normQ = normalizeQuestion(rawClar.question);
      if (seenNorm.has(normQ) || answeredSet.has(normQ) || skippedSet.has(normQ)) {
        continue;
      }

      // Normalize target entity ID/name first
      if (rawClar.target?.type === 'entity_attribute' && rawClar.target.entityName && rawClar.target.attributeName) {
        const canonicalEntName =
          getCanonicalEntityName(rawClar.target.entityName, next.entities) ?? rawClar.target.entityName;
        const targetEnt = next.entities.find(
          (e) => e.name.toLowerCase() === canonicalEntName.toLowerCase()
        );
        if (targetEnt?.excluded || targetEnt?.status === 'rejected') {
          continue;
        }
        const targetAttr = targetEnt?.attributes.find(
          (a) => a.name.toLowerCase() === rawClar.target?.attributeName?.toLowerCase()
        );
        if (
          (targetAttr?.status === 'confirmed' && targetAttr.confirmedValue) ||
          targetAttr?.status === 'rejected'
        ) {
          continue;
        }
        if (targetEnt) {
          rawClar.target.entityId = targetEnt.id;
          rawClar.target.entityName = targetEnt.name;
        }
      } else if (rawClar.target?.type === 'story_bible' && rawClar.target.storyField) {
        const sbField = next.storyBible[rawClar.target.storyField];
        if ((sbField?.status === 'confirmed' && sbField.value) || sbField?.status === 'rejected') {
          continue;
        }
      }

      const targetKey = getSemanticTargetKey(rawClar);
      if (targetKey && (resolvedTargetKeys.has(targetKey) || seenTargets.has(targetKey))) {
        continue;
      }

      // Reuse stable ID if an unanswered clarification with the same question or semantic target existed
      const priorMatch = next.clarifications.find(
        (c) =>
          normalizeQuestion(c.question) === normQ ||
          (targetKey && getSemanticTargetKey(c) === targetKey)
      );

      seenNorm.add(normQ);
      if (targetKey) seenTargets.add(targetKey);
      mergedClarifications.push({
        ...rawClar,
        id: priorMatch?.id ?? rawClar.id ?? makeStableId('clar'),
        status: priorMatch?.status === 'deferred' ? 'deferred' : 'unanswered',
      });
    }

    next.clarifications = mergedClarifications;
  }

  next = syncStoryBibleWithSceneEntity(next);
  next.decisions = buildDecisionInboxFromSnapshot(next).map((dec) => {
    const draft =
      pendingDraftAnswers[dec.id] ??
      (dec.questionId ? pendingDraftAnswers[dec.questionId] : undefined);
    if (draft && draft.trim().length > 0 && dec.status === 'pending') {
      return {
        ...dec,
        proposedValue: draft.trim(),
      };
    }
    return dec;
  });
  next.refinedPrompt = synthesizeRefinedPrompt(next);
  return next;
}

export function applyDecisionBatch(
  snapshot: ProjectSnapshot,
  decisionIds: string[],
  action: 'accept' | 'reject' | 'defer',
  customValues: Record<string, string> = {}
): { snapshot: ProjectSnapshot; appliedCount: number; conflicts: string[] } {
  let next = structuredClone(snapshot);
  const idSet = new Set(decisionIds);
  const conflicts: string[] = [];
  let appliedCount = 0;

  // Validate upfront for atomic batch behavior
  const targetDecisions = next.decisions.filter((d) => idSet.has(d.id));
  if (targetDecisions.length === 0) {
    return { snapshot: next, appliedCount: 0, conflicts: [] };
  }

  if (action === 'accept') {
    // Check if two selected decisions in the same batch set conflicting values on the same target
    const seenTargets = new Map<string, string>();
    for (const dec of targetDecisions) {
      const valueToApply = (customValues[dec.id] ?? dec.proposedValue).trim();
      if (!valueToApply) continue;
      const targetKey = dec.targetStoryField
        ? `sb:${dec.targetStoryField}`
        : dec.targetRelationshipId
          ? `rel:${dec.targetRelationshipId}`
          : dec.targetEntityName && dec.targetAttributeName
            ? `ent:${dec.targetEntityName.toLowerCase()}:${dec.targetAttributeName.toLowerCase()}`
            : `q:${dec.id}`;
      const prior = seenTargets.get(targetKey);
      if (prior && prior.toLowerCase() !== valueToApply.toLowerCase()) {
        conflicts.push(
          `Conflicting batch selections for ${dec.title}: "${prior}" vs "${valueToApply}".`
        );
      }
      seenTargets.set(targetKey, valueToApply);
    }

    if (conflicts.length > 0) {
      // Atomic abort on batch conflict
      return { snapshot, appliedCount: 0, conflicts };
    }
  }

  for (const dec of targetDecisions) {
    const valueToApply = (customValues[dec.id] ?? dec.proposedValue).trim();

    if (action === 'reject') {
      dec.status = 'rejected';
      if (dec.category === 'clarification' && dec.questionId) {
        const clar = next.clarifications.find(
          (c) => c.id === dec.questionId || c.question === dec.title
        );
        if (clar) {
          clar.status = 'skipped';
          if (!next.skippedQuestions.includes(clar.question)) {
            next.skippedQuestions.push(clar.question);
          }
        }
      } else if (dec.category === 'relationship' && dec.targetRelationshipId) {
        const rel = next.relationships.find((r) => r.id === dec.targetRelationshipId);
        if (rel) {
          rel.status = 'rejected';
        }
      } else if (dec.targetEntityName && dec.targetAttributeName) {
        const ent = next.entities.find(
          (e) =>
            e.id === dec.targetEntityId ||
            e.name.toLowerCase() === dec.targetEntityName?.toLowerCase()
        );
        const attr = ent?.attributes.find(
          (a) => a.name.toLowerCase() === dec.targetAttributeName?.toLowerCase()
        );
        if (attr) attr.status = 'rejected';
      }
      appliedCount++;
    } else if (action === 'defer') {
      dec.status = 'deferred';
      if (dec.category === 'clarification' && dec.questionId) {
        const clar = next.clarifications.find(
          (c) => c.id === dec.questionId || c.question === dec.title
        );
        if (clar) clar.status = 'deferred';
      }
      appliedCount++;
    } else if (action === 'accept' && valueToApply) {
      dec.status = 'accepted';
      dec.proposedValue = valueToApply;

      if (dec.category === 'relationship' && dec.targetRelationshipId) {
        next = updateRelationshipById(
          next,
          dec.targetRelationshipId,
          { label: valueToApply, status: 'confirmed' },
          'accepted-suggestion'
        );
      } else if (dec.targetStoryField) {
        next = updateStoryBibleField(
          next,
          dec.targetStoryField,
          valueToApply,
          'accepted-suggestion'
        );
      } else if (dec.targetEntityId || dec.targetEntityName) {
        const entRef = dec.targetEntityId ?? dec.targetEntityName!;
        const attrName = dec.targetAttributeName ?? 'detail';
        next = setEntityAttribute(
          next,
          entRef,
          attrName,
          valueToApply,
          'accepted-suggestion'
        );
      }

      if (dec.category === 'clarification') {
        const clar = next.clarifications.find(
          (c) => c.id === dec.questionId || c.question === dec.title
        );
        if (clar) {
          clar.status = 'answered';
          if (!next.answeredQuestions.includes(clar.question)) {
            next.answeredQuestions.push(clar.question);
          }
          // If clarification had no structured target, try heuristic target matching or record in Story Bible notes
          if (!dec.targetStoryField && !dec.targetEntityId && !dec.targetEntityName) {
            next = applyUntargetedClarificationAnswer(next, clar.question, valueToApply);
          }
        }
      }
      appliedCount++;
    }
  }

  // Persist status changes onto rebuilt decision list
  const updatedStatusById = new Map(
    targetDecisions.map((d) => [d.id, { status: d.status, val: customValues[d.id] ?? d.proposedValue }])
  );
  next.decisions = buildDecisionInboxFromSnapshot(next).map((d) => {
    const u = updatedStatusById.get(d.id);
    return u ? { ...d, status: u.status, proposedValue: u.val } : d;
  });
  next.refinedPrompt = synthesizeRefinedPrompt(next);

  return { snapshot: next, appliedCount, conflicts: [] };
}

function applyUntargetedClarificationAnswer(
  snapshot: ProjectSnapshot,
  question: string,
  answer: string
): ProjectSnapshot {
  const next = structuredClone(snapshot);
  const qLower = question.toLowerCase();

  // Check if question mentions an entity and attribute
  for (const ent of next.entities) {
    if (isSceneEntityName(ent.name)) continue;
    if (qLower.includes(ent.name.toLowerCase())) {
      if (qLower.includes('personality') || qLower.includes('like') || qLower.includes('behave')) {
        return setEntityAttribute(next, ent.id ?? ent.name, 'personality', answer, 'accepted-suggestion');
      }
      if (qLower.includes('age') || qLower.includes('old') || qLower.includes('young')) {
        return setEntityAttribute(next, ent.id ?? ent.name, 'age', answer, 'accepted-suggestion');
      }
      if (qLower.includes('role') || qLower.includes('motivation') || qLower.includes('goal')) {
        return setEntityAttribute(next, ent.id ?? ent.name, 'motivation', answer, 'accepted-suggestion');
      }
      return setEntityAttribute(next, ent.id ?? ent.name, 'detail', answer, 'accepted-suggestion');
    }
  }

  if (qLower.includes('tone') || qLower.includes('mood') || qLower.includes('atmosphere')) {
    return updateStoryBibleField(next, 'tone', answer, 'accepted-suggestion');
  }
  if (qLower.includes('where') || qLower.includes('setting') || qLower.includes('location')) {
    return updateStoryBibleField(next, 'setting', answer, 'accepted-suggestion');
  }
  if (qLower.includes('conflict') || qLower.includes('problem') || qLower.includes('tension')) {
    return updateStoryBibleField(next, 'centralConflict', answer, 'accepted-suggestion');
  }
  if (qLower.includes('genre')) {
    return updateStoryBibleField(next, 'genre', answer, 'accepted-suggestion');
  }

  const noteLine = `${question} -> ${answer}`;
  if (!next.storyBible.continuityRules.value.includes(noteLine)) {
    const prev = next.storyBible.continuityRules.value;
    next.storyBible.continuityRules = {
      value: prev ? `${prev}\n${noteLine}` : noteLine,
      status: 'confirmed',
      provenance: 'accepted-suggestion',
      updatedAt: Date.now(),
    };
  }
  return next;
}
