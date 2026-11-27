# PCC-MAC-FINAL Integrated macOS Qualification

Date: 2026-11-27 (Europe/Istanbul)

## Verdict

**PARTIALLY QUALIFIED — LIMITATIONS REMAIN**

The arm64 Electron candidate launched from the produced bundle in isolated profiles. Synthetic writing, durable persistence, Undo/Redo, project switching, backup restore-as-copy, and confirmed deletion with tombstone survival across restart were observed. The candidate is unsigned and not notarized; several supplied E2E suites remain failing or incompatible with their harness assumptions. This is local acceptance evidence only, not distribution readiness.

## Provenance

- Repository: `Centaurioun/Proactive-Co-Creator`, PR #23, branch `fix/macos-real-use-recovery-20261127`.
- Starting source HEAD: `72c720e3b3b7e855f8cb9a7e118639fd13d1e46c` (tree `10b66aec10bdcf84b68480c254cc75183c952b5fa`).
- Final product-source HEAD: `2cd66142c5f88a7ef9a3b1fe51c074df71d7744b` (tree `a68c0cb8e352952569d4dd26d7b8edbf50f4c56b`). This is the exact source used for the final build and CI run.
- Qualification worktree: `/Users/yusuf/.codex/worktrees/pcc-mac-final-qualification-20261127`.
- Node `v26.12.1`, npm `11.20.0`; macOS `27.0.1` (build `26A434`), arm64.
- `package-lock.json` SHA-256: `a84e162321b23fa74524e34aa10a57556a17e21e11ef86580c0efb0b01ba738c` (unchanged).
- PR metadata was OPEN, DRAFT, UNMERGED at the start. Final PR metadata is recorded after the evidence commit is pushed.

## Source change

A reproducible project deletion safety defect was found: the existing Projects UI immediately invoked the established deletion path without asking for confirmation. A wrong click therefore permanently deleted the selected project. A minimal confirmation gate was added around that existing path; cancel does not call deletion, confirmation calls it once. The browser smoke and lifecycle harnesses now acknowledge and assert the real dialog. No deletion mechanism, persistence authority, provider boundary, dependency, or CAS policy was changed.

Test-first evidence: `npx tsx --test tests/projectDeletionConfirmation.test.ts` was RED before the helper existed, then GREEN (2/2) after the smallest correction.

## Verification results

All commands ran in the clean qualification worktree, with synthetic data only.

| Command | Result |
|---|---|
| `npm ci` (exit 0) | PASS; 536 packages installed; lockfile unchanged |
| `npm run typecheck` (exit 0) | PASS |
| `npm run lint` (exit 0) | PASS |
| `npm test` (exit 0) | PASS; 598 tests, 33 suites, 0 failures |
| `npm run build` (exit 0) | PASS; Vite emitted the existing >500 kB chunk warning |
| `npm run desktop:build` (exit 0) | PASS after source correction; arm64 DMG and app bundle produced |
| `git diff --check` (exit 0) | PASS for the scoped source/evidence diff |

### E2E suites

Each supplied harness was inspected before execution. Harnesses used synthetic/local transports; local API health reported `configured:false`; no provider inference or external AI request was made. The suites were run serially against the production server and, where needed, the development server (`NODE_ENV=development PORT=4322 DISABLE_HMR=true npm run dev`).

- `scripts/e2e-browser-smoke.sh`: PASS, cases A–I, including the deletion confirmation case after correction.
- `scripts/e2e-project-lifecycle.sh`: FAIL; the harness could not find expected rendered selectors/confirmation banner in its run. Direct native UI lifecycle and deletion scenarios were separately exercised successfully. This suite is not counted as a pass.
- `scripts/e2e-narrative-workspace.sh`: FAIL; the harness classified provider-hub/status inspection as a paid AI request.
- `scripts/e2e-narrative-import.sh`: FAIL; expected control was disabled in the test scenario.
- `scripts/e2e-narrative-mutations.sh`: FAIL; harness dynamic import of `/lib/canonicalModel.ts` failed.
- `scripts/e2e-ai-review-sync.sh`: FAIL; same production dynamic import limitation; development attempt also failed.
- `scripts/e2e-ai-ownership.sh`: FAIL; harness could not locate expected Review/Plan UI selectors in that run.
- `scripts/e2e-stage2-strict-mode.sh`: FAIL on production by design; it explicitly requires a development server to test StrictMode effect replay. Development rerun still failed its assertion.

These harness failures are retained as failures; manual native observations do not convert them into passing E2E results.

## CI and dependency audit

- Workflow-dispatch run `46024943964` completed successfully for starting SHA `72c720e3b3b7e855f8cb9a7e118639fd13d1e46c`; it does not verify this correction.
- Final candidate run `46028521948` completed successfully for exact SHA `2cd66142c5f88a7ef9a3b1fe51c074df71d7744b`. Node 22.13.0, Node 22.x and Node 24.x verification jobs passed typecheck, lint, tests and production build; the Chromium browser E2E smoke job passed E2E-A through E2E-I and uploaded its results. [Run 46028521948](https://github.com/Centaurioun/Proactive-Co-Creator/actions/runs/46028521948).
- `npm audit --omit=dev` (exit 0): PASS, 0 vulnerabilities in runtime dependencies.
- `npm audit` (exit 1 due reported advisories): 6 moderate findings in the Electron build/development dependency chain, including `minimatch` below `11.0.1` (GHSA-g3hv-75wg-m249) through electron-builder-related packages. No high or critical finding was reported. No broad upgrades or forced audit fixes were applied. These findings affect build tooling; the production-only audit was clean.

## Native candidate and artifact

- App: `/Users/yusuf/.codex/worktrees/pcc-mac-final-qualification-20261127/release/mac-arm64/Proactive Co-Creator.app`
- DMG: `/Users/yusuf/.codex/worktrees/pcc-mac-final-qualification-20261127/release/Proactive Co-Creator.dmg`
- Electron `45.5.0`; electron-builder `26.18.0`; app version `0.0.0`; arm64.
- DMG size: 151,418,814 bytes.
- DMG SHA-256: `62b0a72371d32d61d77ef3f601ba1b9c0f34c359382929dd67a6417f0f2299e1`.
- Packaged `app.asar` SHA-256: `fc13e521257ca506ec3ed1870dcee2d0eb5f3e47b161a2e6ec7007ab49afc76c`.
- Latest DMG was produced by `npm run desktop:build`; its app bundle was verified against the packaged app content. Build emitted metadata/default-icon and duplicate dependency reference warnings in addition to the chunk warning.
- Signing: ad hoc/unsigned (`codesign` reported ad hoc, no team identity). Not notarized. `spctl` reported accepted only with `override=security disabled`; this is not a normal Gatekeeper acceptance result. No signing credentials or OS security settings were used.

## Native synthetic qualification

The actual candidate bundle was launched with separate temporary user-data directories and loopback ports 4323/4324 and 4325/4326. Directories were verified empty before launch. The app process executable and renderer path were under the candidate bundle; native window URL was the matching loopback origin. The owner ports 4311 and 4319 were not used to host the candidate.

| Scenario | Result | Evidence/limits |
|---|---|---|
| Create/edit synthetic manuscript; save | PASS | Alpha content was stored and visible as revisions in the native UI. |
| Undo/Redo; reload | PASS | Content changed and returned as expected; revision count advanced; same isolated profile reopened the content. |
| Canonical model and Story Bible edit | PASS | Synthetic entity `Mira` and Story Bible genre persisted in raw IndexedDB; history contained 7 revisions. |
| Write/Plan/Review navigation | PASS | Manually navigated in the real Electron window. |
| No-AI manual authoring | PASS | Writing remained available; AI actions were visibly unauthorized/disabled. No AI action was invoked. |
| Project switch and unsaved draft | PASS | Draft was persisted as a revision and returned on switch-back; this build auto-saved, so no explicit unsaved-edit guard was shown. |
| Delete confirmation | PASS | On the corrected candidate, Cancel retained Beta; confirming deletion removed only Beta. After quitting and relaunching the candidate in the same isolated profile, Beta remained absent and its ID remained in the tombstone registry. |
| Backup export, preview, restore-as-copy | PASS | Native Save dialog produced a 42 KB JSON backup; preview showed schema/revision; restore created a distinct copy and preserved original. |
| Fresh browser process / native app restart | PASS | Same isolated Electron profile survived actual app quit/relaunch; raw IndexedDB inspected separately from UI projection. |
| Physical trackpad | NOT TESTED | No physical gesture qualification was performed. |
| Real provider session, credential persistence/revocation | DEFERRED | No real sign-in, credential access, token revocation, or inference authorized. Synthetic session unit coverage is not proof of a real session. |

### Raw records versus migrated projections and schema

Raw IndexedDB exports are preserved separately from the screenshot:

- `docs/qa/artifacts/PCC-MAC-FINAL-idb-summary.json` SHA-256 `fd0e029ef5466239f226d6a9a644e40c4c885a1df48598e2a523d4580b6c07a2`: post-fix synthetic Beta deletion profile, two remaining projects, tombstone ID retained.
- `docs/qa/artifacts/PCC-MAC-FINAL-primary-profile-idb.json` SHA-256 `67b8dfa0927f67877d6e32add0b9b512e8a0bcae12a81eeee0cb63f5c8ad8b01`: Alpha and restored copy, both with schema 4, revision 7; Alpha contains the two manuscript section versions, `Mira`, Story Bible genre, and seven revision records. It also retains a tombstone for deleted Beta.
- `docs/qa/artifacts/PCC-MAC-FINAL-native-restart.png` SHA-256 `7347d9bfdb75622c00bd2cdd6e7819f6f8f27e65457425d4daf05f73cf5cdb3a`.

The current implementation uses one project payload `schemaVersion` field: legacy/general project records are schema 3; narrative-enabled records are schema 4. It is not a separate outer narrative schema field. Raw records above were not normalized before inspection. The raw-versus-projection migration tests from QA-02 remain the evidence for deterministic migration behavior; this UI-only fix does not touch migration. No timestamp normalization was used in this qualification.

## Safety incident and remaining limitations

While closing the qualification application, app-name selection resolved to a Proactive Co-Creator window showing `127.0.0.1:4319/` and `Saved · r5`, rather than the isolated candidate. A quit shortcut was sent to that window. Subsequent read-only checks found no listener on 4311 or 4319. The visible saved state suggests no pending edit, but the identity/ownership of that window and any effect of quitting it cannot be proven from the available observation. This operator mistake is disclosed and is a qualification limitation; no further interaction with that window or service was performed. The isolated candidate was then stopped by its exact bundle process PID.

The application candidate is locally launchable but unsigned and unnotarized. E2E harness failures listed above remain unresolved. D01 real authenticated-session qualification, physical trackpad testing, and broader native accessibility evidence remain NOT TESTED/DEFERRED. No app was installed over the owner's copy, no release was published, and PR #23 remains open, draft, and unmerged.

## Final revisions and CI

- Final product-source/build HEAD: `2cd66142c5f88a7ef9a3b1fe51c074df71d7744b`, tree `a68c0cb8e352952569d4dd26d7b8edbf50f4c56b`.
- Final candidate CI SHA: `2cd66142c5f88a7ef9a3b1fe51c074df71d7744b`, run `46028521948`, SUCCESS.
- A documentation-only closure commit records the completed CI result and does not change source or build inputs; its PR tip is reported in the direct handoff.
