# Proactive Co-Creator 2.0 — Comprehensive Test Plan & Coverage Matrix

## 1. Test Groups (A–L)

| Group | Focus Area | Test File | Status |
|---|---|---|---|
| **Group A** | Video Removal & Legacy `'video'` Project Migration | `tests/proactiveCoCreator2.test.ts`, `tests/routes.test.ts`, `tests/schemas.test.ts`, `tests/graphLayout.test.ts` | **PASS** |
| **Group B** | Canonical Data Model, Stable IDs, Entity Rename, Exclusions & User Authority on Reanalysis | `tests/proactiveCoCreator2.test.ts` | **PASS** |
| **Group C** | Decision Inbox Single & Batch Operations (`Accept`, `Reject`, `Defer`) & Atomic Conflict Rejection | `tests/proactiveCoCreator2.test.ts` | **PASS** |
| **Group D** | Clarifications 2.0 Structured Targets (`story_bible`, `entity_attribute`) & Refresh Deduplication | `tests/proactiveCoCreator2.test.ts`, `tests/schemas.test.ts` | **PASS** |
| **Group E** | Belief Graph 2.0 Layout, Entity Category Inference, Add/Remove Entity & Relationship Integrity | `tests/graphLayout.test.ts`, `tests/proactiveCoCreator2.test.ts` | **PASS** |
| **Group F** | Natural-Language Batch Editing (Group Ops, Exceptions, Pronoun Ambiguity, Partial Checkbox Apply) | `tests/proactiveCoCreator2.test.ts`, `tests/routes.test.ts` | **PASS** |
| **Group G** | Deterministic Consistency Checker (`violated_exclusion`, `trait_conflict`, `setting_conflict`) | `tests/proactiveCoCreator2.test.ts` | **PASS** |
| **Group H** | Undo/Redo Stack, Redo Branch Invalidation on New Edit & Non-Destructive Revision Restore | `tests/proactiveCoCreator2.test.ts` | **PASS** |
| **Group I** | LocalStorage Persistence, Quota Fallback & Multi-Tab Overwrite Conflict Detection | `tests/proactiveCoCreator2.test.ts` | **PASS** |
| **Group J** | Full Project JSON Export/Import Round-Trip, Malformed Input Rejection & Story Bible Markdown Export | `tests/proactiveCoCreator2.test.ts` | **PASS** |
| **Group K** | Story & Image Generation Route Contracts, Error Classification & Retry/Backoff | `tests/routes.test.ts`, `tests/retryAndErrors.test.ts` | **PASS** |
| **Group L** | End-to-End UX Scenarios 1–8 on `"A cat hosting a party for its animal friends..."` | `tests/proactiveCoCreator2.test.ts` + Playwright Browser Verification | **PASS** |

## 2. Execution Command

```bash
npm test
# Runs: tsx --test tests/*.test.ts (32 tests across 7 suites)
```
