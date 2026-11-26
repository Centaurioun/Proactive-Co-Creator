import { useEffect, useMemo, useRef, useState } from 'react';
import { NarrativeExtractionSchema, type NarrativeExtractionRequest } from '../../shared/importSchemas';
import type { CreativeProject } from '../../shared/types';
import { buildClientBudgetDisclosure } from '../../lib/narrative/aiBudgetClient';
import { assembleImportedProject } from '../../lib/narrative/import/assembleProject';
import {
  appendTargetBase,
  detectDuplicateSourceInProject,
  matchesAppendTarget,
  type AppendTargetBase,
  findCrossProjectIdentityMatches,
  type AppendInsertPosition,
  type CrossProjectIdentityDecision,
} from '../../lib/narrative/import/appendApply';
import { findPossibleIdentityMatches } from '../../lib/narrative/import/identityResolver';
import { deduplicateChunkProposals, verifyExtractionEvidence, type VerifiedExtraction } from '../../lib/narrative/import/proposalValidator';
import { calculateProcessedCoverage, planAdaptiveNarrativeSourceAnalysis, type SourceChunk } from '../../lib/narrative/import/segmentation';
import { countNarrativeWords, MAX_RETAINED_ORIGINAL_BYTES, parseNarrativeSource, type ParsedNarrativeSource } from '../../lib/narrative/import/sourceParser';
import { manuscriptSections } from '../../lib/narrative/manuscriptModel';
import {
  createImportCheckpoint, deleteImportCheckpoint, listImportCheckpoints, matchesImportCheckpointIdentity,
  reserveImportSegmentAttempt, saveImportCheckpoint, updateImportCheckpoint, validateCheckpointEvidence,
  type ImportCheckpoint,
} from '../../lib/narrative/import/analysisCheckpoints';
import {
  attachAcceptedStage2Opportunities,
  createStage2EnhancementController,
  type Stage2EnhancementController,
  type Stage2EnhancementState,
} from '../../lib/narrative/import/stage2Enhancements';
import { extractNarrativeChunk, isAbortError, requestImportEnhancements } from '../../services/apiClient';
import { workspaceButton } from '../manuscript/ManuscriptEditor';

const MAX_EXTRACTION_CALLS = 12;
const PROVIDER_PREFERENCES_KEY = 'pcc.ai.providerPreferences.v1';
type Category = NarrativeExtractionRequest['categories'][number];
interface AnalysisConfiguration {
  scope: 'complete' | 'selective';
  categories: Category[];
  instruction: string;
}
interface ImportProviderPlanContext {
  connectionId: string;
  modelId?: string;
  reasoningLevel: string;
  contextLimitTokens?: number;
  operationEligible: boolean;
  capabilityPolicyVersion?: string;
}
const categoryOptions: Array<[Category, string]> = [
  ['characters', 'Characters and identities'], ['attributes', 'Attributes and aliases'], ['relationships', 'Relationships'],
  ['locations', 'Locations and worldbuilding'], ['objects', 'Objects'], ['events', 'Events and plot'],
  ['story-bible', 'Story Bible'], ['themes-style', 'Themes and style'], ['continuity', 'Ambiguity and possible continuity issues'],
];
const allCategories = categoryOptions.map(([id]) => id);
const emptyExtraction = (): VerifiedExtraction => ({ findings: [], entities: [], relationships: [], ambiguities: [], rejectedEvidenceCount: 0 });

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
  const [categories, setCategories] = useState<Category[]>(allCategories);
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

  // Destination: Create New vs Append to Existing Project (Package H)
  const [destination, setDestination] = useState<'new' | 'append'>('new');
  const [targetProjectId, setTargetProjectId] = useState<string>(activeProjectId ?? existingProjects[0]?.id ?? '');
  const [reviewedTarget, setReviewedTarget] = useState<AppendTargetBase | null>(null);
  const [insertPositionKey, setInsertPositionKey] = useState<string>('end');
  const [identityDecisions, setIdentityDecisions] = useState<Record<string, CrossProjectIdentityDecision>>({});
  const [allowDuplicateSource, setAllowDuplicateSource] = useState(false);

  // Stage 2: Reconstruct & Enhance proposals (Package D + I + R0-A identity guard)
  const [enhanceGoals, setEnhanceGoals] = useState('');
  const [stage2State, setStage2State] = useState<Stage2EnhancementState>({
    busy: false,
    error: '',
    batch: null,
    proposals: [],
    acceptedIds: new Set<string>(),
  });
  const stage2ControllerRef = useRef<Stage2EnhancementController | null>(null);
  const enhanceBusy = stage2State.busy;
  const enhanceError = stage2State.error;
  const enhancements = stage2State.proposals;
  const acceptedEnhancementIds = stage2State.acceptedIds;

  const abortRef = useRef<AbortController | null>(null);
  const epochRef = useRef(0);
  const sourceReadEpochRef = useRef(0);
  const sourceReadAbortRef = useRef<AbortController | null>(null);
  const inProgressRef = useRef(false);
  const creatingRef = useRef(false);
  const providerSnapshotRef = useRef<string | null>(null);
  const checkpointRef = useRef<ImportCheckpoint | null>(null);

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
    const refreshPlanContext = async () => {
      try {
        const response = await fetch('/api/ai/provider-hub/status');
        if (!response.ok) throw new Error('Provider context is unavailable.');
        const status = await response.json() as {
          capabilityPolicyVersion?: string;
          connections?: Array<{ id: string; selectedModelId?: string; models?: Array<{
            id: string; contextLimit?: { state: string; value?: number };
            operationCapabilities?: Record<string, { state?: string; value?: boolean }>;
          }> }>;
        };
        const stored = window.localStorage.getItem(PROVIDER_PREFERENCES_KEY);
        const prefs = stored ? JSON.parse(stored) as {
          defaultConnectionId?: string; defaultTextModelId?: string; defaultReasoningLevel?: string;
          operationOverrides?: Record<string, { connectionId?: string; modelId?: string; reasoningLevel?: string }>;
        } : {};
        const override = prefs.operationOverrides?.['narrative-import'];
        const connectionId = override?.connectionId ?? prefs.defaultConnectionId ?? 'gemini-managed';
        const connection = status.connections?.find(item => item.id === connectionId);
        const modelId = override?.modelId ?? prefs.defaultTextModelId ?? connection?.selectedModelId;
        const model = connection?.models?.find(item => item.id === modelId);
        const operation = model?.operationCapabilities?.['narrative-import'];
        if (current) setProviderPlanContext({
          connectionId,
          modelId,
          reasoningLevel: override?.reasoningLevel ?? prefs.defaultReasoningLevel ?? 'default',
          contextLimitTokens: model?.contextLimit?.state === 'supported' ? model.contextLimit.value : undefined,
          operationEligible: connectionId === 'gemini-managed' || (operation?.state === 'supported' && operation.value === true),
          capabilityPolicyVersion: status.capabilityPolicyVersion,
        });
      } catch {
        if (current) setProviderPlanContext(null);
      }
    };
    void refreshPlanContext();
    const onStorage = (event: StorageEvent) => {
      if (event.key === PROVIDER_PREFERENCES_KEY) void refreshPlanContext();
    };
    window.addEventListener('storage', onStorage);
    return () => { current = false; window.removeEventListener('storage', onStorage); };
  }, []);

  const parsedHasFileRetentionGap = Boolean(file && source?.retention === 'extracted-only');
  const extraction = useMemo(() => (results.length ? deduplicateChunkProposals(results) : emptyExtraction()), [results]);
  const unclassifiedFindings = extraction.findings.filter((finding) => finding.category === 'other');
  const identityMatches = useMemo(() => findPossibleIdentityMatches(extraction.entities), [extraction.entities]);
  const explicitProposalIds = [
    ...extraction.entities.filter((item) => item.kind === 'explicit').map((item) => item.id),
    ...extraction.entities
      .filter((item) => item.kind === 'explicit')
      .flatMap((item) => item.attributes.filter((attribute) => attribute.kind === 'explicit').map((attribute) => attribute.id)),
    ...extraction.relationships.filter((item) => item.kind === 'explicit').map((item) => item.id),
    ...extraction.findings.filter((item) => item.kind === 'explicit').map((item) => item.id),
  ];
  const analysisComplete = Boolean(
    source && segmentationComplete && failedChunks.length === 0 && completedChunkIds.size === chunks.length && chunks.length > 0 && !busy
  );
  const hasIncompleteCoverage = Boolean(source && (!segmentationComplete || failedChunks.length > 0 || completedChunkIds.size !== chunks.length));
  const initialAnalysisPlan = useMemo(() => source && !busy ? planAdaptiveNarrativeSourceAnalysis(
    source.text, source.blocks, Math.max(0, MAX_EXTRACTION_CALLS - callsUsed),
    providerPlanContext?.contextLimitTokens ? {
      maxInputTokens: Math.min(8_000, providerPlanContext.contextLimitTokens),
      envelopeReserveTokens: Math.min(1_500, Math.floor(providerPlanContext.contextLimitTokens * 0.2)),
    } : undefined,
  ) : null, [source, busy, callsUsed, providerPlanContext]);
  const canAnalyze = Boolean(
    aiConfigured && source && !busy && sourceError === '' && providerPlanContext !== null && providerPlanContext.connectionId !== 'chatgpt-plan' && providerPlanContext.operationEligible && (!parsedHasFileRetentionGap || confirmExtractedOnly) && (scope !== 'selective' || categories.length > 0)
  );

  const targetProject = useMemo(
    () => existingProjects.find((p) => p.id === targetProjectId) ?? null,
    [existingProjects, targetProjectId]
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

  // Preview source-only candidates without analysis so append identity and duplicate checks still run.
  const previewAssembledCandidate = useMemo(() => {
    if (!source || (results.length === 0 && !sourceOnlyMode)) return null;
    try {
      if (sourceOnlyMode) return buildSourceOnlyImportedProject(source, sourceId, projectName.trim() || 'Imported narrative');
      const processedSpans = calculateProcessedCoverage(chunks.filter((chunk) => completedChunkIds.has(chunk.id)));
      return assembleImportedProject(source, extraction, identityMatches, {
        sourceId,
        acceptedIds,
        rejectedIds,
        projectName: projectName.trim() || 'Imported narrative',
        coverage: {
          complete: analysisComplete,
          scope: analysisConfiguration?.scope ?? scope,
          categories: (analysisConfiguration?.scope ?? scope) === 'complete' ? allCategories : (analysisConfiguration?.categories ?? categories),
          instruction: analysisConfiguration?.instruction ?? instruction.trim(),
          totalCharacters: source.text.length,
          processedSpans,
          failedSegments: failedChunks.length,
          calls: callsUsed,
        },
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

  const canCommitBase = Boolean(source && !busy && (!parsedHasFileRetentionGap || confirmExtractedOnly) && (sourceOnlyMode || (results.length > 0 && (analysisComplete || (hasIncompleteCoverage && allowIncomplete)))));
  const canCreateNew = canCommitBase && destination === 'new' && Boolean(projectName.trim());
  const canApplyAppend =
    canCommitBase &&
    destination === 'append' &&
    Boolean(targetProject && reviewedTarget && onAppendToExistingProject) &&
    !appendTargetChanged &&
    unresolvedIdentityCount === 0 &&
    (!isDuplicateSource || allowDuplicateSource);

  const enhanceRequestPreview = useMemo(() => {
    if (!source) return null;
    return {
      filename: source.filename,
      sourceTextExcerpt: source.text.slice(0, 12_000),
      entities: extraction.entities.slice(0, 40).map((e) => ({ name: e.name, category: e.category })),
      sections: source.blocks.slice(0, 10).map((b, i) => {
        const blockText = source.text.slice(b.start, b.end);
        return {
          title: b.kind === 'heading' ? (b.label || blockText.slice(0, 120)) : `Block ${i + 1}`,
          excerpt: blockText.slice(0, 1200),
        };
      }),
      ...(enhanceGoals.trim() ? { goals: enhanceGoals.trim() } : {}),
    };
  }, [source, extraction.entities, enhanceGoals]);

  const enhanceBudget = useMemo(
    () => buildClientBudgetDisclosure('import-enhance', 'Stage 2 Enhancement Proposals', enhanceRequestPreview ?? ''),
    [enhanceRequestPreview]
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
    if (clearSourceIdentity) {
      stage2ControllerRef.current?.setActiveSource(null);
    } else {
      stage2ControllerRef.current?.invalidate();
    }
    epochRef.current += 1; abortRef.current?.abort(); abortRef.current = null;
  };

  const previewSource = async () => {
    sourceReadAbortRef.current?.abort();
    const controller = new AbortController();
    const readEpoch = ++sourceReadEpochRef.current;
    sourceReadAbortRef.current = controller;
    setSourceError(''); setRequestError(''); setSource(null); setSourceId(''); resetAnalysis(true); setConfirmExtractedOnly(false);
    try {
      let parsed: ParsedNarrativeSource;
      if (file) {
        parsed = await parseNarrativeSource(file, file.name, retainOriginal, controller.signal);
      } else {
        parsed = await parseNarrativeSource(pastedText, 'pasted-narrative.txt', true, controller.signal);
      }
      if (readEpoch !== sourceReadEpochRef.current) return;
      sourceReadAbortRef.current = null;
      const nextSourceId = crypto.randomUUID();
      setSource(parsed); setSourceId(nextSourceId);
      try {
        const checkpoints = await listImportCheckpoints(window.indexedDB);
        if (checkpoints.ok) {
          setCheckpointCandidates(checkpoints.value.filter(item => item.source.digest === parsed.digest &&
            item.source.filename === parsed.filename && item.source.mediaType === parsed.mediaType &&
            item.source.byteLength === parsed.byteLength));
        } else {
          setCheckpointMessage(`Saved analysis checkpoints are unavailable: ${checkpoints.error}`);
        }
      } catch (error) {
        setCheckpointMessage(`Saved analysis checkpoints are unavailable: ${error instanceof Error ? error.message : 'IndexedDB access failed.'}`);
      }
      stage2ControllerRef.current?.setActiveSource({
        sourceId: nextSourceId,
        sourceVersion: 'v1',
        digest: parsed.digest,
      });
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
    const runConfiguration = { scope, categories: [...categories], instruction: instruction.trim() };
    const plan = planAdaptiveNarrativeSourceAnalysis(source.text, source.blocks, MAX_EXTRACTION_CALLS,
      providerPlanContext.contextLimitTokens ? {
        maxInputTokens: Math.min(8_000, providerPlanContext.contextLimitTokens),
        envelopeReserveTokens: Math.min(1_500, Math.floor(providerPlanContext.contextLimitTokens * 0.2)),
      } : undefined);
    const identityInput = {
      source: { digest: source.digest, filename: source.filename, mediaType: source.mediaType, byteLength: source.byteLength },
      scope: runConfiguration.scope,
      categories: runConfiguration.scope === 'complete' ? allCategories : runConfiguration.categories,
      instruction: runConfiguration.instruction,
      provider: {
        connectionId: providerPlanContext.connectionId,
        ...(providerPlanContext.modelId ? { modelId: providerPlanContext.modelId } : {}),
        reasoningLevel: providerPlanContext.reasoningLevel,
        ...(providerPlanContext.capabilityPolicyVersion ? { capabilityPolicyVersion: providerPlanContext.capabilityPolicyVersion } : {}),
      },
      complete: plan.complete,
      maxCalls: MAX_EXTRACTION_CALLS,
      maxInputTokens: plan.limits.maxInputTokens,
      envelopeReserveTokens: plan.limits.envelopeReserveTokens,
      ...(providerPlanContext.contextLimitTokens ? { contextLimitTokens: providerPlanContext.contextLimitTokens } : {}),
      totalCharacters: source.text.length,
      chunks: plan.chunks.map(({ id, index, start, end }) => ({ id, index, start, end })),
    };
    if (!await matchesImportCheckpointIdentity(checkpoint, identityInput)) {
      setCheckpointMessage('This checkpoint does not match the current source, analysis plan, instruction, provider, model, or reasoning setting.');
      return;
    }
    if (!validateCheckpointEvidence(checkpoint, source.text, source.digest)) {
      setCheckpointMessage('Saved evidence no longer matches the source text. This checkpoint is rejected; no provider request was made.');
      return;
    }
    const persisted = await updateImportCheckpoint(window.indexedDB, checkpoint.id, current => {
      current.segments = current.segments.map(segment => segment.status === 'in-flight' ? { ...segment, status: 'uncertain' } : segment);
    });
    if (!persisted.ok) {
      setCheckpointMessage(`The checkpoint could not be safely restored: ${persisted.error}`);
      return;
    }
    const restored = persisted.value;
    const rebindEvidence = (result: VerifiedExtraction): VerifiedExtraction => {
      const rebind = <T extends { evidence: { sourceId: string } }>(item: T): T => ({ ...item, evidence: { ...item.evidence, sourceId } });
      return {
        findings: result.findings.map(rebind),
        entities: result.entities.map(entity => ({ ...rebind(entity), attributes: entity.attributes.map(rebind) })),
        relationships: result.relationships.map(rebind),
        ambiguities: result.ambiguities.map(rebind),
        rejectedEvidenceCount: result.rejectedEvidenceCount,
      };
    };
    const restoredChunks = restored.segments.map(segment => ({
      id: segment.id, index: segment.index, start: segment.start, end: segment.end,
      text: source.text.slice(segment.start, segment.end),
    }));
    const completeSegments = restored.segments.filter(segment => segment.status === 'complete' && segment.result);
    checkpointRef.current = restored;
    setCheckpointRestored(true);
    setActiveCheckpointId(restored.id);
    setChunks(restoredChunks); setSegmentationComplete(restored.plan.complete);
    setResults(completeSegments.map(segment => rebindEvidence(segment.result!)));
    setCompletedChunkIds(new Set(completeSegments.map(segment => segment.id)));
    setFailedChunks(restored.segments.filter(segment => segment.status === 'failed').map(segment => restoredChunks[segment.index]).filter(Boolean));
    setCallsUsed(restored.budget.callsUsed); setRejectedEvidenceCount(completeSegments.reduce((sum, segment) => sum + (segment.result?.rejectedEvidenceCount ?? 0), 0));
    setAnalysisConfiguration(runConfiguration); setCheckpointMessage('Checkpoint restored. Completed segments were reused; analysis continues only after you choose Analyze source.');
  };

  const startAnalysis = async (retry = false) => {
    if (!source || inProgressRef.current) return;
    setSourceOnlyMode(false);
    const nextCalls = callsUsed;
    const callBudget = MAX_EXTRACTION_CALLS;
    if (nextCalls >= callBudget) { setRequestError(`This import reached its ${callBudget}-call safety budget. Create an explicitly incomplete project or start a new scoped import.`); return; }
    inProgressRef.current = true;
    setBusy(true); setCancelled(false); setRequestError('');
    const runEpoch = epochRef.current;
    if (!retry) {
      try { providerSnapshotRef.current = window.localStorage.getItem(PROVIDER_PREFERENCES_KEY); }
      catch { providerSnapshotRef.current = null; }
    }
    const controller = new AbortController(); abortRef.current = controller;
    const runConfiguration = retry && analysisConfiguration ? analysisConfiguration : {
      scope,
      categories: [...categories],
      instruction: instruction.trim(),
    };
    if (!retry || !analysisConfiguration) setAnalysisConfiguration(runConfiguration);
    let planned: SourceChunk[];
    let checkpoint = checkpointRef.current;
    if (checkpoint) {
      const normalized = await updateImportCheckpoint(window.indexedDB, checkpoint.id, current => {
        current.segments = current.segments.map(segment => segment.status === 'in-flight' ? { ...segment, status: 'uncertain' } : segment);
      });
      if (!normalized.ok) {
        setRequestError(`Analysis stopped before provider access because checkpoint recovery could not be verified: ${normalized.error}`);
        setBusy(false); inProgressRef.current = false;
        if (abortRef.current === controller) abortRef.current = null;
        return;
      }
      checkpoint = normalized.value; checkpointRef.current = checkpoint;
    }
    if (retry) {
      planned = failedChunks;
    } else if (checkpoint) {
      planned = checkpoint.segments.filter(segment => segment.status !== 'complete').map(segment => ({
        id: segment.id, index: segment.index, start: segment.start, end: segment.end,
        text: source.text.slice(segment.start, segment.end),
      }));
    } else {
      const segmented = initialAnalysisPlan ?? planAdaptiveNarrativeSourceAnalysis(source.text, source.blocks, callBudget);
      const config = retry && analysisConfiguration ? analysisConfiguration : { scope, categories: [...categories], instruction: instruction.trim() };
      const created = await createImportCheckpoint({
        source: { digest: source.digest, filename: source.filename, mediaType: source.mediaType, byteLength: source.byteLength },
        scope: config.scope,
        categories: config.scope === 'complete' ? allCategories : config.categories,
        instruction: config.instruction,
        provider: {
          connectionId: providerPlanContext?.connectionId ?? 'unknown',
          ...(providerPlanContext?.modelId ? { modelId: providerPlanContext.modelId } : {}),
          reasoningLevel: providerPlanContext?.reasoningLevel ?? 'default',
          ...(providerPlanContext?.capabilityPolicyVersion ? { capabilityPolicyVersion: providerPlanContext.capabilityPolicyVersion } : {}),
        },
        complete: segmented.complete, maxCalls: callBudget, totalCharacters: source.text.length,
        maxInputTokens: segmented.limits.maxInputTokens,
        envelopeReserveTokens: segmented.limits.envelopeReserveTokens,
        ...(providerPlanContext?.contextLimitTokens ? { contextLimitTokens: providerPlanContext.contextLimitTokens } : {}),
        chunks: segmented.chunks.map(({ id, index, start, end }) => ({ id, index, start, end })),
      });
      const saved = await saveImportCheckpoint(window.indexedDB, created);
      if (!saved.ok) {
        setRequestError(`Analysis stopped before provider access because the local recovery checkpoint could not be saved: ${saved.error}`);
        setBusy(false); inProgressRef.current = false;
        if (abortRef.current === controller) abortRef.current = null;
        return;
      }
      checkpoint = created; checkpointRef.current = created;
      setActiveCheckpointId(created.id);
      planned = segmented.chunks;
      setChunks(segmented.chunks); setSegmentationComplete(segmented.complete);
      setCompletedChunkIds(new Set()); setResults([]); setFailedChunks([]); setRejectedEvidenceCount(0); setCallsUsed(0);
    }
    const failures: SourceChunk[] = [];
    let totalRejected = rejectedEvidenceCount;
    try {
      for (let index = 0; index < planned.length; index += 1) {
        const chunk = planned[index];
        if (controller.signal.aborted || runEpoch !== epochRef.current) { failures.push(...planned.slice(index)); break; }
        let currentProviderSnapshot: string | null = null;
        try { currentProviderSnapshot = window.localStorage.getItem(PROVIDER_PREFERENCES_KEY); } catch { /* Missing storage is checked by the request layer. */ }
        if (currentProviderSnapshot !== providerSnapshotRef.current) {
          failures.push(...planned.slice(index));
          setRequestError('The provider selection changed during this analysis. Remaining segments were stopped; review the plan and start a new analysis to use the new selection.');
          break;
        }
        if (!checkpoint) { failures.push(...planned.slice(index)); setRequestError('Analysis checkpoint authority is unavailable.'); break; }
        const reservation = await reserveImportSegmentAttempt(window.indexedDB, checkpoint.id, chunk.id, true);
        if (!reservation.ok) {
          failures.push(...planned.slice(index));
          setRequestError(`Analysis stopped before the next provider request because its persistent budget could not be reserved: ${reservation.error}`);
          break;
        }
        checkpoint = reservation.value; checkpointRef.current = checkpoint;
        setCallsUsed(checkpoint.budget.callsUsed);
        try {
          const request: NarrativeExtractionRequest = {
            sourceId, sourceVersion: 'v1', digest: source.digest, chunkId: chunk.id, text: chunk.text,
            scope: runConfiguration.scope,
            categories: runConfiguration.scope === 'complete' ? allCategories : runConfiguration.categories,
            instruction: runConfiguration.instruction,
          };
          const raw = await extractNarrativeChunk(request, controller.signal);
          if (controller.signal.aborted || runEpoch !== epochRef.current) {
            await updateImportCheckpoint(window.indexedDB, checkpoint.id, current => {
              const segment = current.segments.find(item => item.id === chunk.id);
              if (segment) segment.status = 'uncertain';
            });
            failures.push(...planned.slice(index));
            break;
          }
          const validated = verifyExtractionEvidence(NarrativeExtractionSchema.parse(raw), chunk,
            { id: sourceId, version: 'v1', digest: source.digest });
          const persisted = await updateImportCheckpoint(window.indexedDB, checkpoint.id, current => {
            const segment = current.segments.find(item => item.id === chunk.id);
            if (segment) { segment.status = 'complete'; segment.result = validated; }
            const done = current.segments.filter(item => item.status === 'complete');
            current.coverage = {
              complete: current.plan.complete && done.length === current.segments.length,
              processedCharacters: calculateProcessedCoverage(done.map(item => ({ start: item.start, end: item.end, id: item.id, index: item.index, text: '' })))
                .reduce((sum, span) => sum + span.end - span.start, 0),
              totalCharacters: source.text.length,
            };
          });
          if (!persisted.ok) {
            failures.push(...planned.slice(index));
            setRequestError(`The provider result was not committed to the local recovery checkpoint, so analysis stopped: ${persisted.error}`);
            break;
          }
          checkpoint = persisted.value; checkpointRef.current = checkpoint;
          totalRejected += validated.rejectedEvidenceCount;
          setRejectedEvidenceCount(totalRejected);
          setResults((previous) => [...previous, validated]);
          setCompletedChunkIds((previous) => new Set([...previous, chunk.id]));
        } catch (error) {
          const uncertain = isAbortError(error) || controller.signal.aborted;
          const persisted = await updateImportCheckpoint(window.indexedDB, checkpoint.id, current => {
            const segment = current.segments.find(item => item.id === chunk.id);
            if (segment) segment.status = uncertain ? 'uncertain' : 'failed';
          });
          if (persisted.ok) { checkpoint = persisted.value; checkpointRef.current = checkpoint; }
          if (uncertain) { failures.push(...planned.slice(index)); break; }
          failures.push(chunk);
          setRequestError(error instanceof Error ? error.message : 'A source segment could not be analyzed.');
        }
      }
    } finally {
      const aborted = controller.signal.aborted || runEpoch !== epochRef.current;
      if (runEpoch === epochRef.current) {
        setFailedChunks((previous) => (retry ? [...previous.filter((old) => !planned.some((item) => item.id === old.id)), ...failures] : failures));
        setCancelled(aborted);
      }
      setBusy(false); inProgressRef.current = false;
      if (abortRef.current === controller) abortRef.current = null;
    }
  };

  const runStage2Enhancements = async () => {
    if (!enhanceRequestPreview || !source || !sourceId || enhanceBusy) return;
    await stage2ControllerRef.current?.run({
      request: enhanceRequestPreview,
      aiConfigured,
      identity: {
        sourceId,
        sourceVersion: 'v1',
        digest: source.digest,
      },
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
    const processedSpans = calculateProcessedCoverage(chunks.filter((chunk) => completedChunkIds.has(chunk.id)));
    const assembled = assembleImportedProject(source, extraction, identityMatches, {
      sourceId,
      acceptedIds,
      rejectedIds,
      projectName: projectName.trim() || 'Imported narrative',
      coverage: {
        complete: analysisComplete,
        scope: analysisConfiguration?.scope ?? scope,
        categories: (analysisConfiguration?.scope ?? scope) === 'complete' ? allCategories : (analysisConfiguration?.categories ?? categories),
        instruction: analysisConfiguration?.instruction ?? instruction.trim(),
        totalCharacters: source.text.length,
        processedSpans,
        failedSegments: failedChunks.length,
        calls: callsUsed,
      },
    });
    // Record accepted Stage 2 enhancements strictly as tracked pending opportunities
    // only when the stored Stage 2 batch matches the current source identity (R0-A).
    const selectedEnhancements = stage2ControllerRef.current?.getValidatedAcceptedProposals({
      sourceId,
      sourceVersion: 'v1',
      digest: source.digest,
    }) ?? [];
    return attachAcceptedStage2Opportunities(assembled, selectedEnhancements, sourceId);
  };

  const commitImport = async () => {
    if (!source || creatingRef.current) return;
    if (destination === 'new' && !canCreateNew) return;
    if (destination === 'append' && !canApplyAppend) return;
    creatingRef.current = true;
    setCreating(true);
    setCreateError('');
    try {
      const assembled = buildFinalImportedProject();
      if (destination === 'append' && targetProject && reviewedTarget && onAppendToExistingProject) {
        const insertPosition: AppendInsertPosition =
          insertPositionKey === 'beginning'
            ? 'beginning'
            : insertPositionKey === 'end'
              ? 'end'
              : { afterSectionId: insertPositionKey };
        await onAppendToExistingProject({
          reviewedTarget,
          incomingProject: assembled,
          insertPosition,
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
            {[
              { label: 'Choose source', complete: Boolean(source), current: !source },
              { label: 'Inspect source', complete: Boolean(source), current: Boolean(source && chunks.length === 0 && !sourceOnlyMode) },
              { label: 'Analyze source (optional)', complete: sourceOnlyMode || results.length > 0, current: Boolean(source && !sourceOnlyMode && results.length === 0) },
              { label: 'Review candidates', complete: sourceOnlyMode || acceptedIds.size + rejectedIds.size > 0, current: results.length > 0 && acceptedIds.size + rejectedIds.size === 0 },
              { label: 'Choose destination & commit', complete: false, current: sourceOnlyMode || results.length > 0 && acceptedIds.size + rejectedIds.size > 0 },
            ].map((step, index) => (
              <li key={step.label} className="flex items-center gap-2">
                <span aria-current={step.current ? 'step' : undefined} className={`whitespace-nowrap rounded-full px-3 py-2 font-medium ${step.current ? 'bg-[#62445e] text-white' : step.complete ? 'bg-[#e9dfe8] text-[#62445e] dark:bg-purple-950 dark:text-purple-200' : 'bg-white text-gray-600 dark:bg-gray-900 dark:text-gray-400'}`}>
                  <span className="mr-1.5 tabular-nums">{index + 1}</span>{step.label}
                </span>
                {index < 4 && <span aria-hidden="true" className="text-gray-400">›</span>}
              </li>
            ))}
          </ol>
        </nav>

        <section className="space-y-3 rounded-xl border border-[#dad8d2] bg-white p-4 dark:border-gray-700 dark:bg-gray-900 sm:p-5" aria-labelledby="import-source-title">
          <h2 id="import-source-title" className="font-display text-xl font-semibold">1. Choose and inspect a story source</h2>
          <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(280px,1.1fr)]">
            <div className="space-y-3">
              <label className="block text-sm font-medium" htmlFor="import-file">Choose a manuscript file</label>
              <input id="import-file" type="file" accept=".txt,.md,.markdown,.docx,.pdf,.epub,application/pdf,application/epub+zip" onChange={(event) => readFile(event.currentTarget.files?.[0] ?? null)} className="block min-h-12 w-full rounded-lg border border-[#c8c3c5] bg-[#f5f2ee] p-3 text-sm file:mr-3 file:min-h-9 file:rounded-md file:border-0 file:bg-white file:px-3 file:font-semibold file:text-[#62445e] dark:border-gray-700 dark:bg-gray-800 dark:file:bg-gray-700 dark:file:text-purple-100" />
          <label className="block text-sm" htmlFor="import-pasted-text">Or paste narrative text</label>
          <textarea
            id="import-pasted-text"
            className="min-h-32 w-full rounded-lg border border-[#dad8d2] bg-white p-3 text-sm focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-[#62445e] dark:border-gray-700 dark:bg-gray-950"
            value={pastedText}
            onChange={(event) => {
              sourceReadEpochRef.current += 1;
              sourceReadAbortRef.current?.abort();
              sourceReadAbortRef.current = null;
              setPastedText(event.target.value);
              if (file) setFile(null);
              setSource(null);
              setSourceId('');
              resetAnalysis(true);
            }}
            placeholder="Paste text to preview locally"
          />
          {file && (
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={retainOriginal}
                onChange={(event) => {
                  sourceReadEpochRef.current += 1;
                  sourceReadAbortRef.current?.abort();
                  sourceReadAbortRef.current = null;
                  setRetainOriginal(event.target.checked);
                  setSource(null);
                  setSourceId('');
                  resetAnalysis(true);
                }}
              />
              Keep the original file alongside extracted text in the project and backups (up to {Math.round(MAX_RETAINED_ORIGINAL_BYTES / 1024 / 1024)} MiB)
            </label>
          )}
          <button type="button" className="min-h-11 rounded-lg bg-[#62445e] px-4 py-2 text-sm font-semibold text-white hover:bg-[#50364d] disabled:cursor-not-allowed disabled:opacity-50" onClick={() => void previewSource()} disabled={(!file && !pastedText.trim()) || busy}>{busy ? 'Reading source…' : 'Inspect source'}</button>
          {sourceError && <p role="alert" className="text-sm text-red-700 dark:text-red-300">{sourceError}</p>}
          {source && (
            <div className="space-y-2 rounded bg-gray-50 p-3 dark:bg-gray-900">
              <p className="font-medium">{source.filename} · {source.text.length.toLocaleString()} characters · {countNarrativeWords(source.text).toLocaleString()} words</p>
              <p className="break-all text-xs">Source SHA-256: {source.digest} · {source.retention === 'original-and-extracted' ? 'Original bytes retained' : 'Extracted text only'}</p>
              {source.warnings.map((warning, index) => <p key={index} className="text-sm text-amber-800 dark:text-amber-200">{warning}</p>)}
              {parsedHasFileRetentionGap && (
                <label className="flex items-center gap-2 text-sm">
                  <input type="checkbox" checked={confirmExtractedOnly} onChange={(event) => setConfirmExtractedOnly(event.target.checked)} />
                  I understand this import will not preserve the original file bytes.
                </label>
              )}
              <details>
                <summary>Extracted text preview</summary>
                <pre className="max-h-72 overflow-auto whitespace-pre-wrap break-words">
                  {source.text.slice(0, 12_000)}{source.text.length > 12_000 ? '\n… preview shortened; full source remains available to the import pipeline.' : ''}
                </pre>
              </details>
              {source.blocks.some((block) => block.kind === 'heading') && (
                <p className="text-sm">Detected {source.blocks.filter((block) => block.kind === 'heading').length} source heading(s). Plain text structure is not inferred.</p>
              )}
            </div>
          )}
            </div>
            <aside className="space-y-3 rounded-lg border border-[#dad8d2] bg-[#fbfaf7] p-4 text-sm dark:border-gray-700 dark:bg-gray-950" aria-label="Source inspection guidance">
              {source ? (
                <>
                  <div>
                    <h3 className="font-semibold">Source inspected</h3>
                    <p className="mt-1 break-words text-gray-700 dark:text-gray-300">{source.filename}</p>
                  </div>
                  <dl className="grid grid-cols-2 gap-3 border-y border-[#dad8d2] py-3 dark:border-gray-700">
                    <div><dt className="text-xs text-gray-600 dark:text-gray-400">Words</dt><dd className="font-semibold tabular-nums">{countNarrativeWords(source.text).toLocaleString()}</dd></div>
                    <div><dt className="text-xs text-gray-600 dark:text-gray-400">Characters</dt><dd className="font-semibold tabular-nums">{source.text.length.toLocaleString()}</dd></div>
                  </dl>
                  <p className="break-all text-xs text-gray-600 dark:text-gray-400">SHA-256 · {source.digest}</p>
                  <p className="text-xs text-gray-600 dark:text-gray-400">{source.retention === 'original-and-extracted' ? 'Original file and extracted text are retained separately.' : 'Only extracted text is retained for this import.'}</p>
                </>
              ) : (
                <>
                  <h3 className="font-semibold">Supported sources</h3>
                  <p className="text-gray-700 dark:text-gray-300">DOCX, Markdown, TXT, PDF, EPUB, or pasted text.</p>
                  <p className="text-xs text-gray-600 dark:text-gray-400">PDFs need selectable text. EPUB extraction is text based and may be partial. Image-only or unsupported archive content is not reconstructed.</p>
                  <p className="rounded-lg bg-[#f8efdf] px-3 py-2 text-xs font-semibold text-[#6e4c21] dark:bg-amber-950/40 dark:text-amber-200">Preview does not create a project.</p>
                </>
              )}
            </aside>
          </div>
        </section>

        {source && <section className="space-y-4 rounded-xl border border-[#dad8d2] bg-white p-4 dark:border-gray-700 dark:bg-gray-900 sm:p-5" aria-labelledby="import-config-title">
          <h2 id="import-config-title" className="font-display text-xl font-semibold">2. Choose source-only import or optional analysis</h2>
          <p className="text-sm">Source-only import keeps the inspected manuscript and provenance intact without analysis, AI provider calls, or extracted claims. Analysis is optional and adds separately reviewable candidate records.</p>

          <fieldset className="space-y-2 rounded-lg bg-[#fbfaf7] p-4 dark:bg-gray-950">
            <legend className="font-semibold">Import approach</legend>
            <label className="flex gap-2">
              <input type="radio" name="import-strategy" checked={strategy === 'faithful'} onChange={() => setStrategy('faithful')} />
              <span><strong>Faithful reconstruction</strong> <span className="text-gray-600 dark:text-gray-400">(default)</span><span className="mt-1 block text-xs text-gray-600 dark:text-gray-400">Keeps source text and extracted facts distinct; it does not rewrite the manuscript.</span></span>
            </label>
            <label className="flex gap-2">
              <input type="radio" name="import-strategy" checked={strategy === 'enhance'} onChange={() => setStrategy('enhance')} />
              <span><strong>Faithful import with optional enhancements</strong><span className="mt-1 block text-xs text-gray-600 dark:text-gray-400">Enhancement suggestions are separate proposals for review after extraction.</span></span>
            </label>
            {strategy === 'enhance' && (
              <p className="text-xs text-[#62445e] dark:text-purple-200">
                Stage 1 always performs strict faithful extraction first. After Stage 1 completes, you can explicitly run Stage 2 to generate separate, labeled enhancement and correction proposals without modifying the immutable original source.
              </p>
            )}
          </fieldset>

          <fieldset className="space-y-2">
            <legend className="text-sm font-medium">Extraction scope</legend>
            <label className="flex gap-2"><input type="radio" name="import-scope" checked={scope === 'complete'} onChange={() => { resetAnalysis(); setScope('complete'); }} />Complete extraction</label>
            <label className="flex gap-2"><input type="radio" name="import-scope" checked={scope === 'selective'} onChange={() => { resetAnalysis(); setScope('selective'); }} />Selective extraction</label>
            {scope === 'selective' && (
              <div className="grid gap-2 sm:grid-cols-2">
                {categoryOptions.map(([id, label]) => (
                  <label key={id} className="flex gap-2">
                    <input
                      type="checkbox"
                      checked={categories.includes(id)}
                      onChange={(event) => {
                        resetAnalysis();
                        setCategories((previous) => (event.target.checked ? [...new Set([...previous, id])] : previous.filter((item) => item !== id)));
                      }}
                    />
                    {label}
                  </label>
                ))}
              </div>
            )}
          </fieldset>

          <label className="block text-sm" htmlFor="import-instructions">Optional import-specific guidance (cannot override faithful extraction)</label>
          <textarea id="import-instructions" className="min-h-20 w-full rounded border p-2 dark:bg-gray-950" maxLength={1000} value={instruction} onChange={(event) => { resetAnalysis(); setInstruction(event.target.value); }} />
          <p className="text-sm">Analysis sends selected source segments through the configured narrative-import AI route. No analysis request is made until Analyze source.</p>
          {checkpointMessage && <p role="status" className="text-sm">{checkpointMessage}</p>}
          {checkpointCandidates.length > 0 && (
            <section className="space-y-2 rounded border border-gray-200 p-3 text-sm dark:border-gray-700" aria-label="Saved analysis checkpoints">
              <h3 className="font-medium">Saved analysis checkpoints</h3>
              <p>These checkpoints contain verified proposals and source references, not manuscript text or credentials. Restoring never starts provider requests.</p>
              {checkpointCandidates.map(checkpoint => (
                <div key={checkpoint.id} className="flex flex-wrap items-center gap-2">
                  <span>{checkpoint.plan.scope} · {checkpoint.segments.filter(segment => segment.status === 'complete').length}/{checkpoint.segments.length} segments · {checkpoint.budget.callsUsed}/{checkpoint.budget.maxCalls} attempts used</span>
                  <button type="button" className={workspaceButton} disabled={busy || !providerPlanContext} onClick={() => void restoreSavedCheckpoint(checkpoint)}>Restore checkpoint</button>
                  <button type="button" className={workspaceButton} disabled={busy || activeCheckpointId === checkpoint.id} onClick={() => void deleteImportCheckpoint(window.indexedDB, checkpoint.id).then(result => {
                    if (result.ok) { setCheckpointCandidates(current => current.filter(item => item.id !== checkpoint.id)); setCheckpointMessage('Saved analysis checkpoint deleted.'); }
                    else setCheckpointMessage(`Checkpoint could not be deleted: ${result.error}`);
                  })}>Delete checkpoint</button>
                </div>
              ))}
            </section>
          )}
          {initialAnalysisPlan && (
            <div className="space-y-1 rounded border border-gray-200 p-3 text-sm dark:border-gray-700" aria-label="Local analysis plan">
              <p className="font-medium">Automatic analysis plan</p>
              <p>{initialAnalysisPlan.chunks.length} planned source segment(s) · up to {initialAnalysisPlan.scheduledRequests} extraction request(s) in this pass.</p>
              <p>Adaptive plan for narrative import · {providerPlanContext?.connectionId ?? 'provider status unavailable'}{providerPlanContext?.modelId ? ` · ${providerPlanContext.modelId}` : ' · provider default'} · reasoning {providerPlanContext?.reasoningLevel ?? 'Default'}.</p>
              {providerPlanContext?.connectionId === 'chatgpt-plan' && <p role="status" className="text-amber-800 dark:text-amber-200">ChatGPT narrative import remains blocked. The approved ChatGPT SRB pilot is mock-only for the separate story operation; no import inference or billing fallback is available.</p>}
              {providerPlanContext === null && <p role="status" className="text-amber-800 dark:text-amber-200">Provider selection could not be verified. Refresh provider status before starting analysis.</p>}
              <p>Adaptive local estimate: up to {initialAnalysisPlan.limits.payloadTokenBudget.toLocaleString()} source tokens per segment, with {initialAnalysisPlan.limits.envelopeReserveTokens.toLocaleString()} reserved for instructions and schema. A supported model context limit is used when the account catalog provides one; otherwise the conservative narrative-import limit applies. The server remains authoritative and blocks transports that cannot meet operation preflight.</p>
              {!initialAnalysisPlan.completeWithinCallBudget && <p className="text-amber-800 dark:text-amber-200">The current limits permit only partial source coverage: {initialAnalysisPlan.unplannedChars.toLocaleString()} source character units remain outside this pass. The original manuscript is preserved.</p>}
              <p className="text-xs text-gray-600 dark:text-gray-300">The plan is pinned to this source digest, narrative-import task, current provider preference snapshot, and the displayed policy limits when analysis starts. A provider change stops remaining segments. Estimates do not guarantee quota, cost, or semantic completeness.</p>
            </div>
          )}
          <div className="flex flex-wrap gap-2">
            <button type="button" className={workspaceButton} disabled={!source || busy || creating || (parsedHasFileRetentionGap && !confirmExtractedOnly)} onClick={() => { resetAnalysis(); setSourceOnlyMode(true); }}>Continue with source only</button>
            <button type="button" className={workspaceButton} disabled={!canAnalyze || callsUsed >= MAX_EXTRACTION_CALLS} onClick={() => void startAnalysis(false)}>{checkpointRestored ? 'Continue analysis' : 'Analyze source'}</button>
            {busy && <button type="button" className={workspaceButton} onClick={cancelAnalysis}>Cancel analysis</button>}
            {failedChunks.length > 0 && !busy && <button type="button" className={workspaceButton} disabled={callsUsed >= MAX_EXTRACTION_CALLS} onClick={() => void startAnalysis(true)}>Retry failed segments ({failedChunks.length})</button>}
          </div>
          {!aiConfigured && <p role="status">Analysis is unavailable because the server Gemini API key is not configured. Local source preview remains available.</p>}
          {busy && <p role="status" aria-live="polite">{progress} · {callsUsed}/{MAX_EXTRACTION_CALLS} requests used</p>}
          {cancelled && <p className="text-sm">Analysis was cancelled. Completed segment results remain available for review.</p>}
          {requestError && <p role="alert" className="text-sm text-red-700 dark:text-red-300">{requestError}</p>}
          {hasIncompleteCoverage && !busy && chunks.length > 0 && (
            <div className="space-y-2 rounded bg-amber-50 p-3 dark:bg-amber-950">
              <p>Coverage is incomplete: {progress}. Unprocessed source remains visible in the original. Saving stays disabled unless you explicitly approve an incomplete import.</p>
              <label className="flex gap-2"><input type="checkbox" checked={allowIncomplete} onChange={(event) => setAllowIncomplete(event.target.checked)} />Approve an explicitly incomplete import with unprocessed coverage recorded</label>
            </div>
          )}
        </section>}

        {(results.length > 0 || sourceOnlyMode) && (
          <section className="space-y-4 rounded-xl border border-[#dad8d2] bg-white p-4 dark:border-gray-700 dark:bg-gray-900 sm:p-5" aria-labelledby="import-review-title">
            <h2 id="import-review-title" className="font-display text-xl font-semibold">{sourceOnlyMode ? '3. Confirm source-only destination' : '3. Review extracted candidates'}</h2>
            <p className="text-sm">{sourceOnlyMode ? 'No analysis was run. The complete inspected text remains the manuscript, and the source record carries its digest, parser metadata, and retention choice.' : `${analysisComplete ? 'All planned source segments were analyzed.' : `Partial analysis · ${progress}`}. Only confirmed findings enter the canonical graph; unchecked findings remain pending with evidence. Rejected quotes: ${rejectedEvidenceCount}. Duplicate names remain separate pending author review.`}</p>
            {!sourceOnlyMode && <>
            <button
              type="button"
              className={workspaceButton}
              disabled={explicitProposalIds.length === 0 || creating}
              onClick={() => {
                setAcceptedIds((previous) => new Set([...previous, ...explicitProposalIds]));
                setRejectedIds((previous) => new Set([...previous].filter((id) => !explicitProposalIds.includes(id))));
              }}
            >
              Accept evidence-backed explicit findings ({explicitProposalIds.length})
            </button>

            {/* Stage 2: Optional Reconstruct & Enhance */}
            {strategy === 'enhance' && (
              <div className="space-y-2.5 rounded border border-indigo-200 bg-indigo-50/30 p-3 text-xs dark:border-indigo-900/60 dark:bg-indigo-950/20">
                <h3 className="font-semibold text-sm text-indigo-900 dark:text-indigo-200">
                  Optional Stage 2: Post-Faithful Enhancement &amp; Correction Proposals
                </h3>
                <p>
                  Faithful extraction above is complete and immutable. Optionally generate separate creative/correction suggestions saved as pending opportunities — never mixed into extracted facts or original source text.
                </p>
                <label className="block space-y-1">
                  <span className="font-medium">Optional enhancement goals</span>
                  <input
                    type="text"
                    maxLength={500}
                    value={enhanceGoals}
                    onChange={(e) => setEnhanceGoals(e.target.value)}
                    placeholder="e.g. Flag dialogue rhythm improvements or continuity corrections"
                    className="w-full rounded border border-gray-300 bg-white px-2 py-1 dark:border-gray-700 dark:bg-gray-950"
                  />
                </label>
                <p className="text-[11px] text-gray-600 dark:text-gray-400 tabular-nums">
                  Preflight: {enhanceBudget.inputChars.toLocaleString()} / {enhanceBudget.maxInputChars.toLocaleString()} chars · ~{enhanceBudget.estimatedInputTokens.toLocaleString()} / {enhanceBudget.maxInputTokens.toLocaleString()} est. tokens.
                </p>
                <button
                  type="button"
                  disabled={enhanceBusy || !aiConfigured || !enhanceBudget.withinLimit}
                  onClick={() => void runStage2Enhancements()}
                  className="rounded bg-indigo-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-indigo-700 disabled:opacity-45"
                >
                  {enhanceBusy ? 'Generating Stage 2 proposals…' : 'Generate Enhancement Proposals'}
                </button>
                {enhanceError && <p role="alert" className="text-red-700 dark:text-red-300">{enhanceError}</p>}
                {enhancements.length > 0 && (
                  <div className="space-y-2 pt-1">
                    {enhancements.map((enh) => (
                      <article key={enh.id} className="rounded border border-indigo-200 bg-white p-2.5 space-y-1 dark:border-indigo-800 dark:bg-gray-900">
                        <label className="flex items-center gap-2 font-semibold">
                          <input
                            type="checkbox"
                            checked={acceptedEnhancementIds.has(enh.id)}
                            onChange={(e) =>
                              stage2ControllerRef.current?.toggleAccepted(enh.id, e.target.checked)
                            }
                          />
                          <span>{enh.title}</span>
                          <span className="rounded bg-indigo-100 px-1.5 py-0.5 text-[10px] uppercase text-indigo-800 dark:bg-indigo-950 dark:text-indigo-300">
                            AI Enhancement · {enh.category}
                          </span>
                        </label>
                        <p>{enh.rationale}</p>
                        {enh.beforeExcerpt && <p className="text-red-700 dark:text-red-300">Before: {enh.beforeExcerpt}</p>}
                        <p className="text-emerald-700 dark:text-emerald-300">Suggested: {enh.afterExcerpt}</p>
                        {enh.assumptions.length > 0 && <p className="text-[11px] text-gray-500">Assumptions: {enh.assumptions.join('; ')}</p>}
                      </article>
                    ))}
                  </div>
                )}
              </div>
            )}

            {/* Append Cross-Project Identity & Duplicate Source Checks */}
            {destination === 'append' && targetProject && (
              <div className="space-y-2.5 rounded border border-amber-300 bg-amber-50/40 p-3 text-xs dark:border-amber-800 dark:bg-amber-950/20">
                <h3 className="font-semibold text-sm">Append Conflict &amp; Identity Review ({targetProject.name})</h3>
                {isDuplicateSource && (
                  <div className="rounded border border-red-300 bg-red-50/50 p-2 space-y-1 dark:border-red-800 dark:bg-red-950/30">
                    <p className="font-semibold text-red-800 dark:text-red-300">
                      Duplicate source detected: a source with the exact same SHA-256 digest already exists in &ldquo;{targetProject.name}&rdquo;.
                    </p>
                    <label className="flex items-center gap-2">
                      <input type="checkbox" checked={allowDuplicateSource} onChange={(e) => setAllowDuplicateSource(e.target.checked)} />
                      I intentionally want to append this duplicate source again.
                    </label>
                  </div>
                )}
                {crossProjectMatches.length === 0 ? (
                  <p className="text-emerald-800 dark:text-emerald-300">No entity name/alias collisions detected with &ldquo;{targetProject.name}&rdquo;.</p>
                ) : (
                  <div className="space-y-2">
                    <p>
                      Found {crossProjectMatches.length} potential entity collision(s). Choose explicitly whether to keep separate or link to the existing entity before applying append.
                    </p>
                    {crossProjectMatches.map((match) => (
                      <div key={match.incomingEntityId} className="flex flex-wrap items-center justify-between gap-2 rounded border border-amber-300 bg-white p-2 dark:border-amber-800 dark:bg-gray-900">
                        <div>
                          <span className="font-semibold">{match.incomingEntityName}</span> ↔ <span className="font-semibold">{match.existingEntityName}</span>
                          <span className="ml-2 text-gray-500">({match.matchReason})</span>
                        </div>
                        <div className="flex items-center gap-3">
                          <label className="flex items-center gap-1">
                            <input
                              type="radio"
                              name={`id-decision-${match.incomingEntityId}`}
                              checked={identityDecisions[match.incomingEntityId] === 'keep-separate'}
                              onChange={() => setIdentityDecisions((prev) => ({ ...prev, [match.incomingEntityId]: 'keep-separate' }))}
                            />
                            Keep Separate
                          </label>
                          <label className="flex items-center gap-1">
                            <input
                              type="radio"
                              name={`id-decision-${match.incomingEntityId}`}
                              checked={identityDecisions[match.incomingEntityId] === 'link-to-existing'}
                              onChange={() => setIdentityDecisions((prev) => ({ ...prev, [match.incomingEntityId]: 'link-to-existing' }))}
                            />
                            Link to Existing
                          </label>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}

            <div className="max-h-[55vh] space-y-3 overflow-auto">
              <h3 className="font-medium">Entities and attributes ({extraction.entities.length})</h3>
              {extraction.entities.map((entity) => (
                <article key={entity.id} className="rounded border p-3">
                  <label className="flex gap-2 font-medium">
                    <input type="checkbox" checked={acceptedIds.has(entity.id)} onChange={(event) => toggleAccepted(entity.id, event.target.checked)} />
                    {entity.name} · {entity.category} · {entity.kind}
                  </label>
                  <p>{entity.description || entity.rationale}</p>
                  <EvidenceQuote evidence={entity.evidence} />
                  {entity.attributes.map((attribute) => (
                    <div key={attribute.id} className="ml-4 mt-2 border-l pl-3">
                      <label className="flex gap-2">
                        <input type="checkbox" checked={acceptedIds.has(attribute.id)} disabled={!acceptedIds.has(entity.id)} onChange={(event) => toggleAccepted(attribute.id, event.target.checked)} />
                        {attribute.name}: {attribute.value} · {attribute.kind}
                      </label>
                      <EvidenceQuote evidence={attribute.evidence} />
                    </div>
                  ))}
                </article>
              ))}
              <h3 className="font-medium">Directed relationships ({extraction.relationships.length})</h3>
              {extraction.relationships.map((relation) => (
                <article key={relation.id} className="rounded border p-3">
                  <label className="flex gap-2">
                    <input type="checkbox" checked={acceptedIds.has(relation.id)} onChange={(event) => toggleAccepted(relation.id, event.target.checked)} />
                    {relation.source} → {relation.target} · {relation.label} · {relation.kind}
                  </label>
                  <p>{relation.rationale}</p>
                  <EvidenceQuote evidence={relation.evidence} />
                </article>
              ))}
              <h3 className="font-medium">Findings for review ({extraction.findings.length})</h3>
              {scope === 'complete' && unclassifiedFindings.length > 0 && (
                <p role="status" className="rounded border border-amber-400 p-3 text-sm">
                  {unclassifiedFindings.length} unclassified findings retained for review. Complete segment coverage does not mean every fact or category was understood.
                </p>
              )}
              {extraction.findings.map((finding) => (
                <article key={finding.id} className="rounded border p-3">
                  <label className="flex gap-2">
                    <input type="checkbox" checked={acceptedIds.has(finding.id)} onChange={(event) => toggleAccepted(finding.id, event.target.checked)} />
                    {finding.title}: {finding.value} · {finding.category} · {finding.kind}
                  </label>
                  <p>{finding.rationale}</p>
                  <EvidenceQuote evidence={finding.evidence} />
                  <button type="button" className="text-sm underline" onClick={() => toggleRejected(finding.id, !rejectedIds.has(finding.id))}>
                    {rejectedIds.has(finding.id) ? 'Mark pending' : 'Reject finding'}
                  </button>
                </article>
              ))}
              <h3 className="font-medium">Ambiguities and possible issues ({extraction.ambiguities.length})</h3>
              {extraction.ambiguities.map((issue) => (
                <article key={issue.id} className="rounded border border-amber-400 p-3">
                  <p className="font-medium">{issue.title} · {issue.certainty}</p>
                  <p>{issue.detail}</p>
                  <p>{issue.rationale}</p>
                  <EvidenceQuote evidence={issue.evidence} />
                </article>
              ))}
              {identityMatches.map((match) => (
                <p key={`${match.leftId}:${match.rightId}`} className="rounded border border-amber-400 p-3">
                  Possible same identity: {match.matchedName}. The two proposals remain separate; the resulting issue will require clarification.
                </p>
              ))}
            </div>
            </>}

            <fieldset className="space-y-3 rounded-lg border border-[#dad8d2] bg-[#fbfaf7] p-4 dark:border-gray-700 dark:bg-gray-950" aria-labelledby="import-destination-title">
              <legend id="import-destination-title" className="font-semibold">4. Choose destination and commit</legend>
              <div className="flex flex-wrap gap-4 text-sm">
                <label className="flex items-center gap-2">
                  <input type="radio" name="import-destination" checked={destination === 'new'} onChange={() => setDestination('new')} />
                  Create a new project
                </label>
                <label className="flex items-center gap-2">
                  <input type="radio" name="import-destination" disabled={existingProjects.length === 0 || !onAppendToExistingProject} checked={destination === 'append'} onChange={() => { setDestination('append'); const selected = targetProject ?? existingProjects[0]; if (selected) reviewAppendTarget(selected); }} />
                  Append to an existing project
                </label>
              </div>
              {destination === 'new' ? (
                <label className="block max-w-xl space-y-1 text-sm font-medium" htmlFor="import-project-name">
                  <span>New project name</span>
                  <input id="import-project-name" className="min-h-10 w-full rounded-lg border border-[#dad8d2] bg-white px-3 font-normal dark:border-gray-700 dark:bg-gray-900" value={projectName} onChange={(event) => setProjectName(event.target.value)} />
                </label>
              ) : (
                <div className="grid gap-3 rounded-lg border border-[#dad8d2] bg-white p-3 text-sm sm:grid-cols-2 dark:border-gray-700 dark:bg-gray-900">
                  <label className="space-y-1">
                    <span className="block font-semibold">Target project</span>
                    <select value={targetProject?.id ?? ''} onChange={(event) => { const selected = existingProjects.find((item) => item.id === event.target.value); if (selected) reviewAppendTarget(selected); }} className="min-h-10 w-full rounded border border-gray-300 bg-white px-2 dark:border-gray-700 dark:bg-gray-950">
                      {!targetProject && <option value="">Select a project</option>}
                      {existingProjects.map((item) => <option key={item.id} value={item.id}>{item.name} · Revision {item.revision}</option>)}
                    </select>
                  </label>
                  <label className="space-y-1">
                    <span className="block font-semibold">Insert position</span>
                    <select value={insertPositionKey} onChange={(event) => setInsertPositionKey(event.target.value)} className="min-h-10 w-full rounded border border-gray-300 bg-white px-2 dark:border-gray-700 dark:bg-gray-950">
                      <option value="end">At the end</option>
                      <option value="beginning">At the beginning</option>
                      {targetSections.map((section, index) => <option key={section.id} value={section.id}>After {index + 1}: {section.title || `Untitled ${section.kind}`}</option>)}
                    </select>
                  </label>
                  {appendTargetChanged && targetProject && <div role="alert" className="sm:col-span-2">The target project changed. Review its insertion point and identity matches again. <button type="button" className="underline" onClick={() => reviewAppendTarget(targetProject)}>Review updated target</button></div>}
                  <p className="text-xs text-gray-600 dark:text-gray-400 sm:col-span-2">A verified safety checkpoint is created before appending. Matching identities stay separate unless you explicitly choose to link them. Appending is a separate commit.</p>
                </div>
              )}
            </fieldset>

            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                className={workspaceButton}
                disabled={creating || (destination === 'new' ? !canCreateNew : !canApplyAppend)}
                onClick={() => void commitImport()}
              >
                {creating
                  ? destination === 'append'
                    ? 'Appending to project…'
                    : 'Creating project…'
                  : destination === 'append'
                    ? `Append to "${targetProject?.name ?? 'Project'}"`
                    : 'Create Project'}
              </button>
              {createError && <p role="alert" className="text-sm text-red-700 dark:text-red-300">{createError}</p>}
            </div>
          </section>
        )}
      </div>
    </main>
  );
}

function EvidenceQuote({ evidence }: { evidence: VerifiedExtraction['findings'][number]['evidence'] }) {
  return (
    <blockquote className="whitespace-pre-wrap break-words border-l-2 pl-3 text-sm">
      <span>{evidence.excerpt}</span>
      <span className="mt-1 block text-xs text-gray-600 dark:text-gray-400">
        Source characters {evidence.start}–{evidence.end} · {evidence.sourceId.slice(0, 8)} · {evidence.version}
      </span>
    </blockquote>
  );
}
