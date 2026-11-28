# 06 — Prioritized Recommendation Catalogue, Strategic Options & Roadmap

**Assignment:** `PCC-RESEARCH-01`  
**Parent Index:** [`README.md`](./README.md)  
**Cross-References:** [`02-functional-findings-and-root-cause.md`](./02-functional-findings-and-root-cause.md) · [`03-ux-ia-and-user-journeys.md`](./03-ux-ia-and-user-journeys.md) · [`04-ai-quality-narrative-intelligence-and-architecture.md`](./04-ai-quality-narrative-intelligence-and-architecture.md) · [`05-creative-product-discovery-and-concepts.md`](./05-creative-product-discovery-and-concepts.md)

> **Authorization Note:** This roadmap is a **non-authorized research recommendation** intended to support future product-owner review and decision-making (Assignment §4, §10). No implementation has been initiated.

---

## 1. Prioritized Recommendation Catalogue (`R-01` – `R-20`)

Every recommendation uses justified qualitative assessments (no fictitious numerical scores) across: **Category**, **User Value**, **Urgency**, **Evidence Strength**, **Feasibility**, **Complexity**, **Dependencies**, **Risks / Regression Impact**, and **Fit with Product Purpose**.

### Tier 0 — Critical Defect Repairs & Immediate Trust Restoration

| ID | Recommendation | Category | Linked Finding | User Value | Urgency | Evidence Strength | Feasibility / Complexity | Key Dependencies & Risks |
|---|---|---|---|---|---|---|---|---|
| **`R-01`** | **Fix `generateStoryText` timeout & abort misclassification:** Add bounded `thinkingConfig` + `maxOutputTokens`, fix `classifyWithSignal` so timeouts return `504 TIMEOUT (retryable: true)`, and add streaming prose output. | Defect Repair | `F-02` | Critical | Immediate | Observed live + Source confirmed | High / Low–Med | No breaking schema changes; streaming requires minor SSE client update. Low regression risk. |
| **`R-02`** | **Repair `import/extract` reliability & anchor resolution:** Replace LLM UTF-16 offset requirement with deterministic verbatim quote-to-offset anchoring (`04 §4.4`), raise `maxOutputTokens` from `2048` to `4096+`, add `stripJsonFences`, and resolve `502 MODEL_UNSUPPORTED` on `createGeminiAdapter`. | Defect Repair | `F-04` | Critical | Immediate | Observed live + Source confirmed | High / Medium | Preserves strict fail-closed anti-hallucination rule; must update `proposalValidator` & `extractionService` tests. |
| **`R-03`** | **Fix `batch-edit` missing `nextValue` on `update_story_bible`:** Enforce per-operation required fields in schema/prompt and validator so incomplete operations never silently pass through. | Defect Repair | `F-03` | High | Immediate | Observed live + Source confirmed | High / Low | Tightening validation may reject malformed outputs; add single repair/warning fallback. |
| **`R-04`** | **Fix first-visit landing & empty-state traps:** Land empty-manuscript seed projects on `Plan`/`World` (or seed the sample project with a 2-scene manuscript excerpt); hide raw IndexedDB loading message during healthy hydration; fix `"No sections match these filters"` & `"2 core Story Bible property(...)"` formatting. | Defect Repair + Usability | `F-01`, `F-15` | Critical | Immediate | Observed live + Source confirmed | High / Low | Low risk; immediately transforms first 10 seconds of user onboarding. |
| **`R-05`** | **Eliminate silent truncation & repair `changed` scope in Diagnostics & Sync:** Display explicit coverage disclosures (`"8 of 24 sections checked"`), fix `changed` scope filtering, stop stripping `belief`/`reported` entities, and resolve `evidenceQuote` into clickable passage anchors (`anchors[]`). | Defect Repair + Architectural Enabler | `F-05`, `F-10` | Critical | Immediate | Source confirmed | High / Medium | Prevents false confidence on long-form manuscripts; sets foundation for indexed novel scanning (`R-11`). |
| **`R-06`** | **Unify server AI budget enforcement, provider telemetry & Gemini transport:** Route `aiService.ts` operations through `aiBudget` slots/token bounds, ensure default `gemini-managed` increments `observedByConnection`, align image transport, and use native Responses API Structured Outputs on OpenAI where supported. | Defect Repair + Architectural Enabler | `F-09`, `F-14` | High | High | Source confirmed | High / Medium | Moderate regression risk on provider unit tests; requires careful contract testing across all 4 connections. |

---

### Tier 1 — Usability Convergence & High-Impact Friction Removal

| ID | Recommendation | Category | Linked Finding / Concept | User Value | Urgency | Evidence Strength | Feasibility / Complexity | Key Dependencies & Risks |
|---|---|---|---|---|---|---|---|---|
| **`R-07`** | **Replace dirty-draft hard navigation lockout with debounced background autosave + flush-on-switch:** Persist manuscript edits transparently to IndexedDB without blocking tab switches. | Usability Improvement | `F-11` | High | High | Source confirmed | High / Low–Med | Must preserve CAS revision safety and race-free flush before switching active project or restoring backup. |
| **`R-08`** | **Execute Chrome Consolidation & Terminology De-Jargoning:** Eliminate all duplicated controls (`Generate Story`, `Story/Image`, `Story Bible`, `Opportunities`, `Output`, double Inbox headers), remove the permanent 6-term evidence legend strip, reclaim `≥60%` viewport height for the canvas, fix clipped Inbox filters, and translate engineering terms (`03 §2.3`). | Simplification / Consolidation | `F-12`, `F-15` | Critical | High | Observed live + Source confirmed | High / Medium | Medium UI test churn (selectors/labels); massive reduction in cognitive load across desktop and mobile. |
| **`R-09`** | **Enrich AI Writing Assistant context & promote it out of collapsed `<details>`:** Pass scene-relevant `relationships`, active scene metadata (`pov`, `location`, `chronology`, `purpose`), excluded entity names, and preceding section synopsis into `WritingAssistRequestSchema`; move Writing Partner into the right Margin. | Enhancement | `F-06`, `C-01` | Very High | High | Source confirmed + Live quality observed | High / Low–Med | Small additive schema change; directly unlocks PCC's highest-quality observed AI output on multi-chapter stories. |
| **`R-10`** | **Bridge `Plan` and `Write` ("Draft into Manuscript"):** Let `Generate Story` / seed drafting create or append real editable sections in `Working Manuscript`, and show clear manuscript/plan sync status without forcing manual prompt-vs-manuscript mental juggling. | Usability Improvement + Consolidation | `F-07`, `C-05` | High | High | Source confirmed | High / Low–Med | Preserves immutable generated artifacts while giving 1-click transition to editable drafting. |

---

### Tier 2 — Architectural Enablers & True Visual / Narrative Intelligence

| ID | Recommendation | Category | Linked Finding / Concept | User Value | Urgency | Evidence Strength | Feasibility / Complexity | Key Dependencies & Risks |
|---|---|---|---|---|---|---|---|---|
| **`R-11`** | **Build Derived Narrative Memory Index (`SectionContextIndex` + `EntitySceneMap` + `EpistemicFactLedger`):** Enable scene-scoped retrieval, rolling chapter synopses, and multi-pass full-novel Diagnostics/Sync without hitting 8-section truncation or 14k-token walls. | Architectural Enabler | `F-05`, `F-06`, `04 §4` | Very High | Medium–High | Source confirmed | Medium–High / High | Depends on `R-05`; derived index must be deterministically rebuildable from canonical project state (zero new single-point-of-failure data loss). |
| **`R-12`** | **Converge IA into the Two-Surface "Story Studio" (`Write` + `World` + Persistent Contextual Margin):** Unify `Write`, `Plan`, and `Review` under Option B (`03 §3–§4`) so cast, relationships, continuity whispers, and Writing Partner live beside the writer's prose. | Simplification / Consolidation + Usability | `F-01`, `F-12`, `C-01` | Critical | Medium–High | Observed live + Source confirmed | Medium–High / High | Depends on `R-07`, `R-08`, `R-11`; major layout refactor — needs phased rollout & E2E verification. |
| **`R-13`** | **Replace 4 flat text-list views with genuine Visual Views:** Build a true **Dual-Track Visual Timeline** (explicit `chronologyOrder`, replacing broken `localeCompare`), integrate **Radial Ego Focus** & **Kinship Lens** directly onto the main Story Map canvas, and retire the incomplete 5-box `Mind Map`. | Enhancement + Simplification | `F-08`, `C-03` | High | Medium | Source confirmed | Medium–High / Medium–High | Requires adding optional numeric `chronologyOrder` to `sectionSchema` (backward-compatible migration). Keep accessible table view as secondary fallback. |
| **`R-14`** | **Redesign Import into Progressive Zero-Ceremony Ingestion:** Allow instant 1-click entry of imported `.txt`/`.md`/`.docx`/`.pdf` text into `Write` (preserving immutable source), with optional non-blocking background chapter extraction and click-to-highlight margin review. | Usability Improvement + New Capability | `F-13`, `C-07` | High | Medium | Observed live + Source confirmed | Medium–High / Medium–High | Depends on `R-02` (`F-04` anchor fix). Must preserve exact evidence verification and re-anchoring if user edits while extraction runs. |
| **`R-15`** | **Upgrade Local Consistency Checker:** Remove brittle substring setting false positive (`issue_setting_mismatch`), relabel local checks as *Structural Checks*, and integrate seamlessly into unified Diagnostics rather than duplicating in `Plan > Checks`. | Defect Repair + Simplification | `F-10` | Medium | Medium | Source confirmed | High / Low | Low risk; eliminates noisy warnings on healthy stories. |

---

### Tier 3 — Differentiating Creative Capabilities & Exploratory R&D

| ID | Recommendation | Category | Linked Concept | User Value | Urgency | Evidence Strength | Feasibility / Complexity | Key Dependencies & Risks |
|---|---|---|---|---|---|---|---|---|
| **`R-16`** | **Launch Guided Seed-to-Scene Discovery Studio:** Progressive 1-question-at-a-time creative spark interview paired with a live-growing Story Map and 1-click streaming opening beat into `Write` (with equal doors for Blank Draft & Import). | New Capability | `C-05` | Very High | Medium | Exploratory + Observed live onboarding gap | High / Medium | Depends on `R-01`, `R-10`, `R-12`. Re-ignites PCC's signature Era 1 appeal for new writers. |
| **`R-17`** | **Launch Epistemic Perspective Lenses ("Who Knows What?"):** Interactive POV knowledge lens on the Story Map & Scene Margin distinguishing World Canon, Character Beliefs, Rumors, and Unknown Facts for dramatic irony and mysteries. | New Capability | `C-02` | Very High (Differentiator) | Medium | Exploratory + Source confirmed epistemic schema | Medium–High / Medium–High | Depends on `R-05`, `R-11`, `R-12`. Risk of data-entry fatigue mitigated by making belief-holder tagging optional/AI-assisted. |
| **`R-18`** | **Launch "What-If" Narrative Forking & Ripple-Effect Sandboxes:** Non-destructive branching of a graph relationship or plot turning point with automated manuscript ripple-impact mapping and atomic Adopt/Discard. | New Capability | `C-04` | High (Differentiator) | Medium–Low | Exploratory | Medium / High | Depends on `R-11`. Keep ephemeral/single-sandbox UX to avoid Git-like complexity. |
| **`R-19`** | **Launch Dialogue Voice, Subtext & Rhythm Workbench:** Character-grounded voice distinctness observations, subtext dialogue alternatives, and zero-cost local sentence-cadence highlighting. | New Capability | `C-06` | High | Medium–Low | Exploratory + Live Writing Assist strength | High / Medium | Depends on `R-09`, `R-17`. Strictly qualitative observations (no numeric prose scores). |
| **`R-20`** | **Prototype Spoiler-Free "First-Time Reader" Experience Simulator:** Sequential chapter-by-chapter beta-reader pass strictly masking later chapters/secrets to evaluate clue landing, setup/payoff distance, and reader expectations. | Exploratory Idea | `C-08` | High (High upside, unproven) | Low (R&D) | Exploratory | Medium / High | Depends on `R-11`; significant token consumption requires strict chapter-range caps & clear preflight budget disclosure. |

---

## 2. Strategic Product Direction Comparison

Per Assignment §10, we compare three genuinely distinct strategic directions rather than presenting a single predetermined path:

### Strategy 1 — Stabilize & Polish Existing 3-Mode Architecture (`Write / Plan / Review`)
- **Scope:** Execute `R-01`–`R-10` + `R-15` only. Keep the existing 3-mode structure, repair all live bugs, fix truncation disclosures, reduce chrome clutter, and enrich Writing Assist.
- **Best For:** Minimizing engineering scope and risk if PCC is treated as a short-term stabilized release.
- **Strategic Limitation:** Leaves PCC trapped between Era 2 and Era 3 — writers still switch modes to check character facts, visual views remain weak, and PCC lacks an unmistakable creative differentiator over general AI editors.

### Strategy 2 — Converged "Story Studio" Evolution *(Recommended)*
- **Scope:** Execute Tier 0 (`R-01`–`R-06`), Tier 1 (`R-07`–`R-10`), Tier 2 (`R-11`–`R-15`), and selective Tier 3 differentiators (`R-16` Guided Seed Studio + `R-17` Epistemic Perspective Lenses + `R-18` What-If Sandboxes).
- **Core Thesis:** Preserve every single strength PCC already built (author-in-control canon, epistemic honesty, IndexedDB/backup reliability, multi-provider flexibility) while **converging the UX into one calm 2-surface studio (`Write` + `World` + Contextual Margin)** and turning PCC's hidden data model into writer-facing creative superpowers.
- **Tradeoffs:** Requires disciplined phased execution (stabilize defects first, then build `Narrative Memory Index`, then converge IA) and moderate frontend refactoring; worth the investment because it directly fulfills all four core user needs at both short-story and novel scale.

### Strategy 3 — Autonomous "Agentic Co-Author" Pivot
- **Scope:** De-emphasize the visual Belief Graph and explicit canon approval; make a conversational chat/agent sidebar the primary interface that autonomously edits chapters, updates the Story Bible, and generates multi-chapter drafts in the background.
- **Why Rejected as Primary Strategy:** Directly undermines PCC's core identity and safety outcomes (Assignment §2, §9): turns PCC into a generic chat-wrapper competing head-on with commodity LLM chat tools, erodes author control, risks silent canon drift, and throws away PCC's single biggest visual differentiator (the inspectable Belief Graph & epistemic rigor).

---

## 3. Rejected & Deferred Ideas (Cycle 4 Critical Filter)

Not every brainstormed idea survived Cycle 4 adversarial critique (Assignment §5, §10):

| Idea Considered | Decision | Rationale for Rejection / Deferral |
|---|---|---|
| **Numeric "Story Quality / Pacing / Prose Score" (e.g., 7.8/10)** | **Rejected** | Violates PCC's anti-scoring narrative principle; numeric scores create false precision, encourage formulaic prose, and undermine writer confidence. Qualitative, passage-anchored observations are far more useful. |
| **Autonomous "Write Whole Novel" Multi-Chapter Autopilot** | **Rejected** | Contradicts *"genuine creative collaborator rather than merely a story generator"* (Assignment §2) and creates unreviewable walls of generic prose that violate author control. |
| **Full Git-Style Multi-Branch Version Tree & 3-Way Merge UI** | **Rejected** | Extreme UX complexity ("engineering leak" magnified). Replaced with lightweight ephemeral `What-If` sandboxes (`C-04`) + simple named Snapshots. |
| **Expanding Image Generation into a Full Storyboard Art Studio** | **Deferred** | Secondary concern per Assignment §2; image generation also remains unsupported on `chatgpt-plan`/`openai-api`. Keep Image Mode clean, secondary, and functional (`R-06`), without diverting core creative-writing investment. |
| **Real-Time Multi-User Collaboration / Mandatory Cloud Backend** | **Deferred** | High security, privacy, and infrastructure complexity; PCC's local-first IndexedDB + explicit backup/ZIP model is a privacy asset for unpublished manuscripts. Revisit only if multi-author co-writing becomes a primary product goal. |
| **Automatic Silent Canon Updating on Every Keystroke** | **Rejected** | Violates author-in-control & transparent provider consumption invariants (Assignment §9). Passive local entity highlighting (`C-01`) achieves live awareness at zero AI cost, while AI sync/diagnostics remain explicit or gently opted-in. |

---

## 4. Proposed Phased Sequence (Non-Authorized Research Roadmap)

```
PHASE 0: Stabilize & Restore Trust (R-01 → R-06)
  Fix Story timeout/499 · Fix Import 502 + deterministic quote anchoring · Fix Batch-Edit
  nextValue · Fix empty-Write landing · Fix silent truncation + passage anchors · Unify AI budgets
        │
        ▼
PHASE 1: Frictionless Writing & Calm Chrome (R-07 → R-10, R-15)
  Autosave (no dirty-draft lockout) · De-duplicate chrome & remove jargon · Enrich Writing
  Partner context (relationships/scenes/exclusions) · Bridge Plan → Manuscript drafting
        │
        ▼
PHASE 2: Long-Form Intelligence & Unified Studio (R-11 → R-14)
  Derived Narrative Memory Index · Converge into Write + World + Margin (Option B) ·
  True Visual Timeline & Spatial Graph Lenses · Zero-Ceremony Progressive Import
        │
        ▼
PHASE 3: Signature Creative Differentiators (R-16 → R-19)
  Guided Seed-to-Scene Studio · Epistemic Perspective Lenses ("Who Knows What?") ·
  What-If Ripple Sandboxes · Dialogue Voice & Subtext Workbench
        │
        ▼
PHASE 4: Exploratory R&D (R-20)
  Bounded Spoiler-Free Beta-Reader Simulator (validate value & token economics on small pilot)
```

---

## 5. Open Product Owner Decisions

The following strategic decisions require human product-owner judgment before any future implementation plan is authorized (Assignment §4, §6, §10):

1. **IA Commitment (Option A vs. Option B):** Should PCC evolve into the unified Two-Surface Story Studio (`Write` + `World` + persistent Margin, `R-12`) or retain and polish the current 3-mode `Write / Plan / Review` layout?
2. **Sample Project Onboarding Policy:** Should the built-in sample project (*Cat’s Woodland Dinner Party*) gain a short 2-scene Working Manuscript excerpt, or should PCC default to `World`/`Plan` whenever a project has 0 manuscript sections (or both)?
3. **ChatGPT Plan (`chatgpt-plan`) Governance Scope:** Should SRB (`subscriptionResourceBudget.ts`) local-activation gating apply uniformly to *all* `chatgpt-plan` operations, or should `chatgpt-plan` text workflows remain available without the story-only SRB asymmetry (`F-14`)?
4. **Image Mode Positioning:** Should `Image Mode` be moved into a secondary `Visuals / Concept Art` drawer so the primary writing chrome can stay focused on narrative craft, or must it remain a top-level mode toggle?
5. **Local-First vs. Optional Cloud Sync Horizon:** Should Phase 2–3 architecture remain strictly local-first (IndexedDB + ZIP backups) or prepare storage abstractions for optional cloud sync later?
