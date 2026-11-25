/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useEffect, useId, useMemo, useRef, useState } from 'react';
import { truncateLabel } from '../../lib/beliefGraphUtils';
import {
  computeFitTransform,
  computeForceLayout,
  computeNodeDimensions,
  computeParallelEdgeOffsets,
  getEdgePath,
  type ViewTransform,
} from '../../lib/graphLayout';
import type { BeliefState, Entity, Relationship } from '../../shared/types';
import RelationshipEditor from '../RelationshipEditor';

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
  const [hoveredEntity, setHoveredEntity] = useState<string | null>(null);
  const [hoveredRel, setHoveredRel] = useState<Relationship | null>(null);
  const [selectedRel, setSelectedRel] = useState<{
    rel: Relationship;
    position: { x: number; y: number };
  } | null>(null);
  const [dimensions, setDimensions] = useState({ width: 0, height: 0 });
  const [isDragging, setIsDragging] = useState(false);

  const markerId = useId();
  const dragStartRef = useRef<{ x: number; y: number } | null>(null);
  const activePointersRef = useRef<Map<number, { x: number; y: number }>>(new Map());
  const prevPinchDistRef = useRef<number | null>(null);
  const containerElementRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const node = containerElementRef.current;
    if (!node) return;

    const resizeObserver = new ResizeObserver((entries) => {
      for (const entry of entries) {
        const { width, height } = entry.contentRect;
        if (width > 0 && height > 0) {
          setDimensions((prev) => {
            if (Math.abs(prev.width - width) > 2 || Math.abs(prev.height - height) > 2) {
              return { width, height };
            }
            return prev;
          });
        }
      }
    });
    resizeObserver.observe(node);

    const rect = node.getBoundingClientRect();
    if (rect.width > 0 && rect.height > 0) {
      setDimensions({ width: rect.width, height: rect.height });
    }

    return () => resizeObserver.disconnect();
  }, []);

  const nodeDimensions = useMemo(
    () => computeNodeDimensions(visibleEntities),
    [visibleEntities]
  );

  const parallelEdgeOffsets = useMemo(
    () => computeParallelEdgeOffsets(relationships),
    [relationships]
  );

  // Structural signature for layout stability (only re-run full layout if entity names/edges change)
  const topologySignature = useMemo(() => {
    const nodeKeys = visibleEntities
      .map((e) => e.id ?? e.name)
      .sort()
      .join('|');
    const edgeKeys = relationships
      .map((r) => `${r.source}->${r.target}::${r.label}`)
      .sort()
      .join('|');
    return `${nodeKeys}::${edgeKeys}`;
  }, [visibleEntities, relationships]);

  const nodePositions = useMemo(() => {
    if (visibleEntities.length === 0) return {};
    return computeForceLayout({
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
      computeFitTransform(
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
    const pos = nodePositions[focusRequest.entityName];
    if (!pos) return;
    const w = dimensions.width || 680;
    const h = dimensions.height || 440;
    const targetK = 1.35;
    onChangeUserTransform({
      x: w / 2 - pos.x * targetK,
      y: h / 2 - pos.y * targetK,
      k: targetK,
    });
  }, [focusRequest, nodePositions, dimensions.width, dimensions.height, onChangeUserTransform]);

  const neighborsOfSelected = useMemo(() => {
    if (!selectedEntity) return null;
    const neighbors = new Set<string>();
    for (const rel of relationships) {
      if (rel.source === selectedEntity.name) neighbors.add(rel.target);
      if (rel.target === selectedEntity.name) neighbors.add(rel.source);
    }
    return neighbors;
  }, [selectedEntity, relationships]);

  const neighborsOfHovered = useMemo(() => {
    if (!hoveredEntity) return new Set<string>();
    const neighbors = new Set<string>();
    for (const rel of relationships) {
      if (rel.source === hoveredEntity) neighbors.add(rel.target);
      if (rel.target === hoveredEntity) neighbors.add(rel.source);
    }
    return neighbors;
  }, [hoveredEntity, relationships]);

  const handlePointerDown = (e: React.PointerEvent) => {
    if ((e.target as HTMLElement).closest('button, input, select')) return;
    e.preventDefault();
    activePointersRef.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (activePointersRef.current.size === 1) {
      setIsDragging(true);
      dragStartRef.current = { x: e.clientX, y: e.clientY };
    }
    if (activePointersRef.current.size === 2) {
      prevPinchDistRef.current = null;
    }
    setSelectedRel(null);
  };

  const handlePointerMove = (e: React.PointerEvent) => {
    if (!activePointersRef.current.has(e.pointerId)) return;
    e.preventDefault();
    activePointersRef.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    const pointers = Array.from(activePointersRef.current.values());
    if (pointers.length === 2) {
      const dist = Math.hypot(
        pointers[1].x - pointers[0].x,
        pointers[1].y - pointers[0].y
      );
      if (prevPinchDistRef.current !== null && prevPinchDistRef.current > 0) {
        const zoomFactor = dist / prevPinchDistRef.current;
        onChangeUserTransform((prev) => {
          const cur = prev ?? fitTransform;
          return {
            ...cur,
            k: Math.min(4, Math.max(0.25, cur.k * zoomFactor)),
          };
        });
      }
      prevPinchDistRef.current = dist;
    } else if (pointers.length === 1 && isDragging && dragStartRef.current) {
      const dx = pointers[0].x - dragStartRef.current.x;
      const dy = pointers[0].y - dragStartRef.current.y;
      onChangeUserTransform((prev) => {
        const cur = prev ?? fitTransform;
        return { ...cur, x: cur.x + dx, y: cur.y + dy };
      });
      dragStartRef.current = { x: pointers[0].x, y: pointers[0].y };
    }
  };

  const handlePointerUp = (e: React.PointerEvent) => {
    activePointersRef.current.delete(e.pointerId);
    if (activePointersRef.current.size < 2) prevPinchDistRef.current = null;
    if (activePointersRef.current.size === 0) {
      setIsDragging(false);
      dragStartRef.current = null;
    } else if (activePointersRef.current.size === 1) {
      const p = activePointersRef.current.values().next().value;
      if (p) dragStartRef.current = { x: p.x, y: p.y };
    }
  };

  const handleWheel = (e: React.WheelEvent) => {
    e.preventDefault();
    const delta = -e.deltaY * 0.001;
    onChangeUserTransform((prev) => {
      const cur = prev ?? fitTransform;
      return {
        ...cur,
        k: Math.min(4, Math.max(0.25, cur.k * Math.exp(delta))),
      };
    });
  };

  const zoomIn = () =>
    onChangeUserTransform((prev) => {
      const cur = prev ?? fitTransform;
      return { ...cur, k: Math.min(4, cur.k * 1.2) };
    });

  const zoomOut = () =>
    onChangeUserTransform((prev) => {
      const cur = prev ?? fitTransform;
      return { ...cur, k: Math.max(0.25, cur.k / 1.2) };
    });

  const resetView = () => onChangeUserTransform(null);

  const openRelationshipEditorAtClientPoint = (
    rel: Relationship,
    clientX: number,
    clientY: number,
    element: Element
  ) => {
    const container = element.closest('div.relative');
    if (container) {
      const svgRect = container.getBoundingClientRect();
      setSelectedRel({
        rel,
        position: { x: clientX - svgRect.left, y: clientY - svgRect.top },
      });
    }
  };

  return (
    <div
      style={{ touchAction: 'none' }}
      className="flex-1 w-full min-h-0 cursor-move active:cursor-grabbing relative flex flex-col"
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onPointerLeave={handlePointerUp}
      onWheel={handleWheel}
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
              {relationships.map((rel, i) => {
                const sourcePos = nodePositions[rel.source];
                const targetPos = nodePositions[rel.target];
                if (!sourcePos || !targetPos) return null;
                const sourceDims = nodeDimensions[rel.source];
                const targetDims = nodeDimensions[rel.target];
                if (!sourceDims || !targetDims) return null;

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

                let opacity = 1;
                if (highlightConnections) {
                  if (hoveredRel) opacity = rel === hoveredRel ? 1 : 0.2;
                  else if (hoveredEntity)
                    opacity =
                      rel.source === hoveredEntity || rel.target === hoveredEntity ? 1 : 0.2;
                  else if (selectedEntity)
                    opacity =
                      rel.source === selectedEntity.name || rel.target === selectedEntity.name
                        ? 1
                        : 0.2;
                }

                const isModified =
                  rel.provenance === 'user-edit' || rel.provenance === 'accepted-suggestion';
                const isPending = rel.status === 'pending';
                const isSelectedRel =
                  selectedRelationship?.id === rel.id ||
                  (selectedRelationship?.source === rel.source &&
                    selectedRelationship?.target === rel.target &&
                    selectedRelationship?.label === rel.label);

                return (
                  <g
                    key={rel.id ?? `rel-${rel.source}-${rel.target}-${rel.label}-${i}`}
                    style={{ opacity, transition: 'opacity 0.15s ease-out' }}
                    className="cursor-pointer focus:outline-none"
                    role="button"
                    tabIndex={0}
                    aria-label={`Directed relationship: ${rel.source} ${rel.label} ${rel.target} (${rel.status ?? 'confirmed'}). Press Enter to inspect or edit.`}
                    onMouseEnter={() => setHoveredRel(rel)}
                    onMouseLeave={() => setHoveredRel(null)}
                    onPointerDown={(e) => e.stopPropagation()}
                    onClick={(e) => {
                      e.stopPropagation();
                      onSelectRelationship?.(rel);
                      openRelationshipEditorAtClientPoint(
                        rel,
                        e.clientX,
                        e.clientY,
                        e.currentTarget
                      );
                    }}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault();
                        onSelectRelationship?.(rel);
                        const rect = e.currentTarget.getBoundingClientRect();
                        openRelationshipEditorAtClientPoint(
                          rel,
                          rect.left + rect.width / 2,
                          rect.top + rect.height / 2,
                          e.currentTarget
                        );
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

              {visibleEntities.map((entity) => {
                const pos = nodePositions[entity.name];
                if (!pos) return null;
                const isSelected = selectedEntity?.name === entity.name;
                const dims = nodeDimensions[entity.name] ?? { width: 96, height: 36 };
                const hasConfirmedUserEdit =
                  entity.provenance === 'user-edit' ||
                  entity.attributes.some(
                    (a) =>
                      a.name !== 'existence' &&
                      (a.provenance === 'user-edit' || a.provenance === 'accepted-suggestion')
                  );

                let opacity = 1;
                if (highlightConnections) {
                  if (hoveredRel)
                    opacity =
                      entity.name === hoveredRel.source || entity.name === hoveredRel.target
                        ? 1
                        : 0.2;
                  else if (hoveredEntity)
                    opacity =
                      entity.name === hoveredEntity || neighborsOfHovered.has(entity.name)
                        ? 1
                        : 0.2;
                  else if (selectedEntity)
                    opacity =
                      entity.name === selectedEntity.name ||
                      Boolean(neighborsOfSelected && neighborsOfSelected.has(entity.name))
                        ? 1
                        : 0.25;
                }

                return (
                  <g
                    key={entity.id ?? entity.name}
                    transform={`translate(${pos.x}, ${pos.y})`}
                    className="cursor-pointer focus:outline-none"
                    role="button"
                    tabIndex={0}
                    aria-label={`Entity ${entity.name}. ${entity.presence_in_prompt ? 'Explicit' : 'Implicit'}. Press Enter to inspect attributes.`}
                    onClick={(e) => {
                      e.stopPropagation();
                      if (entity.id === 'ent_group_guests_synthetic') {
                        onExpandGuestGroup();
                        return;
                      }
                      onSelectEntity(entity);
                      onSelectRelationship?.(null);
                      setSelectedRel(null);
                    }}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault();
                        if (entity.id === 'ent_group_guests_synthetic') {
                          onExpandGuestGroup();
                          return;
                        }
                        onSelectEntity(entity);
                        onSelectRelationship?.(null);
                        setSelectedRel(null);
                      }
                    }}
                    onMouseEnter={() => setHoveredEntity(entity.name)}
                    onMouseLeave={() => setHoveredEntity(null)}
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
            </g>
          </svg>
        )}
      </div>

      {selectedRel && (
        <RelationshipEditor
          rel={selectedRel.rel}
          currentLabel={selectedRel.rel.label}
          position={selectedRel.position}
          containerDimensions={dimensions}
          onClose={() => setSelectedRel(null)}
          isLoading={isLoading}
          onChange={(newLabel) =>
            onRelationshipChange(
              selectedRel.rel.source,
              selectedRel.rel.target,
              newLabel,
              selectedRel.rel.id
            )
          }
        />
      )}
    </div>
  );
};

export default GraphCanvas;
