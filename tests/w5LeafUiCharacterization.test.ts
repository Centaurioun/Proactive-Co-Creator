import assert from 'node:assert/strict';
import test from 'node:test';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import GraphCanvas, {
  buildGraphTopologySignature,
  isRelationshipSelected,
  removeTrackedPointer,
} from '../components/graph/GraphCanvas';
import BeliefGraph, { resolveEgoFocusId } from '../components/BeliefGraph';
import OutputDisplay, {
  resolveActiveArtifactSelection,
  shouldCloseLightbox,
  shouldResetArtifactSelection,
} from '../components/OutputGallery';
import EntityRelationshipInspectorPanel, {
  canAddCustomAttribute,
} from '../components/inspector/EntityRelationshipInspectorPanel';
import HistoryPanel from '../components/inspector/HistoryPanel';
import StoryBiblePanel from '../components/inspector/StoryBiblePanel';
import OpportunityCenter from '../components/opportunities/OpportunityCenter';
import { buildFxSimple } from '../scripts/stage0-fixtures';
import type { Entity, GenerationArtifact, Relationship } from '../shared/types';

test('W5-02: GraphCanvas renders ID-keyed isolated entity after rename and tracks name in topology signature', () => {
  const entityV1: Entity = {
    id: 'ent_isolated_1',
    name: 'Alice',
    category: 'character',
    presence_in_prompt: true,
    description: 'Traveler',
    alternatives: null,
    attributes: [],
  };
  const entityRenamed: Entity = {
    ...entityV1,
    name: 'Alicia of the Northern Watch',
  };

  assert.notEqual(
    buildGraphTopologySignature([entityV1], []),
    buildGraphTopologySignature([entityRenamed], [])
  );

  const html = renderToStaticMarkup(
    React.createElement(GraphCanvas, {
      data: { entities: [entityRenamed], relationships: [] },
      isLoading: false,
      visibleEntities: [entityRenamed],
      relationships: [],
      selectedEntity: null,
      selectedRelationship: null,
      highlightConnections: true,
      userTransform: null,
      focusRequest: null,
      onChangeUserTransform: () => {},
      onSelectEntity: () => {},
      onExpandGuestGroup: () => {},
      onRelationshipChange: () => {},
    })
  );
  assert.match(html, /Alicia of the Northern Watch/);
  assert.match(html, /transform="translate\(/);
});

test('W5-10: GraphCanvas does not mark id-less relationships as selected when selectedRelationship is null and cleans up pointers', () => {
  const entities: Entity[] = [
    { id: 'ent_a', name: 'Alice', presence_in_prompt: true, description: '', alternatives: null, attributes: [] },
    { id: 'ent_b', name: 'Bob', presence_in_prompt: true, description: '', alternatives: null, attributes: [] },
  ];
  const idlessRel: Relationship = { source: 'Alice', target: 'Bob', label: 'knows' };

  assert.equal(isRelationshipSelected(null, idlessRel), false);
  assert.equal(isRelationshipSelected(idlessRel, idlessRel), true);
  assert.equal(
    isRelationshipSelected({ ...idlessRel, id: 'rel_1' }, { ...idlessRel, id: 'rel_2' }),
    false
  );

  const html = renderToStaticMarkup(
    React.createElement(GraphCanvas, {
      data: { entities, relationships: [idlessRel] },
      isLoading: false,
      visibleEntities: entities,
      relationships: [idlessRel],
      selectedEntity: null,
      selectedRelationship: null,
      highlightConnections: true,
      userTransform: null,
      focusRequest: null,
      onChangeUserTransform: () => {},
      onSelectEntity: () => {},
      onExpandGuestGroup: () => {},
      onRelationshipChange: () => {},
    })
  );
  assert.doesNotMatch(html, /stroke-amber-500/);

  const pointers = new Map<number, { x: number; y: number }>([
    [1, { x: 10, y: 20 }],
    [2, { x: 30, y: 40 }],
  ]);
  const afterOneRemoved = removeTrackedPointer(pointers, 2);
  assert.equal(afterOneRemoved.remainingCount, 1);
  assert.equal(afterOneRemoved.shouldResetPinch, true);
  assert.deepEqual(afterOneRemoved.nextDragStart, { x: 10, y: 20 });
  const afterAllRemoved = removeTrackedPointer(pointers, 1);
  assert.equal(afterAllRemoved.remainingCount, 0);
  assert.equal(afterAllRemoved.nextDragStart, null);
});

test('W5-11: BeliefGraph resolves stale egoFocusId from another project to a valid entity in current project', () => {
  const entities: Entity[] = [
    { id: 'ent_b1', name: 'Hero', presence_in_prompt: true, description: '', alternatives: null, attributes: [] },
    { id: 'ent_b2', name: 'Lantern', presence_in_prompt: true, description: '', alternatives: null, attributes: [] },
  ];
  assert.equal(resolveEgoFocusId('ent_project_a_stale', entities, null), 'ent_b1');
  assert.equal(resolveEgoFocusId('ent_b2', entities, null), 'ent_b2');
  assert.equal(resolveEgoFocusId('ent_project_a_stale', entities, entities[1]), 'ent_b2');

  const project = buildFxSimple();
  const graphHtml = renderToStaticMarkup(
    React.createElement(BeliefGraph, {
      data: { entities: project.snapshot.entities, relationships: project.snapshot.relationships },
      isLoading: false,
      selectedEntity: null,
      onSelectEntity: () => {},
      onRelationshipChange: () => {},
      currentPrompt: project.snapshot.refinedPrompt,
      relationshipProjection: { nodes: [], edges: [], omissions: [] },
    })
  );
  assert.match(graphHtml, /Interactive belief graph/);
});

test('W5-06: EntityRelationshipInspectorPanel requires both attribute name and value to enable Add', () => {
  assert.equal(canAddCustomAttribute('', ''), false);
  assert.equal(canAddCustomAttribute('outfit', ''), false);
  assert.equal(canAddCustomAttribute('', 'velvet vest'), false);
  assert.equal(canAddCustomAttribute('outfit', 'velvet vest'), true);

  const project = buildFxSimple();
  const entity = project.snapshot.entities.find((e) => e.name === 'Cat') ?? project.snapshot.entities[0];
  const html = renderToStaticMarkup(
    React.createElement(EntityRelationshipInspectorPanel, {
      objectEntities: project.snapshot.entities,
      relationships: project.snapshot.relationships,
      selectedEntity: entity,
      selectedRelationship: null,
      isLoading: false,
      onSelectEntity: () => {},
      onSelectRelationship: () => {},
      onAttributeChange: () => {},
      onRenameEntity: () => {},
      onAddEntity: () => {},
      onUpsertRelationship: () => {},
      onUpdateRelationshipById: () => {},
      onRemoveRelationship: () => {},
    })
  );
  assert.match(html, /Attributes &amp; Existence/);
  assert.match(html, /Add/);
});

test('W5-09: OutputGallery tab badge matches displayedOutdated, resets stale selection, and closes invalid lightbox', () => {
  const outdatedArtifact: GenerationArtifact = {
    id: 'art_story_old',
    mode: 'story',
    createdAt: 1000,
    revisionId: 'rev_1',
    promptUsed: 'prompt',
    storyText: 'Old artifact story',
    isOutdated: true,
  };
  const currentArtifact: GenerationArtifact = {
    id: 'art_story_new',
    mode: 'story',
    createdAt: 2000,
    revisionId: 'rev_2',
    promptUsed: 'prompt',
    storyText: 'New artifact story',
    isOutdated: false,
  };

  // Artifact is outdated while project-level prop isOutdated is false
  const htmlArtifactOutdated = renderToStaticMarkup(
    React.createElement(OutputDisplay, {
      originalIdea: 'idea',
      refinedPrompt: 'prompt',
      freeformNotes: '',
      onChangeFreeformNotes: () => {},
      artifacts: [outdatedArtifact],
      images: [],
      story: null,
      storyProviderSelection: { connectionId: 'gemini-api' },
      chatGptStoryLocalActivation: false,
      storyProviderUsage: null,
      mode: 'story',
      isLoading: false,
      error: null,
      isOutdated: false,
      onGenerate: () => {},
    })
  );
  assert.match(htmlArtifactOutdated, /Generated Story · Outdated/);

  // Artifact is current while top-level prop isOutdated is true -> tab must NOT show Outdated
  const htmlArtifactCurrent = renderToStaticMarkup(
    React.createElement(OutputDisplay, {
      originalIdea: 'idea',
      refinedPrompt: 'prompt',
      freeformNotes: '',
      onChangeFreeformNotes: () => {},
      artifacts: [currentArtifact],
      images: [],
      story: 'Some text',
      storyProviderSelection: { connectionId: 'gemini-api' },
      chatGptStoryLocalActivation: false,
      storyProviderUsage: null,
      mode: 'story',
      isLoading: false,
      error: null,
      isOutdated: true,
      onGenerate: () => {},
    })
  );
  assert.doesNotMatch(htmlArtifactCurrent, /Generated Story · Outdated/);

  const selection = resolveActiveArtifactSelection([currentArtifact, outdatedArtifact], 'story', 'missing_id');
  assert.equal(selection.activeArtifact?.id, 'art_story_new');
  assert.equal(shouldResetArtifactSelection(['art_story_old'], ['art_story_new', 'art_story_old'], 'art_story_old'), true);
  assert.equal(shouldResetArtifactSelection(['art_story_new'], ['other_proj_art'], 'art_story_new'), true);
  assert.equal(shouldCloseLightbox('story', ['img1'], 'img1'), true);
  assert.equal(shouldCloseLightbox('image', ['img2'], 'img1'), true);
  assert.equal(shouldCloseLightbox('image', ['img1'], 'img1'), false);
});

test('W5-14 & W5-03/04 preservation: HistoryPanel buttons declare explicit types; StoryBible & OpportunityCenter render cleanly', () => {
  const project = buildFxSimple();
  const historyHtml = renderToStaticMarkup(
    React.createElement(HistoryPanel, {
      project,
      savedProjects: [project],
      contentExports: [{ id: 'exp_1', label: 'Story Text' }],
      onExportJson: () => {},
      onExportStoryBibleMarkdown: () => {},
      onExportPromptText: () => {},
      onExportContent: () => {},
      onExportContentBundle: () => {},
      onPreviewProjectJson: async () => project,
      onImportProjectJson: async () => ({ ok: true }),
      onSwitchProject: () => {},
      onCreateNewProject: () => {},
      onDeleteProject: () => {},
      onRestoreRevision: () => {},
    })
  );
  const buttons = historyHtml.match(/<button\b[^>]*>/g) ?? [];
  assert.ok(buttons.length > 0);
  for (const tag of buttons) {
    assert.match(tag, /\btype="(button|submit|reset)"/, `Missing button type in HistoryPanel: ${tag}`);
  }

  const bibleHtml = renderToStaticMarkup(
    React.createElement(StoryBiblePanel, {
      storyBible: project.snapshot.storyBible,
      viewMode: 'grid',
      domainFilter: 'all',
      statusFilter: 'all',
      onChangeViewMode: () => {},
      onChangeDomainFilter: () => {},
      onChangeStatusFilter: () => {},
      onUpdateStoryBible: () => {},
    })
  );
  assert.match(bibleHtml, /Synchronized Story Bible/);

  const oppHtml = renderToStaticMarkup(
    React.createElement(OpportunityCenter, {
      project,
      projectId: project.id,
      projectRevision: project.revision,
      proposals: [],
      onCreate: () => {},
      onTransition: () => {},
    })
  );
  assert.match(oppHtml, /Creative Opportunities/);
});
