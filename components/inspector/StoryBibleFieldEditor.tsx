/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import type { StoryBibleField, StoryBibleFields } from '../../shared/types';
import type { StoryBibleFieldConfig } from './storyBibleConfig';

interface StoryBibleFieldEditorProps {
  config: StoryBibleFieldConfig;
  field: StoryBibleField<string>;
  fieldError?: string;
  variant: 'grid' | 'list';
  onUpdateStoryBible: (field: keyof StoryBibleFields, value: string) => void;
}

const StoryBibleFieldEditor: React.FC<StoryBibleFieldEditorProps> = ({
  config,
  field,
  fieldError,
  variant,
  onUpdateStoryBible,
}) => {
  const { key, label, shortLabel, span, placeholder, multiline, examples } = config;
  const inputErrorId = `bible-error-${key}`;
  const hasValue = field.value.trim().length > 0;
  const isConfirmed = hasValue && field.status === 'confirmed';
  const isPending = hasValue && field.status === 'pending';

  const inputClassBase =
    variant === 'grid'
      ? 'w-full text-xs bg-white dark:bg-gray-900 border rounded text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2'
      : 'w-full text-xs bg-gray-50 dark:bg-gray-800 border rounded-md text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2';
  const errorRing = fieldError
    ? 'border-red-500 focus:ring-red-500'
    : 'border-gray-300 dark:border-gray-700 focus:ring-blue-500';

  const control = multiline ? (
    <textarea
      id={`bible-${key}`}
      rows={2}
      value={field.value}
      onChange={(e) => onUpdateStoryBible(key, e.target.value)}
      placeholder={placeholder}
      aria-invalid={Boolean(fieldError)}
      aria-describedby={fieldError ? inputErrorId : undefined}
      className={`${inputClassBase} p-2 ${variant === 'grid' ? 'resize-y' : ''} ${errorRing}`}
    />
  ) : (
    <input
      id={`bible-${key}`}
      type="text"
      value={field.value}
      onChange={(e) => onUpdateStoryBible(key, e.target.value)}
      onBlur={(e) => {
        if (e.target.value !== e.target.value.trim()) {
          onUpdateStoryBible(key, e.target.value.trim());
        }
      }}
      placeholder={placeholder}
      aria-invalid={Boolean(fieldError)}
      aria-describedby={fieldError ? inputErrorId : undefined}
      className={`${inputClassBase} ${variant === 'grid' ? 'px-2 py-1.5' : 'px-2.5 py-1.5'} ${errorRing}`}
    />
  );

  if (variant === 'list') {
    return (
      <div className="space-y-1">
        <div className="flex items-center justify-between text-xs">
          <label
            htmlFor={`bible-${key}`}
            className="font-semibold text-gray-800 dark:text-gray-200"
          >
            {label}
          </label>
          <div className="text-[11px] text-gray-500 dark:text-gray-400 flex items-center gap-1.5">
            <span className="capitalize">{hasValue ? field.status : 'unset'}</span>
            <span aria-hidden="true">·</span>
            <span>{field.provenance}</span>
            {field.status !== 'confirmed' && hasValue && (
              <button
                type="button"
                onClick={() => onUpdateStoryBible(key, field.value)}
                className="text-blue-600 dark:text-blue-400 font-semibold hover:underline ml-1"
              >
                Confirm
              </button>
            )}
            {hasValue && (
              <button
                type="button"
                onClick={() => onUpdateStoryBible(key, '')}
                className="text-gray-500 hover:text-red-600 dark:hover:text-red-400 font-medium ml-1"
                title={`Clear ${shortLabel}`}
              >
                Clear
              </button>
            )}
          </div>
        </div>
        {control}
        {fieldError && (
          <p
            id={inputErrorId}
            role="alert"
            className="text-[11px] font-medium text-red-600 dark:text-red-400"
          >
            {fieldError}
          </p>
        )}
      </div>
    );
  }

  return (
    <div
      className={`${
        span === 'full' ? 'sm:col-span-2' : 'col-span-1'
      } min-w-0 overflow-hidden rounded-md border p-2.5 flex flex-col justify-between gap-1.5 transition-colors ${
        isConfirmed
          ? 'border-emerald-200 dark:border-emerald-900/70 bg-emerald-50/20 dark:bg-emerald-950/15'
          : isPending
            ? 'border-amber-300 dark:border-amber-800 border-dashed bg-amber-50/25 dark:bg-amber-950/15'
            : 'border-gray-200 dark:border-gray-800 bg-gray-50/40 dark:bg-gray-950/30'
      }`}
    >
      <div className="flex items-center justify-between gap-1.5 min-w-0">
        <label
          htmlFor={`bible-${key}`}
          title={label}
          className="text-xs font-semibold text-gray-900 dark:text-gray-100 truncate"
        >
          {shortLabel}
        </label>

        <span
          className={`text-[10px] px-1.5 py-0.2 rounded font-semibold uppercase tracking-wide shrink-0 ${
            isConfirmed
              ? 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950/80 dark:text-emerald-300'
              : isPending
                ? 'bg-amber-100 text-amber-800 dark:bg-amber-950/80 dark:text-amber-300'
                : 'bg-gray-200/70 text-gray-600 dark:bg-gray-800 dark:text-gray-400'
          }`}
        >
          {isConfirmed ? 'Confirmed' : isPending ? 'Pending' : 'Unset'}
        </span>
      </div>

      {control}

      {fieldError && (
        <p
          id={inputErrorId}
          role="alert"
          className="text-[11px] font-medium text-red-600 dark:text-red-400"
        >
          {fieldError}
        </p>
      )}

      {/* Provenance, Quick Suggestion Chips & Confirm/Clear Actions */}
      <div className="flex flex-wrap items-center justify-between gap-1 pt-0.5 min-w-0">
        {!hasValue && examples && examples.length > 0 ? (
          <div className="flex flex-wrap items-center gap-1 min-w-0">
            {examples.slice(0, 1).map((example) => (
              <button
                key={example}
                type="button"
                onClick={() => onUpdateStoryBible(key, example)}
                className="text-[10px] px-1.5 py-0.5 rounded border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-600 dark:text-gray-300 hover:border-blue-400 hover:text-blue-600 dark:hover:text-blue-300 truncate max-w-full"
                title={`Set ${shortLabel} to "${example}"`}
              >
                + {example}
              </button>
            ))}
          </div>
        ) : (
          <span className="text-[10px] text-gray-400 dark:text-gray-500 truncate">
            {field.provenance}
          </span>
        )}

        <div className="flex items-center gap-1.5 ml-auto shrink-0">
          {isPending && (
            <button
              type="button"
              onClick={() => onUpdateStoryBible(key, field.value)}
              className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-blue-600 hover:bg-blue-700 text-white"
              title={`Confirm ${label}`}
            >
              Confirm
            </button>
          )}
          {hasValue && (
            <button
              type="button"
              onClick={() => onUpdateStoryBible(key, '')}
              className="text-[10px] text-gray-400 hover:text-red-600 dark:hover:text-red-400"
              title={`Clear ${shortLabel}`}
            >
              Clear
            </button>
          )}
        </div>
      </div>
    </div>
  );
};

export default StoryBibleFieldEditor;
