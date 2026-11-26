import { NarrativeExtractionSchema, type NarrativeExtractionRequest } from '../../../shared/importSchemas.ts';
import {
  commitImportSegmentAttempt,
  createImportCheckpoint,
  getImportCheckpoint,
  matchesImportCheckpointIdentity,
  renewImportSegmentAttempt,
  reserveImportSegmentAttempt,
  saveImportCheckpoint,
  type ImportAttemptFence,
  type ImportCheckpoint,
  type ImportCheckpointIdentityInput,
} from './analysisCheckpoints.ts';
import { verifyExtractionEvidence, type VerifiedExtraction } from './proposalValidator.ts';
import {
  ALL_IMPORT_CATEGORIES,
  buildAdaptivePlanOptions,
  buildCheckpointIdentityInput,
  isImportConnectionId,
  isImportReasoningLevel,
  MAX_EXTRACTION_CALLS,
  type AnalysisConfiguration,
  type ImportProviderPlanContext,
} from './providerPlan.ts';
import { calculateProcessedCoverage, planAdaptiveNarrativeSourceAnalysis, type SourceChunk } from './segmentation.ts';
import type { ParsedNarrativeSource } from './sourceParser.ts';

export interface AnalysisRunnerDeps {
  getIdbFactory: () => IDBFactory;
  extractChunk: (request: NarrativeExtractionRequest, signal?: AbortSignal) => Promise<unknown>;
  isAbortError: (error: unknown) => boolean;
  readProviderSnapshotRaw: () => string | null;
  leaseRenewIntervalMs?: number;
  leaseMs?: number;
}

export interface AnalysisRunnerCallbacks {
  setBusy: (busy: boolean) => void;
  setCancelled: (cancelled: boolean) => void;
  setRequestError: (message: string) => void;
  setSourceOnlyMode: (sourceOnly: boolean) => void;
  setAnalysisConfiguration: (config: AnalysisConfiguration) => void;
  setActiveCheckpointId: (id: string | null) => void;
  setChunks: (chunks: SourceChunk[]) => void;
  setSegmentationComplete: (complete: boolean) => void;
  setResults: (updater: VerifiedExtraction[] | ((prev: VerifiedExtraction[]) => VerifiedExtraction[])) => void;
  setCompletedChunkIds: (updater: Set<string> | ((prev: Set<string>) => Set<string>)) => void;
  setFailedChunks: (updater: SourceChunk[] | ((prev: SourceChunk[]) => SourceChunk[])) => void;
  setRejectedEvidenceCount: (count: number) => void;
  setCallsUsed: (calls: number) => void;
  onCheckpointUpdated: (checkpoint: ImportCheckpoint | null) => void;
  onCompleteSession: () => void;
}

export interface AnalysisSessionParams {
  source: ParsedNarrativeSource;
  sourceId: string;
  providerPlanContext: ImportProviderPlanContext | null;
  configuration: AnalysisConfiguration;
  hasExistingConfiguration: boolean;
  retry: boolean;
  callsUsed: number;
  failedChunks: SourceChunk[];
  rejectedEvidenceCount: number;
  initialCheckpoint: ImportCheckpoint | null;
  initialProviderSnapshotRaw: string | null;
  ownerId: string;
  controller: AbortController;
  isStaleEpoch: () => boolean;
  deps: AnalysisRunnerDeps;
  callbacks: AnalysisRunnerCallbacks;
}

function defaultProductionDeps(): AnalysisRunnerDeps {
  throw new Error('Explicit dependencies are required.');
}

async function prepareCheckpointAndPlan(
  params: AnalysisSessionParams,
  identityInput: ImportCheckpointIdentityInput,
  currentPlan: ReturnType<typeof planAdaptiveNarrativeSourceAnalysis>,
): Promise<{ checkpoint: ImportCheckpoint; planned: SourceChunk[] } | null> {
  const { source, retry, failedChunks, controller, isStaleEpoch, deps, callbacks } = params;
  const idb = deps.getIdbFactory();
  let checkpoint = params.initialCheckpoint;

  if (checkpoint) {
    const latest = await getImportCheckpoint(idb, checkpoint.id);
    if (controller.signal.aborted || isStaleEpoch()) return null;
    if (!latest.ok || !latest.value || !(await matchesImportCheckpointIdentity(latest.value, identityInput))) {
      if (!isStaleEpoch()) {
        callbacks.setRequestError(
          `Analysis stopped before provider access because checkpoint identity could not be revalidated: ${latest.ok ? 'the checkpoint is missing or no longer matches the approved plan.' : latest.error}`,
        );
      }
      return null;
    }
    if (controller.signal.aborted || isStaleEpoch()) return null;
    checkpoint = latest.value;
    callbacks.onCheckpointUpdated(checkpoint);
  }

  if (retry) {
    if (!checkpoint) return null;
    return { checkpoint, planned: failedChunks };
  }
  if (checkpoint) {
    const planned = checkpoint.segments
      .filter(segment => segment.status !== 'complete')
      .map(segment => ({ id: segment.id, index: segment.index, start: segment.start, end: segment.end, text: source.text.slice(segment.start, segment.end) }));
    return { checkpoint, planned };
  }

  const created = await createImportCheckpoint(identityInput);
  if (controller.signal.aborted || isStaleEpoch()) return null;
  const saved = await saveImportCheckpoint(idb, created);
  if (controller.signal.aborted || isStaleEpoch()) return null;
  if (!saved.ok) {
    callbacks.setRequestError(
      `Analysis stopped before provider access because the local recovery checkpoint could not be saved: ${saved.error}`,
    );
    return null;
  }
  callbacks.onCheckpointUpdated(created);
  callbacks.setActiveCheckpointId(created.id);
  const planned = created.segments.map(segment => ({ ...segment, text: source.text.slice(segment.start, segment.end) }));
  callbacks.setChunks(planned);
  callbacks.setSegmentationComplete(created.plan.complete);
  callbacks.setCompletedChunkIds(new Set());
  callbacks.setResults([]);
  callbacks.setFailedChunks([]);
  callbacks.setRejectedEvidenceCount(0);
  callbacks.setCallsUsed(0);
  void currentPlan;
  return { checkpoint: created, planned };
}

function buildChunkExtractionRequest(
  checkpoint: ImportCheckpoint,
  chunk: SourceChunk,
  source: ParsedNarrativeSource,
  sourceId: string,
  configuration: AnalysisConfiguration,
): NarrativeExtractionRequest {
  const provider = checkpoint.provider;
  if (!isImportConnectionId(provider.connectionId) || !provider.modelId ||
      !isImportReasoningLevel(provider.reasoningLevel) || !provider.capabilityPolicyVersion ||
      !provider.credentialAuthorityId) {
    throw new Error('The checkpoint provider identity is incomplete. Replan and confirm the analysis before continuing.');
  }
  return {
    sourceId,
    sourceVersion: 'v1',
    digest: source.digest,
    chunkId: chunk.id,
    text: chunk.text,
    scope: configuration.scope,
    categories: configuration.scope === 'complete' ? ALL_IMPORT_CATEGORIES : configuration.categories,
    instruction: configuration.instruction,
    providerPlanBinding: {
      connectionId: provider.connectionId,
      modelId: provider.modelId,
      reasoningLevel: provider.reasoningLevel,
      capabilityPolicyVersion: provider.capabilityPolicyVersion,
      credentialAuthorityId: provider.credentialAuthorityId,
    },
  };
}

async function runChunkWithLeaseHeartbeat(
  request: NarrativeExtractionRequest,
  fence: ImportAttemptFence,
  controller: AbortController,
  isStaleEpoch: () => boolean,
  deps: AnalysisRunnerDeps,
): Promise<{ raw: unknown; leaseLost: boolean }> {
  const intervalMs = deps.leaseRenewIntervalMs ?? 30_000;
  const leaseMs = deps.leaseMs ?? 120_000;
  let leaseTimer: ReturnType<typeof setTimeout> | undefined;
  let leaseStopped = false;
  let leaseLost = false;

  const stopLease = () => {
    leaseStopped = true;
    if (leaseTimer !== undefined) {
      clearTimeout(leaseTimer);
      leaseTimer = undefined;
    }
  };

  const keepLease = async () => {
    if (leaseStopped || controller.signal.aborted || isStaleEpoch()) return;
    try {
      const renewed = await renewImportSegmentAttempt(deps.getIdbFactory(), fence, leaseMs);
      if (leaseStopped || controller.signal.aborted || isStaleEpoch()) return;
      if (!renewed.ok || !renewed.value) {
        leaseLost = true;
        stopLease();
        controller.abort();
        return;
      }
      leaseTimer = setTimeout(() => { void keepLease(); }, intervalMs);
    } catch {
      if (!leaseStopped && !controller.signal.aborted && !isStaleEpoch()) {
        leaseLost = true;
        stopLease();
        controller.abort();
      }
    }
  };

  leaseTimer = setTimeout(() => { void keepLease(); }, intervalMs);
  try {
    const raw = await deps.extractChunk(request, controller.signal);
    return { raw, leaseLost };
  } catch (error) {
    if (leaseLost) {
      const leaseError = new Error('The analysis checkpoint lease was lost; remaining segments were stopped.');
      leaseError.name = 'CheckpointLeaseLostError';
      throw leaseError;
    }
    throw error;
  } finally {
    stopLease();
  }
}

export async function runImportAnalysisSession(params: AnalysisSessionParams): Promise<void> {
  const {
    source, sourceId, providerPlanContext, configuration, hasExistingConfiguration,
    retry, callsUsed, initialProviderSnapshotRaw, ownerId, controller, isStaleEpoch,
    deps = defaultProductionDeps(), callbacks,
  } = params;

  if (!providerPlanContext || !providerPlanContext.operationEligible || providerPlanContext.connectionId === 'chatgpt-plan') {
    callbacks.setRequestError(
      'Narrative import requires a currently verified eligible non-ChatGPT provider selection. Refresh provider status and review the plan before retrying.',
    );
    return;
  }
  if (callsUsed >= MAX_EXTRACTION_CALLS) {
    callbacks.setRequestError(
      `This import reached its ${MAX_EXTRACTION_CALLS}-call safety budget. Create an explicitly incomplete project or start a new scoped import.`,
    );
    return;
  }

  callbacks.setSourceOnlyMode(false);
  callbacks.setBusy(true);
  callbacks.setCancelled(false);
  callbacks.setRequestError('');
  if (!retry || !hasExistingConfiguration) callbacks.setAnalysisConfiguration(configuration);

  const failures: SourceChunk[] = [];
  let totalRejected = retry ? params.rejectedEvidenceCount : params.rejectedEvidenceCount;
  let leaseLostDuringRun = false;
  let hasPreparedPlan = false;
  let plannedChunks: SourceChunk[] = [];

  try {
    const currentPlan = planAdaptiveNarrativeSourceAnalysis(
      source.text,
      source.blocks,
      MAX_EXTRACTION_CALLS,
      buildAdaptivePlanOptions(providerPlanContext.contextLimitTokens),
    );
    const identityInput = buildCheckpointIdentityInput({ source, configuration, providerPlanContext, plan: currentPlan });
    const prepared = await prepareCheckpointAndPlan(params, identityInput, currentPlan);
    if (!prepared) return;

    let checkpoint = prepared.checkpoint;
    plannedChunks = prepared.planned;
    hasPreparedPlan = true;
    const leaseMs = deps.leaseMs ?? 120_000;

    for (let index = 0; index < plannedChunks.length; index += 1) {
      const chunk = plannedChunks[index];
      if (controller.signal.aborted || isStaleEpoch()) {
        failures.push(...plannedChunks.slice(index));
        break;
      }
      if (deps.readProviderSnapshotRaw() !== initialProviderSnapshotRaw) {
        failures.push(...plannedChunks.slice(index));
        callbacks.setRequestError(
          'The provider selection changed during this analysis. Remaining segments were stopped; review the plan and start a new analysis to use the new selection.',
        );
        break;
      }
      const idb = deps.getIdbFactory();
      const reservation = await reserveImportSegmentAttempt(idb, checkpoint.id, chunk.id, ownerId, true, leaseMs);
      if (!reservation.ok) {
        failures.push(...plannedChunks.slice(index));
        callbacks.setRequestError(
          `Analysis stopped before the next provider request because its persistent budget could not be reserved: ${reservation.error}`,
        );
        break;
      }
      checkpoint = reservation.value;
      callbacks.onCheckpointUpdated(checkpoint);
      const reservedSegment = checkpoint.segments.find(item => item.id === chunk.id)!;
      const fence: ImportAttemptFence = {
        checkpointId: checkpoint.id,
        incarnationId: checkpoint.incarnationId,
        segmentId: chunk.id,
        attemptId: reservedSegment.attemptId!,
        ownerId,
      };
      callbacks.setCallsUsed(checkpoint.budget.callsUsed);

      try {
        const request = buildChunkExtractionRequest(checkpoint, chunk, source, sourceId, configuration);
        const { raw, leaseLost } = await runChunkWithLeaseHeartbeat(request, fence, controller, isStaleEpoch, deps);
        if (leaseLost) {
          leaseLostDuringRun = true;
          failures.push(...plannedChunks.slice(index));
          callbacks.setRequestError('The analysis checkpoint lease was lost; remaining segments were stopped.');
          break;
        }
        if (controller.signal.aborted || isStaleEpoch()) {
          await commitImportSegmentAttempt(idb, fence, segment => { segment.status = 'uncertain'; });
          failures.push(...plannedChunks.slice(index));
          break;
        }
        const validated = verifyExtractionEvidence(NarrativeExtractionSchema.parse(raw), chunk, { id: sourceId, version: 'v1', digest: source.digest });
        const persisted = await commitImportSegmentAttempt(idb, fence, (segment, current) => {
          segment.status = 'complete';
          segment.result = validated;
          const done = current.segments.filter(item => item.status === 'complete');
          current.coverage = {
            complete: current.plan.complete && done.length === current.segments.length,
            processedCharacters: calculateProcessedCoverage(done.map(item => ({ start: item.start, end: item.end, id: item.id, index: item.index, text: '' })))
              .reduce((sum, span) => sum + span.end - span.start, 0),
            totalCharacters: source.text.length,
          };
        });
        if (!persisted.ok || !persisted.value) {
          failures.push(...plannedChunks.slice(index));
          callbacks.setRequestError(`The provider result lost checkpoint attempt authority and was not committed${persisted.ok ? '.' : `: ${persisted.error}`}`);
          break;
        }
        const latest = await getImportCheckpoint(idb, checkpoint.id);
        if (latest.ok && latest.value) {
          checkpoint = latest.value;
          callbacks.onCheckpointUpdated(checkpoint);
        }
        totalRejected += validated.rejectedEvidenceCount;
        if (!isStaleEpoch()) {
          callbacks.setRejectedEvidenceCount(totalRejected);
          callbacks.setResults(previous => [...previous, validated]);
          callbacks.setCompletedChunkIds(previous => new Set([...previous, chunk.id]));
        }
      } catch (error) {
        if (error instanceof Error && error.name === 'CheckpointLeaseLostError') {
          leaseLostDuringRun = true;
          failures.push(...plannedChunks.slice(index));
          callbacks.setRequestError(error.message);
          break;
        }
        const uncertain = deps.isAbortError(error) || controller.signal.aborted;
        const persisted = await commitImportSegmentAttempt(idb, fence, segment => { segment.status = uncertain ? 'uncertain' : 'failed'; });
        if (persisted.ok && persisted.value) {
          const latest = await getImportCheckpoint(idb, checkpoint.id);
          if (latest.ok && latest.value) {
            checkpoint = latest.value;
            callbacks.onCheckpointUpdated(checkpoint);
          }
        }
        if (uncertain) {
          failures.push(...plannedChunks.slice(index));
          break;
        }
        failures.push(chunk);
        if (!isStaleEpoch()) {
          callbacks.setRequestError(error instanceof Error ? error.message : 'A source segment could not be analyzed.');
        }
      }
    }
  } catch (preLoopError) {
    if (!isStaleEpoch() && !controller.signal.aborted) {
      callbacks.setRequestError(
        preLoopError instanceof Error ? preLoopError.message : 'Narrative analysis could not start due to a local storage or planning failure.',
      );
    }
  } finally {
    const aborted = !leaseLostDuringRun && (controller.signal.aborted || isStaleEpoch());
    if (!isStaleEpoch()) {
      if (hasPreparedPlan) {
        callbacks.setFailedChunks(previous =>
          retry ? [...previous.filter(old => !plannedChunks.some(item => item.id === old.id)), ...failures] : failures,
        );
      }
      callbacks.setCancelled(aborted);
    }
    callbacks.setBusy(false);
    callbacks.onCompleteSession();
  }
}
