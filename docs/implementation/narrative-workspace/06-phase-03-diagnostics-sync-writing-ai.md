# Phase 3 — Narrative Diagnostics, Synchronization and AI Writing Implementation Plan

> For agentic workers: use superpowers:executing-plans or subagent-driven-development if available; otherwise follow equivalent explicit task-by-task TDD, review and verification. Checkboxes track work, not assumed completion.

**Goal:** Enable project-wide analysis, safe corrections and AI-assisted prose editing across native and imported projects.

**Architecture:** Reuse common issue/evidence registries and proposal/transaction authority; automatic local freshness, explicit semantic AI, no silent rewrite.

**Tech stack:** existing React/TypeScript/Vite/Tailwind, Express/Gemini/Zod, IndexedDB/localStorage, existing Node tests and Chromium harness. Preserve qualified dual compiler after integration.

**Spec:** [consolidated spec](01-consolidated-product-spec.md), [architecture](02-architecture-and-file-map.md), [common execution protocol](03-execution-protocol.md), [preflight](00-technical-preflight.md). These are required. Each task below: characterize or RED, implement narrow behavior, GREEN, then commit/review if possible. No auto merge.


## Entry and review focus
Read phase1/2 handoff, require stable anchors/versions and budget enforcement. Stress false temporal contradictions, repeated findings, late AI against edited scene, two-domain apply failure, deliberate mystery. 
### P3.1 Persistent diagnostics and impact (NI-D05/10/21)
Files lib/consistencyChecker.ts, lib/narrative/{issueRegistry,impactIndex}.ts, lib/narrative/diagnostics/findings.ts, server/narrative/diagnosticService.ts, components/diagnostics/{DiagnosticsPanel,IssueDetail}.tsx, services/apiClient.ts, server/routes.ts, tests/narrativeDiagnostics.test.ts.
- [ ] Characterize existing local checks (readiness separate; English lexical heuristic not universal). Extend deterministic structural rules, temporal scoped contradictions only when modeled. Auto on committed snapshot, no network per keystroke. Stable fingerprint type+targets+scope, preserve dispositions, dedupe across runs, retain deferred. Local vs AI certainty/severity/freshness separate; no false resolved if omitted from partial run. 
- [ ] Analyze Consistency quick/local, focused/changed-since/full AI with scope/current revision/coverage, explicit click, budget. Structured findings evidence from original/working/artifact/canonical fields, attribution, not fake manuscript for native projects; possible vs confirmed. Stable navigation to affected graph/scene/Bible. Reconcile late/stale/cancel without mutation. 
- [ ] Bounded impact index with visited set, typed dependency and changed source/field digests; unrelated edits not necessarily stale, no graph neighbor propagation as truth. Revalidate local rules, mark semantic findings stale; meaningful recurrence reopens, intentional/dismissed remains audit. Tests repeated issue, same label different time, cyclic graph, Turkish and unreliable narrator, partial scan, deferred count/reopen.
### P3.2 Suggest Fixes and evidence-aware diff (NI-D06/11)
Files server/narrative/fixService.ts, lib/narrative/diagnostics/fixProposal.ts, components/diagnostics/{FixAlternatives,ChangeReview}.tsx, components/evidence/{EvidenceViewer,AuditView}.tsx, tests/narrativeFixes.test.ts.
- [ ] Up to 3 materially distinct validated solutions, none/clarify/add guidance/regenerate with bounded calls; not mandatory 3. Each option reason/assumptions/impact/source/target/base digest/exact before-after; model output proposal only. Reject unknown/unsafe operations, invalid anchor, out-of-scope text. Safe in-app diff with red/green +/- and strike/accessible descriptions, no raw HTML. Pending no canonical effect; no automatic selection. 
- [ ] Explicit apply one selected option via transaction, stale re-preview; recheck affected scope and retain residuals; graph-only repair not manuscript fixed. Resolved after verified actual condition or clarification, record rationale/status, audit and revert with precondition (compensating undo) and re-open if condition returns. Tests none preserves state, retry not new revision, stale selection, fault injection during multi-domain apply, resolved/reopened audit/JSON/MD parity. 
### P3.3 Working Manuscript ↔ model synchronization (NI-D16/21/23)
Files lib/narrative/diagnostics/syncProposal.ts, server/narrative/syncService.ts, components/manuscript/ManuscriptSyncPanel.tsx, tests/manuscriptSync.test.ts.
- [ ] Text edit automatically invalidates dependent evidence/freshness, local check; Analyze Changes/Scene/Manuscript explicitly produces candidate additions/corrections/ambiguities, not deleting claim because absent; accept eligible facts or defer. Example cousin relation added, retains childhood friend; approved model update with source anchor.
- [ ] Model change marks linked passages possible mismatch; Sync Manuscript proposes targeted text updates/revert/clarification/intentional/defer, never blind global replacement. Age 28 vs 32 across years may both true. Exact old span/block digest, preserve unrelated paragraphs/voice, original untouched. Apply only approved patch with atomic text/model/audit; reject stale or partial; show pending sync count, last reviewed scope/revision, no false globally synchronized claim. 
- [ ] Enable Reconstruct & Enhance distinct reviewed changes after faithful extraction; faithful cannot request creative fixes inside import, allow post-import explicit editing. Test mode invariant and import issues retained, target kind visible, revert and recheck. 
### P3.4 AI Writing Assistant (NI-D16/22/24)
Files server/narrative/writingService.ts, components/manuscript/{WritingAssistant,WritingProposalReview}.tsx, lib/narrative/diagnostics/textPatch.ts, tests/narrativeWritingAssistant.test.ts.
- [ ] Scope selected text/scene, custom instruction, continue/rewrite/clarity/shorten/expand/dialogue/alternatives, relevant confirmed context/token budget. Show preview and exact target with before/after; Replace Selection, Insert After, New Scene, Keep Alternative; no automatic insertion, artifact original unchanged, no edit outside scope. Store optional alternatives with provenance, no unrelated revision spam. Respect author exclusions and pending facts. 
- [ ] Test Unicode selections/changed selection/stale revision, AI unconfigured, no change on cancel/none, user edits while request in flight, one durable approved revision, undo/restore, old image/story generation unaffected. 
   
## Phase gate
Visible Diagnostics for native/imported stories, analyze mock AI on explicit click, issue persisted/deferred/reopened, up to3 options choose none or approve diff, text->graph and graph->text exact proposal, AI writing proposal reject/apply, reload/backup and undo proof. Use source anchored synthetic fixtures; record real provider NOT TESTED unless approved separately. Full common checks and new browser journey, handoff/phase-03.md; stop.
