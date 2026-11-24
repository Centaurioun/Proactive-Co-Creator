# 07 — Design evolution and supersession log

Date: 2026-11-24. This file records design history, not application revision history. Original records 01–05 remain intact. Status “superseded” applies to earlier proposal, not deleted feature or existing production code. IDs reference 06 decision register.

| Change | Earlier idea | Revised direction | Reason | Status |
|---|---|---|---|---|
| EVO-01 | Existing JSON Import label shared with new story import | Import Story vs Restore Project Backup, distinct Export and project management | Different semantics, no AI in native restoration | Agreed NI-D01 |
| EVO-02 | Add separate top-level tabs for each function | Separate project hub/actions from creative workspace; exact grouping later | Avoid desktop/mobile clutter | Agreed NI-D01 |
| EVO-03 | Justification tab and AI-generated JSON/Markdown files | Evidence/Rationale/Audit shared registry, deterministic export views | Avoid divergence, preserve source and user authority | Agreed NI-D02 |
| EVO-04 | Faithful/Enhance/Selective as exclusive strategy radios | Faithful vs optional Enhance, scope Full vs Selective independent | Selection and modification policy orthogonal | V2 proposed design under agreed NI-D03/04 |
| EVO-05 | Ignore or skip inconsistency | Defer retains unresolved; intentional/dismissed separate; resolve with audit/reopen | Do not lose issues or confuse deliberate narrative choices | Agreed NI-D05 |
| EVO-06 | AI fixes during import | Faithful flags only; enhancement/post-import explicit proposed change, before/after and verification | Preserve original, no silent creative authority | Agreed NI-D03/06 |
| EVO-07 | Fixed 8000 chars or unlimited requests | Token-aware operation budget and chunk coverage, local text preservation | Provider limits, cost, server body and storage safety | Agreed NI-D07 |
| EVO-08 | Generic filenames, export mixed with history | Descriptive revision/time filenames, content export center; backup separate | Discoverability and reproducibility | Agreed NI-D08 |
| EVO-09 | Import-only consistency analysis | Project-wide Diagnostics, auto local / user-initiated AI and bounded revalidation | User and AI edits also introduce contradictions | Agreed NI-D10 (round 4) |
| EVO-10 | One AI fix suggestion | Up to 3 distinct choices, none and retry with guidance, no forced choice | Author authority and options without invented filler | Agreed NI-D11 (round 4) |
| EVO-11 | Treat possible improvements as issues | Creative Opportunities distinct from Problems | Artistic preference is not factual error | Agreed NI-D12 (round 4) |
| EVO-12 | Independent mind map/family tree | Shared graph projections and issue overlay; kinship-only tree | Avoid data divergence and false relationships | Agreed NI-D13 (round 4) |
| EVO-13 | Export backup as only explicit recovery action | Managed Create Backup vs Export Backup; internal vault + optional authorized folder | Recovery without download, browser storage risk visible | Agreed NI-D14 (round 4) |
| EVO-14 | Export each selected report separately | Optional ZIP selected outputs; complete backup distinct | Convenience, preserve semantic distinction | Agreed NI-D15 (round 4) |

Append next round's change entries and decision status transitions. Do not revise old brainstorming as if later owner approval existed earlier. Actual product code is unchanged by these records.

## Round 4 — owner acceptance and delegated design

| Change | Earlier idea | Revised direction | Reason | Status |
|---|---|---|---|---|
| EVO-15 | Working Manuscript optional or unresolved | Dedicated editable working copy alongside source and generated artifacts | Editing the actual story is central, preserve historical evidence | Agreed NI-D16 |
| EVO-16 | Original byte retention undecided | Bounded original bytes default, explicit extracted-only option | Faithful recovery without invisible loss | Delegated NI-D17 |
| EVO-17 | First-release append unresolved | New project first, safe existing-project append later | Avoid unsafe overwrite and manage MVP complexity | Delegated NI-D18 |
| EVO-18 | Story text as generated output or unstructured whole-document edit | Versioned optional chapters/scenes/blocks; writing-focused editor | Stable evidence, manageable long works | Delegated NI-D20/24 |
| EVO-19 | Automatic recursive/bidirectional synchronization | Automatic detection, explicit scoped change proposals and approved transactions | Prevent AI feedback loops and silent rewriting | Delegated NI-D21/23 |
| EVO-20 | AI generation directly becomes manuscript | Explicit adopt/append/replace with preview, original artifact retained | Preserve alternatives and provenance | Delegated NI-D22 |
| EVO-21 | All approved features delivered together | Dependency-ordered slices W1–W6; retain all accepted scope | Protect data, reduce rework, preserve testable baseline | Delegated NI-D19 |

Status transitions reflect owner round 4, not retroactive approval at V3. See 08 and 09.
