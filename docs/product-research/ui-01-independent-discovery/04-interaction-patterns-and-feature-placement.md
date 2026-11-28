# 04 — Interaction Patterns and Feature Placement

**Assignment:** `PCC-UI-RESEARCH-01` — Independent UX, Information Architecture & Visual Design Discovery  
**Status:** Complete (Cycle 3 Interaction Invention & Cycle 5 Concrete Pattern Specification)  
**Scope:** Interaction models for AI as a creative partner, single-home feature placement with contextual shortcuts, progressive disclosure without hiding functionality, keyboard-first & pointer ergonomics, author-centered terminology system, and concrete 6-state screen behavior (*empty, populated, pending, unavailable/error, success, recovery*).

---

## 1. Interaction Philosophy: AI as a Scoped Editorial Partner (Not a Chatbox, Not an Autopilot)

Most generic AI writing tools fail authors in one of two opposite ways:
- **The Generic Chat Sidebar Trap:** Forces the author to copy-paste story context into a narrow chat window, losing structural provenance, mixing brainstorming with canon, and forcing manual re-entry.
- **The Silent Autopilot Trap:** Overwrites prose or invents world facts silently, destroying author trust and narrative voice.

PCC's interaction grammar should establish a **third, unmistakably literary paradigm** (`Proposal`):

### 1.1 Five Invariant Rules for Every AI Interaction

1. **Always Show Scope Before Running:** Before any AI action fires, display a crisp, plain-language **Scope & Privacy Bar** right next to the trigger:
   - *Example:* `Scope: Selected 140 words + Scene 4 summary + Leyla profile · Model: Claude/Gemini (Cloud) · Est. ~1,800 tokens`
   - Never hide what is being sent or run hidden background inference.
2. **Separate "Directions" from "Concrete Ideas":**
   - **Directions** are broad thematic/structural vectors (*"Hidden complicity"*, *"Unreliable witness"*, *"Tighten pacing via silence"*). Authors can ask for **More Directions** or write a **Custom Direction** without generating walls of premature prose.
   - **Concrete Ideas** are specific playable story moves anchored to characters/scenes underneath a chosen direction — each individually regenerable, editable, refinable (*"Keep core idea, make subtler"*), combinable via multi-select, bookmarkable, or dismissible.
3. **Visual Separation of Draft / Proposal vs. Applied Canon:**
   - **Canonical Story Content** sits on crisp primary paper surfaces (`--surface-paper`) with solid borders.
   - **Unreviewed AI Proposals & Exploration Drafts** ALWAYS appear on subtly tinted **Draft Paper** (`--surface-draft`, hairline dashed border + `Proposed` or `Exploration` tag). An author can tell at a peripheral glance whether a sentence or character fact is *canon* or *unapplied proposal*.
4. **Explicit Approval Boundaries & Non-Destructive Alternatives:**
   - Every mutation passes through an **Exact Before → After Diff** (word-level for prose, structured field/edge delta for World).
   - Every high-impact decision offers **four honest exits**: `Apply to Story` (with immediate inline `Undo`), `Edit Proposal First`, `Save as Independent Alternative (stay here)`, or `Decline / Keep in Session`.
5. **Uninterrupted Work (Zero Blocking Locks):**
   - Replace the current dirty-draft navigation lock (`App.tsx:175-185`, `UX-09`) with **transparent local draft auto-stashing**.
   - Long-running AI jobs (multi-segment import, full-manuscript diagnostics, batch exploration) run asynchronously in the non-intrusive **Operation Center** so the author can keep reading or outlining while watching truthful segment progress (`4 / 12 segments`) — with stale-revision checks protecting any apply step if the manuscript changed in the meantime.

---

## 2. How the Interface Teaches Without a Manual (Zero-Manual Onboarding)

`RESEARCH-ASSIGNMENT.md §6` warns against relying solely on tooltips, hidden menus, or mandatory multi-screen wizards. Instead, PCC should teach its richer narrative concepts (*Canon vs. Character Belief*, *Faithful Import*, *Protected Locks*, *Independent Alternatives*) organically through **four layered affordances**:

1. **Actionable Empty States (Show-and-Do Cards):**
   - Instead of `"No matching relationships."` or `"Nothing to preview yet."` (`UX-18`), every empty workspace displays a compact **1-sentence plain explanation + 2 concrete starter actions + 1 realistic mini-example** (dismissible once content exists).
   - *Example (`World → Knowledge Matrix` empty state):* *"Track what each character actually knows versus what is true — great for mysteries and dramatic irony. `[Record a character belief]` `[Run local scan on Ch. 1]`"*
2. **Inline Semantic Micro-Keys (At the Point of Encounter, Not a Permanent Banner):**
   - Today's `AdaptivePlanWorkspace.tsx:145-152` wastes a full permanent horizontal bar on a 6-item `Narrative evidence key` strip.
   - Replace it with an **interactive Canvas Legend popover** (`Legend (?)` pinned quietly in the bottom-left corner of the graph/matrix) PLUS plain-English hover/focus descriptions on the badge itself (`Character Belief — Leyla thinks this is true, not confirmed canon`).
3. **Interactive Starter Tour Inside the Sample Story (Optional, Never Mandatory):**
   - If a first-time user opens the Sample Project, offer an optional dismissible **3-step guided ribbon** (`1. Read Ch. 1 formatted → 2. Inspect a Character Belief in World → 3. Try a safe Undoable Fix in Review`), rather than locking them inside a modal wizard.
4. **Global Command Palette (`Cmd/Ctrl + K`) with Plain-English Verbs:**
   - Typing *"flashback"*, *"who knows"*, *"what if"*, *"backup"*, *"protect"*, or *"Leyla"* surfaces both **entities/scenes** AND **matching actions** with their logical home (`Open Dual-Track Timeline — World`, `Save Independent Alternative — Home`). Authors never have to memorize menu locations.

---

## 3. Feature Placement & Anti-Duplication Map

To eliminate today's triplicate buttons (`+ New`, `Import`, `Projects` duplicated between `Header` and `Workspace Nav`, `UX-17`; `Opportunities`/`Ideas` split across `Plan` and `Review`, `UX-11`; `History` split across 4 places, `UX-14`), every operation gets **exactly one logical home** plus **explicitly labeled contextual shortcuts**:

| Feature / Operation | Single Logical Home | Allowed Contextual Shortcut(s) | Retired Duplicate(s) |
|---|---|---|---|
| **Create New Project** | `Home → Projects` | Top-left Project Switcher menu (`+ New Story…`) | Remove duplicate `+ New` from both top bar and secondary nav |
| **Import Existing Story** | `Home → Import Story` | Top-left Project Switcher (`Import…`) & `Cmd+K` | Remove duplicate `Import` in Header + Nav |
| **Project Library, Alternatives, Export & Backups** | `Home` (Overview, Library, Alternatives) & `Settings → Storage & Backup` | Project Switcher (`Switch project…`) | Remove dead/unconnected `Revision history` fallback inside `ProjectHub` |
| **Write, Format Preview, Focus Mode** | `Write` | Jump-to-passage from any `World` or `Review` citation | Retire raw `<pre>` preview (`UX-03`) |
| **Cursor / Selection AI Revision** | `Write` (contextual selection bar / `Cmd+J`) | Companion pane for larger diffs | Retire forcing writers out to `Plan → PromptInput` + `BottomBar` |
| **Story Bible & Rules** | `World → Story Bible` (full-width editable domains) | Companion pane link from `Write` or `Review` | Retire `398px` narrow-rail Story Bible tab (`UX-04`) |
| **Relationship Graph, Ego, Kinship, Table** | `World → Story Map` (unified view switcher) | Click any character in `Write` / `Studio` | Retire hardcoded `Group Guests` button (`UX-10`); replace with general `Group by faction/tag` |
| **Dual-Track Timeline (Reading vs. Story Time)** | `World → Timeline` (full-width dual-track view) | Scene chronology tag chip in `Write` | Retire narrow-rail `TimelinePanel` alphabetical table (`UX-06`) |
| **Knowledge / Epistemic Matrix** | `World → Knowledge` (Who knows what vs. truth) | Character detail drawer | Replaces static 2-column `MindMapPanel` card list (`UX-12`) |
| **Source-Grounded Story Q&A** | `World → Ask Story` | `Cmd+K` or `? Ask about selection` in `Write` | New capability (no legacy duplicate) |
| **Creative Discovery, Sessions, What-Ifs & Premise Interview** | `Studio` (full-width workspace with Sessions shelf) | `Explore ideas for this scene` in `Write`; `Start from premise` in `Home` | Retire narrow-rail `Ideas` / `Opportunities` tab + `Review` jump link (`UX-11`) |
| **Secondary Image Generation / Visual Mood** | `Studio → Visuals` | Scene mood-image action in `Write` scene header | Retire global `Story / Image` toggle in `WorkspaceBottomBar` (`UX-17`) |
| **Scene/Chapter Strengthening & Locks** | `Review → Strengthen` *(or 6th `Develop` room — `UID-02`)* | Selection `Strengthen` shortcut in `Write` | New capability cleanly separated from `Studio` |
| **Continuity Checks, Sync, Fix Diff & Undo** | `Review → Check & Sync` | Subtle issue dot in `Write` outline | Retire duplicate `Plan → Checks` tab (`UX-04`) |
| **Revision History & Restore** | `Review → History` (full-width searchable timeline with diff) | Inline `Undo` toast immediately after any apply; `Home` recent milestones | Retire 3 fragmented history panels (`ProjectHub`, `Plan` rail, `ReviewDiffModal`) |
| **AI Connections, Models, Ops, Embeddings, Budgets** | Top-right `Settings & Recovery` | Direct `Open Settings →` link inside every unconfigured/paused notice | Retire plain-text dead-end error strings (`UX-15`) |

---

## 4. Progressive Disclosure: Calm Everyday Workspace vs. Deep Controls

Rather than hiding capabilities in mystery submenus or dumping 36 tiny buttons onto the screen (`Observed in preview` in `Plan`), PCC should use **two structural progressive-disclosure mechanisms**:

1. **Workspace Density Preference (`Calm` default vs. `Deep`):**
   - **`Calm` (Default):** Clean primary canvas, collapsible left rail, companion pane closed until requested, advanced parameters (token budget breakdown, reasoning effort override, epistemic provenance audit, raw prompt inspection) tucked into one-click expandable disclosures (`Details & scope`).
   - **`Deep` (Power / Editing Mode):** Keeps outline + companion pane + epistemic badges + live word/pacing metrics visible simultaneously for intensive revision passes.
   - **Guarantee:** Switching between `Calm` and `Deep` NEVER removes a feature — it only changes default panel expansion and metadata density.
2. **Contextual Control Escalation (Action Reveals Detail):**
   - *Idle state:* A scene card shows only Title + Word count + subtle status dot.
   - *Hover/Focus state:* Reveals quick actions (`Open`, `Split right`, `Strengthen`).
   - *Active AI action state:* Expands the Scope & Protected Locks tray right before confirmation.

---

## 5. Author-Centered Terminology & Naming System

Replacing engineering jargon (`UX-10`, `UX-11`) with warm, exact literary vocabulary while keeping underlying technical honesty available in expandable details:

| Current Term in App (`Confirmed in source`) | Problem | Proposed Author-Friendly Term (`Proposal`) | Plain-Language Explanation (Inline Help) |
|---|---|---|---|
| `Belief Graph` | Sounds like a Bayesian ML algorithm rather than a story map | **`Story Map`** *(with `Knowledge` lens for beliefs)* | *"Visual map of characters, places, events, and how they connect."* |
| `Saved · r1` / `Revision #1` | Database version counter leaked into header (`Header.tsx:77`) | **`Saved` (click for History)** / **`Checkpoint 1`** | Technical revision ID stays inside `History → Audit details`. |
| `Decision Inbox` | Sounds like an email/ticketing system | **`Pending Decisions`** *(or `Staging Queue`)* | *"Proposed additions awaiting your approval before entering canon."* |
| `Opportunities` / `Ideas` / `Creative Opportunities` | Triplicate naming (`UX-11`) | **`Studio`** (workspace) / **`Story Ideas`** (items) | Consistent single name everywhere. |
| `Epistemic Kind: interpretation` | Academic philosophy jargon | **`Inference`** *(paired with `Fact`, `Character Belief`, `Rumor / Reported`, `Ambiguous`)* | Immediately intelligible to fiction writers. |
| `Group Guests` (`GraphToolbar.tsx:124`) | Leaked sample-story cast label (`UX-10`) | **`Group by Tag / Faction`** | Works for any genre and cast. |
| `Stage 2 Enhancements` (`ImportWorkflow.tsx`) | Internal pipeline phase name | **`Optional Story Suggestions`** | Plainly states these are optional post-extraction creative ideas. |
| `Snapshot Digest` / `Stale base revision` | Developer concurrency wording | **`Story changed since preview — refresh preview`** | Explains *why* apply is paused and gives a 1-click refresh button. |
| `Adopt Artifact` | Technical wording for bringing generated prose into manuscript | **`Insert into Manuscript…`** | Clear action verb with placement choices (*New scene*, *Append*, *Replace selection*). |

---

## 6. Keyboard-First, Pointer, Desktop & Mobile Ergonomics

| Interaction Dimension | Proposed Contract (`Proposal`) |
|---|---|
| **Global Navigation Shortcuts** | `Cmd/Ctrl + K` (Command Palette), `Cmd/Ctrl + 1..5` (Switch `Home / Write / World / Studio / Review`), `Cmd/Ctrl + B` (Toggle Left Rail), `Cmd/Ctrl + \` (Toggle/Focus Companion Split Pane), `Cmd/Ctrl + Shift + F` (Distraction-Free Focus Mode), `Cmd/Ctrl + J` (Contextual AI Partner at selection/cursor), `Cmd/Ctrl + Z` / `Shift+Z` (Undo / Redo). |
| **Pointer & Touch Ergonomics** | Every interactive control meets **`>=40px` desktop comfortable / `>=44×44px` touch target minimum** (eliminating today's 36 buttons under `36px` in `Plan`, `UX-08`). Drag-resizable split handle includes `role="separator"` with `ArrowLeft`/`ArrowRight` keyboard resizing and double-click to reset `50/50`. |
| **Responsive Breakpoints** | `>=1280px` (Full shell + optional Left Rail + optional Companion Split Pane); `768–1279px` (1 primary pane + slide-over Left Rail + switchable Companion Sheet); `<768px` (Bottom 5-item icon+label workspace bar + compact top bar with active project + overflow menu — **never** hiding `+ New`, `Import`, `Projects`, or `About` as today's `Header.tsx` does, `UX-05`). |
| **Web vs. Future Native Desktop** | Avoid browser-only shortcuts (`Cmd+W`, `Cmd+T`, `Cmd+R`); eliminate all `window.confirm`/`window.alert` calls (`Header.tsx:93`, `ManuscriptEditor.tsx:278`) in favor of accessible in-app dialogs so web iframes and future Electron/Tauri wrappers behave identically. |

---

## 7. Concrete 6-State Matrix for High-Value Flows

Every major screen/flow must design explicitly for all six operational states (`RESEARCH-ASSIGNMENT.md §7`):

| High-Value Flow | 1. Empty | 2. Populated | 3. Pending / Loading | 4. Unavailable / Error | 5. Success | 6. Recovery |
|---|---|---|---|---|---|---|
| **Write: Contextual AI Revision** | Selection strip hidden until cursor/text selected; subtle `Cmd+J` hint in footer | Tinted Draft Proposal sheet beside selection with exact word diff + `Apply / Refine / Save Alt / Decline` | Non-blocking shimmer card adjacent to selection (`Generating suggestion · Cancel`); prose stays readable | Honest inline banner: *"Provider unavailable (429 rate limit)"* + **`Open AI Settings`** or **`Retry`**; zero text lost | Atomic apply + inline toast: *"Updated Scene 4 · `[Undo]`"* | Browser refresh or crash mid-edit restores auto-stashed working draft with *"Recovered unsaved draft from 14:22 — Keep / Compare / Discard"* |
| **Import Story & Extraction** | Clean dropzone + paste box + format support note (`.md, .txt, .docx`) | Split view: Left extracted candidates grouped by type & confidence; Right exact source highlighting | Truthful segment bar (`Segment 5 of 12 · 42% · 18 entities found so far · [Pause / Cancel]`) | Explicit partial state: *"Segments 6–12 failed (timeout). Segments 1–5 are saved locally."* + `Retry failed segments` or `Commit partial / text-only` | Post-commit summary card with counts + direct buttons: `Start Writing`, `Open Story Map`, `Review Ambiguities` | Reloading same source detects matching IndexedDB checkpoint automatically: *"Resume saved progress (5/12 segments)?"* |
| **Studio: Creative Exploration** | Premise/goal input + 3 starter prompts (*Deepen mystery*, *Hidden link*, *What-If twist*) + Intensity slider | Two-tier board: **Directions** row at top, **Concrete Idea** cards below with per-item `Refine / Regen / Edit / Combine / Save` + persistent Sessions sidebar | Skeleton cards inside active direction only; author can still read/edit saved cards while new batch generates | Clear notice: *"No AI provider connected — you can still write and organize manual ideas & What-If notes."* + `Connect AI` | Quiet badge update (`Saved to session · 4 starred`) — explicitly never auto-edits canon | Sessions auto-save every edit locally; accidental dismissal offers 10-second `Undo dismiss` + `Dismissed archive` toggle |
| **World: Story Map & Story Q&A** | Actionable empty canvas: *"Add your first character"* / *"Import a manuscript"* / *"Explore via questions"* | Spacious full-canvas graph/matrix/timeline (`>=70%` viewport) + bottom-left collapsible legend + citation-backed Q&A drawer | Q&A shows retrieval status (`Searching 14 local scenes… → Answering with citations`) + `Cancel` | If embeddings unavailable: gracefully falls back to *"Using local lexical search (no AI required)"* with honest coverage note | Selecting citation smoothly opens exact passage in Companion Pane with yellow highlight | Switching views or closing browser preserves active entity filter and pan/zoom framing per project |
| **Review: Continuity Check & Sync** | `"No checks run yet"` + two equal buttons: **`Run Local Checks (Instant, Offline)`** and **`Run Deep AI Review`** | Split workbench: Left prioritized issue list (separated from readiness reminders); Right side-by-side evidence + fix alternatives + separate Patch vs. Uncertain Impact preview | Scoped progress indicator (`Checking Ch. 4–7 · Est. ~2,400 tokens · [Cancel]`) | Stale-version conflict or AI outage: *"Story changed while checking — `[Re-preview fix]`"* or *"AI offline — deterministic local fixes still work"* | Inline applied banner (`Fix applied to Ch. 7 · [Undo] · [View History]`) + issue moves to Resolved with reason | One-click `Restore Checkpoint` in `Review → History` previews exact before/after before reverting |
| **Settings & Storage Backup** | First-run guided connection banner (`Connect local or cloud provider, or continue offline`) | 4 clean tabs (`Connections & Models`, `Operations Matrix`, `Search & Retrieval`, `Storage & Backup`) with auto-discovered models | Per-provider inline spinner (`Discovering models…`) without locking other tabs | Clear diagnostic (e.g., *"Ollama not reachable at localhost:11434 — check service"*) + `Test again`; local writing unaffected | Green verified chip (`Ready · 6 models available`) + live Operations Matrix update | IndexedDB quota warning shows actionable **`Download All-Projects Archive (.zip)`** + **`Inspect Browser Backups`** |

---

## 8. Cross-References & Checkpoint Status

- **Completed in this file:** AI-as-partner interaction rules, zero-manual learning strategy, anti-duplication single-home placement table, `Calm`/`Deep` progressive disclosure, author-friendly terminology dictionary, keyboard/responsive ergonomics, and concrete 6-state matrix.
- **Next step:** Read `PRODUCT-BLUEPRINT.md`, `DELIVERY-ROADMAP.md`, and `WP01/WORK-PACKAGE.md` for strict Post-Independent Coverage Reconciliation (per `RESEARCH-ASSIGNMENT.md §2`), then produce Batch 3 (`05-visual-design-directions-and-design-system.md` and `06-narrative-visualization-and-editor-experience.md`).
