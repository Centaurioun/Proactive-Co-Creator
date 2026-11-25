/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import type { Entity, Relationship } from '../../shared/types';

export interface EgoMapViewProps {
  rawObjectEntities: Entity[];
  resolvedEgoFocusId: string;
  egoHops: 1 | 2;
  egoNetwork: { nodeIds: Set<string>; edges: Relationship[] };
  issueCountByEntityId: Map<string, number>;
  onChangeEgoFocusId: (id: string) => void;
  onChangeEgoHops: (hops: 1 | 2) => void;
  onSelectEntity: (entity: Entity | null) => void;
  onSelectRelationship?: (rel: Relationship | null) => void;
}

const EgoMapView: React.FC<EgoMapViewProps> = ({
  rawObjectEntities,
  resolvedEgoFocusId,
  egoHops,
  egoNetwork,
  issueCountByEntityId,
  onChangeEgoFocusId,
  onChangeEgoHops,
  onSelectEntity,
  onSelectRelationship,
}) => {
  return (
    <div className="flex-1 overflow-y-auto p-4 min-h-0 space-y-4 text-xs">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-gray-200 pb-3 dark:border-gray-800">
        <div>
          <h3 className="font-display text-sm font-bold text-gray-900 dark:text-gray-100">
            Character Ego Network
          </h3>
          <p className="text-gray-500 dark:text-gray-400">
            Shows direct (1-hop) or extended (2-hop) canonical relationships centered on one selected entity.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <select
            aria-label="Focus entity for ego map"
            value={resolvedEgoFocusId}
            onChange={(e) => onChangeEgoFocusId(e.target.value)}
            className="rounded border border-gray-300 bg-white px-2 py-1 text-xs dark:border-gray-700 dark:bg-gray-800"
          >
            {rawObjectEntities
              .filter((e) => !e.excluded && e.id)
              .map((e) => (
                <option key={e.id} value={e.id}>
                  {e.name} ({e.category ?? 'entity'})
                </option>
              ))}
          </select>
          <div
            role="group"
            aria-label="Ego network depth"
            className="flex rounded bg-gray-200/70 p-0.5 dark:bg-gray-800"
          >
            {([1, 2] as const).map((h) => (
              <button
                key={h}
                type="button"
                aria-pressed={egoHops === h}
                onClick={() => onChangeEgoHops(h)}
                className={`rounded px-2 py-0.5 text-xs font-semibold ${
                  egoHops === h
                    ? 'bg-white text-gray-900 shadow-xs dark:bg-gray-900 dark:text-gray-100'
                    : 'text-gray-600 dark:text-gray-400'
                }`}
              >
                {h}-hop
              </button>
            ))}
          </div>
        </div>
      </div>

      {egoNetwork.edges.length === 0 ? (
        <p className="rounded border border-gray-200 p-4 text-gray-600 dark:border-gray-800 dark:text-gray-400">
          No canonical-ID relationships connect to this entity within {egoHops} hop
          {egoHops === 1 ? '' : 's'}.
        </p>
      ) : (
        <div className="space-y-3">
          <div className="flex flex-wrap gap-2">
            {rawObjectEntities
              .filter((e) => e.id && egoNetwork.nodeIds.has(e.id))
              .map((ent) => {
                const count = ent.id ? issueCountByEntityId.get(ent.id) ?? 0 : 0;
                const isCenter = ent.id === resolvedEgoFocusId;
                return (
                  <button
                    key={ent.id}
                    type="button"
                    onClick={() => {
                      onSelectEntity(ent);
                      onSelectRelationship?.(null);
                    }}
                    className={`rounded border px-2.5 py-1.5 text-left transition-colors ${
                      isCenter
                        ? 'border-blue-500 bg-blue-50 font-bold text-blue-900 dark:bg-blue-950/60 dark:text-blue-200'
                        : 'border-gray-200 bg-gray-50 hover:bg-gray-100 dark:border-gray-700 dark:bg-gray-800'
                    }`}
                  >
                    <span>{ent.name}</span>
                    {isCenter && (
                      <span className="ml-1.5 text-[10px] uppercase text-blue-600 dark:text-blue-400">
                        (Focus)
                      </span>
                    )}
                    {count > 0 && (
                      <span className="ml-1.5 rounded bg-amber-100 px-1 py-0.5 text-[10px] font-semibold text-amber-900 dark:bg-amber-950 dark:text-amber-200">
                        ⚠ {count}
                      </span>
                    )}
                  </button>
                );
              })}
          </div>
          <ul className="space-y-1.5">
            {egoNetwork.edges.map((rel) => (
              <li
                key={rel.id ?? `${rel.source}-${rel.target}-${rel.label}`}
                className="flex flex-wrap items-center justify-between gap-2 rounded border border-gray-200 p-2 dark:border-gray-800"
              >
                <button
                  type="button"
                  onClick={() => onSelectRelationship?.(rel)}
                  className="text-left hover:underline"
                >
                  <strong>{rel.source}</strong> →{' '}
                  <span className="text-blue-700 dark:text-blue-300 font-medium">{rel.label}</span>{' '}
                  → <strong>{rel.target}</strong>
                </button>
                <span className="capitalize text-gray-500">{rel.status ?? 'confirmed'}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
};

export default EgoMapView;
