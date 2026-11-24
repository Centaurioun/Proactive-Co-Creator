# 06 — Product decision register

Date: 2026-11-24. Living register, not a code implementation approval. Statuses: AGREED (explicit owner agreement on direction); PROPOSED (assistant recommendation or owner new idea still to refine); OPEN (decision not made); SUPERSEDED (historical approach replaced, see 07). Maintain stable decision IDs; append later decisions or record status transitions with reason rather than erase earlier versions.

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
| NI-D10 | PROPOSED | Extend Checks to on-demand AI semantic diagnostics for native and imported projects, retain deterministic auto local checks and shared persistent issue registry. | owner 04, design 05 |
| NI-D11 | PROPOSED | Up to three AI fix alternatives, none/clarify/retry; no auto apply, budgeted bounded impact revalidation. | owner 04, design 05 |
| NI-D12 | PROPOSED | Separate Creative Opportunities from Problems, optional user-goal-driven ideas and staged changes. | owner 04, design 05 |
| NI-D13 | PROPOSED | Shared Belief Graph / Character Relationship Map / Mind Map projections with issue overlays; family tree specialized kinship view. | owner 04, design 05 |
| NI-D14 | PROPOSED | Managed Create Backup independent of download, internal browser recovery vault + optional explicitly permitted external folder, portability fallback. | owner 04, design 05 |
| NI-D15 | PROPOSED | Optional ZIP bundle checkbox for selected content exports, distinguish from complete restorable archive. | owner 04, design 05 |
| NI-D16 | OPEN | Working Manuscript editor vs structured project/derived versions; exact targets of prose edits. | 03, 05 |
| NI-D17 | OPEN | Original source byte retention and extracted text policy, schema migration and source-store authority. | 03, 05 |
| NI-D18 | OPEN | Existing-project append in first release or later; revision/CAS semantics. | 01, 03 |
| NI-D19 | OPEN | Exact V3 release scope, visual IA/Figma, backup retention/auto schedule/location, optional auto AI consent/cost. | 05 |

Agreed directions are product decisions only. Final design/implementation plan, schema, dependency choices, specific limits and Figma layout require review. New V3 proposals are not automatically promoted to AGREED merely because owner raised them. Source: actual conversation recaps 02 and 04. No unresolved question is silently answered.
