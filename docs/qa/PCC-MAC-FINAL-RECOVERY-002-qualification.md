# PCC-MAC-FINAL-RECOVERY-002 — Qualification report

**Disposition: partially qualified; not release-ready.** Source regression checks and the scoped Story eligibility fix pass. Several packaged GUI and persistence scenarios remain unverified. This report covers the isolated recovery worktree only and does not certify the installed owner app, provider receipt, billing, or release readiness.

## Executive summary

The original eight audit screenshots, reviewed by ChatGPT, support D01, D03 and D05 as visible UI observations. They do not establish upstream inference receipt or billing. The additional Plan screenshot shows the top and bottom **Generate Story** controls enabled while **Generate Story from Confirmed Plan** is disabled for the same ChatGPT model/reasoning selection.

The UI mismatch was reproduced against the packaged macOS application with a synthetic project. Before the fix, the top Story CTA ignored the operation block reason; the Confirmed Plan CTA already consumed it, and the workspace footer CTA also lacked the Story block gate. The top CTA now uses the same Story eligibility and explanation as the other two. The focused UI test failed before the fix and passes after it. A rebuilt packaged app was then opened with an isolated profile; a fresh accessibility-tree observation showed all three Story entry points disabled with the same GPT-6 Luna / Default reasoning explanation. No Story action was submitted and no live provider request was made.

The screenshot attached in this Codex conversation (`Proactive Co-Creator Appshot 2026-11-27T09-34-28.571Z.png`) is the before-fix evidence: it shows the three control states described above. It is not available as a local file in this worktree, so it is referenced as user-provided evidence rather than copied into the PR. The two earlier locally named screenshots were mistakenly captured from Brave and have been removed; neither is used as evidence.

## Findings and disposition

| Check | Result | Evidence and limits |
|---|---|---|
| D01 | Screenshot-supported | Original eight screenshots reviewed by ChatGPT. No inference about hidden transport. |
| D02 | Partial | Settings and provider UI were observed in isolated app sessions. Reopen retained the selected ChatGPT Luna / Medium preference in the first session. Restarted candidate profile reported ChatGPT connected but its catalog was stale/unavailable; exact preference/session restoration across restart is not established. |
| D03 | Screenshot-supported | Screenshots show the observed spinner/TLS-related symptom. They do not prove provider receipt or billing. No live inference was requested in this qualification. |
| D04 | Partial | Long synthetic seed scrolling was exercised, but the seed exceeded the app's 8,000-character compiled prompt limit. Full in-limit editing, resize and wheel behavior are not qualified. |
| D05 | Screenshot-supported / partial GUI | Original screenshots support the visible finding. Review/local checks were visited; unsupported AI diagnostics and sync were visibly gated. Full Review workspace traversal is incomplete. |
| NAV01 | Partial | Plan, Story Bible, checks/history, target panel and Review shortcut were observed. Timeline, mind map, Ideas, Opportunities and all navigation branches were not exhaustively qualified. |
| Plan Story entry points | Fixed and packaged UI verified | Before-fix screenshot shows enabled top/footer and blocked Confirmed Plan actions. Current packaged UI AX state shows all three disabled with identical reason. No button was activated. |
| Project persistence | Partial pass | Synthetic project creation/edit/save, internal backup preview and restore-as-copy preserved the tested manuscript content and revision. Import/export download, undo/redo and broad entity editing remain unqualified. |
| SafeStorage | Synthetic pass | Electron safeStorage round-trip used only a generated marker credential; encrypted bytes omitted the plaintext marker and had mode 0600. No real owner token was read. This does not prove restoration of the owner's actual ChatGPT credentials. |
| Provider workflows | Mock/local only | Source tests use synthetic fixtures/intercepted transport. No new live provider requests were made. Per-operation override, credential-change and asynchronous refresh-order matrices were not fully exercised in the GUI. A possible async refresh race was not reproduced and was not changed. |

## F4 scope and request admission

The operation-level resolver considers Provider Hub status, field-wise preference resolution, connection state, selected model, reasoning capability and operation capability. It returns operation-specific availability and explanation to the UI; route admission independently enforces the supported operation before any provider transport. This work did not expand provider authorization. The qualified live scope remains ChatGPT Story on GPT-6 Luna with Default reasoning only; this qualification issued no live provider request and made no claim about upstream inference or billing.

For the additional Plan discrepancy, the top action, workspace footer action and Confirmed Plan action now consume the same Story eligibility result and block message. The regression test specifically locates each action and checks its own disabled state. A mocked client-transport test ensures a blocked operation does not issue transport; a separate injected route test verifies server-side rejection. These are synthetic test results, not evidence of hosted or provider-side behavior.

## Additional qualification evidence

- `npm run typecheck` — passed.
- `npm run lint` — passed.
- `npm test` — 579/579 passed.
- Focused `npm exec tsx -- --test tests/planStoryEligibility.test.ts` — 2/2 passed after the fix. The pre-fix focused UI test failed on the top action as expected.
- `npm run desktop:build` — passed after the source fix. Existing Vite large-chunk, duplicate dependency, missing package metadata/default icon, and skipped ad-hoc code-signing notices remain.
- Earlier key-free production-server browser smoke at `http://127.0.0.1:4323` passed E2E-A through E2E-I with no provider request. This predates the final UI-only fix.
- SafeStorage synthetic harness with Electron 45.5.0 — available; encrypted round-trip passed, plaintext marker absent, file mode 0600. Electron reports that synchronous safeStorage methods are deprecated.
- The app candidate was launched from the isolated recovery worktree at `release/mac-arm64/Proactive Co-Creator.app`; isolated runtime profiles were used. The owner installation was not replaced. Screenshots from the app window were observed through CUA; because macOS screen capture repeatedly foregrounded Brave rather than the app, no unambiguous local after-fix PNG is included here. The current AX-tree evidence is recorded above.

### Six-cycle final review

1. Rechecked request scope and exact base commit; preserved Story-only ChatGPT authorization and the GPT-6 Luna / Default limit.
2. Reproduced the entry-point mismatch against the isolated packaged UI.
3. Confirmed the focused UI test failed on the top control before the fix.
4. Applied the smallest UI gate change and strengthened the per-control assertion.
5. Rebuilt and checked the packaged app; all three Story controls reported disabled with one explanation.
6. Re-ran focused and full test/type/lint checks. Remaining persistence, navigation and override scenarios are marked partial rather than inferred as passed.

## npm advisory classification

The six moderate `npm audit` rows refer to the same minimatch advisory (GHSA-g3hv-75wg-m249 / CVE-2026-118764), not six independent vulnerabilities. The affected transitive ranges reported are `minimatch@9.0.9` through `@electron/universal@2.0.3`, and `minimatch@10.2.6` through `app-builder-lib@26.18.0` (also reached via dmg-builder/electron-builder/electron-builder-squirrel-windows 26.18.0). These are development/build-time packaging dependencies; no direct runtime import or user-controlled minimatch pattern was identified in the audited application source. The described risk is denial of service from crafted glob patterns if an affected function processes attacker-controlled patterns. No such runtime input path was found in this review. The suggested automatic fix would change/downgrade the builder dependency graph; no broad upgrade or `npm audit fix` was performed. The advisory remains for normal dependency maintenance.

## Gatekeeper, signing and installation

Read-only `spctl --status` reported assessment disabled; `csrutil status` reported System Integrity Protection disabled. Neither setting was changed in this task. The candidate bundle has identifier `Electron`, an ad-hoc signature and no Developer ID TeamIdentifier; notarization and normal Gatekeeper acceptance were not established. Therefore this artifact is qualified only for the isolated local test setup used here. A supported end-user installation procedure is not established until a Developer ID signed and notarized artifact and its install/first-launch path are separately qualified. No security protection should be disabled to install it.

## CI and package provenance

PR #23 targets `feat/macos-desktop-app`; `.github/workflows/ci.yml` currently runs automatically for pull requests targeting `main`. No hosted CI qualification is therefore available for this PR. CI configuration was not modified and the PR was not retargeted or merged to obtain a green check.

The isolated package was built after the UI source fix from recovery branch source based on `e4cb8d86b07fe56289d0039a7930e54ff9c86850`. The prior source commit `3bcb477794520289a33c0e94e91c86e1578a2085` differs by documentation/evidence; no rebuild was performed for this report-only update.

- App: `release/mac-arm64/Proactive Co-Creator.app`
- DMG: `release/Proactive Co-Creator.dmg`
- `app.asar` SHA-256: `6203006c110f2d33ddbc44ef6c2e74bd348ae5c7ff3b452fb181b73c312253f5`
- DMG SHA-256: `133a116d30eedcf72fd75f80bc5ce2436ec60970653c057808205a4d0dae91e1`
- Existing isolated Write screenshot: [01-isolated-packaged-write.png](evidence/pcc-mac-final-recovery-002/01-isolated-packaged-write.png), SHA-256 `690a6657dd99fdcef33e20b1440e4190ae0977fdbc08c9525da3b725642dd164`.

## Release boundary

The evidence is not sufficient for release sign-off. Remaining practical work includes complete D04/NAV01 and Review traversal; clean isolated restart verification of saved model preferences; import/export and broader synthetic edit/undo/redo workflows; and a controlled UI matrix for operation overrides, stale status, credential changes and async refresh ordering. A supported signed/notarized installer and hosted CI result are also absent. No merge, deployment, installation replacement, provider authorization expansion or live inference was performed.
