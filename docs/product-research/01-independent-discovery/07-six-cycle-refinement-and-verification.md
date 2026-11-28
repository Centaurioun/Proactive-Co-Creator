# 07 — Six-Cycle Refinement Record, Coverage Matrix & Final Critical Review

**Assignment:** `PCC-RESEARCH-01`  
**Parent Index:** [`README.md`](./README.md)  
**Cross-References:** [`01-product-purpose-and-current-state.md`](./01-product-purpose-and-current-state.md) · [`02-functional-findings-and-root-cause.md`](./02-functional-findings-and-root-cause.md) · [`03-ux-ia-and-user-journeys.md`](./03-ux-ia-and-user-journeys.md) · [`04-ai-quality-narrative-intelligence-and-architecture.md`](./04-ai-quality-narrative-intelligence-and-architecture.md) · [`05-creative-product-discovery-and-concepts.md`](./05-creative-product-discovery-and-concepts.md) · [`06-recommendations-strategy-and-roadmap.md`](./06-recommendations-strategy-and-roadmap.md)

---

## 1. Six-Cycle Iterative Refinement Log

Per Assignment §5, each cycle was required to **change, sharpen, or challenge** our understanding rather than serve as ceremonial headings. Below is the substantive record of how initial hypotheses evolved as source code, live browser behavior, and live AI outputs were examined.

### Cycle 1 — Discover and Frame
- **What we did:** Reconstructed PCC's evolution across `README.md`, `docs/superpowers/specs/2026-11-14-proactive-co-creator-2-design.md`, `docs/implementation/narrative-workspace/01-consolidated-product-spec.md`, and the active source tree (`App.tsx`, `Header.tsx`, `shared/`, `lib/`, `components/`, `server/`). Mapped the current feature surface against the four core user needs (Start with an idea, Understand an existing narrative, Develop and improve a story, See and manage the narrative).
- **Initial hypothesis:** PCC looked on paper like a mature, well-architected narrative workspace that merely suffered from some UI complexity and multi-provider friction.
- **What changed:** Tracing `lib/promptBuilder.ts` alongside `ManuscriptEditor.tsx` revealed a much deeper structural split: **Era 1/2 ("Prompt & Belief Graph Studio" in `Plan`) and Era 3 ("Working Manuscript Workbench" in `Write`/`Review`) are two loosely bolted applications.** `promptBuilder.ts` never reads a single word of `Working Manuscript`, while the default landing page opens an empty `Write` tab on a sample project whose entire content lives in `Plan`. Framing PCC around this *Two-Product Split* became the organizing lens for Cycles 2–6.

### Cycle 2 — Investigate and Gather Evidence
- **What we did:**
  - Executed headless Chromium visual/DOM inspection (`1440×900` desktop and `390×844` mobile) on `http://localhost:3000`, capturing and reviewing 4 rendered viewport screenshots (`01-initial-landing`, `02-plan-default`, `03-plan-with-inbox`, `04-review-default`), then deleting temporary Playwright artifacts cleanly.
  - Executed bounded live synthetic probes against `http://127.0.0.1:3000/api/*` using the available managed Gemini connection (`gemini-4-hydrogen`, policy `2026-11-27.1`) across 3 synthetic narratives (Minimal Seed, Developed Story Brief, Multi-Chapter Ambiguous + Contradictory Narrative) covering 10 endpoints.
  - Traced every observed failure and limitation directly to source symbols (`server/aiService.ts`, `server/narrative/extractionService.ts`, `lib/narrative/import/proposalValidator.ts`, `lib/narrative/asyncReviewActions.ts`, `lib/narrative/writing/selectionHelpers.ts`, `server/providers/runtime.ts`, `lib/consistencyChecker.ts`, and all four projection view components).
- **Surprises that overturned assumptions:**
  1. **`POST /api/generate/story` failed live (`F-02`):** Expected a basic generated story; instead hit a `60,017 ms` timeout on `gemini-4-hydrogen` AND discovered `classifyWithSignal` misclassifies internal timeout aborts as non-retryable `499 CANCELLED`.
  2. **`POST /api/narrative/import/extract` failed live (`F-04`):** Returned `502 MODEL_UNSUPPORTED` on the active default model plan. Deeper source tracing uncovered three compounding architectural landmines even if the `502` is fixed: LLM-predicted exact UTF-16 character offsets enforced fail-closed by `proposalValidator.ts:83-87`, `maxOutputTokens` clamped to `2048` (`extractionService.ts:168`), and missing `stripJsonFences` (`extractionService.ts:180`).
  3. **`POST /api/batch-edit` silently dropped `nextValue` (`F-03`):** Validated structurally because `nextValue` is optional/nullable in the shared schema, producing unusable `update_story_bible` proposals live.
  4. **Four "visual views" are not visual (`F-08`):** Source inspection of `TimelinePanel.tsx`, `MindMapPanel.tsx`, `EgoMapView.tsx`, and `FamilyKinshipView.tsx` revealed plain HTML lists/tables—and `TimelinePanel` sorts narrative chronology via broken `localeCompare` string comparison (`"Day 10"` before `"Day 2"`).
  5. **Writing Assistant prose quality was unexpectedly strong (`F-06`):** Live output from `/api/narrative/writing/assist` (`6.9s`) was genuinely literary, concrete, and atmospheric—proving that PCC's biggest AI prose problem isn't model quality, it's **context starvation** (omitting relationships, prior chapters, scene metadata, and excluded entities) and **hidden discoverability** (collapsed `<details>`).
  6. **Silent truncation & broken `changed` scope in Diagnostics/Sync (`F-05`):** Source inspection of `asyncReviewActions.ts` showed hardcoded `sections.slice(0, 8)` and `text.slice(0, 5_000)` with zero UI warning, `changed` scope sending the same first 8 sections, and `belief`/`reported` entities stripped before analysis.

### Cycle 3 — Diverge and Invent
- **What we did:** Stepped back from defect remediation and asked first-principles questions as a novelist, short-story writer, and visual product designer: *Why would a writer choose PCC over Google Docs + ChatGPT, Scrivener, or Sudowrite?*
- **Key creative breakthroughs (`05-creative-product-discovery-and-concepts.md`):**
  - Recognized PCC's **two rarest under-leveraged assets**: (a) its **explicit vs. inferred Belief Graph** and (b) its **epistemic provenance taxonomy** (`explicit`, `interpretation`, `belief`, `reported`, `ambiguous`, `user-authored`). Almost no writing tool tracks *who believes what* vs. *what is canonically true*.
  - Generated 8 distinct concepts (`C-01` through `C-08`), including **Epistemic Perspective Lenses ("Who Knows What?")** (`C-02`), **Dual-Track Visual Timeline & Spatial Graph Lenses** (`C-03`), **What-If Narrative Forking & Ripple Sandboxes** (`C-04`), **Guided Seed-to-Scene Discovery Studio** (`C-05`), **Dialogue Voice & Subtext Workbench** (`C-06`), **Progressive Zero-Ceremony Ingestion** (`C-07`), and **Spoiler-Free Beta-Reader Simulator** (`C-08`).
  - Also ideated three structurally distinct Information Architectures (`Option A` Refined 3-Mode, `Option B` Two-Surface Story Studio with persistent Contextual Margin, `Option C` Canvas-First Spatial Workspace).

### Cycle 4 — Challenge and Compare
- **What we did:** Subjected every own concept, IA option, and architectural idea to adversarial review across author control, cognitive load, failure modes, AI token consumption, data integrity, and long-form scaling.
- **Concrete rejections, demotions, and pivots (`06 §3`):**
  - **Rejected Option C (Canvas-First Spatial Workspace):** Visually exciting for ideation, but degrades sustained 2,000-word prose drafting and breaks cleanly on mobile/narrow screens.
  - **Rejected Strategy 3 (Autonomous Agentic Co-Author):** Would turn PCC into a commodity chat wrapper and violate PCC's core safety and author-control DNA.
  - **Rejected Numeric Prose Quality / "Originality" Scores:** Encourages formulaic homogenization and false precision; constrained `C-06` strictly to qualitative voice observations and local cadence visualizations.
  - **Rejected Full Git-Style Multi-Branch Version Control:** Too complex for fiction writers; narrowed `C-04` to a single ephemeral **What-If Sandbox** with atomic Adopt/Discard.
  - **Rejected Automatic AI Canon Edits During Typing:** Violates author-in-control canon and causes intrusive noise; constrained `C-01` margin checks to passive, opt-in **Whisper** indicators.
  - **Demoted `C-08` (Spoiler-Free Beta-Reader Simulator) to Exploratory R&D (`R-20`):** High creative upside, but token cost grows linearly with chapter count and strict spoiler-masking accuracy needs real prototype validation before committing roadmap priority.

### Cycle 5 — Refine and Make Actionable
- **What we did:** Translated surviving proposals into concrete UX flows, ASCII wireframes, before/after writer journeys (`03 §4–§5`), conceptual TypeScript interfaces (`SectionContextIndex`, `EpistemicFact`, `NarrativeForkSandbox`), deterministic quote-to-offset anchoring pseudocode (`04 §4.4`), a 4-provider capability separation matrix (`04 §3`), future acceptance tests (`04 §5`), and concrete synthetic-story walkthroughs for every major concept (`05 §2`).
- **Key refinement made during Cycle 5:** Realized that `C-01` (Contextual Margin), `C-02` (Epistemic Lenses), `C-04` (What-If Sandboxes), and full-novel Diagnostics (`F-05`) all share **one single architectural bottleneck**: PCC currently lacks a derived, deterministic **Narrative Memory Index** (`R-11`). Designing `R-11` as a rebuildable derived cache (never a second source of truth) simultaneously solves long-form truncation, enriches Writing Assist, enables Epistemic Lenses, and protects PCC's existing persistence guarantees.

### Cycle 6 — Synthesize and Review
- **What we did:** Reconciled all 15 confirmed findings (`F-01`–`F-15`), 8 concepts (`C-01`–`C-08`), and 20 prioritized recommendations (`R-01`–`R-20`) into a coherent 4-phase non-authorized roadmap (`06 §4`) with 5 explicit owner decision gates (`06 §5`). Audited the entire research package for contradictions, unsupported claims, broken cross-references, coverage gaps, and strict compliance with the documentation-only boundary.
- **Corrections made during Cycle 6 review:**
  - Verified that all live failure claims cite exact observed HTTP status codes and latencies from our `2026-11-28` run, while keeping unexecuted areas (`gemini-personal`, `chatgpt-plan`, `openai-api`, `generate/images`, live `opportunities/explore` body after transient `503`, malformed binary `.docx`/`.pdf` stress cases) explicitly marked **Unverified**.
  - Verified consistent evidence labels across all 8 documents and ensured no code, config, test, or existing doc file was touched.

---

## 2. Methodology, Independence & Limitations Disclosure

Per Assignment §3, §4, and §5, we record the following disclosures with strict transparency:

1. **Prior-Session Context Exposure (Assignment §3):** Earlier turns in this same environment involved functional auditing and remediation work on PCC prior to receiving `PCC-RESEARCH-01`. To uphold independence to the maximum degree possible:
   - All observations in this research package were re-verified directly against the **current workspace files and live `2026-11-28` preview** (`http://localhost:3000`).
   - No unpublished future-product proposals, external feature catalogues, or other git branches were consulted.
   - Where historical specifications (`README.md`, `2026-11-14-proactive-co-creator-2-design.md`, `01-consolidated-product-spec.md`) are cited, they are explicitly tagged `[Reported by historical documentation]` and contrasted against observed current behavior.
   - Because earlier work touched the codebase before this assignment started, we **do not claim absolute tabula-rasa independence**; we explicitly disclose this context per Assignment §3.
2. **Skills & Reasoning Methods (Assignment §5):**
   - Superpowers skills were **not installed** in this runtime environment. Equivalent structured engineering and product-research methods (first-principles discovery, source-to-runtime root-cause tracing, divergent creative ideation, adversarial critique, and verification-before-completion) were applied directly without claiming unavailable Superpowers skill invocations.
   - The local `computer-use` (`playwright-cli`) skill was used solely for read-only visual/DOM inspection of `http://localhost:3000`; its temporary `.playwright-cli/` artifacts were deleted cleanly afterward.
3. **Revision Metadata Limitation (Assignment §3):**
   - No `.git` directory is present in the workspace (`/app/applet`). Therefore, no commit SHA or `git status` / `git diff` output exists (`NO_GIT_HEAD` / `NO_GIT_STATUS`).
   - To provide verifiable workspace immutability proof instead, a full-workspace SHA-256 baseline checksum (excluding `node_modules/`, `dist/`, and `docs/product-research/01-independent-discovery/`) was captured before writing research files and re-verified after completion (§4 below).
4. **Bounded Live Testing & External Verification Limits (Assignment §4, §9):**
   - Live AI calls were strictly limited to bounded, synthetic-narrative probes on the local AI Studio-managed Gemini connection (`gemini-4-hydrogen`).
   - **Not tested live (Unverified):** Personal API keys (`gemini-personal`, `openai-api`), ChatGPT subscription OAuth sign-in (`chatgpt-plan`), `POST /api/generate/images`, live `POST /api/narrative/opportunities/explore` response content (returned transient upstream `503 PROVIDER_UNAVAILABLE` during the probe window), live `POST /api/narrative/import/enhance` (blocked upstream by `F-04` `import/extract` failure), and real-world malformed `.docx`/`.pdf` binary uploads.
   - External official provider documentation for unreleased/future-dated model IDs configured in `server/models.ts` (`gemini-4-hydrogen`, `gpt-6-luna`, etc.) was not externally verified via web search; all provider findings are explicitly separated into **confirmed source inspection** vs. **observed managed-Gemini preview** vs. **unverified external provider constraints**.

---

## 3. Product Coverage Matrix

Per Assignment §11.1, this matrix confirms coverage across all four core user needs and all major application subsystems, explicitly flagging unverified areas and reasons.

### 3.1 Core User Needs Coverage

| Core User Need (Assignment §2) | Current Experience Assessment | Primary Research Coverage | Status |
|---|---|---|---|
| **1. Start with an idea** | Strong Belief Graph extraction (`analyze` + `clarify`), but sabotaged by empty `Write` landing (`F-01`), broken `generate/story` (`F-02`), hidden Decision Inbox (`F-12`), and disconnected prompt/manuscript (`F-07`). | `01 §2–3`, `02 (F-01, F-02, F-03, F-07)`, `03 §2.1 & §5.1`, `05 (C-05)`, `06 (R-01, R-04, R-10, R-16)` | **Fully Covered** (Live + Source) |
| **2. Understand an existing narrative** | Rich theoretical fidelity design (immutable sources, epistemic tags, identity resolution), but currently blocked live by `import/extract` `502` + brittle UTF-16 offsets (`F-04`), heavy 5-step ceremony (`F-13`), silent 8-section truncation (`F-05`), and non-visual views (`F-08`). | `01 §3`, `02 (F-04, F-05, F-08, F-13)`, `03 §2.2 & §5.2`, `04 §4`, `05 (C-02, C-03, C-07)`, `06 (R-02, R-05, R-11, R-13, R-14)` | **Fully Covered** (Live + Source; binary `.docx`/`.pdf` parsing source-only) |
| **3. Develop and improve a story** | Writing Assistant produces genuinely high-quality prose live (`6.9s`), and Diagnostics/Sync/Opportunities have clean review-first workflows—but Writing Assist lacks relationships/chapter context (`F-06`), `batch-edit` drops `nextValue` (`F-03`), Diagnostics drops passage anchors (`F-10`), and navigation hard-locks on unsaved drafts (`F-11`). | `01 §3`, `02 (F-03, F-06, F-10, F-11)`, `04 §1–2 & §4`, `05 (C-01, C-04, C-06, C-08)`, `06 (R-03, R-07, R-09, R-18, R-19, R-20)` | **Fully Covered** (Live + Source; `opportunities/explore` body unverified due to `503`) |
| **4. See and manage the narrative** | Belief Graph canvas is valuable but cramped to ~32% viewport under 7 stacked chrome bars (`F-12`); all 4 newer "visual views" (`Timeline`, `Mind Map`, `Ego Map`, `Family`) are flat HTML tables/lists with broken string timeline sort (`F-08`); engineering jargon permeates labels (`03 §2.3`). | `01 §3`, `02 (F-08, F-12, F-15)`, `03 §2–4`, `05 (C-01, C-02, C-03)`, `06 (R-08, R-12, R-13, R-17)` | **Fully Covered** (Live Desktop/Mobile + Source) |

### 3.2 Subsystem Inspection Coverage

| Subsystem | Inspection Depth | Key Files Inspected | Notes / Gaps |
|---|---|---|---|
| **App Shell, Routing & Dirty State** | Live + Source | `App.tsx`, `Header.tsx`, `lib/narrative/workspaceState.ts` | Observed desktop `1440×900` & mobile `390×844`. |
| **Write Mode & AI Writing Assistant** | Live + Source | `ManuscriptEditor.tsx`, `WritingAssistantPanel.tsx`, `StyleProfilePanel.tsx`, `selectionHelpers.ts`, `manuscriptModel.ts` | Live prose quality evaluated on synthetic narrative. |
| **Plan Mode, Belief Graph & Batch Edit** | Live + Source | `AdaptivePlanWorkspace.tsx`, `BeliefGraphCanvas.tsx`, `DecisionInboxPanel.tsx`, `ContextualInspector.tsx`, `promptBuilder.ts`, `consistencyChecker.ts` | Live `analyze`, `clarify`, `batch-edit`, `generate/story` probed. |
| **4 Narrative Projection Views** | Source + UI Check | `TimelinePanel.tsx`, `MindMapPanel.tsx`, `EgoMapView.tsx`, `FamilyKinshipView.tsx` | Confirmed HTML lists/tables & `localeCompare` chronology sort. |
| **Review Mode (Diagnostics, Sync, Opportunities)** | Live + Source | `NarrativeReview.tsx`, `OpportunityCenter.tsx`, `asyncReviewActions.ts`, `diagnostics/engine.ts`, `narrativeAiService.ts` | Live `diagnostics/analyze` & `sync/analyze` probed; `opportunities/explore` hit transient `503` (body unverified). |
| **Faithful Narrative Import** | Live + Source | `ImportWorkflow.tsx`, `extractionService.ts`, `proposalValidator.ts`, `providerPlan.ts`, `shared/importSchemas.ts` | Live `import/extract` failed `502`; binary `.docx`/`.pdf` client parsers not stress-tested with malformed files. |
| **Projects, Storage, Backups & Recovery** | Source + Initial Hydration Check | `ProjectHub.tsx`, `lib/storage.ts`, `App.tsx` | Observed initial IndexedDB banner on fresh load; multi-GB quota exhaustion not stress-tested. |
| **Multi-Provider Hub, Budget & Server AI** | Live (Managed) + Source (All 4) | `AiConnectionsPanel.tsx`, `server/routes.ts`, `server/aiService.ts`, `server/aiBudget.ts`, `server/models.ts`, `server/providers/*` | `gemini-personal`, `chatgpt-plan`, `openai-api`, and `generate/images` **unverified live** per Assignment §4 boundary. |

---

## 4. Final Critical Review & Completion Verification Checklist

Checked directly against Assignment §11 items 1–7 prior to closing the research package:

1. **All 4 core user needs & major subsystems covered or explicitly marked unverified?**
   - **PASS** — Covered in §3 above and across documents `01`–`06`; all unverified live items (3 external providers, image generation, `opportunities/explore` response body, binary `.docx`/`.pdf` edge cases) are explicitly listed with reasons.
2. **Contains both evidence-based functional investigation AND substantial independent creative/product discovery?**
   - **PASS** — `02` & `04` deliver 15 root-caused findings (`F-01`–`F-15`) backed by live probes and exact source symbols; `03` & `05` deliver 3 competing IAs, ASCII wireframes, before/after journeys, and 8 original creative product concepts (`C-01`–`C-08`) with concrete synthetic walkthroughs.
3. **Important proposals have concrete examples, rationale, tradeoffs, and a route to future verification?**
   - **PASS** — Concrete synthetic-story walkthroughs appear in `03 §5` and `05 §2`; tradeoffs and rejected ideas in `05 §2`, `06 §2–§3`; conceptual interfaces, pseudocode, and future acceptance tests in `04 §4–§5` and `02` (`F-01`–`F-15` verification criteria).
4. **Six-cycle record contains actual refinements and critical decisions?**
   - **PASS** — §1 above records substantive pivots from Cycles 1–6 (including the Two-Product Split framing, live failure surprises, and explicit Cycle 4 rejections/demotions).
5. **Documents exist, are readable, cross-referenced, and clearly distinguish observed evidence from assumptions?**
   - **PASS** — 8 cohesive Markdown documents (`README.md` + `01`–`07`) using the Assignment §10 evidence taxonomy consistently; zero broken internal relative links (verified programmatically).
6. **Only new Markdown files inside `docs/product-research/01-independent-discovery/` were created; `RESEARCH-ASSIGNMENT.md` and all existing application files remain completely unchanged?**
   - **PASS (Verified via SHA-256 Workspace Checksum):**
     - Pre-writing baseline SHA-256 of all files outside `node_modules/`, `dist/`, and `docs/product-research/01-independent-discovery/`: `5b55c8b05089eb24c82fb62efd603ad70c799746ddc952100877e57dd374eac6`.
     - Post-writing SHA-256 verification and `RESEARCH-ASSIGNMENT.md` immutability check (`21,042 bytes`, `188 lines`) executed immediately upon completing `README.md` (with `.playwright-cli/` confirmed absent).
7. **No implementation, deployment, external provider action, or subsequent comparative research was initiated?**
   - **PASS** — Zero code changes, zero package installs, zero builds/deploys, zero personal provider sign-ins, and zero comparative research initiated.
