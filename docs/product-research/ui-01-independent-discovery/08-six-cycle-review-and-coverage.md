# 08 — Six-Cycle Review, Coverage Ledger & Integrity Verification

**Assignment:** `PCC-UI-RESEARCH-01` — Independent UX, Information Architecture & Visual Design Discovery  
**Status:** Complete (All Six Cycles Executed & Verified)  
**Environment & Tooling Disclosures:**
- **Git Revision:** `NO_GIT_HEAD` (no `.git` directory exists inside `/app/applet`; workspace integrity verified via exact pre/post SHA-256 checksums excluding authorized outputs and transient directories).
- **Superpowers Skills Availability:** No Superpowers skill suite is installed in this container; equivalent engineering and design-research methodologies (systematic empirical audit, divergent ideation, adversarial critique, iterative refinement, and integrity verification) were executed across six substantive cycles without claiming invocation of unavailable skills.
- **Prior-Exposure Disclosure:** Earlier sessions on this repository produced `PCC-RESEARCH-01` and `PCC-RESEARCH-02`. Per `RESEARCH-ASSIGNMENT.md §2`, initial observations (`01`), journeys (`02`), four competing organizing models (`03 Part A`), and interaction grammar (`04`) were formulated and written strictly from live preview + source + neutral capability brief *before* reading `PRODUCT-BLUEPRINT.md`, `DELIVERY-ROADMAP.md`, and `WP01/WORK-PACKAGE.md` for coverage reconciliation (`03 Part B` and this ledger).
- **Live AI & Privacy Boundary:** Zero live personal provider calls, zero managed AI probes, zero external resource creation, zero private manuscripts or credentials accessed. Live preview measurements (`1440×900`, `1024×768`, `390×844`) used default synthetic state only, and the temporary Playwright session directory (`.playwright-cli`) was deleted immediately upon completion.

---

## 1. Substantive Six-Cycle Refinement Record (Including Changes of Mind & Self-Critique)

### Cycle 1 — Discover & Frame (Empirical Grounding)
- **What we did:** Audited all top-level workspaces, overlays, and styling files in source (`Header.tsx`, `App.tsx`, `AdaptivePlanWorkspace.tsx`, `ManuscriptEditor.tsx`, `ManuscriptTextPane.tsx`, `ContextualInspector.tsx`, `GraphToolbar.tsx`, `TimelinePanel.tsx`, `MindMapPanel.tsx`, `NarrativeReview.tsx`, `ImportWorkflow.tsx`, `ProjectHub.tsx`, `ReviewDiffModal.tsx`, `OpportunityCenter.tsx`, `AiConnectionsPanel.tsx`, `WorkspaceBottomBar.tsx`, `index.css`) AND measured live rendered geometry at `1440×900`, `1024×768`, and `390×844`.
- **Key empirical surprises discovered (not guessed):**
  1. The `Plan` narrative graph `<svg>` receives only **`978×371px` (`28%` of desktop viewport)** while **36 visible buttons** sit under `36px` tall (`UX-02`, `UX-08`).
  2. Hiding `Context` in `Plan` silently breaks `Story Bible`, `Opportunities`, `Timeline`, and `Mind map` buttons (`AdaptivePlanWorkspace.tsx:100-103` never sets `showInspector(true)`, reproduced live in preview — `UX-01`).
  3. `TimelinePanel.tsx:28-35` sorts chronology alphabetically and uses English-only flashback/uncertainty regexes (`UX-06`).
  4. `Header.tsx:85-88` drops `+ New`, `Import`, `Projects`, and `About` on `<640px` viewports while duplicating `+ New`, `Import`, and `Projects` with the secondary nav bar on desktop (`UX-05`, `UX-17`).
  5. Four separate styling dialects coexist, including `--color-blue-*` hijacked to plum hexes in `index.css` (`UX-07`).

### Cycle 2 — Investigate (Journeys, Root Causes & Missing Workflows)
- **What we did:** Traced all 9 required author journeys (`J-01`–`J-09`) through exact component/state paths and uncovered **3 missing journeys** (`J-10` Return & Resume After Days Away, `J-11` Multilingual/Turkish Non-Linear Chronology Drafting, `J-12` Mid-Session AI Failure / Offline Recovery).
- **Root-cause insight:** Most UX pain does NOT stem from missing engineering rigor (PCC actually has unusually strong IME guards, checkpoint resumption, CAS guards, and modal focus traps); it stems from **attaching every new capability onto one crowded `Plan` shell and `398px` right rail** without a product-wide IA or unified semantic token layer.

### Cycle 3 — Diverge (Genuinely Different Organizing Models & Visual Directions)
- **What we did:** Before reading `PRODUCT-BLUEPRINT.md`, generated **four structurally different IA models** (*Intent Rooms*, *Manuscript + Spatial Lenses*, *Object/Folio Binder + Flexible 2-Pane Split*, and *Canvas-First Spatial Board*) and **four distinct literary visual directions** (*Warm Literary Press*, *Quiet Ink & Monograph*, *Nocturnal Desk Lamp*, *Cartographer's Folio*), plus **8 original UI-enabled opportunities** (`UI-NEW-01`–`UI-NEW-08`).

### Cycle 4 — Challenge (Adversarial Critique & Actual Changes of Mind)
- **Change of Mind #1 (Challenging Our Own Prior 5-Room Shell Assumption):** Pure *Intent Rooms* (Model 1) solved chrome pileup cleanly, **but** under adversarial walkthrough of `J-03`, `J-05`, and `J-07`, it still forced tiring back-and-forth room-hopping when an author needed to check a character belief or continuity evidence while editing prose. Borrowing **Model 3's Optional Dual-Pane Companion Split (`max 2 panes`)** solved *Write + World*, *Review + Source*, *Original + Alternative*, and *Import Source + Candidates* with one consistent mechanism.
- **Change of Mind #2 (Rejecting Spatial Story Board as Primary Shell):** *Model 4 (Canvas-First Atelier)* looked distinctive on paper, **but** adversarial accessibility and long-novel (50-chapter) critique proved it adds severe keyboard/screen-reader barriers and slows down prose-first writers. We demoted spatial boards to specialized views inside `World`.
- **Change of Mind #3 (Revising Settings IA During Reconciliation):** Our first-pass `03 Part A` grouped AI Settings + Project Backups into 4 tabs. After reconciling with `PRODUCT-BLUEPRINT.md §7` and active `WP01 M5`, we adopted the exact **5-section AI Settings console** (`Overview & Connections`, `Models & Defaults`, `Operation Overrides`, `Embeddings & Search`, `Usage & Limits`) and kept Project Backups / Recovery Assistant anchored in `Projects / Home` with bidirectional links — preventing unnecessary conflict with active `WP01` engineering.
- **Honest Shortcomings of Our Preferred Hybrid Design (Self-Critique):**
  1. *Top-bar item count tension (`UID-02`):* Keeping `Projects`, `Write`, `World`, `Studio`, `Develop`, and `Review` as 6 top items gives razor-sharp intent separation (`OD-01`), **but** approaches visual crowding on `1024px` laptops and `390px` phones (where bottom navigation fits at most 5 items comfortably — requiring `Projects` or `Develop` to group cleanly on mobile).
  2. *Dual-Pane Split learning curve (`UID-01`):* While capped at 2 panes, first-time users could accidentally leave a companion pane open and feel squeezed on `1280px` screens unless the close `[×]` affordance is unmistakable and Focus Mode (`Cmd+Shift+F`) always collapses it cleanly.
  3. *Warm Rag-Paper + Plum softness (`UID-03`):* Direction A's literary warmth is inviting for drafting, **but** requires disciplined crisp semantic inks (`--semantic-canon`, `--semantic-danger`, `>=7:1` secondary text) so clinical Continuity Diffs and Tables stay as razor-sharp as Direction B (*Quiet Ink & Monograph*).

### Cycle 5 — Refine (Concrete States, Visualizations & Full Coverage Reconciliation)
- **What we did:** Reconciled every individual capability in `PRODUCT-BLUEPRINT.md`, `DELIVERY-ROADMAP.md`, and `WP01/WORK-PACKAGE.md`; designed concrete 6-state matrices (`04 §7`), desktop + constrained-width wireframes for all 4 directions (`05 §2`), verified semantic tokens (`05 §5`), populated dual-track timeline & knowledge matrix concepts (`06 §2`), and staged `WP01`–`WP06` alignment (`07 §2–3`).

### Cycle 6 — Integrate & Verify (Integrity, Link Validation & Honest Limitations)
- **What we did:** Built the individual capability ledger below, compiled the Owner UI Decision Agenda (`UID-01`–`UID-08`) in `README.md`, checked every relative cross-link across all 9 documents, confirmed zero leftover `.playwright-cli` artifacts, and verified exact pre/post SHA-256 immutability of every file outside `/docs/product-research/ui-01-independent-discovery/`.

---

## 2. Individual Capability Coverage Ledger

Status key: `Implemented` (confirmed in current source) | `Implemented (Defective UX)` | `In Progress / WP01` | `Planned (WP02–WP06)` | `Deferred / Experimental` | `Newly Proposed (UI-NEW)`.

| Capability / Requirement | Source Ref | Current Status | Single Home in Reconciled UI | Research Doc Coverage |
|---|---|---|---|---|
| Blank / Premise / Sample project creation | Neutral brief, `OD-02` | `Implemented` (`CreateProjectDialog`, `Header`) | `Projects / Home` + Project Switcher | `01`, `02 (J-01)`, `03`, `04` |
| Faithful story import (`.txt/.md/.docx`), exact source retention, checkpoints, append & cross-project identity | Neutral brief, `WP01 M2` | `Implemented` (`ImportWorkflow.tsx`) | `Projects / Home → Import Story` (staged split flow) | `01`, `02 (J-02)`, `04 (§7)`, `07` |
| Project Library, Export (DOCX/TXT/Bible/Prompt/Audit/All-Projects ZIP), Browser Backups | Neutral brief, `ProjectHub.tsx` | `Implemented` (`ProjectHub.tsx`) | `Projects / Home → Library & Backups` | `01`, `02 (J-09)`, `03`, `06` |
| Project Overview & Resume My Work (real metrics, no fake score) | `GS-05`, `IR-05`, `OD-02` | `Planned (WP06)` / basic `WP01 M4` | `Projects / Home → Overview` | `02 (J-10)`, `06 (§5.1)`, `07 (UIR-14)` |
| Contextual Recovery Assistant (unsaved draft vs. conflict vs. sync, restore-as-copy) | `GS-07`, `WP01 M4` | `In Progress / WP01` → `WP06` | `Projects / Home → Recovery` | `02 (J-09, J-12)`, `06 (§5.1)`, `07` |
| Independent Alternative Projects (no auto-switch) & later Story Multiverse compare/transfer | `PRODUCT-BLUEPRINT.md §3` | `Planned (WP03/WP05)` | `Projects / Home → Alternatives` + Dual-Pane Compare | `02 (J-08)`, `04`, `06 (§4.3)`, `07 (UIR-13)` |
| Manuscript Chapter/Scene editor, exact raw Markdown retention, IME guards, Focus Mode | Neutral brief, `ManuscriptEditor.tsx` | `Implemented` | `Write` | `01 (§6)`, `02`, `05`, `06 (§3)` |
| True Safe Formatted Markdown Preview & Reading Mode | Neutral brief, `UX-03` | `Implemented (Defective UX — renders <pre>)` | `Write → Edit / Read toggle` | `01 (UX-03)`, `05`, `06 (§3.1)`, `07 (UIR-02)` |
| Non-blocking durable autosave / working draft preservation | `WP01 M4`, `UX-09` | `In Progress / WP01` (currently hard-blocks nav) | `Write` (transparent auto-stash) | `01 (UX-09)`, `02 (J-12)`, `04`, `07 (UIR-04)` |
| Optional Lightweight Scene Margin (local-only cast/beliefs/locks/shortcuts) | `OD-01`, `WP03` | `Planned (WP03)` | `Write → Optional Scene Margin` | `03`, `05`, `06 (§3.1)` |
| Contextual Cursor/Selection AI Revision & Safe Passage Adoption | Neutral brief, `WP01 M3` | `In Progress / WP01` (currently Plan-only generate + Adopt) | `Write → Selection Action Strip (Cmd+J)` | `02 (J-03)`, `04 (§1, §7)` |
| Story Map (Graph, Ego Map, Kinship, Accessible Table) & 80+ Entity Scaling | Neutral brief, `GraphCanvas.tsx` | `Implemented (Defective UX — 28% area, Group Guests, slice 80)` | `World → Story Map` (full canvas) | `01 (UX-02/10/13)`, `05`, `06 (§2.1)`, `07 (UIR-07/08/10)` |
| Story Bible (domains, continuity rules, exclusions, provenance) | Neutral brief, `StoryBiblePanel` | `Implemented (Defective UX — 398px rail, UX-01)` | `World → Story Bible` (full-width sheet) | `01 (UX-01/04)`, `03`, `06 (§1.1)` |
| True Dual-Track Timeline (Reading Order vs. Story Chronology, multilingual-safe, explicit undated lane) | Neutral brief, `WP04`, `UX-06` | `Implemented (Defective UX — alphabetical sort, English-only regex)` | `World → Timeline` | `01 (UX-06)`, `02 (J-11)`, `06 (§2.2)`, `07 (UIR-10)` |
| Knowledge & Epistemic Matrix (`knows/suspects/false/unaware/unrecorded`, Reader row, `S-02` belief-clash) | `PRODUCT-BLUEPRINT.md §4`, `S-02` | `Planned (WP04)` (replaces static `MindMapPanel`) | `World → Knowledge` | `01 (UX-12)`, `02 (J-05)`, `06 (§2.3)`, `07 (UIR-10)` |
| Unresolved Threads, Plot Promises, Foreshadowing, Mystery Builder, Qualitative Tension | `PRODUCT-BLUEPRINT.md §4`, `WP04/WP05` | `Planned (WP04–WP05)` | `World → Threads` & `Creative Studio → Story Lab` | `06 (§2.4)`, `07` |
| Source-Grounded Story Q&A (`S-04` bridge to Studio/Develop, absence-of-evidence honesty) | `OD-01`, `S-04`, `WP03/WP04` | `Planned (WP03–WP04)` | `World → Ask Story` (+ shortcut in `Write`) | `02 (J-05)`, `03`, `04 (§7)` |
| Creative Studio: `CreativeSession` (`E2`), Directions vs. Concrete Ideas, Regenerate/Refine/Edit/Combine/Save/Dismiss, Multi-Select (`GS-04`), Collection (`IR-03`) | `E2`, `GS-04`, `IR-03`, `OD-05`, `WP03` | `Planned (WP03)` (basic narrow `OpportunityCenter` exists) | `Creative Studio` (full canvas + Sessions shelf) | `01 (UX-11)`, `02 (J-04)`, `04`, `06 (§4.1)`, `07 (UIR-09)` |
| Voluntary `Grill Me` (`Inspire / Explore / Grill / Challenge`, custom/skip/mystery, backtrack, anytime preview, live non-canonical draft graph) | `PRODUCT-BLUEPRINT.md §4`, `WP03` | `Planned (WP03)` | `Creative Studio → Guided Interview` & `Home → Start from Premise` | `02 (J-01)`, `06 (§4.2)`, `07 (UIR-09)` |
| Story Lab (Connection Discovery, Story Seeds, What-If, Scene Simulator, Reverse Plotting, Alternative Endings, Ripple Analysis) | `PRODUCT-BLUEPRINT.md §4`, `WP05` | `Planned (WP05)` | `Creative Studio → Story Lab` | `03`, `06 (§4)`, `07` |
| Secondary Image Generation (`OD-07`) | `OD-07`, `WorkspaceBottomBar.tsx` | `Implemented` (currently global bottom bar) | `Creative Studio → Visuals / Concept Art` + scene shortcut | `01 (UX-17)`, `03`, `04 (§3)`, `06 (§4.1)` |
| Story Development (Expand/Continue, Character Depth, Dialogue/Subtext, Pacing, Voice & Compression `S-05`) | `OD-01`, `S-05`, `WP04` | `Planned (WP04)` | `Story Development` *(or `Develop & Review` — `UID-02`)* + `Write` shortcut | `02 (J-06)`, `03`, `07 (UIR-11)` |
| Creative Compass, Creative DNA (`Follow/Challenge/Blend`), Intensity (`Subtle/Balanced/Bold/Radical`), Hard Locks vs. Soft Guidance (`OD-06`, `S-01`) | `OD-06`, `S-01`, `WP02/WP04/WP05` | `Planned (WP02–WP05)` | `Story Development` & `Creative Studio` controls + inline 🔒 pins | `02 (J-06)`, `04`, `06 (§4.1)`, `07 (UIR-11)` |
| Continuity Diagnostics, Fix Alternatives, Manuscript ↔ Model Sync, Evidence Audit | `NarrativeReview.tsx`, `WP01 M3` | `Implemented` + `In Progress / WP01` | `Review → Check & Sync` (split workbench) | `01`, `02 (J-07)`, `05`, `07 (UIR-11)` |
| Unified Proposal Engine (`E3`), Exact Diff, Deterministic Patch Change Map vs. Uncertain Impact (`S-06`), Conflict Detector (`IR-04`), Selective Undo/Revert | `E3`, `S-06`, `IR-04`, `WP02` | `Planned (WP02)` (basic `ReviewDiffModal` exists) | `Review` diff preview & inline `Undo` toast | `02 (J-07)`, `05`, `06 (§2.5)`, `07 (UIR-11)` |
| Revision History & Restore (consolidated single home) | `ProjectHub`, `ContextualInspector`, `ReviewDiffModal` | `Implemented (Fragmented across 4 places — UX-14)` | `Review → History` (+ inline `Undo` & `Home` milestones) | `01 (UX-14)`, `03`, `04 (§3)` |
| Local Narrative Memory Index (offline lexical/structured, Turkish/Unicode) & Optional Multi-Provider Embeddings (Local Qwen, Gemini Embedding 2, Cloudflare Workers AI) | `PRODUCT-BLUEPRINT.md §6`, `E1`, `WP02` | `Planned (WP02)` (honest `WP02` placeholder in `WP01 M5`) | `AI Settings → Embeddings & Search` + transparent retrieval in `World`/`Review` | `02 (J-09)`, `04 (§7)`, `06 (§5.4)`, `07 (UIR-12)` |
| 5-Tab AI Settings, Seamless OAuth Auto-Catalog Lifecycle, Compact Header Provider Popover, Usage/Budgets | `PRODUCT-BLUEPRINT.md §7`, `GS-01`, `GS-02`, `WP01 M5` | `In Progress / WP01` (currently vertical stack + manual dual refresh) | Top-right `AI Settings` + Header Provider Popover | `01 (UX-15)`, `02 (J-09)`, `06 (§5.4)`, `07 (UIR-03)` |
| Pre-Run Context Inspector (`IR-02`) | `IR-02`, `WP02` | `Planned (WP02)` | Expandable disclosure beside every AI action | `04 (§1)`, `06 (§5.3)`, `07 (UIR-12)` |
| Operation Center & Truthful Progress (`IR-01`, `GS-08`, no fake %) | `IR-01`, `GS-08`, `WP01 M6` | `In Progress / WP01` → `WP06` | Top-right `Operation Center` pill → drawer | `02 (J-12)`, `04 (§7)`, `06 (§5.2)` |
| Deferred / Experimental (`GS-03` animations, `GS-06` voice-to-text, `OD-08` autonomous AI, reader sim, roleplay, async beta-reader) | `OD-08`, `GS-03`, `GS-06` | `Deferred / Experimental` (not approved for auto-build) | Future opt-in extensibility slot in `Story Lab`; OS dictation/IME preserved now | `03 (§6)`, `05 (§5.3)`, `07` |
| **Newly Proposed UI Opportunities (`UI-NEW-01`–`UI-NEW-08`)** | Original (`PCC-UI-RESEARCH-01`) | `Newly Proposed` (awaiting owner decision) | Dual-Pane Split, As-Of Scrubber, Split-Jump Citations, `Cmd+K`, Local Rhythm Bar, Hunk Diff Cherry-Pick, Echo Highlighter, Resume Trail | `07 (§1)` |

---

## 3. Evidence Gaps & Unverified Areas (Honest Limitations)

To avoid overclaiming (`RESEARCH-ASSIGNMENT.md §4 & §10`), the following areas remain **explicitly `Unverified`** in this read-only research study and must be validated empirically during future implementation packages:
1. **No Real Writer Usability Testing Yet:** All journey improvements and cognitive-load reductions are grounded in source/DOM inspection and first-principles interaction design — not moderated usability studies with external authors.
2. **No Formal WCAG 2.2 AA Audit Certification:** Proposed token contrast ratios in `05` are computed from hex sRGB values; actual screen-reader announcement flow (NVDA, VoiceOver), high-contrast forced-colors mode, and `200%` browser reflow require live testing once implemented.
3. **Extreme Scale Rendering (>100,000-word novels / 150+ entities):** Current truncation (`.slice(0, 80)`) and viewport squeezing (`978×371px`) are directly confirmed, while live frame-rate/virtualization thresholds at 100k+ words remain to be benchmarked in `WP02`/`WP04`.
4. **Live Personal OAuth, Local Qwen Endpoint & Cloudflare Workers AI Runtime:** Intentionally unexercised per read-only research rules; transitions in `06 §5.4` reflect `PRODUCT-BLUEPRINT.md §6–7` contracts and `WP01 M5` requirements.
5. **RTL Script Mirroring:** Turkish diacritics and IME composition were verified in source (`ManuscriptEditor.tsx`, `index.css`), while right-to-left scripts (Arabic, Hebrew) remain untested (`Unverified`).

---

## 4. Workspace Integrity & Boundary Verification

- **Pre-Research Baseline Workspace SHA-256** *(all files up to depth 5 excluding `node_modules/`, `dist/`, and `docs/product-research/ui-01-independent-discovery/`)*:
  `885345ed4ba2d0a9a9e09c21c3f7e0f7512a1739fcf6981142f2aaca6ec19f80`
- **Pre-Research `RESEARCH-ASSIGNMENT.md` SHA-256:**
  `3a2a9b7df6b8fd8ae439fb885f8ec14bfaf379c5358a8bdc3443881869ece5fc`
- **Authorized Outputs Created:** Strictly 9 new Markdown files inside `/docs/product-research/ui-01-independent-discovery/` (`README.md`, `01` through `08`). Zero code, CSS, lockfile, config, test, prior-research, or work-package files modified; temporary `.playwright-cli/` directory verified absent.
- **Post-Research Verification:** Confirmed matching baseline hashes and zero broken internal links via automated post-write verification check before closing the assignment.

---

## 5. Cross-References

- Return to [README.md — Executive Summary & Owner Decision Agenda](./README.md).
