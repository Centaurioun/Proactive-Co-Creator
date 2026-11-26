# ChatGPT Subscription Resource Budget (SRB) — decision proposal

**Status: PCC-SRB-001 approved for story-only mock qualification; production/live inference remains disabled.** The Principal Architect rejected a blanket requirement for provider-exact input counting and provider-enforced output-token ceilings, and approved a bounded `story` pilot only. The revised decision accepts residual upstream resource risks for implementation and mock qualification, not for live provider use.

## Principal Architect decision: PCC-SRB-001

Implement and mock-qualify `story` only. It must be explicitly user-initiated, single-request, text-only, non-mutating and subject to author review. All other ChatGPT operations stay blocked. Inference remains disabled by default and unreachable through normal production admission until a separate activation decision. No live account request is authorized.

## Current authoritative operation limits

Values below are read from `server/aiBudget.ts` and `server/narrative/extractionService.ts` at the PR #18 base. They are the existing PCC Gemini/API budget policy, not evidence that SIWC enforces them. The narrative extraction service additionally rejects a single chunk above 8,000 input tokens and sets `maxOutputTokens` to at most 2,048 on the existing Gemini route.

| Operation | Local max input chars | Local max input tokens | Current output token cap | Calls / run | Aggregate token budget | Elapsed limit | Inference disposition for SIWC |
|---|---:|---:|---:|---:|---:|---:|---|
| analyze | 8,000 | 4,000 | 4,096 | 4 | 16,000 | 120 s | Blocked pending exact policy |
| clarify | 8,000 | 4,000 | 2,048 | 4 | 16,000 | 120 s | Blocked pending exact policy |
| polish | 8,000 | 4,000 | 4,096 | 4 | 16,000 | 120 s | Blocked pending exact policy |
| story | 8,000 | 4,000 | 8,192 | 2 | 20,000 | 120 s | Blocked pending exact policy |
| batch-edit | 16,000 | 6,000 | 4,096 | 4 | 24,000 | 120 s | Blocked pending exact policy |
| narrative-import | 32,000 | 12,000 policy ceiling; 8,000 per extraction segment | 4,096 policy reserve; Gemini request sets at most 2,048 | 12 | 120,000 | 240 s | Blocked pending exact policy |
| diagnostics | 40,000 | 14,000 | 4,096 | 6 | 60,000 | 180 s | Blocked pending exact policy |
| sync | 40,000 | 14,000 | 4,096 | 6 | 60,000 | 180 s | Blocked pending exact policy |
| writing | 24,000 | 9,000 | 3,072 | 8 | 48,000 | 180 s | Blocked pending exact policy |
| opportunities | 36,000 | 12,000 | 4,096 | 4 | 48,000 | 180 s | Blocked pending exact policy |
| import-enhance | 28,000 | 10,000 | 4,096 | 4 | 40,000 | 180 s | Blocked pending exact policy |
| image | 8,000 | 2,500 | 1,024 | 4 | 10,000 | 120 s | Unsupported; remains Gemini Managed only |

Existing call rate and concurrency ceilings remain those in `AI_OPERATION_POLICIES`; any SIWC-specific policy must define and enforce them independently. Do not mistake a browser-side button disable or a per-tab counter for a server-side aggregate limit.

## Approved SRB v1 story policy

| Control | Story pilot ceiling | Enforcement meaning |
|---|---:|---|
| Source text | 8,000 characters | Server-side hard limit; never truncate silently. |
| Estimated total input | 4,000 tokens | Conservative admission estimate, not provider-exact usage. |
| Complete serialized HTTP body | 32 KiB | Hard byte ceiling including model, instructions, input and options. |
| Accepted visible output | 16 KiB | Hard bound on text PCC accepts; reject partial/oversized output. |
| Total SSE stream | 256 KiB | Hard local transport byte ceiling. |
| SSE events | 4,096 | Hard event-count ceiling. |
| End-to-end deadline | 60 seconds | Local request deadline. |
| Concurrent SIWC inference | 1 per server process | Server-side shared admission lock. |
| Attempts per approved run | 1 | Attempt reserved before transport; failure/cancel/uncertain response consumes it. |
| New attempts per minute | Maximum 2, or any stricter existing limit | Process-wide sliding window; new task IDs do not reset it. |
| Automatic retries / continuation | 0 | A failed operation requires a fresh user action and a new reviewable plan. |
| Automatic provider/billing fallback | 0 | Never switch to OpenAI API or Gemini. |
| Reasoning | Default; omit explicit field | No capability or quota assumptions from an unverified setting. |

These are conservative architect-selected pilot limits, not benchmark-derived optima. All controls must be enforced server-side. Preserve stricter existing Gemini and OpenAI API policies; do not apply the story exception to those paths.

## Operation disposition

| PCC operation | ChatGPT SRB disposition |
|---|---|
| story | First pilot — approved for implementation and mocked qualification only |
| clarify | Second-stage candidate, not enabled |
| polish | Second-stage candidate, not enabled |
| writing | Structured-output qualification required, not enabled |
| analyze, batch-edit, diagnostics, sync, opportunities, import-enhance | HOLD |
| narrative-import | HOLD until Adaptive Context Engine qualification; no multi-chunk ChatGPT extraction/reconciliation/synthesis under story pilot |
| image | Unsupported; remain Gemini Managed only |

Story is selected because it is user-initiated, can remain one request, returns a non-canonical draft, and can be reviewed before any application. The approved admission lease must bind immutable task/source/model/account-grant-generation/policy identity and prevent new task IDs from resetting process-wide call, rate or concurrency limits. Cancellation invalidates result authority first; an abort-ignoring transport cannot regain authority. Failed, cancelled or ambiguous attempts remain charged.

## Residual risk requiring explicit acceptance

The Principal Architect accepts as a design limitation for the bounded story pilot that PCC cannot guarantee exact upstream input-token usage, output-token or hidden-reasoning consumption, immediate upstream stop on cancellation, or remaining ChatGPT subscription quota. A stream limit can stop local acceptance while upstream resources have already accrued. PCC may show provider-observed usage only when returned by a complete response; otherwise usage/quota is unknown. This architectural risk acceptance is not permission to use the Human Owner's subscription.

## Required evidence before any separate live activation decision

- Exact model/account slug, operation, grant generation and policy identity; model capability evidence stays separate from operation eligibility.
- Deterministic tests for every boundary, atomic reservation/concurrency, replay/new task IDs, abort-ignoring transport, stale grant, incomplete/failed/refusal/malformed streams and quota errors.
- Server-side proof that ordinary production admission remains disabled until a separate activation decision, with no browser-controlled/public bypass.
- Clear UI disclosure that local resource bounds do not cap upstream plan usage and interrupted requests may have consumed quota.
- No live requests during mock qualification. Separate explicit authorization is required before actual subscription consumption.

## Evidence reviewed

- OpenAI SIWC “Models and inference”: https://developers.openai.com/siwc/token-sharing-open-source/models-and-inference
- OpenAI SIWC “Preview limitations”: https://developers.openai.com/siwc/token-sharing-open-source/preview-limitations
- OpenAI Responses API reference: https://developers.openai.com/api/reference/resources/responses/methods/create
- PCC `server/aiBudget.ts`, `server/narrative/extractionService.ts`, `server/providers/policy.ts`, and `server/providerHubRoutes.ts`.

Decision source: Principal Architect response in the existing Brave conversation, recorded 2026-11-26 as `PCC-SRB-001 — REVISED APPROVAL — STORY-FIRST MOCK QUALIFICATION`. No live provider request, personal account action, or billing operation was performed.
