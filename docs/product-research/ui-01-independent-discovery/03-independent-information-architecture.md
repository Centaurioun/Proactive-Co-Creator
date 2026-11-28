# 03 — Independent Information Architecture

**Assignment:** `PCC-UI-RESEARCH-01` — Independent UX, Information Architecture & Visual Design Discovery  
**Status:** Part A Complete (First-Pass Independent Exploration); Part B (Post-Independent Coverage Reconciliation) added after independent models are recorded per `RESEARCH-ASSIGNMENT.md §2`.  
**Prior-Exposure Disclosure:** This agent previously participated in earlier product research on PCC, which proposed a multi-room workspace shell. In Part A below, we deliberately set aside prior room names, placements, and layout assumptions — reasoning strictly from the empirical audit (`01-current-ui-ux-audit.md`), the 12 author journeys (`02-author-journeys-and-task-models.md`), and the neutral capability brief (`RESEARCH-ASSIGNMENT.md §3`) — and actively challenge our own earlier assumptions alongside three genuinely different architectural paradigms.

---

## PART A — FIRST-PASS INDEPENDENT ORGANIZING MODELS

### 1. The Core Architectural Problem to Solve

Our empirical audit revealed why PCC's current UI feels crowded despite thoughtful engineering:
1. **Structural mismatch:** PCC currently treats `Plan` as a catch-all container where a graph, a prompt bar, a legend, an inbox, generated output, Story Bible, Timeline, Ideas/Opportunities, Checks, History, and Mind Map all compete inside one viewport (`UX-02`, `UX-04`).
2. **Intent collision:** Two fundamentally distinct creative postures — **Open-Ended Creative Discovery** (*what could this story become?*) and **Faithful Story Development & Consistency Repair** (*how do I strengthen or fix what I already wrote without betraying it?*) — lack distinct homes.
3. **Context fragility:** Moving between writing, inspecting a character, checking continuity, and configuring AI currently triggers hard dirty-draft locks (`UX-09`), lost selections, or narrow-rail squeezing (`398px`).

To solve this from first principles rather than repainting the existing layout, we developed **four genuinely different product-wide organizing models**:

| Model | Organizing Principle | Metaphor | Primary Anchor |
|---|---|---|---|
| **Model 1 — Intent-Separated Rooms** | Author mental posture / creative intent | *The Five-Room Editorial House* | Top-level mode bar switching clean single-purpose rooms |
| **Model 2 — Manuscript-Centric Workbench with Spatial Lenses** | The written story is always home; everything else is a lens on it | *The Desk + Overhead Light Tables* | Manuscript spine stays permanently anchored; World, Studio, Develop, and Review open as full-canvas lenses or split sheets tied to active scene/selection |
| **Model 3 — Object & Folio Binder with Flexible Dual-Pane Canvas** | Narrative objects (Chapters, Cast, Maps, Sessions, Reviews, Alternatives) are first-class documents | *The Author's Folio & Dual-Pane Desk* | Left Story Binder lists all story objects; author opens any 1 object full-width OR any 2 objects side-by-side (`Ch. 4` + `Knowledge Map`, or `Idea A` + `Ending B`) |
| **Model 4 — Spatial Story Board (Canvas-First Atelier)** | Infinite 2D spatial memory of scenes, cast, threads, and What-If branches | *The Novelist's Corkboard & Drafting Table* | Zoomable spatial board where chapters, character cards, unresolved threads, and branches live visually; clicking any scene expands into full-focus prose |

---

### 2. Deep Analysis of the Four Competing Organizing Models

#### Model 1: Intent-Separated Rooms (*The Five-Room Editorial House*)

- **Core Structure:** A single slim top bar (replacing the current dual Header + Nav + Plan Subheader) organizes the product by **what the author intends to do right now**:
  1. **`Overview`** (Project home, resume brief, alternatives, recent milestones, export/backup entry)
  2. **`Write`** (Manuscript outline, prose editor, true formatted reading preview, contextual cursor/selection AI partner)
  3. **`World`** (Full-canvas narrative understanding: Relationship Graph, Knowledge/Epistemic Matrix, Dual-Track Timeline, Story Bible, Threads, Story Q&A)
  4. **`Studio`** (Dedicated open-ended creative discovery: Premise Interview, AI-led & directed opportunities, What-Ifs, multi-turn exploration sessions, visual image ideation)
  5. **`Review`** (Dedicated faithful strengthening & verification: Story Development with Locks, Continuity Diagnostics, Manuscript ↔ Model Sync, Exact Diff/Apply/Undo, Evidence Audit)
  - *Global Utilities (top-right, single home):* `Projects` switcher, `Command Palette (Cmd+K)`, `Operation Center` pill, `Settings & Backup`.
- **When the User Leaves vs. Stays:** Switching rooms changes the full canvas cleanly. Active project, unsaved working draft (auto-stashed locally), active entity/scene focus, and running operations survive across room switches.
- **What Stays Visible:** Slim top bar (`48px`), active project breadcrumb, save/draft state, and non-intrusive Operation Center pill when a job runs.
- **Strengths:**
  - Crystal-clear separation of *Creative Discovery* (`Studio`) vs. *Faithful Strengthening & Repair* (`Review`) vs. *Canonical Model* (`World`) vs. *Prose* (`Write`).
  - Zero `398px` narrow-rail cramming — every capability gets a full-width canvas.
  - Fastest to learn for first-time authors (`<=5` rooms, plain literary verbs).
  - Cleanest responsive adaptation to `1024×768` and `390×844` mobile screens (bottom/drawer room switcher).
- **Shortcomings & Risks (Self-Critique — Challenging Our Own Prior Intuition):**
  - *Room-hopping friction:* Checking whether Leyla knows a secret while drafting Chapter 6 requires leaving `Write` → entering `World` → returning to `Write`, unless lightweight contextual overlays/drawers bridge them.
  - *Review vs. Develop boundary tension:* Placing both *Story Development (strengthen pacing/dialogue)* and *Continuity Review (fix contradictions)* inside `Review` risks making `Review` feel overly clinical for creative revision, whereas splitting them into 6 rooms (`Write / World / Studio / Develop / Review / Overview`) starts re-introducing top-bar crowding.

---

#### Model 2: Manuscript-Centric Workbench with Spatial Lenses (*The Desk + Light Tables*)

- **Core Structure:** Rejects equal-weight rooms. **The Manuscript (`Write`) is ALWAYS the home workspace.** The author never "leaves" their story to go to a separate app mode:
  - **Permanent Left Anchor (Collapsible):** Compact **Story Spine** (Chapters & Scenes with word count and subtle thread/issue dots) + **Quick Project Switcher** at top.
  - **Center Primary Surface:** By default, the distraction-free manuscript editor / formatted reader (`>=75%` screen width).
  - **Top Lens Switcher (Scoped to Current Scene or Whole Story):** Clicking **`World Lens`**, **`Idea Lens`**, **`Develop Lens`**, or **`Check Lens`** either:
    - Opens as a **Docked Side-by-Side Split (`50/50` or `60/40`)** next to the active chapter on wide desktops (`>=1280px`), OR
    - Smoothly expands to **Full-Canvas Focus** with a persistent `← Return to Ch. 6` breadcrumb bar (and automatic split-back on evidence clicks).
- **When the User Leaves vs. Stays:** Authors stay anchored to their exact scene and cursor position; lenses open *over* or *beside* the manuscript rather than feeling like separate applications.
- **What Stays Visible:** Current chapter/scene context, selection scope badge (`Working on: Ch. 6 — The Foghorn` vs. `Whole Story`), auto-saved draft status.
- **Strengths:**
  - Eliminates the #1 friction of writing tools: *checking continuity, story bible, or ideas without losing sight of your prose.*
  - Makes source-linked evidence (`Ch. 2 §3` ↔ `Continuity Issue`) effortless because the manuscript is always one pane away.
  - Naturally frames AI as a **scoped partner** attached to the active passage or whole manuscript.
- **Shortcomings & Risks:**
  - *Cold-start awkwardness for plotters & seed-first authors (`J-01`):* Authors starting from a 2-sentence premise with zero manuscript prose yet may feel forced into an empty text editor before they have explored questions, characters, or world rules.
  - *Narrow-screen complexity:* Below `1024px`, side-by-side split collapses into stacked full-screen layers, effectively turning back into Model 1.

---

#### Model 3: Object & Folio Binder with Flexible Dual-Pane Canvas (*The Author's Folio*)

- **Core Structure:** Inspired by how long-form literary tools treat every narrative artifact as a first-class reusable document (structural principle only; no external brand copying):
  - **Left Collapsible Story Binder** (grouped into clean literary folders):
    - `Overview & Alternatives` (Project brief, saved alternative branches)
    - `Manuscript` (Chapter/Scene tree)
    - `Story World` (Cast / Characters, Places, Objects, Story Rules & Bible, Relationship Map, Knowledge Matrix, Dual-Track Timeline, Unresolved Threads)
    - `Creative Studio` (Premise Interview, Exploration Sessions, What-If Scenarios, Visual Mood/Images)
    - `Editorial & Review` (Development Passes & Locks, Continuity Checks, Sync Proposals, Change History)
  - **Center Workspace: 1-Pane or Flexible 2-Pane Split Canvas:**
    - Opening any binder item renders it **full-width** by default (clean, uncrowded).
    - Clicking **Split Right** (or `Alt+Click` / `Cmd+\`) opens **any second binder object side-by-side** with a draggable divider (`35%–65%`).
    - Examples made trivial by Model 3:
      - `Ch. 6 (Manuscript)` left **+** `Leyla Knowledge Matrix` right
      - `Ch. 4 (Manuscript)` left **+** `Development Pass (Protected Locks)` right
      - `Exploration Session: Harbor Twists` left **+** `Relationship Map` right
      - `Original Ending A` left **+** `Alternative Branch B` right
      - `Imported Source Passage` left **+** `Extracted Candidate Review` right
  - **Top Slim Bar (`48px`):** Project switcher, binder toggle, active pane breadcrumb(s), `Cmd+K` quick jump, Operation Center, `Settings & Backup`.
- **When the User Leaves vs. Stays:** Each pane preserves its own scroll, selection, and draft state; collapsing the binder (`Cmd+B` or Focus toggle) leaves 100% pure prose (`max-w-[72ch]`).
- **What Stays Visible:** Optional slim binder (`240px`, collapsible) + 1 or 2 focused panes. Zero permanent right-hand inspector clutter unless the author opens a detail drawer or split pane.
- **Strengths:**
  - **Unmatched power for complex long-form novels** AND **effortless simplicity for short stories** (binder collapses to 1 clean pane).
  - Solves side-by-side comparison (*Original vs. Alternative*, *Source vs. Extraction*, *Issue vs. Scene*, *Prose vs. World Map*) with **one universal mechanism** instead of five bespoke modals.
  - Works naturally on both web browsers and future native desktop apps (native keyboard shortcuts, drag-resizable panes, multi-document mental model).
- **Shortcomings & Risks:**
  - *First-time overwhelm risk if binder is noisy:* If all 18 sub-folders appear expanded on Day 1 for a blank project, new users feel intimidated. Must pair with **Progressive Disclosure** (start with 4 clean top groups + *"Start here"* overview; reveal empty sub-views gracefully).
  - *Dual-pane management on mobile (`390×844`):* Mobile must gracefully collapse to 1 active pane + a fast `"Swap Pane"` pill and slide-over binder drawer.
  - *State persistence engineering:* Must persist active left/right pane descriptors cleanly per project (straightforward JSON state, no complex tiling window manager needed — strictly cap at **max 2 panes** to avoid IDE tab-hell).

---

#### Model 4: Canvas-First Narrative Atelier (*The Spatial Story Board*)

- **Core Structure:** The project opens onto a **calm, zoomable 2D Spatial Story Board** showing the entire narrative at a glance:
  - Horizontal **Scene Ribbon** across the top/center (chapters as warm index cards showing title, word count, tension arc, and subtle continuity dots).
  - Linked **Cast & World Cluster** below/around scenes (character cards, relationships, knowledge state).
  - Branching **Studio / What-If Cloud** pinned to the side (clearly tinted as non-canonical explorations).
  - Clicking **Write** on any scene card zooms smoothly into a full-screen distraction-free editorial sheet; closing returns to the exact spatial coordinates.
- **When the User Leaves vs. Stays:** Spatial memory is the invariant; prose sheets, continuity diffs, and AI interviews open as full-focus sheets over the spatial map.
- **Strengths:**
  - Inspiring, tactile, immediately differentiated from generic SaaS writing apps.
  - Visualizes pacing, branching alternatives, and narrative structure effortlessly for visual/architect-style plotters.
- **Shortcomings & Risks:**
  - **Accessibility & Keyboard Friction:** Spatial 2D canvases are notoriously hard for screen-reader users, keyboard-only writers, and small mobile viewports (`390×844`) — requiring an entire parallel linear UI anyway.
  - **Text-First Writer Friction:** Discovery writers ("pantsers") who just want to open PCC and write 1,500 words of prose feel slowed down by a spatial board landing screen.
  - **Long-Form Scaling Risk:** A 50-chapter, 90-character novel on a single 2D board requires heavy LOD clustering, mini-maps, and layout maintenance that can distract from writing.

---

### 3. Comparative Evaluation of the Four Organizing Models

| Evaluation Criterion | Model 1: Intent Rooms | Model 2: Manuscript + Lenses | Model 3: Folio Binder + 2-Pane Canvas | Model 4: Spatial Board |
|---|---|---|---|---|
| **First-time learnability (no manual)** | **High** (5 plain verbs) | High for writers; awkward for blank-premise plotters | **High** if progressive disclosure keeps Day-1 binder minimal | Medium (requires learning zoom/spatial controls) |
| **Zero-friction prose focus** | High | **Highest** (prose is always home) | **Highest** (collapse binder = pure sheet) | Medium (extra click from board to prose) |
| **Side-by-side writing + world/review/compare** | Low–Medium (requires room hops or bespoke drawers) | High (prose + 1 lens) | **Highest** (any 2 objects: prose+map, idea+alt, source+extract) | Low (sheets cover board) |
| **Separation of Discovery vs. Faithful Development** | **Highest** (distinct `Studio` vs. `Review`) | Medium (lenses feel adjacent; risk of mixing postures) | **High** (distinct `Creative Studio` vs. `Editorial & Review` binder groups) | High visually (tinted branches), weaker structurally |
| **Scaling to 100k-word novels & 80+ entities** | High | Medium–High | **Highest** (structured binder + full-width views + 2-pane work) | Low–Medium (2D board crowding) |
| **Responsive small screens (`390×844`, `1024×768`)** | **Highest** | High (degrades to Model 1) | High (1 pane + slide-over binder + Swap button) | Low (requires full alternate linear view) |
| **Keyboard-first & screen-reader accessibility** | **Highest** | High | **Highest** (standard tree + landmark panes + `Cmd+K`) | Low–Medium (heavy spatial a11y burden) |
| **Web + future native desktop fit** | High | High | **Highest** (native-grade binder + dual-pane studio) | Medium |
| **State survival (draft, selection, session)** | High | High | **Highest** (independent pane state + auto-stashed drafts) | Medium |

### 4. First-Pass Independent Recommendation (Pre-Reconciliation)

Our independent analysis reveals an important **change of mind** compared to a rigid 5-room shell (Model 1):
- **Pure Model 1** solves today's chrome pileup cleanly, **but** forces awkward back-and-forth room-hopping whenever an author wants to read a character profile, check continuity evidence, or compare an alternative while editing prose.
- **Pure Model 4 (Spatial Board)** is inspiring as an *optional view* inside Story World / Studio, **but** fails accessibility and prose-first ergonomics as the mandatory shell.
- **Strongest Independent Architecture (`Proposal`): A Converged Hybrid of Model 1 + Model 3 — "The Calm Intent Shell with Collapsible Binder & Optional Dual-Pane Split"**:
  - **Top Level (5 Intent-Based Workspaces for instant mental clarity):**
    1. **`Home`** (Project Overview, Resume, Alternatives, Library & Backups)
    2. **`Write`** (Manuscript Binder + Full-Focus Prose / Formatted Reader + Contextual Cursor/Selection AI)
    3. **`World`** (Full-Canvas Story Understanding: Relationship Map, Knowledge Matrix, Dual-Track Timeline, Story Bible, Threads, Story Q&A)
    4. **`Studio`** (Open-Ended Creative Discovery: Premise Interview, Exploration Sessions, Directions & Concrete Ideas, What-Ifs, Visual Mood/Images)
    5. **`Review`** (Faithful Development & Integrity: Scene Strengthening with Locks, Continuity Diagnostics, Manuscript ↔ Model Sync, Diff/Apply/Undo, History & Audit)
  - **Universal Split-Pane Superpower (Borrowed from Model 3, capped at max 2 panes):**
    - On desktop (`>=1280px`), any workspace can **Pin a Companion Pane** (e.g., *Write + World Entity*, *Write + Studio Ideas*, *Review Issue + Exact Manuscript Passage*, *Original + Alternative Comparison*, *Import Source + Extracted Candidates*) with a single draggable divider and a 1-click close button.
    - On narrow screens (`<1280px`), the companion pane cleanly becomes a switchable sheet (`Swap view`) with zero layout breakage.
  - **Zero Duplicate Chrome:** One `48px` top bar replaces the current stacked `Header (65px)` + `Workspace Nav` + `Plan Subheader (66px)` + `BottomBar`, immediately reclaiming **`>220px` of vertical height** and pushing primary visual canvases from **`28%` to `~70%+` of the viewport**.

```text
PROPOSED HYBRID ARCHITECTURE (1440x900 DESKTOP — CONCEPTUAL)
+---------------------------------------------------------------------------------------------------+
| [Logo] Izmir Lighthouse v |  Home   Write   World   Studio   Review  | [Cmd+K] [Jobs] [Settings]  | 48px
+---------------------------------------------------------------------------------------------------+
| [Optional Collapsible     |                                          | [Optional Companion Split  |
|  Left Context Rail 240px] |         PRIMARY FULL-CANVAS WORK         |  Pane — closed by default, |
|  (e.g., Chapter Outline   |   (Prose Sheet / Graph / Studio Cards /  |  opens on demand e.g.      |
|   in Write, Views list in |    Split Diagnostics / Project Home)     |  Source Passage, Entity    |
|   World, Sessions in      |                                          |  Detail, or Alternative    |
|   Studio)                 |              >= 70% Viewport             |  Comparison]               |
+---------------------------+------------------------------------------+----------------------------+
```

*(Label: `Proposal` — conceptual layout diagram, not a screenshot of an implemented screen.)*

---

## PART B — POST-INDEPENDENT COVERAGE RECONCILIATION

*(Completed after Part A was recorded in this directory, following direct read-only verification of `docs/implementation/pcc-product-evolution/PRODUCT-BLUEPRINT.md`, `DELIVERY-ROADMAP.md`, and `WP01/WORK-PACKAGE.md` per `RESEARCH-ASSIGNMENT.md §2`. Item-by-item capability mapping appears in [08 — Six-Cycle Review and Coverage](./08-six-cycle-review-and-coverage.md).)*

### 5. What Was Read and Why (Source Discipline Log)

After finalizing and recording Part A above, we inspected three governing evolution files solely to verify functional completeness, safety invariants, and delivery sequencing:
1. `docs/implementation/pcc-product-evolution/PRODUCT-BLUEPRINT.md` — Verified `OD-01`–`OD-08`, shared enablers `E0`–`E3`, `S-01`–`S-06`, `GS-01`–`GS-08`, `IR-01`–`IR-05`, hybrid local memory + optional multi-provider embeddings (`§6`), and the 5-section AI Settings overhaul (`§7`).
2. `docs/implementation/pcc-product-evolution/DELIVERY-ROADMAP.md` — Verified `WP01`–`WP06` packaging boundaries so UI evolution recommendations do not interrupt or supersede `WP01`.
3. `docs/implementation/pcc-product-evolution/WP01/WORK-PACKAGE.md` — Verified active `WP01` deliverables (`M0`–`M8`, including `M4` autosave/recovery, `M5` 5-section AI Settings & seamless OAuth lifecycle, and `M6` minimal Operation Center & truthful progress).

### 6. Reconciliation Findings: Where Independent Discovery Agrees, Diverges, or Extends the Blueprint

| Topic | Blueprint (`PRODUCT-BLUEPRINT.md`) Direction | Independent UI Discovery (`PCC-UI-RESEARCH-01`) | Reconciliation Assessment & Open Decision |
|---|---|---|---|
| **Top-Level Workspace Structure** | `OD-01` approves the *Hybrid Calm Studio Shell*: `Write`, `World`, `Creative Studio`, `Story Development`, `Review` + accessible `Project Hub` and `Story Q&A` + optional lightweight `Scene Margin`. | Part A independently converged on 5 intent rooms + **Model 3's Collapsible Folio Binder & Optional Dual-Pane Companion Split** (`max 2 panes`), and surfaced the tension between folding *Story Development* into `Review` vs. keeping it as its own room. | **Reconciled Upgrade:** Honor `OD-01`'s explicit separation of `Creative Studio` (open discovery) and `Story Development` (faithful strengthening) — while offering **Optional Dual-Pane Companion Split** and **Projects/Home as anchor** (`UID-01`, `UID-02`). |
| **Side-by-Side Comparison & Source Grounding** | Requires exact source-linked evidence, before/after diffs, deterministic Change Map (`S-06`), and independent alternative comparison (`OD-01`, `§3`). | Model 3's **Universal 2-Pane Split** handles *Write + World Entity*, *Review Issue + Source Passage*, *Original + Alternative*, and *Import Source + Candidates* through one consistent mechanism rather than bespoke modals. | **High-Value Extension:** Fits cleanly inside `OD-01` as an optional desktop capability (`>=1280px`) that collapses cleanly to a switchable sheet on smaller screens. |
| **AI Settings Structure** | `§7` & `WP01 M5` specify 5 coherent sections (`Overview & Connections`, `Models & Defaults`, `Operation Overrides`, `Embeddings & Search`, `Usage & Limits`) + seamless OAuth lifecycle + compact header provider popover (`GS-01`). | Part A proposed 4 tabs combining Settings & Storage Backup. | **Reconciled:** Adopt the exact 5-section AI Settings layout (`WP01 M5`) for AI/Embeddings/Usage so UI research aligns seamlessly with active `WP01`, while keeping Project Backups & Recovery Assistant (`GS-07`) anchored in `Projects / Home` with cross-links between them. |
| **Eliminating Approval Ceremony** | `§3` explicitly forbids redundant `Accept → Send to Change Review → Apply` ceremony; ideas accepted for consideration remain distinct from applied changes. | Part A's 4-exit Draft Proposal card (`Apply`, `Edit Proposal`, `Save as Alternative`, `Keep in Session`) satisfies this directly without intermediate status hoops. | **Direct Alignment.** |
| **Secondary Image Generation** | `OD-07` keeps image generation secondary via `Visuals / Concept Art` without removing functionality. | Part A moves `Story / Image` out of the permanent `WorkspaceBottomBar` into `Creative Studio → Visuals` + contextual scene trigger. | **Direct Alignment.** |
| **Deferred / Experimental Scope** | `OD-08`, `GS-03`, `GS-06` defer entrance animations, dedicated voice-to-text, autonomous/background AI, reader simulation, character roleplay, and async beta-reader sheets. | Keep future slot extensibility in `Studio → Story Lab (Experimental)` without cluttering everyday navigation or claiming approval. | **Direct Alignment.** |

### 7. Reconciled Capability-Family Mapping (Single Logical Home + Contextual Shortcuts)

| Approved Capability Family | Single Logical Home (Reconciled Shell) | Contextual Shortcuts | Preserved Safety / Epistemic Invariant |
|---|---|---|---|
| **Start, Overview, Resume, Library, Alternatives & Recovery** (`OD-02`, `GS-05`, `GS-07`, `IR-05`) | **`Projects / Home`** (Project Overview, Resume My Work, Project Library, Alternatives & Lineage, Export & Backups, Recovery Assistant) | Top-left Project Switcher (`+ New`, `Import`, `Switch`, `Alternatives`), `Cmd+K` | Independent alternatives never auto-switch active project; restore-as-copy default; never overwrite user data |
| **Writing & Reading** (`OD-01`, `WP01 M3/M4`) | **`Write`** (Chapter/Scene Outline, Prose Editor, True Formatted Markdown Reader, Focus Mode, Optional Lightweight Scene Margin, Cursor/Selection AI) | Jump-to-passage from any `World` citation or `Review` issue; Companion Split Pane | Exact raw Markdown source preserved verbatim; IME & OS dictation preserved; auto-stashed working drafts |
| **Narrative Understanding & Story Q&A** (`OD-01`, `S-02`, `S-04`, `§4`, `§6`) | **`World`** (Spacious Story Map: Graph/Ego/Kinship/Table, Dual-Track Timeline, Knowledge Matrix & Epistemic Lenses, Story Bible, Threads & Tension, **Story Q&A**) | Click any entity/citation in `Write`, `Studio`, or `Review` to inspect in Scene Margin or Companion Pane | Fact vs. Character Belief vs. Reported vs. Inference vs. Ambiguous unmistakable; absence-of-evidence distinct from absence |
| **Creative Discovery, Sessions, Grill Me & Collection** (`E2`, `GS-04`, `IR-03`, `OD-05`, `OD-07`) | **`Creative Studio`** (Discover with AI, Guided Exploration / Voluntary Grill Me, Story Lab / What-Ifs, **Creative Collection** Idea Library, Persistent Sessions Shelf, **Visuals / Concept Art**) | `Explore ideas for this scene/entity` from `Write` or `World`; Story Q&A bridge (`S-04`) | Ideas & live Grill Me draft graph stay non-canonical; retain sessions by default (manual recoverable archive/delete) |
| **Story Development, Compass, DNA & Locks** (`OD-01`, `OD-06`, `S-01`, `S-05`, `§4`) | **`Story Development`** *(or dedicated mode within `Develop & Review` — see `UID-02`)*: Expand & Continue, Character Depth, Scene & Dialogue/Subtext, Pacing & Structure, Voice & Compression, Creative Compass/DNA/Intensity, Hard Locks vs. Soft Guidance | Selection `Strengthen` strip in `Write`; inline 🔒 Lock pins | Hard structural locks validated against actual patch; soft semantic guidance labeled honestly; intensity distinct from provider reasoning |
| **Review, Diagnostics, Sync, Diff, Change Map & History** (`E3`, `S-06`, `IR-04`, `WP01 M3`) | **`Review`** (Scoped Diagnostics, Fix Comparison, Manuscript ↔ Model Sync, Unified Proposal Preview with **Patch Change Map vs. Uncertain Impact**, Conflict Detector, Selective Undo/Revert, Full Revision History & Audit) | Subtle issue dots in `Write` outline; inline `Undo` toast right after apply | Deterministic patch-derived Change Map (never AI-invented); CAS/stale-revision checks; explicit approval |
| **AI, Embeddings, Budgets & Context Transparency** (`§6`, `§7`, `GS-01`, `GS-02`, `IR-02`) | Top-right **`AI Settings`** (5 tabs: `Overview & Connections`, `Models & Defaults`, `Operation Overrides`, `Embeddings & Search`, `Usage & Limits`) + pre-run **`Context Inspector`** | Compact dynamic Header Provider Popover (`GS-01`); direct `Open AI Settings →` buttons on all unavailable/error banners | Explicit consent for external calls/embeddings; isolated vector namespaces; no silent provider/model substitution |
| **Long-Running Operations & Truthful Progress** (`GS-08`, `IR-01`, `WP01 M6`) | Top-right **`Operation Center`** pill → activity drawer | Inline truthful segment/elapsed progress inside `Import`, `Review`, `Studio`, `Embeddings` | No fake percentage/ETA; explicit user trigger only; cancel, partial coverage & project/revision binding |

---

## 8. Cross-References & Checkpoint Status

- **Completed in this file:** Part A (4 genuinely independent organizing models recorded prior to blueprint reconciliation) and Part B (complete reconciliation against `PRODUCT-BLUEPRINT.md`, `DELIVERY-ROADMAP.md`, and `WP01/WORK-PACKAGE.md`).
- **Next documents:** [05 — Visual Design Directions and Design System](./05-visual-design-directions-and-design-system.md) and [06 — Narrative Visualization and Editor Experience](./06-narrative-visualization-and-editor-experience.md).

