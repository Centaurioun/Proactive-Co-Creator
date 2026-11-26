/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import type { DecisionItem } from '../../../shared/types';

interface DecisionListItemProps {
  item: DecisionItem;
  isChecked: boolean;
  activeValue: string;
  isCustomOpen: boolean;
  onToggleSelect: (id: string) => void;
  onInspectTarget: (item: DecisionItem) => void;
  onChangeDraftValue: (id: string, value: string) => void;
  onToggleCustomOpen: (id: string | null) => void;
  onSingleAction: (id: string, action: 'accept' | 'reject' | 'defer', overrideValue?: string) => void;
}

export const DecisionListItem: React.FC<DecisionListItemProps> = ({
  item,
  isChecked,
  activeValue,
  isCustomOpen,
  onToggleSelect,
  onInspectTarget,
  onChangeDraftValue,
  onToggleCustomOpen,
  onSingleAction,
}) => (
  <div
    className={`p-3.5 transition-colors ${
      isChecked
        ? 'bg-blue-50/40 dark:bg-blue-950/20'
        : 'hover:bg-gray-50/60 dark:hover:bg-gray-800/40'
    }`}
  >
    <div className="flex items-center justify-between gap-2 text-[11px] text-gray-500 dark:text-gray-400 mb-1">
      <div className="flex items-center gap-1.5 truncate">
        <input
          type="checkbox"
          checked={isChecked}
          onChange={() => onToggleSelect(item.id)}
          aria-label={`Select decision: ${item.title}`}
          className="rounded border-gray-300 text-blue-600 focus:ring-blue-500 mr-1"
        />
        <span className="capitalize">{item.category.replace('-', ' ')}</span>
        <span aria-hidden="true">·</span>
        <span className="capitalize">{item.status}</span>
        {item.targetEntityName && (
          <>
            <span aria-hidden="true">·</span>
            <button
              type="button"
              onClick={() => onInspectTarget(item)}
              className="text-blue-600 dark:text-blue-400 hover:underline truncate"
            >
              {item.targetEntityName}
            </button>
          </>
        )}
      </div>
    </div>

    <h3 className="text-xs sm:text-sm font-semibold text-gray-900 dark:text-gray-100 mb-1 leading-snug">
      {item.title}
    </h3>

    <p className="text-xs text-gray-600 dark:text-gray-400 mb-2.5">
      {item.description}
    </p>

    {item.options && item.options.length > 0 && (
      <div
        role="group"
        aria-label={`Options for ${item.title}`}
        className="flex flex-wrap gap-1.5 mb-2.5"
      >
        {item.options.map((opt) => {
          const isSelectedOpt = activeValue === opt;
          return (
            <button
              key={opt}
              type="button"
              onClick={() => onChangeDraftValue(item.id, opt)}
              aria-pressed={isSelectedOpt}
              className={`px-2.5 py-1 text-xs rounded border transition-colors ${
                isSelectedOpt
                  ? 'bg-blue-50 dark:bg-blue-900/50 border-blue-500 text-blue-800 dark:text-blue-100 font-semibold'
                  : 'bg-white dark:bg-gray-800 border-gray-300 dark:border-gray-700 text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700'
              }`}
            >
              {opt}
            </button>
          );
        })}
        <button
          type="button"
          onClick={() => onToggleCustomOpen(isCustomOpen ? null : item.id)}
          className="px-2 py-1 text-xs rounded border border-dashed border-gray-300 dark:border-gray-700 text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white"
        >
          Custom...
        </button>
      </div>
    )}

    {isCustomOpen && (
      <div className="mb-2.5 flex gap-1.5">
        <input
          type="text"
          value={activeValue}
          onChange={(e) => onChangeDraftValue(item.id, e.target.value)}
          placeholder="Enter custom value..."
          aria-label={`Custom value for ${item.title}`}
          className="flex-1 text-xs bg-white dark:bg-gray-800 border border-blue-500 rounded px-2.5 py-1.5 text-gray-900 dark:text-gray-100 focus:outline-none"
        />
        <button
          type="button"
          onClick={() => {
            onToggleCustomOpen(null);
            onSingleAction(item.id, 'accept', activeValue);
          }}
          className="px-2.5 py-1.5 text-xs font-semibold bg-blue-600 text-white rounded"
        >
          Save &amp; Accept
        </button>
      </div>
    )}

    <div className="flex items-center justify-between gap-2 pt-1">
      <div className="flex items-center gap-1.5">
        <button
          type="button"
          onClick={() => onSingleAction(item.id, 'accept', activeValue)}
          className="px-2.5 py-1 text-xs font-semibold bg-blue-600 hover:bg-blue-700 text-white rounded transition-colors whitespace-nowrap"
        >
          Accept
        </button>
        <button
          type="button"
          onClick={() => onSingleAction(item.id, 'defer')}
          className="px-2 py-1 text-xs font-medium text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-800 rounded transition-colors whitespace-nowrap"
        >
          Defer
        </button>
        <button
          type="button"
          onClick={() => onSingleAction(item.id, 'reject')}
          className="px-2 py-1 text-xs font-medium text-gray-500 hover:text-red-600 dark:text-gray-400 dark:hover:text-red-400 rounded transition-colors whitespace-nowrap"
        >
          Reject
        </button>
      </div>

      {(item.targetEntityName || item.targetStoryField || item.targetRelationshipId) && (
        <button
          type="button"
          onClick={() => onInspectTarget(item)}
          className="text-xs text-gray-500 dark:text-gray-400 hover:text-blue-600 dark:hover:text-blue-400 whitespace-nowrap"
        >
          Inspect &rarr;
        </button>
      )}
    </div>
  </div>
);
