/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import type { DurableWriteOptions } from './storage/constants.ts';
import { recordNarrativeChange } from './narrative/changeAudit.ts';
import { makeStableId } from './canonicalModel.ts';
import {
  performRedo,
  performUndo,
  pushCoalescedTransaction,
  pushUndoableTransaction,
  recordProjectRevision,
  serializeUndoHistory,
  type UndoRedoState,
} from './historyEngine.ts';
import { applyProposedOperations } from './nlBatchEngine.ts';
import {
  getDeletedProjectIds,
  type StorageSaveResult,
} from './storageEngine.ts';
import { refreshArtifactsCurrentness } from './controller/aiTicketCoordinator.ts';
import type {
  BatchCommitResult,
  BatchEditProposalResult,
  CreativeProject,
  ProjectSnapshot,
} from '../shared/types.ts';

export {
  acceptAiPolishProposal,
  acceptPolishProposal,
  applyAsyncAnalysisCompletion,
  applyAsyncGenerationCompletion,
  applyGuardedAsyncAnalysisCompletion,
  applyGuardedAsyncGenerationCompletion,
  clearAiRequestTicket,
  clearTicket,
  createAiTicketAuthority,
  createPolishProposal,
  createRequestTicket,
  isProjectActionLoading,
  isTicketCurrent,
  issueAiRequestTicket,
  makeTicketSlotKey,
  reconcileAsyncAnalysisResponse,
  reconcileAsyncBatchEditResponse,
  reconcileAsyncGenerationResponse,
  reconcileAsyncPolishResponse,
  refreshArtifactsCurrentness,
  registerTicket,
  runAsyncAnalysisSlot,
  runAsyncClarifySlot,
  runAsyncGenerationSlot,
  validatePolishProposalAcceptance,
  type AiTicketAuthority,
  type AsyncAnalysisCompletionParams,
  type AsyncAnalysisCompletionResult,
  type AsyncAnalysisSlotRunParams,
  type AsyncClarifySlotRunParams,
  type AsyncGenerationCompletionParams,
  type AsyncGenerationCompletionResult,
  type AsyncGenerationSlotRunParams,
  type InFlightTicketsMap,
  type PolishAcceptanceValidation,
} from './controller/aiTicketCoordinator.ts';

export { buildReviewDiffModel } from './controller/reviewDiffModel.ts';

export {
  prepareProjectSwitch,
  reconcileAsyncSaveAcknowledgement,
  resolveHydrationWriteGate,
  shouldAllowUnsolicitedPersistence,
  upsertProjectInSavedList,
  type HydrationWriteGate,
} from './controller/projectListSync.ts';

export function commitSnapshotTransaction(
  project: CreativeProject,
  undoState: UndoRedoState,
  nextSnapshot: ProjectSnapshot,
  label: string,
  summary: string = label,
  changeCount: number = 1,
  options?: { coalesceKey?: string; coalesceWindowMs?: number; nowMs?: number }
): { project: CreativeProject; undoState: UndoRedoState } {
  project = appendAuthoredAttributeClaims(project, nextSnapshot);
  const nextUndoState = options?.coalesceKey
    ? pushCoalescedTransaction(
        undoState,
        nextSnapshot,
        label,
        options.coalesceKey,
        options.coalesceWindowMs
      ).state
    : pushUndoableTransaction(undoState, nextSnapshot, label);

  const refreshedArtifacts = refreshArtifactsCurrentness(project.artifacts, nextSnapshot);
  const nextProject = recordProjectRevision(
    {
      ...project,
      snapshot: nextSnapshot,
      artifacts: refreshedArtifacts,
      undoHistory: serializeUndoHistory(nextUndoState),
    },
    label,
    summary,
    changeCount,
    {
      coalesceKey: options?.coalesceKey,
      windowMs: options?.coalesceWindowMs,
    }
  );

  return {
    project: nextProject,
    undoState: nextUndoState,
  };
}

export function appendAuthoredAttributeClaims(
  project: CreativeProject,
  nextSnapshot: ProjectSnapshot
): CreativeProject {
  const records = project.narrative;
  if (!records) return project;
  const claims = records.claims.slice();
  const beforeEntitiesById = new Map(project.snapshot.entities.map((entity) => [entity.id, entity]));
  let changed = false;

  for (const nextEntity of nextSnapshot.entities) {
    const beforeEntity = beforeEntitiesById.get(nextEntity.id);
    if (!beforeEntity) continue;
    const beforeAttrsById = new Map(beforeEntity.attributes.map((attr) => [attr.id, attr]));

    for (const nextAttribute of nextEntity.attributes) {
      const attributeId = nextAttribute.id;
      const beforeAttribute = attributeId ? beforeAttrsById.get(attributeId) : undefined;
      if (
        !attributeId ||
        !beforeAttribute ||
        (!beforeAttribute.sourceBacked && !beforeAttribute.epistemicKind) ||
        nextAttribute.epistemicKind !== 'user-authored' ||
        (beforeAttribute.confirmedValue ?? '') === (nextAttribute.confirmedValue ?? '')
      ) {
        continue;
      }
      const sourceClaim = claims.find(
        (claim) => claim.targetId === attributeId && claim.epistemicKind === beforeAttribute.epistemicKind
      );
      if (
        !sourceClaim ||
        claims.some(
          (claim) =>
            claim.supersedesClaimId === sourceClaim.id &&
            claim.authoredText === (nextAttribute.confirmedValue ?? '')
        )
      ) {
        continue;
      }
      claims.push({
        id: makeStableId('claim_author'),
        targetId: attributeId,
        rationale: 'User-authored replacement; original imported evidence remains attached to its historical source claim.',
        approval: 'confirmed',
        freshness: 'current',
        anchors: structuredClone(sourceClaim.anchors),
        epistemicKind: 'user-authored',
        authoredText: nextAttribute.confirmedValue ?? '',
        supersedesClaimId: sourceClaim.id,
      });
      changed = true;
    }
  }
  return changed ? { ...project, narrative: { ...records, claims } } : project;
}

function buildBatchErrorResult(
  project: CreativeProject,
  undoState: UndoRedoState,
  reason: Extract<BatchCommitResult, { ok: false }>['reason'],
  message: string,
  errors: Extract<BatchCommitResult, { ok: false }>['errors']
) {
  return {
    project,
    undoState,
    result: {
      ok: false as const,
      reason,
      message,
      errors,
    },
  };
}

/**
 * Commits a staged natural-language batch preview against the authoritative project state.
 */
export function commitBatchPreviewToProject(params: {
  project: CreativeProject;
  undoState: UndoRedoState;
  preview: BatchEditProposalResult;
  appliedProposalIds?: Set<string> | ReadonlySet<string> | string[];
}): {
  project: CreativeProject;
  undoState: UndoRedoState;
  result: BatchCommitResult;
} {
  const { project, undoState, preview, appliedProposalIds } = params;

  const appliedSet =
    appliedProposalIds instanceof Set
      ? appliedProposalIds
      : new Set(appliedProposalIds ?? []);

  if (preview.proposalId && appliedSet.has(preview.proposalId)) {
    const msg = 'This batch preview has already been applied.';
    return buildBatchErrorResult(project, undoState, 'ALREADY_APPLIED', msg, [
      { code: 'ALREADY_APPLIED', message: msg },
    ]);
  }

  if (preview.baseProjectId !== undefined && preview.baseProjectId !== project.id) {
    const msg = `Batch preview was created for project "${preview.baseProjectId}", but the active project is "${project.name}" (${project.id}). Switch back or click Re-preview for this project.`;
    return buildBatchErrorResult(project, undoState, 'WRONG_PROJECT', msg, [
      { operationId: 'batch_project', code: 'WRONG_PROJECT', message: msg },
    ]);
  }

  const currentRev = project.revision ?? 1;
  if (preview.baseRevision !== undefined && preview.baseRevision !== currentRev) {
    const msg = `Batch preview is stale: it was generated at revision r${preview.baseRevision}, while this project is now at revision r${currentRev}. Click Re-preview to recalculate against the latest state.`;
    return buildBatchErrorResult(project, undoState, 'STALE_REVISION', msg, [
      { operationId: 'batch_base', code: 'STALE_BASE', message: msg },
    ]);
  }

  const selectedOps = preview.operations.filter((op) => op.selected);
  if (selectedOps.length === 0) {
    return buildBatchErrorResult(
      project,
      undoState,
      'NO_SELECTED_OPERATIONS',
      'Select at least one proposed operation to apply.',
      []
    );
  }

  const applied = applyProposedOperations(project.snapshot, preview.operations, {
    expectedProjectId: preview.baseProjectId,
    currentProjectId: project.id,
    expectedBaseRevision: preview.baseRevision,
    currentRevision: currentRev,
  });

  if (applied.errors.length > 0) {
    return buildBatchErrorResult(
      project,
      undoState,
      'VALIDATION_FAILED',
      applied.errors[0].message,
      applied.errors
    );
  }

  if (preview.proposalId && appliedProposalIds instanceof Set) {
    appliedProposalIds.add(preview.proposalId);
  }

  const committed = commitSnapshotTransaction(
    project,
    undoState,
    applied.snapshot,
    `Batch Edit (${applied.appliedCount} ops)`,
    `Applied natural-language batch edit: "${preview.instruction}"`,
    applied.appliedCount
  );

  return {
    project: committed.project,
    undoState: committed.undoState,
    result: {
      ok: true,
      appliedCount: applied.appliedCount,
      revision: committed.project.revision,
      proposalId: preview.proposalId,
    },
  };
}

function commitHistoryCursorStep(
  project: CreativeProject,
  undoState: UndoRedoState,
  direction: 'undo' | 'redo'
): {
  project: CreativeProject;
  undoState: UndoRedoState;
  label: string | null;
  changed: boolean;
} {
  const stepResult = direction === 'undo' ? performUndo(undoState) : performRedo(undoState);
  const label = direction === 'undo'
    ? (stepResult as { undoneLabel: string | null }).undoneLabel
    : (stepResult as { redoneLabel: string | null }).redoneLabel;
  if (!label) {
    return { project, undoState, label: null, changed: false };
  }

  const nextUndoState = stepResult.state;
  const nextSnapshot = nextUndoState.present;
  const refreshedArtifacts = refreshArtifactsCurrentness(project.artifacts, nextSnapshot);
  const verb = direction === 'undo' ? 'Undo' : 'Redo';
  const pastVerb = direction === 'undo' ? 'Undid' : 'Redid';
  const nextProject = recordProjectRevision(
    {
      ...project,
      snapshot: nextSnapshot,
      artifacts: refreshedArtifacts,
      undoHistory: serializeUndoHistory(nextUndoState),
    },
    `${verb}: ${label}`,
    `${pastVerb} "${label}"`,
    1
  );

  return {
    project: recordNarrativeChange(project, nextProject, direction, label),
    undoState: nextUndoState,
    label,
    changed: true,
  };
}

export function commitUndoTransaction(
  project: CreativeProject,
  undoState: UndoRedoState
): {
  project: CreativeProject;
  undoState: UndoRedoState;
  undoneLabel: string | null;
  changed: boolean;
} {
  const res = commitHistoryCursorStep(project, undoState, 'undo');
  return {
    project: res.project,
    undoState: res.undoState,
    undoneLabel: res.label,
    changed: res.changed,
  };
}

export function commitRedoTransaction(
  project: CreativeProject,
  undoState: UndoRedoState
): {
  project: CreativeProject;
  undoState: UndoRedoState;
  redoneLabel: string | null;
  changed: boolean;
} {
  const res = commitHistoryCursorStep(project, undoState, 'redo');
  return {
    project: res.project,
    undoState: res.undoState,
    redoneLabel: res.label,
    changed: res.changed,
  };
}

export type SerializedSaveOptions = DurableWriteOptions;

/**
 * Serializes durable save operations per project ID so rapid switch flushes and
 * subsequent edits on the same project execute in strict FIFO order and pass
 * updated expectedPersistedRevision values cleanly.
 */
export function createSerializedProjectSaveQueue(
  persistFn: (
    project: CreativeProject,
    options?: SerializedSaveOptions
  ) => Promise<StorageSaveResult>
) {
  const chains = new Map<string, Promise<StorageSaveResult>>();
  const lastCommittedRevisions = new Map<string, number>();
  const projectGenerations = new Map<string, number>();

  const enqueue = (
    project: CreativeProject,
    options?: SerializedSaveOptions
  ): Promise<StorageSaveResult> => {
    const previous = chains.get(project.id) ?? Promise.resolve({ ok: true, saved: true });

    const run = previous
      .catch(() => ({ ok: false, saved: false } as StorageSaveResult))
      .then(async () => {
        if (!options?.allowDeleted && getDeletedProjectIds().has(project.id)) {
          return {
            ok: false,
            saved: false,
            error: `Project "${project.id}" was deleted before queued save executed.`,
          };
        }

        const generation = projectGenerations.get(project.id) ?? 0;
        const lastKnown = lastCommittedRevisions.get(project.id);
        const rawExpected = options?.expectedPersistedRevision ?? project.persistedRevision;
        const effectiveExpected =
          lastKnown !== undefined && !options?.requireExactBase
            ? Math.max(rawExpected ?? 0, lastKnown)
            : rawExpected;

        const res = await persistFn(project, {
          ...options,
          expectedPersistedRevision: effectiveExpected,
        });

        if (res.saved && (projectGenerations.get(project.id) ?? 0) === generation) {
          const committedRev = res.persistedRevision ?? (project.revision ?? 1);
          lastCommittedRevisions.set(
            project.id,
            Math.max(lastCommittedRevisions.get(project.id) ?? 0, committedRev)
          );
        }
        return res;
      });

    chains.set(project.id, run);
    const releaseChain = () => {
      if (chains.get(project.id) === run) {
        chains.delete(project.id);
      }
    };
    void run.then(releaseChain, releaseChain);
    return run;
  };

  const resetProject = (projectId: string) => {
    lastCommittedRevisions.delete(projectId);
    projectGenerations.set(projectId, (projectGenerations.get(projectId) ?? 0) + 1);
  };

  return {
    enqueue,
    resetProject,
  };
}
