import {
  DiagnosticFixAlternative,
  SyncManuscriptPatch,
  SyncModelProposal,
  WritingAssistProposal,
} from '../../../shared/narrativeAiSchemas';
import { ManuscriptSection } from '../../../shared/narrativeTypes';
import {
  BatchEditProposalResult,
  CreativeProject,
  Entity,
  Relationship,
  StoryBibleFields,
} from '../../../shared/types';
import {
  ProposalConflictDiagnostic,
  UnifiedManuscriptHunk,
  UnifiedModelOperation,
  UnifiedProposal,
  UnifiedProposalOrigin,
} from '../../../shared/unifiedProposalTypes';
import { UndoRedoState } from '../../historyEngine';
import { commitSnapshotTransaction } from '../../projectController';
import { getDeletedProjectIds } from '../../storage/tombstoneRegistry';
import { NARRATIVE_SCHEMA_VERSION } from '../../storageEngine';
import { recordNarrativeChange } from '../changeAudit';
import { validateNarrativeRecords } from '../evidenceRegistry';
import { invalidateTargetEvidence } from '../issueRegistry';
import { manuscriptSections } from '../manuscriptModel';
import {
  computeDeterministicDigest,
  isValidUtf16Boundary,
  normalizeUnicodeText,
} from '../memory/textNormalization';
import { evaluateLocksAgainstProposalOperations } from './creativeLocks';

export function computeProjectBaseSnapshotDigest(project: CreativeProject): string {
  const sections = manuscriptSections(project);
  const sectionPart = sections.map((s) => `${s.id}:${s.title}:${s.text.length}:${computeDeterministicDigest(s.text)}`).join('|');
  const entityPart = (project.snapshot.entities ?? [])
    .map((e) => `${e.id ?? e.name}:${e.excluded ? 1 : 0}:${(e.attributes ?? []).map((a) => `${a.name}=${a.confirmedValue ?? a.value?.[0]?.name ?? ''}`).join(',')}`)
    .join('|');
  const relPart = (project.snapshot.relationships ?? [])
    .map((r) => `${r.id ?? ''}:${r.source}->${r.label}->${r.target}`)
    .join('|');
  return computeDeterministicDigest(`rev:${project.revision}|mv:${project.snapshot.manuscriptVersionId ?? ''}|${sectionPart}|${entityPart}|${relPart}`);
}

export function computeUnifiedProposalPatchDigest(params: {
  projectId: string;
  baseRevision: number;
  selectedIds: readonly string[];
  manuscriptHunks: readonly UnifiedManuscriptHunk[];
  modelOperations: readonly UnifiedModelOperation[];
}): string {
  const selectedSet = new Set(params.selectedIds);
  const hunkPart = params.manuscriptHunks
    .filter((h) => selectedSet.has(h.id))
    .map((h) => `${h.id}:${h.sectionId}:${h.operation}:${h.startOffset}-${h.endOffset}:${computeDeterministicDigest(h.replacementText)}`)
    .join('|');
  const opPart = params.modelOperations
    .filter((op) => selectedSet.has(op.id))
    .map((op) => `${op.id}:${op.targetType}:${op.action}:${op.targetId}:${op.field ?? ''}:${computeDeterministicDigest(op.afterValue ?? '')}`)
    .join('|');
  return computeDeterministicDigest(`${params.projectId}|r${params.baseRevision}|h:[${hunkPart}]|m:[${opPart}]`);
}

export function createUnifiedProposalEnvelope(params: {
  id?: string;
  project: CreativeProject;
  originOperation: UnifiedProposalOrigin;
  title: string;
  rationale: string;
  manuscriptHunks?: UnifiedManuscriptHunk[];
  modelOperations?: UnifiedModelOperation[];
  selectedIds?: string[];
  provenance?: UnifiedProposal['provenance'];
  speculativeImpacts?: UnifiedProposal['speculativeImpacts'];
}): UnifiedProposal {
  const now = Date.now();
  const id = params.id || `uprop_${now}_${Math.random().toString(36).slice(2, 8)}`;
  const manuscriptHunks = params.manuscriptHunks ?? [];
  const modelOperations = params.modelOperations ?? [];
  const selectedIds =
    params.selectedIds ??
    [...manuscriptHunks.map((h) => h.id), ...modelOperations.map((m) => m.id)];
  const baseRevision = params.project.revision ?? 1;
  const baseSnapshotDigest = computeProjectBaseSnapshotDigest(params.project);
  const patchDigest = computeUnifiedProposalPatchDigest({
    projectId: params.project.id,
    baseRevision,
    selectedIds,
    manuscriptHunks,
    modelOperations,
  });

  return {
    schemaVersion: 1,
    id,
    idempotencyKey: `e3_apply_${id}_${patchDigest}`,
    projectId: params.project.id,
    baseRevision,
    baseSnapshotDigest,
    baseManuscriptVersionId: params.project.snapshot.manuscriptVersionId || 'default-manuscript',
    originOperation: params.originOperation,
    title: params.title,
    rationale: params.rationale,
    manuscriptHunks,
    modelOperations,
    selectedIds,
    patchDigest,
    status: 'ready',
    createdAt: now,
    updatedAt: now,
    ...(params.provenance ? { provenance: params.provenance } : {}),
    speculativeImpacts: params.speculativeImpacts ?? [],
  };
}

/**
 * Updates selection or inline-edited hunks/operations on a UnifiedProposal,
 * deterministically recomputing `patchDigest` and `idempotencyKey` (`IR-04`).
 */
export function updateUnifiedProposalSelectionOrEdits(
  proposal: UnifiedProposal,
  updates: {
    selectedIds?: string[];
    manuscriptHunks?: UnifiedManuscriptHunk[];
    modelOperations?: UnifiedModelOperation[];
  }
): UnifiedProposal {
  const manuscriptHunks = updates.manuscriptHunks ?? proposal.manuscriptHunks;
  const modelOperations = updates.modelOperations ?? proposal.modelOperations;
  const selectedIds = updates.selectedIds ?? proposal.selectedIds;
  const patchDigest = computeUnifiedProposalPatchDigest({
    projectId: proposal.projectId,
    baseRevision: proposal.baseRevision,
    selectedIds,
    manuscriptHunks,
    modelOperations,
  });
  return {
    ...proposal,
    manuscriptHunks,
    modelOperations,
    selectedIds,
    patchDigest,
    idempotencyKey: `e3_apply_${proposal.id}_${patchDigest}`,
    status: proposal.status === 'applied' ? 'ready' : proposal.status,
    updatedAt: Date.now(),
  };
}

export interface CompiledProposalPreviewResult {
  ok: boolean;
  canApply: boolean;
  candidateProject: CreativeProject;
  candidateSections: ManuscriptSection[];
  diagnostics: ProposalConflictDiagnostic[];
  hardBlockCount: number;
  softWarningCount: number;
  selectedHunkCount: number;
  selectedModelOpCount: number;
  patchDigest: string;
}

/**
 * Pure deterministic E3 Proposal Preview Compiler & Conflict Detector (`CE-02.1–3/11`, `CE-04.1–6`, `IR-04`).
 * Validates base revision/digest, UTF-16 boundaries, expected substring match, overlapping hunks,
 * operation dependencies, dangling entity references, contradictory mutations, and Creative Locks.
 * Fails closed (`canApply: false`) whenever any `hard-block` diagnostic is present.
 */
export function compileUnifiedProposalPreview(
  project: CreativeProject,
  proposal: UnifiedProposal
): CompiledProposalPreviewResult {
  const diagnostics: ProposalConflictDiagnostic[] = [];
  const selectedSet = new Set(proposal.selectedIds);
  const selectedHunks = proposal.manuscriptHunks.filter((h) => selectedSet.has(h.id));
  const selectedModelOps = proposal.modelOperations.filter((op) => selectedSet.has(op.id));

  // 1. Check Base Revision & Snapshot Digest
  const currentRevision = project.revision ?? 1;
  const currentDigest = computeProjectBaseSnapshotDigest(project);
  if (
    proposal.projectId !== project.id ||
    proposal.baseRevision !== currentRevision ||
    proposal.baseSnapshotDigest !== currentDigest
  ) {
    diagnostics.push({
      id: `diag_stale_base_${proposal.id}`,
      severity: 'hard-block',
      code: 'STALE_BASE_REVISION',
      operationIds: [...proposal.selectedIds],
      message: `Proposal was generated against revision r${proposal.baseRevision}, but the project is currently at revision r${currentRevision}. Refresh or rebase the proposal before applying.`,
    });
  }

  // 2. Check Unmet Dependencies (`IR-04`)
  const allOpsById = new Map<string, { id: string; label: string; dependencyIds: string[] }>();
  for (const h of proposal.manuscriptHunks) {
    allOpsById.set(h.id, {
      id: h.id,
      label: `Manuscript Hunk in "${h.sectionTitle}"`,
      dependencyIds: h.dependencyIds ?? [],
    });
  }
  for (const op of proposal.modelOperations) {
    allOpsById.set(op.id, {
      id: op.id,
      label: `${op.action.toUpperCase()} ${op.targetType} "${op.targetLabel}"`,
      dependencyIds: op.dependencyIds ?? [],
    });
  }

  for (const selectedId of selectedSet) {
    const entry = allOpsById.get(selectedId);
    if (!entry) continue;
    for (const depId of entry.dependencyIds) {
      if (!selectedSet.has(depId)) {
        const depLabel = allOpsById.get(depId)?.label || depId;
        diagnostics.push({
          id: `diag_dep_${selectedId}_${depId}`,
          severity: 'hard-block',
          code: 'UNMET_DEPENDENCY',
          operationIds: [selectedId, depId],
          message: `"${entry.label}" depends on unselected operation "${depLabel}". Select both or unselect "${entry.label}".`,
        });
      }
    }
  }

  // 3. Evaluate Creative Locks (`CE-06.5/06.6`, `S-01`) — both project locks and active session locks
  const projectLocks = project.narrative?.creativeLocks ?? [];
  const sessionLocks = (project.narrative?.creativeSessions ?? [])
    .filter(
      (s) =>
        s.status === 'active' &&
        (!proposal.provenance?.sessionId || s.id === proposal.provenance.sessionId)
    )
    .flatMap((s) => s.sessionLocks ?? []);
  const lockDiagnostics = evaluateLocksAgainstProposalOperations({
    locks: [...projectLocks, ...sessionLocks],
    selectedHunks,
    selectedModelOps,
  });
  diagnostics.push(...lockDiagnostics);

  // 4. Validate & Compile Selected Manuscript Hunks per Section
  const baseSections = manuscriptSections(project);
  const nextSections = baseSections.map((s) => ({ ...s }));
  const sectionById = new Map(nextSections.map((s) => [s.id, s]));

  const hunksBySection = new Map<string, UnifiedManuscriptHunk[]>();
  for (const hunk of selectedHunks) {
    let list = hunksBySection.get(hunk.sectionId);
    if (!list) {
      list = [];
      hunksBySection.set(hunk.sectionId, list);
    }
    list.push(hunk);
  }

  for (const [sectionId, hunks] of hunksBySection.entries()) {
    const section = sectionById.get(sectionId);
    if (!section) {
      diagnostics.push({
        id: `diag_missing_sec_${sectionId}`,
        severity: 'hard-block',
        code: 'INVALID_UTF16_SPAN',
        operationIds: hunks.map((h) => h.id),
        message: `Target manuscript section "${sectionId}" does not exist.`,
      });
      continue;
    }

    const sortedAsc = [...hunks].sort(
      (a, b) => a.startOffset - b.startOffset || a.endOffset - b.endOffset
    );

    // Validate individual UTF-16 spans and expected text
    for (const h of sortedAsc) {
      if (
        h.startOffset < 0 ||
        h.endOffset < h.startOffset ||
        h.endOffset > section.text.length ||
        !isValidUtf16Boundary(section.text, h.startOffset) ||
        !isValidUtf16Boundary(section.text, h.endOffset)
      ) {
        diagnostics.push({
          id: `diag_utf16_${h.id}`,
          severity: 'hard-block',
          code: 'INVALID_UTF16_SPAN',
          operationIds: [h.id],
          message: `Hunk [${h.startOffset}..${h.endOffset}] in "${section.title || section.id}" is outside valid UTF-16 code-point boundaries (length ${section.text.length}).`,
        });
        continue;
      }

      const actualSlice = section.text.slice(h.startOffset, h.endOffset);
      if (h.operation !== 'insert' && actualSlice !== h.expectedText) {
        diagnostics.push({
          id: `diag_mismatch_${h.id}`,
          severity: 'hard-block',
          code: 'EXPECTED_TEXT_MISMATCH',
          operationIds: [h.id],
          message: `Expected text at [${h.startOffset}..${h.endOffset}] in "${section.title || section.id}" does not match current manuscript text.`,
        });
      }
    }

    // Check overlapping hunks within the same section
    for (let i = 0; i < sortedAsc.length - 1; i += 1) {
      const curr = sortedAsc[i];
      const next = sortedAsc[i + 1];
      if (curr.endOffset > next.startOffset) {
        diagnostics.push({
          id: `diag_overlap_${curr.id}_${next.id}`,
          severity: 'hard-block',
          code: 'OVERLAPPING_MANUSCRIPT_HUNKS',
          operationIds: [curr.id, next.id],
          message: `Overlapping manuscript hunks [${curr.startOffset}..${curr.endOffset}] and [${next.startOffset}..${next.endOffset}] in "${section.title || section.id}". Unselect one of the conflicting hunks.`,
        });
      }
    }

    // Apply non-overlapping valid hunks from back to front so earlier offsets remain invariant
    const hasSectionBlock = diagnostics.some(
      (d) =>
        d.severity === 'hard-block' &&
        d.operationIds.some((id) => hunks.some((h) => h.id === id))
    );
    if (!hasSectionBlock) {
      let updatedText = section.text;
      const sortedDesc = [...sortedAsc].sort((a, b) => b.startOffset - a.startOffset);
      for (const h of sortedDesc) {
        const replacement = h.operation === 'delete' ? '' : h.replacementText;
        updatedText =
          updatedText.slice(0, h.startOffset) +
          replacement +
          updatedText.slice(h.endOffset);
      }
      section.text = updatedText;
    }
  }

  // 5. Validate & Compile Selected Model Operations
  const nextEntities: Entity[] = (project.snapshot.entities ?? []).map((e) => ({
    ...e,
    attributes: (e.attributes ?? []).map((a) => ({ ...a, value: [...(a.value ?? [])] })),
    aliases: e.aliases ? [...e.aliases] : undefined,
  }));
  const nextRelationships: Relationship[] = (project.snapshot.relationships ?? []).map((r) => ({ ...r }));
  const nextStoryBible = { ...project.snapshot.storyBible };

  // Detect contradictory mutations targeting the same entity attribute or Story Bible field
  const attributeMutationMap = new Map<string, UnifiedModelOperation>();
  for (const op of selectedModelOps) {
    if (op.targetType === 'attribute' || op.targetType === 'story_bible') {
      const key = `${op.targetType}::${normalizeUnicodeText(op.targetId)}::${normalizeUnicodeText(op.field || '')}`;
      const prevOp = attributeMutationMap.get(key);
      if (prevOp && prevOp.afterValue !== op.afterValue) {
        diagnostics.push({
          id: `diag_contradict_${prevOp.id}_${op.id}`,
          severity: 'hard-block',
          code: 'CONTRADICTORY_MODEL_MUTATION',
          operationIds: [prevOp.id, op.id],
          message: `Contradictory mutations on "${op.targetLabel}${op.field ? `.${op.field}` : ''}": "${prevOp.afterValue ?? ''}" vs "${op.afterValue ?? ''}".`,
        });
      }
      attributeMutationMap.set(key, op);
    }
  }

  const findEntityIndex = (idOrName: string): number => {
    const norm = normalizeUnicodeText(idOrName);
    return nextEntities.findIndex(
      (e) =>
        e.id === idOrName ||
        normalizeUnicodeText(e.name) === norm ||
        (e.aliases ?? []).some((al) => normalizeUnicodeText(al) === norm)
    );
  };

  for (const op of selectedModelOps) {
    if (op.targetType === 'entity') {
      const idx = findEntityIndex(op.targetId || op.targetLabel);
      if (op.action === 'create') {
        if (idx === -1) {
          nextEntities.push({
            id: op.targetId || `ent_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
            name: op.targetLabel,
            category: op.entityCategory ?? 'character',
            presence_in_prompt: true,
            description: op.afterValue || op.rationale || '',
            alternatives: null,
            attributes: [],
            status: 'confirmed',
            provenance: 'accepted-suggestion',
          });
        } else {
          nextEntities[idx] = {
            ...nextEntities[idx],
            excluded: false,
            description: op.afterValue || nextEntities[idx].description,
          };
        }
      } else if (op.action === 'update') {
        if (idx === -1) {
          diagnostics.push({
            id: `diag_dangling_ent_${op.id}`,
            severity: 'hard-block',
            code: 'DANGLING_ENTITY_REFERENCE',
            operationIds: [op.id],
            message: `Cannot update missing entity "${op.targetLabel}".`,
          });
        } else {
          const current = nextEntities[idx];
          if (op.field === 'name' && op.afterValue) {
            const oldName = current.name;
            current.name = op.afterValue;
            for (const rel of nextRelationships) {
              if (rel.source === oldName) rel.source = op.afterValue;
              if (rel.target === oldName) rel.target = op.afterValue;
            }
          } else {
            current.description = op.afterValue ?? current.description;
          }
        }
      } else if (op.action === 'delete') {
        if (idx !== -1) {
          nextEntities[idx] = { ...nextEntities[idx], excluded: true, status: 'rejected' };
        }
      }
    } else if (op.targetType === 'attribute') {
      const idx = findEntityIndex(op.targetId || op.targetLabel);
      if (idx === -1) {
        diagnostics.push({
          id: `diag_dangling_attr_ent_${op.id}`,
          severity: 'hard-block',
          code: 'DANGLING_ENTITY_REFERENCE',
          operationIds: [op.id],
          message: `Attribute operation references missing or unselected entity "${op.targetLabel}".`,
        });
      } else {
        const ent = nextEntities[idx];
        const attrName = op.field || 'Trait';
        const attrIdx = ent.attributes.findIndex(
          (a) => normalizeUnicodeText(a.name) === normalizeUnicodeText(attrName)
        );
        if (op.action === 'delete') {
          if (attrIdx !== -1) ent.attributes.splice(attrIdx, 1);
        } else {
          const val = op.afterValue ?? '';
          if (attrIdx === -1) {
            ent.attributes.push({
              id: `attr_${op.id}`,
              name: attrName,
              presence_in_prompt: true,
              value: [{ name: val }],
              confirmedValue: val,
              status: 'confirmed',
              provenance: 'accepted-suggestion',
              updatedAt: Date.now(),
            });
          } else {
            ent.attributes[attrIdx] = {
              ...ent.attributes[attrIdx],
              value: [{ name: val }],
              confirmedValue: val,
              status: 'confirmed',
              updatedAt: Date.now(),
            };
          }
        }
      }
    } else if (op.targetType === 'relationship') {
      const srcName = op.sourceEntityId || op.targetLabel.split('→')[0]?.trim() || '';
      const tgtName = op.targetEntityId || op.targetLabel.split('→')[1]?.trim() || '';
      const srcIdx = srcName ? findEntityIndex(srcName) : -1;
      const tgtIdx = tgtName ? findEntityIndex(tgtName) : -1;

      if (op.action !== 'delete' && (srcIdx === -1 || tgtIdx === -1 || nextEntities[srcIdx]?.excluded || nextEntities[tgtIdx]?.excluded)) {
        diagnostics.push({
          id: `diag_dangling_rel_${op.id}`,
          severity: 'hard-block',
          code: 'DANGLING_ENTITY_REFERENCE',
          operationIds: [op.id],
          message: `Relationship "${op.targetLabel}" references a missing or excluded entity (${srcName || '?'} → ${tgtName || '?'}).`,
        });
      } else if (op.action === 'delete') {
        const relIdx = nextRelationships.findIndex(
          (r) =>
            r.id === op.targetId ||
            (normalizeUnicodeText(r.source) === normalizeUnicodeText(srcName) &&
              normalizeUnicodeText(r.target) === normalizeUnicodeText(tgtName))
        );
        if (relIdx !== -1) nextRelationships.splice(relIdx, 1);
      } else {
        const resolvedSrc = nextEntities[srcIdx].name;
        const resolvedTgt = nextEntities[tgtIdx].name;
        const relIdx = nextRelationships.findIndex(
          (r) =>
            r.id === op.targetId ||
            (normalizeUnicodeText(r.source) === normalizeUnicodeText(resolvedSrc) &&
              normalizeUnicodeText(r.target) === normalizeUnicodeText(resolvedTgt))
        );
        const newLabel = op.afterValue || op.relationshipType || 'Connected';
        if (relIdx === -1) {
          nextRelationships.push({
            id: op.targetId || `rel_${op.id}`,
            sourceId: nextEntities[srcIdx].id,
            targetId: nextEntities[tgtIdx].id,
            source: resolvedSrc,
            target: resolvedTgt,
            label: newLabel,
            status: 'confirmed',
            provenance: 'accepted-suggestion',
          });
        } else {
          nextRelationships[relIdx] = {
            ...nextRelationships[relIdx],
            label: newLabel,
            status: 'confirmed',
          };
        }
      }
    } else if (op.targetType === 'story_bible') {
      const fieldKey = (op.field || op.targetId) as keyof StoryBibleFields;
      if (fieldKey in nextStoryBible) {
        nextStoryBible[fieldKey] = {
          ...nextStoryBible[fieldKey],
          value: op.afterValue ?? '',
          status: 'confirmed',
          provenance: 'accepted-suggestion',
          updatedAt: Date.now(),
        };
      }
    }
  }

  const hardBlockCount = diagnostics.filter((d) => d.severity === 'hard-block').length;
  const softWarningCount = diagnostics.filter((d) => d.severity === 'soft-warning').length;
  const hasSelectedOps = selectedHunks.length + selectedModelOps.length > 0;
  const canApply = hardBlockCount === 0 && hasSelectedOps;

  const patchDigest = computeUnifiedProposalPatchDigest({
    projectId: proposal.projectId,
    baseRevision: proposal.baseRevision,
    selectedIds: proposal.selectedIds,
    manuscriptHunks: proposal.manuscriptHunks,
    modelOperations: proposal.modelOperations,
  });

  const candidateProject: CreativeProject = {
    ...project,
    snapshot: {
      ...project.snapshot,
      entities: nextEntities,
      relationships: nextRelationships,
      storyBible: nextStoryBible,
    },
  };

  return {
    ok: hardBlockCount === 0,
    canApply,
    candidateProject,
    candidateSections: nextSections,
    diagnostics,
    hardBlockCount,
    softWarningCount,
    selectedHunkCount: selectedHunks.length,
    selectedModelOpCount: selectedModelOps.length,
    patchDigest,
  };
}

/**
 * Generates an inverse `UnifiedProposal` from the base project and the selected operations
 * so applied E3 proposals can be cleanly undone via the same conflict-checked engine (`CE-04.5`).
 */
export function buildInverseUnifiedProposal(
  baseProject: CreativeProject,
  appliedProject: CreativeProject,
  proposal: UnifiedProposal
): UnifiedProposal {
  const selectedSet = new Set(proposal.selectedIds);
  const inverseHunks: UnifiedManuscriptHunk[] = [];
  const appliedSections = manuscriptSections(appliedProject);
  const appliedSectionById = new Map(appliedSections.map((s) => [s.id, s]));

  // Group selected hunks by section in ascending order to compute their post-apply offsets
  const selectedHunksBySection = new Map<string, UnifiedManuscriptHunk[]>();
  for (const h of proposal.manuscriptHunks) {
    if (!selectedSet.has(h.id)) continue;
    let list = selectedHunksBySection.get(h.sectionId);
    if (!list) {
      list = [];
      selectedHunksBySection.set(h.sectionId, list);
    }
    list.push(h);
  }

  for (const [sectionId, hunks] of selectedHunksBySection.entries()) {
    const sortedAsc = [...hunks].sort((a, b) => a.startOffset - b.startOffset);
    let delta = 0;
    for (const h of sortedAsc) {
      const appliedStart = h.startOffset + delta;
      const insertedLen = h.operation === 'delete' ? 0 : h.replacementText.length;
      const appliedEnd = appliedStart + insertedLen;
      const origLen = h.endOffset - h.startOffset;
      delta += insertedLen - origLen;

      const secTitle = appliedSectionById.get(sectionId)?.title || h.sectionTitle;
      inverseHunks.push({
        id: `inv_${h.id}`,
        sectionId,
        sectionTitle: secTitle,
        operation:
          h.operation === 'insert'
            ? 'delete'
            : h.operation === 'delete'
              ? 'insert'
              : 'replace',
        startOffset: appliedStart,
        endOffset: appliedEnd,
        expectedText: h.operation === 'delete' ? '' : h.replacementText,
        replacementText: h.expectedText,
        rationale: `Undo: ${h.rationale}`,
        dependencyIds: [],
      });
    }
  }

  const inverseModelOps: UnifiedModelOperation[] = [];
  for (const op of proposal.modelOperations) {
    if (!selectedSet.has(op.id)) continue;
    const invAction =
      op.action === 'create'
        ? 'delete'
        : op.action === 'delete'
          ? 'create'
          : 'update';
    inverseModelOps.push({
      ...op,
      id: `inv_${op.id}`,
      action: invAction,
      beforeValue: op.afterValue,
      afterValue: op.beforeValue,
      rationale: `Undo: ${op.rationale}`,
      dependencyIds: [],
    });
  }

  return createUnifiedProposalEnvelope({
    id: `undo_${proposal.id}_r${appliedProject.revision}`,
    project: appliedProject,
    originOperation: proposal.originOperation,
    title: `Undo: ${proposal.title}`,
    rationale: `Reverts changes from proposal "${proposal.title}" (applied at r${appliedProject.revision}).`,
    manuscriptHunks: inverseHunks,
    modelOperations: inverseModelOps,
  });
}

export interface PreparedUnifiedProposalCommit {
  ok: true;
  project: CreativeProject;
  undoHistory: UndoRedoState;
  intentId: string;
  appliedProposal: UnifiedProposal;
  inverseProposal: UnifiedProposal;
}

export interface FailedUnifiedProposalCommit {
  ok: false;
  diagnostics: ProposalConflictDiagnostic[];
  message: string;
}

/**
 * Atomically compiles and prepares a `UnifiedProposal` commit into a single
 * durable CAS transaction (`CE-02.1–3/11`, `CE-03.5`, `CE-04.1–6`).
 * Fails closed without partial state mutation if any validation, lock, or tombstone check fails.
 */
export function prepareUnifiedProposalAtomicCommit(
  project: CreativeProject,
  undo: UndoRedoState,
  proposal: UnifiedProposal
): PreparedUnifiedProposalCommit | FailedUnifiedProposalCommit {
  try {
    if (getDeletedProjectIds().has(project.id)) {
      return {
        ok: false,
        diagnostics: [],
        message: `Project "${project.id}" has been deleted and cannot accept proposal commits.`,
      };
    }
  } catch {
    // Ignore tombstone lookup in environments without localStorage
  }

  // Idempotency check: if this exact intentId was already committed on the project, reject duplicate apply
  const currentPatchDigest = computeUnifiedProposalPatchDigest({
    projectId: proposal.projectId,
    baseRevision: proposal.baseRevision,
    selectedIds: proposal.selectedIds,
    manuscriptHunks: proposal.manuscriptHunks,
    modelOperations: proposal.modelOperations,
  });
  const intentId = `e3_apply_${proposal.id}_${currentPatchDigest}`;
  if ((project.recentIntentIds ?? []).includes(intentId)) {
    return {
      ok: false,
      diagnostics: [],
      message: `Proposal "${proposal.title}" with patch digest ${currentPatchDigest} has already been applied.`,
    };
  }

  const preview = compileUnifiedProposalPreview(project, proposal);
  if (!preview.canApply) {
    const firstBlock = preview.diagnostics.find((d) => d.severity === 'hard-block');
    return {
      ok: false,
      diagnostics: preview.diagnostics,
      message:
        firstBlock?.message ||
        'Proposal cannot be applied: select at least one valid operation with no hard conflicts.',
    };
  }

  const records = project.narrative ?? {
    versions: [],
    sectionVersions: [],
    sources: [],
    claims: [],
    issues: [],
    audit: [],
  };

  const previousSections = manuscriptSections(project);
  const nextSections = preview.candidateSections;
  const manuscriptChanged = JSON.stringify(previousSections) !== JSON.stringify(nextSections);

  let nextManuscriptVersionId = project.snapshot.manuscriptVersionId;
  const nextVersions = [...records.versions];
  const nextSectionVersions = [...records.sectionVersions];
  const changedTargets = new Set<string>();

  if (manuscriptChanged) {
    nextManuscriptVersionId = crypto.randomUUID();
    const previousVersion = records.versions.find((v) => v.id === project.snapshot.manuscriptVersionId);
    const previousSectionRefs = new Set(previousVersion?.sectionVersionIds);
    const previousBySectionId = new Map(
      records.sectionVersions
        .filter((r) => previousSectionRefs.has(r.id))
        .map((r) => [r.section.id, r])
    );

    const oldMap = new Map(previousSections.map((s) => [s.id, JSON.stringify(s)]));
    for (const sec of nextSections) {
      if (oldMap.get(sec.id) !== JSON.stringify(sec)) {
        changedTargets.add(sec.id);
      }
    }

    const sectionVersionIds = nextSections.map((section) => {
      const prev = previousBySectionId.get(section.id);
      if (prev && JSON.stringify(prev.section) === JSON.stringify(section)) {
        return prev.id;
      }
      const created = { id: crypto.randomUUID(), section };
      nextSectionVersions.push(created);
      return created.id;
    });

    nextVersions.push({
      id: nextManuscriptVersionId,
      sectionVersionIds,
      ...(previousVersion?.styleProfile ? { styleProfile: previousVersion.styleProfile } : {}),
    });
  }

  for (const op of proposal.modelOperations) {
    if (proposal.selectedIds.includes(op.id)) {
      changedTargets.add(op.targetId);
    }
  }

  const invalidatedRecords =
    changedTargets.size > 0
      ? invalidateTargetEvidence(records, Array.from(changedTargets))
      : records;

  const appliedProposal: UnifiedProposal = {
    ...proposal,
    patchDigest: currentPatchDigest,
    idempotencyKey: intentId,
    status: 'applied',
    appliedAtRevision: (project.revision ?? 1) + 1,
    appliedAt: Date.now(),
    updatedAt: Date.now(),
  };

  const existingProposals = (records.unifiedProposals ?? []).filter((p) => p.id !== appliedProposal.id);

  const label = `Apply Proposal: ${proposal.title}`.slice(0, 120);
  const committed = commitSnapshotTransaction(
    {
      ...project,
      schemaVersion: NARRATIVE_SCHEMA_VERSION,
      recentIntentIds: [...(project.recentIntentIds ?? []).slice(-30), intentId],
      narrative: {
        ...invalidatedRecords,
        sectionVersions: nextSectionVersions,
        versions: nextVersions,
        unifiedProposals: [...existingProposals, appliedProposal].slice(-25),
      },
    },
    undo,
    {
      ...preview.candidateProject.snapshot,
      ...(nextManuscriptVersionId ? { manuscriptVersionId: nextManuscriptVersionId } : {}),
    },
    label
  );

  const auditAction =
    proposal.originOperation === 'writing-assist'
      ? 'writing'
      : proposal.originOperation === 'diagnostics-fix'
        ? 'fix'
        : proposal.originOperation === 'narrative-sync'
          ? 'sync'
          : 'write';

  const audited = recordNarrativeChange(project, committed.project, auditAction, label);
  validateNarrativeRecords(audited);

  const inverseProposal = buildInverseUnifiedProposal(project, audited, appliedProposal);

  return {
    ok: true,
    project: audited,
    undoHistory: committed.undoState,
    intentId,
    appliedProposal,
    inverseProposal,
  };
}

// --- Adapters from Existing Operations into E3 UnifiedProposal ---

export function buildUnifiedProposalFromWritingAssist(params: {
  project: CreativeProject;
  sectionId: string;
  selectionStart: number;
  selectionEnd: number;
  proposal: WritingAssistProposal;
  actionLabel: string;
}): UnifiedProposal {
  const sections = manuscriptSections(params.project);
  const section = sections.find((s) => s.id === params.sectionId);
  if (!section) {
    throw new Error(`Manuscript section "${params.sectionId}" not found.`);
  }
  const start = Math.max(0, Math.min(section.text.length, params.selectionStart));
  const end = Math.max(start, Math.min(section.text.length, params.selectionEnd));
  const expectedText = section.text.slice(start, end);

  const hunk: UnifiedManuscriptHunk = {
    id: `hunk_wa_${params.proposal.id}`,
    sectionId: section.id,
    sectionTitle: section.title || 'Untitled Scene',
    operation: start === end ? 'insert' : 'replace',
    startOffset: start,
    endOffset: end,
    expectedText,
    replacementText: params.proposal.text,
    rationale: params.proposal.rationale,
    dependencyIds: [],
  };

  return createUnifiedProposalEnvelope({
    project: params.project,
    originOperation: 'writing-assist',
    title: `Writing Assistant (${params.actionLabel}): ${params.proposal.label}`,
    rationale: params.proposal.rationale,
    manuscriptHunks: [hunk],
    modelOperations: [],
  });
}

export function buildUnifiedProposalFromBatchEdit(
  project: CreativeProject,
  batchResult: BatchEditProposalResult
): UnifiedProposal {
  const modelOperations: UnifiedModelOperation[] = [];
  const createdEntityOpIdByName = new Map<string, string>();

  for (const op of batchResult.operations) {
    if (op.type === 'add_entity') {
      const entityName = op.newEntityName || op.entityName || 'New Entity';
      const opId = `mop_${op.id}`;
      createdEntityOpIdByName.set(normalizeUnicodeText(entityName), opId);
      modelOperations.push({
        id: opId,
        targetType: 'entity',
        action: 'create',
        targetId: op.entityId || entityName,
        targetLabel: entityName,
        entityCategory: op.entityCategory ?? 'character',
        beforeValue: '',
        afterValue: op.nextValue || op.summary,
        rationale: op.summary,
        dependencyIds: [],
      });
    }
  }

  for (const op of batchResult.operations) {
    if (op.type === 'add_entity') continue;
    const opId = `mop_${op.id}`;
    const deps: string[] = [];

    if (op.entityName) {
      const creatorOp = createdEntityOpIdByName.get(normalizeUnicodeText(op.entityName));
      if (creatorOp) deps.push(creatorOp);
    }
    if (op.sourceEntityName) {
      const creatorOp = createdEntityOpIdByName.get(normalizeUnicodeText(op.sourceEntityName));
      if (creatorOp) deps.push(creatorOp);
    }
    if (op.targetEntityName) {
      const creatorOp = createdEntityOpIdByName.get(normalizeUnicodeText(op.targetEntityName));
      if (creatorOp) deps.push(creatorOp);
    }

    if (op.type === 'set_attribute' || op.type === 'add_attribute') {
      modelOperations.push({
        id: opId,
        targetType: 'attribute',
        action: op.type === 'add_attribute' ? 'create' : 'update',
        targetId: op.entityId || op.entityName || 'Unknown',
        targetLabel: op.entityName || op.entityId || 'Entity',
        field: op.attributeName || 'Trait',
        beforeValue: op.previousValue ?? '',
        afterValue: op.nextValue ?? '',
        rationale: op.summary,
        dependencyIds: deps,
      });
    } else if (op.type === 'rename_entity') {
      modelOperations.push({
        id: opId,
        targetType: 'entity',
        action: 'update',
        targetId: op.entityId || op.entityName || 'Entity',
        targetLabel: op.entityName || 'Entity',
        field: 'name',
        beforeValue: op.entityName ?? '',
        afterValue: op.newEntityName ?? op.nextValue ?? '',
        rationale: op.summary,
        dependencyIds: deps,
      });
    } else if (op.type === 'exclude_entity') {
      modelOperations.push({
        id: opId,
        targetType: 'entity',
        action: 'delete',
        targetId: op.entityId || op.entityName || 'Entity',
        targetLabel: op.entityName || 'Entity',
        beforeValue: 'Active',
        afterValue: 'Excluded',
        rationale: op.summary,
        dependencyIds: deps,
      });
    } else if (
      op.type === 'add_relationship' ||
      op.type === 'update_relationship' ||
      op.type === 'remove_relationship'
    ) {
      const src = op.sourceEntityName || '';
      const tgt = op.targetEntityName || '';
      modelOperations.push({
        id: opId,
        targetType: 'relationship',
        action:
          op.type === 'add_relationship'
            ? 'create'
            : op.type === 'remove_relationship'
              ? 'delete'
              : 'update',
        targetId: op.relationshipId || `${src}__${tgt}`,
        targetLabel: `${src} → ${tgt}`,
        sourceEntityId: src,
        targetEntityId: tgt,
        relationshipType: op.nextValue,
        beforeValue: op.previousValue ?? '',
        afterValue: op.nextValue ?? '',
        rationale: op.summary,
        dependencyIds: deps,
      });
    } else if (op.type === 'update_story_bible' && op.storyField) {
      modelOperations.push({
        id: opId,
        targetType: 'story_bible',
        action: 'update',
        targetId: op.storyField,
        targetLabel: `Story Bible: ${op.storyField}`,
        field: op.storyField,
        beforeValue: op.previousValue ?? project.snapshot.storyBible[op.storyField]?.value ?? '',
        afterValue: op.nextValue ?? '',
        rationale: op.summary,
        dependencyIds: [],
      });
    }
  }

  const selectedIds = batchResult.operations
    .filter((o) => o.selected)
    .map((o) => `mop_${o.id}`);

  return createUnifiedProposalEnvelope({
    id: batchResult.proposalId,
    project,
    originOperation: 'batch-edit',
    title: `Batch Edit: ${batchResult.instruction.slice(0, 80)}`,
    rationale: `Natural-language batch edit with ${modelOperations.length} operation(s).`,
    manuscriptHunks: [],
    modelOperations,
    selectedIds,
  });
}

export function buildUnifiedProposalFromDiagnosticFix(params: {
  project: CreativeProject;
  issueTitle: string;
  alternative: DiagnosticFixAlternative;
}): UnifiedProposal {
  const sections = manuscriptSections(params.project);
  const sectionById = new Map(sections.map((s) => [s.id, s]));
  const manuscriptHunks: UnifiedManuscriptHunk[] = [];
  const modelOperations: UnifiedModelOperation[] = [];
  const alt = params.alternative;

  if (alt.kind === 'manuscript_patch' && alt.sectionId) {
    const sec = sectionById.get(alt.sectionId);
    if (sec) {
      const idx = alt.beforeText ? sec.text.indexOf(alt.beforeText) : -1;
      const startOffset = idx !== -1 ? idx : 0;
      const endOffset = idx !== -1 ? idx + alt.beforeText.length : alt.beforeText.length;
      manuscriptHunks.push({
        id: `hunk_fix_${alt.id}`,
        sectionId: sec.id,
        sectionTitle: sec.title || sec.id,
        operation: 'replace',
        startOffset,
        endOffset,
        expectedText: alt.beforeText,
        replacementText: alt.afterText,
        rationale: alt.reason,
        dependencyIds: [],
      });
    }
  } else if (alt.kind === 'entity_attribute' && alt.entityId) {
    modelOperations.push({
      id: `mop_fix_${alt.id}`,
      targetType: 'attribute',
      action: 'update',
      targetId: alt.entityId,
      targetLabel: alt.entityId,
      field: alt.attributeName || 'Trait',
      beforeValue: alt.beforeText,
      afterValue: alt.afterText,
      rationale: alt.reason,
      dependencyIds: [],
    });
  } else if (alt.kind === 'entity_exclude' && alt.entityId) {
    modelOperations.push({
      id: `mop_fix_${alt.id}`,
      targetType: 'entity',
      action: 'delete',
      targetId: alt.entityId,
      targetLabel: alt.entityId,
      beforeValue: alt.beforeText || 'Active',
      afterValue: 'Excluded',
      rationale: alt.reason,
      dependencyIds: [],
    });
  } else if (alt.kind === 'relationship_update' && alt.relationshipId) {
    modelOperations.push({
      id: `mop_fix_${alt.id}`,
      targetType: 'relationship',
      action: 'update',
      targetId: alt.relationshipId,
      targetLabel: alt.relationshipId,
      beforeValue: alt.beforeText,
      afterValue: alt.afterText,
      rationale: alt.reason,
      dependencyIds: [],
    });
  } else if (alt.kind === 'story_bible' && alt.storyField) {
    modelOperations.push({
      id: `mop_fix_${alt.id}`,
      targetType: 'story_bible',
      action: 'update',
      targetId: alt.storyField,
      targetLabel: `Story Bible: ${alt.storyField}`,
      field: alt.storyField,
      beforeValue: alt.beforeText,
      afterValue: alt.afterText,
      rationale: alt.reason,
      dependencyIds: [],
    });
  }

  return createUnifiedProposalEnvelope({
    project: params.project,
    originOperation: 'diagnostics-fix',
    title: `Diagnostic Fix (${params.issueTitle}): ${alt.title}`,
    rationale: alt.reason,
    manuscriptHunks,
    modelOperations,
  });
}

export function buildUnifiedProposalFromSyncItems(params: {
  project: CreativeProject;
  modelProposals?: SyncModelProposal[];
  manuscriptPatches?: SyncManuscriptPatch[];
}): UnifiedProposal {
  const sections = manuscriptSections(params.project);
  const sectionById = new Map(sections.map((s) => [s.id, s]));
  const manuscriptHunks: UnifiedManuscriptHunk[] = [];
  const modelOperations: UnifiedModelOperation[] = [];

  for (const patch of params.manuscriptPatches ?? []) {
    const sec = sectionById.get(patch.sectionId);
    if (!sec) continue;
    const idx = sec.text.indexOf(patch.originalExcerpt);
    const startOffset = idx !== -1 ? idx : 0;
    const endOffset = idx !== -1 ? idx + patch.originalExcerpt.length : patch.originalExcerpt.length;
    manuscriptHunks.push({
      id: `hunk_sync_${patch.id}`,
      sectionId: sec.id,
      sectionTitle: sec.title || patch.sectionTitle || sec.id,
      operation: 'replace',
      startOffset,
      endOffset,
      expectedText: patch.originalExcerpt,
      replacementText: patch.proposedExcerpt,
      rationale: patch.rationale,
      dependencyIds: [],
    });
  }

  for (const mp of params.modelProposals ?? []) {
    if (mp.kind === 'add_entity' && (mp.entityName || mp.entityId)) {
      const label = mp.entityName || mp.entityId || mp.title;
      modelOperations.push({
        id: `mop_sync_${mp.id}`,
        targetType: 'entity',
        action: 'create',
        targetId: mp.entityId || label,
        targetLabel: label,
        entityCategory: mp.entityCategory ?? 'character',
        beforeValue: mp.currentValue ?? '',
        afterValue: mp.proposedValue,
        rationale: mp.rationale,
        evidenceQuote: mp.evidenceQuote,
        evidenceSectionId: mp.sectionId,
        dependencyIds: [],
      });
    } else if (mp.kind === 'update_attribute' && (mp.entityName || mp.entityId)) {
      const label = mp.entityName || mp.entityId || mp.title;
      modelOperations.push({
        id: `mop_sync_${mp.id}`,
        targetType: 'attribute',
        action: 'update',
        targetId: mp.entityId || label,
        targetLabel: label,
        field: mp.attributeName || 'Attribute',
        beforeValue: mp.currentValue ?? '',
        afterValue: mp.proposedValue,
        rationale: mp.rationale,
        evidenceQuote: mp.evidenceQuote,
        evidenceSectionId: mp.sectionId,
        dependencyIds: [],
      });
    } else if (mp.kind === 'add_relationship' && mp.sourceEntityName && mp.targetEntityName) {
      modelOperations.push({
        id: `mop_sync_${mp.id}`,
        targetType: 'relationship',
        action: 'create',
        targetId: `${mp.sourceEntityName}__${mp.targetEntityName}`,
        targetLabel: `${mp.sourceEntityName} → ${mp.targetEntityName}`,
        sourceEntityId: mp.sourceEntityName,
        targetEntityId: mp.targetEntityName,
        beforeValue: mp.currentValue ?? '',
        afterValue: mp.proposedValue,
        rationale: mp.rationale,
        evidenceQuote: mp.evidenceQuote,
        evidenceSectionId: mp.sectionId,
        dependencyIds: [],
      });
    } else if (mp.kind === 'update_story_bible' && mp.storyField) {
      modelOperations.push({
        id: `mop_sync_${mp.id}`,
        targetType: 'story_bible',
        action: 'update',
        targetId: mp.storyField,
        targetLabel: `Story Bible: ${mp.storyField}`,
        field: mp.storyField,
        beforeValue: mp.currentValue ?? '',
        afterValue: mp.proposedValue,
        rationale: mp.rationale,
        evidenceQuote: mp.evidenceQuote,
        evidenceSectionId: mp.sectionId,
        dependencyIds: [],
      });
    }
  }

  return createUnifiedProposalEnvelope({
    project: params.project,
    originOperation: 'narrative-sync',
    title: `Narrative Sync Proposal (${manuscriptHunks.length} hunk(s), ${modelOperations.length} model op(s))`,
    rationale: 'Synchronizes working manuscript and canonical story model.',
    manuscriptHunks,
    modelOperations,
  });
}
