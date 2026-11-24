# Screen, Surface & Interaction Inventory (Current Baseline)

- **Baseline SHA:** `03e9fda79f00fc9d27984142dcb188f099f28fde` (+ narrow Stage 0 S0.7 P1 keyboard/focus fixes)
- **Evidence Sources:** Live Chromium DOM inspection (`scripts/stage0-audit-browser.sh`), screenshots `SC-01`–`SC-16`, and source verification (`App.tsx`, `components/*.tsx`, `README.md`).

## 1. Principal UI Surfaces & Responsive Shell

| Surface | Component | Desktop (`>= 1280px` / `xl:`) | Tablet / Mobile (`< 1280px`) | Primary User Job |
| --- | --- | --- | --- | --- |
| Global Header | `components/Header.tsx` | Sticky top bar (`63px`), brand button, 5 nav buttons (`Workspace`, `Story Bible`, `Prompt & Output`, `History & Export`, `About`), `Reset Sample Plan`, `Dark Theme` | `63px` bar showing only brand + `Dark Theme` at `< 640px` (`nav` & `Reset Sample Plan` hidden via `hidden md:flex` / `hidden sm:inline-flex`) | Orient & switch workspace focus, toggle theme, open About |
| Storage Conflict / Error Banner | `App.tsx` (`role="region"`, `aria-label="Storage conflict or quota alert"`) | Conditional amber/red bar directly under Header (`Reload Latest from Storage`, `Keep My Version (Overwrite)`, `Retry Storage Read`, `Export Backup JSON`, `Dismiss`) | Full-width stacked buttons above PromptInput (`SC-15`) | Truthful persistence warning & safe recovery without silent overwrite |
| Status Notification Toast | `App.tsx` | Fixed bottom-right transient pill with dismiss button | Same fixed overlay | Confirm Undo/Redo, Restore, Import/Export, or mode switch |
| Left Column (`xl:col-span-3`) | `components/DecisionInboxPanel.tsx` | Always visible (`3/12` width): Header + `More Questions`, Natural-Language Batch Edit form + staged preview, Search + Status dropdown + Category filter strip, bulk Select All/None, decision/clarification cards | Shown only when mobile bottom tab `Inbox (N)` is active | Review AI proposals & clarifications, stage/apply NL batch edits |
| Center Column Top (`xl:col-span-6`) | `components/PromptInput.tsx` | Seed idea textarea, char counter (`N seed · M/8,000 compiled chars`), `Story Mode / Image Mode` toggle, `Reanalyze Idea`, `Generate Story/Images` | Always visible above Graph/Output tabs on `< 1280px` (`SC-11`, `SC-12`) | Enter/edit seed prompt, trigger AI analysis or generation |
| Center Column Middle | `components/BeliefGraph.tsx` | Flex-grow SVG force-directed multigraph OR high-density `Table` view, search, category dropdown, `Highlight Links`, `Inferred: Shown`, `Group Guests`, `Excluded`, `Graph \| Table`, zoom `+ / - / Fit` | Shown when `Belief Graph` tab active (`SC-11`) — squeezed to ~90–140px height on `390×844` | Explore/filter entities & directed relationships, select node/edge |
| Center Column Bottom | `components/OutputGallery.tsx` | Collapsible deck (`Generated Story` / `Image Gallery` + `Refined Prompt & Notes`), run selector, `Copy Story`, `Download .txt`, AI Polish proposal banner, outdated badge, 4-slot 1:1 image grid + fullscreen lightbox | Shown when `Output` tab active (`SC-12`) | Read generated story/images, inspect synthesized prompt, copy/download |
| Right Column (`xl:col-span-3`) | `components/ContextualInspector.tsx` | 4-tab panel (`Inspector`, `Story Bible`, `Checks (N)`, `History`): Entity/Relationship editor, 12-field Story Bible (`Grid \| List` + category filters + `Confirm Pending`), Consistency Checks with target navigation, Export/Import/Projects/Revision History | Shown when `Inspector` tab active (`SC-14`) | Authoritative editing of entities, relations, Story Bible, checks, projects & revisions |
| Mobile Panel Switcher | `App.tsx` (`aria-label="Mobile workspace panels"`) | Hidden (`xl:hidden`) | Sticky 4-button bar (`Inbox (N)`, `Belief Graph`, `Inspector`, `Output`) above footer | Switch between the 4 workspace surfaces below `1280px` |
| Bottom Action Bar | `components/WorkspaceBottomBar.tsx` | Single `59px` bar: `Undo \| Redo`, pending/rev summary, `Accept All Pending (N)`, `Review Plan & Prompt`, `Hide/Show Output Panel`, `Story \| Image`, `Generate Story/Images` | Wraps to `109px` (`768px`) and **`189px` / 4 rows (`390×844`)** | Undo/Redo, review staged diff, switch mode, trigger explicit generation |
| Review Plan Modal | `App.tsx` (`role="dialog"`, `aria-label="Review Plan and Prompt Changes"`) | Centered modal (`SC-07`): Before→After diff list, `Accept All Pending`, recent revisions with `Restore`, side-by-side Current vs Projected prompt | Scrollable modal | Review combined pending decisions + staged batch edits before commit |
| Image Full Preview Modal | `components/OutputGallery.tsx` (`role="dialog"`, `aria-label="Image full preview"`) | Fullscreen backdrop (`SC-09`) with image, `Download Image`, `Close Preview` | Fullscreen backdrop | Inspect full-resolution generated image |
| About Modal | `components/InfoModal.tsx` (`role="dialog"`, `aria-labelledby="info-modal-title"`) | Centered summary card explaining provenance & local persistence | Centered card (trigger hidden `< 768px`!) | Product overview |

## 2. Complete Interaction & Control Inventory

| Action / Control | Location | Trigger | Authoritative Model Field(s) | Undoable | Keyboard | Covered in Automated Tests |
| --- | --- | --- | --- | --- | --- | --- |
| Edit Seed Idea | `PromptInput.tsx` | Typing in textarea | `snapshot.originalIdea`, `refinedPrompt` | Yes (coalesced) | Yes | Unit + `J01` |
| `Reanalyze Idea` | `PromptInput.tsx` | Click | Calls `/api/analyze` + `/api/clarify` → merges non-destructively | Yes | Yes | Unit + `J01` (mock) |
| `Story / Image` Mode Switch | `PromptInput.tsx` & `WorkspaceBottomBar.tsx` (duplicated) | Click | `snapshot.mode`, `refinedPrompt` | No (view/mode switch) | Yes | `E2E-H`, `J08` |
| `Generate Story` / `Generate Images` | `PromptInput.tsx`, `OutputGallery.tsx` (empty), `WorkspaceBottomBar.tsx` (**3 places**) | Explicit click only | Appends `GenerationArtifact` to `project.artifacts` | No (artifact appended) | Yes | `J07`, `J08` (mock) |
| Natural-Language Batch `Preview` & `Apply Approved Batch` | `DecisionInboxPanel.tsx` (`#nl-batch-input`) | Form submit / Click | Parses clauses locally / `/api/batch-edit`; atomic commit on `snapshot` with stale revision guard | Yes (single atomic entry) | Yes | Unit + `E2E-E`, `J06` |
| Decision `Accept` / `Defer` / `Reject` / `Custom...` / Bulk `Accept Selected` | `DecisionInboxPanel.tsx` | Click | Mutates entity attribute / relationship / Story Bible / clarification status & provenance | Yes | Yes | Unit + `J02`, `J03` |
| `More Questions` | `DecisionInboxPanel.tsx` | Click | Calls `/api/clarify` → appends new `clarifications` | Yes | Yes | `J03` (mock) |
| Graph Search, Category Filter, `Highlight Links`, `Inferred: Shown`, `Group Guests`, `Excluded` | `BeliefGraph.tsx` | Input / Select / Toggle | View filter state only (0 model mutation) | N/A | Yes | `J05` |
| Graph Zoom `+` / `-` / `Fit` / Drag Pan / Wheel Zoom | `BeliefGraph.tsx` | Click / Pointer / Wheel | Local `viewTransform` state | N/A | Buttons only (pan is pointer-only) | `J05` |
| `Graph \| Table` Display Toggle & Row Selection | `BeliefGraph.tsx` | Click / Enter / Space | Local `selectedEntity` / `selectedRelationship` | N/A | **Fixed in S0.7** (was pointer-only in Table View!) | `J05`, `tests/stage0Accessibility.test.ts` |
| Entity Rename, Existence (`Present \| Absent`), Attribute Edit/Add, Relationship Link/Edit/Remove | `ContextualInspector.tsx` (`Inspector` tab) | Click / Form submit | `snapshot.entities`, `snapshot.relationships` | Yes | Yes | Unit + `J05` |
| Add New Entity to Graph | `ContextualInspector.tsx` (`Inspector` tab, directory state) | Form submit | Appends confirmed entity to `snapshot.entities` | Yes | Yes | Unit |
| Story Bible 12-field Edit, `Confirm`, `Clear`, `Confirm Pending (N)`, `Grid \| List`, Category Filter | `ContextualInspector.tsx` (`Story Bible` tab) | Input / Click | `snapshot.storyBible.*` (mirrored to Scene entity) | Yes | Yes | Unit + `E2E-C`, `J04` |
| Consistency Checks `Inspect <Entity>` / `Edit <Field>` | `ContextualInspector.tsx` (`Checks` tab) | Click | Navigation + focus only (**0 revision bump**) | N/A | Yes | Unit + `E2E-D`, `J10` |
| Export JSON (v3), Export Story Bible `.md`, Export Refined Prompt (`.md` labeled `.txt`), Import JSON (File/Paste) | `ContextualInspector.tsx` (`History` tab) | Click / File input | Serializes/deserializes `CreativeProject` via `migrateProjectPayload` | N/A | Yes | Unit + `J09`, `J12` |
| Create / Switch / Delete Local Project | `ContextualInspector.tsx` (`History` tab) | Form / Click | IndexedDB + localStorage + tombstone set | N/A | Yes | `E2E-A`, `E2E-B`, `E2E-G`, `J09` |
| Revision History `Restore` | `ContextualInspector.tsx` (`History` tab) & Review Modal | Click | Restores historical snapshot after saving safety checkpoint | Yes | Yes | Unit + `J12` |
| `Undo` / `Redo` | `WorkspaceBottomBar.tsx` + `Ctrl/Cmd+Z` / `Ctrl/Cmd+Shift+Z` | Click / Shortcut | `undoHistory.past` / `future` (persisted across reload) | Self | Yes | Unit + `E2E-A`, `E2E-E`, `J04`, `J12` |
| `Review Plan & Prompt` | `WorkspaceBottomBar.tsx` | Click | Opens diff modal (read-only until Accept/Reject/Restore clicked) | N/A | Yes (`Escape` + focus return) | `E2E-E`, `J06` |
| `Reset Sample Plan` | `Header.tsx` | Click (`hidden sm:inline-flex`) | Resets active sample plan | Yes | Desktop/tablet only | Source verified |

## 3. Discrepancies Between `README.md`, Source Code, and Rendered UI (S0.0.4)

| # | Area | `README.md` / Label Claim | Actual Rendered UI / Code Reality | Evidence |
| --- | --- | --- | --- | --- |
| D-01 | Refined Prompt Export Extension | Button in `ContextualInspector.tsx:373` reads **`Export Refined Prompt (.txt)`** | `App.tsx:1677` downloads **`refined-prompt.md`** with MIME `text/markdown;charset=utf-8` | `SC-10`, `J09`, `App.tsx:1677` |
| D-02 | Header Active Navigation Indicator | `Header.tsx` exposes `activeSection` prop (`workspace \| story-bible \| output \| history`) to underline active top-nav tab | `App.tsx:1823–1829` never passes `activeSection`, so **`Workspace` stays permanently underlined blue** even when `Story Bible`, `Prompt & Output`, or `History & Export` is clicked | Live DOM check in `stage0-audit-metrics.json`, `SC-05`, `SC-10`, `SC-14` |
| D-03 | Empty Workspace Initial Idea | Blank first-run project expected to show empty input guidance | `migrateProjectPayload` / blank project state renders `"Untitled creative project"` inside the textarea while the button reads `"Reanalyze Idea"` instead of `"Analyze Idea"` | `SC-01`, `J01` |
| D-04 | Mobile Accessibility of Header Actions | `Header.tsx` includes `About` and `Reset Sample Plan` | At `390×844` (`SC-11`, `SC-12`, `SC-15`), `nav` (`hidden md:flex`) and `Reset Sample Plan` (`hidden sm:inline-flex`) are hidden with no mobile menu alternative | `SC-11`, `SC-12` |
| D-05 | Add Attribute Button Disabled Logic | `ContextualInspector.tsx:465` intends to require both attribute name and value | Uses `disabled={!newAttrName.trim() && !newAttrValue.trim()}` (`&&` instead of `||`), so button appears enabled when only one input is filled and silently no-ops on click | `ContextualInspector.tsx:465` |
| D-06 | `README.md` Node & Test Claims vs Live Repo | `README.md` describes general setup & features at a high level | Verified live repo runs **106/106 tests across 16 suites** (102/102 at `03e9fda` baseline before Stage 0 additions), `Node 22.23.5`, Schema v3, and has **no Video mode** | `npm test`, `package.json`, `shared/types.ts` |
