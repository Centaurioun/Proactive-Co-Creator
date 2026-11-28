import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { EmbeddingBatchResponse } from '../../shared/embeddingSchema';
import { NarrativeMemoryIndexSnapshot } from '../../shared/narrativeMemoryTypes';
import { CreativeProject } from '../../shared/types';
import { manuscriptSections } from '../../lib/narrative/manuscriptModel';
import {
  executeHybridNarrativeSearch,
  HybridSearchResponse,
  HybridSearchResultItem,
  HybridSearchScopeFilter,
  QueryVectorInput,
} from '../../lib/narrative/memory/hybridSearch';
import { ensureFreshNarrativeMemoryIndex } from '../../lib/narrative/memory/indexRepository';
import {
  getCachedQueryVector,
  loadProjectVectorRecords,
  setCachedQueryVector,
  StoredChunkVectorRecord,
} from '../../lib/narrative/memory/vectorRepository';

interface NarrativeSearchModalProps {
  isOpen: boolean;
  onClose: () => void;
  project: CreativeProject;
  onJumpToSection?: (sectionId: string) => void;
  onOpenAiSettings?: () => void;
}

export const NarrativeSearchModal: React.FC<NarrativeSearchModalProps> = ({
  isOpen,
  onClose,
  project,
  onJumpToSection,
  onOpenAiSettings,
}) => {
  const [query, setQuery] = useState('');
  const [scope, setScope] = useState<HybridSearchScopeFilter>('all');
  const [spoilerBoundary, setSpoilerBoundary] = useState<number | 'all'>('all');
  const [indexSnapshot, setIndexSnapshot] = useState<NarrativeMemoryIndexSnapshot | null>(null);
  const [storedVectors, setStoredVectors] = useState<StoredChunkVectorRecord[]>([]);
  const [queryVectors, setQueryVectors] = useState<QueryVectorInput[]>([]);
  const [semanticStatus, setSemanticStatus] = useState<string | null>(null);
  const [semanticLoading, setSemanticLoading] = useState(false);
  const [peekItem, setPeekItem] = useState<HybridSearchResultItem | null>(null);

  const sortedSections = useMemo(() => manuscriptSections(project), [project]);

  const refreshLocalIndex = useCallback(async () => {
    const snap = await ensureFreshNarrativeMemoryIndex(project);
    setIndexSnapshot(snap);
    const vecs = await loadProjectVectorRecords(project.id);
    setStoredVectors(vecs);
  }, [project]);

  useEffect(() => {
    if (!isOpen) return;
    void Promise.resolve().then(() => refreshLocalIndex());
  }, [isOpen, refreshLocalIndex]);

  const searchResponse: HybridSearchResponse | null = useMemo(() => {
    if (!indexSnapshot || !query.trim()) return null;
    return executeHybridNarrativeSearch(indexSnapshot, {
      query,
      scope,
      maxPresentationOrder: spoilerBoundary === 'all' ? undefined : spoilerBoundary,
      queryVectors,
      storedVectors,
      limit: 30,
    });
  }, [indexSnapshot, query, scope, spoilerBoundary, queryVectors, storedVectors]);

  const handleRunSemanticFusion = async () => {
    const trimmed = query.trim();
    if (!trimmed || !indexSnapshot) return;
    setSemanticLoading(true);
    setSemanticStatus(null);

    try {
      // Check if we already have cached query vectors for stored namespaces
      const distinctNamespaces = Array.from(
        new Map(storedVectors.map((v) => [v.namespace.namespaceKey, v.namespace])).values()
      );
      const cachedInputs: QueryVectorInput[] = [];
      for (const ns of distinctNamespaces) {
        const cached = getCachedQueryVector(project.id, ns.namespaceKey, trimmed);
        if (cached) {
          cachedInputs.push(cached);
        }
      }

      if (cachedInputs.length > 0 && cachedInputs.length === distinctNamespaces.length) {
        setQueryVectors(cachedInputs);
        setSemanticStatus(`Fused cached semantic query vector(s) across ${cachedInputs.length} namespace(s).`);
        setSemanticLoading(false);
        return;
      }

      const res = await fetch('/api/ai/embeddings/embed', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          projectId: project.id,
          projectRevision: indexSnapshot.projectRevision,
          taskType: 'query',
          taskInstruction: 'narrative-passage',
          items: [
            {
              id: 'search_query',
              chunkDigest: 'query',
              text: trimmed,
            },
          ],
        }),
      });
      const payload = (await res.json()) as EmbeddingBatchResponse & { error?: string };
      if (!res.ok) {
        setSemanticStatus(payload.error || 'Semantic query request failed. Showing local lexical & structured results.');
        setSemanticLoading(false);
        return;
      }

      const nextQueryVectors: QueryVectorInput[] = [];
      const skippedReasons: string[] = [];
      for (const r of payload.results ?? []) {
        if (r.status === 'ok' && r.namespace && r.vectors?.[0]?.vector) {
          setCachedQueryVector(project.id, r.namespace, trimmed, r.vectors[0].vector);
          nextQueryVectors.push({
            namespace: r.namespace,
            vector: r.vectors[0].vector,
          });
        } else if (r.reason) {
          skippedReasons.push(`${r.providerId}: ${r.reason}`);
        }
      }

      setQueryVectors(nextQueryVectors);
      if (nextQueryVectors.length > 0) {
        setSemanticStatus(
          `Semantic RRF fusion active across ${nextQueryVectors.length} namespace(s).${
            skippedReasons.length > 0 ? ` (Skipped: ${skippedReasons.join('; ')})` : ''
          }`
        );
      } else {
        setSemanticStatus(
          skippedReasons.length > 0
            ? `No semantic vectors returned (${skippedReasons.join('; ')}). Showing local BM25 & structured results.`
            : 'Semantic embeddings are currently Off in AI Settings. Showing 100% local BM25 & structured results.'
        );
      }
    } catch (err) {
      setSemanticStatus(
        err instanceof Error
          ? `${err.message}. Showing local BM25 & structured results.`
          : 'Semantic query unavailable. Showing local results.'
      );
    } finally {
      setSemanticLoading(false);
    }
  };

  if (!isOpen) return null;

  const renderHighlightedExcerpt = (item: HybridSearchResultItem) => {
    const text = item.excerpt;
    const span = item.highlightSpan;
    if (!span || span.start < 0 || span.end > text.length || span.start >= span.end) {
      return <span>{text}</span>;
    }
    return (
      <>
        <span>{text.slice(0, span.start)}</span>
        <mark className="rounded bg-amber-400/30 px-1 text-amber-100">
          {text.slice(span.start, span.end)}
        </mark>
        <span>{text.slice(span.end)}</span>
      </>
    );
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/80 p-4 backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
      aria-labelledby="narrative-search-modal-title"
      data-testid="narrative-search-modal"
    >
      <div className="flex max-h-[90vh] w-full max-w-4xl flex-col overflow-hidden rounded-2xl border border-slate-700 bg-slate-900 text-slate-100 shadow-2xl">
        {/* Header */}
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-800 px-6 py-4">
          <div>
            <h2 id="narrative-search-modal-title" className="text-lg font-bold text-white">
              Search &amp; Narrative Memory (E1 Hybrid Retrieval)
            </h2>
            <p className="text-xs text-slate-400">
              Combines exact structured lookup, Turkish-aware lexical BM25, and optional namespace-isolated semantic RRF fusion.
            </p>
          </div>
          <div className="flex items-center gap-2">
            {onOpenAiSettings && (
              <button
                type="button"
                onClick={onOpenAiSettings}
                className="rounded-lg border border-slate-700 bg-slate-800 px-2.5 py-1 text-xs text-slate-200 hover:bg-slate-700"
              >
                Embeddings Settings
              </button>
            )}
            <button
              type="button"
              data-testid="close-narrative-search-btn"
              onClick={onClose}
              className="rounded-lg border border-slate-700 px-2.5 py-1 text-xs text-slate-300 hover:bg-slate-800"
            >
              Close
            </button>
          </div>
        </div>

        {/* Search Input & Controls */}
        <div className="space-y-3 border-b border-slate-800 bg-slate-950/60 px-6 py-4">
          <div className="flex flex-wrap gap-2">
            <input
              type="search"
              data-testid="narrative-search-input"
              value={query}
              onChange={(e) => {
                setQuery(e.target.value);
                setQueryVectors([]);
                setSemanticStatus(null);
              }}
              placeholder="Search characters, aliases, Turkish/English prose, relationships, or scenes…"
              autoFocus
              className="min-w-[240px] flex-1 rounded-xl border border-slate-700 bg-slate-900 px-3.5 py-2 text-sm text-white placeholder-slate-500 focus:border-indigo-500 focus:outline-none"
            />
            <button
              type="button"
              data-testid="run-semantic-search-btn"
              disabled={!query.trim() || semanticLoading}
              onClick={() => void handleRunSemanticFusion()}
              className="rounded-xl border border-indigo-500/40 bg-indigo-950/60 px-3.5 py-2 text-xs font-semibold text-indigo-200 hover:bg-indigo-900/60 disabled:opacity-40"
            >
              {semanticLoading ? 'Embedding Query…' : 'Fuse Semantic Vectors (Explicit)'}
            </button>
          </div>

          <div className="flex flex-wrap items-center justify-between gap-3 text-xs">
            {/* Scope Filter */}
            <div className="flex flex-wrap items-center gap-1.5" role="group" aria-label="Search scope filter">
              <span className="text-slate-400">Scope:</span>
              {(
                [
                  { id: 'all', label: 'All Memory' },
                  { id: 'manuscript', label: 'Working Manuscript' },
                  { id: 'immutable-source', label: 'Immutable Source' },
                  { id: 'story-model', label: 'Entities & Relationships' },
                ] as const
              ).map((tab) => (
                <button
                  key={tab.id}
                  type="button"
                  data-testid={`search-scope-${tab.id}`}
                  onClick={() => setScope(tab.id)}
                  className={`rounded-md px-2.5 py-1 text-xs font-medium transition ${
                    scope === tab.id
                      ? 'bg-indigo-600 text-white'
                      : 'bg-slate-800 text-slate-300 hover:bg-slate-700'
                  }`}
                >
                  {tab.label}
                </button>
              ))}
            </div>

            {/* Reader Spoiler Boundary */}
            <div className="flex items-center gap-2">
              <label htmlFor="spoiler-boundary-select" className="text-slate-400">
                Reader Boundary:
              </label>
              <select
                id="spoiler-boundary-select"
                data-testid="spoiler-boundary-select"
                value={spoilerBoundary === 'all' ? 'all' : String(spoilerBoundary)}
                onChange={(e) =>
                  setSpoilerBoundary(e.target.value === 'all' ? 'all' : Number(e.target.value))
                }
                className="rounded-md border border-slate-700 bg-slate-900 px-2.5 py-1 text-xs text-slate-200"
              >
                <option value="all">Full Author View (No Spoiler Filter)</option>
                {sortedSections.map((sec, idx) => (
                  <option key={sec.id} value={String(idx)}>
                    Up to Scene #{idx + 1}: {sec.title || `Section ${idx + 1}`}
                  </option>
                ))}
              </select>
            </div>
          </div>

          {/* Index Coverage & Semantic Diagnostics Bar */}
          {indexSnapshot && (
            <div className="flex flex-wrap items-center justify-between gap-2 text-[11px] text-slate-400">
              <span>
                Local Index <strong className="text-slate-200">r{indexSnapshot.projectRevision}</strong> ·{' '}
                {indexSnapshot.coverage.totalChunks} chunks · {indexSnapshot.coverage.activeEntities} entities ·{' '}
                {storedVectors.length} stored vector(s)
              </span>
              {searchResponse && searchResponse.spoilerFilteredCount > 0 && (
                <span
                  data-testid="spoiler-filtered-badge"
                  className="rounded border border-amber-500/30 bg-amber-950/40 px-2 py-0.5 text-amber-200"
                >
                  Spoiler Filter: hid {searchResponse.spoilerFilteredCount} later/unverified item(s)
                </span>
              )}
            </div>
          )}

          {semanticStatus && (
            <div
              data-testid="semantic-search-status"
              className="rounded-lg border border-indigo-500/30 bg-indigo-950/30 px-3 py-1.5 text-xs text-indigo-200"
            >
              {semanticStatus}
            </div>
          )}
        </div>

        {/* Results Body */}
        <div className="flex-1 overflow-y-auto p-6 space-y-3">
          {!query.trim() ? (
            <div className="rounded-xl border border-slate-800 bg-slate-950/50 p-6 text-center text-xs text-slate-400">
              Enter a search query above to search across your working manuscript, immutable imported source snapshots, character entities, aliases, attributes, and relationships.
            </div>
          ) : searchResponse && searchResponse.results.length > 0 ? (
            searchResponse.results.map((item) => (
              <div
                key={item.anchorKey}
                data-testid="narrative-search-result-card"
                className="rounded-xl border border-slate-800 bg-slate-950/70 p-4 space-y-2 transition hover:border-slate-700"
              >
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div>
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-semibold text-white">{item.title}</span>
                      <span className="rounded border border-slate-700 bg-slate-900 px-2 py-0.5 font-mono text-[10px] text-slate-300">
                        r{item.projectRevision}
                      </span>
                      <span className="text-xs text-slate-400">{item.subtitle}</span>
                    </div>
                  </div>
                  <div className="flex flex-wrap items-center gap-1.5">
                    {item.channels.map((ch) => (
                      <span
                        key={`${ch.channel}_${ch.namespaceKey ?? ''}`}
                        className={`rounded px-2 py-0.5 text-[10px] font-semibold ${
                          ch.channel === 'structured-exact'
                            ? 'bg-emerald-950/80 text-emerald-300 border border-emerald-500/30'
                            : ch.channel === 'lexical-bm25'
                              ? 'bg-sky-950/80 text-sky-300 border border-sky-500/30'
                              : 'bg-purple-950/80 text-purple-300 border border-purple-500/30'
                        }`}
                      >
                        {ch.label} #{ch.rank}
                      </span>
                    ))}
                    <span className="font-mono text-[10px] text-slate-500">
                      RRF {item.rrfScore.toFixed(4)}
                    </span>
                  </div>
                </div>

                <p className="text-xs leading-relaxed text-slate-200 whitespace-pre-wrap">
                  {renderHighlightedExcerpt(item)}
                </p>

                <div className="flex flex-wrap items-center justify-end gap-2 pt-1">
                  <button
                    type="button"
                    data-testid="search-result-peek-btn"
                    onClick={() => setPeekItem(peekItem?.anchorKey === item.anchorKey ? null : item)}
                    className="rounded border border-slate-700 bg-slate-800 px-2.5 py-1 text-xs text-slate-200 hover:bg-slate-700"
                  >
                    {peekItem?.anchorKey === item.anchorKey ? 'Hide Source Peek' : 'Source Peek'}
                  </button>
                  {item.sourceKind === 'manuscript' && item.sectionId && onJumpToSection && (
                    <button
                      type="button"
                      data-testid="search-result-jump-btn"
                      onClick={() => {
                        onJumpToSection(item.sectionId!);
                        onClose();
                      }}
                      className="rounded bg-indigo-600 px-2.5 py-1 text-xs font-semibold text-white hover:bg-indigo-500"
                    >
                      Open Scene in Write
                    </button>
                  )}
                </div>

                {peekItem?.anchorKey === item.anchorKey && (
                  <div
                    data-testid="search-result-source-peek"
                    className="mt-2 rounded-lg border border-indigo-500/30 bg-slate-900/90 p-3 text-xs text-slate-300 space-y-1"
                  >
                    <div className="font-semibold text-indigo-300">
                      Provenance &amp; Anchor Verification
                    </div>
                    <div className="font-mono text-[11px] text-slate-400">
                      Anchor: {item.anchorKey} · Revision: r{item.projectRevision}
                      {item.startOffset !== undefined && item.endOffset !== undefined
                        ? ` · Exact UTF-16 Span: [${item.startOffset}..${item.endOffset}] (${item.endOffset - item.startOffset} code units)`
                        : ''}
                    </div>
                    <div className="rounded bg-slate-950 p-2.5 font-serif text-xs text-slate-200 whitespace-pre-wrap">
                      {item.excerpt}
                    </div>
                  </div>
                )}
              </div>
            ))
          ) : (
            <div
              data-testid="narrative-search-empty-results"
              className="rounded-xl border border-slate-800 bg-slate-950/50 p-6 text-center text-xs text-slate-400"
            >
              No matching passages, entities, or relationships found for &ldquo;{query}&rdquo; under the selected scope and reader boundary.
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
