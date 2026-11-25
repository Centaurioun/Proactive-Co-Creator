/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import type { VerifiedKinshipProjection } from '../../lib/narrative/projections/kinshipProjection';
import type { Entity, Relationship } from '../../shared/types';

export interface FamilyKinshipViewProps {
  kinshipProjection: VerifiedKinshipProjection;
  onSelectEntity: (entity: Entity | null) => void;
  onSelectRelationship?: (rel: Relationship | null) => void;
}

const FamilyKinshipView: React.FC<FamilyKinshipViewProps> = ({
  kinshipProjection,
  onSelectEntity,
  onSelectRelationship,
}) => {
  return (
    <div className="flex-1 overflow-y-auto p-4 min-h-0 space-y-4 text-xs">
      <div className="border-b border-gray-200 pb-3 dark:border-gray-800">
        <h3 className="font-display text-sm font-bold text-gray-900 dark:text-gray-100">
          Verified Family &amp; Kinship View
        </h3>
        <p className="text-gray-500 dark:text-gray-400">
          Displays only explicitly confirmed kinship predicates (parent, child, sibling, spouse, adoptive, step, extended kin). Generic social relationships are never inferred as family ties, and complex or cyclic kinship is never forced into a fake tree.
        </p>
      </div>

      {kinshipProjection.hasCycles && (
        <p
          role="alert"
          className="rounded border border-amber-400 bg-amber-50 p-2.5 text-amber-900 dark:border-amber-800 dark:bg-amber-950/60 dark:text-amber-200"
        >
          ⚠ Lineage cycle detected involving: {kinshipProjection.cycleEntityNames.join(', ')}. Rendered honestly as a directed kinship graph rather than a strict hierarchy.
        </p>
      )}

      {kinshipProjection.edges.length === 0 ? (
        <div className="rounded border border-gray-200 p-4 space-y-1.5 text-gray-600 dark:border-gray-800 dark:text-gray-300">
          <p className="font-semibold text-gray-900 dark:text-gray-100">
            No verified kinship relationships recorded yet.
          </p>
          <p>
            {kinshipProjection.omittedNonKinshipCount} non-kinship relationship(s) and{' '}
            {kinshipProjection.omittedPendingCount} pending/unconfirmed kinship relationship(s) are intentionally excluded. Add and confirm explicit family predicates (e.g. &ldquo;mother of&rdquo;, &ldquo;sibling of&rdquo;, &ldquo;adoptive parent of&rdquo;) to populate this view.
          </p>
        </div>
      ) : (
        <div className="space-y-2.5">
          <p className="text-gray-500 dark:text-gray-400">
            Showing {kinshipProjection.edges.length} verified kinship tie(s) across{' '}
            {kinshipProjection.nodes.length} character(s). Excluded:{' '}
            {kinshipProjection.omittedNonKinshipCount} non-kinship,{' '}
            {kinshipProjection.omittedPendingCount} unconfirmed.
          </p>
          <ul className="space-y-2">
            {kinshipProjection.edges.map((edge) => (
              <li
                key={edge.relationship.id ?? `${edge.sourceEntity.id}-${edge.targetEntity.id}`}
                className="rounded border border-gray-200 p-2.5 space-y-1 dark:border-gray-800"
              >
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <button
                      type="button"
                      className="font-semibold hover:underline"
                      onClick={() => onSelectEntity(edge.sourceEntity)}
                    >
                      {edge.sourceEntity.name}
                    </button>{' '}
                    →{' '}
                    <button
                      type="button"
                      className="font-medium text-blue-700 hover:underline dark:text-blue-300"
                      onClick={() => onSelectRelationship?.(edge.relationship)}
                    >
                      {edge.relationship.label}
                    </button>{' '}
                    →{' '}
                    <button
                      type="button"
                      className="font-semibold hover:underline"
                      onClick={() => onSelectEntity(edge.targetEntity)}
                    >
                      {edge.targetEntity.name}
                    </button>
                  </div>
                  <span className="rounded bg-emerald-100 px-1.5 py-0.5 text-[10px] font-semibold uppercase text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300">
                    {edge.kinshipKind}
                  </span>
                </div>
                {edge.isNonTreeQualification && edge.qualificationNote && (
                  <p className="text-[11px] text-amber-800 dark:text-amber-300">
                    Note: {edge.qualificationNote}
                  </p>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
};

export default FamilyKinshipView;
