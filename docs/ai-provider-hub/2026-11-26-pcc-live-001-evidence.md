# PCC-LIVE-001 controlled story pilot evidence

This record preserves the single local qualification result. It contains no account credential, token, authorization code, or private manuscript material.

- Accepted source base: PR #18 HEAD `44cf2eeafeb5890b48260a0419065f79d7078020`, tree `d9ec5508e1a70c8d6e891c7083901460a09f901e`.
- Hosted CI for that accepted base: run `45778530622`, successful.
- Pilot: one user-authorized synthetic Turkish story request, model `gpt-6-luna`, reasoning `default`, ChatGPT plan billing through official SIWC Responses transport.
- Request safeguards: `store:false`, `stream:true`; no retry, continuation, API billing fallback, Gemini fallback, project mutation, or manuscript mutation.
- Provider result: terminal completion succeeded; elapsed time 7,638 ms; provider-observed usage 152 input tokens and 334 output tokens.
- Outcome: the request produced a complete story. The one-use activation was consumed and the local pilot server was stopped afterward.
- Scope limitation: this demonstrates one successful story request only. It does not qualify other models, non-default reasoning, other operations, or ongoing production inference.
- Code limitation: the temporary pilot implementation and OAuth compatibility corrections were uncommitted local changes at the time of the request and were not part of the accepted PR #18 tree. The OAuth correction is being isolated for review in the follow-up branch; temporary pilot UI code is not being promoted as normal product UX.

The request used a fixed synthetic story brief about a station attendant finding a blue compass that points to the last train. The generated story is intentionally not copied into this qualification record; the provider response contained no user manuscript or project content.

## PCC-LIVE-002 normal Story closeout

- The Human Owner explicitly authorized bounded, repeated, user-initiated local Story generation through their existing ChatGPT plan using `gpt-6-luna` with Default reasoning.
- The account OAuth connection completed; the owner selected ChatGPT plan / GPT-6 Luna / Default in the normal app preferences and initiated one normal **Generate Story** action in the sample project. This was not the temporary pilot screen.
- Result: completed Story output appeared in the application. Provider-observed usage was 158 input tokens and 257 output tokens. Provider quota status was unavailable; elapsed time was not captured.
- No retry or fallback occurred. The generated result was not adopted into the manuscript. The user-authorized request may have consumed subscription allowance or eligible credits.
- For local reproducibility, trusted activation startup now binds the development server to `127.0.0.1`; without activation, the previous host binding remains unchanged. The active server was already listening on loopback and was not restarted during closeout.
- Qualification remains limited to ChatGPT plan, `gpt-6-luna`, Default reasoning, Story only. Other models, reasoning levels, and ChatGPT operations remain disabled. Request/quota ledgers are process-local, and local cancellation cannot guarantee immediate upstream termination.
- Evidence is intentionally redacted: no story response, OAuth material, account identifiers, or private manuscript content is recorded here.
