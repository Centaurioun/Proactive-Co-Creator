import { CreativeProject } from '../../../shared/types';
import {
  CreativeLock,
  CreativeLockHardness,
  CreativeLockScope,
  CreativeLockTargetKind,
  ProposalConflictDiagnostic,
  UnifiedManuscriptHunk,
  UnifiedModelOperation,
} from '../../../shared/unifiedProposalTypes';
import { normalizeUnicodeText } from '../memory/textNormalization';

export interface CreateCreativeLockInput {
  projectId: string;
  scope?: CreativeLockScope;
  hardness: CreativeLockHardness;
  targetKind: CreativeLockTargetKind;
  targetId?: string;
  targetLabel: string;
  attributeKey?: string;
  expectedValue?: string;
  forbidMutation?: boolean;
  ruleText: string;
}

export function createCreativeLockRecord(input: CreateCreativeLockInput): CreativeLock {
  const now = Date.now();
  return {
    id: `lock_${now}_${Math.random().toString(36).slice(2, 8)}`,
    projectId: input.projectId,
    scope: input.scope ?? 'project',
    hardness: input.hardness,
    targetKind: input.targetKind,
    targetId: input.targetId?.trim() || undefined,
    targetLabel: input.targetLabel.trim() || 'Custom Lock',
    attributeKey: input.attributeKey?.trim() || undefined,
    expectedValue: input.expectedValue?.trim() || undefined,
    forbidMutation: input.forbidMutation ?? true,
    ruleText: input.ruleText.trim() || `Protect ${input.targetLabel}`,
    active: true,
    version: 1,
    createdAt: now,
    updatedAt: now,
  };
}

export function listProjectCreativeLocks(project: CreativeProject): CreativeLock[] {
  return project.narrative?.creativeLocks ?? [];
}

export function upsertProjectCreativeLock(
  project: CreativeProject,
  lock: CreativeLock
): CreativeLock[] {
  const existing = [...listProjectCreativeLocks(project)];
  const idx = existing.findIndex((l) => l.id === lock.id);
  if (idx === -1) {
    existing.push(lock);
  } else {
    existing[idx] = {
      ...lock,
      version: (existing[idx].version ?? 1) + 1,
      updatedAt: Date.now(),
    };
  }
  return existing;
}

export function removeProjectCreativeLock(
  project: CreativeProject,
  lockId: string
): CreativeLock[] {
  return listProjectCreativeLocks(project).filter((l) => l.id !== lockId);
}

/**
 * Evaluates a candidate set of selected manuscript hunks and model operations against
 * active Creative Locks (`CE-06.5/06.6`, `OD-06`, `S-01`).
 *
 * - `hard-structural` locks emit `HARD_CREATIVE_LOCK_VIOLATION` (`severity: 'hard-block'`)
 *   and block apply when a mutation deletes, alters, or contradicts the locked target.
 * - `soft-advisory` locks emit `SOFT_CREATIVE_LOCK_ADVISORY` (`severity: 'soft-warning'`)
 *   so the author sees an explicit advisory warning without hard-blocking apply.
 */
export function evaluateLocksAgainstProposalOperations(params: {
  locks: readonly CreativeLock[];
  selectedHunks: readonly UnifiedManuscriptHunk[];
  selectedModelOps: readonly UnifiedModelOperation[];
}): ProposalConflictDiagnostic[] {
  const diagnostics: ProposalConflictDiagnostic[] = [];
  const activeLocks = params.locks.filter((l) => l.active);
  if (activeLocks.length === 0) return diagnostics;

  for (const lock of activeLocks) {
    const normTargetLabel = normalizeUnicodeText(lock.targetLabel);
    const normTargetId = lock.targetId ? normalizeUnicodeText(lock.targetId) : '';
    const normAttrKey = lock.attributeKey ? normalizeUnicodeText(lock.attributeKey) : '';
    const normExpectedVal = lock.expectedValue ? normalizeUnicodeText(lock.expectedValue) : '';

    // 1. Check manuscript hunks against section locks or custom text constraint locks
    for (const hunk of params.selectedHunks) {
      if (lock.targetKind === 'section') {
        const matchesSection =
          (lock.targetId && hunk.sectionId === lock.targetId) ||
          normalizeUnicodeText(hunk.sectionTitle) === normTargetLabel;
        if (matchesSection && lock.forbidMutation) {
          diagnostics.push({
            id: `lock_diag_${lock.id}_${hunk.id}`,
            severity: lock.hardness === 'hard-structural' ? 'hard-block' : 'soft-warning',
            code:
              lock.hardness === 'hard-structural'
                ? 'HARD_CREATIVE_LOCK_VIOLATION'
                : 'SOFT_CREATIVE_LOCK_ADVISORY',
            operationIds: [hunk.id],
            lockId: lock.id,
            message:
              lock.hardness === 'hard-structural'
                ? `Hard Creative Lock "${lock.targetLabel}" blocks modifying manuscript section "${hunk.sectionTitle}": ${lock.ruleText}`
                : `Soft Creative Lock advisory on "${hunk.sectionTitle}": ${lock.ruleText}`,
          });
        }
      }

      if (lock.targetKind === 'custom-rule' && normExpectedVal) {
        // If a custom rule specifies a required phrase/value that was present in expectedText and removed in replacementText
        const hadPhrase = normalizeUnicodeText(hunk.expectedText).includes(normExpectedVal);
        const keepsPhrase = normalizeUnicodeText(hunk.replacementText).includes(normExpectedVal);
        if (hadPhrase && !keepsPhrase) {
          diagnostics.push({
            id: `lock_diag_${lock.id}_${hunk.id}`,
            severity: lock.hardness === 'hard-structural' ? 'hard-block' : 'soft-warning',
            code:
              lock.hardness === 'hard-structural'
                ? 'HARD_CREATIVE_LOCK_VIOLATION'
                : 'SOFT_CREATIVE_LOCK_ADVISORY',
            operationIds: [hunk.id],
            lockId: lock.id,
            message:
              lock.hardness === 'hard-structural'
                ? `Hard Lock "${lock.targetLabel}" prevents removing protected text "${lock.expectedValue}" in "${hunk.sectionTitle}".`
                : `Advisory Constraint "${lock.targetLabel}": hunk modifies or removes "${lock.expectedValue}" (${lock.ruleText}).`,
          });
        }
      } else if (lock.targetKind === 'custom-rule' && lock.hardness === 'soft-advisory') {
        // Soft advisory custom rules surface as non-blocking reminders when targetLabel is mentioned in the hunk
        const touchesTarget =
          normTargetLabel.length >= 2 &&
          (normalizeUnicodeText(hunk.expectedText).includes(normTargetLabel) ||
            normalizeUnicodeText(hunk.replacementText).includes(normTargetLabel));
        if (touchesTarget) {
          diagnostics.push({
            id: `lock_diag_${lock.id}_${hunk.id}`,
            severity: 'soft-warning',
            code: 'SOFT_CREATIVE_LOCK_ADVISORY',
            operationIds: [hunk.id],
            lockId: lock.id,
            message: `Advisory Creative Constraint (${lock.targetLabel}): ${lock.ruleText}`,
          });
        }
      }
    }

    // 2. Check model operations against entity, attribute, relationship, and story_bible locks
    for (const op of params.selectedModelOps) {
      const opNormTargetId = normalizeUnicodeText(op.targetId);
      const opNormTargetLabel = normalizeUnicodeText(op.targetLabel);
      const opNormField = op.field ? normalizeUnicodeText(op.field) : '';
      const opNormAfter = op.afterValue ? normalizeUnicodeText(op.afterValue) : '';

      const targetMatches =
        (normTargetId && (opNormTargetId === normTargetId || opNormTargetLabel === normTargetId)) ||
        opNormTargetLabel === normTargetLabel ||
        opNormTargetId === normTargetLabel;

      if (!targetMatches) continue;

      if (lock.targetKind === 'entity' && (op.targetType === 'entity' || op.targetType === 'attribute')) {
        const violatesExpected =
          normExpectedVal && opNormAfter !== normExpectedVal;
        if (lock.forbidMutation || op.action === 'delete' || violatesExpected) {
          diagnostics.push({
            id: `lock_diag_${lock.id}_${op.id}`,
            severity: lock.hardness === 'hard-structural' ? 'hard-block' : 'soft-warning',
            code:
              lock.hardness === 'hard-structural'
                ? 'HARD_CREATIVE_LOCK_VIOLATION'
                : 'SOFT_CREATIVE_LOCK_ADVISORY',
            operationIds: [op.id],
            lockId: lock.id,
            message:
              lock.hardness === 'hard-structural'
                ? `Hard Creative Lock blocks ${op.action} on locked entity "${op.targetLabel}": ${lock.ruleText}`
                : `Advisory Creative Lock on entity "${op.targetLabel}": ${lock.ruleText}`,
          });
        }
      } else if (lock.targetKind === 'attribute' && op.targetType === 'attribute') {
        const attrMatches = !normAttrKey || opNormField === normAttrKey;
        if (!attrMatches) continue;
        const violatesExpected = normExpectedVal ? opNormAfter !== normExpectedVal : lock.forbidMutation;
        if (violatesExpected || op.action === 'delete') {
          diagnostics.push({
            id: `lock_diag_${lock.id}_${op.id}`,
            severity: lock.hardness === 'hard-structural' ? 'hard-block' : 'soft-warning',
            code:
              lock.hardness === 'hard-structural'
                ? 'HARD_CREATIVE_LOCK_VIOLATION'
                : 'SOFT_CREATIVE_LOCK_ADVISORY',
            operationIds: [op.id],
            lockId: lock.id,
            message:
              lock.hardness === 'hard-structural'
                ? `Hard Creative Lock on "${op.targetLabel}.${op.field ?? lock.attributeKey ?? 'attribute'}" blocks setting value to "${op.afterValue ?? '(deleted)'}"${
                    lock.expectedValue ? ` (must remain "${lock.expectedValue}")` : ''
                  }.`
                : `Advisory Lock on "${op.targetLabel}.${op.field ?? ''}": ${lock.ruleText}`,
          });
        }
      } else if (lock.targetKind === 'relationship' && op.targetType === 'relationship') {
        const violatesExpected = normExpectedVal ? opNormAfter !== normExpectedVal : lock.forbidMutation;
        if (violatesExpected || op.action === 'delete') {
          diagnostics.push({
            id: `lock_diag_${lock.id}_${op.id}`,
            severity: lock.hardness === 'hard-structural' ? 'hard-block' : 'soft-warning',
            code:
              lock.hardness === 'hard-structural'
                ? 'HARD_CREATIVE_LOCK_VIOLATION'
                : 'SOFT_CREATIVE_LOCK_ADVISORY',
            operationIds: [op.id],
            lockId: lock.id,
            message:
              lock.hardness === 'hard-structural'
                ? `Hard Creative Lock blocks modifying relationship "${op.targetLabel}": ${lock.ruleText}`
                : `Advisory Lock on relationship "${op.targetLabel}": ${lock.ruleText}`,
          });
        }
      } else if (lock.targetKind === 'story_bible' && op.targetType === 'story_bible') {
        const fieldMatches = !normAttrKey || opNormField === normAttrKey || opNormTargetId === normAttrKey;
        if (fieldMatches && (lock.forbidMutation || (normExpectedVal && opNormAfter !== normExpectedVal))) {
          diagnostics.push({
            id: `lock_diag_${lock.id}_${op.id}`,
            severity: lock.hardness === 'hard-structural' ? 'hard-block' : 'soft-warning',
            code:
              lock.hardness === 'hard-structural'
                ? 'HARD_CREATIVE_LOCK_VIOLATION'
                : 'SOFT_CREATIVE_LOCK_ADVISORY',
            operationIds: [op.id],
            lockId: lock.id,
            message:
              lock.hardness === 'hard-structural'
                ? `Hard Creative Lock blocks modifying Story Bible field "${op.targetLabel}": ${lock.ruleText}`
                : `Advisory Lock on Story Bible field "${op.targetLabel}": ${lock.ruleText}`,
          });
        }
      }
    }
  }

  return diagnostics;
}
