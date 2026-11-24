# Stage 0 Measurements — Accessibility, Responsive Layout & Performance Baseline

**Baseline SHA:** `03e9fda79f00fc9d27984142dcb188f099f28fde` (plus S0.1/S0.7 local patches)  
**Measurement Date:** `2026-11-23T23:14:52Z` – `2026-11-23T23:34:36Z`  
**Raw Evidence Files (reproducible via scripts):**
- `.playwright-cli/stage0-audit-metrics.json` (`bash scripts/stage0-audit-browser.sh`)
- `.playwright-cli/stage0-node-perf.json` (`npx tsx scripts/stage0-perf-bench.ts`)
- `docs/ux-baseline/assets/SC-01.png` – `SC-16.png` (`bash scripts/capture-ux-baseline.sh`)

> **Important Measurement Caveat:** All browser timings, DOM counts, contrast checks, and heap readings below are **synthetic single-machine lab measurements** against deterministic fixtures with zero external Gemini API calls (`PORT=3100`, `/api/health` returning `"configured":false`, and Playwright route interception for `/api/*`). Automated checks do **not** establish WCAG 2.1/2.2 conformance, and lab measurements do **not** represent real-world user telemetry.

---

## 1. Test Environment Specification

| Parameter | Observed Value |
| :--- | :--- |
| Node.js Runtime | `v22.23.5` |
| npm Version | `10.9.9` |
| OS / Kernel | Linux `4.19.0-gvisor x64` (containerized sandbox) |
| CPU | `4` vCPU (`cpuModel: unknown` under gVisor) |
| Memory | `12,288 MB` RAM |
| Browser Automation | `@playwright/cli@0.1.22` / Chromium revision `1247` (headless) |
| Production Server | Built `dist/` served by `NODE_ENV=production PORT=3100 node server.ts` |
| External Paid API Calls | **0** (verified via route counter + key-free `/api/health`) |

---

## 2. S0.4 — Responsive Layout & Viewport Audit (`FX-BUSY`)

All six viewports were rendered in headless Chromium against the realistic 15-entity / 17-pending-decision `FX-BUSY` fixture (`1,570/8,000` compiled prompt characters).

| Viewport | Profile | `docOverflow` (`scrollWidth > innerWidth`) | Right-Clipped Elements (`> viewportW`) | Visible Interactive Controls | Controls `< 24px` (WCAG 2.2 SC 2.5.8 floor) | Controls `< 44px` (Touch comfort) | Header Height | Bottom Bar Height | Generate CTA in Viewport |
| :--- | :--- | :---: | :---: | :---: | :---: | :---: | :---: | :---: | :---: |
| `1440×900` | Desktop | `false` (`0px`) | `0` | `231` | `53` | `162` | `63px` | `59px` | `true` |
| `1280×800` | Compact Laptop | `false` (`0px`) | `0` | `231` | `53` | `162` | `63px` | `59px` | `true` |
| `768×1024` | Tablet Portrait | `false` (`0px`) | `2` | `36` | `7` | `28` | `63px` | `109px` | `true` |
| `390×844` | Mobile | `false` (`0px`) | `1` | `30` | `2` | `27` | `63px` | **`189px`** (22.4% height) | `true` |
| `320×568` | Narrow Mobile | `false` (`0px`) | `2` | `30` | `2` | `27` | `63px` | **`187px`** (32.9% height) | `true` |
| `720×450` | 200% Zoom equiv (`1440×900`) | `false` (`0px`) | `0` | `31` | `2` | `28` | `63px` | `109px` | `true` |

### Key Responsive Observations (Verified in DOM + `SC-11`–`SC-15`)
1. **Bottom Bar Wrapping on Mobile (`F-05`):** At `390×844` and `320×568`, `WorkspaceBottomBar` wraps into 4 rows (`189px` / `187px`), consuming `22.4%`–`32.9%` of total viewport height (`SC-11`, `SC-12`).
2. **Overflow-Hidden Right Clipping (`F-06`):** Even when `documentElement.scrollWidth <= innerWidth`, child containers clip interactive/status elements horizontally:
   - `768×1024`: `Reset Sample Plan` (`right: 910px > 768px`), `Dark Theme` (`right: 1012px > 768px`) inside header overflow.
   - `390×844`: `"89 seed · 1,570/8,000 compiled chars"` (`right: 450px > 390px`).
   - `320×568`: `Dark Theme` (`right: 330px > 320px`) and char counter (`right: 450px > 320px`).
   - `1440×900` / `1280×800`: Decision Inbox category filter chips (`All | Questions | Characters | Relations | Setting`) clip horizontally on the right edge inside the 3-column left pane (`SC-02`, `SC-13`).
3. **Sub-24px Controls:**
   - Top header links (`Workspace`, `Story Bible`, `Prompt & Output`, `History & Export`, `About`) measure `20px` height (`75×20` to `115×20`).
   - Compact inbox controls (`Try sample batch` `87×17`, `Select All (17)` `76×16`, `Select None` `68×16`) and mobile mode pills (`Story Mode` `82×20`, `Image Mode` `86×20`) fall below the `24×24px` WCAG 2.2 SC 2.5.8 target floor without `24px` spacing buffers.
   - On desktop, `53/231` visible controls are `<24px` in at least one dimension and `162/231` are `<44px`.

---

## 3. S0.4 — Accessibility Audit (DOM, Keyboard, Focus, Contrast, Reduced Motion)

### 3.1 Semantic Structure & Landmarks (Measured on `FX-BUSY`)
- **Heading Hierarchy (`F-08`):** **0 `<h1>` elements** on the page. Document outline begins directly at `<h2>` (`Decision Inbox`), followed by 18 `<h3>` cards/sections and 1 `<h4>` (`Add New Entity to Graph`).
- **Unnamed Interactive Controls:** `0` unnamed buttons/inputs detected on initial `FX-BUSY` workspace (`unnamedControlsCount: 0`).
- **Tablists:** `2` valid ARIA `tablist` containers detected:
  - `"Prompt and Generated Output views"` (`2` tabs, `1` selected)
  - `"Inspector views"` (`4` tabs, `1` selected)
- **Header Active State Misrepresentation (`F-04`):** Clicking `"Story Bible"` in `Header.tsx` opens the Story Bible tab in the right Inspector, yet `"Workspace"` retains blue active underline styling (`hasBlueActiveStyle: true`) and `"Story Bible"` remains visually inactive (`hasBlueActiveStyle: false`), because `App.tsx` never passes the `activeSection` prop to `<Header />`.
- **Reduced Motion:** `@media (prefers-reduced-motion: reduce)` rule confirmed present in `/index.css` lines `57–66` (`hasReducedMotionCssRule: true`), clamping `.animate-fade-in-up`, `.animate-fade-in-down`, `.animate-fade-in`, `.animate-pulse`, and `.animate-spin` to `0.01ms`.

### 3.2 Keyboard Operability & Focus Management (Before vs. After S0.7 P1 Fixes)

| Control / Dialog | Pre-Fix Observed Behavior (Baseline `03e9fda`) | Post-Fix Observed Behavior (After S0.7 RED→GREEN) | Status |
| :--- | :--- | :--- | :--- |
| **BeliefGraph Table View rows (`F-02`)** | `0 / 28` table rows (`<tr>`) were keyboard focusable (`tabIndex` absent, click-only `onClick`). Screen-reader / keyboard users could not select entities or relationships in Table View. | **`28 / 28`** rows keyboard focusable (`tabIndex={0}`, `role="button"`, `aria-label`, `Enter`/`Space` activation, `focus-visible` ring). Verified in Chromium `J05` + `tests/stage0Accessibility.test.ts`. | **FIXED (S0.7)** |
| **OutputGallery Fullscreen Lightbox (`F-03a`)** | Opening lightbox left `document.activeElement` outside the dialog (`focusInsideLightbox: false`); no `Tab` focus trap; closing via `Escape` did not restore focus to the thumbnail trigger. | Focus enters close button inside dialog (`focusInsideLightbox: true`), `Tab`/`Shift+Tab` trapped within dialog, `Escape` restores focus to `"Preview generated image 1"`. Verified in Chromium `J08` + unit test. | **FIXED (S0.7)** |
| **InfoModal (`About` dialog) (`F-03b`)** | Opening `About` modal left focus on the background trigger (`focusInside: false`); `Tab` escaped behind backdrop; closing did not explicitly restore focus. | Focus enters modal close button (`focusInside: true`, `activeTag: BUTTON`), `Tab`/`Shift+Tab` trapped inside modal, `Escape` restores focus to `"About"`. Verified in Chromium audit + unit test. | **FIXED (S0.7)** |
| **Review Plan & Prompt Modal (`J06`)** | Already implemented focus entry (`Close`) and Escape restoration (`Review Plan & Prompt`). | Preserved and verified (`modalFocus: "Close"`, `returnFocus: "Review Plan & Prompt"`). | **PASS** |

### 3.3 Computed Contrast Sampling (Light vs. Dark Mode)

Computed styles were sampled in headless Chromium on `FX-BUSY`, compositing semi-transparent backgrounds accurately onto the active theme backdrop (`#ffffff` in Light mode, `#111827` / `#0d1117` in Dark mode).

| Sampled UI Element | Sample Text | Font Size | Light Contrast Ratio | Dark Contrast Ratio | Passes 4.5:1 (AA Normal) |
| :--- | :--- | :---: | :---: | :---: | :---: |
| Header active nav / brand accent | `Workspace` | `14px` | `5.25 : 1` | `6.72 : 1` | Yes (both) |
| Header inactive nav link | `Story Bible` | `14px` | `7.56 : 1` | `12.05 : 1` | Yes (both) |
| Primary Generate CTA button | `Generate Story` | `14px` | `5.25 : 1` | `5.25 : 1` | Yes (both) |
| 12px metadata / helper text | `17 pending · 0 confirmed` | `12px` | `4.84 : 1` | `6.82 : 1` | Yes (both) |
| 11px inline link | `Try sample batch` | `11px` | `5.11 : 1` | `6.99 : 1` | Yes (both) |

> **Audit Transparency Note:** Two additional probe rows in `.playwright-cli/stage0-audit-metrics.json` (`Graph legend text (11px)` and `Outdated warning banner`) fell back to root body text (`13.33:1` light / `17.20:1` dark) because the `FX-BUSY` fixture did not render an outdated artifact banner on that screen and the legend selector matched its ancestor container. They are excluded from the table above rather than falsely reported as legend/banner contrast measurements.

### 3.4 Explicit WCAG Conformance Disclaimer & Manual Testing Required
**Automated checks and DOM probes do NOT establish WCAG 2.1/2.2 AA conformance.** The following areas were **NOT** exhaustively verified in Stage 0 and require human assistive-technology testing prior to any conformance claim:
- Screen-reader announcement flow (NVDA on Windows, VoiceOver on macOS/iOS, TalkBack on Android) for live regions, Decision Inbox mutations, and SVG graph focus changes.
- Dynamic SVG node/edge labels at zoomed-out scales (`F-10`: at 15+ entities under `Fit`, SVG text drops below ~8px effective rendered height).
- Input placeholder contrast, Windows High Contrast / Forced Colors mode (`forced-colors: active`), and 400% zoom (`320px` CSS width reflow without two-dimensional scrolling in sub-panes).
- Full keyboard-only traversal of every popover, inline edit, and mobile drawer without mouse fallback.

---

## 4. S0.5 — Performance, Bundle & Maintainability Baseline

### 4.1 Production Bundle Size (`npm run build`, Vite 6)

| Artifact | Baseline `03e9fda` (Raw / Gzip) | Post-Stage 0 Local (Raw / Gzip) | Delta | Notes |
| :--- | :---: | :---: | :---: | :--- |
| `dist/index.html` | `1.49 kB` / `0.66 kB` | `1.49 kB` / `0.65 kB` | `0.00 kB` / `-0.01 kB` | Entry HTML |
| `dist/assets/index-*.css` | `61.18 kB` / `10.12 kB` | `61.77 kB` / `10.23 kB` | `+0.59 kB` / `+0.11 kB` | Tailwind v4 utility additions (`focus-visible`) |
| `dist/assets/index-*.js` | `859.64 kB` / `231.17 kB` | `861.58 kB` / `231.67 kB` | `+1.94 kB` / `+0.50 kB` | Single unsplit JS chunk (`145` modules) |
| Build Duration | `3.39 s` | `3.31 s` | `-0.08 s` | Cold Vite production build |

**Observed Build Warnings (Unchanged from Baseline):**
1. Vite chunk-size warning: main JS bundle (`861.58 kB` raw / `231.67 kB` gzip) exceeds Vite's default `500 kB` single-chunk threshold — no dynamic `import()` code splitting exists (e.g., `OutputGallery`, `InfoModal`, `DecisionInboxPanel`, or Zod schemas).
2. Two Rollup annotation warnings in `node_modules/zod/v4/core/util.js` (line `400`) and `node_modules/zod/v4/core/regexes.js` (line `74`) (`/*@__PURE__*/` comment placement).

### 4.2 Node.js Pure-Logic Graph & Prompt Benchmark (`scripts/stage0-perf-bench.ts`)

| Graph Scale (Entities / Edges) | Runs | `computeForceLayout` Median | Min / Max | Spatial Spread (W×H px) | Synthesized Prompt Length | Prompt Synth Time | Consistency Check Time | Serialized JSON Size |
| :---: | :---: | :---: | :---: | :---: | :---: | :---: | :---: | :---: |
| `10` / `15` | `7` | `3.50 ms` | `3.00` / `56.32 ms` | `457 × 466` | `814` chars | `0.09 ms` | `1.20 ms` | `17,815 B` (`17.4 KB`) |
| `30` / `45` | `7` | `31.51 ms` | `27.86` / `78.22 ms` | `953 × 926` | `2,218` chars | `0.15 ms` | `0.20 ms` | `47,119 B` (`46.0 KB`) |
| `100` / `150` | `5` | **`117.77 ms`** | `93.26` / `167.81 ms` | `2058 × 1513` | `7,131` chars | `0.25 ms` | `0.27 ms` | `149,459 B` (`146.0 KB`) |
| `250` / `375` | `3` | **`69.55 ms`** | `65.40` / `72.42 ms` | `5435 × 1138` | **`17,814` chars** | `0.31 ms` | `0.57 ms` | `370,843 B` (`362.2 KB`) |

**Key Algorithmic Findings:**
- **Non-Monotonic Timing at 250 Nodes:** `computeForceLayout` drops from `117.77 ms` (100 nodes) to `69.55 ms` (250 nodes) because `lib/graphLayout.ts` reduces iteration ticks at higher node counts, trading layout convergence quality for speed — resulting in an extreme `5435 × 1138 px` horizontal spread.
- **8,000-Character API Prompt Ceiling (`F-14`):** At `250` entities, deterministic prompt synthesis produces `17,814` characters (more than `2.2×` the server's `8,000`-character validation limit in `shared/schemas.ts`), while prompt synthesis itself stays fast (`0.31 ms`; `10,661`-char boundary stress test synthesized in `0.15 ms`). Users with large graphs can cross the `8,000`-char ceiling without proactive truncation or guidance.

### 4.3 Real Headless Chromium Rendering & Interaction Benchmark (`1440×900`)

Measured against built `dist/` on `http://127.0.0.1:3100` (`.playwright-cli/stage0-audit-metrics.json`):

| Graph Scale (Entities / Edges) | App Ready (`ms`) | DOMContentLoaded (`ms`) | FCP (`ms`) | Node Focus+Select (`ms`) | Inspector Tab Switch (`ms`) | Total DOM Nodes | SVG Elements | JS Heap (`MB`) |
| :---: | :---: | :---: | :---: | :---: | :---: | :---: | :---: | :---: |
| `10` / `10` | `902` | `146` | `344` | `158` | `95` | `366` | `64` | `11 MB` |
| `30` / `30` | `1,123` | `152` | `456` | `58` | `121` | `486` | `184` | `11 MB` |
| `100` / `100` | `1,299` | `152` | `684` | `97` | `307` | `906` | `604` | `20 MB` |
| `250` / `250` | `1,315` | `148` | `824` | `145` | `243` | `1,806` | `1,504` | `28 MB` |

**Observed Large-Graph UX Defect (`F-15`):** At `100` and `250` entities, initial graph camera transform places entities off-screen (e.g., `Node_001` rendered at `x=1795`, clipped behind the right Inspector column) until the user manually clicks `Fit belief graph to view`. Even after clicking `Fit`, all node labels become unreadable micro-dots at `100+` nodes (`F-10`).

### 4.4 Codebase Size & Maintainability Hotspots (Observed LOC)

Total TypeScript/TSX application code across `App.tsx`, `components/`, `lib/`, and `server/`: **`17,264` lines**.

| File | Line Count | Maintainability Risk |
| :--- | :---: | :--- |
| `lib/storageEngine.ts` | `2,343` | High complexity (IndexedDB + localStorage fallback + CAS multi-tab conflict guard + migrations); well-tested, do not rewrite casually |
| `App.tsx` | `2,332` | Monolithic UI state orchestrator coordinating workspace layout, modal states, storage banners, AI workflows, and keyboard shortcuts |
| `lib/canonicalModel.ts` | `2,004` | Core schema v3 + canonical entity/relationship/Story Bible authority |
| `components/ContextualInspector.tsx` | `1,613` | Four distinct tabs (`Inspector`, `Story Bible`, `Checks`, `History`) packed into one component |
| `lib/projectController.ts` | `1,469` | Transaction, undo/redo, and batch commit coordinator |
| `lib/nlBatchEngine.ts` | `998` | Deterministic natural-language batch parser & diff engine |
| `components/BeliefGraph.tsx` | `995` | SVG canvas + pan/zoom + search/filter + Table View fallback |
| `components/DecisionInboxPanel.tsx` | `728` | Inbox cards + filters + NL Batch inline panel |

### 4.5 Conditional Security, Cost & Public-Deployment Risk Boundary (Out of Scope for Stage 0)
- **Current Architecture:** Designed for local/trusted single-user development (`GEMINI_API_KEY` held server-side in `server/geminiClient.ts`, never exposed to browser; `/api/*` rate-limited in-memory via `server/routes.ts`).
- **Conditional Public-Deployment Risks (Do NOT deploy publicly without addressing):**
  1. **No user authentication or per-user quota isolation:** Anyone reaching `/api/analyze`, `/api/clarifications`, `/api/generate/story`, or `/api/generate/images` consumes the server owner's Gemini API budget (especially Imagen calls).
  2. **In-memory rate limiting resets on server restart** and does not coordinate across horizontally scaled instances.
  3. **Client-side IndexedDB/localStorage persistence only:** No encrypted cloud backup; clearing browser site data deletes unsaved projects unless the user exported JSON/Markdown backups.
  4. **Stage 0 Budget Compliance:** Verified **0** paid Gemini calls executed during Stage 0; `GEMINI_API_KEY` never referenced in `.github/workflows/ci.yml` (enforced by `tests/releaseQualification.test.ts`).
