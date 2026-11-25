/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useEffect, useState } from 'react';
import type { CreativeProject } from '../../shared/types';

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
    <div className="flex-1 overflow-y-auto p-4 space-y-5 min-h-0">
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

      {/* Durable Version History */}
      <div
        id="revision-history"
        tabIndex={-1}
        className="space-y-2 border-t border-gray-200 dark:border-gray-800 pt-4"
      >
        <h3 className="font-display text-sm font-bold text-gray-900 dark:text-gray-100">
          Revision History ({project.revisions.length})
        </h3>
        <p className="text-[11px] text-gray-500 dark:text-gray-400">
          Restoring any revision preserves your current state as a safety checkpoint first.
        </p>
        <div className="space-y-2">
          {project.revisions.map((rev, idx) => (
            <div
              key={rev.id}
              className="p-2.5 rounded border border-gray-200 dark:border-gray-800 text-xs space-y-1"
            >
              <div className="flex items-center justify-between gap-2">
                <span className="font-semibold text-gray-900 dark:text-gray-100">
                  {rev.label}
                </span>
                {idx > 0 && (
                  <button
                    type="button"
                    onClick={() => onRestoreRevision(rev.id)}
                    className="px-2 py-0.5 text-[11px] font-semibold bg-blue-50 dark:bg-blue-950 text-blue-700 dark:text-blue-300 rounded border border-blue-200 dark:border-blue-800 hover:bg-blue-100"
                  >
                    Restore
                  </button>
                )}
              </div>
              <p className="text-gray-600 dark:text-gray-400">{rev.summary}</p>
              <div className="text-[10px] text-gray-400 font-mono tabular-nums">
                {new Date(rev.timestamp).toLocaleTimeString()} · ID: {rev.id.slice(0, 12)}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
};

export default HistoryPanel;
