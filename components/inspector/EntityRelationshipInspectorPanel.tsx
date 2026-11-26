/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import type { Entity, EntityCategory, Relationship } from '../../shared/types';
import EntityDetailInspector, { canAddCustomAttribute } from './EntityDetailInspector';
import EntityDirectoryView from './EntityDirectoryView';
import RelationshipDetailInspector from './RelationshipDetailInspector';

export { canAddCustomAttribute };

export interface EntityRelationshipInspectorPanelProps {
  objectEntities: Entity[];
  relationships: Relationship[];
  selectedEntity: Entity | null;
  selectedRelationship: Relationship | null;
  isLoading: boolean;
  onSelectEntity: (entity: Entity | null) => void;
  onSelectRelationship: (relationship: Relationship | null) => void;
  onAttributeChange: (entityName: string, attributeName: string, newValue: string) => void;
  onRenameEntity: (entityIdOrName: string, newName: string) => void;
  onAddEntity: (name: string, category: EntityCategory, description: string) => void;
  onUpsertRelationship: (source: string, target: string, label: string) => void;
  onUpdateRelationshipById: (
    relationshipId: string,
    updates: {
      label?: string;
      status?: 'confirmed' | 'rejected' | 'pending';
      reverseDirection?: boolean;
    }
  ) => void;
  onRemoveRelationship: (relIdOrSource: string, target?: string) => void;
}

const EntityRelationshipInspectorPanel: React.FC<EntityRelationshipInspectorPanelProps> = ({
  objectEntities,
  relationships,
  selectedEntity,
  selectedRelationship,
  isLoading,
  onSelectEntity,
  onSelectRelationship,
  onAttributeChange,
  onRenameEntity,
  onAddEntity,
  onUpsertRelationship,
  onUpdateRelationshipById,
  onRemoveRelationship,
}) => {
  const entityRelationships = selectedEntity
    ? relationships.filter(
        (r) =>
          (selectedEntity.id && (r.sourceId === selectedEntity.id || r.targetId === selectedEntity.id)) ||
          r.source.toLowerCase() === selectedEntity.name.toLowerCase() ||
          r.target.toLowerCase() === selectedEntity.name.toLowerCase()
      )
    : [];

  return (
    <div className="flex-1 overflow-y-auto p-4 space-y-4 min-h-0">
      {selectedEntity ? (
        <EntityDetailInspector
          key={selectedEntity.id ?? selectedEntity.name}
          selectedEntity={selectedEntity}
          objectEntities={objectEntities}
          entityRelationships={entityRelationships}
          isLoading={isLoading}
          onSelectEntity={onSelectEntity}
          onSelectRelationship={onSelectRelationship}
          onAttributeChange={onAttributeChange}
          onRenameEntity={onRenameEntity}
          onUpsertRelationship={onUpsertRelationship}
          onRemoveRelationship={onRemoveRelationship}
        />
      ) : selectedRelationship ? (
        <RelationshipDetailInspector
          key={selectedRelationship.id ?? `${selectedRelationship.source}->${selectedRelationship.target}`}
          selectedRelationship={selectedRelationship}
          onSelectRelationship={onSelectRelationship}
          onUpdateRelationshipById={onUpdateRelationshipById}
          onRemoveRelationship={onRemoveRelationship}
        />
      ) : (
        <EntityDirectoryView
          objectEntities={objectEntities}
          onSelectEntity={onSelectEntity}
          onAddEntity={onAddEntity}
        />
      )}
    </div>
  );
};

export default EntityRelationshipInspectorPanel;
