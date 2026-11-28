/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { useCallback, useEffect, useMemo, useRef } from 'react';
import type { StorageConflictAlert } from '../../components/workspace/StorageAlertBanner';
import type {
  AppendInsertPosition,
  AppendTargetBase,
  CrossProjectIdentityDecision,
} from '../narrative/import/appendApply';
import type { StyleProfile } from '../narrative/context/styleProfile';
import type {
  DiagnosticFixAlternative,
  DiagnosticsAnalyzeRequest,
  SyncManuscriptPatch,
  SyncModelProposal,
  WritingAssistAction,
} from '../../shared/narrativeAiSchemas';
import type {
  ArtifactAnchor,
  ManuscriptSection,
  NarrativeRecords,
  OpportunityProposal,
} from '../../shared/narrativeTypes';
import type { CreativeProject } from '../../shared/types';
import { buildClientBudgetDisclosure } from '../narrative/aiBudgetClient';
import {
  applyDiagnosticFixAlternative,
  collectLocalDiagnosticFindings,
  convertSemanticFindingsToDiagnosticFindings,
  ensureNarrativeEnvelope,
  syncDiagnosticFindingsIntoProject,
} from '../narrative/diagnostics/engine';
import { transitionIssue } from '../narrative/issueRegistry';
import { manuscriptSections, prepareManuscriptChange, type NarrativeBase } from '../narrative/manuscriptModel';
import { buildScopedDiagnosticPlan } from '../narrative/review/scopedContextBuilder';
import {
  createOpportunityProposal,
  transitionOpportunityProposal,
  type OpportunityProposalInput,
  type OpportunityProposalStatus,
} from '../narrative/opportunityProposals';
import { listBackups, saveBackup } from '../narrative/recovery';
import {
  applyManuscriptSyncPatch,
  applyModelSyncProposal,
  recordSyncReviewCheckpoint,
} from '../narrative/sync/syncProposals';
import { makeStableId } from '../canonicalModel';
import { computeSnapshotDigest, createUndoRedoState, recordProjectRevision, type UndoRedoState } from '../historyEngine';
import type { AiTicketAuthority, SerializedSaveOptions } from '../projectController';
import { getDeletedProjectIds, type StorageSaveResult } from '../storageEngine';
import { ClientApiError, requestSemanticDiagnostics } from '../../services/apiClient';
import { sameProjectVersion, type HydrationWriteGate } from './projectListSync';

export const AUTO_BACKUP_PREF_KEY = 'pcc_auto_backup_pref_v1';

type AutomationPrefs = NonNullable<NarrativeRecords['automationPreferences']>;

function getReadableErrorMessage(error: unknown, fallback: string): string {
  if (error instanceof ClientApiError) return error.message;
  if (error instanceof Error && error.message) return error.message;
  return fallback;
}

function requiredBatchText(value: string, field: string): string {
  const trimmed = value.trim();
  if (!trimmed) throw new Error(`${field} is required.`);
  return trimmed;
}

export function createOpportunityBatchInProject(
  project: CreativeProject,
  inputs: OpportunityProposalInput[],
  expectedRevision: number
): CreativeProject {
  if (project.revision !== expectedRevision) {
    throw new Error('The project changed. Refresh before saving these opportunities.');
  }
  if (inputs.length === 0) return project;

  const now = Date.now();
  const baseRecords = project.narrative ?? {
    versions: [],
    sectionVersions: [],
    sources: [],
    claims: [],
    issues: [],
    audit: [],
  };

  const proposals: OpportunityProposal[] = inputs.map((input, idx) => ({
    id: crypto.randomUUID(),
    projectId: project.id,
    baseRevision: expectedRevision,
    lifecycleRevision: expectedRevision + 1,
    description: requiredBatchText(input.description, 'Description'),
    sourceRefs: [...new Set(input.sourceRefs.map((ref) => ref.trim()).filter(Boolean))],
    rationale: requiredBatchText(input.rationale, 'Rationale'),
    benefit: requiredBatchText(input.benefit, 'Benefit'),
    tradeOff: requiredBatchText(input.tradeOff, 'Trade-off'),
    assumptions: input.assumptions.map((item) => item.trim()).filter(Boolean),
    status: 'pending',
    ...(input.origin ? { origin: input.origin } : { origin: 'user' as const }),
    ...(input.category ? { category: input.category } : {}),
    ...(input.targetKind ? { targetKind: input.targetKind } : {}),
    ...(input.targetId ? { targetId: input.targetId } : {}),
    ...(input.options?.length ? { options: input.options } : {}),
    createdAt: now + idx,
    updatedAt: now + idx,
  }));

  const existing = baseRecords.opportunities ?? [];
  const next = recordProjectRevision(
    {
      ...project,
      schemaVersion: 4,
      narrative: { ...baseRecords, opportunities: [...existing, ...proposals] },
    },
    `Save ${proposals.length} creative opportunities`,
    proposals.map((p) => p.description).join('; ')
  );
  const committedProposals = proposals.map((p) => ({
    ...p,
    lifecycleRevision: next.revision,
  }));
  const nextNarrative = next.narrative ?? baseRecords;
  return {
    ...next,
    schemaVersion: 4,
    narrative: {
      ...nextNarrative,
      opportunities: [...existing, ...committedProposals],
    },
  };
}

function buildAutoAnalysisPayload(current: CreativeProject, scope: AutomationPrefs['scope']): DiagnosticsAnalyzeRequest {
  const plan = buildScopedDiagnosticPlan({
    project: current,
    sections: manuscriptSections(current),
    scope,
    maxSegmentChars: 12_000,
    maxSectionSliceChars: 4_000,
  });
  return plan.segments[0].payload;
}

function areAutomationPrefsEqual(current: AutomationPrefs | undefined, next: AutomationPrefs): boolean {
  if (!current) return false;
  return (
    current.semanticAutoAnalysisEnabled === next.semanticAutoAnalysisEnabled &&
    current.scope === next.scope &&
    current.maxCallsPerSession === next.maxCallsPerSession &&
    current.maxTokensPerRun === next.maxTokensPerRun &&
    Boolean(current.paused) === Boolean(next.paused)
  );
}

export interface UseNarrativeWorkflowActionsDeps {
  activeProject: CreativeProject;
  activeProjectRef: React.MutableRefObject<CreativeProject>;
  undoStateRef: React.MutableRefObject<UndoRedoState>;
  savedProjectsRef: React.MutableRefObject<CreativeProject[]>;
  hasLocalEditsSinceMountRef: React.MutableRefObject<boolean>;
  aiTicketAuthorityRef: React.MutableRefObject<AiTicketAuthority>;
  setProject: React.Dispatch<React.SetStateAction<CreativeProject>>;
  setUndoState: React.Dispatch<React.SetStateAction<UndoRedoState>>;
  setStatusNotification: (msg: string | null) => void;
  setStorageAlert: (alert: StorageConflictAlert | null) => void;
  storageAlert: StorageConflictAlert | null;
  setWorkspaceMode: (mode: 'write' | 'plan' | 'review' | 'projects' | 'import') => void;
  setIsReviewModalOpen: (open: boolean) => void;
  setAutoAnalysisCallsUsed: (count: number) => void;
  autoBackupEnabled: boolean;
  setAutoBackupEnabled: (enabled: boolean) => void;
  aiConfigured: boolean;
  hydrationGate: HydrationWriteGate;
  getHydrationGate: () => HydrationWriteGate;
  allowNavigation: () => boolean;
  cancelAutosave: () => void;
  selectProject: (current: CreativeProject, undo: UndoRedoState) => void;
  flushProjectDurably: (
    targetProject: CreativeProject,
    options?: SerializedSaveOptions & { clearConflictOnSuccess?: boolean; successNotification?: string }
  ) => Promise<StorageSaveResult>;
}

export function useNarrativeWorkflowActions(deps: UseNarrativeWorkflowActionsDeps) {
  const {
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
    aiConfigured,
    hydrationGate,
    getHydrationGate,
    allowNavigation,
    cancelAutosave,
    selectProject,
    flushProjectDurably,
  } = deps;

  const autoAnalysisCallCount = useRef(0);
  const lastAutoBackupRevisionRef = useRef<Record<string, number>>({});
  const pendingAutoBackups = useRef(new Set<string>());
  const creatingImportedProjectRef = useRef(false);

  useEffect(() => {
    if (!autoBackupEnabled || hydrationGate !== 'ready') return;
    if (activeProject.persistedRevision !== activeProject.revision) return;
    const { id, revision } = activeProject;
    const lastRev = lastAutoBackupRevisionRef.current[id] ?? 0;
    if (revision - lastRev < 5 || pendingAutoBackups.current.has(id)) return;
    pendingAutoBackups.current.add(id);
    let current = true;
    void saveBackup(activeProject, `Auto-backup at rev ${revision}`)
      .then(
        () => {
          lastAutoBackupRevisionRef.current[id] = revision;
        },
        (error) => {
          if (current && activeProjectRef.current.id === id) {
            setStatusNotification(
              getReadableErrorMessage(error, 'The automatic backup could not be verified. A manual backup is still available.')
            );
          }
        }
      )
      .finally(() => {
        pendingAutoBackups.current.delete(id);
      });
    return () => {
      current = false;
    };
  }, [autoBackupEnabled, hydrationGate, activeProject, activeProjectRef, setStatusNotification]);

  const stageNarrativeMetadata = useCallback(
    (next: CreativeProject, label: string, summary: string) => {
      if (next === activeProjectRef.current) return false;
      const revised = recordProjectRevision(next, label, summary);
      activeProjectRef.current = revised;
      hasLocalEditsSinceMountRef.current = true;
      setProject(revised);
      return true;
    },
    [activeProjectRef, hasLocalEditsSinceMountRef, setProject]
  );

  const runSemanticDiagnostics = useCallback(
    async (
      payload: DiagnosticsAnalyzeRequest,
      context: { manuscriptVersionId?: string; snapshotDigest: string; scopeLabel: string },
      lifetime: AbortSignal,
      preferences?: AutomationPrefs
    ) => {
      const matchesInput = () => {
        const current = activeProjectRef.current;
        if (lifetime.aborted || getDeletedProjectIds().has(payload.projectId)) return false;
        if (current.id !== payload.projectId || current.revision !== payload.baseRevision) return false;
        if (current.snapshot.manuscriptVersionId !== context.manuscriptVersionId) return false;
        if (computeSnapshotDigest(current.snapshot) !== context.snapshotDigest) return false;
        return !preferences || current.narrative?.automationPreferences === preferences;
      };
      if (!matchesInput()) return null;
      const authority = aiTicketAuthorityRef.current;
      const { ticket, signal } = authority.beginSlot(activeProjectRef.current, 'diagnostics');
      const cancel = () => authority.cancelIfCurrent(ticket);
      lifetime.addEventListener('abort', cancel, { once: true });
      try {
        const response = await requestSemanticDiagnostics(payload, signal);
        if (!authority.isCurrent(ticket) || !matchesInput()) return null;
        const currentSections = manuscriptSections(activeProjectRef.current);
        const mapped = convertSemanticFindingsToDiagnosticFindings(
          response.findings,
          activeProjectRef.current.id,
          `semantic:${payload.scope}`,
          currentSections,
          activeProjectRef.current.snapshot.manuscriptVersionId ?? 'working-manuscript'
        );
        const next = syncDiagnosticFindingsIntoProject(activeProjectRef.current, mapped, {
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
    },
    [activeProjectRef, aiTicketAuthorityRef, stageNarrativeMetadata]
  );

  const autoPrefs = activeProject.narrative?.automationPreferences;
  const shouldComputeAutoDigest = Boolean(
    aiConfigured && autoPrefs?.semanticAutoAnalysisEnabled && !autoPrefs.paused && hydrationGate === 'ready'
  );
  const analysisSnapshotDigest = useMemo(
    () => (shouldComputeAutoDigest ? computeSnapshotDigest(activeProject.snapshot) : ''),
    [shouldComputeAutoDigest, activeProject.snapshot]
  );

  useEffect(() => {
    const prefs = activeProject.narrative?.automationPreferences;
    if (!aiConfigured || !prefs?.semanticAutoAnalysisEnabled || prefs.paused) return;
    if (!hasLocalEditsSinceMountRef.current || hydrationGate !== 'ready') return;
    if (autoAnalysisCallCount.current >= (prefs.maxCallsPerSession ?? 4)) return;

    const lifetime = new AbortController();
    const projectId = activeProject.id;
    const timer = window.setTimeout(() => {
      const current = activeProjectRef.current;
      const stale =
        current.id !== projectId ||
        current.narrative?.automationPreferences !== prefs ||
        computeSnapshotDigest(current.snapshot) !== analysisSnapshotDigest;
      if (stale || autoAnalysisCallCount.current >= prefs.maxCallsPerSession) return;
      if (aiTicketAuthorityRef.current.isActionLoading(projectId, 'diagnostics')) return;

      const payload = buildAutoAnalysisPayload(current, prefs.scope);
      const budget = buildClientBudgetDisclosure('diagnostics', 'Automatic semantic check', payload);
      if (!budget.withinLimit || budget.estimatedInputTokens > prefs.maxTokensPerRun) return;
      autoAnalysisCallCount.current += 1;
      setAutoAnalysisCallsUsed(autoAnalysisCallCount.current);
      void runSemanticDiagnostics(
        payload,
        {
          manuscriptVersionId: current.snapshot.manuscriptVersionId,
          snapshotDigest: analysisSnapshotDigest,
          scopeLabel: `Auto (${prefs.scope})`,
        },
        lifetime.signal,
        prefs
      ).catch(() => {
        // Manual diagnostics remain available if a background check fails.
      });
    }, 3500);

    return () => {
      window.clearTimeout(timer);
      lifetime.abort();
    };
  }, [
    aiConfigured,
    activeProject.id,
    analysisSnapshotDigest,
    activeProject.narrative?.automationPreferences,
    hydrationGate,
    runSemanticDiagnostics,
    activeProjectRef,
    aiTicketAuthorityRef,
    hasLocalEditsSinceMountRef,
    setAutoAnalysisCallsUsed,
  ]);

  const commitPreparedNarrative = async (
    origin: CreativeProject,
    prepared: { project: CreativeProject; undoState: UndoRedoState },
    message: string,
    intentId?: string
  ) => {
    const isStillOrigin = () =>
      sameProjectVersion(activeProjectRef.current, origin) && !getDeletedProjectIds().has(origin.id);
    if (!isStillOrigin()) {
      throw new Error('The project changed while preparing this operation. Review the latest version and retry.');
    }
    if (activeProjectRef.current.persistedRevision !== origin.revision) {
      const savedBase = await flushProjectDurably(origin, { expectedPersistedRevision: origin.persistedRevision });
      if (!savedBase.saved) throw new Error(savedBase.error ?? 'The prior project version could not be saved.');
      if (!isStillOrigin()) {
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
      ...prepared.project,
      persistedRevision: result.persistedRevision ?? prepared.project.revision,
    };
    const matchesCommitted = sameProjectVersion(committed, prepared.project);
    if (!isStillOrigin() || !matchesCommitted) {
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

  const ensurePreviousProjectPersisted = async (previous: CreativeProject, errorMsg: string) => {
    if (previous.persistedRevision === previous.revision && previous.persistedRevision !== undefined) return;
    const saved = await flushProjectDurably(previous, {
      expectedPersistedRevision: previous.persistedRevision ?? previous.revision,
    });
    if (!saved.saved) throw new Error(saved.error ?? errorMsg);
  };

  const saveManuscript = async (
    base: NarrativeBase,
    sections: ManuscriptSection[],
    artifact?: ArtifactAnchor,
    styleProfile?: StyleProfile
  ) => {
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
      if (!backups.some((backup) => backup.pinned && backup.payload === JSON.stringify(before, null, 2))) {
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
      const duplicateId =
        savedProjectsRef.current.some((p) => p.id === candidate.id) || activeProjectRef.current.id === candidate.id;
      if (duplicateId) {
        throw new Error('This imported project identifier already exists. Reopen the review and retry creation.');
      }
      cancelAutosave();
      const previous = activeProjectRef.current;
      await ensurePreviousProjectPersisted(
        previous,
        'The current project could not be saved before import. Existing projects were not changed.'
      );
      if (!sameProjectVersion(activeProjectRef.current, previous)) {
        throw new Error('The current project changed while preparing the import. The reviewed project remains available.');
      }
      const result = await flushProjectDurably(candidate, { expectedBaseProject: null });
      if (!result.saved || result.authoritativeStore !== 'indexeddb') {
        throw new Error(result.error ?? 'The imported project could not be durably saved. Existing projects were not changed.');
      }
      const committed = result.storedProject ?? {
        ...candidate,
        persistedRevision: result.persistedRevision ?? candidate.revision,
      };
      if (sameProjectVersion(activeProjectRef.current, previous) && !getDeletedProjectIds().has(committed.id)) {
        selectProject(committed, createUndoRedoState(committed.snapshot, committed.revisions, committed.undoHistory));
        setStorageAlert(null);
        setWorkspaceMode('write');
      }
      setStatusNotification(`Imported project "${committed.name}" saved.`);
    } finally {
      creatingImportedProjectRef.current = false;
    }
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
    const { applyAppendToExistingProject, matchesAppendTarget } = await import('../narrative/import/appendApply');
    const origin = activeProjectRef.current;
    const reviewed = params.reviewedTarget;
    const readTarget = () =>
      activeProjectRef.current.id === reviewed.targetProjectId
        ? activeProjectRef.current
        : savedProjectsRef.current.find((p) => p.id === reviewed.targetProjectId);
    const target = readTarget();
    if (!target || getDeletedProjectIds().has(target.id) || !matchesAppendTarget(target, reviewed)) {
      throw new Error('The target project changed. Review the updated target before appending.');
    }
    if (target.persistedRevision !== target.revision) {
      throw new Error('Save the current target revision before appending.');
    }
    const applied = applyAppendToExistingProject({ ...params, ...reviewed, targetProject: target });
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
      ...applied.candidateProject,
      persistedRevision: saved.persistedRevision ?? applied.candidateProject.revision,
    };
    const currentTarget = readTarget();
    const targetStillValid =
      currentTarget && (sameProjectVersion(currentTarget, target) || sameProjectVersion(currentTarget, committed));
    if (
      sameProjectVersion(activeProjectRef.current, origin) &&
      targetStillValid &&
      sameProjectVersion(committed, applied.candidateProject) &&
      !getDeletedProjectIds().has(committed.id)
    ) {
      selectProject(committed, createUndoRedoState(committed.snapshot, committed.revisions, committed.undoHistory));
      setWorkspaceMode('write');
    }
    setStatusNotification(
      `Appended ${applied.addedSectionCount} section(s) into "${committed.name}" (${applied.addedEntityCount} new, ${applied.linkedEntityCount} linked entities).`
    );
  };

  const applyOpportunityChange = (
    verb: string,
    fallbackError: string,
    buildNext: (before: CreativeProject) => { next: CreativeProject; notice: string } | null
  ) => {
    try {
      if (getHydrationGate() !== 'ready') {
        throw new Error(`Wait for project storage to finish loading before ${verb}.`);
      }
      const before = activeProjectRef.current;
      if (storageAlert?.type === 'conflict' && storageAlert.projectId === before.id) {
        throw new Error(`Resolve the project storage conflict before ${verb}.`);
      }
      const outcome = buildNext(before);
      if (!outcome) return;
      activeProjectRef.current = outcome.next;
      hasLocalEditsSinceMountRef.current = true;
      setProject(outcome.next);
      setStatusNotification(outcome.notice);
    } catch (cause) {
      setStatusNotification(cause instanceof Error ? cause.message : fallbackError);
    }
  };

  const handleCreateOpportunity = (input: OpportunityProposalInput, expectedRevision: number) =>
    applyOpportunityChange('saving an opportunity', 'Could not save this opportunity.', (before) => ({
      next: createOpportunityProposal(before, expectedRevision, input),
      notice: 'Creative opportunity saved as a pending idea.',
    }));

  const handleCreateOpportunitiesBatch = (inputs: OpportunityProposalInput[], expectedRevision: number) =>
    applyOpportunityChange('saving opportunities', 'Could not save these opportunities.', (before) => {
      const next = createOpportunityBatchInProject(before, inputs, expectedRevision);
      return next === before
        ? null
        : { next, notice: `Saved ${inputs.length} creative opportunity suggestion(s).` };
    });

  const handleTransitionOpportunity = (
    id: string,
    status: OpportunityProposalStatus,
    expectedRevision: number
  ) =>
    applyOpportunityChange('updating an opportunity', 'Could not update this opportunity.', (before) => ({
      next: transitionOpportunityProposal(before, id, status, expectedRevision),
      notice:
        status === 'accepted'
          ? 'Opportunity accepted as an idea; no story content was changed.'
          : `Opportunity marked ${status}.`,
    }));

  const handleIssueDisposition = (
    issueId: string,
    disposition: NonNullable<CreativeProject['narrative']>['issues'][number]['disposition'],
    reason: string
  ) => {
    const before = activeProjectRef.current;
    const now = Date.now();
    const records = transitionIssue(before, issueId, disposition, reason, now, before.revision + 1);
    if (records === before.narrative) return;
    const revised = recordProjectRevision({ ...before, narrative: records }, `Issue ${disposition}`, reason.trim(), 1);
    const next: CreativeProject = {
      ...revised,
      narrative: {
        ...records,
        audit: [
          ...records.audit,
          {
            id: crypto.randomUUID(),
            action: 'issue',
            time: now,
            baseRevision: before.revision,
            resultRevision: revised.revision,
            reason: reason.trim(),
            issueId,
            issueDisposition: disposition,
          },
        ],
      },
    };
    activeProjectRef.current = next;
    hasLocalEditsSinceMountRef.current = true;
    setProject(next);
    setStatusNotification(`Issue marked ${disposition}.`);
  };

  const handleRunLocalDiagnostics = () => {
    const before = activeProjectRef.current;
    const localFindings = collectLocalDiagnosticFindings(before);
    const next = syncDiagnosticFindingsIntoProject(before, localFindings, {
      source: 'local',
      scopeLabel: 'Full local check',
      fullScan: true,
    });
    const changed = stageNarrativeMetadata(next, 'Local consistency check', 'Updated tracked diagnostic findings.');
    setStatusNotification(
      changed ? 'Local findings updated and queued for saving.' : 'Local checks found no changes to tracked issues.'
    );
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
      const saved = await commitPreparedNarrative(
        before,
        result,
        note,
        `fix_${before.id}_${issueId}_${alternative.id}_r${expectedBaseRevision}`
      );
      return { ok: true, message: saved.message };
    } catch (cause) {
      return { ok: false, message: cause instanceof Error ? cause.message : 'Fix could not be applied.' };
    }
  };

  const runSyncCommit = async (
    fallbackError: string,
    prepare: (before: CreativeProject) => {
      applied: { project: CreativeProject; undoState: UndoRedoState; summary: string };
      intentId: string;
    }
  ): Promise<{ ok: boolean; message: string }> => {
    try {
      const before = activeProjectRef.current;
      const { applied, intentId } = prepare(before);
      const saved = await commitPreparedNarrative(before, applied, applied.summary, intentId);
      return { ok: true, message: saved.message };
    } catch (cause) {
      return { ok: false, message: cause instanceof Error ? cause.message : fallbackError };
    }
  };

  const handleApplyModelSyncProposal = (proposal: SyncModelProposal, expectedBaseRevision: number) =>
    runSyncCommit('Sync model update failed.', (before) => ({
      applied: applyModelSyncProposal(before, undoStateRef.current, proposal, expectedBaseRevision),
      intentId: `sync_model_${before.id}_${proposal.id}_r${expectedBaseRevision}`,
    }));

  const handleApplyManuscriptSyncPatch = (
    patch: SyncManuscriptPatch,
    expectedBaseRevision: number,
    expectedManuscriptVersionId?: string
  ) =>
    runSyncCommit('Manuscript sync patch failed.', (before) => ({
      applied: applyManuscriptSyncPatch(
        before,
        undoStateRef.current,
        patch,
        expectedBaseRevision,
        expectedManuscriptVersionId
      ),
      intentId: `sync_ms_${before.id}_${patch.id}_r${expectedBaseRevision}`,
    }));

  const handleRecordSyncCheckpoint = (
    direction: 'manuscript-to-model' | 'model-to-manuscript',
    coverageNote: string
  ) => {
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
            createdAt: Date.now(),
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
    setStatusNotification(
      `Opened Change Review for idea: "${proposal.description.slice(0, 70)}". Apply changes explicitly via Decision Inbox or Batch Edit.`
    );
  };

  const handleUpdateAutomationPreferences = (prefs: AutomationPrefs) => {
    const ensured = ensureNarrativeEnvelope(activeProjectRef.current);
    if (areAutomationPrefsEqual(ensured.narrative?.automationPreferences, prefs)) return;
    const next: CreativeProject = {
      ...ensured,
      narrative: { ...ensured.narrative!, automationPreferences: prefs },
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
    setStatusNotification(
      enabled ? 'Opt-in browser auto-backup enabled while app is open.' : 'Opt-in browser auto-backup disabled.'
    );
  };

  return {
    stageNarrativeMetadata,
    runSemanticDiagnostics,
    saveManuscript,
    handleCreateImportedProject,
    handleAppendToExistingProject,
    handleIssueDisposition,
    handleCreateOpportunity,
    handleCreateOpportunitiesBatch,
    handleTransitionOpportunity,
    handleRunLocalDiagnostics,
    handleApplyDiagnosticFix,
    handleApplyModelSyncProposal,
    handleApplyManuscriptSyncPatch,
    handleRecordSyncCheckpoint,
    handleSaveWritingAlternative,
    handleSendOpportunityToReview,
    handleUpdateAutomationPreferences,
    handleToggleAutoBackup,
  };
}
