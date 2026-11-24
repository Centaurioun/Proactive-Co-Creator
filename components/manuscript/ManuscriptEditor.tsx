import { useEffect, useRef, useState } from 'react';
import type { ArtifactAnchor, ManuscriptSection } from '../../shared/narrativeTypes';
import type { CreativeProject } from '../../shared/types';
import { applyManuscriptOperation, manuscriptSections, narrativeBase, type NarrativeBase } from '../../lib/narrative/manuscriptModel';
import { filterManuscriptSections } from '../../lib/narrative/manuscriptNavigation';
import { createStyleObservation, createStyleProfile, reviewStyleObservation, selectStyleContext, type StyleProfile, type StyleTrait } from '../../lib/narrative/context/styleProfile';
import AdoptArtifactDialog from './AdoptArtifactDialog';

export const workspaceButton = 'rounded-md border border-gray-300 px-3 py-1.5 text-sm font-medium hover:bg-gray-100 dark:border-gray-700 dark:hover:bg-gray-800 disabled:opacity-45';
const field = 'w-full rounded-md border border-gray-300 bg-white px-3 py-2 dark:border-gray-700 dark:bg-gray-950';

interface Props {
  project: CreativeProject;
  onSave: (base: NarrativeBase, sections: ManuscriptSection[], artifact?: ArtifactAnchor) => Promise<void>;
  onDirty: (dirty: boolean) => void;
  onUndo: () => void;
  onRedo: () => void;
  canUndo: boolean;
  canRedo: boolean;
  enabled: boolean;
  initialArtifactId?: string;
  onExportDraft: (sections: ManuscriptSection[]) => void;
}

export default function ManuscriptEditor({ project, onSave, onDirty, onUndo, onRedo, canUndo, canRedo, enabled, initialArtifactId, onExportDraft }: Props) {
  const [draft, setDraft] = useState<{ base: NarrativeBase; sections: ManuscriptSection[]; artifact?: ArtifactAnchor } | null>(null);
  const [selectedId, setSelectedId] = useState('');
  const [isComposing, setIsComposing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [focus, setFocus] = useState(false);
  const [outlineOpen, setOutlineOpen] = useState(false);
  const [search, setSearch] = useState('');
  const [chapterFilter, setChapterFilter] = useState('');
  const [chronologyFilter, setChronologyFilter] = useState('');
  const [previewSection, setPreviewSection] = useState(false);
  const [styleProfile, setStyleProfile] = useState<StyleProfile>(() => createStyleProfile(project.id));
  const [styleSourceId, setStyleSourceId] = useState('');
  const [styleTrait, setStyleTrait] = useState<StyleTrait>('voice');
  const [styleValue, setStyleValue] = useState('');
  const [styleExcerpt, setStyleExcerpt] = useState('');
  const [styleInterpretation, setStyleInterpretation] = useState<'observation' | 'interpretation'>('observation');
  const [styleScope, setStyleScope] = useState<'manuscript' | 'section'>('manuscript');
  const [styleError, setStyleError] = useState('');
  const [adopting, setAdopting] = useState(Boolean(initialArtifactId));
  const [confirming, setConfirming] = useState<'delete' | 'merge' | null>(null);
  const textarea = useRef<HTMLTextAreaElement>(null);
  const inFlight = useRef(false);
  const sections = draft?.sections ?? manuscriptSections(project);
  const styleSources = project.narrative?.sources ?? [];
  const selectedStyleSource = styleSources.find(source => `${source.id}:${source.version}:${source.digest}` === styleSourceId) ?? styleSources[0];
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

  useEffect(() => {
    setStyleProfile(createStyleProfile(project.id));
    setStyleSourceId('');
    setStyleError('');
  }, [project.id]);

  function resolveStyleSource(ref: { recordId: string; version: string; digest: string }) {
    const source = styleSources.find(item => item.id === ref.recordId && item.version === ref.version && item.digest === ref.digest);
    return source ? { digest: source.digest, text: source.text } : undefined;
  }

  const currentStyleObservations = styleProfile.observations.filter(observation => {
    const source = resolveStyleSource(observation.evidence);
    return source !== undefined && source.text.slice(observation.evidence.start, observation.evidence.end) === observation.evidence.excerpt;
  });
  const currentStyleProfile = { ...styleProfile, observations: currentStyleObservations };
  const styleContext = selected
    ? selectStyleContext(currentStyleProfile, project.id, selected.id)
    : { guidance: [], conflicts: [] };

  function addStyleObservation() {
    const value = styleValue.trim();
    const source = selectedStyleSource;
    if (!source || !value || !styleExcerpt.trim() || !selected && styleScope === 'section') {
      setStyleError('Choose a source, add a style note and exact source excerpt, and select a section for section-specific notes.');
      return;
    }
    if (styleValue.length > 240 || styleExcerpt.length > 2000) {
      setStyleError('Style notes are limited to 240 characters and source excerpts to 2,000 characters.');
      return;
    }
    const start = source.text.indexOf(styleExcerpt);
    if (start < 0 || source.text.indexOf(styleExcerpt, start + 1) >= 0) {
      setStyleError('The exact excerpt must appear once in the selected project source.');
      return;
    }
    const observation = createStyleObservation({
      id: crypto.randomUUID(), trait: styleTrait, value, interpretation: styleInterpretation,
      scope: styleScope === 'section' && selected ? { kind: 'section', sectionId: selected.id } : { kind: 'manuscript' },
      evidence: { kind: 'source', recordId: source.id, version: source.version, digest: source.digest,
        start, end: start + styleExcerpt.length, excerpt: styleExcerpt },
    });
    setStyleProfile(profile => ({ ...profile, observations: [...profile.observations, observation] }));
    setStyleValue('');
    setStyleExcerpt('');
    setStyleError('');
  }

  function reviewStyle(id: string, status: 'confirmed' | 'rejected') {
    try {
      setStyleProfile(profile => reviewStyleObservation(profile, id, status, resolveStyleSource));
      setStyleError('');
    } catch (cause) {
      setStyleError(cause instanceof Error ? cause.message : 'This style note could not be reviewed.');
    }
  }

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

  async function save(base: NarrativeBase, next: ManuscriptSection[], artifact?: ArtifactAnchor) {
    if (inFlight.current) return;
    inFlight.current = true;
    if (artifact) setDraft({ base, sections: next, artifact });
    onDirty(true);
    setSaving(true);
    setError('');
    try {
      await onSave(base, next, artifact);
      setDraft(null);
      setAdopting(false);
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
  }

  function update(updates: Extract<Parameters<typeof applyManuscriptOperation>[1], { kind: 'edit' }>['updates']) {
    if (selected) operate({ kind: 'edit', id: selected.id, updates });
  }

  return (
    <main className="min-h-0 flex-1 overflow-auto bg-stone-100 dark:bg-gray-950">
      <div className={`mx-auto grid max-w-7xl gap-4 p-3 sm:p-6 ${focus ? '' : 'lg:grid-cols-[14rem_minmax(0,1fr)]'}`}>
        {!focus && (
          <button type="button" className={`${workspaceButton} justify-self-start lg:hidden`}
            onClick={() => setOutlineOpen(!outlineOpen)} aria-controls="manuscript-outline" aria-expanded={outlineOpen}>
            {outlineOpen ? 'Hide outline' : 'Show outline'}
          </button>
        )}
        {!focus && (
          <aside id="manuscript-outline" className={`${outlineOpen ? 'block' : 'hidden'} min-w-0 rounded-xl border border-gray-200 bg-white p-4 dark:border-gray-800 dark:bg-gray-900 lg:block`} aria-label="Manuscript outline">
            <h2 className="font-semibold">Outline</h2>
            <div className="mt-3 flex flex-wrap gap-2">
              <button className={workspaceButton} disabled={!enabled || saving || adopting} onClick={() => add('chapter')}>Add chapter</button>
              <button className={workspaceButton} disabled={!enabled || saving || adopting} onClick={() => add('scene')}>Add scene</button>
            </div>
            <label className="mt-4 block text-sm">
              Find in manuscript
              <input className={field} value={search} onChange={event => setSearch(event.target.value)} />
            </label>
            <label className="mt-3 block text-sm">
              Chapter
              <select className={field} value={chapterFilter} onChange={event => setChapterFilter(event.target.value)}>
                <option value="">All sections</option>
                {chapters.map((chapter, position) => <option key={chapter.id} value={chapter.id}>{chapter.title || `Chapter ${position + 1}`}</option>)}
                <option value="__unchaptered">Unchaptered scenes</option>
              </select>
            </label>
            <label className="mt-3 block text-sm">
              Story chronology
              <select className={field} value={chronologyFilter} onChange={event => setChronologyFilter(event.target.value)}>
                <option value="">All chronology markers</option>
                {chronologyMarkers.map(marker => <option key={marker} value={marker}>{marker}</option>)}
              </select>
            </label>
            <ol className="mt-3 space-y-1">
              {visibleSections.map(section => {
                return (
                  <li key={section.id} className={section.chapterId ? 'pl-3' : ''}>
                    <button type="button" disabled={adopting} onClick={() => { setSelectedId(section.id); setConfirming(null); }}
                      aria-current={section.id === selected?.id ? 'true' : undefined}
                      className="w-full rounded px-2 py-1.5 text-left break-words aria-[current=true]:bg-amber-100 dark:aria-[current=true]:bg-amber-950">
                      {section.title || `${section.kind === 'chapter' ? 'Chapter' : 'Scene'} ${sections.indexOf(section) + 1}`}
                      {section.kind === 'scene' && !section.chapterId ? <span className="ml-2 text-xs text-gray-500">Unchaptered</span> : null}
                      {section.kind === 'scene' && section.chapterId && !chapters.some(chapter => chapter.id === section.chapterId) ? <span className="ml-2 text-xs text-amber-700">Orphaned chapter link</span> : null}
                    </button>
                  </li>
                );
              })}
            </ol>
            {visibleSections.length === 0 && <p className="mt-2 text-sm text-gray-600">No sections match these filters.</p>}
          </aside>
        )}
        <article className="min-w-0 rounded-xl border border-gray-200 bg-white p-4 dark:border-gray-800 dark:bg-gray-900 sm:p-6">
          <header className="flex flex-wrap items-center justify-between gap-3">
            <div className="min-w-0">
              <h1 className="font-display text-2xl font-bold">Working Manuscript</h1>
              <p className="break-words text-sm text-gray-600 dark:text-gray-300">{project.name} · {words} words</p>
            </div>
            <div className="flex flex-wrap gap-2">
              <button className={workspaceButton} aria-pressed={focus} onClick={() => setFocus(!focus)}>{focus ? 'Exit focus' : 'Focus mode'}</button>
              <button className={workspaceButton} disabled={!enabled || !!draft || !canUndo} onClick={onUndo}>Undo</button>
              <button className={workspaceButton} disabled={!enabled || !!draft || !canRedo} onClick={onRedo}>Redo</button>
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
          <details className="mb-4 rounded-lg border border-gray-200 p-3 dark:border-gray-800">
            <summary className="cursor-pointer font-semibold">User-reviewed style profile</summary>
            <p className="my-2 text-sm text-gray-600 dark:text-gray-300">
              Notes are temporary for this editor session. They use existing imported sources, are not written to canonical facts, and do not trigger analysis or provider calls.
            </p>
            <section aria-label="Confirmed style context" className="mb-3 rounded bg-gray-50 p-3 dark:bg-gray-950">
              <h3 className="font-medium">Current style context{selected ? ` · ${selected.title || selected.kind}` : ''}</h3>
              {styleContext.guidance.length ? (
                <ul className="mt-2 list-disc space-y-2 pl-5 text-sm">
                  {styleContext.guidance.map(item => (
                    <li key={item.id}><strong>{item.trait}:</strong> {item.value} <span className="text-gray-600 dark:text-gray-300">({item.interpretation})</span>
                      <blockquote className="mt-1 border-l-2 border-gray-300 pl-2 text-xs">{item.evidence.excerpt}</blockquote>
                    </li>
                  ))}
                </ul>
              ) : <p className="mt-1 text-sm text-gray-600 dark:text-gray-300">No current confirmed style notes apply here.</p>}
              {styleContext.conflicts.map(conflict => <p key={conflict.trait} role="status" className="mt-2 text-sm text-amber-800">Conflicting confirmed notes for {conflict.trait} are excluded.</p>)}
            </section>
            {styleSources.length ? (
              <fieldset className="grid gap-3" disabled={!selectedStyleSource}>
                <legend className="font-medium">Add a note for review</legend>
                <label className="grid gap-1 text-sm">Source record
                  <select className={field} value={selectedStyleSource ? `${selectedStyleSource.id}:${selectedStyleSource.version}:${selectedStyleSource.digest}` : ''}
                    onChange={event => setStyleSourceId(event.target.value)}>
                    {styleSources.map(source => <option key={`${source.id}:${source.version}:${source.digest}`} value={`${source.id}:${source.version}:${source.digest}`}>
                      {source.filename || 'Imported source'} · {source.version}
                    </option>)}
                  </select>
                </label>
                <div className="grid gap-3 sm:grid-cols-2">
                  <label className="grid gap-1 text-sm">Trait
                    <select className={field} value={styleTrait} onChange={event => setStyleTrait(event.target.value as StyleTrait)}>
                      <option value="pov">Point of view</option><option value="voice">Voice</option><option value="tense">Tense</option>
                      <option value="rhythm">Rhythm</option><option value="dialogue">Dialogue</option><option value="atmosphere">Atmosphere</option>
                    </select>
                  </label>
                  <label className="grid gap-1 text-sm">Note type
                    <select className={field} value={styleInterpretation} onChange={event => setStyleInterpretation(event.target.value as typeof styleInterpretation)}>
                      <option value="observation">Observation</option><option value="interpretation">Interpretation</option>
                    </select>
                  </label>
                </div>
                <label className="grid gap-1 text-sm">Style note
                  <input className={field} maxLength={240} value={styleValue} onChange={event => setStyleValue(event.target.value)} placeholder="Write a short note; nothing is inferred automatically." />
                </label>
                <label className="grid gap-1 text-sm">Exact source excerpt (must appear once)
                  <textarea className={field} maxLength={2000} rows={3} value={styleExcerpt} onChange={event => setStyleExcerpt(event.target.value)} />
                </label>
                <label className="grid gap-1 text-sm">Applies to
                  <select className={field} value={styleScope} onChange={event => setStyleScope(event.target.value as typeof styleScope)}>
                    <option value="manuscript">Whole manuscript</option><option value="section" disabled={!selected}>Selected section only</option>
                  </select>
                </label>
                <button type="button" className={`${workspaceButton} justify-self-start`} onClick={addStyleObservation}>Add pending note</button>
              </fieldset>
            ) : <p className="mt-2 text-sm">No imported source records are available to anchor style notes.</p>}
            {styleError && <p role="alert" className="mt-2 text-sm text-red-700">{styleError}</p>}
            {styleProfile.observations.length > 0 && (
              <section aria-label="Style note review queue" className="mt-4 space-y-2">
                <h3 className="font-medium">Review queue</h3>
                {styleProfile.observations.map(item => {
                  const isCurrent = currentStyleObservations.some(current => current.id === item.id);
                  return <article key={item.id} className="rounded border border-gray-200 p-3 text-sm dark:border-gray-700">
                    <p><strong>{item.trait} · {item.interpretation}:</strong> {item.value} <span className="ml-2">Status: {isCurrent ? item.status : 'stale source'}</span></p>
                    <blockquote className="my-2 border-l-2 border-gray-300 pl-2">{item.evidence.excerpt}</blockquote>
                    {item.status === 'pending' && <div className="flex flex-wrap gap-2">
                      <button type="button" className={workspaceButton} disabled={!isCurrent} onClick={() => reviewStyle(item.id, 'confirmed')}>Confirm</button>
                      <button type="button" className={workspaceButton} onClick={() => reviewStyle(item.id, 'rejected')}>Reject</button>
                    </div>}
                  </article>;
                })}
              </section>
            )}
          </details>
          <fieldset className="min-w-0 space-y-3" disabled={!enabled || adopting}>
            {selected ? (
              <label className="block text-sm">
                {selected.kind === 'chapter' ? 'Chapter title' : 'Scene title'} (optional)
                <input className={field} value={selected.title} readOnly={saving} onChange={event => update({ title: event.target.value })} />
              </label>
            ) : null}
            <label className="block text-sm">
              Manuscript text
              <div className="mt-1 flex flex-wrap items-center justify-between gap-2">
                <span id="manuscript-markdown-hint" className="text-xs text-gray-600 dark:text-gray-300">Markdown remains literal source text; preview displays it safely without interpreting HTML.</span>
                <button type="button" className={workspaceButton} aria-pressed={previewSection} onClick={() => setPreviewSection(value => !value)}>
                  {previewSection ? 'Edit section' : 'Preview section'}
                </button>
              </div>
              {previewSection ? (
                <pre aria-label="Section preview" className="mt-2 min-h-[40vh] overflow-auto whitespace-pre-wrap break-words rounded-md border border-gray-300 bg-stone-50 p-4 font-serif text-lg leading-relaxed dark:border-gray-700 dark:bg-gray-950">{selected?.text || 'Nothing to preview yet.'}</pre>
              ) : (
                <textarea ref={textarea} aria-describedby="manuscript-markdown-hint" className={`${field} mt-2 min-h-[40vh] resize-y font-serif text-lg leading-relaxed`}
                  value={selected?.text ?? ''} readOnly={saving} placeholder="Start writing here…"
                  onChange={event => {
                    if (selected) {
                      update({ text: event.target.value });
                    } else {
                      const section: ManuscriptSection = { id: crypto.randomUUID(), kind: 'scene', title: '', text: event.target.value };
                      edit([section]);
                      setSelectedId(section.id);
                    }
                  }}
                  onCompositionStart={() => setIsComposing(true)}
                  onCompositionEnd={() => setIsComposing(false)} spellCheck />
              )}
            </label>
            {selected && (
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
        </article>
      </div>
    </main>
  );
}
