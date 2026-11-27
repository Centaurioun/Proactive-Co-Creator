/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import type { ManuscriptSection } from '../../shared/narrativeTypes';
import type { applyManuscriptOperation } from '../../lib/narrative/manuscriptModel';

interface SectionDetailFieldsProps {
  selected: ManuscriptSection;
  sections: ManuscriptSection[];
  chapters: ManuscriptSection[];
  index: number;
  saving: boolean;
  confirming: 'delete' | 'merge' | null;
  buttonClassName: string;
  fieldClassName: string;
  onOperate: (operation: Parameters<typeof applyManuscriptOperation>[1]) => void;
  onUpdate: (updates: Extract<Parameters<typeof applyManuscriptOperation>[1], { kind: 'edit' }>['updates']) => void;
  onSplitAtCursor: () => void;
  onSetConfirming: (mode: 'delete' | 'merge' | null) => void;
}

const SECTION_META_INPUTS = [
  ['location', 'Location'],
  ['characters', 'Characters'],
  ['chronology', 'Story chronology'],
  ['purpose', 'Purpose'],
] as const;

const SectionDetailFields: React.FC<SectionDetailFieldsProps> = ({
  selected,
  sections,
  chapters,
  index,
  saving,
  confirming,
  buttonClassName,
  fieldClassName,
  onOperate,
  onUpdate,
  onSplitAtCursor,
  onSetConfirming,
}) => {
  return (
    <fieldset disabled={saving} className="min-w-0 space-y-3">
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          className={buttonClassName}
          disabled={index <= 0}
          onClick={() => onOperate({ kind: 'move', id: selected.id, direction: -1 })}
        >
          Move up
        </button>
        <button
          type="button"
          className={buttonClassName}
          disabled={index >= sections.length - 1}
          onClick={() => onOperate({ kind: 'move', id: selected.id, direction: 1 })}
        >
          Move down
        </button>
        {selected.kind === 'scene' && (
          <>
            <button type="button" className={buttonClassName} onClick={onSplitAtCursor}>
              Split at cursor
            </button>
            <button
              type="button"
              className={buttonClassName}
              disabled={
                sections[index + 1]?.kind !== 'scene' ||
                sections[index + 1]?.chapterId !== selected.chapterId
              }
              onClick={() => onSetConfirming('merge')}
            >
              Merge with next
            </button>
          </>
        )}
        <button
          type="button"
          className={buttonClassName}
          onClick={() => onSetConfirming('delete')}
        >
          Delete section
        </button>
      </div>
      {confirming && (
        <div className="rounded border border-amber-400 p-3" role="group" aria-label="Confirm outline change">
          <p className="mb-2 text-sm">
            {confirming === 'delete'
              ? `Remove this ${selected.kind} and its ${selected.text.length} characters? Child scenes stay in the manuscript.`
              : `Merge this scene with “${sections[index + 1]?.title || 'Untitled scene'}”? Their text will be joined in order.`}
          </p>
          <button
            type="button"
            className={buttonClassName}
            onClick={() => {
              onOperate({ kind: confirming, id: selected.id });
              onSetConfirming(null);
            }}
          >
            Confirm {confirming}
          </button>{' '}
          <button
            type="button"
            className={buttonClassName}
            onClick={() => onSetConfirming(null)}
          >
            Cancel
          </button>
        </div>
      )}
      <details className="space-y-2">
        <summary className="cursor-pointer text-sm font-semibold">Section details</summary>
        {selected.kind === 'scene' && (
          <label className="block text-sm">
            Chapter
            <select
              className={fieldClassName}
              value={selected.chapterId ?? ''}
              onChange={(event) => onUpdate({ chapterId: event.target.value || undefined })}
            >
              <option value="">Unassigned</option>
              {chapters.map((section) => (
                <option key={section.id} value={section.id}>
                  {section.title || 'Untitled chapter'}
                </option>
              ))}
            </select>
          </label>
        )}
        <label className="block text-sm">
          Synopsis
          <input
            className={fieldClassName}
            value={selected.synopsis ?? ''}
            onChange={(event) => onUpdate({ synopsis: event.target.value })}
          />
        </label>
        <label className="block text-sm">
          Point of view
          <input
            className={fieldClassName}
            value={selected.pov ?? ''}
            onChange={(event) => onUpdate({ pov: event.target.value })}
          />
        </label>
        {SECTION_META_INPUTS.map(([key, label]) => (
          <label className="block text-sm" key={key}>
            {label}
            <input
              className={fieldClassName}
              value={selected[key] ?? ''}
              onChange={(event) => onUpdate({ [key]: event.target.value })}
            />
          </label>
        ))}
        <label className="block text-sm">
          Draft status
          <select
            className={fieldClassName}
            value={selected.status ?? ''}
            onChange={(event) =>
              onUpdate({ status: (event.target.value || undefined) as ManuscriptSection['status'] })
            }
          >
            <option value="">Unassigned</option>
            <option value="draft">Draft</option>
            <option value="revised">Revised</option>
            <option value="final">Final</option>
          </select>
        </label>
      </details>
    </fieldset>
  );
};

export default SectionDetailFields;
