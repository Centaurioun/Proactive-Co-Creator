/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import ManuscriptEditor, { workspaceButton } from './components/manuscript/ManuscriptEditor';
import ProjectHub from './components/workspace/ProjectHub';
import NarrativeReview from './components/workspace/NarrativeReview';
import ImportWorkflow from './components/narrativeImport/ImportWorkflow';
import { manuscriptSections, manuscriptText, prepareManuscriptChange, type NarrativeBase } from './lib/narrative/manuscriptModel';
import type { StyleProfile } from './lib/narrative/context/styleProfile';
import { listBackups, parseProjectBackup, prepareBackupCopy, prepareBackupReplacement, registryReport, safeFilename, saveBackup } from './lib/narrative/recovery';
import { projectContentExport } from './lib/narrative/recovery/contentExport';
import { projectContentBundle } from './lib/narrative/recovery/bundleExporter';
import { restoreArchiveProjectsSequentially, type ArchiveRestoreSequenceResult } from './lib/narrative/recovery/allProjectsArchive';
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
import StorageAlertBanner, { type StorageConflictAlert } from './components/workspace/StorageAlertBanner';
import ReviewDiffModal from './components/workspace/ReviewDiffModal';
import {
  applyDiagnosticFixAlternative,
  collectLocalDiagnosticFindings,
  convertSemanticFindingsToDiagnosticFindings,
  ensureNarrativeEnvelope,
  syncDiagnosticFindingsIntoProject,
} from './lib/narrative/diagnostics/engine';
import {
  applyManuscriptSyncPatch,
  applyModelSyncProposal,
  recordSyncReviewCheckpoint,
} from './lib/narrative/sync/syncProposals';
import {
  applyAppendToExistingProject,
  type AppendInsertPosition,
  type CrossProjectIdentityDecision,
} from './lib/narrative/import/appendApply';
import type { ArtifactAnchor, ManuscriptSection, NarrativeRecords, OpportunityProposal } from './shared/narrativeTypes';
import type {
  DiagnosticFixAlternative,
  SemanticDiagnosticFinding,
  SyncManuscriptPatch,
  SyncModelProposal,
  WritingAssistAction,
} from './shared/narrativeAiSchemas';
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
  validateStoryBibleUpdate,
} from './lib/canonicalModel';
import {
  evaluateProjectConsistency,
  resolveConsistencyIssueTarget,
} from './lib/consistencyChecker';
import {
  computeSnapshotDigest,
  createUndoRedoState,
  recordProjectRevision,
  restoreProjectRevision,
  serializeUndoHistory,
  type UndoRedoState,
} from './lib/historyEngine';
import {
  interpretBatchInstructionLocally,
} from './lib/nlBatchEngine';
import {
  acceptPolishProposal,
  buildReviewDiffModel,
  commitBatchPreviewToProject,
  commitRedoTransaction,
  commitSnapshotTransaction,
  commitUndoTransaction,
  createAiTicketAuthority,
  createPolishProposal,
  createSerializedProjectSaveQueue,
  isProjectActionLoading,
  prepareProjectSwitch,
  reconcileAsyncSaveAcknowledgement,
  refreshArtifactsCurrentness,
  resolveHydrationWriteGate,
  runAsyncAnalysisSlot,
  runAsyncClarifySlot,
  runAsyncGenerationSlot,
  shouldAllowUnsolicitedPersistence,
  upsertProjectInSavedList,
  validatePolishProposalAcceptance,
  type AiTicketAuthority,
  type HydrationWriteGate,
  type InFlightTicketsMap,
  type SerializedSaveOptions,
} from './lib/projectController';
import { buildStartupAnalysisProviderInputs, resolveProviderPrompt, synthesizeRefinedPrompt } from './lib/promptBuilder';
import { transitionIssue } from './lib/narrative/issueRegistry';
import { projectRelationships } from './lib/narrative/projections/relationshipProjection';
import { createOpportunityProposal, transitionOpportunityProposal, type OpportunityProposalInput, type OpportunityProposalStatus } from './lib/narrative/opportunityProposals';
import {
  deleteProjectCompletely,
  getDeletedProjectIds,
  setCachedProjectSelection,
  loadProjectsFromIndexedDbDetailed,
  loadProjectsFromLocalStorage,
  persistProjectDurably,
  reconcileHydratedProjects,
  reloadLatestProjectsFromStorage,
  saveProjectToLocalStorage,
  type StorageSaveResult,
} from './lib/storageEngine';
import {
  analyzePromptToBeliefGraph,
  ClientApiError,
  fetchAiCapabilities,
  generateClarifications,
  generateImagesFromPrompt,
  generateStoryFromPrompt,
  isAbortError,
  refinePromptWithAllUpdates,
  requestBatchEditInterpretation,
  requestSemanticDiagnostics,
} from './services/apiClient';
import {
  MAX_PROMPT_CHARS,
  validateEffectivePromptLength,
} from './shared/schemas';
import type {
  AiPolishProposal,
  BatchCommitResult,
  BatchEditProposalResult,
  ConsistencyIssueTarget,
  CreativeProject,
  DecisionItem,
  EntityCategory,
  GenerationMode,
  ProjectSnapshot,
  Relationship,
  StoryBibleFields,
} from './shared/types';

type MobileTab = 'decisions' | 'graph' | 'inspector' | 'output';

const AUTO_BACKUP_PREF_KEY = 'pcc_auto_backup_pref_v1';

function getReadableErrorMessage(error: unknown, fallback: string): string {
  if (error instanceof ClientApiError) return error.message;
  if (error instanceof Error && error.message) return error.message;
  return fallback;
}

function App() {
  const initialData = useMemo(() => loadProjectsFromLocalStorage({ skipAutoSeedIfEmpty: true, readOnly: true }), []);
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
    createUndoRedoState(
      initialProject.snapshot,
      initialProject.revisions,
      initialProject.undoHistory
    )
  );

  const snapshot = undoState.present;
  const mode = snapshot.mode;

  // Selection & UI workspace navigation
  const [selectedEntityId, setSelectedEntityId] = useState<string | null>(null);
  const [selectedRelationshipId, setSelectedRelationshipId] = useState<string | null>(null);
  const [rightPanelTab, setRightPanelTab] = useState<RightPanelTab>('inspector');
  const [adoptArtifactId, setAdoptArtifactId] = useState<string>();
  const [focusedSectionId, setFocusedSectionId] = useState<string>();
  const [historyTarget, setHistoryTarget] = useState<{ id: string; sequence: number } | null>(null);
  const [workspaceMode, setWorkspaceMode] = useState<'write' | 'plan' | 'review' | 'projects' | 'import'>('plan');
  const [aiConfigured, setAiConfigured] = useState<boolean>(false);
  const [autoAnalysisCallsUsed, setAutoAnalysisCallsUsed] = useState<number>(0);
  const [autoBackupEnabled, setAutoBackupEnabled] = useState<boolean>(() => {
    try {
      return window.localStorage?.getItem(AUTO_BACKUP_PREF_KEY) === 'true';
    } catch {
      return false;
    }
  });
  const lastAutoBackupRevisionRef = useRef<Record<string, number>>({});
  const draftDirtyRef = useRef(false);
  const restorePendingRef = useRef(false);
  const creatingImportedProjectRef = useRef(false);

  const [mobileTab, setMobileTab] = useState<MobileTab>('graph');
  const [showOutputDrawer, setShowOutputDrawer] = useState<boolean>(true);
  const [isDarkMode, setIsDarkMode] = useState<boolean>(false);
  const [showInfoModal, setShowInfoModal] = useState<boolean>(false);
  const [isReviewModalOpen, setIsReviewModalOpen] = useState<boolean>(false);
  const [statusNotification, setStatusNotification] = useState<string | null>(null);
  const [storageAlert, setStorageAlert] = useState<StorageConflictAlert | null>(null);

  function allowNavigation(): boolean {
    if (!draftDirtyRef.current && !restorePendingRef.current) return true;
    setStatusNotification('Save the open manuscript draft or wait for the restore before leaving this workspace.');
    return false;
  }

  // Staged state mirrored from DecisionInboxPanel for the Review Modal diff view (U-01)
  const [stagedBatchPreview, setStagedBatchPreview] = useState<BatchEditProposalResult | null>(null);
  const [stagedDecisionDrafts, setStagedDecisionDrafts] = useState<Record<string, string>>({});
  const [storyBibleErrors, setStoryBibleErrors] = useState<
    Partial<Record<keyof StoryBibleFields, string>>
  >({});
  const [focusedStoryBibleField, setFocusedStoryBibleField] = useState<{
    field: keyof StoryBibleFields;
    seq: number;
  } | null>(null);

  // Scoped Request Tickets (single synchronous controller authority; React state is a UI projection)
  const [inFlightTickets, setInFlightTickets] = useState<InFlightTicketsMap>({});
  const [aiTicketAuthority] = useState<AiTicketAuthority>(() =>
    createAiTicketAuthority((nextTickets) => {
      setInFlightTickets(nextTickets);
    })
  );
  const aiTicketAuthorityRef = useRef<AiTicketAuthority>(aiTicketAuthority);
  const [polishProposalsByProject, setPolishProposalsByProject] = useState<
    Record<string, AiPolishProposal>
  >({});

  const [analysisErrors, setAnalysisErrors] = useState<Record<string, string | null>>({});
  const [clarificationErrors, setClarificationErrors] = useState<Record<string, string | null>>({});
  const [galleryErrors, setGalleryErrors] = useState<
    Record<string, Record<GenerationMode, string | null>>
  >({});

  const [hydrationGate, setHydrationGate] = useState<HydrationWriteGate>('pending');
  const hydrationGateRef = useRef<HydrationWriteGate>('pending');
  const [hydrationSettled, setHydrationSettled] = useState(false);
  const hydrationSettledRef = useRef(false);
  const markHydrationSettled = () => {
    hydrationSettledRef.current = true;
    setHydrationSettled(true);
  };
  const updateHydrationGate = useCallback((nextGate: HydrationWriteGate) => {
    hydrationGateRef.current = nextGate;
    setHydrationGate(nextGate);
  }, []);

  const autosaveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const appliedBatchProposalIdsRef = useRef<Set<string>>(new Set());
  const hasLocalEditsSinceMountRef = useRef<boolean>(false);
  const saveQueueRef = useRef(createSerializedProjectSaveQueue(persistProjectDurably));

  useEffect(() => () => {
    aiTicketAuthorityRef.current?.invalidateAll();
  }, []);

  const reviewButtonRef = useRef<HTMLButtonElement | null>(null);

  // Derive synchronized active project with current undoState.present snapshot and persisted Undo/Redo stacks
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

  const flushProjectDurably = useCallback(
    (
      targetProject: CreativeProject,
      options?: SerializedSaveOptions & { clearConflictOnSuccess?: boolean; successNotification?: string }
    ): Promise<StorageSaveResult> => {
      if (!options?.allowDeleted && getDeletedProjectIds().has(targetProject.id)) {
        setSavedProjects((prev) => {
          const next = prev.filter((p) => p.id !== targetProject.id);
          savedProjectsRef.current = next;
          return next;
        });
        return Promise.resolve({
          ok: false,
          saved: false,
          error: `Project "${targetProject.id}" was deleted before save executed.`,
        });
      }

      return saveQueueRef.current.enqueue(targetProject, options).then((res) => {
        if (!options?.allowDeleted && getDeletedProjectIds().has(targetProject.id)) {
          setSavedProjects((prev) => {
            const next = prev.filter((p) => p.id !== targetProject.id);
            savedProjectsRef.current = next;
            return next;
          });
          return res;
        }
        if (!res.saved && res.conflictDetected) {
          setStorageAlert({
            type: 'conflict',
            projectId: targetProject.id,
            conflictingProject: res.storedProject,
            message:
              res.error ??
              'Storage conflict: a newer or divergent project revision exists in durable storage.',
          });
          return res;
        }
        if (!res.saved) {
          setStorageAlert({
            type: res.quotaExceeded ? 'quota' : 'error',
            projectId: targetProject.id,
            message:
              res.error ??
              'Durable save failed. Export a JSON backup to prevent data loss.',
          });
          return res;
        }

        const ackRevision = res.persistedRevision ?? (targetProject.revision ?? 1);
        const acknowledgedProject = res.idempotentHit && res.storedProject
          ? res.storedProject
          : targetProject;
        setProject((prev) => {
          if (prev.id !== targetProject.id) return prev;
          const nextPersisted = Math.max(prev.persistedRevision ?? 0, ackRevision);
          return prev.persistedRevision !== nextPersisted
            ? { ...prev, persistedRevision: nextPersisted }
            : prev;
        });
        setSavedProjects((prev) => {
          const reconciled = reconcileAsyncSaveAcknowledgement({
            acknowledgedProject,
            acknowledgedRevision: ackRevision,
            currentActiveProject: activeProjectRef.current,
            savedProjects: prev,
          });
          savedProjectsRef.current = reconciled.savedProjects;
          return reconciled.savedProjects;
        });

        if (options?.clearConflictOnSuccess) {
          setStorageAlert(null);
        }
        if (options?.successNotification) {
          setStatusNotification(options.successNotification);
        }

        if (res.quotaExceeded || res.cacheSynced === false) {
          if (res.cacheWarning || res.error) {
            setStorageAlert({
              type: res.quotaExceeded ? 'quota' : 'error',
              projectId: targetProject.id,
              message:
                res.cacheWarning ??
                res.error ??
                'Saved to authoritative IndexedDB, but localStorage cache could not be updated.',
            });
          }
        }
        return res;
      });
    },
    []
  );

  // Hydrate full projects & media artifacts from IndexedDB on initial mount (F-02 / IA-04 / FIX 1 / T4)
  useEffect(() => {
    let cancelled = false;
    // Preserve the legacy migration checkpoint outside render.
    loadProjectsFromLocalStorage({ skipAutoSeedIfEmpty: true });
    void loadProjectsFromIndexedDbDetailed()
      .then(async (idbLoad) => {
        if (cancelled) return;
        const resolvedGate = resolveHydrationWriteGate(idbLoad.status);

        // FIX 1 / T4: Never treat an IndexedDB read error as empty storage or unlock background IDB writes
        if (idbLoad.status === 'read_error') {
          updateHydrationGate(resolvedGate);
          setStorageAlert({
            type: 'error',
            projectId: activeProjectRef.current.id,
            message: `IndexedDB read failure (${idbLoad.error ?? 'Unable to read durable database'}). Automatic sample seeding and background saves are paused to protect existing IndexedDB records. Click Retry Storage Read or export a JSON backup.`,
          });
          return;
        }
        if (idbLoad.status === 'unavailable') {
          if (savedProjectsRef.current.length === 0) {
            const sample = activeProjectRef.current;
            const saved = saveProjectToLocalStorage(sample, { expectedBaseProject: null });
            if (saved.saved) setSavedProjects([sample]);
          }
          updateHydrationGate(resolvedGate);
          markHydrationSettled();
          return;
        }
        if (idbLoad.corruptRecordCount > 0) {
          setStorageAlert({
            type: 'error',
            projectId: activeProjectRef.current.id,
            message: `Skipped ${idbLoad.corruptRecordCount} corrupt or unsupported record(s) in IndexedDB while preserving recoverable projects.`,
          });
        }

        const idbProjects = idbLoad.projects;
        const observedActive = activeProjectRef.current;
        const observedUndo = undoStateRef.current;
        const reconciled = reconcileHydratedProjects({
          localProjects: savedProjectsRef.current,
          idbProjects,
          activeProject: activeProjectRef.current,
          activeUndoState: undoStateRef.current,
          hasLocalEditsSinceMount: hasLocalEditsSinceMountRef.current,
          localWasAutoSeededSample: initialData.autoSeededSample,
        });
        if (reconciled.conflictWithHydrated) {
          const idbBibleSummary =
            reconciled.conflictWithHydrated.snapshot.storyBible.genre.value ||
            reconciled.conflictWithHydrated.snapshot.storyBible.setting.value ||
            reconciled.conflictWithHydrated.snapshot.originalIdea.slice(0, 40);
          const localBibleSummary =
            reconciled.activeProject.snapshot.storyBible.genre.value ||
            reconciled.activeProject.snapshot.storyBible.setting.value ||
            reconciled.activeProject.snapshot.originalIdea.slice(0, 40);
          setStorageAlert({
            type: 'conflict',
            projectId: reconciled.activeProject.id,
            conflictingProject: reconciled.conflictWithHydrated,
            message: `Storage hydration conflict: IndexedDB holds revision #${reconciled.conflictWithHydrated.revision} ("${idbBibleSummary}") while this tab has revision #${reconciled.activeProject.revision} ("${localBibleSummary}"). Both versions are preserved until you choose which to keep.`,
          });
        } else {
          const idbActive = idbProjects.find((p) => p.id === reconciled.activeProject.id);
          if (!idbActive || idbActive.revision < reconciled.activeProject.revision) {
            const result = await saveQueueRef.current.enqueue(reconciled.activeProject, {
              expectedBaseProject: idbActive ?? null,
              expectedPersistedRevision: idbActive?.revision,
            });
            if (cancelled) return;
            if (!result.saved) {
              updateHydrationGate('blocked-read-error');
              setStorageAlert({
                type: 'error',
                projectId: activeProjectRef.current.id,
                message: result.error ?? 'Could not initialize durable storage. Retry the storage read.',
              });
              return;
            }
            reconciled.activeProject = {
              ...reconciled.activeProject,
              persistedRevision: result.persistedRevision,
            };
            reconciled.savedProjects = [
              reconciled.activeProject,
              ...reconciled.savedProjects.filter(p => p.id !== reconciled.activeProject.id),
            ];
          }
        }

        if (activeProjectRef.current === observedActive && undoStateRef.current === observedUndo) {
          setSavedProjects(reconciled.savedProjects);
          if (!initialData.activeProjectId) setCachedProjectSelection(reconciled.activeProject.id);
          if (reconciled.activeProject !== observedActive || reconciled.activeUndoState !== observedUndo) {
            setProject(reconciled.activeProject);
            setUndoState(reconciled.activeUndoState);
            if (reconciled.upgradedFromIndexedDb && !reconciled.conflictWithHydrated) {
              saveProjectToLocalStorage(reconciled.activeProject, { selectProject: false });
            }
          }
        }
        updateHydrationGate(resolvedGate);
        markHydrationSettled();
      })
      .catch((err) => {
        if (cancelled) return;
        updateHydrationGate('blocked-read-error');
        setStorageAlert({
          type: 'error',
          projectId: activeProjectRef.current.id,
          message: getReadableErrorMessage(
            err,
            'Could not hydrate projects from IndexedDB; background durable writes are paused. Click Retry Storage Read or export a JSON backup.'
          ),
        });
      });
    return () => {
      cancelled = true;
    };
  }, [updateHydrationGate, initialData.autoSeededSample, initialData.activeProjectId]);

  // Persist active project via serialized durable IndexedDB CAS + non-authoritative localStorage cache
  useEffect(() => {
    const canPersist = shouldAllowUnsolicitedPersistence({
      hydrationGate,
      hasLocalEditsSinceMount: hasLocalEditsSinceMountRef.current,
      isDeleted: getDeletedProjectIds().has(activeProject.id),
      storageAlertType: storageAlert?.type,
      storageAlertProjectId: storageAlert?.projectId,
      activeProjectId: activeProject.id,
    });
    if (!canPersist) {
      return;
    }

    if (activeProject.persistedRevision === activeProject.revision && !hasLocalEditsSinceMountRef.current) return;
    if (activeProject.narrative && activeProject.persistedRevision === activeProject.revision) return;
    const timer = setTimeout(() => {
      autosaveTimerRef.current = null;
      if (draftDirtyRef.current || restorePendingRef.current) return;
      const targetProject = activeProject;
      if (
        !shouldAllowUnsolicitedPersistence({
          hydrationGate: hydrationGateRef.current,
          hasLocalEditsSinceMount: hasLocalEditsSinceMountRef.current,
          isDeleted: getDeletedProjectIds().has(targetProject.id),
          storageAlertType: storageAlert?.type,
          storageAlertProjectId: storageAlert?.projectId,
          activeProjectId: targetProject.id,
        })
      ) {
        return;
      }

      void flushProjectDurably(targetProject, {
        expectedPersistedRevision: targetProject.persistedRevision,
      });
    }, 250);

    autosaveTimerRef.current = timer;
    return () => {
      clearTimeout(timer);
      if (autosaveTimerRef.current === timer) {
        autosaveTimerRef.current = null;
      }
    };
  }, [activeProject, hydrationGate, storageAlert, flushProjectDurably]);

  // Flush dirty active edits immediately if tab hides or page unloads before 250ms debounce settles
  useEffect(() => {
    const flushOnBackground = () => {
      if (draftDirtyRef.current || restorePendingRef.current) return;
      const current = activeProjectRef.current;
      if (
        !shouldAllowUnsolicitedPersistence({
          hydrationGate: hydrationGateRef.current,
          hasLocalEditsSinceMount: hasLocalEditsSinceMountRef.current,
          isDeleted: getDeletedProjectIds().has(current.id),
          storageAlertType: storageAlert?.type,
          storageAlertProjectId: storageAlert?.projectId,
          activeProjectId: current.id,
        })
      ) {
        return;
      }
      const isDirty =
        current.persistedRevision === undefined ||
        (current.revision ?? 1) > current.persistedRevision;
      if (!isDirty) return;

      if (autosaveTimerRef.current) {
        clearTimeout(autosaveTimerRef.current);
        autosaveTimerRef.current = null;
      }
      if (!current.narrative) {
        saveProjectToLocalStorage(current, { expectedPersistedRevision: current.persistedRevision, selectProject: false });
      }
      void flushProjectDurably(current, {
        expectedPersistedRevision: current.persistedRevision,
      });
    };

    const handleVisibilityChange = () => {
      if (document.visibilityState === 'hidden') {
        flushOnBackground();
      }
    };

    window.addEventListener('pagehide', flushOnBackground);
    document.addEventListener('visibilitychange', handleVisibilityChange);
    return () => {
      window.removeEventListener('pagehide', flushOnBackground);
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, [flushProjectDurably, storageAlert]);

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

  // Read-only AI capabilities probe on mount (never invokes an LLM/provider call)
  useEffect(() => {
    let cancelled = false;
    void fetchAiCapabilities()
      .then((cap) => {
        if (!cancelled) setAiConfigured(Boolean(cap.configured));
      })
      .catch(() => {
        if (!cancelled) setAiConfigured(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // Opt-in managed browser backup while app is open (off by default, never deletes existing backups)
  useEffect(() => {
    if (!autoBackupEnabled || hydrationGate !== 'ready') return;
    if (activeProject.persistedRevision !== activeProject.revision) return;
    const lastRev = lastAutoBackupRevisionRef.current[activeProject.id] ?? 0;
    if (activeProject.revision - lastRev < 5) return;
    lastAutoBackupRevisionRef.current[activeProject.id] = activeProject.revision;
    void saveBackup(activeProject, `Auto-backup at rev ${activeProject.revision}`).catch(() => {
      // Non-fatal; manual backups remain available.
    });
  }, [autoBackupEnabled, hydrationGate, activeProject]);

  // Optional bounded semantic auto-analysis (strictly OFF by default, debounced, capped per session)
  useEffect(() => {
    const prefs = activeProject.narrative?.automationPreferences;
    if (!aiConfigured || !prefs?.semanticAutoAnalysisEnabled || prefs.paused) return;
    if (!hasLocalEditsSinceMountRef.current) return;
    if (autoAnalysisCallsUsed >= (prefs.maxCallsPerSession ?? 4)) return;
    if (hydrationGate !== 'ready') return;

    const timer = window.setTimeout(() => {
      const current = activeProjectRef.current;
      const sections = manuscriptSections(current).slice(0, 4).map((s) => ({
        id: s.id,
        title: s.title || s.kind,
        kind: s.kind,
        text: s.text.slice(0, 3_000),
      }));
      const entities = current.snapshot.entities
        .filter((e) => e.category !== 'scene' && e.epistemicKind !== 'belief' && e.epistemicKind !== 'reported')
        .slice(0, 30)
        .map((e) => ({
          id: e.id ?? e.name,
          name: e.name,
          category: e.category,
          excluded: e.excluded,
          status: e.status,
          attributes: e.attributes.slice(0, 10).map((a) => ({
            id: a.id,
            name: a.name,
            value: a.confirmedValue ?? a.value[0]?.name ?? '',
            status: a.status,
          })),
        }));
      const relationships = current.snapshot.relationships.slice(0, 40).map((r) => ({
        id: r.id,
        sourceId: r.sourceId,
        targetId: r.targetId,
        source: r.source,
        target: r.target,
        label: r.label,
        status: r.status,
      }));
      const storyBible: Record<string, string> = {};
      for (const [k, f] of Object.entries(current.snapshot.storyBible)) {
        if (f.value.trim()) storyBible[k] = f.value.trim().slice(0, 400);
      }

      setAutoAnalysisCallsUsed((c) => c + 1);
      void requestSemanticDiagnostics({
        projectId: current.id,
        baseRevision: current.revision,
        scope: prefs.scope,
        entities,
        relationships,
        storyBible,
        sections,
      })
        .then((res) => {
          if (activeProjectRef.current.id !== current.id) return;
          const mapped = convertSemanticFindingsToDiagnosticFindings(res.findings);
          const merged = syncDiagnosticFindingsIntoProject(activeProjectRef.current, mapped, {
            source: 'semantic-ai',
            scopeLabel: `Auto (${prefs.scope})`,
            fullScan: false,
          });
          activeProjectRef.current = merged;
          setProject(merged);
        })
        .catch(() => {
          // Non-fatal background check; manual diagnostics stay available.
        });
    }, 3500);

    return () => window.clearTimeout(timer);
  }, [aiConfigured, activeProject.revision, activeProject.narrative?.automationPreferences, autoAnalysisCallsUsed, hydrationGate]);

  useEffect(() => {
    if (isDarkMode) {
      document.documentElement.classList.add('dark');
      document.body.style.backgroundColor = '#0d1117';
    } else {
      document.documentElement.classList.remove('dark');
      document.body.style.backgroundColor = '#f3f4f6';
    }
  }, [isDarkMode]);

  useEffect(() => {
    const warn = (event: BeforeUnloadEvent) => {
      const current = activeProjectRef.current;
      if (draftDirtyRef.current || restorePendingRef.current ||
        (current.narrative && current.persistedRevision !== current.revision)) {
        event.preventDefault();
        event.returnValue = '';
      }
    };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, []);

  const saveManuscript = async (base: NarrativeBase, sections: ManuscriptSection[], artifact?: ArtifactAnchor, styleProfile?: StyleProfile) => {
    if (hydrationGateRef.current !== 'ready' || !window.indexedDB) {
      throw new Error('IndexedDB must be available and the workspace must finish loading.');
    }
    const before = activeProjectRef.current;
    if (aiTicketAuthorityRef.current?.hasProjectTickets(before.id)) {
      throw new Error('Wait for the current project operation to finish before saving.');
    }
    const prepared = prepareManuscriptChange(before, undoStateRef.current, base, sections, artifact, styleProfile);
    if (!prepared) return;
    if (storageAlert?.type === 'conflict' && storageAlert.projectId === before.id) {
      throw new Error('The project has a storage conflict. Copy the open text before reloading.');
    }

    if (!before.narrative) {
      if (before.persistedRevision !== before.revision || before.persistedRevision === undefined) {
        const written = await flushProjectDurably(before, { expectedPersistedRevision: before.persistedRevision });
        if (!written.saved || written.authoritativeStore !== 'indexeddb') {
          throw new Error(written.error ?? 'The prior project could not be saved before the manuscript upgrade.');
        }
      }
      const backups = await listBackups(before.id);
      if (!backups.some(backup => backup.pinned && backup.payload === JSON.stringify(before, null, 2))) {
        await saveBackup(before, 'Before first manuscript save', true);
      }
    }
    const current = activeProjectRef.current;
    if (current.id !== before.id || current.revision !== before.revision) {
      throw new Error('The project changed while preparing the manuscript. The draft is still open.');
    }
    const result = await flushProjectDurably(prepared.project, { expectedPersistedRevision: before.revision, requireExactBase: true, clearConflictOnSuccess: true });
    if (!result.saved) throw new Error(result.error ?? 'The manuscript could not be saved.');
    const committed = { ...prepared.project, persistedRevision: result.persistedRevision ?? prepared.project.revision };
    activeProjectRef.current = committed;
    undoStateRef.current = prepared.undoState;
    hasLocalEditsSinceMountRef.current = true;
    setProject(committed);
    setUndoState(prepared.undoState);
  };

  const handleCreateImportedProject = async (candidate: CreativeProject) => {
    if (creatingImportedProjectRef.current) throw new Error('Project creation is already in progress.');
    creatingImportedProjectRef.current = true;
    try {
      if (hydrationGateRef.current !== 'ready' || !hydrationSettledRef.current || !window.indexedDB) {
        throw new Error('The project workspace must finish loading and IndexedDB must be available before import can be saved.');
      }
      if (!allowNavigation()) throw new Error('Save or export the open manuscript draft before creating an imported project.');
      if (savedProjectsRef.current.some(project => project.id === candidate.id) || activeProjectRef.current.id === candidate.id) {
        throw new Error('This imported project identifier already exists. Reopen the review and retry creation.');
      }

      if (autosaveTimerRef.current) {
        clearTimeout(autosaveTimerRef.current);
        autosaveTimerRef.current = null;
      }
      const previous = activeProjectRef.current;
      if (previous.persistedRevision !== previous.revision || previous.persistedRevision === undefined) {
        const previousSave = await flushProjectDurably(previous, {
          expectedPersistedRevision: previous.persistedRevision ?? previous.revision,
        });
        if (!previousSave.saved) {
          throw new Error(previousSave.error ?? 'The current project could not be saved before import. Existing projects were not changed.');
        }
      }
      if (activeProjectRef.current.id !== previous.id || activeProjectRef.current.revision !== previous.revision) {
        throw new Error('The current project changed while preparing the import. The reviewed project remains available.');
      }

      // A new imported ID must be absent; expected revision 0 makes any colliding existing record a CAS conflict.
      const result = await flushProjectDurably(candidate, { expectedPersistedRevision: 0 });
      if (!result.saved || result.authoritativeStore !== 'indexeddb') {
        throw new Error(result.error ?? 'The imported project could not be durably saved. Existing projects were not changed.');
      }
      const committed = { ...candidate, persistedRevision: result.persistedRevision ?? candidate.revision };
      const nextUndo = createUndoRedoState(committed.snapshot, committed.revisions, committed.undoHistory);
      const nextSaved = upsertProjectInSavedList(savedProjectsRef.current, committed);
      savedProjectsRef.current = nextSaved;
      activeProjectRef.current = committed;
      undoStateRef.current = nextUndo;
      hasLocalEditsSinceMountRef.current = true;
      saveQueueRef.current.resetProject(committed.id);
      setSavedProjects(nextSaved);
      setProject(committed);
      setUndoState(nextUndo);
      setStorageAlert(null);
      setCachedProjectSelection(committed.id);
      setWorkspaceMode('write');
      setStatusNotification(`Imported project "${committed.name}" saved.`);
    } finally {
      creatingImportedProjectRef.current = false;
    }
  };

  const handleIssueDisposition = (
    issueId: string,
    disposition: NonNullable<CreativeProject['narrative']>['issues'][number]['disposition'],
    reason: string,
  ) => {
    const before = activeProjectRef.current;
    const now = Date.now();
    const records = transitionIssue(before, issueId, disposition, reason, now, before.revision + 1);
    if (records === before.narrative) return;
    const revised = recordProjectRevision(
      { ...before, narrative: records },
      `Issue ${disposition}`,
      reason.trim(),
      1,
    );
    const next: CreativeProject = {
      ...revised,
      narrative: {
        ...records,
        audit: [...records.audit, {
          id: crypto.randomUUID(), action: 'issue', time: now,
          baseRevision: before.revision, resultRevision: revised.revision,
          reason: reason.trim(), issueId, issueDisposition: disposition,
        }],
      },
    };
    activeProjectRef.current = next;
    hasLocalEditsSinceMountRef.current = true;
    setProject(next);
    setStatusNotification(`Issue marked ${disposition}.`);
  };

  const handleCreateOpportunity = (input: OpportunityProposalInput, expectedRevision: number) => {
    try {
      if (hydrationGateRef.current !== 'ready') throw new Error('Wait for project storage to finish loading before saving an opportunity.');
      if (storageAlert?.type === 'conflict' && storageAlert.projectId === activeProjectRef.current.id) {
        throw new Error('Resolve the project storage conflict before saving an opportunity.');
      }
      const before = activeProjectRef.current;
      const next = createOpportunityProposal(before, expectedRevision, input);
      activeProjectRef.current = next;
      hasLocalEditsSinceMountRef.current = true;
      setProject(next);
      setStatusNotification('Creative opportunity saved as a pending idea.');
    } catch (cause) {
      setStatusNotification(cause instanceof Error ? cause.message : 'Could not save this opportunity.');
    }
  };

  const handleTransitionOpportunity = (id: string, status: OpportunityProposalStatus, expectedRevision: number) => {
    try {
      if (hydrationGateRef.current !== 'ready') throw new Error('Wait for project storage to finish loading before updating an opportunity.');
      if (storageAlert?.type === 'conflict' && storageAlert.projectId === activeProjectRef.current.id) {
        throw new Error('Resolve the project storage conflict before updating an opportunity.');
      }
      const before = activeProjectRef.current;
      const next = transitionOpportunityProposal(before, id, status, expectedRevision);
      activeProjectRef.current = next;
      hasLocalEditsSinceMountRef.current = true;
      setProject(next);
      setStatusNotification(status === 'accepted'
        ? 'Opportunity accepted as an idea; no story content was changed.'
        : `Opportunity marked ${status}.`);
    } catch (cause) {
      setStatusNotification(cause instanceof Error ? cause.message : 'Could not update this opportunity.');
    }
  };

  // --- Package C, D, E, F, G, H Narrative Workspace Handlers ---

  const handleRunLocalDiagnostics = () => {
    const before = activeProjectRef.current;
    const localFindings = collectLocalDiagnosticFindings(before);
    const next = syncDiagnosticFindingsIntoProject(before, localFindings, {
      source: 'local',
      scopeLabel: 'Full local check',
      fullScan: true,
    });
    activeProjectRef.current = next;
    hasLocalEditsSinceMountRef.current = true;
    setProject(next);
    setStatusNotification(`Synced ${localFindings.length} local diagnostic finding(s) into tracked issues.`);
  };

  const handleMergeSemanticFindings = (findings: readonly SemanticDiagnosticFinding[], scopeLabel: string) => {
    const before = activeProjectRef.current;
    const mapped = convertSemanticFindingsToDiagnosticFindings(findings);
    const next = syncDiagnosticFindingsIntoProject(before, mapped, {
      source: 'semantic-ai',
      scopeLabel,
      fullScan: false,
    });
    activeProjectRef.current = next;
    hasLocalEditsSinceMountRef.current = true;
    setProject(next);
  };

  const handleApplyDiagnosticFix = async (
    issueId: string,
    alternative: DiagnosticFixAlternative,
    expectedBaseRevision: number
  ): Promise<{ ok: boolean; message: string }> => {
    try {
      const before = activeProjectRef.current;
      const result = applyDiagnosticFixAlternative(before, undoStateRef.current, issueId, alternative, expectedBaseRevision);
      const saved = await flushProjectDurably(result.project, {
        expectedPersistedRevision: before.revision,
        requireExactBase: true,
        intentId: `fix_${before.id}_${issueId}_${alternative.id}_r${expectedBaseRevision}`,
        clearConflictOnSuccess: true,
      });
      if (!saved.saved) {
        return { ok: false, message: saved.error ?? 'Could not durably save the applied fix.' };
      }
      const committed = saved.idempotentHit && saved.storedProject
        ? saved.storedProject
        : { ...result.project, persistedRevision: saved.persistedRevision ?? result.project.revision };
      const committedUndo = saved.idempotentHit
        ? createUndoRedoState(committed.snapshot, committed.revisions, committed.undoHistory)
        : result.undoState;
      activeProjectRef.current = committed;
      undoStateRef.current = committedUndo;
      hasLocalEditsSinceMountRef.current = true;
      setProject(committed);
      setUndoState(committedUndo);
      const note = result.issueResolved
        ? `${result.appliedSummary} Issue resolved after post-apply recheck.`
        : `${result.appliedSummary} Post-apply recheck kept residual issue open (${result.residualOpenCount} open).`;
      setStatusNotification(note);
      return { ok: true, message: note };
    } catch (cause) {
      return { ok: false, message: cause instanceof Error ? cause.message : 'Fix could not be applied.' };
    }
  };

  const handleApplyModelSyncProposal = async (
    proposal: SyncModelProposal,
    expectedBaseRevision: number
  ): Promise<{ ok: boolean; message: string }> => {
    try {
      const before = activeProjectRef.current;
      const applied = applyModelSyncProposal(before, undoStateRef.current, proposal, expectedBaseRevision);
      const saved = await flushProjectDurably(applied.project, {
        expectedPersistedRevision: before.revision,
        requireExactBase: true,
        intentId: `sync_model_${before.id}_${proposal.id}_r${expectedBaseRevision}`,
        clearConflictOnSuccess: true,
      });
      if (!saved.saved) return { ok: false, message: saved.error ?? 'Could not save sync model update.' };
      const committed = saved.idempotentHit && saved.storedProject
        ? saved.storedProject
        : { ...applied.project, persistedRevision: saved.persistedRevision ?? applied.project.revision };
      const committedUndo = saved.idempotentHit
        ? createUndoRedoState(committed.snapshot, committed.revisions, committed.undoHistory)
        : applied.undoState;
      activeProjectRef.current = committed;
      undoStateRef.current = committedUndo;
      hasLocalEditsSinceMountRef.current = true;
      setProject(committed);
      setUndoState(committedUndo);
      setStatusNotification(applied.summary);
      return { ok: true, message: applied.summary };
    } catch (cause) {
      return { ok: false, message: cause instanceof Error ? cause.message : 'Sync model update failed.' };
    }
  };

  const handleApplyManuscriptSyncPatch = async (
    patch: SyncManuscriptPatch,
    expectedBaseRevision: number,
    expectedManuscriptVersionId?: string
  ): Promise<{ ok: boolean; message: string }> => {
    try {
      const before = activeProjectRef.current;
      const applied = applyManuscriptSyncPatch(
        before,
        undoStateRef.current,
        patch,
        expectedBaseRevision,
        expectedManuscriptVersionId
      );
      const saved = await flushProjectDurably(applied.project, {
        expectedPersistedRevision: before.revision,
        expectedManuscriptVersionId,
        requireExactBase: true,
        intentId: `sync_ms_${before.id}_${patch.id}_r${expectedBaseRevision}`,
        clearConflictOnSuccess: true,
      });
      if (!saved.saved) return { ok: false, message: saved.error ?? 'Could not save manuscript sync patch.' };
      const committed = saved.idempotentHit && saved.storedProject
        ? saved.storedProject
        : { ...applied.project, persistedRevision: saved.persistedRevision ?? applied.project.revision };
      const committedUndo = saved.idempotentHit
        ? createUndoRedoState(committed.snapshot, committed.revisions, committed.undoHistory)
        : applied.undoState;
      activeProjectRef.current = committed;
      undoStateRef.current = committedUndo;
      hasLocalEditsSinceMountRef.current = true;
      setProject(committed);
      setUndoState(committedUndo);
      setStatusNotification(applied.summary);
      return { ok: true, message: applied.summary };
    } catch (cause) {
      return { ok: false, message: cause instanceof Error ? cause.message : 'Manuscript sync patch failed.' };
    }
  };

  const handleRecordSyncCheckpoint = (direction: 'manuscript-to-model' | 'model-to-manuscript', coverageNote: string) => {
    const next = recordSyncReviewCheckpoint(activeProjectRef.current, direction, coverageNote);
    activeProjectRef.current = next;
    hasLocalEditsSinceMountRef.current = true;
    setProject(next);
  };

  const handleSaveWritingAlternative = (alt: {
    sectionId: string;
    action: WritingAssistAction;
    label: string;
    text: string;
    rationale: string;
    assumptions: string[];
  }) => {
    const ensured = ensureNarrativeEnvelope(activeProjectRef.current);
    const now = Date.now();
    const next: CreativeProject = {
      ...ensured,
      narrative: {
        ...ensured.narrative!,
        writingAlternatives: [
          ...(ensured.narrative!.writingAlternatives ?? []),
          {
            id: makeStableId('walt'),
            sectionId: alt.sectionId,
            action: alt.action,
            label: alt.label,
            text: alt.text,
            rationale: alt.rationale,
            assumptions: alt.assumptions,
            createdAt: now,
            baseRevision: ensured.revision,
          },
        ].slice(-30),
      },
    };
    activeProjectRef.current = next;
    hasLocalEditsSinceMountRef.current = true;
    setProject(next);
    setStatusNotification(`Saved "${alt.label}" as a non-mutating alternative.`);
  };

  const handleSendOpportunityToReview = (proposal: OpportunityProposal) => {
    setWorkspaceMode('plan');
    setIsReviewModalOpen(true);
    setStatusNotification(`Opened Change Review for idea: "${proposal.description.slice(0, 70)}". Apply changes explicitly via Decision Inbox or Batch Edit.`);
  };

  const handleUpdateAutomationPreferences = (prefs: NonNullable<NarrativeRecords['automationPreferences']>) => {
    const ensured = ensureNarrativeEnvelope(activeProjectRef.current);
    const next: CreativeProject = {
      ...ensured,
      narrative: {
        ...ensured.narrative!,
        automationPreferences: prefs,
      },
    };
    activeProjectRef.current = next;
    hasLocalEditsSinceMountRef.current = true;
    setProject(next);
    setStatusNotification(prefs.semanticAutoAnalysisEnabled ? 'Bounded semantic auto-analysis preference updated.' : 'Semantic auto-analysis disabled.');
  };

  const handleToggleAutoBackup = (enabled: boolean) => {
    setAutoBackupEnabled(enabled);
    try {
      window.localStorage?.setItem(AUTO_BACKUP_PREF_KEY, enabled ? 'true' : 'false');
    } catch {
      // Ignore storage quota for preference
    }
    setStatusNotification(enabled ? 'Opt-in browser auto-backup enabled while app is open.' : 'Opt-in browser auto-backup disabled.');
  };

  const handleAppendToExistingProject = async (params: {
    targetProjectId: string;
    incomingProject: CreativeProject;
    insertPosition: AppendInsertPosition;
    identityDecisions: Record<string, CrossProjectIdentityDecision>;
    allowDuplicateSource: boolean;
  }) => {
    if (hydrationGateRef.current !== 'ready' || !window.indexedDB) {
      throw new Error('IndexedDB must be available and workspace loading must finish before appending.');
    }
    const target =
      activeProjectRef.current.id === params.targetProjectId
        ? activeProjectRef.current
        : savedProjectsRef.current.find((p) => p.id === params.targetProjectId);
    if (!target) throw new Error('Selected target project no longer exists.');

    // Save a verified pinned safety checkpoint before mutating the target project
    await saveBackup(target, `Safety checkpoint before appending "${params.incomingProject.name}"`, true);

    const baseDigest = computeSnapshotDigest(target.snapshot);
    const applied = applyAppendToExistingProject({
      targetProject: target,
      incomingProject: params.incomingProject,
      insertPosition: params.insertPosition,
      identityDecisions: params.identityDecisions,
      expectedBaseRevision: target.revision,
      expectedManuscriptVersionId: target.snapshot.manuscriptVersionId ?? '',
      expectedBaseSnapshotDigest: baseDigest,
      allowDuplicateSource: params.allowDuplicateSource,
    });

    const saved = await flushProjectDurably(applied.candidateProject, {
      expectedPersistedRevision: target.revision,
      expectedManuscriptVersionId: target.snapshot.manuscriptVersionId ?? '',
      expectedBaseSnapshotDigest: baseDigest,
      requireExactBase: true,
      intentId: applied.intentId,
      clearConflictOnSuccess: true,
    });
    if (!saved.saved || saved.authoritativeStore !== 'indexeddb') {
      throw new Error(saved.error ?? 'Appended project could not be saved durably.');
    }
    const committed = saved.idempotentHit && saved.storedProject
      ? saved.storedProject
      : { ...applied.candidateProject, persistedRevision: saved.persistedRevision ?? applied.candidateProject.revision };
    const nextUndo = createUndoRedoState(committed.snapshot, committed.revisions, committed.undoHistory);
    const nextSaved = upsertProjectInSavedList(savedProjectsRef.current, committed);
    savedProjectsRef.current = nextSaved;
    activeProjectRef.current = committed;
    undoStateRef.current = nextUndo;
    hasLocalEditsSinceMountRef.current = true;
    setSavedProjects(nextSaved);
    setProject(committed);
    setUndoState(nextUndo);
    setCachedProjectSelection(committed.id);
    setWorkspaceMode('write');
    setStatusNotification(
      `Appended ${applied.addedSectionCount} section(s) into "${committed.name}" (${applied.addedEntityCount} new, ${applied.linkedEntityCount} linked entities).`
    );
  };

  const handleRestoreArchiveProjects = async (
    restoredProjects: CreativeProject[]
  ): Promise<ArchiveRestoreSequenceResult<CreativeProject>> => {
    let nextSaved = [...savedProjectsRef.current];
    const result = await restoreArchiveProjectsSequentially(restoredProjects, async (candidate) => {
      const res = await flushProjectDurably(candidate, { expectedPersistedRevision: 0 });
      if (!res.saved) throw new Error(res.error ?? `Could not restore "${candidate.name}".`);
      const committed = res.idempotentHit && res.storedProject
        ? res.storedProject
        : { ...candidate, persistedRevision: res.persistedRevision ?? candidate.revision };
      nextSaved = upsertProjectInSavedList(nextSaved, committed);
    });
    if (result.ok || result.count > 0) {
      savedProjectsRef.current = nextSaved;
      setSavedProjects(nextSaved);
    }
    if (result.ok) {
      setStatusNotification(`Restored ${result.count} verified project(s) from portable archive.`);
      return result;
    }
    return {
      ...result,
      error: result.count > 0
        ? `Partial archive restore: ${result.count} project(s) were durably restored. ${result.remainingProjects.length} remain and can be retried. ${result.error}`
        : result.error,
    };
  };

  // Keyboard shortcuts for Undo / Redo (F-04 / IA-08)
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (draftDirtyRef.current || restorePendingRef.current) return;
      const target = e.target as HTMLElement | null;
      if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable)) {
        return;
      }
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'z') {
        e.preventDefault();
        if (e.shiftKey) {
          const res = commitRedoTransaction(activeProjectRef.current, undoStateRef.current);
          if (res.redoneLabel) {
            hasLocalEditsSinceMountRef.current = true;
            setProject(res.project);
            setUndoState(res.undoState);
            setStatusNotification(`Redid: ${res.redoneLabel}`);
          }
        } else {
          const res = commitUndoTransaction(activeProjectRef.current, undoStateRef.current);
          if (res.undoneLabel) {
            hasLocalEditsSinceMountRef.current = true;
            setProject(res.project);
            setUndoState(res.undoState);
            setStatusNotification(`Undid: ${res.undoneLabel}`);
          }
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
      hasLocalEditsSinceMountRef.current = true;
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
    const validation = validateStoryBibleUpdate(field, value);
    if (!validation.ok) {
      setStoryBibleErrors((prev) => ({
        ...prev,
        [field]: validation.error ?? 'Invalid Story Bible value.',
      }));
      return;
    }

    setStoryBibleErrors((prev) => {
      if (!prev[field]) return prev;
      const nextErrs = { ...prev };
      delete nextErrs[field];
      return nextErrs;
    });

    const next = updateStoryBibleField(snapshot, field, validation.normalized, 'user-edit');
    const isClear = validation.intent === 'clear';
    commitTransaction(
      next,
      isClear ? `Clear Story Bible: ${field}` : `Update Story Bible: ${field}`,
      isClear ? `Cleared Story Bible ${field}.` : `Set Story Bible ${field} to "${validation.normalized.trim()}".`,
      1,
      {
        coalesceKey: isClear ? `story-bible-clear:${field}` : `story-bible:${field}`,
        coalesceWindowMs: isClear ? 400 : 2500,
      }
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
      const targetField = decision.targetStoryField;
      setRightPanelTab('story-bible');
      setMobileTab('inspector');
      setFocusedStoryBibleField((prev) => ({
        field: targetField,
        seq: (prev?.seq ?? 0) + 1,
      }));
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

  const handleNavigateConsistencyTarget = (target: ConsistencyIssueTarget) => {
    if (target.kind === 'section' && target.sectionId) {
      if (!allowNavigation()) return;
      setFocusedSectionId(target.sectionId);
      setWorkspaceMode('write');
      return;
    }
    const resolved = resolveConsistencyIssueTarget(snapshot, target);
    if (!resolved.ok) {
      setStatusNotification(resolved.reason);
      return;
    }
    if (resolved.kind === 'story_bible') {
      setWorkspaceMode('plan');
      setRightPanelTab('story-bible');
      setMobileTab('inspector');
      setFocusedStoryBibleField((prev) => ({
        field: resolved.storyField,
        seq: (prev?.seq ?? 0) + 1,
      }));
      return;
    }
    if (resolved.kind === 'relationship') {
      setWorkspaceMode('plan');
      setSelectedEntityId(null);
      setSelectedRelationshipId(resolved.relationship.id ?? null);
      setRightPanelTab('inspector');
      setMobileTab('inspector');
      return;
    }
    if (resolved.kind === 'entity') {
      setWorkspaceMode('plan');
      setSelectedRelationshipId(null);
      setSelectedEntityId(resolved.entity.id ?? resolved.entity.name);
      setRightPanelTab('inspector');
      setMobileTab('inspector');
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

    const promptDecision = resolveProviderPrompt(targetProject, targetProject.snapshot.mode);
    if (!promptDecision.ok) {
      setStatusNotification(promptDecision.reason);
      return {
        instruction,
        operations: [],
        ambiguities: [],
        warnings: [promptDecision.reason],
        coverageComplete: false,
        baseProjectId: targetProject.id,
        baseRevision: targetProject.revision,
      };
    }
    if (promptDecision.warning) setStatusNotification(promptDecision.warning);

    const authority = aiTicketAuthorityRef.current!;
    const { ticket, signal } = authority.beginSlot(targetProject, 'batch');
    try {
      const aiResult = await requestBatchEditInterpretation(
        instruction,
        {
          prompt: promptDecision.prompt,
          entities: promptDecision.contextSnapshot.entities.map((e) => ({
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
          relationships: promptDecision.contextSnapshot.relationships.map((r) => ({
            id: r.id,
            source: r.source,
            target: r.target,
            label: r.label,
          })),
        },
        signal
      );
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
      authority.clearIfCurrent(ticket);
    }
  };

  const handleApplyBatchOperations = (
    preview: BatchEditProposalResult
  ): BatchCommitResult => {
    const res = commitBatchPreviewToProject({
      project: activeProjectRef.current,
      undoState: undoStateRef.current,
      preview,
      appliedProposalIds: appliedBatchProposalIdsRef.current,
    });
    if (!res.result.ok) {
      setStatusNotification(res.result.message);
      return res.result;
    }
    hasLocalEditsSinceMountRef.current = true;
    setProject(res.project);
    setUndoState(res.undoState);
    setStatusNotification(`Applied ${res.result.appliedCount} batch operation(s). Undo available.`);
    return res.result;
  };

  // --- AI Analysis, Clarifications & Generation with Authoritative Scoped Tickets (R0-B) ---

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
      authority: aiTicketAuthorityRef.current!,
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
  }, []);

  const handleRefreshClarifications = useCallback(
    async (preserveDrafts?: Record<string, string>) => {
      const originProject = activeProjectRef.current;
      const originSnap = originProject.snapshot;
      const promptDecision = resolveProviderPrompt(originProject, originSnap.mode);
      if (!promptDecision.ok) {
        setClarificationErrors((prev) => ({ ...prev, [originProject.id]: promptDecision.reason }));
        setStatusNotification(promptDecision.reason);
        return;
      }
      if (promptDecision.warning) setStatusNotification(promptDecision.warning);
      const promptToUse = promptDecision.prompt.trim();

      const lengthCheck = validateEffectivePromptLength(promptToUse, MAX_PROMPT_CHARS);
      if (!lengthCheck.ok) {
        const msg = lengthCheck.error ?? 'Compiled prompt exceeds character limit.';
        setClarificationErrors((prev) => ({ ...prev, [originProject.id]: msg }));
        setStatusNotification(msg);
        return;
      }

      const confirmedFacts = promptDecision.contextSnapshot.entities
        .filter((e) => !e.excluded)
        .flatMap((e) =>
          e.attributes
            .filter((a) => a.status === 'confirmed' && a.confirmedValue)
            .map((a) => `${e.name} ${a.name}: ${a.confirmedValue}`)
        );

      await runAsyncClarifySlot({
        authority: aiTicketAuthorityRef.current!,
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
        fetchClarifications: (signal) =>
          generateClarifications(
            promptToUse,
            [...originSnap.answeredQuestions, ...originSnap.skippedQuestions],
            originSnap.mode,
            signal,
            confirmedFacts
          ),
        preserveDraftAnswers: preserveDrafts,
        onStart: () => {
          setClarificationErrors((prev) => ({ ...prev, [originProject.id]: null }));
        },
        onError: (projectId, err) => {
          setClarificationErrors((prev) => ({
            ...prev,
            [projectId]: getReadableErrorMessage(
              err,
              'Failed to request additional clarifications.'
            ),
          }));
        },
        label: 'Request Additional Clarifications',
        summary: 'Added non-duplicate AI clarification questions.',
      });
    },
    []
  );

  const handleGenerateOutput = useCallback(async () => {
    const originProject = activeProjectRef.current;
    const originSnap = originProject.snapshot;
    const promptDecision = resolveProviderPrompt(originProject, originSnap.mode);
    if (!promptDecision.ok) {
      setShowOutputDrawer(true);
      setGalleryErrors((prev) => ({ ...prev, [originProject.id]: {
        ...(prev[originProject.id] ?? { story: null, image: null }), [originSnap.mode]: promptDecision.reason,
      } }));
      setStatusNotification(promptDecision.reason);
      return;
    }
    if (promptDecision.warning) setStatusNotification(promptDecision.warning);
    const promptToUse = promptDecision.prompt.trim();
    if (!promptToUse) return;

    const requestMode = originSnap.mode;
    const lengthCheck = validateEffectivePromptLength(promptToUse, MAX_PROMPT_CHARS);
    if (!lengthCheck.ok) {
      const msg = lengthCheck.error ?? 'Compiled prompt exceeds character limit.';
      setShowOutputDrawer(true);
      setGalleryErrors((prev) => ({
        ...prev,
        [originProject.id]: {
          ...(prev[originProject.id] ?? { story: null, image: null }),
          [requestMode]: msg,
        },
      }));
      setStatusNotification(msg);
      return;
    }

    await runAsyncGenerationSlot({
      authority: aiTicketAuthorityRef.current!,
      originProject,
      mode: requestMode,
      promptUsed: promptToUse,
      getState: () => ({
        activeProject: activeProjectRef.current,
        savedProjects: savedProjectsRef.current,
      }),
      commitState: (applied) => {
        activeProjectRef.current = applied.activeProject;
        savedProjectsRef.current = applied.savedProjects;
        setProject(applied.activeProject);
        setSavedProjects(applied.savedProjects);
      },
      generate: async (signal) => {
        if (requestMode === 'story') {
          const generatedStory = await generateStoryFromPrompt(promptToUse, signal);
          return { storyText: generatedStory };
        }
        const result = await generateImagesFromPrompt(promptToUse, signal);
        return { images: result.images, warning: result.warning };
      },
      onStart: () => {
        setShowOutputDrawer(true);
        setGalleryErrors((prev) => ({
          ...prev,
          [originProject.id]: {
            ...(prev[originProject.id] ?? { story: null, image: null }),
            [requestMode]: null,
          },
        }));
      },
      onError: (projectId, mode, err) => {
        const message = getReadableErrorMessage(
          err,
          `Failed to generate ${mode}. Check your server API key configuration.`
        );
        setGalleryErrors((prev) => ({
          ...prev,
          [projectId]: {
            ...(prev[projectId] ?? { story: null, image: null }),
            [mode]: message,
          },
        }));
      },
    });
  }, []);

  const handlePolishPromptWithAi = async () => {
    const originProject = activeProjectRef.current;
    const authority = aiTicketAuthorityRef.current!;
    if (authority.isActionLoading(originProject.id, 'polish')) return;

    const promptDecision = resolveProviderPrompt(originProject, originProject.snapshot.mode);
    if (!promptDecision.ok) {
      setStatusNotification(promptDecision.reason);
      return;
    }
    if (promptDecision.warning) setStatusNotification(promptDecision.warning);
    const promptToPolish = promptDecision.prompt.trim();
    const lengthCheck = validateEffectivePromptLength(promptToPolish, MAX_PROMPT_CHARS);
    if (!lengthCheck.ok) {
      setStatusNotification(lengthCheck.error ?? 'Compiled prompt exceeds 8,000-character limit.');
      return;
    }

    const { ticket, signal } = authority.beginSlot(originProject, 'polish');
    try {
      const polished = await refinePromptWithAllUpdates(
        promptToPolish,
        [],
        [],
        signal
      );
      if (!authority.isCurrent(ticket)) return;
      const proposal = createPolishProposal(originProject, polished);
      if (proposal.isNoOp) {
        setPolishProposalsByProject((prev) => {
          const next = { ...prev };
          delete next[originProject.id];
          return next;
        });
        setStatusNotification(
          'Polished prompt is identical to your current refined prompt — no changes needed.'
        );
        return;
      }
      setPolishProposalsByProject((prev) => ({
        ...prev,
        [originProject.id]: proposal,
      }));
      setStatusNotification(
        'Staged AI narrative polish proposal. Review and accept or discard it in the Output panel.'
      );
    } catch (err) {
      if (!isAbortError(err) && authority.isCurrent(ticket)) {
        setStatusNotification(
          getReadableErrorMessage(err, 'Could not run AI prompt polish; structured prompt preserved.')
        );
      }
    } finally {
      authority.clearIfCurrent(ticket);
    }
  };

  const polishValidation = useMemo(
    () =>
      activePolishProposal
        ? validatePolishProposalAcceptance(activeProject, activePolishProposal)
        : null,
    [activeProject, activePolishProposal]
  );

  const handleAcceptPolishProposal = () => {
    if (!activePolishProposal) return;
    const res = acceptPolishProposal(activeProject, undoState, activePolishProposal);
    if (!res.ok) {
      setStatusNotification(
        res.reason ?? 'Stale AI Polish proposal cannot be applied because the story plan changed.'
      );
      return;
    }
    hasLocalEditsSinceMountRef.current = true;
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

  const handleReloadLatestFromStorage = (resolution?: 'prefer-idb' | 'prefer-local') => {
    if (!allowNavigation()) return;
    const currentActive = activeProjectRef.current;
    const originId = currentActive.id;
    const originUndo = undoStateRef.current;
    const isCurrent = () => activeProjectRef.current === currentActive && undoStateRef.current === originUndo;
    const observedConflict = storageAlert?.projectId === originId ? storageAlert.conflictingProject : undefined;

    void reloadLatestProjectsFromStorage(originId, {
      resolution,
      inMemoryActiveProject: currentActive,
      hasLocalEditsSinceMount: resolution === 'prefer-local' || hasLocalEditsSinceMountRef.current,
      observedConflictProject: resolution ? observedConflict : undefined,
      isCurrent,
      commit: (candidate, options) => saveQueueRef.current.enqueue(candidate, options),
    }).then(
      (latest) => {
        if (!isCurrent()) {
          setStorageAlert({
            type: 'conflict',
            projectId: activeProjectRef.current.id,
            message:
              'Newer in-memory edits were made while reloading from storage. Your in-memory edits were preserved.',
          });
          return;
        }

        const nextGate = resolveHydrationWriteGate(latest.idbStatus);
        updateHydrationGate(nextGate);
        if (nextGate !== 'blocked-read-error') markHydrationSettled();

        if (latest.idbStatus === 'read_error') {
          setStorageAlert({
            type: 'error',
            projectId: originId,
            message: `Could not reload from IndexedDB (${latest.idbError ?? 'read failure'}). Existing records were not overwritten.`,
          });
          return;
        }

        if (latest.conflictDetected) {
          const stored = latest.conflictProject;
          const idbBibleSummary = stored
            ? stored.snapshot.storyBible.genre.value || stored.snapshot.storyBible.setting.value || stored.snapshot.originalIdea.slice(0, 40)
            : '';
          const localBibleSummary =
            latest.activeProject.snapshot.storyBible.genre.value ||
            latest.activeProject.snapshot.storyBible.setting.value ||
            latest.activeProject.snapshot.originalIdea.slice(0, 40);
          setSavedProjects(latest.projects);
          setStorageAlert({
            type: 'conflict',
            projectId: latest.activeProject.id,
            conflictingProject: stored ?? undefined,
            message: latest.persistenceWarning ?? `Conflicting versions detected at revision #${stored?.revision}: IndexedDB has "${idbBibleSummary}" while localStorage/memory has "${localBibleSummary}". Both versions remain recoverable.`,
          });
          return;
        }

        saveQueueRef.current.resetProject(latest.activeProject.id);
        savedProjectsRef.current = latest.projects;
        setSavedProjects(latest.projects);
        setProject(latest.activeProject);
        setUndoState(latest.activeUndoState);
        setCachedProjectSelection(latest.activeProject.id);
        if (resolution === 'prefer-idb' || latest.upgradedFromIndexedDb) {
          hasLocalEditsSinceMountRef.current = false;
        }

        if (latest.persisted === false && latest.persistenceWarning) {
          setStorageAlert({
            type: 'error',
            projectId: latest.activeProject.id,
            message: `Reloaded revision #${latest.activeProject.revision} in memory, but storage synchronization reported: ${latest.persistenceWarning}`,
          });
        } else {
          setStorageAlert(null);
          setStatusNotification(
            `Reloaded revision #${latest.activeProject.revision} from storage.`
          );
        }
      }
    );
  };

  const handleForceOverwriteStorage = () => {
    if (!allowNavigation()) return;
    const current = activeProjectRef.current;
    const observed = storageAlert?.projectId === current.id ? storageAlert.conflictingProject : undefined;
    if (!observed) {
      handleReloadLatestFromStorage();
      return;
    }
    if (!observed.narrative) {
      handleReloadLatestFromStorage('prefer-local');
      return;
    }
    void saveBackup(observed, 'Before replacing conflicting stored version', true).then(() => {
      if (activeProjectRef.current === current) handleReloadLatestFromStorage('prefer-local');
    }, (error) => {
      setStatusNotification(getReadableErrorMessage(error, 'Could not create the safety backup.'));
    });
  };

  const handleUndo = () => {
    const res = commitUndoTransaction(activeProjectRef.current, undoStateRef.current);
    if (res.undoneLabel) {
      hasLocalEditsSinceMountRef.current = true;
      setProject(res.project);
      setUndoState(res.undoState);
      setStatusNotification(`Undid: ${res.undoneLabel}`);
    }
  };

  const handleRedo = () => {
    const res = commitRedoTransaction(activeProjectRef.current, undoStateRef.current);
    if (res.redoneLabel) {
      hasLocalEditsSinceMountRef.current = true;
      setProject(res.project);
      setUndoState(res.undoState);
      setStatusNotification(`Redid: ${res.redoneLabel}`);
    }
  };

  const handleRestoreRevision = (revisionId: string) => {
    if (!allowNavigation()) return;
    const res = restoreProjectRevision(activeProject, undoState, revisionId);
    if (!res) return;
    hasLocalEditsSinceMountRef.current = true;
    setProject(res.project);
    setUndoState(res.undoState);
    setStatusNotification('Restored project revision safely (previous state saved in history).');
  };

  const handleResetSampleProject = () => {
    if (!allowNavigation()) return;
    if (autosaveTimerRef.current) {
      clearTimeout(autosaveTimerRef.current);
      autosaveTimerRef.current = null;
    }
    const outgoing = activeProjectRef.current;
    const sample = createSampleProject();
    const switchRes = prepareProjectSwitch({
      currentProject: outgoing,
      savedProjects: savedProjectsRef.current,
      targetProjectId: sample.id,
    });
    if (switchRes.projectToFlush) {
      void flushProjectDurably(switchRes.projectToFlush, {
        expectedPersistedRevision: switchRes.projectToFlush.persistedRevision,
      });
    }

    const sampleUndo = createUndoRedoState(sample.snapshot, sample.revisions, sample.undoHistory);
    const nextSaved = upsertProjectInSavedList(switchRes.savedProjects, sample);
    savedProjectsRef.current = nextSaved;
    activeProjectRef.current = sample;
    undoStateRef.current = sampleUndo;
    saveQueueRef.current.resetProject(sample.id);
    hasLocalEditsSinceMountRef.current = true;
    setSavedProjects(nextSaved);
    setProject(sample);
    setUndoState(sampleUndo);
    setSelectedEntityId(null);
    setSelectedRelationshipId(null);
    setStoryBibleErrors({});
    setStorageAlert(null);
    setCachedProjectSelection(sample.id);
    void flushProjectDurably(sample, {
      forceOverwrite: true,
      allowDeleted: true,
      successNotification: 'Loaded sample story plan: "Cat’s Woodland Dinner Party".',
    });
  };

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

    if (autosaveTimerRef.current) {
      clearTimeout(autosaveTimerRef.current);
      autosaveTimerRef.current = null;
    }

    const nextTarget = switchRes.targetProject;
    const nextUndo = createUndoRedoState(
      nextTarget.snapshot,
      nextTarget.revisions,
      nextTarget.undoHistory
    );
    savedProjectsRef.current = switchRes.savedProjects;
    activeProjectRef.current = nextTarget;
    undoStateRef.current = nextUndo;

    setSavedProjects(switchRes.savedProjects);
    setProject(nextTarget);
    setUndoState(nextUndo);
    setSelectedEntityId(null);
    setSelectedRelationshipId(null);
    setStoryBibleErrors({});
    if (hydrationGateRef.current !== 'blocked-read-error') {
      setStorageAlert(null);
    }

    setCachedProjectSelection(nextTarget.id);

    if (switchRes.projectToFlush && hydrationGateRef.current !== 'blocked-read-error') {
      void flushProjectDurably(switchRes.projectToFlush, {
        expectedPersistedRevision: switchRes.projectToFlush.persistedRevision,
      });
    }
  };

  const handleCreateNewProject = (name: string, initialPrompt: string) => {
    if (!allowNavigation()) return;
    if (autosaveTimerRef.current) {
      clearTimeout(autosaveTimerRef.current);
      autosaveTimerRef.current = null;
    }

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
      persistedRevision: undefined,
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

    const switchRes = prepareProjectSwitch({
      currentProject: activeProjectRef.current,
      savedProjects: savedProjectsRef.current,
      targetProjectId: newProj.id,
    });
    if (switchRes.projectToFlush) {
      void flushProjectDurably(switchRes.projectToFlush, {
        expectedPersistedRevision: switchRes.projectToFlush.persistedRevision,
      });
    }

    const newUndo = createUndoRedoState(newSnap, newProj.revisions, newProj.undoHistory);
    const nextSaved = upsertProjectInSavedList(switchRes.savedProjects, newProj);
    savedProjectsRef.current = nextSaved;
    activeProjectRef.current = newProj;
    undoStateRef.current = newUndo;
    saveQueueRef.current.resetProject(newProj.id);

    hasLocalEditsSinceMountRef.current = true;
    setSavedProjects(nextSaved);
    setProject(newProj);
    setUndoState(newUndo);
    setSelectedEntityId(null);
    setSelectedRelationshipId(null);
    setStoryBibleErrors({});
    if (hydrationGateRef.current !== 'blocked-read-error') {
      setStorageAlert(null);
    }

    setCachedProjectSelection(newProj.id);
    void flushProjectDurably(newProj, {
      forceOverwrite: true,
      allowDeleted: true,
    });
  };

  const handleDeleteProject = (projectId: string) => {
    if (!allowNavigation()) return;
    if (autosaveTimerRef.current && activeProjectRef.current.id === projectId) {
      clearTimeout(autosaveTimerRef.current);
      autosaveTimerRef.current = null;
    }
    saveQueueRef.current.resetProject(projectId);

    // Abort and invalidate all in-flight operations for the deleted project via single authority (F-06 / IA-11 / R0-B)
    aiTicketAuthorityRef.current?.invalidateProject(projectId);

    void deleteProjectCompletely(projectId).then((delRes) => {
      savedProjectsRef.current = delRes.remaining;
      setSavedProjects(delRes.remaining);
      if (activeProjectRef.current.id === projectId && delRes.remaining.length > 0) {
        const replacement = delRes.remaining[0];
        const replacementUndo = createUndoRedoState(
          replacement.snapshot,
          replacement.revisions,
          replacement.undoHistory
        );
        activeProjectRef.current = replacement;
        undoStateRef.current = replacementUndo;
        setProject(replacement);
        setUndoState(replacementUndo);
        setSelectedEntityId(null);
        setSelectedRelationshipId(null);
      }
      if (delRes.incompleteDeletion || !delRes.idbDeleted || !delRes.tombstonePersisted) {
        const detail =
          delRes.error ??
          (!delRes.tombstonePersisted
            ? 'LocalStorage quota prevented saving the deletion marker.'
            : 'IndexedDB deletion did not complete cleanly.');
        const errMsg = `Incomplete deletion warning: project removed from active workspace while preserving other backups, but cleanup reported: ${detail}`;
        setStorageAlert({
          type: !delRes.tombstonePersisted ? 'quota' : 'error',
          projectId,
          message: errMsg,
        });
        setStatusNotification(errMsg);
      } else {
        setStatusNotification('Deleted project from localStorage and IndexedDB.');
      }
    });
  };

  const handleExportJson = () => {
    triggerProjectBackupDownload(activeProject, `r${activeProject.revision}-backup`);
  };

  const handleExportStoryBibleMarkdown = () => {
    triggerStoryBibleMarkdownDownload(activeProject);
  };

  const handleExportPromptText = () => {
    triggerRefinedPromptDownload(activeProject);
  };

  const handleImportProjectJson = async (rawJson: string, replace = false): Promise<{ ok: boolean; error?: string }> => {
    if (!allowNavigation()) return { ok: false, error: 'Save the current draft before restoring a backup.' };
    if (hydrationGateRef.current === 'blocked-read-error' || hydrationGateRef.current === 'pending') {
      return { ok: false, error: 'Wait for workspace storage to finish loading before restoring.' };
    }
    restorePendingRef.current = true;
    try {
      const legacyOrPortable = await parseProjectBackup(rawJson);
      const outgoing = activeProjectRef.current;
      if (aiTicketAuthorityRef.current?.hasProjectTickets(outgoing.id)) {
        throw new Error('Wait for the current project operation to finish before restoring.');
      }
      const migrated = replace ? prepareBackupReplacement(outgoing, legacyOrPortable) : prepareBackupCopy(legacyOrPortable);
      const transition = prepareProjectSwitch({
        currentProject: outgoing, savedProjects: savedProjectsRef.current, targetProjectId: migrated.id,
      });
      if (replace) {
        if (hydrationGateRef.current !== 'ready' || outgoing.persistedRevision !== outgoing.revision) {
          throw new Error('A durable current revision is required before replacement.');
        }
        await saveBackup(outgoing, 'Before replacing project from backup', true);
      } else if (transition.projectToFlush) {
        const flushed = await flushProjectDurably(transition.projectToFlush);
        if (!flushed.saved) throw new Error(flushed.error ?? 'Save the current project before restoring.');
      }
      if (activeProjectRef.current.id !== outgoing.id || activeProjectRef.current.revision !== outgoing.revision) {
        throw new Error('The current project changed while preparing the restore.');
      }
      const result = await flushProjectDurably(migrated, replace ? {
        expectedPersistedRevision: outgoing.revision, requireExactBase: true,
      } : undefined);
      if (!result.saved) throw new Error(result.error ?? 'The restored project could not be saved.');
      const saved = { ...migrated, persistedRevision: result.persistedRevision ?? migrated.revision };
      const migratedUndo = createUndoRedoState(saved.snapshot, saved.revisions, saved.undoHistory);
      const latestSaved = replace ? savedProjectsRef.current
        : upsertProjectInSavedList(savedProjectsRef.current, activeProjectRef.current);
      const nextSaved = upsertProjectInSavedList(latestSaved, saved);
      savedProjectsRef.current = nextSaved;
      activeProjectRef.current = saved;
      undoStateRef.current = migratedUndo;
      hasLocalEditsSinceMountRef.current = true;
      setSavedProjects(nextSaved);
      setProject(saved);
      setUndoState(migratedUndo);
      setSelectedEntityId(null);
      setSelectedRelationshipId(null);
      setStoryBibleErrors({});
      setCachedProjectSelection(saved.id);
      setStatusNotification(`Restored and saved project ${replace ? '' : 'copy '}“${saved.name}”.`);
      return { ok: true };
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : 'Invalid project JSON file.' };
    } finally {
      restorePendingRef.current = false;
    }
  };

  function openPlan(panel: RightPanelTab, target?: 'revision-history' | 'project-management' | 'export-content') {
    if (!allowNavigation()) return;
    setRightPanelTab(panel);
    setMobileTab('inspector');
    if (target) setHistoryTarget(previous => ({ id: target, sequence: (previous?.sequence ?? 0) + 1 }));
    setWorkspaceMode('plan');
  }

  function exportManuscript() {
    triggerManuscriptMarkdownDownload(activeProject);
  }

  function exportManuscriptText() {
    triggerManuscriptTextDownload(activeProject);
  }

  function exportManuscriptDocx() {
    triggerManuscriptDocxDownload(activeProject);
  }

  const contentExports = useMemo(() => buildContentExportEntries(activeProject), [activeProject]);

  function exportContent(id: string) {
    const entry = contentExports.find(item => item.id === id);
    if (!entry) return;
    try {
      const file = projectContentExport(activeProject, entry.selection);
      downloadTextFile(file.name, file.text, file.mediaType);
    } catch (cause) {
      setStatusNotification(cause instanceof Error ? cause.message : 'Selected content could not be exported.');
    }
  }

  async function exportContentBundle(ids: string[]) {
    try {
      const selections = ids.map(id => contentExports.find(item => item.id === id)).filter((entry): entry is typeof contentExports[number] => Boolean(entry)).map(entry => entry.selection);
      const bundle = await projectContentBundle(activeProject, selections);
      downloadBinaryFile(bundle.name, bundle.bytes, 'application/zip');
    } catch (cause) {
      setStatusNotification(cause instanceof Error ? cause.message : 'Selected content bundle could not be exported.');
    }
  }

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

  // Compute structured Before/After diff model for the Review Modal (U-01 / IA-17)
  const reviewDiffModel = useMemo(
    () =>
      buildReviewDiffModel({
        project: activeProject,
        draftDecisionValues: stagedDecisionDrafts,
        stagedBatch: stagedBatchPreview,
        polishProposal: activePolishProposal,
      }),
    [activeProject, stagedDecisionDrafts, stagedBatchPreview, activePolishProposal]
  );

  const closeReviewModal = useCallback(() => {
    setIsReviewModalOpen(false);
    requestAnimationFrame(() => {
      reviewButtonRef.current?.focus();
    });
  }, []);

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

      <StorageAlertBanner
        storageAlert={storageAlert}
        hydrationGate={hydrationGate}
        statusNotification={statusNotification}
        onReloadFromStorage={handleReloadLatestFromStorage}
        onForceOverwriteStorage={handleForceOverwriteStorage}
        onExportBackupJson={handleExportJson}
        onDismissStorageAlert={() => setStorageAlert(null)}
        onDismissStatusNotification={() => setStatusNotification(null)}
      />

      <nav aria-label="Narrative workspace" className="flex flex-wrap gap-1 border-b border-gray-200 bg-white px-2 py-1.5 dark:border-gray-800 dark:bg-gray-900 sm:px-4">
        {([['write', 'Write'], ['plan', 'Plan'], ['review', 'Review'], ['import', 'Import Story'], ['projects', 'Projects']] as const).map(([mode, label]) => (
          <button type="button" key={mode} aria-current={workspaceMode === mode ? 'page' : undefined} disabled={mode === 'import' && !hydrationSettled}
            className={`${workspaceButton} aria-[current=page]:bg-amber-100 dark:aria-[current=page]:bg-amber-950`}
            onClick={() => { if (allowNavigation()) { setAdoptArtifactId(undefined); setWorkspaceMode(mode); } }}>{label}</button>
        ))}
      </nav>

      {workspaceMode === 'write' && (
        <ManuscriptEditor
          key={activeProject.id}
          project={activeProject}
          onSave={saveManuscript}
          initialArtifactId={adoptArtifactId}
          focusedSectionId={focusedSectionId}
          aiConfigured={aiConfigured}
          onSaveWritingAlternative={handleSaveWritingAlternative}
          onExportDraft={sections => downloadTextFile(safeFilename(activeProject.name, 'unsaved-draft', 'md'), manuscriptText(sections), 'text/markdown;charset=utf-8')}
          onDirty={dirty => { draftDirtyRef.current = dirty; }}
          onUndo={handleUndo}
          onRedo={handleRedo}
          canUndo={undoState.past.length > 0}
          canRedo={undoState.future.length > 0}
          enabled={hydrationGate === 'ready' && typeof window !== 'undefined' && Boolean(window.indexedDB)}
        />
      )}
      {workspaceMode === 'review' && (
        <NarrativeReview
          project={activeProject}
          checks={consistencyIssues}
          aiConfigured={aiConfigured}
          openChecks={() => openPlan('consistency')}
          openHistory={() => openPlan('history', 'revision-history')}
          openOutput={() => handleSelectHeaderSection('output')}
          openOpportunities={() => openPlan('opportunities')}
          exportReport={format =>
            downloadTextFile(
              safeFilename(activeProject.name, 'evidence-audit', format),
              registryReport(activeProject, format),
              format === 'json' ? 'application/json;charset=utf-8' : 'text/markdown;charset=utf-8'
            )
          }
          onIssueDisposition={handleIssueDisposition}
          onRunLocalDiagnostics={handleRunLocalDiagnostics}
          onMergeSemanticFindings={handleMergeSemanticFindings}
          onApplyDiagnosticFix={handleApplyDiagnosticFix}
          onNavigateTarget={handleNavigateConsistencyTarget}
          onApplyModelSyncProposal={handleApplyModelSyncProposal}
          onApplyManuscriptSyncPatch={handleApplyManuscriptSyncPatch}
          onRecordSyncCheckpoint={handleRecordSyncCheckpoint}
          onUpdateAutomationPreferences={handleUpdateAutomationPreferences}
          autoAnalysisCallsUsed={autoAnalysisCallsUsed}
        />
      )}
      {workspaceMode === 'import' && (
        <ImportWorkflow
          existingProjects={savedProjects}
          activeProjectId={activeProject.id}
          aiConfigured={aiConfigured}
          onCreateProject={handleCreateImportedProject}
          onAppendToExistingProject={handleAppendToExistingProject}
          onCancelImport={() => setWorkspaceMode('plan')}
        />
      )}
      {workspaceMode === 'projects' && (
        <ProjectHub
          key={activeProject.id}
          project={activeProject}
          savedProjects={savedProjects}
          openProjects={() => openPlan('history', 'project-management')}
          openExport={() => openPlan('history', 'export-content')}
          openImport={() => {
            if (allowNavigation()) setWorkspaceMode('import');
          }}
          restore={handleImportProjectJson}
          restoreArchiveProjects={handleRestoreArchiveProjects}
          downloadBackup={backup =>
            downloadTextFile(
              safeFilename(activeProject.name, `r${backup.revision}-${backup.id.slice(0, 8)}-backup`, 'json'),
              JSON.stringify(backup, null, 2),
              'application/json;charset=utf-8'
            )
          }
          onExportManuscriptDocx={manuscriptSections(activeProject).length > 0 ? exportManuscriptDocx : undefined}
          onExportManuscriptText={manuscriptSections(activeProject).length > 0 ? exportManuscriptText : undefined}
          onExportStoryBible={handleExportStoryBibleMarkdown}
          onExportPrompt={handleExportPromptText}
          onExportIssuesAudit={() =>
            downloadTextFile(
              safeFilename(activeProject.name, 'issues-audit', 'md'),
              registryReport(activeProject, 'md'),
              'text/markdown;charset=utf-8'
            )
          }
          onDownloadAllProjectsArchive={(filename, bytes) => downloadBinaryFile(filename, bytes, 'application/zip')}
          autoBackupEnabled={autoBackupEnabled}
          onToggleAutoBackup={handleToggleAutoBackup}
        />
      )}

      <div className={workspaceMode === 'plan' ? 'contents' : 'hidden'}>
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
            activeProjectId={activeProject.id}
            activeRevision={activeProject.revision}
            onApplyDecisions={handleApplyDecisions}
            onInspectDecisionTarget={handleInspectDecisionTarget}
            onRefreshClarifications={handleRefreshClarifications}
            isClarificationsLoading={isClarificationsLoading}
            clarificationError={clarificationError}
            onPreviewBatchInstruction={handlePreviewBatchInstruction}
            onApplyBatchOperations={handleApplyBatchOperations}
            onBatchPreviewChange={setStagedBatchPreview}
            onDraftValuesChange={setStagedDecisionDrafts}
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
            compiledPromptLength={snapshot.refinedPrompt.trim().length}
            maxPromptChars={MAX_PROMPT_CHARS}
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
              onOpenChecks={() => {
                setRightPanelTab('consistency');
                setMobileTab('inspector');
              }}
              currentPrompt={snapshot.originalIdea}
              consistencyIssues={consistencyIssues}
              relationshipProjection={relationshipProjection}
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
                isPolishStale={Boolean(polishValidation && !polishValidation.ok)}
                polishStaleReason={polishValidation?.reason ?? null}
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
                onAdoptStory={artifactId => {
                  if (!allowNavigation()) return;
                  setAdoptArtifactId(artifactId);
                  setWorkspaceMode('write');
                }}
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
            historyTarget={historyTarget}
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
            storyBibleErrors={storyBibleErrors}
            focusedStoryBibleField={focusedStoryBibleField}
            consistencyIssues={consistencyIssues}
            onNavigateConsistencyTarget={handleNavigateConsistencyTarget}
            onRestoreRevision={handleRestoreRevision}
            onSwitchProject={handleSwitchProject}
            onCreateNewProject={handleCreateNewProject}
            onDeleteProject={handleDeleteProject}
            onExportJson={handleExportJson}
            onExportStoryBibleMarkdown={handleExportStoryBibleMarkdown}
            onExportPromptText={handleExportPromptText}
            onExportManuscript={snapshot.manuscriptVersionId ? exportManuscript : undefined}
            onExportManuscriptDocx={manuscriptSections(activeProject).length > 0 ? exportManuscriptDocx : undefined}
            onExportManuscriptText={manuscriptSections(activeProject).length > 0 ? exportManuscriptText : undefined}
            onOpenReviewDiagnostics={() => {
              if (allowNavigation()) setWorkspaceMode('review');
            }}
            onJumpToSection={(sectionId) => {
              if (!allowNavigation()) return;
              setFocusedSectionId(sectionId);
              setWorkspaceMode('write');
            }}
            aiConfigured={aiConfigured}
            onSendOpportunityToReview={handleSendOpportunityToReview}
            contentExports={contentExports.map(({ id, label }) => ({ id, label }))}
            onExportContent={exportContent}
            onExportContentBundle={exportContentBundle}
            onCreateOpportunity={handleCreateOpportunity}
            onTransitionOpportunity={handleTransitionOpportunity}
            onImportProjectJson={handleImportProjectJson}
            onPreviewProjectJson={parseProjectBackup}
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
        reviewButtonRef={reviewButtonRef}
        mode={mode}
        onModeChange={handleModeChange}
        onGenerate={handleGenerateOutput}
        isGenerating={isGenerating}
        showOutputDrawer={showOutputDrawer}
        onToggleOutputDrawer={() => setShowOutputDrawer((prev) => !prev)}
        revisionCount={activeProject.revision}
        isOutdated={isCurrentOutputOutdated}
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
        onApplyDecisions={handleApplyDecisions}
        onRestoreRevision={handleRestoreRevision}
        onOpenStoryBible={() => setRightPanelTab('story-bible')}
      />

      <InfoModal isOpen={showInfoModal} onClose={() => setShowInfoModal(false)} />
    </div>
  );
}

export default App;
