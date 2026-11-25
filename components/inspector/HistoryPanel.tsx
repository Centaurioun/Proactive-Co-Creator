/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useEffect, useState } from 'react';
import type { CreativeProject, ProjectRevision } from '../../shared/types';

export interface HistoryPanelProps {
  project: CreativeProject;
  savedProjects: CreativeProject[];
  historyTarget?: { id: string; sequence: number } | null;
  contentExports: { id: string; label: string }[];
  onExportJson: () => void;
  onExportStoryBibleMarkdown: () => void;
  onExportPromptText: () => void;
  onExportManuscript?: () => void;
  onExportManuscriptDocx?: () => void;
  onExportManuscriptText?: () => void;
  onExportContent: (id: string) => void;
  onExportContentBundle: (ids: string[]) => void;
  onPreviewProjectJson: (rawJson: string) => Promise<CreativeProject>;
  onImportProjectJson: (rawJson: string) => Promise<{ ok: boolean; error?: string }>;
  onSwitchProject: (projectId: string) => void;
  onCreateNewProject: (name: string, initialPrompt: string) => void;
  onDeleteProject: (projectId: string) => void;
  onRestoreRevision: (revisionId: string) => void;
}

const HistoryPanel: React.FC<HistoryPanelProps> = ({
  project,
  savedProjects,
  historyTarget,
  contentExports,
  onExportJson,
  onExportStoryBibleMarkdown,
  onExportPromptText,
  onExportManuscript,
  onExportManuscriptDocx,
  onExportManuscriptText,
  onExportContent,
  onExportContentBundle,
  onPreviewProjectJson,
  onImportProjectJson,
  onSwitchProject,
  onCreateNewProject,
  onDeleteProject,
  onRestoreRevision,
}) => {
  const [importJsonText, setImportJsonText] = useState('');
  const [selectedExport, setSelectedExport] = useState('');
  const [selectedBundleExports, setSelectedBundleExports] = useState<string[]>([]);
  const [restorePreview, setRestorePreview] = useState<{
    raw: string;
    project: CreativeProject;
  } | null>(null);
  const [restoreBusy, setRestoreBusy] = useState(false);
  const [importMessage, setImportMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const [newProjName, setNewProjName] = useState('');
  const [newProjIdea, setNewProjIdea] = useState('');
  const initialRevisionId = project.revisions[1]?.id ?? project.revisions[0]?.id ?? '';
  const [revisionUi, setRevisionUi] = useState({
    projectId: project.id,
    revision: project.revision,
    selectedId: initialRevisionId,
    restorePreviewId: '',
  });
  const revisionUiForProject = revisionUi.projectId === project.id && revisionUi.revision === project.revision
    ? revisionUi
    : { projectId: project.id, revision: project.revision, selectedId: initialRevisionId, restorePreviewId: '' };
  const selectedRevision: ProjectRevision | undefined =
    project.revisions.find((revision) => revision.id === revisionUiForProject.selectedId) ?? project.revisions[1] ?? project.revisions[0];
  const restoreRevisionPreviewId = revisionUiForProject.restorePreviewId;
  const currentRevision = project.revisions.find((revision) => revision.revisionNumber === project.revision) ?? project.revisions[0];
  const pendingDecisions = project.snapshot.decisions.filter((decision) => decision.status === 'pending');
  const pendingImportProposals = (project.narrative?.proposals ?? []).filter((proposal) => proposal.approval === 'pending');
  const openOpportunityProposals = (project.narrative?.opportunities ?? []).filter((proposal) => proposal.status === 'pending' || proposal.status === 'deferred' || proposal.status === 'staged');
  const staleOpportunityCount = openOpportunityProposals.filter((proposal) => proposal.lifecycleRevision !== project.revision).length;
  const pendingProposalCount = pendingDecisions.length + pendingImportProposals.length + openOpportunityProposals.length;
  const currentPlanSnapshot = currentRevision?.snapshot ?? project.snapshot;
  const selectedPlanSnapshot = selectedRevision?.snapshot;
  const revisionCompareFields = selectedPlanSnapshot ? [
    { label: 'Original idea', before: selectedPlanSnapshot.originalIdea, after: currentPlanSnapshot.originalIdea },
    { label: 'Refined prompt', before: selectedPlanSnapshot.refinedPrompt, after: currentPlanSnapshot.refinedPrompt },
    { label: 'Mode', before: selectedPlanSnapshot.mode, after: currentPlanSnapshot.mode },
    { label: 'Story elements', before: String(selectedPlanSnapshot.entities.length), after: String(currentPlanSnapshot.entities.length) },
    { label: 'Relationships', before: String(selectedPlanSnapshot.relationships.length), after: String(currentPlanSnapshot.relationships.length) },
  ].filter((field) => field.before !== field.after) : [];

  useEffect(() => {
    if (!historyTarget) return;
    const target = document.getElementById(historyTarget.id);
    target?.scrollIntoView({ block: 'start' });
    target?.focus({ preventScroll: true });
  }, [historyTarget]);

  async function previewProjectBackup(raw: string) {
    setRestorePreview(null);
    setImportMessage(null);
    setRestoreBusy(true);
    try {
      const preview = await onPreviewProjectJson(raw);
      setRestorePreview({ raw, project: preview });
    } catch (cause) {
      setImportMessage({
        ok: false,
        text: cause instanceof Error ? cause.message : 'Invalid backup.',
      });
    } finally {
      setRestoreBusy(false);
    }
  }

  const handleFileImport = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    event.target.value = '';
    void file
      .text()
      .then(previewProjectBackup, () =>
        setImportMessage({ ok: false, text: 'Backup file could not be read.' })
      );
  };

  return (
    <div className="flex-1 min-h-0 overflow-y-auto bg-[#fbfaf7] p-4 text-[#25262a] dark:bg-gray-950 dark:text-gray-100 sm:p-6">
      <section id="revision-history" tabIndex={-1} aria-labelledby="revision-history-heading" className="mx-auto max-w-7xl space-y-4">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h2 id="revision-history-heading" className="font-serif text-2xl font-semibold">Revision history</h2>
            <p className="mt-1 text-sm text-gray-600 dark:text-gray-300">
              {project.name} · Current revision {project.revision} · {project.persistedRevision === project.revision ? 'Saved' : 'Save pending'}
            </p>
          </div>
          <p className="text-xs text-gray-600 dark:text-gray-400">{project.revisions.length} saved plan revisions</p>
        </div>

        <div className="grid gap-4 lg:grid-cols-[minmax(190px,0.7fr)_minmax(0,2fr)] xl:grid-cols-[minmax(190px,0.72fr)_minmax(0,2fr)_minmax(220px,0.82fr)]">
          <aside aria-label="Saved revisions" className="space-y-2 rounded-xl border border-[#dad8d2] bg-white p-3 dark:border-gray-700 dark:bg-gray-900">
            <p className="px-1 text-sm font-semibold">Saved revisions</p>
            {project.revisions.length === 0 ? <p className="p-2 text-sm text-gray-600 dark:text-gray-400">No saved revisions yet.</p> : (
              <ol className="max-h-[60vh] space-y-2 overflow-y-auto">
                {project.revisions.map((revision) => {
                  const isCurrent = revision === currentRevision || revision.revisionNumber === project.revision;
                  const isSelected = revision.id === selectedRevision?.id;
                  return (
                    <li key={revision.id}>
                      <button type="button" aria-pressed={isSelected} onClick={() => setRevisionUi({ ...revisionUiForProject, selectedId: revision.id, restorePreviewId: '' })} className={`w-full rounded-lg border p-3 text-left focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#62445e] ${isSelected ? 'border-[#c4b2c1] bg-[#f3edf2] dark:border-purple-800 dark:bg-purple-950/40' : 'border-[#dad8d2] bg-white hover:bg-[#fbfaf7] dark:border-gray-700 dark:bg-gray-900 dark:hover:bg-gray-800'}`}>
                        <span className="flex items-center justify-between gap-2 text-sm font-semibold"><span>Revision {revision.revisionNumber ?? '—'}</span>{isCurrent && <span className="text-xs font-medium text-[#62445e] dark:text-purple-200">Current</span>}</span>
                        <span className="mt-1 block truncate text-sm">{revision.label}</span>
                        <span className="mt-1 block text-xs text-gray-600 dark:text-gray-400">{new Date(revision.timestamp).toLocaleString()}</span>
                      </button>
                    </li>
                  );
                })}
              </ol>
            )}
          </aside>

          <section className="min-w-0 space-y-3 rounded-xl border border-[#dad8d2] bg-white p-4 dark:border-gray-700 dark:bg-gray-900 sm:p-5" aria-label="Revision comparison">
            <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
              <h3 className="font-serif text-xl font-semibold">Compare plan snapshots</h3>
              {selectedRevision && <p className="text-sm text-gray-600 dark:text-gray-300">Revision {selectedRevision.revisionNumber ?? '—'} <span className="px-1">vs</span> Current · Revision {project.revision}</p>}
            </div>
            {selectedRevision ? (
              <>
                <div className="rounded-lg border border-[#dad8d2] p-4 dark:border-gray-700">
                  <p className="text-xs font-semibold text-[#62445e] dark:text-purple-200">SAVED REVISION {selectedRevision.revisionNumber ?? ''}</p>
                  <p className="mt-2 text-sm font-semibold">{selectedRevision.label}</p>
                  <p className="mt-1 text-sm">{selectedRevision.summary}</p>
                  {revisionCompareFields.length > 0 ? (
                    <dl className="mt-4 space-y-3">
                      {revisionCompareFields.map((field) => (
                        <div key={field.label} className="grid gap-2 border-t border-[#e7e3e1] pt-3 sm:grid-cols-2 dark:border-gray-800">
                          <dt className="text-xs font-semibold text-gray-600 dark:text-gray-400 sm:col-span-2">{field.label}</dt>
                          <dd className="min-w-0 whitespace-pre-wrap break-words text-sm">{field.before || <span className="italic text-gray-500">Empty</span>}</dd>
                          <dd className="min-w-0 whitespace-pre-wrap break-words text-sm text-[#62445e] dark:text-purple-200">{field.after || <span className="italic text-gray-500">Empty</span>}</dd>
                        </div>
                      ))}
                    </dl>
                  ) : <p className="mt-4 text-sm text-gray-600 dark:text-gray-400">The available plan fields match the current saved snapshot.</p>}
                </div>
                <p className="text-xs text-gray-600 dark:text-gray-400">Revision snapshots store the story plan. Manuscript text and unapplied proposals are separate records and are not restored from this comparison.</p>
              </>
            ) : <p className="text-sm text-gray-600 dark:text-gray-400">There are no saved plan revisions to compare.</p>}
          </section>

          <aside className="space-y-4 rounded-xl border border-[#dad8d2] bg-white p-4 dark:border-gray-700 dark:bg-gray-900 sm:p-5" aria-label="Revision details and recovery">
            {selectedRevision ? (
              <>
                <div>
                  <h3 className="font-display text-base font-semibold">Revision details</h3>
                  <p className="mt-2 text-sm">Selected: Revision {selectedRevision.revisionNumber ?? '—'}</p>
                  <p className="mt-1 text-sm text-gray-600 dark:text-gray-400">{new Date(selectedRevision.timestamp).toLocaleString()}</p>
                  <p className="mt-2 text-sm">{selectedRevision.changeCount} recorded change{selectedRevision.changeCount === 1 ? '' : 's'}</p>
                </div>
                <div className="border-t border-[#e7e3e1] pt-3 dark:border-gray-800">
                  <h4 className="text-sm font-semibold">Unapplied proposals</h4>
                  <p className="mt-1 text-2xl font-semibold tabular-nums">{pendingProposalCount}</p>
                  <p className="text-xs text-gray-600 dark:text-gray-400">Proposal records remain reviewable separately; they are not restorable revisions.</p>
                  {staleOpportunityCount > 0 && <p className="mt-2 rounded-lg bg-[#f8efdf] px-3 py-2 text-xs text-[#6e4c21] dark:bg-amber-950/40 dark:text-amber-200">{staleOpportunityCount} enhancement proposal{staleOpportunityCount === 1 ? ' is' : 's are'} stale against the current revision.</p>}
                </div>
                {selectedRevision.id !== currentRevision?.id && selectedRevision.revisionNumber !== project.revision && (
                  <button type="button" className="min-h-11 w-full rounded-lg border border-[#dad8d2] px-3 py-2 text-sm font-semibold text-[#62445e] hover:bg-[#f7f2f6] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#62445e] dark:border-gray-700 dark:text-purple-200 dark:hover:bg-gray-800" onClick={() => setRevisionUi({ ...revisionUiForProject, restorePreviewId: selectedRevision.id })}>Review restore</button>
                )}
              </>
            ) : <p className="text-sm text-gray-600 dark:text-gray-400">Select a saved revision to review it.</p>}
          </aside>
        </div>

        {restoreRevisionPreviewId && selectedRevision && (
          <div role="group" aria-labelledby="revision-restore-preview-title" className="space-y-3 rounded-xl border border-[#d9bb83] bg-[#f8efdf] p-4 dark:border-amber-800 dark:bg-amber-950/30">
            <div>
              <h3 id="revision-restore-preview-title" className="font-semibold text-[#6e4c21] dark:text-amber-200">Restore saved Revision {selectedRevision.revisionNumber ?? '—'}?</h3>
              <p className="mt-1 text-sm text-[#6e4c21] dark:text-amber-100">This commits its saved plan snapshot as a new revision. The current state is first preserved as a safety checkpoint. Manuscript text and unapplied proposals remain outside the revision restore.</p>
            </div>
            <div className="flex flex-wrap gap-2">
              <button type="button" className="min-h-10 rounded-lg bg-[#62445e] px-4 py-2 text-sm font-semibold text-white hover:bg-[#50364d]" onClick={() => { onRestoreRevision(selectedRevision.id); setRevisionUi({ ...revisionUiForProject, restorePreviewId: '' }); }}>Restore Revision {selectedRevision.revisionNumber ?? ''}</button>
              <button type="button" className="min-h-10 rounded-lg border border-[#b9a47e] px-4 py-2 text-sm font-semibold text-[#5f4b2d] hover:bg-white/60 dark:border-amber-800 dark:text-amber-100 dark:hover:bg-amber-950/60" onClick={() => setRevisionUi({ ...revisionUiForProject, restorePreviewId: '' })}>Keep current revision</button>
            </div>
          </div>
        )}
      </section>

      <div className="mx-auto mt-8 max-w-7xl space-y-5">
      {/* Export & Import Section */}
      <div id="export-content" tabIndex={-1} className="space-y-2.5">
        <h3 className="font-display text-sm font-bold text-gray-900 dark:text-gray-100">
          Export Content
        </h3>
        <div className="grid grid-cols-1 gap-2">
          <button
            type="button"
            onClick={onExportJson}
            className="w-full text-left px-3 py-2 text-xs font-semibold rounded border border-gray-200 dark:border-gray-700 bg-gray-50 hover:bg-gray-100 dark:bg-gray-800 dark:hover:bg-gray-700 text-gray-900 dark:text-gray-100 transition-colors"
          >
            Download Project Backup (.json)
          </button>
          <button
            type="button"
            onClick={onExportStoryBibleMarkdown}
            className="w-full text-left px-3 py-2 text-xs font-semibold rounded border border-gray-200 dark:border-gray-700 bg-gray-50 hover:bg-gray-100 dark:bg-gray-800 dark:hover:bg-gray-700 text-gray-900 dark:text-gray-100 transition-colors"
          >
            Export Story Bible as Markdown (.md)
          </button>
          <button
            type="button"
            onClick={onExportPromptText}
            className="w-full text-left px-3 py-2 text-xs font-semibold rounded border border-gray-200 dark:border-gray-700 bg-gray-50 hover:bg-gray-100 dark:bg-gray-800 dark:hover:bg-gray-700 text-gray-900 dark:text-gray-100 transition-colors"
          >
            Export Refined Prompt (.txt)
          </button>
        </div>

        <div className="flex flex-wrap gap-2 text-xs underline">
          {onExportManuscript && (
            <button type="button" onClick={onExportManuscript}>
              Download Working Manuscript (.md)
            </button>
          )}
          {onExportManuscriptDocx && (
            <button type="button" onClick={onExportManuscriptDocx}>
              Download Working Manuscript (.docx)
            </button>
          )}
          {onExportManuscriptText && (
            <button type="button" onClick={onExportManuscriptText}>
              Download Working Manuscript (.txt)
            </button>
          )}
        </div>

        {contentExports.length > 0 && (
          <div className="flex flex-col gap-2 text-xs">
            <label className="flex min-w-0 flex-col gap-1">
              Content to export
              <select
                className="max-w-full rounded border bg-transparent p-1"
                value={selectedExport}
                onChange={(event) => setSelectedExport(event.target.value)}
              >
                <option value="">Select content</option>
                {contentExports.map((entry) => (
                  <option key={entry.id} value={entry.id}>
                    {entry.label}
                  </option>
                ))}
              </select>
            </label>
            <button
              className="self-end underline disabled:opacity-50"
              disabled={!contentExports.some((entry) => entry.id === selectedExport)}
              onClick={() => onExportContent(selectedExport)}
            >
              Download selected content
            </button>
            <fieldset className="space-y-1 rounded border border-gray-200 p-2 dark:border-gray-700">
              <legend className="px-1 font-semibold">Content ZIP bundle</legend>
              {contentExports.map((entry) => (
                <label key={entry.id} className="flex items-start gap-2">
                  <input
                    type="checkbox"
                    checked={selectedBundleExports.includes(entry.id)}
                    onChange={(event) =>
                      setSelectedBundleExports((previous) =>
                        event.target.checked
                          ? [...previous, entry.id]
                          : previous.filter((id) => id !== entry.id)
                      )
                    }
                  />
                  <span>{entry.label}</span>
                </label>
              ))}
              <p className="text-[11px] text-gray-500">
                ZIP includes a manifest and selected content. It is not a full project backup.
              </p>
              <button
                type="button"
                className="underline disabled:opacity-50"
                disabled={selectedBundleExports.length === 0}
                onClick={() => onExportContentBundle(selectedBundleExports)}
              >
                Download selected content ZIP
              </button>
            </fieldset>
          </div>
        )}

        {/* Import JSON */}
        <div className="pt-2 space-y-2">
          <label className="block text-xs font-semibold text-gray-800 dark:text-gray-200">
            Restore Project Backup from JSON File or Paste JSON
          </label>
          <input
            type="file"
            accept=".json,application/json"
            onChange={handleFileImport}
            aria-label="Import project JSON file"
            className="block w-full text-xs text-gray-600 dark:text-gray-300 file:mr-2 file:py-1.5 file:px-3 file:rounded file:border-0 file:text-xs file:font-semibold file:bg-blue-50 file:text-blue-700 dark:file:bg-blue-950 dark:file:text-blue-300"
          />
          <div className="flex gap-1.5">
            <input
              type="text"
              value={importJsonText}
              onChange={(e) => setImportJsonText(e.target.value)}
              placeholder="Or paste raw project JSON here..."
              aria-label="Paste project JSON"
              className="flex-1 min-w-0 text-xs bg-gray-50 dark:bg-gray-800 border border-gray-300 dark:border-gray-700 rounded px-2.5 py-1.5 text-gray-900 dark:text-gray-100"
            />
            <button
              type="button"
              disabled={restoreBusy || !importJsonText.trim()}
              onClick={() => void previewProjectBackup(importJsonText)}
              className="px-2.5 py-1.5 text-xs font-semibold bg-blue-600 text-white rounded disabled:opacity-40 whitespace-nowrap"
            >
              Preview JSON
            </button>
          </div>
          {restorePreview && (
            <div className="space-y-2 rounded border border-amber-400 p-3 text-xs">
              <p className="break-words">
                {restorePreview.project.name} · Schema {restorePreview.project.schemaVersion} · Revision{' '}
                {restorePreview.project.revision}
              </p>
              <p>
                A separate project will be created with the included manuscript, plan, artifacts and history.
              </p>
              <button
                type="button"
                className="mr-2 underline"
                disabled={restoreBusy}
                onClick={async () => {
                  setRestoreBusy(true);
                  const result = await onImportProjectJson(restorePreview.raw);
                  setRestoreBusy(false);
                  setImportMessage({
                    ok: result.ok,
                    text: result.ok
                      ? 'Restored project copy saved.'
                      : result.error ?? 'Restore failed.',
                  });
                  if (result.ok) {
                    setRestorePreview(null);
                    setImportJsonText('');
                  }
                }}
              >
                Restore a copy
              </button>
              <button
                type="button"
                className="underline"
                disabled={restoreBusy}
                onClick={() => setRestorePreview(null)}
              >
                Cancel
              </button>
            </div>
          )}
          {importMessage && (
            <p
              role="alert"
              className={`text-xs font-medium ${
                importMessage.ok
                  ? 'text-emerald-600 dark:text-emerald-400'
                  : 'text-red-600 dark:text-red-400'
              }`}
            >
              {importMessage.text}
            </p>
          )}
        </div>
      </div>

      {/* Saved Local Projects Switcher */}
      <div
        id="project-management"
        tabIndex={-1}
        className="space-y-2 border-t border-gray-200 dark:border-gray-800 pt-4"
      >
        <h3 className="font-display text-sm font-bold text-gray-900 dark:text-gray-100">
          Saved Local Projects ({savedProjects.length})
        </h3>
        <p className="text-[11px] text-gray-500 dark:text-gray-400">
          Automatically saved in browser storage (IndexedDB + localStorage).
        </p>
        <div className="space-y-1.5">
          {savedProjects.map((proj) => {
            const isCurrent = proj.id === project.id;
            return (
              <div
                key={proj.id}
                className={`flex items-center justify-between gap-2 p-2 rounded border text-xs ${
                  isCurrent
                    ? 'border-blue-500 bg-blue-50/40 dark:bg-blue-950/30'
                    : 'border-gray-200 dark:border-gray-800'
                }`}
              >
                <button
                  type="button"
                  onClick={() => onSwitchProject(proj.id)}
                  className="text-left flex-1 min-w-0"
                >
                  <div className="font-semibold text-gray-900 dark:text-gray-100 truncate">
                    {proj.name}
                  </div>
                  <div className="text-[11px] text-gray-500 tabular-nums">
                    {proj.revisions.length} revisions · {proj.snapshot.mode} mode
                  </div>
                </button>
                {savedProjects.length > 1 && (
                  <button
                    type="button"
                    onClick={() => onDeleteProject(proj.id)}
                    className="text-gray-400 hover:text-red-600 px-1.5 py-0.5 text-xs"
                    aria-label={`Delete project ${proj.name}`}
                  >
                    Delete
                  </button>
                )}
              </div>
            );
          })}
        </div>

        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (newProjName.trim() && newProjIdea.trim()) {
              onCreateNewProject(newProjName.trim(), newProjIdea.trim());
              setNewProjName('');
              setNewProjIdea('');
            }
          }}
          className="pt-2 space-y-1.5"
        >
          <input
            type="text"
            value={newProjName}
            onChange={(e) => setNewProjName(e.target.value)}
            placeholder="New project title..."
            aria-label="New project title"
            className="w-full text-xs bg-gray-50 dark:bg-gray-800 border border-gray-300 dark:border-gray-700 rounded px-2.5 py-1.5 text-gray-900 dark:text-gray-100"
          />
          <input
            type="text"
            value={newProjIdea}
            onChange={(e) => setNewProjIdea(e.target.value)}
            placeholder="Initial story or scene idea..."
            aria-label="New project initial prompt"
            className="w-full text-xs bg-gray-50 dark:bg-gray-800 border border-gray-300 dark:border-gray-700 rounded px-2.5 py-1.5 text-gray-900 dark:text-gray-100"
          />
          <button
            type="submit"
            disabled={!newProjName.trim() || !newProjIdea.trim()}
            className="w-full py-1.5 text-xs font-semibold bg-gray-900 dark:bg-gray-700 text-white rounded disabled:opacity-40"
          >
            Create Project
          </button>
        </form>
      </div>

      </div>
    </div>
  );
};

export default HistoryPanel;
