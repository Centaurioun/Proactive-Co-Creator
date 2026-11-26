/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

export class MockLocalStorage {
  private store = new Map<string, string>();
  public quotaLimitBytes: number | null = null;
  public failNextSetItemError: string | null = null;
  public setItemCalls = 0;
  public rejectedKey: string | null = null;

  getItem(key: string): string | null {
    return this.store.get(key) ?? null;
  }

  setItem(key: string, value: string): void {
    this.setItemCalls += 1;
    if (key === this.rejectedKey) throw new Error('Mock storage key write failed');
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
    this.failNextSetItemError = null;
    this.setItemCalls = 0;
    this.rejectedKey = null;
  }
}

export interface FakeIDBRequest<T = unknown> {
  result: T;
  error: Error | null;
  onsuccess: (() => void) | null;
  onerror: (() => void) | null;
  onupgradeneeded?: (() => void) | null;
}

interface FakeIDBTx {
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
}

export class FakeIndexedDB {
  public records = new Map<string, unknown>();
  public failNextDelete: string | null = null;
  public failNextPut: string | null = null;
  public failNextGetAll: string | null = null;
  public abortNextPutWithQuota = false;
  public afterReadAll?: () => void;
  public afterPut?: () => void;
  public putCalls = 0;
  public openDelayMs = 0;
  public getDelayMs = 0;

  reset(): void {
    this.records.clear();
    this.failNextDelete = null;
    this.failNextPut = null;
    this.failNextGetAll = null;
    this.abortNextPutWithQuota = false;
    this.afterReadAll = undefined;
    this.afterPut = undefined;
    this.putCalls = 0;
    this.openDelayMs = 0;
    this.getDelayMs = 0;
  }

  private createObjectStore(tx: FakeIDBTx, scheduleCompleteIfIdle: () => void) {
    return {
      get: (key: string) => {
        tx.pendingOps += 1;
        const r: FakeIDBRequest = { result: undefined, error: null, onsuccess: null, onerror: null };
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
        const r: FakeIDBRequest = { result: [], error: null, onsuccess: null, onerror: null };
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
          this.afterReadAll?.();
          scheduleCompleteIfIdle();
        }, 0);
        return r;
      },
      put: (val: { id: string }) => {
        this.putCalls += 1;
        tx.pendingOps += 1;
        const r: FakeIDBRequest = { result: val.id, error: null, onsuccess: null, onerror: null };
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
          this.afterPut?.();
          r.onsuccess?.();
          scheduleCompleteIfIdle();
        }, 0);
        return r;
      },
      delete: (key: string) => {
        tx.pendingOps += 1;
        const r: FakeIDBRequest = { result: undefined, error: null, onsuccess: null, onerror: null };
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
    };
  }

  private createTx = (): FakeIDBTx => {
    const tx: FakeIDBTx = {
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
      objectStore: () => storeApi,
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

    const storeApi = this.createObjectStore(tx, scheduleCompleteIfIdle);
    return tx;
  };

  open(_name: string, _version?: number): FakeIDBRequest {
    const db = {
      objectStoreNames: { contains: () => true },
      createObjectStore: () => ({}),
      transaction: this.createTx,
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

export function installMockBrowserStorage(mockLocal: MockLocalStorage, mockSession: MockLocalStorage, fakeIdb: FakeIndexedDB): void {
  Object.defineProperty(globalThis, 'window', {
    configurable: true,
    value: {
      localStorage: mockLocal,
      sessionStorage: mockSession,
      indexedDB: fakeIdb,
    },
  });
}
