import assert from 'node:assert/strict';
import test from 'node:test';
import { createSampleProject } from '../lib/canonicalModel.ts';
import { migrateProjectPayload } from '../lib/storageEngine.ts';

test('legacy projects preserve graph IDs, history and generated media without inventing a manuscript', () => {
  const project = createSampleProject(100);
  project.artifacts = [
    { id: 'story', mode: 'story', createdAt: 100, revisionId: project.revisions[0].id, promptUsed: 'a', storyText: 'İpek 🦉', isOutdated: false },
    { id: 'image', mode: 'image', createdAt: 100, revisionId: project.revisions[0].id, promptUsed: 'b', images: ['data:image/png;base64,AA=='], isOutdated: false },
  ];
  const loaded = migrateProjectPayload(JSON.parse(JSON.stringify(project)));
  assert.deepEqual(loaded.snapshot.entities.map(({ id }) => id), project.snapshot.entities.map(({ id }) => id));
  assert.deepEqual(loaded.revisions, JSON.parse(JSON.stringify(project.revisions)));
  assert.equal(loaded.artifacts[0].storyText, 'İpek 🦉');
  assert.deepEqual(loaded.artifacts[1].images, project.artifacts[1].images);
  assert.equal(loaded.schemaVersion, 3);
});
