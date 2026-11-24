import assert from 'node:assert/strict';
import test from 'node:test';
import { createSampleProject } from '../lib/canonicalModel.ts';
import { projectRelationships } from '../lib/narrative/projections/relationshipProjection.ts';

function relationshipProject() {
  const project = createSampleProject(1);
  project.snapshot.entities = project.snapshot.entities
    .filter(entity => entity.id === 'ent_cat' || entity.id === 'ent_rabbit')
    .map(entity => ({ ...entity, excluded: false }));
  project.snapshot.relationships = [
    { id: 'rel-z', sourceId: 'ent_cat', targetId: 'ent_rabbit', source: 'Wrong source', target: 'Wrong target', label: 'knows', status: 'confirmed' },
    { id: 'rel-a', sourceId: 'ent_rabbit', targetId: 'ent_cat', source: 'Cat', target: 'Rabbit', label: 'protects', status: 'pending' },
  ];
  return project;
}

test('relationship projection preserves verified direction, reverse edges, status, canonical IDs, and deterministic order', () => {
  const project = relationshipProject();
  const before = JSON.stringify(project.snapshot);
  const projection = projectRelationships(project.snapshot);
  assert.deepEqual(projection.edges, [
    { id: 'rel-a', sourceId: 'ent_rabbit', targetId: 'ent_cat', label: 'protects', status: 'pending' },
    { id: 'rel-z', sourceId: 'ent_cat', targetId: 'ent_rabbit', label: 'knows', status: 'confirmed' },
  ]);
  assert.deepEqual(projection.nodes, [
    { id: 'ent_cat', name: 'Cat', category: 'character', status: 'confirmed', provenance: 'prompt-explicit', excluded: false },
    { id: 'ent_rabbit', name: 'Rabbit', category: 'character', status: 'confirmed', provenance: 'prompt-explicit', excluded: false },
  ]);
  assert.deepEqual(projection.omissions, []);
  assert.equal(JSON.stringify(project.snapshot), before);
});

test('legacy text endpoints are not guessed by name and malformed relationships report every omission reason', () => {
  const project = relationshipProject();
  project.snapshot.relationships = [
    { source: 'Cat', target: 'Rabbit', label: 'friend', id: undefined, targetId: 'ent_rabbit' },
    { id: 'rel-unknown', source: 'Cat', target: 'Rabbit', label: 'friend', sourceId: 'missing', targetId: 'ent_rabbit' },
    { id: 'rel-legacy', source: 'Cat', target: 'Rabbit', label: 'friend', targetId: 'ent_rabbit' },
    { id: 'rel-missing-target', source: 'Cat', target: 'Rabbit', label: 'friend', sourceId: 'ent_cat' },
    { id: ' rel-invalid ', source: 'Cat', target: 'Rabbit', label: 'friend', sourceId: 'ent_cat', targetId: 'ent_rabbit' },
    { id: 'rel-invalid-source', source: 'Cat', target: 'Rabbit', label: 'friend', sourceId: ' ent_cat ', targetId: 'ent_rabbit' },
    { id: 'rel-empty-label', source: 'Cat', target: 'Rabbit', label: '  ', sourceId: 'ent_cat', targetId: 'ent_rabbit' },
    { id: 'rel-duplicate', source: 'Cat', target: 'Rabbit', label: 'friend', sourceId: 'ent_cat', targetId: 'ent_rabbit' },
    { id: 'rel-duplicate', source: 'Rabbit', target: 'Cat', label: 'friend', sourceId: 'ent_rabbit', targetId: 'ent_cat' },
  ];
  const projection = projectRelationships(project.snapshot);
  assert.deepEqual(projection.edges, []);
  assert.deepEqual(projection.omissions.map(item => [item.relationshipId, item.reasons]), [
    [undefined, ['missing-relationship-id', 'missing-source-id']],
    [undefined, ['invalid-relationship-id']],
    ['rel-duplicate', ['duplicate-relationship-id']],
    ['rel-duplicate', ['duplicate-relationship-id']],
    ['rel-empty-label', ['empty-relationship-label']],
    ['rel-invalid-source', ['invalid-source-id']],
    ['rel-legacy', ['missing-source-id']],
    ['rel-missing-target', ['missing-target-id']],
    ['rel-unknown', ['unknown-source-id']],
  ]);
  assert.equal(projection.nodes.length, 0);
});

test('duplicate canonical entity IDs make endpoints ambiguous instead of selecting by name or order', () => {
  const project = relationshipProject();
  const rabbit = project.snapshot.entities.find(entity => entity.id === 'ent_rabbit');
  assert.ok(rabbit);
  project.snapshot.entities.push({ ...rabbit, name: 'Another Rabbit' });
  project.snapshot.relationships = [
    { id: 'rel-ambiguous', source: 'Cat', target: 'Rabbit', label: 'knows', sourceId: 'ent_cat', targetId: 'ent_rabbit' },
  ];
  const projection = projectRelationships(project.snapshot);
  assert.deepEqual(projection.edges, []);
  assert.deepEqual(projection.omissions, [{
    relationshipId: 'rel-ambiguous', sourceId: 'ent_cat', targetId: 'ent_rabbit', label: 'knows',
    reasons: ['ambiguous-target-id'],
  }]);
});

test('duplicate relationship identities are omitted and omission order does not depend on relationship array order', () => {
  const project = relationshipProject();
  project.snapshot.relationships = [
    { id: 'rel-dupe', source: 'Cat', target: 'Rabbit', label: 'first', sourceId: 'ent_cat', targetId: 'ent_rabbit' },
    { id: 'rel-kept', source: 'Cat', target: 'Rabbit', label: 'second', sourceId: 'ent_cat', targetId: 'ent_rabbit' },
    { id: 'rel-dupe', source: 'Rabbit', target: 'Cat', label: 'reverse', sourceId: 'ent_rabbit', targetId: 'ent_cat' },
    { source: 'A', target: 'B', label: 'd', sourceId: 'a\u0000b', targetId: 'c' },
    { source: 'A', target: 'B', label: 'd', sourceId: 'a', targetId: 'b\u0000c' },
  ];
  const forward = projectRelationships(project.snapshot);
  const reverse = projectRelationships({ ...project.snapshot, relationships: [...project.snapshot.relationships].reverse() });
  assert.deepEqual(forward, reverse);
  assert.deepEqual(forward.edges.map(edge => edge.id), ['rel-kept']);
  assert.equal(forward.omissions.length, 4);
});
