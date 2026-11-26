/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState } from 'react';
import type { CreativeProject } from '../../shared/types';

interface SavedProjectsSectionProps {
  currentProjectId: string;
  savedProjects: CreativeProject[];
  onSwitchProject: (projectId: string) => void;
  onCreateNewProject: (name: string, initialPrompt: string) => void;
  onDeleteProject: (projectId: string) => void;
}

const SavedProjectsSection: React.FC<SavedProjectsSectionProps> = ({
  currentProjectId,
  savedProjects,
  onSwitchProject,
  onCreateNewProject,
  onDeleteProject,
}) => {
  const [newProjName, setNewProjName] = useState('');
  const [newProjIdea, setNewProjIdea] = useState('');

  return (
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
          const isCurrent = proj.id === currentProjectId;
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
  );
};

export default SavedProjectsSection;
