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
import StoryBibleFieldEditor from './StoryBibleFieldEditor';

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
  onConfirmPendingStoryBible?: (
    items: Array<{ field: keyof StoryBibleFields; value: string }>
  ) => void;
}

const DOMAIN_FILTERS = [
  ['all', 'All'],
  ['core', 'World'],
  ['narrative', 'Arc & Voice'],
  ['constraints', 'Rules'],
  ['visual', 'Visual'],
] as const;

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
  onConfirmPendingStoryBible,
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

  const filteredItems = STORY_BIBLE_CONFIG.filter((item) => {
    if (domainFilter !== 'all' && item.domain !== domainFilter) return false;
    const f = storyBible[item.key];
    const hasValue = f.value.trim().length > 0;
    if (statusFilter === 'confirmed') return hasValue && f.status === 'confirmed';
    if (statusFilter === 'pending') return hasValue && f.status === 'pending';
    if (statusFilter === 'unset') return !hasValue;
    return true;
  });

  const handleConfirmPending = () => {
    const updates = pendingWithValues.map((item) => ({
      field: item.key,
      value: storyBible[item.key].value,
    }));
    if (onConfirmPendingStoryBible) {
      onConfirmPendingStoryBible(updates);
      return;
    }
    for (const item of updates) {
      onUpdateStoryBible(item.field, item.value);
    }
  };

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
              onClick={handleConfirmPending}
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
            {(['grid', 'list'] as const).map((mode) => (
              <button
                key={mode}
                type="button"
                onClick={() => onChangeViewMode(mode)}
                aria-pressed={viewMode === mode}
                className={`px-2 py-0.5 text-[11px] font-semibold rounded transition-colors ${
                  viewMode === mode
                    ? 'bg-white dark:bg-gray-900 text-blue-600 dark:text-blue-400 shadow-xs'
                    : 'text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white'
                }`}
              >
                {mode === 'grid' ? 'Grid' : 'List'}
              </button>
            ))}
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
          {DOMAIN_FILTERS.map(([domainKey, domainLabel]) => (
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
                  {domainFields.map((config) => (
                    <StoryBibleFieldEditor
                      key={config.key}
                      config={config}
                      field={storyBible[config.key]}
                      fieldError={storyBibleErrors?.[config.key]}
                      variant="grid"
                      onUpdateStoryBible={onUpdateStoryBible}
                    />
                  ))}
                </div>
              </section>
            );
          })}
        </div>
      ) : (
        <div className="space-y-3" role="region" aria-label="Story Bible list">
          {filteredItems.map((config) => (
            <StoryBibleFieldEditor
              key={config.key}
              config={config}
              field={storyBible[config.key]}
              fieldError={storyBibleErrors?.[config.key]}
              variant="list"
              onUpdateStoryBible={onUpdateStoryBible}
            />
          ))}
        </div>
      )}
    </div>
  );
};

export default StoryBiblePanel;
