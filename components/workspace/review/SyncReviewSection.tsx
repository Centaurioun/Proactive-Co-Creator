/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import type { CreativeProject } from '../../../shared/types';
import type { SyncManuscriptPatch, SyncModelProposal } from '../../../shared/narrativeAiSchemas';
import type { ClientBudgetDisclosure } from '../../../lib/narrative/aiBudgetClient';
import { validateManuscriptPatchBinding } from '../../../lib/narrative/sync/syncProposals';
import {
  isProposalReviewContextCurrent,
  type ProposalReviewContext,
} from './proposalReviewContext';

export interface SyncReviewResultState {
  context: ProposalReviewContext;
  direction: 'manuscript-to-model' | 'model-to-manuscript';
  coverageNote: string;
  modelProposals: SyncModelProposal[];
  manuscriptPatches: SyncManuscriptPatch[];
}

interface SyncReviewSectionProps {
  project: CreativeProject;
  sectionCount: number;
  syncAvailability: { eligible: boolean; reason?: string };
  syncFreshness: { statusLabel: string; coverageNote: string };
  syncDirection: 'manuscript-to-model' | 'model-to-manuscript';
  setSyncDirection: (direction: 'manuscript-to-model' | 'model-to-manuscript') => void;
  syncBudget: ClientBudgetDisclosure;
  syncBusy: boolean;
  syncError: string;
  setSyncError: (msg: string) => void;
  syncMessage: string;
  setSyncMessage: (msg: string) => void;
  syncResult: SyncReviewResultState | null;
  onRunSyncAnalysis: () => void;
  onApplyModelSyncProposal?: (
    proposal: SyncModelProposal,
    expectedBaseRevision: number
  ) => Promise<{ ok: boolean; message: string }>;
  onApplyManuscriptSyncPatch?: (
    patch: SyncManuscriptPatch,
    expectedBaseRevision: number,
    expectedManuscriptVersionId?: string
  ) => Promise<{ ok: boolean; message: string }>;
}

export const SyncReviewSection: React.FC<SyncReviewSectionProps> = ({
  project,
  sectionCount,
  syncAvailability,
  syncFreshness,
  syncDirection,
  setSyncDirection,
  syncBudget,
  syncBusy,
  syncError,
  setSyncError,
  syncMessage,
  setSyncMessage,
  syncResult,
  onRunSyncAnalysis,
  onApplyModelSyncProposal,
  onApplyManuscriptSyncPatch,
}) => {
  const syncResultStale = Boolean(
    syncResult && !isProposalReviewContextCurrent(project, syncResult.context)
  );

  return (
    <section aria-labelledby="sync-heading" className="space-y-3 rounded-lg border border-gray-300 p-4 dark:border-gray-700">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h2 id="sync-heading" className="text-base font-semibold">Manuscript ↔ Model Sync (Reviewable Proposals)</h2>
          <p className="text-xs text-gray-600 dark:text-gray-400">
            {syncFreshness.statusLabel} · {syncFreshness.coverageNote}
          </p>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2 text-xs">
        <label className="flex items-center gap-1.5">
          <input
            type="radio"
            name="sync-direction"
            checked={syncDirection === 'manuscript-to-model'}
            onChange={() => setSyncDirection('manuscript-to-model')}
          />
          Manuscript → Model (Analyze Changes)
        </label>
        <label className="flex items-center gap-1.5">
          <input
            type="radio"
            name="sync-direction"
            checked={syncDirection === 'model-to-manuscript'}
            onChange={() => setSyncDirection('model-to-manuscript')}
          />
          Model → Manuscript (Sync Manuscript Patches)
        </label>
      </div>
      <p className="text-[11px] tabular-nums text-gray-600 dark:text-gray-400">
        Preflight: {syncBudget.inputChars.toLocaleString()} / {syncBudget.maxInputChars.toLocaleString()} chars · ~{syncBudget.estimatedInputTokens.toLocaleString()} / {syncBudget.maxInputTokens.toLocaleString()} est. tokens. Omitted facts in one scene never auto-delete canonical facts.
      </p>
      <button
        type="button"
        disabled={syncBusy || !syncAvailability.eligible || !syncBudget.withinLimit || sectionCount === 0}
        onClick={onRunSyncAnalysis}
        className="rounded bg-blue-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-blue-700 disabled:opacity-45"
      >
        {syncBusy
          ? 'Analyzing sync proposals…'
          : syncDirection === 'manuscript-to-model'
            ? 'Analyze Manuscript Changes'
            : 'Generate Scoped Manuscript Patches'}
      </button>
      {!syncAvailability.eligible && <p role="status" className="text-xs text-amber-800 dark:text-amber-300">AI sync is unavailable: {syncAvailability.reason ?? 'not currently eligible.'}</p>}
      {syncError && <p role="alert" className="text-xs text-red-700 dark:text-red-300">{syncError}</p>}
      {syncMessage && <p role="status" className="text-xs text-emerald-700 dark:text-emerald-300">{syncMessage}</p>}

      {syncResult && (
        <div className="space-y-3 pt-2 text-xs">
          {syncResultStale && (
            <p role="alert" className="rounded border border-amber-400 bg-amber-50 p-2 text-amber-900 dark:bg-amber-950/60 dark:text-amber-200">
              Project or manuscript content changed since sync ran (base r{syncResult.context.baseRevision} → current r{project.revision}). These proposals remain visible for provenance but cannot be applied. Re-run sync to create proposals for the current revision.
            </p>
          )}
          {syncResult.modelProposals.map((prop) => (
            <article key={prop.id} className="space-y-1.5 rounded border border-gray-300 p-3 dark:border-gray-700">
              <div className="flex items-center justify-between gap-2">
                <h4 className="font-semibold">{prop.title}</h4>
                <span className="rounded bg-gray-100 px-1.5 py-0.5 text-[10px] uppercase dark:bg-gray-800">{prop.kind.replace(/_/g, ' ')}</span>
              </div>
              <p>{prop.rationale}</p>
              <blockquote className="border-l-2 pl-2 text-gray-600 dark:text-gray-300">{prop.evidenceQuote}</blockquote>
              <p className="font-mono text-[11px]">Proposed: {prop.proposedValue}</p>
              {prop.kind !== 'ambiguity' && onApplyModelSyncProposal && (
                <button
                  type="button"
                  disabled={syncResultStale}
                  onClick={async () => {
                    const res = await onApplyModelSyncProposal(prop, syncResult.context.baseRevision);
                    setSyncMessage(res.ok ? res.message : '');
                    setSyncError(res.ok ? '' : res.message);
                  }}
                  className="rounded bg-emerald-600 px-2.5 py-1 text-[11px] font-semibold text-white hover:bg-emerald-700 disabled:opacity-45"
                >
                  Accept Model Update
                </button>
              )}
            </article>
          ))}
          {syncResult.manuscriptPatches.map((patch) => {
            const binding = validateManuscriptPatchBinding(project, patch);
            return (
              <article key={patch.id} className="space-y-2 rounded border border-gray-300 p-3 dark:border-gray-700">
                <div className="flex items-center justify-between gap-2">
                  <h4 className="font-semibold">{patch.sectionTitle} · {patch.linkedModelChange}</h4>
                  <span className={`text-[11px] font-semibold ${binding.ok ? 'text-emerald-700 dark:text-emerald-400' : 'text-amber-700 dark:text-amber-300'}`}>
                    {binding.ok ? 'Exact match verified' : 'Stale / ambiguous'}
                  </span>
                </div>
                <p>{patch.rationale}</p>
                <div className="grid gap-2 sm:grid-cols-2">
                  <div className="rounded border border-red-200 bg-red-50/40 p-2 dark:border-red-900/60 dark:bg-red-950/20">
                    <div className="text-[11px] font-semibold">Original excerpt</div>
                    <pre className="whitespace-pre-wrap break-words font-serif">{patch.originalExcerpt}</pre>
                  </div>
                  <div className="rounded border border-emerald-200 bg-emerald-50/40 p-2 dark:border-emerald-900/60 dark:bg-emerald-950/20">
                    <div className="text-[11px] font-semibold">Proposed patch</div>
                    <pre className="whitespace-pre-wrap break-words font-serif">{patch.proposedExcerpt}</pre>
                  </div>
                </div>
                {!binding.ok && binding.reason && <p className="text-amber-800 dark:text-amber-300">{binding.reason}</p>}
                {onApplyManuscriptSyncPatch && (
                  <button
                    type="button"
                    disabled={!binding.ok || syncResultStale}
                    onClick={async () => {
                      const res = await onApplyManuscriptSyncPatch(patch, syncResult.context.baseRevision, syncResult.context.manuscriptVersionId);
                      setSyncMessage(res.ok ? res.message : '');
                      setSyncError(res.ok ? '' : res.message);
                    }}
                    className="rounded bg-emerald-600 px-2.5 py-1 text-[11px] font-semibold text-white hover:bg-emerald-700 disabled:opacity-45"
                  >
                    Apply Scoped Manuscript Patch
                  </button>
                )}
              </article>
            );
          })}
        </div>
      )}
    </section>
  );
};
