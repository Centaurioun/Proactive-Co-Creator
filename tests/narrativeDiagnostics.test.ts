import assert from 'node:assert/strict';
import test from 'node:test';
import { createSampleProject } from '../lib/canonicalModel.ts';
import { createUndoRedoStateFromProject } from '../lib/historyEngine.ts';
import {
  applyDiagnosticFixAlternative,
  collectLocalDiagnosticFindings,
  syncDiagnosticFindingsIntoProject,
} from '../lib/narrative/diagnostics/engine.ts';
import { diagnosticFingerprint, reconcileDiagnosticFindings } from '../lib/narrative/diagnostics/findings.ts';
import { narrativeBase, prepareManuscriptChange } from '../lib/narrative/manuscriptModel.ts';
import type { NarrativeRecords } from '../shared/narrativeTypes.ts';
import type { CreativeProject } from '../shared/types.ts';

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

test('W6-D05a: complete scan reopens resolved issue even when finding fields are unchanged', () => {
  const unchangedFinding = finding({ anchors: [] });
  const resolvedUnchanged = issue({
    disposition: 'resolved',
    dispositionReason: 'Fixed in revision 4',
    anchors: [],
    reason: unchangedFinding.reason,
    history: [{ disposition: 'resolved', time: 15, reason: 'Fixed in revision 4', projectRevision: 4 }],
  });
  const completeReopened = reconcileDiagnosticFindings(records([resolvedUnchanged]), run(), [unchangedFinding]);
  assert.equal(completeReopened.actions.length, 1);
  assert.equal(completeReopened.actions[0].kind, 'reopen');
  assert.equal(completeReopened.actions[0].issue.disposition, 'open');
  assert.equal(completeReopened.actions[0].issue.history.length, 2);
});

test('W6-D05b: partial scan reopen records dispositionReason and reopen history entry', () => {
  const base = createSampleProject(100);
  const partialFp = diagnosticFingerprint('semantic-ai', 'semantic:continuity:gap', ['scene-1'], 'semantic');
  const projectWithResolved: CreativeProject = {
    ...base,
    schemaVersion: 4,
    narrative: records([
      issue({
        id: `issue:${partialFp}`,
        fingerprint: partialFp,
        title: 'Timeline gap',
        reason: 'Missing transition',
        disposition: 'resolved',
        dispositionReason: 'Marked resolved earlier',
        anchors: [],
        affectedTargetIds: ['scene-1'],
        severity: 'medium',
        certainty: 'likely',
        source: 'semantic-ai',
        history: [{ disposition: 'resolved', time: 50, reason: 'Marked resolved earlier', projectRevision: 1 }],
      }),
    ]),
  };
  const synced = syncDiagnosticFindingsIntoProject(
    projectWithResolved,
    [{
      detectorId: 'semantic-ai',
      scopeKey: 'semantic',
      type: 'semantic:continuity:gap',
      targetIds: ['scene-1'],
      title: 'Timeline gap',
      reason: 'Missing transition',
      anchors: [],
      severity: 'medium',
      certainty: 'likely',
    }],
    { source: 'semantic-ai', scopeLabel: 'Semantic scan', fullScan: false, now: 200 }
  );
  const reopenedPartial = synced.narrative!.issues.find((i) => i.fingerprint === partialFp)!;
  assert.equal(reopenedPartial.disposition, 'open');
  assert.ok(reopenedPartial.dispositionReason, 'reopened issue must record dispositionReason');
  assert.equal(reopenedPartial.history.length, 2);
  assert.equal(reopenedPartial.history[1].disposition, 'open');
});

test('W6-D06a: Unicode/Turkish word boundaries for excluded entities in manuscript sections', () => {
  const base = createSampleProject(100);
  const projectWithUnicodeEntities: CreativeProject = {
    ...base,
    snapshot: {
      ...base.snapshot,
      entities: [
        ...base.snapshot.entities,
        { id: 'ent_ipek', name: 'İpek', category: 'character', description: '', excluded: true, presence_in_prompt: false, alternatives: null, attributes: [] },
        { id: 'ent_omer', name: 'Ömer', category: 'character', description: '', excluded: true, presence_in_prompt: false, alternatives: null, attributes: [] },
        { id: 'ent_sahin', name: 'Şahin', category: 'character', description: '', excluded: true, presence_in_prompt: false, alternatives: null, attributes: [] },
      ],
    },
  };
  const prepared = prepareManuscriptChange(
    projectWithUnicodeEntities,
    createUndoRedoStateFromProject(projectWithUnicodeEntities),
    narrativeBase(projectWithUnicodeEntities),
    [{ id: 'sec_tr', kind: 'scene', title: 'Bölüm 1', text: 'İpek ve Ömer kapıda bekledi; Şahinler ise uzaktaydı.' }]
  )!;
  const findings = collectLocalDiagnosticFindings(prepared.project);
  assert.equal(findings.some((f) => f.type === 'manuscript_excluded_mention' && f.title.includes('İpek')), true);
  assert.equal(findings.some((f) => f.type === 'manuscript_excluded_mention' && f.title.includes('Ömer')), true);
  assert.equal(findings.some((f) => f.type === 'manuscript_excluded_mention' && f.title.includes('Şahin')), false);
});

test('W6-D06b: applyDiagnosticFixAlternative rejects missing entityId on entity_exclude and entity_attribute', () => {
  const base = createSampleProject(100);
  const idLessProject: CreativeProject = {
    ...base,
    snapshot: {
      ...base.snapshot,
      entities: [
        { name: 'Ghost A', category: 'character', description: 'Original A', presence_in_prompt: false, alternatives: null, attributes: [] },
        { name: 'Ghost B', category: 'character', description: 'Original B', presence_in_prompt: false, alternatives: null, attributes: [] },
      ],
    },
  };
  const undo = createUndoRedoStateFromProject(idLessProject);
  assert.throws(
    () =>
      applyDiagnosticFixAlternative(
        idLessProject,
        undo,
        'issue-1',
        {
          id: 'alt_missing_attr',
          title: 'Overwrite without entityId',
          reason: 'Malformed AI fix',
          assumptions: [],
          evidenceSummary: '',
          affectedScope: 'Entity',
          kind: 'entity_attribute',
          attributeName: 'description',
          beforeText: 'Original A',
          afterText: 'Corrupted',
        },
        idLessProject.revision
      ),
    /entity ID|target entity/i
  );
  assert.throws(
    () =>
      applyDiagnosticFixAlternative(
        idLessProject,
        undo,
        'issue-2',
        {
          id: 'alt_missing_excl',
          title: 'Exclude without entityId',
          reason: 'Malformed AI fix',
          assumptions: [],
          evidenceSummary: '',
          affectedScope: 'Entity',
          kind: 'entity_exclude',
          beforeText: 'Present',
          afterText: 'Excluded',
        },
        idLessProject.revision
      ),
    /entity ID|target entity/i
  );
});

test('F-W7-CH02: Turkish İ/i case-folding matches excluded İpek across İpek/İPEK/ipek/i\\u0307pek without breaking word boundaries or English Iris', () => {
  const base = createSampleProject(100);
  const projectWithTurkishEntities: CreativeProject = {
    ...base,
    snapshot: {
      ...base.snapshot,
      entities: [
        ...base.snapshot.entities,
        { id: 'ent_ipek', name: 'İpek', category: 'character', description: '', excluded: true, presence_in_prompt: false, alternatives: null, attributes: [] },
        { id: 'ent_iris', name: 'Iris', category: 'character', description: '', excluded: true, presence_in_prompt: false, alternatives: null, attributes: [] },
        { id: 'ent_omer', name: 'Ömer', category: 'character', description: '', excluded: true, presence_in_prompt: false, alternatives: null, attributes: [] },
      ],
    },
  };

  const secLower = prepareManuscriptChange(
    projectWithTurkishEntities,
    createUndoRedoStateFromProject(projectWithTurkishEntities),
    narrativeBase(projectWithTurkishEntities),
    [{ id: 'sec_lc', kind: 'scene', title: 'Bölüm LC', text: 'ipek kapıda bekledi.' }]
  )!;
  assert.equal(
    collectLocalDiagnosticFindings(secLower.project).some((f) => f.type === 'manuscript_excluded_mention' && f.title.includes('İpek')),
    true
  );

  const secNfd = prepareManuscriptChange(
    projectWithTurkishEntities,
    createUndoRedoStateFromProject(projectWithTurkishEntities),
    narrativeBase(projectWithTurkishEntities),
    [{ id: 'sec_nfd', kind: 'scene', title: 'Bölüm NFD', text: 'i\u0307pek kapıda bekledi.' }]
  )!;
  assert.equal(
    collectLocalDiagnosticFindings(secNfd.project).some((f) => f.type === 'manuscript_excluded_mention' && f.title.includes('İpek')),
    true
  );

  const secBoundaryAndEnglish = prepareManuscriptChange(
    projectWithTurkishEntities,
    createUndoRedoStateFromProject(projectWithTurkishEntities),
    narrativeBase(projectWithTurkishEntities),
    [{ id: 'sec_bnd', kind: 'scene', title: 'Bölüm BND', text: 'İpeksi kumaş, Ömerli yolu ve ırıs çiçeği.' }]
  )!;
  assert.equal(
    collectLocalDiagnosticFindings(secBoundaryAndEnglish.project).some((f) => f.type === 'manuscript_excluded_mention'),
    false
  );

  const lowercaseExcludedProject: CreativeProject = {
    ...base,
    snapshot: {
      ...base.snapshot,
      entities: [
        ...base.snapshot.entities,
        { id: 'ent_ipek_lc', name: 'ipek', category: 'character', description: '', excluded: true, presence_in_prompt: false, alternatives: null, attributes: [] },
      ],
    },
  };
  const secUpperText = prepareManuscriptChange(
    lowercaseExcludedProject,
    createUndoRedoStateFromProject(lowercaseExcludedProject),
    narrativeBase(lowercaseExcludedProject),
    [{ id: 'sec_uc', kind: 'scene', title: 'Bölüm UC', text: 'İpek kapıda bekledi.' }]
  )!;
  assert.equal(
    collectLocalDiagnosticFindings(secUpperText.project).some((f) => f.type === 'manuscript_excluded_mention' && f.title.includes('ipek')),
    true
  );
});
