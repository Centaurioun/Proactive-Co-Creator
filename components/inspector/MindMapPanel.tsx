/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import type {
  ConsistencyIssue,
  ConsistencyIssueTarget,
  Entity,
  StoryBible,
  StoryBibleFields,
} from '../../shared/types';

export type MindMapStatusFilter = 'all' | 'confirmed' | 'pending';

export interface MindMapPanelProps {
  storyBible: StoryBible;
  entities: Entity[];
  actualConsistencyIssues: ConsistencyIssue[];
  filter: MindMapStatusFilter;
  onChangeFilter: (filter: MindMapStatusFilter) => void;
  onSelectEntityForInspector: (entity: Entity) => void;
  onNavigateConsistencyTarget?: (target: ConsistencyIssueTarget) => void;
}

const MIND_MAP_GROUPS: Array<{
  title: string;
  fields: Array<keyof StoryBibleFields>;
  entities?: boolean;
}> = [
  { title: 'Topics & themes', fields: ['themes', 'genre', 'tone'] },
  { title: 'Plot', fields: ['centralConflict', 'pacing', 'narrativePerspective'] },
  { title: 'World', fields: ['setting', 'continuityRules', 'explicitExclusions'] },
  { title: 'Visual style', fields: ['visualStyle', 'cameraAndLighting'] },
  { title: 'Characters', fields: [], entities: true },
];

const MindMapPanel: React.FC<MindMapPanelProps> = ({
  storyBible,
  entities,
  actualConsistencyIssues,
  filter,
  onChangeFilter,
  onSelectEntityForInspector,
  onNavigateConsistencyTarget,
}) => {
  const issueCountForEntity = (entityId?: string) =>
    entityId
      ? actualConsistencyIssues.filter((i) => i.affectedEntityIds.includes(entityId)).length
      : 0;

  return (
    <div className="flex-1 min-h-0 overflow-y-auto p-4 space-y-3">
      <header className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h3 className="font-display text-sm font-bold text-gray-900 dark:text-gray-100">
            Narrative Mind Map
          </h3>
          <p className="text-xs text-gray-500 dark:text-gray-400">
            Groups show topic association only; click any card to inspect or edit it in the Story Bible or Inspector.
          </p>
        </div>
        <div
          role="group"
          aria-label="Filter mind map status"
          className="flex rounded bg-gray-100 p-0.5 text-[11px] dark:bg-gray-800"
        >
          {(['all', 'confirmed', 'pending'] as const).map((statusOpt) => (
            <button
              key={statusOpt}
              type="button"
              aria-pressed={filter === statusOpt}
              onClick={() => onChangeFilter(statusOpt)}
              className={`rounded px-2 py-0.5 font-semibold capitalize ${
                filter === statusOpt
                  ? 'bg-white text-blue-600 shadow-xs dark:bg-gray-900 dark:text-blue-400'
                  : 'text-gray-600 dark:text-gray-400'
              }`}
            >
              {statusOpt}
            </button>
          ))}
        </div>
      </header>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        {MIND_MAP_GROUPS.map((group) => {
          const bibleEntries = group.fields.flatMap((field) => {
            const item = storyBible[field];
            if (!item.value.trim()) return [];
            if (filter !== 'all' && item.status !== filter) return [];
            return [
              {
                key: field,
                label: field
                  .replace(/[A-Z]/gu, (letter) => ` ${letter}`)
                  .replace(/^./u, (letter) => letter.toUpperCase()),
                value: item.value,
                status: item.status,
                provenance: item.provenance,
              },
            ];
          });
          const characters = group.entities
            ? entities.filter((entity) => {
                if (entity.category !== 'character' || entity.excluded) return false;
                if (filter === 'confirmed') return (entity.status ?? 'confirmed') === 'confirmed';
                if (filter === 'pending') return entity.status === 'pending';
                return true;
              })
            : [];

          return (
            <section
              key={group.title}
              aria-label={`${group.title} group`}
              className="min-h-24 rounded border border-gray-200 p-3 dark:border-gray-700"
            >
              <h4 className="mb-2 text-xs font-bold">{group.title}</h4>
              {bibleEntries.length === 0 && characters.length === 0 ? (
                <p className="text-xs text-gray-500">No matching entries.</p>
              ) : (
                <ul className="space-y-2">
                  {bibleEntries.map((entry) => (
                    <li
                      key={entry.label}
                      className="rounded bg-gray-50 p-2 text-xs dark:bg-gray-800"
                    >
                      <button
                        type="button"
                        onClick={() =>
                          onNavigateConsistencyTarget?.({
                            id: `mm_${entry.key}`,
                            kind: 'story_bible',
                            label: entry.label,
                            storyField: entry.key,
                          })
                        }
                        className="w-full text-left hover:text-blue-600 dark:hover:text-blue-400"
                      >
                        <strong>{entry.label}</strong>
                        <p className="text-gray-700 dark:text-gray-300">{entry.value}</p>
                        <span className="text-gray-500">
                          {entry.status} · {entry.provenance}
                        </span>
                      </button>
                    </li>
                  ))}
                  {characters.map((entity) => {
                    const issuesCount = issueCountForEntity(entity.id);
                    return (
                      <li
                        key={entity.id ?? entity.name}
                        className="rounded bg-gray-50 p-2 text-xs dark:bg-gray-800"
                      >
                        <button
                          type="button"
                          onClick={() => onSelectEntityForInspector(entity)}
                          className="w-full text-left hover:text-blue-600 dark:hover:text-blue-400"
                        >
                          <div className="flex flex-wrap items-center justify-between gap-1">
                            <strong>{entity.name}</strong>
                            {issuesCount > 0 && (
                              <span className="rounded bg-amber-100 px-1.5 py-0.5 text-[10px] font-semibold text-amber-900 dark:bg-amber-950 dark:text-amber-200">
                                ⚠ {issuesCount} issue{issuesCount === 1 ? '' : 's'}
                              </span>
                            )}
                          </div>
                          {entity.description && (
                            <p className="text-gray-700 dark:text-gray-300">{entity.description}</p>
                          )}
                          <span className="text-gray-500">
                            {entity.status ?? 'confirmed'} · {entity.provenance ?? 'recorded'}
                          </span>
                        </button>
                      </li>
                    );
                  })}
                </ul>
              )}
            </section>
          );
        })}
      </div>
    </div>
  );
};

export default MindMapPanel;
