# Stage 0 Quality Gates & Future Regression Contract

This document defines the reproducible non-billable verification suite established in Stage 0 and the mandatory regression gates for any future Figma-to-Code (Stage 1+) implementation.

> **2026-11-24 qualification status:** QG-01 passed locally (106/106 tests, typecheck and lint); QG-02/QG-03 were exercised by the passing non-billable E2E and Stage 0 journeys; QG-04 passed locally on Chromium (9/9) but is **remote-pending**. GitHub run [45300419119](https://github.com/Centaurioun/Proactive-Co-Creator/actions/runs/45300419119) passed Node verification but failed the browser job at an E2E-E timing assertion; its artifact action found no files because `.playwright-cli` is hidden. The workflow fix is in the working tree, not yet verified on GitHub. See the [qualification report](../modernization/2026-11-24-stage-0-final-qualification.md). The contract rows below define required gates; they are not evidence that each gate currently passes.

---

## 1. Reproducible Non-Billable Verification Commands

All commands below execute **with zero paid Gemini API calls** (no `GEMINI_API_KEY` set; `/api/health` verified `"configured":false`; browser tests intercept `**/api/**`).

```bash
# 1. Static analysis, unit/integration tests, and production bundle
npm run typecheck
npm run lint
npm test
npm run build
node -e 'import("./server.ts")'

# 2. Existing 9-scenario production browser smoke suite (E2E-A through E2E-I)
#    Start built server in a key-free environment first:
env -u GEMINI_API_KEY NODE_ENV=production PORT=3100 node server.ts &
SERVER_PID=$!
E2E_BASE_URL=http://127.0.0.1:3100 bash scripts/e2e-browser-smoke.sh
kill "$SERVER_PID"

# 3. Stage 0 full 16-screen visual baseline capture + manifest generation
bash scripts/capture-ux-baseline.sh

# 4. Stage 0 J01-J12 journeys + multi-viewport a11y + Chromium perf benchmark
bash scripts/stage0-audit-browser.sh

# 5. Stage 0 Node.js pure-logic graph layout & 8k-char prompt boundary benchmark
npx tsx scripts/stage0-perf-bench.ts
```

---

## 2. Mandatory Regression Invariants for Stage 1+ UI Work

Any Stage 1 UI modernization PR **MUST NOT** merge unless every invariant below holds:

| Gate ID | Verification Check | Blocking Threshold |
| :--- | :--- | :--- |
| **QG-01: Static & Unit Integrity** | `npm run typecheck`, `npm run lint`, `npm test` | `0` TS errors, `0` ESLint errors, `100%` passing unit/integration tests (currently `106/106`, never delete/weaken existing assertions). |
| **QG-02: Schema v3 & Storage Safety** | Existing `tests/proactiveCoCreator2.test.ts`, `tests/masterPlanStability.test.ts`, `E2E-F`, `E2E-G`, `J09`, `J11`, `J12` | Zero silent data loss; IndexedDB `read_error` enforces `0` destructive `put` calls; clearing Story Bible fields never revives prior AI values; Undo/Redo restores transactions accurately. |
| **QG-03: Zero Unmocked Paid API Calls** | `tests/releaseQualification.test.ts`, `scripts/e2e-browser-smoke.sh`, `scripts/stage0-audit-browser.sh` | `0` unmocked `/api/*` hits in CI/local E2E; `GEMINI_API_KEY` string absent from `.github/workflows/ci.yml`; `/api/health` preflight asserts `"configured":false`. |
| **QG-04: Browser Smoke Parity** | `scripts/e2e-browser-smoke.sh` (`E2E-A`–`E2E-I`) on local AND remote GitHub Actions | `9/9` scenarios `PASS`, `0` uncaught `pageErrors`, `0` unexpected `consoleErrors`, failure traces & `e2e-results.json` uploaded on CI. |
| **QG-05: Accessibility Floor** | `tests/stage0Accessibility.test.ts` + `scripts/stage0-audit-browser.sh` | `0` unnamed interactive controls; Table View rows remain `100%` keyboard operable (`tabIndex={0}` + `Enter`/`Space`); all modals (`Review`, `InfoModal`, `OutputGallery` Lightbox) trap focus and restore trigger focus on `Escape`; `@media (prefers-reduced-motion: reduce)` preserved. |
| **QG-06: Responsive No-Clip Target (Stage 1)** | Re-run `scripts/stage0-audit-browser.sh` across `1440×900`, `1280×800`, `768×1024`, `390×844`, `320×568`, `720×450` | Stage 1 must reduce `clippedRightCount` to `0` on all 6 viewports, reduce `390×844` bottom bar height from `189px` to `≤72px`, and bring primary controls to `≥24×24px` (target `44×44px` on touch). |
| **QG-07: Visual Capture Diff** | Re-run `scripts/capture-ux-baseline.sh` and visually inspect `SC-01`–`SC-16` | All 16 states render non-blank, zero spurious CAS banners, Light & Dark contrast parity maintained (`≥4.5:1` for sampled normal text). |
| **QG-08: Bundle & Graph Performance** | `npm run build` + `npx tsx scripts/stage0-perf-bench.ts` | Stage 1 should introduce route/panel code splitting to move main JS chunk under Vite's `500 kB` threshold (baseline: `861.58 kB` raw / `231.67 kB` gz) and must not regress `10`/`30`-node render or `computeForceLayout` latency. |
