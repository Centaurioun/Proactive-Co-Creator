# 03 — UX, Information Architecture, and User Journeys

**Assignment:** `PCC-RESEARCH-01`  
**Parent Index:** [`README.md`](./README.md)  
**Cross-References:** [`01-product-purpose-and-current-state.md`](./01-product-purpose-and-current-state.md) · [`02-functional-findings-and-root-cause.md`](./02-functional-findings-and-root-cause.md) · [`05-creative-product-discovery-and-concepts.md`](./05-creative-product-discovery-and-concepts.md) · [`06-recommendations-strategy-and-roadmap.md`](./06-recommendations-strategy-and-roadmap.md)

---

## 1. Dual-Persona Experience Assessment

A core requirement of PCC (Assignment §2, §8) is serving **both** a first-time user developing a short seed idea **and** a returning author managing a multi-chapter manuscript — without burying simple tasks under enterprise workflow machinery.

### 1.1 Persona A — First-Time Explorer (Idea Seed: *The Backward-Ticking Watch*)

**[Observed in actual preview]**

| Step | What the Writer Wants | What Actually Happens Today | Friction Diagnosis |
|---|---|---|---|
| 1. Opens PCC | Understand what PCC does in 5 seconds; try an idea or explore the sample story. | Lands on `Write` mode showing *Cat’s Woodland Dinner Party · 0 words*, a blank textarea, `"No sections match these filters."`, and briefly a disabled IndexedDB warning (`F-01`). | **Wrong first impression:** PCC looks like a broken empty Notepad instead of a proactive visual story studio. |
| 2. Switches to `Plan` | See the story visually and collaborate with AI to develop it. | Sees 7 stacked horizontal chrome bars compressing the Belief Graph to ~32% height; the signature **Decision Inbox** (`14` items) is **hidden behind a small button** (`F-12`). | **Core magic buried:** A first-time writer has no visual pull toward answering clarifying questions. |
| 3. Starts a new idea (`+ New`) | Type a one-sentence idea and get gentle help discovering characters/conflict. | Creates a project, must find `Analyze Idea`, wait ~24s, then manually open `Inbox`, parse `Canon / Belief / Inference / Proposed`, and choose between two `Generate Story` buttons. | **Ceremony overload:** 6+ clicks and engineering labels stand between an idea and creative momentum. |
| 4. Clicks `Generate Story` | Read a vivid draft shaped by their choices. | Waits 60s, receives `"The request was cancelled"` (`F-02`). Even when working, the generated story lands in a separate Output panel rather than an editable scene in `Write` (`F-07`). | **Dead end:** Generated prose is divorced from the actual `Write` editor. |

### 1.2 Persona B — Returning Long-Form Author (*Port Marrow*, 15 Chapters / 45,000 Words)

**[Confirmed by current source inspection]** **[Observed in actual preview]**

| Step | What the Author Wants | What Actually Happens Today | Friction Diagnosis |
|---|---|---|---|
| 1. Brings in an existing `.docx` draft | Drop the file in, start reading/editing immediately, and let AI map characters & clues. | Enters a 5-stage `ImportWorkflow` wizard (`Choose source → Inspect source → Analyze source → Review candidates → Choose destination & commit`), must confirm retention checkboxes, segmentation plans, and per-item approvals before seeing the story (`F-13`), and AI extraction currently fails or drops valid quotes (`F-04`). | **High wall at the front door:** Writers want to enter their workspace first and refine extracted facts progressively. |
| 2. Writes Chapter 12 and checks a character's eye color | Glance at Alden Voss's profile while drafting. | Must click `Save manuscript` first (otherwise `App.tsx:175` blocks switching tabs with a lockout banner, `F-11`), switch to `Plan`, click `Alden Voss` in the Directory, read traits, then switch back to `Write` and re-find their cursor position! | **Mode-switch penalty:** Looking up a single character fact breaks drafting flow completely. |
| 3. Uses AI Writing Assistant on a tense dialogue scene | Get voice-faithful continuations grounded in character relationships and prior chapter events. | Must scroll below the editor, expand a collapsed `<details>` accordion (`AI Writing Assistant (Selection-Aware · Review Before Applying)`), and receives suggestions generated with zero relationship or Chapter 11 context (`F-06`). | **Hidden & context-starved:** Valuable writing help is tucked out of sight and lacks story memory. |
| 4. Runs full-novel continuity review | Catch contradictions across all 15 chapters and jump to offending sentences. | Switches to `Review`, sees `"Preflight: 3,278 / 40,000 chars · ~820 / 14,000 est. tokens"`, runs `Full Project`, and is **never told** that Chapters 9–15 and text past 5,000 chars per chapter were silently omitted (`F-05`); findings lack passage highlights (`F-10`). | **Silent false confidence:** The author believes their whole novel was checked when more than half was invisible. |

---

## 2. Chrome Budget, Duplication, and Engineering-Leak Audit

### 2.1 Vertical Chrome Stack in `Plan` (`1440×900` Desktop) **[Observed in actual preview]**

In screenshot `02-plan-default.png`, seven horizontal control bars compete for vertical space:

1. **Global Header Bar** (`PCC`, project dropdown, `Saved · r1`, `+ New`, `Import`, `Projects`, `About`, `Sample data`, `Dark Theme`)
2. **Workspace Mode Bar** (`Write`, `Plan`, `Review`, `AI settings`)
3. **Plan Sub-Header Bar** (`Plan / narrative map`, `Inbox 14`, `Context`, `Read output`, `Story Bible`, `Opportunities`, `More views`)
4. **Epistemic Legend Strip** (`Canon confirmed · Belief held by a character · Inference interpretation · Proposed awaiting a decision · Questions stay in the inbox · Causation appears only in an explicit relationship`)
5. **Seed Box Header & Textarea** (`Original Story / Scene Seed · 89 seed · 527/8,000 compiled chars`, `Story Mode / Image Mode`, `Reanalyze Idea`, `Generate Story`)
6. **Graph Toolbar** (`Search...`, `All Types (5)`, `Highlight Links`, `Inferred: Shown`, `Group Guests`, `Excluded`, `Graph / Table / Ego Map / Family`)
7. **Persistent Bottom Footer Bar** (`Undo`, `Redo`, `14 pending · 1 rev`, `Accept All Pending (14)`, `Review Plan & Prompt`, `Show Prompt & Output`, `Story / Image`, `Generate Story`)

**Result:** At `900px` viewport height, the actual Belief Graph canvas receives **<300px (~32%)** of vertical height.

### 2.2 Redundant / Duplicated Entry Points Inventory

| Capability | Current Duplicated Locations | Recommended Single Home |
|---|---|---|
| **Generate Story / Draft** | Seed card top-right CTA **AND** bottom footer primary CTA | **One** contextual action (e.g., *"Draft Scene"* / *"Generate"* in workspace header or Prompt preview) |
| **Story / Image Mode Toggle** | Seed card toggle **AND** bottom footer toggle | **One** secondary toggle (kept subtle/optional since Story is primary per Assignment §2) |
| **Story Bible** | Plan top bar button **AND** Right Inspector tab | **One** unified World/Bible panel (never duplicated in two chrome rows) |
| **Opportunities / Ideas** | Plan top bar (`Opportunities`) **AND** Right Inspector tab (`Ideas`) **AND** Review header (`Creative Opportunities`) | **One** contextual Ideas/Opportunities surface |
| **Consistency Checks** | Plan Right Inspector (`Checks (0)`) **AND** Review (`Narrative Diagnostics`) | **One** unified Continuity & Checks drawer/view |
| **Revision History** | Plan Right Inspector (`History`) **AND** Review header (`Revision History`) **AND** Project Hub (`Revision history`) | **One** History drawer accessible from the save/version indicator (`Saved · v1`) |
| **Generated Outputs** | Plan top bar (`Read output`) **AND** bottom footer (`Show Prompt & Output`) **AND** Review (`Output Gallery`) | **One** Drafts/Outputs drawer (with 1-click *"Move to Manuscript"*) |
| **Inbox Header** | Outer card header (`Decision inbox 14 pending`) **AND** inner panel header (`Decision Inbox 14 pending · 0 confirmed`) | **One** single header |

### 2.3 Engineering-to-Writer Terminology Audit

Writers should never need to learn software-engineering or formal-logic terminology to write a story (Assignment §2, §8):

| Current UI Copy | Why It Confuses Writers | Writer-Friendly Replacement |
|---|---|---|
| `Saved · r1` / `Revision #1` | Database revision counter leaks into header. | `Saved` (clicking opens *Version History*) |
| `Narrative evidence key: Canon / Belief / Inference / Proposed / Questions / Causation` | Six-term ontology banner permanently occupies full screen width. | Remove permanent strip; show plain-language badges only on hover/card (`Confirmed`, `Character believes`, `AI suggestion`, `Needs decision`). |
| `527/8,000 compiled chars` & `Preflight: 3,278 / 40,000 chars · ~820 / 14,000 est. tokens` | Exposes compiler internals and token math permanently inline. | Hide behind a subtle `Details` / `Usage` tooltip unless approaching a limit. |
| `Writing requires available IndexedDB and a verified workspace load.` | Browser storage API jargon shown during normal load. | `Loading your workspace…` (and only if storage genuinely fails: *"Browser storage is blocked. Export a backup copy to keep your work safe."*) |
| `Story Elements Directory` / `Ego Map` | Technical graph-theory jargon (`Ego Map`, `1-hop`, `2-hop`). | `Cast & World` / `Character Web` (`Direct links` / `Extended links`) |
| `Markdown remains literal source text; preview displays it safely without interpreting HTML.` | Security specification copy sitting directly above the writer's prose cursor! | Remove from writing canvas; keep in About/Help if needed. |
| `Decision Inbox` | Feels like corporate email/admin triage rather than creative discovery. | `Open Questions & Ideas` (or `Story Decisions`) |
| `AI Writing Assistant (Selection-Aware · Review Before Applying)` | Parenthetical technical disclaimers clutter the label. | `Writing Partner` (with calm inline review preview) |
| `No sections match these filters.` (on 0 sections) | Blames filters when the manuscript is simply empty. | `Your manuscript is empty. Start Chapter 1, draft from your Story Map, or import text.` |

---

## 3. Competing Information Architecture Options Compared

Per Assignment §8 and §10, we compare three genuinely distinct IA strategies rather than assuming the current `Write / Plan / Review` layout should be preserved unchanged.

### Option A — Incremental Polish of Current `Write / Plan / Review` Modes
- **Structure:** Keep the 3 top-level modes (`Write`, `Plan`, `Review`), remove duplicated buttons, collapse the seed box + evidence legend, unhide Inbox selectively, add autosave so mode switches don't lock, and fix the 4 fake visual views.
- **Pros:** Lowest migration cost; preserves mental model of existing users; low regression risk on existing Playwright/unit tests.
- **Cons:** **Does not solve the fundamental Split-Brain Problem (`F-07`)** — writers still cannot consult character notes, relationships, or continuity whispers *while drafting* without leaving `Write`; `Review` remains an isolated "audit room" writers forget to visit until late.

### Option B — Unified Two-Surface "Story Studio" (`Write` + `World`) with Persistent Contextual Margin *(Recommended)*
- **Structure:** Collapse 3 rigid modes + 7 chrome bars into **two calm primary canvases** plus **one collapsible right-hand Co-Creator Margin** that follows the writer everywhere:
  1. **`Write` (Manuscript Canvas):** Clean distraction-free prose editor + collapsible Outline on the left. On the right, a lightweight **Context Margin** dynamically shows the *characters, relationships, open questions, continuity whispers, and Writing Partner* relevant to the **active scene** — zero tab switching required!
  2. **`World` (Interactive Visual Canvas):** Full-bleed (`≥70%` viewport height) interactive visual space with a single clean view switcher (`Story Map` [Belief Graph + Radial Character Web], `Timeline` [true visual Dual-Track], `Story Bible`, `Board/Outline`). Proactive questions slide smoothly into the Margin when relevant.
  3. **`Review` & `History` become focused overlays/drawers or a clean Review Lens** — continuity issues surface **both** inline as gentle margin markers in `Write` AND in a consolidated **Review & Sync Checklist** when the author wants a full editorial pass.
- **Pros:** Directly resolves both personas! A first-time seed explorer enters `World` with an inviting Seed + Guided Questions Margin (`≥70%` visual map); a novelist lives in `Write` with instant cast/relationship/continuity visibility beside their prose. Eliminates 60%+ of visual chrome and all duplicated buttons.
- **Cons:** Moderate frontend restructuring; requires consolidating `AdaptivePlanWorkspace` and `ManuscriptEditor` around shared scene-context state.

### Option C — Linear Stage-Gated Workspace (`1. Seed → 2. Develop → 3. Draft → 4. Revise`)
- **Structure:** Guide users sequentially through four numbered creative stages, showing only stage-specific tools in each step.
- **Pros:** Very approachable for absolute beginners starting from scratch.
- **Cons:** **Hostile to real writing practice.** Creative writing is nonlinear — novelists brainstorm Chapter 9 while revising Chapter 2, import half-finished drafts, or jump straight into dialogue. Rigid staging recreates the friction already seen in `ImportWorkflow`'s 5-step wizard (`F-13`).

### IA Strategy Decision Matrix

| Criterion | Option A (Polish Current) | Option B (Unified Story Studio) | Option C (Linear Stages) |
|---|---|---|---|
| Solves First-Time Seed Discovery | Medium | **High** | High |
| Solves Long-Form Drafting Flow | Low–Medium | **High** | Low |
| Eliminates Chrome & Duplication | Medium | **High** | Medium |
| Preserves Nonlinear Creative Freedom | High | **High** | Low |
| Engineering Complexity / Risk | Low | Medium | Medium–High |

**Recommendation:** **Option B (Unified Two-Surface Story Studio with Contextual Margin)** offers the highest writer-value return while preserving every underlying safety invariant and data structure of PCC.

---

## 4. Conceptual Wireframes & Before/After Journeys (Option B)

### 4.1 Wireframe — `Write` Surface with Contextual Margin (`1440×900`)

```
┌──────────────────────────────────────────────────────────────────────────────────┐
│ PCC  [Port Marrow ▾]  Saved        ( Write | World )   [Review 3] [Import] [⚙]   │
├───────────────┬─────────────────────────────────────────┬────────────────────────┤
│ OUTLINE       │ Chapter 2: The Evening Auction          │ SCENE MARGIN           │
│ + Chapter     │ POV: Alden · Port Marrow · Dusk Tue     │ [Cast] [Partner] [3!]  │
│ + Scene       │ ─────────────────────────────────────── │ ────────────────────── │
│               │ Two hours later, just after dusk on     │ IN THIS SCENE          │
│ ▾ Part I      │ Tuesday, Tomas Reed stepped into the    │ • Alden Voss           │
│   Ch 1 Ledger │ narrow workshop carrying a leather      │   68 · pale gray eyes  │
│ ▸ Ch 2 Auction│ satchel. Alden looked up, his [dark     │   ↳ estranged uncle of │
│   Ch 3 Harbor │ brown eyes]¹ narrowing as the brass     │     Nadia Kestrel      │
│               │ pocket watch suddenly clicked twice     │ • Tomas Reed           │
│               │ counterclockwise inside his waistcoat.  │   ↳ seeks Brass Watch  │
│               │                                         │                        │
│               │                                         │ CONTINUITY WHISPER (1) │
│               │                                         │ ¹ Eye color mismatch:  │
│               │                                         │   Model & Ch 1 say     │
│               │                                         │   "pale gray eyes".    │
│               │                                         │   [Preview fix] [Keep] │
│               │                                         │                        │
│               │                                         │ WRITING PARTNER        │
│               │ [Focus Mode]           428 words        │ [Continue] [Dialogue]  │
│               │                                         │ [3 Alternatives]       │
└───────────────┴─────────────────────────────────────────┴────────────────────────┘
```

### 4.2 Wireframe — `World` Surface (Full-Bleed Visual Canvas, `1440×900`)

```
┌──────────────────────────────────────────────────────────────────────────────────┐
│ PCC  [Port Marrow ▾]  Saved        ( Write | World )   [Review 3] [Import] [⚙]   │
├─────────────────────────────────────────────────────────┬────────────────────────┤
│ [Story Map] [Timeline] [Story Bible]     🔍 Search  [+ ] │ CO-CREATOR MARGIN      │
├─────────────────────────────────────────────────────────┤ [Questions 4] [Inspect]│
│                                                         │ ────────────────────── │
│    ┌──────────────┐   estranged uncle   ┌────────────┐  │ Open Question (1 of 4) │
│    │  Alden Voss  │────────────────────▶│   Nadia    │  │ What happened the      │
│    │  Horologist  │                     │  Kestrel   │  │ night the breakwater   │
│    └──────┬───────┘                     └─────┬──────┘  │ lantern failed?        │
│           │ owns                              │         │                        │
│           ▼                                   │         │ ○ Alden falsified the  │
│    ┌──────────────┐   seeks to buy    ┌───────┴──────┐  │   repair log           │
│    │ Brass Watch  │◀ - - - - - - - - -│  Tomas Reed  │  │ ○ Tomas sabotaged the  │
│    │ (anti-lie)   │                   │  Auctioneer  │  │   clockwork gear       │
│    └──────────────┘                   └──────────────┘  │ ○ Custom answer…       │
│                                                         │                        │
│   [Filter: All ▾]  [Perspective: Canon ▾]   [-][+][Fit] │ [Ask AI to edit map…]  │
└─────────────────────────────────────────────────────────┴────────────────────────┘
  (Canvas occupies ~75% of viewport height; 1 primary header bar + 1 slim sub-bar)
```

### 4.3 Concrete Before / After Journeys

#### Journey 1 — Turning a One-Sentence Idea into Chapter 1
- **Before (Today):** Land on empty `Write` → notice `Plan` → click `+ New` → enter seed → click `Reanalyze Idea` → wait 24s → click hidden `Inbox` button → answer questions → click `Generate Story` (currently times out at 60s; even if it works, story is trapped in an Output modal, not in `Write`).
- **After (Proposed):** Click `+ New` → enter seed → land immediately on `World` with the Belief Graph growing live alongside 3 focused opening questions in the Margin → answer 2 questions (watching nodes/edges update) → click **"Draft Opening Scene in Write"** → streams directly into Chapter 1 in `Write`, where the writer edits prose immediately with full cast/relationship memory in the Margin.

#### Journey 2 — Checking a Character Detail Mid-Sentence
- **Before (Today):** Typing in `Write` → click `Plan` → blocked by dirty-draft lockout (`F-11`) → click `Save manuscript` → click `Plan` → find character in right directory → read trait → click `Write` → lose scroll/cursor position.
- **After (Proposed):** Glance right at the **Scene Margin** (already showing characters mentioned in the active scene + their confirmed traits and relationships), or hover/click the character name — **0 mode switches, 0 interruptions, automatic background save**.

#### Journey 3 — Importing an Existing Short Story
- **Before (Today):** Click `Import` → paste text → click `Inspect source` → configure strategy/scope/categories → click `Analyze source` (currently fails or drops valid quotes) → tick checkboxes across candidates → fill project name → click `Commit import`.
- **After (Proposed):** Click `Import` → drop file or paste text → click **"Open in Workspace"** (instant 1-click entry into `Write` with chapter splitting!) → optional non-blocking banner offers **"Map characters & continuity in background"** → extracted cards appear gently in the Margin for click-to-confirm with verbatim in-text highlighting.

---

## 5. Consolidation & Removal Candidates (Preserving Value)

| Current Element | Action | How Value Is Preserved |
|---|---|---|
| Permanent 6-item `Narrative evidence key` strip | **Remove strip** | Surface plain-language provenance badges directly on cards & node tooltips where relevant. |
| Duplicate bottom footer bar in `Plan` | **Remove bar** | Move `Undo`/`Redo` to subtle canvas corner controls; keep a single `Draft / Generate` action and single `Preview Prompt` button inside World header. |
| Separate `Plan > Checks` tab vs. `Review > Diagnostics` | **Consolidate** | One unified Diagnostics drawer/view fed by both local structural checks and semantic AI checks. |
| Separate `Opportunities` top button vs. `Ideas` inspector tab vs. `Review > Opportunities` | **Consolidate** | One contextual Ideas tab inside the Margin & Review. |
| Flat-list `Ego Map` and `Family` sub-tabs | **Consolidate into Story Map** | Make Ego Focus (click node → *"Focus neighborhood"*) and Kinship Filter (*"Family ties only"*) interactive lenses on the real visual canvas! |
| Static 5-box `Mind Map` card grid | **Retire / Replace** | Replace with Story Bible + true spatial Story Map clustering (no fake "mind map" label). |
| `Image Mode` prominence on every Plan bar | **Demote to secondary menu** | Preserve image generation cleanly under a `Visuals / Concept Art` drawer action without cluttering every writing screen (Assignment §2). |

---

## 6. Accessibility, Feedback & Responsiveness Findings

- **Keyboard & Focus Management:** Interactive controls use clear focus rings (`focus-visible:ring-2`), and `AI settings` opens as a modal overlay; however, the `7`-bar layout in `Plan` creates dozens of tab stops before reaching the graph canvas or prose editor **[Observed in actual preview]**.
- **Loading & Failure Feedback:** Long AI calls (`15–60s`) currently give no streaming progress, making slow responses look frozen; `F-02` mislabels timeouts as user cancellations (`"The request was cancelled"`), and transient `503` errors need one-click in-place retry preserving form inputs.
- **Mobile Responsiveness (`390×844`):** `Import` button is hidden on narrow viewports (`hidden sm:inline-flex` observed in DOM snapshot!), forcing mobile users to hunt inside `Projects` to import a story; stacking the 7 horizontal bars on a `390px` screen pushes the primary workspace far below the fold. Consolidating chrome under Option B directly improves mobile usability as well.
