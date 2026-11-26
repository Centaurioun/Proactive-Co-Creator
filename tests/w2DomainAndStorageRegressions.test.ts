/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import assert from 'node:assert/strict';
import { beforeEach, describe, it } from 'node:test';
import { areSnapshotsSemanticallyEqual } from '../lib/canonical/snapshotEquality.ts';
import {
  addEntity,
  createSampleProject,
  mergeAnalysisIntoSnapshot,
  setEntityExistence,
  updateStoryBibleField,
} from '../lib/canonicalModel.ts';
import { evaluateProjectConsistency } from '../lib/consistencyChecker.ts';
import {
  computeSnapshotDigest,
  createUndoRedoState,
  createUndoRedoStateFromProject,
  isSnapshotSemanticallyEqual,
  performUndo,
  pushUndoableTransaction,
} from '../lib/historyEngine.ts';
import {
  applyProposedOperations,
  interpretBatchInstructionLocally,
  validateProposedOperations,
} from '../lib/nlBatchEngine.ts';
import {
  applyAsyncAnalysisCompletion,
  createAiTicketAuthority,
  createRequestTicket,
  createSerializedProjectSaveQueue,
  reconcileAsyncAnalysisResponse,
  reconcileAsyncGenerationResponse,
  registerTicket,
  runAsyncAnalysisSlot,
  runAsyncClarifySlot,
  runAsyncGenerationSlot,
} from '../lib/projectController.ts';
import { resolveProviderPrompt } from '../lib/promptBuilder.ts';
import { intentOperationFingerprint } from '../lib/storage/casPolicy.ts';
import {
  clearDeletedProjectId,
  deleteProjectCompletely,
  LOCAL_STORAGE_PROJECTS_KEY,
  migrateProjectPayload,
  persistProjectDurably,
  reconcileHydratedProjects,
  recordDeletedProjectId,
  reloadLatestProjectsFromStorage,
  saveProjectToIndexedDb,
  saveProjectToLocalStorage,
  simulateBrowserProcessRestartForTesting,
} from '../lib/storageEngine.ts';
import type { Clarification, CreativeProject, ProposedOperation } from '../shared/types.ts';
import type { NarrativeRecords } from '../shared/narrativeTypes.ts';
import { FakeIndexedDB, MockLocalStorage, installMockBrowserStorage } from './helpers/mockBrowserStorage.ts';

const FIXED_TS = 1763942400000;

function makeNarrativeEnvelope(text: string): NarrativeRecords {
  return {
    versions: [{ id: 'ver_1', sectionVersionIds: ['sec_1'] }],
    sectionVersions: [{ id: 'sec_1', section: { id: 'main', kind: 'scene', title: 'Scene 1', text } }],
    audit: [],
    sources: [],
    claims: [],
    issues: [],
  };
}

describe('W2 Domain, History & Storage Defect Reproductions and Characterization', () => {
  const mockLocal = new MockLocalStorage();
  const mockSession = new MockLocalStorage();
  const fakeIdb = new FakeIndexedDB();

  beforeEach(() => {
    mockLocal.clear();
    mockSession.clear();
    fakeIdb.reset();
    simulateBrowserProcessRestartForTesting();
    installMockBrowserStorage(mockLocal, mockSession, fakeIdb);
    clearDeletedProjectId('proj_default_cat_party');
  });

  // --- Characterization Tests (R4) ---

  it('Characterization: computeSnapshotDigest and intentOperationFingerprint are deterministic and exact', () => {
    const sample = createSampleProject(FIXED_TS);
    const d1 = computeSnapshotDigest(sample.snapshot);
    const d2 = computeSnapshotDigest(structuredClone(sample.snapshot));
    assert.equal(d1, d2);
    assert.match(d1, /^snap_[0-9a-f]{16}$/);

    const f1 = intentOperationFingerprint(sample);
    const f2 = intentOperationFingerprint({
      ...structuredClone(sample),
      revision: 99,
      persistedRevision: 50,
      updatedAt: FIXED_TS + 99999,
      recentIntentIds: ['intent_extra'],
    });
    assert.equal(f1, f2);
    assert.match(f1, /^[0-9a-f]+$/);
  });

  it('Characterization: applyProposedOperations handles all 9 ProposedOperationType variants atomically', () => {
    const base = createSampleProject(FIXED_TS).snapshot;
    const ops: ProposedOperation[] = [
      { id: 'op1', type: 'add_entity', summary: 'Add Owl', entityName: 'Owl', entityCategory: 'character', nextValue: 'Wise lookout', selected: true },
      { id: 'op2', type: 'add_attribute', summary: 'Add Owl plumage', entityName: 'Owl', attributeName: 'plumage', nextValue: 'Snowy', selected: true },
      { id: 'op3', type: 'set_attribute', summary: 'Set Cat age', entityId: 'ent_cat', entityName: 'Cat', attributeName: 'age', nextValue: 'Young', selected: true },
      { id: 'op4', type: 'rename_entity', summary: 'Rename Rabbit', entityId: 'ent_rabbit', entityName: 'Rabbit', newEntityName: 'Barnaby', selected: true },
      { id: 'op5', type: 'exclude_entity', summary: 'Exclude Fox', entityId: 'ent_fox', entityName: 'Fox', selected: true },
      { id: 'op6', type: 'add_relationship', summary: 'Cat->Owl', sourceEntityName: 'Cat', targetEntityName: 'Owl', nextValue: 'greets', selected: true },
      { id: 'op7', type: 'update_relationship', summary: 'Update Cat->Table', relationshipId: 'rel_cat_table', sourceEntityName: 'Cat', targetEntityName: 'Banquet Table', nextValue: 'arranges', selected: true },
      { id: 'op8', type: 'remove_relationship', summary: 'Remove Table->Conservatory', relationshipId: 'rel_table_conservatory', selected: true },
      { id: 'op9', type: 'update_story_bible', summary: 'Set genre', storyField: 'genre', nextValue: 'Woodland Mystery', selected: true },
    ];
    const res = applyProposedOperations(base, ops);
    assert.equal(res.errors.length, 0);
    assert.equal(res.appliedCount, 9);
    assert.equal(res.snapshot.entities.some((e) => e.name === 'Owl'), true);
    assert.equal(res.snapshot.entities.find((e) => e.id === 'ent_rabbit')?.name, 'Barnaby');
    assert.equal(res.snapshot.entities.find((e) => e.id === 'ent_fox')?.excluded, true);
    assert.equal(res.snapshot.relationships.some((r) => r.id === 'rel_table_conservatory'), false);
    assert.equal(res.snapshot.relationships.find((r) => r.id === 'rel_cat_table')?.label, 'arranges');
    assert.equal(res.snapshot.storyBible.genre.value, 'Woodland Mystery');
  });

  // --- Defect Reproductions (W2-D01 .. W2-D17) ---

  it('W2-D01: prefer-local reload with persistProjectDurably has no false cache CAS warning and persists when IDB record is missing', async () => {
    const base = createSampleProject(FIXED_TS);
    const idbVer: CreativeProject = {
      ...structuredClone(base),
      id: 'proj_d01',
      revision: 2,
      persistedRevision: 2,
      updatedAt: FIXED_TS + 1000,
      snapshot: updateStoryBibleField(base.snapshot, 'tone', 'IDB Tone', 'user-edit'),
    };
    const localVer: CreativeProject = {
      ...structuredClone(base),
      id: 'proj_d01',
      revision: 2,
      persistedRevision: 2,
      updatedAt: FIXED_TS + 2000,
      snapshot: updateStoryBibleField(base.snapshot, 'tone', 'Local Tone', 'user-edit'),
    };

    await saveProjectToIndexedDb(idbVer, { forceOverwrite: true });
    saveProjectToLocalStorage(localVer, { forceOverwrite: true });

    const res = await reloadLatestProjectsFromStorage('proj_d01', {
      resolution: 'prefer-local',
      commit: (proj, opts) => persistProjectDurably(proj, opts),
    });
    assert.equal(res.persisted, true);
    assert.equal(res.persistenceWarning, undefined);
    assert.equal(res.activeProject.revision, 3);
    assert.equal(res.activeProject.snapshot.storyBible.tone.value, 'Local Tone');

    // Missing IDB record under prefer-local
    fakeIdb.reset();
    const localOnly: CreativeProject = {
      ...structuredClone(base),
      id: 'proj_d01_missing_idb',
      revision: 2,
      persistedRevision: 2,
      updatedAt: FIXED_TS + 3000,
    };
    mockLocal.clear();
    saveProjectToLocalStorage(localOnly, { forceOverwrite: true });

    const resMissingIdb = await reloadLatestProjectsFromStorage('proj_d01_missing_idb', {
      resolution: 'prefer-local',
      commit: (proj, opts) => persistProjectDurably(proj, opts),
    });
    assert.equal(resMissingIdb.persisted, true);
    assert.equal(fakeIdb.records.has('proj_d01_missing_idb'), true);
  });

  it('W2-D02: reloadLatestProjectsFromStorage re-checks isCurrent() after commit await, and reconciliation detects narrative/name divergence under hasLocalEditsSinceMount', async () => {
    const base = createSampleProject(FIXED_TS);
    const localProj: CreativeProject = { ...structuredClone(base), id: 'proj_d02', revision: 2 };
    saveProjectToLocalStorage(localProj, { forceOverwrite: true });

    let current = true;
    const res = await reloadLatestProjectsFromStorage('proj_d02', {
      isCurrent: () => current,
      commit: async (proj, opts) => {
        current = false; // user switches project while commit is in flight
        return persistProjectDurably(proj, opts);
      },
    });
    assert.equal(res.conflictDetected, true);
    assert.match(res.persistenceWarning ?? '', /changed while reloading/i);

    // (b) Schema 4 narrative divergence at equal revision under hasLocalEditsSinceMount
    const s4Local: CreativeProject = {
      ...structuredClone(base),
      id: 'proj_d02_s4',
      schemaVersion: 4,
      revision: 2,
      persistedRevision: 2,
      snapshot: { ...structuredClone(base.snapshot), manuscriptVersionId: 'ver_1' },
      narrative: makeNarrativeEnvelope('Local manuscript chapter'),
    };
    const s4Idb: CreativeProject = {
      ...structuredClone(s4Local),
      narrative: makeNarrativeEnvelope('Different IDB manuscript chapter'),
    };
    const reconciled = reconcileHydratedProjects({
      localProjects: [s4Local],
      idbProjects: [s4Idb],
      activeProject: { ...s4Local, revision: 3, persistedRevision: 2 },
      activeUndoState: createUndoRedoState(s4Local.snapshot),
      hasLocalEditsSinceMount: true,
    });
    assert.ok(reconciled.conflictWithHydrated, 'Equal-revision narrative divergence must surface conflict');
  });

  it('W2-D03: project deleted during async IDB read is not resurrected when validIdb becomes empty', async () => {
    const base = createSampleProject(FIXED_TS);
    const p1: CreativeProject = { ...structuredClone(base), id: 'proj_d03_doomed', revision: 2, persistedRevision: 2 };
    await saveProjectToIndexedDb(p1, { forceOverwrite: true });
    saveProjectToLocalStorage(p1, { forceOverwrite: true });

    let deletedInFlight = false;
    fakeIdb.afterReadAll = () => {
      if (!deletedInFlight) {
        deletedInFlight = true;
        void deleteProjectCompletely('proj_d03_doomed');
      }
    };

    const res = await reloadLatestProjectsFromStorage('proj_d03_doomed', {
      inMemoryActiveProject: p1,
      hasLocalEditsSinceMount: true,
      commit: (proj, opts) => persistProjectDurably(proj, opts),
    });
    assert.notEqual(res.idbStatus, 'read_error');
    assert.equal(res.projects.some((p) => p.id === 'proj_d03_doomed'), false);
    assert.notEqual(res.activeProject.id, 'proj_d03_doomed');
  });

  it('W2-D04: deleteProjectCompletely ignores corrupt sibling entry in localStorage and reports localDeleted: true', async () => {
    const base = createSampleProject(FIXED_TS);
    const good: CreativeProject = { ...structuredClone(base), id: 'proj_good', updatedAt: FIXED_TS + 10 };
    const doomed: CreativeProject = { ...structuredClone(base), id: 'proj_doomed', updatedAt: FIXED_TS + 20 };
    const rawMap = {
      proj_good: good,
      proj_doomed: doomed,
      corrupt_future: { id: 'corrupt_future', schemaVersion: 999 },
    };
    mockLocal.setItem(LOCAL_STORAGE_PROJECTS_KEY, JSON.stringify(rawMap));
    await saveProjectToIndexedDb(good, { forceOverwrite: true });
    await saveProjectToIndexedDb(doomed, { forceOverwrite: true });

    const delRes = await deleteProjectCompletely('proj_doomed');
    assert.equal(delRes.localDeleted, true);
    assert.equal(delRes.remaining.some((p) => p.id === 'proj_good'), true);
    const storedRaw = JSON.parse(mockLocal.getItem(LOCAL_STORAGE_PROJECTS_KEY)!) as Record<string, unknown>;
    assert.ok(storedRaw.corrupt_future, 'Corrupt sibling record must remain untouched');
  });

  it('W2-D06: normalizeSnapshotForComparison & isSnapshotSemanticallyEqual detect epistemicKind and sourceBacked differences', () => {
    const base = createSampleProject(FIXED_TS);
    const snapA = structuredClone(base.snapshot);
    snapA.storyBible.tone.epistemicKind = 'reported';

    const snapB = structuredClone(base.snapshot);
    snapB.storyBible.tone.epistemicKind = 'user-authored';

    assert.equal(isSnapshotSemanticallyEqual(snapA, snapB), false);
    assert.notEqual(computeSnapshotDigest(snapA), computeSnapshotDigest(snapB));

    const undoA = createUndoRedoState(snapA);
    const nextUndo = pushUndoableTransaction(undoA, snapB, 'Promote epistemic class');
    assert.equal(nextUndo.past.length, 1);

    const snapC = structuredClone(base.snapshot);
    snapC.entities[1].attributes[0].sourceBacked = true;
    assert.equal(isSnapshotSemanticallyEqual(base.snapshot, snapC), false);

    // undefined vs omitted property must remain equal
    const snapD = structuredClone(base.snapshot);
    snapD.storyBible.tone.epistemicKind = undefined;
    assert.equal(isSnapshotSemanticallyEqual(base.snapshot, snapD), true);
  });

  it('W2-D08: createSerializedProjectSaveQueue.resetProject invalidates in-flight revision tracking', async () => {
    const base = createSampleProject(FIXED_TS);
    const seenExpected: Array<number | undefined> = [];
    let releaseFirst!: () => void;
    const firstGate = new Promise<void>((r) => { releaseFirst = r; });

    const queue = createSerializedProjectSaveQueue(async (proj, opts) => {
      seenExpected.push(opts?.expectedPersistedRevision);
      if (seenExpected.length === 1) {
        await firstGate;
      }
      return { ok: true, saved: true, persistedRevision: proj.revision };
    });

    const p1 = { ...structuredClone(base), id: 'proj_q', revision: 2, persistedRevision: 1 };
    const save1 = queue.enqueue(p1);
    await new Promise((r) => setTimeout(r, 5));
    queue.resetProject('proj_q');
    releaseFirst();
    await save1;

    const p2 = { ...structuredClone(base), id: 'proj_q', revision: 2, persistedRevision: 1 };
    await queue.enqueue(p2);
    assert.equal(seenExpected[1], 1, 'Stale in-flight save before resetProject must not bump expectedPersistedRevision');
  });

  it('W2-D09: background analysis syncs undoHistory, reconcileAsync* respects tombstones, and onStart throw cleans up slot', async () => {
    const base = createSampleProject(FIXED_TS);
    const s1 = updateStoryBibleField(base.snapshot, 'tone', 'Tone 1', 'user-edit');
    const bgProj: CreativeProject = {
      ...structuredClone(base),
      id: 'proj_bg',
      revision: 2,
      snapshot: s1,
      undoHistory: { past: [{ label: 'Edit 1', snapshot: base.snapshot }], future: [] },
    };
    const activeProj: CreativeProject = { ...structuredClone(base), id: 'proj_active', revision: 1 };
    const ticket = createRequestTicket(bgProj, 'analyze');

    const completed = applyAsyncAnalysisCompletion({
      ticket,
      activeProject: activeProj,
      activeUndoState: createUndoRedoState(activeProj.snapshot),
      savedProjects: [activeProj, bgProj],
      newGraph: {
        prompt: s1.originalIdea,
        entities: [{ name: 'Owl', description: 'Night watch', alternatives: null, presence_in_prompt: false, attributes: [] }],
        relationships: [],
      },
      newClarifications: null,
    });
    assert.equal(completed.appliedToBackgroundProject, true);
    const updatedBg = completed.savedProjects.find((p) => p.id === 'proj_bg')!;
    assert.equal(updatedBg.undoHistory?.past.length, 2);
    const undone = performUndo(createUndoRedoStateFromProject(updatedBg));
    assert.equal(undone.state.present.entities.some((e) => e.name === 'Owl'), false);
    assert.equal(undone.state.present.storyBible.tone.value, 'Tone 1');

    // Reconcile tombstone checks
    recordDeletedProjectId('proj_bg');
    const tAnalysis = createRequestTicket(bgProj, 'analyze');
    const recAnalysis = reconcileAsyncAnalysisResponse({
      projects: [bgProj],
      undoMap: {},
      tickets: registerTicket({}, tAnalysis),
      ticket: tAnalysis,
      incomingGraph: null,
      incomingClarifications: [],
    });
    assert.notEqual(recAnalysis.status, 'applied');

    const tGen = createRequestTicket(bgProj, 'generate');
    const recGen = reconcileAsyncGenerationResponse({
      projects: [bgProj],
      tickets: registerTicket({}, tGen),
      ticket: tGen,
      mode: 'story',
      promptUsed: 'test',
      storyText: 'story',
    });
    assert.notEqual(recGen.status, 'applied');

    // onStart throw cleans up slot across all 3 slot runners
    const auth = createAiTicketAuthority();
    await assert.rejects(
      runAsyncGenerationSlot({
        authority: auth,
        originProject: activeProj,
        mode: 'story',
        promptUsed: 'p',
        getState: () => ({ activeProject: activeProj, savedProjects: [activeProj] }),
        commitState: () => {},
        generate: async () => ({ storyText: 'x' }),
        onStart: () => { throw new Error('boom'); },
        onError: () => {},
      }),
      /boom/
    );
    assert.equal(auth.isActionLoading(activeProj.id, 'generate'), false);

    await assert.rejects(
      runAsyncClarifySlot({
        authority: auth,
        originProject: activeProj,
        getState: () => ({ activeProject: activeProj, activeUndoState: createUndoRedoState(activeProj.snapshot), savedProjects: [activeProj] }),
        commitState: () => {},
        fetchClarifications: async () => [],
        onStart: () => { throw new Error('boom'); },
        onError: () => {},
      }),
      /boom/
    );
    assert.equal(auth.isActionLoading(activeProj.id, 'clarify'), false);

    await assert.rejects(
      runAsyncAnalysisSlot({
        authority: auth,
        originProject: activeProj,
        getState: () => ({ activeProject: activeProj, activeUndoState: createUndoRedoState(activeProj.snapshot), savedProjects: [activeProj] }),
        commitState: () => {},
        analyzeGraph: async () => ({ prompt: 'p', entities: [], relationships: [] }),
        fetchClarifications: async () => [],
        onStart: () => { throw new Error('boom'); },
        onAnalysisError: () => {},
        onClarificationError: () => {},
      }),
      /boom/
    );
    assert.equal(auth.isActionLoading(activeProj.id, 'analyze'), false);
  });

  it('W2-D10: mergeAnalysisIntoSnapshot does not mutate frozen incomingClarifications', () => {
    const snap = createSampleProject(FIXED_TS).snapshot;
    const frozenClar: Clarification = Object.freeze({
      id: 'clar_frozen',
      question: 'What color is the Cat hat?',
      options: Object.freeze(['Red', 'Blue']) as string[],
      target: Object.freeze({
        type: 'entity_attribute' as const,
        entityName: 'The Cat', // alias -> will be normalized to ent_cat / Cat
        attributeName: 'hat_color',
      }),
      category: 'character',
      impact: 'Visual detail',
      status: 'unanswered',
    });
    const frozenList = Object.freeze([frozenClar]) as unknown as Clarification[];
    const merged = mergeAnalysisIntoSnapshot(snap, null, frozenList);
    const added = merged.clarifications.find((c) => c.question === 'What color is the Cat hat?');
    assert.ok(added);
    assert.equal(added.target?.entityId, 'ent_cat');
    assert.equal(added.target?.entityName, 'Cat');
  });

  it('W2-D11: re-including an excluded entity removes its name from explicitExclusions while preserving manual exclusions', () => {
    let snap = createSampleProject(FIXED_TS).snapshot;
    snap = updateStoryBibleField(snap, 'explicitExclusions', 'spiders', 'user-edit');
    snap = setEntityExistence(snap, 'ent_fox', false, 'user-edit');
    assert.equal(snap.storyBible.explicitExclusions.value.includes('Fox'), true);
    assert.equal(snap.storyBible.explicitExclusions.value.includes('spiders'), true);

    snap = setEntityExistence(snap, 'ent_fox', true, 'user-edit');
    assert.equal(snap.storyBible.explicitExclusions.value.includes('Fox'), false);
    assert.equal(snap.storyBible.explicitExclusions.value.includes('spiders'), true);
    const exclIssues = evaluateProjectConsistency(snap).filter((i) => i.id === 'issue_excl_ent_fox');
    assert.equal(exclIssues.length, 0);
  });

  it('W2-D13: updateStoryBibleField propagates user-authored epistemic state to mirrored scene attributes so resolveProviderPrompt succeeds', () => {
    const base = createSampleProject(FIXED_TS);
    const snap = structuredClone(base.snapshot);
    snap.storyBible.tone = {
      value: 'Reported Tone',
      status: 'confirmed',
      provenance: 'imported',
      sourceBacked: true,
      epistemicKind: undefined,
      updatedAt: FIXED_TS,
    };
    const scene = snap.entities.find((e) => e.name === 'The Story')!;
    const toneAttr = scene.attributes.find((a) => a.name === 'tone')!;
    toneAttr.status = 'confirmed';
    toneAttr.confirmedValue = 'Reported Tone';
    toneAttr.provenance = 'imported';
    toneAttr.sourceBacked = true;
    toneAttr.epistemicKind = undefined;
    toneAttr.updatedAt = FIXED_TS;

    const updatedSnap = updateStoryBibleField(snap, 'tone', 'Warm Mystery', 'user-edit');
    const res = resolveProviderPrompt({ ...base, snapshot: updatedSnap }, 'story');
    assert.equal(res.ok, true);
    if (res.ok) {
      assert.equal(res.warning, undefined);
      assert.equal(res.prompt.includes('Warm Mystery'), true);
    }
  });

  it('W2-D14: nlBatchEngine detects rename-then-exclude conflict, simulates add/remove_relationship, and reports directed-relationship ambiguities', () => {
    let snap = createSampleProject(FIXED_TS).snapshot;
    // (a) rename bypass
    const renameExcludeOps: ProposedOperation[] = [
      { id: 'op_1', type: 'set_attribute', summary: 'Age', entityId: 'ent_cat', entityName: 'Cat', attributeName: 'age', nextValue: 'Young', selected: true },
      { id: 'op_2', type: 'rename_entity', summary: 'Rename', entityId: 'ent_cat', entityName: 'Cat', newEntityName: 'Whiskers', selected: true },
      { id: 'op_3', type: 'exclude_entity', summary: 'Exclude', entityName: 'Whiskers', selected: true },
    ];
    const conflictIssues = validateProposedOperations(snap, renameExcludeOps);
    assert.equal(conflictIssues.some((i) => i.code === 'CONFLICT'), true);

    // (b) add_relationship then remove_relationship in same batch
    const addRemoveRelOps: ProposedOperation[] = [
      { id: 'op_a', type: 'add_relationship', summary: 'Add', sourceEntityName: 'Cat', targetEntityName: 'Fox', nextValue: 'trusts', selected: true },
      { id: 'op_b', type: 'remove_relationship', summary: 'Remove', sourceEntityName: 'Cat', targetEntityName: 'Fox', selected: true },
    ];
    const relIssues = validateProposedOperations(snap, addRemoveRelOps);
    assert.equal(relIssues.length, 0);

    // (c) directedRelAsMatch / directedVerbMatch ambiguity reporting
    snap = addEntity(snap, 'Red Fox', 'character', 'Another fox', 'user-edit');
    const amb1 = interpretBatchInstructionLocally('Relate fox to cat as rival', snap);
    assert.equal(amb1.ambiguities.length, 1);
    assert.equal(amb1.ambiguities[0].candidates.includes('Fox'), true);
    assert.equal(amb1.ambiguities[0].candidates.includes('Red Fox'), true);

    const amb2 = interpretBatchInstructionLocally('Make fox distrust cat', snap);
    assert.equal(amb2.ambiguities.length, 1);
  });

  it('W2-D15: consistencyChecker detects symmetric trait conflicts and uses word boundaries for excluded entity mentions', () => {
    let snap = createSampleProject(FIXED_TS).snapshot;
    snap = addEntity(snap, 'Traveler', 'character', 'A young traveler from the hills', 'user-edit', { age: 'elderly' });
    const issues = evaluateProjectConsistency(snap);
    assert.equal(issues.some((i) => i.category === 'trait_conflict' && i.title.includes('Traveler')), true);

    snap = setEntityExistence(snap, 'ent_cat', false, 'user-edit');
    snap = updateStoryBibleField(snap, 'centralConflict', 'Scattered clues across the manor', 'user-edit');
    const issuesNoFalse = evaluateProjectConsistency(snap);
    assert.equal(issuesNoFalse.some((i) => i.id === 'issue_excl_conflict_ent_cat'), false);

    snap = updateStoryBibleField(snap, 'centralConflict', 'Cat steals the recipe', 'user-edit');
    const issuesRealMention = evaluateProjectConsistency(snap);
    assert.equal(issuesRealMention.some((i) => i.id === 'issue_excl_conflict_ent_cat'), true);
  });

  it('W2-D17: migrateProjectPayload preserves groupId, attr.updatedAt, sourceBacked, rel.presence_in_prompt, and rel.evidenceExcerpt', () => {
    const base = createSampleProject(FIXED_TS);
    const s4: CreativeProject = {
      ...structuredClone(base),
      schemaVersion: 4,
      snapshot: {
        ...structuredClone(base.snapshot),
        manuscriptVersionId: 'ver_1',
      },
      narrative: makeNarrativeEnvelope('Once upon a time'),
    };
    const rabbit = s4.snapshot.entities.find((e) => e.id === 'ent_rabbit')!;
    rabbit.groupId = 'group_animal_guests';
    rabbit.sourceBacked = true;
    rabbit.provenance = 'accepted-suggestion';
    rabbit.attributes[1].updatedAt = FIXED_TS + 123;
    rabbit.attributes[1].sourceBacked = true;
    rabbit.attributes[1].provenance = 'accepted-suggestion';
    s4.snapshot.relationships[0].sourceBacked = true;
    s4.snapshot.relationships[0].provenance = 'accepted-suggestion';
    s4.snapshot.relationships[0].presence_in_prompt = true;
    s4.snapshot.relationships[0].evidenceExcerpt = 'Cat welcomed Rabbit';

    const roundTripped = migrateProjectPayload(JSON.parse(JSON.stringify(s4)));
    const rtRabbit = roundTripped.snapshot.entities.find((e) => e.id === 'ent_rabbit')!;
    assert.equal(rtRabbit.groupId, 'group_animal_guests');
    assert.equal(rtRabbit.sourceBacked, true);
    assert.equal(rtRabbit.attributes[1].updatedAt, FIXED_TS + 123);
    assert.equal(rtRabbit.attributes[1].sourceBacked, true);
    assert.equal(roundTripped.snapshot.relationships[0].sourceBacked, true);
    assert.equal(roundTripped.snapshot.relationships[0].presence_in_prompt, true);
    assert.equal(roundTripped.snapshot.relationships[0].evidenceExcerpt, 'Cat welcomed Rabbit');
  });

  it('W6-D03: validateProposedOperations catches set_attribute -> rename_entity -> exclude_entity conflict on ID-less entities', () => {
    const snap = createSampleProject(FIXED_TS).snapshot;
    snap.entities.push({
      name: 'Stray',
      category: 'character',
      description: 'An entity without an id',
      presence_in_prompt: false,
      alternatives: null,
      attributes: [],
      status: 'confirmed',
    });

    const ops: ProposedOperation[] = [
      { id: 'op_attr', type: 'set_attribute', summary: 'Set trait', entityName: 'Stray', attributeName: 'mood', nextValue: 'Calm', selected: true },
      { id: 'op_ren', type: 'rename_entity', summary: 'Rename Stray', entityName: 'Stray', newEntityName: 'Wanderer', selected: true },
      { id: 'op_excl', type: 'exclude_entity', summary: 'Exclude Wanderer', entityName: 'Wanderer', selected: true },
    ];
    const issues = validateProposedOperations(snap, ops);
    assert.equal(issues.some((i) => i.code === 'CONFLICT'), true);
  });

  it('W6-D04: areSnapshotsSemanticallyEqual is independent of storyBible key insertion order', () => {
    const base = createSampleProject(FIXED_TS).snapshot;
    const snapA = structuredClone(base);
    const entries = Object.entries(base.storyBible);
    const reversedBible = Object.fromEntries([...entries].reverse()) as typeof base.storyBible;
    const snapB = { ...structuredClone(base), storyBible: reversedBible };

    assert.equal(areSnapshotsSemanticallyEqual(snapA, snapB), true);
    assert.equal(isSnapshotSemanticallyEqual(snapA, snapB), true);
  });

  it('W6-D03a: renaming an ID-less entity does not corrupt unrelated ID-less relationships', () => {
    const base = createSampleProject(FIXED_TS).snapshot;
    const snap = {
      ...structuredClone(base),
      entities: [
        {
          name: 'Elena',
          category: 'character' as const,
          description: 'ID-less traveler',
          presence_in_prompt: true,
          alternatives: null,
          attributes: [],
          status: 'confirmed' as const,
        },
        {
          name: 'Viktor',
          category: 'character' as const,
          description: 'ID-less guard',
          presence_in_prompt: true,
          alternatives: null,
          attributes: [],
          status: 'confirmed' as const,
        },
        {
          name: 'Harbor',
          category: 'location' as const,
          description: 'ID-less port',
          presence_in_prompt: true,
          alternatives: null,
          attributes: [],
          status: 'confirmed' as const,
        },
      ],
      relationships: [
        { source: 'Viktor', target: 'Harbor', label: 'guards', status: 'confirmed' as const },
        { source: 'Elena', target: 'Harbor', label: 'visits', status: 'confirmed' as const },
      ],
    };

    const issues = validateProposedOperations(snap, [
      { id: 'op1', type: 'rename_entity', summary: 'Rename Elena', entityName: 'Elena', newEntityName: 'Helena', selected: true },
      { id: 'op2', type: 'remove_relationship', summary: 'Remove Viktor->Harbor', sourceEntityName: 'Viktor', targetEntityName: 'Harbor', selected: true },
      { id: 'op3', type: 'remove_relationship', summary: 'Remove Helena->Harbor', sourceEntityName: 'Helena', targetEntityName: 'Harbor', selected: true },
    ]);
    assert.deepEqual(issues, []);
  });

  it('W6-D03b: reverse order exclude_entity -> set_attribute emits CONFLICT while pre-excluded snapshot entity emits MISSING_TARGET', () => {
    const snap = createSampleProject(FIXED_TS).snapshot;
    snap.entities.push({
      name: 'Elena',
      category: 'character',
      description: 'Active ID-less character',
      presence_in_prompt: true,
      alternatives: null,
      attributes: [],
      status: 'confirmed',
    });
    snap.entities.push({
      name: 'Ghost',
      category: 'character',
      description: 'Already excluded character',
      presence_in_prompt: false,
      alternatives: null,
      attributes: [],
      excluded: true,
      status: 'confirmed',
    });

    const reverseIssues = validateProposedOperations(snap, [
      { id: 'op1', type: 'exclude_entity', summary: 'Exclude Elena', entityName: 'Elena', selected: true },
      { id: 'op2', type: 'set_attribute', summary: 'Set Elena mood', entityName: 'Elena', attributeName: 'mood', nextValue: 'tense', selected: true },
    ]);
    assert.equal(reverseIssues.length, 1);
    assert.equal(reverseIssues[0].operationId, 'op2');
    assert.equal(reverseIssues[0].code, 'CONFLICT');

    const preExcludedIssues = validateProposedOperations(snap, [
      { id: 'op3', type: 'set_attribute', summary: 'Set Ghost mood', entityName: 'Ghost', attributeName: 'mood', nextValue: 'calm', selected: true },
    ]);
    assert.equal(preExcludedIssues.length, 1);
    assert.equal(preExcludedIssues[0].operationId, 'op3');
    assert.equal(preExcludedIssues[0].code, 'MISSING_TARGET');
  });
});
