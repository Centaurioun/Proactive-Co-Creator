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
  loadProjectsFromLocalStorage,
  migrateProjectPayload,
  persistProjectDurably,
  reconcileHydratedProjects,
  reloadLatestProjectsFromStorage,
  saveProjectToIndexedDb,
  saveProjectToLocalStorage,
} from '../lib/storageEngine.ts';
import type { CreativeProject, GenerationArtifact } from '../shared/types.ts';

const SCHEMA_VERSION = 3;

class MockLocalStorage {
  private store = new Map<string, string>();
  public quotaLimitBytes: number | null = null;
  public setItemCalls = 0;

  getItem(key: string): string | null {
    return this.store.get(key) ?? null;
  }

  setItem(key: string, value: string): void {
    this.setItemCalls += 1;
    if (this.quotaLimitBytes !== null && value.length > this.quotaLimitBytes) {
      const err = new Error('QuotaExceededError: Mock localStorage quota exceeded');
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
    this.quotaLimitBytes = null;
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
  public abortNextPutWithQuota = false;
  public openDelayMs = 0;
  public getDelayMs = 0;

  reset(): void {
    this.records.clear();
    this.failNextDelete = null;
    this.failNextPut = null;
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
              if (tx.aborted) return;
              r.result = Array.from(this.records.values()).map((v) => structuredClone(v));
              r.onsuccess?.();
              tx.pendingOps -= 1;
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
});
