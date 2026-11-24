# P1/P2 Epistemic and `other` Remediation Plan

> **For Codex:** REQUIRED SUB-SKILL: Use superpowers:test-driven-development; execute tasks in order and verify each red/green cycle.

**Goal:** Preserve imported epistemic provenance and safely gate provider prompts; retain complete-scope unclassified findings (`other`) through review and durable recovery.

**Architecture:** Add optional strict-schema `epistemicKind` metadata to proposals, claims, and canonical imported fields; propagate it only from verified extraction. Keep author edits as distinct authored claims. Add a scoped prompt-context decision at every AI provider boundary, preserving old prompt text and blocking dependent requests when required imported context is unknown. Pass explicit import scope into filtering so complete scope retains `other`; deduplicate before counts and persistence.

**Tech Stack:** Existing React, TypeScript 5.8, Zod 4, Vite 6, Node test runner; no upgrades or live provider requests.

## Tasks

1. **Contracts and imported provenance (TDD):** Add tests for epistemic enum schema, extraction-to-assembly propagation for all proposal classes, unknown/invalid legacy migration, and source evidence retention. Implement only fields and mappings needed by those tests.
2. **Author edit transition (TDD):** Test changed-value and no-op edit behavior. Preserve source claim/evidence, create a user-authored claim for changed values, and ensure only the authored current value is eligible under explicit prompt policy.
3. **Safe provider context (TDD):** Test story and image synthesized prompts, stored legacy prompt preservation, dependent-operation blocking, independent operations, and actual mocked provider arguments at callers. Route all story/image provider submissions through one safe context decision; never call real providers.
4. **Complete-scope `other` (TDD):** Test complete/selective scope filter, server chunk path, overlap/retry dedup identity/counts, review warning/count, and assembly without fallback projection.
5. **Durable roundtrip (TDD):** Test schema-4 migration/load, portable backup verification/reload and imported attributes/`other` preservation, including invalid enum rejection and no inferred chronology or negative evidence from partial analysis.
6. **Six-cycle review and qualification:** Cycle 1 scope/ownership; 2 shared contracts; 3 evidence/class preservation; 4 migration/recovery; 5 provider/UI behavior; 6 integrated local qualification. Run targeted suites after each slice, then full tests/typecheck/lint/build. Record exact base/head, diff, evidence and unresolved scope in the private report; request independent QUAL review.
