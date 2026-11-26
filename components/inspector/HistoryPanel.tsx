/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useEffect } from 'react';
import type { CreativeProject } from '../../shared/types';
import ContentExportSection from './ContentExportSection';
import ProjectBackupRestoreSection from './ProjectBackupRestoreSection';
import RevisionComparisonSection from './RevisionComparisonSection';
import SavedProjectsSection from './SavedProjectsSection';

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
  useEffect(() => {
    if (!historyTarget) return;
    const target = document.getElementById(historyTarget.id);
    target?.scrollIntoView({ block: 'start' });
    target?.focus({ preventScroll: true });
  }, [historyTarget]);

  return (
    <div className="flex-1 min-h-0 overflow-y-auto bg-[#fbfaf7] p-4 text-[#25262a] dark:bg-gray-950 dark:text-gray-100 sm:p-6">
      <RevisionComparisonSection
        project={project}
        onRestoreRevision={onRestoreRevision}
      />

      <div className="mx-auto mt-8 max-w-7xl space-y-5">
        {/* Export & Import Section */}
        <div id="export-content" tabIndex={-1} className="space-y-2.5">
          <ContentExportSection
            contentExports={contentExports}
            onExportJson={onExportJson}
            onExportStoryBibleMarkdown={onExportStoryBibleMarkdown}
            onExportPromptText={onExportPromptText}
            onExportManuscript={onExportManuscript}
            onExportManuscriptDocx={onExportManuscriptDocx}
            onExportManuscriptText={onExportManuscriptText}
            onExportContent={onExportContent}
            onExportContentBundle={onExportContentBundle}
          />
          <ProjectBackupRestoreSection
            onPreviewProjectJson={onPreviewProjectJson}
            onImportProjectJson={onImportProjectJson}
          />
        </div>

        {/* Saved Local Projects Switcher */}
        <SavedProjectsSection
          currentProjectId={project.id}
          savedProjects={savedProjects}
          onSwitchProject={onSwitchProject}
          onCreateNewProject={onCreateNewProject}
          onDeleteProject={onDeleteProject}
        />
      </div>
    </div>
  );
};

export default HistoryPanel;
