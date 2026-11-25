# C05 independent acceptance protocol

Status: **prepared; not run against the integrated candidate**  
Prepared on base: `4281e497dca2bd81d297bb8a870a8892e025d936`  
Scope: visual and behavioral acceptance for the PCC Adaptive Draftroom UI work. This protocol is not a release verdict.

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

## Finding classification

- **Observed defect:** reproducible failure against a matrix assertion, with exact candidate identity, steps, and matching screenshot plus behavioral evidence.
- **Hypothesis:** plausible risk without a reproduced failing assertion; retain as a follow-up probe, not a defect count.
- **Preference:** visual judgment or alternative design choice without a stated contract mismatch; report separately from defects.
- **Not tested:** unavailable or out-of-scope evidence. Never convert this into a product defect or a pass.

