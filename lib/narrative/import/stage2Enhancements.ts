import type { CreativeProject } from '../../../shared/types.ts';
import type {
  ImportEnhanceRequest,
  ImportEnhanceResponse,
  ImportEnhancementProposal,
} from '../../../shared/narrativeAiSchemas.ts';
import { isAbortError } from '../../../services/apiClient.ts';

export interface Stage2SourceIdentity {
  sourceId: string;
  sourceVersion: string;
  digest: string;
}

export interface Stage2EnhancementBatch {
  identity: Stage2SourceIdentity;
  runId: number;
  proposals: ImportEnhancementProposal[];
}

export interface Stage2EnhancementState {
  busy: boolean;
  error: string;
  batch: Stage2EnhancementBatch | null;
  proposals: ImportEnhancementProposal[];
  acceptedIds: Set<string>;
}

export interface Stage2EnhancementController {
  getState: () => Stage2EnhancementState;
  getActiveSource: () => Stage2SourceIdentity | null;
  setActiveSource: (identity: Stage2SourceIdentity | null) => void;
  invalidate: () => void;
  dispose: () => void;
  toggleAccepted: (proposalId: string, checked: boolean) => void;
  run: (params: {
    request: ImportEnhanceRequest | null;
    aiConfigured: boolean;
    identity: Stage2SourceIdentity | null;
    transport: (payload: ImportEnhanceRequest, signal?: AbortSignal) => Promise<ImportEnhanceResponse>;
  }) => Promise<boolean>;
  getValidatedAcceptedProposals: (expectedIdentity: Stage2SourceIdentity | null) => ImportEnhancementProposal[];
}

export function isSameStage2SourceIdentity(
  left: Stage2SourceIdentity | null | undefined,
  right: Stage2SourceIdentity | null | undefined
): boolean {
  if (!left || !right) return false;
  return (
    left.sourceId !== '' &&
    left.sourceId === right.sourceId &&
    left.sourceVersion === right.sourceVersion &&
    left.digest !== '' &&
    left.digest === right.digest
  );
}

/**
 * Authoritative Stage 2 enhancement lifecycle controller for ImportWorkflow (R0-A).
 * Binds in-flight requests, stored proposal batches, and user approvals strictly to
 * (sourceId, sourceVersion, digest, monotonic runId) with dedicated AbortController
 * cancellation separate from preview source reading and Stage 1 chunk analysis.
 */
export function createStage2EnhancementController(
  onChange?: (state: Stage2EnhancementState) => void
): Stage2EnhancementController {
  let activeIdentity: Stage2SourceIdentity | null = null;
  let activeRunId = 0;
  let activeAbortController: AbortController | null = null;
  let disposed = false;

  let state: Stage2EnhancementState = {
    busy: false,
    error: '',
    batch: null,
    proposals: [],
    acceptedIds: new Set<string>(),
  };

  const emit = (next: Stage2EnhancementState) => {
    state = next;
    if (!disposed) {
      onChange?.(state);
    }
  };

  const abortInFlightAndBumpRun = () => {
    activeRunId += 1;
    activeAbortController?.abort();
    activeAbortController = null;
  };

  const isRunCurrent = (runId: number, identity: Stage2SourceIdentity): boolean =>
    !disposed &&
    runId === activeRunId &&
    isSameStage2SourceIdentity(activeIdentity, identity);

  const resetBatchState = () => {
    abortInFlightAndBumpRun();
    emit({
      busy: false,
      error: '',
      batch: null,
      proposals: [],
      acceptedIds: new Set<string>(),
    });
  };

  return {
    getState: () => state,
    getActiveSource: () => activeIdentity,
    setActiveSource: (identity) => {
      if (isSameStage2SourceIdentity(activeIdentity, identity)) {
        return;
      }
      activeIdentity = identity ? { ...identity } : null;
      resetBatchState();
    },
    invalidate: () => {
      resetBatchState();
    },
    dispose: () => {
      disposed = true;
      activeIdentity = null;
      abortInFlightAndBumpRun();
    },
    toggleAccepted: (proposalId, checked) => {
      if (disposed || !state.batch || !isSameStage2SourceIdentity(state.batch.identity, activeIdentity)) {
        return;
      }
      if (!state.batch.proposals.some((proposal) => proposal.id === proposalId)) {
        return;
      }
      const next = new Set(state.acceptedIds);
      if (checked) next.add(proposalId);
      else next.delete(proposalId);
      emit({ ...state, acceptedIds: next });
    },
    run: async ({ request, aiConfigured, identity, transport }) => {
      if (disposed || !request || !identity) return false;
      if (!isSameStage2SourceIdentity(activeIdentity, identity)) {
        return false;
      }
      if (!aiConfigured) {
        emit({
          ...state,
          error: 'No AI provider is configured. Connect an AI provider in AI Settings to run Stage 2 enhancements.',
        });
        return false;
      }

      abortInFlightAndBumpRun();
      const runId = activeRunId;
      const controller = new AbortController();
      activeAbortController = controller;
      const boundIdentity: Stage2SourceIdentity = { ...identity };

      emit({
        ...state,
        busy: true,
        error: '',
      });

      try {
        const res = await transport(request, controller.signal);
        if (!isRunCurrent(runId, boundIdentity) || controller.signal.aborted) {
          return false;
        }
        const proposals = Array.isArray(res.proposals) ? res.proposals : [];
        emit({
          busy: false,
          error: '',
          batch: {
            identity: boundIdentity,
            runId,
            proposals,
          },
          proposals,
          acceptedIds: new Set<string>(),
        });
        return true;
      } catch (cause) {
        if (!isRunCurrent(runId, boundIdentity) || controller.signal.aborted || isAbortError(cause)) {
          return false;
        }
        emit({
          ...state,
          busy: false,
          error: cause instanceof Error ? cause.message : 'Enhancement proposal generation failed.',
        });
        return false;
      } finally {
        if (activeAbortController === controller) {
          activeAbortController = null;
        }
        if (isRunCurrent(runId, boundIdentity) && state.busy) {
          emit({ ...state, busy: false });
        }
      }
    },
    getValidatedAcceptedProposals: (expectedIdentity) => {
      if (!expectedIdentity || !state.batch) return [];
      if (
        !isSameStage2SourceIdentity(state.batch.identity, expectedIdentity) ||
        !isSameStage2SourceIdentity(activeIdentity, expectedIdentity)
      ) {
        return [];
      }
      return state.batch.proposals.filter((proposal) => state.acceptedIds.has(proposal.id));
    },
  };
}

function hashEnhancementId(value: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < value.length; i += 1) {
    hash ^= value.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(36);
}

export function attachAcceptedStage2Opportunities(
  assembled: CreativeProject,
  selectedEnhancements: ImportEnhancementProposal[],
  sourceId: string,
  now: number = Date.now()
): CreativeProject {
  if (selectedEnhancements.length > 0 && assembled.narrative) {
    const usedIds = new Set((assembled.narrative.opportunities ?? []).map((item) => item.id));
    const stamp = now.toString(36).slice(-4);
    assembled.narrative.opportunities = [
      ...(assembled.narrative.opportunities ?? []),
      ...selectedEnhancements.map((enh, index) => {
        const base = `opp_enh_${hashEnhancementId(enh.id)}_${index}_${stamp}`;
        let id = base;
        let suffix = 1;
        while (usedIds.has(id)) {
          id = `${base}_${suffix++}`;
        }
        usedIds.add(id);
        return {
          id,
          projectId: assembled.id,
          description: `[Import Enhancement · ${enh.category}] ${enh.title}`,
          sourceRefs: [sourceId],
          rationale: enh.rationale,
          benefit: enh.afterExcerpt,
          tradeOff: 'Post-faithful creative enhancement proposal — immutable source remains unchanged.',
          assumptions: enh.assumptions,
          status: 'pending' as const,
          origin: 'ai' as const,
          category: enh.category,
          options: [enh.afterExcerpt],
          baseRevision: assembled.revision,
          lifecycleRevision: assembled.revision,
          createdAt: now,
          updatedAt: now,
        };
      }),
    ];
  }
  return assembled;
}
