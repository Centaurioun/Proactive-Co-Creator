# 01 — Product Purpose, Historical Evolution, and Current-State Feature Inventory

**Assignment:** `PCC-RESEARCH-01`  
**Parent Index:** [`README.md`](./README.md)  
**Cross-References:** [`02-functional-findings-and-root-cause.md`](./02-functional-findings-and-root-cause.md) · [`03-ux-ia-and-user-journeys.md`](./03-ux-ia-and-user-journeys.md) · [`04-ai-quality-narrative-intelligence-and-architecture.md`](./04-ai-quality-narrative-intelligence-and-architecture.md)

---

## 1. Evidence Taxonomy Used Across This Document

- **[Observed in actual preview]** — Directly observed in the running application (`http://localhost:3000`, `2026-11-28`, headless Chromium desktop `1440×900` & mobile `390×844`, and bounded managed-Gemini synthetic API probes).
- **[Confirmed by current source inspection]** — Directly verified in the current workspace source files.
- **[Reported by historical documentation]** — Stated in existing repository design/spec documents; treated as historical intent rather than current runtime proof.
- **[Inferred / hypothesized]** — Analytical synthesis requiring future runtime validation.

---

## 2. Original Purpose and Historical Evolution

### 2.1 Three Distinct Eras Visible in the Codebase

Inspecting the repository documentation alongside the active source tree reveals that **Proactive Co-Creator (PCC)** has evolved through three distinct architectural layers, all of which remain simultaneously active in the live UI **[Confirmed by current source inspection]** **[Reported by historical documentation]**:

1. **Era 1 — Interactive Visual Prompt & Belief Graph Prototype (`README.md`)**
   - **Original appeal:** A writer or creator enters a short prompt (e.g., *"A cat hosting a party for its animal friends"*). The system extracts an interactive **Belief Graph** of explicit and AI-inferred entities, attributes, and relationships, surfaces **proactive clarifying questions**, lets the user adjust graph nodes/edges, and synthesizes a refined prompt to generate either a **story** or **4 images**.
   - **Why it resonated:** A one-sentence seed became a tangible, visual, explorable creative space in seconds. Rather than confronting a blank chat prompt, the writer saw the AI's hidden assumptions laid out as editable nodes and edges.

2. **Era 2 — Proactive Co-Creator 2.0: Canonical Project Studio (`docs/superpowers/specs/2026-11-14-proactive-co-creator-2-design.md`)**
   - **Evolution:** Shifted the primary focus to **Story Mode** (keeping Image Mode secondary) and introduced a **Canonical Creative Project Model** (`shared/types.ts`): a 12-field **Story Bible**, a **Decision Inbox** with explicit approval statuses (`pending`, `confirmed`, `rejected`) and provenance tags, **Natural-Language Batch Editing**, a **Local Consistency Checker**, deterministic prompt compilation (`lib/promptBuilder.ts`), **Undo/Redo**, revision history, and browser IndexedDB persistence (`lib/storage.ts`).
   - **Core principle established:** *Explicit user approval* — AI inferences remain `pending` until confirmed, and confirmed facts compile deterministically into `refinedPrompt`.

3. **Era 3 — Narrative Workspace & Multi-Provider Hub (`docs/implementation/narrative-workspace/01-consolidated-product-spec.md`, `shared/narrativeSchemas.ts`, `server/providers/`)**
   - **Evolution:** Expanded PCC to support **existing manuscripts and long-form writing**:
     - Added the **Four Data Authorities** model (Immutable Imported Sources, Editable Working Manuscript, Canonical Narrative Model, Generated Output Artifacts).
     - Added three top-level workspace modes (`Write`, `Plan`, `Review`) plus standalone `Import`, `Projects` (Hub), and `AI settings` (Multi-Provider Hub supporting `gemini-managed`, `gemini-personal`, `chatgpt-plan`, and `openai-api`).
     - Added a **Working Manuscript Editor** with chapter/scene outline, **Contextual AI Writing Assistant**, **User-Reviewed Style Profile**, **5-step Faithful Narrative Import** (`.txt`, `.md`, `.docx`, `.pdf`), **Semantic Diagnostics & Safe Fixes**, **Bidirectional Manuscript ↔ Model Sync**, **Creative Opportunities**, and four additional projection views (**Timeline**, **Mind Map**, **Ego Map**, **Family Kinship**).
     - Added strong safety invariants: epistemic distinction (`explicit`, `interpretation`, `belief`, `reported`, `ambiguous`, `user-authored`), CAS/stale-revision guards, local browser backups, and ZIP all-projects archives.

### 2.2 The Core Product Tension Today: "Two Applications Welded Together"

**[Observed in actual preview]** **[Confirmed by current source inspection]**

The single most important structural finding of Cycle 1–2 discovery is that **PCC has not yet unified Era 1/2 (the Seed-to-Prompt Ideation Studio) with Era 3 (the Long-Form Manuscript & Continuity Workbench)**:

```
┌───────────────────────────────────────────┐       ┌───────────────────────────────────────────┐
│   ERA 1/2: PROMPT & GRAPH STUDIO ("Plan") │       │  ERA 3: MANUSCRIPT WORKBENCH ("Write")    │
│                                           │       │                                           │
│  • Original Story / Scene Seed            │       │  • Working Manuscript (Chapters / Scenes) │
│  • Belief Graph + Decision Inbox          │  ≠≠≠  │  • Outline + Section Metadata             │
│  • Story Bible + Freeform Notes           │ (gap) │  • AI Writing Assistant (local 3k window) │
│  • lib/promptBuilder.ts → refinedPrompt   │       │  • Style Profile + Writing Alternatives   │
│  • "Generate Story" / "Generate Images"   │       │  • Manual Sync in "Review" (8-sec limit)  │
└───────────────────────────────────────────┘       └───────────────────────────────────────────┘
```

- `lib/promptBuilder.ts` compiles `refinedPrompt` **exclusively** from `originalIdea`, `storyBible`, `entities`, `relationships`, and `freeformNotes`; it **never reads** `Working Manuscript` sections **[Confirmed by current source inspection]**.
- Meanwhile, the default landing screen opens in `Write` mode on the built-in sample project (*Cat’s Woodland Dinner Party*), which has **0 manuscript sections**, hiding the rich Belief Graph and 14 proactive decisions behind the `Plan` tab **[Observed in actual preview]** (see [`F-01`](./02-functional-findings-and-root-cause.md#f-01)).
- Users moving between `Write`, `Plan`, and `Review` encounter duplicated controls (`Story Bible`, `Opportunities/Ideas`, `Checks`, `History`, `Generate Story`, `Read output`), inconsistent visual metaphors, and engineering-level safety vocabulary exposed directly in the primary writing flow.

---

## 3. Actual Current-State Feature Inventory & Status Matrix

Derived strictly from current source inspection and live preview observation (`2026-11-28`), not from historical completion reports.

| Functional Area | Actual Implementation & Entry Point | Status | User Value & Output Quality | Key Limitations & Notes |
|---|---|---|---|---|
| **1. Initial Landing & Sample Project** | `App.tsx`, `lib/sampleProject.ts`, `ManuscriptEditor.tsx` | **Partial / Friction-Heavy** | Demonstrates schema cleanly in `Plan`, but lands new users on an empty `Write` screen (`0 words`). | Default mode is `Write` even when manuscript has 0 sections; initial render briefly disables editor with an IndexedDB readiness banner **[Observed in actual preview]** (`F-01`). |
| **2. Seed Analysis (`Analyze Idea`)** | `POST /api/analyze`, `server/aiService.ts:analyzeBeliefGraph` | **Working** | Good explicit/implicit entity & relationship extraction (~23.9s live on `gemini-4-hydrogen`). | Hard 8,000-char limit; bypasses server `aiBudget` token/slot enforcement (`F-09`); does not read manuscript prose (`F-07`). |
| **3. Proactive Clarifications** | `POST /api/clarify`, `DecisionInboxPanel.tsx` | **Working (Hidden by Default)** | Context-aware 2–4 questions with structured `target` links and evocative options (~15.1s live). | `DecisionInboxPanel` defaults to collapsed (`showInbox = false`) in `Plan`; horizontal filter bar clips on desktop (`F-12`). |
| **4. Belief Graph Canvas** | `components/BeliefGraphCanvas.tsx`, `components/GraphNode.tsx` | **Working (Cramped Viewport)** | PCC's strongest visual differentiator: explicit vs. inferred borders, clickable nodes/edges, grouping, search, zoom/fit. | Squeezed into ~32% of desktop viewport height under 6 stacked bars + bottom bar **[Observed in actual preview]** (`F-12`). |
| **5. Natural-Language Batch Edit** | `POST /api/batch-edit`, `lib/batchEditEngine.ts`, `DecisionInboxPanel.tsx` | **Broken / Defective** | Strong ambiguity detection & unhandled-clause reporting (~3.9s live). | **Live bug:** `update_story_bible` operations returned without `nextValue` because schema marks `nextValue` optional/nullable (`F-03`). |
| **6. Prompt Compilation & Polish** | `lib/promptBuilder.ts`, `POST /api/refine` | **Working (Disconnected from Manuscript)** | Deterministic compilation preserves confirmed facts & exclusions transparently. | Completely ignores `Working Manuscript` prose (`F-07`); `refine` bypasses server `aiBudget` slots (`F-09`). |
| **7. One-Shot Story Generation** | `POST /api/generate/story`, `server/aiService.ts:generateStoryText` | **Broken / Defective (Managed Gemini)** | Intended to draft stories from the compiled brief. | **Live failure:** Timed out at 60,017ms on `gemini-4-hydrogen` (missing `ThinkingLevel.LOW`) and misreported timeout as non-retryable `499 CANCELLED` (`F-02`). |
| **8. Image Generation (Secondary)** | `POST /api/generate/images`, `server/aiService.ts:generateImagesBatch` | **Unverified Live / Architectural Mismatch** | Secondary feature (up to 4 images via `gemini-3.1-flash-lite-image`). | Not tested live to conserve budget; `gemini-personal` adapter drops `imageConfig` and `chatgpt-plan`/`openai-api` mark images unsupported (`F-14`). |
| **9. Working Manuscript Editor (`Write`)** | `components/manuscript/ManuscriptEditor.tsx`, `lib/narrative/manuscriptModel.ts` | **Working (High Navigation Friction)** | Clean chapter/scene hierarchy, search/chronology filters, focus mode, safe Markdown preview, undo/redo, section metadata (POV, location, chronology, purpose, status). | Hard-locks switching tabs whenever draft is unsaved (`F-11`); empty state misleadingly says *"No sections match these filters"* (`F-15`). |
| **10. AI Writing Assistant (`Write`)** | `POST /api/narrative/writing/assist`, `WritingAssistantPanel.tsx`, `lib/narrative/writing/selectionHelpers.ts` | **Working (Context-Starved)** | **High prose quality observed live** (~6.9s): vivid, atmospheric alternatives with explicit `assumptions` and safe digest-checked insertion. | Context omits all `relationships`, prior/subsequent chapters, section metadata, and excluded entities (`F-06`). Collapsed inside `<details>` below fold. |
| **11. User-Reviewed Style Profile** | `components/manuscript/StyleProfilePanel.tsx` | **Partial / Manual-Heavy** | Allows confirmed style observations (`pov`, `voice`, `tense`, `rhythm`, `dialogue`, `atmosphere`) to feed Writing Assistant. | Hidden in collapsed `<details>` below editor; requires manual authoring or import extraction to populate. |
| **12. Faithful Narrative Import** | `components/narrativeImport/ImportWorkflow.tsx`, `POST /api/narrative/import/extract`, `POST /api/narrative/import/enhance` | **Broken / High Friction** | Supports `.txt`, `.md`, `.docx`, `.pdf`, pasted text, source retention, checkpoints, new-project or append-with-identity-resolution, and Stage 2 enhancements. | **Live failure:** `import/extract` returned `502 MODEL_UNSUPPORTED` on default `gemini-4-hydrogen` plan (`F-04`). Source inspection also confirms brittle exact UTF-16 offset rejection in `proposalValidator.ts`, clamped `maxOutputTokens: 2048`, missing fence-stripping, and heavy 5-step ceremony (`F-04`, `F-13`). |
| **13. Local Consistency Checker** | `lib/consistencyChecker.ts`, `Plan > Checks`, `Review` | **Partial / Shallow** | Deterministic, zero-latency structural checks (missing relationship endpoints, violated exclusions). | Only 3 hardcoded English antonym pairs; false-positive setting mismatch via naive substring check; duplicated across `Plan > Checks` and `Review` (`F-10`). |
| **14. Semantic AI Diagnostics & Safe Fixes** | `POST /api/narrative/diagnostics/analyze`, `POST /api/narrative/diagnostics/suggest-fixes`, `NarrativeReview.tsx` | **Working (Truncated & Unanchored)** | **Strong accuracy on short test:** Caught all 3 seeded contradictions (eye color, excluded Steam Automaton, Tuesday/Wednesday timeline) while ignoring character rumors (~8.3s live). | Silently slices to first 8 sections × 5,000 chars even on `Full` or `Changed` scope (`F-05`); strips `belief`/`reported` entities; drops passage anchors (`anchors: []`, `F-10`); hit transient `503` on first attempt. |
| **15. Bidirectional Sync (`Review`)** | `POST /api/narrative/sync/analyze`, `NarrativeReview.tsx` | **Working (Truncated)** | **Strong accuracy on short test:** Detected contradictions and proposed missing location entity `Port Marrow` with quotes (~8.4s live). | Same silent 8-section × 5,000-char truncation (`F-05`); no automated drift indicator while writing; disabled when manuscript is empty. |
| **16. Creative Opportunities** | `POST /api/narrative/opportunities/explore`, `OpportunityCenter.tsx` | **Partial / Unverified Output** | Clean architectural separation between creative ideas and continuity errors; supports manual creation and Send to Change Review. | Live call hit transient `503 UPSTREAM_ERROR` after 17.3s (output quality unverified live); duplicated in Plan top bar and Inspector (`Ideas`) tab. |
| **17. Visual Projections: Timeline, Mind Map, Ego Map, Family** | `TimelinePanel.tsx`, `MindMapPanel.tsx`, `EgoMapView.tsx`, `FamilyKinshipView.tsx` | **Placeholder / Misnamed** | Enforce strict epistemic honesty (no invented dates or fake family trees). | **None of the four is a visual diagram** — all four are flat HTML tables/lists. Timeline sorts chronologically via broken lexicographic `localeCompare`; Mind Map omits locations, objects, events, and relationships (`F-08`). |
| **18. Project Hub, Backup, Export & History** | `ProjectHub.tsx`, `lib/narrative/recovery/`, `lib/export.ts` | **Working (Minor Wiring Gap)** | Strong safety engineering: browser backups, ZIP all-projects archive, `.docx`/`.txt`/Story Bible/Prompt/Audit export, atomic restore. | `ProjectHub` History tab has an unconnected fallback message when `historyContent` isn't passed; Revision History duplicated in Plan Inspector and Project Hub. |
| **19. AI Settings & Multi-Provider Hub** | `AiConnectionsPanel.tsx`, `server/providers/` | **Partial / Asymmetric** | Clean 4-connection architecture (`gemini-managed`, `gemini-personal`, `chatgpt-plan`, `openai-api`), explicit capability descriptors, session-only key handling. | Only `gemini-managed` verified live (per authorization rules); `chatgpt-plan` SRB gating is inconsistent across routes; OpenAI JSON uses prompt-only schema instructions (`F-14`). |

---

## 4. Product Coverage Map (Core User Needs vs. Inspection Depth)

| Core User Need (Assignment §2) | Relevant Subsystems | Inspection Status | Overall Readiness Verdict |
|---|---|---|---|
| **1. Start with an idea** | Initial landing, `+ New`, `Analyze`, `Clarify`, `Decision Inbox`, `Belief Graph`, `Story Bible`, `Batch Edit`, `Generate Story` | Source-inspected + Live preview + Live API probed | **Conceptually strong, operationally undermined** by `Write`-first landing, hidden Inbox, `Generate Story` 60s timeout, and `Batch Edit` missing `nextValue`. |
| **2. Understand an existing narrative** | `ImportWorkflow`, parsers (`.txt`/`.md`/`.docx`/`.pdf`), `extractionService`, `proposalValidator`, `Diagnostics`, `Sync` | Source-inspected + Live preview + Live API probed | **Conceptually rigorous, practically fragile** due to brittle UTF-16 offset rejection, live `import/extract` 502 error, 5-step ceremony, and 8-section silent truncation in Diagnostics/Sync. |
| **3. Develop and improve a story** | `ManuscriptEditor`, `WritingAssistantPanel`, `StyleProfilePanel`, `OpportunityCenter`, `Safe Fixes`, `Sync` | Source-inspected + Live preview + Live API probed (`Opportunities` hit transient 503) | **Promising prose intelligence, fragmented UX** — Writing Assistant writes well but lacks relationships/multi-scene memory; dirty-draft navigation lock interrupts flow; `Plan` and `Write` remain split. |
| **4. See and manage the narrative** | `BeliefGraphCanvas`, `Table`, `EgoMapView`, `FamilyKinshipView`, `TimelinePanel`, `MindMapPanel`, `ProjectHub`, `Backup/Export`, `AI Settings` | Source-inspected + Live preview (`1440×900` & `390×844`) | **Strong persistence safety, weak visual clarity** — Belief Graph is cramped; 4 other "visual" views are plain text lists/tables; chrome overload obscures narrative structure. |

### Explicitly Unverified Areas (Recorded per Assignment §4 & §11)
- **Personal provider live execution (`gemini-personal`, `chatgpt-plan`, `openai-api`):** Not executed live per Section 4 authorization rules (no personal sign-in or paid external keys). Evaluated rigorously via source inspection of `server/providers/` and official provider contract references.
- **Image generation live execution (`POST /api/generate/images`):** Not executed live (secondary concern per Section 2; preserved bounded AI budget). Evaluated via source inspection (`server/aiService.ts`, `server/providers/geminiAdapter.ts`).
- **Live Creative Opportunities output quality (`POST /api/narrative/opportunities/explore`):** Invoked once with synthetic narrative 3; returned transient upstream `503 UPSTREAM_ERROR` after 17.3s. Prompt/schema and UI workflow were fully inspected in source; prose quality remains unverified live.
- **Binary file parsing edge cases (`.docx` / `.pdf` uploads in browser):** Inspected via source (`ImportWorkflow.tsx`, `shared/narrativeSchemas.ts`), not stress-tested with malformed multi-megabyte binary fixtures in browser.

---

## 5. Summary of Current Product Strengths Worth Preserving

Despite serious defects and UX sprawl, PCC possesses four rare foundations that most generic AI writing tools lack **[Confirmed by current source inspection]** **[Observed in actual preview]**:

1. **Author-in-Control Epistemic Discipline:** Refusing to silently promote AI guesses into confirmed canon (`pending` vs. `confirmed`, explicit vs. inferred, character belief vs. world fact) is a genuine competitive advantage for serious fiction writers.
2. **Visible, Editable World Structure:** The Belief Graph (`BeliefGraphCanvas`) makes relationships and hidden assumptions inspectable in a way linear chat threads cannot.
3. **High-Integrity Persistence & Recovery:** IndexedDB persistence, CAS revision checks, local browser backups, atomic restore, and ZIP archives show strong engineering care for not losing a writer's manuscript.
4. **Strong Underlying Model Potential:** Live probes of `Writing Assist` and `Diagnostics`/`Sync` demonstrate that when given clean, bounded narrative context, the model produces atmospheric prose and accurately catches subtle multi-chapter contradictions while respecting character-held rumors.

The rest of this research package examines why these strengths are currently obscured ([`02`](./02-functional-findings-and-root-cause.md), [`03`](./03-ux-ia-and-user-journeys.md), [`04`](./04-ai-quality-narrative-intelligence-and-architecture.md)) and how PCC can evolve into a cohesive, writer-first creative collaborator ([`05`](./05-creative-product-discovery-and-concepts.md), [`06`](./06-recommendations-strategy-and-roadmap.md)).
