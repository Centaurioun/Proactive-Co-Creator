import type { NarrativeExtraction } from '../../../shared/importSchemas.ts';
import type { SourceChunk } from './segmentation.ts';

export interface VerifiedEvidence {
  sourceId: string;
  version: string;
  digest: string;
  start: number;
  end: number;
  excerpt: string;
}

type WithVerifiedEvidence<T extends { evidence: unknown }> = Omit<T, 'evidence'> & { evidence: VerifiedEvidence };

export type VerifiedExtraction = {
  findings: Array<WithVerifiedEvidence<NarrativeExtraction['findings'][number]>>;
  entities: Array<Omit<NarrativeExtraction['entities'][number], 'attributes' | 'evidence'> & {
    evidence: VerifiedEvidence;
    attributes: Array<WithVerifiedEvidence<NarrativeExtraction['entities'][number]['attributes'][number]>>;
  }>;
  relationships: Array<WithVerifiedEvidence<NarrativeExtraction['relationships'][number]>>;
  ambiguities: Array<WithVerifiedEvidence<NarrativeExtraction['ambiguities'][number]>>;
  rejectedEvidenceCount: number;
};

function isTextBoundary(text: string, offset: number): boolean {
  if (offset < 0 || offset > text.length) return false;
  if (offset === 0 || offset === text.length) return true;
  const previous = text.charCodeAt(offset - 1);
  const next = text.charCodeAt(offset);
  return !(previous >= 0xd800 && previous <= 0xdbff && next >= 0xdc00 && next <= 0xdfff);
}

/**
 * Deterministically locates all verbatim UTF-16 spans of `quote` inside `text`
 * that start and end on valid Unicode surrogate boundaries.
 */
export function findExactQuoteMatches(
  text: string,
  quote: string,
  maxMatches = 8,
): Array<{ start: number; end: number }> {
  if (!quote || quote.length > text.length) return [];
  const matches: Array<{ start: number; end: number }> = [];
  let cursor = 0;
  while (cursor <= text.length - quote.length && matches.length < maxMatches) {
    const idx = text.indexOf(quote, cursor);
    if (idx === -1) break;
    const end = idx + quote.length;
    if (isTextBoundary(text, idx) && isTextBoundary(text, end)) {
      matches.push({ start: idx, end });
    }
    cursor = idx + 1;
  }
  return matches;
}

function proposalFingerprint(item: object, scopeKey?: string): string {
  const proposal = item as {
    category?: string; kind?: string; title?: string; name?: string; value?: string; description?: string;
    aliases?: string[]; attributes?: Array<{ name: string; value: string; kind: string }>;
    source?: string; target?: string; label?: string; detail?: string; severity?: string; certainty?: string;
  };
  const signature = JSON.stringify({
    scopeKey,
    category: proposal.category,
    kind: proposal.kind,
    title: proposal.title?.normalize('NFKC').trim(),
    name: proposal.name?.normalize('NFKC').trim(),
    value: proposal.value?.normalize('NFKC').trim(),
    description: proposal.description?.normalize('NFKC').trim(),
    aliases: proposal.aliases?.map(alias => alias.normalize('NFKC').trim().toLocaleLowerCase('en')).sort(),
    attributes: proposal.attributes?.map(attribute => [
      attribute.name.normalize('NFKC').trim().toLocaleLowerCase('en'),
      attribute.value.normalize('NFKC').trim(), attribute.kind,
    ]).sort((left, right) => {
      const leftKey = JSON.stringify(left);
      const rightKey = JSON.stringify(right);
      return leftKey < rightKey ? -1 : leftKey > rightKey ? 1 : 0;
    }),
    // Keep relation direction in the generated application ID.
    source: proposal.source?.normalize('NFKC').trim().toLocaleLowerCase('en'),
    target: proposal.target?.normalize('NFKC').trim().toLocaleLowerCase('en'),
    label: proposal.label?.normalize('NFKC').trim().toLocaleLowerCase('en'),
    detail: proposal.detail?.normalize('NFKC').trim(),
    severity: proposal.severity,
    certainty: proposal.certainty,
  });
  let hash = 14695981039346656037n;
  for (let index = 0; index < signature.length; index += 1) {
    hash = BigInt.asUintN(64, (hash ^ BigInt(signature.charCodeAt(index))) * 1099511628211n);
  }
  return hash.toString(36);
}

function resolveDeterministicSpan(
  chunkText: string,
  evidence: { start?: number; end?: number; quote: string },
):
  | { status: 'exact'; start: number; end: number }
  | { status: 'ambiguous'; matches: Array<{ start: number; end: number }> }
  | { status: 'missing' } {
  const { start, end, quote } = evidence;
  if (
    typeof start === 'number' &&
    typeof end === 'number' &&
    Number.isInteger(start) &&
    Number.isInteger(end) &&
    start >= 0 &&
    end > start &&
    end <= chunkText.length &&
    isTextBoundary(chunkText, start) &&
    isTextBoundary(chunkText, end) &&
    chunkText.slice(start, end) === quote
  ) {
    return { status: 'exact', start, end };
  }
  const matches = findExactQuoteMatches(chunkText, quote);
  if (matches.length === 1) {
    return { status: 'exact', start: matches[0].start, end: matches[0].end };
  }
  if (matches.length > 1) {
    return { status: 'ambiguous', matches };
  }
  return { status: 'missing' };
}

export function verifyExtractionEvidence(
  extraction: NarrativeExtraction,
  chunk: SourceChunk,
  source: { id: string; version: string; digest: string },
): VerifiedExtraction {
  if (!Number.isInteger(chunk.start) || chunk.start < 0 || !Number.isInteger(chunk.end) ||
    chunk.end !== chunk.start + chunk.text.length) {
    throw new Error('Narrative extraction chunk has invalid source offsets.');
  }
  let rejectedEvidenceCount = 0;
  const duplicateOrdinals = new Map<string, number>();
  const generatedAnchorAmbiguities: VerifiedExtraction['ambiguities'] = [];

  const nextUniqueId = (baseId: string): string => {
    const ordinal = duplicateOrdinals.get(baseId) ?? 0;
    duplicateOrdinals.set(baseId, ordinal + 1);
    return ordinal === 0 ? baseId : `${baseId}-${ordinal + 1}`;
  };

  const verified = <T extends { evidence: { start?: number; end?: number; quote: string } }>(
    item: T,
    prefix: string,
    label: string,
    scopeKey?: string,
  ) => {
    const resolved = resolveDeterministicSpan(chunk.text, item.evidence);
    if (resolved.status === 'missing') {
      rejectedEvidenceCount += 1;
      return null;
    }
    if (resolved.status === 'ambiguous') {
      rejectedEvidenceCount += 1;
      const first = resolved.matches[0];
      const absStart = chunk.start + first.start;
      const absEnd = chunk.start + first.end;
      const candidateRanges = resolved.matches
        .map((m) => `${chunk.start + m.start}–${chunk.start + m.end}`)
        .join(', ');
      const ambiguityRecord = {
        title: `Ambiguous repeated evidence quote for ${label}`,
        detail: `The verbatim quote appears ${resolved.matches.length} times in this segment (UTF-16 offsets ${candidateRanges}) without an exact unique anchor. Confirm which occurrence applies before accepting.`,
        severity: 'medium' as const,
        certainty: 'uncertain' as const,
        rationale: 'Multiple identical verbatim quote occurrences detected; host refused to guess.',
      };
      const baseId = `ambiguity-${absStart}-${absEnd}-${proposalFingerprint(ambiguityRecord, `${prefix}:${label}`)}`;
      generatedAnchorAmbiguities.push({
        ...ambiguityRecord,
        id: nextUniqueId(baseId),
        evidence: {
          sourceId: source.id,
          version: source.version,
          digest: source.digest,
          start: absStart,
          end: absEnd,
          excerpt: item.evidence.quote,
        },
      });
      return null;
    }
    const absoluteStart = chunk.start + resolved.start;
    const absoluteEnd = chunk.start + resolved.end;
    const baseId = `${prefix}-${absoluteStart}-${absoluteEnd}-${proposalFingerprint(item, scopeKey)}`;
    return {
      ...item,
      id: nextUniqueId(baseId),
      evidence: {
        sourceId: source.id,
        version: source.version,
        digest: source.digest,
        start: absoluteStart,
        end: absoluteEnd,
        excerpt: item.evidence.quote,
      },
    };
  };

  const findings = extraction.findings.flatMap(item => {
    const result = verified(item, 'finding', item.title);
    return result ? [result] : [];
  });
  const entities = extraction.entities.flatMap(item => {
    const result = verified(item, 'entity', item.name);
    if (!result) return [];
    const attributes = item.attributes.flatMap(attribute => {
      const checked = verified(attribute, 'attribute', `${item.name}.${attribute.name}`, result.id);
      return checked ? [checked] : [];
    });
    return [{ ...result, attributes }];
  });
  const relationships = extraction.relationships.flatMap(item => {
    const result = verified(item, 'relationship', `${item.source} ${item.label} ${item.target}`);
    return result ? [result] : [];
  });
  const ambiguities = [
    ...extraction.ambiguities.flatMap(item => {
      const result = verified(item, 'ambiguity', item.title);
      return result ? [result] : [];
    }),
    ...generatedAnchorAmbiguities,
  ];
  return { findings, entities, relationships, ambiguities, rejectedEvidenceCount };
}

export function deduplicateChunkProposals(chunks: readonly VerifiedExtraction[]): VerifiedExtraction {
  const unique = <T extends { id: string; evidence: VerifiedEvidence }>(items: T[]) => {
    const seen = new Set<string>();
    return items.filter(item => {
      if (seen.has(item.id)) return false;
      seen.add(item.id);
      return true;
    });
  };
  return {
    findings: unique(chunks.flatMap(chunk => chunk.findings)),
    entities: unique(chunks.flatMap(chunk => chunk.entities)).map(entity => ({
      ...entity,
      attributes: unique(chunks.flatMap(chunk => chunk.entities.find(candidate => candidate.id === entity.id)?.attributes ?? [])),
    })),
    relationships: unique(chunks.flatMap(chunk => chunk.relationships)),
    ambiguities: unique(chunks.flatMap(chunk => chunk.ambiguities)),
    rejectedEvidenceCount: chunks.reduce((count, chunk) => count + chunk.rejectedEvidenceCount, 0),
  };
}
