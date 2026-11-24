# 04 — Owner feedback after V2 (round 3)

Date: 2026-11-24. Structured record of the owner's actual feedback, not verbatim transcript. Separate accepted decisions from new proposals. Continued brainstorming, not authorization to implement or merge.

## Explicit agreement with V2
- Accept separation of creative workspace and project lifecycle: Import Story, Export, Backup & Restore, rather than one tab per operation. Assistant can choose sensible placement, later design work determines exact layout.
- Accept Evidence, Rationale and Audit concept, persistent inconsistency management, Open/Deferred/Dismissed and other V2 lifecycle states.
- Accept reviewed AI fix flow and before/after red/green diff, visible in application, not only downloaded reports. Change history retains changes.
- Accept staged import flow, replacement of arbitrary 8000-character prompt limit with appropriate token budgets/safeguards, standardized filenames and single export center.
- Accept preserving prior design records in GitHub.

## New ideas to evaluate
1. Inconsistency analysis for ANY story, not just imported stories. User or AI edits may create conflicts. Provide on-demand Analyze action in a suitable Checks/diagnostics area. Show affected items, relationships and evidence. User can request check at any time. Re-evaluate related/dependent items after detection or subsequent edits; owner asks about automatic/recursive behavior.
2. Improvement analysis: proactively discover potential story improvements the user may not have considered, suggest plot/character/relationship ideas; separate from mere detection of errors. Exact placement and content to be brainstormed.
3. Mind map and relationship visualization: not necessarily family tree; general characters and their relations, including imported and native-created stories. Update automatically as project changes. Show relevant detected issues in views, red or similar warning treatment, with linked explanation below. Related/recursive impacts should be discoverable.
4. In issue detail, add AI suggestion action. Offer about three alternative solutions, choose one or none; allow asking again for alternatives. User not required to accept. Existing Review Later, Needs Clarification, Intentional, before/after review remain. User wants visually clear removed/added changes in app, not export-only.
5. Backup without manual export: ordinary user can press Backup to keep recovery copy without sending/copying a file. Provide separate Export Backup for portability. Consider persistent backup location (Documents/Proactive Co-Creator or hidden home/app directory), user-selected folder where appropriate; owner explicitly uncertain which storage architecture is best.
6. Export center should allow selected files to be bundled in ZIP via optional checkbox rather than mandatory ZIP.
7. Keep saving both owner ideas and assistant proposals, plus a separate agreed-decision register and change/supersession history (earlier idea → revised decision → reason). Avoid losing ideas and repeated discussion.

## Still open
Original versus working manuscript editing extent (V2 closing question not explicitly answered). Automatic AI checking policy, backup platform and retention, exact visual navigation, phase boundaries, and detailed implementation remain design decisions. No new source code, dependency, schema, live AI call or file-system access authorized by this brainstorming request.
