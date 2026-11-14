/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useMemo, useEffect, useRef, useId } from 'react';
import {
  normalizeAndDeduplicateRelationships,
  splitSceneAndObjectEntities,
  truncateLabel,
} from '../lib/beliefGraphUtils';
import {
  computeFitTransform,
  computeForceLayout,
  computeNodeDimensions,
  getEdgePath,
  type ViewTransform,
} from '../lib/graphLayout';
import { decodePairKey, encodePairKey } from '../lib/pendingUpdates';
import type { BeliefState, Entity, Relationship } from '../shared/types';
import AttributeEditor from './AttributeEditor';
import RelationshipEditor from './RelationshipEditor';

interface BeliefGraphProps {
  data: BeliefState | null;
  isLoading: boolean;
  error?: string | null;
  view: 'graph' | 'attributes';
  pendingAttributeUpdates: Record<string, string>;
  setPendingAttributeUpdates: React.Dispatch<React.SetStateAction<Record<string, string>>>;
  pendingRelationshipUpdates: Record<string, string>;
  setPendingRelationshipUpdates: React.Dispatch<React.SetStateAction<Record<string, string>>>;
  currentPrompt: string;
}

const ThinkingProcess: React.FC<{ prompt: string }> = ({ prompt }) => {
  const [step, setStep] = useState(0);

  const steps = useMemo(() => {
    const cleanPrompt = prompt.toLowerCase().replace(/[^\w\s]/g, '');
    const words = cleanPrompt.split(/\s+/).filter((w) => w.length > 0);
    const hasHuman = words.some((w) =>
      [
        'man',
        'woman',
        'boy',
        'girl',
        'person',
        'people',
        'child',
        'kid',
        'guy',
        'lady',
        'friends',
        'family',
        'couple',
      ].includes(w)
    );
    const hasAction = words.some((w) => w.endsWith('ing'));
    const stopWords = [
      'about',
      'after',
      'before',
      'their',
      'where',
      'which',
      'there',
      'could',
      'would',
      'with',
      'from',
      'that',
      'this',
      'some',
      'what',
    ];
    const significantWord =
      words.find((w) => w.length > 3 && !stopWords.includes(w)) || 'entities';
    const truncatedKeyword =
      significantWord.length > 10 ? `${significantWord.substring(0, 9)}...` : significantWord;

    const generatedSteps = [
      'Parsing prompt syntax...',
      `Identifying key concepts like '${truncatedKeyword}'...`,
      hasHuman ? 'Analyzing poses and expressions...' : 'Analyzing object attributes...',
      'Deducing implicit surroundings...',
    ];
    if (hasAction) generatedSteps.push('Mapping interaction dynamics...');
    return generatedSteps;
  }, [prompt]);

  useEffect(() => {
    const interval = setInterval(() => {
      setStep((s) => (s + 1) % steps.length);
    }, 2200);
    return () => clearInterval(interval);
  }, [steps]);

  return (
    <span className="text-sm font-medium text-gray-700 dark:text-gray-200 min-w-[240px] text-center">
      {steps[step]}
    </span>
  );
};

const EmptyStatePlaceholder: React.FC<{ text: string }> = ({ text }) => (
  <div className="bg-gray-50 dark:bg-gray-900/50 border border-gray-200 dark:border-gray-700 rounded-lg flex flex-col items-center justify-center text-center text-gray-500 dark:text-gray-400 p-8 max-w-lg w-full mx-auto my-auto">
    <svg
      xmlns="http://www.w3.org/2000/svg"
      className="h-11 w-11 mb-3 text-gray-400 dark:text-gray-500"
      fill="none"
      viewBox="0 0 24 24"
      stroke="currentColor"
      aria-hidden="true"
    >
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth={1.5}
        d="M19.428 15.428a2 2 0 00-1.022-.547l-2.384-.477a6 6 0 00-3.86.517l-.318.158a6 6 0 01-3.86.517L6.05 15.21a2 2 0 00-1.806.547M8 4h8l-1 1v5.172a2 2 0 00.586 1.414l5 5c1.26 1.26.367 3.414-1.415 3.414H4.828c-1.782 0-2.674-2.154-1.414-3.414l5-5A2 2 0 009 10.172V5L8 4z"
      />
    </svg>
    <p className="text-sm font-medium">{text}</p>
  </div>
);

const BeliefGraph: React.FC<BeliefGraphProps> = ({
  data,
  isLoading,
  error,
  view,
  pendingAttributeUpdates,
  setPendingAttributeUpdates,
  pendingRelationshipUpdates,
  setPendingRelationshipUpdates,
  currentPrompt,
}) => {
  const [graphInteraction, setGraphInteraction] = useState<{
    data: BeliefState | null;
    selectedEntity: Entity | null;
    selectedRel: { rel: Relationship; position: { x: number; y: number } } | null;
    viewTransform: ViewTransform | null;
  }>({
    data,
    selectedEntity: null,
    selectedRel: null,
    viewTransform: null,
  });

  const isSameData = graphInteraction.data === data;
  const selectedEntity = isSameData ? graphInteraction.selectedEntity : null;
  const selectedRel = isSameData ? graphInteraction.selectedRel : null;

  const setSelectedEntity = (entity: Entity | null) => {
    setGraphInteraction((prev) => ({
      data,
      selectedEntity: entity,
      selectedRel: prev.data === data ? prev.selectedRel : null,
      viewTransform: prev.data === data ? prev.viewTransform : null,
    }));
  };

  const setSelectedRel = (
    rel: { rel: Relationship; position: { x: number; y: number } } | null
  ) => {
    setGraphInteraction((prev) => ({
      data,
      selectedEntity: prev.data === data ? prev.selectedEntity : null,
      selectedRel: rel,
      viewTransform: prev.data === data ? prev.viewTransform : null,
    }));
  };

  const [hoveredEntity, setHoveredEntity] = useState<string | null>(null);
  const [hoveredRel, setHoveredRel] = useState<Relationship | null>(null);
  const [dimensions, setDimensions] = useState({ width: 0, height: 0 });
  const markerId = useId();

  const [isDragging, setIsDragging] = useState(false);
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
  }, [view]);

  useEffect(() => {
    if (!selectedEntity) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setGraphInteraction((prev) =>
          prev.data === data ? { ...prev, selectedEntity: null } : prev
        );
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [selectedEntity, data]);

  const handleAttributeChange = (
    entityName: string,
    attributeName: string,
    newValue: string
  ) => {
    const key = encodePairKey(entityName, attributeName);
    setPendingAttributeUpdates((prev) => ({ ...prev, [key]: newValue }));
  };

  const handleRelationshipChange = (source: string, target: string, newLabel: string) => {
    const key = encodePairKey(source, target);
    setPendingRelationshipUpdates((prev) => ({ ...prev, [key]: newLabel }));
  };

  const { sceneEntity, objectEntities } = useMemo(
    () => splitSceneAndObjectEntities(data?.entities ?? []),
    [data]
  );

  const nodeDimensions = useMemo(
    () => computeNodeDimensions(objectEntities),
    [objectEntities]
  );

  const relationships = useMemo(
    () => normalizeAndDeduplicateRelationships(data?.relationships, objectEntities),
    [data, objectEntities]
  );

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

  const nodePositions = useMemo(() => {
    if (objectEntities.length === 0) return {};
    return computeForceLayout({
      objectEntities,
      relationships,
      nodeDimensions,
      containerWidth: dimensions.width || 600,
      containerHeight: dimensions.height || 400,
    });
  }, [objectEntities, relationships, nodeDimensions, dimensions]);

  const fitTransform = useMemo(
    () =>
      computeFitTransform(
        nodePositions,
        nodeDimensions,
        dimensions.width || 600,
        dimensions.height || 400
      ),
    [nodePositions, nodeDimensions, dimensions]
  );

  const viewTransform =
    isSameData && graphInteraction.viewTransform ? graphInteraction.viewTransform : fitTransform;

  const setViewTransform = (
    updater: ViewTransform | null | ((prev: ViewTransform) => ViewTransform)
  ) => {
    setGraphInteraction((prev) => {
      const currentTransform =
        prev.data === data && prev.viewTransform ? prev.viewTransform : fitTransform;
      const nextTransform =
        typeof updater === 'function' ? updater(currentTransform) : updater;
      return {
        data,
        selectedEntity: prev.data === data ? prev.selectedEntity : null,
        selectedRel: prev.data === data ? prev.selectedRel : null,
        viewTransform: nextTransform,
      };
    });
  };

  const openRelationshipEditorAtClientPoint = (
    rel: Relationship,
    clientX: number,
    clientY: number,
    element: Element
  ) => {
    if (selectedRel?.rel === rel) {
      setSelectedRel(null);
    } else {
      const container = element.closest('div.relative');
      if (container) {
        const svgRect = container.getBoundingClientRect();
        setSelectedRel({
          rel,
          position: { x: clientX - svgRect.left, y: clientY - svgRect.top },
        });
      }
    }
    setSelectedEntity(null);
  };

  const handleRelationshipClick = (rel: Relationship, event: React.MouseEvent) => {
    openRelationshipEditorAtClientPoint(rel, event.clientX, event.clientY, event.currentTarget);
  };

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
        setViewTransform((prev) => ({
          ...prev,
          k: Math.min(4, Math.max(0.25, prev.k * zoomFactor)),
        }));
      }
      prevPinchDistRef.current = dist;
    } else if (pointers.length === 1 && isDragging && dragStartRef.current) {
      const dx = pointers[0].x - dragStartRef.current.x;
      const dy = pointers[0].y - dragStartRef.current.y;
      setViewTransform((prev) => ({ ...prev, x: prev.x + dx, y: prev.y + dy }));
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
    setViewTransform((prev) => ({
      ...prev,
      k: Math.min(4, Math.max(0.25, prev.k * Math.exp(delta))),
    }));
  };

  const zoomIn = () =>
    setViewTransform((prev) => ({ ...prev, k: Math.min(4, prev.k * 1.2) }));
  const zoomOut = () =>
    setViewTransform((prev) => ({ ...prev, k: Math.max(0.25, prev.k / 1.2) }));
  const resetView = () => setViewTransform(null);

  const cardStyle = useMemo(() => {
    if (dimensions.width >= 768 && selectedEntity && nodePositions[selectedEntity.name]) {
      const pos = nodePositions[selectedEntity.name];
      const x = pos.x * viewTransform.k + viewTransform.x;
      const y = pos.y * viewTransform.k + viewTransform.y;

      const CARD_WIDTH = 384;
      const PADDING = 20;
      const SAFE_MARGIN = 40;

      const dims = nodeDimensions[selectedEntity.name];
      const nodeHalfWidth = ((dims?.width ?? 90) / 2) * viewTransform.k;

      const isLeftHalf = x < dimensions.width / 2;
      let left: number;
      if (isLeftHalf) {
        left = x + nodeHalfWidth + PADDING;
        if (left + CARD_WIDTH > dimensions.width - PADDING) {
          const altLeft = x - nodeHalfWidth - PADDING - CARD_WIDTH;
          if (altLeft > PADDING) left = altLeft;
        }
      } else {
        left = x - nodeHalfWidth - PADDING - CARD_WIDTH;
        if (left < PADDING) {
          const altLeft = x + nodeHalfWidth + PADDING;
          if (altLeft + CARD_WIDTH < dimensions.width - PADDING) left = altLeft;
        }
      }
      if (left < PADDING) left = PADDING;
      if (left + CARD_WIDTH > dimensions.width - PADDING) {
        left = dimensions.width - CARD_WIDTH - PADDING;
      }

      const isBottomHalf = y > dimensions.height / 2;
      const style: React.CSSProperties = {
        position: 'absolute',
        left,
        right: 'auto',
        width: CARD_WIDTH,
        display: 'flex',
        flexDirection: 'column',
      };

      if (isBottomHalf) {
        const bottom = Math.max(PADDING, dimensions.height - y - 20);
        style.bottom = bottom;
        style.top = 'auto';
        style.maxHeight = Math.max(120, dimensions.height - bottom - SAFE_MARGIN);
      } else {
        const top = Math.max(PADDING, y - 20);
        style.top = top;
        style.bottom = 'auto';
        style.maxHeight = Math.max(120, dimensions.height - top - SAFE_MARGIN);
      }
      return style;
    }
    return undefined;
  }, [selectedEntity, nodePositions, viewTransform, nodeDimensions, dimensions]);

  const modifiedEntities = useMemo(() => {
    const names = new Set<string>();
    for (const key of Object.keys(pendingAttributeUpdates)) {
      const pair = decodePairKey(key);
      if (pair) {
        names.add(pair[0]);
      }
    }
    return names;
  }, [pendingAttributeUpdates]);

  return (
    <div className="bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700 w-full flex flex-col flex-1 min-h-0 relative transition-colors duration-200">
      {isLoading && (
        <div
          className="absolute inset-0 bg-white/85 dark:bg-gray-900/85 backdrop-blur-sm flex items-center justify-center z-50 rounded-lg"
          role="status"
          aria-live="polite"
        >
          <div className="flex flex-col items-center p-6 bg-white dark:bg-gray-800 rounded-xl shadow-lg border border-gray-200 dark:border-gray-700 max-w-sm w-full mx-4">
            <svg
              className="animate-spin h-9 w-9 text-blue-600 dark:text-blue-400 mb-3"
              xmlns="http://www.w3.org/2000/svg"
              fill="none"
              viewBox="0 0 24 24"
              aria-hidden="true"
            >
              <circle
                className="opacity-25"
                cx="12"
                cy="12"
                r="10"
                stroke="currentColor"
                strokeWidth="4"
              />
              <path
                className="opacity-75"
                fill="currentColor"
                d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
              />
            </svg>
            <ThinkingProcess prompt={currentPrompt} />
          </div>
        </div>
      )}

      {/* Attributes View */}
      <div
        style={{ display: view === 'attributes' ? 'flex' : 'none' }}
        className="flex-col overflow-y-auto flex-grow w-full h-full bg-white dark:bg-gray-800 rounded-lg"
      >
        <div
          className={`p-5 space-y-2 flex-grow ${
            !sceneEntity || sceneEntity.attributes.length === 0 ? 'flex flex-col' : ''
          }`}
        >
          {error && !isLoading ? (
            <div className="my-auto mx-auto max-w-md bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg p-5 text-center" role="alert">
              <p className="text-sm font-semibold text-red-800 dark:text-red-200">
                Analysis failed
              </p>
              <p className="text-xs text-red-700 dark:text-red-300 mt-1">{error}</p>
            </div>
          ) : sceneEntity && sceneEntity.attributes.length > 0 ? (
            sceneEntity.attributes
              .filter(
                (attr) =>
                  attr.name !== 'existence' && attr.name !== 'existence_in_image'
              )
              .map((attr) => (
                <AttributeEditor
                  key={`${sceneEntity.name}-${attr.name}`}
                  attribute={attr}
                  entity={sceneEntity}
                  onChange={handleAttributeChange}
                  isLoading={isLoading}
                  pendingValue={
                    pendingAttributeUpdates[encodePairKey(sceneEntity.name, attr.name)]
                  }
                />
              ))
          ) : (
            !isLoading && (
              <EmptyStatePlaceholder text="Scene attributes will appear here after analyzing or generating a prompt." />
            )
          )}
        </div>
      </div>

      {/* Graph View */}
      <div
        style={{ display: view === 'graph' ? 'flex' : 'none', touchAction: 'none' }}
        className="flex-col flex-grow w-full h-full cursor-move active:cursor-grabbing relative group rounded-lg"
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerLeave={handlePointerUp}
        onWheel={handleWheel}
      >
        <div
          ref={containerElementRef}
          className={`relative bg-gray-50/60 dark:bg-gray-900/60 w-full h-full overflow-hidden rounded-lg ${
            !data && !isLoading ? 'flex items-center justify-center p-6' : ''
          }`}
        >
          {data && (
            <div className="absolute top-3 left-3 flex flex-col gap-1.5 z-40">
              <button
                type="button"
                onClick={zoomIn}
                className="bg-white dark:bg-gray-700 min-w-[36px] min-h-[36px] p-2 rounded-md border border-gray-200 dark:border-gray-600 shadow-sm text-gray-700 dark:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 flex items-center justify-center"
                title="Zoom In"
                aria-label="Zoom in belief graph"
              >
                <svg
                  xmlns="http://www.w3.org/2000/svg"
                  className="h-4 w-4"
                  viewBox="0 0 20 20"
                  fill="currentColor"
                  aria-hidden="true"
                >
                  <path
                    fillRule="evenodd"
                    d="M10 5a1 1 0 011 1v3h3a1 1 0 110 2h-3v3a1 1 0 11-2 0v-3H6a1 1 0 110-2h3V6a1 1 0 011-1z"
                    clipRule="evenodd"
                  />
                </svg>
              </button>
              <button
                type="button"
                onClick={zoomOut}
                className="bg-white dark:bg-gray-700 min-w-[36px] min-h-[36px] p-2 rounded-md border border-gray-200 dark:border-gray-600 shadow-sm text-gray-700 dark:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 flex items-center justify-center"
                title="Zoom Out"
                aria-label="Zoom out belief graph"
              >
                <svg
                  xmlns="http://www.w3.org/2000/svg"
                  className="h-4 w-4"
                  viewBox="0 0 20 20"
                  fill="currentColor"
                  aria-hidden="true"
                >
                  <path
                    fillRule="evenodd"
                    d="M5 10a1 1 0 011-1h8a1 1 0 110 2H6a1 1 0 01-1-1z"
                    clipRule="evenodd"
                  />
                </svg>
              </button>
              <button
                type="button"
                onClick={resetView}
                className="bg-white dark:bg-gray-700 min-w-[36px] min-h-[36px] p-2 rounded-md border border-gray-200 dark:border-gray-600 shadow-sm text-gray-700 dark:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 flex items-center justify-center"
                title="Reset View"
                aria-label="Reset belief graph view"
              >
                <svg
                  xmlns="http://www.w3.org/2000/svg"
                  className="h-4 w-4"
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                  aria-hidden="true"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M4 8V4m0 0h4M4 4l5 5m11-1V4m0 0h-4m4 0l-5 5M4 16v4m0 0h4m-4 0l5-5m11 5l-5-5m5 5v-4m0 4h-4"
                  />
                </svg>
              </button>
            </div>
          )}

          {error && !data && !isLoading && (
            <div className="my-auto mx-auto max-w-md bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg p-5 text-center" role="alert">
              <p className="text-sm font-semibold text-red-800 dark:text-red-200">
                Belief graph analysis failed
              </p>
              <p className="text-xs text-red-700 dark:text-red-300 mt-1">{error}</p>
            </div>
          )}

          {!data && !isLoading && !error && (
            <EmptyStatePlaceholder text="The belief graph will visualize entities and relationships after analyzing or generating a prompt." />
          )}

          {data && (
            <svg
              width="100%"
              height="100%"
              viewBox={`0 0 ${dimensions.width || 600} ${dimensions.height || 400}`}
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
                  <path d="M 0 0 L 10 5 L 0 10 z" className="fill-slate-400 dark:fill-slate-500" />
                </marker>
              </defs>

              <g transform={`translate(${viewTransform.x}, ${viewTransform.y}) scale(${viewTransform.k})`}>
                {relationships.map((rel, i) => {
                  const sourcePos = nodePositions[rel.source];
                  const targetPos = nodePositions[rel.target];
                  if (!sourcePos || !targetPos) return null;
                  const sourceDims = nodeDimensions[rel.source];
                  const targetDims = nodeDimensions[rel.target];
                  if (!sourceDims || !targetDims) return null;

                  const { path, labelX, labelY } = getEdgePath(
                    sourcePos.x,
                    sourcePos.y,
                    targetPos.x,
                    targetPos.y,
                    sourceDims.width,
                    sourceDims.height,
                    targetDims.width,
                    targetDims.height
                  );

                  let opacity = 1;
                  if (hoveredRel) opacity = rel === hoveredRel ? 1 : 0.15;
                  else if (hoveredEntity)
                    opacity = rel.source === hoveredEntity || rel.target === hoveredEntity ? 1 : 0.15;
                  else if (selectedEntity)
                    opacity =
                      rel.source === selectedEntity.name || rel.target === selectedEntity.name
                        ? 1
                        : 0.15;

                  const relKey = encodePairKey(rel.source, rel.target);
                  const isSelected =
                    selectedRel?.rel.source === rel.source &&
                    selectedRel?.rel.target === rel.target &&
                    selectedRel?.rel.label === rel.label;
                  const isModified = pendingRelationshipUpdates[relKey] !== undefined;
                  const currentLabel = pendingRelationshipUpdates[relKey] || rel.label;

                  return (
                    <g
                      key={`rel-${rel.source}-${rel.target}-${i}`}
                      style={{ opacity, transition: 'opacity 0.2s ease-in-out' }}
                      className="cursor-pointer focus:outline-none"
                      role="button"
                      tabIndex={0}
                      aria-label={`Relationship: ${rel.source} ${currentLabel} ${rel.target}. Press Enter to edit.`}
                      onMouseEnter={() => setHoveredRel(rel)}
                      onMouseLeave={() => setHoveredRel(null)}
                      onPointerDown={(e) => e.stopPropagation()}
                      onClick={(e) => {
                        e.stopPropagation();
                        handleRelationshipClick(rel, e);
                      }}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' || e.key === ' ') {
                          e.preventDefault();
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
                          isModified || isSelected
                            ? 'stroke-blue-500 dark:stroke-blue-400'
                            : 'stroke-slate-400 dark:stroke-slate-500'
                        }
                        strokeWidth={isModified ? 3 : 2}
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
                          isModified || isSelected
                            ? 'fill-blue-700 dark:fill-blue-300 stroke-white dark:stroke-gray-900'
                            : 'fill-slate-700 dark:fill-slate-200 stroke-white dark:stroke-gray-900'
                        }
                      >
                        {truncateLabel(currentLabel, 18)}
                      </text>
                    </g>
                  );
                })}

                {objectEntities.map((entity) => {
                  const pos = nodePositions[entity.name];
                  if (!pos) return null;
                  const isSelected = selectedEntity?.name === entity.name;
                  const dims = nodeDimensions[entity.name] ?? { width: 90, height: 36 };
                  const hasModifiedAttr = modifiedEntities.has(entity.name);

                  let opacity = 1;
                  if (hoveredRel)
                    opacity =
                      entity.name === hoveredRel.source || entity.name === hoveredRel.target
                        ? 1
                        : 0.15;
                  else if (hoveredEntity)
                    opacity =
                      entity.name === hoveredEntity || neighborsOfHovered.has(entity.name)
                        ? 1
                        : 0.15;
                  else if (selectedEntity)
                    opacity =
                      entity.name === selectedEntity.name ||
                      (neighborsOfSelected && neighborsOfSelected.has(entity.name))
                        ? 1
                        : 0.15;

                  return (
                    <g
                      key={entity.name}
                      transform={`translate(${pos.x}, ${pos.y})`}
                      className="cursor-pointer focus:outline-none"
                      role="button"
                      tabIndex={0}
                      aria-label={`Entity ${entity.name}. ${entity.presence_in_prompt ? 'Explicit' : 'Implicit'}. Press Enter to inspect attributes.`}
                      onClick={(e) => {
                        e.stopPropagation();
                        setSelectedEntity(entity);
                        setSelectedRel(null);
                      }}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' || e.key === ' ') {
                          e.preventDefault();
                          setSelectedEntity(entity);
                          setSelectedRel(null);
                        }
                      }}
                      onMouseEnter={() => setHoveredEntity(entity.name)}
                      onMouseLeave={() => setHoveredEntity(null)}
                      style={{ opacity, transition: 'opacity 0.2s ease-in-out' }}
                    >
                      <rect
                        x={-dims.width / 2}
                        y={-dims.height / 2}
                        width={dims.width}
                        height={dims.height}
                        rx="8"
                        className={
                          isSelected
                            ? 'fill-amber-50 dark:fill-amber-900/50 stroke-amber-400 dark:stroke-amber-400'
                            : hasModifiedAttr
                              ? 'fill-blue-50 dark:fill-blue-900/40 stroke-blue-500 dark:stroke-blue-400'
                              : 'fill-white dark:fill-gray-800 stroke-slate-300 dark:stroke-gray-600'
                        }
                        strokeWidth={2}
                        strokeDasharray={entity.presence_in_prompt ? 'none' : '4 2'}
                      />
                      <text
                        textAnchor="middle"
                        dy="0.32em"
                        fontSize="12"
                        fontWeight="600"
                        className="fill-slate-800 dark:fill-gray-100"
                      >
                        {entity.name}
                      </text>
                    </g>
                  );
                })}
              </g>
            </svg>
          )}

          {data && objectEntities.length === 0 && !isLoading && (
            <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
              <div className="text-center text-gray-600 dark:text-gray-300 bg-white/90 dark:bg-gray-800/90 backdrop-blur-sm p-4 rounded-lg border border-gray-200 dark:border-gray-700 pointer-events-auto">
                <p className="font-semibold text-sm">No object entities found to display.</p>
                <p className="text-xs mt-1 text-gray-500 dark:text-gray-400">
                  Check the attributes tab for scene-level properties.
                </p>
              </div>
            </div>
          )}
        </div>

        {selectedRel && (
          <RelationshipEditor
            rel={selectedRel.rel}
            currentLabel={
              pendingRelationshipUpdates[
                encodePairKey(selectedRel.rel.source, selectedRel.rel.target)
              ] || selectedRel.rel.label
            }
            position={selectedRel.position}
            containerDimensions={dimensions}
            onClose={() => setSelectedRel(null)}
            isLoading={isLoading}
            onChange={(newLabel) =>
              handleRelationshipChange(selectedRel.rel.source, selectedRel.rel.target, newLabel)
            }
          />
        )}

        {selectedEntity && (
          <div
            role="dialog"
            aria-label={`Attributes for ${selectedEntity.name}`}
            className={`absolute bottom-4 left-4 right-4 md:w-96 bg-white/95 dark:bg-gray-800/95 backdrop-blur-sm rounded-lg border border-gray-200 dark:border-gray-700 shadow-xl animate-fade-in z-[100] flex flex-col overflow-hidden ${
              cardStyle ? '' : 'md:right-4 md:top-4 md:bottom-auto md:left-auto md:max-h-[60vh]'
            }`}
            style={{ ...cardStyle, touchAction: 'pan-y' }}
            onClick={(e) => e.stopPropagation()}
            onPointerDown={(e) => e.stopPropagation()}
            onWheel={(e) => e.stopPropagation()}
          >
            <button
              type="button"
              onClick={() => setSelectedEntity(null)}
              className="absolute top-3 right-3 text-gray-500 hover:text-gray-800 dark:text-gray-400 dark:hover:text-gray-100 z-10 bg-white/70 dark:bg-gray-800/70 rounded-md p-1 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
              aria-label={`Close ${selectedEntity.name} inspector`}
            >
              <svg
                xmlns="http://www.w3.org/2000/svg"
                className="h-5 w-5"
                viewBox="0 0 20 20"
                fill="currentColor"
                aria-hidden="true"
              >
                <path
                  fillRule="evenodd"
                  d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z"
                  clipRule="evenodd"
                />
              </svg>
            </button>

            <div className="overflow-y-auto p-4 pt-5 min-h-0 flex-grow">
              <div className="pr-8 mb-2">
                <h3 className="font-display font-bold text-base text-gray-900 dark:text-gray-100 leading-tight">
                  {selectedEntity.name}
                </h3>
                {selectedEntity.description && (
                  <p className="text-xs text-gray-600 dark:text-gray-400 mt-1">
                    {selectedEntity.description}
                  </p>
                )}
              </div>

              <div className="border-b border-gray-200 dark:border-gray-700 mb-2" />

              {selectedEntity.attributes.length > 0 && (
                <div className="space-y-1">
                  {selectedEntity.attributes.map((attr) => (
                    <AttributeEditor
                      key={attr.name}
                      attribute={attr}
                      entity={selectedEntity}
                      onChange={handleAttributeChange}
                      isLoading={isLoading}
                      pendingValue={
                        pendingAttributeUpdates[encodePairKey(selectedEntity.name, attr.name)]
                      }
                    />
                  ))}
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default BeliefGraph;
