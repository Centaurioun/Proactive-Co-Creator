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
import OperationActivityStrip from './components/workspace/OperationActivityStrip';
import ReviewDiffModal from './components/workspace/ReviewDiffModal';
import BeliefGraph from './components/BeliefGraph';
import ContextualInspector, { type RightPanelTab } from './components/ContextualInspector';
import DecisionInboxPanel from './components/DecisionInboxPanel';
import Header, { type WorkspaceSection } from './components/Header';
import InfoModal from './components/InfoModal';
import OutputDisplay from './components/OutputGallery';
import PromptInput from './components/PromptInput';
import WorkspaceBottomBar from './components/WorkspaceBottomBar';
import { NarrativeSearchModal } from './components/workspace/NarrativeSearchModal';
import { ContextInspectorModal } from './components/workspace/ContextInspectorModal';
import { UnifiedProposalReviewModal } from './components/workspace/UnifiedProposalReviewModal';
import { CreativeStudioWorkspace } from './components/workspace/CreativeStudioWorkspace';
import { StoryDevelopmentWorkspace } from './components/workspace/StoryDevelopmentWorkspace';
import { StoryQaPanel } from './components/workspace/StoryQaPanel';
import { CommandPaletteModal } from './components/workspace/CommandPaletteModal';
import type { CreativeLock, UnifiedProposal } from './shared/unifiedProposalTypes';
import type {
  CreativeIdeaCard,
  CreativeSession,
  ReadingMarginNote,
} from './shared/creativeSessionTypes';
import {
  buildUnifiedProposalFromBatchEdit,
  prepareUnifiedProposalAtomicCommit,
} from './lib/narrative/proposals/unifiedProposalEngine';
import {
  applyCreativeWorkspaceMetadataToProject,
  createCreativeSession,
} from './lib/narrative/sessions/creativeSessionEngine';
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
import {
  readBrowserCompanionState,
  readBrowserDisclosurePreference,
  readBrowserResumeBreadcrumb,
  readBrowserWorkspacePreference,
  writeBrowserCompanionState,
  writeBrowserDisclosurePreference,
  writeBrowserResumeBreadcrumb,
  writeBrowserWorkspacePreference,
  type CompanionPaneKind,
  type CompanionPaneState,
  type WorkspaceDisclosureMode,
  type WorkspaceMode,
  type WorkspaceResumeBreadcrumb,
} from './lib/workspacePreference';
import { useProjectPersistence } from './lib/controller/useProjectPersistence';
import { useDurableWorkspaceActions } from './lib/controller/useDurableWorkspaceActions';
import { useCanonicalPlanHandlers, useGlobalWorkspaceShortcuts } from './lib/controller/useCanonicalPlanHandlers';
import {
  AUTO_BACKUP_PREF_KEY,
  useNarrativeWorkflowActions,
} from './lib/controller/useNarrativeWorkflowActions';
import { getReadableErrorMessage, useAiPlanActions } from './lib/controller/useAiPlanActions';
import {
  executeNavigationWithFlush,
  shouldAllowNonDestructiveOverlay,
  type DraftFlushResult,
} from './lib/controller/navigationFlush';
import { useProviderHubStatus } from './lib/controller/useProviderHubStatus';
import { deriveTicketOperationActivities } from './lib/controller/useOperationActivity';
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
  const [workspaceMode, setWorkspaceMode] = useState<WorkspaceMode>(readBrowserWorkspacePreference);
  const lastStableWorkspaceModeRef = useRef<'write' | 'plan'>(
    workspaceMode === 'write' || workspaceMode === 'plan' ? workspaceMode : 'write'
  );
  const [disclosureMode, setDisclosureMode] = useState<WorkspaceDisclosureMode>(
    readBrowserDisclosurePreference
  );
  const [companionState, setCompanionState] = useState<CompanionPaneState>(
    readBrowserCompanionState
  );
  const [showCommandPalette, setShowCommandPalette] = useState<boolean>(false);
  const [activeStudioSessionId, setActiveStudioSessionId] = useState<string | null>(null);
  const [qaInitialQuestion, setQaInitialQuestion] = useState<string>('');
  const [resumeBannerDismissed, setResumeBannerDismissed] = useState<boolean>(false);
  const [autoAnalysisCallsUsed, setAutoAnalysisCallsUsed] = useState<number>(0);
  const [autoBackupEnabled, setAutoBackupEnabled] = useState<boolean>(readInitialAutoBackupPref);

  const draftDirtyRef = useRef(false);
  const compositionPendingRef = useRef(false);
  const restorePendingRef = useRef(false);
  const flushDraftRef = useRef<(() => Promise<DraftFlushResult>) | null>(null);

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
  const [showSearchModal, setShowSearchModal] = useState<boolean>(false);
  const [showContextInspector, setShowContextInspector] = useState<boolean>(false);
  const [activeUnifiedProposal, setActiveUnifiedProposal] = useState<UnifiedProposal | null>(
    () =>
      initialProject.narrative?.unifiedProposals?.find(
        (p) => p.status === 'draft' || p.status === 'ready'
      ) ?? null
  );
  const [showUnifiedProposalModal, setShowUnifiedProposalModal] = useState<boolean>(false);
  const [unifiedProposalInitialTab, setUnifiedProposalInitialTab] = useState<'diff' | 'changemap' | 'locks'>('diff');
  const [lastUndoProposal, setLastUndoProposal] = useState<UnifiedProposal | null>(null);
  const [statusNotification, setStatusNotification] = useState<string | null>(null);
  const [storageAlert, setStorageAlert] = useState<StorageConflictAlert | null>(null);

  useEffect(() => {
    if (workspaceMode === 'projects' || workspaceMode === 'import') return;
    if (workspaceMode === 'write' || workspaceMode === 'plan') {
      lastStableWorkspaceModeRef.current = workspaceMode;
    }
    writeBrowserWorkspacePreference(workspaceMode);
  }, [workspaceMode]);

  useEffect(() => {
    writeBrowserDisclosurePreference(disclosureMode);
  }, [disclosureMode]);

  useEffect(() => {
    writeBrowserCompanionState(companionState);
  }, [companionState]);

  useEffect(() => {
    const onGlobalKeyDown = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        setShowCommandPalette((prev) => !prev);
      }
    };
    window.addEventListener('keydown', onGlobalKeyDown);
    return () => window.removeEventListener('keydown', onGlobalKeyDown);
  }, []);

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

  const navigateWithFlush = useCallback((action: () => void | Promise<void>) => {
    void executeNavigationWithFlush(
      {
        isDraftDirty: () => draftDirtyRef.current,
        isRestorePending: () => restorePendingRef.current,
        isCompositionPending: () => compositionPendingRef.current,
        flushDraft: flushDraftRef.current,
        notify: setStatusNotification,
      },
      action
    );
  }, []);

  const providerHub = useProviderHubStatus();

  const openAiSettingsModal = useCallback(() => {
    if (
      shouldAllowNonDestructiveOverlay({
        isCompositionPending: () => compositionPendingRef.current,
        notify: setStatusNotification,
      })
    ) {
      setShowAiSettings(true);
    }
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
  const [cancelRequestedTicketKeys, setCancelRequestedTicketKeys] = useState<Set<string>>(
    () => new Set()
  );
  const [aiTicketAuthority] = useState<AiTicketAuthority>(() =>
    createAiTicketAuthority((nextTickets) => {
      setInFlightTickets(nextTickets);
      setCancelRequestedTicketKeys((prev) => {
        if (prev.size === 0) return prev;
        let changed = false;
        const next = new Set(prev);
        for (const key of prev) {
          if (!(key in nextTickets)) {
            next.delete(key);
            changed = true;
          }
        }
        return changed ? next : prev;
      });
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
    aiConfigured: aiPlanActions.aiConfigured,
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
        const message = getReadableErrorMessage(
          err,
          'Could not reach AI analysis service; local plan preserved.'
        );
        setAnalysisErrors((prev) => ({
          ...prev,
          [projectId]: message,
        }));
        setStatusNotification(message);
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
  }, []);

  // Kept in App.tsx for releaseQualification contract check.
  const handleSwitchProject = (projectId: string) => {
    navigateWithFlush(() => {
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
    });
  };

  // Kept in App.tsx for storageLifecycle contract check.
  const handleDeleteProject = (projectId: string) => {
    navigateWithFlush(() => {
      if (activeProjectRef.current.id === projectId) cancelAutosave();
      resetProjectSaveState(projectId);
      aiTicketAuthorityRef.current?.invalidateProject(projectId);
      void deleteProjectCompletely(projectId).then((delRes) => {
        applyPostDeleteState(projectId, delRes);
      });
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

  const activeOperations = useMemo(
    () =>
      deriveTicketOperationActivities(
        inFlightTickets,
        activeProject.id,
        activeProject.revision,
        new Map(),
        cancelRequestedTicketKeys,
        0
      ),
    [inFlightTickets, activeProject.id, activeProject.revision, cancelRequestedTicketKeys]
  );

  const handleCancelActiveOperation = useCallback(
    (operationId: string) => {
      setCancelRequestedTicketKeys((prev) => new Set(prev).add(operationId));
      aiTicketAuthorityRef.current?.invalidateProject(activeProjectRef.current.id);
      setStatusNotification('Cancel requested for active AI operation.');
    },
    []
  );

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
    navigateWithFlush(() => {
      setRightPanelTab(panel);
      setMobileTab('inspector');
      if (target) setHistoryTarget((previous) => ({ id: target, sequence: (previous?.sequence ?? 0) + 1 }));
      setWorkspaceMode('plan');
    });
  };

  const handleSelectHeaderSection = (section: WorkspaceSection) => {
    navigateWithFlush(() => {
      setWorkspaceMode('plan');
      if (section === 'story-bible') {
        setRightPanelTab('story-bible');
        setMobileTab('inspector');
      } else if (section === 'history') {
        setRightPanelTab('history');
        setMobileTab('inspector');
        setHistoryTarget((previous) => ({ id: 'revision-history', sequence: (previous?.sequence ?? 0) + 1 }));
      } else if (section === 'output') {
        setShowOutputDrawer(true);
        setMobileTab('output');
      } else {
        setRightPanelTab('inspector');
        setMobileTab('graph');
      }
    });
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

  const handleSaveCreativeData = useCallback(
    (updates: {
      creativeSessions?: CreativeSession[];
      creativeIdeas?: CreativeIdeaCard[];
      readingMarginNotes?: ReadingMarginNote[];
    }) => {
      const current = activeProjectRef.current;
      const updatedProject = applyCreativeWorkspaceMetadataToProject(current, updates);
      hasLocalEditsSinceMountRef.current = true;
      publishCurrentProject(updatedProject, undoStateRef.current);
      const nextSaved = savedProjectsRef.current.map((p) =>
        p.id === updatedProject.id ? updatedProject : p
      );
      savedProjectsRef.current = nextSaved;
      setSavedProjects(nextSaved);
      if (canWriteWorkspace()) {
        void flushProjectDurably(updatedProject, {
          expectedPersistedRevision: current.persistedRevision,
        });
      }
    },
    [canWriteWorkspace, flushProjectDurably, publishCurrentProject]
  );

  const handleSaveProposalDraft = useCallback(
    (draftProposal: UnifiedProposal) => {
      const current = activeProjectRef.current;
      const existingList = current.narrative?.unifiedProposals ?? [];
      const filtered = existingList.filter((item) => item.id !== draftProposal.id);
      const nextList = [draftProposal, ...filtered].slice(0, 20);
      const updatedProject: CreativeProject = {
        ...current,
        updatedAt: Date.now(),
        narrative: {
          ...(current.narrative ?? {
            versions: [],
            sectionVersions: [],
            sources: [],
            claims: [],
            issues: [],
            audit: [],
          }),
          unifiedProposals: nextList,
        },
      };
      setActiveUnifiedProposal(draftProposal);
      hasLocalEditsSinceMountRef.current = true;
      publishCurrentProject(updatedProject, undoStateRef.current);
      const nextSaved = savedProjectsRef.current.map((p) =>
        p.id === updatedProject.id ? updatedProject : p
      );
      savedProjectsRef.current = nextSaved;
      setSavedProjects(nextSaved);
      if (canWriteWorkspace()) {
        void flushProjectDurably(updatedProject, {
          expectedPersistedRevision: current.persistedRevision,
        });
      }
    },
    [canWriteWorkspace, flushProjectDurably, publishCurrentProject]
  );

  const handleOpenUnifiedProposalReview = useCallback(
    (proposal: UnifiedProposal, initialTab: 'diff' | 'changemap' | 'locks' = 'diff') => {
      if (
        !shouldAllowNonDestructiveOverlay({
          isCompositionPending: () => compositionPendingRef.current,
          notify: setStatusNotification,
        })
      ) {
        return;
      }
      handleSaveProposalDraft(proposal);
      setUnifiedProposalInitialTab(initialTab);
      setShowUnifiedProposalModal(true);
    },
    [handleSaveProposalDraft]
  );

  const handleApplyUnifiedProposal = useCallback(
    async (proposal: UnifiedProposal): Promise<{ ok: boolean; message?: string }> => {
      const current = activeProjectRef.current;
      if (!canWriteWorkspace()) {
        const msg =
          'Workspace storage is not ready or is blocked. Wait or export a backup before applying proposals.';
        setStatusNotification(msg);
        return { ok: false, message: msg };
      }
      const prepared = prepareUnifiedProposalAtomicCommit(current, undoStateRef.current, proposal);
      if (!prepared.ok) {
        return { ok: false, message: prepared.message };
      }
      const saveResult = await flushProjectDurably(prepared.project, {
        expectedPersistedRevision: current.persistedRevision,
        intentId: prepared.intentId,
      });
      if (!saveResult.saved) {
        const msg =
          saveResult.error ??
          'Durable save failed or detected a storage conflict; canonical state was not modified.';
        setStatusNotification(msg);
        return { ok: false, message: msg };
      }
      const committedProject = saveResult.storedProject ?? {
        ...prepared.project,
        persistedRevision: saveResult.persistedRevision ?? prepared.project.revision,
      };
      hasLocalEditsSinceMountRef.current = true;
      publishCurrentProject(committedProject, prepared.undoHistory);
      const nextSaved = savedProjectsRef.current.map((p) =>
        p.id === committedProject.id ? committedProject : p
      );
      savedProjectsRef.current = nextSaved;
      setSavedProjects(nextSaved);
      setActiveUnifiedProposal(prepared.appliedProposal);
      setLastUndoProposal(prepared.inverseProposal);
      setStatusNotification(
        `Applied proposal "${proposal.title}" atomically and saved durably (Revision #${committedProject.revision}).`
      );
      return {
        ok: true,
        message: `Applied "${proposal.title}" at Revision #${committedProject.revision}. Undo is ready if needed.`,
      };
    },
    [canWriteWorkspace, flushProjectDurably, publishCurrentProject]
  );

  const handleSaveCreativeLocks = useCallback(
    (locks: CreativeLock[]) => {
      const current = activeProjectRef.current;
      const nextRecords = {
        ...(current.narrative ?? {
          versions: [],
          sectionVersions: [],
          sources: [],
          claims: [],
          issues: [],
          audit: [],
        }),
        creativeLocks: locks,
      };
      const updatedProject: CreativeProject = {
        ...current,
        updatedAt: Date.now(),
        narrative: nextRecords,
      };
      hasLocalEditsSinceMountRef.current = true;
      publishCurrentProject(updatedProject, undoStateRef.current);
      const nextSaved = savedProjectsRef.current.map((p) =>
        p.id === updatedProject.id ? updatedProject : p
      );
      savedProjectsRef.current = nextSaved;
      setSavedProjects(nextSaved);
      if (canWriteWorkspace()) {
        void flushProjectDurably(updatedProject, {
          expectedPersistedRevision: current.persistedRevision,
        });
      }
    },
    [canWriteWorkspace, flushProjectDurably, publishCurrentProject]
  );

  const handleExplorePassageInStudio = useCallback(
    (payload: {
      sectionId: string;
      sectionTitle: string;
      startOffset: number;
      endOffset: number;
      selectedText: string;
      initialGoal?: string;
    }) => {
      const current = activeProjectRef.current;
      const newSession = createCreativeSession(current, {
        title: `Scene Explore: ${payload.sectionTitle}`,
        mode: 'discover',
        scope: {
          kind: 'section',
          sectionIds: [payload.sectionId],
          entityIds: [],
        },
        goal:
          payload.initialGoal ||
          `Brainstorm directions for "${payload.sectionTitle}"`,
        compassSummary: payload.selectedText
          ? `Excerpt anchor: "${payload.selectedText.slice(0, 140)}"`
          : undefined,
      });
      const existing = current.narrative?.creativeSessions ?? [];
      handleSaveCreativeData({
        creativeSessions: [newSession, ...existing],
      });
      setActiveStudioSessionId(newSession.id);
      navigateWithFlush(() => setWorkspaceMode('studio'));
    },
    [handleSaveCreativeData, navigateWithFlush]
  );

  const handleTurnQaInsightIntoStudio = useCallback(
    (payload: {
      question: string;
      answer: string;
      suggestedDirection: string;
      citedSourceIds: string[];
    }) => {
      const current = activeProjectRef.current;
      const newSession = createCreativeSession(current, {
        title: `Q&A Seed: ${payload.question.slice(0, 42)}`,
        mode: 'discover',
        goal: payload.suggestedDirection,
        compassSummary: `Grounded in Q&A (${payload.citedSourceIds.length} citations): ${payload.answer.slice(0, 160)}`,
      });
      const existing = current.narrative?.creativeSessions ?? [];
      handleSaveCreativeData({
        creativeSessions: [newSession, ...existing],
      });
      setActiveStudioSessionId(newSession.id);
      navigateWithFlush(() => setWorkspaceMode('studio'));
    },
    [handleSaveCreativeData, navigateWithFlush]
  );

  const resumeBreadcrumb = useMemo<WorkspaceResumeBreadcrumb | null>(
    () => readBrowserResumeBreadcrumb(activeProject.id),
    [activeProject.id]
  );

  useEffect(() => {
    if (workspaceMode === 'projects' || workspaceMode === 'import') return;
    const secTitle = manuscriptSections(activeProject).find(
      (s) => s.id === focusedSectionId
    )?.title;
    const labelMap: Record<WorkspaceMode, string> = {
      write: secTitle ? `Write · ${secTitle}` : 'Write Studio',
      world: 'World & Canon',
      plan: 'World & Canon',
      studio: 'Creative Studio',
      develop: 'Story Development',
      review: 'Review & Sync',
      projects: 'Projects',
      import: 'Import',
    };
    writeBrowserResumeBreadcrumb({
      projectId: activeProject.id,
      mode: workspaceMode,
      label: labelMap[workspaceMode],
      sectionId: focusedSectionId,
      entityId: selectedEntityId ?? undefined,
      sessionId: activeStudioSessionId ?? undefined,
      timestamp: Date.now(),
    });
  }, [
    activeProject,
    activeStudioSessionId,
    focusedSectionId,
    selectedEntityId,
    workspaceMode,
  ]);

  const isWorldWorkspace = workspaceMode === 'world' || workspaceMode === 'plan';
  const showCompanionPane =
    companionState.kind !== 'none' &&
    workspaceMode !== 'projects' &&
    workspaceMode !== 'import';

  return (
    <div
      data-disclosure-mode={disclosureMode}
      className={`${
        isDarkMode ? 'dark' : ''
      } pcc-shell font-sans h-screen flex flex-col text-gray-900 dark:text-gray-100 transition-colors duration-150 overflow-hidden`}
    >
      <Header
        isDarkMode={isDarkMode}
        toggleDarkMode={() => setIsDarkMode((prev) => !prev)}
        onShowInfo={() => setShowInfoModal(true)}
        onLoadSampleProject={() => navigateWithFlush(handleResetSampleProject)}
        savePresentation={savePresentation}
        providerStatusPill={providerHub.pillSummary}
        onOpenAiSettings={openAiSettingsModal}
        project={activeProject}
        projects={savedProjects}
        onSwitchProject={handleSwitchProject}
        onNewProject={() => navigateWithFlush(() => setCreateProjectOpen(true))}
        onOpenImport={() => navigateWithFlush(() => setWorkspaceMode('import'))}
        importDisabled={!hydrationSettled}
        onOpenProjects={() => navigateWithFlush(() => setWorkspaceMode('projects'))}
        onOpenCommandPalette={() => setShowCommandPalette(true)}
        disclosureMode={disclosureMode}
        onToggleDisclosureMode={() =>
          setDisclosureMode((prev) => (prev === 'calm' ? 'deep' : 'calm'))
        }
        resumeBreadcrumb={resumeBreadcrumb}
        onResumeWork={() => {
          if (!resumeBreadcrumb) return;
          navigateWithFlush(() => {
            if (resumeBreadcrumb.sectionId) setFocusedSectionId(resumeBreadcrumb.sectionId);
            if (resumeBreadcrumb.entityId) setSelectedEntityId(resumeBreadcrumb.entityId);
            if (resumeBreadcrumb.sessionId) setActiveStudioSessionId(resumeBreadcrumb.sessionId);
            setWorkspaceMode(resumeBreadcrumb.mode);
          });
        }}
      />

      {!resumeBannerDismissed &&
        resumeBreadcrumb &&
        resumeBreadcrumb.mode !== workspaceMode && (
          <div
            data-testid="resume-work-banner"
            className="flex flex-wrap items-center justify-between gap-2 border-b border-emerald-500/30 bg-emerald-50/80 px-4 py-1.5 text-xs text-emerald-950 dark:border-emerald-500/30 dark:bg-emerald-950/40 dark:text-emerald-200"
          >
            <span>
              Continue where you left off: <strong>{resumeBreadcrumb.label}</strong>
            </span>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => {
                  navigateWithFlush(() => {
                    if (resumeBreadcrumb.sectionId) setFocusedSectionId(resumeBreadcrumb.sectionId);
                    if (resumeBreadcrumb.entityId) setSelectedEntityId(resumeBreadcrumb.entityId);
                    if (resumeBreadcrumb.sessionId) setActiveStudioSessionId(resumeBreadcrumb.sessionId);
                    setWorkspaceMode(resumeBreadcrumb.mode);
                    setResumeBannerDismissed(true);
                  });
                }}
                className="rounded bg-emerald-700 px-2.5 py-1 text-[11px] font-semibold text-white hover:bg-emerald-600"
              >
                Resume Position
              </button>
              <button
                type="button"
                onClick={() => setResumeBannerDismissed(true)}
                className="rounded border border-emerald-500/40 px-2 py-1 text-[11px] hover:bg-emerald-100 dark:hover:bg-emerald-900/50"
              >
                Dismiss
              </button>
            </div>
          </div>
        )}

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
        canUndo={undoState.past.length > 0 && !manuscriptDraftDirty && !restorePending}
        undoLabel={undoState.past[undoState.past.length - 1]?.label}
        onUndo={planHandlers.handleUndo}
      />

      <OperationActivityStrip
        operations={activeOperations}
        activeRevision={activeProject.revision}
        onCancelOperation={handleCancelActiveOperation}
      />

      {/* M6 Workspace Navigation: Projects Anchor Left + 5 Intent Workspaces + Utility & Companion Triggers */}
      <nav
        aria-label="Narrative workspace"
        className="flex flex-wrap items-center gap-1.5 border-b border-pcc-line bg-pcc-surface px-3 py-2 dark:border-pcc-dark-line dark:bg-pcc-dark-surface sm:px-5"
      >
        <button
          type="button"
          data-testid="nav-projects-anchor-btn"
          aria-current={workspaceMode === 'projects' ? 'page' : undefined}
          className="min-h-10 rounded-md border border-pcc-line bg-pcc-canvas px-3 text-sm font-medium text-pcc-ink transition-colors hover:bg-pcc-surface aria-[current=page]:border-pcc-action aria-[current=page]:text-pcc-action focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-pcc-focus dark:border-pcc-dark-line dark:bg-pcc-dark-canvas dark:text-pcc-dark-ink"
          onClick={() => navigateWithFlush(() => setWorkspaceMode('projects'))}
        >
          Projects
        </button>

        <div
          className="inline-flex flex-wrap rounded-lg border border-pcc-line bg-pcc-canvas p-0.5 dark:border-pcc-dark-line dark:bg-pcc-dark-canvas"
          role="group"
          aria-label="Workspace mode"
        >
          {([
            ['write', 'Write'],
            ['world', 'World'],
            ['studio', 'Creative Studio'],
            ['develop', 'Story Development'],
            ['review', 'Review'],
          ] as const).map(([modeKey, label]) => {
            const isCurrent =
              modeKey === 'world' ? isWorldWorkspace : workspaceMode === modeKey;
            return (
              <button
                type="button"
                key={modeKey}
                data-testid={`nav-workspace-${modeKey}`}
                aria-current={isCurrent ? 'page' : undefined}
                className="min-h-10 rounded-md px-3 text-sm font-medium text-pcc-muted transition-colors hover:text-pcc-ink aria-[current=page]:bg-pcc-surface aria-[current=page]:text-pcc-action aria-[current=page]:shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-pcc-focus dark:text-pcc-dark-muted dark:hover:text-pcc-dark-ink dark:aria-[current=page]:bg-pcc-dark-surface dark:aria-[current=page]:text-pcc-dark-ink"
                onClick={() => {
                  if (isCurrent) return;
                  navigateWithFlush(() => {
                    setAdoptArtifactId(undefined);
                    setWorkspaceMode(modeKey);
                  });
                }}
              >
                {label}
              </button>
            );
          })}
        </div>

        <div className="ml-auto flex flex-wrap items-center gap-1">
          <button
            type="button"
            data-testid="toggle-qa-companion-btn"
            aria-pressed={companionState.kind === 'qa'}
            className={`min-h-10 rounded-md border px-2.5 text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-pcc-focus ${
              companionState.kind === 'qa'
                ? 'border-emerald-500/50 bg-emerald-50 text-emerald-900 dark:bg-emerald-950/60 dark:text-emerald-200'
                : 'border-pcc-line bg-pcc-canvas text-pcc-muted hover:text-pcc-ink dark:border-pcc-dark-line dark:bg-pcc-dark-canvas dark:text-pcc-dark-muted'
            }`}
            onClick={() =>
              setCompanionState((prev) => ({
                ...prev,
                kind: prev.kind === 'qa' ? 'none' : 'qa',
              }))
            }
          >
            Story Q&amp;A
          </button>
          <button
            type="button"
            data-testid="toggle-dual-pane-companion-btn"
            aria-pressed={companionState.kind !== 'none'}
            className={`min-h-10 rounded-md border px-2.5 text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-pcc-focus ${
              companionState.kind !== 'none'
                ? 'border-indigo-500/50 bg-indigo-50 text-indigo-900 dark:bg-indigo-950/60 dark:text-indigo-200'
                : 'border-pcc-line bg-pcc-canvas text-pcc-muted hover:text-pcc-ink dark:border-pcc-dark-line dark:bg-pcc-dark-canvas dark:text-pcc-dark-muted'
            }`}
            onClick={() =>
              setCompanionState((prev) => ({
                ...prev,
                kind: prev.kind === 'none' ? 'entity' : 'none',
              }))
            }
          >
            Companion
          </button>
          <button
            type="button"
            data-testid="open-narrative-search-btn"
            className="min-h-10 rounded-md px-2.5 text-xs font-medium text-pcc-muted hover:bg-pcc-canvas focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-pcc-focus dark:text-pcc-dark-muted dark:hover:bg-pcc-dark-canvas"
            onClick={() => {
              if (
                shouldAllowNonDestructiveOverlay({
                  isCompositionPending: () => compositionPendingRef.current,
                  notify: setStatusNotification,
                })
              ) {
                setShowSearchModal(true);
              }
            }}
            aria-haspopup="dialog"
          >
            Search
          </button>
          <button
            type="button"
            data-testid="open-context-inspector-btn"
            className="min-h-10 rounded-md px-2.5 text-xs font-medium text-pcc-muted hover:bg-pcc-canvas focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-pcc-focus dark:text-pcc-dark-muted dark:hover:bg-pcc-dark-canvas"
            onClick={() => {
              if (
                shouldAllowNonDestructiveOverlay({
                  isCompositionPending: () => compositionPendingRef.current,
                  notify: setStatusNotification,
                })
              ) {
                setShowContextInspector(true);
              }
            }}
            aria-haspopup="dialog"
          >
            Context Inspector
          </button>
          <button
            type="button"
            data-testid="open-unified-proposal-engine-btn"
            className="min-h-10 rounded-md px-2.5 text-xs font-medium text-pcc-muted hover:bg-pcc-canvas focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-pcc-focus dark:text-pcc-dark-muted dark:hover:bg-pcc-dark-canvas"
            onClick={() => {
              if (
                !shouldAllowNonDestructiveOverlay({
                  isCompositionPending: () => compositionPendingRef.current,
                  notify: setStatusNotification,
                })
              ) {
                return;
              }
              if (!activeUnifiedProposal && stagedBatchPreview) {
                const converted = buildUnifiedProposalFromBatchEdit(activeProject, stagedBatchPreview);
                handleSaveProposalDraft(converted);
                setUnifiedProposalInitialTab('diff');
              }
              setShowUnifiedProposalModal(true);
            }}
            aria-haspopup="dialog"
          >
            Proposals &amp; Locks (E3)
          </button>
          {disclosureMode === 'deep' && (
            <button
              type="button"
              className="min-h-10 rounded-md px-2.5 text-xs font-medium text-pcc-muted hover:bg-pcc-canvas focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-pcc-focus dark:text-pcc-dark-muted dark:hover:bg-pcc-dark-canvas"
              onClick={openAiSettingsModal}
              aria-haspopup="dialog"
            >
              AI settings
            </button>
          )}
        </div>
        <div className="flex flex-wrap justify-end gap-1 sm:hidden">
          <button
            type="button"
            className="min-h-10 rounded-md bg-pcc-action px-2.5 text-xs font-semibold text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-pcc-focus"
            onClick={() => navigateWithFlush(() => setCreateProjectOpen(true))}
          >
            New
          </button>
          <button
            type="button"
            disabled={!hydrationSettled}
            className="min-h-10 rounded-md px-2.5 text-xs font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-pcc-focus disabled:opacity-45"
            onClick={() => navigateWithFlush(() => setWorkspaceMode('import'))}
          >
            Import
          </button>
        </div>
      </nav>

      {/* Main Split Workspace + Optional Dual-Pane Companion */}
      <div className="flex min-h-0 flex-1 overflow-hidden">
      <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
      <div
        hidden={workspaceMode !== 'write'}
        className={workspaceMode === 'write' ? 'flex min-h-0 flex-1 flex-col' : undefined}
      >
        <ManuscriptEditor
          key={activeProject.id}
          project={activeProject}
          isActive={workspaceMode === 'write'}
          onSave={narrativeActions.saveManuscript}
          flushDraftRef={flushDraftRef}
          hydrationGate={hydrationGate}
          initialArtifactId={adoptArtifactId}
          onDismissAdoption={() => setAdoptArtifactId(undefined)}
          focusedSectionId={focusedSectionId}
          aiConfigured={aiPlanActions.aiConfigured}
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
          onOpenContextInspector={(secId) => {
            if (secId) setFocusedSectionId(secId);
            setShowContextInspector(true);
          }}
          onReviewUnifiedProposal={(proposal) => handleOpenUnifiedProposalReview(proposal, 'diff')}
          readingMarginNotes={activeProject.narrative?.readingMarginNotes ?? []}
          onSaveMarginNotes={(notes) => handleSaveCreativeData({ readingMarginNotes: notes })}
          onExplorePassageInStudio={handleExplorePassageInStudio}
          onOpenStoryDevelopment={(secId) => {
            if (secId) setFocusedSectionId(secId);
            navigateWithFlush(() => setWorkspaceMode('develop'));
          }}
          onAskQaAboutPassage={(query) => {
            setQaInitialQuestion(query);
            setCompanionState((prev) => ({
              ...prev,
              kind: 'qa',
            }));
          }}
        />
      </div>

      {workspaceMode === 'studio' && (
        <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
          <CreativeStudioWorkspace
            key={activeProject.id}
            project={activeProject}
            aiConfigured={aiPlanActions.aiConfigured}
            disclosureMode={disclosureMode}
            activeSessionId={activeStudioSessionId}
            onSelectSessionId={setActiveStudioSessionId}
            onSaveCreativeData={handleSaveCreativeData}
            onReviewUnifiedProposal={(proposal) => handleOpenUnifiedProposalReview(proposal, 'diff')}
            onOpenContextInspector={() => setShowContextInspector(true)}
            onNavigateToWorldOutput={() => navigateWithFlush(() => setWorkspaceMode('world'))}
            onJumpToSection={(sectionId) => {
              navigateWithFlush(() => {
                setFocusedSectionId(sectionId);
                setWorkspaceMode('write');
              });
            }}
          />
        </div>
      )}

      {workspaceMode === 'develop' && (
        <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
          <StoryDevelopmentWorkspace
            key={activeProject.id}
            project={activeProject}
            aiConfigured={aiPlanActions.aiConfigured}
            disclosureMode={disclosureMode}
            onReviewUnifiedProposal={(proposal) => handleOpenUnifiedProposalReview(proposal, 'diff')}
            onOpenCreativeLocks={() => {
              setUnifiedProposalInitialTab('locks');
              setShowUnifiedProposalModal(true);
            }}
            onJumpToSection={(sectionId) => {
              navigateWithFlush(() => {
                setFocusedSectionId(sectionId);
                setWorkspaceMode('write');
              });
            }}
            onOpenInCreativeStudio={(session) => {
              const existing = activeProjectRef.current.narrative?.creativeSessions ?? [];
              handleSaveCreativeData({
                creativeSessions: [session, ...existing],
              });
              setActiveStudioSessionId(session.id);
              navigateWithFlush(() => setWorkspaceMode('studio'));
            }}
          />
        </div>
      )}

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
              aiConfigured={aiPlanActions.aiConfigured}
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
              onOpenContextInspector={() => setShowContextInspector(true)}
              onReviewUnifiedProposal={(proposal) => handleOpenUnifiedProposalReview(proposal, 'diff')}
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
              aiConfigured={aiPlanActions.aiConfigured}
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
              onResumeWorkspace={() =>
                navigateWithFlush(() => setWorkspaceMode(lastStableWorkspaceModeRef.current))
              }
              onOpenProject={(projectId) => {
                navigateWithFlush(() => {
                  handleSwitchProject(projectId);
                  setWorkspaceMode('write');
                });
              }}
              onCreateNewProject={handleCreateNewProject}
              hydrationGate={hydrationGate}
              hasStorageAlert={Boolean(storageAlert && storageAlert.projectId === activeProject.id)}
              onExportJsonBackup={() =>
                triggerProjectBackupDownload(activeProject, `r${activeProject.revision}-backup`)
              }
              onOpenReviewSync={() => navigateWithFlush(() => setWorkspaceMode('review'))}
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
              openImport={() => navigateWithFlush(() => setWorkspaceMode('import'))}
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

      <div className={isWorldWorkspace ? 'flex min-h-0 flex-1 flex-col overflow-hidden' : 'hidden'}>
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
              chatGptStoryLocalActivation={aiPlanActions.chatGptStoryLocalActivation}
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
              onOpenReviewDiagnostics={() => navigateWithFlush(() => setWorkspaceMode('review'))}
              onJumpToSection={(sectionId) => {
                navigateWithFlush(() => {
                  setFocusedSectionId(sectionId);
                  setWorkspaceMode('write');
                });
              }}
              aiConfigured={aiPlanActions.aiConfigured}
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
          showOutputDrawer={showOutputDrawer}
          onToggleOutputDrawer={() => setShowOutputDrawer((value) => !value)}
          revisionCount={activeProject.revision}
          isOutdated={isCurrentOutputOutdated}
          compactOnMobile={isWorldWorkspace}
        />
      </div>
      </div>

      {/* Optional Resizable Dual-Pane Companion */}
      {showCompanionPane && (
        <aside
          data-testid="dual-pane-companion"
          aria-label="Dual-pane companion workspace"
          style={{ width: `${companionState.widthPercent}%` }}
          className="hidden min-w-[280px] max-w-[60vw] shrink-0 flex-col border-l border-pcc-line bg-pcc-surface lg:flex dark:border-pcc-dark-line dark:bg-pcc-dark-surface"
        >
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-pcc-line bg-pcc-canvas px-3 py-2 text-xs dark:border-pcc-dark-line dark:bg-pcc-dark-canvas">
            <select
              aria-label="Companion pane view"
              data-testid="companion-kind-select"
              value={companionState.kind}
              onChange={(e) =>
                setCompanionState((prev) => ({
                  ...prev,
                  kind: e.target.value as CompanionPaneKind,
                }))
              }
              className="rounded border border-pcc-line bg-pcc-surface px-2 py-1 text-xs font-semibold text-pcc-ink dark:border-pcc-dark-line dark:bg-pcc-dark-surface dark:text-pcc-dark-ink"
            >
              <option value="qa">Story Q&amp;A</option>
              <option value="entity">Canon Entity Inspector</option>
              <option value="story-bible">Story Bible Quick View</option>
              <option value="story-map">Scene Map &amp; Index</option>
              <option value="studio">Creative Studio Companion</option>
            </select>
            <div className="flex items-center gap-2">
              <label className="flex items-center gap-1 text-[10px] text-pcc-muted dark:text-pcc-dark-muted">
                <span>Width</span>
                <input
                  type="range"
                  min={28}
                  max={55}
                  value={companionState.widthPercent}
                  onChange={(e) =>
                    setCompanionState((prev) => ({
                      ...prev,
                      widthPercent: Number(e.target.value),
                    }))
                  }
                  className="w-16"
                />
              </label>
              <button
                type="button"
                data-testid="companion-expand-btn"
                onClick={() => {
                  const target =
                    companionState.kind === 'studio'
                      ? 'studio'
                      : companionState.kind === 'entity' || companionState.kind === 'story-bible'
                        ? 'world'
                        : 'write';
                  navigateWithFlush(() => setWorkspaceMode(target));
                }}
                className="rounded border border-pcc-line px-2 py-0.5 text-[11px] hover:bg-pcc-surface dark:border-pcc-dark-line"
              >
                Expand
              </button>
              <button
                type="button"
                data-testid="companion-close-btn"
                onClick={() => setCompanionState((prev) => ({ ...prev, kind: 'none' }))}
                className="rounded border border-pcc-line px-2 py-0.5 text-[11px] hover:bg-pcc-surface dark:border-pcc-dark-line"
              >
                Close
              </button>
            </div>
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto p-3 text-xs">
            {companionState.kind === 'qa' && (
              <StoryQaPanel
                project={activeProject}
                aiConfigured={aiPlanActions.aiConfigured}
                initialQuestion={qaInitialQuestion}
                onJumpToSection={(sectionId) => {
                  navigateWithFlush(() => {
                    setFocusedSectionId(sectionId);
                    setWorkspaceMode('write');
                  });
                }}
                onTurnInsightIntoStudioDraft={handleTurnQaInsightIntoStudio}
                onClose={() => setCompanionState((prev) => ({ ...prev, kind: 'none' }))}
              />
            )}

            {companionState.kind === 'entity' && (
              <div className="space-y-3">
                <div className="font-semibold text-pcc-ink dark:text-pcc-dark-ink">
                  Canonical Entities ({snapshot.entities.length})
                </div>
                <div className="space-y-2">
                  {snapshot.entities.slice(0, 25).map((entity) => (
                    <div
                      key={entity.id ?? entity.name}
                      className="pcc-canon-surface rounded-lg border p-2.5 space-y-1"
                    >
                      <div className="flex items-center justify-between gap-2">
                        <span className="font-semibold text-pcc-ink dark:text-pcc-dark-ink">
                          {entity.name}
                        </span>
                        <span className="text-[10px] uppercase text-pcc-muted dark:text-pcc-dark-muted">
                          {entity.category}
                        </span>
                      </div>
                      {entity.description && (
                        <p className="text-[11px] text-pcc-muted dark:text-pcc-dark-muted">
                          {entity.description}
                        </p>
                      )}
                    </div>
                  ))}
                  {snapshot.entities.length === 0 && (
                    <p className="text-pcc-muted dark:text-pcc-dark-muted">
                      No canonical entities yet. Add or analyze in World.
                    </p>
                  )}
                </div>
              </div>
            )}

            {companionState.kind === 'story-bible' && (
              <div className="space-y-2.5">
                <div className="flex items-center justify-between">
                  <span className="font-semibold text-pcc-ink dark:text-pcc-dark-ink">
                    Story Bible Overview
                  </span>
                  <button
                    type="button"
                    onClick={() => openPlan('story-bible')}
                    className="rounded border border-pcc-line px-2 py-0.5 text-[11px] hover:bg-pcc-canvas dark:border-pcc-dark-line"
                  >
                    Edit in World
                  </button>
                </div>
                {Object.entries(snapshot.storyBible).map(([fieldKey, entry]) => {
                  const fieldObj = entry as { value?: string };
                  return (
                    <div key={fieldKey} className="pcc-canon-surface rounded-lg border p-2.5">
                      <div className="text-[10px] font-semibold uppercase text-pcc-muted dark:text-pcc-dark-muted">
                        {fieldKey}
                      </div>
                      <div className="mt-0.5 text-pcc-ink dark:text-pcc-dark-ink">
                        {fieldObj?.value || '(Unset)'}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}

            {(companionState.kind === 'story-map' || companionState.kind === 'source') && (
              <div className="space-y-2">
                <div className="font-semibold text-pcc-ink dark:text-pcc-dark-ink">
                  Manuscript Scene Index ({manuscriptSections(activeProject).length})
                </div>
                {manuscriptSections(activeProject).map((sec) => (
                  <button
                    key={sec.id}
                    type="button"
                    onClick={() => {
                      navigateWithFlush(() => {
                        setFocusedSectionId(sec.id);
                        setWorkspaceMode('write');
                      });
                    }}
                    className="w-full rounded-lg border border-pcc-line bg-pcc-canvas p-2 text-left hover:border-pcc-action dark:border-pcc-dark-line dark:bg-pcc-dark-canvas"
                  >
                    <div className="font-semibold text-pcc-ink dark:text-pcc-dark-ink">
                      {sec.title || 'Untitled Section'}
                    </div>
                    <div className="mt-0.5 line-clamp-2 text-[11px] text-pcc-muted dark:text-pcc-dark-muted">
                      {sec.text.slice(0, 120) || '(Empty)'}
                    </div>
                  </button>
                ))}
              </div>
            )}

            {companionState.kind === 'studio' && (
              <CreativeStudioWorkspace
                key={`companion-studio:${activeProject.id}`}
                project={activeProject}
                aiConfigured={aiPlanActions.aiConfigured}
                disclosureMode="calm"
                activeSessionId={activeStudioSessionId}
                onSelectSessionId={setActiveStudioSessionId}
                onSaveCreativeData={handleSaveCreativeData}
                onReviewUnifiedProposal={(proposal) =>
                  handleOpenUnifiedProposalReview(proposal, 'diff')
                }
                onOpenContextInspector={() => setShowContextInspector(true)}
                onNavigateToWorldOutput={() => navigateWithFlush(() => setWorkspaceMode('world'))}
              />
            )}
          </div>
        </aside>
      )}
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
            <AiConnectionsPanel project={activeProject} />
          </Suspense>
        </ChunkErrorBoundary>
      </AiSettingsModal>

      <NarrativeSearchModal
        isOpen={showSearchModal}
        onClose={() => setShowSearchModal(false)}
        project={activeProject}
        onJumpToSection={(sectionId) => {
          setShowSearchModal(false);
          navigateWithFlush(() => {
            setFocusedSectionId(sectionId);
            setWorkspaceMode('write');
          });
        }}
        onOpenAiSettings={() => {
          setShowSearchModal(false);
          openAiSettingsModal();
        }}
      />

      <ContextInspectorModal
        isOpen={showContextInspector}
        onClose={() => setShowContextInspector(false)}
        project={activeProject}
        activeSectionId={focusedSectionId ?? manuscriptSections(activeProject)[0]?.id}
        onOpenLocksManager={() => {
          setShowContextInspector(false);
          setUnifiedProposalInitialTab('locks');
          setShowUnifiedProposalModal(true);
        }}
      />

      <UnifiedProposalReviewModal
        isOpen={showUnifiedProposalModal}
        onClose={() => setShowUnifiedProposalModal(false)}
        project={activeProject}
        proposal={activeUnifiedProposal}
        lastUndoProposal={lastUndoProposal}
        onApplyProposal={handleApplyUnifiedProposal}
        onSaveProposalDraft={handleSaveProposalDraft}
        onSaveLocks={handleSaveCreativeLocks}
        initialTab={unifiedProposalInitialTab}
      />

      <CommandPaletteModal
        isOpen={showCommandPalette}
        onClose={() => setShowCommandPalette(false)}
        project={activeProject}
        onNavigateWorkspace={(modeKey) => {
          navigateWithFlush(() => setWorkspaceMode(modeKey));
        }}
        onJumpToSection={(sectionId) => {
          navigateWithFlush(() => {
            setFocusedSectionId(sectionId);
            setWorkspaceMode('write');
          });
        }}
        onInspectEntity={(entityId) => {
          navigateWithFlush(() => {
            setSelectedEntityId(entityId);
            setRightPanelTab('inspector');
            setWorkspaceMode('world');
          });
        }}
        onOpenCreativeSession={(sessionId) => {
          setActiveStudioSessionId(sessionId);
          navigateWithFlush(() => setWorkspaceMode('studio'));
        }}
        onOpenCompanion={(kind) => {
          setCompanionState((prev) => ({
            ...prev,
            kind,
          }));
        }}
        onOpenSearch={() => setShowSearchModal(true)}
        onOpenContextInspector={() => setShowContextInspector(true)}
        onOpenProposalsLocks={() => {
          setUnifiedProposalInitialTab('diff');
          setShowUnifiedProposalModal(true);
        }}
      />
    </div>
  );
}

export default App;
