/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { LOCAL_STORAGE_DELETED_IDS_KEY } from './constants.ts';
import { browserStorage } from './localProjectCache.ts';

// Single mutable tombstone/deletion authority for the browser runtime.
const deletedProjectIdsMemorySet = new Set<string>();

export function addDeletedProjectIdInMemory(projectId: string): void {
  deletedProjectIdsMemorySet.add(projectId);
}

export function getDeletedProjectIds(): Set<string> {
  const combined = new Set<string>(deletedProjectIdsMemorySet);
  if (typeof window === 'undefined') return combined;

  const readFromStorage = (storage: Storage | undefined) => {
    if (!storage) return;
    try {
      const raw = storage.getItem(LOCAL_STORAGE_DELETED_IDS_KEY);
      if (!raw) return;
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) {
        for (const id of parsed) {
          if (typeof id === 'string') {
            combined.add(id);
            deletedProjectIdsMemorySet.add(id);
          }
        }
      }
    } catch {
      // Ignore storage read error
    }
  };

  readFromStorage(browserStorage('localStorage'));
  readFromStorage(browserStorage('sessionStorage'));
  return combined;
}

export function recordDeletedProjectId(projectId: string): boolean {
  deletedProjectIdsMemorySet.add(projectId);
  if (typeof window === 'undefined') return false;

  const set = getDeletedProjectIds();
  set.add(projectId);
  const serialized = JSON.stringify(Array.from(set).slice(-200));

  try {
    browserStorage('sessionStorage')?.setItem(LOCAL_STORAGE_DELETED_IDS_KEY, serialized);
  } catch {
    // Ignore sessionStorage error
  }

  const local = browserStorage('localStorage');
  if (!local) return false;

  try {
    local.setItem(LOCAL_STORAGE_DELETED_IDS_KEY, serialized);
    return true;
  } catch {
    // Non-destructive under quota pressure: never delete backups or strip/evict
    // surviving projects here when IndexedDB availability and parity are unverified.
    // In-memory and sessionStorage tombstones remain active.
    return false;
  }
}

export function clearDeletedProjectId(projectId: string): void {
  deletedProjectIdsMemorySet.delete(projectId);
  if (typeof window === 'undefined') return;
  for (const storage of [browserStorage('localStorage'), browserStorage('sessionStorage')]) {
    if (!storage) continue;
    try {
      const raw = storage.getItem(LOCAL_STORAGE_DELETED_IDS_KEY);
      const parsed = raw ? (JSON.parse(raw) as unknown) : [];
      const list = Array.isArray(parsed)
        ? parsed.filter((id): id is string => typeof id === 'string' && id !== projectId)
        : [];
      storage.setItem(LOCAL_STORAGE_DELETED_IDS_KEY, JSON.stringify(list));
    } catch {
      // Ignore storage error
    }
  }
}

export function simulateBrowserProcessRestartForTesting(): void {
  deletedProjectIdsMemorySet.clear();
  try {
    browserStorage('sessionStorage')?.removeItem(LOCAL_STORAGE_DELETED_IDS_KEY);
  } catch {
    // Ignore sessionStorage error
  }
}
