import assert from 'node:assert/strict';
import test from 'node:test';
import { createSampleProject } from '../lib/canonicalModel.ts';
import { createUndoRedoStateFromProject } from '../lib/historyEngine.ts';
import { migrateProjectPayload, exportProjectToJson } from '../lib/storageEngine.ts';

test('schema 4 rejects a dangling manuscript reference instead of silently dropping it', () => {
  const project = createSampleProject(100);
  assert.throws(() => migrateProjectPayload({
    ...project,
    schemaVersion: 4,
    snapshot: { ...project.snapshot, manuscriptVersionId: 'missing' },
    narrative: { versions: [], sectionVersions: [], audit: [], sources: [], claims: [], issues: [] },
  }), /missing manuscript version/i);
});

test('schema 4 survives the current backup, hydrate and undo entry points', () => {
  const project = createSampleProject(100);
  const text = 'İpek 🦉 e\u0301';
  const record = {
    id: 'first',
    sectionVersionIds: ['section-first'],
  };
  const loaded = migrateProjectPayload({
    ...project,
    schemaVersion: 4,
    narrative: { versions: [record], sectionVersions: [{ id: 'section-first', section: { id: 'main', kind: 'scene', title: '', text } }], audit: [], sources: [], claims: [], issues: [] },
    snapshot: { ...project.snapshot, manuscriptVersionId: 'first' },
    undoHistory: { past: [{ label: 'Write', snapshot: project.snapshot }], future: [] },
  });
  const restored = migrateProjectPayload(JSON.parse(exportProjectToJson(loaded)));
  assert.equal(restored.schemaVersion, 4);
  assert.equal(restored.narrative?.sectionVersions[0].section.text, text);
  assert.equal(createUndoRedoStateFromProject(restored).present.manuscriptVersionId, 'first');
  assert.equal(createUndoRedoStateFromProject(restored).past[0].snapshot.manuscriptVersionId, undefined);
});

test('an unknown stored schema cannot be overwritten even through force recovery', async () => {
  const { saveProjectToLocalStorage, LOCAL_STORAGE_PROJECTS_KEY } = await import('../lib/storageEngine.ts');
  const project = createSampleProject(100);
  const raw = JSON.stringify({ [project.id]: { ...project, schemaVersion: 500 } });
  const original = Object.getOwnPropertyDescriptor(globalThis, 'window');
  const data = new Map([[LOCAL_STORAGE_PROJECTS_KEY, raw]]);
  Object.defineProperty(globalThis, 'window', {
    configurable: true,
    value: { localStorage: { getItem: (key: string) => data.get(key) ?? null, setItem: (key: string, value: string) => data.set(key, value) } },
  });
  try {
    assert.equal(saveProjectToLocalStorage(project, { forceOverwrite: true }).saved, false);
    assert.equal(data.get(LOCAL_STORAGE_PROJECTS_KEY), raw);
  } finally {
    if (original) Object.defineProperty(globalThis, 'window', original);
    else Reflect.deleteProperty(globalThis, 'window');
  }
});
