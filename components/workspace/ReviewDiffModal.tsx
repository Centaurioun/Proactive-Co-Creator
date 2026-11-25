/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useEffect, useRef } from 'react';
import type { buildReviewDiffModel } from '../../lib/projectController';
import type {
  ConsistencyIssue,
  CreativeProject,
  DecisionItem,
  GenerationMode,
} from '../../shared/types';

export interface ReviewDiffModalProps {
  isOpen: boolean;
  activeProject: CreativeProject;
  mode: GenerationMode;
  pendingDecisions: DecisionItem[];
  stagedDecisionDrafts: Record<string, string>;
  reviewDiffModel: ReturnType<typeof buildReviewDiffModel>;
  consistencyIssues: ConsistencyIssue[];
  onClose: () => void;
  onApplyDecisions: (
    decisionIds: string[],
    action: 'accept' | 'reject',
    draftValues?: Record<string, string>
  ) => void;
  onRestoreRevision: (revisionId: string) => void;
  onOpenStoryBible: () => void;
}

const ReviewDiffModal: React.FC<ReviewDiffModalProps> = ({
  isOpen,
  activeProject,
  mode,
  pendingDecisions,
  stagedDecisionDrafts,
  reviewDiffModel,
  consistencyIssues,
  onClose,
  onApplyDecisions,
  onRestoreRevision,
  onOpenStoryBible,
}) => {
  const dialogRef = useRef<HTMLDivElement>(null);
  const closeButtonRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!isOpen) return;
    requestAnimationFrame(() => {
      closeButtonRef.current?.focus();
    });

    const handleModalKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        onClose();
        return;
      }
      if (e.key === 'Tab' && dialogRef.current) {
        const focusables = Array.from(
          dialogRef.current.querySelectorAll<HTMLElement>(
            'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
          )
        );
        if (focusables.length === 0) return;
        const first = focusables[0];
        const last = focusables[focusables.length - 1];
        const active = document.activeElement as HTMLElement | null;
        if (e.shiftKey) {
          if (active === first || !dialogRef.current.contains(active)) {
            e.preventDefault();
            last.focus();
          }
        } else {
          if (active === last || !dialogRef.current.contains(active)) {
            e.preventDefault();
            first.focus();
          }
        }
      }
    };

    window.addEventListener('keydown', handleModalKeyDown);
    return () => window.removeEventListener('keydown', handleModalKeyDown);
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  const pendingDecisionCount = pendingDecisions.length;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Review Plan and Prompt Changes"
      className="fixed inset-0 z-[1900] bg-black/60 flex items-center justify-center p-4 backdrop-blur-xs"
      onClick={onClose}
    >
      <div
        ref={dialogRef}
        className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-xl shadow-2xl w-full max-w-4xl max-h-[85vh] flex flex-col overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="px-5 py-3.5 border-b border-gray-200 dark:border-gray-800 flex items-center justify-between">
          <div>
            <h2 className="font-display text-base font-bold text-gray-900 dark:text-gray-100">
              Review Story Plan, Pending Decisions &amp; Prompt Diff
            </h2>
            <p className="text-xs text-gray-500 dark:text-gray-400">
              Project Revision #{activeProject.revision} · {pendingDecisionCount} pending inbox item(s) ·{' '}
              {reviewDiffModel.items.length} staged before/after change(s) ·{' '}
              {consistencyIssues.length} consistency warning(s)
            </p>
          </div>
          <button
            ref={closeButtonRef}
            type="button"
            onClick={onClose}
            className="text-sm font-semibold text-gray-500 hover:text-gray-900 dark:hover:text-white px-2.5 py-1 rounded focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
          >
            Close
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-5 space-y-4 text-xs">
          {/* Structured Before -> After Diff Table (U-01 / IA-17) */}
          <div className="p-3.5 rounded-lg border border-gray-200 dark:border-gray-800 bg-gray-50/60 dark:bg-gray-950/40 space-y-2.5">
            <div className="flex items-center justify-between">
              <h3 className="font-bold text-gray-900 dark:text-gray-100">
                Before &rarr; After Impact of Pending Decisions &amp; Staged Batch Edits ({reviewDiffModel.items.length})
              </h3>
              {pendingDecisionCount > 0 && (
                <button
                  type="button"
                  onClick={() =>
                    onApplyDecisions(
                      pendingDecisions.map((d) => d.id),
                      'accept',
                      stagedDecisionDrafts
                    )
                  }
                  className="px-2.5 py-1 rounded font-semibold bg-blue-600 hover:bg-blue-700 text-white"
                >
                  Accept All Pending ({pendingDecisionCount})
                </button>
              )}
            </div>

            {reviewDiffModel.hasStaleBatch && (
              <div
                role="alert"
                className="p-2.5 rounded border border-amber-300 dark:border-amber-800 bg-amber-50 dark:bg-amber-950/60 text-amber-900 dark:text-amber-200 text-xs font-medium"
              >
                Stale staged batch preview detected: the project revision changed after this batch preview was created, so it is excluded from the projected prompt until you click Re-preview in the Decision Inbox.
              </div>
            )}

            {reviewDiffModel.items.length === 0 ? (
              <p className="text-gray-500">
                No pending decisions or staged batch edits. All current plan items are committed.
              </p>
            ) : (
              <div data-testid="review-diff-list" className="space-y-1.5 max-h-48 overflow-y-auto">
                {reviewDiffModel.items.map((diff) => {
                  const matchingDecision = pendingDecisions.find(
                    (d) => d.id === diff.id || `diff_${d.id}` === diff.id
                  );
                  return (
                    <div
                      key={diff.id}
                      data-diff-source={diff.source}
                      className="flex flex-wrap items-center justify-between gap-2 p-2.5 rounded bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800"
                    >
                      <div className="min-w-0 flex-1 space-y-0.5">
                        <div className="flex items-center gap-1.5 text-[11px] text-gray-500 dark:text-gray-400">
                          <span className="uppercase font-semibold tracking-wider">
                            {diff.category}
                          </span>
                          <span aria-hidden="true">&middot;</span>
                          <span className="font-medium text-gray-800 dark:text-gray-200 truncate">
                            {diff.targetLabel}
                          </span>
                        </div>
                        <div className="flex flex-wrap items-center gap-1.5 font-mono text-xs">
                          <span className="px-1.5 py-0.5 rounded bg-red-50 dark:bg-red-950/50 text-red-700 dark:text-red-300 border border-red-200 dark:border-red-900 line-through">
                            Before: {diff.beforeValue}
                          </span>
                          <span aria-hidden="true" className="text-gray-400">
                            &rarr;
                          </span>
                          <span className="px-1.5 py-0.5 rounded bg-emerald-50 dark:bg-emerald-950/50 text-emerald-700 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-900 font-semibold">
                            After: {diff.afterValue}
                          </span>
                        </div>
                        {diff.conflictWarning && (
                          <p className="text-[11px] font-medium text-amber-700 dark:text-amber-300 pt-0.5">
                            {diff.conflictWarning}
                          </p>
                        )}
                      </div>

                      {matchingDecision && (
                        <div className="flex items-center gap-1 shrink-0">
                          <button
                            type="button"
                            onClick={() =>
                              onApplyDecisions([matchingDecision.id], 'accept', stagedDecisionDrafts)
                            }
                            className="px-2 py-1 rounded bg-blue-600 hover:bg-blue-700 text-white font-semibold"
                          >
                            Accept
                          </button>
                          <button
                            type="button"
                            onClick={() => onApplyDecisions([matchingDecision.id], 'reject')}
                            className="px-2 py-1 rounded bg-gray-200 dark:bg-gray-800 text-red-600 dark:text-red-400 font-medium"
                          >
                            Reject
                          </button>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* Recent Revisions Summary */}
          <div className="p-3.5 rounded-lg border border-gray-200 dark:border-gray-800 space-y-2">
            <h3 className="font-bold text-gray-900 dark:text-gray-100">
              Recent Plan Revisions ({activeProject.revisions.length})
            </h3>
            <div className="space-y-1.5 max-h-36 overflow-y-auto">
              {activeProject.revisions.slice(0, 5).map((rev, idx) => (
                <div
                  key={rev.id}
                  className="flex items-center justify-between gap-2 p-2 rounded bg-gray-50 dark:bg-gray-950 border border-gray-200 dark:border-gray-800"
                >
                  <div>
                    <span className="font-semibold text-gray-900 dark:text-gray-100">
                      Rev #{rev.revisionNumber ?? activeProject.revisions.length - idx}: {rev.label}
                    </span>
                    <p className="text-[11px] text-gray-500">{rev.summary}</p>
                  </div>
                  {idx > 0 && (
                    <button
                      type="button"
                      onClick={() => onRestoreRevision(rev.id)}
                      className="px-2.5 py-1 rounded border border-gray-300 dark:border-gray-700 hover:bg-gray-100 dark:hover:bg-gray-800 font-medium shrink-0"
                    >
                      Restore
                    </button>
                  )}
                </div>
              ))}
            </div>
          </div>

          {/* Synthesized Prompt Before vs After Diff Preview */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <h3 className="font-bold text-gray-900 dark:text-gray-100">
                Current Committed Prompt ({mode === 'story' ? 'Story Mode' : 'Image Mode'})
              </h3>
              <pre className="p-3 rounded-lg bg-gray-50 dark:bg-gray-950 border border-gray-200 dark:border-gray-800 text-xs font-mono whitespace-pre-wrap leading-relaxed max-h-56 overflow-y-auto">
                {reviewDiffModel.beforePrompt}
              </pre>
            </div>

            <div className="space-y-1.5">
              <h3 className="font-bold text-gray-900 dark:text-gray-100">
                Projected Prompt After Accepting Staged Changes
              </h3>
              <pre
                data-testid="review-projected-prompt"
                className="p-3 rounded-lg bg-emerald-50/40 dark:bg-emerald-950/30 border border-emerald-200 dark:border-emerald-900 text-xs font-mono whitespace-pre-wrap leading-relaxed max-h-56 overflow-y-auto"
              >
                {reviewDiffModel.afterPrompt}
              </pre>
            </div>
          </div>
        </div>

        <div className="px-5 py-3 border-t border-gray-200 dark:border-gray-800 flex items-center justify-end gap-2">
          <button
            type="button"
            onClick={() => {
              onClose();
              onOpenStoryBible();
            }}
            className="px-3 py-1.5 text-xs font-medium rounded-lg border border-gray-300 dark:border-gray-700 hover:bg-gray-100 dark:hover:bg-gray-800"
          >
            Open Story Bible
          </button>
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-1.5 text-xs font-semibold rounded-lg bg-blue-600 hover:bg-blue-700 text-white"
          >
            Done
          </button>
        </div>
      </div>
    </div>
  );
};

export default ReviewDiffModal;
