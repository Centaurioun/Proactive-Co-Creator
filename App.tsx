/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { lazy, Suspense, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import ManuscriptEditor from './components/manuscript/ManuscriptEditor';
import type { PendingProposalReview } from './components/workspace/review/proposalReviewContext';
import AdaptivePlanWorkspace, { type PlanInspectorDestination } from './components/workspace/AdaptivePlanWorkspace';
import ChunkErrorBoundary, { createRetryableLazy } from './components/workspace/ChunkErrorBoundary';
import HistoryPanel from './components/inspector/HistoryPanel';
import AiSettingsModal from './components/workspace/AiSettingsModal';
import CreateProjectDialog from './components/projects/CreateProjectDialog';
import StorageAlertBanner, { type StorageConflictAlert } from './components/workspace/StorageAlertBanner';
import ReviewDiffModal from './components/workspace/ReviewDiffModal';
import BeliefGraph from './components/BeliefGraph';
import ContextualInspector, { type RightPanelTab } from './components/ContextualInspector';
import DecisionInboxPanel from './components/DecisionInboxPanel';
import Header, { type WorkspaceSection } from './components/Header';
import InfoModal from './components/InfoModal';
import OutputDisplay from './components/OutputGallery';
import PromptInput from './components/PromptInput';
import WorkspaceBottomBar from './components/WorkspaceBottomBar';
import { manuscriptSections, manuscriptText } from './lib/narrative/manuscriptModel';
import { parseProjectBackup, registryReport, safeFilename } from './lib/narrative/recovery';
import {
  buildContentExportEntries,
  downloadBinaryFile,
  downloadTextFile,
  triggerManuscriptDocxDownload,
  triggerManuscriptMarkdownDownload,
  triggerManuscriptTextDownload,
  triggerProjectBackupDownload,
  triggerRefinedPromptDownload,
  triggerStoryBibleMarkdownDownload,
} from './lib/workspace/projectExports';
import { getSavePresentation } from './lib/workspace/savePresentation';
import { readBrowserWorkspacePreference, writeBrowserWorkspacePreference } from './lib/workspacePreference';
import { useProjectPersistence } from './lib/controller/useProjectPersistence';
import { useDurableWorkspaceActions } from './lib/controller/useDurableWorkspaceActions';
import { useCanonicalPlanHandlers, useGlobalWorkspaceShortcuts } from './lib/controller/useCanonicalPlanHandlers';
import {
  AUTO_BACKUP_PREF_KEY,
  useNarrativeWorkflowActions,
} from './lib/controller/useNarrativeWorkflowActions';
import { getReadableErrorMessage, useAiPlanActions } from './lib/controller/useAiPlanActions';
import { createSampleProject } from './lib/canonicalModel';
import { evaluateProjectConsistency } from './lib/consistencyChecker';
import {
  createUndoRedoState,
  serializeUndoHistory,
  type UndoRedoState,
} from './lib/historyEngine';
import { projectRelationships } from './lib/narrative/projections/relationshipProjection';
import {
  buildReviewDiffModel,
  createAiTicketAuthority,
  isProjectActionLoading,
  prepareProjectSwitch,
  refreshArtifactsCurrentness,
  runAsyncAnalysisSlot,
  type AiTicketAuthority,
  type InFlightTicketsMap,
  type SerializedSaveOptions,
} from './lib/projectController';
import { buildStartupAnalysisProviderInputs } from './lib/promptBuilder';
import { deleteProjectCompletely, loadProjectsFromLocalStorage, type IndexedDbLoadStatus } from './lib/storageEngine';
import { analyzePromptToBeliefGraph, generateClarifications } from './services/apiClient';
import { MAX_PROMPT_CHARS, validateEffectivePromptLength } from './shared/schemas';
import type {
  BatchEditProposalResult,
  CreativeProject,
  GenerationMode,
  Relationship,
  StoryBibleFields,
} from './shared/types';

const { Component: ImportWorkflow, retry: retryImportWorkflow } = createRetryableLazy(() =>
  lazy(() => import('./components/narrativeImport/ImportWorkflow'))
);
const { Component: NarrativeReview, retry: retryNarrativeReview } = createRetryableLazy(() =>
  lazy(() => import('./components/workspace/NarrativeReview'))
);
const { Component: ProjectHub, retry: retryProjectHub } = createRetryableLazy(() =>
  lazy(() => import('./components/workspace/ProjectHub'))
);
const { Component: AiConnectionsPanel, retry: retryAiConnectionsPanel } = createRetryableLazy(() =>
  lazy(() => import('./components/settings/AiConnectionsPanel'))
);

type MobileTab = 'decisions' | 'graph' | 'inspector' | 'output';

function readInitialAutoBackupPref(): boolean {
  try {
    return window.localStorage?.getItem(AUTO_BACKUP_PREF_KEY) === 'true';
  } catch {
    return false;
  }
}

function resolveInitialProject(initialData: ReturnType<typeof loadProjectsFromLocalStorage>): CreativeProject {
  return (
    initialData.projects.find((p) => p.id === initialData.activeProjectId) ??
    initialData.projects[0] ??
    createSampleProject()
  );
}

const LazyViewFallback = ({ label }: { label: string }) => (
  <div className="flex flex-1 items-center justify-center p-6 text-sm text-pcc-muted dark:text-pcc-dark-muted">
    Loading {label}…
  </div>
);

function App() {
  const initialData = useMemo(
    () => loadProjectsFromLocalStorage({ skipAutoSeedIfEmpty: true, readOnly: true }),
    []
  );
  const initialProject = useMemo(() => resolveInitialProject(initialData), [initialData]);

  const [savedProjects, setSavedProjects] = useState<CreativeProject[]>(initialData.projects);
  const [project, setProject] = useState<CreativeProject>(initialProject);
  const [undoState, setUndoState] = useState<UndoRedoState>(() =>
    createUndoRedoState(initialProject.snapshot, initialProject.revisions, initialProject.undoHistory)
  );

  const snapshot = undoState.present;
  const mode = snapshot.mode;

  const [selectedEntityId, setSelectedEntityId] = useState<string | null>(null);
  const [selectedRelationshipId, setSelectedRelationshipId] = useState<string | null>(null);
  const [rightPanelTab, setRightPanelTab] = useState<RightPanelTab>('inspector');
  const [adoptArtifactId, setAdoptArtifactId] = useState<string>();
  const [focusedSectionId, setFocusedSectionId] = useState<string>();
  const [historyTarget, setHistoryTarget] = useState<{ id: string; sequence: number } | null>(null);
  const [resumedProposalReview, setResumedProposalReview] = useState<PendingProposalReview>();
  const [workspaceMode, setWorkspaceMode] = useState<
    'write' | 'plan' | 'review' | 'projects' | 'import'
  >(readBrowserWorkspacePreference);
  const lastStableWorkspaceModeRef = useRef<'write' | 'plan'>(
    workspaceMode === 'write' || workspaceMode === 'plan' ? workspaceMode : 'write'
  );
  const [autoAnalysisCallsUsed, setAutoAnalysisCallsUsed] = useState<number>(0);
  const [autoBackupEnabled, setAutoBackupEnabled] = useState<boolean>(readInitialAutoBackupPref);

  const draftDirtyRef = useRef(false);
  const compositionPendingRef = useRef(false);
  const restorePendingRef = useRef(false);

  const [mobileTab, setMobileTab] = useState<MobileTab>('graph');
  const [showOutputDrawer, setShowOutputDrawer] = useState<boolean>(false);
  const [isDarkMode, setIsDarkMode] = useState<boolean>(false);
  const [showInfoModal, setShowInfoModal] = useState<boolean>(false);
  const [showAiSettings, setShowAiSettings] = useState<boolean>(false);
  const [createProjectOpen, setCreateProjectOpen] = useState(false);
  const [createProjectPending, setCreateProjectPending] = useState(false);
  const [manuscriptDraftDirty, setManuscriptDraftDirty] = useState(false);
  const [restorePending, setRestorePending] = useState(false);
  const [pendingDurableSaveProjectIds, setPendingDurableSaveProjectIds] = useState<Set<string>>(
    () => new Set()
  );
  const [isReviewModalOpen, setIsReviewModalOpen] = useState<boolean>(false);
  const [statusNotification, setStatusNotification] = useState<string | null>(null);
  const [storageAlert, setStorageAlert] = useState<StorageConflictAlert | null>(null);

  useEffect(() => {
    if (workspaceMode === 'projects' || workspaceMode === 'import') return;
    if (workspaceMode === 'write' || workspaceMode === 'plan') {
      lastStableWorkspaceModeRef.current = workspaceMode;
    }
    writeBrowserWorkspacePreference(workspaceMode);
  }, [workspaceMode]);

  const allowNavigation = useCallback((): boolean => {
    if (!draftDirtyRef.current && !restorePendingRef.current && !compositionPendingRef.current) {
      return true;
    }
    setStatusNotification(
      compositionPendingRef.current
        ? 'Finish text composition before changing workspaces.'
        : 'Save the open manuscript draft or wait for the restore before leaving this workspace.'
    );
    return false;
  }, []);

  const [stagedBatchPreview, setStagedBatchPreview] = useState<BatchEditProposalResult | null>(null);
  const [stagedDecisionDrafts, setStagedDecisionDrafts] = useState<Record<string, string>>({});
  const [storyBibleErrors, setStoryBibleErrors] = useState<
    Partial<Record<keyof StoryBibleFields, string>>
  >({});
  const [focusedStoryBibleField, setFocusedStoryBibleField] = useState<{
    field: keyof StoryBibleFields;
    seq: number;
  } | null>(null);

  const [inFlightTickets, setInFlightTickets] = useState<InFlightTicketsMap>({});
  const [aiTicketAuthority] = useState<AiTicketAuthority>(() =>
    createAiTicketAuthority((nextTickets) => {
      setInFlightTickets(nextTickets);
    })
  );
  const aiTicketAuthorityRef = useRef<AiTicketAuthority>(aiTicketAuthority);
  const [analysisErrors, setAnalysisErrors] = useState<Record<string, string | null>>({});
  const [clarificationErrors, setClarificationErrors] = useState<Record<string, string | null>>({});
  const [galleryErrors, setGalleryErrors] = useState<
    Record<string, Record<GenerationMode, string | null>>
  >({});
  const hasLocalEditsSinceMountRef = useRef<boolean>(false);

  useEffect(
    () => () => {
      aiTicketAuthorityRef.current?.invalidateAll();
    },
    []
  );

  const reviewButtonRef = useRef<HTMLButtonElement | null>(null);

  const activeProject = useMemo<CreativeProject>(() => {
    const refreshedArtifacts = refreshArtifactsCurrentness(project.artifacts, undoState.present);
    const nextUndoHistory = serializeUndoHistory(undoState);
    return {
      ...project,
      snapshot: undoState.present,
      artifacts: refreshedArtifacts,
      undoHistory: nextUndoHistory,
    };
  }, [project, undoState]);

  const activeProjectRef = useRef<CreativeProject>(activeProject);
  const undoStateRef = useRef<UndoRedoState>(undoState);
  const savedProjectsRef = useRef<CreativeProject[]>(savedProjects);
  useEffect(() => {
    activeProjectRef.current = activeProject;
    undoStateRef.current = undoState;
    savedProjectsRef.current = savedProjects;
  }, [activeProject, undoState, savedProjects]);

  const publishCurrentProject = useCallback((current: CreativeProject, undo: UndoRedoState) => {
    activeProjectRef.current = current;
    undoStateRef.current = undo;
    setProject(current);
    setUndoState(undo);
  }, []);

  const gateRef = useRef<() => 'pending' | 'ready' | 'unavailable' | 'blocked-read-error'>(
    () => 'pending'
  );
  const acceptReadStatusRef = useRef<(status: IndexedDbLoadStatus) => void>(
    () => {}
  );
  const cancelAutosaveRef = useRef<() => void>(() => {});

  const transientSetters = useMemo(
    () => ({
      setSelectedEntityId,
      setSelectedRelationshipId,
      setStoryBibleErrors,
      setAdoptArtifactId,
      setFocusedSectionId,
      setHistoryTarget,
      setResumedProposalReview,
    }),
    []
  );

  const durableActions = useDurableWorkspaceActions({
    activeProjectRef,
    undoStateRef,
    savedProjectsRef,
    hasLocalEditsSinceMountRef,
    draftDirtyRef,
    restorePendingRef,
    aiTicketAuthorityRef,
    publishCurrentProject,
    setSavedProjects,
    setProject,
    setManuscriptDraftDirty,
    setRestorePending,
    setCreateProjectPending,
    setCreateProjectOpen,
    setPendingDurableSaveProjectIds,
    setStorageAlert,
    storageAlert,
    setStatusNotification,
    setWorkspaceMode,
    allowNavigation,
    getHydrationGate: () => gateRef.current(),
    acceptReadStatus: (status) => acceptReadStatusRef.current(status),
    cancelAutosave: () => cancelAutosaveRef.current(),
    transientSetters,
  });

  const {
    saveQueueRef,
    canWriteWorkspace,
    resetProjectSaveState,
    selectProject,
    flushProjectDurably,
    handleReloadLatestFromStorage,
    handleForceOverwriteStorage,
    handleResetSampleProject,
    handleCreateNewProject,
    applyPostDeleteState,
    handleImportProjectJson,
    handleRestoreArchiveProjects,
  } = durableActions;

  const persistenceWorkspace = useMemo(
    () => ({
      read: () => ({
        project: activeProjectRef.current,
        undo: undoStateRef.current,
        projects: savedProjectsRef.current,
        edited: hasLocalEditsSinceMountRef.current,
        draftPending:
          draftDirtyRef.current || restorePendingRef.current || compositionPendingRef.current,
      }),
      publish: (next: {
        savedProjects: CreativeProject[];
        activeProject: CreativeProject;
        activeUndoState: UndoRedoState;
      }) => {
        savedProjectsRef.current = next.savedProjects;
        setSavedProjects(next.savedProjects);
        if (next.activeProject !== activeProjectRef.current || next.activeUndoState !== undoStateRef.current) {
          publishCurrentProject(next.activeProject, next.activeUndoState);
        }
      },
      initialize: (candidate: CreativeProject, options?: SerializedSaveOptions) =>
        saveQueueRef.current.enqueue(candidate, options),
    }),
    [publishCurrentProject, saveQueueRef]
  );

  const {
    gate: hydrationGate,
    getGate: getHydrationGate,
    acceptReadStatus,
    cancelAutosave,
  } = useProjectPersistence({
    project: activeProject,
    startup: initialData,
    workspace: persistenceWorkspace,
    persist: flushProjectDurably,
    alert: storageAlert,
    report: setStorageAlert,
  });
  useLayoutEffect(() => {
    gateRef.current = getHydrationGate;
    acceptReadStatusRef.current = acceptReadStatus;
    cancelAutosaveRef.current = cancelAutosave;
  }, [getHydrationGate, acceptReadStatus, cancelAutosave]);
  const hydrationSettled = hydrationGate === 'ready' || hydrationGate === 'unavailable';

  const aiPlanActions = useAiPlanActions({
    activeProject,
    activeProjectRef,
    undoStateRef,
    savedProjectsRef,
    hasLocalEditsSinceMountRef,
    aiTicketAuthorityRef,
    setProject,
    setUndoState,
    setSavedProjects,
    setShowOutputDrawer,
    setStatusNotification,
    setAnalysisErrors,
    setClarificationErrors,
    setGalleryErrors,
  });

  const narrativeActions = useNarrativeWorkflowActions({
    activeProject,
    activeProjectRef,
    undoStateRef,
    savedProjectsRef,
    hasLocalEditsSinceMountRef,
    aiTicketAuthorityRef,
    setProject,
    setUndoState,
    setStatusNotification,
    setStorageAlert,
    storageAlert,
    setWorkspaceMode,
    setIsReviewModalOpen,
    setAutoAnalysisCallsUsed,
    autoBackupEnabled,
    setAutoBackupEnabled,
    aiConfigured: aiPlanActions.operationAvailability.diagnostics.eligible,
    hydrationGate,
    getHydrationGate,
    allowNavigation,
    cancelAutosave,
    selectProject,
    flushProjectDurably,
  });

  const planHandlers = useCanonicalPlanHandlers({
    getActiveProject: () => activeProjectRef.current,
    getUndoState: () => undoStateRef.current,
    publishCurrentProject,
    markLocalEdits: () => {
      hasLocalEditsSinceMountRef.current = true;
    },
    setStoryBibleErrors,
    setStatusNotification,
    allowNavigation,
    navigateToPlan: () => setWorkspaceMode('plan'),
    navigateToWriteSection: (sectionId) => {
      setFocusedSectionId(sectionId);
      setWorkspaceMode('write');
    },
    setSelectedEntityId,
    setSelectedRelationshipId,
    setRightPanelTab,
    setMobileTab,
    setFocusedStoryBibleField,
  });

  useEffect(() => {
    document.documentElement.classList.toggle('dark', isDarkMode);
    document.body.style.backgroundColor = isDarkMode ? '#1b191c' : '#f8f7f3';
  }, [isDarkMode]);

  useGlobalWorkspaceShortcuts({
    getActiveProject: useCallback(() => activeProjectRef.current, []),
    getUndoState: useCallback(() => undoStateRef.current, []),
    isDraftOrRestorePending: useCallback(
      () => draftDirtyRef.current || restorePendingRef.current,
      []
    ),
    onUndo: planHandlers.handleUndo,
    onRedo: planHandlers.handleRedo,
  });

  // Kept in App.tsx for startupAnalysisProviderBoundary contract check.
  const handleAnalyzeIdea = useCallback(async () => {
    const originProject = activeProjectRef.current;
    const providerInputs = buildStartupAnalysisProviderInputs(originProject);
    if (!providerInputs.ok) {
      setAnalysisErrors((prev) => ({ ...prev, [originProject.id]: providerInputs.reason }));
      setClarificationErrors((prev) => ({ ...prev, [originProject.id]: providerInputs.reason }));
      setStatusNotification(providerInputs.reason);
      return;
    }
    // Reanalyze starts both analyze and clarify; reject unsupported
    // selections before starting either request or the async loading slot.
    try {
      const blocked = !aiPlanActions.operationAvailability.analyze.eligible
        ? aiPlanActions.operationAvailability.analyze.reason
        : !aiPlanActions.operationAvailability.clarify.eligible
          ? aiPlanActions.operationAvailability.clarify.reason
          : undefined;
      if (blocked) {
        setAnalysisErrors((prev) => ({ ...prev, [originProject.id]: blocked }));
        setClarificationErrors((prev) => ({ ...prev, [originProject.id]: blocked }));
        setStatusNotification(blocked);
        return;
      }
    } catch (error) {
      const message = getReadableErrorMessage(error, 'Could not verify AI provider preferences.');
      setAnalysisErrors((prev) => ({ ...prev, [originProject.id]: message }));
      setStatusNotification(message);
      return;
    }
    if (providerInputs.warning) setStatusNotification(providerInputs.warning);
    const trimmed = providerInputs.prompt.trim();
    if (!trimmed) return;

    const lengthCheck = validateEffectivePromptLength(trimmed, MAX_PROMPT_CHARS);
    if (!lengthCheck.ok) {
      const msg = lengthCheck.error ?? 'Prompt exceeds character limit.';
      setAnalysisErrors((prev) => ({ ...prev, [originProject.id]: msg }));
      setStatusNotification(msg);
      return;
    }

    await runAsyncAnalysisSlot({
      authority: aiTicketAuthorityRef.current,
      originProject,
      getState: () => ({
        activeProject: activeProjectRef.current,
        activeUndoState: undoStateRef.current,
        savedProjects: savedProjectsRef.current,
      }),
      commitState: (applied) => {
        activeProjectRef.current = applied.activeProject;
        undoStateRef.current = applied.activeUndoState;
        savedProjectsRef.current = applied.savedProjects;
        setProject(applied.activeProject);
        setUndoState(applied.activeUndoState);
        setSavedProjects(applied.savedProjects);
      },
      analyzeGraph: (signal) =>
        analyzePromptToBeliefGraph(providerInputs.prompt, providerInputs.mode, signal),
      fetchClarifications: (signal) =>
        generateClarifications(
          providerInputs.prompt,
          providerInputs.askedQuestions,
          providerInputs.mode,
          signal,
          providerInputs.confirmedFacts
        ),
      onStart: () => {
        setAnalysisErrors((prev) => ({ ...prev, [originProject.id]: null }));
        setClarificationErrors((prev) => ({ ...prev, [originProject.id]: null }));
      },
      onAnalysisError: (projectId, err) => {
        setAnalysisErrors((prev) => ({
          ...prev,
          [projectId]: getReadableErrorMessage(
            err,
            'Could not reach AI analysis service; local plan preserved.'
          ),
        }));
      },
      onClarificationError: (projectId, err) => {
        setClarificationErrors((prev) => ({
          ...prev,
          [projectId]: getReadableErrorMessage(
            err,
            'Could not fetch new AI questions; existing decisions preserved.'
          ),
        }));
      },
      onRebased: () => {
        setStatusNotification(
          'Rebased AI analysis onto your latest edits without overwriting confirmed changes.'
        );
      },
      label: 'Reanalyze Prompt with AI',
      summary: 'Merged AI analysis while preserving confirmed user decisions.',
    });
  }, [aiPlanActions.operationAvailability, setAnalysisErrors, setClarificationErrors, setStatusNotification]);

  // Kept in App.tsx for releaseQualification contract check.
  const handleSwitchProject = (projectId: string) => {
    if (!allowNavigation()) return;
    const current = activeProjectRef.current;
    if (projectId === current.id) return;

    const switchRes = prepareProjectSwitch({
      currentProject: current,
      savedProjects: savedProjectsRef.current,
      targetProjectId: projectId,
    });
    if (!switchRes.targetProject) return;

    cancelAutosave();
    const nextTarget = switchRes.targetProject;
    const nextUndo = createUndoRedoState(
      nextTarget.snapshot,
      nextTarget.revisions,
      nextTarget.undoHistory
    );
    savedProjectsRef.current = switchRes.savedProjects;
    setSavedProjects(switchRes.savedProjects);
    selectProject(nextTarget, nextUndo);
    if (getHydrationGate() !== 'blocked-read-error') {
      setStorageAlert(null);
    }

    if (switchRes.projectToFlush && canWriteWorkspace()) {
      void flushProjectDurably(switchRes.projectToFlush, {
        expectedPersistedRevision: switchRes.projectToFlush.persistedRevision,
      });
    }
  };

  // Kept in App.tsx for storageLifecycle contract check.
  const handleDeleteProject = (projectId: string) => {
    if (!allowNavigation()) return;
    if (activeProjectRef.current.id === projectId) cancelAutosave();
    resetProjectSaveState(projectId);
    aiTicketAuthorityRef.current?.invalidateProject(projectId);
    void deleteProjectCompletely(projectId).then((delRes) => {
      applyPostDeleteState(projectId, delRes);
    });
  };

  const selectedEntity = useMemo(() => {
    if (!selectedEntityId) return null;
    return (
      snapshot.entities.find((e) => e.id === selectedEntityId || e.name === selectedEntityId) ??
      null
    );
  }, [snapshot.entities, selectedEntityId]);

  const selectedRelationship = useMemo(() => {
    if (!selectedRelationshipId) return null;
    return snapshot.relationships.find((r) => r.id === selectedRelationshipId) ?? null;
  }, [snapshot.relationships, selectedRelationshipId]);

  const consistencyIssues = useMemo(() => evaluateProjectConsistency(snapshot), [snapshot]);
  const relationshipProjection = useMemo(() => projectRelationships(snapshot), [snapshot]);

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

  const isGraphLoading = isProjectActionLoading(inFlightTickets, activeProject.id, 'analyze');
  const isClarificationsLoading =
    isGraphLoading || isProjectActionLoading(inFlightTickets, activeProject.id, 'clarify');
  const isBatchLoading = isProjectActionLoading(inFlightTickets, activeProject.id, 'batch');
  const isGenerating = isProjectActionLoading(inFlightTickets, activeProject.id, 'generate');
  const isPolishingPrompt = isProjectActionLoading(inFlightTickets, activeProject.id, 'polish');

  const analysisError = analysisErrors[activeProject.id] ?? null;
  const clarificationError = clarificationErrors[activeProject.id] ?? null;
  const currentGalleryError = galleryErrors[activeProject.id]?.[mode] ?? null;

  const contentExports = useMemo(() => buildContentExportEntries(activeProject), [activeProject]);

  const exportManuscript = () => {
    void triggerManuscriptMarkdownDownload(activeProject).catch((cause) =>
      setStatusNotification(cause instanceof Error ? cause.message : 'Manuscript export failed.')
    );
  };
  const exportManuscriptText = () => {
    void triggerManuscriptTextDownload(activeProject).catch((cause) =>
      setStatusNotification(cause instanceof Error ? cause.message : 'Manuscript export failed.')
    );
  };
  const exportManuscriptDocx = () => {
    void triggerManuscriptDocxDownload(activeProject).catch((cause) =>
      setStatusNotification(cause instanceof Error ? cause.message : 'DOCX export failed.')
    );
  };

  const exportContent = (id: string) => {
    const entry = contentExports.find((item) => item.id === id);
    if (!entry) return;
    void import('./lib/narrative/recovery/contentExport')
      .then(({ projectContentExport }) => {
        const file = projectContentExport(activeProject, entry.selection);
        downloadTextFile(file.name, file.text, file.mediaType);
      })
      .catch((cause) => {
        setStatusNotification(
          cause instanceof Error ? cause.message : 'Selected content could not be exported.'
        );
      });
  };

  const exportContentBundle = async (ids: string[]) => {
    try {
      const selections = ids
        .map((id) => contentExports.find((item) => item.id === id))
        .filter((entry): entry is typeof contentExports[number] => Boolean(entry))
        .map((entry) => entry.selection);
      const { projectContentBundle } = await import('./lib/narrative/recovery/bundleExporter');
      const bundle = await projectContentBundle(activeProject, selections);
      downloadBinaryFile(bundle.name, bundle.bytes, 'application/zip');
    } catch (cause) {
      setStatusNotification(
        cause instanceof Error ? cause.message : 'Selected content bundle could not be exported.'
      );
    }
  };

  const openPlan = (
    panel: RightPanelTab,
    target?: 'revision-history' | 'project-management' | 'export-content'
  ) => {
    if (!allowNavigation()) return;
    setRightPanelTab(panel);
    setMobileTab('inspector');
    if (target) setHistoryTarget((previous) => ({ id: target, sequence: (previous?.sequence ?? 0) + 1 }));
    setWorkspaceMode('plan');
  };

  const handleSelectHeaderSection = (section: WorkspaceSection) => {
    if (!allowNavigation()) return;
    setWorkspaceMode('plan');
    if (section === 'story-bible') {
      setRightPanelTab('story-bible');
      setMobileTab('inspector');
    } else if (section === 'history') {
      openPlan('history', 'revision-history');
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

  const reviewDiffModel = useMemo(
    () =>
      buildReviewDiffModel({
        project: activeProject,
        draftDecisionValues: stagedDecisionDrafts,
        stagedBatch: stagedBatchPreview,
        polishProposal: aiPlanActions.activePolishProposal,
      }),
    [activeProject, stagedDecisionDrafts, stagedBatchPreview, aiPlanActions.activePolishProposal]
  );

  const closeReviewModal = useCallback(() => {
    setIsReviewModalOpen(false);
    requestAnimationFrame(() => {
      reviewButtonRef.current?.focus();
    });
  }, []);

  const savePresentation = getSavePresentation({
    restoring: restorePending,
    draftDirty: manuscriptDraftDirty,
    savePending: pendingDurableSaveProjectIds.has(activeProject.id) || createProjectPending,
    projectPersisted: activeProject.persistedRevision === activeProject.revision,
    storageState:
      storageAlert?.projectId === activeProject.id
        ? storageAlert.type === 'conflict'
          ? 'conflict'
          : 'failed'
        : null,
  });

  return (
    <div
      className={`${
        isDarkMode ? 'dark' : ''
      } pcc-shell font-sans h-screen flex flex-col text-gray-900 dark:text-gray-100 transition-colors duration-150 overflow-hidden`}
    >
      <Header
        isDarkMode={isDarkMode}
        toggleDarkMode={() => setIsDarkMode((prev) => !prev)}
        onShowInfo={() => setShowInfoModal(true)}
        onLoadSampleProject={handleResetSampleProject}
        savePresentation={savePresentation}
        project={activeProject}
        projects={savedProjects}
        onSwitchProject={handleSwitchProject}
        onNewProject={() => {
          if (allowNavigation()) setCreateProjectOpen(true);
        }}
        onOpenImport={() => {
          if (allowNavigation()) setWorkspaceMode('import');
        }}
        importDisabled={!hydrationSettled}
        onOpenProjects={() => {
          if (allowNavigation()) setWorkspaceMode('projects');
        }}
      />

      <CreateProjectDialog
        open={createProjectOpen}
        pending={createProjectPending}
        onCancel={() => setCreateProjectOpen(false)}
        onCreate={handleCreateNewProject}
      />

      <StorageAlertBanner
        storageAlert={storageAlert}
        hydrationGate={hydrationGate}
        statusNotification={statusNotification}
        onReloadFromStorage={handleReloadLatestFromStorage}
        onForceOverwriteStorage={handleForceOverwriteStorage}
        onExportBackupJson={() =>
          triggerProjectBackupDownload(activeProject, `r${activeProject.revision}-backup`)
        }
        onDismissStorageAlert={() => setStorageAlert(null)}
        onDismissStatusNotification={() => setStatusNotification(null)}
      />

      <nav
        aria-label="Narrative workspace"
        className="flex flex-wrap items-center gap-1 border-b border-pcc-line bg-pcc-surface px-3 py-2 dark:border-pcc-dark-line dark:bg-pcc-dark-surface sm:px-5"
      >
        <div
          className="inline-flex rounded-lg border border-pcc-line bg-pcc-canvas p-0.5 dark:border-pcc-dark-line dark:bg-pcc-dark-canvas"
          role="group"
          aria-label="Workspace mode"
        >
          {([
            ['write', 'Write'],
            ['plan', 'Plan'],
            ['review', 'Review'],
          ] as const).map(([modeKey, label]) => (
            <button
              type="button"
              key={modeKey}
              aria-current={workspaceMode === modeKey ? 'page' : undefined}
              className="min-h-11 rounded-md px-3 text-sm font-medium text-pcc-muted transition-colors hover:text-pcc-ink aria-[current=page]:bg-pcc-surface aria-[current=page]:text-pcc-action aria-[current=page]:shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-pcc-focus dark:text-pcc-dark-muted dark:hover:text-pcc-dark-ink dark:aria-[current=page]:bg-pcc-dark-surface dark:aria-[current=page]:text-pcc-dark-ink"
              onClick={() => {
                if (allowNavigation()) {
                  setAdoptArtifactId(undefined);
                  setWorkspaceMode(modeKey);
                }
              }}
            >
              {label}
            </button>
          ))}
        </div>
        <button
          type="button"
          className="min-h-11 rounded-md px-3 text-sm font-medium text-pcc-muted hover:bg-pcc-canvas focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-pcc-focus dark:text-pcc-dark-muted dark:hover:bg-pcc-dark-canvas"
          onClick={() => {
            if (allowNavigation()) setShowAiSettings(true);
          }}
          aria-haspopup="dialog"
        >
          AI settings
        </button>
        <div className="ml-auto flex flex-wrap justify-end gap-1 sm:hidden">
          <button
            type="button"
            className="min-h-11 rounded-md bg-pcc-action px-2.5 text-xs font-semibold text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-pcc-focus"
            onClick={() => {
              if (allowNavigation()) setCreateProjectOpen(true);
            }}
          >
            New
          </button>
          <button
            type="button"
            disabled={!hydrationSettled}
            className="min-h-11 rounded-md px-2.5 text-xs font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-pcc-focus disabled:opacity-45"
            onClick={() => {
              if (allowNavigation()) setWorkspaceMode('import');
            }}
          >
            Import
          </button>
          <button
            type="button"
            className="min-h-11 rounded-md px-2.5 text-xs font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-pcc-focus"
            onClick={() => {
              if (allowNavigation()) setWorkspaceMode('projects');
            }}
          >
            Projects
          </button>
        </div>
      </nav>

      <div
        hidden={workspaceMode !== 'write'}
        className={workspaceMode === 'write' ? 'flex min-h-0 flex-1 flex-col' : undefined}
      >
        <ManuscriptEditor
          key={activeProject.id}
          project={activeProject}
          isActive={workspaceMode === 'write'}
          onSave={narrativeActions.saveManuscript}
          initialArtifactId={adoptArtifactId}
          onDismissAdoption={() => setAdoptArtifactId(undefined)}
          focusedSectionId={focusedSectionId}
          writingAvailability={aiPlanActions.operationAvailability.writing}
          onSaveWritingAlternative={narrativeActions.handleSaveWritingAlternative}
          onExportDraft={(sections) =>
            downloadTextFile(
              safeFilename(activeProject.name, 'unsaved-draft', 'md'),
              manuscriptText(sections),
              'text/markdown;charset=utf-8'
            )
          }
          onDirty={(dirty) => {
            draftDirtyRef.current = dirty;
            setManuscriptDraftDirty(dirty);
          }}
          onCompositionChange={(composing) => {
            compositionPendingRef.current = composing;
          }}
          onUndo={planHandlers.handleUndo}
          onRedo={planHandlers.handleRedo}
          canUndo={undoState.past.length > 0}
          canRedo={undoState.future.length > 0}
          enabled={hydrationGate === 'ready' && typeof window !== 'undefined' && Boolean(window.indexedDB)}
        />
      </div>

      {workspaceMode === 'review' && (
        <ChunkErrorBoundary
          resetKey={`review:${activeProject.id}`}
          viewLabel="Review & Diagnostics"
          onRetry={retryNarrativeReview}
          onReturnToWorkspace={() => setWorkspaceMode(lastStableWorkspaceModeRef.current)}
        >
          <Suspense fallback={<LazyViewFallback label="Review & Diagnostics" />}>
            <NarrativeReview
              key={activeProject.id}
              project={activeProject}
              checks={consistencyIssues}
              diagnosticsAvailability={aiPlanActions.operationAvailability.diagnostics}
              syncAvailability={aiPlanActions.operationAvailability.sync}
              autoAnalysisDiagnosticsAvailability={aiPlanActions.operationAvailability.diagnostics}
              openChecks={() => openPlan('consistency')}
              openHistory={() => openPlan('history', 'revision-history')}
              openOutput={() => handleSelectHeaderSection('output')}
              openOpportunities={() => openPlan('opportunities')}
              exportReport={(format) =>
                downloadTextFile(
                  safeFilename(activeProject.name, 'evidence-audit', format),
                  registryReport(activeProject, format),
                  format === 'json' ? 'application/json;charset=utf-8' : 'text/markdown;charset=utf-8'
                )
              }
              onIssueDisposition={narrativeActions.handleIssueDisposition}
              onRunLocalDiagnostics={narrativeActions.handleRunLocalDiagnostics}
              onRunSemanticDiagnostics={narrativeActions.runSemanticDiagnostics}
              onApplyDiagnosticFix={narrativeActions.handleApplyDiagnosticFix}
              onNavigateTarget={planHandlers.handleNavigateConsistencyTarget}
              onApplyModelSyncProposal={narrativeActions.handleApplyModelSyncProposal}
              onApplyManuscriptSyncPatch={narrativeActions.handleApplyManuscriptSyncPatch}
              onRecordSyncCheckpoint={narrativeActions.handleRecordSyncCheckpoint}
              onUpdateAutomationPreferences={narrativeActions.handleUpdateAutomationPreferences}
              autoAnalysisCallsUsed={autoAnalysisCallsUsed}
              resumeProposalReview={
                resumedProposalReview?.projectId === activeProject.id ? resumedProposalReview : undefined
              }
              onClearResumedProposalReview={() => setResumedProposalReview(undefined)}
              onReturnToWriting={(target, review) => {
                if (!allowNavigation()) return;
                setResumedProposalReview(review?.projectId === activeProject.id ? review : undefined);
                if (
                  target?.sectionId &&
                  manuscriptSections(activeProject).some((section) => section.id === target.sectionId)
                ) {
                  setFocusedSectionId(target.sectionId);
                }
                setWorkspaceMode('write');
              }}
            />
          </Suspense>
        </ChunkErrorBoundary>
      )}

      {workspaceMode === 'import' && (
        <ChunkErrorBoundary
          resetKey={`import:${activeProject.id}`}
          viewLabel="Import Story"
          onRetry={retryImportWorkflow}
          onReturnToWorkspace={() => setWorkspaceMode(lastStableWorkspaceModeRef.current)}
        >
          <Suspense fallback={<LazyViewFallback label="Import Story" />}>
            <ImportWorkflow
              existingProjects={savedProjects}
              activeProjectId={activeProject.id}
              narrativeImportAvailability={aiPlanActions.operationAvailability['narrative-import']}
              importEnhanceAvailability={aiPlanActions.operationAvailability['import-enhance']}
              onCreateProject={narrativeActions.handleCreateImportedProject}
              onAppendToExistingProject={narrativeActions.handleAppendToExistingProject}
              onCancelImport={() => setWorkspaceMode(lastStableWorkspaceModeRef.current)}
            />
          </Suspense>
        </ChunkErrorBoundary>
      )}

      {workspaceMode === 'projects' && (
        <ChunkErrorBoundary
          resetKey={`projects:${activeProject.id}`}
          viewLabel="Projects"
          onRetry={retryProjectHub}
          onReturnToWorkspace={() => setWorkspaceMode(lastStableWorkspaceModeRef.current)}
        >
          <Suspense fallback={<LazyViewFallback label="Projects" />}>
            <ProjectHub
              key={activeProject.id}
              project={activeProject}
              savedProjects={savedProjects}
              onResumeWorkspace={() => {
                if (allowNavigation()) setWorkspaceMode(lastStableWorkspaceModeRef.current);
              }}
              onOpenProject={(projectId) => {
                if (!allowNavigation()) return;
                handleSwitchProject(projectId);
                setWorkspaceMode('write');
              }}
              onCreateNewProject={handleCreateNewProject}
              historyContent={
                <HistoryPanel
                  project={activeProject}
                  savedProjects={savedProjects}
                  historyTarget={historyTarget}
                  contentExports={contentExports.map(({ id, label }) => ({ id, label }))}
                  onExportJson={() =>
                    triggerProjectBackupDownload(activeProject, `r${activeProject.revision}-backup`)
                  }
                  onExportStoryBibleMarkdown={() => triggerStoryBibleMarkdownDownload(activeProject)}
                  onExportPromptText={() => triggerRefinedPromptDownload(activeProject)}
                  onExportManuscript={snapshot.manuscriptVersionId ? exportManuscript : undefined}
                  onExportManuscriptDocx={
                    manuscriptSections(activeProject).length > 0 ? exportManuscriptDocx : undefined
                  }
                  onExportManuscriptText={
                    manuscriptSections(activeProject).length > 0 ? exportManuscriptText : undefined
                  }
                  onExportContent={exportContent}
                  onExportContentBundle={exportContentBundle}
                  onPreviewProjectJson={parseProjectBackup}
                  onImportProjectJson={handleImportProjectJson}
                  onSwitchProject={handleSwitchProject}
                  onCreateNewProject={handleCreateNewProject}
                  onDeleteProject={handleDeleteProject}
                  onRestoreRevision={planHandlers.handleRestoreRevision}
                />
              }
              openProjects={() => openPlan('history', 'project-management')}
              openExport={() => openPlan('history', 'export-content')}
              openImport={() => {
                if (allowNavigation()) setWorkspaceMode('import');
              }}
              restore={handleImportProjectJson}
              restoreArchiveProjects={handleRestoreArchiveProjects}
              downloadBackup={(backup) =>
                downloadTextFile(
                  safeFilename(activeProject.name, `r${backup.revision}-${backup.id.slice(0, 8)}-backup`, 'json'),
                  JSON.stringify(backup, null, 2),
                  'application/json;charset=utf-8'
                )
              }
              onExportManuscriptDocx={
                manuscriptSections(activeProject).length > 0 ? exportManuscriptDocx : undefined
              }
              onExportManuscriptText={
                manuscriptSections(activeProject).length > 0 ? exportManuscriptText : undefined
              }
              onExportStoryBible={() => triggerStoryBibleMarkdownDownload(activeProject)}
              onExportPrompt={() => triggerRefinedPromptDownload(activeProject)}
              onExportIssuesAudit={() =>
                downloadTextFile(
                  safeFilename(activeProject.name, 'issues-audit', 'md'),
                  registryReport(activeProject, 'md'),
                  'text/markdown;charset=utf-8'
                )
              }
              onDownloadAllProjectsArchive={(filename, bytes) =>
                downloadBinaryFile(filename, bytes, 'application/zip')
              }
              autoBackupEnabled={autoBackupEnabled}
              onToggleAutoBackup={narrativeActions.handleToggleAutoBackup}
            />
          </Suspense>
        </ChunkErrorBoundary>
      )}

      <div className={workspaceMode === 'plan' ? 'flex min-h-0 flex-1 flex-col overflow-hidden' : 'hidden'}>
        <AdaptivePlanWorkspace
          projectName={activeProject.name}
          pendingDecisionCount={pendingDecisionCount}
          mobileTab={mobileTab}
          onMobileTabChange={setMobileTab}
          entities={snapshot.entities}
          relationships={snapshot.relationships}
          selectedEntityId={selectedEntityId}
          selectedRelationshipId={selectedRelationshipId}
          onSelectEntity={(entity) => {
            setSelectedEntityId(entity.id ?? entity.name);
            setSelectedRelationshipId(null);
          }}
          onSelectRelationship={(relationship) => {
            setSelectedRelationshipId(relationship.id ?? null);
            setSelectedEntityId(null);
          }}
          onOpenInspectorTab={(tab: PlanInspectorDestination) => {
            setRightPanelTab(tab);
            setMobileTab('inspector');
          }}
          outputExpanded={showOutputDrawer}
          onToggleOutput={() => setShowOutputDrawer((value) => !value)}
          decisionInbox={
            <DecisionInboxPanel
              key={activeProject.id}
              decisions={snapshot.decisions}
              activeProjectId={activeProject.id}
              activeRevision={activeProject.revision}
              onApplyDecisions={planHandlers.handleApplyDecisions}
              onInspectDecisionTarget={planHandlers.handleInspectDecisionTarget}
              onRefreshClarifications={aiPlanActions.handleRefreshClarifications}
              isClarificationsLoading={isClarificationsLoading}
              clarificationError={clarificationError}
              onPreviewBatchInstruction={aiPlanActions.handlePreviewBatchInstruction}
              onApplyBatchOperations={aiPlanActions.handleApplyBatchOperations}
              onBatchPreviewChange={setStagedBatchPreview}
              onDraftValuesChange={setStagedDecisionDrafts}
              isBatchLoading={isBatchLoading}
            />
          }
          graphControls={
            <PromptInput
              key={activeProject.id}
              prompt={snapshot.originalIdea}
              setPrompt={planHandlers.handleSetOriginalIdea}
              onSubmit={aiPlanActions.handleGenerateOutput}
              onAnalyze={handleAnalyzeIdea}
              isLoading={isGraphLoading || isGenerating}
              isGenerating={isGenerating}
              isFirstRun={!latestStoryArtifact && !latestImageArtifact}
              storyBlockReason={aiPlanActions.storyBlockReason}
              reanalyzeBlockReason={
                !aiPlanActions.operationAvailability.analyze.eligible
                  ? aiPlanActions.operationAvailability.analyze.reason ?? 'AI analysis is unavailable.'
                  : !aiPlanActions.operationAvailability.clarify.eligible
                    ? aiPlanActions.operationAvailability.clarify.reason ?? 'AI clarification is unavailable.'
                    : null
              }
              mode={mode}
              setMode={planHandlers.handleModeChange}
              compiledPromptLength={snapshot.refinedPrompt.trim().length}
              maxPromptChars={MAX_PROMPT_CHARS}
            />
          }
          graphCanvas={
            <div className="flex h-full min-h-0 flex-col gap-2.5 p-2.5 sm:p-3">
              <div className="flex min-h-0 flex-1 flex-col">
                <BeliefGraph
                  key={activeProject.id}
                  data={{
                    prompt: snapshot.originalIdea,
                    entities: snapshot.entities,
                    relationships: snapshot.relationships,
                  }}
                  isLoading={isGraphLoading}
                  error={analysisError}
                  selectedEntity={selectedEntity}
                  selectedRelationship={selectedRelationship}
                  onSelectEntity={(entity) => {
                    setSelectedEntityId(entity ? (entity.id ?? entity.name) : null);
                    if (entity) {
                      setSelectedRelationshipId(null);
                      setRightPanelTab('inspector');
                    }
                  }}
                  onSelectRelationship={(relationship: Relationship | null) => {
                    setSelectedRelationshipId(relationship?.id ?? null);
                    if (relationship) {
                      setSelectedEntityId(null);
                      setRightPanelTab('inspector');
                    }
                  }}
                  onRelationshipChange={planHandlers.handleUpsertRelationship}
                  onAttributeChange={planHandlers.handleAttributeChange}
                  onOpenChecks={() => {
                    setRightPanelTab('consistency');
                    setMobileTab('inspector');
                  }}
                  currentPrompt={snapshot.originalIdea}
                  consistencyIssues={consistencyIssues}
                  relationshipProjection={relationshipProjection}
                />
              </div>
            </div>
          }
          generatedOutput={
            <OutputDisplay
              key={activeProject.id}
              originalIdea={snapshot.originalIdea}
              refinedPrompt={snapshot.refinedPrompt}
              freeformNotes={snapshot.freeformNotes}
              onChangeFreeformNotes={planHandlers.handleSetFreeformNotes}
              onPolishPromptWithAi={aiPlanActions.handlePolishPromptWithAi}
              polishAvailability={aiPlanActions.operationAvailability.polish}
              isPolishingPrompt={isPolishingPrompt}
              polishProposal={aiPlanActions.activePolishProposal}
              isPolishStale={Boolean(aiPlanActions.polishValidation && !aiPlanActions.polishValidation.ok)}
              polishStaleReason={aiPlanActions.polishValidation?.reason ?? null}
              onAcceptPolishProposal={aiPlanActions.handleAcceptPolishProposal}
              onRejectPolishProposal={aiPlanActions.handleRejectPolishProposal}
              artifacts={activeProject.artifacts}
              images={latestImageArtifact?.images ?? []}
              imageWarning={latestImageArtifact?.warning ?? null}
              story={latestStoryArtifact?.storyText ?? null}
              storyProviderSelection={aiPlanActions.storyProviderSelection}
              storyBlockReason={aiPlanActions.storyBlockReason}
              storyProviderUsage={aiPlanActions.lastStoryProviderUsage}
              mode={mode}
              isLoading={isGenerating}
              error={currentGalleryError}
              isOutdated={isCurrentOutputOutdated}
              onGenerate={aiPlanActions.handleGenerateOutput}
              onAdoptStory={(artifactId) => {
                if (!allowNavigation()) return;
                setAdoptArtifactId(artifactId);
                setWorkspaceMode('write');
              }}
            />
          }
          contextualInspector={
            <ContextualInspector
              activeTab={rightPanelTab}
              historyTarget={historyTarget}
              onSelectTab={setRightPanelTab}
              project={activeProject}
              savedProjects={savedProjects}
              selectedEntity={selectedEntity}
              selectedRelationship={selectedRelationship}
              onSelectEntity={(entity) => {
                setSelectedEntityId(entity ? (entity.id ?? entity.name) : null);
                if (entity) setSelectedRelationshipId(null);
              }}
              onSelectRelationship={(relationship) => {
                setSelectedRelationshipId(relationship?.id ?? null);
                if (relationship) setSelectedEntityId(null);
              }}
              onAttributeChange={planHandlers.handleAttributeChange}
              onRenameEntity={planHandlers.handleRenameEntity}
              onAddEntity={planHandlers.handleAddEntity}
              onUpsertRelationship={planHandlers.handleUpsertRelationship}
              onUpdateRelationshipById={planHandlers.handleUpdateRelationshipById}
              onRemoveRelationship={planHandlers.handleRemoveRelationship}
              onUpdateStoryBible={planHandlers.handleUpdateStoryBible}
              onConfirmPendingStoryBible={planHandlers.handleConfirmPendingStoryBible}
              storyBibleErrors={storyBibleErrors}
              focusedStoryBibleField={focusedStoryBibleField}
              consistencyIssues={consistencyIssues}
              onNavigateConsistencyTarget={planHandlers.handleNavigateConsistencyTarget}
              onRestoreRevision={planHandlers.handleRestoreRevision}
              onSwitchProject={handleSwitchProject}
              onCreateNewProject={handleCreateNewProject}
              onDeleteProject={handleDeleteProject}
              onExportJson={() =>
                triggerProjectBackupDownload(activeProject, `r${activeProject.revision}-backup`)
              }
              onExportStoryBibleMarkdown={() => triggerStoryBibleMarkdownDownload(activeProject)}
              onExportPromptText={() => triggerRefinedPromptDownload(activeProject)}
              onExportManuscript={snapshot.manuscriptVersionId ? exportManuscript : undefined}
              onExportManuscriptDocx={
                manuscriptSections(activeProject).length > 0 ? exportManuscriptDocx : undefined
              }
              onExportManuscriptText={
                manuscriptSections(activeProject).length > 0 ? exportManuscriptText : undefined
              }
              onOpenReviewDiagnostics={() => {
                if (allowNavigation()) setWorkspaceMode('review');
              }}
              onJumpToSection={(sectionId) => {
                if (!allowNavigation()) return;
                setFocusedSectionId(sectionId);
                setWorkspaceMode('write');
              }}
              opportunitiesAvailability={aiPlanActions.operationAvailability.opportunities}
              onSendOpportunityToReview={narrativeActions.handleSendOpportunityToReview}
              contentExports={contentExports.map(({ id, label }) => ({ id, label }))}
              onExportContent={exportContent}
              onExportContentBundle={exportContentBundle}
              onCreateOpportunity={narrativeActions.handleCreateOpportunity}
              onCreateOpportunityBatch={narrativeActions.handleCreateOpportunitiesBatch}
              onTransitionOpportunity={narrativeActions.handleTransitionOpportunity}
              onImportProjectJson={handleImportProjectJson}
              onPreviewProjectJson={parseProjectBackup}
              isLoading={isGraphLoading}
            />
          }
        />

        <nav
          aria-label="Mobile workspace panels"
          className="shrink-0 border-t border-pcc-line bg-pcc-surface px-2 py-1.5 dark:border-pcc-dark-line dark:bg-pcc-dark-surface xl:hidden"
        >
          <div className="grid grid-cols-4 gap-1">
            {([
              ['decisions', `Inbox (${pendingDecisionCount})`],
              ['graph', 'Belief Graph'],
              ['inspector', 'Inspector'],
              ['output', 'Output'],
            ] as const).map(([tabKey, label]) => (
              <button
                key={tabKey}
                type="button"
                onClick={() => setMobileTab(tabKey)}
                aria-current={mobileTab === tabKey ? 'page' : undefined}
                className={`min-h-11 rounded-md px-1 text-center text-xs font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-pcc-focus ${
                  mobileTab === tabKey
                    ? 'bg-pcc-canvas text-pcc-action dark:bg-pcc-dark-canvas dark:text-pcc-dark-ink'
                    : 'text-pcc-muted dark:text-pcc-dark-muted'
                }`}
              >
                {label}
              </button>
            ))}
          </div>
        </nav>

        <WorkspaceBottomBar
          pendingDecisionCount={pendingDecisionCount}
          canUndo={undoState.past.length > 0}
          canRedo={undoState.future.length > 0}
          undoLabel={undoState.past[undoState.past.length - 1]?.label}
          redoLabel={undoState.future[0]?.label}
          onUndo={planHandlers.handleUndo}
          onRedo={planHandlers.handleRedo}
          onAcceptAllPending={planHandlers.handleAcceptAllPendingDecisions}
          onReviewChanges={() => setIsReviewModalOpen(true)}
          reviewButtonRef={reviewButtonRef}
          mode={mode}
          onModeChange={planHandlers.handleModeChange}
          onGenerate={aiPlanActions.handleGenerateOutput}
          isGenerating={isGenerating}
          storyBlockReason={aiPlanActions.storyBlockReason}
          showOutputDrawer={showOutputDrawer}
          onToggleOutputDrawer={() => setShowOutputDrawer((value) => !value)}
          revisionCount={activeProject.revision}
          isOutdated={isCurrentOutputOutdated}
          compactOnMobile={workspaceMode === 'plan'}
        />
      </div>

      <ReviewDiffModal
        isOpen={isReviewModalOpen}
        activeProject={activeProject}
        mode={mode}
        pendingDecisions={pendingDecisions}
        stagedDecisionDrafts={stagedDecisionDrafts}
        reviewDiffModel={reviewDiffModel}
        consistencyIssues={consistencyIssues}
        onClose={closeReviewModal}
        onApplyDecisions={planHandlers.handleApplyDecisions}
        onRestoreRevision={planHandlers.handleRestoreRevision}
        onOpenStoryBible={() => setRightPanelTab('story-bible')}
      />

      <InfoModal isOpen={showInfoModal} onClose={() => setShowInfoModal(false)} />

      <AiSettingsModal isOpen={showAiSettings} onClose={() => setShowAiSettings(false)}>
        <ChunkErrorBoundary
          resetKey={`ai-settings:${showAiSettings ? 'open' : 'closed'}`}
          viewLabel="AI settings"
          onRetry={retryAiConnectionsPanel}
          onReturnToWorkspace={() => setShowAiSettings(false)}
          returnLabel="Close"
        >
          <Suspense fallback={<LazyViewFallback label="AI settings" />}>
            <AiConnectionsPanel />
          </Suspense>
        </ChunkErrorBoundary>
      </AiSettingsModal>
    </div>
  );
}

export default App;
