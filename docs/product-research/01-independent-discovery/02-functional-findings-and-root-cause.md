# 02 — Functional Findings and Root-Cause Investigation

**Assignment:** `PCC-RESEARCH-01`  
**Parent Index:** [`README.md`](./README.md)  
**Cross-References:** [`01-product-purpose-and-current-state.md`](./01-product-purpose-and-current-state.md) · [`03-ux-ia-and-user-journeys.md`](./03-ux-ia-and-user-journeys.md) · [`04-ai-quality-narrative-intelligence-and-architecture.md`](./04-ai-quality-narrative-intelligence-and-architecture.md) · [`06-recommendations-strategy-and-roadmap.md`](./06-recommendations-strategy-and-roadmap.md)

---

## 1. Synthetic Narrative Test Corpus & Live Probe Summary

To investigate realistic writer workflows without touching personal data (Assignment §4, §6), three isolated synthetic narratives were executed against the running preview (`http://localhost:3000`, `2026-11-28`, managed Gemini connection `gemini-4-hydrogen`, server policy `2026-11-27.1`):

1. **Synthetic Narrative 1 — Minimal Seed:**  
   *"A retired watchmaker discovers a brass pocket watch that ticks backward whenever someone lies nearby."*
2. **Synthetic Narrative 2 — Developed Multi-Character Story Brief:**  
   Retired horologist **Alden Voss** (68, pale gray eyes), estranged niece & harbor inspector **Nadia Kestrel** (methodical, guarded), auctioneer **Tomas Reed** (secretly seeking the watch), the **Brass Pocket Watch**, and explicitly excluded **Steam Automaton**.
3. **Synthetic Narrative 3 — Multi-Chapter Ambiguous & Contradictory Narrative (~270 words across 2 chapters):**  
   - **Intentional ambiguities / character beliefs (must NOT be flagged as canon errors):** Dockworkers' unverified rumor that Tomas bribed the harbor master; Port Marrow folklore that fog steals memories; Alden's unconfirmed suspicion about Nadia's motive.
   - **Real seeded contradictions (MUST be caught):**
     1. Alden's eyes change from **pale gray** (Model & Ch. 1) to **dark brown** (Ch. 2).
     2. Explicitly excluded **Steam Automaton** appears humming in the workshop in Ch. 2.
     3. Timeline contradiction: Ch. 2 takes place on **Tuesday evening**, yet Nadia says they argued on **Wednesday morning, three days before** Tomas arrived.

### Live Bounded Probe Results (`2026-11-28`) **[Observed in actual preview]**

| # | Endpoint | Input Corpus | HTTP | Latency | Observed Outcome |
|---|---|---|---|---|---|
| 1 | `GET /api/health` & `/api/ai/provider-hub/status` | — | `200` | 137 ms | `configured: true`, `models.text: "gemini-4-hydrogen"`, `localPersonalConnectionsAvailable: true`, 28 managed models listed via `/models`. |
| 2 | `POST /api/analyze` | Narrative 1 | `200` | 23,910 ms | Extracted 5 entities (`The Story`, `Retired Watchmaker`, `Brass Pocket Watch`, `Workshop`, `Deceptive Acquaintance`) and 4 directed relationships with explicit/implicit flags. |
| 3 | `POST /api/clarify` | Narrative 1 | `200` | 15,079 ms | Returned structured clarifying questions with `target` links (`setting`, `Retired Watchmaker.motivation`, `centralConflict`) and 4 distinct options each. |
| 4 | `POST /api/batch-edit` | Narrative 2 (`"Make him older, set the tone to quietly suspenseful noir, and export the chapter as EPUB."`) | `200` | 3,884 ms | Correctly flagged pronoun ambiguity (`him` → Alden/Tomas) and unhandled clause (`export as EPUB`), **BUT omitted `nextValue` on the `update_story_bible` operation** (`F-03`). |
| 5 | `POST /api/generate/story` | Narrative 2 brief | **`499`** | **60,017 ms** | **Timed out at 60s and misclassified as non-retryable `CANCELLED`** (`F-02`). |
| 6 | `POST /api/narrative/import/extract` | Narrative 3 (with valid `providerPlanBinding`) | **`502`** | 1,952 ms | **Failed with `MODEL_UNSUPPORTED: "The selected Gemini model is unavailable for this request."`** despite `gemini-4-hydrogen` being active and listed (`F-04`). |
| 7 | `POST /api/narrative/diagnostics/analyze` | Narrative 3 | `503` then `200` | 38.8s / 8,339 ms | First run hit transient upstream `503`; second run succeeded and **caught all 3 seeded contradictions** (`trait_conflict`, `violated_exclusion`, `timeline`) with `certainty: confirmed` while respecting intentional rumors/suspicions. |
| 8 | `POST /api/narrative/sync/analyze` | Narrative 3 (`manuscript-to-model`) | `200` | 8,372 ms | Caught all 3 contradictions as `ambiguity` proposals with exact quotes AND proposed adding missing location `Port Marrow`. |
| 9 | `POST /api/narrative/writing/assist` | Narrative 3 (`alternatives`) | `200` | 6,899 ms | Returned 3 atmospheric, noir-faithful continuations with explicit `assumptions`. |
| 10 | `POST /api/narrative/opportunities/explore` | Narrative 3 | `503` | 17,257 ms | Hit transient upstream `503 UPSTREAM_ERROR`; not retried to preserve bounded test budget. |

---

## 2. Material Findings & Root-Cause Catalogue

### `F-01` — First-Visit Landing Opens an Empty `Write` Screen & Initial IndexedDB Lockout
- **Severity / Impact:** **Critical (UX & Activation)** — First-time visitors do not see PCC's core visual differentiator (Belief Graph & Proactive Decisions) and briefly see a disabled editor with a technical IndexedDB warning.
- **Evidence:** **[Observed in actual preview]** + **[Confirmed by current source inspection]** (`App.tsx`, `components/manuscript/ManuscriptEditor.tsx`, `lib/sampleProject.ts`).
- **Expected vs. Observed:**
  - *Expected:* Opening the built-in sample project (*Cat’s Woodland Dinner Party*) welcomes the writer into its populated creative space or provides a clear starting path with an active editor.
  - *Observed:* Default `workspaceMode` resolves to `'write'`, while the sample project has **0 manuscript sections**. The viewport shows an empty `Working Manuscript` (`0 words`), an outline saying `"No sections match these filters."`, and on initial paint before IndexedDB settles, `Import`, `Add chapter`, `Add scene`, and the textarea are disabled with `"Writing requires available IndexedDB and a verified workspace load."`
- **Confirmed Root Cause:** `readBrowserWorkspacePreference()` falls back to `'write'` regardless of whether the active project has manuscript sections, and `ManuscriptEditor` exposes raw storage-readiness plumbing during initial hydration.
- **Proposed Alternatives:**
  1. Adaptive default landing: open `Plan` (or a welcoming Start view) when a project has 0 manuscript sections and populated graph/seed state; open `Write` when manuscript sections exist.
  2. Populate the sample project with a short 1–2 scene excerpt linked to its Belief Graph so *both* `Write` and `Plan` feel alive immediately.
  3. Replace the raw IndexedDB technical message during initial hydration with a non-alarming loading state; show storage-error guidance only if IndexedDB actually fails.
- **Future Verification Criteria:** Fresh browser profile loads `http://localhost:3000` with zero technical IndexedDB warning on healthy storage and immediately displays meaningful narrative content and clear primary actions.

---

### `F-02` — `POST /api/generate/story` Times Out at 60s and Misclassifies Timeout as `499 CANCELLED`
- **Severity / Impact:** **Critical (Core Functional Failure)** — One of the two primary purple CTAs in `Plan` (`Generate Story`) fails completely under the default managed Gemini model and tells the writer *"The request was cancelled"* with `retryable: false`.
- **Evidence:** **[Observed in actual preview]** (`499` at `60,017 ms`) + **[Confirmed by current source inspection]** (`server/aiService.ts:29, 38-52, 534-575`).
- **Expected vs. Observed:**
  - *Expected:* A 350-word opening scene brief returns a generated story within ~10–25s, or if it times out, returns `504 TIMEOUT` (`retryable: true`).
  - *Observed:* Request ran for `60,017 ms` and returned HTTP `499`, `code: "CANCELLED"`, `message: "The request was cancelled."`, `retryable: false`.
- **Confirmed Root Cause (Two Compounding Defects):**
  1. **Unconstrained Thinking Latency:** Unlike `analyzeBeliefGraph`, `generateClarificationsList`, `interpretBatchEditInstruction`, `refinePromptText`, and all `narrativeAiService` operations — every one of which explicitly sets `thinkingConfig: { thinkingLevel: ThinkingLevel.LOW }` — `generateStoryText` (`server/aiService.ts:550-556`) omits `thinkingConfig` entirely (and also omits `maxOutputTokens`). On `gemini-4-hydrogen`, unconstrained default thinking consumes >60s before yielding output.
  2. **Abort Classification Bug:** `combineSignals` aborts with `new AppApiError('TIMEOUT', ..., 504, true)`, yet when the SDK throws a generic `AbortError`, `classifyGeminiError(err)` or signal-reason handling misclassifies the timeout as `499 CANCELLED` (`retryable: false`) before preserving the `TIMEOUT` reason.
- **Proposed Alternatives:**
  1. Explicitly pass bounded `thinkingConfig` (e.g., `ThinkingLevel.LOW` or user-selected reasoning level) and `maxOutputTokens` (`AI_OPERATION_POLICIES.story.maxOutputTokens`) in `generateStoryText`, and support SSE/streaming progressive prose rendering so writers see words within 2–3 seconds instead of waiting in silence.
  2. Fix `classifyWithSignal` to inspect `signal.reason instanceof AppApiError` *before* calling `classifyGeminiError` (currently `if (err instanceof AppApiError)` runs first, and if the SDK wraps `AbortError` into another `Error`, `classifyGeminiError` matches `/abort/` → `CANCELLED`!).
- **Future Verification Criteria:** Live `POST /api/generate/story` on Narrative 2 completes in <20s with HTTP `200`; simulated timeout returns HTTP `504` with `code: "TIMEOUT"` and `retryable: true`.

---

### `F-03` — `POST /api/batch-edit` Drops `nextValue` on `update_story_bible` Operations
- **Severity / Impact:** **High (Broken Feature)** — Natural-language batch edits targeting Story Bible fields (tone, setting, genre, conflict, exclusions) produce incomplete operations that cannot apply the user's requested value.
- **Evidence:** **[Observed in actual preview]** + **[Confirmed by current source inspection]** (`server/aiService.ts:346, 373-393`).
- **Expected vs. Observed:**
  - *Expected:* `"set the tone to quietly suspenseful noir"` produces `{ type: "update_story_bible", storyField: "tone", nextValue: "quietly suspenseful noir" }`.
  - *Observed:* Server returned `{ id: "op_...", type: "update_story_bible", summary: "Set story bible tone to quietly suspenseful noir", storyField: "tone", destructive: false, selected: true }` with **`nextValue` completely absent**.
- **Confirmed Root Cause:** In `server/aiService.ts:392`, the JSON response schema marks only `required: ['type', 'summary']` while `nextValue` is `nullable: true` and optional. Models frequently place the value into `summary` and omit `nextValue`. Furthermore, `parseAndValidateBatchEditResponse` accepts `update_story_bible` operations with missing `nextValue` instead of rejecting or repairing/validating per-operation-type required fields.
- **Proposed Alternatives:**
  1. Tighten schema/prompt with explicit per-operation examples and validate required fields per `type` in `parseAndValidateBatchEditResponse` (moving incomplete operations to `warnings`/`unhandledClauses` or triggering a single schema-guided retry).
  2. Consider replacing brittle 9-type freeform compiler schemas with dedicated structured tool/union schemas where `update_story_bible` strictly requires `{ storyField, nextValue }`.
- **Future Verification Criteria:** Regression test + live check verifying `set tone`, `rename entity`, `set attribute`, and `add relationship` always populate `nextValue`/`newEntityName` or surface an explicit validation warning rather than silently emitting empty operations.

---

### `F-04` — Narrative Import Extraction: Brittle Exact UTF-16 Offset Rejection, Output Clamping, Missing Fence-Strip, and Live `502 MODEL_UNSUPPORTED`
- **Severity / Impact:** **Critical (Core Workflow Failure — "Understand an Existing Narrative")** — Importing an existing manuscript with AI analysis is both failing live and structurally prone to discarding most extracted entities/facts even when the AI responds successfully.
- **Evidence:** **[Observed in actual preview]** (`502 MODEL_UNSUPPORTED` in `1,952 ms`) + **[Confirmed by current source inspection]** (`lib/narrative/import/proposalValidator.ts:83-87`, `server/narrative/extractionService.ts:92, 168, 180`).
- **Expected vs. Observed:**
  - *Expected:* Importing Narrative 3 extracts Alden, Nadia, Tomas, Port Marrow, the watch, relationships, and ambiguities with verified source anchors.
  - *Observed (Live):* `POST /api/narrative/import/extract` with valid `providerPlanBinding` (`gemini-managed`, `gemini-4-hydrogen`, `default`) returned `502 MODEL_UNSUPPORTED: "The selected Gemini model is unavailable for this request."` — even though `GET /api/ai/provider-hub/models?connectionId=gemini-managed` lists `gemini-4-hydrogen` as supported and `diagnostics`/`sync`/`writing` succeeded on the exact same model.
  - *Confirmed in Source (Three Structural Defects):*
    1. **LLM Offset Fallacy (`proposalValidator.ts:83-87`):** `verifyExtractionEvidence` rejects **any** entity, attribute, relationship, finding, or ambiguity unless `chunk.text.slice(start, end) === quote` using the **LLM-generated integer UTF-16 character offsets**. BPE-tokenized LLMs cannot reliably count exact UTF-16 code units across multi-paragraph chunks; even a 1-character off-by-one error silently discards a completely accurate, verbatim quote (`rejectedEvidenceCount += 1`), with **zero substring/nearest-match anchor recovery**.
    2. **Severe Output Token Clamping (`extractionService.ts:168`):** Hard-clamps `maxOutputTokens` to `Math.min(2048, AI_OPERATION_POLICIES['narrative-import'].maxOutputTokens)` (ignoring the policy's `4096`), while line 94 invites up to 150 entities + 250 relations + 300 findings + 100 ambiguities, each carrying verbatim quotes and rationales. Dense chunks easily truncate mid-JSON → `502 INVALID_RESPONSE`.
    3. **No Markdown Fence Stripping (`extractionService.ts:180`):** Calls `JSON.parse(response.text)` directly (unlike `narrativeAiService.ts:546` which calls `stripJsonFences`), breaking providers that wrap JSON in ```` ```json ```` fences (especially `chatgpt-plan`/`openai-api`).
- **Hypotheses for Live `502 MODEL_UNSUPPORTED`:** **[Inferred / hypothesized]** — `extractionService` enters `createGeminiAdapter` because `ImportWorkflow` sends explicit `x-pcc-ai-model: gemini-4-hydrogen` (bypassing the `runtime.ts:221` managed shortcut), where `normalizeGeminiError` (`geminiAdapter.ts:193`) maps any upstream `404` or `model.*unavailable` / schema rejection message on `extractionResponseSchema` into `502 MODEL_UNSUPPORTED`. Server-side error logging (currently redacted by `normalizeGeminiError`) is needed to confirm the exact upstream response.
- **Proposed Alternatives:**
  1. **Deterministic Quote-to-Offset Anchor Resolution:** Ask the LLM for verbatim `quote` + optional approximate paragraph/line index (not raw UTF-16 character math); resolve exact UTF-16 `start`/`end` deterministically on the server/client via exact substring search (disambiguating repeated quotes by nearest approximate hint or paragraph index). Preserve strict zero-hallucination guarantees: if the quote does not appear verbatim in the chunk, reject it.
  2. Raise `maxOutputTokens` to policy limit (`4096`–`8192`) or split extraction into focused passes (entities+relations vs. findings+ambiguities).
  3. Apply `stripJsonFences` + schema normalization uniformly across `extractionService.ts` and diagnose why `createGeminiAdapter` returned `502 MODEL_UNSUPPORTED` for `gemini-4-hydrogen` on `import/extract`.
- **Future Verification Criteria:** Importing Narrative 3 via UI and API succeeds with HTTP `200`, extracts ≥90% of explicit characters/locations/objects/rumors with verified verbatim anchors (`rejectedEvidenceCount` near 0), and accurately tags dockworker rumor as `reported` / Alden's suspicion as `belief`.

---

### `F-05` — Silent Long-Form Truncation & Broken Scope Filtering in Diagnostics and Sync
- **Severity / Impact:** **High (Silent Reliability & Trust Defect for Long-Form Writers)** — Writers working on stories longer than 8 sections or >5,000 characters per chapter silently receive partial analysis labeled as if it covered their project, and selecting `"Changed"` scope does not filter to changed sections.
- **Evidence:** **[Confirmed by current source inspection]** (`components/workspace/review/asyncReviewActions.ts:82-164`).
- **Expected vs. Observed:**
  - *Expected:* `"Full Project"` analyzes the entire manuscript (via chunked/hierarchical passes or clear coverage disclosure); `"Changed"` analyzes only sections modified since last review; character beliefs remain visible to diagnostics so they aren't misread.
  - *Observed in Source:*
    - `buildScopedDiagnosticPayload` (line 127–140): `diagScope === 'scene' && diagTargetId ? sections.filter(...) : sections.slice(0, 8)` — **`full`, `entity`, AND `changed` scopes all blindly slice to the first 8 sections**, and every section is hard-truncated with `s.text.slice(0, 5_000)` (~800 words)! Chapters 9+ and the second half of every 2,000-word chapter are **completely invisible** to Diagnostics.
    - `buildScopedSyncPayload` (line 156–161): Identical `sections.slice(0, 8)` and `s.text.slice(0, 5_000)` silent truncation.
    - `buildCompactReviewModelPayload` (line 83–115): Silently slices `entities.slice(0, 60)`, `relationships.slice(0, 80)`, `attributes.slice(0, 20)`, descriptions at 400 chars, and **strips out `epistemicKind === 'belief' || e.epistemicKind === 'reported'`** so Diagnostics/Sync cannot distinguish recorded character beliefs from unrecorded facts!
- **Confirmed Root Cause:** Client-side payload builders enforce hard slice limits to fit `AI_OPERATION_POLICIES` (`40,000` chars / `14,000` tokens) without implementing multi-pass coverage, changed-section tracking, or an explicit truncation banner.
- **Proposed Alternatives:**
  1. Implement honest coverage accounting immediately (explicitly report *"Analyzed 8 of 24 sections; 3 sections truncated"* whenever slicing occurs).
  2. Implement true `changed`-scope filtering using `syncState.pendingSectionIds` / section version diffs.
  3. Build hierarchical long-form indexing (per-chapter fact sheets + targeted cross-chapter consistency passes) rather than naive prefix slicing (detailed in [`04`](./04-ai-quality-narrative-intelligence-and-architecture.md)).
  4. Pass `epistemicKind` explicitly on entities/attributes instead of dropping `belief`/`reported` records.
- **Future Verification Criteria:** A 15-chapter synthetic novel with a contradiction planted in Chapter 12 (word 1,800) either surfaces the Chapter 12 contradiction or explicitly warns the writer that Chapters 9–15 were not covered.

---

### `F-06` — AI Writing Assistant Context Blindness (No Relationships, No Multi-Scene Continuity, No Exclusions)
- **Severity / Impact:** **High (Creative Quality Ceiling)** — Although the Writing Assistant generates good prose locally, it is structurally blind to character relationships, previous chapters, section metadata, and excluded entities.
- **Evidence:** **[Confirmed by current source inspection]** (`lib/narrative/writing/selectionHelpers.ts:107-158`, `shared/narrativeAiSchemas.ts:207-224`).
- **Expected vs. Observed:**
  - *Expected:* Asking the Writing Assistant to continue Chapter 2 knows how Alden and Nadia relate (`estranged uncle of`), what happened in Chapter 1, the scene's POV/location/purpose metadata, and which entities are explicitly excluded (`Steam Automaton`).
  - *Observed in Source:* `extractConfirmedWritingContext` sends **only** up to 25 confirmed non-excluded entities (140-char description + 6 attrs), confirmed Story Bible fields, up to 8 confirmed style observations, and ±1,500 chars around the cursor in the *current section only*. **`snapshot.relationships` is never sent**, prior chapter synopses/tail text are never sent, `section.pov`/`location`/`purpose`/`chronology` are never sent, and `entity.excluded` names are filtered out rather than passed as negative constraints!
- **Confirmed Root Cause:** Minimal initial schema (`WritingAssistRequestSchema`) omitted `relationships`, `excludedEntities`, `sectionMetadata`, and `precedingSummary`.
- **Proposed Alternatives:** Enrich `WritingAssistRequestSchema` with: (a) relationships touching characters in the active scene, (b) active scene metadata (`pov`, `location`, `chronology`, `purpose`, `synopsis`), (c) compact rolling summary of the preceding 1–2 sections, and (d) explicit list of excluded entity names.
- **Future Verification Criteria:** Writing Assistant invoked at the start of Scene 2 accurately preserves Scene 1 events, character relationships, POV constraint, and excluded entities without the writer restating them in the custom instruction box.

---

### `F-07` — Disconnection Between Working Manuscript (`Write`) and `refinedPrompt` / `Generate Story` (`Plan`)
- **Severity / Impact:** **High (Product Coherence Defect)** — Edits made in `Write` have zero effect on `Plan`'s compiled prompt (`refinedPrompt`) or `Generate Story`, confusing writers who expect one unified story.
- **Evidence:** **[Confirmed by current source inspection]** (`lib/promptBuilder.ts`, `components/workspace/AdaptivePlanWorkspace.tsx`).
- **Confirmed Root Cause:** `lib/promptBuilder.ts` compiles purely from Era 2 snapshot fields (`originalIdea`, `storyBible`, `entities`, `relationships`, `freeformNotes`) and has no reference to `project.narrative` or `manuscriptSections(project)`.
- **Proposed Alternatives:** Clearly reframe `Generate Story` as *"Draft Opening Scene into Manuscript"* (or *"Generate Draft from Plan"*) that creates/appends a real manuscript section rather than an orphaned output card, and let `Plan` visibly reflect whether manuscript scenes exist and link directly to them (see [`03`](./03-ux-ia-and-user-journeys.md)).
- **Future Verification Criteria:** A writer who starts from a seed in `Plan` can generate or seed Chapter 1 directly into `Write` with one click, and edits in `Write` clearly indicate sync status with `Plan`.

---

### `F-08` — Four "Visual Views" (`Timeline`, `Mind Map`, `Ego Map`, `Family`) Are Text Lists/Tables, Plus Broken Chronology Sorting
- **Severity / Impact:** **High (Unmet Core Need #4: "See and Manage the Narrative")** — Writers clicking `Timeline`, `Mind Map`, `Ego Map`, or `Family` expect visual narrative maps and instead get plain HTML lists/tables, with broken alphabetical sorting in `Timeline`.
- **Evidence:** **[Confirmed by current source inspection]** (`components/inspector/TimelinePanel.tsx:25-36`, `components/inspector/MindMapPanel.tsx:27-112`, `components/graph/EgoMapView.tsx`, `components/graph/FamilyKinshipView.tsx`).
- **Specific Confirmed Defects:**
  1. **`TimelinePanel.tsx:33`:** `Story Chronology` mode sorts strictly via `a.note.localeCompare(b.note)`! Thus `"Day 10"` sorts before `"Day 2"`, `"April 1894"` before `"March 1894"`, and `"Five years earlier"` after `"Day 1"`. Moreover, `entity.category === 'event'` nodes from the Belief Graph are completely absent from Timeline.
  2. **`MindMapPanel.tsx:27-37`:** Static 2-column grid of 5 card lists (`Topics & themes`, `Plot`, `World`, `Visual style`, `Characters`) — **omits all `location`, `object`, `event`, `group` entities and all relationships**, with no visual branches, links, or interactive editing.
  3. **`EgoMapView.tsx` & `FamilyKinshipView.tsx`:** Flat button clusters and `<ul>` edge lists (`Source → label → Target`) rather than radial ego networks or directed kinship diagrams.
- **Proposed Alternatives:** Replace these four text projections with genuine interactive visual views (starting with a true **Dual-Track Visual Timeline** and **Interactive Radial Ego/Kinship Focus** directly on the main Graph Canvas — detailed in [`05`](./05-creative-product-discovery-and-concepts.md#concept-3)).
- **Future Verification Criteria:** Chronology mode supports explicit author-ordered sequence positions (not ASCII string sorting), and clicking Ego/Family focus renders an actual visual subgraph rather than a bulleted list.

---

### `F-09` — Unenforced Server-Side AI Budgets & Missing Usage Counters on Core Creative Routes
- **Severity / Impact:** **Medium-High (Governance & Cost Transparency)** — Core creative endpoints (`analyze`, `clarify`, `refine`, `batch-edit`, `story`) define budgets in `server/aiBudget.ts` that are never enforced, and default `gemini-managed` usage is never counted in `observedByConnection`.
- **Evidence:** **[Confirmed by current source inspection]** (`server/aiService.ts:107-575`, `server/aiBudget.ts:451-535`, `server/providers/runtime.ts:221, 282`).
- **Confirmed Root Cause:**
  1. `analyzeBeliefGraph`, `generateClarificationsList`, `interpretBatchEditInstruction`, `refinePromptText`, and `generateStoryText` never call `acquireAiSlot()`, `countTokens()`, `evaluateOperationBudget()`, or `reserveAggregateOperationUsage()`.
  2. `runtime.ts:221` short-circuits `gemini-managed` (when no explicit `modelId`/`reasoningLevel` override is sent) straight to `getManagedClient()`, skipping line 282 (`observed.set(selection.connectionId, ...)`), so Provider Hub reports zero observed calls even after heavy usage.
- **Proposed Alternatives:** Route all operations through a unified server-side execution pipeline that enforces `aiBudget` slots, token caps, and `observed` telemetry consistently regardless of whether default or overridden models are selected.
- **Future Verification Criteria:** Provider Hub `observedByConnection['gemini-managed']` increments on every AI call, and concurrency/token limits apply uniformly across all 12 `AiOperation` types.

---

### `F-10` — Semantic Diagnostics Lose Passage Anchors (`anchors: []`) & Local Checker Has Shallow / Noisy Heuristics
- **Severity / Impact:** **Medium-High (Trust & Actionability in Review)** — Semantic AI findings cannot highlight or jump to the exact offending sentence in the manuscript, while local checks produce false setting warnings and miss basic trait contradictions.
- **Evidence:** **[Confirmed by current source inspection]** (`lib/narrative/diagnostics/engine.ts:168`, `lib/consistencyChecker.ts:22-26, 267-300`).
- **Confirmed Root Cause:**
  1. `convertSemanticFindingsToDiagnosticFindings` hardcodes `anchors: []`, discarding `f.evidenceQuote` instead of resolving it against the target section text into a verified `ArtifactAnchor`/evidence offset.
  2. `consistencyChecker.ts` only checks **3 English antonym regex pairs** (`young/old`, `friendly/hostile`, `cheerful/grim`) and emits a false `issue_setting_mismatch` whenever `storyBible.setting` is not a literal substring of a Location node's `name` (e.g., `"Victorian harbor town"` vs. `"Alden's Workshop"`).
- **Proposed Alternatives:** Resolve `evidenceQuote` into section offsets on diagnostic ingest so clicking an issue jumps directly to and highlights the exact manuscript sentence; remove or refine the brittle substring setting check; clearly label local checks as *Structural Checks* rather than *Consistency Checks*.
- **Future Verification Criteria:** Clicking a semantic diagnostic finding for Ch. 2's eye-color contradiction opens Ch. 2 and highlights `"his dark brown eyes narrowing"`.

---

### `F-11` — Dirty-Draft Hard Navigation Lockout Interrupts Creative Flow
- **Severity / Impact:** **Medium-High (Daily Writer Friction)** — Typing even one word in `Write` blocks clicking `Plan`, `Review`, `Projects`, or `Import` until the writer manually clicks `Save manuscript`.
- **Evidence:** **[Confirmed by current source inspection]** (`App.tsx:175`, `allowNavigation`).
- **Confirmed Root Cause:** `allowNavigation` checks `draftDirtyRef.current` and hard-aborts navigation with a banner (`"Save the open manuscript draft or wait for the restore before leaving this workspace."`), without debounced autosave or a *"Save & Switch"* action.
- **Proposed Alternatives:** Implement debounced background autosave (e.g., 1.5s idle + flush-on-tab-switch) backed by IndexedDB, reserving the hard lock strictly for active storage failure or in-progress restore.
- **Future Verification Criteria:** Typing in `Write` and immediately clicking `Plan` transparently flushes the draft and transitions cleanly with zero lost characters and zero error banner.

---

### `F-12` — Severe Chrome Overload, Duplicated Controls, Clipped Inbox Filters, and Hidden Decision Inbox in `Plan`
- **Severity / Impact:** **High (Usability & Discoverability)** — On a `1440×900` desktop screen, `Plan` stacks **7 horizontal chrome strips**, duplicates primary actions (`Generate Story`, `Story/Image`, `Story Bible`, `Opportunities`, `Output`), hides the signature `Decision Inbox` by default (`showInbox = false`), and clips Inbox filter labels (`Relatio`) when opened.
- **Evidence:** **[Observed in actual preview]** (screenshots `02-plan-default.png`, `03-plan-with-inbox.png`) + **[Confirmed by current source inspection]** (`components/workspace/AdaptivePlanWorkspace.tsx:78`).
- **Confirmed Root Cause:** Incremental addition of Era 3 controls (top Plan bar, narrative evidence key, mode toggles, right-inspector tabs) on top of Era 2 controls (seed card buttons + persistent bottom status bar) without removing redundant controls.
- **Proposed Alternatives:** Full IA & chrome consolidation detailed in [`03-ux-ia-and-user-journeys.md`](./03-ux-ia-and-user-journeys.md) — reclaim ≥60% of viewport height for the canvas/manuscript, keep exactly ONE `Generate`/draft CTA, and surface proactive questions contextually instead of burying them behind an `Inbox 14` button.
- **Future Verification Criteria:** `Plan` viewport dedicates ≥60% vertical height to the interactive narrative map at `1440×900`, zero duplicated action buttons appear simultaneously on screen, and zero text clips horizontally at `1280px`–`1440px`.

---

### `F-13` — 5-Step Import Ceremony & Fragile Reset-on-Edit Behavior
- **Severity / Impact:** **Medium-High (Adoption Barrier for Existing Manuscripts)** — Bringing a short story into PCC requires 5 mandatory sequential steps, retention checkboxes, segmentation plans, and explicit per-item review before the writer can even read or edit their story in the workspace; editing a single character in pasted text wipes parsed state and resets analysis.
- **Evidence:** **[Observed in actual preview]** + **[Confirmed by current source inspection]** (`components/narrativeImport/ImportWorkflow.tsx:204-219, 499-515, 811-830`).
- **Proposed Alternatives:** "Import Text Instantly, Analyze Progressively" — let a writer drop/paste a manuscript directly into `Write` in 1 click, then trigger non-blocking chapter-by-chapter extraction as a background/side-drawer review (see [`05`](./05-creative-product-discovery-and-concepts.md#concept-8)).

---

### `F-14` — Multi-Provider Architectural Asymmetries & Prompt-Only OpenAI JSON Enforcement
- **Severity / Impact:** **Medium-High (Cross-Provider Reliability)** — Different providers follow different governance, schema-enforcement, and image-routing paths.
- **Evidence:** **[Confirmed by current source inspection]** (`server/routes.ts:425-435`, `server/providers/chatgptResponses.ts:63-65, 373-381`, `server/providers/geminiAdapter.ts:347-367`, `server/aiService.ts:607`).
- **Specific Confirmed Asymmetries:**
  1. `chatgpt-plan` applies its SRB local-activation gate ONLY to `/generate/story` (`routes.ts:425`), while all other 10 text operations go through `createLegacyAiClient` without SRB gating.
  2. `chatgptResponses.ts:63-65` enforces JSON schemas solely via a prose instruction (`constrainedJsonInstruction`) instead of OpenAI's native `text: { format: { type: "json_schema", ... } }` Structured Outputs, increasing JSON parse failure risk on complex schemas like `import/extract` and `diagnostics`.
  3. `generateImagesBatch` (`aiService.ts:607`) calls `generateContent` with `imageConfig`, whereas `geminiAdapter.ts` implements `generateImage` via `generateImages` and strips `imageConfig` in `generateText`.
- **Proposed Alternatives:** Unify provider capability/governance routing, adopt native Responses API Structured Outputs for OpenAI models where supported, and align image-generation transport across `gemini-managed` and `gemini-personal` (detailed in [`04`](./04-ai-quality-narrative-intelligence-and-architecture.md)).

---

### `F-15` — Micro-Defects, Misleading Empty States, and Transient `503` Resilience
- **Severity / Impact:** **Medium (Polish & Perceived Reliability)**
- **Evidence:** **[Observed in actual preview]** + **[Confirmed by current source inspection]**.
- **Catalogued Items:**
  1. **Pluralization/Spacing Bug (`lib/consistencyChecker.ts:316`, observed in `04-review-default.png`):** `"2 core Story Bible property(Tone, Setting) awaiting confirmation"` (singular `"property"` + missing space before `(`).
  2. **Misleading Empty State (`ManuscriptEditor.tsx`, observed in `01-initial-landing.png`):** Shows `"No sections match these filters."` when the manuscript has 0 sections and no filters are active.
  3. **Unconnected Project Hub History Fallback (`ProjectHub.tsx:212-218`):** Displays `"The full-width revision view is not connected here yet. Open revision history from the plan workspace."` if `historyContent` is omitted.
  4. **Transient Upstream `503` Recovery UX:** During live testing, 2 of 9 managed-Gemini calls (`diagnostics/analyze` on first attempt, `opportunities/explore`) returned `503 UPSTREAM_ERROR` even after internal retries. Clear in-place retry actions without losing user form inputs (scope, goals, selected text) are essential.

---

## 3. Root-Cause Pattern Synthesis

Stepping back from the 15 individual findings, **four systemic root causes** explain nearly every defect in PCC today:

1. **Additive Layering Without Consolidation (`F-01`, `F-07`, `F-08`, `F-12`, `F-13`):** Era 3 features were layered on top of Era 1/2 screens and data paths rather than converging them, creating dual navigation, dual prompt/manuscript realities, and placeholder text views.
2. **Safety Mechanics Exposed as Writer Friction (`F-01`, `F-04`, `F-11`, `F-13`):** Admirable engineering invariants (IndexedDB verification, exact provenance offsets, unsaved-draft protection, explicit import checkpoints) were implemented as rigid user-facing gates rather than invisible, fault-tolerant ergonomics.
3. **Unaligned Budget & Context Boundaries (`F-02`, `F-04`, `F-05`, `F-06`, `F-09`):** Some endpoints have zero thinking/budget caps (`generateStoryText` timing out at 60s), while others clamp so aggressively (`2,048` output tokens in `extractionService`, 8-section prefix slicing in `Diagnostics`/`Sync`, no relationships in `Writing Assist`) that long-form narratives break.
4. **Inconsistent Provider & Schema Contracts (`F-03`, `F-04`, `F-14`):** Optional nullable fields in `batch-edit`, missing fence stripping in `extractionService`, and divergent routing between `getManagedGeminiClient()` and `createGeminiAdapter()` create subtle bugs that unit tests with mocked SDKs never caught.
