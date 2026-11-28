# PCC — Comparative Product Research, Critical Review & Creative Synthesis (`PCC-RESEARCH-02`)

**Assignment ID:** `PCC-RESEARCH-02`  
**Status:** Complete — Documentation-Only Comparative Research (No Implementation or Product Decision Approval)  
**Research Date:** `2026-11-28`  
**Governing Brief:** [`RESEARCH-ASSIGNMENT.md`](./RESEARCH-ASSIGNMENT.md) *(preserved unchanged)*  
**Preserved Inputs:** [`../01-independent-discovery/README.md`](../01-independent-discovery/README.md) *(ref. commit `eb526125255d2740a6fc3d8d9a3c6c798749232e`)* · [`../owner-brainstorming-2026-11-28.md`](../owner-brainstorming-2026-11-28.md) *(ref. commit `8b05f926754c3b8bda52a9bd458a88428c515231`)*

---

## 1. Executive Synthesis

This second research pass critically compares, challenges, and synthesizes **two completely independent bodies of product research** against the actual Proactive Co-Creator (PCC) codebase:
1. **Stream 1 — Independent Product Discovery (`PCC-RESEARCH-01`, `F-01`–`F-15`, `C-01`–`C-08`, `R-01`–`R-20`):** Deep empirical audit of live preview failures, long-form truncation, chrome overload, provider asymmetries, epistemic lenses, and visual views.
2. **Stream 2 — Owner & ChatGPT Brainstorming Register (`CE-01`–`CE-11`, unpacked into 84 distinct sub-capabilities):** Rich creative-collaboration vision—dedicated `Creative Studio` vs. `Story Development`, full per-card exploration actions, persistent sessions, deterministic Visual Change Maps, Alternative Projects (strictly no auto-switch), repeatable Creative Locks, voluntary scoped `Grill Me`, and source-grounded **`Story Q&A`**.

### Five Most Important Comparative Conclusions
1. **Four Source-Confirmed Self-Corrections to `PCC-RESEARCH-01` ([`02 §1`](./02-functional-reassessment-and-trust.md)):**
   - Re-inspecting `server/retry.ts:20, 25, 83, 89, 95` uncovered the **actual root cause** of `F-02`'s `499 CANCELLED` timeout bug: `withRetry()` unconditionally overwrites *any* `signal.reason` (including `TIMEOUT / 504`) across all six `aiService.ts` routes before `classifyWithSignal` ever runs! Meanwhile, blaming omitted `thinkingConfig` alone for the 60s latency is properly reclassified as a **strong hypothesis** needing controlled A/B verification.
   - Inspecting `lib/nlBatch/operationValidation.ts:349-358` confirmed that client-side validation **already blocks** missing `nextValue` on `update_story_bible` (`F-03`)—so canon is safe, and the actual bug is a dead-end server emission defect.
   - Separated the redacted live `import/extract` `502 MODEL_UNSUPPORTED` (raw upstream cause still unconfirmed due to `geminiAdapter.ts:163-195` redaction) from the 3 source-confirmed structural defects (LLM UTF-16 offsets, `2048` cap, missing fence strip).
   - Separated legitimate conservative input budgets (`AI_OPERATION_POLICIES`) from the 3 confirmed defects in `asyncReviewActions.ts` (silent omission, broken `changed` scope, stripped `belief`/`reported` entities).
2. **Reconciling Spacious Workspaces vs. Zero-Switch Drafting Calm ([`03 §2–§3`](./03-product-architecture-and-ux-alternatives.md)):** Stream 1's pure 2-surface + Margin IA cramps deep creative exploration, while 5 isolated tabs recreate mode-switching friction. Our **Hybrid "Calm Studio Shell"** separates **one shared internal Narrative Core** from **5 calm, spacious intent surfaces (`Write · World · Studio · Develop · Review`)** bridged by a lightweight passive `Write` Scene Margin, 1-click scoped handoffs, and a **Calm / Deep progressive disclosure dial (`S-03`)**.
3. **35+ Creative Ideas Consolidate onto 3 Shared Engines ([`04`](./04-creative-collaboration-and-proposal-lifecycle.md), [`05`](./05-narrative-intelligence-and-visual-design.md), [`06`](./06-integrated-creative-capability-portfolio.md)):** Almost every high-value capability across both streams—Connection Discovery, Story Seeds, Foreshadowing/Twists, voluntary 4-mode `Grill Me`, `Story Q&A`, 5-lens `Story Development`, Epistemic Knowledge Maps, Dual-Track Visual Timeline, Visual Change Maps, and `Save as Alternative Project` (strictly no auto-switch)—runs cleanly on **just three shared enablers**: *(E1) Derived Narrative Memory Index*, *(E2) Persistent `CreativeSession`*, and *(E3) Unified Proposal Engine + Deterministic Patch-to-Visual Diff Projector (`S-06`)*.
4. **Six Original Synthesis Capabilities (`S-01`–`S-06`) Discovered Beyond Both Streams ([`06 §3`](./06-integrated-creative-capability-portfolio.md)):** *Lock & Constraint Conflict Preflight* (`S-01`), *Scene-Level Subtext & Belief-Clash Detector* (`S-02`), *Calm / Deep Progressive Disclosure Dial* (`S-03`), *`Story Q&A` → Scoped Creative Studio Bridge* (`S-04`), *Narrative Compression & Redundancy Lens* (`S-05`), and *Unified Patch-to-Visual Diff Projector* (`S-06`).
5. **Recommended Evolution Path ([`07`](./07-recommended-evolution-roadmap-and-owner-decisions.md)):** **Strategy B — Hybrid Calm Studio Shell + Thin Vertical Creative Slices**: repair live trust defects first (`Stage 0`, zero blocking decisions), then ship thin end-to-end vertical slices (`Stages 1–3`) so writers receive real creative breakthroughs early without a risky big-bang rewrite, keeping exploratory R&D (Spoiler-Free Reader Simulator, Character Roleplay, Async Feedback Sheet) explicitly gated in `Stage 4`.

---

## 2. Research Package Index (133 Traced Items Across 8 Documents)

| Document | Core Contents |
|---|---|
| [`01-comparative-coverage-and-traceability.md`](./01-comparative-coverage-and-traceability.md) | Exhaustive item-level crosswalk covering all `F-01`–`F-15` (15), `C-01`–`C-08` (8), `R-01`–`R-20` (20), **`CE-01`–`CE-11` unpacked into 84 sub-IDs**, and 6 new synthesis ideas (`S-01`–`S-06`) — **133 mapped items**, zero hidden group checkmarks. |
| [`02-functional-reassessment-and-trust.md`](./02-functional-reassessment-and-trust.md) | Source-level reassessment & 4 self-corrections to `PCC-RESEARCH-01`, Plan↔Manuscript bridge preserving the 4 Data Authorities, opt-in Progressive Faithful Import, truthful durable autosave, multi-provider governance, and unverified runtime boundaries. |
| [`03-product-architecture-and-ux-alternatives.md`](./03-product-architecture-and-ux-alternatives.md) | Deep IA comparison (Pure 2-Surface vs. 5 Separate Workspaces vs. **Hybrid Calm Studio Shell**), 4 concrete ASCII layouts, Calm/Deep dial (`S-03`), 5 end-to-end writer journeys, mobile (`390×844`), Focus Mode & accessibility. |
| [`04-creative-collaboration-and-proposal-lifecycle.md`](./04-creative-collaboration-and-proposal-lifecycle.md) | Full card-action contract + worked synthetic *Port Marrow* walkthrough (`03:17` watch + Ch. 7 radio signal), `CreativeSession` contract, Unified Proposal Engine & Selective Revert, Deterministic Visual Change Map & Impact Analysis, 3-tier Exploration Ladder + Alternative Projects (**strict no auto-switch**) & Multiverse, and 4-mode Voluntary `Grill Me` engine. |
| [`05-narrative-intelligence-and-visual-design.md`](./05-narrative-intelligence-and-visual-design.md) | Rebuildable Derived `NarrativeMemoryIndex` (short story + 20-chapter novel Ch. 18 contradiction walkthrough), Epistemic & Character Knowledge Map + `S-02` Belief-Clash, Reader Track vs. Exploratory Reader Simulator, source-grounded **`Story Q&A`** + `S-04` bridge, 5 purpose-built Visual Surfaces (Dual-Track Timeline + accessible fallbacks), 5-lens `Story Development`, and Two-Tier Repeatable `Creative Locks`. |
| [`06-integrated-creative-capability-portfolio.md`](./06-integrated-creative-capability-portfolio.md) | Consolidation of 35+ capabilities into 8 cohesive workflows, selective PCC-native productivity adaptations (`Explain Differently`, `Session Brief`, optional `Craft Note`), deep walkthroughs of **`S-01`–`S-06`**, and explicit Cycle 4 rejections/deferrals. |
| [`07-recommended-evolution-roadmap-and-owner-decisions.md`](./07-recommended-evolution-roadmap-and-owner-decisions.md) | Comparison of 4 strategic directions (recommending **Strategy B**), shared enabler dependency graph, outcome-based vertical-slice roadmap (`Stages 0–4`), and the 8-item **Principal Owner Decision Agenda (`OD-01`–`OD-08`)**. |
| [`08-six-cycle-refinement-and-verification.md`](./08-six-cycle-refinement-and-verification.md) | Substantive Cycle 1–6 refinement history (changes of mind, challenges to both streams), provenance/methodology/limitations disclosures, exact item-count tally, and SHA-256 workspace boundary proof. |
| [`RESEARCH-ASSIGNMENT.md`](./RESEARCH-ASSIGNMENT.md) | Original governing assignment brief *(unmodified)*. |

---

## 3. Principal Owner Decisions Prepared for Next Phase (`OD-01` – `OD-08`)

Full options and tradeoffs are documented in [`07 §4`](./07-recommended-evolution-roadmap-and-owner-decisions.md#4-principal-owner-decision-agenda-od-01--od-08):

1. **`OD-01` — Top-Level IA:** Approve **Hybrid Calm Studio Shell** (`Write · World · Studio · Develop · Review` + lightweight `Write` Margin & Calm/Deep dial) vs. Pure 2-Surface vs. Incremental 3-Mode Polish?
2. **`OD-02` — First-Visit Sample Experience:** Seed sample project with a 2-scene manuscript excerpt AND/OR land 0-section projects on `World`?
3. **`OD-03` — Strategic Horizon:** Authorize **Strategy B** (Stage 0 trust repairs → thin vertical creative slices) vs. Strategy A (stabilization only) vs. Strategy C?
4. **`OD-04` — `chatgpt-plan` SRB Symmetry & OpenAI Structured Outputs:** Align SRB gating uniformly across `chatgpt-plan` text routes and authorize targeted live verification of Responses API vs. SIWC schema parameters?
5. **`OD-05` — Creative Session Retention:** Auto-archive inactive sessions with soft storage warnings + ZIP backup inclusion?
6. **`OD-06` — Free-Text Creative Locks:** Confirm honest Two-Tier enforcement (Hard Structural deterministic + Soft Semantic AI-checked with optional structured grounding)?
7. **`OD-07` — Image Mode Positioning:** Move Image Mode into a secondary `Visuals / Concept Art` drawer so writing chrome stays focused on narrative craft?
8. **`OD-08` — Stage 4 Exploratory R&D Gate:** Hold Spoiler-Free Reader Simulator, Character Roleplay, Async Beta-Reader Sheet, and Opt-In Proactive Sparks behind a post-Stage-2/3 validation gate?

---

## 4. Environment Provenance, Integrity & Unverified Boundaries

| Field | Value |
|---|---|
| **Sandbox Git Status** | `NO_GIT_HEAD` / `NO_GIT_STATUS` (no `.git` directory in workspace; reference commit SHAs above are assignment-provided provenance identifiers) |
| **Workspace Integrity Hash** | `265896998ae9f928fc79a45e3eb3b8c084b86e4f135501666f0b90b9e6dfcf79` *(SHA-256 across all files outside `node_modules/`, `dist/`, and `docs/product-research/02-comparative-research/`; verified unchanged before & after)* |
| **Preserved Input Checksums** | `RESEARCH-ASSIGNMENT.md`: `58230354...de5f68f` · `owner-brainstorming-2026-11-28.md`: `c118c730...cf85feb0` · `01-independent-discovery/*`: unchanged inside workspace hash |
| **Superpowers Skills** | Not installed in container; equivalent structured methods applied and disclosed in [`08 §2`](./08-six-cycle-refinement-and-verification.md#2-methodology-source-identifiers--limitations-disclosure) |
| **Unverified Live Areas** | Personal/external providers (`gemini-personal`, `chatgpt-plan`, `openai-api`), OpenAI/SIWC `text.format` schema compatibility, raw upstream error behind redacted `import/extract` `502`, controlled `ThinkingLevel.LOW` latency A/B on `generate/story`, live `generate/images`, live `opportunities/explore` response body, malformed `.docx`/`.pdf` stress cases, and native desktop runtime |
