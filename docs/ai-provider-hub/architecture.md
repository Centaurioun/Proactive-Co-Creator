# PCC Unified AI Provider Hub — Architecture and Capability Inventory

## Baseline and decision

- Base commit: `ac73723593f0474db799359f6695445f7ca8b97f`
- Base tree: `c043fa4fa823bfdb80eee0ee3ab4a55d6e7498ab`
- Principal Architect decision `P0-CHATGPT-ROUTE-001`: use official Sign in with ChatGPT OAuth and direct streaming Responses API; Codex App Server is excluded. ChatGPT plan inference is local-runtime only, uses user-granted `chatgpt.tokens.use.direct`, and must not be offered from an unsecured remote deployment.
- No provider credentials, live model discovery, or live inference are used by tests or implementation verification.

## Existing authority to preserve

`server/aiBudget.ts` defines per-operation input character/token ceilings, output budgets, timeout, concurrency, request-rate and aggregate call/token/time limits. `server/narrative/narrativeAiService.ts` performs provider token count preflight, bounded generation/retry, cancellation, and local schema parsing for narrative JSON operations. `server/narrative/extractionService.ts` additionally verifies evidence anchors and import scope. `server/aiService.ts` contains six legacy Gemini SDK operations (analyze, clarify, polish, batch edit, story, image). `services/apiClient.ts` sends all browser AI requests through the shared `postJson` helper, except the separate capability query.

## OpenAI API key connection

- `openai-api` is a separate, optional `openai-api-key` billing path. It is not selected by default and never becomes a fallback when Gemini or ChatGPT plan access fails.
- The key is accepted only through the loopback and same-origin provider-hub route, held in server memory, omitted from status/logging/browser persistence, and cleared by explicit removal or server restart. Saving it does not contact OpenAI.
- Explicit catalog refresh uses the official `GET https://api.openai.com/v1/models` account catalog. Only exact model slugs in the versioned capability registry receive text-operation or reasoning capability; other account-listed models remain visible with unknown operation support.
- Selecting a verified model is a separate user action. Inference uses `POST /v1/responses`, `store:false`, and `stream:true`, preserving existing server budgets, cancellation, output validation, and stale-result protections. API-key use is billed by the OpenAI API account, separately from ChatGPT plan usage. Image generation remains unsupported on this connection.
- Tests use synthetic API keys and mocked HTTP responses. No live catalog or inference request is part of qualification.

## ChatGPT disconnect decision

- `P7-CHATGPT-DISCONNECT-001` — APPROVED OPTION B by the Principal Architect. Local session credentials, pending OAuth/refresh/inference authority and model cache are invalidated before discovery or network waits.
- When the trusted issuer metadata provides an HTTPS revocation endpoint and a renewable refresh token plus issued client ID are available, PCC makes at most three bounded form-encoded revocation attempts, retrying only transient transport/timeouts and 5xx responses with exponential backoff. The temporary detached snapshot holds only the refresh token and generation and is erased afterward.
- A new session aborts an older revocation attempt; late refresh, OAuth callback, or inference results cannot restore or apply stale authorization. Local disconnection succeeds even when endpoint discovery or remote revocation cannot be confirmed.
- UI states distinguish acknowledged renewable-token revocation, unavailable endpoint, unconfirmed revocation, and already-disconnected. Acknowledgement does not mean the entire PCC app authorization was removed from the user's ChatGPT account; the user may remove that separately in ChatGPT Settings.
- No live credentials, account actions, or real revocation calls are used in qualification.

## Budget and capability corrections

- `openai-api` narrative operations call the official `/v1/responses/input_tokens` endpoint before generation and include the exact input and the same constrained-JSON instruction sent with the Responses request. Failure, malformed counts, or missing provider count blocks generation. OpenAI API generation also requires `max_output_tokens`; no ChatGPT-plan inference is sent to the API billing route.
- The SIWC profile does not expose an official token-count route. PCC marks the local estimate as an estimate and fails closed for narrative paths that require provider-authoritative preflight. Byte bounds remain transport safeguards and are not presented as token or spend limits.
- Gemini `models.countTokens` is provider-reported input counting, not a count of all generation settings or response schemas. Existing per-operation budgets and actual generation ceilings remain independent; no response-schema byte size is converted into a token/spend claim.
- Gemini capability data is exact model-slug account catalog data. `generateContent` establishes only text modality; workflow-specific structured operations and reasoning levels remain unknown without corresponding evidence. Gemini image availability in the provider catalog is distinct from a PCC-selectable image override: the current application route uses managed Gemini and does not support per-operation image overrides.
- A late catalog result is accepted only for the credential/session generation that requested it. Credential changes cancel active model-list and inference requests and stale results cannot repopulate caches or clear a newer session's cache.

All route schemas, operation budgets, output schemas, project/revision identities, AI Ticket Authority, stale-result gates, and explicit proposal acceptance remain authoritative. Provider choice is request metadata only and cannot mutate manuscript or canon data.

## Operation-to-provider capability matrix (planned supported surface)

| Operation | Managed Gemini | Personal Gemini | ChatGPT plan | OpenAI API |
|---|---|---|---|---|
| analyze, clarify, polish, batch-edit, story | Existing default preserved | Text-capable after key validation | Text/JSON only after local account authorization; operation budgets retained | Disabled by default; text/JSON only after explicit local configuration |
| narrative-import, diagnostics, sync, writing, opportunities, import-enhance | Existing default preserved | Text/JSON after key validation | Text/JSON with strict local schema validation and streaming completion | Disabled by default; text/JSON with strict validation |
| image | Existing managed Gemini image route | Not selectable through PCC image routing | Unsupported | Unsupported until separately qualified |

Discovery is connection-specific. A model listing is availability metadata, not proof of operation compatibility, quota, billing eligibility, or reasoning support. Unverified capability remains labelled unverified.

## Credential and host boundary

- Host-injected `GEMINI_API_KEY` remains the legacy default and is never overwritten by a personal key.
- User-entered Gemini/OpenAI keys and ChatGPT OAuth tokens stay in process memory for this web runtime; server restart clears them. This avoids insecure persistence in browser or plaintext files and is an explicit session-only limitation until an OS credential vault is available.
- Credential management and ChatGPT plan use are restricted to a loopback browser origin and loopback client, with exact Host/Origin checks and request limits. The existing externally hosted AI Studio path keeps its host-managed Gemini behavior and cannot manage personal credentials.
- No credentials are returned by status APIs, put in localStorage/IndexedDB, project records, exports, backups, URLs, logs, or browser bundles.
- ChatGPT HTTP inference always sends `store:false` and `stream:true`; only `response.completed` succeeds. Unsupported Responses fields, including `max_output_tokens`, are omitted. There is no automatic paid fallback.
- Provider usage is shown as observed only where returned; estimates and unknown quotas remain explicitly distinct.

## Integration boundary

Provider adapters sit under existing service validation and budgeting. A per-request immutable provider selection identifies connection, model, operation and reasoning configuration. Provider adapters map only documented capabilities. Model-unsupported operations fail closed. Gemini remains the fallback only when the user selected its managed connection or has not changed the default; failures never trigger a silent switch to another connection.

## Current verification

Accepted post-merge CI run `45685803398` completed successfully for Node 22.13.0, Node 22.x, Node 24.x and Chromium E2E A–I. Local clean `npm ci`, typecheck, lint, 302 unit tests, build, dependency inventory and npm audit were run on the accepted baseline before implementation. npm audit reported zero advisories. npm ci reported that the environment withheld two install scripts (protobufjs and esbuild); baseline verification nevertheless passed.

### Provider Hub candidate qualification (2026-11-26)

- `npm run typecheck`: passed on the implementation candidate.
- `npm run lint`: passed on the implementation candidate.
- `npm test`: 373/373 passed on the locally integrated correction candidate; `npm run typecheck`, `npm run lint`, and `npm run build` also passed. No live provider or account credentials were used.
- `npm run build`: passed with Vite 8.3.8. Output included a 1,027.46 kB main JS chunk and 1,050.95 kB PDF worker; the existing >500 kB chunk advisory remains.
- Isolated local browser: AI Settings rendered the OpenAI API key connection, separate billing disclosure, session-only storage disclosure, explicit catalog refresh and the unchanged Gemini Managed default. No key was entered and no provider request was issued.
- All provider requests, model discovery and revocation in automated tests use deterministic mocks. This is not live-account qualification.
- No GitHub hosted CI result is available until the reviewed local candidate is published as the authorized draft PR.

### Principal Architect corrections — local qualification

The correction candidate adds deterministic loopback HTTP tests for body-read timeouts, redirect rejection, per-credential generation invalidation, stale catalog rejection after reconnect, exact OpenAI API preflight for JSON constraints, Gemini generation-config preservation, and operation-aligned image capability reporting. Local qualification passed: 373/373 unit tests, typecheck, lint, production build, and `git diff --check`. The targeted Q06 import-cancellation browser scenario also passed against code commit `339da067c47c953be4c70612e8d60112a0a88c71` (tree `c816421948ae7f7944101ac3b741837251042dae`); deterministic API mocks only, provider not configured, baseline and final project digest equal. This is local qualification, not hosted CI. Hosted CI remains pending publication of the final evidence commit.
