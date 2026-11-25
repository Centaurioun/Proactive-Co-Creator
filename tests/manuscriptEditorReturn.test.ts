import assert from 'node:assert/strict';
import test from 'node:test';
import { resolveReturnSelection } from '../components/manuscript/ManuscriptEditor';

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
