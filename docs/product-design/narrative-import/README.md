# Intelligent Narrative Import — product discovery archive

Date: 2026-11-24. Status: **DISCOVERY / PROPOSED — not implementation-approved**.

Purpose: preserve the original brainstorming, owner feedback and subsequent refinement separately, so later design/engineering does not lose earlier decisions or silently turn ideas into requirements. These are structured records of the discussion, not a verbatim chat transcript. All examples are illustrative, not AI quality measurements.

| Record | Scope |
|---|---|
| [01 — Initial brainstorming](01-initial-brainstorming.md) | V1 feature hypothesis, alternatives, original six-cycle review, scope and dependencies |
| [02 — Owner feedback](02-owner-feedback.md) | User's follow-up ideas, preferences, unresolved questions and intent |
| [03 — Refined design proposal](03-refined-design-v2.md) | V2 six-cycle review, recommended UX/data contracts, issue lifecycle, scope and acceptance gates |
| [04 — Owner feedback round 3](04-owner-feedback-v3.md) | V2 agreements, new diagnostics/opportunities/maps/backup ideas |
| [05 — Refined design V3](05-refined-design-v3.md) | Continuous narrative intelligence, issue resolution, visualizations, recovery, six-cycle review |
| [06 — Decision register](06-decision-register.md) | Agreed, proposed and open decisions with stable IDs |
| [07 — Design evolution log](07-design-evolution-log.md) | Earlier idea → revised direction, reason and status |
| [08 — Owner approval & delegation](08-owner-approval-v4.md) | Explicit V3 agreement and delegated V4 decisions |
| [09 — Refined design V4](09-working-manuscript-design-v4.md) | Writer-focused editor, chapters/scenes, synchronization, six-cycle review and staged delivery |

Source baseline reviewed: `0b34d01fb0feb0e73655291f572e370fd95e0fe4` (Stage 0 and independent CodeScene audit integrated). This archive is intentionally independent of the active dependency and TypeScript modernization PRs.

Related: [Stage 0 execution plan](../../modernization/2026-11-24-stage-0-product-ux-technical-baseline-execution-plan.md), [CodeScene independent audit](../../modernization/2026-11-24-codescene-independent-audit.md), [Figma handoff](../../ux-baseline/figma-handoff.md).

Workflow: refine and approve product decisions first; then create an approved design specification, separately reviewable implementation plan, Figma flows and test-first implementation PRs. Do not change application code, schema, dependencies, live AI providers or deployment during this discovery task. Existing import/export and data safety behavior must be preserved. No automatic merge.

Future discovery records should be appended as numbered files and linked here. Keep owner ideas separate from accepted decisions and mark superseded proposals explicitly instead of erasing history.

V3 extends the archive beyond import to ongoing narrative diagnostics, creative opportunities, visualization and backup/recovery. The decision register is the current review reference; the evolution log explains changes without erasing history. V3 directions accepted in round 4; see 08 and updated register. V4 detailed defaults chosen under explicit owner delegation; implementation remains staged and unstarted.

## Round 5 — execution handoff
Owner accepted V4 and requests Google AI Studio first in substantial stages, followed by independent review. [Consolidated implementation package](../../implementation/narrative-workspace/README.md) replaces W1–W6 grouping with five phases, preserving all decisions and prior archive. Technical integration/hosted preflight required. No production code changed in this documentation PR.

## Round 6 — active baseline override
Owner round 6: use the current working main with TypeScript 5.8.3 and existing Vite 6, because Google AI Studio pulls main only. PR3/6 deferred until separate authorization after Studio development; PR1/2 unchanged. No dual compiler or dependency modernization prerequisite. Docs-only PR7 integration after main backup. Phase checkpoints published to main only after explicit owner approval. Active execution policy in docs/implementation/narrative-workspace/00-technical-preflight.md supersedes historical integration-first advice.
