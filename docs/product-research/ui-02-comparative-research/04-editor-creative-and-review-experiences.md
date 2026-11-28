# 04 — Editor, Creative Studio, Story Development, Review & Story Q&A Experiences

**Assignment:** `PCC-UI-RESEARCH-02` — Comparative UX Research, Design Synthesis & Product-Wide Interaction Blueprint  
**Status:** Complete (Cycle 5 Detailed Screen-Family & Interaction Specification)  
**Scope:** Full screen-family interaction specifications (purpose, entry, primary/secondary actions, **all 8 operational states**: *empty, ready, loading, partial, error, recovery, success, stale*, keyboard & responsive behavior, zero-manual learning via `UIRF-04 Show Me How`, and exact exit/return behavior) for **Write & Distraction-Free Reading (`UIRF-06`)**, **Creative Studio**, **Story Development**, **Review**, and **Story Q&A** — grounded identically in *"The Salt Ledger / Tuz Defteri"*.

*(For **World** visualizations see [05 — Narrative Visualization and Context](./05-narrative-visualization-and-context.md); for **Projects/Home**, **AI Settings**, **Operation Center**, **Context Inspector**, and **Secondary Visuals** see [07 — Projects, Settings, Recovery and New Opportunities](./07-projects-settings-recovery-and-new-opportunities.md).)*

---

## 1. Write & Distraction-Free Reading (`UIRF-06`)

### 1.1 Purpose, Entry & Structural Elevation of Existing `WritingAssistantPanel`
- **Purpose:** Calm, durable, distraction-free manuscript drafting, true formatted reading, lightweight local context, and visible selection/cursor-aware AI assistance that never alters prose silently.
- **Entry Points:** Global `Write` destination, `Projects → Continue Writing`, or any citation/scene deep link (`UIRF-03`).
- **Critical Elevation Over Current App (`OR-Write-1`, `OR-Write-2`, `UX-03`):**
  1. **True Safe Formatted Markdown (`Edit` | `Read` | `Split`):** `Edit` keeps raw plain-Markdown `<textarea>` (preserving exact source offsets, undo stack, IME composition guards `isComposing`, and OS dictation `GS-06`). `Read` renders a **safe, sanitized Markdown AST** (headings, emphasis, blockquotes, lists, tables, code, ornamental `---` scene breaks) while strictly **blocking raw HTML/scripts, unsafe URLs (`javascript:`, `data:`), and automatic remote image/resource loads (`UIRF-06`)**. Optional desktop `Split` shows `Edit` left + synced `Read` right. Zero permanent technical security banner above the prose cursor.
  2. **Visible Contextual Writing Assist (Elevating `WritingAssistantPanel.tsx`):** Move the existing 8 actions (`Continue`, `Rewrite`, `Improve Clarity`, `Shorten`, `Expand`, `Dialogue`, `Alternatives`, `Custom`) OUT of the buried bottom `<details>` block (`ManuscriptEditor.tsx:396`) into a **slim visible Contextual Assist Trigger** at the top of the sheet AND an unobtrusive **Selection Action Bar** whenever text is highlighted (in `Edit` OR `Read` mode per `UIRF-06`). Replace raw technical prose (*"offsets 412–589 · confirmed entities (N)"*) with plain writer phrasing (*"Selected 38 words in Ch. 4 · Uses your Story Bible & 2 active locks · [Inspect Context]"*).
  3. **Scene Metadata & Voice as Useful Context (Not a Giant Form):** Collapse today's 7 stacked bare inputs (`SectionDetailFields.tsx`) into a clean, single-line **Scene Context Bar** beneath the chapter title (`1982 Summer · POV: Leyla · Karaburun Lighthouse · Draft · [Edit details]`), opening an auto-growing drawer with plain examples (`UIRF-04`) only when clicked.

### 1.2 Distraction-Free Reading (`UIRF-06`) & Reading-to-Action Loop
- Toggling **`Focus Read`** (`Cmd+Shift+F` in `Read` mode) hides global navigation, outline, and metadata — showing pure typeset `Literata` prose (`62–72ch` centered measure) with a quiet hover/keyboard-reachable typography menu (`Font size`, `Line spacing`, `Page width`, `Warm/Paper/Dark`, `Continuous Chapter Scroll` vs. `Single Scene`).
- **Action From Reading Without Mutating Source:** Highlighting a passage while reading reveals a subtle pill: **`Improve (Develop)` · `Ask Story (Q&A)` · `Add Margin Note` · `Explore Ideas (Studio)`**. None of these directly edits raw Markdown; any prose edit opens a safe before/after proposal preview with exact source-offset verification.

### 1.3 Combined Local Writing Insights (`UI-NEW-05` + `UI-NEW-07`)
- Optional zero-AI toggle (`Insights`) in `Write` (and reusable in `Story Development`):
  - **Scene Rhythm & Dialogue Density (`UI-NEW-05`):** Quiet outline micro-bar showing chapter word length and narration-vs-dialogue balance using transparent multilingual quotation heuristics (`"..."`, `«...»`, Turkish `—` dialogue dashes), explicitly labeled *"Local heuristic — not a quality score"*.
  - **Repeated Phrase & Motif Highlighter (`UI-NEW-07`):** Highlights nearby repeated words/phrases in `Read` or `Edit` margin with an explicit **`Mark as Intentional Motif`** button (never flagging intentional literary repetition as an error; discloses Turkish agglutinative suffix tokenization limits honestly).

### 1.4 Eight-State & Ergonomics Contract (`Write`)

| State | Behavior |
|---|---|
| **Empty** | Blank scene shows gentle placeholder (`"Begin writing, or press Cmd+J to brainstorm an opening…"`), plus 1-line `Show Me How` (`UIRF-04`) tip for Markdown headings (`# Chapter 1`) and scene splits. |
| **Ready / Populated** | Clean `Edit`/`Read` canvas, collapsible Chapter→Scene outline, optional lightweight Scene Margin (local cast/beliefs/locks, zero paid AI), visible `Write Assist` trigger. |
| **Loading (Assist)** | Non-blocking tinted Draft Proposal card beside selection (`Generating subtext suggestion · 4s · [Cancel]`); author can keep reading or scroll unhindered. |
| **Partial** | Streaming prose or partial batch clearly badged `Draft streaming…` — apply buttons stay disabled until complete & validated. |
| **Error / Unavailable** | If AI unconfigured/offline/rate-limited: calm notice *"AI Writing Assist unavailable ([reason]) — [Open AI Settings]. Manual editing, formatted reading, and Local Insights remain available."* |
| **Recovery** | Auto-stashed working draft recovers after reload/crash with non-blocking top bar: *"Recovered unsaved draft from 14:22 — [Keep] [Compare with Saved] [Discard]"*. |
| **Success** | Atomic apply shows calm toast: *"Updated Ch. 4 — Sealed Manifest · [Undo] · [View Diff]"*; `Saved` status updates ONLY after durable persistence confirms (`WP01 M4`). |
| **Stale** | If author edits Ch. 4 while a Writing Assist proposal is open, `Replace Selection` disables with clear message: *"Passage changed since preview — [Re-run] [Insert as New Scene] [Keep as Alternative]"* (preserving `WritingAssistantPanel.tsx:361` guard). |
| **Keyboard / Mobile / Exit** | `Cmd+Shift+P` (`Edit`/`Read`), `Cmd+Shift+F` (Focus), `Cmd+J` (Assist), `Cmd+B` (Outline). Mobile (`390×844`) collapses outline to slide-over drawer and opens Assist proposals as bottom/full sheet. Switching away auto-stashes draft (zero `allowNavigation` hard lock) and saves exact cursor/scroll for instant return. |

---

## 2. Creative Studio (`CreativeSession` & Voluntary `Grill Me`)

### 2.1 Purpose, Entry & Distinction From Story Development
- **Purpose:** Open-ended **creative discovery and experimentation** — finding hidden connections, story seeds, foreshadowing twists, What-Ifs, and voluntary premise/mid-story interviews. Visually distinguished by a quiet **Draft/Exploration** register (`--surface-draft` on idea cards) so brainstorming NEVER looks like committed canon.
- **Entry Points:** Global `Studio` destination, `Projects → Start from Premise`, `Write → Explore Ideas`, `World → Story Q&A bridge (S-04)`.
- **Four Accessible Studio Modes (All Reachable in `Calm` — `OD-01`):**
  1. **`Discover with AI`** (AI-led story-specific opportunities & story seeds)
  2. **`Guided Exploration`** (Voluntary adaptive **`Grill Me`** interview)
  3. **`Focused Development`** (Author-selected scope: entities, relations, scenes, passage, whole story + free text)
  4. **`Story Lab`** (Connection Discovery, Foreshadowing Architect, Mystery Builder, What-Ifs, Scene Simulator, Reverse Plotting, Alternative Endings, Ripple Analysis)
  - *Left Collapsible Rail (`240px`):* **Active & Saved Sessions** (retained by default per `OD-05`, manual recoverable archive/delete), **Creative Collection (`IR-03`)** (private searchable Idea Library across sessions), and **Visuals / Concept Art (`OD-07`)**.

### 2.2 Exact Owner-Approved Card & Direction Semantics (`CE-02`, `CE-03`, `GS-04`)

Concrete worked example using ***The Salt Ledger*** (`Scope: Ch. 4 + Harbor Clerk Kemal + 1954 Logbook`, `Intensity: Bold` — explicitly noted *"Controls creative boldness, not model reasoning effort"*, `Creative DNA: Blend`):

```text
CREATIVE STUDIO — ACTIVE SESSION: "Act II Harbor Complicity Twists" [PROPOSAL]
Scope: [Ch. 4] [Kemal] [1954 Logbook] [+ Add]  | Intensity: [Subtle|Balanced|*Bold*|Radical] | [Context Inspector]
--------------------------------------------------------------------------------------------------------------------
STEP 1 — DIRECTIONS (Select 1+ angles to explore; selecting NEVER alters your story)
[x] Unwitting Complicity   [x] Hidden Witness in 1954   [ ] Forged by Coercion   [+ Suggest More Directions]

Your own direction or idea:
+-----------------------------------------------------------------------+  [Suggest Directions]  [Generate Idea]
| What if Kemal's late sister worked at the customs desk in 1954?       |  (angles only)         (concrete card)
+-----------------------------------------------------------------------+
                                                           [Develop with Selected Directions (2)]  [Surprise Me]

STEP 2 — CONCRETE STORY IDEAS (Drafts — Multi-select to Combine, Save, Dismiss, or Preview Patch)
+--------------------------------------------------+  +--------------------------------------------------+
| [x] IDEA A (v2 of 2) · Unwitting Complicity      |  | [x] IDEA B (v1) · Hidden Witness in 1954         |
| "Kemal stamped blank clearance slips in 1954     |  | "The missing manifest page was stitched inside   |
| believing they were routine salt-tax tallies;    |  | Leyla's mother's coastal hymnal, annotated in    |
| Arif exploited his signature."                   |  | Turkish margin notes only Leyla recognizes."     |
|                                                  |  |                                                  |
| [Develop Further] [Regenerate One] [Edit Idea]   |  | [Develop Further] [Regenerate One] [Edit Idea]   |
| [Save for Later]  [More v: Challenge / Explain   |  | [* Saved in Collection] [Preview Patch ->]       |
|  Differently / Dismiss]        [Preview Patch ->]|  |                                                  |
+--------------------------------------------------+  +--------------------------------------------------+
Selected (2): [Combine Selected]  [Compare Side-by-Side]  [Save Selected]  [Dismiss Selected]  [Preview Aggregate ->]
```

**Non-Negotiable Semantic Rules Enforced in UI:**
- **`Suggest More Directions`:** Appends distinct new direction chips WITHOUT clearing existing checked directions.
- **Custom Input Dual Buttons:** **`Suggest Directions`** generates ONLY new direction angles grounded in the input; **`Generate Idea`** generates a concrete playable idea card immediately.
- **Per-Card `Regenerate One`:** Replaces ONLY that card while preserving sibling cards AND keeping prior versions accessible in the `v1 / v2` pill.
- **`Develop Further`:** Preserves the core essence of the chosen idea while deepening or branching it rather than discarding it.
- **`Edit Idea` vs. `Edit Actual Patch`:** Editing the idea card refines the exploration concept (non-canonical); editing the actual patch happens inside `Final Preview` and deterministically regenerates the previewed diff/Change Map (`E3`).
- **Zero Approval Ceremony:** Clicking **`Preview Patch ->`** opens the exact `UnifiedProposal` preview directly (`Apply Current / Selected`, `Save as Alternative Project [Stay Current default]`, `Save Draft`, `Continue Exploring`) — NEVER forcing `Accept → Send to Change Review → Apply`.

### 2.3 Voluntary Adaptive `Grill Me` (`CE-08`, `CE-10`)
- **Behavioral Mode Switcher:** `Inspire Me` *(gentle sparks)* | `Explore with Me` *(balanced questions)* | `Grill Me` *(probing dependencies)* | `Challenge Me` *(stress-test weak links)*.
- **Worked Turn (*Salt Ledger*):**
  - *Question 3 of session:* *"If Kemal unknowingly stamped Arif's forged clearance in 1954, why did Kemal stay silent after Arif's 1961 death?"*
  - *Why this matters:* *"Determines whether Kemal is an ally waiting to break or an active obstacle in Act II."*
  - *Choices:* `( ) He never realized the dates overlapped (Recommended)` | `( ) Someone threatened his sister` | `( ) Write custom answer…` | `[Skip / Leave as Open Mystery]` | `[Explain Differently]` | `[← Backtrack Q2]`.
  - **Right Optional Companion:** **Live Non-Canonical Draft Sketch** updating gently as answers accumulate (`DRAFT SKETCH — NOT CANON`).
  - **Always-Visible Exit:** **`Stop & Preview Concept`** works after *any* round (1 question or 10) — zero forced completion, zero duplicate questions about already established facts, zero automatic canon application.

### 2.4 Eight-State Contract (`Creative Studio`)
- **Empty:** Actionable starter cards (`Start from a Premise with Grill Me`, `Find Hidden Story Seeds`, `Connect Two Story Elements`) + `Show Me How` (`UIRF-04`) static synthetic example.
- **Ready / Populated:** Two-tier Directions + Concrete Idea Cards + auto-saved Sessions shelf.
- **Loading:** Localized shimmer on newly requested direction chips or specific regenerating card only — author can keep reading, starring, or editing sibling cards.
- **Partial:** If a batch returns 2 of 3 cards before timeout, shows valid 2 cards clearly labeled `Partial batch (2 received) · [Retry for more]`.
- **Error / Unavailable:** Manual idea creation, editing, tagging, Collection browsing, and session organization remain 100% functional offline; clear notice + `Open AI Settings`.
- **Recovery:** Sessions autosave incrementally locally; accidental `Dismiss` offers 10s `Undo` + permanent `Dismissed History` recovery filter; reloading restores exact session without re-firing consumed AI calls (`CE-03`).
- **Success:** Explicit distinction between `Saved to Collection` (bookmark) vs. `Applied to Story · [Undo]` vs. `Saved Independent Alternative (still in Salt Ledger)`.
- **Stale:** If canonical manuscript changed after a staged patch was generated, `Preview Patch` clearly flags `Story changed since draft — [Refresh Patch Preview]` before allowing apply.

---

## 3. Story Development (`UID-02` — Distinct From Studio & Review)

### 3.1 Purpose & Distinct Author Posture
- **Purpose:** **Expand, deepen, and strengthen the EXISTING story** while faithfully protecting its core plot, characters, ending, and author voice (e.g., *"Expand a 3-page chapter without inventing unwanted plot twists"*).
- **Entry Points:** Global `Develop` destination, `Write → Strengthen Selection/Scene`, `Story Q&A → Develop Bridge`.
- **Five Cohesive Lenses (Scene-Level OR Story-Wide Scope):**
  1. **`Expand & Continue`** (flesh out thin beats or bridge scene transitions faithfully)
  2. **`Character Depth`** (interiority, motivation, behavioral consistency)
  3. **`Scene & Dialogue / Subtext`** (sharp exchanges, unspoken tension, `S-02` belief-clash cues)
  4. **`Pacing & Structure`** (beat rhythm, scene proportions — pairs with local `UI-NEW-05` rhythm bar)
  5. **`Voice & Tighten (Compression)`** (`S-05` redundancy lens — explicitly respects deliberate literary repetition & motifs via `UI-NEW-07`)

### 3.2 Preservation Policy & Two-Tier Creative Locks (`OD-06`, `S-01`, `CE-06`)
Directly visible at the top of `Story Development` (never hidden in settings):
- **Tier 1 — 🔒 Hard Structural Locks (Deterministically Checked on Patch):** Pin concrete targets (`Entity: Brass Fresnel Lens`, `Scene Span: Ch. 3 §2 date "14 August 1954"`, `Story Rule: Arif died in 1961`). Validated deterministically against the resulting `UnifiedProposal` patch before Apply (`S-01`).
- **Tier 2 — 🧭 Soft Semantic Guidance (AI-Guided, Honestly Non-Deterministic):** Repeatable custom rows (`+ Add guidance row`), e.g., *"Keep Leyla dry and understated; avoid melodrama"* — explicitly badged `Semantic guidance (verified by your review, not deterministic lock)` (`OD-06`).
- **Scope Toggle:** `Active Scene (Ch. 4)` vs. `Selected Passage` vs. `Multi-Scene Arc` vs. `Whole Story` (with explicit `Context Inspector` showing included/omitted scenes).
- **Eight States:** Mirrors `Write` & `Review` proposal lifecycle (`Empty` shows 5 lens starter cards + `Show Me How` example; `Stale` blocks blind apply; `Success` provides atomic hunk apply + 1-click `Undo` or `Save Alternative`).

---

## 4. Review (`Diagnostics`, `Sync`, `Hunk Diff`, `Change Map`, `History`)

### 4.1 Clear Triage Hierarchy (Fixing `OR-Review-1`)
Instead of today's dense vertical stack (`NarrativeReview.tsx`), `Review` opens with a calm, plain-language **Triage Header** answering *"What actually needs my attention, and why?"*:
1. **Tab 1 — `Issues & Checks` (Default):**
   - **Section A — Actual Continuity Issues (`1`):** Real contradictions with severity, plain explanation, and source links (`Ch. 2 §2` vs. `Ch. 7 §4` Brass Lens contradiction).
   - **Section B — Readiness Hints (`2`, Visually Subordinate & Collapsible):** Gentle reminders (`Ch. 8 has no story-time note`), explicitly labeled *"Optional reminders — not errors"*.
   - **Section C — Local vs. AI Scan Controls:** Equal prominent **`Run Local Checks (Instant, Offline)`** and **`Run Scoped AI Check`** (with explicit scope picker: `Changed Since Last Check`, `Scene`, `Entity`, `Full Segmented Scan` + `Context Inspector` coverage disclosure).
2. **Tab 2 — `Manuscript ↔ World Sync`:** Explicit directional choice (`Update World from Manuscript` vs. `Reflect World Edits in Manuscript`), clear freshness status, and side-by-side patch review.
3. **Tab 3 — `Revision History` (Full-Width Surface — Fixing `OR-History` & `UX-14`):** Full-width revision timeline + clean 2-pane diff comparison + selective safe revert (completely removing duplicate `Export` and `Saved Projects` widgets from History!).
4. **Tab 4 — `Evidence & Audit` (On-Demand Advanced):** Technical provenance logs, source digests, claim ledger, and JSON/Markdown audit export tucked cleanly here so everyday authors aren't overwhelmed while power reviewers have 1-click access (`UID-05`).

### 4.2 Sentence / Hunk-Level Partial Selection (`UI-NEW-06`) & Deterministic Patch Preview (`S-06`)
When inspecting any prose/model fix in `Review` (or `Story Development` / `Studio` Final Preview):
- **Independent Hunks Selectable by Default:** A multi-part fix breaks into clearly numbered, checkbox-selectable hunks (`[x] Hunk 1: Ch. 7 §4 "1962 replacement lens"`, `[x] Hunk 2: World Object "Brass Fresnel Lens" condition`).
- **Dependent / Overlapping Hunks Grouped & Flagged (`IR-04`):** If Hunk 2 logically depends on Hunk 1 (or two hunks touch overlapping character spans), the UI visually links them (`Linked with Hunk 1 — unchecking Hunk 1 updates or deselects dependent change`) and **deterministically recompiles** the exact Before/After diff, Lock validation (`OD-06`), approval digest, and **Patch Change Map** (`05 §2.7`).
- **Manual Edit Preserved:** Author can click **`Edit Proposed Text`** on any hunk; editing immediately invalidates the old approval digest and regenerates the exact preview before `Apply Selected` re-enables.
- **Stale / Conflict / Lock Failure States:**
  - *Hard Lock Conflict:* Red lock banner names exact locked target (`Blocked by Hard Lock: Ch. 3 §2 date`) with `Edit Proposal`, `Save as Alternative (relaxed locks)`, or explicit `Unlock Rule` — never silent override.
  - *Stale Base Revision:* Amber notice (`Ch. 7 was edited in Write since preview — [Refresh Preview on Latest Ch. 7]`).
  - *Durable Save vs. Staged Distinction:* Staged selections show `Staged (not yet applied)`; only after durable storage commit does `Applied · Checkpoint 15 · [Undo]` appear.

---

## 5. Story Q&A (`CE-11`, `S-04`, `UI-NEW-03`)

- **Clear Distinction From `Grill Me`:**
  - **`Story Q&A` = Author asks about the existing story** (*"Does Leyla know Arif forged the logbook as of Ch. 5?"*) → PCC retrieves local evidence and answers with exact source citations, revision/scope coverage, and explicit uncertainty (*"No passage establishes that Leyla knows; absence of evidence does not prove ignorance"*).
  - **`Grill Me` = AI asks the author probing questions** to help invent or sharpen new story choices.
- **Entry Points:** Dedicated top-bar `Story Q&A` button (opens in Companion Pane beside current task OR full-width in `World → Story Q&A`), plus `Write` selection menu (`Ask Story about this passage`).
- **Source-Bound Citation Peek (`UI-NEW-03`):**
  - Clicking `[Ch. 5 §1]` opens the exact version-bound passage in the Companion Pane (or compact popover on mobile) with the verbatim span highlighted — preserving the Q&A thread alongside it.
  - **Stale / Ambiguous Anchor Fail-Safe:** If `Ch. 5` was edited and the quoted span no longer matches uniquely, PCC refuses to highlight the wrong line and displays: *"Source passage changed since answer (Rev #12 → #14) — [View Historical Quote] [Jump to Ch. 5] [Re-ask on Current Draft]"*.
- **Bridge to Creation (`S-04`):** Every grounded answer includes an explicit non-mutating handoff button: **`Turn Insight into Studio Draft →`** or **`Open in Story Development →`** (pre-populating the verified anchors as scope — never turning Q&A chat into silent canon mutation).
- **Spoiler Boundary Protection:** Honors the active `Reader As-Of` boundary if toggled (`05 §3`), warning transparently if a free-text query touches facts beyond the selected chapter.

---

## 6. Cross-References & Checkpoint Status

- **Completed in this file:** Complete 8-state screen-family specifications for `Write` (+ `UIRF-06` Distraction-Free Reading, elevated `WritingAssistantPanel`, `Local Writing Insights`), `Creative Studio` (all exact `CE-02/03` card semantics + voluntary 4-mode `Grill Me`), `Story Development` (5 lenses + two-tier locks), `Review` (clear triage, `UI-NEW-06` hunk selection, full-width History), and `Story Q&A` (`UI-NEW-03`, `S-04`).
- **Next documents (Batch 3):** [05 — Narrative Visualization and Context](./05-narrative-visualization-and-context.md) and [06 — Visual Directions and Design System](./06-visual-directions-and-design-system.md).
