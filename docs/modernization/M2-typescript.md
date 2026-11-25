# M2 — TypeScript compiler modernization

## Decision record

Principal Architect decisions `M2-PACKAGE-IDENTITY-001` and `M2-NATIVE-ALIAS-002` authorize a dual-compiler arrangement:

- `@typescript/native-compiler7`: `npm:typescript@^7.0.2` — native `tsc` CLI.
- `typescript`: `npm:@typescript/typescript6@^6.0.2` — compatibility wrapper for tools that consume the classic TypeScript compiler API.
- The wrapper resolves `@typescript/old` to TypeScript API 6.0.3.
- `typescript-eslint` remains 8.74.0 and uses the classic API. Its experimental TypeScript 7 native-parser backend is not enabled.

The Microsoft-documented `@typescript/native` alias name was not retained. With that name, the installed `typescript-eslint` version declares an optional peer range that does not include stable TypeScript 7.0.2; npm emitted an override warning and `npm ls` reported the peer invalid. The approved custom alias avoids that peer relationship while leaving package and API validation active. Reconsider it when `typescript-eslint` supports a stable TypeScript 7 release through its native backend.

## Qualification evidence

Environment: macOS arm64; Node 26.12.1; npm 11.20.0. Existing supported-runtime verification remains required in M5.

- `npm ci`: exit 0; 301 packages added; 308 audited; 0 vulnerabilities. npm emitted its standard install-script approval notice for esbuild and protobufjs; no dependency-resolution or peer override warning occurred.
- `npm ls --all`: exit 0. Platform-specific and optional peers appear as unmet optional dependencies in this environment; no invalid dependency is reported.
- `npx --no-install tsc --version`: `Version 7.0.2`.
- `npx --no-install tsc6 --version`: `Version 6.0.3`.
- `node -p "require('typescript').version"`: `6.0.3`.
- `npm run typecheck`: exit 0 using the native TypeScript 7.0.2 `tsc` executable.
- `npx --no-install tsc6 --noEmit`: exit 0.
- `npm run lint`: exit 0.
- `npm test`: 302 passed, 0 failed, 26 suites.
- `npm run build`: exit 0. Existing Zod/Rollup annotation and large-chunk warnings remain; build still uses Vite 6 at this M2 checkpoint.

No strictness options, source coverage, lint rules, or assertions were weakened. Full clean-install qualification on supported Node 22 and Node 24 is part of M5.
