# Current-State User Journey Map (`J01` – `J12`)

- **Executed:** 2026-11-23 via `bash scripts/stage0-audit-browser.sh` against key-free production build (`http://127.0.0.1:3100`, `/api/health` → `configured: false`).
- **API Safety:** `0` unmocked upstream calls across all 12 journeys (`unmockedApiHits === 0`); deterministic local mocks used ONLY for `J01` (`/api/analyze`, `/api/clarify`), `J03` (`/api/clarify`), `J07` (`/api/generate/story`), `J08` (`/api/generate/images`), and `J11` (simulated 503 `/api/generate/story`).
- **Overall Result:** **12 / 12 PASS**, `0` uncaught `pageErrors`, `0` unexpected `consoleErrors`.

## Summary Matrix

| ID | Journey | Fixture | Viewport | Clicks | Duration | Mocked / Unmocked API | Screenshot(s) | Status | Key Friction Observed |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `J01` | First launch → seed idea → Analyze (mock) | `FX-EMPTY` | `1440×900` | 2 | 1,844 ms | 2 / 0 | `SC-01` | **PASS** | Blank graph lacks empty-state guidance; button says `"Reanalyze Idea"` before first analysis; textarea prefilled with `"Untitled creative project"` |
| `J02` | Review inferred item → Accept/Defer/Reject → Inspect | `FX-SIMPLE` | `1440×900` | 4 | 3,225 ms | 0 / 0 | `SC-02`, `SC-03` | **PASS** | Category filter row clips `"Setting"` on right edge in 3-column left panel |
| `J03` | Clarification → custom answer → defer → More Questions (mock) | `FX-SIMPLE` | `1440×900` | 5 | 3,295 ms | 1 / 0 | `SC-02` | **PASS** | Custom answer requires clicking `Accept` (not standalone submit); `Skip` is folded into `Defer`/`Reject` |
| `J04` | Story Bible edit → clear → Undo/Redo → reload | `FX-SIMPLE` | `1440×900` | 4 | 4,597 ms | 0 / 0 | `SC-05`, `SC-14` | **PASS** | Default 2-column Grid inside 3-col desktop Inspector truncates field titles (`"Point of Vi..."`) and text values |
| `J05` | Graph search, filter, zoom/fit, Table view & relation edit | `FX-BUSY` | `1440×900` | 7 | 3,702 ms | 0 / 0 | `SC-04` | **PASS** | **P1 FIXED in S0.7:** Table View originally had 0/28 keyboard-focusable rows (now 28/28). Busy SVG fit shrinks labels < 8px |
| `J06` | NL batch → Preview → deselect → stale guard → Review modal → Apply | `FX-BUSY` | `1440×900` | 7 | 3,627 ms | 0 / 0 | `SC-07` | **PASS** | Batch preview occupies top of left scroll column, pushing pending decisions below the fold |
| `J07` | Generate Story (mock) → read → copy/download → Outdated badge | `FX-SIMPLE` | `1440×900` | 2 | 4,233 ms | 1 / 0 | `SC-08`, `SC-12` | **PASS** | 3 simultaneous `Generate Story` buttons; output reading height ~130px (~5 lines) beneath Belief Graph |
| `J08` | Story ↔ Image switch → Generate Images (mock) → lightbox & Escape | `FX-OUT` | `1440×900` | 4 | 2,608 ms | 1 / 0 | `SC-09` | **PASS** | **P1 FIXED in S0.7:** Lightbox originally did not move focus inside dialog (`false` → now `true`, Escape returns focus to trigger) |
| `J09` | Create A/B projects → edit → switch → reload → Export/Import JSON | `FX-SIMPLE` | `1440×900` | 7 | 5,402 ms | 0 / 0 | `SC-10` | **PASS** | Project CRUD & Import/Export are nested inside right `History` tab; `.txt` button downloads `.md` |
| `J10` | Checks tab → `Inspect Fox` & `Edit Tone` (0 revision bump) | `FX-BUSY` | `1440×900` | 4 | 2,217 ms | 0 / 0 | `SC-06` | **PASS** | No `"Back to Checks"` breadcrumb after jumping to Inspector or Story Bible |
| `J11` | IndexedDB `read_error` → 0 unsolicited puts → Retry + 503 error banner | `FX-SIMPLE` | `1440×900` / `390×844` | 2 | 4,669 ms | 1 / 0 | `SC-15` | **PASS** | On `390px` mobile, recovery banner + PromptInput + 4-row bottom bar compress graph to ~90px |
| `J12` | Revision History → `Restore` → Undo/Redo → Export Markdown | `FX-BUSY` | `1440×900` | 3 | 2,353 ms | 0 / 0 | `SC-10` | **PASS** | Revision History sits at bottom of `History` tab below scroll fold; single-click Restore has no preview diff (safety checkpoint + Undo mitigates loss) |

## Detailed Journey Traces

### J01 — First launch, seed idea entry, and Analyze (mock)
- **Precondition:** Isolated context seeded with `FX-EMPTY` (`0` entities, `0` clarifications).
- **Path:** Fill seed `textarea` → click `Reanalyze Idea` → mocked `/api/analyze` + `/api/clarify` return `Clockmaker`, `Bell Tower`, and 1 clarification.
- **Postcondition & Evidence:** `[aria-label^="Entity Clockmaker."]` visible; clarification `"What storm threatens the harbor?"` rendered; `0` page errors; `0` unmocked API calls (`SC-01`).
- **Friction:** Initial empty textarea contains `"Untitled creative project"` rather than empty placeholder; empty canvas lacks a first-step callout.

### J02 — Decision Inbox Accept / Defer / Reject & Inspect Target
- **Precondition:** `FX-SIMPLE` (`13 pending · 0 confirmed`).
- **Path:** Click `Accept`, `Defer`, `Reject` on sequential items in `[aria-label="Creative Decisions and Batch Editor"]` → click `Inspect →`.
- **Postcondition & Evidence:** Header updates to `10 pending · 1 confirmed`; footer updates to `10 pending · 5 revs`; target opens in Inspector (`SC-02`, `SC-03`).

### J03 — Clarification Custom Answer, Defer & More Questions Refresh (mock)
- **Precondition:** `FX-SIMPLE` with pending host-personality clarification.
- **Path:** Click `Custom...` → fill `input[aria-label^="Custom value for"]` (`"Warm yet secretly cunning"`) → click `Accept` → click `Defer` on second item → click `More Questions`.
- **Postcondition & Evidence:** Custom answer committed; mocked `/api/clarify` appends `"What dessert is hidden under the silver cloche?"` cleanly.

### J04 — Story Bible Edit, Clear Authority, Undo/Redo & Reload Persistence
- **Precondition:** `FX-SIMPLE`.
- **Path:** Click `Story Bible` tab → fill `#bible-setting` (`"Rainy Harbor"`) → click `Clear Primary Setting` → click `Undo` → click `Redo` → wait 650ms → `page.reload()` → inspect `#bible-setting`.
- **Postcondition & Evidence:** Exact sequence verified: `"Rainy Harbor"` → `""` → `"Rainy Harbor"` → `""` → `""` after reload (`SC-05`, `SC-14`).

### J05 — Graph Search, Category Filter, Zoom/Fit, Table View & Relationship Edit
- **Precondition:** `FX-BUSY` (15 entities including excluded `Raven`, 13 directed relationships).
- **Path:** Search `"Badger"` (`filteredNodes: 1`) → clear → filter `location` (`locationNodes: 3`) → reset `all` → click `Zoom in`, `Fit` → toggle `Table` → inspect keyboard focusability of all 28 rows → select `guards` relationship → edit `#` relationship label (`"patrols"`).
- **Postcondition & Evidence:** Initial audit reproduced **0 / 28 keyboard-focusable rows** (P1). After S0.7-FIX-1, re-test verified **28 / 28 keyboard-focusable rows** (`tabIndex=0`, `Enter`/`Space` activation) and `relEditable: true` (`SC-04`).

### J06 — NL Batch Preview, Partial Selection, Stale Guard, Review Modal & Apply
- **Precondition:** `FX-BUSY`.
- **Path:** Fill `#nl-batch-input` (`"Make Rabbit elderly. Make Fox elderly. The party should be mysterious."`) → `Preview` (`3/3`) → uncheck `Fox` → click `Review Plan & Prompt` → verify modal focus (`"Close"`) → `Escape` (focus returns to `"Review Plan & Prompt"`) → mutate `#bible-setting` → verify stale banner & disabled `Apply` button → click `Re-preview for Current Project` → `Apply Approved Batch`.
- **Postcondition & Evidence:** `staleVisible: true`, `applyDisabledWhileStale: true`, `appliedTone: "mysterious"` (`SC-07`).

### J07 — Generate Story (mock), Read Artifact, Copy/Download & Outdated Badge
- **Precondition:** `FX-SIMPLE`.
- **Path:** Click footer `Generate Story` (mocked `/api/generate/story`) → verify `Copy Story` & `Download .txt` visible → edit `#bible-tone` (`"Noir suspense"`) → verify `Outdated` badge renders.
- **Postcondition & Evidence:** `copyVisible: true`, `dlVisible: true`, `outdatedVisible: true` (`SC-08`, `SC-12`).

### J08 — Story ↔ Image Switch, Image Gallery & Fullscreen Lightbox Focus
- **Precondition:** `FX-OUT`.
- **Path:** Click `Image` mode in `Generation mode` group → click `Generate Images` (mock 4 deterministic SVGs) → focus & click `Preview generated image 1` → verify focus moves inside `[aria-label="Image full preview"]` → press `Escape` → verify focus returns to `Preview generated image 1` → switch back to `Story`.
- **Postcondition & Evidence:** Initial audit reproduced `focusInsideLightbox: false` (P1). After S0.7-FIX-2a, re-test verified `focusInsideLightbox: true` and `focusAfterEscape: "Preview generated image 1"` (`SC-09`).

### J09 — Multi-Project A/B Switch, Reload & JSON Export/Import Roundtrip
- **Precondition:** `FX-SIMPLE`.
- **Path:** Open `History` tab → create `Project Alpha J09` → edit `#bible-genre` (`"Maritime Noir"`) → switch to `Woodland Lantern Mystery` → switch back to `Project Alpha J09` → wait 650ms → `reload()` → verify `"Maritime Noir"` persisted → paste Schema v3 JSON into import input → click `Import JSON` → verify `"Imported J09 World"` activates.
- **Postcondition & Evidence:** `survivedGenre: "Maritime Noir"`, `importedVisible: true`, `exportPromptBtnText: "Export Refined Prompt (.txt)"` (`SC-10`).

### J10 — Consistency Checks Target Navigation (Zero Revision Bump)
- **Precondition:** `FX-BUSY` (`3 revs`, `Fox` in Explicit Exclusions while present in graph).
- **Path:** Open `Checks` tab → click `Inspect Fox` (Inspector activates) → re-open `Checks` → click `Edit Tone` (`#bible-tone` focused).
- **Postcondition & Evidence:** `revBefore: "3"`, `revAfter: "3"` (0 revision bump), `focusedId: "bible-tone"` (`SC-06`).

### J11 — IndexedDB Read Error Write Gate, Recovery & Failed API Error Banner
- **Precondition:** `FX-SIMPLE` with fault-injected `IDBObjectStore.prototype.getAll` throwing `UnknownError`.
- **Path:** Reload → verify `Retry Storage Read` banner visible & `window.__idbPuts === 0` after 550ms → clear fault & click `Retry Storage Read` → click `Generate Story` against mocked `503 MISSING_API_KEY` → verify readable error banner.
- **Postcondition & Evidence:** `bannerVisible: true`, `idbPutsWhileBlocked: 0`, `apiErrVisible: true` (`SC-15`).

### J12 — Revision History Restore, Safety Checkpoint Undo/Redo & Export
- **Precondition:** `FX-BUSY` (`3` revisions).
- **Path:** Open `History` tab → scroll to `Revision History` → click `Restore` → verify `"Restored project revision safely"` toast + `Undo` enabled → click `Undo` → verify `Redo` enabled → confirm `Export Story Bible as Markdown (.md)` visible.
- **Postcondition & Evidence:** `statusVisible: true`, `undoEnabled: true`, `redoEnabled: true`, `mdBtnVisible: true` (`SC-10`).
