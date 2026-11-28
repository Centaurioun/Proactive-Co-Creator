# 02 — Author Journeys and Task Models

**Assignment:** `PCC-UI-RESEARCH-01` — Independent UX, Information Architecture & Visual Design Discovery  
**Status:** Complete (Cycle 2 Journey Trace & Cycle 3/5 Flow Redesign)  
**Scope:** End-to-end walkthroughs of all **9 core author journeys** specified in `RESEARCH-ASSIGNMENT.md §5`, plus **3 critical missing journeys** discovered from the capability brief and current codebase (`J-10` Return & Resume After Days Away, `J-11` Multilingual / Non-Linear Manuscript Drafting & Chronology Work, and `J-12` Mid-Session AI Failure, Quota Pause & Graceful Offline Continuity).

> **Methodological Note:** Step counts below are **directly traced from the current codebase (`Confirmed in source`) and live preview (`Observed in preview`)** versus proposed target workflows (`Proposal`). No invented usability percentages, completion rates, or fake user-test scores are used.

---

## 1. Journey Summary Matrix (Current Friction vs. Redesigned Flow)

| ID | Author Journey | Current Entry Point(s) | Current Traced Meaningful Steps / Mode Jumps | Target Meaningful Steps / Mode Jumps (`Proposal`) | Primary Friction Eliminated |
|---|---|---|---|---|---|
| **J-01** | First launch → premise → exploratory questions → story concept → manuscript | `Header (+ New)` → `Write` or `Plan` | ~11 steps, 3 workspace switches (no guided question-led flow yet) | 4 steps, 1 continuous flow | Eliminates cold empty-editor drop and disconnected Plan/Write start |
| **J-02** | Open/import existing narrative → inspect → explore structure → edit → analyze | `Header/Nav/Projects → Import` | ~10 steps across 5 stacked scroll blocks + 2 workspace switches | 5 steps with sticky progress & instant split inspect | Eliminates vertical wall fatigue and unclear post-commit landing |
| **J-03** | Write or revise passage with contextual AI help & review result | `Write` (currently must leave to `Plan` / `BottomBar` & adopt back) | ~9 steps, 2 workspace switches, dirty-draft lock | 3 steps, **0 workspace switches** | Brings scoped AI partner directly to cursor/selection without auto-replacing prose |
| **J-04** | Discover & develop an idea across iterations → save → leave → resume | `Plan → Opportunities` (or `Ideas` tab) | ~8 steps inside `398px` rail; no persistent multi-turn session workspace yet | 4 steps inside dedicated Studio canvas with auto-saved sessions | Frees creative exploration from narrow inspector; preserves iterative history |
| **J-05** | Investigate character/event/relationship via visuals & author questions | `Plan → Graph` + `Inspector` + `Timeline` | ~7 steps across 4 micro-controls; `UX-01` dead-button trap; no Story Q&A yet | 3 steps in unified World & Story Views + Story Q&A | Fixes dead buttons, tiny `28%` canvas, and fragmented views |
| **J-06** | Strengthen scene/chapter while preserving intentional elements | Currently ad-hoc manual editing + `Story Bible` rules | ~8 steps across 2–3 panels (no explicit element locks or develop controls yet) | 4 steps with inline Protect/Lock chips + before/after diff | Separates faithful strengthening from wild brainstorming; makes locks visible |
| **J-07** | Review continuity issue → inspect evidence → compare fixes → apply/decline → undo | `Review` + `Plan → Checks` + `History` | ~9 steps across 2 workspaces + modal | 4 steps inside integrated Review workbench with split evidence jump | Keeps evidence, fix comparison, apply, and 1-click undo in one continuous loop |
| **J-08** | Compare & save an alternative → continue original project | Not yet surfaced cleanly (`ProjectHub` export/duplicate workaround) | ~7 manual workaround steps (high risk of losing active context) | 3 steps with explicit *"Save as Alternative (stay in current story)"* | Zero unintended project switching; clear lineage badge |
| **J-09** | Configure AI, check models/operations, optional search/backup, recover from failure | `AI settings` modal + `Projects → Backup & export` | ~10 steps across modal + `Projects` + manual dual-refresh | 4 steps in unified Settings/Recovery hub with inline quick-jump from errors | Eliminates manual two-button refresh and dead-end error copy |
| **J-10** | *(Discovered)* Return & resume after days away | Lands blindly on last tab (`Write` or `Plan`) with `Saved · r{n}` | ~6 orientation steps across `Projects`, `Write`, `Plan`, `Review` | 1–2 steps via **Project Overview / Resume Strip** | Restores mental context (last scene, open questions, unfinished sessions, recent changes) |
| **J-11** | *(Discovered)* Multilingual (e.g. Turkish) & non-linear flashback drafting | `Write` + `Plan → Timeline` | Chronology breaks on alphabetical sort & English-only regex (`UX-06`) | 3 steps with explicit narrative vs. story-time tracks & language-neutral tags | Removes silent English-only regex failure and naive alphabetical sorting |
| **J-12** | *(Discovered)* Mid-session AI error, budget limit, or offline recovery | Raw inline red error text; dirty draft blocks nav (`UX-09`) | High anxiety: author unsure if draft or partial work survived | 2 steps via persistent Operation Center + auto-stashed local drafts | Makes local-first safety, partial results, and retry/offline continuation unmistakable |

---

## 2. Detailed End-to-End Author Journeys

### J-01: First Launch → New Premise → Exploratory Questions → Story Concept → Manuscript Creation

- **Author Persona & Intent:** First-time author arriving with a 2-sentence spark (*"A retired lighthouse keeper in Izmir discovers sealed maritime letters from 1954 that contradict her father's death certificate."*). Wants PCC to help deepen the premise through gentle questions, shape a cast and concept, and open into a ready-to-write Chapter 1 without drowning in graph mechanics.
- **Current Traced Experience (`Observed in preview` + `Confirmed in source`):**
  1. App opens directly onto the preloaded sample project (`Write` or `Plan`), with 10+ header/nav buttons visible (`Header.tsx`, `App.tsx`).
  2. Author must spot `+ New` (hidden on `<640px` mobile header, `UX-05`) and click it to open `CreateProjectDialog`.
  3. Dialog asks for a project name and initial prompt, then drops the author into a blank workspace.
  4. To turn the premise into entities/graph, author must switch to `Plan`, find `PromptInput` (collapsed in `<details>` below `xl`), type or re-submit, review pending items in `DecisionInboxPanel` (hidden by default via `showInbox = false`, `AdaptivePlanWorkspace.tsx:78`), inspect results in a `28%`-area graph, trigger `Generate Story` in `WorkspaceBottomBar`, then switch back to `Write` and open `AdoptArtifactDialog` to turn generated text into a scene.
  5. **Missing capability today:** There is no optional adaptive AI interview / question-led concept discovery flow yet (`Confirmed in source`).
- **Redesigned Target Flow (`Proposal`):**
  1. **Calm Start / Project Home:** Clean choice of *Start from a premise*, *Start with a blank manuscript*, *Import existing story*, or *Explore sample project*.
  2. **Premise + Optional Guided Interview:** Author types the 2-sentence premise and optionally clicks **Explore with Questions** (choosing a questioning style such as *Character-driven*, *Mystery & tension*, or *World & rules*). Author answers 2–5 short questions (can type custom answers, mark *"Keep as an open mystery"*, or click **Stop & Preview Concept** at any point).
  3. **Live Concept Preview Sheet:** Shows proposed cast, setting, central tension, and opening scene seeds — clearly marked **Proposed (not yet canon)** with 1-click toggles to keep, edit, or leave unanswered.
  4. **Enter Manuscript:** Clicking **Create Story** lands in `Write` with Chapter 1 ready, the Story Outline populated, and accepted elements quietly anchored in the World model (never forcing the author into a dense graph on minute one).
- **Success Criteria:** First-time author moves from premise to writing Chapter 1 in under 4 meaningful decisions without needing to understand "Belief Graph", "Revision #1", or "Decision Inbox" terminology.

---

### J-02: Open or Import an Existing Narrative → Inspect Source → Explore Structure → Edit → Analyze

- **Author Persona & Intent:** Returning novelist with an existing 18,000-word `.docx` or `.md` draft. Wants to bring the manuscript into PCC faithfully (without AI altering a single comma), optionally extract characters/relationships, inspect where they appear in the source, edit Chapter 3, and run a continuity check.
- **Current Traced Experience (`Confirmed in source`: `ImportWorkflow.tsx`):**
  1. Author clicks `Import` (3 duplicate entry points: Header, Nav, Projects).
  2. Drops file or pastes text → must explicitly click `Inspect source` (`SourcePreviewSection`) before options appear.
  3. If `.docx` retention warning triggers (`parsedHasFileRetentionGap`), author must check a separate confirmation checkbox before `Analyze source` unlocks (`ImportWorkflow.tsx:125`).
  4. `AnalysisConfigSection` and `CandidateReviewSection` stack sequentially down a very long page despite the 5-step pill bar at the top (`ImportWorkflow.tsx:788-935`).
  5. After reviewing candidates and committing, author lands in the project with no immediate side-by-side bridge showing *"Source Passage ↔ Extracted Character"* or an obvious *"Next: Review 3 ambiguities or start writing"* prompt.
- **Redesigned Target Flow (`Proposal`):**
  1. **Guided Staged Drawer / Full-Canvas Import (`1. Source` → `2. Analysis Plan` → `3. Review Extractions` → `4. Destination`):** Each step occupies a clean focused stage with a **sticky bottom bar** showing source fidelity badge (`Exact text preserved`), progress/budget disclosure, and primary action (`Import Text Only` always available as an equal first-class path alongside `Analyze & Extract`).
  2. **Split Source-to-Extraction Verification:** In Step 3, clicking any extracted character, relationship, or ambiguity highlights the **exact quoted span** in a docked right-hand source preview pane — making faithful provenance immediately tangible.
  3. **Post-Commit Orientation Card:** Upon commit, lands in `Project Overview` (or directly in `Write`) with a dismissible summary: *"Imported 6 chapters (18,420 words), 14 characters, 2 open ambiguities — Jump to Write / Open World Map / Run Continuity Check."*
- **Success Criteria:** Author can import text-only in 2 clicks or complete verified extraction with exact source highlighting without scrolling past 4 inactive form sections.

---

### J-03: Write or Revise a Passage Using Contextual AI Assistance & Review Its Result

- **Author Persona & Intent:** Author is drafting Scene 4 in `Write`, selects a stiff 120-word dialogue exchange, and wants AI help to sharpen the subtext while preserving the character's dry humor and never overwriting the selected paragraph without approval.
- **Current Traced Experience (`Confirmed in source`: `ManuscriptEditor.tsx`, `WorkspaceBottomBar.tsx`):**
  1. `ManuscriptEditor` currently has **zero contextual AI assistance** at the cursor or selection (`Confirmed in source`).
  2. To get AI prose, author must save/clear dirty state (due to `allowNavigation` lock in `App.tsx:175-185`), switch to `Plan`, edit `PromptInput`, run `Generate Story` in `WorkspaceBottomBar`, inspect output in `OutputGallery`, switch back to `Write`, and run `AdoptArtifactDialog`.
  3. Additionally, clicking `Preview section` shows raw `<pre>` Markdown (`UX-03`).
- **Redesigned Target Flow (`Proposal`):**
  1. **Selection / Cursor Action Strip (Non-Intrusive):** Selecting prose in `Write` reveals a calm contextual action bar (or `Cmd/Ctrl+J` shortcut): *Deepen subtext*, *Continue from cursor*, *Tighten / compress*, *Explore alternatives*, or *Custom instruction…* — showing an explicit **Scope pill** (`Selected 120 words + Scene 4 context`) and **Protected elements** (`Keep dry humor; keep secret unrevealed`).
  2. **Side-Margin / Inline Diff Proposal Sheet:** AI output streams or resolves into a **clearly tinted Draft Proposal card** adjacent to the selection — never mutating the manuscript text directly. Author sees exact **Before / After diff**, can **Refine preserving core idea**, **Try another angle**, **Edit proposal directly**, **Save as Alternative**, or **Apply to Manuscript** (which records an atomic undoable checkpoint).
  3. **Instant Reading Preview:** Toggling `Read` renders true formatted Markdown typography (`Literata` headings, italics, blockquotes, scene breaks) while preserving exact raw source underneath.
- **Success Criteria:** Zero workspace switches; zero unapproved prose overwrites; 1-click undo immediately after application.

---

### J-04: Discover and Develop an Idea Through Multiple Iterations → Save → Leave → Resume

- **Author Persona & Intent:** Author feels Act II sags and wants to brainstorm 3 surprising foreshadowing twists, reject one, refine the second along a custom direction (*"make the harbor master complicit without knowing it"*), combine a detail from the third, save the session, close the browser, and pick up cleanly the next morning.
- **Current Traced Experience (`Confirmed in source`: `OpportunityCenter.tsx`, `ContextualInspector.tsx`):**
  1. Author navigates to `Plan` → clicks `Opportunities` (fails silently if `Context` rail was closed, `UX-01`) → panel opens inside a `398px`-wide rail labeled `Ideas` (`UX-11`).
  2. `AiOpportunityExplorer` generates a flat list; there is no per-item regeneration, direction-vs-concrete-idea separation, combine flow, or persistent multi-session exploration history yet (`Confirmed in source`).
  3. Leaving the panel or switching projects gives no visible "Saved Exploration Session" shelf to resume later.
- **Redesigned Target Flow (`Proposal`):**
  1. **Dedicated Creative Studio Surface (Full Width, Not a `398px` Rail):** Author opens **Studio** (or invokes **Explore Ideas** from any scene/character). Chooses creative intensity (*Gentle nudge* / *Balanced* / *Bold leap*) and scope (*Act II*, *Harbor Master*, or *Whole Story*).
  2. **Two-Tier Idea Cards (Directions vs. Concrete Ideas):** PCC separates broad **Exploratory Directions** (*"Hidden Complicity"*, *"False Witness"*, *"Missing Manifest"*) from **Concrete Story Ideas** under each direction.
  3. **Iterative Card Controls:** On any card, author can: `Refine (keep core idea)`, `Regenerate just this item`, `Edit directly`, `Branch a new direction`, `Combine selected (multi-select)`, `Bookmark / Save`, or `Dismiss`.
  4. **Auto-Saved Persistent Sessions:** Every exploration stream is automatically titled and saved in the **Sessions Shelf** (e.g., *"Act II Harbor Master Twists · 3 saved ideas · Updated 18m ago"*). Leaving to write and returning tomorrow reopens the exact cards, starred picks, and history intact — still cleanly distinct from applied story canon.
- **Success Criteria:** Iterative brainstorming feels spacious and editorial; saved ideas never silently mutate canon; returning tomorrow restores exact session state in 1 click.

---

### J-05: Investigate a Character, Event, or Relationship Through Narrative Visualizations & Author Questions

- **Author Persona & Intent:** Mid-novel, the author cannot remember whether *Leyla* knows that *Captain Arif* forged the 1954 logbook, or which scenes establish Arif's relationship with the port authority.
- **Current Traced Experience (`Confirmed in source` + `Observed in preview`):**
  1. Author opens `Plan`. Graph canvas occupies only `978×371px` (`28%` of viewport, `UX-02`).
  2. Author searches `"Leyla"` in `GraphToolbar` OR in the duplicate `Navigate entities and relationships` disclosure in the right rail (`AdaptivePlanWorkspace.tsx:212`).
  3. Switching to `Ego Map`, `Table`, or `Family` helps inspect direct links, while `Timeline` sits buried under `More views` (broken if `Context` is hidden, `UX-01`) and `Mind map` is just a static card grid (`UX-12`).
  4. Character knowledge vs. established fact (`belief` vs. `canon`) is barely legible (`10px` text in list, static text strip at top). No source-grounded *"Ask about my story"* Q&A exists yet (`Confirmed in source`).
- **Redesigned Target Flow (`Proposal`):**
  1. **Focused Entity Investigation (World View):** Author presses `Cmd/Ctrl+K` (or searches in World) and selects `Leyla`. The canvas centers on Leyla's **Ego Lens** with generous space (`>=65%` viewport area), visually distinguishing **Confirmed Fact** (solid edge/badge) from **Character Belief** (dashed edge + `"Leyla believes…"` tag) and **Reported / Rumor** (dotted edge).
  2. **Source-Grounded Story Q&A Drawer:** Author asks: *"Does Leyla know Arif forged the logbook as of Chapter 6?"* PCC retrieves relevant scenes/claims locally and replies with **inline source citations** (`Ch. 2 §3`, `Ch. 5 §1`), explicitly stating *"No established evidence that Leyla knows; in Ch. 5 §1 she suspects the harbor clerk instead (Character Belief)."* Clicking `Ch. 5 §1` opens the exact passage.
  3. **View Switcher Matched to Question:** One clean top bar lets the author switch between **Relationship Map**, **Knowledge Matrix (Who Knows What)**, **Dual-Track Timeline (Reading Order vs. Story Time)**, **Threads**, and **Accessible Table** — preserving `Leyla` as the active filter across all views.
- **Success Criteria:** Author answers a complex narrative continuity/epistemic question with verbatim manuscript evidence in <=3 actions without losing selection across views.

---

### J-06: Strengthen a Scene or Chapter While Preserving Intentional Story Elements

- **Author Persona & Intent:** Author wants to deepen sensory tension and pacing in Chapter 4, **without** changing the ending reveal, the 1954 letter's exact wording, or Leyla's reserved voice.
- **Current Traced Experience (`Confirmed in source`):**
  1. No dedicated **Story Development** workflow or explicit **Protect / Lock** constraint UI exists today.
  2. Closest workaround is manually adding text to `Story Bible → Continuity rules` or `Explicit exclusions` inside the narrow right rail in `Plan`, then switching to `Write` and revising manually.
- **Redesigned Target Flow (`Proposal`):**
  1. **Explicit Development Mode (Distinct from Creative Discovery):** From Chapter 4 in `Write` (or **Develop** room), author selects **Strengthen Scene** and picks specific editorial focuses (`Pacing`, `Dialogue & subtext`, `Character depth`, `Compression / tighten`, `Preserve author voice`).
  2. **Visible Protection & Constraints Bar:** Before running, author pins concrete **Protected Elements** directly from the scene or Story Bible:
     - 🔒 *Structural Lock:* `"Ending reveal of the torn manifest"`
     - 🔒 *Exact Quote Lock:* `"1954 letter verbatim paragraph"`
     - 🧭 *Semantic Guidance:* `"Keep Leyla understated; avoid melodrama"`
  3. **Targeted Editorial Proposals + Exact Diff:** PCC proposes focused revisions mapped against each protected constraint (explicitly confirming which locks were honored). Author previews exact word-level diff, edits any sentence, applies selectively, or saves the bolder version as an Alternative.
- **Success Criteria:** Author clearly feels the boundary between *strengthening an existing story faithfully* vs. *inventing new creative twists*, with every lock visibly honored.

---

### J-07: Review a Continuity Issue → Examine Evidence → Compare Fixes → Apply or Decline → Undo

- **Author Persona & Intent:** Diagnostics flags a contradiction: Chapter 2 says the lighthouse lens was shattered in 1961, while Chapter 7 shows Leyla polishing the original 1954 brass lens.
- **Current Traced Experience (`Confirmed in source`: `NarrativeReview.tsx`, `DiagnosticsSection`, `ContextualInspector.tsx`):**
  1. Local consistency warnings appear in `Plan → Checks`, while full scoped diagnostics, fix alternatives, and sync live in `Review` — splitting the author's mental model.
  2. Inside `Review`, all 4 major subsystems stack vertically (`Diagnostics`, `Sync`, `Auto-Analysis Settings`, `Evidence & Audit`).
  3. Clicking a target navigates away to `Write` or `Plan`, losing side-by-side visibility of the issue and its fix alternatives unless resumed via `PendingProposalReview`.
  4. Undoing an applied fix requires jumping to `Revision History` (which currently teleports back to `Plan → History` or `Projects`).
- **Redesigned Target Flow (`Proposal`):**
  1. **Split Issue Workbench in `Review`:** Left list shows prioritized issues with clear category badges (`Continuity`, `Chronology`, `Character Knowledge`, `Sync Drift`) and readiness reminders visually separated. Selecting an issue opens a **Split Detail View**:
     - **Top / Left:** Side-by-side **Evidence Excerpts** (`Ch. 2 §2` vs. `Ch. 7 §4`) with one-click *"Open in Write"*.
     - **Right:** **Fix Alternatives** (e.g., *Fix A: Change Ch. 7 to replica lens*, *Fix B: Revise Ch. 2 date*, *Option C: Mark as intentional unreliable memory with reason*).
  2. **Exact Before / After & Graph Impact Preview:** Selecting *Fix A* renders exact prose diff **plus** a separated **Change Preview**: *Confirmed Patch Changes* (Ch. 7 text + Object attribute) clearly distinct from *Possible Downstream Impacts (Uncertain — check Ch. 9)*.
  3. **Explicit Apply + Immediate Inline Undo:** Clicking **Apply Fix A** commits atomically and shows a calm persistent confirmation strip: *"Applied Fix A to Ch. 7 · [Undo] · [View in History]"* — no hunting across 3 screens to revert.
- **Success Criteria:** Issue triage, evidence inspection, fix comparison, explicit application, and immediate undo happen in one cohesive screen with zero silent edits.

---

### J-08: Compare and Save an Alternative → Continue the Original Project

- **Author Persona & Intent:** Author is torn between two endings: *Ending A (Leyla burns the 1954 letters)* vs. *Ending B (Leyla publishes them in the harbor gazette)*. Wants to save Ending B as an independent alternative project to explore later, **without** losing her place in the original draft.
- **Current Traced Experience (`Confirmed in source`):**
  1. No dedicated "Save as Alternative without switching" flow exists (`ProjectHub` supports project export/import/create, but creating/opening a copy switches context or requires manual JSON round-trip).
- **Redesigned Target Flow (`Proposal`):**
  1. **Side-by-Side Alternative Comparison Sheet:** From Studio, Develop, or Review, author compares *Current Canon (Ending A)* on the left against *Proposed Branch (Ending B)* on the right — highlighting structural differences (cast fate, unresolved threads, chapter delta).
  2. **Non-Disruptive Fork Action:** Author clicks **Save as Independent Alternative…**, names it *"Izmir Lighthouse — Gazette Ending"*, and sees the explicit checkbox (checked by default): **`Stay in current project ("Izmir Lighthouse")`**.
  3. **Calm Confirmation & Lineage Link:** Confirmation toast shows *"Saved alternative 'Izmir Lighthouse — Gazette Ending' (independent copy). You are still editing 'Izmir Lighthouse'."* Both projects show a quiet `Alternatives (1)` pill in `Project Overview` for future side-by-side reopening.
- **Success Criteria:** Zero surprise context switches; crystal-clear guarantee that editing the alternative will never silently alter the original project.

---

### J-09: Configure AI → Understand Available Models & Operations → Optional Search & Backup → Recover After Failure

- **Author Persona & Intent:** Author wants to connect a local Ollama model for private manuscript extraction, use a frontier cloud model for creative brainstorming, see which operations are ready vs. unavailable, enable local embeddings + optional backups, and recover cleanly if a long extraction fails halfway.
- **Current Traced Experience (`Confirmed in source`: `AiConnectionsPanel.tsx`, `ProjectHub.tsx`, `NarrativeReview.tsx`):**
  1. AI configuration lives in one long scrolling modal (`AiSettingsModal`) requiring manual `Refresh connections` and manual `Refresh models` clicks (`AiConnectionsPanel.tsx:139`).
  2. Backup & recovery live in a completely separate workspace (`Projects → Backup & export`).
  3. Error messages in `Review` / `Import` mention `AI Settings` in plain text without an actionable button (`UX-15`).
  4. Optional retrieval/embedding configuration, usage/budgets, and cloud backup consent have no unified home yet.
- **Redesigned Target Flow (`Proposal`):**
  1. **Organized 4-Tab Settings & Safety Console (`Connections & Models` | `Operations Matrix` | `Search & Retrieval` | `Storage, Backup & Privacy`):**
     - **Connections & Models:** Auto-discovers available models on open with explicit provider status, reasoning tier controls, and honest privacy badges (`Local only` vs. `Sends selected scope to provider`).
     - **Operations Matrix:** Clear writer-readable table mapping each job (*Import Extraction*, *Creative Studio*, *Story Development*, *Continuity Review*, *Image Generation*) to its assigned model, availability state (`Ready`, `Needs provider`, `Paused by budget`), and cost/budget cap.
     - **Search & Retrieval:** Explicit toggle between *Structured + Lexical Local Search (default, zero AI)* and *Optional Local / Remote Embeddings* with coverage index bar and consent notice.
     - **Storage, Backup & Privacy:** Local IndexedDB health, scheduled local archive downloads, optional opt-in cloud backup with explicit consent, and 1-click recovery restore.
  2. **Contextual Deep-Link From Any Error:** Every *"No AI provider configured"* banner includes a direct **`Open AI Settings →`** button that lands directly on the relevant tab and returns the author to their exact task when closed.
- **Success Criteria:** Author understands in 10 seconds what works offline, what uses AI, which model runs which operation, and how to back up or recover without guesswork.

---

### J-10 *(Discovered Missing Journey)*: Return & Resume After Days Away

- **Author Persona & Intent:** Author returns to a 14-chapter novel after 6 days away. Cannot remember which scene she was editing, which creative exploration session had the good twist, or whether any continuity issues were left open.
- **Current Traced Experience (`Observed in preview` + `Confirmed in source`):**
  - App reopens directly onto the raw editor or graph with only `Saved · r12` in the header (`Header.tsx:77-79`). No resume brief, recent activity trail, open exploration sessions, or narrative readiness snapshot exists.
- **Redesigned Target Flow (`Proposal`):**
  - **Project Overview (or Dismissible Resume Strip):** Shows (1) **Continue Writing** card (`Ch. 8 — The Foghorn · 1,420 words · edited 6 days ago`), (2) **Resume Open Exploration** (`2 saved sessions`), (3) **Open Review Items** (`3 continuity questions awaiting decision`), and (4) **Recent Milestones** (human-readable labels like *"Revised Ch. 7 dialogue"*, never raw `r12`).
- **Success Criteria:** Returning author recovers full creative context in <=10 seconds and resumes work in 1 click.

---

### J-11 *(Discovered Missing Journey)*: Multilingual (e.g., Turkish) & Non-Linear Flashback Drafting

- **Author Persona & Intent:** Author writes a literary novel in Turkish with interleaved 1954 flashbacks (`"1954 Kışı — Geri Dönüş"`) and 1982 present-day scenes (`"1982 Yazı"`), using Turkish IME/diacritics (`ğ, ş, ı, İ, ö, ü, ç`).
- **Current Traced Experience (`Confirmed in source`: `TimelinePanel.tsx:28-35`, `ManuscriptEditor.tsx:328-338`):**
  - **Good:** `ManuscriptEditor` protects IME composition cleanly.
  - **Broken:** `TimelinePanel` sorts chronology strings alphabetically (`"1954"` works by coincidence, but `"Ertesi sabah"`, `"Üç yıl önce"`, `"10. Gün"` vs. `"2. Gün"` scramble) and fails to detect Turkish flashback/uncertainty phrasing because regexes are English-only (`UX-06`).
- **Redesigned Target Flow (`Proposal`):**
  - **Explicit Language-Neutral Chronology Controls:** Each scene offers an optional structured **Story-Time Position** (relative sequence or author era label) + explicit checkboxes/chips for `Flashback / Non-linear` and `Time uncertain` (never relying solely on English regex guessing), rendered on a **Dual-Track Timeline** comparing *Reading Order (Ch. 1→12)* against *Story Chronology (1954→1982)* with explicit `Undated / Uncertain` staging lane.
- **Success Criteria:** Non-linear multilingual narratives display truthful reading vs. story-time tracks without invented dates or English-keyword assumptions.

---

### J-12 *(Discovered Missing Journey)*: Mid-Session AI Failure, Budget Pause, or Unsaved Draft Recovery

- **Author Persona & Intent:** Halfway through analyzing a 12-segment imported manuscript (or running semantic diagnostics), the author's API quota hits a limit or Wi-Fi drops — while an unsaved edit exists in Chapter 4.
- **Current Traced Experience (`Confirmed in source`: `App.tsx:175-185`, `ImportWorkflow.tsx`, `NarrativeReview.tsx`):**
  - `ImportWorkflow` already has strong IndexedDB checkpoint saving under the hood, **but** UI feedback is confined to a single inline box deep inside the import page; leaving `Import` makes progress invisible.
  - Meanwhile in `Write`, a dirty draft blocks workspace switching (`allowNavigation`), creating anxiety that switching views to check AI Settings might lose work.
- **Redesigned Target Flow (`Proposal`):**
  1. **Silent Auto-Stashed Drafts:** Switching from `Write` to `Settings` or `Review` never blocks or loses keystrokes; the working draft is automatically stashed locally with a subtle `Unsaved draft preserved · Save checkpoint` indicator.
  2. **Unified Non-Intrusive Operation Center (Status Pill → Popover/Drawer):** Shows active, paused, partial, or failed long-running jobs across the app with truthful segment progress (`7 / 12 segments complete · 5 paused`), preserved partial results, `Cancel`, `Retry remaining`, or `Continue offline with local tools`.
- **Success Criteria:** Author never loses a single character of prose or completed analysis work during network/provider failure, and always sees an honest next step.

---

## 3. Cross-References & Checkpoint Status

- **Completed in this file:** Detailed before/after traces for all 9 required journeys (`J-01`–`J-09`) plus 3 newly discovered journeys (`J-10`–`J-12`), grounded in source and preview evidence.
- **Next document:** [03 — Independent Information Architecture](./03-independent-information-architecture.md) develops **four genuinely different product-wide organizing models** from first principles BEFORE reconciling coverage against `PRODUCT-BLUEPRINT.md`, `DELIVERY-ROADMAP.md`, and `WP01/WORK-PACKAGE.md`.
