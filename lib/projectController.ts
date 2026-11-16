/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import {
  makeStableId,
  mergeAnalysisIntoSnapshot,
} from './canonicalModel.ts';
import {
  pushCoalescedTransaction,
  pushUndoableTransaction,
  recordProjectRevision,
  type UndoRedoState,
} from './historyEngine.ts';
import { computePromptDigest, synthesizeRefinedPrompt } from './promptBuilder.ts';
import type {
  AiPolishProposal,
  AiRequestAction,
  AiRequestTicket,
  BatchEditProposalResult,
  BeliefState,
  Clarification,
  CreativeProject,
  GenerationArtifact,
  GenerationMode,
  ProjectSnapshot,
} from '../shared/types.ts';

export type InFlightTicketsMap = Record<string, AiRequestTicket>;

export function makeTicketSlotKey(projectId: string, action: AiRequestAction): string {
  return `${projectId}::${action}`;
}

export function issueAiRequestTicket(
  tickets: InFlightTicketsMap,
  projectId: string,
  baseRevision: number,
  action: AiRequestAction,
  now: number = Date.now()
): { tickets: InFlightTicketsMap; ticket: AiRequestTicket } {
  const ticket: AiRequestTicket = {
    requestId: makeStableId('req'),
    projectId,
    baseRevision,
    action,
    startedAt: now,
  };
  return {
    tickets: {
      ...tickets,
      [makeTicketSlotKey(projectId, action)]: ticket,
    },
    ticket,
  };
}

export function clearAiRequestTicket(
  tickets: InFlightTicketsMap,
  ticket: AiRequestTicket
): InFlightTicketsMap {
  const key = makeTicketSlotKey(ticket.projectId, ticket.action);
  const current = tickets[key];
  if (!current || current.requestId !== ticket.requestId) {
    return tickets;
  }
  const next = { ...tickets };
  delete next[key];
  return next;
}

export function isTicketCurrent(
  tickets: InFlightTicketsMap,
  ticket: AiRequestTicket
): boolean {
  const key = makeTicketSlotKey(ticket.projectId, ticket.action);
  return tickets[key]?.requestId === ticket.requestId;
}

export function isProjectActionLoading(
  tickets: InFlightTicketsMap,
  projectId: string,
  action: AiRequestAction
): boolean {
  return Boolean(tickets[makeTicketSlotKey(projectId, action)]);
}

/**
 * Refreshes artifact `isOutdated` flags deterministically based on `promptDigest`
 * so switching back to a previously used prompt or mode accurately reflects currentness.
 */
export function refreshArtifactsCurrentness(
  artifacts: GenerationArtifact[],
  snapshot: ProjectSnapshot
): GenerationArtifact[] {
  return artifacts.map((art) => {
    const modePrompt =
      art.mode === snapshot.mode
        ? snapshot.refinedPrompt
        : synthesizeRefinedPrompt(snapshot, art.mode);
    const expectedDigest = computePromptDigest(modePrompt, art.mode);
    const artDigest = art.promptDigest ?? computePromptDigest(art.promptUsed, art.mode);
    return {
      ...art,
      promptDigest: artDigest,
      isOutdated: artDigest !== expectedDigest,
    };
  });
}

/**
 * Reconciles an async AI analysis or clarification-refresh response against the current project list.
 * Enforces:
 * - INV-01: Cross-project isolation (targets ticket.projectId only, never bleeding into activeProjectId).
 * - INV-03: Latest-ticket-wins per (projectId, action) and rebasing onto latest project.snapshot
 *   when user edits occurred while the request was in flight.
 */
export function reconcileAsyncAnalysisResponse(params: {
  projects: CreativeProject[];
  undoMap: Record<string, UndoRedoState>;
  tickets: InFlightTicketsMap;
  ticket: AiRequestTicket;
  incomingGraph: BeliefState | null;
  incomingClarifications: Clarification[] | null;
  pendingDraftAnswers?: Record<string, string>;
  commitLabel?: string;
  commitSummary?: string;
}): {
  status: 'applied' | 'superseded' | 'missing-project';
  rebased: boolean;
  projects: CreativeProject[];
  undoMap: Record<string, UndoRedoState>;
  tickets: InFlightTicketsMap;
  updatedProject?: CreativeProject;
} {
  const {
    projects,
    undoMap,
    tickets,
    ticket,
    incomingGraph,
    incomingClarifications,
    pendingDraftAnswers = {},
    commitLabel = 'AI Plan Analysis',
    commitSummary = 'Merged AI entities, relationships, and clarification questions.',
  } = params;

  if (!isTicketCurrent(tickets, ticket)) {
    return {
      status: 'superseded',
      rebased: false,
      projects,
      undoMap,
      tickets,
    };
  }

  const nextTickets = clearAiRequestTicket(tickets, ticket);
  const targetProject = projects.find((p) => p.id === ticket.projectId);
  if (!targetProject) {
    return {
      status: 'missing-project',
      rebased: false,
      projects,
      undoMap,
      tickets: nextTickets,
    };
  }

  const rebased = (targetProject.revision ?? 1) !== ticket.baseRevision;
  // Always merge onto the latest snapshot of targetProject (never a stale closure snapshot)
  const mergedSnapshot = mergeAnalysisIntoSnapshot(
    targetProject.snapshot,
    incomingGraph,
    incomingClarifications,
    pendingDraftAnswers
  );

  const prevUndo = undoMap[targetProject.id];
  const nextUndo = prevUndo
    ? pushUndoableTransaction(prevUndo, mergedSnapshot, commitLabel)
    : undefined;

  let updatedProject: CreativeProject = {
    ...targetProject,
    snapshot: mergedSnapshot,
    artifacts: refreshArtifactsCurrentness(targetProject.artifacts, mergedSnapshot),
  };
  updatedProject = recordProjectRevision(updatedProject, commitLabel, commitSummary, 1);

  const nextProjects = projects.map((p) =>
    p.id === updatedProject.id ? updatedProject : p
  );
  const nextUndoMap = nextUndo
    ? { ...undoMap, [targetProject.id]: nextUndo }
    : undoMap;

  return {
    status: 'applied',
    rebased,
    projects: nextProjects,
    undoMap: nextUndoMap,
    tickets: nextTickets,
    updatedProject,
  };
}

/**
 * Reconciles an async AI Polish response without auto-committing a fake revision.
 * Stages a reviewable AiPolishProposal only when the polished text differs from the base prompt.
 */
export function reconcileAsyncPolishResponse(params: {
  projects: CreativeProject[];
  tickets: InFlightTicketsMap;
  ticket: AiRequestTicket;
  polishedText: string;
}): {
  status: 'staged' | 'noop' | 'superseded' | 'missing-project';
  tickets: InFlightTicketsMap;
  proposal: AiPolishProposal | null;
} {
  const { projects, tickets, ticket, polishedText } = params;

  if (!isTicketCurrent(tickets, ticket)) {
    return { status: 'superseded', tickets, proposal: null };
  }

  const nextTickets = clearAiRequestTicket(tickets, ticket);
  const targetProject = projects.find((p) => p.id === ticket.projectId);
  if (!targetProject) {
    return { status: 'missing-project', tickets: nextTickets, proposal: null };
  }

  const currentPrompt = targetProject.snapshot.refinedPrompt.trim();
  const candidatePrompt = polishedText.trim();

  if (!candidatePrompt || candidatePrompt === currentPrompt) {
    return { status: 'noop', tickets: nextTickets, proposal: null };
  }

  return {
    status: 'staged',
    tickets: nextTickets,
    proposal: {
      projectId: targetProject.id,
      baseRevision: targetProject.revision ?? 1,
      originalPrompt: currentPrompt,
      polishedPrompt: candidatePrompt,
      createdAt: Date.now(),
    },
  };
}

/**
 * Commits an accepted AI Polish proposal into the target project's snapshot and revision history.
 */
export function acceptAiPolishProposal(params: {
  project: CreativeProject;
  undoState: UndoRedoState;
  proposal: AiPolishProposal;
}): { project: CreativeProject; undoState: UndoRedoState } | null {
  const { project, undoState, proposal } = params;
  if (project.id !== proposal.projectId) return null;

  const nextSnapshot: ProjectSnapshot = {
    ...structuredClone(project.snapshot),
    refinedPrompt: proposal.polishedPrompt.trim(),
  };

  const nextUndoState = pushUndoableTransaction(
    undoState,
    nextSnapshot,
    'Accept AI Polished Prompt'
  );

  let nextProject: CreativeProject = {
    ...project,
    snapshot: nextSnapshot,
    artifacts: refreshArtifactsCurrentness(project.artifacts, nextSnapshot),
  };
  nextProject = recordProjectRevision(
    nextProject,
    'AI Polish Refined Prompt',
    'Accepted AI-polished narrative prompt.',
    1
  );

  return { project: nextProject, undoState: nextUndoState };
}

/**
 * Reconciles an async Story or Image generation response.
 * Enforces:
 * - Cross-project isolation (never writes Project A's artifact into Project B).
 * - Multi-artifact preservation (appends new artifact instead of deleting prior artifacts of the same mode).
 * - Deterministic promptDigest currentness tracking.
 */
export function reconcileAsyncGenerationResponse(params: {
  projects: CreativeProject[];
  tickets: InFlightTicketsMap;
  ticket: AiRequestTicket;
  mode: GenerationMode;
  promptUsed: string;
  storyText?: string;
  images?: string[];
  now?: number;
}): {
  status: 'applied' | 'superseded' | 'missing-project';
  projects: CreativeProject[];
  tickets: InFlightTicketsMap;
  artifact?: GenerationArtifact;
  updatedProject?: CreativeProject;
} {
  const {
    projects,
    tickets,
    ticket,
    mode,
    promptUsed,
    storyText,
    images,
    now = Date.now(),
  } = params;

  if (!isTicketCurrent(tickets, ticket)) {
    return { status: 'superseded', projects, tickets };
  }

  const nextTickets = clearAiRequestTicket(tickets, ticket);
  const targetProject = projects.find((p) => p.id === ticket.projectId);
  if (!targetProject) {
    return { status: 'missing-project', projects, tickets: nextTickets };
  }

  const promptDigest = computePromptDigest(promptUsed, mode);
  const currentModePrompt =
    mode === targetProject.snapshot.mode
      ? targetProject.snapshot.refinedPrompt
      : synthesizeRefinedPrompt(targetProject.snapshot, mode);
  const currentDigest = computePromptDigest(currentModePrompt, mode);

  const newArtifact: GenerationArtifact = {
    id: makeStableId(mode === 'story' ? 'art_story' : 'art_img'),
    projectId: targetProject.id,
    mode,
    createdAt: now,
    revisionId: targetProject.revisions[0]?.id ?? 'rev_current',
    sourceRevision: ticket.baseRevision,
    promptUsed,
    promptDigest,
    storyText,
    images,
    isOutdated: promptDigest !== currentDigest,
  };

  const nextArtifacts = refreshArtifactsCurrentness(
    [newArtifact, ...targetProject.artifacts],
    targetProject.snapshot
  );

  const updatedProject: CreativeProject = {
    ...targetProject,
    updatedAt: now,
    revision: (targetProject.revision ?? 1) + 1,
    artifacts: nextArtifacts,
  };

  return {
    status: 'applied',
    projects: projects.map((p) => (p.id === updatedProject.id ? updatedProject : p)),
    tickets: nextTickets,
    artifact: newArtifact,
    updatedProject,
  };
}

/**
 * Reconciles an async Batch Edit interpretation response, tagging the proposal with baseProjectId and baseRevision.
 */
export function reconcileAsyncBatchEditResponse(params: {
  projects: CreativeProject[];
  tickets: InFlightTicketsMap;
  ticket: AiRequestTicket;
  proposal: BatchEditProposalResult;
}): {
  status: 'applied' | 'superseded' | 'missing-project';
  tickets: InFlightTicketsMap;
  proposal: BatchEditProposalResult | null;
} {
  const { projects, tickets, ticket, proposal } = params;
  if (!isTicketCurrent(tickets, ticket)) {
    return { status: 'superseded', tickets, proposal: null };
  }
  const nextTickets = clearAiRequestTicket(tickets, ticket);
  const targetProject = projects.find((p) => p.id === ticket.projectId);
  if (!targetProject) {
    return { status: 'missing-project', tickets: nextTickets, proposal: null };
  }

  return {
    status: 'applied',
    tickets: nextTickets,
    proposal: {
      ...proposal,
      baseProjectId: targetProject.id,
      baseRevision: ticket.baseRevision,
    },
  };
}

// --- Ergonomic Controller Helpers for App & Acceptance Tests ---

export function createRequestTicket(
  project: CreativeProject,
  action: AiRequestAction,
  now: number = Date.now()
): AiRequestTicket {
  const promptUsed = project.snapshot.refinedPrompt || project.snapshot.originalIdea;
  return {
    requestId: makeStableId('req'),
    projectId: project.id,
    baseRevision: project.revision ?? 1,
    action,
    mode: project.snapshot.mode,
    promptUsed,
    promptDigest: computePromptDigest(promptUsed, project.snapshot.mode),
    startedAt: now,
  };
}

export function registerTicket(
  tickets: InFlightTicketsMap,
  ticket: AiRequestTicket
): InFlightTicketsMap {
  return {
    ...tickets,
    [makeTicketSlotKey(ticket.projectId, ticket.action)]: ticket,
  };
}

export function clearTicket(
  tickets: InFlightTicketsMap,
  ticket: AiRequestTicket
): InFlightTicketsMap {
  return clearAiRequestTicket(tickets, ticket);
}

export function commitSnapshotTransaction(
  project: CreativeProject,
  undoState: UndoRedoState,
  nextSnapshot: ProjectSnapshot,
  label: string,
  summary: string = label,
  changeCount: number = 1,
  options?: { coalesceKey?: string; coalesceWindowMs?: number; nowMs?: number }
): { project: CreativeProject; undoState: UndoRedoState } {
  const nextUndoState = options?.coalesceKey
    ? pushCoalescedTransaction(
        undoState,
        nextSnapshot,
        label,
        options.coalesceKey,
        options.coalesceWindowMs
      ).state
    : pushUndoableTransaction(undoState, nextSnapshot, label);

  const refreshedArtifacts = refreshArtifactsCurrentness(project.artifacts, nextSnapshot);
  const nextProject = recordProjectRevision(
    {
      ...project,
      snapshot: nextSnapshot,
      artifacts: refreshedArtifacts,
    },
    label,
    summary,
    changeCount,
    {
      coalesceKey: options?.coalesceKey,
      windowMs: options?.coalesceWindowMs,
    }
  );

  return {
    project: nextProject,
    undoState: nextUndoState,
  };
}

export function applyAsyncAnalysisCompletion(params: {
  ticket: AiRequestTicket;
  activeProject: CreativeProject;
  activeUndoState: UndoRedoState;
  savedProjects: CreativeProject[];
  newGraph: BeliefState | null;
  newClarifications: Clarification[] | null;
  preserveDraftAnswers?: Record<string, string>;
  label?: string;
  summary?: string;
}): {
  activeProject: CreativeProject;
  activeUndoState: UndoRedoState;
  savedProjects: CreativeProject[];
  appliedToActive: boolean;
  appliedToBackgroundProject: boolean;
  rebasedOntoNewerRevision: boolean;
} {
  const {
    ticket,
    activeProject,
    activeUndoState,
    savedProjects,
    newGraph,
    newClarifications,
    preserveDraftAnswers = {},
    label = 'Reanalyze Prompt with AI',
    summary = 'Merged AI analysis while preserving confirmed user decisions.',
  } = params;

  const isTargetActive = activeProject.id === ticket.projectId;
  const targetProject = isTargetActive
    ? activeProject
    : savedProjects.find((p) => p.id === ticket.projectId);

  if (!targetProject) {
    return {
      activeProject,
      activeUndoState,
      savedProjects,
      appliedToActive: false,
      appliedToBackgroundProject: false,
      rebasedOntoNewerRevision: false,
    };
  }

  const rebasedOntoNewerRevision = (targetProject.revision ?? 1) > ticket.baseRevision;
  const mergedSnapshot = mergeAnalysisIntoSnapshot(
    targetProject.snapshot,
    newGraph,
    newClarifications,
    preserveDraftAnswers
  );

  const updatedTarget = recordProjectRevision(
    {
      ...targetProject,
      snapshot: mergedSnapshot,
      artifacts: refreshArtifactsCurrentness(targetProject.artifacts, mergedSnapshot),
    },
    label,
    summary,
    1
  );

  const nextSaved = savedProjects.some((p) => p.id === updatedTarget.id)
    ? savedProjects.map((p) => (p.id === updatedTarget.id ? updatedTarget : p))
    : [updatedTarget, ...savedProjects];

  if (isTargetActive) {
    const nextUndo = pushUndoableTransaction(activeUndoState, mergedSnapshot, label);
    return {
      activeProject: updatedTarget,
      activeUndoState: nextUndo,
      savedProjects: nextSaved,
      appliedToActive: true,
      appliedToBackgroundProject: false,
      rebasedOntoNewerRevision,
    };
  }

  return {
    activeProject,
    activeUndoState,
    savedProjects: nextSaved,
    appliedToActive: false,
    appliedToBackgroundProject: true,
    rebasedOntoNewerRevision,
  };
}

export function applyAsyncGenerationCompletion(params: {
  ticket: AiRequestTicket;
  activeProject: CreativeProject;
  savedProjects: CreativeProject[];
  mode: GenerationMode;
  promptUsed: string;
  storyText?: string;
  images?: string[];
  warning?: string | null;
  now?: number;
}): {
  activeProject: CreativeProject;
  savedProjects: CreativeProject[];
  artifact: GenerationArtifact | null;
  appliedToActive: boolean;
} {
  const {
    ticket,
    activeProject,
    savedProjects,
    mode,
    promptUsed,
    storyText,
    images,
    warning = null,
    now = Date.now(),
  } = params;

  const isTargetActive = activeProject.id === ticket.projectId;
  const targetProject = isTargetActive
    ? activeProject
    : savedProjects.find((p) => p.id === ticket.projectId);

  if (!targetProject) {
    return {
      activeProject,
      savedProjects,
      artifact: null,
      appliedToActive: false,
    };
  }

  const promptDigest = computePromptDigest(promptUsed, mode);
  const newArtifact: GenerationArtifact = {
    id: makeStableId(mode === 'story' ? 'art_story' : 'art_img'),
    projectId: targetProject.id,
    mode,
    createdAt: now,
    revisionId: targetProject.revisions[0]?.id ?? 'rev_current',
    sourceRevision: ticket.baseRevision,
    promptUsed,
    promptDigest,
    storyText,
    images,
    warning,
    isOutdated: false,
  };

  const nextArtifacts = refreshArtifactsCurrentness(
    [newArtifact, ...targetProject.artifacts],
    targetProject.snapshot
  );

  const updatedTarget: CreativeProject = {
    ...targetProject,
    updatedAt: now,
    revision: (targetProject.revision ?? 1) + 1,
    artifacts: nextArtifacts,
  };

  const nextSaved = savedProjects.some((p) => p.id === updatedTarget.id)
    ? savedProjects.map((p) => (p.id === updatedTarget.id ? updatedTarget : p))
    : [updatedTarget, ...savedProjects];

  return {
    activeProject: isTargetActive ? updatedTarget : activeProject,
    savedProjects: nextSaved,
    artifact: newArtifact,
    appliedToActive: isTargetActive,
  };
}

export function createPolishProposal(
  project: CreativeProject,
  polishedText: string,
  now: number = Date.now()
): AiPolishProposal {
  const originalPrompt = project.snapshot.refinedPrompt.trim();
  const cleanPolished = polishedText.trim();
  return {
    requestId: makeStableId('polish'),
    projectId: project.id,
    baseRevision: project.revision ?? 1,
    originalPrompt,
    polishedPrompt: cleanPolished,
    proposedPrompt: cleanPolished,
    isNoOp: !cleanPolished || cleanPolished === originalPrompt,
    createdAt: now,
  };
}

export function acceptPolishProposal(
  project: CreativeProject,
  undoState: UndoRedoState,
  proposal: AiPolishProposal
): { project: CreativeProject; undoState: UndoRedoState } {
  const res = acceptAiPolishProposal({ project, undoState, proposal });
  return res ?? { project, undoState };
}

