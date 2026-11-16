# Proactive Co-Creator — Independent Audit Remediation & Verification Plan

> **Google AI Studio implementation handoff — Phase 2 stability follow-up**
> **Document created:** 2026-11-16
> **Repository:** https://github.com/Centaurioun/Proactive-Co-Creator
> **Source audit:** An independent, read-only technical report supplied by the project owner on 2026-11-16 (in Turkish). The audit inspected commit `fa96d6a6d4fbbca3b77379fdce497ff0c6e14784`.
> **Reference SHA for this document's static review:** `fa96d6a6d4fbbca3b77379fdce497ff0c6e14784`.
> **Status:** **REQUIREMENTS AND VERIFICATION PLAN — NOT IMPLEMENTED BY WRITING THIS DOCUMENT.**
> **Precedence:** Read this file alongside `docs/modernization/2026-11-16-stability-consistency-ux-master-plan.md`, not as a replacement for it. This new file captures **a second independent audit** and newly surfaced post-implementation risks. If source code at latest main differs, verify the current behavior first; do not reapply obsolete fixes.
> **Owner's intended executor:** Google AI Studio after the user synchronizes the repository's `main` branch.
> **Allowed implementation:** application code, tests and documentation **during the later AI Studio execution**; during this documentation commit, **only this Markdown file is changed**.
> **Language of implementation instructions:** English for reproducibility; user-facing report may be Turkish.

---

## 0. Mission, assumptions and evidence discipline

The independent reviewer found a well-formed React/Express/Gemini creative-workspace architecture but uncovered cases where **the UI does not enforce invariants that helper libraries ostensibly support**. This is not an invitation to rewrite the app. Apply tightly scoped, test-first fixes addressing actual behavior.

**Preserve** Story generation, Image generation, Belief Graph, directed multigraph semantics, Clarifications, Story Bible, Decision Inbox, Contextual Inspector, batch preview/editing, Undo/Redo, project import/export, revision history, dark mode, mobile UI, server-side Gemini secrets, and previously working user journeys.

**Do not** reintroduce Video, redesign the whole UI, add a state-management framework by default, add a cloud database or public authentication flow without confirmed deployment need, abandon the current technical stack without a concrete blocker, or mark tests as passed without running them.

**Source provenance and confidence:**
- `CONFIRMED—STATIC` means the independent auditor identified a reproducible-looking code path and line references; it does **not** mean it ran the app.
- `PLAUSIBLE—UNVERIFIED` is a hypothesis requiring a test, measurement or deployment fact.
- This handoff additionally inspected the referenced `App.tsx`, `DecisionInboxPanel.tsx`, `nlBatchEngine.ts`, `projectController.ts`, `storageEngine.ts`, `server.ts`, `schemas.ts`, README and tests through the GitHub connector. This is not a fresh runtime test.
- The report's own caveat: `npm test`, `npm run lint`, `npm run typecheck`, `npm run build`, Playwright and live Gemini checks were **not run by the independent auditor**.
- The repository's earlier verification report claims 47 passing tests; do not convert that historical claim into fresh test evidence.
- Revalidate the exact **latest main SHA** on starting. If the problem has been fixed since `fa96d6`, record **ALREADY FIXED + verification** rather than introducing duplicate patches.

### 0.1 Non-negotiable product integrity invariants

1. **Correct project:** No change drafted for project A may be committed to B, even if both use the same entity names or Story Bible fields.
2. **Correct revision:** No old proposal, AI response, Restore or Undo write may silently override newer confirmed decisions. Resolve conflicts by safe rebase or explicit re-preview.
3. **Durable save:** A displayed "Saved" state must correspond to acknowledged persistence of the **same** revision and content.
4. **Single recovery truth:** Loading a project must recover the latest valid full snapshot, revision, metadata and artifacts, not combine an old snapshot with recent media silently.
5. **Honest AI proposal:** AI Polish, inferred relationships and batch edits are proposals requiring appropriate validation and user acceptance.
6. **Atomic user operations:** Contradictory, stale or invalid batch edits cannot silently partially apply and report success.
7. **Recoverability:** Deletion, schema migration, storage quota and browser interruption must not produce silent data loss or silently retain deleted private data.
8. **Consistent identity:** Directed edges, entity IDs, approved attributes, history and effective generation prompt remain coherent.
9. **Measured readiness:** Only actual executed checks count as PASS; simulated model calls and no-op UI checks cannot stand in for live integration verification.

---

## 1. Independent audit findings — exact scope, impact and verification

The findings below preserve the independent review's IDs and **initial** priorities. Their labels are conditional on confirmation against current main; they are **not declarations that the current app was runtime-tested**.

### F-01 · P1 · Stale Batch Edit proposal bypasses project/revision check

**Original independent evidence:**
- `lib/nlBatchEngine.ts` creates `baseProjectId` / `baseRevision` and `validateProposedOperations` supports a `STALE_BASE` check (reported ~L161–170 and ~L630–651).
- `App.tsx` `handleApplyBatchOperations` sends `expectedBaseRevision: activeProject.revision` and `currentRevision: activeProject.revision` — **the same current value**, so the mismatch guard cannot fire.
- `components/DecisionInboxPanel.tsx` passes `operations` and `instruction`, dropping original proposal project and revision. Its local preview can outlive a project switch and currently closes immediately after callback rather than receiving verified success/failure.

**Impact:** A preview created in project A/revision 10 could apply to B or A/revision 11, changing valid current data.

**Required design:**
- Carry an immutable preview envelope including `projectId`, `baseRevision`, `proposalId`, `instruction`, selected operations and any unresolved clauses through the UI handler.
- Compare that envelope to the current authoritative project **at commit time**. Prevent cross-project or stale-revision apply. Show a stale-preview reason and offer to regenerate, discard or manually inspect before replay.
- Return a typed success/failure result from `onApplyBatchOperations`; clear the preview **only after a successful atomic commit**. On failure keep user's instruction, selections and preview visible.
- A revision mismatch must not be "fixed" by setting both expected/current to latest; accept an explicit user-requested rebase only after recalculating and reviewing a new diff.
- Do not introduce an unnecessary separate global state manager to accomplish this.

**Fail-first tests:**
- Create preview in A/r10 → switch B/r5 → attempt Apply → B untouched; preview retained with meaningful error.
- Preview A/r10 → change A to r11 → old preview rejects without editing r11.
- Valid same-project/same-revision edit succeeds exactly once; duplicate Apply cannot repeat it.
- Invalid batch operation leaves all selected modifications unapplied.

**Files to inspect:** `App.tsx`, `components/DecisionInboxPanel.tsx`, `lib/nlBatchEngine.ts`, `lib/projectController.ts`, `shared/types.ts`, integration tests.

**Acceptance:** stale/cross-project proposal cannot commit; clear failure UI; no regression for valid previews.

### F-02 · P1 · IndexedDB latest project snapshot not fully hydrated

**Evidence:**
- `App.tsx` starts from `loadProjectsFromLocalStorage()`.
- Later IndexedDB hydration may put a newer full project into `savedProjects`, but `setProject` merges only **artifacts** from IndexedDB, leaving old `snapshot`, `revision` and `persistedRevision` active.
- In `App.tsx` the autosave path treats localStorage and IndexedDB as separate writes; the IndexedDB save is dispatched without its result being used to resolve save success.
- `tests/masterPlanStability.test.ts` AC15 checks in-memory media on quota failure, not full snapshot recovery after reload.

**Risk scenario:** localStorage r5; IndexedDB r6; reload → active editor shows r5 while other parts may contain r6. Another save could worsen divergence.

**Required design:**
- Decide and document the **authoritative persistence source**. Preferred: IndexedDB for full structured projects + media, localStorage for small activeProjectId/preferences and one-time legacy migration.
- Define a **safe migration** before removing old saved data. Backup prior localStorage project records; support old schema and incomplete IndexedDB; never reset a valuable user project merely because a read fails.
- Do a deliberate initial hydration before marking storage "ready", or use a guarded reconciliation that atomically replaces the entire active project and its Undo state from the latest valid source.
- Persist revision/counter, snapshot, artifacts and history consistently. Loading must not splice unrelated revisions together.
- Return and inspect IDB transaction completion/failure. Treat quota, abort, blocked storage, and migration failures as visible states with export/retry paths.
- Use revision-based read-compare-write inside a **single IndexedDB readwrite transaction** for the authoritative store. BroadcastChannel/storage notifications may be added for UI awareness, but they do not replace atomic save conflict enforcement.
- Explicitly plan for concurrent tabs, switching projects during hydration, and storage failures; do not allow a late hydration result to replace a newer in-memory edit.

**Fail-first tests:**
- localStorage r5 + IndexedDB r6 → reload → complete r6 snapshot and artifacts visible.
- localStorage write quota failure but IDB r6 save succeeds → reload recovers r6.
- IDB unavailable/corrupt → understandable fallback and no silent destructive overwrite.
- Two tabs begin at same revision → second conflicting write rejected/resolved.
- No duplicate project creation from legacy migration.
- The "Saved" indicator represents **actual durable acknowledgement**, not optimism.

**Files:** `App.tsx`, `lib/storageEngine.ts`, `shared/types.ts`, migration tests and two-tab Playwright tests.

**Acceptance:** deterministic, complete, recoverable hydration; trustworthy save/conflict state.

### F-03 · P1 · AI Polish proposals accepted after source context changes

**Evidence:**
- `App.tsx` stages polished prompt returned by async request.
- `lib/projectController.ts` `acceptAiPolishProposal` checks `project.id === proposal.projectId` but not `baseRevision`, or original prompt fingerprint.
- `App.tsx` accept handler calls this helper without an explicit stale guard.

**Risk scenario:** user requests polish at revision 8, changes Story Bible to r9, then accepts old polished text drafted from r8. The polished prompt may omit a newly confirmed constraint.

**Required design:**
- Freeze source revision and normalized prompt digest in the proposal.
- On **accept**, verify project identity, revision, source digest and current confirmed fact constraints. If stale, reject and offer re-polish or comparison; preserve old suggestion as an explicitly stale draft if useful.
- If the polished text truly matches current facts, allow intentional user review; never silently merge the old text.
- Treat acceptance as one undoable semantic transaction. Avoid a long-lived "accepted polish" disconnected from the canonical prompt compiler; define whether it's a style overlay, a user-approved prompt variant, or a derived artifact. Subsequent structural edits must not silently strip confirmed facts.
- Return `StaleProposal` / `Accepted` / `NoChange` explicitly.

**Fail-first tests:**
- Valid polish proposal accepted once, Undo restores prior prompt.
- Story Bible changed during request → stale acceptance does not modify refined prompt.
- Same project but prompt manually edited between draft and Accept → stale acceptance rejected.
- Switching project → wrong project's prompt unchanged.
- AI produces identical text → clear no-op, no new revision.
- AI API error → no misleading "Polished" claim.

**Files:** `App.tsx`, `lib/projectController.ts`, `lib/promptBuilder.ts`, `OutputGallery.tsx`, route/model tests.

### F-04 · P2 · Undo/Redo changes content without monotonic durable project revision

**Evidence:** `App.tsx` `handleUndo` / `handleRedo` change `undoState`; `activeProject` derives its snapshot from it without incrementing durable `project.revision`. Storage CAS relies on logical revision.

**Impact:** Two different saved contents may carry the same revision, weakening multi-tab conflict detection, artifact freshness and history traceability.

**Required design:**
- Treat Undo/Redo as a **new durable semantic edit** restoring old contents, but advancing the monotonic persisted project revision.
- Distinguish *history cursor* from *durable version number*.
- Preserve Undo/Redo stack behavior: undo → redo stays possible; making a new divergent edit clears incompatible redo branch. Do not accidentally append recursive entries to the UI undo stack.
- Integrate revision increments at the single transaction boundary, not in numerous component handlers.
- Be mindful of a storage revision CAS migration from legacy user projects; back up and test.

**Tests:** edit → save → Undo → save → reload; two tabs with Undo conflict; redo after Undo; redo invalidation; no-op doesn't bump revision; artifact currentness correct.

**Files:** `App.tsx`, `lib/historyEngine.ts`, `lib/projectController.ts`, persistence.

### F-05 · P2 · README `.env.local` instructions may not reach Express process

**Evidence:** README documents `cp .env.example .env.local` and `npm run dev`; dev script executes `tsx server.ts`; server reads `process.env.GEMINI_API_KEY` without clearly loading `.env.local` itself. Vite's own env handling doesn't imply automatic loading into the host Node process.

**Required design:**
- Reproduce first in a clean local environment with no inherited GEMINI_API_KEY, only `.env.local`.
- If unconfigured, explicitly load server environment using a supported Node/tsx mechanism or a safe configuration utility; retain hosting/AI Studio secret priority and never expose secrets via `VITE_*` or client bundling.
- Correct README to match the verified startup behavior.

**Test:** clean environment, `.env.local` provided → health/config state indicates configured without printing key; unset → safe not-configured result; production env overrides appropriate local fallback. No paid API call necessary.

### F-06 · P2 · Deletion removes localStorage record but leaves IndexedDB copy

**Evidence:** `App.tsx` `handleDeleteProject` invokes `deleteProjectFromLocalStorage`; the helper mutates only localStorage. Full IDB project and media remain.

**Required design:**
- Delete project from **all authoritative storage locations**; don't silently resurrect the deleted project on hydration or migration.
- Handle in-flight saves and hydration; use transaction order or tombstones/epoch if needed, but avoid speculative distributed-state machinery for a single-browser app.
- If deleting last project creates a sample replacement, keep that behavior deliberate and documented; deleted project IDs must not be reused.
- Show a clear deletion confirmation for destructive operations and truthful partial-failure status.
- Address user expectations: local deletion is not deletion from remote services that were never storing the project.

**Tests:** delete record in both stores; reload no resurrection; deletion concurrent with autosave; quota/delete failure; last-project fallback. Existing other projects preserved.

### F-07 · P2 · Client/compiler can exceed server's 8,000-character prompt schema

**Evidence:** `shared/schemas.ts` `NonEmptyPromptSchema.max(8000)`; prompt entry does not enforce the limit, and `lib/promptBuilder.ts` can lengthen the effective prompt with Story Bible, attributes and links.

**Required design:**
- First trace which endpoints actually use the 8,000-character schema and whether generated story/image prompts use it; avoid falsely claiming every route is affected.
- Decide a supported limit from actual API schema and model constraints; distinguish characters, tokens, request size and model limits.
- Validate *effective compiled prompt* at point of submission, not just originalIdea.
- Provide a visible, actionable length explanation before launching a paid operation; do not truncate silently or delete confirmed facts.
- If increasing schema limit is safe, do so deliberately with server and client validation kept in sync.
- Avoid falsely implying a token count is a character count.

**Tests:** exactly at limit; one beyond limit; prompt length grows after confirmation; Story/Image-specific schema; appropriate UI message; no unintended API charge.

---

## 2. Plausible risks (not confirmed defects) — verify conditionally

| ID | Initial priority | Independent auditor's claim | How to verify | Policy |
| --- | --- | --- | --- | --- |
| R-01 | Conditional P1 | Publicly deployed `/api/generate/images` and other costly Gemini routes may lack auth/quotas; anyone could consume server budget. | Determine actual exposure and provider gateway protections; inspect rate limits, auth, network policy, usage controls. | Only require app auth/rate-limit architecture if publicly accessible. Protect Gemini spend; don't force user accounts on a local-only tool. |
| R-02 | P2 | Some async callbacks capture stale `savedProjects` before `setSavedProjects(applied.savedProjects)`; updates may overwrite recent projects. | Deferred 2-project completion tests, both ordering permutations, reload check. | Fix only if reproducible or direct static path proves unsafe. Prefer functional/reducer updates over captured arrays. |
| R-03 | P2 | Large graphs might become slow. | Measure 50/200/500 nodes: layout, interaction latency, memory and focus behavior on representative desktop/mobile. | No premature graph rewrite without measurements. |
| R-04 | P2 | Native TypeScript startup may vary with Node version. | Test documented Node matrix, `npm start`, `npm run dev`, CI. | Specify supported Node runtime; avoid guessing or broad infrastructure changes. |

**Other conditional investigations, introduced by the source report's findings:** environmental loading when production secrets are configured; atomic persistence and the localStorage quota path; security headers and content injection; generated media storage size; ambiguous AI batch language; logout/deletion semantics only if accounts exist. These are *audit questions*, not permission to expand scope indefinitely.

---

## 3. Targeted UX/accessibility improvements

### U-01 · Real Before/After change comparison
The `App.tsx` review modal currently summarizes pending decisions, history and an authoritative prompt; despite the "Prompt Diff" label it does not present a true previous/proposed comparison for every selected change.

**Implement:** current value → proposed value per affected property/entity/edge; source/provenance, conflicts, affected project and revision. If there are no staged changes, say so rather than inventing a diff. Preserve screen-reader headings and keyboard flow.

**Test:** select 3 different proposed changes, edit one, reject one → preview correctly shows exactly what will be applied and how the effective prompt will differ. Avoid a misleading diff between unrelated historical snapshots.

### U-02 · Do not close failed batch preview
`DecisionInboxPanel.tsx` clears its preview immediately after invoking the apply callback. Correct with F-01: the callback should return a typed result; close only after verified application. Error retains selected operations and the user's text.

**Test:** stale preview, conflict, missing target, storage conflict; all retain editable preview with precise message. Success clears preview once.

### U-03 · Accessible Review modal
`App.tsx` custom `role="dialog"` is missing visible Escape and focus-management behavior in inspected code.

**Implement:** Escape close, initial focus, Tab/Shift+Tab containment while modal open, focus return to opener, screen-reader naming, backdrop behavior, no background interaction. Consider native `<dialog>` or an existing accessible implementation; do not add a large UI library for one modal without justification.

**Test:** keyboard-only open/navigate/close, screen-reader semantics, mobile focus and scroll.

### U-04 · Preserve what's already strong
The independent audit explicitly rejected several plausible false alarms:
- Belief Graph already includes keyboard focus, labels and key handling; do not claim it is entirely inaccessible.
- Gemini SDK and secret handling are server-side; do not claim client key leak without evidence.
- Model names were found in contemporary reference documentation; don't replace models based on their appearance alone.
- Graph performance has not been measured; don't assume force layout is broken.
- The existing three-panel experience is worth preserving rather than rebuilding.

### U-05 · Documentation accuracy
Independent audit reports `README.md` claims 60 Undo steps while `lib/historyEngine.ts` uses `MAX_UNDO_STACK = 40`; README also describes D3 zoom/pan while the current code uses React pointer events without D3 dependency.

**Implement:** recheck current source and update README to observed behavior. Do not add D3 simply to make documentation true. Update old PASS claims with date and SHA rather than rewriting history.

---

## 4. Architecture contract — practical, minimal and project-aware

Keep the existing `lib/projectController.ts`, `lib/historyEngine.ts`, `lib/storageEngine.ts`, `lib/nlBatchEngine.ts` and `CreativeProject` model unless evidence demands a narrower refactor. Avoid a sweeping Redux/event sourcing migration.

### 4.1 Immutable proposal context

~~~ts
// Example interface sketch, not a currently available export.
interface ProjectMutationContext {
  projectId: string;
  expectedRevision: number;
  operationId: string;
  sourcePromptDigest?: string;
}

interface StagedBatch {
  context: ProjectMutationContext;
  instruction: string;
  operations: ProposedOperation[];
  acknowledgedUnhandledClauses: boolean;
}

type CommitResult =
  | { ok: true; appliedCount: number; revision: number }
  | { ok: false; reason: 'WRONG_PROJECT' | 'STALE_REVISION' |
      'VALIDATION_FAILED' | 'PERSISTENCE_CONFLICT'; details: string[] };
~~~

Do **not** trust the currently selected UI project to supply `expectedRevision`; carry the original preview's revision. Validate at the commit/reducer boundary. The UI controls display a result, they do not determine causal safety.

### 4.2 Consistent persistence / CAS

~~~ts
// Pseudocode — adapt to actual IDB transaction implementation.
async function commitProject(expectedRev: number, candidate: CreativeProject) {
  // Begin ONE IDB readwrite transaction for this project's record.
  // Read existing stored revision.
  // If existing.revision !== expectedRev: reject with conflict (no writes).
  // Validate candidate and monotonic candidate.revision > existing.revision.
  // Put entire project and any related atomic metadata.
  // Await transaction completion, handle quota/abort/block.
  // Only THEN report saved revision and update UI acknowledgement.
}
~~~

An advisory `BroadcastChannel` can notify other tabs, but message receipt is **not** the concurrency guarantee. If migration requires staged fallback, explain and test its invariants.

### 4.3 AI Polish proposal acceptance

~~~ts
// Example rule, not a drop-in implementation.
function canAcceptPolish(
  current: CreativeProject,
  proposal: AiPolishProposal
): boolean {
  return proposal.projectId === current.id &&
    proposal.baseRevision === current.revision &&
    digest(current.snapshot.refinedPrompt) ===
      digest(proposal.originalPrompt);
}
~~~

The prompt digest is an additional source-of-truth check; don't use it instead of revision when unrelated confirmed edits could change generated instructions. The polished result itself should not bypass canonical constraints.

### 4.4 Correct revision semantics

A semantic mutation increments a monotonically increasing persisted revision. Undo/Redo changes the current content to an earlier/later snapshot **but creates a new persisted state revision**. A revision ID and the Undo stack cursor are not the same thing. Strictly define whether UI undo should be disabled when a persistence conflict occurs.

### 4.5 Environment and input limits

Use a Node/tsx-supported server env loader for local dev; production and AI Studio server-side Secrets take priority, and secrets never go to client. Use an explicit shared validation rule for API-bound effective prompt length. Keep user-entered long drafts editable and saved even when they cannot yet be sent to a particular generation endpoint.

---

## 5. Implementation packages and dependency order

**Mandatory process:** Superpowers Brainstorming → concise design decision → Writing Plans → test-first tasks → Systematic Debugging on failures → independent code review → Verification Before Completion. If a skill/agent is unavailable, use its procedural equivalent honestly; never claim to have invoked an unavailable tool.

Every task must have: exact affected files, test name, observed RED failure, minimal GREEN fix, full regression run, code review, acceptance outcome, and revert pointer.

### Stage 0 — Baseline and branch safety (read first)

- [ ] Record HEAD SHA and compare with source-audit `fa96d6`; read the earlier master plan, recent test additions, README and code.
- [ ] Inspect dependency scripts and `git status` before touching files.
- [ ] Establish a recoverable Git checkpoint or archive; source of truth remains the user's connected main branch.
- [ ] Run `npm ci`, `npm run typecheck`, `npm run lint`, `npm test`, `npm run build`; record **actual** output and failures.
- [ ] Establish baseline browser Story, Image, Review modal, Batch Edit, AI Polish proposal, IDB load/save/delete and keyboard interactions.
- [ ] Confirm no proprietary API secrets or paid billing actions are required by basic tests.
- [ ] For each F-item, verify whether the implementation at current main still allows the issue; if not, record ALREADY FIXED and test evidence. Do not blindly apply suggested code.

### Stage 1 — Prevent harmful stale user actions (highest priority)

**Owners:** F-01, F-03; U-02; relevant R-02.

- [ ] Write failing UI/controller tests for cross-project and stale-revision Batch Edit.
- [ ] Preserve full preview envelope through accept/reject; have apply return typed result.
- [ ] Keep failed previews and explain stale/conflict reason.
- [ ] Write failing AI Polish acceptance tests after intervening Story Bible and prompt edits.
- [ ] Check proposal revision and digest before commit; preserve rejected/stale draft.
- [ ] Inspect async savedProjects closures; add a regression test if necessary.
- [ ] Run complete automated suite and browser tests; independent focused review.

**Gate:** no stale or wrong-project proposal can mutate confirmed project state; prior successful behavior intact.

### Stage 2 — Storage authority, migration and deletion (structural; no rushed rewrite)

**Owners:** F-02, F-04, F-06; R-02 if reproduced.

- [ ] RED test: localStorage r5 / IndexedDB r6 → reload must recover complete r6 state.
- [ ] RED test: quota failure in localStorage, successful IDB write, reload latest revision.
- [ ] RED test: concurrent-tab CAS, including Undo.
- [ ] Document migration and rollback. Preserve originals until successful migration is verified.
- [ ] Make one authoritative durable store, avoid mixed-version hydration, display save acknowledgement only after transaction completes.
- [ ] Make Undo/Redo edits monotonic revisions while preserving UI history semantics.
- [ ] Delete records from all appropriate local stores; prevent autosave resurrection.
- [ ] Test storage denial, quota, legacy migration, exports, interrupted saves and multiple projects.
- [ ] Review full data migration by comparing pre/post exported state.

**Gate:** no silent data loss, no mixed-version active project, no deleted-project resurrection.

### Stage 3 — Local config and effective prompt size

**Owners:** F-05, F-07.

- [ ] RED clean-process test: `.env.local` only and no inherited API key.
- [ ] Select minimal secure server env loading and update README.
- [ ] RED tests for exactly 8,000 and 8,001 chars on affected API endpoints (or revised documented limits), including compilation growth.
- [ ] Validate effective prompt before submission; no silent truncation or false "ready".
- [ ] Check Story and Image API path independently and preserve long local drafts.

**Gate:** setup docs reflect actual runtime, invalid inputs produce useful client error before costly network calls.

### Stage 4 — UX repair without redesign

**Owners:** U-01, U-02, U-03, U-05.

- [ ] Implement meaningful before/after diff for selected changes.
- [ ] Keep Review modal open on failed batch action with actionable issue text.
- [ ] Implement tested Escape/focus/return-focus semantics.
- [ ] Correct README Undo depth, library descriptions and any other documentation drift.
- [ ] Measure whether new UX improves correct completion rather than just click count.

**Gate:** tested desktop/mobile, pointer/keyboard flows; no lost graph/Inspector functionality.

### Stage 5 — Conditional security and performance validation

**Owners:** R-01, R-03, R-04.

- [ ] Determine whether the deployed app is publicly exposed and which external auth/billing gateway protections exist.
- [ ] If public, add an approved minimal abuse-control design: quotas, rate limiting/concurrency, usage caps, auth as appropriate, and monitoring. If only private/local, report N/A with evidence.
- [ ] Benchmark graph with representative small/large node counts before proposing optimization; fix measured bottlenecks only.
- [ ] Verify documented Node runtime with production start/dev paths.
- [ ] Confirm server key never reaches JS bundle, logs, URLs or public responses.

### Stage 6 — Final adversarial verification and delivery

- [ ] Fresh full TypeScript/lint/test/build check.
- [ ] Playwright real dual-tab/reload/undo and desktop/mobile keyboard checks.
- [ ] Confirm no video, no new unnecessary framework/dependency, Story/Image preservation.
- [ ] Run live Gemini Story and Image smoke tests **only if explicitly authorized, provisioned and cost-aware**. Otherwise mark BLOCKED.
- [ ] Update verification report with SHA, commands, exit code, count, environment and evidence.
- [ ] Run second six-cycle critical code/test/doc review; repair genuine findings with RED→GREEN.
- [ ] Deliver precise changed-file list, accepted risks, migrations, rollback notes and remaining BLOCKED items.

---

## 6. Independent audit acceptance matrix (not currently passed)

| Test ID | Audit finding | End-to-end acceptance proof | Priority |
| --- | --- | --- | --- |
| IA-01 | F-01 | Preview from project A cannot apply to B. | P1 |
| IA-02 | F-01 | Preview from revision r10 cannot apply to changed r11 without review. | P1 |
| IA-03 | F-01/U-02 | Failed batch retains text, selections and error; successful applies once. | P1 |
| IA-04 | F-02 | IDB r6 fully restores snapshot/history/artifacts over localStorage r5. | P1 |
| IA-05 | F-02 | After quota failure, acknowledged IDB save reloads correctly; "Saved" never lies. | P1 |
| IA-06 | F-03 | Stale AI Polish rejected after intervening Story Bible edit. | P1 |
| IA-07 | F-03 | Same project manual prompt edit invalidates stale polish and offers recovery. | P1 |
| IA-08 | F-04 | Undo/Redo semantic edits increment persisted revision; UI history still functions. | P2 |
| IA-09 | F-04 | Two-tab revision conflict detects Undo-related edit. | P2 |
| IA-10 | F-05 | Clean local dev reads GEMINI_API_KEY from documented env config securely. | P2 |
| IA-11 | F-06 | Deletion removes project from localStorage and IndexedDB; no resurrection. | P2 |
| IA-12 | F-07 | Compiled prompt over server limit is handled before request without truncating user content. | P2 |
| IA-13 | R-01 | Public deployment abuse safeguards verified **if applicable**; otherwise N/A with evidence. | Conditional P1 |
| IA-14 | R-02 | Two async project responses resolving in either order do not lose project updates. | P2 |
| IA-15 | R-03 | 50/200/500-node graph benchmarks; no unmeasured rewrite. | P2 |
| IA-16 | R-04 | Runtime startup succeeds on documented Node version(s). | P2 |
| IA-17 | U-01 | Review shows correct actual before/after for exactly selected proposed edits. | P2 |
| IA-18 | U-03 | Review modal Escape/focus-trap/return-focus works keyboard-only and mobile. | P2 |
| IA-19 | U-05 | README accurately reports Undo limit, graph technology, runtime steps. | P3 |
| IA-20 | Product integrity | Original source, confirmed data and Story Bible remain coherent through changes. | P1 |
| IA-21 | Regression | Existing directed multigraph, relation editor, Decision Inbox, Clarifications remain intact. | P1 |
| IA-22 | Regression | Story generation and Image workflows remain available, Video remains absent. | P1 |
| IA-23 | Persistence | Export/import and migration preserve stable IDs, directed edges, revisions and recoverable user data. | P1 |
| IA-24 | Generation | Live model smoke tests completed **only if authorized**; otherwise BLOCKED. | Conditional |
| IA-25 | Security | No server API key visible in client bundles, URL, or error logs. | P1 |
| IA-26 | Documentation/evidence | New verification report distinguishes fresh PASS, FAIL, BLOCKED, NOT RUN and N/A. | P1 |

**The above items are mandatory audit-response acceptance criteria, NOT executed test outcomes.** The older master plan's AC01–AC26 remains in force; do not mark those passed merely because a new test was added.

### Test case sketches (adapt to actual exported functions; no direct production code intended)

~~~ts
// F-01: important distinction — use the proposal's base revision, not active revision twice.
const preview = { projectId: a.id, baseRevision: 10, operations: [...] };
selectProject(b.id);
const result = commitPreview(preview, b);
assert.equal(result.ok, false);
assert.equal(result.reason, 'WRONG_PROJECT');
assert.deepEqual(b.snapshot, originalBSnapshot);

// Same project, different revision:
const updatedA = { ...a, revision: 11 };
assert.equal(commitPreview(preview, updatedA).reason, 'STALE_REVISION');

// F-03:
const proposal = await stagePolish(projectR8);
const projectR9 = changeStoryBible(projectR8, 'tone', 'noir');
assert.equal(acceptPolish(projectR9, proposal).ok, false);
assert.equal(projectR9.snapshot.storyBible.tone.value, 'noir');
~~~

~~~ts
// F-02: integration test, not a fake "IDB is called" spy.
// Persist complete revision 5 in legacy localStorage.
// Persist complete revision 6 in authoritative IndexedDB.
// Reload React app in fresh tab/context.
// Assert activeProject.revision === 6
// Assert latest character attributes AND latest author notes AND artifacts.
// Assert the app doesn't autosave r5 over r6 during hydration.
~~~

~~~ts
// F-04: undo restores content but records a NEW persisted revision.
const r10 = await save(initialEdit);
const undo = await undoSemanticEdit(r10);
assert.ok(undo.revision > r10.revision);
await reloadApp();
assert.deepEqual(currentContent(), stateBeforeEdit);
~~~

---

## 7. Six-cycle Superpowers review — first conceptual pass

The following cycles refine **this plan**, not the app; no production tests are claimed.

1. **Brainstorming / Intent:** Prioritized preservation of creative decisions, identity and recoverability rather than generating a new application. Distinguished owner goal (safe Story/Image + Belief Graph) from incidental UI polish.
2. **Architecture and Data Flow:** Mapped batch proposal → UI Apply → canonical snapshot; async polish → accept; dual storage → hydrate; undo → persistence. Identified that UI-to-engine handoffs, not only helper algorithms, are risk centers.
3. **Root-cause challenge:** Consolidated F-01 and F-03 as stale proposal context; F-02/F-04/F-06 as persistence lifecycle integrity. Avoided seven unrelated superficial patches where a shared invariant is necessary.
4. **UX / Cost / Alternatives:** Chose current 3-panel UI, focused diff and modal repairs; no unnecessary UI libraries, global stores, model updates or new account system.
5. **Test feasibility:** Required real two-tab and reload cases, delayed promise controls, clean environment tests, and meaningful negative assertions. Enforced paid API authorization and mock/live separation.
6. **Adversarial critique:** Challenged "CONFIRMED" without runtime reproduction, prior 47-pass report as fresh evidence, missing deployment facts, and overly broad migration advice. Added conditional treatments and rollback gates.

## 8. Second six-cycle refinement — independent pre-handoff check

Apply a second pass before finalizing this implementation plan:

1. **Scope control:** Check every requested source-audit item F-01–F-07, R-01–R-04, U-01–U-05 is represented and no unrelated feature creep was introduced.
2. **Evidence accuracy:** Verify actual code paths and report date/SHA. Treat earlier line references as hints, not current absolute truth.
3. **Migration adversary:** Ask whether IDB migration can lose legacy data, delete the last project, resurrect deleted projects, or combine old/new revisions. Prevent premature storage simplification.
4. **User authority:** Ensure stale approval protection cannot accidentally discard useful proposals; preserve recoverable draft and allow review/rebase rather than silent loss.
5. **Test coverage:** Confirm every significant defect has a failing test at the correct integration boundary, not only a direct helper unit test. Include unauthorized/blocked real API status explicitly.
6. **Implementer clarity:** Provide exact stage dependencies, failure semantics, completion gates and non-goals. If the current app has already fixed an item, verify and mark ALREADY FIXED rather than changing it.

After implementation, conduct another six-cycle review of **actual code, test evidence, UX and documentation** before claiming completion. Do not invent running agents or tool invocations.

---


### Second-pass clarification: evidence and migration governance

- The independent audit's severity labels (P1/P2) are starting points; an implementer must update them only on actual new evidence and explain why.
- If a proposed fix for F-02 migrates complete projects from localStorage to IndexedDB, **do not delete the old localStorage dataset in the same operation**. Keep an accessible backup/export and only retire the legacy source after a verified round-trip of multiple projects, history, artifacts and schema versions.
- A browser app cannot guarantee save completion on abrupt process termination. Document the last acknowledged durable revision and never mark an unacknowledged in-memory edit as permanently saved.
- Do not treat a UI assertion that a callback returned as proof of persistence. Callback success, reducer commit, and durable write have different guarantees; report them separately.
- The original audit's code references are pinned to fa96d6; any later HEAD requires refreshed line numbers and evidence, not stale citations.
- Clean-room independence belongs to the **source audit**. This is now a deliberately informed remediation plan; do not describe the implementation phase as an independent blind audit.

## 9. Final anti-bias and evidence safeguards

- The independent report was not a runtime certification; implementers must reproduce important failures and examine existing safeguards before editing.
- False positives must be documented as **REJECTED / NOT REPRODUCIBLE** with precise evidence; do not force changes to justify the audit.
- Positive findings deserve protection: server-side Gemini credentials, Zod request validation, bounded retries, existing keyboard graph controls, directed graph, deterministic prompt composition and lack of reintroduced Video.
- Tests can expose a real defect; do not weaken tests to achieve green status. For each behavioral code change use RED → GREEN → REFACTOR and run the full suite.
- Don't create an unreviewable refactor across the whole repository. Fix strongest correctness risks first.
- Record each milestone with repository SHA, exact command, observed result, files changed, UX regression checks, known limits and rollback pointer.
- Prioritize P1 F-01, F-03 and F-02, but apply storage migration only after a safe design/backup and evidence. F-04 is a prerequisite to robust storage CAS, so coordinate with the F-02 package.
- If tooling cannot run browser tests, record BLOCKED rather than declaring UI behavior verified.
- If a paid Live Image/Story model is unavailable, record BLOCKED with why; never infer live model success from mocked route tests.

---

## 10. AI Studio execution checklist and final reporting contract

1. Read this **entire file**, the original master plan, and latest source.
2. Identify current main SHA and inspect all referenced code paths.
3. Produce a concise phase-by-phase implementation plan, taking account of the six-cycle critique.
4. Create recoverable checkpoint before implementation.
5. For each real finding: failing regression test → minimal fix → fresh test pass → full regression → targeted review.
6. Before each structural storage change, prove backward compatibility/migration safety with fixtures representing existing local user data.
7. Implement according to stage dependencies, preserving Story/Image and existing graph/decision behavior.
8. Never push user-unapproved irreversible operations or deploy externally; normal repository updates according to user-specified Git workflow are permitted.
9. After every milestone, provide short truthful status. On failure, investigate root cause, do not repeatedly patch at random.
10. At end conduct independent second six-cycle code/test/UX review, then provide a Turkish report with findings addressed, evidence, remaining risks and next priorities.

**Report each finding exactly:**

| ID | Baseline evidence | Current verification | Fix / N/A rationale | Tests (command/result) | Commit SHA | Remaining risk |
| --- | --- | --- | --- | --- | --- | --- |
| F-01 | ... | CONFIRMED/ALREADY FIXED/UNVERIFIED | ... | ... | ... | ... |

Use these final statuses: PASS, FAIL, BLOCKED, NOT RUN, N/A. Separate testing status from issue disposition.

**Quality gates:**
- Q0: baseline and recovery documented.
- Q1: no stale preview or AI Polish acceptance.
- Q2: storage hydration + CAS + Undo + deletion safe across reload/two tabs.
- Q3: env config and effective prompt limits verified.
- Q4: UX diff and modal keyboard semantics verified.
- Q5: conditional public security/runtime/performance checked.
- Q6: original product features and updated docs verified. Do not declare production-ready if significant required checks remain unverified.

**Deliverable:** a stable, verified evolution of the existing app; no arbitrary rewrite. This Markdown document is an implementation specification, **not** evidence that any findings have already been fixed.

---

## 11. Links and source traceability

**Pinned source SHA:** `fa96d6a6d4fbbca3b77379fdce497ff0c6e14784`.

Relevant pinned source entry points:

- [App.tsx](https://github.com/Centaurioun/Proactive-Co-Creator/blob/fa96d6a6d4fbbca3b77379fdce497ff0c6e14784/App.tsx)
- [DecisionInboxPanel.tsx](https://github.com/Centaurioun/Proactive-Co-Creator/blob/fa96d6a6d4fbbca3b77379fdce497ff0c6e14784/components/DecisionInboxPanel.tsx)
- [projectController.ts](https://github.com/Centaurioun/Proactive-Co-Creator/blob/fa96d6a6d4fbbca3b77379fdce497ff0c6e14784/lib/projectController.ts)
- [nlBatchEngine.ts](https://github.com/Centaurioun/Proactive-Co-Creator/blob/fa96d6a6d4fbbca3b77379fdce497ff0c6e14784/lib/nlBatchEngine.ts)
- [storageEngine.ts](https://github.com/Centaurioun/Proactive-Co-Creator/blob/fa96d6a6d4fbbca3b77379fdce497ff0c6e14784/lib/storageEngine.ts)
- [historyEngine.ts](https://github.com/Centaurioun/Proactive-Co-Creator/blob/fa96d6a6d4fbbca3b77379fdce497ff0c6e14784/lib/historyEngine.ts)
- [promptBuilder.ts](https://github.com/Centaurioun/Proactive-Co-Creator/blob/fa96d6a6d4fbbca3b77379fdce497ff0c6e14784/lib/promptBuilder.ts)
- [schemas.ts](https://github.com/Centaurioun/Proactive-Co-Creator/blob/fa96d6a6d4fbbca3b77379fdce497ff0c6e14784/shared/schemas.ts)
- [README.md](https://github.com/Centaurioun/Proactive-Co-Creator/blob/fa96d6a6d4fbbca3b77379fdce497ff0c6e14784/README.md)
- [masterPlanStability.test.ts](https://github.com/Centaurioun/Proactive-Co-Creator/blob/fa96d6a6d4fbbca3b77379fdce497ff0c6e14784/tests/masterPlanStability.test.ts)
- [Prior master plan](./2026-11-16-stability-consistency-ux-master-plan.md)
- [Historical verification report](./verification-report.md)

The independent audit source was a 460-line Turkish report supplied directly to the planning assistant; this document preserves all seven named confirmed-static findings, four unverified risks, targeted UX/architecture findings, scope caveats, and their verification expectations without copying irrelevant UI-rendering CSS from the pasted Mermaid output.
