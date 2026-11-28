# 04 — AI Quality, Narrative Intelligence, Provider & Data Architecture

**Assignment:** `PCC-RESEARCH-01`  
**Parent Index:** [`README.md`](./README.md)  
**Cross-References:** [`02-functional-findings-and-root-cause.md`](./02-functional-findings-and-root-cause.md) · [`03-ux-ia-and-user-journeys.md`](./03-ux-ia-and-user-journeys.md) · [`05-creative-product-discovery-and-concepts.md`](./05-creative-product-discovery-and-concepts.md) · [`06-recommendations-strategy-and-roadmap.md`](./06-recommendations-strategy-and-roadmap.md)

---

## 1. Empirical AI Output Quality Critique

Evaluating PCC's AI purely by "did HTTP 200 return valid JSON?" hides huge qualitative gaps. Below is a craft-level critique grounded in our bounded live probes on `gemini-4-hydrogen` (`2026-11-28`) and full prompt inspection (`server/aiService.ts`, `server/narrative/narrativeAiService.ts`, `server/narrative/extractionService.ts`, `lib/promptBuilder.ts`).

### 1.1 Where AI Output Quality Is Strong Today **[Observed in actual preview]**
- **Contextual Writing Assistant (`POST /api/narrative/writing/assist`):** Produced genuinely strong, voice-faithful noir prose on Narrative 3 across 3 meaningfully distinct branches (*The Counterclockwise Tick* escalating via the watch's lie-trigger; *The Breakwater Shadow* deepening the shared mystery; *The Auctioneer's Reach* raising external stakes). Critically, each option listed explicit `assumptions` (*"Alden was involved in maintaining the breakwater lantern's mechanism"*), empowering author control without silently rewriting backstory.
- **Semantic Diagnostics & Sync on Short Narratives (`diagnostics/analyze`, `sync/analyze`):** Both endpoints caught **100% (3/3)** of seeded contradictions (Alden's gray→brown eyes, excluded `Steam Automaton`, Tuesday vs. Wednesday-three-days-prior math) AND **0 false positives** on intentional ambiguities/character beliefs (dockworker bribe rumor, Port Marrow fog folklore, Alden's suspicion about Nadia). Sync also accurately identified unmodeled location `Port Marrow`.
- **Ambiguity & Unhandled-Clause Awareness in Batch Edit (`batch-edit`):** Correctly refused to guess `"Make him older"` (listing `Alden Voss` vs. `Tomas Reed` with a clear question) and explicitly flagged `"export the chapter as EPUB"` as unhandled.

### 1.2 Where AI Output Quality & Intelligence Fall Short Today
1. **Clarifications Lean Toward Genre Tropes (`clarify`):** **[Observed in actual preview]** On the backward-ticking watch seed, `clarify` offered competent but somewhat stock trope options (*"gaslit Victorian city"*, *"dangerous syndicate or government agency hunting for the watch"*, *"steals a moment of the watchmaker's own life"*). Because `clarify` has no awareness of the writer's existing prose voice, themes, or prior choices beyond a flat string list of `confirmedFacts`, questions feel like a generic genre questionnaire rather than an astute developmental editor probing *this specific story's* unique dramatic tension.
2. **Writing Assistant Has Tunnel Vision (`F-06`):** **[Confirmed by current source inspection]** Because `extractConfirmedWritingContext` omits `relationships`, `excluded` entities, `section` metadata (`pov`, `location`, `chronology`, `purpose`), and prior chapters, quality degrades sharply as soon as a scene moves past Chapter 1 or relies on complex relationship dynamics not repeated inside the ±1,500-character local window.
3. **One-Shot Story Generation Prompt Is Thin & Fails on Latency (`F-02`):** **[Confirmed by current source inspection]** **[Observed in actual preview]** `generateStoryText` uses a 2-sentence generic instruction with no pacing/voice/structure guidance and no `thinkingConfig` bound, causing a 60s timeout on `gemini-4-hydrogen`.
4. **Prompt Compiler Ignores the Manuscript (`F-07`):** **[Confirmed by current source inspection]** `lib/promptBuilder.ts` compiles a brief solely from Era 2 graph/bible fields, producing a structural blind spot whenever a writer develops their story in prose.
5. **Diagnostics & Sync Silently Drop Long-Form Context (`F-05`):** **[Confirmed by current source inspection]** Prefix-slicing to the first 8 sections × 5,000 chars makes narrative intelligence collapse on any novella or novel.
6. **Import Extraction Fails on Both Exact Offset Math and Schema Fragility (`F-04`):** **[Observed in actual preview]** **[Confirmed by current source inspection]** Asking an LLM to compute exact UTF-16 character indices while clamping output to `2,048` tokens is fundamentally mismatched with how transformer tokenizers work.

---

## 2. Prompting & Context Assembly Audit

| Operation | Current Input Cap (`server/aiBudget.ts`) | Actual Client Slice | Missing Critical Narrative Context | Server Budget Enforced? |
|---|---|---|---|---|
| `analyze` | 8,000 chars / 4,000 tok | `originalIdea` only | Existing manuscript sections, existing entities (on reanalyze) | **No** (`aiService.ts` bypasses `aiBudget`) |
| `clarify` | 8,000 chars / 4,000 tok | `refinedPrompt` + flat `confirmedFacts[]` | Manuscript tone/excerpts, unresolved narrative tensions | **No** |
| `batch-edit` | 16,000 chars / 6,000 tok | `prompt` + entities + rels | `storyBible` current values! (Model can't see current Story Bible values when editing them) | **No** |
| `story` | 8,000 chars / 4,000 tok | `refinedPrompt` only | Working manuscript chapters, style profile | **No** (no `thinkingConfig`, no `maxOutputTokens`) |
| `writing` | 24,000 chars / 9,000 tok | ±1,500 chars + ≤25 entities + Bible + ≤8 style obs | **All `relationships`**, excluded entities, prior chapter summaries, scene metadata (`pov`/`purpose`/`chronology`) | **Yes** (`narrativeAiService.ts`) |
| `diagnostics` | 40,000 chars / 14,000 tok | First 8 sections × 5k chars; ≤60 entities; ≤80 rels | Sections 9+, tails >5k chars, **`belief`/`reported` entities stripped**, `changed` scope ignored | **Yes** |
| `sync` | 40,000 chars / 14,000 tok | First 8 sections × 5k chars; ≤60 entities; ≤80 rels | Sections 9+, tails >5k chars, **`belief`/`reported` entities stripped** | **Yes** |
| `opportunities` | 36,000 chars / 12,000 tok | ≤10 sections; ≤60 entities; ≤80 rels | Unresolved diagnostics/open questions (cannot connect opportunities to active plot holes) | **Yes** |
| `narrative-import` | 32,000 chars / 8,000 tok/chunk (12 calls max) | Adaptive chunks (max 12 calls = ~96k tokens max) | Cross-chunk entity glossary (causes fragmented duplicate entities across chapters) | **Yes** (clamped to `2,048` output tokens!) |

**Key Architectural Insight:** Modern models in PCC's own catalog (`gemini-4-hydrogen`, `gemini-2.5-flash`, `gpt-5.4`, `gpt-6-luna`) expose **400K–1M+ token context windows** **[Confirmed by current source inspection in `server/providers/policy.ts` & live `/models` catalog]**, yet PCC's application layer still operates on Era-1 `8,000`-character budgets and naive prefix slicing (`sections.slice(0, 8)`). Better context engineering is **not** simply dumping 100k tokens into every prompt (which increases latency, cost, and "lost-in-the-middle" degradation) — it is **structured, relevance-scoped narrative retrieval** (see §4).

---

## 3. Multi-Provider Architecture Audit

Per Assignment §9, we strictly separate **Authentication**, **Policy Eligibility**, **Official Capability**, **Observed Availability**, and **Output Quality** across PCC's four configured connections (`server/providers/`).

| Dimension | `gemini-managed` | `gemini-personal` | `chatgpt-plan` (SIWC) | `openai-api` |
|---|---|---|---|---|
| **Authentication** | Host-injected `process.env.GEMINI_API_KEY` (never exposed to browser) **[Confirmed by source]** | Session-only user API key held in server RAM; cleared on restart; loopback-only **[Confirmed by source]** | Official OAuth/PKCE flow (`https://auth.openai.com`), loopback-only, session generation lease **[Confirmed by source]** | Session-only OpenAI API key in server RAM; loopback-only; separate billing from ChatGPT plan **[Confirmed by source]** |
| **Policy Eligibility (`server/providers/policy.ts`)** | All 11 text ops + `image` | All 11 text ops + `image` (note: `geminiAdapter.ts:118` sets `operationCapabilities.image = unsupported` on per-op preferences while `PROVIDER_OPERATIONS` allows `image`) | All 11 text ops (`image` unsupported) for known slugs in `OPENAI_MODEL_EVIDENCE`; **`/generate/story` additionally gated by SRB `chatGptStoryLocalActivation`** (`routes.ts:425`) | All 11 text ops (`image` unsupported) for known slugs in `OPENAI_MODEL_EVIDENCE` |
| **Token Preflight & Output Caps** | Exact provider `countTokens` on `narrativeAiService`/`extractionService`; **bypassed** on `aiService.ts` routes | Exact provider `countTokens` via `geminiAdapter.countTokens` | **Local byte/4 estimate only** (`chatgptResponses.ts:268-272`); `max_output_tokens` NOT forwarded on SIWC; SSE byte/event caps enforced locally | Exact preflight via `POST /v1/responses/input_tokens` + provider-enforced `max_output_tokens` |
| **Structured JSON Enforcement** | Native Gemini `responseMimeType: 'application/json'` + `responseSchema` | Native Gemini `responseMimeType` + `responseSchema` | **Prompt-only instruction** (`constrainedJsonInstruction`, `chatgptResponses.ts:63-65`); no native `text.format` JSON schema | **Prompt-only instruction** (`constrainedJsonInstruction`) despite `structuredOutput: true` declared in `policy.ts`! |
| **Official External Capability References** | Gemini API `models.list`, `countTokens`, `generateContent`, thinking docs (`https://ai.google.dev/gemini-api/docs/thinking`) **[Cited in source]** | Same Gemini Developer API **[Cited in source]** | OpenAI SIWC docs (`https://developers.openai.com/siwc/token-sharing-open-source/models-and-inference`, `.../preview-limitations`) **[Cited in source; live external verification not performed]** | OpenAI Responses API & Models docs (`https://developers.openai.com/api/docs/models/`) **[Cited in source; live external verification not performed]** |
| **Observed Live Availability (`2026-11-28`)** | **Verified live:** 28 models listed (incl. `gemini-4-hydrogen`); 6/9 endpoints succeeded; `story` timed out (`F-02`); `import/extract` returned `502` (`F-04`); 2 transient `503`s | **Unverified live** (per Assignment §4 authorization boundary) | **Unverified live** (per Assignment §4 authorization boundary) | **Unverified live** (per Assignment §4 authorization boundary) |
| **Output Quality** | High prose & contradiction accuracy on `gemini-4-hydrogen` when bounded; schema omission on `batch-edit` (`F-03`) | Unverified live | Unverified live; **higher risk of JSON/fence parse failures** on `extractionService.ts:180` (no fence stripping + prompt-only JSON) **[Inferred from source]** | Unverified live; same prompt-only JSON risk on `extractionService.ts:180` **[Inferred from source]** |

### Key Provider Architectural Defects to Resolve
1. **Eliminate the Managed-vs-Adapter Divergence (`geminiClient.ts:134`, `runtime.ts:221`):** Default `gemini-managed` bypasses `createGeminiAdapter` (skipping `observedByConnection` usage counting and unified bounds), whereas explicit model selection (`import/extract`) routes through `createGeminiAdapter` (where `import/extract` hit `502 MODEL_UNSUPPORTED`). One single, well-instrumented Gemini transport path should serve both.
2. **Adopt Native Structured Outputs on OpenAI Responses API (`chatgptResponses.ts`):** When a model declares `structuredOutput: supported`, emit Responses API structured schema formatting (or verify SIWC compatibility cleanly with strict fallback + fence-stripping + repair) rather than relying solely on prose instructions.
3. **Unify `chatgpt-plan` Governance:** Clarify why `/generate/story` enforces SRB (`subscriptionResourceBudget.ts`) while 10 other `chatgpt-plan` text routes do not, so quota/budget protection and user-facing messages are consistent across every operation.
4. **Fix Image Transport Alignment:** Reconcile `generateImagesBatch` (`generateContent` + `imageConfig`) with `geminiAdapter.generateImage` (`generateImages`) so `gemini-personal` and `gemini-managed` do not silently diverge.

---

## 4. Narrative Data Architecture & Long-Form Scaling Analysis

### 4.1 Strengths & Limits of the Current Four-Authority Model

PCC's `CreativeProject` (`shared/types.ts` + `shared/narrativeSchemas.ts`) cleanly separates:
1. **Immutable Sources** (`narrative.sources[]` — original text/bytes + digest + block spans)
2. **Working Manuscript** (`narrative.versions[]` + `narrative.sectionVersions[]` — chapters/scenes + style profile)
3. **Canonical Narrative Model** (`snapshot.entities[]`, `snapshot.relationships[]`, `snapshot.storyBible`, `narrative.claims[]`, `narrative.issues[]`)
4. **Generated Artifacts** (`artifacts[]`, `narrative.writingAlternatives[]`, `narrative.opportunities[]`)

**Where this architecture hits a hard scaling wall on long-form novels (30k–120k words):** **[Confirmed by current source inspection]**
1. **Monolithic Snapshot Bloat in Undo & Revisions:** Every single edit clones the entire `ProjectSnapshot` into `revisions[]` and `undoHistory.past[]` inside one IndexedDB record. As entities, relationships, and decisions grow, serialization and memory pressure escalate rapidly.
2. **No Scene-to-Entity / Scene-to-Claim Index:** The model does not maintain a lightweight index of *which characters, locations, objects, or facts appear in which manuscript section*. Consequently:
   - `Writing Assist` blindly sends the first 25 confirmed entities rather than the entities actually present or relevant to the current scene.
   - `Diagnostics` and `Sync` blindly send `sections.slice(0, 8)` instead of targeted changed scenes + relevant canon neighborhood.
3. **No Rolling Chapter Summaries / Fact Sheets:** Without compact, author-editable per-section summaries (`section.synopsis` exists in `sectionSchema` but is never populated or injected into AI context!), the AI cannot reason about a 30-chapter plot arc within a 14k-token budget.
4. **Broken Evidence Anchoring Across Subsystems:** Import uses brittle LLM-emitted UTF-16 indices (`F-04`); Semantic Diagnostics throws anchors away entirely (`anchors: []`, `F-10`).

### 4.2 Proposed Architectural Evolution: Indexed Narrative Memory & Deterministic Anchoring

```
┌────────────────────────────────────────────────────────────────────────────┐
│                     EDITABLE WORKING MANUSCRIPT (Chapters/Scenes)          │
│         [Ch 1]        [Ch 2]        [Ch 3]  ...  [Ch 20]                   │
└───────────┬─────────────┬─────────────┬──────────────┬─────────────────────┘
            │             │             │              │
            ▼ (deterministic local index + incremental AI synopsis/fact pass)
┌────────────────────────────────────────────────────────────────────────────┐
│                NARRATIVE MEMORY INDEX (Derived, Rebuildable)               │
│  • SectionDigest: { sectionId, textDigest, synopsis, mentionedEntityIds[], │
│                     chronologyOrder, activeClaims[], lastAnalyzedRev }     │
│  • EntitySceneMap: entityId → [sectionIds + verified quote offsets]        │
│  • EpistemicFactLedger: { factId, subjectId, statement, epistemicKind,     │
│                           holderEntityId?, status, anchors[] }             │
└───────────┬───────────────────────────┬─────────────────────────┬──────────┘
            │                           │                         │
            ▼                           ▼                         ▼
   [Writing Partner]          [Diagnostics & Sync]        [Visual Views]
   Retrieves ONLY:            Scans changed sections +    Drives real:
   • Active scene + meta      cross-checks against        • Story Map
   • Preceding 2 synopses     EntitySceneMap + all        • Dual-Track Timeline
   • Mentioned entities +     canon/belief claims         • Epistemic Lens
     their relationships      (zero silent 8-sec drop!)     ("Who Knows What?")
   • Explicit exclusions
```

### 4.3 Conceptual Interfaces (Illustrative Only — Not Implemented)

```ts
/** Re-anchorable quote evidence resilient to small edits & LLM offset inaccuracies */
export interface NarrativeAnchor {
  sourceKind: 'imported-source' | 'manuscript-section';
  recordId: string;           // sourceId or sectionId
  recordDigest: string;       // detects drift without invalidating the whole project
  quote: string;              // exact verbatim excerpt (resolved deterministically)
  prefixContext?: string;     // 24 chars before quote for disambiguation
  suffixContext?: string;     // 24 chars after quote for disambiguation
  start: number;              // deterministically computed UTF-16 start
  end: number;                // deterministically computed UTF-16 end
  status: 'exact' | 're-anchored' | 'drifted';
}

/** First-class epistemic claim linking canon, character belief, and rumors */
export interface EpistemicNarrativeClaim {
  id: string;
  subjectEntityId: string;
  predicate: string;
  value: string;
  epistemicKind: 'canon' | 'character-belief' | 'rumor-reported' | 'intentional-ambiguity' | 'ai-inferred';
  holderEntityId?: string;    // e.g., "Alden Voss" believes X; null for world canon
  approval: 'confirmed' | 'pending' | 'rejected';
  introducedInSectionId?: string;
  anchors: NarrativeAnchor[];
}

/** Lightweight derived index enabling novel-scale context retrieval */
export interface SectionContextIndex {
  sectionId: string;
  textDigest: string;
  synopsis: string;           // author-editable 2-3 sentence summary
  chronologyOrder?: number;   // explicit numeric/relative order (replaces localeCompare!)
  mentionedEntityIds: string[];
  activeRelationshipIds: string[];
  lastSyncedRevision?: number;
}
```

### 4.4 Deterministic Quote-to-Offset Anchor Resolution (Pseudocode for Fixing `F-04` & `F-10`)

```ts
function resolveDeterministicAnchor(
  chunkText: string,
  quote: string,
  approxHintOffset?: number
): { start: number; end: number } | null {
  const trimmed = quote.trim();
  if (!trimmed) return null;

  // 1. Collect all exact verbatim occurrences in chunkText
  const matches: number[] = [];
  let idx = chunkText.indexOf(trimmed);
  while (idx !== -1) {
    matches.push(idx);
    idx = chunkText.indexOf(trimmed, idx + 1);
  }
  if (matches.length === 0) return null; // Fail closed: never accept hallucinated quotes!

  // 2. If single match, return exact deterministic UTF-16 bounds immediately
  if (matches.length === 1) {
    return { start: matches[0], end: matches[0] + trimmed.length };
  }

  // 3. If repeated quote, disambiguate using nearest approximate LLM hint (or paragraph index)
  const hint = typeof approxHintOffset === 'number' ? approxHintOffset : 0;
  const best = matches.reduce((closest, candidate) =>
    Math.abs(candidate - hint) < Math.abs(closest - hint) ? candidate : closest
  );
  return { start: best, end: best + trimmed.length };
}
```

**Why this preserves PCC's safety invariants:** It STILL fails closed on any hallucinated/paraphrased quote (zero false evidence!), while raising survival rates for genuinely verbatim LLM quotes from fragile off-by-one rejection to ~100%.

### 4.5 Future Architecture Acceptance Tests (Illustrative)
1. **Quote-Anchor Survival Test:** Feed a 3,000-word synthetic chapter with deliberate off-by-5 LLM offsets on verbatim quotes → `resolveDeterministicAnchor` recovers 100% of exact quotes and rejects 100% of altered/hallucinated quotes.
2. **Novel-Scale Context Coverage Test:** Construct a 20-chapter (40,000-word) synthetic novel with a contradiction in Chapter 17 → Diagnostics scans via indexed passes or changed-section tracking and surfaces the Chapter 17 contradiction with a clickable passage anchor (`status: 'exact'`), never silently dropping Chapters 9–20.
3. **Relationship-Aware Writing Test:** Invoke Writing Partner on Chapter 2 with a confirmed relationship `Alden Voss -[estranged uncle of]-> Nadia Kestrel` and excluded `Steam Automaton` → request payload includes the relationship, Chapter 1 synopsis, scene POV, and exclusion list.
4. **Uniform Budget & Telemetry Test:** Execute all 12 `AiOperation` routes through the unified server runner → every route enforces rate/concurrency/token budgets, handles timeouts as `504 TIMEOUT (retryable: true)`, and increments `observedByConnection`.
