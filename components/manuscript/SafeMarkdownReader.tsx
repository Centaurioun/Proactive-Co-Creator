import React, { useMemo, useState } from 'react';
import type { CreativeProject } from '../../shared/types';
import type { ManuscriptSection } from '../../shared/narrativeTypes';
import type { ReadingMarginNote } from '../../shared/creativeSessionTypes';
import { createReadingMarginNote } from '../../lib/narrative/sessions/creativeSessionEngine';
import { computeDeterministicDigest } from '../../lib/narrative/memory/textNormalization';

interface SafeMarkdownReaderProps {
  project: CreativeProject;
  section: ManuscriptSection;
  marginNotes: ReadingMarginNote[];
  onSaveMarginNotes: (notes: ReadingMarginNote[]) => void;
  onExplorePassageInStudio?: (payload: {
    sectionId: string;
    sectionTitle: string;
    startOffset: number;
    endOffset: number;
    selectedText: string;
    initialGoal?: string;
  }) => void;
  onAskQaAboutPassage?: (query: string) => void;
}

type MarkdownBlock =
  | { type: 'heading'; level: 1 | 2 | 3; text: string; startOffset: number }
  | { type: 'blockquote'; text: string; startOffset: number }
  | { type: 'list'; items: string[]; ordered: boolean; startOffset: number }
  | { type: 'hr'; startOffset: number }
  | { type: 'paragraph'; text: string; startOffset: number };

/**
 * Pure safe Markdown block parser (`UIRF-06`).
 * Treats raw HTML tags (`<script>`, `<img>`, `<iframe>`, etc.) as literal escaped text
 * and never executes or interprets raw HTML or unsafe URLs.
 */
export function parseSafeMarkdownBlocks(text: string): MarkdownBlock[] {
  const lines = text.split('\n');
  const blocks: MarkdownBlock[] = [];
  let offset = 0;
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];
    const trimmed = line.trim();

    if (!trimmed) {
      offset += line.length + 1;
      i += 1;
      continue;
    }

    if (/^(?:---|\*\*\*|___)$/.test(trimmed)) {
      blocks.push({ type: 'hr', startOffset: offset });
      offset += line.length + 1;
      i += 1;
      continue;
    }

    const headingMatch = /^(#{1,3})\s+(.+)$/.exec(trimmed);
    if (headingMatch) {
      blocks.push({
        type: 'heading',
        level: Math.min(3, headingMatch[1].length) as 1 | 2 | 3,
        text: headingMatch[2],
        startOffset: offset,
      });
      offset += line.length + 1;
      i += 1;
      continue;
    }

    if (trimmed.startsWith('>')) {
      const startOffset = offset;
      const quoteLines: string[] = [];
      while (i < lines.length && lines[i].trim().startsWith('>')) {
        quoteLines.push(lines[i].trim().replace(/^>\s?/, ''));
        offset += lines[i].length + 1;
        i += 1;
      }
      blocks.push({
        type: 'blockquote',
        text: quoteLines.join('\n'),
        startOffset,
      });
      continue;
    }

    const unorderedMatch = /^[-*+]\s+(.+)$/.exec(trimmed);
    const orderedMatch = /^\d+\.\s+(.+)$/.exec(trimmed);
    if (unorderedMatch || orderedMatch) {
      const startOffset = offset;
      const ordered = Boolean(orderedMatch);
      const items: string[] = [];
      while (i < lines.length) {
        const curTrim = lines[i].trim();
        const m = ordered ? /^\d+\.\s+(.+)$/.exec(curTrim) : /^[-*+]\s+(.+)$/.exec(curTrim);
        if (!m) break;
        items.push(m[1]);
        offset += lines[i].length + 1;
        i += 1;
      }
      blocks.push({ type: 'list', items, ordered, startOffset });
      continue;
    }

    const startOffset = offset;
    const paraLines: string[] = [];
    while (
      i < lines.length &&
      lines[i].trim() &&
      !/^(#{1,3}\s+|>\s?|[-*+]\s+|\d+\.\s+|---|___|\*\*\*)/.test(lines[i].trim())
    ) {
      paraLines.push(lines[i]);
      offset += lines[i].length + 1;
      i += 1;
    }
    blocks.push({
      type: 'paragraph',
      text: paraLines.join(' '),
      startOffset,
    });
  }

  return blocks;
}

/**
 * Renders safe inline Markdown formatting (bold, italic, inline code) as React elements.
 * Raw HTML strings remain harmless literal text.
 */
function renderSafeInline(text: string): React.ReactNode[] {
  const tokens: React.ReactNode[] = [];
  const regex = /(\*\*[^*]+\*\*|\*[^*]+\*|`[^`]+`)/g;
  let lastIndex = 0;
  let match: RegExpExecArray | null;
  let keyIdx = 0;

  while ((match = regex.exec(text)) !== null) {
    if (match.index > lastIndex) {
      tokens.push(text.slice(lastIndex, match.index));
    }
    const token = match[0];
    if (token.startsWith('**') && token.endsWith('**')) {
      tokens.push(<strong key={keyIdx++} className="font-semibold">{token.slice(2, -2)}</strong>);
    } else if (token.startsWith('*') && token.endsWith('*')) {
      tokens.push(<em key={keyIdx++} className="italic">{token.slice(1, -1)}</em>);
    } else if (token.startsWith('`') && token.endsWith('`')) {
      tokens.push(
        <code key={keyIdx++} className="rounded bg-pcc-line/40 px-1 py-0.5 font-mono text-[0.85em] dark:bg-pcc-dark-line/50">
          {token.slice(1, -1)}
        </code>
      );
    }
    lastIndex = match.index + token.length;
  }

  if (lastIndex < text.length) {
    tokens.push(text.slice(lastIndex));
  }

  return tokens;
}

export const SafeMarkdownReader: React.FC<SafeMarkdownReaderProps> = ({
  project,
  section,
  marginNotes,
  onSaveMarginNotes,
  onExplorePassageInStudio,
  onAskQaAboutPassage,
}) => {
  const [selectedPassage, setSelectedPassage] = useState<{
    text: string;
    startOffset: number;
    endOffset: number;
  } | null>(null);
  const [noteDraft, setNoteDraft] = useState('');
  const [showArchivedNotes, setShowArchivedNotes] = useState(false);

  const blocks = useMemo(() => parseSafeMarkdownBlocks(section.text || ''), [section.text]);
  const currentDigest = useMemo(
    () => computeDeterministicDigest(section.text || ''),
    [section.text]
  );

  const sectionNotes = useMemo(
    () =>
      marginNotes.filter(
        (n) =>
          n.sectionId === section.id &&
          (showArchivedNotes || n.status !== 'archived')
      ),
    [marginNotes, section.id, showArchivedNotes]
  );

  const handleCaptureBrowserSelection = () => {
    if (typeof window === 'undefined' || !window.getSelection) return;
    const raw = window.getSelection()?.toString().trim();
    if (!raw) return;
    const idx = section.text.indexOf(raw);
    const startOffset = idx >= 0 ? idx : 0;
    const endOffset = idx >= 0 ? idx + raw.length : Math.min(raw.length, section.text.length);
    setSelectedPassage({
      text: raw,
      startOffset,
      endOffset,
    });
  };

  const handleSelectBlockForNote = (text: string, startOffset: number) => {
    setSelectedPassage({
      text,
      startOffset,
      endOffset: Math.min(section.text.length, startOffset + text.length),
    });
  };

  const handleAddMarginNote = () => {
    if (!noteDraft.trim()) return;
    const anchor = selectedPassage ?? {
      text: section.text.slice(0, Math.min(120, section.text.length)),
      startOffset: 0,
      endOffset: Math.min(120, section.text.length),
    };
    const created = createReadingMarginNote(project, {
      sectionId: section.id,
      sectionTitle: section.title || 'Scene',
      sectionContent: section.text,
      startOffset: anchor.startOffset,
      endOffset: anchor.endOffset,
      quotedExcerpt: anchor.text,
      noteText: noteDraft,
    });
    onSaveMarginNotes([created, ...marginNotes]);
    setNoteDraft('');
    setSelectedPassage(null);
  };

  const handleUpdateNoteStatus = (
    noteId: string,
    status: ReadingMarginNote['status']
  ) => {
    onSaveMarginNotes(
      marginNotes.map((n) =>
        n.id === noteId
          ? { ...n, status, updatedAt: new Date().toISOString() }
          : n
      )
    );
  };

  return (
    <div
      className="mt-2 grid gap-4 lg:grid-cols-[minmax(0,1fr)_21rem]"
      data-testid="safe-markdown-reader"
    >
      {/* Clean Formatted Reading Column */}
      <div
        aria-label="Section preview"
        onMouseUp={handleCaptureBrowserSelection}
        className="pcc-editorial pcc-canon-surface min-h-[56vh] max-w-[74ch] overflow-auto rounded-lg border p-6 text-[17px] leading-[1.78] shadow-sm"
      >
        {blocks.length === 0 ? (
          <p className="text-sm text-pcc-muted dark:text-pcc-dark-muted">
            Nothing to preview yet.
          </p>
        ) : (
          <div className="space-y-4">
            {blocks.map((block, idx) => {
              if (block.type === 'hr') {
                return (
                  <hr
                    key={idx}
                    className="my-6 border-pcc-line dark:border-pcc-dark-line"
                  />
                );
              }
              if (block.type === 'heading') {
                const sizeClass =
                  block.level === 1
                    ? 'text-2xl font-bold'
                    : block.level === 2
                      ? 'text-xl font-semibold'
                      : 'text-lg font-semibold';
                return (
                  <div
                    key={idx}
                    onDoubleClick={() =>
                      handleSelectBlockForNote(block.text, block.startOffset)
                    }
                    className={`${sizeClass} font-display tracking-tight text-pcc-ink dark:text-pcc-dark-ink`}
                  >
                    {renderSafeInline(block.text)}
                  </div>
                );
              }
              if (block.type === 'blockquote') {
                return (
                  <blockquote
                    key={idx}
                    onDoubleClick={() =>
                      handleSelectBlockForNote(block.text, block.startOffset)
                    }
                    className="border-l-4 border-pcc-action/50 pl-4 italic text-pcc-muted dark:text-pcc-dark-muted"
                  >
                    {renderSafeInline(block.text)}
                  </blockquote>
                );
              }
              if (block.type === 'list') {
                const Tag = block.ordered ? 'ol' : 'ul';
                return (
                  <Tag
                    key={idx}
                    className={`${block.ordered ? 'list-decimal' : 'list-disc'} ml-6 space-y-1`}
                  >
                    {block.items.map((item, itemIdx) => (
                      <li key={itemIdx}>{renderSafeInline(item)}</li>
                    ))}
                  </Tag>
                );
              }
              return (
                <p
                  key={idx}
                  title="Select text or double-click paragraph to anchor a reading margin note"
                  onDoubleClick={() =>
                    handleSelectBlockForNote(block.text, block.startOffset)
                  }
                  className="cursor-text text-pcc-ink dark:text-pcc-dark-ink"
                >
                  {renderSafeInline(block.text)}
                </p>
              );
            })}
          </div>
        )}
      </div>

      {/* Persistent Reading Margin Notes & Selection Action Rail (`UIC-06`) */}
      <aside
        className="pcc-draft-surface flex flex-col gap-3 rounded-xl p-3.5 text-xs"
        data-testid="reading-margin-notes-rail"
      >
        <div className="flex items-center justify-between gap-2">
          <div>
            <h3 className="font-display text-sm font-bold text-pcc-ink dark:text-pcc-dark-ink">
              Reading Margin Notes
            </h3>
            <p className="text-[11px] text-pcc-muted dark:text-pcc-dark-muted">
              Select or double-click any passage in Read Mode to attach notes.
            </p>
          </div>
          <label className="inline-flex cursor-pointer items-center gap-1 text-[11px] text-pcc-muted">
            <input
              type="checkbox"
              checked={showArchivedNotes}
              onChange={(e) => setShowArchivedNotes(e.target.checked)}
              className="h-3.5 w-3.5 rounded"
            />
            Archived
          </label>
        </div>

        {/* Active Passage Selection Bar */}
        <div className="rounded-lg border border-pcc-line bg-pcc-surface p-2.5 dark:border-pcc-dark-line dark:bg-pcc-dark-surface">
          <div className="text-[10px] font-semibold uppercase tracking-wide text-pcc-muted">
            {selectedPassage ? 'Selected Passage Anchor' : 'Add Margin Note to Scene'}
          </div>
          {selectedPassage && (
            <div className="mt-1 rounded bg-pcc-canvas px-2 py-1 font-serif text-[11px] italic text-pcc-ink dark:bg-pcc-dark-canvas dark:text-pcc-dark-ink">
              “{selectedPassage.text.slice(0, 140)}”
            </div>
          )}
          <textarea
            data-testid="margin-note-input"
            value={noteDraft}
            onChange={(e) => setNoteDraft(e.target.value)}
            rows={2}
            placeholder="Write a margin note or revision reminder…"
            className="mt-2 w-full rounded border border-pcc-line bg-pcc-canvas px-2 py-1.5 text-xs text-pcc-ink dark:border-pcc-dark-line dark:bg-pcc-dark-canvas dark:text-pcc-dark-ink"
          />
          <div className="mt-2 flex flex-wrap gap-1.5">
            <button
              type="button"
              data-testid="save-margin-note-btn"
              onClick={handleAddMarginNote}
              disabled={!noteDraft.trim()}
              className="rounded-md bg-pcc-action px-2.5 py-1 text-[11px] font-semibold text-white hover:bg-pcc-action-hover disabled:opacity-45"
            >
              Save Note
            </button>
            {selectedPassage && onExplorePassageInStudio && (
              <button
                type="button"
                data-testid="margin-explore-studio-btn"
                onClick={() =>
                  onExplorePassageInStudio({
                    sectionId: section.id,
                    sectionTitle: section.title || 'Scene',
                    startOffset: selectedPassage.startOffset,
                    endOffset: selectedPassage.endOffset,
                    selectedText: selectedPassage.text,
                  })
                }
                className="rounded-md border border-pcc-line px-2 py-1 text-[11px] font-medium hover:bg-pcc-canvas dark:border-pcc-dark-line"
              >
                Explore in Studio
              </button>
            )}
            {selectedPassage && onAskQaAboutPassage && (
              <button
                type="button"
                onClick={() =>
                  onAskQaAboutPassage(`Clarify canon for: "${selectedPassage.text.slice(0, 80)}"`)
                }
                className="rounded-md border border-pcc-line px-2 py-1 text-[11px] font-medium hover:bg-pcc-canvas dark:border-pcc-dark-line"
              >
                Ask Q&amp;A
              </button>
            )}
          </div>
        </div>

        {/* Saved Notes List */}
        <div className="max-h-[42vh] space-y-2 overflow-y-auto">
          {sectionNotes.length === 0 ? (
            <div className="rounded-lg border border-pcc-line/60 bg-pcc-surface/60 p-3 text-center text-[11px] text-pcc-muted dark:border-pcc-dark-line dark:bg-pcc-dark-surface/60">
              No margin notes attached to this scene yet.
            </div>
          ) : (
            sectionNotes.map((note) => {
              const isStale = note.textDigest !== currentDigest;
              return (
                <div
                  key={note.id}
                  data-testid={`margin-note-card-${note.id}`}
                  className={`rounded-lg border bg-pcc-surface p-2.5 space-y-1.5 dark:bg-pcc-dark-surface ${
                    note.status === 'resolved'
                      ? 'border-emerald-500/40 opacity-75'
                      : 'border-pcc-line dark:border-pcc-dark-line'
                  }`}
                >
                  <div className="flex flex-wrap items-center justify-between gap-1">
                    <span className="rounded bg-pcc-canvas px-1.5 py-0.5 text-[10px] font-semibold uppercase text-pcc-muted dark:bg-pcc-dark-canvas">
                      {note.status} · r{note.baseRevision}
                    </span>
                    {isStale && (
                      <span className="rounded bg-pcc-stale px-1.5 py-0.5 text-[10px] font-semibold text-pcc-stale-ink">
                        Text changed since note
                      </span>
                    )}
                  </div>
                  {note.quotedExcerpt && (
                    <div className="truncate font-serif text-[11px] italic text-pcc-muted">
                      “{note.quotedExcerpt}”
                    </div>
                  )}
                  <div className="text-xs text-pcc-ink dark:text-pcc-dark-ink">
                    {note.noteText}
                  </div>
                  <div className="flex flex-wrap gap-1 pt-1">
                    {onExplorePassageInStudio && (
                      <button
                        type="button"
                        onClick={() =>
                          onExplorePassageInStudio({
                            sectionId: note.sectionId,
                            sectionTitle: note.sectionTitle,
                            startOffset: note.startOffset,
                            endOffset: note.endOffset,
                            selectedText: note.quotedExcerpt,
                            initialGoal: note.noteText,
                          })
                        }
                        className="rounded border border-pcc-line px-2 py-0.5 text-[10px] font-semibold hover:bg-pcc-canvas dark:border-pcc-dark-line"
                      >
                        Send to Studio
                      </button>
                    )}
                    {note.status === 'open' ? (
                      <button
                        type="button"
                        onClick={() => handleUpdateNoteStatus(note.id, 'resolved')}
                        className="rounded border border-emerald-500/40 px-2 py-0.5 text-[10px] text-emerald-700 dark:text-emerald-300"
                      >
                        Resolve
                      </button>
                    ) : (
                      <button
                        type="button"
                        onClick={() => handleUpdateNoteStatus(note.id, 'open')}
                        className="rounded border border-pcc-line px-2 py-0.5 text-[10px]"
                      >
                        Reopen
                      </button>
                    )}
                    {note.status !== 'archived' && (
                      <button
                        type="button"
                        onClick={() => handleUpdateNoteStatus(note.id, 'archived')}
                        className="rounded border border-pcc-line px-2 py-0.5 text-[10px] text-pcc-muted"
                      >
                        Archive
                      </button>
                    )}
                  </div>
                </div>
              );
            })
          )}
        </div>
      </aside>
    </div>
  );
};
