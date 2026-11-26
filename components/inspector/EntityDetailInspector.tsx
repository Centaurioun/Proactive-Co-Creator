/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState } from 'react';
import AttributeEditor from '../AttributeEditor';
import type { Entity, Relationship } from '../../shared/types';

export function canAddCustomAttribute(name: string, value: string): boolean {
  return Boolean(name.trim() && value.trim());
}

interface EntityDetailInspectorProps {
  selectedEntity: Entity;
  objectEntities: Entity[];
  entityRelationships: Relationship[];
  isLoading: boolean;
  onSelectEntity: (entity: Entity | null) => void;
  onSelectRelationship: (relationship: Relationship | null) => void;
  onAttributeChange: (entityName: string, attributeName: string, newValue: string) => void;
  onRenameEntity: (entityIdOrName: string, newName: string) => void;
  onUpsertRelationship: (source: string, target: string, label: string) => void;
  onRemoveRelationship: (relIdOrSource: string, target?: string) => void;
}

const EntityDetailInspector: React.FC<EntityDetailInspectorProps> = ({
  selectedEntity,
  objectEntities,
  entityRelationships,
  isLoading,
  onSelectEntity,
  onSelectRelationship,
  onAttributeChange,
  onRenameEntity,
  onUpsertRelationship,
  onRemoveRelationship,
}) => {
  const [renameDraft, setRenameDraft] = useState('');
  const [newAttrName, setNewAttrName] = useState('');
  const [newAttrValue, setNewAttrValue] = useState('');
  const [newRelTarget, setNewRelTarget] = useState('');
  const [newRelLabel, setNewRelLabel] = useState('');

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between gap-2 border-b border-gray-200 dark:border-gray-800 pb-3">
        <div>
          <div className="text-[11px] text-gray-500 dark:text-gray-400 mb-0.5">
            <span className="capitalize">{selectedEntity.category ?? 'entity'}</span>
            <span aria-hidden="true"> · </span>
            <span>
              {selectedEntity.presence_in_prompt ? 'Explicit in prompt' : 'AI Inferred'}
            </span>
            <span aria-hidden="true"> · </span>
            <span className="capitalize">{selectedEntity.status ?? 'confirmed'}</span>
          </div>
          <h3 className="font-display text-base font-bold text-gray-900 dark:text-gray-100">
            {selectedEntity.name}
          </h3>
          {selectedEntity.description && (
            <p className="text-xs text-gray-600 dark:text-gray-400 mt-1">
              {selectedEntity.description}
            </p>
          )}
        </div>
        <button
          type="button"
          onClick={() => onSelectEntity(null)}
          className="text-xs text-gray-500 hover:text-gray-900 dark:hover:text-white px-2 py-1 rounded border border-gray-200 dark:border-gray-700 whitespace-nowrap"
        >
          All Entities
        </button>
      </div>

      {/* Rename Entity (preserves stable ID and relationships) */}
      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (renameDraft.trim()) {
            onRenameEntity(selectedEntity.id ?? selectedEntity.name, renameDraft.trim());
            setRenameDraft('');
          }
        }}
        className="flex gap-1.5 items-center"
      >
        <input
          type="text"
          value={renameDraft}
          onChange={(e) => setRenameDraft(e.target.value)}
          placeholder={`Rename "${selectedEntity.name}"...`}
          aria-label={`Rename ${selectedEntity.name}`}
          className="flex-1 min-w-0 text-xs bg-gray-50 dark:bg-gray-800 border border-gray-300 dark:border-gray-700 rounded px-2.5 py-1.5 text-gray-900 dark:text-gray-100"
        />
        <button
          type="submit"
          disabled={!renameDraft.trim()}
          className="px-2.5 py-1.5 text-xs font-semibold bg-gray-900 dark:bg-gray-700 text-white rounded disabled:opacity-40 whitespace-nowrap"
        >
          Rename
        </button>
      </form>

      {/* Attributes List */}
      <div>
        <h4 className="text-xs font-semibold text-gray-800 dark:text-gray-200 mb-2">
          Attributes &amp; Existence
        </h4>
        <div className="divide-y divide-gray-100 dark:divide-gray-800 border border-gray-200 dark:border-gray-800 rounded-md px-2">
          {selectedEntity.attributes.map((attr) => (
            <AttributeEditor
              key={attr.id ?? attr.name}
              attribute={attr}
              entity={selectedEntity}
              onChange={onAttributeChange}
              isLoading={isLoading}
              pendingValue={attr.confirmedValue}
            />
          ))}
        </div>

        {/* Add Custom Attribute */}
        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (canAddCustomAttribute(newAttrName, newAttrValue)) {
              onAttributeChange(
                selectedEntity.name,
                newAttrName.trim(),
                newAttrValue.trim()
              );
              setNewAttrName('');
              setNewAttrValue('');
            }
          }}
          className="mt-2.5 flex gap-1.5"
        >
          <input
            type="text"
            value={newAttrName}
            onChange={(e) => setNewAttrName(e.target.value)}
            placeholder="New attribute (e.g. outfit)"
            aria-label="New attribute name"
            className="w-1/2 text-xs bg-gray-50 dark:bg-gray-800 border border-gray-300 dark:border-gray-700 rounded px-2 py-1.5 text-gray-900 dark:text-gray-100"
          />
          <input
            type="text"
            value={newAttrValue}
            onChange={(e) => setNewAttrValue(e.target.value)}
            placeholder="Value (e.g. velvet vest)"
            aria-label="New attribute value"
            className="w-1/2 text-xs bg-gray-50 dark:bg-gray-800 border border-gray-300 dark:border-gray-700 rounded px-2 py-1.5 text-gray-900 dark:text-gray-100"
          />
          <button
            type="submit"
            disabled={!canAddCustomAttribute(newAttrName, newAttrValue)}
            className="px-2.5 py-1.5 text-xs font-semibold bg-blue-600 text-white rounded disabled:opacity-40 whitespace-nowrap"
          >
            Add
          </button>
        </form>
      </div>

      {/* Connected Relationships */}
      <div>
        <h4 className="text-xs font-semibold text-gray-800 dark:text-gray-200 mb-2">
          Connected Relationships ({entityRelationships.length})
        </h4>
        {entityRelationships.length > 0 ? (
          <div className="space-y-1.5">
            {entityRelationships.map((rel) => (
              <div
                key={rel.id ?? `${rel.source}-${rel.target}-${rel.label}`}
                className="flex items-center justify-between gap-2 text-xs p-2 rounded border border-gray-200 dark:border-gray-800 bg-gray-50/50 dark:bg-gray-800/40"
              >
                <button
                  type="button"
                  onClick={() => {
                    onSelectEntity(null);
                    onSelectRelationship(rel);
                  }}
                  className="truncate text-left flex-1 hover:text-blue-600 dark:hover:text-blue-400"
                  title="Inspect & edit this directed relationship"
                >
                  <span className="font-semibold text-gray-900 dark:text-gray-100">
                    {rel.source}
                  </span>{' '}
                  <span className="text-blue-600 dark:text-blue-400 font-medium">
                    {rel.label}
                  </span>{' '}
                  <span className="font-semibold text-gray-900 dark:text-gray-100">
                    {rel.target}
                  </span>
                  {rel.status === 'pending' && (
                    <span className="ml-1.5 text-[10px] px-1.5 py-0.5 rounded bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300">
                      pending
                    </span>
                  )}
                </button>
                <div className="flex items-center gap-1 shrink-0">
                  <button
                    type="button"
                    onClick={() => {
                      onSelectEntity(null);
                      onSelectRelationship(rel);
                    }}
                    className="text-blue-600 dark:text-blue-400 hover:underline text-xs px-1"
                  >
                    Edit
                  </button>
                  <button
                    type="button"
                    onClick={() =>
                      rel.id
                        ? onRemoveRelationship(rel.id)
                        : onRemoveRelationship(rel.source, rel.target)
                    }
                    className="text-gray-400 hover:text-red-600 text-xs px-1"
                    aria-label={`Remove relationship ${rel.source} ${rel.label} ${rel.target}`}
                  >
                    Remove
                  </button>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <p className="text-xs text-gray-500">No relationships linked yet.</p>
        )}

        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (newRelTarget && newRelLabel.trim()) {
              onUpsertRelationship(selectedEntity.name, newRelTarget, newRelLabel.trim());
              setNewRelLabel('');
            }
          }}
          className="mt-2.5 flex gap-1.5"
        >
          <select
            aria-label="Target entity for relationship"
            value={newRelTarget}
            onChange={(e) => setNewRelTarget(e.target.value)}
            className="w-2/5 text-xs bg-gray-50 dark:bg-gray-800 border border-gray-300 dark:border-gray-700 rounded px-2 py-1.5 text-gray-900 dark:text-gray-100"
          >
            <option value="">Target entity...</option>
            {objectEntities
              .filter((e) => (e.id && selectedEntity.id ? e.id !== selectedEntity.id : e.name !== selectedEntity.name))
              .map((e) => (
                <option key={e.id ?? e.name} value={e.name}>
                  {e.name}
                </option>
              ))}
          </select>
          <input
            type="text"
            value={newRelLabel}
            onChange={(e) => setNewRelLabel(e.target.value)}
            placeholder="Relationship (e.g. seated beside)"
            aria-label="Relationship label"
            className="flex-1 min-w-0 text-xs bg-gray-50 dark:bg-gray-800 border border-gray-300 dark:border-gray-700 rounded px-2 py-1.5 text-gray-900 dark:text-gray-100"
          />
          <button
            type="submit"
            disabled={!newRelTarget || !newRelLabel.trim()}
            className="px-2.5 py-1.5 text-xs font-semibold bg-blue-600 text-white rounded disabled:opacity-40 whitespace-nowrap"
          >
            Link
          </button>
        </form>
      </div>
    </div>
  );
};

export default EntityDetailInspector;
