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
import { projectContentExport, type ContentExportSelection } from './lib/narrative/recovery/contentExport';
import { projectContentBundle } from './lib/narrative/recovery/bundleExporter';
import type { ArtifactAnchor, ManuscriptSection } from './shared/narrativeTypes';
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
  applyAsyncAnalysisCompletion,
  applyAsyncGenerationCompletion,
  buildReviewDiffModel,
  clearTicket,
  commitBatchPreviewToProject,
  commitRedoTransaction,
  commitSnapshotTransaction,
  commitUndoTransaction,
  createPolishProposal,
  createRequestTicket,
  createSerializedProjectSaveQueue,
  isProjectActionLoading,
  prepareProjectSwitch,
  reconcileAsyncSaveAcknowledgement,
  refreshArtifactsCurrentness,
  registerTicket,
  resolveHydrationWriteGate,
  shouldAllowUnsolicitedPersistence,
  upsertProjectInSavedList,
  validatePolishProposalAcceptance,
  type HydrationWriteGate,
  type InFlightTicketsMap,
  type SerializedSaveOptions,
} from './lib/projectController';
import { buildStartupAnalysisProviderInputs, resolveProviderPrompt, synthesizeRefinedPrompt } from './lib/promptBuilder';
import { transitionIssue } from './lib/narrative/issueRegistry';
import { createOpportunityProposal, transitionOpportunityProposal, type OpportunityProposalInput, type OpportunityProposalStatus } from './lib/narrative/opportunityProposals';
import {
  deleteProjectCompletely,
  exportProjectToJson,
  exportStoryBibleMarkdown,
  getDeletedProjectIds,
  LOCAL_STORAGE_ACTIVE_ID_KEY,
  loadProjectsFromIndexedDbDetailed,
  loadProjectsFromLocalStorage,
  persistProjectDurably,
  reconcileHydratedProjects,
  reloadLatestProjectsFromStorage,
  saveProjectToIndexedDb,
  saveProjectToLocalStorage,
  type StorageSaveResult,
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

interface StorageConflictAlert {
  type: 'conflict' | 'quota' | 'error';
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

function downloadBinaryFile(filename: string, content: Uint8Array, mimeType: string) {
  const blob = new Blob([content as BlobPart], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const element = document.createElement('a');
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
  const [historyTarget, setHistoryTarget] = useState<{ id: string; sequence: number } | null>(null);
  const [workspaceMode, setWorkspaceMode] = useState<'write' | 'plan' | 'review' | 'projects' | 'import'>('plan');
  const draftDirtyRef = useRef(false);
  const restorePendingRef = useRef(false);
  const creatingImportedProjectRef = useRef(false);

  function allowNavigation(): boolean {
    if (!draftDirtyRef.current && !restorePendingRef.current) return true;
    setStatusNotification('Save the open manuscript draft or wait for the restore before leaving this workspace.');
    return false;
  }

  const [mobileTab, setMobileTab] = useState<MobileTab>('graph');
  const [showOutputDrawer, setShowOutputDrawer] = useState<boolean>(true);
  const [isDarkMode, setIsDarkMode] = useState<boolean>(false);
  const [showInfoModal, setShowInfoModal] = useState<boolean>(false);
  const [isReviewModalOpen, setIsReviewModalOpen] = useState<boolean>(false);
  const [statusNotification, setStatusNotification] = useState<string | null>(null);
  const [storageAlert, setStorageAlert] = useState<StorageConflictAlert | null>(null);

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

  const abortControllersRef = useRef<Record<string, AbortController>>({});
  const autosaveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const appliedBatchProposalIdsRef = useRef<Set<string>>(new Set());
  const hasLocalEditsSinceMountRef = useRef<boolean>(false);
  const saveQueueRef = useRef(createSerializedProjectSaveQueue(persistProjectDurably));

  const reviewButtonRef = useRef<HTMLButtonElement | null>(null);
  const reviewModalDialogRef = useRef<HTMLDivElement | null>(null);
  const reviewModalCloseButtonRef = useRef<HTMLButtonElement | null>(null);

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
        setProject((prev) => {
          if (prev.id !== targetProject.id) return prev;
          const nextPersisted = Math.max(prev.persistedRevision ?? 0, ackRevision);
          return prev.persistedRevision !== nextPersisted
            ? { ...prev, persistedRevision: nextPersisted }
            : prev;
        });
        setSavedProjects((prev) => {
          const reconciled = reconcileAsyncSaveAcknowledgement({
            acknowledgedProject: targetProject,
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
    void loadProjectsFromIndexedDbDetailed()
      .then((idbLoad) => {
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
        if (idbLoad.status === 'empty' && idbProjects.length === 0) {
          void saveProjectToIndexedDb(activeProjectRef.current, {
            expectedPersistedRevision: activeProjectRef.current.persistedRevision,
          });
          updateHydrationGate(resolvedGate);
          markHydrationSettled();
          return;
        }

        const reconciled = reconcileHydratedProjects({
          localProjects: savedProjectsRef.current,
          idbProjects,
          activeProject: activeProjectRef.current,
          activeUndoState: undoStateRef.current,
          hasLocalEditsSinceMount: hasLocalEditsSinceMountRef.current,
        });
        setSavedProjects(reconciled.savedProjects);

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
            message: `Storage hydration conflict: IndexedDB holds revision #${reconciled.conflictWithHydrated.revision} ("${idbBibleSummary}") while this tab has revision #${reconciled.activeProject.revision} ("${localBibleSummary}"). Both versions are preserved until you choose which to keep.`,
          });
        } else {
          const idbActive = idbProjects.find((p) => p.id === reconciled.activeProject.id);
          if (!idbActive || (idbActive.revision ?? 1) < (reconciled.activeProject.revision ?? 1)) {
            void saveProjectToIndexedDb(reconciled.activeProject, {
              expectedPersistedRevision: idbActive?.revision,
            });
          }
        }

        if (
          reconciled.upgradedFromIndexedDb ||
          reconciled.activeProject !== activeProjectRef.current ||
          reconciled.activeUndoState !== undoStateRef.current
        ) {
          setProject(reconciled.activeProject);
          setUndoState(reconciled.activeUndoState);
          if (reconciled.upgradedFromIndexedDb && !reconciled.conflictWithHydrated) {
            saveProjectToLocalStorage(reconciled.activeProject, { forceOverwrite: true });
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
  }, [updateHydrationGate]);

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
        saveProjectToLocalStorage(current, { expectedPersistedRevision: current.persistedRevision });
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
    if (Object.values(inFlightTickets).some(ticket => ticket.projectId === before.id)) {
      throw new Error('Wait for the current project operation to finish before saving.');
    }
    const prepared = prepareManuscriptChange(before, undoStateRef.current, base, sections, artifact, styleProfile);
    if (!prepared) return;
    if (storageAlert?.type === 'conflict' && storageAlert.projectId === before.id) {
      throw new Error('The project has a storage conflict. Copy the open text before reloading.');
    }

    if (!before.narrative) {
      const written = await flushProjectDurably(before, { expectedPersistedRevision: before.persistedRevision });
      if (!written.saved || written.authoritativeStore !== 'indexeddb') {
        throw new Error(written.error ?? 'The prior project could not be saved before the manuscript upgrade.');
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
      const previousSave = await flushProjectDurably(previous, {
        expectedPersistedRevision: previous.persistedRevision ?? previous.revision,
      });
      if (!previousSave.saved) {
        throw new Error(previousSave.error ?? 'The current project could not be saved before import. Existing projects were not changed.');
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
      try {
        window.localStorage?.setItem(LOCAL_STORAGE_ACTIVE_ID_KEY, committed.id);
      } catch {
        // The authoritative project is already in IndexedDB; active selection can be recovered from the in-memory workspace.
      }
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
    const resolved = resolveConsistencyIssueTarget(snapshot, target);
    if (!resolved.ok) {
      setStatusNotification(resolved.reason);
      return;
    }
    if (resolved.kind === 'story_bible') {
      setRightPanelTab('story-bible');
      setMobileTab('inspector');
      setFocusedStoryBibleField((prev) => ({
        field: resolved.storyField,
        seq: (prev?.seq ?? 0) + 1,
      }));
      return;
    }
    if (resolved.kind === 'relationship') {
      setSelectedEntityId(null);
      setSelectedRelationshipId(resolved.relationship.id ?? null);
      setRightPanelTab('inspector');
      setMobileTab('inspector');
      return;
    }
    if (resolved.kind === 'entity') {
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

    const ticket = createRequestTicket(targetProject, 'batch');
    setInFlightTickets((prev) => registerTicket(prev, ticket));
    try {
      const aiResult = await requestBatchEditInterpretation(instruction, {
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

  // --- AI Analysis, Clarifications & Generation with Scoped Tickets ---

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

    const slotKey = `${originProject.id}:analyze`;
    abortControllersRef.current[slotKey]?.abort();
    const controller = new AbortController();
    abortControllersRef.current[slotKey] = controller;

    const ticket = createRequestTicket(originProject, 'analyze');
    setInFlightTickets((prev) => registerTicket(prev, ticket));
    setAnalysisErrors((prev) => ({ ...prev, [originProject.id]: null }));
    setClarificationErrors((prev) => ({ ...prev, [originProject.id]: null }));

    try {
      const [newGraph, newClarifications] = await Promise.all([
        analyzePromptToBeliefGraph(providerInputs.prompt, providerInputs.mode, controller.signal).catch((err) => {
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
          providerInputs.prompt,
          providerInputs.askedQuestions,
          providerInputs.mode,
          controller.signal,
          providerInputs.confirmedFacts
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
          savedProjects: savedProjectsRef.current,
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

      const slotKey = `${originProject.id}:clarify`;
      abortControllersRef.current[slotKey]?.abort();
      const controller = new AbortController();
      abortControllersRef.current[slotKey] = controller;

      const ticket = createRequestTicket(originProject, 'clarify');
      setInFlightTickets((prev) => registerTicket(prev, ticket));
      setClarificationErrors((prev) => ({ ...prev, [originProject.id]: null }));

      const confirmedFacts = promptDecision.contextSnapshot.entities
        .filter((e) => !e.excluded)
        .flatMap((e) =>
          e.attributes
            .filter((a) => a.status === 'confirmed' && a.confirmedValue)
            .map((a) => `${e.name} ${a.name}: ${a.confirmedValue}`)
        );

      try {
        const freshClarifications = await generateClarifications(
          promptToUse,
          [...originSnap.answeredQuestions, ...originSnap.skippedQuestions],
          originSnap.mode,
          controller.signal,
          confirmedFacts
        );
        const applied = applyAsyncAnalysisCompletion({
          ticket,
          activeProject: activeProjectRef.current,
          activeUndoState: undoStateRef.current,
          savedProjects: savedProjectsRef.current,
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

    const slotKey = `${originProject.id}:generate`;
    abortControllersRef.current[slotKey]?.abort();
    const controller = new AbortController();
    abortControllersRef.current[slotKey] = controller;

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
          savedProjects: savedProjectsRef.current,
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
          savedProjects: savedProjectsRef.current,
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
  }, []);

  const handlePolishPromptWithAi = async () => {
    const originProject = activeProjectRef.current;
    if (isProjectActionLoading(inFlightTickets, originProject.id, 'polish')) return;

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

    const ticket = createRequestTicket(originProject, 'polish');
    setInFlightTickets((prev) => registerTicket(prev, ticket));
    try {
      const polished = await refinePromptWithAllUpdates(
        promptToPolish,
        [],
        []
      );
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
      setStatusNotification(
        getReadableErrorMessage(err, 'Could not run AI prompt polish; structured prompt preserved.')
      );
    } finally {
      setInFlightTickets((prev) => clearTicket(prev, ticket));
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
    const originRevision = currentActive.revision;
    const originSnapshot = currentActive.snapshot;

    void reloadLatestProjectsFromStorage(originId, {
      resolution,
      inMemoryActiveProject: currentActive,
      hasLocalEditsSinceMount: hasLocalEditsSinceMountRef.current,
    }).then(
      (latest) => {
        // FIX 2: Prevent stale asynchronous reloads from overwriting newer in-memory edits made during reload
        if (
          activeProjectRef.current.id !== originId ||
          activeProjectRef.current.revision !== originRevision ||
          activeProjectRef.current.snapshot !== originSnapshot
        ) {
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

        if (latest.idbStatus === 'read_error') {
          setStorageAlert({
            type: 'error',
            projectId: originId,
            message: `Could not reload from IndexedDB (${latest.idbError ?? 'read failure'}). Existing records were not overwritten.`,
          });
          return;
        }

        if (latest.conflictDetected && latest.conflictProject) {
          const idbBibleSummary =
            latest.conflictProject.snapshot.storyBible.genre.value ||
            latest.conflictProject.snapshot.storyBible.setting.value ||
            latest.conflictProject.snapshot.originalIdea.slice(0, 40);
          const localBibleSummary =
            latest.activeProject.snapshot.storyBible.genre.value ||
            latest.activeProject.snapshot.storyBible.setting.value ||
            latest.activeProject.snapshot.originalIdea.slice(0, 40);
          setSavedProjects(latest.projects);
          setStorageAlert({
            type: 'conflict',
            projectId: latest.activeProject.id,
            message: `Conflicting versions detected at revision #${latest.conflictProject.revision}: IndexedDB has "${idbBibleSummary}" while localStorage/memory has "${localBibleSummary}". Both versions remain recoverable.`,
          });
          return;
        }

        saveQueueRef.current.resetProject(latest.activeProject.id);
        savedProjectsRef.current = latest.projects;
        setSavedProjects(latest.projects);
        setProject(latest.activeProject);
        setUndoState(latest.activeUndoState);
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
    const targetProject = activeProjectRef.current;
    updateHydrationGate('ready');
    saveQueueRef.current.resetProject(targetProject.id);
    void flushProjectDurably(targetProject, {
      forceOverwrite: true,
      allowDeleted: true,
      clearConflictOnSuccess: true,
      successNotification: 'Overwrote storage with your current tab version.',
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

    try {
      window.localStorage?.setItem(LOCAL_STORAGE_ACTIVE_ID_KEY, nextTarget.id);
    } catch {
      // Ignore quota error when updating active project pointer
    }

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

    // Abort any in-flight operations for the deleted project (F-06 / IA-11)
    for (const actionKey of ['analyze', 'clarify', 'batch', 'generate', 'polish']) {
      abortControllersRef.current[`${projectId}:${actionKey}`]?.abort();
      delete abortControllersRef.current[`${projectId}:${actionKey}`];
    }
    setInFlightTickets((prev) => {
      const next: InFlightTicketsMap = {};
      for (const [k, v] of Object.entries(prev)) {
        if (v.projectId !== projectId) {
          next[k] = v;
        }
      }
      return next;
    });

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
    downloadTextFile(
      safeFilename(activeProject.name, `r${activeProject.revision}-backup`, 'json'),
      exportProjectToJson(activeProject),
      'application/json;charset=utf-8'
    );
  };

  const handleExportStoryBibleMarkdown = () => {
    downloadTextFile(
      safeFilename(activeProject.name, 'story-bible', 'md'),
      exportStoryBibleMarkdown(activeProject),
      'text/markdown;charset=utf-8'
    );
  };

  const handleExportPromptText = () => {
    downloadTextFile(safeFilename(activeProject.name, 'refined-prompt', 'txt'), snapshot.refinedPrompt, 'text/plain;charset=utf-8');
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
      if (Object.values(inFlightTickets).some(ticket => ticket.projectId === outgoing.id)) {
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
    const file = projectContentExport(activeProject, { kind: 'manuscript' });
    downloadTextFile(file.name, file.text, file.mediaType);
  }

  const contentExports: Array<{ id: string; label: string; selection: ContentExportSelection }> = [
    ...(activeProject.snapshot.manuscriptVersionId
      ? [{ id: 'manuscript:full', label: 'Working manuscript · Markdown', selection: { kind: 'manuscript' } as const }]
      : []),
    ...manuscriptSections(activeProject).map(section => ({
      id: `manuscript-section:${section.id}`,
      label: `${section.kind === 'chapter' ? 'Chapter' : 'Scene'} · ${section.title}`,
      selection: { kind: 'manuscript' as const, sectionIds: [section.id] },
    })),
    ...activeProject.artifacts.flatMap(artifact => artifact.mode === 'story' && artifact.storyText
      ? [{ id: `artifact:${artifact.id}`, label: `Generated story · ${new Date(artifact.createdAt).toLocaleString()}`,
        selection: { kind: 'generated-story', artifactId: artifact.id } as const }]
      : []),
    ...(activeProject.narrative?.sources ?? []).map(source => ({
      id: `source:${JSON.stringify([source.id, source.version])}`,
      label: `Original source text · ${source.id} / ${source.version}`,
      selection: { kind: 'source-text', sourceId: source.id, version: source.version } as const,
    })),
    { id: 'evidence-report:md', label: 'Evidence report · Markdown', selection: { kind: 'evidence-report', format: 'md' } },
    { id: 'evidence-report:json', label: 'Evidence report · JSON', selection: { kind: 'evidence-report', format: 'json' } },
  ];

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

  // Review Modal Escape & Focus Trap accessibility (U-03 / IA-18)
  useEffect(() => {
    if (!isReviewModalOpen) return;
    requestAnimationFrame(() => {
      reviewModalCloseButtonRef.current?.focus();
    });

    const handleModalKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        closeReviewModal();
        return;
      }
      if (e.key === 'Tab' && reviewModalDialogRef.current) {
        const focusables = Array.from(
          reviewModalDialogRef.current.querySelectorAll<HTMLElement>(
            'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
          )
        );
        if (focusables.length === 0) return;
        const first = focusables[0];
        const last = focusables[focusables.length - 1];
        const active = document.activeElement as HTMLElement | null;
        if (e.shiftKey) {
          if (active === first || !reviewModalDialogRef.current.contains(active)) {
            e.preventDefault();
            last.focus();
          }
        } else {
          if (active === last || !reviewModalDialogRef.current.contains(active)) {
            e.preventDefault();
            first.focus();
          }
        }
      }
    };

    window.addEventListener('keydown', handleModalKeyDown);
    return () => window.removeEventListener('keydown', handleModalKeyDown);
  }, [isReviewModalOpen, closeReviewModal]);

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
                  onClick={() => handleReloadLatestFromStorage('prefer-idb')}
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
            {storageAlert.type === 'error' && hydrationGate === 'blocked-read-error' && (
              <button
                type="button"
                onClick={() => handleReloadLatestFromStorage()}
                className="px-2.5 py-1 rounded font-semibold bg-amber-700 hover:bg-amber-800 text-white"
              >
                Retry Storage Read
              </button>
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
          className="px-3 pt-2 xl:p-0 xl:fixed xl:bottom-20 xl:right-4 xl:z-[1850] xl:w-full xl:max-w-md pointer-events-auto flex-shrink-0"
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

      <nav aria-label="Narrative workspace" className="flex flex-wrap gap-1 border-b border-gray-200 bg-white px-2 py-1.5 dark:border-gray-800 dark:bg-gray-900 sm:px-4">
        {([['write', 'Write'], ['plan', 'Plan'], ['review', 'Review'], ['import', 'Import Story'], ['projects', 'Projects']] as const).map(([mode, label]) => (
          <button type="button" key={mode} aria-current={workspaceMode === mode ? 'page' : undefined} disabled={mode === 'import' && !hydrationSettled}
            className={`${workspaceButton} aria-[current=page]:bg-amber-100 dark:aria-[current=page]:bg-amber-950`}
            onClick={() => { if (allowNavigation()) { setAdoptArtifactId(undefined); setWorkspaceMode(mode); } }}>{label}</button>
        ))}
      </nav>

      {workspaceMode === 'write' && (
        <ManuscriptEditor key={activeProject.id} project={activeProject} onSave={saveManuscript} initialArtifactId={adoptArtifactId}
          onExportDraft={sections => downloadTextFile(safeFilename(activeProject.name, 'unsaved-draft', 'md'), manuscriptText(sections), 'text/markdown;charset=utf-8')}
          onDirty={dirty => { draftDirtyRef.current = dirty; }}
          onUndo={handleUndo} onRedo={handleRedo} canUndo={undoState.past.length > 0} canRedo={undoState.future.length > 0}
          enabled={hydrationGate === 'ready' && typeof window !== 'undefined' && Boolean(window.indexedDB)} />
      )}
      {workspaceMode === 'review' && (
        <NarrativeReview project={activeProject} checks={consistencyIssues}
          openChecks={() => openPlan('consistency')} openHistory={() => openPlan('history', 'revision-history')}
          openOutput={() => handleSelectHeaderSection('output')}
          exportReport={format => downloadTextFile(safeFilename(activeProject.name, 'evidence-audit', format),
            registryReport(activeProject, format), format === 'json' ? 'application/json;charset=utf-8' : 'text/markdown;charset=utf-8')}
          onIssueDisposition={handleIssueDisposition} />
      )}
      {workspaceMode === 'import' && <ImportWorkflow onCreateProject={handleCreateImportedProject} onCancelImport={() => setWorkspaceMode('plan')} />}
      {workspaceMode === 'projects' && (
        <ProjectHub key={activeProject.id} project={activeProject}
          openProjects={() => openPlan('history', 'project-management')} openExport={() => openPlan('history', 'export-content')}
          restore={handleImportProjectJson}
          downloadBackup={backup => downloadTextFile(safeFilename(activeProject.name, `r${backup.revision}-${backup.id.slice(0, 8)}-backup`, 'json'),
            JSON.stringify(backup, null, 2), 'application/json;charset=utf-8')} />
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
              currentPrompt={snapshot.originalIdea}
              consistencyIssues={consistencyIssues}
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

      {/* Dedicated Review Plan & Prompt Changes Modal (AC19, U-01, U-03, IA-17, IA-18) */}
      {isReviewModalOpen && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label="Review Plan and Prompt Changes"
          className="fixed inset-0 z-[1900] bg-black/60 flex items-center justify-center p-4 backdrop-blur-xs"
          onClick={closeReviewModal}
        >
          <div
            ref={reviewModalDialogRef}
            className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-xl shadow-2xl w-full max-w-4xl max-h-[85vh] flex flex-col overflow-hidden"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="px-5 py-3.5 border-b border-gray-200 dark:border-gray-800 flex items-center justify-between">
              <div>
                <h2 className="font-display text-base font-bold text-gray-900 dark:text-gray-100">
                  Review Story Plan, Pending Decisions &amp; Prompt Diff
                </h2>
                <p className="text-xs text-gray-500 dark:text-gray-400">
                  Project Revision #{activeProject.revision} · {pendingDecisionCount} pending inbox item(s) ·{' '}
                  {reviewDiffModel.items.length} staged before/after change(s) ·{' '}
                  {consistencyIssues.length} consistency warning(s)
                </p>
              </div>
              <button
                ref={reviewModalCloseButtonRef}
                type="button"
                onClick={closeReviewModal}
                className="text-sm font-semibold text-gray-500 hover:text-gray-900 dark:hover:text-white px-2.5 py-1 rounded focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
              >
                Close
              </button>
            </div>

            <div className="flex-1 overflow-y-auto p-5 space-y-4 text-xs">
              {/* Structured Before -> After Diff Table (U-01 / IA-17) */}
              <div className="p-3.5 rounded-lg border border-gray-200 dark:border-gray-800 bg-gray-50/60 dark:bg-gray-950/40 space-y-2.5">
                <div className="flex items-center justify-between">
                  <h3 className="font-bold text-gray-900 dark:text-gray-100">
                    Before &rarr; After Impact of Pending Decisions &amp; Staged Batch Edits ({reviewDiffModel.items.length})
                  </h3>
                  {pendingDecisionCount > 0 && (
                    <button
                      type="button"
                      onClick={() => handleApplyDecisions(pendingDecisions.map((d) => d.id), 'accept', stagedDecisionDrafts)}
                      className="px-2.5 py-1 rounded font-semibold bg-blue-600 hover:bg-blue-700 text-white"
                    >
                      Accept All Pending ({pendingDecisionCount})
                    </button>
                  )}
                </div>

                {reviewDiffModel.hasStaleBatch && (
                  <div
                    role="alert"
                    className="p-2.5 rounded border border-amber-300 dark:border-amber-800 bg-amber-50 dark:bg-amber-950/60 text-amber-900 dark:text-amber-200 text-xs font-medium"
                  >
                    Stale staged batch preview detected: the project revision changed after this batch preview was created, so it is excluded from the projected prompt until you click Re-preview in the Decision Inbox.
                  </div>
                )}

                {reviewDiffModel.items.length === 0 ? (
                  <p className="text-gray-500">
                    No pending decisions or staged batch edits. All current plan items are committed.
                  </p>
                ) : (
                  <div data-testid="review-diff-list" className="space-y-1.5 max-h-48 overflow-y-auto">
                    {reviewDiffModel.items.map((diff) => {
                      const matchingDecision = pendingDecisions.find(
                        (d) => d.id === diff.id || `diff_${d.id}` === diff.id
                      );
                      return (
                        <div
                          key={diff.id}
                          data-diff-source={diff.source}
                          className="flex flex-wrap items-center justify-between gap-2 p-2.5 rounded bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800"
                        >
                          <div className="min-w-0 flex-1 space-y-0.5">
                            <div className="flex items-center gap-1.5 text-[11px] text-gray-500 dark:text-gray-400">
                              <span className="uppercase font-semibold tracking-wider">{diff.category}</span>
                              <span aria-hidden="true">&middot;</span>
                              <span className="font-medium text-gray-800 dark:text-gray-200 truncate">
                                {diff.targetLabel}
                              </span>
                            </div>
                            <div className="flex flex-wrap items-center gap-1.5 font-mono text-xs">
                              <span className="px-1.5 py-0.5 rounded bg-red-50 dark:bg-red-950/50 text-red-700 dark:text-red-300 border border-red-200 dark:border-red-900 line-through">
                                Before: {diff.beforeValue}
                              </span>
                              <span aria-hidden="true" className="text-gray-400">
                                &rarr;
                              </span>
                              <span className="px-1.5 py-0.5 rounded bg-emerald-50 dark:bg-emerald-950/50 text-emerald-700 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-900 font-semibold">
                                After: {diff.afterValue}
                              </span>
                            </div>
                            {diff.conflictWarning && (
                              <p className="text-[11px] font-medium text-amber-700 dark:text-amber-300 pt-0.5">
                                {diff.conflictWarning}
                              </p>
                            )}
                          </div>

                          {matchingDecision && (
                            <div className="flex items-center gap-1 shrink-0">
                              <button
                                type="button"
                                onClick={() =>
                                  handleApplyDecisions([matchingDecision.id], 'accept', stagedDecisionDrafts)
                                }
                                className="px-2 py-1 rounded bg-blue-600 hover:bg-blue-700 text-white font-semibold"
                              >
                                Accept
                              </button>
                              <button
                                type="button"
                                onClick={() => handleApplyDecisions([matchingDecision.id], 'reject')}
                                className="px-2 py-1 rounded bg-gray-200 dark:bg-gray-800 text-red-600 dark:text-red-400 font-medium"
                              >
                                Reject
                              </button>
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
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

              {/* Synthesized Prompt Before vs After Diff Preview */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <h3 className="font-bold text-gray-900 dark:text-gray-100">
                    Current Committed Prompt ({mode === 'story' ? 'Story Mode' : 'Image Mode'})
                  </h3>
                  <pre className="p-3 rounded-lg bg-gray-50 dark:bg-gray-950 border border-gray-200 dark:border-gray-800 text-xs font-mono whitespace-pre-wrap leading-relaxed max-h-56 overflow-y-auto">
                    {reviewDiffModel.beforePrompt}
                  </pre>
                </div>

                <div className="space-y-1.5">
                  <h3 className="font-bold text-gray-900 dark:text-gray-100">
                    Projected Prompt After Accepting Staged Changes
                  </h3>
                  <pre
                    data-testid="review-projected-prompt"
                    className="p-3 rounded-lg bg-emerald-50/40 dark:bg-emerald-950/30 border border-emerald-200 dark:border-emerald-900 text-xs font-mono whitespace-pre-wrap leading-relaxed max-h-56 overflow-y-auto"
                  >
                    {reviewDiffModel.afterPrompt}
                  </pre>
                </div>
              </div>
            </div>

            <div className="px-5 py-3 border-t border-gray-200 dark:border-gray-800 flex items-center justify-end gap-2">
              <button
                type="button"
                onClick={() => {
                  closeReviewModal();
                  setRightPanelTab('story-bible');
                }}
                className="px-3 py-1.5 text-xs font-medium rounded-lg border border-gray-300 dark:border-gray-700 hover:bg-gray-100 dark:hover:bg-gray-800"
              >
                Open Story Bible
              </button>
              <button
                type="button"
                onClick={closeReviewModal}
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
