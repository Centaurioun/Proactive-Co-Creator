/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import type { BatchCommitResult, BatchEditProposalResult } from '../../../shared/types';

interface BatchEditSectionProps {
  batchInstruction: string;
  setBatchInstruction: (val: string) => void;
  batchPreview: BatchEditProposalResult | null;
  setBatchPreview: (val: BatchEditProposalResult | null) => void;
  batchError: string | null;
  setBatchError: (val: string | null) => void;
  lastFailedReason: Extract<BatchCommitResult, { ok: false }>['reason'] | null;
  setLastFailedReason: (val: Extract<BatchCommitResult, { ok: false }>['reason'] | null) => void;
  acknowledgeUnhandledClauses: boolean;
  setAcknowledgeUnhandledClauses: (val: boolean) => void;
  isBatchLoading: boolean;
  isPreviewStale: boolean;
  onRunBatchPreview: (e: React.FormEvent) => void;
  onRunBatchPreviewForText: (text: string) => Promise<void>;
  onDismissBatchPreview: () => void;
  onToggleOperationSelection: (opId: string) => void;
  onCommitBatchOperations: () => void;
}

export const BatchEditSection: React.FC<BatchEditSectionProps> = ({
  batchInstruction,
  setBatchInstruction,
  batchPreview,
  batchError,
  lastFailedReason,
  acknowledgeUnhandledClauses,
  setAcknowledgeUnhandledClauses,
  isBatchLoading,
  isPreviewStale,
  onRunBatchPreview,
  onRunBatchPreviewForText,
  onDismissBatchPreview,
  onToggleOperationSelection,
  onCommitBatchOperations,
}) => (
  <div className="p-3 border-b border-gray-200 dark:border-gray-800 bg-gray-50/60 dark:bg-gray-950/50 flex-shrink-0">
    <form onSubmit={onRunBatchPreview} className="flex flex-col gap-2">
      <div className="flex items-center justify-between">
        <label
          htmlFor="nl-batch-input"
          className="text-xs font-semibold text-gray-800 dark:text-gray-200"
        >
          Natural-Language Batch Edit
        </label>
        <button
          type="button"
          onClick={() =>
            setBatchInstruction(
              'Make all the animal guests elderly, but keep the cat young. The party should be mysterious rather than cheerful.'
            )
          }
          className="text-[11px] text-blue-600 dark:text-blue-400 hover:underline whitespace-nowrap"
        >
          Try sample batch
        </button>
      </div>
      <div className="flex gap-1.5">
        <input
          id="nl-batch-input"
          type="text"
          value={batchInstruction}
          onChange={(e) => setBatchInstruction(e.target.value)}
          placeholder="e.g. Make all animal guests elderly, keep the cat young..."
          className="flex-1 min-w-0 text-xs bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-700 rounded-md px-2.5 py-2 text-gray-900 dark:text-gray-100 placeholder:text-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500"
        />
        <button
          type="submit"
          disabled={isBatchLoading || !batchInstruction.trim()}
          className="px-3 py-2 min-h-[36px] text-xs font-semibold bg-blue-600 hover:bg-blue-700 disabled:bg-gray-300 dark:disabled:bg-gray-800 text-white rounded-md transition-colors whitespace-nowrap shrink-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
        >
          {isBatchLoading ? 'Parsing...' : 'Preview'}
        </button>
      </div>
    </form>

    {batchError && (
      <p className="mt-2 text-xs text-red-600 dark:text-red-400" role="alert">
        {batchError}
      </p>
    )}

    {batchPreview && (
      <div
        role="region"
        aria-label="Batch edit preview"
        className="mt-2.5 p-3 rounded-md bg-white dark:bg-gray-900 border border-blue-300 dark:border-blue-800 space-y-2.5"
      >
        <div className="flex items-center justify-between">
          <span className="text-xs font-semibold text-gray-900 dark:text-gray-100">
            Proposed Batch Operations ({batchPreview.operations.filter((o) => o.selected).length}/
            {batchPreview.operations.length})
          </span>
          <button
            type="button"
            onClick={onDismissBatchPreview}
            className="text-xs text-gray-500 hover:text-gray-800 dark:hover:text-gray-200"
          >
            Dismiss
          </button>
        </div>

        {(isPreviewStale ||
          lastFailedReason === 'STALE_REVISION' ||
          lastFailedReason === 'WRONG_PROJECT') && (
          <div
            role="alert"
            className="p-2.5 rounded bg-amber-50 dark:bg-amber-950/60 border border-amber-300 dark:border-amber-800 text-xs text-amber-900 dark:text-amber-200 flex flex-wrap items-center justify-between gap-2"
          >
            <span>
              This preview was generated for an older project or revision. Re-preview against the current Story Bible before applying.
            </span>
            <button
              type="button"
              onClick={() => void onRunBatchPreviewForText(batchInstruction || batchPreview.instruction)}
              className="px-2.5 py-1 text-xs font-semibold bg-amber-600 hover:bg-amber-700 text-white rounded whitespace-nowrap"
            >
              Re-preview for Current Project
            </button>
          </div>
        )}

        {batchPreview.ambiguities.length > 0 && (
          <div className="p-2.5 rounded bg-amber-50 dark:bg-amber-950/60 border border-amber-300 dark:border-amber-800 text-xs text-amber-900 dark:text-amber-200 space-y-1">
            <p className="font-semibold">Clarification Needed for Ambiguous Reference:</p>
            {batchPreview.ambiguities.map((amb, idx) => (
              <div key={idx}>
                <p>{amb.clarifyingQuestion}</p>
                <div className="flex flex-wrap gap-1.5 mt-1.5">
                  {amb.candidates.map((cand) => (
                    <button
                      key={cand}
                      type="button"
                      onClick={() => {
                        const resolvedText = batchInstruction.replace(
                          /\b(him|her|them|his|hers)\b/i,
                          `the ${cand}`
                        );
                        setBatchInstruction(resolvedText);
                        void onRunBatchPreviewForText(resolvedText);
                      }}
                      className="px-2 py-1 text-[11px] font-medium bg-white dark:bg-gray-800 border border-amber-400 dark:border-amber-700 rounded hover:bg-amber-100 dark:hover:bg-gray-700"
                    >
                      Apply to {cand}
                    </button>
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}

        {batchPreview.unhandledClauses && batchPreview.unhandledClauses.length > 0 && (
          <div
            role="alert"
            className="p-2.5 rounded bg-amber-50 dark:bg-amber-950/60 border border-amber-300 dark:border-amber-800 text-xs text-amber-900 dark:text-amber-200 space-y-1.5"
          >
            <p className="font-semibold">
              Unhandled Instruction Clause ({batchPreview.unhandledClauses.length}):
            </p>
            <ul className="list-disc pl-4 space-y-0.5">
              {batchPreview.unhandledClauses.map((clause, idx) => (
                <li key={idx}>&ldquo;{clause}&rdquo;</li>
              ))}
            </ul>
            {batchPreview.operations.length > 0 && (
              <label className="flex items-center gap-2 pt-1 font-medium cursor-pointer">
                <input
                  type="checkbox"
                  checked={acknowledgeUnhandledClauses}
                  onChange={(e) => setAcknowledgeUnhandledClauses(e.target.checked)}
                  className="rounded border-amber-400 text-amber-600 focus:ring-amber-500"
                />
                <span>Apply parsed operations only and skip unhandled clauses</span>
              </label>
            )}
          </div>
        )}

        {batchPreview.warnings.length > 0 && (
          <div className="p-2 rounded bg-red-50 dark:bg-red-950/50 border border-red-200 dark:border-red-800 text-xs text-red-700 dark:text-red-300">
            {batchPreview.warnings.map((w, i) => (
              <p key={i}>{w}</p>
            ))}
          </div>
        )}

        {batchPreview.operations.length > 0 ? (
          <div className="space-y-1.5 max-h-44 overflow-y-auto pr-1">
            {batchPreview.operations.map((op) => (
              <label
                key={op.id}
                className="flex items-start gap-2 text-xs p-1.5 rounded hover:bg-gray-50 dark:hover:bg-gray-800 cursor-pointer"
              >
                <input
                  type="checkbox"
                  checked={op.selected}
                  onChange={() => onToggleOperationSelection(op.id)}
                  className="mt-0.5 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                />
                <div className="flex-1 min-w-0">
                  <span className="font-medium text-gray-900 dark:text-gray-100 block">
                    {op.summary}
                  </span>
                  {op.destructive && (
                    <span className="text-[11px] text-red-600 dark:text-red-400">
                      Destructive operation — requires confirmation
                    </span>
                  )}
                </div>
              </label>
            ))}
          </div>
        ) : (
          batchPreview.ambiguities.length === 0 && (
            <p className="text-xs text-gray-500">
              No structured operations matched. Try naming an entity, group (&ldquo;all animal guests&rdquo;), or story setting.
            </p>
          )
        )}

        {batchPreview.operations.length > 0 && (
          <div className="flex justify-end gap-2 pt-1">
            <button
              type="button"
              onClick={onDismissBatchPreview}
              className="px-2.5 py-1.5 text-xs font-medium text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-800 rounded"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={onCommitBatchOperations}
              disabled={
                isPreviewStale ||
                batchPreview.operations.every((o) => !o.selected) ||
                ((batchPreview.unhandledClauses?.length ?? 0) > 0 && !acknowledgeUnhandledClauses)
              }
              className="px-3 py-1.5 text-xs font-semibold bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 disabled:cursor-not-allowed text-white rounded transition-colors"
            >
              Apply Approved Batch ({batchPreview.operations.filter((o) => o.selected).length})
            </button>
          </div>
        )}
      </div>
    )}
  </div>
);
