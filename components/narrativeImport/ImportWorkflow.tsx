import { useEffect, useMemo, useRef, useState } from 'react';
import type { CreativeProject } from '../../shared/types';
import { buildClientBudgetDisclosure } from '../../lib/narrative/aiBudgetClient';
import { assembleImportedProject } from '../../lib/narrative/import/assembleProject';
import {
  appendTargetBase,
  detectDuplicateSourceInProject,
  findCrossProjectIdentityMatches,
  matchesAppendTarget,
  type AppendInsertPosition,
  type AppendTargetBase,
  type CrossProjectIdentityDecision,
} from '../../lib/narrative/import/appendApply';
import { findPossibleIdentityMatches } from '../../lib/narrative/import/identityResolver';
import { deduplicateChunkProposals, type VerifiedExtraction } from '../../lib/narrative/import/proposalValidator';
import { calculateProcessedCoverage, planAdaptiveNarrativeSourceAnalysis, type SourceChunk } from '../../lib/narrative/import/segmentation';
import { parseNarrativeSource, type ParsedNarrativeSource } from '../../lib/narrative/import/sourceParser';
import { manuscriptSections } from '../../lib/narrative/manuscriptModel';
import {
  deleteImportCheckpoint,
  getImportCheckpoint,
  listImportCheckpoints,
  matchesImportCheckpointIdentity,
  validateCheckpointEvidence,
  type ImportCheckpoint,
} from '../../lib/narrative/import/analysisCheckpoints';
import {
  attachAcceptedStage2Opportunities,
  createStage2EnhancementController,
  type Stage2EnhancementController,
  type Stage2EnhancementState,
} from '../../lib/narrative/import/stage2Enhancements';
import {
  ALL_IMPORT_CATEGORIES,
  buildAdaptivePlanOptions,
  buildCheckpointIdentityInput,
  emptyExtraction,
  fetchImportProviderPlanContext,
  IMPORT_CATEGORY_OPTIONS,
  MAX_EXTRACTION_CALLS,
  PROVIDER_PREFERENCES_STORAGE_KEY,
  readCurrentProviderPreferencesRaw,
  type AnalysisConfiguration,
  type Category,
  type ImportProviderPlanContext,
} from '../../lib/narrative/import/providerPlan';
import { runImportAnalysisSession } from '../../lib/narrative/import/analysisRunner';
import { extractNarrativeChunk, isAbortError, requestImportEnhancements } from '../../services/apiClient';
import { workspaceButton } from '../manuscript/ManuscriptEditor';
import { SourcePreviewSection } from './SourcePreviewSection';
import { CandidateReviewSection } from './CandidateReviewSection';

export function buildSourceOnlyImportedProject(
  source: ParsedNarrativeSource,
  sourceId: string,
  projectName: string,
  now = Date.now(),
): CreativeProject {
  return assembleImportedProject(source, emptyExtraction(), [], {
    sourceId,
    acceptedIds: new Set(),
    rejectedIds: new Set(),
    projectName,
  }, now);
}

interface Props {
  existingProjects?: CreativeProject[];
  activeProjectId?: string;
  aiConfigured?: boolean;
  onCreateProject: (project: CreativeProject) => Promise<void>;
  onAppendToExistingProject?: (params: {
    reviewedTarget: AppendTargetBase;
    incomingProject: CreativeProject;
    insertPosition: AppendInsertPosition;
    identityDecisions: Record<string, CrossProjectIdentityDecision>;
    allowDuplicateSource: boolean;
  }) => Promise<void>;
  onCancelImport: () => void;
}

function rebindExtractionSource(result: VerifiedExtraction, sourceId: string): VerifiedExtraction {
  const rebind = <T extends { evidence: { sourceId: string } }>(item: T): T => ({
    ...item,
    evidence: { ...item.evidence, sourceId },
  });
  return {
    findings: result.findings.map(rebind),
    entities: result.entities.map(entity => ({ ...rebind(entity), attributes: entity.attributes.map(rebind) })),
    relationships: result.relationships.map(rebind),
    ambiguities: result.ambiguities.map(rebind),
    rejectedEvidenceCount: result.rejectedEvidenceCount,
  };
}

function getExplicitProposalIds(extraction: VerifiedExtraction): string[] {
  return [
    ...extraction.entities.filter((item) => item.kind === 'explicit').map((item) => item.id),
    ...extraction.entities
      .filter((item) => item.kind === 'explicit')
      .flatMap((item) => item.attributes.filter((attribute) => attribute.kind === 'explicit').map((attribute) => attribute.id)),
    ...extraction.relationships.filter((item) => item.kind === 'explicit').map((item) => item.id),
    ...extraction.findings.filter((item) => item.kind === 'explicit').map((item) => item.id),
  ];
}

function resolveIdbSafely(): IDBFactory {
  return window.indexedDB;
}

function canStartImportAnalysis(params: {
  aiConfigured: boolean;
  source: ParsedNarrativeSource | null;
  busy: boolean;
  sourceError: string;
  providerPlanContext: ImportProviderPlanContext | null;
  parsedHasFileRetentionGap: boolean;
  confirmExtractedOnly: boolean;
  scope: 'complete' | 'selective';
  categories: Category[];
}): boolean {
  if (!params.aiConfigured || !params.source || params.busy) return false;
  if (params.sourceError || !params.providerPlanContext) return false;
  if (params.providerPlanContext.connectionId === 'chatgpt-plan') return false;
  if (!params.providerPlanContext.operationEligible) return false;
  if (params.parsedHasFileRetentionGap && !params.confirmExtractedOnly) return false;
  return params.scope !== 'selective' || params.categories.length > 0;
}

function buildInitialAnalysisPlan(
  source: ParsedNarrativeSource | null,
  busy: boolean,
  callsUsed: number,
  providerPlanContext: ImportProviderPlanContext | null,
) {
  if (!source || busy) return null;
  const remaining = Math.max(0, MAX_EXTRACTION_CALLS - callsUsed);
  return planAdaptiveNarrativeSourceAnalysis(
    source.text,
    source.blocks,
    remaining,
    buildAdaptivePlanOptions(providerPlanContext?.contextLimitTokens),
  );
}

function resolveInsertPosition(insertPositionKey: string): AppendInsertPosition {
  if (insertPositionKey === 'beginning') return 'beginning';
  if (insertPositionKey === 'end') return 'end';
  return { afterSectionId: insertPositionKey };
}

async function fetchMatchingCheckpointsForSource(
  parsed: ParsedNarrativeSource,
): Promise<{ candidates: ImportCheckpoint[]; message: string }> {
  try {
    const checkpoints = await listImportCheckpoints(resolveIdbSafely());
    if (!checkpoints.ok) {
      return { candidates: [], message: `Saved analysis checkpoints are unavailable: ${checkpoints.error}` };
    }
    return {
      candidates: filterMatchingCheckpoints(checkpoints.value, parsed),
      message: checkpoints.warning ?? '',
    };
  } catch (error) {
    const detail = error instanceof Error ? error.message : 'IndexedDB access failed.';
    return { candidates: [], message: `Saved analysis checkpoints are unavailable: ${detail}` };
  }
}

async function verifyAndReloadCheckpoint(params: {
  checkpoint: ImportCheckpoint;
  source: ParsedNarrativeSource;
  configuration: AnalysisConfiguration;
  providerPlanContext: ImportProviderPlanContext;
  isStale: () => boolean;
}): Promise<{ ok: true; value: ImportCheckpoint } | { ok: false; message: string; stale?: boolean }> {
  const { checkpoint, source, configuration, providerPlanContext, isStale } = params;
  const plan = planAdaptiveNarrativeSourceAnalysis(
    source.text,
    source.blocks,
    MAX_EXTRACTION_CALLS,
    buildAdaptivePlanOptions(providerPlanContext.contextLimitTokens),
  );
  const identityInput = buildCheckpointIdentityInput({ source, configuration, providerPlanContext, plan });
  if (!(await matchesImportCheckpointIdentity(checkpoint, identityInput))) {
    return { ok: false, stale: isStale(), message: 'This checkpoint does not match the current source, analysis plan, instruction, provider, model, or reasoning setting.' };
  }
  if (isStale()) return { ok: false, stale: true, message: '' };
  if (!validateCheckpointEvidence(checkpoint, source.text, source.digest)) {
    return { ok: false, message: 'Saved evidence no longer matches the source text. This checkpoint is rejected; no provider request was made.' };
  }
  const current = await getImportCheckpoint(resolveIdbSafely(), checkpoint.id);
  if (isStale()) return { ok: false, stale: true, message: '' };
  if (!current.ok || !current.value) {
    const detail = current.ok ? 'It was deleted or evicted.' : current.error;
    return { ok: false, message: `The checkpoint could not be safely restored: ${detail}` };
  }
  const identityOk = await matchesImportCheckpointIdentity(current.value, identityInput);
  if (!identityOk || !validateCheckpointEvidence(current.value, source.text, source.digest)) {
    return { ok: false, stale: isStale(), message: 'This checkpoint changed while it was being restored; refresh the source and provider status, then try again.' };
  }
  return { ok: true, value: current.value };
}

function buildWorkflowSteps(params: {
  source: ParsedNarrativeSource | null;
  chunksLength: number;
  sourceOnlyMode: boolean;
  resultsLength: number;
  decisionCount: number;
}) {
  const { source, chunksLength, sourceOnlyMode, resultsLength, decisionCount } = params;
  return [
    { label: 'Choose source', complete: Boolean(source), current: !source },
    { label: 'Inspect source', complete: Boolean(source), current: Boolean(source && chunksLength === 0 && !sourceOnlyMode) },
    { label: 'Analyze source (optional)', complete: sourceOnlyMode || resultsLength > 0, current: Boolean(source && !sourceOnlyMode && resultsLength === 0) },
    { label: 'Review candidates', complete: sourceOnlyMode || decisionCount > 0, current: resultsLength > 0 && decisionCount === 0 },
    { label: 'Choose destination & commit', complete: false, current: sourceOnlyMode || (resultsLength > 0 && decisionCount > 0) },
  ];
}

function buildEnhancePreviewPayload(
  source: ParsedNarrativeSource | null,
  entities: VerifiedExtraction['entities'],
  enhanceGoals: string,
) {
  if (!source) return null;
  const trimmedGoals = enhanceGoals.trim();
  return {
    filename: source.filename,
    sourceTextExcerpt: source.text.slice(0, 12_000),
    entities: entities.slice(0, 40).map((e) => ({ name: e.name, category: e.category })),
    sections: source.blocks.slice(0, 10).map((b, i) => {
      const blockText = source.text.slice(b.start, b.end);
      return {
        title: b.kind === 'heading' ? (b.label || blockText.slice(0, 120)) : `Block ${i + 1}`,
        excerpt: blockText.slice(0, 1200),
      };
    }),
    ...(trimmedGoals ? { goals: trimmedGoals } : {}),
  };
}

function buildImportCoverageMetadata(params: {
  analysisComplete: boolean;
  analysisConfiguration: AnalysisConfiguration | null;
  scope: 'complete' | 'selective';
  categories: Category[];
  instruction: string;
  sourceLength: number;
  chunks: SourceChunk[];
  completedChunkIds: Set<string>;
  failedChunksCount: number;
  callsUsed: number;
}) {
  const effectiveScope = params.analysisConfiguration?.scope ?? params.scope;
  return {
    complete: params.analysisComplete,
    scope: effectiveScope,
    categories: effectiveScope === 'complete' ? ALL_IMPORT_CATEGORIES : (params.analysisConfiguration?.categories ?? params.categories),
    instruction: params.analysisConfiguration?.instruction ?? params.instruction.trim(),
    totalCharacters: params.sourceLength,
    processedSpans: calculateProcessedCoverage(params.chunks.filter((chunk) => params.completedChunkIds.has(chunk.id))),
    failedSegments: params.failedChunksCount,
    calls: params.callsUsed,
  };
}

function restoreCheckpointSegments(restored: ImportCheckpoint, sourceText: string, sourceId: string) {
  const restoredChunks = restored.segments.map(segment => ({
    id: segment.id, index: segment.index, start: segment.start, end: segment.end,
    text: sourceText.slice(segment.start, segment.end),
  }));
  const completeSegments = restored.segments.filter(segment => segment.status === 'complete' && segment.result);
  return {
    restoredChunks,
    results: completeSegments.map(segment => rebindExtractionSource(segment.result!, sourceId)),
    completedIds: new Set(completeSegments.map(segment => segment.id)),
    failedChunks: restored.segments.filter(segment => segment.status === 'failed').map(segment => restoredChunks[segment.index]).filter(Boolean),
    rejectedCount: completeSegments.reduce((sum, segment) => sum + (segment.result?.rejectedEvidenceCount ?? 0), 0),
  };
}

function filterMatchingCheckpoints(checkpoints: ImportCheckpoint[], parsed: ParsedNarrativeSource): ImportCheckpoint[] {
  return checkpoints.filter(item =>
    item.source.digest === parsed.digest &&
    item.source.filename === parsed.filename &&
    item.source.mediaType === parsed.mediaType &&
    item.source.byteLength === parsed.byteLength,
  );
}

export default function ImportWorkflow({
  existingProjects = [],
  activeProjectId,
  aiConfigured = true,
  onCreateProject,
  onAppendToExistingProject,
  onCancelImport,
}: Props) {
  const [pastedText, setPastedText] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [source, setSource] = useState<ParsedNarrativeSource | null>(null);
  const [sourceId, setSourceId] = useState('');
  const [sourceError, setSourceError] = useState('');
  const [retainOriginal, setRetainOriginal] = useState(true);
  const [confirmExtractedOnly, setConfirmExtractedOnly] = useState(false);
  const [strategy, setStrategy] = useState<'faithful' | 'enhance'>('faithful');
  const [scope, setScope] = useState<'complete' | 'selective'>('complete');
  const [categories, setCategories] = useState<Category[]>(ALL_IMPORT_CATEGORIES);
  const [analysisConfiguration, setAnalysisConfiguration] = useState<AnalysisConfiguration | null>(null);
  const [sourceOnlyMode, setSourceOnlyMode] = useState(false);
  const [instruction, setInstruction] = useState('');
  const [chunks, setChunks] = useState<SourceChunk[]>([]);
  const [segmentationComplete, setSegmentationComplete] = useState(false);
  const [results, setResults] = useState<VerifiedExtraction[]>([]);
  const [completedChunkIds, setCompletedChunkIds] = useState<Set<string>>(new Set());
  const [failedChunks, setFailedChunks] = useState<SourceChunk[]>([]);
  const [rejectedEvidenceCount, setRejectedEvidenceCount] = useState(0);
  const [cancelled, setCancelled] = useState(false);
  const [callsUsed, setCallsUsed] = useState(0);
  const [busy, setBusy] = useState(false);
  const [requestError, setRequestError] = useState('');
  const [acceptedIds, setAcceptedIds] = useState<Set<string>>(new Set());
  const [rejectedIds, setRejectedIds] = useState<Set<string>>(new Set());
  const [projectName, setProjectName] = useState('');
  const [createError, setCreateError] = useState('');
  const [creating, setCreating] = useState(false);
  const [allowIncomplete, setAllowIncomplete] = useState(false);
  const [providerPlanContext, setProviderPlanContext] = useState<ImportProviderPlanContext | null>(null);
  const [checkpointCandidates, setCheckpointCandidates] = useState<ImportCheckpoint[]>([]);
  const [checkpointMessage, setCheckpointMessage] = useState('');
  const [checkpointRestored, setCheckpointRestored] = useState(false);
  const [activeCheckpointId, setActiveCheckpointId] = useState<string | null>(null);

  const [destination, setDestination] = useState<'new' | 'append'>('new');
  const [targetProjectId, setTargetProjectId] = useState<string>(activeProjectId ?? existingProjects[0]?.id ?? '');
  const [reviewedTarget, setReviewedTarget] = useState<AppendTargetBase | null>(null);
  const [insertPositionKey, setInsertPositionKey] = useState<string>('end');
  const [identityDecisions, setIdentityDecisions] = useState<Record<string, CrossProjectIdentityDecision>>({});
  const [allowDuplicateSource, setAllowDuplicateSource] = useState(false);

  const [enhanceGoals, setEnhanceGoals] = useState('');
  const [stage2State, setStage2State] = useState<Stage2EnhancementState>({
    busy: false, error: '', batch: null, proposals: [], acceptedIds: new Set<string>(),
  });
  const stage2ControllerRef = useRef<Stage2EnhancementController | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const epochRef = useRef(0);
  const sourceReadEpochRef = useRef(0);
  const sourceReadAbortRef = useRef<AbortController | null>(null);
  const inProgressRef = useRef(false);
  const creatingRef = useRef(false);
  const providerSnapshotRef = useRef<string | null>(null);
  const checkpointRef = useRef<ImportCheckpoint | null>(null);
  const checkpointOwnerIdRef = useRef(crypto.randomUUID());

  useEffect(() => {
    const stage2Controller = createStage2EnhancementController(setStage2State);
    stage2ControllerRef.current = stage2Controller;
    return () => {
      sourceReadEpochRef.current += 1;
      sourceReadAbortRef.current?.abort();
      sourceReadAbortRef.current = null;
      epochRef.current += 1;
      abortRef.current?.abort();
      stage2Controller.dispose();
      stage2ControllerRef.current = null;
    };
  }, []);

  useEffect(() => {
    let current = true;
    let activeAbort: AbortController | null = null;
    const refreshPlanContext = async () => {
      activeAbort?.abort();
      const controller = new AbortController();
      activeAbort = controller;
      try {
        const nextContext = await fetchImportProviderPlanContext(controller.signal);
        if (current && !controller.signal.aborted) setProviderPlanContext(nextContext);
      } catch {
        if (current && !controller.signal.aborted) setProviderPlanContext(null);
      }
    };
    void refreshPlanContext();
    const onStorage = (event: StorageEvent) => {
      if (event.key === PROVIDER_PREFERENCES_STORAGE_KEY || event.key === null) void refreshPlanContext();
    };
    window.addEventListener('storage', onStorage);
    return () => {
      current = false;
      activeAbort?.abort();
      window.removeEventListener('storage', onStorage);
    };
  }, []);

  const parsedHasFileRetentionGap = Boolean(file && source?.retention === 'extracted-only');
  const extraction = useMemo(() => (results.length ? deduplicateChunkProposals(results) : emptyExtraction()), [results]);
  const unclassifiedFindings = extraction.findings.filter((finding) => finding.category === 'other');
  const identityMatches = useMemo(() => findPossibleIdentityMatches(extraction.entities), [extraction.entities]);
  const explicitProposalIds = useMemo(() => getExplicitProposalIds(extraction), [extraction]);
  const analysisComplete = Boolean(
    source && segmentationComplete && failedChunks.length === 0 && completedChunkIds.size === chunks.length && chunks.length > 0 && !busy,
  );
  const hasIncompleteCoverage = Boolean(source && (!segmentationComplete || failedChunks.length > 0 || completedChunkIds.size !== chunks.length));
  const initialAnalysisPlan = useMemo(
    () => buildInitialAnalysisPlan(source, busy, callsUsed, providerPlanContext),
    [source, busy, callsUsed, providerPlanContext],
  );
  const canAnalyze = canStartImportAnalysis({
    aiConfigured,
    source,
    busy,
    sourceError,
    providerPlanContext,
    parsedHasFileRetentionGap,
    confirmExtractedOnly,
    scope,
    categories,
  });

  const targetProject = useMemo(
    () => existingProjects.find((p) => p.id === targetProjectId) ?? null,
    [existingProjects, targetProjectId],
  );
  const targetSections = useMemo(() => (targetProject ? manuscriptSections(targetProject) : []), [targetProject]);
  const appendTargetChanged = Boolean(targetProject && reviewedTarget && !matchesAppendTarget(targetProject, reviewedTarget));

  const reviewAppendTarget = (project: CreativeProject) => {
    setTargetProjectId(project.id);
    setReviewedTarget(appendTargetBase(project));
    setInsertPositionKey('end');
    setIdentityDecisions({});
    setAllowDuplicateSource(false);
    setCreateError('');
  };

  const previewAssembledCandidate = useMemo(() => {
    if (!source || (results.length === 0 && !sourceOnlyMode)) return null;
    try {
      const safeName = projectName.trim() || 'Imported narrative';
      if (sourceOnlyMode) return buildSourceOnlyImportedProject(source, sourceId, safeName);
      return assembleImportedProject(source, extraction, identityMatches, {
        sourceId,
        acceptedIds,
        rejectedIds,
        projectName: safeName,
        coverage: buildImportCoverageMetadata({
          analysisComplete,
          analysisConfiguration,
          scope,
          categories,
          instruction,
          sourceLength: source.text.length,
          chunks,
          completedChunkIds,
          failedChunksCount: failedChunks.length,
          callsUsed,
        }),
      });
    } catch {
      return null;
    }
  }, [source, sourceOnlyMode, results.length, chunks, completedChunkIds, extraction, identityMatches, sourceId, acceptedIds, rejectedIds, projectName, analysisComplete, analysisConfiguration, scope, categories, instruction, failedChunks.length, callsUsed]);

  const crossProjectMatches = useMemo(() => {
    if (destination !== 'append' || !targetProject || !previewAssembledCandidate) return [];
    return findCrossProjectIdentityMatches(targetProject, previewAssembledCandidate);
  }, [destination, targetProject, previewAssembledCandidate]);

  const isDuplicateSource = useMemo(() => {
    if (destination !== 'append' || !targetProject || !previewAssembledCandidate) return false;
    return detectDuplicateSourceInProject(targetProject, previewAssembledCandidate);
  }, [destination, targetProject, previewAssembledCandidate]);

  const unresolvedIdentityCount = crossProjectMatches.filter((m) => !identityDecisions[m.incomingEntityId]).length;
  const retentionConfirmed = !parsedHasFileRetentionGap || confirmExtractedOnly;
  const analysisReady = sourceOnlyMode || (results.length > 0 && (analysisComplete || (hasIncompleteCoverage && allowIncomplete)));
  const canCommitBase = Boolean(source && !busy && retentionConfirmed && analysisReady);
  const canCreateNew = canCommitBase && destination === 'new' && Boolean(projectName.trim());
  const appendTargetReady = Boolean(targetProject && reviewedTarget && onAppendToExistingProject && !appendTargetChanged);
  const canApplyAppend = canCommitBase && destination === 'append' && appendTargetReady && unresolvedIdentityCount === 0 && (!isDuplicateSource || allowDuplicateSource);

  const enhanceRequestPreview = useMemo(
    () => buildEnhancePreviewPayload(source, extraction.entities, enhanceGoals),
    [source, extraction.entities, enhanceGoals],
  );

  const enhanceBudget = useMemo(
    () => buildClientBudgetDisclosure('import-enhance', 'Stage 2 Enhancement Proposals', enhanceRequestPreview ?? ''),
    [enhanceRequestPreview],
  );

  const resetAnalysis = (clearSourceIdentity = false) => {
    checkpointRef.current = null;
    setCheckpointRestored(false);
    setActiveCheckpointId(null);
    if (clearSourceIdentity) { setCheckpointCandidates([]); setCheckpointMessage(''); }
    setSourceOnlyMode(false);
    setChunks([]); setSegmentationComplete(false); setResults([]); setCompletedChunkIds(new Set());
    setFailedChunks([]); setRejectedEvidenceCount(0); setCancelled(false); setCallsUsed(0);
    setRequestError(''); setAcceptedIds(new Set()); setRejectedIds(new Set()); setCreateError('');
    setAllowIncomplete(false); setAnalysisConfiguration(null);
    setIdentityDecisions({}); setAllowDuplicateSource(false);
    if (clearSourceIdentity) stage2ControllerRef.current?.setActiveSource(null);
    else stage2ControllerRef.current?.invalidate();
    epochRef.current += 1;
    abortRef.current?.abort();
    abortRef.current = null;
  };

  const previewSource = async () => {
    sourceReadAbortRef.current?.abort();
    const controller = new AbortController();
    const readEpoch = ++sourceReadEpochRef.current;
    sourceReadAbortRef.current = controller;
    setSourceError(''); setRequestError(''); setSource(null); setSourceId(''); resetAnalysis(true); setConfirmExtractedOnly(false);
    try {
      const parsed = file
        ? await parseNarrativeSource(file, file.name, retainOriginal, controller.signal)
        : await parseNarrativeSource(pastedText, 'pasted-narrative.txt', true, controller.signal);
      if (readEpoch !== sourceReadEpochRef.current) return;
      sourceReadAbortRef.current = null;
      const nextSourceId = crypto.randomUUID();
      setSource(parsed);
      setSourceId(nextSourceId);
      const cpResult = await fetchMatchingCheckpointsForSource(parsed);
      if (readEpoch !== sourceReadEpochRef.current) return;
      setCheckpointCandidates(cpResult.candidates);
      if (cpResult.message) setCheckpointMessage(cpResult.message);
      stage2ControllerRef.current?.setActiveSource({ sourceId: nextSourceId, sourceVersion: 'v1', digest: parsed.digest });
      setProjectName(file ? file.name.replace(/\.[^.]+$/, '').slice(0, 100) : 'Imported narrative');
    } catch (error) {
      if (readEpoch !== sourceReadEpochRef.current) return;
      sourceReadAbortRef.current = null;
      if (error instanceof Error && error.name === 'AbortError') return;
      setSourceError(error instanceof Error ? error.message : 'The source could not be previewed.');
    } finally {
      if (sourceReadAbortRef.current === controller) sourceReadAbortRef.current = null;
    }
  };

  const readFile = (next: File | null) => {
    sourceReadEpochRef.current += 1;
    sourceReadAbortRef.current?.abort();
    sourceReadAbortRef.current = null;
    abortRef.current?.abort();
    setFile(next); setSource(null); setSourceId(''); setSourceError(''); setPastedText('');
    resetAnalysis(true);
  };

  const restoreSavedCheckpoint = async (checkpoint: ImportCheckpoint) => {
    if (!source || !providerPlanContext) {
      setCheckpointMessage('Refresh the provider status and preview the source before restoring this checkpoint.');
      return;
    }
    const restoreReadEpoch = sourceReadEpochRef.current;
    const restoreRunEpoch = epochRef.current;
    const isStaleRestore = () => restoreReadEpoch !== sourceReadEpochRef.current || restoreRunEpoch !== epochRef.current;
    const runConfiguration: AnalysisConfiguration = { scope, categories: [...categories], instruction: instruction.trim() };
    try {
      const verified = await verifyAndReloadCheckpoint({
        checkpoint, source, configuration: runConfiguration, providerPlanContext, isStale: isStaleRestore,
      });
      if (!verified.ok) {
        if (!verified.stale) setCheckpointMessage(verified.message);
        return;
      }
      if (isStaleRestore()) return;
      const restored = verified.value;
      const mapped = restoreCheckpointSegments(restored, source.text, sourceId);
      checkpointRef.current = restored;
      setCheckpointRestored(true);
      setActiveCheckpointId(restored.id);
      setChunks(mapped.restoredChunks);
      setSegmentationComplete(restored.plan.complete);
      setResults(mapped.results);
      setCompletedChunkIds(mapped.completedIds);
      setFailedChunks(mapped.failedChunks);
      setCallsUsed(restored.budget.callsUsed);
      setRejectedEvidenceCount(mapped.rejectedCount);
      setAnalysisConfiguration(runConfiguration);
      setCheckpointMessage('Checkpoint restored. Completed segments were reused; analysis continues only after you choose Analyze source.');
    } catch (error) {
      if (!isStaleRestore()) {
        setCheckpointMessage(`The checkpoint could not be safely restored: ${error instanceof Error ? error.message : 'Local checkpoint access failed.'}`);
      }
    }
  };

  const handleDeleteCheckpoint = async (checkpointId: string) => {
    const deleteReadEpoch = sourceReadEpochRef.current;
    try {
      const result = await deleteImportCheckpoint(resolveIdbSafely(), checkpointId);
      if (deleteReadEpoch !== sourceReadEpochRef.current) return;
      if (result.ok) {
        setCheckpointCandidates(current => current.filter(item => item.id !== checkpointId));
        setCheckpointMessage('Local checkpoint deleted. Deleting it does not refund provider usage; an uncertain request may already have consumed resources.');
      } else {
        setCheckpointMessage(`Checkpoint could not be deleted: ${result.error}`);
      }
    } catch (error) {
      if (deleteReadEpoch !== sourceReadEpochRef.current) return;
      setCheckpointMessage(`Checkpoint could not be deleted: ${error instanceof Error ? error.message : 'IndexedDB access failed.'}`);
    }
  };

  const startAnalysis = async (retry = false) => {
    if (!source || inProgressRef.current) return;
    inProgressRef.current = true;
    const runEpoch = epochRef.current;
    if (!retry) providerSnapshotRef.current = readCurrentProviderPreferencesRaw();
    const controller = new AbortController();
    abortRef.current = controller;
    const configuration: AnalysisConfiguration = retry && analysisConfiguration
      ? analysisConfiguration
      : { scope, categories: [...categories], instruction: instruction.trim() };

    await runImportAnalysisSession({
      source,
      sourceId,
      providerPlanContext,
      configuration,
      hasExistingConfiguration: Boolean(analysisConfiguration),
      retry,
      callsUsed,
      failedChunks,
      rejectedEvidenceCount,
      initialCheckpoint: checkpointRef.current,
      initialProviderSnapshotRaw: providerSnapshotRef.current,
      ownerId: checkpointOwnerIdRef.current,
      controller,
      isStaleEpoch: () => runEpoch !== epochRef.current,
      deps: {
        getIdbFactory: resolveIdbSafely,
        extractChunk: extractNarrativeChunk,
        isAbortError,
        readProviderSnapshotRaw: readCurrentProviderPreferencesRaw,
      },
      callbacks: {
        setBusy,
        setCancelled,
        setRequestError,
        setSourceOnlyMode,
        setAnalysisConfiguration,
        setActiveCheckpointId,
        setChunks,
        setSegmentationComplete,
        setResults,
        setCompletedChunkIds,
        setFailedChunks,
        setRejectedEvidenceCount,
        setCallsUsed,
        onCheckpointUpdated: (cp) => { checkpointRef.current = cp; },
        onCompleteSession: () => {
          inProgressRef.current = false;
          if (abortRef.current === controller) abortRef.current = null;
        },
      },
    });
  };

  const runStage2Enhancements = async () => {
    const controller = stage2ControllerRef.current;
    if (!enhanceRequestPreview || !source || !sourceId) return;
    if (!controller || stage2State.busy) return;
    await controller.run({
      request: enhanceRequestPreview,
      aiConfigured,
      identity: { sourceId, sourceVersion: 'v1', digest: source.digest },
      transport: requestImportEnhancements,
    });
  };

  const cancelAnalysis = () => {
    abortRef.current?.abort();
    stage2ControllerRef.current?.invalidate();
    setCancelled(true);
  };

  const toggleAccepted = (id: string, checked: boolean) => {
    setAcceptedIds((previous) => { const next = new Set(previous); if (checked) next.add(id); else next.delete(id); return next; });
    setRejectedIds((previous) => { const next = new Set(previous); next.delete(id); return next; });
  };

  const toggleRejected = (id: string, checked: boolean) => {
    setRejectedIds((previous) => { const next = new Set(previous); if (checked) next.add(id); else next.delete(id); return next; });
    setAcceptedIds((previous) => { const next = new Set(previous); next.delete(id); return next; });
  };

  const buildFinalImportedProject = (): CreativeProject => {
    if (!source) throw new Error('Source is missing.');
    if (sourceOnlyMode) return buildSourceOnlyImportedProject(source, sourceId, projectName.trim() || 'Imported narrative');
    const assembled = assembleImportedProject(source, extraction, identityMatches, {
      sourceId,
      acceptedIds,
      rejectedIds,
      projectName: projectName.trim() || 'Imported narrative',
      coverage: buildImportCoverageMetadata({
        analysisComplete,
        analysisConfiguration,
        scope,
        categories,
        instruction,
        sourceLength: source.text.length,
        chunks,
        completedChunkIds,
        failedChunksCount: failedChunks.length,
        callsUsed,
      }),
    });
    const selectedEnhancements = stage2ControllerRef.current?.getValidatedAcceptedProposals({
      sourceId, sourceVersion: 'v1', digest: source.digest,
    }) ?? [];
    return attachAcceptedStage2Opportunities(assembled, selectedEnhancements, sourceId);
  };

  const commitImport = async () => {
    const canSubmit = destination === 'append' ? canApplyAppend : canCreateNew;
    if (!source || creatingRef.current || !canSubmit) return;
    creatingRef.current = true;
    setCreating(true);
    setCreateError('');
    try {
      const assembled = buildFinalImportedProject();
      const canAppend = destination === 'append' && reviewedTarget && onAppendToExistingProject;
      if (canAppend && reviewedTarget && onAppendToExistingProject) {
        await onAppendToExistingProject({
          reviewedTarget,
          incomingProject: assembled,
          insertPosition: resolveInsertPosition(insertPositionKey),
          identityDecisions,
          allowDuplicateSource,
        });
      } else {
        await onCreateProject(assembled);
      }
    } catch (error) {
      setCreateError(error instanceof Error ? error.message : 'The imported story could not be saved. Your review remains open.');
    } finally {
      creatingRef.current = false;
      setCreating(false);
    }
  };

  const progress = `${completedChunkIds.size} / ${chunks.length} segments analyzed`;
  const steps = buildWorkflowSteps({
    source,
    chunksLength: chunks.length,
    sourceOnlyMode,
    resultsLength: results.length,
    decisionCount: acceptedIds.size + rejectedIds.size,
  });

  return (
    <main className="min-h-0 flex-1 overflow-auto bg-[#fbfaf7] p-4 text-[#25262a] dark:bg-gray-950 dark:text-gray-100 sm:p-6 lg:p-8">
      <div className="mx-auto max-w-6xl space-y-6">
        <header className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="font-serif text-3xl font-semibold">Import story</h1>
            <p className="mt-1 max-w-2xl text-sm text-gray-600 dark:text-gray-300">
              Inspect the source first. Analysis is optional, and nothing enters a project until you review candidates and commit.
            </p>
          </div>
          <button
            type="button"
            className={workspaceButton}
            disabled={creating}
            onClick={() => {
              sourceReadEpochRef.current += 1;
              sourceReadAbortRef.current?.abort();
              sourceReadAbortRef.current = null;
              epochRef.current += 1;
              abortRef.current?.abort();
              stage2ControllerRef.current?.invalidate();
              onCancelImport();
            }}
          >
            Exit import
          </button>
        </header>

        <nav aria-label="Import steps" className="overflow-x-auto">
          <ol className="flex min-w-max items-center gap-2 text-xs sm:text-sm">
            {steps.map((step, index) => (
              <li key={step.label} className="flex items-center gap-2">
                <span aria-current={step.current ? 'step' : undefined} className={`whitespace-nowrap rounded-full px-3 py-2 font-medium ${step.current ? 'bg-[#62445e] text-white' : step.complete ? 'bg-[#e9dfe8] text-[#62445e] dark:bg-purple-950 dark:text-purple-200' : 'bg-white text-gray-600 dark:bg-gray-900 dark:text-gray-400'}`}>
                  <span className="mr-1.5 tabular-nums">{index + 1}</span>{step.label}
                </span>
                {index < 4 && <span aria-hidden="true" className="text-gray-400">›</span>}
              </li>
            ))}
          </ol>
        </nav>

        <SourcePreviewSection
          file={file}
          pastedText={pastedText}
          retainOriginal={retainOriginal}
          confirmExtractedOnly={confirmExtractedOnly}
          busy={busy}
          source={source}
          sourceError={sourceError}
          parsedHasFileRetentionGap={parsedHasFileRetentionGap}
          onFileChange={readFile}
          onPastedTextChange={(nextText) => {
            sourceReadEpochRef.current += 1;
            sourceReadAbortRef.current?.abort();
            sourceReadAbortRef.current = null;
            setPastedText(nextText);
            if (file) setFile(null);
            setSource(null);
            setSourceId('');
            resetAnalysis(true);
          }}
          onRetainOriginalChange={(checked) => {
            sourceReadEpochRef.current += 1;
            sourceReadAbortRef.current?.abort();
            sourceReadAbortRef.current = null;
            setRetainOriginal(checked);
            setSource(null);
            setSourceId('');
            resetAnalysis(true);
          }}
          onConfirmExtractedOnlyChange={setConfirmExtractedOnly}
          onInspectSource={() => void previewSource()}
        />

        {source && (
          <AnalysisConfigSection
            source={source}
            strategy={strategy}
            scope={scope}
            categories={categories}
            instruction={instruction}
            checkpointMessage={checkpointMessage}
            checkpointCandidates={checkpointCandidates}
            activeCheckpointId={activeCheckpointId}
            initialAnalysisPlan={initialAnalysisPlan}
            providerPlanContext={providerPlanContext}
            busy={busy}
            creating={creating}
            parsedHasFileRetentionGap={parsedHasFileRetentionGap}
            confirmExtractedOnly={confirmExtractedOnly}
            canAnalyze={canAnalyze}
            callsUsed={callsUsed}
            checkpointRestored={checkpointRestored}
            failedChunks={failedChunks}
            aiConfigured={aiConfigured}
            progress={progress}
            cancelled={cancelled}
            requestError={requestError}
            hasIncompleteCoverage={hasIncompleteCoverage}
            chunksLength={chunks.length}
            allowIncomplete={allowIncomplete}
            onSetStrategy={setStrategy}
            onSetScope={(nextScope) => { resetAnalysis(); setScope(nextScope); }}
            onToggleCategory={(id, checked) => {
              resetAnalysis();
              setCategories((previous) => (checked ? [...new Set([...previous, id])] : previous.filter((item) => item !== id)));
            }}
            onChangeInstruction={(nextInstruction) => { resetAnalysis(); setInstruction(nextInstruction); }}
            onRestoreCheckpoint={(cp) => void restoreSavedCheckpoint(cp)}
            onDeleteCheckpoint={(id) => void handleDeleteCheckpoint(id)}
            onChooseSourceOnly={() => { resetAnalysis(); setSourceOnlyMode(true); }}
            onStartAnalysis={(retry) => void startAnalysis(retry)}
            onCancelAnalysis={cancelAnalysis}
            onSetAllowIncomplete={setAllowIncomplete}
          />
        )}

        {(results.length > 0 || sourceOnlyMode) && (
          <CandidateReviewSection
            sourceOnlyMode={sourceOnlyMode}
            analysisComplete={analysisComplete}
            progress={progress}
            rejectedEvidenceCount={rejectedEvidenceCount}
            extraction={extraction}
            explicitProposalIds={explicitProposalIds}
            unclassifiedFindingsCount={unclassifiedFindings.length}
            scope={scope}
            identityMatches={identityMatches}
            acceptedIds={acceptedIds}
            rejectedIds={rejectedIds}
            creating={creating}
            createError={createError}
            strategy={strategy}
            enhanceGoals={enhanceGoals}
            enhanceBudget={enhanceBudget}
            enhanceBusy={stage2State.busy}
            enhanceError={stage2State.error}
            enhancements={stage2State.proposals}
            acceptedEnhancementIds={stage2State.acceptedIds}
            aiConfigured={aiConfigured}
            destination={destination}
            existingProjects={existingProjects}
            targetProject={targetProject}
            targetSections={targetSections}
            insertPositionKey={insertPositionKey}
            appendTargetChanged={appendTargetChanged}
            isDuplicateSource={isDuplicateSource}
            allowDuplicateSource={allowDuplicateSource}
            crossProjectMatches={crossProjectMatches}
            identityDecisions={identityDecisions}
            projectName={projectName}
            canAppendFeature={Boolean(onAppendToExistingProject)}
            canCreateNew={canCreateNew}
            canApplyAppend={canApplyAppend}
            onAcceptAllExplicit={() => {
              setAcceptedIds((previous) => new Set([...previous, ...explicitProposalIds]));
              setRejectedIds((previous) => new Set([...previous].filter((id) => !explicitProposalIds.includes(id))));
            }}
            onToggleAccepted={toggleAccepted}
            onToggleRejected={toggleRejected}
            onEnhanceGoalsChange={setEnhanceGoals}
            onRunStage2Enhancements={() => void runStage2Enhancements()}
            onToggleEnhancementAccepted={(id, checked) => stage2ControllerRef.current?.toggleAccepted(id, checked)}
            onDestinationChange={setDestination}
            onProjectNameChange={setProjectName}
            onSelectAppendTarget={reviewAppendTarget}
            onInsertPositionChange={setInsertPositionKey}
            onAllowDuplicateSourceChange={setAllowDuplicateSource}
            onIdentityDecisionChange={(entityId, decision) => setIdentityDecisions((prev) => ({ ...prev, [entityId]: decision }))}
            onCommitImport={() => void commitImport()}
          />
        )}
      </div>
    </main>
  );
}

interface AnalysisConfigSectionProps {
  source: ParsedNarrativeSource;
  strategy: 'faithful' | 'enhance';
  scope: 'complete' | 'selective';
  categories: Category[];
  instruction: string;
  checkpointMessage: string;
  checkpointCandidates: ImportCheckpoint[];
  activeCheckpointId: string | null;
  initialAnalysisPlan: ReturnType<typeof planAdaptiveNarrativeSourceAnalysis> | null;
  providerPlanContext: ImportProviderPlanContext | null;
  busy: boolean;
  creating: boolean;
  parsedHasFileRetentionGap: boolean;
  confirmExtractedOnly: boolean;
  canAnalyze: boolean;
  callsUsed: number;
  checkpointRestored: boolean;
  failedChunks: SourceChunk[];
  aiConfigured: boolean;
  progress: string;
  cancelled: boolean;
  requestError: string;
  hasIncompleteCoverage: boolean;
  chunksLength: number;
  allowIncomplete: boolean;
  onSetStrategy: (strategy: 'faithful' | 'enhance') => void;
  onSetScope: (scope: 'complete' | 'selective') => void;
  onToggleCategory: (id: Category, checked: boolean) => void;
  onChangeInstruction: (instruction: string) => void;
  onRestoreCheckpoint: (checkpoint: ImportCheckpoint) => void;
  onDeleteCheckpoint: (checkpointId: string) => void;
  onChooseSourceOnly: () => void;
  onStartAnalysis: (retry: boolean) => void;
  onCancelAnalysis: () => void;
  onSetAllowIncomplete: (checked: boolean) => void;
}

function StrategyFieldset({ strategy, onSetStrategy }: { strategy: 'faithful' | 'enhance'; onSetStrategy: (s: 'faithful' | 'enhance') => void }) {
  return (
    <fieldset className="space-y-2 rounded-lg bg-[#fbfaf7] p-4 dark:bg-gray-950">
      <legend className="font-semibold">Import approach</legend>
      <label className="flex gap-2">
        <input type="radio" name="import-strategy" checked={strategy === 'faithful'} onChange={() => onSetStrategy('faithful')} />
        <span><strong>Faithful reconstruction</strong> <span className="text-gray-600 dark:text-gray-400">(default)</span><span className="mt-1 block text-xs text-gray-600 dark:text-gray-400">Keeps source text and extracted facts distinct; it does not rewrite the manuscript.</span></span>
      </label>
      <label className="flex gap-2">
        <input type="radio" name="import-strategy" checked={strategy === 'enhance'} onChange={() => onSetStrategy('enhance')} />
        <span><strong>Faithful import with optional enhancements</strong><span className="mt-1 block text-xs text-gray-600 dark:text-gray-400">Enhancement suggestions are separate proposals for review after extraction.</span></span>
      </label>
      {strategy === 'enhance' && (
        <p className="text-xs text-[#62445e] dark:text-purple-200">
          Stage 1 always performs strict faithful extraction first. After Stage 1 completes, you can explicitly run Stage 2 to generate separate, labeled enhancement and correction proposals without modifying the immutable original source.
        </p>
      )}
    </fieldset>
  );
}

function ScopeFieldset({
  scope, categories, onSetScope, onToggleCategory,
}: {
  scope: 'complete' | 'selective';
  categories: Category[];
  onSetScope: (s: 'complete' | 'selective') => void;
  onToggleCategory: (id: Category, checked: boolean) => void;
}) {
  return (
    <fieldset className="space-y-2">
      <legend className="text-sm font-medium">Extraction scope</legend>
      <label className="flex gap-2"><input type="radio" name="import-scope" checked={scope === 'complete'} onChange={() => onSetScope('complete')} />Complete extraction</label>
      <label className="flex gap-2"><input type="radio" name="import-scope" checked={scope === 'selective'} onChange={() => onSetScope('selective')} />Selective extraction</label>
      {scope === 'selective' && (
        <div className="grid gap-2 sm:grid-cols-2">
          {IMPORT_CATEGORY_OPTIONS.map(([id, label]) => (
            <label key={id} className="flex gap-2">
              <input type="checkbox" checked={categories.includes(id)} onChange={(event) => onToggleCategory(id, event.target.checked)} />
              {label}
            </label>
          ))}
        </div>
      )}
    </fieldset>
  );
}

function SavedCheckpointsPanel({
  candidates, busy, hasProviderPlan, activeCheckpointId, onRestore, onDelete,
}: {
  candidates: ImportCheckpoint[];
  busy: boolean;
  hasProviderPlan: boolean;
  activeCheckpointId: string | null;
  onRestore: (cp: ImportCheckpoint) => void;
  onDelete: (id: string) => void;
}) {
  if (candidates.length === 0) return null;
  return (
    <section className="space-y-2 rounded border border-gray-200 p-3 text-sm dark:border-gray-700" aria-label="Saved analysis checkpoints">
      <h3 className="font-medium">Saved analysis checkpoints</h3>
      <p>These checkpoints contain verified proposals and source references, not manuscript text or credentials. Restoring never starts provider requests.</p>
      {candidates.map(checkpoint => (
        <div key={checkpoint.id} className="flex flex-wrap items-center gap-2">
          <span>{checkpoint.plan.scope} · {checkpoint.segments.filter(segment => segment.status === 'complete').length}/{checkpoint.segments.length} segments · {checkpoint.budget.callsUsed}/{checkpoint.budget.maxCalls} attempts used</span>
          <button type="button" className={workspaceButton} disabled={busy || !hasProviderPlan} onClick={() => onRestore(checkpoint)}>Restore checkpoint</button>
          <button type="button" className={workspaceButton} disabled={busy || activeCheckpointId === checkpoint.id} onClick={() => onDelete(checkpoint.id)}>Delete checkpoint</button>
        </div>
      ))}
    </section>
  );
}

function formatProviderPlanSummary(ctx: ImportProviderPlanContext | null): string {
  if (!ctx) return 'Adaptive plan for narrative import · provider status unavailable · provider default · reasoning Default.';
  const modelText = ctx.modelId ? ctx.modelId : 'provider default';
  return `Adaptive plan for narrative import · ${ctx.connectionId} · ${modelText} · reasoning ${ctx.reasoningLevel}.`;
}

function AnalysisPlanBanner({
  plan, sourceLength, providerPlanContext,
}: {
  plan: ReturnType<typeof planAdaptiveNarrativeSourceAnalysis> | null;
  sourceLength: number;
  providerPlanContext: ImportProviderPlanContext | null;
}) {
  if (!plan) return null;
  const blockedChatGpt = providerPlanContext?.connectionId === 'chatgpt-plan';
  return (
    <div className="space-y-1 rounded border border-gray-200 p-3 text-sm dark:border-gray-700" aria-label="Local analysis plan">
      <p className="font-medium">Automatic analysis plan</p>
      <p>{plan.chunks.length} suggested source segment(s) · {plan.scheduledRequests} scheduled request(s) covering {sourceLength - plan.unplannedChars} character units in this pass, within the {MAX_EXTRACTION_CALLS}-call total ceiling.</p>
      <p>{formatProviderPlanSummary(providerPlanContext)}</p>
      {blockedChatGpt && <p role="status" className="text-amber-800 dark:text-amber-200">ChatGPT narrative import remains blocked. The approved ChatGPT SRB pilot is mock-only for the separate story operation; no import inference or billing fallback is available.</p>}
      {providerPlanContext === null && <p role="status" className="text-amber-800 dark:text-amber-200">Provider selection could not be verified. Refresh provider status before starting analysis.</p>}
      <p>Adaptive local estimate: up to {plan.limits.payloadTokenBudget.toLocaleString()} source tokens per segment, with {plan.limits.envelopeReserveTokens.toLocaleString()} reserved for instructions and schema. A supported model context limit is used when the account catalog provides one; otherwise the conservative narrative-import limit applies. The server remains authoritative and blocks transports that cannot meet operation preflight.</p>
      {!plan.completeWithinCallBudget && <p className="text-amber-800 dark:text-amber-200">The current limits permit only partial source coverage: {plan.unplannedChars.toLocaleString()} source character units remain outside the scheduled segments. The original manuscript is preserved.</p>}
      <p className="text-xs text-gray-600 dark:text-gray-300">The plan is pinned to this source digest, narrative-import task, current provider preference snapshot, and the displayed policy limits when analysis starts. A provider change stops remaining segments. Estimates do not guarantee quota, cost, or semantic completeness.</p>
    </div>
  );
}

function AnalysisActionRow({
  sourceOnlyBlocked, analyzeBlocked, checkpointRestored, busy, failedCount,
  onChooseSourceOnly, onStartAnalysis, onCancelAnalysis,
}: {
  sourceOnlyBlocked: boolean;
  analyzeBlocked: boolean;
  checkpointRestored: boolean;
  busy: boolean;
  failedCount: number;
  onChooseSourceOnly: () => void;
  onStartAnalysis: (retry: boolean) => void;
  onCancelAnalysis: () => void;
}) {
  return (
    <div className="flex flex-wrap gap-2">
      <button type="button" className={workspaceButton} disabled={sourceOnlyBlocked} onClick={onChooseSourceOnly}>Continue with source only</button>
      <button type="button" className={workspaceButton} disabled={analyzeBlocked} onClick={() => onStartAnalysis(false)}>{checkpointRestored ? 'Continue analysis' : 'Analyze source'}</button>
      {busy && <button type="button" className={workspaceButton} onClick={onCancelAnalysis}>Cancel analysis</button>}
      {failedCount > 0 && !busy && <button type="button" className={workspaceButton} disabled={analyzeBlocked} onClick={() => onStartAnalysis(true)}>Retry failed segments ({failedCount})</button>}
    </div>
  );
}

function AnalysisStatusNotices({
  aiConfigured, busy, progress, callsUsed, cancelled, requestError,
  showIncompletePrompt, allowIncomplete, onSetAllowIncomplete,
}: {
  aiConfigured: boolean;
  busy: boolean;
  progress: string;
  callsUsed: number;
  cancelled: boolean;
  requestError: string;
  showIncompletePrompt: boolean;
  allowIncomplete: boolean;
  onSetAllowIncomplete: (checked: boolean) => void;
}) {
  return (
    <>
      {!aiConfigured && <p role="status">Analysis is unavailable because the server Gemini API key is not configured. Local source preview remains available.</p>}
      {busy && <p role="status" aria-live="polite">{progress} · {callsUsed}/{MAX_EXTRACTION_CALLS} requests used</p>}
      {cancelled && <p className="text-sm">Analysis was cancelled. Completed segment results remain available for review.</p>}
      {requestError && <p role="alert" className="text-sm text-red-700 dark:text-red-300">{requestError}</p>}
      {showIncompletePrompt && (
        <div className="space-y-2 rounded bg-amber-50 p-3 dark:bg-amber-950">
          <p>Coverage is incomplete: {progress}. Unprocessed source remains visible in the original. Saving stays disabled unless you explicitly approve an incomplete import.</p>
          <label className="flex gap-2"><input type="checkbox" checked={allowIncomplete} onChange={(event) => onSetAllowIncomplete(event.target.checked)} />Approve an explicitly incomplete import with unprocessed coverage recorded</label>
        </div>
      )}
    </>
  );
}

function AnalysisConfigSection(props: AnalysisConfigSectionProps) {
  const {
    source, strategy, scope, categories, instruction, checkpointMessage, checkpointCandidates,
    activeCheckpointId, initialAnalysisPlan, providerPlanContext, busy, creating, parsedHasFileRetentionGap,
    confirmExtractedOnly, canAnalyze, callsUsed, checkpointRestored, failedChunks, aiConfigured,
    progress, cancelled, requestError, hasIncompleteCoverage, chunksLength, allowIncomplete,
    onSetStrategy, onSetScope, onToggleCategory, onChangeInstruction, onRestoreCheckpoint,
    onDeleteCheckpoint, onChooseSourceOnly, onStartAnalysis, onCancelAnalysis, onSetAllowIncomplete,
  } = props;
  const sourceOnlyBlocked = busy || creating || (parsedHasFileRetentionGap && !confirmExtractedOnly);
  const analyzeBlocked = !canAnalyze || callsUsed >= MAX_EXTRACTION_CALLS;
  const showIncompletePrompt = hasIncompleteCoverage && !busy && chunksLength > 0;

  return (
    <section className="space-y-4 rounded-xl border border-[#dad8d2] bg-white p-4 dark:border-gray-700 dark:bg-gray-900 sm:p-5" aria-labelledby="import-config-title">
      <h2 id="import-config-title" className="font-display text-xl font-semibold">2. Choose source-only import or optional analysis</h2>
      <p className="text-sm">Source-only import keeps the inspected manuscript and provenance intact without analysis, AI provider calls, or extracted claims. Analysis is optional and adds separately reviewable candidate records.</p>
      <StrategyFieldset strategy={strategy} onSetStrategy={onSetStrategy} />
      <ScopeFieldset scope={scope} categories={categories} onSetScope={onSetScope} onToggleCategory={onToggleCategory} />
      <label className="block text-sm" htmlFor="import-instructions">Optional import-specific guidance (cannot override faithful extraction)</label>
      <textarea id="import-instructions" className="min-h-20 w-full rounded border p-2 dark:bg-gray-950" maxLength={1000} value={instruction} onChange={(event) => onChangeInstruction(event.target.value)} />
      <p className="text-sm">Analysis sends selected source segments through the configured narrative-import AI route. No analysis request is made until Analyze source.</p>
      {checkpointMessage && <p role="status" className="text-sm">{checkpointMessage}</p>}
      <SavedCheckpointsPanel candidates={checkpointCandidates} busy={busy} hasProviderPlan={Boolean(providerPlanContext)} activeCheckpointId={activeCheckpointId} onRestore={onRestoreCheckpoint} onDelete={onDeleteCheckpoint} />
      <AnalysisPlanBanner plan={initialAnalysisPlan} sourceLength={source.text.length} providerPlanContext={providerPlanContext} />
      <AnalysisActionRow
        sourceOnlyBlocked={sourceOnlyBlocked}
        analyzeBlocked={analyzeBlocked}
        checkpointRestored={checkpointRestored}
        busy={busy}
        failedCount={failedChunks.length}
        onChooseSourceOnly={onChooseSourceOnly}
        onStartAnalysis={onStartAnalysis}
        onCancelAnalysis={onCancelAnalysis}
      />
      <AnalysisStatusNotices
        aiConfigured={aiConfigured}
        busy={busy}
        progress={progress}
        callsUsed={callsUsed}
        cancelled={cancelled}
        requestError={requestError}
        showIncompletePrompt={showIncompletePrompt}
        allowIncomplete={allowIncomplete}
        onSetAllowIncomplete={onSetAllowIncomplete}
      />
    </section>
  );
}
