# Proactive Co-Creator 2.0

An intelligent, interactive visual story-planning and prompt-refinement workspace powered by Gemini. **Proactive Co-Creator 2.0** transforms initial story and visual ideas into structured **Belief Graphs**, synchronized **Story Bibles**, batched **Decision Inboxes**, and natural-language **Batch Edits** before generating **Stories** or **Images**.

## Key Capabilities in 2.0

1. **Unified Three-Panel Creative Workspace**
   - **Left Panel — Decision Inbox & Natural-Language Batch Edit:** Review AI-generated clarifications and inferred attributes individually or in batches (`Select All`, `Accept Selected`, `Defer`, `Reject`), or type multi-entity natural-language instructions (e.g., *"Make all the animal guests elderly, but keep the cat young. The party should be mysterious rather than cheerful."*) with an interactive diff preview.
   - **Center Panel — Interactive Belief Graph 2.0 & Output Deck:** Explore entities and relationships with search, category filters (`character`, `location`, `object`, `event`, `group`), Focus Selected, Highlight Links, Inferred toggle, Group/Expand Guests, Excluded toggle, Fit to View, and a structured Table View toggle.
   - **Right Panel — Persistent Contextual Inspector, Story Bible, Consistency Checks & History:** Edit entity attributes, existence (`Present`/`Absent`), aliases, and relationships without covering the graph canvas; manage high-level Story Bible properties; review automated consistency checks; and restore named revisions or export/import projects.
   - **Bottom Bar — Transaction Undo/Redo & Explicit Generation:** Full multi-step Undo/Redo (`Ctrl/Cmd+Z`, `Ctrl/Cmd+Shift+Z`), one-click `Accept All Pending`, mode selector (`Story` default, `Image` secondary), and explicit user-triggered generation.
2. **Canonical Creative Data Model, Directed Multigraph & User Authority**
   - Stable internal IDs (`ent_*`, `attr_*`, `rel_*`, `dec_*`, `rev_*`), decision provenance (`prompt-explicit`, `user-edit`, `accepted-suggestion`, `ai-inferred`, `imported`), and approval statuses (`confirmed`, `pending`, `rejected`).
   - **Directed Multigraph Relationships:** Supports multiple distinct directed predicates between the same entities (`A → B` and `B → A`), curved parallel edge rendering, and a dedicated **Directed Relationship Inspector** (`⇄ Reverse Direction`, `Confirm`, `Reject`, `Delete Edge`, predicate editing).
   - **Strict Approval Gate & Seed Override Authority:** AI-inferred entities, attributes, Story Bible fields, and relationships enter as `pending` in the Decision Inbox and never enter the generation prompt until confirmed. Renaming or excluding a seed entity emits explicit `Seed Overrides & Canonical Identity` instructions.
3. **CAS Autosave, Coalesced Version History, Multi-Artifact History & Export/Import**
   - Automatic persistence in `localStorage` and `IndexedDB` (`schemaVersion: 3`) with monotonic `revision` Compare-And-Swap (`CAS`) conflict recovery, atomic full-project IndexedDB hydration reconciliation, dual-store deletion tombstones, automatic pre-migration backup (`proactive_co_creator_backup_v2`), and legacy v1 (`mode: 'video'`) migration to Story mode.
   - Coalesced undo/redo history (`40` undo stack steps, up to `80` stored project revisions) with monotonic revision increments on Undo/Redo, revision-guarded staged AI Narrative Polish review, Before/After change diff review modal, multi-artifact generation history per mode, and full project JSON / Story Bible Markdown (`.md`) / Refined Prompt export.

## Architecture & Security

- **Frontend:** React 19, TypeScript (strict mode), Vite 8, Tailwind CSS v4, custom SVG force-directed graph layout (`lib/graphLayout.ts`) with interactive pointer/wheel zoom and pan
- **Backend:** Express 5 (`server.ts`) mounting Vite in development and serving `dist/` in production, with configurable per-client rate limiting (`server/routes.ts`)
- **Runtime Requirement:** Node.js `>=22.12.0` (required by Vite 8 for development and native TypeScript execution in `npm start` via `node server.ts`)
- **AI Integration:** Server-side `@google/genai` SDK (`server/aiService.ts`) behind `/api/*` endpoints (`/api/analyze`, `/api/clarify`, `/api/refine`, `/api/batch-edit`, `/api/generate/story`, `/api/generate/images`) with Zod schema validation (`shared/schemas.ts`, max `8,000` compiled prompt characters) and bounded retry/backoff (`server/retry.ts`)
- **Models Configured (`server/models.ts`):**
  - Text, Belief Graph, Clarifications, Batch Edit Interpretation, Prompt Refinement & Story: `gemini-4-hydrogen`
  - Image Batch Generation (4 × 1:1 images): `gemini-3.1-flash-lite-image`

All Gemini API requests execute exclusively on the server using `process.env.GEMINI_API_KEY` (automatically loaded from `.env.local` or `.env` in local development when not already injected by the host environment). No API keys or AI SDKs are shipped to the browser.

## Local Setup & Scripts

```bash
npm install
cp .env.example .env.local # Set GEMINI_API_KEY=your_key (automatically loaded by server, or configure in AI Studio Settings > Secrets)
npm run dev                # Start Express + Vite workspace on http://localhost:3000
```

- `npm test` — Run all unit, schema, canonical state, multigraph, batch edit, CAS persistence, async isolation, and independent audit remediation tests (`tsx --test tests/*.test.ts`)
- `npm run typecheck` — Run strict TypeScript validation (`tsc --noEmit`)
- `npm run lint` — Run ESLint across client, server, shared, and test files
- `npm run build` — Compile production assets into `dist/`
- `npm start` — Run the production server (`node server.ts`, requires Node `>=22.12.0`)

