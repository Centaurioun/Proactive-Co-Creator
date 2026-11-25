/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import type { StoryBible, StoryBibleFields } from '../../shared/types';
import {
  STORY_BIBLE_CONFIG,
  STORY_BIBLE_DOMAINS,
  type StoryBibleDomain,
} from './storyBibleConfig';

export type StoryBibleStatusFilter = 'all' | 'confirmed' | 'pending' | 'unset';

export interface StoryBiblePanelProps {
  storyBible: StoryBible;
  storyBibleErrors?: Partial<Record<keyof StoryBibleFields, string>>;
  viewMode: 'grid' | 'list';
  domainFilter: 'all' | StoryBibleDomain;
  statusFilter: StoryBibleStatusFilter;
  onChangeViewMode: (mode: 'grid' | 'list') => void;
  onChangeDomainFilter: (domain: 'all' | StoryBibleDomain) => void;
  onChangeStatusFilter: (status: StoryBibleStatusFilter) => void;
  onUpdateStoryBible: (field: keyof StoryBibleFields, value: string) => void;
}

const StoryBiblePanel: React.FC<StoryBiblePanelProps> = ({
  storyBible,
  storyBibleErrors,
  viewMode,
  domainFilter,
  statusFilter,
  onChangeViewMode,
  onChangeDomainFilter,
  onChangeStatusFilter,
  onUpdateStoryBible,
}) => {
  const bibleStats = STORY_BIBLE_CONFIG.reduce(
    (acc, item) => {
      const f = storyBible[item.key];
      const hasValue = f.value.trim().length > 0;
      if (!hasValue) {
        acc.unset += 1;
      } else if (f.status === 'confirmed') {
        acc.confirmed += 1;
      } else if (f.status === 'pending') {
        acc.pending += 1;
      } else {
        acc.unset += 1;
      }
      return acc;
    },
    { confirmed: 0, pending: 0, unset: 0 }
  );

  const pendingWithValues = STORY_BIBLE_CONFIG.filter(({ key }) => {
    const f = storyBible[key];
    return f.status === 'pending' && f.value.trim().length > 0;
  });

  const matchesFilters = (item: (typeof STORY_BIBLE_CONFIG)[number]) => {
    if (domainFilter !== 'all' && item.domain !== domainFilter) {
      return false;
    }
    const f = storyBible[item.key];
    const hasValue = f.value.trim().length > 0;
    if (statusFilter === 'confirmed') {
      return hasValue && f.status === 'confirmed';
    }
    if (statusFilter === 'pending') {
      return hasValue && f.status === 'pending';
    }
    if (statusFilter === 'unset') {
      return !hasValue;
    }
    return true;
  };

  const filteredItems = STORY_BIBLE_CONFIG.filter(matchesFilters);

  return (
    <div className="flex-1 overflow-y-auto p-3.5 space-y-3 min-h-0">
      {/* Story Bible Header & View Switcher */}
      <div className="flex flex-wrap items-start justify-between gap-2 pb-2.5 border-b border-gray-200 dark:border-gray-800">
        <div>
          <h3 className="font-display text-sm font-bold text-gray-900 dark:text-gray-100">
            Synchronized Story Bible
          </h3>
          <p className="text-[11px] text-gray-500 dark:text-gray-400 mt-0.5 tabular-nums">
            <span className="font-semibold text-emerald-700 dark:text-emerald-400">
              {bibleStats.confirmed} confirmed
            </span>
            <span aria-hidden="true"> · </span>
            <span className="font-semibold text-amber-700 dark:text-amber-400">
              {bibleStats.pending} pending
            </span>
            <span aria-hidden="true"> · </span>
            <span>{bibleStats.unset} unset</span>
          </p>
        </div>

        <div className="flex items-center gap-1.5">
          {pendingWithValues.length > 0 && (
            <button
              type="button"
              onClick={() => {
                for (const item of pendingWithValues) {
                  onUpdateStoryBible(item.key, storyBible[item.key].value);
                }
              }}
              className="px-2 py-1 text-[11px] font-semibold rounded bg-emerald-600 hover:bg-emerald-700 text-white transition-colors whitespace-nowrap"
            >
              Confirm Pending ({pendingWithValues.length})
            </button>
          )}

          <div
            role="group"
            aria-label="Story Bible layout mode"
            className="flex bg-gray-100 dark:bg-gray-800 p-0.5 rounded-md border border-gray-200 dark:border-gray-700"
          >
            <button
              type="button"
              onClick={() => onChangeViewMode('grid')}
              aria-pressed={viewMode === 'grid'}
              className={`px-2 py-0.5 text-[11px] font-semibold rounded transition-colors ${
                viewMode === 'grid'
                  ? 'bg-white dark:bg-gray-900 text-blue-600 dark:text-blue-400 shadow-xs'
                  : 'text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white'
              }`}
            >
              Grid
            </button>
            <button
              type="button"
              onClick={() => onChangeViewMode('list')}
              aria-pressed={viewMode === 'list'}
              className={`px-2 py-0.5 text-[11px] font-semibold rounded transition-colors ${
                viewMode === 'list'
                  ? 'bg-white dark:bg-gray-900 text-blue-600 dark:text-blue-400 shadow-xs'
                  : 'text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white'
              }`}
            >
              List
            </button>
          </div>
        </div>
      </div>

      {/* Domain & Status Filters */}
      <div className="flex flex-wrap items-center justify-between gap-1.5">
        <div
          role="group"
          aria-label="Filter Story Bible by domain"
          className="flex flex-wrap gap-1"
        >
          {(
            [
              ['all', 'All'],
              ['core', 'World'],
              ['narrative', 'Arc & Voice'],
              ['constraints', 'Rules'],
              ['visual', 'Visual'],
            ] as const
          ).map(([domainKey, domainLabel]) => (
            <button
              key={domainKey}
              type="button"
              onClick={() => onChangeDomainFilter(domainKey)}
              aria-pressed={domainFilter === domainKey}
              className={`px-2 py-0.5 text-[11px] font-medium rounded border transition-colors ${
                domainFilter === domainKey
                  ? 'border-blue-500 bg-blue-50 dark:bg-blue-950/60 text-blue-700 dark:text-blue-300 font-semibold'
                  : 'border-gray-200 dark:border-gray-800 bg-gray-50 dark:bg-gray-800/60 text-gray-600 dark:text-gray-400 hover:text-gray-900'
              }`}
            >
              {domainLabel}
            </button>
          ))}
        </div>

        <select
          aria-label="Filter Story Bible by status"
          value={statusFilter}
          onChange={(e) => onChangeStatusFilter(e.target.value as StoryBibleStatusFilter)}
          className="text-[11px] bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-700 rounded px-2 py-0.5 text-gray-700 dark:text-gray-200"
        >
          <option value="all">All ({STORY_BIBLE_CONFIG.length})</option>
          <option value="confirmed">Confirmed ({bibleStats.confirmed})</option>
          <option value="pending">Pending ({bibleStats.pending})</option>
          <option value="unset">Unset ({bibleStats.unset})</option>
        </select>
      </div>

      {filteredItems.length === 0 ? (
        <div className="p-4 text-center rounded-md border border-gray-200 dark:border-gray-800 bg-gray-50/50 dark:bg-gray-950/40 text-xs text-gray-500 dark:text-gray-400">
          No Story Bible fields match the active filter.
        </div>
      ) : viewMode === 'grid' ? (
        /* Structured Domain-Grouped Editable Grid View */
        <div
          className="space-y-4"
          role="region"
          aria-label="Story Bible structured grid"
        >
          {STORY_BIBLE_DOMAINS.map((domainMeta) => {
            const domainFields = filteredItems.filter(
              (item) => item.domain === domainMeta.id
            );
            if (domainFields.length === 0) return null;

            return (
              <section
                key={domainMeta.id}
                aria-label={domainMeta.label}
                className="space-y-2"
              >
                <div className="flex items-center justify-between gap-2">
                  <h4
                    title={domainMeta.description}
                    className="text-[11px] font-bold uppercase tracking-wider text-gray-600 dark:text-gray-300"
                  >
                    {domainMeta.label}
                  </h4>
                  <span className="text-[10px] text-gray-400 dark:text-gray-500 tabular-nums">
                    {domainFields.length} {domainFields.length === 1 ? 'field' : 'fields'}
                  </span>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                  {domainFields.map(
                    ({
                      key,
                      label,
                      shortLabel,
                      span,
                      placeholder,
                      multiline,
                      examples,
                    }) => {
                      const field = storyBible[key];
                      const fieldError = storyBibleErrors?.[key];
                      const inputErrorId = `bible-error-${key}`;
                      const hasValue = field.value.trim().length > 0;
                      const isConfirmed = hasValue && field.status === 'confirmed';
                      const isPending = hasValue && field.status === 'pending';

                      return (
                        <div
                          key={key}
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
                              {isConfirmed
                                ? 'Confirmed'
                                : isPending
                                  ? 'Pending'
                                  : 'Unset'}
                            </span>
                          </div>

                          {multiline ? (
                            <textarea
                              id={`bible-${key}`}
                              rows={2}
                              value={field.value}
                              onChange={(e) => onUpdateStoryBible(key, e.target.value)}
                              placeholder={placeholder}
                              aria-invalid={Boolean(fieldError)}
                              aria-describedby={fieldError ? inputErrorId : undefined}
                              className={`w-full text-xs bg-white dark:bg-gray-900 border rounded p-2 text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 resize-y ${
                                fieldError
                                  ? 'border-red-500 focus:ring-red-500'
                                  : 'border-gray-300 dark:border-gray-700 focus:ring-blue-500'
                              }`}
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
                              className={`w-full text-xs bg-white dark:bg-gray-900 border rounded px-2 py-1.5 text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 ${
                                fieldError
                                  ? 'border-red-500 focus:ring-red-500'
                                  : 'border-gray-300 dark:border-gray-700 focus:ring-blue-500'
                              }`}
                            />
                          )}
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
                    }
                  )}
                </div>
              </section>
            );
          })}
        </div>
      ) : (
        /* Classic Compact Vertical List View */
        <div className="space-y-3" role="region" aria-label="Story Bible list">
          {filteredItems.map(({ key, label, shortLabel, placeholder, multiline }) => {
            const field = storyBible[key];
            const fieldError = storyBibleErrors?.[key];
            const hasValue = Boolean(field.value.trim());
            const inputErrorId = `bible-error-${key}`;
            return (
              <div key={key} className="space-y-1">
                <div className="flex items-center justify-between text-xs">
                  <label
                    htmlFor={`bible-${key}`}
                    className="font-semibold text-gray-800 dark:text-gray-200"
                  >
                    {label}
                  </label>
                  <div className="text-[11px] text-gray-500 dark:text-gray-400 flex items-center gap-1.5">
                    <span className="capitalize">
                      {hasValue ? field.status : 'unset'}
                    </span>
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
                {multiline ? (
                  <textarea
                    id={`bible-${key}`}
                    rows={2}
                    value={field.value}
                    onChange={(e) => onUpdateStoryBible(key, e.target.value)}
                    placeholder={placeholder}
                    aria-invalid={Boolean(fieldError)}
                    aria-describedby={fieldError ? inputErrorId : undefined}
                    className={`w-full text-xs bg-gray-50 dark:bg-gray-800 border rounded-md p-2 text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 ${
                      fieldError
                        ? 'border-red-500 focus:ring-red-500'
                        : 'border-gray-300 dark:border-gray-700 focus:ring-blue-500'
                    }`}
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
                    className={`w-full text-xs bg-gray-50 dark:bg-gray-800 border rounded-md px-2.5 py-1.5 text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 ${
                      fieldError
                        ? 'border-red-500 focus:ring-red-500'
                        : 'border-gray-300 dark:border-gray-700 focus:ring-blue-500'
                    }`}
                  />
                )}
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
          })}
        </div>
      )}
    </div>
  );
};

export default StoryBiblePanel;
