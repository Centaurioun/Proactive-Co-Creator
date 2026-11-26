import type { SourceBlock } from './sourceParser.ts';

export const IMPORT_CHUNK_CHARS = 28_000;
export const IMPORT_OVERLAP_CHARS = 600;
export const MAX_IMPORT_CHUNKS = 20;

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
