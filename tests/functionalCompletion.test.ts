/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { afterEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import express from 'express';
import { strToU8, unzipSync, zipSync } from 'fflate';
import { createSampleProject, makeStableId } from '../lib/canonicalModel.ts';
import { computeSnapshotDigest, createUndoRedoState } from '../lib/historyEngine.ts';
import {
  LOCAL_STORAGE_PROJECTS_KEY,
  migrateProjectPayload,
  reconcileHydratedProjects,
  saveProjectToLocalStorage,
} from '../lib/storageEngine.ts';
import {
  acquireAiSlot,
  evaluateOperationBudget,
  resetAiSlotsForTests,
} from '../server/aiBudget.ts';
import { createApiRouter, type AiServiceHandlers } from '../server/routes.ts';
import {
  applyDiagnosticFixAlternative,
  buildLocalFixAlternatives,
  collectLocalDiagnosticFindings,
  ensureNarrativeEnvelope,
  splitReadinessAndIssues,
  syncDiagnosticFindingsIntoProject,
} from '../lib/narrative/diagnostics/engine.ts';
import { transitionIssue } from '../lib/narrative/issueRegistry.ts';
import { diagnosticFingerprint } from '../lib/narrative/diagnostics/findings.ts';
import { narrativeBase, prepareManuscriptChange } from '../lib/narrative/manuscriptModel.ts';
import {
  applyManuscriptSyncPatch,
  applyModelSyncProposal,
  computeSyncFreshness,
  validateManuscriptPatchBinding,
} from '../lib/narrative/sync/syncProposals.ts';
import {
  applyWritingSelectionEdit,
  computeTextDigest,
  extractConfirmedWritingContext,
  validateTextSelection,
} from '../lib/narrative/writing/selectionHelpers.ts';
import {
  buildCharacterEgoNetwork,
  buildVerifiedKinshipProjection,
  validateExploredOpportunities,
} from '../lib/narrative/projections/kinshipProjection.ts';
import {
  buildDeterministicExportFilename,
  buildManuscriptDocxBytes,
} from '../lib/narrative/recovery/docxExport.ts';
import { parseNarrativeSource } from '../lib/narrative/import/sourceParser.ts';
import {
  buildAllProjectsArchiveZip,
  parseAndVerifyAllProjectsArchive,
  restoreArchiveProjectsSequentially,
} from '../lib/narrative/recovery/allProjectsArchive.ts';
import {
  applyAppendToExistingProject,
  detectDuplicateSourceInProject,
  findCrossProjectIdentityMatches,
} from '../lib/narrative/import/appendApply.ts';
import { validateNarrativeRecords } from '../lib/narrative/evidenceRegistry.ts';
import type { CreativeProject, Entity, Relationship } from '../shared/types.ts';

function installMockLocalStorage() {
  const store = new Map<string, string>();
  const mockLocalStorage = {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => {
      store.set(k, v);
    },
    removeItem: (k: string) => {
      store.delete(k);
    },
    clear: () => store.clear(),
  };
  (globalThis as unknown as { window?: unknown }).window = {
    localStorage: mockLocalStorage,
  };
  return store;
}

function makeProjectWithManuscript(name = 'Test Novel', sectionText = 'Mara walked across the bridge in silence.') {
  let proj = ensureNarrativeEnvelope(createSampleProject());
  proj = { ...proj, id: makeStableId('proj_test'), name };
  const undo = createUndoRedoState(proj.snapshot, proj.revisions, proj.undoHistory);
  const prepared = prepareManuscriptChange(proj, undo, narrativeBase(proj), [
    {
      id: makeStableId('sec'),
      kind: 'scene',
      title: 'Chapter 1: Bridge Crossing',
      text: sectionText,
    },
  ]);
  assert.ok(prepared, 'expected manuscript initialization to succeed');
  return prepared;
}

function createStubHandlers(overrides: Partial<AiServiceHandlers> = {}): AiServiceHandlers {
  return {
    analyzeBeliefGraph: async () => ({ prompt: 'test', entities: [], relationships: [] }),
    generateClarificationsList: async () => [],
    refinePromptText: async (orig) => orig,
    generateStoryText: async () => 'story',
    generateImagesBatch: async () => ({ images: [], requestedCount: 0, failedCount: 0, warning: null }),
    hasConfiguredGeminiKey: () => false,
    ...overrides,
  };
}

async function startTestServer(handlers: AiServiceHandlers) {
  const app = express();
  app.use(express.json());
  app.use('/api', createApiRouter(handlers));
  const server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Failed to bind server');
  return {
    baseUrl: `http://127.0.0.1:${address.port}`,
    close: () => new Promise<void>((resolve, reject) => server.close((e) => (e ? reject(e) : resolve()))),
  };
}

describe('Package A — Storage conflict root-cause fix, CAS preconditions, and idempotency', () => {
  afterEach(() => {
    delete (globalThis as unknown as { window?: unknown }).window;
  });

  it('does not false-conflict when stored r1 payload is unmigrated and candidate r1 is migrated', () => {
    const store = installMockLocalStorage();
    const base = createSampleProject();
    const rawUnmigrated = {
      ...structuredClone(base),
      snapshot: {
        ...structuredClone(base.snapshot),
        refinedPrompt: '',
        decisions: [],
      },
    };
    store.set(LOCAL_STORAGE_PROJECTS_KEY, JSON.stringify({ [base.id]: rawUnmigrated }));

    const migrated = migrateProjectPayload(rawUnmigrated);
    const res = saveProjectToLocalStorage(
      { ...migrated, updatedAt: base.updatedAt + 10 },
      { expectedPersistedRevision: 1 }
    );
    assert.equal(res.ok, true, 'raw-vs-migrated r1 must not trigger a false conflict');
    assert.equal(res.conflictDetected, undefined);
  });

  it('still fails closed on genuinely divergent r1 snapshots', () => {
    const store = installMockLocalStorage();
    const base = createSampleProject();
    store.set(LOCAL_STORAGE_PROJECTS_KEY, JSON.stringify({ [base.id]: base }));

    const divergent: CreativeProject = {
      ...structuredClone(base),
      revision: 1,
      persistedRevision: 1,
      updatedAt: base.updatedAt + 50,
      snapshot: {
        ...structuredClone(base.snapshot),
        originalIdea: 'A completely different detective mystery on Mars',
      },
    };
    const res = saveProjectToLocalStorage(divergent, { expectedPersistedRevision: 1 });
    assert.equal(res.ok, false);
    assert.equal(res.conflictDetected, true);
    assert.match(res.error ?? '', /divergent snapshot/i);
  });

  it('yields auto-seeded sample project in localStorage to authoritative IndexedDB record', () => {
    const idbProject = createSampleProject();
    idbProject.updatedAt = Date.now() - 10_000;
    idbProject.snapshot.originalIdea = 'Authoritative stored story from IndexedDB';

    const autoSeededLocal = createSampleProject();
    autoSeededLocal.updatedAt = Date.now();

    const reconciled = reconcileHydratedProjects({
      localProjects: [autoSeededLocal],
      idbProjects: [idbProject],
      activeProject: autoSeededLocal,
      activeUndoState: createUndoRedoState(autoSeededLocal.snapshot, autoSeededLocal.revisions),
      hasLocalEditsSinceMount: false,
      localWasAutoSeededSample: true,
    });
    assert.equal(reconciled.conflictWithHydrated, null);
    assert.equal(reconciled.upgradedFromIndexedDb, true);
    assert.equal(reconciled.activeProject.snapshot.originalIdea, 'Authoritative stored story from IndexedDB');
  });

  it('enforces expectedManuscriptVersionId, expectedBaseSnapshotDigest, and intentId idempotency', () => {
    const store = installMockLocalStorage();
    const { project } = makeProjectWithManuscript('CAS Test');
    const digest = computeSnapshotDigest(project.snapshot);
    store.set(LOCAL_STORAGE_PROJECTS_KEY, JSON.stringify({ [project.id]: project }));

    const badMv = saveProjectToLocalStorage(
      { ...project, revision: project.revision + 1 },
      { expectedPersistedRevision: project.revision, expectedManuscriptVersionId: 'mv_stale' }
    );
    assert.equal(badMv.ok, false);
    assert.equal(badMv.conflictDetected, true);

    const badDigest = saveProjectToLocalStorage(
      { ...project, revision: project.revision + 1 },
      { expectedPersistedRevision: project.revision, expectedBaseSnapshotDigest: 'snap_wrong' }
    );
    assert.equal(badDigest.ok, false);
    assert.equal(badDigest.conflictDetected, true);

    const intentId = 'intent_append_001';
    const okWrite = saveProjectToLocalStorage(
      { ...project, revision: project.revision + 1 },
      {
        expectedPersistedRevision: project.revision,
        expectedManuscriptVersionId: project.snapshot.manuscriptVersionId,
        expectedBaseSnapshotDigest: digest,
        intentId,
      }
    );
    assert.equal(okWrite.ok, true);
    assert.equal(okWrite.saved, true);

    const replay = saveProjectToLocalStorage(
      { ...project, revision: project.revision + 1 },
      { expectedPersistedRevision: project.revision, intentId }
    );
    assert.equal(replay.ok, true);
    assert.equal(replay.idempotentHit, true);

    const reusedId = saveProjectToLocalStorage(
      { ...project, revision: project.revision + 1, snapshot: { ...project.snapshot, refinedPrompt: 'different operation content' } },
      { expectedPersistedRevision: project.revision, intentId }
    );
    assert.equal(reusedId.ok, false);
    assert.equal(reusedId.conflictDetected, true);
  });
});

describe('Package B — Shared AI budgets, concurrency/rate limits, and 6 narrative routes', () => {
  let closeServer: (() => Promise<void>) | null = null;

  afterEach(async () => {
    resetAiSlotsForTests();
    if (closeServer) {
      await closeServer();
      closeServer = null;
    }
  });

  it('enforces token budgets, concurrency slots, and rate limits cleanly', () => {
    const over = evaluateOperationBudget({
      operation: 'diagnostics',
      model: 'gemini-4-hydrogen',
      inputChars: 100_000,
      estimatedInputTokens: 20_000,
      maxInputTokens: 14_000,
      maxOutputTokens: 4_096,
    });
    assert.equal(over.ok, false);
    assert.match(over.reason ?? '', /exceeds/i);

    const s1 = acquireAiSlot('writing', 10_000);
    const s2 = acquireAiSlot('writing', 10_001);
    const s3 = acquireAiSlot('writing', 10_002);
    assert.equal(s1.ok, true);
    assert.equal(s2.ok, true);
    assert.equal(s3.ok, false, '3rd concurrent writing call must be rejected when maxConcurrent is 2');
    if (s1.ok) s1.release();
    if (s2.ok) s2.release();

    const s4 = acquireAiSlot('writing', 10_005);
    assert.equal(s4.ok, true, 'releasing slots restores capacity');
    if (s4.ok) s4.release();
  });

  it('serves /api/ai/capabilities and validates all 6 narrative AI routes via mocked handlers', async () => {
    const usage = {
      inputChars: 120,
      estimatedInputTokens: 30,
      maxInputChars: 40_000,
      maxInputTokens: 14_000,
      maxOutputTokens: 4_096,
      model: 'gemini-4-hydrogen',
      operation: 'diagnostics',
    };

    const srv = await startTestServer(
      createStubHandlers({
        analyzeSemanticDiagnostics: async () => ({
          findings: [
            {
              category: 'continuity',
              severity: 'warning',
              certainty: 'inferred',
              targetKind: 'section',
              title: 'Timeline mismatch',
              description: 'Day 2 happens before Day 1.',
              evidenceQuote: 'Yesterday morning',
            },
          ],
          coverageNote: 'Checked 1 section.',
          usage,
        }),
        suggestDiagnosticFixes: async () => ({
          alternatives: [
            {
              id: 'fix_1',
              title: 'Clarify timeline',
              reason: 'Aligns sequence.',
              assumptions: ['Chronological narration'],
              evidenceSummary: 'Scene 1',
              affectedScope: 'Scene 1',
              kind: 'manual_guidance',
              beforeText: 'Yesterday',
              afterText: 'Two days later',
            },
          ],
          usage,
        }),
        analyzeNarrativeSync: async (req) => ({
          direction: req.direction,
          coverageNote: 'Checked 1 section.',
          modelProposals: [],
          manuscriptPatches: [],
          usage: { ...usage, operation: 'sync' },
        }),
        runWritingAssistant: async () => ({
          proposals: [
            {
              id: 'alt_1',
              label: 'Tighter cadence',
              text: 'Mara crossed the silent bridge.',
              rationale: 'Trims filler words.',
              assumptions: ['Author wants brisker prose'],
            },
          ],
          usage: { ...usage, operation: 'writing' },
        }),
        exploreCreativeOpportunities: async () => ({
          opportunities: [
            {
              category: 'tension',
              title: 'Add bridge toll guardian',
              rationale: 'Raises immediate dramatic friction.',
              options: ['A suspicious watchman', 'A locked iron gate'],
              sourceRefs: [],
            },
          ],
          coverageNote: 'Analyzed 1 scene.',
          usage: { ...usage, operation: 'opportunities' },
        }),
        proposeImportEnhancements: async () => ({
          proposals: [
            {
              id: 'enh_1',
              category: 'pacing',
              title: 'Tighten opening exposition',
              rationale: 'Starts closer to action.',
              afterExcerpt: 'Open on Mara reaching the bridge.',
              assumptions: ['Author wants brisker opening'],
            },
          ],
          coverageNote: 'Reviewed opening excerpt.',
          usage: { ...usage, operation: 'import-enhance' },
        }),
      })
    );
    closeServer = srv.close;

    const capRes = await fetch(`${srv.baseUrl}/api/ai/capabilities`);
    assert.equal(capRes.status, 200);
    const capJson = (await capRes.json()) as { configured: boolean; textModel: string; operations: Record<string, unknown> };
    assert.equal(capJson.configured, false);
    assert.equal(capJson.textModel, 'gemini-4-hydrogen');
    assert.ok(capJson.operations.diagnostics && capJson.operations.writing);

    const badDiag = await fetch(`${srv.baseUrl}/api/narrative/diagnostics/analyze`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ scope: 'invalid-scope' }),
    });
    assert.equal(badDiag.status, 400);

    const r1 = await fetch(`${srv.baseUrl}/api/narrative/diagnostics/analyze`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        projectId: 'p1',
        baseRevision: 1,
        scope: 'scene',
        entities: [],
        relationships: [],
        storyBible: {},
        sections: [{ id: 's1', title: 'Scene 1', kind: 'scene', text: 'Yesterday morning she left.' }],
      }),
    });
    assert.equal(r1.status, 200);

    const r2 = await fetch(`${srv.baseUrl}/api/narrative/diagnostics/suggest-fixes`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        projectId: 'p1',
        baseRevision: 1,
        issue: {
          id: 'iss_1',
          title: 'Timeline mismatch',
          description: 'Day 2 before Day 1',
        },
        entities: [],
        relationships: [],
        storyBible: {},
      }),
    });
    assert.equal(r2.status, 200);

    const r3 = await fetch(`${srv.baseUrl}/api/narrative/sync/analyze`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        direction: 'manuscript-to-model',
        projectId: 'p1',
        baseRevision: 1,
        sections: [{ id: 's1', title: 'Scene 1', kind: 'scene', text: 'Mara crossed the bridge.' }],
        entities: [],
        relationships: [],
        storyBible: {},
      }),
    });
    assert.equal(r3.status, 200);

    const r4 = await fetch(`${srv.baseUrl}/api/narrative/writing/assist`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        projectId: 'p1',
        baseRevision: 1,
        sectionId: 's1',
        sectionTitle: 'Scene 1',
        action: 'shorten',
        selectedText: 'Mara walked across the bridge in silence.',
        contextBefore: '',
        contextAfter: '',
        confirmedEntities: [],
        confirmedStoryBible: {},
        styleGuidance: [],
      }),
    });
    assert.equal(r4.status, 200);

    const r5 = await fetch(`${srv.baseUrl}/api/narrative/opportunities/explore`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        projectId: 'p1',
        baseRevision: 1,
        scope: 'project',
        categories: ['tension'],
        entities: [],
        relationships: [],
        storyBible: {},
        sections: [{ id: 's1', title: 'Scene 1', kind: 'scene', text: 'Mara crossed the bridge.' }],
      }),
    });
    assert.equal(r5.status, 200);

    const r6 = await fetch(`${srv.baseUrl}/api/narrative/import/enhance`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        filename: 'draft.txt',
        sourceTextExcerpt: 'Mara walked across the bridge.',
        entities: [{ name: 'Mara', category: 'character' }],
        sections: [{ title: 'Scene 1', excerpt: 'Mara walked across the bridge.' }],
      }),
    });
    assert.equal(r6.status, 200);
  });
});

describe('Package C — Diagnostics, readiness separation, intentional disposition, and safe fix apply', () => {
  it('separates readiness items from continuity issues and detects excluded entity mentioned in manuscript', () => {
    const { project, undoState } = makeProjectWithManuscript(
      'Exclusion Test',
      'Cat greeted everyone at the door.'
    );
    const cat = project.snapshot.entities.find((e) => e.name.toLowerCase() === 'cat');
    assert.ok(cat, 'sample project should have Cat entity');
    cat.excluded = true;

    const { readiness } = splitReadinessAndIssues([
      {
        id: 'r1',
        severity: 'warning',
        category: 'unresolved_decision',
        title: 'Unconfirmed Premise',
        description: 'Confirm premise',
        affectedEntityIds: [],
      },
      {
        id: 'c1',
        severity: 'error',
        category: 'violated_exclusion',
        title: 'Excluded entity active',
        description: 'Conflict',
        affectedEntityIds: [cat.id!],
      },
    ]);
    assert.equal(readiness.length, 1);

    const findings = collectLocalDiagnosticFindings(project);
    const mention = findings.find((f) => f.title.includes('Cat') && f.title.includes('Bridge Crossing'));
    assert.ok(mention, 'should detect excluded entity mentioned in working manuscript');

    const synced = syncDiagnosticFindingsIntoProject(project, findings, {
      source: 'local',
      scopeLabel: 'Full scan',
      fullScan: true,
    });
    const mentionFp = diagnosticFingerprint(mention.detectorId, mention.type, mention.targetIds, mention.scopeKey);
    const tracked = synced.narrative!.issues.find((i) => i.fingerprint === mentionFp);
    assert.ok(tracked);

    const marked: CreativeProject = {
      ...synced,
      narrative: transitionIssue(synced, tracked.id, 'intentional', 'Deliberate flashback mention', Date.now(), synced.revision),
    };
    const resynced = syncDiagnosticFindingsIntoProject(marked, findings, {
      source: 'local',
      scopeLabel: 'Full scan',
      fullScan: true,
    });
    const persistedIntentional = resynced.narrative!.issues.find((i) => i.id === tracked.id);
    assert.equal(persistedIntentional?.disposition, 'intentional');

    const alts = buildLocalFixAlternatives(synced, tracked);
    assert.ok(alts.length >= 1, 'should provide deterministic local fix alternative');
    assert.throws(
      () => applyDiagnosticFixAlternative(synced, undoState, tracked.id, alts[0], synced.revision - 1),
      /changed/i
    );

    const applied = applyDiagnosticFixAlternative(synced, undoState, tracked.id, alts[0], synced.revision);
    assert.equal(applied.issueResolved, true);
    assert.equal(applied.project.revision, synced.revision + 1);
    assert.ok(applied.project.narrative!.audit.some((a) => a.action === 'fix' && a.issueId === tracked.id));
  });
});

describe('Package D — Bidirectional Manuscript <-> Model sync proposals & patches', () => {
  it('computes freshness, applies non-destructive model proposals, and enforces exact manuscript patch binding', () => {
    const { project, undoState } = makeProjectWithManuscript(
      'Sync Novel',
      'Mara stood by the lantern. The wind howled.'
    );
    const initialFreshness = computeSyncFreshness(project);
    assert.equal(initialFreshness.hasManuscript, true);
    assert.match(initialFreshness.statusLabel, /Unreviewed/i);

    const afterModel = applyModelSyncProposal(
      project,
      undoState,
      {
        id: 'sp_1',
        kind: 'add_entity',
        title: 'Add Mara as character',
        rationale: 'Mara appears in Scene 1.',
        evidenceQuote: 'Mara stood by the lantern.',
        entityName: 'Mara',
        entityCategory: 'character',
        proposedValue: 'Traveler standing by the lantern',
        isAssumption: false,
      },
      project.revision
    );
    assert.ok(afterModel.project.snapshot.entities.some((e) => e.name === 'Mara'));
    assert.equal(afterModel.project.narrative?.syncState?.lastDirection, 'manuscript-to-model');

    const section = afterModel.project.narrative!.sectionVersions[0].section;
    const validPatch = {
      id: 'mp_1',
      sectionId: section.id,
      sectionTitle: section.title,
      linkedModelChange: 'Lantern -> Silver Lamp',
      rationale: 'Matches updated canonical prop.',
      originalExcerpt: 'by the lantern',
      proposedExcerpt: 'by the silver lamp',
    };
    assert.equal(validateManuscriptPatchBinding(afterModel.project, validPatch).ok, true);

    const stalePatch = { ...validPatch, originalExcerpt: 'nonexistent text' };
    assert.equal(validateManuscriptPatchBinding(afterModel.project, stalePatch).ok, false);

    const afterPatch = applyManuscriptSyncPatch(
      afterModel.project,
      afterModel.undoState,
      validPatch,
      afterModel.project.revision,
      afterModel.project.snapshot.manuscriptVersionId
    );
    const latestSvId =
      afterPatch.project.narrative!.versions[afterPatch.project.narrative!.versions.length - 1].sectionVersionIds[0];
    const latestSection = afterPatch.project.narrative!.sectionVersions.find((sv) => sv.id === latestSvId)!.section;
    assert.match(latestSection.text, /by the silver lamp/);
  });
});

describe('Package E — Contextual selection-aware writing assistant helpers', () => {
  it('guards UTF-16 surrogate pair boundaries and concurrent text edits', () => {
    const emojiText = 'Hello 😀 world';
    const badSel = validateTextSelection(emojiText, 7, 8);
    assert.equal(badSel.ok, false);

    const goodSel = validateTextSelection(emojiText, 6, 8);
    assert.equal(goodSel.ok, true);
    assert.equal(goodSel.selectedText, '😀');

    const digest = computeTextDigest(emojiText);
    const staleEdit = applyWritingSelectionEdit({
      currentText: `${emojiText}!`,
      expectedDigest: digest,
      start: 6,
      end: 8,
      proposedText: '🌟',
      mode: 'replace',
    });
    assert.equal(staleEdit.ok, false);

    const validEdit = applyWritingSelectionEdit({
      currentText: emojiText,
      expectedDigest: digest,
      start: 6,
      end: 8,
      proposedText: '🌟',
      mode: 'replace',
    });
    assert.equal(validEdit.ok, true);
    if (validEdit.ok) assert.equal(validEdit.nextText, 'Hello 🌟 world');
  });

  it('excludes unattributed beliefs and reported claims from confirmed writing context', () => {
    const { project } = makeProjectWithManuscript('Context Isolation');
    project.snapshot.entities.push(
      {
        id: 'ent_confirmed',
        name: 'Elena',
        category: 'character',
        presence_in_prompt: true,
        description: 'Confirmed protagonist',
        alternatives: null,
        status: 'confirmed',
        epistemicKind: 'user-authored',
        attributes: [
          { id: 'a1', name: 'hair', presence_in_prompt: true, value: [{ name: 'dark' }], status: 'confirmed', epistemicKind: 'user-authored' },
          { id: 'a2', name: 'rumor', presence_in_prompt: false, value: [{ name: 'spy' }], status: 'confirmed', epistemicKind: 'reported' },
        ],
      },
      {
        id: 'ent_belief',
        name: 'Ghost King',
        category: 'character',
        presence_in_prompt: false,
        description: 'Merely rumored',
        alternatives: null,
        status: 'confirmed',
        epistemicKind: 'belief',
        attributes: [],
      }
    );

    const ctx = extractConfirmedWritingContext(project, 'sec_1');
    assert.ok(ctx.confirmedEntities.some((e) => e.name === 'Elena'));
    assert.equal(ctx.confirmedEntities.some((e) => e.name === 'Ghost King'), false);
    const elena = ctx.confirmedEntities.find((e) => e.name === 'Elena')!;
    assert.match(elena.summary, /hair: dark/);
    assert.equal(elena.summary.includes('spy'), false, 'reported attributes must be excluded');
  });
});

describe('Package F — Verified Kinship, Ego Map, and validated AI Opportunities', () => {
  it('projects strictly verified kinship edges, flags cycles & adoptive/step ties, and omits generic/pending edges', () => {
    const entities: Entity[] = [
      { id: 'e1', name: 'Alice', category: 'character', presence_in_prompt: true, description: '', alternatives: null, attributes: [] },
      { id: 'e2', name: 'Bob', category: 'character', presence_in_prompt: true, description: '', alternatives: null, attributes: [] },
      { id: 'e3', name: 'Cara', category: 'character', presence_in_prompt: true, description: '', alternatives: null, attributes: [] },
    ];
    const relationships: Relationship[] = [
      { id: 'r1', source: 'Alice', target: 'Bob', sourceId: 'e1', targetId: 'e2', label: 'parent of', status: 'confirmed' },
      { id: 'r2', source: 'Bob', target: 'Alice', sourceId: 'e2', targetId: 'e1', label: 'parent of', status: 'confirmed' },
      { id: 'r3', source: 'Alice', target: 'Cara', sourceId: 'e1', targetId: 'e3', label: 'adoptive mother of', status: 'confirmed' },
      { id: 'r4', source: 'Bob', target: 'Cara', sourceId: 'e2', targetId: 'e3', label: 'friend of', status: 'confirmed' },
      { id: 'r5', source: 'Bob', target: 'Cara', sourceId: 'e2', targetId: 'e3', label: 'sibling of', status: 'pending' },
    ];

    const kinship = buildVerifiedKinshipProjection(entities, relationships);
    assert.equal(kinship.edges.length, 3);
    assert.equal(kinship.omittedNonKinshipCount, 1);
    assert.equal(kinship.omittedPendingCount, 1);
    assert.equal(kinship.hasCycles, true);
    assert.ok(kinship.edges.some((e) => e.kinshipKind === 'adoptive' && e.isNonTreeQualification));

    const ego1 = buildCharacterEgoNetwork(entities, relationships, 'e2', 1);
    assert.equal(ego1.nodeIds.has('e1'), true);
    assert.equal(ego1.nodeIds.has('e3'), true);
  });

  it('validates AI-explored opportunities by stripping invalid refs, deduplicating, and tagging origin as ai', () => {
    const { project } = makeProjectWithManuscript('Opportunities Test');
    const validEntId = project.snapshot.entities[0].id!;
    const validated = validateExploredOpportunities(project, [
      {
        category: 'character-depth',
        title: 'Deepen host motivation',
        rationale: 'Explains why the party matters.',
        options: ['Secret farewell', 'Birthday surprise'],
        sourceRefs: [validEntId, 'nonexistent_id_999'],
      },
      {
        category: 'character-depth',
        title: 'Deepen host motivation',
        rationale: 'Dup',
        options: ['Dup'],
        sourceRefs: [],
      },
    ]);
    assert.equal(validated.validInputs.length, 1);
    assert.equal(validated.droppedDuplicates, 1);
    assert.equal(validated.strippedInvalidRefs, 1);
    assert.deepEqual(validated.validInputs[0].sourceRefs, [validEntId]);
    assert.equal(validated.validInputs[0].origin, 'ai');
  });
});

describe('Package G — DOCX Export round-trip and Verified All-Projects ZIP Archive', () => {
  it('builds a deterministic export filename and valid OOXML DOCX round-trippable by parseNarrativeSource', async () => {
    const fname = buildDeterministicExportFilename({
      projectName: 'The Lantern & Bridge!',
      projectId: 'proj_12345678',
      kind: 'manuscript',
      revision: 4,
      ext: 'docx',
      timestamp: new Date('2026-05-01T12:34:56Z'),
    });
    assert.equal(fname, 'the-lantern-bridge-12345678-manuscript-r4-20260501-123456Z.docx');

    const docxBytes = buildManuscriptDocxBytes('Lantern Chronicles', [
      { id: 's1', kind: 'chapter', title: 'Chapter 1', text: 'Mara lit the lamp & stepped out.\n\nThe fog lifted.' },
    ]);
    const parsed = await parseNarrativeSource(docxBytes, 'lantern.docx', false);
    assert.equal(parsed.mediaType, 'application/vnd.openxmlformats-officedocument.wordprocessingml.document');
    assert.match(parsed.text, /Lantern Chronicles/);
    assert.match(parsed.text, /Mara lit the lamp & stepped out\./);
    assert.match(parsed.text, /The fog lifted\./);
  });

  it('builds and verifies All-Projects ZIP archive, remaps colliding IDs, and rejects tampered checksums or unsafe paths', async () => {
    const p1 = createSampleProject();
    const { bytes, manifest } = await buildAllProjectsArchiveZip([p1], { darkMode: true });
    assert.equal(manifest.projectCount, 1);

    const restored = await parseAndVerifyAllProjectsArchive(bytes, new Set([p1.id]));
    assert.equal(restored.ok, true);
    assert.equal(restored.projects.length, 1);
    assert.equal(restored.remappedIds.length, 1);
    assert.notEqual(restored.projects[0].id, p1.id);

    const unpacked = unzipSync(bytes);
    const projectPath = manifest.entries[0].filePath;
    unpacked[projectPath] = strToU8(new TextDecoder().decode(unpacked[projectPath]).replace(p1.name, 'TAMPERED_NAME'));
    const tamperedZip = zipSync(unpacked);
    await assert.rejects(
      () => parseAndVerifyAllProjectsArchive(tamperedZip, new Set()),
      /checksum|length/i
    );

    const traversalZip = zipSync({
      '../evil.json': strToU8('{}'),
      'manifest.json': unpacked['manifest.json'],
    });
    await assert.rejects(
      () => parseAndVerifyAllProjectsArchive(traversalZip, new Set()),
      /unsafe path/i
    );
  });

  it('rejects inconsistent archive manifests and unlisted ZIP members before restore', async () => {
    const { bytes } = await buildAllProjectsArchiveZip([createSampleProject()]);
    const unpacked = unzipSync(bytes);
    const manifest = JSON.parse(new TextDecoder().decode(unpacked['manifest.json'])) as Record<string, unknown>;

    const wrongCount = { ...unpacked, 'manifest.json': strToU8(JSON.stringify({ ...manifest, projectCount: 2 })) };
    await assert.rejects(() => parseAndVerifyAllProjectsArchive(zipSync(wrongCount), new Set()), /project count/i);

    const wrongMetadata = JSON.parse(JSON.stringify(manifest)) as typeof manifest;
    (wrongMetadata.entries as Array<Record<string, unknown>>)[0].name = 'Different project';
    const mismatched = { ...unpacked, 'manifest.json': strToU8(JSON.stringify(wrongMetadata)) };
    await assert.rejects(() => parseAndVerifyAllProjectsArchive(zipSync(mismatched), new Set()), /metadata does not match/i);

    const extraMember = { ...unpacked, 'projects/unlisted.json': strToU8('{}') };
    await assert.rejects(() => parseAndVerifyAllProjectsArchive(zipSync(extraMember), new Set()), /unlisted entry/i);
  });

  it('rejects an oversized project entry before retaining expanded archive contents', async () => {
    const oversized = new Uint8Array(49 * 1024 * 1024);
    const archive = zipSync({ 'projects/oversized.json': oversized });
    await assert.rejects(() => parseAndVerifyAllProjectsArchive(archive, new Set()), /expands beyond|maximum safe size/i);
  });

  it('returns only uncommitted archive projects for a safe retry', async () => {
    const firstAttempt: string[] = [];
    const partial = await restoreArchiveProjectsSequentially(['one', 'two', 'three'], async (project) => {
      firstAttempt.push(project);
      if (project === 'two') throw new Error('synthetic persistence failure');
    });
    assert.deepEqual(firstAttempt, ['one', 'two']);
    assert.deepEqual(partial, {
      ok: false, count: 1, error: 'synthetic persistence failure', remainingProjects: ['two', 'three'],
    });

    const retryAttempt: string[] = [];
    const completed = await restoreArchiveProjectsSequentially(partial.remainingProjects, async (project) => {
      retryAttempt.push(project);
    });
    assert.deepEqual(retryAttempt, ['two', 'three']);
    assert.deepEqual(completed, { ok: true, count: 2 });
  });
});

describe('Package H — Append to Existing Project with explicit entity conflict resolution', () => {
  it('blocks unresolved entity conflicts and duplicate sources, and produces valid narrative records once resolved', () => {
    const { project: target } = makeProjectWithManuscript('Target Book', 'Cat welcomed guests.');
    const { project: incoming } = makeProjectWithManuscript('Chapter 2 Import', 'Cat poured tea for Owl.');

    const srcDigest = 'a'.repeat(64);
    target.narrative!.sources.push({
      id: 'src_existing',
      version: '1',
      filename: 'ch1.txt',
      mediaType: 'text/plain',
      byteLength: 20,
      digest: 'b'.repeat(64),
      parserVersion: '1',
      text: 'Cat welcomed guests.',
      blocks: [],
      retention: 'extracted-only',
    });
    incoming.narrative!.sources.push({
      id: 'src_incoming',
      version: '1',
      filename: 'ch2.txt',
      mediaType: 'text/plain',
      byteLength: 23,
      digest: srcDigest,
      parserVersion: '1',
      text: 'Cat poured tea for Owl.',
      blocks: [],
      retention: 'extracted-only',
    });

    const matches = findCrossProjectIdentityMatches(target, incoming);
    assert.ok(matches.length >= 1, 'should detect Cat name collision between target and incoming');

    assert.throws(
      () =>
        applyAppendToExistingProject({
          targetProject: target,
          incomingProject: incoming,
          insertPosition: 'end',
          identityDecisions: {},
          expectedBaseRevision: target.revision,
        }),
      /identity conflict/i
    );

    const decisions: Record<string, 'keep-separate' | 'link-to-existing'> = {};
    matches.forEach((m, idx) => {
      decisions[m.incomingEntityId] = idx === 0 ? 'link-to-existing' : 'keep-separate';
    });

    const appended = applyAppendToExistingProject({
      targetProject: target,
      incomingProject: incoming,
      insertPosition: 'end',
      identityDecisions: decisions,
      expectedBaseRevision: target.revision,
      expectedManuscriptVersionId: target.snapshot.manuscriptVersionId,
      expectedBaseSnapshotDigest: computeSnapshotDigest(target.snapshot),
    });
    assert.equal(appended.addedSectionCount, 1);
    assert.equal(appended.linkedEntityCount, 1);
    assert.equal(appended.candidateProject.revision, target.revision + 1);
    assert.doesNotThrow(() => validateNarrativeRecords(appended.candidateProject));

    assert.equal(detectDuplicateSourceInProject(appended.candidateProject, incoming), true);
    assert.throws(
      () =>
        applyAppendToExistingProject({
          targetProject: appended.candidateProject,
          incomingProject: incoming,
          insertPosition: 'end',
          identityDecisions: decisions,
          expectedBaseRevision: appended.candidateProject.revision,
        }),
      /already exists/i
    );
  });
});
