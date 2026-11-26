/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import type { CreativeProject } from '../../shared/types';
import type { ManuscriptSection } from '../../shared/narrativeTypes';
import type { NarrativeBase } from '../../lib/narrative/manuscriptModel';

interface ManuscriptHeaderBarProps {
  project: CreativeProject;
  words: number;
  focus: boolean;
  enabled: boolean;
  saving: boolean;
  adopting: boolean;
  isComposing: boolean;
  hasDraft: boolean;
  draft: { base: NarrativeBase; sections: ManuscriptSection[] } | null;
  canUndo: boolean;
  canRedo: boolean;
  storyCount: number;
  error: string;
  buttonClassName: string;
  onToggleFocus: () => void;
  onUndo: () => void;
  onRedo: () => void;
  onSaveDraft: () => void;
  onStartAdopting: () => void;
  onExportDraft: () => void;
  onDiscardDraft: () => void;
}

const ManuscriptHeaderBar: React.FC<ManuscriptHeaderBarProps> = ({
  project,
  words,
  focus,
  enabled,
  saving,
  adopting,
  isComposing,
  hasDraft,
  canUndo,
  canRedo,
  storyCount,
  error,
  buttonClassName,
  onToggleFocus,
  onUndo,
  onRedo,
  onSaveDraft,
  onStartAdopting,
  onExportDraft,
  onDiscardDraft,
}) => {
  return (
    <>
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0">
          <h1 className="font-display text-xl font-semibold tracking-tight">Working Manuscript</h1>
          <p className="break-words text-sm text-gray-600 dark:text-gray-300">
            {project.name} · {words} words
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            className={buttonClassName}
            aria-pressed={focus}
            disabled={isComposing}
            onClick={onToggleFocus}
          >
            {focus ? 'Return to writing' : 'Focus mode'}
          </button>
          {!focus && (
            <button
              type="button"
              className={buttonClassName}
              disabled={!enabled || hasDraft || !canUndo}
              onClick={onUndo}
            >
              Undo
            </button>
          )}
          {!focus && (
            <button
              type="button"
              className={buttonClassName}
              disabled={!enabled || hasDraft || !canRedo}
              onClick={onRedo}
            >
              Redo
            </button>
          )}
        </div>
      </header>
      {!enabled && (
        <p role="status" className="mt-3">
          Writing requires available IndexedDB and a verified workspace load.
        </p>
      )}
      <div className="my-4 flex flex-wrap items-center gap-3">
        <button
          type="button"
          className={buttonClassName}
          disabled={!hasDraft || saving || !enabled || isComposing || adopting}
          onClick={onSaveDraft}
        >
          Save manuscript
        </button>
        <span role="status" className="text-sm">
          {saving
            ? 'Saving…'
            : hasDraft
              ? 'Unsaved draft'
              : project.persistedRevision === project.revision
                ? 'Saved'
                : 'Project changes pending'}
        </span>
        {storyCount > 0 && (
          <button
            type="button"
            className={buttonClassName}
            disabled={!enabled || saving || hasDraft || isComposing}
            onClick={onStartAdopting}
          >
            Adopt generated story
          </button>
        )}
      </div>
      {error && (
        <p role="alert" className="mb-3 break-words text-red-700 dark:text-red-300">
          {error}
        </p>
      )}
      {hasDraft && !saving && !adopting && (
        <div className="mb-3 flex flex-wrap gap-2">
          <button type="button" className={buttonClassName} onClick={onExportDraft}>
            Export draft
          </button>
          <button type="button" className={buttonClassName} onClick={onDiscardDraft}>
            Discard draft
          </button>
        </div>
      )}
    </>
  );
};

export default ManuscriptHeaderBar;
