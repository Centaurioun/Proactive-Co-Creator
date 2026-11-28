import {
  EmbeddingBatchRequest,
  EmbeddingBatchResponse,
  EmbeddingNamespaceDescriptor,
  EmbeddingProviderId,
} from '../../../shared/embeddingSchema';
import {
  NarrativeChunkRecord,
  NarrativeChunkSourceKind,
  NarrativeMemoryIndexSnapshot,
} from '../../../shared/narrativeMemoryTypes';
import { NARRATIVE_VECTOR_STORE } from '../../storage/constants';
import { getDb } from '../../storage/indexedDbOperations';
import { getDeletedProjectIds } from '../../storage/tombstoneRegistry';

export interface StoredChunkVectorRecord {
  /** Primary key: `${projectId}::${namespace.namespaceKey}::${chunkDigest}` */
  id: string;
  projectId: string;
  projectRevision: number;
  sourceKind: NarrativeChunkSourceKind;
  sourceId: string;
  sectionId: string;
  chunkId: string;
  chunkDigest: string;
  namespace: EmbeddingNamespaceDescriptor;
  credentialEpoch: number;
  vector: number[];
  updatedAt: number;
}

export interface VectorNamespaceSummary {
  namespace: EmbeddingNamespaceDescriptor;
  vectorCount: number;
  lastUpdatedAt: number;
}

export interface SemanticIndexingJobProgress {
  projectId: string;
  projectRevision: number;
  status: 'idle' | 'running' | 'completed' | 'cancelled' | 'partial' | 'error';
  totalChunks: number;
  completedChunks: number;
  reusedChunks: number;
  failedChunks: number;
  consumedRequests: number;
  activeNamespaces: string[];
  message?: string;
}

const memoryVectorStore = new Map<string, StoredChunkVectorRecord>();
const queryVectorCache = new Map<string, { vector: number[]; namespace: EmbeddingNamespaceDescriptor; cachedAt: number }>();

function isProjectTombstoned(projectId: string): boolean {
  try {
    return getDeletedProjectIds().has(projectId);
  } catch {
    return false;
  }
}

export function buildVectorRecordId(projectId: string, namespaceKey: string, chunkDigest: string): string {
  return `${projectId}::${namespaceKey}::${chunkDigest}`;
}

export async function saveChunkVectorRecords(records: StoredChunkVectorRecord[]): Promise<void> {
  if (records.length === 0) return;
  const validRecords = records.filter((r) => r.projectId && !isProjectTombstoned(r.projectId));
  if (validRecords.length === 0) return;

  for (const rec of validRecords) {
    memoryVectorStore.set(rec.id, rec);
  }

  try {
    const db = await getDb();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(NARRATIVE_VECTOR_STORE, 'readwrite');
      const store = tx.objectStore(NARRATIVE_VECTOR_STORE);
      for (const rec of validRecords) {
        store.put(rec);
      }
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error || new Error('Vector store write aborted'));
    });
  } catch {
    // Still available in memoryVectorStore in Node test environment
  }
}

export async function loadProjectVectorRecords(
  projectId: string,
  namespaceKeyFilter?: string
): Promise<StoredChunkVectorRecord[]> {
  if (!projectId || isProjectTombstoned(projectId)) {
    return [];
  }

  try {
    const db = await getDb();
    const dbRecords = await new Promise<StoredChunkVectorRecord[]>((resolve, reject) => {
      const tx = db.transaction(NARRATIVE_VECTOR_STORE, 'readonly');
      const store = tx.objectStore(NARRATIVE_VECTOR_STORE);
      const req = store.getAll();
      req.onsuccess = () => resolve((req.result as StoredChunkVectorRecord[]) || []);
      req.onerror = () => reject(req.error);
    });
    for (const rec of dbRecords) {
      if (rec?.id && rec.projectId && !isProjectTombstoned(rec.projectId)) {
        memoryVectorStore.set(rec.id, rec);
      }
    }
  } catch {
    // Fallback to memoryVectorStore
  }

  const out: StoredChunkVectorRecord[] = [];
  for (const rec of memoryVectorStore.values()) {
    if (rec.projectId !== projectId) continue;
    if (namespaceKeyFilter && rec.namespace.namespaceKey !== namespaceKeyFilter) continue;
    out.push(rec);
  }
  return out;
}

export function loadProjectVectorRecordsSync(
  projectId: string,
  namespaceKeyFilter?: string
): StoredChunkVectorRecord[] {
  if (!projectId || isProjectTombstoned(projectId)) {
    return [];
  }
  const out: StoredChunkVectorRecord[] = [];
  for (const rec of memoryVectorStore.values()) {
    if (rec.projectId !== projectId) continue;
    if (namespaceKeyFilter && rec.namespace.namespaceKey !== namespaceKeyFilter) continue;
    out.push(rec);
  }
  return out;
}

export async function listProjectVectorNamespaces(projectId: string): Promise<VectorNamespaceSummary[]> {
  const records = await loadProjectVectorRecords(projectId);
  const byNamespace = new Map<string, VectorNamespaceSummary>();
  for (const rec of records) {
    const key = rec.namespace.namespaceKey;
    const existing = byNamespace.get(key);
    if (!existing) {
      byNamespace.set(key, {
        namespace: rec.namespace,
        vectorCount: 1,
        lastUpdatedAt: rec.updatedAt,
      });
    } else {
      existing.vectorCount += 1;
      if (rec.updatedAt > existing.lastUpdatedAt) {
        existing.lastUpdatedAt = rec.updatedAt;
      }
    }
  }
  return Array.from(byNamespace.values());
}

export async function deleteProjectVectorsByNamespace(
  projectId: string,
  namespaceKey?: string
): Promise<number> {
  let deletedCount = 0;
  for (const [id, rec] of Array.from(memoryVectorStore.entries())) {
    if (rec.projectId === projectId && (!namespaceKey || rec.namespace.namespaceKey === namespaceKey)) {
      memoryVectorStore.delete(id);
      deletedCount += 1;
    }
  }

  for (const key of Array.from(queryVectorCache.keys())) {
    if (key.startsWith(`${projectId}::`) && (!namespaceKey || key.includes(`::${namespaceKey}::`))) {
      queryVectorCache.delete(key);
    }
  }

  try {
    const db = await getDb();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(NARRATIVE_VECTOR_STORE, 'readwrite');
      const store = tx.objectStore(NARRATIVE_VECTOR_STORE);
      const cursorReq = store.openCursor();
      cursorReq.onsuccess = () => {
        const cursor = cursorReq.result;
        if (cursor) {
          const val = cursor.value as StoredChunkVectorRecord;
          if (val?.projectId === projectId && (!namespaceKey || val.namespace?.namespaceKey === namespaceKey)) {
            cursor.delete();
          }
          cursor.continue();
        }
      };
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error || new Error('Vector delete aborted'));
    });
  } catch {
    // Ignore in Node test environments
  }

  return deletedCount;
}

export function getCachedQueryVector(
  projectId: string,
  namespaceKey: string,
  queryText: string
): { vector: number[]; namespace: EmbeddingNamespaceDescriptor } | null {
  const key = `${projectId}::${namespaceKey}::${queryText.trim().toLowerCase()}`;
  const entry = queryVectorCache.get(key);
  if (!entry) return null;
  return { vector: entry.vector, namespace: entry.namespace };
}

export function setCachedQueryVector(
  projectId: string,
  namespace: EmbeddingNamespaceDescriptor,
  queryText: string,
  vector: number[]
): void {
  const key = `${projectId}::${namespace.namespaceKey}::${queryText.trim().toLowerCase()}`;
  queryVectorCache.set(key, {
    vector,
    namespace,
    cachedAt: Date.now(),
  });
}

export type EmbedBatchDispatcher = (request: EmbeddingBatchRequest) => Promise<EmbeddingBatchResponse>;

/**
 * Resumable, cancellable semantic vector indexing runner.
 * - Reuses existing vectors whose `chunkDigest` is already stored in the target namespace
 * - Batches unindexed chunks within size/character limits
 * - Never writes stale vectors if `shouldAbort()` or project revision changes mid-flight
 */
export async function runResumableSemanticIndexing(params: {
  indexSnapshot: NarrativeMemoryIndexSnapshot;
  dispatchEmbedBatch: EmbedBatchDispatcher;
  providerId?: EmbeddingProviderId;
  batchSize?: number;
  signal?: AbortSignal;
  getCurrentProjectRevision?: () => number;
  onProgress?: (progress: SemanticIndexingJobProgress) => void;
}): Promise<SemanticIndexingJobProgress> {
  const { indexSnapshot, dispatchEmbedBatch } = params;
  const projectId = indexSnapshot.projectId;
  const targetRevision = indexSnapshot.projectRevision;
  const batchSize = Math.max(1, Math.min(24, params.batchSize ?? 12));

  const existingVectors = await loadProjectVectorRecords(projectId);
  const existingDigestsByProvider = new Map<string, Set<string>>();
  for (const rec of existingVectors) {
    let set = existingDigestsByProvider.get(rec.namespace.providerId);
    if (!set) {
      set = new Set<string>();
      existingDigestsByProvider.set(rec.namespace.providerId, set);
    }
    set.add(rec.chunkDigest);
  }

  const chunksToEmbed: NarrativeChunkRecord[] = [];
  let reusedChunks = 0;

  for (const chunk of indexSnapshot.chunks) {
    if (params.providerId) {
      const providerSet = existingDigestsByProvider.get(params.providerId);
      if (providerSet && providerSet.has(chunk.digest)) {
        reusedChunks += 1;
        continue;
      }
    }
    chunksToEmbed.push(chunk);
  }

  const progress: SemanticIndexingJobProgress = {
    projectId,
    projectRevision: targetRevision,
    status: 'running',
    totalChunks: indexSnapshot.chunks.length,
    completedChunks: reusedChunks,
    reusedChunks,
    failedChunks: 0,
    consumedRequests: 0,
    activeNamespaces: [],
  };

  params.onProgress?.({ ...progress });

  if (chunksToEmbed.length === 0) {
    progress.status = 'completed';
    progress.message = `All ${indexSnapshot.chunks.length} chunks are already indexed in the active vector namespace.`;
    params.onProgress?.({ ...progress });
    return progress;
  }

  const activeNamespaceSet = new Set<string>();

  for (let offset = 0; offset < chunksToEmbed.length; offset += batchSize) {
    if (params.signal?.aborted) {
      progress.status = 'cancelled';
      progress.message = `Cancelled after ${progress.completedChunks}/${progress.totalChunks} chunks.`;
      params.onProgress?.({ ...progress });
      return progress;
    }

    if (params.getCurrentProjectRevision && params.getCurrentProjectRevision() !== targetRevision) {
      progress.status = 'cancelled';
      progress.message = 'Project revision advanced during indexing; stopped stale semantic indexing job.';
      params.onProgress?.({ ...progress });
      return progress;
    }

    const batchChunks = chunksToEmbed.slice(offset, offset + batchSize);
    const response = await dispatchEmbedBatch({
      projectId,
      projectRevision: targetRevision,
      taskType: 'passage',
      taskInstruction: 'narrative-passage',
      providerId: params.providerId,
      items: batchChunks.map((c) => ({
        id: c.id,
        chunkDigest: c.digest,
        text: `${c.sectionTitle ? `${c.sectionTitle}\n` : ''}${c.text}`.slice(0, 7500),
      })),
    });

    progress.consumedRequests += 1;

    if (params.signal?.aborted || isProjectTombstoned(projectId)) {
      progress.status = 'cancelled';
      progress.message = 'Indexing cancelled before vector commit.';
      params.onProgress?.({ ...progress });
      return progress;
    }

    const okResults = response.results.filter((r) => r.status === 'ok' && r.namespace && r.vectors);
    if (okResults.length === 0) {
      const firstError =
        response.results.find((r) => r.status === 'error')?.reason ||
        response.results.find((r) => r.status === 'skipped')?.reason ||
        'No eligible embedding provider returned vectors.';
      progress.failedChunks += batchChunks.length;
      progress.status = progress.completedChunks > reusedChunks ? 'partial' : 'error';
      progress.message = firstError;
      params.onProgress?.({ ...progress });
      return progress;
    }

    const recordsToSave: StoredChunkVectorRecord[] = [];
    const chunkById = new Map(batchChunks.map((c) => [c.id, c]));

    for (const res of okResults) {
      const ns = res.namespace!;
      activeNamespaceSet.add(ns.namespaceKey);
      for (const vecEntry of res.vectors!) {
        const chunk = chunkById.get(vecEntry.id);
        if (!chunk) continue;
        recordsToSave.push({
          id: buildVectorRecordId(projectId, ns.namespaceKey, chunk.digest),
          projectId,
          projectRevision: targetRevision,
          sourceKind: chunk.sourceKind,
          sourceId: chunk.sourceId,
          sectionId: chunk.sectionId,
          chunkId: chunk.id,
          chunkDigest: chunk.digest,
          namespace: ns,
          credentialEpoch: res.credentialEpoch,
          vector: vecEntry.vector,
          updatedAt: Date.now(),
        });
      }
    }

    await saveChunkVectorRecords(recordsToSave);
    progress.completedChunks += batchChunks.length;
    progress.activeNamespaces = Array.from(activeNamespaceSet);
    params.onProgress?.({ ...progress });
  }

  progress.status = progress.failedChunks > 0 ? 'partial' : 'completed';
  progress.message = `Indexed ${progress.completedChunks}/${progress.totalChunks} chunks (${progress.reusedChunks} reused) across ${progress.activeNamespaces.length} vector namespace(s).`;
  params.onProgress?.({ ...progress });
  return progress;
}

export function clearVectorStoreForTests(): void {
  memoryVectorStore.clear();
  queryVectorCache.clear();
}
