/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, it, beforeEach } from 'node:test';
import express from 'express';
import {
  applyDecisionBatch,
  createSampleProject,
  renameEntity,
  setEntityAttribute,
  setEntityExistence,
  updateRelationshipById,
  updateStoryBibleField,
  upsertRelationship,
} from '../lib/canonicalModel.ts';
import { computeForceLayout, computeNodeDimensions } from '../lib/graphLayout.ts';
import { createUndoRedoState } from '../lib/historyEngine.ts';
import {
  interpretBatchInstructionLocally,
} from '../lib/nlBatchEngine.ts';
import {
  acceptPolishProposal,
  applyAsyncAnalysisCompletion,
  applyAsyncGenerationCompletion,
  buildReviewDiffModel,
  commitBatchPreviewToProject,
  commitRedoTransaction,
  commitSnapshotTransaction,
  commitUndoTransaction,
  createPolishProposal,
  createRequestTicket,
  validatePolishProposalAcceptance,
} from '../lib/projectController.ts';
import {
  clearDeletedProjectId,
  deleteProjectCompletely,
  deleteProjectFromLocalStorage,
  exportProjectToJson,
  getDeletedProjectIds,
  loadProjectsFromLocalStorage,
  migrateProjectPayload,
  reconcileHydratedProjects,
  saveProjectToLocalStorage,
} from '../lib/storageEngine.ts';
import {
  loadServerEnvFromFiles,
  resetServerEnvCacheForTesting,
} from '../server/geminiClient.ts';
import { createApiRouter, type AiServiceHandlers } from '../server/routes.ts';
import {
  MAX_PROMPT_CHARS,
  validateEffectivePromptLength,
} from '../shared/schemas.ts';
import type { CreativeProject, DecisionItem, Entity, Relationship } from '../shared/types.ts';

class MockLocalStorage {
  private store = new Map<string, string>();
  public quotaLimitBytes: number | null = null;

  getItem(key: string): string | null {
    return this.store.get(key) ?? null;
  }

  setItem(key: string, value: string): void {
    if (this.quotaLimitBytes !== null && value.length > this.quotaLimitBytes) {
      const err = new Error('QuotaExceededError: Mock storage quota exceeded');
      err.name = 'QuotaExceededError';
      throw err;
    }
    this.store.set(key, value);
  }

  removeItem(key: string): void {
    this.store.delete(key);
  }

  clear(): void {
    this.store.clear();
  }
}

const mockStorage = new MockLocalStorage();
Object.defineProperty(globalThis, 'window', {
  value: { localStorage: mockStorage },
  writable: true,
  configurable: true,
});
Object.defineProperty(globalThis, 'localStorage', {
  value: mockStorage,
  writable: true,
  configurable: true,
});

describe('Independent Audit Remediation Suite (IA-01 through IA-25)', () => {
  beforeEach(() => {
    mockStorage.clear();
    mockStorage.quotaLimitBytes = null;
  });

  it('IA-01: rejects batch preview created on Project A when applied to Project B and blocks duplicate apply', () => {
    const projectA = createSampleProject();
    const projectB: CreativeProject = {
      ...createSampleProject(),
      id: 'proj_other_b',
      name: 'Project B',
    };
    const undoB = createUndoRedoState(projectB.snapshot);

    const previewFromA = interpretBatchInstructionLocally(
      'Make all the animal guests elderly, but keep the cat young.',
      projectA.snapshot,
      {
        projectId: projectA.id,
        revision: projectA.revision,
      }
    );

    assert.equal(previewFromA.baseProjectId, projectA.id);
    assert.ok(previewFromA.proposalId);

    const appliedIds = new Set<string>();
    const crossProjectAttempt = commitBatchPreviewToProject({
      project: projectB,
      undoState: undoB,
      preview: previewFromA,
      appliedProposalIds: appliedIds,
    });

    assert.equal(crossProjectAttempt.result.ok, false);
    if (!crossProjectAttempt.result.ok) {
      assert.equal(crossProjectAttempt.result.reason, 'WRONG_PROJECT');
    }
    assert.equal(crossProjectAttempt.project.revision, projectB.revision);

    // Apply on matching Project A succeeds once, then blocks duplicate apply
    const undoA = createUndoRedoState(projectA.snapshot);
    const validAttempt = commitBatchPreviewToProject({
      project: projectA,
      undoState: undoA,
      preview: previewFromA,
      appliedProposalIds: appliedIds,
    });
    assert.equal(validAttempt.result.ok, true);
    assert.equal(validAttempt.project.revision, projectA.revision + 1);

    const duplicateAttempt = commitBatchPreviewToProject({
      project: validAttempt.project,
      undoState: validAttempt.undoState,
      preview: {
        ...previewFromA,
        baseRevision: validAttempt.project.revision,
      },
      appliedProposalIds: appliedIds,
    });
    assert.equal(duplicateAttempt.result.ok, false);
    if (!duplicateAttempt.result.ok) {
      assert.equal(duplicateAttempt.result.reason, 'ALREADY_APPLIED');
    }
  });

  it('IA-02: rejects stale batch preview when project revision has advanced (r1 -> r2)', () => {
    const project = createSampleProject(); // revision 1
    const undoState = createUndoRedoState(project.snapshot);

    const previewAtR1 = interpretBatchInstructionLocally(
      'The party should be mysterious rather than cheerful.',
      project.snapshot,
      {
        projectId: project.id,
        revision: project.revision,
      }
    );

    // Advance project revision via an intervening edit
    const editedSnap = updateStoryBibleField(project.snapshot, 'setting', 'Moonlit Conservatory');
    const { project: projectR2, undoState: undoR2 } = commitSnapshotTransaction(
      project,
      undoState,
      editedSnap,
      'Intervening Edit',
      'Changed setting before applying batch preview'
    );
    assert.equal(projectR2.revision, 2);

    const staleCommit = commitBatchPreviewToProject({
      project: projectR2,
      undoState: undoR2,
      preview: previewAtR1,
    });

    assert.equal(staleCommit.result.ok, false);
    if (!staleCommit.result.ok) {
      assert.equal(staleCommit.result.reason, 'STALE_REVISION');
    }
    assert.equal(staleCommit.project.revision, 2);
    assert.equal(
      staleCommit.project.snapshot.storyBible.tone.value,
      projectR2.snapshot.storyBible.tone.value
    );
  });

  it('IA-03: preserves preview operations and performs atomic rollback when a batch operation fails validation', () => {
    const project = createSampleProject();
    const undoState = createUndoRedoState(project.snapshot);
    const preview = interpretBatchInstructionLocally(
      'Make all the animal guests elderly.',
      project.snapshot,
      {
        projectId: project.id,
        revision: project.revision,
      }
    );

    // Inject one invalid operation alongside valid operations
    const brokenPreview = {
      ...preview,
      operations: [
        ...preview.operations,
        {
          id: 'op_invalid_missing_target',
          type: 'set_attribute' as const,
          entityName: 'NonExistentDragon',
          attributeName: 'Age',
          nextValue: 'Ancient',
          summary: 'Set NonExistentDragon Age to Ancient',
          selected: true,
        },
      ],
    };

    const attempt = commitBatchPreviewToProject({
      project,
      undoState,
      preview: brokenPreview,
    });

    assert.equal(attempt.result.ok, false);
    if (!attempt.result.ok) {
      assert.equal(attempt.result.reason, 'VALIDATION_FAILED');
      assert.ok(attempt.result.errors.length > 0);
    }
    // Project snapshot and revision remain completely untouched (atomic rollback)
    assert.equal(attempt.project.revision, project.revision);
    assert.deepEqual(attempt.project.snapshot, project.snapshot);
    // Original preview operations and selections remain intact for user adjustment
    assert.equal(
      brokenPreview.operations.filter((o) => o.selected).length,
      preview.operations.length + 1
    );
  });

  it('IA-04 & IA-05: reconciles full project snapshot, revision, history, and undoState when IndexedDB holds newer r6 than localStorage r5', () => {
    const baseProject = createSampleProject();
    let currentProj = baseProject;
    let currentUndo = createUndoRedoState(baseProject.snapshot);

    // Advance to r5 and save in localStorage
    for (let i = 2; i <= 5; i++) {
      const nextSnap = updateStoryBibleField(
        currentProj.snapshot,
        'genre',
        `Genre v${i}`
      );
      const tx = commitSnapshotTransaction(
        currentProj,
        currentUndo,
        nextSnap,
        `Edit #${i}`,
        `Updated genre to v${i}`
      );
      currentProj = tx.project;
      currentUndo = tx.undoState;
    }
    assert.equal(currentProj.revision, 5);
    saveProjectToLocalStorage(currentProj, { forceOverwrite: true });

    // Advance to r6 (simulating a quota-exceeded localStorage write that succeeded in IndexedDB)
    const snapR6 = updateStoryBibleField(
      currentProj.snapshot,
      'centralConflict',
      'The lantern key vanishes at midnight (r6 in IndexedDB)'
    );
    const txR6 = commitSnapshotTransaction(
      currentProj,
      currentUndo,
      snapR6,
      'Edit #6',
      'Updated central conflict in r6'
    );
    const projectR6: CreativeProject = {
      ...txR6.project,
      artifacts: [
        {
          id: 'art_r6',
          mode: 'story',
          createdAt: Date.now(),
          revisionId: txR6.project.revisions[0]?.id ?? 'rev_6',
          promptUsed: snapR6.refinedPrompt,
          storyText: 'Full story saved in IndexedDB at r6.',
          isOutdated: false,
          sourceRevision: 6,
        },
      ],
    };

    // Simulate reload: localStorage has r5, IndexedDB returns r6
    const loadedLocal = loadProjectsFromLocalStorage();
    const localR5 = loadedLocal.projects[0];
    assert.equal(localR5.revision, 5);

    const reconciled = reconcileHydratedProjects({
      localProjects: loadedLocal.projects,
      idbProjects: [projectR6],
      activeProject: localR5,
      activeUndoState: createUndoRedoState(localR5.snapshot),
      hasLocalEditsSinceMount: false,
    });

    assert.equal(reconciled.upgradedFromIndexedDb, true);
    assert.equal(reconciled.activeProject.revision, 6);
    assert.equal(
      reconciled.activeProject.snapshot.storyBible.centralConflict.value,
      'The lantern key vanishes at midnight (r6 in IndexedDB)'
    );
    assert.equal(
      reconciled.activeUndoState.present.storyBible.centralConflict.value,
      'The lantern key vanishes at midnight (r6 in IndexedDB)'
    );
    assert.equal(reconciled.activeProject.artifacts.length, 1);
    assert.equal(reconciled.activeProject.revisions.length, projectR6.revisions.length);
  });

  it('IA-06 & IA-07: blocks stale AI Polish proposal after Story Bible or manual prompt edit and detects no-op polish', () => {
    const project = createSampleProject();
    const undoState = createUndoRedoState(project.snapshot);

    // Create staged AI Polish proposal at r1
    const proposal = createPolishProposal(
      project,
      `${project.snapshot.refinedPrompt}\n\n[Polished narrative cadence]`
    );
    assert.equal(proposal.isNoOp, false);
    assert.equal(proposal.baseRevision, project.revision);

    // No-op detection when polished text equals current refinedPrompt
    const noOpProposal = createPolishProposal(project, project.snapshot.refinedPrompt);
    assert.equal(noOpProposal.isNoOp, true);

    // 1) User edits Story Bible while proposal is staged (IA-06)
    const snapAfterBibleEdit = updateStoryBibleField(
      project.snapshot,
      'tone',
      'Dark gothic suspense'
    );
    const { project: projectAfterBible, undoState: undoAfterBible } = commitSnapshotTransaction(
      project,
      undoState,
      snapAfterBibleEdit,
      'Update Tone',
      'Changed tone to dark gothic suspense'
    );

    const bibleValidation = validatePolishProposalAcceptance(projectAfterBible, proposal);
    assert.equal(bibleValidation.ok, false);
    assert.equal(bibleValidation.status, 'stale-revision');

    const rejectedAttempt = acceptPolishProposal(projectAfterBible, undoAfterBible, proposal);
    assert.equal(rejectedAttempt.ok, false);
    assert.equal(rejectedAttempt.project.revision, projectAfterBible.revision);
    assert.ok(rejectedAttempt.project.snapshot.refinedPrompt.includes('Dark gothic suspense'));

    // 2) Even if revision number matched, changing refinedPrompt digest blocks acceptance (IA-07)
    const mutatedPromptProject: CreativeProject = {
      ...project,
      snapshot: {
        ...project.snapshot,
        freeformNotes: 'Manual author note added after polish was staged',
        refinedPrompt: `${project.snapshot.refinedPrompt}\nManual author note`,
      },
    };
    const promptValidation = validatePolishProposalAcceptance(mutatedPromptProject, proposal);
    assert.equal(promptValidation.ok, false);
    assert.equal(promptValidation.status, 'stale-digest');
  });

  it('IA-08 & IA-09: increments durable project.revision monotonically on Undo and Redo and prevents stale-tab overwrite', () => {
    const p1 = createSampleProject(); // revision 1
    const u1 = createUndoRedoState(p1.snapshot);

    const snap2 = setEntityAttribute(p1.snapshot, 'Cat', 'Role', 'Detective', 'user-edit');
    const { project: p2, undoState: u2 } = commitSnapshotTransaction(
      p1,
      u1,
      snap2,
      'Set Cat Role',
      'Cat is now a detective'
    );
    assert.equal(p2.revision, 2);

    // Save p2 (revision 2) to storage
    const saveR2 = saveProjectToLocalStorage(p2, { expectedPersistedRevision: 1 });
    assert.equal(saveR2.saved, true);
    const persistedP2: CreativeProject = { ...p2, persistedRevision: 2 };

    // Perform Undo: snapshot reverts to p1 content, but revision increments monotonically to 3!
    const undoTx = commitUndoTransaction(persistedP2, u2);
    assert.equal(undoTx.undoneLabel, 'Set Cat Role');
    assert.equal(undoTx.project.revision, 3);
    assert.equal(undoTx.undoState.past.length, 0);
    assert.equal(undoTx.undoState.future.length, 1);

    // Save undone state (r3) with CAS against persistedRevision 2 -> succeeds cleanly
    const saveR3 = saveProjectToLocalStorage(undoTx.project, {
      expectedPersistedRevision: undoTx.project.persistedRevision,
    });
    assert.equal(saveR3.saved, true);

    // Stale tab still at r2 attempting to save with expectedPersistedRevision: 2 is blocked by CAS!
    const staleTabSave = saveProjectToLocalStorage(persistedP2, {
      expectedPersistedRevision: 2,
    });
    assert.equal(staleTabSave.saved, false);
    assert.equal(staleTabSave.conflictDetected, true);

    // Perform Redo: snapshot restores p2 content and revision increments to 4!
    const redoTx = commitRedoTransaction(
      { ...undoTx.project, persistedRevision: 3 },
      undoTx.undoState
    );
    assert.equal(redoTx.redoneLabel, 'Set Cat Role');
    assert.equal(redoTx.project.revision, 4);
  });

  it('IA-10: loads GEMINI_API_KEY from .env.local in a clean environment without overwriting existing env or leaking VITE_*', () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pcc-env-test-'));
    const envLocalPath = path.join(tmpDir, '.env.local');
    fs.writeFileSync(
      envLocalPath,
      [
        '# Local development secrets',
        'GEMINI_API_KEY="test-key-from-dotenv-local-123"',
        'VITE_PUBLIC_LEAK="should-be-ignored"',
      ].join('\n'),
      'utf8'
    );

    const cleanEnv: NodeJS.ProcessEnv = {};
    const loaded = loadServerEnvFromFiles({
      cwd: tmpDir,
      files: ['.env.local'],
      targetEnv: cleanEnv,
    });

    assert.deepEqual(loaded, ['GEMINI_API_KEY']);
    assert.equal(cleanEnv.GEMINI_API_KEY, 'test-key-from-dotenv-local-123');
    assert.equal(cleanEnv.VITE_PUBLIC_LEAK, undefined);

    // Existing process.env key takes precedence when override is false
    const preconfiguredEnv: NodeJS.ProcessEnv = {
      GEMINI_API_KEY: 'host-injected-production-key',
    };
    loadServerEnvFromFiles({
      cwd: tmpDir,
      files: ['.env.local'],
      targetEnv: preconfiguredEnv,
    });
    assert.equal(preconfiguredEnv.GEMINI_API_KEY, 'host-injected-production-key');

    resetServerEnvCacheForTesting();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('IA-11: deletes project from both localStorage and IndexedDB and records tombstone so hydration cannot resurrect it', async () => {
    const projA = createSampleProject();
    const projB: CreativeProject = {
      ...createSampleProject(),
      id: 'proj_to_delete',
      name: 'Ephemeral Project',
    };

    saveProjectToLocalStorage(projA, { forceOverwrite: true });
    saveProjectToLocalStorage(projB, { forceOverwrite: true });
    assert.equal(loadProjectsFromLocalStorage().projects.length, 2);

    const delRes = await deleteProjectCompletely(projB.id);
    assert.equal(delRes.remaining.some((p: CreativeProject) => p.id === projB.id), false);
    assert.equal(getDeletedProjectIds().has(projB.id), true);

    // Even if stale IndexedDB array still had projB, reconcileHydratedProjects filters it out via tombstone
    const reconciled = reconcileHydratedProjects({
      localProjects: delRes.remaining,
      idbProjects: [projA, projB],
      activeProject: projA,
      activeUndoState: createUndoRedoState(projA.snapshot),
      hasLocalEditsSinceMount: false,
    });
    assert.equal(reconciled.savedProjects.some((p: CreativeProject) => p.id === projB.id), false);

    // Late background autosave of deleted project without allowDeleted is also blocked
    const lateAutosave = saveProjectToLocalStorage(projB, {
      expectedPersistedRevision: projB.persistedRevision,
    });
    assert.equal(lateAutosave.saved, false);

    clearDeletedProjectId(projB.id);
    deleteProjectFromLocalStorage(projA.id);
  });

  it('IA-12: validates effective compiled prompt length at 8,000-char boundary without truncating user state', () => {
    const exact8000 = 'a'.repeat(MAX_PROMPT_CHARS);
    const over8001 = 'a'.repeat(MAX_PROMPT_CHARS + 1);

    const passRes = validateEffectivePromptLength(exact8000);
    assert.equal(passRes.ok, true);
    assert.equal(passRes.length, 8000);
    assert.equal(passRes.overBy, 0);

    const failRes = validateEffectivePromptLength(over8001);
    assert.equal(failRes.ok, false);
    assert.equal(failRes.length, 8001);
    assert.equal(failRes.overBy, 1);
    assert.ok(failRes.error?.includes('8,001'));
    assert.ok(failRes.error?.includes('8,000'));
  });

  it('IA-13: enforces configurable per-client rate limiting on /api/* endpoints', async () => {
    const stubHandlers: AiServiceHandlers = {
      analyzeBeliefGraph: async (prompt) => ({
        prompt,
        entities: [],
        relationships: [],
      }),
      generateClarificationsList: async () => [],
      refinePromptText: async (p) => p,
      generateStoryText: async () => 'Stub story',
      generateImagesBatch: async () => ({
        images: [],
        requestedCount: 4,
        failedCount: 0,
        warning: null,
      }),
      hasConfiguredGeminiKey: () => true,
    };

    const app = express();
    app.use(express.json());
    app.use(
      '/api',
      createApiRouter(stubHandlers, {
        rateLimitWindowMs: 60_000,
        maxRequestsPerWindow: 2,
      })
    );

    const server = app.listen(0);
    const address = server.address();
    const port = typeof address === 'object' && address ? address.port : 0;

    try {
      const makeCall = () =>
        fetch(`http://127.0.0.1:${port}/api/generate/story`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ prompt: 'Test rate limit' }),
        });

      const r1 = await makeCall();
      assert.equal(r1.status, 200);

      const r2 = await makeCall();
      assert.equal(r2.status, 200);

      const r3 = await makeCall();
      assert.equal(r3.status, 429);
      assert.ok(r3.headers.get('retry-after'));
      const body = (await r3.json()) as { error: { code: string; retryable: boolean } };
      assert.equal(body.error.code, 'RATE_LIMITED');
      assert.equal(body.error.retryable, true);
    } finally {
      server.close();
    }
  });

  it('IA-14: preserves both projects when two concurrent async operations settle in either order (A->B and B->A)', () => {
    for (const order of ['A_THEN_B', 'B_THEN_A'] as const) {
      const projA: CreativeProject = {
        ...createSampleProject(),
        id: 'proj_concurrent_a',
        name: 'Project Alpha',
      };
      const projB: CreativeProject = {
        ...createSampleProject(),
        id: 'proj_concurrent_b',
        name: 'Project Beta',
      };

      const ticketA = createRequestTicket(projA, 'generate');
      const ticketB = createRequestTicket(projB, 'analyze');

      let savedProjects = [projA, projB];
      let activeProject = projB; // User switched to Project B
      let activeUndoState = createUndoRedoState(projB.snapshot);

      const runA = () => {
        const resA = applyAsyncGenerationCompletion({
          ticket: ticketA,
          activeProject,
          savedProjects,
          mode: 'story',
          promptUsed: projA.snapshot.refinedPrompt,
          storyText: 'Generated story for Project Alpha',
        });
        activeProject = resA.activeProject;
        savedProjects = resA.savedProjects;
      };

      const runB = () => {
        const resB = applyAsyncAnalysisCompletion({
          ticket: ticketB,
          activeProject,
          activeUndoState,
          savedProjects,
          newGraph: {
            prompt: projB.snapshot.originalIdea,
            entities: [
              {
                name: 'badger',
                category: 'character',
                presence_in_prompt: true,
                description: 'A wise badger guest',
                alternatives: [],
                attributes: [],
              },
            ],
            relationships: [],
          },
          newClarifications: null,
          label: 'Analyze Beta',
          summary: 'Analyzed Project Beta',
        });
        activeProject = resB.activeProject;
        activeUndoState = resB.activeUndoState;
        savedProjects = resB.savedProjects;
      };

      if (order === 'A_THEN_B') {
        runA();
        runB();
      } else {
        runB();
        runA();
      }

      const finalA = savedProjects.find((p) => p.id === 'proj_concurrent_a');
      const finalB = savedProjects.find((p) => p.id === 'proj_concurrent_b');
      assert.ok(finalA, `Order ${order}: Project A must exist`);
      assert.ok(finalB, `Order ${order}: Project B must exist`);
      assert.equal(finalA.artifacts[0]?.storyText, 'Generated story for Project Alpha');
      assert.ok(finalB.snapshot.entities.some((e) => e.name === 'badger'));
    }
  });

  it('IA-15: benchmarks computeForceLayout on 50, 200, and 500 nodes with bounded execution time and finite coordinates', () => {
    for (const count of [50, 200, 500]) {
      const entities: Entity[] = Array.from({ length: count }, (_, idx) => ({
        id: `ent_${idx}`,
        name: `Entity_${idx}`,
        category: 'character',
        presence_in_prompt: true,
        description: `Description ${idx}`,
        alternatives: [],
        attributes: [],
      }));
      const relationships: Relationship[] = Array.from(
        { length: Math.min(count, 100) },
        (_, idx) => ({
          id: `rel_${idx}`,
          source: `Entity_${idx}`,
          target: `Entity_${(idx + 1) % count}`,
          label: 'knows',
        })
      );

      const dims = computeNodeDimensions(entities);
      const t0 = performance.now();
      const layout = computeForceLayout({
        objectEntities: entities,
        relationships,
        nodeDimensions: dims,
        containerWidth: 1000,
        containerHeight: 700,
      });
      const elapsedMs = performance.now() - t0;

      assert.equal(Object.keys(layout).length, count);
      for (const pos of Object.values(layout)) {
        assert.ok(Number.isFinite(pos.x) && Number.isFinite(pos.y));
      }
      assert.ok(
        elapsedMs < 2500,
        `computeForceLayout(${count} nodes) took ${elapsedMs.toFixed(1)}ms (expected < 2500ms)`
      );
    }
  });

  it('IA-16 & IA-19: verifies package.json engines.node >=22.6.0 and README accuracy', () => {
    const pkgRaw = fs.readFileSync(path.resolve(process.cwd(), 'package.json'), 'utf8');
    const pkg = JSON.parse(pkgRaw) as { engines?: { node?: string } };
    assert.equal(pkg.engines?.node, '>=22.6.0');

    const readme = fs.readFileSync(path.resolve(process.cwd(), 'README.md'), 'utf8');
    assert.ok(readme.includes('40` undo stack steps'));
    assert.ok(!readme.includes('(`60` steps)'));
    assert.ok(!readme.includes('D3 zoom/pan'));
    assert.ok(readme.includes('.env.local'));
    assert.ok(readme.includes('>=22.6.0'));
  });

  it('IA-17: builds structured Before -> After diff items and projected prompt for Review Modal', () => {
    const project = createSampleProject();
    const pendingDecision = project.snapshot.decisions.find(
      (d: DecisionItem) => d.status === 'pending'
    );
    assert.ok(pendingDecision);

    const batchPreview = interpretBatchInstructionLocally(
      'The party should be mysterious rather than cheerful.',
      project.snapshot,
      {
        projectId: project.id,
        revision: project.revision,
      }
    );

    const diffModel = buildReviewDiffModel({
      project,
      draftDecisionValues: { [pendingDecision.id]: 'Custom Lantern Valor' },
      stagedBatch: batchPreview,
    });

    assert.ok(diffModel.items.length >= 2);
    const customItem = diffModel.items.find((i) => i.id === pendingDecision.id);
    assert.ok(customItem);
    assert.equal(customItem.afterValue, 'Custom Lantern Valor');
    assert.notEqual(customItem.beforeValue, customItem.afterValue);

    const batchToneItem = diffModel.items.find(
      (i) => i.source === 'batch-preview' && i.targetLabel.includes('tone')
    );
    assert.ok(batchToneItem);
    assert.equal(batchToneItem.afterValue, 'mysterious');
    assert.ok(diffModel.afterPrompt.includes('mysterious'));
  });

  it('IA-20 through IA-25: preserves directed multigraph, seed override authority, and export/import round-trip', () => {
    let snap = createSampleProject().snapshot;

    // Directed multigraph: A -> B and B -> A coexist and can be reversed by ID
    snap = upsertRelationship(snap, 'Cat', 'Owl', 'hosts', 'user-edit');
    snap = upsertRelationship(snap, 'Owl', 'Cat', 'advises', 'user-edit');
    const owlToCat = snap.relationships.find(
      (r) => r.source === 'Owl' && r.target === 'Cat' && r.label === 'advises'
    );
    assert.ok(owlToCat?.id);

    const reversed = updateRelationshipById(snap, owlToCat.id, {
      reverseDirection: true,
      label: 'mentored by',
    });
    const updatedEdge = reversed.relationships.find((r) => r.id === owlToCat.id);
    assert.equal(updatedEdge?.source, 'Cat');
    assert.equal(updatedEdge?.target, 'Owl');
    assert.equal(updatedEdge?.label, 'mentored by');

    // Seed rename & exclude override authority
    const renamed = renameEntity(reversed, 'Cat', 'Captain Whiskers', 'user-edit');
    assert.ok(renamed.refinedPrompt.includes('Captain Whiskers'));
    const excluded = setEntityExistence(renamed, 'Fox', false);
    assert.ok(excluded.refinedPrompt.includes('Fox'));

    // Decision Inbox acceptance updates canonical state
    const pendingIds = excluded.decisions
      .filter((d: DecisionItem) => d.status === 'pending')
      .map((d: DecisionItem) => d.id);
    const accepted = applyDecisionBatch(excluded, pendingIds, 'accept');
    assert.ok(accepted.appliedCount > 0);

    // Export / Import round-trip + v1 video migration
    const fullProj: CreativeProject = {
      ...createSampleProject(),
      snapshot: accepted.snapshot,
    };
    const json = exportProjectToJson(fullProj);
    const reimported = migrateProjectPayload(JSON.parse(json));
    assert.equal(reimported.schemaVersion, 3);
    assert.equal(reimported.snapshot.refinedPrompt, accepted.snapshot.refinedPrompt);

    const legacyV1 = migrateProjectPayload({
      id: 'legacy_v1',
      name: 'Legacy Video Project',
      mode: 'video',
      prompt: 'A clockwork train in the clouds',
    });
    assert.equal(legacyV1.snapshot.mode, 'story');
  });
});
