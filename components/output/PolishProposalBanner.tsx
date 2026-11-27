/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import type { AiPolishProposal } from '../../shared/types';

interface PolishProposalBannerProps {
  polishProposal: AiPolishProposal;
  isPolishStale: boolean;
  polishStaleReason: string | null;
  isPolishingPrompt: boolean;
  onPolishPromptWithAi?: () => void;
  onAcceptPolishProposal?: () => void;
  onRejectPolishProposal?: () => void;
}

const PolishProposalBanner: React.FC<PolishProposalBannerProps> = ({
  polishProposal,
  isPolishStale,
  polishStaleReason,
  isPolishingPrompt,
  onPolishPromptWithAi,
  onAcceptPolishProposal,
  onRejectPolishProposal,
}) => {
  return (
    <div
      role="region"
      aria-label="Staged AI Polish Proposal"
      className={`mb-3 p-3 rounded-md border space-y-2 flex-shrink-0 ${
        isPolishStale
          ? 'bg-amber-50/90 dark:bg-amber-950/50 border-amber-300 dark:border-amber-800'
          : 'bg-indigo-50/80 dark:bg-indigo-950/50 border-indigo-300 dark:border-indigo-800'
      }`}
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span
          className={`text-xs font-bold ${
            isPolishStale
              ? 'text-amber-900 dark:text-amber-200'
              : 'text-indigo-900 dark:text-indigo-200'
          }`}
        >
          {isPolishStale
            ? 'Stale AI Polish Proposal — Story Plan Changed Since Proposal'
            : 'Staged AI Narrative Polish Proposal (Review Before Applying)'}
        </span>
        <div className="flex items-center gap-1.5">
          {isPolishStale && onPolishPromptWithAi && (
            <button
              type="button"
              onClick={onPolishPromptWithAi}
              disabled={isPolishingPrompt}
              className="px-2.5 py-1 text-xs font-semibold rounded bg-amber-600 hover:bg-amber-700 text-white"
            >
              {isPolishingPrompt ? 'Re-polishing...' : 'Re-polish Current Prompt'}
            </button>
          )}
          {onAcceptPolishProposal && !isPolishStale && (
            <button
              type="button"
              onClick={onAcceptPolishProposal}
              className="px-2.5 py-1 text-xs font-semibold rounded bg-indigo-600 hover:bg-indigo-700 text-white"
            >
              Accept Polished Prompt
            </button>
          )}
          {onRejectPolishProposal && (
            <button
              type="button"
              onClick={onRejectPolishProposal}
              className="px-2.5 py-1 text-xs font-medium rounded bg-white dark:bg-gray-800 text-gray-700 dark:text-gray-300 border border-gray-300 dark:border-gray-700 hover:bg-gray-100"
            >
              Discard Proposal
            </button>
          )}
        </div>
      </div>
      {isPolishStale && polishStaleReason && (
        <p className="text-xs text-amber-800 dark:text-amber-300" role="alert">
          {polishStaleReason}
        </p>
      )}
      <pre className="p-2 rounded bg-white dark:bg-gray-900 border border-indigo-200 dark:border-indigo-900 text-xs text-gray-800 dark:text-gray-200 whitespace-pre-wrap font-mono max-h-28 overflow-y-auto">
        {polishProposal.polishedPrompt || polishProposal.proposedPrompt}
      </pre>
    </div>
  );
};

export default PolishProposalBanner;
