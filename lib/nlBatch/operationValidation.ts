/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import type {
  BatchValidationIssue,
  ProjectSnapshot,
  ProposedOperation,
} from '../../shared/types.ts';

interface SimEntity {
  batchKey: string;
  id: string | undefined;
  name: string;
  aliases: string[];
  excluded: boolean;
  rejected: boolean;
}

interface SimRelationship {
  id?: string;
  sourceId?: string;
  targetId?: string;
  source: string;
  target: string;
  label: string;
}

interface ValidationState {
  issues: BatchValidationIssue[];
  simulatedEntities: SimEntity[];
  simulatedRelationships: SimRelationship[];
  seenAttrTargets: Map<string, string>;
  excludedEntityKeys: Set<string>;
}

function getEntityBatchKey(ent: SimEntity): string {
  return ent.batchKey;
}

function findSimulatedEntity(simulatedEntities: SimEntity[], ref?: string): SimEntity | undefined {
  if (!ref) return undefined;
  const norm = ref.trim().toLowerCase();
  return simulatedEntities.find(
    (e) =>
      e.id === ref ||
      e.name.trim().toLowerCase() === norm ||
      e.aliases.some((a) => a.trim().toLowerCase() === norm)
  );
}

function pushIssue(
  state: ValidationState,
  operationId: string,
  code: BatchValidationIssue['code'],
  message: string
): void {
  state.issues.push({ operationId, code, message });
}

function validateAddEntityOp(op: ProposedOperation, state: ValidationState): void {
  const trimmed = op.entityName?.trim();
  if (!trimmed) {
    pushIssue(state, op.id, 'INVALID_VALUE', 'Add entity operation requires a non-empty entityName.');
    return;
  }

  const existing = findSimulatedEntity(state.simulatedEntities, trimmed);
  if (existing) {
    existing.excluded = false;
    existing.rejected = false;
    state.excludedEntityKeys.delete(getEntityBatchKey(existing));
    return;
  }

  const simId = op.entityId ?? `sim_${op.id}`;
  state.simulatedEntities.push({
    batchKey: simId,
    id: simId,
    name: trimmed,
    aliases: [],
    excluded: false,
    rejected: false,
  });
}

function validateAttributeOp(op: ProposedOperation, state: ValidationState): void {
  const targetRef = op.entityId ?? op.entityName;
  const ent = findSimulatedEntity(state.simulatedEntities, targetRef);
  if (!ent || ent.rejected || (ent.excluded && !state.excludedEntityKeys.has(getEntityBatchKey(ent)))) {
    pushIssue(
      state,
      op.id,
      'MISSING_TARGET',
      `Target entity "${op.entityName ?? op.entityId ?? 'Unknown'}" does not exist or is excluded in the current snapshot.`
    );
    return;
  }

  const attrName = op.attributeName?.trim();
  const nextVal = op.nextValue?.trim();
  if (!attrName || !nextVal) {
    pushIssue(
      state,
      op.id,
      'INVALID_VALUE',
      `Attribute operation on "${ent.name}" requires both attributeName and nextValue.`
    );
    return;
  }

  const entKey = getEntityBatchKey(ent);
  if (state.excludedEntityKeys.has(entKey)) {
    pushIssue(
      state,
      op.id,
      'CONFLICT',
      `Cannot set attribute "${op.attributeName}" on "${ent.name}" because the same batch excludes "${ent.name}".`
    );
    return;
  }

  const attrKey = `${entKey}::${attrName.toLowerCase()}`;
  const priorVal = state.seenAttrTargets.get(attrKey);
  if (priorVal && priorVal.toLowerCase() !== nextVal.toLowerCase()) {
    pushIssue(
      state,
      op.id,
      'CONFLICT',
      `Conflicting values for ${ent.name} → ${op.attributeName} in the same batch: "${priorVal}" vs "${nextVal}".`
    );
  }
  state.seenAttrTargets.set(attrKey, nextVal);
}

function validateRenameEntityOp(op: ProposedOperation, state: ValidationState): void {
  const targetRef = op.entityId ?? op.entityName;
  const ent = findSimulatedEntity(state.simulatedEntities, targetRef);
  if (!ent || ent.excluded || ent.rejected) {
    pushIssue(
      state,
      op.id,
      'MISSING_TARGET',
      `Entity "${op.entityName ?? op.entityId ?? 'Unknown'}" cannot be renamed because it does not exist or is excluded.`
    );
    return;
  }

  const newName = op.newEntityName?.trim();
  if (!newName) {
    pushIssue(
      state,
      op.id,
      'INVALID_VALUE',
      `Rename operation for "${ent.name}" requires a non-empty newEntityName.`
    );
    return;
  }

  const oldName = ent.name;
  const oldLower = oldName.toLowerCase();
  ent.aliases.push(oldName);
  ent.name = newName;

  for (const rel of state.simulatedRelationships) {
    if ((Boolean(ent.id) && rel.sourceId === ent.id) || rel.source.toLowerCase() === oldLower) {
      rel.sourceId = ent.id;
      rel.source = newName;
    }
    if ((Boolean(ent.id) && rel.targetId === ent.id) || rel.target.toLowerCase() === oldLower) {
      rel.targetId = ent.id;
      rel.target = newName;
    }
  }
}

function validateExcludeEntityOp(op: ProposedOperation, state: ValidationState): void {
  const targetRef = op.entityId ?? op.entityName;
  const ent = findSimulatedEntity(state.simulatedEntities, targetRef);
  if (!ent || ent.rejected) {
    pushIssue(
      state,
      op.id,
      'MISSING_TARGET',
      `Entity "${op.entityName ?? op.entityId ?? 'Unknown'}" cannot be excluded because it does not exist in the current snapshot.`
    );
    return;
  }

  const entKey = getEntityBatchKey(ent);
  for (const key of state.seenAttrTargets.keys()) {
    if (key.startsWith(`${entKey}::`)) {
      pushIssue(
        state,
        op.id,
        'CONFLICT',
        `Cannot exclude "${ent.name}" in the same batch that modifies its attributes.`
      );
      break;
    }
  }

  ent.excluded = true;
  state.excludedEntityKeys.add(entKey);
}

function isEntityAvailable(ent: SimEntity | undefined): ent is SimEntity {
  return Boolean(ent && !ent.excluded && !ent.rejected);
}

function validateUpsertRelationshipOp(op: ProposedOperation, state: ValidationState): void {
  const srcEnt = findSimulatedEntity(state.simulatedEntities, op.sourceEntityName);
  const tgtEnt = findSimulatedEntity(state.simulatedEntities, op.targetEntityName);
  if (!isEntityAvailable(srcEnt)) {
    pushIssue(
      state,
      op.id,
      'MISSING_TARGET',
      `Relationship source entity "${op.sourceEntityName ?? 'Unknown'}" does not exist or is excluded.`
    );
  }
  if (!isEntityAvailable(tgtEnt)) {
    pushIssue(
      state,
      op.id,
      'MISSING_TARGET',
      `Relationship target entity "${op.targetEntityName ?? 'Unknown'}" does not exist or is excluded.`
    );
  }

  const label = op.nextValue?.trim();
  if (!label) {
    pushIssue(state, op.id, 'INVALID_VALUE', 'Relationship operation requires a non-empty label.');
    return;
  }
  if (isEntityAvailable(srcEnt) && isEntityAvailable(tgtEnt)) {
    state.simulatedRelationships.push({
      id: op.relationshipId ?? `sim_rel_${op.id}`,
      sourceId: srcEnt.id,
      targetId: tgtEnt.id,
      source: srcEnt.name,
      target: tgtEnt.name,
      label,
    });
  }
}

function validateRemoveByEndpoints(op: ProposedOperation, state: ValidationState): void {
  const srcEnt = findSimulatedEntity(state.simulatedEntities, op.sourceEntityName);
  const tgtEnt = findSimulatedEntity(state.simulatedEntities, op.targetEntityName);
  const sLower = (srcEnt?.name ?? op.sourceEntityName!).trim().toLowerCase();
  const tLower = (tgtEnt?.name ?? op.targetEntityName!).trim().toLowerCase();
  const matches = (r: SimRelationship) => {
    const srcMatches = (srcEnt?.id && r.sourceId === srcEnt.id) || r.source.toLowerCase() === sLower;
    const tgtMatches = (tgtEnt?.id && r.targetId === tgtEnt.id) || r.target.toLowerCase() === tLower;
    return srcMatches && tgtMatches;
  };

  if (!state.simulatedRelationships.some(matches)) {
    pushIssue(
      state,
      op.id,
      'MISSING_TARGET',
      `Directed relationship from "${op.sourceEntityName}" to "${op.targetEntityName}" does not exist.`
    );
    return;
  }
  state.simulatedRelationships = state.simulatedRelationships.filter((r) => !matches(r));
}

function validateRemoveRelationshipOp(op: ProposedOperation, state: ValidationState): void {
  if (op.relationshipId) {
    const idx = state.simulatedRelationships.findIndex((r) => r.id === op.relationshipId);
    if (idx < 0) {
      pushIssue(
        state,
        op.id,
        'MISSING_TARGET',
        `Relationship "${op.relationshipId}" does not exist in the current snapshot.`
      );
    } else {
      state.simulatedRelationships.splice(idx, 1);
    }
    return;
  }

  if (op.sourceEntityName && op.targetEntityName) {
    validateRemoveByEndpoints(op, state);
    return;
  }

  pushIssue(
    state,
    op.id,
    'MISSING_TARGET',
    'Remove relationship operation is missing target relationship identifiers.'
  );
}

function checkBatchHeaderIssues(
  options:
    | {
        expectedProjectId?: string;
        currentProjectId?: string;
        expectedBaseRevision?: number;
        currentRevision?: number;
      }
    | undefined
): BatchValidationIssue[] {
  const issues: BatchValidationIssue[] = [];
  if (
    options?.expectedProjectId !== undefined &&
    options?.currentProjectId !== undefined &&
    options.expectedProjectId !== options.currentProjectId
  ) {
    issues.push({
      operationId: 'batch_project',
      code: 'WRONG_PROJECT',
      message: `Batch proposal was drafted for project "${options.expectedProjectId}", but active project is "${options.currentProjectId}". Switch back or re-preview for this project.`,
    });
  }

  if (
    options?.expectedBaseRevision !== undefined &&
    options?.currentRevision !== undefined &&
    options.expectedBaseRevision !== options.currentRevision
  ) {
    issues.push({
      operationId: 'batch_base',
      code: 'STALE_BASE',
      message: `Batch proposal was built against revision r${options.expectedBaseRevision}, but project is now at revision r${options.currentRevision}.`,
    });
  }
  return issues;
}

const OP_VALIDATORS: Partial<
  Record<ProposedOperation['type'], (op: ProposedOperation, state: ValidationState) => void>
> = {
  add_entity: validateAddEntityOp,
  set_attribute: validateAttributeOp,
  add_attribute: validateAttributeOp,
  rename_entity: validateRenameEntityOp,
  exclude_entity: validateExcludeEntityOp,
  add_relationship: validateUpsertRelationshipOp,
  update_relationship: validateUpsertRelationshipOp,
  remove_relationship: validateRemoveRelationshipOp,
  update_story_bible: (op, state) => {
    if (!op.storyField || !op.nextValue?.trim()) {
      pushIssue(
        state,
        op.id,
        'INVALID_VALUE',
        'Story Bible update operation requires a valid storyField and non-empty nextValue.'
      );
    }
  },
};

/**
 * Pre-validates all selected ProposedOperations against the target snapshot and optional revision.
 */
export function validateProposedOperations(
  snapshot: ProjectSnapshot,
  operations: ProposedOperation[],
  options?: {
    expectedProjectId?: string;
    currentProjectId?: string;
    expectedBaseRevision?: number;
    currentRevision?: number;
  }
): BatchValidationIssue[] {
  const state: ValidationState = {
    issues: checkBatchHeaderIssues(options),
    simulatedEntities: snapshot.entities.map((e, idx) => ({
      batchKey: e.id || `__idx_${idx}`,
      id: e.id,
      name: e.name,
      aliases: [...(e.aliases ?? [])],
      excluded: Boolean(e.excluded),
      rejected: e.status === 'rejected',
    })),
    simulatedRelationships: snapshot.relationships.map((r) => ({
      id: r.id,
      sourceId: r.sourceId,
      targetId: r.targetId,
      source: r.source,
      target: r.target,
      label: r.label,
    })),
    seenAttrTargets: new Map<string, string>(),
    excludedEntityKeys: new Set<string>(),
  };

  for (const op of operations) {
    if (!op.selected) continue;
    OP_VALIDATORS[op.type]?.(op, state);
  }

  return state.issues;
}
