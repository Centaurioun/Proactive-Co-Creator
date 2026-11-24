# 01 — Initial brainstorming (V1)

Date: 2026-11-24. Historical structured recap of the assistant's initial analysis, prior to the owner's second-round feedback. Not an approved implementation specification.

## Motivation and original concept
The owner wants to bring an existing story, manuscript or narrative text into Proactive Co-Creator without manually recreating every character, location, relation and property. Select a TXT/Markdown/DOCX file or paste text, optionally provide import-specific instructions, explicitly start AI analysis, review, then create a project. This is reverse story reconstruction (Story → Structured Project), complementing forward creation (Idea → Graph/Bible/Decisions → Story). Preserve the original manuscript and the user's creative authority. The feature was called AI-Assisted Story Import / Import & Analyze Story / Create Project from Manuscript / Intelligent Narrative Import.

## Existing code observations
Reviewed main 0b34d01. Existing JSON restoration is not unstructured narrative analysis. `App.tsx:1680` handleImportProjectJson parses and migrates a CreativeProject via schema-v3 storage; `App.tsx:1524` creates a fresh project. `shared/schemas.ts:18` MAX_PROMPT_CHARS=8000, with API and UI checks. `server/aiService.ts:81–202` analyzeBeliefGraph explicitly asks for 2–3 helpful implicit entities, inferred attributes and alternatives: valuable for creation, unsafe for faithful manuscript reconstruction. Existing Story Bible fields, graph entities/relationships, Decision Inbox, consistency engine, project controller, revision history, localStorage/IndexedDB, Gemini service and Zod validation are reusable. Types already include aliases, provenance imported/ai-inferred/user-edit, pending/confirmed/rejected, relationship evidenceExcerpt, but not a complete source document/evidence registry. CreativeProject carries snapshot, artifacts, revisions and undo history. Full manuscript should not be duplicated inside every snapshot or jammed into originalIdea. New flow must not change current JSON restoration semantics or AI creation behavior without separate review.

## Alternatives considered
1. Send uploaded text into existing Analyze: simple but 8k cap and creative invention semantics; reject.
2. Ask AI to emit a complete CreativeProject JSON: simple appearance, unsafe identity, schema, storage and authority; reject.
3. Staged extraction, validated proposals, human review and deterministic assembly: recommended.
4. Complete novel analysis platform (chapters, timelines, multiple documents, style profiles): future expansion rather than initial all-in-one release.

## V1 experience and format scope
Entry point: project creation with Start from an Idea, Import & Analyze Story, Restore Project Backup. Keep JSON backup path distinct. Four conceptual steps:
- Select source: local parsing and preview only; no AI before explicit start. Paste, TXT, MD, DOCX initial scope. PDF and EPUB next; ODT, RTF, Fountain and FDX later. PDF text extraction, layout and OCR have separate complexity.
- Configure import: optional author instructions, extraction categories (characters/entities, relationships, Story Bible, locations/world, events/plot, themes/style, continuity issues), strategy Faithful Reconstruction (default), Reconstruct & Enhance (separate optional proposals), Selective Extraction.
- AI analysis: parse, segment narrative, extract entities/attributes/relations, resolve identities/aliases, synthesize Bible, detect continuity concerns, validate proposal. Real stage progress, cancellation, retry failed stage. Short input simple; long input chunked by chapter/scene with global reconciliation, no silent truncation.
- Review & Create Project: show source-supported findings, interpretations, ambiguities, possible inconsistencies and coverage. Batch accept supported facts; unresolved items in Decision Inbox. Never silently commit AI output, rewrite original or create project before explicit commit.

Illustrative V1 example: Leyla returns from Istanbul to family home on Black Sea coast after father's death. Childhood friend Murat gives her letters he hid for years; one dated three years after mother's death. Extract characters, places, letters and supported relations, third-person narration; genre/tone/themes are interpretations, intended audience unknown. Date may be intentional mystery; author of letter not given. Do not turn a suspicion into a confirmed contradiction or invent Murat's motivation.

## Original six-cycle refinement
1. Product purpose: second entry mode, not mere file transfer. Story → reusable workspace, no manual recreation.
2. Fidelity: distinguish explicit, inferred, character belief, ambiguous, conflicting, AI suggested, user confirmed. Preserve existing approval statuses independently of evidence kind. Example: Ahmet suspects betrayal ≠ betrayal occurred.
3. Scale: current 8k limit; chunk longer works by structure; track coverage; reconcile cross-chunk identity (Hasan, commissioner, old man could be same, not automatically merged). Global graph/Bible; no silent loss.
4. Data/security: source documents immutable, separate from revision snapshots; transient analysis proposal, deterministic canonical assembly. Schema-v3 migration/export round-trip decisions needed. Validate untrusted output and file size/decompressed size, disable external fetch/active content, treat document as untrusted data against prompt injection, provider disclosure, cancel/stale guards.
5. UX/authority: batch source-supported review, individual ambiguity/conflict review, optional creative suggestions separate; optional instructions guide analysis, not authority to mutate original. Evidence links at each finding.
6. Maintainability: CodeScene hotspot scores canonicalModel 1.84, storageEngine 2.41, nlBatchEngine 2.79, ContextualInspector 3.97, projectController 5.36. Do not grow monoliths. Suggested dedicated narrativeImport modules for parser, segmentation, identity, evidence, proposal, assembly, controller and server extraction/synthesis, shared schemas/types and wizard UI; exact module boundaries require later design. No implementation now.

## Additional improvements proposed
- Source Evidence Viewer: original excerpt, chapter/paragraph if available, actual verified location; validate quote against source rather than trust AI's fabricated citation.
- Character identity resolution with aliases and explicit confirmation for uncertain merges.
- Timeline reconstruction: distinguish narration order from story chronology, flashbacks/dreams/reported events, unknown dates; later chapter/scene architecture.
- Narrative style profile (POV, sentence rhythm, dialogue, atmosphere, tense, description).
- Import into existing project: later add chapters/documents, stage changes against project revision, preview, CAS/Undo/Redo; no overwrite. V1 recommended new project first; owner choice remained open.
- Narrow AI extraction interface, Gemini first; do not implement multiple providers upfront. Future providers possible without rewriting import.
- Tests for formats, source preservation, Unicode, identity, fabricated evidence, authority, injection, long text, cancellation, project switch, storage failures, export/restore and Playwright. Separate hand-annotated extraction-quality benchmark (recall, unsupported claims, directed relation precision and evidence validity); mock tests are not model quality evidence.

## V1 priorities and timing
P0: paste/TXT/MD/DOCX, optional instructions, faithful reconstruction, source preservation, graph/Bible reconstruction, review, Decision Inbox, evidence viewer and safe long-text handling. P1: enhancement/selective modes, existing-project append, PDF/EPUB, style profile. P2: timeline, multiple AI providers, advanced chapter/scene and remaining formats. Stage 0 then toolchain qualification and targeted core debt stabilization; product architecture and Figma exploration can plan import before implementation. Proposed Stage 3–4 prototype/implementation, Stage 5–6 advanced intelligence. Do not require all debt cleanup, only necessary safe boundaries. GO for design/discovery, not implementation. Exact scope and placement not final.
