# 06 — Product decision register

Date: 2026-11-24. Living register, not a code implementation approval. Statuses: AGREED (explicit owner agreement on direction); PROPOSED (assistant recommendation or owner new idea still to refine); OPEN (decision not made); SUPERSEDED (historical approach replaced, see 07); DELEGATED (assistant-selected product default under explicit owner delegation, technical details subject to evidence). Maintain stable decision IDs; append later decisions or record status transitions with reason rather than erase earlier versions.

| ID | Status | Decision / boundary | Evidence |
|---|---|---|---|
| NI-D01 | AGREED | Import reserved for external narrative; native JSON is Backup & Restore; project operations separate from workspace, no tab-per-action requirement. Exact visual labels/layout later. | 02, 03, owner 04 |
| NI-D02 | AGREED | Persistent Evidence, Rationale, Audit; source anchors and concise explanations, deterministic JSON/MD from shared records, no fabricated evidence. | 02, 03, owner 04 |
| NI-D03 | AGREED | Faithful Reconstruction never invents/rewrites/auto-corrects story; flag and persist possible problems, review before project creation. Enhancement optional separate approval. | 02–04 |
| NI-D04 | AGREED | Multi-stage import, scope selection and optional instructions, no commit until explicit Create Project. | 02–04 |
| NI-D05 | AGREED | Issue lifecycle Open/Deferred/Needs Clarification/Proposed Fix/Resolved/Dismissed or Intentional, retain evidence and audit; defer never erases problem. | 02–04 |
| NI-D06 | AGREED | AI correction before/after review, user approval, actual recheck, audit and safe revert; in-app diff plus optional export. | 02–04 |
| NI-D07 | AGREED | Replace arbitrary 8000-character product ceiling with dynamic token/operation budget, no silent loss or unsafe unlimited request. | 02–04 |
| NI-D08 | AGREED | Descriptive export filenames and one content export center; backup separate from derived exports. | 02–04 |
| NI-D09 | AGREED | Preserve historical owner ideas, assistant recommendations and agreed decisions separately in GitHub. | 02, 04 |
| NI-D10 | AGREED | Extend Checks to on-demand AI semantic diagnostics for native and imported projects, retain deterministic auto local checks and shared persistent issue registry. | owner 04, design 05, approval 08 |
| NI-D11 | AGREED | Up to three AI fix alternatives, none/clarify/retry; no auto apply, budgeted bounded impact revalidation. | owner 04, design 05, approval 08 |
| NI-D12 | AGREED | Separate Creative Opportunities from Problems, optional user-goal-driven ideas and staged changes. | owner 04, design 05, approval 08 |
| NI-D13 | AGREED | Shared Belief Graph / Character Relationship Map / Mind Map projections with issue overlays; family tree specialized kinship view. | owner 04, design 05, approval 08 |
| NI-D14 | AGREED | Managed Create Backup independent of download, internal browser recovery vault + optional explicitly permitted external folder, portability fallback. | owner 04, design 05, approval 08 |
| NI-D15 | AGREED | Optional ZIP bundle checkbox for selected content exports, distinguish from complete restorable archive. | owner 04, design 05, approval 08 |
| NI-D16 | AGREED | Writer-focused Working Manuscript separate from immutable original and generated artifacts, coordinated with graph/Bible; no Word clone. | 03, 05, approval 08, design 09 |
| NI-D17 | DELEGATED | Retain original file bytes by default within safe budget, explicit extracted-only option; immutable source references, tested migration and transaction authority. | 08, 09 |
| NI-D18 | DELEGATED | New-project import first; existing-project append follow-on, explicit preview/revision guard; never overwrite silently. | 08, 09 |
| NI-D19 | DELEGATED | Deliver all agreed capabilities in dependency-ordered slices; manual AI default, optional consent/budget automation later, backup retention configurable after measurement; validate actual IA/limits through AI Studio previews and tests, Figma optional design review. | 08, 09 |
| NI-D20 | DELEGATED | One primary editable manuscript, optional chapter/scene/block structure with stable IDs; unstructured writing permitted; narration vs chronology separate. | 08, 09 |
| NI-D21 | DELEGATED | Text↔model sync: automatic local freshness and impact detection; explicit AI proposals, human approval, no silent bidirectional rewrite. | 08, 09 |
| NI-D22 | DELEGATED | Keep generated artifacts immutable; explicit adoption of selected output into working manuscript with provenance. | 08, 09 |
| NI-D23 | DELEGATED | Shared recoverable text/model/evidence transaction and undo/redo; version refs instead of copying entire manuscript per edit. | 08, 09 |
| NI-D24 | DELEGATED | Writing-focused lightweight editor, outline and context; choose exact editor/library, storage format and layout through tests/Figma. | 08, 09 |

Agreed directions are product decisions only. Final design/implementation plan, schema, dependency choices, specific limits and Figma layout require review. New V3 proposals are not automatically promoted to AGREED merely because owner raised them. Source: actual conversation recaps 02 and 04. No unresolved question is silently answered.

## Round 4 status transition (2026-11-24)
NI-D10–15 PROPOSED → AGREED; NI-D16 OPEN → AGREED, explicit owner acceptance 08. NI-D17–19 OPEN → DELEGATED, assistant selected defaults per owner request. NI-D20–24 added DELEGATED. Original V1–V3 records and Git history retained. No separate technical implementation approval inferred for a particular schema, library, numeric limit or merge. All accepted features targeted across stages, not all in one release.

## Round 5 delivery decision (2026-11-24)
Owner explicitly reaffirms V4, authorizes Google AI Studio-first implementation planning and broad staged prompts, followed by independent review. NI-D19 delivery grouping refined: five substantial phases instead of W1–W6; visible usable preview, safe incomplete NEW functions labeled, hard data integrity and final qualification. Existing V4 delegated defaults remain accepted. See [implementation package](../../implementation/narrative-workspace/README.md). No new implementation or merge performed in this documentation update.

## Round 6 — active baseline override
Owner round 6: use the current working main with TypeScript 5.8.3 and existing Vite 6, because Google AI Studio pulls main only. PR3/6 deferred until separate authorization after Studio development; PR1/2 unchanged. No dual compiler or dependency modernization prerequisite. Docs-only PR7 integration after main backup. Phase checkpoints published to main only after explicit owner approval. Active execution policy in docs/implementation/narrative-workspace/00-technical-preflight.md supersedes historical integration-first advice.
