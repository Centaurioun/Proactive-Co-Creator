import type { VerifiedExtraction } from './proposalValidator.ts';
import { NarrativeExtractionSchema } from '../../../shared/importSchemas.ts';
import { IDB_NAME, IDB_STORE, IMPORT_CHECKPOINT_STORE } from '../../storage/constants.ts';

export { IMPORT_CHECKPOINT_STORE };
export const IMPORT_CHECKPOINT_SCHEMA = 3;
export const MAX_IMPORT_CHECKPOINTS = 8;
const MAX_IMPORT_CHECKPOINT_SEGMENTS = 20;
const MAX_IMPORT_CHECKPOINT_CALLS = 12;

export interface ImportCheckpoint {
  id: string;
  schemaVersion: 3;
  /** Separates a deleted/recreated checkpoint with the same deterministic plan ID. */
  incarnationId: string;
  identityDigest: string;
  source: { digest: string; filename: string; mediaType: string; byteLength: number };
  plan: {
    operation: 'narrative-import'; scope: 'complete' | 'selective'; categories: string[];
    instructionDigest: string; segmentationPolicyVersion: string; complete: boolean;
    maxCalls: number; maxInputTokens: number; envelopeReserveTokens: number; payloadTokenBudgetTokens: number;
    suggestedSegments: Array<{ id: string; index: number; start: number; end: number }>;
    suggestedSegmentCount: number; scheduledSegmentCount: number; scheduledEnd: number; omittedCharacters: number;
    contextLimitTokens?: number;
  };
  provider: { connectionId: string; modelId?: string; reasoningLevel: string; capabilityPolicyVersion?: string; credentialAuthorityId?: string };
  segments: Array<{
    id: string; index: number; start: number; end: number;
    status: 'pending' | 'in-flight' | 'complete' | 'failed' | 'uncertain';
    attempts: number; attemptId?: string; ownerId?: string; leaseExpiresAt?: number; result?: VerifiedExtraction;
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

// SHA-256's small synchronous form lets the IDB transaction validate that the
// immutable fields still match their digest before reserving or committing.
function sha256HexSync(value: string): string {
  const constants = [
    0x428a2f98,0x71374491,0xb5c0fbcf,0xe9b5dba5,0x3956c25b,0x59f111f1,0x923f82a4,0xab1c5ed5,
    0xd807aa98,0x12835b01,0x243185be,0x550c7dc3,0x72be5d74,0x80deb1fe,0x9bdc06a7,0xc19bf174,
    0xe49b69c1,0xefbe4786,0x0fc19dc6,0x240ca1cc,0x2de92c6f,0x4a7484aa,0x5cb0a9dc,0x76f988da,
    0x983e5152,0xa831c66d,0xb00327c8,0xbf597fc7,0xc6e00bf3,0xd5a79147,0x06ca6351,0x14292967,
    0x27b70a85,0x2e1b2138,0x4d2c6dfc,0x53380d13,0x650a7354,0x766a0abb,0x81c2c92e,0x92722c85,
    0xa2bfe8a1,0xa81a664b,0xc24b8b70,0xc76c51a3,0xd192e819,0xd6990624,0xf40e3585,0x106aa070,
    0x19a4c116,0x1e376c08,0x2748774c,0x34b0bcb5,0x391c0cb3,0x4ed8aa4a,0x5b9cca4f,0x682e6ff3,
    0x748f82ee,0x78a5636f,0x84c87814,0x8cc70208,0x90befffa,0xa4506ceb,0xbef9a3f7,0xc67178f2,
  ];
  const hash = [0x6a09e667,0xbb67ae85,0x3c6ef372,0xa54ff53a,0x510e527f,0x9b05688c,0x1f83d9ab,0x5be0cd19];
  const bytes = [...new TextEncoder().encode(value), 0x80];
  while (bytes.length % 64 !== 56) bytes.push(0);
  const bitLength = new TextEncoder().encode(value).length * 8;
  const high = Math.floor(bitLength / 0x100000000), low = bitLength >>> 0;
  for (let i = 3; i >= 0; i -= 1) bytes.push((high >>> (i * 8)) & 255);
  for (let i = 3; i >= 0; i -= 1) bytes.push((low >>> (i * 8)) & 255);
  const rotate = (n: number, amount: number) => (n >>> amount) | (n << (32 - amount));
  for (let offset = 0; offset < bytes.length; offset += 64) {
    const words = new Array<number>(64);
    for (let i = 0; i < 16; i += 1) {
      const at = offset + i * 4;
      words[i] = ((bytes[at] << 24) | (bytes[at + 1] << 16) | (bytes[at + 2] << 8) | bytes[at + 3]) >>> 0;
    }
    for (let i = 16; i < 64; i += 1) {
      const x = words[i - 15], y = words[i - 2];
      const s0 = rotate(x, 7) ^ rotate(x, 18) ^ (x >>> 3);
      const s1 = rotate(y, 17) ^ rotate(y, 19) ^ (y >>> 10);
      words[i] = (words[i - 16] + s0 + words[i - 7] + s1) >>> 0;
    }
    let [a,b,c,d,e,f,g,h] = hash;
    for (let i = 0; i < 64; i += 1) {
      const s1 = rotate(e, 6) ^ rotate(e, 11) ^ rotate(e, 25);
      const choice = (e & f) ^ (~e & g);
      const t1 = (h + s1 + choice + constants[i] + words[i]) >>> 0;
      const s0 = rotate(a, 2) ^ rotate(a, 13) ^ rotate(a, 22);
      const majority = (a & b) ^ (a & c) ^ (b & c);
      const t2 = (s0 + majority) >>> 0;
      h=g; g=f; f=e; e=(d+t1)>>>0; d=c; c=b; b=a; a=(t1+t2)>>>0;
    }
    [a,b,c,d,e,f,g,h].forEach((part, index) => { hash[index] = (hash[index] + part) >>> 0; });
  }
  return hash.map(part => part.toString(16).padStart(8, '0')).join('');
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
  if (input.maxCalls > MAX_IMPORT_CHECKPOINT_CALLS) throw new RangeError('Narrative import checkpoints cannot exceed the 12-call safety ceiling.');
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
      suggestedSegments: input.chunks.map(chunk => ({ ...chunk })),
      suggestedSegmentCount: input.chunks.length,
      scheduledSegmentCount: Math.min(input.chunks.length, input.maxCalls),
      scheduledEnd: input.chunks[Math.min(input.chunks.length, input.maxCalls) - 1]?.end ?? 0,
      omittedCharacters: input.totalCharacters - (input.chunks[Math.min(input.chunks.length, input.maxCalls) - 1]?.end ?? 0),
      ...(input.contextLimitTokens ? { contextLimitTokens: input.contextLimitTokens } : {}),
    },
    provider: input.provider,
    incarnationId: crypto.randomUUID(),
    segments: input.chunks.slice(0, input.maxCalls).map(chunk => ({ ...chunk, status: 'pending', attempts: 0 })),
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
  return validateCheckpoint(checkpoint) && checkpoint.id === candidate.id &&
    checkpoint.identityDigest === candidate.identityDigest &&
    checkpoint.identityDigest === sha256HexSync(JSON.stringify(identityForCheckpoint(checkpoint)));
}

function identityForCheckpoint(checkpoint: ImportCheckpoint) {
  return {
    source: checkpoint.source,
    operation: 'narrative-import',
    scope: checkpoint.plan.scope,
    categories: checkpoint.plan.categories,
    instructionDigest: checkpoint.plan.instructionDigest,
    segmentationPolicyVersion: checkpoint.plan.segmentationPolicyVersion,
    complete: checkpoint.plan.complete,
    maxCalls: checkpoint.plan.maxCalls,
    maxInputTokens: checkpoint.plan.maxInputTokens,
    envelopeReserveTokens: checkpoint.plan.envelopeReserveTokens,
    contextLimitTokens: checkpoint.plan.contextLimitTokens,
    provider: checkpoint.provider,
    chunks: checkpoint.plan.suggestedSegments,
  };
}

export function validateCheckpoint(value: unknown): value is ImportCheckpoint {
  if (!value || typeof value !== 'object') return false;
  const item = value as Partial<ImportCheckpoint>;
  if (item.schemaVersion !== IMPORT_CHECKPOINT_SCHEMA || typeof item.id !== 'string' ||
      typeof item.incarnationId !== 'string' || item.incarnationId.length < 8 ||
      typeof item.identityDigest !== 'string' || !item.source || !item.plan || !item.provider ||
      !Array.isArray(item.segments) || !item.budget || !item.coverage ||
      typeof item.source.digest !== 'string' || typeof item.source.filename !== 'string' ||
      typeof item.source.mediaType !== 'string' || !Number.isSafeInteger(item.source.byteLength) || item.source.byteLength < 0 ||
      item.plan.operation !== 'narrative-import' || !['complete', 'selective'].includes(item.plan.scope) ||
      !Array.isArray(item.plan.categories) || typeof item.plan.instructionDigest !== 'string' ||
      typeof item.plan.segmentationPolicyVersion !== 'string' || typeof item.plan.complete !== 'boolean' ||
      !Number.isSafeInteger(item.plan.maxCalls) || item.plan.maxCalls < 1 || item.plan.maxCalls > MAX_IMPORT_CHECKPOINT_CALLS || !Number.isSafeInteger(item.plan.maxInputTokens) || item.plan.maxInputTokens < 1 ||
      !Number.isSafeInteger(item.plan.envelopeReserveTokens) || item.plan.envelopeReserveTokens < 0 || !Number.isSafeInteger(item.plan.payloadTokenBudgetTokens) ||
      !Array.isArray(item.plan.suggestedSegments) || !item.plan.suggestedSegments.length ||
      !Number.isSafeInteger(item.plan.suggestedSegmentCount) || !Number.isSafeInteger(item.plan.scheduledSegmentCount) ||
      !Number.isSafeInteger(item.plan.scheduledEnd) || !Number.isSafeInteger(item.plan.omittedCharacters) ||
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
    if (!Array.isArray(candidate.findings) || !Array.isArray(candidate.entities) ||
        !Array.isArray(candidate.relationships) || !Array.isArray(candidate.ambiguities) ||
        typeof candidate.rejectedEvidenceCount !== 'number' || !Number.isSafeInteger(candidate.rejectedEvidenceCount) || candidate.rejectedEvidenceCount < 0) return false;
    const fieldsValid = candidate.findings.every(item => validEvidence(item?.evidence)) &&
      candidate.entities.every(item => validEvidence(item?.evidence) &&
        Array.isArray(item.attributes) && item.attributes.every(attribute => validEvidence(attribute?.evidence))) &&
      candidate.relationships.every(item => validEvidence(item?.evidence)) &&
      candidate.ambiguities.every(item => validEvidence(item?.evidence));
    if (!fieldsValid) return false;
    const toRaw = <T extends { evidence: VerifiedExtraction['findings'][number]['evidence'] }>(item: T) => {
      const { evidence, ...proposal } = item;
      return { ...proposal, evidence: { start: evidence.start, end: evidence.end, quote: evidence.excerpt } };
    };
    try {
      return NarrativeExtractionSchema.safeParse({
        findings: candidate.findings.map(toRaw),
        entities: candidate.entities.map(entity => ({ ...toRaw(entity), attributes: entity.attributes.map(toRaw) })),
        relationships: candidate.relationships.map(toRaw),
        ambiguities: candidate.ambiguities.map(toRaw),
      }).success;
    } catch { return false; }
  };
  if (!item.plan.categories.every(category => typeof category === 'string') ||
      new Set(item.plan.categories).size !== item.plan.categories.length ||
      (item.plan.contextLimitTokens !== undefined && (!Number.isSafeInteger(item.plan.contextLimitTokens) || item.plan.contextLimitTokens < 1)) ||
      (item.provider.modelId !== undefined && (typeof item.provider.modelId !== 'string' || !item.provider.modelId)) ||
      (item.provider.capabilityPolicyVersion !== undefined && typeof item.provider.capabilityPolicyVersion !== 'string') ||
      (item.provider.credentialAuthorityId !== undefined && (typeof item.provider.credentialAuthorityId !== 'string' || !item.provider.credentialAuthorityId)) ||
      !item.segments.length || item.segments.length !== Math.min(item.plan.suggestedSegments.length, item.plan.maxCalls) ||
      item.segments.some((segment, index) => !segment || typeof segment.id !== 'string' ||
      segment.id !== `chunk-${index + 1}` || segment.index !== index ||
      !Number.isSafeInteger(segment.index) || !Number.isSafeInteger(segment.start) ||
      !Number.isSafeInteger(segment.end) || segment.start < 0 || segment.end <= segment.start ||
      !['pending', 'in-flight', 'complete', 'failed', 'uncertain'].includes(segment.status) ||
      !Number.isSafeInteger(segment.attempts) || segment.attempts < 0 ||
      (segment.status === 'in-flight' && (segment.attempts < 1 || typeof segment.attemptId !== 'string' ||
        typeof segment.ownerId !== 'string' || !Number.isSafeInteger(segment.leaseExpiresAt))) ||
      (segment.attempts > 0 && typeof segment.attemptId !== 'string') ||
      (segment.status !== 'in-flight' && (segment.ownerId !== undefined || segment.leaseExpiresAt !== undefined)) ||
      (segment.status !== 'pending' && segment.attempts < 1) ||
      (segment.status === 'complete' && !validResult(segment.result)) ||
      (segment.status !== 'complete' && segment.result !== undefined))) return false;
  const segments = item.segments!;
  const suggestedSegments = item.plan.suggestedSegments!;
  const completed = segments.filter(segment => segment.status === 'complete')
    .map(({ start, end }) => ({ start, end })).sort((a, b) => a.start - b.start);
  let expectedProcessedCharacters = 0;
  let coverageEnd = -1;
  for (const span of completed) {
    if (coverageEnd < 0 || span.start > coverageEnd) expectedProcessedCharacters += span.end - span.start;
    else if (span.end > coverageEnd) expectedProcessedCharacters += span.end - coverageEnd;
    coverageEnd = Math.max(coverageEnd, span.end);
  }
  if (suggestedSegments.length > MAX_IMPORT_CHECKPOINT_SEGMENTS || item.plan.suggestedSegmentCount !== suggestedSegments.length ||
      item.plan.scheduledSegmentCount !== segments.length || item.plan.scheduledEnd !== segments.at(-1)!.end ||
      item.plan.omittedCharacters !== item.coverage!.totalCharacters - item.plan.scheduledEnd ||
      suggestedSegments.some((segment, index) => !segment || segment.id !== `chunk-${index + 1}` || segment.index !== index ||
        !Number.isSafeInteger(segment.start) || !Number.isSafeInteger(segment.end) || segment.start < 0 || segment.end <= segment.start || segment.end > item.coverage!.totalCharacters ||
        (index === 0 ? segment.start !== 0 : segment.start > suggestedSegments[index - 1].end || segment.end <= suggestedSegments[index - 1].end)) ||
      segments.some((segment, index) => {
        const suggested = suggestedSegments[index];
        return !suggested || segment.id !== suggested.id || segment.index !== suggested.index || segment.start !== suggested.start || segment.end !== suggested.end;
      }) ||
      new Set(segments.map(segment => segment.id)).size !== segments.length ||
      segments[0].start !== 0 ||
      segments.some((segment, index) => index > 0 && (segment.start > segments[index - 1].end || segment.end <= segments[index - 1].end)) ||
      segments.some(segment => segment.end > item.coverage!.totalCharacters) ||
      item.plan.complete !== (segments.length === suggestedSegments.length && suggestedSegments.at(-1)!.end === item.coverage!.totalCharacters) ||
      !Number.isSafeInteger(item.createdAt) || !Number.isSafeInteger(item.updatedAt)) return false;
  // Runtime schema checks guard corrupt and incompatible durable records.
  return item.source.digest.length > 0 && item.provider.connectionId.length > 0 &&
    Number.isSafeInteger(item.coverage.totalCharacters) && item.coverage.totalCharacters >= 0 &&
    Number.isSafeInteger(item.coverage.processedCharacters) && item.coverage.processedCharacters >= 0 &&
    item.coverage.processedCharacters === expectedProcessedCharacters &&
    item.coverage.totalCharacters >= 1 && typeof item.coverage.complete === 'boolean' &&
    item.budget.callsUsed === item.segments.reduce((sum, segment) => sum + segment.attempts, 0) &&
    item.coverage.complete === (item.plan.complete && item.segments.every(segment => segment.status === 'complete')) &&
    item.identityDigest === sha256HexSync(JSON.stringify(identityForCheckpoint(item as ImportCheckpoint))) &&
    item.id === `import-${item.identityDigest.slice(0, 32)}`;
}

/** Upgrade durable checkpoints without refunding their already reserved attempts. */
function migrateLegacyCheckpoint(value: unknown): ImportCheckpoint | undefined {
  if (!value || typeof value !== 'object' || ![1, 2].includes((value as { schemaVersion?: number }).schemaVersion ?? -1)) return undefined;
  const legacy = value as Omit<ImportCheckpoint, 'schemaVersion' | 'incarnationId'> & { schemaVersion: 1 | 2 };
  if (!Array.isArray(legacy.segments) || !legacy.budget || !Number.isSafeInteger(legacy.budget.callsUsed)) return undefined;
  // Older oversized budgets cannot be reconciled with the fixed 12-call policy
  // without changing their immutable identity or refunding attempts. Leave the
  // durable record untouched and fail closed instead of presenting it as resumable.
  if (legacy.plan.maxCalls > MAX_IMPORT_CHECKPOINT_CALLS || legacy.budget.callsUsed > MAX_IMPORT_CHECKPOINT_CALLS ||
      legacy.segments.length > MAX_IMPORT_CHECKPOINT_CALLS) return undefined;
  const now = Date.now();
  const migrated: ImportCheckpoint = {
    ...legacy,
    schemaVersion: IMPORT_CHECKPOINT_SCHEMA,
    incarnationId: crypto.randomUUID(),
    plan: {
      ...legacy.plan,
      suggestedSegments: legacy.segments.map(({ id, index, start, end }) => ({ id, index, start, end })),
      suggestedSegmentCount: legacy.segments.length,
      scheduledSegmentCount: legacy.segments.length,
      scheduledEnd: legacy.segments.at(-1)?.end ?? 0,
      omittedCharacters: legacy.coverage.totalCharacters - (legacy.segments.at(-1)?.end ?? 0),
    },
    segments: legacy.segments.map(segment => ({
      ...segment,
      ...(segment.attempts > 0 ? { attemptId: crypto.randomUUID() } : {}),
      ...(segment.status === 'in-flight' ? { ownerId: 'legacy-owner', leaseExpiresAt: now + 120_000 } : {}),
    })),
  };
  return validateCheckpoint(migrated) ? migrated : undefined;
}

function hasUnresumableLegacyBudget(value: unknown): boolean {
  if (!value || typeof value !== 'object') return false;
  const legacy = value as { schemaVersion?: number; plan?: { maxCalls?: number }; budget?: { callsUsed?: number }; segments?: unknown[] };
  return [1, 2].includes(legacy.schemaVersion ?? -1) && (
    (Number.isSafeInteger(legacy.plan?.maxCalls) && legacy.plan!.maxCalls! > MAX_IMPORT_CHECKPOINT_CALLS) ||
    (Number.isSafeInteger(legacy.budget?.callsUsed) && legacy.budget!.callsUsed! > MAX_IMPORT_CHECKPOINT_CALLS) ||
    (Array.isArray(legacy.segments) && legacy.segments.length > MAX_IMPORT_CHECKPOINT_CALLS)
  );
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
    const anchored = (evidence: Parameters<typeof evidenceIsValid>[0]) => evidenceIsValid(evidence) &&
      evidence.start >= segment.start && evidence.end <= segment.end;
    return result.findings.every(item => anchored(item.evidence)) &&
      result.entities.every(item => anchored(item.evidence) && item.attributes.every(attribute => anchored(attribute.evidence))) &&
      result.relationships.every(item => anchored(item.evidence)) &&
      result.ambiguities.every(item => anchored(item.evidence));
  });
}

type CheckpointResult<T> = { ok: true; value: T; warning?: string } | { ok: false; error: string };

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
  let unsupportedOversizedLegacy = false;
  return runCheckpointRequest<ImportCheckpoint[]>(factory, [IMPORT_CHECKPOINT_STORE], 'readwrite', (tx, done) => {
    const store = tx.objectStore(IMPORT_CHECKPOINT_STORE);
    const request = store.getAll();
    request.onsuccess = () => {
      const records = request.result.map(value => {
        const migrated = migrateLegacyCheckpoint(value);
        if (migrated) { store.put(migrated); return migrated; }
        if (hasUnresumableLegacyBudget(value)) unsupportedOversizedLegacy = true;
        return value;
      });
      done(records.filter(validateCheckpoint).sort((a, b) => b.updatedAt - a.updatedAt));
    };
  }).then(result => result.ok && unsupportedOversizedLegacy
    ? { ...result, warning: 'An older analysis checkpoint exceeds the 12-call safety ceiling. It remains stored with its attempts intact and cannot be resumed under the current plan.' }
    : result);
}

export function getImportCheckpoint(factory: IDBFactory, checkpointId: string): Promise<CheckpointResult<ImportCheckpoint | undefined>> {
  return runCheckpointRequest(factory, [IMPORT_CHECKPOINT_STORE], 'readwrite', (tx, done) => {
    const store = tx.objectStore(IMPORT_CHECKPOINT_STORE);
    const request = store.get(checkpointId);
    request.onsuccess = () => {
      const migrated = migrateLegacyCheckpoint(request.result);
      if (migrated) { store.put(migrated); done(migrated); return; }
      done(validateCheckpoint(request.result) ? request.result : undefined);
    };
  });
}

export function saveImportCheckpoint(factory: IDBFactory, checkpoint: ImportCheckpoint): Promise<CheckpointResult<void>> {
  if (!validateCheckpoint(checkpoint)) return Promise.resolve({ ok: false, error: 'Analysis checkpoint did not pass schema validation.' });
  return runCheckpointRequest<'saved' | 'exists'>(factory, [IMPORT_CHECKPOINT_STORE], 'readwrite', (tx, done) => {
    const store = tx.objectStore(IMPORT_CHECKPOINT_STORE);
    const existingCheckpoint = store.get(checkpoint.id);
    existingCheckpoint.onsuccess = () => {
      if (existingCheckpoint.result) {
        const migrated = migrateLegacyCheckpoint(existingCheckpoint.result);
        if (migrated) store.put(migrated);
        done('exists'); return;
      }
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
  ownerOrAllowRetry: string | boolean = false,
  allowUncertainRetry = false,
  leaseMs = 120_000,
): Promise<CheckpointResult<ImportCheckpoint>> {
  const ownerId = typeof ownerOrAllowRetry === 'string' ? ownerOrAllowRetry : 'legacy-owner';
  const allowRetry = typeof ownerOrAllowRetry === 'boolean' ? ownerOrAllowRetry : allowUncertainRetry;
  return runCheckpointRequest(factory, [IMPORT_CHECKPOINT_STORE], 'readwrite', (tx, done) => {
    const store = tx.objectStore(IMPORT_CHECKPOINT_STORE);
    const request = store.get(checkpointId);
    request.onsuccess = () => {
      const migrated = migrateLegacyCheckpoint(request.result);
      const checkpoint = migrated ?? request.result;
      if (!validateCheckpoint(checkpoint)) { tx.abort(); return; }
      if (migrated) store.put(migrated);
      const segment = checkpoint.segments.find(candidate => candidate.id === segmentId);
      const expiredInFlight = segment?.status === 'in-flight' && (segment.leaseExpiresAt ?? Infinity) <= Date.now();
      const retryable = segment?.status === 'pending' || segment?.status === 'failed' ||
        (allowRetry && segment?.status === 'uncertain') || (allowRetry && expiredInFlight);
      if (!segment || !retryable || checkpoint.budget.callsUsed >= checkpoint.budget.maxCalls) { tx.abort(); return; }
      segment.status = 'in-flight';
      segment.attempts += 1;
      segment.attemptId = crypto.randomUUID();
      segment.ownerId = ownerId;
      segment.leaseExpiresAt = Date.now() + leaseMs;
      checkpoint.budget.callsUsed += 1;
      checkpoint.updatedAt = Date.now();
      store.put(checkpoint);
      done(checkpoint);
    };
  });
}

export interface ImportAttemptFence {
  checkpointId: string;
  incarnationId: string;
  segmentId: string;
  attemptId: string;
  ownerId: string;
}

/** Extends the live attempt lease only while this exact attempt still owns the segment. */
export function renewImportSegmentAttempt(
  factory: IDBFactory,
  fence: ImportAttemptFence,
  leaseMs = 120_000,
): Promise<CheckpointResult<boolean>> {
  return runCheckpointRequest(factory, [IMPORT_CHECKPOINT_STORE], 'readwrite', (tx, done) => {
    const store = tx.objectStore(IMPORT_CHECKPOINT_STORE);
    const request = store.get(fence.checkpointId);
    request.onsuccess = () => {
      const checkpoint = request.result;
      const segment = validateCheckpoint(checkpoint) && checkpoint.incarnationId === fence.incarnationId
        ? checkpoint.segments.find(item => item.id === fence.segmentId) : undefined;
      if (!segment || segment.status !== 'in-flight' || segment.attemptId !== fence.attemptId || segment.ownerId !== fence.ownerId ||
          typeof segment.leaseExpiresAt !== 'number' || segment.leaseExpiresAt <= Date.now()) {
        done(false); return;
      }
      segment.leaseExpiresAt = Date.now() + leaseMs;
      checkpoint.updatedAt = Date.now();
      store.put(checkpoint);
      done(true);
    };
  });
}

/** Applies a result only if the checkpoint incarnation and current attempt still match. */
export function commitImportSegmentAttempt(
  factory: IDBFactory,
  fence: ImportAttemptFence,
  update: (segment: ImportCheckpoint['segments'][number], checkpoint: ImportCheckpoint) => void,
): Promise<CheckpointResult<boolean>> {
  return runCheckpointRequest(factory, [IMPORT_CHECKPOINT_STORE], 'readwrite', (tx, done) => {
    const store = tx.objectStore(IMPORT_CHECKPOINT_STORE);
    const request = store.get(fence.checkpointId);
    request.onsuccess = () => {
      const checkpoint = request.result;
      const segment = validateCheckpoint(checkpoint) && checkpoint.incarnationId === fence.incarnationId
        ? checkpoint.segments.find(item => item.id === fence.segmentId) : undefined;
      if (!segment || segment.status !== 'in-flight' || segment.attemptId !== fence.attemptId || segment.ownerId !== fence.ownerId ||
          typeof segment.leaseExpiresAt !== 'number' || segment.leaseExpiresAt <= Date.now()) {
        done(false); return;
      }
      update(segment, checkpoint);
      delete segment.ownerId;
      delete segment.leaseExpiresAt;
      checkpoint.updatedAt = Date.now();
      if (!validateCheckpoint(checkpoint)) { tx.abort(); return; }
      store.put(checkpoint);
      done(true);
    };
  });
}

export function markExpiredImportAttemptsUncertain(
  factory: IDBFactory,
  checkpointId: string,
  now = Date.now(),
): Promise<CheckpointResult<ImportCheckpoint>> {
  return runCheckpointRequest(factory, [IMPORT_CHECKPOINT_STORE], 'readwrite', (tx, done) => {
    const store = tx.objectStore(IMPORT_CHECKPOINT_STORE);
    const request = store.get(checkpointId);
    request.onsuccess = () => {
      const migrated = migrateLegacyCheckpoint(request.result);
      const checkpoint = migrated ?? request.result;
      if (!validateCheckpoint(checkpoint)) { tx.abort(); return; }
      for (const segment of checkpoint.segments) {
        if (segment.status === 'in-flight' && (segment.leaseExpiresAt ?? Infinity) <= now) {
          segment.status = 'uncertain';
          delete segment.ownerId;
          delete segment.leaseExpiresAt;
        }
      }
      checkpoint.updatedAt = now;
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
