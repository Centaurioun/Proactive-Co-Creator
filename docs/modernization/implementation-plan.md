# Proactive Co-Creator — Actionable Implementation Plan

## Stage 1 — Baseline & Safety (Complete)
- Backup original codebase to `.backup-original/` (excluded via `.gitignore`).
- Audit all files, dependencies, models, and runtime behavior (`docs/modernization/audit.md`).

## Stage 2 & 3 — Dependencies, Tooling & Runtime Config
- **Task 3.1**: Update `package.json` with verified compatible versions:
  - Runtime: `@google/genai@^3.3.0`, `express@^5.3.0`, `zod@^4.6.7`
  - Dev: `tsx@^4.23.15`, `@types/express@^5.0.6`, `@types/react@^19.3.0`, `@types/react-dom@^19.3.0`, `tailwindcss@^4.3.5`, `@tailwindcss/vite@^4.3.5`, `eslint@^10.15.0`, `@eslint/js@^10.0.1`, `typescript-eslint@^8.72.2`, `eslint-plugin-react-hooks@^7.1.1`
  - Scripts: `"dev": "tsx server.ts"`, `"start": "node server.ts"`, `"build": "vite build"`, `"typecheck": "tsc --noEmit"`, `"lint": "eslint ."`, `"test": "tsx --test tests/*.test.ts"`
- **Task 3.2**: Update `vite.config.ts` (add `@tailwindcss/vite` plugin, remove client `env`/key leaks if any), `tsconfig.json` (`strict: true`), `eslint.config.js`, `.env.example`, and `metadata.json` (`MAJOR_CAPABILITY_SERVER_SIDE_GEMINI_API`).
- **Task 3.3**: Update `index.html` (remove CDN Tailwind + `esm.sh` importmap, restore accessible viewport scaling, add fonts & metadata) and `index.css` (`@import "tailwindcss";` + `@custom-variant dark`, animations respecting `prefers-reduced-motion`).
- **Verification**: `npm install`, `npm run typecheck`, `npm run build`.

## Stage 4 — Shared Schemas, Pure Logic & Server-Side Gemini Migration
- **Task 4.1**: Create `shared/types.ts`, `shared/schemas.ts`, and keep `types.ts` re-exporting for compatibility.
- **Task 4.2**: Extract pure, testable modules `lib/graphLayout.ts`, `lib/pendingUpdates.ts`, `lib/beliefGraphUtils.ts`.
- **Task 4.3**: Implement server modules:
  - `server/models.ts` (`gemini-4-hydrogen`, `gemini-3.1-flash-lite-image`, `gemini-omni-1.2-flash`)
  - `server/errors.ts` (typed error classification & safe messages)
  - `server/retry.ts` (bounded retries, jitter, `Retry-After` awareness, abort support)
  - `server/geminiClient.ts` (lazy server-only client with `'User-Agent': 'aistudio-build'`)
  - `server/aiService.ts` (validated belief graph, clarifications, refinement, bounded-concurrency 4-image generation, story generation, Interactions API video generation)
  - `server/routes.ts` and `server.ts` (Express + Vite middleware in dev, static `dist` in prod, `/api/health`, `/api/analyze`, `/api/clarify`, `/api/refine`, `/api/generate/images`, `/api/generate/story`, `/api/generate/video`)
- **Verification**: Unit tests via `tsx --test tests/*.test.ts` + server route integration tests with mocked service.

## Stage 5 & 6 — Frontend Refactoring, Accessibility & UI Polish
- **Task 5.1**: Create `services/apiClient.ts` with `AbortSignal` support and typed error handling (remove legacy `services/geminiService.ts` client SDK usage).
- **Task 5.2**: Refactor `App.tsx` to use `AbortController` per analysis/generation request, collision-safe `pendingUpdates` keys, clean error states, and safe modal/notification markup.
- **Task 5.3**: Extract `components/AttributeEditor.tsx`, `components/RelationshipEditor.tsx`, `components/InfoModal.tsx`, and update `components/BeliefGraph.tsx` (dark mode SVG contrast, keyboard navigation, focus rings, pure layout import).
- **Task 5.4**: Update `components/Header.tsx`, `components/PromptInput.tsx`, `components/ClarificationCard.tsx`, and `components/OutputGallery.tsx` (ARIA labels, non-pill selection buttons, copy feedback, partial image failure reporting, Blob URL revocation).
- **Verification**: `npm run typecheck`, `npm run lint`, `npm test`, `npm run build`.

## Stage 7 & 8 — Comprehensive Verification & Documentation
- Restart dev server (`restart_dev_server`) running `tsx server.ts` on port 3000.
- Verify running app in headless Chromium via `playwright-cli` (desktop 1440x900 + mobile 390x844, dark/light themes, keyboard/interactive controls, mocked/missing-key error handling, zero console errors).
- Update `README.md`, `docs/modernization/progress.md`, and `docs/modernization/verification-report.md`.
- Run final `compile_applet`, `lint_applet`, `npm test`, and secret-exposure scan.
