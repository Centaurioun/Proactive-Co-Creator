/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import {
  getEntityGraphKey,
  type NodeDimension,
  type NodePosition,
} from '../../lib/graphLayout';
import type { Entity, Relationship } from '../../shared/types';
import { resolveRelationshipEndpointKeys } from './graphCanvasHelpers';

interface GraphNodeLayerProps {
  visibleEntities: Entity[];
  nodePositions: Record<string, NodePosition>;
  nodeDimensions: Record<string, NodeDimension>;
  entityKeyByName: Map<string, string>;
  highlightConnections: boolean;
  hoveredRel: Relationship | null;
  hoveredEntityKey: string | null;
  selectedEntityKey: string | null;
  neighborsOfHovered: Set<string> | null;
  neighborsOfSelected: Set<string> | null;
  onHoverEntityKey: (key: string | null) => void;
  onActivateEntity: (entity: Entity) => void;
}

function hasConfirmedEntityEdit(entity: Entity): boolean {
  if (entity.provenance === 'user-edit') return true;
  return entity.attributes.some(
    (a) =>
      a.name !== 'existence' &&
      (a.provenance === 'user-edit' || a.provenance === 'accepted-suggestion')
  );
}

function computeNodeOpacity(params: {
  entityKey: string;
  highlightConnections: boolean;
  hoveredRel: Relationship | null;
  entityKeyByName: Map<string, string>;
  hoveredEntityKey: string | null;
  selectedEntityKey: string | null;
  neighborsOfHovered: Set<string> | null;
  neighborsOfSelected: Set<string> | null;
}): number {
  const {
    entityKey,
    highlightConnections,
    hoveredRel,
    entityKeyByName,
    hoveredEntityKey,
    selectedEntityKey,
    neighborsOfHovered,
    neighborsOfSelected,
  } = params;
  if (!highlightConnections) return 1;
  if (hoveredRel) {
    const { sourceKey, targetKey } = resolveRelationshipEndpointKeys(hoveredRel, entityKeyByName);
    return entityKey === sourceKey || entityKey === targetKey ? 1 : 0.2;
  }
  if (hoveredEntityKey) {
    return entityKey === hoveredEntityKey || Boolean(neighborsOfHovered?.has(entityKey)) ? 1 : 0.2;
  }
  if (selectedEntityKey) {
    return entityKey === selectedEntityKey || Boolean(neighborsOfSelected?.has(entityKey)) ? 1 : 0.25;
  }
  return 1;
}

const GraphNodeLayer: React.FC<GraphNodeLayerProps> = ({
  visibleEntities,
  nodePositions,
  nodeDimensions,
  entityKeyByName,
  highlightConnections,
  hoveredRel,
  hoveredEntityKey,
  selectedEntityKey,
  neighborsOfHovered,
  neighborsOfSelected,
  onHoverEntityKey,
  onActivateEntity,
}) => {
  return (
    <>
      {visibleEntities.map((entity) => {
        const entityKey = getEntityGraphKey(entity);
        const pos = nodePositions[entityKey];
        if (!pos) return null;
        const isSelected = selectedEntityKey === entityKey;
        const dims = nodeDimensions[entityKey] ?? { width: 96, height: 36 };
        const hasConfirmedUserEdit = hasConfirmedEntityEdit(entity);
        const opacity = computeNodeOpacity({
          entityKey,
          highlightConnections,
          hoveredRel,
          entityKeyByName,
          hoveredEntityKey,
          selectedEntityKey,
          neighborsOfHovered,
          neighborsOfSelected,
        });

        return (
          <g
            key={entityKey}
            transform={`translate(${pos.x}, ${pos.y})`}
            className="cursor-pointer focus:outline-none"
            role="button"
            tabIndex={0}
            aria-label={`Entity ${entity.name}. ${entity.presence_in_prompt ? 'Explicit' : 'Implicit'}. Press Enter to inspect attributes.`}
            onClick={(e) => {
              e.stopPropagation();
              onActivateEntity(entity);
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                onActivateEntity(entity);
              }
            }}
            onMouseEnter={() => onHoverEntityKey(entityKey)}
            onMouseLeave={() => onHoverEntityKey(null)}
            style={{ opacity, transition: 'opacity 0.15s ease-out' }}
          >
            <rect
              x={-dims.width / 2}
              y={-dims.height / 2}
              width={dims.width}
              height={dims.height}
              rx="8"
              className={
                entity.excluded
                  ? 'fill-red-50 dark:fill-red-950/50 stroke-red-400'
                  : isSelected
                    ? 'fill-amber-50 dark:fill-amber-900/50 stroke-amber-500'
                    : hasConfirmedUserEdit
                      ? 'fill-blue-50 dark:fill-blue-900/40 stroke-blue-500 dark:stroke-blue-400'
                      : 'fill-white dark:fill-gray-800 stroke-slate-300 dark:stroke-gray-600'
              }
              strokeWidth={isSelected ? 2.5 : 2}
              strokeDasharray={entity.presence_in_prompt ? 'none' : '4 2'}
            />
            <text
              textAnchor="middle"
              dy="0.32em"
              fontSize="12"
              fontWeight="600"
              className={`fill-slate-800 dark:fill-gray-100 ${
                entity.excluded ? 'line-through opacity-70' : ''
              }`}
            >
              {entity.name}
            </text>
          </g>
        );
      })}
    </>
  );
};

export default GraphNodeLayer;
