/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
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
import { computeSyncFreshness } from '../../lib/narrative/sync/syncProposals';
import {
  requestDiagnosticFixSuggestions,
  requestNarrativeSyncAnalysis,
} from '../../services/apiClient';
import { workspaceButton } from '../manuscript/ManuscriptEditor';
import {
  captureProposalReviewContext,
  isProposalReviewContextCurrent,
  type PendingProposalReview,
} from './review/proposalReviewContext';
import {
  buildCompactReviewModelPayload,
  buildResumedFixState,
  buildScopedDiagnosticPayload,
  buildScopedSyncPayload,
  executeIssueAiFixRequest,
  executeScopedSyncAnalysis,
  executeSemanticDiagnosticsRun,
  resolveIssueNavigationTarget,
} from './review/asyncReviewActions';
import { DiagnosticsSection, type IssueFixEntry } from './review/DiagnosticsSection';
import { SyncReviewSection, type SyncReviewResultState } from './review/SyncReviewSection';
import { AutoAnalysisSettingsSection } from './review/AutoAnalysisSettingsSection';
import { EvidenceAuditSection } from './review/EvidenceAuditSection';

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
  onReturnToWriting?: (target?: ConsistencyIssueTarget, review?: PendingProposalReview) => void;
  resumeProposalReview?: PendingProposalReview;
  onClearResumedProposalReview?: () => void;
  autoAnalysisCallsUsed?: number;
}

const DEFAULT_AUTO_PREFS: NonNullable<NarrativeRecords['automationPreferences']> = {
  semanticAutoAnalysisEnabled: false,
  scope: 'changed',
  maxCallsPerSession: 4,
  maxTokensPerRun: 10_000,
  paused: false,
};

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
  onReturnToWriting,
  resumeProposalReview,
  onClearResumedProposalReview,
  autoAnalysisCallsUsed = 0,
}: Props) {
  const currentProjectRef = useRef(project);
  const mountedRef = useRef(true);
  const consumedResumeKeyRef = useRef('');
  const {
    resumable: resumableProposal,
    payloadKey: resumePayloadKey,
    initialAlternatives,
    initialSelectedIds,
  } = buildResumedFixState(project, resumeProposalReview);
  useLayoutEffect(() => {
    currentProjectRef.current = project;
  }, [project]);

  const diagnosticRun = useRef<AbortController | null>(null);
  const fixControllersRef = useRef(new Map<string, AbortController>());
  const syncControllerRef = useRef<AbortController | null>(null);

  useEffect(() => {
    mountedRef.current = true;
    const fixControllers = fixControllersRef.current;
    return () => {
      mountedRef.current = false;
      diagnosticRun.current?.abort();
      syncControllerRef.current?.abort();
      for (const ctrl of fixControllers.values()) ctrl.abort();
      fixControllers.clear();
    };
  }, [project.id]);

  const [reasons, setReasons] = useState<Record<string, string>>({});
  const [dispositionFilter, setDispositionFilter] = useState<'all' | NarrativeIssue['disposition']>('all');
  const [diagScope, setDiagScope] = useState<'full' | 'scene' | 'entity' | 'changed'>('full');
  const [diagTargetId, setDiagTargetId] = useState('');
  const [diagBusy, setDiagBusy] = useState(false);
  const [diagMessage, setDiagMessage] = useState('');
  const [diagError, setDiagError] = useState('');

  const [fixPanelIssueId, setFixPanelIssueId] = useState<string | null>(() => resumableProposal?.issueId ?? null);
  const [fixAlternativesByIssue, setFixAlternativesByIssue] = useState<Record<string, IssueFixEntry>>(
    () => initialAlternatives
  );
  const [selectedFixIds, setSelectedFixIds] = useState<Record<string, string>>(() => initialSelectedIds);
  const [fixLoadingIds, setFixLoadingIds] = useState<Set<string>>(() => new Set());
  const [fixStatusMessage, setFixStatusMessage] = useState('');
  const [fixError, setFixError] = useState('');

  const [syncDirection, setSyncDirection] = useState<'manuscript-to-model' | 'model-to-manuscript'>('manuscript-to-model');
  const [syncBusy, setSyncBusy] = useState(false);
  const [syncError, setSyncError] = useState('');
  const [syncMessage, setSyncMessage] = useState('');
  const [syncResult, setSyncResult] = useState<SyncReviewResultState | null>(null);

  useEffect(() => {
    if (!onClearResumedProposalReview || !resumePayloadKey) return;
    if (resumePayloadKey === consumedResumeKeyRef.current) return;
    consumedResumeKeyRef.current = resumePayloadKey;
    onClearResumedProposalReview();
  }, [onClearResumedProposalReview, resumePayloadKey]);

  const { issues = [], claims = [], audit = [], sources = [], proposals = [] } = project.narrative ?? {};
  const sections = useMemo(() => manuscriptSections(project), [project]);
  const { readiness, consistencyIssues } = useMemo(() => splitReadinessAndIssues(checks), [checks]);
  const syncFreshness = useMemo(() => computeSyncFreshness(project), [project]);
  const autoPrefs = project.narrative?.automationPreferences ?? DEFAULT_AUTO_PREFS;

  const compactModelPayload = useMemo(
    () => buildCompactReviewModelPayload(project.snapshot),
    [project.snapshot]
  );

  const scopedDiagPayload = useMemo(
    () =>
      buildScopedDiagnosticPayload({
        project,
        sections,
        diagScope,
        diagTargetId,
        compactModel: compactModelPayload,
      }),
    [project, sections, diagScope, diagTargetId, compactModelPayload]
  );

  const diagBudget = useMemo(
    () => buildClientBudgetDisclosure('diagnostics', `Semantic Diagnostics (${diagScope})`, scopedDiagPayload),
    [scopedDiagPayload, diagScope]
  );

  const syncPayload = useMemo(
    () =>
      buildScopedSyncPayload({
        project,
        sections,
        syncDirection,
        compactModel: compactModelPayload,
      }),
    [project, sections, syncDirection, compactModelPayload]
  );

  const syncBudget = useMemo(
    () => buildClientBudgetDisclosure('sync', `Sync (${syncDirection})`, syncPayload),
    [syncPayload, syncDirection]
  );

  const runSemanticDiagnostics = () => {
    if (!aiConfigured) {
      setDiagError('Server Gemini API key is not configured. Use Run Local Checks or configure server AI credentials.');
      return;
    }
    if (!onRunSemanticDiagnostics) return;
    setDiagError('');
    setDiagMessage('');
    void executeSemanticDiagnosticsRun({
      registerController: () => {
        diagnosticRun.current?.abort();
        const run = new AbortController();
        diagnosticRun.current = run;
        return run;
      },
      isCurrentController: (run) => diagnosticRun.current === run,
      clearController: () => {
        diagnosticRun.current = null;
      },
      setBusy: setDiagBusy,
      runDiagnostics: (signal) =>
        onRunSemanticDiagnostics(
          scopedDiagPayload,
          {
            manuscriptVersionId: project.snapshot.manuscriptVersionId,
            snapshotDigest: computeSnapshotDigest(project.snapshot),
            scopeLabel: `AI Semantic (${diagScope})`,
          },
          signal
        ),
      onSuccess: setDiagMessage,
      onError: setDiagError,
    });
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
    const alternatives = buildLocalFixAlternatives(project, issue);
    setFixAlternativesByIssue((prev) => ({
      ...prev,
      [issue.id]: {
        context: captureProposalReviewContext(project),
        source: 'local',
        alternatives,
      },
    }));
    setSelectedFixIds((prev) => ({ ...prev, [issue.id]: alternatives[0]?.id ?? '' }));
  };

  const requestAiFixesForIssue = (issue: NarrativeIssue) => {
    if (!aiConfigured) {
      setFixError('Server Gemini API key is not configured. Deterministic local fixes remain available above.');
      return;
    }
    setFixError('');
    setFixStatusMessage('');
    const context = captureProposalReviewContext(project);
    void executeIssueAiFixRequest({
      issueId: issue.id,
      setIssueLoading: (id, loading) => {
        if (!mountedRef.current) return;
        setFixLoadingIds((prev) => {
          const next = new Set(prev);
          if (loading) next.add(id);
          else next.delete(id);
          return next;
        });
      },
      registerController: (id) => {
        fixControllersRef.current.get(id)?.abort();
        const ctrl = new AbortController();
        fixControllersRef.current.set(id, ctrl);
        return ctrl;
      },
      isActive: () => mountedRef.current && currentProjectRef.current.id === context.projectId,
      requestFixes: (signal) =>
        requestDiagnosticFixSuggestions(
          {
            projectId: project.id,
            baseRevision: context.baseRevision,
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
          },
          signal
        ),
      onSuccess: (alternatives) => {
        setFixAlternativesByIssue((prev) => ({
          ...prev,
          [issue.id]: { context, source: 'ai', alternatives },
        }));
        setSelectedFixIds((prev) => ({ ...prev, [issue.id]: alternatives[0]?.id ?? '' }));
        setFixStatusMessage(`Loaded ${alternatives.length} reviewable AI fix alternative(s). Nothing has been applied.`);
      },
      onError: (msg) => setFixError(msg),
    });
  };

  const runSyncAnalysis = () => {
    if (sections.length === 0) {
      setSyncError('Add or import at least one Working Manuscript section before running sync.');
      return;
    }
    if (!aiConfigured) {
      setSyncError('Server Gemini API key is not configured. Manuscript ↔ Model AI sync requires server credentials.');
      return;
    }
    const context = captureProposalReviewContext(project);
    setSyncError('');
    setSyncMessage('');
    void executeScopedSyncAnalysis({
      registerController: () => {
        syncControllerRef.current?.abort();
        const ctrl = new AbortController();
        syncControllerRef.current = ctrl;
        return ctrl;
      },
      setBusy: (busy) => {
        if (mountedRef.current) setSyncBusy(busy);
      },
      isActive: () => mountedRef.current && currentProjectRef.current.id === context.projectId,
      runSync: (signal) => requestNarrativeSyncAnalysis(syncPayload, signal),
      onSuccess: (response) => {
        setSyncResult({
          context,
          direction: response.direction,
          coverageNote: response.coverageNote,
          modelProposals: response.modelProposals,
          manuscriptPatches: response.manuscriptPatches,
        });
        if (isProposalReviewContextCurrent(currentProjectRef.current, context)) {
          onRecordSyncCheckpoint?.(response.direction, response.coverageNote);
          setSyncMessage(response.coverageNote);
        } else {
          setSyncMessage(`Sync finished for revision ${context.baseRevision}, but the project changed while it was running. The proposals are stale and no checkpoint was recorded.`);
        }
      },
      onError: (msg) => setSyncError(msg),
    });
  };

  const navigateIssueTarget = (targetId: string) => {
    if (!onNavigateTarget) return;
    onNavigateTarget(resolveIssueNavigationTarget(project, sections, targetId));
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

        <DiagnosticsSection
          project={project}
          sections={sections}
          readiness={readiness}
          issues={issues}
          aiConfigured={aiConfigured}
          diagScope={diagScope}
          setDiagScope={setDiagScope}
          diagTargetId={diagTargetId}
          setDiagTargetId={setDiagTargetId}
          diagBusy={diagBusy}
          diagBudget={diagBudget}
          diagError={diagError}
          diagMessage={diagMessage}
          setDiagMessage={setDiagMessage}
          onRunLocalDiagnostics={onRunLocalDiagnostics}
          onResetDiagnosticScope={resetDiagnosticScope}
          onRunSemanticDiagnostics={runSemanticDiagnostics}
          dispositionFilter={dispositionFilter}
          setDispositionFilter={setDispositionFilter}
          fixError={fixError}
          setFixError={setFixError}
          fixStatusMessage={fixStatusMessage}
          setFixStatusMessage={setFixStatusMessage}
          fixPanelIssueId={fixPanelIssueId}
          setFixPanelIssueId={setFixPanelIssueId}
          fixAlternativesByIssue={fixAlternativesByIssue}
          selectedFixIds={selectedFixIds}
          setSelectedFixIds={setSelectedFixIds}
          fixLoadingIds={fixLoadingIds}
          reasons={reasons}
          setReasons={setReasons}
          onOpenFixesForIssue={openFixesForIssue}
          onRequestAiFixesForIssue={requestAiFixesForIssue}
          onApplyDiagnosticFix={onApplyDiagnosticFix}
          isCurrentProjectVersion={(context) => isProposalReviewContextCurrent(currentProjectRef.current, context)}
          onIssueDisposition={onIssueDisposition}
          onNavigateTarget={onNavigateTarget}
          onNavigateIssueTarget={navigateIssueTarget}
          onReturnToWriting={onReturnToWriting}
          openHistory={openHistory}
        />

        <SyncReviewSection
          project={project}
          sectionCount={sections.length}
          aiConfigured={aiConfigured}
          syncFreshness={syncFreshness}
          syncDirection={syncDirection}
          setSyncDirection={setSyncDirection}
          syncBudget={syncBudget}
          syncBusy={syncBusy}
          syncError={syncError}
          setSyncError={setSyncError}
          syncMessage={syncMessage}
          setSyncMessage={setSyncMessage}
          syncResult={syncResult}
          onRunSyncAnalysis={runSyncAnalysis}
          onApplyModelSyncProposal={onApplyModelSyncProposal}
          onApplyManuscriptSyncPatch={onApplyManuscriptSyncPatch}
        />

        {onUpdateAutomationPreferences && (
          <AutoAnalysisSettingsSection
            aiConfigured={aiConfigured}
            autoPrefs={autoPrefs}
            autoAnalysisCallsUsed={autoAnalysisCallsUsed}
            onUpdateAutomationPreferences={onUpdateAutomationPreferences}
          />
        )}

        <EvidenceAuditSection
          revision={project.revision}
          sources={sources}
          proposals={proposals}
          claims={claims}
          issuesCount={issues.length}
          audit={audit}
          exportReport={exportReport}
        />
      </div>
    </main>
  );
}
