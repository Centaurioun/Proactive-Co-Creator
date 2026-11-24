/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useMemo, useEffect, useRef, useId } from 'react';
import {
  getEffectiveAttributeValue,
  inferEntityCategory,
  normalizeAndDeduplicateRelationships,
  splitSceneAndObjectEntities,
  truncateLabel,
} from '../lib/beliefGraphUtils';
import {
  computeFitTransform,
  computeForceLayout,
  computeNodeDimensions,
  computeParallelEdgeOffsets,
  getEdgePath,
  type ViewTransform,
} from '../lib/graphLayout';
import type {
  BeliefState,
  Entity,
  EntityCategory,
  Relationship,
  ConsistencyIssue,
} from '../shared/types';
import RelationshipEditor from './RelationshipEditor';
import type { RelationshipProjection } from '../lib/narrative/projections/relationshipProjection';

export interface BeliefGraphProps {
  data: BeliefState | null;
  isLoading: boolean;
  error?: string | null;
  selectedEntity: Entity | null;
  selectedRelationship?: Relationship | null;
  onSelectEntity: (entity: Entity | null) => void;
  onSelectRelationship?: (rel: Relationship | null) => void;
  onRelationshipChange: (source: string, target: string, newLabel: string, relationshipId?: string) => void;
  onAttributeChange?: (entityName: string, attributeName: string, newValue: string) => void;
  currentPrompt: string;
  consistencyIssues?: ConsistencyIssue[];
  relationshipProjection: RelationshipProjection;
}

const BeliefGraph: React.FC<BeliefGraphProps> = ({
  data,
  isLoading,
  error,
  selectedEntity,
  selectedRelationship = null,
  onSelectEntity,
  onSelectRelationship,
  onRelationshipChange,
  consistencyIssues = [],
  relationshipProjection,
}) => {
  // Belief Graph 2.0 navigation & filtering state
  const [searchQuery, setSearchQuery] = useState('');
  const [categoryFilter, setCategoryFilter] = useState<'all' | EntityCategory>('all');
  const [showInferred, setShowInferred] = useState(true);
  const [showExcluded, setShowExcluded] = useState(false);
  const [highlightConnections, setHighlightConnections] = useState(true);
  const [collapseGuestGroup, setCollapseGuestGroup] = useState(false);
  const [displayMode, setDisplayMode] = useState<'graph' | 'table'>('graph');
  const [selectedEntityRelationshipsOnly, setSelectedEntityRelationshipsOnly] = useState(false);

  const [hoveredEntity, setHoveredEntity] = useState<string | null>(null);
  const [hoveredRel, setHoveredRel] = useState<Relationship | null>(null);
  const [selectedRel, setSelectedRel] = useState<{
    rel: Relationship;
    position: { x: number; y: number };
  } | null>(null);

  const [dimensions, setDimensions] = useState({ width: 0, height: 0 });
  const [userTransform, setUserTransform] = useState<ViewTransform | null>(null);
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
  }, [displayMode]);

  const { objectEntities: rawObjectEntities } = useMemo(
    () => splitSceneAndObjectEntities(data?.entities ?? []),
    [data]
  );

  // Filter and optionally group entities
  const visibleEntities = useMemo(() => {
    let list: Entity[] = rawObjectEntities.map((e) => ({
      ...e,
      category: inferEntityCategory(e),
    }));

    if (!showExcluded) {
      list = list.filter((e) => !e.excluded);
    }
    if (!showInferred) {
      list = list.filter((e) => e.presence_in_prompt || e.status === 'confirmed');
    }
    if (categoryFilter !== 'all') {
      list = list.filter((e) => e.category === categoryFilter);
    }

    // Generic group collapse when toggled: collapses explicit groupId clusters first,
    // or falls back to collapsing secondary character/category clusters of >= 2 members.
    if (collapseGuestGroup) {
      const explicitGroupMembers = list.filter((e) => Boolean(e.groupId));
      if (explicitGroupMembers.length > 1) {
        const nonGrouped = list.filter((e) => !e.groupId);
        const syntheticGroup: Entity = {
          id: 'ent_group_guests_synthetic',
          name: `Grouped Entities (${explicitGroupMembers.length})`,
          category: 'group',
          presence_in_prompt: true,
          description: `Grouped view of: ${explicitGroupMembers.map((m) => m.name).join(', ')}`,
          alternatives: null,
          status: 'confirmed',
          attributes: [],
          aliases: explicitGroupMembers.map((m) => m.name),
        };
        list = [...nonGrouped, syntheticGroup];
      } else {
        const chars = list.filter((e) => e.category === 'character');
        if (chars.length > 2) {
          const primaryChar = chars[0];
          const secondaryChars = chars.slice(1);
          const others = list.filter((e) => e.category !== 'character');
          const syntheticGroup: Entity = {
            id: 'ent_group_guests_synthetic',
            name: `Character Group (${secondaryChars.length})`,
            category: 'group',
            presence_in_prompt: true,
            description: `Grouped view of: ${secondaryChars.map((m) => m.name).join(', ')}`,
            alternatives: null,
            status: 'confirmed',
            attributes: [],
            aliases: secondaryChars.map((m) => m.name),
          };
          list = [primaryChar, ...others, syntheticGroup];
        }
      }
    }

    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      list = list.filter((e) => {
        const attrText = e.attributes
          .map((a) => `${a.name} ${getEffectiveAttributeValue(a)}`)
          .join(' ');
        const relMatch = (data?.relationships ?? []).some(
          (r) =>
            (r.source.toLowerCase() === e.name.toLowerCase() ||
              r.target.toLowerCase() === e.name.toLowerCase()) &&
            r.label.toLowerCase().includes(q)
        );
        return (
          e.name.toLowerCase().includes(q) ||
          e.description.toLowerCase().includes(q) ||
          attrText.toLowerCase().includes(q) ||
          relMatch
        );
      });
    }

    return list;
  }, [
    rawObjectEntities,
    showExcluded,
    showInferred,
    categoryFilter,
    collapseGuestGroup,
    searchQuery,
    data?.relationships,
  ]);

  const nodeDimensions = useMemo(
    () => computeNodeDimensions(visibleEntities),
    [visibleEntities]
  );

  const relationships = useMemo(() => {
    const normalized = normalizeAndDeduplicateRelationships(data?.relationships, visibleEntities);
    if (!showInferred) {
      return normalized.filter((r) => r.status === 'confirmed' || r.presence_in_prompt);
    }
    return normalized;
  }, [data?.relationships, visibleEntities, showInferred]);

  const projectedNodesById = useMemo(
    () => new Map(relationshipProjection.nodes.map(node => [node.id, node])),
    [relationshipProjection.nodes]
  );
  const tableRelationships = useMemo(() => relationshipProjection.edges.flatMap(edge => {
    if (selectedEntityRelationshipsOnly && selectedEntity?.id &&
      edge.sourceId !== selectedEntity.id && edge.targetId !== selectedEntity.id) return [];
    const source = projectedNodesById.get(edge.sourceId);
    const target = projectedNodesById.get(edge.targetId);
    const relationship = data?.relationships.find(item => item.id === edge.id);
    return source && target && relationship ? [{ edge, source, target, relationship }] : [];
  }), [relationshipProjection.edges, projectedNodesById, selectedEntityRelationshipsOnly, selectedEntity?.id, data?.relationships]);

  const parallelEdgeOffsets = useMemo(
    () => computeParallelEdgeOffsets(relationships),
    [relationships]
  );

  // Structural signature for layout stability (only re-run full layout if entity names/edges change)
  const topologySignature = useMemo(() => {
    const nodeKeys = visibleEntities.map((e) => e.id ?? e.name).sort().join('|');
    const edgeKeys = relationships.map((r) => `${r.source}->${r.target}::${r.label}`).sort().join('|');
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

  const focusOnEntity = (entity: Entity | null) => {
    if (!entity) return;
    const pos = nodePositions[entity.name];
    if (!pos) return;
    const w = dimensions.width || 680;
    const h = dimensions.height || 440;
    const targetK = 1.35;
    setUserTransform({
      x: w / 2 - pos.x * targetK,
      y: h / 2 - pos.y * targetK,
      k: targetK,
    });
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
        setUserTransform((prev) => {
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
      setUserTransform((prev) => {
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
    setUserTransform((prev) => {
      const cur = prev ?? fitTransform;
      return {
        ...cur,
        k: Math.min(4, Math.max(0.25, cur.k * Math.exp(delta))),
      };
    });
  };

  const zoomIn = () =>
    setUserTransform((prev) => {
      const cur = prev ?? fitTransform;
      return { ...cur, k: Math.min(4, cur.k * 1.2) };
    });
  const zoomOut = () =>
    setUserTransform((prev) => {
      const cur = prev ?? fitTransform;
      return { ...cur, k: Math.max(0.25, cur.k / 1.2) };
    });
  const resetView = () => setUserTransform(null);

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
    <div className="bg-white dark:bg-gray-900 rounded-lg border border-gray-200 dark:border-gray-800 w-full flex flex-col flex-1 min-h-0 relative transition-colors duration-150 overflow-hidden">
      {/* Belief Graph 2.0 Navigation & Filtering Toolbar */}
      <div className="px-3 py-2 border-b border-gray-200 dark:border-gray-800 bg-gray-50/70 dark:bg-gray-950/60 flex flex-wrap items-center justify-between gap-2 flex-shrink-0">
        <div className="flex items-center gap-2 flex-1 min-w-[200px]">
          <input
            type="search"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search entities, traits, or relationships..."
            aria-label="Search belief graph"
            className="w-48 sm:w-56 text-xs bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-700 rounded-md px-2.5 py-1.5 text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-blue-500"
          />

          <select
            aria-label="Filter graph by entity category"
            value={categoryFilter}
            onChange={(e) => setCategoryFilter(e.target.value as typeof categoryFilter)}
            className="text-xs bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-700 rounded-md px-2 py-1.5 text-gray-800 dark:text-gray-200"
          >
            <option value="all">All Types ({rawObjectEntities.length})</option>
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
              onClick={() => focusOnEntity(selectedEntity)}
              className="px-2.5 py-1 text-xs font-medium rounded border border-blue-300 dark:border-blue-800 bg-blue-50 dark:bg-blue-950 text-blue-700 dark:text-blue-300 hover:bg-blue-100 whitespace-nowrap"
            >
              Focus &ldquo;{selectedEntity.name}&rdquo;
            </button>
          )}

          <button
            type="button"
            onClick={() => setHighlightConnections((prev) => !prev)}
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
            onClick={() => setShowInferred((prev) => !prev)}
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
            onClick={() => setCollapseGuestGroup((prev) => !prev)}
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
            onClick={() => setShowExcluded((prev) => !prev)}
            aria-pressed={showExcluded}
            className={`px-2 py-1 text-xs font-medium rounded border transition-colors whitespace-nowrap ${
              showExcluded
                ? 'border-amber-500 bg-amber-50 dark:bg-amber-950 text-amber-800 dark:text-amber-300'
                : 'border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-600 dark:text-gray-400'
            }`}
          >
            Excluded
          </button>

          {/* Graph vs Table Toggle for Large Projects */}
          <div
            role="group"
            aria-label="Graph display mode"
            className="flex bg-gray-200/70 dark:bg-gray-800 p-0.5 rounded-md"
          >
            <button
              type="button"
              onClick={() => setDisplayMode('graph')}
              aria-pressed={displayMode === 'graph'}
              className={`px-2.5 py-1 text-xs font-semibold rounded transition-colors whitespace-nowrap ${
                displayMode === 'graph'
                  ? 'bg-white dark:bg-gray-900 text-gray-900 dark:text-gray-100 shadow-xs'
                  : 'text-gray-600 dark:text-gray-400'
              }`}
            >
              Graph
            </button>
            <button
              type="button"
              onClick={() => setDisplayMode('table')}
              aria-pressed={displayMode === 'table'}
              className={`px-2.5 py-1 text-xs font-semibold rounded transition-colors whitespace-nowrap ${
                displayMode === 'table'
                  ? 'bg-white dark:bg-gray-900 text-gray-900 dark:text-gray-100 shadow-xs'
                  : 'text-gray-600 dark:text-gray-400'
              }`}
            >
              Table
            </button>
          </div>
        </div>
      </div>

      {isLoading && (
        <div
          className="absolute inset-0 bg-white/80 dark:bg-gray-900/80 backdrop-blur-xs flex items-center justify-center z-50"
          role="status"
          aria-live="polite"
        >
          <div className="px-5 py-4 bg-white dark:bg-gray-800 rounded-lg shadow-md border border-gray-200 dark:border-gray-700 text-xs font-semibold text-gray-800 dark:text-gray-100">
            Analyzing story entities and relationships...
          </div>
        </div>
      )}

      {/* Alternative High-Density Table View for Large Projects */}
      {displayMode === 'table' ? (
        <div className="flex-1 overflow-y-auto p-4 min-h-0 space-y-6">
          <div>
            <h3 className="text-xs font-bold uppercase tracking-wider text-gray-500 dark:text-gray-400 mb-2">
              Entities ({visibleEntities.length})
            </h3>
            <table className="w-full text-left border-collapse text-xs">
              <thead>
                <tr className="border-b border-gray-200 dark:border-gray-800 text-gray-500 dark:text-gray-400">
                  <th className="py-2 px-2.5 font-semibold">Entity</th>
                  <th className="py-2 px-2.5 font-semibold">Category</th>
                  <th className="py-2 px-2.5 font-semibold">Origin</th>
                  <th className="py-2 px-2.5 font-semibold">Key Attributes</th>
                  <th className="py-2 px-2.5 font-semibold text-right">Connections</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100 dark:divide-gray-800">
                {visibleEntities.map((ent) => {
                  const isSelected = selectedEntity?.name === ent.name;
                  const connCount = relationships.filter(
                    (r) => r.source === ent.name || r.target === ent.name
                  ).length;
                  const attrSummary = ent.attributes
                    .filter((a) => a.name !== 'existence')
                    .map((a) => `${a.name}: ${getEffectiveAttributeValue(a)}`)
                    .join(' · ');

                  return (
                    <tr
                      key={ent.id ?? ent.name}
                      tabIndex={0}
                      role="button"
                      aria-label={`Inspect entity ${ent.name}${ent.excluded ? ' (Excluded)' : ''}`}
                      onClick={() => {
                        onSelectEntity(ent);
                        onSelectRelationship?.(null);
                      }}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' || e.key === ' ') {
                          e.preventDefault();
                          onSelectEntity(ent);
                          onSelectRelationship?.(null);
                        }
                      }}
                      className={`cursor-pointer transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-blue-500 ${
                        isSelected
                          ? 'bg-blue-50/70 dark:bg-blue-950/40'
                          : 'hover:bg-gray-50 dark:hover:bg-gray-800/50'
                      }`}
                    >
                      <td className="py-2.5 px-2.5 font-semibold text-gray-900 dark:text-gray-100">
                        {ent.name}
                        {ent.excluded ? ' (Excluded)' : ''}
                      </td>
                      <td className="py-2.5 px-2.5 capitalize text-gray-600 dark:text-gray-300">
                        {ent.category ?? 'entity'}
                      </td>
                      <td className="py-2.5 px-2.5 text-gray-500 dark:text-gray-400">
                        {ent.presence_in_prompt ? 'Explicit' : 'Inferred'}
                      </td>
                      <td className="py-2.5 px-2.5 text-gray-700 dark:text-gray-300 max-w-xs truncate">
                        {attrSummary || '—'}
                      </td>
                      <td className="py-2.5 px-2.5 text-right font-mono tabular-nums text-gray-600 dark:text-gray-400">
                        {connCount}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          <div>
            <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
              <h3 className="text-xs font-bold uppercase tracking-wider text-gray-500 dark:text-gray-400">
                Directed Relationships ({tableRelationships.length}{selectedEntityRelationshipsOnly && selectedEntity?.id ? ` of ${relationshipProjection.edges.length}` : ''})
              </h3>
              <button type="button" disabled={!selectedEntity?.id}
                aria-pressed={selectedEntityRelationshipsOnly}
                onClick={() => setSelectedEntityRelationshipsOnly(value => !value)}
                className="rounded border border-gray-300 px-2 py-1 text-[11px] text-gray-700 hover:bg-gray-100 disabled:cursor-not-allowed disabled:opacity-50 dark:border-gray-700 dark:text-gray-300 dark:hover:bg-gray-800">
                {selectedEntityRelationshipsOnly ? 'Show all relationships' : 'Filter to selected character'}
              </button>
            </div>
            <p className="mb-2 text-[11px] text-gray-500" id="relationship-checks-help">
              Checks reflect the current project snapshot and are read-only. They are also listed in the Checks tab.
            </p>
            <table className="w-full text-left border-collapse text-xs">
              <caption className="sr-only">Canonical ID directed relationships and current related consistency findings</caption>
              <thead>
                <tr className="border-b border-gray-200 dark:border-gray-800 text-gray-500 dark:text-gray-400">
                  <th className="py-2 px-2.5 font-semibold">Source</th>
                  <th className="py-2 px-2.5 font-semibold">Directed Label</th>
                  <th className="py-2 px-2.5 font-semibold">Target</th>
                  <th className="py-2 px-2.5 font-semibold text-right">Status</th>
                  <th className="py-2 px-2.5 font-semibold">Provenance</th>
                  <th className="py-2 px-2.5 font-semibold">Current checks</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100 dark:divide-gray-800">
                {tableRelationships.map(({ edge, source, target, relationship: rel }) => {
                  const endpointIds = new Set([edge.sourceId, edge.targetId]);
                  const rowIssues = consistencyIssues.filter(issue =>
                    issue.relationshipId === edge.id ||
                    issue.targets?.some(issueTarget => issueTarget.kind === 'relationship' && issueTarget.relationshipId === edge.id) ||
                    issue.affectedEntityIds.some(id => endpointIds.has(id))
                  );
                  const isSelected = selectedRelationship?.id === edge.id;
                  return (
                    <tr
                      key={edge.id}
                      tabIndex={0}
                      role="button"
                      aria-label={`Inspect directed relationship ${source.name} ${edge.label} ${target.name}`}
                      onClick={() => {
                        onSelectRelationship?.(rel);
                      }}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' || e.key === ' ') {
                          e.preventDefault();
                          onSelectRelationship?.(rel);
                        }
                      }}
                      className={`cursor-pointer transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-blue-500 ${
                        isSelected
                          ? 'bg-amber-50/70 dark:bg-amber-950/40'
                          : 'hover:bg-gray-50 dark:hover:bg-gray-800/50'
                      }`}
                    >
                      <td className="py-2 px-2.5 font-semibold text-gray-900 dark:text-gray-100">
                        {source.name}
                      </td>
                      <td className="py-2 px-2.5 text-blue-700 dark:text-blue-300 font-medium">
                        → {edge.label} →
                      </td>
                      <td className="py-2 px-2.5 font-semibold text-gray-900 dark:text-gray-100">
                        {target.name}
                      </td>
                      <td className="py-2 px-2.5 text-right capitalize text-gray-600 dark:text-gray-400">
                        {edge.status ?? 'unspecified'}
                      </td>
                      <td className="py-2 px-2.5 text-gray-600 dark:text-gray-400">
                        {edge.provenance ?? 'unspecified'}
                      </td>
                      <td className="py-2 px-2.5 text-gray-700 dark:text-gray-300">
                        {rowIssues.length ? (
                          <ul aria-label={`Current consistency findings related to ${rel.source} ${rel.label} ${rel.target}`} className="space-y-1">
                            {rowIssues.map(issue => (
                              <li key={issue.id} className="rounded border border-amber-300 bg-amber-50 p-1.5 dark:border-amber-800 dark:bg-amber-950/30">
                                <span className="font-semibold">{issue.severity === 'error' ? 'Error' : 'Warning'} · {issue.category}</span>
                                <p className="font-medium">{issue.title}</p>
                                <p>{issue.description}</p>
                              </li>
                            ))}
                          </ul>
                        ) : <span className="text-gray-500">None</span>}
                      </td>
                    </tr>
                  );
                })}
                {tableRelationships.length === 0 && (
                  <tr><td colSpan={6} className="py-3 px-2.5 text-center text-gray-500">No relationships with valid canonical IDs match this filter.</td></tr>
                )}
              </tbody>
            </table>
            {relationshipProjection.omissions.length > 0 && (
              <details className="mt-2 rounded border border-amber-300 p-2 text-xs dark:border-amber-800">
                <summary className="cursor-pointer font-semibold">{relationshipProjection.omissions.length} relationship(s) omitted from this table because canonical identity or label checks failed</summary>
                <ul className="mt-2 list-disc space-y-1 pl-5">
                  {relationshipProjection.omissions.map((omission, index) => (
                    <li key={`${omission.relationshipId ?? 'missing'}-${index}`}>
                      <span>{omission.label || 'Empty label'}</span>
                      <span className="text-gray-500"> — {omission.reasons.join(', ')}</span>
                    </li>
                  ))}
                </ul>
              </details>
            )}
          </div>
        </div>
      ) : (
        /* Interactive SVG Force-Directed Belief Graph Canvas */
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
                            setCollapseGuestGroup(false);
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
                              setCollapseGuestGroup(false);
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
      )}
    </div>
  );
};

export default BeliefGraph;
