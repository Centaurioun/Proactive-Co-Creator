/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useId } from 'react';
import { getHighestProbabilityValue } from '../lib/beliefGraphUtils';
import type { Attribute, Entity } from '../shared/types';

export interface AttributeEditorProps {
  attribute: Attribute;
  entity: Entity;
  onChange: (entityName: string, attributeName: string, newValue: string) => void;
  isLoading: boolean;
  pendingValue?: string;
}

const AttributeEditor: React.FC<AttributeEditorProps> = ({
  attribute,
  entity,
  onChange,
  isLoading,
  pendingValue,
}) => {
  const [customDraft, setCustomDraft] = useState<{ attr: Attribute; value: string } | null>(
    null
  );
  const isCustomMode = customDraft?.attr === attribute;
  const customValue = isCustomMode ? customDraft.value : '';
  const controlId = useId();

  const isExistence =
    attribute.name === 'existence' || attribute.name === 'existence_in_image';

  let currentValue = pendingValue;
  if (currentValue === undefined) {
    if (isExistence) {
      currentValue = getHighestProbabilityValue(attribute);
      if (currentValue === 'Unknown') currentValue = 'true';
    } else {
      currentValue = attribute.presence_in_prompt
        ? getHighestProbabilityValue(attribute)
        : 'Unknown';
    }
  }

  const isModified = pendingValue !== undefined;

  if (isExistence) {
    const isPresent = currentValue === 'true';
    return (
      <div className="grid grid-cols-[110px_1fr] sm:grid-cols-[130px_1fr] gap-3 items-center py-2.5 border-b border-gray-100 dark:border-gray-700 last:border-0 px-2 rounded-lg">
        <span className="text-gray-700 dark:text-gray-300 font-medium text-xs sm:text-sm">
          Existence
        </span>
        <div
          role="group"
          aria-label={`${entity.name} existence`}
          className={`flex rounded-md border overflow-hidden w-full ${
            isModified
              ? 'border-blue-500 ring-1 ring-blue-300 dark:ring-blue-800'
              : 'border-gray-300 dark:border-gray-600'
          }`}
        >
          <button
            type="button"
            onClick={() => onChange(entity.name, attribute.name, 'true')}
            disabled={isLoading}
            aria-pressed={isPresent}
            className={`w-1/2 text-xs font-semibold py-2 px-2 transition-colors truncate disabled:cursor-not-allowed disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-blue-500 ${
              isPresent
                ? 'bg-emerald-600 text-white'
                : 'bg-white dark:bg-gray-800 text-gray-700 dark:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-700'
            }`}
          >
            Present
          </button>
          <button
            type="button"
            onClick={() => onChange(entity.name, attribute.name, 'false')}
            disabled={isLoading}
            aria-pressed={!isPresent}
            className={`w-1/2 text-xs font-semibold py-2 px-2 transition-colors truncate disabled:cursor-not-allowed disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-blue-500 ${
              !isPresent
                ? 'bg-red-600 text-white'
                : 'bg-white dark:bg-gray-800 text-gray-700 dark:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-700'
            }`}
          >
            Absent
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="grid grid-cols-[110px_1fr] sm:grid-cols-[130px_1fr] gap-3 items-center py-2.5 border-b border-gray-100 dark:border-gray-700 last:border-0 px-2 rounded-lg">
      <label
        htmlFor={controlId}
        className="text-gray-700 dark:text-gray-300 font-medium text-xs sm:text-sm capitalize leading-tight flex flex-col"
      >
        <span>{attribute.name.replace(/_/g, ' ')}</span>
        {isModified && (
          <span className="text-[11px] font-semibold text-blue-600 dark:text-blue-400 normal-case">
            Edited
          </span>
        )}
      </label>

      <div className="w-full">
        {isCustomMode ? (
          <div className="flex gap-1.5 items-center">
            <input
              id={controlId}
              type="text"
              autoFocus
              value={customValue}
              onChange={(e) => setCustomDraft({ attr: attribute, value: e.target.value })}
              placeholder="Type value..."
              className="w-full bg-white dark:bg-gray-700 border border-blue-500 text-gray-900 dark:text-gray-100 text-sm rounded-md px-2.5 py-1.5 focus:outline-none focus:ring-2 focus:ring-blue-500"
              onKeyDown={(e) => {
                if (e.key === 'Enter' && customValue.trim()) {
                  onChange(entity.name, attribute.name, customValue.trim());
                  setCustomDraft(null);
                } else if (e.key === 'Escape') {
                  setCustomDraft(null);
                }
              }}
              disabled={isLoading}
            />
            <button
              type="button"
              onClick={() => {
                if (customValue.trim()) {
                  onChange(entity.name, attribute.name, customValue.trim());
                  setCustomDraft(null);
                }
              }}
              disabled={isLoading || !customValue.trim()}
              className="bg-blue-600 text-white hover:bg-blue-700 text-xs font-semibold px-2.5 py-2 rounded-md disabled:bg-gray-300 dark:disabled:bg-gray-600 whitespace-nowrap"
            >
              Save
            </button>
            <button
              type="button"
              onClick={() => setCustomDraft(null)}
              className="text-gray-500 hover:text-gray-800 dark:text-gray-400 dark:hover:text-gray-100 px-2 py-1.5 rounded-md text-sm"
              aria-label="Cancel custom value"
              disabled={isLoading}
            >
              &times;
            </button>
          </div>
        ) : (
          <div className="relative">
            <select
              id={controlId}
              value={currentValue}
              onChange={(e) => {
                if (e.target.value === '__custom__') {
                  setCustomDraft({ attr: attribute, value: '' });
                } else {
                  onChange(entity.name, attribute.name, e.target.value);
                }
              }}
              disabled={isLoading}
              className={`w-full text-gray-900 dark:text-gray-100 text-sm rounded-md px-3 py-2 pr-8 appearance-none focus:outline-none focus:ring-2 focus:ring-blue-500 cursor-pointer transition-colors ${
                isModified
                  ? 'border-blue-500 bg-blue-50 dark:bg-blue-900/30 border'
                  : 'border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 border hover:border-gray-400 dark:hover:border-gray-500'
              }`}
            >
              <option value="Unknown" disabled={currentValue !== 'Unknown'}>
                Unknown
              </option>
              {attribute.value.map((v) => (
                <option key={v.name} value={v.name}>
                  {v.name}
                </option>
              ))}
              {isModified &&
                currentValue !== 'Unknown' &&
                !attribute.value.some((v) => v.name === currentValue) && (
                  <option value={currentValue}>{currentValue}</option>
                )}
              <option
                value="__custom__"
                className="font-semibold text-blue-600 dark:text-blue-400 bg-gray-50 dark:bg-gray-800"
              >
                + Type custom...
              </option>
            </select>
            <div className="pointer-events-none absolute inset-y-0 right-0 flex items-center px-2 text-gray-500 dark:text-gray-400">
              <svg
                className="h-4 w-4"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
                aria-hidden="true"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth="2"
                  d="M19 9l-7 7-7-7"
                />
              </svg>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default AttributeEditor;
