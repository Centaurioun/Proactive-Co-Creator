/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import type { StorageConflictAlert } from '../../components/workspace/StorageAlertBanner';
import type { CreativeProject } from '../../shared/types';
import { isSnapshotSemanticallyEqual, type UndoRedoState } from '../historyEngine';
import {
  getDeletedProjectIds,
  loadProjectsFromIndexedDbDetailed,
  loadProjectsFromLocalStorage,
  LOCAL_STORAGE_PROJECTS_KEY,
  reconcileHydratedProjects,
  saveProjectToLocalStorage,
  setCachedProjectSelection,
  type DurableWriteOptions,
  type IndexedDbLoadStatus,
  type StorageSaveResult,
} from '../storageEngine';
import {
  resolveHydrationWriteGate, shouldAllowUnsolicitedPersistence, type HydrationWriteGate,
} from './projectListSync';

type Persist = (project: CreativeProject, options?: DurableWriteOptions) => Promise<StorageSaveResult>;
type Reconciled = ReturnType<typeof reconcileHydratedProjects>;

interface Workspace {
  read(): {
    project: CreativeProject;
    undo: UndoRedoState;
    projects: CreativeProject[];
    edited: boolean;
    draftPending: boolean;
  };
  publish(result: Reconciled): void;
  initialize: Persist;
}

export function useProjectPersistence({
  project,
  startup,
  workspace,
  persist,
  alert,
  report,
}: {
  project: CreativeProject;
  startup: { activeProjectId: string | null; autoSeededSample?: boolean };
  workspace: Workspace;
  persist: Persist;
  alert: StorageConflictAlert | null;
  report: (alert: StorageConflictAlert) => void;
}) {
  const [gate, setGate] = useState<HydrationWriteGate>('pending');
  const currentGate = useRef<HydrationWriteGate>('pending');
  const autosave = useRef<ReturnType<typeof setTimeout> | null>(null);
  const getGate = useCallback(() => currentGate.current, []);
  const acceptReadStatus = useCallback((status: IndexedDbLoadStatus) => {
    const next = resolveHydrationWriteGate(status);
    currentGate.current = next;
    setGate(next);
    return next;
  }, []);
  const cancelAutosave = useCallback(() => {
    if (autosave.current !== null) clearTimeout(autosave.current);
    autosave.current = null;
  }, []);

  useEffect(() => {
    let cancelled = false;
    const fail = (projectId: string, message: string) => {
      acceptReadStatus('read_error');
      report({
        type: 'error', projectId,
        message: `${message} Automatic writes are paused. Click Retry Storage Read or export a JSON backup.`,
      });
    };
    // Keep the legacy pre-migration checkpoint outside render.
    loadProjectsFromLocalStorage({ skipAutoSeedIfEmpty: true });
    void loadProjectsFromIndexedDbDetailed().then(async (load) => {
      if (cancelled) return;
      const start = workspace.read();
      if (load.status === 'read_error') {
        fail(start.project.id, `IndexedDB read failure (${load.error ?? 'Unable to read durable database'}).`);
        return;
      }
      const next = reconcileHydratedProjects({
        localProjects: start.projects,
        idbProjects: load.projects,
        activeProject: start.project,
        activeUndoState: start.undo,
        hasLocalEditsSinceMount: start.edited,
        localWasAutoSeededSample: startup.autoSeededSample,
      });
      if (load.corruptRecordCount > 0) {
        report({
          type: 'error', projectId: start.project.id,
          message: `Skipped ${load.corruptRecordCount} corrupt or unsupported record(s) in IndexedDB while preserving recoverable projects.`,
        });
      }
      if (next.conflictWithHydrated) {
        const stored = next.conflictWithHydrated;
        const summary = (entry: CreativeProject) => entry.snapshot.storyBible.genre.value ||
          entry.snapshot.storyBible.setting.value || entry.snapshot.originalIdea.slice(0, 40);
        report({
          type: 'conflict', projectId: start.project.id, conflictingProject: stored,
          message: `Storage hydration conflict: IndexedDB holds revision #${stored.revision} ("${summary(stored)}") while this tab has revision #${start.project.revision} ("${summary(start.project)}"). Both versions are preserved until you choose which to keep.`,
        });
      } else {
        const stored = load.projects.find(entry => entry.id === next.activeProject.id);
        const needsSeed = load.status === 'unavailable'
          ? next.savedProjects.length === 0
          : !stored || stored.revision < next.activeProject.revision;
        if (needsSeed && (load.status !== 'unavailable' || !next.activeProject.narrative)) {
          const saved = await workspace.initialize(next.activeProject, {
            expectedBaseProject: stored ?? null,
            expectedPersistedRevision: stored?.revision,
          });
          if (cancelled) return;
          if (!saved.saved) {
            fail(start.project.id, saved.error ?? 'Could not initialize workspace storage.');
            return;
          }
          next.activeProject = saved.storedProject ?? { ...next.activeProject, persistedRevision: saved.persistedRevision };
          next.savedProjects = [
            next.activeProject,
            ...next.savedProjects.filter(entry => entry.id !== next.activeProject.id),
          ];
          if (saved.cacheWarning) report({ type: 'error', projectId: next.activeProject.id, message: saved.cacheWarning });
        }
      }

      const current = workspace.read();
      if (start.project === current.project && start.undo === current.undo) {
        workspace.publish(next);
        if (!startup.activeProjectId) setCachedProjectSelection(next.activeProject.id);
        if (next.upgradedFromIndexedDb && !next.conflictWithHydrated) {
          saveProjectToLocalStorage(next.activeProject, { selectProject: false });
        }
      }
      acceptReadStatus(load.status);
    }).catch((error: unknown) => {
      if (!cancelled) fail(workspace.read().project.id, error instanceof Error ? error.message : 'Could not read workspace storage.');
    });
    return () => { cancelled = true; };
  }, [acceptReadStatus, workspace, startup.activeProjectId, startup.autoSeededSample, report]);

  const canSave = useCallback((target: CreativeProject) => {
    const current = workspace.read();
    return current.project === target && !current.draftPending && getGate() !== 'pending' &&
      shouldAllowUnsolicitedPersistence({
        hydrationGate: getGate(),
        hasLocalEditsSinceMount: current.edited,
        isDeleted: getDeletedProjectIds().has(target.id),
        storageAlertType: alert?.type,
        storageAlertProjectId: alert?.projectId,
        activeProjectId: target.id,
      });
  }, [workspace, getGate, alert]);

  useEffect(() => {
    if (gate === 'pending' || gate === 'blocked-read-error' ||
        (project.persistedRevision === project.revision && (project.narrative || !workspace.read().edited))) return;
    const timer = setTimeout(() => {
      autosave.current = null;
      if (canSave(project)) void persist(project, { expectedPersistedRevision: project.persistedRevision });
    }, 250);
    autosave.current = timer;
    return () => {
      clearTimeout(timer);
      if (autosave.current === timer) autosave.current = null;
    };
  }, [project, gate, canSave, workspace, persist]);

  useEffect(() => {
    const flushOnBackground = () => {
      const target = workspace.read().project;
      if (!canSave(target) || (target.persistedRevision ?? 0) >= target.revision) return;
      cancelAutosave();
      if (!target.narrative) {
        saveProjectToLocalStorage(target, { expectedPersistedRevision: target.persistedRevision, selectProject: false });
      }
      void persist(target, { expectedPersistedRevision: target.persistedRevision });
    };
    const onVisibility = () => {
      if (document.visibilityState === 'hidden') flushOnBackground();
    };
    window.addEventListener('pagehide', flushOnBackground);
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      window.removeEventListener('pagehide', flushOnBackground);
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [workspace, canSave, persist, cancelAutosave]);

  useEffect(() => {
    let eventEpoch = 0;
    const onStorage = (event: StorageEvent) => {
      if (event.key !== LOCAL_STORAGE_PROJECTS_KEY || !event.newValue) return;
      const epoch = ++eventEpoch;
      const current = workspace.read().project;
      const local = loadProjectsFromLocalStorage({ skipAutoSeedIfEmpty: true, readOnly: true });
      const remote = local.projects.find(entry => entry.id === current.id);
      if (!remote) return;
      const base = current.persistedRevision ?? current.revision;
      const divergentSameRevision = current.narrative && remote.revision === base && current.revision === base &&
        (!isSnapshotSemanticallyEqual(current.snapshot, remote.snapshot) ||
          JSON.stringify(current.narrative) !== JSON.stringify(remote.narrative));
      if (remote.revision <= base && !divergentSameRevision) return;
      // Cache changes signal a possible conflict. The resolution binds to the authoritative observation.
      void loadProjectsFromIndexedDbDetailed().then((load) => {
        if (epoch !== eventEpoch || workspace.read().project.id !== current.id) return;
        const stored = load.status === 'unavailable' ? remote : load.projects.find(entry => entry.id === current.id);
        if (!stored) return;
        report({
          type: 'conflict', projectId: current.id, conflictingProject: stored,
          message: `Another tab saved revision #${stored.revision} while this tab is on revision #${workspace.read().project.revision}. Choose whether to reload the latest version or keep this tab's version.`,
        });
      });
    };
    window.addEventListener('storage', onStorage);
    return () => {
      eventEpoch += 1;
      window.removeEventListener('storage', onStorage);
    };
  }, [workspace, report]);

  return { gate, getGate, acceptReadStatus, cancelAutosave };
}
