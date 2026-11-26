import type { VerifiedExtraction } from './proposalValidator.ts';
import { IDB_NAME, IDB_STORE } from '../../storage/constants.ts';

export const IMPORT_CHECKPOINT_STORE = 'analysis-checkpoints';
export const IMPORT_CHECKPOINT_SCHEMA = 1;
export const MAX_IMPORT_CHECKPOINTS = 8;

export interface ImportCheckpoint {
  id: string;
  schemaVersion: 1;
  identityDigest: string;
  source: { digest: string; filename: string; mediaType: string; byteLength: number };
  plan: {
    operation: 'narrative-import'; scope: 'complete' | 'selective'; categories: string[];
    instructionDigest: string; segmentationPolicyVersion: string; complete: boolean;
    maxCalls: number; maxInputTokens: number; envelopeReserveTokens: number; payloadTokenBudgetTokens: number;
    contextLimitTokens?: number;
  };
  provider: { connectionId: string; modelId?: string; reasoningLevel: string; capabilityPolicyVersion?: string };
  segments: Array<{
    id: string; index: number; start: number; end: number;
    status: 'pending' | 'in-flight' | 'complete' | 'failed' | 'uncertain';
    attempts: number; result?: VerifiedExtraction;
  }>;
  budget: { maxCalls: number; callsUsed: number };
  coverage: { complete: boolean; processedCharacters: number; totalCharacters: number };
  createdAt: number;
  updatedAt: number;
}

export async function sha256Text(value: string): Promise<string> {
  const bytes = new TextEncoder().encode(value);
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(digest)].map(byte => byte.toString(16).padStart(2, '0')).join('');
}

export interface ImportCheckpointIdentityInput {
  source: ImportCheckpoint['source'];
  scope: 'complete' | 'selective';
  categories: string[];
  instruction: string;
  provider: ImportCheckpoint['provider'];
  complete: boolean;
  maxCalls: number;
  maxInputTokens: number;
  envelopeReserveTokens: number;
  contextLimitTokens?: number;
  totalCharacters: number;
  chunks: Array<{ id: string; index: number; start: number; end: number }>;
}

export async function createImportCheckpoint(input: ImportCheckpointIdentityInput): Promise<ImportCheckpoint> {
  const instructionDigest = await sha256Text(input.instruction);
  const identity = {
    source: input.source,
    operation: 'narrative-import',
    scope: input.scope,
    categories: [...input.categories].sort(),
    instructionDigest,
    segmentationPolicyVersion: 'adaptive-narrative-v1',
    complete: input.complete,
    maxCalls: input.maxCalls,
    maxInputTokens: input.maxInputTokens,
    envelopeReserveTokens: input.envelopeReserveTokens,
    contextLimitTokens: input.contextLimitTokens,
    provider: input.provider,
    chunks: input.chunks,
  };
  const identityDigest = await sha256Text(JSON.stringify(identity));
  const now = Date.now();
  return {
    id: `import-${identityDigest.slice(0, 32)}`,
    schemaVersion: IMPORT_CHECKPOINT_SCHEMA,
    identityDigest,
    source: input.source,
    plan: {
      operation: 'narrative-import', scope: input.scope, categories: [...input.categories].sort(),
      instructionDigest, segmentationPolicyVersion: 'adaptive-narrative-v1', complete: input.complete,
      maxCalls: input.maxCalls, maxInputTokens: input.maxInputTokens,
      envelopeReserveTokens: input.envelopeReserveTokens,
      payloadTokenBudgetTokens: input.maxInputTokens - input.envelopeReserveTokens,
      ...(input.contextLimitTokens ? { contextLimitTokens: input.contextLimitTokens } : {}),
    },
    provider: input.provider,
    segments: input.chunks.map(chunk => ({ ...chunk, status: 'pending', attempts: 0 })),
    budget: { maxCalls: input.maxCalls, callsUsed: 0 },
    coverage: { complete: false, processedCharacters: 0, totalCharacters: input.totalCharacters },
    createdAt: now,
    updatedAt: now,
  };
}

export async function matchesImportCheckpointIdentity(
  checkpoint: ImportCheckpoint,
  input: ImportCheckpointIdentityInput,
): Promise<boolean> {
  const candidate = await createImportCheckpoint(input);
  return checkpoint.schemaVersion === IMPORT_CHECKPOINT_SCHEMA && checkpoint.id === candidate.id &&
    checkpoint.identityDigest === candidate.identityDigest;
}

export function validateCheckpoint(value: unknown): value is ImportCheckpoint {
  if (!value || typeof value !== 'object') return false;
  const item = value as Partial<ImportCheckpoint>;
  if (item.schemaVersion !== IMPORT_CHECKPOINT_SCHEMA || typeof item.id !== 'string' ||
      typeof item.identityDigest !== 'string' || !item.source || !item.plan || !item.provider ||
      !Array.isArray(item.segments) || !item.budget || !item.coverage ||
      typeof item.source.digest !== 'string' || typeof item.source.filename !== 'string' ||
      typeof item.source.mediaType !== 'string' || !Number.isSafeInteger(item.source.byteLength) || item.source.byteLength < 0 ||
      item.plan.operation !== 'narrative-import' || !['complete', 'selective'].includes(item.plan.scope) ||
      !Array.isArray(item.plan.categories) || typeof item.plan.instructionDigest !== 'string' ||
      typeof item.plan.segmentationPolicyVersion !== 'string' || typeof item.plan.complete !== 'boolean' ||
      !Number.isSafeInteger(item.plan.maxCalls) || !Number.isSafeInteger(item.plan.maxInputTokens) ||
      !Number.isSafeInteger(item.plan.envelopeReserveTokens) || !Number.isSafeInteger(item.plan.payloadTokenBudgetTokens) ||
      item.plan.payloadTokenBudgetTokens !== item.plan.maxInputTokens - item.plan.envelopeReserveTokens ||
      typeof item.provider.connectionId !== 'string' || typeof item.provider.reasoningLevel !== 'string' ||
      !Number.isSafeInteger(item.budget.callsUsed) || !Number.isSafeInteger(item.budget.maxCalls) ||
      item.budget.callsUsed < 0 || item.budget.callsUsed > item.budget.maxCalls ||
      item.budget.maxCalls !== item.plan.maxCalls) return false;
  const validResult = (result: unknown): result is VerifiedExtraction => {
    if (!result || typeof result !== 'object') return false;
    const candidate = result as Partial<VerifiedExtraction>;
    const validEvidence = (evidence: unknown) => {
      if (!evidence || typeof evidence !== 'object') return false;
      const itemEvidence = evidence as Partial<VerifiedExtraction['findings'][number]['evidence']>;
      return typeof itemEvidence.sourceId === 'string' && typeof itemEvidence.version === 'string' &&
        typeof itemEvidence.digest === 'string' && Number.isSafeInteger(itemEvidence.start) &&
        Number.isSafeInteger(itemEvidence.end) && typeof itemEvidence.excerpt === 'string';
    };
    return Array.isArray(candidate.findings) && candidate.findings.every(item => validEvidence(item?.evidence)) &&
      Array.isArray(candidate.entities) && candidate.entities.every(item => validEvidence(item?.evidence) &&
        Array.isArray(item.attributes) && item.attributes.every(attribute => validEvidence(attribute?.evidence))) &&
      Array.isArray(candidate.relationships) && candidate.relationships.every(item => validEvidence(item?.evidence)) &&
      Array.isArray(candidate.ambiguities) && candidate.ambiguities.every(item => validEvidence(item?.evidence)) &&
      typeof candidate.rejectedEvidenceCount === 'number' && Number.isSafeInteger(candidate.rejectedEvidenceCount) && candidate.rejectedEvidenceCount >= 0;
  };
  if (item.segments.some(segment => !segment || typeof segment.id !== 'string' ||
      !Number.isSafeInteger(segment.index) || !Number.isSafeInteger(segment.start) ||
      !Number.isSafeInteger(segment.end) || segment.start < 0 || segment.end <= segment.start ||
      !['pending', 'in-flight', 'complete', 'failed', 'uncertain'].includes(segment.status) ||
      !Number.isSafeInteger(segment.attempts) || segment.attempts < 0 ||
      (segment.status === 'in-flight' && segment.attempts < 1) ||
      (segment.status === 'complete' && !validResult(segment.result)) ||
      (segment.status !== 'complete' && segment.result !== undefined))) return false;
  if (new Set(item.segments.map(segment => segment.id)).size !== item.segments.length ||
      item.segments.some(segment => segment.end > item.coverage!.totalCharacters) ||
      !Number.isSafeInteger(item.createdAt) || !Number.isSafeInteger(item.updatedAt)) return false;
  // Runtime schema checks guard corrupt and incompatible durable records.
  return item.source.digest.length > 0 && item.provider.connectionId.length > 0 &&
    Number.isSafeInteger(item.coverage.totalCharacters) && item.coverage.totalCharacters >= 0 &&
    Number.isSafeInteger(item.coverage.processedCharacters) && item.coverage.processedCharacters >= 0 &&
    typeof item.coverage.complete === 'boolean';
}

export function validateCheckpointEvidence(checkpoint: ImportCheckpoint, sourceText: string, digest: string): boolean {
  if (checkpoint.source.digest !== digest) return false;
  const evidenceIsValid = (evidence: { sourceId: string; version: string; digest: string; start: number; end: number; excerpt: string }) =>
    evidence.sourceId.length > 0 && evidence.version === 'v1' && evidence.digest === digest &&
    Number.isSafeInteger(evidence.start) && Number.isSafeInteger(evidence.end) && evidence.start >= 0 &&
    evidence.end > evidence.start && evidence.end <= sourceText.length &&
    sourceText.slice(evidence.start, evidence.end) === evidence.excerpt;
  return checkpoint.segments.every(segment => {
    if (segment.status !== 'complete') return true;
    const result = segment.result;
    if (!result) return false;
    return result.findings.every(item => evidenceIsValid(item.evidence)) &&
      result.entities.every(item => evidenceIsValid(item.evidence) && item.attributes.every(attribute => evidenceIsValid(attribute.evidence))) &&
      result.relationships.every(item => evidenceIsValid(item.evidence)) &&
      result.ambiguities.every(item => evidenceIsValid(item.evidence));
  });
}

type CheckpointResult<T> = { ok: true; value: T } | { ok: false; error: string };

function runCheckpointRequest<T>(
  factory: IDBFactory,
  stores: string[],
  mode: IDBTransactionMode,
  run: (tx: IDBTransaction, done: (value: T) => void) => void,
): Promise<CheckpointResult<T>> {
  return new Promise(resolve => {
    let db: IDBDatabase | undefined;
    let settled = false;
    let value: T;
    const finish = (result: CheckpointResult<T>) => {
      if (settled) return;
      settled = true;
      db?.close();
      resolve(result);
    };
    let request: IDBOpenDBRequest;
    try { request = factory.open(IDB_NAME, 2); }
    catch (error) {
      finish({ ok: false, error: error instanceof Error ? error.message : 'Could not open local analysis checkpoint storage.' });
      return;
    }
    request.onupgradeneeded = () => {
      const database = request.result;
      if (!database.objectStoreNames.contains(IDB_STORE)) database.createObjectStore(IDB_STORE, { keyPath: 'id' });
      if (!database.objectStoreNames.contains(IMPORT_CHECKPOINT_STORE)) database.createObjectStore(IMPORT_CHECKPOINT_STORE, { keyPath: 'id' });
    };
    request.onerror = () => finish({ ok: false, error: request.error?.message ?? 'Could not open local analysis checkpoint storage.' });
    request.onblocked = () => finish({ ok: false, error: 'Another tab is blocking local analysis checkpoint storage.' });
    request.onsuccess = () => {
      db = request.result;
      try {
        const tx = db.transaction(stores, mode);
        tx.oncomplete = () => finish({ ok: true, value });
        tx.onerror = tx.onabort = () => finish({ ok: false, error: tx.error?.message ?? 'Local analysis checkpoint transaction failed.' });
        run(tx, result => { value = result; });
      } catch (error) {
        finish({ ok: false, error: error instanceof Error ? error.message : 'Could not start local analysis checkpoint transaction.' });
      }
    };
  });
}

export function listImportCheckpoints(factory: IDBFactory): Promise<CheckpointResult<ImportCheckpoint[]>> {
  return runCheckpointRequest(factory, [IMPORT_CHECKPOINT_STORE], 'readonly', (tx, done) => {
    const request = tx.objectStore(IMPORT_CHECKPOINT_STORE).getAll();
    request.onsuccess = () => done(request.result.filter(validateCheckpoint).sort((a, b) => b.updatedAt - a.updatedAt));
  });
}

export function saveImportCheckpoint(factory: IDBFactory, checkpoint: ImportCheckpoint): Promise<CheckpointResult<void>> {
  if (!validateCheckpoint(checkpoint)) return Promise.resolve({ ok: false, error: 'Analysis checkpoint did not pass schema validation.' });
  return runCheckpointRequest<'saved' | 'exists'>(factory, [IMPORT_CHECKPOINT_STORE], 'readwrite', (tx, done) => {
    const store = tx.objectStore(IMPORT_CHECKPOINT_STORE);
    const existingCheckpoint = store.get(checkpoint.id);
    existingCheckpoint.onsuccess = () => {
      if (existingCheckpoint.result) { done('exists'); return; }
      const all = store.getAll();
      all.onsuccess = () => {
        const existing = all.result as ImportCheckpoint[];
        const updatedAt = Math.max(Date.now(), ...existing.map(item => item.updatedAt + 1));
        const next = { ...checkpoint, updatedAt };
        const put = store.put(next);
        put.onerror = () => tx.abort();
        const ordered = [...existing, next]
          .sort((a, b) => b.updatedAt - a.updatedAt || b.createdAt - a.createdAt || a.id.localeCompare(b.id));
        for (const stale of ordered.slice(MAX_IMPORT_CHECKPOINTS)) store.delete(stale.id);
        done('saved');
      };
      all.onerror = () => tx.abort();
    };
    existingCheckpoint.onerror = () => tx.abort();
  }).then(result => {
    if (!result.ok) return result;
    return result.value === 'exists'
      ? { ok: false, error: 'A checkpoint already exists for this source and plan. Restore it before starting more analysis so the saved attempt budget cannot reset.' }
      : { ok: true, value: undefined };
  });
}

export function reserveImportSegmentAttempt(
  factory: IDBFactory,
  checkpointId: string,
  segmentId: string,
  allowUncertainRetry = false,
): Promise<CheckpointResult<ImportCheckpoint>> {
  return runCheckpointRequest(factory, [IMPORT_CHECKPOINT_STORE], 'readwrite', (tx, done) => {
    const store = tx.objectStore(IMPORT_CHECKPOINT_STORE);
    const request = store.get(checkpointId);
    request.onsuccess = () => {
      const checkpoint = request.result;
      if (!validateCheckpoint(checkpoint)) { tx.abort(); return; }
      const segment = checkpoint.segments.find(candidate => candidate.id === segmentId);
      const retryable = segment?.status === 'pending' || segment?.status === 'failed' ||
        (allowUncertainRetry && segment?.status === 'uncertain');
      if (!segment || !retryable || checkpoint.budget.callsUsed >= checkpoint.budget.maxCalls) { tx.abort(); return; }
      segment.status = 'in-flight';
      segment.attempts += 1;
      checkpoint.budget.callsUsed += 1;
      checkpoint.updatedAt = Date.now();
      store.put(checkpoint);
      done(checkpoint);
    };
  });
}

export function updateImportCheckpoint(
  factory: IDBFactory,
  checkpointId: string,
  update: (checkpoint: ImportCheckpoint) => void,
): Promise<CheckpointResult<ImportCheckpoint>> {
  return runCheckpointRequest(factory, [IMPORT_CHECKPOINT_STORE], 'readwrite', (tx, done) => {
    const store = tx.objectStore(IMPORT_CHECKPOINT_STORE);
    const request = store.get(checkpointId);
    request.onsuccess = () => {
      const checkpoint = request.result;
      if (!validateCheckpoint(checkpoint)) { tx.abort(); return; }
      update(checkpoint);
      checkpoint.updatedAt = Date.now();
      if (!validateCheckpoint(checkpoint)) { tx.abort(); return; }
      store.put(checkpoint);
      done(checkpoint);
    };
  });
}

export function deleteImportCheckpoint(factory: IDBFactory, checkpointId: string): Promise<CheckpointResult<void>> {
  return runCheckpointRequest(factory, [IMPORT_CHECKPOINT_STORE], 'readwrite', (tx, done) => {
    tx.objectStore(IMPORT_CHECKPOINT_STORE).delete(checkpointId);
    done(undefined);
  });
}

/** An in-flight request at process exit is uncertain and is never replayed implicitly. */
export function markInterruptedSegmentsUncertain(checkpoint: ImportCheckpoint): ImportCheckpoint {
  return {
    ...checkpoint,
    segments: checkpoint.segments.map(segment => segment.status === 'in-flight' ? { ...segment, status: 'uncertain' } : segment),
  };
}
