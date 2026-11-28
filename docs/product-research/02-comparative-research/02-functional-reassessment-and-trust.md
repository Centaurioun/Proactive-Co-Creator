# 02 — Functional Reassessment, Root-Cause Verification & Trust Priorities

**Assignment:** `PCC-RESEARCH-02` (Section 6.6)  
**Parent Index:** [`README.md`](./README.md)  
**Cross-References:** [`01-comparative-coverage-and-traceability.md`](./01-comparative-coverage-and-traceability.md) · [`04-creative-collaboration-and-proposal-lifecycle.md`](./04-creative-collaboration-and-proposal-lifecycle.md) · [`05-narrative-intelligence-and-visual-design.md`](./05-narrative-intelligence-and-visual-design.md) · [`07-recommended-evolution-roadmap-and-owner-decisions.md`](./07-recommended-evolution-roadmap-and-owner-decisions.md)

> **Critical Mandate (Assignment §6.6):** Do not assume a reported live failure proves a single causal explanation or that a source fix guarantees live success. Re-verify `PCC-RESEARCH-01` findings against current source code, separate established causes from hypotheses, and ensure every repair resolves root causes rather than suppressing symptoms or weakening safety invariants.

---

## 1. Executive Summary of Self-Corrections to `PCC-RESEARCH-01`

Re-inspecting the live server and client source files during `PCC-RESEARCH-02` exposed **four material analytical corrections** to `PCC-RESEARCH-01`:

1. **`F-02` (`499 CANCELLED` on Story Timeout) — True Root Cause Located in `server/retry.ts`:** `PCC-RESEARCH-01` blamed `classifyWithSignal` in `server/aiService.ts` for misclassifying timeouts. Direct re-inspection of `server/retry.ts:20, 25, 83, 89, 95` proves **`withRetry()` itself unconditionally throws `new AppApiError('CANCELLED', 'The request was cancelled.', 499, false)` whenever `options.signal?.aborted` is true**—erasing `options.signal.reason` (which `combineSignals` explicitly set to `TIMEOUT / 504 / retryable: true`) **before** `classifyWithSignal` ever runs! This defect affects *all six* `aiService.ts` routes, not just `generateStoryText`. Meanwhile, attributing the 60s latency *solely* to omitted `thinkingConfig` is reclassified from "Confirmed Root Cause" to **Confirmed Code Omission + Strong Latency Hypothesis** pending controlled A/B verification.
2. **`F-03` (`batch-edit` Missing `nextValue`) — Server Emission Defect vs. Working Client Safety Gate:** `PCC-RESEARCH-01` implied incomplete `update_story_bible` operations silently passed through. Direct inspection of `lib/nlBatch/operationValidation.ts:349-358` proves **client-side validation already catches missing `nextValue` (`INVALID_VALUE`) and blocks corrupt application**. The actual user failure is a **dead-end UX loop**: the server returns `HTTP 200` with a malformed operation (despite an earlier band-aid in `shared/schemas.ts:471-474`), and the client validator then blocks the user from applying their valid instruction.
3. **`F-04` (`import/extract` `502 MODEL_UNSUPPORTED`) — Four Distinct Defects Must Not Be Conflated:** Fixing LLM UTF-16 offset validation (`proposalValidator.ts:83-87`), output-token clamping (`extractionService.ts:168`), and missing fence-stripping (`extractionService.ts:180`) is essential—**but none of those three changes is guaranteed to resolve the observed live `502 MODEL_UNSUPPORTED`** (`1,952 ms`), because `normalizeGeminiError` (`server/providers/geminiAdapter.ts:163-195`) redacts the raw upstream error string before returning it. The live `502` requires isolated server-side diagnostic inspection first.
4. **`F-05` (Long-Form Truncation) — Legitimate Disclosed Budgets vs. Silent Slicing Defects:** Conservative per-request token limits (`AI_OPERATION_POLICIES`: `40,000` chars / `14,000` input tokens) are **legitimate engineering protections** against cost, latency, and "lost-in-the-middle" degradation. The confirmed defects in `asyncReviewActions.ts` are specifically: (a) **undisclosed omission** of sections 9+ and chars >5,000, (b) **broken `changed` scope** ignoring modified sections, and (c) **stripping `belief`/`reported` entities** prior to analysis.

---

## 2. Granular Reassessment of Core Functional Defects

### 2.1 First-Visit Landing & Empty States (`F-01`, `F-15`) **[Live + Source]**
- **Established Root Causes:**
  - `lib/workspacePreference.ts` defaults to `'write'` even when the active sample project (*Cat's Woodland Dinner Party*) contains 0 manuscript sections.
  - `ManuscriptEditor.tsx` renders technical storage-readiness text (`"Writing requires available IndexedDB..."`) during normal initial hydration rather than distinguishing *hydrating* from *storage failure*, and renders `"No sections match these filters."` when `sections.length === 0` with no active filter.
  - `lib/consistencyChecker.ts:316` has confirmed singular/spacing bug (`"2 core Story Bible property(Tone, Setting)"`).
- **Refined Repair Design:**
  - Never suppress a *genuine* IndexedDB failure (preserves data-loss warning). Instead, introduce a crisp 3-state hydration lifecycle: `loading` (calm skeleton, no technical error), `ready` (full editing), and `storage-unavailable` (clear plain-language warning + immediate Export Backup button).
  - For empty-manuscript projects with populated seed/graph data (like the sample project), either seed a short 2-scene sample excerpt OR land on `World`/`Plan` with a 1-click *"Open / Draft Chapter 1 in Write"* CTA. (See Owner Decision `OD-02` in [`07 §4`](./07-recommended-evolution-roadmap-and-owner-decisions.md).)

### 2.2 `POST /api/generate/story` Timeout & `499 CANCELLED` Misclassification (`F-02`) **[Live + Source-Reassessed]**

Separating the **two independent layers** cleanly:

| Layer | Status | Exact Evidence | What Repair Actually Solves |
|---|---|---|---|
| **Layer A — Abort Reason Erasure (`499` instead of `504`)** | **Confirmed Root Cause (`Source`)** | `server/retry.ts:20, 25, 83, 89, 95` hardcodes `new AppApiError('CANCELLED', ..., 499, false)` whenever `options.signal?.aborted` is true, discarding `options.signal.reason` (`AppApiError('TIMEOUT', 504, true)` from `combineSignals` in `aiService.ts:50`). Then `aiService.ts:39` returns `err` directly because it is already an `AppApiError`! | Updating `withRetry` and `defaultSleep` to preserve `options.signal.reason instanceof AppApiError ? options.signal.reason : new AppApiError('CANCELLED', ...)` fixes timeout misclassification across **every** `aiService.ts` route while keeping genuine user cancellations as `499 CANCELLED (retryable: false)`. |
| **Layer B — 60-Second Timeout on `generateStoryText`** | **Confirmed Omission (`Source`) + Latency Hypothesis (`Hypothesis`)** | `server/aiService.ts:550-556` omits both `thinkingConfig` and `maxOutputTokens` (unlike `analyze`, `clarify`, `batch-edit`, `refine`, and `narrativeAiService`, which all pass `ThinkingLevel.LOW`). Whether unconstrained thinking, long output generation, or transient upstream queuing caused the 60,017ms duration is **hypothesized, not proven** by a single run. | Passing bounded `thinkingConfig` (respecting user-selected reasoning level, defaulting to `ThinkingLevel.LOW`) + `maxOutputTokens: AI_OPERATION_POLICIES.story.maxOutputTokens` + progressive streaming (SSE) directly bounds latency and improves perceived responsiveness, **and must be verified via controlled A/B timing tests** on the live model before declaring solved. |

- **Additional Caution (`withRetry` + Timeout Budget):** Note that `withRetry` runs up to `maxAttempts: 3` sharing the same 60s `reqSignal`. If attempt 1 hangs 35s and fails with a transient `503`, attempt 2 has only 25s left. Per-attempt timeout vs. total deadline budgeting should be explicit, and **single-attempt boundaries** (e.g., `chatgpt-plan` `maxAttempts = 1`, `server/retry.ts:72`) must remain strictly preserved without hidden fallback!

### 2.3 Faithful Narrative Import Failure (`F-04`) **[Live + Source-Reassessed]**

Four completely distinct failure mechanisms exist in `import/extract`; repairing only one or two will leave import broken:

1. **Defect 4A — Live `502 MODEL_UNSUPPORTED` on Managed `gemini-4-hydrogen` (`Unconfirmed Upstream Cause — Investigate First`):**
   - **Observed (`Live`):** `POST /api/narrative/import/extract` returned `502 MODEL_UNSUPPORTED` in `1,952 ms`.
   - **Confirmed Routing Difference (`Source`):** Because `ImportWorkflow` binds an explicit `modelId` (`gemini-4-hydrogen`), `runtime.ts:221` does NOT short-circuit to `getManagedClient()` — it enters `createGeminiAdapter` (`geminiAdapter.ts:321-378`), calling `countTokens` (`geminiAdapter.ts:325`) and then `generateContent` (`geminiAdapter.ts:371`).
   - **Why Cause Is Still Hypothesis:** `normalizeGeminiError` (`geminiAdapter.ts:193-195`) collapses HTTP `404` OR any error matching `/not.?found|unsupported.?model|model.*unavailable/` into the generic redacted string `"The selected Gemini model is unavailable for this request."` Without inspecting the raw upstream error in a server-side debug log (or checking whether `countTokens` vs. `generateContent` vs. `extractionResponseSchema` triggered the error), we **cannot** assume the fix is a model-name mismatch. **Required pre-fix step:** Log non-sensitive error status + method (`countTokens` vs. `generateContent`) + sanitized API error code in dev/test diagnostics.
2. **Defect 4B — Brittle LLM UTF-16 Offset Requirement (`Confirmed Structural Root Cause`):**
   - `extractionService.ts:92` forces the LLM to calculate exact UTF-16 `start`/`end` offsets; `proposalValidator.ts:83-87` silently rejects valid verbatim quotes on any off-by-one arithmetic error.
   - **Root-Cause Fix:** Ask LLM for exact verbatim `quote` + optional `approxParagraphIndex` (or `prefixContext`); compute exact UTF-16 `start`/`end` deterministically via exact substring matching (`01-independent-discovery/04 §4.4`), preserving **100% fail-closed rejection** if the exact verbatim quote is absent from the source chunk (zero hallucinated anchors).
3. **Defect 4C — Hard `2,048`-Token Output Clamping (`Confirmed Structural Root Cause`):**
   - `extractionService.ts:168` hardcodes `Math.min(2048, AI_OPERATION_POLICIES['narrative-import'].maxOutputTokens)` while inviting up to 150 entities + 250 relations + 300 findings + 100 ambiguities. Fix by honoring the policy ceiling (`4096`–`8192`) and/or running focused two-pass extraction (Pass 1: Entities & Relations; Pass 2: Findings & Ambiguities) for dense chapters.
4. **Defect 4D — Missing JSON Fence Stripping (`Confirmed Structural Root Cause`):**
   - `extractionService.ts:180` calls `JSON.parse(response.text)` directly instead of `stripMarkdownCodeFence(response.text)`, creating an immediate failure trap for `chatgpt-plan` and `openai-api` (which use prompt-only JSON instructions in `chatgptResponses.ts:63-65`).

### 2.4 Natural-Language Batch Edit (`F-03`) **[Live + Source-Reassessed]**
- **Reassessed Data Flow:**
  1. Server prompt & schema (`server/aiService.ts:373-393`) marks only `required: ['type', 'summary']`, making `nextValue` nullable/optional across all 9 operation types.
  2. Live model (`gemini-4-hydrogen`) placed the target tone inside `summary` and omitted `nextValue`.
  3. `shared/schemas.ts:471-474` attempts a narrow heuristic (`if (!nextValue && targetEntityName) nextValue = targetEntityName;`), which fails when `targetEntityName` is also absent, so `parseAndValidateBatchEditResponse` emits an incomplete `update_story_bible` op (`HTTP 200`).
  4. Client-side `validateProposedOperations` (`lib/nlBatch/operationValidation.ts:349-358`) **correctly rejects** the op with `INVALID_VALUE` before canon mutation—protecting data integrity, while stranding the writer with a broken un-applicable operation!
- **Root-Cause Fix (Without Sacrificing Resilience):**
  - Strengthen schema/prompt with explicit per-operation required field contracts (or discriminated operation groups) AND add server-side per-type completeness validation inside `parseAndValidateBatchEditResponse`: instead of silently returning broken ops or crashing an entire multi-clause batch, downgrade any incomplete operation into a visible `warning` / editable draft slot (e.g., *"Tone update detected—enter value to apply"*) or run one bounded schema-validation notice—preserving valid sibling operations.

### 2.5 Silent Truncation vs. Legitimate Disclosed Budgets & Passage Anchors (`F-05`, `F-10`) **[Source]**
- **Separating Policy from Bugs:**
  - *Keep:* Per-request input budgets (`40,000` chars / `14,000` tokens) are sound for latency, cost, and attention quality.
  - *Fix Bug 1 (Silent Truncation):* Every Diagnostics and Sync payload builder (`asyncReviewActions.ts:127-161`) must compute and return an explicit `CoverageManifest`: `{ analyzedSectionIds, omittedSectionIds, truncatedSections: [{ id, analyzedChars, totalChars }], entityCoverage: { included, total } }`, displayed transparently in Review (*"Checked 8 of 18 scenes · Chapters 9–18 not included yet"*).
  - *Fix Bug 2 (Broken `changed` Scope):* Filter `sections` using `section.version` / `textDigest` diffs against `syncState.lastSyncedDigests` so `Changed` truly scans changed chapters first.
  - *Fix Bug 3 (Stripped Epistemic Kinds):* Stop dropping `epistemicKind === 'belief' || 'reported'` in `buildCompactReviewModelPayload` (`asyncReviewActions.ts:83-115`); pass `epistemicKind` explicitly so Diagnostics can distinguish character-held falsehoods from author mistakes.
  - *Fix Bug 4 (Lost Anchors & Brittle Local Check):* In `lib/narrative/diagnostics/engine.ts:168`, resolve `f.evidenceQuote` into deterministic section anchors (`NarrativeAnchor`, [`01-independent-discovery/04 §4.4`](../01-independent-discovery/04-ai-quality-narrative-intelligence-and-architecture.md#44-deterministic-quote-to-offset-anchor-resolution-pseudocode-for-fixing-f-04--f-10)) so clicking any finding highlights the exact offending prose; remove the noisy substring `issue_setting_mismatch` check in `lib/consistencyChecker.ts:267-300` and rename local checks to *Structural Checks*.

### 2.6 Micro-Defects & Transient `503` Resilience (`F-15`) **[Live + Source]**
- During `PCC-RESEARCH-01` bounded live probes, **2 of 9** managed-Gemini calls hit transient `503 UPSTREAM_ERROR` even after internal retries. Across *all* AI forms (`Diagnostics`, `Sync`, `Writing Partner`, `Creative Studio`, `Grill Me`), a transient error MUST preserve all user-typed inputs, selections, and scope, and surface a 1-click **Retry** action without re-entering settings or losing draft session state (`CE-03.2`).

---

## 3. Bridging the Plan ↔ Manuscript Gap Without Canon Drift (`F-07`, `F-06`)

PCC's **Four Data Authorities** (`Immutable Imported Sources`, `Editable Working Manuscript`, `Canonical Narrative Model`, `Immutable Generated Artifacts`) are a genuine architectural strength that must **NOT** be collapsed.

The current failure is **lack of explicit, frictionless bridges** between them:

```
  [1. Immutable Sources] ──(explicit opt-in extract)──▶ [Proposed Model Cards]
                                                                 │ (explicit author approve)
                                                                 ▼
  [2. Working Manuscript] ◀──(explicit "Insert/Adopt")── [4. Generated Artifacts / Studio Drafts]
           │                                                     ▲
           ├──(read-only derived Memory Index, zero mutation)────┤
           │                                                     │
           └──(explicit Sync / Review diff)──▶ [3. Canonical Narrative Model & Story Bible]
```

**Three Concrete Bridge Rules (Zero Automatic Canon Drift):**
1. **Explicit Artifact-to-Manuscript Adoption:** `Generate Story`, `Writing Partner`, `Creative Studio`, and `Story Development` always save generated prose as immutable drafts/alternatives first, and offer 1-click **`Add as Chapter / Scene in Write`** or **`Replace Selected Passage`** (creating a normal editable manuscript revision, never mutating the underlying immutable artifact).
2. **Coherent Read-Only Context Assembly (`F-06`, `F-07`):**
   - `Writing Partner`, `Story Development`, and `Creative Studio` read from **both** the Canonical Narrative Model (`entities`, **scene-relevant `relationships`**, `excluded` negative constraints, `storyBible`, confirmed `styleProfile`, `Creative Locks`) **AND** read-only **Working Manuscript** context (active scene metadata `pov/location/chronology/purpose` + preceding section synopses via the derived Memory Index).
   - `lib/promptBuilder.ts` clearly labels what comes from **Story Model** vs. **Manuscript Synopses** (optional opt-in inclusion for seed/continuation briefs) instead of silently ignoring 40,000 words of written prose.
3. **Explicit Canon Promotion Only:** Typing in `Write` updates the *derived* local index (so Margin cast cards and scene lookups stay live), **never** silently alters Canonical Entities/Story Bible. Canon changes happen exclusively through explicit author action (direct edit, confirmed Inbox/Studio proposal, or reviewed Sync patch).

---

## 4. Progressive Faithful Import & Truthful Durable Autosave

### 4.1 Progressive Faithful Import with Explicit AI Authorization (`F-13`, `C-07`, `CE-03`)
Refining Stream 1's `C-07` to satisfy `CE-03`'s strict **"no unconsented/automatic provider calls"** invariant:

1. **Step 1 — Instant Source-Faithful Ingestion (0 AI Calls, <1s):**
   - Author drops `.txt`/`.md`/`.docx`/`.pdf` or pastes text → PCC immediately stores the **immutable source record** (`narrative.sources[]` with SHA-256 digest & block spans), runs fast deterministic chapter/scene splitting (with an inline preview toggle to adjust split rules if desired), and opens the manuscript directly in **`Write`**.
   - Editing the pasted text *before* committing updates the working copy without wiping source recovery checkpoints.
2. **Step 2 — Explicit Opt-In World Mapping (Writer Triggers AI Deliberately):**
   - A calm, dismissible banner inside `Write`/`World` offers:
     - **`Map Chapter 1 (Preview — 1 AI call, ~X est. tokens)`**
     - **`Map Selected Chapters (Preflight: N calls, ~Y est. tokens)`**
     - **`Skip AI Mapping for Now`**
   - AI extraction runs **only** upon explicit author click, processes chapter checkpoints sequentially with cancel/pause support, anchors every verbatim quote deterministically against the immutable source (`resolveDeterministicAnchor`), and maps highlights onto the editable manuscript via `NarrativeAnchor.status` (`exact` / `re-anchored` / `drifted`).
   - Extracted entities/relations/ambiguities land in the **Proposed** bucket (never auto-canonized) with click-to-highlight verbatim quotes.

### 4.2 Truthful Durable Autosave & Recovery (`F-11`, `R-07`, `CE-03.2`)
Replacing `App.tsx:175`'s hard navigation lockout without introducing silent data loss:

- **State Machine:** `Synced` → (keystroke) `Unsaved edits` → (1.2s debounce OR immediate flush on workspace switch) `Saving…` → `Saved` (confirmed IndexedDB commit) OR `Save failed (Draft kept in memory — Export / Retry)`!
- **Flush-on-Switch Protocol:** Clicking `World`, `Studio`, `Develop`, or `Review` triggers an immediate synchronous/awaited IndexedDB flush under CAS revision check.
  - If flush succeeds (~5–20ms locally): transition seamlessly—zero lockout banner.
  - If IndexedDB fails (quota full / storage revoked / CAS conflict): **preserve the live draft in memory + emergency localStorage/download export option**, block *destructive project switch or restore* only, and surface an actionable recovery banner (never silently discarding typed words!).
- **Creative Session Autosave:** Applies the exact same truthful status indicator inside `Creative Studio` and `Story Development` so selections, typed directions, Q&A answers, and AI cards survive reloads, while **never** automatically re-running an interrupted provider request on reload (`CE-03.2`).

---

## 5. Multi-Provider Governance, Budgets & Unverified Boundaries (`F-09`, `F-14`)

Reassessing `server/providers/` (`policy.ts`, `runtime.ts`, `geminiAdapter.ts`, `chatgptResponses.ts`, `subscriptionResourceBudget.ts`, `server/routes.ts`):

| Governance Area | Confirmed Current Reality (`Source`) | Root-Cause Architectural Fix | Safety / Verification Constraint |
|---|---|---|---|
| **1. Server Budget & Telemetry Unification (`F-09`)** | `aiService.ts` (`analyze`, `clarify`, `batch-edit`, `refine`, `story`) skips `acquireAiSlot`, `evaluateOperationBudget`, and `reserveAggregateOperationUsage`. `runtime.ts:221` short-circuits default `gemini-managed`, skipping `observed.set(...)` on line 282. | Route **all** 12 `AiOperation` types through one instrumented provider-execution boundary that uniformly enforces concurrency slots, input/output token bounds, single-attempt/retry rules, and `observedByConnection` counters—with zero unbudgeted bypasses. | Never silently retry `chatgpt-plan` (`maxAttempts = 1`) or silently fall back to another connection/billing tier if the selected provider fails! |
| **2. Single-Attempt & Cancellation Integrity** | `server/retry.ts:72` already enforces `maxAttempts = 1` for `chatgpt-plan`, **but** lines 20/25/83/89/95 erase `TIMEOUT` reasons into `499 CANCELLED`. `runtime.ts:227-240` enforces credential generation leases cleanly. | Fix `withRetry` to preserve `signal.reason` (`TIMEOUT` → `504`, external cancel → `499`, session change → `499` discarded stale response) while keeping `chatgpt-plan` strictly single-attempt. | Verify via unit tests for timeout vs. user cancel vs. session revocation across all 4 connections. |
| **3. Structured Outputs Compatibility (`F-14`)** | `chatgptResponses.ts:63-65` relies solely on prose `constrainedJsonInstruction` for BOTH `openai-api` and `chatgpt-plan`, despite `policy.ts` marking models `structuredOutput: supported`. | **Do NOT blindly assume SIWC (`chatgpt-plan`) accepts identical Responses API `text.format` schema parameters as `openai-api`.** Verify official Responses API vs. SIWC schema-subset rules first; enable native `text.format: { type: "json_schema", strict: true }` ONLY where verified supported (e.g., `openai-api` after strict-schema compatibility check), keep `stripMarkdownCodeFence` everywhere, and avoid silent parameter guessing. | External official OpenAI Responses API & SIWC compatibility for future-dated slugs (`gpt-6-luna`, etc.) remains **Unverified** in this research pass. |
| **4. `chatgpt-plan` SRB Asymmetry (`F-14`)** | `server/routes.ts:425` applies `handleChatGptStoryGeneration` (SRB local-activation gate) ONLY to `/generate/story`, while all other 10 text routes bypass it. | Explicit Owner / Policy Decision (`OD-04`): align SRB enforcement consistently with actual provider/local-runtime qualification policy rather than gating 1 of 11 routes inconsistently. | Must never weaken subscription quota protection or bypass SIWC terms. |
| **5. Image Transport Alignment (`F-14`)** | `aiService.ts:607` calls `generateContent` + `imageConfig`; `geminiAdapter.ts` implements `generateImage` via `generateImages` and drops `imageConfig` in `generateText`. | Secondary priority (Assignment §6.6); align transport cleanly when touching `geminiAdapter` so `gemini-personal` and `gemini-managed` do not silently diverge, without prioritizing image features over writing reliability. | Image generation remains **Unverified Live** in both `PCC-RESEARCH-01` and `PCC-RESEARCH-02`. |

### Explicitly Unverified External & Runtime Boundaries (Documented per Assignment §6.6 & §9)
- **Personal / External Providers (`gemini-personal`, `chatgpt-plan`, `openai-api`):** Not executed live (zero personal sign-in or paid external keys per Assignment §3). All findings are strictly source-confirmed; actual live token counting, rate limits, quota codes, and Structured Outputs behavior on these three connections remain **Unverified**.
- **Raw Upstream Cause of `import/extract` `502 MODEL_UNSUPPORTED`:** Observed live (`1,952 ms`), redacted by `normalizeGeminiError`; exact upstream Gemini response requires server-side diagnostic logging in a future authorized repair pass.
- **Controlled Latency A/B on `generateStoryText`:** Whether adding `ThinkingLevel.LOW` + `maxOutputTokens` drops `gemini-4-hydrogen` latency from >60s to <15s is a strong source-backed hypothesis requiring live measurement after authorization.
- **Native Desktop / Packaging Runtime:** PCC currently runs as a browser SPA + local Node/Express server (`server.ts`, loopback-only personal connections). Native desktop shell behavior (Electron/Tauri OS keychain, local filesystem persistence, offline behavior) is **Unverified** and out of current repository scope.
