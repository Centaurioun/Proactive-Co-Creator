# M3 — Vite 8 modernization

## Selected versions and compatibility

- Vite `8.3.8` (Rolldown/Oxc build pipeline).
- `@vitejs/plugin-react` `6.3.0`.
- Tailwind CSS and `@tailwindcss/vite` remain `4.3.5`; React/React DOM remain `19.3.1`.
- Node engine is now `^22.13.0 || >=24.0.0`. Vite and its React plugin require `^20.19.0 || >=22.12.0`; ESLint 10 requires `^22.13.0` in the Node 22 line, so 22.13 is the supported floor. Node 22 and 24 are preserved as supported LTS lines. The accepted manifest and README describe the same runtime range. Because Node 22.13 requires explicit opt-in for native TypeScript type stripping, production startup uses `node --experimental-strip-types server.ts`.

The direct Vite 8 migration was used rather than retaining a Vite 7 or `rolldown-vite` dependency. Official migration guidance offers `rolldown-vite` as a temporary diagnostic step for larger or more complex projects. The direct candidate builds and passes the required current regression suites; a permanent intermediary would add no value to the final dependency set. The migration was checked against both official boundaries: Vite 6→7 (Node engine floor and browser target change) and Vite 7→8 (Rolldown/Oxc, output API, and browser target changes).

Official references retrieved 2026-11-25:

- [Vite migration guide](https://vite.dev/guide/migration)
- [Vite server options](https://vite.dev/config/server-options)
- [Vite 8.3.8 release](https://github.com/vitejs/vite/releases/tag/v8.3.8)
- [Node release schedule](https://nodejs.org/en/about/previous-releases)

## Compatibility changes

- Vite configuration now uses `node:path` and `import.meta.dirname`, removing the legacy `__dirname` config-loader warning.
- Express middleware-mode development attaches the existing HTTP server through public `server.ws.server`, replacing deprecated `server.hmr.server`.
- `DISABLE_HMR=true` retains the documented `server.hmr: false` and `server.ws: false` behavior. The internal-client transform remains necessary: the served Vite 8 client still contains a connection path even when its server WebSocket is disabled. The transform matched and removed that call only in disabled mode.
- The React-refresh plugin, Tailwind Vite plugin, Express route isolation, SPA fallback, static production delivery, PDF worker asset path, and EPUB worker asset path retain their existing roles.
- No React, Tailwind, narrative schema, data authority, storage, or application architecture changes were made.

## Verification on the Vite 8 working candidate

- `npm ci`: exit 0; 292 packages added, 299 audited, 0 vulnerabilities. npm emitted only the install-script approval notice for `protobufjs` and `esbuild`; no dependency-resolution or peer warnings occurred.
- `npm ls --all`: exit 0, with no invalid dependency.
- `npm run typecheck`: exit 0 using native TypeScript 7.0.2.
- `npx --no-install tsc6 --noEmit`: exit 0 using TypeScript 6.0.3.
- `npm run lint`: exit 0.
- `npm test`: 302/302 pass after updating the existing exact Node engine assertion and README expectation.
- `npm run build`: exit 0 on Vite 8.3.8. The config-loader deprecation warning is gone. The existing large-chunk warning remains. Zod/Rollup annotation warnings disappeared with the new bundler; this is an observed tooling-output change, not a dependency workaround.
- `npm audit`: 0 vulnerabilities.
- Normal HMR in Chromium: the client connected to `ws://localhost:3482/…`; Vite reported `[vite] connected.` and the page had no JavaScript errors.
- Disabled HMR in Chromium: an isolated pre-navigation WebSocket observer recorded zero WebSocket constructions. Served `/@vite/client` contained the disabled-HMR replacement comment and omitted the original connect call. No page errors occurred.
- `scripts/stage0-audit-browser.sh`: all J01–J12 passed; page errors were 0. It deliberately blocks unmatched `/api/ai/capabilities` requests with HTTP 500 (and an unavailable route with 503), so the harness recorded expected browser network-console errors from those intercepted responses. No external/paid provider calls were enabled. The Stage0 responsive measurements found no horizontal overflow at the tested widths; pre-existing touch-target and light metadata contrast observations remain as recorded in the captured audit JSON.
- `scripts/e2e-browser-smoke.sh`: E2E A–I passed 9/9, no per-scenario page or console errors, and the test trap prevented paid AI calls.
- `scripts/e2e-narrative-workspace.sh`: passed.
- `scripts/qa/import-cancellation-browser.mjs`: passed on synthetic Turkish/Unicode content. It preserved the same project digest and workspace preference through staged cancellation and in-flight cancellation; the delayed response was rejected and no review candidates appeared.

These are M3 working-tree results captured before its commit. The Q06 runner records the current Git HEAD at launch, which predates the uncommitted Vite changes; final M5 must rerun on the exact committed candidate and supersede this preliminary provenance.

## Bundle comparison

Same arm64 host and app source; baseline Vite 6 output versus Vite 8 candidate output:

| Asset | Vite 6 baseline | Vite 8 candidate | Difference |
| --- | ---: | ---: | ---: |
| Main JavaScript | 1,010.79 kB / 286.38 kB gzip | 1,006.32 kB / 274.80 kB gzip | −4.47 kB / −11.58 kB gzip |
| PDF text parser | 448.20 kB / 131.39 kB gzip | 401.32 kB / 117.78 kB gzip | −46.88 kB / −13.61 kB gzip |
| PDF worker | 1,050.96 kB | 1,050.95 kB | −0.01 kB |
| CSS | 81.64 kB / 13.27 kB gzip | 82.00 kB / 13.32 kB gzip | +0.36 kB / +0.05 kB gzip |

The first Vite 8 build completed in 0.30 s during the compatibility check; this is a single run, not a performance comparison. M4 records repeatable warm-cache medians against the M0 baseline.

The captured browser evidence is in `evidence/m3-browser-preliminary/`. M5 will repeat the checks against the exact final commit and record exact-head provenance.
