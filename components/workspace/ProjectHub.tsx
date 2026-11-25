import { useEffect, useMemo, useState, type ReactNode } from 'react';
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
  onResumeWorkspace?: () => void;
  onOpenProject?: (projectId: string) => void;
  onCreateNewProject?: (name: string, initialPrompt: string) => Promise<boolean>;
  historyContent?: ReactNode;
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
  onResumeWorkspace,
  onOpenProject,
  onCreateNewProject,
  historyContent,
}: Props) {
  const [backups, setBackups] = useState<ProjectBackup[]>([]);
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const [label, setLabel] = useState('');
  const [preview, setPreview] = useState<{ backup: ProjectBackup; project: CreativeProject } | null>(null);

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
  const [projectSearch, setProjectSearch] = useState('');
  const [newProjectName, setNewProjectName] = useState('');
  const [newProjectIdea, setNewProjectIdea] = useState('');
  const [createProjectMessage, setCreateProjectMessage] = useState('');
  const [creatingProject, setCreatingProject] = useState(false);
  const [activeHubView, setActiveHubView] = useState<'projects' | 'recovery' | 'history'>('projects');

  const projectLibrary = useMemo(() => {
    const currentFirst = [...savedProjects].sort((a, b) => {
      if (a.id === project.id) return -1;
      if (b.id === project.id) return 1;
      return b.updatedAt - a.updatedAt;
    });
    const query = projectSearch.trim().toLocaleLowerCase();
    return query ? currentFirst.filter((item) => item.name.toLocaleLowerCase().includes(query)) : currentFirst;
  }, [savedProjects, project.id, projectSearch]);

  const createProject = async () => {
    if (!onCreateNewProject || !newProjectName.trim() || !newProjectIdea.trim() || creatingProject) return;
    setCreatingProject(true);
    setCreateProjectMessage('');
    try {
      const saved = await onCreateNewProject(newProjectName.trim(), newProjectIdea.trim());
      if (!saved) {
        setCreateProjectMessage('The project was not created. Resolve the workspace message and try again.');
        return;
      }
      setNewProjectName('');
      setNewProjectIdea('');
      setCreateProjectMessage('Project created and saved.');
    } catch (cause) {
      setCreateProjectMessage(cause instanceof Error ? cause.message : 'The project could not be created.');
    } finally {
      setCreatingProject(false);
    }
  };

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
    <main className="min-h-0 flex-1 overflow-auto bg-[#fbfaf7] p-4 text-[#25262a] dark:bg-gray-950 dark:text-gray-100 sm:p-6 lg:p-8">
      <div className="mx-auto max-w-6xl space-y-6">
        <nav aria-label="Project workspace sections" className="flex flex-wrap gap-2 border-b border-[#dad8d2] pb-3 dark:border-gray-700">
          {([
            ['projects', 'Projects'],
            ['recovery', 'Backup & export'],
            ['history', 'Revision history'],
          ] as const).map(([id, label]) => (
            <button key={id} type="button" aria-current={activeHubView === id ? 'page' : undefined} onClick={() => setActiveHubView(id)} className={`min-h-10 rounded-lg px-3 py-2 text-sm font-semibold focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#62445e] ${activeHubView === id ? 'bg-[#e9dfe8] text-[#62445e] dark:bg-purple-950 dark:text-purple-100' : 'text-gray-600 hover:bg-white dark:text-gray-300 dark:hover:bg-gray-900'}`}>
              {label}
            </button>
          ))}
        </nav>

        {activeHubView === 'projects' && <>
        <header className="space-y-2">
          <h1 className="font-display text-3xl font-semibold">Projects</h1>
          <p className="max-w-2xl text-sm text-gray-600 dark:text-gray-300">
            Your story workspaces are saved in this browser. Open a project to continue, or start with a title and idea.
          </p>
        </header>

        <div className="grid gap-6 lg:grid-cols-[minmax(0,1.7fr)_minmax(280px,0.9fr)]">
          <div className="space-y-7">
            <section aria-labelledby="resume-project-title" className="space-y-3 rounded-xl bg-[#f3edf2] p-6 dark:bg-purple-950/30 sm:p-7">
              <p className="text-xs font-semibold text-[#62445e] dark:text-purple-200">CURRENT WORKSPACE</p>
              <div className="flex flex-wrap items-start justify-between gap-4">
                <div className="space-y-2">
                  <h2 id="resume-project-title" className="font-display text-2xl font-semibold">{project.name}</h2>
                  <p className="text-sm text-gray-700 dark:text-gray-300">
                    Revision {project.revision} · {project.persistedRevision === project.revision ? 'Saved' : 'Saving'} · Updated {new Date(project.updatedAt).toLocaleString()}
                  </p>
                  <p className="text-sm text-gray-700 dark:text-gray-300">
                    {project.snapshot.entities.length} story elements · {project.snapshot.relationships.length} relationships · {project.snapshot.mode === 'image' ? 'Image' : 'Story'} mode
                  </p>
                </div>
                <button
                  type="button"
                  className="min-h-11 rounded-lg bg-[#62445e] px-4 py-2 text-sm font-semibold text-white hover:bg-[#50364d] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#62445e]"
                  onClick={() => (onResumeWorkspace ? onResumeWorkspace() : openProjects())}
                >
                  Continue where you left off
                </button>
              </div>
            </section>

            <section aria-labelledby="project-library-title" className="space-y-3">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <h2 id="project-library-title" className="font-display text-xl font-semibold">Your projects</h2>
                  <p className="text-sm text-gray-600 dark:text-gray-300">{savedProjects.length} saved in this browser</p>
                </div>
                <label className="sr-only" htmlFor="project-search">Search projects</label>
                <input
                  id="project-search"
                  type="search"
                  value={projectSearch}
                  onChange={(event) => setProjectSearch(event.target.value)}
                  placeholder="Search projects"
                  className="min-h-10 w-full max-w-xs rounded-lg border border-[#dad8d2] bg-white px-3 text-sm text-gray-900 placeholder:text-gray-500 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-[#62445e] dark:border-gray-700 dark:bg-gray-900 dark:text-gray-100"
                />
              </div>
              {projectLibrary.length > 0 ? (
                <ul className="divide-y divide-[#dad8d2] overflow-hidden rounded-xl border border-[#dad8d2] bg-white dark:divide-gray-800 dark:border-gray-700 dark:bg-gray-900">
                  {projectLibrary.map((item) => {
                    const isCurrent = item.id === project.id;
                    return (
                      <li key={item.id} className={`flex flex-wrap items-center justify-between gap-3 px-4 py-3 ${isCurrent ? 'bg-[#f7f2f6] dark:bg-purple-950/20' : ''}`}>
                        <div className="min-w-0">
                          <p className="truncate text-sm font-semibold">{item.name}{isCurrent && <span className="ml-2 rounded-full bg-[#e9dfe8] px-2 py-0.5 text-xs font-medium text-[#62445e] dark:bg-purple-900/60 dark:text-purple-100">Open now</span>}</p>
                          <p className="mt-1 text-xs text-gray-600 dark:text-gray-400">
                            Revision {item.revision} · {item.snapshot.mode === 'image' ? 'Image' : 'Story'} mode · Updated {new Date(item.updatedAt).toLocaleDateString()}
                          </p>
                        </div>
                        <button
                          type="button"
                          className="min-h-10 rounded-lg px-3 text-sm font-semibold text-[#62445e] underline-offset-4 hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#62445e] dark:text-purple-200"
                          onClick={() => {
                            if (isCurrent && onResumeWorkspace) onResumeWorkspace();
                            else if (onOpenProject) onOpenProject(item.id);
                            else openProjects();
                          }}
                        >
                          {isCurrent ? 'Continue' : 'Open project'}
                        </button>
                      </li>
                    );
                  })}
                </ul>
              ) : (
                <p className="rounded-xl border border-dashed border-[#b9b4b8] p-5 text-sm text-gray-600 dark:border-gray-700 dark:text-gray-300">{savedProjects.length ? 'No projects match that search.' : 'No saved projects yet. Start a new project or import a story.'}</p>
              )}
            </section>
          </div>

          <aside className="space-y-4 rounded-xl border border-[#dad8d2] bg-white p-5 dark:border-gray-700 dark:bg-gray-900 sm:p-6">
            <div>
              <h2 className="font-display text-xl font-semibold">Start a new project</h2>
              <p className="mt-1 text-sm text-gray-600 dark:text-gray-300">Start with a blank story idea or bring in a manuscript for review.</p>
            </div>
            {onCreateNewProject ? (
              <form className="space-y-3" onSubmit={(event) => { event.preventDefault(); void createProject(); }}>
                <label className="block space-y-1 text-sm font-medium" htmlFor="new-project-title">
                  <span>Project title</span>
                  <input id="new-project-title" value={newProjectName} onChange={(event) => setNewProjectName(event.target.value)} maxLength={100} required className="min-h-10 w-full rounded-lg border border-[#dad8d2] bg-white px-3 text-sm font-normal dark:border-gray-700 dark:bg-gray-950" />
                </label>
                <label className="block space-y-1 text-sm font-medium" htmlFor="new-project-idea">
                  <span>Starting idea</span>
                  <textarea id="new-project-idea" value={newProjectIdea} onChange={(event) => setNewProjectIdea(event.target.value)} maxLength={8000} required rows={3} className="w-full rounded-lg border border-[#dad8d2] bg-white px-3 py-2 text-sm font-normal dark:border-gray-700 dark:bg-gray-950" />
                </label>
                <button type="submit" disabled={creatingProject || !newProjectName.trim() || !newProjectIdea.trim()} className="min-h-11 w-full rounded-lg bg-[#62445e] px-4 py-2 text-sm font-semibold text-white hover:bg-[#50364d] disabled:cursor-not-allowed disabled:opacity-50">{creatingProject ? 'Creating project…' : 'Create project'}</button>
                {createProjectMessage && <p role="status" className="text-sm text-gray-700 dark:text-gray-300">{createProjectMessage}</p>}
              </form>
            ) : (
              <button type="button" className="min-h-11 w-full rounded-lg border border-[#dad8d2] px-4 py-2 text-left text-sm font-semibold hover:bg-[#f7f2f6] dark:border-gray-700 dark:hover:bg-gray-800" onClick={openProjects}>
                New project <span className="mt-1 block text-xs font-normal text-gray-600 dark:text-gray-300">Continue in the plan workspace to create one from your idea.</span>
              </button>
            )}
            <button type="button" className="min-h-11 w-full rounded-lg border border-[#dad8d2] px-4 py-2 text-left text-sm font-semibold hover:bg-[#f7f2f6] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#62445e] dark:border-gray-700 dark:hover:bg-gray-800" onClick={openImport}>
              Import story <span className="mt-1 block text-xs font-normal text-gray-600 dark:text-gray-300">Inspect the source and candidates before creating a project.</span>
            </button>
            <p className="text-xs text-gray-600 dark:text-gray-400">Imported material is reviewed separately; it does not silently replace your current story plan.</p>
          </aside>
        </div>

        </>}

        {activeHubView === 'recovery' && <>
        <section aria-labelledby="recovery-export-title" className="space-y-1 border-t border-[#dad8d2] pt-6 dark:border-gray-700">
          <h2 id="recovery-export-title" className="font-display text-xl font-semibold">Backup, export &amp; recovery</h2>
          <p className="text-sm text-gray-600 dark:text-gray-300">A verified project backup contains restorable project data. Content exports such as DOCX, Markdown and TXT are separate files.</p>
          <button type="button" className="mt-2 min-h-10 rounded-lg px-3 text-sm font-semibold text-[#62445e] underline-offset-4 hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#62445e] dark:text-purple-200" onClick={openExport}>Open export center</button>
        </section>

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
                        setPreview({ backup, project: await verifyBackup(backup) });
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
                    setPreview(null);
                    return 'Project replaced after saving a verified safety checkpoint.';
                  });
                }}
              >
                Review replacement confirmation
              </button>{' '}
              <button type="button" className={workspaceButton} disabled={busy} onClick={() => setPreview(null)}>Cancel</button>
              </div>
            </div>
          )}
        </section>
        </>}

        {activeHubView === 'history' && (
          <section aria-label="Revision history" className="min-w-0">
            {historyContent ?? (
              <div className="rounded-xl border border-dashed border-[#b9b4b8] bg-white p-5 text-sm text-gray-600 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-300">
                The full-width revision view is not connected here yet. Open revision history from the plan workspace.
                <button type="button" className="ml-2 font-semibold text-[#62445e] underline dark:text-purple-200" onClick={openProjects}>Open plan workspace</button>
              </div>
            )}
          </section>
        )}
      </div>
    </main>
  );
}
