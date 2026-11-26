/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { useCallback, useEffect, useMemo } from 'react';
import type { RightPanelTab } from '../../components/ContextualInspector';
import {
  addEntity,
  applyDecisionBatch,
  removeRelationship,
  renameEntity,
  setEntityAttribute,
  updateRelationshipById,
  updateStoryBibleField,
  upsertRelationship,
  validateStoryBibleUpdate,
} from '../canonicalModel';
import { resolveConsistencyIssueTarget } from '../consistencyChecker';
import { restoreProjectRevision, type UndoRedoState } from '../historyEngine';
import {
  commitRedoTransaction,
  commitSnapshotTransaction,
  commitUndoTransaction,
} from '../projectController';
import { synthesizeRefinedPrompt } from '../promptBuilder';
import type {
  ConsistencyIssueTarget,
  CreativeProject,
  DecisionItem,
  EntityCategory,
  GenerationMode,
  ProjectSnapshot,
  StoryBibleFields,
} from '../../shared/types';

export interface CanonicalPlanHandlersDeps {
  getActiveProject: () => CreativeProject;
  getUndoState: () => UndoRedoState;
  publishCurrentProject: (project: CreativeProject, undoState: UndoRedoState) => void;
  markLocalEdits: () => void;
  setStoryBibleErrors: React.Dispatch<
    React.SetStateAction<Partial<Record<keyof StoryBibleFields, string>>>
  >;
  setStatusNotification: (msg: string | null) => void;
  allowNavigation: () => boolean;
  navigateToPlan: () => void;
  navigateToWriteSection: (sectionId: string) => void;
  setSelectedEntityId: (id: string | null) => void;
  setSelectedRelationshipId: (id: string | null) => void;
  setRightPanelTab: (tab: RightPanelTab) => void;
  setMobileTab: (tab: 'decisions' | 'graph' | 'inspector' | 'output') => void;
  setFocusedStoryBibleField: React.Dispatch<
    React.SetStateAction<{ field: keyof StoryBibleFields; seq: number } | null>
  >;
}

export function createCanonicalPlanHandlers(deps: CanonicalPlanHandlersDeps) {
  const commitTransaction = (
    nextSnapshot: ProjectSnapshot,
    label: string,
    summary?: string,
    changeCount: number = 1,
    options?: { coalesceKey?: string; coalesceWindowMs?: number }
  ) => {
    deps.markLocalEdits();
    const { project: nextProj, undoState: nextUndo } = commitSnapshotTransaction(
      deps.getActiveProject(),
      deps.getUndoState(),
      nextSnapshot,
      label,
      summary ?? label,
      changeCount,
      options
    );
    deps.publishCurrentProject(nextProj, nextUndo);
  };

  const handleSetOriginalIdea = (newIdea: string) => {
    const currentSnap = deps.getActiveProject().snapshot;
    const next: ProjectSnapshot = { ...currentSnap, originalIdea: newIdea };
    next.refinedPrompt = synthesizeRefinedPrompt(next);
    commitTransaction(
      next,
      'Edit Seed Story Idea',
      'Updated seed story idea and resynthesized prompt.',
      1,
      { coalesceKey: 'seed-idea', coalesceWindowMs: 2500 }
    );
  };

  const handleSetFreeformNotes = (notes: string) => {
    const currentSnap = deps.getActiveProject().snapshot;
    const next: ProjectSnapshot = { ...currentSnap, freeformNotes: notes };
    next.refinedPrompt = synthesizeRefinedPrompt(next);
    commitTransaction(
      next,
      'Update Author Notes',
      'Updated freeform author notes.',
      1,
      { coalesceKey: 'freeform-notes', coalesceWindowMs: 2500 }
    );
  };

  const handleModeChange = (newMode: GenerationMode) => {
    const currentSnap = deps.getActiveProject().snapshot;
    if (newMode === currentSnap.mode) return;
    const next: ProjectSnapshot = { ...currentSnap, mode: newMode };
    next.refinedPrompt = synthesizeRefinedPrompt(next, newMode);
    commitTransaction(
      next,
      `Switch Mode to ${newMode === 'story' ? 'Story' : 'Image'}`,
      `Switched active generation mode to ${newMode}.`
    );
    deps.setStatusNotification(
      `Switched to ${newMode === 'story' ? 'Story' : 'Image'} mode. Shared Story Bible and confirmed entities are preserved.`
    );
  };

  const handleAttributeChange = (entityName: string, attributeName: string, newValue: string) => {
    const currentSnap = deps.getActiveProject().snapshot;
    const next = setEntityAttribute(currentSnap, entityName, attributeName, newValue, 'user-edit');
    commitTransaction(
      next,
      `Set ${entityName} → ${attributeName}: ${newValue}`,
      `Updated ${entityName}'s ${attributeName} to "${newValue}".`
    );
  };

  const handleRenameEntity = (entityIdOrName: string, newName: string) => {
    const currentSnap = deps.getActiveProject().snapshot;
    const next = renameEntity(currentSnap, entityIdOrName, newName, 'user-edit');
    commitTransaction(
      next,
      `Rename entity to "${newName}"`,
      `Renamed "${entityIdOrName}" to "${newName}" and updated all relationship references.`
    );
  };

  const handleAddEntity = (name: string, category: EntityCategory, description: string) => {
    const currentSnap = deps.getActiveProject().snapshot;
    const next = addEntity(currentSnap, name, category, description, 'user-edit');
    commitTransaction(
      next,
      `Add ${category}: ${name}`,
      `Added new ${category} "${name}" to the Belief Graph.`
    );
  };

  const handleUpsertRelationship = (
    source: string,
    target: string,
    label: string,
    relationshipId?: string
  ) => {
    const currentSnap = deps.getActiveProject().snapshot;
    const next = upsertRelationship(
      currentSnap,
      source,
      target,
      label,
      'user-edit',
      relationshipId ? { relationshipId } : undefined
    );
    commitTransaction(
      next,
      `Relationship: ${source} → ${label} → ${target}`,
      `Set relationship between ${source} and ${target} to "${label}".`
    );
  };

  const handleUpdateRelationshipById = (
    relationshipId: string,
    updates: {
      label?: string;
      status?: 'confirmed' | 'rejected' | 'pending';
      reverseDirection?: boolean;
    }
  ) => {
    const currentSnap = deps.getActiveProject().snapshot;
    const next = updateRelationshipById(currentSnap, relationshipId, updates, 'user-edit');
    const summaryParts: string[] = [];
    if (updates.reverseDirection) summaryParts.push('reversed direction');
    if (updates.label) summaryParts.push(`label "${updates.label}"`);
    if (updates.status) summaryParts.push(`status ${updates.status}`);
    commitTransaction(
      next,
      `Update Relationship (${summaryParts.join(', ') || 'edited'})`,
      `Updated directed relationship (${summaryParts.join(', ')}).`
    );
  };

  const handleRemoveRelationship = (relIdOrSource: string, target?: string) => {
    const currentSnap = deps.getActiveProject().snapshot;
    const next = removeRelationship(currentSnap, relIdOrSource, target);
    commitTransaction(
      next,
      'Remove relationship',
      `Removed relationship ${relIdOrSource}${target ? ` → ${target}` : ''}.`
    );
  };

  const handleUpdateStoryBible = (field: keyof StoryBibleFields, value: string) => {
    const validation = validateStoryBibleUpdate(field, value);
    if (!validation.ok) {
      deps.setStoryBibleErrors((prev) => ({
        ...prev,
        [field]: validation.error ?? 'Invalid Story Bible value.',
      }));
      return;
    }
    deps.setStoryBibleErrors((prev) => {
      if (!prev[field]) return prev;
      const nextErrs = { ...prev };
      delete nextErrs[field];
      return nextErrs;
    });

    const currentSnap = deps.getActiveProject().snapshot;
    const next = updateStoryBibleField(currentSnap, field, validation.normalized, 'user-edit');
    const isClear = validation.intent === 'clear';
    commitTransaction(
      next,
      isClear ? `Clear Story Bible: ${field}` : `Update Story Bible: ${field}`,
      isClear
        ? `Cleared Story Bible ${field}.`
        : `Set Story Bible ${field} to "${validation.normalized.trim()}".`,
      1,
      {
        coalesceKey: isClear ? `story-bible-clear:${field}` : `story-bible:${field}`,
        coalesceWindowMs: isClear ? 400 : 2500,
      }
    );
  };

  const handleConfirmPendingStoryBible = (
    items: Array<{ field: keyof StoryBibleFields; value: string }>
  ) => {
    if (items.length === 0) return;
    let workingSnap = deps.getActiveProject().snapshot;
    const nextErrors: Partial<Record<keyof StoryBibleFields, string>> = {};
    let confirmedCount = 0;

    for (const item of items) {
      const validation = validateStoryBibleUpdate(item.field, item.value);
      if (!validation.ok) {
        nextErrors[item.field] = validation.error ?? 'Invalid Story Bible value.';
        continue;
      }
      workingSnap = updateStoryBibleField(
        workingSnap,
        item.field,
        validation.normalized,
        'user-edit'
      );
      confirmedCount += 1;
    }

    if (Object.keys(nextErrors).length > 0) {
      deps.setStoryBibleErrors((prev) => ({ ...prev, ...nextErrors }));
    }
    if (confirmedCount > 0) {
      commitTransaction(
        workingSnap,
        `Confirm ${confirmedCount} Story Bible field${confirmedCount === 1 ? '' : 's'}`,
        `Confirmed ${confirmedCount} pending Story Bible field(s).`,
        confirmedCount
      );
    }
  };

  const handleApplyDecisions = (
    decisionIds: string[],
    action: 'accept' | 'reject' | 'defer',
    customValues?: Record<string, string>
  ) => {
    const currentSnap = deps.getActiveProject().snapshot;
    const res = applyDecisionBatch(currentSnap, decisionIds, action, customValues);
    if (res.conflicts.length > 0) {
      deps.setStatusNotification(res.conflicts[0]);
      return;
    }
    if (res.appliedCount > 0) {
      commitTransaction(
        res.snapshot,
        `${action === 'accept' ? 'Accept' : action === 'reject' ? 'Reject' : 'Defer'} ${res.appliedCount} decision${res.appliedCount === 1 ? '' : 's'}`,
        `Applied batch ${action} to ${res.appliedCount} item(s) in Decision Inbox.`,
        res.appliedCount
      );
    }
  };

  const handleAcceptAllPendingDecisions = () => {
    const pendingIds = deps
      .getActiveProject()
      .snapshot.decisions.filter((d) => d.status === 'pending')
      .map((d) => d.id);
    if (pendingIds.length === 0) return;
    handleApplyDecisions(pendingIds, 'accept');
  };

  const handleInspectDecisionTarget = (decision: DecisionItem) => {
    const currentSnap = deps.getActiveProject().snapshot;
    if (decision.targetStoryField) {
      const targetField = decision.targetStoryField;
      deps.setRightPanelTab('story-bible');
      deps.setMobileTab('inspector');
      deps.setFocusedStoryBibleField((prev) => ({
        field: targetField,
        seq: (prev?.seq ?? 0) + 1,
      }));
      return;
    }
    if (decision.targetRelationshipId) {
      const rel = currentSnap.relationships.find((r) => r.id === decision.targetRelationshipId);
      if (rel) {
        deps.setSelectedEntityId(null);
        deps.setSelectedRelationshipId(rel.id ?? null);
        deps.setRightPanelTab('inspector');
        deps.setMobileTab('inspector');
        return;
      }
    }
    if (decision.targetEntityId || decision.targetEntityName) {
      const target = currentSnap.entities.find(
        (e) =>
          e.id === decision.targetEntityId ||
          e.name.toLowerCase() === decision.targetEntityName?.toLowerCase()
      );
      if (target) {
        deps.setSelectedRelationshipId(null);
        deps.setSelectedEntityId(target.id ?? target.name);
        deps.setRightPanelTab('inspector');
        deps.setMobileTab('inspector');
      }
    }
  };

  const handleNavigateConsistencyTarget = (target: ConsistencyIssueTarget) => {
    if (target.kind === 'section' && target.sectionId) {
      if (!deps.allowNavigation()) return;
      deps.navigateToWriteSection(target.sectionId);
      return;
    }
    const resolved = resolveConsistencyIssueTarget(deps.getActiveProject().snapshot, target);
    if (!resolved.ok) {
      deps.setStatusNotification(resolved.reason);
      return;
    }
    if (resolved.kind === 'story_bible') {
      deps.navigateToPlan();
      deps.setRightPanelTab('story-bible');
      deps.setMobileTab('inspector');
      deps.setFocusedStoryBibleField((prev) => ({
        field: resolved.storyField,
        seq: (prev?.seq ?? 0) + 1,
      }));
      return;
    }
    if (resolved.kind === 'relationship') {
      deps.navigateToPlan();
      deps.setSelectedEntityId(null);
      deps.setSelectedRelationshipId(resolved.relationship.id ?? null);
      deps.setRightPanelTab('inspector');
      deps.setMobileTab('inspector');
      return;
    }
    if (resolved.kind === 'entity') {
      deps.navigateToPlan();
      deps.setSelectedRelationshipId(null);
      deps.setSelectedEntityId(resolved.entity.id ?? resolved.entity.name);
      deps.setRightPanelTab('inspector');
      deps.setMobileTab('inspector');
    }
  };

  const handleUndo = () => {
    const res = commitUndoTransaction(deps.getActiveProject(), deps.getUndoState());
    if (res.undoneLabel) {
      deps.markLocalEdits();
      deps.publishCurrentProject(res.project, res.undoState);
      deps.setStatusNotification(`Undid: ${res.undoneLabel}`);
    }
  };

  const handleRedo = () => {
    const res = commitRedoTransaction(deps.getActiveProject(), deps.getUndoState());
    if (res.redoneLabel) {
      deps.markLocalEdits();
      deps.publishCurrentProject(res.project, res.undoState);
      deps.setStatusNotification(`Redid: ${res.redoneLabel}`);
    }
  };

  const handleRestoreRevision = (revisionId: string) => {
    if (!deps.allowNavigation()) return;
    const res = restoreProjectRevision(deps.getActiveProject(), deps.getUndoState(), revisionId);
    if (!res) return;
    deps.markLocalEdits();
    deps.publishCurrentProject(res.project, res.undoState);
    deps.setStatusNotification('Restored project revision safely (previous state saved in history).');
  };

  return {
    commitTransaction,
    handleSetOriginalIdea,
    handleSetFreeformNotes,
    handleModeChange,
    handleAttributeChange,
    handleRenameEntity,
    handleAddEntity,
    handleUpsertRelationship,
    handleUpdateRelationshipById,
    handleRemoveRelationship,
    handleUpdateStoryBible,
    handleConfirmPendingStoryBible,
    handleApplyDecisions,
    handleAcceptAllPendingDecisions,
    handleInspectDecisionTarget,
    handleNavigateConsistencyTarget,
    handleUndo,
    handleRedo,
    handleRestoreRevision,
  };
}

export function useCanonicalPlanHandlers(deps: CanonicalPlanHandlersDeps) {
  const depsCallback = useCallback(() => deps, [deps]);
  return useMemo(() => createCanonicalPlanHandlers(depsCallback()), [depsCallback]);
}

function isEditableKeyboardTarget(target: HTMLElement | null): boolean {
  if (!target) return false;
  return target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable;
}

export function useGlobalWorkspaceShortcuts(params: {
  getActiveProject: () => CreativeProject;
  getUndoState: () => UndoRedoState;
  isDraftOrRestorePending: () => boolean;
  onUndo: () => void;
  onRedo: () => void;
}) {
  const { getActiveProject, isDraftOrRestorePending, onUndo, onRedo } = params;

  useEffect(() => {
    const warn = (event: BeforeUnloadEvent) => {
      const current = getActiveProject();
      const hasUnpersistedNarrative = Boolean(current.narrative) && current.persistedRevision !== current.revision;
      if (!isDraftOrRestorePending() && !hasUnpersistedNarrative) return;
      event.preventDefault();
      event.returnValue = '';
    };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [getActiveProject, isDraftOrRestorePending]);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (isDraftOrRestorePending()) return;
      if (isEditableKeyboardTarget(e.target as HTMLElement | null)) return;
      if (!(e.metaKey || e.ctrlKey) || e.key.toLowerCase() !== 'z') return;
      e.preventDefault();
      if (e.shiftKey) onRedo();
      else onUndo();
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isDraftOrRestorePending, onUndo, onRedo]);
}
