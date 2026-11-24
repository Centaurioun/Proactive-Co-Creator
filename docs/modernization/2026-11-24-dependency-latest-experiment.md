# Dependency upgrade experiment — 2026-11-24

**Do not merge this diagnostic PR as-is.** This branch runs a real registry-resolution and verification experiment; it does not yet commit the generated dependency candidate. Local DNS denies npm and GitHub access; the runner resolves the npm latest dist-tag for every direct dependency except TypeScript, held at its locked 5.8.3. Exact manifest and generated lockfile are saved together as the resolved-dependency-candidate artifact. No hand-edited lockfile or peer dependency bypass. Latest @types/node is included as requested; Node 22 and 26 are tested, but newer Node type declarations cannot by themselves prove Node 22 runtime compatibility.

Baseline main: 3526c24fec45c60878937a331e487fc387e28d0b. Existing Stage 0 E2E-E focus race is known; Codex owns its correction separately. The experimental browser job runs the unchanged suite, so a repeat of that known baseline failure must not be attributed automatically to the upgrades. Existing CI on the draft PR checks the unmodified baseline dependencies; only the named experiment workflow checks the candidate. No paid AI calls; no secrets passed; no force or legacy-peer-deps; no automatic merge or push from CI.

If successful, retrieve the exact generated manifest and lockfile, commit them on the experiment branch, remove the temporary experiment workflow, and run ordinary PR CI against the exact committed candidate after the Stage 0 fix lands. Audit the Node types/runtime alignment, Vite dev middleware and DISABLE_HMR integration, dependency advisories, and browser behavior before considering integration. TypeScript 7/6 dual compiler is a separate experiment. No application source changes are included in this diagnostic commit.


## First experiment results — run 45330390844

- Registry resolution and artifact generation: PASS. The exact five upgrades were @google/genai 3.6.1, @types/node 26.6.6, @vitejs/plugin-react 6.3.0, typescript-eslint 8.74.0 and vite 8.3.8. All other direct packages remained at their prior locked versions, including TypeScript 5.8.3.
- Node 22.23.5/npm 10.9.9: strict install, typecheck, ESLint, 106/106 tests, production build, server import PASS. Install audit reported zero known vulnerabilities. Vite 8.3.8 output: 575.19 kB JS (158.20 kB gzip), 62.02 kB CSS, 284 ms reported build. Native config warning for __dirname and chunk-size warning remain.
- Node 26.13.1/npm 11.20.0: install FAIL, EUSAGE, missing cross-platform optional Tailwind Oxide/lightningcss/esbuild entries. Downstream failures were not application verification. Do not conclude runtime incompatibility.
- Candidate browser job: install omitted devDependencies because NODE_ENV=production was set at job level; build failed with vite not found (127), browser never launched.
- Baseline ordinary PR CI (45330408855) and independent CodeScene PR #2 CI (45328138604) passed; these do not verify the upgraded candidate.

### Controlled retry

Freeze the observed direct candidate versions, regenerate the lockfile in a fresh runner checkout with npm 11 (Node 26.13.1), explicitly include optional and development dependencies, scope NODE_ENV=production to server/browser execution, and skip downstream candidate checks if installation fails. Retest Node 22 and 26, then original E2E without weakening assertions. The newly resolved transitive tree can differ from the first run; compare results and audit before any merge. The production candidate still requires deliberate publication of the generated manifest and lockfile, and a normal PR check against the latest Stage 0 baseline. No product code or main modifications.
