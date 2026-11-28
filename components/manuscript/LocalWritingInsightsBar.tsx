import React, { useMemo, useState } from 'react';
import type { ManuscriptSection } from '../../shared/narrativeTypes';

interface LocalWritingInsightsBarProps {
  projectId: string;
  section: ManuscriptSection | undefined;
}

export interface LocalSceneInsightMetrics {
  wordCount: number;
  sentenceCount: number;
  avgSentenceWords: number;
  shortSentenceCount: number;
  longSentenceCount: number;
  dialogueRatioPercent: number;
  paragraphCount: number;
  repeatedPhrases: Array<{ phrase: string; count: number }>;
}

const STOPWORDS = new Set([
  'the', 'and', 'that', 'with', 'from', 'this', 'they', 'their', 'were', 'been',
  'have', 'had', 'for', 'not', 'but', 'she', 'him', 'her', 'his', 'into', 'over',
  'then', 'when', 'what', 'there', 'would', 'could', 'about', 'which', 'into',
  'bir', 've', 'ile', 'ama', 'fakat', 'gibi', 'daha', 'olan', 'olarak', 'için',
]);

/**
 * Pure local narrative cadence & repetition calculator (`UI-NEW-05`, `UI-NEW-07`).
 * Zero AI calls, zero scores or ratings — descriptive cadence observations only.
 */
export function computeLocalSceneInsights(text: string): LocalSceneInsightMetrics {
  const trimmed = text.trim();
  if (!trimmed) {
    return {
      wordCount: 0,
      sentenceCount: 0,
      avgSentenceWords: 0,
      shortSentenceCount: 0,
      longSentenceCount: 0,
      dialogueRatioPercent: 0,
      paragraphCount: 0,
      repeatedPhrases: [],
    };
  }

  const words = trimmed.match(/\S+/gu) ?? [];
  const sentences = trimmed
    .split(/[.!?]+(?:\s+|$)/)
    .map((s) => s.trim())
    .filter(Boolean);
  const sentenceLengths = sentences.map((s) => (s.match(/\S+/gu) ?? []).length);
  const shortSentenceCount = sentenceLengths.filter((len) => len > 0 && len <= 7).length;
  const longSentenceCount = sentenceLengths.filter((len) => len >= 24).length;

  const avgSentenceWords =
    sentenceLengths.length > 0
      ? Math.round(
          (sentenceLengths.reduce((acc, n) => acc + n, 0) / sentenceLengths.length) * 10
        ) / 10
      : 0;

  // Estimate dialogue share across curly/straight quotes & dialogue dashes
  const quotedChars = (trimmed.match(/(?:"[^"]+"|“[^”]+”)/g) ?? []).reduce(
    (sum, chunk) => sum + chunk.length,
    0
  );
  const dialogueRatioPercent = Math.min(
    100,
    Math.round((quotedChars / Math.max(1, trimmed.length)) * 100)
  );

  const paragraphCount = trimmed
    .split(/\n\s*\n+/)
    .map((p) => p.trim())
    .filter(Boolean).length;

  // Repeated non-stopword 2-word phrases & notable content words (local echo detector)
  const normWords = trimmed
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s']/gu, ' ')
    .split(/\s+/)
    .filter((w) => w.length >= 4 && !STOPWORDS.has(w));

  const counts = new Map<string, number>();
  for (const w of normWords) {
    counts.set(w, (counts.get(w) ?? 0) + 1);
  }
  const repeatedPhrases = Array.from(counts.entries())
    .filter(([, count]) => count >= 3)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 6)
    .map(([phrase, count]) => ({ phrase, count }));

  return {
    wordCount: words.length,
    sentenceCount: sentences.length,
    avgSentenceWords,
    shortSentenceCount,
    longSentenceCount,
    dialogueRatioPercent,
    paragraphCount,
    repeatedPhrases,
  };
}

function readIntentionalMotifs(projectId: string): string[] {
  try {
    const raw = window.localStorage?.getItem(`pcc.motifs.${projectId}`);
    return raw ? (JSON.parse(raw) as string[]) : [];
  } catch {
    return [];
  }
}

export const LocalWritingInsightsBar: React.FC<LocalWritingInsightsBarProps> = ({
  projectId,
  section,
}) => {
  const [expanded, setExpanded] = useState(false);
  const [intentionalMotifs, setIntentionalMotifs] = useState<string[]>(() =>
    readIntentionalMotifs(projectId)
  );

  const metrics = useMemo(
    () => computeLocalSceneInsights(section?.text ?? ''),
    [section?.text]
  );

  const handleToggleMotif = (phrase: string) => {
    const next = intentionalMotifs.includes(phrase)
      ? intentionalMotifs.filter((m) => m !== phrase)
      : [...intentionalMotifs, phrase];
    setIntentionalMotifs(next);
    try {
      window.localStorage?.setItem(`pcc.motifs.${projectId}`, JSON.stringify(next));
    } catch {
      // ignore storage errors
    }
  };

  if (!section) return null;

  return (
    <div
      data-testid="local-writing-insights-footer"
      className="mt-4 rounded-xl border border-pcc-line bg-pcc-canvas/70 px-3.5 py-2 text-xs text-pcc-muted dark:border-pcc-dark-line dark:bg-pcc-dark-canvas/70 dark:text-pcc-dark-muted"
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-3">
          <span>
            <strong className="text-pcc-ink dark:text-pcc-dark-ink">
              {metrics.wordCount}
            </strong>{' '}
            words
          </span>
          <span>·</span>
          <span>
            {metrics.paragraphCount} paragraphs · {metrics.sentenceCount} sentences
          </span>
          <span>·</span>
          <span>Avg {metrics.avgSentenceWords} w/sentence</span>
          <span>·</span>
          <span>Dialogue {metrics.dialogueRatioPercent}%</span>
        </div>
        <button
          type="button"
          data-testid="toggle-writing-insights-btn"
          aria-expanded={expanded}
          onClick={() => setExpanded((prev) => !prev)}
          className="rounded-md border border-pcc-line px-2 py-0.5 text-[11px] font-medium text-pcc-ink hover:bg-pcc-surface dark:border-pcc-dark-line dark:text-pcc-dark-ink dark:hover:bg-pcc-dark-surface"
        >
          {expanded ? 'Hide Writing Insights' : 'Scene Rhythm & Motifs (Local)'}
        </button>
      </div>

      {expanded && (
        <div className="mt-2.5 grid gap-3 border-t border-pcc-line pt-2.5 sm:grid-cols-2 dark:border-pcc-dark-line">
          <div className="space-y-1">
            <div className="text-[11px] font-semibold uppercase tracking-wide text-pcc-ink dark:text-pcc-dark-ink">
              Scene Rhythm &amp; Pacing Cadence
            </div>
            <p className="text-[11px]">
              Short punchy sentences (≤7 words):{' '}
              <strong>{metrics.shortSentenceCount}</strong> · Long complex sentences (≥24 words):{' '}
              <strong>{metrics.longSentenceCount}</strong>
            </p>
            <p className="text-[11px]">
              Dialogue vs. narration balance: <strong>{metrics.dialogueRatioPercent}%</strong> quoted
              dialogue / <strong>{100 - metrics.dialogueRatioPercent}%</strong> prose &amp; interiority.
            </p>
          </div>

          <div className="space-y-1">
            <div className="text-[11px] font-semibold uppercase tracking-wide text-pcc-ink dark:text-pcc-dark-ink">
              Repeated Words &amp; Motifs (Opt-in Local Echo Check)
            </div>
            {metrics.repeatedPhrases.length === 0 ? (
              <p className="text-[11px]">
                No frequent word echoes detected (3+ occurrences) in this scene.
              </p>
            ) : (
              <div className="flex flex-wrap gap-1.5">
                {metrics.repeatedPhrases.map(({ phrase, count }) => {
                  const isMotif = intentionalMotifs.includes(phrase);
                  return (
                    <button
                      key={phrase}
                      type="button"
                      onClick={() => handleToggleMotif(phrase)}
                      title={
                        isMotif
                          ? 'Marked as intentional motif (click to unmark)'
                          : 'Click to mark as an intentional motif'
                      }
                      className={`rounded-md border px-2 py-0.5 text-[11px] ${
                        isMotif
                          ? 'border-emerald-500/40 bg-emerald-950/20 text-emerald-700 dark:text-emerald-300'
                          : 'border-pcc-line bg-pcc-surface text-pcc-ink dark:border-pcc-dark-line dark:bg-pcc-dark-surface dark:text-pcc-dark-ink'
                      }`}
                    >
                      {phrase} ({count}×) {isMotif ? '✓ Motif' : '+ Mark Motif'}
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
};
