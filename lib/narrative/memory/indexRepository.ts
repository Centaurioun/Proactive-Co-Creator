import { NarrativeMemoryIndexSnapshot } from '../../../shared/narrativeMemoryTypes';
import { CreativeProject } from '../../../shared/types';
import { NARRATIVE_INDEX_STORE } from '../../storage/constants';
import { getDb } from '../../storage/indexedDbOperations';
import { getDeletedProjectIds } from '../../storage/tombstoneRegistry';
import {
  buildNarrativeMemoryIndex,
  BuildNarrativeIndexOptions,
  isNarrativeMemoryIndexFresh,
} from './indexBuilder';

/**
 * In-memory cache and Node-test fallback for derived NarrativeMemoryIndexSnapshots.
 */
const memoryIndexCache = new Map<string, NarrativeMemoryIndexSnapshot>();

function isProjectTombstoned(projectId: string): boolean {
  try {
    return getDeletedProjectIds().has(projectId);
  } catch {
    return false;
  }
}

export async function loadNarrativeMemoryIndex(
  projectId: string
): Promise<NarrativeMemoryIndexSnapshot | null> {
  if (!projectId || isProjectTombstoned(projectId)) {
    memoryIndexCache.delete(projectId);
    return null;
  }

  const cached = memoryIndexCache.get(projectId);
  if (cached) {
    return cached;
  }

  try {
    const db = await getDb();
    const record = await new Promise<NarrativeMemoryIndexSnapshot | null>((resolve, reject) => {
      const tx = db.transaction(NARRATIVE_INDEX_STORE, 'readonly');
      const store = tx.objectStore(NARRATIVE_INDEX_STORE);
      const req = store.get(projectId);
      req.onsuccess = () => resolve((req.result as NarrativeMemoryIndexSnapshot) || null);
      req.onerror = () => reject(req.error);
    });
    if (record && !isProjectTombstoned(projectId)) {
      memoryIndexCache.set(projectId, record);
      return record;
    }
    return null;
  } catch {
    return memoryIndexCache.get(projectId) ?? null;
  }
}

export async function saveNarrativeMemoryIndex(
  snapshot: NarrativeMemoryIndexSnapshot
): Promise<boolean> {
  if (!snapshot?.projectId || isProjectTombstoned(snapshot.projectId)) {
    return false;
  }

  memoryIndexCache.set(snapshot.projectId, snapshot);

  try {
    const db = await getDb();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(NARRATIVE_INDEX_STORE, 'readwrite');
      const store = tx.objectStore(NARRATIVE_INDEX_STORE);
      store.put(snapshot);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error || new Error('Narrative index transaction aborted'));
    });
    return true;
  } catch {
    // Still available in memoryIndexCache in non-IDB environments
    return true;
  }
}

export async function deleteNarrativeMemoryIndex(projectId: string): Promise<void> {
  if (!projectId) return;
  memoryIndexCache.delete(projectId);
  try {
    const db = await getDb();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(NARRATIVE_INDEX_STORE, 'readwrite');
      const store = tx.objectStore(NARRATIVE_INDEX_STORE);
      store.delete(projectId);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error || new Error('Delete narrative index transaction aborted'));
    });
  } catch {
    // Ignore when IndexedDB is unavailable in unit tests
  }
}

/**
 * Ensures an up-to-date E1 NarrativeMemoryIndexSnapshot exists for `project`.
 * Reuses the persisted snapshot if fresh, or incrementally rebuilds and saves it.
 */
export async function ensureFreshNarrativeMemoryIndex(
  project: CreativeProject,
  options: BuildNarrativeIndexOptions = {}
): Promise<NarrativeMemoryIndexSnapshot> {
  if (isProjectTombstoned(project.id)) {
    throw new Error(`Project ${project.id} has been deleted and cannot be indexed.`);
  }

  const existing = options.previousIndex ?? (await loadNarrativeMemoryIndex(project.id));
  if (existing && isNarrativeMemoryIndexFresh(existing, project)) {
    return existing;
  }

  const rebuilt = buildNarrativeMemoryIndex(project, {
    ...options,
    previousIndex: existing,
  });
  await saveNarrativeMemoryIndex(rebuilt);
  return rebuilt;
}

/**
 * Synchronous helper that returns a cached fresh index or builds and caches it synchronously
 * (while scheduling async persistence in the background).
 */
export function getOrBuildNarrativeMemoryIndexSync(
  project: CreativeProject,
  options: BuildNarrativeIndexOptions = {}
): NarrativeMemoryIndexSnapshot {
  if (isProjectTombstoned(project.id)) {
    throw new Error(`Project ${project.id} has been deleted and cannot be indexed.`);
  }
  const existing = options.previousIndex ?? memoryIndexCache.get(project.id) ?? null;
  if (existing && isNarrativeMemoryIndexFresh(existing, project)) {
    return existing;
  }
  const rebuilt = buildNarrativeMemoryIndex(project, {
    ...options,
    previousIndex: existing,
  });
  memoryIndexCache.set(project.id, rebuilt);
  void saveNarrativeMemoryIndex(rebuilt);
  return rebuilt;
}

export function clearMemoryIndexCacheForTests(): void {
  memoryIndexCache.clear();
}
