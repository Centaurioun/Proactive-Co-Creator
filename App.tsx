/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useCallback, useEffect, useMemo, useRef } from 'react';
import BeliefGraph from './components/BeliefGraph';
import ContextualInspector, { type RightPanelTab } from './components/ContextualInspector';
import DecisionInboxPanel from './components/DecisionInboxPanel';
import Header, { type WorkspaceSection } from './components/Header';
import InfoModal from './components/InfoModal';
import OutputDisplay from './components/OutputGallery';
import PromptInput from './components/PromptInput';
import WorkspaceBottomBar from './components/WorkspaceBottomBar';
import {
  addEntity,
  applyDecisionBatch,
  createEmptyStoryBible,
  createSampleProject,
  makeStableId,
  removeRelationship,
  renameEntity,
  setEntityAttribute,
  updateRelationshipById,
  updateStoryBibleField,
  upsertRelationship,
} from './lib/canonicalModel';
import { evaluateProjectConsistency } from './lib/consistencyChecker';
import {
  createUndoRedoState,
  performRedo,
  performUndo,
  restoreProjectRevision,
  type UndoRedoState,
} from './lib/historyEngine';
import {
  applyProposedOperations,
  interpretBatchInstructionLocally,
} from './lib/nlBatchEngine';
import {
  acceptPolishProposal,
  applyAsyncAnalysisCompletion,
  applyAsyncGenerationCompletion,
  clearTicket,
  commitSnapshotTransaction,
  createPolishProposal,
  createRequestTicket,
  isProjectActionLoading,
  refreshArtifactsCurrentness,
  registerTicket,
  type InFlightTicketsMap,
} from './lib/projectController';
import { synthesizeRefinedPrompt } from './lib/promptBuilder';
import {
  deleteProjectFromLocalStorage,
  exportProjectToJson,
  exportStoryBibleMarkdown,
  loadProjectsFromIndexedDb,
  loadProjectsFromLocalStorage,
  migrateProjectPayload,
  saveProjectToIndexedDb,
  saveProjectToLocalStorage,
} from './lib/storageEngine';
import {
  analyzePromptToBeliefGraph,
  ClientApiError,
  generateClarifications,
  generateImagesFromPrompt,
  generateStoryFromPrompt,
  isAbortError,
  refinePromptWithAllUpdates,
  requestBatchEditInterpretation,
} from './services/apiClient';
import type {
  AiPolishProposal,
  BatchEditProposalResult,
  CreativeProject,
  DecisionItem,
  EntityCategory,
  GenerationMode,
  ProjectSnapshot,
  ProposedOperation,
  Relationship,
  StoryBibleFields,
} from './shared/types';

type MobileTab = 'decisions' | 'graph' | 'inspector' | 'output';

interface StorageConflictAlert {
  type: 'conflict' | 'quota';
  message: string;
  projectId: string;
}

function getReadableErrorMessage(error: unknown, fallback: string): string {
  if (error instanceof ClientApiError) return error.message;
  if (error instanceof Error && error.message) return error.message;
  return fallback;
}

function downloadTextFile(filename: string, content: string, mimeType: string = 'text/plain;charset=utf-8') {
  const element = document.createElement('a');
  const file = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(file);
  element.href = url;
  element.download = filename;
  document.body.appendChild(element);
  element.click();
  document.body.removeChild(element);
  setTimeout(() => URL.revokeObjectURL(url), 100);
}

function App() {
  const initialData = useMemo(() => loadProjectsFromLocalStorage(), []);
  const initialProject = useMemo(
    () =>
      initialData.projects.find((p) => p.id === initialData.activeProjectId) ??
      initialData.projects[0] ??
      createSampleProject(),
    [initialData]
  );

  const [savedProjects, setSavedProjects] = useState<CreativeProject[]>(initialData.projects);
  const [project, setProject] = useState<CreativeProject>(initialProject);
  const [undoState, setUndoState] = useState<UndoRedoState>(() =>
    createUndoRedoState(initialProject.snapshot)
  );

  const snapshot = undoState.present;
  const mode = snapshot.mode;

  // Selection & UI workspace navigation
  const [selectedEntityId, setSelectedEntityId] = useState<string | null>(null);
  const [selectedRelationshipId, setSelectedRelationshipId] = useState<string | null>(null);
  const [rightPanelTab, setRightPanelTab] = useState<RightPanelTab>('inspector');
  const [mobileTab, setMobileTab] = useState<MobileTab>('graph');
  const [showOutputDrawer, setShowOutputDrawer] = useState<boolean>(true);
  const [isDarkMode, setIsDarkMode] = useState<boolean>(false);
  const [showInfoModal, setShowInfoModal] = useState<boolean>(false);
  const [isReviewModalOpen, setIsReviewModalOpen] = useState<boolean>(false);
  const [statusNotification, setStatusNotification] = useState<string | null>(null);
  const [storageAlert, setStorageAlert] = useState<StorageConflictAlert | null>(null);

  // Scoped Request Tickets & Staged Proposals
  const [inFlightTickets, setInFlightTickets] = useState<InFlightTicketsMap>({});
  const [polishProposalsByProject, setPolishProposalsByProject] = useState<
    Record<string, AiPolishProposal>
  >({});

  const [analysisErrors, setAnalysisErrors] = useState<Record<string, string | null>>({});
  const [clarificationErrors, setClarificationErrors] = useState<Record<string, string | null>>({});
  const [galleryErrors, setGalleryErrors] = useState<
    Record<string, Record<GenerationMode, string | null>>
  >({});

  const abortControllersRef = useRef<Record<string, AbortController>>({});

  // Hydrate full media artifacts from IndexedDB on initial mount
  useEffect(() => {
    void loadProjectsFromIndexedDb().then((idbProjects) => {
      if (idbProjects.length === 0) return;
      setSavedProjects((prev) =>
        prev.map((lp) => {
          const match = idbProjects.find((ip) => ip.id === lp.id);
          if (match && (match.revision ?? 0) >= (lp.revision ?? 0)) {
            return match;
          }
          return lp;
        })
      );
      setProject((prev) => {
        const match = idbProjects.find((ip) => ip.id === prev.id);
        if (match && (match.revision ?? 0) >= (prev.revision ?? 0)) {
          return {
            ...prev,
            artifacts: match.artifacts.length > 0 ? match.artifacts : prev.artifacts,
          };
        }
        return prev;
      });
    });
  }, []);

  // Derive synchronized active project with current undoState.present snapshot
  const activeProject = useMemo<CreativeProject>(() => {
    const refreshedArtifacts = refreshArtifactsCurrentness(project.artifacts, undoState.present);
    if (project.snapshot === undoState.present && refreshedArtifacts === project.artifacts) {
      return project;
    }
    return {
      ...project,
      snapshot: undoState.present,
      artifacts: refreshedArtifacts,
    };
  }, [project, undoState.present]);

  const activeProjectRef = useRef<CreativeProject>(activeProject);
  const undoStateRef = useRef<UndoRedoState>(undoState);
  useEffect(() => {
    activeProjectRef.current = activeProject;
    undoStateRef.current = undoState;
  }, [activeProject, undoState]);

  // Persist active project with CAS revision protection
  useEffect(() => {
    if (storageAlert?.type === 'conflict' && storageAlert.projectId === activeProject.id) {
      return;
    }
    const timer = setTimeout(() => {
      const res = saveProjectToLocalStorage(activeProject, {
        expectedPersistedRevision: activeProject.persistedRevision,
      });
      if (!res.saved) {
        if (res.conflictDetected) {
          setStorageAlert({
            type: 'conflict',
            projectId: activeProject.id,
            message:
              res.error ??
              'Storage conflict: a newer project revision was saved in another tab.',
          });
          return;
        }
        if (res.quotaExceeded) {
          setStorageAlert({
            type: 'quota',
            projectId: activeProject.id,
            message:
              res.error ??
              'Browser localStorage quota reached. Large media is kept in IndexedDB; export a JSON backup to be safe.',
          });
        }
      } else if (activeProject.persistedRevision !== activeProject.revision) {
        setProject((prev) =>
          prev.id === activeProject.id
            ? { ...prev, persistedRevision: activeProject.revision }
            : prev
        );
      }

      void saveProjectToIndexedDb(activeProject, {
        expectedPersistedRevision: activeProject.persistedRevision,
      });

      setSavedProjects((prev) => {
        const synced = { ...activeProject, persistedRevision: activeProject.revision };
        const idx = prev.findIndex((p) => p.id === synced.id);
        if (idx === -1) return [synced, ...prev];
        const copy = [...prev];
        copy[idx] = synced;
        return copy;
      });
    }, 250);
    return () => clearTimeout(timer);
  }, [activeProject, storageAlert]);

  // Multi-tab storage conflict listener
  useEffect(() => {
    const handleStorageEvent = (e: StorageEvent) => {
      if (e.key !== 'proactive_co_creator_projects_v2' || !e.newValue) return;
      try {
        const latest = loadProjectsFromLocalStorage();
        const current = activeProjectRef.current;
        const remoteMatch = latest.projects.find((p) => p.id === current.id);
        if (remoteMatch && (remoteMatch.revision ?? 1) > (current.persistedRevision ?? current.revision ?? 1)) {
          setStorageAlert({
            type: 'conflict',
            projectId: current.id,
            message: `Another tab saved revision #${remoteMatch.revision} while this tab is on revision #${current.revision}. Choose whether to reload the latest version or overwrite storage.`,
          });
        }
      } catch {
        // Ignore malformed storage events
      }
    };
    window.addEventListener('storage', handleStorageEvent);
    return () => window.removeEventListener('storage', handleStorageEvent);
  }, []);

  useEffect(() => {
    if (isDarkMode) {
      document.documentElement.classList.add('dark');
      document.body.style.backgroundColor = '#0d1117';
    } else {
      document.documentElement.classList.remove('dark');
      document.body.style.backgroundColor = '#f3f4f6';
    }
  }, [isDarkMode]);

  // Keyboard shortcuts for Undo / Redo
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable)) {
        return;
      }
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'z') {
        e.preventDefault();
        if (e.shiftKey) {
          setUndoState((prev) => performRedo(prev).state);
        } else {
          setUndoState((prev) => performUndo(prev).state);
        }
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  const commitTransaction = useCallback(
    (
      nextSnapshot: ProjectSnapshot,
      label: string,
      summary?: string,
      changeCount: number = 1,
      options?: { coalesceKey?: string; coalesceWindowMs?: number }
    ) => {
      const { project: nextProj, undoState: nextUndo } = commitSnapshotTransaction(
        activeProjectRef.current,
        undoStateRef.current,
        nextSnapshot,
        label,
        summary ?? label,
        changeCount,
        options
      );
      setUndoState(nextUndo);
      setProject(nextProj);
    },
    []
  );

  const selectedEntity = useMemo(() => {
    if (!selectedEntityId) return null;
    return (
      snapshot.entities.find(
        (e) => e.id === selectedEntityId || e.name === selectedEntityId
      ) ?? null
    );
  }, [snapshot.entities, selectedEntityId]);

  const selectedRelationship = useMemo(() => {
    if (!selectedRelationshipId) return null;
    return (
      snapshot.relationships.find((r) => r.id === selectedRelationshipId) ?? null
    );
  }, [snapshot.relationships, selectedRelationshipId]);

  const consistencyIssues = useMemo(
    () => evaluateProjectConsistency(snapshot),
    [snapshot]
  );

  const latestStoryArtifact = useMemo(
    () => activeProject.artifacts.find((a) => a.mode === 'story' && a.storyText),
    [activeProject.artifacts]
  );

  const latestImageArtifact = useMemo(
    () => activeProject.artifacts.find((a) => a.mode === 'image' && a.images && a.images.length > 0),
    [activeProject.artifacts]
  );

  const isCurrentOutputOutdated = useMemo(() => {
    const activeArt = mode === 'story' ? latestStoryArtifact : latestImageArtifact;
    return Boolean(activeArt?.isOutdated);
  }, [mode, latestStoryArtifact, latestImageArtifact]);

  // Scoped loading states for activeProject
  const isGraphLoading = isProjectActionLoading(inFlightTickets, activeProject.id, 'analyze');
  const isClarificationsLoading =
    isGraphLoading || isProjectActionLoading(inFlightTickets, activeProject.id, 'clarify');
  const isBatchLoading = isProjectActionLoading(inFlightTickets, activeProject.id, 'batch');
  const isGenerating = isProjectActionLoading(inFlightTickets, activeProject.id, 'generate');
  const isPolishingPrompt = isProjectActionLoading(inFlightTickets, activeProject.id, 'polish');

  const analysisError = analysisErrors[activeProject.id] ?? null;
  const clarificationError = clarificationErrors[activeProject.id] ?? null;
  const currentGalleryError = galleryErrors[activeProject.id]?.[mode] ?? null;
  const activePolishProposal = polishProposalsByProject[activeProject.id] ?? null;

  // --- Handlers for Deterministic Local Creative Edits ---

  const handleSetOriginalIdea = (newIdea: string) => {
    const next: ProjectSnapshot = {
      ...snapshot,
      originalIdea: newIdea,
    };
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
    const next: ProjectSnapshot = {
      ...snapshot,
      freeformNotes: notes,
    };
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
    if (newMode === mode) return;
    const next: ProjectSnapshot = {
      ...snapshot,
      mode: newMode,
    };
    next.refinedPrompt = synthesizeRefinedPrompt(next, newMode);
    commitTransaction(
      next,
      `Switch Mode to ${newMode === 'story' ? 'Story' : 'Image'}`,
      `Switched active generation mode to ${newMode}.`
    );
    setStatusNotification(
      `Switched to ${newMode === 'story' ? 'Story' : 'Image'} mode. Shared Story Bible and confirmed entities are preserved.`
    );
  };

  const handleAttributeChange = (
    entityName: string,
    attributeName: string,
    newValue: string
  ) => {
    const next = setEntityAttribute(snapshot, entityName, attributeName, newValue, 'user-edit');
    commitTransaction(
      next,
      `Set ${entityName} → ${attributeName}: ${newValue}`,
      `Updated ${entityName}'s ${attributeName} to "${newValue}".`
    );
  };

  const handleRenameEntity = (entityIdOrName: string, newName: string) => {
    const next = renameEntity(snapshot, entityIdOrName, newName, 'user-edit');
    commitTransaction(
      next,
      `Rename entity to "${newName}"`,
      `Renamed "${entityIdOrName}" to "${newName}" and updated all relationship references.`
    );
  };

  const handleAddEntity = (name: string, category: EntityCategory, description: string) => {
    const next = addEntity(snapshot, name, category, description, 'user-edit');
    commitTransaction(
      next,
      `Add ${category}: ${name}`,
      `Added new ${category} "${name}" to the Belief Graph.`
    );
  };

  const handleUpsertRelationship = (source: string, target: string, label: string) => {
    const next = upsertRelationship(snapshot, source, target, label, 'user-edit');
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
    const next = updateRelationshipById(snapshot, relationshipId, updates, 'user-edit');
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
    const next = removeRelationship(snapshot, relIdOrSource, target);
    commitTransaction(
      next,
      `Remove relationship`,
      `Removed relationship ${relIdOrSource}${target ? ` → ${target}` : ''}.`
    );
  };

  const handleUpdateStoryBible = (field: keyof StoryBibleFields, value: string) => {
    const next = updateStoryBibleField(snapshot, field, value, 'user-edit');
    commitTransaction(
      next,
      `Update Story Bible: ${field}`,
      `Set Story Bible ${field} to "${value}".`,
      1,
      { coalesceKey: `story-bible:${field}`, coalesceWindowMs: 2500 }
    );
  };

  const handleApplyDecisions = (
    decisionIds: string[],
    action: 'accept' | 'reject' | 'defer',
    customValues?: Record<string, string>
  ) => {
    const res = applyDecisionBatch(snapshot, decisionIds, action, customValues);
    if (res.conflicts.length > 0) {
      setStatusNotification(res.conflicts[0]);
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
    const pendingIds = snapshot.decisions
      .filter((d) => d.status === 'pending')
      .map((d) => d.id);
    if (pendingIds.length === 0) return;
    handleApplyDecisions(pendingIds, 'accept');
  };

  const handleInspectDecisionTarget = (decision: DecisionItem) => {
    if (decision.targetStoryField) {
      setRightPanelTab('story-bible');
      setMobileTab('inspector');
      return;
    }
    if (decision.targetRelationshipId) {
      const rel = snapshot.relationships.find((r) => r.id === decision.targetRelationshipId);
      if (rel) {
        setSelectedEntityId(null);
        setSelectedRelationshipId(rel.id ?? null);
        setRightPanelTab('inspector');
        setMobileTab('inspector');
        return;
      }
    }
    if (decision.targetEntityId || decision.targetEntityName) {
      const target = snapshot.entities.find(
        (e) =>
          e.id === decision.targetEntityId ||
          e.name.toLowerCase() === decision.targetEntityName?.toLowerCase()
      );
      if (target) {
        setSelectedRelationshipId(null);
        setSelectedEntityId(target.id ?? target.name);
        setRightPanelTab('inspector');
        setMobileTab('inspector');
      }
    }
  };

  // --- Natural-Language Batch Editing ---

  const handlePreviewBatchInstruction = async (
    instruction: string
  ): Promise<BatchEditProposalResult> => {
    const targetProject = activeProjectRef.current;
    const localResult = interpretBatchInstructionLocally(
      instruction,
      targetProject.snapshot,
      {
        projectId: targetProject.id,
        revision: targetProject.revision,
      }
    );
    if (
      (localResult.operations.length > 0 || localResult.ambiguities.length > 0) &&
      localResult.coverageComplete
    ) {
      return localResult;
    }

    const ticket = createRequestTicket(targetProject, 'batch');
    setInFlightTickets((prev) => registerTicket(prev, ticket));
    try {
      const aiResult = await requestBatchEditInterpretation(instruction, {
        prompt: targetProject.snapshot.refinedPrompt,
        entities: targetProject.snapshot.entities.map((e) => ({
          id: e.id,
          name: e.name,
          category: e.category,
          excluded: e.excluded,
          attributes: e.attributes.map((a) => ({
            name: a.name,
            value: a.confirmedValue ?? a.value[0]?.name ?? 'Unknown',
            status: a.status,
          })),
        })),
        relationships: targetProject.snapshot.relationships.map((r) => ({
          id: r.id,
          source: r.source,
          target: r.target,
          label: r.label,
        })),
      });
      if (aiResult.operations.length > 0 || aiResult.ambiguities.length > 0) {
        return {
          ...aiResult,
          baseProjectId: targetProject.id,
          baseRevision: targetProject.revision,
        };
      }
      return localResult;
    } catch {
      return localResult;
    } finally {
      setInFlightTickets((prev) => clearTicket(prev, ticket));
    }
  };

  const handleApplyBatchOperations = (
    operations: ProposedOperation[],
    instruction: string
  ) => {
    const res = applyProposedOperations(snapshot, operations, {
      expectedBaseRevision: activeProject.revision,
      currentRevision: activeProject.revision,
    });
    if (res.errors.length > 0) {
      setStatusNotification(res.errors[0].message);
      return;
    }
    if (res.appliedCount > 0) {
      commitTransaction(
        res.snapshot,
        `Batch Edit (${res.appliedCount} ops)`,
        `Applied natural-language batch edit: "${instruction}"`,
        res.appliedCount
      );
      setStatusNotification(`Applied ${res.appliedCount} batch operation(s). Undo available.`);
    }
  };

  // --- AI Analysis, Clarifications & Generation with Scoped Tickets ---

  const handleAnalyzeIdea = useCallback(async () => {
    const originProject = activeProjectRef.current;
    const originSnap = originProject.snapshot;
    const trimmed = originSnap.originalIdea.trim();
    if (!trimmed) return;

    const slotKey = `${originProject.id}:analyze`;
    abortControllersRef.current[slotKey]?.abort();
    const controller = new AbortController();
    abortControllersRef.current[slotKey] = controller;

    const ticket = createRequestTicket(originProject, 'analyze');
    setInFlightTickets((prev) => registerTicket(prev, ticket));
    setAnalysisErrors((prev) => ({ ...prev, [originProject.id]: null }));
    setClarificationErrors((prev) => ({ ...prev, [originProject.id]: null }));

    const confirmedFacts = [
      ...Object.entries(originSnap.storyBible)
        .filter(([, f]) => f.status === 'confirmed' && f.value)
        .map(([k, f]) => `${k}: ${f.value}`),
      ...originSnap.entities
        .filter((e) => !e.excluded)
        .flatMap((e) =>
          e.attributes
            .filter((a) => a.status === 'confirmed' && a.confirmedValue)
            .map((a) => `${e.name} ${a.name}: ${a.confirmedValue}`)
        ),
    ];

    try {
      const [newGraph, newClarifications] = await Promise.all([
        analyzePromptToBeliefGraph(trimmed, originSnap.mode, controller.signal).catch((err) => {
          if (!isAbortError(err)) {
            setAnalysisErrors((prev) => ({
              ...prev,
              [originProject.id]: getReadableErrorMessage(
                err,
                'Could not reach AI analysis service; local plan preserved.'
              ),
            }));
          }
          return null;
        }),
        generateClarifications(
          trimmed,
          [...originSnap.answeredQuestions, ...originSnap.skippedQuestions],
          originSnap.mode,
          controller.signal,
          confirmedFacts
        ).catch((err) => {
          if (!isAbortError(err)) {
            setClarificationErrors((prev) => ({
              ...prev,
              [originProject.id]: getReadableErrorMessage(
                err,
                'Could not fetch new AI questions; existing decisions preserved.'
              ),
            }));
          }
          return null;
        }),
      ]);

      if (newGraph || newClarifications) {
        const applied = applyAsyncAnalysisCompletion({
          ticket,
          activeProject: activeProjectRef.current,
          activeUndoState: undoStateRef.current,
          savedProjects,
          newGraph,
          newClarifications,
          label: 'Reanalyze Prompt with AI',
          summary: 'Merged AI analysis while preserving confirmed user decisions.',
        });
        setProject(applied.activeProject);
        setUndoState(applied.activeUndoState);
        setSavedProjects(applied.savedProjects);
        if (applied.rebasedOntoNewerRevision) {
          setStatusNotification(
            'Rebased AI analysis onto your latest edits without overwriting confirmed changes.'
          );
        }
      }
    } finally {
      setInFlightTickets((prev) => clearTicket(prev, ticket));
    }
  }, [savedProjects]);

  const handleRefreshClarifications = useCallback(
    async (preserveDrafts?: Record<string, string>) => {
      const originProject = activeProjectRef.current;
      const originSnap = originProject.snapshot;

      const slotKey = `${originProject.id}:clarify`;
      abortControllersRef.current[slotKey]?.abort();
      const controller = new AbortController();
      abortControllersRef.current[slotKey] = controller;

      const ticket = createRequestTicket(originProject, 'clarify');
      setInFlightTickets((prev) => registerTicket(prev, ticket));
      setClarificationErrors((prev) => ({ ...prev, [originProject.id]: null }));

      const confirmedFacts = originSnap.entities
        .filter((e) => !e.excluded)
        .flatMap((e) =>
          e.attributes
            .filter((a) => a.status === 'confirmed' && a.confirmedValue)
            .map((a) => `${e.name} ${a.name}: ${a.confirmedValue}`)
        );

      try {
        const freshClarifications = await generateClarifications(
          originSnap.refinedPrompt || originSnap.originalIdea,
          [...originSnap.answeredQuestions, ...originSnap.skippedQuestions],
          originSnap.mode,
          controller.signal,
          confirmedFacts
        );
        const applied = applyAsyncAnalysisCompletion({
          ticket,
          activeProject: activeProjectRef.current,
          activeUndoState: undoStateRef.current,
          savedProjects,
          newGraph: null,
          newClarifications: freshClarifications,
          preserveDraftAnswers: preserveDrafts,
          label: 'Request Additional Clarifications',
          summary: 'Added non-duplicate AI clarification questions.',
        });
        setProject(applied.activeProject);
        setUndoState(applied.activeUndoState);
        setSavedProjects(applied.savedProjects);
      } catch (err) {
        if (!isAbortError(err)) {
          setClarificationErrors((prev) => ({
            ...prev,
            [originProject.id]: getReadableErrorMessage(
              err,
              'Failed to request additional clarifications.'
            ),
          }));
        }
      } finally {
        setInFlightTickets((prev) => clearTicket(prev, ticket));
      }
    },
    [savedProjects]
  );

  const handleGenerateOutput = useCallback(async () => {
    const originProject = activeProjectRef.current;
    const originSnap = originProject.snapshot;
    const promptToUse = (originSnap.refinedPrompt || originSnap.originalIdea).trim();
    if (!promptToUse) return;

    const slotKey = `${originProject.id}:generate`;
    abortControllersRef.current[slotKey]?.abort();
    const controller = new AbortController();
    abortControllersRef.current[slotKey] = controller;

    const requestMode = originSnap.mode;
    const ticket = createRequestTicket(originProject, 'generate');
    setInFlightTickets((prev) => registerTicket(prev, ticket));
    setShowOutputDrawer(true);
    setGalleryErrors((prev) => ({
      ...prev,
      [originProject.id]: {
        ...(prev[originProject.id] ?? { story: null, image: null }),
        [requestMode]: null,
      },
    }));

    try {
      if (requestMode === 'story') {
        const generatedStory = await generateStoryFromPrompt(promptToUse, controller.signal);
        const applied = applyAsyncGenerationCompletion({
          ticket,
          activeProject: activeProjectRef.current,
          savedProjects,
          mode: 'story',
          promptUsed: promptToUse,
          storyText: generatedStory,
        });
        setProject(applied.activeProject);
        setSavedProjects(applied.savedProjects);
      } else {
        const result = await generateImagesFromPrompt(promptToUse, controller.signal);
        const applied = applyAsyncGenerationCompletion({
          ticket,
          activeProject: activeProjectRef.current,
          savedProjects,
          mode: 'image',
          promptUsed: promptToUse,
          images: result.images,
          warning: result.warning,
        });
        setProject(applied.activeProject);
        setSavedProjects(applied.savedProjects);
      }
    } catch (err) {
      if (!isAbortError(err)) {
        const message = getReadableErrorMessage(
          err,
          `Failed to generate ${requestMode}. Check your server API key configuration.`
        );
        setGalleryErrors((prev) => ({
          ...prev,
          [originProject.id]: {
            ...(prev[originProject.id] ?? { story: null, image: null }),
            [requestMode]: message,
          },
        }));
      }
    } finally {
      setInFlightTickets((prev) => clearTicket(prev, ticket));
    }
  }, [savedProjects]);

  const handlePolishPromptWithAi = async () => {
    const originProject = activeProjectRef.current;
    if (isProjectActionLoading(inFlightTickets, originProject.id, 'polish')) return;

    const ticket = createRequestTicket(originProject, 'polish');
    setInFlightTickets((prev) => registerTicket(prev, ticket));
    try {
      const polished = await refinePromptWithAllUpdates(
        originProject.snapshot.refinedPrompt,
        [],
        []
      );
      const proposal = createPolishProposal(originProject, polished);
      setPolishProposalsByProject((prev) => ({
        ...prev,
        [originProject.id]: proposal,
      }));
      setStatusNotification(
        'Staged AI narrative polish proposal. Review and accept or discard it in the Output panel.'
      );
    } catch (err) {
      setStatusNotification(
        getReadableErrorMessage(err, 'Could not run AI prompt polish; structured prompt preserved.')
      );
    } finally {
      setInFlightTickets((prev) => clearTicket(prev, ticket));
    }
  };

  const handleAcceptPolishProposal = () => {
    if (!activePolishProposal) return;
    const res = acceptPolishProposal(activeProject, undoState, activePolishProposal);
    setProject(res.project);
    setUndoState(res.undoState);
    setPolishProposalsByProject((prev) => {
      const next = { ...prev };
      delete next[activeProject.id];
      return next;
    });
    setStatusNotification('Accepted AI narrative polish. Undo is available.');
  };

  const handleRejectPolishProposal = () => {
    setPolishProposalsByProject((prev) => {
      const next = { ...prev };
      delete next[activeProject.id];
      return next;
    });
    setStatusNotification('Discarded staged AI narrative polish proposal.');
  };

  // --- Persistence, Conflict Resolution, History & Export/Import Handlers ---

  const handleReloadLatestFromStorage = () => {
    const latest = loadProjectsFromLocalStorage();
    const match = latest.projects.find((p) => p.id === activeProject.id) ?? latest.projects[0];
    if (!match) return;
    setSavedProjects(latest.projects);
    setProject(match);
    setUndoState(createUndoRedoState(match.snapshot));
    setStorageAlert(null);
    setStatusNotification(`Reloaded revision #${match.revision} from storage.`);
  };

  const handleForceOverwriteStorage = () => {
    const res = saveProjectToLocalStorage(activeProject, { forceOverwrite: true });
    void saveProjectToIndexedDb(activeProject, { forceOverwrite: true });
    if (res.saved) {
      setProject((prev) => ({ ...prev, persistedRevision: activeProject.revision }));
      setStorageAlert(null);
      setStatusNotification('Overwrote storage with your current tab version.');
    }
  };

  const handleUndo = () => {
    const { state, undoneLabel } = performUndo(undoState);
    setUndoState(state);
    if (undoneLabel) {
      setStatusNotification(`Undid: ${undoneLabel}`);
    }
  };

  const handleRedo = () => {
    const { state, redoneLabel } = performRedo(undoState);
    setUndoState(state);
    if (redoneLabel) {
      setStatusNotification(`Redid: ${redoneLabel}`);
    }
  };

  const handleRestoreRevision = (revisionId: string) => {
    const res = restoreProjectRevision(activeProject, undoState, revisionId);
    if (!res) return;
    setProject(res.project);
    setUndoState(res.undoState);
    setStatusNotification('Restored project revision safely (previous state saved in history).');
  };

  const handleResetSampleProject = () => {
    const sample = createSampleProject();
    setProject(sample);
    setUndoState(createUndoRedoState(sample.snapshot));
    setSelectedEntityId(null);
    setSelectedRelationshipId(null);
    setStorageAlert(null);
    saveProjectToLocalStorage(sample, { forceOverwrite: true });
    void saveProjectToIndexedDb(sample, { forceOverwrite: true });
    setStatusNotification('Loaded sample story plan: "Cat’s Woodland Dinner Party".');
  };

  const handleSwitchProject = (projectId: string) => {
    const target = savedProjects.find((p) => p.id === projectId);
    if (!target) return;
    setProject(target);
    setUndoState(createUndoRedoState(target.snapshot));
    setSelectedEntityId(null);
    setSelectedRelationshipId(null);
    setStorageAlert(null);
  };

  const handleCreateNewProject = (name: string, initialPrompt: string) => {
    const now = Date.now();
    const newSnap: ProjectSnapshot = {
      originalIdea: initialPrompt,
      refinedPrompt: initialPrompt,
      freeformNotes: '',
      mode: 'story',
      entities: [],
      relationships: [],
      storyBible: createEmptyStoryBible(now),
      clarifications: [],
      decisions: [],
      answeredQuestions: [],
      skippedQuestions: [],
    };
    const newProj: CreativeProject = {
      schemaVersion: 3,
      revision: 1,
      persistedRevision: 1,
      id: makeStableId('proj'),
      name,
      createdAt: now,
      updatedAt: now,
      snapshot: newSnap,
      artifacts: [],
      revisions: [
        {
          id: makeStableId('rev'),
          revisionNumber: 1,
          timestamp: now,
          label: 'Created Project',
          summary: `Created project "${name}"`,
          changeCount: 0,
          snapshot: structuredClone(newSnap),
        },
      ],
    };
    setProject(newProj);
    setUndoState(createUndoRedoState(newSnap));
    setSelectedEntityId(null);
    setSelectedRelationshipId(null);
    setStorageAlert(null);
    saveProjectToLocalStorage(newProj, { forceOverwrite: true });
    void saveProjectToIndexedDb(newProj, { forceOverwrite: true });
  };

  const handleDeleteProject = (projectId: string) => {
    const remaining = deleteProjectFromLocalStorage(projectId);
    setSavedProjects(remaining);
    if (project.id === projectId && remaining.length > 0) {
      setProject(remaining[0]);
      setUndoState(createUndoRedoState(remaining[0].snapshot));
      setSelectedEntityId(null);
      setSelectedRelationshipId(null);
    }
  };

  const handleExportJson = () => {
    downloadTextFile(
      `${activeProject.name.toLowerCase().replace(/[^a-z0-9]+/g, '-') || 'project'}.json`,
      exportProjectToJson(activeProject),
      'application/json;charset=utf-8'
    );
  };

  const handleExportStoryBibleMarkdown = () => {
    downloadTextFile(
      `${activeProject.name.toLowerCase().replace(/[^a-z0-9]+/g, '-') || 'story'}-bible.md`,
      exportStoryBibleMarkdown(activeProject),
      'text/markdown;charset=utf-8'
    );
  };

  const handleExportPromptText = () => {
    downloadTextFile('refined-prompt.md', snapshot.refinedPrompt, 'text/markdown;charset=utf-8');
  };

  const handleImportProjectJson = (rawJson: string): { ok: boolean; error?: string } => {
    try {
      const parsed = JSON.parse(rawJson) as unknown;
      const migrated = migrateProjectPayload(parsed);
      setProject(migrated);
      setUndoState(createUndoRedoState(migrated.snapshot));
      setSelectedEntityId(null);
      setSelectedRelationshipId(null);
      saveProjectToLocalStorage(migrated, { forceOverwrite: true });
      void saveProjectToIndexedDb(migrated, { forceOverwrite: true });
      setStatusNotification(`Imported project "${migrated.name}".`);
      return { ok: true };
    } catch (err) {
      return {
        ok: false,
        error: err instanceof Error ? err.message : 'Invalid project JSON file.',
      };
    }
  };

  const handleSelectHeaderSection = (section: WorkspaceSection) => {
    if (section === 'story-bible') {
      setRightPanelTab('story-bible');
      setMobileTab('inspector');
    } else if (section === 'history') {
      setRightPanelTab('history');
      setMobileTab('inspector');
    } else if (section === 'output') {
      setShowOutputDrawer(true);
      setMobileTab('output');
    } else {
      setRightPanelTab('inspector');
      setMobileTab('graph');
    }
  };

  const pendingDecisions = useMemo(
    () => snapshot.decisions.filter((d) => d.status === 'pending'),
    [snapshot.decisions]
  );
  const pendingDecisionCount = pendingDecisions.length;

  return (
    <div
      className={`${
        isDarkMode ? 'dark' : ''
      } font-sans h-screen flex flex-col bg-gray-100 dark:bg-gray-950 text-gray-900 dark:text-gray-100 transition-colors duration-150 overflow-hidden`}
    >
      <Header
        isDarkMode={isDarkMode}
        toggleDarkMode={() => setIsDarkMode((prev) => !prev)}
        onShowInfo={() => setShowInfoModal(true)}
        onSelectSection={handleSelectHeaderSection}
        onLoadSampleProject={handleResetSampleProject}
      />

      {/* Storage Conflict / Quota Recovery Banner */}
      {storageAlert && (
        <div
          role="alert"
          aria-label="Storage conflict or quota alert"
          className="bg-amber-50 dark:bg-amber-950/80 border-b border-amber-300 dark:border-amber-800 px-4 py-2.5 flex flex-wrap items-center justify-between gap-3 text-xs text-amber-950 dark:text-amber-100 flex-shrink-0 z-40"
        >
          <span className="font-medium">{storageAlert.message}</span>
          <div className="flex flex-wrap items-center gap-2">
            {storageAlert.type === 'conflict' && (
              <>
                <button
                  type="button"
                  onClick={handleReloadLatestFromStorage}
                  className="px-2.5 py-1 rounded font-semibold bg-amber-700 hover:bg-amber-800 text-white"
                >
                  Reload Latest from Storage
                </button>
                <button
                  type="button"
                  onClick={handleForceOverwriteStorage}
                  className="px-2.5 py-1 rounded font-semibold bg-white dark:bg-gray-800 border border-amber-400 dark:border-amber-700 text-amber-900 dark:text-amber-200 hover:bg-amber-100"
                >
                  Keep My Version (Overwrite)
                </button>
              </>
            )}
            <button
              type="button"
              onClick={handleExportJson}
              className="px-2.5 py-1 rounded font-medium bg-white dark:bg-gray-800 border border-amber-400 dark:border-amber-700 text-amber-900 dark:text-amber-200 hover:bg-amber-100"
            >
              Export Backup JSON
            </button>
            <button
              type="button"
              onClick={() => setStorageAlert(null)}
              className="text-amber-700 dark:text-amber-300 hover:underline px-1"
            >
              Dismiss
            </button>
          </div>
        </div>
      )}

      {statusNotification && (
        <div
          className="fixed top-16 left-1/2 -translate-x-1/2 z-[2000] px-4 w-full max-w-md"
          role="status"
          aria-live="polite"
        >
          <div className="bg-gray-900 dark:bg-gray-800 border border-gray-700 text-white px-4 py-2.5 rounded-lg shadow-lg flex items-center justify-between gap-3 text-xs">
            <span className="font-medium">{statusNotification}</span>
            <button
              type="button"
              onClick={() => setStatusNotification(null)}
              className="text-gray-300 hover:text-white px-1.5 py-0.5 rounded"
              aria-label="Dismiss status notification"
            >
              &times;
            </button>
          </div>
        </div>
      )}

      {/* Unified Three-Panel Desktop Workspace */}
      <main className="flex-1 grid grid-cols-1 xl:grid-cols-12 gap-3 p-3 overflow-hidden min-h-0">
        {/* Left Panel (3 cols on xl): Decision Inbox, Clarifications 2.0 & Natural-Language Batch Editing */}
        <div
          className={`xl:col-span-3 h-full min-h-0 ${
            mobileTab === 'decisions' ? 'flex flex-col' : 'hidden xl:flex xl:flex-col'
          }`}
        >
          <DecisionInboxPanel
            decisions={snapshot.decisions}
            onApplyDecisions={handleApplyDecisions}
            onInspectDecisionTarget={handleInspectDecisionTarget}
            onRefreshClarifications={handleRefreshClarifications}
            isClarificationsLoading={isClarificationsLoading}
            clarificationError={clarificationError}
            onPreviewBatchInstruction={handlePreviewBatchInstruction}
            onApplyBatchOperations={handleApplyBatchOperations}
            isBatchLoading={isBatchLoading}
          />
        </div>

        {/* Center Panel (6 cols on xl): Seed Prompt + Interactive Belief Graph 2.0 + Collapsible Output Deck */}
        <div
          className={`xl:col-span-6 h-full min-h-0 flex-col gap-3 ${
            mobileTab === 'graph' || mobileTab === 'output' ? 'flex' : 'hidden xl:flex'
          }`}
        >
          <PromptInput
            prompt={snapshot.originalIdea}
            setPrompt={handleSetOriginalIdea}
            onSubmit={handleGenerateOutput}
            onAnalyze={handleAnalyzeIdea}
            isLoading={isGraphLoading || isGenerating}
            isGenerating={isGenerating}
            isFirstRun={!latestStoryArtifact && !latestImageArtifact}
            mode={mode}
            setMode={handleModeChange}
          />

          <div
            className={`flex-1 min-h-0 flex flex-col ${
              mobileTab === 'output' ? 'hidden xl:flex' : 'flex'
            }`}
          >
            <BeliefGraph
              data={{
                prompt: snapshot.originalIdea,
                entities: snapshot.entities,
                relationships: snapshot.relationships,
              }}
              isLoading={isGraphLoading}
              error={analysisError}
              selectedEntity={selectedEntity}
              selectedRelationship={selectedRelationship}
              onSelectEntity={(ent) => {
                setSelectedEntityId(ent ? (ent.id ?? ent.name) : null);
                if (ent) {
                  setSelectedRelationshipId(null);
                  setRightPanelTab('inspector');
                }
              }}
              onSelectRelationship={(rel: Relationship | null) => {
                setSelectedRelationshipId(rel?.id ?? null);
                if (rel) {
                  setSelectedEntityId(null);
                  setRightPanelTab('inspector');
                }
              }}
              onRelationshipChange={handleUpsertRelationship}
              onAttributeChange={handleAttributeChange}
              currentPrompt={snapshot.originalIdea}
            />
          </div>

          {(showOutputDrawer || mobileTab === 'output') && (
            <div
              className={`flex-shrink-0 ${
                mobileTab === 'output'
                  ? 'flex-1 min-h-0 xl:flex-none xl:h-52'
                  : latestStoryArtifact || latestImageArtifact || activePolishProposal
                    ? 'hidden xl:block xl:h-56'
                    : 'hidden xl:block xl:h-40'
              }`}
            >
              <OutputDisplay
                originalIdea={snapshot.originalIdea}
                refinedPrompt={snapshot.refinedPrompt}
                freeformNotes={snapshot.freeformNotes}
                onChangeFreeformNotes={handleSetFreeformNotes}
                onPolishPromptWithAi={handlePolishPromptWithAi}
                isPolishingPrompt={isPolishingPrompt}
                polishProposal={activePolishProposal}
                onAcceptPolishProposal={handleAcceptPolishProposal}
                onRejectPolishProposal={handleRejectPolishProposal}
                artifacts={activeProject.artifacts}
                images={latestImageArtifact?.images ?? []}
                imageWarning={latestImageArtifact?.warning ?? null}
                story={latestStoryArtifact?.storyText ?? null}
                mode={mode}
                isLoading={isGenerating}
                error={currentGalleryError}
                isOutdated={isCurrentOutputOutdated}
                onGenerate={handleGenerateOutput}
              />
            </div>
          )}
        </div>

        {/* Right Panel (3 cols on xl): Contextual Inspector, Story Bible, Consistency, History & Export */}
        <div
          className={`xl:col-span-3 h-full min-h-0 ${
            mobileTab === 'inspector' ? 'flex flex-col' : 'hidden xl:flex xl:flex-col'
          }`}
        >
          <ContextualInspector
            activeTab={rightPanelTab}
            onSelectTab={setRightPanelTab}
            project={activeProject}
            savedProjects={savedProjects}
            selectedEntity={selectedEntity}
            selectedRelationship={selectedRelationship}
            onSelectEntity={(ent) => {
              setSelectedEntityId(ent ? (ent.id ?? ent.name) : null);
              if (ent) setSelectedRelationshipId(null);
            }}
            onSelectRelationship={(rel) => {
              setSelectedRelationshipId(rel?.id ?? null);
              if (rel) setSelectedEntityId(null);
            }}
            onAttributeChange={handleAttributeChange}
            onRenameEntity={handleRenameEntity}
            onAddEntity={handleAddEntity}
            onUpsertRelationship={handleUpsertRelationship}
            onUpdateRelationshipById={handleUpdateRelationshipById}
            onRemoveRelationship={handleRemoveRelationship}
            onUpdateStoryBible={handleUpdateStoryBible}
            consistencyIssues={consistencyIssues}
            onRestoreRevision={handleRestoreRevision}
            onSwitchProject={handleSwitchProject}
            onCreateNewProject={handleCreateNewProject}
            onDeleteProject={handleDeleteProject}
            onExportJson={handleExportJson}
            onExportStoryBibleMarkdown={handleExportStoryBibleMarkdown}
            onExportPromptText={handleExportPromptText}
            onImportProjectJson={handleImportProjectJson}
            isLoading={isGraphLoading}
          />
        </div>
      </main>

      {/* Mobile Workspace Switcher (< xl) */}
      <nav
        aria-label="Mobile workspace panels"
        className="xl:hidden bg-white dark:bg-gray-900 border-t border-gray-200 dark:border-gray-800 grid grid-cols-4 gap-1 px-2 py-1.5 flex-shrink-0"
      >
        {(
          [
            ['decisions', `Inbox (${pendingDecisionCount})`],
            ['graph', 'Belief Graph'],
            ['inspector', 'Inspector'],
            ['output', 'Output'],
          ] as const
        ).map(([tabKey, label]) => (
          <button
            key={tabKey}
            type="button"
            onClick={() => setMobileTab(tabKey)}
            aria-current={mobileTab === tabKey ? 'page' : undefined}
            className={`py-2 px-1 text-xs font-semibold rounded-md transition-colors whitespace-nowrap text-center ${
              mobileTab === tabKey
                ? 'text-blue-600 dark:text-blue-400 bg-blue-50/50 dark:bg-blue-950/40'
                : 'text-gray-600 dark:text-gray-400'
            }`}
          >
            {label}
          </button>
        ))}
      </nav>

      {/* Bottom Area: Undo/Redo, Pending Change Review & Generation */}
      <WorkspaceBottomBar
        pendingDecisionCount={pendingDecisionCount}
        canUndo={undoState.past.length > 0}
        canRedo={undoState.future.length > 0}
        undoLabel={undoState.past[undoState.past.length - 1]?.label}
        redoLabel={undoState.future[0]?.label}
        onUndo={handleUndo}
        onRedo={handleRedo}
        onAcceptAllPending={handleAcceptAllPendingDecisions}
        onReviewChanges={() => setIsReviewModalOpen(true)}
        mode={mode}
        onModeChange={handleModeChange}
        onGenerate={handleGenerateOutput}
        isGenerating={isGenerating}
        showOutputDrawer={showOutputDrawer}
        onToggleOutputDrawer={() => setShowOutputDrawer((prev) => !prev)}
        revisionCount={activeProject.revisions.length}
        isOutdated={isCurrentOutputOutdated}
      />

      {/* Dedicated Review Plan & Prompt Changes Modal (AC19) */}
      {isReviewModalOpen && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label="Review Plan and Prompt Changes"
          className="fixed inset-0 z-[1900] bg-black/60 flex items-center justify-center p-4 backdrop-blur-xs"
          onClick={() => setIsReviewModalOpen(false)}
        >
          <div
            className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-xl shadow-2xl w-full max-w-3xl max-h-[85vh] flex flex-col overflow-hidden"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="px-5 py-3.5 border-b border-gray-200 dark:border-gray-800 flex items-center justify-between">
              <div>
                <h2 className="font-display text-base font-bold text-gray-900 dark:text-gray-100">
                  Review Story Plan, Pending Decisions &amp; Prompt Diff
                </h2>
                <p className="text-xs text-gray-500 dark:text-gray-400">
                  Project Revision #{activeProject.revision} · {pendingDecisionCount} pending inbox item(s) ·{' '}
                  {consistencyIssues.length} consistency warning(s)
                </p>
              </div>
              <button
                type="button"
                onClick={() => setIsReviewModalOpen(false)}
                className="text-sm font-semibold text-gray-500 hover:text-gray-900 dark:hover:text-white px-2 py-1"
              >
                Close
              </button>
            </div>

            <div className="flex-1 overflow-y-auto p-5 space-y-4 text-xs">
              {/* Pending Decisions Summary */}
              <div className="p-3.5 rounded-lg border border-gray-200 dark:border-gray-800 bg-gray-50/60 dark:bg-gray-950/40 space-y-2">
                <div className="flex items-center justify-between">
                  <h3 className="font-bold text-gray-900 dark:text-gray-100">
                    Pending Creative Decisions ({pendingDecisionCount})
                  </h3>
                  {pendingDecisionCount > 0 && (
                    <button
                      type="button"
                      onClick={handleAcceptAllPendingDecisions}
                      className="px-2.5 py-1 rounded font-semibold bg-blue-600 hover:bg-blue-700 text-white"
                    >
                      Accept All Pending ({pendingDecisionCount})
                    </button>
                  )}
                </div>
                {pendingDecisionCount === 0 ? (
                  <p className="text-gray-500">All creative decisions are currently resolved.</p>
                ) : (
                  <ul className="space-y-1.5 max-h-36 overflow-y-auto">
                    {pendingDecisions.map((d) => (
                      <li
                        key={d.id}
                        className="flex items-center justify-between gap-2 p-2 rounded bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800"
                      >
                        <span className="truncate">
                          <strong className="capitalize">{d.category}:</strong> {d.title} &rarr;{' '}
                          <span className="text-blue-600 dark:text-blue-400 font-semibold">
                            {d.proposedValue}
                          </span>
                        </span>
                        <div className="flex items-center gap-1 shrink-0">
                          <button
                            type="button"
                            onClick={() => handleApplyDecisions([d.id], 'accept')}
                            className="px-2 py-0.5 rounded bg-blue-600 text-white font-semibold"
                          >
                            Accept
                          </button>
                          <button
                            type="button"
                            onClick={() => handleApplyDecisions([d.id], 'reject')}
                            className="px-2 py-0.5 rounded bg-gray-200 dark:bg-gray-800 text-red-600 dark:text-red-400 font-medium"
                          >
                            Reject
                          </button>
                        </div>
                      </li>
                    ))}
                  </ul>
                )}
              </div>

              {/* Recent Revisions Summary */}
              <div className="p-3.5 rounded-lg border border-gray-200 dark:border-gray-800 space-y-2">
                <h3 className="font-bold text-gray-900 dark:text-gray-100">
                  Recent Plan Revisions ({activeProject.revisions.length})
                </h3>
                <div className="space-y-1.5 max-h-36 overflow-y-auto">
                  {activeProject.revisions.slice(0, 5).map((rev, idx) => (
                    <div
                      key={rev.id}
                      className="flex items-center justify-between gap-2 p-2 rounded bg-gray-50 dark:bg-gray-950 border border-gray-200 dark:border-gray-800"
                    >
                      <div>
                        <span className="font-semibold text-gray-900 dark:text-gray-100">
                          Rev #{rev.revisionNumber ?? activeProject.revisions.length - idx}: {rev.label}
                        </span>
                        <p className="text-[11px] text-gray-500">{rev.summary}</p>
                      </div>
                      {idx > 0 && (
                        <button
                          type="button"
                          onClick={() => handleRestoreRevision(rev.id)}
                          className="px-2.5 py-1 rounded border border-gray-300 dark:border-gray-700 hover:bg-gray-100 dark:hover:bg-gray-800 font-medium shrink-0"
                        >
                          Restore
                        </button>
                      )}
                    </div>
                  ))}
                </div>
              </div>

              {/* Synthesized Prompt Preview */}
              <div className="space-y-1.5">
                <h3 className="font-bold text-gray-900 dark:text-gray-100">
                  Authoritative Synthesized Prompt ({mode === 'story' ? 'Story Mode' : 'Image Mode'})
                </h3>
                <pre className="p-3 rounded-lg bg-gray-50 dark:bg-gray-950 border border-gray-200 dark:border-gray-800 text-xs font-mono whitespace-pre-wrap leading-relaxed max-h-56 overflow-y-auto">
                  {snapshot.refinedPrompt}
                </pre>
              </div>
            </div>

            <div className="px-5 py-3 border-t border-gray-200 dark:border-gray-800 flex items-center justify-end gap-2">
              <button
                type="button"
                onClick={() => {
                  setIsReviewModalOpen(false);
                  setRightPanelTab('story-bible');
                }}
                className="px-3 py-1.5 text-xs font-medium rounded-lg border border-gray-300 dark:border-gray-700 hover:bg-gray-100 dark:hover:bg-gray-800"
              >
                Open Story Bible
              </button>
              <button
                type="button"
                onClick={() => setIsReviewModalOpen(false)}
                className="px-4 py-1.5 text-xs font-semibold rounded-lg bg-blue-600 hover:bg-blue-700 text-white"
              >
                Done
              </button>
            </div>
          </div>
        </div>
      )}

      <InfoModal isOpen={showInfoModal} onClose={() => setShowInfoModal(false)} />
    </div>
  );
}

export default App;
