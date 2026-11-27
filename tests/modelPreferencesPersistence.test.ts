import assert from 'node:assert/strict';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import test from 'node:test';
import { ModelPreferencesSection, type ModelPreferencesSectionProps } from '../components/settings/ModelPreferencesSection.tsx';
import type { AiConnectionDescriptor } from '../server/providers/contracts.ts';

test('saved default connection remains selected when restart clears its in-memory catalog', () => {
  const connections: AiConnectionDescriptor[] = [
    {
      id: 'gemini-managed', family: 'gemini', billing: 'host-managed-gemini', state: 'unconfigured',
      selectedModelId: 'gemini-4-hydrogen', models: [], message: 'No host-managed Gemini credential is configured.',
    },
    {
      id: 'chatgpt-plan', family: 'openai', billing: 'chatgpt-plan', state: 'connected',
      models: [], message: 'Using ChatGPT plan access.',
    },
  ];
  const props: ModelPreferencesSectionProps = {
    connections,
    preferences: {
      defaultConnectionId: 'chatgpt-plan',
      defaultTextModelId: 'gpt-6-luna',
      defaultReasoningLevel: 'medium',
      preferredTextModelsByConnection: { 'chatgpt-plan': 'gpt-6-luna' },
      preferredReasoningLevelsByConnection: { 'chatgpt-plan': 'medium' },
    },
    catalogPhases: { 'chatgpt-plan': 'stale' },
    busy: false,
    onChangeDefaultConnection: () => undefined,
    onSavePreferences: () => undefined,
    onSaveChatGptModelPreference: () => undefined,
    onSaveChatGptReasoningPreference: () => undefined,
  };

  const markup = renderToStaticMarkup(React.createElement(ModelPreferencesSection, props));
  const defaultConnectionSelect = markup.match(/<select id="default-ai-connection"[^>]*>([\s\S]*?)<\/select>/)?.[1];

  assert.ok(defaultConnectionSelect, 'Default connection selector should render');
  assert.match(defaultConnectionSelect, /<option value="chatgpt-plan" selected="">ChatGPT plan<\/option>/);
  assert.match(markup, /<select id="default-ai-model"[^>]* disabled=""/);
  assert.match(markup, /<select id="preferred-chatgpt-model"[^>]* disabled=""/);
  assert.match(markup, /<option value="gpt-6-luna" selected="">gpt-6-luna · saved, refresh to verify<\/option>/);
  assert.match(markup, /<option value="medium" selected="">medium · saved, refresh to verify<\/option>/);
  assert.match(markup, /<option value="medium" selected="">medium · saved, refresh or choose again<\/option>/);
});
