import assert from 'node:assert/strict';
import test from 'node:test';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import PromptInput from '../components/PromptInput';
import WorkspaceBottomBar from '../components/WorkspaceBottomBar';
import GeneratedOutputView from '../components/output/GeneratedOutputView';
import { generateStoryFromPrompt, PROVIDER_PREFERENCES_STORAGE_KEY } from '../services/apiClient';
import { resolveStoryProviderPreflight } from '../lib/controller/storyProviderSelection';

test('synthetic Medium Story preference is rejected before intercepted transport', async () => {
  const previousWindow = globalThis.window;
  const previousFetch = globalThis.fetch;
  let transportCalls = 0;
  const rawPreferences = JSON.stringify({
    defaultConnectionId: 'chatgpt-plan', defaultTextModelId: 'gpt-6-luna', defaultReasoningLevel: 'medium',
  });
  Object.defineProperty(globalThis, 'window', {
    configurable: true,
    value: { localStorage: { getItem: (key: string) => key === PROVIDER_PREFERENCES_STORAGE_KEY ? rawPreferences : null } },
  });
  globalThis.fetch = (async () => { transportCalls += 1; throw new Error('intercepted unexpected transport'); }) as typeof fetch;
  try {
    const result = resolveStoryProviderPreflight(true);
    assert.equal(result.ok, false);
    if (result.ok) return;
    await assert.rejects(generateStoryFromPrompt('Synthetic seed', undefined, 'synthetic-story-request-001'), /qualified only for GPT-6 Luna with Default reasoning/);
    assert.equal(transportCalls, 0);
  } finally {
    globalThis.fetch = previousFetch;
    if (previousWindow === undefined) delete (globalThis as { window?: Window }).window;
    else Object.defineProperty(globalThis, 'window', { configurable: true, value: previousWindow });
  }
});

const blockedReason = 'ChatGPT Story is qualified only for GPT-6 Luna with Default reasoning; no model substitution or provider fallback is available.';

test('all Plan Story entry points use the same operation block and explain why', () => {
  const top = renderToStaticMarkup(React.createElement(PromptInput, {
    prompt: 'Synthetic seed', setPrompt: () => {}, onSubmit: () => {}, onAnalyze: () => {},
    isLoading: false, isGenerating: false, isFirstRun: true, mode: 'story', setMode: () => {},
    storyBlockReason: blockedReason,
  }));
  const bottom = renderToStaticMarkup(React.createElement(WorkspaceBottomBar, {
    pendingDecisionCount: 0, canUndo: false, canRedo: false, onUndo: () => {}, onRedo: () => {},
    onAcceptAllPending: () => {}, onReviewChanges: () => {}, mode: 'story', onModeChange: () => {},
    onGenerate: () => {}, isGenerating: false, showOutputDrawer: false, onToggleOutputDrawer: () => {},
    revisionCount: 1, isOutdated: false, storyBlockReason: blockedReason,
  }));
  const confirmedPlan = renderToStaticMarkup(React.createElement(GeneratedOutputView, {
    mode: 'story', isLoading: false, error: null, displayedOutdated: false, displayedStory: null,
    displayedImages: [], imageWarning: null, storyProviderSelection: { connectionId: 'chatgpt-plan', modelId: 'gpt-6-luna', reasoningLevel: 'medium' },
    chatGptStorySelected: true, chatGptStoryBlocked: true, chatGptStoryBlockReason: blockedReason,
    storyProviderUsage: null, onGenerate: () => {}, onSelectImage: () => {},
  }));

  for (const [label, html, buttonPattern] of [
    ['top', top, /<button([^>]*)>\s*Generate Story\s*<\/button>/],
    ['bottom', bottom, /<button([^>]*)>\s*Generate Story\s*<\/button>/],
    ['confirmed plan', confirmedPlan, /<button([^>]*)>\s*Generate Story from Confirmed Plan\s*<\/button>/],
  ] as const) {
    const button = html.match(buttonPattern);
    assert.ok(button, `${label} Story action is present`);
    assert.match(button[1], /\bdisabled(?:=|\s|$)/, `${label} Story button is disabled for the same rejected selection`);
    assert.ok(html.includes(blockedReason), `${label} Story entry point explains the rejection`);
  }
});
