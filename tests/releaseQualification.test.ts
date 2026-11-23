/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { beforeEach, describe, it } from 'node:test';
import {
  createSampleProject,
  updateStoryBibleField,
} from '../lib/canonicalModel.ts';
import { createUndoRedoState } from '../lib/historyEngine.ts';
import {
  commitSnapshotTransaction,
  prepareProjectSwitch,
  reconcileAsyncSaveAcknowledgement,
} from '../lib/projectController.ts';
import {
  clearDeletedProjectId,
  deleteProjectCompletely,
  LOCAL_STORAGE_BACKUP_V2_KEY,
  loadProjectsFromLocalStorage,
  persistProjectDurably,
  reloadLatestProjectsFromStorage,
  saveProjectToIndexedDb,
  saveProjectToLocalStorage,
  simulateBrowserProcessRestartForTesting,
} from '../lib/storageEngine.ts';
import type { CreativeProject } from '../shared/types.ts';

class MockLocalStorage {
  private store = new Map<string, string>();
  public quotaLimitBytes: number | null = null;

  getItem(key: string): string | null {
    return this.store.get(key) ?? null;
  }

  setItem(key: string, value: string): void {
    if (this.quotaLimitBytes !== null) {
      let currentTotal = 0;
      for (const [k, v] of this.store.entries()) {
        if (k !== key) currentTotal += v.length;
      }
      if (
        value.length > this.quotaLimitBytes ||
        currentTotal + value.length > this.quotaLimitBytes
      ) {
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
  public failNextGetAll: string | null = null;
  public failNextPut: string | null = null;
  public getDelayMs = 0;

  reset(): void {
    this.records.clear();
    this.failNextDelete = null;
    this.failNextGetAll = null;
    this.failNextPut = null;
    this.getDelayMs = 0;
  }

  open(_name: string, _version?: number): FakeIDBRequest {
    const objectStoreNames = { contains: () => true };

    const createTx = () => {
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
          setTimeout(() => tx.onabort?.(), 0);
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
    }, 0);
    return req;
  }
}

const mockLocalStorage = new MockLocalStorage();
const mockSessionStorage = new MockLocalStorage();
const fakeIdb = new FakeIndexedDB();

function installWindow(withIndexedDb: boolean) {
  Object.defineProperty(globalThis, 'window', {
    value: {
      localStorage: mockLocalStorage,
      sessionStorage: mockSessionStorage,
      ...(withIndexedDb ? { indexedDB: fakeIdb } : {}),
    },
    writable: true,
    configurable: true,
  });
  Object.defineProperty(globalThis, 'localStorage', {
    value: mockLocalStorage,
    writable: true,
    configurable: true,
  });
  Object.defineProperty(globalThis, 'sessionStorage', {
    value: mockSessionStorage,
    writable: true,
    configurable: true,
  });
}

describe('Release Qualification & Final Data Safety Suite', () => {
  beforeEach(() => {
    installWindow(true);
    mockLocalStorage.clear();
    mockSessionStorage.clear();
    fakeIdb.reset();
    simulateBrowserProcessRestartForTesting();
  });

  it('Task 1A: rapid project switch (Edit A -> Switch B before autosave -> Switch A -> Reload) preserves latest edit and wires App.tsx flush coordinator', async () => {
    const appSource = fs.readFileSync(path.resolve(process.cwd(), 'App.tsx'), 'utf8');
    const switchFnMatch = appSource.match(/const handleSwitchProject[\s\S]*?};/);
    assert.ok(switchFnMatch, 'handleSwitchProject must exist in App.tsx');
    assert.ok(
      switchFnMatch[0].includes('prepareProjectSwitch'),
      'App.tsx handleSwitchProject must use prepareProjectSwitch to preserve unpersisted edits and flush pending saves'
    );

    const projA: CreativeProject = {
      ...createSampleProject(),
      id: 'proj_switch_a',
      name: 'Project Alpha',
      revision: 1,
      persistedRevision: 1,
    };
    const projB: CreativeProject = {
      ...createSampleProject(),
      id: 'proj_switch_b',
      name: 'Project Beta',
      revision: 1,
      persistedRevision: 1,
    };
    await persistProjectDurably(projA, { forceOverwrite: true });
    await persistProjectDurably(projB, { forceOverwrite: true });

    // User edits A -> r2 (not yet autosaved: persistedRevision is still 1)
    const undoA = createUndoRedoState(projA.snapshot, projA.revisions, projA.undoHistory);
    const snapA2 = updateStoryBibleField(projA.snapshot, 'genre', 'Biopunk Noir');
    const { project: editedA } = commitSnapshotTransaction(
      projA,
      undoA,
      snapA2,
      'Set Genre Biopunk Noir'
    );
    assert.equal(editedA.revision, 2);
    assert.equal(editedA.persistedRevision, 1);

    // Immediately switch A -> B BEFORE debounced autosave fires (savedProjects still holds stale projA@r1)
    fakeIdb.getDelayMs = 30;
    const switchToB = prepareProjectSwitch({
      currentProject: editedA,
      savedProjects: [projA, projB],
      targetProjectId: projB.id,
    });
    assert.ok(switchToB.targetProject, 'Target project B must resolve');
    assert.equal(switchToB.projectToFlush?.id, projA.id);
    assert.equal(switchToB.projectToFlush?.revision, 2);
    assert.equal(
      switchToB.savedProjects.find((p) => p.id === projA.id)?.revision,
      2,
      'savedProjects must immediately reflect edited A (r2) on switch away'
    );

    // Flush A@r2 in background while user edits B -> r2, then immediately switches B -> A
    const flushAPromise = persistProjectDurably(switchToB.projectToFlush!, {
      expectedPersistedRevision: switchToB.projectToFlush!.persistedRevision,
    });

    const undoB = createUndoRedoState(
      switchToB.targetProject.snapshot,
      switchToB.targetProject.revisions,
      switchToB.targetProject.undoHistory
    );
    const snapB2 = updateStoryBibleField(
      switchToB.targetProject.snapshot,
      'genre',
      'Solar Opera'
    );
    const { project: editedB } = commitSnapshotTransaction(
      switchToB.targetProject,
      undoB,
      snapB2,
      'Set B Genre Solar Opera'
    );

    const switchBackToA = prepareProjectSwitch({
      currentProject: editedB,
      savedProjects: switchToB.savedProjects,
      targetProjectId: projA.id,
    });
    assert.equal(switchBackToA.targetProject?.revision, 2);
    assert.equal(
      switchBackToA.targetProject?.snapshot.storyBible.genre.value,
      'Biopunk Noir',
      'Returning B -> A immediately must show Biopunk Noir (r2), not stale r1'
    );
    assert.equal(switchBackToA.projectToFlush?.id, projB.id);

    const flushBPromise = persistProjectDurably(switchBackToA.projectToFlush!, {
      expectedPersistedRevision: switchBackToA.projectToFlush!.persistedRevision,
    });

    const [ackA, ackB] = await Promise.all([flushAPromise, flushBPromise]);
    assert.equal(ackA.saved, true);
    assert.equal(ackB.saved, true);
    fakeIdb.getDelayMs = 0;

    // Simulate full browser reload and confirm BOTH A@r2 and B@r2 survive durably
    const reloaded = await reloadLatestProjectsFromStorage(projA.id);
    const reloadedA = reloaded.projects.find((p) => p.id === projA.id);
    const reloadedB = reloaded.projects.find((p) => p.id === projB.id);
    assert.equal(reloadedA?.revision, 2);
    assert.equal(reloadedA?.snapshot.storyBible.genre.value, 'Biopunk Noir');
    assert.equal(reloadedB?.revision, 2);
    assert.equal(reloadedB?.snapshot.storyBible.genre.value, 'Solar Opera');
  });

  it('Task 1B: stale async save acknowledgement does not overwrite newer in-memory revision in active project or savedProjects', () => {
    const projA: CreativeProject = {
      ...createSampleProject(),
      id: 'proj_ack_race',
      name: 'Ack Race',
      revision: 1,
      persistedRevision: 1,
    };
    const undo1 = createUndoRedoState(projA.snapshot, projA.revisions);
    const { project: r2, undoState: undo2 } = commitSnapshotTransaction(
      projA,
      undo1,
      updateStoryBibleField(projA.snapshot, 'genre', 'Draft Two'),
      'Edit R2'
    );
    const { project: r3 } = commitSnapshotTransaction(
      r2,
      undo2,
      updateStoryBibleField(r2.snapshot, 'genre', 'Draft Three'),
      'Edit R3'
    );

    // Suppose save of r2 resolves AFTER user already advanced in-memory state to r3
    const reconciled = reconcileAsyncSaveAcknowledgement({
      acknowledgedProject: r2,
      acknowledgedRevision: 2,
      currentActiveProject: r3,
      savedProjects: [r3],
    });

    assert.equal(reconciled.activeProject.revision, 3);
    assert.equal(reconciled.activeProject.persistedRevision, 2);
    assert.equal(reconciled.activeProject.snapshot.storyBible.genre.value, 'Draft Three');
    assert.equal(reconciled.savedProjects[0].revision, 3);
    assert.equal(reconciled.savedProjects[0].persistedRevision, 2);
    assert.equal(reconciled.savedProjects[0].snapshot.storyBible.genre.value, 'Draft Three');
  });

  it('Task 2A: under localStorage quota pressure when IndexedDB is unavailable, deletion NEVER deletes legacy backup or strips surviving project artifacts/history and reports incompleteDeletion', async () => {
    installWindow(false); // IndexedDB unavailable!

    const surviving: CreativeProject = {
      ...createSampleProject(),
      id: 'proj_surviving_no_idb',
      name: 'Surviving Offline Project',
      artifacts: [
        {
          id: 'art_important_story',
          projectId: 'proj_surviving_no_idb',
          mode: 'story',
          createdAt: Date.now(),
          revisionId: 'rev_1',
          sourceRevision: 1,
          promptUsed: 'Important story',
          promptDigest: 'd1',
          storyText: 'Y'.repeat(1800),
          isOutdated: false,
        },
      ],
    };
    const doomed: CreativeProject = {
      ...createSampleProject(),
      id: 'proj_doomed_no_idb',
      name: 'Doomed Project',
    };

    saveProjectToLocalStorage(surviving, { forceOverwrite: true });
    saveProjectToLocalStorage(doomed, { forceOverwrite: true });
    mockLocalStorage.setItem(LOCAL_STORAGE_BACKUP_V2_KEY, '{"legacy":"must-not-be-deleted"}');

    // Tight quota: enough room for surviving project + backup alone, NOT enough for extra tombstone bytes
    const survivingOnlyLen = JSON.stringify({ [surviving.id]: surviving }).length;
    const backupLen = mockLocalStorage.getItem(LOCAL_STORAGE_BACKUP_V2_KEY)?.length ?? 0;
    mockLocalStorage.quotaLimitBytes = survivingOnlyLen + backupLen + 5;

    const delRes = await deleteProjectCompletely(doomed.id);

    // Backup MUST remain intact!
    assert.equal(
      mockLocalStorage.getItem(LOCAL_STORAGE_BACKUP_V2_KEY),
      '{"legacy":"must-not-be-deleted"}',
      'Legacy backup must NOT be deleted when IndexedDB is unavailable'
    );

    // Surviving project artifacts MUST remain intact in localStorage!
    const localAfter = loadProjectsFromLocalStorage({ skipAutoSeedIfEmpty: true });
    const recoveredSurviving = localAfter.projects.find((p) => p.id === surviving.id);
    assert.ok(recoveredSurviving, 'Surviving project must still exist in localStorage');
    assert.equal(
      recoveredSurviving.artifacts.length,
      1,
      'Surviving project artifacts must NOT be stripped when IndexedDB is unavailable'
    );
    assert.equal(recoveredSurviving.artifacts[0].storyText, 'Y'.repeat(1800));

    // Deletion result must accurately report status (IDB unavailable -> idbDeleted: false)
    assert.equal(delRes.idbDeleted, false);
    assert.equal(delRes.preservedBackups, true);
    assert.equal(delRes.incompleteDeletion, true);
    clearDeletedProjectId(doomed.id);
  });

  it('Task 2B: under localStorage quota pressure when IndexedDB read & delete fail, deletion preserves backups & unverified localStorage revisions and reports incompleteDeletion', async () => {
    const survivingR2: CreativeProject = {
      ...createSampleProject(),
      id: 'proj_surviving_idb_fail',
      name: 'Surviving R2 Only In Local',
      revision: 2,
      persistedRevision: 1,
      artifacts: [
        {
          id: 'art_local_only',
          projectId: 'proj_surviving_idb_fail',
          mode: 'story',
          createdAt: Date.now(),
          revisionId: 'rev_2',
          sourceRevision: 2,
          promptUsed: 'Local-only story',
          promptDigest: 'd2',
          storyText: 'Z'.repeat(1600),
          isOutdated: false,
        },
      ],
    };
    const doomed: CreativeProject = {
      ...createSampleProject(),
      id: 'proj_doomed_idb_fail',
      name: 'Doomed With IDB Failure',
    };

    // IndexedDB only has doomed (or older surviving r1), and IDB read & delete both fail
    await saveProjectToIndexedDb(doomed, { forceOverwrite: true });
    saveProjectToLocalStorage(survivingR2, { forceOverwrite: true });
    saveProjectToLocalStorage(doomed, { forceOverwrite: true });
    mockLocalStorage.setItem(LOCAL_STORAGE_BACKUP_V2_KEY, '{"v2Backup":"keep-me"}');

    const survivingR2OnlyLen = JSON.stringify({ [survivingR2.id]: survivingR2 }).length;
    const backupR2Len = mockLocalStorage.getItem(LOCAL_STORAGE_BACKUP_V2_KEY)?.length ?? 0;
    mockLocalStorage.quotaLimitBytes = survivingR2OnlyLen + backupR2Len + 5;

    fakeIdb.failNextGetAll = 'IndexedDB read failure during quota safety check';
    fakeIdb.failNextDelete = 'IndexedDB delete failure';

    const delRes = await deleteProjectCompletely(doomed.id);

    assert.equal(
      mockLocalStorage.getItem(LOCAL_STORAGE_BACKUP_V2_KEY),
      '{"v2Backup":"keep-me"}',
      'Legacy backup must never be destroyed when IndexedDB is failing'
    );
    const localAfter = loadProjectsFromLocalStorage({ skipAutoSeedIfEmpty: true });
    const recoveredSurviving = localAfter.projects.find((p) => p.id === survivingR2.id);
    assert.equal(recoveredSurviving?.revision, 2);
    assert.equal(recoveredSurviving?.artifacts[0]?.storyText, 'Z'.repeat(1600));
    assert.equal(delRes.idbDeleted, false);
    assert.equal(delRes.tombstonePersisted, false);
    assert.equal(delRes.incompleteDeletion, true);
    assert.equal(delRes.preservedBackups, true);
    clearDeletedProjectId(doomed.id);
  });

  it('Task 3: GitHub Actions CI workflow exists and runs npm ci, typecheck, lint, test, and build on Node 22', () => {
    const workflowPath = path.resolve(process.cwd(), '.github/workflows/ci.yml');
    assert.equal(fs.existsSync(workflowPath), true, 'Expected .github/workflows/ci.yml to exist');
    const content = fs.readFileSync(workflowPath, 'utf8');
    assert.ok(content.includes('npm ci'), 'CI must run npm ci');
    assert.ok(content.includes('npm run typecheck'), 'CI must run npm run typecheck');
    assert.ok(content.includes('npm run lint'), 'CI must run npm run lint');
    assert.ok(content.includes('npm test'), 'CI must run npm test');
    assert.ok(content.includes('npm run build'), 'CI must run npm run build');
    assert.ok(content.includes('22'), 'CI must target supported Node.js 22');
  });

  it('Task 3b: GitHub Actions CI workflow runs scripts/e2e-browser-smoke.sh without paid Gemini secrets', () => {
    const workflowPath = path.resolve(process.cwd(), '.github/workflows/ci.yml');
    const content = fs.readFileSync(workflowPath, 'utf8');
    assert.ok(content.includes('e2e-browser:'), 'CI must include dedicated e2e-browser job');
    assert.ok(content.includes('needs: verify'), 'e2e-browser job must depend on verify job');
    assert.ok(
      content.includes('scripts/e2e-browser-smoke.sh'),
      'CI e2e-browser job must execute scripts/e2e-browser-smoke.sh'
    );
    assert.ok(
      content.includes('@playwright/cli@0.1.22') && content.includes('install-browser chromium'),
      'CI e2e-browser job must reproducibly install pinned @playwright/cli and chromium'
    );
    assert.equal(
      content.includes('GEMINI_API_KEY'),
      false,
      'CI e2e-browser job must remain strictly non-billable without GEMINI_API_KEY'
    );
  });
});
