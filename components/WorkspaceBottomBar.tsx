/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import type { GenerationMode } from '../shared/types';

interface WorkspaceBottomBarProps {
  pendingDecisionCount: number;
  canUndo: boolean;
  canRedo: boolean;
  undoLabel?: string;
  redoLabel?: string;
  onUndo: () => void;
  onRedo: () => void;
  onAcceptAllPending: () => void;
  onReviewChanges: () => void;
  reviewButtonRef?: React.RefObject<HTMLButtonElement | null>;
  mode: GenerationMode;
  onModeChange: (mode: GenerationMode) => void;
  onGenerate: () => void;
  isGenerating: boolean;
  showOutputDrawer: boolean;
  onToggleOutputDrawer: () => void;
  revisionCount: number;
  isOutdated: boolean;
}

const WorkspaceBottomBar: React.FC<WorkspaceBottomBarProps> = ({
  pendingDecisionCount,
  canUndo,
  canRedo,
  undoLabel,
  redoLabel,
  onUndo,
  onRedo,
  onAcceptAllPending,
  onReviewChanges,
  reviewButtonRef,
  mode,
  onModeChange,
  onGenerate,
  isGenerating,
  showOutputDrawer,
  onToggleOutputDrawer,
  revisionCount,
  isOutdated,
}) => {
  return (
    <footer
      aria-label="Change review, undo/redo, and generation controls"
      className="bg-white dark:bg-gray-900 border-t border-gray-200 dark:border-gray-800 px-3 sm:px-4 py-2 sm:py-2.5 flex flex-wrap items-center justify-between gap-2 sm:gap-3 flex-shrink-0 z-30"
    >
      {/* Left: Undo / Redo & Pending Change Review */}
      <div className="flex flex-wrap items-center gap-1.5 sm:gap-2 min-w-0">
        <div
          role="group"
          aria-label="Undo and Redo"
          className="flex items-center rounded-lg border border-gray-200 dark:border-gray-700 overflow-hidden"
        >
          <button
            type="button"
            onClick={onUndo}
            disabled={!canUndo}
            title={undoLabel ? `Undo: ${undoLabel}` : 'Undo last confirmed change'}
            aria-label="Undo"
            className="px-2.5 sm:px-3 py-1.5 min-h-[36px] text-xs font-medium bg-white dark:bg-gray-800 text-gray-700 dark:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-700 disabled:opacity-40 disabled:cursor-not-allowed transition-colors border-r border-gray-200 dark:border-gray-700 whitespace-nowrap"
          >
            Undo
          </button>
          <button
            type="button"
            onClick={onRedo}
            disabled={!canRedo}
            title={redoLabel ? `Redo: ${redoLabel}` : 'Redo undone change'}
            aria-label="Redo"
            className="px-2.5 sm:px-3 py-1.5 min-h-[36px] text-xs font-medium bg-white dark:bg-gray-800 text-gray-700 dark:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-700 disabled:opacity-40 disabled:cursor-not-allowed transition-colors whitespace-nowrap"
          >
            Redo
          </button>
        </div>

        <span className="text-xs text-gray-500 dark:text-gray-400 font-mono tabular-nums hidden sm:inline">
          {pendingDecisionCount} pending · {revisionCount} rev{revisionCount === 1 ? '' : 's'}
        </span>

        {pendingDecisionCount > 0 && (
          <button
            type="button"
            onClick={onAcceptAllPending}
            className="px-2.5 sm:px-3 py-1.5 min-h-[36px] text-xs font-semibold rounded-lg bg-gray-100 hover:bg-gray-200 dark:bg-gray-800 dark:hover:bg-gray-700 text-gray-900 dark:text-gray-100 border border-gray-300 dark:border-gray-700 transition-colors whitespace-nowrap"
          >
            Accept All Pending ({pendingDecisionCount})
          </button>
        )}

        <button
          ref={reviewButtonRef}
          type="button"
          onClick={onReviewChanges}
          className="px-2.5 sm:px-3 py-1.5 min-h-[36px] text-xs font-medium rounded-lg border border-gray-200 dark:border-gray-700 text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors whitespace-nowrap inline-flex items-center"
        >
          Review Plan &amp; Prompt
        </button>
      </div>

      {/* Right: Mode Selector ('story' | 'image') & Primary Generation Action */}
      <div className="flex flex-wrap items-center gap-2 sm:gap-2.5 min-w-0">
        <button
          type="button"
          onClick={onToggleOutputDrawer}
          className="px-2.5 sm:px-3 py-1.5 min-h-[36px] text-xs font-medium rounded-lg border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800 text-gray-800 dark:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors whitespace-nowrap"
        >
          {showOutputDrawer ? 'Hide Output Panel' : 'Show Prompt & Output'}
          {isOutdated ? ' (Updated)' : ''}
        </button>

        <div
          role="group"
          aria-label="Generation mode"
          className="flex bg-gray-100 dark:bg-gray-800 p-0.5 rounded-lg border border-gray-200 dark:border-gray-700"
        >
          <button
            type="button"
            onClick={() => onModeChange('story')}
            aria-pressed={mode === 'story'}
            className={`px-3 py-1 min-h-[32px] text-xs font-semibold rounded-md transition-colors whitespace-nowrap ${
              mode === 'story'
                ? 'bg-white dark:bg-gray-900 text-blue-600 dark:text-blue-400 shadow-xs'
                : 'text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white'
            }`}
          >
            Story
          </button>
          <button
            type="button"
            onClick={() => onModeChange('image')}
            aria-pressed={mode === 'image'}
            className={`px-3 py-1 min-h-[32px] text-xs font-semibold rounded-md transition-colors whitespace-nowrap ${
              mode === 'image'
                ? 'bg-white dark:bg-gray-900 text-blue-600 dark:text-blue-400 shadow-xs'
                : 'text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white'
            }`}
          >
            Image
          </button>
        </div>

        {/* Single Dominant Primary CTA */}
        <button
          type="button"
          onClick={onGenerate}
          disabled={isGenerating}
          className="px-4 py-2 min-h-[38px] text-xs sm:text-sm font-semibold rounded-lg bg-blue-600 hover:bg-blue-700 disabled:opacity-60 text-white shadow-xs transition-colors whitespace-nowrap shrink-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
        >
          {isGenerating
            ? mode === 'story'
              ? 'Writing Story...'
              : 'Generating Images...'
            : mode === 'story'
              ? 'Generate Story'
              : 'Generate Images'}
        </button>
      </div>
    </footer>
  );
};

export default WorkspaceBottomBar;
