# 05 — Independent Creative Product Discovery & Original Concepts

**Assignment:** `PCC-RESEARCH-01`  
**Parent Index:** [`README.md`](./README.md)  
**Cross-References:** [`01-product-purpose-and-current-state.md`](./01-product-purpose-and-current-state.md) · [`03-ux-ia-and-user-journeys.md`](./03-ux-ia-and-user-journeys.md) · [`04-ai-quality-narrative-intelligence-and-architecture.md`](./04-ai-quality-narrative-intelligence-and-architecture.md) · [`06-recommendations-strategy-and-roadmap.md`](./06-recommendations-strategy-and-roadmap.md)

---

## 1. Rethinking PCC From First Principles as a Writer

Most AI writing tools fall into two unsatisfying extremes:
- **Linear Chat Windows (ChatGPT, Claude, Gemini web):** Great for brainstorming a paragraph, terrible for sustaining a 40,000-word world. Context scrolls off screen, decisions evaporate into chat history, and the AI confidently invents or forgets canon unless the writer constantly re-pastes notes.
- **Static Word Processors & Binders (Scrivener, Word, Notion):** Give the writer complete control and organization, but are completely *passive* — they cannot see that a character's eye color changed in Chapter 9, cannot notice an underused relationship tension, and cannot ask a sharp developmental question at the exact moment a scene stalls.

**PCC's unique opportunity** lies in the unclaimed territory between them: **a visual, epistemically honest, narrative-aware creative studio** where the story's world *lives alongside the prose* and collaborates proactively without ever hijacking authorship.

Below are **eight independent product concepts** developed across Cycles 3–5. Per Assignment §7 and §10, concrete near/mid-term proposals (`C-01`–`C-07`) are explicitly separated from exploratory R&D hypotheses (`C-08`). All concepts are tagged **[Exploratory product proposal]** and grounded in concrete synthetic narrative walkthroughs.

---

## 2. Concrete Product Concepts (Near- to Mid-Term)

### `C-01` — Living Story Pulse & Inline Margin Co-Creator
**Classification:** Concrete Proposal · **[Exploratory product proposal]**

- **Problem Solved:** Writers currently face a jarring split between drafting in `Write`, inspecting characters in `Plan`, and checking continuity in `Review` (`F-06`, `F-07`, `F-11`). Valuable narrative intelligence sits idle in other tabs while the writer drafts blind.
- **Concrete Walkthrough (*Port Marrow — Chapter 2*):**  
  The author is drafting Chapter 2 in `Write`. As they type *"Alden looked up, his dark brown eyes narrowing as the brass pocket watch clicked twice counterclockwise"*, the collapsible right **Story Margin** automatically updates (via fast deterministic entity-name matching — zero AI calls on every keystroke!) to display compact cards for **Alden Voss**, **Tomas Reed**, and **The Brass Pocket Watch**, including Alden's confirmed traits (`68 · pale gray eyes`) and his relationship to Nadia (`estranged uncle of`).  
  When the writer pauses or clicks **"Check this scene"**, a gentle margin card appears next to paragraph 1:
  > *Continuity whisper · Ch. 2:* You wrote *"dark brown eyes"*, while Canon & Ch. 1 say *"pale gray eyes"*.  
  > `[Change to pale gray]` `[Update canon to dark brown]` `[Intentional / Ignore]`
  
  Below it, one unobtrusive **Proactive Spark** reads: *"Tomas just denied meeting Nadia while the watch ticked twice. Want to explore how Nadia reacts before speaking?"* Clicking it opens 3 voice-matched options right in the margin — never overwriting the draft.
- **Novel Value vs. Chat & Static Tools:** Eliminates copy-pasting character sheets into chat AND eliminates mode-switching into separate Story Bible folders. The narrative model actively serves the sentence the writer is composing right now.
- **Relationship to Existing Capabilities:** Connects existing `ManuscriptEditor`, `WritingAssistantPanel`, `BeliefGraph` entities/relationships, and `Diagnostics` into one calm margin surface (see Option B wireframe in [`03`](./03-ux-ia-and-user-journeys.md#41-wireframe--write-surface-with-contextual-margin-1440900)).
- **Drawbacks & Failure Modes:** Too many proactive popups feel like "Clippy" and ruin writing flow. **Mitigation:** Deterministic entity-card lookup is silent and passive; AI continuity checks and sparks are strictly opt-in or gently badged (never interrupting typing), and `Focus Mode` hides the margin completely.
- **Competing Alternatives:** Inline Grammarly-style red underlines directly inside prose (more distracting for creative first drafts; margin cards keep the manuscript visually pure).
- **Technical Implications:** Requires lightweight local `EntitySceneMap` indexing (`04 §4.2`), enriched `WritingAssistRequestSchema` (`F-06`), and deterministic quote-to-offset highlighting (`F-10`).

---

### `C-02` — Epistemic Perspective Lenses ("Who Knows What?")
**Classification:** Concrete Proposal · **[Exploratory product proposal]**

- **Problem Solved:** PCC already contains a rare, sophisticated epistemic model (`explicit`, `interpretation`, `belief`, `reported`, `ambiguous`, `user-authored`), yet today it is exposed only as a dry academic legend strip (`Canon / Belief / Inference / Proposed / Questions / Causation`) that baffles writers (`03 §2.3`) and is actually *stripped out* before Diagnostics/Sync (`F-05`)! Writers of mysteries, thrillers, romance, and multi-POV fiction desperately need a way to track **information asymmetry** — who knows a secret, who believes a lie, and when a character learns the truth.
- **Concrete Walkthrough (*Port Marrow*):**  
  On the **World Story Map** (or in the **Scene Margin**), the writer clicks a clean dropdown: **`Perspective: World Canon ▾`** and switches it to **`Perspective: Nadia Kestrel`** or **`Perspective: Alden Voss`**.
  - In **World Canon** view: *Tomas Reed secretly seeks the watch* (Confirmed); *Breakwater lantern sabotage* (Confirmed: Tomas).
  - In **Nadia Kestrel's Lens**: *Tomas bribed harbor master* displays as **"Heard rumor (unverified)"**; *Alden's pocket watch detects lies* displays as **"Unknown to Nadia"** (dimmed/dashed); *Tomas's true motive* displays as **"Hidden from Nadia"**.
  - In **Alden Voss's Lens**: *Nadia's motive* displays as **"Suspects: wants to confiscate watch (Belief — contradicts Nadia's true motive!)"**.
  - When writing Chapter 4 from Nadia's POV, the Margin warns: *"Reminder: Nadia does not yet know the watch ticks backward on lies (established only in Alden's POV in Ch. 1)."*
- **Novel Value vs. Chat & Static Tools:** **Zero conventional writing apps offer interactive dramatic-irony / epistemic-lens visualization.** This turns PCC's most distinctive backend concept into an unforgettable, deeply practical creative superpower for mysteries, literary fiction, and complex plots.
- **Relationship to Existing Capabilities:** Directly unlocks `EpistemicKind` (`shared/types.ts:17`) and `narrative.claims[]`, replacing the confusing permanent legend bar with an interactive, writer-native lens.
- **Drawbacks & Failure Modes:** Over-engineering epistemic graphs can become tedious data entry if writers must manually tag every belief. **Mitigation:** Keep tagging effortless — default everything to plain story facts, and let writers (or AI import/sync) optionally tag a rumor/secret with `"Held by: [Character]"` only when dramatic irony matters.
- **Competing Alternatives:** Manual spreadsheets of "POV Knowledge per Chapter" (high maintenance, never cross-checked against drafted prose).
- **Technical Implications:** Add optional `holderEntityId` and `learnedInSectionId` to `EpistemicNarrativeClaim` (`04 §4.3`), stop stripping `belief`/`reported` records in `buildCompactReviewModelPayload` (`F-05`), and add a visual filter mode to `BeliefGraphCanvas`.

---

### `C-03` — True Visual Storyboard, Causal Dual-Track Timeline & Interactive Spatial Graph Lenses
**Classification:** Concrete Proposal · **[Exploratory product proposal]**

- **Problem Solved:** Four of PCC's five named visual tools (`Timeline`, `Mind Map`, `Ego Map`, `Family`) are currently flat HTML lists/tables (`F-08`), and `Timeline` sorts chronology alphabetically via `localeCompare`. Writers cannot actually *see* story structure, flashbacks, character arcs, or kinship webs.
- **Concrete Walkthrough (*Port Marrow*):**
  1. **Dual-Track Visual Timeline:** Horizontal canvas with two synced tracks: **Reading Order (Top)** (`Ch 1 → Ch 2 → Ch 3 [Flashback: Breakwater Night] → Ch 4`) and **Story Chronology (Bottom)** (`4 Years Ago: Breakwater Lantern → Autumn: Manifest Dispute → Tuesday Dusk: Workshop Auction`), connected by clean curved arcs showing flashbacks and foreshadowing! Dragging a scene card reorders Narrative Order or explicit Chronology Position (`chronologyOrder: number`), while character badges show which cast members appear in each beat.
  2. **Interactive Graph Lenses on One Canvas (Retiring Fake Text Lists):** Instead of switching to separate text-list tabs for `Ego Map` and `Family`, clicking **Alden Voss** on the main visual Story Map offers a **`Focus Web (1-hop / 2-hop)`** pill that smoothly isolates Alden's radial neighborhood right on the SVG canvas, and a **`Family Ties`** lens highlights confirmed kinship edges in a layered lineage diagram (honestly rendering cycles with dashed arcs).
  3. **Scene Storyboard Cards:** Optional index-card grid view of `Working Manuscript` sections showing Title, POV, Location, Synopsis, Status (`Draft / Revised / Final`), and open continuity badges.
- **Novel Value vs. Chat & Static Tools:** Combines Scrivener's visual corkboard and Aeon Timeline's dual-track chronology with live AI continuity & Belief Graph linkage — clicking any node or timeline beat jumps straight to the exact manuscript passage.
- **Relationship to Existing Capabilities:** Replaces `TimelinePanel.tsx`, `EgoMapView.tsx`, `FamilyKinshipView.tsx`, and `MindMapPanel.tsx` (`F-08`) with genuine visual projections over the same canonical model.
- **Drawbacks & Failure Modes:** Complex visual canvases degrade on small screens and large casts (50+ nodes). **Mitigation:** Always preserve a clean accessible **Table / Outline fallback**, provide semantic zoom/cluster collapse, and keep canvas interaction crisp via SVG/Canvas virtualization.
- **Competing Alternatives:** Exporting to external diagramming tools (Miro, Plottr, Aeon Timeline) — breaks synchronization between map and manuscript.
- **Technical Implications:** Add explicit `chronologyOrder` & `chronologyGroup` fields to `sectionSchema` (replacing `localeCompare`), and build radial/layered layout engines directly in the visual canvas component.

---

### `C-04` — "What-If" Narrative Forking & Ripple-Effect Sandboxes
**Classification:** Concrete Proposal · **[Exploratory product proposal]**

- **Problem Solved:** Mid-way through a story, writers often wonder *"What if I kill this mentor in Act 1 instead of Act 2?"* or *"What if Nadia is secretly working for Tomas?"* Today, trying an alternate plot choice mutates the live project (forcing clunky manual Undo or full project duplication) and provides zero visibility into which existing scenes and relationships would break.
- **Concrete Walkthrough (*Port Marrow*):**  
  The author clicks **`Explore What-If…`** on the relationship `Alden Voss -[estranged uncle of]-> Nadia Kestrel` (or in `World` / `Opportunities`) and types: *"What if Nadia is actually working with Tomas Reed to steal the watch, and only pretending to investigate him?"*  
  PCC opens an isolated, non-destructive **Sandbox Branch** (never touching the canonical project):
  - **Graph Diff Preview:** Shows proposed relationship flips (`Nadia -[secretly allied with]-> Tomas`), updated motivations, and new secrets.
  - **Manuscript Ripple Map:** Scans existing chapters via the `Narrative Memory Index` and lists exact impacted scenes:
    - *Ch. 1 (p. 2):* Nadia's line *"she had found no ledger entry to prove it"* now becomes deceptive subtext — **needs slight internal-monologue check** (keep Alden's POV intact!).
    - *Ch. 2 (p. 3):* Nadia publicly contradicting Tomas in front of Alden would now be staged theater or must be rewritten.
  - **2–3 Side-by-Side Micro-Scenes:** Lets the writer test-read how the new premise feels in 150 words before deciding: **`Adopt into Canon`** (atomic revision with full Undo), **`Keep as Alternate Branch`**, or **`Discard`**.
- **Novel Value vs. Chat & Static Tools:** Conventional chat can brainstorm a twist, but **cannot map its exact structural ripple effects across an existing multi-chapter manuscript and relationship web**, nor commit selected changes atomically with provenance.
- **Relationship to Existing Capabilities:** Elevates existing `OpportunityCenter` (currently static text cards) and `BatchEditEngine` / `Sync` into an interactive creative simulation tool while preserving PCC's atomic revision & Undo architecture.
- **Drawbacks & Failure Modes:** Multi-branch version trees can overwhelm casual writers ("Git for novelists" trap). **Mitigation:** Keep sandboxes lightweight and ephemeral by default (1 active exploration sandbox at a time, or simple named Snapshots — never full Git merge semantics).
- **Competing Alternatives:** Manual `"Save As Copy"` project duplication (no side-by-side ripple diff, easy to lose track of which copy is canonical).
- **Technical Implications:** Reuses immutable `ProjectSnapshot` cloning + `SectionContextIndex` impact retrieval + 1 bounded AI ripple-analysis call.

---

### `C-05` — Gentle Guided Seed-to-Scene Studio ("Discovery Interview + Live Sketch")
**Classification:** Concrete Proposal · **[Exploratory product proposal]**

- **Problem Solved:** When a writer arrives with a vague one-sentence premise (*"A retired watchmaker discovers a brass pocket watch that ticks backward whenever someone lies nearby"*), today's PCC dumps them into an empty `Write` screen (`F-01`) or overwhelms them with 14 pending inbox checkboxes + 7 toolbars (`F-12`) + a 60s `Generate Story` timeout (`F-02`).
- **Concrete Walkthrough (*The Backward-Ticking Watch*):**  
  Clicking **`+ Start from an Idea`** opens a calm, uncluttered 2-column studio:
  - **Left (Conversation-Light Discovery):** The writer types their 1-sentence seed. Within ~5–8 seconds, PCC displays the live **World Sketch** on the right (3–4 glowing cards: *Watchmaker*, *Brass Watch*, *Workshop*) and asks **ONE high-leverage creative question at a time** (not a wall of 14 pending checkboxes!), focusing on *dramatic tension* rather than generic genre trivia:
    - *Question 1:* *"Who tells the first lie that makes the watch tick backward — and why does it hurt the watchmaker?"* (3 vivid, non-cliché options + *"My own idea…"* + *"Surprise me"*).
    - As the writer picks *"His estranged niece, visiting after four years of silence"*, the right-hand **Story Map** visibly sprouts the `Nadia` node and `estranged niece` edge immediately!
    - *Question 2:* *"What's the cost or limitation of the watch's power?"* (e.g., *"It only ticks backward for lies the speaker knows are lies — sincere delusions stay silent"*).
  - After just 2–3 answers (or anytime the writer feels sparked), one button appears: **`Draft Opening Beat in Write`** — which streams a grounded, editable 300-word opening scene directly into `Chapter 1` of the Working Manuscript!
- **Novel Value vs. Chat & Static Tools:** Recaptures the exact magic that made Era 1 PCC special — watching a tiny seed bloom visually in real time — while seamlessly transitioning into real editable manuscript authoring rather than a dead-end generated-text box.
- **Relationship to Existing Capabilities:** Streamlines `analyze`, `clarify`, `DecisionInboxPanel`, and `generateStoryText` into a joyful, low-friction onboarding loop; full Belief Graph & Story Bible remain 1 click away.
- **Drawbacks & Failure Modes:** Experienced plotters who already have a detailed outline don't want a forced interview. **Mitigation:** Always offer three clear, equal starting doors on `+ New`: *(1) Develop an Idea*, *(2) Start Writing Blank*, *(3) Import Existing Story*.
- **Competing Alternatives:** Blank form templates ("Enter Genre, Enter Tone, Enter Protagonist") — feels like homework and kills creative spark.
- **Technical Implications:** Requires fast streaming `generate/story` with bounded thinking (`F-02`), single-question-focused progressive inbox mode, and 1-click artifact-to-manuscript section insertion (`F-07`).

---

### `C-06` — Dialogue Voice, Subtext & Rhythm Workbench
**Classification:** Concrete Proposal · **[Exploratory product proposal]**

- **Problem Solved:** Fiction writers spend huge amounts of time making characters sound distinct and layering subtext under dialogue — yet standard "Rewrite for clarity" AI buttons notoriously **flatten every character into the same polite, explanatory AI voice**.
- **Concrete Walkthrough (*Port Marrow — Chapter 2 Dialogue*):**  
  The author highlights the 12-line confrontation between Alden (68, taciturn craftsman), Nadia (guarded inspector), and Tomas (smooth auctioneer) in `Write`, and opens **`Voice & Subtext`** in the Writing Partner margin:
  - **Voice Distinctness Check (Grounded in Canon + Style Profile):** Shows a concise, non-scored observation: *"Alden and Tomas both use formal 18-word explanatory sentences here. Based on Alden's confirmed profile (spare craftsman, distrusts speech), his reply could be shorter and anchored in a physical action with the watch."*
  - **Subtext Mode:** Lets the writer specify *"What Alden is actually hiding: he fears Nadia came to seize the watch"* and generates 2–3 dialogue alternatives where characters speak *around* the truth rather than stating their feelings on the nose.
  - **Read-Aloud Cadence View (Deterministic Local Tool — Zero AI Cost!):** Highlights sentence-length rhythm variations and repeated dialogue tags/crutch words directly inside a clean preview overlay.
- **Novel Value vs. Chat & Static Tools:** Leverages PCC's structured character traits, relationships, and secrets (`C-02`) to protect and sharpen character voice rather than homogenizing prose.
- **Relationship to Existing Capabilities:** Deepens existing `WritingAssistantPanel` (`dialogue` action) and `StyleProfilePanel` (which is currently underused and hidden in a `<details>` block).
- **Drawbacks & Failure Modes:** Over-prescriptive voice advice can annoy authors who intentionally break pattern. **Mitigation:** Frame strictly as *observations & selectable alternatives*, never numeric "voice scores" (honoring PCC's explicit anti-scoring principle).
- **Competing Alternatives:** Generic prose-editing tools (ProWritingAid, Grammarly) — check grammar/readability without understanding character relationships or hidden secrets.
- **Technical Implications:** Adds `dialogue_subtext` mode to `WritingAssistRequestSchema`, passes per-character traits + relationships + character beliefs, and adds a lightweight deterministic sentence-rhythm highlighter in the client.

---

### `C-07` — Progressive Zero-Ceremony Manuscript Ingestion ("Read & Write First, Map Progressively")
**Classification:** Concrete Proposal · **[Exploratory product proposal]**

- **Problem Solved:** Today's 5-step `ImportWorkflow` forces a writer bringing an existing `.docx`/`.txt`/`.pdf` manuscript through retention checkboxes, segmentation plans, full-chunk AI extraction, and bulk candidate approval *before* they can even read or edit their story inside PCC (`F-13`), and breaks if extraction fails (`F-04`).
- **Concrete Walkthrough (*Importing a 12-Chapter Draft*):**
  1. The writer drags a `.docx` or pastes text into PCC.
  2. **In <1 second**, PCC preserves the immutable original source record, splits chapters cleanly, and opens the manuscript directly in **`Write`** — immediately readable and editable!
  3. A calm top banner offers: **`Map your story world?`** with two transparent choices:
     - *Map Chapter 1 now (fast preview, 1 AI call)*
     - *Map full manuscript progressively (chapters queued cleanly with live progress; keep writing while it runs)*
  4. As each chapter finishes extracting (using deterministic quote-to-offset anchoring, `04 §4.4`), newly discovered characters, relationships, and possible ambiguities appear in the **Margin** with click-to-highlight verbatim quotes in the text. Confirmed items flow smoothly into the visual Story Map; unreviewed items stay clearly labeled *Suggested from Ch. 1* and never pollute canon.
- **Novel Value vs. Chat & Static Tools:** Preserves 100% of PCC's faithful-extraction and immutable-source guarantees while cutting time-to-workspace from 5–10 minutes of wizard friction down to **1 second**.
- **Relationship to Existing Capabilities:** Reuses existing `sourceParser.ts`, immutable `narrative.sources[]`, `analysisCheckpoints.ts`, and `assembleProject.ts`, decoupling *ingestion* (instant, deterministic) from *semantic extraction* (progressive, non-blocking).
- **Drawbacks & Failure Modes:** If a user edits Chapter 1 *while* Chapter 1 extraction is in flight, offsets can drift. **Mitigation:** Anchor extracted quotes against the immutable source snapshot + re-anchor onto working text via exact quote matching (`NarrativeAnchor.status: 'exact' | 're-anchored' | 'drifted'`, `04 §4.3`).
- **Competing Alternatives:** Keeping the blocking 5-step modal wizard (safer only in appearance; drives high user abandonment before value is ever seen).
- **Technical Implications:** Decouple `buildSourceOnlyImportedProject` as the default immediate commit path; run `extractionService` (with fixed `F-04` anchor resolution & `4096+` output tokens) asynchronously per chapter with checkpoint persistence.

---

## 3. Exploratory Hypotheses (Longer-Term R&D)

### `C-08` — Spoiler-Free "First-Time Reader" Experience Simulator *(Exploratory Hypothesis)*
**Classification:** Exploratory Hypothesis · **[Exploratory product proposal]**

- **Problem Solved:** Authors suffer from the "curse of knowledge" — because they know the ending and every backstory secret, they cannot tell whether a clue planted in Chapter 2 actually lands for a first-time reader, whether a twist in Chapter 8 feels earned or abrupt, or whether a subplot disappears for 6 chapters and gets forgotten.
- **Concrete Walkthrough (*Port Marrow — Chapters 1 to 6*):**  
  The author opens **`Reader Lens (Beta-Reader Simulation)`** in `Review` and selects Chapters 1–6. PCC steps strictly sequentially through chapters — **hiding the Story Bible secrets and later chapters from the reader pass** — and produces a chapter-by-chapter **Reader State Log**:
  - *After Ch. 1:* *"Strong hook around the watch. As a reader, I assume Nadia is honest and Alden is overly paranoid. Unanswered question on my mind: what happened at the breakwater lantern?"*
  - *After Ch. 2:* *"Aha! The watch ticked when Tomas denied knowing Nadia — immediate proof Tomas is lying. Wait: why did Nadia say Wednesday was three days before Tuesday? Pulled me out of the scene."*
  - *After Ch. 5:* *"Note: The breakwater lantern hasn't been mentioned since Ch. 1 (4 chapters ago); if it's the Ch. 6 twist, a subtle reminder in Ch. 4 would make the payoff land harder."*
- **Novel Value vs. Chat & Static Tools:** Conventional diagnostics check *logical contradictions*; a spoiler-free progressive reader pass checks **dramatic pacing, clue visibility, setup/payoff distance, and reader expectation** — the exact feedback writers normally wait weeks to get from human beta readers!
- **Drawbacks & Failure Modes:**
  - **High token cost** if run naively over a 30-chapter novel (sequential chapter calls).
  - **Risk of generic or overly prescriptive "creative writing 101" advice** if not tightly anchored to concrete reader questions and verbatim scene moments.
  - Must NEVER output numeric "engagement scores" or replace genuine human critique.
- **Competing Alternatives:** Single-pass full-manuscript critique (suffers from hindsight bias because the AI already read the ending before commenting on Chapter 1).
- **Technical Implications:** Requires bounded per-chapter sequential state accumulation (strictly capped to e.g. 5–10 chapters per run with upfront token/call budget preview) and explicit prompt separation between *reader-visible text* and *author-only canon*.

---

## 4. Creative Discovery Synthesis: How These Concepts Reinforce Each Other

Rather than a disconnected wish list of features, `C-01` through `C-08` form one coherent product identity:

- **Entry:** `C-05` (*Guided Seed-to-Scene*) makes starting from scratch magical; `C-07` (*Zero-Ceremony Ingestion*) makes bringing an existing manuscript effortless.
- **Daily Flow:** `C-01` (*Inline Margin Co-Creator*) + `C-06` (*Voice & Subtext Workbench*) bring PCC's narrative memory directly to the writer's cursor without mode-switching.
- **Visual & Structural Superpowers:** `C-02` (*Epistemic Perspective Lenses*) + `C-03` (*True Visual Timeline & Spatial Graph Lenses*) + `C-04` (*What-If Ripple Sandboxes*) deliver unmistakable capabilities that neither chat windows nor static word processors can match.
- **Deep Revision R&D:** `C-08` (*Spoiler-Free Reader Simulator*) extends PCC's continuity lens into genuine dramatic craft.
