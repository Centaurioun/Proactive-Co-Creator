# PCC — Requirement routing and traceability register
Baseline 4bedadf0f6fb571cc40f91bbd401bf8bba8027ee. This is a planning ledger, not implementation evidence or a claim that all requirements are fulfilled. All listed items are planned/approved in the governing blueprint unless deferred/gated or identified as historical observation; detailed work packages must check exact source, decompose compound items, add acceptance criteria, source paths, tests and actual evidence. Arrow means initial delivery/extension, not permission to defer entire feature. Package numbers refer to WP01–WP08. No new execution authority. Preserve source descriptions, especially original owner register, when ambiguous. This register corrects grouped F/R entries and ID misuse in UI research; generated CE rows use comparative report labels and are not an independent proof of complete original brainstorming coverage. Original CE text takes precedence over crosswalk shorthand. Do not use prior "133" or "100%" count as acceptance evidence.

## Source and planning map
[Original owner CE register](../../product-research/owner-brainstorming-2026-11-28.md); [comparative source matrix](../../product-research/02-comparative-research/01-comparative-coverage-and-traceability.md); [individual R recommendations](../../product-research/01-independent-discovery/06-recommendations-strategy-and-roadmap.md). [UI evidence](../../product-research/ui-02-comparative-research/01-comparative-coverage-and-evidence.md); [owner UI decisions](../../product-research/ui-owner-decisions-after-research-01.md); [current governing blueprint](./PRODUCT-BLUEPRINT.md); [delivery roadmap](./DELIVERY-ROADMAP.md). Source descriptions in first table are copied from the cited repository matrices, not new evidence. Research hypotheses remain hypotheses.

| ID | Source item | Planned package(s) |
|---|---|---|
| F-01 | Empty `Write` landing on 0-section sample project + initial IndexedDB lockout banner | 01 |
| F-02 | `POST /api/generate/story` 60s timeout & `499 CANCELLED` misclassification | 01 |
| F-03 | `POST /api/batch-edit` drops `nextValue` on `update_story_bible` | 01 |
| F-04 | `import/extract` live `502 MODEL_UNSUPPORTED` + brittle UTF-16 offsets + `2048` cap + no fence-strip | 01 |
| F-05 | Silent 8-section / 5k-char truncation, broken `changed` scope, stripped `belief`/`reported` entities | 01→02→04 |
| F-06 | Writing Assistant context blindness (no relationships, prior scenes, metadata, exclusions) | 01→02 |
| F-07 | `Plan` (`promptBuilder.ts`) disconnected from `Working Manuscript` (`Write`) | 01→02 |
| F-08 | 4 "visual views" (`Timeline`, `Mind Map`, `Ego Map`, `Family`) are text lists; `Timeline` uses `localeCompare` | 04 |
| F-09 | `aiService.ts` bypasses `aiBudget`; default `gemini-managed` skips `observedByConnection` | 01 |
| F-10 | Semantic diagnostics hardcodes `anchors: []`; local checker shallow + noisy substring setting check | 01→02→04 |
| F-11 | Dirty-draft hard navigation lockout in `App.tsx:175` | 01 |
| F-12 | 7-bar chrome stack, duplicated CTAs, hidden Inbox, clipped filters (`Relatio`) | 02→03→07 |
| F-13 | 5-step blocking `ImportWorkflow` wizard & reset-on-edit | 01→02→06 |
| F-14 | Multi-provider asymmetries (SRB story-only gate, prompt-only OpenAI JSON, Gemini image transport) | 01 |
| F-15 | Micro-defects (`property(Tone`, `"No sections match"`, unconnected Hub History, `503` recovery) | 01→02 |
| C-01 | Living Story Pulse & Inline Margin Co-Creator | 03 |
| C-02 | Epistemic Perspective Lenses ("Who Knows What?") | 04 |
| C-03 | Dual-Track Visual Timeline & Spatial Graph Lenses | 04 |
| C-04 | What-If Narrative Forking & Ripple-Effect Sandboxes | 05 |
| C-05 | Gentle Guided Seed-to-Scene Studio ("Discovery Interview + Live Sketch") | 03 |
| C-06 | Dialogue Voice, Subtext & Rhythm Workbench | 04 |
| C-07 | Progressive Zero-Ceremony Ingestion | 01→02→06 |
| C-08 | Spoiler-Free First-Time Reader Experience Simulator | Deferred R&D; separate authorization |
| CE-01.1 | **Distinct Creative Studio** (spacious workspace to discover possibilities & introduce original ideas) | 03 |
| CE-01.2 | **Discover with AI** (AI-led story-specific creative opportunities) | 03 |
| CE-01.3 | **Guided Exploration** (adaptive questions/options based on prior choices) | 03 |
| CE-01.4 | **Focused Development** (author chooses scope—characters, events, rels, objects, locations, graph nodes, passage, scene, chapter, whole story—with multi-select & free text) | 03 |
| CE-01.5 | **Story Lab** (what-if, alternative directions, experimental branches, surprising links, endings) | 05 |
| CE-01.6 | **Collaborative Exploration** (fluid switch between AI-led & author-led; shared interaction pattern, not 5th screen) | 03 |
| CE-01.7 | **Saved Ideas, Exploration History, Active Sessions, Selected Changes** | 03 |
| CE-01.8 | **Distinct Story Development Workspace** (`Expand Story`, `Develop Chapters`, `Character Depth`, `Plot Development`, `Scene & Dialogue`, `Pacing & Structure`, `Voice & Style`, `Continue Story`, `Narrative Compression`) | 04 |
| CE-01.9 | **Preservation Policy** (user-selectable keep-intact toggles: core plot, characters, ending, voice, chronology, relationships, genre/tone) | 04 |
| CE-01.10 | **Draft Exchange between Creative Studio and Story Development** | 03 |
| CE-02.1 | **Preview** (inspect exact proposed changes before mutating) | 02→03 |
| CE-02.2 | **Direct Accept/Apply** (eliminate redundant `Accept → Send to Change Review → extra technical screen`) | 02→03 |
| CE-02.3 | **Manual Edit** (edit idea description separately from actual proposed patch edits) | 02→03 |
| CE-02.4 | **Per-Card Regenerate** (keep other cards, keep prior alternative lineage, optional guidance) | 03 |
| CE-02.5 | **Develop Further** (evolve promising idea's essence without replacing original) | 03 |
| CE-02.6 | **AI-Suggested Directions + Multi-Select + Surprise Me** | 03 |
| CE-02.7 | **Suggest More Directions** (append distinct options without losing current selections) | 03 |
| CE-02.8 | **Custom Direction Input with TWO Distinct Actions (`Suggest Directions` vs. `Generate Idea`)** | 03 |
| CE-02.9 | **Combine Ideas** (synthesize 2+ selected ideas/alternatives into a hybrid) | 03 |
| CE-02.10 | **Save for Later (Bookmark) & Dismiss (Recoverable)** | 03 |
| CE-02.11 | **Safe Undo / Selective Revert** (revert applied change without erasing unrelated later edits; flag dependencies) | 02→05 |
| CE-03.1 | **Project-Scoped Persistent Creative Sessions** (scope, goals, constraints, directions, alternatives, parent links, merges, Q&A, draft patches) | 03 |
| CE-03.2 | **Truthful Local Autosave** (save drafts on edits & valid AI results; show real status; keep last durable draft on failure; never silently resume provider calls) | 03 |
| CE-03.3 | **Clear State Separation** (`Autosaved Draft` ≠ `Bookmarked` ≠ `Selected` ≠ `Accepted into Collection` ≠ `Applied to Canon` ≠ `Archived`) | 03 |
| CE-03.4 | **Non-Forced Session Controls** (`Skip`, `Back`, `Generate Now`, `Finish`, `Save Draft`, `Continue Exploring`; explicit bounded AI triggers) | 03 |
| CE-03.5 | **Unified Proposal Engine** (common mechanics for creative ideas, diagnostics fixes, writing assist, sync, Decision Inbox, NL batch edits—while keeping *defects* separate from *optional ideas*) | 02→03 |
| CE-03.6 | **Shared Narrative Intelligence Layer** (single authoritative manuscript/Bible/graph/evidence/history; no competing registries) | 02 |
| CE-04.1 | **Per-Idea & Final Aggregate Preview** (selective checkboxes, edit, save draft, apply selected) | 02→03 |
| CE-04.2 | **Summary & Exact Before/After Diff Views** (manuscript ranges, model fields, entities, rels, Story Bible, protected unchanged items) | 02→03 |
| CE-04.3 | **Visual Change Map** (`Before / After / Changes Only`, preserved node positions, directed predicates, accessible labels+line styles+color, click-through to text/proposal, **derived strictly from exact patch + base revision**) | 02→03 |
| CE-04.4 | **Impact Analysis** (distinguish concrete patched changes vs. speculative downstream effects on other chapters/characters/continuity/evidence; explicit uncertainty) | 03→05 |
| CE-04.5 | **Coherent Refresh, Dependency Conflict Detection & Atomic Selected Apply** | 02→03 |
| CE-04.6 | **Stale Base Revision Guard** | 02→03 |
| CE-05.1 | **4 Final Outcomes** (`Apply to Current Project`, `Save as Alternative Project`, `Save as Draft`, `Continue Exploring`) | 03→05 |
| CE-05.2 | **Save as Alternative Project — STRICT NO AUTO-SWITCH** (durable independent copy, original unchanged, offer `Continue Current Project` [default] or `Open Alternative` [explicit]) | 03→05 |
| CE-05.3 | **Story Multiverse** (optional lineage/ancestry tree of alternative projects; handles deleted parent gracefully) | 05 |
| CE-05.4 | **Compare Alternative Stories** (qualitative comparison of plot, atmosphere, tension, tradeoffs—zero numeric scores) | 05 |
| CE-05.5 | **Selective Transfer / Merge Alternatives** (cherry-pick specific scenes, characters, or ideas from Alternative B into Project A via preview + conflict review; no implicit merge) | 05 |
| CE-06.1 | **Creative Compass** (editable summary of active creative directions + next direction suggestions; qualitative preference diagram, not quality score) | 03→04 |
| CE-06.2 | **Creative DNA** (optional user-saved longer-term project/general preferences + `Follow / Challenge / Blend` mode) | 05 |
| CE-06.3 | **Creative Intensity** (`Subtle / Balanced / Bold / Radical` as author risk appetite, NOT technical temperature/reasoning) | 03→04 |
| CE-06.4 | **Creative Constraints** (per-session natural-language rules: preserve ending, no new characters, scientific plausibility) | 03→04 |
| CE-06.5 | **Creative Lock** (protected narrative items—AI-recommended AND author free-text with `+ Add another` repeatable rows; exact entities/rels/passages/events/ending/world rules; project or session scope; visible conflicts, no silent override) | 02→04→05 |
| CE-06.6 | **Explicit Unlock or Alternative-Under-Separate-Constraints** | 02→04→05 |
| CE-07.1 | **Connection Discovery / Hidden Connections** (select unrelated events/objects/chars/locations → causal/temporal/psychological/scientific/mystical/symbolic links; source-grounded, links remain hypotheses) | 05 |
| CE-07.2 | **Story Seeds / Discover Hidden Story Seeds** (surface underused existing details before inventing arbitrary new elements) | 05 |
| CE-07.3 | **Foreshadowing Architect** (setup, reminders, misdirection, payoff; forward from clue or reverse from ending; source-linked & subtle) | 05 |
| CE-07.4 | **Mystery Builder** (clues, red herrings, suspect motives, reveal timing) | 05 |
| CE-07.5 | **Plot Promise Tracker** (track implicit/explicit promises made to reader & whether paid off) | 04→05 |
| CE-07.6 | **Unresolved Story Threads** (identify dangling subplots/conflicts across chapters) | 04→05 |
| CE-07.7 | **Open Questions Board** (deliberate narrative mysteries vs. unanswered author decisions) | 04→05 |
| CE-07.8 | **Character Intelligence & Hidden Motivation** | 04→05 |
| CE-07.9 | **Character Interview** (fictional in-character roleplay, strictly labeled exploratory) | Deferred R&D; separate authorization |
| CE-07.10 | **Alternative Perspectives / Perspective Switcher** (re-examine a scene or world through another character's eyes) | 04→05 |
| CE-07.11 | **Character Knowledge Map** (knows, suspects, falsely believes, has not learned — scoped to scene/time) | 04→05 |
| CE-07.12 | **Reader's Perspective / Reader Knowledge Timeline / Reader Notes** (narrative order vs. story chronology, reader vs. character knowledge, spoiler boundaries, deliberate uncertainty) | 04→05 |
| CE-07.13 | **Creative Challenge / Challenge My Idea** (expose clichés, weak causality, contrivance, unintended consequences; constructive critique, no scores) | 03 |
| CE-07.14 | **What Happens Next? & Creative Crossroads** | 05 |
| CE-07.15 | **Scene Simulator** (test-run a hypothetical interaction/beat before committing to manuscript) | 05 |
| CE-07.16 | **Alternative Endings Lab** | 05 |
| CE-07.17 | **What-If Branches / Butterfly Effect / Narrative Ripple / Impact Map / Change Simulation** | 05 |
| CE-07.18 | **Reverse Plotting / Reverse Engineering a Twist** | 05 |
| CE-07.19 | **Creative Cross-Pollination** (science, mythology, psychology, history as inspiration; strictly distinguish fiction from factual claims) | 05 |
| CE-07.20 | **Theme Weaver** | 04→05 |
| CE-07.21 | **Narrative Tension Map** | 04→05 |
| CE-07.22 | **Idea Incubator & Private Idea Marketplace (Searchable Saved Idea Library)** | 03 |
| CE-07.23 | **Creative Continuation & Creative Brief** | 03 |
| CE-07.24 | **Story Q&A ("Talk to the Story")** (author asks grounded questions; AI answers with supporting passages, revision & uncertainty; optional transfer to Studio draft) | 03→04 |
| CE-07.25 | **Optional Non-Interrupting Proactive Assistant During Writing** | Deferred R&D; separate authorization |
| CE-08.1 | **Voluntary `Grill Me` at Inception OR Any Scoped Point** | 03 |
| CE-08.2 | **Dependency-Aware Adaptive Frontier & Recommended Answers** (inspired by `mattpocock/skills/grilling`: ask currently answerable high-value questions, research story facts first rather than asking author what's already in text!) | 03 |
| CE-08.3 | **1 High-Value Question Default OR Optional Small Batch + Reasoned Options + Free-Text + Multi-Choice + Let AI Propose** | 03 |
| CE-08.4 | **Skip / Defer / Keep Deliberate Mystery + Backtrack & Invalidate Dependent Draft Decisions** | 03 |
| CE-08.5 | **Interruptible Anytime → Editable Preview Concept (Live Draft Sketch)** | 03 |
| CE-08.6 | **No Hidden Provider Loop & Shared Session Storage** | 03 |
| CE-09.1 | **`handoff` → Session Brief / Resume Elsewhere** (goal, decisions, Q&A, selected versions, scope, unresolved items; redacted/explicit export; links not duplication) | 03 |
| CE-09.2 | **`to-questionnaire` → Async Author / Beta-Reader Feedback Sheet** (export/import draft answers; no auto-accept) | Deferred R&D; separate authorization |
| CE-09.3 | **`wait-what` → Explain Differently** (plain language, concrete story example, why it matters, what would change; zero new canonical facts) | 03 |
| CE-09.4 | **`teach` → Optional Writing Coach / Explain the Technique** (contextual craft lessons—pacing, POV, foreshadowing—separate from story facts/diagnostics) | 03 optional Craft Note; expanded coach R&D |
| CE-09.5 | **`writing-for-agents` → Context Assembly Discipline & Progressive Disclosure** (internal engineering principle, NOT a user-facing screen) | 02→03 |
| CE-09.6 | **`grill-me` + `grilling` as Invocation + Mechanism** (one unified capability, not two) | 03 |
| CE-10.1 | **Selective PCC-Native Adaptation** (no literal external skill ports; consolidate freely) | 03 |
| CE-10.2 | **4 Interview Behavioral Modes** (`Inspire Me`, `Explore with Me`, `Grill Me`, `Challenge Me`) on one shared engine | 03 |
| CE-10.3 | **Approved User-Facing Name: `Story Q&A`** (author asks AI about story, source/revision-grounded with uncertainty; optional explicit transfer to Studio draft; clearly distinct from `Grill Me`) | 03→04 |
| CE-11.1 | **Approved User-Facing Name: `Story Q&A`** (author asks AI about story, source/revision-grounded with uncertainty; optional explicit transfer to Studio draft; clearly distinct from `Grill Me`) | 03→04 |
| CE-11.2 | **Two-Pass Independent → Comparative Research Governance** | Research complete |
| R-01 | **Fix `generateStoryText` timeout & abort misclassification:** Add bounded `thinkingConfig` + `maxOutputTokens`, fix `classifyWithSignal` so timeouts return `504 TIMEOUT (retryable: true)`, and add streaming prose output. | 01 |
| R-02 | **Repair `import/extract` reliability & anchor resolution:** Replace LLM UTF-16 offset requirement with deterministic verbatim quote-to-offset anchoring (`04 §4.4`), raise `maxOutputTokens` from `2048` to `4096+`, add `stripJsonFences`, and resolve `502 MODEL_UNSUPPORTED` on `createGeminiAdapter`. | 01 |
| R-03 | **Fix `batch-edit` missing `nextValue` on `update_story_bible`:** Enforce per-operation required fields in schema/prompt and validator so incomplete operations never silently pass through. | 01 |
| R-04 | **Fix first-visit landing & empty-state traps:** Land empty-manuscript seed projects on `Plan`/`World` (or seed the sample project with a 2-scene manuscript excerpt); hide raw IndexedDB loading message during healthy hydration; fix `"No sections match these filters"` & `"2 core Story Bible property(...)"` formatting. | 01 |
| R-05 | **Eliminate silent truncation & repair `changed` scope in Diagnostics & Sync:** Display explicit coverage disclosures (`"8 of 24 sections checked"`), fix `changed` scope filtering, stop stripping `belief`/`reported` entities, and resolve `evidenceQuote` into clickable passage anchors (`anchors[]`). | 01→02→04 |
| R-06 | **Unify server AI budget enforcement, provider telemetry & Gemini transport:** Route `aiService.ts` operations through `aiBudget` slots/token bounds, ensure default `gemini-managed` increments `observedByConnection`, align image transport, and use native Responses API Structured Outputs on OpenAI where supported. | 01 |
| R-07 | **Replace dirty-draft hard navigation lockout with debounced background autosave + flush-on-switch:** Persist manuscript edits transparently to IndexedDB without blocking tab switches. | 01 |
| R-08 | **Execute Chrome Consolidation & Terminology De-Jargoning:** Eliminate all duplicated controls (`Generate Story`, `Story/Image`, `Story Bible`, `Opportunities`, `Output`, double Inbox headers), remove the permanent 6-term evidence legend strip, reclaim `≥60%` viewport height for the canvas, fix clipped Inbox filters, and translate engineering terms (`03 §2.3`). | 02→03→07 |
| R-09 | **Enrich AI Writing Assistant context & promote it out of collapsed `<details>`:** Pass scene-relevant `relationships`, active scene metadata (`pov`, `location`, `chronology`, `purpose`), excluded entity names, and preceding section synopsis into `WritingAssistRequestSchema`; move Writing Partner into the right Margin. | 01→02→03 |
| R-10 | **Bridge `Plan` and `Write` ("Draft into Manuscript"):** Let `Generate Story` / seed drafting create or append real editable sections in `Working Manuscript`, and show clear manuscript/plan sync status without forcing manual prompt-vs-manuscript mental juggling. | 01→02 |
| R-11 | **Build Derived Narrative Memory Index (`SectionContextIndex` + `EntitySceneMap` + `EpistemicFactLedger`):** Enable scene-scoped retrieval, rolling chapter synopses, and multi-pass full-novel Diagnostics/Sync without hitting 8-section truncation or 14k-token walls. | 02 |
| R-12 | **Converge IA into the Two-Surface "Story Studio" (`Write` + `World` + Persistent Contextual Margin):** Unify `Write`, `Plan`, and `Review` under Option B (`03 §3–§4`) so cast, relationships, continuity whispers, and Writing Partner live beside the writer's prose. | 03 |
| R-13 | **Replace 4 flat text-list views with genuine Visual Views:** Build a true **Dual-Track Visual Timeline** (explicit `chronologyOrder`, replacing broken `localeCompare`), integrate **Radial Ego Focus** & **Kinship Lens** directly onto the main Story Map canvas, and retire the incomplete 5-box `Mind Map`. | 04 |
| R-14 | **Redesign Import into Progressive Zero-Ceremony Ingestion:** Allow instant 1-click entry of imported `.txt`/`.md`/`.docx`/`.pdf` text into `Write` (preserving immutable source), with optional non-blocking background chapter extraction and click-to-highlight margin review. | 01→02→06 |
| R-15 | **Upgrade Local Consistency Checker:** Remove brittle substring setting false positive (`issue_setting_mismatch`), relabel local checks as *Structural Checks*, and integrate seamlessly into unified Diagnostics rather than duplicating in `Plan > Checks`. | 01→04 |
| R-16 | **Launch Guided Seed-to-Scene Discovery Studio:** Progressive 1-question-at-a-time creative spark interview paired with a live-growing Story Map and 1-click streaming opening beat into `Write` (with equal doors for Blank Draft & Import). | 03 |
| R-17 | **Launch Epistemic Perspective Lenses ("Who Knows What?"):** Interactive POV knowledge lens on the Story Map & Scene Margin distinguishing World Canon, Character Beliefs, Rumors, and Unknown Facts for dramatic irony and mysteries. | 04 |
| R-18 | **Launch "What-If" Narrative Forking & Ripple-Effect Sandboxes:** Non-destructive branching of a graph relationship or plot turning point with automated manuscript ripple-impact mapping and atomic Adopt/Discard. | 05 |
| R-19 | **Launch Dialogue Voice, Subtext & Rhythm Workbench:** Character-grounded voice distinctness observations, subtext dialogue alternatives, and zero-cost local sentence-cadence highlighting. | 04 |
| R-20 | **Prototype Spoiler-Free "First-Time Reader" Experience Simulator:** Sequential chapter-by-chapter beta-reader pass strictly masking later chapters/secrets to evaluate clue landing, setup/payoff distance, and reader expectations. | Deferred R&D; separate authorization |

## UI and cross-cutting owner decisions
| ID | Need | Planned package(s) |
|---|---|---|
| UX-01 | Dead destinations | 02 |
| UX-02 | Toolbar crowding | 03→07 |
| UX-03 | Raw preview | 02 residual if WP01 absent |
| UX-04 | Cramped inspector | 03→04 |
| UX-05 | Mobile navigation | 02→03→07 |
| UX-06 | Chronology sorting | 04 |
| UX-07 | Styling dialects | 03→07 |
| UX-08 | Contrast/focus/controls | 02→03→07 |
| UX-09 | Dirty draft lock | 01→02 |
| UX-10 | Jargon | 03→07 |
| UX-11 | Inconsistent labels | 03→07 |
| UX-12 | Fake mind map | 04 |
| UX-13 | Silent 80-item cap | 02 |
| UX-14 | History duplication | 03→06 |
| UX-15 | Settings refresh | 01→02 residual |
| UX-16 | Long stacked UI | 01→03→07 |
| UX-17 | Duplicate controls | 03 |
| UX-18 | Empty states | 01→03→06 |
| UI-NEW-01 | Dual-Pane | 03→05 |
| UI-NEW-02 | Dual-axis As-Of | 04 |
| UI-NEW-03 | Source peek | 02→04 |
| UI-NEW-04 | Command palette | 03 |
| UI-NEW-05 | Scene rhythm | 03→04 |
| UI-NEW-06 | Partial hunk selection | 02→03 |
| UI-NEW-07 | Repetition lens | 03→04 |
| UI-NEW-08 | Resume trail | 03→06 |
| UIRF-01 | Workspace presets | 03→05 |
| UIRF-02 | Pins | 03→05 |
| UIRF-03 | Deep links | 03→05 |
| UIRF-04 | Show Me How | 03→07 |
| UIRF-05 | Expand major view | 03→04 |
| UIRF-06 | Distraction-free reading | 03→07 |
| UIC-01 | Scope & locks visual | 02→04 |
| UIC-02 | Citation diff | 02→04 |
| UIC-03 | Chronology helper | 04 |
| UIC-04 | Key recovery drill | 06 |
| UIC-05 | Sandbox-only relaxation | 05 |
| UIC-06 | Reading notes | 03→04 |
| S-01 | Lock preflight | 02→04 |
| S-02 | Belief clash | 04 |
| S-03 | Calm/Deep | 03 |
| S-04 | Q&A bridge | 03→04 |
| S-05 | Compression | 04 |
| S-06 | Patch visual diff | 02→05 |
| GS-01 | Provider status | 01 |
| GS-02 | Settings capabilities | 01 |
| GS-03 | Animations | Deferred; separate polish priority |
| GS-04 | Multi-select | 03 |
| GS-05 | Project overview | 06 |
| GS-06 | Dedicated dictation | Deferred; OS dictation compatibility retained |
| GS-07 | Recovery | 01→06 |
| GS-08 | Truthful progress | 01→06 |
| IR-01 | Operation center | 01→06 |
| IR-02 | Context inspector | 02 |
| IR-03 | Creative collection | 03 |
| IR-04 | Proposal conflicts | 02→05 |
| IR-05 | Resume work | 03→06 |
| OD-01 | Hybrid shell | 03 |
| OD-02 | Adaptive onboarding | 01→06 |
| OD-03 | Staged delivery | 01–08 |
| OD-04 | Provider governance | 01→02 |
| OD-05 | Retention | 03→06 |
| OD-06 | Locks | 02→04 |
| OD-07 | Secondary visuals | 03→06 |
| OD-08 | R&D gate | Deferred separate approval |
| UID-01 | Dual pane | 03→05 |
| UID-02 | Distinct workspaces | 03 |
| UID-03 | Visual choice | 07 |
| UID-04 | Early repairs | 01→02 |
| UID-05 | Author language | 03→07 |
| UID-06 | Eight opportunities | 02→06 |
| UID-07 | Settings/backup separation | 01→02→06 |
| UID-08 | Adaptive resume | 01→06 |
| UID2-01 | Atelier candidate / final approval | 07 |
| UID2-02 | M6 | 03 |
| UID2-03 | AI Assist | 02→03 |
| UID2-04 | Curated pairings | 03→05 |
| UID2-05 | Quiet insights | 03 |
| UID2-06 | Six UIC | 02→06 |
| UID2-07 | Sample | 06 |
| UID2-08 | Local fonts | 07 |
| NEW-EMB | Optional prioritized embeddings with mandatory local index | 02 |
| NEW-R2 | Optional encrypted R2 snapshot / restore | 06 |

## Remaining source coverage and acceptance discipline
- UIR-01–14, OR observations, M1–M6, all five visual directions and V1–V7: retain exact definitions in independent/comparative UI reports and owner addenda. UI implementation must trace relevant UIR/OR items individually when package authored. M6 selected; M5 possible future preference; M1–4 inspiration only, not four parallel shells. Three visual candidates remain until WP07 selection. V1–V6 WP04, V7 E3 WP02 foundation / WP03–05 integration.
- J-01–15 (see [journey source](../../product-research/ui-02-comparative-research/03-author-journeys-and-interaction-specification.md)) are acceptance scenarios, not verified tests. WP08 covers all individually; interim packages verify relevant journeys: J-01 seed WP01/03, J-02 import WP01/02, J-03 writing WP01/03, J-04 iteration/resume WP03, J-05 narrative inquiry WP04, J-06 development WP04, J-07 issue/fix WP02/04, J-08 alternative WP05, J-09 settings WP01/02/06, J-10 resume WP03/06, J-11 nonlinear Turkish WP04, J-12 failure recovery WP01/06, J-13 alternative transfer WP05, J-14 large navigation WP03/05, J-15 R2 WP06.
- CE-07.9 fictional character interview, CE-07.25 true proactive/background AI, CE-09.2 async feedback sheet and R-20/C-08 simulator deferred behind distinct R&D authorization. CE-09.4 lightweight contextual craft note can share engine; expanded coach gated. Passive local hints and reader-perspective knowledge do not require these experimental features. CE-11.2 two-pass research complete as a documentation activity, not implementation completion.
- In each active package, record exact requirements/source IDs, implementation location, verifiable behavior, verification type and PASS/PARTIAL/BLOCKED/DEFERRED; update CHECKPOINT and REPORT. No missing requirement silently marked complete, no invented test or coverage counts. Where source descriptions overlap, preserve intent and map to same evidence instead of duplicate features. Before WP08, reconcile every residual OR/UIR/CE sub-action against original source and explicit owner disposition, including source items not individually expanded in this planning ledger.
