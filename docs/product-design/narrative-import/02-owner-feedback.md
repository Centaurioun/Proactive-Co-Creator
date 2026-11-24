# 02 — Owner feedback after V1 brainstorming

Date: 2026-11-24. Structured preservation of the owner's follow-up, NOT a verbatim transcript and NOT a list of irrevocable requirements. The owner explicitly says these are ideas being discussed, not laws; analyze and improve them.

## A. Evidence, justification and traceability
- Strongly agrees Source Evidence Viewer is essential. For a relation such as Leyla — childhood friend of — Murat, show why it was extracted and the actual text location (chapter/paragraph when available; direct source excerpt/location otherwise).
- Save justifications during import, not only display them temporarily. The user wants a separate accessible tab/area (working name Justification) for concise explanation of important extracted relations, attributes, entities and other additions. Not every trivial event needs verbose justification. User should be able to later verify individual statements.
- Wants human-readable Markdown and structured JSON (AI-readable) records, possibly additional files if useful. Preserve evidence and what AI did; allow separate export of AI modifications and justification/audit records.
- Agrees with identity resolution and the other V1 improvement areas.

## B. Naming and information architecture
- Reserve “Import” for importing an outside story/manuscript, rather than native JSON restoration.
- Rename existing native JSON path to Load Backup / Restore Project Backup or an equivalent clear name. Consider Export Backup / Save Backup / Download Backup, not ambiguous settings terminology. Owner is still brainstorming exact labels.
- Separate story import, story export, application settings and native project backup access. Do not mix these up in History & Export. Revision History itself is useful; exact placement remains open and merits brainstorming.
- Retain Full Project JSON, Story Bible Markdown, Refined Prompt and JSON file/paste restoration capabilities. Improve export filenames: story/project name, no spaces (underscores or equivalent), date and relevant identifiers; revision history date/time/ID should remain clear.

## C. Prompt and file size
- Questions arbitrary 8,000-character AI prompt limit; wants longer text and preferably no user-facing fixed cap. Distinguishes manuscript file import from ordinary AI prompt size. Asks whether removing restriction would cause problems. Does not insist on unsafe unlimited processing; wants analysis.

## D. Import stages and strategies
- File selection alone should not import or mutate a project. Click to analyze, show what AI found and ask for review before final creation. User should be able to guide analysis with optional import instructions and review major findings.
- Faithful Reconstruction: no new story content, no suggestions for changing the story, no invented details and no automatic corrections. Extract faithfully, show inconsistencies/uncertainties and their evidence, preserve them for later action. Tagging/labels are a possible mechanism.
- Reconstruct & Enhance: primary purpose still import, but user may request optional improvements or correction. Before/after differences, explanation and source evidence must be visible. If AI corrects something, keep an audit record after import and provide a way to inspect/revert. Do not conceal what changed.
- Selective Extraction: agrees with scoped extraction choices. Review after Start AI Analysis, allow item-specific choices and useful bulk operations (ignore/skip/defer all) so review does not become manual data entry.
- Final Create Creative Project applies the reviewed result, not the raw analysis. Preserve original text and evidence separately.

## E. Persistent inconsistencies
- For possible timeline inconsistency, names, relationship changes, etc., show the exact passages and the reason why flagged.
- User should be able to provide additional clarification, defer/skip/ignore for now, or optionally ask AI to fix in enhancement mode.
- “Ignore for now” should not erase warning. Keep unresolved issues visible after import until resolved or otherwise explicitly dispositioned. User can return later, fix manually or ask AI.
- When correction occurs, persist the original issue, what was changed, how/why, and show the corrected status; allow undo/revert where safe. The original source must not be silently rewritten.
- Faithful mode may flag but must not change. Whether correction UI belongs only to enhancement or a post-import workflow should be considered; owner is open to refinement.

## F. Product intent and requested work
The central goal is reconstruction of an already existing work into graph, properties, relationships and Story Bible, not rewriting it during import. User-requested creative changes can be optional, never the default. Justify extracted significant items with citations and show possible inconsistencies individually.

Requested: run another brainstorming + six-cycle iterative refinement; critically distinguish good ideas, risks and improvements. Save V1 analysis, this owner feedback and refined V2 as separate durable GitHub documents (new folder allowed). Do not implement features just because they were mentioned. User is still discussing options.
