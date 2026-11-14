# Proactive Co-Creator

An interactive, multi-modal creative co-pilot powered by Gemini. The application helps users transform brief ideas into rich **Images**, **Stories**, and **Videos** by extracting an inspectable **Belief Graph** of entities, attributes, and relationships alongside targeted **Clarifications** that refine the prompt before and between generations.

## Architecture & Security

- **Frontend:** React 19, TypeScript (strict mode), Vite 6, Tailwind CSS v4
- **Backend:** Express 5 (`server.ts`) mounting Vite in development and serving the compiled `dist/` bundle in production
- **AI Integration:** Server-side `@google/genai` SDK (`server/aiService.ts`) behind `/api/*` endpoints with Zod schema validation (`shared/schemas.ts`), bounded exponential retry/backoff (`server/retry.ts`), request cancellation (`AbortController`), and in-memory MP4 media streaming (`server/videoStore.ts`)
- **Models Configured (`server/models.ts`):**
  - Text, Belief Graph, Clarifications, Prompt Refinement & Story: `gemini-4-hydrogen`
  - Image Batch Generation (4 × 1:1 images): `gemini-3.1-flash-lite-image`
  - Asynchronous Video Generation (16:9, 720p, 10s via Interactions API): `gemini-omni-1.2-flash`

All Gemini API requests execute exclusively on the server using `process.env.GEMINI_API_KEY`. No API keys or AI SDKs are shipped to the browser.

## Prerequisites

- **Node.js 22+** (`node -v` >= 22.0.0, supporting native TypeScript execution for `npm start`)
- A Gemini API key configured on the server as `GEMINI_API_KEY`

## Local Setup

1. Install dependencies:
   ```bash
   npm install
   ```
2. Configure environment variables (copy `.env.example` to `.env.local` or export `GEMINI_API_KEY` in your shell / AI Studio **Settings > Secrets**):
   ```bash
   cp .env.example .env.local
   # Set GEMINI_API_KEY=your_server_side_key
   ```
3. Start the development server (runs Express + Vite on port `3000`):
   ```bash
   npm run dev
   ```
   *(If using `.env.local` locally outside AI Studio, run with `NODE_OPTIONS="--env-file=.env.local" npm run dev` or export `GEMINI_API_KEY` in your shell.)*

## Available Scripts

- `npm run dev` — Start Express + Vite dev server (`tsx server.ts`) on port `3000`
- `npm run build` — Build optimized client assets into `dist/`
- `npm start` — Run the production Express server (`node server.ts`) serving `dist/` and `/api/*`
- `npm run typecheck` — Run strict TypeScript checking (`tsc --noEmit`)
- `npm run lint` — Run ESLint across the codebase
- `npm test` — Run unit and integration test suites (`tsx --test tests/*.test.ts`)

## Documentation

Modernization audit, target architecture, implementation plan, progress, and verification artifacts live under `docs/modernization/`.
