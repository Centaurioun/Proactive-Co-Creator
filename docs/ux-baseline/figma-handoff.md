# Stage 0 Figma Handoff Package — Proactive Co-Creator 2.0

**Baseline SHA:** `03e9fda79f00fc9d27984142dcb188f099f28fde` (+ Stage 0 local CI/accessibility patches)  
**Target Audience:** Product Designer / Figma Designer (no repository access required)  
**Scope Boundary:** This document specifies **what currently exists**, **what must be preserved**, **what must NOT be invented**, and **candidate redesign hypotheses** for Figma exploration. **No UI redesign has been implemented in Stage 0.**

> **Issue ID reconciliation (2026-11-24):** `docs/ux-baseline/findings.md` is the sole canonical register (`F-01`–`F-17`). Older handoff references used earlier numbering and pointed several IDs at different issues. References in this document now use the current register; the Stage 0 execution report's `F-01`–`F-15` heading is a historical omission, not a second numbering scheme.

---

## 1. Product Purpose & User Jobs (Hypotheses — No User Research Telemetry Yet)

> **Epistemic Status:** User job priorities and prevalence are **product hypotheses** derived from current capabilities and live browser walkthroughs (`J01`–`J12`). Frequency of pain points is **`UNKNOWN`** until usability testing with real writers/creators is conducted.

### Primary User Jobs (Hypotheses)
1. **Seed-to-Structured-Plan Co-Creation (`J01`, `J02`, `J03`):** Turn a rough creative idea into an explicit, editable world model (entities, attributes, relationships, Story Bible) through AI suggestions that **never overwrite user intent silently**.
2. **Authoritative Plan Refinement (`J04`, `J05`, `J06`, `J10`):** Inspect, filter, edit, clear, batch-update (via natural-language diff preview), and consistency-check story/visual elements with full Undo/Redo safety.
3. **Traceable Artifact Generation (`J07`, `J08`):** Synthesize a transparent refined prompt from accepted decisions and trigger explicit Story or Image generation, with clear staleness indicators whenever the plan changes after generation.
4. **Local-First Recovery & Portability (`J09`, `J11`, `J12`):** Manage multiple projects safely in browser storage (IndexedDB + localStorage fallback), recover from read/conflict errors without data loss, restore prior revisions non-destructively, and export JSON/Markdown backups.

---

## 2. Canonical Source-of-Truth Data Pipeline (Must Be Reflected in UI Mental Model)

Any Figma redesign **must** preserve and visually clarify this exact state machine (implemented in `lib/canonicalModel.ts`, `lib/projectController.ts`, `lib/promptBuilder.ts`):

```text
[1. Original Seed Idea] (PromptInput)
        │  explicit click: Analyze / Reanalyze Idea (/api/analyze + /api/clarifications)
        ▼
[2. Proposed AI Suggestions] (Decision Inbox: pending clarifications, inferred entities/attributes/relationships)
        │  UNCONFIRMED / AI-INFERRED — does NOT override user authority
        │  explicit user action: Accept | Reject | Defer | Edit | Custom Answer | NL Batch Diff Preview → Apply
        ▼
[3. Canonical Confirmed Plan] (Schema v3: Belief Graph + Contextual Inspector + Story Bible + Consistency Checks)
        │  every commit creates an atomic Undo/Redo transaction + Revision History entry
        │  clearing a Story Bible field records explicit user cleared state (AI cannot silently revive it)
        ▼
[4. Deterministic Synthesized Refined Prompt] (promptBuilder.ts, ≤ 8,000-char server validation cap)
        │  optional explicit AI Prompt Polish (/api/prompt/refine)
        │  explicit user trigger: Generate Story (/api/generate/story) OR Generate Images (/api/generate/images)
        ▼
[5. Generated Artifacts] (OutputGallery: Story prose + Copy/Download, OR Image grid + Fullscreen Lightbox)
        │  if Canonical Plan changes after generation → Artifact marked "Outdated" (non-destructive warning)
        │  if API fails (503/network) or IndexedDB read fails → Error/Recovery banner + Write Gate (0 destructive writes)
```

---

## 3. Preserved-Capability Matrix (Reconciled with `docs/modernization/feature-preservation-matrix.md`)

Every capability below exists in production `main` today and **MUST remain accessible** in any Figma redesign unless the product owner explicitly signs off on deprecation:

| Capability | Current UI Location | Visual / Behavioral Invariant | Screenshot Reference |
| :--- | :--- | :--- | :--- |
| **Generation Modes (`story` \| `image`)** | Mode toggle in `PromptInput` (default `story`) | Video mode is permanently removed; Story and Image share canonical entities while keeping mode-specific outputs separate. | `SC-01`, `SC-08`, `SC-09` |
| **Seed Idea Input + Analyze** | Top `PromptInput` deck | Displays seed text, compiled character count (`X/8,000`), and explicit `Analyze`/`Reanalyze` trigger. | `SC-01`, `SC-02` |
| **Decision Inbox** | Left column (`DecisionInboxPanel`) | Distinguishes `pending` vs `confirmed` vs `deferred` vs `rejected`; single/bulk Accept, Reject, Defer, Edit, Custom answer, category filters, `Inspect →` jump, `More Questions` trigger. | `SC-02`, `SC-11`, `SC-13` |
| **Natural-Language Batch Edit** | Inline inside `DecisionInboxPanel` | Text instruction → deterministic diff preview → per-item checkbox selection → **stale-preview guard** if plan changes → atomic undoable Apply. | `SC-07` |
| **Belief Graph Visualization** | Center column (`BeliefGraph`) | Interactive SVG graph: **solid = explicit/user-confirmed**, **dashed = AI-inferred/implicit**; zoom, pan, fit, search, category filter, focus node, highlight connections, hide inferred, expand/collapse groups, **keyboard-accessible Table View fallback**. | `SC-03`, `SC-04`, `SC-13`, `SC-16` |
| **Contextual Entity & Relationship Inspector** | Right column Tab 1 (`Inspector`) + graph popover | Provenance badges (`User` vs `AI`), alternatives, custom attribute values, existence toggle (`exists`/`absent`), entity rename, add entity, relationship edit. | `SC-03`, `SC-04` |
| **Story Bible** | Right column Tab 2 (`Story Bible`) | Structured fields: `genre`, `tone`, `perspective`, `setting`, `themes`, `conflict`, `pacing`, `continuity rules`, `exclusions`; explicit Clear authority (clearing never revives old AI value). | `SC-05`, `SC-14` |
| **Consistency Checks** | Right column Tab 3 (`Checks`) | Deterministic contradiction/missing-field scanner with one-click **navigate-to-target** (`Inspect [Entity]`, `Edit [Story Bible field]`) without mutating revision count. | `SC-06` |
| **Undo / Redo & Revision History** | Bottom bar (`Undo`/`Redo`) + Right column Tab 4 (`History`) | Transaction-level Undo/Redo + durable revision list with non-destructive Restore (creates safety checkpoint before restoring). | `SC-10`, `SC-12` |
| **Multi-Project Management & Export/Import** | Right column Tab 4 (`History`) | Create/switch/delete local projects; Export JSON backup, Export Story Bible `.md`, Export Refined Prompt; Import JSON backup (file or paste). | `SC-10` |
| **Review Plan & Prompt Modal** | Bottom bar (`Review Plan & Prompt`) | Inspect compiled prompt and before/after diff before spending generation calls; keyboard focus-trapped dialog. | `SC-07` |
| **Story & Image Output Gallery** | Center bottom collapsible deck (`OutputGallery`) | Explicit generation trigger only; `Outdated` badge when plan diverges; Story prose with Copy/Download; Image grid with keyboard focus-trapped fullscreen Lightbox. | `SC-08`, `SC-09`, `SC-12` |
| **Storage Safety & Error Recovery** | Top alert banner (`App.tsx`) | Multi-tab CAS conflict warning (`Reload latest` / `Overwrite`), IndexedDB `read_error` write-gate (`Retry Storage Read` with 0 destructive puts), API error banners. | `SC-15` |
| **Light & Dark Theme + About Modal** | Top `Header` (`Dark Theme`, `About`) | Full Light/Dark token parity; keyboard focus-trapped `InfoModal`. | `SC-16` |

---

## 4. Explicit "Do-Not-Invent" Matrix (Hard Figma Guardrails)

Designers **MUST NOT** draw mockups implying the following unbuilt features exist in Stage 1 unless separately scoped as a future roadmap epic:

| Forbidden / Unbuilt Concept | Why It Must NOT Appear in Stage 1 Figma | Current Reality in Codebase |
| :--- | :--- | :--- |
| **Video Mode / Video Storyboard** | Permanently removed in 2.0 (`feature-preservation-matrix.md`). | Only `'story' \| 'image'` exist; legacy `'video'` migrates to `'story'`. |
| **Rich Long-Form Manuscript / Chapter Editor** | App generates single-pass stories from a canonical plan; it is not Scrivener/Google Docs. | `OutputGallery` displays generated story text with Copy/Download; no chapter/scene WYSIWYG editor. |
| **Chapter / Scene Timeline View** | No scene-ordering or chronological timeline data model exists in Schema v3. | Canonical model stores entities, attributes, relationships, and Story Bible fields only. |
| **Cloud Sync / User Accounts / Collaboration / Share Links** | Architecture is strictly local-first (IndexedDB + localStorage). | No backend database, no authentication, no real-time multiplayer. |
| **Unlimited Free AI / Auto-Regenerate on Every Keystroke** | Every Gemini/Imagen call is billed server-side and must remain **explicitly user-triggered**. | Zero background AI auto-generation; explicit button clicks only. |
| **Guaranteed Visual Character Consistency Across Images** | Imagen generates prompt-conditioned variations; no LoRA/face-ID lock exists. | Consistent entity attributes are compiled into text prompts, not pixel-locked character embeddings. |
| **Full Semantic AI Continuity Engine** | Consistency Checks are fast deterministic rule checks (`lib/consistencyChecker.ts`), not an LLM narrative critic. | Checks missing fields, conflicting attributes, and absent-entity references deterministically. |

---

## 5. Current Visual Design Tokens (`index.css` & Observed DOM)

| Token Category | Current Production Value | Notes for Figma Variables |
| :--- | :--- | :--- |
| **Sans Font** | `"DM Sans", ui-sans-serif, system-ui, sans-serif` | Body, controls, labels |
| **Display Font** | `"Plus Jakarta Sans", "DM Sans", ui-sans-serif, system-ui, sans-serif` | Headings, brand title |
| **Mono Font** | `"JetBrains Mono", ui-monospace, SFMono-Regular, monospace` | Compiled prompt, char counters, revision IDs |
| **Light Surface / Canvas** | `#ffffff` (cards/header), `#f3f4f6` (`gray-100` app shell) | Measured contrast `4.84–13.33:1` |
| **Dark Surface / Canvas** | `#0d1117` (`--color-gray-950`), `#1f2937` (`--color-gray-850`), `oklch(0.21 0.034 264.665)` (`gray-900`) | Measured contrast `5.25–17.20:1` |
| **Primary Action Blue** | Tailwind `blue-600` (`oklch(0.546 0.245 262.881)`) / Dark accent `blue-400` (`oklch(0.707 0.165 254.624)`) | `5.25:1` white-on-blue CTA contrast |
| **Semantic Status Colors** | Emerald (confirmed/saved), Amber (pending/outdated/warning), Red (error/destructive/absent) | Preserve explicit vs. inferred visual distinction |
| **Motion Curves** | `cubic-bezier(0.16, 1, 0.3, 1)` (`180ms–200ms`); clamped to `0.01ms` under `prefers-reduced-motion: reduce` | Respect reduced motion in prototypes |
| **Current Layout Geometry** | Fixed `63px` top header, 3-column desktop grid (`Decision Inbox` \| `Belief Graph + Output` \| `Contextual Inspector`), fixed `59px` bottom bar (`189px` wrapped on `390px` mobile) | Key source of vertical/horizontal crowding (`SC-11`, `SC-13`) |

---

## 6. Reference Baseline Screenshots (`docs/ux-baseline/assets/`)

All 16 captures were generated deterministically from real production code and visually inspected:
- **Empty & Onboarding:** `SC-01.png` (`1440×900`, `FX-EMPTY`) — shows `"Untitled creative project"` pre-fill & blank canvas without CTA (`F-13`).
- **Core Desktop 3-Column Flows:** `SC-02.png` (Decision Inbox), `SC-03.png` (Graph + Inspector), `SC-04.png` (15-entity Graph + Filters), `SC-05.png` (Story Bible), `SC-06.png` (Consistency Checks), `SC-07.png` (NL Batch Preview + Review Modal).
- **Outputs & History:** `SC-08.png` (Generated Story + Outdated badge — note cramped ~5-line reader height, `F-06`), `SC-09.png` (Image Gallery + Fullscreen Lightbox), `SC-10.png` (History, Projects & Export).
- **Responsive Breakpoints & Error/Theme States:** `SC-11.png` (`390×844` Mobile workspace + `189px` footer, `F-04`), `SC-12.png` (`390×844` Mobile Story output), `SC-13.png` (`1280×800` Cramped Laptop — shows 3 simultaneous Generate CTAs, `F-07`), `SC-14.png` (`768×1024` Tablet + clipped header actions, `F-05`), `SC-15.png` (`390×844` IndexedDB `read_error` banner), `SC-16.png` (`1440×900` Dark Theme).

---

## 7. Three Candidate Redesign Directions (Evaluated Against `J01`–`J12`)

### Option A: Workflow-First Creative Studio (**RECOMMENDED**)
- **Concept:** Replace the permanent 3-column desktop crowd (`SC-13`) with a **focused primary stage + collapsible contextual drawer**, anchored by a truthful top-level workspace stepper/navigation (`Plan & Inbox` → `World Graph` → `Story Bible & Checks` → `Generate & Output`) plus a persistent top-level **Project Switcher** and compact single-row action bar.
- **Strengths against `J01`–`J12`:**
  - Directly addresses **`F-06`** (full-height story reading & image gallery without competing with SVG canvas), **`F-07`** (single clear primary Generate CTA instead of 3 competing buttons), **`F-08`** (truthful top-level navigation state), **`F-04`** (clean mobile bottom sheet/action bar instead of 4-row `189px` wrap), and **`F-10`** (top-level Project Switcher instead of burying projects inside History).
  - Preserves side-by-side Graph + Inspector when in the World Graph view, and keeps Decision Inbox accessible as a toggleable side rail or primary queue.
- **Disconfirming Evidence / Trade-offs:**
  - Power users who want to watch the Belief Graph mutate *simultaneously* while clicking Accept in the Decision Inbox (`J02`) lose the always-visible 3-column simultaneous view unless an optional "Split View" toggle is provided on wide desktops (`≥1440px`).
  - Introduces mode/view switching friction if transitions between `Checks` → `Inspector` (`J10`) don't include an explicit "Back to Checks" breadcrumb.

### Option B: Graph-First Visual Canvas (Spatial Whiteboard)
- **Concept:** Full-bleed infinite Belief Graph canvas (`100%` viewport) with floating translucent HUD panels for Decision Inbox, Inspector, Story Bible, and Output drawer (Figma/Miro spatial metaphor).
- **Strengths against `J01`–`J12`:**
  - Maximizes breathing room for dense graphs (`SC-04`, `15–100+` nodes), mitigating `F-15` (tiny zoomed-out node labels, initial viewport clipping, and prompt-budget pressure at large entity counts).
  - Visually reinforces the Belief Graph as the app's signature differentiator.
- **Disconfirming Evidence / Trade-offs:**
  - **Poor fit for Story reading (`J07`), Story Bible forms (`J04`), and Mobile (`SC-11`/`SC-12`)**: floating panels obscure the canvas, feel awkward for multi-paragraph prose, and collapse poorly on `390px` screens.
  - High accessibility risk for keyboard focus order and screen-reader reading order across floating overlays.

### Option C: Writing-First Editorial Studio (Document + Side Intelligence)
- **Concept:** Center column is a clean editorial canvas combining Seed Idea, Story Bible, Refined Prompt, and Generated Story Output; Belief Graph and Decision Inbox live in collapsible right-hand tabs/drawers.
- **Strengths against `J01`–`J12`:**
  - Best typography and reading comfort for `J04` (Story Bible) and `J07` (Generated Story).
  - Cleanest responsive collapse for `390×844` mobile and `768×1024` tablet.
- **Disconfirming Evidence / Trade-offs:**
  - **Demotes the Belief Graph (`J05`) and Image Mode (`J08`)** to secondary drawers, weakening the core "Proactive Co-Creator" graph-grounded differentiation and potentially misleading users into expecting a full chapter/manuscript editor (violating the Do-Not-Invent guardrail).

### Recommendation Summary
**Proceed to Figma exploration with Option A (Workflow-First Creative Studio)**, incorporating a desktop wide-screen (`≥1440px`) optional split-pane toggle (so `Decision Inbox + Belief Graph` can still be inspected together) and a dedicated full-height **Output Stage** for `J07`/`J08`. Prototype **Option B's expanded canvas mode** as a maximize toggle inside the Graph view rather than the entire app shell.

---

## 8. Top 5 Testable UX Hypotheses for Figma Prototype Validation

| ID | Hypothesis Statement | Target Findings | Validation Signal in Prototype Testing |
| :--- | :--- | :---: | :--- |
| **H1** | Replacing the 3 simultaneous `Generate Story` buttons (`SC-13`) with one contextual primary CTA + clear readiness badge reduces user hesitation before first generation. | `F-07`, `F-13` | Users identify what to click first on `FX-EMPTY` (`SC-01`) and trigger Generate on `FX-SIMPLE` without scanning 3 panels. |
| **H2** | Moving Story/Image Output to a full-height dedicated view/drawer (`≥65%` viewport height) improves story reading comprehension and outdated-state recovery compared to the current ~5-line bottom deck. | `F-06` | Users read generated story, notice the `Outdated` banner, and navigate back to edit without excessive inner scrolling. |
| **H3** | Elevating the Project Switcher and Export/Backup actions out of the `History` tab into the top header improves multi-project discoverability and backup confidence. | `F-10` | Users find "New Project" and "Export Backup" in ≤2 clicks without searching Inspector tabs. |
| **H4** | Collapsing the mobile `WorkspaceBottomBar` from 4 wrapped rows (`189px`) into a single `56px` bar + overflow action sheet makes `390×844` editing and reading viable without horizontal clipping. | `F-04`, `F-05` | Zero right-clipped controls on `320px`/`390px`/`768px`; content area gains `≥130px` vertical height on mobile. |
| **H5** | Making `AI-Suggested (Pending)` vs `User-Confirmed` visually distinct via consistent semantic iconography + inline provenance chips (plus an explicit `Back to Checks` breadcrumb) increases trust in AI co-creation. | `J02`, `J10` | Users accurately distinguish unconfirmed AI guesses from locked Story Bible facts on first glance. |

---

## 9. Unresolved Product Owner Scope Decisions (Must Be Decided Before Stage 1 Code)

1. **Desktop Split-Pane Default (`1280px` vs `1440px`):** Should `1280×800` laptops default to 2 columns (with a toggleable 3rd pane) instead of cramming 3 fixed columns?
2. **Large-Graph Threshold Policy (`F-15`):** At `100+` entities, compiled prompts approach/exceed the `8,000`-character server limit (`17,814` chars at `250` entities). Should Stage 1 introduce smart entity prioritization/filtering for prompt compilation, or warn/cap entity count?
3. **NL Batch Placement (`J06`):** Should Natural-Language Batch Editing become a dedicated command bar / modal overlay instead of sitting inside the Decision Inbox scroll pane where it pushes pending cards below the fold?
4. **Restore Confirmation UX (`J12`):** Should clicking `Restore` on a Revision History entry show a before/after preview modal first, or remain one-click with the existing automatic safety checkpoint + Undo toast?
5. **Public Deployment Roadmap:** Are user accounts, per-user Gemini quotas, and cloud persistence planned for a later stage, or does the product remain local-first single-user?

---

## 10. Separate Deferred Roadmap (Explicitly Out of Stage 0 & Stage 1 Redesign)

- **Stage 1 (Post-Figma Sign-Off):** Implement the approved visual shell and responsive navigation against canonical findings `F-04`–`F-15` (responsive layout, navigation, accessibility, discoverability, and micro-bugs); handle bundle splitting under `F-16` in the planned code-health stage unless the approved design makes it necessary earlier. Keep product expansion out of this visual redesign.
- **Stage 2+ (Future Product Epics — Require New Schema/Backend):** Graph scalability (WebGL/Canvas renderer or clustering for `100–250+` nodes), prompt-budget prioritization UI, authenticated cloud sync & per-user API quota enforcement, optional multi-scene outlining.
