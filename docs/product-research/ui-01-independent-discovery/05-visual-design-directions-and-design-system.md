# 05 — Visual Design Directions and Provisional Design System

**Assignment:** `PCC-UI-RESEARCH-01` — Independent UX, Information Architecture & Visual Design Discovery  
**Status:** Complete (Cycle 3 Visual Divergence, Cycle 4 Critique & Cycle 5 System Specification)  
**Scope:** Four distinct writer-specific visual design directions with representative desktop (`1440×900`) and constrained-width (`390×844` / `1024×768`) conceptual ASCII wireframes, comparative evaluation, and a complete **Provisional Design System** resolving the token hijacking (`UX-07`), WCAG AA contrast failures (`UX-08`), missing focus rings (`ManuscriptEditor.tsx:48`), and sub-36px button overcrowding (`Observed in preview`).

> **Important Label:** All wireframes, palettes, and component specifications in this document are **`Proposal`** concepts — not screenshots of implemented screens — and leave final aesthetic selection open for the Human Owner (`UID-03`).

---

## 1. Why Generic SaaS Styling Fails Fiction Writers

Authors spend **2 to 6 continuous hours** inside a writing workspace. Generic SaaS visual conventions — pure `#FFFFFF` glare, electric `#2563EB` buttons, heavy drop-shadow bento cards on every element, and `11px` muted gray metadata — actively sabotage long-form reading and emotional focus:
- **Glare & Eye Fatigue:** Pure white (`#FFFFFF`) against pure black (`#000000`) causes halation over multi-hour drafting sessions.
- **Card-ITIS (Ornamental Box Noise):** Wrapping every toolbar, legend, inspector section, and paragraph inside heavy bordered cards fragments the writer's visual field (visible today in `AdaptivePlanWorkspace.tsx` where nested `rounded-xl border` boxes stack inside each other).
- **Semantic Indistinguishability:** When everything uses the same neutral card + single accent color, the eye cannot peripherally distinguish **Canon Prose**, **Unreviewed AI Drafts**, **Character Beliefs**, and **Protected Locks**.

---

## 2. Four Distinct Writer-Specific Visual Design Directions

Each direction embodies a genuinely different literary atmosphere, spatial density, and visual grammar — not four hue swaps of one template.

### Direction A: "Warm Literary Press" *(Refined Evolution of PCC's Parchment & Plum Heritage)*

- **Writer-Specific Rationale:** Honors fine bookmaking — natural rag paper, warm charcoal ink, optical-sized `Literata` serif prose, and deep bookcloth plum accents — while eliminating today's four conflicting styling dialects (`UX-07`) and fixing failed muted-gray contrast (`UX-08`).
- **Atmosphere & Emotional Character:** Tactile, grounded, calm, literary, trustworthy; feels like an editorial desk and typeset galley rather than software chrome.
- **Color Palette (Light / Dark):**
  - Light Canvas: `#F7F5EF` (warm rag paper) | Elevated Sheet: `#FFFDF9` | Draft/Proposal Tint: `#F6EFF4` (soft plum-parchment)
  - Light Ink: `#232024` (primary, `~14.9:1` on `#F7F5EF`) | Secondary Ink: `#57525A` (`~7.1:1`, AAA/AA safe — replacing failed `#827d83`!)
  - Primary Action Accent: `#62405B` (deep editorial plum, `~8.4:1` with white text)
  - Semantic Ink Set: Canon/Verified Forest `#265C4B` | Belief/Epistemic Ochre `#8A5A12` | Inference Slate-Blue `#2E5278` | Conflict Crimson `#9C2F39`
  - Dark Canvas: `#19171B` (warm obsidian-plum) | Elevated Sheet: `#232026` | Draft Tint: `#2B232C` | Primary Ink: `#EFECE6` (`~13.8:1`) | Secondary Ink: `#B4ADB8` (`~7.4:1`)
- **Typography & Density:** `Literata` (`18px`, `1.72` line-height, `65–72ch` measure) for prose; `DM Sans` (`13–14px`) for restrained chrome; hairline `1px` borders instead of drop shadows.

```text
DIRECTION A — "WARM LITERARY PRESS" (1440x900 DESKTOP — WRITE + COMPANION WORLD ENTITY) [PROPOSAL]
+---------------------------------------------------------------------------------------------------+
| [PCC] Izmir Lighthouse v |  Projects  [Write]  World  Studio  Develop  Review | [o Gemini] [Cmd+K]| 48px
+---------------------------------------------------------------------------------------------------+
| CHAPTERS            |  Ch. 4 — The Sealed Manifest             [Edit | Read] [Focus] [Locks: 2]   |
|                     |  -------------------------------------------------------------------------- |
| 1. Foghorn          |                                                                             |
| 2. Brass Lens       |  The salt had welded the tin seam shut. Leyla worked the blade beneath      |
| 3. 1954 Ledger      |  the lip until the metal gave with a dry crack, smelling of pine resin      |
| > 4. Sealed Manif.  |  and old harbor diesel.                                                     |
|   * 1,420 words     |                                                                             |
|   * 1982 Summer     |  | "He never signed the August clearance," she murmured.                    |
| 5. Harbor Clerk     |  |                                                                          |
|                     |  +--- [Selection Action: Deepen Subtext | Tighten | Ask Story | Cmd+J] -----+
| [+ Scene]           |                                                                             |
|                     |  -------------------------------------------------------------------------- |
|                     |  Saved just now                                  [Split: Leyla Profile  x]  |
+---------------------+---------------------------------------------------+-------------------------+
                                                                          | LEYLA (Character)       |
                                                                          | Canon · 9 appearances   |
                                                                          |                         |
                                                                          | KNOWN FACTS (solid)     |
                                                                          | - Retired keeper (Ch.1) |
                                                                          |                         |
                                                                          | BELIEFS (dashed/ochre)  |
                                                                          | ~ Suspects clerk forged |
                                                                          |   logbook (Ch. 5 §1 ->) |
                                                                          |                         |
                                                                          | [Open in World Map ->]  |
                                                                          +-------------------------+

DIRECTION A — CONSTRAINED MOBILE (390x844 — WRITE VIEW) [PROPOSAL]
+---------------------------------------+
| [=] Izmir Lighthouse    [o] [Cmd+K]   | 52px  (Menu holds +New, Import, Projects, About, Theme)
+---------------------------------------+
| Ch. 4 — Sealed Manifest  [Edit|Read]  | 44px
+---------------------------------------+
| The salt had welded the tin seam      |
| shut. Leyla worked the blade beneath  |
| the lip until the metal gave with a   |
| dry crack...                          |
|                                       |
| (Clean 18px Literata prose sheet —    |
|  zero permanent security disclaimer)  |
|                                       |
+---------------------------------------+
| [Projects][Write][World][Studio][Rev] | 56px  (5x >=44px touch targets with icon + label)
+---------------------------------------+
```

---

### Direction B: "Quiet Ink & Monograph" *(High-Clarity Swiss-Editorial Architecture)*

- **Writer-Specific Rationale:** Designed for complex multi-POV novels, historical fiction, and research-heavy narratives where **maximum typographic clarity and zero visual warmth bias** help the writer audit intricate plot structures, timelines, and continuity diffs effortlessly.
- **Atmosphere & Emotional Character:** Museum-catalogue restraint — cool stone alabaster paper, crisp carbon black ink, whisper-thin structural rules, and a single disciplined **Editorial Vermilion / Deep Cobalt** accent used *only* for active intent and semantic distinctions.
- **Color Palette (Light / Dark):**
  - Light Canvas: `#F4F4F2` (cool archival paper) | Sheet: `#FCFCFA` | Draft Tint: `#F0F4F8` (cool slate-vellum)
  - Light Ink: `#18191B` (`~16.2:1`) | Secondary Ink: `#52565E` (`~6.9:1`)
  - Primary Action Accent: `#204A7A` (archival cobalt, `~8.7:1` with white) | Editorial Highlight: `#A83226` (monograph vermilion, for locks/conflicts)
  - Dark Canvas: `#141517` | Sheet: `#1C1E21` | Draft Tint: `#1B2430` | Primary Ink: `#EDEDEA` | Secondary Ink: `#A5ABB6`
- **Typography & Density:** Slightly tighter architectural grid (`8px` baseline), crisp uppercase small-caps section labels (`11px`, `0.06em` tracking, `>=5.5:1` contrast), generous whitespace around editorial tables, diffs, and dual-track timelines.

```text
DIRECTION B — "QUIET INK & MONOGRAPH" (1440x900 DESKTOP — REVIEW DIFF & CHANGE MAP) [PROPOSAL]
+---------------------------------------------------------------------------------------------------+
| PCC / IZMIR LIGHTHOUSE        Projects  Write  World  Studio  Develop  [Review]    [Ready] [Cmd+K]| 48px
+---------------------------------------------------------------------------------------------------+
| ISSUES (3)   SYNC   HISTORY |  CONTINUITY ISSUE · CH. 2 vs CH. 7              [Decline] [Apply ->]|
|                             |  ================================================================== |
| [!] Brass Lens Contradict.  |  SOURCE EVIDENCE                        FIX ALTERNATIVES            |
|     Ch. 2 <-> Ch. 7         |  +----------------------------------+   (o) Fix A: Replica lens     |
|                             |  | Ch. 2 §2: "...the 1954 brass     |       in Ch. 7 (Recommended)  |
| [~] Unclear 1954 Date       |  | lens shattered in the '61 gale." |   ( ) Fix B: Revise Ch. 2     |
|     Ch. 3 (Uncertain)       |  +----------------------------------+   ( ) Mark intentional memory |
|                             |  | Ch. 7 §4: "...polishing the      |                               |
| [ ] Clerk Name Variant      |  | original 1954 brass lens..."     |   EXACT PROSE DIFF (Ch. 7)    |
|     Ch. 5                   |  +----------------------------------+   - original 1954 brass lens  |
|                             |                                         + 1962 replacement lens     |
| --- READINESS (2) --------- |  ------------------------------------------------------------------ |
| * Ch. 8 missing story-time  |  CONFIRMED PATCH CHANGES (Exact)      | POSSIBLE DOWNSTREAM (Check) |
| * 1 unreviewed import item  |  [Changed] Ch. 7 §4 text              | ? Ch. 9 mentions "brass"    |
|                             |  [Changed] Object: Brass Lens state   |   (Uncertain — verify)      |
+-----------------------------+---------------------------------------+-----------------------------+

DIRECTION B — CONSTRAINED TABLET/MOBILE (390x844 — REVIEW ISSUE DETAIL) [PROPOSAL]
+---------------------------------------+
| <- Issues (3)     [Apply Fix A]       | 52px
+---------------------------------------+
| CONTINUITY: Brass Lens (Ch.2 / Ch.7)  |
| [Evidence]  [Fix Diff]  [Impact (1)]  | 44px segmented tabs
+---------------------------------------+
| BEFORE (Ch. 7 §4):                    |
| "...polishing the [original 1954      |
| brass lens] before dusk..."           |
|                                       |
| AFTER (Fix A):                        |
| "...polishing the [1962 replacement   |
| lens] before dusk..."                 |
|                                       |
| [Edit Proposal]  [Save Alternative]   |
+---------------------------------------+
```

---

### Direction C: "Nocturnal Desk Lamp" *(Low-Glare Warm Charcoal Atelier for Long Evening Sessions)*

- **Writer-Specific Rationale:** Many novelists draft late at night. Most "dark modes" are harsh cold blue-gray (`#0F172A` / `#1F2937` — seen in PCC's leftover `--color-gray-850: #1f2937`) that feel like a code IDE and disrupt circadian calm. Direction C treats **warm espresso-charcoal + amber desk-lamp light** as a first-class co-equal theme alongside a soft sunlit linen day mode.
- **Atmosphere & Emotional Character:** Intimate, cozy, deeply immersive — like writing by a brass banker's lamp on dark walnut wood. Eliminates harsh blue light while maintaining verified `>=7:1` warm ivory readability.
- **Color Palette (Dark-First / Paired Sunlit Day):**
  - Dark Canvas: `#161412` (warm espresso) | Sheet: `#1F1C19` | Draft/Proposal Tint: `#2A241B` (warm candle-amber wash)
  - Dark Ink: `#ECE6DC` (`~13.6:1`) | Secondary Ink: `#B3A99A` (`~7.1:1`)
  - Primary Action Accent: `#C98A3A` (warm antique ochre/amber, paired with `#161412` dark ink text at `~7.6:1` — avoiding unreadable white-on-yellow!)
  - Semantic Ink Set (Dark): Fact Sage `#77B398` | Belief Amber `#E2A952` | Inference Sky `#84AED8` | Conflict Terracotta `#E07872`
  - Paired Day Mode: `#F6F2EA` linen canvas, `#FFFDF8` sheet, `#7A4E16` deep chestnut-amber accent (`~6.8:1` on white).
- **Typography & Density:** Slightly wider line height (`1.78`) in dark mode to prevent light-on-dark stroke crowding, zero crisp white hairlines (soft `#332E28` rules instead).

```text
DIRECTION C — "NOCTURNAL DESK LAMP" (1440x900 DESKTOP — CREATIVE STUDIO EXPLORATION) [PROPOSAL]
+---------------------------------------------------------------------------------------------------+
| (o) Izmir Lighthouse v | Projects  Write  World  [Studio]  Develop  Review | [Ready] [Jobs] [K]   | 48px
+---------------------------------------------------------------------------------------------------+
| SESSIONS               |  CREATIVE STUDIO · Scope: Act II + Harbor Master  [Intensity: Balanced v]|
|                        |  ----------------------------------------------------------------------- |
| * Harbor Twists (3)    |  DIRECTIONS (Choose to explore, or add your own)                         |
|   Updated 18m ago      |  +----------------------+ +----------------------+ +-------------------+ |
|   Act II               |  | [x] Unwitting        | | [ ] Forged Clearance | | [+ More Directs]  | |
|                        |  |     Complicity       | |     Chain            | | [+ Custom...]     | |
| o Premise Interview    |  +----------------------+ +----------------------+ +-------------------+ |
|   Completed · 6 Qs     |                                                                          |
|                        |  CONCRETE STORY IDEAS (Exploration Drafts — Not Applied to Canon)        |
| o Ending What-Ifs      |  +----------------------------------+ +--------------------------------+ |
|   2 alternatives saved |  | [ ] IDEA 1 · Unwitting Complic.  | | [x] IDEA 2 · Missing Manifest  | |
|                        |  | Harbor master signed blank forms | | The 1954 manifest page was     | |
| --- COLLECTION ------- |  | believing they were grain logs...| | pasted inside Leyla's hymnal...| |
| * Starred Ideas (7)    |  | [Refine] [Regen] [Challenge]     | | [Refine] [Regen] [Edit]        | |
| * Visual Mood (2)      |  | [Save]   [Dismiss]               | | [* Saved] [Preview Patch ->]   | |
|                        |  +----------------------------------+ +--------------------------------+ |
|                        |  Selected (1): [Combine Selected] [Save to Collection] [Preview Patch]   |
+------------------------+--------------------------------------------------------------------------+

DIRECTION C — CONSTRAINED MOBILE (390x844 — STUDIO IDEA CARD) [PROPOSAL]
+---------------------------------------+
| [=] Studio: Harbor Twists   [Sessions]| 52px
+---------------------------------------+
| Scope: Act II · Intensity: Balanced   |
| [Unwitting Compl. v] [+ Direction]    |
+---------------------------------------+
| . . . EXPLORATION DRAFT . . . . . . . |
| IDEA 2 — Missing Manifest             |
| The 1954 manifest page was pasted     |
| inside Leyla's mother's hymnal...     |
|                                       |
| [Refine]  [Regenerate]  [Challenge]   |
| [* Saved]         [Preview Patch ->]  |
+---------------------------------------+
| [Projects][Write][World][Studio][Rev] | 56px
+---------------------------------------+
```

---

### Direction D: "Cartographer's Folio" *(Tactile Spatial & Margin-Note Editorial Aesthetic)*

- **Writer-Specific Rationale:** Celebrates PCC's unique superpower — **combining prose writing with visual narrative intelligence**. Distinguishes the two mental surfaces *physically*: prose always rests on clean unruled rag paper, while spatial maps, timelines, and knowledge matrices rest on a whisper-subtle dot/linen cartographic mat (`opacity: 0.06`, zero visual clutter) with fine calligraphic margin notes in `Write`'s optional Scene Margin.
- **Atmosphere & Emotional Character:** Bespoke, memorable, craft-forward — feels like a novelist's leather folio containing crisp manuscript pages alongside folded harbor charts and pinned margin cards.
- **Color Palette (Light / Dark):**
  - Prose Paper: `#FAF8F3` | Spatial Map Mat: `#F1EFE8` (subtle 24px dot grid `#D7D2C6`) | Margin Note Card: `#F5F1E6`
  - Primary Action Accent: `#235347` (deep cartographer's botanical forest, `~8.9:1` with white)
  - Secondary Epistemic Accent: `#7D4E57` (burgundy-plum for character beliefs) + `#9A6324` (brass ochre for open mysteries)
  - Dark Mode: Prose Sheet `#1C1B19` | Spatial Map Mat `#151514` (subtle `#2B2A27` dots) | Forest Accent `#6EB59E` (with `#111614` ink).

```text
DIRECTION D — "CARTOGRAPHER'S FOLIO" (1440x900 DESKTOP — WORLD DUAL-TRACK & GRAPH) [PROPOSAL]
+---------------------------------------------------------------------------------------------------+
| [PCC] Izmir Lighthouse v | Projects  Write  [World]  Studio  Develop  Review | [o Ready] [Cmd+K]  | 48px
+---------------------------------------------------------------------------------------------------+
| WORLD VIEWS          | [Map] [Knowledge] [Timeline] [Story Bible] [Threads] [Ask Story]           |
|                      | -------------------------------------------------------------------------- |
| Filter: All Cast v   |   .   .   .   .   .   .   .   .   .   .   .   .   .   .   .   .   .   .    |
| [ ] Show Inferred    |               [Captain Arif] =====(forged)=====> [1954 Logbook]            |
| [x] Group by Faction |                 /        \                           ^                     |
|                      |       (father of)        (hired)                     | (hides truth of)    |
| FOCUS ENTITY         |           v                 v                        |                     |
| > Leyla              |        [Leyla] - - - -(suspects)- - - -> [Harbor Clerk]                    |
|   Capt. Arif         |           |     (dashed = Character Belief)                                |
|   Harbor Clerk       |           +-- (lives at) --> [Karaburun Lighthouse]                        |
|   1954 Logbook       |   .   .   .   .   .   .   .   .   .   .   .   .   .   .   .   .   .   .    |
|                      |   [Legend ?]                                   [Table View] [Zoom 100% + -]|
+----------------------+----------------------------------------------------------------------------+

DIRECTION D — CONSTRAINED TABLET (1024x768 — WORLD WITH COLLAPSED RAIL) [PROPOSAL]
+---------------------------------------------------------------------------------+
| [PCC] Izmir Lighthouse v | Projects Write [World] Studio Develop Review [Cmd+K] | 48px
+---------------------------------------------------------------------------------+
| [Filters] [Map] [Knowledge] [Timeline] [Bible] [Threads] [Ask Story]            | 44px
+---------------------------------------------------------------------------------+
|   (Full-width 1024px cartographic Story Map canvas — ~76% of viewport area!     |
|    Clicking any node opens bottom/side sheet; Table View 1-click accessible)    |
+---------------------------------------------------------------------------------+
```

---

### 3. Comparative Evaluation of the Four Visual Directions

| Criterion | Dir A: Warm Literary Press | Dir B: Quiet Ink & Monograph | Dir C: Nocturnal Desk Lamp | Dir D: Cartographer's Folio |
|---|---|---|---|---|
| **Long-session prose comfort** | **Highest** (warm rag paper + `Literata`) | High (very crisp, slightly clinical) | **Highest at night** (zero blue glare) | **Highest** (unruled paper vs. mat) |
| **Visual clarity for dense tables/diffs/timelines** | High | **Highest** (editorial Swiss hierarchy) | Medium–High (requires careful dark contrast) | High |
| **Distinctiveness (Anti-Generic-SaaS)** | High | Medium–High | High | **Highest** (tactile literary + spatial craft) |
| **Migration cost from current PCC CSS** | **Lowest** (already uses warm parchment + plum + `Literata`/`DM Sans`) | Medium (full neutral/cobalt token swap) | Medium (requires amber/dark-first contrast tuning) | Low–Medium (builds on warm paper + forest/dot-mat accents) |
| **Shortcoming / Risk to watch** | Plum accent can feel overly soft in clinical diff tables if semantic colors aren't crisp | Can feel cold or "documentation tool"-like for lyrical fiction writers | Amber accent fails WCAG AA if paired with white text (must use dark ink on amber buttons) | Subtle dot-mat must stay ultra-faint (`<=6%` opacity) and disable cleanly in high-contrast mode |

### 4. Recommended Visual Direction (Left Open for Owner Selection — `UID-03`)

- **Primary Candidate (`Proposal`):** **Hybrid of Direction A ("Warm Literary Press") + Direction D's Spatial Surface Distinction + Direction C's Warm Low-Glare Dark Mode** — preserving PCC's recognizable warm rag-paper + `Literata` + plum editorial identity (lowest rework risk, strong literary soul), adding Direction D's subtle visual distinction between **Unruled Prose Paper** (`Write`), **Whisper-Subtle Spatial Mat** (`World`), and **Tinted Draft Paper** (`Studio` / AI Proposals), and upgrading dark mode to Direction C's warm obsidian-charcoal (retiring cold `#1F2937` slate forever).
- **Strong Alternative Candidate:** **Direction B ("Quiet Ink & Monograph")** if the owner prefers maximum architectural neutrality for dense research/historical novels.
- **No Final Choice Claimed:** Both candidates remain open for comparative UI research and Human Owner sign-off (`UID-03`).

---

## 5. Provisional Design System Specification (`Proposal`)

Directly fixes `UX-07` (4 styling dialects & hijacked `--color-blue-*`), `UX-08` (contrast, missing focus rings, sub-36px buttons), and `UX-03` (editorial reading typography).

### 5.1 Semantic Token Architecture (Retiring Hijacked `--color-blue-*`)

Never alias `--color-blue-600` to plum hexes (`index.css`, `UX-07`). Replace all hardcoded hexes (`ProjectHub.tsx`, `ImportWorkflow.tsx`) and hijacked `blue-*` classes with **one strict semantic token layer**:

| Token Name | Light Value | Dark Value | Verified Target Contrast / Usage |
|---|---|---|---|
| `--surface-canvas` | `#F7F5EF` | `#171518` | App shell backdrop |
| `--surface-sheet` | `#FFFDF9` | `#211E23` | Manuscript prose sheet, primary panels |
| `--surface-mat` | `#F1EFE8` | `#141315` | Spatial Story Map & Timeline canvas backdrop |
| `--surface-draft` | `#F6EFF4` | `#2B222B` | **Exclusively for unreviewed AI proposals & exploration drafts** |
| `--ink-primary` | `#221F24` | `#EFECE6` | Primary prose & UI text (`>13:1` AAA) |
| `--ink-secondary` | `#555059` | `#B5AEB9` | Secondary labels, captions, metadata (**`>=7.0:1` AAA — replaces failed `#827d83`!**) |
| `--ink-muted` | `#635E67` | `#9E97A3` | Placeholders & helper text (**`>=5.5:1` AA safe — replaces failed `#aaa5aa`!**) |
| `--border-hairline` | `#E3DFD7` | `#342F38` | Structural dividers (preferred over heavy cards) |
| `--border-strong` | `#B8B1A8` | `#524B57` | Input borders, interactive outlines (`>=3:1` non-text WCAG 1.4.11) |
| `--accent-primary` | `#62405B` | `#C79BC0` | Primary actions, active tab underline (`>=7:1` with paired ink) |
| `--accent-primary-ink` | `#FFFDF9` | `#19151B` | Text on `--accent-primary` |
| `--semantic-canon` | `#215A49` | `#74B8A2` | Confirmed fact, saved checkpoint, applied diff `+` |
| `--semantic-belief` | `#85530E` | `#E0AA57` | Character belief, epistemic ambiguity, caution |
| `--semantic-inference` | `#27507A` | `#7FAEDB` | AI inference, reported rumor, exploration highlight |
| `--semantic-danger` | `#9A2B36` | `#E87C84` | Contradiction, destructive delete, diff `-` |
| `--focus-ring` | `#62405B` | `#DFB8D9` | Mandatory `2px` solid ring with `2px` offset on EVERY focusable control |

> **Epistemic Note on Contrast Ratios:** Contrast values above are calculated mathematically from sRGB luminance of the proposed hex pairs (`Proposal`); actual rendered contrast must be audited in-browser with automated and manual WCAG 2.2 AA verification during implementation (no conformance certification claimed here).

### 5.2 Typography Scale: Manuscript Prose vs. Interface Chrome

| Role | Font Family | Size / Line Height | Measure / Rules |
|---|---|---|---|
| **Manuscript Body (`Write` & `Read`)** | `Literata` (optical serif) | `18px` / `1.72` (user-scalable `16–22px`) | `65–72ch` centered measure; indented or spaced paragraphs; crisp `em`/`strong`/blockquote/`hr` scene-break styling |
| **Manuscript Headings (H1/H2/H3)** | `Literata` (semibold) | `28px` / `22px` / `18px` | True rendered Markdown hierarchy (never raw `#` inside `<pre>`, fixing `UX-03`) |
| **Workspace / Page Title** | `DM Sans` (semibold) | `20px` / `1.3` | Tight `-0.015em` tracking; single line with breadcrumb |
| **Section Heading** | `DM Sans` (semibold) | `15px` / `1.4` | Clear hierarchy without giant hero banners |
| **UI Body / Controls / Buttons** | `DM Sans` (medium/regular) | `14px` / `1.45` | Minimum readable size for primary UI text |
| **Metadata / Badges / Micro-Keys** | `DM Sans` (medium) | **`12px` floor** / `1.4` | **Hard rule: zero `10px` body/badge text** (retiring `text-[10px]` in `AdaptivePlanWorkspace.tsx:237`) |
| **Diffs / Offsets / Technical Audit** | `JetBrains Mono` | `12.5px` / `1.5` | Used strictly for verbatim source offsets, exact token counts, and raw export audit — never for prose |

### 5.3 Spacing, Control Sizes, Focus, Motion & Accessibility Rules

1. **Touch & Pointer Target Floor:** Primary nav, toolbar buttons, tabs, and checkboxes MUST be **`>=40px` height on desktop and `>=44×44px` on touch/mobile** (fixing the 36 sub-36px buttons observed in `Plan`).
2. **Mandatory Focus-Visible Contract (Fixes `ManuscriptEditor.tsx:48` & `GraphToolbar.tsx`):** No component may declare `focus-visible:outline-none` without simultaneously declaring `focus-visible:ring-2 focus-visible:ring-[var(--focus-ring)] focus-visible:ring-offset-2`.
3. **Never Color-Only Encoding (WCAG 1.4.1):** Every epistemic status, diff line, and severity badge pairs **color + stroke/pattern + explicit text or icon**:
   - Confirmed Fact: Solid border + `● Fact`
   - Character Belief: Dashed border + `◌ Belief`
   - Reported / Rumor: Dotted border + `“ Reported`
   - Inference: Double/tinted badge + `◇ Inference`
   - Diff Added / Removed: `+` prefix & green wash / `−` prefix & strikethrough & crimson wash
4. **Icons + Labels Rule:** Top-level navigation and primary actions always pair clear **icons + visible text labels** (no mystery icon-only headers; icon-only allowed only for universally obvious secondary controls like close `×`, zoom `+`/`−`, or collapse rail, always with `aria-label` and tooltip).
5. **Zoom & Reflow Resilience (WCAG 1.4.4 / 1.4.10):** Layouts must reflow cleanly at `200%` browser zoom and `320px`–`390px` viewport widths with zero horizontal scrolling, zero clipped buttons, and zero overlapping sticky bars.
6. **Reduced Motion (`prefers-reduced-motion: reduce`):** Preserve and extend `index.css:136-145` — zero mandatory entrance animations (`GS-03`), instant transitions for panel opens and focus jumps when reduced motion is enabled.
7. **Zero Native Browser Popups:** Ban `window.confirm()` / `window.alert()` (`Header.tsx:93`, `ManuscriptEditor.tsx:278`); use focus-trapped in-app confirmation dialogs with `Escape` cancel and explicit destructive action verbs (*"Discard Unsaved Draft"* vs. *"Keep Editing"*).

### 5.4 Good vs. Bad Component Usage Examples

| Component Area | ❌ Bad Pattern (Seen Today or Generic SaaS) | ✅ Good Pattern (Provisional Design System) |
|---|---|---|
| **Plan / World Workspace Header** | 6 stacked horizontal chrome bars leaving `28%` of viewport for the graph (`UX-02`) | 1 slim `48px` global bar + 1 compact `44px` view switcher → **`>=70%` viewport canvas** |
| **Prose Surface** | Permanent security warning sitting above the cursor + raw `<pre>` Markdown preview (`UX-03`) | Clean `Literata` sheet with silent raw-source preservation; true formatted `Read` view; security note lives in `About / Import` |
| **Card & Panel Nesting** | Nested `rounded-xl border shadow-sm` boxes inside `rounded-xl border` wrappers inside `bg-pcc-canvas` | Hairline `1px` dividers (`--border-hairline`) separating calm flat surfaces; reserve borders/tints for *interactive* cards and *unreviewed drafts* |
| **Action Confirmation** | `window.confirm('Discard the unsaved manuscript draft?')` | Focus-trapped modal with *"Discard unsaved changes to Ch. 4?"* + **`Export Draft Copy`**, **`Keep Editing`**, **`Discard Draft`** |
| **AI Proposal Display** | Identical white card as canon text, or silently replacing paragraph in `<textarea>` | Softly tinted `--surface-draft` sheet with dashed border, `Proposed Draft` badge, exact diff, and `Apply / Edit / Save Alternative / Decline` |
| **Error When AI Unconfigured** | Plain text *"connect a provider in AI Settings"* with no link (`UX-15`) | Calm inline notice explaining offline local tools still work + primary button **`Open AI Settings →`** |

---

## 6. Cross-References & Checkpoint Status

- **Completed in this file:** Four distinct writer-specific visual design directions with desktop & constrained-width conceptual wireframes, comparative matrix, recommended hybrid candidate (open for owner selection), and complete Provisional Design System.
- **Next document:** [06 — Narrative Visualization and Editor Experience](./06-narrative-visualization-and-editor-experience.md) designs the exact visual semantics for Graph, Dual-Track Timeline, Knowledge Matrix, Patch Change Map vs. Uncertain Impact, Formatted Writing/Reading, Creative Studio, Project Overview, Operation Center, and the 5-Tab AI Settings & Embeddings Console.
