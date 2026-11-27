/**
 * Milestone W4 Regression & Characterization Suite
 * Zero live provider calls — all storage/network/DOM interactions use deterministic mocks.
 */

import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { beforeEach, describe, it } from 'node:test';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { createSampleProject } from '../lib/canonicalModel.ts';
import { createUndoRedoState, type UndoRedoState } from '../lib/historyEngine.ts';
import type { CreativeProject, ProjectSnapshot, StoryBibleFields } from '../shared/types.ts';
import { FakeIndexedDB, installMockBrowserStorage, MockLocalStorage } from './helpers/mockBrowserStorage.ts';

const ROOT = process.cwd();
const mockLocalStorage = new MockLocalStorage();
const mockSessionStorage = new MockLocalStorage();
const fakeIdb = new FakeIndexedDB();

function makeProjectWithParallelEdges(): {
  project: CreativeProject;
  undo: UndoRedoState;
  rel1Id: string;
  rel2Id: string;
} {
  const base = createSampleProject();
  const entities = base.snapshot.entities.slice(0, 2);
  const [a, b] = entities;
  const rel1Id = 'rel_parallel_1';
  const rel2Id = 'rel_parallel_2';
  const snapshot: ProjectSnapshot = {
    ...base.snapshot,
    entities,
    relationships: [
      {
        id: rel1Id,
        sourceId: a.id,
        targetId: b.id,
        source: a.name,
        target: b.name,
        label: 'admires',
        status: 'confirmed',
        provenance: 'user-edit',
      },
      {
        id: rel2Id,
        sourceId: a.id,
        targetId: b.id,
        source: a.name,
        target: b.name,
        label: 'fears',
        status: 'confirmed',
        provenance: 'user-edit',
      },
    ],
  };
  const project: CreativeProject = {
    ...base,
    id: 'proj_parallel_edges',
    revision: 3,
    persistedRevision: 3,
    snapshot,
  };
  return {
    project,
    undo: createUndoRedoState(project.snapshot, project.revisions, project.undoHistory),
    rel1Id,
    rel2Id,
  };
}

describe('W4 App Orchestration & Workspace Regressions', () => {
  beforeEach(() => {
    installMockBrowserStorage(mockLocalStorage, mockSessionStorage, fakeIdb);
    mockLocalStorage.clear();
    mockSessionStorage.clear();
    fakeIdb.reset();
  });

  it('R03: App renders safely on boot when pcc.ai.providerPreferences.v1 is corrupt JSON or localStorage throws', async () => {
    const { default: App } = await import('../App.tsx');

    mockLocalStorage.setItem('pcc.ai.providerPreferences.v1', '{corrupt-json');
    const htmlCorrupt = renderToStaticMarkup(React.createElement(App));
    assert.ok(htmlCorrupt.includes('PCC'), 'App should render shell even with corrupt provider preferences JSON');

    const origGetItem = window.localStorage.getItem.bind(window.localStorage);
    window.localStorage.getItem = ((key: string) => {
      if (key === 'pcc.ai.providerPreferences.v1') {
        throw new Error('SecurityError: storage denied');
      }
      return origGetItem(key);
    }) as typeof window.localStorage.getItem;

    try {
      const htmlThrowing = renderToStaticMarkup(React.createElement(App));
      assert.ok(htmlThrowing.includes('PCC'), 'App should render shell even when localStorage.getItem throws');
    } finally {
      window.localStorage.getItem = origGetItem;
    }
  });

  it('R03: storyProviderSelection safe reader & Story preflight enforce explicit ChatGPT model+reasoning without throwing', async () => {
    const mod = await import('../lib/controller/storyProviderSelection.ts');

    mockLocalStorage.setItem('pcc.ai.providerPreferences.v1', '{bad');
    assert.deepEqual(mod.readSafeStoryProviderSelection(), { connectionId: 'gemini-managed' });
    const badPreflight = mod.resolveStoryProviderPreflight(false);
    assert.equal(badPreflight.ok, false);

    mockLocalStorage.setItem(
      'pcc.ai.providerPreferences.v1',
      JSON.stringify({
        defaultConnectionId: 'chatgpt-plan',
        defaultTextModelId: 'gpt-6-luna',
      })
    );
    const missingReasoning = mod.resolveStoryProviderPreflight(true);
    assert.equal(missingReasoning.ok, false);
    if (!missingReasoning.ok) {
      assert.match(missingReasoning.errorMessage, /explicitly/i);
    }

    mockLocalStorage.setItem(
      'pcc.ai.providerPreferences.v1',
      JSON.stringify({
        defaultConnectionId: 'chatgpt-plan',
        defaultTextModelId: 'gpt-6-luna',
        defaultReasoningLevel: 'default',
      })
    );
    assert.equal(mod.resolveStoryProviderPreflight(false).ok, false);
    assert.equal(mod.resolveStoryProviderPreflight(true).ok, true);
  });

  it('R07 / W4-02: save-epoch fencing suppresses stale pre-reload conflict alerts and reloadLatestProjectAction cancels autosave & updates refs synchronously', async () => {
    const mod = await import('../lib/controller/useDurableWorkspaceActions.ts');
    const epochs = mod.createSaveEpochRegistry();
    assert.equal(epochs.getEpoch('p1'), 0);

    const capturedEpoch = epochs.getEpoch('p1');
    assert.equal(epochs.isCurrent('p1', capturedEpoch), true);
    const nextEpoch = epochs.bumpEpoch('p1');
    assert.equal(nextEpoch, 1);
    assert.equal(epochs.isCurrent('p1', capturedEpoch), false);

    // Simulate reloadLatestProjectAction
    let cancelledAutosave = false;
    let alertState: unknown = { type: 'conflict', projectId: 'p1', message: 'stale' };
    let statusMsg: string | null = null;
    const base = createSampleProject();
    const loaded: CreativeProject = { ...base, id: 'p1', revision: 4, persistedRevision: 4 };
    const loadedUndo = createUndoRedoState(loaded.snapshot, loaded.revisions, loaded.undoHistory);
    let refProject: CreativeProject = { ...base, id: 'p1', revision: 2, persistedRevision: 1 };
    let refUndo = createUndoRedoState(refProject.snapshot, refProject.revisions, refProject.undoHistory);
    let hasLocalEdits = true;
    let resetQueueId: string | null = null;

    await mod.executeReloadLatestFromStorage({
      originProject: refProject,
      originUndo: refUndo,
      getActiveProject: () => refProject,
      getActiveUndo: () => refUndo,
      cancelAutosave: () => {
        cancelledAutosave = true;
      },
      reloadLatest: async () => ({
        projects: [loaded],
        activeProject: loaded,
        activeUndoState: loadedUndo,
        idbStatus: 'ok',
        conflictDetected: false,
        persisted: true,
        upgradedFromIndexedDb: false,
      }),
      acceptReadStatus: () => 'ready',
      resetProjectQueue: (id: string) => {
        resetQueueId = id;
        epochs.bumpEpoch(id);
      },
      publishSync: (proj: CreativeProject, undo: UndoRedoState, saved: CreativeProject[]) => {
        refProject = proj;
        refUndo = undo;
        assert.equal(saved.length, 1);
      },
      setHasLocalEdits: (v: boolean) => {
        hasLocalEdits = v;
      },
      setSavedProjects: () => {},
      setStorageAlert: (a: unknown) => {
        alertState = a;
      },
      setStatusNotification: (m: string | null) => {
        statusMsg = m;
      },
      resolution: 'prefer-local',
    });

    assert.equal(cancelledAutosave, true);
    assert.equal(resetQueueId, 'p1');
    assert.equal(refProject.revision, 4);
    assert.equal(hasLocalEdits, false, 'prefer-local persisted reload without narrative must clear stale local-edits flag');
    assert.equal(alertState, null);
    assert.match(statusMsg ?? '', /Reloaded revision #4/);
  });

  it('W4-01 & W5-03 & W5-05: synchronous ref-backed canonical handlers preserve multi-field Story Bible updates, sequential edits, and parallel relationshipId edits', async () => {
    const mod = await import('../lib/controller/useCanonicalPlanHandlers.ts');
    const { project, undo, rel2Id } = makeProjectWithParallelEdges();
    const activeProjectRef = { current: project };
    const undoStateRef = { current: undo };
    let storyBibleErrors: Partial<Record<keyof StoryBibleFields, string>> = {};
    const notifications: string[] = [];

    const handlers = mod.createCanonicalPlanHandlers({
      getActiveProject: () => activeProjectRef.current,
      getUndoState: () => undoStateRef.current,
      publishCurrentProject: (nextProj: CreativeProject, nextUndo: UndoRedoState) => {
        activeProjectRef.current = nextProj;
        undoStateRef.current = nextUndo;
      },
      markLocalEdits: () => {},
      setStoryBibleErrors: (updater) => {
        storyBibleErrors = typeof updater === 'function' ? updater(storyBibleErrors) : updater;
      },
      setStatusNotification: (msg) => {
        if (msg) notifications.push(msg);
      },
      allowNavigation: () => true,
      navigateToPlan: () => {},
      navigateToWriteSection: () => {},
      setSelectedEntityId: () => {},
      setSelectedRelationshipId: () => {},
      setRightPanelTab: () => {},
      setMobileTab: () => {},
      setFocusedStoryBibleField: () => {},
    });

    // W5-03: two synchronous Story Bible updates in same tick without React re-render
    handlers.handleUpdateStoryBible('genre', 'Biopunk Noir');
    handlers.handleUpdateStoryBible('setting', 'Flooded Arcology');
    assert.equal(activeProjectRef.current.snapshot.storyBible.genre.value, 'Biopunk Noir');
    assert.equal(activeProjectRef.current.snapshot.storyBible.setting.value, 'Flooded Arcology');

    // W4-01: sequential entity + attribute edits in same tick
    const entityName = activeProjectRef.current.snapshot.entities[0].name;
    handlers.handleAddEntity('Archivist', 'character', 'Keeps forbidden ledgers');
    handlers.handleAttributeChange(entityName, 'mood', 'wary');
    assert.ok(activeProjectRef.current.snapshot.entities.some((e) => e.name === 'Archivist'));
    const updatedFirst = activeProjectRef.current.snapshot.entities.find((e) => e.name === entityName)!;
    assert.equal(updatedFirst.attributes.find((a) => a.name === 'mood')?.confirmedValue, 'wary');

    // W5-05: editing parallel directed edge preserves count = 2 and updates rel2Id in-place
    const [a, b] = activeProjectRef.current.snapshot.entities;
    handlers.handleUpsertRelationship(a.name, b.name, 'respects', rel2Id);
    assert.equal(activeProjectRef.current.snapshot.relationships.length, 2);
    assert.equal(
      activeProjectRef.current.snapshot.relationships.find((r) => r.id === rel2Id)?.label,
      'respects'
    );
  });

  it('W5-04: createOpportunityBatchInProject appends multiple AI opportunities atomically at expectedRevision', async () => {
    const mod = await import('../lib/controller/useNarrativeWorkflowActions.ts');
    const base = createSampleProject();
    const project: CreativeProject = { ...base, id: 'proj_opp_batch', revision: 5, persistedRevision: 5 };
    const inputs = [1, 2, 3].map((n) => ({
      description: `Opportunity ${n}`,
      sourceRefs: ['sec-1'],
      rationale: `Rationale ${n}`,
      benefit: `Benefit ${n}`,
      tradeOff: `Trade-off ${n}`,
      assumptions: [],
      origin: 'ai' as const,
    }));

    const next = mod.createOpportunityBatchInProject(project, inputs, 5);
    assert.equal(next.revision, 6);
    assert.equal(next.narrative?.opportunities?.length, 3);
    assert.ok(next.narrative?.opportunities?.every((o) => o.lifecycleRevision === 6));

    assert.throws(
      () => mod.createOpportunityBatchInProject(project, inputs, 4),
      /project changed/i
    );
  });

  it('W4-03 & W4-04: empty-list deletion replaces active deleted project and clears transient selection state', async () => {
    const mod = await import('../lib/controller/useDurableWorkspaceActions.ts');
    const doomed = { ...createSampleProject(), id: 'proj_doomed', revision: 2 };
    const nextActive = mod.resolvePostDeleteReplacement({
      deletedProjectId: doomed.id,
      activeProjectId: doomed.id,
      remainingProjects: [],
    });
    assert.notEqual(nextActive.id, doomed.id);

    let cleared = false;
    mod.clearTransientProjectUiState({
      setSelectedEntityId: () => {},
      setSelectedRelationshipId: () => {},
      setStoryBibleErrors: () => {},
      setAdoptArtifactId: () => {
        cleared = true;
      },
      setFocusedSectionId: () => {},
      setHistoryTarget: () => {},
      setResumedProposalReview: () => {},
    });
    assert.equal(cleared, true);
  });

  it('W4-05: ProjectHub backup runner discards stale responses across project switch and resets busy in finally on throw', async () => {
    const mod = await import('../components/workspace/hub/backupOperations.ts');
    let currentProjectId = 'proj_A';
    let busy = false;
    let backupsWritten: unknown[] | null = null;
    let statusMessage = '';

    await mod.runGuardedBackupOperation({
      projectId: 'proj_A',
      isBusy: () => busy,
      setBusy: (v: boolean) => {
        busy = v;
      },
      setMessage: (m: string) => {
        statusMessage = m;
      },
      isCurrentTarget: (id: string) => id === currentProjectId,
      listProjectBackups: async () => [{ id: 'stale-b1' } as never],
      setBackups: (records) => {
        backupsWritten = records;
      },
      operation: async () => {
        currentProjectId = 'proj_B';
        return 'Completed on A';
      },
    });
    assert.equal(busy, false);
    assert.equal(backupsWritten, null, 'Stale listBackups after project switch must not overwrite backups');
    assert.equal(statusMessage, '');

    let archiveBusy = false;
    let archiveError = '';
    await mod.runArchiveRestoreWithFinally({
      setBusy: (v: boolean) => {
        archiveBusy = v;
      },
      setArchiveError: (e: string) => {
        archiveError = e;
      },
      run: async () => {
        throw new Error('IDB quota exploded');
      },
    });
    assert.equal(archiveBusy, false, 'busy flag must reset via finally even when restoreArchiveProjects throws');
    assert.match(archiveError, /IDB quota exploded/);

    const hubSource = fs.readFileSync(path.join(ROOT, 'components/workspace/ProjectHub.tsx'), 'utf8');
    const hubSections = [
      hubSource,
      ...(fs.existsSync(path.join(ROOT, 'components/workspace/hub/BrowserBackupsSection.tsx'))
        ? [fs.readFileSync(path.join(ROOT, 'components/workspace/hub/BrowserBackupsSection.tsx'), 'utf8')]
        : []),
    ].join('\n');
    assert.ok(hubSections.includes('setBackupPinLocked'), 'ProjectHub should adopt W3 setBackupPinLocked');
  });

  it('W4-06: NarrativeReview per-issue loading Set and AbortController cancellation', async () => {
    const mod = await import('../components/workspace/review/asyncReviewActions.ts');
    let loadingIds = new Set<string>();
    const signals: AbortSignal[] = [];
    let resolveIssue1!: (v: { alternatives: [] }) => void;
    let resolveIssue2!: (v: { alternatives: [] }) => void;

    const p1 = mod.executeIssueAiFixRequest({
      issueId: 'iss-1',
      setIssueLoading: (id: string, loading: boolean) => {
        const next = new Set(loadingIds);
        if (loading) next.add(id);
        else next.delete(id);
        loadingIds = next;
      },
      registerController: () => new AbortController(),
      isActive: () => true,
      requestFixes: (signal: AbortSignal) => {
        signals.push(signal);
        return new Promise((res) => {
          resolveIssue1 = res;
        });
      },
      onSuccess: () => {},
      onError: () => {},
    });

    const c2 = new AbortController();
    const p2 = mod.executeIssueAiFixRequest({
      issueId: 'iss-2',
      setIssueLoading: (id: string, loading: boolean) => {
        const next = new Set(loadingIds);
        if (loading) next.add(id);
        else next.delete(id);
        loadingIds = next;
      },
      registerController: () => c2,
      isActive: () => true,
      requestFixes: (signal: AbortSignal) => {
        signals.push(signal);
        return new Promise((res) => {
          resolveIssue2 = res;
        });
      },
      onSuccess: () => {},
      onError: () => {},
    });

    assert.equal(loadingIds.has('iss-1'), true);
    assert.equal(loadingIds.has('iss-2'), true);

    resolveIssue1({ alternatives: [] });
    await p1;
    assert.equal(loadingIds.has('iss-1'), false);
    assert.equal(loadingIds.has('iss-2'), true, 'iss-1 completing must not clear iss-2 loading');

    c2.abort();
    assert.equal(signals[1].aborted, true);
    // Simulate a superseding request for iss-2 starting before the aborted request settles
    let resolveSuperseding!: (v: { alternatives: [] }) => void;
    const p2Superseding = mod.executeIssueAiFixRequest({
      issueId: 'iss-2',
      setIssueLoading: (id: string, loading: boolean) => {
        const next = new Set(loadingIds);
        if (loading) next.add(id);
        else next.delete(id);
        loadingIds = next;
      },
      registerController: () => new AbortController(),
      isActive: () => true,
      requestFixes: (signal: AbortSignal) => {
        signals.push(signal);
        return new Promise((res) => {
          resolveSuperseding = res;
        });
      },
      onSuccess: () => {},
      onError: () => {},
    });
    resolveIssue2({ alternatives: [] });
    await p2;
    assert.equal(loadingIds.has('iss-2'), true, 'Aborted p2 finally must not clear superseding iss-2 loading');
    resolveSuperseding({ alternatives: [] });
    await p2Superseding;
    assert.equal(loadingIds.has('iss-2'), false);
  });

  it('W4-07 & W4-08 & W4-09 & W5-01 & R16: modal accessibility, keying, adoption dismiss, and lazy splits', async () => {
    const aiModalMod = await import('../components/workspace/AiSettingsModal.tsx');
    const html = renderToStaticMarkup(
      React.createElement(aiModalMod.default, { isOpen: true, onClose: () => {} })
    );
    assert.ok(html.includes('role="dialog"') && html.includes('aria-modal="true"') && html.includes('ai-settings-title'));

    const boundaryMod = await import('../components/workspace/ChunkErrorBoundary.tsx');
    assert.equal(typeof boundaryMod.default, 'function');

    const infoSource = fs.readFileSync(path.join(ROOT, 'components/InfoModal.tsx'), 'utf8');
    assert.ok(infoSource.includes('onCloseRef'), 'InfoModal must stabilize onClose via ref');
    assert.ok(!infoSource.includes('[isOpen, onClose]'), 'InfoModal effect must not depend on unstable onClose');

    const exportsSource = fs.readFileSync(path.join(ROOT, 'lib/workspace/projectExports.ts'), 'utf8');
    assert.equal(
      /^import\s+\{[^}]*\}\s+from\s+['"]\.\.\/narrative\/recovery\/(contentExport|docxExport)['"]/m.test(exportsSource),
      false,
      'projectExports.ts must dynamically import contentExport and docxExport to keep fflate out of initial bundle'
    );

    const appSource = fs.readFileSync(path.join(ROOT, 'App.tsx'), 'utf8');
    for (const lazyComp of ['ImportWorkflow', 'NarrativeReview', 'ProjectHub', 'AiConnectionsPanel']) {
      assert.ok(
        appSource.includes(`lazy(() => import(`) && appSource.includes(lazyComp),
        `App.tsx must lazy-load ${lazyComp}`
      );
    }
    assert.ok(appSource.includes('<ChunkErrorBoundary'), 'App.tsx must wrap lazy views in ChunkErrorBoundary');
    assert.ok(appSource.includes('onDismissAdoption='), 'W5-01: App.tsx must wire onDismissAdoption to ManuscriptEditor');
    assert.ok(appSource.includes('onCreateOpportunityBatch='), 'W5-04: App.tsx must wire onCreateOpportunityBatch to ContextualInspector');
    assert.ok(appSource.includes('key={activeProject.id}'), 'W4-09: App.tsx must key per-project plan panels');
  });
});
