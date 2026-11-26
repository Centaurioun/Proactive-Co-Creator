#!/usr/bin/env bash
set -euo pipefail

BASE_URL="${E2E_BASE_URL:-http://localhost:3000}"
SESSION="pcc-checkpoints-$$"

if ! command -v playwright-cli >/dev/null 2>&1; then
  echo "playwright-cli not found on PATH" >&2
  exit 1
fi
if ! curl -sf "$BASE_URL/api/health" >/dev/null; then
  echo "Checkpoint browser test server is not healthy at $BASE_URL" >&2
  exit 1
fi
trap 'playwright-cli -s="$SESSION" close >/dev/null 2>&1 || true' EXIT
playwright-cli -s="$SESSION" open "$BASE_URL" >/dev/null

read -r -d '' PLAYWRIGHT_FN <<'EOF' || true
async (page) => {
  const firstId = await page.evaluate(async () => {
    const m = await import('/lib/narrative/import/analysisCheckpoints.ts');
    const cp = await m.createImportCheckpoint({
      source: { digest: 'reload-digest', filename: 'reload.txt', mediaType: 'text/plain', byteLength: 5 },
      scope: 'complete', categories: ['characters'], instruction: '',
      provider: { connectionId: 'gemini-managed', modelId: 'synthetic-model', reasoningLevel: 'default' },
      complete: true, maxCalls: 12, maxInputTokens: 8000, envelopeReserveTokens: 1500,
      totalCharacters: 5, chunks: [{ id: 'chunk-1', index: 0, start: 0, end: 5 }],
    });
    const saved = await m.saveImportCheckpoint(indexedDB, cp);
    if (!saved.ok) throw Error(saved.error);
    const reserved = await m.reserveImportSegmentAttempt(indexedDB, cp.id, 'chunk-1');
    const duplicate = await m.reserveImportSegmentAttempt(indexedDB, cp.id, 'chunk-1');
    const resetBudget = await m.saveImportCheckpoint(indexedDB, await m.createImportCheckpoint({
      source: { digest: 'reload-digest', filename: 'reload.txt', mediaType: 'text/plain', byteLength: 5 },
      scope: 'complete', categories: ['characters'], instruction: '',
      provider: { connectionId: 'gemini-managed', modelId: 'synthetic-model', reasoningLevel: 'default' },
      complete: true, maxCalls: 12, maxInputTokens: 8000, envelopeReserveTokens: 1500,
      totalCharacters: 5, chunks: [{ id: 'chunk-1', index: 0, start: 0, end: 5 }],
    }));
    if (!reserved.ok || duplicate.ok || resetBudget.ok || reserved.value.budget.callsUsed !== 1) throw Error('Atomic reservation, duplicate attempt, or budget reset protection failed.');
    return cp.id;
  });
  await page.reload();
  const reloadResult = await page.evaluate(async (id) => {
    const m = await import('/lib/narrative/import/analysisCheckpoints.ts');
    const listed = await m.listImportCheckpoints(indexedDB);
    const checkpoint = listed.ok && listed.value.find(item => item.id === id);
    if (!checkpoint || checkpoint.segments[0].status !== 'in-flight' || checkpoint.budget.callsUsed !== 1) throw Error('Reload did not preserve in-flight uncertainty and charged budget.');
    const normalized = await m.updateImportCheckpoint(indexedDB, id, current => {
      current.segments = m.markInterruptedSegmentsUncertain(current).segments;
    });
    if (!normalized.ok || normalized.value.segments[0].status !== 'uncertain') throw Error('Interrupted request was not marked uncertain.');
    const implicitReplay = await m.reserveImportSegmentAttempt(indexedDB, id, 'chunk-1');
    const explicitRetry = await m.reserveImportSegmentAttempt(indexedDB, id, 'chunk-1', true);
    if (implicitReplay.ok || !explicitRetry.ok || explicitRetry.value.budget.callsUsed !== 2) throw Error('Retry was not explicit or budget was reset.');
    const deleted = await m.deleteImportCheckpoint(indexedDB, id);
    if (!deleted.ok) throw Error(deleted.error);
    return { reload: true, duplicateBlocked: true, implicitReplayBlocked: true, explicitRetryCharged: true, deleted: true };
  }, firstId);

  const retention = await page.evaluate(async () => {
    const m = await import('/lib/narrative/import/analysisCheckpoints.ts');
    const ids = [];
    for (let index = 0; index < 9; index += 1) {
      const cp = await m.createImportCheckpoint({
        source: { digest: `retention-${index}`, filename: `${index}.txt`, mediaType: 'text/plain', byteLength: 5 },
        scope: 'complete', categories: ['characters'], instruction: '',
        provider: { connectionId: 'gemini-managed', modelId: 'synthetic-model', reasoningLevel: 'default' },
        complete: true, maxCalls: 12, maxInputTokens: 8000, envelopeReserveTokens: 1500,
        totalCharacters: 5, chunks: [{ id: 'chunk-1', index: 0, start: 0, end: 5 }],
      });
      ids.push(cp.id);
      const saved = await m.saveImportCheckpoint(indexedDB, cp);
      if (!saved.ok) throw Error(saved.error);
    }
    const listed = await m.listImportCheckpoints(indexedDB);
    if (!listed.ok || listed.value.length !== 8 || listed.value.some(cp => cp.id === ids[0])) throw Error('Checkpoint retention did not keep only the eight newest records.');
    for (const cp of listed.value) await m.deleteImportCheckpoint(indexedDB, cp.id);
    const badFactory = { open() { throw new Error('storage denied'); } };
    const failed = await m.saveImportCheckpoint(badFactory, await m.createImportCheckpoint({
      source: { digest: 'denied', filename: 'denied.txt', mediaType: 'text/plain', byteLength: 5 },
      scope: 'complete', categories: ['characters'], instruction: '',
      provider: { connectionId: 'gemini-managed', modelId: 'synthetic-model', reasoningLevel: 'default' },
      complete: true, maxCalls: 12, maxInputTokens: 8000, envelopeReserveTokens: 1500,
      totalCharacters: 5, chunks: [{ id: 'chunk-1', index: 0, start: 0, end: 5 }],
    }));
    if (failed.ok) throw Error('Denied storage was incorrectly reported as successful.');
    return { boundedToEight: true, storageFailureVisible: true };
  });
  return { ...reloadResult, ...retention };
}
EOF

playwright-cli -s="$SESSION" run-code "$PLAYWRIGHT_FN"
echo "IMPORT_CHECKPOINT_BROWSER_PASS: reload, single-flight reservation, explicit retry budget, retention, deletion and storage failure"
