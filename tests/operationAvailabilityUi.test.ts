import assert from 'node:assert/strict';
import test from 'node:test';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import PromptInput from '../components/PromptInput';
import { AutoAnalysisSettingsSection } from '../components/workspace/review/AutoAnalysisSettingsSection';

test('auto-analysis availability explains its reason and preserves the explicit opt-in preference', () => {
  const html = renderToStaticMarkup(React.createElement(AutoAnalysisSettingsSection, {
    autoAnalysisDiagnosticsAvailability: { eligible: false, reason: 'This operation is not enabled for this provider.' },
    autoPrefs: {
      semanticAutoAnalysisEnabled: true,
      scope: 'changed',
      maxCallsPerSession: 4,
      maxTokensPerRun: 10_000,
      paused: false,
    },
    autoAnalysisCallsUsed: 0,
    onUpdateAutomationPreferences: () => undefined,
  }));

  assert.match(html, /This operation is not enabled for this provider\./);
  assert.match(html, /type="checkbox" disabled="" checked=""/);
});

const blockedStoryReason = 'The selected Story connection is not eligible.';
const blockedAnalysisReason = 'Analyze is not enabled for the selected provider.';
const blockedClarifyReason = 'Clarify is not enabled for the selected provider.';

function renderPromptInput(storyBlockReason: string | null, reanalyzeBlockReason?: string | null) {
  return renderToStaticMarkup(React.createElement(PromptInput, {
    prompt: 'A clear seed idea', setPrompt: () => {}, onSubmit: () => {}, onAnalyze: () => {},
    isLoading: false, isGenerating: false, isFirstRun: false, mode: 'story', setMode: () => {},
    storyBlockReason, reanalyzeBlockReason,
  }));
}

test('Reanalyze uses Analyze and Clarify availability instead of Story availability', () => {
  const storyBlocked = renderPromptInput(blockedStoryReason);
  const reanalyzeWhenOnlyStoryIsBlocked = storyBlocked.match(/<button([^>]*)>\s*Reanalyze Idea\s*<\/button>/);
  assert.ok(reanalyzeWhenOnlyStoryIsBlocked);
  assert.doesNotMatch(reanalyzeWhenOnlyStoryIsBlocked[1], /\bdisabled(?:=|\s|$)/);
  const storyButton = storyBlocked.match(/<button([^>]*)>\s*Generate Story\s*<\/button>/);
  assert.ok(storyButton);
  assert.match(storyButton[1], /\bdisabled(?:=|\s|$)/);

  for (const reason of [blockedAnalysisReason, blockedClarifyReason]) {
    const html = renderPromptInput(null, reason);
    const button = html.match(/<button([^>]*)>\s*Reanalyze Idea\s*<\/button>/);
    assert.ok(button);
    assert.match(button[1], /\bdisabled(?:=|\s|$)/);
    assert.match(button[1], new RegExp(`title="${reason}"`));
  }

  const eligible = renderPromptInput(null, null);
  const eligibleButton = eligible.match(/<button([^>]*)>\s*Reanalyze Idea\s*<\/button>/);
  assert.ok(eligibleButton);
  assert.doesNotMatch(eligibleButton[1], /\bdisabled(?:=|\s|$)/);
});
