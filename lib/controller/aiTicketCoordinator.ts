/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import {
  makeStableId,
  mergeAnalysisIntoSnapshot,
} from '../canonicalModel.ts';
import {
  pushUndoableTransaction,
  recordProjectRevision,
  serializeUndoHistory,
  type UndoRedoState,
} from '../historyEngine.ts';
import { computePromptDigest, synthesizeRefinedPrompt } from '../promptBuilder.ts';
import { getDeletedProjectIds } from '../storageEngine.ts';
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
} from '../../shared/types.ts';

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
    undoHistory: nextUndo ? serializeUndoHistory(nextUndo) : targetProject.undoHistory,
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
      requestId: ticket.requestId,
      projectId: targetProject.id,
      baseRevision: ticket.baseRevision,
      sourcePromptDigest:
        ticket.promptDigest ?? computePromptDigest(currentPrompt, targetProject.snapshot.mode),
      originalPrompt: currentPrompt,
      polishedPrompt: candidatePrompt,
      proposedPrompt: candidatePrompt,
      isNoOp: false,
      createdAt: Date.now(),
    },
  };
}

export interface PolishAcceptanceValidation {
  ok: boolean;
  status: 'accepted' | 'wrong-project' | 'stale-revision' | 'stale-digest' | 'noop';
  reason?: string;
}

export function validatePolishProposalAcceptance(
  project: CreativeProject,
  proposal: AiPolishProposal
): PolishAcceptanceValidation {
  if (project.id !== proposal.projectId) {
    return {
      ok: false,
      status: 'wrong-project',
      reason: `This AI Polish proposal was drafted for project "${proposal.projectId}", not "${project.id}".`,
    };
  }

  const candidateText = (proposal.polishedPrompt || proposal.proposedPrompt || '').trim();
  const currentPrompt = project.snapshot.refinedPrompt.trim();

  if (proposal.isNoOp || !candidateText || candidateText === proposal.originalPrompt.trim()) {
    return {
      ok: false,
      status: 'noop',
      reason: 'AI Polish produced identical text; no changes or new revisions are needed.',
    };
  }

  const currentRev = project.revision ?? 1;
  if (proposal.baseRevision !== currentRev) {
    return {
      ok: false,
      status: 'stale-revision',
      reason: `Stale AI Polish proposal: drafted at revision r${proposal.baseRevision}, but project is now at revision r${currentRev}. Re-run AI Polish so your latest edits are preserved.`,
    };
  }

  const currentDigest = computePromptDigest(currentPrompt, project.snapshot.mode);
  const expectedDigest =
    proposal.sourcePromptDigest ??
    computePromptDigest(proposal.originalPrompt, project.snapshot.mode);

  if (currentDigest !== expectedDigest || currentPrompt !== proposal.originalPrompt.trim()) {
    return {
      ok: false,
      status: 'stale-digest',
      reason:
        'Stale AI Polish proposal: the refined prompt changed since this proposal was generated. Re-run AI Polish on the current prompt.',
    };
  }

  return { ok: true, status: 'accepted' };
}

/**
 * Commits an accepted AI Polish proposal into the target project's snapshot and revision history.
 * Rejects stale proposals (when project revision or prompt digest changed) or cross-project proposals.
 */
export function acceptAiPolishProposal(params: {
  project: CreativeProject;
  undoState: UndoRedoState;
  proposal: AiPolishProposal;
}): { project: CreativeProject; undoState: UndoRedoState } | null {
  const { project, undoState, proposal } = params;
  const validation = validatePolishProposalAcceptance(project, proposal);
  if (!validation.ok) return null;

  const candidateText = (proposal.polishedPrompt || proposal.proposedPrompt || '').trim();
  const nextSnapshot: ProjectSnapshot = {
    ...structuredClone(project.snapshot),
    refinedPrompt: candidateText,
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
    undoHistory: serializeUndoHistory(nextUndoState),
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

export interface AsyncAnalysisCompletionParams {
  ticket: AiRequestTicket;
  activeProject: CreativeProject;
  activeUndoState: UndoRedoState;
  savedProjects: CreativeProject[];
  newGraph: BeliefState | null;
  newClarifications: Clarification[] | null;
  preserveDraftAnswers?: Record<string, string>;
  label?: string;
  summary?: string;
  /** Live synchronous ticket registry. Required in production via applyGuardedAsyncAnalysisCompletion. */
  tickets?: InFlightTicketsMap;
}

export interface AsyncAnalysisCompletionResult {
  activeProject: CreativeProject;
  activeUndoState: UndoRedoState;
  savedProjects: CreativeProject[];
  appliedToActive: boolean;
  appliedToBackgroundProject: boolean;
  rebasedOntoNewerRevision: boolean;
  superseded: boolean;
}

export function applyAsyncAnalysisCompletion(
  params: AsyncAnalysisCompletionParams
): AsyncAnalysisCompletionResult {
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
    tickets,
  } = params;

  if (tickets !== undefined && !isTicketCurrent(tickets, ticket)) {
    return {
      activeProject,
      activeUndoState,
      savedProjects,
      appliedToActive: false,
      appliedToBackgroundProject: false,
      rebasedOntoNewerRevision: false,
      superseded: true,
    };
  }

  if (getDeletedProjectIds().has(ticket.projectId)) {
    return {
      activeProject,
      activeUndoState,
      savedProjects: savedProjects.filter((p) => p.id !== ticket.projectId),
      appliedToActive: false,
      appliedToBackgroundProject: false,
      rebasedOntoNewerRevision: false,
      superseded: false,
    };
  }

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
      superseded: false,
    };
  }

  const rebasedOntoNewerRevision = (targetProject.revision ?? 1) > ticket.baseRevision;
  const mergedSnapshot = mergeAnalysisIntoSnapshot(
    targetProject.snapshot,
    newGraph,
    newClarifications,
    preserveDraftAnswers
  );

  const nextUndoForActive = isTargetActive
    ? pushUndoableTransaction(activeUndoState, mergedSnapshot, label)
    : undefined;

  const updatedTarget = recordProjectRevision(
    {
      ...targetProject,
      snapshot: mergedSnapshot,
      artifacts: refreshArtifactsCurrentness(targetProject.artifacts, mergedSnapshot),
      undoHistory: nextUndoForActive
        ? serializeUndoHistory(nextUndoForActive)
        : targetProject.undoHistory,
    },
    label,
    summary,
    1
  );

  const nextSaved = savedProjects.some((p) => p.id === updatedTarget.id)
    ? savedProjects.map((p) => (p.id === updatedTarget.id ? updatedTarget : p))
    : [updatedTarget, ...savedProjects];

  if (isTargetActive && nextUndoForActive) {
    return {
      activeProject: updatedTarget,
      activeUndoState: nextUndoForActive,
      savedProjects: nextSaved,
      appliedToActive: true,
      appliedToBackgroundProject: false,
      rebasedOntoNewerRevision,
      superseded: false,
    };
  }

  return {
    activeProject,
    activeUndoState,
    savedProjects: nextSaved,
    appliedToActive: false,
    appliedToBackgroundProject: true,
    rebasedOntoNewerRevision,
    superseded: false,
  };
}

/**
 * Non-bypassable production seam requiring the live synchronous ticket registry (R0-B).
 */
export function applyGuardedAsyncAnalysisCompletion(
  params: AsyncAnalysisCompletionParams & { tickets: InFlightTicketsMap }
): AsyncAnalysisCompletionResult {
  return applyAsyncAnalysisCompletion(params);
}

export interface AsyncGenerationCompletionParams {
  ticket: AiRequestTicket;
  activeProject: CreativeProject;
  savedProjects: CreativeProject[];
  mode: GenerationMode;
  promptUsed: string;
  storyText?: string;
  images?: string[];
  warning?: string | null;
  now?: number;
  /** Live synchronous ticket registry. Required in production via applyGuardedAsyncGenerationCompletion. */
  tickets?: InFlightTicketsMap;
}

export interface AsyncGenerationCompletionResult {
  activeProject: CreativeProject;
  savedProjects: CreativeProject[];
  artifact: GenerationArtifact | null;
  appliedToActive: boolean;
  appliedToBackgroundProject: boolean;
  superseded: boolean;
}

export function applyAsyncGenerationCompletion(
  params: AsyncGenerationCompletionParams
): AsyncGenerationCompletionResult {
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
    tickets,
  } = params;

  if (tickets !== undefined && !isTicketCurrent(tickets, ticket)) {
    return {
      activeProject,
      savedProjects,
      artifact: null,
      appliedToActive: false,
      appliedToBackgroundProject: false,
      superseded: true,
    };
  }

  if (getDeletedProjectIds().has(ticket.projectId)) {
    return {
      activeProject,
      savedProjects: savedProjects.filter((p) => p.id !== ticket.projectId),
      artifact: null,
      appliedToActive: false,
      appliedToBackgroundProject: false,
      superseded: false,
    };
  }

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
      appliedToBackgroundProject: false,
      superseded: false,
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
  const refreshedNewArtifact = nextArtifacts.find((art) => art.id === newArtifact.id) ?? newArtifact;

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
    artifact: refreshedNewArtifact,
    appliedToActive: isTargetActive,
    appliedToBackgroundProject: !isTargetActive,
    superseded: false,
  };
}

/**
 * Non-bypassable production seam requiring the live synchronous ticket registry (R0-B).
 */
export function applyGuardedAsyncGenerationCompletion(
  params: AsyncGenerationCompletionParams & { tickets: InFlightTicketsMap }
): AsyncGenerationCompletionResult {
  return applyAsyncGenerationCompletion(params);
}

export function createPolishProposal(
  project: CreativeProject,
  polishedText: string,
  now: number = Date.now(),
  baseRevisionOverride?: number,
  sourceOriginalPromptOverride?: string
): AiPolishProposal {
  const originalPrompt = (
    sourceOriginalPromptOverride ?? project.snapshot.refinedPrompt
  ).trim();
  const cleanPolished = polishedText.trim();
  const baseRevision = baseRevisionOverride ?? (project.revision ?? 1);
  return {
    requestId: makeStableId('polish'),
    projectId: project.id,
    baseRevision,
    sourcePromptDigest: computePromptDigest(originalPrompt, project.snapshot.mode),
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
): {
  ok: boolean;
  status: PolishAcceptanceValidation['status'];
  reason?: string;
  project: CreativeProject;
  undoState: UndoRedoState;
} {
  const validation = validatePolishProposalAcceptance(project, proposal);
  if (!validation.ok) {
    return {
      ok: false,
      status: validation.status,
      reason: validation.reason,
      project,
      undoState,
    };
  }
  const res = acceptAiPolishProposal({ project, undoState, proposal });
  if (!res) {
    return {
      ok: false,
      status: 'stale-revision',
      reason: 'Could not apply AI Polish proposal.',
      project,
      undoState,
    };
  }
  return {
    ok: true,
    status: 'accepted',
    project: res.project,
    undoState: res.undoState,
  };
}

/**
 * Single authoritative controller-owned synchronous registry for in-flight AI slots
 * and per-slot AbortControllers (R0-B).
 * UI state (e.g. React `inFlightTickets`) is strictly a projection via `onChange`.
 */
export interface AiTicketAuthority {
  getTickets: () => InFlightTicketsMap;
  beginSlot: (
    project: CreativeProject,
    action: AiRequestAction,
    now?: number
  ) => { ticket: AiRequestTicket; signal: AbortSignal };
  isCurrent: (ticket: AiRequestTicket) => boolean;
  isActionLoading: (projectId: string, action: AiRequestAction) => boolean;
  hasProjectTickets: (projectId: string, except?: AiRequestAction) => boolean;
  clearIfCurrent: (ticket: AiRequestTicket) => boolean;
  cancelIfCurrent: (ticket: AiRequestTicket) => void;
  invalidateProject: (projectId: string) => void;
  invalidateAll: () => void;
}

export function createAiTicketAuthority(
  onChange?: (tickets: InFlightTicketsMap) => void
): AiTicketAuthority {
  let tickets: InFlightTicketsMap = {};
  const controllers = new Map<string, { requestId: string; controller: AbortController }>();

  const emit = (next: InFlightTicketsMap) => {
    tickets = next;
    onChange?.(tickets);
  };

  const clearIfCurrent = (ticket: AiRequestTicket) => {
    if (!isTicketCurrent(tickets, ticket)) return false;
    controllers.delete(makeTicketSlotKey(ticket.projectId, ticket.action));
    emit(clearTicket(tickets, ticket));
    return true;
  };

  return {
    getTickets: () => tickets,
    beginSlot: (project, action, now = Date.now()) => {
      const slotKey = makeTicketSlotKey(project.id, action);
      controllers.get(slotKey)?.controller.abort();
      const controller = new AbortController();
      const ticket = createRequestTicket(project, action, now);
      controllers.set(slotKey, { requestId: ticket.requestId, controller });
      emit(registerTicket(tickets, ticket));
      return { ticket, signal: controller.signal };
    },
    isCurrent: (ticket) => isTicketCurrent(tickets, ticket),
    isActionLoading: (projectId, action) => isProjectActionLoading(tickets, projectId, action),
    hasProjectTickets: (projectId, except) =>
      Object.values(tickets).some(ticket => ticket.projectId === projectId && ticket.action !== except),
    clearIfCurrent,
    cancelIfCurrent: (ticket) => {
      if (!isTicketCurrent(tickets, ticket)) return;
      controllers.get(makeTicketSlotKey(ticket.projectId, ticket.action))?.controller.abort();
      clearIfCurrent(ticket);
    },
    invalidateProject: (projectId) => {
      let changed = false;
      const next: InFlightTicketsMap = {};
      for (const [key, ticket] of Object.entries(tickets)) {
        if (ticket.projectId === projectId) {
          changed = true;
          controllers.get(key)?.controller.abort();
          controllers.delete(key);
        } else {
          next[key] = ticket;
        }
      }
      for (const [key, entry] of controllers.entries()) {
        if (key.startsWith(`${projectId}::`)) {
          entry.controller.abort();
          controllers.delete(key);
        }
      }
      if (changed) {
        emit(next);
      }
    },
    invalidateAll: () => {
      for (const entry of controllers.values()) {
        entry.controller.abort();
      }
      controllers.clear();
      if (Object.keys(tickets).length > 0) {
        emit({});
      }
    },
  };
}

function isAbortLikeError(error: unknown): boolean {
  if (error instanceof DOMException && error.name === 'AbortError') return true;
  if (error instanceof Error && error.name === 'AbortError') return true;
  if (
    error &&
    typeof error === 'object' &&
    'code' in error &&
    (error as { code?: unknown }).code === 'CANCELLED'
  ) {
    return true;
  }
  return false;
}

export interface AsyncAnalysisSlotRunParams {
  authority: AiTicketAuthority;
  originProject: CreativeProject;
  getState: () => {
    activeProject: CreativeProject;
    activeUndoState: UndoRedoState;
    savedProjects: CreativeProject[];
  };
  commitState: (result: AsyncAnalysisCompletionResult) => void;
  analyzeGraph: (signal: AbortSignal) => Promise<BeliefState>;
  fetchClarifications: (signal: AbortSignal) => Promise<Clarification[]>;
  onStart?: () => void;
  onAnalysisError: (projectId: string, error: unknown) => void;
  onClarificationError: (projectId: string, error: unknown) => void;
  onRebased?: () => void;
  label?: string;
  summary?: string;
}

/**
 * Production execution seam for the `analyze` slot (parallel graph + clarification branches).
 * Enforces synchronous live-ticket validation before any error update, canonical mutation,
 * rebase notice, or slot clear (R0-B).
 */
export async function runAsyncAnalysisSlot(
  params: AsyncAnalysisSlotRunParams
): Promise<AsyncAnalysisCompletionResult | null> {
  const {
    authority,
    originProject,
    getState,
    commitState,
    analyzeGraph,
    fetchClarifications,
    onStart,
    onAnalysisError,
    onClarificationError,
    onRebased,
    label = 'Reanalyze Prompt with AI',
    summary = 'Merged AI analysis while preserving confirmed user decisions.',
  } = params;

  const { ticket, signal } = authority.beginSlot(originProject, 'analyze');
  onStart?.();

  try {
    const [newGraph, newClarifications] = await Promise.all([
      analyzeGraph(signal).catch((err) => {
        if (!isAbortLikeError(err) && authority.isCurrent(ticket)) {
          onAnalysisError(originProject.id, err);
        }
        return null;
      }),
      fetchClarifications(signal).catch((err) => {
        if (!isAbortLikeError(err) && authority.isCurrent(ticket)) {
          onClarificationError(originProject.id, err);
        }
        return null;
      }),
    ]);

    if (!newGraph && !newClarifications) {
      return null;
    }

    const live = getState();
    const applied = applyGuardedAsyncAnalysisCompletion({
      ticket,
      tickets: authority.getTickets(),
      activeProject: live.activeProject,
      activeUndoState: live.activeUndoState,
      savedProjects: live.savedProjects,
      newGraph,
      newClarifications,
      label,
      summary,
    });

    if (applied.superseded || (!applied.appliedToActive && !applied.appliedToBackgroundProject)) {
      return applied;
    }

    commitState(applied);
    if (applied.rebasedOntoNewerRevision) {
      onRebased?.();
    }
    return applied;
  } finally {
    authority.clearIfCurrent(ticket);
  }
}

export interface AsyncClarifySlotRunParams {
  authority: AiTicketAuthority;
  originProject: CreativeProject;
  getState: () => {
    activeProject: CreativeProject;
    activeUndoState: UndoRedoState;
    savedProjects: CreativeProject[];
  };
  commitState: (result: AsyncAnalysisCompletionResult) => void;
  fetchClarifications: (signal: AbortSignal) => Promise<Clarification[]>;
  preserveDraftAnswers?: Record<string, string>;
  onStart?: () => void;
  onError: (projectId: string, error: unknown) => void;
  label?: string;
  summary?: string;
}

/**
 * Production execution seam for the `clarify` slot with live synchronous ticket validation (R0-B).
 */
export async function runAsyncClarifySlot(
  params: AsyncClarifySlotRunParams
): Promise<AsyncAnalysisCompletionResult | null> {
  const {
    authority,
    originProject,
    getState,
    commitState,
    fetchClarifications,
    preserveDraftAnswers,
    onStart,
    onError,
    label = 'Request Additional Clarifications',
    summary = 'Added non-duplicate AI clarification questions.',
  } = params;

  const { ticket, signal } = authority.beginSlot(originProject, 'clarify');
  onStart?.();

  try {
    const freshClarifications = await fetchClarifications(signal);
    const live = getState();
    const applied = applyGuardedAsyncAnalysisCompletion({
      ticket,
      tickets: authority.getTickets(),
      activeProject: live.activeProject,
      activeUndoState: live.activeUndoState,
      savedProjects: live.savedProjects,
      newGraph: null,
      newClarifications: freshClarifications,
      preserveDraftAnswers,
      label,
      summary,
    });

    if (applied.superseded || (!applied.appliedToActive && !applied.appliedToBackgroundProject)) {
      return applied;
    }

    commitState(applied);
    return applied;
  } catch (err) {
    if (!isAbortLikeError(err) && authority.isCurrent(ticket)) {
      onError(originProject.id, err);
    }
    return null;
  } finally {
    authority.clearIfCurrent(ticket);
  }
}

export interface AsyncGenerationSlotRunParams {
  authority: AiTicketAuthority;
  originProject: CreativeProject;
  mode: GenerationMode;
  promptUsed: string;
  getState: () => {
    activeProject: CreativeProject;
    savedProjects: CreativeProject[];
  };
  commitState: (result: AsyncGenerationCompletionResult) => void;
  generate: (
    signal: AbortSignal
  ) => Promise<{ storyText?: string; images?: string[]; warning?: string | null }>;
  onStart?: () => void;
  onError: (projectId: string, mode: GenerationMode, error: unknown) => void;
  now?: () => number;
}

/**
 * Production execution seam for the `generate` slot (story and image) with live synchronous
 * ticket validation (R0-B).
 */
export async function runAsyncGenerationSlot(
  params: AsyncGenerationSlotRunParams
): Promise<AsyncGenerationCompletionResult | null> {
  const {
    authority,
    originProject,
    mode,
    promptUsed,
    getState,
    commitState,
    generate,
    onStart,
    onError,
    now,
  } = params;

  const { ticket, signal } = authority.beginSlot(originProject, 'generate');
  onStart?.();

  try {
    const output = await generate(signal);
    const live = getState();
    const applied = applyGuardedAsyncGenerationCompletion({
      ticket,
      tickets: authority.getTickets(),
      activeProject: live.activeProject,
      savedProjects: live.savedProjects,
      mode,
      promptUsed,
      storyText: output.storyText,
      images: output.images,
      warning: output.warning ?? null,
      now: now ? now() : Date.now(),
    });

    if (applied.superseded || (!applied.appliedToActive && !applied.appliedToBackgroundProject)) {
      return applied;
    }

    commitState(applied);
    return applied;
  } catch (err) {
    if (!isAbortLikeError(err) && authority.isCurrent(ticket)) {
      onError(originProject.id, mode, err);
    }
    return null;
  } finally {
    authority.clearIfCurrent(ticket);
  }
}
