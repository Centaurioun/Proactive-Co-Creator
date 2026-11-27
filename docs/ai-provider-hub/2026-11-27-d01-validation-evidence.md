# D01 Preference Persistence Validation

**Date:** 2026-11-27  
**Scope:** Model and reasoning preference persistence across Settings reopen and an isolated Electron process restart.

## Environment and boundaries

- Ran the Electron development runtime with a separate temporary user-data profile.
- The owner completed ChatGPT sign-in and selected preferences inside PCC. No stored credential or token was opened, copied, saved, or included in these artifacts; no account identifier is recorded here.
- No AI inference was run. After restart, the model-catalog refresh was intercepted in Playwright and answered with a synthetic GPT-6 Luna descriptor; that refresh did not reach a provider.
- No packaged DMG rebuild, merge, or deployment was performed.

## Results

- Reopening AI Settings twice preserved the selected GPT-6 Luna and `medium` values.
- Refreshing connection status in the same process kept the verified catalog selectable.
- The effective Story route showed ChatGPT plan / GPT-6 Luna / `medium` as unavailable, with no provider fallback.
- After process restart, the connected account and saved selections returned. The catalog was stale and the model controls were disabled pending verification; the saved ChatGPT connection remained selected in the Default connection control.
- After the synthetic catalog refresh, model controls became selectable again and `medium` remained displayed.

## Regression evidence and checks

- **RED:** The new component regression test rendered only `Gemini managed` in Default connection when the saved default was ChatGPT plan and the restarted connection had an empty in-memory catalog.
- **GREEN:** After retaining the saved default connection in that selector, the regression test passed and the restarted UI displayed ChatGPT plan as selected while stale model controls remained disabled.
- Targeted provider preference/catalog tests: **46/46 passed**.
- `npm run typecheck`: passed.
- `npm run lint`: passed.
- `npm run build`: passed; Vite emitted its existing advisory that the main JavaScript chunk exceeds 500 kB.

The full test suite and packaged application restart were not run for this task.
