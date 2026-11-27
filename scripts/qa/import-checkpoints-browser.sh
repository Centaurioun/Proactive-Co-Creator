#!/usr/bin/env bash
set -euo pipefail

BASE_URL="${E2E_BASE_URL:-http://127.0.0.1:3000}"
SESSION="pcc-checkpoints-$$"

if ! command -v playwright-cli >/dev/null 2>&1; then
  echo "playwright-cli not found on PATH" >&2
  exit 1
fi
HEALTH_JSON="$(curl -sf "$BASE_URL/api/health" || true)"
if [ -z "$HEALTH_JSON" ]; then
  echo "Checkpoint browser test server is not healthy at $BASE_URL" >&2
  exit 1
fi
if ! printf '%s' "$HEALTH_JSON" | grep -q '"configured":false'; then
  echo "Checkpoint browser test server must report configured:false at $BASE_URL" >&2
  exit 1
fi
trap 'playwright-cli -s="$SESSION" close >/dev/null 2>&1 || true' EXIT
playwright-cli -s="$SESSION" open "$BASE_URL" >/dev/null

read -r -d '' PLAYWRIGHT_FN <<'EOF' || true
async (page) => {
  const baseUrl = new URL(page.url()).origin;
  const peer = await page.context().newPage();
  await peer.goto(baseUrl);
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
    const ownerId = crypto.randomUUID();
    const reserved = await m.reserveImportSegmentAttempt(indexedDB, cp.id, 'chunk-1', ownerId, false, 250);
    const resetBudget = await m.saveImportCheckpoint(indexedDB, await m.createImportCheckpoint({
      source: { digest: 'reload-digest', filename: 'reload.txt', mediaType: 'text/plain', byteLength: 5 },
      scope: 'complete', categories: ['characters'], instruction: '',
      provider: { connectionId: 'gemini-managed', modelId: 'synthetic-model', reasoningLevel: 'default' },
      complete: true, maxCalls: 12, maxInputTokens: 8000, envelopeReserveTokens: 1500,
      totalCharacters: 5, chunks: [{ id: 'chunk-1', index: 0, start: 0, end: 5 }],
    }));
    if (!reserved.ok || resetBudget.ok || reserved.value.budget.callsUsed !== 1) throw Error('Atomic reservation or budget reset protection failed.');
    return { id: cp.id, incarnationId: cp.incarnationId, attemptId: reserved.value.segments[0].attemptId, ownerId };
  });
  const liveOwnerBlocked = await peer.evaluate(async ({ id }) => {
    const m = await import('/lib/narrative/import/analysisCheckpoints.ts');
    const listed = await m.listImportCheckpoints(indexedDB);
    if (!listed.ok || !listed.value.some(item => item.id === id && item.segments[0].status === 'in-flight')) throw Error('Peer page did not see the live IndexedDB lease.');
    const duplicate = await m.reserveImportSegmentAttempt(indexedDB, id, 'chunk-1', crypto.randomUUID());
    return !duplicate.ok;
  }, firstId);
  if (!liveOwnerBlocked) throw Error('Second same-context page took over a live lease.');
  await new Promise(resolve => setTimeout(resolve, 300));
  const expiryResult = await page.evaluate(async ({ id, incarnationId, attemptId, ownerId }) => {
    const m = await import('/lib/narrative/import/analysisCheckpoints.ts');
    let listed = await m.listImportCheckpoints(indexedDB);
    let checkpoint = listed.ok && listed.value.find(item => item.id === id);
    if (!checkpoint || checkpoint.segments[0].status !== 'in-flight' || checkpoint.budget.callsUsed !== 1) throw Error('Reload did not preserve in-flight uncertainty and charged budget.');
    const expiredRenewal = await m.renewImportSegmentAttempt(indexedDB, { checkpointId: id, incarnationId, segmentId: 'chunk-1', attemptId, ownerId });
    const expiredOwnerCommit = await m.commitImportSegmentAttempt(indexedDB, { checkpointId: id, incarnationId, segmentId: 'chunk-1', attemptId, ownerId }, segment => { segment.status = 'complete'; });
    if (!expiredRenewal.ok || expiredRenewal.value || !expiredOwnerCommit.ok || expiredOwnerCommit.value) throw Error('Expired owner renewed or committed before reclamation.');
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
    database.close();
    return { expiredMarkedUncertain: true };
  }, firstId);
  const reclaimed = await peer.evaluate(async ({ id }) => {
    const m = await import('/lib/narrative/import/analysisCheckpoints.ts');
    const ownerId = crypto.randomUUID();
    const retry = await m.reserveImportSegmentAttempt(indexedDB, id, 'chunk-1', ownerId, true, 30000);
    if (!retry.ok || retry.value.budget.callsUsed !== 2) throw Error('Retry was not explicit or budget was reset.');
    return { incarnationId: retry.value.incarnationId, attemptId: retry.value.segments[0].attemptId, ownerId };
  }, firstId);
  const staleCommit = await page.evaluate(async ({ id, incarnationId, attemptId, ownerId }) => {
    const m = await import('/lib/narrative/import/analysisCheckpoints.ts');
    const stale = await m.commitImportSegmentAttempt(indexedDB, { checkpointId: id, incarnationId, segmentId: 'chunk-1', attemptId, ownerId }, segment => { segment.status = 'complete'; segment.result = { findings: [], entities: [], relationships: [], ambiguities: [], rejectedEvidenceCount: 0 }; });
    if (!stale.ok || stale.value) throw Error('Prior owner committed after lease reclamation.');
    return true;
  }, firstId);
  const reclaimedCommit = await peer.evaluate(async ({ id, incarnationId, attemptId, ownerId }) => {
    const m = await import('/lib/narrative/import/analysisCheckpoints.ts');
    const checkpoint = (await m.getImportCheckpoint(indexedDB, id)).value;
    const candidate = structuredClone(checkpoint);
    candidate.segments[0].status = 'complete';
    candidate.segments[0].result = { findings: [], entities: [], relationships: [], ambiguities: [], rejectedEvidenceCount: 0 };
    candidate.coverage.complete = true;
    candidate.coverage.processedCharacters = candidate.coverage.totalCharacters;
    delete candidate.segments[0].ownerId;
    delete candidate.segments[0].leaseExpiresAt;
    if (!m.validateCheckpoint(candidate)) throw Error(`Synthetic completion fixture is invalid: ${JSON.stringify(candidate.segments[0])}`);
    const result = await m.commitImportSegmentAttempt(indexedDB, { checkpointId: id, incarnationId, segmentId: 'chunk-1', attemptId, ownerId }, (segment, checkpoint) => { segment.status = 'complete'; segment.result = { findings: [], entities: [], relationships: [], ambiguities: [], rejectedEvidenceCount: 0 }; checkpoint.coverage.complete = true; checkpoint.coverage.processedCharacters = checkpoint.coverage.totalCharacters; });
    if (!result.ok || !result.value) throw Error(`Reclaimed live owner could not commit: ${JSON.stringify(result)}`);
    return true;
  }, { ...firstId, ...reclaimed });
  const checkpointComplete = await page.evaluate(async ({ id }) => {
    const m = await import('/lib/narrative/import/analysisCheckpoints.ts');
    const listed = await m.listImportCheckpoints(indexedDB);
    return listed.ok && listed.value.find(item => item.id === id)?.segments[0]?.status === 'complete';
  }, firstId);
  if (!checkpointComplete) throw Error('Completion was not durable in the shared IndexedDB.');
  const concurrencyEvidence = { twoPagesSameContext: true, liveOwnerBlocked, expiredRenewalBlocked: true, expiredCommitBlocked: true, reclaimed: true, staleCompletionRejected: staleCommit, reclaimedOwnerCommitted: reclaimedCommit, completionDurable: checkpointComplete };
  const recreatedFence = await peer.evaluate(async ({ id, incarnationId, attemptId, ownerId }) => {
    const m = await import('/lib/narrative/import/analysisCheckpoints.ts');
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
    const staleAfterRecreate = await m.commitImportSegmentAttempt(indexedDB, { checkpointId: id, incarnationId, segmentId: 'chunk-1', attemptId, ownerId }, segment => { segment.status = 'complete'; });
    if (!staleAfterRecreate.ok || staleAfterRecreate.value) throw Error('A prior incarnation committed to a recreated checkpoint.');
    await m.deleteImportCheckpoint(indexedDB, id);
    return true;
  }, { ...firstId, ...reclaimed });
  await peer.close();
  const reloadResult = { reload: true, ...concurrencyEvidence, recreatedIncarnationFenced: recreatedFence };

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
