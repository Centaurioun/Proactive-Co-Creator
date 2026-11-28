import React, { useMemo, useState } from 'react';
import type { CreativeProject } from '../../shared/types';
import { getOrBuildNarrativeMemoryIndexSync } from '../../lib/narrative/memory/indexRepository';
import {
  executeHybridNarrativeSearch,
  type HybridSearchResultItem,
} from '../../lib/narrative/memory/hybridSearch';
import { computeDeterministicDigest } from '../../lib/narrative/memory/textNormalization';
import { manuscriptSections } from '../../lib/narrative/manuscriptModel';
import { createCreativeSession } from '../../lib/narrative/sessions/creativeSessionEngine';
import { executeGroundedCreativeAction } from '../../lib/narrative/sessions/creativeActionService';

interface StoryQaPanelProps {
  project: CreativeProject;
  aiConfigured?: boolean;
  initialQuestion?: string;
  onJumpToSection?: (sectionId: string) => void;
  onTurnInsightIntoStudioDraft?: (payload: {
    question: string;
    answer: string;
    suggestedDirection: string;
    citedSourceIds: string[];
  }) => void;
  onClose?: () => void;
}

export const StoryQaPanel: React.FC<StoryQaPanelProps> = ({
  project,
  aiConfigured = false,
  initialQuestion = '',
  onJumpToSection,
  onTurnInsightIntoStudioDraft,
  onClose,
}) => {
  const [question, setQuestion] = useState(initialQuestion);
  const [useAiAnswer, setUseAiAnswer] = useState(false);
  const [loading, setLoading] = useState(false);
  const [qaResult, setQaResult] = useState<{
    question: string;
    answer: string;
    openGaps: string[];
    suggestedDirection: string;
    hits: HybridSearchResultItem[];
    answeredAtRevision: number;
    sectionDigestsById: Record<string, string>;
  } | null>(null);

  const sections = useMemo(() => manuscriptSections(project), [project]);
  const index = useMemo(
    () => getOrBuildNarrativeMemoryIndexSync(project),
    [project]
  );

  const handleAsk = async (e?: React.FormEvent) => {
    e?.preventDefault();
    const trimmed = question.trim();
    if (!trimmed) return;
    setLoading(true);
    try {
      const searchRes = executeHybridNarrativeSearch(index, {
        query: trimmed,
        scope: 'all',
        limit: 6,
      });
      const hits = searchRes.results;

      const session = createCreativeSession(project, {
        mode: 'discover',
        goal: trimmed,
      });

      const { response } = await executeGroundedCreativeAction(
        project,
        session,
        'story-qa',
        {
          customInput: trimmed,
          useServerAi: useAiAnswer && aiConfigured,
          memoryIndex: index,
        }
      );

      const digests: Record<string, string> = {};
      for (const sec of sections) {
        digests[sec.id] = computeDeterministicDigest(sec.text);
      }

      setQaResult({
        question: trimmed,
        answer:
          response.qaResult?.answer ||
          response.engineSummary,
        openGaps: response.qaResult?.openGaps ?? [],
        suggestedDirection:
          response.qaResult?.suggestedStudioDirection ||
          `Explore "${trimmed.slice(0, 60)}" in Creative Studio`,
        hits,
        answeredAtRevision: project.revision ?? 1,
        sectionDigestsById: digests,
      });
    } finally {
      setLoading(false);
    }
  };

  return (
    <div
      className="flex h-full flex-col gap-3 bg-pcc-surface p-3.5 text-xs text-pcc-ink dark:bg-pcc-dark-surface dark:text-pcc-dark-ink"
      data-testid="story-qa-panel"
    >
      <div className="flex items-start justify-between gap-2 border-b border-pcc-line pb-2.5 dark:border-pcc-dark-line">
        <div>
          <h3 className="font-display text-sm font-bold">
            Story Q&amp;A (Source-Grounded)
          </h3>
          <p className="text-[11px] text-pcc-muted dark:text-pcc-dark-muted">
            Ask any continuity, character, or lore question against the E1 Narrative Memory Index.
          </p>
        </div>
        {onClose && (
          <button
            type="button"
            onClick={onClose}
            className="rounded border border-pcc-line px-2 py-1 text-[11px] hover:bg-pcc-canvas dark:border-pcc-dark-line"
          >
            Close
          </button>
        )}
      </div>

      <form onSubmit={(e) => void handleAsk(e)} className="space-y-2">
        <textarea
          data-testid="story-qa-input"
          value={question}
          onChange={(e) => setQuestion(e.target.value)}
          rows={2}
          placeholder="e.g. What was Arya doing before reaching the Observatory, or why is the astrolabe locked?"
          className="w-full rounded-lg border border-pcc-line bg-pcc-canvas px-2.5 py-2 text-xs text-pcc-ink dark:border-pcc-dark-line dark:bg-pcc-dark-canvas dark:text-pcc-dark-ink"
        />
        <div className="flex flex-wrap items-center justify-between gap-2">
          <label className="inline-flex cursor-pointer items-center gap-1.5 text-[11px] text-pcc-muted">
            <input
              type="checkbox"
              checked={useAiAnswer}
              disabled={!aiConfigured}
              onChange={(e) => setUseAiAnswer(e.target.checked)}
              className="h-3.5 w-3.5 rounded"
            />
            Synthesize with AI {aiConfigured ? '' : '(Offline: Local E1 Canon Search active)'}
          </label>
          <button
            type="submit"
            data-testid="story-qa-submit-btn"
            disabled={!question.trim() || loading}
            className="rounded-lg bg-pcc-action px-3 py-1.5 text-xs font-semibold text-white hover:bg-pcc-action-hover disabled:opacity-45"
          >
            {loading ? 'Searching Canon…' : 'Ask Canon'}
          </button>
        </div>
      </form>

      {qaResult ? (
        <div className="flex-1 space-y-3 overflow-y-auto pr-0.5">
          {/* Answer */}
          <div
            data-testid="story-qa-answer-box"
            className="pcc-reference-surface rounded-xl p-3 space-y-2"
          >
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="text-[10px] font-semibold uppercase tracking-wide text-pcc-evidence-ink dark:text-emerald-300">
                Grounded Canon Answer (r{qaResult.answeredAtRevision})
              </span>
              {qaResult.answeredAtRevision !== project.revision && (
                <span className="rounded bg-pcc-stale px-1.5 py-0.5 text-[10px] font-semibold text-pcc-stale-ink">
                  Canon changed (now r{project.revision})
                </span>
              )}
            </div>
            <div className="whitespace-pre-wrap text-xs leading-relaxed">
              {qaResult.answer}
            </div>
            {qaResult.openGaps.length > 0 && (
              <div className="rounded border border-amber-500/30 bg-amber-950/10 p-2 text-[11px]">
                <div className="font-semibold text-amber-700 dark:text-amber-300">
                  Open Narrative Gaps:
                </div>
                {qaResult.openGaps.map((g, i) => (
                  <div key={i}>• {g}</div>
                ))}
              </div>
            )}

            {onTurnInsightIntoStudioDraft && (
              <button
                type="button"
                data-testid="story-qa-turn-into-studio-btn"
                onClick={() =>
                  onTurnInsightIntoStudioDraft({
                    question: qaResult.question,
                    answer: qaResult.answer,
                    suggestedDirection: qaResult.suggestedDirection,
                    citedSourceIds: qaResult.hits.map((h) => h.sectionId || h.anchorKey),
                  })
                }
                className="w-full rounded-lg border border-pcc-action/40 bg-pcc-action/10 px-3 py-2 text-left text-xs font-semibold text-pcc-action hover:bg-pcc-action/20 dark:text-blue-200"
              >
                Turn Insight into Studio Draft →
              </button>
            )}
          </div>

          {/* Grounded Citations */}
          <div className="space-y-1.5">
            <div className="text-[11px] font-bold uppercase tracking-wide text-pcc-muted">
              Passage Citations &amp; Canon Chunks ({qaResult.hits.length})
            </div>
            {qaResult.hits.map((hit) => {
              const sec = sections.find((s) => s.id === (hit.sectionId || hit.sourceId));
              const isCitationStale =
                Boolean(sec) &&
                qaResult.sectionDigestsById[sec!.id] !== computeDeterministicDigest(sec!.text);

              return (
                <div
                  key={hit.anchorKey}
                  data-testid={`qa-citation-${hit.anchorKey}`}
                  className="rounded-lg border border-pcc-line bg-pcc-canvas p-2.5 space-y-1 dark:border-pcc-dark-line dark:bg-pcc-dark-canvas"
                >
                  <div className="flex flex-wrap items-center justify-between gap-1">
                    <span className="font-semibold">
                      {hit.title}
                    </span>
                    <div className="flex items-center gap-1.5">
                      {isCitationStale && (
                        <span className="rounded bg-pcc-stale px-1.5 py-0.5 text-[10px] font-semibold text-pcc-stale-ink">
                          Source updated
                        </span>
                      )}
                      {sec && onJumpToSection && (
                        <button
                          type="button"
                          onClick={() => onJumpToSection(sec.id)}
                          className="rounded border border-pcc-line px-1.5 py-0.5 text-[10px] font-medium hover:bg-pcc-surface dark:border-pcc-dark-line"
                        >
                          Jump to Scene
                        </button>
                      )}
                    </div>
                  </div>
                  <p className="font-serif text-[11px] text-pcc-muted dark:text-pcc-dark-muted">
                    “{hit.excerpt.slice(0, 180)}”
                  </p>
                </div>
              );
            })}
          </div>
        </div>
      ) : (
        <div className="rounded-xl border border-pcc-line bg-pcc-canvas p-4 text-center text-[11px] text-pcc-muted dark:border-pcc-dark-line dark:bg-pcc-dark-canvas">
          Quick prompts:{' '}
          <button
            type="button"
            onClick={() => setQuestion('What continuity facts are already established in the opening scene?')}
            className="underline hover:text-pcc-ink"
          >
            Opening scene facts
          </button>{' '}
          ·{' '}
          <button
            type="button"
            onClick={() => setQuestion('Which character relationships have unresolved tension?')}
            className="underline hover:text-pcc-ink"
          >
            Unresolved relationships
          </button>
        </div>
      )}
    </div>
  );
};
