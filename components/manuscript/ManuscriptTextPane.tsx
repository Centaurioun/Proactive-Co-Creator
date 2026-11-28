/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { type RefObject } from 'react';
import type { CreativeProject } from '../../shared/types';
import type { ManuscriptSection } from '../../shared/narrativeTypes';
import type { ReadingMarginNote } from '../../shared/creativeSessionTypes';
import { SafeMarkdownReader } from './SafeMarkdownReader';

interface ManuscriptTextPaneProps {
  project: CreativeProject;
  textarea: RefObject<HTMLTextAreaElement | null>;
  selected: ManuscriptSection | undefined;
  focus: boolean;
  previewSection: boolean;
  saving: boolean;
  isComposing: boolean;
  buttonClassName: string;
  fieldClassName: string;
  marginNotes?: ReadingMarginNote[];
  onSaveMarginNotes?: (notes: ReadingMarginNote[]) => void;
  onExplorePassageInStudio?: (payload: {
    sectionId: string;
    sectionTitle: string;
    startOffset: number;
    endOffset: number;
    selectedText: string;
    initialGoal?: string;
  }) => void;
  onAskQaAboutPassage?: (query: string) => void;
  onTogglePreview: () => void;
  onSelectionChange: (start: number, end: number) => void;
  onScrollEditor: (editor: HTMLTextAreaElement) => void;
  onChangeText: (text: string) => void;
  onCompositionStart: () => void;
  onCompositionEnd: (start: number, end: number) => void;
  onFocus: () => void;
  onBlur: (hasRelatedTarget: boolean) => void;
}

const ManuscriptTextPane: React.FC<ManuscriptTextPaneProps> = ({
  project,
  textarea,
  selected,
  focus,
  previewSection,
  saving,
  isComposing,
  buttonClassName,
  fieldClassName,
  marginNotes = [],
  onSaveMarginNotes,
  onExplorePassageInStudio,
  onAskQaAboutPassage,
  onTogglePreview,
  onSelectionChange,
  onScrollEditor,
  onChangeText,
  onCompositionStart,
  onCompositionEnd,
  onFocus,
  onBlur,
}) => {
  return (
    <div className="block text-sm">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="font-medium text-pcc-ink dark:text-pcc-dark-ink">Manuscript text</span>
        <span className="text-[11px] text-pcc-muted dark:text-pcc-dark-muted">
          Canonical Draft ({previewSection ? 'Read Mode + Margin Notes' : 'Markdown Source'})
        </span>
      </div>
      <div className="mt-1 flex flex-wrap items-center justify-between gap-2">
        <span id="manuscript-markdown-hint" className="text-xs text-gray-600 dark:text-gray-300">
          Markdown remains literal source text; Read Mode formats safely without interpreting raw HTML.
        </span>
        {!focus && (
          <button
            type="button"
            data-testid="toggle-manuscript-read-mode-btn"
            className={buttonClassName}
            disabled={isComposing}
            aria-pressed={previewSection}
            onClick={onTogglePreview}
          >
            {previewSection ? 'Back to Edit' : 'Read Mode & Notes'}
          </button>
        )}
      </div>
      {previewSection ? (
        selected ? (
          <div className="mt-2">
            <SafeMarkdownReader
              project={project}
              section={selected}
              marginNotes={marginNotes}
              onSaveMarginNotes={(notes) => onSaveMarginNotes?.(notes)}
              onExplorePassageInStudio={onExplorePassageInStudio}
              onAskQaAboutPassage={onAskQaAboutPassage}
            />
          </div>
        ) : (
          <div
            aria-label="Section preview"
            className="pcc-editorial mt-2 min-h-[40vh] rounded-md border border-pcc-line bg-pcc-canvas p-5 text-sm text-pcc-muted dark:border-pcc-dark-line dark:bg-pcc-dark-canvas dark:text-pcc-dark-muted"
          >
            Nothing to preview yet. Switch back to Edit to begin drafting.
          </div>
        )
      ) : (
        <textarea
          ref={textarea}
          aria-label="Manuscript text"
          aria-describedby="manuscript-markdown-hint"
          className={`${fieldClassName} pcc-editorial mt-2 min-h-[56vh] resize-y border-pcc-line bg-pcc-canvas p-5 text-[17px] leading-[1.7] focus-visible:ring-2 focus-visible:ring-pcc-focus dark:border-pcc-dark-line dark:bg-pcc-dark-canvas`}
          value={selected?.text ?? ''}
          readOnly={saving}
          placeholder="Start writing here…"
          onSelect={(event) =>
            onSelectionChange(
              event.currentTarget.selectionStart ?? 0,
              event.currentTarget.selectionEnd ?? 0
            )
          }
          onKeyUp={(event) =>
            onSelectionChange(
              event.currentTarget.selectionStart ?? 0,
              event.currentTarget.selectionEnd ?? 0
            )
          }
          onMouseUp={(event) =>
            onSelectionChange(
              event.currentTarget.selectionStart ?? 0,
              event.currentTarget.selectionEnd ?? 0
            )
          }
          onScroll={(event) => onScrollEditor(event.currentTarget)}
          onChange={(event) => {
            onSelectionChange(
              event.currentTarget.selectionStart ?? 0,
              event.currentTarget.selectionEnd ?? 0
            );
            onChangeText(event.target.value);
          }}
          onCompositionStart={onCompositionStart}
          onCompositionEnd={(event) =>
            onCompositionEnd(
              event.currentTarget.selectionStart,
              event.currentTarget.selectionEnd
            )
          }
          onFocus={onFocus}
          onBlur={(event) => onBlur(Boolean(event.relatedTarget))}
          spellCheck
        />
      )}
    </div>
  );
};

export default ManuscriptTextPane;

