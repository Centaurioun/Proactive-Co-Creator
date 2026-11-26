# PR #18 bounded completion ledger

Program: `PCC-PR18-COMPLETION-002`  
Continuation: `chatgpt/pcc-adaptive-context-followup-20261126`  
Verified start: `202d0babf0a50bfd20bc5c885b9bf321af33becb` (`9a05e0aa403bb112fdf7f279887fdb890fab7f66`)

## Preflight

- PR #17 is open/draft at `eebe4d94a24a83c8bb65e6f8e3ec46c2224c5f20`, based on `main`.
- PR #18 is open/draft at the verified continuation SHA and targets PR #17's branch. No PR #17 changes are authorized.
- Primary integration worktree: `/Users/yusuf/.codex/worktrees/pcc-adaptive-context-followup`.
- The user's original checkout is on `codex/phase-02-intelligent-narrative-import` with unrelated dirty `.gitignore`, `.ignore`, and `graphify-out/`; these remain untouched.
- Continuation worktree has unrelated untracked `graft/`; preserved. Its existing local server process was observed, but no source writer was found. The server was not stopped.
- Baseline on Node `v26.12.1`: typecheck, lint, 403 unit tests, build, and `git diff --check` passed. Build emitted the existing >500 KiB chunk warning. This is local baseline evidence, not hosted qualification.

## Frozen shared contracts

- Provider plan identity is connection, exact model slug, reasoning level, capability policy version, and a non-secret credential authority identity.
- The credential authority identity is opaque and changes on process restart or credential generation invalidation. It is a compatibility fence, not an account identifier; a checkpoint with a different identity must be requalified before resume.
- Narrative extraction requests carry that identity. Server middleware verifies the request binding against the server-selected connection/model/reasoning, current capability evidence and current credential authority before handler dispatch.
- Story SRB production authority remains disabled. Trusted test-only router injection may exercise the real route and adapter chain; no HTTP/body/query/browser activation flag is allowed.
- Checkpoint attempt ownership stays in IndexedDB and must not confer canonical project authority or refund uncertain provider attempts.

## Parallel packages

All four workers were spawned as GPT-6 Luna / Medium from the exact verified base. Each has an isolated worktree and local branch. Only the integration lead may publish or update PR #18.

| Package | Finding | Worktree / branch | Commit | Status |
|---|---|---|---|---|
| Capability registry | CAT-F01 | `/Users/yusuf/.codex/worktrees/pcc-pr18-completion-002/cat-f01` / `codex/pcc-pr18-capability-20261126` | `cca19ccb19ca36a5f64f3a8c0852d2bde295f69c` → integration `0d4c5ac` | Evidence registry, catalog state handling and 13 focused tests reported pass; integrated |
| Adaptive planner | ACE-F02 | `/Users/yusuf/.codex/worktrees/pcc-pr18-completion-002/ace-f02` / `codex/pcc-pr18-adaptive-context-20261126` | `98edb96156106e17abcece5bd80d893c7427b776` → integration `6d9488e` | Grapheme-safe bounded planner and 19 focused tests reported pass; integrated |
| Checkpoint fencing | ACE-F01, ACE-F03 | `/Users/yusuf/.codex/worktrees/pcc-pr18-completion-002/ace-f01-f03` / `codex/pcc-pr18-ace-checkpoint-20261126` | `64e190d8e6a570d81e80ee3a0bd849f9583791e4` → integration `d40e388` | Transactional leases, attempt/incarnation fencing and six unit tests plus browser concurrency qualification reported pass; integrated with lead request contract |
| Story SRB | SRB-F01 | `/Users/yusuf/.codex/worktrees/pcc-pr18-completion-002/srb-f01` / `codex/pcc-pr18-srb-20261126` | `f59a6ad961ae16e09227a9476d3123d5ba9cb7bd` → lead route integration pending | Local transport commit; 29 focused tests and local checks reported pass |

## Lead-owned shared work

- Added `credentialAuthorityIds` to provider status and `getCredentialAuthorityId()` on the server. Identity is a random process instance plus a provider generation; it contains no credential material and invalidates persisted resume after process restart.
- Added `providerPlanBinding` to the narrative extraction request contract. Server middleware checks the connection/model/reasoning/policy/credential identity against the request headers and current server authority before handler dispatch.
- Added route regressions for successful binding, missing binding, stale authority rejection, and handler suppression. Targeted routes/provider authority tests passed (18/18); targeted typecheck and lint passed after this shared work.
- Integrated `/generate/story` with the process-wide disabled SRB authority and bounded Responses story adapter. Only trusted router-option injection activates the deterministic qualification path; the normal route remains blocked by exact-model operation policy and disabled SRB. The route test exercises request parsing, provider admission, SRB prepare/run, the story transport adapter seam and response validation; it confirms no Gemini fallback. The integrated focused set passed 76/76 tests, typecheck and changed-file lint.
- Integrated story route, independent review, integrated QA, final hosted evidence and PR update remain pending.

## Current limitations

- No provider, account, credential, paid-use, merge, or deployment action has occurred.
- No hosted check has yet been run against the final candidate SHA.
- Final finding closure, final HEAD/tree, integrated tests, independent review, integrated QA, and operation eligibility matrix are pending.
