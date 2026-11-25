# C05 independent acceptance protocol

Status at preparation snapshot: **partial**. The later bounded Q01–Q05 follow-up and its limits are recorded below; see [`c01-c05-final-qualification.md`](c01-c05-final-qualification.md) for the consolidated disposition.
Prepared on base: `4281e497dca2bd81d297bb8a870a8892e025d936`
Scope: visual and behavioral acceptance for the PCC Adaptive Draftroom UI work. This protocol is not a release verdict.

Independent read-only C05 review identified the gaps listed below. The J09/J10 updates have now passed a fresh full Stage0 run at this source snapshot. A corrected 1440×900 Plan and Review capture exists, but Review is still an empty diagnostic state rather than Figma's stale proposal/evidence state. Do not describe that pair as equivalent-state visual acceptance.

## Authority and boundaries

Use the approved Figma file read-only. Relevant frames: Write `10:2`, mobile `16:2`, Focus `18:2`, return `41:167`; Plan `13:2`, graph `45:32`; Review `14:2`, mobile `16:29`, prototype `41:2–167`; Projects `15:2`, Import `15:45`, History `18:31`, recovery `44:174`. Compare the integrated candidate to these named frames and the existing product contracts, not to imagined prototype behavior.

All journeys use a fresh isolated browser context, the generated synthetic fixture, fixed viewport and captured console/page errors. Intercept `/api/**`; assert zero provider requests and `/api/health` reports `configured:false`. Do not use real manuscripts, production storage, Figma writes, credentials, or paid providers. Retain screenshots, browser trace, assertion output, fixture SHA-256, candidate HEAD/tree, and viewport/theme with each run. A screenshot proves appearance only; interaction and durability claims require recorded actions and readback assertions.

## Acceptance matrix

| ID | Figma / requirement | Deterministic setup and action | Required behavioral evidence | Visual / accessibility evidence |
|---|---|---|---|---|
| C05-WRITE-SAVE | Write `10:2`; truthful save status | Edit the synthetic manuscript; capture status before save, after acknowledged commit, and after injected IndexedDB write failure. Read the authoritative record back. | Dirty text is reported unsaved until commit; failure never reports Saved; failed text remains recoverable; retry persists exact Unicode text. Record IDB put/read outcome and revision. | Desktop Write screenshot in dirty, saved, and failure/recovery states; status is programmatically discoverable (`role=status`/live region where appropriate), editor label and Save action accessible. |
| C05-PREF-RELOAD | Write/Plan/Review preference; no reseeding | In an empty fresh origin, verify first-run Write; navigate to Plan then Review and reload. Inspect the preference key and all project stores before/after. Also visit Projects/Import and cancel. | Only stable workspace preference is restored; transient Projects/Import does not replace it; project IDs, snapshot, and count are unchanged by reload; no sample project appears in an empty workspace. | Capture first-run, persisted Review after reload, and cancel return states. Verify selected navigation semantics and keyboard activation. |
| C05-J10 | Plan `13:2`; Checks → Inspect Fox → Open Tone field | Use `FX-BUSY`; record project ID/revision, stable semantic snapshot digest, visible selection, and IDB write count before navigation. Run checks actions and inspect the Tone field. | Exact Fox is selected; Tone field is visible and `document.activeElement`; correct Story Bible tab is active; project/revision and semantic snapshot digest remain identical; no writes occur. Return action restores Checks context. | Capture Checks, Fox inspector, focused Tone, and return states. Keyboard-only action sequence; focus is visible and focus order is logical. |
| C05-STALE | Review `14:2`, prototype `41:2–167`; preserve current edit | Create a synthetic proposal at revision N; edit the target/project or switch project before Apply. Attempt apply at the real mutation boundary. | Apply is rejected with a stale reason; current user text and current project remain byte-for-byte unchanged; no success toast or revision is produced. Fresh proposal control case applies only after explicit author action. | Capture proposal preview, stale state, and preserved Write text; verify status is announced and controls expose disabled/rejected state. |
| C05-MOBILE-NAV | Write `16:2`; Review `16:29` | Repeat Write, Plan, Review, and return at 390×844 and 320×568. Exercise nav by mouse and keyboard/touch-sized control. | Correct workspace content appears; navigation does not discard dirty text; no horizontal document overflow; focus remains on/returns to a meaningful control. | Screenshot each workspace at both widths; record `scrollWidth`, viewport width, clipped primary controls, and focus target. Do not infer touch-target conformance from screenshots alone. |
| C05-IMPORT-CANCEL | Projects `15:2`, Import `15:45`; cancel and recovery `44:174` | Start from a saved synthetic project. Select a deterministic synthetic text source, begin analysis, cancel before completion, then separately inject durable write failure at explicit Create. | Cancellation creates/appends no project and cannot apply a late result; prior project and last stable view survive. A failed Create never claims success; proposal/source remains recoverable; retry yields one durable project only. | Capture import start, cancelled result, failure, and recovery/retry states. Check named controls, progress/error announcement, keyboard cancellation, and focus return. |
| C05-HISTORY | History `18:31` | Make one explicit synthetic edit, confirm revision, then open History and return without restore. | History is project-scoped; merely viewing/returning does not change project snapshot/revision; restoration requires explicit confirmation and verified persistence. | Capture History and return view; check heading/landmarks, focus, and restore warning/action distinction. |

## Semantic digest rule for J10

The digest must cover narrative meaning and exclude presentation-only state. Serialize a sorted-key projection of the active project's `snapshot` (including entities, relationships, Story Bible, decisions, clarifications, original/refined prompt, and mode), then SHA-256 it. Do not digest DOM, selected tab, focus, scroll, transient notices, or timestamps outside the snapshot. Record both the canonical projection and digest before/after J10, in addition to the project revision and IndexedDB write count. The integrated implementation may expose an established semantic digest; if so, document its inputs and use it without adding production behavior. Otherwise calculate the projection in the test context. Equal revision alone is insufficient evidence of semantic invariance.

## Independent visual and accessibility procedure

1. Record exact candidate HEAD and clean/dirty state; run the fixture generator and record its SHA-256. Start the candidate in a key-free environment and record `/api/health`.
2. Use fresh storage per journey and capture full-page plus viewport screenshots at 1440×900, 768×1024, 390×844, and 320×568 where relevant. For state changes, capture before and after. Keep screenshots unaltered; annotate findings in the report, not the evidence image.
3. Compare spacing, hierarchy, typography, controls, and content placement directly to the named Figma frame. Mark a mismatch only when the specified state is visibly different; distinguish intentional responsive adaptation from clipping or unreachable controls.
4. Run keyboard-only passes for primary nav, editor, proposal controls, import cancel/create, and history return. Record focus target after each action, visible focus, accessible name/role/state, and whether status/error changes are announced. Run the repository's automated accessibility checks, but do not equate them with screen-reader certification.
5. For every persistence claim, pair screenshot with storage readback after reload. For every rejection/cancel claim, record action sequence, project inventory and revision before/after, and absence of late writes. Preserve raw output and failures; report unavailable tests as **NOT TESTED**, not product defects.

## Existing coverage and gaps observed at preparation base

At base `4281e497`, `tests/workspacePreference.test.ts` covers the versioned preference helper and safe fallback; `tests/storageLifecycle.test.ts` covers persistence and read/write failures; import parser/persistence/recovery have unit coverage; `scripts/stage0-audit-browser.sh` already has J10 and checks Fox heading, Tone focus/visibility, active Story Bible tab, revision stability, and IDB write-count stability. These are existing signals, not execution results for the future integrated candidate.

The existing J10 browser assertion does not compare a semantic snapshot digest before and after navigation. Existing helper tests do not by themselves prove application preference restoration without project reseeding. The current acceptance suite should add no duplicate unit ownership: exercise these requirements end-to-end in this independent protocol and retain exact evidence. Import cancellation, stale Apply at the live UI mutation boundary, and the full mobile Figma states remain explicit rows above; current preparation did not execute them.

## Current evidence and remaining acceptance gaps

- C01–C04 implementations are integrated and local unit/browser/build suites were reported passing by the Lead. The initial C05 independent pass did not rerun those suites.
- J09's earlier evidence was insufficient. Updated Stage0 J09 **PASS** verifies Plan and Review restoration, records `{version:1, mode:"plan"}` and `{version:1, mode:"review"}`, and project-ID inventory equality over both reloads. It does not read back the empty-origin project store or exercise Projects/Import cancellation as specified by C05-PREF.
- J10's earlier result (`e47adc...` in one report and `03ec...` in an earlier observation) was invalid as the protocol's canonical digest. Updated Stage0 J10 **PASS** reads the active record from IndexedDB, omits undefined object properties and encodes undefined array items as null, then sorts object keys into valid JSON (the test parses the projection before hashing). It records the full 32,466-character projection and SHA-256 `086df717bb2b9cab2a6f6fa99b2e256bbe1558503aa2d97f69e32978b4959951` both before and after. Revision remained `3`, IDB put count `1 → 1`, Fox was selected, Story Bible was active, and `bible-tone` received focus. The full projection is preserved in `.playwright-cli/stage0-journeys.json`; three 1440×900 captures show Checks, Fox Inspector, and Tone focus. JSON scalar normalization follows `JSON.stringify` (including non-finite numbers becoming `null`); function/symbol values cannot normally arise from IndexedDB structured-clone records.
- The full synthetic J01–J12 run is preserved in `docs/qa/evidence/browser/stage0-j01-j12-2026-11-25.json` (SHA-256 `3b8f5079117c5d7e6e9a73560ce161b9792a0445e300b3f58e025f4acd44955d`). It includes the complete before/after canonical projection; only synthetic fixture content is present.
- C05-WRITE-SAVE has a narrative workspace quota-failure scenario preserving the draft and reading durable storage, plus save-state tests; its specified before-save/after-save/failed-save visual set and authoritative exact Unicode retry readback have not been bundled into one C05 run.
- C05-STALE has unit/presentation coverage and a disabled stale Apply path, but an independent browser test at the live mutation boundary with byte-for-byte manuscript readback is not recorded here.
- C05-MOBILE-NAV has 390px navigation/overflow coverage and 320px Write/reflow coverage. It does not yet exercise all Write/Plan/Review transitions at both widths with keyboard focus and dirty-draft guarding. The measured 320px Plan graph area and labels are cramped.
- C05-IMPORT-CANCEL has source-only and analyzed-import coverage; in-flight analysis cancellation plus injected durable Create failure/retry is not verified by a single browser scenario.
- C05-HISTORY/recovery has synthetic backup-copy, replacement checkpoint, restore, undo/redo and export journeys. A same-view before/after semantic digest check for merely opening History is not separately recorded.
- Figma and browser screen captures are mapped in `docs/implementation/narrative-workspace/design-qa.md`; the stale Review proposal/evidence state and selected-prose contextual Write still lack equivalent-state side-by-side captures.
- Stage0 J01/J09/J10 have no page errors but report 1/3/1 unmocked API hits and visible console HTTP 500 errors, respectively. The run's health check reported `configured:false`; preserve the console outcomes as observed rather than describing Stage0 as console-clean. E2E A–I is a separate run and reported no page/console errors.

**C05 disposition at the preparation snapshot:** enough for the Principal Architect to inspect the implementation direction and decide whether to keep the candidate in draft PR #15. The later bounded follow-up below supersedes this historical status for the checks it actually exercised; uncovered matrix rows and equivalent-state visual gaps remain open.

## Bounded follow-up after preparation snapshot — 2026-11-25

The initial C05 review above is historical. Follow-up probes were performed against the integrated correction source in isolated Chromium contexts. These later results do not erase the explicit limitations above:

- Save failure/retry retained the Unicode draft after injected IndexedDB quota failure, showed `Save failed`, then persisted exact text on retry. Compact status notice is now overlaid and transient, with a 44×44 dismiss target.
- Live stale proposal browser path advanced r6→r7 by deferral; stale Apply was unavailable and the direct stale-revision mutation was rejected without changing IndexedDB. A fresh proposal was explicitly applied and read back at r8.
- Source-only import and durable retry succeeded without claims or provider calls. Import cancel was tested only from an empty source screen; staged-source and in-flight cancellation remain **NOT TESTED**.
- Six Q05 return paths (Write/Plan/Review through Projects/Continue and Import/Exit) retained the stable mode preference. Project inventory/revision/projection digest were unchanged. The synthetic sample has no manuscript narrative, so this is not evidence for non-empty manuscript record preservation in that probe.
- Targeted 320px toast retest and narrative workspace browser scenario passed. Complete equivalent-state screenshot pairs, screen reader/VoiceOver, and WCAG 2.2 AA certification remain **NOT TESTED**.
- Stage0 unmocked `/api/ai/capabilities` requests were deliberately trapped by the test harness and fulfilled 500; AI operation routes were mocked. No provider request occurred.

## Finding classification

- **Observed defect:** reproducible failure against a matrix assertion, with exact candidate identity, steps, and matching screenshot plus behavioral evidence.
- **Hypothesis:** plausible risk without a reproduced failing assertion; retain as a follow-up probe, not a defect count.
- **Preference:** visual judgment or alternative design choice without a stated contract mismatch; report separately from defects.
- **Not tested:** unavailable or out-of-scope evidence. Never convert this into a product defect or a pass.

