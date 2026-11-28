/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import type { ConsistencyIssueTarget, CreativeProject } from '../../../shared/types';
import type { ManuscriptSection } from '../../../shared/narrativeTypes';
import type { DiagnosticFixAlternative } from '../../../shared/narrativeAiSchemas';
import { isAbortError } from '../../../services/apiClient';
import type { PendingProposalReview } from './proposalReviewContext';

export interface IssueAiFixRequestParams {
  issueId: string;
  setIssueLoading: (issueId: string, loading: boolean) => void;
  registerController: (issueId: string) => AbortController;
  isActive: () => boolean;
  requestFixes: (signal: AbortSignal) => Promise<{ alternatives: DiagnosticFixAlternative[] }>;
  onSuccess: (alternatives: DiagnosticFixAlternative[]) => void;
  onError: (message: string) => void;
}

export async function executeIssueAiFixRequest({
  issueId,
  setIssueLoading,
  registerController,
  isActive,
  requestFixes,
  onSuccess,
  onError,
}: IssueAiFixRequestParams): Promise<void> {
  const controller = registerController(issueId);
  setIssueLoading(issueId, true);
  try {
    const response = await requestFixes(controller.signal);
    if (controller.signal.aborted || !isActive()) return;
    onSuccess(response.alternatives);
  } catch (cause) {
    if (!controller.signal.aborted && !isAbortError(cause) && isActive()) {
      onError(cause instanceof Error ? cause.message : 'Could not fetch AI fix alternatives.');
    }
  } finally {
    if (!controller.signal.aborted && isActive()) {
      setIssueLoading(issueId, false);
    }
  }
}

export interface ScopedSyncAnalysisParams<TResponse> {
  registerController: () => AbortController;
  setBusy: (busy: boolean) => void;
  isActive: () => boolean;
  runSync: (signal: AbortSignal) => Promise<TResponse>;
  onSuccess: (response: TResponse) => void;
  onError: (message: string) => void;
}

export async function executeScopedSyncAnalysis<TResponse>({
  registerController,
  setBusy,
  isActive,
  runSync,
  onSuccess,
  onError,
}: ScopedSyncAnalysisParams<TResponse>): Promise<void> {
  const controller = registerController();
  setBusy(true);
  try {
    const response = await runSync(controller.signal);
    if (controller.signal.aborted || !isActive()) return;
    onSuccess(response);
  } catch (cause) {
    if (!controller.signal.aborted && !isAbortError(cause) && isActive()) {
      onError(cause instanceof Error ? cause.message : 'Sync analysis failed.');
    }
  } finally {
    if (!controller.signal.aborted && isActive()) {
      setBusy(false);
    }
  }
}

import {
  buildReviewModelPayload,
  buildScopedDiagnosticPlan,
  buildScopedSyncPlan,
} from '../../../lib/narrative/review/scopedContextBuilder';

export function buildCompactReviewModelPayload(projectOrSnapshot: CreativeProject | CreativeProject['snapshot']) {
  if ('snapshot' in projectOrSnapshot) {
    return buildReviewModelPayload(projectOrSnapshot);
  }
  return buildReviewModelPayload({ snapshot: projectOrSnapshot });
}

export function buildScopedDiagnosticPayload(params: {
  project: CreativeProject;
  sections: ManuscriptSection[];
  diagScope: 'full' | 'scene' | 'entity' | 'changed';
  diagTargetId: string;
  compactModel: ReturnType<typeof buildReviewModelPayload>;
  segmentIndex?: number;
}) {
  const plan = buildScopedDiagnosticPlan({
    project: params.project,
    sections: params.sections,
    scope: params.diagScope,
    scopeTargetId: params.diagTargetId || undefined,
    compactModel: params.compactModel,
  });
  const idx = Math.max(0, Math.min(params.segmentIndex ?? 0, plan.segments.length - 1));
  return plan.segments[idx].payload;
}

export function buildScopedSyncPayload(params: {
  project: CreativeProject;
  sections: ManuscriptSection[];
  syncDirection: 'manuscript-to-model' | 'model-to-manuscript';
  compactModel: ReturnType<typeof buildReviewModelPayload>;
  segmentIndex?: number;
}) {
  const plan = buildScopedSyncPlan({
    project: params.project,
    sections: params.sections,
    direction: params.syncDirection,
    compactModel: params.compactModel,
  });
  if (plan.segments.length === 0) {
    return {
      direction: params.syncDirection,
      projectId: params.project.id,
      baseRevision: params.project.revision,
      manuscriptVersionId: params.project.snapshot.manuscriptVersionId,
      sections: [],
      ...params.compactModel,
    };
  }
  const idx = Math.max(0, Math.min(params.segmentIndex ?? 0, plan.segments.length - 1));
  return plan.segments[idx].payload;
}

export function resolveIssueNavigationTarget(
  project: CreativeProject,
  sections: ManuscriptSection[],
  targetId: string
): ConsistencyIssueTarget {
  if (targetId.startsWith('story_bible:')) {
    const field = targetId.slice('story_bible:'.length) as keyof CreativeProject['snapshot']['storyBible'];
    return { id: targetId, kind: 'story_bible', label: field, storyField: field };
  }
  if (sections.some((s) => s.id === targetId)) {
    return { id: targetId, kind: 'section', label: 'Open scene', sectionId: targetId };
  }
  if (project.snapshot.relationships.some((r) => r.id === targetId)) {
    return { id: targetId, kind: 'relationship', label: 'Open relationship', relationshipId: targetId };
  }
  return { id: targetId, kind: 'entity', label: 'Open entity', entityId: targetId };
}

export function buildResumedFixState(
  project: CreativeProject,
  resumeProposalReview?: PendingProposalReview
) {
  const resumable =
    resumeProposalReview?.projectId === project.id &&
    project.narrative?.issues.some((issue) => issue.id === resumeProposalReview.issueId)
      ? resumeProposalReview
      : undefined;
  const payloadKey = resumeProposalReview
    ? [
        resumeProposalReview.projectId,
        resumeProposalReview.issueId,
        resumeProposalReview.alternative.id,
        resumeProposalReview.context.baseRevision,
        resumeProposalReview.context.snapshotDigest,
      ].join(':')
    : '';
  const initialAlternatives = resumable
    ? {
        [resumable.issueId]: {
          context: resumable.context,
          source: resumable.source,
          alternatives: [resumable.alternative],
        },
      }
    : {};
  const initialSelectedIds = resumable ? { [resumable.issueId]: resumable.alternative.id } : {};
  return { resumable, payloadKey, initialAlternatives, initialSelectedIds };
}

export async function executeSemanticDiagnosticsRun<TResponse extends { coverageNote: string; findings: unknown[] }>(params: {
  registerController: () => AbortController;
  isCurrentController: (ctrl: AbortController) => boolean;
  clearController: () => void;
  setBusy: (busy: boolean) => void;
  runDiagnostics: (signal: AbortSignal) => Promise<TResponse | null>;
  onSuccess: (message: string) => void;
  onError: (message: string) => void;
}): Promise<void> {
  const ctrl = params.registerController();
  params.setBusy(true);
  try {
    const response = await params.runDiagnostics(ctrl.signal);
    if (response && !ctrl.signal.aborted && params.isCurrentController(ctrl)) {
      params.onSuccess(`${response.coverageNote} Recorded ${response.findings.length} semantic finding(s).`);
    }
  } catch (cause) {
    if (!ctrl.signal.aborted && params.isCurrentController(ctrl)) {
      params.onError(cause instanceof Error ? cause.message : 'Semantic consistency analysis failed.');
    }
  } finally {
    if (!ctrl.signal.aborted && params.isCurrentController(ctrl)) {
      params.clearController();
      params.setBusy(false);
    }
  }
}
