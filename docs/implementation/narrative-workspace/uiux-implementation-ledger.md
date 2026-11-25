# PCC Adaptive Draftroom — implementation ledger

Branch: `codex/pcc-uiux-final-implementation`
Base: `d97fef0805f792304a7cc6f23d5cadcd9ed73845`
Approved design: [PCC Adaptive Draftroom](https://www.figma.com/design/U5cfM5KO4tuFsT1IoM3U44?node-id=48-2)
Test data and browser environments are synthetic and key-free.

## Decision register

| ID | Gate | Evidence | Alternatives | Recommendation / ruling | Principal Architect decision | Result |
|---|---|---|---|---|---|---|
| I0-J10-001 | I0 | Accepted base currently has J10 selector timeout (11/12 journeys); fixture produces unresolved Tone readiness action displayed as “Open field”. Existing test looked for “Edit Tone” and did not assert Fox selection or validate both revision values. | Fix confirmed selector/accessible-name mismatch; or classify actual navigation defect and correct handler; or waive J10. | Preserve journey and data contract; fix only demonstrated cause; strengthen assertions. | **APPROVED:** evidence-led diagnosis and narrow correction; do not waive/skip or weaken J10. Actual Architect reply read in Brave. | Selector drift demonstrated. Fresh browser regression to be strengthened with accurate target semantics, selected Fox, Tone field focus, valid unchanged revision and no content mutation. |
| I1-WORKSPACE-001 | I1 | Owner decision: resume last stable workspace; first load/bad preference/missing preference must be safe; new/imported project starts in Write. | Always force Write; restore last stable workspace; restore full scene/cursor state. | Versioned presentation-only preference for Write/Plan/Review; do not persist Projects/Import as last stable. | **APPROVED:** Principal Architect authorized this preference and specified its fallback/transition contract. Actual reply read in Brave. | Implemented versioned key and safe fallbacks. No full scene, selection, cursor, or scroll restoration is claimed. |
| I1-IMPORT-001 | I1/I4 | Stage0 journey found that successful JSON project restoration selected the imported project but left the user in the History panel context. | Keep current mode; return to Write; switch only for project-copy restore. | Apply the approved “new/imported project → Write” rule on successful JSON restoration; leave failures/cancellation in place. | Covered by existing approval in I1-WORKSPACE-001; no new decision required. | Added Write transition after successful durable restore and strengthened J09 to verify selected project identity. |

## Baseline

- Exact main base/tree: `d97fef0805f792304a7cc6f23d5cadcd9ed73845` / `326a2c098217fb8ccd33baaab215026f4d26ac87`.
- `npm run typecheck`: PASS; `npm run lint`: PASS; `npm test`: 289 passed, 0 failed; `npm run build`: PASS (existing Rollup PURE-comment and >500 KB chunk advisory).
- J01–J09/J11–J12: PASS; J10: FAIL at stale accessible-name locator after 30s. Browser page errors 0; no upstream AI calls (one blocked capability check per context). Captured via `scripts/stage0-audit-browser.sh` against key-free `http://127.0.0.1:3310`.
- Isolated visual baselines saved under `/tmp/pcc-uiux-baseline/assets/`; tracked `docs/ux-baseline/assets` unchanged.
- `package.json` SHA256 `30814e86281a24a54a9fc94c6fa54e8cd4c692e000181c8871ff8bd17dd5d813`; `package-lock.json` SHA256 `c4251fab91960963140919d504c8003a595cec2323be00ca765eac9e950c3298`.

## Six-cycle I0 plan review

1. Coverage — all authorized I0–I5 product surfaces are planned; protected narrative/source/artifact authorities remain explicit.
2. Sequence/contracts — exact baseline and J10 correction precede design implementation; foundations then functional surfaces then qualification.
3. Architecture — approved Figma is a presentation authority; app/controllers remain behavior authorities; incremental adaptation only.
4. Failure/recovery — stale analysis/proposals, import cancellation, conflict and recovery paths are acceptance cases; no fake save.
5. UX/accessibility — responsive dimensions, keyboard/focus, text enlargement, long Turkish text and graph table alternative included.
6. Integration/control — exact candidate CI, package identity, synthetic tests, no merge/deploy, and six-cycle final record required.

## Package checkpoints

| Package | Status | Evidence / limits |
|---|---|---|
| I0 preflight + J10 | COMPLETE | Exact base `d97fef0805f792304a7cc6f23d5cadcd9ed73845`; strengthened J10 target assertions; updated J01–J12 rerun evidence in `design-qa.md`. |
| I1 shell | COMPLETE | PCC semantic tokens/fonts, project selector, stable workspace preference, Write/Plan/Review navigation, explicit New/Import/Projects, responsive narrow-nav wrap, save revision state. |
| I2 Write/Focus | COMPLETE WITH LIMITS | Existing editor retained; editorial font and reading measure; manuscript save/undo/redo and scene controls retained. Focus state remains within the existing editor; scene/cursor/scroll state persistence is not claimed. |
| I3 Plan/intelligence | COMPLETE WITH LIMITS | Existing graph, table, decision inbox and inspector preserved as authorities; accepted Plan/Write shell and palette applied. Existing dense graph/data surfaces still need follow-on refinement where noted in `design-qa.md`. |
| I4 Review/import/projects/recovery | COMPLETE WITH LIMITS | Existing Review/Import/Projects/history/recovery surfaces and mutation contracts preserved; successful project creation/import returns to Write; exact interaction coverage and limitations in `design-qa.md`. |
| I5 qualification | COMPLETE LOCALLY; HOSTED CHECK PENDING | Final local typecheck/lint, 292 tests, build, J01–J12, E2E-A–I and narrative workspace flow passed; screenshots/report refreshed and six-cycle review recorded. Hosted exact-head CI and draft PR are the remaining handoff steps. |
