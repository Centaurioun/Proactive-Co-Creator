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
