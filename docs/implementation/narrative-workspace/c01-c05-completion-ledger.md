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

## C01 work in progress

- Added a tested pure mapping from reactive editor/persistence state to truthful global save presentation.
- Added a direct cancellable project creation dialog. Project persistence is awaited before changing active project/workspace. The former New-to-History route is being removed from desktop and mobile New actions.
- Reset Sample Plan is exposed behind a “Sample data” disclosure and destructive-action confirmation.
- Remaining C01 integration: connect Projects resume/open/create callbacks; verify stable preference is not re-seeded in reload test setup; complete browser failure/cancel/save-state cases.

## C05 prepared artifacts

The QA worker added `docs/qa/c05-independent-acceptance.md` and `scripts/c05-fixture.ts` on isolated branch `codex/pcc-c05-qa`. These describe a prepared protocol and fixture wrapper only; the fixture was not run because the QA worktree lacked dependencies. Final QA must follow integration.

## Six-Cycle review (consolidated after integration)

Record one result for each: (1) capability scope; (2) domain authority and shared interfaces; (3) cross-workspace integration; (4) failure, cancellation and recovery; (5) responsive/accessibility behavior; (6) exact-candidate test, visual and hosted evidence. This section remains pending until integration and verification are complete.
