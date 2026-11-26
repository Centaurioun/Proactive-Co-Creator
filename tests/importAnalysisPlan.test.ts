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
