# Unified AI Provider Hub Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans to implement this plan task-by-task. Each task uses tests first and ends with focused verification.

**Goal:** Add local-first provider connections, model/reasoning selection and usage disclosure while preserving the existing Gemini behavior and all PCC narrative safety authorities.

**Architecture:** Add a server-owned provider registry and per-request immutable selection context beneath existing routes and operation schemas. Preserve managed Gemini as the default. Add session-only personal Gemini and ChatGPT OAuth credentials guarded by loopback Host/Origin checks. Use direct streamed Responses API for ChatGPT plan usage and reject unsupported modalities/parameters. Add concise AI Connections settings to the accepted Adaptive Draftroom.

**Tech Stack:** Existing Node/Express 5, TypeScript 7 native compiler, React 19, Zod 4, Google GenAI 3, browser localStorage only for non-secret preferences, Node process memory for temporary credentials.

**Spec:** `PCC — Unified AI Provider Hub & Subscription Integration` (Human Owner supplied directive); Architect decision `P0-CHATGPT-ROUTE-001`.

## Global Constraints

- Preserve the accepted main baseline and existing dependency/toolchain versions unless a narrowly justified new dependency is approved.
- No live provider call, user secret, real manuscript, OAuth login, or paid inference in qualification.
- Managed Gemini remains the existing default and keeps its schemas, operation limits, cancellation and image generation.
- ChatGPT uses official SIWC OAuth and direct Responses streaming; no Codex App Server, scraping, undocumented endpoint, Codex credential reuse, or silent billing fallback.
- Personal credentials are never persisted in browser/project data or plaintext files; memory-only credentials are cleared on process restart.
- No main merge or deployment; one consolidated draft PR.

## Review Focus

- Any attempt to call ChatGPT from a hosted/non-loopback deployment is rejected before credentials or provider requests are touched.
- Any ChatGPT stream without `response.completed`, oversized output, malformed JSON, or abort cannot yield an accepted result.
- Provider changes during an operation cannot bypass existing request ticket or stale-result rejection.
- Existing image requests continue to use only the selected Gemini connection.
- Account quota exhaustion and connection failure never change billing path automatically.

## File Responsibilities

- `server/providers/`: connection registry, normalized contracts, Gemini and ChatGPT adapters, provider selection context.
- `server/auth/chatgpt/`: OAuth state/PKCE/nonce, callback, token refresh/revocation, local session credential store.
- `server/routes.ts`, `server.ts`: local-only connection routes and request security boundary; existing AI route contract retained.
- `server/aiService.ts`, `server/narrative/*`: provider dispatch below existing validation/budget/ticket logic.
- `shared/` and `services/apiClient.ts`: validated non-secret provider preference and capability/status APIs.
- `components/settings/AiConnectionsPanel.tsx`, `App.tsx`: one settings surface with existing design-system primitives.
- `tests/provider*.test.ts`, `tests/chatgptOAuth.test.ts`: no-network adapter, auth, security and routing regression cases.
- `docs/ai-provider-hub/`: provider/operation matrix, protocol and qualification limits.

## Tasks

1. Record capability inventory and shared contracts; add failing tests for provider selection, no-fallback policy, and local-only routes; implement types and selection context.
2. Add managed/personal Gemini connection profiles and model discovery mapping without changing managed key semantics; add adapter and secret-redaction tests.
3. Add official ChatGPT SIWC OAuth/PKCE/callback, ID token verification, refresh and memory-only session lifecycle; test all flows with deterministic local transport mocks.
4. Add account-specific model discovery and streaming Responses adapter (`store:false`, `stream:true`, `response.completed`, bounded bytes/time/cancellation); strict local schema validation and unsupported operation rejection.
5. Route existing service operations through the selected provider beneath current budget/schema/ticket authorities; preserve Gemini image path and reject unsupported provider-operation combinations.
6. Add non-secret global and per-operation preferences and the concise AI Connections settings UI; include connection states, model/reasoning capability, usage unknown/observed labels and no-fallback disclosures.
7. Add optional OpenAI API key profile disabled by default; use the same explicit local credential and provider policy boundary.
8. Run full local qualification, relevant browser journeys and security checks; update exact-head documentation, open/update one draft PR, and stop before merge/deployment or personal live authorization.

## Execution

The Human Owner supplied an explicit autonomous implementation method and authorized routine implementation. The Principal Architect approved route A and authorized production-capable OAuth implementation and mocked qualification. No further routine owner gate is used. Personal account consent and any live inference remain separate authorization boundaries.

## Architect correction record — 2026-11-26

**P7-CHATGPT-DISCONNECT-001 — APPROVED OPTION B.** Use the issuer-discovered, HTTPS `revocation_endpoint` and revoke only the renewable local session using the form-encoded refresh token, `token_type_hint=refresh_token`, and the issued `client_id`. Local request authority is invalidated before network work; keep a minimum temporary snapshot only for bounded attempts and always discard it. Distinguish confirmed renewable-session revocation from unavailable endpoint, unconfirmed failure, and already-disconnected state. A successful token revocation does not mean the user's entire ChatGPT account authorization was removed. On unconfirmed remote revocation, finish local disconnect and direct the user to ChatGPT Settings. Preserve registration mapping and stable host ID; clear access, refresh and retained ID tokens. No real credentials or provider revocation request during qualification.

**PCC-PROVIDER-HUB-REVIEW-001 — bounded corrections PH-F01–PH-F04.** Apply transport bounds across OAuth discovery/token/JWKS/refresh/revocation including streamed body reads and redirect rejection; retain trust, PKCE, state, nonce, signature, scope and reconnect protections. Preserve provider-side exact-token-count authority and independent billing budgets; API key generation requires explicit provider `max_output_tokens`, while unsupported SIWC token-count preflight fails closed. Bind cancellation and result/cache acceptance to the credential/session generation. Keep model capability claims exact-slug, evidenced, and unknown where unsupported; preserve existing Gemini JSON schema, response MIME and thinking configuration; align image operation claims with the actual PCC route. Qualify with deterministic local mocks only.
