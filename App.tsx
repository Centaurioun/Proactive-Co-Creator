/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

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
  mergeAnalysisIntoSnapshot,
  removeRelationship,
  renameEntity,
  setEntityAttribute,
  updateStoryBibleField,
  upsertRelationship,
} from './lib/canonicalModel';
import { evaluateProjectConsistency } from './lib/consistencyChecker';
import {
  createUndoRedoState,
  performRedo,
  performUndo,
  pushUndoableTransaction,
  recordProjectRevision,
  restoreProjectRevision,
  type UndoRedoState,
} from './lib/historyEngine';
import {
  applyProposedOperations,
  interpretBatchInstructionLocally,
} from './lib/nlBatchEngine';
import { synthesizeRefinedPrompt } from './lib/promptBuilder';
import {
  deleteProjectFromLocalStorage,
  exportProjectToJson,
  exportStoryBibleMarkdown,
  loadProjectsFromLocalStorage,
  migrateProjectPayload,
  saveProjectToIndexedDb,
  saveProjectToLocalStorage,
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
import type {
  BatchEditProposalResult,
  CreativeProject,
  DecisionItem,
  EntityCategory,
  GenerationMode,
  ProjectSnapshot,
  ProposedOperation,
  StoryBibleFields,
} from './shared/types';

type MobileTab = 'decisions' | 'graph' | 'inspector' | 'output';

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
    createUndoRedoState(initialProject.snapshot)
  );

  const snapshot = undoState.present;
  const mode = snapshot.mode;

  // Selection & UI workspace navigation
  const [selectedEntityId, setSelectedEntityId] = useState<string | null>(null);
  const [rightPanelTab, setRightPanelTab] = useState<RightPanelTab>('inspector');
  const [mobileTab, setMobileTab] = useState<MobileTab>('graph');
  const [showOutputDrawer, setShowOutputDrawer] = useState<boolean>(true);
  const [isDarkMode, setIsDarkMode] = useState<boolean>(false);
  const [showInfoModal, setShowInfoModal] = useState<boolean>(false);
  const [statusNotification, setStatusNotification] = useState<string | null>(null);

  // Loading & Error States
  const [isGraphLoading, setIsGraphLoading] = useState(false);
  const [isClarificationsLoading, setIsClarificationsLoading] = useState(false);
  const [isBatchLoading, setIsBatchLoading] = useState(false);
  const [isGenerating, setIsGenerating] = useState(false);
  const [isPolishingPrompt, setIsPolishingPrompt] = useState(false);

  const [analysisError, setAnalysisError] = useState<string | null>(null);
  const [clarificationError, setClarificationError] = useState<string | null>(null);
  const [galleryErrors, setGalleryErrors] = useState<Record<GenerationMode, string | null>>({
    story: null,
    image: null,
  });

  const graphAbortRef = useRef<AbortController | null>(null);
  const clarifyAbortRef = useRef<AbortController | null>(null);
  const generationAbortRef = useRef<AbortController | null>(null);

  // Derive synchronized active project with current undoState.present snapshot
  const activeProject = useMemo<CreativeProject>(() => {
    if (project.snapshot === undoState.present) return project;
    const promptChanged = project.snapshot.refinedPrompt !== undoState.present.refinedPrompt;
    const updatedArtifacts = promptChanged
      ? project.artifacts.map((a) => ({ ...a, isOutdated: true }))
      : project.artifacts;
    return {
      ...project,
      snapshot: undoState.present,
      artifacts: updatedArtifacts,
    };
  }, [project, undoState.present]);

  useEffect(() => {
    const timer = setTimeout(() => {
      const res = saveProjectToLocalStorage(activeProject);
      if (res.conflictDetected && res.error) {
        setStatusNotification(res.error);
      }
      void saveProjectToIndexedDb(activeProject);
      setSavedProjects((prev) => {
        const idx = prev.findIndex((p) => p.id === activeProject.id);
        if (idx === -1) return [activeProject, ...prev];
        const copy = [...prev];
        copy[idx] = activeProject;
        return copy;
      });
    }, 250);
    return () => clearTimeout(timer);
  }, [activeProject]);

  useEffect(() => {
    if (isDarkMode) {
      document.documentElement.classList.add('dark');
      document.body.style.backgroundColor = '#0d1117';
    } else {
      document.documentElement.classList.remove('dark');
      document.body.style.backgroundColor = '#f3f4f6';
    }
  }, [isDarkMode]);

  // Keyboard shortcuts for Undo / Redo
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable)) {
        return;
      }
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'z') {
        e.preventDefault();
        if (e.shiftKey) {
          setUndoState((prev) => performRedo(prev).state);
        } else {
          setUndoState((prev) => performUndo(prev).state);
        }
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  const commitTransaction = useCallback(
    (nextSnapshot: ProjectSnapshot, label: string, summary?: string, changeCount: number = 1) => {
      setUndoState((prev) => pushUndoableTransaction(prev, nextSnapshot, label));
      setProject((prev) =>
        recordProjectRevision(
          { ...prev, snapshot: nextSnapshot },
          label,
          summary ?? label,
          changeCount
        )
      );
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

  const consistencyIssues = useMemo(
    () => evaluateProjectConsistency(snapshot),
    [snapshot]
  );

  const latestStoryArtifact = useMemo(
    () => project.artifacts.find((a) => a.mode === 'story' && a.storyText),
    [project.artifacts]
  );

  const latestImageArtifact = useMemo(
    () => project.artifacts.find((a) => a.mode === 'image' && a.images && a.images.length > 0),
    [project.artifacts]
  );

  const isCurrentOutputOutdated = useMemo(() => {
    const activeArt = mode === 'story' ? latestStoryArtifact : latestImageArtifact;
    return Boolean(activeArt?.isOutdated);
  }, [mode, latestStoryArtifact, latestImageArtifact]);

  // --- Handlers for Deterministic Local Creative Edits ---

  const handleSetOriginalIdea = (newIdea: string) => {
    const next: ProjectSnapshot = {
      ...snapshot,
      originalIdea: newIdea,
    };
    next.refinedPrompt = synthesizeRefinedPrompt(next);
    setUndoState((prev) => ({ ...prev, present: next }));
  };

  const handleSetFreeformNotes = (notes: string) => {
    const next: ProjectSnapshot = {
      ...snapshot,
      freeformNotes: notes,
    };
    next.refinedPrompt = synthesizeRefinedPrompt(next);
    commitTransaction(next, 'Update Author Notes', 'Updated freeform author notes.');
  };

  const handleModeChange = (newMode: GenerationMode) => {
    if (newMode === mode) return;
    const next: ProjectSnapshot = {
      ...snapshot,
      mode: newMode,
    };
    next.refinedPrompt = synthesizeRefinedPrompt(next, newMode);
    setUndoState((prev) => ({ ...prev, present: next }));
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

  const handleRemoveRelationship = (relIdOrSource: string, target?: string) => {
    const next = removeRelationship(snapshot, relIdOrSource, target);
    commitTransaction(
      next,
      `Remove relationship`,
      `Removed relationship from ${relIdOrSource}${target ? ` to ${target}` : ''}.`
    );
  };

  const handleUpdateStoryBible = (field: keyof StoryBibleFields, value: string) => {
    const next = updateStoryBibleField(snapshot, field, value, 'user-edit');
    commitTransaction(
      next,
      `Update Story Bible: ${field}`,
      `Set Story Bible ${field} to "${value}".`
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
      setRightPanelTab('story-bible');
      setMobileTab('inspector');
      return;
    }
    if (decision.targetEntityId || decision.targetEntityName) {
      const target = snapshot.entities.find(
        (e) =>
          e.id === decision.targetEntityId ||
          e.name.toLowerCase() === decision.targetEntityName?.toLowerCase()
      );
      if (target) {
        setSelectedEntityId(target.id ?? target.name);
        setRightPanelTab('inspector');
        setMobileTab('inspector');
      }
    }
  };

  // --- Natural-Language Batch Editing ---

  const handlePreviewBatchInstruction = async (
    instruction: string
  ): Promise<BatchEditProposalResult> => {
    // First run fast deterministic local interpreter
    const localResult = interpretBatchInstructionLocally(instruction, snapshot);
    if (localResult.operations.length > 0 || localResult.ambiguities.length > 0) {
      return localResult;
    }

    // Fallback to server-side Gemini batch interpretation if local rules didn't match
    setIsBatchLoading(true);
    try {
      const aiResult = await requestBatchEditInterpretation(instruction, {
        prompt: snapshot.refinedPrompt,
        entities: snapshot.entities.map((e) => ({
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
        relationships: snapshot.relationships.map((r) => ({
          id: r.id,
          source: r.source,
          target: r.target,
          label: r.label,
        })),
      });
      return aiResult;
    } catch {
      return localResult;
    } finally {
      setIsBatchLoading(false);
    }
  };

  const handleApplyBatchOperations = (
    operations: ProposedOperation[],
    instruction: string
  ) => {
    const res = applyProposedOperations(snapshot, operations);
    if (res.appliedCount > 0) {
      commitTransaction(
        res.snapshot,
        `Batch Edit (${res.appliedCount} ops)`,
        `Applied natural-language batch edit: "${instruction}"`,
        res.appliedCount
      );
      setStatusNotification(`Applied ${res.appliedCount} batch operation(s). Undo available.`);
    }
  };

  // --- AI Analysis, Clarifications & Generation ---

  const handleAnalyzeIdea = useCallback(async () => {
    const trimmed = snapshot.originalIdea.trim();
    if (!trimmed) return;

    graphAbortRef.current?.abort();
    clarifyAbortRef.current?.abort();
    const graphController = new AbortController();
    const clarifyController = new AbortController();
    graphAbortRef.current = graphController;
    clarifyAbortRef.current = clarifyController;

    setIsGraphLoading(true);
    setIsClarificationsLoading(true);
    setAnalysisError(null);
    setClarificationError(null);

    const confirmedFacts = [
      ...Object.entries(snapshot.storyBible)
        .filter(([, f]) => f.status === 'confirmed' && f.value)
        .map(([k, f]) => `${k}: ${f.value}`),
      ...snapshot.entities
        .filter((e) => !e.excluded)
        .flatMap((e) =>
          e.attributes
            .filter((a) => a.status === 'confirmed' && a.confirmedValue)
            .map((a) => `${e.name} ${a.name}: ${a.confirmedValue}`)
        ),
    ];

    try {
      const [newGraph, newClarifications] = await Promise.all([
        analyzePromptToBeliefGraph(trimmed, mode, graphController.signal).catch((err) => {
          if (!isAbortError(err)) {
            setAnalysisError(
              getReadableErrorMessage(err, 'Could not reach AI analysis service; local plan preserved.')
            );
          }
          return null;
        }),
        generateClarifications(
          trimmed,
          [...snapshot.answeredQuestions, ...snapshot.skippedQuestions],
          mode,
          clarifyController.signal,
          confirmedFacts
        ).catch((err) => {
          if (!isAbortError(err)) {
            setClarificationError(
              getReadableErrorMessage(err, 'Could not fetch new AI questions; existing decisions preserved.')
            );
          }
          return null;
        }),
      ]);

      if (newGraph || newClarifications) {
        const merged = mergeAnalysisIntoSnapshot(snapshot, newGraph, newClarifications);
        commitTransaction(
          merged,
          'Reanalyze Prompt with AI',
          'Merged AI analysis while preserving confirmed user decisions.'
        );
      }
    } finally {
      setIsGraphLoading(false);
      setIsClarificationsLoading(false);
    }
  }, [snapshot, mode, commitTransaction]);

  const handleRefreshClarifications = useCallback(async () => {
    clarifyAbortRef.current?.abort();
    const controller = new AbortController();
    clarifyAbortRef.current = controller;

    setIsClarificationsLoading(true);
    setClarificationError(null);

    const confirmedFacts = snapshot.entities
      .filter((e) => !e.excluded)
      .flatMap((e) =>
        e.attributes
          .filter((a) => a.status === 'confirmed' && a.confirmedValue)
          .map((a) => `${e.name} ${a.name}: ${a.confirmedValue}`)
      );

    try {
      const freshClarifications = await generateClarifications(
        snapshot.refinedPrompt || snapshot.originalIdea,
        [...snapshot.answeredQuestions, ...snapshot.skippedQuestions],
        mode,
        controller.signal,
        confirmedFacts
      );
      const merged = mergeAnalysisIntoSnapshot(snapshot, null, freshClarifications);
      commitTransaction(merged, 'Request Additional Clarifications');
    } catch (err) {
      if (!isAbortError(err)) {
        setClarificationError(
          getReadableErrorMessage(err, 'Failed to request additional clarifications.')
        );
      }
    } finally {
      setIsClarificationsLoading(false);
    }
  }, [snapshot, mode, commitTransaction]);

  const handleGenerateOutput = useCallback(async () => {
    const promptToUse = (snapshot.refinedPrompt || snapshot.originalIdea).trim();
    if (!promptToUse) return;

    generationAbortRef.current?.abort();
    const controller = new AbortController();
    generationAbortRef.current = controller;

    const requestMode = mode;
    setIsGenerating(true);
    setShowOutputDrawer(true);
    setGalleryErrors((prev) => ({ ...prev, [requestMode]: null }));

    try {
      if (requestMode === 'story') {
        const generatedStory = await generateStoryFromPrompt(promptToUse, controller.signal);
        const newArt = {
          id: makeStableId('art_story'),
          mode: 'story' as const,
          createdAt: Date.now(),
          revisionId: project.revisions[0]?.id ?? 'rev_latest',
          promptUsed: promptToUse,
          storyText: generatedStory,
          isOutdated: false,
        };
        setProject((prev) => ({
          ...prev,
          updatedAt: Date.now(),
          artifacts: [newArt, ...prev.artifacts.filter((a) => a.mode !== 'story')],
        }));
      } else {
        const result = await generateImagesFromPrompt(promptToUse, controller.signal);
        const newArt = {
          id: makeStableId('art_img'),
          mode: 'image' as const,
          createdAt: Date.now(),
          revisionId: project.revisions[0]?.id ?? 'rev_latest',
          promptUsed: promptToUse,
          images: result.images,
          warning: result.warning,
          isOutdated: false,
        };
        setProject((prev) => ({
          ...prev,
          updatedAt: Date.now(),
          artifacts: [newArt, ...prev.artifacts.filter((a) => a.mode !== 'image')],
        }));
      }
    } catch (err) {
      if (!isAbortError(err)) {
        const message = getReadableErrorMessage(
          err,
          `Failed to generate ${requestMode}. Check your server API key configuration.`
        );
        setGalleryErrors((prev) => ({ ...prev, [requestMode]: message }));
      }
    } finally {
      setIsGenerating(false);
    }
  }, [snapshot.refinedPrompt, snapshot.originalIdea, mode, project.revisions]);

  const handlePolishPromptWithAi = async () => {
    if (isPolishingPrompt) return;
    setIsPolishingPrompt(true);
    try {
      const polished = await refinePromptWithAllUpdates(
        snapshot.refinedPrompt,
        [],
        []
      );
      const next: ProjectSnapshot = {
        ...snapshot,
        refinedPrompt: polished,
      };
      commitTransaction(next, 'AI Polish Refined Prompt');
    } catch (err) {
      setStatusNotification(
        getReadableErrorMessage(err, 'Could not run AI prompt polish; structured prompt preserved.')
      );
    } finally {
      setIsPolishingPrompt(false);
    }
  };

  // --- Persistence, History & Export/Import Handlers ---

  const handleUndo = () => {
    const { state, undoneLabel } = performUndo(undoState);
    setUndoState(state);
    if (undoneLabel) {
      setStatusNotification(`Undid: ${undoneLabel}`);
    }
  };

  const handleRedo = () => {
    const { state, redoneLabel } = performRedo(undoState);
    setUndoState(state);
    if (redoneLabel) {
      setStatusNotification(`Redid: ${redoneLabel}`);
    }
  };

  const handleRestoreRevision = (revisionId: string) => {
    const res = restoreProjectRevision(activeProject, undoState, revisionId);
    if (!res) return;
    setProject(res.project);
    setUndoState(res.undoState);
    setStatusNotification('Restored project revision safely (previous state saved in history).');
  };

  const handleResetSampleProject = () => {
    const sample = createSampleProject();
    setProject(sample);
    setUndoState(createUndoRedoState(sample.snapshot));
    setSelectedEntityId(null);
    saveProjectToLocalStorage(sample);
    setStatusNotification('Loaded sample story plan: "Cat’s Woodland Dinner Party".');
  };

  const handleSwitchProject = (projectId: string) => {
    const target = savedProjects.find((p) => p.id === projectId);
    if (!target) return;
    setProject(target);
    setUndoState(createUndoRedoState(target.snapshot));
    setSelectedEntityId(null);
  };

  const handleCreateNewProject = (name: string, initialPrompt: string) => {
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
      schemaVersion: 2,
      id: makeStableId('proj'),
      name,
      createdAt: now,
      updatedAt: now,
      snapshot: newSnap,
      artifacts: [],
      revisions: [
        {
          id: makeStableId('rev'),
          timestamp: now,
          label: 'Created Project',
          summary: `Created project "${name}"`,
          changeCount: 0,
          snapshot: structuredClone(newSnap),
        },
      ],
    };
    setProject(newProj);
    setUndoState(createUndoRedoState(newSnap));
    saveProjectToLocalStorage(newProj);
  };

  const handleDeleteProject = (projectId: string) => {
    const remaining = deleteProjectFromLocalStorage(projectId);
    setSavedProjects(remaining);
    if (project.id === projectId && remaining.length > 0) {
      setProject(remaining[0]);
      setUndoState(createUndoRedoState(remaining[0].snapshot));
    }
  };

  const handleExportJson = () => {
    downloadTextFile(
      `${activeProject.name.toLowerCase().replace(/[^a-z0-9]+/g, '-') || 'project'}.json`,
      exportProjectToJson(activeProject),
      'application/json;charset=utf-8'
    );
  };

  const handleExportStoryBibleMarkdown = () => {
    downloadTextFile(
      `${activeProject.name.toLowerCase().replace(/[^a-z0-9]+/g, '-') || 'story'}-bible.md`,
      exportStoryBibleMarkdown(activeProject),
      'text/markdown;charset=utf-8'
    );
  };

  const handleExportPromptText = () => {
    downloadTextFile('refined-prompt.md', snapshot.refinedPrompt, 'text/markdown;charset=utf-8');
  };

  const handleImportProjectJson = (rawJson: string): { ok: boolean; error?: string } => {
    try {
      const parsed = JSON.parse(rawJson) as unknown;
      const migrated = migrateProjectPayload(parsed);
      setProject(migrated);
      setUndoState(createUndoRedoState(migrated.snapshot));
      saveProjectToLocalStorage(migrated);
      setStatusNotification(`Imported project "${migrated.name}".`);
      return { ok: true };
    } catch (err) {
      return {
        ok: false,
        error: err instanceof Error ? err.message : 'Invalid project JSON file.',
      };
    }
  };

  const handleSelectHeaderSection = (section: WorkspaceSection) => {
    if (section === 'story-bible') {
      setRightPanelTab('story-bible');
      setMobileTab('inspector');
    } else if (section === 'history') {
      setRightPanelTab('history');
      setMobileTab('inspector');
    } else if (section === 'output') {
      setShowOutputDrawer(true);
      setMobileTab('output');
    } else {
      setRightPanelTab('inspector');
      setMobileTab('graph');
    }
  };

  const pendingDecisionCount = snapshot.decisions.filter((d) => d.status === 'pending').length;

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

      {statusNotification && (
        <div
          className="fixed top-16 left-1/2 -translate-x-1/2 z-[2000] px-4 w-full max-w-md"
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
            onApplyDecisions={handleApplyDecisions}
            onInspectDecisionTarget={handleInspectDecisionTarget}
            onRefreshClarifications={handleRefreshClarifications}
            isClarificationsLoading={isClarificationsLoading}
            clarificationError={clarificationError}
            onPreviewBatchInstruction={handlePreviewBatchInstruction}
            onApplyBatchOperations={handleApplyBatchOperations}
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
              onSelectEntity={(ent) => {
                setSelectedEntityId(ent ? (ent.id ?? ent.name) : null);
                if (ent) {
                  setRightPanelTab('inspector');
                }
              }}
              onRelationshipChange={handleUpsertRelationship}
              onAttributeChange={handleAttributeChange}
              currentPrompt={snapshot.originalIdea}
            />
          </div>

          {(showOutputDrawer || mobileTab === 'output') && (
            <div
              className={`flex-shrink-0 ${
                mobileTab === 'output'
                  ? 'flex-1 min-h-0 xl:flex-none xl:h-64'
                  : 'hidden xl:block xl:h-64'
              }`}
            >
              <OutputDisplay
                originalIdea={snapshot.originalIdea}
                refinedPrompt={snapshot.refinedPrompt}
                freeformNotes={snapshot.freeformNotes}
                onChangeFreeformNotes={handleSetFreeformNotes}
                onPolishPromptWithAi={handlePolishPromptWithAi}
                isPolishingPrompt={isPolishingPrompt}
                images={latestImageArtifact?.images ?? []}
                imageWarning={latestImageArtifact?.warning ?? null}
                story={latestStoryArtifact?.storyText ?? null}
                mode={mode}
                isLoading={isGenerating}
                error={galleryErrors[mode]}
                isOutdated={isCurrentOutputOutdated}
                onGenerate={handleGenerateOutput}
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
            onSelectTab={setRightPanelTab}
            project={activeProject}
            savedProjects={savedProjects}
            selectedEntity={selectedEntity}
            selectedRelationship={null}
            onSelectEntity={(ent) => setSelectedEntityId(ent ? (ent.id ?? ent.name) : null)}
            onAttributeChange={handleAttributeChange}
            onRenameEntity={handleRenameEntity}
            onAddEntity={handleAddEntity}
            onUpsertRelationship={handleUpsertRelationship}
            onRemoveRelationship={handleRemoveRelationship}
            onUpdateStoryBible={handleUpdateStoryBible}
            consistencyIssues={consistencyIssues}
            onRestoreRevision={handleRestoreRevision}
            onSwitchProject={handleSwitchProject}
            onCreateNewProject={handleCreateNewProject}
            onDeleteProject={handleDeleteProject}
            onExportJson={handleExportJson}
            onExportStoryBibleMarkdown={handleExportStoryBibleMarkdown}
            onExportPromptText={handleExportPromptText}
            onImportProjectJson={handleImportProjectJson}
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
        onReviewChanges={() => {
          setShowOutputDrawer(true);
          setRightPanelTab('story-bible');
        }}
        mode={mode}
        onModeChange={handleModeChange}
        onGenerate={handleGenerateOutput}
        isGenerating={isGenerating}
        showOutputDrawer={showOutputDrawer}
        onToggleOutputDrawer={() => setShowOutputDrawer((prev) => !prev)}
        revisionCount={project.revisions.length}
        isOutdated={isCurrentOutputOutdated}
      />

      <InfoModal isOpen={showInfoModal} onClose={() => setShowInfoModal(false)} />
    </div>
  );
}

export default App;
