/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useMemo, useState } from 'react';
import type { CreativeProject } from '../../../shared/types';
import {
  deleteBackup,
  saveBackup,
  setBackupPinLocked,
  verifyBackup,
  type ProjectBackup,
} from '../../../lib/narrative/recovery';
import { planBackupRetention, type RetentionRecord } from '../../../lib/narrative/retentionPlanner';
import {
  detectExternalFolderBackupSupport,
  writeVerifiedExternalFolderBackup,
} from '../../../lib/narrative/recovery/externalFolderBackup';
import { workspaceButton } from '../../manuscript/ManuscriptEditor';

interface RetentionPlannerBoxProps {
  backups: ProjectBackup[];
  busy: boolean;
  retentionEnabled: boolean;
  setRetentionEnabled: (enabled: boolean) => void;
  maxBackups: number;
  setMaxBackups: (count: number) => void;
  perform: (operation: () => Promise<string>) => Promise<void>;
}

const RetentionPlannerBox: React.FC<RetentionPlannerBoxProps> = ({
  backups,
  busy,
  retentionEnabled,
  setRetentionEnabled,
  maxBackups,
  setMaxBackups,
  perform,
}) => {
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

  return (
    <div className="space-y-2 rounded border border-gray-200 p-3 text-xs dark:border-gray-800">
      <div className="flex flex-wrap items-center gap-3">
        <label className="flex items-center gap-1.5 font-semibold">
          <input type="checkbox" checked={retentionEnabled} onChange={(e) => setRetentionEnabled(e.target.checked)} />
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
  );
};

interface BackupPreviewCardProps {
  project: CreativeProject;
  preview: { backup: ProjectBackup; project: CreativeProject };
  busy: boolean;
  isCurrentTarget: (id: string) => boolean;
  perform: (operation: () => Promise<string>) => Promise<void>;
  restore: (payload: string, replace?: boolean) => Promise<{ ok: boolean; error?: string }>;
  onClose: () => void;
}

const BackupPreviewCard: React.FC<BackupPreviewCardProps> = ({
  project,
  preview,
  busy,
  isCurrentTarget,
  perform,
  restore,
  onClose,
}) => (
  <div className="space-y-3 rounded-xl border border-[#d9bb83] bg-[#f8efdf] p-4 text-sm dark:border-amber-800 dark:bg-amber-950/30">
    <div>
      <h3 className="font-semibold text-[#6e4c21] dark:text-amber-200">Verified backup preview</h3>
      <p className="mt-1 text-[#6e4c21] dark:text-amber-100">Choose whether to restore a separate copy or replace the active project. A replacement saves a verified safety checkpoint first.</p>
    </div>
    <dl className="grid gap-3 sm:grid-cols-2">
      <div className="rounded-lg border border-[#d9bb83] bg-white/70 p-3 dark:border-amber-900 dark:bg-gray-900/60">
        <dt className="font-semibold">Active project · Revision {project.revision}</dt>
        <dd className="mt-1">{project.name}</dd>
        <dd className="mt-1 text-xs text-gray-700 dark:text-gray-300">{project.snapshot.entities.length} elements · {project.snapshot.relationships.length} relationships</dd>
      </div>
      <div className="rounded-lg border border-[#d9bb83] bg-white/70 p-3 dark:border-amber-900 dark:bg-gray-900/60">
        <dt className="font-semibold">Backup · Revision {preview.backup.revision}</dt>
        <dd className="mt-1">{preview.project.name}</dd>
        <dd className="mt-1 text-xs text-gray-700 dark:text-gray-300">{preview.project.snapshot.entities.length} elements · {preview.project.snapshot.relationships.length} relationships · Verified {new Date(preview.backup.createdAt).toLocaleString()}</dd>
      </div>
    </dl>
    <p className="text-xs text-[#6e4c21] dark:text-amber-100">This project backup contains restorable project data. Content exports are separate files and cannot restore a project.</p>
    <div className="flex flex-wrap gap-2">
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
        Restore as a separate project
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
            if (isCurrentTarget(project.id)) onClose();
            return 'Project replaced after saving a verified safety checkpoint.';
          });
        }}
      >
        Review replacement confirmation
      </button>{' '}
      <button type="button" className={workspaceButton} disabled={busy} onClick={onClose}>Cancel</button>
    </div>
  </div>
);

interface BrowserBackupsSectionProps {
  project: CreativeProject;
  savedProjects: CreativeProject[];
  backups: ProjectBackup[];
  busy: boolean;
  setBusy: (busy: boolean) => void;
  message: string;
  retentionEnabled: boolean;
  setRetentionEnabled: (enabled: boolean) => void;
  maxBackups: number;
  setMaxBackups: (count: number) => void;
  autoBackupEnabled: boolean;
  onToggleAutoBackup?: (enabled: boolean) => void;
  isCurrentTarget: (id: string) => boolean;
  perform: (operation: () => Promise<string>) => Promise<void>;
  restore: (payload: string, replace?: boolean) => Promise<{ ok: boolean; error?: string }>;
  downloadBackup: (backup: ProjectBackup) => void;
}

export const BrowserBackupsSection: React.FC<BrowserBackupsSectionProps> = ({
  project,
  savedProjects,
  backups,
  busy,
  setBusy,
  message,
  retentionEnabled,
  setRetentionEnabled,
  maxBackups,
  setMaxBackups,
  autoBackupEnabled,
  onToggleAutoBackup,
  isCurrentTarget,
  perform,
  restore,
  downloadBackup,
}) => {
  const [label, setLabel] = useState('');
  const [preview, setPreview] = useState<{ backup: ProjectBackup; project: CreativeProject } | null>(null);
  const externalFolderSupport = useMemo(() => detectExternalFolderBackupSupport(), []);
  const [externalStatus, setExternalStatus] = useState('');

  const handleExternalFolderBackup = async () => {
    setBusy(true);
    setExternalStatus('');
    try {
      const { buildAllProjectsArchiveZip } = await import('../../../lib/narrative/recovery/allProjectsArchive');
      const archive = await buildAllProjectsArchiveZip(savedProjects, {
        retentionEnabled,
        retentionMaxBackups: maxBackups,
        autoBackupEnabled,
      });
      const result = await writeVerifiedExternalFolderBackup(archive.filename, archive.bytes);
      if (!isCurrentTarget(project.id)) return;
      setExternalStatus(
        result.ok
          ? `Verified external folder backup saved to "${result.folderName}/${result.filename}" (readback SHA-256: ${result.sha256?.slice(0, 12)}…).`
          : (result.error ?? 'External folder backup failed.')
      );
    } catch (cause) {
      if (isCurrentTarget(project.id)) {
        setExternalStatus(cause instanceof Error ? cause.message : 'External folder backup failed.');
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <section aria-labelledby="backup-destinations-heading" className="space-y-3 rounded-lg border border-gray-300 p-4 dark:border-gray-700">
      <h2 id="backup-destinations-heading" className="font-semibold">Backup &amp; Restore Destinations</h2>
      <div className="grid gap-2 text-xs sm:grid-cols-3">
        <div className="rounded border border-gray-200 p-2.5 dark:border-gray-800">
          <div className="font-semibold">1. Internal Browser Backup</div>
          <p className="mt-0.5 text-gray-600 dark:text-gray-400">{backups.length} verified backup(s) in this browser. Clearing site data removes them.</p>
        </div>
        <div className="rounded border border-gray-200 p-2.5 dark:border-gray-800">
          <div className="font-semibold">2. Portable Download</div>
          <p className="mt-0.5 text-gray-600 dark:text-gray-400">Available in all browsers via JSON or All-Projects ZIP above.</p>
        </div>
        <div className="rounded border border-gray-200 p-2.5 dark:border-gray-800">
          <div className="font-semibold">3. External Folder Backup</div>
          <p className="mt-0.5 text-gray-600 dark:text-gray-400">{externalFolderSupport.reason}</p>
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
        <label className="flex items-center gap-2 pt-1 text-xs">
          <input type="checkbox" checked={autoBackupEnabled} onChange={(e) => onToggleAutoBackup(e.target.checked)} />
          <span>Opt-in: create a verified browser backup automatically while the app is open after major revisions (never deletes existing backups).</span>
        </label>
      )}

      <div className="flex flex-wrap items-center gap-2 border-t border-gray-200 pt-2 dark:border-gray-800">
        <label className="text-sm">
          Backup label{' '}
          <input className="max-w-full rounded border bg-transparent px-2 py-1" value={label} onChange={(event) => setLabel(event.target.value)} />
        </label>
        <button
          type="button"
          className={workspaceButton}
          disabled={busy || project.persistedRevision !== project.revision}
          onClick={() =>
            void perform(async () => {
              await saveBackup(project, label.trim() || 'Manual backup');
              if (isCurrentTarget(project.id)) setLabel('');
              return 'Verified project backup created.';
            })
          }
        >
          Create Backup
        </button>
      </div>
      {project.persistedRevision !== project.revision && <p className="text-sm">Save the current project revision to enable a browser backup.</p>}
      {message && <p role="status" className="break-words text-sm">{message}</p>}

      <RetentionPlannerBox
        backups={backups}
        busy={busy}
        retentionEnabled={retentionEnabled}
        setRetentionEnabled={setRetentionEnabled}
        maxBackups={maxBackups}
        setMaxBackups={setMaxBackups}
        perform={perform}
      />

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
                    const verified = await verifyBackup(backup);
                    if (isCurrentTarget(project.id)) setPreview({ backup, project: verified });
                    return 'Backup verified. Review its contents before restoring.';
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
                    await setBackupPinLocked(backup, !backup.pinned);
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
        <BackupPreviewCard
          project={project}
          preview={preview}
          busy={busy}
          isCurrentTarget={isCurrentTarget}
          perform={perform}
          restore={restore}
          onClose={() => setPreview(null)}
        />
      )}
    </section>
  );
};
