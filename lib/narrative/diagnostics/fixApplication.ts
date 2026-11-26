import {
  createEmptyStoryBible,
  makeStableId,
  setEntityAttribute,
  updateStoryBibleField,
} from '../../canonicalModel.ts';
import { commitSnapshotTransaction } from '../../projectController.ts';
import type { UndoRedoState } from '../../historyEngine.ts';
import type {
  CreativeProject,
  Entity,
  ProjectSnapshot,
} from '../../../shared/types.ts';
import type { DiagnosticFixAlternative } from '../../../shared/narrativeAiSchemas.ts';
import type { NarrativeIssue } from '../../../shared/narrativeTypes.ts';
import { manuscriptSections, narrativeBase, prepareManuscriptChange } from '../manuscriptModel.ts';
import { diagnosticFingerprint, type DiagnosticFinding } from './findings.ts';

export interface AppliedFixResult {
  project: CreativeProject;
  undoState: UndoRedoState;
  appliedSummary: string;
  residualOpenCount: number;
  issueResolved: boolean;
}

function buildExclusionAlternatives(
  project: CreativeProject,
  entityTarget: Entity
): DiagnosticFixAlternative[] {
  const currentExcl = project.snapshot.storyBible.explicitExclusions.value;
  const filteredExcl = currentExcl
    .split(',')
    .map((s) => s.trim())
    .filter((s) => s && s.toLowerCase() !== entityTarget.name.toLowerCase())
    .join(', ');

  return [
    {
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
    },
    {
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
    },
  ];
}

function buildSettingAlternative(
  project: CreativeProject,
  targets: readonly string[]
): DiagnosticFixAlternative | null {
  if (!targets.includes('story_bible:setting')) return null;
  const loc = project.snapshot.entities.find(
    (e) => e.id && targets.includes(e.id) && e.category === 'location' && !e.excluded
  );
  if (!loc) return null;
  return {
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
  };
}

function buildManuscriptExclusionAlternative(
  project: CreativeProject,
  entityTarget: Entity,
  targets: readonly string[]
): DiagnosticFixAlternative | null {
  if (!entityTarget.excluded) return null;
  const matchingSection = manuscriptSections(project).find((s) => targets.includes(s.id));
  if (!matchingSection) return null;
  return {
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
  };
}

export function buildLocalFixAlternativesList(
  project: CreativeProject,
  issue: Pick<NarrativeIssue, 'id' | 'title' | 'reason' | 'affectedTargetIds'>
): DiagnosticFixAlternative[] {
  const alts: DiagnosticFixAlternative[] = [];
  const targets = issue.affectedTargetIds ?? [];
  const entityTarget = project.snapshot.entities.find((e) => e.id && targets.includes(e.id));

  if (entityTarget && targets.includes('story_bible:explicitExclusions') && !entityTarget.excluded) {
    alts.push(...buildExclusionAlternatives(project, entityTarget));
  }

  const settingAlt = buildSettingAlternative(project, targets);
  if (settingAlt) alts.push(settingAlt);

  if (entityTarget) {
    const manuscriptAlt = buildManuscriptExclusionAlternative(project, entityTarget, targets);
    if (manuscriptAlt) alts.push(manuscriptAlt);
  }

  return alts.slice(0, 3);
}

export function applyManuscriptPatchAlternative(
  project: CreativeProject,
  undoState: UndoRedoState,
  alternative: DiagnosticFixAlternative
): { project: CreativeProject; undoState: UndoRedoState } {
  if (!alternative.sectionId) throw new Error('Fix alternative is missing a target section ID.');
  const sections = manuscriptSections(project);
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
    project,
    undoState,
    narrativeBase(project),
    nextSections
  );
  if (!prepared) throw new Error('No manuscript change was produced by this fix.');
  return { project: prepared.project, undoState: prepared.undoState };
}

function applyStoryBibleFix(
  snapshot: ProjectSnapshot,
  alternative: DiagnosticFixAlternative
): ProjectSnapshot {
  if (!alternative.storyField || !(alternative.storyField in snapshot.storyBible)) {
    throw new Error('Target Story Bible field is invalid.');
  }
  const nextVal = alternative.afterText === '(none)' ? '' : alternative.afterText;
  return updateStoryBibleField(snapshot, alternative.storyField, nextVal);
}

function applyEntityExcludeFix(
  snapshot: ProjectSnapshot,
  alternative: DiagnosticFixAlternative
): ProjectSnapshot {
  const entityId = alternative.entityId?.trim();
  if (!entityId) throw new Error('Fix alternative is missing a target entity ID.');
  const entity = snapshot.entities.find((e) => e.id === entityId);
  if (!entity) throw new Error('Target entity no longer exists.');
  return setEntityAttribute(snapshot, entityId, 'existence', 'false');
}

function applyEntityAttributeFix(
  snapshot: ProjectSnapshot,
  alternative: DiagnosticFixAlternative
): ProjectSnapshot {
  const entityId = alternative.entityId?.trim();
  if (!entityId) throw new Error('Fix alternative is missing a target entity ID.');
  const entity = snapshot.entities.find((e) => e.id === entityId);
  if (!entity) throw new Error('Target entity no longer exists.');
  const attrName = alternative.attributeName || 'description';
  if (attrName !== 'description') {
    return setEntityAttribute(snapshot, entityId, attrName, alternative.afterText);
  }
  return {
    ...snapshot,
    entities: snapshot.entities.map((e) =>
      e.id === entityId ? { ...e, description: alternative.afterText, provenance: 'user-edit' } : e
    ),
  };
}

function applyRelationshipFix(
  snapshot: ProjectSnapshot,
  alternative: DiagnosticFixAlternative
): ProjectSnapshot {
  const relationshipId = alternative.relationshipId?.trim();
  if (!relationshipId) throw new Error('Fix alternative is missing a target relationship ID.');
  const rel = snapshot.relationships.find((r) => r.id === relationshipId);
  if (!rel) throw new Error('Target relationship no longer exists.');
  return {
    ...snapshot,
    relationships: snapshot.relationships.map((r) =>
      r.id === relationshipId
        ? { ...r, label: alternative.afterText, status: 'confirmed', provenance: 'user-edit' }
        : r
    ),
  };
}

const SNAPSHOT_FIX_HANDLERS: Partial<
  Record<
    DiagnosticFixAlternative['kind'],
    (snapshot: ProjectSnapshot, alternative: DiagnosticFixAlternative) => ProjectSnapshot
  >
> = {
  story_bible: applyStoryBibleFix,
  entity_exclude: applyEntityExcludeFix,
  entity_attribute: applyEntityAttributeFix,
  relationship_update: applyRelationshipFix,
};

export function applySnapshotFixAlternative(
  project: CreativeProject,
  undoState: UndoRedoState,
  alternative: DiagnosticFixAlternative,
  now: number
): { project: CreativeProject; undoState: UndoRedoState } {
  let nextSnapshot = structuredClone(project.snapshot);
  if (!nextSnapshot.storyBible) nextSnapshot.storyBible = createEmptyStoryBible(now);

  const handler = SNAPSHOT_FIX_HANDLERS[alternative.kind];
  if (handler) {
    nextSnapshot = handler(nextSnapshot, alternative);
  }

  return commitSnapshotTransaction(
    project,
    undoState,
    nextSnapshot,
    `Apply Fix: ${alternative.title}`,
    alternative.reason,
    1
  );
}

export function finalizeAppliedFixResult(params: {
  rechecked: CreativeProject;
  postFindings: readonly DiagnosticFinding[];
  undoState: UndoRedoState;
  issueId: string;
  alternative: DiagnosticFixAlternative;
  expectedBaseRevision: number;
  now: number;
}): AppliedFixResult {
  const { rechecked, postFindings, undoState, issueId, alternative, expectedBaseRevision, now } = params;
  const existingIssue = rechecked.narrative!.issues.find((i) => i.id === issueId);
  const stillOpenByRecheck = existingIssue
    ? postFindings.some(
        (f) => diagnosticFingerprint(f.detectorId, f.type, f.targetIds, f.scopeKey) === existingIssue.fingerprint
      )
    : false;

  const finalIssues = rechecked.narrative!.issues.map((item) => {
    if (item.id !== issueId) return item;
    if (stillOpenByRecheck) {
      return { ...item, disposition: 'open' as const, freshness: 'current' as const, updatedAt: now };
    }
    const reason = `Applied fix: ${alternative.title}`;
    return {
      ...item,
      disposition: 'resolved' as const,
      dispositionReason: reason,
      freshness: 'current' as const,
      updatedAt: now,
      history: [
        ...(item.history ?? []),
        { disposition: 'resolved' as const, time: now, reason, projectRevision: rechecked.revision },
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

  return {
    project: finalProject,
    undoState,
    appliedSummary: `Applied "${alternative.title}" (Rev #${finalProject.revision}).`,
    residualOpenCount: finalIssues.filter((i) => i.disposition === 'open').length,
    issueResolved: !stillOpenByRecheck,
  };
}
