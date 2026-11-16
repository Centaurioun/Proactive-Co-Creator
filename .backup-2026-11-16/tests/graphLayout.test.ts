import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  getCanonicalEntityName,
  getHighestProbabilityValue,
  inferEntityCategory,
  isSceneEntityName,
  normalizeAndDeduplicateRelationships,
  splitSceneAndObjectEntities,
  truncateLabel,
} from '../lib/beliefGraphUtils.ts';
import {
  computeFitTransform,
  computeForceLayout,
  computeNodeDimensions,
  getEdgePath,
  getIntersection,
} from '../lib/graphLayout.ts';
import type { Entity, Relationship } from '../shared/types.ts';

const makeEntity = (name: string): Entity => ({
  name,
  presence_in_prompt: true,
  description: '',
  alternatives: null,
  attributes: [{ name: 'existence', presence_in_prompt: true, value: [{ name: 'true' }, { name: 'false' }] }],
});

describe('lib/beliefGraphUtils & lib/graphLayout', () => {
  it('separates scene entity from object entities across supported modes (story and image) and rejects video scene entity', () => {
    const entities = [makeEntity('The Image'), makeEntity('Cat'), makeEntity('Hat')];
    const { sceneEntity, objectEntities } = splitSceneAndObjectEntities(entities);

    assert.equal(isSceneEntityName('the video'), false);
    assert.equal(isSceneEntityName('Story'), true);
    assert.equal(isSceneEntityName('The Story'), true);
    assert.equal(isSceneEntityName('The Image'), true);
    assert.equal(sceneEntity?.name, 'The Image');
    assert.deepEqual(
      objectEntities.map((e) => e.name),
      ['Cat', 'Hat']
    );
    assert.equal(inferEntityCategory(makeEntity('Cat Host')), 'character');
    assert.equal(inferEntityCategory(makeEntity('Dining Room')), 'location');
    assert.equal(inferEntityCategory(makeEntity('Dining Table')), 'object');
    assert.equal(inferEntityCategory(makeEntity('Animal Guests')), 'group');
  });

  it('extracts highest probability attribute value and truncates long labels', () => {
    assert.equal(
      getHighestProbabilityValue({
        name: 'color',
        presence_in_prompt: false,
        value: [{ name: 'amber' }, { name: 'blue' }],
      }),
      'amber'
    );
    assert.equal(
      getHighestProbabilityValue({ name: 'empty', presence_in_prompt: false, value: [] }),
      'Unknown'
    );
    assert.equal(truncateLabel('short', 10), 'short');
    assert.equal(truncateLabel('a very long relationship label', 10), 'a very lon...');
  });

  it('normalizes canonical entity names and deduplicates undirected relationship pairs', () => {
    const objectEntities = [makeEntity('The Red Cat'), makeEntity('Party Hat')];
    assert.equal(getCanonicalEntityName('red cat', objectEntities), 'The Red Cat');

    const rawRelationships: Relationship[] = [
      { source: 'The Image', target: 'Cat', label: 'contains' },
      { source: 'Red Cat', target: 'Party Hat', label: 'wearing' },
      { source: 'Party Hat', target: 'The Red Cat', label: 'worn by' },
      { source: 'Red Cat', target: 'The Red Cat', label: 'self' },
    ];

    const normalized = normalizeAndDeduplicateRelationships(rawRelationships, objectEntities);
    assert.equal(normalized.length, 1);
    assert.equal(normalized[0].source, 'The Red Cat');
    assert.equal(normalized[0].target, 'Party Hat');
    assert.equal(normalized[0].label, 'wearing');
  });

  it('computes node dimensions, intersection geometry, and edge paths cleanly', () => {
    const entities = [makeEntity('Cat'), makeEntity('Friends')];
    const dims = computeNodeDimensions(entities);
    assert.equal(dims.Cat.width, 64);
    assert.equal(dims.Friends.width, 80);

    const hit = getIntersection(0, 0, 100, 0, 60, 36, 0);
    assert.equal(hit.x, 30);
    assert.equal(hit.y, 0);

    const edge = getEdgePath(0, 0, 200, 0, 60, 36, 80, 36);
    assert.match(edge.path, /^M 30 0 L 155 0$/);
    assert.equal(edge.labelX, 92.5);
    assert.equal(edge.labelY, 0);
  });

  it('computes deterministic finite force-directed positions without collapsing nodes', () => {
    assert.deepEqual(
      computeForceLayout({
        objectEntities: [],
        relationships: [],
        nodeDimensions: {},
        containerWidth: 600,
        containerHeight: 400,
      }),
      {}
    );

    const entities = [makeEntity('Cat'), makeEntity('Friends'), makeEntity('Garden')];
    const dims = computeNodeDimensions(entities);
    const rels: Relationship[] = [
      { source: 'Cat', target: 'Friends', label: 'hosting' },
      { source: 'Friends', target: 'Garden', label: 'gathering in' },
    ];

    const posA = computeForceLayout({
      objectEntities: entities,
      relationships: rels,
      nodeDimensions: dims,
      containerWidth: 800,
      containerHeight: 600,
    });
    const posB = computeForceLayout({
      objectEntities: entities,
      relationships: rels,
      nodeDimensions: dims,
      containerWidth: 800,
      containerHeight: 600,
    });

    assert.deepEqual(posA, posB);
    for (const entity of entities) {
      assert.equal(Number.isFinite(posA[entity.name].x), true);
      assert.equal(Number.isFinite(posA[entity.name].y), true);
    }

    const dx = posA.Cat.x - posA.Friends.x;
    const dy = posA.Cat.y - posA.Friends.y;
    assert.ok(Math.hypot(dx, dy) > 40);
  });

  it('computes fit transform to prevent node clipping on compact containers', () => {
    const dims = { A: { width: 100, height: 36 }, B: { width: 100, height: 36 } };
    const tallPositions = { A: { x: 300, y: 0 }, B: { x: 300, y: 600 } };
    const fit = computeFitTransform(tallPositions, dims, 600, 360, 40);
    assert.ok(fit.k < 1);
    assert.ok(fit.k >= 0.35);

    const topScreenY = tallPositions.A.y * fit.k + fit.y;
    const bottomScreenY = tallPositions.B.y * fit.k + fit.y;
    assert.ok(topScreenY >= 20);
    assert.ok(bottomScreenY <= 340);

    const smallPositions = { A: { x: 250, y: 180 }, B: { x: 350, y: 180 } };
    const fitSmall = computeFitTransform(smallPositions, dims, 600, 360, 40);
    assert.equal(fitSmall.k, 1);
  });
});
