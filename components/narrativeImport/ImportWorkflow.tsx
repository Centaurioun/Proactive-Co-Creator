import { useEffect, useRef, useState } from 'react';
import { NarrativeExtractionSchema, type NarrativeExtractionRequest } from '../../shared/importSchemas';
import type { CreativeProject } from '../../shared/types';
import { assembleImportedProject } from '../../lib/narrative/import/assembleProject';
import { findPossibleIdentityMatches } from '../../lib/narrative/import/identityResolver';
import { deduplicateChunkProposals, verifyExtractionEvidence, type VerifiedExtraction } from '../../lib/narrative/import/proposalValidator';
import { MAX_IMPORT_CHUNKS, calculateProcessedCoverage, segmentNarrativeSource, type SourceChunk } from '../../lib/narrative/import/segmentation';
import { countNarrativeWords, MAX_RETAINED_ORIGINAL_BYTES, parseNarrativeSource, type ParsedNarrativeSource } from '../../lib/narrative/import/sourceParser';
import { extractNarrativeChunk, isAbortError } from '../../services/apiClient';
import { workspaceButton } from '../manuscript/ManuscriptEditor';

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
  onCreateProject: (project: CreativeProject) => Promise<void>;
  onCancelImport: () => void;
}

export default function ImportWorkflow({ onCreateProject, onCancelImport }: Props) {
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
  const abortRef = useRef<AbortController | null>(null);
  const epochRef = useRef(0);
  const sourceReadEpochRef = useRef(0);
  const inProgressRef = useRef(false);
  const creatingRef = useRef(false);

  useEffect(() => () => {
    sourceReadEpochRef.current += 1;
    epochRef.current += 1;
    abortRef.current?.abort();
  }, []);

  const parsedHasFileRetentionGap = Boolean(file && source?.retention === 'extracted-only');
  const extraction = results.length ? deduplicateChunkProposals(results) : emptyExtraction();
  const identityMatches = findPossibleIdentityMatches(extraction.entities);
  const explicitProposalIds = [
    ...extraction.entities.filter(item => item.kind === 'explicit').map(item => item.id),
    ...extraction.entities.filter(item => item.kind === 'explicit')
      .flatMap(item => item.attributes.filter(attribute => attribute.kind === 'explicit').map(attribute => attribute.id)),
    ...extraction.relationships.filter(item => item.kind === 'explicit').map(item => item.id),
    ...extraction.findings.filter(item => item.kind === 'explicit').map(item => item.id),
  ];
  const analysisComplete = Boolean(source && segmentationComplete && failedChunks.length === 0 &&
    completedChunkIds.size === chunks.length && chunks.length > 0 && !busy);
  const hasIncompleteCoverage = Boolean(source && (!segmentationComplete || failedChunks.length > 0 || completedChunkIds.size !== chunks.length));
  const canAnalyze = Boolean(source && !busy && sourceError === '' &&
    (!parsedHasFileRetentionGap || confirmExtractedOnly) && (scope !== 'selective' || categories.length > 0));
  const canCreate = Boolean(source && results.length > 0 && !busy && (analysisComplete || (hasIncompleteCoverage && allowIncomplete)));

  const resetAnalysis = () => {
    setChunks([]); setSegmentationComplete(false); setResults([]); setCompletedChunkIds(new Set());
    setFailedChunks([]); setRejectedEvidenceCount(0); setCancelled(false); setCallsUsed(0);
    setRequestError(''); setAcceptedIds(new Set()); setRejectedIds(new Set()); setCreateError('');
    setAllowIncomplete(false); setAnalysisConfiguration(null); epochRef.current += 1; abortRef.current?.abort(); abortRef.current = null;
  };

  const previewSource = async () => {
    const readEpoch = ++sourceReadEpochRef.current;
    setSourceError(''); setRequestError(''); setSource(null); resetAnalysis(); setConfirmExtractedOnly(false);
    try {
      let parsed: ParsedNarrativeSource;
      if (file) {
        parsed = await parseNarrativeSource(file, file.name, retainOriginal);
      } else {
        parsed = await parseNarrativeSource(pastedText);
      }
      if (readEpoch !== sourceReadEpochRef.current) return;
      setSource(parsed); setSourceId(crypto.randomUUID());
      setProjectName(file ? file.name.replace(/\.[^.]+$/, '').slice(0, 100) : 'Imported narrative');
    } catch (error) {
      if (readEpoch !== sourceReadEpochRef.current) return;
      setSourceError(error instanceof Error ? error.message : 'The source could not be previewed.');
    }
  };

  const readFile = (next: File | null) => {
    sourceReadEpochRef.current += 1;
    abortRef.current?.abort();
    setFile(next); setSource(null); setSourceError(''); setPastedText('');
    resetAnalysis();
  };

  const startAnalysis = async (retry = false, smallerChunks = false) => {
    if (!source || inProgressRef.current) return;
    const nextCalls = callsUsed;
    const callBudget = 30;
    if (nextCalls >= callBudget) { setRequestError('This import reached its 30-call safety budget. Create an explicitly incomplete project or start a new scoped import.'); return; }
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
        setCallsUsed(value => value + 1);
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
          setResults(previous => [...previous, validated]);
          setCompletedChunkIds(previous => new Set([...previous, chunk.id]));
        } catch (error) {
          if (isAbortError(error) || controller.signal.aborted) { failures.push(...planned.slice(index)); break; }
          failures.push(chunk);
          setRequestError(error instanceof Error ? error.message : 'A source segment could not be analyzed.');
        }
      }
    } finally {
      const aborted = controller.signal.aborted || runEpoch !== epochRef.current;
      if (runEpoch === epochRef.current) {
        setFailedChunks(previous => retry ? [...previous.filter(old => !planned.some(item => item.id === old.id)), ...failures] : failures);
        setCancelled(aborted);
      }
      setBusy(false); inProgressRef.current = false;
      if (abortRef.current === controller) abortRef.current = null;
    }
  };

  const cancelAnalysis = () => { abortRef.current?.abort(); setCancelled(true); };

  const toggleAccepted = (id: string, checked: boolean) => {
    setAcceptedIds(previous => { const next = new Set(previous); if (checked) next.add(id); else next.delete(id); return next; });
    setRejectedIds(previous => { const next = new Set(previous); next.delete(id); return next; });
  };
  const toggleRejected = (id: string, checked: boolean) => {
    setRejectedIds(previous => { const next = new Set(previous); if (checked) next.add(id); else next.delete(id); return next; });
    setAcceptedIds(previous => { const next = new Set(previous); next.delete(id); return next; });
  };

  const createProject = async () => {
    if (!source || !canCreate || creatingRef.current) return;
    creatingRef.current = true;
    setCreating(true); setCreateError('');
    try {
      const processedSpans = calculateProcessedCoverage(chunks.filter(chunk => completedChunkIds.has(chunk.id)));
      const project = assembleImportedProject(source, extraction, identityMatches, {
        sourceId, acceptedIds, rejectedIds, projectName,
        coverage: { complete: analysisComplete, scope: analysisConfiguration?.scope ?? scope,
          categories: (analysisConfiguration?.scope ?? scope) === 'complete' ? allCategories : (analysisConfiguration?.categories ?? categories),
          instruction: analysisConfiguration?.instruction ?? instruction.trim(),
          totalCharacters: source.text.length, processedSpans, failedSegments: failedChunks.length, calls: callsUsed },
      });
      await onCreateProject(project);
    } catch (error) {
      setCreateError(error instanceof Error ? error.message : 'The imported project could not be saved. Your review remains open.');
    } finally { creatingRef.current = false; setCreating(false); }
  };

  const progress = `${completedChunkIds.size} / ${chunks.length} segments analyzed`;
  return (
    <main className="min-h-0 flex-1 overflow-auto p-4 sm:p-6">
      <div className="mx-auto max-w-5xl space-y-5">
        <header className="flex flex-wrap items-center justify-between gap-3">
          <div><h1 className="text-2xl font-bold">Import &amp; Analyze Story</h1><p className="text-sm text-gray-600 dark:text-gray-300">Preview locally. Analysis starts only when you choose Analyze source.</p></div>
          <button type="button" className={workspaceButton} disabled={creating}
            onClick={() => { sourceReadEpochRef.current += 1; epochRef.current += 1; abortRef.current?.abort(); onCancelImport(); }}>Cancel import</button>
        </header>

        <section className="space-y-3 rounded-lg border border-gray-300 p-4 dark:border-gray-700" aria-labelledby="import-source-title">
          <h2 id="import-source-title" className="font-semibold">1. Select source</h2>
          <label className="block text-sm" htmlFor="import-file">Choose a TXT, Markdown, or DOCX file</label>
          <input id="import-file" type="file" accept=".txt,.md,.markdown,.docx" onChange={event => readFile(event.currentTarget.files?.[0] ?? null)} />
          <label className="block text-sm" htmlFor="import-pasted-text">Or paste narrative text</label>
          <textarea id="import-pasted-text" className="min-h-36 w-full rounded border p-2 dark:bg-gray-950" value={pastedText}
            onChange={event => { sourceReadEpochRef.current += 1; setPastedText(event.target.value); if (file) setFile(null); setSource(null); resetAnalysis(); }} placeholder="Paste text to preview locally" />
          {file && <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={retainOriginal} onChange={event => { sourceReadEpochRef.current += 1; setRetainOriginal(event.target.checked); setSource(null); resetAnalysis(); }} />Retain original file bytes in project and portable backup (up to {Math.round(MAX_RETAINED_ORIGINAL_BYTES / 1024 / 1024)} MiB)</label>}
          <button type="button" className={workspaceButton} onClick={() => void previewSource()} disabled={(!file && !pastedText.trim()) || busy}>Preview source</button>
          {sourceError && <p role="alert" className="text-sm text-red-700 dark:text-red-300">{sourceError}</p>}
          {source && <div className="space-y-2 rounded bg-gray-50 p-3 dark:bg-gray-900">
            <p className="font-medium">{source.filename} · {source.text.length.toLocaleString()} characters · {countNarrativeWords(source.text).toLocaleString()} words</p>
            <p className="break-all text-xs">Source SHA-256: {source.digest} · {source.retention === 'original-and-extracted' ? 'Original bytes retained' : 'Extracted text only'}</p>
            {source.warnings.map((warning, index) => <p key={index} className="text-sm text-amber-800 dark:text-amber-200">{warning}</p>)}
            {parsedHasFileRetentionGap && <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={confirmExtractedOnly} onChange={event => setConfirmExtractedOnly(event.target.checked)} />I understand this import will not preserve the original file bytes.</label>}
            <details><summary>Extracted text preview</summary><pre className="max-h-72 overflow-auto whitespace-pre-wrap break-words">{source.text.slice(0, 12_000)}{source.text.length > 12_000 ? '\n… preview shortened; full source remains available to the import pipeline.' : ''}</pre></details>
            {source.blocks.some(block => block.kind === 'heading') && <p className="text-sm">Detected {source.blocks.filter(block => block.kind === 'heading').length} source heading(s). Plain text structure is not inferred.</p>}
          </div>}
        </section>

        <section className="space-y-3 rounded-lg border border-gray-300 p-4 dark:border-gray-700" aria-labelledby="import-config-title">
          <h2 id="import-config-title" className="font-semibold">2. Configure import</h2>
          <fieldset className="space-y-2"><legend className="text-sm font-medium">Reconstruction strategy</legend>
            <label className="flex gap-2"><input type="radio" name="import-strategy" checked={strategy === 'faithful'} onChange={() => setStrategy('faithful')} />Faithful Reconstruction (default)</label>
            <label className="flex gap-2"><input type="radio" name="import-strategy" checked={strategy === 'enhance'} onChange={() => setStrategy('enhance')} />Reconstruct &amp; Enhance</label>
            {strategy === 'enhance' && <p className="text-sm text-amber-800 dark:text-amber-200">This phase still performs faithful extraction only. Reviewable creative enhancement and correction proposals are not available yet.</p>}
          </fieldset>
          <fieldset className="space-y-2"><legend className="text-sm font-medium">Extraction scope</legend>
            <label className="flex gap-2"><input type="radio" name="import-scope" checked={scope === 'complete'} onChange={() => { resetAnalysis(); setScope('complete'); }} />Complete extraction</label>
            <label className="flex gap-2"><input type="radio" name="import-scope" checked={scope === 'selective'} onChange={() => { resetAnalysis(); setScope('selective'); }} />Selective extraction</label>
            {scope === 'selective' && <div className="grid gap-2 sm:grid-cols-2">{categoryOptions.map(([id, label]) => <label key={id} className="flex gap-2"><input type="checkbox" checked={categories.includes(id)} onChange={event => {
              resetAnalysis();
              setCategories(previous => event.target.checked ? [...new Set([...previous, id])] : previous.filter(item => item !== id));
            }} />{label}</label>)}</div>}
          </fieldset>
          <label className="block text-sm" htmlFor="import-instructions">Optional import-specific guidance (cannot override faithful extraction)</label>
          <textarea id="import-instructions" className="min-h-20 w-full rounded border p-2 dark:bg-gray-950" maxLength={1000} value={instruction} onChange={event => { resetAnalysis(); setInstruction(event.target.value); }} />
          <p className="text-sm">Analysis sends selected source segments to the app’s configured Gemini model. The provider may charge the configured account. No analysis request is made until Analyze source.</p>
          <div className="flex flex-wrap gap-2">
            <button type="button" className={workspaceButton} disabled={!canAnalyze || callsUsed >= 30} onClick={() => void startAnalysis(false)}>Analyze source</button>
            {busy && <button type="button" className={workspaceButton} onClick={cancelAnalysis}>Cancel analysis</button>}
            {failedChunks.length > 0 && !busy && <button type="button" className={workspaceButton} disabled={callsUsed >= 30} onClick={() => void startAnalysis(true)}>Retry failed segments ({failedChunks.length})</button>}
            {requestError && !busy && <button type="button" className={workspaceButton} disabled={!source || callsUsed >= 30} onClick={() => void startAnalysis(false, true)}>Retry with smaller segments</button>}
          </div>
          {busy && <p role="status" aria-live="polite">{progress} · {callsUsed}/30 requests used</p>}
          {cancelled && <p className="text-sm">Analysis was cancelled. Completed segment results remain available for review.</p>}
          {requestError && <p role="alert" className="text-sm text-red-700 dark:text-red-300">{requestError}</p>}
          {hasIncompleteCoverage && !busy && chunks.length > 0 && <div className="space-y-2 rounded bg-amber-50 p-3 dark:bg-amber-950">
            <p>Coverage is incomplete: {progress}. Unprocessed source remains visible in the original. Create Project stays disabled unless you explicitly approve an incomplete import.</p>
            <label className="flex gap-2"><input type="checkbox" checked={allowIncomplete} onChange={event => setAllowIncomplete(event.target.checked)} />Create an explicitly incomplete import with the unprocessed segment coverage recorded</label>
          </div>}
        </section>

        {results.length > 0 && <section className="space-y-4 rounded-lg border border-gray-300 p-4 dark:border-gray-700" aria-labelledby="import-review-title">
          <h2 id="import-review-title" className="font-semibold">3. Review findings</h2>
          <p className="text-sm">{analysisComplete ? 'All planned source segments were analyzed.' : `Partial analysis · ${progress}`}. Only confirmed findings enter the canonical graph; unchecked findings remain pending with evidence. Rejected quotes: {rejectedEvidenceCount}. Duplicate names remain separate pending author review.</p>
          <button type="button" className={workspaceButton} disabled={explicitProposalIds.length === 0 || creating}
            onClick={() => { setAcceptedIds(previous => new Set([...previous, ...explicitProposalIds])); setRejectedIds(previous => new Set([...previous].filter(id => !explicitProposalIds.includes(id)))); }}>
            Accept evidence-backed explicit findings ({explicitProposalIds.length})
          </button>
          <div className="flex flex-wrap gap-2">
            <label className="text-sm" htmlFor="import-project-name">New project name</label>
            <input id="import-project-name" className="min-w-52 rounded border px-2 py-1 dark:bg-gray-950" value={projectName} onChange={event => setProjectName(event.target.value)} />
          </div>
          <div className="max-h-[55vh] space-y-3 overflow-auto">
            <h3 className="font-medium">Entities and attributes ({extraction.entities.length})</h3>
            {extraction.entities.map(entity => <article key={entity.id} className="rounded border p-3">
              <label className="flex gap-2 font-medium"><input type="checkbox" checked={acceptedIds.has(entity.id)} onChange={event => toggleAccepted(entity.id, event.target.checked)} />{entity.name} · {entity.category} · {entity.kind}</label>
              <p>{entity.description || entity.rationale}</p><EvidenceQuote evidence={entity.evidence} />
              {entity.attributes.map(attribute => <div key={attribute.id} className="ml-4 mt-2 border-l pl-3">
                <label className="flex gap-2"><input type="checkbox" checked={acceptedIds.has(attribute.id)} disabled={!acceptedIds.has(entity.id)} onChange={event => toggleAccepted(attribute.id, event.target.checked)} />{attribute.name}: {attribute.value} · {attribute.kind}</label>
                <EvidenceQuote evidence={attribute.evidence} />
              </div>)}
            </article>)}
            <h3 className="font-medium">Directed relationships ({extraction.relationships.length})</h3>
            {extraction.relationships.map(relation => <article key={relation.id} className="rounded border p-3">
              <label className="flex gap-2"><input type="checkbox" checked={acceptedIds.has(relation.id)} onChange={event => toggleAccepted(relation.id, event.target.checked)} />{relation.source} → {relation.target} · {relation.label} · {relation.kind}</label>
              <p>{relation.rationale}</p><EvidenceQuote evidence={relation.evidence} />
            </article>)}
            <h3 className="font-medium">Other findings ({extraction.findings.length})</h3>
            {extraction.findings.map(finding => <article key={finding.id} className="rounded border p-3">
              <label className="flex gap-2"><input type="checkbox" checked={acceptedIds.has(finding.id)} onChange={event => toggleAccepted(finding.id, event.target.checked)} />{finding.title}: {finding.value} · {finding.kind}</label>
              <p>{finding.rationale}</p><EvidenceQuote evidence={finding.evidence} />
              <button type="button" className="text-sm underline" onClick={() => toggleRejected(finding.id, !rejectedIds.has(finding.id))}>{rejectedIds.has(finding.id) ? 'Mark pending' : 'Reject finding'}</button>
            </article>)}
            <h3 className="font-medium">Ambiguities and possible issues ({extraction.ambiguities.length})</h3>
            {extraction.ambiguities.map(issue => <article key={issue.id} className="rounded border border-amber-400 p-3">
              <p className="font-medium">{issue.title} · {issue.certainty}</p><p>{issue.detail}</p><p>{issue.rationale}</p>
              <EvidenceQuote evidence={issue.evidence} />
            </article>)}
            {identityMatches.map(match => <p key={`${match.leftId}:${match.rightId}`} className="rounded border border-amber-400 p-3">Possible same identity: {match.matchedName}. The two proposals remain separate; the resulting issue will require clarification.</p>)}
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <button type="button" className={workspaceButton} disabled={!canCreate || creating || !projectName.trim()} onClick={() => void createProject()}>{creating ? 'Creating project…' : 'Create Project'}</button>
            {createError && <p role="alert" className="text-sm text-red-700 dark:text-red-300">{createError}</p>}
          </div>
        </section>}
      </div>
    </main>
  );
}

function EvidenceQuote({ evidence }: { evidence: VerifiedExtraction['findings'][number]['evidence'] }) {
  return <blockquote className="whitespace-pre-wrap break-words border-l-2 pl-3 text-sm">
    <span>{evidence.excerpt}</span>
    <span className="mt-1 block text-xs text-gray-600 dark:text-gray-400">Source characters {evidence.start}–{evidence.end} · {evidence.sourceId.slice(0, 8)} · {evidence.version}</span>
  </blockquote>;
}
