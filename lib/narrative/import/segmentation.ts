import type { SourceBlock } from './sourceParser.ts';

export const IMPORT_CHUNK_CHARS = 28_000;
export const IMPORT_OVERLAP_CHARS = 600;
export const MAX_IMPORT_CHUNKS = 20;
export const NARRATIVE_IMPORT_INPUT_TOKEN_LIMIT = 8_000;
export const NARRATIVE_IMPORT_ENVELOPE_RESERVE_TOKENS = 1_500;

export interface SourceChunk {
  id: string;
  index: number;
  start: number;
  end: number;
  text: string;
}

function isHighSurrogateAt(text: string, index: number): boolean {
  const code = text.charCodeAt(index);
  return code >= 0xd800 && code <= 0xdbff;
}

function isLowSurrogateAt(text: string, index: number): boolean {
  const code = text.charCodeAt(index);
  return code >= 0xdc00 && code <= 0xdfff;
}

function isSurrogatePairAt(text: string, index: number): boolean {
  return index + 1 < text.length && isHighSurrogateAt(text, index) && isLowSurrogateAt(text, index + 1);
}

function safeEnd(text: string, start: number, target: number): number {
  let end = Math.min(target, text.length);
  if (end < text.length && end > start && isHighSurrogateAt(text, end - 1)) end -= 1;
  if (end < text.length && end > start) {
    const boundary = text.lastIndexOf('\n\n', end);
    if (boundary > start + Math.floor((end - start) * 0.55)) end = boundary + 2;
  }
  return Math.max(start + 1, end);
}

function findLastBlockEndBefore(validBlocks: readonly SourceBlock[], start: number, end: number): number | undefined {
  let low = 0;
  let high = validBlocks.length;
  while (low < high) {
    const middle = low + Math.floor((high - low) / 2);
    if (validBlocks[middle].end <= end) low = middle + 1;
    else high = middle;
  }
  const boundary = validBlocks[low - 1]?.end;
  return boundary !== undefined && boundary > start ? boundary : undefined;
}

function nextChunkStart(text: string, start: number, end: number, overlap: number): number {
  let next = Math.max(start + 1, end - overlap);
  if (next < text.length && isLowSurrogateAt(text, next) && isHighSurrogateAt(text, next - 1)) {
    next -= 1;
  }
  return next;
}

function assertSegmentationLimits(maxChars: number, overlap: number, maxChunks: number): void {
  const validInts = Number.isInteger(maxChars) && Number.isInteger(overlap) && Number.isInteger(maxChunks);
  if (!validInts || maxChars < 100 || overlap < 0 || overlap >= maxChars || maxChunks < 1) {
    throw new Error('Invalid narrative segmentation limits.');
  }
}

export function segmentNarrativeSource(
  text: string,
  blocks: SourceBlock[],
  maxChars = IMPORT_CHUNK_CHARS,
  overlap = IMPORT_OVERLAP_CHARS,
  maxChunks = MAX_IMPORT_CHUNKS,
): { chunks: SourceChunk[]; complete: boolean; unprocessedStart?: number } {
  if (!text) return { chunks: [], complete: true };
  assertSegmentationLimits(maxChars, overlap, maxChunks);
  const validBlocks = blocks.filter(block => block.start >= 0 && block.end > block.start && block.end <= text.length)
    .sort((a, b) => a.end - b.end || a.start - b.start);
  const chunks: SourceChunk[] = [];
  let start = 0;
  while (start < text.length && chunks.length < maxChunks) {
    let end = safeEnd(text, start, start + maxChars);
    const structuralEnd = findLastBlockEndBefore(validBlocks, start, end);
    if (structuralEnd && end < text.length) end = structuralEnd;
    if (end <= start) end = Math.min(text.length, start + maxChars);
    chunks.push({ id: `chunk-${chunks.length + 1}`, index: chunks.length, start, end, text: text.slice(start, end) });
    if (end === text.length) return { chunks, complete: true };
    start = nextChunkStart(text, start, end, overlap);
  }
  return { chunks, complete: false, unprocessedStart: chunks[chunks.length - 1]?.end ?? 0 };
}

export function calculateProcessedCoverage(chunks: SourceChunk[]): Array<{ start: number; end: number }> {
  const spans = chunks.map(({ start, end }) => ({ start, end })).sort((a, b) => a.start - b.start);
  const merged: Array<{ start: number; end: number }> = [];
  for (const span of spans) {
    const last = merged[merged.length - 1];
    if (last && span.start <= last.end) last.end = Math.max(last.end, span.end);
    else merged.push({ ...span });
  }
  return merged;
}

/** Local-only preview of the existing extraction plan. It does not authorize provider calls. */
export function planNarrativeSourceAnalysis(
  text: string,
  blocks: SourceBlock[],
  remainingCalls: number,
  maxChars = IMPORT_CHUNK_CHARS,
  overlap = IMPORT_OVERLAP_CHARS,
) {
  if (!Number.isSafeInteger(remainingCalls) || remainingCalls < 0) throw new Error('Invalid extraction call budget.');
  const segmented = segmentNarrativeSource(text, blocks, maxChars, overlap, MAX_IMPORT_CHUNKS);
  const scheduledRequests = Math.min(remainingCalls, segmented.chunks.length);
  const coveredChars = calculateProcessedCoverage(segmented.chunks.slice(0, scheduledRequests))
    .reduce((total, span) => total + span.end - span.start, 0);
  const unplannedChars = text.length - coveredChars;
  return { ...segmented, scheduledRequests, unplannedChars, completeWithinCallBudget: unplannedChars === 0 && segmented.complete };
}

/**
 * Conservative local planning estimate for narrative-import. Provider token
 * preflight on the server remains authoritative; this estimate only chooses
 * safe, reviewable source boundaries before the user starts analysis.
 */
export function estimateNarrativeInputTokens(text: string): number {
  let estimate = 0;
  for (const character of text) estimate += character.codePointAt(0)! <= 0x7f ? 0.25 : 1;
  return Math.ceil(estimate);
}

const adaptiveGraphemeSegmenter = new Intl.Segmenter(undefined, { granularity: 'grapheme' });
const ADAPTIVE_LOOKAHEAD_CODE_UNITS = 256;

function estimateNarrativeInputTokensRaw(text: string): number {
  if (text.length === 1) return text.charCodeAt(0) <= 0x7f ? 0.25 : 1;
  let estimate = 0;
  for (let index = 0; index < text.length; index += 1) {
    if (text.charCodeAt(index) <= 0x7f) {
      estimate += 0.25;
      continue;
    }
    if (isSurrogatePairAt(text, index)) index += 1;
    estimate += 1;
  }
  return estimate;
}

interface AdaptiveBudgetWindow {
  end: number;
  estimate: number;
  isBoundary: (offset: number) => boolean;
}

function scanAdaptiveBudgetSlice(slice: string, start: number, budget: number, isFullTail: boolean): AdaptiveBudgetWindow | null {
  const segments = adaptiveGraphemeSegmenter.segment(slice);
  let estimate = 0;
  let end = start;
  for (const part of segments) {
    if (!isFullTail && part.index + part.segment.length === slice.length) {
      return null;
    }
    const cost = estimateNarrativeInputTokensRaw(part.segment);
    if (estimate + cost > budget) break;
    estimate += cost;
    end = start + part.index + part.segment.length;
  }
  return {
    end,
    estimate,
    isBoundary: (offset: number) => offset === end || segments.containing(offset - start)?.index === offset - start,
  };
}

function findAdaptiveBudgetEnd(text: string, start: number, budget: number): AdaptiveBudgetWindow {
  const sliceEnd = Math.min(text.length, start + Math.ceil(budget * 4) + ADAPTIVE_LOOKAHEAD_CODE_UNITS);
  const windowed = scanAdaptiveBudgetSlice(text.slice(start, sliceEnd), start, budget, sliceEnd === text.length);
  if (windowed) return windowed;
  return scanAdaptiveBudgetSlice(text.slice(start), start, budget, true)!;
}

function previousAdaptiveGraphemeBoundary(chunkText: string, start: number, end: number, target: number): number {
  if (!chunkText.length) return end;
  const segments = adaptiveGraphemeSegmenter.segment(chunkText);
  const localTarget = Math.min(target - start, chunkText.length - 1);
  const hit = segments.containing(localTarget);
  return hit && hit.index > 0 ? start + hit.index : end;
}

function findStructuralBlockEnd(
  validBlocks: readonly SourceBlock[],
  range: { start: number; end: number; minBoundary: number },
  isBoundary: (offset: number) => boolean,
): number | undefined {
  let low = 0;
  let high = validBlocks.length;
  while (low < high) {
    const middle = low + Math.floor((high - low) / 2);
    if (validBlocks[middle].end <= range.end) low = middle + 1;
    else high = middle;
  }
  for (let index = low - 1; index >= 0; index -= 1) {
    const structural = validBlocks[index].end;
    if (structural <= range.start) break;
    if (structural >= range.minBoundary && isBoundary(structural)) return structural;
  }
  return undefined;
}

function selectAdaptiveCutEnd(
  text: string,
  start: number,
  budget: AdaptiveBudgetWindow,
  validBlocks: readonly SourceBlock[],
): number {
  const end = budget.end;
  if (end >= text.length) return end;
  const minBoundary = start + Math.floor((end - start) * 0.55);
  const paragraph = text.lastIndexOf('\n\n', end - 2);
  const paragraphEnd = paragraph + 2;
  const fitsParagraph = paragraph >= minBoundary && paragraphEnd > start;
  if (fitsParagraph && budget.isBoundary(paragraphEnd)) {
    return paragraphEnd;
  }
  return findStructuralBlockEnd(validBlocks, { start, end, minBoundary }, budget.isBoundary) ?? end;
}

function validateAdaptiveOptions(
  remainingCalls: number,
  options: { maxInputTokens?: number; envelopeReserveTokens?: number; maxChunks?: number },
) {
  if (!Number.isSafeInteger(remainingCalls) || remainingCalls < 0) throw new Error('Invalid extraction call budget.');
  const maxInputTokens = options.maxInputTokens ?? NARRATIVE_IMPORT_INPUT_TOKEN_LIMIT;
  const envelopeReserveTokens = options.envelopeReserveTokens ?? NARRATIVE_IMPORT_ENVELOPE_RESERVE_TOKENS;
  const maxChunks = options.maxChunks ?? MAX_IMPORT_CHUNKS;
  const payloadTokenBudget = maxInputTokens - envelopeReserveTokens;
  const validTokens = Number.isSafeInteger(maxInputTokens) && Number.isSafeInteger(envelopeReserveTokens) && payloadTokenBudget >= 1;
  const validMaxChunks = Number.isSafeInteger(maxChunks) && maxChunks >= 1;
  if (!validTokens || !validMaxChunks) {
    throw new Error('Invalid adaptive narrative import limits.');
  }
  return { maxInputTokens, envelopeReserveTokens, payloadTokenBudget, maxChunks };
}

export function planAdaptiveNarrativeSourceAnalysis(
  text: string,
  blocks: SourceBlock[],
  remainingCalls: number,
  options: { maxInputTokens?: number; envelopeReserveTokens?: number; maxChunks?: number } = {},
) {
  const limits = validateAdaptiveOptions(remainingCalls, options);
  const validBlocks = blocks.filter(block => block.start >= 0 && block.end > block.start && block.end <= text.length)
    .sort((a, b) => a.end - b.end || a.start - b.start);
  const chunks: SourceChunk[] = [];
  let maxChunkTokens = 0;
  let start = 0;
  while (start < text.length && chunks.length < limits.maxChunks) {
    const budget = findAdaptiveBudgetEnd(text, start, limits.payloadTokenBudget);
    // A single grapheme can exceed a deliberately tiny budget. Do not split it
    // or emit an oversized request; the returned plan remains honestly partial.
    if (budget.end <= start) break;
    const end = selectAdaptiveCutEnd(text, start, budget, validBlocks);
    const chunkText = text.slice(start, end);
    const chunkTokens = end === budget.end ? Math.ceil(budget.estimate) : estimateNarrativeInputTokens(chunkText);
    maxChunkTokens = Math.max(maxChunkTokens, chunkTokens);
    chunks.push({ id: `chunk-${chunks.length + 1}`, index: chunks.length, start, end, text: chunkText });
    if (end === text.length) break;
    const overlap = Math.min(250, Math.max(1, Math.floor((end - start) * 0.1)));
    const next = previousAdaptiveGraphemeBoundary(chunkText, start, end, Math.max(start + 1, end - overlap));
    if (next <= start) throw new Error('Adaptive narrative segmentation failed to make forward progress.');
    start = next;
  }
  const complete = text.length === 0 || chunks.at(-1)?.end === text.length;
  const scheduledRequests = Math.min(remainingCalls, chunks.length);
  const coveredChars = calculateProcessedCoverage(chunks.slice(0, scheduledRequests))
    .reduce((total, span) => total + span.end - span.start, 0);
  const unplannedChars = text.length - coveredChars;
  return {
    chunks, complete, scheduledRequests, unplannedChars,
    completeWithinCallBudget: complete && unplannedChars === 0,
    operation: 'narrative-import' as const,
    limits,
    estimatedMaxInputTokens: chunks.length ? maxChunkTokens + limits.envelopeReserveTokens : 0,
    countAuthority: 'server-provider-preflight' as const,
  };
}
