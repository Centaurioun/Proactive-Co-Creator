# Proactive Co-Creator 2.0 — STAGE 0: Product, UX & Technical Baseline Execution Plan

> **EXECUTION BRIEF FOR GOOGLE AI STUDIO / AGENTIC CODING ASSISTANT**
>
> Read the **entire document** before modifying a file. Complete as much of this bounded Stage 0 as the actual environment permits in one substantial implementation session. Prioritize fixing the verified browser-CI blocker, capturing real visual evidence, exercising complete user flows, measuring quality, and preparing an unambiguous handoff to human-led Product Design and Figma. **Do not begin Stage 1 information-architecture redesign or produce a speculative new UI.**
>
> **Methods required:** Superpowers Brainstorming, Systematic Debugging, Test-Driven Development, Writing Plans, Code Review, Verification Before Completion; **Six-Cycle Iterative Refinement before coding and a separate six-cycle adversarial review after implementation.** RED → GREEN → REFACTOR for each genuine bug or new behavioral test harness.
>
> **Scope:** Stage 0 only — stabilize verification, measure current experience, make reproducible audit capture, identify evidence-backed code and UX issues, apply *narrow* verified correctness/accessibility repairs, and produce Figma-ready documentation. NOT a product rewrite.
>
> **Repository:** https://github.com/Centaurioun/Proactive-Co-Creator
>
> **Historical baseline inspected for this plan:** `faf580e30532481fdf9c8e4113084f6fb07340de` (Nov 23, 2026; `ci: add browser E2E smoke test job to CI pipeline`). **Re-fetch the ACTUAL latest remote `main` before acting.** All observations below must be reconciled with that HEAD and may have become obsolete.
>
> **Date:** 2026-11-24. **State of this Markdown:** planning instructions only; it is not evidence of executed tests or finished fixes.
>
> **Output language:** code and implementation docs may be English; final execution report **must be in Turkish**.

---

## 0. Product understanding, constraints, and brainstorming

### 0.1 What this product actually does today

Proactive Co-Creator 2.0 is a React 19 / TypeScript / Vite / Tailwind web app with an Express + server-side Gemini boundary. The app converts a seed idea into a canonical `ProjectSnapshot` holding `storyBible`, entities, a directed multigraph of relationships, clarification questions, AI-suggested decisions, accepted and rejected decisions, and a deterministically synthesized prompt. It provides local project persistence, revision history, undo/redo, Story or Image generation, artifact history, and JSON/Markdown export.

The central product promise is **user authority over AI suggestions and reliable propagation of confirmed creative decisions** — not merely a visually attractive node graph or one-off AI generation.

Existing principal UI surfaces:

| Surface | Current component / route | Intended user job |
| --- | --- | --- |
| Global navigation / theme | `components/Header.tsx` | Understand where they are and navigate the workspace |
| Initial idea and generation actions | `components/PromptInput.tsx` | Enter idea, analyze/reanalyze, generate Story/Image |
| Left decision workspace | `components/DecisionInboxPanel.tsx` | Inspect AI inferences, clarification questions and natural-language batch edits |
| Center graph/table | `components/BeliefGraph.tsx` | Explore and edit entities and directed relationships |
| Right inspector | `components/ContextualInspector.tsx` | Edit entities, Story Bible, checks, project history/export |
| Output drawer | `components/OutputGallery.tsx` | See derived prompt, notes, generated story/images, artifact versions |
| Bottom actions | `components/WorkspaceBottomBar.tsx` | Undo/Redo, review, mode and explicit generation |
| Root orchestration | `App.tsx` | State, selections, persistence, navigation, dialogs and async requests |

Current responsive structure observed in `App.tsx`: an extra-large 12-column grid (`3/6/3` left/center/right), with a four-tab mobile navigator and a compact output area in the middle column.

Important behavior to preserve:
- `ProjectSnapshot` / `CreativeProject` as the source of truth, Schema v3 and legacy migration; IndexedDB authoritative persistence, localStorage fallback/cache; CAS and conflicts; tombstones; recovery and explicit backup.
- Directed multigraph, user-confirmed vs AI-pending provenance/status, Story Bible clearing authority, clarification semantics, deterministic prompt synthesis and explicit exclusion/rename authority.
- Decisions, NL batch preview with stale guards and atomic commit, Undo→Save→Reload→Redo, artifact history/currentness, Story and Image; **no Video mode**.
- Existing real browser script `scripts/e2e-browser-smoke.sh` (E2E-A to E2E-I) and CI's Node 22 checks.

### 0.2 Why Stage 0 precedes Figma

A visual redesign without reliable screenshots, comparable current-state user flows and passing browser automation risks decorating the wrong information architecture, losing important editing features and hiding persistence warnings.

**Stage 0 success looks like:** (1) a real runnable browser regression gate, (2) a screenshot- and DOM-grounded current-state audit, (3) reproducible task journeys across widths and data states, (4) measured quality/performance/accessibility observations, (5) a feature/interaction inventory and design constraints ready for Figma, and (6) a short, evidence-based prioritization of what must change, *without doing that redesign*.

### 0.3 Alternative strategies evaluated (Superpowers Brainstorming)

| Approach | Pros | Costs / risk | Decision |
| --- | --- | --- | --- |
| A. Jump into a completely redesigned UI | Visible results fast | No visual baseline, test harness broken, may obscure or remove essential controls | REJECT for Stage 0 |
| B. Repair CI, measure true workflows, capture all meaningful screens and interaction states, preserve behavior, prepare Figma brief | Trustworthy design inputs, bounded code diffs, reusable automation | Requires disciplined evidence collection | **SELECTED** |
| C. Complete architecture rewrite / new data model first | Could ease long-term scaling | High migration and feature-loss risk; no user-validated reason | REJECT |
| D. Only write an opinionated UX report without executable browser tests | Low effort | Cannot compare future design objectively or catch regressions | REJECT |
| E. Add new story editor, plot timeline, cloud sync or model marketplace now | Broad feature list | Unvalidated scope, paid API/security obligations, not Stage 0 | DEFER |

**Decision principle:** Do not confuse *missing UX evidence* with *a reason to add features*, or *a broken browser installation* with *a broken application*.

### 0.4 Explicit goals, non-goals, anti-goals

**Goals:** Browser CI green, safe reproducible test harness, current UI evidence, flow completion baseline, comprehensive state inventory, accessibility/performance diagnostics, documented risk register, concrete Stage 1/Figma handoff.

**Non-goals:** Figma file creation, new branding, visual redesign, new workspace IA, novel drafting editor, chapters/scenes data model, cloud account/collaboration, translations, new AI model support, live deployment, paid Gemini verification.

**Anti-goals:** Screenshotting the wrong version or fake states; changing production data while capturing; rewriting `App.tsx` in bulk; splitting components just to reduce line count; weakening assertions so E2E passes; counting mocked API output as actual Gemini quality; forcing Git history; committing real user data, keys, logs containing secrets or unredacted local files.

### 0.5 Available evidence and confidence boundaries

**Verified via repository source/actual GitHub Actions log at plan authoring:**
- Latest inspected HEAD was `faf580e`.
- GitHub Actions run `45270690374`: `Verify (Node 22.x)` succeeded with **102/102 tests, 15 suites**; `Browser E2E Smoke (Chromium)` failed **before browser cases ran**.
- Browser step ran `playwright-cli install-browser chromium --with-deps --only-shell`, then `playwright-cli open --browser=chromium`. Error: `Browser "chrome-for-testing" is not installed; expected executable .../chromium-1247/chrome-linux64/chrome`. The tool itself suggested `playwright-cli install-browser chrome-for-testing`.
- CI currently builds and starts the production Express server in `.github/workflows/ci.yml`; it attempts `scripts/e2e-browser-smoke.sh` after installing the wrong executable form.
- `index.css` uses DM Sans, Plus Jakarta Sans, JetBrains Mono; application has light/dark styling.
- `components/OutputGallery.tsx` displays/copies/downloads generated Story as text; it is **not** a full manuscript editor.
- `shared/types.ts` has 12 Story Bible string fields and project-level graph; no first-class chapter/scene timeline or cloud account model.
- `server/aiService.ts` image generation currently requests four images of aspect ratio `1:1`; no paid production request may be executed in Stage 0.
- `server/routes.ts` has per-IP rate limiting and Zod validation but no evident account-level identity or paid budget system; document **conditional external-deployment risk**, do not invent a security incident.

**Not verified:** actual rendered screenshots and full accessibility; representative user task times; paid model quality/availability; public hosting exposure; production user counts; whether unobserved issues happen in practice.

**Plan must never claim:** all current UX observations have been visually proven; live Gemini requests were tested; existing Playwright suite passed in remote CI; a redesign has been approved.

---

## 1. Non-negotiable execution instructions

1. **Read this plan and the code** at latest `main`: `README.md`, `package.json`, `.github/workflows/ci.yml`, `scripts/e2e-browser-smoke.sh`, `App.tsx`, `components/*`, `lib/{canonicalModel,projectController,storageEngine,promptBuilder,graphLayout,consistencyChecker}.ts`, `shared/types.ts`, `server/routes.ts`, `docs/modernization/feature-preservation-matrix.md` and `verification-report.md`. Reinspect `AGENTS.md` or local agent instructions if present.
2. Use the actual remote SHA as evidence baseline. Before edits: `git status`, branch, remote, HEAD, Node/npm, package-lock state, checkpoint. Respect untracked files and preexisting dirty work; never wipe them.
3. **Do not force-push**. Commit only independently verified, logically scoped changes; push normally only if authenticated and current branch/remote state is safe. If push unavailable, report separately what remains local and provide reproducible commits/diff instructions.
4. Production server must stay **key-free in test mode**. Unset test-process `GEMINI_API_KEY` where feasible; intercept and reject all `/api/analyze`, `/api/clarify`, `/api/refine`, `/api/batch-edit`, `/api/generate/story` and `/api/generate/images` in browser flows. Serve deterministic fixture responses only where needed; count and assert **zero actual upstream requests**. Do not inspect or expose secret values.
5. For **every code behavior change**, reproduce root cause and demonstrate RED test → smallest GREEN fix → REFACTOR → full verification. Configuration-only changes must also prove the prior failing step and the successful corrected step.
6. Distinguish `PASS / FAIL / BLOCKED / NOT TESTED / N/A`, with command, timestamp, SHA, environment, output and artifact link. **No guessed performance metrics or made-up findings.**
7. Use the current architecture. No global store migration, wholesale UI re-layout, new backend identity/storage schema, change to canonical approvals or new modes. A usability observation is **not authorization** to redesign.
8. Do not delete earlier tests. Do not fabricate screenshots. A screenshot-only test is insufficient; pair visual evidence with DOM/interaction assertions.
9. Preserve semantic focus and keyboard access. Stage 0 may apply *small verified fixes* to remove a blocker, but any broader issue becomes a ranked Stage 1/Stage 2 candidate with evidence.
10. Avoid dependency churn. If adding a test-only dependency (e.g., axe-core or Playwright runner) is necessary and justified, pin compatible versions and update `package-lock.json` accurately; do not rewrite `bun.lock` merely because it exists.

---

## 2. Source mapping and proposed Stage 0 deliverables

**Existing files to inspect, minimal modifications only as justified:**

| Path | Responsibility / allowed change |
| --- | --- |
| `.github/workflows/ci.yml` | Fix mismatched browser installation; ensure browser job actually executes; screenshot, traces and logs as artifacts on failure; Node checks remain intact |
| `scripts/e2e-browser-smoke.sh` | Keep E2E-A–E2E-I. Improve launcher/diagnostics or portability only with evidence |
| `App.tsx` | Inspect navigation/states; small confirmed correctness or accessibility issues only — no new shell |
| `components/Header.tsx`, `PromptInput.tsx`, `DecisionInboxPanel.tsx`, `BeliefGraph.tsx`, `ContextualInspector.tsx`, `OutputGallery.tsx`, `WorkspaceBottomBar.tsx` | Inspect current tasks, copy, focus, responsive interactions; retain architecture |
| `index.css` | Inventory typography and tokens; **do not** change brand/design system in Stage 0 |
| `lib/graphLayout.ts` | Gather current large-graph performance evidence; no wholesale algorithm replacement absent proven harm |
| `lib/storageEngine.ts`, `lib/projectController.ts` | Validate race/conflict/reload flows; avoid touching persistence without reproduced issue and backup |
| `server/routes.ts`, `server/aiService.ts` | Inventory endpoint, mock and cost/security boundaries; do not call paid Gemini |
| `shared/types.ts`, `shared/schemas.ts` | Capture current capabilities/constraints; do not invent new product data types |

**Proposed new scoped artifacts (adapt names to existing repository conventions):**

| New artifact | Expected content |
| --- | --- |
| `docs/ux-baseline/README.md` | Dated overview, SHA, capture method, constraints, screenshot index, known unsupported flows |
| `docs/ux-baseline/screen-inventory.md` | UI screens, entry points, navigation, states, responsive behavior and control hierarchy |
| `docs/ux-baseline/journey-map.md` | Exact user journeys with step numbers, transitions, actions and evidence IDs |
| `docs/ux-baseline/findings.md` | Prioritized evidence-backed UX / accessibility / reliability findings; observed vs inferred |
| `docs/ux-baseline/measurements.md` | Bundle/performance/layout and accessibility measurement methodology + numeric outputs if actually collected |
| `docs/ux-baseline/figma-handoff.md` | Figma-ready feature preservation, information architecture inputs, states, tokens, copy and unresolved design decisions; **no proposed final visual style** |
| `docs/ux-baseline/quality-gates.md` | Baseline vs new-design future visual/functional test contract |
| `docs/ux-baseline/assets/` (optional) | **Sanitized** reviewed and bounded representative screenshots (max ~10–16 optimized images), if useful to version; otherwise use CI artifacts with exact URLs and a manifest |
| `scripts/capture-ux-baseline.*` (optional) | Reproducible Playwright or existing CLI capture harness with fixture isolation and clear usage |
| `tests/*` (optional) | Focused tests for discovered verified blockers or new harness regressions |
| `docs/modernization/stage-0-execution-report.md` | Final Turkish evidence report, target matrix, risks and SHA/CI details |

**Artifact safeguards:** All screenshots must be from non-sensitive fixtures in an isolated browser profile, not personal projects. Do not commit browser user profiles, generated data URLs, base64 images, credentials, `.env`, enormous logs, or per-run temp files. Use deterministic fixture text and stable filenames.

---

## 3. Work packages — execute in priority order

Each work package is independent and testable. A blocker must be recorded instead of silently marked complete.

### S0.0 — Baseline, checkpoint, and current-source reconciliation (P0)

**Outcome:** real starting state and scope guard.

- [ ] S0.0.1 Confirm remote `main` SHA, active local branch, `git status --short`, `git log -5 --oneline`, `git remote -v`, Node/npm/OS, dependency lockfiles and available browsers.
- [ ] S0.0.2 Create a recoverable checkpoint before code changes. Keep any preexisting local edits; do not force-checkout, reset or clean the workspace.
- [ ] S0.0.3 Run `npm ci`, `npm run typecheck`, `npm run lint`, `npm test` and `npm run build` when executable. Keep actual logs and exit codes; historical **102/102** is not the new outcome.
- [ ] S0.0.4 Read current documentation and feature preservation matrix; record discrepancies between README, UI and code (e.g., README feature names vs actual rendered screen names).
- [ ] S0.0.5 Create work package status table (`NOT STARTED / ACTIVE / PASS / FAIL / BLOCKED`) in final report. State only verified blockers.
- [ ] S0.0.6 Capture exact baseline `git diff --stat` and patch hash; do not copy historical "local 7fdd283" SHA as current remote HEAD.

**Gate G0:** baseline and rollback approach documented. Nothing user-generated modified.

### S0.1 — Repair the real GitHub Chromium CI blocker (P0; first implementation task)

**Observed failure:** GitHub Actions run `45270690374`; Node verify job **SUCCESS**, `Browser E2E Smoke (Chromium)` **FAIL**. The browser step installed Chromium `--only-shell`, while `playwright-cli open --browser=chromium` tried to launch `chrome-for-testing`. This is a test setup mismatch, not proof of a UI regression.

**Files:** `.github/workflows/ci.yml`, maybe `scripts/e2e-browser-smoke.sh`. Avoid touching product UI to solve browser installation.

**Reproduction and evidence:**
- [ ] S0.1.1 Read `playwright-cli --help`, `playwright-cli open --help` and `playwright-cli install-browser --help` at the pinned version; inspect actual browser name resolution, cache paths, flags and installed executables.
- [ ] S0.1.2 Reproduce the same failure in a clean Linux or CI-equivalent setup: install `@playwright/cli@0.1.22` and only the `chromium --only-shell` browser; invoke the exact launcher; save failing exit/status. If local environment cannot reproduce, preserve GitHub log as explicit RED evidence.
- [ ] S0.1.3 Fix the root cause by installing the **actual executable requested by the CLI** (the error suggests `playwright-cli install-browser chrome-for-testing`) OR by configuring the CLI to use a confirmed-installed executable. **Check command syntax rather than blindly copying a suggested flag.** The installation must be compatible with the browser that runs E2E-A–I.
- [ ] S0.1.4 Add a minimal startup smoke assertion that the browser launches against a server health page before all nine flows; fail quickly with actionable diagnostic if the executable is missing.
- [ ] S0.1.5 GREEN: run the *actual browser launcher* and `bash scripts/e2e-browser-smoke.sh` end-to-end; E2E-A–E2E-I must execute rather than being skipped. If a functional failure surfaces, triage it separately and use TDD; never disable cases to turn CI green.
- [ ] S0.1.6 Preserve Node 22 typecheck/lint/test/build steps and job dependencies; ensure dedicated browser job is required for `main` where allowed by repository settings. Do not assert branch protection changed if no permission.
- [ ] S0.1.7 Upload screenshots, traces on failure, server logs and per-scenario results as CI artifacts with `if: always()` and reasonable retention/size. Ensure absence of user data/secrets. The workflow should report a failed browser run as a failed job, not as warning-only.
- [ ] S0.1.8 After an authenticated push, inspect the **fresh GitHub Actions run for the exact pushed SHA**. If push/CI cannot be performed in AI Studio, report `REMOTE CI BLOCKED` and provide commit references; local green is insufficient to call remote CI green.

**Acceptance:** Same GitHub job successfully installs and launches its browser, runs E2E-A–I and produces reviewed evidence artifacts; Node verify remains green. Do not leave CI failure masked.

### S0.2 — Deterministic visual-capture and fixture harness (P0/P1)

**Goal:** screenshots and flow assertions suitable for direct Figma comparison later.

**Do not** use real paid AI or privileged browser data. Use a temporary isolated browser context and stable simulated project fixtures. Prefer extending the existing Playwright CLI script and reusing shared helpers; avoid adding a competing second browser runner unless justified.

**Fixture set (required content, labels may be localized only for test data):**
- `FX-EMPTY`: no user projects; seed idea entry/first-run state.
- `FX-SIMPLE`: woodland mystery, named Fox/Cat, a location, clear directed relationships, confirmed vs AI-inferred attributes, two pending clarifications.
- `FX-BUSY`: ≥10 entities, multiple relationship labels/directions, ≥12 mixed decision items, at least one consistency issue, one excluded entity, multiple artifacts/revisions.
- `FX-OUT`: deterministic generated story text and four placeholder image outputs as appropriate; at least one outdated artifact and a past revision, with 0 external calls.
- `FX-ERROR`: storage-read error, write quota, invalid field, stale batch proposal or failed generation state (separate isolated contexts).

**Tasks:**
- [ ] S0.2.1 Define fixture generation using existing public app/project import paths and `migrateProjectPayload`. Prefer schema-compliant fixtures from current factory helpers; do not mutate IDs by hand if stable ID generation rules exist.
- [ ] S0.2.2 Seed fresh IndexedDB/localStorage cleanly for each context; verify reloading preserves the intended fixture. Make deterministic IDs/clock or assertions resilient to clock.
- [ ] S0.2.3 Provide a documented one-command local capture entrypoint using production build/server and the same package versions as CI, with explicit port/browser/viewport.
- [ ] S0.2.4 Include a strict no-network/paid-call trap: local app routes can be mocked by deterministic handlers, while upstream Gemini requests never reach remote service. Assert zero unmocked requests and zero console/page errors unless testing an explicit error state.
- [ ] S0.2.5 Capture screenshots with stable names and a machine-readable manifest: `capture-id, route/surface, fixture, action sequence, viewport, DPR if known, state, git SHA, screenshot path, expected focus/selection and relevant DOM anchors`. Protect against cropped/blank/loading captures.
- [ ] S0.2.6 Add lightweight image sanity checks (file exists, nonzero dimensions, not blank/unintended loading) and human-readable visual review requirement. An automated image existence check does not substitute for inspecting captured content.
- [ ] S0.2.7 Do not blindly commit every generated image. Optimize only reviewed representative screenshots; keep exhaustive sets in CI artifacts, link exact run IDs, and avoid large binary repository growth.
- [ ] S0.2.8 Document how to rerun captures and compare screens after future Figma implementation. Screenshot snapshots must not be hardcoded as immutable appearance tests until intentional baseline accepted.

**Acceptance:** One reproducible command yields valid desktop/mobile screenshots and a manifest for at least the required fixture families without ever exposing actual user projects or contacting Gemini.

### S0.3 — Current-state user journeys and UI interaction inventory (P1)

**Goal:** Map what the *real app* does — not what README claims or what a proposed design should do. Capture actual steps and corresponding screenshots/DOM evidence.

**Mandatory end-to-end journeys:**

| Journey | Scenario | Verify/capture |
| --- | --- | --- |
| J01 | First launch → create/select project → enter seed → Analyze (mock) | Empty state, first useful action, loading/error/ready |
| J02 | Review inferred attribute/relationship → Accept/Reject/Defer → inspect target | Correct provenance, project revision and graph |
| J03 | Clarification question → custom answer → skip/defer/refresh | Draft safety, statuses, focus |
| J04 | Story Bible grid/list → edit field → clear → Undo/Redo | Canonical state, focus, validation, persistence |
| J05 | Graph entity search, filter, pan/zoom, table view, directed relationship inspect/edit | Discoverability, state restoration, keyboard fallback |
| J06 | Natural-language batch instruction → preview selected changes → stale warning → Review modal → Apply/Cancel | Exact selected operations, visual diff, focus trap |
| J07 | Generate Story (mock) → read full artifact → copy/download → check outdated badge | Output discoverability, long text legibility |
| J08 | Switch Story ↔ Image (mock) → review images/previous artifacts | Visual gallery, mode state and history |
| J09 | Create A/B projects → A edit → B → A → reload → export/import JSON | Data survives, project switching is discoverable |
| J10 | Open Checks → navigate to affected entity/Story Bible field → return | No accidental edits, keyboard/mobile behavior |
| J11 | IndexedDB read error / quota / conflict / incomplete deletion | Alert hierarchy, truthful saved state, recovery |
| J12 | Revision history → restore → Undo/Redo and export | Destructive affordance, visibility and recoverability |

**Tasks:**
- [ ] S0.3.1 For every journey, record `precondition → visible controls → actions → postcondition → screenshot IDs → test evidence → UX friction`.
- [ ] S0.3.2 Inspect desktop `1440×900`, standard laptop `1280×800`, tablet `768×1024`, mobile `390×844`; test at one narrow viewport (~320px) if supported without changing code.
- [ ] S0.3.3 Record first click, navigation hops, hidden panels, scroll containers, context switching, duplicated actions and ambiguous labels. **Measure** counts from real steps; do not guess task time from static code.
- [ ] S0.3.4 Inventory entire existing header/nav, actions, graph toolbar, Inspector tabs, status notifications, key dialogs, create/import/export flows and keyboard shortcuts with precise source paths/DOM labels.
- [ ] S0.3.5 Take focused screenshots for `empty/working/loading/error/success/outdated/confirmation` states. For blocked states show a `BLOCKED` row with why, not an invented screenshot.
- [ ] S0.3.6 Observe focus and return path after each modal, graph click and tab switch; document keyboard-only vs pointer-only steps and any screen-reader uncertainty.
- [ ] S0.3.7 Generate `screen-inventory.md` and `journey-map.md` grounded in actually captured evidence, not prior Google AI Studio reports.
- [ ] S0.3.8 Preserve a checklist of existing abilities that Stage 1 UI cannot remove, using `docs/modernization/feature-preservation-matrix.md` as starting reference and reconciling with actual behavior.

**Acceptance:** Every journey has a verified flow and screenshot or a named blocker, with exact steps, DOM IDs or selectors, and evidence location.

### S0.4 — Accessibility, responsive behavior and interaction audit (P1)

**Do not claim WCAG compliance from automated tools alone.** Apply WCAG 2.2 AA as a review target, distinguishing static checks, browser behavior and screen-reader tests.

**Audit categories:**
- Semantic structure: page heading levels, ARIA region names, tablist/tab/tabpanel correctness, focus orders, keyboard activation on SVG node/edge elements, accessible icon labels.
- Keyboard & focus: `Tab`, `Shift+Tab`, `Enter`, `Space`, `Escape`; focus trap/return on Review modal and image preview; selected entity/relationship inspector routing; mobile checks navigation.
- Typography/readability: 10–12px labels, zoom 200%, long characters/Unicode, long generated stories, dark mode contrast and non-color cues for pending/confirmed/rejected.
- Responsive: overflow, overlapping toast/navigation, tiny tap targets, dialogs, nested scrolling and graph pan/zoom touch gestures; mobile bottom bar.
- Motion preferences: existing `prefers-reduced-motion` styles; verify animations don't hide content or leave essential state unreadable.
- Error recovery: meaningful messages for quota/read error, stale batch, malformed input, unavailable Gemini key and failed generation; discoverable escape route and no false "Saved" display.

**Tasks:**
- [ ] S0.4.1 Run an automated accessibility scan if available (axe-core is an option, not mandatory); save violations with selectors/impact. If dependency added, justify and pin appropriately. Keep scan failures distinct from product regressions.
- [ ] S0.4.2 Manually test the full J01→J12 critical paths by keyboard, with actual focus capture. Do not assume `aria-label` means an element is operable.
- [ ] S0.4.3 Measure color contrast on actual computed foreground/background for at least primary text, 11px helper text, pending vs confirmed, errors, both themes; record ratios or lack of reliable measurement.
- [ ] S0.4.4 Record exact element target sizes and keyboard focus visibility for high-frequency actions; do not invent universal 44×44 pass requirements. Use WCAG 2.2 target-size criteria and pragmatic mobile comfort as separate columns.
- [ ] S0.4.5 Verify main layouts at all target widths, 200% browser zoom and large text, with horizontal overflow and occlusion checks. Save DOM and screenshots for genuine failures.
- [ ] S0.4.6 Classify discovered issues: **P0 blocking use or data integrity**, **P1 high-friction accessibility**, **P2 nice-to-have**. Fix only narrow clear P0/P1 correctness blockers that have an isolated regression and will not preempt design decisions; otherwise document for Figma.
- [ ] S0.4.7 Document `axe result != WCAG conformance`, and specify manual screen-reader checks still needed if not performed.

**Acceptance:** A prioritized, reproducible accessibility and responsive issue log tied to actual controls/screenshots, with actionable acceptance tests.

### S0.5 — Performance, rendering, bundle, stability and code health baseline (P1)

**Goal:** Prepare numerical engineering baselines and identify true implementation blockers, without speculative rewrites.

**Targets and methodology:**
- Use `npm run build` output for JS/CSS chunk sizes, source maps only if safe, and Vite bundle warnings; distinguish compressed transfer from uncompressed output.
- Capture browser `navigation`, `DOMContentLoaded` or first visible workspace, UI interaction latency (graph click, tab switch, large decision list scrolling) using Chrome Performance API/traces or equivalent; record hardware/runner.
- Graph `lib/graphLayout.ts` uses iterative force simulation; stress synthetic `10/30/100/250` entity cases separately, with realistic relationships and fixed seeds where possible. Measure render/layout time and memory, NOT arbitrary fabricated throughput. Avoid calling the actual paid model.
- Test long 8,000-character compiled prompt boundary, long project name, very long character name, 100+ decisions, 4 generated image placeholders, large artifact history and high-latency mocked requests.
- Inspect existing `App.tsx` size (~2,333 lines at baseline), `ContextualInspector.tsx` (~1,614), `BeliefGraph.tsx` (~977), `DecisionInboxPanel.tsx` (~729). Length is a **maintainability clue, not a defect**. Identify high-churn dependencies and re-render risks rather than splitting reflexively.
- Inventory `server/routes.ts` boundaries and key handling. A public deployment using a shared paid key without authenticated quotas would require architecture/security work, but **Stage 0 only records that conditional requirement**.

**Tasks:**
- [ ] S0.5.1 Capture build outputs and reproducible bundle numbers; inspect chunk graph or use an appropriate low-cost analyzer if warranted. Record test environment.
- [ ] S0.5.2 Measure startup, empty vs busy graph render, input responsiveness and route/modal actions; report median and repeated runs if feasible, raw observations otherwise. Do not state new performance SLAs without a baseline.
- [ ] S0.5.3 Execute synthetic graph cases, record entity/edge count, device/viewport, duration and layout stability; if ≥100/250 causes freeze, write an evidence-backed issue and a minimal test, not a sweeping new graph renderer.
- [ ] S0.5.4 Capture browser memory/storage size for text and image artifacts if safely measurable. Include IndexedDB/localStorage storage quota failure UX; preserve data.
- [ ] S0.5.5 Record technical debt with **severity × likelihood × user impact × confidence** and exact source reference. Do not count file size alone as proof of an issue.
- [ ] S0.5.6 Review whether frontend uses one truth for Save/Unsaved, mode selection and generation actions. Categorize duplicated controls as design observations, not immediate deletion instructions.
- [ ] S0.5.7 Produce `measurements.md` with source, methodology, actual numbers, limitations, and recommendations for future comparison.

**Acceptance:** quantitative baseline where measurable, explicit not-measured labels elsewhere; no untested optimization claims.

### S0.6 — Product value / scope audit and Figma-ready handoff (P1)

**Goal:** Turn the real code and captured UI into decisions the Product Design + Figma phase can act on.

**Compare three product design hypotheses; DO NOT implement any in Stage 0:**
1. **Workflow-first Creative Studio:** Idea, World, Decisions, Create as easily switchable workspaces with context inspector.
2. **Graph-first Visual Canvas:** graph is primary, Story Bible and decisions dock as panels; good for graph-heavy tasks.
3. **Writing-first Editorial Studio:** writing/output central, scene/world tools contextually accessible; good for authors.

**Evaluate each against actual J01–J12 journeys, complexity, discoverability, output legibility, migration risk and user authority. Provide justified recommendation and disconfirming evidence; do not declare user approval or auto-build a fourth concept.**

**Critical new insights from prior analysis to validate, not blindly accept:**
- Graph currently occupies ~50% of extra-large workspace while generated stories appear in a shallow output deck; determine actual impact on reading. UI could benefit from a full-height output surface.
- Story generation output currently reads/copies/downloads text and does not provide native editable manuscript content; determine whether a full editor is a later phase rather than a Stage 0 priority.
- Project creation/import/export are nested under the right-side History tab, potentially hiding foundational project management.
- Story/Image and Generate actions appear in both PromptInput and bottom action bar; record whether duplication confuses user or supports workflow.
- `Header` has an `activeSection` prop default `workspace`; inspect actual passed props and displayed active navigation state before calling this a bug.
- Rule-based consistency checks cover a subset of contradictions; do not label it a comprehensive semantic continuity engine or show AI certainty.
- Local browser persistence is not cloud sync. Status text must not promise cloud protection.
- UI content is English; internationalization and generation language selection are later product decisions, not an automatic Stage 0 translation.
- Public usage, subscription, paid API budgets and accounts are not specified; make their requirements CONDITIONAL.

**Tasks:**
- [ ] S0.6.1 Document primary/secondary user jobs and map each existing UI surface to user goal. Distinguish first-time users from experienced graph-heavy creators **as hypotheses**, not statistically verified personas.
- [ ] S0.6.2 Build an interaction inventory: action label, location, trigger, precondition, after-state, authoritative model fields, undoability, loading/error, keyboard, exportability, presence in current tests.
- [ ] S0.6.3 Produce a **source-of-truth map**: `originalIdea → analyze → proposed entities/clarifications → explicit acceptance → Story Bible/graph → synthesized refined prompt → generation → artifacts`, including stale proposal and failure branches. This should be precise enough to prevent Figma mockups from implying automatic AI authority.
- [ ] S0.6.4 Produce `figma-handoff.md` with current screen map, state variants, responsive breakpoints, color/type tokens from `index.css`, component reuse candidates, required status/provenance indicators, dark/light, sample data and screenshot pointers.
- [ ] S0.6.5 Include an explicit **do-not-invent** table: chapters/scenes, editable story manuscript, full timeline, cloud sync, multiuser collaboration, free unlimited paid AI, guaranteed character image consistency, comprehensive semantic checks — all NOT currently backed by code.
- [ ] S0.6.6 Form a prioritized Figma design brief: top user tasks, essential content hierarchy, fidelity constraints, 3 alternative concepts, criteria for selecting one, accessibility expectations, desktop/mobile views, and what future UX tests must prove.
- [ ] S0.6.7 Deliver a separate **deferred roadmap** for actual product changes (draft editor, multi-chapter world model, controlled image count/aspect ratio, more advanced consistency, model configuration and costs) with discovery/preconditions and risk; do not implement or promise these.
- [ ] S0.6.8 Review findings from screenshots vs code: `Observed`, `Measured`, `Inferred`, `External community signal`. Avoid claiming screenshot-based UX proof from source alone.

**Acceptance:** A Figma designer who has not seen the code can recreate *current* supported states, understands boundaries, and can explore three distinct redesign directions without accidentally inventing or removing product behavior.

### S0.7 — Narrow evidence-backed fixes, regression safety, and final review (P1; conditional)

**This package is NOT a license to start Stage 1.** Only code corrections that unblock reliable Stage 0 verification or fix directly demonstrated P0/P1 usability/accessibility failures.

Examples that may qualify **only after reproduction**:
- Browser CI executable mismatch (S0.1) — already verified.
- Focus lost after an existing review modal, critical action unclickable at mobile width, or a real browser overflow blocking the primary Generate action.
- Misleading confirmation that a save succeeded when persistence is blocked (must preserve storage meaning).
- Dangerous destructive UI affordance without an existing guard (requires targeted scenario and test; no whole project-management redesign).
- A test harness that accidentally reaches a live API.

Examples that **do not** qualify:
- Replacing the three-column shell with the eventual four-workspace UI.
- Recoloring global tokens, brand refresh, new typography style or reorganizing the whole navigation.
- Adding a rich text editor, dashboard, onboarding wizard, cloud login or full semantic consistency engine.
- Rewriting `App.tsx` and `storageEngine.ts` without reproducible P0/P1 cause.
- Removing existing controls merely because future mockups may be cleaner.

**Tasks:**
- [ ] S0.7.1 For each candidate, create a reproduction statement (steps, expected vs actual, DOM/screenshot, root cause, severity). Have a **no-change** option for unconfirmed observations.
- [ ] S0.7.2 Write the smallest failing behavior test (RED) and confirm its failure is caused by the alleged defect, not the test environment.
- [ ] S0.7.3 Apply minimal fix (GREEN), repeat source/keyboard/browser evidence, refactor only if needed, rerun all relevant tests.
- [ ] S0.7.4 Check snapshot/schema/migration, CAS/Undo/Redo, graph identity, unconfirmed AI gating, batch preview, local backup and non-billable API trap are unchanged.
- [ ] S0.7.5 Commit each logically isolated validated fix; report paths/SHA and any honest skipped tests.
- [ ] S0.7.6 Final task = second six-cycle adversarial review in `6` below, then fresh full CI-compatible verification and, if authorized, actual remote GitHub Actions verification for resulting SHA.

**Acceptance:** All Stage 0 fixes have reproducible root-cause evidence and new regression tests; all deferred product/UI changes remain deferred.

---

## 4. Explicit audit/capture contract for Figma comparison

### 4.1 Required screenshot/state matrix

Record a reviewed screenshot or BLOCKED evidence for each line. A manifest entry is not a screenshot.

| ID | Viewport | Fixture | Visible state / UI | User-facing question |
| --- | --- | --- | --- | --- |
| SC-01 | 1440×900 | FX-EMPTY | First launch/idea entry | What should I do first? |
| SC-02 | 1440×900 | FX-SIMPLE | Decision Inbox with pending/confirmed examples | What's AI's suggestion vs my decision? |
| SC-03 | 1440×900 | FX-SIMPLE | Belief Graph selected entity and Inspector | Can I inspect/edit the right thing? |
| SC-04 | 1440×900 | FX-BUSY | Graph/table with ≥10 entities and filters | Does the graph stay understandable? |
| SC-05 | 1440×900 | FX-BUSY | Story Bible structured edit and inline validation | Can I edit and understand confirmation? |
| SC-06 | 1440×900 | FX-BUSY | Checks with navigate-to-target | Can I resolve a problem from its context? |
| SC-07 | 1440×900 | FX-BUSY | Batch preview + Review Before/After | Are proposed effects and choices clear? |
| SC-08 | 1440×900 | FX-OUT | Generated story, outdated artifact and history | Can I read/use what I generated? |
| SC-09 | 1440×900 | FX-OUT | Image gallery and fullscreen preview | Are output/gallery interactions clear? |
| SC-10 | 1440×900 | FX-BUSY | Project/history/export and revision restore | Can I manage and recover my work? |
| SC-11 | 390×844 | FX-SIMPLE | Mobile graph/Inspector/Inbox | Is context switching understandable? |
| SC-12 | 390×844 | FX-OUT | Mobile Story output and action bar | Can I actually read/produce on mobile? |
| SC-13 | 1280×800 | FX-BUSY | Complete cramped laptop workspace | What becomes too small/hidden? |
| SC-14 | 768×1024 | FX-SIMPLE | Tablet navigation and Story Bible | Do breakpoints fit real use? |
| SC-15 | 390×844 | FX-ERROR | Storage error/recovery or validation message | Can I recover without losing data? |
| SC-16 | 1440×900 | FX-SIMPLE | Dark theme high-contrast controls | Are status and readability sufficient? |

**For each capture log:** timestamp, exact SHA, screen ID, viewport, data fixture, active panel/tabs, visible controls, zoom, image resolution, pass/reject, issue IDs, local/CI artifact path, reviewer notes and any privacy redactions.

### 4.2 Journey reporting example

```markdown
### J04 — Story Bible correction, Undo/Redo, reload

Precondition: FX-SIMPLE with confirmed setting "Forest Cottage".
1. Select the Story Bible view. (DOM target and SC-05)
2. Edit setting to "Rainy Harbor". Confirm the new value is rendered.
3. Clear the field. Assert it is no longer confirmed / previous value does not revive.
4. Undo then Redo. Assert correct value/status and label.
5. Reload a fresh browser context with same storage and verify consistency.

Measured: steps/clicks, visible loading, focus, accessibility, any confusion.
Evidence: screenshot ID, test name, log output, SHA.
Status: PASS/FAIL/BLOCKED and details.
```

The words in this example are fixture data, not a claim that the journey was executed.

### 4.3 Severity/priority schema

Every issue needs: stable ID, observed timestamp/SHA, user goal, precise repro, affected user, screenshot/DOM evidence, expected/actual, classification, confidence, severity, effort estimate as a rough category (not a fake schedule), workaround, owning stage and proposed acceptance test.

Priorities:
- **P0** data loss, credential exposure, critical workflow entirely blocked.
- **P1** repeated/high-impact user failure, inaccessible primary action, browser CI failure blocking ongoing development.
- **P2** non-blocking cognitive load, redundant controls, discoverability, focus/spacing/design-system deficiencies.
- **P3** speculative enhancements and unvalidated preferences.

Frequency must be marked `UNKNOWN` without usage telemetry or a representative user study. Severity is not the same as measured prevalence.

---

## 5. Required verification commands and evidence

Use exact project commands:

```bash
npm ci
npm run typecheck
npm run lint
npm test
npm run build
node -e 'import("./server.ts")'
# Start built application with Node 22 in a fresh shell/session:
NODE_ENV=production PORT=3000 node server.ts
# In another shell after health check:
bash scripts/e2e-browser-smoke.sh
```

Inspect current Playwright CLI help before selecting installation command; ensure the browser executable selected by the launcher is actually present. Do not assume arbitrary local `/usr/bin/chromium` path. Keep browser version and install method pinned/reproducible.

If adding a new screenshot command, document usage and prove the screenshots were actually produced and visually inspected. Record how to run locally without paid AI and where sanitized artifacts live.

**Fresh GitHub Actions proof:** Retrieve workflow run URL and `head_sha` for the new commit; inspect both `Verify (Node 22.x)` and `Browser E2E Smoke (Chromium)` job conclusions and raw relevant log lines. Report exact tests from the final run, not historical `102/102`.

**Failure triage:** A skipped browser run, no screenshots produced, missing secrets, a failed CI or an agent tool limitation must become `BLOCKED` or `FAIL` with evidence. Never invent a PASS or replace Playwright proof with a text grep of source files.

**Budget / security:** Live Gemini and any external paid model generation are **not authorized** in Stage 0. Public deployment and authentication changes are **out of scope**; record risks as conditional.

---

## 6. Two-pass Six-Cycle Iterative Refinement

### 6.1 Pass A — Preimplementation brainstorming and specification refinement (completed for *this plan*, must be re-run against latest repo)

The six entries below are **design critique performed while drafting this specification**. They are not executed tests, user interviews, generated screenshots or code fixes.

1. **A1 — User outcome.** Questioned whether Stage 0 should beautify UI or validate current UX. Outcome: fix reproducible CI, capture actual screens and preserve behaviors; defer visual design.
2. **A2 — Existing capability inventory.** Re-read code/README to distinguish genuine controls (graph, decision, Story Bible, batch, artifacts, backup, undo) from proposed later features (manuscript editor, chapter timeline, cloud). Outcome: a preservation and do-not-invent matrix.
3. **A3 — Technical root cause and value.** Verified browser job installed `chromium --only-shell` while launcher wanted `chrome-for-testing`; rejected speculative React rewrites. Outcome: narrow CLI/browser environment fix first.
4. **A4 — Accessibility and responsive challenges.** Challenged assumptions from JSX layout and old screenshots; required current DOM, desktop/tablet/mobile, keyboard and actual screenshots before making severity judgments.
5. **A5 — Counterexamples and safe fixtures.** Considered large graphs, stale artifacts, quota/read errors, long Unicode text, unconfirmed proposals, and paid API traps. Outcome: reproducible fixture families and no-network assertions.
6. **A6 — Scope/evidence adversary.** Challenged the temptation to add a new app shell or report "green" from historical logs. Outcome: strict Stage 0/Stage 1 boundary, logged test/CI evidence and explicit blocked status.

### 6.2 Pass B — Second review *of this written plan* (completed as planning critique)

1. **B1 — Coverage audit.** Each essential user job J01–J12 and capture SC-01–16 maps to a work package and final artifact; requested end-to-end run is substantial but bounded.
2. **B2 — Dependency audit.** Ensured E2E executable must be repaired before insisting on screenshot coverage; fixtures precede capture; capture precedes UX conclusions; UX evidence precedes Figma handoff.
3. **B3 — Data/API safety audit.** Required isolated fixtures, no secrets, zero upstream requests, storage and schema invariants, fail-closed evidence, and no destructive cache changes.
4. **B4 — Usability and accessibility audit.** Added actual keyboard focus, zoom, contrast, mobile/tablet and graph/table fallback; avoided the false assumption that static accessibility attributes guarantee interaction quality.
5. **B5 — Measurement integrity audit.** Distinguished screenshots, observed UI behavior, lab timings, code inference and external community opinions; added environment detail and unknown frequency.
6. **B6 — Feasibility audit.** Prevented endless product scope expansion; designated mandatory gates, optional only-if-verified fixes, and fallback for unpushable CI, while preserving final decision inputs for Figma.

### 6.3 REQUIRED additional six-cycle review *after actual implementation*

The executing agent must conduct and document a **fresh postimplementation review**, not copy `6.1–6.2` as completed implementation:

1. **P1 — Final diff & scope:** inspect every changed file; reject any unapproved UI redesign, paid API call, new data schema or disabling of regressions.
2. **P2 — User-data/provenance:** audit project save, migration, backups, Undo/Redo and AI acceptance unaffected by test tooling or UI fixes.
3. **P3 — Adversarial browser:** execute E2E-A–I + Stage 0 critical journeys with slow/fast conditions, stale proposals, storage failures and fresh contexts; look for regressions.
4. **P4 — Responsive/accessibility:** inspect actual accepted screenshots at all target sizes; keyboard, focus, touch, contrast; fix only P0/P1 verified regressions.
5. **P5 — CI/performance evidence:** compare fresh Node/test/build and browser job conclusions, artifacts, timings and bundle to baseline; correct false green reports.
6. **P6 — Independent builder check:** read artifacts as a Figma designer who has no repo context; ensure enough to draw the actual screens and assess redesign alternatives. Record remaining gaps, go/no-go and next stage.

**Important:** Every cycle documents evidence, newly found issue, disposition, re-test if fixed, final SHA. Six narrative bullets without reviewing actual results are not six completed cycles.

---

## 7. Delivery gates and status matrix

| Gate | Requirement | Evidence; cannot pass if |
| --- | --- | --- |
| G0 | Real latest remote source + checkpoint and baseline | No actual SHA, unsafe dirty tree |
| G1 | Browser-install root cause repaired | Browser cannot launch, E2E cases skipped |
| G2 | Existing E2E-A–I completed in actual browser | Just source-based or mocked helper tests |
| G3 | Reproducible fixture/capture suite, screenshot manifest | Blank/cropped/generated fake captures, actual user data |
| G4 | J01–J12 flow inventory and evidence | Unvisited critical paths silently PASS |
| G5 | Accessibility & responsive evaluation with real focus/screens | Only theoretical CSS critique |
| G6 | Bundle, graph and UX performance measurements | Fabricated metrics or missing environment |
| G7 | Figma handoff and no-invent capability matrix | Assumed features or unsupported design claims |
| G8 | Fresh Node checks and real remote browser CI | Only local green or a missing GitHub Actions run |
| G9 | Actual postimplementation six-cycle adversarial review | Copied pre-review or no re-tests after fixes |

**Reasonable graceful degradation:** When browser/CI permissions are unavailable, finish valid source-based inventories and docs, but set screenshot-dependent and remote-CI gates to **BLOCKED**. State the precise missing capability and next reproducible action. Partial verified work beats fake completion.

**Prioritization if resources are constrained:** S0.0 → S0.1 → S0.2 → S0.3 J01/J02/J04/J06/J07/J09/J11 → S0.4 → S0.5 → S0.6 → S0.7 final review. Do not sacrifice the CI fix and truthful evidence to create more low-value prose.

---

## 8. Final Turkish execution report — mandatory structure

Write `docs/modernization/stage-0-execution-report.md` and provide a concise final summary in Turkish:

1. **Executive outcome:** What Stage 0 accomplished, what was not accomplished, go/no-go for Figma.
2. **Repo facts:** Starting actual remote SHA, checkpoint, final local SHA and final remote SHA; branch/push state and changed-file inventory. Do not confuse local and remote commits.
3. **S0.0–S0.7 and G0–G9:** PASS/FAIL/BLOCKED/NOT TESTED table with command/log/file/screenshot/run URL for every claim.
4. **CI regression:** Historical `45270690374` fail reason, exact change made, local RED/GREEN evidence, GitHub Actions new run URL/sha for both jobs, screenshot/trace artifacts.
5. **Current user journeys:** J01–J12 table, actual clicked path, DOM evidence/screen IDs, difficulty and whether task was completed.
6. **Screenshots:** SC-01–SC-16 manifest and accepted/rejected/BLOCKED status; link sanitized captures or CI artifacts; no fake screenshots.
7. **Accessibility & responsive findings:** confirmed issues, impact, screenshots, WCAG limitations and fixed vs deferred issues.
8. **Performance:** numeric measurements and environment, graph size thresholds, bundle sizes, caveats; no made-up targets.
9. **Technical and safety risks:** storage, misleading UI state, API key/public deployment (conditional), pending-vs-confirmed AI decisions, current CI, migrations and export.
10. **Preserved functionality:** every key capability from feature-preservation matrix with regression evidence or explicit NOT TESTED.
11. **Figma handoff:** link to `docs/ux-baseline/figma-handoff.md`, recommended candidate strategy, top 5 UX hypotheses to test, unresolved scope choices, no UI code written.
12. **Postimplementation six-cycle log:** P1–P6 findings, actual evidence, fixes and retests, any new risks.
13. **Next-step recommendation:** exactly what the owner and Figma/Product Design should do next, what not to redesign, which unresolved evidence blocks proceeding.

### No fabricated evidence

Acceptable statements:
- "Node suite 102 tests PASS on historical SHA `faf580e`, verified in GitHub run `45270690374`."
- "Browser E2E failed before test execution due to missing `chrome-for-testing`."
- "Current run [new SHA] passed both jobs, 9 browser scenarios and 102+ unit tests" **only if the actual new logs confirm it**.
- "Could not inspect screenshot because browser unavailable; marked BLOCKED."

Unacceptable:
- "Everything is production ready" because a test script exists.
- "Six cycles executed" because six points were written.
- "WCAG compliant" because axe reported zero violations.
- "Measured performance" using predicted values.
- "Generated images successfully" using placeholders or paid calls that were never made.

---

## 9. Baseline references (re-check at latest HEAD)

- [GitHub repository](https://github.com/Centaurioun/Proactive-Co-Creator)
- [Historical baseline `faf580e`](https://github.com/Centaurioun/Proactive-Co-Creator/commit/faf580e30532481fdf9c8e4113084f6fb07340de)
- [Failed GitHub CI run `45270690374`](https://github.com/Centaurioun/Proactive-Co-Creator/actions/runs/45270690374)
- [Current CI YAML at baseline](https://github.com/Centaurioun/Proactive-Co-Creator/blob/faf580e30532481fdf9c8e4113084f6fb07340de/.github/workflows/ci.yml)
- [Existing browser smoke script](https://github.com/Centaurioun/Proactive-Co-Creator/blob/faf580e30532481fdf9c8e4113084f6fb07340de/scripts/e2e-browser-smoke.sh)
- [Existing verification report](./verification-report.md)
- [Feature preservation matrix](./feature-preservation-matrix.md)
- [Previous Story Bible & data safety plan](./2026-11-17-story-bible-consistency-data-safety-implementation-plan.md)
- [Current README](../../README.md)

---

## 10. One-paragraph executor directive

Read the complete Stage 0 specification and live source at the actual newest `main`. Follow Superpowers Brainstorming, Systematic Debugging, Writing Plans, TDD and Code Review. Complete the CI browser-executable root-cause fix first, then run real no-paid-API browser journeys, capture and inspect deterministic screenshots, perform accessibility/performance/interaction audits, write the screen inventory and Figma-ready handoff, fix only reproduced P0/P1 blockers and execute the final six-cycle adversarial review. Run every quality gate and verify a fresh remote GitHub Actions run when authenticated access permits. Preserve canonical state, 2.0 features and schema, and do not build the redesign itself. Deliver a **Turkish evidence-based report** with real SHAs, artifacts, completed/blocked gates and concrete next actions. Never fake a PASS, rewrite the architecture, force-push or initiate paid Gemini calls.

**END — STAGE 0 ONLY.**
