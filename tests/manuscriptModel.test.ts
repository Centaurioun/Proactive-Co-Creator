import assert from 'node:assert/strict';
import test from 'node:test';
import { createSampleProject } from '../lib/canonicalModel.ts';
import { createUndoRedoStateFromProject } from '../lib/historyEngine.ts';
import { commitUndoTransaction, commitRedoTransaction } from '../lib/projectController.ts';
import { applyManuscriptOperation, manuscriptSections, prepareManuscriptChange } from '../lib/narrative/manuscriptModel.ts';
import type { ManuscriptSection } from '../shared/narrativeTypes.ts';

const prose = 'İpek 🦉\n\ne\u0301';
const scene: ManuscriptSection = { id: 'one', kind: 'scene', title: '', text: prose };

test('split and merge preserve the exact Unicode text and lineage', () => {
  assert.throws(() => applyManuscriptOperation([scene], { kind: 'split', id: 'one', offset: 6 }), /boundary/i);
  const split = applyManuscriptOperation([scene], { kind: 'split', id: 'one', offset: 7 });
  assert.equal(split[0].id, scene.id);
  assert.deepEqual(split[1].derivedFrom, [scene.id]);
  const merged = applyManuscriptOperation(split, { kind: 'merge', id: scene.id });
  assert.equal(merged[0].text, prose);
  assert.deepEqual(merged[0].derivedFrom, [split[1].id]);
});

test('a manuscript commit validates the project and base and shares undo and redo', () => {
  const project = createSampleProject(100);
  const undo = createUndoRedoStateFromProject(project);
  const base = { projectId: project.id, revision: project.revision };
  assert.throws(() => prepareManuscriptChange(project, undo, { ...base, revision: 0 }, [scene]), /changed/i);
  const written = prepareManuscriptChange(project, undo, base, [scene]);
  assert.ok(written);
  assert.equal(written.project.revision, project.revision + 1);
  assert.equal(written.project.revisions[0].snapshot.manuscriptVersionId, written.project.snapshot.manuscriptVersionId);
  assert.equal(prepareManuscriptChange(written.project, written.undoState, {
    ...base, revision: written.project.revision, manuscriptVersionId: written.project.snapshot.manuscriptVersionId,
  }, [scene]), null);
  const undone = commitUndoTransaction(written.project, written.undoState);
  assert.deepEqual(manuscriptSections(undone.project), []);
  assert.equal(undone.project.narrative?.audit.at(-1)?.action, 'undo');
  const redone = commitRedoTransaction(undone.project, undone.undoState);
  assert.deepEqual(manuscriptSections(redone.project), [scene]);
  assert.equal(redone.project.narrative?.audit.at(-1)?.action, 'redo');
});

test('a change to one scene retains a single stored copy of unchanged long prose', () => {
  const project = createSampleProject(100);
  const untouched = { ...scene, id: 'unchanged', text: 'İpek 🦉 é '.repeat(2000) };
  const written = prepareManuscriptChange(project, createUndoRedoStateFromProject(project),
    { projectId: project.id, revision: project.revision }, [scene, untouched]);
  assert.ok(written);
  const later = prepareManuscriptChange(written.project, written.undoState, {
    projectId: project.id, revision: written.project.revision, manuscriptVersionId: written.project.snapshot.manuscriptVersionId,
  }, [{ ...scene, text: 'Changed' }, untouched]);
  assert.ok(later);
  const records = later.project.narrative;
  assert.ok(records);
  assert.equal(JSON.stringify(records).split(untouched.text).length - 1, 1);
  assert.deepEqual(manuscriptSections(later.project), [{ ...scene, text: 'Changed' }, untouched]);
});

test('adoption verifies UTF-16 boundaries and project ownership and keeps provenance through undo', async () => {
  const { adoptGeneratedText, narrativeBase } = await import('../lib/narrative/manuscriptModel.ts');
  const project = createSampleProject(100);
  const artifact = {
    id: 'generated', projectId: project.id, mode: 'story' as const, createdAt: 100,
    revisionId: project.revisions[0].id, promptUsed: 'Synthetic', storyText: prose, isOutdated: false,
  };
  const anchor = { artifactId: artifact.id, start: 5, end: 7, excerpt: '🦉' };
  project.artifacts = [{ ...artifact, projectId: 'elsewhere' }];
  assert.throws(() => adoptGeneratedText(project, anchor, 'new-scene', ''), /no longer available/i);
  project.artifacts = [artifact];
  assert.throws(() => adoptGeneratedText(project, { ...anchor, start: 6, excerpt: prose.slice(6, 7) }, 'new-scene', ''), /no longer available/i);
  const next = adoptGeneratedText(project, anchor, 'new-scene', '');
  const prepared = prepareManuscriptChange(project, createUndoRedoStateFromProject(project), narrativeBase(project), next, anchor);
  assert.ok(prepared);
  const undone = commitUndoTransaction(prepared.project, prepared.undoState);
  assert.deepEqual(undone.project.narrative?.audit[0].artifact, anchor);
  assert.equal(undone.project.artifacts[0].storyText, prose);
});
