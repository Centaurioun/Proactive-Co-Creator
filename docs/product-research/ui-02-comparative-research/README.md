# PCC-UI-RESEARCH-02 — Comparative UX Research, Design Synthesis & Product-Wide Interaction Blueprint

**Status:** Complete documentation-only comparative UX research package (`NO_GIT_HEAD` — pre/post SHA-256 verified).  
**Predecessor Baseline:** `PCC-UI-RESEARCH-01` (frozen at `5737f06242f76caf60111a85c6937739a07d7f94`), Owner Observations (`ui-owner-review-2026-11-28.md`), and Latest Approved Decisions (`ui-owner-decisions-after-research-01.md`).  
**Authority Boundary:** Preserves all owner-approved decisions (`UID-01`–`UID-08`, `UIRF-01`–`UIRF-06`, refined `UI-NEW-01`–`08`, and the `WP01`–`WP08` delivery roadmap). Does **not** select a final visual direction on the owner's behalf, does **not** edit code or pause `WP01`, and makes **zero** claims of live user testing or WCAG compliance certification.

---

## 1. Executive Synthesis: What Changed Between `ui-01` and `ui-02`

Rather than summarizing or defending our first study, `PCC-UI-RESEARCH-02` critically audited both research streams against actual source code, sRGB contrast math, and realistic non-linear multilingual writing workflows (*The Salt Ledger / Tuz Defteri*):

1. **Three Explicit Self-Corrections to `ui-01`:**
   - **Writing Assistance Exists in Source:** Direct inspection (`ManuscriptEditor.tsx:396-413`, `WritingAssistantPanel.tsx`) proved an 8-action assistant with stale-digest guards already exists; the true defect is discoverability (buried beneath `SectionDetailFields` in collapsed `<details>`) and dense copy—not absence.
   - **Corrected Contrast Math & Dual Border Tiers:** Deterministic Node.js sRGB math proved `ui-01`'s `#B8B1A8` (`2.09:1`) and `#524B57` (`1.96:1`) failed WCAG SC 1.4.11 (`3:1`). All three full-product candidates now separate decorative `--border-hairline` from `>=3.35:1` interactive `--border-control` (**77/77 pairs passing**, 0 failures).
   - **True Seven-Form Visual Separation:** Reversed `ui-01`'s conflation of associative Mind Maps and Epistemic Knowledge Matrices, defining **7 strictly distinct visual forms (`V1`–`V7`)** with non-color-only triple encoding (`Stroke + Glyph + Text`) and accessible HTML table/outline fallbacks.
2. **Strongest Product Syntheses:**
   - **Dual-Axis As-Of Scrubber + 5-Vector Spoiler-Leakage Threat Model (`05`):** Separates *Reader Presentation Order* from *Character World-Time* (handling flashbacks, false beliefs, undated dreams, and characters learning earlier than the reader) and proves why naive chapter-number filtering leaks spoilers through summaries and vector indexes.
   - **Anti-Sprawl Consolidation (`07`):** Folds all 8 `UI-NEW` + 6 `UIRF` + 6 newly proposed `UIC` innovations into **4 shared architectural mechanisms** instead of 20 disconnected menus.
   - **Three Comparable Full-Product Visual Candidates (`06`):** *Candidate 1: Warm Literary Press (Refined)*, *Candidate 2: Quiet Ink & Monograph*, and *Candidate 3: Atelier Linen & Indigo (NEW 5th direction)* — rendered apples-to-apples across all 7 screens + non-ideal + `390×844` mobile states using the exact same *Salt Ledger* data.
   - **Phased Skeleton + Swappable Tokens (`08`):** Maps every repair, structural home, optional local-primary Cloudflare R2 backup (`WP06`), dedicated Complete UI/UX Overhaul (`WP07`), and Real Acceptance (`WP08`) without pausing active `WP01` or causing throwaway rework.

---

## 2. Package Index (All 9 Reports)

| # | Document | Core Contents |
| :--- | :--- | :--- |
| **01** | [01-comparative-coverage-and-evidence.md](./01-comparative-coverage-and-evidence.md) | Exhaustive item-level crosswalk (`UX-01–18`, `OR-*`, `UID-01–08`, `UI-NEW-01–08`, `UIRF-01–06`, expanded `CE/F/C/R/S/GS/IR/OD`), explicit `ui-01` self-corrections, and source-verified defect reassessment |
| **02** | [02-navigation-and-workspace-architecture.md](./02-navigation-and-workspace-architecture.md) | 6-variant IA comparison (including new `M5` Slim Left Rail & `M6` Project Anchor + 5 Center Verbs), desktop/laptop/mobile/`200%` zoom, `UID-01` Dual-Pane Companion contract (read-only default for 2nd project), Unified Navigation State (`UIRF-01/02/03/05` + `UI-NEW-08`), local bilingual `Cmd+K` |
| **03** | [03-author-journeys-and-interaction-specification.md](./03-author-journeys-and-interaction-specification.md) | Canonical shared synthetic fixture (*The Salt Ledger / Tuz Defteri*), all 12 earlier journeys + 3 new journeys (`J-13`–`J-15`) each comparing 2 plausible workflows, corrected `J-03`, and 9-condition stress matrix |
| **04** | [04-editor-creative-and-review-experiences.md](./04-editor-creative-and-review-experiences.md) | 8-state screen specs for `Write` & `UIRF-06` Reading (+ elevated `WritingAssistantPanel` & combined `Local Writing Insights`), `Creative Studio` (exact `CE-02/03` card semantics + voluntary 4-mode `Grill Me`), `Story Development`, `Review` (clear triage, `UI-NEW-06` sentence/hunk cherry-pick, full-width History), and `Story Q&A` |
| **05** | [05-narrative-visualization-and-context.md](./05-narrative-visualization-and-context.md) | Strictly distinct visual semantics for all **7 visual forms (`V1`–`V7`)**, *Salt Ledger* diagrams & accessible fallbacks, **Dual-Axis As-Of Scrubber (`UI-NEW-02`)**, **5-Vector Spoiler-Leakage Threat Model**, exact vs. stale source anchors, and read-only 2-project comparison |
| **06** | [06-visual-directions-and-design-system.md](./06-visual-directions-and-design-system.md) | Reassessment of 4 prior directions + new 5th direction (*Atelier Linen & Indigo*), **3 full-product comparable candidates** across all 7 screens + non-ideal + `390px` mobile states, mathematically computed sRGB contrast tables (77/77 pass), typography/localization, swappable tokens (`WP03`→`WP07`), and future WCAG audit plan |
| **07** | [07-projects-settings-recovery-and-new-opportunities.md](./07-projects-settings-recovery-and-new-opportunities.md) | 8-state specs for `Projects / Home`, Recovery Assistant (`GS-07`), optional local-primary **Cloudflare R2 encrypted backup**, 5-section `AI Settings` (independent LM Studio/Cloudflare/Gemini embeddings, truthful Operation Center, Context Inspector, Secondary Visuals), **6 new comparative innovations (`UIC-01`–`UIC-06`)**, and 4-mechanism anti-sprawl consolidation |
| **08** | [08-integrated-ui-roadmap-and-owner-decisions.md](./08-integrated-ui-roadmap-and-owner-decisions.md) | Migration strategy comparison mapped onto the Owner-Approved **`WP01`–`WP08`** roadmap, `E0`–`E3` dependency guardrails, testable acceptance boundaries, and formal **Next Owner Decision Agenda (`UID2-01`–`UID2-08`)** |
| **09** | [09-six-cycle-refinement-and-verification.md](./09-six-cycle-refinement-and-verification.md) | Substantive Cycle 1–6 refinement log (actual changes of mind, rejected alternatives, honest shortcomings), trace completeness audit, limitations disclosure, and SHA-256 documentation-only boundary record |

---

## 3. Accepted Owner Needs vs. Open Comparative Decisions

- **Preserved Without Modification (Approved Prior Decisions):** `UID-01`–`UID-08`, `UIRF-01`–`UIRF-06`, refined `UI-NEW-01`–`08`, `CE-02/03` Creative Studio card semantics, voluntary 4-mode `Grill Me`, local-primary manual-first optional Cloudflare R2 encrypted backup (independent from Workers AI), independent optional embeddings (`Off / Priority / All`, personal preference never hardcoded globally), verified OAuth → bounded targeted catalog refresh without auto-inference or silent paid fallback, zero fake completion scores or progress `%`, and the `WP01`–`WP08` delivery roadmap.
- **Open Owner Decisions Ready for Review (`UID2-01`–`UID2-08`, full tradeoffs in Doc `08 §4`):**
  1. **`UID2-01`:** Primary Visual Direction (`Candidate 1: Warm Literary Press Refined` vs. `Candidate 2: Quiet Ink & Monograph` vs. `Candidate 3: Atelier Linen & Indigo [NEW]` vs. Hybrid) — needed before `WP07`.
  2. **`UID2-02`:** Desktop 6-Intent Nav Posture (`M6` Top Anchor + 5 Center Tabs vs. `M5` Slim Left Intent Rail) — needed before `WP03`.
  3. **`UID2-03`:** Writing Assistant Default Posture in `Write` (Selection Popover + Slide-In Drawer vs. Collapsible Right Column) — needed before `WP02`/`WP03`.
  4. **`UID2-04`:** Dual-Pane Companion Scope (Curated High-Value Pairings [Recommended] vs. Unrestricted Arbitrary Split) — needed before `WP05`.
  5. **`UID2-05`:** Calm-Mode Default for Local Writing Insights (Quiet Footer Pill [Recommended] vs. Always-On Inline Underlines) — needed before `WP03`.
  6. **`UID2-06`:** Disposition of 6 New Comparative Innovations (`UIC-01`–`UIC-06`) — gated per WP (`WP03`–`WP07`).
  7. **`UID2-07`:** Optional 1-Click Sample Fixture (*The Salt Ledger*) on Empty `Projects / Home` — needed before `WP06`.
  8. **`UID2-08`:** Self-Hosted OFL Variable Fonts (`Literata` + `DM Sans`/`Inter` + `JetBrains Mono`) vs. System Fonts First — needed before `WP07`.

---

## 4. Integrity & Provenance Summary

| Verification Item | Status |
| :--- | :--- |
| Scope Boundary | Only 10 new English Markdown files created inside `docs/product-research/ui-02-comparative-research/` |
| Immutable Files (`RESEARCH-ASSIGNMENT.md`, prior `ui-01`, owner docs, app source, tests, `WP01`) | Verified byte-identical via SHA-256 (`09-six-cycle-refinement-and-verification.md §4`) |
| Markdown Links & Structure | Verified zero broken relative links across all 10 files |
| Contrast Claims | 100% deterministically computed via Node.js sRGB luminance math (77/77 candidate pairs passing; `ui-01` border math errors explicitly corrected) |
| Runtime / Compliance Disclaimers | Zero live AI calls; zero claims of author usability testing, performance benchmarks, or WCAG compliance certification |
