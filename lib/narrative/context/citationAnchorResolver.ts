import { CreativeProject } from '../../../shared/types';
import { manuscriptSections } from '../manuscriptModel';
import { computeDeterministicDigest, isValidUtf16Boundary } from '../memory/textNormalization';

export type CitationResolutionStatus =
  | 'verified-exact'
  | 'reanchored-unique'
  | 'stale-ambiguous'
  | 'stale-modified'
  | 'missing-target';

export interface CitationAnchorInput {
  id: string;
  label: string;
  sourceKind: 'manuscript' | 'immutable-source';
  /** Section ID for manuscript or Source ID for immutable-source */
  targetId: string;
  /** Revision at which the anchor was originally recorded */
  anchoredRevision?: number;
  startOffset: number;
  endOffset: number;
  archivedQuote: string;
  expectedDigest?: string;
}

export interface CitationCandidateSpan {
  startOffset: number;
  endOffset: number;
  excerpt: string;
  contextBefore: string;
  contextAfter: string;
}

export interface CitationDiffCardModel {
  anchorId: string;
  label: string;
  sourceKind: 'manuscript' | 'immutable-source';
  targetId: string;
  targetTitle: string;
  currentRevision: number;
  anchoredRevision?: number;
  status: CitationResolutionStatus;
  requiresAuthorReview: boolean;
  archivedSpan: {
    startOffset: number;
    endOffset: number;
    quote: string;
  };
  currentSliceAtOriginalOffsets?: string;
  resolvedSpan?: CitationCandidateSpan;
  ambiguousCandidates: CitationCandidateSpan[];
  explanation: string;
}

function buildCandidateSpan(fullText: string, start: number, end: number): CitationCandidateSpan {
  const ctxStart = Math.max(0, start - 40);
  const ctxEnd = Math.min(fullText.length, end + 40);
  return {
    startOffset: start,
    endOffset: end,
    excerpt: fullText.slice(start, end),
    contextBefore: fullText.slice(ctxStart, start),
    contextAfter: fullText.slice(end, ctxEnd),
  };
}

/**
 * Deterministically resolves a source or manuscript citation anchor against the current project
 * and builds the `CitationDiffCardModel` (`UIC-02` foundation):
 * - Verifies exact UTF-16 boundary & text match at original offsets (`verified-exact`)
 * - If offsets shifted due to edits above the quote, automatically re-anchors ONLY when the exact
 *   archived quote occurs at a single unique UTF-16 boundary in the section (`reanchored-unique`)
 * - If the archived quote occurs multiple times (`stale-ambiguous`) or was edited (`stale-modified`),
 *   flags `requiresAuthorReview: true` with exact before/after comparison instead of silently guessing.
 */
export function resolveCitationDiffCard(
  project: CreativeProject,
  anchor: CitationAnchorInput
): CitationDiffCardModel {
  const currentRevision = project.revision ?? 1;
  let fullText: string | undefined;
  let targetTitle = anchor.targetId;

  if (anchor.sourceKind === 'manuscript') {
    const sections = manuscriptSections(project);
    const sec = sections.find((s) => s.id === anchor.targetId);
    if (sec) {
      fullText = sec.text;
      targetTitle = sec.title || sec.id;
    }
  } else {
    const src = (project.narrative?.sources ?? []).find((s) => s.id === anchor.targetId);
    if (src) {
      fullText = src.text;
      targetTitle = src.filename || src.id;
    }
  }

  if (fullText === undefined) {
    return {
      anchorId: anchor.id,
      label: anchor.label,
      sourceKind: anchor.sourceKind,
      targetId: anchor.targetId,
      targetTitle,
      currentRevision,
      anchoredRevision: anchor.anchoredRevision,
      status: 'missing-target',
      requiresAuthorReview: true,
      archivedSpan: {
        startOffset: anchor.startOffset,
        endOffset: anchor.endOffset,
        quote: anchor.archivedQuote,
      },
      ambiguousCandidates: [],
      explanation: `Target ${anchor.sourceKind} "${anchor.targetId}" no longer exists in revision r${currentRevision}.`,
    };
  }

  const validOriginalBounds =
    anchor.startOffset >= 0 &&
    anchor.endOffset >= anchor.startOffset &&
    anchor.endOffset <= fullText.length &&
    isValidUtf16Boundary(fullText, anchor.startOffset) &&
    isValidUtf16Boundary(fullText, anchor.endOffset);

  const currentSliceAtOriginalOffsets = validOriginalBounds
    ? fullText.slice(anchor.startOffset, anchor.endOffset)
    : undefined;

  if (
    validOriginalBounds &&
    currentSliceAtOriginalOffsets === anchor.archivedQuote &&
    (!anchor.expectedDigest ||
      computeDeterministicDigest(currentSliceAtOriginalOffsets) === anchor.expectedDigest)
  ) {
    return {
      anchorId: anchor.id,
      label: anchor.label,
      sourceKind: anchor.sourceKind,
      targetId: anchor.targetId,
      targetTitle,
      currentRevision,
      anchoredRevision: anchor.anchoredRevision,
      status: 'verified-exact',
      requiresAuthorReview: false,
      archivedSpan: {
        startOffset: anchor.startOffset,
        endOffset: anchor.endOffset,
        quote: anchor.archivedQuote,
      },
      currentSliceAtOriginalOffsets,
      resolvedSpan: buildCandidateSpan(fullText, anchor.startOffset, anchor.endOffset),
      ambiguousCandidates: [],
      explanation: `Exact UTF-16 span [${anchor.startOffset}..${anchor.endOffset}] verified in "${targetTitle}".`,
    };
  }

  // Search for all exact UTF-16 occurrences of `archivedQuote` in `fullText`
  const occurrences: CitationCandidateSpan[] = [];
  if (anchor.archivedQuote.length > 0) {
    let idx = fullText.indexOf(anchor.archivedQuote);
    while (idx !== -1) {
      const endIdx = idx + anchor.archivedQuote.length;
      if (isValidUtf16Boundary(fullText, idx) && isValidUtf16Boundary(fullText, endIdx)) {
        occurrences.push(buildCandidateSpan(fullText, idx, endIdx));
      }
      idx = fullText.indexOf(anchor.archivedQuote, idx + 1);
    }
  }

  if (occurrences.length === 1) {
    const uniqueMatch = occurrences[0];
    return {
      anchorId: anchor.id,
      label: anchor.label,
      sourceKind: anchor.sourceKind,
      targetId: anchor.targetId,
      targetTitle,
      currentRevision,
      anchoredRevision: anchor.anchoredRevision,
      status: 'reanchored-unique',
      requiresAuthorReview: false,
      archivedSpan: {
        startOffset: anchor.startOffset,
        endOffset: anchor.endOffset,
        quote: anchor.archivedQuote,
      },
      currentSliceAtOriginalOffsets,
      resolvedSpan: uniqueMatch,
      ambiguousCandidates: [uniqueMatch],
      explanation: `Quote shifted from [${anchor.startOffset}..${anchor.endOffset}] to unique UTF-16 span [${uniqueMatch.startOffset}..${uniqueMatch.endOffset}].`,
    };
  }

  if (occurrences.length > 1) {
    return {
      anchorId: anchor.id,
      label: anchor.label,
      sourceKind: anchor.sourceKind,
      targetId: anchor.targetId,
      targetTitle,
      currentRevision,
      anchoredRevision: anchor.anchoredRevision,
      status: 'stale-ambiguous',
      requiresAuthorReview: true,
      archivedSpan: {
        startOffset: anchor.startOffset,
        endOffset: anchor.endOffset,
        quote: anchor.archivedQuote,
      },
      currentSliceAtOriginalOffsets,
      ambiguousCandidates: occurrences,
      explanation: `Archived quote moved from [${anchor.startOffset}..${anchor.endOffset}] and matches ${occurrences.length} candidate spans in "${targetTitle}". Author review required to disambiguate.`,
    };
  }

  return {
    anchorId: anchor.id,
    label: anchor.label,
    sourceKind: anchor.sourceKind,
    targetId: anchor.targetId,
    targetTitle,
    currentRevision,
    anchoredRevision: anchor.anchoredRevision,
    status: 'stale-modified',
    requiresAuthorReview: true,
    archivedSpan: {
      startOffset: anchor.startOffset,
      endOffset: anchor.endOffset,
      quote: anchor.archivedQuote,
    },
    currentSliceAtOriginalOffsets,
    ambiguousCandidates: [],
    explanation: `The cited passage in "${targetTitle}" was modified since revision r${anchor.anchoredRevision ?? '?'}. Review the archived quote against the current section text.`,
  };
}
