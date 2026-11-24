# Intelligent Narrative Import — product discovery archive

Date: 2026-11-24. Status: **DISCOVERY / PROPOSED — not implementation-approved**.

Purpose: preserve the original brainstorming, owner feedback and subsequent refinement separately, so later design/engineering does not lose earlier decisions or silently turn ideas into requirements. These are structured records of the discussion, not a verbatim chat transcript. All examples are illustrative, not AI quality measurements.

| Record | Scope |
|---|---|
| [01 — Initial brainstorming](01-initial-brainstorming.md) | V1 feature hypothesis, alternatives, original six-cycle review, scope and dependencies |
| [02 — Owner feedback](02-owner-feedback.md) | User's follow-up ideas, preferences, unresolved questions and intent |
| [03 — Refined design proposal](03-refined-design-v2.md) | V2 six-cycle review, recommended UX/data contracts, issue lifecycle, scope and acceptance gates |

Source baseline reviewed: `0b34d01fb0feb0e73655291f572e370fd95e0fe4` (Stage 0 and independent CodeScene audit integrated). This archive is intentionally independent of the active dependency and TypeScript modernization PRs.

Related: [Stage 0 execution plan](../../modernization/2026-11-24-stage-0-product-ux-technical-baseline-execution-plan.md), [CodeScene independent audit](../../modernization/2026-11-24-codescene-independent-audit.md), [Figma handoff](../../ux-baseline/figma-handoff.md).

Workflow: refine and approve product decisions first; then create an approved design specification, separately reviewable implementation plan, Figma flows and test-first implementation PRs. Do not change application code, schema, dependencies, live AI providers or deployment during this discovery task. Existing import/export and data safety behavior must be preserved. No automatic merge.

Future discovery records should be appended as numbered files and linked here. Keep owner ideas separate from accepted decisions and mark superseded proposals explicitly instead of erasing history.
