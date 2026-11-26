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
    const reserved = await m.reserveImportSegmentAttempt(indexedDB, cp.id, 'chunk-1', 'tab-a');
    const duplicate = await m.reserveImportSegmentAttempt(indexedDB, cp.id, 'chunk-1', 'tab-b');
    const resetBudget = await m.saveImportCheckpoint(indexedDB, await m.createImportCheckpoint({
      source: { digest: 'reload-digest', filename: 'reload.txt', mediaType: 'text/plain', byteLength: 5 },
      scope: 'complete', categories: ['characters'], instruction: '',
      provider: { connectionId: 'gemini-managed', modelId: 'synthetic-model', reasoningLevel: 'default' },
      complete: true, maxCalls: 12, maxInputTokens: 8000, envelopeReserveTokens: 1500,
      totalCharacters: 5, chunks: [{ id: 'chunk-1', index: 0, start: 0, end: 5 }],
    }));
    if (!reserved.ok || duplicate.ok || resetBudget.ok || reserved.value.budget.callsUsed !== 1) throw Error('Atomic reservation, duplicate attempt, or budget reset protection failed.');
    return { id: cp.id, incarnationId: cp.incarnationId, attemptId: reserved.value.segments[0].attemptId };
  });
  await page.reload();
  const reloadResult = await page.evaluate(async ({ id, incarnationId, attemptId }) => {
    const m = await import('/lib/narrative/import/analysisCheckpoints.ts');
    let listed = await m.listImportCheckpoints(indexedDB);
    let checkpoint = listed.ok && listed.value.find(item => item.id === id);
    if (!checkpoint || checkpoint.segments[0].status !== 'in-flight' || checkpoint.budget.callsUsed !== 1) throw Error('Reload did not preserve in-flight uncertainty and charged budget.');
    const blocked = await m.reserveImportSegmentAttempt(indexedDB, id, 'chunk-1', 'tab-b', true);
    if (blocked.ok) throw Error('A second tab took over a live attempt.');
    const database = await new Promise((resolve, reject) => {
      const request = indexedDB.open('proactive_co_creator_db_v2', 2);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    await new Promise((resolve, reject) => {
      const tx = database.transaction('analysis-checkpoints', 'readwrite');
      const store = tx.objectStore('analysis-checkpoints');
      const request = store.get(id);
      request.onsuccess = () => { request.result.segments[0].leaseExpiresAt = Date.now() - 1; store.put(request.result); };
      tx.oncomplete = resolve; tx.onerror = () => reject(tx.error);
    });
    const expired = await m.markExpiredImportAttemptsUncertain(indexedDB, id);
    if (!expired.ok || expired.value.segments[0].status !== 'uncertain') throw Error('Expired attempt was not marked uncertain.');
    const explicitRetry = await m.reserveImportSegmentAttempt(indexedDB, id, 'chunk-1', 'tab-b', true);
    if (!explicitRetry.ok || explicitRetry.value.budget.callsUsed !== 2) throw Error('Retry was not explicit or budget was reset.');
    const staleCommit = await m.commitImportSegmentAttempt(indexedDB, {
      checkpointId: id, incarnationId, segmentId: 'chunk-1', attemptId, ownerId: 'tab-a',
    }, segment => { segment.status = 'complete'; });
    if (!staleCommit.ok || staleCommit.value) throw Error('An expired owner committed after a newer attempt was reserved.');
    const deleted = await m.deleteImportCheckpoint(indexedDB, id);
    if (!deleted.ok) throw Error(deleted.error);
    const recreated = await m.createImportCheckpoint({
      source: { digest: 'reload-digest', filename: 'reload.txt', mediaType: 'text/plain', byteLength: 5 },
      scope: 'complete', categories: ['characters'], instruction: '',
      provider: { connectionId: 'gemini-managed', modelId: 'synthetic-model', reasoningLevel: 'default' },
      complete: true, maxCalls: 12, maxInputTokens: 8000, envelopeReserveTokens: 1500,
      totalCharacters: 5, chunks: [{ id: 'chunk-1', index: 0, start: 0, end: 5 }],
    });
    const savedAgain = await m.saveImportCheckpoint(indexedDB, recreated);
    if (!savedAgain.ok || recreated.id !== id || recreated.incarnationId === incarnationId) throw Error('Delete/recreate did not issue a new checkpoint incarnation.');
    const staleAfterRecreate = await m.commitImportSegmentAttempt(indexedDB, {
      checkpointId: id, incarnationId: explicitRetry.value.incarnationId, segmentId: 'chunk-1',
      attemptId: explicitRetry.value.segments[0].attemptId, ownerId: 'tab-b',
    }, segment => { segment.status = 'complete'; });
    if (!staleAfterRecreate.ok || staleAfterRecreate.value) throw Error('A prior incarnation committed to a recreated checkpoint.');
    await m.deleteImportCheckpoint(indexedDB, id);
    database.close();
    return { reload: true, liveOwnerProtected: true, explicitRetryCharged: true, staleAttemptsFenced: true, recreatedIncarnationFenced: true };
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
echo "IMPORT_CHECKPOINT_BROWSER_PASS: cross-tab ownership, stale-attempt fencing, retry budget, retention and storage failure"
