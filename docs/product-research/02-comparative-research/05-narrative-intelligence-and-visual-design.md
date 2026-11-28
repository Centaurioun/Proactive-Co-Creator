# 05 — Narrative Intelligence, Memory Index, Knowledge Lenses, Visuals & Story Development

**Assignment:** `PCC-RESEARCH-02` (Sections 6.4 [Knowledge/Reader/Q&A] and 6.5)  
**Parent Index:** [`README.md`](./README.md)  
**Cross-References:** [`01-comparative-coverage-and-traceability.md`](./01-comparative-coverage-and-traceability.md) · [`02-functional-reassessment-and-trust.md`](./02-functional-reassessment-and-trust.md) · [`03-product-architecture-and-ux-alternatives.md`](./03-product-architecture-and-ux-alternatives.md) · [`04-creative-collaboration-and-proposal-lifecycle.md`](./04-creative-collaboration-and-proposal-lifecycle.md) · [`06-integrated-creative-capability-portfolio.md`](./06-integrated-creative-capability-portfolio.md)

---

## 1. Derived Narrative Memory Index: Common Foundation Without a Second Source of Truth (§6.5)

Both research streams converged on the same architectural blocker: PCC's current flat slicing (`sections.slice(0, 8)`, `text.slice(0, 5_000)`, `entities.slice(0, 25)` without relationships) collapses on long manuscripts and starves creative features (`F-05`, `F-06`, `CE-03.6`).

The solution is a **Derived Narrative Memory Index (`NarrativeMemoryIndex`)** that powers `Writing Partner`, `Story Q&A`, `Creative Studio`, `Story Development`, `Diagnostics`, `Sync`, `Knowledge Maps`, and `Impact Analysis` — while obeying **one iron rule**:

> **Zero Competing Canonical Truth:** `NarrativeMemoryIndex` is a **purely derived, version-stamped, deterministically rebuildable cache** computed solely from PCC's existing authoritative stores (`Immutable Sources`, `Working Manuscript`, `Canonical Model & Story Bible`). Deleting the index loses zero author data; PCC rebuilds its deterministic layers in milliseconds locally and marks optional AI-assisted synopses as stale per modified section digest.

### 1.1 Two-Layer Architecture: Deterministic Local Index + Optional Traceable Summaries

```ts
export interface NarrativeMemoryIndex {
  projectId: string;
  builtForRevision: number;
  indexSchemaVersion: number;
  // Layer 1: 100% Deterministic, Local, Zero AI Cost (rebuilt incrementally per edited section)
  sections: Record<string, {
    sectionId: string;
    orderIndex: number;               // reading order
    chronologyOrder?: number;         // explicit numeric story chronology (replaces localeCompare!)
    chronologyUncertainty?: 'exact' | 'approximate' | 'unknown' | 'flashback';
    textDigest: string;               // SHA-256 of working text → incremental invalidation key
    wordCount: number;
    povEntityId?: string;
    mentionedEntityIds: string[];     // exact name + alias matches with UTF-16 offsets
    quoteOccurrences: { entityId: string; start: number; end: number }[];
    // Layer 2: Author-authored OR explicitly AI-generated traceable summary (never silent background AI!)
    synopsis?: {
      text: string;
      origin: 'author' | 'ai-reviewed' | 'ai-draft';
      sourceSectionDigest: string;    // if !== textDigest, flagged "stale"
      keyEventQuotes: string[];       // verbatim anchor snippets
    };
  }>;
  entitySceneMap: Record<string, string[]>;      // entityId → ordered sectionIds
  knowledgeEvents: TemporalKnowledgeEvent[];     // who learned/believed what & in which section
  threadLedger: NarrativeThreadRecord[];         // setups, reminders, payoffs, open questions
}
```

### 1.2 Targeted Retrieval vs. Exhaustive Long-Form Analysis (Explicit Coverage Contract)

A critical architectural discipline is **never conflating targeted retrieval with exhaustive full-manuscript inspection**:

| Operation Class | Retrieval Strategy | Token Envelope | Coverage Disclosure Shown to Author |
|---|---|---|---|
| **Targeted Operations** (`Writing Partner`, `Focused Studio`, `Scene Develop`, `Grill Me` on 1 scene) | Pulls ONLY: active scene text + metadata (`pov/location/chronology/purpose`), preceding 2 section synopses, entities present in scene + 1-hop confirmed `relationships`, active `Creative Locks`, and `excluded` names. | ~3k–8k tokens (works identically on 3-page short stories AND 120k-word novels!) | `"Grounded in Ch. 12, Ch. 10–11 synopses, 4 scene characters, 6 relationships, 2 locks."` |
| **Broad Grounded Lookup** (`Story Q&A`, `Impact Analysis`, `Connection Discovery`) | Queries `entitySceneMap` + `synopsis` index + `threadLedger` first to locate *exact relevant chapters*, then loads full verbatim passages for those matched chapters only. | ~6k–14k tokens | `"Searched all 20 chapters via index; read full text of Ch. 1, Ch. 7, Ch. 17."` |
| **Exhaustive Continuity Audit** (`Diagnostics Full`, `Sync Full`) | **Batch / Multi-Pass Coverage:** Groups sections into budgeted windows (e.g., 4–6 chapters per pass) cross-checked against the complete compact `Canonical Model` + `Epistemic Fact Ledger` (preserving `belief`/`reported`!). | Explicit preflight: *"3 passes across 20 chapters (~28k est. tokens)"* | `"Full coverage: 20 of 20 chapters checked (0 truncated)."` — OR if user chose 1-pass quick scan: `"Partial scan: Chapters 1–6 checked; Chapters 7–20 not scanned."` |

### 1.3 Concrete Short-Story vs. Long-Novel Walkthroughs (How a Late-Chapter Contradiction Is Never Missed)

- **Case A — Short Story (*Port Marrow*, 3 Pages / 1,400 Words):** Fits cleanly inside 1 pass. `NarrativeMemoryIndex` builds Layer 1 locally in <5ms. `Writing Partner` receives the entire preceding scene + all 5 entities + all relationships; `Diagnostics` runs 1 pass with `100%` verified coverage (`3 of 3 scenes, 0 chars truncated`).
- **Case B — 20-Chapter Novel (*Port Marrow Expanded*, 55,000 Words; Contradiction Planted in Chapter 18, Word 2,400):**
  - *What happens today (`F-05`):* `asyncReviewActions.ts` silently runs `sections.slice(0, 8)` and `s.text.slice(0, 5_000)`. Chapters 9–20 are **100% invisible**—the Ch. 18 contradiction (*Alden claims he never owned a ledger, contradicting Ch. 1's harbor ledger*) is missed while the UI displays a green "0 issues found."
  - *What happens with `NarrativeMemoryIndex`:*
    1. When the writer edits Chapter 18, Layer 1 updates `sections[ch18].textDigest` and flags `ch18` in `pendingChangedSectionIds`.
    2. Clicking **`Review > Check Changed Scenes`** runs a single fast pass over **Chapter 18** (chunked cleanly if >5k chars so word 2,400 is NEVER truncated!) against the Canonical Model + Ch. 1 ledger claim → **catches the Ch. 18 contradiction immediately** with a clickable verbatim quote anchor!
    3. Clicking **`Review > Full Manuscript Audit`** shows an honest preflight (*"20 chapters · 4 budgeted passes · ~34k est. tokens"*). Running it scans all 20 chapters sequentially with cancel/checkpoint support and reports exact verified coverage (`20/20 chapters`).

---

## 2. Knowledge, Perspective, Reader Simulation & Story Q&A (§6.4)

### 2.1 Unifying Epistemic Lenses (`C-02`) + Character Knowledge Map (`CE-07.11`)

Both research streams independently identified **information asymmetry** as PCC's single greatest untapped superpower. Combining Stream 1's interactive visual lens with the owner's time-scoped `Character Knowledge Map` yields one clean data contract built directly on PCC's existing `EpistemicKind`:

```ts
export type KnowledgeState =
  | 'knows-canon'         // Character holds verified world truth
  | 'suspects'            // Character suspects / infers (uncertain)
  | 'falsely-believes'    // Character believes something contradicting world canon
  | 'heard-rumor'         // Character heard unverified report
  | 'unknown';            // Character has not learned this yet

export interface TemporalKnowledgeEvent {
  id: string;
  factId: string;                     // links to canonical claim/entity/relationship
  holder: 'world-canon' | 'reader' | { entityId: string };
  state: KnowledgeState;
  asOfSectionId: string;              // reading order point when state begins
  storyChronologyOrder?: number;      // in-world time when learned
  anchor?: NarrativeAnchor;           // verbatim passage proving they learned/believe it
  isDeliberateMystery?: boolean;      // prevents Diagnostics from flagging as plot hole!
}
```

### 2.2 Concrete Walkthrough + New Synthesis Concept `S-02` (*Scene-Level Subtext & Belief-Clash Detector*)
In *Port Marrow*:
- **World Canon:** Tomas sabotaged the breakwater lantern (`Ch. 1` backstory); the pocket watch ticks backward on conscious lies (`Ch. 1`); Nadia's father designed the fog-clock (`Ch. 7` reveal).
- **As of Chapter 2 (`Workshop Auction`):**
  - **Alden Voss:** `knows-canon` (watch detects lies), `falsely-believes` (Nadia came to confiscate watch), `unknown` (Tomas sabotaged lantern).
  - **Nadia Kestrel:** `unknown` (watch detects lies), `heard-rumor` (Tomas bribed harbor master), `unknown` (father designed fog-clock).
  - **Reader:** `knows-canon` (watch detects lies — learned Ch. 1), `heard-rumor` (bribe rumor — learned Ch. 1), `unknown` (saboteur identity — deliberate mystery).
- **What PCC Delivers Automatically:**
  1. **Interactive Perspective Switcher on `World > Story Map`:** Switching `Perspective: World Canon ▾` → `Nadia Kestrel (as of Ch. 2)` dims unknown nodes/edges with dashed `[Unknown to Nadia]` labels and highlights her rumor edges in amber `[Rumor]`.
  2. **POV Knowledge-Leak Warning in `Write`:** If the author writes in Ch. 2 from Nadia's POV *"Nadia watched the pocket watch carefully to see if it would tick backward"*, Continuity Whisper gently alerts: *"POV Knowledge Check: Nadia has not learned the watch detects lies yet (known only to Alden in Ch. 1)."*
  3. **New Synthesis `S-02` — Subtext & Belief-Clash Highlight:** Because Alden (`falsely-believes` Nadia wants to seize the watch) and Nadia (`knows` she is actually trying to clear Alden's name) are both present in Chapter 2, PCC surfaces a calm **Dramatic Irony Card** in `Develop > Scene & Dialogue`: *"Active Belief Clash in Ch. 2: Alden assumes Nadia is his adversary while Nadia thinks she's protecting him—ideal subtext tension for this dialogue."*

### 2.3 Reader's Perspective vs. Exploratory Spoiler-Free Reader Simulator (`CE-07.12`, `C-08`)
We explicitly separate **two distinct tiers** so PCC never confuses deterministic tracking with speculative AI simulation:
1. **Tier A — Concrete Reader Knowledge Track & Reader Notes (Phase 2–3):** Deterministic track on the Dual-Track Timeline showing *what has been revealed to the reader by Chapter N* vs. *what characters know* vs. *world canon* (using `TemporalKnowledgeEvent` with `holder: 'reader'`). Allows author-authored **Reader Notes** (*"Reader should suspect Tomas here, not Nadia"*) and zero-hallucination spoiler boundary checks.
2. **Tier B — Exploratory Spoiler-Free Reader Simulator (`C-08` — Phase 4 R&D, Clearly Labeled Model):**
   - **Strict Framing Rule:** Always labeled **"Simulated Reader Model (Exploratory — Not Real Human Beta-Reader Evidence)"** and strictly qualitative (zero engagement/pacing scores!).
   - **Verification Protocol Before Any Future Shipping (Assignment §6.4):**
     - *Spoiler Masking Test:* Strip all Story Bible secrets, future chapters (`> N`), and `world-canon` claims whose `asOfSectionId > N` from the prompt payload; inject a synthetic secret revealed only in Ch. 8 and assert zero mention/leakage in Ch. 1–7 simulated outputs.
     - *Retrieval Leakage Test:* Verify the shared `NarrativeMemoryIndex` enforces a hard `maxReadingOrder <= N` filter so no late-chapter synopsis can leak into earlier passes.
     - *Uncertainty Honesty Test:* Verify the simulator distinguishes *"unclear clue"* from *"deliberate open mystery"* and reports confidence bounds honestly.

### 2.4 Source-Grounded `Story Q&A` & Bridge to Creative Studio (`CE-11.1`, `S-04`)
Approved name: **`Story Q&A`** (accessible from top header, `Write` Margin, `World`, and `Review`). Strictly **read-only investigation** (Author asks AI about the *existing story* — completely distinct from `Grill Me`, where AI interviews Author to invent/decide).

**Worked Concrete Examples on *Port Marrow*:**
- **Example 1 (Factual Recall with Anchor):**
  - *Author asks:* `"When did Tomas Reed last handle the brass pocket watch, and who saw him?"`
  - *Story Q&A answers:*
    > **Grounded Answer (Checked Ch. 1–12 via Memory Index; read Ch. 2 & Ch. 6 verbatim):**  
    > Tomas Reed never directly held the watch in the drafted chapters. In **Chapter 2, para 3**, he reached toward the counter (`"his gloved fingers hovered an inch above the brass lid"`) while **Alden Voss** was watching, before Nadia interrupted.  
    > **Uncertainty:** Chapter 6 mentions a missing workshop key, which *could* imply off-screen access, but no drafted scene confirms Tomas touched the watch.  
    > `[Jump to Ch. 2, para 3]` · `[Jump to Ch. 6, para 8]`
- **Example 2 (Forgotten Character / Unresolved Thread → New Synthesis `S-04` Bridge):**
  - *Author asks:* `"Which characters or clues from Chapters 1–3 haven't returned by Chapter 9?"`
  - *Story Q&A answers:*
    > **Unresolved Items (Chapters 1–9):**  
    > 1. **Harbor Master Vance** — mentioned in Ch. 1 rumor (`"dockworkers whispered Tomas bribed Vance"`), 0 appearances in Ch. 2–9.  
    > 2. **The Salt-Stained Manifest** — found by Nadia in Ch. 3, never referenced again.  
    > **`[Explore Vance + Manifest in Creative Studio ↗]`** *(New Synthesis `S-04`: 1-click launches `Studio > Focused` with Vance, Manifest, and Ch. 1/3 anchors pre-loaded as a non-canonical draft session!)*

---

## 3. True Dual-Track Visual Timeline & Contextual Visual Lenses (`C-03`, `F-08`, §6.5)

Both streams reject PCC's current 4 fake text-list "visual" views (`F-08`), AND Assignment §6.5 adds an equally vital warning: **do NOT collapse every visualization need into one overcrowded, misleading mega-graph!**

Instead, PCC provides **five distinct, purpose-built visual surfaces** (each paired with a 1-click **Accessible Table / List Fallback**):

| Visual Surface | Home | What It Shows (Single Clear Question Answered) | Visual Grammar |
|---|---|---|---|
| **1. Story Map (with Lenses)** | `World > Story Map` | *"Who/what exists in my world and how do they connect?"* Includes toggleable lenses: **All Relations**, **Radial Ego Focus** (click node → 1-hop/2-hop), **Kinship Lineage** (directed family ties, dashed arcs for cycles), **Explicit Causation Only**, and **Epistemic Perspective Lens** (`World Canon / Character POV`). | Spatial node-link canvas (`≥72%` viewport height); solid vs. dashed borders for Confirmed vs. Suggested; icons + line styles + color. |
| **2. Dual-Track Visual Timeline** | `World > Timeline` | *"In what order does the reader experience events vs. when did they actually happen?"* Top track = **Reading Order** (`Ch 1 → Ch 2 → Ch 3 [Flashback] → Ch 4`); Bottom track = **Story Chronology** (`chronologyOrder` integer, replacing broken `localeCompare`!) with explicit **Uncertain / Unplaced Bin** for undated scenes; curved arcs connect flashbacks/foreshadowing; optional **Reader Knowledge** & qualitative **Tension Beat** tags (`Quiet Setup`, `Escalation`, `Breathing Room`). | Horizontal dual-track swimlane with drag-to-reorder + explicit `[Uncertain Date]` lane (zero fabricated dates!). |
| **3. Threads, Promises & Mysteries Board** | `World > Threads` & `Review` | *"What setups, clues, promises, and deliberate mysteries are open or paid off?"* | Structured horizontal arc bars spanning chapters (`Setup Ch. 1 ── Reminder Ch. 4 ── [Open Payoff?]`) separating **Author Decisions Needed** from **Deliberate Mysteries**. |
| **4. Visual Change Map** | `Studio` / `Develop` / `Review` Preview | *"Exactly what will this proposal add, modify, or remove?"* (`CE-04.3`, `S-06`) | Deterministic patch diff projected onto preserved Story Map coordinates (`Before / After / Changes Only`). |
| **5. Story Multiverse Lineage** | `Projects > Lineage` *(Opt-in)* | *"How do my alternative story projects branch from each other?"* (`CE-05.3`) | Simple clean branching cards (`Main → Fog-Clock Twist [from r14]`) — never Git jargon. |

```
  DUAL-TRACK VISUAL TIMELINE (Accessible List View toggle in top-right)

  READING ORDER:     [Ch 1: Watch] ───▶ [Ch 2: Auction] ───▶ [Ch 3: Flashback] ───▶ [Ch 4: Harbor]
                           │                   │                    │                     │
                           │ (Setup: 03:17)    │ (Tension: High)    │ (Flashback arc)     │
                           ▼                   │          ┌─────────┘                     ▼
  STORY CHRONOLOGY:  [4 Yrs Ago: Breakwater] ◀─┼──────────┘   [Mon: Ledger] ──▶ [Tue: Watch & Auction] ──▶ [Wed: Harbor]
                     (Ch 3 flashback)          │
  UNCERTAIN TIME:    [Fragment: "Fog Folklore Legend" — Unplaced / Approximate]
```

---

## 4. `Story Development` vs. `Creative Studio` — Distinct Intents, Shared Engine (`CE-01.8`, §6.5)

The owner's separation between **`Creative Studio`** (*"Help me discover new possibilities, twists, and original directions"*) and **`Story Development`** (*"Help me expand, deepen, pace, and polish the story I already have WITHOUT hijacking its plot or ending"*) is one of the sharpest product insights across both streams.

### 4.1 Consolidating 9 Development Candidates into 5 Clear Writer Lenses
Rather than creating 9 fragmented screens (`CE-01.8`), organize `Story Development` around **5 intuitive craft lenses** backed by the exact same `CreativeSession`, `NarrativeMemoryIndex`, and `Unified Proposal Engine`:

| Consolidated Lens | Absorbs Owner & Stream 1 Capabilities | Example Concrete Action |
|---|---|---|
| **1. Expand & Continue** | `Expand Story` · `Develop Chapters` · `Continue Story` | Expand a 3-page story into 5 chapters with richer scene transitions while locking core plot & ending via Preservation Policy. |
| **2. Character Depth** | `Character Depth` · `Character Intelligence` · `Hidden Motivation` · optional `Character Interview` (`CE-07.9`) | Deepen Alden's grief and unspoken pride in Ch. 2 without changing his actions or loyalty. |
| **3. Scene & Dialogue** | `Scene & Dialogue` · `Voice & Subtext Workbench` (`C-06`) · `Alternative Perspectives` (`CE-07.10`) · `S-02` Belief-Clash | Sharpen dialogue distinctness between Alden and Tomas; test rewriting Ch. 2 from Nadia's POV; local zero-AI rhythm check. |
| **4. Pacing & Structure** | `Pacing & Structure` · `Plot Development` · `Theme Weaver` (`CE-07.20`) · `Narrative Tension Map` (`CE-07.21`) | Identify where Act 2 sags across Chapters 4–6 and map where central themes (`trust vs. truth`) fade out. |
| **5. Voice & Tighten (`S-05`)** | `Voice & Style` · `Narrative Compression` (`CE-01.8`) | Align prose to confirmed `Style Profile`; **`S-05` Redundancy Lens** flags exposition beats already stated in earlier chapters and proposes tightened cuts preserving locked beats. |

---

## 5. Creative Compass, Creative DNA, Intensity, Constraints & Repeatable Creative Locks (`CE-06`, §6.5)

### 5.1 Creative Compass (`CE-06.1`)
- A compact, **editable qualitative tag & polarity summary** carried inside the active `CreativeSession` (e.g., *Mood: Quiet Noir · Mystery Grounding: Scientific/Mechanical · Stakes: Intimate Family Guilt · Pacing: Slow-Burn*), plus 2–3 clickable next-direction nudges. Strictly a **preference mirror**, never a story quality rating.

### 5.2 Creative DNA (`CE-06.2`)
- Optional user-saved long-term taste profile (separate from per-project `Style Profile`, which governs prose mechanics like tense/POV).
- Three explicit steering modes per session: **`Follow My Preferences`** · **`Blend Both`** *(default)* · **`Challenge My Preferences`** *(intentionally breaks writer filter bubbles by surfacing contrasting genres/structures)*.

### 5.3 Creative Intensity (`CE-06.3`)
- Clean 4-stop writer-facing risk appetite dial: **`Subtle`** (tiny craft refinements, zero plot disruption) · **`Balanced`** (meaningful development honoring premise) · **`Bold`** (surprising turns & deeper re-framing) · **`Radical`** (Story Lab reinventions & high-concept twists).
- **Strictly decoupled from technical AI parameters:** Changing Intensity adjusts creative prompt framing and divergence scope—**never** silently mutates provider `reasoningLevel`, token caps, or billing tier!

### 5.4 Repeatable `Creative Locks` & Hard vs. Soft Enforcement (`CE-06.5`, `S-01`)
Honoring the owner's explicit UX design (AI-recommended lock suggestions + free-text author input with **`+ Add another`** repeatable rows, project-wide OR session-scoped):

| Lock Tier | Target Examples | Enforcement Mechanism | Honesty Guarantee |
|---|---|---|---|
| **Hard Structural Lock** | Exact Entity (`Alden Voss`), Trait (`pale gray eyes`), Directed Relationship (`Alden → Nadia`), Specific Passage (`Ch. 1 ending paragraph`), Exclusion (`No Steam Automaton`), Story Ending Slot (`Ending locked`) | **Deterministically enforced** in `validateNarrativeProposals`! Any concrete patch op targeting a locked ID/range is **flagged and blocked** unless explicitly unlocked (`CE-06.6`) or forked to an Alternative Project (`CE-05.2`). | **100% deterministic guarantee** on structured mutations. |
| **Soft Semantic Lock** | Author free-text rule (*"Keep technology grounded in 1890s maritime science"*, *"Never make Nadia cruel"*) | Injected into high-priority prompt invariants + optional **Ground This Lock** helper (*"Bind to entities: Nadia Kestrel, Brass Watch?"*). Preview shows an honest AI compliance check labeled **`Guidance Check (Semantic — Review Manually)`**. | **Never pretends deterministic enforcement** on unstructured prose rules (`CE-06.5`). |

- **New Synthesis `S-01` — Lock & Constraint Conflict Preflight:** If an author asks `Story Lab` to *"Give the pocket watch magical time-travel powers"* while a project-level Lock says `"No supernatural magic"`, PCC detects the collision **before** applying (and warns upfront in `Studio` header) with 3 clean buttons: **`Respect Lock`** · **`Unlock for This Session Only`** · **`Explore in Alternative Project (Locks Relaxed)`**. Zero silent overrides!
