import assert from 'node:assert/strict';
import test from 'node:test';
import { diagnosticFingerprint, reconcileDiagnosticFindings } from '../lib/narrative/diagnostics/findings.ts';
import type { NarrativeRecords } from '../shared/narrativeTypes.ts';

const anchor = (digest: string) => ({ sourceId: 'source-1', version: 'v1', digest, start: 4, end: 10, excerpt: 'evidence' });

function records(issues: NarrativeRecords['issues'] = []): NarrativeRecords {
  return { versions: [], sectionVersions: [], sources: [], claims: [], issues, audit: [] };
}

function issue(overrides: Partial<NarrativeRecords['issues'][number]> = {}): NarrativeRecords['issues'][number] {
  return {
    id: 'issue-1', fingerprint: diagnosticFingerprint('consistency', 'age-conflict', ['scene-1'], 'temporal'),
    title: 'Conflicting age', disposition: 'deferred', freshness: 'current', reason: 'Age may change over time',
    anchors: [anchor('digest-a')], affectedTargetIds: ['scene-1'], severity: 'medium', certainty: 'possible',
    dispositionReason: 'Review after chapter 2', history: [{ disposition: 'deferred', time: 10, reason: 'Review after chapter 2', projectRevision: 4 }],
    ...overrides,
  };
}

function finding(overrides: Partial<{
  detectorId: string; scopeKey: string; type: string; targetIds: readonly string[]; title: string; reason: string;
  anchors: ReturnType<typeof anchor>[]; severity: 'info' | 'low' | 'medium' | 'high';
  certainty: 'uncertain' | 'possible' | 'likely' | 'confirmed';
}> = {}) {
  return { detectorId: 'consistency', scopeKey: 'temporal', type: 'age-conflict', targetIds: ['scene-1'], title: 'Conflicting age', reason: 'Two ages overlap', anchors: [anchor('digest-a')], severity: 'medium' as const, certainty: 'possible' as const, ...overrides };
}

const run = (overrides: Partial<{
  detectorId: string; scopeKey: string; scannedTargetIds: readonly string[]; complete: boolean;
  projectRevision: number; validatedRevision: number; now: number;
}> = {}) => ({
  detectorId: 'consistency', scopeKey: 'temporal', scannedTargetIds: ['scene-1'], complete: true,
  projectRevision: 5, validatedRevision: 5, now: 20, ...overrides,
});

test('fingerprints are stable over target order but differ by detector, type, target, and scope', () => {
  const base = diagnosticFingerprint('consistency', 'age-conflict', ['scene-2', 'scene-1'], 'temporal');
  assert.equal(base, diagnosticFingerprint('consistency', 'age-conflict', ['scene-1', 'scene-2'], 'temporal'));
  assert.notEqual(base, diagnosticFingerprint('other-detector', 'age-conflict', ['scene-1', 'scene-2'], 'temporal'));
  assert.notEqual(base, diagnosticFingerprint('consistency', 'timeline-gap', ['scene-1', 'scene-2'], 'temporal'));
  assert.notEqual(base, diagnosticFingerprint('consistency', 'age-conflict', ['scene-1'], 'temporal'));
  assert.notEqual(base, diagnosticFingerprint('consistency', 'age-conflict', ['scene-1', 'scene-2'], 'character'));
});

test('reconciliation proposes one issue for duplicate equivalent findings without mutating records', () => {
  const before = records();
  const result = reconcileDiagnosticFindings(before, run({ scannedTargetIds: ['scene-1', 'scene-2'] }), [
    finding({ targetIds: ['scene-2', 'scene-1'] }), finding({ targetIds: ['scene-1', 'scene-2'] }),
  ]);
  assert.equal(result.actions.length, 1);
  assert.equal(result.actions[0].kind, 'upsert');
  assert.equal(result.actions[0].issue.disposition, 'open');
  assert.equal(result.actions[0].issue.freshness, 'current');
  assert.equal(before.issues.length, 0);
});

test('partial, target-incomplete, or unverified scans never propose resolution', () => {
  const prior = issue({ disposition: 'open', dispositionReason: undefined, history: [] });
  for (const scan of [
    run({ complete: false }), run({ scannedTargetIds: [] }), run({ validatedRevision: 4 }),
  ]) {
    const result = reconcileDiagnosticFindings(records([prior]), scan, []);
    assert.deepEqual(result.actions, []);
  }
});

test('a complete verified scan proposes resolution only for fully covered owned open issues', () => {
  const prior = issue({ disposition: 'open', dispositionReason: undefined, history: [] });
  const unrelated = issue({ id: 'issue-2', fingerprint: diagnosticFingerprint('consistency', 'age-conflict', ['scene-2'], 'temporal'), affectedTargetIds: ['scene-2'] });
  const resolved = reconcileDiagnosticFindings(records([prior, unrelated]), run(), []);
  assert.equal(resolved.actions.length, 1);
  assert.equal(resolved.actions[0].kind, 'resolve');
  assert.equal(resolved.actions[0].issue.disposition, 'resolved');
  assert.equal(resolved.actions[0].issue.id, prior.id);
  assert.equal(prior.disposition, 'open');
  assert.equal(unrelated.disposition, 'deferred');

  const deferred = issue();
  const retained = reconcileDiagnosticFindings(records([deferred]), run(), []);
  assert.deepEqual(retained.actions, []);
});

test('another detector, another scope, and legacy import fingerprints are never owned or resolved', () => {
  const legacy = issue({ fingerprint: 'source-1:ambiguity:4:10:Conflicting age' });
  const otherDetector = issue({ fingerprint: diagnosticFingerprint('other-detector', 'age-conflict', ['scene-1'], 'temporal') });
  const otherScope = issue({ fingerprint: diagnosticFingerprint('consistency', 'age-conflict', ['scene-1'], 'character') });
  for (const prior of [legacy, otherDetector, otherScope]) {
    const result = reconcileDiagnosticFindings(records([prior]), run(), []);
    assert.deepEqual(result.actions, []);
  }
});

test('a deferred finding keeps its disposition, rationale, and history when its evidence changes', () => {
  const prior = issue();
  const result = reconcileDiagnosticFindings(records([prior]), run(), [finding({ anchors: [anchor('digest-b')] })]);
  assert.equal(result.actions.length, 1);
  assert.equal(result.actions[0].kind, 'upsert');
  assert.equal(result.actions[0].issue.disposition, 'deferred');
  assert.equal(result.actions[0].issue.dispositionReason, 'Review after chapter 2');
  assert.deepEqual(result.actions[0].issue.history, prior.history);
  assert.equal(result.actions[0].issue.freshness, 'needs-recheck');
});

test('dismissed recurrence stays dismissed; resolved recurrence proposes an audited reopen', () => {
  const dismissed = issue({ disposition: 'dismissed', dispositionReason: 'Intentional ambiguity' });
  const dismissedResult = reconcileDiagnosticFindings(records([dismissed]), run(), [finding({ anchors: [anchor('digest-b')] })]);
  assert.equal(dismissedResult.actions[0].issue.disposition, 'dismissed');
  assert.equal(dismissedResult.actions[0].issue.dispositionReason, 'Intentional ambiguity');

  const resolved = issue({ disposition: 'resolved', dispositionReason: 'Corrected in revision 4', history: [
    { disposition: 'resolved', time: 15, reason: 'Corrected in revision 4', projectRevision: 4 },
  ] });
  const reopened = reconcileDiagnosticFindings(records([resolved]), run(), [finding({ anchors: [anchor('digest-b')] })]);
  assert.equal(reopened.actions[0].kind, 'reopen');
  assert.equal(reopened.actions[0].issue.disposition, 'open');
  assert.equal(reopened.actions[0].issue.history.length, 2);
  assert.equal(reopened.actions[0].issue.history[1].projectRevision, 5);
});

test('mixed finding scopes are rejected instead of resolving issues outside the run scope', () => {
  assert.throws(() => reconcileDiagnosticFindings(records(), run(), [finding(), finding({ detectorId: 'timeline' })]), /scope|fingerprint/i);
});
