/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import type { CreativeProject } from '../../shared/types.ts';
import { IDB_NAME, IDB_STORE, type DurableWriteOptions, type StorageSaveResult } from './constants.ts';
import { IMPORT_CHECKPOINT_STORE } from '../narrative/import/analysisCheckpoints.ts';
import { evaluateCasConflict, mergeIntentIds } from './casPolicy.ts';

export function getIndexedDb(): { factory?: IDBFactory; error?: string } {
  try {
    return { factory: typeof window === 'undefined' ? undefined : window.indexedDB };
  } catch (error) {
    return { error: errorMessage(error, 'IndexedDB access was denied.') };
  }
}

function errorMessage(error: unknown, fallback: string): string {
  return error instanceof Error ? error.message : fallback;
}

function withProjectDatabase<Result>(
  factory: IDBFactory,
  failed: (message: string, quotaExceeded: boolean) => Result,
  start: (db: IDBDatabase, finish: (result: Result) => void, fail: (error: unknown, fallback: string) => void) => void,
): Promise<Result> {
  return new Promise(resolve => {
    let db: IDBDatabase | undefined;
    let settled = false;
    const finish = (result: Result) => {
      if (settled) return;
      settled = true;
      try {
        db?.close();
      } catch {
        // An operation's outcome is already known.
      }
      resolve(result);
    };
    const fail = (error: unknown, fallback: string) => {
      const message = errorMessage(error, fallback);
      const quotaExceeded = error instanceof Error && (error.name === 'QuotaExceededError' || /quota/i.test(message));
      finish(failed(message, quotaExceeded));
    };
    try {
      const request = factory.open(IDB_NAME, 2);
      request.onupgradeneeded = () => {
        const database = request.result;
        if (!database.objectStoreNames.contains(IDB_STORE)) database.createObjectStore(IDB_STORE, { keyPath: 'id' });
        if (!database.objectStoreNames.contains(IMPORT_CHECKPOINT_STORE)) {
          database.createObjectStore(IMPORT_CHECKPOINT_STORE, { keyPath: 'id' });
        }
      };
      request.onerror = () => fail(request.error, 'Could not open IndexedDB.');
      request.onblocked = () => fail(undefined, 'Another tab is blocking IndexedDB initialization.');
      request.onsuccess = () => {
        db = request.result;
        if (settled) {
          db.close();
          return;
        }
        try {
          start(db, finish, fail);
        } catch (error) {
          fail(error, 'Could not start the IndexedDB operation.');
        }
      };
    } catch (error) {
      fail(error, 'Could not open IndexedDB.');
    }
  });
}

type ReadResult = { ok: true; entries: unknown[] } | { ok: false; error: string };

export function readIdbProjects(factory: IDBFactory): Promise<ReadResult> {
  return withProjectDatabase<ReadResult>(factory, error => ({ ok: false, error }), (db, finish, fail) => {
    const tx = db.transaction(IDB_STORE, 'readonly');
    const request = tx.objectStore(IDB_STORE).getAll();
    request.onerror = () => fail(request.error, 'Could not read IndexedDB projects.');
    tx.onerror = tx.onabort = () => fail(tx.error, 'IndexedDB read transaction failed.');
    tx.oncomplete = () => finish({ ok: true, entries: request.result as unknown[] });
  });
}

export function deleteIdbProject(factory: IDBFactory, projectId: string): Promise<{ ok: boolean; error?: string }> {
  return withProjectDatabase<{ ok: boolean; error?: string }>(factory, error => ({ ok: false, error }), (db, finish, fail) => {
    const tx = db.transaction(IDB_STORE, 'readwrite');
    const request = tx.objectStore(IDB_STORE).delete(projectId);
    request.onerror = () => fail(request.error, 'Could not delete the IndexedDB project.');
    tx.onerror = tx.onabort = () => fail(tx.error, 'IndexedDB delete transaction failed.');
    tx.oncomplete = () => finish({ ok: true });
  });
}

export function writeIdbProject(
  factory: IDBFactory,
  project: CreativeProject,
  options: DurableWriteOptions,
  isDeleted: () => boolean,
): Promise<StorageSaveResult> {
  const failed = (error: string, quotaExceeded = false): StorageSaveResult => ({
    ok: false, saved: false, error, quotaExceeded, persistedRevision: project.persistedRevision,
  });
  return withProjectDatabase(factory, failed, (db, finish, fail) => {
    const deleted = () => failed(`Project "${project.id}" was deleted before IndexedDB write could commit.`);
    if (isDeleted()) {
      finish(deleted());
      return;
    }

    const tx = db.transaction(IDB_STORE, 'readwrite');
    const store = tx.objectStore(IDB_STORE);
    const request = store.get(project.id);
    let result: StorageSaveResult | undefined;
    request.onerror = () => fail(request.error, 'Could not read the IndexedDB project before writing.');
    tx.onerror = tx.onabort = () => fail(tx.error, 'IndexedDB write transaction failed.');
    tx.oncomplete = () => finish(result ?? failed('The IndexedDB transaction completed without a write.'));

    request.onsuccess = () => {
      try {
        if (isDeleted()) {
          finish(deleted());
          tx.abort();
          return;
        }
        const existing = request.result as CreativeProject | undefined;
        const conflict = evaluateCasConflict({
          ...options,
          existing,
          candidate: project,
          rawExpected: options.expectedPersistedRevision,
          forceOverwrite: Boolean(options.forceOverwrite),
          storeLabel: 'IndexedDB',
        });
        if (conflict) {
          if (conflict.idempotentHit) {
            result = conflict;
          } else {
            finish(conflict);
            tx.abort();
          }
          return;
        }

        const revision = project.revision ?? 1;
        const mergedIntents = mergeIntentIds(existing, project, options.intentId, options.expectedPersistedRevision);
        const storedProject = {
          ...project,
          revision,
          persistedRevision: revision,
          ...(mergedIntents ? { recentIntentIds: mergedIntents } : {}),
        };
        const put = store.put(storedProject);
        put.onerror = () => fail(put.error, 'IndexedDB put request failed.');
        result = { ok: true, saved: true, persistedRevision: revision, storedProject };
      } catch (error) {
        fail(error, 'Could not write the IndexedDB project.');
        tx.abort();
      }
    };
  });
}
