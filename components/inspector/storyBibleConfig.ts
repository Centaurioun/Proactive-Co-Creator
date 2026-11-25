/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import type { StoryBibleFields } from '../../shared/types';

export type StoryBibleDomain = 'core' | 'narrative' | 'constraints' | 'visual';

export interface StoryBibleDomainMeta {
  id: StoryBibleDomain;
  label: string;
  description: string;
}

export interface StoryBibleFieldConfig {
  key: keyof StoryBibleFields;
  label: string;
  shortLabel: string;
  domain: StoryBibleDomain;
  span: 'half' | 'full';
  placeholder: string;
  multiline?: boolean;
  examples?: string[];
}

export const STORY_BIBLE_DOMAINS: StoryBibleDomainMeta[] = [
  {
    id: 'core',
    label: 'World & Atmosphere',
    description: 'Foundational genre, mood, and primary backdrop',
  },
  {
    id: 'narrative',
    label: 'Narrative Arc & Voice',
    description: 'Perspective, pacing, themes, audience, and central tension',
  },
  {
    id: 'constraints',
    label: 'Canon & Exclusions',
    description: 'Continuity rules and elements that must never appear',
  },
  {
    id: 'visual',
    label: 'Visual & Camera Direction',
    description: 'Shared art direction and lighting for Image Mode',
  },
];

export const STORY_BIBLE_CONFIG: StoryBibleFieldConfig[] = [
  {
    key: 'genre',
    label: 'Genre',
    shortLabel: 'Genre',
    domain: 'core',
    span: 'half',
    placeholder: 'e.g. Cozy Anthropomorphic Fable',
    examples: ['Cozy Anthropomorphic Fable', 'Woodland Mystery', 'Whimsical Fantasy'],
  },
  {
    key: 'tone',
    label: 'Tone & Atmosphere',
    shortLabel: 'Tone',
    domain: 'core',
    span: 'half',
    placeholder: 'e.g. Warm and whimsical',
    examples: ['Warm and whimsical', 'Mysterious & candlelit', 'Witty & theatrical'],
  },
  {
    key: 'setting',
    label: 'Primary Setting',
    shortLabel: 'Primary Setting',
    domain: 'core',
    span: 'full',
    placeholder: 'e.g. Lantern-lit conservatory dining room',
    examples: ['Lantern-lit conservatory dining room', 'Sunlit garden under string lights'],
  },
  {
    key: 'narrativePerspective',
    label: 'Narrative Perspective',
    shortLabel: 'Point of View',
    domain: 'narrative',
    span: 'half',
    placeholder: 'e.g. Third-person limited',
    examples: ['Third-person limited', 'Omniscient narrator', 'First-person host'],
  },
  {
    key: 'pacing',
    label: 'Pacing',
    shortLabel: 'Pacing',
    domain: 'narrative',
    span: 'half',
    placeholder: 'e.g. Unhurried conversational',
    examples: ['Unhurried conversational', 'Brisk & comedic', 'Slow-burn suspense'],
  },
  {
    key: 'themes',
    label: 'Themes',
    shortLabel: 'Core Themes',
    domain: 'narrative',
    span: 'half',
    placeholder: 'e.g. Hospitality, friendship',
    examples: ['Hospitality & belonging', 'Hidden secrets among friends'],
  },
  {
    key: 'intendedAudience',
    label: 'Intended Audience',
    shortLabel: 'Audience',
    domain: 'narrative',
    span: 'half',
    placeholder: 'e.g. General readers',
    examples: ['All-ages fable readers', 'Young adult', 'Literary fiction'],
  },
  {
    key: 'centralConflict',
    label: 'Central Conflict',
    shortLabel: 'Central Conflict',
    domain: 'narrative',
    span: 'full',
    placeholder: 'What drives tension or curiosity in the scene?',
    multiline: true,
    examples: ['A missing heirloom recipe card at the table', 'Keeping a midnight dish secret'],
  },
  {
    key: 'continuityRules',
    label: 'Continuity Rules & Plot Notes',
    shortLabel: 'Continuity Rules',
    domain: 'constraints',
    span: 'full',
    placeholder: 'Important canon rules or constraints...',
    multiline: true,
  },
  {
    key: 'explicitExclusions',
    label: 'Explicit Exclusions (Never Include)',
    shortLabel: 'Explicit Exclusions',
    domain: 'constraints',
    span: 'full',
    placeholder: 'Comma-separated items or characters to exclude',
  },
  {
    key: 'visualStyle',
    label: 'Visual Style (Shared for Image Mode)',
    shortLabel: 'Visual Style',
    domain: 'visual',
    span: 'half',
    placeholder: 'e.g. Storybook watercolor',
    examples: ['Storybook watercolor & ink', 'Painterly oil illustration', 'Cinematic 35mm'],
  },
  {
    key: 'cameraAndLighting',
    label: 'Camera & Lighting (Shared for Image Mode)',
    shortLabel: 'Camera & Lighting',
    domain: 'visual',
    span: 'half',
    placeholder: 'e.g. Warm candlelit glow',
    examples: ['Warm lantern glow, eye-level', 'Wide banquet table composition'],
  },
];
