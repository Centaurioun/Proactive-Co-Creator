/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useMemo, useState } from 'react';
import {
  normalizeAndDeduplicateRelationships,
  splitSceneAndObjectEntities,
} from '../lib/beliefGraphUtils';
import type { ViewTransform } from '../lib/graphLayout';
import type {
  BeliefState,
  ConsistencyIssue,
  Entity,
  EntityCategory,
  Relationship,
} from '../shared/types';
import type { RelationshipProjection } from '../lib/narrative/projections/relationshipProjection';
import {
  buildCharacterEgoNetwork,
  buildVerifiedKinshipProjection,
} from '../lib/narrative/projections/kinshipProjection';
import {
  buildTableRelationshipRows,
  countIssuesByEntityId,
  filterVisibleGraphEntities,
} from './graph/graphProjection';
import GraphToolbar, { type GraphDisplayMode } from './graph/GraphToolbar';
import RelationshipTableView from './graph/RelationshipTableView';
import EgoMapView from './graph/EgoMapView';
import FamilyKinshipView from './graph/FamilyKinshipView';
import GraphCanvas from './graph/GraphCanvas';

export interface BeliefGraphProps {
  data: BeliefState | null;
  isLoading: boolean;
  error?: string | null;
  selectedEntity: Entity | null;
  selectedRelationship?: Relationship | null;
  onSelectEntity: (entity: Entity | null) => void;
  onSelectRelationship?: (rel: Relationship | null) => void;
  onRelationshipChange: (
    source: string,
    target: string,
    newLabel: string,
    relationshipId?: string
  ) => void;
  onAttributeChange?: (entityName: string, attributeName: string, newValue: string) => void;
  onOpenChecks?: () => void;
  currentPrompt: string;
  consistencyIssues?: ConsistencyIssue[];
  relationshipProjection: RelationshipProjection;
}

export function resolveEgoFocusId(
  egoFocusId: string,
  rawObjectEntities: Entity[],
  selectedEntity: Entity | null
): string {
  const validEntities = rawObjectEntities.filter((e) => !e.excluded && Boolean(e.id));
  if (egoFocusId && validEntities.some((e) => e.id === egoFocusId)) {
    return egoFocusId;
  }
  if (selectedEntity?.id && validEntities.some((e) => e.id === selectedEntity.id)) {
    return selectedEntity.id;
  }
  return validEntities[0]?.id ?? '';
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
  onOpenChecks,
  consistencyIssues = [],
  relationshipProjection,
}) => {
  // Single authoritative navigation, filter, and transform state across graph/table/ego/kinship views
  const [searchQuery, setSearchQuery] = useState('');
  const [categoryFilter, setCategoryFilter] = useState<'all' | EntityCategory>('all');
  const [showInferred, setShowInferred] = useState(true);
  const [showExcluded, setShowExcluded] = useState(false);
  const [highlightConnections, setHighlightConnections] = useState(true);
  const [collapseGuestGroup, setCollapseGuestGroup] = useState(false);
  const [displayMode, setDisplayMode] = useState<GraphDisplayMode>('graph');
  const [egoFocusId, setEgoFocusId] = useState<string>('');
  const [egoHops, setEgoHops] = useState<1 | 2>(1);
  const [selectedEntityRelationshipsOnly, setSelectedEntityRelationshipsOnly] = useState(false);
  const [userTransform, setUserTransform] = useState<ViewTransform | null>(null);
  const [focusRequest, setFocusRequest] = useState<{ entityName: string; seq: number } | null>(null);

  const { objectEntities: rawObjectEntities } = useMemo(
    () => splitSceneAndObjectEntities(data?.entities ?? []),
    [data]
  );

  const visibleEntities = useMemo(
    () =>
      filterVisibleGraphEntities(rawObjectEntities, data?.relationships, {
        showExcluded,
        showInferred,
        categoryFilter,
        collapseGuestGroup,
        searchQuery,
      }),
    [
      rawObjectEntities,
      data?.relationships,
      showExcluded,
      showInferred,
      categoryFilter,
      collapseGuestGroup,
      searchQuery,
    ]
  );

  const relationships = useMemo(() => {
    const normalized = normalizeAndDeduplicateRelationships(data?.relationships, visibleEntities);
    if (!showInferred) {
      return normalized.filter((r) => r.status === 'confirmed' || r.presence_in_prompt);
    }
    return normalized;
  }, [data?.relationships, visibleEntities, showInferred]);

  const selectedRelationshipEntityId = selectedEntity?.id;
  const tableRelationships = useMemo(
    () =>
      buildTableRelationshipRows(
        relationshipProjection,
        data?.relationships,
        selectedRelationshipEntityId,
        selectedEntityRelationshipsOnly
      ),
    [
      relationshipProjection,
      data?.relationships,
      selectedRelationshipEntityId,
      selectedEntityRelationshipsOnly,
    ]
  );

  const kinshipProjection = useMemo(
    () => buildVerifiedKinshipProjection(rawObjectEntities, data?.relationships ?? []),
    [rawObjectEntities, data?.relationships]
  );

  const resolvedEgoFocusId = resolveEgoFocusId(egoFocusId, rawObjectEntities, selectedEntity);

  const egoNetwork = useMemo(
    () =>
      resolvedEgoFocusId
        ? buildCharacterEgoNetwork(
            rawObjectEntities,
            data?.relationships ?? [],
            resolvedEgoFocusId,
            egoHops
          )
        : { nodeIds: new Set<string>(), edges: [] },
    [rawObjectEntities, data?.relationships, resolvedEgoFocusId, egoHops]
  );

  const issueCountByEntityId = useMemo(
    () => countIssuesByEntityId(consistencyIssues),
    [consistencyIssues]
  );

  const handleFocusSelectedEntity = (entity: Entity) => {
    setFocusRequest((prev) => ({ entityName: entity.name, seq: (prev?.seq ?? 0) + 1 }));
  };

  return (
    <div className="bg-white dark:bg-gray-900 rounded-lg border border-gray-200 dark:border-gray-800 w-full flex flex-col flex-1 min-h-0 relative transition-colors duration-150 overflow-hidden">
      <GraphToolbar
        totalEntityCount={rawObjectEntities.length}
        searchQuery={searchQuery}
        categoryFilter={categoryFilter}
        selectedEntity={selectedEntity}
        highlightConnections={highlightConnections}
        showInferred={showInferred}
        collapseGuestGroup={collapseGuestGroup}
        showExcluded={showExcluded}
        displayMode={displayMode}
        onChangeSearchQuery={setSearchQuery}
        onChangeCategoryFilter={setCategoryFilter}
        onFocusSelectedEntity={handleFocusSelectedEntity}
        onToggleHighlightConnections={() => setHighlightConnections((prev) => !prev)}
        onToggleShowInferred={() => setShowInferred((prev) => !prev)}
        onToggleCollapseGuestGroup={() => setCollapseGuestGroup((prev) => !prev)}
        onToggleShowExcluded={() => setShowExcluded((prev) => !prev)}
        onChangeDisplayMode={setDisplayMode}
      />

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

      {displayMode === 'table' ? (
        <RelationshipTableView
          visibleEntities={visibleEntities}
          relationships={relationships}
          tableRelationships={tableRelationships}
          relationshipProjection={relationshipProjection}
          selectedEntity={selectedEntity}
          selectedRelationship={selectedRelationship}
          selectedEntityRelationshipsOnly={selectedEntityRelationshipsOnly}
          issueCountByEntityId={issueCountByEntityId}
          consistencyIssues={consistencyIssues}
          onSelectEntity={onSelectEntity}
          onSelectRelationship={onSelectRelationship}
          onToggleSelectedEntityRelationshipsOnly={() =>
            setSelectedEntityRelationshipsOnly((value) => !value)
          }
          onOpenChecks={onOpenChecks}
        />
      ) : displayMode === 'ego' ? (
        <EgoMapView
          rawObjectEntities={rawObjectEntities}
          resolvedEgoFocusId={resolvedEgoFocusId}
          egoHops={egoHops}
          egoNetwork={egoNetwork}
          issueCountByEntityId={issueCountByEntityId}
          onChangeEgoFocusId={setEgoFocusId}
          onChangeEgoHops={setEgoHops}
          onSelectEntity={onSelectEntity}
          onSelectRelationship={onSelectRelationship}
        />
      ) : displayMode === 'kinship' ? (
        <FamilyKinshipView
          kinshipProjection={kinshipProjection}
          onSelectEntity={onSelectEntity}
          onSelectRelationship={onSelectRelationship}
        />
      ) : (
        <GraphCanvas
          data={data}
          isLoading={isLoading}
          error={error}
          visibleEntities={visibleEntities}
          relationships={relationships}
          selectedEntity={selectedEntity}
          selectedRelationship={selectedRelationship}
          highlightConnections={highlightConnections}
          userTransform={userTransform}
          focusRequest={focusRequest}
          onChangeUserTransform={setUserTransform}
          onSelectEntity={onSelectEntity}
          onSelectRelationship={onSelectRelationship}
          onExpandGuestGroup={() => setCollapseGuestGroup(false)}
          onRelationshipChange={onRelationshipChange}
        />
      )}
    </div>
  );
};

export default BeliefGraph;
