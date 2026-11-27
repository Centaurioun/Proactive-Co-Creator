/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import { truncateLabel } from '../../lib/beliefGraphUtils';
import {
  getEdgePath,
  type NodeDimension,
  type NodePosition,
} from '../../lib/graphLayout';
import type { Relationship } from '../../shared/types';
import {
  isRelationshipSelected,
  resolveRelationshipEndpointKeys,
} from './graphCanvasHelpers';

interface GraphEdgeLayerProps {
  relationships: Relationship[];
  nodePositions: Record<string, NodePosition>;
  nodeDimensions: Record<string, NodeDimension>;
  entityKeyByName: Map<string, string>;
  parallelEdgeOffsets: Record<string, number>;
  highlightConnections: boolean;
  hoveredRel: Relationship | null;
  hoveredEntityKey: string | null;
  selectedEntityKey: string | null;
  selectedRelationship: Relationship | null;
  markerId: string;
  onHoverRel: (rel: Relationship | null) => void;
  onActivateRel: (rel: Relationship, clientX: number, clientY: number) => void;
}

function computeEdgeOpacity(
  rel: Relationship,
  sourceKey: string,
  targetKey: string,
  highlightConnections: boolean,
  hoveredRel: Relationship | null,
  hoveredEntityKey: string | null,
  selectedEntityKey: string | null
): number {
  if (!highlightConnections) return 1;
  if (hoveredRel) return rel === hoveredRel ? 1 : 0.2;
  if (hoveredEntityKey) {
    return sourceKey === hoveredEntityKey || targetKey === hoveredEntityKey ? 1 : 0.2;
  }
  if (selectedEntityKey) {
    return sourceKey === selectedEntityKey || targetKey === selectedEntityKey ? 1 : 0.2;
  }
  return 1;
}

const GraphEdgeLayer: React.FC<GraphEdgeLayerProps> = ({
  relationships,
  nodePositions,
  nodeDimensions,
  entityKeyByName,
  parallelEdgeOffsets,
  highlightConnections,
  hoveredRel,
  hoveredEntityKey,
  selectedEntityKey,
  selectedRelationship,
  markerId,
  onHoverRel,
  onActivateRel,
}) => {
  return (
    <>
      {relationships.map((rel, i) => {
        const { sourceKey, targetKey } = resolveRelationshipEndpointKeys(rel, entityKeyByName);
        const sourcePos = nodePositions[sourceKey];
        const targetPos = nodePositions[targetKey];
        const sourceDims = nodeDimensions[sourceKey];
        const targetDims = nodeDimensions[targetKey];
        if (!sourcePos || !targetPos || !sourceDims || !targetDims) return null;

        const edgeKey = rel.id ?? `${rel.source}->${rel.target}::${rel.label}`;
        const curveOffset = parallelEdgeOffsets[edgeKey] ?? 0;

        const { path, labelX, labelY } = getEdgePath(
          sourcePos.x,
          sourcePos.y,
          targetPos.x,
          targetPos.y,
          sourceDims.width,
          sourceDims.height,
          targetDims.width,
          targetDims.height,
          curveOffset
        );

        const opacity = computeEdgeOpacity(
          rel,
          sourceKey,
          targetKey,
          highlightConnections,
          hoveredRel,
          hoveredEntityKey,
          selectedEntityKey
        );

        const isModified =
          rel.provenance === 'user-edit' || rel.provenance === 'accepted-suggestion';
        const isPending = rel.status === 'pending';
        const isSelectedRel = isRelationshipSelected(selectedRelationship, rel);

        return (
          <g
            key={rel.id ?? `rel-${rel.source}-${rel.target}-${rel.label}-${i}`}
            style={{ opacity, transition: 'opacity 0.15s ease-out' }}
            className="cursor-pointer focus:outline-none"
            role="button"
            tabIndex={0}
            aria-label={`Directed relationship: ${rel.source} ${rel.label} ${rel.target} (${rel.status ?? 'confirmed'}). Press Enter to inspect or edit.`}
            onMouseEnter={() => onHoverRel(rel)}
            onMouseLeave={() => onHoverRel(null)}
            onPointerDown={(e) => e.stopPropagation()}
            onClick={(e) => {
              e.stopPropagation();
              onActivateRel(rel, e.clientX, e.clientY);
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                const rect = e.currentTarget.getBoundingClientRect();
                onActivateRel(rel, rect.left + rect.width / 2, rect.top + rect.height / 2);
              }
            }}
          >
            <path
              d={path}
              className={
                isSelectedRel
                  ? 'stroke-amber-500 dark:stroke-amber-400'
                  : isPending
                    ? 'stroke-amber-500/80 dark:stroke-amber-400/80'
                    : isModified
                      ? 'stroke-blue-500 dark:stroke-blue-400'
                      : 'stroke-slate-400 dark:stroke-slate-500'
              }
              strokeWidth={isSelectedRel || isModified ? 2.5 : 2}
              strokeDasharray={isPending ? '5 3' : 'none'}
              fill="none"
              markerEnd={`url(#${markerId})`}
            />
            <text
              x={labelX}
              y={labelY + 4}
              textAnchor="middle"
              fontSize="11"
              fontWeight="600"
              strokeWidth="6px"
              strokeLinejoin="round"
              paintOrder="stroke"
              className={
                isSelectedRel
                  ? 'fill-amber-700 dark:fill-amber-300 stroke-white dark:stroke-gray-950'
                  : isPending
                    ? 'fill-amber-700 dark:fill-amber-300 stroke-white dark:stroke-gray-950'
                    : isModified
                      ? 'fill-blue-700 dark:fill-blue-300 stroke-white dark:stroke-gray-950'
                      : 'fill-slate-700 dark:fill-slate-200 stroke-white dark:stroke-gray-950'
              }
            >
              {truncateLabel(rel.label, 20)}
              {isPending ? ' (?)' : ''}
            </text>
          </g>
        );
      })}
    </>
  );
};

export default GraphEdgeLayer;
