import {
  addEntity,
  makeStableId,
  setEntityAttribute,
  updateStoryBibleField,
  upsertRelationship,
} from '../../canonicalModel.ts';
import type { UndoRedoState } from '../../historyEngine.ts';
import { commitSnapshotTransaction } from '../../projectController.ts';
import type { CreativeProject } from '../../../shared/types.ts';
import type {
  SyncManuscriptPatch,
  SyncModelProposal,
} from '../../../shared/narrativeAiSchemas.ts';
import { ensureNarrativeEnvelope } from '../diagnostics/engine.ts';
import { manuscriptSections, narrativeBase, prepareManuscriptChange } from '../manuscriptModel.ts';

export interface SyncFreshnessStatus {
  hasManuscript: boolean;
  lastReviewedRevision: number | null;
  lastReviewedAt: number | null;
  lastDirection: 'manuscript-to-model' | 'model-to-manuscript' | null;
  revisionsSinceReview: number;
  statusLabel: string;
  coverageNote: string;
}

export function computeSyncFreshness(project: CreativeProject): SyncFreshnessStatus {
  const sections = manuscriptSections(project);
  const syncState = project.narrative?.syncState;
  const lastRev = syncState?.lastReviewedRevision ?? null;
  const revisionsSinceReview = lastRev !== null ? Math.max(0, project.revision - lastRev) : project.revision;

  if (sections.length === 0) {
    return {
      hasManuscript: false,
      lastReviewedRevision: lastRev,
      lastReviewedAt: syncState?.lastReviewedAt ?? null,
      lastDirection: syncState?.lastDirection ?? null,
      revisionsSinceReview,
      statusLabel: 'No working manuscript sections yet',
      coverageNote: 'Create or import manuscript scenes in Write before running Manuscript ↔ Model sync.',
    };
  }

  if (lastRev === null) {
    return {
      hasManuscript: true,
      lastReviewedRevision: null,
      lastReviewedAt: null,
      lastDirection: null,
      revisionsSinceReview,
      statusLabel: `Unreviewed (${sections.length} section${sections.length === 1 ? '' : 's'})`,
      coverageNote: 'Explicitly run Manuscript → Model or Model → Manuscript sync to review candidate updates.',
    };
  }

  if (revisionsSinceReview === 0) {
    return {
      hasManuscript: true,
      lastReviewedRevision: lastRev,
      lastReviewedAt: syncState?.lastReviewedAt ?? null,
      lastDirection: syncState?.lastDirection ?? null,
      revisionsSinceReview: 0,
      statusLabel: `Last reviewed at Rev #${lastRev}`,
      coverageNote: syncState?.coverageNote ?? 'Scoped review completed at the current revision (never claims global synchronization).',
    };
  }

  return {
    hasManuscript: true,
    lastReviewedRevision: lastRev,
    lastReviewedAt: syncState?.lastReviewedAt ?? null,
    lastDirection: syncState?.lastDirection ?? null,
    revisionsSinceReview,
    statusLabel: `Needs re-review (${revisionsSinceReview} revision${revisionsSinceReview === 1 ? '' : 's'} since Rev #${lastRev})`,
    coverageNote: 'Changes were committed after the last scoped sync review. Run a targeted sync pass when ready.',
  };
}

export function recordSyncReviewCheckpoint(
  project: CreativeProject,
  direction: 'manuscript-to-model' | 'model-to-manuscript',
  coverageNote: string,
  now: number = Date.now()
): CreativeProject {
  const ensured = ensureNarrativeEnvelope(project);
  return {
    ...ensured,
    persistedRevision: undefined,
    narrative: {
      ...ensured.narrative!,
      syncState: {
        lastReviewedRevision: ensured.revision,
        lastReviewedAt: now,
        lastDirection: direction,
        coverageNote,
      },
    },
  };
}

/**
 * Applies ONE reviewed Manuscript -> Model sync proposal without ever deleting omitted facts.
 */
export function applyModelSyncProposal(
  project: CreativeProject,
  undoState: UndoRedoState,
  proposal: SyncModelProposal,
  expectedBaseRevision: number
): { project: CreativeProject; undoState: UndoRedoState; summary: string } {
  if (project.revision !== expectedBaseRevision) {
    throw new Error('The project revision changed since this sync proposal was generated. Re-run sync before applying.');
  }
  if (proposal.kind === 'ambiguity') {
    throw new Error('Ambiguity proposals require manual clarification and cannot be auto-applied.');
  }

  let nextSnapshot = structuredClone(project.snapshot);

  if (proposal.kind === 'add_entity') {
    const name = (proposal.entityName || proposal.proposedValue).trim();
    if (!name) throw new Error('Proposed entity name is empty.');
    nextSnapshot = addEntity(
      nextSnapshot,
      name,
      proposal.entityCategory ?? 'character',
      proposal.proposedValue || proposal.rationale
    );
  } else if (proposal.kind === 'update_attribute') {
    const entity =
      nextSnapshot.entities.find((e) => proposal.entityId && e.id === proposal.entityId) ??
      nextSnapshot.entities.find(
        (e) => proposal.entityName && e.name.toLowerCase() === proposal.entityName.toLowerCase()
      );
    if (!entity) throw new Error(`Target entity "${proposal.entityName ?? proposal.entityId ?? 'unknown'}" was not found.`);
    const attrName = (proposal.attributeName || 'note').trim();
    nextSnapshot = setEntityAttribute(nextSnapshot, entity.id ?? entity.name, attrName, proposal.proposedValue);
  } else if (proposal.kind === 'add_relationship') {
    if (!proposal.sourceEntityName || !proposal.targetEntityName) {
      throw new Error('Relationship proposal requires both source and target entities.');
    }
    nextSnapshot = upsertRelationship(
      nextSnapshot,
      proposal.sourceEntityName,
      proposal.targetEntityName,
      proposal.proposedValue
    );
  } else if (proposal.kind === 'update_story_bible') {
    if (!proposal.storyField || !(proposal.storyField in nextSnapshot.storyBible)) {
      throw new Error('Invalid Story Bible field in sync proposal.');
    }
    nextSnapshot = updateStoryBibleField(nextSnapshot, proposal.storyField, proposal.proposedValue);
  }

  const now = Date.now();
  const committed = commitSnapshotTransaction(
    ensureNarrativeEnvelope(project),
    undoState,
    nextSnapshot,
    `Sync Model: ${proposal.title}`,
    proposal.rationale,
    1
  );

  const nextProject: CreativeProject = {
    ...committed.project,
    narrative: {
      ...committed.project.narrative!,
      syncState: {
        lastReviewedRevision: committed.project.revision,
        lastReviewedAt: now,
        lastDirection: 'manuscript-to-model',
        coverageNote: `Applied proposal "${proposal.title}".`,
      },
      audit: [
        ...committed.project.narrative!.audit,
        {
          id: makeStableId('audit_sync'),
          action: 'sync',
          time: now,
          baseRevision: expectedBaseRevision,
          resultRevision: committed.project.revision,
          reason: `Manuscript → Model sync: ${proposal.title}`,
        },
      ],
    },
  };

  return {
    project: nextProject,
    undoState: committed.undoState,
    summary: `Applied model update "${proposal.title}".`,
  };
}

export interface BoundManuscriptPatchCheck {
  ok: boolean;
  start?: number;
  end?: number;
  sectionTitle?: string;
  reason?: string;
}

/**
 * Validates that a Model -> Manuscript patch still matches the exact section text unambiguously.
 */
export function validateManuscriptPatchBinding(
  project: CreativeProject,
  patch: SyncManuscriptPatch
): BoundManuscriptPatchCheck {
  const sections = manuscriptSections(project);
  const section = sections.find((s) => s.id === patch.sectionId);
  if (!section) {
    return { ok: false, reason: 'Target manuscript section no longer exists.' };
  }
  if (!patch.originalExcerpt) {
    return { ok: false, reason: 'Patch is missing its verbatim original excerpt.' };
  }
  const firstIdx = section.text.indexOf(patch.originalExcerpt);
  if (firstIdx < 0) {
    return {
      ok: false,
      sectionTitle: section.title,
      reason: 'The target passage changed since this patch was previewed. Re-run Sync Manuscript before applying.',
    };
  }
  const secondIdx = section.text.indexOf(patch.originalExcerpt, firstIdx + 1);
  if (secondIdx >= 0) {
    return {
      ok: false,
      sectionTitle: section.title,
      reason: 'The original excerpt appears multiple times in this section and cannot be replaced unambiguously.',
    };
  }
  return {
    ok: true,
    start: firstIdx,
    end: firstIdx + patch.originalExcerpt.length,
    sectionTitle: section.title,
  };
}

/**
 * Applies ONE validated Model -> Manuscript patch bound to exact project revision,
 * manuscriptVersionId, and verbatim excerpt span.
 */
export function applyManuscriptSyncPatch(
  project: CreativeProject,
  undoState: UndoRedoState,
  patch: SyncManuscriptPatch,
  expectedBaseRevision: number,
  expectedManuscriptVersionId?: string
): { project: CreativeProject; undoState: UndoRedoState; summary: string } {
  if (project.revision !== expectedBaseRevision) {
    throw new Error('Project revision changed since this manuscript patch was generated. Re-run Sync Manuscript.');
  }
  if (
    expectedManuscriptVersionId !== undefined &&
    (project.snapshot.manuscriptVersionId ?? '') !== expectedManuscriptVersionId
  ) {
    throw new Error('The working manuscript was edited since this patch was previewed. Re-run Sync Manuscript.');
  }
  const binding = validateManuscriptPatchBinding(project, patch);
  if (!binding.ok || binding.start === undefined || binding.end === undefined) {
    throw new Error(binding.reason ?? 'Patch could not be bound to the current manuscript.');
  }

  const sections = manuscriptSections(project);
  const nextSections = sections.map((section) => {
    if (section.id !== patch.sectionId) return section;
    const nextText =
      section.text.slice(0, binding.start!) +
      patch.proposedExcerpt +
      section.text.slice(binding.end!);
    return { ...section, text: nextText };
  });

  const prepared = prepareManuscriptChange(
    ensureNarrativeEnvelope(project),
    undoState,
    narrativeBase(project),
    nextSections
  );
  if (!prepared) {
    throw new Error('The patch resulted in no manuscript change.');
  }

  const now = Date.now();
  const nextProject: CreativeProject = {
    ...prepared.project,
    narrative: {
      ...prepared.project.narrative!,
      syncState: {
        lastReviewedRevision: prepared.project.revision,
        lastReviewedAt: now,
        lastDirection: 'model-to-manuscript',
        coverageNote: `Applied scoped patch to "${patch.sectionTitle}".`,
      },
      audit: [
        ...prepared.project.narrative!.audit,
        {
          id: makeStableId('audit_sync_ms'),
          action: 'sync',
          time: now,
          baseRevision: expectedBaseRevision,
          resultRevision: prepared.project.revision,
          reason: `Model → Manuscript patch in "${patch.sectionTitle}": ${patch.linkedModelChange}`,
        },
      ],
    },
  };

  return {
    project: nextProject,
    undoState: prepared.undoState,
    summary: `Applied manuscript patch in "${patch.sectionTitle}".`,
  };
}
