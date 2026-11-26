import { createEmptyStoryBible } from '../../canonicalModel.ts';
import type { CreativeProject, Entity, ProjectSnapshot, Relationship, StoryBibleFields } from '../../../shared/types.ts';
import type { VerifiedEvidence, VerifiedExtraction } from './proposalValidator.ts';
import type { ParsedNarrativeSource } from './sourceParser.ts';

export interface ImportReviewSelection {
  sourceId: string;
  acceptedIds: ReadonlySet<string>;
  rejectedIds: ReadonlySet<string>;
  projectName: string;
  coverage?: {
    complete: boolean;
    scope: 'complete' | 'selective';
    categories: string[];
    totalCharacters: number;
    processedSpans: Array<{ start: number; end: number }>;
    failedSegments: number;
    calls: number;
    instruction?: string;
  };
}

type StoryBibleKey = keyof StoryBibleFields;
type ImportedProposal = NonNullable<NonNullable<CreativeProject['narrative']>['proposals']>[number];
const fieldAliases: Record<string, StoryBibleKey> = {
  genre: 'genre', tone: 'tone', narrativeperspective: 'narrativePerspective', perspective: 'narrativePerspective',
  intendedaudience: 'intendedAudience', audience: 'intendedAudience', setting: 'setting', themes: 'themes',
  centralconflict: 'centralConflict', conflict: 'centralConflict', pacing: 'pacing', continuityrules: 'continuityRules',
  continuity: 'continuityRules', explicitexclusions: 'explicitExclusions', visualstyle: 'visualStyle',
  cameraandlighting: 'cameraAndLighting', lighting: 'cameraAndLighting',
};

function normalizedName(value: string): string { return value.normalize('NFKC').trim().toLocaleLowerCase('tr').replace(/\s+/g, ' '); }
function evidenceAnchor(evidence: VerifiedEvidence) {
  return { sourceId: evidence.sourceId, version: evidence.version, digest: evidence.digest, start: evidence.start, end: evidence.end, excerpt: evidence.excerpt };
}
function approvalFor(id: string, selection: ImportReviewSelection): 'confirmed' | 'pending' | 'rejected' {
  if (selection.acceptedIds.has(id)) return 'confirmed';
  return selection.rejectedIds.has(id) ? 'rejected' : 'pending';
}
export function assembleImportedProject(
  source: ParsedNarrativeSource,
  extraction: VerifiedExtraction,
  identityMatches: Array<{ leftId: string; rightId: string; matchedName: string; reason: 'same-name' | 'alias-overlap' }>,
  selection: ImportReviewSelection,
  now = Date.now(),
): CreativeProject {
  if (!selection.projectName.trim()) throw new Error('Enter a project name before creating the imported project.');
  const projectId = crypto.randomUUID();
  const sourceId = selection.sourceId;
  const sourceVersion = 'v1';
  const sourceRecord = {
    id: sourceId, version: sourceVersion, digest: source.digest, text: source.text,
    filename: source.filename, mediaType: source.mediaType, byteLength: source.byteLength,
    parserVersion: '1', createdAt: now, retention: source.retention,
    ...(source.originalBytesBase64 ? { originalBytesBase64: source.originalBytesBase64 } : {}),
    blocks: source.blocks,
    ...(selection.coverage ? { analysisCoverage: selection.coverage } : {}),
  };

  const entities: Entity[] = [];
  const entityIds = new Map<string, string>();
  const claims: NonNullable<CreativeProject['narrative']>['claims'] = [];
  const issues: NonNullable<CreativeProject['narrative']>['issues'] = [];
  const proposals: ImportedProposal[] = [];
  for (const proposal of extraction.entities) {
    const approval = approvalFor(proposal.id, selection);
    const canonicalId = crypto.randomUUID();
    proposals.push({ id: proposal.id, kind: 'entity', label: proposal.name, detail: proposal.description,
      category: proposal.category, approval, rationale: proposal.rationale, evidence: evidenceAnchor(proposal.evidence), epistemicKind: proposal.kind });
    if (approval === 'confirmed') {
      entityIds.set(proposal.id, canonicalId);
      const attributes = proposal.attributes.map(attribute => {
        const status = selection.rejectedIds.has(attribute.id) ? 'rejected' : approvalFor(attribute.id, selection);
        proposals.push({ id: attribute.id, kind: 'attribute', label: attribute.name, detail: attribute.value,
          category: proposal.category, approval: status, rationale: attribute.rationale, evidence: evidenceAnchor(attribute.evidence), epistemicKind: attribute.kind });
        const attributeId = attribute.id;
        claims.push({ id: crypto.randomUUID(), targetId: attributeId, rationale: attribute.rationale, approval: status, freshness: 'current', anchors: [evidenceAnchor(attribute.evidence)], epistemicKind: attribute.kind });
        return {
          id: attributeId, name: attribute.name, presence_in_prompt: true, value: [{ name: attribute.value }],
          confirmedValue: status === 'confirmed' ? attribute.value : undefined, status, provenance: status === 'confirmed' ? 'accepted-suggestion' as const : 'imported' as const, epistemicKind: attribute.kind, sourceBacked: true,
        };
      });
      entities.push({
        id: canonicalId, name: proposal.name, category: proposal.category, presence_in_prompt: true,
        description: proposal.description, alternatives: null, attributes, aliases: proposal.aliases,
        status: 'confirmed', provenance: 'accepted-suggestion', epistemicKind: proposal.kind, sourceBacked: true,
      });
    } else {
      for (const attribute of proposal.attributes) {
        const status = selection.rejectedIds.has(attribute.id) ? 'rejected' : 'pending';
        proposals.push({ id: attribute.id, kind: 'attribute', label: attribute.name, detail: attribute.value,
          category: proposal.category, approval: status, rationale: attribute.rationale, evidence: evidenceAnchor(attribute.evidence), epistemicKind: attribute.kind });
        claims.push({ id: crypto.randomUUID(), targetId: attribute.id, rationale: attribute.rationale, approval: status, freshness: 'current', anchors: [evidenceAnchor(attribute.evidence)], epistemicKind: attribute.kind });
      }
    }
    claims.push({ id: crypto.randomUUID(), targetId: approval === 'confirmed' ? canonicalId : proposal.id, rationale: proposal.rationale, approval, freshness: 'current', anchors: [evidenceAnchor(proposal.evidence)], epistemicKind: proposal.kind });
  }

  const byName = new Map<string, Entity[]>();
  for (const entity of entities) for (const name of [entity.name, ...(entity.aliases ?? [])]) {
    const key = normalizedName(name);
    byName.set(key, [...(byName.get(key) ?? []), entity]);
  }
  const relationships: Relationship[] = [];
  for (const proposal of extraction.relationships) {
    const approval = approvalFor(proposal.id, selection);
    proposals.push({ id: proposal.id, kind: 'relationship', label: `${proposal.source} → ${proposal.target} · ${proposal.label}`,
      detail: `${proposal.source} → ${proposal.target}`, category: 'relationship', approval, rationale: proposal.rationale, evidence: evidenceAnchor(proposal.evidence), epistemicKind: proposal.kind });
    claims.push({ id: crypto.randomUUID(), targetId: proposal.id, rationale: proposal.rationale, approval, freshness: 'current', anchors: [evidenceAnchor(proposal.evidence)], epistemicKind: proposal.kind });
    if (approval !== 'confirmed') continue;
    const sources = byName.get(normalizedName(proposal.source)) ?? [];
    const targets = byName.get(normalizedName(proposal.target)) ?? [];
    if (sources.length !== 1 || targets.length !== 1) {
      issues.push({
        id: crypto.randomUUID(), fingerprint: `${sourceId}:relationship:${proposal.id}`,
        title: `Relationship identity needs clarification: ${proposal.source} → ${proposal.target}`,
        disposition: 'needs-clarification', freshness: 'current', reason: 'The relationship target did not resolve to exactly one accepted entity.',
        anchors: [evidenceAnchor(proposal.evidence)], affectedTargetIds: [], severity: 'medium', certainty: 'possible', history: [],
      });
      continue;
    }
    relationships.push({
      id: proposal.id, sourceId: sources[0].id, targetId: targets[0].id, source: sources[0].name, target: targets[0].name,
      label: proposal.label, status: 'confirmed', presence_in_prompt: true, provenance: 'accepted-suggestion', evidenceExcerpt: proposal.evidence.excerpt, epistemicKind: proposal.kind, sourceBacked: true,
    });
  }

  const storyBible = createEmptyStoryBible(now);
  const bibleCandidates = new Map<StoryBibleKey, Array<{ proposal: VerifiedExtraction['findings'][number]; approval: 'confirmed' | 'pending' | 'rejected' }>>();
  for (const proposal of extraction.findings) {
    const approval = approvalFor(proposal.id, selection);
    proposals.push({ id: proposal.id, kind: 'finding', label: proposal.title, detail: proposal.value,
      category: proposal.category, approval, rationale: proposal.rationale, evidence: evidenceAnchor(proposal.evidence), epistemicKind: proposal.kind });
    claims.push({ id: crypto.randomUUID(), targetId: proposal.id, rationale: proposal.rationale, approval, freshness: 'current', anchors: [evidenceAnchor(proposal.evidence)], epistemicKind: proposal.kind });
    if (proposal.category !== 'story-bible') continue;
    const field = fieldAliases[proposal.title.replace(/[^\p{L}\p{N}]/gu, '').toLocaleLowerCase('en')];
    if (field) bibleCandidates.set(field, [...(bibleCandidates.get(field) ?? []), { proposal, approval }]);
  }
  for (const [field, candidates] of bibleCandidates) {
    const accepted = candidates.filter(candidate => candidate.approval === 'confirmed');
    const distinct = new Set(accepted.map(candidate => candidate.proposal.value.trim()));
    if (distinct.size === 1) storyBible[field] = {
      value: [...distinct][0], status: 'confirmed', provenance: 'accepted-suggestion', updatedAt: now, epistemicKind: accepted[0].proposal.kind, sourceBacked: true,
    };
    else if (distinct.size > 1) {
      issues.push({
        id: crypto.randomUUID(), fingerprint: `${sourceId}:bible-conflict:${field}`,
        title: `Conflicting imported values for ${field}`, disposition: 'needs-clarification', freshness: 'current',
        reason: 'More than one accepted source value was proposed for this field. No value was selected automatically.',
        anchors: accepted.map(item => evidenceAnchor(item.proposal.evidence)), affectedTargetIds: [], severity: 'medium', certainty: 'confirmed', history: [],
      });
    }
  }

  for (const proposal of extraction.ambiguities) {
    const approval = approvalFor(proposal.id, selection);
    proposals.push({ id: proposal.id, kind: 'ambiguity', label: proposal.title, detail: proposal.detail,
      category: 'continuity', approval, rationale: proposal.rationale, evidence: evidenceAnchor(proposal.evidence) });
    issues.push({
      id: crypto.randomUUID(), fingerprint: `${sourceId}:ambiguity:${proposal.id}`,
      title: proposal.title, disposition: 'open', freshness: 'current', reason: proposal.detail || proposal.rationale,
      anchors: [evidenceAnchor(proposal.evidence)], affectedTargetIds: [], severity: proposal.severity, certainty: proposal.certainty,
      dispositionReason: approval === 'rejected' ? 'Author rejected this proposed issue.' : undefined, history: [],
    });
  }
  for (const match of identityMatches) {
    const left = extraction.entities.find(item => item.id === match.leftId);
    const right = extraction.entities.find(item => item.id === match.rightId);
    if (!left || !right || approvalFor(left.id, selection) !== 'confirmed' || approvalFor(right.id, selection) !== 'confirmed') continue;
    issues.push({
      id: crypto.randomUUID(), fingerprint: `${sourceId}:identity:${[left.id, right.id].sort().join(':')}`,
      title: `Possible same identity: ${match.matchedName}`, disposition: 'needs-clarification', freshness: 'current',
      reason: `Two separate findings share a ${match.reason === 'same-name' ? 'name' : 'name or alias'}. They were kept separate pending author review.`,
      anchors: [evidenceAnchor(left.evidence), evidenceAnchor(right.evidence)],
      affectedTargetIds: [entityIds.get(left.id)!, entityIds.get(right.id)!], severity: 'medium', certainty: 'possible', history: [],
    });
  }

  if (selection.coverage && !selection.coverage.complete) {
    const gaps: Array<{ start: number; end: number }> = [];
    let cursor = 0;
    for (const span of selection.coverage.processedSpans.slice().sort((a, b) => a.start - b.start)) {
      if (span.start > cursor) gaps.push({ start: cursor, end: span.start });
      cursor = Math.max(cursor, span.end);
    }
    if (cursor < selection.coverage.totalCharacters) gaps.push({ start: cursor, end: selection.coverage.totalCharacters });
    issues.push({
      id: crypto.randomUUID(), fingerprint: `${sourceId}:incomplete-import`,
      title: 'Narrative analysis incomplete', disposition: 'needs-clarification', freshness: 'current',
      reason: `The source has ${gaps.length} unprocessed character range(s): ${gaps.map(({ start, end }) => `${start}–${end}`).join(', ') || 'none'}. ${selection.coverage.failedSegments} segment(s) failed or were not completed. Coverage is ${selection.coverage.processedSpans.reduce((sum, span) => sum + span.end - span.start, 0)} of ${selection.coverage.totalCharacters} characters.`,
      anchors: [], affectedTargetIds: [], severity: 'high', certainty: 'confirmed', history: [],
    });
  }

  const manuscriptVersionId = crypto.randomUUID();
  const sectionVersionId = crypto.randomUUID();
  const sectionId = crypto.randomUUID();
  const snapshot: ProjectSnapshot = {
    manuscriptVersionId,
    originalIdea: `Imported narrative: ${source.filename}`.slice(0, 1000),
    refinedPrompt: `Imported narrative: ${source.filename}`.slice(0, 1000), freeformNotes: '', mode: 'story',
    entities, relationships, storyBible, clarifications: [], decisions: [], answeredQuestions: [], skippedQuestions: [],
  };
  const project: CreativeProject = {
    schemaVersion: 4, id: projectId, revision: 1, name: selection.projectName.trim(), createdAt: now, updatedAt: now,
    snapshot, artifacts: [], undoHistory: { past: [], future: [] },
    revisions: [{ id: crypto.randomUUID(), revisionNumber: 1, timestamp: now, label: 'Imported narrative', summary: `Imported ${source.filename} with evidence review.`, changeCount: 1, snapshot: structuredClone(snapshot) }],
    narrative: {
      versions: [{ id: manuscriptVersionId, sectionVersionIds: [sectionVersionId] }],
      sectionVersions: [{ id: sectionVersionId, section: { id: sectionId, kind: 'scene', title: '', text: source.text } }],
      sources: [sourceRecord], claims, issues, proposals,
      audit: [{ id: crypto.randomUUID(), action: 'write', time: now, baseRevision: 0, resultRevision: 1, reason: 'Created project from an immutable imported source after explicit review.' }],
    },
  };
  return project;
}
