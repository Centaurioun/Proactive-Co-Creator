import React, { useMemo, useState } from 'react';
import { CreativeProject } from '../../shared/types';
import {
  CitationAnchorInput,
  CitationDiffCardModel,
  resolveCitationDiffCard,
} from '../../lib/narrative/context/citationAnchorResolver';
import {
  assembleOperationContext,
  ContextInspectorReport,
  ContextOperationIntent,
} from '../../lib/narrative/context/contextAssembler';
import { manuscriptSections } from '../../lib/narrative/manuscriptModel';

interface ContextInspectorModalProps {
  isOpen: boolean;
  onClose: () => void;
  project: CreativeProject;
  initialOperationIntent?: ContextOperationIntent;
  activeSectionId?: string;
  initialReport?: ContextInspectorReport | null;
  onOpenLocksManager?: () => void;
}

export const ContextInspectorModal: React.FC<ContextInspectorModalProps> = ({
  isOpen,
  onClose,
  project,
  initialOperationIntent = 'writing-assist',
  activeSectionId,
  initialReport,
  onOpenLocksManager,
}) => {
  const [operationIntent, setOperationIntent] = useState<ContextOperationIntent>(
    initialReport?.operationIntent ?? initialOperationIntent
  );
  const [scope, setScope] = useState<'scene' | 'changed' | 'full'>('full');
  const [tokenBudget, setTokenBudget] = useState<number>(initialReport?.tokenBudget ?? 6000);
  const [filterTab, setFilterTab] = useState<'planned' | 'omitted' | 'citations'>('planned');
  const [selectedSectionId, setSelectedSectionId] = useState<string>(activeSectionId || '');

  const sections = useMemo(() => manuscriptSections(project), [project]);

  const report: ContextInspectorReport = useMemo(() => {
    if (
      initialReport &&
      initialReport.operationIntent === operationIntent &&
      initialReport.tokenBudget === tokenBudget
    ) {
      return initialReport;
    }
    return assembleOperationContext(project, {
      operationIntent,
      activeSectionId: selectedSectionId || activeSectionId || sections[0]?.id,
      scope,
      tokenBudget,
    });
  }, [initialReport, project, operationIntent, selectedSectionId, activeSectionId, sections, scope, tokenBudget]);

  // Build Citation Diff Cards (UIC-02) from existing claims and diagnostic issue anchors
  const citationCards: CitationDiffCardModel[] = useMemo(() => {
    const anchors: CitationAnchorInput[] = [];
    const sectionIdSet = new Set(sections.map((s) => s.id));
    for (const claim of project.narrative?.claims ?? []) {
      for (let i = 0; i < (claim.anchors ?? []).length; i += 1) {
        const a = claim.anchors[i];
        const targetId = a.sourceId;
        if (!targetId) continue;
        const parsedRev = Number(a.version);
        anchors.push({
          id: `claim_${claim.id}_${i}`,
          label: `Claim (${claim.targetId}): ${claim.rationale}`,
          sourceKind: sectionIdSet.has(targetId) ? 'manuscript' : 'immutable-source',
          targetId,
          anchoredRevision: Number.isFinite(parsedRev) ? parsedRev : undefined,
          startOffset: a.start,
          endOffset: a.end,
          archivedQuote: a.excerpt,
        });
      }
    }
    for (const issue of project.narrative?.issues ?? []) {
      for (let i = 0; i < (issue.anchors ?? []).length; i += 1) {
        const a = issue.anchors[i];
        const targetId = a.sourceId;
        if (!targetId) continue;
        const parsedRev = Number(a.version);
        anchors.push({
          id: `issue_${issue.id}_${i}`,
          label: `Issue (${issue.title})`,
          sourceKind: sectionIdSet.has(targetId) ? 'manuscript' : 'immutable-source',
          targetId,
          anchoredRevision: Number.isFinite(parsedRev) ? parsedRev : undefined,
          startOffset: a.start,
          endOffset: a.end,
          archivedQuote: a.excerpt,
        });
      }
    }
    return anchors.map((a) => resolveCitationDiffCard(project, a));
  }, [project, sections]);

  if (!isOpen) return null;

  const plannedItems = report.items.filter((i) => i.disposition !== 'omitted');
  const omittedItems = report.items.filter((i) => i.disposition === 'omitted');

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/80 p-4 backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
      aria-labelledby="context-inspector-modal-title"
      data-testid="context-inspector-modal"
    >
      <div className="flex max-h-[90vh] w-full max-w-4xl flex-col overflow-hidden rounded-2xl border border-slate-700 bg-slate-900 text-slate-100 shadow-2xl">
        {/* Header */}
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-800 px-6 py-4">
          <div>
            <h2 id="context-inspector-modal-title" className="text-lg font-bold text-white">
              Context Inspector &amp; Visual Scope Curtain (UIC-01 / UIC-02)
            </h2>
            <p className="text-xs text-slate-400">
              Transparent preflight breakdown of exact planned, sent, and omitted narrative memory spans, creative locks, and citation anchors. Opening this inspector never dispatches an AI request.
            </p>
          </div>
          <div className="flex items-center gap-2">
            {onOpenLocksManager && (
              <button
                type="button"
                data-testid="inspector-open-locks-btn"
                onClick={onOpenLocksManager}
                className="rounded-lg border border-amber-500/40 bg-amber-950/50 px-2.5 py-1 text-xs font-medium text-amber-200 hover:bg-amber-900/60"
              >
                Manage Creative Locks ({report.activeLocks.length})
              </button>
            )}
            <button
              type="button"
              data-testid="close-context-inspector-btn"
              onClick={onClose}
              className="rounded-lg border border-slate-700 px-2.5 py-1 text-xs text-slate-300 hover:bg-slate-800"
            >
              Close
            </button>
          </div>
        </div>

        {/* Scope & Operation Controls */}
        <div className="grid gap-3 border-b border-slate-800 bg-slate-950/60 px-6 py-3.5 sm:grid-cols-4 text-xs">
          <div>
            <label htmlFor="ctx-intent-select" className="block text-[10px] uppercase text-slate-500">
              Operation Intent
            </label>
            <select
              id="ctx-intent-select"
              data-testid="context-intent-select"
              value={operationIntent}
              onChange={(e) => setOperationIntent(e.target.value as ContextOperationIntent)}
              className="mt-1 w-full rounded border border-slate-700 bg-slate-900 px-2.5 py-1.5 text-xs text-slate-200"
            >
              <option value="writing-assist">Writing Assistant</option>
              <option value="diagnostics">Consistency Diagnostics</option>
              <option value="narrative-sync">Narrative Sync</option>
              <option value="plan-bridge">Plan ↔ Manuscript Bridge</option>
              <option value="batch-edit">Batch Edit</option>
            </select>
          </div>

          <div>
            <label htmlFor="ctx-scope-select" className="block text-[10px] uppercase text-slate-500">
              Scope Window
            </label>
            <select
              id="ctx-scope-select"
              data-testid="context-scope-select"
              value={scope}
              onChange={(e) => setScope(e.target.value as 'scene' | 'changed' | 'full')}
              className="mt-1 w-full rounded border border-slate-700 bg-slate-900 px-2.5 py-1.5 text-xs text-slate-200"
            >
              <option value="full">Full Manuscript &amp; Memory</option>
              <option value="scene">Focused Scene Only</option>
              <option value="changed">Changed Sections</option>
            </select>
          </div>

          <div>
            <label htmlFor="ctx-section-select" className="block text-[10px] uppercase text-slate-500">
              Focused Scene
            </label>
            <select
              id="ctx-section-select"
              value={selectedSectionId || activeSectionId || sections[0]?.id || ''}
              onChange={(e) => setSelectedSectionId(e.target.value)}
              className="mt-1 w-full rounded border border-slate-700 bg-slate-900 px-2.5 py-1.5 text-xs text-slate-200"
            >
              {sections.map((sec, idx) => (
                <option key={sec.id} value={sec.id}>
                  #{idx + 1}: {sec.title || sec.id}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label htmlFor="ctx-budget-input" className="block text-[10px] uppercase text-slate-500">
              Token Budget
            </label>
            <input
              id="ctx-budget-input"
              type="number"
              min={500}
              max={32000}
              step={500}
              value={tokenBudget}
              onChange={(e) => setTokenBudget(Math.max(500, Number(e.target.value) || 4000))}
              className="mt-1 w-full rounded border border-slate-700 bg-slate-900 px-2.5 py-1.5 font-mono text-xs text-slate-200"
            />
          </div>
        </div>

        {/* Accounting Summary Bar */}
        <div
          data-testid="context-inspector-accounting-bar"
          className="grid grid-cols-3 gap-2 border-b border-slate-800 bg-slate-900/90 px-6 py-3 sm:grid-cols-6 text-center text-xs"
        >
          <div className="rounded border border-slate-800 bg-slate-950/60 p-2">
            <div className="text-[10px] uppercase text-slate-500">Requested</div>
            <div className="font-mono text-sm font-bold text-slate-200">{report.counts.requested}</div>
          </div>
          <div className="rounded border border-slate-800 bg-slate-950/60 p-2">
            <div className="text-[10px] uppercase text-slate-500">Eligible</div>
            <div className="font-mono text-sm font-bold text-sky-300">{report.counts.eligible}</div>
          </div>
          <div className="rounded border border-slate-800 bg-slate-950/60 p-2">
            <div className="text-[10px] uppercase text-slate-500">Planned</div>
            <div className="font-mono text-sm font-bold text-emerald-300">{report.counts.planned}</div>
          </div>
          <div className="rounded border border-slate-800 bg-slate-950/60 p-2">
            <div className="text-[10px] uppercase text-slate-500">Omitted</div>
            <div className="font-mono text-sm font-bold text-amber-300">{report.counts.omitted}</div>
          </div>
          <div className="rounded border border-slate-800 bg-slate-950/60 p-2">
            <div className="text-[10px] uppercase text-slate-500">Est. Tokens</div>
            <div className="font-mono text-sm font-bold text-indigo-300">
              {report.estimatedPlannedTokens} / {report.tokenBudget}
            </div>
          </div>
          <div className="rounded border border-slate-800 bg-slate-950/60 p-2">
            <div className="text-[10px] uppercase text-slate-500">Active Locks</div>
            <div className="font-mono text-sm font-bold text-amber-200">{report.activeLocks.length}</div>
          </div>
        </div>

        {/* View Tabs */}
        <div className="flex items-center gap-2 border-b border-slate-800 px-6 py-2.5 text-xs">
          <button
            type="button"
            data-testid="ctx-tab-planned"
            onClick={() => setFilterTab('planned')}
            className={`rounded-lg px-3 py-1.5 font-semibold ${
              filterTab === 'planned'
                ? 'bg-emerald-600 text-white'
                : 'bg-slate-800 text-slate-300 hover:bg-slate-700'
            }`}
          >
            Planned / Included ({plannedItems.length})
          </button>
          <button
            type="button"
            data-testid="ctx-tab-omitted"
            onClick={() => setFilterTab('omitted')}
            className={`rounded-lg px-3 py-1.5 font-semibold ${
              filterTab === 'omitted'
                ? 'bg-amber-600 text-white'
                : 'bg-slate-800 text-slate-300 hover:bg-slate-700'
            }`}
          >
            Omitted &amp; Reasons ({omittedItems.length})
          </button>
          <button
            type="button"
            data-testid="ctx-tab-citations"
            onClick={() => setFilterTab('citations')}
            className={`rounded-lg px-3 py-1.5 font-semibold ${
              filterTab === 'citations'
                ? 'bg-indigo-600 text-white'
                : 'bg-slate-800 text-slate-300 hover:bg-slate-700'
            }`}
          >
            Citation Diff Cards (UIC-02) ({citationCards.length})
          </button>
        </div>

        {/* Content List */}
        <div className="flex-1 overflow-y-auto p-6 space-y-2.5">
          {filterTab === 'planned' &&
            (plannedItems.length > 0 ? (
              plannedItems.map((item) => (
                <div
                  key={item.id}
                  data-testid="context-planned-item"
                  className="rounded-xl border border-slate-800 bg-slate-950/70 p-3.5 space-y-1.5"
                >
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="flex items-center gap-2">
                      <span className="rounded bg-emerald-950/80 border border-emerald-500/30 px-2 py-0.5 text-[10px] font-semibold uppercase text-emerald-300">
                        {item.kind}
                      </span>
                      <span className="font-semibold text-white text-xs">{item.label}</span>
                      <span className="text-[11px] text-slate-400">{item.subtitle}</span>
                    </div>
                    <span className="font-mono text-[11px] text-slate-400">
                      ~{item.estimatedTokens} tokens · {item.disposition.toUpperCase()}
                    </span>
                  </div>
                  <p className="text-xs text-slate-300 line-clamp-3 whitespace-pre-wrap">
                    {item.excerpt}
                  </p>
                </div>
              ))
            ) : (
              <div className="text-center text-xs text-slate-400 py-8">
                No items planned for this scope.
              </div>
            ))}

          {filterTab === 'omitted' &&
            (omittedItems.length > 0 ? (
              omittedItems.map((item) => (
                <div
                  key={item.id}
                  data-testid="context-omitted-item"
                  className="rounded-xl border border-amber-500/20 bg-slate-950/70 p-3.5 space-y-1.5"
                >
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="flex items-center gap-2">
                      <span className="rounded bg-amber-950/80 border border-amber-500/30 px-2 py-0.5 text-[10px] font-semibold uppercase text-amber-300">
                        Omitted: {item.omissionReason}
                      </span>
                      <span className="font-semibold text-white text-xs">{item.label}</span>
                      <span className="text-[11px] text-slate-400">{item.subtitle}</span>
                    </div>
                    <span className="font-mono text-[11px] text-slate-500">
                      ~{item.estimatedTokens} tokens saved
                    </span>
                  </div>
                  <p className="text-xs text-slate-400 line-clamp-2 whitespace-pre-wrap">
                    {item.excerpt}
                  </p>
                </div>
              ))
            ) : (
              <div className="text-center text-xs text-slate-400 py-8">
                Zero items were omitted under the current scope and token budget.
              </div>
            ))}

          {filterTab === 'citations' &&
            (citationCards.length > 0 ? (
              citationCards.map((card) => (
                <div
                  key={card.anchorId}
                  data-testid="citation-diff-card"
                  className="rounded-xl border border-slate-800 bg-slate-950/80 p-4 space-y-2"
                >
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="font-semibold text-xs text-white">{card.label}</div>
                    <span
                      className={`rounded px-2 py-0.5 text-[10px] font-semibold uppercase ${
                        card.status === 'verified-exact'
                          ? 'bg-emerald-950 text-emerald-300 border border-emerald-500/30'
                          : card.status === 'reanchored-unique'
                            ? 'bg-sky-950 text-sky-300 border border-sky-500/30'
                            : 'bg-rose-950 text-rose-300 border border-rose-500/30'
                      }`}
                    >
                      {card.status}
                      {card.requiresAuthorReview ? ' · Author Review Required' : ''}
                    </span>
                  </div>
                  <p className="text-[11px] text-slate-400">{card.explanation}</p>
                  <div className="grid gap-2 sm:grid-cols-2 text-xs">
                    <div className="rounded border border-slate-800 bg-slate-900/70 p-2.5">
                      <div className="text-[10px] uppercase text-slate-500">
                        Archived Quote ([{card.archivedSpan.startOffset}..{card.archivedSpan.endOffset}])
                      </div>
                      <div className="mt-1 font-serif text-slate-200 whitespace-pre-wrap">
                        {card.archivedSpan.quote}
                      </div>
                    </div>
                    <div className="rounded border border-slate-800 bg-slate-900/70 p-2.5">
                      <div className="text-[10px] uppercase text-slate-500">
                        Current Resolution (r{card.currentRevision})
                      </div>
                      <div className="mt-1 font-serif text-slate-200 whitespace-pre-wrap">
                        {card.resolvedSpan
                          ? `${card.resolvedSpan.excerpt} ([${card.resolvedSpan.startOffset}..${card.resolvedSpan.endOffset}])`
                          : card.currentSliceAtOriginalOffsets || '(No exact single match)'}
                      </div>
                    </div>
                  </div>
                </div>
              ))
            ) : (
              <div className="text-center text-xs text-slate-400 py-8">
                No evidence or issue citation anchors recorded yet for this project.
              </div>
            ))}
        </div>
      </div>
    </div>
  );
};
