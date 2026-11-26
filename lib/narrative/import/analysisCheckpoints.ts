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
const SHA256_K = new Uint32Array([
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
  0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
  0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
  0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
  0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
  0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
]);
const SHA256_INIT = new Uint32Array([
  0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19,
]);
const SHA256_W = new Uint32Array(64);
const SHA256_H = new Uint32Array(8);
const SHARED_TEXT_ENCODER = new TextEncoder();
const HEX_BYTES = Array.from({ length: 256 }, (_, index) => index.toString(16).padStart(2, '0'));
let sha256Scratch = new Uint8Array(8192);

function rotr32(value: number, amount: number): number {
  return (value >>> amount) | (value << (32 - amount));
}

function sha256CompressBlock(bytes: Uint8Array, offset: number, hash: Uint32Array, words: Uint32Array): void {
  for (let i = 0; i < 16; i += 1) {
    const at = offset + i * 4;
    words[i] = ((bytes[at] << 24) | (bytes[at + 1] << 16) | (bytes[at + 2] << 8) | bytes[at + 3]) >>> 0;
  }
  for (let i = 16; i < 64; i += 1) {
    const x = words[i - 15];
    const y = words[i - 2];
    const s0 = rotr32(x, 7) ^ rotr32(x, 18) ^ (x >>> 3);
    const s1 = rotr32(y, 17) ^ rotr32(y, 19) ^ (y >>> 10);
    words[i] = (words[i - 16] + s0 + words[i - 7] + s1) >>> 0;
  }
  let a = hash[0];
  let b = hash[1];
  let c = hash[2];
  let d = hash[3];
  let e = hash[4];
  let f = hash[5];
  let g = hash[6];
  let h = hash[7];
  for (let i = 0; i < 64; i += 1) {
    const s1 = rotr32(e, 6) ^ rotr32(e, 11) ^ rotr32(e, 25);
    const choice = (e & f) ^ (~e & g);
    const t1 = (h + s1 + choice + SHA256_K[i] + words[i]) >>> 0;
    const s0 = rotr32(a, 2) ^ rotr32(a, 13) ^ rotr32(a, 22);
    const majority = (a & b) ^ (a & c) ^ (b & c);
    const t2 = (s0 + majority) >>> 0;
    h = g; g = f; f = e; e = (d + t1) >>> 0; d = c; c = b; b = a; a = (t1 + t2) >>> 0;
  }
  hash[0] = (hash[0] + a) >>> 0;
  hash[1] = (hash[1] + b) >>> 0;
  hash[2] = (hash[2] + c) >>> 0;
  hash[3] = (hash[3] + d) >>> 0;
  hash[4] = (hash[4] + e) >>> 0;
  hash[5] = (hash[5] + f) >>> 0;
  hash[6] = (hash[6] + g) >>> 0;
  hash[7] = (hash[7] + h) >>> 0;
}

function formatSha256Hex(hash: Uint32Array): string {
  let hex = '';
  for (let i = 0; i < 8; i += 1) {
    const word = hash[i];
    hex += HEX_BYTES[(word >>> 24) & 0xff] + HEX_BYTES[(word >>> 16) & 0xff] + HEX_BYTES[(word >>> 8) & 0xff] + HEX_BYTES[word & 0xff];
  }
  return hex;
}

export function sha256HexSync(value: string): string {
  const maxBytes = value.length * 3 + 72;
  if (maxBytes > sha256Scratch.length && maxBytes <= 131_072) {
    sha256Scratch = new Uint8Array(Math.max(maxBytes, sha256Scratch.length * 2));
  }
  const buffer = maxBytes <= sha256Scratch.length ? sha256Scratch : new Uint8Array(maxBytes);
  const { written } = SHARED_TEXT_ENCODER.encodeInto(value, buffer);
  const paddedLength = (((written + 8) >> 6) + 1) << 6;
  buffer[written] = 0x80;
  buffer.fill(0, written + 1, paddedLength - 8);
  const bitLength = written * 8;
  const high = Math.floor(bitLength / 0x100000000);
  const low = bitLength >>> 0;
  buffer[paddedLength - 8] = (high >>> 24) & 0xff;
  buffer[paddedLength - 7] = (high >>> 16) & 0xff;
  buffer[paddedLength - 6] = (high >>> 8) & 0xff;
  buffer[paddedLength - 5] = high & 0xff;
  buffer[paddedLength - 4] = (low >>> 24) & 0xff;
  buffer[paddedLength - 3] = (low >>> 16) & 0xff;
  buffer[paddedLength - 2] = (low >>> 8) & 0xff;
  buffer[paddedLength - 1] = low & 0xff;

  SHA256_H.set(SHA256_INIT);
  for (let offset = 0; offset < paddedLength; offset += 64) {
    sha256CompressBlock(buffer, offset, SHA256_H, SHA256_W);
  }
  return formatSha256Hex(SHA256_H);
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

function isNonNegativeInt(value: unknown): value is number {
  return Number.isSafeInteger(value) && (value as number) >= 0;
}

function isPositiveInt(value: unknown): value is number {
  return Number.isSafeInteger(value) && (value as number) >= 1;
}

function isValidCheckpointSource(source: unknown): source is ImportCheckpoint['source'] {
  if (!source || typeof source !== 'object') return false;
  const s = source as Partial<ImportCheckpoint['source']>;
  return typeof s.digest === 'string' && s.digest.length > 0 &&
    typeof s.filename === 'string' && typeof s.mediaType === 'string' &&
    isNonNegativeInt(s.byteLength);
}

function isValidCheckpointProvider(provider: unknown): provider is ImportCheckpoint['provider'] {
  if (!provider || typeof provider !== 'object') return false;
  const p = provider as Partial<ImportCheckpoint['provider']>;
  if (typeof p.connectionId !== 'string' || !p.connectionId || typeof p.reasoningLevel !== 'string') return false;
  if (p.modelId !== undefined && (typeof p.modelId !== 'string' || !p.modelId)) return false;
  if (p.capabilityPolicyVersion !== undefined && typeof p.capabilityPolicyVersion !== 'string') return false;
  if (p.credentialAuthorityId !== undefined && (typeof p.credentialAuthorityId !== 'string' || !p.credentialAuthorityId)) return false;
  return true;
}

function isValidCheckpointPlan(plan: unknown): plan is ImportCheckpoint['plan'] {
  if (!plan || typeof plan !== 'object') return false;
  const p = plan as Partial<ImportCheckpoint['plan']>;
  const validCore = p.operation === 'narrative-import' &&
    (p.scope === 'complete' || p.scope === 'selective') &&
    Array.isArray(p.categories) && p.categories.every(c => typeof c === 'string') &&
    new Set(p.categories).size === p.categories.length &&
    typeof p.instructionDigest === 'string' &&
    typeof p.segmentationPolicyVersion === 'string' &&
    typeof p.complete === 'boolean';
  if (!validCore) return false;
  const validBounds = isPositiveInt(p.maxCalls) && p.maxCalls <= MAX_IMPORT_CHECKPOINT_CALLS &&
    isPositiveInt(p.maxInputTokens) && isNonNegativeInt(p.envelopeReserveTokens) &&
    Number.isSafeInteger(p.payloadTokenBudgetTokens) &&
    p.payloadTokenBudgetTokens === p.maxInputTokens - p.envelopeReserveTokens &&
    (p.contextLimitTokens === undefined || isPositiveInt(p.contextLimitTokens));
  if (!validBounds) return false;
  return Array.isArray(p.suggestedSegments) && p.suggestedSegments.length > 0 &&
    p.suggestedSegments.length <= MAX_IMPORT_CHECKPOINT_SEGMENTS &&
    Number.isSafeInteger(p.suggestedSegmentCount) && Number.isSafeInteger(p.scheduledSegmentCount) &&
    Number.isSafeInteger(p.scheduledEnd) && Number.isSafeInteger(p.omittedCharacters);
}

function isValidVerifiedEvidence(evidence: unknown): boolean {
  if (!evidence || typeof evidence !== 'object') return false;
  const e = evidence as Partial<VerifiedExtraction['findings'][number]['evidence']>;
  return typeof e.sourceId === 'string' && typeof e.version === 'string' &&
    typeof e.digest === 'string' && Number.isSafeInteger(e.start) &&
    Number.isSafeInteger(e.end) && typeof e.excerpt === 'string';
}

function toRawProposal<T extends { evidence: VerifiedExtraction['findings'][number]['evidence'] }>(item: T) {
  const { evidence, ...proposal } = item;
  return { ...proposal, evidence: { start: evidence.start, end: evidence.end, quote: evidence.excerpt } };
}

function isValidResultShapes(candidate: Partial<VerifiedExtraction>): boolean {
  if (!Array.isArray(candidate.findings)) return false;
  if (!Array.isArray(candidate.entities)) return false;
  if (!Array.isArray(candidate.relationships)) return false;
  if (!Array.isArray(candidate.ambiguities)) return false;
  return isNonNegativeInt(candidate.rejectedEvidenceCount);
}

function isValidResultEvidence(candidate: VerifiedExtraction): boolean {
  if (!candidate.findings.every(item => isValidVerifiedEvidence(item?.evidence))) return false;
  if (!candidate.relationships.every(item => isValidVerifiedEvidence(item?.evidence))) return false;
  if (!candidate.ambiguities.every(item => isValidVerifiedEvidence(item?.evidence))) return false;
  return candidate.entities.every(item =>
    isValidVerifiedEvidence(item?.evidence) &&
    Array.isArray(item.attributes) &&
    item.attributes.every(attr => isValidVerifiedEvidence(attr?.evidence)),
  );
}

function isValidVerifiedResult(result: unknown): result is VerifiedExtraction {
  if (!result || typeof result !== 'object') return false;
  const candidate = result as Partial<VerifiedExtraction>;
  if (!isValidResultShapes(candidate)) return false;
  const typed = candidate as VerifiedExtraction;
  if (!isValidResultEvidence(typed)) return false;
  try {
    return NarrativeExtractionSchema.safeParse({
      findings: typed.findings.map(toRawProposal),
      entities: typed.entities.map(entity => ({ ...toRawProposal(entity), attributes: entity.attributes.map(toRawProposal) })),
      relationships: typed.relationships.map(toRawProposal),
      ambiguities: typed.ambiguities.map(toRawProposal),
    }).success;
  } catch {
    return false;
  }
}

const VALID_SEGMENT_STATUSES = new Set(['pending', 'in-flight', 'complete', 'failed', 'uncertain']);

function isValidInFlightFields(segment: ImportCheckpoint['segments'][number]): boolean {
  if (segment.status === 'in-flight') {
    return segment.attempts >= 1 &&
      typeof segment.attemptId === 'string' &&
      typeof segment.ownerId === 'string' &&
      Number.isSafeInteger(segment.leaseExpiresAt);
  }
  return segment.ownerId === undefined && segment.leaseExpiresAt === undefined;
}

function isValidSegmentRecord(segment: ImportCheckpoint['segments'][number] | undefined, index: number): boolean {
  if (!segment || typeof segment.id !== 'string') return false;
  if (segment.id !== `chunk-${index + 1}` || segment.index !== index) return false;
  if (!isNonNegativeInt(segment.start) || !isPositiveInt(segment.end) || segment.end <= segment.start) return false;
  if (!VALID_SEGMENT_STATUSES.has(segment.status) || !isNonNegativeInt(segment.attempts)) return false;
  if (!isValidInFlightFields(segment)) return false;
  if (segment.attempts > 0 && typeof segment.attemptId !== 'string') return false;
  if (segment.status !== 'pending' && segment.attempts < 1) return false;
  return segment.status === 'complete' ? isValidVerifiedResult(segment.result) : segment.result === undefined;
}

function computeProcessedCharacters(segments: ImportCheckpoint['segments']): number {
  const completed = segments.filter(segment => segment.status === 'complete')
    .map(({ start, end }) => ({ start, end }))
    .sort((a, b) => a.start - b.start);
  let processed = 0;
  let coverageEnd = -1;
  for (const span of completed) {
    if (coverageEnd < 0 || span.start > coverageEnd) processed += span.end - span.start;
    else if (span.end > coverageEnd) processed += span.end - coverageEnd;
    coverageEnd = Math.max(coverageEnd, span.end);
  }
  return processed;
}

function isValidSegmentOrder(
  segment: { id: string; index: number; start: number; end: number },
  previous: { end: number } | undefined,
  totalCharacters: number,
): boolean {
  if (!isNonNegativeInt(segment.start) || !isPositiveInt(segment.end)) return false;
  if (segment.end <= segment.start || segment.end > totalCharacters) return false;
  if (!previous) return segment.start === 0;
  return segment.start <= previous.end && segment.end > previous.end;
}

function isValidSegmentSequence(
  segments: ReadonlyArray<{ id: string; index: number; start: number; end: number }>,
  totalCharacters: number,
): boolean {
  for (let index = 0; index < segments.length; index += 1) {
    const segment = segments[index];
    if (!segment) return false;
    if (segment.id !== `chunk-${index + 1}` || segment.index !== index) return false;
    if (!isValidSegmentOrder(segment, index > 0 ? segments[index - 1] : undefined, totalCharacters)) return false;
  }
  return true;
}

function segmentsMatchSuggested(
  segments: ImportCheckpoint['segments'],
  suggested: ImportCheckpoint['plan']['suggestedSegments'],
): boolean {
  return segments.every((segment, index) => {
    const ref = suggested[index];
    if (!ref) return false;
    return segment.id === ref.id && segment.index === ref.index && segment.start === ref.start && segment.end === ref.end;
  });
}

function isValidPlanSegmentCounts(
  plan: ImportCheckpoint['plan'],
  segments: ImportCheckpoint['segments'],
  totalCharacters: number,
): boolean {
  const suggested = plan.suggestedSegments;
  if (plan.suggestedSegmentCount !== suggested.length) return false;
  if (plan.scheduledSegmentCount !== segments.length) return false;
  if (plan.scheduledEnd !== segments.at(-1)!.end) return false;
  if (plan.omittedCharacters !== totalCharacters - plan.scheduledEnd) return false;
  return plan.complete === (segments.length === suggested.length && suggested.at(-1)!.end === totalCharacters);
}

function isValidSegmentSchedule(item: Partial<ImportCheckpoint>): boolean {
  const { segments, plan, coverage } = item;
  if (!segments?.length || !plan || !coverage) return false;
  if (!isPositiveInt(coverage.totalCharacters)) return false;
  const suggested = plan.suggestedSegments;
  if (segments.length !== Math.min(suggested.length, plan.maxCalls)) return false;
  if (segments.some((segment, index) => !isValidSegmentRecord(segment, index))) return false;
  if (!isValidSegmentSequence(suggested, coverage.totalCharacters)) return false;
  if (!isValidSegmentSequence(segments, coverage.totalCharacters)) return false;
  return segmentsMatchSuggested(segments, suggested) && isValidPlanSegmentCounts(plan, segments, coverage.totalCharacters);
}

function isValidCheckpointHeader(item: Partial<ImportCheckpoint>): boolean {
  if (item.schemaVersion !== IMPORT_CHECKPOINT_SCHEMA) return false;
  if (typeof item.id !== 'string' || typeof item.identityDigest !== 'string') return false;
  if (typeof item.incarnationId !== 'string' || item.incarnationId.length < 8) return false;
  return Number.isSafeInteger(item.createdAt) && Number.isSafeInteger(item.updatedAt);
}

function isValidBudgetCounts(budget: ImportCheckpoint['budget'] | undefined, plan: ImportCheckpoint['plan'], segments: ImportCheckpoint['segments']): boolean {
  if (!budget || !isNonNegativeInt(budget.callsUsed) || !isPositiveInt(budget.maxCalls)) return false;
  if (budget.callsUsed > budget.maxCalls || budget.maxCalls !== plan.maxCalls) return false;
  return budget.callsUsed === segments.reduce((sum, segment) => sum + segment.attempts, 0);
}

function isValidCheckpointBudgetAndCoverage(item: Partial<ImportCheckpoint>): boolean {
  const { budget, coverage, plan, segments } = item;
  if (!coverage || !plan || !segments || !isValidBudgetCounts(budget, plan, segments)) return false;
  if (typeof coverage.complete !== 'boolean' || !isNonNegativeInt(coverage.processedCharacters)) return false;
  if (coverage.processedCharacters !== computeProcessedCharacters(segments)) return false;
  return coverage.complete === (plan.complete && segments.every(segment => segment.status === 'complete'));
}

export function validateCheckpoint(value: unknown): value is ImportCheckpoint {
  if (!value || typeof value !== 'object') return false;
  const item = value as Partial<ImportCheckpoint>;
  if (!isValidCheckpointHeader(item) || !isValidCheckpointSource(item.source)) return false;
  if (!isValidCheckpointPlan(item.plan) || !isValidCheckpointProvider(item.provider)) return false;
  if (!isValidSegmentSchedule(item) || !isValidCheckpointBudgetAndCoverage(item)) return false;
  const computedDigest = sha256HexSync(JSON.stringify(identityForCheckpoint(item as ImportCheckpoint)));
  return item.identityDigest === computedDigest && item.id === `import-${item.identityDigest.slice(0, 32)}`;
}

function isLegacySchemaVersion(value: unknown): value is Record<string, unknown> & { schemaVersion: 1 | 2 } {
  if (!value || typeof value !== 'object') return false;
  const version = (value as { schemaVersion?: number }).schemaVersion;
  return version === 1 || version === 2;
}

type LegacyCheckpointShape = Omit<ImportCheckpoint, 'schemaVersion' | 'incarnationId'> & { schemaVersion: 1 | 2 };

function isMigratableLegacyShape(legacy: LegacyCheckpointShape): boolean {
  if (!Array.isArray(legacy.segments) || !legacy.budget || !Number.isSafeInteger(legacy.budget.callsUsed)) return false;
  if (legacy.plan.maxCalls > MAX_IMPORT_CHECKPOINT_CALLS) return false;
  return legacy.budget.callsUsed <= MAX_IMPORT_CHECKPOINT_CALLS && legacy.segments.length <= MAX_IMPORT_CHECKPOINT_CALLS;
}

function upgradeLegacySegment(segment: ImportCheckpoint['segments'][number], now: number): ImportCheckpoint['segments'][number] {
  return {
    ...segment,
    ...(segment.attempts > 0 ? { attemptId: crypto.randomUUID() } : {}),
    ...(segment.status === 'in-flight' ? { ownerId: 'legacy-owner', leaseExpiresAt: now + 120_000 } : {}),
  };
}

/** Upgrade durable checkpoints without refunding their already reserved attempts. */
function migrateLegacyCheckpoint(value: unknown): ImportCheckpoint | undefined {
  if (!isLegacySchemaVersion(value)) return undefined;
  const legacy = value as unknown as LegacyCheckpointShape;
  if (!isMigratableLegacyShape(legacy)) return undefined;
  const now = Date.now();
  const scheduledEnd = legacy.segments.at(-1)?.end ?? 0;
  const migrated: ImportCheckpoint = {
    ...legacy,
    schemaVersion: IMPORT_CHECKPOINT_SCHEMA,
    incarnationId: crypto.randomUUID(),
    plan: {
      ...legacy.plan,
      suggestedSegments: legacy.segments.map(({ id, index, start, end }) => ({ id, index, start, end })),
      suggestedSegmentCount: legacy.segments.length,
      scheduledSegmentCount: legacy.segments.length,
      scheduledEnd,
      omittedCharacters: legacy.coverage.totalCharacters - scheduledEnd,
    },
    segments: legacy.segments.map(segment => upgradeLegacySegment(segment, now)),
  };
  return validateCheckpoint(migrated) ? migrated : undefined;
}

function hasUnresumableLegacyBudget(value: unknown): boolean {
  if (!isLegacySchemaVersion(value)) return false;
  const legacy = value as { plan?: { maxCalls?: number }; budget?: { callsUsed?: number }; segments?: unknown[] };
  const overMax = isPositiveInt(legacy.plan?.maxCalls) && legacy.plan!.maxCalls! > MAX_IMPORT_CHECKPOINT_CALLS;
  const overUsed = isNonNegativeInt(legacy.budget?.callsUsed) && legacy.budget!.callsUsed! > MAX_IMPORT_CHECKPOINT_CALLS;
  const overSegs = Array.isArray(legacy.segments) && legacy.segments.length > MAX_IMPORT_CHECKPOINT_CALLS;
  return overMax || overUsed || overSegs;
}

type CheckpointEvidenceAnchor = { sourceId: string; version: string; digest: string; start: number; end: number; excerpt: string };

function isAnchoredEvidence(
  evidence: CheckpointEvidenceAnchor,
  sourceText: string,
  digest: string,
  bounds: { start: number; end: number },
): boolean {
  if (!evidence.sourceId.length || evidence.version !== 'v1' || evidence.digest !== digest) return false;
  if (!isNonNegativeInt(evidence.start) || !isPositiveInt(evidence.end)) return false;
  const withinBounds = evidence.start >= bounds.start && evidence.end <= bounds.end;
  const nonEmptySpan = evidence.end > evidence.start && evidence.end <= sourceText.length;
  return withinBounds && nonEmptySpan && sourceText.slice(evidence.start, evidence.end) === evidence.excerpt;
}

function isSegmentEvidenceValid(segment: ImportCheckpoint['segments'][number], sourceText: string, digest: string): boolean {
  if (segment.status !== 'complete') return true;
  const result = segment.result;
  if (!result) return false;
  const bounds = { start: segment.start, end: segment.end };
  const ok = (ev: CheckpointEvidenceAnchor) => isAnchoredEvidence(ev, sourceText, digest, bounds);
  return result.findings.every(item => ok(item.evidence)) &&
    result.entities.every(item => ok(item.evidence) && item.attributes.every(attr => ok(attr.evidence))) &&
    result.relationships.every(item => ok(item.evidence)) &&
    result.ambiguities.every(item => ok(item.evidence));
}

export function validateCheckpointEvidence(checkpoint: ImportCheckpoint, sourceText: string, digest: string): boolean {
  if (checkpoint.source.digest !== digest) return false;
  return checkpoint.segments.every(segment => isSegmentEvidenceValid(segment, sourceText, digest));
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
      try { db?.close(); } catch { /* ignore close error */ }
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
      if (settled) {
        try { request.result.close(); } catch { /* ignore close error on stale request */ }
        return;
      }
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

function hasActiveInFlightLease(checkpoint: Partial<ImportCheckpoint>, now: number): boolean {
  return Array.isArray(checkpoint.segments) && checkpoint.segments.some(
    segment => segment?.status === 'in-flight' &&
      typeof segment.leaseExpiresAt === 'number' &&
      Number.isFinite(segment.leaseExpiresAt) &&
      segment.leaseExpiresAt > now,
  );
}

function evictionTier(checkpoint: Partial<ImportCheckpoint>): number {
  if (!validateCheckpoint(checkpoint) || checkpoint.budget.callsUsed === 0) return 0;
  if (checkpoint.coverage.complete) return 1;
  return 2;
}

function finiteOrNegInf(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : -Infinity;
}

function compareEvictionPriority(a: ImportCheckpoint, b: ImportCheckpoint): number {
  const tierDiff = evictionTier(a) - evictionTier(b);
  if (tierDiff !== 0) return tierDiff;
  const updatedDiff = finiteOrNegInf(a?.updatedAt) - finiteOrNegInf(b?.updatedAt);
  if (updatedDiff !== 0) return updatedDiff;
  const createdDiff = finiteOrNegInf(a?.createdAt) - finiteOrNegInf(b?.createdAt);
  if (createdDiff !== 0) return createdDiff;
  return String(a?.id ?? '').localeCompare(String(b?.id ?? ''));
}

function selectEvictionCandidates(
  existing: ImportCheckpoint[],
  maxCheckpoints: number,
  now: number,
): { ok: true; victims: ImportCheckpoint[] } | { ok: false } {
  const excess = existing.length + 1 - maxCheckpoints;
  if (excess <= 0) return { ok: true, victims: [] };
  const evictable = existing.filter(item => !hasActiveInFlightLease(item, now));
  if (evictable.length < excess) return { ok: false };
  evictable.sort(compareEvictionPriority);
  return { ok: true, victims: evictable.slice(0, excess) };
}

function safeMonotonicUpdatedAt(existing: ImportCheckpoint[], now: number): number {
  const maxExisting = existing.reduce(
    (max, item) => (Number.isFinite(item?.updatedAt) ? Math.max(max, item.updatedAt) : max),
    0,
  );
  return Math.max(now, maxExisting + 1);
}

export function saveImportCheckpoint(factory: IDBFactory, checkpoint: ImportCheckpoint): Promise<CheckpointResult<void>> {
  if (!validateCheckpoint(checkpoint)) return Promise.resolve({ ok: false, error: 'Analysis checkpoint did not pass schema validation.' });
  return runCheckpointRequest<'saved' | 'exists' | 'slots-busy'>(factory, [IMPORT_CHECKPOINT_STORE], 'readwrite', (tx, done) => {
    const store = tx.objectStore(IMPORT_CHECKPOINT_STORE);
    const existingCheckpoint = store.get(checkpoint.id);
    existingCheckpoint.onsuccess = () => {
      if (existingCheckpoint.result) {
        const migrated = migrateLegacyCheckpoint(existingCheckpoint.result);
        if (migrated) store.put(migrated);
        done('exists');
        return;
      }
      const all = store.getAll();
      all.onsuccess = () => {
        const now = Date.now();
        const existing = all.result as ImportCheckpoint[];
        const selection = selectEvictionCandidates(existing, MAX_IMPORT_CHECKPOINTS, now);
        if (!selection.ok) {
          done('slots-busy');
          return;
        }
        const next = { ...checkpoint, updatedAt: safeMonotonicUpdatedAt(existing, now) };
        const put = store.put(next);
        put.onerror = () => tx.abort();
        for (const stale of selection.victims) store.delete(stale.id);
        done('saved');
      };
      all.onerror = () => tx.abort();
    };
    existingCheckpoint.onerror = () => tx.abort();
  }).then(result => {
    if (!result.ok) return result;
    if (result.value === 'exists') {
      return { ok: false, error: 'A checkpoint already exists for this source and plan. Restore it before starting more analysis so the saved attempt budget cannot reset.' };
    }
    if (result.value === 'slots-busy') {
      return { ok: false, error: 'All 8 local checkpoint slots currently hold active analyses. Finish or cancel an active analysis before saving another checkpoint.' };
    }
    return { ok: true, value: undefined };
  });
}

function isSegmentRetryable(
  segment: ImportCheckpoint['segments'][number] | undefined,
  allowRetry: boolean,
  now: number,
): segment is ImportCheckpoint['segments'][number] {
  if (!segment) return false;
  if (segment.status === 'pending' || segment.status === 'failed') return true;
  if (!allowRetry) return false;
  if (segment.status === 'uncertain') return true;
  return segment.status === 'in-flight' && (segment.leaseExpiresAt ?? Infinity) <= now;
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
      const now = Date.now();
      const segment = checkpoint.segments.find(candidate => candidate.id === segmentId);
      if (!isSegmentRetryable(segment, allowRetry, now) || checkpoint.budget.callsUsed >= checkpoint.budget.maxCalls) {
        tx.abort();
        return;
      }
      segment.status = 'in-flight';
      segment.attempts += 1;
      segment.attemptId = crypto.randomUUID();
      segment.ownerId = ownerId;
      segment.leaseExpiresAt = now + leaseMs;
      checkpoint.budget.callsUsed += 1;
      checkpoint.updatedAt = now;
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

function resolveOwnedLiveSegment(
  checkpoint: unknown,
  fence: ImportAttemptFence,
  now: number,
): ImportCheckpoint['segments'][number] | undefined {
  if (!validateCheckpoint(checkpoint) || checkpoint.incarnationId !== fence.incarnationId) return undefined;
  const segment = checkpoint.segments.find(item => item.id === fence.segmentId);
  if (!segment || segment.status !== 'in-flight') return undefined;
  if (segment.attemptId !== fence.attemptId || segment.ownerId !== fence.ownerId) return undefined;
  if (typeof segment.leaseExpiresAt !== 'number' || segment.leaseExpiresAt <= now) return undefined;
  return segment;
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
      const now = Date.now();
      const checkpoint = request.result as ImportCheckpoint;
      const segment = resolveOwnedLiveSegment(checkpoint, fence, now);
      if (!segment) { done(false); return; }
      segment.leaseExpiresAt = now + leaseMs;
      checkpoint.updatedAt = now;
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
      const now = Date.now();
      const checkpoint = request.result as ImportCheckpoint;
      const segment = resolveOwnedLiveSegment(checkpoint, fence, now);
      if (!segment) { done(false); return; }
      update(segment, checkpoint);
      delete segment.ownerId;
      delete segment.leaseExpiresAt;
      checkpoint.updatedAt = now;
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
