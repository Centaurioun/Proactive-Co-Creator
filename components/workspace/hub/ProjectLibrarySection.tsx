/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useMemo, useState } from 'react';
import type { CreativeProject } from '../../../shared/types';

interface ProjectLibrarySectionProps {
  project: CreativeProject;
  savedProjects: CreativeProject[];
  openProjects: () => void;
  openImport: () => void;
  onResumeWorkspace?: () => void;
  onOpenProject?: (projectId: string) => void;
  onCreateNewProject?: (name: string, initialPrompt: string) => Promise<boolean>;
}

export const ProjectLibrarySection: React.FC<ProjectLibrarySectionProps> = ({
  project,
  savedProjects,
  openProjects,
  openImport,
  onResumeWorkspace,
  onOpenProject,
  onCreateNewProject,
}) => {
  const [projectSearch, setProjectSearch] = useState('');
  const [newProjectName, setNewProjectName] = useState('');
  const [newProjectIdea, setNewProjectIdea] = useState('');
  const [createProjectMessage, setCreateProjectMessage] = useState('');
  const [creatingProject, setCreatingProject] = useState(false);

  const projectLibrary = useMemo(() => {
    const currentFirst = [...savedProjects].sort((a, b) => {
      if (a.id === project.id) return -1;
      if (b.id === project.id) return 1;
      return b.updatedAt - a.updatedAt;
    });
    const query = projectSearch.trim().toLocaleLowerCase();
    return query
      ? currentFirst.filter((item) => item.name.toLocaleLowerCase().includes(query))
      : currentFirst;
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

  return (
    <>
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
                        <p className="truncate text-sm font-semibold">
                          {item.name}
                          {isCurrent && (
                            <span className="ml-2 rounded-full bg-[#e9dfe8] px-2 py-0.5 text-xs font-medium text-[#62445e] dark:bg-purple-900/60 dark:text-purple-100">
                              Open now
                            </span>
                          )}
                        </p>
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
              <p className="rounded-xl border border-dashed border-[#b9b4b8] p-5 text-sm text-gray-600 dark:border-gray-700 dark:text-gray-300">
                {savedProjects.length ? 'No projects match that search.' : 'No saved projects yet. Start a new project or import a story.'}
              </p>
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
              <button type="submit" disabled={creatingProject || !newProjectName.trim() || !newProjectIdea.trim()} className="min-h-11 w-full rounded-lg bg-[#62445e] px-4 py-2 text-sm font-semibold text-white hover:bg-[#50364d] disabled:cursor-not-allowed disabled:opacity-50">
                {creatingProject ? 'Creating project…' : 'Create project'}
              </button>
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
    </>
  );
};
