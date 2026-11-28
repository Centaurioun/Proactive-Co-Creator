# PCC — Independent Product Discovery & Evolution Research (`PCC-RESEARCH-01`)

**Assignment ID:** `PCC-RESEARCH-01`  
**Status:** Complete — Documentation-Only Research (No Implementation Authorized or Performed)  
**Research Date:** `2026-11-28`  
**Governing Brief:** [`RESEARCH-ASSIGNMENT.md`](./RESEARCH-ASSIGNMENT.md) *(preserved completely unchanged)*

---

## 1. Executive Synthesis

**Proactive Co-Creator (PCC)** possesses two genuinely rare creative assets that almost no mainstream writing tool combines: an **inspectable visual Belief Graph** that exposes AI assumptions before they harden into prose, and a **rigorous epistemic canon architecture** (`explicit`, `interpretation`, `belief`, `reported`, `ambiguous`, `user-authored`) that protects authorial control and preserves immutable imported sources.

Yet direct inspection of the live running application (`http://localhost:3000`) and its source tree reveals a central paradox: **PCC currently operates as two separate products welded together behind a high-friction, engineering-heavy interface.** Era 1/2's *Seed-to-Prompt Belief Graph Studio* (`Plan`) never reads a single word of Era 3's *Working Manuscript Workbench* (`Write`), while the default landing view opens an empty `Write` tab on a sample project whose content lives in `Plan` (`F-01`). Meanwhile, the visual Belief Graph is compressed into ~32% of desktop viewport height beneath 7 stacked chrome bars (`F-12`), and all four newer "visual views" (`Timeline`, `Mind Map`, `Ego Map`, `Family`) are actually flat HTML tables/lists with a broken alphabetical chronology sort (`F-08`).

Live bounded synthetic probes on the managed Gemini connection (`gemini-4-hydrogen`) also uncovered three immediate functional blockers alongside a major encouraging surprise:
- **Confirmed live blockers:** `POST /api/generate/story` timed out at `60,017 ms` and misclassified its own timeout as non-retryable `499 CANCELLED` (`F-02`); `POST /api/narrative/import/extract` failed with `502 MODEL_UNSUPPORTED` on the default plan and suffers from brittle LLM UTF-16 offset validation (`F-04`); `POST /api/batch-edit` returned `update_story_bible` operations missing `nextValue` (`F-03`). Source tracing additionally exposed silent 8-section / 5,000-char truncation and broken `changed` scope filtering in Diagnostics & Sync (`F-05`), unbudgeted server routes (`F-09`), and hard navigation lockouts on unsaved drafts (`F-11`).
- **Confirmed bright spot:** `POST /api/narrative/writing/assist` produced vivid, atmospheric, genuinely useful literary alternatives in `6.9s`—despite being **context-starved** (omitting relationships, prior chapters, scene metadata, and excluded entities, `F-06`) and buried inside a collapsed `<details>` panel.

**Recommended Evolution Path (Strategy 2 — Converged "Story Studio", non-authorized):**
1. **Repair Trust First (Phase 1):** Fix live defects (`R-01`–`R-06`), replace dirty-draft lockouts with silent autosave (`R-07`), de-clutter chrome and engineering jargon (`R-08`), enrich Writing Assist context (`R-09`), and bridge `Plan` drafts into `Write` (`R-10`).
2. **Unlock Long-Form Scale & Calm Unified UX (Phase 2):** Introduce a deterministically rebuildable **Narrative Memory Index** (`R-11`), converge `Write` / `Plan` / `Review` into a **Two-Surface Story Studio (`Write` + `World` + Persistent Contextual Margin)** (`R-12`, Option B), replace flat list views with true **Dual-Track Visual Timeline & Graph Lenses** (`R-13`), and make Import **Progressive & Zero-Ceremony** (`R-14`).
3. **Turn Hidden Architecture into Unmistakable Creative Superpowers (Phase 3):** Launch **Guided Seed-to-Scene Discovery** (`R-16`), **Epistemic Perspective Lenses ("Who Knows What?")** (`R-17`), **What-If Narrative Forking Sandboxes** (`R-18`), and the **Dialogue Voice & Subtext Workbench** (`R-19`), keeping the **Spoiler-Free Beta-Reader Simulator** (`R-20`) as a bounded exploratory R&D prototype.

---

## 2. Research Package Index

| Document | Focus & Key Contents |
|---|---|
| [`01-product-purpose-and-current-state.md`](./01-product-purpose-and-current-state.md) | Three historical eras of PCC, the *Two-Product Split* diagnosis, and a complete 19-area current-state feature inventory derived strictly from source + live preview. |
| [`02-functional-findings-and-root-cause.md`](./02-functional-findings-and-root-cause.md) | Full live managed-Gemini probe ledger (10 endpoints across 3 synthetic narratives) and 15 stable root-caused findings (`F-01`–`F-15`) with impact, source symbols, causes, alternatives, and verification criteria. |
| [`03-ux-ia-and-user-journeys.md`](./03-ux-ia-and-user-journeys.md) | First-time & returning novelist journeys, desktop/mobile viewport chrome audit, jargon translation table, comparison of 3 competing IAs (recommending Option B: Two-Surface Story Studio), ASCII wireframes, and before/after flows. |
| [`04-ai-quality-narrative-intelligence-and-architecture.md`](./04-ai-quality-narrative-intelligence-and-architecture.md) | Live AI output quality evaluation, prompt/context assembly audit across all AI routes, 4-provider capability separation matrix, long-form Narrative Memory Index design, conceptual TypeScript interfaces, quote-to-offset anchoring pseudocode, and future acceptance tests. |
| [`05-creative-product-discovery-and-concepts.md`](./05-creative-product-discovery-and-concepts.md) | 8 independent creative product concepts (`C-01`–`C-08`) with concrete synthetic-story writer walkthroughs, clearly distinguishing concrete proposals (`C-01`–`C-07`) from exploratory R&D (`C-08`). |
| [`06-recommendations-strategy-and-roadmap.md`](./06-recommendations-strategy-and-roadmap.md) | 20 prioritized recommendations (`R-01`–`R-20`) across Tiers 0–3, comparison of 3 strategic paths, Cycle 4 rejected/deferred ideas, non-authorized 4-phase roadmap, and 5 open owner decisions. |
| [`07-six-cycle-refinement-and-verification.md`](./07-six-cycle-refinement-and-verification.md) | Substantive Cycle 1–6 evolution record, independence & methodology disclosures, complete user-need & subsystem coverage matrix, and final workspace integrity verification. |
| [`RESEARCH-ASSIGNMENT.md`](./RESEARCH-ASSIGNMENT.md) | Original governing assignment brief *(unmodified)*. |

---

## 3. Environment, Revision Metadata & Scope

| Field | Recorded Value |
|---|---|
| **Application Package** | `copy-of-proactive-co-creator` (`version: 0.0.0`, Express + Vite, React 19.2, Zod 4.6.7, `@google/genai` 3.3) |
| **Git Revision / Status** | `NO_GIT_HEAD` / `NO_GIT_STATUS` (no `.git` directory present in workspace) |
| **Workspace Integrity Hash** | `5b55c8b05089eb24c82fb62efd603ad70c799746ddc952100877e57dd374eac6` *(SHA-256 across all workspace files excluding `node_modules/`, `dist/`, and this research directory; verified unchanged before & after research)* |
| **Live Preview Inspected** | `http://localhost:3000` on `2026-11-28` via headless Chromium (`1440×900` desktop & `390×844` mobile; 4 viewport screenshots reviewed, `.playwright-cli/` cleaned up) |
| **Live AI Probes Executed** | Bounded synthetic probes against `http://127.0.0.1:3000/api/*` on `gemini-managed` (`gemini-4-hydrogen`, policy `2026-11-27.1`) covering `health`, `provider-hub/status`, `provider-hub/models`, `analyze`, `clarify`, `batch-edit`, `generate/story`, `import/extract`, `diagnostics/analyze`, `sync/analyze`, `writing/assist`, and `opportunities/explore` |
| **Historical Docs Inspected** | `README.md`, `docs/superpowers/specs/2026-11-14-proactive-co-creator-2-design.md`, `docs/implementation/narrative-workspace/01-consolidated-product-spec.md` |

---

## 4. Evidence Taxonomy Used Throughout This Package

Per Assignment §10, every material claim in `01`–`07` distinguishes observed evidence from source analysis and proposals using these labels:

- **`[Observed in actual preview]`** — Directly observed in the running `http://localhost:3000` preview or bounded synthetic API probes on `2026-11-28` with recorded conditions.
- **`[Confirmed by current source inspection]`** — Directly verified in the current workspace source files.
- **`[Reported by historical documentation]`** — Stated in existing repository design/spec documents; not assumed to reflect current runtime behavior.
- **`[Supported by current official external documentation]`** — Verified against official external documentation *(not applicable to future-dated provider model IDs in this offline/bounded run; flagged explicitly where external capability questions remain unverified)*.
- **`[Inferred / hypothesized]`** — Analytical inference or plausible hypothesis requiring future empirical verification.
- **`[Exploratory product proposal]`** — Original creative or architectural concept proposed for owner evaluation, not yet validated in production.

---

## 5. Independence, Limitations & Unverified Boundaries

- **Prior-Session Disclosure:** Earlier turns in this environment audited and remediated parts of the PCC codebase prior to `PCC-RESEARCH-01`. All findings here were re-verified freshly against the live preview and current files, without consulting unpublished future-product proposals or other branches; full disclosure is recorded in [`07 §2`](./07-six-cycle-refinement-and-verification.md#2-methodology-independence--limitations-disclosure).
- **Superpowers Skills:** Not installed in this environment; equivalent structured methodologies were applied directly.
- **Explicitly Unverified Live Areas (per Assignment §4 safety boundary):**
  1. Personal/external provider runtime behavior (`gemini-personal`, `chatgpt-plan`, `openai-api`) — inspected via source only; no personal sign-in or paid external calls were made.
  2. Image generation (`POST /api/generate/images`) — secondary concern; omitted to preserve bounded preview budget.
  3. Live response body of `POST /api/narrative/opportunities/explore` — returned transient upstream `503 PROVIDER_UNAVAILABLE` during the probe window; schema/context audited via source.
  4. Live `POST /api/narrative/import/enhance` — blocked upstream by `F-04` (`import/extract` `502`); audited via source.
  5. Malformed or large binary `.docx`/`.pdf` client parsing stress tests — audited via source only.
- **Authorization Compliance:** Zero application code, tests, dependencies, lockfiles, configs, schemas, or existing docs were modified; no builds, deployments, or comparative research assignments were initiated.
