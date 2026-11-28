import { buildEntityMentionRegex, evaluateProjectConsistency } from '../../consistencyChecker.ts';
import type { UndoRedoState } from '../../historyEngine.ts';
import type {
  ConsistencyIssue,
  CreativeProject,
  StoryBibleFields,
} from '../../../shared/types.ts';
import type {
  DiagnosticFixAlternative,
  SemanticDiagnosticFinding,
} from '../../../shared/narrativeAiSchemas.ts';
import type { ManuscriptSection, NarrativeIssue, NarrativeRecords } from '../../../shared/narrativeTypes.ts';
import { manuscriptSections } from '../manuscriptModel.ts';
import { findExactQuoteMatches } from '../import/proposalValidator.ts';
import { computeTextDigest } from '../writing/selectionHelpers.ts';
import {
  diagnosticFingerprint,
  reconcileDiagnosticFindings,
  type DiagnosticFinding,
} from './findings.ts';
import {
  applyManuscriptPatchAlternative,
  applySnapshotFixAlternative,
  buildLocalFixAlternativesList,
  finalizeAppliedFixResult,
  type AppliedFixResult,
} from './fixApplication.ts';

export type { AppliedFixResult };

export interface ReadinessItem {
  id: string;
  title: string;
  description: string;
  storyField?: keyof StoryBibleFields;
}

export function ensureNarrativeEnvelope(project: CreativeProject): CreativeProject {
  if (project.narrative) return project;
  const records: NarrativeRecords = {
    versions: [],
    sectionVersions: [],
    sources: [],
    claims: [],
    proposals: [],
    opportunities: [],
    issues: [],
    audit: [],
  };
  return {
    ...project,
    schemaVersion: 4,
    narrative: records,
  };
}

/**
 * Separates project readiness checklists (e.g., unconfirmed core Story Bible fields)
 * from actual continuity/consistency issues.
 */
export function splitReadinessAndIssues(issues: readonly ConsistencyIssue[]): {
  readiness: ReadinessItem[];
  consistencyIssues: ConsistencyIssue[];
} {
  const readiness: ReadinessItem[] = [];
  const consistencyIssues: ConsistencyIssue[] = [];
  for (const issue of issues) {
    if (issue.category === 'unresolved_decision') {
      readiness.push({
        id: issue.id,
        title: issue.title,
        description: issue.description,
        storyField: issue.targets?.[0]?.storyField,
      });
    } else {
      consistencyIssues.push(issue);
    }
  }
  return { readiness, consistencyIssues };
}

function resolveConsistencyTargets(issue: ConsistencyIssue, projectId: string): string[] {
  const targetRefs = (issue.targets ?? []).flatMap((t) => {
    if (t.entityId) return [t.entityId];
    if (t.relationshipId) return [t.relationshipId];
    if (t.storyField) return [`story_bible:${t.storyField}`];
    return t.sectionId ? [t.sectionId] : [];
  });
  const combined = [
    ...issue.affectedEntityIds,
    ...(issue.relationshipId ? [issue.relationshipId] : []),
    ...targetRefs,
  ].filter((id) => Boolean(id && id.trim()));
  const deduped = Array.from(new Set(combined));
  return deduped.length > 0 ? deduped : [projectId];
}

function collectExcludedManuscriptMentionFindings(project: CreativeProject): DiagnosticFinding[] {
  const findings: DiagnosticFinding[] = [];
  const sections = manuscriptSections(project);
  const excludedEntities = project.snapshot.entities.filter((e) => e.excluded && e.name.trim().length > 1);
  for (const ent of excludedEntities) {
    const regex = buildEntityMentionRegex(ent.name);
    for (const section of sections) {
      if (!regex.test(section.text)) continue;
      findings.push({
        detectorId: 'local-consistency',
        scopeKey: 'project',
        type: 'manuscript_excluded_mention',
        targetIds: [ent.id ?? ent.name, section.id],
        title: `Excluded entity "${ent.name}" appears in "${section.title || 'Untitled section'}"`,
        reason: `"${ent.name}" is marked Excluded in the canonical model, but its name still appears in manuscript section "${section.title || section.id}".`,
        severity: 'high',
        certainty: 'confirmed',
        anchors: [],
      });
    }
  }
  return findings;
}

export function collectLocalDiagnosticFindings(project: CreativeProject): DiagnosticFinding[] {
  const rawIssues = evaluateProjectConsistency(project.snapshot);
  const { consistencyIssues } = splitReadinessAndIssues(rawIssues);
  const findings: DiagnosticFinding[] = consistencyIssues.map((issue) => ({
    detectorId: 'local-consistency',
    scopeKey: 'project',
    type: `${issue.category}:${issue.id}`,
    targetIds: resolveConsistencyTargets(issue, project.id),
    title: issue.title,
    reason: issue.description,
    severity: issue.severity === 'error' ? 'high' : 'medium',
    certainty:
      issue.category === 'violated_exclusion' || issue.category === 'relationship_conflict'
        ? 'confirmed'
        : 'likely',
    anchors: [],
  }));

  return [...findings, ...collectExcludedManuscriptMentionFindings(project)];
}

function mapSemanticCertainty(certainty: SemanticDiagnosticFinding['certainty']): DiagnosticFinding['certainty'] {
  if (certainty === 'confirmed') return 'confirmed';
  return certainty === 'inferred' ? 'likely' : 'possible';
}

function resolveSemanticEvidenceAnchor(
  quote: string | undefined,
  preferredSectionId: string | undefined,
  sections: readonly ManuscriptSection[] | undefined,
  manuscriptVersionId: string
): {
  anchor?: NarrativeIssue['anchors'][number];
  matchedSectionId?: string;
  verificationNote?: string;
} {
  const trimmedQuote = quote?.trim();
  if (!trimmedQuote || !sections || sections.length === 0) return {};

  const orderedSections = preferredSectionId
    ? [
        ...sections.filter((s) => s.id === preferredSectionId),
        ...sections.filter((s) => s.id !== preferredSectionId),
      ]
    : [...sections];

  const allMatches: Array<{ section: ManuscriptSection; start: number; end: number }> = [];
  for (const sec of orderedSections) {
    const matches = findExactQuoteMatches(sec.text, trimmedQuote);
    if (matches.length === 1 && sec.id === preferredSectionId) {
      const m = matches[0];
      return {
        matchedSectionId: sec.id,
        anchor: {
          sourceId: sec.id,
          version: manuscriptVersionId,
          digest: computeTextDigest(sec.text),
          start: m.start,
          end: m.end,
          excerpt: sec.text.slice(m.start, m.end),
        },
      };
    }
    for (const m of matches) {
      allMatches.push({ section: sec, start: m.start, end: m.end });
    }
  }

  if (allMatches.length === 1) {
    const match = allMatches[0];
    return {
      matchedSectionId: match.section.id,
      anchor: {
        sourceId: match.section.id,
        version: manuscriptVersionId,
        digest: computeTextDigest(match.section.text),
        start: match.start,
        end: match.end,
        excerpt: match.section.text.slice(match.start, match.end),
      },
    };
  }

  if (allMatches.length > 1) {
    return {
      verificationNote: `[Ambiguous evidence quote: matched ${allMatches.length} locations in manuscript; verify span manually]`,
    };
  }

  return {
    verificationNote: `[Unverified evidence quote: "${trimmedQuote.slice(0, 120)}" was not found verbatim in scanned manuscript sections]`,
  };
}

export function convertSemanticFindingsToDiagnosticFindings(
  semanticFindings: readonly SemanticDiagnosticFinding[],
  fallbackTargetId = 'project',
  scopeKey = 'semantic',
  sections?: readonly ManuscriptSection[],
  manuscriptVersionId = 'working-manuscript'
): DiagnosticFinding[] {
  return semanticFindings.map((f, idx) => {
    const resolved = resolveSemanticEvidenceAnchor(
      f.evidenceQuote,
      f.sectionId?.trim(),
      sections,
      manuscriptVersionId
    );
    const targetIds = [
      ...(f.targetId?.trim() ? [f.targetId.trim()] : []),
      ...(f.storyField ? [`story_bible:${f.storyField}`] : []),
      ...(f.sectionId?.trim() ? [f.sectionId.trim()] : []),
      ...(resolved.matchedSectionId ? [resolved.matchedSectionId] : []),
    ];
    const deduped = Array.from(new Set(targetIds));
    const slug = f.title.slice(0, 48).toLowerCase().replace(/[^a-z0-9]+/g, '_') || idx;
    const reason = resolved.verificationNote
      ? `${f.description} ${resolved.verificationNote}`
      : f.description;
    return {
      detectorId: 'semantic-ai',
      scopeKey,
      type: `semantic:${f.category}:${slug}`,
      targetIds: deduped.length > 0 ? deduped : [fallbackTargetId],
      title: f.title,
      reason,
      severity: f.severity === 'error' ? 'high' : 'medium',
      certainty: mapSemanticCertainty(f.certainty),
      anchors: resolved.anchor ? [resolved.anchor] : [],
    };
  });
}

function syncFullLocalScan(
  baseProject: CreativeProject,
  records: NarrativeRecords,
  findings: readonly DiagnosticFinding[],
  scopeLabel: string,
  now: number
): NarrativeIssue[] {
  const scannedTargets = new Set<string>([
    baseProject.id,
    ...baseProject.snapshot.entities.flatMap((e) => (e.id ? [e.id] : [e.name])),
    ...baseProject.snapshot.relationships.flatMap((r) => (r.id ? [r.id] : [])),
    ...manuscriptSections(baseProject).map((s) => s.id),
    ...Object.keys(baseProject.snapshot.storyBible).map((k) => `story_bible:${k}`),
    ...findings.flatMap((f) => f.targetIds),
    ...records.issues.flatMap((i) => i.affectedTargetIds ?? []),
  ]);

  const reconciliation = reconcileDiagnosticFindings(
    records,
    {
      detectorId: 'local-consistency',
      scopeKey: 'project',
      scannedTargetIds: Array.from(scannedTargets),
      complete: true,
      projectRevision: baseProject.revision,
      validatedRevision: baseProject.revision,
      now,
    },
    findings
  );

  const byId = new Map<string, NarrativeIssue>(records.issues.map((i) => [i.id, i]));
  for (const action of reconciliation.actions) {
    byId.set(action.issue.id, {
      ...action.issue,
      source: 'local',
      detectedAtRevision: action.issue.detectedAtRevision ?? baseProject.revision,
      scopeLabel,
      updatedAt: action.issue.updatedAt ?? now,
    });
  }
  return Array.from(byId.values());
}

function isUnchangedExistingIssue(
  existing: NarrativeIssue,
  finding: DiagnosticFinding,
  scopeLabel: string
): boolean {
  if (existing.disposition === 'resolved') return false;
  if (existing.freshness !== 'current' || existing.scopeLabel !== scopeLabel) return false;
  if (existing.title !== finding.title || existing.reason !== finding.reason) return false;
  if (existing.severity !== finding.severity || existing.certainty !== finding.certainty) return false;
  return JSON.stringify(existing.affectedTargetIds) === JSON.stringify([...finding.targetIds])
    && JSON.stringify(existing.anchors) === JSON.stringify([...finding.anchors]);
}

function buildUpdatedPartialIssue(
  existing: NarrativeIssue,
  finding: DiagnosticFinding,
  meta: { revision: number; source: 'local' | 'semantic-ai'; scopeLabel: string; now: number }
): NarrativeIssue {
  const reopened = existing.disposition === 'resolved';
  const reopenReason = 'Finding recurred in a verified diagnostic scan.';
  return {
    ...existing,
    title: finding.title,
    reason: finding.reason,
    severity: finding.severity,
    certainty: finding.certainty,
    anchors: [...finding.anchors],
    affectedTargetIds: [...finding.targetIds],
    freshness: 'current',
    source: meta.source,
    detectedAtRevision: meta.revision,
    scopeLabel: meta.scopeLabel,
    updatedAt: meta.now,
    ...(reopened
      ? {
          disposition: 'open' as const,
          dispositionReason: reopenReason,
          history: [
            ...(existing.history ?? []),
            {
              disposition: 'open' as const,
              time: meta.now,
              reason: reopenReason,
              projectRevision: meta.revision,
            },
          ],
        }
      : {}),
  };
}

function createPartialIssue(
  fp: string,
  finding: DiagnosticFinding,
  meta: { revision: number; source: 'local' | 'semantic-ai'; scopeLabel: string; now: number }
): NarrativeIssue {
  return {
    id: `issue:${fp}`,
    fingerprint: fp,
    title: finding.title,
    reason: finding.reason,
    disposition: 'open',
    freshness: 'current',
    severity: finding.severity,
    certainty: finding.certainty,
    source: meta.source,
    detectedAtRevision: meta.revision,
    scopeLabel: meta.scopeLabel,
    anchors: [...finding.anchors],
    affectedTargetIds: [...finding.targetIds],
    updatedAt: meta.now,
    history: [],
  };
}

function syncPartialOrSemanticScan(
  baseProject: CreativeProject,
  records: NarrativeRecords,
  findings: readonly DiagnosticFinding[],
  meta: { source: 'local' | 'semantic-ai'; scopeLabel: string; now: number }
): NarrativeIssue[] {
  const byFp = new Map(records.issues.map((i) => [i.fingerprint, i]));
  const updated = new Map(records.issues.map((i) => [i.id, i]));
  const issueMeta = { revision: baseProject.revision, ...meta };

  for (const finding of findings) {
    const fp = diagnosticFingerprint(finding.detectorId, finding.type, finding.targetIds, finding.scopeKey);
    const existing = byFp.get(fp);
    if (!existing) {
      const created = createPartialIssue(fp, finding, issueMeta);
      updated.set(created.id, created);
      continue;
    }
    if (isUnchangedExistingIssue(existing, finding, meta.scopeLabel)) continue;
    updated.set(existing.id, buildUpdatedPartialIssue(existing, finding, issueMeta));
  }
  return Array.from(updated.values());
}

export function syncDiagnosticFindingsIntoProject(
  project: CreativeProject,
  findings: readonly DiagnosticFinding[],
  options: {
    source: 'local' | 'semantic-ai';
    scopeLabel: string;
    fullScan: boolean;
    now?: number;
  }
): CreativeProject {
  const baseProject = ensureNarrativeEnvelope(project);
  const records = baseProject.narrative!;
  const now = options.now ?? Date.now();

  const nextIssues = options.fullScan && options.source === 'local'
    ? syncFullLocalScan(baseProject, records, findings, options.scopeLabel, now)
    : syncPartialOrSemanticScan(baseProject, records, findings, {
        source: options.source,
        scopeLabel: options.scopeLabel,
        now,
      });

  if (nextIssues.length === records.issues.length &&
      nextIssues.every((issue, index) => issue === records.issues[index])) return project;

  return {
    ...baseProject,
    narrative: {
      ...records,
      issues: nextIssues,
    },
  };
}

/**
 * Generates deterministic local fix alternatives (0-3) for well-defined local issues
 * so authors can safely preview and apply fixes even without AI configured.
 */
export function buildLocalFixAlternatives(
  project: CreativeProject,
  issue: Pick<NarrativeIssue, 'id' | 'title' | 'reason' | 'affectedTargetIds'>
): DiagnosticFixAlternative[] {
  return buildLocalFixAlternativesList(project, issue);
}

/**
 * Applies ONE validated author-selected fix alternative atomically, rechecks local diagnostics,
 * records an audit trail entry, and returns the updated project + undo state.
 * Fails closed if the project revision changed or the target/excerpt no longer matches.
 */
export function applyDiagnosticFixAlternative(
  project: CreativeProject,
  undoState: UndoRedoState,
  issueId: string,
  alternative: DiagnosticFixAlternative,
  expectedBaseRevision: number
): AppliedFixResult {
  if (project.revision !== expectedBaseRevision) {
    throw new Error('The project changed since these fix alternatives were previewed. Re-preview before applying.');
  }
  if (alternative.kind === 'manual_guidance') {
    throw new Error('This alternative is manual guidance only and must be edited directly in the workspace.');
  }

  const now = Date.now();
  const baseProject = ensureNarrativeEnvelope(project);
  const applied = alternative.kind === 'manuscript_patch'
    ? applyManuscriptPatchAlternative(baseProject, undoState, alternative)
    : applySnapshotFixAlternative(baseProject, undoState, alternative, now);

  // Post-apply deterministic recheck: never falsely mark residual issues resolved
  const postFindings = collectLocalDiagnosticFindings(applied.project);
  const rechecked = syncDiagnosticFindingsIntoProject(applied.project, postFindings, {
    source: 'local',
    scopeLabel: 'Post-fix recheck',
    fullScan: true,
    now,
  });

  return finalizeAppliedFixResult({
    rechecked,
    postFindings,
    undoState: applied.undoState,
    issueId,
    alternative,
    expectedBaseRevision,
    now,
  });
}
