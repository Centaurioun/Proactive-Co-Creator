/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { applyDecisionBatch } from '../canonicalModel.ts';
import { applyProposedOperations } from '../nlBatchEngine.ts';
import { synthesizeRefinedPrompt } from '../promptBuilder.ts';
import { validatePolishProposalAcceptance } from './aiTicketCoordinator.ts';
import type {
  AiPolishProposal,
  BatchEditProposalResult,
  CreativeProject,
  DecisionItem,
  ProjectSnapshot,
  ReviewDiffItem,
} from '../../shared/types.ts';

function resolveDecisionBeforeValue(snapshot: ProjectSnapshot, dec: DecisionItem): string {
  if (dec.targetStoryField) {
    const field = snapshot.storyBible[dec.targetStoryField];
    return field?.status === 'confirmed' && field.value.trim() ? field.value.trim() : 'Unspecified';
  }
  if (dec.targetEntityName && dec.targetAttributeName) {
    const ent = snapshot.entities.find(
      (e) =>
        e.id === dec.targetEntityId ||
        e.name.toLowerCase() === dec.targetEntityName!.toLowerCase()
    );
    const attr = ent?.attributes.find(
      (a) => a.name.toLowerCase() === dec.targetAttributeName!.toLowerCase()
    );
    return attr?.status === 'confirmed' && attr.confirmedValue ? attr.confirmedValue : 'Unconfirmed';
  }
  if (dec.category === 'relationship') {
    const rel = snapshot.relationships.find((r) => r.id === dec.targetRelationshipId);
    return rel?.status === 'confirmed' ? rel.label : 'Unconfirmed (Pending)';
  }
  return dec.currentValue ?? 'Unspecified';
}

function resolveDecisionTargetLabel(dec: DecisionItem): string {
  if (dec.targetStoryField) {
    return `Story Bible · ${dec.targetStoryField}`;
  }
  if (dec.targetEntityName && dec.targetAttributeName) {
    return `${dec.targetEntityName} · ${dec.targetAttributeName}`;
  }
  if (dec.targetSourceEntityName && dec.targetTargetEntityName) {
    return `Relationship · ${dec.targetSourceEntityName} → ${dec.targetTargetEntityName}`;
  }
  return dec.title;
}

function collectPendingDecisionDiffs(
  snapshot: ProjectSnapshot,
  selectedDecisionIds: string[] | undefined,
  draftDecisionValues: Record<string, string>
): { items: ReviewDiffItem[]; simulatedSnapshot: ProjectSnapshot; targetCount: number } {
  const pendingDecisions = snapshot.decisions.filter((d) => d.status === 'pending');
  const targetDecisions =
    selectedDecisionIds && selectedDecisionIds.length > 0
      ? pendingDecisions.filter((d) => selectedDecisionIds.includes(d.id))
      : pendingDecisions;

  const items: ReviewDiffItem[] = targetDecisions.map((dec) => ({
    id: dec.id,
    source: 'decision',
    category: dec.category,
    targetLabel: resolveDecisionTargetLabel(dec),
    beforeValue: resolveDecisionBeforeValue(snapshot, dec),
    afterValue: draftDecisionValues[dec.id] ?? dec.proposedValue,
    provenance: dec.provenance,
    conflictWarning: dec.conflictWith,
  }));

  let simulatedSnapshot = structuredClone(snapshot);
  if (targetDecisions.length > 0) {
    const appliedDec = applyDecisionBatch(
      simulatedSnapshot,
      targetDecisions.map((d) => d.id),
      'accept',
      draftDecisionValues
    );
    simulatedSnapshot = appliedDec.snapshot;
  }

  return { items, simulatedSnapshot, targetCount: targetDecisions.length };
}

function collectStagedBatchDiffs(
  projectId: string,
  currentRevision: number,
  simulatedSnapshot: ProjectSnapshot,
  stagedBatch: BatchEditProposalResult | null
): { items: ReviewDiffItem[]; simulatedSnapshot: ProjectSnapshot; hasStaleBatch: boolean } {
  const isStagedBatchForProject = Boolean(
    stagedBatch && (stagedBatch.baseProjectId === undefined || stagedBatch.baseProjectId === projectId)
  );
  const isStagedBatchRevisionStale = Boolean(
    isStagedBatchForProject &&
      stagedBatch?.baseRevision !== undefined &&
      stagedBatch.baseRevision !== currentRevision
  );

  if (!stagedBatch || !isStagedBatchForProject) {
    return { items: [], simulatedSnapshot, hasStaleBatch: isStagedBatchRevisionStale };
  }

  const selectedOps = stagedBatch.operations.filter((o) => o.selected);
  const staleWarning = isStagedBatchRevisionStale
    ? `Stale batch preview: generated at revision r${stagedBatch.baseRevision}, current revision is r${currentRevision}. Re-preview before applying.`
    : undefined;

  const items: ReviewDiffItem[] = selectedOps.map((op) => {
    const targetLabel =
      op.type === 'update_story_bible'
        ? `Story Bible · ${op.storyField ?? 'field'}`
        : op.type === 'add_relationship' ||
            op.type === 'update_relationship' ||
            op.type === 'remove_relationship'
          ? `Relationship · ${op.sourceEntityName ?? '?'} → ${op.targetEntityName ?? '?'}`
          : `${op.entityName ?? 'Entity'}${op.attributeName ? ` · ${op.attributeName}` : ''}`;

    return {
      id: op.id,
      source: 'batch-preview',
      category: op.type,
      targetLabel,
      beforeValue: op.previousValue ?? 'Unspecified',
      afterValue: op.nextValue ?? op.newEntityName ?? (op.type === 'exclude_entity' ? 'Absent' : ''),
      provenance: 'user-edit',
      conflictWarning: op.conflictWarning ?? staleWarning,
    };
  });

  let nextSnapshot = simulatedSnapshot;
  if (selectedOps.length > 0 && !isStagedBatchRevisionStale) {
    const appliedBatch = applyProposedOperations(simulatedSnapshot, selectedOps);
    if (appliedBatch.errors.length === 0) {
      nextSnapshot = appliedBatch.snapshot;
    }
  }

  return {
    items,
    simulatedSnapshot: nextSnapshot,
    hasStaleBatch: isStagedBatchRevisionStale,
  };
}

function collectPolishProposalDiff(
  project: CreativeProject,
  polishProposal: AiPolishProposal | null,
  hasPendingDecisions: boolean,
  hasStagedBatch: boolean
): { item: ReviewDiffItem | null; overrideAfterPrompt: string | null } {
  if (
    !polishProposal ||
    polishProposal.projectId !== project.id ||
    polishProposal.isNoOp ||
    !polishProposal.polishedPrompt.trim()
  ) {
    return { item: null, overrideAfterPrompt: null };
  }

  const isStale = !validatePolishProposalAcceptance(project, polishProposal).ok;
  const item: ReviewDiffItem = {
    id: polishProposal.requestId ?? 'polish_proposal',
    source: 'ai-polish',
    category: 'ai-polish',
    targetLabel: 'Refined Generation Prompt (AI Polish)',
    beforeValue: polishProposal.originalPrompt,
    afterValue: polishProposal.polishedPrompt,
    provenance: 'accepted-suggestion',
    conflictWarning: isStale
      ? 'Stale proposal: project state changed since this AI Polish was drafted.'
      : undefined,
  };

  return {
    item,
    overrideAfterPrompt:
      !isStale && !hasPendingDecisions && !hasStagedBatch
        ? polishProposal.polishedPrompt.trim()
        : null,
  };
}

/**
 * Builds a structured Before/After diff model for the Review Plan & Prompt Changes modal (U-01).
 * Pure read-model simulation — never mutates the durable project or snapshot.
 */
export function buildReviewDiffModel(params: {
  project: CreativeProject;
  selectedDecisionIds?: string[];
  draftDecisionValues?: Record<string, string>;
  stagedBatch?: BatchEditProposalResult | null;
  polishProposal?: AiPolishProposal | null;
}): {
  projectId: string;
  revision: number;
  items: ReviewDiffItem[];
  beforePrompt: string;
  afterPrompt: string;
  hasChanges: boolean;
  hasStaleBatch: boolean;
} {
  const {
    project,
    selectedDecisionIds,
    draftDecisionValues = {},
    stagedBatch = null,
    polishProposal = null,
  } = params;
  const { snapshot } = project;
  const currentRevision = project.revision ?? 1;

  const decisionDiff = collectPendingDecisionDiffs(snapshot, selectedDecisionIds, draftDecisionValues);
  const batchDiff = collectStagedBatchDiffs(
    project.id,
    currentRevision,
    decisionDiff.simulatedSnapshot,
    stagedBatch
  );

  let afterPrompt = synthesizeRefinedPrompt(batchDiff.simulatedSnapshot, snapshot.mode);
  const polishDiff = collectPolishProposalDiff(
    project,
    polishProposal,
    decisionDiff.targetCount > 0,
    Boolean(stagedBatch)
  );

  const items: ReviewDiffItem[] = [
    ...decisionDiff.items,
    ...batchDiff.items,
    ...(polishDiff.item ? [polishDiff.item] : []),
  ];

  if (polishDiff.overrideAfterPrompt !== null) {
    afterPrompt = polishDiff.overrideAfterPrompt;
  }

  const beforePrompt = snapshot.refinedPrompt;
  return {
    projectId: project.id,
    revision: currentRevision,
    items,
    beforePrompt,
    afterPrompt,
    hasChanges: items.length > 0 || beforePrompt !== afterPrompt,
    hasStaleBatch: batchDiff.hasStaleBatch,
  };
}
