import { useEffect, useState } from 'react';
import type { CreativeProject } from '../../shared/types';
import { deleteBackup, listBackups, saveBackup, setBackupPin, verifyBackup, type ProjectBackup } from '../../lib/narrative/recovery';
import { workspaceButton } from '../manuscript/ManuscriptEditor';

interface Props {
  project: CreativeProject;
  openProjects: () => void;
  openExport: () => void;
  restore: (payload: string, replace?: boolean) => Promise<{ ok: boolean; error?: string }>;
  downloadBackup: (backup: ProjectBackup) => void;
}

export default function ProjectHub({ project, openProjects, openExport, restore, downloadBackup }: Props) {
  const [backups, setBackups] = useState<ProjectBackup[]>([]);
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const [label, setLabel] = useState('');
  const [preview, setPreview] = useState<{ backup: ProjectBackup; name: string } | null>(null);

  useEffect(() => {
    let cancelled = false;
    void listBackups(project.id).then(records => { if (!cancelled) setBackups(records); },
      () => { if (!cancelled) setMessage('Browser backups could not be read.'); });
    return () => { cancelled = true; };
  }, [project.id]);

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

  return (
    <main className="min-h-0 flex-1 overflow-auto p-4 sm:p-6">
      <div className="mx-auto max-w-4xl space-y-5">
        <h1 className="text-2xl font-bold">Project Management</h1>
        <div className="flex flex-wrap gap-2">
          <button className={workspaceButton} onClick={openProjects}>Start from Idea / Manage projects</button>
          <button className={workspaceButton} onClick={openExport}>Export Content / Restore from JSON</button>
        </div>
        <p className="text-sm text-gray-600 dark:text-gray-300">Import &amp; Analyze Story is planned for Phase 2.</p>
        <section className="space-y-3 rounded-lg border border-gray-300 p-4 dark:border-gray-700">
          <h2 className="font-semibold">Backup &amp; Restore</h2>
          <p className="text-sm">Browser backups belong to this project. Clearing site data removes them. Export a JSON copy to keep it separately.</p>
          <div className="flex flex-wrap items-center gap-2">
            <label className="text-sm">Backup label{' '}
              <input className="max-w-full rounded border bg-transparent px-2 py-1" value={label} onChange={event => setLabel(event.target.value)} />
            </label>
            <button className={workspaceButton} disabled={busy || project.persistedRevision !== project.revision}
              onClick={() => void perform(async () => {
                await saveBackup(project, label.trim() || 'Manual backup');
                setLabel('');
                return 'Verified project backup created.';
              })}>Create Backup</button>
          </div>
          {project.persistedRevision !== project.revision && <p className="text-sm">Save the current project revision to enable a browser backup.</p>}
          {message && <p role="status" className="break-words text-sm">{message}</p>}
          {backups.length === 0 && <p className="text-sm">No verified browser backups for this project.</p>}
          <ul className="space-y-3">
            {backups.map(backup => (
              <li key={backup.id} className="space-y-2 border-t border-gray-300 pt-3 dark:border-gray-700">
                <p className="break-words font-medium">{backup.label}{backup.pinned ? ' · Pinned' : ''}</p>
                <p className="text-sm">{new Date(backup.createdAt).toLocaleString()} · Revision {backup.revision} · Schema {backup.schemaVersion} · {backup.bytes} bytes · Complete project</p>
                <details className="break-all text-xs"><summary>SHA-256</summary>{backup.sha256}</details>
                <div className="flex flex-wrap gap-2">
                  <button className={workspaceButton} disabled={busy} onClick={() => void perform(async () => {
                    setPreview({ backup, name: (await verifyBackup(backup)).name });
                    return '';
                  })}>Preview restore</button>
                  <button className={workspaceButton} disabled={busy} onClick={() => void perform(async () => {
                    await verifyBackup(backup);
                    downloadBackup(backup);
                    return 'Backup download requested.';
                  })}>Export backup</button>
                  <button className={workspaceButton} disabled={busy} onClick={() => void perform(async () => {
                    setBackupPin(backup, !backup.pinned);
                    return backup.pinned ? 'Backup unpinned.' : 'Backup pinned.';
                  })}>{backup.pinned ? 'Unpin' : 'Pin'}</button>
                  <button className={workspaceButton} disabled={busy || backup.pinned || backups.length <= 1}
                    onClick={() => {
                      if (window.confirm(`Delete browser backup “${backup.label}”?`)) {
                        void perform(async () => { await deleteBackup(backup); return 'Browser backup deleted.'; });
                      }
                    }}>Delete backup</button>
                </div>
              </li>
            ))}
          </ul>
          {preview && (
            <div className="space-y-2 rounded border border-amber-400 p-3">
              <p>Restore “{preview.name}”, revision {preview.backup.revision}, as a separate project with its own ID.</p>
              <button className={workspaceButton} disabled={busy} onClick={() => void perform(async () => {
                const result = await restore(JSON.stringify(preview.backup));
                if (!result.ok) throw new Error(result.error);
                return 'Restored project copy saved.';
              })}>Restore project copy</button>{' '}
              <button className={workspaceButton} disabled={busy || preview.backup.schemaVersion < project.schemaVersion}
                onClick={() => {
                  if (!window.confirm('Replace the current project with this backup? A verified safety checkpoint will be saved first.')) return;
                  void perform(async () => {
                    const result = await restore(JSON.stringify(preview.backup), true);
                    if (!result.ok) throw new Error(result.error);
                    setPreview(null);
                    return 'Project replaced after saving a verified safety checkpoint.';
                  });
                }}>Replace current project</button>{' '}
              <button className={workspaceButton} disabled={busy} onClick={() => setPreview(null)}>Cancel</button>
            </div>
          )}
        </section>
      </div>
    </main>
  );
}
