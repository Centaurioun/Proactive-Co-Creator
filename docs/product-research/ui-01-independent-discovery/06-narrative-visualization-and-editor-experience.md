# 06 — Narrative Visualization and Editor Experience

**Assignment:** `PCC-UI-RESEARCH-01` — Independent UX, Information Architecture & Visual Design Discovery  
**Status:** Complete (Cycle 3–5 Deep Experience & Visualization Grammar)  
**Scope:** Visual semantics for every narrative perspective (Graph, Mind Map replacement, Dual-Track Timeline, Knowledge/Epistemic Matrix, Threads & Qualitative Tension, Deterministic Change Map vs. Speculative Impact), scaling to large novels (80+ entities), accessible nonvisual fallbacks, plus deep UX design for the **Formatted Writing & Reading Experience**, **Creative Studio & Alternative Comparison**, **Project Overview**, **Operation Center**, **Context Inspector**, and **5-Tab AI Settings + Embeddings Console**.

---

## 1. Visualization Semantics: Right Visual Form for Each Narrative Question

A core failure of many creative tools is forcing every narrative concept into a force-directed node-link graph — creating unreadable hairballs and implying false semantics (e.g., making temporal sequence look like causation, or making a character's false rumor look like world truth).

### 1.1 Semantic Decision Matrix (When to Use Graph vs. Timeline vs. Matrix vs. List/Prose)

| Author's Question | Best Visual Form (`Proposal`) | Why NOT Another Form? | Accessible Nonvisual Alternative |
|---|---|---|---|
| *"How do characters, places, and objects connect socially or structurally?"* | **Story Map (Graph / Ego / Kinship)** | Tables hide 2-hop bridges; prose hides structural clusters | Built-in **Accessible Relationship Table** (`Table` toggle) with keyboard sorting & entity filtering |
| *"What happens in what order — as the reader reads it vs. when it occurred in story time?"* | **Dual-Track Timeline (Reading Order ↔ Story Chronology)** | Graphs conflate time with causation; alphabetical tables scramble dates (`UX-06`) | Structured **Two-Column Sequence Table** (`Reading #`, `Story-Time Lane`, `Flashback/Uncertain Flag`, `Jump to Scene`) |
| *"Who knows what secret, who suspects, who believes something false, and what does the reader know?"* | **Knowledge & Epistemic Matrix (Characters × Facts/Secrets + Reader Row)** | Graphs cannot cleanly show N characters' divergent stances on M secrets at Chapter X | Screen-reader-native **HTML Matrix Table** (`<th scope="row">Character</th>` × `<th scope="col">Secret/Fact</th>`) |
| *"Which promises, mysteries, and thematic threads are open vs. paid off, and how does tension rise?"* | **Threads & Qualitative Tension Strip (Horizontal Scene Ribbon)** | Static card lists (`MindMapPanel.tsx`) lose sequence across chapters | Expandable **Thread Ledger List** grouped by Open / Developing / Paid Off with scene links |
| *"What exact facts and text will this AI fix/idea change — vs. what else might be affected?"* | **Split Patch Change Map (Deterministic) + Speculative Impact List (Uncertain)** | Mixing confirmed changes with AI guesses erodes trust (`S-06`) | Structured **Operation-by-Operation Change List** (`Added / Changed / Removed / Unchanged`) + separate `Uncertain Notes` list |
| *"What are my story's tone, genre, continuity rules, and themes?"* | **Editorial Story Bible (Clean Structured Prose Sheet)** | Forcing Story Bible into a fake "Mind Map" card grid (`UX-12`) adds clutter without spatial meaning | Native semantic headings & editable sections |

---

## 2. Deep Visualization Designs (Populated Concept Examples — `Proposal`)

### 2.1 Spacious Story Map (Scaling to 80+ Entities & Removing "Group Guests")

Fixes `UX-02` (`28%` viewport canvas), `UX-10` (hardcoded `Group Guests`), and `UX-13` (silent `.slice(0, 80)` truncation):

- **Canvas Space:** Occupies `>=70%` of desktop viewport (only 1 slim global bar + 1 compact `44px` World view switcher above it).
- **Epistemic Edge & Node Grammar (Never Equating Association with Causation):**
  - **Confirmed Fact edge:** Solid `2px` line (`--semantic-canon`), arrow ONLY when directional; causation appears ONLY if the explicit relationship label is causal (*"caused"*, *"triggered"*).
  - **Character Belief edge:** Dashed line (`6 4`) in `--semantic-belief` with holder chip (`Leyla believes:`).
  - **Reported / Rumor edge:** Dotted line (`2 4`) in `--semantic-inference` (`Reported by: Clerk`).
  - **Proposed / Unreviewed edge:** Soft `--surface-draft` halo + `Proposed` pill.
  - **Ambiguous / Disputed edge:** Double hairline + `?` glyph.
- **Large-Graph Scaling (50–150+ Entities):**
  1. **Domain-General Clustering:** Replace hardcoded `Group Guests` (`GraphToolbar.tsx:124`) with **Group by Category, Faction/Tag, or Chapter Appearance** — collapsing secondary clusters into clean count badges (`Harbor Crew (11) [Expand]`).
  2. **Semantic Zoom (LOD):** At `<65%` zoom, show only major hub labels + cluster hulls; at `65%–100%`, show primary node labels with collision avoidance; at `>100%`, show edge labels and epistemic tags.
  3. **Instant Ego Isolation:** Clicking any node offers **`Focus 1-Hop Neighborhood`** (isolates direct links, dims the rest) so an 80-character novel stays instantly readable.
  4. **Honest Navigator Count:** Never silently slice at 80 (`UX-13`). Show `"Showing 142 entities — filter or jump"` with virtualized list scrolling.

### 2.2 True Dual-Track Timeline (Narrative Order vs. Story Chronology)

Directly replaces today's alphabetical `TimelinePanel.tsx` (`UX-06`, narrow `398px` rail):

- **Core Principle:** Never equate manuscript reading order with story chronology, never invent dates for undated scenes, and never rely on English-only regex to detect flashbacks or uncertainty.
- **Two Synchronized Visual Tracks + Explicit Uncertain Lane:**
  - **Top Track (`Reading Order`):** Scenes ordered `1 → N` exactly as the reader encounters them.
  - **Bottom Track (`Authored Story Chronology`):** Scenes positioned into author-defined era/sequence slots (`1954 Winter` → `1961 Gale` → `1982 Summer`), connected to the top track by gentle curved hairlines so **flashbacks and flash-forwards visually cross over**!
  - **Explicit Right/Bottom Tray (`Undated / Uncertain Placement`):** Scenes without authored chronology stay honestly parked here — never sorted alphabetically into the middle of dated scenes.
  - **Multilingual-Safe Markers:** Explicit author tags (`Flashback`, `Time Uncertain`, custom era text in any language such as Turkish `"1954 Kışı"`).

```text
DUAL-TRACK TIMELINE — POPULATED CONCEPT EXAMPLE ("IZMIR LIGHTHOUSE") [PROPOSAL]
[Reading Order vs. Story Chronology]   [Filter: All Characters v]   [Accessible Table View]

READING ORDER (How the reader reads it)
+----------------+   +----------------+   +----------------+   +----------------+
| #1 Foghorn     |-->| #2 Brass Lens  |-->| #3 1954 Ledger |-->| #4 Sealed Man. |
| (1982 Summer)  |   | (1961 Flashbk) |   | (1954 Winter)  |   | (1982 Summer)  |
+-------+--------+   +-------+--------+   +-------+--------+   +-------+--------+
        |                    |                    |                    |
        |   (curved links reveal non-linear flashback structure)       |
        v                    v                    v                    v
STORY CHRONOLOGY (When events happened — authored only, no invented dates)
[ 1954 Winter ]        [ 1961 Gale ]          [ 1982 Summer ]              | UNDATED / UNCERTAIN
+----------------+     +----------------+     +----------------+           | +------------------+
| #3 1954 Ledger | --> | #2 Brass Lens  | --> | #1 Foghorn     |           | | #5 Harbor Dream  |
| [Tag: Origin]  |     | [Flashback]    |     | #4 Sealed Man. |           | | (? Time unclear) |
+----------------+     +----------------+     +----------------+           | +------------------+
```

### 2.3 Knowledge & Epistemic Matrix (Replacing Static "Mind Map")

Gives authors a genuine **dramatic-irony and mystery instrument** (`PRODUCT-BLUEPRINT.md §4`, `S-02` belief-clash) instead of today's static 2-column card list (`MindMapPanel.tsx`, `UX-12`):

- **Rows:** Key Characters **+** dedicated **`Reader Perspective`** row at top (explicitly tracking dramatic irony — what the reader knows vs. what each character knows!).
- **Columns:** Story Secrets, Core Facts, and Open Mysteries.
- **Chapter Scrubber (`As of: Ch. 1 … Ch. 6 [All]`):** Filters knowledge strictly up to the selected chapter boundary (spoiler-safe).
- **Five Strictly Honest Cell States (Never Inferring Ignorance From Missing Data):**
  - `● Knows` (solid forest — backed by source citation)
  - `◐ Suspects` (half-filled ochre — backed by citation)
  - `✕ Believes Falsely` (crimson-ochre outline + *"thinks clerk forged it"*)
  - `○ Explicitly Unaware` (used **only** when manuscript establishes ignorance)
  - `— Unrecorded` (neutral muted dash — *"Not established in text; absence of evidence ≠ ignorance"*)
- **Belief-Clash Highlight (`S-02`):** When two characters appearing in the same scene hold conflicting recorded beliefs (`Leyla: Believes Falsely` vs. `Arif: Knows`), PCC surfaces a calm **Creative Tension Cue** (`⚡ Belief clash in Ch. 5 — opportunity for dramatic irony`, explicitly NOT flagged as an error!).

```text
KNOWLEDGE & EPISTEMIC MATRIX (AS OF CH. 6) [PROPOSAL]
As of: [Ch. 1] [Ch. 2] [Ch. 3] [Ch. 4] [Ch. 5] [*Ch. 6*]  |  [Show Belief Clashes (1)]

                    | Arif forged 1954 log | Lens is 1962 replica | Letter hidden in hymnal
--------------------+----------------------+----------------------+-------------------------
READER (Audience)   | ● Knows (Ch. 3 §2)   | ● Knows (Ch. 2 §2)   | — Unrecorded
--------------------+----------------------+----------------------+-------------------------
Leyla               | ✕ Believes Clerk did | ○ Unaware (Ch. 4 §1) | — Unrecorded
Captain Arif        | ● Knows (Ch. 3 §2)   | ● Knows (Ch. 2 §2)   | ● Knows (Ch. 3 §4)
Harbor Clerk        | ◐ Suspects (Ch. 5)   | — Unrecorded         | — Unrecorded
--------------------+----------------------+----------------------+-------------------------
⚡ Scene Tension Cue (Ch. 5 — Harbor Office): Leyla & Arif hold opposing recorded stances on
   "Arif forged 1954 log". [Open Ch. 5 in Write]  [Explore Subtext in Studio ->]
```

### 2.4 Threads & Qualitative Tension View

- Tracks **Unresolved Threads, Plot Promises, Foreshadowing Setups/Payoffs, and Thematic Links** across chapters as clean horizontal swimlanes (`Setup Ch. 1` —— `Hint Ch. 4` —— `Open?`).
- Qualitative Tension is shown strictly as **author-marked or qualitatively annotated beats** (`Quiet / Rising / Confrontation / Aftermath`) — **zero fake numerical scores or opaque AI percentages** (`PRODUCT-BLUEPRINT.md §2`).

### 2.5 Patch-Derived Change Map vs. Speculative Impact Analysis (`S-06`)

Whenever an author previews a Fix, Sync Proposal, or Studio/Develop Patch before applying:
- **Left / Top Panel — Deterministic Change Map (`Exact Validated Patch`):**
  - Computed **100% deterministically** from the validated before/after patch operations (NEVER hallucinated by a second AI call).
  - Visual miniature graph/entity diff using **locked stable node coordinates** so nothing jumps:
    - `+ Added` (forest badge + solid green halo)
    - `~ Changed` (ochre badge + before → after inline tooltip)
    - `− Removed` (crimson badge + dashed strikethrough)
    - `· Unchanged Context` (muted neutral)
  - Clicking any visual node highlights the **exact text/model operation** AND links to its **source passage**. Full accessible **Operation List Table** sits one tab away.
- **Right / Bottom Panel — Possible Downstream Impacts (`Uncertain / Speculative`):**
  - Visually separated on a tinted caution panel with explicit header: **`Possible Downstream Ripples (Uncertain — Author Judgment Required)`**.
  - Example: *"Ch. 9 §2 mentions 'the old brass rim' — verify whether this still fits if Ch. 7 switches to a 1962 replica lens."*

---

## 3. Formatted Writing & Reading Experience (Fixing `UX-03` & Elevating `Write`)

### 3.1 True Safe Formatted Markdown Preview & Reading Mode

Today `ManuscriptTextPane.tsx:66-71` renders raw `<pre>{selected?.text}</pre>` and pins a permanent security disclaimer above the cursor (`UX-03`). Proposed redesign (`Proposal`):
- **Single-Click `Edit` / `Read` Segmented Toggle** (plus `Cmd/Ctrl + Shift + P` shortcut):
  - **`Edit` Mode:** Clean plain-Markdown `<textarea>` (preserving exact source bytes, IME composition guards, cursor offsets, and selection restoration), enhanced with quiet editorial typography (`Literata` `18px`, `1.72` line-height, `65–72ch` column) and subtle subtle Markdown syntax rhythm — **no permanent security warning banner** above the prose.
  - **`Read` Mode:** Renders a **safe, sanitized Markdown AST** (no raw HTML execution, no `dangerouslySetInnerHTML` XSS vectors) with genuine book typography:
    - `# Chapter Title` → optical `Literata` display chapter heading with generous top air
    - `*italics*`, `**bold**`, `> epigraph/letter blockquotes`, `---` ornamental literary scene breaks (`*  *  *`), footnotes/lists
    - Exact raw Markdown source remains **100% untouched** underneath; switching back to `Edit` restores scroll position cleanly.
- **Long-Form Navigation (`40+ Chapters`):**
  - Collapsible hierarchical **Chapter → Scene Tree** in the left rail (with chapter word totals, subtle scene status/issue indicators, drag-or-button reorder, instant filter, and `Jump to chapter` via `Cmd+K`).
  - **Distraction-Free Focus Mode (`Cmd+Shift+F`):** Collapses all rails and top chrome to a single `68ch` warm paper sheet; hovering top edge reveals `Exit Focus`, `Edit/Read`, and `Saved` status.
- **Optional Lightweight `Scene Margin` (`OD-01`):**
  - Closed by default in `Calm` mode; one toggle opens a quiet right margin displaying **locally derived, zero-AI-cost** context for the active scene: cast mentioned in this scene, their recorded beliefs, linked open threads, active 🔒 Protected Locks, and one-click handoffs (`Ask Story`, `Explore in Studio`, `Strengthen Scene`).

---

## 4. Creative Studio, Voluntary Grill Me & Alternative Comparison Experience

### 4.1 Creative Studio (Full-Canvas Iterative Workbench)

- **Left Sessions & Collection Rail (`240px`, collapsible):**
  - **Active & Saved Exploration Sessions** (retained by default per `OD-05`, auto-saved with scope badge, timestamp, and manual recoverable archive/delete).
  - **Creative Collection (`IR-03`):** Private searchable Idea Library across all sessions with tags and cross-session combine.
  - **Visuals / Concept Art (`OD-07`):** Secondary image generation housed calmly here rather than in a global bottom bar.
- **Main Studio Canvas:**
  - **Top Scope & Controls Bar:** Explicit `Scope` chip (`Whole Story`, `Act II`, `Leyla + Logbook`), `Creative Intensity` selector (`Subtle | Balanced | Bold | Radical` — explicitly labeled *"Controls creative boldness, not AI reasoning effort"*), and `Creative Compass / DNA` toggle (`Follow / Challenge / Blend`).
  - **Dual Custom Prompt Action Bar (`PRODUCT-BLUEPRINT.md §3`):** One clean author input box with **two independent explicit actions**:
    - **`Suggest Directions`** *(generates broad thematic angles only)*
    - **`Generate Concrete Idea`** *(generates a specific playable story move)*
  - **Two-Tier Idea Workspace:**
    - Row 1: **Directions** (selectable chips/cards + **`Suggest More Directions`** appending distinct angles without clearing selections).
    - Row 2: **Concrete Idea Cards** (tinted `--surface-draft`, multi-selectable via checkboxes per `GS-04`) with uncluttered primary actions (`Refine preserving essence`, `Regenerate this card` preserving prior version in a `v1 / v2` pill, `Edit idea`, `Save to Collection`) and overflow (`Challenge this idea`, `Explain differently`, `Surprise me`, `Dismiss`).
    - **Multi-Select Action Bar (appears when >=2 cards selected):** `Combine Selected`, `Compare Side-by-Side`, `Save Selected`, `Dismiss Selected`, `Preview Concrete Patch` (no direct batch canon mutation!).

### 4.2 Voluntary `Grill Me` (Question-Led Exploration)

- Accessible from `Home → Start from Premise` OR from any scope/card in `Creative Studio`.
- **Behavioral Mode Switcher:** `Inspire` | `Explore` | `Grill` | `Challenge` (plain 1-line description under each).
- **Split Layout (Desktop):**
  - **Left (`60%`):** Current focused adaptive question + **Why this matters** (1-line rationale) + clickable suggested angles + freeform **Custom Answer** box + **`Skip / Leave as Open Mystery`** + **`Backtrack`** to previous branch + persistent **`Stop & Preview Concept`** button always visible.
  - **Right (`40%`, optional):** **Live Draft Concept Sketch** — a gently tinted, explicitly **`NON-CANONICAL DRAFT`** mini-graph/outline that grows visually as the author answers questions, letting them see cast & mysteries take shape before committing a single fact to canon.

### 4.3 Side-by-Side Alternative Comparison & Safe Forking

- Uses the universal **Dual-Pane Comparison Sheet**:
  - Left pane: `Current Project ("Izmir Lighthouse")` | Right pane: `Proposed Branch / Saved Alternative ("Gazette Ending")`.
  - Shows structural delta summary (*Word delta, changed scenes, changed character fates, resolved vs. open threads*) + side-by-side prose/map diff.
  - Explicit Commit Footer:
    - **`Save as Independent Alternative…`** (creates independent copy with remapped IDs & separate history; **`Keep working in "Izmir Lighthouse"`** checked by default — zero surprise project switching!)
    - Explicit secondary button after save: `Open Alternative ->`.

---

## 5. Project Overview, Operation Center, Context Inspector & Redesigned AI Settings

### 5.1 Project Overview & Resume My Work (`GS-05`, `IR-05`, `OD-02`)

Replaces landing blindly on a raw screen with `Saved · r1` (`J-10`):
- **Top Resume Card (`Resume My Work` — zero AI calls on open):** Exact last edited scene + word count + cursor/scroll preview (`Ch. 4 — Sealed Manifest · 1,420 words · edited 2 days ago · [Continue Writing ->]`), plus active unfinished Studio session or open Grill Me branch if present.
- **Honest Project Snapshot Strip (Real Counts Only — Zero Fake Completion Scores):** `14 scenes · 18,420 words` | `24 cast & entities` | `3 open continuity checks` | `2 saved exploration sessions` | `1 independent alternative` | `Last verified backup: Nov 27`.
- **Contextual Recovery Assistant (`GS-07`):** Surfaces only when relevant (or via `Recovery & Backups` tab): distinguishes **Recovered Unsaved Local Draft**, **Storage Revision Conflict**, and **Narrative Sync Drift**, lets the author compare before acting, and defaults backup restores to **Restore as Copy** (never silently overwriting the active project).

### 5.2 Unified Operation Center (`IR-01`, `GS-08`, `WP01 M6`)

- Top-right quiet pill (`Idle` = hidden or subtle dot; `Active` = `"Analyzing Import · 5/12"` with spinner or elapsed timer).
- Clicking opens a compact drawer listing explicitly initiated operations bound to `(Project, Scope, Revision)`:
  - **Measured units ONLY when real units exist** (`5 / 12 segments analyzed`); otherwise **indeterminate indicator + elapsed time** (`Running · 14s` — zero fake percentages or invented ETAs).
  - Explicit **`Cancel`** (distinguishing `Cancel requested…` vs. `Cancelled`), **`View Partial Results`**, and **`Retry`** (explicit user click only).
  - If a background operation finishes after the author switched projects or edited the story, it is clearly tagged **`Completed for earlier version — Review before applying`** and NEVER mutates the active project.

### 5.3 Pre-Run Context Inspector (`IR-02`)

- Accessible via a crisp `Inspect Scope & Context (4 scenes, 2 locks)` disclosure right beside any AI action button.
- Shows transparently: **Included sections/entities**, **Omitted sections** (with honest reason: *"Excluded by scene scope"* or *"Exceeds budget — switch to segmented full scan"*), **Active 🔒 Locks**, **Retrieval mode** (`Local lexical` vs. `Hybrid + Local Qwen`), **Exact source revision**, and **Provider / estimated tokens**. Allows 1-click manual inclusion/exclusion override before sending.

### 5.4 Redesigned 5-Tab AI Settings & Optional Embeddings Console (`§6`, `§7`, `GS-01`, `GS-02`, `WP01 M5`)

Replaces today's long vertical stack + manual two-button refresh (`AiConnectionsPanel.tsx`, `UX-15`) and integrates seamlessly with `WP01 M5` + `WP02`:

1. **Compact Header Provider Popover (`GS-01`):** Top-right status pill shows actual selected connection & model (e.g., `Gemini · Ready` or `Offline — Local Mode`), expanding into a quick popover showing per-operation readiness (*Story*, *Import*, *Diagnostics*, *Studio*, *Embeddings*) with honest unavailable reasons (zero hardcoded *"Luna restricted"* copy) and a direct `Open AI Settings` button.
2. **Five Clean Settings Sections (Sidebar on Desktop, Horizontal Tabs on Mobile):**
   - **Tab 1 — `Overview & Connections`:** Compact connection cards separating **Managed Gemini**, **Personal Gemini**, **ChatGPT Account**, **OpenAI API**, and **Independent Embedding Providers**.
     - **Seamless OAuth Lifecycle (`§7`, `WP01 M5`):** Clicking `Connect` transitions visibly through **`Waiting for authorization…`** → **`Connected · Loading model catalog…`** → **`Ready (N models)`** (or **`Catalog unavailable · [Retry Catalog]`**) automatically upon verified server callback — **permanently retiring the manual `Refresh connections` → `Refresh models` two-step dance**. Key-based connections provide explicit **`Save & Verify Catalog`** with clear disclosure that verification checks metadata only (no text inference).
   - **Tab 2 — `Models & Defaults`:** Clean model picker per provider with reasoning tier selector (explicitly separate from Creative Intensity) and explicit `Use as Default` (never silently substituting a paid provider if a prior default is unavailable).
   - **Tab 3 — `Operation Overrides` (Advanced):** Clear table mapping each narrative operation (`Story Writing`, `Import Extraction`, `Continuity Diagnostics`, `Creative Studio`, `Story Development`, `Image / Visuals`) to its assigned model, dynamic capability eligibility reason, and override toggle.
   - **Tab 4 — `Embeddings & Search` (`§6`):**
     - **Always-On Baseline Card:** `Local Structured & Lexical Index — Active (Offline, 0 AI calls, Turkish & Unicode aware)` with index coverage & `Rebuild Local Index`.
     - **Optional Semantic Retrieval Cards (All `Off` by default, independently configurable):**
       1. *Local Runtime (`Qwen3-Embedding-0.6B` / configurable local compatible endpoint)* — explicit loopback/endpoint config + synthetic connection test; gracefully shows `Unavailable on hosted preview` when no local bridge exists.
       2. *Gemini Embedding 2* — independent consent & entitlement check.
       3. *Cloudflare Workers AI* — independent server-side scoped credentials & Neurons usage disclosure.
     - Explicit **Per-Project Cloud Transmission Consent** toggle, isolated namespace status (*"3,420 chunks indexed · Local Qwen v1 · 1024d"*), explicit bounded **`Build / Refresh Index`** with progress/cancel, and clean `Not yet active — WP02` honesty during `WP01` (zero fake toggles!).
   - **Tab 5 — `Usage & Limits`:** Honest separation of *Estimated pre-flight cost*, *Observed session usage*, and *Provider quota (unknown unless reported)*, plus editable per-session call/token caps and pause switch.

---

## 6. Cross-References & Checkpoint Status

- **Completed in this file:** Complete visual semantics for Story Map (80+ entity scaling), Dual-Track Timeline, Knowledge Matrix & Belief-Clash cues, Threads/Tension, Deterministic Patch Change Map vs. Uncertain Impact Analysis, Formatted Markdown Editor/Reader, Creative Studio / Grill Me / Alternative Comparison, Project Overview, Operation Center, Context Inspector, and 5-Tab AI Settings + Embeddings Console.
- **Next documents (Batch 4 — Final Synthesis):** [07 — New Opportunities and Prioritized UI Roadmap](./07-new-opportunities-and-prioritized-ui-roadmap.md), [08 — Six-Cycle Review and Coverage](./08-six-cycle-review-and-coverage.md), and [README.md](./README.md).
