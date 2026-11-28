# 07 — Recommended Evolution Strategy, Vertical-Slice Roadmap & Owner Decision Agenda

**Assignment:** `PCC-RESEARCH-02` (Section 7)  
**Parent Index:** [`README.md`](./README.md)  
**Cross-References:** [`01-comparative-coverage-and-traceability.md`](./01-comparative-coverage-and-traceability.md) · [`02-functional-reassessment-and-trust.md`](./02-functional-reassessment-and-trust.md) · [`03-product-architecture-and-ux-alternatives.md`](./03-product-architecture-and-ux-alternatives.md) · [`04-creative-collaboration-and-proposal-lifecycle.md`](./04-creative-collaboration-and-proposal-lifecycle.md) · [`05-narrative-intelligence-and-visual-design.md`](./05-narrative-intelligence-and-visual-design.md) · [`06-integrated-creative-capability-portfolio.md`](./06-integrated-creative-capability-portfolio.md)

> **Non-Authorization Boundary:** This document presents a **candidate strategic roadmap and owner decision agenda** for subsequent human review. It is **NOT** an authorized implementation plan, does not specify calendar timelines or task counts, and initiates zero product changes.

---

## 1. Comparing Four Strategic Product Directions

Per Assignment §7, we evaluate **three viable competing evolution strategies** (plus document why a fourth—Autonomous Agentic Pivot—remains rejected) across writer value, feasibility, risk, reversibility, and when a competing path might genuinely be preferred:

### Strategy A — Stabilize & Incremental Feature Add-Ons (Preserve Current 3-Mode Shell)
- **Summary:** Repair all confirmed Tier 0 functional defects (`02 §2`), remove duplicated chrome, add truthful autosave, enrich Writing Assist, and incrementally expand the existing `OpportunityCenter` inside `Plan` / `Review` with basic card actions (`Regenerate`, `Save for Later`) and a `Story Q&A` drawer—without introducing dedicated `Creative Studio` / `Story Development` workspaces or the `Narrative Memory Index`.
- **Strengths:** Lowest upfront refactoring risk; highest reversibility; fastest path to a clean, reliable baseline build.
- **Weaknesses:** Leaves PCC stuck with cramped panels (`CE-01`), flat list views (`F-08`), manual prefix-slicing limits on novels (`F-05`), and no clean distinction between *discovering new ideas* vs. *expanding an existing story*.
- **When Strategy A Should Be Preferred:** If the owner wants only a short-term reliability stabilization release before deciding whether to invest in a broader narrative-studio evolution.

### Strategy B — Hybrid Converged "Calm Studio Shell" + Thin Vertical Creative Slices *(Recommended)*
- **Summary:** Execute **Trust & Reliability Repairs first (Slice 0)**, immediately followed by **thin, end-to-end vertical slices** that build PCC's three shared enablers (*Derived Narrative Memory Index*, *Persistent Creative Sessions*, *Unified Proposal Engine + Patch-Derived Change Map*) incrementally—delivering real writer-facing magic at every milestone (`Story Q&A`, `Creative Studio` with full card actions & `Grill Me`, `Story Development` with Preservation Policy & Locks, `True Visual Timeline & Epistemic Lenses`, and `Save as Alternative Project` with strict no auto-switch) inside the **Hybrid Calm Studio Shell** (`03 §3`).
- **Strengths:**
  - **Does NOT postpone all creative value behind a giant multi-month rewrite:** Every slice delivers a complete, testable writer outcome!
  - Honors *both* the owner's dedicated spacious workspaces (`Creative Studio` & `Story Development`) AND Stream 1's calm zero-switch `Write` Scene Margin + full-bleed `World` canvas.
  - Consolidates 35+ brainstormed ideas onto 3 shared engines so maintenance stays sane.
  - High reversibility per slice (each shared enabler has clean boundaries and preserves all 4 Data Authorities).
- **Tradeoffs:** Requires disciplined owner decisions up front on IA (`OD-01`) and Lock/Session scope (`OD-05`) to prevent half-migrated UI states; moderate frontend refactoring during Shell & Visual Timeline slices.

### Strategy C — Full Studio-First Platform Architecture (Big-Bang Redesign)
- **Summary:** Redesign the entire frontend shell, IndexedDB persistence layer, all 5 visual views, Multiverse project engine, Creative DNA, and full 25-capability Creative Studio in one comprehensive architectural overhaul before shipping.
- **Strengths:** Cleanest theoretical code homogeneity at the end.
- **Weaknesses:** Highest regression risk; long dark period where writers still face live `F-02`/`F-03`/`F-04`/`F-05` failures; low reversibility if a UX hypothesis (like Multiverse or Creative DNA) needs adjustment after real author use.
- **When Strategy C Might Be Preferred:** Only if PCC were being rebuilt from scratch rather than evolving an existing working workspace with real persistence guarantees.

### Strategy D — Autonomous "Agentic Co-Author" Pivot *(Rejected)*
- **Why Rejected:** Both research streams independently confirmed that replacing PCC's visual Belief Graph and author-in-control approval model with an autonomous writing chatbot destroys PCC's core identity, invites silent canon drift, and collapses PCC into a commodity chat wrapper.

---

## 2. Shared Architectural Enablers & Dependency Backbone

Nearly every high-value proposal across both streams depends on **four clean shared enablers**—building these once avoids duplicating code across 20 features:

```
  [E0: Trust & Provider Unification] (withRetry fix · import 502/anchors · batch-edit · budgets · autosave)
           │
           ├──▶ [E1: Derived Narrative Memory Index] (rebuildable local index + traceable synopses + coverage manifest)
           │         ├──▶ Full-Novel Diagnostics & Sync (zero silent truncation)
           │         ├──▶ Enriched Writing Partner & S-05 Compression
           │         ├──▶ Source-Grounded Story Q&A (+ S-04 Studio Bridge)
           │         ├──▶ Epistemic Knowledge Map (+ S-02 Scene Belief-Clash)
           │         └──▶ Dual-Track Visual Timeline & Threads Board
           │
           └──▶ [E2: Persistent CreativeSession + Unified Proposal Engine + S-06 Visual Diff Projector]
                     ├──▶ Full Card Actions (Preview · Edit · Per-card Regen · Develop · Combine · Idea Library)
                     ├──▶ Voluntary Adaptive Grill Me (4 modes: Inspire / Explore / Grill / Challenge)
                     ├──▶ Creative Locks (Hard Structural + Soft Semantic + S-01 Preflight)
                     ├──▶ Deterministic Visual Change Map + Speculative Impact Analysis
                     └──▶ Safe Alternative Project Cloning (No Auto-Switch) & Optional Multiverse
```

---

## 3. Recommended Staged Vertical-Slice Roadmap (Outcome-Based, Non-Authorized)

Each stage defines **usable writer outcomes**, **dependencies**, **exit criteria**, and **regression boundaries**—never arbitrary calendar estimates or task counts.

### Stage 0 — Trust, Reliability & Truthful Groundwork *(Safe to Authorize First — Zero Blocking Product Decisions)*
- **What Ships:**
  - Fix `server/retry.ts` abort-reason erasure (`504 TIMEOUT` vs. `499 CANCELLED`) + bounded `thinkingConfig`/`maxOutputTokens` + streaming on `generateStoryText` (`F-02`).
  - Diagnose raw upstream cause of `import/extract` `502 MODEL_UNSUPPORTED`; replace LLM UTF-16 offset requirement with deterministic verbatim quote-to-offset anchoring; remove `2048` output clamp; add `stripMarkdownCodeFence` (`F-04`).
  - Fix `batch-edit` server emission of required `nextValue` on `update_story_bible` while preserving client `operationValidation.ts` (`F-03`).
  - Add honest `CoverageManifest` disclosures, repair `changed` scope filtering, stop stripping `belief`/`reported` entities, and resolve diagnostic `evidenceQuote` into clickable passage anchors (`F-05`, `F-10`).
  - Unify `aiService.ts` routes under `aiBudget` and fix default `gemini-managed` `observedByConnection` counting (`F-09`).
  - Replace dirty-draft hard navigation lockout (`App.tsx:175`) with truthful debounced autosave + flush-on-switch (`F-11`, `CE-03.2`); fix landing hydration state & micro-defects (`F-01`, `F-15`).
- **Exit Criteria:** All 3 synthetic narratives pass live on `gemini-managed` with HTTP `200` across `analyze`, `clarify`, `batch-edit`, `generate/story`, `import/extract`, `diagnostics`, `sync`, and `writing/assist`; zero silent truncation; simulated timeout returns `504 (retryable: true)`; tab switch flushes unsaved prose cleanly with zero data loss.
- **Regression Boundaries:** Preserve all 4 Data Authorities, fail-closed quote verification (0 hallucinated quotes accepted), CAS revision checks, and single-attempt `chatgpt-plan` boundary.

### Stage 1 — Calm Shell, Unified Proposal Engine & First Vertical Creative Slice *(Requires `OD-01`, `OD-02`)*
- **What Ships:**
  - **Hybrid Calm Studio Shell (`03 §3`):** Clean single top bar (`Write · World · Studio · Develop · Review` + `Story Q&A`), de-jargoned labels (`01-independent-discovery/03 §2.3`), `≥72%` canvas height in `World`, lightweight passive **Scene Margin** in `Write`, and Calm/Deep progressive disclosure dial (`S-03`).
  - **Enriched Writing Partner & Plan↔Write Bridge (`F-06`, `F-07`):** Injects scene relationships, preceding synopses, scene metadata, and exclusions; 1-click *"Draft into Manuscript"*.
  - **Enabler `E2` (Core) + Vertical Slice of `Creative Studio`:** Persistent autosaved `CreativeSession`, **Connection Discovery** & **Discover with AI** with full card actions (`Preview`, `Edit` desc vs. patch, per-card `Regenerate` with `v1/v2` history, `Develop Further`, multi-select directions + `Suggest More`, custom-input `Suggest Directions` vs. `Generate Idea`, `Combine Ideas`, `Save for Later` Idea Library, `Dismiss`, `Explain Differently`), unified inline Preview/Apply (no redundant Change Review hop), and **`Save as Alternative Project` (strictly no auto-switch!)**.
- **Exit Criteria:** A writer can go from 1-sentence seed → World Map → Studio exploration → multi-direction refinement → inline Preview → Apply OR Save as Alternative Project (staying in current project) → edit prose in `Write` with zero mode lockouts and full session recovery across browser reload.
- **Regression Boundaries:** Zero canon mutation from selection, liking, bookmarking, previewing, or autosave; existing IndexedDB projects & ZIP backups load without loss.

### Stage 2 — Narrative Memory Index, Story Development, Grill Me & Real Visuals *(Requires `OD-05`, `OD-06`)*
- **What Ships:**
  - **Enabler `E1` (`NarrativeMemoryIndex`):** Deterministic local `entitySceneMap` + `chronologyOrder` + optional author/AI traceable synopses + budgeted multi-pass novel Diagnostics/Sync.
  - **Source-Grounded `Story Q&A` + `S-04` Bridge:** Verbatim-anchored story queries with uncertainty disclosure and 1-click *"Explore this gap in Studio"*.
  - **Dedicated `Story Development` Workspace:** 5 craft lenses (`Expand & Continue`, `Character Depth`, `Scene & Dialogue` with Voice/Subtext `C-06`, `Pacing & Structure`, `Voice & Tighten` with `S-05` Redundancy Lens) governed by **Preservation Policy** and repeatable **Creative Locks** (Hard Structural + Soft Semantic + `S-01` Conflict Preflight).
  - **Voluntary Adaptive `Grill Me` Engine:** All 4 behavioral modes (`Inspire Me`, `Explore with Me`, `Grill Me`, `Challenge Me`) launchable from inception OR any scoped node/scene, with live non-canonical draft sketch, dependency backtracking, deliberate mystery logging, and anytime exit to editable Preview.
  - **True Visual Views (`C-03`, `S-06`) & Progressive Faithful Import (`02 §4.1`):** Deterministic **Visual Change Map** (`S-06`), **Dual-Track Visual Timeline** (explicit `chronologyOrder` + Uncertain bin + Accessible List fallback), on-canvas **Radial Ego & Kinship Lenses**, and 1-click instant import into `Write` with explicit opt-in AI mapping.
- **Exit Criteria:** 20-chapter synthetic novel catches a planted Ch. 18 contradiction with clickable quote anchor; `Story Q&A` answers factual & forgotten-character queries accurately with citations; Hard Lock blocks conflicting proposal ops deterministically; `Grill Me` never asks facts already present in Chapter 1; Change Map matches exact text diff 1:1.
- **Regression Boundaries:** Deleting `NarrativeMemoryIndex` causes zero canonical data loss and rebuilds cleanly; zero silent background AI calls on import or typing; zero numeric creative quality scores anywhere.

### Stage 3 — Epistemic Superpowers, Story Lab Depth & Multiverse *(Requires `OD-03`, `OD-07`)*
- **What Ships:**
  - **Unified Knowledge & Perspective System (`C-02`, `CE-07.11`, `S-02`):** Time-scoped `Character Knowledge Map`, interactive `World` POV Perspective Switcher, **Reader Knowledge Track** on Dual-Track Timeline, POV knowledge-leak whispers, and **`S-02` Scene Belief-Clash Detector**.
  - **Full `Story Lab` Suite:** Foreshadowing Architect (Forward & Reverse Twist), unified **Threads / Promises / Open Mysteries Board**, Scene Simulator, Alternative Endings Lab, Speculative Ripple Impact Analysis, Creative Compass, and Creative DNA (`Follow / Challenge / Blend`).
  - **Optional `Story Multiverse`, Qualitative Story Comparison & Selective Transfer:** Lineage view inside `Projects` (off by default, tombstone-safe on deleted parents), qualitative tradeoff comparison (0 numeric scores), and dependency-aware Selective Transfer via Unified Proposal Engine.
  - **Safe Selective Revert (`CE-02.11`):** Operation-level inverse revert with conflict preview for later overlapping prose edits.
- **Exit Criteria:** Nadia POV lens accurately hides Alden-only facts from Ch. 1; Reverse Twist suggests valid early-chapter setup anchors; Selective Transfer from Alternative B detects dependent character references and previews cleanly without altering untouched chapters.
- **Regression Boundaries:** Default `Calm` mode remains uncluttered for short-story writers; Multiverse deletion never corrupts sibling projects.

### Stage 4 — Bounded Exploratory R&D *(Explicitly Experimental — Separate Gate)*
- **Candidates:**
  1. **Spoiler-Free "First-Time Reader" Simulator (`C-08` / `CE-07.12`):** Prototype behind strict `maxReadingOrder <= N` masking & spoiler-leakage automated tests (`05 §2.3`) with capped chapter windows and upfront token budget preview.
  2. **Optional `Character Interview` Roleplay (`CE-07.9`), Lightweight `Craft Note` (`CE-09.4`), and Async Beta-Reader Feedback Sheet (`CE-09.2`):** Validate writer demand before promoting beyond optional labs.
  3. **Strict Opt-In Gentle Proactive Sparks (`CE-07.25`):** Only if validated as helpful without budget surprise or distraction (manual-first remains permanent default).

---

## 4. Principal Owner Decision Agenda (`OD-01` – `OD-08`)

These eight decisions genuinely require **human product-owner judgment** before authorizing future implementation (Assignment §2, §7, §9):

| ID | Decision Topic | Concrete Options to Choose Between | Research Recommendation |
|---|---|---|---|
| **`OD-01`** | **Top-Level Navigation & IA** | **A:** Polish existing 3 modes (`Write / Plan / Review`) · **B:** Stream 1 Pure 2-Surface (`Write / World` + Deep Margin) · **C:** **Hybrid Calm Studio Shell** (`Write · World · Studio · Develop · Review` + lightweight `Write` Margin & Calm/Deep dial) | **Option C (Hybrid Calm Studio Shell)** — reconciles spacious Studio/Develop with zero-switch drafting calm. |
| **`OD-02`** | **Sample Project & First-Visit Landing** | **A:** Add a 2-scene Working Manuscript excerpt to *Cat's Woodland Dinner Party* · **B:** Land empty-manuscript seed projects on `World` with 1-click *"Draft Ch. 1"* · **C:** Both A + B | **Option C (Both)** — makes both `Write` and `World` feel alive immediately. |
| **`OD-03`** | **Overall Evolution Strategy** | **Strategy A** (Stabilize only) · **Strategy B** (Hybrid Shell + Vertical Slices) · **Strategy C** (Full Studio-First Rewrite) | **Strategy B** — repairs trust immediately in Stage 0, then delivers real creative value every slice. |
| **`OD-04`** | **Multi-Provider Policy & `chatgpt-plan` SRB Symmetry** | **A:** Apply SRB local-activation gating uniformly across all `chatgpt-plan` text routes · **B:** Keep all 11 text routes uniformly accessible under standard SIWC limits without story-only asymmetry · *(Plus authorize targeted OpenAI Responses API vs. SIWC structured-output verification)* | **Needs Owner + Policy Alignment** — remove accidental 1-of-11 asymmetry (`F-14`). |
| **`OD-05`** | **Creative Session Retention & IndexedDB Storage Cap** | **A:** Auto-archive inactive sessions after N days (user-recoverable) with soft storage warnings · **B:** Keep all sessions indefinitely with manual Archive/Delete and ZIP archive inclusion | **Option A + ZIP inclusion** — prevents IndexedDB bloat on large novels while guaranteeing zero silent loss. |
| **`OD-06`** | **Free-Text Creative Locks Enforcement Posture** | **A:** Strict two-tier UX (**Hard Structural Locks** deterministic + **Soft Semantic Locks** clearly labeled AI-checked with optional structured grounding) · **B:** Require every lock to bind to a structured target before activating | **Option A** — honors author's free-text `+ Add another` rows (`CE-06.5`) while staying 100% honest about deterministic vs. semantic enforceability. |
| **`OD-07`** | **Image Mode Positioning** | **A:** Move `Image Mode` into a clean secondary `Visuals / Concept Art` drawer so primary writing chrome stays focused on prose & narrative · **B:** Keep `Story / Image` toggle prominent on `World` | **Option A** — preserves Image Mode without cluttering every writing screen (Assignment §1, §6.6). |
| **`OD-08`** | **Exploratory R&D Budget Gate** | Approve or defer Stage 4 prototypes (**Spoiler-Free Reader Simulator**, **Character Roleplay**, **Async Beta-Reader Sheet**, **Opt-In Proactive Sparks**) until Stages 0–3 prove value with real manuscripts. | **Defer until post-Stage 2/3 validation** — keep focus on core reliability and high-confidence creative superpowers first. |
