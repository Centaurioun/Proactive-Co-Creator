/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useEffect, useMemo, useRef, useState } from 'react';
import { isSceneEntityName } from '../lib/beliefGraphUtils';
import { splitReadinessAndIssues } from '../lib/narrative/diagnostics/engine';
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
import type { StoryBibleStatusFilter } from './inspector/StoryBiblePanel';
import type { StoryBibleDomain } from './inspector/storyBibleConfig';
import type { ConsistencyFixPreview } from './inspector/ChecksPanel';
import type { MindMapStatusFilter } from './inspector/MindMapPanel';
import type { TimelineViewMode } from './inspector/TimelinePanel';
import InspectorTabContent from './inspector/InspectorTabContent';

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
  onConfirmPendingStoryBible?: (
    items: Array<{ field: keyof StoryBibleFields; value: string }>
  ) => void;
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
  opportunitiesAvailability?: { eligible: boolean; reason?: string };
  onSendOpportunityToReview?: (proposal: OpportunityProposal) => void;
  historyTarget?: { id: string; sequence: number } | null;
  contentExports: { id: string; label: string }[];
  onExportContent: (id: string) => void;
  onExportContentBundle: (ids: string[]) => void;
  onCreateOpportunity: (input: OpportunityProposalInput, expectedRevision: number) => void;
  onCreateOpportunityBatch?: (inputs: OpportunityProposalInput[], expectedRevision: number) => void;
  onTransitionOpportunity: (id: string, status: OpportunityProposalStatus, expectedRevision: number) => void;
  onPreviewProjectJson: (rawJson: string) => Promise<CreativeProject>;
  onImportProjectJson: (rawJson: string) => Promise<{ ok: boolean; error?: string }>;
  isLoading: boolean;
}

function isConsistencyFixPreviewStale(
  preview: ConsistencyFixPreview | null,
  project: CreativeProject,
  consistencyIssues: ConsistencyIssue[]
): boolean {
  if (!preview) return false;
  if (preview.projectId !== project.id) return true;
  if (preview.baseRevision !== (project.revision ?? 1)) return true;
  if (!consistencyIssues.some((issue) => issue.id === preview.issueId)) return true;
  if (!project.snapshot.entities.some((entity) => entity.id === preview.entityId)) return true;

  const currentSnapshotJson = JSON.stringify(project.snapshot);
  if (preview.baseSnapshotJson !== currentSnapshotJson) return true;
  return preview.baseSnapshotDigest !== computePromptDigest(currentSnapshotJson, project.snapshot.mode);
}

const ContextualInspector: React.FC<ContextualInspectorProps> = (props) => {
  const {
    activeTab,
    onSelectTab,
    project,
    focusedStoryBibleField,
    consistencyIssues,
  } = props;
  const { snapshot } = project;

  const [consistencyFixPreview, setConsistencyFixPreview] =
    useState<ConsistencyFixPreview | null>(null);
  const [bibleViewMode, setBibleViewMode] = useState<'grid' | 'list'>('grid');
  const [bibleDomainFilter, setBibleDomainFilter] = useState<'all' | StoryBibleDomain>('all');
  const [bibleStatusFilter, setBibleStatusFilter] = useState<StoryBibleStatusFilter>('all');
  const [lastHandledFocusSeq, setLastHandledFocusSeq] = useState<number>(0);
  const [timelineView, setTimelineView] = useState<TimelineViewMode>('narrative');
  const [mindMapFilter, setMindMapFilter] = useState<MindMapStatusFilter>('all');
  const tabButtonRefs = useRef<Partial<Record<RightPanelTab, HTMLButtonElement | null>>>({});

  const shouldResetBibleFilters =
    Boolean(focusedStoryBibleField) &&
    activeTab === 'story-bible' &&
    focusedStoryBibleField!.seq !== lastHandledFocusSeq;
  if (shouldResetBibleFilters && focusedStoryBibleField) {
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

  const previewIsStale = useMemo(
    () => isConsistencyFixPreviewStale(consistencyFixPreview, project, consistencyIssues),
    [consistencyFixPreview, project, consistencyIssues]
  );

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

  const handleTabKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    const currentIdx = tabs.findIndex(([k]) => k === activeTab);
    if (currentIdx < 0) return;
    const delta = e.key === 'ArrowRight' ? 1 : e.key === 'ArrowLeft' ? -1 : 0;
    if (delta === 0) return;
    e.preventDefault();
    const nextKey = tabs[(currentIdx + delta + tabs.length) % tabs.length][0];
    onSelectTab(nextKey);
    tabButtonRefs.current[nextKey]?.focus();
  };

  return (
    <aside
      aria-label="Contextual Inspector and Story Bible"
      className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-lg flex flex-col h-full min-h-0 overflow-hidden"
    >
      {/* Top Segmented Mode Selector — non-overlapping horizontally scrollable tablist */}
      <div
        role="tablist"
        aria-label="Inspector views"
        onKeyDown={handleTabKeyDown}
        className="flex flex-wrap items-center gap-1 p-1.5 bg-gray-100 dark:bg-gray-950 border-b border-gray-200 dark:border-gray-800 flex-shrink-0"
      >
        {tabs.map(([key, label]) => (
          <button
            key={key}
            ref={(el) => {
              tabButtonRefs.current[key] = el;
            }}
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

      <InspectorTabContent
        activeTab={activeTab}
        project={project}
        savedProjects={props.savedProjects}
        objectEntities={objectEntities}
        readinessItems={readinessItems}
        actualConsistencyIssues={actualConsistencyIssues}
        selectedEntity={props.selectedEntity}
        selectedRelationship={props.selectedRelationship}
        isLoading={props.isLoading}
        storyBibleErrors={props.storyBibleErrors}
        bibleViewMode={bibleViewMode}
        bibleDomainFilter={bibleDomainFilter}
        bibleStatusFilter={bibleStatusFilter}
        consistencyFixPreview={consistencyFixPreview}
        previewIsStale={previewIsStale}
        mindMapFilter={mindMapFilter}
        timelineView={timelineView}
        opportunitiesAvailability={props.opportunitiesAvailability ?? { eligible: false, reason: 'AI opportunity exploration is unavailable.' }}
        historyTarget={props.historyTarget}
        contentExports={props.contentExports}
        onSelectTab={onSelectTab}
        onSelectEntity={props.onSelectEntity}
        onSelectRelationship={props.onSelectRelationship}
        onAttributeChange={props.onAttributeChange}
        onRenameEntity={props.onRenameEntity}
        onAddEntity={props.onAddEntity}
        onUpsertRelationship={props.onUpsertRelationship}
        onUpdateRelationshipById={props.onUpdateRelationshipById}
        onRemoveRelationship={props.onRemoveRelationship}
        onChangeBibleViewMode={setBibleViewMode}
        onChangeBibleDomainFilter={setBibleDomainFilter}
        onChangeBibleStatusFilter={setBibleStatusFilter}
        onUpdateStoryBible={props.onUpdateStoryBible}
        onConfirmPendingStoryBible={props.onConfirmPendingStoryBible}
        onSetConsistencyFixPreview={setConsistencyFixPreview}
        onNavigateConsistencyTarget={props.onNavigateConsistencyTarget}
        onOpenReviewDiagnostics={props.onOpenReviewDiagnostics}
        onCreateOpportunity={props.onCreateOpportunity}
        onCreateOpportunityBatch={props.onCreateOpportunityBatch}
        onTransitionOpportunity={props.onTransitionOpportunity}
        onSendOpportunityToReview={props.onSendOpportunityToReview}
        onChangeMindMapFilter={setMindMapFilter}
        onChangeTimelineView={setTimelineView}
        onJumpToSection={props.onJumpToSection}
        onExportJson={props.onExportJson}
        onExportStoryBibleMarkdown={props.onExportStoryBibleMarkdown}
        onExportPromptText={props.onExportPromptText}
        onExportManuscript={props.onExportManuscript}
        onExportManuscriptDocx={props.onExportManuscriptDocx}
        onExportManuscriptText={props.onExportManuscriptText}
        onExportContent={props.onExportContent}
        onExportContentBundle={props.onExportContentBundle}
        onPreviewProjectJson={props.onPreviewProjectJson}
        onImportProjectJson={props.onImportProjectJson}
        onSwitchProject={props.onSwitchProject}
        onCreateNewProject={props.onCreateNewProject}
        onDeleteProject={props.onDeleteProject}
        onRestoreRevision={props.onRestoreRevision}
      />
    </aside>
  );
};

export default ContextualInspector;
