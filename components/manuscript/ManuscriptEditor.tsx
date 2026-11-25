import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { ArtifactAnchor, ManuscriptSection } from '../../shared/narrativeTypes';
import type { CreativeProject } from '../../shared/types';
import { applyManuscriptOperation, manuscriptSections, narrativeBase, type NarrativeBase } from '../../lib/narrative/manuscriptModel';
import { filterManuscriptSections } from '../../lib/narrative/manuscriptNavigation';
import { isTextBoundary } from '../../lib/narrative/evidenceRegistry';
import { createStyleProfile, type StyleProfile } from '../../lib/narrative/context/styleProfile';
import AdoptArtifactDialog from './AdoptArtifactDialog';
import WritingAssistantPanel from './WritingAssistantPanel';
import ManuscriptOutlineSidebar from './ManuscriptOutlineSidebar';
import StyleProfilePanel from './StyleProfilePanel';
import type { WritingAssistAction } from '../../shared/narrativeAiSchemas';

export function resolveReturnSelection(
  currentText: string,
  position: { textIdentity: string; start: number; end: number },
): { start: number; end: number; textMatches: boolean } {
  if (position.textIdentity !== currentText) return { start: 0, end: 0, textMatches: false };

  let start = Math.min(position.start, currentText.length);
  let end = Math.min(Math.max(start, position.end), currentText.length);
  if (start === end) {
    while (start > 0 && !isTextBoundary(currentText, start)) start -= 1;
    end = start;
  } else {
    while (start > 0 && !isTextBoundary(currentText, start)) start -= 1;
    while (end < currentText.length && !isTextBoundary(currentText, end)) end += 1;
  }
  return { start, end, textMatches: true };
}

export const workspaceButton = 'min-h-10 rounded-md border border-pcc-line bg-pcc-surface px-3 py-2 text-sm font-medium text-pcc-ink transition-colors hover:bg-pcc-canvas focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-pcc-focus disabled:opacity-45 dark:border-pcc-dark-line dark:bg-pcc-dark-surface dark:text-pcc-dark-ink dark:hover:bg-pcc-dark-canvas';
const field = 'w-full rounded-md border border-pcc-line bg-pcc-surface px-3 py-2 text-pcc-ink focus-visible:outline-none dark:border-pcc-dark-line dark:bg-pcc-dark-surface dark:text-pcc-dark-ink';

interface Props {
  project: CreativeProject;
  onSave: (base: NarrativeBase, sections: ManuscriptSection[], artifact?: ArtifactAnchor, styleProfile?: StyleProfile) => Promise<void>;
  onDirty: (dirty: boolean) => void;
  onCompositionChange?: (composing: boolean) => void;
  isActive?: boolean;
  onUndo: () => void;
  onRedo: () => void;
  canUndo: boolean;
  canRedo: boolean;
  enabled: boolean;
  initialArtifactId?: string;
  focusedSectionId?: string;
  aiConfigured?: boolean;
  onSaveWritingAlternative?: (alternative: {
    sectionId: string;
    action: WritingAssistAction;
    label: string;
    text: string;
    rationale: string;
    assumptions: string[];
  }) => void;
  onExportDraft: (sections: ManuscriptSection[]) => void;
}

export default function ManuscriptEditor({
  project,
  onSave,
  onDirty,
  onCompositionChange,
  isActive = true,
  onUndo,
  onRedo,
  canUndo,
  canRedo,
  enabled,
  initialArtifactId,
  focusedSectionId,
  aiConfigured = false,
  onSaveWritingAlternative,
  onExportDraft,
}: Props) {
  const [draft, setDraft] = useState<{ base: NarrativeBase; sections: ManuscriptSection[]; artifact?: ArtifactAnchor } | null>(null);
  const [selectedId, setSelectedId] = useState(focusedSectionId ?? '');
  const [prevFocusedSectionId, setPrevFocusedSectionId] = useState(focusedSectionId);
  const [selectionRange, setSelectionRange] = useState<{ start: number; end: number }>({ start: 0, end: 0 });
  const [isComposing, setIsComposing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [focus, setFocus] = useState(false);
  const [focusToolsOpen, setFocusToolsOpen] = useState(false);
  const [outlineOpen, setOutlineOpen] = useState(false);
  const [search, setSearch] = useState('');
  const [chapterFilter, setChapterFilter] = useState('');
  const [chronologyFilter, setChronologyFilter] = useState('');
  const [previewSection, setPreviewSection] = useState(false);
  const profileForCurrentVersion = project.narrative?.versions.find(({ id }) => id === project.snapshot.manuscriptVersionId)?.styleProfile ?? createStyleProfile(project.id);
  const styleVersionKey = JSON.stringify([project.id, project.snapshot.manuscriptVersionId]);
  const [previousStyleVersionKey, setPreviousStyleVersionKey] = useState(styleVersionKey);
  const [styleProfile, setStyleProfile] = useState<StyleProfile>(() => profileForCurrentVersion);
  const [adopting, setAdopting] = useState(Boolean(initialArtifactId));
  const [confirming, setConfirming] = useState<'delete' | 'merge' | null>(null);
  const textarea = useRef<HTMLTextAreaElement>(null);
  const editorMain = useRef<HTMLElement>(null);
  const composingRef = useRef(false);
  const editorOwnedFocus = useRef(false);
  const wasActive = useRef(isActive);
  const textareaScrollTop = useRef(0);
  const returnPosition = useRef<{
    sectionId: string;
    textIdentity: string;
    start: number;
    end: number;
    textareaScrollTop: number;
    editorScrollTop: number;
  } | null>(null);
  const restorePosition = useRef(false);
  const restoreFocus = useRef(false);
  const inFlight = useRef(false);
  const sections = draft?.sections ?? manuscriptSections(project);
  const styleSources = project.narrative?.sources ?? [];
  const visibleSections = filterManuscriptSections(sections, {
    query: search,
    chapterId: chapterFilter && chapterFilter !== '__unchaptered' ? chapterFilter : undefined,
    chronology: chronologyFilter,
  }).filter(section => chapterFilter !== '__unchaptered' || (section.kind === 'scene' && !section.chapterId));
  const chapters = sections.filter(section => section.kind === 'chapter');
  const chronologyMarkers = [...new Set(sections.map(section => section.chronology?.trim()).filter((value): value is string => Boolean(value)))];
  const selected = sections.find(({ id }) => id === selectedId) ?? sections[0];
  const index = selected ? sections.indexOf(selected) : -1;
  const words = sections.reduce((total, section) => total + (section.text.match(/\S+/gu)?.length ?? 0), 0);
  const storyCount = project.artifacts.filter(artifact => artifact.mode === 'story' && artifact.storyText).length;

  // Reset only when the project or persisted manuscript version changes.
  if (previousStyleVersionKey !== styleVersionKey) {
    setPreviousStyleVersionKey(styleVersionKey);
    setStyleProfile(profileForCurrentVersion);
  }

  if (focusedSectionId !== prevFocusedSectionId) {
    setPrevFocusedSectionId(focusedSectionId);
    if (focusedSectionId) {
      setSelectedId(focusedSectionId);
    }
  }

  const styleProfileDirty = JSON.stringify(styleProfile) !== JSON.stringify(profileForCurrentVersion);

  const captureReturnPosition = useCallback(() => {
    const editor = textarea.current;
    returnPosition.current = {
      sectionId: selected?.id ?? '',
      textIdentity: editor?.value ?? selected?.text ?? '',
      start: editor?.selectionStart ?? selectionRange.start,
      end: editor?.selectionEnd ?? selectionRange.end,
      textareaScrollTop: editor?.scrollTop ?? textareaScrollTop.current,
      editorScrollTop: editorMain.current?.scrollTop ?? 0,
    };
  }, [selected?.id, selected?.text, selectionRange.start, selectionRange.end]);

  function toggleFocus() {
    if (composingRef.current) return;
    captureReturnPosition();
    restorePosition.current = true;
    restoreFocus.current = true;
    if (!focus && previewSection) setPreviewSection(false);
    setFocus(value => !value);
    setFocusToolsOpen(false);
  }

  useLayoutEffect(() => {
    const activeChanged = wasActive.current !== isActive;
    if (activeChanged) {
      wasActive.current = isActive;
      if (!isActive) {
        editorOwnedFocus.current = editorOwnedFocus.current || document.activeElement === textarea.current;
        captureReturnPosition();
        return;
      }
      restorePosition.current = true;
      restoreFocus.current = editorOwnedFocus.current;
    }
    if (!isActive) return;
    if (!restorePosition.current || !returnPosition.current) return;
    restorePosition.current = false;
    const position = returnPosition.current;
    if (position.sectionId !== (selected?.id ?? '')) return;
    const editor = textarea.current;
    let restoredStart = position.start;
    let restoredEnd = position.end;
    if (editor) {
      ({ start: restoredStart, end: restoredEnd } = resolveReturnSelection(editor.value, position));
      editor.setSelectionRange(restoredStart, restoredEnd);
      editor.scrollTop = position.textareaScrollTop;
      if (restoreFocus.current) editor.focus({ preventScroll: true });
      textareaScrollTop.current = position.textareaScrollTop;
    }
    if (editorMain.current) editorMain.current.scrollTop = position.editorScrollTop;
    setSelectionRange({ start: restoredStart, end: restoredEnd });
    restoreFocus.current = false;
  }, [captureReturnPosition, focus, isActive, previewSection, selected?.id]);

  function edit(next: ManuscriptSection[]) {
    setDraft({ base: draft?.base ?? narrativeBase(project), sections: next });
    if (!draft) setError('');
    onDirty(true);
  }

  function operate(operation: Parameters<typeof applyManuscriptOperation>[1]) {
    try {
      edit(applyManuscriptOperation(sections, operation));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'The edit could not be applied.');
    }
  }

  async function save(base: NarrativeBase, next: ManuscriptSection[], artifact?: ArtifactAnchor, nextStyleProfile = styleProfile) {
    if (inFlight.current) return;
    inFlight.current = true;
    if (artifact) setDraft({ base, sections: next, artifact });
    onDirty(true);
    setSaving(true);
    setError('');
    try {
      await onSave(base, next, artifact, nextStyleProfile);
      setDraft(null);
      setAdopting(false);
      setStyleProfile(nextStyleProfile);
      onDirty(false);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Save failed. Your draft is still open.');
    } finally {
      inFlight.current = false;
      setSaving(false);
    }
  }

  // Timers and click handlers share the latest save callback. Failed writes require explicit retry.
  const saveRef = useRef(save);
  useEffect(() => { saveRef.current = save; });
  useEffect(() => {
    if (!draft || !enabled || isComposing || saving || error || adopting) return;
    const timer = window.setTimeout(() => void saveRef.current(draft.base, draft.sections, draft.artifact), 900);
    return () => window.clearTimeout(timer);
  }, [draft, enabled, isComposing, saving, error, adopting]);

  function add(kind: 'scene' | 'chapter') {
    const section = { id: crypto.randomUUID(), kind, title: '', text: '' };
    operate({ kind: 'add', section });
    setSelectedId(section.id);
    setSelectionRange({ start: 0, end: 0 });
  }

  function update(updates: Extract<Parameters<typeof applyManuscriptOperation>[1], { kind: 'edit' }>['updates']) {
    if (selected) operate({ kind: 'edit', id: selected.id, updates });
  }

  return (
    <main ref={editorMain} className="min-h-0 flex-1 overflow-auto bg-pcc-canvas dark:bg-pcc-dark-canvas">
      <div className={`mx-auto grid max-w-[1600px] gap-4 p-3 sm:p-6 ${focus ? 'max-w-[82ch]' : 'lg:grid-cols-[15rem_minmax(0,1fr)]'}`}>
        {!focus && (
          <button type="button" className={`${workspaceButton} justify-self-start lg:hidden`}
            onClick={() => setOutlineOpen(!outlineOpen)} aria-controls="manuscript-outline" aria-expanded={outlineOpen}>
            {outlineOpen ? 'Hide outline' : 'Show outline'}
          </button>
        )}
        {!focus && (
          <ManuscriptOutlineSidebar
            outlineOpen={outlineOpen}
            sections={sections}
            visibleSections={visibleSections}
            chapters={chapters}
            chronologyMarkers={chronologyMarkers}
            selectedSectionId={selected?.id}
            search={search}
            chapterFilter={chapterFilter}
            chronologyFilter={chronologyFilter}
            enabled={enabled}
            saving={saving}
            adopting={adopting}
            buttonClassName={workspaceButton}
            fieldClassName={field}
            onAddSection={add}
            onChangeSearch={setSearch}
            onChangeChapterFilter={setChapterFilter}
            onChangeChronologyFilter={setChronologyFilter}
            onSelectSection={(id) => {
              if (!sections.some(section => section.id === id)) return;
              setSelectedId(id);
              setSelectionRange({ start: 0, end: 0 });
              setConfirming(null);
            }}
          />
        )}
        <article className="min-w-0 rounded-xl border border-pcc-line bg-pcc-surface p-4 dark:border-pcc-dark-line dark:bg-pcc-dark-surface sm:p-6">
          <header className="flex flex-wrap items-center justify-between gap-3">
            <div className="min-w-0">
              <h1 className="font-display text-xl font-semibold tracking-tight">Working Manuscript</h1>
              <p className="break-words text-sm text-gray-600 dark:text-gray-300">{project.name} · {words} words</p>
            </div>
            <div className="flex flex-wrap gap-2">
              <button type="button" className={workspaceButton} aria-pressed={focus} disabled={isComposing} onClick={toggleFocus}>{focus ? 'Return to writing' : 'Focus mode'}</button>
              {!focus && <button type="button" className={workspaceButton} disabled={!enabled || !!draft || !canUndo} onClick={onUndo}>Undo</button>}
              {!focus && <button type="button" className={workspaceButton} disabled={!enabled || !!draft || !canRedo} onClick={onRedo}>Redo</button>}
            </div>
          </header>
          {!enabled && <p role="status" className="mt-3">Writing requires available IndexedDB and a verified workspace load.</p>}
          <div className="my-4 flex flex-wrap items-center gap-3">
            <button className={workspaceButton} disabled={!draft || saving || !enabled || isComposing || adopting}
              onClick={() => draft && void save(draft.base, draft.sections, draft.artifact)}>Save manuscript</button>
            <span role="status" className="text-sm">
              {saving ? 'Saving…' : draft ? 'Unsaved draft' : project.persistedRevision === project.revision ? 'Saved' : 'Project changes pending'}
            </span>
            {storyCount > 0 && (
              <button className={workspaceButton} disabled={!enabled || saving || !!draft} onClick={() => setAdopting(true)}>Adopt generated story</button>
            )}
          </div>
          {error && <p role="alert" className="mb-3 break-words text-red-700 dark:text-red-300">{error}</p>}
          {draft && !saving && !adopting && (
            <div className="mb-3 flex flex-wrap gap-2">
              <button className={workspaceButton} onClick={() => onExportDraft(draft.sections)}>Export draft</button>
              <button className={workspaceButton} onClick={() => {
                if (!window.confirm('Discard the unsaved manuscript draft?')) return;
                setDraft(null);
                setError('');
                onDirty(false);
              }}>Discard draft</button>
            </div>
          )}
          {adopting && (
            <AdoptArtifactDialog project={project} initialArtifactId={initialArtifactId} sectionId={selected?.kind === 'scene' ? selected.id : ''}
              busy={saving} onCancel={() => { setAdopting(false); setDraft(null); setError(''); onDirty(false); }}
              onApply={(next, anchor, base) => void save(base, next, anchor)} />
          )}
          <fieldset className="min-w-0 space-y-3" disabled={!enabled || adopting}>
            {selected && !focus ? (
              <label className="block text-sm">
                {selected.kind === 'chapter' ? 'Chapter title' : 'Scene title'} (optional)
                <input className={field} value={selected.title} readOnly={saving} onChange={event => update({ title: event.target.value })} />
              </label>
            ) : null}
            <label className="block text-sm">
              Manuscript text
              <div className="mt-1 flex flex-wrap items-center justify-between gap-2">
                <span id="manuscript-markdown-hint" className="text-xs text-gray-600 dark:text-gray-300">Markdown remains literal source text; preview displays it safely without interpreting HTML.</span>
                {!focus && <button type="button" className={workspaceButton} aria-pressed={previewSection} onClick={() => {
                  captureReturnPosition();
                  restorePosition.current = true;
                  restoreFocus.current = previewSection;
                  setPreviewSection(value => !value);
                }}>
                  {previewSection ? 'Edit section' : 'Preview section'}
                </button>}
              </div>
              {previewSection ? (
                <pre aria-label="Section preview" className="pcc-editorial mt-2 min-h-[56vh] overflow-auto whitespace-pre-wrap break-words rounded-md border border-pcc-line bg-pcc-canvas p-5 text-[17px] leading-[1.7] dark:border-pcc-dark-line dark:bg-pcc-dark-canvas">{selected?.text || 'Nothing to preview yet.'}</pre>
              ) : (
                <textarea ref={textarea} aria-describedby="manuscript-markdown-hint" className={`${field} pcc-editorial mt-2 min-h-[56vh] resize-y border-pcc-line bg-pcc-canvas p-5 text-[17px] leading-[1.7] focus-visible:ring-2 focus-visible:ring-pcc-focus dark:border-pcc-dark-line dark:bg-pcc-dark-canvas`}
                  value={selected?.text ?? ''} readOnly={saving} placeholder="Start writing here…"
                  onSelect={event => setSelectionRange({ start: event.currentTarget.selectionStart ?? 0, end: event.currentTarget.selectionEnd ?? 0 })}
                  onKeyUp={event => setSelectionRange({ start: event.currentTarget.selectionStart ?? 0, end: event.currentTarget.selectionEnd ?? 0 })}
                  onMouseUp={event => setSelectionRange({ start: event.currentTarget.selectionStart ?? 0, end: event.currentTarget.selectionEnd ?? 0 })}
                  onScroll={event => {
                    const editor = event.currentTarget;
                    returnPosition.current = {
                      sectionId: selected?.id ?? '',
                      textIdentity: editor.value,
                      start: editor.selectionStart,
                      end: editor.selectionEnd,
                      textareaScrollTop: editor.scrollTop,
                      editorScrollTop: editorMain.current?.scrollTop ?? 0,
                    };
                    textareaScrollTop.current = editor.scrollTop;
                  }}
                  onChange={event => {
                    setSelectionRange({ start: event.currentTarget.selectionStart ?? 0, end: event.currentTarget.selectionEnd ?? 0 });
                    if (selected) {
                      update({ text: event.target.value });
                    } else {
                      const section: ManuscriptSection = { id: crypto.randomUUID(), kind: 'scene', title: '', text: event.target.value };
                      edit([section]);
                      setSelectedId(section.id);
                    }
                  }}
                  onCompositionStart={() => {
                    composingRef.current = true;
                    onCompositionChange?.(true);
                    setIsComposing(true);
                  }}
                  onCompositionEnd={event => {
                    composingRef.current = false;
                    onCompositionChange?.(false);
                    setIsComposing(false);
                    setSelectionRange({ start: event.currentTarget.selectionStart, end: event.currentTarget.selectionEnd });
                  }}
                  onFocus={() => { editorOwnedFocus.current = true; }}
                  onBlur={event => {
                    if (event.relatedTarget || isActive) editorOwnedFocus.current = false;
                  }}
                  spellCheck />
              )}
            </label>
            {selected && !focus && (
              <fieldset disabled={saving} className="min-w-0 space-y-3">
              <div className="flex flex-wrap gap-2">
                <button className={workspaceButton} disabled={index <= 0} onClick={() => operate({ kind: 'move', id: selected.id, direction: -1 })}>Move up</button>
                <button className={workspaceButton} disabled={index >= sections.length - 1} onClick={() => operate({ kind: 'move', id: selected.id, direction: 1 })}>Move down</button>
                {selected.kind === 'scene' && (
                  <>
                    <button className={workspaceButton} onClick={() => operate({ kind: 'split', id: selected.id, offset: textarea.current?.selectionStart ?? 0 })}>Split at cursor</button>
                    <button className={workspaceButton} disabled={sections[index + 1]?.kind !== 'scene' || sections[index + 1]?.chapterId !== selected.chapterId}
                      onClick={() => setConfirming('merge')}>Merge with next</button>
                  </>
                )}
                <button className={workspaceButton} onClick={() => setConfirming('delete')}>Delete section</button>
              </div>
              {confirming && (
                <div className="rounded border border-amber-400 p-3" role="group" aria-label="Confirm outline change">
                  <p className="mb-2 text-sm">
                    {confirming === 'delete'
                      ? `Remove this ${selected.kind} and its ${selected.text.length} characters? Child scenes stay in the manuscript.`
                      : `Merge this scene with “${sections[index + 1]?.title || 'Untitled scene'}”? Their text will be joined in order.`}
                  </p>
                  <button className={workspaceButton} onClick={() => { operate({ kind: confirming, id: selected.id }); setConfirming(null); }}>Confirm {confirming}</button>{' '}
                  <button className={workspaceButton} onClick={() => setConfirming(null)}>Cancel</button>
                </div>
              )}
              <details className="space-y-2">
                <summary className="cursor-pointer text-sm font-semibold">Section details</summary>
                {selected.kind === 'scene' && (
                  <label className="block text-sm">Chapter
                    <select className={field} value={selected.chapterId ?? ''} onChange={event => update({ chapterId: event.target.value || undefined })}>
                      <option value="">Unassigned</option>
                      {sections.filter(section => section.kind === 'chapter').map(section => (
                        <option key={section.id} value={section.id}>{section.title || 'Untitled chapter'}</option>
                      ))}
                    </select>
                  </label>
                )}
                <label className="block text-sm">Synopsis<input className={field} value={selected.synopsis ?? ''} onChange={event => update({ synopsis: event.target.value })} /></label>
                <label className="block text-sm">Point of view<input className={field} value={selected.pov ?? ''} onChange={event => update({ pov: event.target.value })} /></label>
                {([['location', 'Location'], ['characters', 'Characters'], ['chronology', 'Story chronology'], ['purpose', 'Purpose']] as const).map(([key, label]) => (
                  <label className="block text-sm" key={key}>{label}
                    <input className={field} value={selected[key] ?? ''} onChange={event => update({ [key]: event.target.value })} />
                  </label>
                ))}
                <label className="block text-sm">Draft status
                  <select className={field} value={selected.status ?? ''} onChange={event => update({ status: (event.target.value || undefined) as ManuscriptSection['status'] })}>
                    <option value="">Unassigned</option><option value="draft">Draft</option><option value="revised">Revised</option><option value="final">Final</option>
                  </select>
                </label>
              </details>
              </fieldset>
            )}
          </fieldset>
          <div className="mt-5">
            {focus && (
              <button type="button" className={workspaceButton} aria-expanded={focusToolsOpen}
                onClick={() => setFocusToolsOpen(value => !value)}>
                {focusToolsOpen ? 'Hide context and writing tools' : 'Inspect context and writing tools'}
              </button>
            )}
            <div hidden={focus && !focusToolsOpen} className="mt-3 grid gap-3 lg:grid-cols-2">
            <StyleProfilePanel
              projectId={project.id}
              styleVersionKey={styleVersionKey}
              selectedSection={selected}
              styleSources={styleSources}
              styleProfile={styleProfile}
              styleProfileDirty={styleProfileDirty}
              enabled={enabled}
              saving={saving}
              isComposing={isComposing}
              buttonClassName={workspaceButton}
              fieldClassName={field}
              onChangeStyleProfile={setStyleProfile}
              onMarkDirty={() => onDirty(true)}
              onSaveStyleProfile={() =>
                void save(
                  draft?.base ?? narrativeBase(project),
                  draft?.sections ?? sections,
                  draft?.artifact,
                  styleProfile
                )
              }
            />
            <WritingAssistantPanel
              project={project}
              section={selected}
              selectionStart={selectionRange.start}
              selectionEnd={selectionRange.end}
              aiConfigured={aiConfigured}
              disabled={!enabled || saving || adopting}
              onReplaceOrInsert={(nextText) => {
                if (selected) {
                  update({ text: nextText });
                }
              }}
              onCreateSceneFromProposal={(title, text) => {
                const newSec: ManuscriptSection = { id: crypto.randomUUID(), kind: 'scene', title, text };
                operate({ kind: 'add', section: newSec });
                setSelectedId(newSec.id);
                setSelectionRange({ start: 0, end: 0 });
              }}
              onSaveAlternative={(alt) => onSaveWritingAlternative?.(alt)}
            />
            </div>
          </div>
        </article>
      </div>
    </main>
  );
}
