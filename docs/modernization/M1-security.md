# PCC dependency security — M1

Measured after `npm ci` on the accepted baseline, then remediated in isolated worktree `codex/pcc-toolchain-modernization`.

## Advisory inventory and disposition

The baseline reported seven moderate npm audit rows, all cascading from one advisory:

| Advisory | Affected package | Installed baseline | Affected range | Fixed version | Exposure | Result |
| --- | --- | --- | --- | --- | --- | --- |
| [GHSA-g3hv-75wg-m249](https://github.com/advisories/GHSA-g3hv-75wg-m249), CVE-2026-118764 | minimatch | 10.2.6 | `>=7.0.0 <11.0.1` | 11.0.1 | Development lint/compiler-tool chain: `typescript-eslint` → `@typescript-eslint/typescript-estree` → minimatch | Fixed through supported upstream release; no override |

npm repeated the advisory against `@typescript-eslint/typescript-estree`, `@typescript-eslint/parser`, `@typescript-eslint/type-utils`, `@typescript-eslint/utils`, `@typescript-eslint/eslint-plugin`, the `typescript-eslint` aggregate, and minimatch itself. These are seven audit rows, not seven distinct vulnerabilities. The vulnerable lock entries were development dependencies. The affected behavior is a denial-of-service risk from attacker-controlled minimatch patterns with globparts amplification. This inventory does not establish that PCC processes attacker-controlled patterns in the vulnerable way.

Baseline audit: 7 moderate, 0 low/high/critical; production-only audit: 0. Exact machine-readable reports are in `evidence/npm-audit-baseline.json` and `evidence/npm-audit-production-baseline.json`.

## Remediation

Updated only the direct lint/toolchain dependency `typescript-eslint` from `^8.72.2` to `^8.74.0`, the stable registry release available during this run. This is a supported upstream minor release, not a major-version override. Its pinned subpackages moved together to 8.74.0; the published `@typescript-eslint/typescript-estree@8.74.0` declares minimatch `^11.0.1`. npm resolved minimatch 11.0.8, deduplicated with ESLint's existing minimatch 11.0.8. No forced, legacy-peer, or override install was used.

The 8.74.0 registry metadata keeps the classic TypeScript peer range `>=4.8.4 <6.1.0` and advertises optional `@typescript/native` peer compatibility. TypeScript 7 alias support is separately qualified in M2; this M1 change alone continues to use the baseline TypeScript 5.8.3.

`npm install --save-dev 'typescript-eslint@^8.74.0'` regenerated the lock with npm 11.20.0. Besides updating the lint group, the lock normalization retained platform-specific optional package entries across supported operating systems/architectures and pruned unreachable stale package records. This produces a larger text diff than the actual functional dependency update; it must be reviewed for integrity and reproducibility during the Node 22/24 qualification.

## Verification

- Clean `npm ci`: passed; 298 packages installed, 305 audited; npm reported 0 vulnerabilities.
- `npm ls typescript-eslint @typescript-eslint/typescript-estree minimatch --all`: valid tree; typescript-eslint and all scoped packages at 8.74.0; minimatch 11.0.8 resolved and shared with ESLint; no vulnerable 10.x copy remains.
- `npm audit --json`: 0 total vulnerabilities. Full result: `evidence/npm-audit-after-m1.json`.
- `npm audit --omit=dev --json`: 0 total vulnerabilities. Full result: `evidence/npm-audit-production-after-m1.json`.
- `npm run typecheck`: passed on TypeScript 5.8.3 baseline compiler.
- `npm run lint`: passed on ESLint 10.15.0 and typescript-eslint 8.74.0.
- `npm test`: passed 302/302 tests across 26 suites.

The reviewable before/after package state and audit reports are committed separately from M2 and later toolchain changes. The audit does not establish zero runtime risk beyond the recorded npm report.
