/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { inferEntityCategory, isSceneEntityName } from './beliefGraphUtils.ts';
import { makeStableId } from './canonical/ids.ts';
import {
  finalizeSnapshotInPlace,
  mutateAddEntityInPlace,
  mutateEntityAttributeInPlace,
  mutateEntityExistenceInPlace,
  mutateRemoveRelationshipInPlace,
  mutateRenameEntityInPlace,
  mutateUpdateStoryBibleFieldInPlace,
  mutateUpsertRelationshipInPlace,
} from './canonical/mutators.ts';
import { parseSingleClause } from './nlBatch/clauseParsers.ts';
import { validateProposedOperations } from './nlBatch/operationValidation.ts';
import type {
  BatchEditAmbiguity,
  BatchEditProposalResult,
  BatchInstructionClause,
  BatchValidationIssue,
  ProjectSnapshot,
  ProposedOperation,
  StoryBibleFields,
} from '../shared/types.ts';

export { validateProposedOperations };

function detectContradictions(operations: ProposedOperation[], warnings: string[]): void {
  const targetValues = new Map<string, string>();
  for (const op of operations) {
    if (op.type === 'set_attribute' && op.entityName && op.attributeName && op.nextValue) {
      const key = `${op.entityName.toLowerCase()}::${op.attributeName.toLowerCase()}`;
      const prior = targetValues.get(key);
      if (prior && prior.toLowerCase() !== op.nextValue.toLowerCase()) {
        const msg = `Contradictory edits for ${op.entityName} → ${op.attributeName}: "${prior}" vs "${op.nextValue}".`;
        op.conflictWarning = msg;
        if (!warnings.includes(msg)) warnings.push(msg);
      }
      targetValues.set(key, op.nextValue);
    }
  }
}

/**
 * Deterministic local natural-language batch instruction interpreter.
 * Parses multi-clause creative instructions into structured ProposedOperations,
 * resolves group memberships ("all animal guests", "all characters except the cat"),
 * detects pronoun and partial-name ambiguities ("make him older"), flags contradictions,
 * and explicitly reports unhandled clauses so no instruction segment is silently dropped.
 */
export function interpretBatchInstructionLocally(
  instruction: string,
  snapshot: ProjectSnapshot,
  baseMeta?: { projectId?: string; revision?: number }
): BatchEditProposalResult {
  const trimmed = instruction.trim();
  const operations: ProposedOperation[] = [];
  const ambiguities: BatchEditAmbiguity[] = [];
  const warnings: string[] = [];
  const clauses: BatchInstructionClause[] = [];
  const unhandledClauses: string[] = [];

  if (!trimmed) {
    return {
      proposalId: makeStableId('batch_prop'),
      instruction: trimmed,
      operations,
      ambiguities,
      warnings,
      clauses,
      unhandledClauses,
      coverageComplete: false,
      baseProjectId: baseMeta?.projectId,
      baseRevision: baseMeta?.revision,
    };
  }

  const activeEntities = snapshot.entities.filter(
    (e) => !isSceneEntityName(e.name) && e.category !== 'scene' && !e.excluded && e.status !== 'rejected'
  );
  const characterEntities = activeEntities.filter(
    (e) => inferEntityCategory(e) === 'character'
  );

  const sentences = trimmed
    .split(/(?:\.\s+|\n+|;\s*)/)
    .map((s) => s.replace(/[.!?]+$/, '').trim())
    .filter(Boolean);

  let clauseSeq = 1;

  for (const sentence of sentences) {
    const subClauses = sentence
      .split(
        /,\s*but\s+|\s+and\s+(?=(?:make|keep|introduce|add|remove|exclude|delete|omit|change|set|move|rename|relate|connect|link|have)\b)/i
      )
      .map((c) => c.trim())
      .filter(Boolean);

    for (const rawClause of subClauses) {
      const clauseId = `clause_${clauseSeq++}`;
      const opsBefore = operations.length;
      const ambBefore = ambiguities.length;

      parseSingleClause(
        rawClause,
        clauseId,
        snapshot,
        activeEntities,
        characterEntities,
        operations,
        ambiguities
      );

      const producedOps = operations.slice(opsBefore);
      const producedAmb = ambiguities.slice(ambBefore);

      if (producedOps.length > 0) {
        for (const op of producedOps) {
          op.clauseId = clauseId;
          op.clauseText = rawClause;
        }
        clauses.push({
          id: clauseId,
          text: rawClause,
          status: 'parsed',
          operationIds: producedOps.map((op) => op.id),
        });
      } else if (producedAmb.length > 0) {
        clauses.push({
          id: clauseId,
          text: rawClause,
          status: 'ambiguous',
          operationIds: [],
          reason: producedAmb[0].reason,
        });
      } else {
        unhandledClauses.push(rawClause);
        const warningMsg = `Unhandled instruction clause: "${rawClause}" could not be mapped to a valid entity, attribute, relationship, or Story Bible field.`;
        if (!warnings.includes(warningMsg)) {
          warnings.push(warningMsg);
        }
        clauses.push({
          id: clauseId,
          text: rawClause,
          status: 'unhandled',
          operationIds: [],
          reason: 'Could not map this clause to a known entity, attribute, relationship, or Story Bible field.',
        });
      }
    }
  }

  detectContradictions(operations, warnings);

  const coverageComplete =
    operations.length > 0 && unhandledClauses.length === 0 && ambiguities.length === 0;

  return {
    proposalId: makeStableId('batch_prop'),
    instruction: trimmed,
    operations,
    ambiguities,
    warnings,
    clauses,
    unhandledClauses,
    coverageComplete,
    baseProjectId: baseMeta?.projectId,
    baseRevision: baseMeta?.revision,
  };
}

function applySingleOperationInPlace(next: ProjectSnapshot, op: ProposedOperation): boolean {
  switch (op.type) {
    case 'set_attribute':
    case 'add_attribute': {
      const targetRef = op.entityId ?? op.entityName;
      if (targetRef && op.attributeName && op.nextValue !== undefined) {
        mutateEntityAttributeInPlace(next, targetRef, op.attributeName, op.nextValue, 'user-edit');
        return true;
      }
      return false;
    }
    case 'add_entity':
      if (op.entityName) {
        mutateAddEntityInPlace(
          next,
          op.entityName,
          op.entityCategory ?? 'character',
          op.nextValue ?? '',
          'user-edit'
        );
        return true;
      }
      return false;
    case 'rename_entity': {
      const targetRef = op.entityId ?? op.entityName;
      if (targetRef && op.newEntityName) {
        mutateRenameEntityInPlace(next, targetRef, op.newEntityName, 'user-edit');
        return true;
      }
      return false;
    }
    case 'exclude_entity': {
      const targetRef = op.entityId ?? op.entityName;
      if (targetRef) {
        mutateEntityExistenceInPlace(next, targetRef, false, 'user-edit');
        return true;
      }
      return false;
    }
    case 'add_relationship':
    case 'update_relationship':
      if (op.sourceEntityName && op.targetEntityName && op.nextValue) {
        mutateUpsertRelationshipInPlace(
          next,
          op.sourceEntityName,
          op.targetEntityName,
          op.nextValue,
          'user-edit',
          { relationshipId: op.relationshipId }
        );
        return true;
      }
      return false;
    case 'remove_relationship':
      if (op.relationshipId) {
        mutateRemoveRelationshipInPlace(next, op.relationshipId);
        return true;
      }
      if (op.sourceEntityName && op.targetEntityName) {
        mutateRemoveRelationshipInPlace(next, op.sourceEntityName, op.targetEntityName);
        return true;
      }
      return false;
    case 'update_story_bible':
      if (op.storyField && op.nextValue !== undefined) {
        mutateUpdateStoryBibleFieldInPlace(
          next,
          op.storyField as keyof StoryBibleFields,
          op.nextValue,
          'user-edit'
        );
        return true;
      }
      return false;
  }
}

/**
 * Applies all selected ProposedOperations as a single atomic transaction on a ProjectSnapshot.
 * Pre-validates every selected operation; if any operation is invalid, stale, or conflicting,
 * aborts with zero partial mutations.
 */
export function applyProposedOperations(
  snapshot: ProjectSnapshot,
  operations: ProposedOperation[],
  options?: {
    expectedProjectId?: string;
    currentProjectId?: string;
    expectedBaseRevision?: number;
    currentRevision?: number;
  }
): { snapshot: ProjectSnapshot; appliedCount: number; errors: BatchValidationIssue[] } {
  const selectedOps = operations.filter((op) => op.selected);
  if (selectedOps.length === 0) {
    return { snapshot, appliedCount: 0, errors: [] };
  }

  const errors = validateProposedOperations(snapshot, operations, options);
  if (errors.length > 0) {
    return { snapshot, appliedCount: 0, errors };
  }

  const next = structuredClone(snapshot);
  let appliedCount = 0;

  for (const op of selectedOps) {
    if (applySingleOperationInPlace(next, op)) {
      appliedCount++;
    }
  }

  finalizeSnapshotInPlace(next);
  return { snapshot: next, appliedCount, errors: [] };
}
