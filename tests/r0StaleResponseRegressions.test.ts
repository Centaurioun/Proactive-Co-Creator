/**
 * Deterministic regression tests for R0-A (Import Stage 2 request/source identity),
 * R0-B (Same-slot asynchronous AI completion), and R3 (mixed Review Diff characterization).
 * Zero live Gemini API calls — all transports use deterministic deferred promises.
 */

import assert from 'node:assert/strict';
import test from 'node:test';
import {
  attachAcceptedStage2Opportunities,
  createStage2EnhancementController,
  type Stage2SourceIdentity,
} from '../lib/narrative/import/stage2Enhancements.ts';
import {
  applyGuardedAsyncAnalysisCompletion,
  applyGuardedAsyncGenerationCompletion,
  buildReviewDiffModel,
  createAiTicketAuthority,
  createPolishProposal,
  runAsyncAnalysisSlot,
  runAsyncClarifySlot,
  runAsyncGenerationSlot,
} from '../lib/projectController.ts';
import { createSampleProject, updateStoryBibleField } from '../lib/canonicalModel.ts';
import { createUndoRedoState } from '../lib/historyEngine.ts';
import { recordDeletedProjectId, clearDeletedProjectId } from '../lib/storageEngine.ts';
import { ensureNarrativeEnvelope } from '../lib/narrative/diagnostics/engine.ts';
import type {
  ImportEnhanceRequest,
  ImportEnhanceResponse,
  ImportEnhancementProposal,
} from '../shared/narrativeAiSchemas.ts';
import type {
  BatchEditProposalResult,
  BeliefState,
  Clarification,
  CreativeProject,
} from '../shared/types.ts';

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

const makeProposal = (id: string, title: string): ImportEnhancementProposal => ({
  id,
  category: 'pacing',
  title,
  rationale: `Rationale for ${title}`,
  beforeExcerpt: 'Before text',
  afterExcerpt: `After text for ${title}`,
  assumptions: ['Assumes author prefers tighter pacing'],
});

const makeEnhanceRequest = (filename: string): ImportEnhanceRequest => ({
  filename,
  sourceTextExcerpt: `Excerpt for ${filename}`,
  entities: [{ name: 'Hero', category: 'character' }],
  sections: [{ title: 'Chapter 1', excerpt: `Opening of ${filename}` }],
});

const makeEmptyNarrativeProject = (id: string): CreativeProject =>
  ensureNarrativeEnvelope({
    ...createSampleProject(),
    id,
  });

// ============================================================================
// R0-A: Import Stage 2 request/source identity
// ============================================================================

test('R0-A: late Stage 2 response from Source A cannot contaminate Source B even when transport ignores abort', async () => {
  const ctrl = createStage2EnhancementController();
  const sourceA: Stage2SourceIdentity = { sourceId: 'src-A', sourceVersion: 'v1', digest: 'a'.repeat(64) };
  const sourceB: Stage2SourceIdentity = { sourceId: 'src-B', sourceVersion: 'v1', digest: 'b'.repeat(64) };

  const reqA = deferred<ImportEnhanceResponse>();
  let signalA: AbortSignal | undefined;

  ctrl.setActiveSource(sourceA);
  const runA = ctrl.run({
    request: makeEnhanceRequest('source-a.txt'),
    aiConfigured: true,
    identity: sourceA,
    transport: (_payload, signal) => {
      signalA = signal;
      return reqA.promise; // Deliberately ignores signal abort
    },
  });

  assert.equal(ctrl.getState().busy, true);

  // User resets/replaces source with Source B while A is pending
  ctrl.setActiveSource(sourceB);
  assert.equal(signalA?.aborted, true, 'Previous Stage 2 transport signal must be aborted on source switch');
  assert.equal(ctrl.getState().busy, false);

  // Resolve Source A late
  reqA.resolve({ proposals: [makeProposal('enh_from_A', 'Source A Proposal')], coverageNote: 'Full mock coverage' });
  const applied = await runA;

  assert.equal(applied, false);
  assert.equal(ctrl.getState().proposals.length, 0);
  assert.equal(ctrl.getState().batch, null);
  assert.equal(ctrl.getState().acceptedIds.size, 0);

  // Attempting to accept A's ID or assemble B must yield zero opportunities
  ctrl.toggleAccepted('enh_from_A', true);
  assert.equal(ctrl.getState().acceptedIds.size, 0);

  const assembledB = makeEmptyNarrativeProject('proj_B');
  attachAcceptedStage2Opportunities(
    assembledB,
    ctrl.getValidatedAcceptedProposals(sourceB),
    sourceB.sourceId,
    1000
  );
  assert.equal((assembledB.narrative?.opportunities ?? []).length, 0);
});

test('R0-A: same-source supersession (A1 -> A2), stale error/finally cannot clobber A2, and batch replacement clears approvals', async () => {
  const ctrl = createStage2EnhancementController();
  const sourceA: Stage2SourceIdentity = { sourceId: 'src-A', sourceVersion: 'v1', digest: 'a'.repeat(64) };
  ctrl.setActiveSource(sourceA);

  const reqA1 = deferred<ImportEnhanceResponse>();
  const reqA2 = deferred<ImportEnhanceResponse>();

  const runA1 = ctrl.run({
    request: makeEnhanceRequest('source-a-v1.txt'),
    aiConfigured: true,
    identity: sourceA,
    transport: () => reqA1.promise, // ignores abort
  });

  // Supersede with A2 while A1 is still pending
  const runA2 = ctrl.run({
    request: makeEnhanceRequest('source-a-v2.txt'),
    aiConfigured: true,
    identity: sourceA,
    transport: () => reqA2.promise,
  });

  assert.equal(ctrl.getState().busy, true);

  // A1 fails late while A2 is still running — must NOT clear A2's busy or set A2's error
  reqA1.reject(new Error('Stale A1 failure'));
  await runA1;
  assert.equal(ctrl.getState().busy, true, 'Stale A1 finally/catch must not clear A2 busy');
  assert.equal(ctrl.getState().error, '', 'Stale A1 error must not overwrite A2 error');

  // Now A2 resolves cleanly
  reqA2.resolve({ proposals: [makeProposal('enh_A2', 'Fresh A2 Proposal')], coverageNote: 'Full mock coverage' });
  const ok2 = await runA2;
  assert.equal(ok2, true);
  assert.equal(ctrl.getState().busy, false);
  assert.deepEqual(ctrl.getState().proposals.map((p) => p.id), ['enh_A2']);

  // Approve A2 proposal, then run A3 which replaces batch -> approvals must be cleared
  ctrl.toggleAccepted('enh_A2', true);
  assert.equal(ctrl.getState().acceptedIds.has('enh_A2'), true);

  const reqA3 = deferred<ImportEnhanceResponse>();
  const runA3 = ctrl.run({
    request: makeEnhanceRequest('source-a-v3.txt'),
    aiConfigured: true,
    identity: sourceA,
    transport: () => reqA3.promise,
  });
  reqA3.resolve({ proposals: [makeProposal('enh_A3', 'Third Proposal')], coverageNote: 'Full mock coverage' });
  await runA3;

  assert.equal(ctrl.getState().acceptedIds.size, 0, 'Replacing batch must clear prior approvals');
  assert.deepEqual(ctrl.getState().proposals.map((p) => p.id), ['enh_A3']);
});

test('R0-A: cancellation, configuration invalidation, and unmount dispose suppress late responses', async () => {
  const emissions: number[] = [];
  const ctrl = createStage2EnhancementController(() => emissions.push(1));
  const sourceA: Stage2SourceIdentity = { sourceId: 'src-A', sourceVersion: 'v1', digest: 'a'.repeat(64) };
  ctrl.setActiveSource(sourceA);

  // Explicit cancellation / config reset invalidation
  const req1 = deferred<ImportEnhanceResponse>();
  const run1 = ctrl.run({
    request: makeEnhanceRequest('source-a.txt'),
    aiConfigured: true,
    identity: sourceA,
    transport: () => req1.promise,
  });
  ctrl.invalidate();
  req1.resolve({ proposals: [makeProposal('enh_cancelled', 'Cancelled')], coverageNote: 'Full mock coverage' });
  await run1;
  assert.equal(ctrl.getState().proposals.length, 0);

  // Unmount dispose
  const req2 = deferred<ImportEnhanceResponse>();
  const run2 = ctrl.run({
    request: makeEnhanceRequest('source-a.txt'),
    aiConfigured: true,
    identity: sourceA,
    transport: () => req2.promise,
  });
  const emissionsBeforeDispose = emissions.length;
  ctrl.dispose();
  req2.resolve({ proposals: [makeProposal('enh_unmounted', 'After Unmount')], coverageNote: 'Full mock coverage' });
  await run2;
  assert.equal(emissions.length, emissionsBeforeDispose, 'Disposed controller must not emit post-unmount updates');
});

test('R0-A control: valid current-source Stage 2 approval attaches tracked pending opportunity with exact sourceId and provenance', async () => {
  const ctrl = createStage2EnhancementController();
  const sourceA: Stage2SourceIdentity = { sourceId: 'src-valid-1', sourceVersion: 'v1', digest: 'c'.repeat(64) };
  const wrongDigest: Stage2SourceIdentity = { sourceId: 'src-valid-1', sourceVersion: 'v1', digest: 'd'.repeat(64) };

  ctrl.setActiveSource(sourceA);
  const ok = await ctrl.run({
    request: makeEnhanceRequest('valid.txt'),
    aiConfigured: true,
    identity: sourceA,
    transport: async () => ({
      proposals: [makeProposal('enh_valid_1', 'Tighten chapter opening')],
      coverageNote: 'Full mock coverage',
    }),
  });
  assert.equal(ok, true);
  ctrl.toggleAccepted('enh_valid_1', true);

  // Digest mismatch must reject attachment
  assert.equal(ctrl.getValidatedAcceptedProposals(wrongDigest).length, 0);

  // Exact identity matches and attaches as tracked pending opportunity (not confirmed fact)
  const selected = ctrl.getValidatedAcceptedProposals(sourceA);
  assert.equal(selected.length, 1);

  const assembled = makeEmptyNarrativeProject('proj_valid');
  attachAcceptedStage2Opportunities(assembled, selected, sourceA.sourceId, 5000);
  const opps = assembled.narrative?.opportunities ?? [];
  assert.equal(opps.length, 1);
  const opp = opps[0];
  assert.equal(opp.status, 'pending');
  assert.equal(opp.origin, 'ai');
  assert.deepEqual(opp.sourceRefs, ['src-valid-1']);
  assert.ok(opp.description.includes('Tighten chapter opening'));
});

// ============================================================================
// R0-B: Same-slot asynchronous AI completion (production coordinator seam)
// ============================================================================

test('R0-B: analyze slot (2 parallel branches) supersedes A when B starts; late A result/error/finally cannot clobber B', async () => {
  const authority = createAiTicketAuthority();
  let activeProject = { ...createSampleProject(), id: 'proj_analyze', revision: 1 };
  let activeUndoState = createUndoRedoState(activeProject.snapshot);
  let savedProjects = [activeProject];

  const analysisErrors: Record<string, string | null> = {};
  const clarificationErrors: Record<string, string | null> = {};

  const graphA = deferred<BeliefState>();
  const clarA = deferred<Clarification[]>();
  const graphB = deferred<BeliefState>();
  const clarB = deferred<Clarification[]>();

  let signalA: AbortSignal | undefined;

  const runA = runAsyncAnalysisSlot({
    authority,
    originProject: activeProject,
    getState: () => ({ activeProject, activeUndoState, savedProjects }),
    commitState: (res) => {
      activeProject = res.activeProject;
      activeUndoState = res.activeUndoState;
      savedProjects = res.savedProjects;
    },
    analyzeGraph: (sig) => {
      signalA = sig;
      return graphA.promise; // ignores abort
    },
    fetchClarifications: () => clarA.promise, // ignores abort
    onAnalysisError: (id, err) => {
      analysisErrors[id] = String(err);
    },
    onClarificationError: (id, err) => {
      clarificationErrors[id] = String(err);
    },
  });

  // Start B in the same (projectId, analyze) slot while A is still pending
  const runB = runAsyncAnalysisSlot({
    authority,
    originProject: activeProject,
    getState: () => ({ activeProject, activeUndoState, savedProjects }),
    commitState: (res) => {
      activeProject = res.activeProject;
      activeUndoState = res.activeUndoState;
      savedProjects = res.savedProjects;
    },
    analyzeGraph: () => graphB.promise,
    fetchClarifications: () => clarB.promise,
    onAnalysisError: (id, err) => {
      analysisErrors[id] = String(err);
    },
    onClarificationError: (id, err) => {
      clarificationErrors[id] = String(err);
    },
  });

  assert.equal(signalA?.aborted, true, 'Request B must abort Request A signal');
  assert.equal(authority.isActionLoading('proj_analyze', 'analyze'), true);

  // Resolve A's clarification branch with an error while B is still loading — must NOT set error or clear loading!
  clarA.reject(new Error('Stale A clarification branch error'));
  graphA.resolve({
    prompt: activeProject.snapshot.originalIdea,
    entities: [{ name: 'StaleEntityA', category: 'character', presence_in_prompt: true, description: 'Stale', alternatives: [], attributes: [] }],
    relationships: [],
  });
  const resA = await runA;
  assert.equal(resA?.superseded, true);
  assert.equal(authority.isActionLoading('proj_analyze', 'analyze'), true, 'Stale A finally must NOT clear B loading');
  assert.equal(clarificationErrors['proj_analyze'], undefined, 'Stale A branch error must NOT overwrite B errors');
  assert.equal(activeProject.snapshot.entities.some((e) => e.name === 'StaleEntityA'), false);

  // Now resolve B
  graphB.resolve({
    prompt: activeProject.snapshot.originalIdea,
    entities: [{ name: 'FreshEntityB', category: 'character', presence_in_prompt: true, description: 'Fresh', alternatives: [], attributes: [] }],
    relationships: [],
  });
  clarB.resolve([{ question: 'Question from B?', options: ['Opt 1', 'Opt 2'] }]);
  const resB = await runB;
  assert.equal(resB?.appliedToActive, true);
  assert.equal(authority.isActionLoading('proj_analyze', 'analyze'), false);
  assert.equal(activeProject.snapshot.entities.some((e) => e.name === 'FreshEntityB'), true);
  assert.equal(activeProject.snapshot.entities.some((e) => e.name === 'StaleEntityA'), false);
});

test('R0-B: clarify and generate (story & image) slots reject superseded responses resolving after B', async () => {
  const authority = createAiTicketAuthority();
  let activeProject = { ...createSampleProject(), id: 'proj_slots', revision: 1 };
  let activeUndoState = createUndoRedoState(activeProject.snapshot);
  let savedProjects = [activeProject];
  const errors: string[] = [];

  // Clarify A then B; B resolves first, A resolves late
  const clarA = deferred<Clarification[]>();
  const clarB = deferred<Clarification[]>();

  const runClarA = runAsyncClarifySlot({
    authority,
    originProject: activeProject,
    getState: () => ({ activeProject, activeUndoState, savedProjects }),
    commitState: (res) => {
      activeProject = res.activeProject;
      activeUndoState = res.activeUndoState;
      savedProjects = res.savedProjects;
    },
    fetchClarifications: () => clarA.promise,
    onError: (_id, err) => errors.push(`clarA:${String(err)}`),
  });

  const runClarB = runAsyncClarifySlot({
    authority,
    originProject: activeProject,
    getState: () => ({ activeProject, activeUndoState, savedProjects }),
    commitState: (res) => {
      activeProject = res.activeProject;
      activeUndoState = res.activeUndoState;
      savedProjects = res.savedProjects;
    },
    fetchClarifications: () => clarB.promise,
    onError: (_id, err) => errors.push(`clarB:${String(err)}`),
  });

  clarB.resolve([{ question: 'Which lantern guides the harbor?', options: ['Brass', 'Glass'] }]);
  await runClarB;
  clarA.resolve([{ question: 'Stale question from A?', options: ['Old'] }]);
  const lateClarA = await runClarA;

  assert.equal(lateClarA?.superseded, true);
  assert.equal(
    activeProject.snapshot.clarifications.some((c) => c.question === 'Which lantern guides the harbor?'),
    true
  );
  assert.equal(
    activeProject.snapshot.clarifications.some((c) => c.question === 'Stale question from A?'),
    false
  );

  // Generate (story A superseded by image B); B resolves first, A resolves late
  const genA = deferred<{ storyText?: string }>();
  const genB = deferred<{ images?: string[]; warning?: string | null }>();

  const runGenA = runAsyncGenerationSlot({
    authority,
    originProject: activeProject,
    mode: 'story',
    promptUsed: activeProject.snapshot.refinedPrompt,
    getState: () => ({ activeProject, savedProjects }),
    commitState: (res) => {
      activeProject = res.activeProject;
      savedProjects = res.savedProjects;
    },
    generate: () => genA.promise,
    onError: (_id, _mode, err) => errors.push(`genA:${String(err)}`),
  });

  const runGenB = runAsyncGenerationSlot({
    authority,
    originProject: activeProject,
    mode: 'image',
    promptUsed: activeProject.snapshot.refinedPrompt,
    getState: () => ({ activeProject, savedProjects }),
    commitState: (res) => {
      activeProject = res.activeProject;
      savedProjects = res.savedProjects;
    },
    generate: () => genB.promise,
    onError: (_id, _mode, err) => errors.push(`genB:${String(err)}`),
  });

  genB.resolve({ images: ['data:image/png;base64,FRESH_B'], warning: null });
  await runGenB;
  genA.resolve({ storyText: 'STALE STORY A' });
  const lateGenA = await runGenA;

  assert.equal(lateGenA?.superseded, true);
  assert.equal(activeProject.artifacts.some((a) => a.images?.[0] === 'data:image/png;base64,FRESH_B'), true);
  assert.equal(activeProject.artifacts.some((a) => a.storyText === 'STALE STORY A'), false);
  assert.deepEqual(errors, []);
});

test('R0-B: background project response after switch still applies, deleted project is blocked, and rebased/outdated policy is preserved', async () => {
  const authority = createAiTicketAuthority();
  const projA = { ...createSampleProject(), id: 'proj_bg_A', name: 'Alpha', revision: 1 };
  const projB = { ...createSampleProject(), id: 'proj_bg_B', name: 'Beta', revision: 1 };
  const projDel = { ...createSampleProject(), id: 'proj_deleted_r0b', name: 'Doomed', revision: 1 };

  let activeProject = projA;
  let savedProjects = [projA, projB, projDel];

  // 1. Start generation on Project A and analyze on Project A (different slots stay independent)
  const genBgA = deferred<{ storyText?: string }>();
  const runGenBgA = runAsyncGenerationSlot({
    authority,
    originProject: projA,
    mode: 'story',
    promptUsed: projA.snapshot.refinedPrompt,
    getState: () => ({ activeProject, savedProjects }),
    commitState: (res) => {
      activeProject = res.activeProject;
      savedProjects = res.savedProjects;
    },
    generate: () => genBgA.promise,
    onError: () => assert.fail('Should not error'),
  });

  // 2. User edits Project A before switching to Project B so projA advances to revision 2 (prompt changes!)
  const editedSnapA = updateStoryBibleField(
    projA.snapshot,
    'tone',
    'stormy nocturnal tension'
  );
  assert.notEqual(editedSnapA.refinedPrompt, projA.snapshot.refinedPrompt);
  const projAEdited: CreativeProject = {
    ...projA,
    revision: 2,
    snapshot: editedSnapA,
  };
  savedProjects = [projAEdited, projB, projDel];
  // Switch active project to B — do NOT cancel A's in-flight request!
  activeProject = projB;
  const activeUndoState = createUndoRedoState(projB.snapshot);

  // Resolve A's still-current generation in the background
  genBgA.resolve({ storyText: 'Background story generated from rev 1' });
  const bgResult = await runGenBgA;

  assert.equal(bgResult?.superseded, false);
  assert.equal(bgResult?.appliedToBackgroundProject, true);
  assert.equal(bgResult?.appliedToActive, false);
  assert.equal(activeProject.id, 'proj_bg_B', 'Active project B must remain untouched');
  assert.equal(activeProject.artifacts.length, 0, 'Project A artifact must not bleed into Project B');

  const updatedA = savedProjects.find((p) => p.id === 'proj_bg_A')!;
  assert.equal(updatedA.artifacts.length, 1);
  assert.equal(updatedA.artifacts[0].storyText, 'Background story generated from rev 1');
  assert.equal(
    updatedA.artifacts[0].isOutdated,
    true,
    'Artifact generated against older prompt must be preserved and tagged isOutdated=true'
  );

  // 3. Rebase policy for still-current analyze request onto newer edits
  const analyzeRebase = deferred<BeliefState>();
  let rebasedNotified = false;
  const runRebase = runAsyncAnalysisSlot({
    authority,
    originProject: projA, // baseRevision 1
    getState: () => ({ activeProject: projAEdited, activeUndoState: createUndoRedoState(projAEdited.snapshot), savedProjects }),
    commitState: (res) => {
      savedProjects = res.savedProjects;
    },
    analyzeGraph: () => analyzeRebase.promise,
    fetchClarifications: async () => [],
    onAnalysisError: () => assert.fail('Should not error'),
    onClarificationError: () => assert.fail('Should not error'),
    onRebased: () => {
      rebasedNotified = true;
    },
  });
  analyzeRebase.resolve({
    prompt: projA.snapshot.originalIdea,
    entities: [{ name: 'RebasedOwl', category: 'character', presence_in_prompt: true, description: 'Owl', alternatives: [], attributes: [] }],
    relationships: [],
  });
  const rebaseRes = await runRebase;
  assert.equal(rebaseRes?.rebasedOntoNewerRevision, true);
  assert.equal(rebasedNotified, true);

  // 4. Deleted project guard blocks late response even if ticket was started before deletion
  const delTicket = authority.beginSlot(projDel, 'analyze').ticket;
  recordDeletedProjectId(projDel.id);
  try {
    const resDel = applyGuardedAsyncAnalysisCompletion({
      ticket: delTicket,
      tickets: authority.getTickets(),
      activeProject,
      activeUndoState,
      savedProjects,
      newGraph: {
        prompt: 'x',
        entities: [{ name: 'Ghost', category: 'character', presence_in_prompt: true, description: 'Ghost', alternatives: [], attributes: [] }],
        relationships: [],
      },
      newClarifications: null,
    });
    assert.equal(resDel.appliedToActive, false);
    assert.equal(resDel.appliedToBackgroundProject, false);
    assert.equal(resDel.savedProjects.some((p) => p.id === projDel.id), false);

    const genDelTicket = authority.beginSlot(projDel, 'generate').ticket;
    const resGenDel = applyGuardedAsyncGenerationCompletion({
      ticket: genDelTicket,
      tickets: authority.getTickets(),
      activeProject,
      savedProjects,
      mode: 'story',
      promptUsed: 'x',
      storyText: 'Ghost story',
    });
    assert.equal(resGenDel.artifact, null);
    assert.equal(resGenDel.savedProjects.some((p) => p.id === projDel.id), false);
  } finally {
    clearDeletedProjectId(projDel.id);
    authority.invalidateProject(projDel.id);
  }
});

// ============================================================================
// R3 Characterization: buildReviewDiffModel mixed decisions + batch + polish
// ============================================================================

test('R3: buildReviewDiffModel preserves exact ordering, staleness, and prompt precedence across decisions, batch, and AI polish', () => {
  const proj = { ...createSampleProject(), id: 'proj_diff', revision: 2 };
  const firstPending = proj.snapshot.decisions.find((d) => d.status === 'pending');
  const polish = createPolishProposal(proj, 'A richly polished literary narrative prompt.', 1000);

  // Case 1: polish alone (no pending decisions selected, no staged batch) overrides afterPrompt
  const noDecisionsProj: CreativeProject = {
    ...proj,
    snapshot: {
      ...proj.snapshot,
      decisions: proj.snapshot.decisions.map((d) => ({ ...d, status: 'accepted' as const })),
    },
  };
  const polishOnly = buildReviewDiffModel({
    project: noDecisionsProj,
    polishProposal: polish,
  });
  assert.equal(polishOnly.items.length, 1);
  assert.equal(polishOnly.items[0].source, 'ai-polish');
  assert.equal(polishOnly.afterPrompt, 'A richly polished literary narrative prompt.');

  // Case 2: mixed pending decision + stale staged batch + polish preserves item order
  // (decision -> batch -> polish) and keeps synthesized prompt (polish does not override when decisions/batch exist)
  const staleBatch: BatchEditProposalResult = {
    proposalId: 'prop_stale',
    instruction: 'Change mood',
    baseProjectId: proj.id,
    baseRevision: 1, // stale relative to proj.revision === 2
    coverageComplete: true,
    ambiguities: [],
    warnings: [],
    operations: [
      {
        id: 'op_1',
        type: 'update_story_bible',
        storyField: 'tone',
        previousValue: 'whimsical',
        nextValue: 'melancholic',
        selected: true,
        summary: 'Set tone to melancholic',
      },
    ],
  };

  const mixed = buildReviewDiffModel({
    project: proj,
    selectedDecisionIds: firstPending ? [firstPending.id] : undefined,
    stagedBatch: staleBatch,
    polishProposal: polish,
  });

  assert.equal(mixed.hasStaleBatch, true);
  assert.equal(mixed.hasChanges, true);
  const sources = mixed.items.map((item) => item.source);
  if (firstPending) {
    assert.deepEqual(sources, ['decision', 'batch-preview', 'ai-polish']);
  } else {
    assert.deepEqual(sources, ['batch-preview', 'ai-polish']);
  }
  const batchItem = mixed.items.find((i) => i.source === 'batch-preview')!;
  assert.match(batchItem.conflictWarning ?? '', /Stale batch preview/);
  assert.notEqual(
    mixed.afterPrompt,
    'A richly polished literary narrative prompt.',
    'Polish preview must not override synthesized prompt when staged batch or decisions are present'
  );
});
