/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import ManuscriptEditor from './components/manuscript/ManuscriptEditor';
import ProjectHub from './components/workspace/ProjectHub';
import NarrativeReview from './components/workspace/NarrativeReview';
import HistoryPanel from './components/inspector/HistoryPanel';
import type { PendingProposalReview } from './components/workspace/review/proposalReviewContext';
import AdaptivePlanWorkspace, { type PlanInspectorDestination } from './components/workspace/AdaptivePlanWorkspace';
import ImportWorkflow from './components/narrativeImport/ImportWorkflow';
import CreateProjectDialog from './components/projects/CreateProjectDialog';
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
import { buildClientBudgetDisclosure } from './lib/narrative/aiBudgetClient';
import { useProjectPersistence } from './lib/controller/useProjectPersistence';
import { sameProjectVersion } from './lib/controller/projectListSync';
import StorageAlertBanner, { type StorageConflictAlert } from './components/workspace/StorageAlertBanner';
import ReviewDiffModal from './components/workspace/ReviewDiffModal';
import { readBrowserWorkspacePreference, writeBrowserWorkspacePreference } from './lib/workspacePreference';
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
  matchesAppendTarget,
  type AppendTargetBase,
  type AppendInsertPosition,
  type CrossProjectIdentityDecision,
} from './lib/narrative/import/appendApply';
import type { ArtifactAnchor, ManuscriptSection, NarrativeRecords, OpportunityProposal } from './shared/narrativeTypes';
import type {
  DiagnosticFixAlternative,
  DiagnosticsAnalyzeRequest,
  SyncManuscriptPatch,
  SyncModelProposal,
  WritingAssistAction,
} from './shared/narrativeAiSchemas';
import React, { useState, useCallback, useEffect, useMemo, useRef } from 'react';
import BeliefGraph from './components/BeliefGraph';
import ContextualInspector, { type RightPanelTab } from './components/ContextualInspector';
import DecisionInboxPanel from './components/DecisionInboxPanel';
import Header, { type WorkspaceSection } from './components/Header';
import { getSavePresentation } from './lib/workspace/savePresentation';
import InfoModal from './components/InfoModal';
import AiConnectionsPanel from './components/settings/AiConnectionsPanel';
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
  runAsyncAnalysisSlot,
  runAsyncClarifySlot,
  runAsyncGenerationSlot,
  upsertProjectInSavedList,
  validatePolishProposalAcceptance,
  type AiTicketAuthority,
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
  loadProjectsFromLocalStorage,
  persistProjectDurably,
  reloadLatestProjectsFromStorage,
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
  const [resumedProposalReview, setResumedProposalReview] = useState<PendingProposalReview>();
  const [workspaceMode, setWorkspaceMode] = useState<'write' | 'plan' | 'review' | 'projects' | 'import'>(readBrowserWorkspacePreference);
  const lastStableWorkspaceModeRef = useRef<'write' | 'plan' | 'review'>(workspaceMode === 'projects' || workspaceMode === 'import' ? 'write' : workspaceMode);
  const [aiConfigured, setAiConfigured] = useState<boolean>(false);
  const autoAnalysisCallCount = useRef(0);
  const [autoAnalysisCallsUsed, setAutoAnalysisCallsUsed] = useState<number>(0);
  const [autoBackupEnabled, setAutoBackupEnabled] = useState<boolean>(() => {
    try {
      return window.localStorage?.getItem(AUTO_BACKUP_PREF_KEY) === 'true';
    } catch {
      return false;
    }
  });
  const lastAutoBackupRevisionRef = useRef<Record<string, number>>({});
  const pendingAutoBackups = useRef(new Set<string>());
  const draftDirtyRef = useRef(false);
  const compositionPendingRef = useRef(false);
  const restorePendingRef = useRef(false);
  const creatingImportedProjectRef = useRef(false);

  const [mobileTab, setMobileTab] = useState<MobileTab>('graph');
  const [showOutputDrawer, setShowOutputDrawer] = useState<boolean>(false);
  const [isDarkMode, setIsDarkMode] = useState<boolean>(false);
  const [showInfoModal, setShowInfoModal] = useState<boolean>(false);
  const [showAiSettings, setShowAiSettings] = useState<boolean>(false);
  const [createProjectOpen, setCreateProjectOpen] = useState(false);
  const [createProjectPending, setCreateProjectPending] = useState(false);
  const [manuscriptDraftDirty, setManuscriptDraftDirty] = useState(false);
  const [restorePending, setRestorePending] = useState(false);
  const [pendingDurableSaveProjectIds, setPendingDurableSaveProjectIds] = useState<Set<string>>(() => new Set());
  const [isReviewModalOpen, setIsReviewModalOpen] = useState<boolean>(false);
  const [statusNotification, setStatusNotification] = useState<string | null>(null);
  const [storageAlert, setStorageAlert] = useState<StorageConflictAlert | null>(null);

  useEffect(() => {
    if (workspaceMode === 'projects' || workspaceMode === 'import') return;
    lastStableWorkspaceModeRef.current = workspaceMode;
    writeBrowserWorkspacePreference(workspaceMode);
  }, [workspaceMode]);

  function allowNavigation(): boolean {
    if (!draftDirtyRef.current && !restorePendingRef.current && !compositionPendingRef.current) return true;
    setStatusNotification(compositionPendingRef.current
      ? 'Finish text composition before changing workspaces.'
      : 'Save the open manuscript draft or wait for the restore before leaving this workspace.');
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
  const pendingSaveCountsRef = useRef(new Map<string, number>());
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

  const adjustPendingSave = (projectId: string, delta: 1 | -1) => {
    const nextCount = Math.max(0, (pendingSaveCountsRef.current.get(projectId) ?? 0) + delta);
    if (nextCount) pendingSaveCountsRef.current.set(projectId, nextCount);
    else pendingSaveCountsRef.current.delete(projectId);
    setPendingDurableSaveProjectIds(previous => {
      const next = new Set(previous);
      if (nextCount) next.add(projectId);
      else next.delete(projectId);
      return next;
    });
  };

  const selectProject = (current: CreativeProject, undo: UndoRedoState) => {
    draftDirtyRef.current = false;
    setManuscriptDraftDirty(false);
    hasLocalEditsSinceMountRef.current = (current.persistedRevision ?? 0) < current.revision;
    publishCurrentProject(current, undo);
    setCachedProjectSelection(current.id);
  };

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

      adjustPendingSave(targetProject.id, 1);
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
        const acknowledgedProject = res.storedProject ?? targetProject;
        const activeAtAcknowledgement = activeProjectRef.current;
        const reconciled = reconcileAsyncSaveAcknowledgement({
          acknowledgedProject,
          acknowledgedRevision: ackRevision,
          currentActiveProject: activeAtAcknowledgement,
          savedProjects: savedProjectsRef.current,
        });
        savedProjectsRef.current = reconciled.savedProjects;
        setSavedProjects(reconciled.savedProjects);
        if (reconciled.activeProject !== activeAtAcknowledgement) {
          const updated = reconciled.activeProject;
          activeProjectRef.current = updated;
          setProject((prev) => prev.id === updated.id && prev.revision === updated.revision &&
            prev.narrative === updated.narrative ? { ...prev, persistedRevision: updated.persistedRevision } : prev);
        }

        const competingActive = activeAtAcknowledgement.id === acknowledgedProject.id &&
          activeAtAcknowledgement.revision >= ackRevision &&
          (reconciled.activeProject.persistedRevision ?? 0) < ackRevision;
        if (competingActive) {
          setStorageAlert({
            type: 'conflict',
            projectId: acknowledgedProject.id,
            conflictingProject: acknowledgedProject,
            message: 'A durable save completed while this working copy changed. Review both versions before saving again.',
          });
        } else if (options?.clearConflictOnSuccess && activeProjectRef.current.id === targetProject.id) {
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
      }).finally(() => adjustPendingSave(targetProject.id, -1));
    },
    []
  );

  const persistenceWorkspace = useMemo(() => ({
    read: () => ({
      project: activeProjectRef.current,
      undo: undoStateRef.current,
      projects: savedProjectsRef.current,
      edited: hasLocalEditsSinceMountRef.current,
      draftPending: draftDirtyRef.current || restorePendingRef.current || compositionPendingRef.current,
    }),
    publish: (next: { savedProjects: CreativeProject[]; activeProject: CreativeProject; activeUndoState: UndoRedoState }) => {
      savedProjectsRef.current = next.savedProjects;
      setSavedProjects(next.savedProjects);
      if (next.activeProject !== activeProjectRef.current || next.activeUndoState !== undoStateRef.current) {
        publishCurrentProject(next.activeProject, next.activeUndoState);
      }
    },
    initialize: (candidate: CreativeProject, options?: SerializedSaveOptions) => saveQueueRef.current.enqueue(candidate, options),
  }), [publishCurrentProject]);

  const {
    gate: hydrationGate, getGate: getHydrationGate, acceptReadStatus, cancelAutosave,
  } = useProjectPersistence({
    project: activeProject, startup: initialData, workspace: persistenceWorkspace,
    persist: flushProjectDurably, alert: storageAlert, report: setStorageAlert,
  });
  const hydrationSettled = hydrationGate === 'ready' || hydrationGate === 'unavailable';
  const canWriteWorkspace = () => {
    const gate = getHydrationGate();
    return gate === 'ready' || gate === 'unavailable';
  };

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
    const { id, revision } = activeProject;
    const lastRev = lastAutoBackupRevisionRef.current[id] ?? 0;
    if (revision - lastRev < 5 || pendingAutoBackups.current.has(id)) return;
    pendingAutoBackups.current.add(id);
    let current = true;
    void saveBackup(activeProject, `Auto-backup at rev ${revision}`).then(() => {
      lastAutoBackupRevisionRef.current[id] = revision;
    }, (error) => {
      if (current && activeProjectRef.current.id === id) {
        setStatusNotification(getReadableErrorMessage(error, 'The automatic backup could not be verified. A manual backup is still available.'));
      }
    }).finally(() => {
      pendingAutoBackups.current.delete(id);
    });
    return () => { current = false; };
  }, [autoBackupEnabled, hydrationGate, activeProject]);

  const stageNarrativeMetadata = useCallback((next: CreativeProject, label: string, summary: string) => {
    if (next === activeProjectRef.current) return false;
    const revised = recordProjectRevision(next, label, summary);
    activeProjectRef.current = revised;
    hasLocalEditsSinceMountRef.current = true;
    setProject(revised);
    return true;
  }, []);

  const runSemanticDiagnostics = useCallback(async (
    payload: DiagnosticsAnalyzeRequest,
    context: { manuscriptVersionId?: string; snapshotDigest: string; scopeLabel: string },
    lifetime: AbortSignal,
    preferences?: NonNullable<NarrativeRecords['automationPreferences']>,
  ) => {
    const matchesInput = () => {
      const current = activeProjectRef.current;
      return !lifetime.aborted && !getDeletedProjectIds().has(payload.projectId) &&
        current.id === payload.projectId && current.revision === payload.baseRevision &&
        current.snapshot.manuscriptVersionId === context.manuscriptVersionId &&
        computeSnapshotDigest(current.snapshot) === context.snapshotDigest &&
        (!preferences || current.narrative?.automationPreferences === preferences);
    };
    if (!matchesInput()) return null;
    const authority = aiTicketAuthorityRef.current;
    const { ticket, signal } = authority.beginSlot(activeProjectRef.current, 'diagnostics');
    const cancel = () => authority.cancelIfCurrent(ticket);
    lifetime.addEventListener('abort', cancel, { once: true });
    try {
      const response = await requestSemanticDiagnostics(payload, signal);
      if (!authority.isCurrent(ticket) || !matchesInput()) return null;
      const before = activeProjectRef.current;
      const mapped = convertSemanticFindingsToDiagnosticFindings(response.findings);
      const next = syncDiagnosticFindingsIntoProject(before, mapped, {
        source: 'semantic-ai',
        scopeLabel: context.scopeLabel,
        fullScan: false,
      });
      stageNarrativeMetadata(next, 'Semantic consistency check', 'Recorded scoped diagnostic findings.');
      return response;
    } catch (error) {
      if (!authority.isCurrent(ticket) || !matchesInput()) return null;
      throw error;
    } finally {
      lifetime.removeEventListener('abort', cancel);
      authority.clearIfCurrent(ticket);
    }
  }, [stageNarrativeMetadata]);

  // Metadata-only commits share the same analysis input and must not schedule another run.
  const analysisSnapshotDigest = computeSnapshotDigest(activeProject.snapshot);
  // Optional bounded semantic auto-analysis (strictly OFF by default, debounced, capped per session)
  useEffect(() => {
    const prefs = activeProject.narrative?.automationPreferences;
    if (!aiConfigured || !prefs?.semanticAutoAnalysisEnabled || prefs.paused) return;
    if (!hasLocalEditsSinceMountRef.current) return;
    if (autoAnalysisCallCount.current >= (prefs.maxCallsPerSession ?? 4)) return;
    if (hydrationGate !== 'ready') return;

    const lifetime = new AbortController();
    const projectId = activeProject.id;
    const timer = window.setTimeout(() => {
      const current = activeProjectRef.current;
      if (current.id !== projectId || current.narrative?.automationPreferences !== prefs ||
          computeSnapshotDigest(current.snapshot) !== analysisSnapshotDigest ||
          autoAnalysisCallCount.current >= prefs.maxCallsPerSession ||
          aiTicketAuthorityRef.current.isActionLoading(projectId, 'diagnostics')) return;
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

      const payload = {
        projectId: current.id,
        baseRevision: current.revision,
        scope: prefs.scope,
        entities,
        relationships,
        storyBible,
        sections,
      };
      const budget = buildClientBudgetDisclosure('diagnostics', 'Automatic semantic check', payload);
      if (!budget.withinLimit || budget.estimatedInputTokens > prefs.maxTokensPerRun) return;
      autoAnalysisCallCount.current += 1;
      setAutoAnalysisCallsUsed(autoAnalysisCallCount.current);
      void runSemanticDiagnostics(payload, {
        manuscriptVersionId: current.snapshot.manuscriptVersionId,
        snapshotDigest: analysisSnapshotDigest,
        scopeLabel: `Auto (${prefs.scope})`,
      }, lifetime.signal, prefs).catch(() => {
        // Manual diagnostics remain available if a background check fails.
      });
    }, 3500);

    return () => {
      window.clearTimeout(timer);
      lifetime.abort();
    };
  }, [aiConfigured, activeProject.id, analysisSnapshotDigest, activeProject.narrative?.automationPreferences, hydrationGate, runSemanticDiagnostics]);

  useEffect(() => {
    if (isDarkMode) {
      document.documentElement.classList.add('dark');
      document.body.style.backgroundColor = '#1b191c';
    } else {
      document.documentElement.classList.remove('dark');
      document.body.style.backgroundColor = '#f8f7f3';
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

  const commitPreparedNarrative = async (
    origin: CreativeProject,
    prepared: { project: CreativeProject; undoState: UndoRedoState },
    message: string,
    intentId?: string,
  ) => {
    if (!sameProjectVersion(activeProjectRef.current, origin) || getDeletedProjectIds().has(origin.id)) {
      throw new Error('The project changed while preparing this operation. Review the latest version and retry.');
    }
    if (activeProjectRef.current.persistedRevision !== origin.revision) {
      const savedBase = await flushProjectDurably(origin, { expectedPersistedRevision: origin.persistedRevision });
      if (!savedBase.saved) throw new Error(savedBase.error ?? 'The prior project version could not be saved.');
      if (!sameProjectVersion(activeProjectRef.current, origin)) {
        throw new Error('The project changed while saving the prior version. Review the latest version and retry.');
      }
    }

    const result = await flushProjectDurably(prepared.project, {
      expectedPersistedRevision: origin.revision,
      expectedManuscriptVersionId: origin.snapshot.manuscriptVersionId ?? '',
      expectedBaseSnapshotDigest: computeSnapshotDigest(origin.snapshot),
      expectedBaseNarrative: origin.narrative ?? null,
      requireExactBase: true,
      intentId,
      clearConflictOnSuccess: true,
    });
    if (!result.saved) throw new Error(result.error ?? 'The change could not be durably saved.');
    const committed = result.storedProject ?? {
      ...prepared.project, persistedRevision: result.persistedRevision ?? prepared.project.revision,
    };
    if (!sameProjectVersion(activeProjectRef.current, origin) ||
        !sameProjectVersion(committed, prepared.project) || getDeletedProjectIds().has(origin.id)) {
      return { published: false, message: `Saved to "${origin.name}". The current working copy was preserved.` };
    }
    activeProjectRef.current = committed;
    undoStateRef.current = prepared.undoState;
    hasLocalEditsSinceMountRef.current = true;
    setProject(committed);
    setUndoState(prepared.undoState);
    if (message) setStatusNotification(message);
    return { published: true, message };
  };

  const saveManuscript = async (base: NarrativeBase, sections: ManuscriptSection[], artifact?: ArtifactAnchor, styleProfile?: StyleProfile) => {
    if (getHydrationGate() !== 'ready' || !window.indexedDB) {
      throw new Error('IndexedDB must be available and the workspace must finish loading.');
    }
    const before = activeProjectRef.current;
    if (aiTicketAuthorityRef.current?.hasProjectTickets(before.id, 'diagnostics')) {
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
    const saved = await commitPreparedNarrative(before, prepared, '');
    if (!saved.published) throw new Error(saved.message);
  };

  const handleCreateImportedProject = async (candidate: CreativeProject) => {
    if (creatingImportedProjectRef.current) throw new Error('Project creation is already in progress.');
    creatingImportedProjectRef.current = true;
    try {
      if (getHydrationGate() !== 'ready' || !window.indexedDB) {
        throw new Error('The project workspace must finish loading and IndexedDB must be available before import can be saved.');
      }
      if (!allowNavigation()) throw new Error('Save or export the open manuscript draft before creating an imported project.');
      if (savedProjectsRef.current.some(project => project.id === candidate.id) || activeProjectRef.current.id === candidate.id) {
        throw new Error('This imported project identifier already exists. Reopen the review and retry creation.');
      }

      cancelAutosave();
      const previous = activeProjectRef.current;
      if (previous.persistedRevision !== previous.revision || previous.persistedRevision === undefined) {
        const previousSave = await flushProjectDurably(previous, {
          expectedPersistedRevision: previous.persistedRevision ?? previous.revision,
        });
        if (!previousSave.saved) {
          throw new Error(previousSave.error ?? 'The current project could not be saved before import. Existing projects were not changed.');
        }
      }
      if (!sameProjectVersion(activeProjectRef.current, previous)) {
        throw new Error('The current project changed while preparing the import. The reviewed project remains available.');
      }

      const result = await flushProjectDurably(candidate, { expectedBaseProject: null });
      if (!result.saved || result.authoritativeStore !== 'indexeddb') {
        throw new Error(result.error ?? 'The imported project could not be durably saved. Existing projects were not changed.');
      }
      const committed = result.storedProject ?? { ...candidate, persistedRevision: result.persistedRevision ?? candidate.revision };
      if (sameProjectVersion(activeProjectRef.current, previous) && !getDeletedProjectIds().has(committed.id)) {
        const nextUndo = createUndoRedoState(committed.snapshot, committed.revisions, committed.undoHistory);
        selectProject(committed, nextUndo);
        setStorageAlert(null);
        setWorkspaceMode('write');
      }
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
      if (getHydrationGate() !== 'ready') throw new Error('Wait for project storage to finish loading before saving an opportunity.');
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
      if (getHydrationGate() !== 'ready') throw new Error('Wait for project storage to finish loading before updating an opportunity.');
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
    const changed = stageNarrativeMetadata(next, 'Local consistency check', 'Updated tracked diagnostic findings.');
    setStatusNotification(changed ? 'Local findings updated and queued for saving.' : 'Local checks found no changes to tracked issues.');
  };

  const handleApplyDiagnosticFix = async (
    issueId: string,
    alternative: DiagnosticFixAlternative,
    expectedBaseRevision: number
  ): Promise<{ ok: boolean; message: string }> => {
    try {
      const before = activeProjectRef.current;
      const result = applyDiagnosticFixAlternative(before, undoStateRef.current, issueId, alternative, expectedBaseRevision);
      const note = result.issueResolved
        ? `${result.appliedSummary} Issue resolved after post-apply recheck.`
        : `${result.appliedSummary} Post-apply recheck kept residual issue open (${result.residualOpenCount} open).`;
      const saved = await commitPreparedNarrative(before, result, note, `fix_${before.id}_${issueId}_${alternative.id}_r${expectedBaseRevision}`);
      return { ok: true, message: saved.message };
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
      const saved = await commitPreparedNarrative(before, applied, applied.summary, `sync_model_${before.id}_${proposal.id}_r${expectedBaseRevision}`);
      return { ok: true, message: saved.message };
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
      const saved = await commitPreparedNarrative(before, applied, applied.summary, `sync_ms_${before.id}_${patch.id}_r${expectedBaseRevision}`);
      return { ok: true, message: saved.message };
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
    stageNarrativeMetadata(next, 'Keep writing alternative', alt.label);
    setStatusNotification(`Queued "${alt.label}" for saving as an alternative.`);
  };

  const handleSendOpportunityToReview = (proposal: OpportunityProposal) => {
    setWorkspaceMode('plan');
    setIsReviewModalOpen(true);
    setStatusNotification(`Opened Change Review for idea: "${proposal.description.slice(0, 70)}". Apply changes explicitly via Decision Inbox or Batch Edit.`);
  };

  const handleUpdateAutomationPreferences = (prefs: NonNullable<NarrativeRecords['automationPreferences']>) => {
    const ensured = ensureNarrativeEnvelope(activeProjectRef.current);
    const current = ensured.narrative?.automationPreferences;
    if (current && current.semanticAutoAnalysisEnabled === prefs.semanticAutoAnalysisEnabled &&
        current.scope === prefs.scope && current.maxCallsPerSession === prefs.maxCallsPerSession &&
        current.maxTokensPerRun === prefs.maxTokensPerRun && Boolean(current.paused) === Boolean(prefs.paused)) return;
    const next: CreativeProject = {
      ...ensured,
      narrative: {
        ...ensured.narrative!,
        automationPreferences: prefs,
      },
    };
    stageNarrativeMetadata(next, 'Update automation preferences', 'Changed bounded semantic auto-analysis preferences.');
    setStatusNotification('Semantic auto-analysis preferences queued for saving.');
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
    reviewedTarget: AppendTargetBase;
    incomingProject: CreativeProject;
    insertPosition: AppendInsertPosition;
    identityDecisions: Record<string, CrossProjectIdentityDecision>;
    allowDuplicateSource: boolean;
  }) => {
    if (getHydrationGate() !== 'ready') {
      throw new Error('IndexedDB must be available and workspace loading must finish before appending.');
    }
    const origin = activeProjectRef.current;
    const reviewed = params.reviewedTarget;
    const readTarget = () => activeProjectRef.current.id === reviewed.targetProjectId
      ? activeProjectRef.current
      : savedProjectsRef.current.find((project) => project.id === reviewed.targetProjectId);
    const target = readTarget();
    if (!target || getDeletedProjectIds().has(target.id) || !matchesAppendTarget(target, reviewed)) {
      throw new Error('The target project changed. Review the updated target before appending.');
    }
    if (target.persistedRevision !== target.revision) {
      throw new Error('Save the current target revision before appending.');
    }
    const applied = applyAppendToExistingProject({
      ...params,
      ...reviewed,
      targetProject: target,
    });
    await saveBackup(target, `Safety checkpoint before appending "${params.incomingProject.name}"`, true);
    const beforeCommit = readTarget();
    if (!beforeCommit || !sameProjectVersion(beforeCommit, target)) {
      throw new Error('The target project changed while preparing its backup. Review it again before appending.');
    }

    const saved = await flushProjectDurably(applied.candidateProject, {
      expectedPersistedRevision: reviewed.expectedBaseRevision,
      expectedManuscriptVersionId: reviewed.expectedManuscriptVersionId,
      expectedBaseSnapshotDigest: reviewed.expectedBaseSnapshotDigest,
      expectedBaseNarrative: target.narrative ?? null,
      requireExactBase: true,
      intentId: applied.intentId,
      clearConflictOnSuccess: true,
    });
    if (!saved.saved || saved.authoritativeStore !== 'indexeddb') {
      throw new Error(saved.error ?? 'Appended project could not be saved durably.');
    }
    const committed = saved.storedProject ?? {
      ...applied.candidateProject, persistedRevision: saved.persistedRevision ?? applied.candidateProject.revision,
    };
    const currentTarget = readTarget();
    if (sameProjectVersion(activeProjectRef.current, origin) && currentTarget &&
        (sameProjectVersion(currentTarget, target) || sameProjectVersion(currentTarget, committed)) &&
        sameProjectVersion(committed, applied.candidateProject) && !getDeletedProjectIds().has(committed.id)) {
      selectProject(committed, createUndoRedoState(committed.snapshot, committed.revisions, committed.undoHistory));
      setWorkspaceMode('write');
    }
    setStatusNotification(
      `Appended ${applied.addedSectionCount} section(s) into "${committed.name}" (${applied.addedEntityCount} new, ${applied.linkedEntityCount} linked entities).`
    );
  };

  const handleRestoreArchiveProjects = async (
    restoredProjects: CreativeProject[]
  ): Promise<ArchiveRestoreSequenceResult<CreativeProject>> => {
    if (!canWriteWorkspace()) return {
      ok: false, count: 0, remainingProjects: restoredProjects,
      error: 'Wait for workspace storage to finish loading before restoring.',
    };
    const result = await restoreArchiveProjectsSequentially(restoredProjects, async (candidate) => {
      const res = await flushProjectDurably(candidate, { expectedBaseProject: null });
      if (!res.saved) throw new Error(res.error ?? `Could not restore "${candidate.name}".`);
    });
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
      publishCurrentProject(nextProj, nextUndo);
    },
    [publishCurrentProject]
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
  ): Promise<BatchEditProposalResult | null> => {
    const targetProject = activeProjectRef.current;
    const authority = aiTicketAuthorityRef.current;
    const { ticket, signal } = authority.beginSlot(targetProject, 'batch');
    const current = () => authority.isCurrent(ticket) && sameProjectVersion(activeProjectRef.current, targetProject);
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
      authority.clearIfCurrent(ticket);
      return localResult;
    }

    const promptDecision = resolveProviderPrompt(targetProject, targetProject.snapshot.mode);
    if (!promptDecision.ok) {
      authority.clearIfCurrent(ticket);
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
      if (!current()) return null;
      if (aiResult.operations.length > 0 || aiResult.ambiguities.length > 0) {
        return {
          ...aiResult,
          baseProjectId: targetProject.id,
          baseRevision: targetProject.revision,
        };
      }
      return localResult;
    } catch {
      return current() ? localResult : null;
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

        acceptReadStatus(latest.idbStatus);

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
    if (!canWriteWorkspace()) {
      setStatusNotification('Wait for workspace storage to finish loading before creating a project.');
      return;
    }
    cancelAutosave();
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
    draftDirtyRef.current = false;
    setManuscriptDraftDirty(false);
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
    setSelectedEntityId(null);
    setSelectedRelationshipId(null);
    setStoryBibleErrors({});
    if (getHydrationGate() !== 'blocked-read-error') {
      setStorageAlert(null);
    }

    if (switchRes.projectToFlush && canWriteWorkspace()) {
      void flushProjectDurably(switchRes.projectToFlush, {
        expectedPersistedRevision: switchRes.projectToFlush.persistedRevision,
      });
    }
  };

  const handleCreateNewProject = async (name: string, initialPrompt: string): Promise<boolean> => {
    if (!allowNavigation()) return false;
    if (!canWriteWorkspace()) {
      setStatusNotification('Wait for workspace storage to finish loading before creating a project.');
      return false;
    }
    setCreateProjectPending(true);
    try {
      cancelAutosave();
      const outgoing = activeProjectRef.current;
      if (outgoing.persistedRevision !== outgoing.revision || outgoing.persistedRevision === undefined) {
        const outgoingSave = await flushProjectDurably(outgoing, { expectedPersistedRevision: outgoing.persistedRevision });
        if (!outgoingSave.saved || outgoingSave.authoritativeStore !== 'indexeddb') {
          setStatusNotification(outgoingSave.error ?? 'The current project could not be saved. The new project was not created.');
          return false;
        }
      }
      if (!sameProjectVersion(activeProjectRef.current, outgoing)) {
        setStatusNotification('The current project changed while preparing the new one. No project was created.');
        return false;
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
        revisions: [{
          id: makeStableId('rev'),
          revisionNumber: 1,
          timestamp: now,
          label: 'Created Project',
          summary: `Created project "${name}"`,
          changeCount: 0,
          snapshot: structuredClone(newSnap),
        }],
      };
      const result = await flushProjectDurably(newProj, { expectedBaseProject: null });
      if (!result.saved || result.authoritativeStore !== 'indexeddb') {
        setStatusNotification(result.error ?? 'The new project could not be saved. Your current workspace is still open.');
        return false;
      }
      const committed = result.storedProject ?? { ...newProj, persistedRevision: result.persistedRevision ?? newProj.revision };
      if (!sameProjectVersion(activeProjectRef.current, outgoing) || getDeletedProjectIds().has(committed.id)) {
        setStatusNotification(`Created and saved "${committed.name}". The current workspace remains open.`);
        return true;
      }

      const newUndo = createUndoRedoState(committed.snapshot, committed.revisions, committed.undoHistory);
      const nextSaved = upsertProjectInSavedList(savedProjectsRef.current, committed);
      savedProjectsRef.current = nextSaved;
      activeProjectRef.current = committed;
      undoStateRef.current = newUndo;
      hasLocalEditsSinceMountRef.current = false;
      setSavedProjects(nextSaved);
      setProject(committed);
      setUndoState(newUndo);
      draftDirtyRef.current = false;
      setManuscriptDraftDirty(false);
      setSelectedEntityId(null);
      setSelectedRelationshipId(null);
      setStoryBibleErrors({});
      setStorageAlert(null);
      setCachedProjectSelection(committed.id);
      setWorkspaceMode('write');
      setCreateProjectOpen(false);
      setStatusNotification(`Created and saved "${committed.name}".`);
      return true;
    } catch (error) {
      setStatusNotification(error instanceof Error ? error.message : 'The project could not be created. Your current workspace is still open.');
      return false;
    } finally {
      setCreateProjectPending(false);
    }
  };

  const handleDeleteProject = (projectId: string) => {
    if (!allowNavigation()) return;
    if (activeProjectRef.current.id === projectId) cancelAutosave();
    saveQueueRef.current.resetProject(projectId);

    // Abort and invalidate all in-flight operations for the deleted project via single authority (F-06 / IA-11 / R0-B)
    aiTicketAuthorityRef.current?.invalidateProject(projectId);

    void deleteProjectCompletely(projectId).then((delRes) => {
      const deleted = getDeletedProjectIds();
      const nextSaved = savedProjectsRef.current.filter((project) => !deleted.has(project.id));
      for (const survivor of delRes.remaining) {
        if (!deleted.has(survivor.id) && !nextSaved.some((project) => project.id === survivor.id)) nextSaved.push(survivor);
      }
      savedProjectsRef.current = nextSaved;
      setSavedProjects(nextSaved);
      if (activeProjectRef.current.id === projectId && nextSaved.length > 0) {
        const replacement = nextSaved[0];
        selectProject(replacement, createUndoRedoState(replacement.snapshot, replacement.revisions, replacement.undoHistory));
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
    if (getHydrationGate() === 'blocked-read-error' || getHydrationGate() === 'pending') {
      return { ok: false, error: 'Wait for workspace storage to finish loading before restoring.' };
    }
    const outgoing = activeProjectRef.current;
    restorePendingRef.current = true;
    setRestorePending(true);
    try {
      const legacyOrPortable = await parseProjectBackup(rawJson);
      if (aiTicketAuthorityRef.current?.hasProjectTickets(outgoing.id, 'diagnostics')) {
        throw new Error('Wait for the current project operation to finish before restoring.');
      }
      const migrated = replace ? prepareBackupReplacement(outgoing, legacyOrPortable) : prepareBackupCopy(legacyOrPortable);
      const transition = prepareProjectSwitch({
        currentProject: outgoing, savedProjects: savedProjectsRef.current, targetProjectId: migrated.id,
      });
      if (replace) {
        if (getHydrationGate() !== 'ready' || outgoing.persistedRevision !== outgoing.revision) {
          throw new Error('A durable current revision is required before replacement.');
        }
        await saveBackup(outgoing, 'Before replacing project from backup', true);
      } else if (transition.projectToFlush) {
        const flushed = await flushProjectDurably(transition.projectToFlush);
        if (!flushed.saved) throw new Error(flushed.error ?? 'Save the current project before restoring.');
      }
      if (!sameProjectVersion(activeProjectRef.current, outgoing)) {
        throw new Error('The current project changed while preparing the restore.');
      }
      const result = await flushProjectDurably(migrated, replace ? {
        expectedPersistedRevision: outgoing.revision,
        expectedManuscriptVersionId: outgoing.snapshot.manuscriptVersionId ?? '',
        expectedBaseSnapshotDigest: computeSnapshotDigest(outgoing.snapshot),
        expectedBaseNarrative: outgoing.narrative ?? null,
        requireExactBase: true,
      } : { expectedBaseProject: null });
      if (!result.saved) throw new Error(result.error ?? 'The restored project could not be saved.');
      const saved = result.storedProject ?? { ...migrated, persistedRevision: result.persistedRevision ?? migrated.revision };
      if (!sameProjectVersion(activeProjectRef.current, outgoing) || getDeletedProjectIds().has(saved.id)) {
        setStatusNotification(`Restored "${saved.name}". The current working copy was preserved.`);
        return { ok: true };
      }
      const migratedUndo = createUndoRedoState(saved.snapshot, saved.revisions, saved.undoHistory);
      const latestSaved = replace ? savedProjectsRef.current
        : upsertProjectInSavedList(savedProjectsRef.current, activeProjectRef.current);
      const nextSaved = upsertProjectInSavedList(latestSaved, saved);
      savedProjectsRef.current = nextSaved;
      setSavedProjects(nextSaved);
      selectProject(saved, migratedUndo);
      if (!replace) setWorkspaceMode('write');
      setSelectedEntityId(null);
      setSelectedRelationshipId(null);
      setStoryBibleErrors({});
      setStatusNotification(`Restored and saved project ${replace ? '' : 'copy '}“${saved.name}”.`);
      return { ok: true };
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : 'Invalid project JSON file.' };
    } finally {
      restorePendingRef.current = false;
      setRestorePending(false);
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

  const savePresentation = getSavePresentation({
    restoring: restorePending,
    draftDirty: manuscriptDraftDirty,
    savePending: pendingDurableSaveProjectIds.has(activeProject.id) || createProjectPending,
    projectPersisted: activeProject.persistedRevision === activeProject.revision,
    storageState: storageAlert?.projectId === activeProject.id
      ? storageAlert.type === 'conflict' ? 'conflict' : 'failed'
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
        onNewProject={() => { if (allowNavigation()) setCreateProjectOpen(true); }}
        onOpenImport={() => { if (allowNavigation()) setWorkspaceMode('import'); }}
        importDisabled={!hydrationSettled}
        onOpenProjects={() => { if (allowNavigation()) setWorkspaceMode('projects'); }}
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
        onExportBackupJson={handleExportJson}
        onDismissStorageAlert={() => setStorageAlert(null)}
        onDismissStatusNotification={() => setStatusNotification(null)}
      />

      <nav aria-label="Narrative workspace" className="flex flex-wrap items-center gap-1 border-b border-pcc-line bg-pcc-surface px-3 py-2 dark:border-pcc-dark-line dark:bg-pcc-dark-surface sm:px-5">
        <div className="inline-flex rounded-lg border border-pcc-line bg-pcc-canvas p-0.5 dark:border-pcc-dark-line dark:bg-pcc-dark-canvas" role="group" aria-label="Workspace mode">
          {([['write', 'Write'], ['plan', 'Plan'], ['review', 'Review']] as const).map(([mode, label]) => (
            <button type="button" key={mode} aria-current={workspaceMode === mode ? 'page' : undefined}
              className="min-h-11 rounded-md px-3 text-sm font-medium text-pcc-muted transition-colors hover:text-pcc-ink aria-[current=page]:bg-pcc-surface aria-[current=page]:text-pcc-action aria-[current=page]:shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-pcc-focus dark:text-pcc-dark-muted dark:hover:text-pcc-dark-ink dark:aria-[current=page]:bg-pcc-dark-surface dark:aria-[current=page]:text-pcc-dark-ink"
              onClick={() => { if (allowNavigation()) { setAdoptArtifactId(undefined); setWorkspaceMode(mode); } }}>{label}</button>
          ))}
        </div>
        <button type="button" className="min-h-11 rounded-md px-3 text-sm font-medium text-pcc-muted hover:bg-pcc-canvas focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-pcc-focus dark:text-pcc-dark-muted dark:hover:bg-pcc-dark-canvas" onClick={() => { if (allowNavigation()) setShowAiSettings(true); }} aria-haspopup="dialog">AI settings</button>
        <div className="ml-auto flex flex-wrap justify-end gap-1 sm:hidden">
          <button type="button" className="min-h-11 rounded-md bg-pcc-action px-2.5 text-xs font-semibold text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-pcc-focus" onClick={() => { if (allowNavigation()) setCreateProjectOpen(true); }}>New</button>
          <button type="button" disabled={!hydrationSettled} className="min-h-11 rounded-md px-2.5 text-xs font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-pcc-focus disabled:opacity-45" onClick={() => { if (allowNavigation()) setWorkspaceMode('import'); }}>Import</button>
          <button type="button" className="min-h-11 rounded-md px-2.5 text-xs font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-pcc-focus" onClick={() => { if (allowNavigation()) setWorkspaceMode('projects'); }}>Projects</button>
        </div>
      </nav>

      <div hidden={workspaceMode !== 'write'} className={workspaceMode === 'write' ? 'flex min-h-0 flex-1 flex-col' : undefined}>
        <ManuscriptEditor
          key={activeProject.id}
          project={activeProject}
          isActive={workspaceMode === 'write'}
          onSave={saveManuscript}
          initialArtifactId={adoptArtifactId}
          focusedSectionId={focusedSectionId}
          aiConfigured={aiConfigured}
          onSaveWritingAlternative={handleSaveWritingAlternative}
          onExportDraft={sections => downloadTextFile(safeFilename(activeProject.name, 'unsaved-draft', 'md'), manuscriptText(sections), 'text/markdown;charset=utf-8')}
          onDirty={dirty => { draftDirtyRef.current = dirty; setManuscriptDraftDirty(dirty); }}
          onCompositionChange={composing => { compositionPendingRef.current = composing; }}
          onUndo={handleUndo}
          onRedo={handleRedo}
          canUndo={undoState.past.length > 0}
          canRedo={undoState.future.length > 0}
          enabled={hydrationGate === 'ready' && typeof window !== 'undefined' && Boolean(window.indexedDB)}
        />
      </div>
      {workspaceMode === 'review' && (
        <NarrativeReview
          key={activeProject.id}
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
          onRunSemanticDiagnostics={runSemanticDiagnostics}
          onApplyDiagnosticFix={handleApplyDiagnosticFix}
          onNavigateTarget={handleNavigateConsistencyTarget}
          onApplyModelSyncProposal={handleApplyModelSyncProposal}
          onApplyManuscriptSyncPatch={handleApplyManuscriptSyncPatch}
          onRecordSyncCheckpoint={handleRecordSyncCheckpoint}
          onUpdateAutomationPreferences={handleUpdateAutomationPreferences}
          autoAnalysisCallsUsed={autoAnalysisCallsUsed}
          resumeProposalReview={resumedProposalReview?.projectId === activeProject.id ? resumedProposalReview : undefined}
          onClearResumedProposalReview={() => setResumedProposalReview(undefined)}
          onReturnToWriting={(target, review) => {
            if (!allowNavigation()) return;
            setResumedProposalReview(review?.projectId === activeProject.id ? review : undefined);
            if (target?.sectionId && manuscriptSections(activeProject).some(section => section.id === target.sectionId)) {
              setFocusedSectionId(target.sectionId);
            }
            setWorkspaceMode('write');
          }}
        />
      )}
      {workspaceMode === 'import' && (
        <ImportWorkflow
          existingProjects={savedProjects}
          activeProjectId={activeProject.id}
          aiConfigured={aiConfigured}
          onCreateProject={handleCreateImportedProject}
          onAppendToExistingProject={handleAppendToExistingProject}
          onCancelImport={() => setWorkspaceMode(lastStableWorkspaceModeRef.current)}
        />
      )}
      {workspaceMode === 'projects' && (
        <ProjectHub
          key={activeProject.id}
          project={activeProject}
          savedProjects={savedProjects}
          onResumeWorkspace={() => {
            if (allowNavigation()) setWorkspaceMode(lastStableWorkspaceModeRef.current);
          }}
          onOpenProject={projectId => {
            if (!allowNavigation()) return;
            handleSwitchProject(projectId);
            setWorkspaceMode('write');
          }}
          onCreateNewProject={handleCreateNewProject}
          historyContent={(
            <HistoryPanel
              project={activeProject}
              savedProjects={savedProjects}
              historyTarget={historyTarget}
              contentExports={contentExports.map(({ id, label }) => ({ id, label }))}
              onExportJson={handleExportJson}
              onExportStoryBibleMarkdown={handleExportStoryBibleMarkdown}
              onExportPromptText={handleExportPromptText}
              onExportManuscript={snapshot.manuscriptVersionId ? exportManuscript : undefined}
              onExportManuscriptDocx={manuscriptSections(activeProject).length > 0 ? exportManuscriptDocx : undefined}
              onExportManuscriptText={manuscriptSections(activeProject).length > 0 ? exportManuscriptText : undefined}
              onExportContent={exportContent}
              onExportContentBundle={exportContentBundle}
              onPreviewProjectJson={parseProjectBackup}
              onImportProjectJson={handleImportProjectJson}
              onSwitchProject={handleSwitchProject}
              onCreateNewProject={handleCreateNewProject}
              onDeleteProject={handleDeleteProject}
              onRestoreRevision={handleRestoreRevision}
            />
          )}
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
          onSelectEntity={entity => {
            setSelectedEntityId(entity.id ?? entity.name);
            setSelectedRelationshipId(null);
          }}
          onSelectRelationship={relationship => {
            setSelectedRelationshipId(relationship.id ?? null);
            setSelectedEntityId(null);
          }}
          onOpenInspectorTab={(tab: PlanInspectorDestination) => {
            setRightPanelTab(tab);
            setMobileTab('inspector');
          }}
          outputExpanded={showOutputDrawer}
          onToggleOutput={() => setShowOutputDrawer(value => !value)}
          decisionInbox={(
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
          )}
          graphControls={(
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
          )}
          graphCanvas={(
            <div className="flex h-full min-h-0 flex-col gap-2.5 p-2.5 sm:p-3">
              <div className="flex min-h-0 flex-1 flex-col">
                <BeliefGraph
                  data={{ prompt: snapshot.originalIdea, entities: snapshot.entities, relationships: snapshot.relationships }}
                  isLoading={isGraphLoading}
                  error={analysisError}
                  selectedEntity={selectedEntity}
                  selectedRelationship={selectedRelationship}
                  onSelectEntity={entity => {
                    setSelectedEntityId(entity ? (entity.id ?? entity.name) : null);
                    if (entity) { setSelectedRelationshipId(null); setRightPanelTab('inspector'); }
                  }}
                  onSelectRelationship={(relationship: Relationship | null) => {
                    setSelectedRelationshipId(relationship?.id ?? null);
                    if (relationship) { setSelectedEntityId(null); setRightPanelTab('inspector'); }
                  }}
                  onRelationshipChange={handleUpsertRelationship}
                  onAttributeChange={handleAttributeChange}
                  onOpenChecks={() => { setRightPanelTab('consistency'); setMobileTab('inspector'); }}
                  currentPrompt={snapshot.originalIdea}
                  consistencyIssues={consistencyIssues}
                  relationshipProjection={relationshipProjection}
                />
              </div>
            </div>
          )}
          generatedOutput={(
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
          )}
          contextualInspector={(
            <ContextualInspector
              activeTab={rightPanelTab}
              historyTarget={historyTarget}
              onSelectTab={setRightPanelTab}
              project={activeProject}
              savedProjects={savedProjects}
              selectedEntity={selectedEntity}
              selectedRelationship={selectedRelationship}
              onSelectEntity={entity => {
                setSelectedEntityId(entity ? (entity.id ?? entity.name) : null);
                if (entity) setSelectedRelationshipId(null);
              }}
              onSelectRelationship={relationship => {
                setSelectedRelationshipId(relationship?.id ?? null);
                if (relationship) setSelectedEntityId(null);
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
              onOpenReviewDiagnostics={() => { if (allowNavigation()) setWorkspaceMode('review'); }}
              onJumpToSection={sectionId => {
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
          )}
        />

        <nav aria-label="Mobile workspace panels" className="shrink-0 border-t border-pcc-line bg-pcc-surface px-2 py-1.5 dark:border-pcc-dark-line dark:bg-pcc-dark-surface xl:hidden">
          <div className="grid grid-cols-4 gap-1">
            {([['decisions', `Inbox (${pendingDecisionCount})`], ['graph', 'Belief Graph'], ['inspector', 'Inspector'], ['output', 'Output']] as const).map(([tabKey, label]) => (
              <button key={tabKey} type="button" onClick={() => setMobileTab(tabKey)} aria-current={mobileTab === tabKey ? 'page' : undefined}
                className={`min-h-11 rounded-md px-1 text-center text-xs font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-pcc-focus ${mobileTab === tabKey ? 'bg-pcc-canvas text-pcc-action dark:bg-pcc-dark-canvas dark:text-pcc-dark-ink' : 'text-pcc-muted dark:text-pcc-dark-muted'}`}>
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
          onToggleOutputDrawer={() => setShowOutputDrawer(value => !value)}
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
        onApplyDecisions={handleApplyDecisions}
        onRestoreRevision={handleRestoreRevision}
        onOpenStoryBible={() => setRightPanelTab('story-bible')}
      />

      <InfoModal isOpen={showInfoModal} onClose={() => setShowInfoModal(false)} />
      {showAiSettings && <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-2 sm:p-6" onMouseDown={(event) => { if (event.target === event.currentTarget) setShowAiSettings(false); }}>
        <section role="dialog" aria-modal="true" aria-labelledby="ai-settings-title" className="max-h-[92vh] w-full max-w-3xl overflow-y-auto rounded-xl border border-pcc-line bg-pcc-surface p-4 text-pcc-ink shadow-xl dark:border-pcc-dark-line dark:bg-pcc-dark-surface dark:text-pcc-dark-ink sm:p-6">
          <header className="mb-4 flex items-center justify-between gap-3">
            <h2 id="ai-settings-title" className="font-display text-lg font-bold">AI settings</h2>
            <button type="button" className="min-h-11 rounded-md px-3 text-sm font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-pcc-focus" onClick={() => setShowAiSettings(false)}>Close</button>
          </header>
          <AiConnectionsPanel />
        </section>
      </div>}
    </div>
  );
}

export default App;
