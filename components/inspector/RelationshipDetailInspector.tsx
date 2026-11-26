/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState } from 'react';
import type { Relationship } from '../../shared/types';

interface RelationshipDetailInspectorProps {
  selectedRelationship: Relationship;
  onSelectRelationship: (relationship: Relationship | null) => void;
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

const RelationshipDetailInspector: React.FC<RelationshipDetailInspectorProps> = ({
  selectedRelationship,
  onSelectRelationship,
  onUpdateRelationshipById,
  onRemoveRelationship,
}) => {
  const [labelDraft, setLabelDraft] = useState(selectedRelationship.label);
  const [prevRelLabel, setPrevRelLabel] = useState(selectedRelationship.label);

  if (selectedRelationship.label !== prevRelLabel) {
    setPrevRelLabel(selectedRelationship.label);
    setLabelDraft(selectedRelationship.label);
  }

  return (
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
            if (!labelDraft.trim()) return;
            onUpdateRelationshipById(selectedRelationship.id!, {
              label: labelDraft.trim(),
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
              value={labelDraft}
              onChange={(e) => setLabelDraft(e.target.value)}
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
                        setLabelDraft(alt.name);
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
  );
};

export default RelationshipDetailInspector;
