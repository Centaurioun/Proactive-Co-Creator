# Proactive Co-Creator — Consolidated Six-Cycle Modernization Design

## Six-Cycle Refinement Summary

1. **Cycle 1 (Scope & Preservation)**: Preserve all core workflows—Prompt Input (`image`/`story`/`video` modes, Analyze Only, Generate/Regenerate, skip-analysis optimization), Clarifications (3 questions, predefined + custom answers, Refresh excluding answered/skipped), Interactive Belief Graph & Attributes (explicit/implicit entities, `existence` Present/Absent toggle, attribute alternatives/custom, relationship label editing, pan/zoom/reset), Unified Prompt Refinement ("Update Prompt"), and Output Gallery (4-image grid + modal + download, story copy + download, video playback + download), plus Dark/Light mode and mobile Editor/Preview navigation.
2. **Cycle 2 (Technical Accuracy & Compatibility)**:
   - Upgrade `@google/genai` to `3.3.0` (`>= 2.32.0` / `>= 3.3.0`) on the server.
   - Keep `typescript` at `~5.8.3` because `typescript-eslint@8.72.2` requires `typescript < 6.1.0`; keep `vite` `^6.4.6` + `@vitejs/plugin-react` `^5.2.0` (stable, compatible with `@tailwindcss/vite@4.3.5`).
   - Add `express@5.3.0`, `@types/express@5.0.6`, `tsx@4.23.15`, `zod@4.6.7`, `tailwindcss@4.3.5`, `@tailwindcss/vite@4.3.5`, `@types/react@19.3.0`, `@types/react-dom@19.3.0`, and ESLint 10 tooling.
   - Ensure server-side relative imports use explicit `.ts` extensions and avoid TS `enum` syntax in server runtime files so `"start": "node --experimental-strip-types server.ts"` works cleanly with Node 22 native type-stripping as well as `tsx server.ts`.
3. **Cycle 3 (Architecture, Security & Reliability)**:
   - Introduce an Express backend (`server.ts`) mounting `vite.middlewares` in development and static `dist/` in production, keeping `GEMINI_API_KEY` and `@google/genai` strictly server-side (`User-Agent: 'aistudio-build'`).
   - Remove `window.aistudio` key-selection hooks and `process.env.API_KEY` browser references; return structured error codes (`MISSING_API_KEY`, `AUTH_ERROR`, `RATE_LIMITED`, `MODEL_UNSUPPORTED`, `SAFETY_BLOCKED`, `INVALID_RESPONSE`, `TIMEOUT`, `CANCELLED`, `INTERNAL_ERROR`) so the UI shows actionable messages without leaking credentials.
   - Migrate models via centralized `server/models.ts`:
     - Text analysis, clarifications, refinement, story: `gemini-4-hydrogen` (no `temperature`/`topP`/`topK` parameters).
     - Image generation: `gemini-3.1-flash-lite-image` (`ai.models.generateContent`, concurrency-limited to max 2 concurrent requests, returning `{ images, failures, warning }`).
     - Video generation: `gemini-omni-1.2-flash` (`ai.interactions.create` with `response_format: { type: 'video', aspect_ratio: '16:9', resolution: '720p' }`, returning video bytes/base64 or server-streamed temp video URL without any API key in URLs).
   - Validate all AI JSON outputs and incoming API payloads with Zod schemas (`shared/schemas.ts`).
   - Use `AbortController` across client requests and bounded exponential-backoff retry with jitter (`server/retry.ts`) on server Gemini calls.
4. **Cycle 4 (Feature Preservation & UX)**:
   - Replace CDN Tailwind + `esm.sh` importmap in `index.html` with Vite-bundled Tailwind CSS v4 (`@import "tailwindcss";` + `@custom-variant dark (&:where(.dark, .dark *));` in `index.css`).
   - Restore pinch-zoom accessibility in `index.html` viewport meta tag; sync title/description/OG tags with `metadata.json`.
   - Fix dark mode SVG contrast in `BeliefGraph.tsx`, add keyboard navigation to graph nodes/edges, add `aria-label` to icon buttons, add copy feedback in `OutputGallery.tsx`, and revoke Blob URLs cleanly.
   - Replace `:` string concatenation keys for pending updates with collision-safe encoded keys (`encodePairKey` / `decodePairKey`).
5. **Cycle 5 (Execution Feasibility & Testability)**:
   - Extract pure domain logic (`lib/graphLayout.ts`, `lib/pendingUpdates.ts`, `lib/beliefGraphUtils.ts`, `shared/schemas.ts`, `server/retry.ts`, `server/errors.ts`) so `node:test` + `tsx --test` verifies core graph physics, key encoding, schema validation, retry/backoff, and error classification deterministically in milliseconds.
   - Provide an API client layer (`services/apiClient.ts`) supporting `AbortSignal` and clean typed responses.
6. **Cycle 6 (Adversarial Review)**:
   - Verified no credentials reach client bundle (`vite build` + grep check).
   - Verified bounded concurrency prevents 4x-retry amplification storms on image generation.
   - Verified mode switches and overlapping requests cancel older `AbortController` instances and ignore stale resolutions.
   - Verified video URLs never embed API keys and object URLs are revoked on change/unmount.
   - Verified `metadata.json` includes `"MAJOR_CAPABILITY_SERVER_SIDE_GEMINI_API"` while preserving app name/description.

## Target Directory Architecture

```text
server.ts                     # Express + Vite middleware / static server entry point
server/
  models.ts                   # Centralized Gemini model configuration
  geminiClient.ts             # Shared server-side GoogleGenAI instance (User-Agent: aistudio-build)
  errors.ts                   # Structured error classification & HTTP status mapping
  retry.ts                    # Bounded exponential backoff with jitter + abort support
  aiService.ts                # Server-side Gemini workflows (graph, clarify, refine, image, story, video)
  routes.ts                   # Express /api/* routes with Zod input validation
shared/
  types.ts                    # Shared domain types (BeliefState, Clarification, GraphUpdate, API contracts)
  schemas.ts                  # Zod runtime schemas for API requests & AI JSON outputs
lib/
  graphLayout.ts              # Pure force-directed layout & edge intersection geometry
  pendingUpdates.ts           # Collision-safe pending update key encoding & GraphUpdate builder
  beliefGraphUtils.ts         # Canonical entity matching & relationship deduplication
services/
  apiClient.ts                # Browser fetch client with AbortSignal & typed error handling
components/
  Header.tsx
  PromptInput.tsx
  ClarificationCard.tsx
  BeliefGraph.tsx
  AttributeEditor.tsx
  RelationshipEditor.tsx
  OutputGallery.tsx
  InfoModal.tsx
tests/
  schemas.test.ts
  pendingUpdates.test.ts
  graphLayout.test.ts
  retryAndErrors.test.ts
  routes.test.ts
```
