# PCC C01–C05 completion ledger

## Authority and preflight

- Principal Architect decision read in the existing Brave conversation: keep PR #15 draft and complete the UI/UX implementation packages; passing functional tests and theme integration alone do not establish the approved Adaptive Draftroom implementation.
- Human Owner authorized the bounded C01–C05 implementation and five concurrent Luna Medium workers.
- PR branch: `codex/pcc-uiux-final-implementation`; reviewed HEAD `4281e497dca2bd81d297bb8a870a8892e025d936`; tree `2e283dbed1ad061908c568661e48da6f9c91c986`; accepted base `d97fef0805f792304a7cc6f23d5cadcd9ed73845`.
- PR worktree initially had only pre-existing untracked `graft/`; it is generated locally and excluded from commits. Human Owner checkout remains untouched.
- Before this correction batch: `npm run typecheck`, `npm run lint`, `npm test` (292/292), and `npm run build` passed after `npm ci`; prior hosted CI for the exact reviewed HEAD passed. The earlier UI qualification had only partial screen coverage and is not final C01–C05 acceptance evidence.
- Dependency lockfiles must remain byte-identical to hashes recorded in the implementation ledger.

## Shared contracts and dependencies

- `App.tsx` owns active project identity, durable IndexedDB/CAS transactions, import/recovery, mode preference, navigation guard, save status, and cross-workspace callbacks.
- `ManuscriptEditor` owns only its live editor buffer and local selection/scroll/focus state. It must report dirtiness; no second canonical or durable draft authority.
- Presentation components receive callbacks and data from App; they do not write storage or accept narrative claims as canon.
- Shared save presentation distinguishes `draft-unsaved`, `project-unsaved`, `saving`, `saved`, `conflict`, `failed`, and `restoring`. AI availability remains independent.
- New-project creation is staged in a direct dialog. The current project is durably flushed when needed; the new project is selected and routed to Write only after successful IndexedDB persistence. Cancellation/failure preserves the originating mode.
- The stable workspace preference remains limited to Write/Plan/Review. Projects and Import do not overwrite it. Resume means restore this stable mode.
- Mobile workspace tab state remains App-owned and is not duplicated inside Plan or Review.
- Shared files reserved to Lead: `App.tsx`, `components/Header.tsx`, `index.css`, workspace preference/save-state contracts, shared shell/navigation and common E2E harness.

## Exclusive workstream ownership

| Package | Owner | Isolated branch | Files / responsibility | Depends on |
|---|---|---|---|---|
| C01 | Lead | `codex/pcc-uiux-final-implementation` | App, Header, new-project dialog, save-state helper/tests, preference/navigation integration | Foundation for C02–C04 callbacks |
| C02 | Luna Medium worker 1 | `codex/pcc-c02-write` | Manuscript editor and writing-only components/tests | Lead context/persistence callbacks |
| C03 | Luna Medium worker 2 | `codex/pcc-c03-plan` | Plan presentation layout and owned tests | Lead App slot composition and mobile tab authority |
| C04a | Luna Medium worker 3 | `codex/pcc-c04a-review` | Review and evidence/proposal presentation/tests | Lead return-to-writing navigation/context |
| C04b | Luna Medium worker 4 | `codex/pcc-c04b-projects` | ProjectHub, import, history/recovery presentations/tests | Lead create/resume/open-project callbacks |
| C05 | Luna Medium worker 5 | `codex/pcc-c05-qa` | Independent QA protocol and deterministic synthetic fixture; final review after integration | Complete integrated candidate |

Workers have explicit `gpt-6-luna`, `medium`, isolated worktrees and no recursive-spawn instructions. The Lead alone integrates, pushes and updates PR #15.

## Figma evidence map

Approved file: [PCC Adaptive Draftroom](https://www.figma.com/design/U5cfM5KO4tuFsT1IoM3U44), handoff `48:2`.

| Screen/flow | Nodes | Reference capture status |
|---|---|---|
| Desktop Write | `10:2` | MCP screenshot returned, 1440×968 |
| Mobile Write | `16:2` | Approved node ID; capture to be verified in final qualification |
| Focus / restoration | `18:2`, `41:167` | MCP screenshots returned, 1440×960 / 1440×920 |
| Plan and connected graph | `13:2`, `45:32` | Approved node IDs; Plan screenshot request returned transport error; retry during final qualification |
| Review / mobile dark Review | `14:2`, `16:29` | Review screenshot returned, 1440×968; mobile capture pending |
| Projects / Import | `15:2`, `15:45` | MCP screenshots returned, 1440×918 / 1440×928 |
| Revision History / recovery | `18:31`, `44:174` | History screenshot returned, 1440×968; recovery capture pending |

Screenshots are design evidence only. They do not prove implementation, persistence, AI behavior, or accessible operation.

## C01–C05 integrated status

- Added a tested pure mapping from reactive editor/persistence state to truthful global save presentation.
- Added a direct cancellable project creation dialog. Project persistence is awaited before changing active project/workspace. The former New-to-History route is being removed from desktop and mobile New actions.
- Reset Sample Plan is exposed behind a “Sample data” disclosure and destructive-action confirmation.
- C01 PASS: global save status is reactive and separates manuscript draft dirtiness, durable project-save pending state, persisted revision, conflict, failure and restore. New Project persists before switching; cancellation/failure keeps the originating workspace and stable preference. Reset Sample Plan remains behind explicit confirmation. J09 checks preference restoration without forcing a reload reseed.
- C02 PASS: the existing manuscript editor remains the sole draft authority and stays mounted across workspaces. Focus return keeps scene, Unicode-safe selection, scroll and editing position; IME composition prevents unsafe navigation. Browser probes use synthetic text only.
- C03 PASS: Plan uses the live graph and inspector slots, with collapsible context tools, decision inbox, dedicated generated output, Story Bible, opportunities and existing graph/table/ego/family/timeline/mind-map navigation. Mobile output starts collapsed and the plan prompt is disclosed to reduce obstruction. At 320px, usable graph height and label readability remain a visual limitation.
- C04a PASS: Review presents proposal/evidence/provenance/revision context; stale proposals cannot be applied through the UI or mutation guard. Returning to Write preserves current content and the in-memory proposal review context.
- C04b PASS: Projects, resume, import, history, backup, export and recovery remain available. Source-only import preserves source bytes/provenance without implying semantic analysis. Backup preview distinguishes separate-copy restore from replacement and requires an explicit safety checkpoint/confirmation.
- C05 PARTIAL: independent review found no reproduced production-code failure, but final acceptance remains incomplete because empty-origin/no-reseed, full mobile-nav, in-flight import cancellation/create failure, live stale-apply, and equivalent-state stale Review/selected-prose Write checks are not fully covered. The reviewer recommends Principal Architect review of the implementation candidate. Deterministic synthetic FX-BUSY fixture hashes match across two fresh processes: `b9cfd72d0d089cbb84c18a7fa34f218e6898801b767d7bf3898e340636b42589`.

## C05 prepared artifacts

The QA worker added `docs/qa/c05-independent-acceptance.md` and `scripts/c05-fixture.ts` on isolated branch `codex/pcc-c05-qa`. The fixture was run twice after `npm ci`; both fresh processes emitted the same SHA-256 above. C05's earlier review rejected the then-current snapshot as not determined; final read-only review must use the frozen integrated candidate.

## Integration checkpoints

- C01 Lead commit: `5381c721` — truthful global save status, direct durable project creation, protected sample reset, save presentation tests.
- C03 worker commit integrated: `dd3d7aa` — adaptive Plan shell plus live decision/graph/inspector/output slots. Lead mounted it around the existing graph and inspector and kept mobile tab/output state App-owned.
- C05 prepared artifacts integrated: `bf060bd` — acceptance protocol and synthetic fixture; final evidence review remains pending.
- C02 worker commit integrated: `8cf0099` — persistent editor mount integration, Unicode-safe selection/focus/scroll return, contextual reference validation, composition state callback. Worker verified focused Chromium behavior with synthetic Turkish/Unicode text and IME composition simulation.
- Lead fixed Stage0 preference seeding: scenario preference and project fixtures now seed once per page context instead of forcibly reseeding mode on every reload.
- Cross-workspace initial verification after C01–C03 integration: typecheck and lint passed; 296 unit tests passed. These are partial integration checks, not final acceptance.
- C04a worker commit integrated: `04bbc88` — review proposal freshness, evidence and safe return context. C04b commits integrated: `d176ea6`, `76d134b` — project/import/history/recovery surfaces and source-only faithful import.
- Final local qualification: `npm ci`, typecheck, lint, 299/299 unit tests, build, Stage0 J01–J12 (12/12), E2E A–I (9/9), and narrative workspace recovery scenario pass on the current source snapshot. Updated J09 records Plan/Review preference and unchanged project inventory across reloads. Updated J10 canonicalizes the active IndexedDB snapshot and records identical before/after 32,466-character valid canonical JSON projections and SHA-256 `086df717bb2b9cab2a6f6fa99b2e256bbe1558503aa2d97f69e32978b4959951`, revision `3 → 3`, puts `1 → 1`. Stage0 J01/J09/J10 report 1/3/1 unmocked API hits and console HTTP 500 errors (no page errors); health reported `configured:false`. E2E A–I separately had no page/console errors. No live manuscript or paid provider was used.
- Build emits existing Zod annotation warnings and a 1,010.36 kB main bundle warning (>500 kB). No dependency or package manifest/lockfile change is authorized or included.
- Visual captures live in `docs/qa/evidence/{figma,browser}/`. Browser Plan and Review desktop frames were corrected to true 1440×900 captures; 390×844 mobile states, 320×844 Plan, Focus, Projects, Import, History and Recovery are also present. They are representative state captures and not pixel-identical qualification of every Figma node.
- Accessibility evidence: no overflow/clipped-right content across tested 1440×900, 1280×800, 768×1024, 390×844, 320 CSS px and 200% zoom-equivalent viewport; 0 unnamed controls. The responsive scan measured 23 controls below 44×44 at 390/320 and 4 below 24×24. Contrast samples pass in the measured light/dark pairs, but a complete WCAG 2.2 AA or screen-reader certification is not claimed.
- Remote PR #15 was checked before publication and still pointed to reviewed head `4281e497dca2bd81d297bb8a870a8892e025d936`; the integration branch was seven commits ahead at `76d134b5b67625c61eb52af014e73f1b0888e2d6`, with current uncommitted integration/QA changes. The final exact head/tree and hosted CI must be recorded after final review and push.

## Six-Cycle review (consolidated after integration)

1. **Scope and capability map:** preserved the full PCC capability set and existing narrative entry points; no writing-only simplification or simulated graph was introduced.
2. **Domain authority and interfaces:** kept manuscript editor, transactions, AI ticket authority, review freshness and storage as sole authorities; presentation layers consume App-owned state/callbacks.
3. **Integration:** lead integrated owned patches in dependency order; project selection and mobile navigation remain centralized; all 299 unit tests and browser journeys pass.
4. **Failure and recovery:** exercised stale proposal rejection, failed/unconfigured AI, storage conflict paths, import/recovery, backup copy and confirmed replacement using synthetic data; cancellation returns safely.
5. **Responsive/accessibility:** five specified viewports plus 200% zoom-equivalent checked; no overflow or unnamed control. Small touch targets, mobile Plan graph density, full text enlargement and screen-reader behavior remain open.
6. **Evidence and exact candidate:** screenshots exist for the named screen families and J10 states, though selected-text contextual Write and stale proposal/evidence Review are not equivalent-state matched. C05 final acceptance is partial. Exact final commit/tree, Principal Architect review, and hosted CI are publication gates; PR must remain draft.

## Final bounded correction addendum — 2026-11-25

This addendum supersedes the earlier “C05 PARTIAL” and open-Q01/Q02/Q05 statements above for the bounded checks executed after candidate `0599ced916740b0be9c0ac977ef0641183b03635`. The complete result is in [`docs/qa/c01-c05-final-qualification.md`](../../qa/c01-c05-final-qualification.md).

- Q01/Q02 passed: stale text selection is no longer restored against unrelated text; stale proposal Apply was rejected at the live UI and mutation boundary, with durable storage unchanged. Fresh proposal control was explicitly applied and read back.
- Q03 passed for source-only import and durable retry. Empty Import exit and no-source cancel were exercised. Staged-source/in-flight extraction cancellation remains NOT TESTED because no extraction was started.
- Q04 passed for compact dirty-draft navigation and the shared status notice. The notice no longer permanently displaces the 320px editor, its dismiss action is 44×44, and it auto-dismisses after eight seconds. Full assistive-technology/WCAG certification remains unclaimed.
- Q05 passed for six Projects/Import return paths and stable workspace preference. The synthetic project inventory, revision and canonical projection digest were unchanged through exits and History inspection. The synthetic fixture had no manuscript narrative, limiting that specific preservation claim.
- Fresh integrated-source checks: typecheck, lint, 302/302 unit tests, build, Stage0 12/12, E2E A–I 9/9, and narrative workspace scenario passed. Stage0's unmocked calls were capability-discovery checks trapped and answered 500; AI operation routes were mocked. No provider call occurred.
- The report records remaining responsive density, equivalence-capture, screen-reader and staged/in-flight import limitations. Draft PR #15 remains subject to exact-head hosted CI and Principal Architect review.
