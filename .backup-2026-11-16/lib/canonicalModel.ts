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
    schemaVersion: 2,
    id: 'proj_default_cat_party',
    name: 'Cat’s Woodland Dinner Party',
    createdAt: now,
    updatedAt: now,
    snapshot,
    artifacts: [],
    revisions: [
      {
        id: initialRevisionId,
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

  // 1. Unanswered / Pending Clarifications
  for (const clar of snapshot.clarifications) {
    const id = `dec_clar_${clar.id ?? clar.question}`;
    const prev = existingById.get(id);
    if (clar.status === 'answered' || clar.status === 'skipped') {
      if (prev && prev.status === 'accepted') {
        items.push(prev);
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

  // 2. Unconfirmed Entity Attributes (inferred by AI)
  for (const entity of snapshot.entities) {
    if (entity.excluded) continue;
    const isScene = isSceneEntityName(entity.name) || entity.category === 'scene';
    for (const attr of entity.attributes) {
      if (attr.name === 'existence' || attr.name === 'existence_in_image') continue;
      if (attr.status === 'confirmed' || attr.status === 'rejected') continue;
      if (attr.presence_in_prompt && attr.confirmedValue) continue;

      const candidateVal = attr.confirmedValue ?? attr.value[0]?.name;
      if (!candidateVal || candidateVal === 'Unknown') continue;

      const id = `dec_attr_${entity.id ?? entity.name}_${attr.name}`;
      const prev = existingById.get(id);
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

  // 3. Preserve any explicitly staged conflict or batch-operation items still pending
  for (const existing of snapshot.decisions) {
    if (
      (existing.category === 'conflict' || existing.category === 'batch-operation') &&
      !items.some((i) => i.id === existing.id)
    ) {
      items.push(existing);
    }
  }

  return items;
}

export function syncStoryBibleWithSceneEntity(snapshot: ProjectSnapshot): ProjectSnapshot {
  const next = structuredClone(snapshot);
  const { sceneEntity } = splitSceneAndObjectEntities(next.entities);
  const now = Date.now();

  const attrToBibleMap: Record<string, keyof StoryBibleFields> = {
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

  if (sceneEntity) {
    for (const attr of sceneEntity.attributes) {
      const mappedField = attrToBibleMap[attr.name.toLowerCase()];
      if (!mappedField) continue;
      const bibleEntry = next.storyBible[mappedField];
      const attrVal = attr.confirmedValue ?? attr.value[0]?.name ?? '';
      if (attr.status === 'confirmed' && attrVal) {
        next.storyBible[mappedField] = {
          value: attrVal,
          status: 'confirmed',
          provenance: attr.provenance ?? 'user-edit',
          updatedAt: now,
        };
      } else if (!bibleEntry.value && attrVal) {
        next.storyBible[mappedField] = {
          value: attrVal,
          status: attr.status ?? 'pending',
          provenance: attr.provenance ?? 'ai-inferred',
          updatedAt: now,
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
  let attr = entity.attributes.find((a) => a.name.trim().toLowerCase() === normAttr);
  if (!attr) {
    attr = {
      id: makeStableId('attr'),
      name: attributeName.trim(),
      presence_in_prompt: false,
      value: [{ name: newValue }],
      confirmedValue: newValue,
      status: 'confirmed',
      provenance,
      updatedAt: now,
    };
    entity.attributes.push(attr);
  } else {
    attr.confirmedValue = newValue;
    attr.status = 'confirmed';
    attr.provenance = provenance;
    attr.updatedAt = now;
    if (!attr.value.some((v) => v.name === newValue)) {
      attr.value = [{ name: newValue }, ...attr.value];
    } else {
      attr.value = [
        { name: newValue },
        ...attr.value.filter((v) => v.name !== newValue),
      ];
    }
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

  const next = structuredClone(snapshot);
  const existing = next.entities.find(
    (e) => e.name.toLowerCase() === trimmed.toLowerCase()
  );
  if (existing) {
    existing.excluded = false;
    existing.status = 'confirmed';
    if (description) existing.description = description;
    for (const [k, v] of Object.entries(initialAttributes)) {
      return setEntityAttribute(next, existing.id ?? existing.name, k, v, provenance);
    }
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
  provenance: DecisionProvenance = 'user-edit'
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

  const existing = next.relationships.find(
    (r) =>
      (r.sourceId && sourceEnt?.id && r.sourceId === sourceEnt.id && r.targetId === targetEnt?.id) ||
      (r.source.toLowerCase() === sourceName.toLowerCase() &&
        r.target.toLowerCase() === targetName.toLowerCase()) ||
      (r.source.toLowerCase() === targetName.toLowerCase() &&
        r.target.toLowerCase() === sourceName.toLowerCase())
  );

  if (existing) {
    existing.label = trimmedLabel;
    existing.status = 'confirmed';
    existing.provenance = provenance;
    if (!existing.alternatives?.some((a) => a.name === trimmedLabel)) {
      existing.alternatives = [{ name: trimmedLabel }, ...(existing.alternatives ?? [])];
    }
  } else {
    next.relationships.push({
      id: makeStableId('rel'),
      sourceId: sourceEnt?.id,
      targetId: targetEnt?.id,
      source: sourceName,
      target: targetName,
      label: trimmedLabel,
      alternatives: [{ name: trimmedLabel }],
      status: 'confirmed',
      provenance,
    });
  }

  next.decisions = buildDecisionInboxFromSnapshot(next);
  next.refinedPrompt = synthesizeRefinedPrompt(next);
  return next;
}

export function removeRelationship(
  snapshot: ProjectSnapshot,
  sourceNameOrId: string,
  targetNameOrId?: string
): ProjectSnapshot {
  const next = structuredClone(snapshot);
  if (!targetNameOrId) {
    next.relationships = next.relationships.filter((r) => r.id !== sourceNameOrId);
  } else {
    const sLower = sourceNameOrId.trim().toLowerCase();
    const tLower = targetNameOrId.trim().toLowerCase();
    next.relationships = next.relationships.filter(
      (r) =>
        !(
          (r.source.toLowerCase() === sLower && r.target.toLowerCase() === tLower) ||
          (r.source.toLowerCase() === tLower && r.target.toLowerCase() === sLower)
        )
    );
  }
  next.refinedPrompt = synthesizeRefinedPrompt(next);
  return next;
}

export function updateStoryBibleField(
  snapshot: ProjectSnapshot,
  field: keyof StoryBibleFields,
  value: string,
  provenance: DecisionProvenance = 'user-edit'
): ProjectSnapshot {
  const next = structuredClone(snapshot);
  const now = Date.now();
  next.storyBible[field] = {
    value: value.trim(),
    status: 'confirmed',
    provenance,
    updatedAt: now,
  };

  // Synchronize back to "The Story" / "The Image" scene entity if present
  const fieldToSceneAttr: Partial<Record<keyof StoryBibleFields, string>> = {
    genre: 'genre',
    tone: 'tone',
    narrativePerspective: 'narrative_perspective',
    setting: 'setting',
    centralConflict: 'central_conflict',
    pacing: 'pacing',
    visualStyle: 'image_style',
    cameraAndLighting: 'lighting',
  };

  const sceneAttrName = fieldToSceneAttr[field];
  const { sceneEntity } = splitSceneAndObjectEntities(next.entities);
  if (sceneEntity && sceneAttrName && value.trim()) {
    const existingAttr = sceneEntity.attributes.find(
      (a) => a.name.toLowerCase() === sceneAttrName.toLowerCase()
    );
    if (existingAttr) {
      existingAttr.confirmedValue = value.trim();
      existingAttr.status = 'confirmed';
      existingAttr.provenance = provenance;
      existingAttr.updatedAt = now;
      if (!existingAttr.value.some((v) => v.name === value.trim())) {
        existingAttr.value = [{ name: value.trim() }, ...existingAttr.value];
      }
    } else {
      sceneEntity.attributes.push({
        id: makeStableId('attr'),
        name: sceneAttrName,
        presence_in_prompt: false,
        value: [{ name: value.trim() }],
        confirmedValue: value.trim(),
        status: 'confirmed',
        provenance,
        updatedAt: now,
      });
    }
  }

  // Mark matching clarifications as answered
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
 * - Stages new AI discoveries as pending proposals in the Decision Inbox.
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
        // Preserve confirmed exclusion!
        if (matched.excluded) {
          continue;
        }
        if (!matched.description && rawEnt.description) {
          matched.description = rawEnt.description;
        }
        if (!matched.category) {
          matched.category = inferEntityCategory(rawEnt);
        }

        // Merge attributes without overwriting confirmed attributes
        for (const rawAttr of rawEnt.attributes) {
          const existingAttr = matched.attributes.find(
            (a) => a.name.toLowerCase() === rawAttr.name.toLowerCase()
          );
          if (existingAttr) {
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

    // Merge relationships while preserving confirmed relationships and entity renames
    for (const rawRel of incomingGraph.relationships) {
      const srcName = getCanonicalEntityName(rawRel.source, existingEntities) ?? rawRel.source;
      const tgtName = getCanonicalEntityName(rawRel.target, existingEntities) ?? rawRel.target;
      const srcEnt = existingEntities.find((e) => e.name === srcName);
      const tgtEnt = existingEntities.find((e) => e.name === tgtName);
      if (!srcEnt || !tgtEnt || srcEnt.id === tgtEnt.id) continue;
      if (srcEnt.excluded || tgtEnt.excluded) continue;

      const existingRel = next.relationships.find(
        (r) =>
          (r.sourceId === srcEnt.id && r.targetId === tgtEnt.id) ||
          (r.sourceId === tgtEnt.id && r.targetId === srcEnt.id) ||
          (r.source.toLowerCase() === srcName.toLowerCase() &&
            r.target.toLowerCase() === tgtName.toLowerCase())
      );

      if (existingRel) {
        if (existingRel.status !== 'confirmed') {
          existingRel.label = rawRel.label;
          existingRel.alternatives = rawRel.alternatives;
        }
      } else {
        next.relationships.push({
          id: makeStableId('rel'),
          sourceId: srcEnt.id,
          targetId: tgtEnt.id,
          source: srcEnt.name,
          target: tgtEnt.name,
          label: rawRel.label,
          alternatives: rawRel.alternatives,
          status: 'confirmed',
          provenance: 'ai-inferred',
        });
      }
    }
  }

  if (incomingClarifications) {
    const normalizeQuestion = (q: string) =>
      q.toLowerCase().replace(/[^a-z0-9\s]/g, '').replace(/\s+/g, ' ').trim();

    const answeredSet = new Set(next.answeredQuestions.map(normalizeQuestion));
    const skippedSet = new Set(next.skippedQuestions.map(normalizeQuestion));

    // Preserve existing clarifications that have pending draft answers
    const preservedDraftClarifications = next.clarifications.filter((c) => {
      const draft = pendingDraftAnswers[c.id ?? c.question] ?? pendingDraftAnswers[c.question];
      return Boolean(draft && draft.trim().length > 0 && c.status !== 'answered');
    });

    const mergedClarifications: Clarification[] = [...preservedDraftClarifications];
    const seenNorm = new Set(mergedClarifications.map((c) => normalizeQuestion(c.question)));

    for (const rawClar of incomingClarifications) {
      const normQ = normalizeQuestion(rawClar.question);
      if (seenNorm.has(normQ) || answeredSet.has(normQ) || skippedSet.has(normQ)) {
        continue;
      }

      // Check if target attribute or story field is already confirmed
      if (rawClar.target?.type === 'entity_attribute' && rawClar.target.entityName && rawClar.target.attributeName) {
        const targetEnt = next.entities.find(
          (e) => e.name.toLowerCase() === rawClar.target?.entityName?.toLowerCase()
        );
        const targetAttr = targetEnt?.attributes.find(
          (a) => a.name.toLowerCase() === rawClar.target?.attributeName?.toLowerCase()
        );
        if (targetAttr?.status === 'confirmed' && targetAttr.confirmedValue) {
          continue;
        }
        if (targetEnt) {
          rawClar.target.entityId = targetEnt.id;
          rawClar.target.entityName = targetEnt.name;
        }
      } else if (rawClar.target?.type === 'story_bible' && rawClar.target.storyField) {
        const sbField = next.storyBible[rawClar.target.storyField];
        if (sbField?.status === 'confirmed' && sbField.value) {
          continue;
        }
      }

      seenNorm.add(normQ);
      mergedClarifications.push({
        ...rawClar,
        id: rawClar.id ?? makeStableId('clar'),
        status: 'unanswered',
      });
    }

    next.clarifications = mergedClarifications;
  }

  next = syncStoryBibleWithSceneEntity(next);
  next.decisions = buildDecisionInboxFromSnapshot(next);
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

      if (dec.targetStoryField) {
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
