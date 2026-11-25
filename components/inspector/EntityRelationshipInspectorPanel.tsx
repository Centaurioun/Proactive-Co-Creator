/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState } from 'react';
import AttributeEditor from '../AttributeEditor';
import type { Entity, EntityCategory, Relationship } from '../../shared/types';

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
  const [renameDraft, setRenameDraft] = useState<string>('');
  const [newAttrName, setNewAttrName] = useState('');
  const [newAttrValue, setNewAttrValue] = useState('');
  const [newRelTarget, setNewRelTarget] = useState('');
  const [newRelLabel, setNewRelLabel] = useState('');
  const [relLabelDrafts, setRelLabelDrafts] = useState<Record<string, string>>({});
  const [newEntityName, setNewEntityName] = useState('');
  const [newEntityCategory, setNewEntityCategory] = useState<EntityCategory>('character');
  const [newEntityDesc, setNewEntityDesc] = useState('');

  const activeRelKey = selectedRelationship?.id ?? 'default';
  const activeRelLabel = relLabelDrafts[activeRelKey] ?? selectedRelationship?.label ?? '';

  const entityRelationships = selectedEntity
    ? relationships.filter(
        (r) =>
          r.sourceId === selectedEntity.id ||
          r.targetId === selectedEntity.id ||
          r.source.toLowerCase() === selectedEntity.name.toLowerCase() ||
          r.target.toLowerCase() === selectedEntity.name.toLowerCase()
      )
    : [];

  return (
    <div className="flex-1 overflow-y-auto p-4 space-y-4 min-h-0">
      {selectedEntity ? (
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
                if (newAttrName.trim() && newAttrValue.trim()) {
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
                disabled={!newAttrName.trim() && !newAttrValue.trim()}
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
                  .filter((e) => e.name !== selectedEntity.name)
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
      ) : selectedRelationship ? (
        <div className="space-y-3 p-3 rounded-lg border border-blue-200 dark:border-blue-800/60 bg-blue-50/30 dark:bg-blue-950/20">
          <div className="flex items-start justify-between gap-2">
            <div>
              <span className="text-[10px] font-bold uppercase tracking-wider text-blue-600 dark:text-blue-400">
                Directed Relationship Inspector
              </span>
              <h3 className="font-display text-sm font-bold text-gray-900 dark:text-gray-100 mt-0.5">
                {selectedRelationship.source} &rarr; {selectedRelationship.target}
              </h3>
              <div className="flex flex-wrap items-center gap-1.5 mt-1">
                <span
                  className={`text-[10px] px-1.5 py-0.5 rounded font-semibold uppercase ${
                    selectedRelationship.status === 'confirmed'
                      ? 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950/60 dark:text-emerald-300'
                      : selectedRelationship.status === 'rejected'
                      ? 'bg-red-100 text-red-800 dark:bg-red-950/60 dark:text-red-300'
                      : 'bg-amber-100 text-amber-800 dark:bg-amber-950/60 dark:text-amber-300'
                  }`}
                >
                  {selectedRelationship.status ?? 'confirmed'}
                </span>
                {selectedRelationship.provenance && (
                  <span className="text-[11px] text-gray-500 dark:text-gray-400">
                    · {selectedRelationship.provenance}
                  </span>
                )}
              </div>
            </div>
            <button
              type="button"
              onClick={() => onSelectRelationship(null)}
              className="text-xs text-blue-600 dark:text-blue-400 hover:underline font-medium shrink-0"
            >
              All Entities
            </button>
          </div>

          {/* Direction & Status Controls */}
          <div className="flex flex-wrap items-center gap-1.5 pt-2 border-t border-blue-200/60 dark:border-blue-800/50">
            {selectedRelationship.id && (
              <>
                <button
                  type="button"
                  onClick={() =>
                    onUpdateRelationshipById(selectedRelationship.id!, {
                      reverseDirection: true,
                    })
                  }
                  className="text-xs font-semibold px-2.5 py-1 rounded bg-white dark:bg-gray-800 text-blue-700 dark:text-blue-300 border border-blue-200 dark:border-blue-700 hover:bg-blue-50"
                  title="Reverse edge direction (Source ⇄ Target)"
                >
                  ⇄ Reverse Direction
                </button>
                <button
                  type="button"
                  onClick={() =>
                    onUpdateRelationshipById(selectedRelationship.id!, {
                      status: 'confirmed',
                    })
                  }
                  className={`text-xs font-semibold px-2.5 py-1 rounded border ${
                    selectedRelationship.status === 'confirmed'
                      ? 'bg-emerald-600 text-white border-emerald-600'
                      : 'bg-white dark:bg-gray-800 text-emerald-700 dark:text-emerald-300 border-emerald-300 dark:border-emerald-700'
                  }`}
                >
                  Confirm
                </button>
                <button
                  type="button"
                  onClick={() => {
                    onUpdateRelationshipById(selectedRelationship.id!, {
                      status: 'rejected',
                    });
                    onSelectRelationship(null);
                  }}
                  className="text-xs font-semibold px-2.5 py-1 rounded bg-white dark:bg-gray-800 text-amber-700 dark:text-amber-300 border border-amber-300 dark:border-amber-700 hover:bg-amber-50"
                >
                  Reject
                </button>
              </>
            )}
            <button
              type="button"
              onClick={() => {
                if (selectedRelationship.id) {
                  onRemoveRelationship(selectedRelationship.id);
                } else {
                  onRemoveRelationship(
                    selectedRelationship.source,
                    selectedRelationship.target
                  );
                }
                onSelectRelationship(null);
              }}
              className="text-xs font-semibold px-2.5 py-1 rounded bg-red-50 dark:bg-red-950/40 text-red-700 dark:text-red-300 border border-red-200 dark:border-red-800/60 hover:bg-red-100 ml-auto"
            >
              Delete Edge
            </button>
          </div>

          {/* Edit Relationship Label */}
          {selectedRelationship.id && (
            <form
              onSubmit={(e) => {
                e.preventDefault();
                if (!activeRelLabel.trim()) return;
                onUpdateRelationshipById(selectedRelationship.id!, {
                  label: activeRelLabel.trim(),
                  status: 'confirmed',
                });
              }}
              className="pt-2 border-t border-blue-200/60 dark:border-blue-800/50 space-y-2"
            >
              <label
                htmlFor="inspector-rel-label"
                className="block text-xs font-semibold text-gray-700 dark:text-gray-300"
              >
                Relationship Predicate / Label
              </label>
              <div className="flex items-center gap-1.5">
                <input
                  id="inspector-rel-label"
                  type="text"
                  value={activeRelLabel}
                  onChange={(e) =>
                    setRelLabelDrafts((prev) => ({
                      ...prev,
                      [activeRelKey]: e.target.value,
                    }))
                  }
                  placeholder="Relationship label..."
                  aria-label="Edit relationship label"
                  className="flex-1 text-xs rounded border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-900 px-2.5 py-1.5 text-gray-800 dark:text-gray-100"
                />
                <button
                  type="submit"
                  className="text-xs font-semibold px-3 py-1.5 rounded bg-blue-600 hover:bg-blue-700 text-white"
                >
                  Save Label
                </button>
              </div>

              {selectedRelationship.alternatives &&
                selectedRelationship.alternatives.length > 0 && (
                  <div className="pt-1">
                    <span className="block text-[11px] text-gray-500 mb-1">
                      Suggested Alternatives (click to apply):
                    </span>
                    <div className="flex flex-wrap gap-1">
                      {selectedRelationship.alternatives.map((alt) => (
                        <button
                          key={alt.name}
                          type="button"
                          onClick={() => {
                            setRelLabelDrafts((prev) => ({
                              ...prev,
                              [activeRelKey]: alt.name,
                            }));
                            onUpdateRelationshipById(selectedRelationship.id!, {
                              label: alt.name,
                              status: 'confirmed',
                            });
                          }}
                          className="text-xs px-2 py-0.5 rounded bg-white dark:bg-gray-800 hover:bg-blue-50 dark:hover:bg-blue-950/50 text-gray-700 dark:text-gray-300 border border-gray-200 dark:border-gray-700 transition-colors"
                        >
                          {alt.name}
                        </button>
                      ))}
                    </div>
                  </div>
                )}
            </form>
          )}
        </div>
      ) : (
        /* Unselected overview: Quick Entity Directory & Add Entity */
        <div className="space-y-4">
          <div>
            <h3 className="font-display text-sm font-bold text-gray-900 dark:text-gray-100 mb-1">
              Story Elements Directory ({objectEntities.length})
            </h3>
            <p className="text-xs text-gray-500 dark:text-gray-400 mb-3">
              Select any node on the Belief Graph or click an entity below to inspect and edit its attributes, provenance, and relationships.
            </p>

            <div className="divide-y divide-gray-200 dark:divide-gray-800 border border-gray-200 dark:border-gray-800 rounded-md">
              {objectEntities.map((ent) => {
                const confirmedCount = ent.attributes.filter(
                  (a) => a.status === 'confirmed' && a.name !== 'existence'
                ).length;
                return (
                  <button
                    key={ent.id ?? ent.name}
                    type="button"
                    onClick={() => onSelectEntity(ent)}
                    className="w-full text-left px-3 py-2.5 hover:bg-gray-50 dark:hover:bg-gray-800 flex items-center justify-between gap-2 transition-colors"
                  >
                    <div className="min-w-0">
                      <div className="text-xs font-semibold text-gray-900 dark:text-gray-100 truncate">
                        {ent.name}{' '}
                        {ent.excluded && (
                          <span className="text-red-600 dark:text-red-400 font-normal">
                            (Excluded)
                          </span>
                        )}
                      </div>
                      <div className="text-[11px] text-gray-500 dark:text-gray-400">
                        <span className="capitalize">{ent.category ?? 'entity'}</span>
                        <span aria-hidden="true"> · </span>
                        <span className="tabular-nums">{confirmedCount} confirmed traits</span>
                      </div>
                    </div>
                    <span className="text-xs text-blue-600 dark:text-blue-400 whitespace-nowrap">
                      Inspect &rarr;
                    </span>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Add New Entity Form */}
          <form
            onSubmit={(e) => {
              e.preventDefault();
              if (newEntityName.trim()) {
                onAddEntity(
                  newEntityName.trim(),
                  newEntityCategory,
                  newEntityDesc.trim()
                );
                setNewEntityName('');
                setNewEntityDesc('');
              }
            }}
            className="p-3 rounded-md border border-gray-200 dark:border-gray-800 bg-gray-50/50 dark:bg-gray-950/40 space-y-2.5"
          >
            <h4 className="text-xs font-semibold text-gray-900 dark:text-gray-100">
              Add New Entity to Graph
            </h4>
            <div className="flex gap-2">
              <input
                type="text"
                value={newEntityName}
                onChange={(e) => setNewEntityName(e.target.value)}
                placeholder="Entity name (e.g. Owl)"
                aria-label="New entity name"
                className="flex-1 min-w-0 text-xs bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-700 rounded px-2.5 py-1.5 text-gray-900 dark:text-gray-100"
              />
              <select
                aria-label="New entity category"
                value={newEntityCategory}
                onChange={(e) => setNewEntityCategory(e.target.value as EntityCategory)}
                className="text-xs bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-700 rounded px-2 py-1.5 text-gray-800 dark:text-gray-200"
              >
                <option value="character">Character</option>
                <option value="location">Location</option>
                <option value="object">Object</option>
                <option value="event">Event</option>
                <option value="group">Group</option>
              </select>
            </div>
            <input
              type="text"
              value={newEntityDesc}
              onChange={(e) => setNewEntityDesc(e.target.value)}
              placeholder="Short description..."
              aria-label="New entity description"
              className="w-full text-xs bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-700 rounded px-2.5 py-1.5 text-gray-900 dark:text-gray-100"
            />
            <button
              type="submit"
              disabled={!newEntityName.trim()}
              className="w-full py-1.5 text-xs font-semibold bg-blue-600 hover:bg-blue-700 disabled:opacity-40 text-white rounded transition-colors"
            >
              Add to Story Graph
            </button>
          </form>
        </div>
      )}
    </div>
  );
};

export default EntityRelationshipInspectorPanel;
