# 07 — Projects, AI Settings, Recovery, Optional R2 Backup & New UI Innovations

**Study:** `PCC-UI-RESEARCH-02` (Comparative UX Research, Design Synthesis & Product-Wide Interaction Blueprint)  
**Canonical Story Fixture:** *The Salt Ledger / Tuz Defteri*  
**Scope:** Complete 8-state interaction specifications for `Projects / Home` (including Recovery Assistant and optional local-primary Cloudflare R2 encrypted backup) and `AI Settings & Operations` (5-section redesign, independent embeddings, truthful Operation Center, Context Inspector, Secondary Visuals); **6 brand-new comparative UI innovations (`UIC-01`–`UIC-06`)**; and a **4-Mechanism Consolidation Architecture** that absorbs all `UI-NEW-01–08`, `UIRF-01–06`, and `UIC-01–06` without creating menu sprawl.  
**Evidence Boundary:** Current defects (`HistoryPanel.tsx` mixing backup/export/saved projects in a narrow rail; settings catalog behavior; persistence layers) are `Confirmed in source`; all proposed screen specifications, R2 workflows, and `UIC-01`–`06` concepts are `Proposed design`; owner requirements (`UID-08`, R2 local-primary manual-first, personal embedding preference vs. global default, no fake completion scores) are `Owner-approved`.

---

## 1. Screen Family Specification: `Projects / Home`, Overview, Recovery & Optional R2 Backup

### 1.1 Purpose & Core Architectural Boundary

Currently (`Confirmed in source`), project management, export, backup/restore, and revision history are crammed into the `398px` `HistoryPanel.tsx` inspector rail. This confuses **library-level lifecycle** (*"which manuscript am I opening, duplicating, backing up, or recovering?"*) with **active manuscript editing** (*"what am I writing right now?"*).

`Projects / Home` resolves this by enforcing a strict **Two-Tier Mental Model**:
1. **Project Library & Safety Hub (`Projects`):** Switching projects, starting a new premise/blank/import/optional sample, managing saved alternatives (*Salt Ledger — Gazette Ending*), exporting, checking local IndexedDB health, running the **Recovery Assistant (`GS-07`)**, and managing **optional Cloudflare R2 encrypted backups**.
2. **Project Overview (Active Project Home Card / Sub-View):** A calm, factual summary of the *selected* project — showing real counts (`18,420 words`, `8 chapters`, `2 Hard Locks`, `1 open Review conflict ◆`, `3 saved Studio sessions`, `last local save 14m ago`) and the **Last Session Resume Breadcrumb (`UI-NEW-08`)** — **strictly zero invented completion percentages or gamified streaks (`Owner-approved`)**.

### 1.2 Adaptive Launch Contract (`UID-08`)

- **First-Time / Zero-Project User:** Lands on `Projects / Home` with three quiet primary doors:
  1. `[Start from a Premise (Creative Studio)]`
  2. `[Open Blank Manuscript]`
  3. `[Import Existing Draft (.md / .txt / .json)]`
  *(Plus a clearly secondary, optional link: `Explore Optional Sample Story ("The Salt Ledger")` — never auto-loaded as fake user data.)*
- **Returning Author (Default `Owner-approved`):** Opens **directly into their last active workspace** (e.g., `Write → Ch. 7 §4`), displaying a quiet, dismissible 1-line **Resume Breadcrumb (`UI-NEW-08`)** if they left mid-task (`Resumed Ch. 7 §4 · 1 pending Review conflict ◆ [Jump to Review]`).
- **User Preference Toggle:** `Launch Behavior: [● Resume Last Workspace] | [Open Project Library]` lives at the top of `Projects / Home` and inside General Preferences.

### 1.3 Complete 8-State Specification for `Projects / Home`

| State | Visual & Structural Behavior | Concrete *Salt Ledger* Example & Safe Actions |
| :--- | :--- | :--- |
| **1. Empty** | Clean sheet (`--surface-sheet`), zero empty-table chrome, 3 clear creation doors + optional sample | *"No projects in your local library yet. Your manuscripts stay on this device by default."* `[New Premise]` `[Blank Project]` `[Import]` `[Try Optional Sample]` |
| **2. Ready** | Resume Banner (`UI-NEW-08`) + Project Grid/List (Main + nested/grouped Alternatives) + Safety/Backup footer strip | *The Salt Ledger (Main)* `[Active ●]` paired visually with sibling alternative *Salt Ledger — Gazette Ending [Alt]* (`[Open Beside Main (Read-Only)]`, `[Switch Active]`) |
| **3. Loading** | Skeleton cards with calm aria-live label (`Loading local project index...`) — never flashes Empty state before IndexedDB resolves | Prevents false panic that manuscripts were lost on slow cold starts |
| **4. Partial** | Library loads, while optional R2 remote status check is offline/unreachable | Local projects remain 100% interactive; R2 strip displays `Optional Cloud Backup: Offline (Local IndexedDB Healthy ●) · [Retry Check]` |
| **5. Error** | Specific persistence or import error card with non-destructive diagnostic details & JSON export escape hatch | *"Import skipped 2 malformed scenes in `draft.json`. Valid chapters are previewed below — nothing in your existing library was altered."* `[Preview Valid Scenes]` `[Cancel]` |
| **6. Recovery (`GS-07`)** | Dedicated **Recovery Assistant** drawer/view comparing local IndexedDB snapshots, autosave draft buffers, and optional R2 encrypted versions | Shows exact timestamp, word count delta, chapter count, SHA-256 manifest digest, and **`[Preview Before Restoring]`** + **`[Restore as New Copy (Recommended)]`** |
| **7. Success** | Quiet non-blocking confirmation toast/inline status with exact artifact target | *"Created encrypted R2 snapshot `salt-ledger-2026-11-28-v14` (412 KB). Local project unchanged."* |
| **8. Stale / Divergent** | Clear badge when local manuscript has changed since the last manual export or R2 snapshot | `Local is 3 chapters ahead of last manual R2 backup (2 days ago) · [Push Manual Snapshot]` *(Never auto-pushes!)* |

### 1.4 Optional Cloudflare R2 Encrypted Backup Contract (`Owner-approved`, `WP06`)

To guarantee data sovereignty and prevent accidental cloud lock-in or surprise charges, optional R2 backup follows **seven ironclad UX rules**:

1. **Strictly Local-Primary & Manual-First:** IndexedDB/local storage is always the source of truth. **Zero automatic background sync** and zero silent remote overwrites. Every remote backup is an explicit author-triggered versioned snapshot (`[Push Versioned Snapshot]`) or an explicitly opted-in, clearly disclosed manual reminder.
2. **Independent from Workers AI Embeddings:** Configuring Cloudflare R2 backup never enables Cloudflare Workers AI embeddings (and vice versa). Both live in separate surfaces (`Projects → Safety & Backup` vs. `AI Settings → Embeddings & Search`) with separate credentials and separate consent banners.
3. **Client-Side Encryption & Key Recovery Gate:** Snapshots are encrypted client-side before upload. Setup requires creating/saving a **Recovery Passphrase / Key File** with explicit acknowledgment (`"PCC cannot recover your passphrase; losing it makes encrypted R2 snapshots unreadable"`) — strengthened by our proposed `UIC-04` dry-run verification drill (§3 below).
4. **Manifest & Digest Integrity Check:** Every backup writes a versioned snapshot + manifest digest (`SHA-256`, chapter count, word count, timestamp, schema version). Before restoring, PCC verifies digest integrity and displays the exact metadata diff against local state.
5. **Restore-as-Copy Default:** Restoring any local snapshot or R2 backup defaults to **`Restore as New Copy ("The Salt Ledger — Restored 2026-11-28")`** so a recovery attempt can **never** destroy newer local edits. Replacing an existing project requires an explicit secondary confirmation typing the project name.
6. **Transparent Retention & Cost Visibility:** Displays current snapshot count, total compressed bytes, and configurable retention guidance (`Keep last N snapshots` with manual prune preview — never silent deletion of old backups). Clarifies clearly that Cloudflare R2 storage/operation billing belongs to the user's own Cloudflare account.
7. **Graceful Failure Handling:** Network drops, invalid tokens, CORS/bucket permission errors, or wrong decryption passphrases fail cleanly in place, keep local data untouched, and report the exact actionable cause (`Auth failed (403)`, `Network unreachable`, `Decryption key mismatch — check passphrase`).

---

## 2. Screen Family Specification: 5-Section `AI Settings & Operations`

### 2.1 Why Five Clean Sections Replace One Dense Settings Modal

Combining provider credentials, model picking, per-operation routing, embedding pipelines, context inspection, image settings, and usage logs into one scrollable sheet causes configuration fear and silent misrouting. PCC organizes `AI Settings & Operations` into **five distinct tabs** with a compact global status strip at top:

1. **`Overview & Connections`:** Provider authentication & connectivity status (**strictly separating Auth/Connectivity, Catalog Availability, and Operation Eligibility**).
   - **Verified OAuth Rule (`Owner-approved`):** Completing a verified OAuth sign-in triggers **one bounded, targeted catalog refresh** for that provider only (with visible `[Refresh Catalog]` manual retry if transient failure occurs). It triggers **zero automatic inference** and **zero unsolicited paid requests**.
   - **No Silent Paid Fallback (`Owner-approved`):** If a primary provider fails *after* request transmission (consumed/uncertain state) or hits quota, PCC **never** silently substitutes a paid fallback model. The author sees the failure cleanly and chooses manually whether to retry or switch.
2. **`Models & Defaults`:** Default text model per tier (`Fast / Balanced / Deep Reasoning`) filtered strictly to **actually eligible models** from verified catalogs, with plain-language badges (`Local`, `OAuth`, `API Key`, `Context Window`).
3. **`Operation Overrides`:** Granular per-workflow routing (`Writing Assistant`, `Creative Studio`, `Story Development`, `Scoped Consistency Review`, `Story Q&A`) — collapsed behind clean defaults (`Inherit Default`) so Calm-mode authors never have to touch it, while Deep-mode power users can pin e.g. `Deep Reasoning` to `Review` and `Fast` to `Writing Assistant`.
4. **`Embeddings & Search` (Optional & Strictly Independent):**
   - **Baseline Guarantee:** Standard local lexical search (with Turkish diacritic folding: `tuz` / `Tuz Defteri` / `Ağustos` / `agustos`) **always works offline with zero embeddings configured**.
   - **Independent Provider Pool:** Supports **LM Studio Local (`Qwen3-Embedding-0.6B`)**, **Cloudflare Workers AI**, and **Gemini Embedding 2** — each independently togglable, with explicit **Data-Leaving-Device Consent** before any remote embedding provider indexes manuscript text.
   - **Policy Modes (`Owner-approved`):**
     - `Off` (default for clean zero-external-call installations — standard lexical search active)
     - `Priority Order` (user-ordered list; e.g., the Owner's personal preference `Cloudflare Workers AI → LM Studio Local Qwen` is easily configured here as a **user setting, never hardcoded as a global default for other users**)
     - `Use All Available` (multi-index coverage where desired, showing exact per-provider index coverage e.g. `Ch. 1–8: 100% indexed in Local Qwen · 0% in Gemini`)
   - **Explicit Boundary Note:** Configuring Cloudflare Workers AI here does **not** touch or enable Cloudflare R2 backups.
5. **`Usage, Operations & Secondary Visuals`:**
   - **Truthful Operation Center (`GS-08` / `IR-01`):** Lists active, queued, completed, cancelled, and partial operations with **real execution phases** (`Preparing Scoped Context` → `Waiting for Provider` → `Validating Proposal`), elapsed time, exact token/cost estimate where provider returns usage, **`[Cancel Safely]`**, and **`[Recover Partial Draft]`**. **Strictly zero fake progress percentages (`0% → 87% → 99%`).**
   - **Context Inspector (`IR-02`):** Accessible both here and from any AI preflight/result pill — displays the **exact passages, Story Bible cards, Hard Locks, and As-Of boundary** sent (or about to be sent) to the model, with byte/character counts and spoiler-guard verification (`Ch. 7–8 Excluded by As-Of Ch. 5`).
   - **Secondary Visuals (`OD-07`):** Preserves existing image-generation controls and future story-linked visual reference settings in a dedicated quiet sub-section so visual generation remains available when wanted without distracting from prose writing.

### 2.2 Complete 8-State Specification for `AI Settings & Operations`

| State | Behavior & Exact User Feedback |
| :--- | :--- |
| **1. Empty (No Providers Configured)** | Clear banner: *"Offline Writing Mode active — all editing, Story Bible, Mind Map, Timeline, Knowledge Matrix, Local Writing Insights, and lexical search work without AI."* Offers clear setup cards for Local (`LM Studio`), OAuth (`OpenAI`), or API Key (`Gemini`). |
| **2. Ready** | Compact status strip (`OpenAI ● · Gemini ● · LM Studio ○ Offline · Embeddings: Priority [CF → Local]`) with independent Connectivity, Catalog, and Eligibility badges. |
| **3. Loading** | Bounded targeted catalog refresh spinner scoped *only* to the specific provider row (`Refreshing OpenAI catalog... [Cancel]`) — never blocks other tabs or writing. |
| **4. Partial** | Example: `OpenAI Auth ● Connected`, `Catalog ⚠ Refresh timed out (showing 14 cached models from 2h ago) · [Retry Catalog]`. Author knows auth succeeded even if catalog fetch stalled. |
| **5. Error** | Explicit distinction between `401 Invalid/Expired Auth`, `403 Model Not Eligible on Plan`, `429 Rate Limit`, and `Localhost 127.0.0.1 Unreachable (Start LM Studio server)`. Never collapses all errors into `"Connection failed"`. |
| **6. Recovery** | If an active AI operation drops mid-stream, Operation Center retains the partial output buffer with `[Inspect Partial Output]` and `[Save Partial as Draft Note]` — zero lost creative prose. |
| **7. Success** | Inline verified timestamp (`Catalog verified 12s ago · 14 eligible models`) + immediate availability in `Models & Defaults`. |
| **8. Stale** | If an embedding index lags behind recent manuscript edits (`Ch. 7 edited since last index`), displays `Index Stale on 1 of 8 chapters (Ch. 7) · [Re-Index Ch. 7 Only]` — never silently runs background remote re-indexing without consent. |

---

## 3. Six Brand-New Comparative UI Innovations (`UIC-01`–`UIC-06`)

Beyond synthesizing `PCC-UI-RESEARCH-01`, the Owner Review (`OR-*`), and the Approved Refinements (`UI-NEW-01–08`, `UIRF-01–06`), Cycle 3 & Cycle 4 uncovered **six genuine friction gaps** that neither prior study solved. Each innovation below is scoped as a lightweight, non-bloating affordance with an explicit **Owner Decision Gate** before implementation:

| ID | Innovation Name | Concrete Problem Solved | *The Salt Ledger* Example | Simpler Alternative Considered | Key Benefit | Cost / Complexity | Risk & Mitigation | Validation & Owner Gate |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| **`UIC-01`** | **Visual Scope & Lock Curtain** | Authors struggle to visualize *which* chapters and Hard Locks an AI action will see—causing distrust or accidental spoilers even when a text dropdown says `"Scope: Ch. 1–5"`. | In `Write` or `Studio`, hovering `[Inspect Scope]` dims `Ch. 7` & `Ch. 8` in the left Binder with a clean `"Excluded"` tag and highlights `Ch. 1–5` + the 2 🔒 Hard Locks in `--accent-canon`. | Plain text summary string inside Context Inspector (`IR-02`) only. | Instant spatial comprehension of AI scope and spoiler boundaries without opening a technical modal. | Low (CSS state class on existing Binder items; reuses `IR-02` scope payload). | Risk: Visual noise if always on. Mitigation: **Hover/toggle preview only** when inspecting or configuring scope. | Test with `As-Of Ch. 3` flashback; Gate: **`UID2-06`**. |
| **`UIC-02`** | **Epistemic Citation Diff Card** | When a citation goes `Stale ⚠` (`UI-NEW-03`), telling the author `"Edited since v14"` still forces manual hunting to check whether the cited fact actually changed. | Clicking `⚠ Stale · Ch. 2 §2` on the Fresnel Lens fact pops a 3-line mini-diff comparing archived v14 (`"shattered in the 1961 gale"`) vs. current v15 (`"cracked clean through in the 1961 gale"`) with `[Still True — Re-Anchor]` or `[Mark Conflict]`. | Open full `Write` editor beside and ask author to compare mentally. | Cuts stale-citation verification from ~30 seconds of hunting to ~2 seconds of confident confirmation. | Low-Medium (stores quoted excerpt + runs deterministic word-level diff against current paragraph). | Risk: Large edits create messy mini-diffs. Mitigation: Cap inline diff at 4 lines with `[Open Full Diff]`. | Unit-test exact match, moved match, minor edit, and deleted paragraph; Gate: **`UID2-06`**. |
| **`UIC-03`** | **Multilingual Chronology & Quotation Tag Helper** | Non-English dates (`14 Ağustos 1954`) and flashback markers break chronological sorting (`TimelinePanel.tsx` defect), yet forcing authors to type ISO dates into literary prose ruins immersion. | Highlighting `"14 Ağustos 1954"` in `Ch. 3 — Tuz Defteri` offers a 1-click metadata tag `Link Scene Date → 1954-08-14` stored in scene metadata while leaving the Turkish prose untouched. | Manual date entry form only inside `Timeline` tab. | Keeps prose 100% literary/multilingual while making Dual-Track Timeline (`V4`) and As-Of Scrubber (`UI-NEW-02`) effortless to populate. | Low (lightweight metadata attachment action; zero auto-mutation of text). | Risk: False-positive date detection in prose. Mitigation: Strictly **on-demand / opt-in chip**, never auto-tagged. | Verify Turkish/English/relative dates (`Day +3`) + zero text mutation; Gate: **`UID2-06`**. |
| **`UIC-04`** | **Guided Snapshot Key-Recovery Verification Drill** | Client-side encrypted R2 backups (`WP06`) are catastrophic if an author mistypes or loses their encryption passphrase—discovering that only during an emergency restore is too late. | During optional R2 setup, after saving the passphrase, an optional 20-second step encrypts & decrypts a 120-byte test manifest (`"Salt Ledger Key Check"`) asking the author to re-enter the passphrase once before confirming setup. | Single password + confirm password field during setup. | Proves the author's saved key/password manager actually decrypts a real ciphertext *before* trusting backups. | Very Low (reuses the exact WebCrypto encrypt/decrypt module already needed for R2). | Risk: Feels tedious if mandatory on every backup. Mitigation: **One-time during setup + optional `[Test Recovery Key]` button** anytime. | Verify failure message on wrong key + zero upload during local dry-run; Gate: **`UID2-06`**. |
| **`UIC-05`** | **Non-Destructive Sandbox Lock Relaxation Banner** | In `Creative Studio → Story Lab`, authors sometimes want to explore a bold "what-if" (*"What if the 1954 lens wasn't shattered?"*) without deleting their canonical Hard Lock. | Inside `Story Lab` only, author clicks `[Relax Lock in Sandbox]` on `1961 shattered lens 🔒`. A prominent amber banner appears (`Sandbox Mode: 1 Hard Lock temporarily relaxed — Canonical Locks untouched`). Trying to apply to Main blocks until the author either `[Save as Alternative Project]` or `[Review Canonical Lock Change]`. | Require deleting the Hard Lock globally or ignoring locks silently. | Encourages fearless creative exploration while making canonical lock integrity unbreakable. | Low (session-scoped `relaxedLockIds[]` array on Studio session; guard on Apply path). | Risk: Confusion over whether lock is still active in Main. Mitigation: Distinct banner + Main `Write`/`Review` never inherit sandbox relaxation. | Test that Main `Review` still flags `Ch. 7` conflict while Studio Sandbox explores alternate branch; Gate: **`UID2-06`**. |
| **`UIC-06`** | **Reading-to-Margin Micro-Annotation Stream** | In `UIRF-06` Distraction-Free Reading mode, authors spot pacing snags or ideas constantly—forcing them to drop out of Reading mode into full Edit mode destroys reading flow. | While reading `Ch. 5` in formatted Read Mode, author selects a line and hits `M` (or tap `Margin Note`) to drop a 1-line note (`"Check if Kemal sounds too defensive here"`). Notes collect in a quiet margin drawer convertible later to `Develop`, `Studio`, or `Review` tasks—zero manuscript mutation. | Force exiting Read Mode to edit or keep paper notebook beside screen. | Turns Distraction-Free Reading into an active editorial superpower without cluttering the page. | Low-Medium (anchored local annotation array using exact `E0` offsets/stale check). | Risk: Margin notes accumulate forever. Mitigation: Simple `Open / Resolved` filter + `[Convert to Studio Seed]` / `[Archive]`. | Verify Read Mode stays visually pristine when notes are collapsed + zero offset drift; Gate: **`UID2-06`**. |

---

## 4. Anti-Sprawl Consolidation Architecture: 20 Additions Folded into 4 Shared Mechanisms

A valid architectural concern raised in `RESEARCH-ASSIGNMENT.md §10` is that accepting **8 `UI-NEW` ideas + 6 `UIRF` additions + 6 `UIC` innovations** naively would create 20 disconnected menus, toolbars, and settings screens.

Instead, **all 20 capabilities consolidate cleanly into just 4 reusable product-wide mechanisms** — keeping Calm Mode serene and engineering surface small:

| Shared Mechanism | Capabilities Absorbed (No Separate Siloed Screens!) | Single Consistent User Mental Model |
| :--- | :--- | :--- |
| **1. Unified Navigation & Workspace State Engine** *(Doc `02 §6`)* | `UID-01` (Dual-Pane Companion), `UIRF-01` (Workspace Presets), `UIRF-02` (Pinned Entities/Scenes/Locks), `UIRF-03` (Deep-Link Return Trail), `UIRF-05` (Panel Expand/Maximize), `UI-NEW-04` (Local Bilingual `Cmd+K`), `UI-NEW-08` (Last-Session Resume Breadcrumb) | *"Everything about where I am, what is beside me, what I pinned, and how I get back lives in one predictable workspace chrome."* |
| **2. Grounded Anchor, Scope & Epistemic Bar** *(Doc `05 §4–5`)* | `UI-NEW-02` (Dual-Axis As-Of Scrubber), `UI-NEW-03` (Stale-Safe Inline Citation Peek), `UIC-01` (Visual Scope & Lock Curtain), `UIC-02` (Epistemic Citation Diff Card), `UIC-03` (Multilingual Chronology Tag Helper), `IR-02` (Context Inspector) | *"Every citation, scope filter, and As-Of slice uses the exact same anchor chip, stale-diff check, and spoiler boundary."* |
| **3. Contextual Reading & Drafting Lens Drawer** *(Doc `04 §2`)* | `UIRF-06` (Distraction-Free Reading), `UI-NEW-05` + `UI-NEW-07` (Combined Local Writing Insights: Rhythm/Echo + Multilingual Readability), `UIC-06` (Reading-to-Margin Micro-Annotation Stream), Elevated `WritingAssistantPanel` | *"One calm right/bottom lens beside prose switches cleanly between Writing Assist, Local Insights, and Margin Notes — closed by default in Calm Mode."* |
| **4. Trustworthy Proposal, Sandbox & Recovery Lifecycle** *(Doc `04 §5` & `07 §1–2`)* | `UI-NEW-01` (Hard Lock / Soft Guidance Badges), `UI-NEW-06` (Sentence/Hunk Cherry-Pick & Revalidation), `UIRF-04` (Truthful Preflight/Operation Trail), `UIC-04` (R2 Key-Recovery Dry-Run), `UIC-05` (Studio Sandbox Lock Relaxation), `GS-07` (Recovery Assistant) | *"Nothing mutates canon silently, every AI/cloud action previews exact boundaries first, and every draft or backup is safely recoverable."* |

---

## 5. Cross-Document Verification Notes

- All secondary surface requirements (`Projects / Home` adaptive launch, zero fake completion scores, `GS-07` Recovery Assistant, optional local-primary Cloudflare R2 encrypted backup with key recovery & restore-as-copy, 5-section `AI Settings`, verified OAuth → bounded targeted catalog refresh, independent LM Studio/Cloudflare/Gemini embeddings with personal config vs. global default, truthful Operation Center, Context Inspector, Secondary Visuals) are specified across all 8 UI states.
- The exact phasing of all mechanisms and innovations across `WP01`–`WP08`, along with the formal **Next Owner Decision Agenda (`UID2-01`–`UID2-08`)**, follows next in [08-integrated-ui-roadmap-and-owner-decisions.md](./08-integrated-ui-roadmap-and-owner-decisions.md).
