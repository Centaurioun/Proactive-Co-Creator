import type { NarrativeRecords } from '../../../shared/narrativeTypes.ts';

type Issue = NarrativeRecords['issues'][number];
type Anchor = Issue['anchors'][number];

export interface DiagnosticFinding {
  detectorId: string;
  scopeKey: string;
  type: string;
  targetIds: readonly string[];
  title: string;
  reason: string;
  anchors: readonly Anchor[];
  severity: Issue['severity'];
  certainty: Issue['certainty'];
}

export interface DiagnosticScan {
  detectorId: string;
  scopeKey: string;
  scannedTargetIds: readonly string[];
  complete: boolean;
  projectRevision: number;
  validatedRevision: number;
  now: number;
}

export type DiagnosticAction =
  | { kind: 'upsert'; issue: Issue }
  | { kind: 'resolve'; issue: Issue }
  | { kind: 'reopen'; issue: Issue };

export interface DiagnosticReconciliation {
  /** Proposed values for a later reviewed transaction; this helper never writes records. */
  actions: DiagnosticAction[];
}

function requireKeyPart(value: string, label: string): void {
  if (!value.trim()) throw new Error(`${label} must not be empty.`);
}

function canonicalTargets(targetIds: readonly string[]): string[] {
  if (!targetIds.length || targetIds.some(id => !id.trim())) throw new Error('A diagnostic finding requires non-empty target IDs.');
  return [...new Set(targetIds)].sort();
}

export function diagnosticFingerprint(detectorId: string, type: string, targetIds: readonly string[], scopeKey: string): string {
  requireKeyPart(detectorId, 'Detector ID');
  requireKeyPart(type, 'Finding type');
  requireKeyPart(scopeKey, 'Diagnostic scope');
  const key = JSON.stringify([detectorId, type, canonicalTargets(targetIds), scopeKey]);
  return `diagnostic:v1:${encodeURIComponent(key)}`;
}

function parseFingerprint(fingerprint: string): [string, string, string[], string] | undefined {
  if (!fingerprint.startsWith('diagnostic:v1:')) return undefined;
  try {
    const parsed: unknown = JSON.parse(decodeURIComponent(fingerprint.slice('diagnostic:v1:'.length)));
    if (!Array.isArray(parsed) || parsed.length !== 4 || typeof parsed[0] !== 'string' || typeof parsed[1] !== 'string' ||
      !Array.isArray(parsed[2]) || !parsed[2].every((id: unknown) => typeof id === 'string') || typeof parsed[3] !== 'string') return undefined;
    return parsed as [string, string, string[], string];
  } catch {
    return undefined;
  }
}

function sameJson(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

function isOwned(issue: Issue, scan: DiagnosticScan): boolean {
  const key = parseFingerprint(issue.fingerprint);
  return Boolean(key && key[0] === scan.detectorId && key[3] === scan.scopeKey);
}

function completeCoverage(issue: Issue, scan: DiagnosticScan): boolean {
  const targets = issue.affectedTargetIds ?? [];
  if (!targets.length) return false;
  const scanned = new Set(scan.scannedTargetIds);
  return targets.every(targetId => scanned.has(targetId));
}

export function reconcileDiagnosticFindings(
  records: NarrativeRecords,
  scan: DiagnosticScan,
  findings: readonly DiagnosticFinding[],
): DiagnosticReconciliation {
  if (scan.validatedRevision !== scan.projectRevision || !Number.isInteger(scan.projectRevision) || scan.projectRevision < 0) return { actions: [] };
  requireKeyPart(scan.detectorId, 'Detector ID');
  requireKeyPart(scan.scopeKey, 'Diagnostic scope');

  const normalized = new Map<string, DiagnosticFinding>();
  for (const finding of findings) {
    if (finding.detectorId !== scan.detectorId || finding.scopeKey !== scan.scopeKey) {
      throw new Error('Finding detector and scope must match the diagnostic scan.');
    }
    const targetIds = canonicalTargets(finding.targetIds);
    if (targetIds.some(targetId => !scan.scannedTargetIds.includes(targetId))) {
      throw new Error('Finding targets must belong to the diagnostic scan scope.');
    }
    const fingerprint = diagnosticFingerprint(finding.detectorId, finding.type, targetIds, finding.scopeKey);
    const canonicalFinding = { ...finding, targetIds };
    const prior = normalized.get(fingerprint);
    if (prior && !sameJson(prior, canonicalFinding)) throw new Error('Duplicate diagnostic fingerprint has conflicting findings.');
    normalized.set(fingerprint, canonicalFinding);
  }

  const existingByFingerprint = new Map(records.issues.map(issue => [issue.fingerprint, issue]));
  const actions: DiagnosticAction[] = [];
  for (const [fingerprint, finding] of [...normalized].sort(([left], [right]) => left.localeCompare(right))) {
    const existing = existingByFingerprint.get(fingerprint);
    const anchors = [...finding.anchors];
    if (!existing) {
      actions.push({ kind: 'upsert', issue: {
        id: `issue:${fingerprint}`, fingerprint, title: finding.title, disposition: 'open', freshness: 'current',
        reason: finding.reason, anchors, affectedTargetIds: [...finding.targetIds], severity: finding.severity,
        certainty: finding.certainty, history: [],
      } });
      continue;
    }

    const changedEvidence = !sameJson(existing.anchors, anchors);
    const changedFinding = changedEvidence || existing.title !== finding.title || existing.reason !== finding.reason ||
      existing.severity !== finding.severity || existing.certainty !== finding.certainty;
    if (existing.disposition === 'resolved' && changedFinding) {
      const reason = 'Finding recurred in a verified diagnostic scan.';
      actions.push({ kind: 'reopen', issue: {
        ...existing, disposition: 'open', dispositionReason: reason, freshness: 'current', title: finding.title,
        reason: finding.reason, anchors, affectedTargetIds: [...finding.targetIds], severity: finding.severity,
        certainty: finding.certainty, updatedAt: scan.now,
        history: [...existing.history, { disposition: 'open', time: scan.now, reason, projectRevision: scan.projectRevision }],
      } });
    } else if (changedFinding) {
      actions.push({ kind: 'upsert', issue: {
        ...existing, title: finding.title, reason: finding.reason, anchors,
        affectedTargetIds: [...finding.targetIds], severity: finding.severity, certainty: finding.certainty,
        freshness: changedEvidence ? 'needs-recheck' : existing.freshness,
      } });
    }
  }

  if (scan.complete) {
    for (const issue of records.issues) {
      if (!isOwned(issue, scan) || normalized.has(issue.fingerprint) || !completeCoverage(issue, scan)) continue;
      if (!['open', 'needs-clarification', 'proposed-fix'].includes(issue.disposition)) continue;
      const reason = 'Not observed in a complete verified diagnostic scan.';
      actions.push({ kind: 'resolve', issue: {
        ...issue, disposition: 'resolved', dispositionReason: reason, updatedAt: scan.now,
        history: [...issue.history, { disposition: 'resolved', time: scan.now, reason, projectRevision: scan.projectRevision }],
      } });
    }
  }

  actions.sort((left, right) => left.issue.fingerprint.localeCompare(right.issue.fingerprint));
  return { actions };
}
