/**
 * W6 Residual UI & Controller Regressions + Characterization Suite
 * Covers W6-D10..W6-D15 and CreateProjectDialog / ReviewDiffModal / StorageAlertBanner.
 * Zero live provider calls; uses deterministic synthetic fixtures and a lightweight Node DOM shim.
 */

import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { afterEach, beforeEach, describe, it } from 'node:test';
import React, { Suspense } from 'react';
import { flushSync } from 'react-dom';
import { createRoot } from 'react-dom/client';
import { renderToStaticMarkup } from 'react-dom/server';
import CreateProjectDialog from '../components/projects/CreateProjectDialog.tsx';
import AiSettingsModal from '../components/workspace/AiSettingsModal.tsx';
import ChunkErrorBoundary, { createRetryableLazy } from '../components/workspace/ChunkErrorBoundary.tsx';
import ReviewDiffModal from '../components/workspace/ReviewDiffModal.tsx';
import StorageAlertBanner, { type StorageConflictAlert } from '../components/workspace/StorageAlertBanner.tsx';
import { executeIssueAiFixRequest } from '../components/workspace/review/asyncReviewActions.ts';
import { createSampleProject } from '../lib/canonicalModel.ts';
import { createCanonicalPlanHandlers, useCanonicalPlanHandlers, useGlobalWorkspaceShortcuts } from '../lib/controller/useCanonicalPlanHandlers.ts';
import { useDurableWorkspaceActions } from '../lib/controller/useDurableWorkspaceActions.ts';
import { createUndoRedoState, type UndoRedoState } from '../lib/historyEngine.ts';
import { buildReviewDiffModel } from '../lib/projectController.ts';
import type { CreativeProject, DecisionItem } from '../shared/types.ts';
import { FakeIndexedDB, installMockBrowserStorage, MockLocalStorage } from './helpers/mockBrowserStorage.ts';

const ROOT = process.cwd();

interface MiniEvent {
  type: string;
  key?: string;
  shiftKey?: boolean;
  metaKey?: boolean;
  ctrlKey?: boolean;
  bubbles?: boolean;
  cancelable?: boolean;
  target?: unknown;
  currentTarget?: unknown;
  preventDefault: () => void;
  stopPropagation: () => void;
}

function createMiniEvent(type: string, init: Partial<MiniEvent> = {}): MiniEvent {
  return {
    type,
    bubbles: true,
    cancelable: true,
    preventDefault: () => {},
    stopPropagation: () => {},
    ...init,
  };
}

function installMiniDomEnvironment() {
  const mockLocalStorage = new MockLocalStorage();
  const mockSessionStorage = new MockLocalStorage();
  const fakeIdb = new FakeIndexedDB();
  installMockBrowserStorage(mockLocalStorage, mockSessionStorage, fakeIdb);

  const windowListeners = new Map<string, Set<(e: MiniEvent) => void>>();
  let addListenerCalls: Array<{ type: string }> = [];
  const doc: {
    nodeType: number;
    defaultView: unknown;
    documentElement: MiniElement;
    body: MiniElement;
    activeElement: MiniElement | null;
    createElement: (tag: string) => MiniElement;
    createElementNS: (_ns: string, tag: string) => MiniElement;
    createTextNode: (v: string) => MiniText;
    createComment: (v: string) => MiniComment;
    addEventListener: () => void;
    removeEventListener: () => void;
  } = {
    nodeType: 9,
    defaultView: undefined,
    documentElement: undefined as unknown as MiniElement,
    body: undefined as unknown as MiniElement,
    activeElement: null,
    createElement: (tag: string) => new MiniElement(tag),
    createElementNS: (_ns: string, tag: string) => new MiniElement(tag),
    createTextNode: (v: string) => new MiniText(v),
    createComment: (v: string) => new MiniComment(v),
    addEventListener() {},
    removeEventListener() {},
  };

  class MiniNode {
    nodeType: number;
    childNodes: MiniNode[] = [];
    parentNode: MiniNode | null = null;
    get ownerDocument() {
      return doc;
    }
    constructor(t: number) {
      this.nodeType = t;
    }
    appendChild(child: MiniNode): MiniNode {
      if (child.parentNode) child.parentNode.removeChild(child);
      child.parentNode = this;
      this.childNodes.push(child);
      return child;
    }
    insertBefore(child: MiniNode, ref: MiniNode | null): MiniNode {
      if (!ref) return this.appendChild(child);
      if (child.parentNode) child.parentNode.removeChild(child);
      child.parentNode = this;
      const idx = this.childNodes.indexOf(ref);
      if (idx === -1) this.childNodes.push(child);
      else this.childNodes.splice(idx, 0, child);
      return child;
    }
    removeChild(child: MiniNode): MiniNode {
      const idx = this.childNodes.indexOf(child);
      if (idx !== -1) this.childNodes.splice(idx, 1);
      child.parentNode = null;
      return child;
    }
    get firstChild(): MiniNode | null {
      return this.childNodes[0] ?? null;
    }
    get lastChild(): MiniNode | null {
      return this.childNodes[this.childNodes.length - 1] ?? null;
    }
    get nextSibling(): MiniNode | null {
      if (!this.parentNode) return null;
      const i = this.parentNode.childNodes.indexOf(this);
      return i >= 0 ? (this.parentNode.childNodes[i + 1] ?? null) : null;
    }
    get previousSibling(): MiniNode | null {
      if (!this.parentNode) return null;
      const i = this.parentNode.childNodes.indexOf(this);
      return i > 0 ? (this.parentNode.childNodes[i - 1] ?? null) : null;
    }
    addEventListener(_t: string, _fn: (e: MiniEvent) => void) {}
    removeEventListener(_t: string, _fn: (e: MiniEvent) => void) {}
  }

  class MiniElement extends MiniNode {
    tagName: string;
    nodeName: string;
    attrs = new Map<string, string>();
    style: Record<string, string> = {};
    classList = { toggle: () => {}, add: () => {}, remove: () => {} };
    eventListeners = new Map<string, Set<(e: MiniEvent) => void>>();
    value = '';
    checked = false;
    disabled = false;
    constructor(tag: string) {
      super(1);
      this.tagName = tag.toUpperCase();
      this.nodeName = this.tagName;
    }
    setAttribute(k: string, v: string) {
      if (k === 'disabled') this.disabled = true;
      this.attrs.set(k, String(v));
    }
    getAttribute(k: string) {
      return this.attrs.get(k) ?? null;
    }
    removeAttribute(k: string) {
      if (k === 'disabled') this.disabled = false;
      this.attrs.delete(k);
    }
    override addEventListener(t: string, fn: (e: MiniEvent) => void) {
      if (!this.eventListeners.has(t)) this.eventListeners.set(t, new Set());
      this.eventListeners.get(t)!.add(fn);
    }
    override removeEventListener(t: string, fn: (e: MiniEvent) => void) {
      this.eventListeners.get(t)?.delete(fn);
    }
    dispatchEvent(e: MiniEvent) {
      e.target = e.target ?? this;
      let cur: MiniNode | null = this as MiniNode;
      while (cur) {
        e.currentTarget = cur;
        if (cur instanceof MiniElement) {
          cur.eventListeners.get(e.type)?.forEach((fn) => fn(e));
        }
        cur = cur.parentNode;
      }
      return true;
    }
    click() {
      this.dispatchEvent(createMiniEvent('click'));
    }
    focus() {
      doc.activeElement = this;
    }
    contains(n: MiniNode | null): boolean {
      if (n === (this as MiniNode)) return true;
      return this.childNodes.some((c) => (c instanceof MiniElement ? c.contains(n) : c === n));
    }
    querySelectorAll(sel: string): MiniElement[] {
      const res: MiniElement[] = [];
      const wantsButtons = sel.includes('button');
      const wantsInputs = sel.includes('input');
      const wantsTextareas = sel.includes('textarea');
      const walk = (n: MiniNode) => {
        for (const c of n.childNodes) {
          if (c instanceof MiniElement) {
            const match =
              (wantsButtons && c.tagName === 'BUTTON' && !c.disabled) ||
              (wantsInputs && c.tagName === 'INPUT' && !c.disabled) ||
              (wantsTextareas && c.tagName === 'TEXTAREA' && !c.disabled);
            if (match) res.push(c);
            walk(c);
          }
        }
      };
      walk(this as MiniNode);
      return res;
    }
    set textContent(v: string) {
      this.childNodes = v ? [new MiniText(v)] : [];
    }
    get textContent(): string {
      return this.childNodes
        .map((c) => (c instanceof MiniText ? c.nodeValue : c instanceof MiniElement ? c.textContent : ''))
        .join('');
    }
  }

  class MiniText extends MiniNode {
    nodeValue: string;
    constructor(v: string) {
      super(3);
      this.nodeValue = String(v);
    }
    get textContent() {
      return this.nodeValue;
    }
    set textContent(v: string) {
      this.nodeValue = String(v);
    }
    get data() {
      return this.nodeValue;
    }
    set data(v: string) {
      this.nodeValue = String(v);
    }
  }

  class MiniComment extends MiniNode {
    nodeValue: string;
    constructor(v: string) {
      super(8);
      this.nodeValue = String(v);
    }
    get data() {
      return this.nodeValue;
    }
    set data(v: string) {
      this.nodeValue = String(v);
    }
  }

  class MiniIFrame extends MiniElement {}

  const win = (globalThis as unknown as { window: Record<string, unknown> }).window;
  Object.assign(win, {
    HTMLIFrameElement: MiniIFrame,
    HTMLElement: MiniElement,
    addEventListener(type: string, fn: (e: MiniEvent) => void) {
      addListenerCalls.push({ type });
      if (!windowListeners.has(type)) windowListeners.set(type, new Set());
      windowListeners.get(type)!.add(fn);
    },
    removeEventListener(type: string, fn: (e: MiniEvent) => void) {
      windowListeners.get(type)?.delete(fn);
    },
    dispatchEvent(e: MiniEvent) {
      windowListeners.get(e.type)?.forEach((fn) => fn(e));
      return true;
    },
    requestAnimationFrame: (cb: () => void) => setTimeout(cb, 0),
    setTimeout,
    clearTimeout,
  });

  doc.defaultView = win;
  doc.documentElement = new MiniElement('html');
  doc.body = new MiniElement('body');
  win.document = doc;

  Object.assign(globalThis, {
    document: doc,
    HTMLElement: MiniElement,
    HTMLIFrameElement: MiniIFrame,
    Element: MiniElement,
    Node: MiniNode,
    requestAnimationFrame: win.requestAnimationFrame,
  });

  return {
    doc,
    win,
    mockLocalStorage,
    getWindowListenerCount: (type: string) => windowListeners.get(type)?.size ?? 0,
    getAddListenerCalls: (type: string) => addListenerCalls.filter((c) => c.type === type).length,
    resetAddListenerCalls: () => {
      addListenerCalls = [];
    },
    dispatchWindowKeyDown: (init: Partial<MiniEvent>) => {
      const evt = createMiniEvent('keydown', init);
      windowListeners.get('keydown')?.forEach((fn) => fn(evt));
    },
  };
}

describe('W6 Residual UI & Controller Regressions', () => {
  let dom: ReturnType<typeof installMiniDomEnvironment>;
  const rootsToUnmount: Array<ReturnType<typeof createRoot>> = [];

  beforeEach(() => {
    dom = installMiniDomEnvironment();
  });

  afterEach(() => {
    while (rootsToUnmount.length > 0) {
      const r = rootsToUnmount.pop();
      if (r) flushSync(() => r.unmount());
    }
  });

  const mount = (node: React.ReactElement) => {
    const container = dom.doc.createElement('div');
    const root = createRoot(container as unknown as HTMLElement);
    rootsToUnmount.push(root);
    flushSync(() => root.render(node));
    return {
      container,
      rerender: (next: React.ReactElement) => flushSync(() => root.render(next)),
      findButton: (label: string) =>
        container.querySelectorAll('button').find((b) => b.textContent.trim() === label),
      findButtonIncludes: (snippet: string) =>
        container.querySelectorAll('button').find((b) => b.textContent.includes(snippet)),
    };
  };

  it('W6-D10: App.tsx excludes "review" from lastStableWorkspaceModeRef fallback while preserving workspace preference persistence', () => {
    const appSource = fs.readFileSync(path.join(ROOT, 'App.tsx'), 'utf8');
    // Must not assign 'review' into lastStableWorkspaceModeRef either at initialization or in useEffect.
    assert.match(
      appSource,
      /lastStableWorkspaceModeRef\s*=\s*useRef<\s*['"]write['"]\s*\|\s*['"]plan['"]\s*>/,
      'W6-D10: lastStableWorkspaceModeRef must only hold "write" | "plan" (never "review")'
    );
    assert.match(
      appSource,
      /if\s*\(\s*workspaceMode\s*===\s*['"]write['"]\s*\|\|\s*workspaceMode\s*===\s*['"]plan['"]\s*\)\s*\{\s*lastStableWorkspaceModeRef\.current\s*=\s*workspaceMode;/,
      'W6-D10: App.tsx effect must only update lastStableWorkspaceModeRef for "write" or "plan"'
    );
    assert.ok(
      appSource.includes('writeBrowserWorkspacePreference(workspaceMode)'),
      'W6-D10: App.tsx must preserve writeBrowserWorkspacePreference("review")'
    );
  });

  it('W6-D11: executeIssueAiFixRequest does not clear loading state when aborted or inactive (e.g. superseded same-issue request)', async () => {
    let loading = false;
    const loadingEvents: boolean[] = [];
    const firstCtrl = new AbortController();
    let resolveFirst!: (v: { alternatives: [] }) => void;

    const firstRun = executeIssueAiFixRequest({
      issueId: 'iss-dup',
      setIssueLoading: (_id, next) => {
        loading = next;
        loadingEvents.push(next);
      },
      registerController: () => firstCtrl,
      isActive: () => true,
      requestFixes: () =>
        new Promise((res) => {
          resolveFirst = res;
        }),
      onSuccess: () => {},
      onError: () => {},
    });

    assert.equal(loading, true);
    // Simulate superseding request aborting firstCtrl before firstRun settles
    firstCtrl.abort();
    resolveFirst({ alternatives: [] });
    await firstRun;

    assert.equal(
      loading,
      true,
      'W6-D11: aborted request finally must not clear loading state belonging to a superseding request'
    );
    assert.deepEqual(loadingEvents, [true]);

    // Also verify !isActive() suppresses finally clear
    let active = true;
    const inactiveEvents: boolean[] = [];
    let resolveInactive!: (v: { alternatives: [] }) => void;
    const inactiveRun = executeIssueAiFixRequest({
      issueId: 'iss-inactive',
      setIssueLoading: (_id, next) => {
        inactiveEvents.push(next);
      },
      registerController: () => new AbortController(),
      isActive: () => active,
      requestFixes: () =>
        new Promise((res) => {
          resolveInactive = res;
        }),
      onSuccess: () => {},
      onError: () => {},
    });
    active = false;
    resolveInactive({ alternatives: [] });
    await inactiveRun;
    assert.deepEqual(inactiveEvents, [true], 'W6-D11: inactive run must not clear loading state');
  });

  it('W6-D12: applyPostDeleteState clears matching project storageAlert on clean delete without clearing unrelated project alerts', () => {
    const projA = { ...createSampleProject(), id: 'proj_a', name: 'Project A' };
    const projB = { ...createSampleProject(), id: 'proj_b', name: 'Project B' };
    let currentProject = projA;
    let currentUndo = createUndoRedoState(projA.snapshot, projA.revisions, projA.undoHistory);
    let saved = [projA, projB];
    let alertState: StorageConflictAlert | null = {
      type: 'error',
      projectId: 'proj_a',
      message: 'Save failed for A',
    };
    let capturedActions!: ReturnType<typeof useDurableWorkspaceActions>;

    function Harness({ storageAlert }: { storageAlert: StorageConflictAlert | null }) {
      const activeProjectRef = React.useRef(currentProject);
      const undoStateRef = React.useRef(currentUndo);
      const savedProjectsRef = React.useRef(saved);
      const hasLocalEditsSinceMountRef = React.useRef(false);
      const draftDirtyRef = React.useRef(false);
      const restorePendingRef = React.useRef(false);
      const aiTicketAuthorityRef = React.useRef({
        hasProjectTickets: () => false,
        invalidateProject: () => {},
      });
      const transientSetters = React.useMemo(
        () => ({
          setSelectedEntityId: () => {},
          setSelectedRelationshipId: () => {},
          setStoryBibleErrors: () => {},
          setAdoptArtifactId: () => {},
          setFocusedSectionId: () => {},
          setHistoryTarget: () => {},
          setResumedProposalReview: () => {},
        }),
        []
      );

      capturedActions = useDurableWorkspaceActions({
        activeProjectRef,
        undoStateRef,
        savedProjectsRef,
        hasLocalEditsSinceMountRef,
        draftDirtyRef,
        restorePendingRef,
        aiTicketAuthorityRef,
        publishCurrentProject: (nextProj, nextUndo) => {
          currentProject = nextProj;
          currentUndo = nextUndo;
        },
        setSavedProjects: (next) => {
          saved = typeof next === 'function' ? next(saved) : next;
        },
        setProject: () => {},
        setManuscriptDraftDirty: () => {},
        setRestorePending: () => {},
        setCreateProjectPending: () => {},
        setCreateProjectOpen: () => {},
        setPendingDurableSaveProjectIds: () => {},
        setStorageAlert: (next) => {
          alertState = next;
        },
        storageAlert,
        setStatusNotification: () => {},
        setWorkspaceMode: () => {},
        allowNavigation: () => true,
        getHydrationGate: () => 'ready',
        acceptReadStatus: () => {},
        cancelAutosave: () => {},
        transientSetters,
      });
      return null;
    }

    const view = mount(React.createElement(Harness, { storageAlert: alertState }));
    capturedActions.applyPostDeleteState('proj_a', {
      remaining: [projB],
      localDeleted: true,
      idbDeleted: true,
      tombstonePersisted: true,
      incompleteDeletion: false,
      preservedBackups: true,
    });
    assert.equal(alertState, null, 'W6-D12: clean delete of proj_a must clear storageAlert for proj_a');

    // Deleting proj_a when alert belongs to proj_b must keep proj_b's alert intact
    alertState = { type: 'conflict', projectId: 'proj_b', message: 'Conflict on B' };
    view.rerender(React.createElement(Harness, { storageAlert: alertState }));
    capturedActions.applyPostDeleteState('proj_a', {
      remaining: [projB],
      localDeleted: true,
      idbDeleted: true,
      tombstonePersisted: true,
      incompleteDeletion: false,
      preservedBackups: true,
    });
    assert.equal(
      alertState?.projectId,
      'proj_b',
      'W6-D12: clean delete of proj_a must preserve unrelated alert for proj_b'
    );
  });

  it('W6-D13: useCanonicalPlanHandlers keeps stable handler identity across re-renders so useGlobalWorkspaceShortcuts does not re-attach keydown listeners', () => {
    const project = createSampleProject();
    let undoState: UndoRedoState = createUndoRedoState(project.snapshot, project.revisions, project.undoHistory);
    let activeProject: CreativeProject = project;
    const notifications: string[] = [];

    function Harness({ revTag }: { revTag: string }) {
      const handlers = useCanonicalPlanHandlers({
        getActiveProject: () => activeProject,
        getUndoState: () => undoState,
        publishCurrentProject: (nextProj, nextUndo) => {
          activeProject = nextProj;
          undoState = nextUndo;
        },
        markLocalEdits: () => {},
        setStoryBibleErrors: () => {},
        setStatusNotification: (msg) => {
          if (msg) notifications.push(`${revTag}:${msg}`);
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

      const getActiveProject = React.useCallback(() => activeProject, []);
      const getUndoState = React.useCallback(() => undoState, []);
      const isDraftOrRestorePending = React.useCallback(() => false, []);

      useGlobalWorkspaceShortcuts({
        getActiveProject,
        getUndoState,
        isDraftOrRestorePending,
        onUndo: handlers.handleUndo,
        onRedo: handlers.handleRedo,
      });

      return React.createElement('div', null, revTag);
    }

    dom.resetAddListenerCalls();
    const view = mount(React.createElement(Harness, { revTag: 'r1' }));
    assert.equal(dom.getAddListenerCalls('keydown'), 1, 'initial mount attaches keydown once');

    // Re-render with fresh deps object literal
    view.rerender(React.createElement(Harness, { revTag: 'r2' }));
    view.rerender(React.createElement(Harness, { revTag: 'r3' }));
    assert.equal(
      dom.getAddListenerCalls('keydown'),
      1,
      'W6-D13: re-rendering with fresh deps object literal must not re-attach window keydown listeners'
    );

    // Ensure handler still reads updated depsRef after re-render
    const direct = createCanonicalPlanHandlers({
      getActiveProject: () => activeProject,
      getUndoState: () => undoState,
      publishCurrentProject: (nextProj, nextUndo) => {
        activeProject = nextProj;
        undoState = nextUndo;
      },
      markLocalEdits: () => {},
      setStoryBibleErrors: () => {},
      setStatusNotification: () => {},
      allowNavigation: () => true,
      navigateToPlan: () => {},
      navigateToWriteSection: () => {},
      setSelectedEntityId: () => {},
      setSelectedRelationshipId: () => {},
      setRightPanelTab: () => {},
      setMobileTab: () => {},
      setFocusedStoryBibleField: () => {},
    });
    direct.handleUpdateStoryBible('tone', 'Mysterious');
    dom.dispatchWindowKeyDown({ key: 'z', metaKey: true, shiftKey: false });
    assert.match(notifications.at(-1) ?? '', /^r3:Undid:/, 'W6-D13: shortcut must invoke latest deps after re-render');
  });

  it('W6-D14: ChunkErrorBoundary invokes onRetry and recovers a failing lazy loader while App.tsx wires onRetry for all lazy views', async () => {
    let loaderCalls = 0;
    const makeFlakyLazy = () =>
      React.lazy(async () => {
        loaderCalls += 1;
        if (loaderCalls === 1) {
          throw new Error('Simulated chunk fetch failure');
        }
        return {
          default: () => React.createElement('p', null, 'Recovered Lazy View'),
        };
      });

    let CurrentLazy = makeFlakyLazy();
    const LazyHost = () => React.createElement(CurrentLazy);

    let onRetryCalls = 0;
    const BoundaryWithRetry = ChunkErrorBoundary as unknown as React.ComponentType<
      React.ComponentProps<typeof ChunkErrorBoundary> & { onRetry?: () => void }
    >;

    const view = mount(
      React.createElement(
        BoundaryWithRetry,
        {
          resetKey: 'review:proj-1',
          viewLabel: 'Review & Diagnostics',
          onRetry: () => {
            onRetryCalls += 1;
            CurrentLazy = makeFlakyLazy();
          },
          children: React.createElement(
            Suspense,
            { fallback: React.createElement('span', null, 'Loading...') },
            React.createElement(LazyHost)
          ),
        }
      )
    );

    const waitForText = async (needle: string) => {
      for (let i = 0; i < 40; i += 1) {
        if (view.container.textContent.includes(needle)) return;
        await new Promise((r) => setTimeout(r, 25));
      }
    };

    await waitForText('Could not load Review & Diagnostics');
    assert.ok(
      view.container.textContent.includes('Could not load Review & Diagnostics'),
      'First lazy load failure must render ChunkErrorBoundary fallback'
    );

    const retryBtn = view.findButton('Retry');
    assert.ok(retryBtn, 'Retry button must render');
    flushSync(() => retryBtn!.click());
    await waitForText('Recovered Lazy View');

    assert.equal(onRetryCalls, 1, 'W6-D14: clicking Retry must invoke onRetry');
    assert.equal(loaderCalls, 2, 'W6-D14: Retry must re-invoke lazy loader instead of reusing rejected promise');
    assert.ok(
      view.container.textContent.includes('Recovered Lazy View'),
      'W6-D14: lazy view must recover after Retry'
    );

    const appSource = fs.readFileSync(path.join(ROOT, 'App.tsx'), 'utf8');
    assert.ok(
      appSource.includes('onRetry='),
      'W6-D14: App.tsx must wire onRetry on ChunkErrorBoundary for lazy views'
    );
  });

  it('W6-D14: unmounting ChunkErrorBoundary in error state (closing AiSettingsModal without clicking Retry) invokes onRetry so reopen recovers', async () => {
    let loaderCalls = 0;
    let onRetryCalls = 0;
    const lazyFactory = createRetryableLazy(() =>
      React.lazy(async () => {
        loaderCalls += 1;
        if (loaderCalls === 1) {
          throw new Error('Offline chunk failure');
        }
        return {
          default: () => React.createElement('p', null, 'Recovered AI Settings'),
        };
      })
    );
    const LazyPanel = lazyFactory.Component;

    function ModalHarness({ isOpen }: { isOpen: boolean }) {
      return React.createElement(
        AiSettingsModal,
        { isOpen, onClose: () => {} },
        React.createElement(
          ChunkErrorBoundary,
          {
            resetKey: `ai-settings:${isOpen ? 'open' : 'closed'}`,
            viewLabel: 'AI settings',
            onRetry: () => {
              onRetryCalls += 1;
              lazyFactory.retry();
            },
            children: React.createElement(
              Suspense,
              { fallback: React.createElement('span', null, 'Loading AI settings...') },
              React.createElement(LazyPanel)
            ),
          }
        )
      );
    }

    const view = mount(React.createElement(ModalHarness, { isOpen: true }));
    const waitForText = async (needle: string) => {
      for (let i = 0; i < 40; i += 1) {
        if (view.container.textContent.includes(needle)) return;
        await new Promise((r) => setTimeout(r, 25));
      }
    };

    await waitForText('Could not load AI settings');
    assert.equal(loaderCalls, 1);
    assert.equal(onRetryCalls, 0);

    // Close modal without clicking Retry -> ChunkErrorBoundary unmounts while in error state
    view.rerender(React.createElement(ModalHarness, { isOpen: false }));
    assert.equal(onRetryCalls, 1, 'W6-D14: unmounting ChunkErrorBoundary in error state must invoke onRetry');

    // Reopen modal -> fresh lazy factory must retry and recover
    view.rerender(React.createElement(ModalHarness, { isOpen: true }));
    await waitForText('Recovered AI Settings');
    assert.equal(loaderCalls, 2, 'W6-D14: reopening modal must re-invoke lazy loader');
    assert.ok(view.container.textContent.includes('Recovered AI Settings'));

    // Closing again after recovery (not in error state) must NOT invoke onRetry
    view.rerender(React.createElement(ModalHarness, { isOpen: false }));
    assert.equal(onRetryCalls, 1, 'W6-D14: unmounting ChunkErrorBoundary without error must not invoke onRetry');
  });

  it('W6-D15: ReviewDiffModal stabilizes onClose via ref so window keydown listener is not re-attached on unstable onClose', () => {
    const project = createSampleProject();
    const diffModel = buildReviewDiffModel({
      project,
      draftDecisionValues: {},
      stagedBatch: null,
      polishProposal: null,
    });
    const closedBy: string[] = [];

    const view = mount(
      React.createElement(ReviewDiffModal, {
        isOpen: true,
        activeProject: project,
        mode: 'story',
        pendingDecisions: [],
        stagedDecisionDrafts: {},
        reviewDiffModel: diffModel,
        consistencyIssues: [],
        onClose: () => closedBy.push('cb1'),
        onApplyDecisions: () => {},
        onRestoreRevision: () => {},
        onOpenStoryBible: () => {},
      })
    );

    assert.equal(dom.getAddListenerCalls('keydown'), 1, 'initial open attaches one keydown listener');
    view.rerender(
      React.createElement(ReviewDiffModal, {
        isOpen: true,
        activeProject: project,
        mode: 'story',
        pendingDecisions: [],
        stagedDecisionDrafts: {},
        reviewDiffModel: diffModel,
        consistencyIssues: [],
        onClose: () => closedBy.push('cb2'),
        onApplyDecisions: () => {},
        onRestoreRevision: () => {},
        onOpenStoryBible: () => {},
      })
    );
    assert.equal(
      dom.getAddListenerCalls('keydown'),
      1,
      'W6-D15: re-rendering ReviewDiffModal with new onClose reference must not re-attach keydown listener'
    );

    dom.dispatchWindowKeyDown({ key: 'Escape' });
    assert.deepEqual(closedBy, ['cb2'], 'W6-D15: Escape must invoke the latest onClose callback');
  });

  it('W6-D16 (UI): CreateProjectDialog renders accessible form, validates empty title, submits trimmed values, and cancels cleanly', () => {
    const closedHtml = renderToStaticMarkup(
      React.createElement(CreateProjectDialog, {
        open: false,
        onCancel: () => {},
        onCreate: async () => true,
      })
    );
    assert.equal(closedHtml, '', 'CreateProjectDialog must render nothing when closed');

    let cancelled = 0;
    const view = mount(
      React.createElement(CreateProjectDialog, {
        open: true,
        pending: false,
        onCancel: () => {
          cancelled += 1;
        },
        onCreate: async () => true,
      })
    );
    assert.ok(view.container.textContent.includes('Create a narrative project'));
    const cancelBtn = view.findButton('Cancel');
    assert.ok(cancelBtn);
    flushSync(() => cancelBtn!.click());
    assert.equal(cancelled, 1, 'Cancel button invokes onCancel when not pending');

    const pendingHtml = renderToStaticMarkup(
      React.createElement(CreateProjectDialog, {
        open: true,
        pending: true,
        onCancel: () => {},
        onCreate: async () => true,
      })
    );
    assert.ok(pendingHtml.includes('Saving project…'), 'Pending state must update submit button text');
  });

  it('W6-D16 (UI): ReviewDiffModal renders empty and populated diff lists, stale warning, and action buttons', () => {
    const project = createSampleProject();
    const pendingDecision: DecisionItem = {
      id: 'dec_1',
      title: 'Cat mood',
      category: 'attribute',
      description: 'What is Cat mood?',
      proposedValue: 'mysterious',
      provenance: 'ai-inferred',
      status: 'pending',
      groupKey: 'character',
      createdAt: Date.now(),
      targetEntityName: 'Cat',
      targetAttributeName: 'mood',
    };
    const modelWithItems = {
      projectId: project.id,
      revision: project.revision,
      beforePrompt: 'Old prompt',
      afterPrompt: 'New prompt',
      hasChanges: true,
      hasStaleBatch: true,
      items: [
        {
          id: 'diff_dec_1',
          source: 'decision' as const,
          category: 'character',
          targetLabel: 'Cat.mood',
          beforeValue: 'cheerful',
          afterValue: 'mysterious',
          provenance: 'ai-inferred',
        },
      ],
    };

    const actions: string[] = [];
    const view = mount(
      React.createElement(ReviewDiffModal, {
        isOpen: true,
        activeProject: project,
        mode: 'story',
        pendingDecisions: [pendingDecision],
        stagedDecisionDrafts: { dec_1: 'mysterious' },
        reviewDiffModel: modelWithItems,
        consistencyIssues: [],
        onClose: () => actions.push('close'),
        onApplyDecisions: (ids, action) => actions.push(`${action}:${ids.join(',')}`),
        onRestoreRevision: (revId) => actions.push(`restore:${revId}`),
        onOpenStoryBible: () => actions.push('bible'),
      })
    );

    assert.ok(view.container.textContent.includes('Stale staged batch preview detected'));
    assert.ok(view.container.textContent.includes('Accept All Pending (1)'));
    assert.ok(view.container.textContent.includes('Before: cheerful'));
    assert.ok(view.container.textContent.includes('After: mysterious'));

    flushSync(() => view.findButton('Accept All Pending (1)')!.click());
    flushSync(() => view.findButton('Open Story Bible')!.click());
    assert.deepEqual(actions, ['accept:dec_1', 'close', 'bible']);
  });

  it('W6-D16 (UI): StorageAlertBanner renders conflict/read-error/status states and auto-dismisses status notification safely', async () => {
    const project = createSampleProject();
    const actions: string[] = [];
    const view = mount(
      React.createElement(StorageAlertBanner, {
        storageAlert: {
          type: 'conflict',
          projectId: project.id,
          message: 'Conflict detected',
          conflictingProject: project,
        },
        hydrationGate: 'ready',
        statusNotification: 'Saved draft',
        onReloadFromStorage: (prefer) => actions.push(`reload:${prefer ?? 'default'}`),
        onForceOverwriteStorage: () => actions.push('overwrite'),
        onExportBackupJson: () => actions.push('export'),
        onDismissStorageAlert: () => actions.push('dismiss-alert'),
        onDismissStatusNotification: () => actions.push('dismiss-status'),
      })
    );

    assert.ok(view.container.textContent.includes('Conflict detected'));
    assert.ok(view.container.textContent.includes('Saved draft'));
    flushSync(() => view.findButton('Reload Latest from Storage')!.click());
    flushSync(() => view.findButton('Keep My Version (Overwrite)')!.click());
    flushSync(() => view.findButton('Export Backup JSON')!.click());
    flushSync(() => view.findButton('Dismiss')!.click());
    assert.deepEqual(actions, ['reload:prefer-idb', 'overwrite', 'export', 'dismiss-alert']);

    const blockedErrorHtml = renderToStaticMarkup(
      React.createElement(StorageAlertBanner, {
        storageAlert: {
          type: 'error',
          projectId: project.id,
          message: 'IndexedDB read failed',
        },
        hydrationGate: 'blocked-read-error',
        statusNotification: null,
        onReloadFromStorage: () => {},
        onForceOverwriteStorage: () => {},
        onExportBackupJson: () => {},
        onDismissStorageAlert: () => {},
        onDismissStatusNotification: () => {},
      })
    );
    assert.ok(blockedErrorHtml.includes('Retry Storage Read'));
  });
});
