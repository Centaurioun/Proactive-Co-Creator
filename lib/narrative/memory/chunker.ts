import {
  NARRATIVE_CHUNKER_VERSION,
  NarrativeChunkRecord,
  NarrativeChunkSectionKind,
  NarrativeChunkSourceKind,
} from '../../../shared/narrativeMemoryTypes';
import {
  computeDeterministicDigest,
  estimateTokenCount,
  isValidUtf16Boundary,
  snapToValidUtf16Boundary,
} from './textNormalization';

export interface ChunkerOptions {
  maxChunkChars?: number;
  overlapChars?: number;
}

export interface ChunkableSectionInput {
  projectId: string;
  sourceKind: NarrativeChunkSourceKind;
  sourceId: string;
  versionId: string;
  projectRevision: number;
  sectionId: string;
  chapterId?: string;
  sectionTitle: string;
  kind: NarrativeChunkSectionKind;
  presentationOrder: number;
  chronologyOrder?: string;
  text: string;
  /** Optional base offset when section is already a slice of a larger immutable source */
  baseStartOffset?: number;
}

interface ParagraphSpan {
  paragraphIndex: number;
  startOffset: number;
  endOffset: number;
  text: string;
}

/**
 * Splits a section's text into paragraph/scene spans while preserving exact UTF-16 offsets.
 */
export function extractParagraphSpans(text: string, baseOffset = 0): ParagraphSpan[] {
  if (!text || text.length === 0) {
    return [];
  }
  const spans: ParagraphSpan[] = [];
  const separatorRegex = /\r?\n\s*\r?\n+/g;
  let cursor = 0;
  let paragraphIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = separatorRegex.exec(text)) !== null) {
    const rawStart = cursor;
    const rawEnd = match.index;
    const slice = text.slice(rawStart, rawEnd);
    const leadingTrim = slice.length - slice.trimStart().length;
    const trailingTrim = slice.length - slice.trimEnd().length;
    const start = rawStart + leadingTrim;
    const end = rawEnd - trailingTrim;
    if (end > start) {
      spans.push({
        paragraphIndex,
        startOffset: baseOffset + start,
        endOffset: baseOffset + end,
        text: text.slice(start, end),
      });
      paragraphIndex += 1;
    }
    cursor = match.index + match[0].length;
  }

  if (cursor < text.length) {
    const slice = text.slice(cursor);
    const leadingTrim = slice.length - slice.trimStart().length;
    const trailingTrim = slice.length - slice.trimEnd().length;
    const start = cursor + leadingTrim;
    const end = text.length - trailingTrim;
    if (end > start) {
      spans.push({
        paragraphIndex,
        startOffset: baseOffset + start,
        endOffset: baseOffset + end,
        text: text.slice(start, end),
      });
    }
  }

  return spans;
}

/**
 * Splits an oversized paragraph into bounded overlapping windows on word/sentence
 * and valid UTF-16 code-point boundaries.
 */
function splitOversizedSpan(
  span: ParagraphSpan,
  maxChunkChars: number,
  overlapChars: number
): ParagraphSpan[] {
  const { text, startOffset, paragraphIndex } = span;
  if (text.length <= maxChunkChars) {
    return [span];
  }

  const subSpans: ParagraphSpan[] = [];
  const effectiveOverlap = Math.max(0, Math.min(overlapChars, Math.floor(maxChunkChars / 3)));
  let localStart = 0;

  while (localStart < text.length) {
    let localEnd = Math.min(text.length, localStart + maxChunkChars);
    localEnd = snapToValidUtf16Boundary(text, localEnd, 'backward');

    if (localEnd < text.length) {
      // Prefer breaking on sentence punctuation or whitespace in the last 25% of the window
      const searchFloor = localStart + Math.floor((localEnd - localStart) * 0.7);
      let breakPoint = -1;
      for (let i = localEnd; i > searchFloor; i -= 1) {
        if (!isValidUtf16Boundary(text, i)) continue;
        const prevChar = text[i - 1];
        const currChar = text[i];
        if ((prevChar === '.' || prevChar === '!' || prevChar === '?' || prevChar === '…') && /\s/.test(currChar)) {
          breakPoint = i;
          break;
        }
      }
      if (breakPoint === -1) {
        for (let i = localEnd; i > searchFloor; i -= 1) {
          if (!isValidUtf16Boundary(text, i)) continue;
          if (/\s/.test(text[i - 1])) {
            breakPoint = i;
            break;
          }
        }
      }
      if (breakPoint > localStart) {
        localEnd = breakPoint;
      }
    }

    // Trim leading/trailing whitespace on sub-window while preserving exact offsets
    let trimmedStart = localStart;
    while (trimmedStart < localEnd && /\s/.test(text[trimmedStart])) {
      trimmedStart = snapToValidUtf16Boundary(text, trimmedStart + 1, 'forward');
    }
    let trimmedEnd = localEnd;
    while (trimmedEnd > trimmedStart && /\s/.test(text[trimmedEnd - 1])) {
      trimmedEnd = snapToValidUtf16Boundary(text, trimmedEnd - 1, 'backward');
    }

    if (trimmedEnd > trimmedStart) {
      subSpans.push({
        paragraphIndex,
        startOffset: startOffset + trimmedStart,
        endOffset: startOffset + trimmedEnd,
        text: text.slice(trimmedStart, trimmedEnd),
      });
    }

    if (localEnd >= text.length) {
      break;
    }

    let nextStart = Math.max(localStart + 1, localEnd - effectiveOverlap);
    nextStart = snapToValidUtf16Boundary(text, nextStart, 'forward');
    // Snap forward to next word boundary so overlap window doesn't split a word mid-token
    const wordFloorLimit = Math.min(localEnd, nextStart + 40);
    while (nextStart < wordFloorLimit && !/\s/.test(text[nextStart - 1])) {
      nextStart = snapToValidUtf16Boundary(text, nextStart + 1, 'forward');
    }
    if (nextStart >= localEnd) {
      nextStart = localEnd;
    }
    localStart = nextStart;
  }

  return subSpans;
}

/**
 * Deterministically chunks a manuscript section or immutable source block into
 * paragraph/scene chunks with exact UTF-16 spans and content digests.
 */
export function chunkNarrativeSection(
  input: ChunkableSectionInput,
  startingOrdinal = 0,
  options: ChunkerOptions = {}
): NarrativeChunkRecord[] {
  const maxChunkChars = Math.max(200, options.maxChunkChars ?? 1400);
  const overlapChars = Math.max(0, options.overlapChars ?? 160);
  const baseStartOffset = input.baseStartOffset ?? 0;

  const rawSpans = extractParagraphSpans(input.text, baseStartOffset);
  if (rawSpans.length === 0) {
    return [];
  }

  // Merge consecutive short paragraphs within the same section up to maxChunkChars / 2
  // only when they are adjacent, OR keep paragraph granularity when each paragraph is substantial.
  const fineSpans: ParagraphSpan[] = [];
  for (const span of rawSpans) {
    if (span.text.length > maxChunkChars) {
      fineSpans.push(...splitOversizedSpan(span, maxChunkChars, overlapChars));
    } else {
      fineSpans.push(span);
    }
  }

  const chunks: NarrativeChunkRecord[] = [];
  let ordinal = startingOrdinal;

  for (const span of fineSpans) {
    const digest = computeDeterministicDigest(
      `${NARRATIVE_CHUNKER_VERSION}|${input.sourceKind}|${input.sectionId}|${span.startOffset}:${span.endOffset}|${span.text}`
    );
    const chunkId = `chunk_${input.sourceKind}_${input.sectionId}_${span.startOffset}_${span.endOffset}_${digest.slice(0, 8)}`;

    chunks.push({
      id: chunkId,
      projectId: input.projectId,
      sourceKind: input.sourceKind,
      sourceId: input.sourceId,
      versionId: input.versionId,
      projectRevision: input.projectRevision,
      sectionId: input.sectionId,
      chapterId: input.chapterId,
      sectionTitle: input.sectionTitle,
      kind: input.kind,
      ordinal,
      presentationOrder: input.presentationOrder,
      chronologyOrder: input.chronologyOrder,
      paragraphIndex: span.paragraphIndex,
      startOffset: span.startOffset,
      endOffset: span.endOffset,
      text: span.text,
      digest,
      tokenCountEstimate: estimateTokenCount(span.text),
      entityIds: [],
    });
    ordinal += 1;
  }

  return chunks;
}
