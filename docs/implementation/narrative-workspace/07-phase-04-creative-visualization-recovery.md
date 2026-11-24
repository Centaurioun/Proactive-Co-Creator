# Phase 4 — Creative Intelligence, Visualization and Recovery Implementation Plan

> For agentic workers: use superpowers:executing-plans or subagent-driven-development if available; otherwise follow equivalent explicit task-by-task TDD, review and verification. Checkboxes track work, not assumed completion.

**Goal:** Complete optional creative exploration, synchronized map views and portable content/recovery features.

**Architecture:** Projections share canonical IDs/issue registry; reuse staged proposals and recovery vault, add capability-aware external destination and deterministic bundles.

**Tech stack:** existing React/TypeScript/Vite/Tailwind, Express/Gemini/Zod, IndexedDB/localStorage, existing Node tests and Chromium harness. Preserve working main toolchain; PR3/6 deferred. Do not upgrade TypeScript or Vite.

**Spec:** [consolidated spec](01-consolidated-product-spec.md), [architecture](02-architecture-and-file-map.md), [common execution protocol](03-execution-protocol.md), [preflight](00-technical-preflight.md). These are required. Each task below: characterize or RED, implement narrow behavior, GREEN, then commit/review if possible. No auto merge.


## Entry and review focus
Need prior evidence/issue/transaction and import/writing sync contracts. Stress graph cycles/large layouts, color-only warning, subjective ideas treated as facts, permission revoked and ZIP path traversal.
### P4.1 Creative Opportunities (NI-D12)
Files server/narrative/opportunityService.ts, components/opportunities/CreativeOpportunities.tsx, lib/narrative/diagnostics/opportunityRegistry.ts, tests/narrativeOpportunities.test.ts.
- [ ] Explore Improvements explicit user action scope/categories/custom goal; character arc/motivation/relationship/plot/stakes/pacing/themes/foreshadow/setup-payoff/worldbuilding/voice/style. Structured candidate reason/source/benefit/tradeoff/assumption and relevance, no made-up scores or unasked canonical facts. Distinct from diagnostics and faithful import. Save idea/defer/dismiss/none/alternatives/stage proposal via existing approval, never auto apply. Avoid duplicate already accepted ideas, stale on changed basis. Tests no graph mutation on exploration, respect exclusions, intentional ambiguity, pending vs confirmed, accept only via transaction.
### P4.2 Shared maps and timeline (NI-D13/20)
Files lib/narrative/projections/{relationshipProjection,mindMapProjection,timelineProjection,issueOverlay}.ts, components/visualization/{GraphViewSwitcher,CharacterRelationshipMap,FamilyView,NarrativeMindMap,TimelineView}.tsx; reuse BeliefGraph/graphLayout; tests/narrativeProjections.test.ts.
- [ ] Character relationship filter/ego-network, direction and supported labels, specialized family view only verified kinship, no forced tree (cycles/step/adoption), shared IDs. Mind map topics/plot/world/themes/characters, grouping/layout not factual causality, inferred/pending labeled. Timeline separates story chronology and narration order, uncertain/relative times and flashbacks, no invented dates. No independent graph stores. 
- [ ] Issue overlay from single registry, same issue ID and count, target-specific warning icon+label+color, details and keyboard navigation, accessible table, status/freshness/pending filters, preserve zoom/selection/layout across nonstructural changes. Updates after edit/undo/restore without AI. Test relation direction, cycle, no orphan refs, graph/model consistency, missing target history, intentional/dismissed vs open, cross-view click/keyboard. Measure 10/30/100/250+ graph/filtered ego responsiveness against existing baseline, virtualize/filter if needed. 
### P4.3 Export Center and external managed recovery (NI-D08/14/15/17)
Files lib/narrative/recovery/{bundleExporter,externalBackupAdapter,retentionPolicy,restorePreview}.ts, components/recovery/{ExportCenter,BackupRestoreCenter,BackupPreferences}.tsx, tests/narrativeExport.test.ts, narrativeExternalRecovery.test.ts.
- [ ] Optional ZIP checkbox for selected documents + manifest, deterministic MD/JSON shared evidence, original retained bytes/extracted/working/generated distinction, selected scenes/chapter/full, TXT/MD and DOCX supported formatting, actual MIME/extension, safe names. Content ZIP not declared full backup; separate complete recoverable archive. Verify archive manifest/digests, unsafe path, zip bomb/decompression limits, duplicates, no secret or external URL, parity and roundtrip. Document DOCX not pixel-perfect Word.
- [ ] Capability detect File System Access secure context + permission; Choose Folder explicit user activation, suggested visible Documents/Proactive-Co-Creator/Backups but never arbitrary path. Create Backup without download to internal/selected external/both, readback verify, honest per-destination status; permission revoked/unsupported/AI Studio iframe fallback portable download, do not promise background writes. Current + all-project archive scope, non-secret settings optional, collision remap and manifest. Pin/retention configurable, dedup, protect last verified, auto recovery while running opt-in/major operation checkpoint; no silent purge. Test quota/permission/partial crash, all-project isolation, backup/delete/privacy behavior, invalid archive, restore with manuscript/source/registry/history/undo. Real external-folder test only supported actual browser, otherwise BLOCKED with fallback verified. 
   
## Phase gate
Visible map switcher + issue overlay, relationship/family/mind/timeline projections from real committed state, optional opportunities with mock AI and approval, content export individual vs ZIP, internal backup/all-project and external supported or honest fallback. Existing behavior preserved and browser/layout checks. Complete common gates, handoff/phase-04.md; stop.
