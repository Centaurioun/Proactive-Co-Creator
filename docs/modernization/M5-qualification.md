# M5 — Final modernization qualification record

Date: 2026-11-25

## Candidate and environment

Local M5 qualification was run against the integrated modernization source candidate `4f70e0af1705c3f22593fae35c2e528e79019742` (tree `e005e77dcae5e5a31f227c476e4b2b4bdf68f1e3`) on Node `v24.22.1` / npm `11.19.1`, macOS arm64. This host does not have Node 22 installed; Node 22 is included in the hosted CI matrix. The separately measured warm-cache compiler/build comparison was collected on the same Node 26.12.1 host as M0 and is recorded in `M4-build-ci.md`.

The app reported `/api/health` `configured:false`. Browser routes blocked non-capability API calls; the import cancellation test used its deterministic local mocks. No real manuscript, provider key, paid API call, or production service was used.

## Automated qualification

All listed commands completed with exit code 0 against the candidate above:

| Check | Result |
| --- | --- |
| Clean `npm ci` | PASS; 292 packages installed, 299 audited, 0 vulnerabilities |
| `npm ls --all` | PASS; exit 0; only platform-optional dependencies were absent as expected |
| `npm run typecheck` | PASS; `node_modules/.bin/tsc` resolves to `@typescript/native-compiler7`, version 7.0.2 |
| `node_modules/.bin/tsc6 --noEmit` | PASS; compatibility CLI reports TypeScript 6.0.3; its package alias is `@typescript/typescript6` 6.0.2 |
| `npm run lint` | PASS |
| `npm test` | PASS; 302 tests, 26 suites, 0 failed, 0 skipped |
| `npm run build` | PASS; Vite 8.3.8; main JS 1,006.32 kB / 274.80 kB gzip, PDF text parser 401.32 kB / 117.78 kB gzip, PDF worker 1,050.95 kB, CSS 82.00 kB / 13.32 kB gzip |
| `npm audit` and `npm audit --omit=dev` | PASS; 0 vulnerabilities in both reports |
| Stage0 J01–J12 | PASS; 12/12 journeys |
| Browser E2E A–I | PASS; 9/9 named scenarios; no paid API route hits, page errors or scenario console errors |
| Narrative Workspace browser scenario | PASS |
| Q06 import cancellation | PASS; manuscript digest and workspace preference unchanged; cancellation signal observed; delayed response rejected |

The M5 build retains Vite's existing >500 kB chunk warning. No warning threshold was changed. `npm ci` emits npm 11 install-script approval notices for `protobufjs` and `esbuild`; installation, typecheck, tests, and build all completed successfully.

The historical QA harness writes a small set of tracked screenshots and Q06 results under `docs/qa/evidence`. Candidate screenshots/results were copied to `evidence/m5-stage0`, `evidence/m5-browser`, and `evidence/m5-q06`; the tracked historical files were restored byte-for-byte from the pre-test candidate. No historical QA artifact change is included in this modernization.

## Runtime, HMR and asset checks

- Node 24 local qualification: `v24.22.1`, npm `11.19.1`.
- Node 26 performance measurement: `v26.12.1`, npm `11.20.0`.
- Node 22 was not available locally. CI's verify matrix now includes `22.x` and `24.x`; hosted exact-head result remains required before acceptance.
- Development mode with normal HMR: browser opened the app and observed a Vite WebSocket connection at `ws://127.0.0.1:3510/?token=…`.
- Development mode with `DISABLE_HMR=true`: browser opened the app and observed zero WebSocket constructions. The custom Vite client transform remains because this behavior was verified with Vite 8.3.8.
- Production server: actual Chromium import of a synthetic 611-byte PDF succeeded. It rendered `PCC synthetic PDF worker smoke test.` as extracted text and loaded `/assets/pdf.worker.min-Cpi8b8z3.mjs` (1,051,259 transferred bytes). Screenshot: `evidence/m5-stage0/pdf-worker-import-preview.png`.
- Browser smoke responsive widths 1440, 1280, 768, 390 and 320 CSS px all had no horizontal overflow or right-clipped controls. 200% zoom-equivalent 720×450 also had no overflow.

## Preserved behavioral guarantees exercised

The regression evidence exercises persistent project and manuscript flows, semantic J10 invariance, Undo/Redo, workspace preference restoration, stale proposal protections, synthetic import cancellation, backup/recovery paths, Turkish and Unicode content, dark/light themes, responsive navigation, and key-free AI-unavailable behavior. The full suite retains its existing 302 assertions; no test coverage was removed or strictness reduced.

Q01–Q05 are accepted baseline QA packages, with their existing screenshots retained unchanged. No standalone Q01–Q05 browser runner exists in the current `scripts/qa` directory; relevant automated safety regressions were run through the full unit suite, Stage0, E2E and Narrative Workspace scenario. Q06 has a dedicated exact-candidate browser scenario and is attached under `evidence/m5-q06`.

## Accessibility and visual limitations

The toolchain update did not modify the accepted Adaptive Draftroom UI. Stage0 observed no overflow at any tested viewport and detected reduced-motion CSS support. It also found 4 visible controls below 24×24 px; 23 mobile controls were below 44×44 px. One sampled light-theme 12 px metadata/helper text contrast ratio was 4.03:1 against white, below 4.5:1; the sampled dark-theme pairs passed. These are inherited UI observations and remain a deferred design backlog. No screen-reader evaluation or full WCAG 2.2 AA certification is claimed.

## Security assessment

The M0 audit's seven moderate rows were a single advisory cascade: GHSA-g3hv-75wg-m249 / CVE-2026-118764 in minimatch 10.2.6 through the development-only typescript-eslint tree. Updating `typescript-eslint` from 8.72.2 to 8.74.0 resolves minimatch 11.0.8, outside the affected range. Final full and production-only npm audits both report zero advisories. The prior dev-only dependency location did not alone establish harmlessness; this supported upstream fix was applied. npm audit is a snapshot of registry advisory data at qualification time and does not certify absence of unknown vulnerabilities.

## Compatibility and remaining acceptance evidence

The accepted Node engine is `^22.13.0 || >=24.0.0`; React 19 and Tailwind 4 remain unchanged. Vite 8.3.8 and `@vitejs/plugin-react` 6.3.0 are stable releases with verified peer compatibility. The TypeScript native compiler/compatibility package division is confirmed by the actual executable symlinks and version output, not inferred from the dependency declarations.

The final CI run must be attached to the exact final PR head and show the Node 22 and 24 verification matrix plus browser job. A candidate-specific CodeScene comparison could not be produced because no CodeScene connector/tool is available in this environment; the exact commit identity of the previously opened hosted analysis remains unverified. No merge or deployment is authorized by this record.

Evidence files in this directory are synthetic QA artifacts. The consolidated pull request body records exact final base, head, tree and hosted CI status after publication.
