# TypeScript 7 modernization — 2026-11-24

## Status and base

This is a proposed stacked change based on dependency PR #3, currently based on the final dependency qualification commit `3c30befbc64088b9e3066d45ecf7350313ec4b07` (itself based on PR #3 head `e32fdb4457f2410b563395ec938828055c604b2b`). PR #3 remains open and draft. This TypeScript PR must target PR #3's branch until that PR is integrated, then be retargeted to `main` and requalified. No merge is authorized here.

PR: PENDING publication. Actions: PENDING. Local implementation checks are recorded below; remote Linux/macOS evidence is not yet available.

## Compatibility findings

- npm stable tags at investigation: `typescript@latest` = 7.0.2; `typescript@beta` = 7.1.0-beta; `typescript@next` is a development build. This change uses stable 7.0.2 only.
- Microsoft's [TypeScript 7.0 announcement](https://devblogs.microsoft.com/typescript/announcing-typescript-7-0/) describes a native Go compiler and explicitly says there is not yet a stable programmatic API for tools embedding TypeScript. The [TypeScript 6 announcement](https://devblogs.microsoft.com/typescript/announcing-typescript-6-0/) presents 6.0 as the transition release and retains the classic compiler/API.
- Current [typescript-eslint dependency policy](https://typescript-eslint.io/users/dependency-versions/) supports TypeScript `>=4.8.4 <6.1.0` and ESLint `^8.57.0 || ^9.0.0 || ^10.0.0`. Current parser documentation describes side-by-side classic TypeScript and a TypeScript 7.1 prerelease alias; that prerelease integration is not evidence of stable TypeScript 7.0 support.
- In this locked tree `typescript-eslint@8.74.0` resolves the classic compiler through the `typescript` package (`require('typescript').version` = 6.0.3). TypeScript 7.0.2 remains outside the documented parser support range.
- `@typescript/typescript6@6.0.2` is the compatibility wrapper; its `tsc6` command and `typescript` API resolve to classic TypeScript 6.0.3. The wrapper version is not the compiler version.
- The official `@typescript/native` alias caused strict npm peer resolution to reject stable 7.0.2 because the parser's optional native peer range admits TypeScript 7.1 prereleases, not 7.0.2. Rather than bypass peer checks, the native CLI is installed as the distinct alias `typescript7` (`npm:typescript@7.0.2`). Strict installation then succeeds.

## Architectures evaluated

| Option | Result |
|---|---|
| A. TypeScript 6 only | Supported and compatible with ESLint, but does not use the native compiler's measured performance. Kept as the lint/compiler-API compatibility check, not the primary check. |
| B. Native TypeScript 7 plus classic TypeScript 6 | Selected. Stable native CLI performs primary typecheck; TypeScript 6 provides the supported compiler API for typescript-eslint and an independent typecheck. Both run in CI. |
| C. Direct TypeScript 7 plus native-compatible lint tooling | Not selected. Stable 7.0.2 is outside the parser's supported stable range, and the parser's 7.1 integration is prerelease. No stable fully supported alternative was established. |

This follows the dual-compiler migration pattern while using a package alias npm can install without peer overrides. No `--force`, `--legacy-peer-deps`, unsupported parser configuration, ESLint removal, or rule suppression is used.

## Toolchain and configuration

Exact direct versions/aliases:

- `typescript7`: `npm:typescript@7.0.2` — native CLI.
- `typescript`: `npm:@typescript/typescript6@6.0.2` — classic wrapper; actual compiler/API 6.0.3.
- `typescript-eslint`: 8.74.0; ESLint 10.15.0.
- `@types/node`: 22.20.5, matching the retained Node 22 minimum policy from PR #3.

Scripts resolve explicitly and do not rely on whichever binary happens to win `PATH`:

- `npm run typecheck` → `npm run typecheck:native` → `./node_modules/typescript7/bin/tsc --noEmit`.
- `npm run typecheck:classic` → `./node_modules/typescript/bin/tsc6 --noEmit`.
- `npm run lint` remains `eslint .`; typescript-eslint uses the classic TypeScript 6 API.

Observed versions: native command reports `Version 7.0.2`; classic command reports `Version 6.0.3`; `require('typescript').version` reports `6.0.3`. `npm ls typescript7 typescript typescript-eslint --depth=2` confirms the installed aliases and parser path.

The only `tsconfig.json` adjustment is adding `vite/client` to the explicit `types` array beside `node`. Native TS7 otherwise flagged Vite's CSS side-effect import (`TS2882`); the Vite client declaration is the narrow ambient type required by this project. Both compilers pass the same project configuration with `strict: true`, `noEmit: true`, `moduleResolution: bundler`, existing ESM/JSX settings, paths alias and scope. No strictness relaxation, blanket `any`, new assertion, or broad exclusion was added. Existing Node native TypeScript execution and `tsx` test startup remain unchanged and passed locally.

## Benchmark method and results

Measured on this repository, not inferred from Microsoft benchmarks. Hardware/OS: Apple M5 Pro, 15 CPU cores, 24 GB RAM, macOS 27, arm64. Node 26.12.1, npm 11.20.0. Candidate dependencies were held constant; the baseline worktree used TypeScript 5.8.3 and the same project source/configuration (including `vite/client`). Each compiler checked 53 repository-authored TS/TSX files. `--listFilesOnly` counted 559 files for TS5 and 560 for TS6/TS7 (library declaration set differs by compiler). Strict compiler options were identical. Five process runs were measured with `/usr/bin/time -l`; caches were not dropped, so “cold” here means fresh process, not cold filesystem cache. Reported compiler and npm-script timings include their respective process startup; medians and population standard deviation are shown.

| Command | Five durations (ms) | Median (ms) | SD (ms) | Range (ms) | Median max RSS |
|---|---|---:|---:|---:|---:|
| TS 5.8.3 direct | 1072.2, 1063.0, 1065.0, 1059.9, 1068.5 | 1065.0 | 4.3 | 1059.9–1072.2 | 427.6 MiB |
| TS 6.0.3 direct | 1129.2, 1104.6, 1090.1, 1094.3, 1083.9 | 1094.3 | 15.9 | 1083.9–1129.2 | 431.0 MiB |
| TS 7.0.2 native direct | 194.7, 191.6, 191.0, 186.5, 190.2 | 191.0 | 2.6 | 186.5–194.7 | 262.5 MiB |
| TS 5.8.3 npm script | 1185.3, 1174.4, 1200.5, 1172.5, 1197.6 | 1185.3 | — | 1172.5–1200.5 | not measured |
| TS 6.0.3 npm script | 1206.0, 1232.8, 1198.0, 1205.7, 1225.2 | 1206.0 | — | 1198.0–1232.8 | not measured |
| TS 7.0.2 npm script | 301.1, 294.6, 295.6, 297.7, 308.9 | 297.7 | — | 294.6–308.9 | not measured |

Native TS7 direct median was 82.1% lower than TS5 (5.6× faster) and 82.5% lower than TS6 (5.7× faster). Its median max RSS was 38.6% lower than TS5. The npm-script medians include approximately 120 ms, 112 ms and 107 ms respectively beyond each direct invocation. These are small-project measurements and not a guarantee of CI wall-clock improvement.

The same ESLint 10.15.0 + typescript-eslint 8.74.0 path was measured five times for each compiler install: TS5 median 1514.0 ms (runs 1813.7, 1532.7, 1502.5, 1514.0, 1502.2); TS6 median 1525.8 ms (1803.3, 1570.0, 1517.1, 1525.8, 1519.0); TS7-install median 1594.3 ms (1887.7, 1566.2, 1594.3, 1534.4, 1746.1). ESLint uses TS6 in all three cases; variation is run noise, not a measured TS7 lint gain.

Production build (five runs, ms): TS5 448.6, 343.5, 344.7, 347.5, 345.6 (median 345.6); TS6 426.3, 345.5, 346.1, 349.6, 346.2 (median 346.2); TS7 install 457.7, 403.2, 366.2, 350.5, 348.2 (median 366.2). Build timing is noisy and dominated by Vite, not evidence of a build-speed improvement.

## Verification and security

Local checks on the TypeScript branch, after strict install:

- `npm ci --strict-peer-deps`: PASS.
- Native TS7.0.2 whole-project typecheck: PASS.
- Classic TS6.0.3 whole-project typecheck: PASS.
- Controlled temporary type error: both compilers exited nonzero and identified the type mismatch; fixture removed afterward.
- Compiler routing/version checks: PASS; ESLint with its supported classic compiler API: PASS.
- ESLint: PASS; Node tests: 106/106 PASS; production build: PASS.
- `npm audit` and `npm audit --omit=dev`: PASS, 0 vulnerabilities each.
- Earlier PR #3 base qualification provides Node 22.23.5/npm 10.9.9 and Node 26.x installation/runtime coverage plus Chromium E2E-A–I, 9/9 PASS, at [Actions run 45336184627](https://github.com/Centaurioun/Proactive-Co-Creator/actions/runs/45336184627). This is base evidence, not evidence for this TypeScript head.
- This PR's own Linux matrix and browser E2E: PENDING. macOS ARM64 is locally installed and benchmarked; a clean ARM64 `npm ci` was not separately repeated for this alias change. No paid Gemini requests were made.

The CI update uses `npm ci --strict-peer-deps`, prints both compiler versions and the classic API version, runs both typechecks, and retains lint, tests, build, Node 22/26 matrix, browser E2E and artifact diagnostics. Audit runs for full and production dependencies.

## Runtime and platform policy

The dependency PR retains Node `>=22.12.0` and uses `@types/node@22.20.5`; this branch inherits that policy. TypeScript 7 is a CLI typechecker only and does not replace Node, `tsx`, or the production server runtime. Local checks used Node 26.12.1; PR #3 remote CI separately qualified Node 22 and 26. This branch still needs its own remote Node 22/26 and Linux runs before acceptance. No claim is made that Google AI Studio's hosted Node runtime was tested.

## Remaining warnings, rollback and exit criteria

- Stable TS7.0 has no supported compiler API for typescript-eslint. Keep classic TS6 until stable parser support and a reproducible CI run demonstrate that ESLint no longer depends on that API.
- Native compiler and classic compiler can differ at edge cases; both must remain green during the migration period. A future stable parser native integration may alter the peer range; recheck package docs and npm peer resolution before removing TS6.
- The classic layer can be removed only after typescript-eslint officially supports the selected stable TypeScript 7 release, strict `npm ci` succeeds without optional-peer workarounds, the parser demonstrably loads the intended compiler API, native/classic parity review is complete, and Linux/macOS plus full CI pass on the new exact PR head.
- Rollback: revert this PR's single modernization commit (or retarget this branch to the prior PR #3 head), restoring TypeScript 5.8.3, its original lock entries and original `typecheck` script/config. Do not revert PR #3's independently qualified dependency/runtime changes.
- No application feature, data, storage, model semantics, schema or unrelated technical debt changes are included.

## Publication record

- TypeScript implementation commit: PENDING.
- PR URL and target: PENDING; must target dependency PR #3 branch while it remains unmerged.
- TypeScript PR Actions URL and final artifact SHA/URL: PENDING until remote CI runs for the exact final head.
- Dependency base PR: [PR #3](https://github.com/Centaurioun/Proactive-Co-Creator/pull/3).
- Dependency base Actions/artifact: [run 45336184627](https://github.com/Centaurioun/Proactive-Co-Creator/actions/runs/45336184627), [artifact 14894367074](https://github.com/Centaurioun/Proactive-Co-Creator/actions/runs/45336184627/artifacts/14894367074), SHA256 `d0700b06dc27bd75262dfc739654ac5881ea5e86c287bf77828f6e7f9780076a`.

## Six-cycle refinement record

1. **Discover:** inspect current remote base, package scripts, lock graph, ESLint and compiler config.
2. **Qualify:** verify stable tags, peer ranges and executable/API routing; reject the incompatible `@typescript/native` stable alias.
3. **Implement:** add explicit aliases/scripts and the narrow Vite ambient type required for CSS imports.
4. **Verify:** install strictly; run both compilers, controlled error, lint, tests, build and audits.
5. **Measure:** compare TS5/6/7 on the same 53 project files over five runs; record spread, memory and startup separately.
6. **Review:** keep CI gates and Node matrix, document stacked dependency, evidence boundaries and rollback; remote qualification remains pending.

The six-cycle review of PR #3 is recorded in `2026-11-24-dependency-latest-experiment.md`; this report's six-cycle review covers TypeScript modernization. The six labels document iterative review passes, not six independent formal approvals.
