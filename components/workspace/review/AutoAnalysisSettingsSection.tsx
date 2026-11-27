/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import type { NarrativeRecords } from '../../../shared/narrativeTypes';
import { workspaceButton } from '../../manuscript/ManuscriptEditor';

type AutomationPrefs = NonNullable<NarrativeRecords['automationPreferences']>;

interface AutoAnalysisSettingsSectionProps {
  autoAnalysisDiagnosticsAvailability: { eligible: boolean; reason?: string };
  autoPrefs: AutomationPrefs;
  autoAnalysisCallsUsed: number;
  onUpdateAutomationPreferences: (prefs: AutomationPrefs) => void;
}

export const AutoAnalysisSettingsSection: React.FC<AutoAnalysisSettingsSectionProps> = ({
  autoAnalysisDiagnosticsAvailability,
  autoPrefs,
  autoAnalysisCallsUsed,
  onUpdateAutomationPreferences,
}) => (
  <section aria-labelledby="auto-analysis-heading" className="space-y-2.5 rounded-lg border border-gray-300 p-4 text-xs dark:border-gray-700">
    <h2 id="auto-analysis-heading" className="text-sm font-semibold">Optional Semantic Auto-Analysis (Off by Default)</h2>
    <p className="text-gray-600 dark:text-gray-400">
      When explicitly enabled, runs a debounced semantic consistency check after edits within strict scope and session call caps. Never auto-edits your manuscript or canon.
    </p>
    {!autoAnalysisDiagnosticsAvailability.eligible && (
      <p role="status" className="text-amber-800 dark:text-amber-300">Semantic auto-analysis is unavailable: {autoAnalysisDiagnosticsAvailability.reason ?? 'not currently eligible.'}</p>
    )}
    <div className="flex flex-wrap items-center gap-4">
      <label className="flex items-center gap-1.5 font-medium">
        <input
          type="checkbox"
          disabled={!autoAnalysisDiagnosticsAvailability.eligible}
          checked={autoPrefs.semanticAutoAnalysisEnabled}
          onChange={(e) => onUpdateAutomationPreferences({ ...autoPrefs, semanticAutoAnalysisEnabled: e.target.checked })}
        />
        Enable bounded auto-analysis
      </label>
      <label className="flex items-center gap-1.5">
        <span>Scope</span>
        <select
          disabled={!autoAnalysisDiagnosticsAvailability.eligible || !autoPrefs.semanticAutoAnalysisEnabled}
          value={autoPrefs.scope}
          onChange={(e) => onUpdateAutomationPreferences({ ...autoPrefs, scope: e.target.value as 'changed' | 'scene' | 'full' })}
          className="rounded border border-gray-300 bg-white px-2 py-0.5 dark:border-gray-700 dark:bg-gray-950"
        >
          <option value="changed">Changed scope</option>
          <option value="scene">Current scene</option>
          <option value="full">Full project</option>
        </select>
      </label>
      <label className="flex items-center gap-1.5">
        <span>Session call cap</span>
        <input
          type="number"
          min={1}
          max={20}
          disabled={!autoAnalysisDiagnosticsAvailability.eligible || !autoPrefs.semanticAutoAnalysisEnabled}
          value={autoPrefs.maxCallsPerSession}
          onChange={(e) =>
            onUpdateAutomationPreferences({
              ...autoPrefs,
              maxCallsPerSession: Math.max(1, Math.min(20, Number(e.target.value) || 4)),
            })
          }
          className="w-16 rounded border border-gray-300 bg-white px-2 py-0.5 dark:border-gray-700 dark:bg-gray-950"
        />
      </label>
      <button
        type="button"
        disabled={!autoAnalysisDiagnosticsAvailability.eligible || !autoPrefs.semanticAutoAnalysisEnabled}
        onClick={() => onUpdateAutomationPreferences({ ...autoPrefs, paused: !autoPrefs.paused })}
        className={workspaceButton}
      >
        {autoPrefs.paused ? 'Resume auto-analysis' : 'Pause auto-analysis'}
      </button>
      <span className="tabular-nums text-gray-500">
        Session usage: {autoAnalysisCallsUsed} / {autoPrefs.maxCallsPerSession} calls
      </span>
    </div>
  </section>
);
