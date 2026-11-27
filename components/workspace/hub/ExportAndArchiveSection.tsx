/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState } from 'react';
import type { CreativeProject } from '../../../shared/types';
import type {
  ArchiveRestoreSequenceResult,
  VerifiedArchiveRestoreResult,
} from '../../../lib/narrative/recovery/allProjectsArchive';
import { workspaceButton } from '../../manuscript/ManuscriptEditor';
import { runArchiveRestoreWithFinally } from './backupOperations';

interface ExportAndArchiveSectionProps {
  projectId: string;
  savedProjects: CreativeProject[];
  busy: boolean;
  setBusy: (busy: boolean) => void;
  setMessage: (message: string) => void;
  isCurrentTarget: (id: string) => boolean;
  retentionEnabled: boolean;
  maxBackups: number;
  autoBackupEnabled: boolean;
  openExport: () => void;
  restoreArchiveProjects?: (projects: CreativeProject[]) => Promise<ArchiveRestoreSequenceResult<CreativeProject>>;
  onExportManuscriptDocx?: () => void;
  onExportManuscriptText?: () => void;
  onExportStoryBible?: () => void;
  onExportPrompt?: () => void;
  onExportIssuesAudit?: () => void;
  onDownloadAllProjectsArchive?: (filename: string, bytes: Uint8Array) => void;
}

export const ExportAndArchiveSection: React.FC<ExportAndArchiveSectionProps> = ({
  projectId,
  savedProjects,
  busy,
  setBusy,
  setMessage,
  isCurrentTarget,
  retentionEnabled,
  maxBackups,
  autoBackupEnabled,
  openExport,
  restoreArchiveProjects,
  onExportManuscriptDocx,
  onExportManuscriptText,
  onExportStoryBible,
  onExportPrompt,
  onExportIssuesAudit,
  onDownloadAllProjectsArchive,
}) => {
  const [archivePreview, setArchivePreview] = useState<VerifiedArchiveRestoreResult | null>(null);
  const [archiveError, setArchiveError] = useState('');
  const [archiveRestoredCount, setArchiveRestoredCount] = useState(0);

  const handleExportAllProjects = async () => {
    setBusy(true);
    setMessage('');
    try {
      const { buildAllProjectsArchiveZip } = await import('../../../lib/narrative/recovery/allProjectsArchive');
      const archive = await buildAllProjectsArchiveZip(savedProjects, {
        retentionEnabled,
        retentionMaxBackups: maxBackups,
        autoBackupEnabled,
      });
      if (!isCurrentTarget(projectId)) return;
      onDownloadAllProjectsArchive?.(archive.filename, archive.bytes);
      setMessage(`Exported verified portable archive (${archive.manifest.projectCount} project(s), SHA-256 manifest included).`);
    } catch (cause) {
      if (isCurrentTarget(projectId)) {
        setMessage(cause instanceof Error ? cause.message : 'All-projects archive export failed.');
      }
    } finally {
      setBusy(false);
    }
  };

  const handleSelectArchiveFile = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    setArchiveError('');
    setArchivePreview(null);
    setArchiveRestoredCount(0);
    setBusy(true);
    try {
      const { parseAndVerifyAllProjectsArchive } = await import('../../../lib/narrative/recovery/allProjectsArchive');
      const bytes = new Uint8Array(await file.arrayBuffer());
      const existingIds = new Set(savedProjects.map((p) => p.id));
      const verified = await parseAndVerifyAllProjectsArchive(bytes, existingIds);
      if (isCurrentTarget(projectId)) setArchivePreview(verified);
    } catch (cause) {
      if (isCurrentTarget(projectId)) {
        setArchiveError(cause instanceof Error ? cause.message : 'Portable archive could not be verified.');
      }
    } finally {
      setBusy(false);
    }
  };

  const handleConfirmArchiveRestore = async () => {
    if (!restoreArchiveProjects || !archivePreview) return;
    const previewSnapshot = archivePreview;
    await runArchiveRestoreWithFinally({
      setBusy,
      setArchiveError,
      run: async () => {
        const res = await restoreArchiveProjects(previewSnapshot.projects);
        if (!isCurrentTarget(projectId)) return;
        if (res.ok) {
          setArchivePreview(null);
          setMessage(`Restored ${archiveRestoredCount + res.count} verified project(s) from portable archive.`);
          setArchiveRestoredCount(0);
          return;
        }
        setArchiveError(res.error ?? 'Archive restore failed.');
        if (res.count > 0 && res.remainingProjects?.length) {
          setArchiveRestoredCount((count) => count + res.count);
          setArchivePreview((current) => (current ? { ...current, projects: res.remainingProjects! } : current));
          setMessage(`${res.count} project(s) restored in this attempt; retry will process only the remaining archive projects.`);
        } else if (res.count > 0) {
          setArchivePreview(null);
          setArchiveRestoredCount(0);
        }
      },
    });
  };

  return (
    <>
      <section aria-labelledby="recovery-export-title" className="space-y-1 border-t border-[#dad8d2] pt-6 dark:border-gray-700">
        <h2 id="recovery-export-title" className="font-display text-xl font-semibold">Backup, export &amp; recovery</h2>
        <p className="text-sm text-gray-600 dark:text-gray-300">
          A verified project backup contains restorable project data. Content exports such as DOCX, Markdown and TXT are separate files.
        </p>
        <button
          type="button"
          className="mt-2 min-h-10 rounded-lg px-3 text-sm font-semibold text-[#62445e] underline-offset-4 hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#62445e] dark:text-purple-200"
          onClick={openExport}
        >
          Open export center
        </button>
      </section>

      <section aria-labelledby="export-center-heading" className="space-y-3 rounded-lg border border-gray-300 p-4 dark:border-gray-700">
        <h2 id="export-center-heading" className="font-semibold">Export Center &amp; Portable All-Projects Archive</h2>
        <p className="text-xs text-gray-600 dark:text-gray-300">
          Export working manuscript deliverables (DOCX, Markdown, TXT), Story Bible, refined prompt, evidence/issues audit, or a SHA-256 verified all-projects portable ZIP archive. Exports never include API keys or secrets.
        </p>
        <div className="flex flex-wrap gap-2">
          {onExportManuscriptDocx && (
            <button type="button" className={workspaceButton} onClick={onExportManuscriptDocx}>
              Export Manuscript (.docx)
            </button>
          )}
          {onExportManuscriptText && (
            <button type="button" className={workspaceButton} onClick={onExportManuscriptText}>
              Export Manuscript (.txt)
            </button>
          )}
          {onExportStoryBible && (
            <button type="button" className={workspaceButton} onClick={onExportStoryBible}>
              Export Story Bible (.md)
            </button>
          )}
          {onExportPrompt && (
            <button type="button" className={workspaceButton} onClick={onExportPrompt}>
              Export Refined Prompt (.txt)
            </button>
          )}
          {onExportIssuesAudit && (
            <button type="button" className={workspaceButton} onClick={onExportIssuesAudit}>
              Export Issues &amp; Audit (.md)
            </button>
          )}
          <button type="button" className={workspaceButton} disabled={busy || savedProjects.length === 0} onClick={() => void handleExportAllProjects()}>
            Download All-Projects Archive (.zip · {savedProjects.length})
          </button>
        </div>

        <div className="space-y-2 border-t border-gray-200 pt-3 text-xs dark:border-gray-800">
          <label className="block font-semibold" htmlFor="all-projects-archive-input">
            Restore from All-Projects Portable Archive (.zip)
          </label>
          <input
            id="all-projects-archive-input"
            type="file"
            accept=".zip,application/zip"
            onChange={(e) => void handleSelectArchiveFile(e)}
            className="block w-full text-xs"
          />
          {archiveError && <p role="alert" className="text-red-700 dark:text-red-300">{archiveError}</p>}
          {archivePreview && (
            <div className="space-y-2 rounded border border-amber-400 bg-amber-50/40 p-3 dark:bg-amber-950/30">
              <p className="font-semibold">
                {archiveRestoredCount > 0
                  ? `Partial restore: ${archiveRestoredCount} project(s) restored; ${archivePreview.projects.length} remain.`
                  : `Verified archive: ${archivePreview.projects.length} project(s) · Exported ${new Date(archivePreview.manifest.exportedAt).toLocaleString()}`}
              </p>
              {archivePreview.remappedIds.length > 0 && (
                <p className="text-amber-900 dark:text-amber-200">
                  {archivePreview.remappedIds.length} colliding project ID(s) will be restored as separate copies with fresh IDs (no existing project will be overwritten).
                </p>
              )}
              {archivePreview.warnings.map((w, idx) => (
                <p key={idx} className="text-amber-900 dark:text-amber-200">{w}</p>
              ))}
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  disabled={busy || !restoreArchiveProjects}
                  onClick={() => void handleConfirmArchiveRestore()}
                  className="rounded bg-blue-600 px-3 py-1 text-xs font-semibold text-white hover:bg-blue-700 disabled:opacity-45"
                >
                  {archiveRestoredCount > 0
                    ? `Restore Remaining Projects (${archivePreview.projects.length})`
                    : `Confirm Verified Restore (${archivePreview.projects.length})`}
                </button>
                <button type="button" className={workspaceButton} onClick={() => { setArchivePreview(null); setArchiveRestoredCount(0); }}>
                  Cancel
                </button>
              </div>
            </div>
          )}
        </div>
      </section>
    </>
  );
};
