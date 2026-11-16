# Proactive Co-Creator — Story Bible, Consistency Navigation & Data-Safety Implementation Plan

> **For agentic workers:** Use Superpowers Brainstorming, Writing Plans, Test-Driven Development, Systematic Debugging, Code Review and Verification Before Completion where available. Execute this plan task-by-task. Use `- [ ]` steps, capture actual RED/GREEN evidence and run a second six-cycle critical review of the implemented result.
>
> **Goal:** Eliminate narrow canonical-model and lifecycle data-integrity risks, make existing consistency issues actionable, and qualify existing batch-edit and project-switch UX in a real browser — without duplicating features already built.
>
> **Architecture:** Retain the React/TypeScript app's canonical `ProjectSnapshot`, `StoryBible`, `ContextualInspector`, shared `projectController`, `storageEngine`, IndexedDB-as-authoritative persistence and existing review modal. Add minimal validation/synchronization at the canonical boundary, issue-target navigation in the existing inspector, and evidence-backed safety gates. Preserve backwards-compatible project migrations, Undo/Redo history and existing user exports.
>
> **Tech stack:** React, TypeScript, Express, IndexedDB/localStorage, Zod at API boundaries, Node 22, npm/tsx tests, Vite, Playwright where available, GitHub Actions.
>
> **Repository:** https://github.com/Centaurioun/Proactive-Co-Creator
>
> **Code baseline inspected:** `6905db0b0a929efb05cfa42e5bbe9f6c6a505856` on `main`. **Revalidate actual HEAD** before implementation; line numbers and statuses below are baseline-specific.
>
> **Plan created:** 2026-11-17. **Status:** SPECIFICATION ONLY. Publishing this Markdown file does not execute tests or implement product changes.
>
> **Related plans:** [Independent Audit Remediation & Verification](./2026-11-16-independent-audit-remediation-plan.md); [Master Modernization Plan](./2026-11-16-stability-consistency-ux-master-plan.md); [Verification Report](./verification-report.md).
>
> **Scope authority:** The owner provided nine Google AI Studio suggested tasks, requested comparison with current code, and chose to consolidate genuinely valuable work instead of reflexively implementing duplicates. All nine tasks are tracked explicitly in ``1`, including those whose implementation should be verified rather than repeated.

---

## 0. Problem framing and engineering decision (Superpowers Brainstorming synthesis)

**User job to be done:** A writer edits the Story Bible, trusts that their change (or deliberate clearing) becomes the authoritative story direction, sees conflicts, jumps to the affected element, previews a natural-language edit safely, and returns later without losing any creative decisions, outputs or history.

**What would be a failure even if automated tests were green?**
- Clearing a Story Bible field reintroduces its old value after an AI refresh, import, graph sync or browser reload.
- A blank field is stored as a confirmed creative decision, causing misleading status or unanswered-question state.
- A consistency "fix" navigates to the wrong entity/relationship, or creates a second modal obscuring the existing inspector.
- A batch-edit before/after preview shows operations other than those actually selected or lets a stale proposal apply.
- IndexedDB read errors still trigger an unsolicited write, seed, reset or overwrite during mount.
- Deleting a different project causes unrelated unique artifact contents, version history or legacy backup information to be discarded.
- A new test asserts only a helper function name or hardcoded UI text and falsely claims to cover real user behavior.
- A large refactor breaks Story/Image, graph directionality, decision authority, Undo/Redo, or legacy migration.

**Approaches considered, with trade-offs:**

| Approach | Benefits | Costs / rejection reason | Decision |
| --- | --- | --- | --- |
| A. Rebuild Story Bible in a new state layer and create separate consistency and batch-edit modals | Makes a fresh UI possible | Duplicates current three-panel UI and review modal; increases inconsistent-state risk | **REJECT** |
| B. Focused canonical-model invariants + existing Inspector navigation + rigorous user-flow tests + narrowly scoped storage guards | Small diff, preserves user mental model, fixes credible data-loss risks | Needs careful event and migration tests | **RECOMMENDED** |
| C. Do nothing because CI is green | Lowest immediate cost | No proof against overlooked cross-boundary behavior; current code contains plausible counterexamples | **REJECT** |
| D. Implement all nine AI Studio suggestions verbatim | Quick one-click execution | Repeats IndexedDB/CI/preview work already in repo; creates parallel UI and duplicate tests | **REJECT** |

**Working defaults (not invented user approval):** Use the existing Inspector tab instead of a new modal, do not enforce a genre/tone enum on creative writing, treat an empty field as an explicit clear/unset, and make any data-destructive cache cleanup fail closed until complete content parity can be established. These are reversible implementation choices; document deviations.

**Selected outcome:** Tasks T1–T6 below are the implementation units. Each has precise files, behavior, focused RED tests, minimal GREEN changes and gates. T0 is baseline, T7 is verification and delivery.

### 0.1 Baseline facts from source, not runtime claims

- `App.tsx` `handleUpdateStoryBible` immediately calls `updateStoryBibleField(snapshot, field, value, 'user-edit')` and commits an undoable transaction; the Story Bible grid and list controls call that handler.
- `lib/canonicalModel.ts` `updateStoryBibleField` confirms every input, including an empty trimmed value. It updates mirrored scene attributes only if `value.trim()` is truthy; `syncStoryBibleWithSceneEntity` can later refill an empty field from an old confirmed scene attribute.
- `lib/canonicalModel.ts` currently marks matching Story Bible clarifications `answered` on *every* update, including an empty clear. This must be assessed along with the clear/undo semantics.
- `components/ContextualInspector.tsx` already has a `consistency` tab listing problems and an `inspector` tab accepting selected entity/relationship. `ConsistencyIssue` has `affectedEntityIds` but no direct relationship ID in its type; some issues are Story Bible-level only.
- `App.tsx` already provides a structured Before/After review modal with current and projected prompts. `components/DecisionInboxPanel.tsx` already has a selectable natural-language batch preview, stale-preview warnings and per-operation selection.
- `lib/storageEngine.ts` already uses IndexedDB as primary durable store, `persistProjectDurably` CAS, `loadProjectsFromIndexedDbDetailed` typed load status, and a tombstone/quota handler.
- Baseline `App.tsx` sets `isHydrationCompleteRef.current = true` before checking `idbLoad.status === 'read_error'`, then sets an error alert. Its debounced save effect depends on `storageAlert` and can be re-entered. **Potential P1:** an IndexedDB read error may be followed by an automatic write attempt. Prove with a controlled failing read + write spy or real browser reproduction before patching.
- In `deleteProjectCompletely`, cache compaction eligibility compares surviving project revision numbers and **counts** of artifacts/revisions, not complete artifact contents/history. **Potential P1:** equal-count but different data passes a weak parity check. Prove preservation risk and never assume contents are equivalent just because counts match.
- `tests/releaseQualification.test.ts` covers helper-based rapid A → B → A, storage failures and CI existence. Real React/Playwright behavior and race ordering need independent assertions. The GitHub Actions run for pinned HEAD `43961470503` completed successfully, with observed 82/82 Node tests in its log. This is baseline evidence, not a claim that the future work passed.

### 0.2 Non-negotiable invariants

**INV-SB1:** User-authored Story Bible value, empty/cleared state, status and provenance remain authoritative and internally consistent through graph/scene sync, prompt synthesis, history, reload, import and AI merges.

**INV-SB2:** Invalid input is either rejected before canonical commit with an accessible reason or intentionally treated as a valid draft; never silently mutate or partially accept.

**INV-ISSUE1:** A consistency issue targets the correct live entity, relationship or Story Bible field by stable identity; if ambiguous/missing, show an explanation rather than navigating incorrectly.

**INV-PREVIEW1:** A batch preview shows *exactly the selected proposals* against the same project and base revision that commit validation uses. Preview ≠ automatic acceptance.

**INV-STORE1:** Failed IndexedDB reading never authorizes auto-seeding or writing into records that might still be recoverable.

**INV-STORE2:** Unique project outputs, backups, revision snapshots, Undo/Redo state and artifacts may be evicted only when lossless redundancy is proven, not inferred from list lengths.

**INV-ASYNC1:** Pending writes, stale async responses, late AI completions and project-switch timing cannot silently regress confirmed project state or resurrect deleted data.

**INV-TEST1:** Unit, component integration, real browser E2E and live paid Gemini tests have distinct evidence; no fake "all passed" claims.

---

## 1. All nine Google AI Studio suggestions — disposition and coverage

The rows below account for **every suggestion** supplied by the owner. A "verify" result is intentional scope control, not an omitted task.

| Suggestion ID | AI Studio request (faithful condensed wording) | Observed existing capability | Decision | Work item |
| --- | --- | --- | --- | --- |
| S1 | Validate new Story Bible grid, update canonical model instantly, field-specific errors | Immediate canonical update exists; blank clear and mirror invariants risky | **IMPLEMENT targeted correctness and validation** | T1 |
| S2 | Modal listing consistency issues with navigation to problematic entity/relationship | Existing Consistency tab lists issues; no per-issue jump | **IMPLEMENT navigation in existing tab; NO duplicate modal** | T2 |
| S3 | New split-pane before/after preview modal for NL batch edits | Existing modal already has Before/After diff plus current/projected prompts | **VERIFY/IMPROVE existing preview; NO new modal** | T3 |
| S4 | Refactor storage: IndexedDB authoritative CAS, IDB before cache and clear failures | Already implemented | **VERIFY invariants, do not repeat refactor** | T4/T6 |
| S5 | Typed IndexedDB read errors, no false-empty/auto-seeding, clear recovery options | Typed read result exists | **CHECK remaining read-error→autosave path; targeted fix if reproduced** | T4 |
| S6 | Test A → B → A immediate edit and reload in storageLifecycle suite | Existing helper/integration test in `releaseQualification` | **REUSE/EXTEND tests, avoid duplicate low-value copy** | T5 |
| S7 | New `tests/projectSwitchRegression.test.ts` end-to-end rapid switch scenario | Existing tests are largely helper-oriented; user-visible full flow not CI-gated | **IMPLEMENT actual React/Playwright coverage; file name optional based on harness** | T5 |
| S8 | Tombstone under quota must not evict legacy backups or project metadata | Protective handling added; parity check incomplete | **HARDEN evidence requirements and fail-closed behavior** | T4 |
| S9 | Test quota failure in `recordDeletedProjectId` and preservation of unrelated projects and backups | Several tests exist | **EXTEND with equal-count/different-content adversary; do not duplicate happy path** | T4/T5 |

**Supplemental reviewer risks (not direct AI Studio suggestions):**
- **R1:** IndexedDB read failure setting hydration-ready may permit accidental autosave — T4.
- **R2:** Cache compaction can trust identical counts with differing payload — T4.
- **R3:** Story Bible clear can be undone unintentionally by scene synchronization — T1.
- **R4:** Clearing a Story Bible field may mark corresponding clarification answered — T1.
- **R5:** "Go to issue" must not invent relationship identities or auto-confirm suggestions — T2.
- **R6:** UI + selected-operations diff drift and stale apply needs measured integration coverage — T3/T5.

---

## 2. File/component responsibility map (pinned HEAD; refresh as necessary)

| File | Existing responsibility | Planned change |
| --- | --- | --- |
| `lib/canonicalModel.ts` | Story Bible updates; scene-entity sync; decision/prompt regeneration | T1: coherent clear/unset semantics and mirrored attribute rules |
| `shared/types.ts` | `StoryBibleField`, `ConsistencyIssue` and related contracts | T1/T2: optional explicit target references / validation types only if justified |
| `components/ContextualInspector.tsx` | Story Bible structured grid/list; Consistency tab; Inspector | T1 inline accessible field errors; T2 clickable issue navigation |
| `App.tsx` | Canonical commit handlers, tab navigation, selection, hydration, autosave, modals | T1 validation result handling; T2 target selection; T3 verification; T4 hydration gating |
| `lib/consistencyChecker.ts` | Deterministic consistency issues | T2 optional stable structured issue targets; avoid artificial errors |
| `lib/projectController.ts` | Transaction+preview diff calculation; staged proposal validation | T3 correctness fixes only if tests expose defects |
| `components/DecisionInboxPanel.tsx` | NL batch preview, selections, errors, commit | T3 preview behavior and unchanged-state checks |
| `lib/storageEngine.ts` | Detailed IDB load, durable writes, project deletion and quota recovery | T4 read-error safety; full parity proof/backup protections |
| `lib/historyEngine.ts` | Semantic equality and Undo/Redo | T1/T4 regression checks; avoid redesign |
| `tests/storageLifecycle.test.ts` | Storage corruption, CAS, migration, tombstones, reload | T4 fail-first adversarial storage tests |
| `tests/releaseQualification.test.ts` | Rapid switch helper-level regression, cache failures and CI assertions | T5 preserve existing coverage; strengthen data assertions |
| `tests/projectSwitchRegression.test.ts` | Does not exist at baseline | T5 optional focused node integration tests if truly distinct and useful |
| `tests/storyBibleConsistency.test.ts` | New suggested focused tests | T1/T2 canonical correctness, issue navigation evidence |
| `tests/batchPreviewIntegrity.test.ts` | New suggested focused tests | T3 selected-operation diff, stale preview and cancel |
| `e2e/project-workflows.spec.ts` | New suggested Playwright test location; match existing setup if any | T5 real browser user flows and accessibility |
| `.github/workflows/ci.yml` | Node 22 npm ci/typecheck/lint/test/build | T5 optionally add deterministic headless Playwright smoke job after local verification |
| `docs/modernization/verification-report.md` | Prior check evidence | T7 append dated, SHA-pinned execution results |

**Constraint:** Suggested new test paths are an implementation sketch; adapt them to the actual test runner, repository patterns and installed tools. Do not create test files with only source-text grep assertions in lieu of behavioral tests.

---

## 3. T0 — Baseline, plan execution and recoverability (gate before any changes)

**Goal:** Establish reality on current HEAD and eliminate the chance that this plan modifies already fixed features.

**Files:** inspect all above; modify only tests or code in subsequent tasks.

- [ ] Record current `main` HEAD SHA, `git status`, package scripts, Node version and whether a browser runner exists. Treat baseline `6905db0` as historical if HEAD has advanced.
- [ ] Read this entire plan, prior master plan, current verified report, `AGENTS.md`/repository instructions if present, and relevant modules. Do not assume identical line numbers.
- [ ] Create a recoverable Git checkpoint/branch before code modification. Do not destroy or migrate user storage without a JSON export/backup strategy.
- [ ] Run the actual baseline commands `npm ci`, `npm run typecheck`, `npm run lint`, `npm test` and `npm run build`. Report executable exit codes and exact test totals.
- [ ] Verify README, app startup and Playwright tool availability; distinguish simulated tests from real UI automation.
- [ ] For each S1–S9 / R1–R6: label `CONFIRMED / ALREADY FIXED / PLAUSIBLE-UNVERIFIED / N/A` with file/line and reproduction method.
- [ ] Prioritize **T4 P1 read-error and parity safety** and **T1 P1 canonical clear** before cosmetic changes. Do not batch unrelated fixes into one unreviewable commit.
- [ ] Do not use live paid Gemini calls, change secrets, deploy remotely, or enable billable workflows without explicit authorization.

**T0 gate:** Current baseline and rollback point documented; any previously resolved issue treated as verify-only.

---

## 4. T1 — Story Bible field validation and canonical one-way authority

**Priority:** P1 data consistency (clear/sync); P2 local inline validation.

**Existing code:** `components/ContextualInspector.tsx` grid/list onChange; `App.tsx` `handleUpdateStoryBible`; `lib/canonicalModel.ts` `updateStoryBibleField` and `syncStoryBibleWithSceneEntity`.

**Key defect hypothesis:** `updateStoryBibleField(snapshot, 'setting', '')` produces `storyBible.setting = { value: '', status: 'confirmed' }` but leaves the scene entity's old confirmed `setting` intact; a later sync can restore the removed value. The handler also marks related clarifications answered on clear.

**Design constraints:**
1. User-typed text must update immediately/consistently with existing undo coalescing, history and effective prompt.
2. Empty text is a **valid deliberate clear**. It must result in an unambiguous `unset`/non-confirmed state (under current `ApprovalStatus` options), never `confirmed` with blank content. Preserve provenance and do not accidentally accept an AI suggestion.
3. A matching mirrored scene attribute cannot reinsert a value the user explicitly cleared. Choose and document one authoritative rule: prefer Story Bible for mapped properties and synchronize/clear mapped scene attributes, or use an explicit persisted clear marker with deterministic merge semantics. Do not remove unrelated scene properties.
4. Do **not** blanket-remove all synonymous scene attributes or source evidence without checking if independently confirmed; handle aliases such as `setting/location` and `tone/atmosphere` coherently. Preserve context for Undo/Redo, migration and provenance.
5. A clear must not falsely mark unanswered clarifications as answered. Determine the correct `pending/unanswered/outdated` transition based on existing clarification status semantics.
6. Inline validation errors must be accessible (`aria-invalid`, `aria-describedby`/`role="alert"`) and field-specific where appropriate; no arbitrary required-value, genre enum, forced English text, or draconian character limits on creative drafts.
7. Distinguish malformed/unexpected data (wrong type, invalid control chars, unsafe oversized submission) from legitimate artistic content, punctuation, Unicode and multiline rules. API-bound prompt max length is a **submission** validation, not necessarily a limit on the locally saved editable Story Bible.
8. Both `grid` and `list` views use the same validator and canonical commit path; no duplicate field definitions that drift.

**Possible interface (illustrative only):**

~~~ts
type StoryBibleUpdateValidation =
  | { ok: true; normalizedValue: string; intent: 'set' | 'clear' }
  | { ok: false; field: keyof StoryBibleFields; code: string; message: string };

function validateStoryBibleUpdate(
  field: keyof StoryBibleFields,
  rawInput: unknown
): StoryBibleUpdateValidation;
~~~

If an extra validation interface is not warranted, use a focused pure helper and existing error state; do not add a large form library.

**Executable test-first tasks:**
- [ ] T1.1 RED: `setting` currently mirrored in scene entity; user clears Story Bible `setting`; invoke every sync path (including `syncStoryBibleWithSceneEntity`, AI merge/import if relevant); assert empty/unset remains authoritative, old value does not reappear, prompt does not contain old setting. Verify test fails for the identified reason.
- [ ] T1.2 RED: clearing `tone` with synonym `atmosphere` and `lighting`/`cameraAndLighting` aliases; make sure unrelated scene attributes and entity definitions survive. Add only cases the code truly maps.
- [ ] T1.3 RED: clear a field linked to an unanswered or answered clarification; verify status is not falsely set to answered, after clear & Undo.
- [ ] T1.4 RED: set legitimate Unicode/multiline input, punctuation and whitespace; confirm immediate canonical update and expected normalization without data loss; test invalid input error behavior through UI.
- [ ] T1.5 GREEN: minimally correct `updateStoryBibleField`/sync authority, validation feedback and relevant handler semantics. Do not reorder or rewrite whole scene model.
- [ ] T1.6 Verify grid/list parity, Undo→Redo→reload, field status & provenance, prompt synthesis Story/Image, sample project migration.
- [ ] T1.7 Run focused and full checks; independently inspect that no confirmation status silently changes on non-target fields; commit this unit.

**T1 acceptance:** Clear stays cleared across sync, import, reload and AI refresh; user can reenter valid text; errors are local and actionable; unrelated facts untouched.

---

## 5. T2 — Actionable consistency issues in existing Inspector (NO new modal)

**Priority:** P2 UX correctness.

**Existing code:** `evaluateProjectConsistency(snapshot)` returns `ConsistencyIssue`; the Consistency tab already renders errors and warnings. Issue type has `affectedEntityIds` but not an explicit relationship ID or Story Bible field target.

**User experience:**
- A visible `Inspect` / `Go to affected item` action is attached only when an exact target exists.
- For entity issues, select the entity via **stable ID**, switch to `inspector` tab, reveal/focus/scroll relevant area if present. On mobile, activate Inspector panel as well.
- For relationship issues, use an actual relationship ID if supplied; the checker currently does not necessarily generate relationship issues despite the category enum. **Never synthesize IDs** from labels. If needed, extend issue type with optional stable `relationshipId` and have the checker populate it only for genuine detectable cases.
- For Story Bible-only issues (e.g., unresolved core fields or setting mismatch), navigate to `story-bible` and focus the relevant input by known key. If a conflict refers to both a location entity and a Story Bible field, offer one or two clear destination choices without automatically modifying either.
- Missing/deleted/renamed target: disabled action or explicit "This target is no longer available", with no wrong-target navigation.
- Navigating is **read-only** and does not create a revision, accept a decision, or modify confirmed facts.
- Use current tab and selection handlers (`onSelectEntity`, `onSelectRelationship`, `onSelectTab`) rather than a new parallel modal or global router.
- Provide focus return / keyboard accessible action, distinguish severity, no large new UI dependency.

**Task list:**
- [ ] T2.1 RED: create a reproducible excluded-entity issue with a stable entity ID; click its action; assert correct inspector tab and selected ID; verify project snapshot/revision unchanged.
- [ ] T2.2 RED: create unresolved Story Bible issue with no entity ID; navigate to missing field rather than a random entity; ensure focus target exists in filtered `grid/list`.
- [ ] T2.3 RED: create a setting issue with multiple entities; determine deterministic routing and avoid accidental first-match to wrong entity. Include stale/deleted target behavior.
- [ ] T2.4 RED: where a real relationship conflict exists, route by exact relationship ID and graph direction; if current checker emits none, record N/A instead of inventing a conflict solely to satisfy AI suggestion.
- [ ] T2.5 GREEN: minimally extend `ConsistencyIssue` target contract and existing inspector UI and prop callbacks; account for mobile tabs and focus.
- [ ] T2.6 Verify 0-issue empty state, large issue list, keyboard-only controls, accessible names, and no accidental edits; commit.

**T2 acceptance:** From a real issue to the correct editable target in one deliberate action; no redundant modal; no extra revision.

---

## 6. T3 — Verify and refine existing Before/After preview (NO second preview modal)

**Priority:** P2 correctness, P1 if stale apply bypass demonstrated.

**Baseline:** `App.tsx` review modal already shows structured `Before → After` items plus a two-column `Current Committed Prompt` / `Projected Prompt` view; `DecisionInboxPanel` previews individual NL operations with checkbox selection and stale-version guards.

**Do not build:** a second "split-pane preview modal", a competing batch result source, or a new duplicate Apply button that circumvents current atomic commit validation.

**Required invariant:** The preview describes the actual selected project, current revision and selected operations, not all proposed operations or a stale inferred state.

**Task list:**
- [ ] T3.1 RED: NL command produces three operations; deselect the second; review diff and projected prompt must include only first/third, and applying must change only those.
- [ ] T3.2 RED: preview on project A/r5; edit another Story Bible fact to r6; preview becomes visibly stale and cannot silently commit. Re-preview shows an updated accurate diff.
- [ ] T3.3 RED: add conflicting decision, unsupported clause and destructive proposed action; validate review warning provenance and partial-apply acknowledgement as applicable. A failed apply leaves text and selections recoverable.
- [ ] T3.4 RED: cancel/dismiss preview or review modal; confirmed snapshot and persistent revision remain unchanged.
- [ ] T3.5 GREEN only if behavior fails: reuse `buildReviewDiffModel` and canonical batch validator; synchronize staged selection changes without duplicating state. If already correct, mark `VERIFIED / NO CODE CHANGE` with executable evidence.
- [ ] T3.6 Component + real browser test with actual selected operations, responsive layout and keyboard; commit only genuine changes.

**T3 acceptance:** One reliable before/after experience; preview and actual commit agree; stale proposals cannot change user data.

---

## 7. T4 — Residual storage-safety gates and quota parity (P1)

**Priority:** P1; implement before feature polish.

### 7.1 IndexedDB failed read must block unsolicited writes

**Evidence to challenge:** `App.tsx` hydration effect sets `isHydrationCompleteRef.current = true` before examining typed `loadProjectsFromIndexedDbDetailed()` result. On `read_error` it sets an error `storageAlert`; autosave useEffect depends on `storageAlert` and might schedule a write. This path was not proven in a real browser by the earlier static review.

**Required design:**
- Introduce an explicit, scoped hydration/write-readiness gate if the current code truly allows it, e.g. `pending | ready | unavailable | blocked-read-error`.
- On failed read, keep existing data in memory and exports, display error with safe retry / recovery. No opportunistic init/seed/overwrite until a successful verified load or **explicit, appropriately warned user action**.
- Support localStorage-only environments when IDB is genuinely unavailable; do not deadlock legitimate offline edits by confusing `unavailable` with `read_error`.
- Prevent stale hydration responses from overwriting newer edits or other projects. Avoid basing permission only on mutable UI banner state.
- If the app already has a sound guard at latest HEAD, document the proof and do not patch.

**Tests:**
- [ ] T4.1 RED: IDB contains valuable project; `getAll`/open/transaction fails; mount app (not just invoke helper); record calls to IDB `put` / `saveProjectToIndexedDb` for this mount; wait past debounce and after alert re-render; expect **zero unsolicited writes**; stored project bytes unchanged.
- [ ] T4.2 RED: a user edits after blocked mount; no silent loss; explicit export supported; on successful retry the app reconciles without forcing stale data; test no fake "Saved" status.
- [ ] T4.3 RED: IDB API unavailable, legacy localStorage project loads normally and saves through documented fallback (no permanent blocker).
- [ ] T4.4 GREEN: minimal explicit hydration state guard and retry/ack semantics; avoid adding a second uncontrolled save effect.

### 7.2 Deletion tombstone quota safety requires *content* parity, not counts

**Evidence to challenge:** `lib/storageEngine.ts` `deleteProjectCompletely` uses `idbProj.revision >= localProj.revision`, `idbProj.artifacts.length >= localProj.artifacts.length` and `idbProj.revisions.length >= localProj.revisions.length` to authorize stripping cached artifacts. Equal counts do not prove payload equivalence. A more recent IDB revision is likewise not enough proof that independent local-only media exists in IDB.

**Required design:**
- Before compacting/evicting any local project cache, prove the **entire data that would be lost is recoverable from a valid durable record**, including stable artifact IDs, story text/image payload or trustworthy content digests, source revision, full historical snapshots, persisted Undo/Redo future/past and other uniquely user-authored state.
- Use exact semantic comparison or a verified identity-and-content equivalence strategy; comparison of counts, names or timestamps is insufficient.
- If checking huge image data is prohibitively expensive, **fail closed** and retain the local data; surface `incompleteDeletion` and recommend JSON export, not silent compaction.
- Never delete `proactive_co_creator_backup_v2` or unverified custom projects to make room for a tombstone.
- If IDB is unavailable, failed, corrupt, or a mismatched candidate appears, do not clear unique local information.
- Ensure deletion of project X doesn't mutate project Y. Distinguish incomplete physical deletion from logical tombstoned UI state; warn if a restart could resurface deleted records.
- Confirm sessionStorage tombstones alone are insufficient after browser restart and that existing reporting remains truthful.
- **Race consideration:** verify the final authoritative content immediately before destructive cache update where feasible; if other tabs can mutate the IDB project during check, abort or re-verify under a suitable transaction/protocol rather than claiming impossible cross-store atomicity.

**Tests:**
- [ ] T4.5 RED: local and IDB each have one artifact with the **same count but different ID or text/image payload**; force tombstone quota failure; assert local-only artifact, revisions and backup preserved; compaction rejected.
- [ ] T4.6 RED: same artifact count and IDs but different content; parity must still fail. Include same revision number but divergent revision snapshot and Undo future stack.
- [ ] T4.7 RED: IDB project strictly higher revision but lacks a local-only prior output; parity must fail closed.
- [ ] T4.8 RED: IDB genuinely mirrors every user-authored artifact/revision/Undo field; under quota, safe non-authoritative cache compaction may proceed; final project reload reproduces exact content.
- [ ] T4.9 RED: IDB read/delete unavailable or failing; legacy backup and all unrelated project records stay intact, `incompleteDeletion` is true and the user sees a recovery message.
- [ ] T4.10 GREEN: replace count-based parity with clear, proven complete-data equivalence; minimize allocations and disk writes; do not attempt unrelated storage schema migration.
- [ ] T4.11 Run single-tab, two-tab and browser-restart tests and inspect failure messages, deletion resurrection and data snapshots.

**T4 acceptance:** No auto-write after failed IDB read; no destructive cache cleanup based only on counts/revisions; explicit, truthful failure recovery.

---

## 8. T5 — Real browser integration and CI strengthening (not duplicated unit tests)

**Priority:** P1 for critical persistence paths; P2 for UX.

The repo currently has `tests/releaseQualification.test.ts` rapid-switch logic built predominantly around `prepareProjectSwitch` and storage helpers. Those tests are valuable **but are not equivalent to clicking the actual React UI**. The GitHub Actions `.github/workflows/ci.yml` baseline runs Node tests/typecheck/lint/build, but no Playwright browser job.

**Proposed approach:** Add deterministic browser smoke tests with a fixed local server, no Gemini paid key, controlled fake/mock API calls and isolated browser contexts. If adding Playwright to CI is not feasible for the current environment, preserve a reproducible manual browser verification script and mark CI E2E `BLOCKED`; do not silently skip.

**Required scenarios:**
1. **E2E-A:** Launch app with project A/B fixtures. Enter A, type new Story Bible field, switch A → B before 250 ms, edit B, switch B → A, assert A latest visible, reload, assert both A/B durable and Undo labels retained.
2. **E2E-B:** Start an async save of A/r2, then edit A/r3 and switch to B; resolve promises in both orders and assert stale acknowledgement does not regress A or B.
3. **E2E-C:** Clear an already confirmed mapped setting/tone; sync graph/AI proposal/import via supported UI, reload and assert old value never reappears and affected clarification isn't spuriously answered.
4. **E2E-D:** Create an exclusion/trait/setting conflict; click issue target; assert correct selected entity and focused inspector; test mobile tab switch and no revision bump.
5. **E2E-E:** NL batch preview with multiple selected/unselected operations, review actual Before/After, reject stale apply, then approve fresh correct proposal; Undo and reload.
6. **E2E-F:** Simulate IndexedDB `read_error` on mount; assert accessible alert, zero IDB writes before explicit recovery, existing IDB record unchanged.
7. **E2E-G:** Simulate quota and mismatched media parity during project deletion; no unrelated artifacts or backup lost, incomplete deletion visible; reload recovery.
8. **E2E-H:** Story ↔ Image mode switching retains shared canonical facts, graph direction and author decisions; do not call billable Gemini routes.
9. **E2E-I:** Keyboard-only navigation, tab focus, issue target, modal Escape, mobile 390×844; ensure no uncaught page or console errors.

**Implementation steps:**
- [ ] T5.1 Reuse existing `tests/storageLifecycle.test.ts` / `tests/releaseQualification.test.ts` cases; add new Node test only when it exercises a distinct code path. Avoid a duplicate `projectSwitchRegression.test.ts` merely to satisfy a file-name suggestion.
- [ ] T5.2 Setup Playwright against real React UI and deterministic fixtures; write E2E-A/E2E-C/E2E-D first; show failures before fixes. No screenshot-only assertions.
- [ ] T5.3 Execute and inspect E2E-B/E2E-E/E2E-F/E2E-G; make race/error injection deterministic and assert durable state after *fresh context* reload.
- [ ] T5.4 Complete E2E-H/E2E-I on desktop and mobile, test keyboard focus and labels. Capture actual command, browser version, viewport, exit status and screenshots only where useful.
- [ ] T5.5 If stable within reasonable CI time and no secrets needed, add one headless smoke job to `.github/workflows/ci.yml`; use supported Playwright install and no live Gemini. Do not remove existing Node 22 gates.
- [ ] T5.6 Verify GitHub Actions output on final SHA rather than only checking that workflow file exists. Report failed/skipped steps accurately.
- [ ] T5.7 If live external Gemini Story/Image output not authorized, record `BLOCKED: paid key`, not PASS.

**T5 acceptance:** A real user click path and durable browser reload prove A→B→A, Story Bible clear, navigation and losslessness; CI job status independently visible.

---

## 9. T6 — Verify already implemented suggestions; no redundant refactor

**Priority:** P2 regression gate.

- [ ] T6.1 S4: Inspect `persistProjectDurably` and `saveProjectToIndexedDb` on latest HEAD. Verify IDB read-check-put occurs in a single transaction with revision CAS and a committed-write acknowledgement. Verify cache sync failures are reported separately. If tests pass and behavior is correct, mark `ALREADY IMPLEMENTED`. **Do not rewrite entire storageEngine.ts.**
- [ ] T6.2 S5: Verify `IndexedDbLoadResult` statuses for actual empty, unavailable, read error and partially corrupted records. The additional read-error→autosave hazard belongs to T4, not an excuse to discard typed results.
- [ ] T6.3 S6/S7: Confirm existing helper regression then add only real UI E2E missing evidence; no duplicate test function that calls the same helper with only different names.
- [ ] T6.4 S8/S9: Preserve quota and deletion tests; add distinct content-divergence adversarial cases T4. Do not delete migration backups or bypass tombstones to make tests green.
- [ ] T6.5 S3: Ensure existing Review Modal already offers before/after and projected prompt as expected; only adjust it when selected-batch behavior fails.
- [ ] T6.6 Review current CI 82/82 reference as historical; final pass count may change. Avoid committing an assertion of 82 forever.
- [ ] T6.7 Preserve explicitly working Story, Image, directed multigraph, Clarifications, Decision Inbox, AI Polish, review, version history, JSON backup, responsive layout and server-side secrets.

**T6 acceptance:** No accidental feature duplication or new storage architecture; prior working behavior remains.

---

## 10. Complete acceptance matrix (NOT already executed)

| ID | Requirement / original suggestion | Verification |
| --- | --- | --- |
| SB-01 | Clear Story Bible setting cannot be revived by scene graph sync | Unit + React component + browser |
| SB-02 | Clear tone / mirrored alias cannot reappear | Unit + browser |
| SB-03 | Blank field does not become misleading confirmed fact | Unit + UI |
| SB-04 | Clear does not falsely answer a clarification | Unit |
| SB-05 | Valid multiline/Unicode draft round-trips; invalid value gets accessible feedback | Component + export/reload |
| SB-06 | Story and Image effective prompts reflect accepted clear/set | Unit + browser |
| IS-01 | Entity issue jumps by stable ID to correct inspector entity | Component/E2E |
| IS-02 | Story Bible-only issue focuses correct field; no fake entity | Component/E2E |
| IS-03 | Missing/deleted/renamed issue targets do not navigate wrongly | Component |
| IS-04 | Relationship target navigates by exact ID only when issue exists | Conditional |
| IS-05 | Navigation causes no project revision or mutation | Unit/E2E |
| PR-01 | Only selected NL operations appear in before/after diff and commit | Integration/E2E |
| PR-02 | Stale proposal prevents apply; re-preview uses new revision | Integration/E2E |
| PR-03 | Cancel/reject leaves canonical state and revision unchanged | Integration |
| ST-01 | IDB failed read blocks all unsolicited mount autosaves and sample seeding | Browser with read/write traps |
| ST-02 | Failed read followed by retry recovers original data | Browser |
| ST-03 | IDB genuinely unavailable uses documented localStorage-only fallback | Unit/E2E |
| ST-04 | Same-length, different-ID artifact parity does not permit compaction | Storage test |
| ST-05 | Same-length and same-ID, different-content artifact parity also fails | Storage test |
| ST-06 | Newer IDB revision missing local-only artifact cannot authorize cache deletion | Storage test |
| ST-07 | Different revision snapshot or Undo future/past prevents destructive cleanup | Storage test |
| ST-08 | Exact parity allows safe compaction without loss | Storage test |
| ST-09 | IDB read/delete failure preserves backup and all unrelated projects | Unit/browser |
| ST-10 | Incomplete deletion accurately shown and not declared success | E2E |
| SW-01 | A edit → B switch → A return before debounce preserves A | Real React E2E |
| SW-02 | A and B edits survive full browser reload | Real React E2E |
| SW-03 | Out-of-order save ACK never regresses newer revision | Integration/E2E |
| UI-01 | Desktop/mobile issue navigation and modal focus accessible | Playwright |
| UI-02 | Story/Image mode and prior graph + decision behavior unchanged | Regression/E2E |
| CI-01 | Actual Node22 typecheck, lint, tests and build pass on final HEAD | GitHub Actions logs |
| CI-02 | Browser smoke job runs in CI or is explicitly BLOCKED with evidence | GitHub Actions / rationale |
| OUT-01 | All S1–S9 disposition recorded with exact code/test evidence | Verification report |
| OUT-02 | Baseline and final SHA, diff, rollback, warning and no unrun PASS | Verification report |

No acceptance row can be marked PASS merely because an assertion was written. Record an executable command, fresh output and relevant line evidence.

---

## 11. Two six-cycle iterative refinement passes — design review already performed

The passes below refer to **critical examination of this proposed specification** before handing it to the implementer. They do **not** claim production tests, browser execution or external agent delegation. Implementation must conduct its own two passes on the current checkout and actual changes.

### Pass A — Brainstorming / goal and solution scrutiny

1. **Cycle A1 — Understand intent.** Distilled nine suggestions to actual user goals: canonical creative authority, direct conflict resolution, trustworthy preview and lossless persistence. Rejected "more modal windows" as a proxy for better outcomes.
2. **Cycle A2 — Source reality check.** Compared S1–S9 with pinned `App`, `ContextualInspector`, `canonicalModel`, `storageEngine` and tests. Identified existing Story Bible grid, consistency list, preview modal, IDB CAS and regression tests. Removed duplicate feature implementations.
3. **Cycle A3 — Root-cause challenge.** Traced blank Story Bible input through `updateStoryBibleField` to scene sync and clarification status; traced read_error through `isHydrationCompleteRef` and alert-reactive autosave; traced quota compaction through count-based parity. Classified as **code-path hypotheses until RED reproductions**.
4. **Cycle A4 — Alternatives and usability.** Compared new modal vs existing inspector navigation, and wholesale schema rewrite vs focused canonical invariants. Selected smaller, more understandable changes with no unnecessary dependencies.
5. **Cycle A5 — Test design.** Required specific failing tests for subtle cases (same-length mismatched artifact, deferred save ACK, blank field sync, read-error rerender) instead of repeating green generic tests.
6. **Cycle A6 — Adversarial product review.** Challenged over-strict field validation, overconfident graph relationship targeting and cache-compaction assumptions. Added explicit `N/A` paths, recovery warnings and no-loss acceptance criteria.

### Pass B — Independent adversarial refinement of the written plan

1. **Cycle B1 — Scope audit.** Confirmed the coverage matrix maps all nine owner suggestions exactly once as implement/verify/no-duplicate, plus six narrower reviewer risks. Removed invitations to create unrelated modes, auth systems or a global store.
2. **Cycle B2 — Data authority audit.** Required clear-as-unset behavior, stable entity identity, targeted mirrored scene updates, status/provenance preservation, Undo/Redo and Story/Image prompt checks. Added explicit avoidance of artificial creative-writing constraints.
3. **Cycle B3 — Failure/race audit.** Reexamined error-path autosaves, same-revision divergent snapshots, quota deletion, cache parity and pending background flushes. Required fail-closed paths when proof is unavailable.
4. **Cycle B4 — Accessibility and UX audit.** Replaced duplicate consistency modal with existing-tab navigation; made issue focus, mobile routing, no-target state and non-mutating navigation testable.
5. **Cycle B5 — Evidence audit.** Existing 82/82 CI evidence is pinned to baseline; actual future work requires new command logs and actual Playwright click flows. Prevented "grep finds function" tests from masquerading as E2E.
6. **Cycle B6 — Feasibility and rollback audit.** Ordered data-safety fixes before optional polish; isolated testable commits; specified backup/export, compatibility, no paid calls, regression gates and honest blocked statuses.

**Post-implementation requirement:** Repeat six cycles focused on *actual* code at final HEAD: (1) source delta; (2) invariants; (3) adversarial races; (4) UI/accessibility; (5) executed CI/E2E; (6) final evidence/readiness. Record any late defects and rerun tests after fixes.

---

## 12. Delivery gates and rollback policy

**Gate G0 — Baseline and checkpoint:** Record main SHA, complete source review and recoverable revision/export plan. No production modification yet.

**Gate G1 — Canonical correctness:** SB-01 through SB-06 pass with actual RED→GREEN evidence; Story Bible clear doesn't reappear; confirmed facts and entity mapping retained.

**Gate G2 — Storage losslessness:** ST-01 through ST-10 pass. No read-error auto-seed; no count-based destructive parity; no unverifiable backup deletion.

**Gate G3 — UX completion:** IS-01 through IS-05 and PR-01 through PR-03 tested. Existing Inspector/review reused, no duplicate modals.

**Gate G4 — Real browser:** SW-01 through SW-03, UI-01/UI-02 verified in a fresh browser context including mobile and accessible alerts. Check console/page errors. No paid Gemini call without authorization.

**Gate G5 — CI/evidence:** Exact final SHA; fresh `npm ci`, `npm run typecheck`, `npm run lint`, `npm test`, `npm run build`; GitHub Actions Node22 job success and optional browser smoke job status. Historical 82/82 not copied as new result.

**Gate G6 — Adversarial second six cycles and delivery:** Review actual changes against all 9 suggestions and acceptance matrix, correct found defects with regression tests, rerun fresh verification. Only then claim the scope complete.

**Rollback and safety:** Never ship a risky storage migration or deletion behavior without a recoverable source state. A failed planned task does not justify reverting user-generated content. Document incremental commit SHAs, affected project schema, migration effects, known storage limitations and last safe rollback point. Do not automatically force-overwrite a conflict on startup.

**Final Turkish report must include:**
- Baseline SHA and final commit SHA.
- S1–S9: `IMPLEMENTED` / `ALREADY IMPLEMENTED, VERIFIED` / `DISPROVEN` / `BLOCKED` with evidence.
- R1–R6 and T0–T7 dispositions; confirmed versus plausible risks kept separate.
- Changed paths and minimal rationale; exact root cause for every code fix.
- RED test output, GREEN output, full test count, CI link, Playwright environment/screenshots when useful; paid Gemini tests explicitly BLOCKED if not run.
- Any partial/incomplete deletions, save warnings, privacy/security caveats, rollback instructions.
- A considered judgment about **controlled user testing readiness**, not an automatic declaration of general production readiness.

---

## 13. Short executor directive

Read this entire file and referenced current code at latest `main`. Plan then execute **only confirmed missing behavior**, preserving existing Story Bible, Consistency tab, Review Modal and IndexedDB architecture. Prioritize T4 data loss and T1 canonical clearing, then T2 navigation, T3 preview proof, T5 real browser and CI. Use TDD RED→GREEN, Superpowers, two six-cycle reviews, final GitHub Actions verification and a SHA-pinned Turkish report. Never duplicate already implemented S3/S4/S5/S6/S8/S9 work without a demonstrated failure. No live paid API or destructive project migration without explicit approval.

## 14. Pinned source links

- [App.tsx](https://github.com/Centaurioun/Proactive-Co-Creator/blob/6905db0b0a929efb05cfa42e5bbe9f6c6a505856/App.tsx)
- [ContextualInspector.tsx](https://github.com/Centaurioun/Proactive-Co-Creator/blob/6905db0b0a929efb05cfa42e5bbe9f6c6a505856/components/ContextualInspector.tsx)
- [DecisionInboxPanel.tsx](https://github.com/Centaurioun/Proactive-Co-Creator/blob/6905db0b0a929efb05cfa42e5bbe9f6c6a505856/components/DecisionInboxPanel.tsx)
- [canonicalModel.ts](https://github.com/Centaurioun/Proactive-Co-Creator/blob/6905db0b0a929efb05cfa42e5bbe9f6c6a505856/lib/canonicalModel.ts)
- [consistencyChecker.ts](https://github.com/Centaurioun/Proactive-Co-Creator/blob/6905db0b0a929efb05cfa42e5bbe9f6c6a505856/lib/consistencyChecker.ts)
- [projectController.ts](https://github.com/Centaurioun/Proactive-Co-Creator/blob/6905db0b0a929efb05cfa42e5bbe9f6c6a505856/lib/projectController.ts)
- [storageEngine.ts](https://github.com/Centaurioun/Proactive-Co-Creator/blob/6905db0b0a929efb05cfa42e5bbe9f6c6a505856/lib/storageEngine.ts)
- [releaseQualification.test.ts](https://github.com/Centaurioun/Proactive-Co-Creator/blob/6905db0b0a929efb05cfa42e5bbe9f6c6a505856/tests/releaseQualification.test.ts)
- [storageLifecycle.test.ts](https://github.com/Centaurioun/Proactive-Co-Creator/blob/6905db0b0a929efb05cfa42e5bbe9f6c6a505856/tests/storageLifecycle.test.ts)
- [GitHub CI baseline run](https://github.com/Centaurioun/Proactive-Co-Creator/actions/runs/43961470503)

**End of plan — do not treat this document as evidence that its implementation is complete.**
