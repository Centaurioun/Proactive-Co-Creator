/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { buildEntityMentionRegex } from '../../consistencyChecker.ts';
import type { CreativeProject } from '../../../shared/types.ts';
import type { ManuscriptSection } from '../../../shared/narrativeTypes.ts';
import type {
  DiagnosticsAnalyzeRequest,
  SyncAnalyzeRequest,
} from '../../../shared/narrativeAiSchemas.ts';
import { isTextBoundary } from '../evidenceRegistry.ts';

export interface ReviewCoverageMetadata {
  scope: 'full' | 'scene' | 'entity' | 'changed';
  complete: boolean;
  totalSections: number;
  eligibleSectionIds: string[];
  coveredSectionIds: string[];
  coveredSectionTitles: string[];
  omittedSectionIds: string[];
  omittedSectionTitles: string[];
  truncatedSectionIds: string[];
  segmentCount: number;
  baselineRevision: number | null;
  summary: string;
}

export interface DiagnosticSegment {
  index: number;
  total: number;
  sectionIds: string[];
  sectionTitles: string[];
  truncatedSectionIds: string[];
  payload: DiagnosticsAnalyzeRequest;
}

export interface DiagnosticContextPlan {
  segments: DiagnosticSegment[];
  coverage: ReviewCoverageMetadata;
}

export interface SyncSegment {
  index: number;
  total: number;
  sectionIds: string[];
  sectionTitles: string[];
  truncatedSectionIds: string[];
  payload: SyncAnalyzeRequest;
}

export interface SyncContextPlan {
  segments: SyncSegment[];
  coverage: ReviewCoverageMetadata;
}

const MAX_DIAG_SEGMENT_SECTION_CHARS = 24_000;
const MAX_DIAG_SECTION_SLICE_CHARS = 10_000;
const MAX_DIAG_SECTIONS_PER_SEGMENT = 20;

const MAX_SYNC_SEGMENT_SECTION_CHARS = 20_000;
const MAX_SYNC_SECTION_SLICE_CHARS = 10_000;
const MAX_SYNC_SECTIONS_PER_SEGMENT = 12;

function trimToSafeBoundary(text: string, maxChars: number): { text: string; truncated: boolean } {
  if (text.length <= maxChars) return { text, truncated: false };
  let end = maxChars;
  while (end > 0 && !isTextBoundary(text, end)) end -= 1;
  return { text: text.slice(0, end), truncated: true };
}

function splitLongSectionIntoSpans(
  section: ManuscriptSection,
  maxSliceChars: number
): Array<{ id: string; title: string; kind: 'chapter' | 'scene'; text: string; sourceSectionId: string; spanLabel?: string }> {
  const baseTitle = section.title || section.kind;
  if (section.text.length <= maxSliceChars) {
    return [{
      id: section.id,
      title: baseTitle,
      kind: section.kind,
      text: section.text,
      sourceSectionId: section.id,
    }];
  }
  const overlap = Math.min(400, Math.floor(maxSliceChars * 0.1));
  const spans: Array<{ id: string; title: string; kind: 'chapter' | 'scene'; text: string; sourceSectionId: string; spanLabel?: string }> = [];
  let cursor = 0;
  let part = 1;
  while (cursor < section.text.length) {
    let end = Math.min(section.text.length, cursor + maxSliceChars);
    while (end > cursor && !isTextBoundary(section.text, end)) end -= 1;
    if (end <= cursor) end = Math.min(section.text.length, cursor + maxSliceChars);
    // Prefer paragraph boundary near the end of the slice
    if (end < section.text.length) {
      const breakIdx = section.text.lastIndexOf('\n\n', end);
      if (breakIdx > cursor + Math.floor(maxSliceChars * 0.6)) {
        end = breakIdx;
      }
    }
    const spanLabel = `part ${part} (chars ${cursor}–${end})`;
    spans.push({
      id: section.id,
      title: `${baseTitle} [${spanLabel}]`.slice(0, 200),
      kind: section.kind,
      text: section.text.slice(cursor, end),
      sourceSectionId: section.id,
      spanLabel,
    });
    if (end >= section.text.length) break;
    let nextStart = Math.max(cursor + 1, end - overlap);
    while (nextStart < section.text.length && !isTextBoundary(section.text, nextStart)) nextStart += 1;
    cursor = nextStart;
    part += 1;
  }
  return spans;
}

function buildEpistemicSourceMap(project: Pick<CreativeProject, 'narrative'>): Map<string, string> {
  const map = new Map<string, string>();
  for (const claim of project.narrative?.claims ?? []) {
    if (!claim.targetId) continue;
    const rationale = claim.rationale?.trim();
    if (rationale && !map.has(claim.targetId)) {
      map.set(claim.targetId, rationale.slice(0, 200));
    }
  }
  return map;
}

/**
 * Builds the compact canonical model payload for semantic diagnostics and sync.
 * Retains `belief` and `reported` entities/attributes with explicit epistemic labels
 * and source attributions so AI never confuses character beliefs for world truth.
 */
export function buildReviewModelPayload(project: Pick<CreativeProject, 'snapshot' | 'narrative'>) {
  const snapshot = project.snapshot;
  const epistemicSources = buildEpistemicSourceMap(project);
  const entities = snapshot.entities
    .filter((e) => e.category !== 'scene')
    .slice(0, 80)
    .map((e) => {
      const entityId = e.id ?? e.name;
      const entitySource =
        e.epistemicKind === 'belief' || e.epistemicKind === 'reported'
          ? epistemicSources.get(entityId) ?? `${e.epistemicKind} claim (not settled world truth)`
          : undefined;
      return {
        id: entityId,
        name: e.name,
        category: e.category,
        description: e.description?.slice(0, 400),
        excluded: e.excluded,
        status: e.status,
        ...(e.epistemicKind ? { epistemicKind: e.epistemicKind } : {}),
        ...(entitySource ? { epistemicSource: entitySource } : {}),
        attributes: e.attributes.slice(0, 20).map((a) => {
          const attrSource =
            a.epistemicKind === 'belief' || a.epistemicKind === 'reported'
              ? (a.id ? epistemicSources.get(a.id) : undefined) ??
                `${a.epistemicKind} claim on ${e.name} (not settled world truth)`
              : undefined;
          return {
            id: a.id,
            name: a.name,
            value: a.confirmedValue ?? a.value[0]?.name ?? '',
            status: a.status,
            ...(a.epistemicKind ? { epistemicKind: a.epistemicKind } : {}),
            ...(attrSource ? { epistemicSource: attrSource } : {}),
          };
        }),
      };
    });

  const relationships = snapshot.relationships.slice(0, 100).map((r) => ({
    id: r.id,
    sourceId: r.sourceId,
    targetId: r.targetId,
    source: r.source,
    target: r.target,
    label: r.label,
    status: r.status,
  }));

  const storyBible: Record<string, string> = {};
  for (const [k, f] of Object.entries(snapshot.storyBible)) {
    if (f.value.trim()) storyBible[k] = f.value.trim().slice(0, 600);
  }

  return { entities, relationships, storyBible };
}

/**
 * Determines the most recent applicable scan baseline revision from narrative records.
 */
export function findLastScanBaselineRevision(
  project: CreativeProject,
  mode: 'diagnostics' | 'sync'
): number | null {
  if (mode === 'sync') {
    const rev = project.narrative?.syncState?.lastReviewedRevision;
    return typeof rev === 'number' ? rev : null;
  }
  const semanticRevs = (project.narrative?.issues ?? [])
    .filter((i) => i.source === 'semantic-ai' && typeof i.detectedAtRevision === 'number')
    .map((i) => i.detectedAtRevision as number);
  if (semanticRevs.length > 0) {
    return Math.max(...semanticRevs);
  }
  const syncRev = project.narrative?.syncState?.lastReviewedRevision;
  return typeof syncRev === 'number' ? syncRev : null;
}

/**
 * Computes which manuscript sections changed since `baselineRevision` using recorded
 * manuscript versions and audit trail entries. Falls back truthfully when no baseline exists.
 */
export function resolveChangedSectionIds(
  project: CreativeProject,
  sections: readonly ManuscriptSection[],
  baselineRevision: number | null
): { changedIds: string[]; usedBaseline: boolean } {
  if (baselineRevision === null || !project.narrative) {
    return { changedIds: sections.map((s) => s.id), usedBaseline: false };
  }
  if (project.revision <= baselineRevision) {
    return { changedIds: [], usedBaseline: true };
  }

  const narrative = project.narrative;
  const sectionByVersionId = new Map(narrative.sectionVersions.map((sv) => [sv.id, sv.section]));
  const versionById = new Map(narrative.versions.map((v) => [v.id, v]));

  // Locate the earliest manuscript version touched after baselineRevision via audit records
  const auditsAfterBaseline = narrative.audit.filter(
    (a) => a.resultRevision > baselineRevision && (a.before || a.after)
  );
  let baselineVersionId: string | undefined;
  if (auditsAfterBaseline.length > 0) {
    const earliest = auditsAfterBaseline.reduce((min, cur) =>
      cur.resultRevision < min.resultRevision ? cur : min
    );
    baselineVersionId = earliest.before;
  } else if (narrative.versions.length >= 2) {
    baselineVersionId = narrative.versions[narrative.versions.length - 2]?.id;
  }

  const baselineVersion = baselineVersionId ? versionById.get(baselineVersionId) : undefined;
  if (!baselineVersion) {
    // Model-only edits after baseline without manuscript version changes => 0 changed sections
    const hadWriteAudit = narrative.audit.some(
      (a) => a.resultRevision > baselineRevision && (a.action === 'write' || a.action === 'append' || a.action === 'sync' || a.action === 'fix')
    );
    if (!hadWriteAudit) {
      return { changedIds: [], usedBaseline: true };
    }
    return { changedIds: sections.map((s) => s.id), usedBaseline: true };
  }

  const baselineSectionsById = new Map<string, ManuscriptSection>();
  for (const svId of baselineVersion.sectionVersionIds) {
    const sec = sectionByVersionId.get(svId);
    if (sec) baselineSectionsById.set(sec.id, sec);
  }

  const changedIds: string[] = [];
  for (const current of sections) {
    const prev = baselineSectionsById.get(current.id);
    if (!prev || prev.text !== current.text || prev.title !== current.title) {
      changedIds.push(current.id);
    }
  }
  return { changedIds, usedBaseline: true };
}

function filterSectionsByEntity(
  project: CreativeProject,
  sections: readonly ManuscriptSection[],
  entityIdOrName: string
): ManuscriptSection[] {
  const target = project.snapshot.entities.find(
    (e) => e.id === entityIdOrName || e.name === entityIdOrName
  );
  if (!target) return [];
  const names = [target.name, ...(target.aliases ?? [])].filter((n) => n.trim().length > 0);
  const matchers = names.map((n) => buildEntityMentionRegex(n));
  return sections.filter((section) => {
    const haystack = `${section.title}\n${section.characters ?? ''}\n${section.synopsis ?? ''}\n${section.text}`;
    return matchers.some((rx) => rx.test(haystack));
  });
}

function packSpansIntoSegments(
  sections: readonly ManuscriptSection[],
  maxSliceChars: number,
  maxSegmentChars: number,
  maxSectionsPerSegment: number
): Array<{
  items: Array<{ id: string; title: string; kind: 'chapter' | 'scene'; text: string }>;
  sectionIds: string[];
  sectionTitles: string[];
  truncatedSectionIds: string[];
}> {
  if (sections.length === 0) return [];
  const allSpans = sections.flatMap((s) => splitLongSectionIntoSpans(s, maxSliceChars));
  const buckets: Array<{
    items: Array<{ id: string; title: string; kind: 'chapter' | 'scene'; text: string }>;
    sectionIds: Set<string>;
    sectionTitles: Set<string>;
    truncatedSectionIds: Set<string>;
    chars: number;
  }> = [];

  for (const span of allSpans) {
    let current = buckets[buckets.length - 1];
    const spanChars = span.text.length + span.title.length + 80;
    const fits =
      current &&
      current.items.length < maxSectionsPerSegment &&
      current.chars + spanChars <= maxSegmentChars;
    if (!fits) {
      current = {
        items: [],
        sectionIds: new Set(),
        sectionTitles: new Set(),
        truncatedSectionIds: new Set(),
        chars: 0,
      };
      buckets.push(current);
    }
    current.items.push({
      id: span.id,
      title: span.title,
      kind: span.kind,
      text: span.text,
    });
    current.sectionIds.add(span.sourceSectionId);
    current.sectionTitles.add(span.title);
    if (span.spanLabel) current.truncatedSectionIds.add(span.sourceSectionId);
    current.chars += spanChars;
  }

  return buckets.map((b) => ({
    items: b.items,
    sectionIds: Array.from(b.sectionIds),
    sectionTitles: Array.from(b.sectionTitles),
    truncatedSectionIds: Array.from(b.truncatedSectionIds),
  }));
}

/**
 * Builds truthfully scoped, bounded diagnostic segments for `full`, `scene`, `entity`, or `changed`.
 * Never silently truncates to the first 8 sections pretending full coverage.
 */
export function buildScopedDiagnosticPlan(params: {
  project: CreativeProject;
  sections: readonly ManuscriptSection[];
  scope: 'full' | 'scene' | 'entity' | 'changed';
  scopeTargetId?: string;
  compactModel?: ReturnType<typeof buildReviewModelPayload>;
  maxSegmentChars?: number;
  maxSectionSliceChars?: number;
}): DiagnosticContextPlan {
  const {
    project,
    sections,
    scope,
    scopeTargetId,
    compactModel = buildReviewModelPayload(project),
    maxSegmentChars = MAX_DIAG_SEGMENT_SECTION_CHARS,
    maxSectionSliceChars = MAX_DIAG_SECTION_SLICE_CHARS,
  } = params;

  const baselineRevision = scope === 'changed' ? findLastScanBaselineRevision(project, 'diagnostics') : null;
  let eligibleSections: ManuscriptSection[];
  let changedNote = '';

  if (scope === 'scene') {
    eligibleSections = scopeTargetId ? sections.filter((s) => s.id === scopeTargetId) : [];
  } else if (scope === 'entity') {
    eligibleSections = scopeTargetId ? filterSectionsByEntity(project, sections, scopeTargetId) : [];
  } else if (scope === 'changed') {
    const changed = resolveChangedSectionIds(project, sections, baselineRevision);
    const idSet = new Set(changed.changedIds);
    eligibleSections = sections.filter((s) => idSet.has(s.id));
    if (!changed.usedBaseline) {
      changedNote = 'No prior semantic scan baseline — including all sections across bounded segments.';
    } else if (eligibleSections.length === 0) {
      changedNote = `No manuscript sections changed since baseline rev #${baselineRevision}; checking canonical model facts only.`;
    } else {
      changedNote = `${eligibleSections.length} of ${sections.length} section(s) changed since baseline rev #${baselineRevision}.`;
    }
  } else {
    eligibleSections = [...sections];
  }

  // Narrow entities/relationships only when scope === 'entity' while still keeping directly related entities
  let scopedModel = compactModel;
  if (scope === 'entity' && scopeTargetId) {
    const primary = compactModel.entities.find((e) => e.id === scopeTargetId || e.name === scopeTargetId);
    const primaryId = primary?.id ?? scopeTargetId;
    const primaryName = primary?.name ?? scopeTargetId;
    const relatedRels = compactModel.relationships.filter(
      (r) =>
        r.sourceId === primaryId ||
        r.targetId === primaryId ||
        r.source.toLowerCase() === primaryName.toLowerCase() ||
        r.target.toLowerCase() === primaryName.toLowerCase()
    );
    const relatedIds = new Set<string>([primaryId]);
    const relatedNames = new Set<string>([primaryName.toLowerCase()]);
    for (const rel of relatedRels) {
      if (rel.sourceId) relatedIds.add(rel.sourceId);
      if (rel.targetId) relatedIds.add(rel.targetId);
      relatedNames.add(rel.source.toLowerCase());
      relatedNames.add(rel.target.toLowerCase());
    }
    const relatedEntities = compactModel.entities.filter(
      (e) => relatedIds.has(e.id) || relatedNames.has(e.name.toLowerCase())
    );
    scopedModel = {
      entities: relatedEntities.length > 0 ? relatedEntities : compactModel.entities,
      relationships: relatedRels,
      storyBible: compactModel.storyBible,
    };
  }

  const packed = packSpansIntoSegments(
    eligibleSections,
    maxSectionSliceChars,
    maxSegmentChars,
    MAX_DIAG_SECTIONS_PER_SEGMENT
  );

  const segments: DiagnosticSegment[] =
    packed.length > 0
      ? packed.map((bucket, idx) => ({
          index: idx,
          total: packed.length,
          sectionIds: bucket.sectionIds,
          sectionTitles: bucket.sectionTitles,
          truncatedSectionIds: bucket.truncatedSectionIds,
          payload: {
            projectId: project.id,
            baseRevision: project.revision,
            scope,
            ...(scopeTargetId ? { scopeTargetId } : {}),
            ...scopedModel,
            sections: bucket.items,
          },
        }))
      : [
          {
            index: 0,
            total: 1,
            sectionIds: [],
            sectionTitles: [],
            truncatedSectionIds: [],
            payload: {
              projectId: project.id,
              baseRevision: project.revision,
              scope,
              ...(scopeTargetId ? { scopeTargetId } : {}),
              ...scopedModel,
              sections: [],
            },
          },
        ];

  const coveredSet = new Set(segments.flatMap((s) => s.sectionIds));
  const eligibleIds = eligibleSections.map((s) => s.id);
  const omittedSections = sections.filter((s) => !coveredSet.has(s.id));
  const truncatedIds = Array.from(new Set(segments.flatMap((s) => s.truncatedSectionIds)));

  const complete =
    scope === 'full'
      ? omittedSections.length === 0 && segments.length === 1
      : eligibleIds.every((id) => coveredSet.has(id)) && segments.length === 1;

  const summaryParts: string[] = [];
  if (scope === 'full') {
    summaryParts.push(
      segments.length === 1
        ? `Full scope covers all ${coveredSet.size} manuscript section(s) in 1 bounded pass.`
        : `Full scope requires ${segments.length} bounded segment(s) covering all ${coveredSet.size} manuscript section(s).`
    );
  } else if (scope === 'scene') {
    const title = eligibleSections[0]?.title || eligibleSections[0]?.kind || 'selected scene';
    summaryParts.push(`Scene scope covers "${title}" (${omittedSections.length} other section(s) excluded by scope).`);
  } else if (scope === 'entity') {
    summaryParts.push(
      eligibleSections.length > 0
        ? `Entity scope covers ${eligibleSections.length} section(s) mentioning target (${omittedSections.length} other section(s) excluded).`
        : `Entity scope checks canonical model facts only (no manuscript sections mention this entity).`
    );
  } else {
    summaryParts.push(changedNote);
  }
  if (truncatedIds.length > 0) {
    summaryParts.push(`${truncatedIds.length} long section(s) split across overlapping bounded spans.`);
  }

  return {
    segments,
    coverage: {
      scope,
      complete,
      totalSections: sections.length,
      eligibleSectionIds: eligibleIds,
      coveredSectionIds: Array.from(coveredSet),
      coveredSectionTitles: sections.filter((s) => coveredSet.has(s.id)).map((s) => s.title || s.kind),
      omittedSectionIds: omittedSections.map((s) => s.id),
      omittedSectionTitles: omittedSections.map((s) => s.title || s.kind),
      truncatedSectionIds: truncatedIds,
      segmentCount: segments.length,
      baselineRevision,
      summary: summaryParts.join(' '),
    },
  };
}

/**
 * Builds truthfully scoped, bounded sync segments across all manuscript sections
 * (never silently dropping sections 9+ via `.slice(0, 8)`).
 */
export function buildScopedSyncPlan(params: {
  project: CreativeProject;
  sections: readonly ManuscriptSection[];
  direction: 'manuscript-to-model' | 'model-to-manuscript';
  compactModel?: ReturnType<typeof buildReviewModelPayload>;
  maxSegmentChars?: number;
  maxSectionSliceChars?: number;
}): SyncContextPlan {
  const {
    project,
    sections,
    direction,
    compactModel = buildReviewModelPayload(project),
    maxSegmentChars = MAX_SYNC_SEGMENT_SECTION_CHARS,
    maxSectionSliceChars = MAX_SYNC_SECTION_SLICE_CHARS,
  } = params;

  const baselineRevision = findLastScanBaselineRevision(project, 'sync');
  const changed = resolveChangedSectionIds(project, sections, baselineRevision);
  const packed = packSpansIntoSegments(
    sections,
    maxSectionSliceChars,
    maxSegmentChars,
    MAX_SYNC_SECTIONS_PER_SEGMENT
  );

  const segments: SyncSegment[] = packed.map((bucket, idx) => ({
    index: idx,
    total: packed.length,
    sectionIds: bucket.sectionIds,
    sectionTitles: bucket.sectionTitles,
    truncatedSectionIds: bucket.truncatedSectionIds,
    payload: {
      direction,
      projectId: project.id,
      baseRevision: project.revision,
      manuscriptVersionId: project.snapshot.manuscriptVersionId,
      sections: bucket.items,
      ...compactModel,
      ...(changed.usedBaseline && changed.changedIds.length > 0
        ? { changedSectionIds: changed.changedIds.slice(0, 20) }
        : {}),
    },
  }));

  const coveredSet = new Set(segments.flatMap((s) => s.sectionIds));
  const omittedSections = sections.filter((s) => !coveredSet.has(s.id));
  const truncatedIds = Array.from(new Set(segments.flatMap((s) => s.truncatedSectionIds)));

  const summary =
    segments.length === 0
      ? 'No manuscript sections available for sync.'
      : segments.length === 1
        ? `Covers all ${coveredSet.size} manuscript section(s) in 1 bounded sync pass.`
        : `Requires ${segments.length} bounded sync segment(s) to cover all ${coveredSet.size} manuscript section(s).`;

  return {
    segments,
    coverage: {
      scope: 'full',
      complete: segments.length <= 1 && omittedSections.length === 0,
      totalSections: sections.length,
      eligibleSectionIds: sections.map((s) => s.id),
      coveredSectionIds: Array.from(coveredSet),
      coveredSectionTitles: sections.filter((s) => coveredSet.has(s.id)).map((s) => s.title || s.kind),
      omittedSectionIds: omittedSections.map((s) => s.id),
      omittedSectionTitles: omittedSections.map((s) => s.title || s.kind),
      truncatedSectionIds: truncatedIds,
      segmentCount: segments.length,
      baselineRevision,
      summary,
    },
  };
}

/**
 * Bounded manuscript context bridge for Plan/Story operations when a project has working manuscript text.
 */
export function buildBoundedManuscriptBridgeSummary(
  sections: readonly ManuscriptSection[],
  maxChars = 2_400
): string | null {
  if (sections.length === 0) return null;
  const parts: string[] = [];
  let used = 0;
  for (const section of sections) {
    const heading = `${section.kind === 'chapter' ? 'Chapter' : 'Scene'}: ${section.title || 'Untitled'}`;
    const excerpt = trimToSafeBoundary(section.text.trim(), 400).text;
    const entry = excerpt ? `- ${heading}: ${excerpt}` : `- ${heading} (empty draft)`;
    if (used + entry.length + 1 > maxChars) {
      parts.push(`... (${sections.length - parts.length} more section(s) omitted due to context budget)`);
      break;
    }
    parts.push(entry);
    used += entry.length + 1;
  }
  return parts.length > 0 ? `Working Manuscript Context (${sections.length} sections):\n${parts.join('\n')}` : null;
}
