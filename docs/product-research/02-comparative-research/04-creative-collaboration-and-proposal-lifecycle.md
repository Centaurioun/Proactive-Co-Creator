# 04 — Creative Collaboration, Proposal Lifecycle, Visual Preview, Alternatives & Grill Me

**Assignment:** `PCC-RESEARCH-02` (Sections 6.2, 6.3, and 6.4 [Grill Me])  
**Parent Index:** [`README.md`](./README.md)  
**Cross-References:** [`01-comparative-coverage-and-traceability.md`](./01-comparative-coverage-and-traceability.md) · [`03-product-architecture-and-ux-alternatives.md`](./03-product-architecture-and-ux-alternatives.md) · [`05-narrative-intelligence-and-visual-design.md`](./05-narrative-intelligence-and-visual-design.md) · [`06-integrated-creative-capability-portfolio.md`](./06-integrated-creative-capability-portfolio.md)

---

## 1. Full Creative Collaboration & Card-Action Lifecycle (`CE-02`, §6.2)

To give writers fluid creative control without accidental mutations, runaway API calls, or lost variations, every idea card across `Creative Studio` (`Discover`, `Guided/Grill Me`, `Focused`, `Story Lab`) and `Story Development` follows one transparent, non-destructive interaction contract.

### 1.1 Exact Card Action Semantics

| Action | Mutates Canon? | Triggers AI Call? | Exact Behavior & Lineage Guarantee |
|---|---|---|---|
| **Select / Multi-Select** | **No** | **No** | Marks 1+ cards or direction chips in local autosaved session state. Never fires per-click AI requests. |
| **Preview** | **No** | **No** (if patch exists) / Explicit 1 bounded call if concrete patch not yet synthesized | Opens exact Summary, Before/After diff, deterministic **Visual Change Map**, and speculative **Impact Analysis** without mutating canon. |
| **Edit (Description vs. Concrete Changes)** | **No** | **No** | Explicitly distinguishes **(a) Editing the Creative Description / Notes** (marks existing patch as *"Needs patch refresh"* so description and diff never silently diverge!) from **(b) Editing Concrete Proposed Changes directly** (edits text/entity/relation patch fields deterministically). |
| **Regenerate (Per-Card)** | **No** | **Yes (1 bounded call)** | Regenerates **ONLY this single card**, leaving all sibling cards untouched. Appends new version (`v2`) onto the card's local version history (`v1 ← v2`) so the author can flip back to `v1` anytime; accepts optional quick steering note (*"less melodramatic"*). |
| **Develop Further** | **No** | **Yes (1 bounded call)** | Preserves the original card intact (`v1`) and spawns a child refinement (`v1.1` / linked card with `parentIds: [cardId]`) guided by selected AI directions + custom author input + active locks. |
| **Suggest More Directions** | **No** | **Yes (1 bounded call)** | Appends 4–6 **distinct** new direction chips onto the existing direction rail, passing already-shown labels as exclusions and preserving every chip the author already checked. |
| **Custom Input → `Suggest Directions`** | **No** | **Yes (1 bounded call)** | Interprets author's typed seed (e.g., *"maritime wartime signal technology"*) into **4–5 clickable creative direction angles** — does **NOT** jump prematurely to a full concrete idea. |
| **Custom Input → `Generate Idea`** | **No** | **Yes (1 bounded call)** | Synthesizes a **full concrete creative idea card** directly grounded in the author's typed direction + scope + locks. |
| **Develop with Selected Directions** | **No** | **Yes (1 bounded call)** | Explicit author trigger combining all checked direction chips (and optional custom text) into an evolved version of the target card. |
| **Combine Ideas** | **No** | **Yes (1 bounded call)** | Available when ≥2 cards are selected; creates a new synthesized card recording `parentIds: [idA, idB]` while preserving both originals intact for comparison. |
| **Save for Later (Bookmark)** | **No** | **No** | Copies a durable reference into the project's private **Idea Library** (`CE-07.22`) with tags and scope snapshot. Never mutates canon. |
| **Dismiss** | **No** | **No** | Moves card out of active view into a collapsible **Dismissed (Recoverable)** tray within the session; 1-click Restore anytime. |
| **Explain Differently (`CE-09.3`)** | **No** | **Yes (1 bounded call)** | Re-explains the idea in plain language using a concrete scene example from this story, why it matters, and what would change — adds **zero** new canonical facts. |
| **Challenge This Idea (`CE-07.13`)** | **No** | **Yes (1 bounded call)** | Surfaces clichés, weak causality, contrivance, or lock conflicts constructively; author can keep original, refine, or discard. |

### 1.2 Seven Distinct Lifecycle States (Zero Ambiguity, Simple Writer Labels)

| Internal State | Writer-Facing Label | Mutates Canon? | Persistence |
|---|---|---|---|
| `autosaved-draft` | `Draft` | No | Automatic local IndexedDB save (truthful status) |
| `bookmarked` | `Saved for later` | No | Durable entry in project **Idea Library** |
| `selected-for-apply` | `Selected (N)` | No | Staged in current session's Final Preview tray |
| `accepted-to-collection` | `In Working Ideas` | No | Promoted from raw AI output into author's curated workspace |
| `applied-to-canon` | `Applied (v14)` | **Yes (Explicit Final Action Only)** | Atomic canonical revision + operation log for selective revert |
| `forked-to-alternative` | `Saved as Alternative` | **No (New Copy Only)** | Independent project copy; current project untouched & stays open |
| `dismissed` / `archived` | `Dismissed` / `Archived` | No | Hidden from active board; recoverable |

### 1.3 Worked End-to-End Synthetic Example (*Port Marrow*: Stopped Watch `03:17` + Ch. 7 Radio Signal)

1. **Scoped Launch:** In **`World`**, the writer selects two existing source-grounded nodes—**`Brass Pocket Watch (stopped at 03:17, Ch. 1)`** and **`Unexplained Harbor Radio Signal (Ch. 7)`**—and clicks **`Find Hidden Connections in Studio ↗`**.
2. **Initial Generation (`Focused Development`, `Intensity: Bold`, Lock: `No supernatural magic`):**
   - **Idea A (*The Quartz Beat Harmonic*):** The watch's balance wheel contains a salvaged maritime resonator tuned to the exact 03:17 low-tide tide-gauge broadcast used by smugglers. *(Grounded in Ch. 1, Ch. 7; new link labeled `Hypothesis`.)*
   - **Idea B (*The Harbor Master's Dead-Man Switch*):** The watch didn't break randomly—Alden stopped it at 03:17 the night the breakwater lantern failed, and the Ch. 7 radio signal broadcasts the same timestamp cipher.
   - **Idea C (*Acoustic Hallucination*):** The watch ticks audibly near coastal radio transformers; Alden's fatigue makes him project guilt onto mechanical interference.
3. **Per-Card Actions (Zero Loss of Good Cards):**
   - Writer likes **Idea B**'s emotional weight and **Idea A**'s physical realism, dislikes **Idea C**.
   - Writer clicks **`Dismiss`** on **Idea C** (recoverable in tray) and clicks **`Save for Later`** on **Idea A** (bookmarked to Idea Library).
   - Writer clicks **`Develop Further`** on **Idea B** → PCC displays suggested directions: `[ ] More suspenseful` · `[ ] Deeper family guilt` · `[ ] Political conspiracy` · `[ ] Scientific mechanism` · `[ ] Surprise Me`.
   - Writer checks **`[✓] Deeper family guilt`** + **`[✓] Scientific mechanism`** (zero AI calls fired on checkbox clicks!), then clicks **`+ Suggest More Directions`** → PCC appends `[ ] Unreliable memory` · `[ ] Harbor guild cover-up` · `[ ] Slow-burn red herring` without clearing the two checked boxes.
4. **Custom-Input Split (`Suggest Directions` vs. `Generate Idea`):**
   - Writer types in the custom input box: *"Nadia's late father built the breakwater fog-clock."*
   - **Path 1 — Writer clicks `Suggest Directions`:** PCC does NOT write a full story idea; instead it appends 4 focused angles derived from that hint:
     - *`Father's hidden calibration blueprint inside the watch casing`*
     - *`Alden destroyed the fog-clock logs to protect Nadia's father's name`*
     - *`The Ch. 7 radio pulse is an automated distress chime from the sunken beacon`*
     - *`Nadia already suspects her father's role and is testing Alden`*
   - **Path 2 — Alternatively, if writer clicks `Generate Idea`:** PCC immediately generates **Idea D (*The Fog-Clock Inheritance*)** — a full concrete idea card integrating Nadia's late father's fog-clock with the 03:17 watch stop and Ch. 7 signal.
5. **Combining & Editing:**
   - Writer selects **Idea B** + **Idea D** and clicks **`Combine Ideas`** → creates **Idea E (`parents: [B, D]`, `v1`)**: *Alden stopped the watch at 03:17 the night Nadia's father's fog-clock malfunctioned; the Ch. 7 radio signal is the automated salvage beacon still transmitting on that harmonic.*
   - Writer clicks **`Regenerate`** on **Idea E** with note *"keep Tomas Reed involved without making him the mastermind"* → creates **Idea E (`v2`)**, while **`v1`** stays selectable via `v1 / v2 ▾`.
   - Writer clicks **`Edit`** on Idea E (`v2`), tweaks one sentence in the description, closes the browser tab, and returns the next day — **Session `"Watch & Radio Link"` restores cleanly from IndexedDB autosave with every card, version, bookmark, and checked direction intact** (zero silent AI calls on reload).

---

## 2. Persistent `CreativeSession` Storage Contract (`CE-03`, Conceptual TypeScript)

```ts
export interface CreativeSession {
  id: string;
  projectId: string;
  workspaceKind: 'creative-studio' | 'story-development';
  mode: 'discover' | 'guided-interview' | 'focused' | 'story-lab' | 'expand' | 'character-depth' | 'scene-dialogue' | 'voice-tighten';
  title: string;
  status: 'active' | 'paused' | 'archived';
  baseRevisionAtStart: number;
  scope: {
    kind: 'whole-story' | 'sections' | 'entities' | 'passage' | 'seed';
    sectionIds: string[];
    entityIds: string[];
    relationshipIds: string[];
    passageAnchor?: { sectionId: string; quote: string; start: number; end: number };
  };
  steering: {
    intensity: 'subtle' | 'balanced' | 'bold' | 'radical';
    preservationPolicy?: string[];       // Story Development keep-intact toggles
    sessionConstraintNotes: string[];    // soft per-session guidance
    activeLockIds: string[];             // references project/session Creative Locks
    compassTags: string[];
    dnaMode?: 'follow' | 'challenge' | 'blend';
  };
  directionRail: { id: string; label: string; origin: 'ai' | 'author-seed'; selected: boolean }[];
  cards: CreativeIdeaCard[];             // holds versions[], parentIds[], state, draftProposalId
  interviewHistory?: InterviewTurn[];    // populated when Grill Me / Guided mode used
  selectedProposalIds: string[];         // staged for Final Preview (non-mutating)
  autosave: { lastSavedAt: string; dirty: boolean; lastError?: string };
}
```

**Storage Discipline (Preventing IndexedDB Bloat, `01-independent-discovery/04 §4.1`):** Sessions store **compact structured cards, parent IDs, and patch deltas**—never full `ProjectSnapshot` clones per card! Archiving or deleting a session never deletes applied canonical revisions (which carry only a lightweight `originSessionId` reference).

---

## 3. Unified Proposal Engine: One Safety Mechanism, Distinct User Intents (`CE-03.5`, `CE-04`)

Today PCC maintains **five separate review/apply paths** (`DecisionInboxPanel`, `nlBatchEngine`, `NarrativeReview` safe fixes, `NarrativeReview` sync proposals, `WritingAssistantPanel` insertion, plus `OpportunityCenter` → Change Review indirection). Unifying them under **one internal `NarrativeProposal` engine** removes duplicate code AND eliminates the owner's hated `Accept → Send to Change Review → extra technical screen` ceremony (`CE-02.2`), while keeping **actual defects** clearly separated in the UI from **optional creative proposals**:

| Proposal `kind` | Visual Framing & Urgency | Origin Surfaces | Can Mutate |
|---|---|---|---|
| **`defect-fix`** | Amber/Red *Continuity Issue* (factual contradiction) | `Review > Diagnostics`, `Write > Whisper` | Manuscript range, Model field |
| **`sync-alignment`** | Blue *Sync Update* (manuscript ↔ model drift) | `Review > Sync`, `Import > Proposed` | Model entities/rels/Story Bible |
| **`writing-edit`** | Neutral *Prose Edit* (local style/expansion/dialogue) | `Write > Partner`, `Develop` | Manuscript section range / new scenes |
| **`creative-proposal`** | Violet *Creative Idea* (optional exploration) | `Studio`, `Grill Me`, `Story Lab`, `Batch Edit` | Manuscript, Model, Story Bible, Threads |

### 3.1 Single-Proposal Immediate Apply vs. Staged Multi-Proposal Apply
- **Single-Proposal Flow (No Extra Screen!):** Clicking **`Preview`** on one card opens an inline/drawer Preview showing exact Before/After + Change Map + Lock Check. Clicking **`Apply Change`** commits directly in 1 click (zero redirect to a second Change Review screen!).
- **Staged Multi-Proposal Flow (Final Aggregate Preview):** When the author checks 2+ ideas (e.g., *Idea E* + *Foreshadowing Beat in Ch. 3*), a calm bottom bar shows **`2 ideas selected (5 concrete changes) · [Final Preview →]`**. Opening Final Preview renders the combined **Summary**, **Before/After**, **Visual Change Map**, and **Impact Analysis** with per-change checkboxes so the author can deselect individual sub-edits before clicking one of the 4 final outcomes (`CE-05.1`).

### 3.2 Validation, Dependency Detection, Stale Base Guard & Safe Selective Revert
Extending PCC's existing deterministic `lib/nlBatch/operationValidation.ts` across *all* proposal types:
1. **Coherent Refresh on Edit/Toggle:** Whenever the author edits a patch or unchecks 1 of 5 sub-changes, `validateNarrativeProposals` immediately re-simulates the selected subset against `baseRevision`:
   - **Dependency check:** If sub-change #2 (`Add relationship: Nadia → Fog-Clock`) depends on sub-change #1 (`Add entity: Breakwater Fog-Clock`) and the user unchecks #1, PCC flags the dependency conflict inline (*"Unchecking Breakwater Fog-Clock makes 1 relationship invalid — [Also uncheck relationship] or [Keep entity]"*) and **never silently includes an excluded edit** (`CE-04.5`).
   - **Hard Lock check (`S-01`):** Any concrete op mutating a Hard-Locked entity, relationship, or passage triggers an explicit lock banner (*"Blocked by Hard Lock: Keep Alden's pale gray eyes — [Keep Lock (exclude op)] · [Unlock for this apply] · [Save as Alternative Project]"*).
2. **Stale Base Revision Guard (`CE-04.6`):** Before committing, CAS checks `proposal.baseRevision === project.currentRevision`. If stale, PCC never blindly overwrites; it runs deterministic re-anchoring (`NarrativeAnchor`) and offers 1-click **`Refresh Preview on Latest Revision (r15)`**.
3. **Atomic Apply & Safe Selective Revert (`CE-02.11`):**
   - Applying commits one atomic transaction (`Revision r15`) storing both the **forward operations** and **inverse operations** (e.g., previous field values + exact manuscript range checksums).
   - **Selective Revert:** If the author applies Proposal A (`r15`), then makes unrelated edits to Chapter 5 (`r16`, `r17`), and later clicks **`Revert Proposal A`** in History:
     - Model ops untouched by `r16`/`r17` invert cleanly without losing Chapter 5 edits!
     - Any manuscript range or field modified later in `r16`/`r17` is flagged with a clean **Revert Conflict Preview** (*"Ch. 2 paragraph 3 was edited again in r17 — [Revert untouched 4 ops only] · [Inspect Ch. 2 diff]"*) so unrelated later work is **never silently erased**.

---

## 4. Visual Preview, Deterministic Change Map & Impact Analysis (`CE-04`, `S-06`, §6.3)

### 4.1 Four Synchronized Preview Views (All Derived from ONE Patch + Base Revision)
1. **Summary:** Plain-language count of concrete mutations (*2 entities added · 1 relationship updated · 1 manuscript beat inserted · 2 locked elements untouched*).
2. **Before / After:** Exact side-by-side diffs for Story Bible fields, Entity traits, Relationship labels, and exact Manuscript ranges (highlighted verbatim).
3. **Visual Change Map (`CE-04.3`, `S-06`):**
   - **Critical Invariant:** Generated **100% deterministically** by projecting `applyPatch(baseSnapshot, selectedOps)` against `baseSnapshot`—**NEVER invented by a separate AI diagram prompt**! Text diff and Visual Change Map can never contradict each other.
   - **Toggle:** `Before` | `After` | `Changes Only` *(default on large worlds)*.
   - **Layout Stability:** Existing nodes retain their exact `(x, y)` coordinates from the main `World` Story Map; newly added nodes dock cleanly beside their connected neighbors.
   - **Accessible Dual-Encoding (Never Color Alone!):**
     - **Added:** `[+ Added]` badge · solid double border · emerald stroke
     - **Modified:** `[~ Changed]` badge · thick dashed border · amber stroke · tooltip shows `old → new`
     - **Removed:** `[- Removed]` badge · dotted stroke + strikethrough label · rose stroke
     - **Unchanged (Context / Locked):** `[Locked]` padlock icon (if protected) · muted solid slate
   - **Click-Through:** Clicking any node or directed edge in the Change Map scrolls directly to the matching concrete operation in the Before/After panel and manuscript excerpt.

```
   VISUAL CHANGE MAP — [Changes Only ▾]  (Derived strictly from Patch #E-v2 on r14)

   ┌───────────────────────┐   [+ Added] built   ┌───────────────────────────┐
   │  Alden Voss           │════════════════════▶│ + Breakwater Fog-Clock    │
   │  [🔒 Locked: eyes]    │                     │   (Location / Object)     │
   └───────────┬───────────┘                     └─────────────▲─────────────┘
               │ [~ Changed]                                   │
               │ "estranged uncle" →                           │ [+ Added]
               │ "hiding father's role from"                   │ transmits on
               ▼                                               │ harmonic of
   ┌───────────────────────┐                     ┌─────────────┴─────────────┐
   │  Nadia Kestrel        │                     │  Ch. 7 Radio Signal       │
   │  [Unchanged]          │                     │  [Unchanged — Source Ch7] │
   └───────────────────────┘                     └───────────────────────────┘
```

4. **Impact Analysis (Concrete Patch vs. Speculative Ripple — `CE-04.4`):**
   Explicitly split into two visually distinct sections so writers never confuse guaranteed edits with hypothetical follow-up work:
   - **Concrete Patched Changes (Guaranteed on Apply):** Exact list of operations in this transaction.
   - **Possible Downstream Ripples (Unpatched — Estimated via Memory Index):**
     - *Ch. 2, para 4 (High likelihood):* Nadia says her father *"never touched harbor machinery."* If he built the fog-clock, either this line needs revision OR Nadia doesn't yet know he built it *(uncertainty noted)*. `[Open Ch. 2]` `[Create follow-up task]`
     - *Ch. 4 (Uncertain):* Tomas's auction speech may carry stronger subtext; no contradiction detected.

---

## 5. Exploration Ladder, Alternative Projects & Story Multiverse (`CE-05`, §6.3)

Reconciling Stream 1's fear of "Git for novelists" (`01-independent-discovery/06 §3`) with the owner's explicit need for durable branches, independent alternative projects, comparison, and selective transfer (`CE-05`):

### 5.1 Three-Tier Exploration Ladder (Simple Default, Opt-In Depth)

| Tier | User Concept | When to Use | Persistence & Identity |
|---|---|---|---|
| **Tier 1 — Session Draft** | Exploring cards & `v1/v2` refinements inside a `Creative Session` | Everyday brainstorming, `Grill Me`, tweaking ideas | Lightweight session draft inside current project; zero project duplication |
| **Tier 2 — Saved Idea Branch** | A named group of staged proposals saved inside a Session (*"Branch A: Nadia is Innocent"* vs. *"Branch B: Nadia Works for Tomas"*) | Comparing 2 plot hypotheses side-by-side before writing full chapters | Stored inside project's Idea Library/Sessions; non-mutating |
| **Tier 3 — Independent Alternative Project** | Full independent copy of the project with selected proposals applied (`CE-05.2`) | Committing to write multiple chapters down a diverging timeline or alternate ending | Full independent `CreativeProject` with distinct `projectId`, remapped internal IDs, independent revision history, and `lineage` metadata |

### 5.2 Strict Rules for `Save as Alternative Project` (`CE-05.2` — Mandatory Owner Requirement)
1. **Original Project Remains 100% Untouched:** Zero mutation to current project's manuscript, model, Story Bible, or revision counter.
2. **Safe Clone & ID Remapping:** Clones immutable sources (preserving source digests), Working Manuscript, Canonical Model, and Story Bible into a fresh `projectId`, remaps internal project-scoped references cleanly, applies ONLY the selected coherent proposals to the new copy, and records:
   `lineage: { originProjectId, originProjectTitleSnapshot, originRevision, sourceSessionId, createdAt, summaryOfDivergence }`.
   *(Storing `originProjectTitleSnapshot` ensures lineage stays readable even if the parent project is later deleted!)*
3. **STRICT NO AUTO-SWITCH:** Immediately after durable IndexedDB commit succeeds, PCC keeps the **current project open and active**, displaying a calm confirmation toast/modal:
   > **Saved as Alternative Project:** *"Port Marrow — Fog-Clock Twist"* (branched from r14). Your current project is unchanged.  
   > **`[Continue Current Project]`** *(primary default)* · **`[Open Alternative]`** *(explicit secondary action)*

### 5.3 Optional Story Multiverse, Qualitative Comparison & Selective Transfer (`CE-05.3`–`CE-05.5`)
- **Story Multiverse (`Projects > Lineage View` toggle — off by default):** Clean visual family tree showing `Port Marrow (Main)` → `Port Marrow — Fog-Clock Twist (from r14)` and `Port Marrow — Tragic Ending (from r19)`, with hover notes explaining the divergence point. Zero Git jargon (`HEAD`, `rebase`, `cherry-pick`, `merge conflict` are **banned**!).
- **Compare Alternative Stories (`CE-05.4`):** Pick any two projects in the Multiverse → side-by-side **Structural Graph & Timeline Diff** (deterministic, 0 AI calls) + optional **Qualitative Narrative Tradeoff Summary** (1 bounded AI call using `Narrative Memory Index` synopses comparing *plot direction, emotional atmosphere, tension arc, strengths & tradeoffs* — **zero numeric scores!**).
- **Selective Transfer (`CE-05.5`):** In `Compare`, the author can click **`Bring into Current Project…`** on a specific scene, character, or relationship from Alternative B → PCC packages it into a standard **`NarrativeProposal`** with automatic dependency check (*"Scene 4 mentions newly invented character 'Captain Hale' — include Captain Hale too?"*), ID remapping, and full Before/After + Lock Preview. **Zero implicit project merging.**

---

## 6. Voluntary Adaptive `Grill Me` Interview Engine (`CE-08`, `CE-10`, §6.4)

Unifying `CE-08` (voluntary scoped `Grill Me`), `CE-10` (4 behavioral modes), and Stream 1's `C-05` (*Guided Seed-to-Scene + Live Sketch*) into **one shared voluntary Adaptive Interview Engine**—never a mandatory wizard, never a fifth global tab, and never a generic chatbot!

### 6.1 Four Behavioral Modes on One Shared Engine (`CE-10.2`)

| Mode | Author Mindset | AI Interview Posture | Best Trigger Contexts |
|---|---|---|---|
| **`Inspire Me`** | *"I only have a tiny spark—help me discover what excites me."* | Warm, generative, opens surprising imaginative doors (replaces Stream 1 `C-05` onboarding) | `+ New` seed inception, blank chapter, `Studio > Guided` |
| **`Explore with Me`** | *"I have a solid premise—let's map possibilities together."* | Balanced collaborative probing across character, stakes & structure | `Studio > Guided`, `Focused Development` |
| **`Grill Me`** | *"Press me on the hard decisions I've been avoiding."* | Dependency-aware frontier probing (`grilling`-inspired): resolves root questions first, surfaces hidden assumptions, gives reasoned recommendations | Any selected scene, character, plot hole, idea card, or `Review` |
| **`Challenge Me`** | *"Tear-test this idea before I write 10 chapters around it."* | Constructive adversarial critique (`CE-07.13`): hunts clichés, weak motivation, contrivance & unintended ripples | Individual idea cards, `Story Lab`, major plot twists |

### 6.2 Core Mechanics (Respecting Author Control & Memory)
1. **Research Story Facts First (Never Ask What's Already in the Text!):** Before generating the next question, the interview engine queries the **`Narrative Memory Index`** (`05 §1`). If Chapter 1 already states Alden is 68 with pale gray eyes, `Grill Me` never asks his age or appearance—it asks *why* he kept the watch hidden for four years!
2. **One Focused Question Default (Optional 2–3 Independent Batch):** Each turn presents 1 high-leverage question (or an optional toggle for 2–3 independent questions), 3–4 concrete non-cliché options (with 1 explicitly **Recommended** with a 1-sentence *Why*), plus: **`Type my own answer`** · **`Select multiple`** · **`Let AI propose`** · **`Skip / Decide later`** · **`Keep as deliberate story mystery`** (`→ logs to Open Questions Board as Intentional Mystery!`) · **`Explain differently`** (`CE-09.3`).
3. **Live Draft Sketch (Strictly Non-Canonical Until Approved):** As the author answers, a clean right-hand **Draft Sketch** visibly grows (proposed nodes, edges, traits, or beat bullets clearly styled with dashed `"Draft — not applied yet"` borders).
4. **Backtracking with Dependency Invalidation (`CE-08.4`):** Every Q&A turn records `dependsOnTurnIds[]`. If the writer jumps back to Question 1 and changes *"Who sabotaged the lantern?"* from `Tomas` to `Nadia's father`, PCC automatically marks downstream Q3–Q4 draft decisions as **`Needs re-check (Q1 changed)`** instead of silently producing an incoherent preview!
5. **Interruptible Anytime (Zero Forced Completion):** After Round 1 or Round 10, clicking **`Preview Concept Now`** synthesizes an editable `CreativeIdeaCard` + concrete `NarrativeProposal` derived strictly from the Q&A record (preserving unanswered points as explicit open questions), which can be previewed, edited, saved to Idea Library, applied to Canon, or saved as an Alternative Project. Exactly **1 bounded AI call per turn**—zero hidden background loops.

### 6.3 Clean Role Distinction (Eliminating Overlap Confusion)

| Capability | Who Asks? | Primary Purpose | Mutates Canon? |
|---|---|---|---|
| **`Grill Me` (4 modes)** | **AI asks Author** | Uncover author's creative intent, resolve open story decisions, break writer's block | Never directly; exits to editable Draft Proposal |
| **`Story Q&A`** (`05 §2.4`) | **Author asks AI** | Query *what the existing story actually says* with verbatim passages & uncertainty | Never; optional 1-click *"Explore this gap in Studio"* (`S-04`) |
| **`Explain Differently`** (`CE-09.3`) | **Author asks AI to clarify an AI output** | Translate a dense suggestion/question into plain English + concrete story example | Never; adds zero new facts |
| **Optional `Craft Note`** (`CE-09.4`) | **Author asks "Why does this craft principle matter?"** | Short optional explanation of narrative technique (e.g., dramatic irony, pacing beat) | Never; strictly separate from story canon & diagnostics |
