# 03 — Product Architecture, Navigation & UX Alternatives

**Assignment:** `PCC-RESEARCH-02` (Section 6.1)  
**Parent Index:** [`README.md`](./README.md)  
**Cross-References:** [`01-comparative-coverage-and-traceability.md`](./01-comparative-coverage-and-traceability.md) · [`02-functional-reassessment-and-trust.md`](./02-functional-reassessment-and-trust.md) · [`04-creative-collaboration-and-proposal-lifecycle.md`](./04-creative-collaboration-and-proposal-lifecycle.md) · [`05-narrative-intelligence-and-visual-design.md`](./05-narrative-intelligence-and-visual-design.md) · [`07-recommended-evolution-roadmap-and-owner-decisions.md`](./07-recommended-evolution-roadmap-and-owner-decisions.md)

> **Core Tension Examined (Assignment §6.1):** `PCC-RESEARCH-01` diagnosed 7 stacked chrome bars, mode-switching friction, and cramped canvas space, recommending a 2-surface studio (`Write` + `World` + persistent Contextual Margin). Simultaneously, the owner (`CE-01`) explicitly disliked cramped, intermingled sidebars and wants **dedicated, spacious workspaces** separating **Creative Studio** (discovering new possibilities) from **Story Development** (strengthening/expanding the existing narrative). How do we honor *both* truths without recreating chrome overload or cramped panels?

---

## 1. Deconstructing the Real UX Problem (Beyond "How Many Tabs?")

Counting top-level tabs is the wrong metric. Both streams actually point to **two complementary laws of writer ergonomics**:

1. **Law of Peripheral Calm (Stream 1's Truth):** When an author is actively typing Chapter 12, looking up a character's eye color, checking a relationship, or seeing a gentle continuity whisper must cost **zero mode switches** and **zero dirty-draft lockouts** (`F-11`).
2. **Law of Spatial Depth (Owner's Truth):** When an author wants to brainstorm 4 diverging plot twists, compare two alternate story branches, inspect a Visual Change Map, run a `Grill Me` interview, or expand a 3-page draft into 5 chapters while protecting the ending, cramming those controls into a 340px right-hand inspector sidebar feels claustrophobic, fragile, and discouraging (`CE-01`).

**Key Architectural Insight — Separate the Shared Engine from Visible Workspaces:**
Having distinct task-focused workspaces does **not** mean building duplicate databases, duplicate review screens, or duplicate AI pipelines! Internally, PCC runs **one shared Narrative Core** (`Working Manuscript`, `Canonical Model & Story Bible`, `Derived Narrative Memory Index`, `Persistent Creative Sessions`, `Unified Proposal Engine`). Visually, PCC exposes clean, spacious **Intent Surfaces** tailored to what the author is doing right now.

```
╔══════════════════════════════════════════════════════════════════════════════╗
║                         VISIBLE WRITER INTENT SURFACES                       ║
║                                                                              ║
║   [ Write ]        [ World ]        [ Creative Studio ]  [ Story Develop ]   ║
║  Drafting +       Visual Map,      Discover, Guided,    Expand, Deepen,      ║
║  Light Margin     Timeline &       Focused, Story Lab   Dialogue, Pacing,    ║
║  (0-switch ref)   Story Bible      (New Possibilities)  Voice (Preserve ID)  ║
║                                                                              ║
║                     + [ Review ] (Diagnostics · Sync · Threads · History)    ║
╠══════════════════════════════════════════════════════════════════════════════╣
║                      ONE SHARED INTERNAL NARRATIVE CORE                      ║
║  • 4 Data Authorities (Sources · Manuscript · Canon Model · Artifacts)       ║
║  • Derived Narrative Memory Index (rebuildable, zero 2nd source of truth)    ║
║  • Persistent Creative Sessions & Idea Library                               ║
║  • Unified Proposal Engine (Diff · Change Map · Validation · Selective Undo) ║
║  • Single Provider & Budget Runtime                                          ║
╚══════════════════════════════════════════════════════════════════════════════╝
```

---

## 2. Three Competing Information Architectures Compared

We evaluate three genuinely different, viable architectures (none of which turns PCC into a generic chatbot or a mandatory linear wizard):

### Architecture 1 — Stream 1 Pure Two-Surface Studio (`Write` + `World` + Deep Margin)
- **Top-Level Navigation:** `Write` | `World` (+ drawers for `Review`, `Import`, `Projects`, `AI Settings`).
- **Where Creative Studio & Story Development Live:** Folded into the right-hand Margin drawer or modal overlays launched from `Write`/`World`.
- **Strengths:** Minimalist top bar; ultra-fast switching between prose and Story Map; strong mobile simplicity.
- **Fatal Weakness Against Owner Needs (`CE-01`, `CE-02`, `CE-04`):** A 340–420px side margin **cannot comfortably host** multi-card direction exploration, per-card version comparison, Visual Change Maps, What-If Ripple breakdowns, or multi-chapter Story Expansion without shrinking either the manuscript or the creative cards into cramped, scrolling slits.

### Architecture 2 — Owner Five-Workspace Spacious Model (`Write` · `Plan` · `Creative Studio` · `Story Development` · `Review`)
- **Top-Level Navigation:** Five equal dedicated rooms (`Write`, `Plan`, `Creative Studio`, `Story Development`, `Review`), keeping each workspace clean and wide with explanatory subtitles, plus global `Projects`, `Import`, `AI Settings`.
- **Strengths:** Completely honors the owner's spatial clarity and clean mental separation between *discovering new ideas* (`Creative Studio`) and *strengthening existing draft* (`Story Development`); zero cramped sidebars.
- **Weakness Without Hybrid Bridges:** If `Write` has no lightweight contextual reference and `Plan`/`World` keeps today's 7 chrome bars, writers still bounce between tabs just to check a character trait (`F-11`) or jump from a manuscript paragraph into a scoped `Creative Studio` session.

### Architecture 3 — Hybrid "Calm Studio Shell" (`Write` · `World` · `Studio` · `Develop` · `Review` + Light Contextual Margin & One-Click Spacious Handoff) *(Recommended)*
- **Top-Level Navigation (1 single clean bar — 56px tall, replacing today's 2 global + 5 stacked bars):**
  - Left: `PCC` · `[Project Switcher ▾]` · `Saved` *(click for History)*
  - Center (5 clear intent pills with hover subtitles):
    1. **`Write`** — *Draft and revise your manuscript*
    2. **`World`** — *Explore your visual Story Map, Timeline, Knowledge & Story Bible*
    3. **`Studio`** *(Creative Studio)* — *Discover new ideas, connections, what-ifs & interviews*
    4. **`Develop`** *(Story Development)* — *Expand, deepen, tighten & polish while preserving story identity*
    5. **`Review`** — *Check continuity, sync manuscript ↔ world & track unresolved threads*
  - Right: `[Story Q&A]` · `[Import]` · `[Projects]` · `[⚙ AI]`
- **How the Hybrid Magic Works:**
  - Inside **`Write`**, the collapsible right **Scene Margin** is intentionally **lightweight and non-cramped**: it shows ONLY *(a) Scene Cast & Relationships (passive, 0 AI calls)*, *(b) Continuity Whispers for this scene*, *(c) quick `Story Q&A` lookup*, and *(d) 1-click contextual launch buttons* — **`Explore in Studio ↗`** (pre-scoped to selected text/characters!), **`Develop Scene ↗`** (pre-scoped to this scene with Preservation Policy active!), or **`Ask Grill Me ↗`**.
  - Inside **`World`**, the visual Story Map receives **≥72% of desktop viewport height** (1 top bar + 1 slim canvas toolbar; zero permanent 6-term evidence legend strip; zero duplicate footer bar). Multi-selecting 2–3 graph nodes (e.g., *Brass Pocket Watch* + *Harbor Radio Signal*) pops a calm floating action chip: **`Find Hidden Connections in Studio ↗`** or **`Grill Me on These ↗`**!
  - Inside **`Studio`** and **`Develop`**, the writer gets **100% full-width dedicated space**—spacious idea cards, multi-select direction chips, split-pane Visual Change Maps, and persistent Session Switcher—with a single clean **`Return to Ch. 2 in Write ←`** breadcrumb that remembers exact cursor/scroll position!

### Head-to-Head Comparison Matrix

| Criterion | Arch 1: Pure 2-Surface + Margin | Arch 2: Strict 5 Separate Workspaces | Arch 3: Hybrid Calm Studio Shell *(Rec.)* |
|---|---|---|---|
| **Spaciousness for Deep Creative Work (`CE-01`)** | Low (cramped margin/modals) | **High** | **High** (100% full-width Studio & Develop) |
| **Zero-Switch Reference While Drafting (`C-01`)** | **High** | Low (must switch tabs) | **High** (lightweight Scene Margin + instant autosave) |
| **Visual Canvas Height in `World` (`F-12`)** | **High (~75%)** | Medium–High (if chrome cleaned) | **High (~72–75%)** |
| **Clear Separation: New Ideas vs. Strengthen Draft** | Low (blurs intents) | **High** | **High** (explicit `Studio` vs. `Develop` with subtitles) |
| **Discoverability of `Review`, `History`, `Story Q&A`** | Medium (tucked in drawers) | **High** | **High** (top-level `Review` + `Saved`/History + `Story Q&A`) |
| **Session Continuity Across Workspaces** | High | Medium | **High** (autosave flush + persistent active session pill) |
| **Small-Screen / Mobile Ergonomics (`390×844`)** | **High** | Medium | **High** (single bottom/compact nav + full-screen rooms, no split squeeze) |
| **Implementation Complexity** | Medium | Medium | Medium–High (modular; shippable in vertical slices) |

---

## 3. Concrete Competing Layouts (ASCII Wireframes, `1440×900`)

### Layout A — Competing Pure 2-Surface Layout (Arch 1, illustrating why heavy creative work cramps)

```
┌──────────────────────────────────────────────────────────────────────────────────┐
│ PCC  [Port Marrow ▾]  Saved        ( Write | World )     [Review 3] [Import] [⚙] │
├──────────────┬───────────────────────────────────────┬───────────────────────────┤
│ OUTLINE      │ Ch 2: The Evening Auction             │ CO-CREATOR MARGIN (360px) │
│ Ch 1 Ledger  │ Two hours later, just after dusk on   │ [Cast][Ideas][Develop][?] │
│▸Ch 2 Auction │ Tuesday, Tomas Reed stepped into the  │ ───────────────────────── │
│ Ch 3 Harbor  │ narrow workshop...                    │ ⚠ CRAMPED FOR STUDIO:     │
│              │                                       │ • 3 Idea cards stack deep │
│              │                                       │ • Direction chips wrap 4× │
│              │                                       │ • No room for Change Map  │
│              │                                       │ • Hard to compare v1 vs v2│
└──────────────┴───────────────────────────────────────┴───────────────────────────┘
```

### Layout B — Recommended Hybrid Calm Studio Shell: `Write` Surface (Arch 3)

```
┌──────────────────────────────────────────────────────────────────────────────────┐
│ PCC [Port Marrow▾] Saved │ Write · World · Studio · Develop · Review │ Q&A ⊕ 📁 ⚙│
├──────────────┬───────────────────────────────────────────┬───────────────────────┤
│ OUTLINE      │ Chapter 2: The Evening Auction            │ SCENE MARGIN (280px)  │
│ + Ch  + Sc   │ POV: Alden · Port Marrow · Tue Dusk       │ [Cast] [Whispers (1)] │
│ ──────────── │ ───────────────────────────────────────── │ ───────────────────── │
│ ▾ Part I     │ Two hours later, just after dusk on       │ IN THIS SCENE (local) │
│   Ch 1 Ledger│ Tuesday, Tomas Reed stepped into the      │ • Alden Voss          │
│ ▸ Ch 2 Auctn │ narrow workshop carrying a leather        │   68 · pale gray eyes │
│   Ch 3 Harbr │ satchel. Alden looked up, his [dark       │   ↳ estranged uncle   │
│              │ brown eyes]¹ narrowing as the brass       │     of Nadia Kestrel  │
│              │ pocket watch clicked twice counter-       │ • Tomas Reed          │
│              │ clockwise inside his waistcoat.           │   ↳ seeks Brass Watch │
│              │                                           │                       │
│              │   ┌───────────────────────────────────┐   │ CONTINUITY WHISPER    │
│              │   │ Selection menu (on highlight):    │   │ ¹ "dark brown eyes"   │
│              │   │ [Continue] [Dialogue] [Develop ↗] │   │   Ch 1 says pale gray │
│              │   │ [Explore in Studio ↗] [Grill Me]  │   │   [Preview fix][Keep] │
│              │   └───────────────────────────────────┘   │                       │
│              │                                           │ QUICK LAUNCH          │
│              │ [Focus Mode]     428 words · Saved 2s ago │ [Develop Scene ↗]     │
│              │                                           │ [Explore in Studio ↗] │
└──────────────┴───────────────────────────────────────────┴───────────────────────┘
  Focus Mode collapses BOTH Outline & Scene Margin → pure 100% serene writing sheet.
```

### Layout C — Recommended Hybrid Calm Studio Shell: Spacious `Creative Studio` Surface (Arch 3)

```
┌──────────────────────────────────────────────────────────────────────────────────┐
│ PCC [Port Marrow▾] Saved │ Write · World · Studio · Develop · Review │ Q&A ⊕ 📁 ⚙│
├──────────────────────────────────────────────────────────────────────────────────┤
│ CREATIVE STUDIO — Discover new possibilities & original ideas  [← Back to Ch 2]  │
│ Modes: ( Discover with AI | Guided / Grill Me | Focused [Active] | Story Lab )   │
│ Active Session: "Watch & Radio Link" (Autosaved) [Sessions ▾] [Idea Library (6)] │
├───────────────────────────┬──────────────────────────────────────────────────────┤
│ SCOPE & STEERING (300px)  │ SPACIOUS EXPLORATION CANVAS (100% remaining width)   │
│ ───────────────────────── │                                                      │
│ Selected Scope (2):       │ ┌─────────────────────────┐ ┌──────────────────────┐ │
│ • Brass Pocket Watch [×]  │ │ IDEA A (v2 of 2 ▾)   ★  │ │ IDEA B (v1)       ☆  │ │
│ • Ch 7 Radio Signal  [×]  │ │ The Calibration Harmonic│ │ The Smuggler's Code  │ │
│ [+ Pick from Map / Text]  │ │ Both devices share a    │ │ The watch ticks at   │ │
│                           │ │ hidden quartz crystal…  │ │ the exact harbor…    │ │
│ Creative Intensity:       │ │                         │ │                      │ │
│ (Subtle|Bal|[Bold]|Rad)   │ │ Grounded in: Ch 1, Ch 7 │ │ Grounded in: Ch 1, 7 │ │
│                           │ │ [Preview] [Develop ▾]   │ │ [Preview] [Develop ▾]│ │
│ Creative Locks (2 active):│ │ [Regen] [Edit] [Save]   │ │ [Regen] [Edit] [Save]│ │
│ 🔒 Keep Nadia's integrity │ │ [Explain differently]   │ │ [Combine A + B]      │ │
│ 🔒 No supernatural magic  │ └─────────────────────────┘ └──────────────────────┘ │
│ [+ Add another lock]      │                                                      │
│                           │ DIRECTIONS FOR IDEA A (Multi-select; 0 AI calls yet) │
│ Creative Compass:         │ [✓] More scientific  [ ] Darker stakes  [✓] Subtler  │
│ Leaning: Noir · Grounded  │ [ ] Unexpected twist [ ] Surprise Me   [+ More dirs] │
│ [Ask Grill Me instead ↗]  │                                                      │
│                           │ Your own direction: [______________________________] │
│                           │   [Suggest Directions]   [Generate Idea]             │
│                           │   [Develop Idea A with 2 Selected Directions →]      │
├───────────────────────────┴──────────────────────────────────────────────────────┤
│ Selected for Apply: 1 idea (3 concrete changes)   [Final Preview & Change Map →] │
└──────────────────────────────────────────────────────────────────────────────────┘
```

### Layout D — `Story Development` Surface (Arch 3 — Preserving Story Identity)

```
┌──────────────────────────────────────────────────────────────────────────────────┐
│ PCC [Port Marrow▾] Saved │ Write · World · Studio · Develop · Review │ Q&A ⊕ 📁 ⚙│
├──────────────────────────────────────────────────────────────────────────────────┤
│ STORY DEVELOPMENT — Strengthen & expand your story while keeping its core intact │
│ Lenses: ( Expand & Pace | Character Depth | Scene & Dialogue | Voice & Tighten ) │
├───────────────────────────┬──────────────────────────────────────────────────────┤
│ TARGET & PRESERVATION     │ SPACIOUS DEVELOPMENT WORKBENCH                       │
│ ───────────────────────── │                                                      │
│ Target: Whole Story       │ Mode: Expand 3-Page Draft → 5-Chapter Outline+Beats  │
│ (or Pick Chapter / Scene) │                                                      │
│                           │ PRESERVATION CHECK (Preflight):                      │
│ Preservation Policy:      │ ✓ Core plot intact   ✓ Ending unchanged              │
│ [✓] Keep core plot        │ ✓ No new twists      ✓ Alden/Nadia tone preserved    │
│ [✓] Keep ending           │                                                      │
│ [✓] Keep existing cast    │ BEFORE (Ch 1 — 420 words) │ PROPOSED EXPANSION       │
│ [✓] Keep voice & tone     │ Thin transition from      │ Beat 1A: Breakwater dock │
│ [ ] Allow new minor scenes│ ledger discovery straight │   inspection (quiet mood)│
│                           │ to workshop argument.     │ Beat 1B: Alden tests the │
│ Active Locks (2):         │                           │   watch on a dockhand…   │
│ 🔒 Keep Alden's pale gray │                           │ [Edit Plan] [Draft Ch 1] │
│ [+ Add another lock]      │                           │ [Preview & Apply →]      │
└───────────────────────────┴──────────────────────────────────────────────────────┘
```

### 3.4 Progressive Disclosure Dial (`S-03` — Serving Short Stories & Novels Alike)
To prevent overwhelming a first-time user with every advanced control while giving novelists full power, Arch 3 introduces a clean **Workspace Depth** setting (subtle toggle in the Settings menu or Workspace header, defaulting to **Calm** for new/short projects and suggesting **Deep** once a manuscript exceeds 3 chapters):
- **Calm (Default):** Shows `Write`, `World` (`Story Map`, `Timeline`, `Story Bible`), `Studio` (`Discover`, `Guided/Grill Me`), `Develop` (`Expand`, `Scene & Dialogue`), and `Review` (`Checks & Sync`). Hides Multiverse lineage trees, token preflight math, Epistemic Lens filters, and Creative DNA until invited.
- **Deep (Novel / Power Mode):** Unlocks `Focused` & `Story Lab`, Epistemic Perspective Lenses (`Who Knows What?`), `Character Knowledge Map`, `Creative Locks` + `Creative DNA`, `Story Multiverse`, and detailed token/coverage manifests. **Zero features are removed**—advanced controls simply step forward when the story grows!

---

## 4. Five End-to-End Writer Journeys in the Hybrid Calm Studio Shell

### Journey 1 — Seed-to-Story (*The Backward-Ticking Watch*, First-Time Writer)
1. Clicks **`+ New`** → chooses from 3 equal doors: **`Start from an Idea`**, **`Blank Manuscript`**, or **`Import Existing Story`**.
2. Picks **`Start from an Idea`**, types 1 sentence → lands in spacious **`World`** (Belief Graph blooms visually with 4 nodes) with an optional **`Inspire Me / Grill Me`** card beside it (zero forced wizard; 1 high-leverage question at a time, plus `Generate Opening Scene Now` always visible).
3. Answers 2 questions (watching `Nadia Kestrel` sprout on the live draft sketch) → clicks **`Preview & Apply to World`** → clicks **`Draft Opening Beat in Write`** → streams Chapter 1 directly into **`Write`** where the author immediately edits prose with zero lockouts.

### Journey 2 — Imported Existing Narrative (*Port Marrow*, 12-Chapter `.docx`)
1. Clicks **`Import`** (visible on both desktop AND mobile!) → drops `.docx` → in <1s, immutable source is archived, chapters split cleanly, and the manuscript opens immediately in **`Write`** (0 AI calls spent yet).
2. Calm opt-in banner offers **`Map Chapter 1 (1 AI call)`** or **`Map Selected Chapters`** → author chooses Ch. 1–3 → extraction runs with deterministic quote anchoring (`02 §2.3`), surfacing proposed characters/rumors in **`Review / Proposed`** with click-to-highlight quotes.
3. Author approves characters into **`World`**, where the **Story Map** and **Dual-Track Timeline** instantly populate.

### Journey 3 — Focused Creative Exploration (*Connecting Watch `03:17` + Ch. 7 Radio Signal*)
1. In **`World`**, author multi-selects two nodes (*Brass Pocket Watch* + *Ch. 7 Radio Signal*) and clicks floating chip **`Explore Connection in Studio ↗`**.
2. **`Studio > Focused`** opens full-width with both items pre-loaded in scope, `Creative Intensity: Bold`, and active Lock `No supernatural magic`.
3. Author explores 3 causal/scientific links, multi-selects directions, edits Idea A, checks the **Visual Change Map**, and chooses **`Save as Alternative Project`** (stays safely in current project with `Continue Current Project` default button!) OR **`Apply to Current Project`**.

### Journey 4 — Story Expansion Preserving Core Identity (*3-Page Short Story → 5 Chapters*)
1. Author opens **`Develop > Expand & Pace`**, sets Target = `Whole Story`, checks Preservation Policy (`Keep core plot`, `Keep ending`, `No new twists`, `Keep voice`).
2. PCC analyzes pacing gaps via the `Narrative Memory Index` and proposes structural breathing room and character-interiority beats (not random new villains!).
3. Author tweaks Beat 2, previews exact before/after chapter diffs, applies cleanly, and clicks **`Open Ch. 2 in Write`**—all while keeping the `Studio` untouched.

### Journey 5 — Full Editorial Review, History & Project Operations
1. Author clicks **`Review`** (badge `3`) → sees unified **Continuity Diagnostics** (with honest coverage manifest: *"Checked 12 of 12 scenes via Memory Index"*), **Manuscript ↔ World Sync**, and **Unresolved Threads & Mysteries** cleanly separated from optional creative suggestions.
2. Clicking an eye-color contradiction opens inline before/after preview + exact quote highlight → 1-click **Apply Fix** (no extra technical staging screen).
3. Clicking **`Saved`** in the global header opens the single consolidated **Version History & Selective Undo** drawer; clicking **`Projects`** opens the Project Hub (with optional **Story Multiverse** lineage toggle, backups, and ZIP exports).

---

## 5. Small-Screen (`390×844`), Focus Mode & Accessibility Guarantees

- **Zero Hidden Critical Actions on Mobile:** Unlike today's `Header.tsx` (which hides `Import` via `hidden sm:inline-flex`, `01-independent-discovery/03 §6`), the compact top bar + overflow menu exposes `Import`, `Story Q&A`, and `Projects` reliably at `390px`.
- **Single-Room Mobile Layout:** On `<768px`, the 5 primary intent tabs sit in a crisp bottom navigation bar (`Write · World · Studio · Develop · Review`); the `Scene Margin` in `Write` collapses into a bottom sheet (`Cast & Whispers`) so the prose editor always gets 100% screen width.
- **True Focus Mode:** Pressing `Focus Mode` in `Write` hides the top navigation bar, Outline, and Scene Margin simultaneously, leaving only the manuscript page, word count, truthful save indicator, and an `Exit Focus` corner button.
- **Accessibility:** Every graph view (`World`, `Change Map`, `Timeline`, `Multiverse`) provides keyboard navigation and a 1-click **Accessible Table / List View** alternative (`CE-04`, Assignment §6.5).
