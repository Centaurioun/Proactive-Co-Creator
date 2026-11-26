/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { useCallback, useLayoutEffect, useRef } from 'react';
import type { PendingProposalReview } from '../../components/workspace/review/proposalReviewContext';
import type { StorageConflictAlert } from '../../components/workspace/StorageAlertBanner';
import type { ArchiveRestoreSequenceResult } from '../narrative/recovery/allProjectsArchive';
import type {
  CreativeProject,
  ProjectSnapshot,
  StoryBibleFields,
} from '../../shared/types';
import { createEmptyStoryBible, createSampleProject, makeStableId } from '../canonicalModel';
import { computeSnapshotDigest, createUndoRedoState, type UndoRedoState } from '../historyEngine';
import {
  createSerializedProjectSaveQueue,
  prepareProjectSwitch,
  reconcileAsyncSaveAcknowledgement,
  upsertProjectInSavedList,
  type SerializedSaveOptions,
} from '../projectController';
import { parseProjectBackup, prepareBackupCopy, prepareBackupReplacement, saveBackup } from '../narrative/recovery';
import {
  deleteProjectCompletely,
  getDeletedProjectIds,
  persistProjectDurably,
  reloadLatestProjectsFromStorage,
  setCachedProjectSelection,
  type IndexedDbLoadStatus,
  type StorageSaveResult,
} from '../storageEngine';
import { sameProjectVersion } from './projectListSync';
import type { HydrationWriteGate } from './projectListSync';

export interface SaveEpochRegistry {
  getEpoch: (projectId: string) => number;
  bumpEpoch: (projectId: string) => number;
  isCurrent: (projectId: string, capturedEpoch: number) => boolean;
}

export function createSaveEpochRegistry(): SaveEpochRegistry {
  const epochs = new Map<string, number>();
  return {
    getEpoch: (projectId) => epochs.get(projectId) ?? 0,
    bumpEpoch: (projectId) => {
      const next = (epochs.get(projectId) ?? 0) + 1;
      epochs.set(projectId, next);
      return next;
    },
    isCurrent: (projectId, capturedEpoch) => (epochs.get(projectId) ?? 0) === capturedEpoch,
  };
}

export interface TransientProjectUiSetters {
  setSelectedEntityId: (id: string | null) => void;
  setSelectedRelationshipId: (id: string | null) => void;
  setStoryBibleErrors: React.Dispatch<
    React.SetStateAction<Partial<Record<keyof StoryBibleFields, string>>>
  >;
  setAdoptArtifactId: (id: string | undefined) => void;
  setFocusedSectionId: (id: string | undefined) => void;
  setHistoryTarget: (target: { id: string; sequence: number } | null) => void;
  setResumedProposalReview: (review: PendingProposalReview | undefined) => void;
}

export function clearTransientProjectUiState(setters: TransientProjectUiSetters): void {
  setters.setSelectedEntityId(null);
  setters.setSelectedRelationshipId(null);
  setters.setStoryBibleErrors({});
  setters.setAdoptArtifactId(undefined);
  setters.setFocusedSectionId(undefined);
  setters.setHistoryTarget(null);
  setters.setResumedProposalReview(undefined);
}

export function resolvePostDeleteReplacement(params: {
  deletedProjectId: string;
  activeProjectId: string;
  remainingProjects: CreativeProject[];
}): CreativeProject {
  if (params.activeProjectId !== params.deletedProjectId) {
    return params.remainingProjects.find((p) => p.id === params.activeProjectId) ?? params.remainingProjects[0] ?? createSampleProject();
  }
  return params.remainingProjects[0] ?? createSampleProject();
}

export interface ReloadLatestParams {
  originProject: CreativeProject;
  originUndo: UndoRedoState;
  getActiveProject: () => CreativeProject;
  getActiveUndo: () => UndoRedoState;
  cancelAutosave: () => void;
  reloadLatest: () => Promise<Awaited<ReturnType<typeof reloadLatestProjectsFromStorage>>>;
  acceptReadStatus: (status: IndexedDbLoadStatus) => void;
  resetProjectQueue: (projectId: string) => void;
  publishSync: (project: CreativeProject, undo: UndoRedoState, saved: CreativeProject[]) => void;
  setHasLocalEdits: (edited: boolean) => void;
  setSavedProjects: (projects: CreativeProject[]) => void;
  setStorageAlert: (alert: StorageConflictAlert | null) => void;
  setStatusNotification: (msg: string | null) => void;
  resolution?: 'prefer-idb' | 'prefer-local';
}

export async function executeReloadLatestFromStorage(params: ReloadLatestParams): Promise<void> {
  const {
    originProject,
    originUndo,
    getActiveProject,
    getActiveUndo,
    cancelAutosave,
    reloadLatest,
    acceptReadStatus,
    resetProjectQueue,
    publishSync,
    setHasLocalEdits,
    setSavedProjects,
    setStorageAlert,
    setStatusNotification,
    resolution,
  } = params;
  const originId = originProject.id;
  const isCurrent = () => getActiveProject() === originProject && getActiveUndo() === originUndo;

  cancelAutosave();
  try {
    const latest = await reloadLatest();
    if (!isCurrent()) {
      setStorageAlert({
        type: 'conflict',
        projectId: getActiveProject().id,
        message: 'Newer in-memory edits were made while reloading from storage. Your in-memory edits were preserved.',
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
      const summarize = (p: CreativeProject) =>
        p.snapshot.storyBible.genre.value || p.snapshot.storyBible.setting.value || p.snapshot.originalIdea.slice(0, 40);
      setSavedProjects(latest.projects);
      setStorageAlert({
        type: 'conflict',
        projectId: latest.activeProject.id,
        conflictingProject: stored ?? undefined,
        message:
          latest.persistenceWarning ??
          `Conflicting versions detected at revision #${stored?.revision}: IndexedDB has "${stored ? summarize(stored) : ''}" while localStorage/memory has "${summarize(latest.activeProject)}". Both versions remain recoverable.`,
      });
      return;
    }

    resetProjectQueue(latest.activeProject.id);
    publishSync(latest.activeProject, latest.activeUndoState, latest.projects);
    setCachedProjectSelection(latest.activeProject.id);
    if (
      resolution === 'prefer-idb' ||
      latest.upgradedFromIndexedDb ||
      (resolution === 'prefer-local' && latest.persisted === true && !latest.activeProject.narrative)
    ) {
      setHasLocalEdits(false);
    }

    if (latest.persisted === false && latest.persistenceWarning) {
      setStorageAlert({
        type: 'error',
        projectId: latest.activeProject.id,
        message: `Reloaded revision #${latest.activeProject.revision} in memory, but storage synchronization reported: ${latest.persistenceWarning}`,
      });
    } else {
      setStorageAlert(null);
      setStatusNotification(`Reloaded revision #${latest.activeProject.revision} from storage.`);
    }
  } catch (error) {
    setStorageAlert({
      type: 'error',
      projectId: originId,
      message: error instanceof Error ? error.message : 'Could not reload latest project from storage.',
    });
  }
}

export interface UseDurableWorkspaceActionsDeps {
  activeProjectRef: React.MutableRefObject<CreativeProject>;
  undoStateRef: React.MutableRefObject<UndoRedoState>;
  savedProjectsRef: React.MutableRefObject<CreativeProject[]>;
  hasLocalEditsSinceMountRef: React.MutableRefObject<boolean>;
  draftDirtyRef: React.MutableRefObject<boolean>;
  restorePendingRef: React.MutableRefObject<boolean>;
  aiTicketAuthorityRef: React.MutableRefObject<{
    hasProjectTickets: (projectId: string, action?: 'analyze' | 'clarify' | 'batch' | 'generate' | 'polish' | 'diagnostics') => boolean;
    invalidateProject: (projectId: string) => void;
  }>;
  publishCurrentProject: (current: CreativeProject, undo: UndoRedoState) => void;
  setSavedProjects: React.Dispatch<React.SetStateAction<CreativeProject[]>>;
  setProject: React.Dispatch<React.SetStateAction<CreativeProject>>;
  setManuscriptDraftDirty: (dirty: boolean) => void;
  setRestorePending: (pending: boolean) => void;
  setCreateProjectPending: (pending: boolean) => void;
  setCreateProjectOpen: (open: boolean) => void;
  setPendingDurableSaveProjectIds: React.Dispatch<React.SetStateAction<Set<string>>>;
  setStorageAlert: (alert: StorageConflictAlert | null) => void;
  storageAlert: StorageConflictAlert | null;
  setStatusNotification: (msg: string | null) => void;
  setWorkspaceMode: (mode: 'write' | 'plan' | 'review' | 'projects' | 'import') => void;
  allowNavigation: () => boolean;
  getHydrationGate: () => HydrationWriteGate;
  acceptReadStatus: (status: IndexedDbLoadStatus) => void;
  cancelAutosave: () => void;
  transientSetters: TransientProjectUiSetters;
}

export function useDurableWorkspaceActions(deps: UseDurableWorkspaceActionsDeps) {
  const saveQueueRef = useRef(createSerializedProjectSaveQueue(persistProjectDurably));
  const saveEpochsRef = useRef(createSaveEpochRegistry());
  const pendingSaveCountsRef = useRef(new Map<string, number>());
  const storageAlertRef = useRef(deps.storageAlert);
  useLayoutEffect(() => {
    storageAlertRef.current = deps.storageAlert;
  }, [deps.storageAlert]);

  const {
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
    setStatusNotification,
    setWorkspaceMode,
    allowNavigation,
    getHydrationGate,
    acceptReadStatus,
    cancelAutosave,
    transientSetters,
  } = deps;

  const canWriteWorkspace = useCallback(() => {
    const gate = getHydrationGate();
    return gate === 'ready' || gate === 'unavailable';
  }, [getHydrationGate]);

  const resetProjectSaveState = useCallback((projectId: string) => {
    saveQueueRef.current.resetProject(projectId);
    saveEpochsRef.current.bumpEpoch(projectId);
  }, []);

  const adjustPendingSave = useCallback(
    (projectId: string, delta: 1 | -1) => {
      const nextCount = Math.max(0, (pendingSaveCountsRef.current.get(projectId) ?? 0) + delta);
      if (nextCount) pendingSaveCountsRef.current.set(projectId, nextCount);
      else pendingSaveCountsRef.current.delete(projectId);
      setPendingDurableSaveProjectIds((previous) => {
        const next = new Set(previous);
        if (nextCount) next.add(projectId);
        else next.delete(projectId);
        return next;
      });
    },
    [setPendingDurableSaveProjectIds]
  );

  const selectProject = useCallback(
    (current: CreativeProject, undo: UndoRedoState) => {
      draftDirtyRef.current = false;
      setManuscriptDraftDirty(false);
      hasLocalEditsSinceMountRef.current = (current.persistedRevision ?? 0) < current.revision;
      publishCurrentProject(current, undo);
      setCachedProjectSelection(current.id);
      clearTransientProjectUiState(transientSetters);
    },
    [draftDirtyRef, hasLocalEditsSinceMountRef, publishCurrentProject, setManuscriptDraftDirty, transientSetters]
  );

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

      const capturedEpoch = saveEpochsRef.current.getEpoch(targetProject.id);
      adjustPendingSave(targetProject.id, 1);
      return saveQueueRef.current
        .enqueue(targetProject, options)
        .then((res) => {
          if (!saveEpochsRef.current.isCurrent(targetProject.id, capturedEpoch)) {
            return res;
          }
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
              message: res.error ?? 'Durable save failed. Export a JSON backup to prevent data loss.',
            });
            return res;
          }

          const ackRevision = res.persistedRevision ?? (targetProject.revision ?? 1);
          const acknowledgedProject = res.storedProject ?? targetProject;
          const activeAtAck = activeProjectRef.current;
          const reconciled = reconcileAsyncSaveAcknowledgement({
            acknowledgedProject,
            acknowledgedRevision: ackRevision,
            currentActiveProject: activeAtAck,
            savedProjects: savedProjectsRef.current,
          });
          savedProjectsRef.current = reconciled.savedProjects;
          setSavedProjects(reconciled.savedProjects);
          if (reconciled.activeProject !== activeAtAck) {
            const updated = reconciled.activeProject;
            activeProjectRef.current = updated;
            setProject((prev) =>
              prev.id === updated.id &&
              prev.revision === updated.revision &&
              prev.narrative === updated.narrative
                ? { ...prev, persistedRevision: updated.persistedRevision }
                : prev
            );
          }

          const competingActive =
            activeAtAck.id === acknowledgedProject.id &&
            activeAtAck.revision >= ackRevision &&
            (reconciled.activeProject.persistedRevision ?? 0) < ackRevision;
          if (competingActive) {
            setStorageAlert({
              type: 'conflict',
              projectId: acknowledgedProject.id,
              conflictingProject: acknowledgedProject,
              message:
                'A durable save completed while this working copy changed. Review both versions before saving again.',
            });
          } else if (options?.clearConflictOnSuccess && activeProjectRef.current.id === targetProject.id) {
            setStorageAlert(null);
          }
          if (options?.successNotification) {
            setStatusNotification(options.successNotification);
          }
          if ((res.quotaExceeded || res.cacheSynced === false) && (res.cacheWarning || res.error)) {
            setStorageAlert({
              type: res.quotaExceeded ? 'quota' : 'error',
              projectId: targetProject.id,
              message:
                res.cacheWarning ??
                res.error ??
                'Saved to authoritative IndexedDB, but localStorage cache could not be updated.',
            });
          }
          return res;
        })
        .finally(() => adjustPendingSave(targetProject.id, -1));
    },
    [
      activeProjectRef,
      adjustPendingSave,
      savedProjectsRef,
      setProject,
      setSavedProjects,
      setStatusNotification,
      setStorageAlert,
    ]
  );

  const handleReloadLatestFromStorage = (resolution?: 'prefer-idb' | 'prefer-local') => {
    if (!allowNavigation()) return;
    const currentActive = activeProjectRef.current;
    const originId = currentActive.id;
    const originUndo = undoStateRef.current;
    const isCurrent = () => activeProjectRef.current === currentActive && undoStateRef.current === originUndo;
    const observedConflict =
      deps.storageAlert?.projectId === originId ? deps.storageAlert.conflictingProject : undefined;

    void executeReloadLatestFromStorage({
      originProject: currentActive,
      originUndo,
      getActiveProject: () => activeProjectRef.current,
      getActiveUndo: () => undoStateRef.current,
      cancelAutosave,
      reloadLatest: () =>
        reloadLatestProjectsFromStorage(originId, {
          resolution,
          inMemoryActiveProject: currentActive,
          hasLocalEditsSinceMount: resolution === 'prefer-local' || hasLocalEditsSinceMountRef.current,
          observedConflictProject: resolution ? observedConflict : undefined,
          isCurrent,
          commit: (candidate, options) => saveQueueRef.current.enqueue(candidate, options),
        }),
      acceptReadStatus,
      resetProjectQueue: resetProjectSaveState,
      publishSync: (nextProject, nextUndo, nextSaved) => {
        savedProjectsRef.current = nextSaved;
        setSavedProjects(nextSaved);
        publishCurrentProject(nextProject, nextUndo);
      },
      setHasLocalEdits: (edited) => {
        hasLocalEditsSinceMountRef.current = edited;
      },
      setSavedProjects: (projects) => {
        savedProjectsRef.current = projects;
        setSavedProjects(projects);
      },
      setStorageAlert,
      setStatusNotification,
      resolution,
    });
  };

  const handleForceOverwriteStorage = () => {
    if (!allowNavigation()) return;
    const current = activeProjectRef.current;
    const observed =
      deps.storageAlert?.projectId === current.id ? deps.storageAlert.conflictingProject : undefined;
    if (!observed) {
      handleReloadLatestFromStorage();
      return;
    }
    if (!observed.narrative) {
      handleReloadLatestFromStorage('prefer-local');
      return;
    }
    void saveBackup(observed, 'Before replacing conflicting stored version', true).then(
      () => {
        if (activeProjectRef.current === current) handleReloadLatestFromStorage('prefer-local');
      },
      (error) => {
        setStatusNotification(
          error instanceof Error ? error.message : 'Could not create the safety backup.'
        );
      }
    );
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
    resetProjectSaveState(sample.id);
    setSavedProjects(nextSaved);
    selectProject(sample, sampleUndo);
    hasLocalEditsSinceMountRef.current = true;
    setStorageAlert(null);
    void flushProjectDurably(sample, {
      forceOverwrite: true,
      allowDeleted: true,
      successNotification: 'Loaded sample story plan: "Cat’s Woodland Dinner Party".',
    });
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
        const outgoingSave = await flushProjectDurably(outgoing, {
          expectedPersistedRevision: outgoing.persistedRevision,
        });
        if (!outgoingSave.saved || outgoingSave.authoritativeStore !== 'indexeddb') {
          setStatusNotification(
            outgoingSave.error ?? 'The current project could not be saved. The new project was not created.'
          );
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
      const result = await flushProjectDurably(newProj, { expectedBaseProject: null });
      if (!result.saved || result.authoritativeStore !== 'indexeddb') {
        setStatusNotification(
          result.error ?? 'The new project could not be saved. Your current workspace is still open.'
        );
        return false;
      }
      const committed = result.storedProject ?? {
        ...newProj,
        persistedRevision: result.persistedRevision ?? newProj.revision,
      };
      if (!sameProjectVersion(activeProjectRef.current, outgoing) || getDeletedProjectIds().has(committed.id)) {
        setStatusNotification(`Created and saved "${committed.name}". The current workspace remains open.`);
        return true;
      }

      const newUndo = createUndoRedoState(committed.snapshot, committed.revisions, committed.undoHistory);
      const nextSaved = upsertProjectInSavedList(savedProjectsRef.current, committed);
      savedProjectsRef.current = nextSaved;
      setSavedProjects(nextSaved);
      selectProject(committed, newUndo);
      hasLocalEditsSinceMountRef.current = false;
      setStorageAlert(null);
      setWorkspaceMode('write');
      setCreateProjectOpen(false);
      setStatusNotification(`Created and saved "${committed.name}".`);
      return true;
    } catch (error) {
      setStatusNotification(
        error instanceof Error ? error.message : 'The project could not be created. Your current workspace is still open.'
      );
      return false;
    } finally {
      setCreateProjectPending(false);
    }
  };

  const applyPostDeleteState = useCallback(
    (projectId: string, delRes: Awaited<ReturnType<typeof deleteProjectCompletely>>) => {
      const deleted = getDeletedProjectIds();
      const nextSaved = savedProjectsRef.current.filter((p) => !deleted.has(p.id));
      for (const survivor of delRes.remaining) {
        if (!deleted.has(survivor.id) && !nextSaved.some((p) => p.id === survivor.id)) {
          nextSaved.push(survivor);
        }
      }
      if (activeProjectRef.current.id === projectId) {
        const replacement = resolvePostDeleteReplacement({
          deletedProjectId: projectId,
          activeProjectId: activeProjectRef.current.id,
          remainingProjects: nextSaved,
        });
        const finalSaved = nextSaved.length > 0 ? nextSaved : [replacement];
        savedProjectsRef.current = finalSaved;
        setSavedProjects(finalSaved);
        selectProject(
          replacement,
          createUndoRedoState(replacement.snapshot, replacement.revisions, replacement.undoHistory)
        );
      } else {
        savedProjectsRef.current = nextSaved;
        setSavedProjects(nextSaved);
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
        if (storageAlertRef.current?.projectId === projectId) {
          setStorageAlert(null);
        }
        setStatusNotification('Deleted project from localStorage and IndexedDB.');
      }
    },
    [activeProjectRef, savedProjectsRef, selectProject, setSavedProjects, setStatusNotification, setStorageAlert]
  );

  const prepareAndFlushBackupImport = async (
    outgoing: CreativeProject,
    rawJson: string,
    replace: boolean
  ): Promise<CreativeProject> => {
    const legacyOrPortable = await parseProjectBackup(rawJson);
    if (aiTicketAuthorityRef.current?.hasProjectTickets(outgoing.id, 'diagnostics')) {
      throw new Error('Wait for the current project operation to finish before restoring.');
    }
    const migrated = replace ? prepareBackupReplacement(outgoing, legacyOrPortable) : prepareBackupCopy(legacyOrPortable);
    const transition = prepareProjectSwitch({
      currentProject: outgoing,
      savedProjects: savedProjectsRef.current,
      targetProjectId: migrated.id,
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
    const saveOptions = replace
      ? {
          expectedPersistedRevision: outgoing.revision,
          expectedManuscriptVersionId: outgoing.snapshot.manuscriptVersionId ?? '',
          expectedBaseSnapshotDigest: computeSnapshotDigest(outgoing.snapshot),
          expectedBaseNarrative: outgoing.narrative ?? null,
          requireExactBase: true,
        }
      : { expectedBaseProject: null };
    const result = await flushProjectDurably(migrated, saveOptions);
    if (!result.saved) throw new Error(result.error ?? 'The restored project could not be saved.');
    return result.storedProject ?? {
      ...migrated,
      persistedRevision: result.persistedRevision ?? migrated.revision,
    };
  };

  const handleImportProjectJson = async (
    rawJson: string,
    replace = false
  ): Promise<{ ok: boolean; error?: string }> => {
    if (!allowNavigation()) return { ok: false, error: 'Save the current draft before restoring a backup.' };
    if (getHydrationGate() === 'blocked-read-error' || getHydrationGate() === 'pending') {
      return { ok: false, error: 'Wait for workspace storage to finish loading before restoring.' };
    }
    const outgoing = activeProjectRef.current;
    restorePendingRef.current = true;
    setRestorePending(true);
    try {
      const saved = await prepareAndFlushBackupImport(outgoing, rawJson, replace);
      if (!sameProjectVersion(activeProjectRef.current, outgoing) || getDeletedProjectIds().has(saved.id)) {
        setStatusNotification(`Restored "${saved.name}". The current working copy was preserved.`);
        return { ok: true };
      }
      if (replace) resetProjectSaveState(saved.id);
      const migratedUndo = createUndoRedoState(saved.snapshot, saved.revisions, saved.undoHistory);
      const latestSaved = replace
        ? savedProjectsRef.current
        : upsertProjectInSavedList(savedProjectsRef.current, activeProjectRef.current);
      const nextSaved = upsertProjectInSavedList(latestSaved, saved);
      savedProjectsRef.current = nextSaved;
      setSavedProjects(nextSaved);
      selectProject(saved, migratedUndo);
      if (!replace) setWorkspaceMode('write');
      setStatusNotification(`Restored and saved project ${replace ? '' : 'copy '}“${saved.name}”.`);
      return { ok: true };
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : 'Invalid project JSON file.' };
    } finally {
      restorePendingRef.current = false;
      setRestorePending(false);
    }
  };

  const handleRestoreArchiveProjects = async (
    restoredProjects: CreativeProject[]
  ): Promise<ArchiveRestoreSequenceResult<CreativeProject>> => {
    if (!canWriteWorkspace()) {
      return {
        ok: false,
        count: 0,
        remainingProjects: restoredProjects,
        error: 'Wait for workspace storage to finish loading before restoring.',
      };
    }
    const { restoreArchiveProjectsSequentially } = await import('../narrative/recovery/allProjectsArchive');
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
      error:
        result.count > 0
          ? `Partial archive restore: ${result.count} project(s) were durably restored. ${result.remainingProjects.length} remain and can be retried. ${result.error}`
          : result.error,
    };
  };

  return {
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
  };
}
