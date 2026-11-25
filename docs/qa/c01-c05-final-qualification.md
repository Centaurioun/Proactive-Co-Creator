# PCC C01–C05 final qualification record

Date: 2026-11-25

Branch: `codex/pcc-uiux-final-implementation`

Accepted base: `d97fef0805f792304a7cc6f23d5cadcd9ed73845`

Approved Figma: [PCC Adaptive Draftroom](https://www.figma.com/design/U5cfM5KO4tuFsT1IoM3U44), handoff `48:2`

Environment: isolated local worktrees and private Chromium contexts; synthetic data only; `/api/health` returned `configured:false` for final bounded browser probes.

## Candidate and change boundary

This qualification extends the previously reviewed integration candidate `0599ced916740b0be9c0ac977ef0641183b03635` (tree `980661899ef6ff7bb7fb636d46a66584d30e050c`) with a narrowly scoped Q01 selection-integrity fix, shared mobile status-notice correction, and stronger QA evidence instrumentation. The final commit/tree identities and hosted CI result are recorded in the PR after publication.

The original Human Owner checkout and VIP Figma file were not modified. No production deployment, merge, provider call, paid service, dependency upgrade, or lockfile change occurred.

## C01–C05 acceptance matrix

| Workstream | Result | Evidence and remaining boundary |
|---|---|---|
| C01 — shared persistence, project creation and navigation | PASS within tested flows | Global status derives from editor dirtiness and persistence state. New-project creation waits for durable persistence before selecting the new project. Cancel/failure retains the current stable workspace. Reset Sample Plan remains under explicit disclosure and confirmation. J09 restored Plan/Review without reseeding the stable preference. |
| C02 — Write, Focus and editing continuity | PASS for tested browser flows | Existing manuscript editor remains the only draft authority. Focus return retains scene, scroll and focus; selection is restored only when the exact selected text still matches, otherwise it safely collapses rather than selecting unrelated text. Synthetic Turkish/Unicode and IME composition checks passed. OS-level IME and assistive technology were not tested. |
| C03 — Plan and narrative intelligence | PASS with responsive limitation | Live graph and inspector are retained; adaptive context, Decision Inbox, generated-output surface, Story Bible, opportunities, and Graph/Table/Ego/Family/Timeline/Mind Map remain available. At 320px graph height and label density remain constrained. |
| C04a — Review, evidence and proposals | PASS for stale-proposal contract | A proposal made at revision 6 became stale after a deferred decision advanced revision 7; Apply was absent, refresh was offered, direct mutation with the stale expected revision was rejected, and storage remained unchanged. A fresh proposal applied only after author action and persisted at revision 8. |
| C04b — Projects, Import, history and recovery | PASS for exercised flows; partial cancellation coverage | Source-only import preserved Unicode source/provenance and created one durable project without claiming semantic analysis. Empty Import exit returned to the prior stable mode without changing project count. Durable failure/retry created exactly one project. History and restore journeys were covered by existing synthetic scenarios. In-flight analysis cancellation and cancellation after staging a source were NOT TESTED. |
| C05 — independent bounded QA | PASS on bounded Q01–Q05 checks; full release/accessibility certification NOT CLAIMED | Independent browser probes covered retryable save failure, stale mutation rejection, compact navigation/focus, workspace restoration, import empty-state cancellation, and History read-only behavior. Limits are enumerated below. |

## Additional bounded browser evidence

### Save-state truthfulness and retry

At 320px, the save notice dismiss control is 44×44 CSS px. The notice is fixed over content on compact screens and auto-dismisses after eight seconds; the manuscript editor no longer loses usable height while a transient notice is present. A synthetic IndexedDB quota failure showed `Save failed`, preserved the draft buffer and previous durable record, and allowed retry. Retrying persisted the exact Unicode text `Retryable draft — Türkçe çığ 🦉 é` and advanced the persisted revision. Draft, failure and retry captures are under `evidence/browser/final-qualification-2026-11-25/`.

### Stale proposal and evidence

The Review probe used the live UI and existing mutation boundary, without provider requests. Deferring a local proposal advanced project revision 6→7; the old proposal displayed stale revision identity and did not expose Apply. A direct stale expected-revision mutation was rejected without changing IndexedDB. A newly refreshed proposal then applied with explicit author action and was read back durably. Screenshot: `q02-stale-review.png` (SHA-256 `de0424b8336edcf3a1af8926be53010fee763539e8d5fd8fd19dc5583a41dcc8`).

### Source-only import and return paths

Source-only import preserved the exact synthetic source and provenance, made zero narrative claims, and persisted one project. A synthetic durable storage failure kept the source available for retry; retry created exactly one project. No AI extraction/analyze endpoint was called. The separate Q05 probe verified six returns: Write/Plan/Review → Projects → Continue and Write/Plan/Review → Import → Exit. Each returned to its prior stable mode and preserved the corresponding versioned preference. IndexedDB inventory remained one project (`proj_default_cat_party`), revision 1, with canonical projection digest `1dafc74de7aff50a8e2922520f2fd69dc1947292f1bf9c8661fb6964966a7764` before and after all exits and History inspection. That synthetic project has `narrative:null`; preservation of non-empty manuscript records in this specific probe is not established. Import exit was tested only with no source selected; staged-source and in-flight extraction cancellation remain NOT TESTED.

### Compact navigation and accessibility observations

At 320px, keyboard navigation between Write, Plan, Review and back preserved dirty text and the stable mode. Document horizontal overflow was absent. The dismiss target measured 44×44 and keyboard focus showed a visible two-pixel ring. On the previous candidate, Review had two enabled native radio controls with 13×13 glyphs and associated label hit regions of 238×16 and 254×32; their centers were about 33.5px apart, so their 24px target circles do not overlap. A disabled 13px checkbox and disabled 64×22 numeric input are disabled controls. This is a bounded observation and does not establish general target-size conformance. Screen reader, VoiceOver and full WCAG 2.2 AA certification were not performed.

## Automated verification on integrated source

After the shared mobile notice and harness updates, a fresh `npm ci` completed with the existing package files unchanged. The following commands passed on the integrated source snapshot:

- `npm run typecheck`
- `npm run lint`
- `npm test -- --run`: 302 passed, 0 failed
- `npm run build`
- Stage0 J01–J12: 12/12 passed
- Browser E2E A–I: 9/9 passed
- Narrative workspace browser scenario: passed

The final Stage0 evidence file is `evidence/browser/stage0-j01-j12-2026-11-25.json` (SHA-256 `058690b3c25ab9c27ec36d8d2945e879f5ad550a5332fe4c76e091bee3c60d79`). Its unmocked API hits were exclusively `/api/ai/capabilities` discovery calls intentionally intercepted by the Stage0 trap and answered with HTTP 500. AI operation routes (`/api/analyze`, `/api/clarify`, `/api/generate/story`, `/api/generate/images`) were mocked; J11's story generation 503 was an explicitly mocked error case. No provider request occurred. Stage0 browser console therefore contains expected 500 errors from capability discovery and J11; E2E A–I separately had zero page or console errors.

J10 before/after semantic digests matched within the same run, revision and IndexedDB write count were stable. The digest can change between separate runs because snapshot timestamps are dynamic; only the within-run equality is an invariant here.

Build output retains existing Zod annotation warnings and a large-chunk warning (main bundle about 1.01 MB; PDF worker about 1.05 MB). `npm ci` reported seven moderate audit advisories. These were not changed because dependency modernization/remediation was outside the authorized scope.

`package.json` SHA-256 remains `30814e86281a24a54a9fc94c6fa54e8cd4c692e000181c8871ff8bd17dd5d813`; `package-lock.json` SHA-256 remains `c4251fab91960963140919d504c8003a595cec2323be00ca765eac9e950c3298`.

## Visual evidence map

Approved Figma node references: Desktop Write `10:2`; Mobile Write `16:2`; Focus `18:2`; Focus return `41:167`; Plan `13:2`; connected graph `45:32`; Review `14:2`; Mobile dark Review `16:29`; Projects `15:2`; Import `15:45`; Revision History `18:31`; recovery `44:174`.

Browser captures are under `evidence/browser/` and `evidence/browser/final-qualification-2026-11-25/`. They show actual application rendering and synthetic interaction states. The stale proposal capture is behaviorally matched to the stale Review flow; the separate Q05 captures show stable-workspace return and the empty Import exit. They are not pixel-perfect or complete equivalent-state comparisons for every Figma node. Visual acceptance gaps include full contextual selected-prose Write and all dark/light and responsive states side-by-side.

## Remaining mismatch and qualification register

| Classification | Item | Disposition |
|---|---|---|
| Observed and corrected | Compact transient save status displaced the manuscript editor; dismiss control was undersized | Corrected with fixed compact positioning, 44×44 dismiss target, auto-dismiss; 320px browser retest and narrative scenario passed. |
| Observed and corrected | Stale selection offsets could select unrelated text after intervening edits | Q01 fix now verifies exact selected-text identity and safely collapses selection if the anchor is stale. |
| Tested limitation | Plan graph area and labels are dense at 320px | Record as remaining responsive UX limitation; no graph replacement or static mock was introduced. |
| Not tested | Source-staged/in-flight import cancellation and delayed AI result after cancellation | No extraction operation was started because provider configuration was unavailable and no paid call was authorized. |
| Not tested | OS screen reader/VoiceOver and complete WCAG 2.2 AA audit | No certification claim. Automated and keyboard checks are partial evidence only. |
| Incomplete visual evidence | Complete equivalent-state Figma/browser pairs for selected-text contextual Write, stale proposal evidence details, and all required theme/viewport combinations | Retain as explicit limitation for architect review. |
| Build/security advisories | Existing Zod warnings, large bundles and seven moderate npm audit advisories | Not part of this bounded correction; no dependency changes. |

## Six-Cycle refinement and DMAIC control

The consolidated six-cycle review challenged: (1) complete scope and capability preservation; (2) domain authorities and shared interfaces; (3) cross-workspace integration; (4) stale/failure/recovery behavior; (5) responsive, keyboard and accessibility evidence; and (6) exact candidate and CI evidence. DMAIC control used the approved scope (**Define**), recorded baseline and browser measurements (**Measure**), traced reproduced save/selection/compact-layout defects (**Analyze**), changed only the narrow shared UI and selection behavior (**Improve**), and retained evidence and exact-head checks for the draft PR (**Control**). It did not restart discovery, design exploration, dependency modernization or technical remediation.

## Release status

The candidate remains a **draft PR** pending the Principal Architect's independent review and exact-head hosted CI. This qualification supports review of the implemented correction package; it does not claim full WCAG certification, provider behavior, in-flight import cancellation, or completion of every equivalent-state visual comparison.
