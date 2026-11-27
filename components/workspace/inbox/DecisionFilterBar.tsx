/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import type { DecisionStatus } from '../../../shared/types';

export type DecisionGroupFilter =
  | 'all'
  | 'clarification'
  | 'character'
  | 'setting'
  | 'story'
  | 'relationship';

interface DecisionFilterBarProps {
  searchQuery: string;
  setSearchQuery: (q: string) => void;
  statusFilter: 'pending' | 'all' | DecisionStatus;
  setStatusFilter: (status: 'pending' | 'all' | DecisionStatus) => void;
  groupFilter: DecisionGroupFilter;
  setGroupFilter: (group: DecisionGroupFilter) => void;
  pendingCount: number;
  filteredCount: number;
  selectedCount: number;
  onSelectAllVisible: () => void;
  onSelectNone: () => void;
  onBatchAction: (action: 'accept' | 'reject' | 'defer') => void;
}

const GROUP_FILTERS = [
  ['all', 'All'],
  ['clarification', 'Questions'],
  ['character', 'Characters'],
  ['relationship', 'Relations'],
  ['setting', 'Setting'],
  ['story', 'Story'],
] as const;

export const DecisionFilterBar: React.FC<DecisionFilterBarProps> = ({
  searchQuery,
  setSearchQuery,
  statusFilter,
  setStatusFilter,
  groupFilter,
  setGroupFilter,
  pendingCount,
  filteredCount,
  selectedCount,
  onSelectAllVisible,
  onSelectNone,
  onBatchAction,
}) => (
  <div className="p-3 border-b border-gray-200 dark:border-gray-800 space-y-2 flex-shrink-0">
    <div className="flex gap-2">
      <input
        type="search"
        value={searchQuery}
        onChange={(e) => setSearchQuery(e.target.value)}
        placeholder="Search decisions, characters, traits..."
        aria-label="Search decisions"
        className="flex-1 min-w-0 text-xs bg-gray-50 dark:bg-gray-800 border border-gray-300 dark:border-gray-700 rounded-md px-2.5 py-1.5 text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-blue-500"
      />
      <select
        aria-label="Filter decisions by status"
        value={statusFilter}
        onChange={(e) => setStatusFilter(e.target.value as typeof statusFilter)}
        className="text-xs bg-gray-50 dark:bg-gray-800 border border-gray-300 dark:border-gray-700 rounded-md px-2 py-1.5 text-gray-800 dark:text-gray-200 focus:outline-none focus:ring-2 focus:ring-blue-500"
      >
        <option value="pending">Pending ({pendingCount})</option>
        <option value="deferred">Deferred</option>
        <option value="accepted">Confirmed</option>
        <option value="rejected">Rejected</option>
        <option value="all">All Statuses</option>
      </select>
    </div>

    <div
      role="group"
      aria-label="Filter decisions by category"
      className="flex items-center gap-1 p-1 bg-gray-100 dark:bg-gray-800 rounded-md overflow-x-auto"
    >
      {GROUP_FILTERS.map(([key, label]) => (
        <button
          key={key}
          type="button"
          onClick={() => setGroupFilter(key)}
          className={`flex-1 px-2 py-1 text-xs font-medium rounded transition-colors whitespace-nowrap shrink-0 ${
            groupFilter === key
              ? 'bg-white dark:bg-gray-900 text-gray-900 dark:text-gray-100 shadow-xs'
              : 'text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white'
          }`}
        >
          {label}
        </button>
      ))}
    </div>

    {filteredCount > 0 && (
      <div className="flex flex-wrap items-center justify-between gap-2 pt-1 text-xs">
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={onSelectAllVisible}
            className="text-blue-600 dark:text-blue-400 hover:underline font-medium whitespace-nowrap"
          >
            Select All ({filteredCount})
          </button>
          <span aria-hidden="true" className="text-gray-300 dark:text-gray-700">
            ·
          </span>
          <button
            type="button"
            onClick={onSelectNone}
            className="text-gray-500 dark:text-gray-400 hover:underline whitespace-nowrap"
          >
            Select None
          </button>
        </div>

        {selectedCount > 0 && (
          <div className="flex items-center gap-1.5">
            <button
              type="button"
              onClick={() => onBatchAction('accept')}
              className="px-2.5 py-1 bg-blue-600 hover:bg-blue-700 text-white font-semibold rounded transition-colors whitespace-nowrap tabular-nums"
            >
              Accept Selected ({selectedCount})
            </button>
            <button
              type="button"
              onClick={() => onBatchAction('defer')}
              className="px-2 py-1 bg-gray-100 hover:bg-gray-200 dark:bg-gray-800 dark:hover:bg-gray-700 text-gray-700 dark:text-gray-300 font-medium rounded transition-colors whitespace-nowrap"
            >
              Defer
            </button>
            <button
              type="button"
              onClick={() => onBatchAction('reject')}
              className="px-2 py-1 bg-gray-100 hover:bg-gray-200 dark:bg-gray-800 dark:hover:bg-gray-700 text-red-600 dark:text-red-400 font-medium rounded transition-colors whitespace-nowrap"
            >
              Reject
            </button>
          </div>
        )}
      </div>
    )}
  </div>
);
