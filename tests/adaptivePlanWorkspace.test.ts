import test from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import AdaptivePlanWorkspace from '../components/workspace/AdaptivePlanWorkspace';
import type { Entity, Relationship } from '../shared/types';

const entities: Entity[] = [
  {
    id: 'mara',
    name: 'Mara Vale',
    category: 'character',
    presence_in_prompt: true,
    description: 'The cartographer',
    alternatives: null,
    attributes: [],
    status: 'confirmed',
    epistemicKind: 'user-authored',
  },
  {
    id: 'orin',
    name: 'Orin',
    category: 'character',
    presence_in_prompt: false,
    description: 'Mara’s brother',
    alternatives: null,
    attributes: [],
    status: 'pending',
    epistemicKind: 'belief',
  },
];

const relationships: Relationship[] = [
  {
    id: 'r-1',
    sourceId: 'mara',
    targetId: 'orin',
    source: 'Mara Vale',
    target: 'Orin',
    label: 'believes Orin left',
    status: 'pending',
    epistemicKind: 'belief',
  },
];

test('adaptive plan keeps decision inbox, graph, inspector and generated output as live slots', () => {
  const html = renderToStaticMarkup(
    React.createElement(AdaptivePlanWorkspace, {
      projectName: 'The Salt Atlas',
      pendingDecisionCount: 2,
      mobileTab: 'graph',
      onMobileTabChange: () => undefined,
      showInspector: true,
      onToggleInspector: () => undefined,
      entities,
      relationships,
      selectedEntityId: 'mara',
      selectedRelationshipId: null,
      onSelectEntity: () => undefined,
      onSelectRelationship: () => undefined,
      decisionInbox: React.createElement('div', null, 'live-inbox-slot'),
      graphCanvas: React.createElement('div', null, 'live-canvas-slot'),
      contextualInspector: React.createElement('div', null, 'live-inspector-slot'),
      generatedOutput: React.createElement('div', null, 'live-output-slot'),
      onOpenInspectorTab: () => undefined,
    outputExpanded: false,
    onToggleOutput: () => undefined,
    })
  );

  for (const slot of ['live-inbox-slot', 'live-canvas-slot', 'live-inspector-slot', 'live-output-slot']) {
    assert.ok(html.includes(slot), `expected to retain ${slot}`);
  }
  assert.match(html, /The Salt Atlas/);
  assert.match(html, /Inbox.*2/);
  assert.match(html, /Causation/);
  assert.match(html, /Questions<\/strong> stay in the inbox/i);
});

test('narrative navigation exposes canonical status and epistemic distinctions', () => {
  const html = renderToStaticMarkup(
    React.createElement(AdaptivePlanWorkspace, {
      projectName: 'The Salt Atlas',
      pendingDecisionCount: 1,
      mobileTab: 'inspector',
      onMobileTabChange: () => undefined,
      showInspector: true,
      onToggleInspector: () => undefined,
      entities,
      relationships,
      selectedEntityId: 'mara',
      selectedRelationshipId: 'r-1',
      onSelectEntity: () => undefined,
      onSelectRelationship: () => undefined,
      decisionInbox: React.createElement('div', null, 'Inbox'),
      graphCanvas: React.createElement('div', null, 'Canvas'),
      contextualInspector: React.createElement('div', null, 'Inspector'),
      generatedOutput: React.createElement('div', null, 'Output'),
      onOpenInspectorTab: () => undefined,
    outputExpanded: false,
    onToggleOutput: () => undefined,
    })
  );

  assert.match(html, /Mara Vale/);
  assert.match(html, /Orin/);
  assert.match(html, /Author canon/i);
  assert.match(html, /Belief/);
  assert.match(html, /Proposed/);
  assert.match(html, /believes Orin left/);
});

test('plan workspace reflects a parent-requested closed inspector state', () => {
  const html = renderToStaticMarkup(
    React.createElement(AdaptivePlanWorkspace, {
      projectName: 'The Salt Atlas',
      pendingDecisionCount: 0,
      mobileTab: 'graph',
      showInspector: false,
      onMobileTabChange: () => undefined,
      onToggleInspector: () => undefined,
      entities: [],
      relationships: [],
      selectedEntityId: null,
      selectedRelationshipId: null,
      onSelectEntity: () => undefined,
      onSelectRelationship: () => undefined,
      decisionInbox: React.createElement('div'),
      graphCanvas: React.createElement('div'),
      contextualInspector: React.createElement('div'),
      generatedOutput: React.createElement('div'),
      onOpenInspectorTab: () => undefined,
      outputExpanded: false,
      onToggleOutput: () => undefined,
    })
  );

  assert.match(html, /aria-expanded="false">\s*Context/);
  assert.match(html, /xl:hidden/);
});
