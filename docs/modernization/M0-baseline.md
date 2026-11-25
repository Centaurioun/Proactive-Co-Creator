# PCC toolchain modernization — M0 baseline

Measured 2026-11-25 on accepted main `9bdeb9bc55d26924f26dbaa0e64a56cdc885dcfd` (tree `911a7b4c669bd28d3dfdb220bcdabaa2a150d89`). The baseline is reproduced in isolated worktree `codex/pcc-toolchain-modernization`; the Human Owner's original checkout was not modified.

## Environment and dependency identity

| Item | Observed value |
| --- | --- |
| Host | macOS 27.0.1, Darwin arm64, Apple M5 Pro, 15 CPUs, 24 GiB RAM |
| Node / npm | Node 26.12.1 / npm 11.20.0 |
| `package.json` SHA-256 | `30814e86281a24a54a9fc94c6fa54e8cd4c692e000181c8871ff8bd17dd5d813` |
| `package-lock.json` SHA-256 | `c4251fab91960963140919d504c8003a595cec2323be00ca765eac9e950c3298` |
| `npm ci` | Passed; 302 packages added; 309 audited; optional install scripts were not approved by npm in the interactive environment |
| Node engine in accepted manifest | `>=22.6.0` |

Exact resolved direct versions from the accepted lockfile and `npm ls --depth=0`:

| Package | Baseline |
| --- | --- |
| `typescript` | 5.8.3 |
| `typescript-eslint` | 8.72.2 |
| `vite` | 6.4.6 |
| `@vitejs/plugin-react` | 5.2.0 |
| `react` / `react-dom` | 19.3.1 |
| `tailwindcss` / `@tailwindcss/vite` | 4.3.5 |
| `tsx` | 4.23.15 |
| `eslint` | 10.15.0 |
| `pdfjs-dist` | 5.4.394 |

## Baseline commands and results

| Check | Result |
| --- | --- |
| `npm run typecheck` | Passed |
| `npm run lint` | Passed |
| `npm test` | Passed, 302/302 tests across 26 suites |
| `npm run build` | Passed |
| `npm audit --json` | 7 moderate, 0 low/high/critical; report captured separately |
| `npm audit --omit=dev --json` | 0 findings |
| Browser E2E A–I | Passed 9/9 on isolated worktree server at `http://localhost:3477`; no live provider traffic; console/page errors 0 |
| Stage0 browser | Passed J01–J12 (12/12), responsive/accessibility/performance phases completed on key-free production server (`configured:false`) |
| Q06 import cancellation | Passed on isolated browser session and port 4339; project digest and workspace preference preserved through staged and in-flight cancellation; provider calls were mocked |
| Stage0 synthetic graph benchmark | Passed; 10/30/100/250-entity fixtures |

The first E2E attempt against the default port 3000 hit a pre-existing server from another checkout and failed with three Vite `504 (Outdated Optimize Dep)` responses; it was not stopped or modified. Rerunning the same suite against this worktree's own server passed all A–I cases. This distinction is retained in the evidence; the initial failed attempt is not represented as a code regression.

Stage0 responsive measurements at 1440×900, 1280×800, 768×1024, 390×844 and 320×568 reported no horizontal document overflow and no clipped-right controls. Its separate touch-target scan reported four controls below 24 px and 72/27/23/23 controls below 44 px at desktop/laptop/tablet/mobile; these are baseline observations, not claims of WCAG certification. Its sampled light-theme 12 px metadata text measured 4.03:1 contrast against white (below 4.5:1); this is pre-existing and outside this toolchain modernization's design scope. Reduced-motion CSS support was detected.

Production-mode startup and HTTP health were exercised by Stage0. Development server startup was verified at port 3477. Health reported `configured:false`; E2E routes blocked non-capability API calls and reported zero paid-provider requests.

## Performance baseline

Seven measured warm-cache repetitions followed one untimed warm-up on the same machine. These are not cold-cache results.

| Metric | Repetitions | Median | Range |
| --- | ---: | ---: | ---: |
| `npm run typecheck` | 7 | 2.29 s | 2.25–2.37 s |
| `npm run build` | 7 | 1.47 s | 1.44–1.49 s |

Baseline production output (Vite 6):

| Asset | Raw size | Gzip |
| --- | ---: | ---: |
| Main JavaScript bundle | 1,010.79 kB | 286.38 kB |
| PDF worker | 1,050.96 kB | not recorded |
| PDF text parser chunk | 448.20 kB | 131.39 kB |
| CSS | 81.64 kB | 13.27 kB |

Existing large-chunk and Zod/Rollup annotation warnings are present in the baseline build.

## Baseline audit classification

The seven npm audit rows are a dependency cascade from one moderate advisory, GHSA-g3hv-75wg-m249 (CVE-2026-118764), affecting minimatch `>=7.0.0 <11.0.1`; installed vulnerable copy is minimatch 10.2.6 under `typescript-eslint@8.72.2` → `@typescript-eslint/typescript-estree@8.72.2`. The accepted lockfile marks this tooling subtree development-only. npm audit identifies fix availability; application reachability/exploitability is not established by that fact. The production-only audit is clean. The supported upstream route was checked after this capture: `typescript-eslint@8.74.0` resolves typescript-estree 8.74.0, whose registry metadata declares minimatch `^11.0.1` and TypeScript `<6.1.0` plus optional `@typescript/native` peer compatibility. This is a candidate for controlled M1 integration and still requires local resolution and full verification.

## Current stable compatibility evidence (retrieved 2026-11-25)

- Microsoft announced stable TypeScript 7.0 and documents side-by-side package aliases for native compiler and TypeScript 6 compatibility API: [TypeScript 7.0 announcement](https://devblogs.microsoft.com/typescript/announcing-typescript-7-0/).
- The installed `typescript-eslint@8.72.2` declares TypeScript `>=4.8.4 <6.1.0`. Current registry metadata for `typescript-eslint@8.74.0` keeps that classic API range and makes `@typescript/native` an optional peer for TS7 support.
- Registry metadata reports Vite 8.3.8 and `@vitejs/plugin-react` 6.3.0 as current stable candidates; the plugin peers with Vite 8 and requires Node `^20.19.0 || >=22.12.0`. Tailwind 4.3.5's Vite plugin peer range includes Vite 8. Vite's public server configuration documents `server.hmr` and `server.ws` controls: [Vite server options](https://vite.dev/config/server-options).
- Node's official release table reports Node 22 and 24 as LTS on this retrieval date: [Node.js releases](https://nodejs.org/en/about/previous-releases). Principal Architect additionally verified ESLint 10's Node 22 minimum at 22.13.0.

## Approved compatibility decision

Principal Architect decision `M0-M1-COMPATIBILITY-001`, status `APPROVED_WITH_AMENDMENTS`:

- Test TypeScript 7.0.2 as the actual primary `tsc` and TypeScript 6.0.3 API package through Microsoft's documented aliases; exercise both compilers and verify TSX, ESLint, editor, server and tests. The pre-authorized fallback is TypeScript 6.0.3 alone if the official dual arrangement fails.
- Test Vite 8.3.8 with `@vitejs/plugin-react` 6.3.0; preserve React 19 and Tailwind 4. Remove the internal HMR client string-transform only if normal HMR and disabled-HMR WebSocket behavior pass real-browser qualification.
- Preserve Node 22 and qualify Node 22 minimum 22.13, latest Node 22 patch, Node 24 LTS, and local Node 26.12.1. Provisional engine range is `^22.13.0 || >=24.0.0`, subject to all resolved dependencies.
- Prefer a supported upstream stable package update for minimatch. Only an in-range scoped override may proceed without consultation; no global or out-of-range major override.

## Six-Cycle and DMAIC checkpoint

1. Scope and inventory verified against exact accepted HEAD and lockfile.
2. Compiler, lint and Vite peer constraints measured from source, registry and installed graph.
3. 302 unit tests plus browser smoke and narrative workflows establish behavioral baseline.
4. Audit cascade, key-free browser routes and isolated worktree establish security/safety controls.
5. Repeatable warm-cache compiler/build medians and output sizes establish performance baseline.
6. Principal Architect decision, exact baseline identities and initial qualification evidence recorded before dependency edits.

DMAIC status: Define and Measure complete; Analyze complete for compatibility/risk framing; Improve and Control continue in M1–M5.
