# Phase 2 — Intelligent Import and Token-aware AI Context Implementation Plan

> For agentic workers: use superpowers:executing-plans or subagent-driven-development if available; otherwise follow equivalent explicit task-by-task TDD, review and verification. Checkboxes track work, not assumed completion.

**Goal:** Bring existing manuscripts into a complete, reviewable project with faithful source evidence and no arbitrary 8k truncation.

**Architecture:** Build bounded parser/extraction/proposal pipeline on Phase1 durable source/manuscript/registry and existing server AI. Distinguish provider analysis from deterministic commit.

**Tech stack:** existing React/TypeScript/Vite/Tailwind, Express/Gemini/Zod, IndexedDB/localStorage, existing Node tests and Chromium harness. Preserve working main toolchain; PR3/6 deferred. Do not upgrade TypeScript or Vite.

**Spec:** [consolidated spec](01-consolidated-product-spec.md), [architecture](02-architecture-and-file-map.md), [common execution protocol](03-execution-protocol.md), [preflight](00-technical-preflight.md). These are required. Each task below: characterize or RED, implement narrow behavior, GREEN, then commit/review if possible. No auto merge.


## Entry and review focus
Read Phase1 handoff; require proven data/backup/transaction authority before enabling actual import; if blocked work with isolated mock preview only and carry blocker. Review malformed DOCX/zip bomb, fake excerpt, same-name entities, partial/cancelled chunk and optional instruction injection, long Unicode. No direct client provider calls, no hidden source rewrite. 
### P2.1 Source parsing and preview (NI-D03/04/17/20)
Files lib/narrative/import/sourceParser.ts, segmentation.ts, shared/narrativeSchemas.ts, components/narrativeImport/SelectSource.tsx; tests/narrativeImportParser.test.ts. 
- [x] Paste/TXT/MD/DOCX safely: read bytes/text, verify format, bound byte/decompressed/entry counts before expansion, reject unsafe archive paths and malformed XML/ZIP, preserve extracted text/real heading structure, parser version/hash and block IDs. Original bytes retained under configured ceiling; extracted-only beyond it. TXT with no chapter stays unstructured. Tests cover Unicode, CRLF, empty, oversized, malformed archives, XML entities, no provider request on preview, and no mutation. DOCX tables/notes/tracked changes/relationships are omitted by the current parser; it exposes extracted text and this limitation.
- [x] Preview shows count/limitations/retention/provider notice, Faithful mode, Full/Selective scope/categories and optional instructions. User explicitly starts analysis. Enhance correction is unavailable and not silently applied.
### P2.2 Operation-specific budget and server boundary (NI-D07)
Files lib/narrative/context/{budget,coverage,contextSelector}.ts, shared/schemas.ts, server/routes.ts, server/narrative/{extractionService,contextPolicy}.ts, services/apiClient.ts, lib/promptBuilder.ts, App/PromptInput where real 8000 guard. tests/narrativeBudget.test.ts, routes.test.ts, schemas.test.ts.
- [x] Import-specific token/context limits and server request validation; long narrative input remains intact beyond the former 8,000-character guard. Existing non-import operation budgets/provider model claims remain outside this phase and are not redefined. Do not infer real provider token usage, quality, or pricing from the mocked qualification.
- [x] Segment on source structure with controlled overlap; coverage records completed, failed and unprocessed spans; retries are bounded and cancellation prevents late results from being accepted. New extraction route is schema-validated and passes client disconnect cancellation. Mock provider output is schema constrained; narrative is JSON-escaped and treated as untrusted input.
### P2.3 Extraction, identity, evidence and assembly (NI-D02/03/04/05/16)
Files lib/narrative/import/{identityResolver,proposalValidator,assembleProject}.ts, server/narrative/extractionService.ts, components/narrativeImport/{ImportWizard,AnalysisProgress,ReviewImport}.tsx; tests/narrativeExtraction.test.ts, narrativeImportLifecycle.test.ts.
- [x] Extraction schema covers entities/attributes, directed relations, findings and ambiguities. Exact immutable source excerpts/offsets are verified; uncertain identity matches remain unresolved; explicit evidence is distinguished from interpretation; no implicit invention or auto-confirmation. Tests cover fabricated excerpts, same-name entities, directed relation identity, overlap deduplication, selective scope and Unicode offsets. Mock fixtures are synthetic and do not validate model quality.
- [x] Progress and coverage are visible. Cancellation/stale results are ignored, retry does not accept stale work, and findings require explicit review. Enhance correction is clearly unavailable. Selecting relationships alone can leave endpoint entities unresolved; the app keeps that uncertainty instead of expanding selection silently.
- [x] Project creation assembles a fresh project only after review, persists source bytes/text, coverage, proposals, claims/evidence/issues and initial revision. Creation is single-flight, uses durable IndexedDB authority and expected revision zero; existing project is saved first. Incomplete coverage is presented and retained as an issue. Export, reload and managed-backup copy round-trip are checked.
   
## Phase gate

Local implementation and qualification: typecheck, lint, production build, all 146 tests, targeted parser/extraction/persistence/routes (33 tests), E2E-A–I, Stage 0 J01–12, existing narrative workspace flow, and synthetic Chromium import/reload/backup/restore at desktop and 390px. All passed locally. Production build still warns about the existing Zod annotation and >500 kB JS bundle. The synthetic browser test made exactly one intercepted extraction call; configured is false, so no AI provider request was made. Real model quality, Google AI Studio, real files beyond fixtures, actual IME and hosted visual behavior are NOT TESTED. See [Phase 2 handoff](handoff/phase-02.md). PR/CI status is recorded there when available. No merge and no Phase 3.
