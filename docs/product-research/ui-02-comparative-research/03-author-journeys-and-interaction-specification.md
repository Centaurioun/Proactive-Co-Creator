# 03 — Author Journeys and Interaction Specification

**Assignment:** `PCC-UI-RESEARCH-02` — Comparative UX Research, Design Synthesis & Product-Wide Interaction Blueprint  
**Status:** Complete (Cycle 2–5 Workflow Synthesis & Alternative Comparison)  
**Scope:** Establishes one **Canonical Shared Synthetic Narrative (*"The Salt Ledger / Tuz Defteri"*)** used consistently across documents `03`–`07`; traces **all 12 earlier journeys (`J-01`–`J-12`) plus 3 new comparative journeys (`J-13`–`J-15`)** comparing **two plausible workflows** wherever a genuine UX design choice matters; corrects `ui-01`'s inaccurate `J-03` description of `WritingAssistantPanel.tsx`; and stress-tests the system across 9 realistic authoring conditions without claiming unmeasured performance or usability statistics.

---

## 1. Canonical Shared Synthetic Story: *"The Salt Ledger / Tuz Defteri"*

To ensure that every navigation trace (`02`, `03`), screen spec (`04`, `07`), visualization (`05`), and visual design candidate (`06`) can be compared **apples-to-apples** on identical narrative complexity, this package uses one synthetic bilingual-capable manuscript throughout *(illustrative fixture only; not proof of live runtime execution)*:

- **Premise:** In summer 1982, retired Karaburun lighthouse keeper **Leyla** pries open a salt-sealed tin containing 1954 harbor manifests (*Tuz Defteri*) that contradict her father **Captain Arif**'s official 1961 death record.
- **Core Entities (Sample Subset of 28):** `Leyla` (character), `Captain Arif` (character), `Harbor Clerk Kemal` (character), `Karaburun Lighthouse` (location), `1954 Logbook` (object), `Brass Fresnel Lens` (object), `August 1954 Clearance` (event).
- **Non-Linear Chronology & Multilingual Passage:**
  - `Ch. 1 — The Foghorn` (1982 Summer — Reading #1, Story-Time #3)
  - `Ch. 2 — The Shattered Lens` (1961 Gale Flashback — Reading #2, Story-Time #2): establishes *"the 1954 brass lens shattered during the November 1961 gale."*
  - `Ch. 3 — Tuz Defteri (1954 Kışı)` (1954 Winter Flashback — Reading #3, Story-Time #1): Turkish-dialogue flashback where Arif alters the August clearance; **Reader learns Arif forged it (`Ch. 3 §2`), while Leyla does not yet know**.
  - `Ch. 4 — The Sealed Manifest` (1982 Summer — Reading #4, Story-Time #4): Leyla opens the tin; includes Turkish quotation *"— Bu imzayı babam atmadı, diye fısıldadı."*
  - `Ch. 5 — Harbor Office` (1982 Summer — Reading #5, Story-Time #5): Leyla confronts Kemal; **Leyla falsely believes Kemal forged the logbook** (Character Belief), while **Kemal suspects Arif was coerced**.
  - `Ch. 7 — Evening Watch` (1982 Summer — Reading #7, Story-Time #7): **Active Continuity Contradiction** — says Leyla *"polished the original 1954 brass lens"* (contradicts `Ch. 2 §2`).
  - `Ch. 8 — Fog Dream` (Undated / Uncertain Story-Time).
- **Active Protected Locks:** 🔒 *Hard Lock:* Keep `Ch. 3 §2` verbatim clearance date (`14 August 1954`) and `Brass Lens` shattered in `1961`. 🧭 *Soft Guidance:* Keep Leyla's voice understated and unsentimental.
- **Active Creative Session:** *"Act II Harbor Complicity Twists"* (3 saved ideas, 1 independent alternative `"Salt Ledger — Gazette Ending"`).

---

## 2. Fifteen End-to-End Author Journeys (Comparing Plausible Workflows)

> **Methodological Honesty (`§5`, `§D.6`):** Current-state steps are traced directly from verified source files (`Confirmed in source`). We do **not** claim inflated percentage reductions or fake usability test scores; instead we compare **actual current friction** against **two concrete candidate workflows (Workflow A vs. Workflow B)** so tradeoffs are transparent.

### J-01: First Launch → New Premise → Exploratory Questions → Concept → Manuscript
- **Intended Outcome:** Turn a 2-sentence premise into an editable story concept and Chapter 1 without forced tutorials or graph jargon.
- **Current Traced Reality (`Confirmed in source`):** App opens onto sample project (`App.tsx`). Author clicks `+ New` (`Header.tsx` — hidden `<640px`, `UX-05`) → fills `CreateProjectDialog` → enters blank workspace → must manually switch to `Plan`, open `PromptInput` (collapsed `<details>` below `xl`), review items in hidden `DecisionInboxPanel`, generate in `WorkspaceBottomBar`, then switch to `Write` and run `AdoptArtifactDialog`. No voluntary `Grill Me` interview exists.
- **Workflow Option A (Guided Premise Interview — Recommended for Plotters/Explorers):** `Projects → Start from Premise` → enter 2-sentence premise → click optional **`Explore with Grill Me`** (`Inspire` or `Explore` mode) → answer 3–5 adaptive questions (or `Skip / Leave Mystery`) while watching the optional right-hand **Live Non-Canonical Draft Sketch** grow → click **`Stop & Preview Concept`** → approve selected items → land in `Write` (Ch. 1 ready) with `World` quietly populated.
- **Workflow Option B (Direct Manuscript First — Recommended for Discovery Writers):** `Projects → Blank Manuscript` → land immediately in clean `Write` sheet (zero modal ceremony, zero sample text injected, zero AI call) → type Ch. 1 directly; invoke `Grill Me` or `World` only when wanted.
- **Success Criteria:** Both paths require zero mandatory wizard; neither overwrites existing projects or triggers unsolicited AI calls (`OD-02`, `UID-08`).

### J-02: Import Existing Narrative → Inspect Source → Explore Structure → Edit → Analyze
- **Intended Outcome:** Bring an 18,000-word `.docx`/`.md` story in faithfully (exact source preserved), optionally extract cast/relationships with verbatim verification, edit a scene, and run checks.
- **Current Traced Reality (`Confirmed in source`: `ImportWorkflow.tsx`):** Proven safeguards exist (exact retention, IndexedDB checkpoints, duplicate/cross-project identity resolution — **owner finds Import broadly acceptable**, `OR-Import-1`), **but** all 5 stages stack vertically on one long scroll page without a sticky commit bar or side-by-side Source↔Candidate verification pane.
- **Workflow Option A (Source-Only Fast Entry — Default Safe Path):** `Projects → Import Story` → drop `.docx`/`.md` → inspect parsed chapter split → click equal-weight primary button **`Import Text Only (Offline)`** → land in `Write` with exact raw Markdown preserved; run selective AI extraction later if desired.
- **Workflow Option B (Staged Extraction with Split Source Verification):** Same entry → choose `Analyze & Extract` (disclosing bounded chunk plan & provider consent) → sticky bottom progress bar (`4 / 12 segments`) → Step 3 opens **Dual-Pane Companion (`UID-01`)**: Candidate Review left, exact read-only Source with highlighted verbatim spans (`UI-NEW-03`) right → commit → post-commit orientation strip offers `Write`, `World`, or `Review`.
- **Success Criteria:** Preserves all existing `ImportWorkflow` safeguards (`OR-Import-1`) while removing vertical-scroll fatigue and making source grounding visual.

### J-03: Write or Revise a Passage Using Contextual AI Assistance & Review Its Result *(Corrected from `ui-01`!)*
- **Intended Outcome:** Select Leyla's stiff dialogue in `Ch. 4 — The Sealed Manifest` (`"— Bu imzayı babam atmadı..."`), ask AI to deepen subtext without altering prose silently, compare options, and apply or save an alternative.
- **Current Traced Reality (`Confirmed in source` — Correcting `ui-01`):** `WritingAssistantPanel.tsx` **DOES exist inside `Write`** (`ManuscriptEditor.tsx:396-413`) with 8 actions (`Continue`, `Rewrite`, `Improve Clarity`, `Shorten`, `Expand`, `Dialogue`, `Alternatives`, `Custom`), digest/stale guards, `Replace Selection`, `Insert After`, `New Scene`, and `Keep Alternative`. **Actual UX failure (`Owner screenshots` + `Confirmed in source`):** (1) Buried far below `SectionDetailFields` inside a collapsed `<details>` wrapper (`WritingAssistantPanel.tsx:257`); (2) Exposes raw offsets (`offsets 412–589`) and dense preflight/confirmed-context paragraphs instead of plain writer guidance; (3) `Preview section` renders raw `<pre>` (`UX-03`).
- **Workflow Option A (Selection Floating/Sticky Assist Bar + Inline/Companion Diff — Recommended):** Selecting text in `Write` (`Edit` OR `Read` mode per `UIRF-06`) activates a quiet **Selection Assist Strip** right beneath the editor header (or via `Cmd+J`): `[Rewrite | Dialogue & Subtext | Tighten | Expand | Ask Story | Custom…]` with plain scope text (`Selected 38 words in Ch. 4 · 2 locks active · [Inspect Context]`). Output renders in a tinted **Draft Proposal** sheet beside the prose (`UID-01`) with sentence/hunk cherry-pick (`UI-NEW-06`), `Replace`, `Insert After`, `Keep Alternative`, and 1-click `Undo`.
- **Workflow Option B (Docked Companion Assist Rail — `Deep` Mode):** Author keeps `Write Assist` open in the Companion Pane while revising an entire chapter sequentially, seeing `Kept Alternatives` and `Local Writing Insights` (`UI-NEW-05+07`) alongside prose.
- **Success Criteria:** Zero scrolling past metadata forms to reach existing writing assistance; natural writer wording (`UID-05`); technical preflight/digests one click away in `Context Inspector`.

### J-04: Discover and Develop an Idea Through Multiple Iterations → Save → Leave → Resume
- **Intended Outcome:** Brainstorm Act II twists for *Salt Ledger*, append more directions, refine one card preserving its core, combine two cards, save to Collection, close browser, and resume cleanly tomorrow.
- **Current Traced Reality (`Confirmed in source`):** `OpportunityCenter` sits inside a `398px` right rail under three conflicting names (`Opportunities` / `Ideas` / `Creative Opportunities`), silently fails to open if `Context` is hidden (`UX-01`), and lacks per-card regeneration, direction-vs-idea separation, multi-select combine, and persistent sessions.
- **Workflow Option A (Full-Canvas `Creative Studio` Session Workbench — Recommended):** Open `Creative Studio` → left rail lists auto-saved persistent sessions (`Act II Harbor Complicity Twists`) + `Creative Collection` → enter custom direction → choose **`Suggest Directions`** (adds new angles) OR **`Generate Idea`** (concrete card) → click **`Suggest More Directions`** (appends without clearing picks) → multi-select 2 cards (`GS-04`) → `Combine Selected` or per-card `Develop Further` / `Regenerate One` (`v1/v2`) / `Challenge` / `Explain Differently` → `Save for Later` → leave for `Write` → tomorrow click `Resume` in `Projects → Overview` (`UI-NEW-08`) to return to exact cards and selections (zero automatic AI call on reopen).
- **Workflow Option B (Scoped Studio Launch From `Write` or `World`):** From `Ch. 5` or `Harbor Clerk Kemal`, click `Explore Ideas for Kemal →` which opens `Creative Studio` pre-scoped to `Kemal + Ch. 5` with a `← Return to Ch. 5` deep-link breadcrumb (`UIRF-03`).
- **Success Criteria:** All owner-approved `CE-02`/`CE-03` card semantics work spaciously; ideas remain visibly tinted `Draft` (never canonical) until explicitly previewed and applied.

### J-05: Investigate Character, Event, or Relationship via Visualizations & `Story Q&A`
- **Intended Outcome:** Check what Leyla vs. Kemal vs. the Reader know about the 1954 logbook as of `Ch. 5`, and inspect verbatim evidence.
- **Current Traced Reality (`Confirmed in source` + `Observed in preview`):** `Plan` graph gets `28%` viewport area (`978×371px`), `GraphToolbar` hardcodes `Group Guests` (`UX-10`), `AdaptivePlanWorkspace` slices at 80 items (`UX-13`), `TimelinePanel` sorts alphabetically (`UX-06`), `MindMapPanel` is a static card grid (`UX-12`), and no `Story Q&A` exists.
- **Workflow Option A (Direct Visual Lenses in `World`):** Open `World` → switch cleanly between **Story Map** (1-hop focus on `Leyla`), **Knowledge Matrix** (check `Reader` vs. `Leyla` vs. `Kemal` row with dual-axis As-Of Scrubber `UI-NEW-02`), **Dual-Track Timeline**, and **Associative Mind Map** — preserving active entity filter across lenses.
- **Workflow Option B (Question-First via `Story Q&A` + Split-Jump Citation):** Open `Story Q&A` (from top bar or `World`) → ask *"Does Leyla know Arif forged the 1954 logbook by Chapter 5?"* → receive grounded answer distinguishing *absence of evidence* from *established belief*, citing `Ch. 3 §2` and `Ch. 5 §1` → click `Ch. 5 §1` to open verbatim highlighted passage beside Q&A (`UI-NEW-03`) → optionally click **`Explore Subtext in Studio →`** (`S-04`).
- **Success Criteria:** Distinct visual forms never conflated (`§D.1`); citations preserve origin context and fail safely if stale.

### J-06: Strengthen a Scene or Chapter While Preserving Intentional Elements (`Story Development`)
- **Intended Outcome:** Tighten pacing and deepen dialogue subtext in `Ch. 4` while locking the verbatim `14 August 1954` date and preserving Leyla's understated voice.
- **Current Traced Reality (`Confirmed in source`):** No dedicated `Story Development` workspace or structured Hard Lock vs. Soft Guidance UI exists; authors edit manually or paste text into narrow `Story Bible → Continuity rules`.
- **Workflow Option A (Full-Canvas `Story Development` Workspace — Distinct per `UID-02`):** Open `Develop` → choose scope (`Ch. 4` or `Whole Story`) and lens (`Scene & Dialogue / Subtext` or `Voice & Tighten / Compression`) → pin 🔒 **Hard Structural Locks** (date `14 August 1954`, `Brass Lens` state) + 🧭 **Soft Semantic Guidance** (*"Keep Leyla unsentimental"*) + repeatable custom `+ Add constraint` rows → inspect `Context Inspector` → generate targeted revision → cherry-pick independent hunks (`UI-NEW-06`) → apply with immediate `Undo`.
- **Workflow Option B (Scene-Anchored Development From `Write`):** From `Ch. 4` in `Write`, toggle `Local Writing Insights` (`UI-NEW-05+07`) to spot exposition-heavy paragraphs locally (zero AI) → click `Strengthen in Develop →` opening `Story Development` pre-scoped to `Ch. 4` with locks inherited.
- **Success Criteria:** Clearly distinct from open-ended `Creative Studio` and clinical `Review`; Hard Locks deterministically validated against actual patch (`OD-06`, `S-01`), soft guidance honestly labeled non-deterministic.

### J-07: Review a Continuity Issue → Examine Evidence → Compare Fixes → Apply/Decline → Undo
- **Intended Outcome:** Resolve the `Ch. 2` (*shattered in 1961*) vs. `Ch. 7` (*polishing original 1954 brass lens*) contradiction safely, inspect exact graph/text changes vs. uncertain ripples, apply, and verify 1-click undo.
- **Current Traced Reality (`Confirmed in source`: `NarrativeReview.tsx`, `HistoryPanel.tsx`):** Issues, readiness hints, sync, automation settings, and audit stack vertically in `Review`; `Plan → Checks` duplicates local issues; jumping to evidence leaves Review; Revision History is clipped inside `398px` inspector (`OR-History`).
- **Workflow Option A (Split Issue Workbench in `Review` — Recommended):** Open `Review` → top summary clearly separates **Actual Issues (1)** from **Readiness Hints (2)** and **Sync** → select `Brass Lens Contradiction` → Companion Pane opens side-by-side showing `Ch. 2 §2` and `Ch. 7 §4` verbatim highlights (`UI-NEW-03`) → compare `Fix A (1962 replica lens)`, `Fix B (Revise Ch. 2)`, or `Decline as intentional unreliable memory` → preview **Exact Before/After + Deterministic Patch Change Map** visually separated from **Possible Downstream Impacts (`Ch. 9 mentions "brass" — uncertain`)** (`S-06`) → click `Apply Selected` → inline confirmation strip shows `Applied to Ch. 7 · [Undo] · [View in Full-Width History]`.
- **Workflow Option B (Batch Triage Across Chapter Sync):** After editing 3 chapters, run `Manuscript ↔ Model Sync`, review grouped model proposals & text hunks (`UI-NEW-06`) with `Proposal Conflict Detector` (`IR-04`), uncheck 1 overlapping hunk, re-preview recompiled patch, and commit atomically.
- **Success Criteria:** Zero silent mutations; no redundant `Accept → Send to Review → Apply` ceremony; stale revisions visibly flagged before apply.

### J-08: Compare and Save an Alternative → Continue the Original Project
- **Intended Outcome:** Test *Ending B (Leyla publishes the 1954 letters in the harbor gazette)* as an independent alternative project while continuing uninterrupted in the original *Salt Ledger*.
- **Current Traced Reality (`Confirmed in source`):** No native non-switching alternative fork or two-project comparison exists.
- **Workflow Option A (From Final Proposal Preview):** In `Studio` or `Develop` Final Preview, choose **`Save as Alternative Project…`** → enter name `"Salt Ledger — Gazette Ending"` → default checked: **`Continue working in "Salt Ledger"`** → durable independent clone created with remapped IDs & lineage → success toast offers `Continue Current Project` (default) or explicit `Open Alternative →`.
- **Workflow Option B (Side-by-Side Read-Only Reference Comparison):** From `Projects → Alternatives`, click `Compare with Original` → opens `Gazette Ending` (Active, Read/Write or Read-Only selectable) beside `Salt Ledger — Original` (**Read-Only Reference by default** per `UID-01`) with explicit `Transfer Selected Change to [Target Project]` preview.
- **Success Criteria:** Original project untouched; zero accidental project switch; zero mutation routed silently to wrong project.

### J-09: Configure AI → Understand Models/Operations → Optional Search & Backup → Recover From Failure
- **Intended Outcome:** Connect ChatGPT OAuth or Gemini key without manual two-step refresh, configure optional local LM Studio (Qwen3-Embedding-0.6B) + Cloudflare Workers AI embeddings (`Priority Order`), verify operations readiness, and recover cleanly from a failed run.
- **Current Traced Reality (`Confirmed in source`: `AiConnectionsPanel.tsx`, `ProjectHub.tsx`):** Single scrolling vertical stack requiring separate manual `Refresh connections` and `Refresh models`; plain-text dead-end error strings (`UX-15`); no embeddings tab yet (`WP01 M5` / `WP02`).
- **Workflow Option A (5-Section `AI Settings` + Cross-Linked `Projects → Recovery` per `UID-07`):** Click compact Header Provider Popover (`GS-01`) → `Open AI Settings` → **Tab 1 (`Overview & Connections`)**: click `Connect` → automatic verified callback transitions `Waiting for authorization → Connected · Loading models → Ready (N models)` with zero manual dual-refresh (targeted `Retry Catalog` only if needed) → **Tab 4 (`Embeddings & Search`)**: verify `Local Lexical Index (Always Active)` and optionally configure `Priority Order` / `Use All Available` with explicit per-project consent (Off by default) → cross-link to `Projects → Backup & Recovery` for local/R2 backups.
- **Workflow Option B (Error-Driven Direct Recovery):** Mid-session rate-limit or unconfigured error banner displays honest cause + direct button **`Open AI Settings (Operations)`** → fixes provider or switches back to offline local tools while returning directly to exact prior task with preserved partial results.
- **Success Criteria:** Distinct connectivity vs. catalog vs. eligibility states; zero silent paid model substitution; offline writing & lexical search always work.

### J-10: Return & Resume After Days Away (`UI-NEW-08`, `GS-05`, `IR-05`, `UID-08`)
- **Workflow Option A (Adaptive Overview Launch — Default for Returning Projects):** Opens `Projects → Overview` showing real word/scene counts (zero fake completion %), **Resume Breadcrumb Trail** (`Ch. 4 — Sealed Manifest · cursor ¶3`, `Studio: Act II Twists`, `1 continuity conflict`, `Last verified backup: Nov 27`), and 1-click jump back to any destination (zero AI calls on launch).
- **Workflow Option B (Direct-to-Last-Work Preference — Opt-In per `UID-08`):** Author sets `Launch directly into last edited scene` in Overview preferences; reopens straight into `Write (Ch. 4 ¶3)` with a quiet dismissible `"Welcome back · 1 open review item"` status pill.

### J-11: Multilingual (Turkish) & Non-Linear Flashback Drafting (`UX-06`, `UI-NEW-05+07`)
- **Workflow Option A (Explicit Language-Neutral Chronology & Turkish Dialogue):** Author drafts Turkish prose with `—` em-dash dialogue and Turkish IME (preserving existing `ManuscriptEditor` IME guards), tags `Ch. 3 — Tuz Defteri` as `Story-Time: 1954 Kışı` + explicit `Flashback` checkbox (never relying on English regex), and views crossing flashback links cleanly on the **Dual-Track Timeline**.
- **Workflow Option B (Bilingual Search & Local Writing Insights):** Searches `"fısıldadı"` or `"imza"` offline via Unicode/Turkish-aware local lexical index (`WP02`), and toggles `Local Writing Insights` recognizing `—` Turkish dialogue dashes and respecting deliberate literary motifs.

### J-12: Mid-Session AI Failure, Quota Pause & Unsaved Draft Recovery (`UX-09`, `GS-07`, `GS-08`)
- **Workflow Option A (Non-Blocking Autosave + Operation Center):** While analyzing segment 7/12 of an import or running a long Studio call, Wi-Fi drops. `Operation Center` reports honestly `Paused/Failed at 7 / 12 segments · Partial results saved locally · [Retry Remaining] [Continue Offline]` (never claiming 100% or auto-retrying paid calls), while unsaved edits in `Ch. 4` auto-stash locally without locking navigation.
- **Workflow Option B (Post-Crash / Revision Conflict Recovery Assistant):** On reload after a browser crash or multi-tab storage conflict, `Projects → Recovery Assistant` explicitly distinguishes **Recovered Unsaved Draft** vs. **Storage Revision Conflict** vs. **Narrative Sync Drift**, offering side-by-side compare and **Restore as Copy** default.

### J-13 *(New Comparative Journey)*: Two-Project Alternative Comparison & Selective Transfer (`UID-01`, `CE-05`)
- **Workflow Option A (Read-Only Reference Split + Selective Transfer):** Author opens `Salt Ledger — Original` alongside `Salt Ledger — Gazette Ending` (locked **Read-Only Reference** banner on secondary side). Compares qualitative plot/tension/ending differences, selects one dialogue scene from `Gazette Ending`, clicks **`Transfer to "Salt Ledger — Original"…`** → runs dependency, Hard Lock, and conflict check (`IR-04`) → previews exact diff before committing.
- **Workflow Option B (Independent Exploration Branch):** Author explicitly clicks **`Open Alternative as Active Project`** from `Projects → Alternatives`, switching full project identity cleanly with a visible header badge (`Working in Alternative: Gazette Ending`).

### J-14 *(New Comparative Journey)*: Navigating a 100k-Word Novel with Presets, Pins & Deep Links (`UIRF-01/02/03/05`)
- **Workflow Option A (Preset + Pin Research Loop):** In a 45-chapter novel, author switches Layout Preset to **`Story Research`**, pins `Leyla`, `1954 Rule`, and `Ch. 2 §2` (`UIRF-02`), clicks deep links between `World → Timeline`, `Story Q&A`, and `Write` (`UIRF-03`), then hits **`Expand World`** (`UIRF-05`) to audit 110 characters full-width before clicking `← Restore Previous Layout`.
- **Workflow Option B (Keyboard-First `Cmd+K` Navigation):** Author stays in `Calm` Focus Mode (`Write`), presses `Cmd+K`, types `"kim biliyor"` or `"Ch. 32"`, jumps via `Alt+Enter` (Open Beside) to verify a fact without touching the mouse, and hits `Escape` to return straight to cursor.

### J-15 *(New Comparative Journey)*: Optional Cloudflare R2 Encrypted Cloud Backup & Restore-as-Copy (`OR-R2`, `WP06`)
- **Workflow Option A (Manual Verified Encrypted Snapshot):** Author enables optional `Cloudflare R2 Backup` in `Projects → Backup & Recovery` (completely independent of Workers AI embeddings), reviews explicit privacy/cost/encryption-key-recovery notice, saves recovery key safely, clicks **`Create Cloud Backup Now`** → truthful upload & manifest/digest verification → sees immutable versioned snapshot list.
- **Workflow Option B (Restore-as-Copy Verification):** Author selects an older R2 snapshot → clicks **`Inspect & Restore`** → default action **`Restore as Independent Copy ("Salt Ledger — Restored Nov 26")`** verifies digest & decrypts locally without overwriting the active project; automatic schedule/on-save remains strictly opt-in off by default.

---

## 3. Stress Matrix Across Nine Realistic Authoring Conditions

| Condition | Primary Stress Point | How Synthesized Architecture Handles It (Honest Scope) |
|---|---|---|
| **1. Short Story (1–3 scenes)** | Chrome & heavy world tools overwhelm brief prose | `Calm` single-pane default; outline & Story Map stay quiet until summoned; zero empty mandatory forms. |
| **2. 100k-Word Novel (40+ ch.)** | Flat outline lists, long scroll walls, silent truncation, slow scan | Collapsible Chapter→Scene tree; explicit scoped `Context Inspector` (`IR-02`) + segmented full scans with partial coverage disclosure; performance at 100k words marked `Unverified` for `WP02`/`WP04` benchmarking. |
| **3. Dense Cast (80–150+ entities)** | Graph hairball & `.slice(0, 80)` data loss (`UX-13`) | Full-width `World` (`UIRF-05`), tag/faction clustering, semantic zoom LOD, 1-hop ego isolation, honest paginated/virtualized directory (`05 §2.1`). |
| **4. Non-Linear Chronology** | Flashbacks scramble alphabetical sort & spoil reader | Dual-Track Timeline (`Reading Order ↔ Story Chronology` + `Undated` lane) + Dual-Axis As-Of Scrubber (`05 §2.4, §3`). |
| **5. Turkish & Multilingual Scripts** | English-only regexes (`UX-06`), `—` dialogue quotes, IME commits, suffix search | Explicit language-neutral chronology flags; existing IME guards preserved; Turkish `—` / `«»` heuristics in `Local Writing Insights`; Unicode/Turkish-aware local lexical index (`WP02`); RTL layout remains `Unverified`. |
| **6. First-Time vs. Experienced Author** | Either intimidating jargon OR dumbed-down ceilings | `Show Me How` (`UIRF-04`) static examples + plain literary labels (`UID-05`) in `Calm`, with full `Deep` density, `Workspace Presets`, `Cmd+K`, and technical provenance/audit always reachable. |
| **7. Offline / Unconfigured AI** | Dead-end errors or blocked local work | 100% local writing, formatted reading, World editing, local lexical search, local consistency checks, manual ideas, and ZIP backups work offline; clear `Offline · Local Tools Ready` indicator. |
| **8. Narrow Screen (`390×844` / `200%` Zoom)** | Hidden actions (`UX-05`), clipped tables, horizontal scroll | Top `Projects` anchor + 5-intent bottom bar preserves all 6 intents; Companion becomes single-pane `[Swap]`; zero horizontal scroll target (`02 §2.2`). |
| **9. Keyboard & Screen-Reader Accessibility** | Stripped focus rings (`UX-08`), visual-only graphs/diffs | Strict focus-visible ring contract, accessible HTML table/list equivalents for all 7 visualizations, non-color-only encoding, focus-trapped dialogs replacing `window.confirm` (formal audit planned in `06 §5`). |

---

## 4. Cross-References & Checkpoint Status

- **Completed in this file:** Canonical shared synthetic story (*The Salt Ledger / Tuz Defteri*), 15 journeys (`J-01`–`J-15`) comparing two plausible workflows each (correcting `ui-01`'s `J-03` miss honestly), and 9-condition stress matrix.
- **Next document:** [04 — Editor, Creative and Review Experiences](./04-editor-creative-and-review-experiences.md) specifies the detailed screen families, all 8 operational states, keyboard/responsive behavior, and zero-manual learning rules for `Write`, `Creative Studio`, `Story Development`, `Review`, and `Story Q&A`.
