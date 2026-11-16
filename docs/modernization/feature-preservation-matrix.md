# Feature Preservation Matrix — Proactive Co-Creator 2.0

| Capability | Original (1.0) Behavior | 2.0 Evolution | Status |
| :--- | :--- | :--- | :--- |
| **Generation Modes** | `'image' \| 'story' \| 'video'` (default `'image'`) | `'story' \| 'image'` (default `'story'`); video completely removed; legacy `'video'` projects migrate to `'story'` | Preserved & Evolved |
| **Belief Graph Visualization** | Force-directed SVG nodes & edges, solid=explicit, dashed=implicit, zoom/pan/reset | Preserved SVG visual identity + search, category filter, focus node, highlight connections, group expand/collapse, hide inferred, table view toggle, stable positions | Preserved & Enhanced |
| **Entity Attribute Editing** | Floating overlay card on graph canvas; dropdown + custom value + existence toggle | Persistent Right Panel Contextual Inspector with provenance badges, alternatives, custom values, existence toggle, and entity rename | Preserved & Enhanced |
| **Relationship Editing** | Floating popover on edge click | Editable in both Relationship Popover and Right Panel Inspector with stable entity ID references | Preserved & Enhanced |
| **Clarifications** | Fixed 3 questions, plain text strings, lost pending answers on refresh | Adaptive 1–5 targeted questions linked to canonical entity/attribute/story targets; preserves drafts on refresh; supports Skip/Defer/Custom | Preserved & Enhanced |
| **Scene / Story Attributes** | Separate tab showing `"The Story"` or `"The Image"` entity attributes | Synchronized **Story Bible** (genre, tone, perspective, setting, themes, conflict, pacing, continuity rules, exclusions) + Consistency Checker | Preserved & Enhanced |
| **Decision Processing** | Manual one-by-one edits + LLM "Update Prompt" rewrite | **Decision Inbox** with single/batch Accept, Reject, Defer, Edit, filters, and deterministic local commit + optional AI polish | New & Integrated |
| **Natural-Language Batch Edit** | None | Structured instruction parser → reference resolution → ambiguity check → diff preview → atomic undoable transaction | New Capability |
| **Undo / Redo & History** | None | Transaction-level Undo/Redo + durable Version History with safe non-destructive restore | New Capability |
| **Persistence & Export** | Ephemeral React state (lost on reload) | Autosave (IndexedDB + localStorage fallback), multi-project recovery, multi-tab conflict guard, JSON Export/Import, Markdown Story Bible export | New Capability |
| **Story & Image Generation** | Explicit user trigger via `/api/generate/story` and `/api/generate/images` | Explicit user trigger preserved; outdated indicator preserved when plan changes; shared vs. mode-specific context cleanly separated | Preserved & Enhanced |
