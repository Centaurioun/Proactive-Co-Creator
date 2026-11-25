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
import { MAX_IMPORT_CHUNKS, calculateProcessedCoverage, segmentNarrativeSource, type SourceChunk } from '../../lib/narrative/import/segmentation';
import { countNarrativeWords, MAX_RETAINED_ORIGINAL_BYTES, parseNarrativeSource, type ParsedNarrativeSource } from '../../lib/narrative/import/sourceParser';
import { manuscriptSections } from '../../lib/narrative/manuscriptModel';
import {
  attachAcceptedStage2Opportunities,
  createStage2EnhancementController,
  type Stage2EnhancementController,
  type Stage2EnhancementState,
} from '../../lib/narrative/import/stage2Enhancements';
import { extractNarrativeChunk, isAbortError, requestImportEnhancements } from '../../services/apiClient';
import { workspaceButton } from '../manuscript/ManuscriptEditor';

const MAX_EXTRACTION_CALLS = 12;
type Category = NarrativeExtractionRequest['categories'][number];
interface AnalysisConfiguration {
  scope: 'complete' | 'selective';
  categories: Category[];
  instruction: string;
}
const categoryOptions: Array<[Category, string]> = [
  ['characters', 'Characters and identities'], ['attributes', 'Attributes and aliases'], ['relationships', 'Relationships'],
  ['locations', 'Locations and worldbuilding'], ['objects', 'Objects'], ['events', 'Events and plot'],
  ['story-bible', 'Story Bible'], ['themes-style', 'Themes and style'], ['continuity', 'Ambiguity and possible continuity issues'],
];
const allCategories = categoryOptions.map(([id]) => id);
const emptyExtraction = (): VerifiedExtraction => ({ findings: [], entities: [], relationships: [], ambiguities: [], rejectedEvidenceCount: 0 });

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
  const canAnalyze = Boolean(
    aiConfigured && source && !busy && sourceError === '' && (!parsedHasFileRetentionGap || confirmExtractedOnly) && (scope !== 'selective' || categories.length > 0)
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

  // Preview assembled candidate when results exist so we can compute exact cross-project identity matches & duplicate digest
  const previewAssembledCandidate = useMemo(() => {
    if (!source || results.length === 0) return null;
    try {
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
  }, [source, results.length, chunks, completedChunkIds, extraction, identityMatches, sourceId, acceptedIds, rejectedIds, projectName, analysisComplete, analysisConfiguration, scope, categories, instruction, failedChunks.length, callsUsed]);

  const crossProjectMatches = useMemo(() => {
    if (destination !== 'append' || !targetProject || !previewAssembledCandidate) return [];
    return findCrossProjectIdentityMatches(targetProject, previewAssembledCandidate);
  }, [destination, targetProject, previewAssembledCandidate]);

  const isDuplicateSource = useMemo(() => {
    if (destination !== 'append' || !targetProject || !previewAssembledCandidate) return false;
    return detectDuplicateSourceInProject(targetProject, previewAssembledCandidate);
  }, [destination, targetProject, previewAssembledCandidate]);

  const unresolvedIdentityCount = crossProjectMatches.filter((m) => !identityDecisions[m.incomingEntityId]).length;

  const canCommitBase = Boolean(source && results.length > 0 && !busy && (analysisComplete || (hasIncompleteCoverage && allowIncomplete)));
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

  const startAnalysis = async (retry = false, smallerChunks = false) => {
    if (!source || inProgressRef.current) return;
    const nextCalls = callsUsed;
    const callBudget = MAX_EXTRACTION_CALLS;
    if (nextCalls >= callBudget) { setRequestError(`This import reached its ${callBudget}-call safety budget. Create an explicitly incomplete project or start a new scoped import.`); return; }
    inProgressRef.current = true;
    setBusy(true); setCancelled(false); setRequestError('');
    const runEpoch = epochRef.current;
    const controller = new AbortController(); abortRef.current = controller;
    const runConfiguration = retry && analysisConfiguration ? analysisConfiguration : {
      scope,
      categories: [...categories],
      instruction: instruction.trim(),
    };
    if (!retry || !analysisConfiguration) setAnalysisConfiguration(runConfiguration);
    const planned = retry ? failedChunks : (() => {
      const segmented = segmentNarrativeSource(source.text, source.blocks, smallerChunks ? 8_000 : undefined,
        smallerChunks ? 250 : undefined, MAX_IMPORT_CHUNKS);
      setChunks(segmented.chunks); setSegmentationComplete(segmented.complete);
      setCompletedChunkIds(new Set()); setResults([]); setFailedChunks([]); setRejectedEvidenceCount(0);
      return segmented.chunks;
    })();
    const failures: SourceChunk[] = [];
    let totalRejected = rejectedEvidenceCount;
    let callsRemaining = callBudget - callsUsed;
    try {
      for (let index = 0; index < planned.length; index += 1) {
        const chunk = planned[index];
        if (controller.signal.aborted || runEpoch !== epochRef.current) { failures.push(...planned.slice(index)); break; }
        if (callsRemaining <= 0) { failures.push(...planned.slice(index)); break; }
        callsRemaining -= 1;
        setCallsUsed((value) => value + 1);
        try {
          const request: NarrativeExtractionRequest = {
            sourceId, sourceVersion: 'v1', digest: source.digest, chunkId: chunk.id, text: chunk.text,
            scope: runConfiguration.scope,
            categories: runConfiguration.scope === 'complete' ? allCategories : runConfiguration.categories,
            instruction: runConfiguration.instruction,
          };
          const raw = await extractNarrativeChunk(request, controller.signal);
          if (controller.signal.aborted || runEpoch !== epochRef.current) {
            failures.push(...planned.slice(index));
            break;
          }
          const validated = verifyExtractionEvidence(NarrativeExtractionSchema.parse(raw), chunk,
            { id: sourceId, version: 'v1', digest: source.digest });
          totalRejected += validated.rejectedEvidenceCount;
          setRejectedEvidenceCount(totalRejected);
          setResults((previous) => [...previous, validated]);
          setCompletedChunkIds((previous) => new Set([...previous, chunk.id]));
        } catch (error) {
          if (isAbortError(error) || controller.signal.aborted) { failures.push(...planned.slice(index)); break; }
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
    <main className="min-h-0 flex-1 overflow-auto p-4 sm:p-6">
      <div className="mx-auto max-w-5xl space-y-5">
        <header className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="text-2xl font-bold">Import &amp; Analyze Story</h1>
            <p className="text-sm text-gray-600 dark:text-gray-300">
              Preview locally. Analysis starts only when you choose Analyze source. Supports creating a new project or safely appending into an existing project.
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
            Cancel import
          </button>
        </header>

        <section className="space-y-3 rounded-lg border border-gray-300 p-4 dark:border-gray-700" aria-labelledby="import-source-title">
          <h2 id="import-source-title" className="font-semibold">1. Select source</h2>
          <label className="block text-sm" htmlFor="import-file">Choose a TXT, Markdown, DOCX, selectable-text PDF, or text-based EPUB file</label>
          <input id="import-file" type="file" accept=".txt,.md,.markdown,.docx,.pdf,.epub,application/pdf,application/epub+zip" onChange={(event) => readFile(event.currentTarget.files?.[0] ?? null)} />
          <label className="block text-sm" htmlFor="import-pasted-text">Or paste narrative text</label>
          <textarea
            id="import-pasted-text"
            className="min-h-36 w-full rounded border p-2 dark:bg-gray-950"
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
              Retain original file bytes in project and portable backup (up to {Math.round(MAX_RETAINED_ORIGINAL_BYTES / 1024 / 1024)} MiB)
            </label>
          )}
          <button type="button" className={workspaceButton} onClick={() => void previewSource()} disabled={(!file && !pastedText.trim()) || busy}>Preview source</button>
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
        </section>

        <section className="space-y-3 rounded-lg border border-gray-300 p-4 dark:border-gray-700" aria-labelledby="import-config-title">
          <h2 id="import-config-title" className="font-semibold">2. Configure import &amp; destination</h2>

          {/* Destination Toggle: Create New vs Append to Existing Project */}
          <fieldset className="space-y-2">
            <legend className="text-sm font-medium">Import destination</legend>
            <div className="flex flex-wrap gap-4 text-sm">
              <label className="flex items-center gap-2">
                <input type="radio" name="import-destination" checked={destination === 'new'} onChange={() => setDestination('new')} />
                Create New Project (default)
              </label>
              <label className="flex items-center gap-2">
                <input
                  type="radio"
                  name="import-destination"
                  disabled={existingProjects.length === 0 || !onAppendToExistingProject}
                  checked={destination === 'append'}
                  onChange={() => {
                    setDestination('append');
                    const selected = targetProject ?? existingProjects[0];
                    if (selected) reviewAppendTarget(selected);
                  }}
                />
                Append to Existing Project
              </label>
            </div>
            {destination === 'append' && (
              <div className="grid gap-3 rounded border border-blue-200 bg-blue-50/30 p-3 text-xs sm:grid-cols-2 dark:border-blue-900/60 dark:bg-blue-950/20">
                <label className="space-y-1">
                  <span className="font-semibold">Target project</span>
                  <select
                    value={targetProject?.id ?? ''}
                    onChange={(e) => {
                      const selected = existingProjects.find((project) => project.id === e.target.value);
                      if (selected) reviewAppendTarget(selected);
                    }}
                    className="w-full rounded border border-gray-300 bg-white px-2 py-1 dark:border-gray-700 dark:bg-gray-950"
                  >
                    {!targetProject && <option value="">Select a surviving project</option>}
                    {existingProjects.map((proj) => (
                      <option key={proj.id} value={proj.id}>
                        {proj.name} (Rev #{proj.revision})
                      </option>
                    ))}
                  </select>
                </label>
                <label className="space-y-1">
                  <span className="font-semibold">Insertion point in manuscript</span>
                  <select
                    value={insertPositionKey}
                    onChange={(e) => setInsertPositionKey(e.target.value)}
                    className="w-full rounded border border-gray-300 bg-white px-2 py-1 dark:border-gray-700 dark:bg-gray-950"
                  >
                    <option value="end">End of manuscript (default)</option>
                    <option value="beginning">Beginning of manuscript</option>
                    {targetSections.map((sec, idx) => (
                      <option key={sec.id} value={sec.id}>
                        After #{idx + 1}: {sec.title || `Untitled ${sec.kind}`}
                      </option>
                    ))}
                  </select>
                </label>
                {appendTargetChanged && targetProject && (
                  <div role="alert" className="sm:col-span-2">
                    The target project changed. Review its insertion point and identity matches again.
                    <button type="button" className={workspaceButton} onClick={() => reviewAppendTarget(targetProject)}>
                      Review updated target
                    </button>
                  </div>
                )}
                <p className="sm:col-span-2 text-gray-600 dark:text-gray-300">
                  A verified safety checkpoint backup is created automatically before appending. Colliding entities are never auto-merged.
                </p>
              </div>
            )}
          </fieldset>

          <fieldset className="space-y-2">
            <legend className="text-sm font-medium">Reconstruction strategy</legend>
            <label className="flex gap-2">
              <input type="radio" name="import-strategy" checked={strategy === 'faithful'} onChange={() => setStrategy('faithful')} />
              Faithful Reconstruction (default)
            </label>
            <label className="flex gap-2">
              <input type="radio" name="import-strategy" checked={strategy === 'enhance'} onChange={() => setStrategy('enhance')} />
              Reconstruct &amp; Enhance (Faithful Stage 1 + Optional Reviewable Stage 2 Proposals)
            </label>
            {strategy === 'enhance' && (
              <p className="text-xs text-blue-800 dark:text-blue-300">
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
          <p className="text-sm">Analysis sends selected source segments to the app’s configured Gemini model. No analysis request is made until Analyze source.</p>
          <div className="flex flex-wrap gap-2">
            <button type="button" className={workspaceButton} disabled={!canAnalyze || callsUsed >= MAX_EXTRACTION_CALLS} onClick={() => void startAnalysis(false)}>Analyze source</button>
            {busy && <button type="button" className={workspaceButton} onClick={cancelAnalysis}>Cancel analysis</button>}
            {failedChunks.length > 0 && !busy && <button type="button" className={workspaceButton} disabled={callsUsed >= MAX_EXTRACTION_CALLS} onClick={() => void startAnalysis(true)}>Retry failed segments ({failedChunks.length})</button>}
            {requestError && !busy && <button type="button" className={workspaceButton} disabled={!source || callsUsed >= MAX_EXTRACTION_CALLS} onClick={() => void startAnalysis(false, true)}>Retry with smaller segments</button>}
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
        </section>

        {results.length > 0 && (
          <section className="space-y-4 rounded-lg border border-gray-300 p-4 dark:border-gray-700" aria-labelledby="import-review-title">
            <h2 id="import-review-title" className="font-semibold">3. Review findings</h2>
            <p className="text-sm">
              {analysisComplete ? 'All planned source segments were analyzed.' : `Partial analysis · ${progress}`}. Only confirmed findings enter the canonical graph; unchecked findings remain pending with evidence. Rejected quotes: {rejectedEvidenceCount}. Duplicate names remain separate pending author review.
            </p>
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

            {destination === 'new' && (
              <div className="flex flex-wrap items-center gap-2">
                <label className="text-sm" htmlFor="import-project-name">New project name</label>
                <input id="import-project-name" className="min-w-52 rounded border px-2 py-1 dark:bg-gray-950" value={projectName} onChange={(event) => setProjectName(event.target.value)} />
              </div>
            )}

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
