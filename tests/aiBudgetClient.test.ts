import assert from 'node:assert/strict';
import test from 'node:test';
import { buildClientBudgetDisclosure } from '../lib/narrative/aiBudgetClient.ts';

test('buildClientBudgetDisclosure uses minimum 1 token for empty input and omits warning within limits', () => {
  const result = buildClientBudgetDisclosure('writing', 'Selection', '');
  assert.deepEqual(result, {
    operation: 'writing',
    scopeLabel: 'Selection',
    inputChars: 0,
    maxInputChars: 24_000,
    estimatedInputTokens: 1,
    maxInputTokens: 9_000,
    withinLimit: true,
  });
  assert.equal('warning' in result, false);
});

test('buildClientBudgetDisclosure applies exact default limits per operation and unknown fallback', () => {
  const expectedLimits: Array<[string, number, number]> = [
    ['diagnostics', 40_000, 14_000],
    ['sync', 40_000, 14_000],
    ['writing', 24_000, 9_000],
    ['opportunities', 36_000, 12_000],
    ['import-enhance', 28_000, 10_000],
    ['narrative-import', 32_000, 12_000],
    ['unknown-operation', 8_000, 4_000],
  ];

  for (const [operation, maxInputChars, maxInputTokens] of expectedLimits) {
    const atBoundary = buildClientBudgetDisclosure(operation, 'Boundary check', 'a'.repeat(maxInputChars));
    assert.equal(atBoundary.maxInputChars, maxInputChars);
    assert.equal(atBoundary.maxInputTokens, maxInputTokens);
    assert.equal(atBoundary.inputChars, maxInputChars);
    assert.equal(atBoundary.estimatedInputTokens, Math.ceil(maxInputChars / 4));
    assert.equal(atBoundary.withinLimit, true);
    assert.equal(atBoundary.warning, undefined);

    const overChars = buildClientBudgetDisclosure(operation, 'Over check', 'a'.repeat(maxInputChars + 1));
    assert.equal(overChars.withinLimit, false);
    assert.match(overChars.warning ?? '', /exceeds the safe app limit/);
    assert.match(overChars.warning ?? '', /Narrow the scope before sending/);
  }
});

test('buildClientBudgetDisclosure serializes structured JSON payloads and preserves scopeLabel', async () => {
  const payload = await Promise.resolve({
    sectionTitle: 'Chapter 1',
    entities: [{ name: 'Ada', role: 'cartographer' }],
    notes: 'x'.repeat(20),
  });
  const serialized = JSON.stringify(payload);
  const result = buildClientBudgetDisclosure('diagnostics', 'Semantic Diagnostics (scene)', payload);

  assert.equal(result.scopeLabel, 'Semantic Diagnostics (scene)');
  assert.equal(result.inputChars, serialized.length);
  assert.equal(result.estimatedInputTokens, Math.ceil(serialized.length / 4));
  assert.equal(result.withinLimit, true);
});

test('buildClientBudgetDisclosure enforces char and token overrideLimits independently', () => {
  const charExceeded = buildClientBudgetDisclosure(
    'diagnostics',
    'Override chars',
    '12345678901',
    { maxInputChars: 10, maxInputTokens: 100 },
  );
  assert.equal(charExceeded.inputChars, 11);
  assert.equal(charExceeded.estimatedInputTokens, 3);
  assert.equal(charExceeded.maxInputChars, 10);
  assert.equal(charExceeded.maxInputTokens, 100);
  assert.equal(charExceeded.withinLimit, false);
  assert.ok(charExceeded.warning);

  const tokenExceeded = buildClientBudgetDisclosure(
    'diagnostics',
    'Override tokens',
    '123456789',
    { maxInputChars: 100, maxInputTokens: 2 },
  );
  assert.equal(tokenExceeded.inputChars, 9);
  assert.equal(tokenExceeded.estimatedInputTokens, 3);
  assert.equal(tokenExceeded.maxInputChars, 100);
  assert.equal(tokenExceeded.maxInputTokens, 2);
  assert.equal(tokenExceeded.withinLimit, false);
  assert.ok(tokenExceeded.warning);

  const partialOverride = buildClientBudgetDisclosure(
    'writing',
    'Partial override',
    'abcd',
    { maxInputTokens: 50 },
  );
  assert.equal(partialOverride.maxInputChars, 24_000);
  assert.equal(partialOverride.maxInputTokens, 50);
  assert.equal(partialOverride.withinLimit, true);
});

test('buildClientBudgetDisclosure propagates serialization errors for circular payloads', () => {
  const circular: Record<string, unknown> = { name: 'loop' };
  circular.self = circular;
  assert.throws(() => buildClientBudgetDisclosure('sync', 'Broken payload', circular), TypeError);
});
