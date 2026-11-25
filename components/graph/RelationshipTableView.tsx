/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import { getEffectiveAttributeValue } from '../../lib/beliefGraphUtils';
import type { RelationshipProjection } from '../../lib/narrative/projections/relationshipProjection';
import type { ConsistencyIssue, Entity, Relationship } from '../../shared/types';
import type { TableRelationshipRow } from './graphProjection';

export interface RelationshipTableViewProps {
  visibleEntities: Entity[];
  relationships: Relationship[];
  tableRelationships: TableRelationshipRow[];
  relationshipProjection: RelationshipProjection;
  selectedEntity: Entity | null;
  selectedRelationship: Relationship | null;
  selectedEntityRelationshipsOnly: boolean;
  issueCountByEntityId: Map<string, number>;
  consistencyIssues: ConsistencyIssue[];
  onSelectEntity: (entity: Entity | null) => void;
  onSelectRelationship?: (rel: Relationship | null) => void;
  onToggleSelectedEntityRelationshipsOnly: () => void;
  onOpenChecks?: () => void;
}

const RelationshipTableView: React.FC<RelationshipTableViewProps> = ({
  visibleEntities,
  relationships,
  tableRelationships,
  relationshipProjection,
  selectedEntity,
  selectedRelationship,
  selectedEntityRelationshipsOnly,
  issueCountByEntityId,
  consistencyIssues,
  onSelectEntity,
  onSelectRelationship,
  onToggleSelectedEntityRelationshipsOnly,
  onOpenChecks,
}) => {
  return (
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
                    <span>
                      {ent.name}
                      {ent.excluded ? ' (Excluded)' : ''}
                    </span>
                    {ent.id && (issueCountByEntityId.get(ent.id) ?? 0) > 0 && (
                      <button
                        type="button"
                        onClick={(ev) => {
                          ev.stopPropagation();
                          onOpenChecks?.();
                        }}
                        className="ml-1.5 inline-flex items-center rounded bg-amber-100 px-1.5 py-0.5 text-[10px] font-semibold text-amber-900 dark:bg-amber-950 dark:text-amber-200"
                      >
                        ⚠ {issueCountByEntityId.get(ent.id)} issue
                        {issueCountByEntityId.get(ent.id) === 1 ? '' : 's'}
                      </button>
                    )}
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
            Directed Relationships ({tableRelationships.length}
            {selectedEntityRelationshipsOnly && selectedEntity?.id
              ? ` of ${relationshipProjection.edges.length}`
              : ''}
            )
          </h3>
          <button
            type="button"
            disabled={!selectedEntity?.id}
            aria-pressed={selectedEntityRelationshipsOnly}
            onClick={onToggleSelectedEntityRelationshipsOnly}
            className="rounded border border-gray-300 px-2 py-1 text-[11px] text-gray-700 hover:bg-gray-100 disabled:cursor-not-allowed disabled:opacity-50 dark:border-gray-700 dark:text-gray-300 dark:hover:bg-gray-800"
          >
            {selectedEntityRelationshipsOnly
              ? 'Show all relationships'
              : 'Filter to selected character'}
          </button>
        </div>
        <p className="mb-2 text-[11px] text-gray-500" id="relationship-checks-help">
          Checks reflect the current project snapshot and are read-only. They are also listed in the Checks tab.
        </p>
        <table className="w-full text-left border-collapse text-xs">
          <caption className="sr-only">
            Canonical ID directed relationships and current related consistency findings
          </caption>
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
              const rowIssues = consistencyIssues.filter(
                (issue) =>
                  issue.relationshipId === edge.id ||
                  issue.targets?.some(
                    (issueTarget) =>
                      issueTarget.kind === 'relationship' && issueTarget.relationshipId === edge.id
                  ) ||
                  issue.affectedEntityIds.some((id) => endpointIds.has(id))
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
                      <ul
                        aria-label={`Current consistency findings related to ${rel.source} ${rel.label} ${rel.target}`}
                        className="space-y-1"
                      >
                        {rowIssues.map((issue) => (
                          <li
                            key={issue.id}
                            className="rounded border border-amber-300 bg-amber-50 p-1.5 dark:border-amber-800 dark:bg-amber-950/30"
                          >
                            <span className="font-semibold">
                              {issue.severity === 'error' ? 'Error' : 'Warning'} · {issue.category}
                            </span>
                            <p className="font-medium">{issue.title}</p>
                            <p>{issue.description}</p>
                          </li>
                        ))}
                      </ul>
                    ) : (
                      <span className="text-gray-500">None</span>
                    )}
                  </td>
                </tr>
              );
            })}
            {tableRelationships.length === 0 && (
              <tr>
                <td colSpan={6} className="py-3 px-2.5 text-center text-gray-500">
                  No relationships with valid canonical IDs match this filter.
                </td>
              </tr>
            )}
          </tbody>
        </table>
        {relationshipProjection.omissions.length > 0 && (
          <details className="mt-2 rounded border border-amber-300 p-2 text-xs dark:border-amber-800">
            <summary className="cursor-pointer font-semibold">
              {relationshipProjection.omissions.length} relationship(s) omitted from this table because canonical identity or label checks failed
            </summary>
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
  );
};

export default RelationshipTableView;
