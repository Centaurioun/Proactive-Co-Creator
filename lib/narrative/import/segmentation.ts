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

function safeEnd(text: string, start: number, target: number): number {
  let end = Math.min(target, text.length);
  if (end < text.length && end > start && text.charCodeAt(end - 1) >= 0xd800 && text.charCodeAt(end - 1) <= 0xdbff) end -= 1;
  if (end < text.length && end > start) {
    const boundary = text.lastIndexOf('\n\n', end);
    if (boundary > start + Math.floor((end - start) * 0.55)) end = boundary + 2;
  }
  return Math.max(start + 1, end);
}

export function segmentNarrativeSource(
  text: string,
  blocks: SourceBlock[],
  maxChars = IMPORT_CHUNK_CHARS,
  overlap = IMPORT_OVERLAP_CHARS,
  maxChunks = MAX_IMPORT_CHUNKS,
): { chunks: SourceChunk[]; complete: boolean; unprocessedStart?: number } {
  if (!text) return { chunks: [], complete: true };
  if (!Number.isInteger(maxChars) || maxChars < 100 || overlap < 0 || overlap >= maxChars || maxChunks < 1) {
    throw new Error('Invalid narrative segmentation limits.');
  }
  if (!Number.isInteger(overlap) || !Number.isInteger(maxChunks)) throw new Error('Invalid narrative segmentation limits.');
  const validBlocks = blocks.filter(block => block.start >= 0 && block.end > block.start && block.end <= text.length)
    .sort((a, b) => a.end - b.end || a.start - b.start);
  const chunks: SourceChunk[] = [];
  let start = 0;
  while (start < text.length && chunks.length < maxChunks) {
    let end = safeEnd(text, start, start + maxChars);
    let low = 0;
    let high = validBlocks.length;
    while (low < high) {
      const middle = low + Math.floor((high - low) / 2);
      if (validBlocks[middle].end <= end) low = middle + 1;
      else high = middle;
    }
    const boundary = validBlocks[low - 1]?.end;
    const structuralEnd = boundary !== undefined && boundary > start ? boundary : undefined;
    if (structuralEnd && end < text.length) end = structuralEnd;
    if (end <= start) end = Math.min(text.length, start + maxChars);
    chunks.push({ id: `chunk-${chunks.length + 1}`, index: chunks.length, start, end, text: text.slice(start, end) });
    if (end === text.length) return { chunks, complete: true };
    start = Math.max(start + 1, end - overlap);
    if (start < text.length && text.charCodeAt(start) >= 0xdc00 && text.charCodeAt(start) <= 0xdfff &&
      text.charCodeAt(start - 1) >= 0xd800 && text.charCodeAt(start - 1) <= 0xdbff) {
      start -= 1;
    }
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

export function planAdaptiveNarrativeSourceAnalysis(
  text: string,
  blocks: SourceBlock[],
  remainingCalls: number,
  options: { maxInputTokens?: number; envelopeReserveTokens?: number; maxChunks?: number } = {},
) {
  if (!Number.isSafeInteger(remainingCalls) || remainingCalls < 0) throw new Error('Invalid extraction call budget.');
  const maxInputTokens = options.maxInputTokens ?? NARRATIVE_IMPORT_INPUT_TOKEN_LIMIT;
  const envelopeReserveTokens = options.envelopeReserveTokens ?? NARRATIVE_IMPORT_ENVELOPE_RESERVE_TOKENS;
  const maxChunks = options.maxChunks ?? MAX_IMPORT_CHUNKS;
  const payloadTokenBudget = maxInputTokens - envelopeReserveTokens;
  if (!Number.isSafeInteger(maxInputTokens) || !Number.isSafeInteger(envelopeReserveTokens) ||
    payloadTokenBudget < 1 || !Number.isSafeInteger(maxChunks) || maxChunks < 1) {
    throw new Error('Invalid adaptive narrative import limits.');
  }
  const validBlocks = blocks.filter(block => block.start >= 0 && block.end > block.start && block.end <= text.length)
    .sort((a, b) => a.end - b.end || a.start - b.start);
  const chunks: SourceChunk[] = [];
  let start = 0;
  while (start < text.length && chunks.length < maxChunks) {
    let end = start;
    let estimate = 0;
    for (let cursor = start; cursor < text.length;) {
      const codePoint = text.codePointAt(cursor) ?? 0;
      const width = codePoint > 0xffff ? 2 : 1;
      const cost = codePoint <= 0x7f ? 0.25 : 1;
      if (end > start && estimate + cost > payloadTokenBudget) break;
      estimate += cost;
      end += width;
      cursor += width;
      if (estimate >= payloadTokenBudget) break;
    }
    if (end <= start) end = Math.min(text.length, start + 1);
    if (end < text.length) {
      const minBoundary = start + Math.floor((end - start) * 0.55);
      const paragraph = text.lastIndexOf('\n\n', end);
      if (paragraph >= minBoundary) end = paragraph + 2;
      else {
        let low = 0;
        let high = validBlocks.length;
        while (low < high) {
          const middle = low + Math.floor((high - low) / 2);
          if (validBlocks[middle].end <= end) low = middle + 1;
          else high = middle;
        }
        const structural = validBlocks[low - 1]?.end;
        if (structural !== undefined) end = structural;
      }
    }
    const chunkText = text.slice(start, end);
    chunks.push({ id: `chunk-${chunks.length + 1}`, index: chunks.length, start, end, text: chunkText });
    if (end === text.length) break;
    const overlap = Math.min(250, Math.max(1, Math.floor((end - start) * 0.1)));
    let next = Math.max(start + 1, end - overlap);
    if (next < text.length && next > 0 && text.charCodeAt(next) >= 0xdc00 && text.charCodeAt(next) <= 0xdfff &&
      text.charCodeAt(next - 1) >= 0xd800 && text.charCodeAt(next - 1) <= 0xdbff) next -= 1;
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
    limits: { maxInputTokens, envelopeReserveTokens, payloadTokenBudget, maxChunks },
    estimatedMaxInputTokens: chunks.length ? Math.max(...chunks.map(chunk => estimateNarrativeInputTokens(chunk.text) + envelopeReserveTokens)) : 0,
    countAuthority: 'server-provider-preflight' as const,
  };
}
