# 06 — Comparative Visual Directions, Full-Screen Concepts & Corrected Design System

**Study:** `PCC-UI-RESEARCH-02` (Comparative UX Research, Design Synthesis & Product-Wide Interaction Blueprint)  
**Canonical Story Fixture:** *The Salt Ledger / Tuz Defteri* (identical manuscript text, entities, conflicts, Studio session, and provider state rendered across every candidate for true apples-to-apples comparison)  
**Authority Boundary:** This document prepares **three comparable, owner-ready full-product visual candidates** without selecting a final visual direction on the owner's behalf. No fabricated screenshots, no unmeasured performance claims, and no false WCAG conformance certification are made.  
**Evidence Boundary:** All contrast ratios below are **mathematically computed (`Computed sRGB`)** via deterministic Node.js WCAG 2.1/2.2 relative luminance formula (`L = 0.2126*R + 0.7152*G + 0.0722*B`, `CR = (L1 + 0.05) / (L2 + 0.05)`). All layouts and tokens are `Proposed design`; current app baseline defects are `Confirmed in source`.

---

## 1. Reassessment of `ui-01` Visual Directions & Introduction of a 5th Direction

In `PCC-UI-RESEARCH-01`, four visual directions were proposed. Re-evaluating them critically against the owner's feedback (`ui-owner-review-2026-11-28.md` & `ui-owner-decisions-after-research-01.md`), long-form writing ergonomics, dense graph readability, and mathematical sRGB contrast produces clear dispositions:

| Original / New Direction | Assessment in `ui-02` | Disposition |
| :--- | :--- | :--- |
| **1. Warm Literary Press** *(from `ui-01`)* | Strongest literary warmth and calm manuscript posture, **but** `ui-01`'s border tokens (`#B8B1A8` on `#FFFDF9` = `2.09:1`; `#524B57` on `#211E23` = `1.96:1`) failed the `3:1` non-text contrast requirement for interactive inputs/controls. Refined with dual border tiers (`--border-hairline` decorative vs. `--border-control` `>=3.37:1`). | **Retained & Refined → Candidate 1** |
| **2. Quiet Ink & Monograph** *(from `ui-01`)* | Crisp Swiss/editorial precision, exceptional structural clarity for complex tables, Knowledge Matrices, and Review diffs. Cooler paper feel suits analytical/plot-heavy authors who dislike warm beige tones. | **Retained & Refined → Candidate 2** |
| **3. Nocturnal Desk Lamp** *(from `ui-01`)* | Pleasant late-night aesthetic, **but** functioned primarily as a dark-mode amber variant of Warm Literary Press rather than a distinct whole-product visual architecture. Its best properties (low-glare warm dark surfaces) are absorbed into Candidate 1's Dark Mode. | **Absorbed into Candidate 1 Dark Mode (not a standalone candidate)** |
| **4. Cartographer's Folio** *(from `ui-01`)* | Great for Story Maps and timelines, **but** parchment/grid textures created visual noise behind 100k-word literary prose and weakened dark-mode legibility. Its structured hairline card chrome is distilled cleanly without noisy texture into our new 5th direction. | **Superseded by Direction 5** |
| **5. Atelier Linen & Indigo** *(NEW in `ui-02`)* | A genuinely new architectural direction combining **tactile natural linen warmth** with **cool archival indigo-teal ink** and **cleanly recessed drafting trays** (clear physical separation between *Canonical Sheet*, *Reference Mat*, and *Unreviewed AI Draft Tray* using both border geometry and subtle surface depth). Bridges literary warmth and high-density worldbuilding clarity without plum/rose tinting. | **New Full-Product Candidate → Candidate 3** |

---

## 2. Structural & Stylistic Comparison of the Three Full-Product Candidates

These three candidates differ in **spatial posture, typography pairing, chrome density, surface hierarchy, and interaction feel** — not merely accent color swaps:

| Dimension | Candidate 1: **Warm Literary Press (Refined)** | Candidate 2: **Quiet Ink & Monograph** | Candidate 3: **Atelier Linen & Indigo (NEW)** |
| :--- | :--- | :--- | :--- |
| **Editorial Metaphor** | Typeset literary book on a quiet writing desk | Archival monograph & precision editorial proofing table | Architect-author's studio desk with physical linen sheet & blueprint trays |
| **Navigation Posture** | Top Utility Header (`M6`: Project Anchor + 5 centered intent tabs) + collapsible binder | Slim Left Intent Rail (`M5`: 64px/200px icon+label rail) maximizing vertical manuscript height | Adaptive Top Bar + contextual Object Ribbon (clean horizontal breathing room + pinned breadcrumb bar) |
| **Surface Separation (Prose vs. Ref vs. AI Draft)** | Soft paper elevation (`#FFFDF8` sheet on `#F7F4EE` canvas; subtle plum-tinted `#F5ECF3` + dashed frame for AI drafts) | Crisp 1px architectural hairlines (`#FCFBF8` sheet on `#F3F3F0` canvas; cool slate-blue `#EEF3F8` + left bar for AI drafts) | Tactile mat contrast (`#FEFCF7` sheet on `#F5F2EA` linen; recessed `#ECE8DC` reference mat; sage-indigo `#EEF3F1` + dashed corner tag for AI drafts) |
| **Typography Pairing** | Prose: `Literata` (serif) · UI: `DM Sans` · Code/Diff: `JetBrains Mono` | Prose: `Source Serif 4` (or `Literata` opt.) · UI: `Inter` · Code/Diff: `JetBrains Mono` | Prose: `Literata` (serif) · UI: `Plus Jakarta Sans` (or `DM Sans`) · Code/Diff: `JetBrains Mono` |
| **Corner Radius & Chrome Feel** | Soft editorial (`8px` cards, `6px` controls, gentle shadows on popovers only) | Sharp monograph (`2px–4px` crisp corners, flat hairline borders, zero drop-shadow clutter) | Balanced tactile (`6px` cards, `10px` sheet corners, crisp 1px control borders + subtle top accent rules) |
| **Best Suited For** | Novelists & literary writers who want the gentlest, lowest-glare prose sanctuary | Structural plotters, series editors, heavy `Review` & `Knowledge Matrix` users | Hybrid writers alternating constantly between deep prose, `Creative Studio`, and `World` maps |
| **Primary Tradeoff** | Plum accent feels slightly softer/more subjective to authors preferring neutral monochrome | Cooler monochrome tone can feel clinical during pure exploratory drafting | Distinct recessed trays require disciplined responsive collapse on `390px` screens |

---

## 3. Mathematically Verified sRGB Contrast Audit (Corrected from `ui-01`)

### 3.1 Explicit Correction of Legacy & `ui-01` Contrast Failures (`Computed sRGB`)

Before proposing new palettes, we verified the exact legacy CSS tokens (`Confirmed in source`) and `ui-01`'s disputed border claims (`ui-owner-decisions-after-research-01.md §D.4`) using deterministic sRGB luminance math:

| Disputed / Legacy Pair | Foreground | Background | Computed Ratio | WCAG 2.2 AA Threshold | Verdict |
| :--- | :--- | :--- | :--- | :--- | :--- |
| Current app muted text (`--text-muted`) | `#827d83` | `#f8f7f3` | **`3.76:1`** | `4.5:1` (normal text) | **FAIL** — must darken |
| Current app subtle text (`--text-subtle`) | `#aaa5aa` | `#f8f7f3` | **`2.26:1`** | `4.5:1` (normal text) | **FAIL** — severely illegible |
| `ui-01` Warm Press light border (claimed `>=3:1`) | `#B8B1A8` | `#FFFDF9` | **`2.09:1`** | `3.0:1` (SC 1.4.11 interactive controls) | **FAIL** — `ui-01` claim was mathematically wrong |
| `ui-01` Warm Press dark border (claimed `>=3:1`) | `#524B57` | `#211E23` | **`1.96:1`** | `3.0:1` (SC 1.4.11 interactive controls) | **FAIL** — `ui-01` claim was mathematically wrong |

### 3.2 Mandatory Architectural Fix: Two Separate Border Tokens

Per WCAG 2.2 SC 1.4.11 (*Non-text Contrast*), **purely decorative dividers** (subtle hairlines separating layout regions or table rows that are not themselves interactive hit targets) have no `3:1` mandate, whereas **interactive component boundaries** (text inputs, selects, checkboxes, outline buttons, graph control edges, focus rings) **must achieve `>= 3.0:1`** against adjacent surfaces.

All three candidates therefore strictly separate:
- `--border-hairline`: Decorative structural dividers only (soft, low visual fatigue).
- `--border-control`: Mandatory `>= 3.35:1` interactive boundaries for inputs, checkboxes, secondary buttons, and slider tracks.
- `--focus-ring`: Mandatory `>= 4.5:1` high-visibility `2px` outer focus ring with `2px` offset (never suppressed by `outline: none`).

### 3.3 Verified Token & Contrast Tables for All Three Candidates (`Computed sRGB`)

> **Verification Summary:** All **77 tested foreground/background/control pairs** across Light and Dark modes for Candidates 1, 2, and 3 pass WCAG 2.2 AA (`>= 4.5:1` for normal text/placeholders/links/buttons/selection, `>= 3.0:1` for `--border-control` and graph semantics) with **0 failures** (`Computed sRGB` via Node.js).

#### Candidate 1 — Warm Literary Press (Refined)

| Semantic Token | Light Hex | Light Pair / Ratio | Dark Hex | Dark Pair / Ratio | Target |
| :--- | :--- | :--- | :--- | :--- | :--- |
| `--surface-canvas` | `#F7F4EE` | App background | `#171518` | App background | Surface |
| `--surface-sheet` | `#FFFDF8` | Prose / primary card | `#211E23` | Prose / primary card | Surface |
| `--surface-mat` | `#EFECE3` | Read-only reference / binder | `#131115` | Read-only reference / binder | Surface |
| `--surface-draft` | `#F5ECF3` | Unreviewed AI draft tray | `#2B212B` | Unreviewed AI draft tray | Surface |
| `--text-primary` | `#231F24` | on Sheet: **`15.98:1`** | `#F0ECE6` | on Sheet: **`14.00:1`** | `>=4.5:1` |
| `--text-secondary` | `#524C56` | on Sheet: **`8.17:1`** | `#BEB7C2` | on Sheet: **`8.43:1`** | `>=4.5:1` |
| `--text-muted` / placeholder | `#635C68` | Sheet `6.33:1` · Canvas `5.87:1` · Draft **`5.57:1`** | `#A39BA8` | Sheet `6.13:1` · Draft **`5.76:1`** | `>=4.5:1` |
| `--border-hairline` *(decorative)* | `#E2DCD2` | Decorative divider only | `#312D35` | Decorative divider only | Decorative |
| `--border-control` *(interactive)* | `#8B847B` | Sheet **`3.63:1`** · Canvas **`3.37:1`** | `#857C8C` | Sheet **`4.13:1`** · Canvas **`4.55:1`** | `>=3.0:1` |
| `--accent-primary` | `#623D5A` | on Sheet: **`8.85:1`** · White text: **`8.85:1`** | `#D4A4CC` | on Sheet: **`7.83:1`** · `#18141A` btn text: **`8.65:1`** | `>=4.5:1` |
| `--accent-primary-hover` | `#4E2E47` | White text: **`11.44:1`** | `#E2BCE0` | `#18141A` btn text: **`10.95:1`** | `>=4.5:1` |
| `--accent-canon` (Accepted / Lock) | `#1F5A48` | Sheet **`7.90:1`** · on `#ECF6F1` **`7.28:1`** | `#7CC2AA` | on Sheet: **`7.97:1`** | `>=4.5:1` |
| `--accent-belief` (Warning / Stale) | `#7F4D0B` | Sheet **`6.96:1`** · on `#FDF4E3` **`6.48:1`** | `#E4B05D` | on Sheet: **`8.37:1`** | `>=4.5:1` |
| `--accent-inference` (AI / Info) | `#244E78` | on Sheet: **`8.48:1`** | `#88B6E4` | on Sheet: **`7.73:1`** | `>=4.5:1` |
| `--accent-danger` (Conflict / Del) | `#9B2934` | Sheet **`7.48:1`** · on `#FDEEEF` **`6.76:1`** | `#EE8890` | on Sheet: **`6.72:1`** | `>=4.5:1` |
| `--selection-bg` | `#E6D4E3` | `#231F24` text: **`11.52:1`** | `#573B53` | `#F0ECE6` text: **`8.28:1`** | `>=4.5:1` |

#### Candidate 2 — Quiet Ink & Monograph

| Semantic Token | Light Hex | Light Pair / Ratio | Dark Hex | Dark Pair / Ratio | Target |
| :--- | :--- | :--- | :--- | :--- | :--- |
| `--surface-canvas` / `--surface-sheet` | `#F3F3F0` / `#FCFBF8` | Crisp neutral monograph | `#131518` / `#1B1E22` | Deep archival slate | Surface |
| `--surface-mat` / `--surface-draft` | `#EAEAE5` / `#EEF3F8` | Ref mat / cool AI draft tray | `#101214` / `#1A2430` | Ref mat / cool AI draft tray | Surface |
| `--text-primary` / `--text-secondary` | `#17181A` / `#4B4F57` | **`17.17:1`** / **`7.94:1`** on Sheet | `#EEEEEB` / `#B4BAC4` | **`14.39:1`** / **`8.57:1`** on Sheet | `>=4.5:1` |
| `--text-muted` / placeholder | `#5D626C` | **`5.92:1`** on Sheet | `#98A0AC` | **`6.34:1`** on Sheet | `>=4.5:1` |
| `--border-control` *(interactive)* | `#868A90` | **`3.35:1`** on Sheet | `#7E8694` | **`4.56:1`** on Sheet | `>=3.0:1` |
| `--accent-primary` (Editorial Cobalt) | `#1D4878` | **`9.02:1`** on Sheet & White btn | `#8AB8EB` | **`8.07:1`** on Sheet · **`8.83:1`** `#131518` btn | `>=4.5:1` |
| `--accent-canon` / `--accent-belief` | `#1A5B47` / `#7C4F0C` | **`7.71:1`** / **`6.81:1`** on Sheet | `#76C1A6` / `#E5B25C` | **`7.92:1`** / **`8.65:1`** on Sheet | `>=4.5:1` |
| `--accent-danger` (Vermilion) | `#A12B22` | **`7.04:1`** on Sheet | `#F0877E` | **`6.75:1`** on Sheet | `>=4.5:1` |
| `--selection-bg` | `#CFE0F2` | `#17181A` text: **`13.20:1`** | `#2A4768` | `#EEEEEB` text: **`8.21:1`** | `>=4.5:1` |

#### Candidate 3 — Atelier Linen & Indigo *(NEW 5th Direction)*

| Semantic Token | Light Hex | Light Pair / Ratio | Dark Hex | Dark Pair / Ratio | Target |
| :--- | :--- | :--- | :--- | :--- | :--- |
| `--surface-canvas` / `--surface-sheet` | `#F5F2EA` / `#FEFCF7` | Tactile natural linen / warm ivory | `#151717` / `#1E2121` | Deep charcoal-slate | Surface |
| `--surface-mat` / `--surface-draft` | `#ECE8DC` / `#EEF3F1` | Recessed ref mat / soft teal-sage draft | `#111313` / `#1B2729` | Recessed ref mat / deep indigo-teal draft | Surface |
| `--text-primary` / `--text-secondary` | `#1D2124` / `#485056` | **`15.81:1`** / **`8.01:1`** on Sheet | `#EFECE5` / `#B5BEBE` | **`13.75:1`** / **`8.55:1`** on Sheet | `>=4.5:1` |
| `--text-muted` / placeholder | `#5A636A` | Sheet **`5.98:1`** · Draft **`5.46:1`** | `#9AA4A4` | Sheet **`6.35:1`** · Draft **`6.01:1`** | `>=4.5:1` |
| `--border-control` *(interactive)* | `#858278` | Sheet **`3.75:1`** · Canvas **`3.44:1`** | `#7D8888` | Sheet **`4.44:1`** | `>=3.0:1` |
| `--accent-primary` (Archival Indigo-Teal) | `#1E4D5C` | **`9.02:1`** on Sheet & White btn | `#7DC0CE` | **`7.96:1`** on Sheet · **`8.87:1`** `#121718` btn | `>=4.5:1` |
| `--accent-canon` / `--accent-belief` | `#1E5A46` / `#824E0E` | **`7.86:1`** / **`6.73:1`** on Sheet | `#79C2A6` / `#E4B15B` | **`7.79:1`** / **`8.29:1`** on Sheet | `>=4.5:1` |
| `--accent-inference` (Plum) / `--accent-danger` | `#6B3F6B` / `#9C2D2B` | **`8.04:1`** / **`7.25:1`** on Sheet | `#D2A1D2` / `#EE8886` | **`7.55:1`** / **`6.57:1`** on Sheet | `>=4.5:1` |
| `--selection-bg` | `#CCE2E6` | `#1D2124` text: **`12.04:1`** | `#264B54` | `#EFECE5` text: **`8.03:1`** | `>=4.5:1` |

- **Color-Vision Deficiency (CVD) Safeguard:** Across all 3 candidates, `Canon` (cool green-teal + `●` solid), `Belief/Stale` (warm amber + `◐` dotted), `Inference` (blue/plum + `◌` dashed), and `Conflict/Danger` (crimson/vermilion + `◆` thick solid) are separated by **both luminance/hue-axis divergence and redundant glyph/stroke encoding**, ensuring red-green color blindness (deuteranopia/protanopia) never confuses canon with conflict.

---

## 4. Side-by-Side Full-Screen Conceptual Wireframes (Same *Salt Ledger* Data)

All wireframes below use the **exact same project state** (`The Salt Ledger / Tuz Defteri`, active scene `Ch. 7 — The Lamp Room (v14)`, Hard Lock conflict on `Brass Fresnel Lens`, active Studio session `Act II Harbor Complicity`, OpenAI OAuth connected + Gemini ready + Cloudflare/Local Qwen embeddings configured) at **Desktop `1440×900`** so architectural differences are immediately legible.

### Screen 1: `Write` (Active Editing + Contextual Writing Assistant + Selected Passage)

#### Candidate 1 — Warm Literary Press (`M6` Top Anchor + 5 Center Intents · Calm Prose Sheet)
```text
┌──────────────────────────────────────────────────────────────────────────────────────────────────────┐
│ [The Salt Ledger ▾]      ● Write   World   Studio   Develop   Review        [Q&A] [Cmd+K] [Settings] │
├──────────────────┬───────────────────────────────────────────────────────────┬───────────────────────┤
│ BINDER (Mat)     │  Ch. 7 — The Lamp Room  ·  Formatted | Raw | Split | Read │ ASSIST (Selection)    │
│ ───────────────  │  [Focus] [Local Insights: 2 hints]    Saved v14 · 482w    │ ───────────────────── │
│ ▾ Part I         │  ───────────────────────────────────────────────────────  │ Selected (Ch. 7 §4):  │
│   Ch. 1 Finding  │                                                           │ "original 1954 brass  │
│   Ch. 2 1961     │     The salt crust had crept halfway up the lantern       │  Fresnel lens"        │
│   Ch. 3 Tuz Def. │   glass by dusk. Leyla wrapped her knuckles in a damp     │                       │
│ ▾ Part II        │   canvas rag and climbed the iron spiral.                 │ [Refine] [Expand]     │
│   Ch. 5 Kemal    │                                                           │ [Tighten] [Tone]      │
│ ● Ch. 7 Lamp ◆   │     She paused beside the brass cradle. ▒▒Leyla polished  │ [Fix Conflict ◆]      │
│   Ch. 8 Fog ?    │   the original 1954 brass Fresnel lens▒▒ until the salt   │ ───────────────────── │
│                  │   cleared, listening to the lodos rattle the bolts.       │ ⚠ Lock Alert (Local): │
│ [+ Scene]        │                                                           │ Ch. 2 §2 🔒 says 1954 │
│                  │  ┌─ Scene Context (Collapsed) ─────────────────────────┐  │ lens shattered 1961.  │
│ [Pin: Arif]      │  │ POV: Leyla · Date: 1982-02-14 · Locks: 2 active [▸] │  │ [Open Ch. 2 Beside]   │
│ [Pin: 1954 Log]  │  └─────────────────────────────────────────────────────┘  │ [Ask Story Q&A]       │
└──────────────────┴───────────────────────────────────────────────────────────┴───────────────────────┘
```

#### Candidate 2 — Quiet Ink & Monograph (`M5` Slim Left Intent Rail · Sharp Hairline Precision)
```text
┌──────┬─────────────────┬────────────────────────────────────────────────────┬────────────────────────┐
│ PCC  │ OUTLINE         │ The Salt Ledger / Ch. 7 — The Lamp Room  [v14]     │ WRITING ASSISTANT      │
│ ──── │ ─────────────── │ Mode: [Formatted●][Raw][Split][Read]  [Calm|Deep]  │ ────────────────────── │
│ Home │ Ch. 1 Finding   │ ────────────────────────────────────────────────── │ Selection: Ch.7 §4:118 │
│ ●Wrt │ Ch. 2 1961      │                                                    │ [Rewrite] [Tighten]    │
│ Wrld │ Ch. 3 Tuz Def.  │   The salt crust had crept halfway up the lantern  │ [Subtext] [Continue]   │
│ Stud │ Ch. 5 Kemal     │ glass by dusk. Leyla wrapped her knuckles in a     │                        │
│ Devl │ ●Ch. 7 Lamp [◆] │ damp canvas rag and climbed the iron spiral.       │ ── DRAFT PROPOSAL ───  │
│ Revw │ Ch. 8 Fog   [?] │                                                    │ (Cool Slate Tray ◌)    │
│ ──── │ ─────────────── │   She paused beside the brass cradle. ▒▒Leyla      │ - original 1954 brass  │
│ Q&A  │ SCENE META      │ polished the original 1954 brass Fresnel lens▒▒    │ + replacement 1962     │
│ CmdK │ POV: Leyla      │ until the salt cleared...                          │   steel-framed         │
│ Pref │ 1982-02-14      │                                                    │ [Replace][Insert]      │
│      │ Locks: 2 🔒     │ ── LOCAL RHYTHM / ECHO (Deterministic) ──────────  │ [Keep Alt][Discard]    │
│      │                 │ • "salt" x3 in 45 words (deliberate motif? [Pin])  │                        │
└──────┴─────────────────┴────────────────────────────────────────────────────┴────────────────────────┘
```

#### Candidate 3 — Atelier Linen & Indigo *(NEW — Adaptive Top Bar + Recessed Linen Trays)*
```text
┌──────────────────────────────────────────────────────────────────────────────────────────────────────┐
│ [The Salt Ledger] · Write ▾   |  World   Studio   Develop   Review   |  [+ Companion] [Q&A] [⚙]     │
├──────────────────┬───────────────────────────────────────────────────────────────────────────────────┤
│ BINDER (Linen)   │ ╔═══════════════════════════════════════════════════════════════════════════════╗ │
│ Ch. 1 Finding    │ ║ Ch. 7 — The Lamp Room   ·  1982-02-14 · POV: Leyla   [Read] [Focus] [Assist]║ │
│ Ch. 2 1961 🔒    │ ╟─────────────────────────────────────────────────────────────────────────────╢ │
│ Ch. 3 Tuz Def.   │ ║   The salt crust had crept halfway up the lantern glass by dusk. Leyla      ║ │
│ Ch. 5 Kemal      │ ║ wrapped her knuckles in a damp canvas rag and climbed the iron spiral.      ║ │
│ ● Ch. 7 Lamp ◆   │ ║                                                                             ║ │
│ Ch. 8 Fog ?      │ ║   She paused beside the brass cradle. ▒▒Leyla polished the original 1954    ║ │
│                  │ ║ brass Fresnel lens▒▒ until the salt cleared, listening to the lodos...      ║ │
│ ── PINNED ─────  │ ║       ┌─ Selection Popover (Archival Indigo) ─────────────────────────┐     ║ │
│ 🔒 1954 Logbook  │ ║       │ [Assist ▾] [◆ Lock Conflict: Ch.2 §2] [Ask Q&A] [Send Studio] │     ║ │
│ ● Captain Arif   │ ║       └───────────────────────────────────────────────────────────────┘     ║ │
│                  │ ╚═══════════════════════════════════════════════════════════════════════════════╝ │
│ Resume: Review ↩ │   [Local Writing Insights: 1 echo, 0 passive warnings]   [View Raw Markdown]      │
└──────────────────┴───────────────────────────────────────────────────────────────────────────────────┘
```
*Key Comparative Takeaway:* Candidate 1 maximizes warm book-like calm; Candidate 2 keeps `M5` vertical space highest and places diffs/metadata in crisp analytical rails; Candidate 3 achieves maximum uninterrupted prose width (`~72ch` centered on `#FEFCF7` ivory sheet over `#F5F2EA` linen) by keeping Assist as a **Selection Popover + toggleable slide-in drawer** rather than a permanent 3rd column.

---

### Screen 2: `World` (Full-Bleed Story Map + Sub-Views + Dual-Axis As-Of Bar)

#### Candidate 1 (Warm Press) vs. Candidate 2 (Monograph) vs. Candidate 3 (Atelier Linen)
- **Shared IA Structure (`Owner-approved`):** `World` offers 6 clean horizontal view pills/tabs: `Story Map ●` | `Story Bible` | `Mind Map` | `Timeline` | `Knowledge Matrix` | `Threads & Themes`, plus the persistent **Dual-Axis As-Of Bar** (`Reader ≤ Full Book` · `World Time: Synced`) and a **`[Table / List Fallback]`** button always at top-right.
- **Visual Contrast Across Candidates (Rendered on *The Salt Ledger* Story Map):**
```text
CANDIDATE 1 (Warm Press): Warm ivory canvas (#F7F4EE), rounded pill nodes, soft plum/forest/amber curves;
  inspector opens ONLY when clicking [◆ Brass Fresnel Lens] as a floating right sheet (360px).

CANDIDATE 2 (Monograph): Crisp `#FCFBF8` drafting plane with subtle dot-grid toggle, sharp rectangular entity
  cards with header rules (`ARTIFACT · CONFLICT ◆`), docked 340px right inspection column with raw anchor table.

CANDIDATE 3 (Atelier Linen): Recessed `#ECE8DC` mat behind an elevated `#FEFCF7` map frame; As-Of Dual-Axis
  Scrubber sits cleanly in the recessed top shelf (`Reader: Ch. 5` | `Story: 1982-02-09`) with `[Open Ch. 7 Beside]`
  one-click Dual-Pane Companion trigger so the author edits prose while watching the map.
```

---

### Screen 3: `Creative Studio` (Owner-Approved Card Semantics + Voluntary `Grill Me`)

```text
┌─ CREATIVE STUDIO · Session: "Act II Harbor Complicity" (Saved · Grounded: Ch. 1–5 + Locks 🔒) ──────┐
│ Modes: [● Discover] [Focused Dev] [Guided] [Story Lab] [Grill Me (Voluntary) ▾]   [Creative Compass] │
├─────────────────────────────────────────────────────────────┬────────────────────────────────────────┤
│ EXPLORATION STREAM (No Auto-Apply · Dashed Draft Trays ◌)   │ SESSION CONTROLS & PINNED SCOPE        │
│                                                             │ ────────────────────────────────────── │
│ ┌─ Card A (Selected ☑) · Direction: "Coerced Harbor Pilot"┐ │ Scope: Ch. 1–5 (excludes Ch. 7–8)      │
│ │ What if Arif forged the 1954 entry to clear a refugee   │ │ Hard Locks (2 🔒):                     │
│ │ skiff while Kemal turned a blind eye?                   │ │  • 14 Aug 1954 date immutable          │
│ │ [Preview/Edit] [Develop Further (Keep Original)]        │ │  • 1954 lens shattered in 1961         │
│ │ [Regenerate Only This] [Challenge] [Save] [Dismiss]     │ │ Soft Guidance (◇): Understated voice   │
│ └─────────────────────────────────────────────────────────┘ │                                        │
│ ┌─ Card B (Selected ☑) · Direction: "Duplicate Stub" ─────┐ │ Multi-Select Bar (2 cards checked):    │
│ │ Kemal holds the carbon-copy customs stub in a locked... │ │ [Combine A + B]  [Compare Side-by-Side]│
│ └─────────────────────────────────────────────────────────┘ │ [Save as Alternative Project (Safe)]   │
│                                                             │                                        │
│ [+ Suggest More Directions (Appends — keeps A & B)]         │ Custom Direction Input:                │
│                                                             │ ┌────────────────────────────────────┐ │
│ Grill Me Mode (Optional): [Rapid Clarify] [Devil's Advoc.]  │ │ "Focus on Leyla's mother's silence"│ │
│ [Socratic] [Plot Stress-Test] — [Stop Early Anytime]        │ └────────────────────────────────────┘ │
│                                                             │ [Suggest Directions]  [Generate Idea]  │
└─────────────────────────────────────────────────────────────┴────────────────────────────────────────┘
```
*Candidate Distinction:* Candidate 1 styles draft cards in warm `#F5ECF3` plum-tint with rounded editorial tags; Candidate 2 uses sharp `#EEF3F8` cobalt-bordered cards with numbered indices `[01]`, `[02]` for structured multi-select synthesis; Candidate 3 places the draft cards on `#EEF3F1` archival drafting trays with a prominent top badge `Draft Only — Canonical Manuscript Untouched`.

---

### Screen 4: `Story Development` (Strengthening Existing Narrative with Shared Engines)

```text
┌─ STORY DEVELOPMENT · Target: Ch. 5 — Harbor Confrontation (v14) · Scope: Scene + Act II Arc ─────────┐
│ Lenses: [Scene & Dialogue ●] [Character Depth] [Pacing & Tension] [Voice & Subtext] [Tighten]        │
├─────────────────────────────────────────────────────────────┬────────────────────────────────────────┤
│ EXISTING TEXT (Anchored Read-Only Reference)                │ DEVELOPMENT OPTIONS (Preserves Locks)  │
│ ─────────────────────────────────────────────────────────── │ ────────────────────────────────────── │
│ §3: "You signed the August clearance, Kemal," Leyla said.   │ Local Deterministic Hints (Instant):   │
│     Kemal did not look up from the ledger. "Your father     │ • 4 consecutive dialogue turns lack    │
│     never told you why the ferry left early."               │   physical beat / subtext pause.       │
│                                                             │                                        │
│ Epistemic Context (Live from World):                        │ AI Development Proposals (Run on click)│
│ • Leyla holds ◐ False Belief (blames Kemal)                 │ [Deepen Subtext Without Breaking Irony]│
│ • Kemal ◔ Suspects Arif was coerced                         │ [Sharpen Turkish-Cadence Dialogue]     │
│                                                             │ ↳ Cost/Scope Preflight shown before AI │
│ [Open Ch. 5 in Write Beside]                                │ ↳ Proposals stage to Review (no auto)  │
└─────────────────────────────────────────────────────────────┴────────────────────────────────────────┘
```

---

### Screen 5: `Review` (Clear Triage + Sentence/Hunk Cherry-Pick + Full-Width History)

```text
┌─ REVIEW · Triage: [Issues (1 ◆)] [Readiness (2)] [Creative Options (3)] [History & Audit (Full)] ────┐
├──────────────────────────────┬───────────────────────────────────────────────────────────────────────┤
│ TRIAGE QUEUE                 │ ACTIVE PROPOSAL · Hard Lock Conflict ◆ (Ch. 7 §4 vs. Ch. 2 §2 🔒)     │
│ ──────────────────────────── │ Source: Ch. 7 v14 (Exact Match ●) · Evidence: [Peek Ch. 2 §2]         │
│ ◆ Brass Fresnel Lens         │ ───────────────────────────────────────────────────────────────────── │
│   Ch. 7 §4 contradicts       │ ☑ Hunk 1 (Sentence 1 — Resolves Lock ◆):                              │
│   1961 shatter lock (Ch.2)   │   - ...the original 1954 brass Fresnel lens until the salt cleared.   │
│   [Selected]                 │   + ...the replacement 1962 steel-framed lens until the salt cleared. │
│                              │ ☐ Hunk 2 (Sentence 3 — Stylistic Polish, Independent):                │
│ ◔ Unanchored Scene           │   - Her knuckles ached from the wet rag.  [Edit Inline]               │
│   Ch. 8 Fog Dream lacks      │                                                                       │
│   chronology tag (Readiness) │ [Deterministic Change Map: 1 hunk · Locks 2/2 PASS]                   │
│                              │ [Possible Downstream Ripples (Speculative ◌ · 2 items ▸)]             │
│                              │ ───────────────────────────────────────────────────────────────────── │
│ [Run Scoped Consistency...]  │ [Apply Selected (1 Hunk)]  [Stage Only]  [Discard]  [Undo Last Apply] │
└──────────────────────────────┴───────────────────────────────────────────────────────────────────────┘
```
*Full-Width History & Audit Tab:* Eliminates the `398px` cramped `HistoryPanel.tsx` defect (`Confirmed in source`) by rendering `RevisionComparisonSection` across the full workspace width (`1100px+`), while moving Export, Backup, and Saved Projects to their true home in `Projects / Home`.

---

### Screen 6: `Projects / Home` (Library Separated from Active State + Recovery + Optional R2 Backup)

```text
┌─ PROJECTS & ARCHIVE · Launch Behavior: [● Resume Last Project] [Open Library] ───────────────────────┐
│ ┌─ RESUME LAST SESSION (UI-NEW-08) ────────────────────────────────────────────────────────────────┐ │
│ │ The Salt Ledger / Tuz Defteri · Last open: Write → Ch. 7 §4 (v14) · 1 pending Review conflict ◆  │ │
│ │ [Resume Ch. 7 §4]   [Open Project Overview]   [Compare Alternative: Gazette Ending (Read-Only)]  │ │
│ └──────────────────────────────────────────────────────────────────────────────────────────────────┘ │
│                                                                                                      │
│ [+ New Premise]  [Import Manuscript (.md/.txt/.json)]  [Blank Project]  [Optional Sample Story]      │
│                                                                                                      │
│ YOUR PROJECTS (No Fake % Completion Bars — Meaningful Factual Signals Only)                          │
│ ┌─────────────────────────────────────┐  ┌─────────────────────────────────────┐                     │
│ │ The Salt Ledger / Tuz Defteri  [●]  │  │ Salt Ledger — Gazette Ending [Alt]  │                     │
│ │ 18,420 words · 8 chapters · 2 locks │  │ Branched from Ch. 5 · 19,105 words  │                     │
│ │ Edited 14m ago · Local Saved ●      │  │ Edited 2d ago · Local Saved ●       │                     │
│ │ [Open] [Overview] [Export] [Backup] │  │ [Open Beside Main] [Switch Active]  │                     │
│ └─────────────────────────────────────┘  └─────────────────────────────────────┘                     │
│                                                                                                      │
│ SAFETY, RECOVERY & OPTIONAL ENCRYPTED CLOUD BACKUP (Cloudflare R2 — Local-Primary · Manual-First)    │
│ • Local Integrity: IndexedDB Healthy ● · Recovery Snapshots: 6 available [Open Recovery Assistant]   │
│ • Optional R2 Encrypted Backup: Not Configured (Zero auto-sync; manual versioned encrypted push)     │
│   [Configure Optional R2 Backup...]  [Verify Backup Key / Restore as New Copy...]                    │
└──────────────────────────────────────────────────────────────────────────────────────────────────────┘
```

---

### Screen 7: `AI Settings & Operations` (5-Section Redesign + Truthful Operations + Secondary Visuals)

```text
┌─ AI SETTINGS & OPERATIONS ───────────────────────────────────────────────────────────────────────────┐
│ [● Overview & Connections] [Models & Defaults] [Operation Overrides] [Embeddings & Search] [Usage]   │
├──────────────────────────────────────────────────────────────────────────────────────────────────────┤
│ PROVIDER CONNECTIONS (Connectivity, Catalog & Eligibility Shown Separately — Never Conflated)        │
│ ┌──────────────────────┬───────────────────────┬──────────────────────────┬────────────────────────┐ │
│ │ Provider             │ Auth / Connectivity   │ Model Catalog            │ Actions                │ │
│ ├──────────────────────┼───────────────────────┼──────────────────────────┼────────────────────────┤ │
│ │ OpenAI (OAuth)       │ ● Verified OAuth      │ ● 14 models (Refreshed)  │ [Refresh Catalog]      │ │
│ │ Google Gemini        │ ● Key Configured      │ ● 8 models (Verified)    │ [Test] [Refresh]       │ │
│ │ LM Studio (Local)    │ ○ Offline (127.0.0.1) │ — Not reachable          │ [Retry Local Check]    │ │
│ └──────────────────────┴───────────────────────┴──────────────────────────┴────────────────────────┘ │
│ Note: Verified OAuth triggers one bounded targeted catalog refresh only — zero automatic inference.  │
│                                                                                                      │
│ EMBEDDINGS & SEMANTIC SEARCH (Optional & Independent — Standard Lexical Search Always Works)         │
│ Policy: [Off] [● Priority Order] [Use All Available]   Consent: Local text leaves device only if...  │
│ Providers (Independent from R2 Backup): [Cloudflare Workers AI] [LM Studio Qwen3-0.6B] [Gemini Emb2] │
│ (Owner personal preference Cloudflare → Local Qwen is user-configurable, never hardcoded default)    │
│                                                                                                      │
│ ACTIVE OPERATIONS & CONTEXT INSPECTOR (Truthful Phases — Zero Fake %) · [Secondary Visuals Settings] │
│ • Idle · Last run: Scoped Consistency (Ch. 7) — Completed in 3.2s · [Inspect Exact Sent Context]     │
└──────────────────────────────────────────────────────────────────────────────────────────────────────┘
```

---

## 5. Required Non-Ideal States & Constrained Narrow-Screen (`390×844`) Examples

### 5.1 Four Critical System States (Consistent Across All 3 Candidates)

| State | Visual Surface & Cue | Exact Copy & Action Example (*The Salt Ledger*) |
| :--- | :--- | :--- |
| **Empty (New Project)** | Clean sheet (`--surface-sheet`), zero placeholder lorem ipsum, 2 clear entry choices | *"Your manuscript is empty. Start writing Scene 1 below, paste an existing draft, or open Creative Studio to explore your premise first."* `[Start Writing]` `[Import .md/.txt]` `[Open Creative Studio]` |
| **Loading (Truthful AI Phase)** | `--surface-draft` tray with animated subtle pulse (respecting `prefers-reduced-motion`) + **stepped phase label (never fake `%`)** | `Phase 2 of 3: Checking Ch. 7 §4 against 2 active Hard Locks... (Elapsed: 4s)` `[Cancel Safely]` `[Inspect Context Sent]` |
| **Error / Stale Conflict** | `--accent-danger` / `--accent-belief` left bar + icon (`◆` / `⚠`), **preserves unsaved author draft** | *"OpenAI timed out after sending request (consumed state uncertain — no automatic paid fallback triggered). Your draft and 1 partial idea card are safely preserved."* `[Retry Manually]` `[Switch Provider Manually]` `[View Preserved Draft]` |
| **Preview / Proposal** | Distinct `--surface-draft` frame + explicit `Preview Only — Not Applied` header | Exact sentence/hunk diff with independent checkboxes, deterministic revalidation line, and `[Apply Selected]` / `[Edit]` / `[Discard]` |

### 5.2 Constrained Mobile / `390×844` & `200%` Zoom Behavior

```text
┌─ 390px MOBILE · WRITE (Candidate 1 / 3) ─┐   ┌─ 390px MOBILE · WORLD MATRIX ───────────┐
│ [☰] The Salt Ledger    [Assist] [Q&A]    │   │ [← World] Knowledge Matrix  [As-Of: Ch5]│
│ ──────────────────────────────────────── │   │ ─────────────────────────────────────── │
│ Ch. 7 — The Lamp Room  [Read●][Edit]     │   │ ▾ F1: Arif forged 1954 clearance 🔒     │
│                                          │   │   Reader: ● Knows (Ch. 3 §2)            │
│   The salt crust had crept halfway up    │   │   Leyla:  ◐ False Belief (blames Kemal) │
│ the lantern glass by dusk. Leyla wrapped │   │   Kemal:  ◔ Suspects coercion           │
│ her knuckles in a damp canvas rag...     │   │   Arif:   ● Knew (1954-08-14)           │
│                                          │   │   [Peek Source Ch. 3 §2]                │
│ ▒▒original 1954 brass Fresnel lens▒▒     │   │ ─────────────────────────────────────── │
│                                          │   │ ▸ F2: 1954 Brass Lens shattered ◆       │
│ ┌─ Bottom Sheet: Selection Assist ─────┐ │   │ ▸ F3: Logbook hidden in floorboard ●    │
│ │ ⚠ Hard Lock Conflict (Ch. 2 §2)      │ │   └─────────────────────────────────────────┘
│ │ [Refine] [Fix ◆] [Open Ch. 2]        │ │
│ └──────────────────────────────────────┘ │
│ [Write●] [World] [Studio] [Dev] [Review] │
└──────────────────────────────────────────┘
```
- **Target Size Discipline (Correcting `ui-01` Overstatement):** WCAG 2.2 AA SC 2.5.8 specifies a minimum `24×24 CSS px` target size (or sufficient spacing). PCC treats `40×40px` (desktop comfort) and `44×44px` (mobile touch comfort) as **voluntary ergonomic targets**, never claiming `44px` is a universal WCAG AA mandate. Similarly, a `48px` header height and `>=65–70%` prose canvas area are treated as **evaluable desktop design targets**, not rigid rules for `390px` or `200%` zoom viewports.

---

## 6. Typography, Localization, Motion & Two-Phase Token Migration

### 6.1 Font Availability, Licensing & Turkish/Multilingual Readiness

| Role | Primary Choice | License | Turkish Diacritic Coverage (`ğ Ğ ş Ş ı İ ö Ö ü Ü ç Ç`) | Offline / Local Fallback Stack |
| :--- | :--- | :--- | :--- | :--- |
| **Long-Form Prose** | `Literata` (variable optical size `opsz`) *(or `Source Serif 4` in Cand. 2)* | SIL Open Font License 1.1 (self-hostable WOFF2 — zero runtime external CDN dependency required!) | Full Latin Extended-A (`İ/ı`, `Ğ/ğ`, `Ş/ş` verified in Google Fonts Latin-Ext subset) | `'Literata', 'Georgia', 'Iowan Old Style', serif` |
| **Interface / Navigation** | `DM Sans` *(or `Inter` in Cand. 2 / `Plus Jakarta Sans` in Cand. 3)* | SIL Open Font License 1.1 (self-hostable) | Full Latin Extended-A + tabular numerals (`font-variant-numeric: tabular-nums`) | `'DM Sans', system-ui, -apple-system, sans-serif` |
| **Raw Markdown / Diffs / IDs** | `JetBrains Mono` | SIL Open Font License 1.1 (self-hostable) | Full Latin Extended-A + crisp zero/O/1/l distinction | `'JetBrains Mono', ui-monospace, SFMono-Regular, monospace` |

- **Editor Measure & Reading Ergonomics:** Default reading/writing line measure **`64ch–72ch`** (`max-width: 68ch`), `18px–19px` body size (`1.68` line-height), user-adjustable via Comfort Controls (`Compact / Standard / Generous` + `Serif / Sans / Mono` prose toggle).
- **Motion Rules:** All drawer transitions, citation peeks, and focus toggles respect `@media (prefers-reduced-motion: reduce)` by dropping transforms to `0ms` instant opacity/visibility swaps.

### 6.2 Separating Early Swappable Tokens (`WP03`) from Final Aesthetic Overhaul (`WP07`)

To prevent throwaway rework while preserving owner choice until `WP07`:
1. **`WP03` (Low-Risk Semantic Token Layer):** Replace hardcoded legacy hex colors and failing muted grays (`#827d83`, `#aaa5aa`) with semantic CSS custom properties (`--surface-canvas`, `--surface-sheet`, `--surface-mat`, `--surface-draft`, `--text-primary`, `--text-secondary`, `--text-muted`, `--border-hairline`, `--border-control`, `--accent-*`) plus shared accessible primitives (`Button`, `Sheet`, `DraftTray`, `StatusBadge`).
2. **`WP07` (Approved Visual Direction Execution):** Once the owner selects Candidate 1, Candidate 2, Candidate 3, or a hybrid (Decision `UID2-01` in Doc `08`), `WP07` applies the chosen typography, navigation chrome, elevation/border grammar, dark mode, and full-screen refinements cleanly over those already-wired semantic tokens.

---

## 7. Future Accessibility & Visual Verification Plan (No False Compliance Claims)

This research study makes **zero claim of WCAG 2.2 AA conformance**. Before `WP07` / `WP08` signs off, the implementation team must execute a real verification protocol:

1. **Automated Audits:** Run `axe-core` / Playwright accessibility snapshots across all 7 screens in Light Mode, Dark Mode, Desktop (`1440×900`), Laptop (`1024×768`), Mobile (`390×844`), and `200%` browser zoom (`1280px` zoomed to `200%` — SC 1.4.10 Reflow).
2. **Manual Keyboard-Only Walkthrough:** Complete `J-01` through `J-15` without a mouse — verifying visible `--focus-ring`, logical tab order, Escape dismissal of modals/popovers, focus restoration after closing Companion Pane or `Cmd+K`, and full keyboard table/outline parity for all 7 visualizations.
3. **IME & Turkish Localization Check:** Test Turkish `ı/İ/ğ/ş/ö/ü/ç` typing, selection offsets, `Local Writing Insights` echo heuristics, and `Cmd+K` diacritic-folded search in raw and formatted Markdown modes.
4. **Screen-Reader Spot Checks:** Verify VoiceOver / NVDA announcements for ARIA live regions (truthful AI loading phases, stale citation warnings, hunk dependency alerts, and Knowledge Matrix grid cells).
5. **Color-Vision Simulation:** Inspect Story Map, Causality Graph, Dual Timeline, Knowledge Matrix, and Review Diff under simulated Deuteranopia, Protanopia, Tritanopia, and Achromatopsia to confirm zero meaning depends on hue alone.

---

## 8. Recommendation Summary (Without Deciding for the Owner)

- **Strongest All-Around Literary Balance:** **Candidate 1 (Warm Literary Press Refined)** if the owner prioritizes serene, book-like long-form writing above all else.
- **Strongest High-Density Structural Clarity:** **Candidate 2 (Quiet Ink & Monograph)** if the owner prefers crisp editorial neutrality, `M5` slim vertical rail, and maximum analytical precision in `Review` and `World`.
- **Strongest Hybrid Synthesis (New):** **Candidate 3 (Atelier Linen & Indigo)** if the owner wants warm linen tactile comfort *and* unmistakably recessed drafting trays (`Sheet` vs. `Reference Mat` vs. `Unreviewed Draft`) without plum tones.
- **Next Step:** Final visual selection is explicitly held open for the Owner Decision Agenda (`UID2-01` in [08-integrated-ui-roadmap-and-owner-decisions.md](./08-integrated-ui-roadmap-and-owner-decisions.md)).
