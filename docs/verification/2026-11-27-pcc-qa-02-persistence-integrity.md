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
- The existing-ID timestamp was verified to remain `4321` in the regression fixture. The correction supplies migration projection time from finite raw `updatedAt`, else finite raw `createdAt`, else the migration's existing `now`. This makes generated metadata stable for repeated migration of the same raw payload while leaving normal non-migration projections on their default current clock.
- Re-running the exact focused regression passes. After a save, derived ID/timestamp pairs remain stable across reread and the raw record is changed only by the intended durable save.

## Browser UI observations

**PASS — ordinary page reload and same-profile two-tab behavior. NOT TESTED — fresh browser process. DEFERRED — native Electron restart.**

- Alpha: created through the UI, wrote `Alpha manuscript line — synthetic QA02.`, observed `Saved · r2`, performed Undo then Redo (durable revision indicator advanced to r4), and reloaded the page. The exact six-word manuscript text and undo history controls were restored.
- Beta: created separately, wrote `Beta manuscript line — synthetic QA02.`, and observed `Saved · r2`. A reload restored the same Beta text. Switching to Alpha restored Alpha's distinct text; switching back restored Beta. Story Bible Genre was edited to a synthetic value, then undone (empty value) and redone; the value survived reload and revision indicators advanced. No cross-project content appeared in the other project.
- Multi-tab check used two actual tabs in the same isolated in-app browser profile, not simulated concurrency. Tab 2 loaded Beta at r7. Tab 1 committed a synthetic Genre edit at r8. Tab 2 then displayed a storage-conflict alert identifying stored revision 8 versus local revision 7 and offered Reload Latest, Keep My Version (Overwrite), export and dismiss. Only Reload Latest was selected. Tab 2 loaded the r8 value. No overwrite was exercised.
- This was an ordinary page reload and an in-profile second tab, not a browser process restart. No installed or packaged Electron app was launched or rebuilt.

## Deterministic storage, lifecycle and recovery coverage

**PASS — existing targeted regression suites.** These are deterministic fake-storage and transaction tests, not real multi-tab browser observations except where explicitly described above.

- Existing suites cover stale and same-revision divergent writes, delayed saves after newer commits, explicit reload/conflict behavior, tombstones and delayed deletion writes, undo/redo history after reload, localStorage cache fallback/reconciliation, unavailable IndexedDB, localStorage quota failures, and project/cache isolation. The storage lifecycle tests include a simulated full browser-process restart after deletion when IndexedDB deletion fails and localStorage is near quota; this is a test simulation, not an observed browser process restart.
- Decision projection tests cover duplicate suppression and preserving same-ID entries; narrative persistence/recovery tests cover the separate narrative schema and backup/revision recovery. Independent remediation tests cover duplicate intent, stale revision and cross-project admission boundaries.
- The targeted suites were run before the fix at 71 passed, 0 failed. The new regression first failed as intended (`saved.saved` was false with the spurious observed-base conflict); after correction, all six targeted files passed.
- Same-revision metadata-only updates and the accepted AI-04 exact-base synchronization checkpoint remain under existing regression coverage in the targeted storage and narrative suites; no checkpoint behavior was changed.

## Changes

- `lib/decisionInboxProjection.ts`: allow callers to provide a stable projection clock while preserving the default clock for existing normal callers.
- `lib/storage/migration.ts`: derive migrated decision projection time from the raw record's stable timestamps, with migration clock fallback.
- `tests/storageLifecycle.test.ts`: add a RED/GREEN regression that checks preserved same-ID timestamps, unchanged raw record on read, valid expected-base CAS save, and stable derived decision timestamps after commit/reread.
- No unrelated product refactor, schema change, backup format change or macOS build was performed.

## Verification commands and results

- `node_modules/.bin/tsx --test --test-name-pattern='decisions derived while migrating' tests/storageLifecycle.test.ts` — **1 passed, 0 failed** after the fix. Before the fix this same test failed at the intended save assertion due to the false CAS conflict.
- `node_modules/.bin/tsx --test tests/storageLifecycle.test.ts tests/narrativePersistence.test.ts tests/narrativeRecovery.test.ts tests/decisionInboxProjection.test.ts tests/narrativeImportPersistence.test.ts tests/independentAuditRemediation.test.ts` — **72 passed, 0 failed**.
- `npm run typecheck` — **passed** (`tsc --noEmit`).
- `npm run lint` — **passed** (`eslint .`).
- UI qualification: **PASS** for the two synthetic projects' save/reload, manuscript Undo/Redo, Story Bible edit Undo/Redo, project switching/isolation, and actual same-profile two-tab stale-revision alert plus safe reload resolution.

## Status by required category

- **PASS:** targeted tests, typecheck, lint, synthetic UI saves/reloads, UI undo/redo, project separation, actual two-tab conflict alert and reload-latest resolution, same-ID timestamp preservation, stable migration metadata after correction.
- **FAIL (reproduced, corrected):** migration-derived `createdAt` instability caused a false expected-base CAS conflict for a legitimate save from an unchanged raw schema-3 record.
- **NOT REPRODUCED:** raw IndexedDB mutation merely from reading/migrating; loss of an existing same-ID decision timestamp; semantic dirty-state or exact-base digest instability from `createdAt` alone; cross-project content mixing in the exercised UI path.
- **NOT TESTED:** direct raw IndexedDB inspection in the UI browser profile; browser process restart with a persistent profile; localStorage cache manually removed/staled in the UI; user-visible storage-quota/authoritative-write failure in the UI. Existing deterministic tests cover corresponding storage fault paths.
- **DEFERRED:** native packaged Electron restart/qualification and macOS rebuild, as required by scope.

## Final state

- Starting HEAD: `dfe5133ee37153ac8c893bf9f4537611bb4bbfb8`.
- Final implementation HEAD (product source and regression test): `8a2c244` (`fix(storage): stabilize migrated decision timestamps`). The evidence-report-only follow-up commit is the branch tip after this implementation commit.
- PR #23 remains open, draft and unmerged. Await independent review before beginning MAC qualification.
