# Security and data integrity review

## Data handling

- Synthetic project and synthetic manuscript text were used for interactive editing and Plan seed testing.
- The Archangel project was viewed during initial app identification but not edited, exported, uploaded, or used for AI generation.
- The isolated test profile/instance was closed. The installed app's synthetic project remains until an explicit safe cleanup step is performed; this package does not claim cleanup.
- Published screenshots in this directory are synthetic crops. No raw profile, database, token, cookie, API key, or authenticated request body is included.

## Provider boundary

During Plan exploration, a click on Reanalyze Idea unexpectedly started an analysis spinner. A transient external TLS socket was observed and then closed after Escape. Destination and application-layer traffic are unknown, so provider receipt and usage/billing cannot be ruled in or out. This is recorded as a possible scope-boundary violation; it was not repeated.

The source candidate has a desktop ChatGPT route condition that appears to bypass normal operation/model admission assertions. This warrants urgent review before enabling live AI operations in the packaged desktop app. No exploit or live follow-up operation was performed.

## Credential persistence (static source review only)

`electron/main.mjs` persists ChatGPT session tokens through Electron `safeStorage` when encryption is available, but falls back to UTF-8 plaintext serialization when `safeStorage.isEncryptionAvailable()` is false. The file mode is set to `0600`, which limits ordinary local access but does not encrypt the token. This is a confirmed source-level security weakness conditional on safeStorage being unavailable; actual runtime availability and owner token contents were not inspected. Never inspect or publish owner session files.

## Verdict and follow-up

No credential exposure was observed. Credential persistence is not fully qualified as secure due to the plaintext fallback. Before any live provider qualification, enforce fail-closed encrypted persistence or an explicit safe alternative, and prove server admission is bounded by operation, model, and reasoning. Confirm provider requests only through a test adapter or transport stub that cannot connect upstream.
