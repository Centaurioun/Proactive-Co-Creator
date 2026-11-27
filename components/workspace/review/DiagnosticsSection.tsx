/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import type { ConsistencyIssue, ConsistencyIssueTarget, CreativeProject } from '../../../shared/types';
import type { ManuscriptSection, NarrativeIssue } from '../../../shared/narrativeTypes';
import type { DiagnosticFixAlternative } from '../../../shared/narrativeAiSchemas';
import type { ClientBudgetDisclosure } from '../../../lib/narrative/aiBudgetClient';
import type { ReadinessItem } from '../../../lib/narrative/diagnostics/engine';
import { workspaceButton } from '../../manuscript/ManuscriptEditor';
import ProposalReviewPanel from './ProposalReviewPanel';
import {
  isProposalReviewContextCurrent,
  type PendingProposalReview,
  type ProposalReviewContext,
} from './proposalReviewContext';

export interface IssueFixEntry {
  context: ProposalReviewContext;
  source: 'local' | 'ai';
  alternatives: DiagnosticFixAlternative[];
}

interface SemanticAnalysisPanelProps {
  project: CreativeProject;
  sections: ManuscriptSection[];
  aiConfigured: boolean;
  diagScope: 'full' | 'scene' | 'entity' | 'changed';
  setDiagScope: (scope: 'full' | 'scene' | 'entity' | 'changed') => void;
  diagTargetId: string;
  setDiagTargetId: (id: string) => void;
  diagBusy: boolean;
  diagBudget: ClientBudgetDisclosure;
  diagError: string;
  diagMessage: string;
  onResetDiagnosticScope: () => void;
  onRunSemanticDiagnostics: () => void;
}

const SemanticAnalysisPanel: React.FC<SemanticAnalysisPanelProps> = ({
  project,
  sections,
  aiConfigured,
  diagScope,
  setDiagScope,
  diagTargetId,
  setDiagTargetId,
  diagBusy,
  diagBudget,
  diagError,
  diagMessage,
  onResetDiagnosticScope,
  onRunSemanticDiagnostics,
}) => (
  <div className="space-y-2.5 rounded border border-gray-200 bg-gray-50/70 p-3 text-xs dark:border-gray-800 dark:bg-gray-900/60">
    <h3 className="font-semibold">Analyze Consistency (AI Semantic Pass)</h3>
    {!aiConfigured && (
      <p role="status" className="rounded border border-amber-300 bg-amber-50 p-2 text-amber-900 dark:border-amber-800 dark:bg-amber-950/50 dark:text-amber-200">
        Server Gemini API key is not configured for the current diagnostics gate. ChatGPT plan is qualified only for local Story (GPT-6 Luna / Default). Local deterministic checks and local fixes remain fully functional.
      </p>
    )}
    <div className="flex flex-wrap items-end gap-2">
      <label className="space-y-1">
        <span className="block font-medium">Scope</span>
        <select
          value={diagScope}
          onChange={(e) => {
            onResetDiagnosticScope();
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
          <select
            value={diagTargetId}
            onChange={(e) => {
              onResetDiagnosticScope();
              setDiagTargetId(e.target.value);
            }}
            className="rounded border border-gray-300 bg-white px-2 py-1 text-xs dark:border-gray-700 dark:bg-gray-950"
          >
            <option value="">Select scene…</option>
            {sections.map((s) => <option key={s.id} value={s.id}>{s.title || s.kind}</option>)}
          </select>
        </label>
      )}
      {diagScope === 'entity' && (
        <label className="space-y-1">
          <span className="block font-medium">Entity</span>
          <select
            value={diagTargetId}
            onChange={(e) => {
              onResetDiagnosticScope();
              setDiagTargetId(e.target.value);
            }}
            className="rounded border border-gray-300 bg-white px-2 py-1 text-xs dark:border-gray-700 dark:bg-gray-950"
          >
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
        onClick={onRunSemanticDiagnostics}
        className="rounded bg-blue-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-blue-700 disabled:opacity-45"
      >
        {diagBusy ? 'Analyzing…' : 'Analyze Consistency with AI'}
      </button>
    </div>
    <p className="text-[11px] tabular-nums text-gray-600 dark:text-gray-400">
      Preflight: {diagBudget.inputChars.toLocaleString()} / {diagBudget.maxInputChars.toLocaleString()} chars · ~{diagBudget.estimatedInputTokens.toLocaleString()} / {diagBudget.maxInputTokens.toLocaleString()} est. tokens.
    </p>
    {diagBudget.warning && <p role="alert" className="text-amber-800 dark:text-amber-300">{diagBudget.warning}</p>}
    {diagError && <p role="alert" className="text-red-700 dark:text-red-300">{diagError}</p>}
    {diagMessage && <p role="status" className="text-emerald-700 dark:text-emerald-300">{diagMessage}</p>}
  </div>
);

const NEXT_DISPOSITIONS = ['deferred', 'needs-clarification', 'intentional', 'resolved', 'dismissed'] as const;

interface IssueRegistryCardProps {
  project: CreativeProject;
  issue: NarrativeIssue;
  aiConfigured: boolean;
  isPanelOpen: boolean;
  isIssueFixLoading: boolean;
  fixEntry: IssueFixEntry | undefined;
  selectedFixId: string | undefined;
  reasonText: string;
  onChangeReason: (value: string) => void;
  onOpenFixesForIssue: (issue: NarrativeIssue) => void;
  onRequestAiFixesForIssue: (issue: NarrativeIssue) => void;
  onCloseFixPanel: () => void;
  onSelectFixId: (fixId: string) => void;
  onApplyDiagnosticFix?: (
    issueId: string,
    alternative: DiagnosticFixAlternative,
    expectedBaseRevision: number
  ) => Promise<{ ok: boolean; message: string }>;
  isCurrentProjectVersion: (context: ProposalReviewContext) => boolean;
  setFixError: (msg: string) => void;
  setFixStatusMessage: (msg: string) => void;
  onIssueDisposition: (issueId: string, disposition: NarrativeIssue['disposition'], reason: string) => void;
  onNavigateTarget?: (target: ConsistencyIssueTarget) => void;
  onNavigateIssueTarget: (targetId: string) => void;
  onReturnToWriting?: (target?: ConsistencyIssueTarget, review?: PendingProposalReview) => void;
  openHistory: () => void;
}

const IssueRegistryCard: React.FC<IssueRegistryCardProps> = ({
  project,
  issue,
  aiConfigured,
  isPanelOpen,
  isIssueFixLoading,
  fixEntry,
  selectedFixId,
  reasonText,
  onChangeReason,
  onOpenFixesForIssue,
  onRequestAiFixesForIssue,
  onCloseFixPanel,
  onSelectFixId,
  onApplyDiagnosticFix,
  isCurrentProjectVersion,
  setFixError,
  setFixStatusMessage,
  onIssueDisposition,
  onNavigateTarget,
  onNavigateIssueTarget,
  onReturnToWriting,
  openHistory,
}) => {
  const fixesStale = Boolean(fixEntry && !isProposalReviewContextCurrent(project, fixEntry.context));
  const selectedFix =
    fixEntry?.alternatives.find((alternative) => alternative.id === selectedFixId) ?? fixEntry?.alternatives[0];
  const isTerminalDisposition = issue.disposition === 'resolved' || issue.disposition === 'dismissed';
  const availableTransitions = isTerminalDisposition
    ? []
    : NEXT_DISPOSITIONS.filter((next) => issue.disposition !== next);

  return (
    <article className="space-y-2 rounded border border-gray-300 p-3 text-xs dark:border-gray-700">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h4 className="text-sm font-semibold">{issue.title}</h4>
          <div className="mt-0.5 flex flex-wrap gap-1.5 text-[11px]">
            <span className="rounded bg-gray-100 px-1.5 py-0.5 capitalize dark:bg-gray-800">{issue.disposition}</span>
            {issue.severity && <span className="rounded bg-red-100 px-1.5 py-0.5 uppercase text-red-800 dark:bg-red-950 dark:text-red-300">Severity: {issue.severity}</span>}
            {issue.certainty && <span className="rounded bg-amber-100 px-1.5 py-0.5 capitalize text-amber-800 dark:bg-amber-950 dark:text-amber-300">Certainty: {issue.certainty}</span>}
            <span className="rounded bg-blue-50 px-1.5 py-0.5 text-blue-800 dark:bg-blue-950 dark:text-blue-300">{issue.source === 'semantic-ai' ? 'AI Semantic' : 'Local Check'}</span>
            <span className="text-gray-500">{issue.freshness}{issue.scopeLabel ? ` · ${issue.scopeLabel}` : ''}</span>
          </div>
        </div>
        <div className="flex flex-wrap gap-1.5">
          <button type="button" aria-expanded={isPanelOpen} className={workspaceButton} onClick={() => onOpenFixesForIssue(issue)}>
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
              onClick={() => onNavigateIssueTarget(tid)}
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

      {isPanelOpen && (
        <div className="space-y-2.5 rounded border border-indigo-200 bg-indigo-50/30 p-3 dark:border-indigo-900/60 dark:bg-indigo-950/20">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h5 className="font-semibold text-indigo-900 dark:text-indigo-200">
              Safe Fix Alternatives (Review Before Applying)
            </h5>
            <div className="flex gap-2">
              <button
                type="button"
                disabled={!aiConfigured || isIssueFixLoading}
                onClick={() => onRequestAiFixesForIssue(issue)}
                className="rounded bg-indigo-600 px-2.5 py-1 text-[11px] font-semibold text-white hover:bg-indigo-700 disabled:opacity-45"
              >
                {isIssueFixLoading ? 'Fetching AI fixes…' : 'Suggest AI Fixes'}
              </button>
              <button type="button" className="text-[11px] underline" onClick={onCloseFixPanel}>
                Close
              </button>
            </div>
          </div>
          {fixesStale && (
            <p role="alert" className="text-amber-800 dark:text-amber-200">
              Project or manuscript revision changed since this proposal was generated. It remains visible for provenance and comparison, but cannot be applied.
            </p>
          )}
          {!fixEntry || fixEntry.alternatives.length === 0 ? (
            <p className="text-gray-600 dark:text-gray-300">
              No automatic deterministic fix matches this issue. Use &ldquo;Suggest AI Fixes&rdquo; (when AI is configured) or resolve manually via the Jump-to-Target link above.
            </p>
          ) : (
            <>
              {fixEntry.alternatives.length > 1 && (
                <label className="block max-w-md space-y-1 text-xs">
                  <span className="font-medium">Choose a proposal to inspect</span>
                  <select
                    value={selectedFix?.id ?? ''}
                    onChange={(event) => onSelectFixId(event.target.value)}
                    className="w-full rounded border border-gray-300 bg-white px-2 py-1.5 dark:border-gray-700 dark:bg-gray-950"
                  >
                    {fixEntry.alternatives.map((alternative) => (
                      <option key={alternative.id} value={alternative.id}>{alternative.title}</option>
                    ))}
                  </select>
                </label>
              )}
              {selectedFix && (
                <ProposalReviewPanel
                  project={project}
                  issue={issue}
                  alternative={selectedFix}
                  context={fixEntry.context}
                  source={fixEntry.source}
                  stale={fixesStale}
                  onAccept={
                    onApplyDiagnosticFix && !fixesStale && selectedFix.kind !== 'manual_guidance'
                      ? async () => {
                          if (!isCurrentProjectVersion(fixEntry.context)) {
                            setFixError('The project changed while this proposal was open. It remains unapplied; refresh before trying again.');
                            return;
                          }
                          const res = await onApplyDiagnosticFix(issue.id, selectedFix, fixEntry.context.baseRevision);
                          if (res.ok) {
                            setFixStatusMessage(res.message);
                            setFixError('');
                            onCloseFixPanel();
                          } else {
                            setFixError(res.message);
                          }
                        }
                      : undefined
                  }
                  onKeepCurrent={() =>
                    setFixStatusMessage(
                      `Current text is unchanged. The suggestion remains unapplied and the tracked issue remains ${issue.disposition}.`
                    )
                  }
                  onRefreshLocal={() => onOpenFixesForIssue(issue)}
                  onReturnToWriting={onReturnToWriting}
                  onOpenTarget={onNavigateIssueTarget}
                  onOpenHistory={openHistory}
                />
              )}
            </>
          )}
        </div>
      )}

      <div className="space-y-1.5 border-t border-gray-200 pt-2 dark:border-gray-800">
        <label className="block text-[11px] font-medium" htmlFor={`issue-reason-${issue.id}`}>Disposition reason</label>
        <input
          id={`issue-reason-${issue.id}`}
          className="w-full rounded border border-gray-300 bg-white px-2 py-1 text-xs dark:border-gray-700 dark:bg-gray-900"
          value={reasonText}
          placeholder="Required reason for marking intentional, deferred, resolved, or dismissed…"
          onChange={(event) => onChangeReason(event.target.value)}
        />
        <div className="flex flex-wrap gap-1.5">
          {availableTransitions.map((next) => (
            <button
              key={next}
              type="button"
              className={workspaceButton}
              disabled={!reasonText.trim()}
              onClick={() => onIssueDisposition(issue.id, next, reasonText)}
            >
              {next}
            </button>
          ))}
          {issue.disposition !== 'open' && (
            <button
              type="button"
              className={workspaceButton}
              onClick={() => onIssueDisposition(issue.id, 'open', reasonText || 'Reopened for review')}
            >
              Reopen
            </button>
          )}
        </div>
        {(issue.history?.length ?? 0) > 0 && (
          <details>
            <summary className="cursor-pointer">Disposition history ({issue.history.length})</summary>
            <ol className="mt-1 list-disc pl-5">
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
};

interface DiagnosticsSectionProps {
  project: CreativeProject;
  sections: ManuscriptSection[];
  readiness: ReadinessItem[];
  issues: NarrativeIssue[];
  aiConfigured: boolean;
  diagScope: 'full' | 'scene' | 'entity' | 'changed';
  setDiagScope: (scope: 'full' | 'scene' | 'entity' | 'changed') => void;
  diagTargetId: string;
  setDiagTargetId: (id: string) => void;
  diagBusy: boolean;
  diagBudget: ClientBudgetDisclosure;
  diagError: string;
  diagMessage: string;
  setDiagMessage: (msg: string) => void;
  onRunLocalDiagnostics?: () => void;
  onResetDiagnosticScope: () => void;
  onRunSemanticDiagnostics: () => void;
  dispositionFilter: 'all' | NarrativeIssue['disposition'];
  setDispositionFilter: (filter: 'all' | NarrativeIssue['disposition']) => void;
  fixError: string;
  setFixError: (msg: string) => void;
  fixStatusMessage: string;
  setFixStatusMessage: (msg: string) => void;
  fixPanelIssueId: string | null;
  setFixPanelIssueId: (id: string | null) => void;
  fixAlternativesByIssue: Record<string, IssueFixEntry>;
  selectedFixIds: Record<string, string>;
  setSelectedFixIds: React.Dispatch<React.SetStateAction<Record<string, string>>>;
  fixLoadingIds: Set<string>;
  reasons: Record<string, string>;
  setReasons: React.Dispatch<React.SetStateAction<Record<string, string>>>;
  onOpenFixesForIssue: (issue: NarrativeIssue) => void;
  onRequestAiFixesForIssue: (issue: NarrativeIssue) => void;
  onApplyDiagnosticFix?: (
    issueId: string,
    alternative: DiagnosticFixAlternative,
    expectedBaseRevision: number
  ) => Promise<{ ok: boolean; message: string }>;
  isCurrentProjectVersion: (context: ProposalReviewContext) => boolean;
  onIssueDisposition: (issueId: string, disposition: NarrativeIssue['disposition'], reason: string) => void;
  onNavigateTarget?: (target: ConsistencyIssueTarget) => void;
  onNavigateIssueTarget: (targetId: string) => void;
  onReturnToWriting?: (target?: ConsistencyIssueTarget, review?: PendingProposalReview) => void;
  openHistory: () => void;
  consistencyIssues?: ConsistencyIssue[];
}

export const DiagnosticsSection: React.FC<DiagnosticsSectionProps> = ({
  project,
  sections,
  readiness,
  issues,
  aiConfigured,
  diagScope,
  setDiagScope,
  diagTargetId,
  setDiagTargetId,
  diagBusy,
  diagBudget,
  diagError,
  diagMessage,
  setDiagMessage,
  onRunLocalDiagnostics,
  onResetDiagnosticScope,
  onRunSemanticDiagnostics,
  dispositionFilter,
  setDispositionFilter,
  fixError,
  setFixError,
  fixStatusMessage,
  setFixStatusMessage,
  fixPanelIssueId,
  setFixPanelIssueId,
  fixAlternativesByIssue,
  selectedFixIds,
  setSelectedFixIds,
  fixLoadingIds,
  reasons,
  setReasons,
  onOpenFixesForIssue,
  onRequestAiFixesForIssue,
  onApplyDiagnosticFix,
  isCurrentProjectVersion,
  onIssueDisposition,
  onNavigateTarget,
  onNavigateIssueTarget,
  onReturnToWriting,
  openHistory,
}) => {
  const filteredIssues = issues.filter(
    (issue) => dispositionFilter === 'all' || issue.disposition === dispositionFilter
  );

  return (
    <section aria-labelledby="diagnostics-heading" className="space-y-4 rounded-lg border border-gray-300 p-4 dark:border-gray-700">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h2 id="diagnostics-heading" className="text-base font-semibold">Narrative Diagnostics &amp; Safe Fixes</h2>
          <p className="text-xs text-gray-600 dark:text-gray-400">
            Run local structural checks anytime without network calls, or explicitly run scoped AI semantic analysis with preflight budget disclosure.
          </p>
        </div>
        {onRunLocalDiagnostics && (
          <button
            type="button"
            className={workspaceButton}
            onClick={() => {
              onRunLocalDiagnostics();
              setDiagMessage('Local deterministic checks synced into tracked issues.');
            }}
          >
            Run Local Checks
          </button>
        )}
      </div>

      {readiness.length > 0 && (
        <div className="space-y-1 rounded border border-blue-200 bg-blue-50/40 p-3 text-xs dark:border-blue-900/60 dark:bg-blue-950/20">
          <h3 className="font-semibold text-blue-900 dark:text-blue-200">Project Readiness Checklist ({readiness.length})</h3>
          <p className="text-blue-800/80 dark:text-blue-300/80">Optional setup reminders kept separate from actual continuity conflicts.</p>
          <ul className="list-disc space-y-0.5 pl-5">
            {readiness.map((item) => (
              <li key={item.id}>{item.title} — {item.description}</li>
            ))}
          </ul>
        </div>
      )}

      <SemanticAnalysisPanel
        project={project}
        sections={sections}
        aiConfigured={aiConfigured}
        diagScope={diagScope}
        setDiagScope={setDiagScope}
        diagTargetId={diagTargetId}
        setDiagTargetId={setDiagTargetId}
        diagBusy={diagBusy}
        diagBudget={diagBudget}
        diagError={diagError}
        diagMessage={diagMessage}
        onResetDiagnosticScope={onResetDiagnosticScope}
        onRunSemanticDiagnostics={onRunSemanticDiagnostics}
      />

      <div className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h3 className="text-sm font-semibold">Tracked Continuity Issues ({filteredIssues.length} of {issues.length})</h3>
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
          filteredIssues.map((issue) => (
            <IssueRegistryCard
              key={issue.id}
              project={project}
              issue={issue}
              aiConfigured={aiConfigured}
              isPanelOpen={fixPanelIssueId === issue.id}
              isIssueFixLoading={fixLoadingIds.has(issue.id)}
              fixEntry={fixAlternativesByIssue[issue.id]}
              selectedFixId={selectedFixIds[issue.id] ?? fixAlternativesByIssue[issue.id]?.alternatives[0]?.id}
              reasonText={reasons[issue.id] ?? ''}
              onChangeReason={(val) => setReasons((previous) => ({ ...previous, [issue.id]: val }))}
              onOpenFixesForIssue={onOpenFixesForIssue}
              onRequestAiFixesForIssue={onRequestAiFixesForIssue}
              onCloseFixPanel={() => setFixPanelIssueId(null)}
              onSelectFixId={(fixId) => setSelectedFixIds((previous) => ({ ...previous, [issue.id]: fixId }))}
              onApplyDiagnosticFix={onApplyDiagnosticFix}
              isCurrentProjectVersion={isCurrentProjectVersion}
              setFixError={setFixError}
              setFixStatusMessage={setFixStatusMessage}
              onIssueDisposition={onIssueDisposition}
              onNavigateTarget={onNavigateTarget}
              onNavigateIssueTarget={onNavigateIssueTarget}
              onReturnToWriting={onReturnToWriting}
              openHistory={openHistory}
            />
          ))
        )}
      </div>
    </section>
  );
};
