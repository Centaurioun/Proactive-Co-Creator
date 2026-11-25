/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useEffect, useMemo, useState } from 'react';
import { isSceneEntityName } from '../lib/beliefGraphUtils';
import { splitReadinessAndIssues } from '../lib/narrative/diagnostics/engine';
import OpportunityCenter from './opportunities/OpportunityCenter';
import type { OpportunityProposalInput, OpportunityProposalStatus } from '../lib/narrative/opportunityProposals';
import type { OpportunityProposal } from '../shared/narrativeTypes';
import { computePromptDigest } from '../lib/promptBuilder';
import type {
  ConsistencyIssue,
  ConsistencyIssueTarget,
  CreativeProject,
  Entity,
  EntityCategory,
  Relationship,
  StoryBibleFields,
} from '../shared/types';
import EntityRelationshipInspectorPanel from './inspector/EntityRelationshipInspectorPanel';
import StoryBiblePanel, { type StoryBibleStatusFilter } from './inspector/StoryBiblePanel';
import type { StoryBibleDomain } from './inspector/storyBibleConfig';
import ChecksPanel, { type ConsistencyFixPreview } from './inspector/ChecksPanel';
import MindMapPanel, { type MindMapStatusFilter } from './inspector/MindMapPanel';
import TimelinePanel, { type TimelineViewMode } from './inspector/TimelinePanel';
import HistoryPanel from './inspector/HistoryPanel';

export type RightPanelTab =
  | 'inspector'
  | 'story-bible'
  | 'consistency'
  | 'history'
  | 'timeline'
  | 'opportunities'
  | 'mind-map';

interface ContextualInspectorProps {
  activeTab: RightPanelTab;
  onSelectTab: (tab: RightPanelTab) => void;
  project: CreativeProject;
  savedProjects: CreativeProject[];
  selectedEntity: Entity | null;
  selectedRelationship: Relationship | null;
  onSelectEntity: (entity: Entity | null) => void;
  onSelectRelationship: (relationship: Relationship | null) => void;
  onAttributeChange: (entityName: string, attributeName: string, newValue: string) => void;
  onRenameEntity: (entityIdOrName: string, newName: string) => void;
  onAddEntity: (name: string, category: EntityCategory, description: string) => void;
  onUpsertRelationship: (source: string, target: string, label: string) => void;
  onUpdateRelationshipById: (
    relationshipId: string,
    updates: {
      label?: string;
      status?: 'confirmed' | 'rejected' | 'pending';
      reverseDirection?: boolean;
    }
  ) => void;
  onRemoveRelationship: (relIdOrSource: string, target?: string) => void;
  onUpdateStoryBible: (field: keyof StoryBibleFields, value: string) => void;
  storyBibleErrors?: Partial<Record<keyof StoryBibleFields, string>>;
  focusedStoryBibleField?: { field: keyof StoryBibleFields; seq: number } | null;
  consistencyIssues: ConsistencyIssue[];
  onNavigateConsistencyTarget?: (target: ConsistencyIssueTarget) => void;
  onRestoreRevision: (revisionId: string) => void;
  onSwitchProject: (projectId: string) => void;
  onCreateNewProject: (name: string, initialPrompt: string) => void;
  onDeleteProject: (projectId: string) => void;
  onExportJson: () => void;
  onExportStoryBibleMarkdown: () => void;
  onExportPromptText: () => void;
  onExportManuscript?: () => void;
  onExportManuscriptDocx?: () => void;
  onExportManuscriptText?: () => void;
  onOpenReviewDiagnostics?: () => void;
  onJumpToSection?: (sectionId: string) => void;
  aiConfigured?: boolean;
  onSendOpportunityToReview?: (proposal: OpportunityProposal) => void;
  historyTarget?: { id: string; sequence: number } | null;
  contentExports: { id: string; label: string }[];
  onExportContent: (id: string) => void;
  onExportContentBundle: (ids: string[]) => void;
  onCreateOpportunity: (input: OpportunityProposalInput, expectedRevision: number) => void;
  onTransitionOpportunity: (id: string, status: OpportunityProposalStatus, expectedRevision: number) => void;
  onPreviewProjectJson: (rawJson: string) => Promise<CreativeProject>;
  onImportProjectJson: (rawJson: string) => Promise<{ ok: boolean; error?: string }>;
  isLoading: boolean;
}

const ContextualInspector: React.FC<ContextualInspectorProps> = ({
  activeTab,
  onSelectTab,
  project,
  savedProjects,
  selectedEntity,
  selectedRelationship,
  onSelectEntity,
  onSelectRelationship,
  onAttributeChange,
  onRenameEntity,
  onAddEntity,
  onUpsertRelationship,
  onUpdateRelationshipById,
  onRemoveRelationship,
  onUpdateStoryBible,
  storyBibleErrors,
  focusedStoryBibleField,
  consistencyIssues,
  onNavigateConsistencyTarget,
  onRestoreRevision,
  onSwitchProject,
  onCreateNewProject,
  onDeleteProject,
  onExportJson,
  onExportStoryBibleMarkdown,
  onExportPromptText,
  onImportProjectJson,
  onPreviewProjectJson,
  onExportManuscript,
  onExportManuscriptDocx,
  onExportManuscriptText,
  onOpenReviewDiagnostics,
  onJumpToSection,
  aiConfigured = false,
  onSendOpportunityToReview,
  historyTarget,
  contentExports,
  onExportContent,
  onExportContentBundle,
  onCreateOpportunity,
  onTransitionOpportunity,
  isLoading,
}) => {
  const { snapshot } = project;
  const snapshotJson = useMemo(() => JSON.stringify(snapshot), [snapshot]);

  // View/filter/preview states preserved across tab switches
  const [consistencyFixPreview, setConsistencyFixPreview] =
    useState<ConsistencyFixPreview | null>(null);
  const [bibleViewMode, setBibleViewMode] = useState<'grid' | 'list'>('grid');
  const [bibleDomainFilter, setBibleDomainFilter] = useState<'all' | StoryBibleDomain>('all');
  const [bibleStatusFilter, setBibleStatusFilter] = useState<StoryBibleStatusFilter>('all');
  const [lastHandledFocusSeq, setLastHandledFocusSeq] = useState<number>(0);
  const [timelineView, setTimelineView] = useState<TimelineViewMode>('narrative');
  const [mindMapFilter, setMindMapFilter] = useState<MindMapStatusFilter>('all');

  if (
    focusedStoryBibleField &&
    activeTab === 'story-bible' &&
    focusedStoryBibleField.seq !== lastHandledFocusSeq
  ) {
    setLastHandledFocusSeq(focusedStoryBibleField.seq);
    if (bibleDomainFilter !== 'all') setBibleDomainFilter('all');
    if (bibleStatusFilter !== 'all') setBibleStatusFilter('all');
  }

  useEffect(() => {
    if (!focusedStoryBibleField || activeTab !== 'story-bible') return;
    const rafId = requestAnimationFrame(() => {
      const el = document.getElementById(`bible-${focusedStoryBibleField.field}`);
      if (el instanceof HTMLElement) {
        el.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
        el.focus();
      }
    });
    return () => cancelAnimationFrame(rafId);
  }, [focusedStoryBibleField, activeTab]);

  const previewIsStale =
    consistencyFixPreview !== null &&
    (consistencyFixPreview.projectId !== project.id ||
      consistencyFixPreview.baseRevision !== (project.revision ?? 1) ||
      consistencyFixPreview.baseSnapshotDigest !== computePromptDigest(snapshotJson, snapshot.mode) ||
      consistencyFixPreview.baseSnapshotJson !== snapshotJson ||
      !consistencyIssues.some((issue) => issue.id === consistencyFixPreview.issueId) ||
      !snapshot.entities.some((entity) => entity.id === consistencyFixPreview.entityId));

  const { readiness: readinessItems, consistencyIssues: actualConsistencyIssues } = useMemo(
    () => splitReadinessAndIssues(consistencyIssues),
    [consistencyIssues]
  );

  const objectEntities = useMemo(
    () => snapshot.entities.filter((e) => !isSceneEntityName(e.name) && e.category !== 'scene'),
    [snapshot.entities]
  );

  const tabs: ReadonlyArray<readonly [RightPanelTab, string]> = [
    ['inspector', 'Inspector'],
    ['story-bible', 'Story Bible'],
    ['consistency', `Checks (${actualConsistencyIssues.length})`],
    ['history', 'History'],
    ['timeline', 'Timeline'],
    ['opportunities', 'Ideas'],
    ['mind-map', 'Mind map'],
  ];

  return (
    <aside
      aria-label="Contextual Inspector and Story Bible"
      className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-lg flex flex-col h-full min-h-0 overflow-hidden"
    >
      {/* Top Segmented Mode Selector — non-overlapping horizontally scrollable tablist */}
      <div
        role="tablist"
        aria-label="Inspector views"
        onKeyDown={(e) => {
          const currentIdx = tabs.findIndex(([k]) => k === activeTab);
          if (currentIdx < 0) return;
          if (e.key === 'ArrowRight') {
            e.preventDefault();
            onSelectTab(tabs[(currentIdx + 1) % tabs.length][0]);
          } else if (e.key === 'ArrowLeft') {
            e.preventDefault();
            onSelectTab(tabs[(currentIdx - 1 + tabs.length) % tabs.length][0]);
          }
        }}
        className="flex flex-wrap items-center gap-1 p-1.5 bg-gray-100 dark:bg-gray-950 border-b border-gray-200 dark:border-gray-800 flex-shrink-0"
      >
        {tabs.map(([key, label]) => (
          <button
            key={key}
            type="button"
            role="tab"
            aria-selected={activeTab === key}
            onClick={() => onSelectTab(key)}
            className={`shrink-0 px-2.5 py-1.5 text-[11px] font-semibold rounded transition-colors whitespace-nowrap text-center focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 ${
              activeTab === key
                ? 'bg-white dark:bg-gray-800 text-blue-600 dark:text-blue-400 shadow-xs'
                : 'text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white'
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {activeTab === 'inspector' && (
        <EntityRelationshipInspectorPanel
          objectEntities={objectEntities}
          relationships={snapshot.relationships}
          selectedEntity={selectedEntity}
          selectedRelationship={selectedRelationship}
          isLoading={isLoading}
          onSelectEntity={onSelectEntity}
          onSelectRelationship={onSelectRelationship}
          onAttributeChange={onAttributeChange}
          onRenameEntity={onRenameEntity}
          onAddEntity={onAddEntity}
          onUpsertRelationship={onUpsertRelationship}
          onUpdateRelationshipById={onUpdateRelationshipById}
          onRemoveRelationship={onRemoveRelationship}
        />
      )}

      {activeTab === 'story-bible' && (
        <StoryBiblePanel
          storyBible={snapshot.storyBible}
          storyBibleErrors={storyBibleErrors}
          viewMode={bibleViewMode}
          domainFilter={bibleDomainFilter}
          statusFilter={bibleStatusFilter}
          onChangeViewMode={setBibleViewMode}
          onChangeDomainFilter={setBibleDomainFilter}
          onChangeStatusFilter={setBibleStatusFilter}
          onUpdateStoryBible={onUpdateStoryBible}
        />
      )}

      {activeTab === 'consistency' && (
        <ChecksPanel
          project={project}
          snapshotJson={snapshotJson}
          readinessItems={readinessItems}
          actualConsistencyIssues={actualConsistencyIssues}
          consistencyFixPreview={consistencyFixPreview}
          previewIsStale={previewIsStale}
          onSetConsistencyFixPreview={setConsistencyFixPreview}
          onNavigateConsistencyTarget={onNavigateConsistencyTarget}
          onOpenReviewDiagnostics={onOpenReviewDiagnostics}
        />
      )}

      {activeTab === 'opportunities' && (
        <OpportunityCenter
          project={project}
          projectId={project.id}
          projectRevision={project.revision}
          proposals={project.narrative?.opportunities ?? []}
          aiConfigured={aiConfigured}
          onCreate={onCreateOpportunity}
          onTransition={onTransitionOpportunity}
          onSendToChangeReview={onSendOpportunityToReview}
        />
      )}

      {activeTab === 'mind-map' && (
        <MindMapPanel
          storyBible={snapshot.storyBible}
          entities={snapshot.entities}
          actualConsistencyIssues={actualConsistencyIssues}
          filter={mindMapFilter}
          onChangeFilter={setMindMapFilter}
          onSelectEntityForInspector={(entity) => {
            onSelectEntity(entity);
            onSelectTab('inspector');
          }}
          onNavigateConsistencyTarget={onNavigateConsistencyTarget}
        />
      )}

      {activeTab === 'timeline' && (
        <TimelinePanel
          project={project}
          timelineView={timelineView}
          onChangeTimelineView={setTimelineView}
          onJumpToSection={onJumpToSection}
        />
      )}

      {activeTab === 'history' && (
        <HistoryPanel
          project={project}
          savedProjects={savedProjects}
          historyTarget={historyTarget}
          contentExports={contentExports}
          onExportJson={onExportJson}
          onExportStoryBibleMarkdown={onExportStoryBibleMarkdown}
          onExportPromptText={onExportPromptText}
          onExportManuscript={onExportManuscript}
          onExportManuscriptDocx={onExportManuscriptDocx}
          onExportManuscriptText={onExportManuscriptText}
          onExportContent={onExportContent}
          onExportContentBundle={onExportContentBundle}
          onPreviewProjectJson={onPreviewProjectJson}
          onImportProjectJson={onImportProjectJson}
          onSwitchProject={onSwitchProject}
          onCreateNewProject={onCreateNewProject}
          onDeleteProject={onDeleteProject}
          onRestoreRevision={onRestoreRevision}
        />
      )}
    </aside>
  );
};

export default ContextualInspector;
