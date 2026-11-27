/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState } from 'react';
import type { Entity, EntityCategory } from '../../shared/types';

interface EntityDirectoryViewProps {
  objectEntities: Entity[];
  onSelectEntity: (entity: Entity | null) => void;
  onAddEntity: (name: string, category: EntityCategory, description: string) => void;
}

const EntityDirectoryView: React.FC<EntityDirectoryViewProps> = ({
  objectEntities,
  onSelectEntity,
  onAddEntity,
}) => {
  const [newEntityName, setNewEntityName] = useState('');
  const [newEntityCategory, setNewEntityCategory] = useState<EntityCategory>('character');
  const [newEntityDesc, setNewEntityDesc] = useState('');

  return (
    <div className="space-y-4">
      <div>
        <h3 className="font-display text-sm font-bold text-gray-900 dark:text-gray-100 mb-1">
          Story Elements Directory ({objectEntities.length})
        </h3>
        <p className="text-xs text-gray-500 dark:text-gray-400 mb-3">
          Select any node on the Belief Graph or click an entity below to inspect and edit its attributes, provenance, and relationships.
        </p>

        <div className="divide-y divide-gray-200 dark:divide-gray-800 border border-gray-200 dark:border-gray-800 rounded-md">
          {objectEntities.map((ent) => {
            const confirmedCount = ent.attributes.filter(
              (a) => a.status === 'confirmed' && a.name !== 'existence'
            ).length;
            return (
              <button
                key={ent.id ?? ent.name}
                type="button"
                onClick={() => onSelectEntity(ent)}
                className="w-full text-left px-3 py-2.5 hover:bg-gray-50 dark:hover:bg-gray-800 flex items-center justify-between gap-2 transition-colors"
              >
                <div className="min-w-0">
                  <div className="text-xs font-semibold text-gray-900 dark:text-gray-100 truncate">
                    {ent.name}{' '}
                    {ent.excluded && (
                      <span className="text-red-600 dark:text-red-400 font-normal">
                        (Excluded)
                      </span>
                    )}
                  </div>
                  <div className="text-[11px] text-gray-500 dark:text-gray-400">
                    <span className="capitalize">{ent.category ?? 'entity'}</span>
                    <span aria-hidden="true"> · </span>
                    <span className="tabular-nums">{confirmedCount} confirmed traits</span>
                  </div>
                </div>
                <span className="text-xs text-blue-600 dark:text-blue-400 whitespace-nowrap">
                  Inspect &rarr;
                </span>
              </button>
            );
          })}
        </div>
      </div>

      {/* Add New Entity Form */}
      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (newEntityName.trim()) {
            onAddEntity(
              newEntityName.trim(),
              newEntityCategory,
              newEntityDesc.trim()
            );
            setNewEntityName('');
            setNewEntityDesc('');
          }
        }}
        className="p-3 rounded-md border border-gray-200 dark:border-gray-800 bg-gray-50/50 dark:bg-gray-950/40 space-y-2.5"
      >
        <h4 className="text-xs font-semibold text-gray-900 dark:text-gray-100">
          Add New Entity to Graph
        </h4>
        <div className="flex gap-2">
          <input
            type="text"
            value={newEntityName}
            onChange={(e) => setNewEntityName(e.target.value)}
            placeholder="Entity name (e.g. Owl)"
            aria-label="New entity name"
            className="flex-1 min-w-0 text-xs bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-700 rounded px-2.5 py-1.5 text-gray-900 dark:text-gray-100"
          />
          <select
            aria-label="New entity category"
            value={newEntityCategory}
            onChange={(e) => setNewEntityCategory(e.target.value as EntityCategory)}
            className="text-xs bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-700 rounded px-2 py-1.5 text-gray-800 dark:text-gray-200"
          >
            <option value="character">Character</option>
            <option value="location">Location</option>
            <option value="object">Object</option>
            <option value="event">Event</option>
            <option value="group">Group</option>
          </select>
        </div>
        <input
          type="text"
          value={newEntityDesc}
          onChange={(e) => setNewEntityDesc(e.target.value)}
          placeholder="Short description..."
          aria-label="New entity description"
          className="w-full text-xs bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-700 rounded px-2.5 py-1.5 text-gray-900 dark:text-gray-100"
        />
        <button
          type="submit"
          disabled={!newEntityName.trim()}
          className="w-full py-1.5 text-xs font-semibold bg-blue-600 hover:bg-blue-700 disabled:opacity-40 text-white rounded transition-colors"
        >
          Add to Story Graph
        </button>
      </form>
    </div>
  );
};

export default EntityDirectoryView;
