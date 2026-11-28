# PCC-UI-RESEARCH-01 — Independent UX, Information Architecture & Visual Design Discovery

**Status:** Complete — Authorized Research & Documentation Only (Zero application code, CSS, config, or work-package changes made)  
**Environment:** Local preview `http://localhost:3000` | Revision: `NO_GIT_HEAD` (verified via pre/post workspace SHA-256 checksums)  
**Governing Brief:** [RESEARCH-ASSIGNMENT.md](./RESEARCH-ASSIGNMENT.md)

---

## 1. Executive Summary

Proactive Co-Creator (PCC) already possesses an unusually serious, writer-respecting engineering foundation — explicit epistemic distinctions (canon vs. character belief vs. inference), non-destructive diff staging, exact source retention, IndexedDB import checkpoints, IME composition protection, and modal focus trapping. **Yet the current user interface obscures and undermines those strengths** through accumulated layout debt rather than lack of features.

Empirical inspection of both the source codebase (`Confirmed in source`) and the live rendered preview at `1440×900`, `1024×768`, and `390×844` (`Observed in preview`) uncovered five headline structural issues:
1. **Viewport Starvation (`UX-02`):** Six stacked chrome bars in `Plan` squeeze the actual Story Map `<svg>` down to **`978×371px` (`28%` of desktop viewport area)**, while **36 visible buttons** sit under `36px` tall.
2. **Narrow-Rail Cramming & Silent Dead Buttons (`UX-01`, `UX-04`):** Seven heavy domains (`Inspector`, `Story Bible`, `Checks`, `History`, `Timeline`, `Ideas`, `Mind map`) are trapped in a `398px` right sidebar with 2-row `29px` tabs — and if a desktop author collapses `Context`, clicking `Story Bible`, `Opportunities`, `Timeline`, or `Mind map` in the Plan bar fails silently (`AdaptivePlanWorkspace.tsx:100-103`).
3. **Broken Editorial Reading Fidelity (`UX-03`):** `Write → Preview section` renders literal raw Markdown inside a `<pre>` element while pinning a permanent technical XSS disclaimer directly above the author's prose cursor.
4. **Mobile Access Loss, Token Hijacking & Contrast/Focus Failures (`UX-05`, `UX-07`, `UX-08`):** Below `640px`, `Header.tsx` hides `+ New`, `Import`, `Projects`, and `About` with no overflow menu; `index.css` hijacks `--color-blue-*` to plum hexes alongside 3 other styling dialects; `#827d83`/`#aaa5aa` fall below WCAG AA contrast; and `ManuscriptEditor.tsx:48` strips focus outlines without a visible ring.
5. **Multilingual & Sample-Story Leaks (`UX-06`, `UX-10`, `UX-13`):** `TimelinePanel` sorts chronology strings alphabetically with English-only flashback regexes, `GraphToolbar` hardcodes `"Group Guests"` for all projects, and `AdaptivePlanWorkspace` silently truncates entity/relationship lists at 80 items.

### Recommended Independent Direction *(Candidates Only — Open for Comparative Study & Owner Selection)*

- **Information Architecture Candidate (`03`):** **Calm Intent Shell + Collapsible Binder + Optional Dual-Pane Companion Split (`max 2 panes`)** — reconciling `OD-01`'s clear separation of `Write`, `World`, `Creative Studio`, `Story Development`, and `Review` (plus `Projects / Home` and `Story Q&A`) with Model 3's universal side-by-side split (*Write + World Entity*, *Review Issue + Source Passage*, *Original + Alternative*, *Import Source + Extracted Candidates*). Reclaims **`>=70%` viewport area** for primary writing and visual canvases via a single `48px` global bar.
- **Visual Design Candidate (`05`):** **Hybrid of Direction A ("Warm Literary Press") + Direction D's Surface Distinction + Direction C's Warm Low-Glare Dark Mode** (distinguishing Unruled Prose Paper, Whisper-Subtle Spatial Map Mat, and Tinted Draft Paper for unreviewed AI proposals), with **Direction B ("Quiet Ink & Monograph")** preserved as a strong neutral alternative for dense research/historical novels.
- **Delivery Strategy (`07`):** **Staged IA-Skeleton + Targeted Early Fixes + Dedicated `WP03` Shell/Token Convergence** — protecting active `WP01` (zero pause or disruption) while avoiding throwaway narrow-rail UI for `WP03`–`WP05`.

---

## 2. Research Package Index

| Document | Focus & Key Contents |
|---|---|
| [01 — Current UI & UX Audit](./01-current-ui-ux-audit.md) | Complete screen/overlay/panel inventory, task-to-screen map, 18 evidence-labeled findings (`UX-01`–`UX-18`), live geometry measurements (`1440×900`, `1024×768`, `390×844`), 6-condition narrative stress analysis, and preserved engineering strengths. |
| [02 — Author Journeys and Task Models](./02-author-journeys-and-task-models.md) | End-to-end before/after workflow traces for all 9 required journeys (`J-01`–`J-09`) plus 3 discovered missing journeys (`J-10` Return & Resume, `J-11` Multilingual/Turkish Chronology, `J-12` Mid-Session AI Failure & Offline Continuity). |
| [03 — Independent Information Architecture](./03-independent-information-architecture.md) | **Part A (First-Pass Independent):** 4 genuinely distinct organizing models (*Intent Rooms*, *Manuscript + Lenses*, *Object/Folio Binder + 2-Pane Split*, *Spatial Story Board*) & comparative evaluation. **Part B:** Post-independent coverage reconciliation against `PRODUCT-BLUEPRINT.md`, `DELIVERY-ROADMAP.md`, and `WP01`. |
| [04 — Interaction Patterns and Feature Placement](./04-interaction-patterns-and-feature-placement.md) | AI-as-partner interaction rules, zero-manual learning affordances, anti-duplication single-home placement map, `Calm`/`Deep` progressive disclosure, author-centered terminology dictionary, keyboard/responsive ergonomics, and concrete 6-state matrix. |
| [05 — Visual Design Directions and Design System](./05-visual-design-directions-and-design-system.md) | 4 distinct writer-specific visual directions (*Warm Literary Press*, *Quiet Ink & Monograph*, *Nocturnal Desk Lamp*, *Cartographer's Folio*) with desktop & constrained-width conceptual ASCII wireframes, plus a complete Provisional Design System (tokens, typography, contrast, focus, targets, good vs. bad examples). |
| [06 — Narrative Visualization and Editor Experience](./06-narrative-visualization-and-editor-experience.md) | Visual semantic decision matrix, 80+ entity Story Map scaling, Dual-Track Timeline, Knowledge/Epistemic Matrix (`Reader` row + `S-02` belief-clash), Deterministic Patch Change Map vs. Uncertain Impact (`S-06`), true Formatted Markdown Reader, Creative Studio / Grill Me / Alternative Comparison, Project Overview, Operation Center, Context Inspector, and 5-Tab AI Settings + Embeddings Console. |
| [07 — New Opportunities and Prioritized UI Roadmap](./07-new-opportunities-and-prioritized-ui-roadmap.md) | 8 original UI-enabled opportunities (`UI-NEW-01`–`UI-NEW-08`) separated from approved blueprint scope, rejected novelty ideas, strategic delivery comparison protecting active `WP01`, and 14-item prioritized roadmap (`UIR-01`–`UIR-14`) with testable acceptance criteria. |
| [08 — Six-Cycle Review and Coverage](./08-six-cycle-review-and-coverage.md) | Substantive Cycle 1–6 refinement log (actual changes of mind & self-critique), complete individual capability coverage ledger, honest evidence-gap disclosures, and pre/post SHA-256 workspace boundary verification. |

---

## 3. Open Owner UI Decision Agenda (For Post-Comparative Review)

No final UX or visual direction has been chosen on behalf of the Human Owner. The following concrete decisions should be resolved after the upcoming comparative UI study:

| Decision ID | Open Question | Primary Options | Impacted Docs |
|---|---|---|---|
| **UID-01** | Adopt **Optional Dual-Pane Companion Split (`max 2 panes`)** (`UI-NEW-01`) inside the `WP03` shell? | **A.** Yes (universal 2-pane split for Write+World, Review+Source, Original+Alt, Import+Extract) *(Recommended)*<br>**B.** Single primary pane + slide-over drawers only (simpler state, weaker comparison) | `03`, `06`, `07` |
| **UID-02** | Keep **Story Development** as a distinct 6th top-level destination (`Projects / Write / World / Studio / Develop / Review`) OR nest **Strengthen** alongside **Review** (`5` top destinations)? | **A.** 6 distinct destinations on desktop, grouping `Projects` into top-left Switcher on mobile (`OD-01` purest intent separation)<br>**B.** 5 destinations (`Home / Write / World / Studio / Review & Develop`) for tighter mobile/laptop chrome | `03`, `05`, `08` |
| **UID-03** | Select primary **Visual Design Direction** for the `WP03` unified token migration? | **A.** Hybrid *Warm Literary Press + Subtle Spatial Mat + Warm Charcoal Dark Mode* *(Recommended)*<br>**B.** *Quiet Ink & Monograph* (neutral Swiss archival editorial)<br>**C.** *Nocturnal Desk Lamp* (dark-first warm amber)<br>**D.** *Cartographer's Folio* (forest-accented tactile map craft) | `05` |
| **UID-04** | Authorize early surgical fixes (`UIR-01` dead Plan inspector buttons, `UIR-02` true safe Markdown `Read` view) ahead of the `WP03` shell overhaul? | **A.** Fix `UIR-01` & focus rings in `WP01` polish/cleanup and `UIR-02` at `WP02` entry without delaying `WP01`<br>**B.** Batch all non-`WP01` UI fixes cleanly at `WP03` | `01`, `07` |
| **UID-05** | Approve **Author-Centered Terminology Shifts** (`Belief Graph → Story Map`, `Saved · r1 → Saved / Checkpoint`, `Decision Inbox → Pending Decisions`, `Adopt Artifact → Insert into Manuscript`)? | **A.** Adopt plain literary terms in UI while preserving technical IDs in Audit/History details *(Recommended)*<br>**B.** Keep current technical terms with expanded tooltips | `04 (§5)` |
| **UID-06** | Approve which **Newly Proposed Opportunities (`UI-NEW-01`–`UI-NEW-08`)** enter future packages? | Prioritize `UI-NEW-01` (Dual-Pane Split), `UI-NEW-02` (As-Of Chapter Scrubber), `UI-NEW-03` (Split-Jump Citations), `UI-NEW-04` (`Cmd+K` Palette) for `WP03`–`WP04`; hold `UI-NEW-05/07` (Local Rhythm & Echo Lenses) as optional `WP06` enhancements | `07 (§1)` |
| **UID-07** | Confirm **Settings vs. Backup Home** split? | **A.** 5-Tab `AI Settings` (`WP01 M5` exact match) + `Projects / Home → Backups & Recovery` with direct cross-links *(Recommended)*<br>**B.** Merge Project Backups into Settings modal | `03 (§6)`, `06 (§5.4)` |
| **UID-08** | Confirm **Default Landing Behavior** (`OD-02`) for Returning vs. First-Time Authors? | **A.** Adaptive: Returning populated project → `Project Overview` resume card (or optional setting to jump straight into last scene in `Write`); blank/seed project → `Calm Start` / `Guided Premise`<br>**B.** Always reopen last active view directly | `02 (J-01, J-10)`, `06 (§5.1)` |
