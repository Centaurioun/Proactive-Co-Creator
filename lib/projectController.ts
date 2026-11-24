/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { recordNarrativeChange } from './narrative/changeAudit.ts';
import {
  applyDecisionBatch,
  makeStableId,
  mergeAnalysisIntoSnapshot,
} from './canonicalModel.ts';
import {
  performRedo,
  performUndo,
  pushCoalescedTransaction,
  pushUndoableTransaction,
  recordProjectRevision,
  serializeUndoHistory,
  type UndoRedoState,
} from './historyEngine.ts';
import { applyProposedOperations } from './nlBatchEngine.ts';
import { computePromptDigest, synthesizeRefinedPrompt } from './promptBuilder.ts';
import {
  getDeletedProjectIds,
  type IndexedDbLoadStatus,
  type StorageSaveResult,
} from './storageEngine.ts';
import type {
  AiPolishProposal,
  AiRequestAction,
  AiRequestTicket,
  BatchCommitResult,
  BatchEditProposalResult,
  BeliefState,
  Clarification,
  CreativeProject,
  GenerationArtifact,
  GenerationMode,
  ProjectSnapshot,
  ReviewDiffItem,
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

export function commitSnapshotTransaction(
  project: CreativeProject,
  undoState: UndoRedoState,
  nextSnapshot: ProjectSnapshot,
  label: string,
  summary: string = label,
  changeCount: number = 1,
  options?: { coalesceKey?: string; coalesceWindowMs?: number; nowMs?: number }
): { project: CreativeProject; undoState: UndoRedoState } {
  project = appendAuthoredAttributeClaims(project, nextSnapshot);
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
      undoHistory: serializeUndoHistory(nextUndoState),
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

export function appendAuthoredAttributeClaims(project: CreativeProject, nextSnapshot: ProjectSnapshot): CreativeProject {
  const records = project.narrative;
  if (!records) return project;
  const claims = records.claims.slice();
  let changed = false;
  for (const nextEntity of nextSnapshot.entities) {
    const beforeEntity = project.snapshot.entities.find(entity => entity.id === nextEntity.id);
    if (!beforeEntity) continue;
    for (const nextAttribute of nextEntity.attributes) {
      const beforeAttribute = beforeEntity.attributes.find(attribute => attribute.id === nextAttribute.id);
      const attributeId = nextAttribute.id;
      if (!attributeId || !beforeAttribute || (!beforeAttribute.sourceBacked && !beforeAttribute.epistemicKind) || nextAttribute.epistemicKind !== 'user-authored' ||
        (beforeAttribute.confirmedValue ?? '') === (nextAttribute.confirmedValue ?? '')) continue;
      const sourceClaim = claims.find(claim => claim.targetId === attributeId && claim.epistemicKind === beforeAttribute.epistemicKind);
      if (!sourceClaim || claims.some(claim => claim.supersedesClaimId === sourceClaim.id && claim.authoredText === (nextAttribute.confirmedValue ?? ''))) continue;
      claims.push({
        id: makeStableId('claim_author'), targetId: attributeId,
        rationale: 'User-authored replacement; original imported evidence remains attached to its historical source claim.',
        approval: 'confirmed', freshness: 'current', anchors: structuredClone(sourceClaim.anchors),
        epistemicKind: 'user-authored', authoredText: nextAttribute.confirmedValue ?? '', supersedesClaimId: sourceClaim.id,
      });
      changed = true;
    }
  }
  return changed ? { ...project, narrative: { ...records, claims } } : project;
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

  if (getDeletedProjectIds().has(ticket.projectId)) {
    return {
      activeProject,
      activeUndoState,
      savedProjects: savedProjects.filter((p) => p.id !== ticket.projectId),
      appliedToActive: false,
      appliedToBackgroundProject: false,
      rebasedOntoNewerRevision: false,
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

  if (getDeletedProjectIds().has(ticket.projectId)) {
    return {
      activeProject,
      savedProjects: savedProjects.filter((p) => p.id !== ticket.projectId),
      artifact: null,
      appliedToActive: false,
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
 * Commits a staged natural-language batch preview against the authoritative project state.
 * Enforces F-01 & U-02:
 * - Rejects cross-project apply (WRONG_PROJECT)
 * - Rejects stale base revision apply (STALE_REVISION)
 * - Rejects duplicate apply of the same proposalId (ALREADY_APPLIED)
 * - Pre-validates all selected operations atomically (VALIDATION_FAILED)
 */
export function commitBatchPreviewToProject(params: {
  project: CreativeProject;
  undoState: UndoRedoState;
  preview: BatchEditProposalResult;
  appliedProposalIds?: Set<string> | ReadonlySet<string> | string[];
}): {
  project: CreativeProject;
  undoState: UndoRedoState;
  result: BatchCommitResult;
} {
  const { project, undoState, preview, appliedProposalIds } = params;

  const appliedSet =
    appliedProposalIds instanceof Set
      ? appliedProposalIds
      : new Set(appliedProposalIds ?? []);

  if (preview.proposalId && appliedSet.has(preview.proposalId)) {
    const msg = 'This batch preview has already been applied.';
    return {
      project,
      undoState,
      result: {
        ok: false,
        reason: 'ALREADY_APPLIED',
        message: msg,
        errors: [{ code: 'ALREADY_APPLIED', message: msg }],
      },
    };
  }

  if (preview.baseProjectId !== undefined && preview.baseProjectId !== project.id) {
    const msg = `Batch preview was created for project "${preview.baseProjectId}", but the active project is "${project.name}" (${project.id}). Switch back or click Re-preview for this project.`;
    return {
      project,
      undoState,
      result: {
        ok: false,
        reason: 'WRONG_PROJECT',
        message: msg,
        errors: [{ operationId: 'batch_project', code: 'WRONG_PROJECT', message: msg }],
      },
    };
  }

  const currentRev = project.revision ?? 1;
  if (preview.baseRevision !== undefined && preview.baseRevision !== currentRev) {
    const msg = `Batch preview is stale: it was generated at revision r${preview.baseRevision}, while this project is now at revision r${currentRev}. Click Re-preview to recalculate against the latest state.`;
    return {
      project,
      undoState,
      result: {
        ok: false,
        reason: 'STALE_REVISION',
        message: msg,
        errors: [{ operationId: 'batch_base', code: 'STALE_BASE', message: msg }],
      },
    };
  }

  const selectedOps = preview.operations.filter((op) => op.selected);
  if (selectedOps.length === 0) {
    const msg = 'Select at least one proposed operation to apply.';
    return {
      project,
      undoState,
      result: {
        ok: false,
        reason: 'NO_SELECTED_OPERATIONS',
        message: msg,
        errors: [],
      },
    };
  }

  const applied = applyProposedOperations(project.snapshot, preview.operations, {
    expectedProjectId: preview.baseProjectId,
    currentProjectId: project.id,
    expectedBaseRevision: preview.baseRevision,
    currentRevision: currentRev,
  });

  if (applied.errors.length > 0) {
    return {
      project,
      undoState,
      result: {
        ok: false,
        reason: 'VALIDATION_FAILED',
        message: applied.errors[0].message,
        errors: applied.errors,
      },
    };
  }

  if (preview.proposalId && appliedProposalIds instanceof Set) {
    appliedProposalIds.add(preview.proposalId);
  }

  const committed = commitSnapshotTransaction(
    project,
    undoState,
    applied.snapshot,
    `Batch Edit (${applied.appliedCount} ops)`,
    `Applied natural-language batch edit: "${preview.instruction}"`,
    applied.appliedCount
  );

  return {
    project: committed.project,
    undoState: committed.undoState,
    result: {
      ok: true,
      appliedCount: applied.appliedCount,
      revision: committed.project.revision,
      proposalId: preview.proposalId,
    },
  };
}

/**
 * Performs an Undo step as a monotonic durable revision on the project while moving the UndoRedoState cursor.
 * Enforces F-04: Undo restores prior snapshot content, advances monotonic project.revision,
 * refreshes artifact currentness, and keeps the redo branch intact. No-op when past stack is empty.
 */
export function commitUndoTransaction(
  project: CreativeProject,
  undoState: UndoRedoState
): {
  project: CreativeProject;
  undoState: UndoRedoState;
  undoneLabel: string | null;
  changed: boolean;
} {
  const { state: nextUndoState, undoneLabel } = performUndo(undoState);
  if (!undoneLabel) {
    return { project, undoState, undoneLabel: null, changed: false };
  }

  const restoredSnapshot = nextUndoState.present;
  const refreshedArtifacts = refreshArtifactsCurrentness(project.artifacts, restoredSnapshot);
  const nextProject = recordProjectRevision(
    {
      ...project,
      snapshot: restoredSnapshot,
      artifacts: refreshedArtifacts,
      undoHistory: serializeUndoHistory(nextUndoState),
    },
    `Undo: ${undoneLabel}`,
    `Undid "${undoneLabel}"`,
    1
  );

  return {
    project: recordNarrativeChange(project, nextProject, 'undo', undoneLabel),
    undoState: nextUndoState,
    undoneLabel,
    changed: true,
  };
}

/**
 * Performs a Redo step as a monotonic durable revision on the project while moving the UndoRedoState cursor.
 * Enforces F-04: Redo reapplies the undone snapshot, advances monotonic project.revision,
 * refreshes artifact currentness, and preserves Undo/Redo stack entries. No-op when future stack is empty.
 */
export function commitRedoTransaction(
  project: CreativeProject,
  undoState: UndoRedoState
): {
  project: CreativeProject;
  undoState: UndoRedoState;
  redoneLabel: string | null;
  changed: boolean;
} {
  const { state: nextUndoState, redoneLabel } = performRedo(undoState);
  if (!redoneLabel) {
    return { project, undoState, redoneLabel: null, changed: false };
  }

  const redoneSnapshot = nextUndoState.present;
  const refreshedArtifacts = refreshArtifactsCurrentness(project.artifacts, redoneSnapshot);
  const nextProject = recordProjectRevision(
    {
      ...project,
      snapshot: redoneSnapshot,
      artifacts: refreshedArtifacts,
      undoHistory: serializeUndoHistory(nextUndoState),
    },
    `Redo: ${redoneLabel}`,
    `Redid "${redoneLabel}"`,
    1
  );

  return {
    project: recordNarrativeChange(project, nextProject, 'redo', redoneLabel),
    undoState: nextUndoState,
    redoneLabel,
    changed: true,
  };
}

/**
 * Builds a structured Before/After diff model for the Review Plan & Prompt Changes modal (U-01).
 */
export function buildReviewDiffModel(params: {
  project: CreativeProject;
  selectedDecisionIds?: string[];
  draftDecisionValues?: Record<string, string>;
  stagedBatch?: BatchEditProposalResult | null;
  polishProposal?: AiPolishProposal | null;
}): {
  projectId: string;
  revision: number;
  items: ReviewDiffItem[];
  beforePrompt: string;
  afterPrompt: string;
  hasChanges: boolean;
  hasStaleBatch: boolean;
} {
  const {
    project,
    selectedDecisionIds,
    draftDecisionValues = {},
    stagedBatch = null,
    polishProposal = null,
  } = params;
  const { snapshot } = project;
  const items: ReviewDiffItem[] = [];

  const pendingDecisions = snapshot.decisions.filter((d) => d.status === 'pending');
  const targetDecisions =
    selectedDecisionIds && selectedDecisionIds.length > 0
      ? pendingDecisions.filter((d) => selectedDecisionIds.includes(d.id))
      : pendingDecisions;

  for (const dec of targetDecisions) {
    const proposed = draftDecisionValues[dec.id] ?? dec.proposedValue;
    let beforeVal = dec.currentValue ?? 'Unspecified';

    if (dec.targetStoryField) {
      const f = snapshot.storyBible[dec.targetStoryField];
      beforeVal = f?.status === 'confirmed' && f.value.trim() ? f.value.trim() : 'Unspecified';
    } else if (dec.targetEntityName && dec.targetAttributeName) {
      const ent = snapshot.entities.find(
        (e) =>
          e.id === dec.targetEntityId ||
          e.name.toLowerCase() === dec.targetEntityName!.toLowerCase()
      );
      const attr = ent?.attributes.find(
        (a) => a.name.toLowerCase() === dec.targetAttributeName!.toLowerCase()
      );
      beforeVal =
        attr?.status === 'confirmed' && attr.confirmedValue
          ? attr.confirmedValue
          : 'Unconfirmed';
    } else if (dec.category === 'relationship') {
      const rel = snapshot.relationships.find((r) => r.id === dec.targetRelationshipId);
      beforeVal = rel?.status === 'confirmed' ? rel.label : 'Unconfirmed (Pending)';
    }

    const targetLabel = dec.targetStoryField
      ? `Story Bible · ${dec.targetStoryField}`
      : dec.targetEntityName && dec.targetAttributeName
        ? `${dec.targetEntityName} · ${dec.targetAttributeName}`
        : dec.targetSourceEntityName && dec.targetTargetEntityName
          ? `Relationship · ${dec.targetSourceEntityName} → ${dec.targetTargetEntityName}`
          : dec.title;

    items.push({
      id: dec.id,
      source: 'decision',
      category: dec.category,
      targetLabel,
      beforeValue: beforeVal,
      afterValue: proposed,
      provenance: dec.provenance,
      conflictWarning: dec.conflictWith,
    });
  }

  let simulatedSnapshot = structuredClone(snapshot);
  if (targetDecisions.length > 0) {
    const appliedDec = applyDecisionBatch(
      simulatedSnapshot,
      targetDecisions.map((d) => d.id),
      'accept',
      draftDecisionValues
    );
    simulatedSnapshot = appliedDec.snapshot;
  }

  const currentRevision = project.revision ?? 1;
  const isStagedBatchForProject = Boolean(
    stagedBatch && (stagedBatch.baseProjectId === undefined || stagedBatch.baseProjectId === project.id)
  );
  const isStagedBatchRevisionStale = Boolean(
    isStagedBatchForProject &&
      stagedBatch?.baseRevision !== undefined &&
      stagedBatch.baseRevision !== currentRevision
  );

  if (stagedBatch && isStagedBatchForProject) {
    const selectedOps = stagedBatch.operations.filter((o) => o.selected);
    const staleWarning = isStagedBatchRevisionStale
      ? `Stale batch preview: generated at revision r${stagedBatch.baseRevision}, current revision is r${currentRevision}. Re-preview before applying.`
      : undefined;

    for (const op of selectedOps) {
      const targetLabel =
        op.type === 'update_story_bible'
          ? `Story Bible · ${op.storyField ?? 'field'}`
          : op.type === 'add_relationship' ||
              op.type === 'update_relationship' ||
              op.type === 'remove_relationship'
            ? `Relationship · ${op.sourceEntityName ?? '?'} → ${op.targetEntityName ?? '?'}`
            : `${op.entityName ?? 'Entity'}${op.attributeName ? ` · ${op.attributeName}` : ''}`;

      items.push({
        id: op.id,
        source: 'batch-preview',
        category: op.type,
        targetLabel,
        beforeValue: op.previousValue ?? 'Unspecified',
        afterValue: op.nextValue ?? op.newEntityName ?? (op.type === 'exclude_entity' ? 'Absent' : ''),
        provenance: 'user-edit',
        conflictWarning: op.conflictWarning ?? staleWarning,
      });
    }

    if (selectedOps.length > 0 && !isStagedBatchRevisionStale) {
      const appliedBatch = applyProposedOperations(simulatedSnapshot, selectedOps);
      if (appliedBatch.errors.length === 0) {
        simulatedSnapshot = appliedBatch.snapshot;
      }
    }
  }

  let afterPrompt = synthesizeRefinedPrompt(simulatedSnapshot, snapshot.mode);

  if (
    polishProposal &&
    polishProposal.projectId === project.id &&
    !polishProposal.isNoOp &&
    polishProposal.polishedPrompt.trim()
  ) {
    const isStale = !validatePolishProposalAcceptance(project, polishProposal).ok;
    items.push({
      id: polishProposal.requestId ?? 'polish_proposal',
      source: 'ai-polish',
      category: 'ai-polish',
      targetLabel: 'Refined Generation Prompt (AI Polish)',
      beforeValue: polishProposal.originalPrompt,
      afterValue: polishProposal.polishedPrompt,
      provenance: 'accepted-suggestion',
      conflictWarning: isStale
        ? 'Stale proposal: project state changed since this AI Polish was drafted.'
        : undefined,
    });
    if (!isStale && targetDecisions.length === 0 && !stagedBatch) {
      afterPrompt = polishProposal.polishedPrompt.trim();
    }
  }

  const beforePrompt = snapshot.refinedPrompt;
  return {
    projectId: project.id,
    revision: currentRevision,
    items,
    beforePrompt,
    afterPrompt,
    hasChanges: items.length > 0 || beforePrompt !== afterPrompt,
    hasStaleBatch: isStagedBatchRevisionStale,
  };
}

/**
 * Merges a project version into `savedProjects` without ever regressing a newer
 * in-memory revision or resurrecting a deleted project.
 */
export function upsertProjectInSavedList(
  savedProjects: CreativeProject[],
  candidate: CreativeProject
): CreativeProject[] {
  const deletedIds = getDeletedProjectIds();
  const filtered = savedProjects.filter((p) => !deletedIds.has(p.id));
  if (deletedIds.has(candidate.id)) {
    return filtered;
  }

  const idx = filtered.findIndex((p) => p.id === candidate.id);
  if (idx === -1) {
    return [candidate, ...filtered];
  }

  const existing = filtered[idx];
  const candidateRev = candidate.revision ?? 1;
  const existingRev = existing.revision ?? 1;
  const maxPersisted = Math.max(
    candidate.persistedRevision ?? 0,
    existing.persistedRevision ?? 0
  );
  const resolvedPersisted = maxPersisted > 0 ? maxPersisted : undefined;

  let merged: CreativeProject;
  if (candidateRev > existingRev) {
    merged = { ...candidate, persistedRevision: resolvedPersisted };
  } else if (candidateRev < existingRev) {
    merged = { ...existing, persistedRevision: resolvedPersisted };
  } else if (candidate.updatedAt >= existing.updatedAt) {
    merged = { ...candidate, persistedRevision: resolvedPersisted };
  } else {
    merged = { ...existing, persistedRevision: resolvedPersisted };
  }

  const next = [...filtered];
  next[idx] = merged;
  return next;
}

/**
 * Prepares a safe project switch (e.g., A -> B) when the current project may have
 * unpersisted in-memory edits or a pending debounced autosave timer:
 * - Synchronously commits the latest in-memory `currentProject` into `savedProjects`
 *   so switching back B -> A never reads a stale revision.
 * - Flags `projectToFlush` whenever `currentProject` has unpersisted edits so the
 *   caller flushes the durable save immediately rather than discarding it on timer cleanup.
 */
export function prepareProjectSwitch(params: {
  currentProject: CreativeProject;
  savedProjects: CreativeProject[];
  targetProjectId: string;
}): {
  savedProjects: CreativeProject[];
  targetProject: CreativeProject | null;
  projectToFlush: CreativeProject | null;
} {
  const { currentProject, savedProjects, targetProjectId } = params;
  const deletedIds = getDeletedProjectIds();
  const nextSaved = upsertProjectInSavedList(savedProjects, currentProject);
  const targetProject = nextSaved.find((p) => p.id === targetProjectId) ?? null;

  const isDirty =
    currentProject.persistedRevision === undefined ||
    (currentProject.revision ?? 1) > currentProject.persistedRevision;
  const projectToFlush =
    !deletedIds.has(currentProject.id) &&
    currentProject.id !== targetProjectId &&
    isDirty
      ? currentProject
      : null;

  return {
    savedProjects: nextSaved,
    targetProject,
    projectToFlush,
  };
}

/**
 * Reconciles an asynchronous durable-save acknowledgement without ever overwriting
 * newer in-memory revisions of either `currentActiveProject` or `savedProjects`.
 */
export function reconcileAsyncSaveAcknowledgement(params: {
  acknowledgedProject: CreativeProject;
  acknowledgedRevision: number;
  currentActiveProject: CreativeProject;
  savedProjects: CreativeProject[];
}): {
  activeProject: CreativeProject;
  savedProjects: CreativeProject[];
} {
  const {
    acknowledgedProject,
    acknowledgedRevision,
    currentActiveProject,
    savedProjects,
  } = params;

  const syncedProject: CreativeProject = {
    ...acknowledgedProject,
    persistedRevision: Math.max(
      acknowledgedProject.persistedRevision ?? 0,
      acknowledgedRevision
    ),
  };

  const nextSaved = upsertProjectInSavedList(savedProjects, syncedProject);

  let nextActive = currentActiveProject;
  if (currentActiveProject.id === acknowledgedProject.id) {
    const nextPersisted = Math.max(
      currentActiveProject.persistedRevision ?? 0,
      acknowledgedRevision
    );
    if (currentActiveProject.persistedRevision !== nextPersisted) {
      nextActive = {
        ...currentActiveProject,
        persistedRevision: nextPersisted,
      };
    }
  }

  return {
    activeProject: nextActive,
    savedProjects: nextSaved,
  };
}

export interface SerializedSaveOptions {
  requireExactBase?: boolean;
  expectedPersistedRevision?: number;
  expectedManuscriptVersionId?: string;
  expectedBaseSnapshotDigest?: string;
  intentId?: string;
  forceOverwrite?: boolean;
  allowDeleted?: boolean;
}

/**
 * Serializes durable save operations per project ID so rapid switch flushes and
 * subsequent edits on the same project execute in strict FIFO order and pass
 * updated expectedPersistedRevision values cleanly.
 */
export function createSerializedProjectSaveQueue(
  persistFn: (
    project: CreativeProject,
    options?: SerializedSaveOptions
  ) => Promise<StorageSaveResult>
) {
  const chains = new Map<string, Promise<StorageSaveResult>>();
  const lastCommittedRevisions = new Map<string, number>();

  const enqueue = (
    project: CreativeProject,
    options?: SerializedSaveOptions
  ): Promise<StorageSaveResult> => {
    const previous = chains.get(project.id) ?? Promise.resolve({ ok: true, saved: true });

    const run = previous
      .catch(() => ({ ok: false, saved: false } as StorageSaveResult))
      .then(async () => {
        if (!options?.allowDeleted && getDeletedProjectIds().has(project.id)) {
          return {
            ok: false,
            saved: false,
            error: `Project "${project.id}" was deleted before queued save executed.`,
          };
        }

        const lastKnown = lastCommittedRevisions.get(project.id);
        const rawExpected = options?.expectedPersistedRevision ?? project.persistedRevision;
        const effectiveExpected =
          lastKnown !== undefined && !options?.requireExactBase
            ? Math.max(rawExpected ?? 0, lastKnown)
            : rawExpected;

        const res = await persistFn(project, {
          ...options,
          expectedPersistedRevision: effectiveExpected,
        });

        if (res.saved) {
          const committedRev = res.persistedRevision ?? (project.revision ?? 1);
          lastCommittedRevisions.set(
            project.id,
            Math.max(lastCommittedRevisions.get(project.id) ?? 0, committedRev)
          );
        }
        return res;
      });

    chains.set(project.id, run);
    void run.finally(() => {
      if (chains.get(project.id) === run) {
        chains.delete(project.id);
      }
    });
    return run;
  };

  const resetProject = (projectId: string) => {
    lastCommittedRevisions.delete(projectId);
  };

  return {
    enqueue,
    resetProject,
  };
}

export type HydrationWriteGate =
  | 'pending'
  | 'ready'
  | 'unavailable'
  | 'blocked-read-error';

export function resolveHydrationWriteGate(status: IndexedDbLoadStatus): HydrationWriteGate {
  if (status === 'ok' || status === 'empty') {
    return 'ready';
  }
  if (status === 'unavailable') {
    return 'unavailable';
  }
  return 'blocked-read-error';
}

export function shouldAllowUnsolicitedPersistence(params: {
  hydrationGate: HydrationWriteGate;
  hasLocalEditsSinceMount: boolean;
  isDeleted: boolean;
  storageAlertType?: 'conflict' | 'quota' | 'error' | null;
  storageAlertProjectId?: string | null;
  activeProjectId: string;
}): boolean {
  if (params.isDeleted) {
    return false;
  }
  if (
    params.storageAlertType === 'conflict' &&
    params.storageAlertProjectId === params.activeProjectId
  ) {
    return false;
  }
  if (params.hydrationGate === 'blocked-read-error') {
    return false;
  }
  if (params.hydrationGate === 'pending' && !params.hasLocalEditsSinceMount) {
    return false;
  }
  return true;
}



