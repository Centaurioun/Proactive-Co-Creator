# 06 — Integrated Creative Capability Portfolio & Original Synthesis Proposals

**Assignment:** `PCC-RESEARCH-02` (Sections 5, 6.5, and 7)  
**Parent Index:** [`README.md`](./README.md)  
**Cross-References:** [`01-comparative-coverage-and-traceability.md`](./01-comparative-coverage-and-traceability.md) · [`03-product-architecture-and-ux-alternatives.md`](./03-product-architecture-and-ux-alternatives.md) · [`04-creative-collaboration-and-proposal-lifecycle.md`](./04-creative-collaboration-and-proposal-lifecycle.md) · [`05-narrative-intelligence-and-visual-design.md`](./05-narrative-intelligence-and-visual-design.md)

> **Anti-Sprawl Synthesis Principle:** Between `PCC-RESEARCH-01` (`C-01`–`C-08`) and the Owner Register (`CE-01`–`CE-11`), over **35 named creative capabilities** were proposed. Implementing them as 35 disconnected screens would bury writers in toolbar clutter. This document shows how every retained capability consolidates into **8 cohesive writer-facing creative workflows** over shared engines—plus **6 original synthesis ideas (`S-01`–`S-06`)** discovered by cross-pollinating both streams—and records explicit deferral/rejection decisions.

---

## 1. Portfolio Consolidation Architecture (35+ Ideas → 8 Cohesive Capabilities)

```
  SHARED FOUNDATIONS:  Narrative Memory Index  ·  CreativeSession  ·  Unified Proposal Engine
                                               │
     ┌─────────────────────────────────────────┼─────────────────────────────────────────┐
     ▼                                         ▼                                         ▼
  CREATIVE STUDIO (New Possibilities)     WORLD & REVIEW (Understand & See)      STORY DEVELOPMENT (Strengthen)
  1. Connection & Seed Discovery          5. Visual World, Dual-Track Timeline   7. Expand, Pace, Tighten & Voice
     (Hidden Links · Story Seeds ·           & Epistemic Knowledge Map              (Expand · Character Depth ·
      Cross-Pollination)                     (Story Map · Ego/Kinship · POV ·       Dialogue/Subtext · Theme ·
  2. Foreshadowing, Twists & Threads         Reader Track · Threads Board)          Compression S-05)
     (Forward/Reverse · Mystery ·         6. Source-Grounded Story Q&A           8. Private Idea Library &
      Open Questions · Promises)             (Verbatim Answers · S-04 Bridge ·      Lightweight Craft Helpers
  3. Story Lab & Alternative Endings         Exploratory Reader Sim R&D)            (Saved Ideas · Session Brief ·
     (What-If · Ripple · Crossroads ·                                               Explain Differently · Craft Note)
      Scene Sim · Endings · Multiverse)
  4. Voluntary Adaptive Grill Me
     (Inspire · Explore · Grill · Challenge)
```

---

## 2. Detailed Evaluation of Consolidated Creative Capabilities (`CE-07` – `CE-10`)

### 2.1 Connection Discovery, Hidden Story Seeds & Cross-Pollination (`CE-07.1`, `CE-07.2`, `CE-07.19`)
- **Why This Trio Belongs Together:** All three solve the same writer question: *"How do I generate genuinely original plot richness from what is already in my story?"*
  - **Connection Discovery (`CE-07.1`):** Author selects 2–5 seemingly unrelated nodes/passages (e.g., *Ch. 1 stopped watch at `03:17`* + *Ch. 7 harbor radio signal* + *Nadia's cracked compass*). PCC grounds every selected anchor verbatim in the source text and generates plausible causal, temporal, psychological, scientific, mystical, or symbolic hypotheses—strictly labeled **`Hypothesis`** until applied! (Full worked example in [`04 §1.3`](./04-creative-collaboration-and-proposal-lifecycle.md#13-worked-end-to-end-synthetic-example-port-marrow-stopped-watch-0317--ch-7-radio-signal).)
  - **Discover Hidden Story Seeds (`CE-07.2`):** Deterministic Layer 1 of `NarrativeMemoryIndex` spots *dormant single-appearance details* (objects, locations, or side remarks mentioned once in Ch. 1–3 with zero subsequent references—like *the salt-stained manifest* or *Alden's rusted diving bell*), letting `Discover with AI` propose ways to activate existing story richness **before** inventing arbitrary new MacGuffins.
  - **Creative Cross-Pollination (`CE-07.19`):** Exposed as optional inspiration lenses inside `Suggest Directions` (*Maritime Acoustics · Game Theory · Victorian Clockmaking · Folklore Archetypes · Cognitive Bias*) rather than a standalone tab, always paired with a calm note: *"Creative inspiration only — verify real-world scientific or historical facts independently."*

### 2.2 Foreshadowing Architect, Reverse Twists, Mystery Builder & Threads Board (`CE-07.3`–`CE-07.7`, `CE-07.18`)
- **Consolidation Rationale:** `Plot Promise Tracker`, `Unresolved Story Threads`, `Open Questions Board`, `Foreshadowing Architect`, `Mystery Builder`, and `Reverse Engineering a Twist` all operate on one shared object: a **`NarrativeThread`** (`{ id, kind: 'setup-payoff' | 'mystery' | 'promise' | 'author-question', setupAnchors[], reminderAnchors[], payoffAnchor?, status: 'open' | 'deliberate-mystery' | 'paid-off' }`).
- **Concrete Walkthrough (*Port Marrow — Reverse-Engineering a Twist*):**
  - Author opens **`Story Lab > Foreshadowing & Twist`** and switches toggle to **`Reverse from Payoff`**: *"In Chapter 10, Nadia discovers her own late father helped Tomas cover up the breakwater lantern failure."*
  - PCC scans Chapters 1–9 via `NarrativeMemoryIndex` and proposes **3 subtle, non-obvious plant locations** (never heavy-handed exposition!):
    1. *Ch. 1 (Workshop):* Alden hesitates before mentioning Nadia's father's handwriting in the repair ledger *(Setup)*.
    2. *Ch. 4 (Harbor Office):* A retired lighthouse keeper praises Nadia's father for *"always protecting the harbor's reputation above paperwork"* *(Misdirection / Reminder)*.
    3. *Ch. 7 (Radio Room):* The salvage beacon's callsign matches Nadia's father's initials *(Fair-Play Clue)*.
  - Author selects #1 and #3, previews exact manuscript insertion points + updated Threads Board, and applies or saves to Idea Library.

### 2.3 Character Intelligence, Hidden Motivation, Perspective Switcher & Fictional Interview (`CE-07.8`–`CE-07.10`, `C-06`)
- **Consolidation:** Unified inside **`Story Development > Character Depth`** & **`Scene & Dialogue`**:
  - **Hidden Motivation & Subtext:** Cross-references confirmed traits, relationships, and `Character Knowledge Map` beliefs to suggest unspoken wants, defensive habits, and dialogue subtext (`C-06`).
  - **Perspective Switcher (`CE-07.10`):** Two connected expressions—(a) **World POV Lens** on Story Map (`05 §2.2`), and (b) **Scene POV Test** inside `Develop > Scene & Dialogue` (*"Preview Ch. 2 from Nadia's eyes instead of Alden's — respecting what Nadia does NOT know yet!"*).
  - **Character Interview (`CE-07.9`):** Optional clearly-badged **`Exploratory Roleplay`** drawer inside `Character Depth`. Guardrails: strictly labeled *Fictional Roleplay — does not alter canon*; grounded in confirmed character traits & knowledge as of chosen chapter; 1-click **`Turn this answer into a Character Trait Draft`** if a brilliant line emerges.

### 2.4 Creative Challenge, Crossroads, Scene Simulator & Alternative Endings Lab (`CE-07.13`–`CE-07.17`)
- **Creative Challenge (`CE-07.13`):** Dual entry points—(a) **`Challenge This Idea`** button on any idea card/draft, and (b) **`Challenge Me`** mode inside the `Grill Me` engine (`04 §6.1`). Always constructive, cites specific clichés or causal gaps, offers 2–3 stronger alternatives, lets author keep the original untouched, and **never outputs aesthetic/quality scores**.
- **Crossroads (`CE-07.14`), Scene Simulator (`CE-07.15`), Alternative Endings Lab (`CE-07.16`), and What-If Ripple (`CE-07.17`):** Unified cleanly inside **`Creative Studio > Story Lab`**:
  - *Crossroads / What Happens Next?:* Generates 3 diverging macro trajectories at a chosen chapter boundary.
  - *Scene Simulator:* Auditions a 150–300 word hypothetical beat (e.g., *"What if Nadia confronts Tomas alone on the pier before telling Alden?"*) with 1-click `Insert into Manuscript`, `Save to Idea Library`, or `Discard`.
  - *Alternative Endings Lab:* Generates 3 contrasting endings (*Bittersweet Resolution*, *Noir Moral Compromise*, *Ambiguous Open Ending*), automatically pairing each ending with its **Reverse Setup Requirements** and **Preservation/Lock Conflicts** (`S-01`), ready to `Save as Alternative Project` (`CE-05.2`).

### 2.5 Theme Weaver, Qualitative Tension Map & Private Idea Library (`CE-07.20`–`CE-07.23`)
- **Theme Weaver (`CE-07.20`):** Maps confirmed themes (e.g., *Truth vs. Loyalty*) to scenes via `NarrativeMemoryIndex`, highlighting chapters where the central theme disappears for 4+ scenes.
- **Qualitative Narrative Tension Map (`CE-07.21`):** Rendered as a clean optional **Beat-Type Overlay** on the Dual-Track Timeline (*Quiet Setup · Rising Friction · Confrontation · Revelation · Breathing Room*)—explicitly rejecting synthetic `0–100` numeric excitement graphs.
- **Private Idea Library (`CE-07.22`):** Replaces the confusing label *"Idea Marketplace"* (which suggests public commerce) with **Idea Library**: a searchable, taggable, project-scoped collection of bookmarked sparks, dismissed-but-recoverable ideas, and named Idea Branches (`04 §5.1`).

### 2.6 Selective PCC-Native Productivity Adaptations (`CE-09`, `CE-10`)
Following the owner's explicit delegation in `CE-10` (*"adopt only mechanisms that materially improve the writing experience; create PCC-native versions"*):

| Source Skill Inspiration | PCC-Native Adaptation | Decision & Placement |
|---|---|---|
| **`wait-what` (`CE-09.3`)** | **`Explain Differently`** — 1-click inline action on any complex AI card, interview question, or diagnostic finding: rewrites in plain language with a concrete example from *this* story, why it matters, and what would change (0 new canon facts). | **Adopt (High Value)** — Inline action everywhere AI proposes complex changes. |
| **`handoff` (`CE-09.1`)** | **`Session Brief`** — 1-click readable summary of an active `CreativeSession` (goal, chosen decisions, open questions, locked items, linked scene IDs — never credentials, links rather than duplicating raw text) for resuming days later or exporting to notes. | **Adopt (Lightweight)** — Button in Session header. |
| **`writing-for-agents` (`CE-09.5`)** | **Internal Engineering Discipline** — Progressive disclosure (`S-03`), single source of truth (`NarrativeMemoryIndex`), operation-specific context retrieval, checkable acceptance criteria. | **Adopt Internally** — Not a user-facing screen. |
| **`teach` (`CE-09.4`)** | **Optional `Craft Note`** — Small collapsible *"Why does this craft principle matter?"* note inside `Develop` & `Challenge Me` (e.g., explaining dramatic irony or setup-payoff distance), strictly separate from story facts/diagnostics. Full stateful curriculum **deferred/rejected**. | **Simplify & Defer** — Lightweight tooltip only; no learning-mission subsystem. |
| **`to-questionnaire` (`CE-09.2`)** | **Async Feedback / Beta-Reader Sheet** — Optional Markdown/JSON export of `Open Questions` so a co-author or human beta reader can respond asynchronously and import answers as *drafts*. | **Defer (Phase 3–4)** — Useful niche workflow, low early urgency. |

---

## 3. Six Original Synthesis Proposals (`S-01` – `S-06`) — Beyond Both Streams

Cross-examining `PCC-RESEARCH-01`, `owner-brainstorming-2026-11-28.md`, and PCC's actual codebase surfaced **six original, high-leverage capabilities** not explicitly proposed in either source:

### `S-01` — Lock & Constraint Conflict Preflight *(Concrete Proposal)*
- **Problem Uncovered:** `CE-06.5` introduces repeatable Creative Locks and `CE-01.9` introduces Preservation Policies, while `CE-01.5` (`Story Lab`) encourages bold/radical twists. Without an upfront preflight, a writer wastes AI tokens generating bold ideas that collide with their own active Locks—or worse, gets frustrated when Preview blocks everything.
- **Concrete Interaction:** Before sending a `Studio` or `Develop` request (and again deterministically in Preview), PCC inspects selected scope + active Hard Locks + custom prompt. If the user selects `Alden Voss` (Locked: *"pale gray eyes"*, *"never betrays Nadia"*) and clicks `Radical Twist`, a calm preflight pill appears: *"2 active locks protect Alden's loyalty and traits. [Keep Locks Active] · [Relax Locks for This Sandbox Only → Save as Alternative]"*.
- **Tradeoffs:** Must stay unobtrusive (1-line indicator, never a nagging modal). Deterministic for Hard Locks; lightweight hint for Soft Semantic Locks.

### `S-02` — Scene-Level Subtext & Belief-Clash Detector *(Concrete Proposal)*
- **Problem Uncovered:** Stream 1 proposed Epistemic Lenses (`C-02`) and Voice/Subtext (`C-06`) separately; Owner proposed Character Knowledge Map (`CE-07.11`) and Scene & Dialogue (`CE-01.8`) separately. Nobody connected them at the **active scene level**!
- **Concrete Interaction:** Using `NarrativeMemoryIndex` (deterministic, **0 AI calls!**), whenever a scene contains ≥2 characters whose `TemporalKnowledgeEvent` states *diverge* on the same fact (e.g., Alden `knows` the watch detects lies while Tomas `unknown`; or Alden `falsely-believes` Nadia is hostile while Nadia `knows` she's protecting him), the `Write` Scene Margin & `Develop > Scene & Dialogue` show a subtle **`1 Belief Clash in Scene`** chip. Clicking it lists the exact asymmetry and offers 1-click **`Write Subtext Dialogue Options`** grounded in that clash!
- **Novel Value:** Turns abstract epistemic data directly into unforgettable dramatic craft while drafting.

### `S-03` — Progressive Disclosure "Calm / Deep" Studio Dial *(Concrete Proposal)*
- **Problem Uncovered:** Both streams wrestle with serving a casual 3-page short-story writer AND a 90,000-word mystery novelist simultaneously without making simple tasks feel like an airplane cockpit.
- **Concrete Interaction:** Detailed in [`03 §3.4`](./03-product-architecture-and-ux-alternatives.md#34-progressive-disclosure-dial-s-03--serving-short-stories--novels-alike): **Calm** default mode keeps chrome serene (`Write`, `World`, `Studio`, `Develop`, `Review` with core lenses); **Deep** mode reveals `Story Lab`, `Epistemic Lenses`, `Creative Locks`, `Creative DNA`, `Story Multiverse`, and token preflight telemetry. One click switches anytime; zero data loss or feature removal.

### `S-04` — `Story Q&A` → Scoped Creative Exploration Bridge *(Concrete Proposal)*
- **Problem Uncovered:** `Story Q&A` (`CE-11.1`) answers factual questions about gaps/forgotten characters, while `Focused Development` (`CE-01.4`) asks writers to manually pick entities/chapters to explore. Bridging them turns discovery directly into action!
- **Concrete Interaction:** Any `Story Q&A` response citing specific entities, threads, or chapters automatically renders a secondary action: **`Explore These Elements in Creative Studio ↗`** (or **`Develop This Gap in Develop ↗`**), opening a fresh autosaved draft session pre-populated with those exact verified anchors and entities—never mutating canon.

### `S-05` — Narrative Compression & Redundancy Lens *(Concrete Proposal)*
- **Problem Uncovered:** `CE-01.8` listed `Narrative Compression` as a Story Development candidate, yet neither stream designed how AI compression avoids destroying literary voice or cutting crucial setups!
- **Concrete Interaction:** Inside `Develop > Voice & Tighten`, PCC checks the selected chapter against `NarrativeMemoryIndex` (`threadLedger` + `Creative Locks`):
  1. Flags **repeated exposition** (*"Alden's estrangement from Nadia was already established verbatim in Ch. 1, para 2"*).
  2. Marks **load-bearing beats** (`[🔒 Setup for Ch. 7 radio reveal — do not cut]`).
  3. Proposes tightened prose alternatives that trim redundancy while **provably preserving** every locked setup and confirmed voice trait.

### `S-06` — Unified Patch-to-Visual Diff Projector *(Architectural Enabler)*
- **Problem Uncovered:** `CE-04.3` requires a visual Change Map that is *strictly derived from the exact patch and base revision* (not an AI-hallucinated diagram), while `nlBatchEngine`, `Sync`, `Diagnostics Fixes`, `Story Lab`, and `Selective Transfer` all need previews.
- **Architectural Design:** Build **one pure deterministic TypeScript projector** `projectProposalVisualDiff(baseSnapshot, baseLayout, validatedOps)` that takes *any* `NarrativeProposal` and emits both the exact Before/After textual records AND the coordinate-preserving Change Map SVG graph (dual-encoded with text badges, line styles, and accessible table view). Guarantees 100% parity between visual preview, textual diff, and atomic transaction commit across the entire application.

---

## 4. Explicit Rejections & Deferrals (Cycle 4 Critical Filter)

| Candidate Idea | Disposition | Why Rejected or Deferred |
|---|---|---|
| **Any Numeric Creative / Pacing / Tension / Prose Quality Score** | **Rejected** | Both streams independently converged on rejecting fake quantitative story scores; destroys nuance and encourages generic writing. |
| **Autonomous Background Proactive AI Calls While Typing (`CE-07.25`)** | **Rejected (as Default)** | Violates explicit provider consent, transparent budget discipline, and calm focus; passive local lookup (`0 AI calls`) + explicit manual triggers deliver 90% of the benefit safely. |
| **Literal External Productivity Skill Ports & Stateful Learning Curriculum (`CE-09.4`)** | **Rejected / Simplified** | Violates `CE-10` PCC-native rule; writers want to write stories, not complete LMS courses. Retained only as lightweight optional `Craft Note`. |
| **Separate Top-Level Tabs for Every `CE-07` Capability (25+ screens)** | **Rejected** | Destroys usability; consolidated cleanly into 8 cohesive workflows across 5 spacious workspaces + shared engines. |
| **Full 3-Way Git Merge UI for Alternative Projects (`CE-05`)** | **Rejected** | Overwhelming engineering jargon; replaced with clean **Selective Transfer** via the `Unified Proposal Engine` (`04 §5.3`). |
| **Spoiler-Free Beta-Reader Simulator (`C-08` / `CE-07.12`)** | **Deferred (Exploratory R&D)** | High token cost and spoiler-leakage verification complexity; ship concrete deterministic **Reader Knowledge Track** first (`Phase 2–3`), prototype Simulator separately in `Phase 4` (`05 §2.3`). |
| **Async Questionnaire Export/Import (`CE-09.2`) & Character Roleplay (`CE-07.9`)** | **Deferred (Phase 3–4)** | Genuinely fun/useful secondary workflows, but lower urgency than core reliability, `Creative Studio`, `Story Development`, `Story Q&A`, and `Knowledge Maps`. |
| **Expanding Image Generation Studio / CI-Toolchain Overhaul** | **Deferred (Secondary)** | Explicitly secondary per Assignment §1 & §6.6; preserve existing Image Mode cleanly (`02 §5`) without diverting core narrative-craft effort. |
