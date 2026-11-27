# PCC-QA-02 — Persistence, Undo/Redo and Project Isolation

**Result:** PASS for the verified synthetic and deterministic regression scope, with the browser-process and packaged-app limits below. One reproducible CAS availability defect was corrected. PR #23 remains open, draft and unmerged.

## Scope, base and isolation

- Qualification started from remote PR branch `fix/macos-real-use-recovery-20261127` at `dfe5133ee37153ac8c893bf9f4537611bb4bbfb8` in a separate clean worktree: `/Users/yusuf/.codex/worktrees/pcc-qa02-persistence-20261127`.
- The primary checkout and the pre-existing dirty recovery worktree were left untouched. The recovery worktree's qualification-server modifications and `graft/` output were not incorporated.
- Browser UI work used a separate in-app browser profile and local server at `127.0.0.1:4312`; ports 4311 and 4319 were not used. Only synthetic projects `QA02 Browser Alpha` and `QA02 Browser Beta` were created. No generation or provider operation was started; provider controls showed the provider was unconfigured and disabled.
- The UI evaluation surface did not expose `indexedDB`, `localStorage` or `sessionStorage` globals, so direct raw IndexedDB inspection in that browser profile was not possible. Browser UI evidence below is therefore reported as app-visible save/reload behavior, not as a raw IndexedDB read. The focused fake-IndexedDB regression test inspects the stored raw record directly.

## Decision Inbox migration timestamp investigation

**PASS after correction; defect reproduced before correction.**

- QA-01's evidence normalized `snapshot.decisions[].createdAt`, so it did not preserve the raw decision ID/timestamp list needed to identify whether that exact decision had been persisted or newly derived.
- Source inspection showed that same-ID decisions keep their existing `createdAt`; newly derived decisions use the projection clock. Snapshot migration always rebuilds derived decisions. The project schema is version 3; narrative data has its separate version 4.
- A deterministic synthetic reproduction seeded a schema-3 raw record with one persisted decision and other decisions derived from canonical data. Repeated migration of the unchanged raw record gave the newly derived, stable-ID decision a different `createdAt`. The raw fake-IndexedDB record did not change. Semantic snapshot equality and the exact-base snapshot digest remained stable, while the whole-project intent fingerprint differed.
- With the first migrated project as `expectedBaseProject`, a subsequent save against that still-unchanged raw record falsely failed CAS with “The observed project changed in storage…”. This blocked a legitimate save; it did not overwrite data. Thus the timestamp was excluded from dirty semantic comparison and the exact-base digest, but its instability affected whole-project intent fingerprints and CAS base equality. It did not advance a content revision or rewrite raw history merely by reading.
- The existing-ID timestamp was verified to remain exactly `4321` in the regression fixture. A separately added schema-3/schema-4 test with no finite timestamp anywhere first failed: repeated migrations generated different timestamps and different fingerprints. Invalid existing decision `createdAt` also remained NaN before the projection fallback was hardened.
- Final migration time is selected deterministically from the first finite raw timestamp in this order: project `updatedAt`, project `createdAt`, revision timestamps, Story Bible entry timestamps, then existing decision timestamps. If none is valid, it uses `0` as an explicit deterministic fallback. Missing/non-finite project, Story Bible, revision and projected decision timestamps use this selected value. Finite existing same-ID decision timestamps remain unchanged. Normal authoring retains current-time behavior.
- New schema-3 and schema-4 regressions compare exact decision `(id, createdAt)` values and whole-project `intentOperationFingerprint` across repeated migrations. They also seed fake IndexedDB and verify an expected-base durable save succeeds for both schemas. No timestamp normalization is applied to these assertions; the raw input object is checked unchanged.
- A separate authoring test advances the clock and verifies newly projected decisions receive the two distinct current authoring times. The migration-save test then makes a second stale writer attempt and confirms that the genuine concurrent conflict is still rejected while the winning durable content remains intact.
- Decision timestamps are not used as content-revision history, and the Decision Inbox panel does not sort by `createdAt`. The `0` fallback represents unknown historical time and would sort earliest if a downstream consumer applies chronological ordering; it is not an assertion that the decision was authored in 1970.

## Browser UI observations

**PASS — ordinary page reload and same-profile two-tab behavior. NOT TESTED — fresh browser process. DEFERRED — native Electron restart.**

- Alpha: created through the UI, wrote `Alpha manuscript line — synthetic QA02.`, observed `Saved · r2`, performed Undo then Redo (durable revision indicator advanced to r4), and reloaded the page. The exact six-word manuscript text and undo history controls were restored.
- Beta: created separately, wrote `Beta manuscript line — synthetic QA02.`, and observed `Saved · r2`. A reload restored the same Beta text. Switching to Alpha restored Alpha's distinct text; switching back restored Beta. Story Bible Genre was edited to a synthetic value, then undone (empty value) and redone; the value survived reload and revision indicators advanced. No cross-project content appeared in the other project.
- Multi-tab check used two actual tabs in the same isolated in-app browser profile, not simulated concurrency. Tab 2 loaded Beta at r7. Tab 1 committed a synthetic Genre edit at r8. Tab 2 then displayed a storage-conflict alert identifying stored revision 8 versus local revision 7 and offered Reload Latest, Keep My Version (Overwrite), export and dismiss. Only Reload Latest was selected. Tab 2 loaded the r8 value. No overwrite was exercised.
- After the final migration-source changes, a fresh tab on the same isolated test profile loaded the synthetic Beta project as `Saved · r8`; provider generation controls remained disabled. This was a UI startup smoke check, not a browser-process restart.
- This was an ordinary page reload and an in-profile second tab, not a browser process restart. No installed or packaged Electron app was launched or rebuilt.

## Deterministic storage, lifecycle and recovery coverage

**PASS — existing targeted regression suites.** These are deterministic fake-storage and transaction tests, not real multi-tab browser observations except where explicitly described above.

- Existing suites cover stale and same-revision divergent writes, delayed saves after newer commits, explicit reload/conflict behavior, tombstones and delayed deletion writes, undo/redo history after reload, localStorage cache fallback/reconciliation, unavailable IndexedDB, localStorage quota failures, and project/cache isolation. The storage lifecycle tests include a simulated full browser-process restart after deletion when IndexedDB deletion fails and localStorage is near quota; this is a test simulation, not an observed browser process restart.
- Selected-project deletion and tombstone non-resurrection are covered by the existing deterministic storage lifecycle and IA-11 deletion regressions. The UI Projects hub exposed open/continue actions but no delete control during this run, so deletion was not exercised through the browser UI.
- Decision projection tests cover duplicate suppression and preserving same-ID entries; narrative persistence/recovery tests cover the separate narrative schema and backup/revision recovery. Independent remediation tests cover duplicate intent, stale revision and cross-project admission boundaries.
- The targeted suites were run before the fix at 71 passed, 0 failed. The new regression first failed as intended (`saved.saved` was false with the spurious observed-base conflict); after correction, all six targeted files passed.
- Same-revision metadata-only updates and the accepted AI-04 exact-base synchronization checkpoint remain under existing regression coverage in the targeted storage and narrative suites; no checkpoint behavior was changed.

## Changes

- `lib/decisionInboxProjection.ts`: allow callers to provide a stable projection clock, preserve finite existing decision timestamps, and use the supplied clock for missing/non-finite prior timestamps; normal callers retain the default clock.
- `lib/storage/migration.ts`: resolve a deterministic migration timestamp from finite raw timestamp fields (or `0` when none exists); use it for migrated decisions, project dates, missing/invalid Story Bible dates and revision dates.
- `tests/storageLifecycle.test.ts` and `tests/decisionInboxProjection.test.ts`: add RED/GREEN checks for schema-3/schema-4 repeated migration timestamps and CAS fingerprints, no raw-input mutation, valid existing timestamp preservation, deterministic missing/invalid timestamp fallback, normal authoring clock semantics, expected-base saves in both schemas, and genuine stale-writer rejection.
- No unrelated product refactor, schema change, backup format change or macOS build was performed.

## Verification commands and results

- `node_modules/.bin/tsx --test --test-name-pattern='decisions derived while migrating|identical schema 3 and 4 records with missing or invalid timestamps|current authoring clock' tests/storageLifecycle.test.ts tests/decisionInboxProjection.test.ts` — **3 passed, 0 failed**. The first timestamp regression failed before its source correction; the fallback/fingerprint regression also failed before deterministic migration fallback was implemented.
- `node_modules/.bin/tsx --test tests/storageLifecycle.test.ts tests/narrativePersistence.test.ts tests/narrativeRecovery.test.ts tests/decisionInboxProjection.test.ts tests/narrativeImportPersistence.test.ts tests/independentAuditRemediation.test.ts` — **74 passed, 0 failed**.
- `npm run typecheck` — **passed** (`tsc --noEmit`).
- `npm run lint` — **passed** (`eslint .`).
- UI qualification: **PASS** for the two synthetic projects' save/reload, manuscript Undo/Redo, Story Bible edit Undo/Redo, project switching/isolation, and actual same-profile two-tab stale-revision alert plus safe reload resolution.

## Status by required category

- **PASS:** targeted tests, typecheck, lint, synthetic UI saves/reloads, UI undo/redo, project separation, actual two-tab conflict alert and reload-latest resolution, schema-3/schema-4 repeated migration timestamp and fingerprint equality, finite existing timestamp preservation, deterministic fallback for missing/non-finite timestamps, normal authoring timestamps, and genuine CAS conflict retention.
- **FAIL (reproduced, corrected):** migration-derived `createdAt` instability caused a false expected-base CAS conflict for a legitimate save from an unchanged raw schema-3 record.
- **NOT REPRODUCED:** raw IndexedDB mutation merely from reading/migrating; loss of an existing same-ID decision timestamp; semantic dirty-state or exact-base digest instability from `createdAt` alone; cross-project content mixing in the exercised UI path.
- **NOT TESTED:** direct raw IndexedDB inspection in the UI browser profile; browser process restart with a persistent profile; localStorage cache manually removed/staled in the UI; user-visible storage-quota/authoritative-write failure and selected-project deletion through the UI. Existing deterministic tests cover the corresponding storage/deletion fault paths.
- **DEFERRED:** native packaged Electron restart/qualification and macOS rebuild, as required by scope.

## Final state

- Starting HEAD: `dfe5133ee37153ac8c893bf9f4537611bb4bbfb8`.
- Final implementation HEAD (product source and regression tests): `8f534f3a7adf2816a362868c8a6ffd8d0f9a1bd4` (`fix(storage): make legacy migration timestamps deterministic`). This evidence report is included in a docs-only commit after it; the current PR tip is confirmed in the closeout.
- PR #23 remains open, draft and unmerged. Await independent review before beginning MAC qualification.
