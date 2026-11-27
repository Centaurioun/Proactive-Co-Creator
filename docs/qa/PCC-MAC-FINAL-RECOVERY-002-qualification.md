# PCC-MAC-FINAL-RECOVERY-002 — Qualification report

**Status: source and synthetic qualification passed; packaged GUI qualification remains partial.** This report records the isolated recovery branch only. It does not certify the installed owner app, upstream provider execution, billing, or release readiness.

## Executive summary

The original macOS screenshots were inspected by ChatGPT. They support D01, D03 and D05 as screenshot observations; they do not establish that an inference reached a provider or incurred billing. The screenshots also show an inconsistent Plan Story state: the top and bottom **Generate Story** controls appear enabled while **Generate Story from Confirmed Plan** appears disabled for the same ChatGPT model/reasoning selection.

F4 now derives Story eligibility once per operation and supplies the same result and explanation to all three controls. This fixes the conditional UI discrepancy in the implementation. A synthetic ChatGPT Luna/Medium fixture verifies that all three controls are disabled consistently; the client transport is intercepted, and a server-route test independently rejects Medium without adding provider transport. Server admission remains the authority. The permitted ChatGPT scope remains local trusted GPT-6 Luna / Default Story only. No provider authorization or live inference was added.

The isolated packaged app launched on macOS 27.0.1 arm64 from the recovery worktree and an isolated profile at `/tmp/pcc-recovery-profile-20261127`, using port 4324 and with provider API environment variables removed. A clean Write workspace was observed and captured. The app was not installed over or substituted for `/Applications/Proactive Co-Creator.app`. Direct packaged GUI traversal of the Plan and Review workflows, D04 and NAV01 is incomplete; this report therefore does not claim those checks passed.

## Findings and disposition

| Finding | Evidence and disposition |
|---|---|
| D01 | Supported by the eight original screenshots, as reviewed by ChatGPT. No claim about hidden transport or provider receipt. |
| D03 | Supported by the screenshots as an observed spinner/TLS-related symptom. The screenshots do not prove upstream inference receipt or billing. Root cause attribution remains limited to observed evidence. |
| D05 | Supported by the screenshots. This report does not infer unobserved behavior beyond the screenshots. |
| Plan Story entry-point inconsistency | Reproduced in the original screenshots. Root cause: only the Confirmed Plan output control consumed `chatGptStoryBlocked`; top and bottom controls used loading state alone. Fixed by sharing operation-specific Story eligibility and block reason across all three controls. |
| D04 / NAV01 | Not qualified in the packaged GUI during this pass. No cause or pass is asserted. Existing source and browser smoke evidence is not equivalent to a packaged macOS interaction. |

## F4 implementation and qualification

The shared resolver uses Provider Hub status, field-wise preference resolution, connection state, selected model, reasoning capability and operation capability. It resolves Plan analysis/clarification, Story, prompt refinement, Writing Assistant, Review diagnostics, manuscript/model sync, narrative import/enhancement, opportunities and optional semantic auto-analysis independently. Block messages reflect the operation’s state. The auto-analysis opt-in remains preserved while unavailable. Provider Hub UI state is advisory only; route admission remains independent.

For the additional Plan finding, the top action, workspace bottom action and Confirmed Plan action consume the same Story eligibility and explanation. Synthetic Medium reasoning is blocked at each. The UI test was observed failing before wiring and passing after the change. An intercepted client transport test verifies the blocked action does not send a request. A separate injected route test confirms server-side rejection before provider transport. No live provider request was made.

## Verification evidence

- `npm ci` — passed (Node v26.12.1, npm 11.20.0); npm reported six moderate dependency advisories, not changed in this scoped repair.
- `npm run typecheck` — passed.
- `npm run lint` — passed.
- `npm test` — 579/579 passed.
- `npm run build` — passed; Vite reported existing large-chunk warnings.
- `E2E_BASE_URL=http://127.0.0.1:4323 bash scripts/e2e-browser-smoke.sh` against a key-free production server — E2E-A through E2E-I passed, no page/console errors and no provider requests. The test harness permits only local capabilities and read-only Provider Hub status; other API calls remain intercepted.
- Focused baseline RED on isolated test-first commit `af039ea3bcae6ef338b0dbccb45a3d31c22e835b`: stale broad ChatGPT operation metadata allowed the analyze handler to reach mocked Gemini and return 500 rather than being rejected; current guard rejects it. A test-only missing export failure also occurred and is not counted as behavioral RED evidence.
- `trail check` and `git diff --check` passed before the implementation commit. A final `trail check` is required after the report/evidence changes and before PR update.
- Isolated packaged app launched successfully without a separate Node runtime or dev server. Candidate Write workspace screenshot: [01-isolated-packaged-write.png](evidence/pcc-mac-final-recovery-002/01-isolated-packaged-write.png), SHA-256 `690a6657dd99fdcef33e20b1440e4190ae0977fdbc08c9525da3b725642dd164`.

## Package identity and limits

The candidate package built from source commit `3bcb477794520289a33c0e94e91c86e1578a2085` is located at:

- `release/mac-arm64/Proactive Co-Creator.app`
- `release/Proactive Co-Creator.dmg`

Rebuilt after report and evidence were prepared: `app.asar` SHA-256 `c01d8599fd4a1ac103fcc708ef8325b3bf758042e52c5064234164b7649a14dd`; DMG SHA-256 `910cf2c94f3acb058cc698b22da5f41026331e771ca1c0fe51e43bada71cb24b`. The source tree content represented by this build is the content to be committed with this report. The bundle is ad hoc signed, with no signing identity or TeamIdentifier; normal Gatekeeper approval/notarization was not established. `spctl` only accepted with security disabled override.

The bundle reports code-sign identifier `Electron`, ad hoc signature, and no TeamIdentifier. The real owner installation, credentials, Keychain, and manuscripts were not used or modified. The isolated GUI screenshot is limited to the visible Write workspace. Original eight audit screenshots are referenced as user-provided evidence and are not duplicated here.

## Scope and next qualification boundary

No architectural expansion, provider authorization changes, live inference, automatic fallback, deployment, installation replacement, or merge was performed. Before release or merge, complete and document isolated packaged GUI traversal of Plan and Review, D04 and NAV01 with synthetic data, and rebuild the bundle from the report-inclusive final commit. Treat the current branch and PR as a review candidate, not release sign-off.
