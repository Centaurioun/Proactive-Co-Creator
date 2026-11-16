# Proactive Co-Creator 2.0 — Implementation Plan

**Date:** 2026-11-14

- [x] **Phase 0 — Baseline Audit & Six-Cycle Design**
  - [x] Inspect repository, run baseline 24 unit tests, document architecture and six-cycle refinement.
- [x] **Phase 1 — Complete Video Removal**
  - [x] Remove `'video'` from `GenerationMode`, `GenerationModeSchema`, `GEMINI_MODELS`, `server/aiService.ts`, `server/routes.ts`, `services/apiClient.ts`, and UI components.
  - [x] Delete `server/videoStore.ts`.
  - [x] Set `'story'` as default mode and add migration support for legacy saved projects containing `'video'`.
- [x] **Phase 2 — Canonical Creative Data Model & State Engine**
  - [x] Update `shared/types.ts` with stable IDs, provenance, `CreativeProject`, `StoryBible`, `DecisionItem`, `ProposedOperation`, `ProjectRevision`.
  - [x] Create `lib/canonicalModel.ts` with deterministic entity/relationship/attribute transactions, reanalysis merge rules preserving user authority, and legacy `BeliefState` adapters.
- [x] **Phase 3 — Decision Inbox, Clarifications 2.0 & Synchronization**
  - [x] Implement Decision Inbox operations in `lib/canonicalModel.ts` supporting single and batch Accept, Reject, Defer, Edit-before-accept, conflict detection, category/status filtering, and entity grouping.
  - [x] Implement structured Clarification question targets (`entityId`, `attributeName`, `storyField`) and refresh-safe draft preservation.
- [x] **Phase 4 — Unified Three-Panel Workspace & Belief Graph 2.0**
  - [x] Build Left Panel (`components/DecisionInboxPanel.tsx`), Center Panel (`components/BeliefGraph.tsx` 2.0 with search, category filter, focus, highlight connections, group expand/collapse, inferred toggle, and Table/List view), Right Panel (`components/ContextualInspector.tsx`), and Bottom Bar (`components/WorkspaceBottomBar.tsx`).
- [x] **Phase 5 — Natural-Language Batch Editing**
  - [x] Implement `/api/batch-edit` server route + deterministic local & AI-assisted natural-language parser (`lib/nlBatchEngine.ts`) with ambiguity detection, diff preview, per-operation toggle, and atomic undoable commit.
- [x] **Phase 6 — Story Bible, Consistency Checker & Refined Prompt Pipeline**
  - [x] Implement `lib/consistencyChecker.ts` and `lib/promptBuilder.ts` to synchronize Story Bible properties with the Belief Graph, detect contradictions/violated exclusions, and synthesize structured + freeform refined prompts.
- [x] **Phase 7 — Undo/Redo, Version History, Autosave & Export/Import**
  - [x] Implement `lib/historyEngine.ts` (short-term Undo/Redo stack + durable named `ProjectRevision` snapshots with safe non-destructive restore).
  - [x] Implement `lib/storageEngine.ts` (versioned IndexedDB + localStorage persistence, multi-project switcher, multi-tab conflict protection, JSON export/import, Markdown Story Bible export, and plain-text/Markdown prompt & story export).
- [x] **Phase 8 — Comprehensive Automated Tests & Browser Verification**
  - [x] Execute Test Groups A through L via `node:test` (32/32 tests passing) and verify UX Acceptance Scenarios in headless Chromium (`1440x900` desktop and `390x844` mobile).
