/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ClientApiError,
  fetchAiCapabilities,
  generateClarifications,
  generateImagesFromPrompt,
  generateStoryFromPrompt,
  isAbortError,
  refinePromptWithAllUpdates,
  requestBatchEditInterpretation,
  type AiProviderSelection,
} from '../../services/apiClient';
import { MAX_PROMPT_CHARS, validateEffectivePromptLength } from '../../shared/schemas';
import type {
  AiPolishProposal,
  BatchCommitResult,
  BatchEditProposalResult,
  CreativeProject,
  GenerationMode,
} from '../../shared/types';
import type { UndoRedoState } from '../historyEngine';
import { interpretBatchInstructionLocally } from '../nlBatchEngine';
import {
  acceptPolishProposal,
  commitBatchPreviewToProject,
  createPolishProposal,
  runAsyncClarifySlot,
  runAsyncGenerationSlot,
  validatePolishProposalAcceptance,
  type AiTicketAuthority,
} from '../projectController';
import { resolveProviderPrompt } from '../promptBuilder';
import { sameProjectVersion } from './projectListSync';
import {
  readSafeStoryProviderSelection,
  resolveStoryProviderPreflight,
} from './storyProviderSelection';

export type StoryProviderUsage = {
  inputTokens?: number;
  outputTokens?: number;
  source: 'provider-observed' | 'estimate' | 'unknown';
};
export type StoryProviderUsageRecord = { storyText: string; usage: StoryProviderUsage };

export function getReadableErrorMessage(error: unknown, fallback: string): string {
  if (error instanceof ClientApiError) return error.message;
  if (error instanceof Error && error.message) return error.message;
  return fallback;
}

export interface UseAiPlanActionsDeps {
  activeProject: CreativeProject;
  activeProjectRef: React.MutableRefObject<CreativeProject>;
  undoStateRef: React.MutableRefObject<UndoRedoState>;
  savedProjectsRef: React.MutableRefObject<CreativeProject[]>;
  hasLocalEditsSinceMountRef: React.MutableRefObject<boolean>;
  aiTicketAuthorityRef: React.MutableRefObject<AiTicketAuthority>;
  setProject: React.Dispatch<React.SetStateAction<CreativeProject>>;
  setUndoState: React.Dispatch<React.SetStateAction<UndoRedoState>>;
  setSavedProjects: React.Dispatch<React.SetStateAction<CreativeProject[]>>;
  setShowOutputDrawer: React.Dispatch<React.SetStateAction<boolean>>;
  setStatusNotification: (msg: string | null) => void;
  setAnalysisErrors: React.Dispatch<React.SetStateAction<Record<string, string | null>>>;
  setClarificationErrors: React.Dispatch<React.SetStateAction<Record<string, string | null>>>;
  setGalleryErrors: React.Dispatch<
    React.SetStateAction<Record<string, Record<GenerationMode, string | null>>>
  >;
}

export function useAiPlanActions(deps: UseAiPlanActionsDeps) {
  const {
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
    setClarificationErrors,
    setGalleryErrors,
  } = deps;

  const [aiConfigured, setAiConfigured] = useState<boolean>(false);
  const [chatGptStoryLocalActivation, setChatGptStoryLocalActivation] = useState(false);
  const chatGptStoryLocalActivationRef = useRef(false);
  const [storyProviderSelection, setStoryProviderSelection] = useState<AiProviderSelection>(
    readSafeStoryProviderSelection
  );
  const [lastStoryProviderUsage, setLastStoryProviderUsage] =
    useState<StoryProviderUsageRecord | null>(null);
  const [polishProposalsByProject, setPolishProposalsByProject] = useState<
    Record<string, AiPolishProposal>
  >({});
  const appliedBatchProposalIdsRef = useRef<Set<string>>(new Set());

  useEffect(() => {
    let cancelled = false;
    void fetchAiCapabilities()
      .then((cap) => {
        if (!cancelled) {
          setAiConfigured(Boolean(cap.configured));
          setChatGptStoryLocalActivation(cap.chatGptStoryLocalActivation === true);
          chatGptStoryLocalActivationRef.current = cap.chatGptStoryLocalActivation === true;
        }
      })
      .catch(() => {
        if (!cancelled) setAiConfigured(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    const refreshStorySelection = () => {
      setStoryProviderSelection(readSafeStoryProviderSelection());
    };
    window.addEventListener('pcc:ai-preferences-changed', refreshStorySelection);
    window.addEventListener('storage', refreshStorySelection);
    refreshStorySelection();
    return () => {
      window.removeEventListener('pcc:ai-preferences-changed', refreshStorySelection);
      window.removeEventListener('storage', refreshStorySelection);
    };
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
    [
      activeProjectRef,
      aiTicketAuthorityRef,
      savedProjectsRef,
      setClarificationErrors,
      setProject,
      setSavedProjects,
      setStatusNotification,
      setUndoState,
      undoStateRef,
    ]
  );

  const handleGenerateOutput = useCallback(async () => {
    const storyRequestId = globalThis.crypto.randomUUID();
    const originProject = activeProjectRef.current;
    const originSnap = originProject.snapshot;
    const reportGenerationError = (targetMode: GenerationMode, message: string) => {
      setShowOutputDrawer(true);
      setGalleryErrors((prev) => ({
        ...prev,
        [originProject.id]: {
          ...(prev[originProject.id] ?? { story: null, image: null }),
          [targetMode]: message,
        },
      }));
      setStatusNotification(message);
    };

    const promptDecision = resolveProviderPrompt(originProject, originSnap.mode);
    if (!promptDecision.ok) {
      reportGenerationError(originSnap.mode, promptDecision.reason);
      return;
    }
    if (promptDecision.warning) setStatusNotification(promptDecision.warning);
    const promptToUse = promptDecision.prompt.trim();
    if (!promptToUse) return;

    const requestMode = originSnap.mode;
    if (requestMode === 'story') {
      const preflight = resolveStoryProviderPreflight(chatGptStoryLocalActivationRef.current);
      if (!preflight.ok) {
        reportGenerationError('story', preflight.errorMessage);
        return;
      }
    }

    const lengthCheck = validateEffectivePromptLength(promptToUse, MAX_PROMPT_CHARS);
    if (!lengthCheck.ok) {
      reportGenerationError(requestMode, lengthCheck.error ?? 'Compiled prompt exceeds character limit.');
      return;
    }

    let completedStoryUsage: StoryProviderUsage | undefined;
    let completedStoryText: string | undefined;
    const generationCompletion = await runAsyncGenerationSlot({
      authority: aiTicketAuthorityRef.current,
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
          const generatedStory = await generateStoryFromPrompt(promptToUse, signal, storyRequestId);
          completedStoryUsage = generatedStory.usage;
          completedStoryText = generatedStory.story;
          return { storyText: generatedStory.story };
        }
        const result = await generateImagesFromPrompt(promptToUse, signal);
        return { images: result.images, warning: result.warning };
      },
      onStart: () => {
        setLastStoryProviderUsage(null);
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
    if (
      requestMode === 'story' &&
      completedStoryUsage &&
      generationCompletion &&
      !generationCompletion.superseded &&
      (generationCompletion.appliedToActive || generationCompletion.appliedToBackgroundProject) &&
      completedStoryText
    ) {
      setLastStoryProviderUsage({ storyText: completedStoryText, usage: completedStoryUsage });
    }
  }, [
    activeProjectRef,
    aiTicketAuthorityRef,
    savedProjectsRef,
    setGalleryErrors,
    setProject,
    setSavedProjects,
    setShowOutputDrawer,
    setStatusNotification,
  ]);

  const handlePolishPromptWithAi = async () => {
    const originProject = activeProjectRef.current;
    const authority = aiTicketAuthorityRef.current;
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
      const polished = await refinePromptWithAllUpdates(promptToPolish, [], [], signal);
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

  const activePolishProposal = polishProposalsByProject[activeProject.id] ?? null;

  const polishValidation = useMemo(
    () =>
      activePolishProposal
        ? validatePolishProposalAcceptance(activeProject, activePolishProposal)
        : null,
    [activeProject, activePolishProposal]
  );

  const handleAcceptPolishProposal = () => {
    const current = activeProjectRef.current;
    const proposal = polishProposalsByProject[current.id];
    if (!proposal) return;
    const res = acceptPolishProposal(current, undoStateRef.current, proposal);
    if (!res.ok) {
      setStatusNotification(
        res.reason ?? 'Stale AI Polish proposal cannot be applied because the story plan changed.'
      );
      return;
    }
    hasLocalEditsSinceMountRef.current = true;
    activeProjectRef.current = res.project;
    undoStateRef.current = res.undoState;
    setProject(res.project);
    setUndoState(res.undoState);
    setPolishProposalsByProject((prev) => {
      const next = { ...prev };
      delete next[current.id];
      return next;
    });
    setStatusNotification('Accepted AI narrative polish. Undo is available.');
  };

  const handleRejectPolishProposal = () => {
    const currentId = activeProjectRef.current.id;
    setPolishProposalsByProject((prev) => {
      const next = { ...prev };
      delete next[currentId];
      return next;
    });
    setStatusNotification('Discarded staged AI narrative polish proposal.');
  };

  const handlePreviewBatchInstruction = async (
    instruction: string
  ): Promise<BatchEditProposalResult | null> => {
    const targetProject = activeProjectRef.current;
    const authority = aiTicketAuthorityRef.current;
    const { ticket, signal } = authority.beginSlot(targetProject, 'batch');
    const current = () =>
      authority.isCurrent(ticket) && sameProjectVersion(activeProjectRef.current, targetProject);
    const localResult = interpretBatchInstructionLocally(instruction, targetProject.snapshot, {
      projectId: targetProject.id,
      revision: targetProject.revision,
    });
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

  const handleApplyBatchOperations = (preview: BatchEditProposalResult): BatchCommitResult => {
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
    activeProjectRef.current = res.project;
    undoStateRef.current = res.undoState;
    setProject(res.project);
    setUndoState(res.undoState);
    setStatusNotification(`Applied ${res.result.appliedCount} batch operation(s). Undo available.`);
    return res.result;
  };

  return {
    aiConfigured,
    chatGptStoryLocalActivation,
    storyProviderSelection,
    lastStoryProviderUsage,
    activePolishProposal,
    polishValidation,
    handleRefreshClarifications,
    handleGenerateOutput,
    handlePolishPromptWithAi,
    handleAcceptPolishProposal,
    handleRejectPolishProposal,
    handlePreviewBatchInstruction,
    handleApplyBatchOperations,
  };
}
