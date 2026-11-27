/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { useCallback, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import type { CreativeProject } from '../../shared/types';
import { listBackups, type ProjectBackup } from '../../lib/narrative/recovery';
import type { ArchiveRestoreSequenceResult } from '../../lib/narrative/recovery/allProjectsArchive';
import { runGuardedBackupOperation } from './hub/backupOperations';
import { ProjectLibrarySection } from './hub/ProjectLibrarySection';
import { ExportAndArchiveSection } from './hub/ExportAndArchiveSection';
import { BrowserBackupsSection } from './hub/BrowserBackupsSection';

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
  const [retentionEnabled, setRetentionEnabled] = useState(false);
  const [maxBackups, setMaxBackups] = useState(5);
  const [activeHubView, setActiveHubView] = useState<'projects' | 'recovery' | 'history'>('projects');

  const mountedRef = useRef(true);
  const activeProjectIdRef = useRef(project.id);
  const busyRef = useRef(busy);

  useLayoutEffect(() => {
    busyRef.current = busy;
  }, [busy]);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  useEffect(() => {
    activeProjectIdRef.current = project.id;
    let cancelled = false;
    void listBackups(project.id).then(
      (records) => {
        if (!cancelled && mountedRef.current) setBackups(records);
      },
      () => {
        if (!cancelled && mountedRef.current) setMessage('Browser backups could not be read.');
      }
    );
    return () => {
      cancelled = true;
    };
  }, [project.id]);

  const isCurrentTarget = useCallback(
    (id: string) => mountedRef.current && activeProjectIdRef.current === id,
    []
  );

  const perform = useCallback(
    (operation: () => Promise<string>) =>
      runGuardedBackupOperation({
        projectId: project.id,
        isBusy: () => busyRef.current,
        setBusy: (next) => {
          busyRef.current = next;
          if (mountedRef.current) setBusy(next);
        },
        setMessage: (next) => {
          if (mountedRef.current) setMessage(next);
        },
        isCurrentTarget,
        listProjectBackups: listBackups,
        setBackups: (records) => {
          if (mountedRef.current) setBackups(records);
        },
        operation,
      }),
    [project.id, isCurrentTarget]
  );

  return (
    <main className="min-h-0 flex-1 overflow-auto bg-[#fbfaf7] p-4 text-[#25262a] dark:bg-gray-950 dark:text-gray-100 sm:p-6 lg:p-8">
      <div className="mx-auto max-w-6xl space-y-6">
        <nav aria-label="Project workspace sections" className="flex flex-wrap gap-2 border-b border-[#dad8d2] pb-3 dark:border-gray-700">
          {([
            ['projects', 'Projects'],
            ['recovery', 'Backup & export'],
            ['history', 'Revision history'],
          ] as const).map(([id, label]) => (
            <button
              key={id}
              type="button"
              aria-current={activeHubView === id ? 'page' : undefined}
              onClick={() => setActiveHubView(id)}
              className={`min-h-10 rounded-lg px-3 py-2 text-sm font-semibold focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#62445e] ${
                activeHubView === id
                  ? 'bg-[#e9dfe8] text-[#62445e] dark:bg-purple-950 dark:text-purple-100'
                  : 'text-gray-600 hover:bg-white dark:text-gray-300 dark:hover:bg-gray-900'
              }`}
            >
              {label}
            </button>
          ))}
        </nav>

        {activeHubView === 'projects' && (
          <ProjectLibrarySection
            project={project}
            savedProjects={savedProjects}
            openProjects={openProjects}
            openImport={openImport}
            onResumeWorkspace={onResumeWorkspace}
            onOpenProject={onOpenProject}
            onCreateNewProject={onCreateNewProject}
          />
        )}

        {activeHubView === 'recovery' && (
          <>
            <ExportAndArchiveSection
              projectId={project.id}
              savedProjects={savedProjects}
              busy={busy}
              setBusy={(next) => {
                if (mountedRef.current) setBusy(next);
              }}
              setMessage={(next) => {
                if (mountedRef.current) setMessage(next);
              }}
              isCurrentTarget={isCurrentTarget}
              retentionEnabled={retentionEnabled}
              maxBackups={maxBackups}
              autoBackupEnabled={autoBackupEnabled}
              openExport={openExport}
              restoreArchiveProjects={restoreArchiveProjects}
              onExportManuscriptDocx={onExportManuscriptDocx}
              onExportManuscriptText={onExportManuscriptText}
              onExportStoryBible={onExportStoryBible}
              onExportPrompt={onExportPrompt}
              onExportIssuesAudit={onExportIssuesAudit}
              onDownloadAllProjectsArchive={onDownloadAllProjectsArchive}
            />
            <BrowserBackupsSection
              project={project}
              savedProjects={savedProjects}
              backups={backups}
              busy={busy}
              setBusy={(next) => {
                if (mountedRef.current) setBusy(next);
              }}
              message={message}
              retentionEnabled={retentionEnabled}
              setRetentionEnabled={setRetentionEnabled}
              maxBackups={maxBackups}
              setMaxBackups={setMaxBackups}
              autoBackupEnabled={autoBackupEnabled}
              onToggleAutoBackup={onToggleAutoBackup}
              isCurrentTarget={isCurrentTarget}
              perform={perform}
              restore={restore}
              downloadBackup={downloadBackup}
            />
          </>
        )}

        {activeHubView === 'history' && (
          <section aria-label="Revision history" className="min-w-0">
            {historyContent ?? (
              <div className="rounded-xl border border-dashed border-[#b9b4b8] bg-white p-5 text-sm text-gray-600 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-300">
                The full-width revision view is not connected here yet. Open revision history from the plan workspace.
                <button type="button" className="ml-2 font-semibold text-[#62445e] underline dark:text-purple-200" onClick={openProjects}>
                  Open plan workspace
                </button>
              </div>
            )}
          </section>
        )}
      </div>
    </main>
  );
}
