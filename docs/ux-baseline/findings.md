# Prioritized UX, Accessibility, Reliability & Technical Findings

- **Baseline SHA:** `03e9fda79f00fc9d27984142dcb188f099f28fde`
- **Observed Timestamp:** `2026-11-23T22:50Z – 23:35Z`
- **Frequency Policy:** Real-world user prevalence is marked **`UNKNOWN`** for all findings (no production telemetry or user study exists in Stage 0). Severity reflects impact when encountered, not measured frequency.

## Priority Legend
- **P0:** Data loss, credential exposure, critical workflow completely blocked, or broken CI verification gate.
- **P1:** High-impact accessibility failure, broken primary keyboard interaction, or CI failure blocking continuous regression checks.
- **P2:** Non-blocking cognitive load, redundant controls, clipping/truncation, discoverability, semantic/spacing debt.
- **P3:** Speculative enhancements or future product roadmap items.

## Master Issue Register

| ID | Priority | Classification | Confidence | Evidence | Status in Stage 0 | Owning Stage | Rough Effort |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `F-01` | **P0/P1** | CI / Reliability | Observed + Measured | GitHub runs `45270690374` & `45276592557`; local RED repro `chrome-for-testing` missing | **FIXED (Local GREEN; Remote CI BLOCKED pending push)** | Stage 0 (S0.1) | Small |
| `F-02` | **P1** | Accessibility (Keyboard) | Observed + Measured | `J05`: `BeliefGraph` Table View had `0/28` keyboard-focusable `<tr>` rows | **FIXED & RE-VERIFIED (28/28 rows)** | Stage 0 (S0.7) | Small |
| `F-03` | **P1** | Accessibility (Focus) | Observed + Measured | `J08` & `stage0-audit-metrics.json`: `OutputGallery` lightbox & `InfoModal` failed to move focus inside dialog or trap Tab | **FIXED & RE-VERIFIED (`focusInside: true`, Escape return)** | Stage 0 (S0.7) | Small |
| `F-04` | **P2** | Responsive / Mobile UX | Observed + Measured | `SC-11`, `SC-12`, `SC-15`, `stage0-audit-metrics.json`: `WorkspaceBottomBar` wraps to `189px` (4 rows) on `390×844`, leaving ~75–90px for Graph/Story | **DEFERRED to Figma / Stage 1** | Stage 1 (Figma) | Medium |
| `F-05` | **P2** | Responsive Clipping | Observed + Measured | `SC-11`, `SC-12`, `SC-15`, `stage0-audit-metrics.json`: `PromptInput` char counter clips 60px off-screen (`right: 450 > 390`); at `320px`, `Dark Theme` clips (`330 > 320`) | **DEFERRED to Figma / Stage 1** | Stage 1 | Small |
| `F-06` | **P2** | Reading / Output IA | Observed + Measured | `SC-08`, `SC-12`, `J07`: Output reading pane sits under Belief Graph at ~130px height (~5 visible lines of long story on `1440×900`, ~3 lines on mobile) | **DEFERRED to Figma / Stage 1** | Stage 1 (Figma) | Medium–Large |
| `F-07` | **P2** | Control Redundancy | Observed | `SC-02`, `SC-03`, `SC-11`: `Generate Story` appears 3× simultaneously (PromptInput, OutputGallery empty card, Bottom Bar); `Story \| Image` appears 2×; `Hide Output Panel` appears on mobile despite tab bar | **DEFERRED to Figma / Stage 1** | Stage 1 (Figma) | Medium |
| `F-08` | **P2** | Navigation State Bug | Observed + Measured | `stage0-audit-metrics.json`, `SC-05`, `SC-10`, `SC-14`: `App.tsx:1823` never passes `activeSection` to `<Header>`, so `Workspace` stays permanently underlined blue | **DEFERRED (P2, non-blocking)** | Stage 1 | Small |
| `F-09` | **P2** | Layout Truncation | Observed | `SC-02`, `SC-05`, `SC-13`: Decision Inbox category filter clips `"Setting"` on right edge; Story Bible 2-col Grid in 3-col Inspector truncates titles (`"Point of Vi..."`) and inputs | **DEFERRED to Figma / Stage 1** | Stage 1 (Figma) | Small–Medium |
| `F-10` | **P2** | Discoverability / IA | Observed | `SC-10`, `J09`, `J12`: Project creation/switching/import/export and Revision History are buried inside right `History` tab; `About` & `Reset Sample Plan` disappear on mobile `< 640px` | **DEFERRED to Figma / Stage 1** | Stage 1 (Figma) | Medium |
| `F-11` | **P2** | Accessibility (Target Size) | Measured | `stage0-audit-metrics.json`: `53` visible desktop controls and `2` mobile controls (`Story Mode` 82×20px, `Image Mode` 86×20px) are `< 24px` tall (WCAG 2.2 SC 2.5.8); `27` mobile controls `< 44px` comfort | **DEFERRED to Figma / Stage 1** | Stage 1 (Figma) | Medium |
| `F-12` | **P2** | Accessibility (Landmarks) | Measured | `stage0-audit-metrics.json`: Page contains **0 `<h1>`** elements (headings jump directly to `<h2>` `"Decision Inbox"`) | **DEFERRED to Stage 1** | Stage 1 | Small |
| `F-13` | **P2** | First-Run Empty State | Observed | `SC-01`, `J01`: Blank workspace prefills `"Untitled creative project"`, renders huge empty graph box with no onboarding prompt, and labels CTA `"Reanalyze Idea"` | **DEFERRED to Figma / Stage 1** | Stage 1 (Figma) | Small |
| `F-14` | **P2** | Copy / Micro-Bug | Observed (Code + DOM) | `SC-10`, `ContextualInspector.tsx:373` vs `App.tsx:1677`: Button says `"Export Refined Prompt (.txt)"` but downloads `refined-prompt.md`; `ContextualInspector.tsx:465` uses `&&` instead of `\|\|` on Add Attribute `disabled` check | **DEFERRED to Stage 1** | Stage 1 | Small |
| `F-15` | **P2** | Large-Graph Legibility & Perf | Measured | `SC-04`, `stage0-node-perf.json`, `stage0-audit-metrics.json`: 15-node Fit shrinks labels `< 8px`; 100-node `computeForceLayout` takes `117.77 ms` median; 100/250 nodes initially spawn outside clipped SVG viewport until `Fit` is clicked; 250-node compiled prompt (`17,814 chars`) exceeds 8,000-char API limit | **DEFERRED to Stage 1/2** | Stage 1 / Stage 2 | Medium–Large |
| `F-16` | **P2** | Bundle Size & Code Health | Measured | `dist/assets/index-*.js` is **`861.58 kB` raw (`231.67 kB` gzip)** triggering Vite `> 500 kB` chunk warning; Rollup logs 2 Zod v4 `@__PURE__` warnings; `App.tsx` is 2,333 lines (high re-render fan-out risk, not a standalone bug) | **DEFERRED to Stage 2** | Stage 2 | Medium |
| `F-17` | **P1 (Conditional)** | Security / Cost Boundary | Code Inspection (`server/routes.ts`) | Express API routes have per-IP rate limiting & Zod schemas, but no account identity or per-user spend cap if deployed publicly with a shared server `GEMINI_API_KEY` | **DOCUMENTED (Conditional Deployment Risk)** | Pre-Public Launch | Large |

## Detailed Evidence for Stage 0 Fixed Issues (`F-01`, `F-02`, `F-03`)

### `F-01` — GitHub Actions Chromium Browser Installation Mismatch (FIXED locally; Remote CI pending push)
- **Root Cause:** `.github/workflows/ci.yml` line 73 executed `playwright-cli install-browser chromium --with-deps --only-shell`, while `@playwright/cli@0.1.22` `open --browser=chromium` without a custom `executablePath` expects `chrome-for-testing` (`chromium-1247/chrome-linux64/chrome`).
- **RED Evidence:** GitHub Actions runs `45270690374` (`faf580e`) & `45276592557` (`03e9fda`) plus clean-HOME local reproduction (`EXIT_CODE=1`: `Browser "chrome-for-testing" is not installed`), plus new failing unit test `Task 3c (S0.1)` in `tests/releaseQualification.test.ts`.
- **Fix:** Removed `--only-shell` in `.github/workflows/ci.yml`, added `playwright-cli install-browser --list`, added `/api/health` (`configured:false`) preflight in both CI and `scripts/e2e-browser-smoke.sh`, added fail-closed structured JSON result parsing (`.playwright-cli/e2e-results.json`), failure screenshots/traces (`.playwright-cli/*.zip`), and `retention-days: 14`.
- **GREEN Evidence:** `106/106` unit tests PASS; `E2E_BASE_URL=http://127.0.0.1:3100 bash scripts/e2e-browser-smoke.sh` passed all 9/9 scenarios (`E2E-A`–`E2E-I`) with `0` API hits and `0` page errors.

### `F-02` — BeliefGraph Table View Keyboard Inoperability (FIXED & RE-VERIFIED)
- **Root Cause:** `components/BeliefGraph.tsx` lines 549 & 605 attached `onClick` directly to `<tr>` elements with no `tabIndex`, `role`, or `onKeyDown`, rendering all 28 entity/relationship rows unreachable by keyboard in the view expressly meant as the accessible fallback.
- **RED Evidence:** Live Chromium `J05` measured `keyboardFocusableRows: 0 / 28`; `tests/stage0Accessibility.test.ts` failed (`found 0`).
- **Fix:** Added `tabIndex={0}`, `role="button"`, descriptive `aria-label`, `Enter`/`Space` `onKeyDown` handler, and `focus-visible` ring to both `<tr>` maps in `components/BeliefGraph.tsx`.
- **GREEN Evidence:** `tests/stage0Accessibility.test.ts` PASS; live Chromium `J05` re-run measured `keyboardFocusableRows: 28 / 28`.

### `F-03` — Image Full Preview & InfoModal Missing Focus Entry/Trap/Restore (FIXED & RE-VERIFIED)
- **Root Cause:** `components/OutputGallery.tsx` (Image lightbox) and `components/InfoModal.tsx` (`About` dialog) listened for `Escape` but never moved focus into the modal on open, trapped `Tab`, or restored focus to the opener button on close.
- **RED Evidence:** Live Chromium `J08` measured `focusInsideLightbox: false`; `stage0-audit-metrics.json` measured `infoModalFocus.onOpen.focusInside: false`; `tests/stage0Accessibility.test.ts` failed.
- **Fix:** Added `previousFocusRef`, dialog ref, and close-button ref in both components to move focus inside on open, trap `Tab`/`Shift+Tab`, and restore opener focus on unmount/Escape.
- **GREEN Evidence:** Live Chromium re-run confirmed `focusInsideLightbox: true`, `focusAfterEscape: "Preview generated image 1"`, and `infoModalFocus.onOpen.focusInside: true`, `afterEscape.text: "About"`.
