/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import type { CreativeProject } from '../shared/types';

export type WorkspaceSection = 'workspace' | 'story-bible' | 'output' | 'history';

interface HeaderProps {
  isDarkMode: boolean;
  toggleDarkMode: () => void;
  onShowInfo: () => void;
  onLoadSampleProject?: () => void;
  project?: CreativeProject;
  projects?: CreativeProject[];
  onSwitchProject?: (projectId: string) => void;
  onNewProject?: () => void;
  onOpenImport?: () => void;
  importDisabled?: boolean;
  onOpenProjects?: () => void;
}

const Header: React.FC<HeaderProps> = ({
  isDarkMode,
  toggleDarkMode,
  onShowInfo,
  onLoadSampleProject,
  project,
  projects = [],
  onSwitchProject,
  onNewProject,
  onOpenImport,
  importDisabled = false,
  onOpenProjects,
}) => {
  const projectOptions = projects.some((item) => item.id === project?.id)
    ? projects
    : project
      ? [...projects, project]
      : projects;

  return (
    <header className="border-b border-pcc-line bg-pcc-surface px-3 py-2.5 text-pcc-ink dark:border-pcc-dark-line dark:bg-pcc-dark-surface dark:text-pcc-dark-ink transition-colors duration-150 flex-shrink-0 sm:px-5">
      <div className="mx-auto flex w-full max-w-[1600px] flex-wrap items-center justify-between gap-x-4 gap-y-2">
        <div className="flex min-w-0 items-center gap-3">
          <a
            href="#workspace"
            className="font-display text-sm font-bold tracking-tight whitespace-nowrap focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-pcc-focus rounded"
          >
            PCC
          </a>
          {project && (
            <label className="flex min-w-0 items-center gap-2 border-l border-pcc-line pl-3 text-xs dark:border-pcc-dark-line">
              <span className="sr-only">Current project</span>
              <select
                aria-label="Current project"
                value={project.id}
                onChange={(event) => onSwitchProject?.(event.target.value)}
                className="min-h-11 max-w-[min(42vw,16rem)] truncate rounded-md border border-pcc-line bg-transparent px-2 py-1.5 font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-pcc-focus dark:border-pcc-dark-line sm:max-w-64"
              >
                {projectOptions.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
              </select>
              <span className="hidden text-pcc-muted dark:text-pcc-dark-muted sm:inline" aria-live="polite">
                {project.persistedRevision === project.revision ? 'Saved' : 'Unsaved'} · r{project.revision}
              </span>
            </label>
          )}
        </div>

        <div className="flex items-center gap-1.5 shrink-0">
        {onNewProject && <button type="button" onClick={onNewProject} className="hidden min-h-11 rounded-md bg-pcc-action px-3 text-xs font-semibold text-white hover:bg-pcc-action-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-pcc-focus sm:inline-flex">+ New</button>}
        {onOpenImport && <button type="button" disabled={importDisabled} onClick={onOpenImport} className="hidden min-h-11 rounded-md px-2.5 text-xs font-medium hover:bg-pcc-canvas focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-pcc-focus disabled:opacity-45 sm:inline-flex dark:hover:bg-pcc-dark-canvas">Import</button>}
        {onOpenProjects && <button type="button" onClick={onOpenProjects} className="hidden min-h-11 rounded-md px-2.5 text-xs font-medium hover:bg-pcc-canvas focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-pcc-focus sm:inline-flex dark:hover:bg-pcc-dark-canvas">Projects</button>}
        <button type="button" onClick={onShowInfo} className="hidden min-h-11 rounded-md px-2.5 text-xs font-medium hover:bg-pcc-canvas focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-pcc-focus sm:inline-flex dark:hover:bg-pcc-dark-canvas">About</button>
        {onLoadSampleProject && (
          <button
            type="button"
            onClick={onLoadSampleProject}
            className="hidden"
          >
            Reset Sample Plan
          </button>
        )}

        <button
          type="button"
          onClick={toggleDarkMode}
          className="min-h-11 rounded-md border border-pcc-line px-2.5 text-xs font-medium hover:bg-pcc-canvas focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-pcc-focus dark:border-pcc-dark-line dark:hover:bg-pcc-dark-canvas"
          title={isDarkMode ? 'Switch to Light Mode' : 'Switch to Dark Mode'}
          aria-label={isDarkMode ? 'Switch to light mode' : 'Switch to dark mode'}
          aria-pressed={isDarkMode}
        >
          {isDarkMode ? 'Light Theme' : 'Dark Theme'}
        </button>
        </div>
      </div>
    </header>
  );
};

export default Header;
