/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';

interface PromptNotesViewProps {
  originalIdea: string;
  refinedPrompt: string;
  freeformNotes: string;
  onChangeFreeformNotes: (notes: string) => void;
}

const PromptNotesView: React.FC<PromptNotesViewProps> = ({
  originalIdea,
  refinedPrompt,
  freeformNotes,
  onChangeFreeformNotes,
}) => {
  return (
    <div className="flex-1 overflow-y-auto grid grid-cols-1 lg:grid-cols-2 gap-3 min-h-0">
      <div className="flex flex-col gap-1.5">
        <div className="text-xs font-semibold text-gray-800 dark:text-gray-200 flex items-center justify-between">
          <span>Derived Refined Prompt (From Confirmed Decisions)</span>
          <span className="text-[11px] font-normal text-gray-500">
            Original idea: &ldquo;{originalIdea.slice(0, 38)}...&rdquo;
          </span>
        </div>
        <pre className="flex-1 p-3 rounded-md bg-gray-50 dark:bg-gray-950 border border-gray-200 dark:border-gray-800 text-xs text-gray-800 dark:text-gray-200 whitespace-pre-wrap font-mono leading-relaxed overflow-y-auto">
          {refinedPrompt}
        </pre>
      </div>

      <div className="flex flex-col gap-1.5">
        <label
          htmlFor="freeform-author-notes"
          className="text-xs font-semibold text-gray-800 dark:text-gray-200"
        >
          Freeform Author Notes (Preserved Across AI Reanalysis)
        </label>
        <textarea
          id="freeform-author-notes"
          value={freeformNotes}
          onChange={(e) => onChangeFreeformNotes(e.target.value)}
          placeholder="Add custom dialogue snippets, stylistic instructions, or pacing notes that AI reanalysis must never overwrite..."
          className="flex-1 min-h-[90px] p-2.5 rounded-md bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-700 text-xs text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none"
        />
      </div>
    </div>
  );
};

export default PromptNotesView;
