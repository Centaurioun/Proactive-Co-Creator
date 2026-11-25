/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { describe, it, beforeEach } from 'node:test';
import {
  createSampleProject,
  setEntityAttribute,
  updateStoryBibleField,
} from '../lib/canonicalModel.ts';
import { createUndoRedoState } from '../lib/historyEngine.ts';
import {
  applyAsyncAnalysisCompletion,
  applyAsyncGenerationCompletion,
  commitRedoTransaction,
  commitSnapshotTransaction,
  commitUndoTransaction,
} from '../lib/projectController.ts';
import {
  clearDeletedProjectId,
  deleteProjectCompletely,
  loadProjectsFromIndexedDb,
  loadProjectsFromIndexedDbDetailed,
  loadProjectsFromLocalStorage,
  migrateProjectPayload,
  persistProjectDurably,
  reconcileHydratedProjects,
  reloadLatestProjectsFromStorage,
  saveProjectToIndexedDb,
  saveProjectToLocalStorage,
  simulateBrowserProcessRestartForTesting,
  verifyProjectCacheParity,
} from '../lib/storageEngine.ts';
import type { CreativeProject, GenerationArtifact } from '../shared/types.ts';

const SCHEMA_VERSION = 3;

class MockLocalStorage {
  private store = new Map<string, string>();
  public quotaLimitBytes: number | null = null;
  public failNextSetItemError: string | null = null;
  public setItemCalls = 0;

  getItem(key: string): string | null {
    return this.store.get(key) ?? null;
  }

  setItem(key: string, value: string): void {
    this.setItemCalls += 1;
    if (this.failNextSetItemError) {
      const msg = this.failNextSetItemError;
      this.failNextSetItemError = null;
      throw new Error(msg);
    }
    if (this.quotaLimitBytes !== null) {
      let currentTotal = 0;
      for (const [k, v] of this.store.entries()) {
        if (k !== key) currentTotal += v.length;
      }
      if (value.length > this.quotaLimitBytes || currentTotal + value.length > this.quotaLimitBytes) {
        const err = new Error('QuotaExceededError: Mock localStorage quota exceeded');
        err.name = 'QuotaExceededError';
        throw err;
      }
    }
    this.store.set(key, value);
  }

  removeItem(key: string): void {
    this.store.delete(key);
  }

  clear(): void {
    this.store.clear();
    this.quotaLimitBytes = null;
    this.failNextSetItemError = null;
    this.setItemCalls = 0;
  }
}

interface FakeIDBRequest<T = unknown> {
  result: T;
  error: Error | null;
  onsuccess: (() => void) | null;
  onerror: (() => void) | null;
  onupgradeneeded?: (() => void) | null;
}

class FakeIndexedDB {
  public records = new Map<string, unknown>();
  public failNextDelete: string | null = null;
  public failNextPut: string | null = null;
  public failNextGetAll: string | null = null;
  public abortNextPutWithQuota = false;
  public openDelayMs = 0;
  public getDelayMs = 0;

  reset(): void {
    this.records.clear();
    this.failNextDelete = null;
    this.failNextPut = null;
    this.failNextGetAll = null;
    this.abortNextPutWithQuota = false;
    this.openDelayMs = 0;
    this.getDelayMs = 0;
  }

  open(_name: string, _version?: number): FakeIDBRequest {
    const objectStoreNames = {
      contains: () => true,
    };

    const createTx = (_storeName: string, _mode: string) => {
      const tx: {
        error: Error | null;
        oncomplete: (() => void) | null;
        onerror: (() => void) | null;
        onabort: (() => void) | null;
        aborted: boolean;
        pendingOps: number;
        hasScheduledCompletion: boolean;
        abort: () => void;
        objectStore: () => {
          get: (key: string) => FakeIDBRequest;
          getAll: () => FakeIDBRequest;
          put: (val: { id: string }) => FakeIDBRequest;
          delete: (key: string) => FakeIDBRequest;
        };
      } = {
        error: null,
        oncomplete: null,
        onerror: null,
        onabort: null,
        aborted: false,
        pendingOps: 0,
        hasScheduledCompletion: false,
        abort() {
          if (tx.aborted) return;
          tx.aborted = true;
          tx.error = tx.error ?? new Error('Transaction aborted');
          setTimeout(() => {
            tx.onabort?.();
          }, 0);
        },
        objectStore: () => ({
          get: (key: string) => {
            tx.pendingOps += 1;
            const r: FakeIDBRequest = {
              result: undefined,
              error: null,
              onsuccess: null,
              onerror: null,
            };
            setTimeout(() => {
              if (tx.aborted) return;
              const found = this.records.get(key);
              r.result = found ? structuredClone(found) : undefined;
              r.onsuccess?.();
              tx.pendingOps -= 1;
              scheduleCompleteIfIdle();
            }, this.getDelayMs);
            return r;
          },
          getAll: () => {
            tx.pendingOps += 1;
            const r: FakeIDBRequest = {
              result: [],
              error: null,
              onsuccess: null,
              onerror: null,
            };
            setTimeout(() => {
              tx.pendingOps -= 1;
              if (tx.aborted) return;
              if (this.failNextGetAll) {
                const msg = this.failNextGetAll;
                this.failNextGetAll = null;
                const err = new Error(msg);
                r.error = err;
                tx.error = err;
                r.onerror?.();
                tx.onerror?.();
                return;
              }
              r.result = Array.from(this.records.values()).map((v) => structuredClone(v));
              r.onsuccess?.();
              scheduleCompleteIfIdle();
            }, 0);
            return r;
          },
          put: (val: { id: string }) => {
            tx.pendingOps += 1;
            const r: FakeIDBRequest = {
              result: val.id,
              error: null,
              onsuccess: null,
              onerror: null,
            };
            setTimeout(() => {
              tx.pendingOps -= 1;
              if (tx.aborted) return;
              if (this.abortNextPutWithQuota) {
                this.abortNextPutWithQuota = false;
                const qErr = new Error('QuotaExceededError: IndexedDB disk quota reached');
                qErr.name = 'QuotaExceededError';
                tx.error = qErr;
                tx.aborted = true;
                tx.onabort?.();
                return;
              }
              if (this.failNextPut) {
                const msg = this.failNextPut;
                this.failNextPut = null;
                const err = new Error(msg);
                r.error = err;
                tx.error = err;
                r.onerror?.();
                tx.onerror?.();
                return;
              }
              this.records.set(val.id, structuredClone(val));
              r.onsuccess?.();
              scheduleCompleteIfIdle();
            }, 0);
            return r;
          },
          delete: (key: string) => {
            tx.pendingOps += 1;
            const r: FakeIDBRequest = {
              result: undefined,
              error: null,
              onsuccess: null,
              onerror: null,
            };
            setTimeout(() => {
              tx.pendingOps -= 1;
              if (tx.aborted) return;
              if (this.failNextDelete) {
                const msg = this.failNextDelete;
                this.failNextDelete = null;
                const err = new Error(msg);
                r.error = err;
                tx.error = err;
                r.onerror?.();
                tx.onerror?.();
                return;
              }
              this.records.delete(key);
              r.onsuccess?.();
              scheduleCompleteIfIdle();
            }, 0);
            return r;
          },
        }),
      };

      const scheduleCompleteIfIdle = () => {
        if (tx.aborted || tx.pendingOps > 0 || tx.hasScheduledCompletion) return;
        tx.hasScheduledCompletion = true;
        setTimeout(() => {
          tx.hasScheduledCompletion = false;
          if (!tx.aborted && tx.pendingOps === 0) {
            tx.oncomplete?.();
          }
        }, 0);
      };

      return tx;
    };

    const db = {
      objectStoreNames,
      createObjectStore: () => ({}),
      transaction: createTx,
      close: () => {},
    };

    const req: FakeIDBRequest = {
      result: db,
      error: null,
      onsuccess: null,
      onerror: null,
      onupgradeneeded: null,
    };

    setTimeout(() => {
      req.onupgradeneeded?.();
      req.onsuccess?.();
    }, this.openDelayMs);

    return req;
  }
}

const mockStorage = new MockLocalStorage();
const fakeIdb = new FakeIndexedDB();

Object.defineProperty(globalThis, 'window', {
  value: {
    localStorage: mockStorage,
    indexedDB: fakeIdb,
  },
  writable: true,
  configurable: true,
});
Object.defineProperty(globalThis, 'localStorage', {
  value: mockStorage,
  writable: true,
  configurable: true,
});

describe('Storage & Lifecycle Defect Reproduction & Regression Suite (Defects 1–6)', () => {
  beforeEach(() => {
    mockStorage.clear();
    fakeIdb.reset();
  });

  it('Defect 1A: reloadLatestProjectsFromStorage reloads the truly latest valid project from IndexedDB and localStorage with complete snapshots, revisions, history, and artifacts', async () => {
    let proj = createSampleProject();
    let undo = createUndoRedoState(proj.snapshot);

    const snap2 = updateStoryBibleField(proj.snapshot, 'genre', 'Noir Mystery');
    ({ project: proj, undoState: undo } = commitSnapshotTransaction(
      proj,
      undo,
      snap2,
      'Set Genre Noir',
      'Changed genre to Noir Mystery'
    ));

    const snap3 = setEntityAttribute(proj.snapshot, 'Cat', 'Role', 'Host & Sleuth', 'user-edit');
    ({ project: proj } = commitSnapshotTransaction(
      proj,
      undo,
      snap3,
      'Set Cat Role',
      'Changed Cat role to Host & Sleuth'
    ));

    const noirArtifact: GenerationArtifact = {
      id: 'art_noir_1',
      projectId: proj.id,
      mode: 'story',
      createdAt: Date.now(),
      revisionId: proj.revisions[0]?.id ?? 'rev_3',
      sourceRevision: 3,
      promptUsed: 'Write opening chapter',
      promptDigest: 'digest_noir_1',
      storyText: 'Rain drummed against the stained glass...',
      warning: null,
      isOutdated: false,
    };
    proj = {
      ...proj,
      artifacts: [noirArtifact],
    };

    assert.equal(proj.revision, 3);
    assert.equal(proj.revisions.length, 3);
    assert.equal(proj.artifacts.length, 1);

    // Save older r2 in localStorage and newer r3 (with artifact) in IndexedDB
    const projR2: CreativeProject = {
      ...proj,
      revision: 2,
      persistedRevision: 2,
      snapshot: snap2,
      artifacts: [],
      revisions: proj.revisions.slice(1),
    };
    saveProjectToLocalStorage(projR2, { forceOverwrite: true });
    await saveProjectToIndexedDb(proj, { forceOverwrite: true });

    const reloaded = await reloadLatestProjectsFromStorage(proj.id);
    assert.equal(reloaded.activeProject.revision, 3);
    assert.equal(reloaded.activeProject.persistedRevision, 3);
    assert.equal(reloaded.activeProject.snapshot.storyBible.genre.value, 'Noir Mystery');
    assert.equal(reloaded.activeProject.artifacts.length, 1);
    assert.equal(reloaded.activeProject.artifacts[0].id, 'art_noir_1');
    assert.equal(reloaded.activeProject.revisions.length, 3);

    // Must preserve Undo history from reconciled revisions so Undo/Redo works after reload!
    assert.equal(reloaded.activeUndoState.past.length, 2);
    const undone = commitUndoTransaction(reloaded.activeProject, reloaded.activeUndoState);
    assert.equal(undone.changed, true);
    assert.equal(undone.undoneLabel, 'Set Cat Role');
    assert.equal(undone.project.revision, 4);

    const redone = commitRedoTransaction(undone.project, undone.undoState);
    assert.equal(redone.changed, true);
    assert.equal(redone.redoneLabel, 'Set Cat Role');
    assert.equal(redone.project.revision, 5);
  });

  it('Defect 1B: recovers user project from IndexedDB as activeProject even when localStorage was empty and auto-seeded a sample', async () => {
    const customProject: CreativeProject = {
      ...createSampleProject(),
      id: 'proj_user_custom_99',
      name: 'Clockwork Archipelago',
      updatedAt: Date.now() - 60_000, // saved 1 minute ago
      revision: 4,
      persistedRevision: 4,
    };
    await saveProjectToIndexedDb(customProject, { forceOverwrite: true });

    // localStorage is empty on initial mount -> loadProjectsFromLocalStorage creates a sample with updatedAt = now
    const initialLocal = loadProjectsFromLocalStorage();
    const idbProjects = await loadProjectsFromIndexedDb();

    const reconciled = reconcileHydratedProjects({
      localProjects: initialLocal.projects,
      idbProjects,
      activeProject: initialLocal.projects[0],
      activeUndoState: createUndoRedoState(initialLocal.projects[0].snapshot),
      hasLocalEditsSinceMount: false,
    });

    assert.equal(reconciled.activeProject.id, 'proj_user_custom_99');
    assert.equal(reconciled.activeProject.revision, 4);
    assert.equal(reconciled.upgradedFromIndexedDb, true);
  });

  it('Defect 2: atomic revision-based persistence (persistProjectDurably) does not report success when authoritative IndexedDB fails or aborts, and succeeds when only localStorage hits quota', async () => {
    const base = createSampleProject();
    const initialSave = await persistProjectDurably(base, { forceOverwrite: true });
    assert.equal(initialSave.saved, true);
    assert.equal(initialSave.persistedRevision, 1);

    // 1. Authoritative IndexedDB transaction aborts due to quota -> must not report saved: true or advance localStorage to r2
    const editedR2: CreativeProject = {
      ...base,
      revision: 2,
      persistedRevision: 1,
      snapshot: updateStoryBibleField(base.snapshot, 'themes', 'hubris vs nature'),
    };
    fakeIdb.abortNextPutWithQuota = true;

    const abortedRes = await persistProjectDurably(editedR2, { expectedPersistedRevision: 1 });
    assert.equal(abortedRes.saved, false);
    assert.equal(abortedRes.quotaExceeded, true);

    // Verify localStorage was NOT prematurely updated to revision 2 when authoritative IndexedDB failed
    const localAfterAbort = loadProjectsFromLocalStorage();
    const storedInLocal = localAfterAbort.projects.find((p) => p.id === base.id);
    assert.equal(storedInLocal?.revision, 1);

    // 2. When IndexedDB succeeds but localStorage hits QuotaExceededError, authoritative save succeeds AND flags quotaExceeded
    mockStorage.quotaLimitBytes = 10; // Force localStorage quota failure
    const idbOkLocalQuotaRes = await persistProjectDurably(editedR2, {
      expectedPersistedRevision: 1,
    });
    assert.equal(idbOkLocalQuotaRes.saved, true);
    assert.equal(idbOkLocalQuotaRes.quotaExceeded, true);
    assert.equal(idbOkLocalQuotaRes.persistedRevision, 2);
  });

  it('Defect 2 & 6 (Two-Tab Conflict): detects two-tab CAS conflicts across both localStorage and IndexedDB without overwriting newer revisions', async () => {
    const tab1 = createSampleProject();
    await persistProjectDurably(tab1, { forceOverwrite: true });

    // Tab 2 saves revision 2 durably
    const tab2Rev2: CreativeProject = {
      ...tab1,
      revision: 2,
      persistedRevision: 1,
      updatedAt: tab1.updatedAt + 500,
      snapshot: updateStoryBibleField(tab1.snapshot, 'setting', 'Tab 2 authoritative setting'),
    };
    const tab2Save = await persistProjectDurably(tab2Rev2, { expectedPersistedRevision: 1 });
    assert.equal(tab2Save.saved, true);

    // Tab 1 (still holding persistedRevision: 1) attempts to save its own revision 2
    const tab1StaleEdit: CreativeProject = {
      ...tab1,
      revision: 2,
      persistedRevision: 1,
      updatedAt: tab1.updatedAt + 600,
      snapshot: updateStoryBibleField(tab1.snapshot, 'setting', 'Tab 1 conflicting setting'),
    };
    const conflictRes = await persistProjectDurably(tab1StaleEdit, {
      expectedPersistedRevision: 1,
    });
    assert.equal(conflictRes.saved, false);
    assert.equal(conflictRes.conflictDetected, true);
    assert.equal(
      conflictRes.storedProject?.snapshot.storyBible.setting.value,
      'Tab 2 authoritative setting'
    );

    // Verify IndexedDB still holds Tab 2's setting
    const idbProjects = await loadProjectsFromIndexedDb();
    assert.equal(
      idbProjects.find((p) => p.id === tab1.id)?.snapshot.storyBible.setting.value,
      'Tab 2 authoritative setting'
    );
  });

  it('Defect 3: removes duplicate project deletion calls, surfaces IndexedDB deletion failures, and preserves surviving project IndexedDB state (commit e0004d0)', async () => {
    const appSource = fs.readFileSync(path.resolve(process.cwd(), 'App.tsx'), 'utf8');
    const deleteFnMatch = appSource.match(/const handleDeleteProject[\s\S]*?};/);
    assert.ok(deleteFnMatch, 'handleDeleteProject must exist in App.tsx');
    assert.equal(
      deleteFnMatch[0].includes('deleteProjectFromLocalStorage('),
      false,
      'handleDeleteProject should not call deleteProjectFromLocalStorage directly in addition to deleteProjectCompletely'
    );

    const survivingProj: CreativeProject = {
      ...createSampleProject(),
      id: 'proj_surviving_e0004d0',
      name: 'Surviving Project',
      revision: 1,
      persistedRevision: 1,
    };
    const doomedProj: CreativeProject = {
      ...createSampleProject(),
      id: 'proj_doomed_delete',
      name: 'Doomed Project',
      revision: 1,
      persistedRevision: 1,
    };

    // Save both at r1 in localStorage
    saveProjectToLocalStorage(survivingProj, { forceOverwrite: true });
    saveProjectToLocalStorage(doomedProj, { forceOverwrite: true });

    // Save survivingProj at r5 in IndexedDB (simulating localStorage quota fallback where IDB has newer state)
    const survivingIdbR5: CreativeProject = {
      ...survivingProj,
      revision: 5,
      persistedRevision: 5,
      snapshot: updateStoryBibleField(
        survivingProj.snapshot,
        'setting',
        'Authoritative Revision 5 in IDB'
      ),
    };
    await saveProjectToIndexedDb(survivingIdbR5, { forceOverwrite: true });
    await saveProjectToIndexedDb(doomedProj, { forceOverwrite: true });

    // 1. Simulate IndexedDB delete failure first
    fakeIdb.failNextDelete = 'Disk I/O error while removing IndexedDB record';
    const failedDel = await deleteProjectCompletely(doomedProj.id);
    assert.equal(failedDel.idbDeleted, false);
    assert.ok(failedDel.error?.includes('Disk I/O error'));

    // 2. Retry deletion cleanly and verify surviving project's r5 in IndexedDB was NOT overwritten by r1
    const cleanDel = await deleteProjectCompletely(doomedProj.id);
    assert.equal(cleanDel.idbDeleted, true);

    const idbRemaining = await loadProjectsFromIndexedDb();
    assert.equal(idbRemaining.length, 1);
    assert.equal(idbRemaining[0].id, survivingProj.id);
    assert.equal(idbRemaining[0].revision, 5);
    assert.equal(
      idbRemaining[0].snapshot.storyBible.setting.value,
      'Authoritative Revision 5 in IDB'
    );
    clearDeletedProjectId(doomedProj.id);
  });

  it('Defect 4: detects hydration conflicts (same-revision divergence, divergent revision lineage, and pre-hydration local edits) rather than silently ignoring them', () => {
    const base = createSampleProject();

    // Case A: Same-revision snapshot divergence
    const localBranchA: CreativeProject = {
      ...base,
      revision: 3,
      persistedRevision: 3,
      updatedAt: 1000,
      snapshot: updateStoryBibleField(base.snapshot, 'tone', 'Lighthearted Comedy'),
    };
    const idbBranchB: CreativeProject = {
      ...base,
      revision: 3,
      persistedRevision: 3,
      updatedAt: 1000,
      snapshot: updateStoryBibleField(base.snapshot, 'tone', 'Bleak Cosmic Horror'),
    };

    const sameRevConflict = reconcileHydratedProjects({
      localProjects: [localBranchA],
      idbProjects: [idbBranchB],
      activeProject: localBranchA,
      activeUndoState: createUndoRedoState(localBranchA.snapshot),
      hasLocalEditsSinceMount: false,
    });
    assert.ok(
      sameRevConflict.conflictWithHydrated,
      'Expected conflictWithHydrated when localStorage and IndexedDB have divergent snapshots at the same revision'
    );

    // Case B: Divergent lineage (localStorage is at r2, IndexedDB is at r3 whose revisions history does not include r2)
    const idbUnrelatedR3: CreativeProject = {
      ...base,
      revision: 3,
      persistedRevision: 3,
      updatedAt: 2000,
      snapshot: updateStoryBibleField(base.snapshot, 'tone', 'Hard Sci-Fi'),
      revisions: [
        {
          id: 'rev_unrelated_3',
          revisionNumber: 3,
          timestamp: 2000,
          label: 'Imported R3',
          summary: 'Unrelated lineage',
          changeCount: 1,
          snapshot: updateStoryBibleField(base.snapshot, 'tone', 'Hard Sci-Fi'),
        },
      ],
    };
    const localR2: CreativeProject = {
      ...base,
      revision: 2,
      persistedRevision: 2,
      updatedAt: 1500,
    };

    const lineageConflict = reconcileHydratedProjects({
      localProjects: [localR2],
      idbProjects: [idbUnrelatedR3],
      activeProject: localR2,
      activeUndoState: createUndoRedoState(localR2.snapshot),
      hasLocalEditsSinceMount: false,
    });
    assert.ok(
      lineageConflict.conflictWithHydrated,
      'Expected conflictWithHydrated when IndexedDB revision history does not contain the local revision lineage'
    );
  });

  it('Defect 5: prevents deleted projects from being resurrected by in-flight saves, quota-constrained deletes, or delayed AI completions', async () => {
    const projA = createSampleProject();
    const projB: CreativeProject = {
      ...createSampleProject(),
      id: 'proj_in_flight_delete',
      name: 'To Be Deleted Mid-Save',
    };

    saveProjectToLocalStorage(projA, { forceOverwrite: true });
    saveProjectToLocalStorage(projB, { forceOverwrite: true });
    await saveProjectToIndexedDb(projA, { forceOverwrite: true });
    await saveProjectToIndexedDb(projB, { forceOverwrite: true });

    // 1. Delay IndexedDB get so saveProjectToIndexedDb(projB) is in-flight when deleteProjectCompletely runs
    fakeIdb.getDelayMs = 40;
    const delayedSavePromise = saveProjectToIndexedDb(
      { ...projB, revision: 2 },
      { expectedPersistedRevision: 1 }
    );

    // Simulate tight localStorage quota during deletion -> memory tombstone must still block resurrection!
    mockStorage.quotaLimitBytes = 5;
    fakeIdb.getDelayMs = 0;
    const delRes = await deleteProjectCompletely(projB.id);
    assert.equal(delRes.idbDeleted, true);
    mockStorage.quotaLimitBytes = null;

    const lateSaveResult = await delayedSavePromise;
    assert.equal(
      lateSaveResult.saved,
      false,
      'In-flight save must abort and return saved: false after project is deleted'
    );

    const idbAfter = await loadProjectsFromIndexedDb();
    assert.equal(
      idbAfter.some((p) => p.id === projB.id),
      false,
      'Deleted project must not be resurrected in IndexedDB by an in-flight save'
    );

    // 2. Delayed async analysis and generation completions must also refuse to resurrect deleted projB
    const lateAnalysis = applyAsyncAnalysisCompletion({
      ticket: {
        requestId: 'req_late_1',
        action: 'analyze',
        projectId: projB.id,
        baseRevision: projB.revision,
        startedAt: Date.now(),
      },
      activeProject: projA,
      activeUndoState: createUndoRedoState(projA.snapshot),
      savedProjects: [projA, projB],
      newGraph: {
        entities: [
          {
            name: 'Ghost',
            category: 'character',
            presence_in_prompt: true,
            description: 'Apparition',
            alternatives: null,
            attributes: [],
          },
        ],
        relationships: [],
        prompt: 'Analyze late',
      },
      newClarifications: [],
    });
    assert.equal(lateAnalysis.appliedToActive, false);
    assert.equal(lateAnalysis.appliedToBackgroundProject, false);
    assert.equal(
      lateAnalysis.savedProjects.some((p) => p.id === projB.id),
      false,
      'Deleted project must be stripped from savedProjects on late analysis completion'
    );

    const lateGen = applyAsyncGenerationCompletion({
      ticket: {
        requestId: 'req_late_2',
        action: 'generate',
        projectId: projB.id,
        baseRevision: projB.revision,
        startedAt: Date.now(),
      },
      activeProject: projA,
      savedProjects: [projA, projB],
      mode: 'story',
      promptUsed: 'Generate late',
      storyText: 'Should be discarded',
    });
    assert.equal(lateGen.appliedToActive, false);
    assert.equal(lateGen.artifact, null);
    assert.equal(
      lateGen.savedProjects.some((p) => p.id === projB.id),
      false,
      'Deleted project must be stripped from savedProjects on late generation completion'
    );

    clearDeletedProjectId(projB.id);
  });

  it('Defect 6 (Migration): migrates v1 video projects and v2 projects to v3, preserves v2 backup, and prevents duplicate project IDs', () => {
    const legacyV1 = {
      id: 'proj_legacy_v1',
      name: 'Legacy Video World',
      mode: 'video',
      updatedAt: 1700000000000,
      entities: [
        {
          name: 'Inspector Vale',
          type: 'character',
          alternatives: [],
          attributes: [
            {
              name: 'Coat',
              value: [{ name: 'Trenchcoat', explanation: 'Classic noir' }],
            },
          ],
        },
      ],
      relationships: [],
      clarifications: [],
      outputs: [
        {
          id: 'out_1',
          type: 'story',
          prompt: 'Scene 1',
          CustomPrompt: 'Scene 1',
          content: 'Neon reflections on wet pavement.',
          timestamp: 1700000001000,
        },
      ],
    };

    const migrated = migrateProjectPayload(legacyV1);
    assert.ok(migrated);
    assert.equal(migrated.schemaVersion, SCHEMA_VERSION);
    assert.equal(migrated.snapshot.mode, 'story');
    assert.equal(migrated.snapshot.entities.length, 1);

    // Seed v2 storage key (map keyed by project id) with schemaVersion: 2 and verify loadProjectsFromLocalStorage migrates cleanly and backs up v2
    const v2Payload = {
      ...migrated,
      schemaVersion: 2,
    };
    mockStorage.setItem(
      'proactive_co_creator_projects_v2',
      JSON.stringify({ [v2Payload.id]: v2Payload })
    );

    const loaded = loadProjectsFromLocalStorage();
    assert.equal(loaded.projects.length, 1);
    assert.equal(loaded.projects[0].id, 'proj_legacy_v1');
    assert.equal(loaded.projects[0].schemaVersion, SCHEMA_VERSION);
    assert.ok(
      mockStorage.getItem('proactive_co_creator_backup_v2'),
      'Expected v2 backup key to be preserved during v2 -> v3 migration'
    );
  });

  it('FIX 1: IndexedDB read errors are distinguished from empty storage and never overwrite existing IndexedDB records', async () => {
    const existingUserProj: CreativeProject = {
      ...createSampleProject(),
      id: 'proj_precious_idb_1',
      name: 'Precious User World',
      revision: 7,
      persistedRevision: 7,
      snapshot: updateStoryBibleField(
        createSampleProject().snapshot,
        'setting',
        'Irreplaceable Glass Citadel'
      ),
    };
    await saveProjectToIndexedDb(existingUserProj, { forceOverwrite: true });

    // Direct detailed load check on read error
    fakeIdb.failNextGetAll = 'Simulated IndexedDB cursor read error';
    const detailedErr = await loadProjectsFromIndexedDbDetailed();
    assert.equal(detailedErr.status, 'read_error');
    assert.ok(detailedErr.error?.includes('Simulated IndexedDB cursor read error'));

    // Simulate an IndexedDB getAll read error during reloadLatestProjectsFromStorage while valid records exist in IndexedDB
    fakeIdb.failNextGetAll = 'Transient IndexedDB I/O read failure';

    const reloaded = await reloadLatestProjectsFromStorage();
    assert.equal(
      reloaded.idbStatus,
      'read_error',
      'Expected reloadLatestProjectsFromStorage to report idbStatus: "read_error" on IndexedDB read failure'
    );
    assert.equal(reloaded.persisted, false);

    // Ensure the existing record in IndexedDB was NOT overwritten by an auto-seeded sample project
    const rawIdbRecord = fakeIdb.records.get('proj_precious_idb_1') as CreativeProject | undefined;
    assert.ok(rawIdbRecord, 'Precious IndexedDB record must still exist');
    assert.equal(rawIdbRecord.revision, 7);
    assert.equal(
      rawIdbRecord.snapshot.storyBible.setting.value,
      'Irreplaceable Glass Citadel'
    );
  });

  it('FIX 2: reloadLatestProjectsFromStorage is non-destructive when localStorage and IndexedDB hold divergent Story Bible values at the same revision', async () => {
    const base = createSampleProject();
    const localVersion: CreativeProject = {
      ...base,
      revision: 3,
      persistedRevision: 3,
      updatedAt: 1000,
      snapshot: updateStoryBibleField(base.snapshot, 'genre', 'Solar Punk Utopia'),
    };
    const idbVersion: CreativeProject = {
      ...base,
      revision: 3,
      persistedRevision: 3,
      updatedAt: 2000,
      snapshot: updateStoryBibleField(base.snapshot, 'genre', 'Gothic Cyberpunk'),
    };

    saveProjectToLocalStorage(localVersion, { forceOverwrite: true });
    await saveProjectToIndexedDb(idbVersion, { forceOverwrite: true });

    // Calling reloadLatestProjectsFromStorage without explicit conflict resolution must NOT overwrite either store
    const reloadRes = await reloadLatestProjectsFromStorage(base.id);
    assert.equal(
      reloadRes.conflictDetected,
      true,
      'Expected reloadLatestProjectsFromStorage to report conflictDetected: true on same-revision divergent Story Bible values'
    );
    assert.equal(reloadRes.persisted, false);
    assert.ok(reloadRes.alternateProject, 'Expected alternateProject to be preserved for user comparison');

    const localAfter = loadProjectsFromLocalStorage().projects.find((p) => p.id === base.id);
    const idbAfter = (await loadProjectsFromIndexedDb()).find((p) => p.id === base.id);
    assert.equal(
      localAfter?.snapshot.storyBible.genre.value,
      'Solar Punk Utopia',
      'localStorage version must remain intact and recoverable until conflict is explicitly resolved'
    );
    assert.equal(
      idbAfter?.snapshot.storyBible.genre.value,
      'Gothic Cyberpunk',
      'IndexedDB version must remain intact and recoverable until conflict is explicitly resolved'
    );

    // Explicit resolution ('prefer-idb') resolves the conflict and verifies persistence
    const resolved = await reloadLatestProjectsFromStorage(base.id, { resolution: 'prefer-idb' });
    assert.equal(resolved.conflictDetected, false);
    assert.equal(resolved.persisted, true);
    assert.equal(resolved.activeProject.snapshot.storyBible.genre.value, 'Gothic Cyberpunk');
  });

  it('FIX 3: persistProjectDurably treats IndexedDB as authoritative, never invalidates a committed IDB write on localStorage failure, and blocks stale same-revision writes', async () => {
    const base = createSampleProject();
    await persistProjectDurably(base, { forceOverwrite: true });

    // 1. Stale same-revision write with a different snapshot must be rejected by CAS
    const sameRevDivergent: CreativeProject = {
      ...base,
      revision: 1,
      persistedRevision: 1,
      updatedAt: base.updatedAt + 1000,
      snapshot: updateStoryBibleField(base.snapshot, 'setting', 'Stale Same-Revision Mutation'),
    };
    const sameRevAttempt = await persistProjectDurably(sameRevDivergent, {
      expectedPersistedRevision: 1,
    });
    assert.equal(
      sameRevAttempt.saved,
      false,
      'Stale same-revision write with a divergent snapshot must not overwrite existing revision 1'
    );
    assert.equal(sameRevAttempt.conflictDetected, true);

    // 2. IndexedDB saves revision 12, while localStorage has a stale higher revision or throws non-quota error
    // Even if localStorage cache is out of sync or fails, committed IndexedDB revision 12 must succeed and report cache warning
    const rev12: CreativeProject = {
      ...base,
      revision: 12,
      persistedRevision: 1,
      updatedAt: base.updatedAt + 5000,
      snapshot: updateStoryBibleField(base.snapshot, 'setting', 'Authoritative Revision 12 Sanctuary'),
    };
    mockStorage.failNextSetItemError = 'SecurityError: localStorage access denied in iframe';
    const save12Res = await persistProjectDurably(rev12, { expectedPersistedRevision: 1 });
    assert.equal(save12Res.saved, true, 'Authoritative IndexedDB save of r12 must report saved: true');
    assert.equal(save12Res.persistedRevision, 12);
    assert.equal(
      save12Res.cacheSynced,
      false,
      'Expected cacheSynced: false when localStorage cache write fails after IndexedDB commit'
    );
    assert.ok(
      save12Res.cacheWarning,
      'Expected cacheWarning when localStorage cache fails after IndexedDB commit'
    );

    const reloadedAfter12 = await reloadLatestProjectsFromStorage(base.id);
    assert.equal(reloadedAfter12.activeProject.revision, 12);
    assert.equal(
      reloadedAfter12.activeProject.snapshot.storyBible.setting.value,
      'Authoritative Revision 12 Sanctuary'
    );
  });

  it('reconciles an idempotent retry from the latest IndexedDB project instead of its stale prepared candidate', async () => {
    const base = createSampleProject();
    await persistProjectDurably(base, { forceOverwrite: true });
    const intentId = 'fix_storage_replay_authority';
    const candidate = {
      ...base,
      revision: 2,
      updatedAt: base.updatedAt + 1,
      snapshot: updateStoryBibleField(base.snapshot, 'genre', 'First committed result'),
    };
    const firstWrite = await persistProjectDurably(candidate, {
      expectedPersistedRevision: base.revision,
      intentId,
    });
    assert.equal(firstWrite.saved, true);

    const changedOutsideSnapshot = { ...candidate, name: `${candidate.name} with different operation content` };
    const reusedIntent = await persistProjectDurably(changedOutsideSnapshot, {
      expectedPersistedRevision: base.revision,
      intentId,
    });
    assert.equal(reusedIntent.saved, false, 'A reused intent ID with changed project content must fail closed.');
    assert.equal(reusedIntent.conflictDetected, true);

    const newer = {
      ...candidate,
      revision: 3,
      updatedAt: candidate.updatedAt + 1,
      snapshot: updateStoryBibleField(candidate.snapshot, 'genre', 'Newer authoritative result'),
    };
    assert.equal((await persistProjectDurably(newer, { expectedPersistedRevision: 2 })).saved, true);

    mockStorage.failNextSetItemError = 'SecurityError: localStorage access denied during idempotent replay';
    const replay = await persistProjectDurably(candidate, {
      expectedPersistedRevision: base.revision,
      intentId,
    });
    assert.equal(replay.saved, true);
    assert.equal(replay.idempotentHit, true);
    assert.equal(replay.cacheSynced, false, 'Idempotent replay must disclose a failed local cache reconciliation.');
    assert.equal(replay.storedProject?.revision, 3);
    assert.equal(replay.storedProject?.snapshot.storyBible.genre.value, 'Newer authoritative result');
  });

  it('FIX 4: isSnapshotSemanticallyEqual compares answeredQuestions, skippedQuestions, clarification targets/options, and decision metadata', async () => {
    const { isSnapshotSemanticallyEqual } = await import('../lib/historyEngine.ts');
    const snapA = createSampleProject().snapshot;
    const snapB = {
      ...structuredClone(snapA),
      answeredQuestions: [...snapA.answeredQuestions, 'q_host_motive'],
    };
    const snapC = {
      ...structuredClone(snapA),
      skippedQuestions: [...snapA.skippedQuestions, 'q_lighting'],
    };
    const snapD = structuredClone(snapA);
    if (snapD.clarifications.length > 0) {
      snapD.clarifications[0] = {
        ...snapD.clarifications[0],
        options: [...snapD.clarifications[0].options, 'Secret Society'],
      };
    }

    assert.equal(
      isSnapshotSemanticallyEqual(snapA, snapB),
      false,
      'Snapshots differing in answeredQuestions must not be semantically equal'
    );
    assert.equal(
      isSnapshotSemanticallyEqual(snapA, snapC),
      false,
      'Snapshots differing in skippedQuestions must not be semantically equal'
    );
    assert.equal(
      isSnapshotSemanticallyEqual(snapA, snapD),
      false,
      'Snapshots differing in clarification options/targets must not be semantically equal'
    );
  });

  it('FIX 5: preserves Undo/Redo cursor and future stack across browser reloads (Edit -> Undo -> Save -> Reload -> Redo)', async () => {
    let proj = createSampleProject();
    let undo = createUndoRedoState(proj.snapshot, proj.revisions);

    // Step 1: Edit (r1 -> r2)
    const editedSnap = updateStoryBibleField(proj.snapshot, 'genre', 'Clockwork Fantasy');
    ({ project: proj, undoState: undo } = commitSnapshotTransaction(
      proj,
      undo,
      editedSnap,
      'Set Genre Clockwork',
      'Updated genre to Clockwork Fantasy'
    ));
    assert.equal(proj.revision, 2);

    // Step 2: Undo (r2 -> r3, restoring r1 snapshot and placing r2 in undo.future)
    const undone = commitUndoTransaction(proj, undo);
    assert.equal(undone.changed, true);
    proj = undone.project;
    undo = undone.undoState;
    assert.equal(proj.revision, 3);
    assert.equal(undo.future.length, 1);

    // Step 3: Save and Reload
    await persistProjectDurably(proj, { forceOverwrite: true });
    const reloaded = await reloadLatestProjectsFromStorage(proj.id);

    // Step 4: Redo after reload must restore the Clockwork Fantasy snapshot!
    assert.equal(
      reloaded.activeUndoState.future.length,
      1,
      'Reloaded undoState must preserve the Redo future stack after Undo -> Save -> Reload'
    );
    const redone = commitRedoTransaction(reloaded.activeProject, reloaded.activeUndoState);
    assert.equal(redone.changed, true);
    assert.equal(redone.redoneLabel, 'Set Genre Clockwork');
    assert.equal(redone.project.revision, 4);
    assert.equal(redone.project.snapshot.storyBible.genre.value, 'Clockwork Fantasy');

    // Step 5: Undo again, then make a new divergent edit -> Redo branch must be cleared
    const undoneAgain = commitUndoTransaction(redone.project, redone.undoState);
    assert.equal(undoneAgain.undoState.future.length, 1);
    const divergentSnap = updateStoryBibleField(
      undoneAgain.project.snapshot,
      'genre',
      'Mythic Western'
    );
    const afterNewEdit = commitSnapshotTransaction(
      undoneAgain.project,
      undoneAgain.undoState,
      divergentSnap,
      'Set Genre Mythic Western'
    );
    assert.equal(afterNewEdit.undoState.future.length, 0);
  });

  it('FIX 6: deleted project does not resurrect after browser reload even when IndexedDB deletion fails and localStorage is at quota', async () => {
    const surviving: CreativeProject = {
      ...createSampleProject(),
      id: 'proj_surviving_fix6',
      name: 'Surviving Project',
      artifacts: [
        {
          id: 'art_large_cache',
          projectId: 'proj_surviving_fix6',
          mode: 'story',
          createdAt: Date.now(),
          revisionId: 'rev_1',
          sourceRevision: 1,
          promptUsed: 'Large cached story',
          promptDigest: 'd1',
          storyText: 'X'.repeat(5000),
          isOutdated: false,
        },
      ],
    };
    const deletedProj: CreativeProject = {
      ...createSampleProject(),
      id: 'proj_deleted_fix6',
      name: 'Deleted Project Under Quota',
    };

    saveProjectToLocalStorage(surviving, { forceOverwrite: true });
    await saveProjectToIndexedDb(surviving, { forceOverwrite: true });
    await saveProjectToIndexedDb(deletedProj, { forceOverwrite: true });

    // Set localStorage quota limit tight enough that writing new full-size items fails unless cache is compacted,
    // and force IndexedDB delete to fail
    mockStorage.quotaLimitBytes = 2500;
    fakeIdb.failNextDelete = 'IndexedDB disk lock prevented delete';

    const delRes = await deleteProjectCompletely(deletedProj.id);
    assert.equal(delRes.idbDeleted, false);
    assert.equal(delRes.tombstonePersisted, true);

    // Simulate full browser process restart (wiping both RAM tombstone set and sessionStorage)
    simulateBrowserProcessRestartForTesting();

    const reloaded = await reloadLatestProjectsFromStorage();
    assert.equal(
      reloaded.projects.some((p) => p.id === deletedProj.id),
      false,
      'Deleted project must not resurrect after browser reload even when IDB delete failed and localStorage was near quota'
    );
    assert.equal(
      reloaded.projects.some((p) => p.id === surviving.id),
      true,
      'Surviving project must remain intact'
    );
    clearDeletedProjectId(deletedProj.id);
  });
});

describe('T4: Hydration Write Gate & Deletion Content Parity (ST-01 through ST-10)', () => {
  beforeEach(() => {
    mockStorage.clear();
    fakeIdb.reset();
    simulateBrowserProcessRestartForTesting();
  });

  it('T4.1–T4.3: Hydration write gate blocks unsolicited writes on read_error, unblocks unavailable IDB, and reconciles edited memory on retry cleanly', async () => {
    const controllerMod = (await import('../lib/projectController.ts')) as Record<string, unknown>;
    assert.equal(
      typeof controllerMod.resolveHydrationWriteGate,
      'function',
      'resolveHydrationWriteGate helper must be exported from projectController'
    );
    assert.equal(
      typeof controllerMod.shouldAllowUnsolicitedPersistence,
      'function',
      'shouldAllowUnsolicitedPersistence helper must be exported from projectController'
    );

    const resolveGate = controllerMod.resolveHydrationWriteGate as (s: string) => string;
    const allowWrite = controllerMod.shouldAllowUnsolicitedPersistence as (p: {
      hydrationGate: string;
      hasLocalEditsSinceMount: boolean;
      isDeleted: boolean;
      storageAlertType?: 'conflict' | 'quota' | 'error' | null;
      storageAlertProjectId?: string | null;
      activeProjectId: string;
    }) => boolean;

    // T4.1: read_error -> blocked-read-error blocks all unsolicited persistence even with local edits
    const gateOnErr = resolveGate('read_error');
    assert.equal(gateOnErr, 'blocked-read-error');
    assert.equal(
      allowWrite({
        hydrationGate: gateOnErr,
        hasLocalEditsSinceMount: false,
        isDeleted: false,
        storageAlertType: 'error',
        storageAlertProjectId: 'proj_1',
        activeProjectId: 'proj_1',
      }),
      false
    );
    assert.equal(
      allowWrite({
        hydrationGate: gateOnErr,
        hasLocalEditsSinceMount: true,
        isDeleted: false,
        storageAlertType: 'error',
        storageAlertProjectId: 'proj_1',
        activeProjectId: 'proj_1',
      }),
      false
    );

    // T4.3: unavailable IDB must allow localStorage fallback writes
    const gateUnavailable = resolveGate('unavailable');
    assert.equal(gateUnavailable, 'unavailable');
    assert.equal(
      allowWrite({
        hydrationGate: gateUnavailable,
        hasLocalEditsSinceMount: false,
        isDeleted: false,
        storageAlertType: null,
        storageAlertProjectId: null,
        activeProjectId: 'proj_1',
      }),
      true
    );

    // T4.3 actual localStorage fallback round-trip when indexedDB is unavailable
    const prevIdb = (globalThis.window as { indexedDB?: unknown }).indexedDB;
    try {
      (globalThis.window as { indexedDB?: unknown }).indexedDB = undefined;
      const legacyProj: CreativeProject = {
        ...createSampleProject(),
        id: 'proj_legacy_no_idb',
        name: 'No IDB Environment',
        revision: 2,
        persistedRevision: 1,
        snapshot: updateStoryBibleField(createSampleProject().snapshot, 'genre', 'Solarpunk'),
      };
      const saveFallback = await persistProjectDurably(legacyProj, {
        expectedPersistedRevision: 1,
      });
      assert.equal(saveFallback.saved, true);
      assert.equal(saveFallback.authoritativeStore, 'localstorage');
      const loadedFallback = await reloadLatestProjectsFromStorage(legacyProj.id);
      assert.equal(loadedFallback.idbStatus, 'unavailable');
      assert.equal(loadedFallback.activeProject.snapshot.storyBible.genre.value, 'Solarpunk');
    } finally {
      (globalThis.window as { indexedDB?: unknown }).indexedDB = prevIdb;
    }

    // T4.2: retry while user edited in memory must preserve both IDB and local edits via conflict instead of silent clobber
    const idbAuthoritative: CreativeProject = {
      ...createSampleProject(),
      id: 'proj_retry_reconcile',
      name: 'Precious IDB World',
      revision: 5,
      persistedRevision: 5,
      snapshot: updateStoryBibleField(createSampleProject().snapshot, 'setting', 'Clockwork Observatory'),
    };
    await saveProjectToIndexedDb(idbAuthoritative, { forceOverwrite: true });
    const inMemoryEdit: CreativeProject = {
      ...createSampleProject(),
      id: 'proj_retry_reconcile',
      name: 'Precious IDB World',
      revision: 2,
      persistedRevision: 1,
      snapshot: updateStoryBibleField(createSampleProject().snapshot, 'setting', 'Local Offline Edit'),
    };
    const retryRes = await reloadLatestProjectsFromStorage(inMemoryEdit.id, {
      inMemoryActiveProject: inMemoryEdit,
      hasLocalEditsSinceMount: true,
    } as Record<string, unknown>);
    assert.equal(retryRes.conflictDetected, true);
    const idbCheck = await loadProjectsFromIndexedDb();
    assert.equal(
      idbCheck.find((p) => p.id === inMemoryEdit.id)?.snapshot.storyBible.setting.value,
      'Clockwork Observatory',
      'Retrying storage read while user edited offline must preserve IDB record cleanly'
    );
  });

  it('T4.5: same artifact count (1) with different artifact IDs fails content parity and refuses local compaction under quota', async () => {
    const survivingId = 'proj_t4_5_surviving';
    const doomedId = 'proj_t4_5_doomed';
    const base = createSampleProject();
    const localOnlyArtifact: GenerationArtifact = {
      id: 'art_local_unique_1',
      projectId: survivingId,
      mode: 'story',
      createdAt: 1000,
      revisionId: 'rev_1',
      sourceRevision: 1,
      promptUsed: 'Prompt A',
      promptDigest: 'digest_a',
      storyText: 'Local-only unbacked story draft '.repeat(120),
      isOutdated: false,
    };
    const idbDifferentArtifact: GenerationArtifact = {
      ...localOnlyArtifact,
      id: 'art_idb_different_1',
      storyText: 'Different IDB story draft',
    };

    const survivingLocal: CreativeProject = {
      ...base,
      id: survivingId,
      name: 'Surviving Local Diff ID',
      revision: 3,
      persistedRevision: 3,
      artifacts: [localOnlyArtifact],
    };
    const survivingIdb: CreativeProject = {
      ...survivingLocal,
      artifacts: [idbDifferentArtifact],
    };
    const doomedProj: CreativeProject = {
      ...base,
      id: doomedId,
      name: 'Doomed Project',
    };

    mockStorage.setItem('proactive_co_creator_backup_v2', JSON.stringify({ backup: 'keep-me' }));
    saveProjectToLocalStorage(survivingLocal, { forceOverwrite: true });
    saveProjectToLocalStorage(doomedProj, { forceOverwrite: true });
    await saveProjectToIndexedDb(survivingIdb, { forceOverwrite: true });
    await saveProjectToIndexedDb(doomedProj, { forceOverwrite: true });

    mockStorage.quotaLimitBytes = 1200;
    const delRes = await deleteProjectCompletely(doomedId);
    mockStorage.quotaLimitBytes = null;

    assert.equal(delRes.incompleteDeletion, true, 'Must flag incomplete deletion when compaction is unsafe');
    assert.ok(mockStorage.getItem('proactive_co_creator_backup_v2'), 'Backup v2 must be preserved');
    const localAfter = loadProjectsFromLocalStorage().projects.find((p) => p.id === survivingId);
    assert.ok(localAfter, 'Surviving local project must remain intact');
    assert.equal(localAfter.artifacts.length, 1, 'Local-only artifact must NOT be compacted away');
    assert.equal(localAfter.artifacts[0].id, 'art_local_unique_1');
    clearDeletedProjectId(doomedId);
  });

  it('T4.6: same artifact count and same ID with different payload, OR same revision with divergent revision snapshot/undo future fails parity', async () => {
    const survivingId = 'proj_t4_6_surviving';
    const doomedId = 'proj_t4_6_doomed';
    const base = createSampleProject();
    const undoR2 = updateStoryBibleField(base.snapshot, 'tone', 'Somber Tragedy');
    const undoR2Alt = updateStoryBibleField(base.snapshot, 'tone', 'Whimsical Comedy');

    const sharedArtLocal: GenerationArtifact = {
      id: 'art_same_id',
      projectId: survivingId,
      mode: 'story',
      createdAt: 1000,
      revisionId: 'rev_1',
      sourceRevision: 1,
      promptUsed: 'Write scene',
      promptDigest: 'd1',
      storyText: 'Critical unique local text payload '.repeat(120),
      images: ['data:image/png;base64,LOCALDATA'],
      isOutdated: false,
    };
    const sharedArtIdb: GenerationArtifact = {
      ...sharedArtLocal,
      storyText: 'Altered different IDB text payload '.repeat(120),
      images: ['data:image/png;base64,IDBDATA'],
    };

    const survivingLocal: CreativeProject = {
      ...base,
      id: survivingId,
      name: 'Same ID Diff Content',
      revision: 3,
      persistedRevision: 3,
      artifacts: [sharedArtLocal],
      undoHistory: {
        past: [{ label: 'Edit 1', snapshot: base.snapshot }],
        future: [{ label: 'Redo Local Future', snapshot: undoR2 }],
      },
    };
    const survivingIdb: CreativeProject = {
      ...survivingLocal,
      artifacts: [sharedArtIdb],
      undoHistory: {
        past: [{ label: 'Edit 1', snapshot: base.snapshot }],
        future: [{ label: 'Redo IDB Future', snapshot: undoR2Alt }],
      },
    };
    const doomedProj: CreativeProject = {
      ...base,
      id: doomedId,
      name: 'Doomed Project 2',
    };

    saveProjectToLocalStorage(survivingLocal, { forceOverwrite: true });
    saveProjectToLocalStorage(doomedProj, { forceOverwrite: true });
    await saveProjectToIndexedDb(survivingIdb, { forceOverwrite: true });
    await saveProjectToIndexedDb(doomedProj, { forceOverwrite: true });

    mockStorage.quotaLimitBytes = 1200;
    const delRes = await deleteProjectCompletely(doomedId);
    mockStorage.quotaLimitBytes = null;

    assert.equal(delRes.incompleteDeletion, true);
    const localAfter = loadProjectsFromLocalStorage().projects.find((p) => p.id === survivingId);
    assert.ok(localAfter);
    assert.equal(localAfter.artifacts.length, 1);
    assert.ok(localAfter.artifacts[0].storyText?.includes('Critical unique local text payload'));
    clearDeletedProjectId(doomedId);
  });

  it('T4.7: strictly higher IDB revision missing a local-only artifact fails parity closed', async () => {
    const survivingId = 'proj_t4_7_surviving';
    const doomedId = 'proj_t4_7_doomed';
    const base = createSampleProject();
    const localArt: GenerationArtifact = {
      id: 'art_local_orphan',
      projectId: survivingId,
      mode: 'story',
      createdAt: 1000,
      revisionId: 'rev_2',
      sourceRevision: 2,
      promptUsed: 'Local chapter',
      promptDigest: 'd_local',
      storyText: 'Unbacked local story '.repeat(120),
      isOutdated: false,
    };

    const localR2: CreativeProject = {
      ...base,
      id: survivingId,
      name: 'Higher Rev Parity Trap',
      revision: 2,
      persistedRevision: 2,
      artifacts: [localArt],
    };
    const idbR5WithoutLocalArt: CreativeProject = {
      ...localR2,
      revision: 5,
      persistedRevision: 5,
      artifacts: [
        {
          id: 'art_idb_newer',
          projectId: survivingId,
          mode: 'story',
          createdAt: 2000,
          revisionId: 'rev_5',
          sourceRevision: 5,
          promptUsed: 'Newer chapter',
          promptDigest: 'd_newer',
          storyText: 'Newer IDB story',
          isOutdated: false,
        },
      ],
      revisions: [
        ...localR2.revisions,
        {
          id: 'rev_5',
          revisionNumber: 5,
          timestamp: 2000,
          label: 'Advance to R5',
          summary: 'R5',
          changeCount: 1,
          snapshot: updateStoryBibleField(localR2.snapshot, 'genre', 'Mystery'),
        },
      ],
    };
    const doomedProj: CreativeProject = { ...base, id: doomedId, name: 'Doomed T4.7' };

    saveProjectToLocalStorage(localR2, { forceOverwrite: true });
    saveProjectToLocalStorage(doomedProj, { forceOverwrite: true });
    await saveProjectToIndexedDb(idbR5WithoutLocalArt, { forceOverwrite: true });
    await saveProjectToIndexedDb(doomedProj, { forceOverwrite: true });

    mockStorage.quotaLimitBytes = 1200;
    const delRes = await deleteProjectCompletely(doomedId);
    mockStorage.quotaLimitBytes = null;

    assert.equal(delRes.incompleteDeletion, true);
    const localAfter = loadProjectsFromLocalStorage().projects.find((p) => p.id === survivingId);
    assert.ok(localAfter);
    assert.equal(localAfter.artifacts.length, 1);
    assert.equal(localAfter.artifacts[0].id, 'art_local_orphan');
    clearDeletedProjectId(doomedId);
  });

  it('T4.8: exact IDB content parity allows safe cache compaction under tight quota and full reload reproduces exact content', async () => {
    const survivingId = 'proj_t4_8_surviving';
    const doomedId = 'proj_t4_8_doomed';
    const base = createSampleProject();
    const art: GenerationArtifact = {
      id: 'art_verified_mirror',
      projectId: survivingId,
      mode: 'story',
      createdAt: 1000,
      revisionId: base.revisions[0]?.id ?? 'rev_1',
      sourceRevision: 1,
      promptUsed: 'Mirrored prompt',
      promptDigest: 'd_mirror',
      storyText: 'Large mirrored story text '.repeat(140),
      isOutdated: false,
    };
    const survivingExact: CreativeProject = {
      ...base,
      id: survivingId,
      name: 'Verified Mirror Project',
      revision: 2,
      persistedRevision: 2,
      artifacts: [art],
      undoHistory: {
        past: [{ label: 'Initial', snapshot: base.snapshot }],
        future: [{ label: 'Future Redo', snapshot: updateStoryBibleField(base.snapshot, 'tone', 'Tense') }],
      },
    };
    const doomedProj: CreativeProject = { ...base, id: doomedId, name: 'Doomed T4.8' };

    mockStorage.setItem('proactive_co_creator_backup_v2', JSON.stringify({ intact: true }));
    saveProjectToLocalStorage(survivingExact, { forceOverwrite: true });
    saveProjectToLocalStorage(doomedProj, { forceOverwrite: true });
    await saveProjectToIndexedDb(survivingExact, { forceOverwrite: true });
    await saveProjectToIndexedDb(doomedProj, { forceOverwrite: true });

    // Tight quota where surviving + tombstone only fit once cached artifact is compacted
    const fullLocalSize = (mockStorage.getItem('proactive_co_creator_projects_v2') ?? '').length;
    mockStorage.quotaLimitBytes = Math.max(1800, fullLocalSize - 1500);
    const delRes = await deleteProjectCompletely(doomedId);
    mockStorage.quotaLimitBytes = null;

    assert.equal(delRes.tombstonePersisted, true);
    assert.equal(delRes.incompleteDeletion, false);
    assert.ok(mockStorage.getItem('proactive_co_creator_backup_v2'));

    const reloaded = await reloadLatestProjectsFromStorage(survivingId);
    assert.equal(reloaded.activeProject.id, survivingId);
    assert.equal(reloaded.activeProject.artifacts.length, 1);
    assert.equal(reloaded.activeProject.artifacts[0].id, 'art_verified_mirror');
    assert.equal(reloaded.activeUndoState.future.length, 1);
    clearDeletedProjectId(doomedId);
  });

  it('T4.9: IDB read_error or unavailable during deletion preserves backups and unrelated local projects and marks incompleteDeletion', async () => {
    const survivingId = 'proj_t4_9_surviving';
    const doomedId = 'proj_t4_9_doomed';
    const base = createSampleProject();
    const surviving: CreativeProject = {
      ...base,
      id: survivingId,
      name: 'Surviving T4.9',
      artifacts: [
        {
          id: 'art_t4_9',
          projectId: survivingId,
          mode: 'story',
          createdAt: 1000,
          revisionId: 'rev_1',
          sourceRevision: 1,
          promptUsed: 'Keep me',
          promptDigest: 'k1',
          storyText: 'Important local story '.repeat(120),
          isOutdated: false,
        },
      ],
    };
    const doomedProj: CreativeProject = { ...base, id: doomedId, name: 'Doomed T4.9' };

    mockStorage.setItem('proactive_co_creator_backup_v2', JSON.stringify({ critical: 'backup' }));
    saveProjectToLocalStorage(surviving, { forceOverwrite: true });
    saveProjectToLocalStorage(doomedProj, { forceOverwrite: true });
    await saveProjectToIndexedDb(surviving, { forceOverwrite: true });
    await saveProjectToIndexedDb(doomedProj, { forceOverwrite: true });

    mockStorage.quotaLimitBytes = 1200;
    fakeIdb.failNextGetAll = 'Simulated IDB read failure during quota parity check';
    const delRes = await deleteProjectCompletely(doomedId);
    mockStorage.quotaLimitBytes = null;

    assert.equal(delRes.incompleteDeletion, true);
    assert.equal(delRes.preservedBackups, true);
    assert.ok(mockStorage.getItem('proactive_co_creator_backup_v2'));
    const localAfter = loadProjectsFromLocalStorage().projects.find((p) => p.id === survivingId);
    assert.ok(localAfter);
    assert.equal(localAfter.artifacts.length, 1);
    clearDeletedProjectId(doomedId);
  });

  it('T4.6b / ST-07: identical artifacts & revision number still fail verifyProjectCacheParity when revision snapshot or Undo future/past differs', () => {
    const base = createSampleProject();
    const sharedArt: GenerationArtifact = {
      id: 'art_identical',
      projectId: base.id,
      mode: 'story',
      createdAt: 1000,
      revisionId: base.revisions[0]?.id ?? 'rev_1',
      sourceRevision: 1,
      promptUsed: 'Prompt',
      promptDigest: 'd1',
      storyText: 'Exact same artifact text',
      isOutdated: false,
    };
    const localProj: CreativeProject = {
      ...base,
      revision: 3,
      persistedRevision: 3,
      artifacts: [sharedArt],
      undoHistory: {
        past: [{ label: 'Step 1', snapshot: base.snapshot }],
        future: [{ label: 'Future A', snapshot: updateStoryBibleField(base.snapshot, 'tone', 'Cozy') }],
      },
    };
    const idbDiffUndo: CreativeProject = {
      ...structuredClone(localProj),
      undoHistory: {
        past: [{ label: 'Step 1', snapshot: base.snapshot }],
        future: [{ label: 'Future B', snapshot: updateStoryBibleField(base.snapshot, 'tone', 'Dark') }],
      },
    };
    assert.equal(verifyProjectCacheParity(localProj, idbDiffUndo), false);

    const idbDiffRevSnap: CreativeProject = structuredClone(localProj);
    idbDiffRevSnap.revisions[0] = {
      ...idbDiffRevSnap.revisions[0],
      snapshot: updateStoryBibleField(base.snapshot, 'setting', 'Divergent History Snapshot'),
    };
    assert.equal(verifyProjectCacheParity(localProj, idbDiffRevSnap), false);
    assert.equal(verifyProjectCacheParity(localProj, structuredClone(localProj)), true);
  });
});

