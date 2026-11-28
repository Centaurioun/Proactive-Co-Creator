# 01 — Current UI & UX Audit (Empirical Baseline)

**Assignment:** `PCC-UI-RESEARCH-01` — Independent UX, Information Architecture & Visual Design Discovery  
**Status:** Complete (Cycle 1 & Cycle 2 Empirical Baseline)  
**Environment & Revision Disclosure:** Local workspace preview at `http://localhost:3000`; `NO_GIT_HEAD` (no `.git` directory present in `/app/applet`); verified read-only source inspection and isolated synthetic preview measurements at `1440×900`, `1024×768`, and `390×844`. Zero private manuscripts, credentials, user projects, or live AI provider calls were touched.  
**Prior-Exposure Disclosure:** As noted in `RESEARCH-ASSIGNMENT.md §2`, this research session follows earlier product discovery work (`PCC-RESEARCH-01`, `PCC-RESEARCH-02`) on this repository. All observations in this document are freshly anchored to direct source inspection and live rendered preview of the current application rather than inherited from earlier UX proposals.

---

## 1. Evidence & Labeling Convention

Every claim in this study carries an explicit epistemic label:

| Label | Meaning |
|---|---|
| **`Observed in preview`** | Directly measured or reproduced in the running browser preview (`http://localhost:3000`) using read-only DOM/geometry inspection on default/synthetic state. |
| **`Confirmed in source`** | Directly verified in the current TypeScript/React/CSS codebase (exact file path and line numbers cited). |
| **`Historical report`** | Referenced from prior documentation in the repository; never treated as proof of current rendered behavior without verification. |
| **`Inferred`** | Architectural or usability consequence logically derived from confirmed source or observed preview behavior. |
| **`Unverified`** | Behavior depending on live AI provider responses, extreme dataset sizes (>100k words), or native desktop packaging not executed in this read-only study. |
| **`Proposal`** | A recommended design direction, pattern, or future capability (not currently implemented). |

---

## 2. Complete Current-State Screen, Overlay & Panel Inventory

Inspection of `App.tsx`, `components/`, `components/workspace/`, `components/manuscript/`, `components/graph/`, `components/inspector/`, `components/narrativeImport/`, `components/opportunities/`, `components/projects/`, and `components/settings/` (`Confirmed in source`) reveals a **four-layer shell** with **5 top-level workspaces**, **4 modal/drawer overlays**, **7 right-rail inspector tabs**, and **4 graph display sub-modes**.

### 2.1 Top-Level Chrome & Navigation Surfaces

| Surface | Source Component | Current Controls / Contents | Observed / Confirmed Notes |
|---|---|---|---|
| **Global Header** | `components/Header.tsx` | Brand button, active project title + `Saved · r{n}`, `+ New`, `Import`, `Projects`, `About`, `Sample data / Reset Sample Plan…`, `Dark Theme` toggle | `Observed in preview`: `65px` tall at `1440×900` & `1024×768`; wraps to `117px` at `390×844` while hiding `+ New`, `Import`, `Projects`, `About` (`hidden sm:inline-flex`). |
| **Workspace Switcher Bar** | `App.tsx` (primary nav) | `Write`, `Plan`, `Review`, `AI settings`, plus duplicate `New`, `Import`, `Projects` actions | `Observed in preview`: Duplicates `+ New`, `Import`, and `Projects` already rendered in `Header.tsx` on desktop (`>=640px`). |
| **Storage Alert Banner** | `components/workspace/StorageAlertBanner.tsx` | Conditional storage persistence / quota warning banner | `Confirmed in source`: Appears inline below header when IndexedDB persistence warnings fire. |
| **Bottom Workspace Bar** | `components/WorkspaceBottomBar.tsx` | `Story / Image` mode toggle, `Generate Story / Image`, `Show Prompt & Output`, `Review Diff` trigger, status text | `Confirmed in source`: Uses Era 2 styling (`min-h-[32px]` / `min-h-[36px]`, `rounded-lg`, `bg-blue-600`, `text-gray-500`) inconsistent with `Header.tsx` (`min-h-11`). |

### 2.2 Primary Workspaces & Sub-Views

| Workspace | Source Component(s) | Sub-Views / Embedded Panels | Current Screen Geometry & Structure |
|---|---|---|---|
| **Write** | `components/manuscript/ManuscriptEditor.tsx`, `ManuscriptOutlineSidebar`, `ManuscriptHeaderBar`, `ManuscriptTextPane.tsx`, `SectionDetailFields`, `AdoptArtifactDialog` | Left outline sidebar (`15rem`, search + chapter/chronology filters + `+ Scene`/`+ Chapter`), central prose card (title, `Preview section` toggle, `<textarea>` or `<pre>`, metadata/split/delete fields), `Focus mode` toggle (`max-w-[82ch]`) | `Observed in preview`: Textarea measures `670×430px` at `1024×768` and `332×473px` at `390×844` (zero horizontal scroll). `Preview section` renders literal `<pre>` (`Confirmed in source` + `Observed in preview`). |
| **Plan** | `components/workspace/AdaptivePlanWorkspace.tsx`, `BeliefGraph.tsx`, `GraphToolbar.tsx`, `GraphCanvas.tsx`, `EgoMapView.tsx`, `FamilyKinshipView.tsx`, `RelationshipTableView.tsx`, `DecisionInboxPanel.tsx`, `ContextualInspector.tsx`, `PromptInput.tsx`, `OutputGallery.tsx` | **Plan Subheader** (`Inbox N`, `Context`, `Read output`, `Story Bible`, `Opportunities`, `More views → Timeline / Mind map`) + **Narrative Evidence Key bar** + **PromptInput** (`graphControls`) + **GraphToolbar** (Search, Category filter, `Focus`, `Highlight Links`, `Inferred`, `Group Guests`, `Excluded`, `Graph / Table / Ego Map / Family`) + **Left Decision Inbox** (collapsible) + **Center Graph Canvas & Output Drawer** + **Right Contextual Inspector** (collapsible, 7 tabs: `Inspector`, `Story Bible`, `Checks`, `History`, `Timeline`, `Ideas`, `Mind map`) | `Observed in preview` at `1440×900`: Actual graph `<svg>` is squeezed to **`978×371px` (`28%` of viewport area)**; 7 inspector tabs wrap onto **2 rows** (`29px` tall) inside a `398×561px` rail; **36 visible buttons** measure under `36px` tall. |
| **Review** | `components/workspace/NarrativeReview.tsx`, `DiagnosticsSection`, `SyncReviewSection`, `AutoAnalysisSettingsSection`, `EvidenceAuditSection` | Header jump links (`Plan Checks`, `Creative Opportunities`, `Revision History`, `Output Gallery`) + 4 stacked full-width sections: Scoped Diagnostics & Fix Alternatives, Manuscript ↔ Model Sync, Auto-Analysis Settings, Evidence & Audit Export | `Confirmed in source`: Vertical stack (`max-w-5xl space-y-6`); mixes editorial issue review, bidirectional sync, automation preferences, and forensic audit exports on one scroll page. |
| **Import** | `components/narrativeImport/ImportWorkflow.tsx`, `SourcePreviewSection.tsx`, `CandidateReviewSection.tsx` | 5-step horizontal pill stepper (`Choose source` → `Inspect source` → `Analyze source (optional)` → `Review candidates` → `Choose destination & commit`) over stacked vertical sections, checkpoint resume panel, Stage 2 enhancements, append/cross-project identity resolution | `Confirmed in source`: Rich domain safeguards (exact source retention, checkpoint resume, duplicate/identity checks), but entire multi-stage flow stacks vertically with raw hardcoded hex colors (`#fbfaf7`, `#62445e`). |
| **Projects** | `components/workspace/ProjectHub.tsx`, `ProjectLibrarySection`, `ExportAndArchiveSection`, `BrowserBackupsSection` | 3 sub-tabs: `Projects` (library & create), `Backup & export` (DOCX/TXT/Story Bible/Prompt/Audit/All-Projects archive + IndexedDB browser backups), `Revision history` (with fallback message if unconnected) | `Confirmed in source`: Uses fourth visual styling dialect (hardcoded `#fbfaf7`, `#e9dfe8`, `#62445e`, `dark:bg-purple-950`). |

### 2.3 Modals, Drawers & Overlays

| Overlay | Source Component | Purpose | Notable Behavior |
|---|---|---|---|
| **AI Settings Modal** | `components/workspace/AiSettingsModal.tsx` + `components/settings/AiConnectionsPanel.tsx` | Provider connections, manual `Refresh connections` & `Refresh models`, model preferences, operation overrides | `Confirmed in source`: Single scrolling modal stack; no tabbed IA; requires separate manual refresh triggers for connections and model discovery. |
| **Review Diff Modal** | `components/workspace/ReviewDiffModal.tsx` | Pending decision Before → After diff list, recent 5 revisions with Restore, before/after synthesized prompt `<pre>` comparison | `Confirmed in source`: Well-implemented focus trap and `Escape` handler (`ReviewDiffModal.tsx:60-92`), but duplicates revision history and uses hijacked `bg-blue-600` styling. |
| **Create Project Dialog** | `components/projects/CreateProjectDialog.tsx` | Create blank or premise-seeded project | `Confirmed in source`: Triggered from header `+ New`, nav `New`, or `ProjectHub`. |
| **About / Info Modal** | `components/InfoModal.tsx` | Application explanation and methodology overview | `Confirmed in source`: Hidden on viewports `<640px` because `Header.tsx` hides the `About` trigger. |
| **Native OS Confirm Dialogs** | `Header.tsx:93`, `ManuscriptEditor.tsx:278` | `Reset Sample Plan…` and `Discard unsaved draft` | `Confirmed in source`: Uses `window.confirm(...)`, breaking visual coherence and failing in restricted/sandboxed frames. |

---

## 3. Task-to-Screen Map (Where Authors Must Go Today)

| Author Task | Current Primary Location | Additional / Duplicate Locations | Fragmentation Assessment |
|---|---|---|---|
| Write or edit a scene | `Write` (`ManuscriptEditor`) | `Plan → Read output` (generated text must be adopted via `AdoptArtifactDialog`) | Moderate: AI generation lives in `Plan` / `BottomBar`, away from `Write`. |
| Preview formatted manuscript | `Write → Preview section` | None (renders raw `<pre>` text) | **Broken expectation:** No actual Markdown typography rendering. |
| Start a new project | `Header → + New` | `Workspace Nav → New`, `Projects → ProjectLibrarySection` | **3 duplicate entry points** with inconsistent mobile availability. |
| Import an existing story | `Header → Import` | `Workspace Nav → Import`, `Projects → Import` | **3 duplicate entry points**. |
| Explore characters & relationships | `Plan → Graph` (`Graph / Table / Ego Map / Family`) | `Plan → Context → Navigate entities & relationships`, `Plan → Mind map` | **3 overlapping lists/views**; narrow right rail silently truncates at 80 items. |
| Inspect / edit Story Bible | `Plan → Story Bible` button | `Plan → Right Rail → Story Bible tab`, `ReviewDiffModal → Open Story Bible` | Trapped inside a `398px` right rail; broken if `Context` rail is hidden (`UX-01`). |
| Explore creative opportunities | `Plan → Opportunities` button | `Plan → Right Rail → Ideas tab`, `Review → Creative Opportunities` button | **3 different names** (`Opportunities`, `Ideas`, `Creative Opportunities`) for one narrow-rail panel. |
| Check timeline & chronology | `Plan → More views → Timeline` | `Plan → Right Rail → Timeline tab`, `Write → Chronology filter` | Buried under `More views` AND trapped in narrow rail; sorts chronology notes alphabetically (`UX-06`). |
| Check continuity & fix issues | `Review → DiagnosticsSection` | `Plan → Right Rail → Checks tab`, `ReviewDiffModal` | Split between local checks in `Plan` and full diagnostics/sync in `Review`. |
| View revision history & undo | `Projects → Revision history` | `Plan → Right Rail → History tab`, `Review → Revision History`, `ReviewDiffModal` | **4 scattered entry points**; `ProjectHub` contains an unconnected fallback state (`ProjectHub.tsx:213-218`). |
| Configure AI & models | `Workspace Nav → AI settings` | Error prompts in `Review` / `Import` (non-interactive text links) | Modal-only; error banners tell authors to open AI Settings without a direct button. |
| Backup, export & archive | `Projects → Backup & export` | `Write → Export draft`, `Review → Export report (JSON/MD)` | Scattered across 3 workspaces without a unified Export/Backup mental model. |

---

## 4. Categorized Findings & Severity Register

Findings are grouped by root cause category (`Behavior`, `Information Architecture`, `Discoverability`, `Visual Design`, `Terminology`, `Accessibility`) and severity (`Critical`, `High`, `Medium`, `Low`).

### 4.1 Critical & High-Severity Findings

| ID | Category | Severity | Evidence & Location | Finding & Writer Impact | Root Cause |
|---|---|---|---|---|---|
| **UX-01** | Behavior | **Critical** | `Confirmed in source`: `AdaptivePlanWorkspace.tsx:100-103`; `Observed in preview` at `1440×900` (`beforeVisible: true → afterHideVisible: false → afterBibleClickVisible: false`) | **Silent Dead Buttons in Plan Subheader:** When a desktop author hides the `Context` inspector rail to get more graph space, clicking `Story Bible`, `Opportunities`, `More views → Timeline`, or `More views → Mind map` updates the tab state silently while keeping the entire inspector panel `xl:hidden`. Nothing appears on screen. | `openInspector()` calls `onOpenInspectorTab(tab)` and `onMobileTabChange('inspector')`, but omits `setShowInspector(true)`. |
| **UX-02** | Information Architecture / Visual Design | **Critical** | `Observed in preview` at `1440×900` (`svgRect: 978×371px`, `28%` of viewport area; `topHeaderH: 65px`, `planHeaderH: 66px`) + `Confirmed in source`: `AdaptivePlanWorkspace.tsx`, `GraphToolbar.tsx`, `WorkspaceBottomBar.tsx` | **Six Stacked Chrome Bars Starve the Narrative Map:** On a standard `1440×900` laptop display, the primary visual canvas receives only `371px` of vertical height (`41%` of height, `28%` of screen area). Six horizontal strips (`Header`, `Workspace Nav`, `Plan Subheader`, `Narrative Evidence Key`, `PromptInput`, `GraphToolbar`, plus `BottomBar`) consume `529px` of vertical space. | Incremental feature attachment onto a single Plan shell without consolidating navigation, toolbars, and legend chrome. |
| **UX-03** | Behavior / Editorial Experience | **Critical** | `Confirmed in source`: `ManuscriptTextPane.tsx:50-71`; `Observed in preview` (`rendersPreTag: true`, `fontFamily: Literata`) | **"Preview section" Does Not Render Markdown & Leaks Technical Copy into Prose:** Clicking `Preview section` displays raw unformatted Markdown syntax inside a `<pre>` element (`# Heading`, `**bold**` stay literal). Simultaneously, a permanent security note (`"Markdown remains literal source text; preview displays it safely without interpreting HTML."`) sits directly above the writer's prose cursor at all times. | Defensive XSS avoidance implemented via `<pre>` rather than a safe AST/sanitized Markdown renderer, paired with inline security disclaimer copy. |
| **UX-04** | Information Architecture | **High** | `Observed in preview` at `1440×900` (`inspectorRect: 398×561px`, `inspectorTabRows: 2`, `h: 29px`) + `Confirmed in source`: `ContextualInspector.tsx:166-218` | **Seven Heavy Workspaces Crammed into a `398px` Right Rail:** `Story Bible`, `Timeline`, `Creative Opportunities (Ideas)`, `Mind Map`, `Checks`, `History`, and `Entity Inspector` all live inside one narrow sidebar whose tabs wrap onto two `29px`-tall rows. Wide editorial tasks (comparing opportunities, reading timelines, editing a multi-domain Story Bible) feel claustrophobic. | `ContextualInspector` became the default receptacle for every new narrative feature instead of distinguishing lightweight selection inspection from full-canvas editorial workspaces. |
| **UX-05** | Accessibility / Responsive | **High** | `Confirmed in source`: `Header.tsx:85-88`; `Observed in preview` at `390×844` (`headerH: 117px`, hidden: `+ New, Import, Projects, About`) | **Mobile Header Drops Core Actions & Doubles in Height:** Below `640px`, `<header>` expands to `117px` while hiding `+ New`, `Import`, `Projects`, and `About` via `hidden sm:inline-flex` (with no overflow menu or mobile drawer in `<header>`), forcing narrow-screen authors to discover whether actions exist elsewhere (`About` becomes completely unreachable on mobile). | Responsive hiding applied directly to header action buttons without a responsive menu pattern. |
| **UX-06** | Behavior / Internationalization | **High** | `Confirmed in source`: `TimelinePanel.tsx:28-35` | **Chronology Sort Is Naive Alphabetical & English-Only:** `Story Chronology` sorts free-text chronology notes using `a.note.localeCompare(b.note)` (so `"Day 10"` precedes `"Day 2"` and `"Act 2"` precedes `"Act 10"` unpredictably), while flashback/uncertainty detection relies on hardcoded English regex (`/\b(flashback|earlier|...)\b/i`), failing silently for Turkish (`"geri dönüş"`, `"yıllar önce"`, `"belirsiz"`) and all other non-English manuscripts. | Free-text chronology string reused as both human label and sort key without structured ordering or multilingual/explicit markers. |
| **UX-07** | Visual Design / System Coherence | **High** | `Confirmed in source`: `index.css` (`--color-blue-600: #62445e`, `--color-gray-850: #1f2937`), `WorkspaceBottomBar.tsx`, `ProjectHub.tsx:126-143`, `ImportWorkflow.tsx:761,792`, `GraphToolbar.tsx:51-168` | **Four Conflicting Styling Dialects & Token Hijacking:** The codebase mixes (1) semantic `pcc-*` tokens, (2) Tailwind `blue-*` utility classes secretly remapped to plum hexes in `index.css` (causing cognitive whiplash for maintainers and inconsistent hover/dark pairs), (3) hardcoded hexes (`#fbfaf7`, `#25262a`, `#e9dfe8`, `#62445e`) in `ProjectHub`/`ImportWorkflow`, and (4) cold default Tailwind `gray-*/purple-*` classes in dark mode. | Multiple UI eras layered over time without consolidating onto one semantic token contract. |
| **UX-08** | Accessibility (Contrast & Focus) | **High** | `Confirmed in source`: `index.css` (`--color-gray-500: #827d83`, `--color-gray-400: #aaa5aa`), `WorkspaceBottomBar.tsx:86`, `ManuscriptEditor.tsx:48`, `GraphToolbar.tsx:78-167`; `Observed in preview` (`visibleButtonsUnder36px: 36`) | **Contrast, Focus-Visible & Touch-Target Failures:** (a) `#827d83` (`text-gray-500`) on `#f8f7f3` (`~3.85:1`) and `#aaa5aa` (`~2.27:1`) fall below WCAG AA `4.5:1` for normal text; (b) `ManuscriptEditor.tsx:48` strips `focus-visible:outline-none` on shared form inputs without supplying a visible focus ring; (c) `GraphToolbar.tsx` buttons lack `focus-visible:ring-*`; (d) **36 visible buttons** in `Plan` are under `36px` tall (`29px` inspector tabs, `24px` toolbar toggles). | Token remapping lowered neutral contrast; component-level focus and sizing primitives were never standardized. |
| **UX-09** | Behavior / Navigation | **High** | `Confirmed in source`: `App.tsx:175-185`, `Header.tsx:93`, `ManuscriptEditor.tsx:278` | **Hard Navigation Lock on Dirty Draft + Native `window.confirm` Popups:** Unsaved manuscript edits block switching workspaces (`allowNavigation` checks `draftDirtyRef.current`) instead of transparently preserving an auto-stashed working draft, while discarding a draft or resetting sample data invokes jarring native browser `window.confirm()` dialogs (which also break in sandboxed iframes). | Fear of silent data loss solved by blocking navigation rather than durable draft auto-preservation + custom non-blocking recovery. |
| **UX-10** | Discoverability / Terminology | **High** | `Confirmed in source`: `GraphToolbar.tsx:124` (`'Expand Guests' : 'Group Guests'`), `Header.tsx:77-79` (`Saved · r1`), `NarrativeReview.tsx:396` (`Revision #1`) | **Sample-Story Leakage & Database Jargon in Primary Chrome:** `"Group Guests"` is hardcoded into the global `GraphToolbar` for every project regardless of genre or cast. Primary chrome displays developer revision jargon (`Saved · r1`, `Revision #1`, `Stage 2`, `Snapshot`, `Epistemic`) without writer-friendly phrasing. | Sample-project affordance leaked into shared graph UI; internal engineering state labels surfaced verbatim. |

### 4.2 Medium-Severity Findings

| ID | Category | Severity | Evidence & Location | Finding & Writer Impact |
|---|---|---|---|---|
| **UX-11** | Terminology / IA | **Medium** | `Confirmed in source`: `AdaptivePlanWorkspace.tsx:134` (`Opportunities`), `ContextualInspector.tsx:172` (`Ideas`), `OpportunityCenter.tsx:49` (`Creative Opportunities`) | **Triplicate Naming for One Feature:** The exact same panel is called `Opportunities` in the Plan bar, `Ideas` in the Inspector tab, and `Creative Opportunities` inside the panel header — confusing returning authors and screenshots/guides. |
| **UX-12** | Visualization / Semantics | **Medium** | `Confirmed in source`: `MindMapPanel.tsx:54-184` | **"Mind Map" Is a Static 2-Column Card List:** Calling a static card grid of Story Bible fields and characters a "Mind Map" misleads authors expecting radial/spatial associative branching and duplicates `Story Bible`. |
| **UX-13** | Scalability / Data Integrity | **Medium** | `Confirmed in source`: `AdaptivePlanWorkspace.tsx:87, 97` (`.slice(0, 80)`) | **Silent 80-Item Truncation:** The collapsible entity/relationship navigator in `Plan` silently drops every entity or relationship past index 80 with zero `"Showing 80 of 142"` indicator, hiding characters in long novels. |
| **UX-14** | Information Architecture | **Medium** | `Confirmed in source`: `NarrativeReview.tsx:400-406`, `ProjectHub.tsx:210-221`, `ReviewDiffModal.tsx:237-265` | **Revision History Fragmented Across Four Places:** Authors find Revision History in `Projects`, `Plan → History`, `Review → Revision History` (which teleports to `Plan`), and `ReviewDiffModal` — yet `ProjectHub`'s tab contains an unconnected fallback note. |
| **UX-15** | Discoverability / Workflow | **Medium** | `Confirmed in source`: `NarrativeReview.tsx:224,283,347`, `AiConnectionsPanel.tsx:139` | **Dead-End AI Configuration Guidance & Manual Two-Step Refresh:** When AI is unconfigured, `Review` error banners say *"connect a provider in AI Settings"* as plain text without a direct action button. Inside `AI Settings`, authors must click separate manual `Refresh connections` and `Refresh models` triggers. |
| **UX-16** | Workflow / Layout | **Medium** | `Confirmed in source`: `ImportWorkflow.tsx:788-935`, `NarrativeReview.tsx:389-490` | **Long Vertical Scroll Walls Without Sticky Action Anchors:** Both `ImportWorkflow` (despite a 5-step header stepper) and `NarrativeReview` (4 stacked full-width sections) render all stages vertically in one long scroll column; authors lose sight of commit/cancel/progress controls while reviewing long candidate or issue lists. |
| **UX-17** | Visual Design / Duplication | **Medium** | `Confirmed in source`: `Header.tsx` vs. `App.tsx` Workspace Nav; `WorkspaceBottomBar.tsx` vs. `Plan` | **Duplicate Entry Points & Competing Primary Controls:** `+ New`, `Import`, and `Projects` appear twice in the top shell on desktop (`Observed in preview`). `WorkspaceBottomBar` duplicates Story/Image generation controls even when the author is in `Write`, `Review`, or `Projects`. |
| **UX-18** | Empty / Onboarding States | **Medium** | `Observed in preview` (`Nothing to preview yet.`, `No matching relationships.`) + `Confirmed in source`: `TimelinePanel.tsx:81-84`, `ReviewDiffModal.tsx:166-168` | **Passive Empty States Without Next-Step Guidance:** Empty panels mostly state what is absent (`"Nothing to preview yet."`, `"No matching entries."`) rather than guiding the author into the next concrete action (e.g., *"Add a scene"*, *"Paste a draft"*, *"Explore story questions"*). |

---

## 5. Stress Analysis Across Diverse Narrative Conditions

Evaluating the current UI strictly against non-sample realities (`Inferred` from `Confirmed in source` layout constraints and data limits; live large-novel rendering marked `Unverified`):

| Narrative Condition | Current Behavior & Failure Mode | Evidence Basis |
|---|---|---|
| **1. Empty / Blank Premise Project** | Opens into `Write` with an empty scene or `Plan` with an empty graph and an empty 14-slot chrome frame. No gentle bridge from a 2-sentence premise to exploratory questions or initial concept structure. | `Confirmed in source` (`ManuscriptEditor.tsx`, `AdaptivePlanWorkspace.tsx`); `Observed in preview` |
| **2. Short Story (1–3 scenes, <3,000 words)** | Chrome overhead overwhelms the story: 6 toolbars in `Plan` and 7 inspector tabs surround a tiny 4-node graph. `Write` works acceptably in `Focus mode`, except `Preview section` still shows raw `<pre>`. | `Observed in preview` (`svgRect: 28%` of viewport, `rendersPreTag: true`) |
| **3. Dense Narrative (50–120 characters, 150+ relationships)** | (a) Graph canvas at `978×371px` collapses into unreadable overlapping labels; (b) `AdaptivePlanWorkspace` navigator silently truncates at 80 entities and 80 relationships (`slice(0, 80)`); (c) `Group Guests` toggle offers zero domain-general clustering for non-sample casts. | `Confirmed in source` (`AdaptivePlanWorkspace.tsx:87,97`, `GraphToolbar.tsx:124`); `Observed in preview` (`371px` canvas height) |
| **4. Long-Form Novel (40+ chapters, 100+ scenes)** | (a) Left outline in `Write` (`15rem`) lists scenes flatly with dropdown filters but no collapsible chapter tree or jump-to-word-count pacing map; (b) `ImportWorkflow` vertical scroll becomes arduous across 20+ chunks and hundreds of candidate proposals without sticky batch controls or chunk jump navigation. | `Confirmed in source` (`ManuscriptEditor.tsx:219`, `ImportWorkflow.tsx:760-935`); `Unverified` at 100k+ words |
| **5. Multilingual Narratives (e.g., Turkish, Japanese, RTL/diacritics)** | (a) `TimelinePanel.tsx:28-29` flashback and uncertainty regexes are English-only; (b) IME composition guards (`isComposing` in `ManuscriptEditor.tsx:198,206,247,328-338`) are thoughtfully implemented — a **genuinely strong existing engineering asset** worth preserving; (c) `DM Sans` and `Literata` support Turkish diacritics (`ğ, ş, ı, İ, ö, ü, ç`), though RTL layout mirroring is not yet designed (`Unverified`). | `Confirmed in source` (`TimelinePanel.tsx:28-29`, `ManuscriptEditor.tsx:328-338`, `index.css`) |
| **6. Ambiguous / Unreliable-Narrator Fiction** | The underlying data model (`epistemicKind: 'belief' | 'reported' | 'interpretation' | 'ambiguous' | 'user-authored'`) is unusually strong, **but** the UI buries the distinction in tiny `10px` muted labels (`AdaptivePlanWorkspace.tsx:237,257`) and a static text-only `Narrative evidence key` strip (`lines 145-152`) rather than unmistakable visual encoding on the canvas and prose margins. | `Confirmed in source` (`AdaptivePlanWorkspace.tsx:33-53,145-163,237,257`) |

---

## 6. Confirmed Existing Strengths Worth Preserving

A fair, evidence-driven audit must distinguish genuine strengths from defects so future redesigns do not regress working guarantees:

1. **Strong Epistemic & Safety Foundations (`Confirmed in source`):** Explicit separation of canon vs. belief/reported/inferred/proposed items; non-destructive staging (`ReviewDiffModal`); exact source retention and checkpoint resumption in `ImportWorkflow`; stale-revision guards in `NarrativeReview` and `ContextualInspector`.
2. **IME Composition Protection (`Confirmed in source`):** `ManuscriptEditor.tsx` explicitly guards focus toggles, section switches, and splits during IME composition (`onCompositionStart`/`onCompositionEnd`) and restores selection/scroll cleanly via `useReturnSelection`.
3. **Reduced-Motion & Modal Focus-Trap Discipline (`Confirmed in source`):** `index.css:136-145` honors `prefers-reduced-motion: reduce`; `ReviewDiffModal.tsx:54-92` implements proper keyboard focus trapping and `Escape` dismissal; `ContextualInspector.tsx:176-185` supports `ArrowLeft`/`ArrowRight` roving tab navigation.
4. **Warm Self-Hosted Editorial Typography Foundation (`Confirmed in source`):** Bundling `DM Sans`, optical-sized `Literata`, and `JetBrains Mono` locally gives PCC a genuine literary starting point once raw `<pre>` previewing and token hijacking are repaired.

---

## 7. Cross-References & Checkpoint Status

- **Completed in this file:** Complete current-state inventory, task-to-screen map, 18 categorized evidence-labeled findings (`UX-01`–`UX-18`), 6-condition stress matrix, and preserved strengths inventory.
- **Next document:** [02 — Author Journeys and Task Models](./02-author-journeys-and-task-models.md) traces 12 end-to-end realistic author workflows (all 9 required journeys + 3 newly discovered missing journeys) against this baseline.
