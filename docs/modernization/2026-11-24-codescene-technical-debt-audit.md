# CodeScene technical-debt assessment and incremental remediation roadmap

Date: 2026-11-24
Repository: Centaurioun/Proactive-Co-Creator
Source: CodeScene analysis job 8567730, 24 Nov 2026, 07:27 GMT+3; 15 open file X-Ray tabs, dashboard, hotspot list and Technical Debt system map. Repository source comparison: main 3526c24fec45c60878937a331e487fc387e28d0b. The CodeScene tab did not expose its analyzed Git SHA; re-run analysis and pin the exact SHA before comparing scores.

## 1. Executive decision

The project has significant maintainability debt, especially in canonical creative-state, persistence and natural-language batch editing. Do NOT pursue a score-only rewrite. Preserve Schema v3, directed graph relationships, approval/provenance, stale-request guards, atomic batch commit, undo/redo, backup, migration, CAS and local-first data ownership. Browser CI is still failing at E2E-E focus restoration on the inspected main (run 45300419119); the owner has assigned browser qualification separately to Codex. This PR intentionally does not touch that work.

### Directly observed CodeScene metrics

| Metric | Result |
|---|---:|
| Hotspot Code Health | 5.2 / 10 |
| Average Code Health (dashboard, rounded) | 6.2 / 10 |
| System Code Health (map) | 6.25 / 10 |
| Code analyzed | 22,200 LoC |
| System map | 53 files |
| Red / yellow / green code | 29% / 51.2% / 19.8% |
| Hotspot share | 37.7% |
| Development effort in hotspots | 63% |
| Prioritized Technical Debt | Insufficient commit history |
| PR integration | Not configured; 0 checks this month |
| Architectural component health | Not configured |
| File-level change coupling by commits | 4 entities; identities not exposed in open tab |

Do not equate Code Health with runtime correctness, measured defects, test coverage or security assurance. The visible Technical Debt tab is the Code Health aspect of the system map, not the complete friction/refactoring-target drill-down. No reliable monetary debt estimate or development-hours estimate is supported. X-Ray tabs show no significant internal temporal coupling or structural recommendations; that does not establish independence or eliminate architectural problems. Short commit history limits confidence in change frequencies. File-level decimal scores below are from the hotspot list; rounded X-Ray numbers are not conflicting measures.

Sources:
- [Dashboard](https://codescene.io/projects/88207/jobs/8567730/results?scope=month&aspect=#code-health)
- [Hotspot Code Health](https://codescene.io/projects/88207/jobs/8567730/results/code/biomarkers)
- [Technical Debt / system map](https://codescene.io/projects/88207/jobs/8567730/results/code/technical-debt/system-map#codehealth)

## 2. Complete visible hotspot ranking (20 results)

LoC and commits are CodeScene metrics, not physical source-line counts. "types.ts" has no function/method score, not a health score of zero.

| File | Health | LoC | Commits | Recommended disposition |
|---|---:|---:|---:|---|
| lib/canonicalModel.ts | 1.84 | 1815 | 4 | P1: incremental domain/projection decomposition; first PR |
| lib/storageEngine.ts | 2.41 | 2054 | 8 | P1: separate migration/normalization, reconciliation and deletion policies only with exhaustive tests |
| lib/nlBatchEngine.ts | 2.79 | 901 | 3 | P1: grammar/validation decomposition; preserve parse precedence and ambiguity behavior |
| components/ContextualInspector.tsx | 3.97 | 1551 | 4 | P1: extract existing tabs and field controls; coordinate with Figma |
| lib/projectController.ts | 5.36 | 1258 | 6 | P1/P2: split review projection and async lifecycle boundaries |
| components/BeliefGraph.tsx | 5.37 | 926 | 4 | P1/P2: table, canvas, toolbar and interaction hooks; coordinate with redesign |
| lib/historyEngine.ts | 6.18 | 409 | 4 | P2: restore/normalize helpers after undo/redo equivalence tests |
| components/DecisionInboxPanel.tsx | 6.75 | 678 | 4 | P2: extract queue/cards and staged batch view during approved UI architecture |
| App.tsx | 6.79 | 2147 | 8 | P1/P2: orchestration hotspot; stabilize browser suite first, extract project/action hooks incrementally |
| tests/storageLifecycle.test.ts | 6.93 | 1386 | 3 | P2: consolidate test doubles only after parity characterization |
| lib/graphLayout.ts | 7.15 | 376 | 4 | P2: separate force phases, preserve geometry and benchmark |
| server/aiService.ts | 7.59 | 554 | 3 | P2: extract schemas/prompt builders and response normalization, no paid calls |
| components/OutputGallery.tsx | 7.80 | 470 | 5 | P2: split Story/Image/artifact controls and reusable focus management after browser qualification |
| tests/releaseQualification.test.ts | 7.87 | 577 | 3 | P2: shared test-double utilities; coordinate Codex browser work |
| server/routes.ts | 8.82 | 293 | 3 | P3: duplicated request flow optional; no broad router rewrite |
| components/PromptInput.tsx | 9.26 | 152 | 4 | Preserve; redesign only for approved UX |
| components/WorkspaceBottomBar.tsx | 9.27 | 156 | 4 | Preserve; responsive redesign with Figma |
| shared/schemas.ts | 9.50 | 355 | 4 | Preserve; do not loosen validation |
| tests/routes.test.ts | 10.00 | 225 | 3 | Preserve |
| shared/types.ts | N/A | N/A | 6 | Preserve contracts; no score without methods |

## 3. X-Ray interpretation and remediation work packages

Complexity below is the CodeScene function complexity metric (do not assume it is a particular standardized cyclomatic metric). Change frequency is from the function table, not file commit count. Numbers are historical snapshot readings, not post-PR scores.

### CS-01 — Canonical model (health 1.84)

Biomarkers: File Size Issue, Bumpy Road, Deep Nested Complexity, Overall Code Complexity.

| Function | Function LoC | Complexity | Change frequency |
|---|---:|---:|---:|
| mergeAnalysisIntoSnapshot | 314 | 115 | 2 |
| buildDecisionInboxFromSnapshot | 189 | 86 | 1 |
| upsertRelationship | 90 | 37 | 1 |
| setEntityAttribute | 107 | 34 | 1 |
| syncStoryBibleWithSceneEntity | 81 | 25 | 2 |

First slice: extract ordered decision inbox projection into its own module and four named phases. Keep the public canonicalModel export, one timestamp, original order, stable IDs, clarification suppression, previous statuses/proposed values, directed relationships, terminal/staged decision preservation and no input mutation. New characterization tests include resolved/skipped/outdated clarifications, case-insensitive pending coverage, excluded entities, unknown/existence attributes, relationship direction and preserved terminal items. No intended behavior change. This is genuine separation of projection concerns, not just file relocation. No code health score improvement is claimed until CodeScene reanalysis.

Remaining: decompose mergeAnalysisIntoSnapshot into matched/new entity handling, attribute merge authority, relationship matching/merge, clarification and decision reconciliation; preserve ordering, canonical IDs, explicit clears and confirmed facts, excluded entities and AI precedence. Use existing Story Bible and merge regression tests plus frozen-clock/golden characterization of complete snapshots. Split one branch at a time; do not parallel-edit overlapping code. Revisit setEntityAttribute/upsertRelationship via typed operation context only when it simplifies invariants without changing call semantics.

[Source file](https://github.com/Centaurioun/Proactive-Co-Creator/blob/3526c24fec45c60878937a331e487fc387e28d0b/lib/canonicalModel.ts)

### CS-02 — Storage engine (2.41; 8 commits; highest operational risk)

| Function | LoC | Complexity | Frequency |
|---|---:|---:|---:|
| migrateProjectPayload | 277 | 80 | 2 |
| reconcileHydratedProjects | 242 | 51 | 2 |
| verifyProjectCacheParity | 90 | 44 | 0 |
| reloadLatestProjectsFromStorage | 197 | 42 | 2 |
| normalizeMigratedEntities | 88 | 37 | 1 |
| loadProjectsFromLocalStorage | 86 | 26 | 4 |
| deleteProjectCompletely | 104 | 21 | 4 |
| evaluateCasConflict | 80 | 18 | 1 |

Split migration and normalization into pure helpers first, with complete output equivalence for legacy/v3 malformed/missing ID fixtures. Introduce explicit typed reconciliation outcomes and separate decision planning from storage effects only after two-tab, divergent equal revisions, IDB read-error, corrupt records and CAS tests. Extract deletion eligibility/strict parity policy from effects only with same-ID/different-content artifact, revision/undo divergence, tombstone quota, session restart, deletion resurrection and legacy backup tests. Keep database transaction boundaries, write acknowledgement, failure reasons and fallback semantics unchanged. Never relax content parity to reduce complexity. Do not change schema or storage keys. This is Codex work because real browser and fault-injection verification are required.

### CS-03 — Natural language batch engine (2.79)

| Function | LoC | Complexity | Frequency |
|---|---:|---:|---:|
| parseSingleClause | 424 | 73 | 1 |
| validateProposedOperations | 250 | 63 | 1 |
| applyProposedOperations | 111 | 28 | 2 |
| interpretBatchInstructionLocally | 136 | 25 | 2 |

Extract ordered clause rule handlers by operation family (entity, attribute, relationship, Story Bible). Preserve exact precedence, clause IDs, ambiguity, unhandled-clause and partial-apply behavior. Separate validation rules and dispatch with exhaustive operation coverage. Golden tests across mixed instruction sequences, ambiguity, destructive operations, wrong/stale project, missing target and invalid value. Validate preview vs actual committed change, Undo/Redo and no changes on failure. Do not make a generic NLP/LLM rewrite or silently interpret unsupported clauses.

### CS-04 — Contextual Inspector (3.97)

Main React component: 1,407 function LoC, complexity 104, frequency 3. Extract Inspector/Story Bible/Checks/History panels into testable components and narrower props, keeping state ownership explicit. Preserve IDs, validation, focus, mobile navigation, stable issue targets, project export/recovery, history and edit callbacks. Coordinate with Figma Stage 1; no speculative redesign now. First extraction candidates are read-only checks and export/history view, but only after UI contract and real E2E baseline.

### CS-05 — Project controller (5.36)

buildReviewDiffModel: 170 LoC, complexity 50; applyAsyncAnalysisCompletion: 107 LoC/10; commitBatchPreviewToProject: 119/12; validatePolishProposalAcceptance: 48/10; applyAsyncGenerationCompletion: 90/9. Start with pure review-diff row formatting and before-value resolution; keep selected operation simulation, stale proposal exclusion and actual commit equivalent. Then group request-ticket lifecycle, async completion, save queue and undoable transaction responsibilities into narrow modules with backwards-compatible exports. Do not change FIFO, CAS, stale response and deletion guards.

### CS-06 — Belief Graph (5.37)

Main component: 951 function LoC, complexity 154, frequency 3. Separate table view, graph SVG renderer, toolbar/filters and interaction/viewport logic. Preserve edge direction, parallel edges, grouping, selection, graph/table parity, keyboard, pan/zoom and fit. Avoid replacing the graph renderer or force algorithm until performance/UX evidence warrants it. Figma can determine panel placement, not canonical graph semantics.

### CS-07 — History engine (6.18)

createUndoRedoState 70 LoC/complexity 20; recordProjectRevision 55/8; normalizeSnapshotForComparison 92/4. Separate restoring persisted stacks from reconstruction of old revision histories, then label/coalesce rules. Characterize both persisted and fallback paths, revision order, empty history, future stack, semantic equality, cloning, coalescing and reload. No new history architecture.

### CS-08 — Decision Inbox (6.75)

Main component 693 LoC/complexity 73. Extract queue/filters, clarification card, attribute/relationship decision card and staged batch preview. Keep selection and selected-operation synchronization, deferred/rejected status, stale warnings, custom answers, inspect navigation, focus. Align with Figma instead of preemptively building new navigation.

### CS-09 — App orchestration (6.79, 8 commits)

Top-level context 153 LoC/complexity 13/frequency 6; handleCreateNewProject 77/4/6; handleImportProjectJson 54/6/6; handleDeleteProject 57/14/5; handleSwitchProject 48/8/5. Extract project lifecycle and persistence coordination only once real browser qualification is green. Separate request scoping and UI navigation from canonical state transitions; test rapid switching, pending writes, late acknowledgements, deletion and multi-tab conflict. No second store/state source. Do not confuse JSX length with root cause.

### CS-10 — Test infrastructure (storageLifecycle 6.93; releaseQualification 7.87)

FakeIndexedDB.open: 185 LoC/31 and 170 LoC/29 respectively. Repeated fake implementations may drift. Compare fault models before sharing helpers: transactions, oncomplete/onabort ordering, quota, unavailable/read-error and delete. Prove exact scenario parity and keep real browser E2E independent. A small reusable factory is preferable to one giant configurable fake. No replacement of assertions with source grep or reduction of coverage. Coordinate with Codex browser runner changes.

### CS-11 — Graph layout (7.15)

computeForceLayout: 232 LoC/50, frequency 2. Isolate initialization, repulsion, attraction, collision, convergence/iteration while preserving calculation order and numerical output. Use deterministic fixed seeds and existing geometry tests, 10/30/100/250 entity benchmark, view-fit and edge clipping. Stage 0 large graph prompt limit and visibility findings require separate product decisions; do not silently drop entities or change prompt semantics.

### CS-12 — AI service (7.59)

analyzeBeliefGraph 121/7; refinePromptText 92/11; generateClarificationsList 80/7; generateSingleImage 48/13. Extract prompt construction/response validation only when improving readability. Maintain request abort, retry, errors, schemas and model behavior. Mock upstream service; no paid Gemini. Public deployment quotas/auth remain separate conditional risk.

### CS-13 — Output Gallery (7.80)

OutputDisplay 460/64, frequency 3. Separate Story and Image output, version selector, metadata and lightbox. Reuse focus management only after Codex completes the browser focus issue; preserve original artifact immutability, outdated status and modal focus. No manuscript editor or new schema.

### CS-14 — Routes (8.82)

CodeScene duplication in /clarify, /refine, /analyze, /generate/story. Consider a typed common request wrapper for validation/abort/error mapping only if route-level contract tests demonstrate equivalence. Already healthy relative to most hotspots; postpone rather than optimize score. No weakening security/rate limits.

## 4. Sequencing and acceptance criteria

Phase A — this PR: narrow projection extraction + characterization tests. No direct changes to main; no automatic merge.
Phase B — finish existing Codex browser CI qualification (historical run 45300419119 failed E2E-E; 106 Node tests passed). Rebase carefully if main advances.
Phase C — independently reviewed PRs for canonical merge, NL batch parser/validation, storage migration and storage reconciliation/deletion. One bounded change at a time, with independent owner review for persistence.
Phase D — Figma-approved UI decomposition (Inspector, graph, decisions, App shell, output). Avoid doing two rewrites of the same components.
Phase E — history, shared test helpers, graph layout benchmarking and optional server cleanup.

Every work package:
- Re-read current HEAD and exact CodeScene snapshot. Record file/function scores and top biomarkers; do not assume numeric improvements.
- Characterization tests before extraction. For a pure refactor, tests should pass before and after; do NOT invent RED for an intended behavior-preserving change. For a demonstrated defect, RED→GREEN→REFACTOR.
- Preserve public API and ordered side effects. For serialization, compare exact/semantic output with known timestamp/ID normalization only where appropriate.
- Run npm ci, npm run typecheck, npm run lint, npm test, npm run build, real browser E2E and targeted edge cases (depending on scope). Inspect exact SHA and actual CI logs. Do not merge failing PRs or bypass browser gates.
- Compare CodeScene scores and hotspots after a new analysis of the same scope and commit; track new helper modules and total complexity as well as old file scores to prevent metric gaming. Aim to improve worst offenders and reduce new debt, not a guaranteed arbitrary 10/10.
- Keep UI and data contracts unchanged unless owner approves scope. Avoid paid AI calls, dependency churn, suppression/exclusion of real production code, force-push and destructive migration.

### What cannot be established from open tabs alone

Full 53-file detailed ranking, friction/debt cost, exact coupled-file identities, architecture-level trends, coverage and true user defect frequency are not exposed by these tabs. Configure CodeScene PR integration and architectural components (lib domain, storage, UI, server, tests), obtain fresh analysis and drill-down if needed. Do not fabricate values or claim a new CodeScene score. PR integration is a recommendation; do not configure accounts without owner approval.

## 5. PR implementation evidence and limits

Base source: 3526c24fec45c60878937a331e487fc387e28d0b.
Branch: refactor/codescene-decision-inbox-projection.
Changes: new lib/decisionInboxProjection.ts with ordered phases, thin canonicalModel compatibility wrapper, tests/decisionInboxProjection.test.ts. Source extraction preserves original four phase bodies verbatim and their ordering; this is structural verification, not execution. Initial source method ~189 physical lines, canonicalModel source reduced from 2005 to 1820 lines in connector read; CodeScene LoC is a different measure.
Tests added first, then refactor. No behavior defect assumed; characterization is expected green on both sides. This environment cannot resolve github.com for local git clone, so local full test execution was unavailable; tests and new score remain UNVERIFIED until actual CI/CodeScene. Do not merge until passing required gates. No change to main, UI redesign, schema, storage or AI service.

## 6. Codex handoff directive

Read this report, all current CodeScene evidence available, latest main and current PR state. First complete existing browser-qualification assignment; do not replay old commits. Review this draft PR for semantic equivalence, run its tests and integrate only after verified CI/owner review. Implement CS-01 remaining, CS-03 and CS-02 in separate small behavior-preserving PRs in the risk-controlled order above; stop and report any unverifiable behavior. Use Superpowers systematic debugging/brainstorming/writing plans, characterization-first refactoring, RED→GREEN for actual defects, six-cycle pre/post review and fresh CI. For each PR report before/after functions, metrics from actual analysis, regressions, exact SHAs and evidence. No score gaming, no broad rewrite. Keep UI work aligned with Figma and keep storage changes separately reviewable.
