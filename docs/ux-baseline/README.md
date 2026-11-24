# Proactive Co-Creator 2.0 — Stage 0 UX & Technical Baseline

- **Date:** 2026-11-23 / 2026-11-24
- **Historical remote `main` baseline SHA (2026-11-23):** `03e9fda79f00fc9d27984142dcb188f099f28fde` (`docs: add six-cycle Stage 0 UX baseline and CI audit execution plan`, 1 commit ahead of historical plan baseline `faf580e30532481fdf9c8e4113084f6fb07340de`)
- **Checkpoint Backup:** `/tmp/stage0-checkpoint-03e9fda` (SHA-256 tree digest `6ca96f21fae03cb356984f6b70e6160bbbdbc4bcfbcbf9274357c7585ad02266`)
- **Historical baseline runtime & browser:** Node `v22.23.5`, npm `10.9.9`, `@playwright/cli@0.1.22` (Playwright `1.64.0-alpha`), Chromium headless shell (`chromium-1247`), Linux `4.19.0-gvisor x64`
- **API Cost Guarantee:** **0 paid Gemini API calls.** All browser captures and journey runs executed against a key-free production server (`env -u GEMINI_API_KEY -u API_KEY NODE_ENV=production PORT=3100 node server.ts`, verified `/api/health` → `{"ok":true,"configured":false}`) plus Playwright `**/api/**` route interception asserting `unmockedApiHits === 0`.

> **Final qualification update (2026-11-24):** Current repo HEAD at inspection was `3526c24fec45c60878937a331e487fc387e28d0b`, Node `v26.12.1` / npm `11.20.0`, macOS `darwin 27.0.0 arm64`, Playwright CLI `0.1.22`, Chromium for Testing `155.0.8059.12` (Playwright build `1247`). The corrected local smoke suite passed E2E-A–I 9/9 and the existing audit passed J01–J12 12/12, all with a key-free server. The checked-in screenshot set remains the historical 16-image baseline; captures were not regenerated because no visible application change was made. Remote CI is still pending: run `45300419119` failed E2E-E before the local timing correction and uploaded no files because `.playwright-cli` is hidden. See the [final qualification report](../modernization/2026-11-24-stage-0-final-qualification.md).

## Reproducible Local Commands

```bash
# 1. Existing E2E-A..E2E-I browser smoke suite (key-free production server)
npm run build
env -u GEMINI_API_KEY -u API_KEY NODE_ENV=production PORT=3100 node server.ts &
E2E_BASE_URL=http://127.0.0.1:3100 bash scripts/e2e-browser-smoke.sh

# 2. Deterministic SC-01..SC-16 visual baseline capture & manifest generation
bash scripts/capture-ux-baseline.sh

# 3. Live J01..J12 user journeys, a11y/responsive matrix & Chromium perf audit
bash scripts/stage0-audit-browser.sh

# 4. Node.js graph layout & prompt synthesis benchmark (10 / 30 / 100 / 250 nodes)
npx --yes tsx scripts/stage0-perf-bench.ts
```

## Artifact Index

| Document | Purpose |
| --- | --- |
| [`screen-inventory.md`](./screen-inventory.md) | Complete surface, navigation, control, state, and README-vs-UI discrepancy inventory |
| [`journey-map.md`](./journey-map.md) | Live Chromium verification of user journeys `J01`–`J12` with DOM evidence and friction log |
| [`findings.md`](./findings.md) | Prioritized UX, accessibility, responsive, and technical-debt findings (`P0`–`P3`) |
| [`measurements.md`](./measurements.md) | Multi-viewport responsive, accessibility, contrast, bundle, and `10/30/100/250` graph perf baselines |
| [`figma-handoff.md`](./figma-handoff.md) | Figma-ready preservation matrix, do-not-invent boundaries, 3 design directions, top 5 hypotheses |
| [`quality-gates.md`](./quality-gates.md) | Future Stage 1 / Figma comparison and regression contract |
| [`assets/manifest.json`](./assets/manifest.json) | Machine-readable manifest for sanitized captures `SC-01`–`SC-16` |

## Screenshot Index (`SC-01` – `SC-16`)

All 16 screenshots were generated from deterministic, non-sensitive Schema v3 fixtures (`scripts/stage0-fixtures.ts`) in isolated Chromium contexts and visually inspected.

| ID | Viewport | Theme | Fixture | State Captured | Resolution / Size | Status |
| --- | --- | --- | --- | --- | --- | --- |
| `SC-01` | `1440×900` | Light | `FX-EMPTY` | First launch / blank workspace idea entry | `1440×900` (112 KB) | PASS (Reviewed) |
| `SC-02` | `1440×900` | Light | `FX-SIMPLE` | Decision Inbox pending vs confirmed examples | `1440×900` (183 KB) | PASS (Reviewed) |
| `SC-03` | `1440×900` | Light | `FX-SIMPLE` | Belief Graph selected `Fox` + Contextual Inspector | `1440×900` (181 KB) | PASS (Reviewed) |
| `SC-04` | `1440×900` | Light | `FX-BUSY` | 15-entity busy graph, parallel edges & filters | `1440×900` (203 KB) | PASS (Reviewed) |
| `SC-05` | `1440×900` | Light | `FX-BUSY` | Story Bible edit + inline control-char error | `1440×900` (208 KB) | PASS (Reviewed) |
| `SC-06` | `1440×900` | Light | `FX-BUSY` | Checks tab showing Fox exclusion & target links | `1440×900` (199 KB) | PASS (Reviewed) |
| `SC-07` | `1440×900` | Light | `FX-BUSY` | Batch preview + Review Plan & Prompt modal | `1440×900` (234 KB) | PASS (Reviewed) |
| `SC-08` | `1440×900` | Light | `FX-OUT` | Generated long story + artifact run selector | `1440×900` (193 KB) | PASS (Reviewed) |
| `SC-09` | `1440×900` | Light | `FX-OUT` | Image gallery (4 placeholders) + fullscreen lightbox | `1440×900` (126 KB) | PASS (Reviewed) |
| `SC-10` | `1440×900` | Light | `FX-BUSY` | History tab: export, import, projects & restore | `1440×900` (201 KB) | PASS (Reviewed) |
| `SC-11` | `390×844` | Light | `FX-SIMPLE` | Mobile workspace switcher + Belief Graph | `390×844` (54 KB) | PASS (Reviewed) |
| `SC-12` | `390×844` | Light | `FX-OUT` | Mobile Story Output + bottom action bar | `390×844` (56 KB) | PASS (Reviewed) |
| `SC-13` | `1280×800` | Light | `FX-BUSY` | Cramped laptop 3-column workspace density | `1280×800` (180 KB) | PASS (Reviewed) |
| `SC-14` | `768×1024` | Light | `FX-SIMPLE` | Tablet Story Bible 2-column layout | `768×1024` (93 KB) | PASS (Reviewed) |
| `SC-15` | `390×844` | Light | `FX-ERROR` | Mobile IndexedDB `read_error` recovery banner | `390×844` (65 KB) | PASS (Reviewed) |
| `SC-16` | `1440×900` | Dark | `FX-SIMPLE` | Dark theme workspace high-contrast verification | `1440×900` (184 KB) | PASS (Reviewed) |

## Known Unsupported / Out-of-Scope Flows (Not Backed by Current Code)

- **No Video generation mode** (legacy v1 `'video'` payloads migrate safely to `'story'`).
- **No full manuscript / rich-text story editor** (`OutputGallery` displays, copies, and downloads generated story text only).
- **No chapter / scene timeline model** (`shared/types.ts` models project-level entities, directed relationships, and 12 Story Bible strings).
- **No cloud accounts, authentication, server database, or multi-user sync** (local browser IndexedDB + localStorage only).
- **No paid Gemini quality verification in Stage 0** (strictly non-billable local mocks only).
