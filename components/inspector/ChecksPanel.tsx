/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import { getEffectiveAttributeValue } from '../../lib/beliefGraphUtils';
import { resolveConsistencyIssueTarget } from '../../lib/consistencyChecker';
import { computePromptDigest } from '../../lib/promptBuilder';
import type {
  ConsistencyIssue,
  ConsistencyIssueTarget,
  CreativeProject,
} from '../../shared/types';
import type { ReadinessItem } from '../../lib/narrative/diagnostics/engine';

export interface ConsistencyFixPreview {
  issueId: string;
  projectId: string;
  baseRevision: number;
  baseSnapshotDigest: string;
  baseSnapshotJson: string;
  entityId: string;
  before: string;
  after: string;
}

export interface ChecksPanelProps {
  project: CreativeProject;
  snapshotJson: string;
  readinessItems: ReadinessItem[];
  actualConsistencyIssues: ConsistencyIssue[];
  consistencyFixPreview: ConsistencyFixPreview | null;
  previewIsStale: boolean;
  onSetConsistencyFixPreview: (preview: ConsistencyFixPreview | null) => void;
  onNavigateConsistencyTarget?: (target: ConsistencyIssueTarget) => void;
  onOpenReviewDiagnostics?: () => void;
}

const ChecksPanel: React.FC<ChecksPanelProps> = ({
  project,
  snapshotJson,
  readinessItems,
  actualConsistencyIssues,
  consistencyFixPreview,
  previewIsStale,
  onSetConsistencyFixPreview,
  onNavigateConsistencyTarget,
  onOpenReviewDiagnostics,
}) => {
  const { snapshot } = project;

  return (
    <div className="flex-1 overflow-y-auto p-4 space-y-3 min-h-0">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h3 className="font-display text-sm font-bold text-gray-900 dark:text-gray-100">
            Continuity &amp; Consistency Review
          </h3>
          <p className="text-xs text-gray-500 dark:text-gray-400">
            Separates project readiness prompts from real continuity conflicts without silently rewriting your story.
          </p>
        </div>
        {onOpenReviewDiagnostics && (
          <button
            type="button"
            onClick={onOpenReviewDiagnostics}
            className="px-2.5 py-1 text-[11px] font-semibold rounded bg-blue-600 hover:bg-blue-700 text-white whitespace-nowrap"
          >
            Open Full Diagnostics &amp; Fixes
          </button>
        )}
      </div>

      {readinessItems.length > 0 && (
        <section
          aria-label="Project readiness checklist"
          className="rounded-md border border-blue-200 dark:border-blue-900/60 bg-blue-50/40 dark:bg-blue-950/20 p-3 space-y-1.5 text-xs"
        >
          <h4 className="font-semibold text-blue-900 dark:text-blue-200">
            Project Readiness ({readinessItems.length})
          </h4>
          <p className="text-[11px] text-blue-800/80 dark:text-blue-300/80">
            Readiness reminders are optional setup items and are kept separate from continuity conflicts.
          </p>
          <ul className="space-y-1">
            {readinessItems.map((item) => (
              <li key={item.id} className="flex items-center justify-between gap-2">
                <span>{item.title}</span>
                {item.storyField && (
                  <button
                    type="button"
                    onClick={() =>
                      onNavigateConsistencyTarget?.({
                        id: item.id,
                        kind: 'story_bible',
                        label: `Open ${item.storyField}`,
                        storyField: item.storyField,
                      })
                    }
                    className="text-[11px] font-semibold text-blue-700 dark:text-blue-300 hover:underline shrink-0"
                  >
                    Open field
                  </button>
                )}
              </li>
            ))}
          </ul>
        </section>
      )}

      {actualConsistencyIssues.length === 0 ? (
        <div className="p-5 text-center rounded-md border border-emerald-200 dark:border-emerald-900/60 bg-emerald-50/40 dark:bg-emerald-950/20">
          <p className="text-xs font-semibold text-emerald-800 dark:text-emerald-300">
            No local consistency conflicts detected.
          </p>
          <p className="text-xs text-emerald-700 dark:text-emerald-400 mt-1">
            All confirmed entities, exclusions, and Story Bible properties are aligned.
          </p>
        </div>
      ) : (
        <div className="space-y-2.5">
          {actualConsistencyIssues.map((issue) => (
            <div
              key={issue.id}
              className={`p-3 rounded-md border text-xs space-y-1.5 ${
                issue.severity === 'error'
                  ? 'border-red-300 dark:border-red-800 bg-red-50/50 dark:bg-red-950/30'
                  : 'border-amber-300 dark:border-amber-800 bg-amber-50/50 dark:bg-amber-950/30'
              }`}
            >
              <div className="text-[11px] font-medium text-gray-600 dark:text-gray-400">
                <span className="uppercase font-semibold">{issue.severity}</span>
                <span aria-hidden="true"> · </span>
                <span>{issue.category.replace(/_/g, ' ')}</span>
              </div>
              <h4 className="font-semibold text-gray-900 dark:text-gray-100">{issue.title}</h4>
              <p className="text-gray-700 dark:text-gray-300">{issue.description}</p>
              {issue.suggestedFix && (
                <p className="text-gray-600 dark:text-gray-400 italic">
                  Recommendation: {issue.suggestedFix}
                </p>
              )}
              {issue.category === 'violated_exclusion' &&
                !issue.id.startsWith('issue_excl_conflict_') &&
                issue.targets?.some(
                  (target) =>
                    target.kind === 'entity' &&
                    target.entityId &&
                    issue.id === `issue_excl_${target.entityId}`
                ) && (
                  <button
                    type="button"
                    className="px-2.5 py-1 text-[11px] font-semibold rounded border border-indigo-300 dark:border-indigo-700 bg-white dark:bg-gray-900 text-indigo-700 dark:text-indigo-300 hover:bg-indigo-50 dark:hover:bg-indigo-950/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500"
                    onClick={() => {
                      const target = issue.targets?.find(
                        (item) =>
                          item.kind === 'entity' &&
                          item.entityId &&
                          issue.id === `issue_excl_${item.entityId}`
                      );
                      if (!target?.entityId) return;
                      const resolved = resolveConsistencyIssueTarget(snapshot, target);
                      if (!resolved.ok || resolved.kind !== 'entity') return;
                      const existence = resolved.entity.attributes.find(
                        (attribute) =>
                          attribute.name === 'existence' || attribute.name === 'existence_in_image'
                      );
                      onSetConsistencyFixPreview({
                        issueId: issue.id,
                        projectId: project.id,
                        baseRevision: project.revision ?? 1,
                        baseSnapshotDigest: computePromptDigest(snapshotJson, snapshot.mode),
                        baseSnapshotJson: snapshotJson,
                        entityId: resolved.entity.id!,
                        before: existence
                          ? `Present (${getEffectiveAttributeValue(existence)})`
                          : 'Present (implicit; no existence field)',
                        after: 'Absent (proposed)',
                      });
                    }}
                  >
                    Preview possible fix
                  </button>
                )}
              {issue.targets && issue.targets.length > 0 && (
                <div
                  className="flex flex-wrap items-center gap-1.5 pt-1"
                  aria-label={`Navigation targets for ${issue.title}`}
                >
                  {issue.targets.map((target) => {
                    const resolved = resolveConsistencyIssueTarget(snapshot, target);
                    if (!resolved.ok) {
                      return (
                        <button
                          key={target.id}
                          type="button"
                          disabled
                          title={resolved.reason}
                          className="px-2 py-1 text-[11px] font-medium rounded border border-gray-300 dark:border-gray-700 bg-gray-100 dark:bg-gray-800 text-gray-500 dark:text-gray-400 cursor-not-allowed"
                        >
                          {target.label} (Unavailable)
                        </button>
                      );
                    }
                    return (
                      <button
                        key={target.id}
                        type="button"
                        onClick={() => onNavigateConsistencyTarget?.(target)}
                        className="px-2.5 py-1 text-[11px] font-semibold rounded border border-blue-300 dark:border-blue-700 bg-white dark:bg-gray-900 text-blue-700 dark:text-blue-300 hover:bg-blue-50 dark:hover:bg-blue-950/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 transition-colors"
                      >
                        {target.label}
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {consistencyFixPreview && (
        <section
          aria-labelledby="consistency-fix-preview-heading"
          className="rounded-md border border-indigo-300 dark:border-indigo-700 p-3 space-y-2 text-xs"
        >
          <div className="flex items-start justify-between gap-2">
            <h4 id="consistency-fix-preview-heading" className="font-semibold">
              Possible change preview
            </h4>
            <button
              type="button"
              className="underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500"
              onClick={() => onSetConsistencyFixPreview(null)}
            >
              Close preview
            </button>
          </div>
          {previewIsStale ? (
            <p role="status" className="text-amber-800 dark:text-amber-200">
              This proposal is unavailable because its project, revision, contents, finding, or target changed. Reopen a current finding to preview again.
            </p>
          ) : (
            <>
              <dl className="grid gap-2 sm:grid-cols-2">
                <div className="rounded border border-red-300 dark:border-red-800 p-2">
                  <dt className="font-semibold">Before</dt>
                  <dd>{consistencyFixPreview.before}</dd>
                </div>
                <div className="rounded border border-emerald-300 dark:border-emerald-800 p-2">
                  <dt className="font-semibold">Proposed after</dt>
                  <dd>{consistencyFixPreview.after}</dd>
                </div>
              </dl>
              <p className="text-gray-600 dark:text-gray-300">
                Read-only preview · project {consistencyFixPreview.projectId} · revision r
                {consistencyFixPreview.baseRevision} · base {consistencyFixPreview.baseSnapshotDigest}
              </p>
              <p className="font-medium">No project change has been made.</p>
            </>
          )}
        </section>
      )}
    </div>
  );
};

export default ChecksPanel;
