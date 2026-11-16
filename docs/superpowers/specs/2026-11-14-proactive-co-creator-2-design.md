# Proactive Co-Creator 2.0 — Architecture & Six-Cycle Iterative Design Specification

**Date:** 2026-11-14
**Status:** Approved for Implementation

---

## 1. Executive Summary & Brainstorming Synthesis

Proactive Co-Creator 1.0 introduced an interactive Belief Graph, AI-generated Clarifications, and Attribute Editors for refining prompts. However, auditing the existing codebase (`App.tsx`, `BeliefGraph.tsx`, `ClarificationCard.tsx`, `pendingUpdates.ts`) revealed core structural friction:
1. **Fragmented State:** Creative truth was split across raw `prompt` strings, `beliefGraph` snapshots, `clarifications` arrays, and string-keyed `pendingAttributeUpdates`.
2. **High Interaction Cost:** Confirming 10 creative decisions required switching between 3 tabs (`Clarifications`, `Belief Graph`, `Attributes`), clicking individual dropdowns, and triggering full LLM prompt rewrites (`refinePromptWithAllUpdates`) followed by full graph regeneration (`refreshAnalysis`), which frequently lost or mutated previously confirmed entities.
3. **Lack of Stable Identities & Provenance:** Entities were keyed solely by mutable names; renaming an entity broke relationships, and AI inferences could not be distinguished from user-confirmed facts.
4. **Oversized Floating Modals:** Selecting a node in `BeliefGraph.tsx` rendered an overlay card directly over the graph canvas (`md:w-96`), obscuring connected nodes.

### Architectural Alternatives Considered
- **Option A (Chosen): Unified Three-Panel Workspace + Canonical Creative Project Store (Immutable Reducer + Transactions).**
  - *Left Panel:* Decision Inbox (aggregating Clarifications 2.0, AI Inferences, Conflict Alerts, and Natural-Language Batch Edits).
  - *Center Panel:* Interactive Belief Graph 2.0 (with search, category filters, group collapse, table view toggle, and collapsible Refined Prompt & Output Gallery deck).
  - *Right Panel:* Persistent Contextual Inspector (Entity/Relationship inspector when selected; Story Bible, Consistency Review, and History/Persistence when unselected).
  - *Bottom Bar:* Transaction & Generation Bar (Pending change review, Apply Approved, Undo, Redo, History, and explicit Story/Image generation).
- **Option B: Tabbed Wizard Workflow (Clarify → Graph → Story Bible → Generate).**
  - *Rejected:* Forces linear progression and reintroduces tab-switching friction when iterating between graph structure and clarifications.
- **Option C: Node-Canvas Everything (All clarifications and story bible fields as floating canvas nodes).**
  - *Rejected:* Degrades rapidly at >25 nodes, hurts keyboard accessibility, and makes batch operations cumbersome.

---

## 2. Six-Cycle Iterative Refinement

### Cycle 1 — Purpose and Requirements
- **Essential Preserved Capabilities:** Interactive SVG Belief Graph, explicit vs. implicit visual distinction (solid vs. dashed borders), relationship editing, custom attribute entry, AI clarifications, story generation, 4-slot image generation with partial-failure warnings, light/dark mode, server-side Gemini proxy.
- **Video Removal:** Complete removal of `'video'` from `GenerationMode`, `/api/generate/video*`, `/api/videos/*`, `videoStore.ts`, and `GEMINI_MODELS.video`. Default mode set to `'story'`. Legacy saved projects with `mode: 'video'` migrate cleanly to `'story'` while preserving entities, relationships, prompt, and outputs.
- **Measurable Target:** Reduce interactions required to confirm 10 decisions from ~24 clicks + 2 full AI round-trips to <= 4 clicks (via Decision Inbox batch select + local deterministic transaction commit) with 0 lost confirmed facts.

### Cycle 2 — UX and Interaction Optimization
- Eliminated tab-switching between Clarifications, Graph, and Scene Attributes by placing the **Decision Inbox** in the Left Panel, **Belief Graph 2.0** in the Center Panel, and **Contextual Inspector + Story Bible** in the Right Panel.
- Replaced the floating node attribute modal with the docked Right Panel Contextual Inspector so the graph remains unobstructed.
- Added keyboard shortcuts (`Ctrl/Cmd+Z` Undo, `Ctrl/Cmd+Shift+Z` Redo, `Escape` clear selection, `/` search graph) and one-click batch actions (`Select All`, `Accept Selected`, `Reject Selected`, `Defer Selected`).

### Cycle 3 — Data Architecture and Consistency
- Designed `CreativeProject` as the single source of truth with stable IDs (`ent_<uuid>`, `rel_<uuid>`, `attr_<uuid>`, `dec_<uuid>`, `rev_<uuid>`).
- Every `StoryEntity`, `EntityAttribute`, `StoryRelationship`, and `StoryBible` field carries `DecisionProvenance`:
  - `'prompt-explicit'` | `'user-edit'` | `'accepted-suggestion'` | `'ai-inferred'` | `'imported'` | `'derived'`
- And `ApprovalStatus`:
  - `'confirmed'` | `'pending'` | `'rejected'`
- Deterministic local mutations immediately update the canonical state, record an undoable transaction, and recompute the derived refined prompt without invoking the LLM unless requested.

### Cycle 4 — AI Reliability and Decision Control
- **Strict User Authority Invariant:** Reanalysis (`mergeAnalysisIntoProject`) matches incoming AI entities to existing canonical entities by normalized name/alias. Confirmed attributes, confirmed relationships, renamed entities, and explicitly excluded entities (`existence === 'false'` or `excluded === true`) are **never** overwritten or resurrected by AI reanalysis.
- New AI-discovered entities, inferred attributes, and clarification questions are staged as `DecisionItem` proposals in the Decision Inbox with status `'pending'`.
- **Natural-Language Batch Editing:** Parses instructions into typed `ProposedOperation` items (`set_attribute`, `add_attribute`, `add_entity`, `rename_entity`, `exclude_entity`, `add_relationship`, `update_relationship`, `remove_relationship`, `update_story_bible`). Ambiguous references (e.g., `"make him older"` when multiple characters exist) return an explicit `ambiguities` clarification prompt rather than guessing.

### Cycle 5 — Implementation and Testing Feasibility
- **Zero-Dependency State Engine:** Implemented in pure TypeScript (`lib/projectStore.ts`, `lib/canonicalModel.ts`, `lib/nlBatchEngine.ts`, `lib/promptBuilder.ts`, `lib/consistencyChecker.ts`, `lib/storageEngine.ts`) so that 100% of state transitions, migrations, batch operations, undo/redo, and prompt synthesis are deterministically unit-tested via `node:test`.
- **Dual-Layer Persistence:** Uses IndexedDB (`proactive_co_creator_v2`) with automatic fallback to `localStorage` and multi-tab `BroadcastChannel` / `storage` conflict detection so stale tabs never silently overwrite newer saves.

### Cycle 6 — Adversarial Quality Review
- *Can AI overwrite confirmed user choices?* Blocked by `isConfirmedStatus()` guards in `mergeAnalysisIntoProject`.
- *Can refreshing clarifications erase unsaved answers?* Pending user drafts in `Clarifications` are keyed by stable question ID and preserved across refresh; if underlying target state invalidates a question, it is marked `'outdated'` with an explanation rather than deleted.
- *Can undo/redo corrupt relationship references?* Undo/Redo snapshots store complete, normalized `ProjectSnapshot` states with referential integrity validation on restore.
- *Can a failed batch action partially mutate state?* Batch application validates all selected operations upfront; if a hard conflict is detected without force-override, the transaction aborts atomically or stages conflicts cleanly.
- *Can old projects fail migration?* `migrateProjectPayload()` safely upgrades v0/v1 state (including `mode: 'video'`) into v2 `CreativeProject`.
