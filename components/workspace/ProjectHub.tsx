import { useEffect, useMemo, useState } from 'react';
import type { CreativeProject } from '../../shared/types';
import { deleteBackup, listBackups, saveBackup, setBackupPin, verifyBackup, type ProjectBackup } from '../../lib/narrative/recovery';
import { planBackupRetention, type RetentionRecord } from '../../lib/narrative/retentionPlanner';
import {
  buildAllProjectsArchiveZip,
  parseAndVerifyAllProjectsArchive,
  type ArchiveRestoreSequenceResult,
  type VerifiedArchiveRestoreResult,
} from '../../lib/narrative/recovery/allProjectsArchive';
import {
  detectExternalFolderBackupSupport,
  writeVerifiedExternalFolderBackup,
} from '../../lib/narrative/recovery/externalFolderBackup';
import { workspaceButton } from '../manuscript/ManuscriptEditor';

interface Props {
  project: CreativeProject;
  savedProjects: CreativeProject[];
  openProjects: () => void;
  openExport: () => void;
  openImport: () => void;
  restore: (payload: string, replace?: boolean) => Promise<{ ok: boolean; error?: string }>;
  restoreArchiveProjects?: (projects: CreativeProject[]) => Promise<ArchiveRestoreSequenceResult<CreativeProject>>;
  downloadBackup: (backup: ProjectBackup) => void;
  onExportManuscriptDocx?: () => void;
  onExportManuscriptText?: () => void;
  onExportStoryBible?: () => void;
  onExportPrompt?: () => void;
  onExportIssuesAudit?: () => void;
  onDownloadAllProjectsArchive?: (filename: string, bytes: Uint8Array) => void;
  autoBackupEnabled?: boolean;
  onToggleAutoBackup?: (enabled: boolean) => void;
}

export default function ProjectHub({
  project,
  savedProjects,
  openProjects,
  openExport,
  openImport,
  restore,
  restoreArchiveProjects,
  downloadBackup,
  onExportManuscriptDocx,
  onExportManuscriptText,
  onExportStoryBible,
  onExportPrompt,
  onExportIssuesAudit,
  onDownloadAllProjectsArchive,
  autoBackupEnabled = false,
  onToggleAutoBackup,
}: Props) {
  const [backups, setBackups] = useState<ProjectBackup[]>([]);
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const [label, setLabel] = useState('');
  const [preview, setPreview] = useState<{ backup: ProjectBackup; name: string } | null>(null);

  // Retention planner (opt-in, explicit confirmation before deletion)
  const [retentionEnabled, setRetentionEnabled] = useState(false);
  const [maxBackups, setMaxBackups] = useState(5);

  // External folder destination status
  const externalFolderSupport = useMemo(() => detectExternalFolderBackupSupport(), []);
  const [externalStatus, setExternalStatus] = useState<string>('');

  // All-projects archive restore preview
  const [archivePreview, setArchivePreview] = useState<VerifiedArchiveRestoreResult | null>(null);
  const [archiveError, setArchiveError] = useState('');
  const [archiveRestoredCount, setArchiveRestoredCount] = useState(0);

  useEffect(() => {
    let cancelled = false;
    void listBackups(project.id).then(
      (records) => {
        if (!cancelled) setBackups(records);
      },
      () => {
        if (!cancelled) setMessage('Browser backups could not be read.');
      }
    );
    return () => {
      cancelled = true;
    };
  }, [project.id]);

  const retentionPlan = useMemo(() => {
    if (!retentionEnabled) return null;
    const records: RetentionRecord[] = backups.map((b) => ({
      id: b.id,
      projectId: b.projectId,
      destinationId: 'internal-vault',
      format: 'pcc-project-backup',
      formatVersion: 1,
      schemaVersion: b.schemaVersion,
      completeness: 'project',
      payloadBytes: b.bytes,
      payloadSha256: b.sha256,
      createdAt: b.createdAt,
      pinned: b.pinned,
      verification: 'verified',
    }));
    try {
      return planBackupRetention(records, {
        enabled: true,
        maxBackups: Math.max(1, Math.trunc(maxBackups || 1)),
      });
    } catch {
      return { candidates: [], warnings: ['Enter a positive integer for max backups.'] };
    }
  }, [backups, retentionEnabled, maxBackups]);

  async function perform(operation: () => Promise<string>) {
    if (busy) return;
    setBusy(true);
    setMessage('');
    try {
      setMessage(await operation());
      setBackups(await listBackups(project.id));
    } catch (cause) {
      setMessage(cause instanceof Error ? cause.message : 'Backup operation failed.');
    } finally {
      setBusy(false);
    }
  }

  const handleExportAllProjects = async () => {
    setBusy(true);
    setMessage('');
    try {
      const archive = await buildAllProjectsArchiveZip(savedProjects, {
        retentionEnabled,
        retentionMaxBackups: maxBackups,
        autoBackupEnabled,
      });
      onDownloadAllProjectsArchive?.(archive.filename, archive.bytes);
      setMessage(`Exported verified portable archive (${archive.manifest.projectCount} project(s), SHA-256 manifest included).`);
    } catch (cause) {
      setMessage(cause instanceof Error ? cause.message : 'All-projects archive export failed.');
    } finally {
      setBusy(false);
    }
  };

  const handleExternalFolderBackup = async () => {
    setBusy(true);
    setExternalStatus('');
    try {
      const archive = await buildAllProjectsArchiveZip(savedProjects, {
        retentionEnabled,
        retentionMaxBackups: maxBackups,
        autoBackupEnabled,
      });
      const result = await writeVerifiedExternalFolderBackup(archive.filename, archive.bytes);
      if (result.ok) {
        setExternalStatus(
          `Verified external folder backup saved to "${result.folderName}/${result.filename}" (readback SHA-256: ${result.sha256?.slice(0, 12)}…).`
        );
      } else {
        setExternalStatus(result.error ?? 'External folder backup failed.');
      }
    } catch (cause) {
      setExternalStatus(cause instanceof Error ? cause.message : 'External folder backup failed.');
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
      const bytes = new Uint8Array(await file.arrayBuffer());
      const existingIds = new Set(savedProjects.map((p) => p.id));
      const verified = await parseAndVerifyAllProjectsArchive(bytes, existingIds);
      setArchivePreview(verified);
    } catch (cause) {
      setArchiveError(cause instanceof Error ? cause.message : 'Portable archive could not be verified.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <main className="min-h-0 flex-1 overflow-auto p-4 sm:p-6">
      <div className="mx-auto max-w-4xl space-y-5">
        <h1 className="text-2xl font-bold">Project Management &amp; Export Center</h1>
        <div className="flex flex-wrap gap-2">
          <button type="button" className={workspaceButton} onClick={openProjects}>Start from Idea / Manage projects</button>
          <button type="button" className={workspaceButton} onClick={openImport}>Import &amp; Analyze Story</button>
          <button type="button" className={workspaceButton} onClick={openExport}>Export Content / Restore JSON</button>
        </div>

        {/* Export Center (Package G) */}
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

          {/* Portable Archive Restore */}
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
              <div className="rounded border border-amber-400 bg-amber-50/40 p-3 space-y-2 dark:bg-amber-950/30">
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
                    onClick={async () => {
                      if (!restoreArchiveProjects) return;
                      setBusy(true);
                      setArchiveError('');
                      const res = await restoreArchiveProjects(archivePreview.projects);
                      setBusy(false);
                      if (res.ok) {
                        setArchivePreview(null);
                        setMessage(`Restored ${archiveRestoredCount + res.count} verified project(s) from portable archive.`);
                        setArchiveRestoredCount(0);
                      } else {
                        setArchiveError(res.error ?? 'Archive restore failed.');
                        if (res.count > 0 && res.remainingProjects?.length) {
                          setArchiveRestoredCount((count) => count + res.count);
                          setArchivePreview((current) => current
                            ? { ...current, projects: res.remainingProjects! }
                            : current);
                          setMessage(`${res.count} project(s) restored in this attempt; retry will process only the remaining archive projects.`);
                        } else if (res.count > 0) {
                          setArchivePreview(null);
                          setArchiveRestoredCount(0);
                        }
                      }
                    }}
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

        {/* Backup Destinations & Optional External Folder Backup */}
        <section aria-labelledby="backup-destinations-heading" className="space-y-3 rounded-lg border border-gray-300 p-4 dark:border-gray-700">
          <h2 id="backup-destinations-heading" className="font-semibold">Backup &amp; Restore Destinations</h2>
          <div className="grid gap-2 sm:grid-cols-3 text-xs">
            <div className="rounded border border-gray-200 p-2.5 dark:border-gray-800">
              <div className="font-semibold">1. Internal Browser Backup</div>
              <p className="text-gray-600 dark:text-gray-400 mt-0.5">{backups.length} verified backup(s) in this browser. Clearing site data removes them.</p>
            </div>
            <div className="rounded border border-gray-200 p-2.5 dark:border-gray-800">
              <div className="font-semibold">2. Portable Download</div>
              <p className="text-gray-600 dark:text-gray-400 mt-0.5">Available in all browsers via JSON or All-Projects ZIP above.</p>
            </div>
            <div className="rounded border border-gray-200 p-2.5 dark:border-gray-800">
              <div className="font-semibold">3. External Folder Backup</div>
              <p className="text-gray-600 dark:text-gray-400 mt-0.5">{externalFolderSupport.reason}</p>
              <button
                type="button"
                disabled={busy || !externalFolderSupport.supported}
                onClick={() => void handleExternalFolderBackup()}
                className={`${workspaceButton} mt-2 text-xs`}
              >
                Save Verified Backup to Folder
              </button>
            </div>
          </div>
          {externalStatus && <p role="status" className="text-xs font-medium">{externalStatus}</p>}

          {onToggleAutoBackup && (
            <label className="flex items-center gap-2 text-xs pt-1">
              <input
                type="checkbox"
                checked={autoBackupEnabled}
                onChange={(e) => onToggleAutoBackup(e.target.checked)}
              />
              <span>Opt-in: create a verified browser backup automatically while the app is open after major revisions (never deletes existing backups).</span>
            </label>
          )}

          <div className="flex flex-wrap items-center gap-2 pt-2 border-t border-gray-200 dark:border-gray-800">
            <label className="text-sm">Backup label{' '}
              <input className="max-w-full rounded border bg-transparent px-2 py-1" value={label} onChange={(event) => setLabel(event.target.value)} />
            </label>
            <button
              type="button"
              className={workspaceButton}
              disabled={busy || project.persistedRevision !== project.revision}
              onClick={() =>
                void perform(async () => {
                  await saveBackup(project, label.trim() || 'Manual backup');
                  setLabel('');
                  return 'Verified project backup created.';
                })
              }
            >
              Create Backup
            </button>
          </div>
          {project.persistedRevision !== project.revision && <p className="text-sm">Save the current project revision to enable a browser backup.</p>}
          {message && <p role="status" className="break-words text-sm">{message}</p>}

          {/* Opt-in Backup Retention Planner (Explicit User Confirmation Only) */}
          <div className="rounded border border-gray-200 p-3 space-y-2 text-xs dark:border-gray-800">
            <div className="flex flex-wrap items-center gap-3">
              <label className="flex items-center gap-1.5 font-semibold">
                <input
                  type="checkbox"
                  checked={retentionEnabled}
                  onChange={(e) => setRetentionEnabled(e.target.checked)}
                />
                Plan backup retention cleanup (opt-in, never auto-deletes)
              </label>
              {retentionEnabled && (
                <label className="flex items-center gap-1.5">
                  <span>Keep at most</span>
                  <input
                    type="number"
                    min={1}
                    max={50}
                    value={maxBackups}
                    onChange={(e) => setMaxBackups(Math.max(1, Math.min(50, Number(e.target.value) || 1)))}
                    className="w-16 rounded border px-2 py-0.5 dark:bg-gray-900"
                  />
                  <span>backups (pinned &amp; newest verified always protected)</span>
                </label>
              )}
            </div>
            {retentionPlan && (
              <div className="space-y-1.5">
                {retentionPlan.warnings.map((w, idx) => (
                  <p key={idx} className="text-amber-800 dark:text-amber-300">{w}</p>
                ))}
                {retentionPlan.candidates.length === 0 ? (
                  <p className="text-gray-600 dark:text-gray-400">No backups proposed for cleanup under the current policy.</p>
                ) : (
                  <div className="space-y-1.5">
                    <p className="font-semibold">Proposed for deletion ({retentionPlan.candidates.length}):</p>
                    <ul className="list-disc pl-5">
                      {retentionPlan.candidates.map((cand) => {
                        const match = backups.find((b) => b.id === cand.id);
                        return (
                          <li key={cand.id}>
                            {match?.label ?? cand.id} (Rev {match?.revision ?? '?'}) — {cand.reasons.join(', ')}
                          </li>
                        );
                      })}
                    </ul>
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => {
                        if (!window.confirm(`Delete ${retentionPlan.candidates.length} proposed backup(s)? Pinned and newest verified backups remain protected.`)) return;
                        void perform(async () => {
                          let removed = 0;
                          for (const cand of retentionPlan.candidates) {
                            const match = backups.find((b) => b.id === cand.id);
                            if (match && !match.pinned) {
                              await deleteBackup(match);
                              removed += 1;
                            }
                          }
                          return `Deleted ${removed} planned backup(s).`;
                        });
                      }}
                      className="rounded border border-red-300 bg-red-50 px-2.5 py-1 text-xs font-semibold text-red-700 hover:bg-red-100 dark:border-red-800 dark:bg-red-950/40 dark:text-red-300"
                    >
                      Confirm Retention Cleanup ({retentionPlan.candidates.length})
                    </button>
                  </div>
                )}
              </div>
            )}
          </div>

          {backups.length === 0 && <p className="text-sm">No verified browser backups for this project.</p>}
          <ul className="space-y-3">
            {backups.map((backup) => (
              <li key={backup.id} className="space-y-2 border-t border-gray-300 pt-3 dark:border-gray-700">
                <p className="break-words font-medium">{backup.label}{backup.pinned ? ' · Pinned' : ''}</p>
                <p className="text-sm">{new Date(backup.createdAt).toLocaleString()} · Revision {backup.revision} · Schema {backup.schemaVersion} · {backup.bytes} bytes · Complete project</p>
                <details className="break-all text-xs"><summary>SHA-256</summary>{backup.sha256}</details>
                <div className="flex flex-wrap gap-2">
                  <button
                    type="button"
                    className={workspaceButton}
                    disabled={busy}
                    onClick={() =>
                      void perform(async () => {
                        setPreview({ backup, name: (await verifyBackup(backup)).name });
                        return '';
                      })
                    }
                  >
                    Preview restore
                  </button>
                  <button
                    type="button"
                    className={workspaceButton}
                    disabled={busy}
                    onClick={() =>
                      void perform(async () => {
                        await verifyBackup(backup);
                        downloadBackup(backup);
                        return 'Backup download requested.';
                      })
                    }
                  >
                    Export backup
                  </button>
                  <button
                    type="button"
                    className={workspaceButton}
                    disabled={busy}
                    onClick={() =>
                      void perform(async () => {
                        setBackupPin(backup, !backup.pinned);
                        return backup.pinned ? 'Backup unpinned.' : 'Backup pinned.';
                      })
                    }
                  >
                    {backup.pinned ? 'Unpin' : 'Pin'}
                  </button>
                  <button
                    type="button"
                    className={workspaceButton}
                    disabled={busy || backup.pinned || backups.length <= 1}
                    onClick={() => {
                      if (window.confirm(`Delete browser backup “${backup.label}”?`)) {
                        void perform(async () => {
                          await deleteBackup(backup);
                          return 'Browser backup deleted.';
                        });
                      }
                    }}
                  >
                    Delete backup
                  </button>
                </div>
              </li>
            ))}
          </ul>
          {preview && (
            <div className="space-y-2 rounded border border-amber-400 p-3">
              <p>Restore “{preview.name}”, revision {preview.backup.revision}, as a separate project with its own ID.</p>
              <button
                type="button"
                className={workspaceButton}
                disabled={busy}
                onClick={() =>
                  void perform(async () => {
                    const result = await restore(JSON.stringify(preview.backup));
                    if (!result.ok) throw new Error(result.error);
                    return 'Restored project copy saved.';
                  })
                }
              >
                Restore project copy
              </button>{' '}
              <button
                type="button"
                className={workspaceButton}
                disabled={busy || preview.backup.schemaVersion < project.schemaVersion}
                onClick={() => {
                  if (!window.confirm('Replace the current project with this backup? A verified safety checkpoint will be saved first.')) return;
                  void perform(async () => {
                    const result = await restore(JSON.stringify(preview.backup), true);
                    if (!result.ok) throw new Error(result.error);
                    setPreview(null);
                    return 'Project replaced after saving a verified safety checkpoint.';
                  });
                }}
              >
                Replace current project
              </button>{' '}
              <button type="button" className={workspaceButton} disabled={busy} onClick={() => setPreview(null)}>Cancel</button>
            </div>
          )}
        </section>
      </div>
    </main>
  );
}
