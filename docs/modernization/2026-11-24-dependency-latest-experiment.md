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

## Second experiment and Stage 0 integration

Run 45330987801 resolved a clean candidate. Both Node 22 and Node 26 passed strict installation, typecheck, lint, 106/106 tests, build and server import; npm install reported zero vulnerabilities. Candidate E2E and old dependency baseline E2E both failed at the known E2E-E race. The candidate is preserved exactly by artifact 14892410481, SHA256 package.json 83dd1100128eed3a8170d728d08074237c9bd7943e44a134f0042b253aa40fda and package-lock.json 729ead5ed6651b02eba5579acc38974cd7580c12320ca52a5ccd3c0ff02a1d09.

Owner authorized Stage 0 PR #4 and CodeScene audit PR #5 integration. New main 0b34d01fb0feb0e73655291f572e370fd95e0fe4. This merge commit incorporates their full tree, retaining only the experiment-specific workflow and report. The dedicated experiment now retrieves and checks the exact earlier candidate (no fresh transitive resolution), exports only these dependency files in deterministic chunks for publication through the connector, and runs the corrected Stage 0 browser suite including controlled artifact diagnostics. No token or credentials are exported. The normal PR CI still runs the original dependency tree until the candidate files are committed. Do not merge this diagnostic PR as-is. Retain TypeScript 5.8.3; TypeScript 7 is separate.

## Exact candidate publication

The original candidate ZIP was independently downloaded and integrity checked. Both restored files passed SHA-256 verification in run 45334406014. Git blobs were independently verified against the downloaded files: package.json 6f16f715bde4e610575a9fac76556d1ab9cdc30d; package-lock.json d4b303bc52fb484fb16a0b405bdcd54b71e44dd2. These exact files are now committed, not merely generated in CI. Temporary experiment workflow is removed from the proposed production tree; run 45334406014 continues testing the identical files on Node 22 and 26 and the corrected Stage 0 browser suite. Ordinary PR CI now tests the real committed candidate. At publication those tests and final main CI were pending. Do not merge before verification. Node 22 runtime passes prior tests, but @types/node 26 can expose APIs not available on Node 22; choose and document the supported runtime/type version policy before merging. No TypeScript upgrade or technical debt implementation is included.
