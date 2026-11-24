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
| EVO-09 | Import-only consistency analysis | Project-wide Diagnostics, auto local / user-initiated AI and bounded revalidation | User and AI edits also introduce contradictions | Proposed NI-D10 |
| EVO-10 | One AI fix suggestion | Up to 3 distinct choices, none and retry with guidance, no forced choice | Author authority and options without invented filler | Proposed NI-D11 |
| EVO-11 | Treat possible improvements as issues | Creative Opportunities distinct from Problems | Artistic preference is not factual error | Proposed NI-D12 |
| EVO-12 | Independent mind map/family tree | Shared graph projections and issue overlay; kinship-only tree | Avoid data divergence and false relationships | Proposed NI-D13 |
| EVO-13 | Export backup as only explicit recovery action | Managed Create Backup vs Export Backup; internal vault + optional authorized folder | Recovery without download, browser storage risk visible | Proposed NI-D14 |
| EVO-14 | Export each selected report separately | Optional ZIP selected outputs; complete backup distinct | Convenience, preserve semantic distinction | Proposed NI-D15 |

Append next round's change entries and decision status transitions. Do not revise old brainstorming as if later owner approval existed earlier. Actual product code is unchanged by these records.
