import type { NarrativeRecords } from '../../shared/narrativeTypes.ts';

type Issue = NarrativeRecords['issues'][number];
type Disposition = Issue['disposition'];

const transitions: Record<Disposition, readonly Disposition[]> = {
  open: ['deferred', 'needs-clarification', 'proposed-fix', 'resolved', 'dismissed', 'intentional'],
  deferred: ['open', 'needs-clarification', 'proposed-fix', 'resolved', 'dismissed', 'intentional'],
  'needs-clarification': ['open', 'deferred', 'proposed-fix', 'resolved', 'dismissed', 'intentional'],
  'proposed-fix': ['open', 'deferred', 'needs-clarification', 'resolved', 'dismissed', 'intentional'],
  intentional: ['open', 'resolved', 'dismissed'],
  resolved: ['open'],
  dismissed: ['open'],
};

export function transitionIssue(
  project: { narrative?: NarrativeRecords },
  issueId: string,
  disposition: Disposition,
  reason: string,
  now = Date.now(),
  projectRevision = 0,
): NarrativeRecords {
  const records = project.narrative;
  if (!records) throw new Error('This project has no issue registry.');
  const issue = records.issues.find(({ id }) => id === issueId);
  if (!issue) throw new Error('Issue no longer exists.');
  const explanation = reason.trim();
  if (['deferred', 'needs-clarification', 'proposed-fix', 'resolved', 'dismissed', 'intentional'].includes(disposition) && !explanation) {
    throw new Error('A reason is required for this issue disposition.');
  }
  if (issue.disposition !== disposition && !transitions[issue.disposition].includes(disposition)) {
    throw new Error(`Invalid issue disposition transition: ${issue.disposition} → ${disposition}.`);
  }
  if (issue.disposition === disposition && issue.dispositionReason === explanation) return records;
  const nextIssue: Issue = {
    ...issue,
    disposition,
    dispositionReason: explanation || undefined,
    updatedAt: now,
    ...(disposition === 'open' ? { freshness: issue.freshness === 'historical' ? 'historical' as const : 'needs-recheck' as const } : {}),
    history: [...(issue.history ?? []), { disposition, time: now, reason: explanation, projectRevision }],
  };
  return { ...records, issues: records.issues.map(record => record.id === issueId ? nextIssue : record) };
}

export function invalidateTargetEvidence(
  records: NarrativeRecords,
  changedTargetIds: readonly string[],
): NarrativeRecords {
  const changed = new Set(changedTargetIds);
  if (!changed.size) return records;
  let didChange = false;
  const claims = records.claims.map(claim => {
    if (!changed.has(claim.targetId) || claim.freshness !== 'current') return claim;
    didChange = true;
    return { ...claim, freshness: 'needs-recheck' as const };
  });
  const issues = records.issues.map(issue => {
    if (issue.freshness !== 'current' || !(issue.affectedTargetIds ?? []).some(id => changed.has(id))) return issue;
    didChange = true;
    return { ...issue, freshness: 'needs-recheck' as const };
  });
  return didChange ? { ...records, claims, issues } : records;
}
