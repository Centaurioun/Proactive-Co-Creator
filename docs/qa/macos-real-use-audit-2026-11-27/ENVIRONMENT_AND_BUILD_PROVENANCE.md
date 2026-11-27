# Environment and build provenance

| Property | Observation |
|---|---|
| Installed path | `/Applications/Proactive Co-Creator.app` |
| Bundle ID | `com.centaurioun.proactive-co-creator` |
| App version / build | `0.0.0` / `0.0.0` |
| Runtime origin | `http://127.0.0.1:4319` |
| Host OS | macOS 27.0.1, build 26A434; Darwin 27.0.0 |
| Host architecture | arm64 (Apple Silicon) |
| Observed app process | PID 98994 during initial session inspection |
| app.asar SHA-256 | `b1d85c3ab2a05fcc84b56e3484a6dc1dec83e869789c11d9db93fa290e0f5000` |
| Source comparison candidate | `feat/macos-desktop-app`, `ba6ab324cb023d26f53381cbc0d253a43724c688` |

The installed app was tested in place; it was not rebuilt or reinstalled. The original dirty checkout was preserved. An isolated app instance was briefly used earlier on port 4320 and closed; this report's primary observations are from the installed app on port 4319.

**Provenance limitation:** The packaged renderer/server bundles were not proven byte-for-byte or symbol-for-symbol identical to the source candidate. The reported Electron framework/package version previously observed was 45.5.0, but bundled Node and Chromium versions were not reliably identified. The shell's Node v26.12.1 is host Node, not embedded Electron Node. Do not infer an exact source commit for the installed bundle.
