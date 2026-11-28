# 02 — Navigation and Workspace Architecture

**Assignment:** `PCC-UI-RESEARCH-02` — Comparative UX Research, Design Synthesis & Product-Wide Interaction Blueprint  
**Status:** Complete (Cycle 3 Architectural Variants, Cycle 4 Critique & Cycle 5 Navigation/State Contract)  
**Scope:** Compares all 4 `ui-01` organizing models plus 2 fresh architectural variants; designs non-crowded desktop, laptop (`1024×768`), mobile (`390×844`), and `200%` zoom navigation for the owner-approved **6 distinct author-intent destinations (`Projects`, `Write`, `World`, `Creative Studio`, `Story Development`, `Review`)** without turning PCC into a complex IDE; defines the exact **Dual-Pane Companion (`UID-01`) Interaction & State Contract**; and unifies **Workspace Presets (`UIRF-01`)**, **Pinned Story Elements (`UIRF-02`)**, **Cross-Workspace Deep Links (`UIRF-03`)**, **Expand Any Major View (`UIRF-05`)**, **Local Bilingual `Cmd+K` (`UI-NEW-04`)**, and **Resume (`UI-NEW-08`)** into one coherent navigation-state system.

---

## 1. Comparing Six Product-Wide Architectural Variants

To avoid blindly defending `ui-01`'s hybrid or cramming 6 buttons into a cramped bar, we evaluated all four `ui-01` models alongside two fresh comparative variants:

| Variant | Core Shell Structure | How 6 Destinations Appear | Strengths | Weaknesses & Verdict |
|---|---|---|---|---|
| **M1 — Pure Intent Rooms** *(ui-01)* | Full-screen room switching via top bar | 6 equal horizontal tabs in top bar | Simple mental model | Forces back-and-forth room-hopping for Write+World or Review+Source; 6 top tabs crowd narrow laptops (`1024px`) and phones (`390px`). **Rejected as standalone.** |
| **M2 — Manuscript + Spatial Lenses** *(ui-01)* | Prose is permanent home; World/Studio/Develop/Review open as lenses | Top lens pills attached to active scene | Zero-friction for pure drafters | Awkward for blank-premise / seed-first authors (`J-01`) and multi-chapter worldbuilding; blurs `Creative Studio` vs. `Story Development` posture. **Rejected as standalone.** |
| **M3 — Folio Binder + General Split** *(ui-01)* | Permanent object tree + arbitrary 2-pane tiling | Nested binder folders | Very powerful for 100k-word novels | Feels like an IDE/file-explorer to casual/first-time authors; arbitrary folder trees obscure distinct creative postures (`Studio` vs. `Develop`). **Adopted selectively (curated pairings, not raw IDE tiling).** |
| **M4 — Spatial Story Board** *(ui-01)* | Zoomable 2D corkboard as app home | Floating sheets over 2D canvas | Visually expressive for plotters | High keyboard/screen-reader accessibility burden; slows down linear prose writers. **Demoted to optional view inside `World`.** |
| **M5 — Slim Intent Rail + Contextual Workspace Shell *(NEW Variant A)*** | **Left `64px` Icon+Label Intent Rail** on desktop (`>=1024px`) holding the 6 distinct workspaces cleanly, paired with a single quiet top context strip (`Project Switcher`, `Scope/Pins`, `Story Q&A`, `Provider Popover`, `Operation Center`, `Cmd+K`, `AI Settings`) | Vertical rail easily holds all 6 (`Projects`, `Write`, `World`, `Studio`, `Develop`, `Review`) with **zero horizontal crowding** even at `1024px` or `150%` zoom, freeing 100% of top-bar width for project/scope/utilities! | Zero top-bar squeezing; crystal-clear separation between **Global Navigation (Left Slim Rail)** and **Local Outline/Binder (Collapsible Secondary Panel)**; effortless `Calm`/`Deep` toggling; full-height vertical canvas (`+48px` vertical gain over top-tab rows!). | Rail consumes `64–72px` horizontal width unless collapsed in Focus Mode; on `390px` mobile shifts to a clean 5-tab + *"More / Workspace Drawer"* OR compact 6-intent adaptive bar (see §2.2). **Strong Candidate A (`UID2-02`).** |
| **M6 — Grouped Top Header + Project Anchor *(NEW Variant B)*** | Single top bar separates **Project Anchor** (left: `[Projects / Active Story v]` — keeping `Projects` as the project hub anchor!) from **5 Story Workspaces** (`Write`, `World`, `Studio`, `Develop`, `Review`) centered cleanly, and global utilities right | `Projects` is always 1 click away via the left Anchor (never demoted or hidden), leaving just **5 crisp horizontal verbs** (`Write · World · Studio · Develop · Review`) in the center! | Familiar editorial web/desktop feel; zero permanent horizontal rail eating width; fits `1024px` cleanly without wrapping AND maps directly to a 5-verb bottom bar + top-left `Projects` anchor on `390px` mobile! | Slightly less vertical height than a left rail (`~48–52px` top bar); at `200%` zoom (`720px` effective width on `1440px`) requires responsive collapse into a clean workspace menu. **Strong Candidate B (`UID2-02`).** |

> **Key Comparative Insight (`§6`):** *"Six desktop destinations need not mean six squeezed buttons."* Both **M5 (Slim Left Intent Rail)** and **M6 (Project Anchor Left + 5 Story Workspaces Center)** preserve **all 6 distinct owner-approved destinations (`UID-02`)** with zero intent collapse on desktop, laptop, AND mobile — while avoiding IDE clutter! We keep **M5 vs. M6** explicitly comparable for Owner decision (`UID2-02`), while sharing the exact same workspace interiors and Dual-Pane Companion contract underneath.

---

## 2. Responsive Behavior: Desktop, Laptop, Mobile & `200%` Zoom

### 2.1 Clear Distinction: Global Navigation vs. Local Workspace Outline/Binder

A frequent UX failure in writing apps is merging global app navigation with the active project's chapter/scene tree so users lose track of where they are. PCC enforces a strict **two-tier spatial boundary**:
1. **Tier 1 — Global Workspace Navigation** (*Where am I working?*): `Projects`, `Write`, `World`, `Creative Studio`, `Story Development`, `Review` + global utilities (`Story Q&A`, `Cmd+K`, `Provider Status`, `Operation Center`, `AI Settings`).
2. **Tier 2 — Local Contextual Sidebar (Collapsible per workspace)** (*What inside this workspace am I looking at?*):
   - In `Write`: Chapter & Scene Outline (`240px`, collapsible via `Cmd+B` or Focus Mode).
   - In `World`: World Perspectives (`Story Map`, `Characters & Relations`, `Story Bible`, `Mind Map`, `Timeline`, `Knowledge Matrix`, `Themes & Threads`) + local filters.
   - In `Creative Studio`: Exploration Sessions shelf, `Creative Collection`, `Visuals / Concept Art`.
   - In `Story Development`: Target scope selector + 5 Development Lenses + active 🔒 Locks summary.
   - In `Review`: Prioritized Issue / Readiness / Sync / History list.
   - In `Projects`: Library, Active Project Overview, Alternatives, Backups & Recovery.

### 2.2 Responsive Breakpoint Matrix (All 6 Intents Preserved — Never Collapsed)

| Viewport / State | Variant M6 (Top Bar + Project Anchor) | Variant M5 (Slim Left Rail) | Companion Pane (`UID-01`) | Local Sidebar |
|---|---|---|---|---|
| **Desktop (`>=1280px`, e.g. `1440×900`)** | `Projects / Izmir Lighthouse v` left · `Write · World · Studio · Develop · Review` center · `Pins · Q&A · Provider · Jobs · Settings` right | `68px` vertical left rail (`Projects`, `Write`, `World`, `Studio`, `Develop`, `Review`) · slim top bar for `Story Title`, `Pins`, `Q&A`, `Provider`, `Jobs`, `Settings` | Optional side-by-side split (`default: closed`; opens at `40%–50%` width, draggable `30%–65%`) | Open in `Deep` or toggleable in `Calm` (`240px`) |
| **Laptop / Constrained (`1024×768`)** | Compact padding on 5 center verbs + concise utility icons with tooltips/labels (`>=36–40px` height); zero horizontal overflow | `64px` slim rail fits all 6 vertically with generous breathing room; zero top-bar squeeze | Optional split (`50/50` when local sidebar auto-collapses to keep both panes readable `>=460px` wide) | Auto-collapses to slide-over drawer when Companion opens |
| **Tablet / `200%` Zoom on Desktop (`720px–960px` effective CSS width)** | Workspace dropdown pill (`Current: Write v` showing all 6 intents clearly) + `Projects` button + `Menu` button; text reflows with **zero horizontal scroll** (WCAG 1.4.10) | Collapses left rail into accessible drawer button (`Workspaces`) + active workspace title; zero clipped labels | Switches to **Full-Width Sheet with `[Swap View]`** toggle bar | Slide-over drawer (`Escape` closes, returns focus) |
| **Mobile (`390×844`)** | **Top bar:** `[Projects]` (opens full Projects hub, `+ New`, `Import`, `About`, `Theme`, `Settings`) + Active Story title + `[Cmd+K / Q&A]`.<br>**Bottom 5-intent bar (`56px`, `>=44px` targets):** `Write` · `World` · `Studio` · `Develop` · `Review` (keeping ALL 6 distinct intents 1 tap away without merging `Develop` into `Review`!) | Same mobile adaptation: Top bar holds `Projects` + Utilities; Bottom bar holds `Write · World · Studio · Develop · Review` | **Single-Pane with `[Swap]` Pill:** Opening a companion displays a top breadcrumb (`Ch. 4  ⇄  Leyla Profile [×]`) allowing instant 1-tap swap without stacked modals | Full-height slide-over sheet |

### 2.3 Navigation Understandability Across Every Project State

| Project Lifecycle State | What Navigation Shows & Does (`UID-08`) |
|---|---|
| **No Project Open** | Opens directly on `Projects` Library with clear cards (`Start from Premise`, `Blank Manuscript`, `Import Existing Story`, `Explore Optional Sample`). Story workspaces (`Write`–`Review`) appear muted with plain helper (*"Open or create a story first"*). |
| **Empty / Premise-Only Seed** | Adaptive landing offers **Guided Premise (`Grill Me`)**, **Start Writing Ch. 1**, or **Build World** — never dropping the writer silently into a blank form or forcing a wizard. |
| **Populated Manuscript** | Honors user preference (`UID-08`): **Project Overview** (showing `Resume My Work` trail, open issues, backups) OR **Direct Resume** straight into last scene & cursor position with zero AI calls. |
| **Dense Graph / 100k-Word Novel** | Left outline collapses chapters cleanly; `World` opens with filtered/clustered view & pagination (never silent `.slice(0, 80)`); `Calm` keeps chrome minimal while `Deep` opens contextual margins & local insights. |
| **Multiple Alternatives** | Active project pill displays a subtle lineage chip (`Alternative of: Salt Ledger`) with 1-click `Compare with Original` (opening Original read-only in Companion Pane). |
| **Offline / No AI Connected** | All 6 workspaces remain 100% functional for local writing, formatted reading, local lexical search, World editing, manual ideas, local diagnostics, and backups; Provider pill calmly reads `Offline · Local Tools Ready` with 1-click `AI Settings`. |

---

## 3. Shared Dual-Pane Companion (`UID-01`) — Complete Interaction & State Contract

To avoid turning PCC into a brittle multi-tab IDE (`§6`), the Companion system enforces **strict simplicity**:
- **Single-Pane Default:** Every workspace opens in a single clean primary pane (`companion = null`).
- **Hard Cap of Two Major Content Surfaces:** Never allow 3+ tiled panes or nested splits inside a companion. A slim `Write` outline (`240px`) or lightweight Pin bar is a navigation aid, NOT a third workbench; on constrained widths (`<1280px`), opening a companion automatically collapses the local sidebar so the two content surfaces stay readable.
- **Curated High-Value Pairings (First-Class) vs. General Split:** Instead of arbitrary "open any widget inside any widget" tiling, support a **curated, predictable pairing table** that covers 99% of real author workflows cleanly:

| Primary Pane | Curated Companion Pairings (`Open Beside`) | Default Write Ownership |
|---|---|---|
| **`Write` (Manuscript)** | Character/Entity detail (`World`), Story Bible rule, Cited Source passage, `Story Q&A` answer, Active `Creative Studio` session, `Story Development` diff proposal, `Review` issue evidence | **Primary (`Write`) = Read/Write**; Companion = Read-only reference (unless explicitly toggled to *Edit Note* or *Apply Proposal* which explicitly names the target) |
| **`Review` (Issue / Sync / History)** | Exact cited manuscript passage (`UI-NEW-03`), Patch `Change Map` visual, Historical revision snapshot | **Primary (`Review`) = Proposal Action Owner**; Companion = Read-only highlighted passage (with `Edit in Write` handoff) |
| **`Creative Studio` / `Story Development`** | Active manuscript scene, `Story Map` / `Knowledge Matrix`, Live non-canonical `Grill Me` draft sketch | **Primary (`Studio/Develop`) = Session Draft Owner** (non-canonical); Companion = Read-only story context |
| **`Projects` / `Write` (Two-Project Comparison)** | Original Project vs. Independent Alternative Project | **STRICT SAFETY RULE (`UID-01`):** Secondary/reference project pane is **READ-ONLY by default** with a distinct top identity banner (`Reference Copy (Read-Only): Salt Ledger — Original · Rev #14`). Mutations NEVER route blindly by whichever pane has cursor focus; transferring any item requires an explicit `Transfer to [Target Project Name]` proposal preview. |
| **`Import` (Candidate Review)** | Exact imported source text with highlighted verbatim spans alongside extracted entities/relationships | **Primary (`Candidate Review`) = Accept/Reject Owner**; Companion = Immutable Source (Read-Only) |

### 3.1 Exact Companion Operations & Keyboard/Focus Contract

| Action | Trigger | Behavior & Focus Rule |
|---|---|---|
| **Open Main (Replace)** | Normal click on nav item or deep link | Replaces primary pane; saves previous scroll/selection to Navigation Back Stack; preserves auto-stashed unsaved draft. |
| **Open Beside (Companion)** | `Alt/Option+Click` or `[Split Right]` icon on citation/entity/alternative | Opens target in right Companion Pane (`42%` default width, min `320px`, max `65%`); moves focus to Companion header landmark; announces via `aria-live="polite"`: *"Opened Leyla profile beside Chapter 4"*. |
| **Resize** | Drag divider OR focus `role="separator"` (`ArrowLeft`/`ArrowRight` in `5%` increments, `Enter` resets `50/50`) | Persists preferred split ratio per workspace/preset (`UIRF-01`) locally; clamps cleanly on window resize. |
| **Swap** | `[⇄ Swap]` button (`Cmd/Ctrl+Shift+S` when split active) | Swaps primary and companion positions **without** silently reversing Read-Only project protection on a reference alternative! |
| **Maximize / Expand (`UIRF-05`)** | `[⤢ Expand]` button on either pane or any major view (`Story Bible`, `Timeline`, `Mind Map`, `History`) | Expands focused pane to full width (hiding companion & local rail temporarily) and renders a clear `[← Restore Previous Layout]` pill returning exact prior pane/scroll state. |
| **Close & Return** | `[× Close]` or `Escape` when focus is on Companion header | Closes companion smoothly and restores focus to the **exact trigger element or prose cursor offset** in the primary pane. |
| **Explicit Active Target Identity** | Always-visible thin top identity strip on both panes when split is open | Displays `[Project Name · Scope · Read/Write vs. Read-Only]` — zero ambiguity about which document an edit or AI action targets. |

---

## 4. Unified Navigation-State System (`UIRF-01`, `UIRF-02`, `UIRF-03`, `UIRF-05`, `UI-NEW-08`)

Rather than building five disconnected preference menus, PCC unifies **layout presets, pins, deep links, view expansion, and resume breadcrumbs** under **one lightweight local UI-State layer**, strictly isolated from authoritative project data:

### 4.1 Persisted UI State vs. Authoritative Project Data (Zero Authority Mixing)

| Layer | Stored Data | Durability & Recovery Contract |
|---|---|---|
| **Authoritative Project Data** *(Canonical — backed up & versioned)* | Immutable source bytes, Working Manuscript sections, Confirmed Story Bible/Graph/Epistemic model, Revision History, `CreativeSessions`, `UnifiedProposals` | Protected by CAS, revision digests, explicit author apply, and ZIP/R2 backups. |
| **Local Workspace UI State** *(Ephemeral/Recoverable Preferences — per project + device)* | Active Workspace Preset (`UIRF-01`), Dual-Pane layout & split ratio (`UID-01`), `Calm`/`Deep` density, Pinned Story Element IDs (`UIRF-02`), Last Cursor/Scroll & Resume Breadcrumbs (`UI-NEW-08`), Back/Forward Deep-Link stack (`UIRF-03`) | Stored in local UI-state store; **NEVER** mutates or rolls back canonical story content; if a referenced ID was deleted or renamed, degrades safely with a clear stale badge (`"Pinned item 'Old Dock' was removed — [Unpin]"`). |

### 4.2 How the Four Mechanisms Work Together Seamlessly

1. **Workspace Presets (`UIRF-01`):**
   - Accessed from a compact top-bar layout pill (`Layout: Writing v`).
   - **4 Built-in Defaults:** `Writing` (Write + Outline collapsed or slim, Companion closed), `Story Research` (Write + World Entity Companion), `Creative Exploration` (Full-width Studio + Sessions shelf), `Revision` (Review + Source Passage Companion).
   - Authors can `Save Current Layout as Preset…` or `Reset Preset`. Selecting a preset changes *only* open panes, widths, and density — **never** alters story text, selections, or unsaved drafts. On screens `<1024px`, multi-pane presets gracefully adapt to single-pane + `[Swap]` with a subtle note.
2. **Pinned Story Elements (`UIRF-02`):**
   - Clicking `📌 Pin` on any Character, Relationship, Story Rule, Clue, or Source Passage adds a compact chip to a slim collapsible **Pins Popover / Strip** in the top context bar (e.g., `📌 Pins (3): Leyla · 1954 Rule · Logbook`).
   - Clicking any pin opens it in the Companion Pane (or Peek popover on mobile) without losing your current screen.
   - **Strictly NOT a 3rd workbench:** Pins are lightweight project-scoped references showing live status (`Changed`, `Deleted — Unpin`), cleared per-item or all at once.
3. **Cross-Workspace Deep Links (`UIRF-03`) + Exact Return:**
   - Every entity chip, scene citation, session reference, and issue target carries a stable scoped URI (`pcc://project/{pid}/scene/{sid}#span=...`).
   - Clicking gives immediate clear behavior (`Open Beside` default when in Review/Q&A; `Open Here` in Overview) and pushes the origin `(workspace, scroll, cursor, activeFilter)` onto the **Return Stack** (`← Back to Review: Brass Lens Issue`).
   - **Stale ID / Cross-Project Guard:** If a deep link targets a deleted scene or a different project, PCC never silently switches projects or creates blank stubs — it shows a calm recovery banner (*"Target scene was merged into Ch. 4 — [Open Ch. 4] / [Dismiss]"*).
4. **Worked Concrete Example (Same *Salt Ledger* Narrative):**
   - Author is in `Write` (`Ch. 4 — The Sealed Manifest`, cursor at paragraph 3), with `Leyla` and `1954 Brass Lens Rule` pinned (`📌 Pins (2)`).
   - Author clicks `📌 1954 Brass Lens Rule` → Companion opens right showing the rule (`Read-Only`).
   - From that rule, author clicks the linked citation `Ch. 2 §2` (`UIRF-03`) → Companion smoothly switches to `Ch. 2 §2` with the verbatim span highlighted (`UI-NEW-03`) and a `← Back to 1954 Rule` link — while `Ch. 4` on the left keeps the exact cursor and unsaved draft untouched!

---

## 5. Local Bilingual Command Palette (`UI-NEW-04`) Contract

- **Trigger:** `Cmd/Ctrl + K` OR visible `[Search / Commands]` button in top utility bar (supplemental only — every core action remains discoverable in normal navigation).
- **100% Local & Offline (Zero AI Calls):** Indexes active project scenes, chapters, characters, places, Story Bible rules, saved Studio sessions, alternatives, AND **bilingual English + Turkish action synonyms**:
  - Typing `"kim biliyor"` or `"who knows"` → `Open Knowledge Matrix (World)`
  - Typing `"geri dönüş"` or `"flashback"` → `Open Dual-Track Timeline (World)`
  - Typing `"yedek"` or `"backup"` → `Open Backup & Recovery (Projects)`
  - Typing `"alternatif"` or `"what if"` → `Compare / Save Alternative`
  - Typing `"Leyla"` → `Open Leyla in World` | `Open Leyla Beside Current View (Alt+Enter)` | `Ask Story Q&A about Leyla`
- **Strict Preflight / Consent Boundary:**
  - *Navigation / local filter commands* execute immediately on `Enter`.
  - *Costly AI operations* (e.g., `Run Semantic Continuity Check`, `Generate Studio Ideas`) or *destructive operations* (`Delete Scene`, `Restore Backup`) **NEVER fire immediately from the palette** — they navigate to and open the standard explicit preflight/confirmation sheet (`Context Inspector` + consent button).

---

## 6. Cross-References & Checkpoint Status

- **Completed in this file:** 6-variant architectural comparison, dual desktop candidates (`M5` Slim Left Rail vs. `M6` Project Anchor + 5 Verbs) preserving all 6 distinct owner-approved intents across desktop/laptop/mobile/`200%` zoom, complete Dual-Pane Companion (`UID-01`) contract, unified Navigation-State layer (`UIRF-01/02/03/05` + `UI-NEW-08`), and local bilingual `Cmd+K` contract (`UI-NEW-04`).
- **Next documents (Batch 2):** [03 — Author Journeys and Interaction Specification](./03-author-journeys-and-interaction-specification.md) and [04 — Editor, Creative and Review Experiences](./04-editor-creative-and-review-experiences.md).
