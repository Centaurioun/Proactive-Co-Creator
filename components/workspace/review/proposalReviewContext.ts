import type { CreativeProject } from '../../../shared/types.ts';
import type { ConsistencyIssueTarget } from '../../../shared/types.ts';
import type { DiagnosticFixAlternative } from '../../../shared/narrativeAiSchemas.ts';
import { computeSnapshotDigest } from '../../../lib/historyEngine.ts';

export interface ProposalReviewContext {
  projectId: string;
  baseRevision: number;
  manuscriptVersionId?: string;
  snapshotDigest: string;
}

export interface PendingProposalReview {
  projectId: string;
  issueId: string;
  target?: ConsistencyIssueTarget;
  alternative: DiagnosticFixAlternative;
  source: 'local' | 'ai';
  context: ProposalReviewContext;
}

export function captureProposalReviewContext(project: CreativeProject): ProposalReviewContext {
  return {
    projectId: project.id,
    baseRevision: project.revision,
    manuscriptVersionId: project.snapshot.manuscriptVersionId,
    snapshotDigest: computeSnapshotDigest(project.snapshot),
  };
}

export function isProposalReviewContextCurrent(
  project: CreativeProject,
  context: ProposalReviewContext,
): boolean {
  return project.id === context.projectId &&
    project.revision === context.baseRevision &&
    project.snapshot.manuscriptVersionId === context.manuscriptVersionId &&
    computeSnapshotDigest(project.snapshot) === context.snapshotDigest;
}
