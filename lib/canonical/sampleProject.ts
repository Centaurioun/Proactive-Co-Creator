/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { buildDecisionInboxFromSnapshot } from '../decisionInboxProjection.ts';
import { synthesizeRefinedPrompt } from '../promptBuilder.ts';
import type {
  ApprovalStatus,
  Clarification,
  CreativeProject,
  DecisionProvenance,
  Entity,
  ProjectSnapshot,
  Relationship,
  StoryBible,
} from '../../shared/types.ts';

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

function createSampleEntities(): Entity[] {
  return [
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
}

function createSampleRelationships(): Relationship[] {
  return [
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
}

function createSampleClarifications(): Clarification[] {
  return [
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
}

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

  const snapshot: ProjectSnapshot = {
    originalIdea: SAMPLE_STORY_PROMPT,
    refinedPrompt: '',
    freeformNotes: '',
    mode: 'story',
    entities: createSampleEntities(),
    relationships: createSampleRelationships(),
    storyBible,
    clarifications: createSampleClarifications(),
    decisions: [],
    answeredQuestions: [],
    skippedQuestions: [],
  };

  snapshot.decisions = buildDecisionInboxFromSnapshot(snapshot);
  snapshot.refinedPrompt = synthesizeRefinedPrompt(snapshot);

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
        id: 'rev_initial',
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
