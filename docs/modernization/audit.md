# Proactive Co-Creator — Source Code Audit & Baseline

## 1. Application Purpose & Feature Inventory

Proactive Co-Creator is an interactive human-AI prompt co-creation studio that helps users iteratively refine prompts for **Image**, **Story**, and **Video** generation using:

1. **Prompt Input & Mode Selection** (`components/PromptInput.tsx`):
   - Editable prompt textarea with mode selector (`image` | `story` | `video`).
   - Two primary actions: **Analyze Prompt** (extracts belief graph & clarifications without generating media) and **Generate / Regenerate** (runs analysis if prompt/mode changed + generates output).
   - Optimization: skips re-running analysis when prompt and mode match the last analyzed state.
2. **Clarifications Workflow** (`components/ClarificationCard.tsx`):
   - Displays 3 targeted clarification questions with 3–5 predefined choices and a custom text input per question.
   - Supports **Refresh Questions** while excluding previously answered and skipped questions.
   - Tracks pending answers before applying them to the prompt.
3. **Interactive Belief Graph & Attributes Inspector** (`components/BeliefGraph.tsx`):
   - **Graph View**: Force-directed interactive SVG graph of explicit entities (solid border) and implicit entities (dashed border), directed relationship edges, pan/zoom/pinch/reset controls, hover/selection neighborhood highlighting, entity attribute inspector popover, and relationship label editor popover (with alternatives + custom label).
   - **Attributes View**: Dedicated panel for the scene-level entity (`The Image`, `The Video`, or `The Story`) attributes, including dropdown alternatives and custom value entry, plus entity `existence` (`Present` / `Absent`) toggles inside entity popovers.
4. **Combined Prompt Refinement** (`App.tsx` + `services/geminiService.ts`):
   - Batches pending clarification answers, attribute updates, and relationship updates into a single "Update Prompt" action.
   - Incorporates updates while preserving uncontradicted details, removes entities whose `existence` is set to `false` (`Absent`), marks previous outputs as outdated, and refreshes analysis.
5. **Multi-Modal Output Gallery** (`components/OutputGallery.tsx`):
   - **Image Mode**: Generates up to 4 images (`1:1`), shows loading/partial-failure placeholders, opens full-size modal preview, and supports image download.
   - **Story Mode**: Generates narrative text, renders paragraphs, and supports Copy to Clipboard and `.txt` Download.
   - **Video Mode**: Generates video, shows status progress, plays MP4 in `<video controls>`, and supports `.mp4` Download.
6. **Shell, Theme & Navigation** (`Header.tsx`, `App.tsx`):
   - Light/Dark mode toggle synced to `document.documentElement` (`dark` class) and `document.body`.
   - Info modal with feedback/research links.
   - Mobile bottom navigation bar switching between `Editor` and `Preview`.
   - Non-blocking mode-change notification preserving prior graph/clarifications for reference.

## 2. Baseline Verification (Original Codebase)

| Check | Status | Details |
|---|---|---|
| `npx tsc --noEmit` | PASS (with weak strictness) | Exited 0, but `tsconfig.json` lacks `"strict": true` and `App.tsx` uses `any`. |
| `npm run build` | PASS (with security/runtime flaws) | Built `dist/assets/index-BZAIPPuX.js` (841.49 kB); bundles `@google/genai` directly into client JS. |
| Client runtime boot | FAIL (broken without Vite `define`) | `services/geminiService.ts` throws `API_KEY environment variable not set` at module top-level when `process.env.API_KEY` is undefined in browser. |
| Automated tests (`test`) | NOT PRESENT | No test suite or `test` script in `package.json`. |
| Linter (`lint`) | NOT PRESENT | No ESLint config or `lint` script in `package.json`. |
| Dependency lockfile | PARTIAL / MISMATCH | `bun.lock` exists, no `package-lock.json`; `@types/react` and `@types/react-dom` absent from `package.json`. |

## 3. Critical Defects & Technical Debt Identified

### A. Security & Credentials
- **Client-side API key & SDK exposure**: `@google/genai` is imported in browser code (`services/geminiService.ts`), inflating bundle size (841 kB) and requiring client-exposed credentials.
- **Env var inconsistency**: Code reads `process.env.API_KEY`; `README.md` documents `GEMINI_API_KEY`.
- **Credential leak in Video URL**: `generateVideosFromPrompt` constructs `${videoUri}&key=${process.env.API_KEY}` in browser JS.
- **Legacy client key selection**: `App.tsx` calls `window.aistudio.hasSelectedApiKey()` and `window.aistudio.openSelectKey()`.

### B. Deprecated / Unsupported Models & SDK
- Installed `@google/genai` (`^1.29.0` / `1.52.0`) is below `>= 3.3.0` required for current Gemini 4 and Interactions API features.
- `gemini-2.5-flash` -> migrate to `gemini-4-hydrogen` (must not pass `temperature` to Gemini 4 models).
- `gemini-2.5-flash-image` -> migrate to `gemini-3.1-flash-lite-image`.
- `veo-3.1-fast-generate-preview` (`ai.models.generateVideos` / `getVideosOperation`) -> migrate to `gemini-omni-1.2-flash` via `ai.interactions.create` (`response_format: { type: 'video', ... }`).

### C. Frontend Dependency Loading & Styling
- `index.html` loads `https://cdn.tailwindcss.com` and an `esm.sh` `importmap` alongside Vite's npm bundle; `index.css` is empty.
- `index.html` disables pinch-to-zoom (`maximum-scale=1.0, user-scalable=no`).
- Inline `<style>` block inside `BeliefGraph.tsx`.

### D. Reliability, State & Race Conditions
- **No `AbortController` cancellation**: Mode switches and overlapping requests increment ref IDs but do not abort in-flight network/API calls.
- **Unvalidated AI JSON**: `JSON.parse()` on model output lacks runtime schema validation; malformed payloads throw unhandled exceptions or silently coerce invalid graphs.
- **Key collision bug**: `App.tsx` joins pending updates with `:` (`${entity}:${attribute}`) and splits with `key.split(':')`, corrupting names containing `:`.
- **Object URL leak**: Video `URL.createObjectURL(blob)` is never revoked when replaced or unmounted.
- **Partial image failures**: Image count failures are only surfaced via placeholder tiles without structured failure metadata; unbounded parallel calls (`Promise.all` up to 4 + retry pass).
- **Stale closure in `processRequest`**: `finally` checks `!isGenerating` state variable instead of ref/local flag.

### E. Component Architecture & Accessibility
- `BeliefGraph.tsx` (1,078 lines) couples force-directed layout physics, SVG edge intersection math, attribute editing, and relationship editing.
- SVG nodes and edges lack keyboard navigation (`tabIndex`, `role="button"`, `onKeyDown`, `aria-label`).
- Dark mode contrast defects in `BeliefGraph.tsx` SVG (`stroke="white"`, `fill="#ffffff"`, `fill="#2d3748"` hardcoded).
- Icon-only buttons in `Header.tsx` and `OutputGallery.tsx` rely on `title` without `aria-label`.
- `App.tsx` mode-change toast uses `border-l-4` and `ClarificationCard.tsx` uses pill-shaped `rounded-full` buttons.
