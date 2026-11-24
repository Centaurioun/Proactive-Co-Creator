import assert from 'node:assert/strict';
import test from 'node:test';
import { planBackupRetention, type RetentionRecord } from '../lib/narrative/retentionPlanner.ts';

const record = (id: string, overrides: Partial<RetentionRecord> = {}): RetentionRecord => ({
  id,
  projectId: 'project-a',
  destinationId: 'internal-vault',
  format: 'pcc-project-backup',
  formatVersion: 1,
  schemaVersion: 3,
  completeness: 'project',
  payloadBytes: 100,
  payloadSha256: 'a'.repeat(64),
  createdAt: 1,
  pinned: false,
  verification: 'verified',
  ...overrides,
});

test('disabled by default and does not suggest any candidates', () => {
  assert.deepEqual(planBackupRetention([record('a'), record('b')]), {
    candidates: [],
    warnings: ['Retention is disabled.'],
  });
});

test('deduplicates only exact verified payload identities within project and destination', () => {
  const result = planBackupRetention([
    record('old', { createdAt: 1 }),
    record('new', { createdAt: 2 }),
    record('other-project', { projectId: 'project-b' }),
    record('other-destination', { destinationId: 'external-drive' }),
    record('different-schema', { schemaVersion: 4 }),
    record('different-format', { format: 'other-format' }),
    record('different-format-version', { formatVersion: 2 }),
    record('different-completeness', { completeness: 'partial' }),
    record('different-size', { payloadBytes: 101 }),
    record('different-digest', { payloadSha256: 'b'.repeat(64) }),
    record('unverified', { verification: 'unverified' }),
    record('corrupt', { verification: 'corrupt' }),
  ], { enabled: true });
  assert.deepEqual(result.candidates, [{ id: 'old', reasons: ['duplicate-content'] }]);
  assert.deepEqual(result.warnings, [
    '1 record(s) outside the internal vault were excluded.',
    '2 unverified or corrupt record(s) were excluded.',
  ]);
});

test('preserves every pin and the newest verified record while reporting an advisory count cap', () => {
  const result = planBackupRetention([
    record('old', { createdAt: 1 }),
    record('pinned', { createdAt: 2, pinned: true, payloadSha256: 'b'.repeat(64) }),
    record('newest', { createdAt: 3, payloadSha256: 'c'.repeat(64) }),
    record('unverified', { createdAt: 4, verification: 'corrupt', payloadSha256: 'd'.repeat(64) }),
  ], { enabled: true, maxBackups: 1 });
  assert.deepEqual(result.candidates, [
    { id: 'old', reasons: ['exceeds-max-backups'] },
  ]);
  assert.deepEqual(result.warnings, [
    '1 unverified or corrupt record(s) were excluded.',
    'Configured count limit cannot be met because protected records exceed it.',
  ]);
});

test('keeps deterministic newest duplicate and deterministic tie-break independent of input order', () => {
  const records = [record('z', { createdAt: 5 }), record('a', { createdAt: 5 }), record('older', { createdAt: 4 })];
  const expected = { candidates: [
    { id: 'older', reasons: ['duplicate-content'] },
    { id: 'z', reasons: ['duplicate-content'] },
  ], warnings: [] };
  assert.deepEqual(planBackupRetention(records, { enabled: true }), expected);
  assert.deepEqual(planBackupRetention([...records].reverse(), { enabled: true }), expected);
});

test('rejects invalid enabled count limits', () => {
  assert.throws(() => planBackupRetention([record('a')], { enabled: true, maxBackups: 0 }), /positive safe integer/);
  assert.throws(() => planBackupRetention([record('a')], { enabled: true, maxBackups: Number.MAX_SAFE_INTEGER + 1 }), /positive safe integer/);
});

test('preserves all pinned copies and the newest unpinned copy in an exact duplicate group', () => {
  const result = planBackupRetention([
    record('pinned-a', { createdAt: 1, pinned: true }),
    record('pinned-b', { createdAt: 2, pinned: true }),
    record('newest', { createdAt: 3 }),
    record('middle', { createdAt: 2 }),
  ], { enabled: true });
  assert.deepEqual(result.candidates, [{ id: 'middle', reasons: ['duplicate-content'] }]);
});

test('count cap candidates select the oldest eligible records with stable output ordering', () => {
  const result = planBackupRetention([
    record('latest', { createdAt: 4, payloadSha256: 'd'.repeat(64) }),
    record('oldest', { createdAt: 1, payloadSha256: 'a'.repeat(64) }),
    record('middle', { createdAt: 2, payloadSha256: 'b'.repeat(64) }),
    record('newer', { createdAt: 3, payloadSha256: 'c'.repeat(64) }),
  ], { enabled: true, maxBackups: 2 });
  assert.deepEqual(result.candidates, [
    { id: 'middle', reasons: ['exceeds-max-backups'] },
    { id: 'oldest', reasons: ['exceeds-max-backups'] },
  ]);
});

test('does not compare records across destinations or count external records against the internal cap', () => {
  const result = planBackupRetention([
    record('internal', { createdAt: 1 }),
    record('external', { destinationId: 'external-drive', createdAt: 2 }),
  ], { enabled: true, maxBackups: 1 });
  assert.deepEqual(result.candidates, []);
  assert.deepEqual(result.warnings, ['1 record(s) outside the internal vault were excluded.']);
});

test('keeps each project’s sole verified backup despite another project having a newer backup', () => {
  const result = planBackupRetention([
    record('project-a-only', { projectId: 'project-a', createdAt: 1 }),
    record('project-b-newer', { projectId: 'project-b', createdAt: 100 }),
  ], { enabled: true, maxBackups: 1 });
  assert.deepEqual(result.candidates, []);
  assert.deepEqual(result.warnings, []);
});

test('keeps newest and count ranking isolated by project and destination scope', () => {
  const result = planBackupRetention([
    record('a-old', { projectId: 'project-a', destinationId: 'internal-vault', createdAt: 1, payloadSha256: 'a'.repeat(64) }),
    record('a-new', { projectId: 'project-a', destinationId: 'internal-vault', createdAt: 2, payloadSha256: 'b'.repeat(64) }),
    record('b-only', { projectId: 'project-b', destinationId: 'internal-vault', createdAt: 100, payloadSha256: 'c'.repeat(64) }),
    record('a-external-newest', { projectId: 'project-a', destinationId: 'external-drive', createdAt: 1000, payloadSha256: 'd'.repeat(64) }),
  ], { enabled: true, maxBackups: 1 });
  assert.deepEqual(result.candidates, [{ id: 'a-old', reasons: ['exceeds-max-backups'] }]);
  assert.deepEqual(result.warnings, ['1 record(s) outside the internal vault were excluded.']);
});
