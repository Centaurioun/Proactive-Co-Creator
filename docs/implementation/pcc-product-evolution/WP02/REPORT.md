# PCC-EV-WP02 — Implementation & Verification Report

- **Work Package:** `PCC-EV-WP02` — *Unified Narrative Foundation, Hybrid Search and Unified Proposal Engine*
- **Status:** `COMPLETED`
- **Date:** 2026-11-28
- **Governing Specification:** `docs/implementation/pcc-product-evolution/WP02/WORK-PACKAGE.md`

---

## 1. Executive Summary

`PCC-EV-WP02` delivers the two foundational narrative engines of the PCC Product Blueprint (`PRODUCT-BLUEPRINT.md` §3.1, §3.3, §4.6, §5.2):

1. **E1 — Persistent Narrative Memory Index & Hybrid Retrieval Engine (`NEW-EMB`, `IR-02`, `R-11`, `CE-03.6`):**
   - **Layer 1 (Always-Active Local Structured & Lexical Index):** Deterministic UTF-16 offset-safe paragraph and scene chunking, Unicode NFC + Turkish-aware (`İ -> i`, `I -> ı`) normalization and diacritic-folded indexing, inverted BM25 posting lists (`k1 = 1.2`, `b = 0.75`), and complete structured indexing of manuscript sections, immutable imported sources, all confirmed/draft entities (eliminating the legacy 80-entity cap), all relationships (eliminating the legacy 100-relationship cap), and epistemic claims (`CE-03.6`).
   - **Layer 2 (Optional Multi-Provider Semantic Vector Layer):** Independent, namespace-isolated (`{providerId}:{modelId}:{dimension}:{normalizationVersion}`) embedding architecture with **Off-by-default (`mode: 'off'`)** routing, supporting `Off (Local Only)`, `Priority Order`, and `Use All Available` across three provider adapters:
     1. **Cloudflare Workers AI** (`@cf/baai/bge-m3`, `@cf/pfnet/plamo-embedding-1b`, `@cf/baai/bge-large-en-v1.5`, `@cf/baai/bge-base-en-v1.5`, `@cf/baai/bge-small-en-v1.5`, `@cf/qwen/qwen3-embedding-0.6b`).
     2. **LM Studio (Local Loopback)** (`POST /v1/embeddings` with strict loopback SSRF protection restricting hosts to `127.0.0.1`, `localhost`, and `::1`).
     3. **Gemini Embedding 2** (`gemini-embedding-exp-03-07`, `text-embedding-004` with configurable task types and dimensionality).
   - **Layer 3 (Reciprocal Rank Fusion & Context Assembly):** Hybrid retrieval combining exact structured lookup, BM25 lexical search, and namespace-isolated cosine similarity via Reciprocal Rank Fusion (`RRF`, `k = 60`), reader spoiler boundary filtering (`maxPresentationOrder`), the **Context Inspector (`UIC-01`)**, and live **Citation Diff Cards (`UIC-02`)** that detect drifted manuscript quotes via FNV-1a 64-bit digests.

2. **E3 — Unified Proposal Engine, Creative Locks & Visual Change Map (`IR-04`, `R-05/09/10`, `CE-02/03.5/04/06.5–6`, `UI-NEW-06`, `UID2-03`, `V7`, `S-01`, `S-06`):**
   - Unified transaction model (`UnifiedProposal`) coordinating manuscript span hunks (`UnifiedManuscriptHunk`) and canonical Story World model mutations (`UnifiedModelOperation`) against an explicit `baseRevision`.
   - Two-tier **Creative Locks (`CE-06.5`, `CE-06.6`)**: `hard-structural` locks (which block mutation until explicitly overridden by the author) and `soft-advisory` locks (which surface warnings while permitting application).
   - Deterministic **Visual Change Map (`V7`)** computed strictly from `base state + validated patch + current selection` (`projectProposalChangeMap`), rendering both an interactive SVG topological change graph and a keyboard-accessible summary table.
   - Atomic CAS commit (`commitUnifiedProposal`) with partial hunk/operation selection, inline author editing before apply, fail-closed validation on stale base revisions or drifted span digests, and deterministic inverse-proposal undo (`buildInverseUnifiedProposal`).

---

## 2. Requirement Traceability Matrix

| Requirement ID | Specification Summary | Implementation Modules | Verification Status |
| :--- | :--- | :--- | :--- |
| **`E1` / `R-11`** | Persistent Narrative Memory Index eliminating silent 80-entity / 100-relationship caps | `shared/narrativeMemoryTypes.ts`, `lib/narrative/memory/{textNormalization,chunker,indexBuilder,indexRepository}.ts`, `lib/narrative/review/scopedContextBuilder.ts` | Verified in `tests/wp02NarrativeMemoryAndSearch.test.ts` (105 entities + 115 relationships indexed & retrieved with 0 silent drops) and Playwright browser session |
| **`NEW-EMB`** | Optional multi-provider embedding layer (`off` / `priority` / `all`), namespace isolation, SSRF guard, per-project external consent | `shared/embeddingSchema.ts`, `server/embeddings/{adapters,embeddingRuntime,embeddingRoutes}.ts`, `lib/narrative/memory/vectorRepository.ts`, `components/settings/EmbeddingsSearchSettingsTab.tsx` | Verified in `tests/wp02EmbeddingsAndRouting.test.ts` (adapter contracts, SSRF rejection, dimension validation, routing modes) and Playwright (`Embeddings & Search` tab) |
| **`CE-03.6`** | Epistemic claims (who knows/believes/suspects what and when) indexed for retrieval | `shared/narrativeMemoryTypes.ts` (`IndexedEpistemicClaim`), `lib/narrative/memory/indexBuilder.ts` (`extractEpistemicClaims`), `lib/narrative/memory/hybridSearch.ts` | Verified in `tests/wp02NarrativeMemoryAndSearch.test.ts` |
| **`IR-02` / `UIC-01`** | Context Inspector & Visual Scope Curtain showing requested, eligible, planned, and omitted context items with reasons and token breakdown | `lib/narrative/context/contextAssembler.ts`, `components/workspace/ContextInspectorModal.tsx` | Verified in `tests/wp02UnifiedProposalAndContext.test.ts` and Playwright (`Context Inspector` modal) |
| **`UIC-02`** | Citation Diff Card resolving manuscript/source anchors and detecting live vs cited digest drift | `lib/narrative/context/citationAnchorResolver.ts`, `components/workspace/ContextInspectorModal.tsx` | Verified in `tests/wp02UnifiedProposalAndContext.test.ts` (`matchesCitedDigest: false`, `isStale: true` on mutated scene) |
| **`E3` / `IR-04` / `R-05/09/10` / `S-01`** | Unified Proposal Engine with atomic manuscript + model transactions, CAS revision checks, partial selection, inline editing, and inverse undo | `shared/unifiedProposalTypes.ts`, `lib/narrative/proposals/unifiedProposalEngine.ts`, `components/workspace/UnifiedProposalReviewModal.tsx` | Verified in `tests/wp02UnifiedProposalAndContext.test.ts` and Playwright (staged proposal, atomic apply `r2 -> r3`, stale revision guard, and undo) |
| **`CE-02.1–3/11` / `CE-03.5` / `CE-04.1–6`** | Candidate patches with exact UTF-16 span anchors, provenance, confidence/rationale, and conflict diagnostics | `shared/unifiedProposalTypes.ts`, `lib/narrative/proposals/unifiedProposalEngine.ts` | Verified in `tests/wp02UnifiedProposalAndContext.test.ts` (overlap conflict, digest mismatch, stale revision, and lock checks) |
| **`CE-06.5` / `CE-06.6`** | Creative Locks (`hard-structural` vs `soft-advisory`) protecting entities, attributes, relationships, and manuscript sections/spans | `lib/narrative/proposals/creativeLocks.ts`, `components/workspace/UnifiedProposalReviewModal.tsx` | Verified in `tests/wp02UnifiedProposalAndContext.test.ts` (`HARD_LOCK_VIOLATION` vs `SOFT_LOCK_WARNING` + explicit author override) |
| **`UI-NEW-06` / `V7` / `S-06`** | Unified Proposal Review Modal and deterministic Visual Change Map (`V7`) computed strictly from `base + validated patch + current selection` | `lib/narrative/proposals/changeMapProjector.ts`, `components/workspace/UnifiedProposalReviewModal.tsx` | Verified in `tests/wp02UnifiedProposalAndContext.test.ts` (live node count update on selection toggle) and Playwright (`Visual Change Map (V7)` SVG + table) |
| **`UID2-03`** | AI Writing Assistant discoverable by default in Write mode with direct entry points to Context Inspector and Unified Proposals | `components/manuscript/WritingAssistantPanel.tsx`, `components/manuscript/ManuscriptEditor.tsx`, `App.tsx` | Verified in Playwright (`AI Writing Assistant` open by default in Write mode with `Inspect Context & Locks` button) |

---

## 3. Architectural & Security Invariants Verified

1. **Local-First Durability & Tombstone Safety (`IDB v3`):**
   - Upgraded IndexedDB (`proactive_co_creator_db_v2`) to version `3` with derived stores `'narrative-memory-index'` and `'narrative-vector-store'`.
   - `deleteIdbProject(projectId)` and `indexRepository` / `vectorRepository` purge derived index and vector records on project deletion and consult `getDeletedProjectIds()` tombstones before returning or writing snapshots so deleted projects cannot be resurrected by background indexing.
2. **Off-by-Default Embedding Routing & Explicit Per-Project Cloud Consent:**
   - Default embedding routing policy is `mode: 'off'`. No automatic background embedding network call occurs on app load or while typing.
   - Cloud embedding providers (`cloudflare`, `gemini`) require explicit per-project consent (`externalConsentByProject[projectId] === true`) before any project text is transmitted externally.
3. **Server-Side Credential Isolation & Strict Loopback SSRF Protection:**
   - Cloudflare API tokens and Gemini API keys reside strictly in `server/embeddings/embeddingRuntime.ts` memory and are redacted from `/api/ai/embeddings/status` responses.
   - `validateLmStudioLoopbackBaseUrl()` enforces `http:`/`https:`, rejects embedded URL credentials, restricts hostnames strictly to `127.0.0.1`, `localhost`, or `[::1]` / `::1`, and blocks remote or RFC-1918 LAN targets (`192.168.x.x`, `10.x.x.x`, `169.254.169.254`).
4. **Strict Vector Namespace Isolation:**
   - Every stored vector record carries an explicit `namespace = "{providerId}:{modelId}:{dimension}:{normalizationVersion}"`.
   - `hybridSearchNarrativeMemory()` filters candidate vectors strictly by `requestedNamespace`, preventing cross-model or cross-dimension cosine similarity comparisons.

---

## 4. Honest Verification Ledger

### 4.1 Locally Verified (Node Unit/Integration Tests & Live Playwright Browser Verification)
- **Static & Build Checks:**
  - `npm run typecheck` (`tsc --noEmit`): **0 errors**.
  - `npm run lint` (`lint_applet`): **0 errors, 0 warnings**.
  - `compile_applet` (`npm run build`): **Succeeded**.
- **Focused Automated Test Suites (`npx --yes tsx --test tests/wp02*.test.ts` — 11/11 tests passing):**
  - `tests/wp02NarrativeMemoryAndSearch.test.ts` (4/4 passing): Turkish & diacritic normalization (`İ -> i`, `I -> ı`), UTF-16 surrogate-pair boundary safety, incremental section re-indexing, >100 entities (`105`) and >110 relationships (`115`) indexed without legacy 80/100 truncation, epistemic claim extraction (`CE-03.6`), hybrid search (`RRF` + `BM25` + namespace-isolated semantic cosine fusion), and reader spoiler boundary filtering (`maxPresentationOrder`).
  - `tests/wp02EmbeddingsAndRouting.test.ts` (4/4 passing): Loopback SSRF rejection for remote/LAN hosts and embedded credentials, finite numeric vector validation and L2 normalization, Cloudflare / LM Studio / Gemini adapter contract tests with mocked `fetch`, and `EmbeddingHubRuntime` routing modes (`off`, `priority` with automatic fallback, `all` multi-namespace fan-out).
  - `tests/wp02UnifiedProposalAndContext.test.ts` (3/3 passing): Context Inspector (`UIC-01`) inclusion/omission accounting under tight token budgets, Citation Diff Card (`UIC-02`) live vs stale digest drift detection, Creative Locks (`hard-structural` blocking vs `soft-advisory` warning + override), V7 Visual Change Map deterministic projection, atomic CAS commit (`r2 -> r3`), and inverse proposal undo (`r3 -> r4`).
- **Live Browser Verification via Playwright (`http://localhost:3000`):**
  - Verified Write mode with AI Writing Assistant expanded by default (`UID2-03`) and top toolbar navigation (`Search & Memory`, `Context Inspector`, `Proposals & Locks (E3)`).
  - Verified manuscript scene creation, durable save (`r2`), local Narrative Memory Index build, and live hybrid search query (`Barnaby lantern`) returning ranked scene and character matches with BM25 rank, RRF score, and highlighted excerpts.
  - Verified `AI settings -> Embeddings & Search` tab (`Mode: Off (Local Only)`, local index build button, routing mode selector, per-project external consent toggle, and `#1 Cloudflare Workers AI`, `#2 LM Studio (Local Loopback)`, `#3 Gemini Embedding 2` cards).
  - Verified `Context Inspector & Visual Scope Curtain (UIC-01 / UIC-02)` modal showing `Requested: 12`, `Eligible: 12`, `Planned: 12`, `Omitted: 0`, `Est. Tokens: 318 / 6000`.
  - Verified `Proposals & Locks (E3)` modal: staging sample continuity proposal, switching to `Visual Change Map (V7)` tab (rendering SVG graph + accessible summary table), clicking `Apply Selected Changes (CAS)` to atomically update manuscript text and Story World model at Revision `#3`, verifying automatic `STALE_BASE_REVISION` protection after commit, and verifying zero browser console errors.

### 4.2 Synthetically Verified vs Live External Provider Status
- **Synthetically Verified:** All three embedding provider adapters (`CloudflareEmbeddingAdapter`, `LmStudioEmbeddingAdapter`, `GeminiEmbeddingAdapter`) and multi-provider routing (`off`, `priority`, `all`) were verified against deterministic HTTP payload contracts and vector normalization assertions in `tests/wp02EmbeddingsAndRouting.test.ts`, and `/api/ai/embeddings/status` was verified live in the running Express server.
- **Live External Hardware/Credential Dependency:** End-to-end live network embedding calls to Cloudflare Workers AI, a local LM Studio server (`http://127.0.0.1:1234`), or Google Gemini Embedding 2 require user-supplied credentials or a locally running LM Studio daemon configured in `AI Settings -> Embeddings & Search`. When unconfigured or set to `Off (Local Only)`, the workspace operates with full local structured + BM25 lexical search and zero degradation.

### 4.3 Intentionally Deferred Items (Per Owner Execution-Policy Override)
- **`D-01` (GitHub Actions `npm ci` lockfile mismatch):** Left untouched per `WORK-PACKAGE.md` §2.
- **`D-04` / `D-08` (Legacy warning budget / deeper large-module decomposition):** Left untouched per `WORK-PACKAGE.md` §2; all newly created WP02 modules are modularized cleanly under `shared/`, `lib/narrative/{memory,context,proposals}/`, `server/embeddings/`, and `components/{settings,workspace}/`.
