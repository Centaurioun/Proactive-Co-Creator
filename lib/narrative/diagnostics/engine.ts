import {
  createEmptyStoryBible,
  makeStableId,
  setEntityAttribute,
  updateStoryBibleField,
} from '../../canonicalModel.ts';
import { evaluateProjectConsistency } from '../../consistencyChecker.ts';
import { commitSnapshotTransaction } from '../../projectController.ts';
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
import type { NarrativeIssue, NarrativeRecords } from '../../../shared/narrativeTypes.ts';
import { manuscriptSections, narrativeBase, prepareManuscriptChange } from '../manuscriptModel.ts';
import {
  diagnosticFingerprint,
  reconcileDiagnosticFindings,
  type DiagnosticFinding,
} from './findings.ts';

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

export function collectLocalDiagnosticFindings(project: CreativeProject): DiagnosticFinding[] {
  const rawIssues = evaluateProjectConsistency(project.snapshot);
  const { consistencyIssues } = splitReadinessAndIssues(rawIssues);
  const findings: DiagnosticFinding[] = consistencyIssues.map((issue) => {
    const affectedTargets = [
      ...issue.affectedEntityIds,
      ...(issue.relationshipId ? [issue.relationshipId] : []),
      ...(issue.targets ?? []).flatMap((t) =>
        t.entityId ? [t.entityId] : t.relationshipId ? [t.relationshipId] : t.storyField ? [`story_bible:${t.storyField}`] : t.sectionId ? [t.sectionId] : []
      ),
    ].filter((id) => Boolean(id && id.trim()));
    const dedupedTargets = Array.from(new Set(affectedTargets));
    return {
      detectorId: 'local-consistency',
      scopeKey: 'project',
      type: `${issue.category}:${issue.id}`,
      targetIds: dedupedTargets.length > 0 ? dedupedTargets : [project.id],
      title: issue.title,
      reason: issue.description,
      severity: issue.severity === 'error' ? 'high' : 'medium',
      certainty: issue.category === 'violated_exclusion' || issue.category === 'relationship_conflict' ? 'confirmed' : 'likely',
      anchors: [],
    };
  });

  // Check if any excluded entity is explicitly mentioned in Working Manuscript sections
  const sections = manuscriptSections(project);
  const excludedEntities = project.snapshot.entities.filter((e) => e.excluded && e.name.trim().length > 1);
  for (const ent of excludedEntities) {
    const escaped = ent.name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const regex = new RegExp(`\\b${escaped}\\b`, 'i');
    for (const section of sections) {
      if (regex.test(section.text)) {
        const targets = [ent.id ?? ent.name, section.id];
        findings.push({
          detectorId: 'local-consistency',
          scopeKey: 'project',
          type: 'manuscript_excluded_mention',
          targetIds: targets,
          title: `Excluded entity "${ent.name}" appears in "${section.title || 'Untitled section'}"`,
          reason: `"${ent.name}" is marked Excluded in the canonical model, but its name still appears in manuscript section "${section.title || section.id}".`,
          severity: 'high',
          certainty: 'confirmed',
          anchors: [],
        });
      }
    }
  }

  return findings;
}

export function convertSemanticFindingsToDiagnosticFindings(
  semanticFindings: readonly SemanticDiagnosticFinding[],
  fallbackTargetId = 'project',
  scopeKey = 'semantic'
): DiagnosticFinding[] {
  return semanticFindings.map((f, idx) => {
    const targetIds: string[] = [];
    if (f.targetId && f.targetId.trim()) targetIds.push(f.targetId.trim());
    if (f.storyField) targetIds.push(`story_bible:${f.storyField}`);
    if (f.sectionId && f.sectionId.trim()) targetIds.push(f.sectionId.trim());
    const deduped = Array.from(new Set(targetIds));
    return {
      detectorId: 'semantic-ai',
      scopeKey,
      type: `semantic:${f.category}:${f.title.slice(0, 48).toLowerCase().replace(/[^a-z0-9]+/g, '_') || idx}`,
      targetIds: deduped.length > 0 ? deduped : [fallbackTargetId],
      title: f.title,
      reason: f.description,
      severity: f.severity === 'error' ? 'high' : 'medium',
      certainty: f.certainty === 'confirmed' ? 'confirmed' : f.certainty === 'inferred' ? 'likely' : 'possible',
      anchors: [],
    };
  });
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

  let nextIssues: NarrativeIssue[];
  if (options.fullScan && options.source === 'local') {
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
        scopeLabel: options.scopeLabel,
        updatedAt: action.issue.updatedAt ?? now,
      });
    }
    nextIssues = Array.from(byId.values());
  } else {
    // Partial or semantic-ai scan: merge/update matched fingerprints without discarding unrelated existing findings
    const byFp = new Map(records.issues.map((i) => [i.fingerprint, i]));
    const updated = new Map(records.issues.map((i) => [i.id, i]));
    for (const finding of findings) {
      const fp = diagnosticFingerprint(finding.detectorId, finding.type, finding.targetIds, finding.scopeKey);
      const existing = byFp.get(fp);
      if (existing) {
        const targets = [...finding.targetIds];
        if (existing.title === finding.title && existing.reason === finding.reason &&
            existing.severity === finding.severity && existing.certainty === finding.certainty &&
            existing.freshness === 'current' && existing.scopeLabel === options.scopeLabel &&
            existing.disposition !== 'resolved' &&
            JSON.stringify(existing.affectedTargetIds) === JSON.stringify(targets)) continue;
        const reopened = existing.disposition === 'resolved';
        updated.set(existing.id, {
          ...existing,
          title: finding.title,
          reason: finding.reason,
          severity: finding.severity,
          certainty: finding.certainty,
          affectedTargetIds: [...finding.targetIds],
          freshness: 'current',
          source: options.source,
          detectedAtRevision: baseProject.revision,
          scopeLabel: options.scopeLabel,
          updatedAt: now,
          ...(reopened ? { disposition: 'open' as const } : {}),
        });
      } else {
        const id = `issue:${fp}`;
        updated.set(id, {
          id,
          fingerprint: fp,
          title: finding.title,
          reason: finding.reason,
          disposition: 'open',
          freshness: 'current',
          severity: finding.severity,
          certainty: finding.certainty,
          source: options.source,
          detectedAtRevision: baseProject.revision,
          scopeLabel: options.scopeLabel,
          anchors: [...finding.anchors],
          affectedTargetIds: [...finding.targetIds],
          updatedAt: now,
          history: [],
        });
      }
    }
    nextIssues = Array.from(updated.values());
  }

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
  const alts: DiagnosticFixAlternative[] = [];
  const targets = issue.affectedTargetIds ?? [];

  // 1. Excluded entity still marked Present vs listed in Explicit Exclusions
  const entityTarget = project.snapshot.entities.find((e) => e.id && targets.includes(e.id));
  if (entityTarget && targets.includes('story_bible:explicitExclusions') && !entityTarget.excluded) {
    alts.push({
      id: makeStableId('fix_excl_absent'),
      title: `Mark "${entityTarget.name}" as Excluded (Absent)`,
      reason: `Aligns the Belief Graph with Explicit Exclusions so "${entityTarget.name}" is excluded from prompt synthesis and AI context.`,
      assumptions: ['Assumes you intend to keep this entity excluded from the story.'],
      evidenceSummary: `Explicit Exclusions currently lists "${entityTarget.name}".`,
      affectedScope: `Entity "${entityTarget.name}"`,
      kind: 'entity_exclude',
      entityId: entityTarget.id,
      beforeText: `${entityTarget.name}: Present (active in graph)`,
      afterText: `${entityTarget.name}: Excluded (Absent)`,
    });
    const currentExcl = project.snapshot.storyBible.explicitExclusions.value;
    const filteredExcl = currentExcl
      .split(',')
      .map((s) => s.trim())
      .filter((s) => s && s.toLowerCase() !== entityTarget.name.toLowerCase())
      .join(', ');
    alts.push({
      id: makeStableId('fix_excl_bible'),
      title: `Remove "${entityTarget.name}" from Explicit Exclusions`,
      reason: `Keeps "${entityTarget.name}" active in the Belief Graph and removes it from the Story Bible exclusion list.`,
      assumptions: ['Assumes you intend to keep this entity in the story.'],
      evidenceSummary: `Graph entity "${entityTarget.name}" is currently marked Present.`,
      affectedScope: 'Story Bible → Explicit Exclusions',
      kind: 'story_bible',
      storyField: 'explicitExclusions',
      beforeText: currentExcl || '(empty)',
      afterText: filteredExcl || '(none)',
    });
  }

  // 2. Setting mismatch between Story Bible and confirmed Location entity
  if (targets.includes('story_bible:setting')) {
    const loc = project.snapshot.entities.find(
      (e) => e.id && targets.includes(e.id) && e.category === 'location' && !e.excluded
    );
    if (loc) {
      alts.push({
        id: makeStableId('fix_setting_bible'),
        title: `Update Story Bible Setting to "${loc.name}"`,
        reason: `Aligns the Story Bible setting field with the confirmed Location node "${loc.name}".`,
        assumptions: [`Assumes "${loc.name}" is the primary setting for this project.`],
        evidenceSummary: `Confirmed location entity "${loc.name}" exists in the Belief Graph.`,
        affectedScope: 'Story Bible → Setting',
        kind: 'story_bible',
        storyField: 'setting',
        beforeText: project.snapshot.storyBible.setting.value || '(empty)',
        afterText: loc.name,
      });
    }
  }

  // 3. Excluded entity mentioned in a manuscript section
  if (entityTarget && entityTarget.excluded) {
    const sections = manuscriptSections(project);
    const matchingSection = sections.find((s) => targets.includes(s.id));
    if (matchingSection) {
      alts.push({
        id: makeStableId('fix_unexclude'),
        title: `Restore "${entityTarget.name}" to Active in Belief Graph`,
        reason: `If "${entityTarget.name}" belongs in "${matchingSection.title || 'this scene'}", mark the entity active again.`,
        assumptions: ['Assumes the manuscript mention is intentional and the exclusion was accidental.'],
        evidenceSummary: `Section "${matchingSection.title || matchingSection.id}" mentions "${entityTarget.name}".`,
        affectedScope: `Entity "${entityTarget.name}"`,
        kind: 'entity_attribute',
        entityId: entityTarget.id,
        attributeName: 'existence',
        beforeText: 'Excluded (false)',
        afterText: 'true',
      });
    }
  }

  return alts.slice(0, 3);
}

export interface AppliedFixResult {
  project: CreativeProject;
  undoState: UndoRedoState;
  appliedSummary: string;
  residualOpenCount: number;
  issueResolved: boolean;
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
  let updatedProject: CreativeProject = ensureNarrativeEnvelope(project);
  let updatedUndo = undoState;

  if (alternative.kind === 'manuscript_patch') {
    if (!alternative.sectionId) throw new Error('Fix alternative is missing a target section ID.');
    const sections = manuscriptSections(updatedProject);
    const targetIndex = sections.findIndex((s) => s.id === alternative.sectionId);
    if (targetIndex < 0) throw new Error('Target manuscript section no longer exists.');
    const section = sections[targetIndex];
    const matchIndex = section.text.indexOf(alternative.beforeText);
    if (!alternative.beforeText || matchIndex < 0) {
      throw new Error('The target manuscript excerpt has changed since this fix was previewed. Re-preview before applying.');
    }
    const nextText =
      section.text.slice(0, matchIndex) +
      alternative.afterText +
      section.text.slice(matchIndex + alternative.beforeText.length);
    const nextSections = sections.map((s, idx) => (idx === targetIndex ? { ...s, text: nextText } : s));
    const prepared = prepareManuscriptChange(
      updatedProject,
      updatedUndo,
      narrativeBase(updatedProject),
      nextSections
    );
    if (!prepared) throw new Error('No manuscript change was produced by this fix.');
    updatedProject = prepared.project;
    updatedUndo = prepared.undoState;
  } else {
    let nextSnapshot = structuredClone(updatedProject.snapshot);
    if (!nextSnapshot.storyBible) nextSnapshot.storyBible = createEmptyStoryBible(now);

    if (alternative.kind === 'story_bible') {
      if (!alternative.storyField || !(alternative.storyField in nextSnapshot.storyBible)) {
        throw new Error('Target Story Bible field is invalid.');
      }
      const nextVal = alternative.afterText === '(none)' ? '' : alternative.afterText;
      nextSnapshot = updateStoryBibleField(nextSnapshot, alternative.storyField, nextVal);
    } else if (alternative.kind === 'entity_exclude') {
      const entity = nextSnapshot.entities.find((e) => e.id === alternative.entityId);
      if (!entity) throw new Error('Target entity no longer exists.');
      nextSnapshot = setEntityAttribute(nextSnapshot, entity.id ?? entity.name, 'existence', 'false');
    } else if (alternative.kind === 'entity_attribute') {
      const entity = nextSnapshot.entities.find((e) => e.id === alternative.entityId);
      if (!entity) throw new Error('Target entity no longer exists.');
      const attrName = alternative.attributeName || 'description';
      if (attrName === 'description') {
        nextSnapshot = {
          ...nextSnapshot,
          entities: nextSnapshot.entities.map((e) =>
            e.id === entity.id ? { ...e, description: alternative.afterText, provenance: 'user-edit' } : e
          ),
        };
      } else {
        nextSnapshot = setEntityAttribute(nextSnapshot, entity.id ?? entity.name, attrName, alternative.afterText);
      }
    } else if (alternative.kind === 'relationship_update') {
      const rel = nextSnapshot.relationships.find((r) => r.id === alternative.relationshipId);
      if (!rel) throw new Error('Target relationship no longer exists.');
      nextSnapshot = {
        ...nextSnapshot,
        relationships: nextSnapshot.relationships.map((r) =>
          r.id === rel.id ? { ...r, label: alternative.afterText, status: 'confirmed', provenance: 'user-edit' } : r
        ),
      };
    }

    const committed = commitSnapshotTransaction(
      updatedProject,
      updatedUndo,
      nextSnapshot,
      `Apply Fix: ${alternative.title}`,
      alternative.reason,
      1
    );
    updatedProject = committed.project;
    updatedUndo = committed.undoState;
  }

  // Post-apply deterministic recheck: never falsely mark residual issues resolved
  const postFindings = collectLocalDiagnosticFindings(updatedProject);
  const rechecked = syncDiagnosticFindingsIntoProject(updatedProject, postFindings, {
    source: 'local',
    scopeLabel: 'Post-fix recheck',
    fullScan: true,
    now,
  });

  const existingIssue = rechecked.narrative!.issues.find((i) => i.id === issueId);
  const stillOpenByRecheck = existingIssue
    ? postFindings.some(
        (f) => diagnosticFingerprint(f.detectorId, f.type, f.targetIds, f.scopeKey) === existingIssue.fingerprint
      )
    : false;

  const finalIssues = rechecked.narrative!.issues.map((item) => {
    if (item.id !== issueId) return item;
    if (stillOpenByRecheck) {
      return {
        ...item,
        disposition: 'open' as const,
        freshness: 'current' as const,
        updatedAt: now,
      };
    }
    return {
      ...item,
      disposition: 'resolved' as const,
      dispositionReason: `Applied fix: ${alternative.title}`,
      freshness: 'current' as const,
      updatedAt: now,
      history: [
        ...(item.history ?? []),
        {
          disposition: 'resolved' as const,
          time: now,
          reason: `Applied fix: ${alternative.title}`,
          projectRevision: rechecked.revision,
        },
      ],
    };
  });

  const finalProject: CreativeProject = {
    ...rechecked,
    narrative: {
      ...rechecked.narrative!,
      issues: finalIssues,
      audit: [
        ...rechecked.narrative!.audit,
        {
          id: makeStableId('audit_fix'),
          action: 'fix',
          time: now,
          baseRevision: expectedBaseRevision,
          resultRevision: rechecked.revision,
          issueId,
          reason: `Applied fix "${alternative.title}": ${alternative.reason}`,
        },
      ],
    },
  };

  const residualOpenCount = finalIssues.filter((i) => i.disposition === 'open').length;
  return {
    project: finalProject,
    undoState: updatedUndo,
    appliedSummary: `Applied "${alternative.title}" (Rev #${finalProject.revision}).`,
    residualOpenCount,
    issueResolved: !stillOpenByRecheck,
  };
}
