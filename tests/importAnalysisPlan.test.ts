import assert from 'node:assert/strict';
import test from 'node:test';
import * as segmentation from '../lib/narrative/import/segmentation.ts';

test('short source plans one request with no unnecessary segmentation', () => {
  const source = 'Ada opens the door.\n\nMina waits.';
  const plan = segmentation.planNarrativeSourceAnalysis(source, [], 12);
  assert.equal(plan.scheduledRequests, 1);
  assert.equal(plan.completeWithinCallBudget, true);
  assert.equal(plan.chunks[0].text, source);
  assert.equal(plan.unplannedChars, 0);
});

test('long source discloses partial coverage under the existing request ceiling', () => {
  const source = 'a'.repeat(100_000);
  const plan = segmentation.planNarrativeSourceAnalysis(source, [], 2);
  assert.equal(plan.scheduledRequests, 2);
  assert.equal(plan.completeWithinCallBudget, false);
  assert.equal(plan.unplannedChars, source.length - plan.chunks[1].end);
  assert.ok(plan.unplannedChars > 0);
  assert.equal(plan.chunks[1].text, source.slice(plan.chunks[1].start, plan.chunks[1].end));
});

test('exhausted request ceiling discloses zero scheduled requests', () => {
  const source = 'Ada.';
  const plan = segmentation.planNarrativeSourceAnalysis(source, [], 0);
  assert.equal(plan.scheduledRequests, 0);
  assert.equal(plan.unplannedChars, source.length);
  assert.equal(plan.completeWithinCallBudget, false);
});

test('segmentation ceiling cannot be presented as full coverage', () => {
  const source = 'a'.repeat(600_000);
  const plan = segmentation.planNarrativeSourceAnalysis(source, [], 100);
  assert.equal(plan.scheduledRequests, segmentation.MAX_IMPORT_CHUNKS);
  assert.equal(plan.completeWithinCallBudget, false);
  assert.ok(plan.unplannedChars > 0);
});

test('adaptive narrative plan leaves a safe short source whole', () => {
  const source = 'Ada kapıyı açtı. 🗝️\n\nMina içeride bekliyordu.';
  const plan = segmentation.planAdaptiveNarrativeSourceAnalysis(source, [], 12);
  assert.equal(plan.chunks.length, 1);
  assert.equal(plan.chunks[0].text, source);
  assert.equal(plan.completeWithinCallBudget, true);
  assert.equal(plan.operation, 'narrative-import');
  assert.equal(plan.countAuthority, 'server-provider-preflight');
});

test('adaptive narrative plan keeps Unicode code points intact and splits at a paragraph boundary', () => {
  const paragraph = `Türkçe öykü 🧭 ${'ö'.repeat(180)}`;
  const source = `${paragraph}\n\n${paragraph}\n\n${paragraph}`;
  const plan = segmentation.planAdaptiveNarrativeSourceAnalysis(source, [], 12, {
    maxInputTokens: 250,
    envelopeReserveTokens: 20,
  });
  assert.ok(plan.chunks.length > 1);
  assert.equal(plan.chunks[0].text.endsWith('\n\n'), true);
  for (const chunk of plan.chunks) {
    assert.equal(source.slice(chunk.start, chunk.end), chunk.text);
    assert.ok(!/^[\uDC00-\uDFFF]/u.test(chunk.text));
    assert.ok(plan.limits.envelopeReserveTokens + segmentation.estimateNarrativeInputTokens(chunk.text) <= plan.limits.maxInputTokens);
  }
  assert.equal(plan.completeWithinCallBudget, true);
});

test('adaptive planning reports incomplete coverage when request budget is exhausted', () => {
  const source = 'narrative '.repeat(2000);
  const plan = segmentation.planAdaptiveNarrativeSourceAnalysis(source, [], 1, {
    maxInputTokens: 80,
    envelopeReserveTokens: 20,
  });
  assert.equal(plan.scheduledRequests, 1);
  assert.equal(plan.completeWithinCallBudget, false);
  assert.ok(plan.unplannedChars > 0);
});

test('adaptive structural boundaries must advance from the current start', () => {
  const source = 'ö'.repeat(1_200);
  const plan = segmentation.planAdaptiveNarrativeSourceAnalysis(source, [
    { id: 'early', start: 0, end: 200, kind: 'paragraph' },
    { id: 'later', start: 900, end: 1_000, kind: 'paragraph' },
  ], 10, { maxInputTokens: 620, envelopeReserveTokens: 20 });

  assert.ok(plan.chunks.length > 1);
  for (const chunk of plan.chunks) {
    assert.ok(chunk.end > chunk.start);
    assert.ok(chunk.end - chunk.start <= 600);
    assert.equal(chunk.text, source.slice(chunk.start, chunk.end));
    assert.ok(segmentation.estimateNarrativeInputTokens(chunk.text) <= 600);
  }
  assert.ok(plan.chunks[0].end >= 550, 'a boundary before the current budget window must not pull the cut backward');
  assert.equal(plan.complete, true);
});

test('adaptive paragraph preference cannot exceed the payload estimate', () => {
  const source = `${'ö'.repeat(9)}${'a'.repeat(3)}\n\n${'ö'.repeat(30)}`;
  const plan = segmentation.planAdaptiveNarrativeSourceAnalysis(source, [], 10, {
    maxInputTokens: 15,
    envelopeReserveTokens: 5,
  });
  for (const chunk of plan.chunks) {
    assert.ok(segmentation.estimateNarrativeInputTokens(chunk.text) <= plan.limits.payloadTokenBudget);
  }
});

test('adaptive cuts respect grapheme boundaries and preserve exact UTF-16 offsets', () => {
  const graphemes = ['a\u0308', '🇹🇷', '👩🏽‍🚀', '👨‍👩‍👧‍👦', '🧿'];
  const source = `${graphemes.join(' ')} `.repeat(90);
  const plan = segmentation.planAdaptiveNarrativeSourceAnalysis(source, [], 20, {
    maxInputTokens: 250,
    envelopeReserveTokens: 20,
  });
  const boundaries = new Set([0, source.length]);
  for (const part of new Intl.Segmenter('tr', { granularity: 'grapheme' }).segment(source)) {
    boundaries.add(part.index);
    boundaries.add(part.index + part.segment.length);
  }
  assert.ok(plan.chunks.length > 1);
  for (const chunk of plan.chunks) {
    assert.ok(chunk.end > chunk.start);
    assert.ok(boundaries.has(chunk.start));
    assert.ok(boundaries.has(chunk.end));
    assert.equal(chunk.text, source.slice(chunk.start, chunk.end));
    assert.ok(segmentation.estimateNarrativeInputTokens(chunk.text) <= plan.limits.payloadTokenBudget);
  }
  const coverage = segmentation.calculateProcessedCoverage(plan.chunks);
  assert.deepEqual(coverage, [{ start: 0, end: source.length }]);
  assert.equal(plan.complete, true);
});

test('adaptive planner honestly stops when no complete grapheme fits the request budget', () => {
  const source = `${'👨‍👩‍👧‍👦'}${'a'.repeat(20)}`;
  const plan = segmentation.planAdaptiveNarrativeSourceAnalysis(source, [], 10, {
    maxInputTokens: 2,
    envelopeReserveTokens: 1,
  });
  assert.equal(plan.chunks.length, 0);
  assert.equal(plan.complete, false);
  assert.equal(plan.scheduledRequests, 0);
  assert.equal(plan.unplannedChars, source.length);
  assert.equal(plan.completeWithinCallBudget, false);
});

test('adaptive planner makes bounded progress with the smallest ASCII payload budget', () => {
  const source = 'x'.repeat(1_000);
  const plan = segmentation.planAdaptiveNarrativeSourceAnalysis(source, [], 20, {
    maxInputTokens: 4,
    envelopeReserveTokens: 3,
    maxChunks: 4,
  });
  assert.equal(plan.limits.payloadTokenBudget, 1);
  assert.equal(plan.chunks.length, 4);
  for (const chunk of plan.chunks) {
    assert.ok(chunk.end > chunk.start);
    assert.ok(segmentation.estimateNarrativeInputTokens(chunk.text) <= 1);
  }
  assert.equal(plan.complete, false);
  assert.ok(plan.unplannedChars > 0);
});

test('adaptive long unbroken text is deterministic and reports the chunk ceiling honestly', () => {
  const source = 'x'.repeat(12_000);
  const options = { maxInputTokens: 100, envelopeReserveTokens: 10, maxChunks: 5 };
  const plan = segmentation.planAdaptiveNarrativeSourceAnalysis(source, [], 20, options);
  assert.deepEqual(segmentation.planAdaptiveNarrativeSourceAnalysis(source, [], 20, options), plan);
  assert.equal(plan.chunks.length, 5);
  assert.equal(plan.complete, false);
  assert.ok(plan.unplannedChars > 0);
  assert.ok(plan.chunks.every(chunk => chunk.end > chunk.start));
  assert.deepEqual(segmentation.calculateProcessedCoverage(plan.chunks), [{ start: 0, end: plan.chunks.at(-1)!.end }]);
});

test('adaptive planning remains partial at the configured chunk ceiling', () => {
  const source = 'ö'.repeat(10_000);
  const plan = segmentation.planAdaptiveNarrativeSourceAnalysis(source, [], 20, {
    maxInputTokens: 110,
    envelopeReserveTokens: 10,
    maxChunks: 2,
  });
  assert.equal(plan.chunks.length, 2);
  assert.equal(plan.complete, false);
  assert.ok(plan.unplannedChars > 0);
  assert.ok(plan.chunks.every(chunk => chunk.end > chunk.start));
});
