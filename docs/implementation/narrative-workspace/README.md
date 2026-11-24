# Proactive Co-Creator — Google AI Studio staged implementation

**Status:** approved product direction / prepared implementation plan / code not started. Date 2026-11-24. The 5 large phases replace earlier W1–W6 delivery grouping, not the agreed product scope. Owner requests Google AI Studio to implement first, followed by independent Codex/ChatGPT qualification. Use working main; PR3/6 intentionally deferred; see preflight. This folder is the working source of instructions, discovery archive remains historical. 
   
## Read before executing
1. [00 Technical preflight](00-technical-preflight.md) — historical PR3/6 review and current-main hosted gate.
2. [01 Consolidated product spec](01-consolidated-product-spec.md) — all approved capabilities and invariants.
3. [02 Architecture and file map](02-architecture-and-file-map.md) — existing vs target paths, shared contracts, authority.
4. [03 Execution protocol](03-execution-protocol.md) — mandatory preview, data safety, tests and handoff.
5. [Coverage matrix](09-requirements-coverage.md), [six-cycle review](10-six-cycle-review.md).

| Phase | Assigned file | Visible outcome |
|---|---|---|
| 1 | [Foundation & Writing Workspace](04-phase-01-foundation-writing.md) | actual manual manuscript + safe storage, Write/Plan/Review, backup/export baseline |
| 2 | [Intelligent Import](05-phase-02-intelligent-import.md) | paste/TXT/MD/DOCX, faithful analysis/review, source evidence, long-text budgets |
| 3 | [Narrative Diagnostics & Sync](06-phase-03-diagnostics-sync-writing-ai.md) | project-wide checks, fix alternatives, before/after, text↔graph sync and AI writing |
| 4 | [Creative Intelligence & Recovery](07-phase-04-creative-visualization-recovery.md) | opportunities, relationship/family/mind/timeline, ZIP and external backup |
| 5 | [Advanced & Qualification](08-phase-05-advanced-qualification.md) | append/PDF/EPUB/style/optional auto, comprehensive verification and defect fixes |

Do one phase at a time. No tiny separate user prompts for internal tasks. Each phase creates handoff/phase-0N.md with exact changes/evidence and stops. Next phase reads actual prior handoff and starts from its reviewed tree. If AI Studio cannot push or select branches, export workspace and get independent reviewer to publish a phase PR; don't overwrite main. Do not call any phase done without evidence. Owner tolerates unfinished new controls in preview if clearly labeled, not loss of data or broken app shell. No production auto merge. 
   
## Short prompts (one per stage, English instructions, Turkish final report)
Phase 1: Read this README, 00,01,02,03 and 04-phase-01-foundation-writing.md plus linked coverage/review and relevant source. Verify current main and hosted preview first. Preserve current toolchain; do not integrate deferred PRs. Implement Phase 1 ONLY, not just a plan. Preserve existing behavior/data; apply test-first task groups and six-cycle refinement. Keep app visibly usable in AI Studio, clearly label unfinished future features, never fake persistence/AI/test results. Produce actual phase-01 handoff and Turkish report; stop.
   
For phases 2–5 use same instruction replacing assigned phase file and phase number, read ALL previous handoffs and reconcile blockers. Do not send all five at once. If docs not in Studio filesystem, synchronize exact docs from PR7 after integration or upload files; do not rely on reading a URL the environment can't access. 
   
Historical documents: [discovery index](../../product-design/narrative-import/README.md). Final approval and delegated scope: [decision register](../../product-design/narrative-import/06-decision-register.md). Stage0 baseline: [Figma handoff](../../ux-baseline/figma-handoff.md); [Stage0 report](../../modernization/stage-0-execution-report.md); [CodeScene independent audit](../../modernization/2026-11-24-codescene-independent-audit.md).

## Active baseline override

Round 6 owner override (2026-11-24): Google AI Studio pulls main only. Use current working main, TypeScript 5.8.3 and existing Vite 6 toolchain. PR #3 and #6 intentionally DEFERRED until after Studio development and separate owner authorization. PR #2 and #1 remain untouched, not prerequisites. No TypeScript/Vite upgrades, dual compiler scripts, or deferred PR cherry-picks during phases. Feature-specific dependencies only if necessary, compatible and verified. Hosted compatibility of deferred upgrades is untested; current preview works per owner.
This supersedes any earlier integration-first/dual compiler instructions. Use existing main scripts; see 00-technical-preflight.md.
