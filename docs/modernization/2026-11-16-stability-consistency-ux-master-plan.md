# Proactive Co-Creator 2.0 — Stability, Consistency & UX Master Plan

> **Implementation directive for Google AI Studio / future coding agents.**
> **Status:** APPROVED SCOPE / IMPLEMENTATION NOT STARTED BY THIS DOCUMENT.
> **Date:** 2026-11-16.
> **Repository:** https://github.com/Centaurioun/Proactive-Co-Creator
> **Baseline examined:** main commit 05dd3f74402a3c18de7a3b7c6590a68e01f909e7 (2026-11-16).
> **Deployment context:** Google AI Studio Build project synchronized with repository main.
> **Authority:** This document supersedes older "completed" claims only where they conflict with newly identified requirements and current code. Do not delete historical reports.
> **Owner-approved requirements:** 12 acceptance scenarios in Section 9, plus preservation of Story, Image, Clarifications, Belief Graph, Decision Inbox, Contextual Inspector, Story Bible, export/import, and user-controlled batch editing.

## 0. Read this first: exact instructions and boundaries

Implement this document against the **actual latest main commit**, not an imagined baseline. First read the source and older design, implementation, and verification documents; revalidate every asserted defect. If main has moved or the relevant behavior is already repaired, keep the working implementation and verify it rather than reapplying an obsolete patch. This is a **staged stabilization and UX refinement**, not a framework migration or full rewrite.

- Preserve the current **React 19 / TypeScript / Vite / Tailwind v4 / Express / server-side Gemini** stack unless an independently demonstrated blocker demands a change.
- Keep **Story** primary and **Image** secondary; **never reintroduce video generation**.
- Maintain all existing working Belief Graph interactions, Clarifications, Story Bible, Decision Inbox, natural-language batch editing, preview/download, and local projects.
- Preserve **originalIdea as an editable user seed** and preserve prior user-authored versions in undo/history. Produce a coherent current generation prompt from confirmed facts without silently rewriting the source or treating an old seed sentence as higher authority than a newer explicit user edit.
- AI suggestions and AI-inferred relationships are **not automatically user-approved**. Explicit source evidence differs from an AI inference.
- Every meaningful state mutation must be associated with the correct **project identity** and expected revision. Never commit stale asynchronous responses to another or newer project.
- Partial recognition of a natural-language instruction must never be described as full success.
- Never silently drop project data or generated artifacts because browser storage is full, AI is unavailable, or an older version is imported.
- Do not incur paid Image API costs during tests without explicit authorization. Mocked tests are not equivalent to live API verification.
- Work in small, reviewable and reversible changes. The **existing main** is used for AI Studio synchronization; create a recoverable checkpoint before code changes, and follow the user's Git workflow rather than silently publishing a large untested rewrite.
- Only mark checkboxes below COMPLETE after fresh verification. The user's previously checked 12-item list means **requirements accepted**, not **tests passed**.

**Success metric:** users can reliably turn an initial idea into an approved, internally consistent story plan, review batch proposals, edit entities and directed relationships, undo and recover work, and generate Story/Image outputs without unexpected AI changes, stale writes, or data loss.

## 1. Brainstorming: product intent, approaches and non-goals

**Core job to be done:** "Give me suggestions and clarifying questions, show a meaningful Belief Graph, let me edit one or many decisions, preserve every confirmed choice, and generate from exactly what I approved."

**Must preserve:** central Belief Graph; three-panel desktop workspace (Decisions / Graph / Inspector); Story Bible; Story and Image; mode-specific controls; dark/light themes; keyboard and mobile access; JSON/Markdown export; explicit generation action.

**Anti-goals:** hidden auto-approval, rebuilding the entire app, reintroducing video, shifting to another frontend framework, silently rewriting original source, speculative cloud accounts/database, unbounded LLM calls, making every minor text keystroke a durable named revision, claiming a passing build proves business behavior.

**Alternatives reassessed:**
1. Minimal patch-only fixes. Small diff but retains underlying multi-state lifecycle risks; inadequate if the cross-project and storage invariants cannot be proved.
2. **Chosen: staged integrity-first stabilization.** Keep current components and stack, introduce narrow version-aware transactions and persistence fixes, repair documented bugs, then refine UX. Costs some internal restructuring but gives small independently verifiable milestones.
3. Full rewrite/event-sourced platform. Unnecessary risk, token consumption and regression surface for this app. Reject (YAGNI).

**Key design call:** maintain a single canonical ProjectSnapshot for current creative truth. Use explicit operations/transactions and derived selectors rather than multiple competing authoritative copies. Separate (a) user-authored seed, (b) confirmed creative state, (c) pending AI proposals, (d) derived generation instructions, and (e) immutable output artifacts.

## 2. Baseline, evidence level and known code touchpoints

This is a **static inspection plan**, not proof that the bugs have reproduced in a running browser. Reproduce or confirm each claim first. Older reports under docs/modernization/verification-report.md state 32/32 tests passed at their execution time; those claims have not been rerun for this plan and do not cover all scenarios below.

| ID | Severity | Evidence from baseline code | Impact / required investigation |
| --- | --- | --- | --- |
| F01 | P0 | App.tsx handleAnalyzeIdea/handleRefreshClarifications call Gemini then commit captured snapshot; handleGenerateOutput writes generated artifacts to current project after await | Project A responses may affect project B or revert newer edits. Add project/revision/request gating. |
| F02 | P0 | App.tsx autosave calls saveProjectToLocalStorage(activeProject) without expectedMinUpdatedAt; storageEngine.ts conflict check is optional; IndexedDB write result is ignored | Multi-tab stale overwrites and misleading success. Make revision compare-and-swap mandatory in actual save path, with recoverable conflict UX. |
| F03 | P0 | canonicalModel.ts mergeAnalysisIntoSnapshot adds incoming relationships with status confirmed and provenance ai-inferred | Inferred relation is treated as user-approved and enters promptBuilder output. Stage as pending unless evidence is demonstrably explicit and verified. |
| F04 | P0 | App.tsx natural-language handler returns local parser result whenever any operation/ambiguity exists; lib/nlBatchEngine.ts can ignore unmatched clauses | Partially understood command can appear fully handled. Track clause coverage and unresolved spans, or defer full complex input to AI. |
| F05 | P0 | lib/nlBatchEngine.ts applyProposedOperations loops operations, conditionally skips malformed targets and counts recognized operations; does not return prevalidation failures | "Atomic" cloning is not sufficient: whole selected batch must prevalidate targets, conflicts, expected values, and applicability or fail with reasons. |
| F06 | P0 | canonicalModel.ts upsertRelationship searches reversed endpoints as an equivalent existing relationship; merge also matches both directions | A→B and B→A may overwrite one another. Keep directed links distinct; support multiple predicates for the same ordered pair. |
| F07 | P0/P1 | renameEntity changes entity name and relationship names; promptBuilder always starts with unchanged originalIdea | Renamed characters or exclusions may conflict with original prose. Compile clear override precedence; detect contradictions without erasing the seed. |
| F08 | P1 | App.tsx handlePolishPromptWithAi passes empty clarification/graph change arrays; server/aiService.ts refinePromptText immediately returns unchanged text when both arrays are empty | "AI Narrative Polish" is effectively a no-op even when displayed as AI processing. Implement distinct preview-based polish or remove misleading action. |
| F09 | P1 | App.tsx passes selectedRelationship={null} to ContextualInspector; BeliefGraph has its own relationship popover | Docked relationship editing is not integrated, despite Inspector support. |
| F10 | P1 | App.tsx "Review Plan & Prompt" switches right tab to story-bible | It does not review a before/after proposed-change diff; label and behavior are inconsistent. |
| F11 | P1 | App.tsx handleSetFreeformNotes calls commitTransaction each onChange; handleSetOriginalIdea and handleModeChange directly replace undoState.present | Excessive revisions for text; inconsistent Undo/Redo coverage for creative edits. Group editing bursts and unify transaction semantics. |
| F12 | P0/P1 | storageEngine.ts saveProjectToIndexedDb silently resolves on failures; application loads from localStorage and not IndexedDB | IndexedDB is an auxiliary write-only path, not demonstrated recovery source. Storage/quota failures can be concealed. |
| F13 | P1 | storageEngine.ts stripHeavyMediaForFallback removes older image arrays on quota fallback | Generated media may disappear from persisted projects without explicit warning. Separate media storage and honest quota UX. |
| F14 | P1 | App.tsx handleGenerateOutput filters out previous artifacts of same mode | Previously generated story/image history is replaced; assess retention and ensure accepted outputs remain recoverable. |
| F15 | P1 | syncStoryBibleWithSceneEntity copies confirmed scene-entity attributes to Story Bible; updateStoryBibleField also copies in opposite direction | Confirmed user edit precedence may be ambiguous during later sync; test last explicit user intent and provenance rules. |
| F16 | P1 | Decision Inbox "Accept All Pending" can approve all pending suggestions globally | Risk of mass approval without full scope visibility. Add review summary and exclusions for conflicted/outdated proposals. |
| F17 | P2 | BeliefGraph has sample-specific "Group Guests" grouping, and initial output drawer starts open | Larger real projects need generic type/custom groups, resizeable/collapsible panes, more graph space. |
| F18 | P1 | Older specs reference lib/projectStore.ts, BroadcastChannel and more comprehensive transaction guarantees; baseline code does not clearly implement all of these | Documentation-versus-code drift. Audit implementation before trusting historical DONE/32-PASS statements. |
| F19 | P0/P1 | Asynchronous callbacks can settle after a newer analysis, Undo/Redo, restore, import, generation, or project switch | Add causal/revision guards to *all* async operations, not just Graph analysis. |
| F20 | P1 | Refined prompt and generation artifacts do not consistently use immutable input revision + content digest | Stale/outdated indication can become inaccurate after non-prompt edits or a long request. Track artifact provenance and fingerprint. |
| F21 | P1 | App.tsx asynchronous request handlers toggle shared isLoading booleans in finally without checking whether this completion is the currently active request | An old request may clear a newer request's progress indicator; test request-aware loading state. |
| F22 | P1 | buildDecisionInboxFromSnapshot reconstructs decisions from live clarifications/attributes and may omit terminal decisions for already-confirmed attributes | Investigate whether accepted/rejected/deferred decisions retain durable provenance and visibility across regeneration, reload and reanalysis. |

**Additional hypotheses requiring reproduction, NOT asserted as verified bugs:** temporary decision statuses rebuilt inconsistently; old AI questions resurrected; relationship labels duplicated in prompt; stale tab race between a localStorage save and IndexedDB save; mixed-case entity collisions; oversized imported JSON; non-English clause parsing; no-op edits creating history; dark/mobile focus after inspector changes; archive-to-import migration information loss.

**Relevant source files:** App.tsx; lib/canonicalModel.ts; lib/nlBatchEngine.ts; lib/storageEngine.ts; lib/historyEngine.ts; lib/promptBuilder.ts; lib/consistencyChecker.ts; components/DecisionInboxPanel.tsx; components/BeliefGraph.tsx; components/ContextualInspector.tsx; components/WorkspaceBottomBar.tsx; components/OutputGallery.tsx; server/aiService.ts; server/routes.ts; services/apiClient.ts; shared/types.ts; shared/schemas.ts; tests/proactiveCoCreator2.test.ts; docs/modernization/*; docs/superpowers/*.

## 3. Canonical invariants — non-negotiable acceptance contracts

**INV-01 / Isolation:** a result associated with projectId=A must never mutate project B, even after a switch, import, restore, or deletion. Request completion is checked *at commit time*.

**INV-02 / Causality:** an async result with an outdated base revision may be deterministically rebased onto the current same-project revision while preserving user decisions, or discarded with explanation. It may not silently replace newer state. Latest request IDs and aborts complement, never replace, revision checks.

**INV-03 / User authority:** explicit user edits and accepted proposals supersede AI inferences. An inferred relationship cannot become confirmed merely because it appeared in an AI graph. Require source-span or equivalent evidence for "explicit"; do not trust a model-generated label by itself.

**INV-04 / Transaction all-or-nothing:** every selected batch operation prevalidates target ID, existence, direction, type, expected prior value, permissions, consistency, and cross-operation conflicts. If any selected operation is invalid, commit none, unless user explicitly unselects it and confirms the remainder.

**INV-05 / Directed multigraph:** each relationship is keyed by stable relationshipId; sourceId, targetId and predicate are distinct. Opposite directions and multiple different labels between same endpoints coexist. Do not treat A→B equal to B→A.

**INV-06 / Single truth:** Story Bible, Clarifications and Belief Graph are projections of one canonical project. A clarification accepted once must not require a duplicate edit elsewhere. Derived text is not independent authoritative state.

**INV-07 / Non-destructive source and output:** current originalIdea is editable, and its prior versions, previous project snapshots and outputs are preserved or explicitly versioned; new confirmed instructions are authoritative for generation. A new output never silently deletes the only copy of an old output.

**INV-08 / Persistence:** successful save means durable transaction acknowledged; interrupted/failed saves are observable. Two writers never silently overwrite a newer revision. Import/export round-trips preserve IDs, directed edges, selected provenance, decisions and artifact references.

**INV-09 / Honest AI interpretation:** each user instruction clause is covered by a proposed edit, a required clarification, or an explicit unsupported/error marker. No "complete" notification for partly parsed instructions.

**INV-10 / History:** every committed semantic transaction is undoable as one unit; redo invalidates after a new branch. Human typing is batched into meaningful units, not one permanent revision per keystroke.

**INV-11 / Generation:** generation uses frozen projectId + revision + prompt digest. Old results may be stored in the originating project as historical artifacts only when safe and explicitly labeled; they cannot be shown as current output for another project.

**INV-12 / Safety and costs:** Gemini key stays server-side; schema-validate AI output; no automatic expensive image generation, no hidden retries, no real paid-media smoke tests without authorization.

## 4. Recommended state, async and transaction contracts

Prefer narrow pure functions and a small reducer/controller over introducing a new large state library. Existing names below are **interface sketches**; adapt to actual types and tests before coding.

### 4.1 Identity and revision metadata

Maintain a monotonic logical revision per project; timestamps are display metadata, **not** concurrency locks. Ensure persisted schema migration is explicit and backward compatible.

~~~ts
type ProjectId = string;
type Revision = number;

interface ProjectEnvelope {
  id: ProjectId;
  revision: Revision;              // increment only on semantic commit
  snapshot: ProjectSnapshot;        // confirmed truth + explicit pending drafts
}

interface AiRequestTicket {
  projectId: ProjectId;
  baseRevision: Revision;
  requestId: string;
  action: 'analyze' | 'clarify' | 'batch-edit' | 'polish' | 'story' | 'image';
}

// Illustrative reducer guard, NOT copy-paste implementation:
function canCommitResult(current: ProjectEnvelope, ticket: AiRequestTicket): boolean {
  return current.id === ticket.projectId &&
         current.revision >= ticket.baseRevision &&
         isLatestActiveRequest(ticket.projectId, ticket.action, ticket.requestId);
}
~~~

**Important nuance:** Checking "revision >= baseRevision" alone does not authorize overwriting current state. If revisions differ, run a *defined rebase/merge of the result against current state* or reject it. The reducer must not close over a stale ProjectSnapshot and commit it wholesale. When switching projects, cancel affected requests, but still guard settled results.

### 4.2 Atomic validated changes

~~~ts
type ValidationIssue = {
  operationId?: string;
  code: 'MISSING_TARGET' | 'CONFLICT' | 'STALE_BASE' |
        'INVALID_VALUE' | 'UNSUPPORTED' | 'INCOMPLETE_INTERPRETATION';
  message: string;
};

type TransactionResult =
  | { ok: true; next: ProjectSnapshot; appliedIds: string[]; inverse?: unknown }
  | { ok: false; issues: ValidationIssue[] };

// Outline only: validate ALL selected operations against same base revision,
// compute a complete next snapshot without publishing intermediate mutations,
// verify graph integrity and user authority, then commit once.
~~~

Never report appliedCount as success if some selected operations were skipped. A no-op does not create a revision. If an operation is valid but conflicts with a confirmed user choice, request explicit replacement approval.

### 4.3 AI relationship proposals

- Extracted and demonstrably explicit relation: may be marked confirmed as source text evidence when the evidence verifier supports it.
- New interpretation lacking source evidence: status=pending, provenance=ai-inferred, proposal listed in Decision Inbox; exclude from prompt compilation until acceptance.
- Rejected relation: do not resurrect during analysis.
- Relationship editor should use selectedRelationshipId in parent state, not always null.
- Renames preserve relationship IDs, endpoint IDs, and aliases; no duplicate names that make target resolution ambiguous.

### 4.4 Natural-language full-clause coverage

Split instruction into syntactic/semantic clauses **without losing meaning**; simple regex splitting alone is not authoritative. Track span IDs for each clause, coveredBy operations, ambiguous spans and unhandled spans.

~~~ts
interface InterpretedBatch {
  instruction: string;
  operations: ProposedOperation[];
  ambiguities: Array<{ spanId: string; reason: string }>;
  unhandled: Array<{ spanId: string; text: string; reason: string }>;
  coverageComplete: boolean;
  baseProjectId: string;
  baseRevision: number;
}
~~~

If local parser handles only a subset, send unresolved clauses plus full context to the Gemini interpreter **without silently discarding parsed clauses**, or display partial coverage and block "Apply All" until the user explicitly chooses a fully understood subset. Recheck AI-supplied target IDs against canonical entities and current revision before applying. Prefer clear warning over guessed implementation. Support English and Turkish instructions through the AI path where authorized; never misrepresent simple local regex as complete multilingual understanding.

### 4.5 Prompt compiler and narrative polish

Treat originalIdea as editable source material with recoverable historical revisions. Construct the current generation prompt from coherent confirmed elements, with explicit overrides, exclusions, renamed entities, directed relationships and Story Bible facts. Avoid contradictory duplicates ("Cat" and "Luna" as separate characters after a rename). Show an unresolved conflict if a safe deterministic transformation cannot resolve it. Consider separating "source text" from "effective scene summary" and "confirmed overrides". Preserve source in export/history.

**AI Narrative Polish** must be a *separate, real* server API flow, not an empty-change call that returns its input. Present original/AI-proposed text side-by-side, verify that changes respect confirmed facts, and require acceptance. If unchanged, say "No change suggested" without creating a revision or claiming a model improved it.

### 4.6 Persistence and recovery design

Choose **one primary durable store**, preferably IndexedDB for structured projects and artifacts, with localStorage only for a small active-project pointer, UI preferences and legacy migration where necessary. Do not retain two uncoordinated authoritative copies. If IndexedDB is unavailable, provide a clearly labeled fallback and limitations.

Use an IndexedDB read-compare-write inside one readwrite transaction to reject stale revisions; advisory BroadcastChannel or storage notifications can prompt refresh but are not the atomic locking mechanism. Handle onblocked, abort, quota, transaction errors; **do not resolve a failed write as success**. A stored revision is acknowledged only on transaction completion. On reload, read from the authoritative store; recover legacy localStorage after migration or detected corruption by explicit user action. Use backup/export for unsupported/corrupt versions.

**Autosave policy:** debounce transient typing; flush on appropriate lifecycle events where supported, but do not promise that pagehide always completes asynchronous writes. Show saved/saving/error/conflict state. On failure preserve in-memory work and offer Retry, Export and Resolve Conflict. Two-tab scenario must be tested in real browsers. Generated images should not rely on huge base64 blobs inside localStorage; consider IDB blobs with bounded quota and explicit eviction policy. Never silently truncate previously saved artifacts.

## 5. UI/UX refinements after P0 stability gates

1. **True Review Changes:** show a before/after comparison of *selected* decisions and batch operations; include current value, proposed value, source, impact, conflicts, undo scope and affected project/revision. "Review Plan & Prompt" must not merely navigate to Story Bible.
2. **Meaningful Accept All:** require scope preview/count and explicit action; exclude rejected, outdated, ambiguous or conflicting items. Bulk acceptance should not secretly accept inference as user intent without visibility.
3. **Persistent relationship Inspector:** select SVG edge → set selectedRelationshipId in App → right Inspector shows directed source/target, predicate(s), alternatives, provenance, edit/remove; preserve graph keyboard selection and accessibility.
4. **Graph-first real estate:** collapse output deck initially or adapt to last user preference, preserve user's pan/zoom and selected node across local edits, allow adjustable columns if complexity justifies it; never hide critical CTA on mobile.
5. **Generic grouping:** replace hard-coded guest grouping with category / user-defined group support when sufficient entities justify it. Avoid adding another control for every sample story.
6. **Search / filter / navigation:** search by entity ID, name, aliases, attributes, relation label, unresolved status; select result focuses graph and inspector. Search must not modify project truth.
7. **Keyboard/Undo:** Cmd/Ctrl+Z within text input should keep native text undo while app-wide undo operates on committed semantic transactions. Display effective shortcut affordances and meaningful history labels.
8. **Prompt output clarity:** show Original Idea, Confirmed Creative Plan, Compiled Prompt, Pending Changes, Generated Story/Image with distinguishable provenance. Avoid labeling the output "updated" unless its content digest differs.
9. **Batch edit preview:** explicitly show "N clauses interpreted, M unresolved", affected entities and directed links, any incompatibility with accepted facts; never auto-apply.
10. **Progressive disclosure:** inspector, Story Bible and history remain accessible but graph is central. Mobile uses focused panel navigation; preserve dark-mode readability and touch targets.

## 6. Security, privacy, cost and operational constraints

- Server-side Gemini credentials only; never return private keys or append them to URLs. Do not log prompts/secrets by default.
- Validate all incoming JSON with shared Zod schemas and size limits; validate Gemini structured results and sanitize user-generated HTML/Markdown when rendered.
- Bound generated output size, context length, concurrent requests and retries; use AbortSignal consistently.
- Deduplicate identical active requests when appropriate; surface rate limits and API errors.
- Warn before image-generation charges when meaningful; Story/Image only by explicit user action.
- Support reasonable offline editing, while accurately labeling AI generation offline/unavailable.
- No new remote database/authentication or collaboration platform without demonstrated requirement and separate approval.
- Keep the existing Node 22/npm or compatible toolchain and correct lockfile; avoid incidental dependency upgrades during stabilization.
- Treat browser local storage as device-local, not cloud backup; provide JSON export for portability.
- Use accessible semantics, keyboard navigation, focus management, responsive layout and meaningful error messages.

## 7. Detailed implementation work packages (test-first)

**Required workflow for every task:** (1) verify baseline and reproduce, (2) write a focused failing test (RED), (3) run it and observe expected failure, (4) implement minimal solution (GREEN), (5) rerun focused + full suite, (6) refactor safely, (7) inspect diff and request independent review where available, (8) commit an isolated logical change; update the verification matrix with commands, exit code and evidence.

### P0-A — Baseline & recovery checkpoint
**Files:** package.json; tests/*; docs/modernization/verification-report.md; git history.
- [ ] Read current main SHA, confirm working tree and AI Studio synchronization. Create checkpoint/backup before code changes (when authorized).
- [ ] Run npm ci, npm run typecheck, npm run lint, npm test, npm run build; record **actual current** outputs and failures; do not reuse previous report as today's run.
- [ ] Record current desktop/mobile UI and relevant AI Studio key availability without exposing secrets.
- [ ] Create a characterization test for each fragile existing behavior before moving its implementation.
**Gate:** baseline documented, backout possible, no code overhaul started prematurely.

### P0-B — Project identity & async causal isolation
**Files:** App.tsx; services/apiClient.ts; server/routes.ts as needed; shared/types.ts; tests/new focused race tests.
- [ ] RED: deferred analysis A resolves after user switches to B, must not change B.
- [ ] RED: old clarification resolves after new edit/Undo/reanalysis, must not revert accepted changes.
- [ ] RED: story/image from A settles after switching to B, must not become B's current artifact.
- [ ] RED: old AI Polish/batch interpretation resolves after newer request, stale UI results blocked.
- [ ] RED: canceled/old request finally block cannot set loading=false while a newer same-action request remains active.
- [ ] Introduce projectId/baseRevision/requestId tickets; compare on application at reducer boundary. Abort on switch where sensible; do not rely solely on AbortController.
- [ ] On same-project intervening edit choose safe merge/rebase or show stale result; never overwrite with old snapshot.
- [ ] Verify racing 2+ operations, project deletion/restore/import during requests, cancellation/errors.
**Gate:** INV-01, INV-02 and INV-11 demonstrably hold with deterministic deferred promises and browser tests.

### P0-C — AI provenance and directed relationship correctness
**Files:** lib/canonicalModel.ts; lib/promptBuilder.ts; shared/types.ts; lib/consistencyChecker.ts; tests/new relationship/provenance tests.
- [ ] RED: AI-inferred new edge remains pending and absent from compiled prompt until accepted.
- [ ] RED: accepted/rejected/deferred decisions are not accidentally erased or reopened by Decision Inbox rebuilding after an unrelated edit.
- [ ] RED: explicit source-backed edge remains confirmed; rejected AI edge not resurrected.
- [ ] RED: A→B "fears" and B→A "protects" coexist through analysis, edit, rename, Undo, save and import.
- [ ] RED: same direction with two distinct predicates not overwritten without selecting actual edge ID.
- [ ] Update merge/upsert/remove by stable directed ID; normalize legacy relationships safely and preserve historical graph meaning.
- [ ] Verify excluded entities cannot leave dangling active edges and contradictory relationships are surfaced.
**Gate:** INV-03 and INV-05 hold; no data-loss migration.

### P0-D — Multi-tab persistence and recovery
**Files:** lib/storageEngine.ts; App.tsx; shared/types.ts/schema migrations; tests/new storage tests.
- [ ] RED: Tab A and B load same revision; A commits first; B's stale write is explicitly rejected.
- [ ] RED: failed IDB write does not report success and does not silently remove artifacts.
- [ ] RED: closing/reloading restores latest acknowledged revision, pending drafts and history.
- [ ] RED: migration from schemaVersion 2 to a new revision-aware persisted version is explicit, reversible by backup, and rejects unsupported future schemas without mutation.
- [ ] RED: corrupt import, incompatible schema, quota exhaustion, IDB unavailable, storage blocked and multiple projects handled without silent loss.
- [ ] Implement one authoritative persistence layer with CAS and surfaced conflict resolution; migration with backup.
- [ ] Adopt asset storage and bounded retention policy that preserves user visibility and gives export/recovery options.
**Gate:** INV-08 holds in realistic two-tab browser tests.

### P0-E — Batch semantics, language coverage and decision authority
**Files:** lib/nlBatchEngine.ts; lib/canonicalModel.ts; components/DecisionInboxPanel.tsx; server/aiService.ts; shared/schemas.ts; tests/new batch tests.
- [ ] RED: instruction with recognized and unrecognized clauses does not report full success.
- [ ] RED: a selected batch with one missing target, stale base, contradictory values or ambiguous reference changes nothing.
- [ ] RED: scoped partial selection applies only intentionally selected valid operations and records one Undo unit.
- [ ] RED: all-guest exception, names sharing substrings, pronouns, reverse edges, multi-sentence instruction, Turkish input and malicious AI operation are handled honestly.
- [ ] Add explicit coverage report per clause, strict operation prevalidation, full diff preview and recheck on apply.
- [ ] Ensure AI cannot approve its own proposed edits; explicit user acceptance required.
**Gate:** INV-04 and INV-09 hold; partial parsing cannot masquerade as complete interpretation.

### P0-F — Prompt compilation, rename/exclusions and undo integrity
**Files:** lib/promptBuilder.ts; lib/historyEngine.ts; lib/canonicalModel.ts; App.tsx; tests/new prompt/history tests.
- [ ] RED: Cat renamed Luna; compiler does not invent a second independent Cat; source remains preserved.
- [ ] RED: excluded entity and its relations do not get effectively reintroduced by source text.
- [ ] RED: explicit confirmed edits supersede stale assumptions; unconfirmed/rejected suggestions are excluded.
- [ ] RED: source text edit, Story Bible edit, batch edit, mode switch and history restore maintain project/revision semantics.
- [ ] RED: undo/redo batch replays exactly; new transaction clears redo; no-op creates no revision.
- [ ] Add a coherent compilation protocol and conflict diagnostics rather than naive duplication; consolidate semantic commits.
**Gate:** INV-06, INV-07 and INV-10 hold with round-trip tests.

### P1-G — AI Narrative Polish and coherent output provenance
**Files:** App.tsx; server/aiService.ts; server/routes.ts; services/apiClient.ts; components/OutputGallery.tsx; tests/new polish/artifact tests.
- [ ] RED: AI Polish with no structured edits either yields an actual model proposal or clearly reports no-op/unavailable; never claims to have polished unchanged text.
- [ ] RED: user rejects AI polish; canonical facts and compiled prompt unchanged.
- [ ] RED: story/image generated at revision R remains bound to R when project changes or newer revision appears; output marked outdated by digest rather than UI guess.
- [ ] Introduce explicit non-destructive review/accept for polish; respect all confirmed constraints.
- [ ] Preserve prior output history or make retention loss explicit and recoverable.
**Gate:** no misleading polish or artifact-currentness reports.

### P1-H — Inspector, decision review and graph navigation
**Files:** App.tsx; components/BeliefGraph.tsx; ContextualInspector.tsx; WorkspaceBottomBar.tsx; DecisionInboxPanel.tsx; tests/browser.
- [ ] RED browser: edge selection opens correct **right-side** directed relation Inspector.
- [ ] RED browser: Review Changes displays actual selected before/after diff and conflict summary, not only Story Bible.
- [ ] RED browser: generic graph search/grouping, pan/zoom preservation, keyboard, large-graph list view and mobile accessibility.
- [ ] Implement inspector selection state and truthful review behavior; consider collapsible/resizable layout only after measuring.
- [ ] Remove sample-specific controls where generic behavior supersedes them; retain necessary functionality.
**Gate:** existing graph editing preserved and UX tasks empirically improve representative scenarios.

### P1-I — Autosave/Undo ergonomics
**Files:** App.tsx; lib/historyEngine.ts; lib/storageEngine.ts; components/OutputGallery.tsx; tests/browser/unit.
- [ ] RED: typing a paragraph produces a small logical number of undoable editing sessions rather than dozens of named revisions.
- [ ] RED: rapid edit → switch project → reload restores correct respective projects and drafts.
- [ ] RED: native undo in an input and app Undo do not interfere.
- [ ] Debounce/coalesce text changes with explicit commit policy on blur/idle/navigation; do not lose last keystrokes.
**Gate:** intuitive Undo and acknowledged autosave.

### P1-J — Reconciliation and documentation verification
**Files:** docs/modernization/*; docs/superpowers/*; README.md; tests/*.
- [ ] Audit all older claims against implementation: e.g. documented BroadcastChannel/projectStore.ts vs actual code and actual IndexedDB recovery behavior.
- [ ] Update old docs via explicit corrections or addendum; preserve historical record and avoid unsupported "all done".
- [ ] Add negative-path tests and traceability from each requirement to test and code evidence.
**Gate:** docs agree with code and validation evidence.

### P2-K — Optional measured UX refinements
- [ ] Measure decision interactions, graph navigation time, rerender and network calls before changing UI.
- [ ] If justified, make output deck collapsed by default, allow bounded resizable panels, generalized grouping, history filtering and smooth large-graph navigation.
- [ ] Do not introduce major UI libraries or new features before P0/P1 pass.

## 8. Testing strategy, code examples and reliable evidence

Use **node:test / tsx** already in package.json for pure state tests, and Playwright for browser races, realistic dual-tab persistence and mobile/desktop flows. Use fake/deferred promises and API mocks to control interleavings; real Gemini smoke tests are separate.

### 8.1 Deferred async race — illustrative test

~~~ts
// Example contract; adapt to actual reducer/controller interface.
test('late project A result cannot mutate project B', async () => {
  const a = createProject('A');
  const b = createProject('B');
  const pendingA = deferred<AiGraphResponse>();
  const app = makeTestProjectController([a, b], { analyze: () => pendingA.promise });
  app.selectProject(a.id);
  const run = app.analyzeCurrent();
  app.selectProject(b.id);
  pendingA.resolve(exampleGraphForA());
  await run;
  assert.equal(app.currentProjectId(), b.id);
  assert.deepEqual(app.getProject(b.id).snapshot.entities, b.snapshot.entities);
});
~~~

Here createProject/deferred/makeTestProjectController are **example test helpers to design**, not current exported functions. Prefer tests against the real integration path over mocks that bypass the commit reducer.

### 8.2 Directed relation contract — illustrative test

~~~ts
test('opposite-direction relations coexist', () => {
  let s = sampleSnapshot();
  s = addDirectedRelation(s, 'cat-id', 'fox-id', 'fears');
  s = addDirectedRelation(s, 'fox-id', 'cat-id', 'protects');
  assert.equal(s.relationships.length, 2);
  assert.deepEqual(
    new Set(s.relationships.map(r => r.sourceId + '>' + r.targetId + ':' + r.label)),
    new Set(['cat-id>fox-id:fears', 'fox-id>cat-id:protects'])
  );
});
~~~

### 8.3 CAS persistence contract — pseudocode

~~~ts
// IDB readwrite transaction is the serialization point.
// 1. const stored = await store.get(project.id)
// 2. if (stored.revision !== expectedRevision) abort with CONFLICT
// 3. validate project + increment revision + await store.put(next)
// 4. await transaction.done
// 5. only then return { ok:true, persistedRevision:next.revision }
// On conflict: DO NOT overwrite; offer reload / inspect differences / export local draft.
~~~

### 8.4 AI inference / prompt contract

- Original: "A cat hosts a party with a fox."
- AI suggests edge "fox secretly envies cat" without evidence → PENDING; generation prompt must not contain jealousy.
- User accepts → CONFIRMED and appears once in generated prompt.
- User rejects → remains absent after reanalysis and reload.

### 8.5 Full-clause coverage contract

- Instruction: "Make the rabbit elderly; rename the cat Luna; remove the table; make all guests polite."
- If parser handles only age + rename, preview must flag the "remove table" and "all guests" clauses as unresolved; Apply All must be blocked.
- User may manually deselect unresolved sections only after seeing a clear coverage explanation; final notification must report accurately what did and did not apply.

### 8.6 Baseline verification commands

~~~bash
git rev-parse HEAD
git status --short
npm ci
npm run typecheck
npm run lint
npm test
npm run build
# When browser runner is available, run real Playwright desktop/mobile/dual-tab tests.
# Use live Gemini only with an authorized configured server-side key.
~~~

If commands are unavailable in AI Studio, label BLOCKED and provide exact requirements; do not claim PASS. Record test name, command, exit status, assertion count, timestamp, browser/device, mock/live status, main SHA and artifacts/screenshots where available. Do not use invented metrics.

## 9. Mandatory 12 acceptance scenarios — ALL APPROVED, ALL UNVERIFIED HERE

**These checkboxes represent work to execute, not completed tests.**

- [ ] **AC01 — Cross-project isolation:** When analyzing Project A and switching to Project B, A's late response never changes B.
- [ ] **AC02 — Multi-tab write integrity:** Simultaneous changes from two tabs never silently overwrite newer data; user sees recoverable conflict.
- [ ] **AC03 — AI relationship approval:** AI-inferred relationship never becomes confirmed before user approval.
- [ ] **AC04 — Contradictory batch rejection:** Two conflicting selected operations fail validation before any commit.
- [ ] **AC05 — No false complete interpretation:** Partially understood natural-language instruction is visibly incomplete, never reported as fully applied.
- [ ] **AC06 — Rename/prompt coherence:** Renaming a character does not create contradictory old/new identities in generation prompt.
- [ ] **AC07 — Directed graph correctness:** A→B and B→A remain distinct and independently editable.
- [ ] **AC08 — Batch undo/redo:** Undo and Redo restore and reapply a whole selected batch as one semantic action.
- [ ] **AC09 — Reasonable text history:** Normal author-note typing does not produce dozens of meaningless revisions.
- [ ] **AC10 — AI Polish honesty:** AI Polish proposes a real model-based change or clearly reports no-op/error.
- [ ] **AC11 — Durable recovery:** After browser close/reload, project and confirmed creative decisions are restored.
- [ ] **AC12 — Live Story/Image integration:** Actual Story and Image API calls are checked in an explicitly authorized environment. If unavailable, report BLOCKED, not PASS.

**Additional acceptance tests from this review:**

- [ ] **AC13 — Stale analysis:** Same-project edits during analysis are preserved; outdated Graph/Clarifications cannot revert the newer state.
- [ ] **AC14 — Project switch during generation:** Output from project A cannot be shown as current artifact of B.
- [ ] **AC15 — Storage quota:** Quota failure never silently deletes historical media; export/recovery offered.
- [ ] **AC16 — Source-preserving overrides:** The original seed remains unchanged, while effective prompt respects confirmed renames/exclusions.
- [ ] **AC17 — Relationship multigraph:** Two different directed relationships between same endpoints coexist with independent IDs.
- [ ] **AC18 — Relation inspector:** Selecting a graph edge opens the right-hand relationship editor, keyboard included.
- [ ] **AC19 — True diff review:** Review Changes shows accurate before/after values and affected entities.
- [ ] **AC20 — Pending refresh:** Refresh questions preserves user draft answers and stable question targets.
- [ ] **AC21 — AI authority:** Reanalysis cannot resurrect a rejected inferred relationship or override confirmed attributes.
- [ ] **AC22 — Revision-aware output:** The outdated badge matches the actual artifact's source revision and prompt digest.
- [ ] **AC23 — Roundtrip:** JSON export/import preserves directed edges, entity IDs, approval states and recoverable history.
- [ ] **AC24 — Realistic mobile:** Belief Graph, Inbox, Inspector and output work in keyboard/touch/mobile and light/dark modes without clipping.
- [ ] **AC25 — Offline/backend errors:** No secret leakage, broken promise handling or falsely successful API status during disabled key/rate limits.
- [ ] **AC26 — No video regressions:** Story/Image work and no video-generation endpoints or controls reappear.

**Acceptance levels:** P0: AC01–AC08, AC11, AC13–AC17, AC20–AC21, AC25–AC26. P1: AC09–AC10, AC12, AC18–AC19, AC22–AC24. P0 may be promoted based on reproduced data-loss risks. AC12 may remain BLOCKED only when live paid calls are not explicitly authorized; do not claim full production-readiness.

## 10. Additional adversarial test matrix

| Situation | Expected behavior |
| --- | --- |
| Two analysis requests for same project finish in reverse order | Newest/current result wins or older result rebases safely; no lost user edits. |
| User renames entity during batch preview | Preview becomes stale and must revalidate before commit. |
| User deletes target after proposal | Apply rejected with target-not-found; no partial transaction. |
| User enters same name for two entities | Require disambiguation; IDs remain stable. |
| User adds two different edges between same nodes | Both persist; selecting exact relationship edits only selected ID. |
| Two conflicting Story Bible vs Scene attributes | Explicit user intent retained; conflict shown and resolved once. |
| User rejects question, then AI rephrases it | Semantic target prevents unnecessary resurfacing. |
| Pending clarification custom answer, then Refresh | Draft preserved and question remains accessible or explicitly outdated. |
| API returns unsupported model/malformed JSON | Safe structured error; canonical state unchanged. |
| User switches Story→Image while Story request pending | Request result not confused with Image; UI honest about which project/mode it belongs to. |
| Browser storage is disabled/private/quota-full | Recoverable error state, no misleading "Saved". |
| Import unknown schemaVersion > supported | Clear rejection; existing project untouched, raw file not discarded. |
| Long author notes, fast typing, Undo on Mac | Native editor undo and project-level undo are predictable. |
| No-op Accept/Reject or same-value edit | No meaningless new project revision. |
| Huge graph (25/100/250 nodes) | Graph/list usable, controllable performance, stable layout, no visible clipping. |
| Mobile switch to Inspector then back | Selection remains stable, focus visible and editable. |
| Model-suggested negative relationship | Clearly pending; explicit user rejection persists after reanalysis. |
| Old request finally resolves after a newer request starts | Newer request's loading/progress indicator remains correct. |
| Autosave in two tabs with identical wall-clock timestamps | Logical revision/CAS rather than Date.now ordering detects conflict. |

## 11. Verification reporting and completion gates

Use exactly these terms:
- **PASS:** check was executed during this run and evidence is recorded.
- **FAIL:** attempted check failed; provide reproducible steps and root cause.
- **BLOCKED:** not executable for a concrete environment/credential/tool restriction.
- **NOT RUN:** not attempted; no inferred success.
- **N/A:** not relevant with explanation.

**No completion claim** unless tests, typecheck, lint, build and relevant browser scenarios were run afresh and the outputs read. Do not relabel a failed test because it is unrelated; report it accurately. On failure, apply Superpowers systematic debugging (reproduce → root cause → smallest test → minimal fix → verify), not retrying random changes. Review code changes independently after every task and before merging/deploying.

**Artifacts to produce:** numbered test matrix and evidence, file-level change summary, explicit baseline/head SHA, migration notes, updated user guide, known limitations, API model status and cost considerations, before/after UX screenshots, measurable interaction-count comparisons (not fabricated).

**Milestone gates:**
- Gate 0: baseline and backup.
- Gate 1: no cross-project/stale async mutations.
- Gate 2: AI inference approvals + directional relationship integrity.
- Gate 3: atomic, full-coverage batch editing.
- Gate 4: durable multi-tab storage, recovery, coherent Undo.
- Gate 5: prompt compiler, AI polish and output provenance correct.
- Gate 6: responsive inspector/review UX, feature preservation.
- Gate 7: complete verification and docs concordance. Do not proceed if a critical earlier gate fails.

## 12. Superpowers six-cycle refinement record — PASS ONE

This is a structured **design review of recommendations**, not a report that product code was executed.

1. **Intent/Brainstorming:** Reframed objective from "fewer clicks" to preservation of user creative intent plus lower cognitive overhead; separated non-goals.
2. **UX & Friction:** Kept 3-panel graph-centric UX while changing priority from cosmetic resizing to correct review and relationship inspector behavior.
3. **Data Architecture:** Replaced timestamp-based concurrency assumptions with logical revisions; specified a single authoritative persistence store and directed relationship IDs.
4. **AI Control:** Made suggestion approval, full-clause coverage and explicit source evidence mandatory; separated AI Polish proposal from final canonical prompt.
5. **Feasibility/Testability:** Split work into P0 identity, provenance, persistence, batch and prompt tasks with test-first gates; forbid vague "done" status.
6. **Adversarial Review:** Added cross-project generation races, stale batch preview, quota loss, reverse edges and archived output provenance to acceptance scenarios.

## 13. Superpowers six-cycle refinement record — PASS TWO

Second independent critique focused on hidden assumptions and implementation handoff quality.

1. **Intent & Preservation:** Confirmed that user-approved 12 checks are requirements, **not evidence**; preserved existing Story/Image, Belief Graph and platform.
2. **UX Practicality:** Deferred layout polish until correctness; minimized new controls; required real before/after review instead of another screen. Preserved originalIdea editing while making its prior revisions recoverable.
3. **State Correctness:** Tightened "revision >= base" caveat: it never permits blind overwrite; clarified IDB atomic CAS and project-safe request handling.
4. **AI Reliability:** Added AI-extracted relationship source verification, explicit unsupported clause markers, model/no-op polish honesty, and Turkish input handling without pretending complete local parsing.
5. **Testing Completeness:** Added unavailable backend, latest-artifact digest, old-schema import, missing targets, duplicate names, edit-in-flight, and two-tab real-browser cases.
6. **Independent Builder Review:** Removed assumptions that non-existent projectStore.ts or BroadcastChannel are already implemented, labeled code sketches illustrative, and required fresh command evidence rather than inherited PASS status.

## 13A. Acceptance-to-task traceability (added during post-write review)

Each acceptance item must have at least one **executed** test, a responsible work package and evidence in the final verification report. These are planned owners, not completed tests.

| Work package | Primary acceptance coverage | Required evidence |
| --- | --- | --- |
| P0-B — async identity | AC01, AC13, AC14, AC22 | deferred-promise integration tests, project-switch browser test, stale-result log without private data |
| P0-C — AI provenance / directed graph | AC03, AC07, AC17, AC21 | pure model tests, rename + import roundtrip, graph relationship E2E |
| P0-D — persistence / recovery | AC02, AC11, AC15, AC23 | two actual browser tabs, reload tests, storage error injection, import validation |
| P0-E — batch editing | AC04, AC05, AC08, AC20 | malformed/ambiguous operations, clause coverage, atomic rollback and Undo tests |
| P0-F — prompt / history | AC06, AC09, AC16 | seed rename/exclusion compiler tests, author notes Undo grouping |
| P1-G — polish/artifact trace | AC10, AC12, AC22 | AI polish nonempty/no-op test, model API only when authorized, digest/revision test |
| P1-H — inspector and interaction | AC18, AC19, AC24 | Playwright mouse/keyboard/mobile screen tests with selected relation and actual diff |
| P1-I — editor usability | AC09, AC11 | typing burst, blur, reload and undo keyboard tests |
| P1-J — docs/API QA | AC25, AC26 | security tests, removed-video checks, fresh report with source SHA |

If one acceptance criterion spans packages, designate a single accountable owner and verify its dependencies in the other packages. In particular, AC12 is **BLOCKED** unless paid live testing is authorized and credentials are configured securely; mocked route tests must not count as live verification.

**Post-write review corrections:** This plan deliberately does **not** freeze originalIdea against user edits; instead, original seed edits are undoable and prior versions recoverable. Concurrent loading indicators, terminal decision provenance, and explicit schema migration were promoted into tests. The file's numbered cross-reference points to Section 9, where the user-approved scenarios actually appear.

## 14. Required handoff, checklist and reporting format

The implementation agent must produce a short **per-milestone report**:

~~~text
Milestone:
Baseline SHA / Working SHA:
Tests written (names):
RED result and expected reason:
Changes (files):
GREEN and full suite result:
Typecheck/Lint/Build:
Browser / real API verification:
Independent review findings + resolution:
Known regressions or limitations:
Acceptance IDs newly PASS (with evidence):
Next milestone / rollback pointer:
~~~

**Do not begin a new milestone if prior P0 gate is FAIL.** Address critical new defects before UX polishing. If no tests can run due to missing tool access, work should be marked BLOCKED and concrete reproduction and next steps documented; do not fabricate results. User may choose to continue partially, but risk must be explicit.

## 15. Reading order and precedence for an AI Studio agent

1. Read this entire file; summarize preserved features and 12 approved checks before touching code.
2. Inspect latest main, code, existing docs/superpowers/specs/2026-11-14-proactive-co-creator-2-design.md, docs/superpowers/plans/2026-11-14-proactive-co-creator-2-implementation.md, and docs/modernization/verification-report.md. Resolve discrepancies in favor of observed code and explicit new requirements.
3. Perform Superpowers brainstorming and concise design alternatives; apply the six-cycle refinement to current implementation tasks before beginning; use writing-plans with small tasks.
4. Establish baseline, backup/checkpoint and tests; then implement P0/P1 in sequence, using TDD, systematic debugging and verified code review.
5. Apply **a second six-cycle critical review** to the implemented code, test coverage, documentation and UX before final completion; repair findings with fresh RED→GREEN evidence.
6. Report exact progress, failures, blocked tests and remaining costs. Do not claim LIVE Gemini or "production ready" when key-dependent operations were not tested.

**This document only instructs future implementation. Its creation does not fix the app, run acceptance tests or authorize paid APIs.**
