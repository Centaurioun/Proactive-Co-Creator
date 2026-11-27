/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import type {
  ConsistencyIssue,
  ConsistencyIssueTarget,
  CreativeProject,
  Entity,
  EntityCategory,
  Relationship,
  StoryBibleFields,
} from '../../shared/types';
import type { OpportunityProposal } from '../../shared/narrativeTypes';
import type { OpportunityProposalInput, OpportunityProposalStatus } from '../../lib/narrative/opportunityProposals';
import type { ReadinessItem } from '../../lib/narrative/diagnostics/engine';
import type { RightPanelTab } from '../ContextualInspector';
import OpportunityCenter from '../opportunities/OpportunityCenter';
import EntityRelationshipInspectorPanel from './EntityRelationshipInspectorPanel';
import StoryBiblePanel, { type StoryBibleStatusFilter } from './StoryBiblePanel';
import type { StoryBibleDomain } from './storyBibleConfig';
import ChecksPanel, { type ConsistencyFixPreview } from './ChecksPanel';
import MindMapPanel, { type MindMapStatusFilter } from './MindMapPanel';
import TimelinePanel, { type TimelineViewMode } from './TimelinePanel';
import HistoryPanel from './HistoryPanel';

interface InspectorTabContentProps {
  activeTab: RightPanelTab;
  project: CreativeProject;
  savedProjects: CreativeProject[];
  objectEntities: Entity[];
  readinessItems: ReadinessItem[];
  actualConsistencyIssues: ConsistencyIssue[];
  selectedEntity: Entity | null;
  selectedRelationship: Relationship | null;
  isLoading: boolean;
  storyBibleErrors?: Partial<Record<keyof StoryBibleFields, string>>;
  bibleViewMode: 'grid' | 'list';
  bibleDomainFilter: 'all' | StoryBibleDomain;
  bibleStatusFilter: StoryBibleStatusFilter;
  consistencyFixPreview: ConsistencyFixPreview | null;
  previewIsStale: boolean;
  mindMapFilter: MindMapStatusFilter;
  timelineView: TimelineViewMode;
  opportunitiesAvailability: { eligible: boolean; reason?: string };
  historyTarget?: { id: string; sequence: number } | null;
  contentExports: { id: string; label: string }[];
  onSelectTab: (tab: RightPanelTab) => void;
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
  onChangeBibleViewMode: (mode: 'grid' | 'list') => void;
  onChangeBibleDomainFilter: (domain: 'all' | StoryBibleDomain) => void;
  onChangeBibleStatusFilter: (status: StoryBibleStatusFilter) => void;
  onUpdateStoryBible: (field: keyof StoryBibleFields, value: string) => void;
  onConfirmPendingStoryBible?: (
    items: Array<{ field: keyof StoryBibleFields; value: string }>
  ) => void;
  onSetConsistencyFixPreview: (preview: ConsistencyFixPreview | null) => void;
  onNavigateConsistencyTarget?: (target: ConsistencyIssueTarget) => void;
  onOpenReviewDiagnostics?: () => void;
  onCreateOpportunity: (input: OpportunityProposalInput, expectedRevision: number) => void;
  onCreateOpportunityBatch?: (inputs: OpportunityProposalInput[], expectedRevision: number) => void;
  onTransitionOpportunity: (id: string, status: OpportunityProposalStatus, expectedRevision: number) => void;
  onSendOpportunityToReview?: (proposal: OpportunityProposal) => void;
  onChangeMindMapFilter: (filter: MindMapStatusFilter) => void;
  onChangeTimelineView: (view: TimelineViewMode) => void;
  onJumpToSection?: (sectionId: string) => void;
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

const InspectorTabContent: React.FC<InspectorTabContentProps> = (props) => {
  const { activeTab, project, objectEntities } = props;
  const { snapshot } = project;

  switch (activeTab) {
    case 'inspector':
      return (
        <EntityRelationshipInspectorPanel
          objectEntities={objectEntities}
          relationships={snapshot.relationships}
          selectedEntity={props.selectedEntity}
          selectedRelationship={props.selectedRelationship}
          isLoading={props.isLoading}
          onSelectEntity={props.onSelectEntity}
          onSelectRelationship={props.onSelectRelationship}
          onAttributeChange={props.onAttributeChange}
          onRenameEntity={props.onRenameEntity}
          onAddEntity={props.onAddEntity}
          onUpsertRelationship={props.onUpsertRelationship}
          onUpdateRelationshipById={props.onUpdateRelationshipById}
          onRemoveRelationship={props.onRemoveRelationship}
        />
      );
    case 'story-bible':
      return (
        <StoryBiblePanel
          storyBible={snapshot.storyBible}
          storyBibleErrors={props.storyBibleErrors}
          viewMode={props.bibleViewMode}
          domainFilter={props.bibleDomainFilter}
          statusFilter={props.bibleStatusFilter}
          onChangeViewMode={props.onChangeBibleViewMode}
          onChangeDomainFilter={props.onChangeBibleDomainFilter}
          onChangeStatusFilter={props.onChangeBibleStatusFilter}
          onUpdateStoryBible={props.onUpdateStoryBible}
          onConfirmPendingStoryBible={props.onConfirmPendingStoryBible}
        />
      );
    case 'consistency':
      return (
        <ChecksPanel
          project={project}
          readinessItems={props.readinessItems}
          actualConsistencyIssues={props.actualConsistencyIssues}
          consistencyFixPreview={props.consistencyFixPreview}
          previewIsStale={props.previewIsStale}
          onSetConsistencyFixPreview={props.onSetConsistencyFixPreview}
          onNavigateConsistencyTarget={props.onNavigateConsistencyTarget}
          onOpenReviewDiagnostics={props.onOpenReviewDiagnostics}
        />
      );
    case 'opportunities':
      return (
        <OpportunityCenter
          project={project}
          projectId={project.id}
          projectRevision={project.revision}
          proposals={project.narrative?.opportunities ?? []}
          opportunitiesAvailability={props.opportunitiesAvailability}
          onCreate={props.onCreateOpportunity}
          onCreateBatch={props.onCreateOpportunityBatch}
          onTransition={props.onTransitionOpportunity}
          onSendToChangeReview={props.onSendOpportunityToReview}
        />
      );
    case 'mind-map':
      return (
        <MindMapPanel
          storyBible={snapshot.storyBible}
          entities={snapshot.entities}
          actualConsistencyIssues={props.actualConsistencyIssues}
          filter={props.mindMapFilter}
          onChangeFilter={props.onChangeMindMapFilter}
          onSelectEntityForInspector={(entity) => {
            props.onSelectEntity(entity);
            props.onSelectTab('inspector');
          }}
          onNavigateConsistencyTarget={props.onNavigateConsistencyTarget}
        />
      );
    case 'timeline':
      return (
        <TimelinePanel
          project={project}
          timelineView={props.timelineView}
          onChangeTimelineView={props.onChangeTimelineView}
          onJumpToSection={props.onJumpToSection}
        />
      );
    case 'history':
      return (
        <HistoryPanel
          project={project}
          savedProjects={props.savedProjects}
          historyTarget={props.historyTarget}
          contentExports={props.contentExports}
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
      );
  }
};

export default InspectorTabContent;
