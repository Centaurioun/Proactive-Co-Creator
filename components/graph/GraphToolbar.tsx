/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import type { Entity, EntityCategory } from '../../shared/types';

export type GraphDisplayMode = 'graph' | 'table' | 'ego' | 'kinship';

export interface GraphToolbarProps {
  totalEntityCount: number;
  searchQuery: string;
  categoryFilter: 'all' | EntityCategory;
  selectedEntity: Entity | null;
  highlightConnections: boolean;
  showInferred: boolean;
  collapseGuestGroup: boolean;
  showExcluded: boolean;
  displayMode: GraphDisplayMode;
  onChangeSearchQuery: (query: string) => void;
  onChangeCategoryFilter: (category: 'all' | EntityCategory) => void;
  onFocusSelectedEntity: (entity: Entity) => void;
  onToggleHighlightConnections: () => void;
  onToggleShowInferred: () => void;
  onToggleCollapseGuestGroup: () => void;
  onToggleShowExcluded: () => void;
  onChangeDisplayMode: (mode: GraphDisplayMode) => void;
}

const GraphToolbar: React.FC<GraphToolbarProps> = ({
  totalEntityCount,
  searchQuery,
  categoryFilter,
  selectedEntity,
  highlightConnections,
  showInferred,
  collapseGuestGroup,
  showExcluded,
  displayMode,
  onChangeSearchQuery,
  onChangeCategoryFilter,
  onFocusSelectedEntity,
  onToggleHighlightConnections,
  onToggleShowInferred,
  onToggleCollapseGuestGroup,
  onToggleShowExcluded,
  onChangeDisplayMode,
}) => {
  return (
    <div className="px-3 py-2 border-b border-gray-200 dark:border-gray-800 bg-gray-50/70 dark:bg-gray-950/60 flex flex-wrap items-center justify-between gap-2 flex-shrink-0">
      <div className="flex items-center gap-2 flex-1 min-w-[200px]">
        <input
          type="search"
          value={searchQuery}
          onChange={(e) => onChangeSearchQuery(e.target.value)}
          placeholder="Search entities, traits, or relationships..."
          aria-label="Search belief graph"
          className="w-48 sm:w-56 text-xs bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-700 rounded-md px-2.5 py-1.5 text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-blue-500"
        />

        <select
          aria-label="Filter graph by entity category"
          value={categoryFilter}
          onChange={(e) => onChangeCategoryFilter(e.target.value as 'all' | EntityCategory)}
          className="text-xs bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-700 rounded-md px-2 py-1.5 text-gray-800 dark:text-gray-200"
        >
          <option value="all">All Types ({totalEntityCount})</option>
          <option value="character">Characters</option>
          <option value="location">Locations</option>
          <option value="object">Objects</option>
          <option value="event">Events</option>
          <option value="group">Groups</option>
        </select>
      </div>

      <div className="flex flex-wrap items-center gap-1.5">
        {selectedEntity && (
          <button
            type="button"
            onClick={() => onFocusSelectedEntity(selectedEntity)}
            className="px-2.5 py-1 text-xs font-medium rounded border border-blue-300 dark:border-blue-800 bg-blue-50 dark:bg-blue-950 text-blue-700 dark:text-blue-300 hover:bg-blue-100 whitespace-nowrap"
          >
            Focus &ldquo;{selectedEntity.name}&rdquo;
          </button>
        )}

        <button
          type="button"
          onClick={onToggleHighlightConnections}
          aria-pressed={highlightConnections}
          className={`px-2 py-1 text-xs font-medium rounded border transition-colors whitespace-nowrap ${
            highlightConnections
              ? 'border-gray-400 dark:border-gray-600 bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100'
              : 'border-gray-200 dark:border-gray-800 text-gray-500'
          }`}
        >
          Highlight Links
        </button>

        <button
          type="button"
          onClick={onToggleShowInferred}
          aria-pressed={showInferred}
          className={`px-2 py-1 text-xs font-medium rounded border transition-colors whitespace-nowrap ${
            showInferred
              ? 'border-gray-400 dark:border-gray-600 bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100'
              : 'border-gray-200 dark:border-gray-800 text-gray-500'
          }`}
        >
          {showInferred ? 'Inferred: Shown' : 'Inferred: Hidden'}
        </button>

        <button
          type="button"
          onClick={onToggleCollapseGuestGroup}
          aria-pressed={collapseGuestGroup}
          className={`px-2 py-1 text-xs font-medium rounded border transition-colors whitespace-nowrap ${
            collapseGuestGroup
              ? 'border-blue-500 bg-blue-50 dark:bg-blue-950 text-blue-700 dark:text-blue-300'
              : 'border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-700 dark:text-gray-300'
          }`}
        >
          {collapseGuestGroup ? 'Expand Guests' : 'Group Guests'}
        </button>

        <button
          type="button"
          onClick={onToggleShowExcluded}
          aria-pressed={showExcluded}
          className={`px-2 py-1 text-xs font-medium rounded border transition-colors whitespace-nowrap ${
            showExcluded
              ? 'border-amber-500 bg-amber-50 dark:bg-amber-950 text-amber-800 dark:text-amber-300'
              : 'border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-600 dark:text-gray-400'
          }`}
        >
          Excluded
        </button>

        {/* Graph / Table / Ego Map / Family (Kinship) Switcher */}
        <div
          role="group"
          aria-label="Graph display mode"
          className="flex flex-wrap bg-gray-200/70 dark:bg-gray-800 p-0.5 rounded-md"
        >
          {(
            [
              ['graph', 'Graph'],
              ['table', 'Table'],
              ['ego', 'Ego Map'],
              ['kinship', 'Family'],
            ] as const
          ).map(([modeKey, modeLabel]) => (
            <button
              key={modeKey}
              type="button"
              onClick={() => onChangeDisplayMode(modeKey)}
              aria-pressed={displayMode === modeKey}
              className={`px-2 py-1 text-xs font-semibold rounded transition-colors whitespace-nowrap ${
                displayMode === modeKey
                  ? 'bg-white dark:bg-gray-900 text-gray-900 dark:text-gray-100 shadow-xs'
                  : 'text-gray-600 dark:text-gray-400'
              }`}
            >
              {modeLabel}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
};

export default GraphToolbar;
