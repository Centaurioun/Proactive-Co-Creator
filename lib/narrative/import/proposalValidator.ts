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
  const previous = text.charCodeAt(offset - 1);
  const next = text.charCodeAt(offset);
  return !(previous >= 0xd800 && previous <= 0xdbff && next >= 0xdc00 && next <= 0xdfff);
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
  const verified = <T extends { evidence: { start: number; end: number; quote: string } }>(item: T, prefix: string, scopeKey?: string) => {
    const { start, end, quote } = item.evidence;
    if (!Number.isInteger(start) || !Number.isInteger(end) || start < 0 || end <= start || end > chunk.text.length ||
      !isTextBoundary(chunk.text, start) || !isTextBoundary(chunk.text, end) || chunk.text.slice(start, end) !== quote) {
      rejectedEvidenceCount += 1;
      return null;
    }
    const absoluteStart = chunk.start + start;
    const absoluteEnd = chunk.start + end;
    const baseId = `${prefix}-${absoluteStart}-${absoluteEnd}-${proposalFingerprint(item, scopeKey)}`;
    const ordinal = duplicateOrdinals.get(baseId) ?? 0;
    duplicateOrdinals.set(baseId, ordinal + 1);
    return { ...item, id: ordinal === 0 ? baseId : `${baseId}-${ordinal + 1}`, evidence: { sourceId: source.id, version: source.version, digest: source.digest, start: absoluteStart, end: absoluteEnd, excerpt: quote } };
  };
  const findings = extraction.findings.flatMap(item => { const result = verified(item, 'finding'); return result ? [result] : []; });
  const entities = extraction.entities.flatMap(item => {
    const result = verified(item, 'entity');
    if (!result) return [];
    const attributes = item.attributes.flatMap(attribute => { const checked = verified(attribute, 'attribute', result.id); return checked ? [checked] : []; });
    return [{ ...result, attributes }];
  });
  const relationships = extraction.relationships.flatMap(item => { const result = verified(item, 'relationship'); return result ? [result] : []; });
  const ambiguities = extraction.ambiguities.flatMap(item => { const result = verified(item, 'ambiguity'); return result ? [result] : []; });
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
