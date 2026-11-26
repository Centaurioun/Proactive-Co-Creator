/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { type RefObject } from 'react';
import type { ManuscriptSection } from '../../shared/narrativeTypes';

interface ManuscriptTextPaneProps {
  textarea: RefObject<HTMLTextAreaElement | null>;
  selected: ManuscriptSection | undefined;
  focus: boolean;
  previewSection: boolean;
  saving: boolean;
  isComposing: boolean;
  buttonClassName: string;
  fieldClassName: string;
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
  textarea,
  selected,
  focus,
  previewSection,
  saving,
  isComposing,
  buttonClassName,
  fieldClassName,
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
    <label className="block text-sm">
      Manuscript text
      <div className="mt-1 flex flex-wrap items-center justify-between gap-2">
        <span id="manuscript-markdown-hint" className="text-xs text-gray-600 dark:text-gray-300">
          Markdown remains literal source text; preview displays it safely without interpreting HTML.
        </span>
        {!focus && (
          <button
            type="button"
            className={buttonClassName}
            disabled={isComposing}
            aria-pressed={previewSection}
            onClick={onTogglePreview}
          >
            {previewSection ? 'Edit section' : 'Preview section'}
          </button>
        )}
      </div>
      {previewSection ? (
        <pre
          aria-label="Section preview"
          className="pcc-editorial mt-2 min-h-[56vh] overflow-auto whitespace-pre-wrap break-words rounded-md border border-pcc-line bg-pcc-canvas p-5 text-[17px] leading-[1.7] dark:border-pcc-dark-line dark:bg-pcc-dark-canvas"
        >
          {selected?.text || 'Nothing to preview yet.'}
        </pre>
      ) : (
        <textarea
          ref={textarea}
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
    </label>
  );
};

export default ManuscriptTextPane;
