/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import {
  LOCAL_STORAGE_ACTIVE_ID_KEY,
  LOCAL_STORAGE_PROJECTS_KEY,
} from './constants.ts';
import type { CreativeProject } from '../../shared/types.ts';

export function browserStorage(kind: 'localStorage' | 'sessionStorage'): Storage | undefined {
  try {
    return typeof window === 'undefined' ? undefined : window[kind];
  } catch {
    return undefined;
  }
}

export function readProjectCache(storage: Storage): Record<string, CreativeProject> {
  const raw = storage.getItem(LOCAL_STORAGE_PROJECTS_KEY);
  return raw ? JSON.parse(raw) as Record<string, CreativeProject> : {};
}

export function writeProjectCache(storage: Storage, projects: Record<string, CreativeProject>): void {
  storage.setItem(LOCAL_STORAGE_PROJECTS_KEY, JSON.stringify(projects));
}

export function setCachedProjectSelection(projectId: string): string | undefined {
  const storage = browserStorage('localStorage');
  if (!storage) return 'Browser storage is unavailable for updating the project selection.';
  try {
    storage.setItem(LOCAL_STORAGE_ACTIVE_ID_KEY, projectId);
  } catch {
    return 'Project selection could not be saved in browser storage.';
  }
}
