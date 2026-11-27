import assert from 'node:assert/strict';
import test from 'node:test';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import ManuscriptEditor, {
  computeEditorDirtyAfterDraftDiscard,
  resolveReturnSelection,
  resolveSplitOffset,
  shouldBlockActionDuringComposition,
  shouldOpenAdoptionOnPropChange,
} from '../components/manuscript/ManuscriptEditor';
import AdoptArtifactDialog from '../components/manuscript/AdoptArtifactDialog';
import {
  isWritingAssistResponseCurrent,
  resolveAlternativeTargetSectionId,
} from '../components/manuscript/WritingAssistantPanel';
import { buildFxSimple } from '../scripts/stage0-fixtures';

test('return selection restores offsets only when the scene text is unchanged', () => {
  const text = 'Ada 🦉 Türkçe é';
  const start = text.indexOf('Türkçe');
  const end = start + 'Türkçe'.length;
  assert.deepEqual(resolveReturnSelection(text, { textIdentity: text, start, end }), {
    start,
    end,
    textMatches: true,
  });
});

test('return selection collapses safely when the scene text changed while away', () => {
  const original = 'Ada finds the silver key beside the gate.';
  const start = original.indexOf('silver');
  const changed = 'A new paragraph was inserted before the original scene.' + original;
  assert.deepEqual(resolveReturnSelection(changed, {
    textIdentity: original,
    start,
    end: start + 'silver key'.length,
  }), { start: 0, end: 0, textMatches: false });
});

test('restored selection never divides a Unicode surrogate pair', () => {
  const text = 'owl 🦉 story';
  const owlStart = text.indexOf('🦉');
  assert.deepEqual(resolveReturnSelection(text, {
    textIdentity: text,
    start: owlStart + 1,
    end: owlStart + 1,
  }), { start: owlStart, end: owlStart, textMatches: true });
});

test('W5-01: initialArtifactId transition from undefined to artifactId opens adoption dialog', () => {
  assert.equal(shouldOpenAdoptionOnPropChange(undefined, undefined), false);
  assert.equal(shouldOpenAdoptionOnPropChange(undefined, 'art_123'), true);
  assert.equal(shouldOpenAdoptionOnPropChange('art_123', 'art_123'), false);
  assert.equal(shouldOpenAdoptionOnPropChange('art_123', 'art_456'), true);
  assert.equal(shouldOpenAdoptionOnPropChange('art_123', undefined), false);
});

test('W5-07: IME composition blocks section switching/preview, preview split uses selectionRange.start, and discard preserves styleProfileDirty', () => {
  assert.equal(shouldBlockActionDuringComposition(true), true);
  assert.equal(shouldBlockActionDuringComposition(false), false);
  assert.equal(resolveSplitOffset(true, undefined, 42), 42);
  assert.equal(resolveSplitOffset(false, 19, 42), 19);
  assert.equal(computeEditorDirtyAfterDraftDiscard(true), true);
  assert.equal(computeEditorDirtyAfterDraftDiscard(false), false);
});

test('W5-08: WritingAssistantPanel fences stale/cross-section AI responses and attributes kept alternatives to generated.sectionId', () => {
  assert.equal(isWritingAssistResponseCurrent(3, 3, 'sec-a', 'sec-a', false), true);
  assert.equal(isWritingAssistResponseCurrent(2, 3, 'sec-a', 'sec-a', false), false);
  assert.equal(isWritingAssistResponseCurrent(3, 3, 'sec-a', 'sec-b', false), false);
  assert.equal(isWritingAssistResponseCurrent(3, 3, 'sec-a', 'sec-a', true), false);
  assert.equal(resolveAlternativeTargetSectionId('sec-origin'), 'sec-origin');
});

test('W5-14: ManuscriptEditor and AdoptArtifactDialog buttons declare explicit type="button"', () => {
  const project = buildFxSimple();
  project.artifacts = [
    {
      id: 'art_story_1',
      mode: 'story',
      createdAt: project.updatedAt,
      revisionId: 'rev_1',
      promptUsed: 'prompt',
      storyText: 'Once upon a time.',
      isOutdated: false,
    },
  ];
  const editorHtml = renderToStaticMarkup(
    React.createElement(ManuscriptEditor, {
      project,
      onSave: async () => {},
      onDirty: () => {},
      onUndo: () => {},
      onRedo: () => {},
      canUndo: false,
      canRedo: false,
      enabled: true,
      onExportDraft: () => {},
    })
  );
  const dialogHtml = renderToStaticMarkup(
    React.createElement(AdoptArtifactDialog, {
      project,
      sectionId: '',
      initialArtifactId: 'art_story_1',
      busy: false,
      onCancel: () => {},
      onApply: () => {},
    })
  );

  for (const [label, html] of [['ManuscriptEditor', editorHtml], ['AdoptArtifactDialog', dialogHtml]] as const) {
    const buttons = html.match(/<button\b[^>]*>/g) ?? [];
    assert.ok(buttons.length > 0, `Expected buttons in ${label}`);
    for (const tag of buttons) {
      assert.match(tag, /\btype="(button|submit|reset)"/, `Missing explicit button type in ${label}: ${tag}`);
    }
  }
});
