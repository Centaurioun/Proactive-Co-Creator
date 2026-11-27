# PCC-MAC-CLOSEOUT — E2E Reconciliation and Final Acceptance Gaps

**Date:** 2026-11-27  
**Repository:** Centaurioun/Proactive-Co-Creator  
**PR:** #23 — remains open, draft, unmerged  
**Starting HEAD:** `ba6034eeb5f6d180800ebd733769a10d88fe434b`  
**Qualification worktree:** `/Users/yusuf/.codex/worktrees/pcc-mac-final-qualification-20261127`  
**Final verdict:** **PARTIALLY QUALIFIED — LIMITATIONS REMAIN**

This closeout reconciles the eight required E2E suites and the explicitly outstanding MAC acceptance gaps. Previously accepted PCC-MAC-FINAL work and its candidate artifact were preserved. No product source or dependency changes were made. The only source-tree edits are narrow synthetic E2E harness corrections; they do not alter production admission, storage, or provider behavior.

## E2E suite reconciliation

All browser suites ran serially against `http://127.0.0.1:4322` using the isolated Chromium harness and synthetic API routes. The server was started with `NODE_ENV=development PORT=4322 DISABLE_HMR=true npm run dev`. No provider inference was sent. Ports 4311 and 4319 and the native app were not touched.

| Suite | Initial observed failure | Classification and correction | Closeout result / invariant |
|---|---|---|---|
| `e2e-browser-smoke.sh` | No failure in this run | Existing harness | **PASS** — E2E-A through E2E-I all reported PASS. |
| `e2e-project-lifecycle.sh` | Every case ran without first navigating its new page to the application; selectors timed out on blank pages. | **HARNESS DEFECT** — added application navigation for each non-backup scenario. The suite still timed out on expected application controls after navigation; unresolved because the test context supplied no useful page body/React error evidence. | **FAIL / UNRESOLVED** — deletion confirmation/tombstone, import append, archive partial restore, backup retry, and write recovery remain unqualified by this harness. No destructive owner data was used. |
| `e2e-narrative-workspace.sh` | The request collector classified three `GET /api/ai/provider-hub/status` reads as paid AI/API calls. | **HARNESS DEFECT** — collector now exempts only exact `GET` reads to `/api/ai/capabilities` and `/api/ai/provider-hub/status`; inference/mutation requests and unexpected methods remain fail-closed. | **PASS** — `NARRATIVE_WORKSPACE_PASS`; content, Unicode, persistence, undo/redo and responsive assertions ran. |
| `e2e-narrative-import.sh` | Analyze button stayed disabled with legacy `{ configured: true }` fixture only. | **HARNESS DEFECT** — added a synthetic current Provider Hub status response with an explicitly available model and `narrative-import` capability. Production admission unchanged. | **PASS** — `passed:true`, 3 mocked extraction calls, 1 cancelled attempt, 2 resumed attempts, exact source and separate project persistence/reload asserted. |
| `e2e-narrative-mutations.sh` | Browser import of `/lib/canonicalModel.ts` failed on the prior server configuration. | **ENVIRONMENT MISMATCH** — reran on the required development server that serves TypeScript modules. | **PASS** — `NARRATIVE_MUTATIONS_PASS`; all four mutation paths completed. |
| `e2e-ai-review-sync.sh` | Same direct TypeScript module import failure. | **ENVIRONMENT MISMATCH** — reran on development server. | **PASS** — `AI04_SYNC_PATCH_PASS`; one model-to-manuscript call, content changed and revision advanced 5→6. |
| `e2e-ai-ownership.sh` | Project/Review/Plan selectors timed out in the previous run. | **UNRESOLVED HARNESS/ENVIRONMENT** — current script already navigates to the app; on the development server, selectors still did not resolve. No production behavior was changed and no ownership assertion was removed. | **FAIL / UNRESOLVED** — stale result rejection across project switch/edit/pause/supersede and batch preview not qualified. |
| `e2e-stage2-strict-mode.sh` | Previous run correctly rejected a non-development server; development run then timed out waiting for the first enhancement request. | **UNRESOLVED SYNTHETIC FIXTURE / ADMISSION** — the run used development mode and StrictMode remained enabled. The request was not observed; no assertion was bypassed. | **FAIL / UNRESOLVED** — late-response rejection and effect replay remain unqualified by this suite. |

The lifecycle suite was rerun after the navigation correction. Its remaining failure is reported rather than reclassified as product failure: captured `PAGE_TEXT` was empty for most cases and did not establish a product root cause. The workspace collector correction was tested against a real exact GET route; it does not broadly ignore `/api/ai/**`.

## Outstanding acceptance gaps

| Criterion | Result | Evidence / limitation |
|---|---|---|
| D01 preferences, stale catalog and encrypted-session lifecycle | **NOT TESTED** | This closeout did not repeat native Settings or safeStorage qualification. No real sign-in, credential read, or revocation was attempted. |
| D04 multiline prompt editing/scrolling in packaged candidate | **NOT TESTED** | No native application window was targeted because the independent review required strict process/window identity proof and forbade interaction with the owner app. |
| NAV-01 remaining views and narrow native window | **NOT TESTED** | Browser smoke/workspace coverage is not native packaged-app evidence. |
| AI-01 cancel/stale Story result | **NOT TESTED** | Existing synthetic service tests were not used here as proof of packaged native path; ownership suite remains unresolved. |
| AI-02 error/recovery without hidden retry/fallback | **NOT TESTED** | No new mock error scenario completed in the native candidate. No live calls. |
| AI-04 manuscript/model preview and explicit application; diagnostic fix preview/application | **PARTIAL** | AI review-sync browser E2E passed for explicit model-to-manuscript application. Proposal-preview and diagnostic-fix application remain **NOT TESTED** in this closeout. |
| User-visible unsaved draft after authoritative persistence failure | **NOT TESTED** | No native candidate fault injection performed. Existing deterministic coverage is not claimed as native evidence. |
| Native macOS candidate startup/save/restart/deletion/backup matrix | **DEFERRED / NOT REPEATED** | Previously accepted MAC evidence remains as reviewed. This closeout did not repeat it or open the owner application. |

A prior operational isolation incident in the reviewed history had **UNKNOWN impact**. This closeout avoided native GUI use, owner storage, owner services and ports 4311/4319; it cannot establish or revise the incident's impact.

## Candidate and repository integrity

- No product source, dependency, package-lock, Electron configuration, or CI file changed.
- Previously recorded candidate artifact digests remain the accepted baseline: DMG SHA-256 `62b0a72371d32d61d77ef3f601ba1b9c0f34c359382929dd67a6417f0f2299e1`; packaged `app.asar` SHA-256 `fc13e521257ca506ec3ed1870dcee2d0eb5f3e47b161a2e6ec7007ab49afc76c`. This closeout did not rebuild or independently rehash them.
- No CI dispatch, dependency audit, provider inference, credential access, app install, release, deployment, merge, or OS security change was performed.
- Existing untracked `graft/` content was preserved and excluded from the commit.

## Exact verification

Development server: `NODE_ENV=development PORT=4322 DISABLE_HMR=true npm run dev` (started; health endpoint confirmed `configured:false`).

Serial suite command: `E2E_BASE_URL=http://127.0.0.1:4322 bash scripts/e2e-<suite>.sh` for each of the eight suites listed above. Outcomes: **5 PASS**, **3 FAIL/UNRESOLVED** (project lifecycle, AI ownership, Stage2 StrictMode). Narrative workspace and import passed after harness-only corrections; mutations and AI review-sync passed under development mode.

`git diff --check`: **PASS**. `GIT_CONFIG_COUNT=0 trail check`: **PASS, no conflicts**; it noted unrelated historical learning matches in unchanged accepted files.

No `npm test`, typecheck, lint, build, or native qualification was rerun because no product source changed and this was a bounded E2E reconciliation. The test script edits themselves were exercised by their targeted suites where those suites completed.

## Scoped changes

- `scripts/e2e-narrative-workspace.sh`: narrow method+path classification for non-inference GET reads.
- `scripts/e2e-narrative-import.sh`: synthetic Provider Hub model eligibility fixture matching the current operation contract.
- `scripts/e2e-project-lifecycle.sh`: navigate each non-backup browser scenario to the app before exercising controls.
- This report records unresolved results and gaps without suppressing or skipping assertions.

**Review disposition:** Independent review requested for this closeout. PR #23 must remain open, draft, and unmerged. No installation, release, or deployment is authorized.
