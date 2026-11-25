# PCC Adaptive Draftroom UI/UX Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox syntax for tracking.

**Goal:** Integrate the approved PCC Adaptive Draftroom design into the current React application while preserving its capabilities, narrative authorities and transaction behavior.

**Architecture:** Incrementally adapt the existing React shell, controllers and panels. Keep IndexedDB and existing controller contracts authoritative; add only presentation and interaction wiring at their existing seams. Validate each slice with focused tests and the established browser journeys.

**Tech Stack:** React 19, TypeScript 5.8.3, Vite 6, existing CSS/Tailwind 4, Node >=22.6; do not alter package manifest or lockfile.

**Spec:** `/Users/yusuf/Downloads/PCC-UI-UX-Implementation-Master-Prompt-FINAL.md`, approved PCC design file `U5cfM5KO4tuFsT1IoM3U44`, consolidated product spec and Gate 2 evidence in `docs/implementation/narrative-workspace/` and `docs/ux-baseline/`.

## Global Constraints

- Base is exactly `d97fef0805f792304a7cc6f23d5cadcd9ed73845`; use the dedicated worktree/branch only.
- Preserve all current product behavior and the four authorities: immutable source, working manuscript, accepted canonical model, immutable generated artifacts.
- Keep `package.json` and `package-lock.json` byte-identical to base; no upgrades, new dependencies, paid API calls or live Gemini.
- Use synthetic browser data, isolated origin/storage and deterministic API traps; do not use real manuscripts or production data.
- No Figma writes, VIP changes, production implementation outside this branch, main merge or deployment.
- Keep keyboard access, responsive reflow, truthful persistence/status, explicit author approval and stale proposal rejection.

## Review Focus

- J10 fixture and selector drift vs actual Checks navigation: prove exact selected Fox, Tone field focus, valid unchanged revision, and no semantic mutation.
- Dirty manuscript and IME/Unicode during focus or project navigation: preserve composed text and do not silently lose input.
- Invalid/stale restored workspace references: fall back safely without changing narrative state.
- Stale AI proposals after edits/project switch: disable and reject application at current mutation boundary.
- Partial import, cancellation and persistence failure: never create/append a project or claim success without explicit verified commit.

---

## Approaches considered (brainstorming checkpoint)

1. **Incremental integration (chosen):** map approved frames to existing React components and controller contracts. Lowest behavioral risk; requires adapting sparse Figma frames to the full product.
2. **Replace shell/editor:** could produce close visual parity quickly but risks loss of existing journeys, state authority and recovery behavior; rejected.
3. **Parallel new app or broad rewrite:** clean separation but duplicates data/state and breaks the existing-app requirement; rejected.

## Planned file responsibilities

- Existing `App.tsx` and `components/**`: shell, navigation, adaptive workspace and surface integration.
- Existing styles and tokens (`index.css`, Tailwind/theme sources): semantic PCC palette, typography, modes and responsive primitives.
- Existing `lib/**` and controller files: remain behavior authorities; touch only with a failing regression test and smallest justified seam correction.
- Existing `tests/**` and `scripts/stage0-audit-browser.sh`: behavior and browser acceptance; strengthen assertions, never weaken.
- `docs/superpowers/plans/...`: execution plan; `.superpowers/sdd/.../progress.md`: task ledger; `docs/implementation/narrative-workspace/uiux-implementation-ledger.md` and `design-qa.md`: durable final evidence and handoff.

### Task 1: I0 exact-base preflight and J10 resolution

**Files:** `scripts/stage0-audit-browser.sh`, as evidence warrants; `scripts/stage0-fixtures.ts`, only if a fixture correction is the proven root cause; focused tests if production behavior is implicated. Create implementation ledger.

- [ ] Reproduce J10 in a fresh isolated browser context and save baseline result/trace outside tracked UX baseline assets.
- [ ] Inspect actual checks panel, issue targets and runtime accessibility tree; determine why target button is missing after navigation.
- [ ] Test-first correction: strengthen assertion on selected Fox, field/domain visibility, `document.activeElement`, valid same revision, unchanged snapshot/digest and no revision advance. Use condition-based waits.
- [ ] If fixture/selector-only cause: change fixture/test only. If app behavior defect: first add a failing focused test, then narrowly correct existing handler and re-run relevant suite.
- [ ] Re-run J01–J12 in a fresh isolated browser session; expected 12/12, 0 page errors, 0 unmocked AI calls. Preserve old failure trace.
- [ ] Run and record `npm ci`, `npm run typecheck`, `npm run lint`, `npm test`, `npm run build`; verify package/lock hashes unchanged.

### Task 2: I1 shell and responsive foundations

**Files:** existing app shell/navigation components and `App.tsx`; existing theme/style sources; focused tests/scripts.

- [ ] Map the approved semantic PCC tokens, Literata/DM Sans font roles, light/dark states, focus and reduced-motion to existing styling infrastructure.
- [ ] Adapt global project selector, Write/Plan/Review, explicit New/Import/Projects entry points, save state and collapsible context panels without duplicate state.
- [ ] Restore last valid workspace through existing presentation-preference facilities; validate references and fallback safely without schema or authority changes.
- [ ] Verify 1440×900 and 390×844, first launch/resume/switch/deleted target, keyboard and truthful storage warning before proceeding.

### Task 3: I2 Write and Focus

**Files:** `components/manuscript/ManuscriptEditor.tsx`, existing manuscript outline/style/context components, shell integration, focused tests.

- [ ] Apply editorial writing typography, selected passage/evidence context and compact responsive panel layout to existing editor.
- [ ] Implement focus entry/return and validated position restoration; retain unsaved content, composition, selection semantics, undo/redo and persistence acknowledgements.
- [ ] Verify Unicode/Turkish/combining marks, selection, IME composition events (OS IME only if available), reload/project switch, stale suggestion preview/rejection and safe return.

### Task 4: I3 Plan and narrative intelligence

**Files:** existing graph, map, timeline, Story Bible, decision, inspector and opportunity components; focused tests.

- [ ] Adapt Plan surfaces to approved hierarchy while preserving canonical graph identity, selection, search/filter, zoom/pan and accessible table equivalent.
- [ ] Make provenance, confidence, issue lifecycle, timeline-vs-manuscript order, opportunity rationale/trade-offs and approval states readable without color alone.
- [ ] Preserve generated output, scoped proposal review, request-ticket guards and human adoption; verify views, object selection, stale guard and mock analysis.

### Task 5: I4 Review, import, projects and recovery

**Files:** existing Review/Import/History/Projects components, persistence/controller seams only where required, tests and browser journey scripts.

- [ ] Adapt review diff, evidence, base revision/digest, accept/reject/defer, stale states, diagnostics and decision workflows.
- [ ] Adapt project operations and import inspection/analysis/preview/create while preserving immutable source and explicit commit boundaries.
- [ ] Clarify revisions, proposals, artifacts, recovery, restore, export and backup states; verify cancel, append conflict, partial failure and recovery with synthetic fixtures.

### Task 6: I5 qualification and handoff

**Files:** `docs/implementation/narrative-workspace/uiux-implementation-ledger.md`, `design-qa.md`, browser evidence artifacts, final source changes only.

- [ ] Run full behavior suite, E2E A–I, J01–J12, and UX checks at 1440×900, 1280×800, 768×1024, 390×844 and 320 CSS px; light/dark, keyboard, focus, reduced motion, text enlargement and measured contrast.
- [ ] Compare matching Figma/rendered states, record material mismatches and one bounded fix pass; provide exact screenshots/nodes and limitations.
- [ ] Verify exact base/head/tree, lock identity, `trail check`, package checks, final review and hosted Node 22/Chromium CI on exact candidate.
- [ ] Commit coherent slices, push only the dedicated branch, open one draft PR and verify its exact-head CI. No merge/deploy.
- [ ] Complete six distinct review passes and the DMAIC acceptance/control matrix in the final Architect handoff.

## Six-cycle plan review (I0)

1. **Coverage:** tasks map approved capabilities to I1–I5; protected authorities and owner exclusions remain explicit.
2. **Sequence/contracts:** J10 baseline first; foundations precede surfaces; final CI only qualifies exact head.
3. **Architecture:** incremental reuse chosen; no duplicate graph, persistence or app scaffold.
4. **Failure/recovery:** stale proposal, import cancellation, invalid workspace restore, write errors and conflicts are acceptance cases.
5. **UX/accessibility:** desktop-first plus tablet/mobile; keyboard, long Turkish strings, focus, IME, text enlargement and accessible graph alternative included.
6. **Integration/control:** manifest/lock identity, no live AI, isolated data, exact-base QA, rollback branch and draft PR boundary recorded.

## Six-cycle implementation/report review (I5)

Record one evidence-backed pass each for scope/coverage, sequencing/contracts, architecture/authority, failure/recovery, UX/accessibility, integration/control. For every pass record challenge, evidence, resulting change, and remaining risk. This is not an independent review or certification.
