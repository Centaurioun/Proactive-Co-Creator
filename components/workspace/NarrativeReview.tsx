import { useEffect, useMemo, useRef, useState } from 'react';
import type { ConsistencyIssue, ConsistencyIssueTarget, CreativeProject } from '../../shared/types';
import type { NarrativeIssue, NarrativeRecords } from '../../shared/narrativeTypes';
import type {
  DiagnosticFixAlternative,
  DiagnosticsAnalyzeRequest,
  DiagnosticsAnalyzeResponse,
  SyncManuscriptPatch,
  SyncModelProposal,
} from '../../shared/narrativeAiSchemas';
import { buildClientBudgetDisclosure } from '../../lib/narrative/aiBudgetClient';
import {
  buildLocalFixAlternatives,
  splitReadinessAndIssues,
} from '../../lib/narrative/diagnostics/engine';
import { computeSnapshotDigest } from '../../lib/historyEngine';
import { manuscriptSections } from '../../lib/narrative/manuscriptModel';
import {
  computeSyncFreshness,
  validateManuscriptPatchBinding,
} from '../../lib/narrative/sync/syncProposals';
import {
  requestDiagnosticFixSuggestions,
  requestNarrativeSyncAnalysis,
} from '../../services/apiClient';
import { workspaceButton } from '../manuscript/ManuscriptEditor';

interface Props {
  project: CreativeProject;
  checks: ConsistencyIssue[];
  aiConfigured?: boolean;
  openChecks: () => void;
  openHistory: () => void;
  openOutput: () => void;
  openOpportunities?: () => void;
  exportReport: (format: 'json' | 'md') => void;
  onIssueDisposition: (issueId: string, disposition: NarrativeIssue['disposition'], reason: string) => void;
  onRunLocalDiagnostics?: () => void;
  onRunSemanticDiagnostics?: (
    payload: DiagnosticsAnalyzeRequest,
    context: { manuscriptVersionId?: string; snapshotDigest: string; scopeLabel: string },
    signal: AbortSignal,
  ) => Promise<DiagnosticsAnalyzeResponse | null>;
  onApplyDiagnosticFix?: (
    issueId: string,
    alternative: DiagnosticFixAlternative,
    expectedBaseRevision: number
  ) => Promise<{ ok: boolean; message: string }>;
  onNavigateTarget?: (target: ConsistencyIssueTarget) => void;
  onApplyModelSyncProposal?: (
    proposal: SyncModelProposal,
    expectedBaseRevision: number
  ) => Promise<{ ok: boolean; message: string }>;
  onApplyManuscriptSyncPatch?: (
    patch: SyncManuscriptPatch,
    expectedBaseRevision: number,
    expectedManuscriptVersionId?: string
  ) => Promise<{ ok: boolean; message: string }>;
  onRecordSyncCheckpoint?: (direction: 'manuscript-to-model' | 'model-to-manuscript', coverageNote: string) => void;
  onUpdateAutomationPreferences?: (prefs: NonNullable<NarrativeRecords['automationPreferences']>) => void;
  autoAnalysisCallsUsed?: number;
}

export default function NarrativeReview({
  project,
  checks,
  aiConfigured = false,
  openChecks,
  openHistory,
  openOutput,
  openOpportunities,
  exportReport,
  onIssueDisposition,
  onRunLocalDiagnostics,
  onRunSemanticDiagnostics,
  onApplyDiagnosticFix,
  onNavigateTarget,
  onApplyModelSyncProposal,
  onApplyManuscriptSyncPatch,
  onRecordSyncCheckpoint,
  onUpdateAutomationPreferences,
  autoAnalysisCallsUsed = 0,
}: Props) {
  const [reasons, setReasons] = useState<Record<string, string>>({});
  const [dispositionFilter, setDispositionFilter] = useState<'all' | NarrativeIssue['disposition']>('all');
  const [diagScope, setDiagScope] = useState<'full' | 'scene' | 'entity' | 'changed'>('full');
  const [diagTargetId, setDiagTargetId] = useState('');
  const [diagBusy, setDiagBusy] = useState(false);
  const diagnosticRun = useRef<AbortController | null>(null);
  useEffect(() => () => {
    diagnosticRun.current?.abort();
  }, [project.id]);
  const [diagMessage, setDiagMessage] = useState('');
  const [diagError, setDiagError] = useState('');

  // Fix suggestions per issue
  const [fixPanelIssueId, setFixPanelIssueId] = useState<string | null>(null);
  const [fixAlternativesByIssue, setFixAlternativesByIssue] = useState<
    Record<string, { baseRevision: number; alternatives: DiagnosticFixAlternative[] }>
  >({});
  const [fixLoadingId, setFixLoadingId] = useState<string | null>(null);
  const [fixStatusMessage, setFixStatusMessage] = useState('');
  const [fixError, setFixError] = useState('');

  // Manuscript <-> Model Sync state
  const [syncDirection, setSyncDirection] = useState<'manuscript-to-model' | 'model-to-manuscript'>('manuscript-to-model');
  const [syncBusy, setSyncBusy] = useState(false);
  const [syncError, setSyncError] = useState('');
  const [syncMessage, setSyncMessage] = useState('');
  const [syncResult, setSyncResult] = useState<{
    baseRevision: number;
    manuscriptVersionId?: string;
    direction: 'manuscript-to-model' | 'model-to-manuscript';
    coverageNote: string;
    modelProposals: SyncModelProposal[];
    manuscriptPatches: SyncManuscriptPatch[];
  } | null>(null);

  const { issues = [], claims = [], audit = [], sources = [], proposals = [] } = project.narrative ?? {};
  const sections = useMemo(() => manuscriptSections(project), [project]);
  const { readiness, consistencyIssues } = useMemo(() => splitReadinessAndIssues(checks), [checks]);
  const syncFreshness = useMemo(() => computeSyncFreshness(project), [project]);

  const autoPrefs = project.narrative?.automationPreferences ?? {
    semanticAutoAnalysisEnabled: false,
    scope: 'changed' as const,
    maxCallsPerSession: 4,
    maxTokensPerRun: 10_000,
    paused: false,
  };

  const compactModelPayload = useMemo(() => {
    const entities = project.snapshot.entities
      .filter((e) => e.category !== 'scene' && e.epistemicKind !== 'belief' && e.epistemicKind !== 'reported')
      .slice(0, 60)
      .map((e) => ({
        id: e.id ?? e.name,
        name: e.name,
        category: e.category,
        description: e.description?.slice(0, 400),
        excluded: e.excluded,
        status: e.status,
        attributes: e.attributes
          .filter((a) => a.epistemicKind !== 'belief' && a.epistemicKind !== 'reported')
          .slice(0, 20)
          .map((a) => ({ id: a.id, name: a.name, value: a.confirmedValue ?? a.value[0]?.name ?? '', status: a.status })),
      }));
    const relationships = project.snapshot.relationships.slice(0, 80).map((r) => ({
      id: r.id,
      sourceId: r.sourceId,
      targetId: r.targetId,
      source: r.source,
      target: r.target,
      label: r.label,
      status: r.status,
    }));
    const storyBible: Record<string, string> = {};
    for (const [k, f] of Object.entries(project.snapshot.storyBible)) {
      if (f.value.trim()) storyBible[k] = f.value.trim().slice(0, 600);
    }
    return { entities, relationships, storyBible };
  }, [project.snapshot]);

  const scopedDiagPayload = useMemo(() => {
    const scopedSections =
      diagScope === 'scene' && diagTargetId
        ? sections.filter((s) => s.id === diagTargetId)
        : sections.slice(0, 8);
    return {
      projectId: project.id,
      baseRevision: project.revision,
      scope: diagScope,
      ...(diagTargetId ? { scopeTargetId: diagTargetId } : {}),
      ...compactModelPayload,
      sections: scopedSections.map((s) => ({
        id: s.id,
        title: s.title || s.kind,
        kind: s.kind,
        text: s.text.slice(0, 5_000),
      })),
    };
  }, [project.id, project.revision, diagScope, diagTargetId, compactModelPayload, sections]);

  const diagBudget = useMemo(
    () => buildClientBudgetDisclosure('diagnostics', `Semantic Diagnostics (${diagScope})`, scopedDiagPayload),
    [scopedDiagPayload, diagScope]
  );

  const syncPayload = useMemo(() => {
    const scopedSections = sections.slice(0, 8).map((s) => ({
      id: s.id,
      title: s.title || s.kind,
      kind: s.kind,
      text: s.text.slice(0, 5_000),
    }));
    return {
      direction: syncDirection,
      projectId: project.id,
      baseRevision: project.revision,
      manuscriptVersionId: project.snapshot.manuscriptVersionId,
      sections: scopedSections,
      ...compactModelPayload,
    };
  }, [syncDirection, project.id, project.revision, project.snapshot.manuscriptVersionId, sections, compactModelPayload]);

  const syncBudget = useMemo(
    () => buildClientBudgetDisclosure('sync', `Sync (${syncDirection})`, syncPayload),
    [syncPayload, syncDirection]
  );

  const runSemanticDiagnostics = async () => {
    if (!aiConfigured) {
      setDiagError('Server Gemini API key is not configured. Use Run Local Checks or configure server AI credentials.');
      return;
    }
    if (!onRunSemanticDiagnostics) return;
    diagnosticRun.current?.abort();
    const run = new AbortController();
    diagnosticRun.current = run;
    setDiagBusy(true);
    setDiagError('');
    setDiagMessage('');
    try {
      const response = await onRunSemanticDiagnostics(scopedDiagPayload, {
        manuscriptVersionId: project.snapshot.manuscriptVersionId,
        snapshotDigest: computeSnapshotDigest(project.snapshot),
        scopeLabel: `AI Semantic (${diagScope})`,
      }, run.signal);
      if (!response || run.signal.aborted || diagnosticRun.current !== run) return;
      setDiagMessage(`${response.coverageNote} Recorded ${response.findings.length} semantic finding(s).`);
    } catch (cause) {
      if (!run.signal.aborted && diagnosticRun.current === run) {
        setDiagError(cause instanceof Error ? cause.message : 'Semantic consistency analysis failed.');
      }
    } finally {
      if (!run.signal.aborted && diagnosticRun.current === run) {
        diagnosticRun.current = null;
        setDiagBusy(false);
      }
    }
  };

  const resetDiagnosticScope = () => {
    diagnosticRun.current?.abort();
    diagnosticRun.current = null;
    setDiagBusy(false);
    setDiagError('');
    setDiagMessage('');
  };

  const openFixesForIssue = (issue: NarrativeIssue) => {
    setFixPanelIssueId(issue.id);
    setFixError('');
    setFixStatusMessage('');
    const localAlts = buildLocalFixAlternatives(project, issue);
    setFixAlternativesByIssue((prev) => ({
      ...prev,
      [issue.id]: {
        baseRevision: project.revision,
        alternatives: localAlts,
      },
    }));
  };

  const requestAiFixesForIssue = async (issue: NarrativeIssue) => {
    if (!aiConfigured) {
      setFixError('Server Gemini API key is not configured. Deterministic local fixes remain available above.');
      return;
    }
    setFixLoadingId(issue.id);
    setFixError('');
    setFixStatusMessage('');
    try {
      const response = await requestDiagnosticFixSuggestions({
        projectId: project.id,
        baseRevision: project.revision,
        issue: {
          id: issue.id,
          title: issue.title,
          description: issue.reason,
          category: issue.category,
          targetId: issue.affectedTargetIds?.[0],
        },
        ...compactModelPayload,
        sections: sections.slice(0, 4).map((s) => ({
          id: s.id,
          title: s.title || s.kind,
          kind: s.kind,
          text: s.text.slice(0, 4_000),
        })),
      });
      setFixAlternativesByIssue((prev) => ({
        ...prev,
        [issue.id]: {
          baseRevision: project.revision,
          alternatives: response.alternatives,
        },
      }));
      setFixStatusMessage(`Loaded ${response.alternatives.length} reviewable AI fix alternative(s). Nothing has been applied.`);
    } catch (cause) {
      setFixError(cause instanceof Error ? cause.message : 'Could not fetch AI fix alternatives.');
    } finally {
      setFixLoadingId(null);
    }
  };

  const runSyncAnalysis = async () => {
    if (sections.length === 0) {
      setSyncError('Add or import at least one Working Manuscript section before running sync.');
      return;
    }
    if (!aiConfigured) {
      setSyncError('Server Gemini API key is not configured. Manuscript ↔ Model AI sync requires server credentials.');
      return;
    }
    setSyncBusy(true);
    setSyncError('');
    setSyncMessage('');
    try {
      const response = await requestNarrativeSyncAnalysis(syncPayload);
      setSyncResult({
        baseRevision: project.revision,
        manuscriptVersionId: project.snapshot.manuscriptVersionId,
        direction: response.direction,
        coverageNote: response.coverageNote,
        modelProposals: response.modelProposals,
        manuscriptPatches: response.manuscriptPatches,
      });
      onRecordSyncCheckpoint?.(response.direction, response.coverageNote);
      setSyncMessage(response.coverageNote);
    } catch (cause) {
      setSyncError(cause instanceof Error ? cause.message : 'Sync analysis failed.');
    } finally {
      setSyncBusy(false);
    }
  };

  const filteredIssues = issues.filter(
    (issue) => dispositionFilter === 'all' || issue.disposition === dispositionFilter
  );

  const navigateIssueTarget = (targetId: string) => {
    if (!onNavigateTarget) return;
    if (targetId.startsWith('story_bible:')) {
      const field = targetId.slice('story_bible:'.length) as keyof CreativeProject['snapshot']['storyBible'];
      onNavigateTarget({ id: targetId, kind: 'story_bible', label: field, storyField: field });
      return;
    }
    if (sections.some((s) => s.id === targetId)) {
      onNavigateTarget({ id: targetId, kind: 'section', label: 'Open scene', sectionId: targetId });
      return;
    }
    if (project.snapshot.relationships.some((r) => r.id === targetId)) {
      onNavigateTarget({ id: targetId, kind: 'relationship', label: 'Open relationship', relationshipId: targetId });
      return;
    }
    onNavigateTarget({ id: targetId, kind: 'entity', label: 'Open entity', entityId: targetId });
  };

  return (
    <main className="min-h-0 flex-1 overflow-auto p-4 sm:p-6">
      <div className="mx-auto max-w-5xl space-y-6">
        <header className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="text-2xl font-bold">Review &amp; Diagnostics</h1>
            <p className="text-sm text-gray-600 dark:text-gray-300">
              Revision #{project.revision} · {consistencyIssues.length} local conflict(s) · {readiness.length} readiness reminder(s) · {issues.length} tracked issue(s)
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <button type="button" className={workspaceButton} onClick={openChecks}>Plan Checks ({consistencyIssues.length})</button>
            {openOpportunities && (
              <button type="button" className={workspaceButton} onClick={openOpportunities}>Creative Opportunities</button>
            )}
            <button type="button" className={workspaceButton} onClick={openHistory}>Revision History</button>
            <button type="button" className={workspaceButton} onClick={openOutput}>Output Gallery</button>
          </div>
        </header>

        {/* Package C: Narrative Diagnostics & Safe Fixes */}
        <section aria-labelledby="diagnostics-heading" className="space-y-4 rounded-lg border border-gray-300 p-4 dark:border-gray-700">
          <div className="flex flex-wrap items-start justify-between gap-2">
            <div>
              <h2 id="diagnostics-heading" className="font-semibold text-base">Narrative Diagnostics &amp; Safe Fixes</h2>
              <p className="text-xs text-gray-600 dark:text-gray-400">
                Run local structural checks anytime without network calls, or explicitly run scoped AI semantic analysis with preflight budget disclosure.
              </p>
            </div>
            {onRunLocalDiagnostics && (
              <button type="button" className={workspaceButton} onClick={() => { onRunLocalDiagnostics(); setDiagMessage('Local deterministic checks synced into tracked issues.'); }}>
                Run Local Checks
              </button>
            )}
          </div>

          {readiness.length > 0 && (
            <div className="rounded border border-blue-200 bg-blue-50/40 p-3 text-xs space-y-1 dark:border-blue-900/60 dark:bg-blue-950/20">
              <h3 className="font-semibold text-blue-900 dark:text-blue-200">Project Readiness Checklist ({readiness.length})</h3>
              <p className="text-blue-800/80 dark:text-blue-300/80">Optional setup reminders kept separate from actual continuity conflicts.</p>
              <ul className="list-disc pl-5 space-y-0.5">
                {readiness.map((item) => (
                  <li key={item.id}>{item.title} — {item.description}</li>
                ))}
              </ul>
            </div>
          )}

          {/* Explicit AI Semantic Analysis Controls */}
          <div className="rounded border border-gray-200 bg-gray-50/70 p-3 space-y-2.5 text-xs dark:border-gray-800 dark:bg-gray-900/60">
            <h3 className="font-semibold">Analyze Consistency (AI Semantic Pass)</h3>
            {!aiConfigured && (
              <p role="status" className="rounded border border-amber-300 bg-amber-50 p-2 text-amber-900 dark:border-amber-800 dark:bg-amber-950/50 dark:text-amber-200">
                Server Gemini API key is not configured. Local deterministic checks and local fixes remain fully functional.
              </p>
            )}
            <div className="flex flex-wrap items-end gap-2">
              <label className="space-y-1">
                <span className="block font-medium">Scope</span>
                <select
                  value={diagScope}
                  onChange={(e) => {
                    resetDiagnosticScope();
                    setDiagScope(e.target.value as typeof diagScope);
                    setDiagTargetId('');
                  }}
                  className="rounded border border-gray-300 bg-white px-2 py-1 text-xs dark:border-gray-700 dark:bg-gray-950"
                >
                  <option value="full">Full Project</option>
                  <option value="changed">Changed Scope</option>
                  <option value="scene" disabled={sections.length === 0}>Single Scene</option>
                  <option value="entity" disabled={project.snapshot.entities.length === 0}>Single Entity</option>
                </select>
              </label>
              {diagScope === 'scene' && (
                <label className="space-y-1">
                  <span className="block font-medium">Scene</span>
                  <select value={diagTargetId} onChange={(e) => { resetDiagnosticScope(); setDiagTargetId(e.target.value); }} className="rounded border border-gray-300 bg-white px-2 py-1 text-xs dark:border-gray-700 dark:bg-gray-950">
                    <option value="">Select scene…</option>
                    {sections.map((s) => <option key={s.id} value={s.id}>{s.title || s.kind}</option>)}
                  </select>
                </label>
              )}
              {diagScope === 'entity' && (
                <label className="space-y-1">
                  <span className="block font-medium">Entity</span>
                  <select value={diagTargetId} onChange={(e) => { resetDiagnosticScope(); setDiagTargetId(e.target.value); }} className="rounded border border-gray-300 bg-white px-2 py-1 text-xs dark:border-gray-700 dark:bg-gray-950">
                    <option value="">Select entity…</option>
                    {project.snapshot.entities.filter((e) => e.category !== 'scene').map((e) => (
                      <option key={e.id ?? e.name} value={e.id ?? e.name}>{e.name}</option>
                    ))}
                  </select>
                </label>
              )}
              <button
                type="button"
                disabled={diagBusy || !aiConfigured || !diagBudget.withinLimit || ((diagScope === 'scene' || diagScope === 'entity') && !diagTargetId)}
                onClick={() => void runSemanticDiagnostics()}
                className="rounded bg-blue-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-blue-700 disabled:opacity-45"
              >
                {diagBusy ? 'Analyzing…' : 'Analyze Consistency with AI'}
              </button>
            </div>
            <p className="text-[11px] text-gray-600 dark:text-gray-400 tabular-nums">
              Preflight: {diagBudget.inputChars.toLocaleString()} / {diagBudget.maxInputChars.toLocaleString()} chars · ~{diagBudget.estimatedInputTokens.toLocaleString()} / {diagBudget.maxInputTokens.toLocaleString()} est. tokens.
            </p>
            {diagBudget.warning && <p role="alert" className="text-amber-800 dark:text-amber-300">{diagBudget.warning}</p>}
            {diagError && <p role="alert" className="text-red-700 dark:text-red-300">{diagError}</p>}
            {diagMessage && <p role="status" className="text-emerald-700 dark:text-emerald-300">{diagMessage}</p>}
          </div>

          {/* Tracked Issues Registry */}
          <div className="space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h3 className="font-semibold text-sm">Tracked Continuity Issues ({filteredIssues.length} of {issues.length})</h3>
              <select
                aria-label="Filter tracked issues by disposition"
                value={dispositionFilter}
                onChange={(e) => setDispositionFilter(e.target.value as typeof dispositionFilter)}
                className="rounded border border-gray-300 bg-white px-2 py-1 text-xs dark:border-gray-700 dark:bg-gray-950"
              >
                <option value="all">All dispositions</option>
                <option value="open">Open</option>
                <option value="deferred">Deferred</option>
                <option value="needs-clarification">Needs clarification</option>
                <option value="intentional">Intentional</option>
                <option value="resolved">Resolved</option>
                <option value="dismissed">Dismissed</option>
              </select>
            </div>

            {fixError && <p role="alert" className="text-xs text-red-700 dark:text-red-300">{fixError}</p>}
            {fixStatusMessage && <p role="status" className="text-xs text-emerald-700 dark:text-emerald-300">{fixStatusMessage}</p>}

            {filteredIssues.length === 0 ? (
              <p className="text-xs text-gray-500">No tracked issues match this filter. Click &ldquo;Run Local Checks&rdquo; to register any current conflicts.</p>
            ) : (
              filteredIssues.map((issue) => {
                const fixEntry = fixAlternativesByIssue[issue.id];
                const fixesStale = Boolean(fixEntry && fixEntry.baseRevision !== project.revision);
                return (
                  <article key={issue.id} className="space-y-2 rounded border border-gray-300 p-3 text-xs dark:border-gray-700">
                    <div className="flex flex-wrap items-start justify-between gap-2">
                      <div>
                        <h4 className="font-semibold text-sm">{issue.title}</h4>
                        <div className="mt-0.5 flex flex-wrap gap-1.5 text-[11px]">
                          <span className="rounded bg-gray-100 px-1.5 py-0.5 capitalize dark:bg-gray-800">{issue.disposition}</span>
                          {issue.severity && <span className="rounded bg-red-100 px-1.5 py-0.5 uppercase text-red-800 dark:bg-red-950 dark:text-red-300">Severity: {issue.severity}</span>}
                          {issue.certainty && <span className="rounded bg-amber-100 px-1.5 py-0.5 capitalize text-amber-800 dark:bg-amber-950 dark:text-amber-300">Certainty: {issue.certainty}</span>}
                          <span className="rounded bg-blue-50 px-1.5 py-0.5 text-blue-800 dark:bg-blue-950 dark:text-blue-300">{issue.source === 'semantic-ai' ? 'AI Semantic' : 'Local Check'}</span>
                          <span className="text-gray-500">{issue.freshness}{issue.scopeLabel ? ` · ${issue.scopeLabel}` : ''}</span>
                        </div>
                      </div>
                      <div className="flex flex-wrap gap-1.5">
                        <button type="button" className={workspaceButton} onClick={() => openFixesForIssue(issue)}>
                          Suggest Fixes
                        </button>
                      </div>
                    </div>

                    <p className="text-gray-700 dark:text-gray-300">{issue.reason}</p>

                    {issue.affectedTargetIds && issue.affectedTargetIds.length > 0 && onNavigateTarget && (
                      <div className="flex flex-wrap gap-1.5">
                        {issue.affectedTargetIds.map((tid) => (
                          <button
                            key={tid}
                            type="button"
                            onClick={() => navigateIssueTarget(tid)}
                            className="rounded border border-blue-300 bg-white px-2 py-0.5 text-[11px] font-semibold text-blue-700 hover:bg-blue-50 dark:border-blue-800 dark:bg-gray-900 dark:text-blue-300"
                          >
                            Jump to {tid.startsWith('story_bible:') ? `Story Bible (${tid.slice(12)})` : tid.slice(0, 18)}
                          </button>
                        ))}
                      </div>
                    )}

                    {issue.anchors.map((anchor, index) => (
                      <blockquote key={index} className="whitespace-pre-wrap break-words border-l-2 pl-3">
                        {anchor.excerpt}
                        <span className="mt-1 block text-[11px] text-gray-600 dark:text-gray-400">
                          Characters {anchor.start}–{anchor.end} · {anchor.sourceId.slice(0, 8)} · {anchor.version}
                        </span>
                      </blockquote>
                    ))}

                    {/* Fix Suggestions Panel */}
                    {fixPanelIssueId === issue.id && (
                      <div className="rounded border border-indigo-200 bg-indigo-50/30 p-3 space-y-2.5 dark:border-indigo-900/60 dark:bg-indigo-950/20">
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <h5 className="font-semibold text-indigo-900 dark:text-indigo-200">
                            Safe Fix Alternatives (Review Before Applying)
                          </h5>
                          <div className="flex gap-2">
                            <button
                              type="button"
                              disabled={!aiConfigured || fixLoadingId === issue.id}
                              onClick={() => void requestAiFixesForIssue(issue)}
                              className="rounded bg-indigo-600 px-2.5 py-1 text-[11px] font-semibold text-white hover:bg-indigo-700 disabled:opacity-45"
                            >
                              {fixLoadingId === issue.id ? 'Fetching AI fixes…' : 'Suggest AI Fixes'}
                            </button>
                            <button type="button" className="underline text-[11px]" onClick={() => setFixPanelIssueId(null)}>
                              Close
                            </button>
                          </div>
                        </div>
                        {fixesStale && (
                          <p role="alert" className="text-amber-800 dark:text-amber-200">
                            Project revision changed since these fixes were previewed. Re-open Suggest Fixes to refresh.
                          </p>
                        )}
                        {(!fixEntry || fixEntry.alternatives.length === 0) ? (
                          <p className="text-gray-600 dark:text-gray-300">
                            No automatic deterministic fix matches this issue. Use &ldquo;Suggest AI Fixes&rdquo; (when AI is configured) or resolve manually via the Jump-to-Target link above.
                          </p>
                        ) : (
                          fixEntry.alternatives.map((alt) => (
                            <div key={alt.id} className="rounded border border-gray-300 bg-white p-2.5 space-y-1.5 dark:border-gray-700 dark:bg-gray-900">
                              <div className="flex flex-wrap items-center justify-between gap-2">
                                <span className="font-semibold">{alt.title}</span>
                                <span className="text-[11px] text-gray-500">{alt.affectedScope}</span>
                              </div>
                              <p>{alt.reason}</p>
                              {alt.evidenceSummary && <p className="text-[11px] text-gray-600 dark:text-gray-400">Evidence: {alt.evidenceSummary}</p>}
                              {alt.assumptions.length > 0 && <p className="text-[11px] text-gray-500">Assumptions: {alt.assumptions.join('; ')}</p>}
                              <div className="grid gap-2 sm:grid-cols-2">
                                <div className="rounded border border-red-200 bg-red-50/40 p-2 dark:border-red-900/60 dark:bg-red-950/20">
                                  <div className="font-semibold text-[11px] text-red-800 dark:text-red-300">Before</div>
                                  <pre className="whitespace-pre-wrap break-words font-mono text-[11px]">{alt.beforeText}</pre>
                                </div>
                                <div className="rounded border border-emerald-200 bg-emerald-50/40 p-2 dark:border-emerald-900/60 dark:bg-emerald-950/20">
                                  <div className="font-semibold text-[11px] text-emerald-800 dark:text-emerald-300">After</div>
                                  <pre className="whitespace-pre-wrap break-words font-mono text-[11px]">{alt.afterText}</pre>
                                </div>
                              </div>
                              {alt.kind !== 'manual_guidance' && onApplyDiagnosticFix && (
                                <button
                                  type="button"
                                  disabled={fixesStale}
                                  onClick={async () => {
                                    const res = await onApplyDiagnosticFix(issue.id, alt, fixEntry.baseRevision);
                                    if (res.ok) {
                                      setFixStatusMessage(res.message);
                                      setFixError('');
                                      setFixPanelIssueId(null);
                                    } else {
                                      setFixError(res.message);
                                    }
                                  }}
                                  className="rounded bg-emerald-600 px-2.5 py-1 text-[11px] font-semibold text-white hover:bg-emerald-700 disabled:opacity-45"
                                >
                                  Apply Selected Fix
                                </button>
                              )}
                            </div>
                          ))
                        )}
                      </div>
                    )}

                    {/* Persistent Disposition Controls including Intentional */}
                    <div className="space-y-1.5 border-t border-gray-200 pt-2 dark:border-gray-800">
                      <label className="block text-[11px] font-medium" htmlFor={`issue-reason-${issue.id}`}>Disposition reason</label>
                      <input
                        id={`issue-reason-${issue.id}`}
                        className="w-full rounded border border-gray-300 bg-white px-2 py-1 text-xs dark:border-gray-700 dark:bg-gray-900"
                        value={reasons[issue.id] ?? ''}
                        placeholder="Required reason for marking intentional, deferred, resolved, or dismissed…"
                        onChange={(event) => setReasons((previous) => ({ ...previous, [issue.id]: event.target.value }))}
                      />
                      <div className="flex flex-wrap gap-1.5">
                        {(issue.disposition === 'resolved' || issue.disposition === 'dismissed'
                          ? []
                          : (['deferred', 'needs-clarification', 'intentional', 'resolved', 'dismissed'] as const).filter(
                              (next) => issue.disposition !== next
                            )
                        ).map((next) => (
                          <button
                            key={next}
                            type="button"
                            className={workspaceButton}
                            disabled={!reasons[issue.id]?.trim()}
                            onClick={() => onIssueDisposition(issue.id, next, reasons[issue.id] ?? '')}
                          >
                            {next}
                          </button>
                        ))}
                        {issue.disposition !== 'open' && (
                          <button
                            type="button"
                            className={workspaceButton}
                            onClick={() => onIssueDisposition(issue.id, 'open', reasons[issue.id] || 'Reopened for review')}
                          >
                            Reopen
                          </button>
                        )}
                      </div>
                      {(issue.history?.length ?? 0) > 0 && (
                        <details>
                          <summary className="cursor-pointer">Disposition history ({issue.history.length})</summary>
                          <ol className="list-disc pl-5 mt-1">
                            {issue.history.map((event, index) => (
                              <li key={`${event.time}-${index}`}>
                                {event.disposition} · {event.reason} · r{event.projectRevision}
                              </li>
                            ))}
                          </ol>
                        </details>
                      )}
                    </div>
                  </article>
                );
              })
            )}
          </div>
        </section>

        {/* Package D: Bidirectional Manuscript <-> Canonical Model Sync */}
        <section aria-labelledby="sync-heading" className="space-y-3 rounded-lg border border-gray-300 p-4 dark:border-gray-700">
          <div className="flex flex-wrap items-start justify-between gap-2">
            <div>
              <h2 id="sync-heading" className="font-semibold text-base">Manuscript ↔ Model Sync (Reviewable Proposals)</h2>
              <p className="text-xs text-gray-600 dark:text-gray-400">
                {syncFreshness.statusLabel} · {syncFreshness.coverageNote}
              </p>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2 text-xs">
            <label className="flex items-center gap-1.5">
              <input
                type="radio"
                name="sync-direction"
                checked={syncDirection === 'manuscript-to-model'}
                onChange={() => setSyncDirection('manuscript-to-model')}
              />
              Manuscript → Model (Analyze Changes)
            </label>
            <label className="flex items-center gap-1.5">
              <input
                type="radio"
                name="sync-direction"
                checked={syncDirection === 'model-to-manuscript'}
                onChange={() => setSyncDirection('model-to-manuscript')}
              />
              Model → Manuscript (Sync Manuscript Patches)
            </label>
          </div>
          <p className="text-[11px] text-gray-600 dark:text-gray-400 tabular-nums">
            Preflight: {syncBudget.inputChars.toLocaleString()} / {syncBudget.maxInputChars.toLocaleString()} chars · ~{syncBudget.estimatedInputTokens.toLocaleString()} / {syncBudget.maxInputTokens.toLocaleString()} est. tokens. Omitted facts in one scene never auto-delete canonical facts.
          </p>
          <button
            type="button"
            disabled={syncBusy || !aiConfigured || !syncBudget.withinLimit || sections.length === 0}
            onClick={() => void runSyncAnalysis()}
            className="rounded bg-blue-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-blue-700 disabled:opacity-45"
          >
            {syncBusy
              ? 'Analyzing sync proposals…'
              : syncDirection === 'manuscript-to-model'
                ? 'Analyze Manuscript Changes'
                : 'Generate Scoped Manuscript Patches'}
          </button>
          {syncError && <p role="alert" className="text-xs text-red-700 dark:text-red-300">{syncError}</p>}
          {syncMessage && <p role="status" className="text-xs text-emerald-700 dark:text-emerald-300">{syncMessage}</p>}

          {syncResult && (
            <div className="space-y-3 pt-2 text-xs">
              {syncResult.baseRevision !== project.revision && (
                <p role="alert" className="rounded border border-amber-400 bg-amber-50 p-2 text-amber-900 dark:bg-amber-950/60 dark:text-amber-200">
                  Project revision changed since sync ran (r{syncResult.baseRevision} → r{project.revision}). Re-run sync before applying proposals.
                </p>
              )}
              {syncResult.modelProposals.map((prop) => (
                <article key={prop.id} className="rounded border border-gray-300 p-3 space-y-1.5 dark:border-gray-700">
                  <div className="flex items-center justify-between gap-2">
                    <h4 className="font-semibold">{prop.title}</h4>
                    <span className="rounded bg-gray-100 px-1.5 py-0.5 text-[10px] uppercase dark:bg-gray-800">{prop.kind.replace(/_/g, ' ')}</span>
                  </div>
                  <p>{prop.rationale}</p>
                  <blockquote className="border-l-2 pl-2 text-gray-600 dark:text-gray-300">{prop.evidenceQuote}</blockquote>
                  <p className="font-mono text-[11px]">Proposed: {prop.proposedValue}</p>
                  {prop.kind !== 'ambiguity' && onApplyModelSyncProposal && (
                    <button
                      type="button"
                      disabled={syncResult.baseRevision !== project.revision}
                      onClick={async () => {
                        const res = await onApplyModelSyncProposal(prop, syncResult.baseRevision);
                        setSyncMessage(res.ok ? res.message : '');
                        setSyncError(res.ok ? '' : res.message);
                      }}
                      className="rounded bg-emerald-600 px-2.5 py-1 text-[11px] font-semibold text-white hover:bg-emerald-700 disabled:opacity-45"
                    >
                      Accept Model Update
                    </button>
                  )}
                </article>
              ))}
              {syncResult.manuscriptPatches.map((patch) => {
                const binding = validateManuscriptPatchBinding(project, patch);
                return (
                  <article key={patch.id} className="rounded border border-gray-300 p-3 space-y-2 dark:border-gray-700">
                    <div className="flex items-center justify-between gap-2">
                      <h4 className="font-semibold">{patch.sectionTitle} · {patch.linkedModelChange}</h4>
                      <span className={`text-[11px] font-semibold ${binding.ok ? 'text-emerald-700 dark:text-emerald-400' : 'text-amber-700 dark:text-amber-300'}`}>
                        {binding.ok ? 'Exact match verified' : 'Stale / ambiguous'}
                      </span>
                    </div>
                    <p>{patch.rationale}</p>
                    <div className="grid gap-2 sm:grid-cols-2">
                      <div className="rounded border border-red-200 bg-red-50/40 p-2 dark:border-red-900/60 dark:bg-red-950/20">
                        <div className="font-semibold text-[11px]">Original excerpt</div>
                        <pre className="whitespace-pre-wrap break-words font-serif">{patch.originalExcerpt}</pre>
                      </div>
                      <div className="rounded border border-emerald-200 bg-emerald-50/40 p-2 dark:border-emerald-900/60 dark:bg-emerald-950/20">
                        <div className="font-semibold text-[11px]">Proposed patch</div>
                        <pre className="whitespace-pre-wrap break-words font-serif">{patch.proposedExcerpt}</pre>
                      </div>
                    </div>
                    {!binding.ok && binding.reason && <p className="text-amber-800 dark:text-amber-300">{binding.reason}</p>}
                    {onApplyManuscriptSyncPatch && (
                      <button
                        type="button"
                        disabled={!binding.ok || syncResult.baseRevision !== project.revision}
                        onClick={async () => {
                          const res = await onApplyManuscriptSyncPatch(patch, syncResult.baseRevision, syncResult.manuscriptVersionId);
                          setSyncMessage(res.ok ? res.message : '');
                          setSyncError(res.ok ? '' : res.message);
                        }}
                        className="rounded bg-emerald-600 px-2.5 py-1 text-[11px] font-semibold text-white hover:bg-emerald-700 disabled:opacity-45"
                      >
                        Apply Scoped Manuscript Patch
                      </button>
                    )}
                  </article>
                );
              })}
            </div>
          )}
        </section>

        {/* Package H: Optional Opt-in Bounded Semantic Auto-Analysis */}
        {onUpdateAutomationPreferences && (
          <section aria-labelledby="auto-analysis-heading" className="space-y-2.5 rounded-lg border border-gray-300 p-4 text-xs dark:border-gray-700">
            <h2 id="auto-analysis-heading" className="font-semibold text-sm">Optional Semantic Auto-Analysis (Off by Default)</h2>
            <p className="text-gray-600 dark:text-gray-400">
              When explicitly enabled, runs a debounced semantic consistency check after edits within strict scope and session call caps. Never auto-edits your manuscript or canon.
            </p>
            {!aiConfigured && (
              <p className="text-amber-800 dark:text-amber-300">Disabled because server AI credentials are not configured.</p>
            )}
            <div className="flex flex-wrap items-center gap-4">
              <label className="flex items-center gap-1.5 font-medium">
                <input
                  type="checkbox"
                  disabled={!aiConfigured}
                  checked={aiConfigured && autoPrefs.semanticAutoAnalysisEnabled}
                  onChange={(e) => onUpdateAutomationPreferences({ ...autoPrefs, semanticAutoAnalysisEnabled: e.target.checked })}
                />
                Enable bounded auto-analysis
              </label>
              <label className="flex items-center gap-1.5">
                <span>Scope</span>
                <select
                  disabled={!aiConfigured || !autoPrefs.semanticAutoAnalysisEnabled}
                  value={autoPrefs.scope}
                  onChange={(e) => onUpdateAutomationPreferences({ ...autoPrefs, scope: e.target.value as 'changed' | 'scene' | 'full' })}
                  className="rounded border border-gray-300 bg-white px-2 py-0.5 dark:border-gray-700 dark:bg-gray-950"
                >
                  <option value="changed">Changed scope</option>
                  <option value="scene">Current scene</option>
                  <option value="full">Full project</option>
                </select>
              </label>
              <label className="flex items-center gap-1.5">
                <span>Session call cap</span>
                <input
                  type="number"
                  min={1}
                  max={20}
                  disabled={!aiConfigured || !autoPrefs.semanticAutoAnalysisEnabled}
                  value={autoPrefs.maxCallsPerSession}
                  onChange={(e) =>
                    onUpdateAutomationPreferences({
                      ...autoPrefs,
                      maxCallsPerSession: Math.max(1, Math.min(20, Number(e.target.value) || 4)),
                    })
                  }
                  className="w-16 rounded border border-gray-300 bg-white px-2 py-0.5 dark:border-gray-700 dark:bg-gray-950"
                />
              </label>
              <button
                type="button"
                disabled={!aiConfigured || !autoPrefs.semanticAutoAnalysisEnabled}
                onClick={() => onUpdateAutomationPreferences({ ...autoPrefs, paused: !autoPrefs.paused })}
                className={workspaceButton}
              >
                {autoPrefs.paused ? 'Resume auto-analysis' : 'Pause auto-analysis'}
              </button>
              <span className="text-gray-500 tabular-nums">
                Session usage: {autoAnalysisCallsUsed} / {autoPrefs.maxCallsPerSession} calls
              </span>
            </div>
          </section>
        )}

        {/* Evidence, Sources, Claims & Audit Trail */}
        <section className="space-y-3 rounded-lg border border-gray-300 p-4 dark:border-gray-700">
          <h2 className="font-semibold">Evidence &amp; Audit</h2>
          <p className="text-sm">Revision {project.revision} · {sources.length} sources · {claims.length} evidence claims · {issues.length} registered issues</p>
          <div className="flex flex-wrap gap-2">
            <button type="button" className={workspaceButton} onClick={() => exportReport('json')}>Export report (.json)</button>
            <button type="button" className={workspaceButton} onClick={() => exportReport('md')}>Export report (.md)</button>
          </div>
          {sources.map((source) => (
            <details key={source.id} className="border-t border-gray-300 pt-3 dark:border-gray-700">
              <summary className="cursor-pointer font-medium">
                Source: {source.filename ?? source.id} · {source.retention === 'original-and-extracted' ? 'original file retained' : 'extracted text only'}
              </summary>
              <dl className="grid gap-1 py-2 text-sm sm:grid-cols-2">
                <div><dt className="font-medium">Type</dt><dd>{source.mediaType ?? 'Unknown'}</dd></div>
                <div><dt className="font-medium">Original byte length</dt><dd>{source.byteLength?.toLocaleString() ?? 'Unknown'}</dd></div>
                <div className="break-all"><dt className="font-medium">SHA-256</dt><dd>{source.digest}</dd></div>
                <div><dt className="font-medium">Parser version</dt><dd>{source.parserVersion ?? 'Unknown'}</dd></div>
                <div><dt className="font-medium">Extracted characters</dt><dd>{source.text.length.toLocaleString()}</dd></div>
                <div><dt className="font-medium">Original bytes</dt><dd>{source.originalBytesBase64 ? 'Included in project and full backup' : 'Not included; extracted text and evidence retained'}</dd></div>
              </dl>
              {source.analysisCoverage && (
                <div className="space-y-1 text-sm">
                  <p>Analysis {source.analysisCoverage.complete ? 'complete' : 'incomplete'} · {source.analysisCoverage.scope} scope · {source.analysisCoverage.processedSpans.length} processed ranges · {source.analysisCoverage.failedSegments} unprocessed or failed segments · {source.analysisCoverage.calls} calls</p>
                  <p>Categories: {source.analysisCoverage.categories.join(', ') || 'none'}</p>
                  {source.analysisCoverage.instruction && <p>Import guidance: {source.analysisCoverage.instruction}</p>}
                </div>
              )}
              {source.blocks.length > 0 && (
                <p className="text-sm">{source.blocks.length} source blocks · {source.blocks.filter((block) => block.kind === 'heading').length} headings preserved with offsets</p>
              )}
            </details>
          ))}
          {proposals.length > 0 && (
            <section aria-labelledby="import-proposals-heading" className="space-y-3 border-t border-gray-300 pt-3 dark:border-gray-700">
              <h3 id="import-proposals-heading" className="font-semibold">Imported findings and proposals ({proposals.length})</h3>
              <p className="text-sm">Confirmed proposals were accepted during import. Pending and rejected items remain in this record for review.</p>
              {proposals.filter((proposal) => proposal.category === 'other').length > 0 && (
                <p role="status" className="rounded border border-amber-400 p-3 text-sm">
                  {proposals.filter((proposal) => proposal.category === 'other').length} unclassified findings retained for review. This does not assert semantic completeness.
                </p>
              )}
              {proposals.map((proposal) => (
                <article key={proposal.id} className="space-y-1 rounded border border-gray-300 p-3 dark:border-gray-700">
                  <h4 className="font-medium">{proposal.label} · {proposal.kind} · {proposal.category} · {proposal.epistemicKind ?? 'epistemic class unknown'} · {proposal.approval}</h4>
                  {proposal.detail && <p className="text-sm">{proposal.detail}</p>}
                  <p className="text-sm">{proposal.rationale}</p>
                  <blockquote className="whitespace-pre-wrap break-words border-l-2 pl-3 text-sm">
                    {proposal.evidence.excerpt}
                    <span className="mt-1 block text-xs text-gray-600 dark:text-gray-400">Characters {proposal.evidence.start}–{proposal.evidence.end} · {proposal.evidence.sourceId.slice(0, 8)} · {proposal.evidence.version}</span>
                  </blockquote>
                </article>
              ))}
            </section>
          )}
          {claims.map((claim) => (
            <details key={claim.id}>
              <summary>{claim.targetId} · {claim.approval} · {claim.freshness}</summary>
              <p>{claim.rationale}</p>
              {claim.anchors.map((anchor, index) => (
                <blockquote className="whitespace-pre-wrap break-words" key={index}>
                  {anchor.excerpt}
                  <span className="mt-1 block text-xs text-gray-600 dark:text-gray-400">Characters {anchor.start}–{anchor.end} · {anchor.sourceId.slice(0, 8)} · {anchor.version}</span>
                </blockquote>
              ))}
            </details>
          ))}
          {audit.length === 0 && <p className="text-sm">No manuscript audit entries yet.</p>}
          <ol className="space-y-2">
            {audit.slice().reverse().map((event) => (
              <li key={event.id} className="break-words border-t border-gray-300 pt-2 dark:border-gray-700">
                <details>
                  <summary>{event.reason} · r{event.baseRevision} → r{event.resultRevision}</summary>
                  <p className="text-sm">{new Date(event.time).toLocaleString()} · {event.before ?? 'No manuscript'} → {event.after ?? 'No manuscript'}</p>
                  {event.artifact && <blockquote className="mt-2 whitespace-pre-wrap">{event.artifact.excerpt}</blockquote>}
                </details>
              </li>
            ))}
          </ol>
        </section>
      </div>
    </main>
  );
}
