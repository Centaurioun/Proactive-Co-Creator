# M4 — Build performance and CI compatibility

Date: 2026-11-25

## Scope

M4 records repeated compiler/build measurements on the same Apple Silicon host and updates the existing GitHub Actions workflow to current first-party action majors whose action manifests run on Node 24. It does not change application behavior, package manifests, dependency resolution, warning thresholds, or production dependencies.

## Compiler and build measurements

One untimed warm-up preceded seven measured warm-cache runs on Node 26.12.1 / npm 11.20.0. This is the same host and procedure used for M0; no cold-cache claim is made.

| Command | M0 Vite 6 / TS 5 baseline median | M3 Vite 8 / TS 7 median | M3 runs | Change |
| --- | ---: | ---: | --- | ---: |
| `npm run typecheck` | 2.29 s | 0.365 s | 0.380, 0.371, 0.368, 0.363, 0.365, 0.364, 0.363 s | −84.1% |
| `npm run build` | 1.47 s | 0.444 s | 0.444, 0.455, 0.446, 0.442, 0.441, 0.438, 0.479 s | −69.8% |

These are observed local timings. The baseline-to-candidate comparison changes compiler and bundler versions, so it does not isolate which change caused the improvement and it does not predict hosted CI duration.

## Output comparison

Build output sizes were collected from the M0 Vite 6 baseline and M3 Vite 8 candidate:

| Asset | M0 baseline | M3 candidate | Difference |
| --- | ---: | ---: | ---: |
| Main JavaScript | 1,010.79 kB / 286.38 kB gzip | 1,006.32 kB / 274.80 kB gzip | −4.47 kB / −11.58 kB gzip |
| PDF text parser | 448.20 kB / 131.39 kB gzip | 401.32 kB / 117.78 kB gzip | −46.88 kB / −13.61 kB gzip |
| PDF worker | 1,050.96 kB | 1,050.95 kB | −0.01 kB |
| CSS | 81.64 kB / 13.27 kB gzip | 82.00 kB / 13.32 kB gzip | +0.36 kB / +0.05 kB gzip |

The existing large-chunk warning remains; the migration did not increase the main bundle and reduced its gzip size. The PDF worker is a separately emitted asset and remains approximately 1.05 MB. No threshold was changed and no bundle-splitting refactor was justified by this bounded toolchain work. Vite 8 no longer emits the previous Zod/Rollup annotation warnings.

## GitHub Actions compatibility

The accepted workflow used `actions/checkout@v4`, `actions/setup-node@v4`, and `actions/upload-artifact@v4`. GitHub retired the Node 20 Actions runtime on 2026-09-23. The workflow now uses:

| Action | Workflow ref | Verified manifest | Purpose |
| --- | --- | --- | --- |
| `actions/checkout` | `@v7` | v7.0.1; `runs.using: node24` | Repository checkout |
| `actions/setup-node` | `@v7` | v7.1.0; `runs.using: node24` | Node installation and npm cache |
| `actions/upload-artifact` | `@v6` | v6.0.0; `runs.using: node24` | Browser evidence upload |

The versioned action manifests were fetched from the respective official `actions/*` repositories and returned HTTP 200. The v7.0.1 checkout manifest, v7.1.0 setup-node manifest, and v6.0.0 upload-artifact manifest all specify Node 24. GitHub's documented runtime retirement is recorded at [GitHub Actions Node 20 retirement](https://github.blog/changelog/2026-09-23-node-20-is-no-longer-available-in-github-actions/). The workflow remains on GitHub-hosted Ubuntu and uses no new service, credential, or deployment.

The `verify` job now tests both `22.x` and `24.x`. The separate browser job remains on Node `22.x`; both supported application runtime lines are covered by the unit/typecheck/build matrix, while the browser suite remains one bounded run. The application engine floor remains `^22.13.0 || >=24.0.0`.

Action release references: [checkout v7.0.1](https://github.com/actions/checkout/releases/tag/v7.0.1), [setup-node v7.1.0](https://github.com/actions/setup-node/releases/tag/v7.1.0), and [upload-artifact v6.0.0](https://github.com/actions/upload-artifact/releases/tag/v6.0.0).

## Dependency and integrity checks before M4 commit

- Resolved top-level toolchain: TypeScript 7.0.2 native compiler, TypeScript compatibility package 6.0.2 (its wrapper uses TypeScript API 6.0.3), Vite 8.3.8, React 19.3.1, Tailwind CSS 4.3.5, ESLint 10.15.0, typescript-eslint 8.74.0.
- `npm ls --depth=0`: exit 0; no invalid direct dependency.
- `npm audit --json`: 0 vulnerabilities across 393 dependency nodes (112 production, 270 development, 110 optional; npm's categories overlap).
- M3 manifest SHA-256: `package.json` `739ffd82e7d33c2f0ecc9dbe848eb43b804c77867b4e236c511421370d5e6f7a`; `package-lock.json` `5a4daec4528817f2388137a95e999ac4200d42c4a1d3fb32357006c4ca59b67f`. M4 changes neither file.
- Host measurement runtime: Node `v26.12.1`, npm `11.20.0`.

## M4 scope and remaining verification

This commit is a workflow and evidence change only. M5 must run the final complete local qualification on the exact integrated candidate, obtain hosted CI results for the exact PR head, and report Node 22/24 matrix outcomes. CodeScene comparison remains subject to the authorized existing integration and exact analyzed commit availability; no merge will be performed to obtain it.
