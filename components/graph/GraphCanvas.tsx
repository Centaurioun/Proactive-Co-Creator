/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useEffect, useId, useMemo, useRef, useState } from 'react';
import {
  computeFitTransformByKey,
  computeForceLayoutByKey,
  computeNodeDimensionsByKey,
  computeParallelEdgeOffsets,
  getEntityGraphKey,
  type ViewTransform,
} from '../../lib/graphLayout';
import type { BeliefState, Entity, Relationship } from '../../shared/types';
import RelationshipEditor from '../RelationshipEditor';
import {
  buildEntityKeyByNameMap,
  buildGraphTopologySignature,
  computeNeighborKeys,
  isRelationshipSelected,
  removeTrackedPointer,
} from './graphCanvasHelpers';
import GraphEdgeLayer from './GraphEdgeLayer';
import GraphNodeLayer from './GraphNodeLayer';
import { useContainerDimensions } from './useContainerDimensions';
import { usePanZoomGestures } from './usePanZoomGestures';

export { buildGraphTopologySignature, isRelationshipSelected, removeTrackedPointer };

export interface GraphCanvasProps {
  data: BeliefState | null;
  isLoading: boolean;
  error?: string | null;
  visibleEntities: Entity[];
  relationships: Relationship[];
  selectedEntity: Entity | null;
  selectedRelationship: Relationship | null;
  highlightConnections: boolean;
  userTransform: ViewTransform | null;
  focusRequest: { entityName: string; seq: number } | null;
  onChangeUserTransform: React.Dispatch<React.SetStateAction<ViewTransform | null>>;
  onSelectEntity: (entity: Entity | null) => void;
  onSelectRelationship?: (rel: Relationship | null) => void;
  onExpandGuestGroup: () => void;
  onRelationshipChange: (
    source: string,
    target: string,
    newLabel: string,
    relationshipId?: string
  ) => void;
}

const GraphCanvas: React.FC<GraphCanvasProps> = ({
  data,
  isLoading,
  error,
  visibleEntities,
  relationships,
  selectedEntity,
  selectedRelationship,
  highlightConnections,
  userTransform,
  focusRequest,
  onChangeUserTransform,
  onSelectEntity,
  onSelectRelationship,
  onExpandGuestGroup,
  onRelationshipChange,
}) => {
  const [hoveredEntityKey, setHoveredEntityKey] = useState<string | null>(null);
  const [hoveredRel, setHoveredRel] = useState<Relationship | null>(null);
  const [selectedRel, setSelectedRel] = useState<{
    rel: Relationship;
    position: { x: number; y: number };
  } | null>(null);

  const markerId = useId();
  const containerElementRef = useRef<HTMLDivElement | null>(null);
  const dimensions = useContainerDimensions(containerElementRef);

  const nodeDimensions = useMemo(
    () => computeNodeDimensionsByKey(visibleEntities),
    [visibleEntities]
  );

  const parallelEdgeOffsets = useMemo(
    () => computeParallelEdgeOffsets(relationships),
    [relationships]
  );

  const entityKeyByName = useMemo(
    () => buildEntityKeyByNameMap(visibleEntities),
    [visibleEntities]
  );

  // Structural signature for layout stability (re-runs when keyed entities, names, or edges change)
  const topologySignature = useMemo(
    () => buildGraphTopologySignature(visibleEntities, relationships),
    [visibleEntities, relationships]
  );

  const nodePositions = useMemo(() => {
    if (visibleEntities.length === 0) return {};
    return computeForceLayoutByKey({
      objectEntities: visibleEntities,
      relationships,
      nodeDimensions,
      containerWidth: dimensions.width || 680,
      containerHeight: dimensions.height || 440,
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [topologySignature, dimensions.width, dimensions.height]);

  const fitTransform = useMemo(
    () =>
      computeFitTransformByKey(
        nodePositions,
        nodeDimensions,
        dimensions.width || 680,
        dimensions.height || 440
      ),
    [nodePositions, nodeDimensions, dimensions]
  );

  const viewTransform = userTransform ?? fitTransform;

  const lastFocusSeqRef = useRef<number>(0);
  useEffect(() => {
    if (!focusRequest || focusRequest.seq === lastFocusSeqRef.current) return;
    lastFocusSeqRef.current = focusRequest.seq;
    const targetKey = entityKeyByName.get(focusRequest.entityName) ?? focusRequest.entityName;
    const pos = nodePositions[targetKey];
    if (!pos) return;
    const w = dimensions.width || 680;
    const h = dimensions.height || 440;
    const targetK = 1.35;
    onChangeUserTransform({
      x: w / 2 - pos.x * targetK,
      y: h / 2 - pos.y * targetK,
      k: targetK,
    });
  }, [focusRequest, entityKeyByName, nodePositions, dimensions.width, dimensions.height, onChangeUserTransform]);

  const selectedEntityKey = selectedEntity ? getEntityGraphKey(selectedEntity) : null;

  const neighborsOfSelected = useMemo(
    () => computeNeighborKeys(selectedEntityKey, relationships, entityKeyByName),
    [selectedEntityKey, relationships, entityKeyByName]
  );

  const neighborsOfHovered = useMemo(
    () => computeNeighborKeys(hoveredEntityKey, relationships, entityKeyByName),
    [hoveredEntityKey, relationships, entityKeyByName]
  );

  // Derive active floating RelationshipEditor state against current relationships (closes if edge was deleted/replaced)
  const activeSelectedRel = useMemo(() => {
    if (!selectedRel) return null;
    const matched = relationships.find((r) => isRelationshipSelected(selectedRel.rel, r));
    return matched ? { rel: matched, position: selectedRel.position } : null;
  }, [selectedRel, relationships]);

  const {
    handlePointerDown,
    handlePointerMove,
    handlePointerEnd,
    zoomIn,
    zoomOut,
    resetView,
  } = usePanZoomGestures({
    containerRef: containerElementRef,
    fitTransform,
    onChangeUserTransform,
    onClearSelectedRel: () => setSelectedRel(null),
  });

  const openRelationshipEditorAtClientPoint = (
    rel: Relationship,
    clientX: number,
    clientY: number
  ) => {
    const container = containerElementRef.current;
    if (!container) return;
    const svgRect = container.getBoundingClientRect();
    setSelectedRel({
      rel,
      position: { x: clientX - svgRect.left, y: clientY - svgRect.top },
    });
  };

  const handleActivateRel = (rel: Relationship, clientX: number, clientY: number) => {
    onSelectRelationship?.(rel);
    openRelationshipEditorAtClientPoint(rel, clientX, clientY);
  };

  const handleActivateEntity = (entity: Entity) => {
    if (entity.id === 'ent_group_guests_synthetic') {
      onExpandGuestGroup();
      return;
    }
    onSelectEntity(entity);
    onSelectRelationship?.(null);
    setSelectedRel(null);
  };

  return (
    <div
      style={{ touchAction: 'none' }}
      className="flex-1 w-full min-h-0 cursor-move active:cursor-grabbing relative flex flex-col"
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerEnd}
      onPointerCancel={handlePointerEnd}
      onPointerLeave={handlePointerEnd}
    >
      <div
        ref={containerElementRef}
        className="relative bg-gray-50/50 dark:bg-gray-950/60 w-full flex-1 min-h-0 overflow-hidden"
      >
        {data && (
          <div className="absolute top-2.5 right-3 flex items-center gap-1 z-30">
            <button
              type="button"
              onClick={zoomIn}
              className="bg-white/95 dark:bg-gray-800/95 min-w-[30px] min-h-[30px] px-2 py-1 rounded border border-gray-200 dark:border-gray-700 shadow-xs text-gray-700 dark:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 flex items-center justify-center text-xs font-bold"
              title="Zoom In"
              aria-label="Zoom in belief graph"
            >
              +
            </button>
            <button
              type="button"
              onClick={zoomOut}
              className="bg-white/95 dark:bg-gray-800/95 min-w-[30px] min-h-[30px] px-2 py-1 rounded border border-gray-200 dark:border-gray-700 shadow-xs text-gray-700 dark:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 flex items-center justify-center text-xs font-bold"
              title="Zoom Out"
              aria-label="Zoom out belief graph"
            >
              &minus;
            </button>
            <button
              type="button"
              onClick={resetView}
              className="bg-white/95 dark:bg-gray-800/95 min-w-[34px] min-h-[30px] px-2 py-1 rounded border border-gray-200 dark:border-gray-700 shadow-xs text-gray-700 dark:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 flex items-center justify-center text-[11px] font-semibold"
              title="Fit to View"
              aria-label="Fit belief graph to view"
            >
              Fit
            </button>
          </div>
        )}

        {/* Graph Legend */}
        <div className="absolute bottom-2 left-3 z-20 pointer-events-none text-[11px] text-gray-500 dark:text-gray-400 bg-white/85 dark:bg-gray-900/85 px-2.5 py-0.5 rounded border border-gray-200 dark:border-gray-800">
          <span>Solid border: Explicit</span>
          <span aria-hidden="true"> · </span>
          <span>Dashed: AI Inferred</span>
          <span aria-hidden="true"> · </span>
          <span>Blue: Confirmed edits</span>
        </div>

        {error && !data && !isLoading && (
          <div className="p-6 text-center text-xs text-red-600 dark:text-red-400" role="alert">
            {error}
          </div>
        )}

        {data && (
          <svg
            width="100%"
            height="100%"
            viewBox={`0 0 ${dimensions.width || 680} ${dimensions.height || 440}`}
            className="overflow-hidden select-none"
            role="region"
            aria-label="Interactive belief graph"
          >
            <defs>
              <marker
                id={markerId}
                viewBox="0 0 10 10"
                refX="9"
                refY="5"
                markerWidth="6"
                markerHeight="6"
                orient="auto-start-reverse"
              >
                <path
                  d="M 0 0 L 10 5 L 0 10 z"
                  className="fill-slate-400 dark:fill-slate-500"
                />
              </marker>
            </defs>

            <g
              transform={`translate(${viewTransform.x}, ${viewTransform.y}) scale(${viewTransform.k})`}
            >
              <GraphEdgeLayer
                relationships={relationships}
                nodePositions={nodePositions}
                nodeDimensions={nodeDimensions}
                entityKeyByName={entityKeyByName}
                parallelEdgeOffsets={parallelEdgeOffsets}
                highlightConnections={highlightConnections}
                hoveredRel={hoveredRel}
                hoveredEntityKey={hoveredEntityKey}
                selectedEntityKey={selectedEntityKey}
                selectedRelationship={selectedRelationship}
                markerId={markerId}
                onHoverRel={setHoveredRel}
                onActivateRel={handleActivateRel}
              />
              <GraphNodeLayer
                visibleEntities={visibleEntities}
                nodePositions={nodePositions}
                nodeDimensions={nodeDimensions}
                entityKeyByName={entityKeyByName}
                highlightConnections={highlightConnections}
                hoveredRel={hoveredRel}
                hoveredEntityKey={hoveredEntityKey}
                selectedEntityKey={selectedEntityKey}
                neighborsOfHovered={neighborsOfHovered}
                neighborsOfSelected={neighborsOfSelected}
                onHoverEntityKey={setHoveredEntityKey}
                onActivateEntity={handleActivateEntity}
              />
            </g>
          </svg>
        )}
      </div>

      {activeSelectedRel && (
        <RelationshipEditor
          rel={activeSelectedRel.rel}
          currentLabel={activeSelectedRel.rel.label}
          position={activeSelectedRel.position}
          containerDimensions={dimensions}
          onClose={() => setSelectedRel(null)}
          isLoading={isLoading}
          onChange={(newLabel) =>
            onRelationshipChange(
              activeSelectedRel.rel.source,
              activeSelectedRel.rel.target,
              newLabel,
              activeSelectedRel.rel.id
            )
          }
        />
      )}
    </div>
  );
};

export default GraphCanvas;
