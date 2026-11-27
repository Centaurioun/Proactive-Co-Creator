import assert from 'node:assert/strict';
import test from 'node:test';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
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
