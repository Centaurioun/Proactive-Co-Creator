import { useEffect, useRef, useState } from 'react';
import type { ArtifactAnchor, ManuscriptSection } from '../../shared/narrativeTypes';
import type { CreativeProject } from '../../shared/types';
import { manuscriptSections, narrativeBase, type NarrativeBase } from '../../lib/narrative/manuscriptModel';
import { filterManuscriptSections } from '../../lib/narrative/manuscriptNavigation';
import { isTextBoundary } from '../../lib/narrative/evidenceRegistry';
import { createStyleProfile, type StyleProfile } from '../../lib/narrative/context/styleProfile';
import AdoptArtifactDialog from './AdoptArtifactDialog';
import WritingAssistantPanel from './WritingAssistantPanel';
import ManuscriptOutlineSidebar from './ManuscriptOutlineSidebar';
import StyleProfilePanel from './StyleProfilePanel';
import ManuscriptHeaderBar from './ManuscriptHeaderBar';
import ManuscriptTextPane from './ManuscriptTextPane';
import SectionDetailFields from './SectionDetailFields';
import { useManuscriptDraftSave } from './useManuscriptDraftSave';
import { useReturnSelection } from './useReturnSelection';
import {
  computeEditorDirtyAfterDraftDiscard,
  resolveSplitOffset,
  shouldBlockActionDuringComposition,
  shouldOpenAdoptionOnPropChange,
} from './manuscriptEditorHelpers';
import type { WritingAssistAction } from '../../shared/narrativeAiSchemas';

export {
  computeEditorDirtyAfterDraftDiscard,
  resolveSplitOffset,
  shouldBlockActionDuringComposition,
  shouldOpenAdoptionOnPropChange,
};

export function resolveReturnSelection(
  currentText: string,
  position: { textIdentity: string; start: number; end: number },
): { start: number; end: number; textMatches: boolean } {
  if (position.textIdentity !== currentText) return { start: 0, end: 0, textMatches: false };

  let start = Math.min(position.start, currentText.length);
  let end = Math.min(Math.max(start, position.end), currentText.length);
  const isCollapsed = start === end;
  while (start > 0 && !isTextBoundary(currentText, start)) start -= 1;
  if (isCollapsed) return { start, end: start, textMatches: true };
  while (end < currentText.length && !isTextBoundary(currentText, end)) end += 1;
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
  onDismissAdoption?: () => void;
  focusedSectionId?: string;
  writingAvailability?: { eligible: boolean; reason?: string };
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

function deriveManuscriptMetadata(
  sections: ManuscriptSection[],
  project: CreativeProject,
  selectedId: string,
  filters: { search: string; chapterFilter: string; chronologyFilter: string }
) {
  const { search, chapterFilter, chronologyFilter } = filters;
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
  return { visibleSections, chapters, chronologyMarkers, selected, index, words, storyCount };
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
  onDismissAdoption,
  focusedSectionId,
  writingAvailability = { eligible: false, reason: 'Writing assistance is unavailable.' },
  onSaveWritingAlternative,
  onExportDraft,
}: Props) {
  const [selectedId, setSelectedId] = useState(focusedSectionId ?? '');
  const [prevFocusedSectionId, setPrevFocusedSectionId] = useState(focusedSectionId);
  const [prevInitialArtifactId, setPrevInitialArtifactId] = useState(initialArtifactId);
  const [selectionRange, setSelectionRange] = useState<{ start: number; end: number }>({ start: 0, end: 0 });
  const [isComposing, setIsComposing] = useState(false);
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
  const composingRef = useRef(false);

  if (previousStyleVersionKey !== styleVersionKey) {
    setPreviousStyleVersionKey(styleVersionKey);
    setStyleProfile(profileForCurrentVersion);
  }
  if (focusedSectionId !== prevFocusedSectionId) {
    setPrevFocusedSectionId(focusedSectionId);
    if (focusedSectionId) setSelectedId(focusedSectionId);
  }
  if (initialArtifactId !== prevInitialArtifactId) {
    setPrevInitialArtifactId(initialArtifactId);
    if (shouldOpenAdoptionOnPropChange(prevInitialArtifactId, initialArtifactId)) {
      setAdopting(true);
    }
  }

  const styleProfileDirty = JSON.stringify(styleProfile) !== JSON.stringify(profileForCurrentVersion);
  const persistedSections = manuscriptSections(project);

  const { draft, saving, error, edit, operate, save, clearDraft } = useManuscriptDraftSave({
    project,
    sections: persistedSections,
    styleProfile,
    styleProfileDirty,
    enabled,
    isComposing,
    adopting,
    onSave,
    onDirty,
    onSaveSuccess: (savedStyleProfile, hadArtifact) => {
      setAdopting(false);
      if (hadArtifact) onDismissAdoption?.();
      setStyleProfile(savedStyleProfile);
    },
  });

  const sections = draft?.sections ?? persistedSections;
  const styleSources = project.narrative?.sources ?? [];
  const { visibleSections, chapters, chronologyMarkers, selected, index, words, storyCount } =
    deriveManuscriptMetadata(sections, project, selectedId, { search, chapterFilter, chronologyFilter });

  const { textarea, editorMain, scheduleRestore, recordScrollPosition, markFocused, markBlurred } =
    useReturnSelection({
      isActive,
      focus,
      previewSection,
      selectedId: selected?.id ?? '',
      selectedText: selected?.text ?? '',
      selectionRange,
      setSelectionRange,
      resolveSelection: resolveReturnSelection,
    });

  useEffect(() => {
    const onCompositionChangeLatest = onCompositionChange;
    return () => {
      if (composingRef.current) {
        composingRef.current = false;
        onCompositionChangeLatest?.(false);
      }
    };
  }, [onCompositionChange]);

  const toggleFocus = () => {
    if (shouldBlockActionDuringComposition(composingRef.current || isComposing)) return;
    scheduleRestore(true);
    if (!focus && previewSection) setPreviewSection(false);
    setFocus(value => !value);
    setFocusToolsOpen(false);
  };

  const add = (kind: 'scene' | 'chapter') => {
    if (shouldBlockActionDuringComposition(composingRef.current || isComposing)) return;
    const section = { id: crypto.randomUUID(), kind, title: '', text: '' };
    operate({ kind: 'add', section });
    setSelectedId(section.id);
    setSelectionRange({ start: 0, end: 0 });
  };

  const update = (updates: Extract<Parameters<typeof operate>[0], { kind: 'edit' }>['updates']) => {
    if (selected) operate({ kind: 'edit', id: selected.id, updates });
  };

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
              if (shouldBlockActionDuringComposition(composingRef.current || isComposing)) return;
              if (!sections.some(section => section.id === id)) return;
              setSelectedId(id);
              setSelectionRange({ start: 0, end: 0 });
              setConfirming(null);
            }}
          />
        )}
        <article className="min-w-0 rounded-xl border border-pcc-line bg-pcc-surface p-4 dark:border-pcc-dark-line dark:bg-pcc-dark-surface sm:p-6">
          <ManuscriptHeaderBar
            project={project}
            words={words}
            focus={focus}
            enabled={enabled}
            saving={saving}
            adopting={adopting}
            isComposing={isComposing}
            hasDraft={Boolean(draft)}
            draft={draft}
            canUndo={canUndo}
            canRedo={canRedo}
            storyCount={storyCount}
            error={error}
            buttonClassName={workspaceButton}
            onToggleFocus={toggleFocus}
            onUndo={onUndo}
            onRedo={onRedo}
            onSaveDraft={() => draft && void save(draft.base, draft.sections, draft.artifact)}
            onStartAdopting={() => setAdopting(true)}
            onExportDraft={() => draft && onExportDraft(draft.sections)}
            onDiscardDraft={() => {
              if (!window.confirm('Discard the unsaved manuscript draft?')) return;
              clearDraft();
            }}
          />
          {adopting && (
            <AdoptArtifactDialog
              project={project}
              initialArtifactId={initialArtifactId}
              sectionId={selected?.kind === 'scene' ? selected.id : ''}
              busy={saving}
              onCancel={() => {
                setAdopting(false);
                onDismissAdoption?.();
                clearDraft();
              }}
              onApply={(next, anchor, base) => void save(base, next, anchor)}
            />
          )}
          <fieldset className="min-w-0 space-y-3" disabled={!enabled || adopting}>
            {selected && !focus ? (
              <label className="block text-sm">
                {selected.kind === 'chapter' ? 'Chapter title' : 'Scene title'} (optional)
                <input className={field} value={selected.title} readOnly={saving} onChange={event => update({ title: event.target.value })} />
              </label>
            ) : null}
            <ManuscriptTextPane
              textarea={textarea}
              selected={selected}
              focus={focus}
              previewSection={previewSection}
              saving={saving}
              isComposing={isComposing}
              buttonClassName={workspaceButton}
              fieldClassName={field}
              onTogglePreview={() => {
                if (shouldBlockActionDuringComposition(composingRef.current || isComposing)) return;
                scheduleRestore(previewSection);
                setPreviewSection(value => !value);
              }}
              onSelectionChange={(start, end) => setSelectionRange({ start, end })}
              onScrollEditor={recordScrollPosition}
              onChangeText={(text) => {
                if (selected) {
                  update({ text });
                } else {
                  const section: ManuscriptSection = { id: crypto.randomUUID(), kind: 'scene', title: '', text };
                  edit([section]);
                  setSelectedId(section.id);
                }
              }}
              onCompositionStart={() => {
                composingRef.current = true;
                onCompositionChange?.(true);
                setIsComposing(true);
              }}
              onCompositionEnd={(start, end) => {
                composingRef.current = false;
                onCompositionChange?.(false);
                setIsComposing(false);
                setSelectionRange({ start, end });
              }}
              onFocus={markFocused}
              onBlur={markBlurred}
            />
            {selected && !focus && (
              <SectionDetailFields
                selected={selected}
                sections={sections}
                chapters={chapters}
                index={index}
                saving={saving}
                confirming={confirming}
                buttonClassName={workspaceButton}
                fieldClassName={field}
                onOperate={operate}
                onUpdate={update}
                onSplitAtCursor={() =>
                  operate({
                    kind: 'split',
                    id: selected.id,
                    offset: resolveSplitOffset(previewSection, textarea.current?.selectionStart, selectionRange.start),
                  })
                }
                onSetConfirming={setConfirming}
              />
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
                writingAvailability={writingAvailability}
                disabled={!enabled || saving || adopting}
                onReplaceOrInsert={(nextText) => {
                  if (selected) update({ text: nextText });
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
