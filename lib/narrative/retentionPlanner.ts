export type RetentionRecord = {
  id: string;
  projectId: string;
  destinationId: string;
  format: string;
  formatVersion: number;
  schemaVersion: number;
  completeness: string;
  payloadBytes: number;
  payloadSha256: string;
  createdAt: number;
  pinned: boolean;
  verification: 'verified' | 'unverified' | 'corrupt';
};

export type RetentionPolicy = {
  enabled?: boolean;
  maxBackups?: number;
};

export type RetentionPlan = {
  candidates: Array<{ id: string; reasons: string[] }>;
  warnings: string[];
};

const byNewestThenId = (a: RetentionRecord, b: RetentionRecord): number =>
  b.createdAt - a.createdAt || a.id.localeCompare(b.id);

const duplicateIdentity = (record: RetentionRecord): string => JSON.stringify([
  record.projectId,
  record.destinationId,
  record.format,
  record.formatVersion,
  record.schemaVersion,
  record.completeness,
  record.payloadBytes,
  record.payloadSha256,
]);

export function planBackupRetention(
  records: readonly RetentionRecord[],
  policy: RetentionPolicy = {},
): RetentionPlan {
  if (policy.enabled !== true) return { candidates: [], warnings: ['Retention is disabled.'] };
  if (policy.maxBackups !== undefined &&
    (!Number.isSafeInteger(policy.maxBackups) || policy.maxBackups <= 0)) {
    throw new RangeError('maxBackups must be a positive safe integer.');
  }

  const warnings: string[] = [];
  const internal = records.filter(record => record.destinationId === 'internal-vault');
  const outsideCount = records.length - internal.length;
  if (outsideCount > 0) warnings.push(`${outsideCount} record(s) outside the internal vault were excluded.`);
  const verified = internal.filter(record => record.verification === 'verified');
  const excludedCount = internal.length - verified.length;
  if (excludedCount > 0) warnings.push(`${excludedCount} unverified or corrupt record(s) were excluded.`);

  const candidates = new Map<string, Set<string>>();
  const protectedIds = new Set(verified.filter(record => record.pinned).map(record => record.id));
  const newest = [...verified].sort(byNewestThenId)[0];
  if (newest) protectedIds.add(newest.id);

  const groups = new Map<string, RetentionRecord[]>();
  for (const record of verified) {
    const key = duplicateIdentity(record);
    const group = groups.get(key) ?? [];
    group.push(record);
    groups.set(key, group);
  }
  for (const group of groups.values()) {
    if (group.length < 2) continue;
    const winner = [...group].sort(byNewestThenId)[0];
    if (winner) protectedIds.add(winner.id);
    for (const record of group) {
      if (!protectedIds.has(record.id)) addReason(candidates, record.id, 'duplicate-content');
    }
  }

  if (policy.maxBackups !== undefined) {
    const capOrder = [...verified].sort((a, b) => a.createdAt - b.createdAt || a.id.localeCompare(b.id));
    let projectedCount = verified.length - candidates.size;
    for (const record of capOrder) {
      if (projectedCount <= policy.maxBackups) break;
      if (protectedIds.has(record.id)) continue;
      if (candidates.has(record.id)) continue;
      addReason(candidates, record.id, 'exceeds-max-backups');
      projectedCount--;
    }
    if (projectedCount > policy.maxBackups) {
      warnings.push('Configured count limit cannot be met because protected records exceed it.');
    }
  }

  return {
    candidates: [...candidates.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([id, reasons]) => ({ id, reasons: [...reasons].sort() })),
    warnings,
  };
}

function addReason(candidates: Map<string, Set<string>>, id: string, reason: string): void {
  const reasons = candidates.get(id) ?? new Set<string>();
  reasons.add(reason);
  candidates.set(id, reasons);
}
