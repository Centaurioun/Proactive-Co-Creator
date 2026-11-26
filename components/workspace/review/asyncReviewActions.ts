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

export function buildCompactReviewModelPayload(snapshot: CreativeProject['snapshot']) {
  const entities = snapshot.entities
    .filter((e) => e.category !== 'scene' && e.epistemicKind !== 'belief' && e.epistemicKind !== 'reported')
    .slice(0, 60)
    .map((e) => ({
      id: e.id ?? e.name,
      name: e.name,
      category: e.category,
      description: e.description?.slice(0, 400),
      excluded: e.excluded,
      status: e.status,
      attributes: e.attributes
        .filter((a) => a.epistemicKind !== 'belief' && a.epistemicKind !== 'reported')
        .slice(0, 20)
        .map((a) => ({
          id: a.id,
          name: a.name,
          value: a.confirmedValue ?? a.value[0]?.name ?? '',
          status: a.status,
        })),
    }));
  const relationships = snapshot.relationships.slice(0, 80).map((r) => ({
    id: r.id,
    sourceId: r.sourceId,
    targetId: r.targetId,
    source: r.source,
    target: r.target,
    label: r.label,
    status: r.status,
  }));
  const storyBible: Record<string, string> = {};
  for (const [k, f] of Object.entries(snapshot.storyBible)) {
    if (f.value.trim()) storyBible[k] = f.value.trim().slice(0, 600);
  }
  return { entities, relationships, storyBible };
}

export function buildScopedDiagnosticPayload(params: {
  project: CreativeProject;
  sections: ManuscriptSection[];
  diagScope: 'full' | 'scene' | 'entity' | 'changed';
  diagTargetId: string;
  compactModel: ReturnType<typeof buildCompactReviewModelPayload>;
}) {
  const { project, sections, diagScope, diagTargetId, compactModel } = params;
  const scopedSections =
    diagScope === 'scene' && diagTargetId ? sections.filter((s) => s.id === diagTargetId) : sections.slice(0, 8);
  return {
    projectId: project.id,
    baseRevision: project.revision,
    scope: diagScope,
    ...(diagTargetId ? { scopeTargetId: diagTargetId } : {}),
    ...compactModel,
    sections: scopedSections.map((s) => ({
      id: s.id,
      title: s.title || s.kind,
      kind: s.kind,
      text: s.text.slice(0, 5_000),
    })),
  };
}

export function buildScopedSyncPayload(params: {
  project: CreativeProject;
  sections: ManuscriptSection[];
  syncDirection: 'manuscript-to-model' | 'model-to-manuscript';
  compactModel: ReturnType<typeof buildCompactReviewModelPayload>;
}) {
  const { project, sections, syncDirection, compactModel } = params;
  return {
    direction: syncDirection,
    projectId: project.id,
    baseRevision: project.revision,
    manuscriptVersionId: project.snapshot.manuscriptVersionId,
    sections: sections.slice(0, 8).map((s) => ({
      id: s.id,
      title: s.title || s.kind,
      kind: s.kind,
      text: s.text.slice(0, 5_000),
    })),
    ...compactModel,
  };
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
