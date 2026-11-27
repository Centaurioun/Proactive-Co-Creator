# Owner-reported issues D01–D05

## D01 — ChatGPT preference state becomes unavailable after settings reopen

**Reproduction:** Open AI Settings, refresh ChatGPT model catalog, inspect default model/reasoning and separate ChatGPT preferences; close and reopen settings.

**Expected:** Saved state remains selectable or a clearly actionable reason is shown without contradictory values.

**Observed:** Before close, default text model showed GPT-6 Luna and reasoning Medium. After reopening, default model/reasoning showed “Saved … unavailable”; separate ChatGPT preference continued showing GPT-6 Luna / Medium. Refreshing catalog had displayed 10 refreshed models. Screenshots: `D01-02-catalog-refresh-result.jpg`, `D01-04-preferences-before-reopen.jpg`, `D01-03-preferences-after-reopen.jpg`.

**Root cause, high confidence for renderer behavior:** In candidate source, `AiConnectionsPanel` refreshes `/status` on mount. `catalogPhasesForStatusRefresh` marks nonempty model lists stale unless a fresh phase is preserved. `ModelPreferencesSection` uses `isCatalogSelectable` to derive the default selector options; stale means no eligible active models, so it renders saved model/reasoning as unavailable. The separate ChatGPT preference UI reads its stored preference independently, explaining the contradictory display. The source and runtime behavior align. This does not establish preference loss or post-restart persistence.

**Source references:** `components/settings/AiConnectionsPanel.tsx` initialization/status refresh; `components/settings/ModelPreferencesSection.tsx` active default selection and ChatGPT preference sections; `lib/providerCatalogView.ts` `catalogPhasesForStatusRefresh` and `isCatalogSelectable`.

**Suggested repair:** Preserve a verified fresh catalog across a non-catalog `/status` refresh, or keep selections visible while explicitly marking catalog verification pending. Add reopen and relaunch tests proving state persistence and operation eligibility remain distinct.

## D02 — Review AI features report missing Gemini key

**Observed:** Review exposed local checks and AI diagnostics. Local checks worked. AI semantic consistency, manuscript-change analysis, and optional auto-analysis were disabled with `Server Gemini API key is not configured`; their buttons were not activated.

**Classification:** PARTIAL / unresolved expected restriction vs availability/UI defect. The live UI proves Gemini-key gating, not whether the approved product contract intends ChatGPT for these operations. No ChatGPT operation was sent.

**Required follow-up:** Trace each control through operation capability, preflight, route, and provider policy using mocks/no-network interception. Correct copy if the policy is intentionally Gemini-only; otherwise remove the legacy Gemini-only gate.

## D03 — Reanalyze Idea response and provider boundary

**Observed:** During broad UI exploration on a synthetic seed, Reanalyze Idea was clicked while it appeared unavailable. It entered “Analyzing story entities and relationships…” spinner. Escape stopped the local loading state. A transient external TLS socket appeared from the app process and later closed. No analysis result was displayed.

**Uncertainty:** The TLS destination, request body, upstream receipt, completion, and any usage/billing effect were not verified. Do not claim that a provider call completed or that no charge occurred. This action was inadvertently started by the auditor; it was not a deliberate authorization for Medium reasoning or an additional operation. No further AI action was taken.

**Source-level candidate mechanism:** Candidate `electron/main.mjs` enables `PCC_DESKTOP_MODE=1`; `server/providers/policy.ts` changes ChatGPT capability description in desktop mode; `server/routes.ts` computes `desktopChatGptFull` and skips provider operation/model assertions for ChatGPT desktop requests beyond the bounded Story route. This appears to widen server admission beyond the UI's “Luna / Default Story only” message. The candidate source-level bypass is confirmed by inspection; whether the installed app bundle contains this exact code and whether the observed socket carried this operation are unverified.

**Severity:** P1 candidate. P0 is not assigned because unauthorized billing or a completed provider transaction was not established.

**Follow-up:** Disable the unsafe action path until bounded operation admission is enforced; reproduce with a transport stub that rejects all external sockets and assert unsupported operation/model combinations are denied before transport.

## D04 — Original Story scrolling

Not qualified in this run. No long-seed, nested-scroll, resize, or computed-layout experiment was captured. No root cause claim.

## D05 — Writing Assistant unavailable

**Observed:** In the synthetic manuscript, Writing Assistant showed “unavailable because the server Gemini API key is not configured.” Manual writing and saving remained available. Modes were visible; Generate was disabled. No provider inference was attempted. `D05-01-writing-assistant.jpg`.

**Classification:** PARTIAL / unresolved. The exact Gemini-specific UI message is observed despite ChatGPT plan being connected. This could be an intentional operation restriction rendered misleadingly, or a stale legacy Gemini-only availability prop. Selection/caret interaction did not qualify.

**Follow-up:** Exercise every action with synthetic selected text under a mock adapter; verify expected capability and admission by provider and ensure Gemini-specific messaging matches policy.
