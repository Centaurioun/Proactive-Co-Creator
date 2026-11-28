# PCC-UI-RESEARCH-01 — Independent UX, Information Architecture and Visual Design Discovery

Status: authorized research and documentation only. Not a UI implementation or a new feature implementation assignment.
Purpose: develop an independent, comprehensive vision for a genuinely usable, distinctive creative-writing application, covering the present product and its planned capabilities.

## 1. Mission

Act as an independent product design research team: senior UX researcher, information architect, interaction designer, editorial application designer, data visualization specialist, accessibility specialist and creative-writing practitioner. Challenge the application from the writer's point of view, not merely as a collection of implemented components. Explore how an author learns, understands, navigates, creates, edits, reviews, decides, recovers and resumes.

Invent better experiences. Consider changes to terminology, feature placement, visual hierarchy, controls, interaction models and the entire application structure. You may propose new UI-specific capabilities or even new product capabilities that an improved interface makes possible. Separate those proposals from already approved functionality. Do not assume the present component hierarchy is the desired information architecture. Do not merely restyle it or provide generic SaaS advice. The goal is a useful, intuitive and expressive creative tool.

This study is deliberately before final visual implementation, so its recommendations can inform the delivery roadmap while functional work continues. Do not interrupt or supersede an active implementation package. Final UX decisions and implementation will be separately authorized.

## 2. Independence and source discipline

Read this assignment first. Inspect current app source and actual available preview, using synthetic projects. Form your own first-pass observations, candidate organizing models and design directions before reviewing detailed earlier UX proposals. Record that initial design reasoning and evidence in the output directory before proceeding to coverage reconciliation. The neutral capability inventory below is the initial functional brief, not a prescribed layout or style.

The existing product repository already contains historical design decisions and product research. You may have seen them previously. Perfect blinding is therefore not possible. Do not seek other branches, newer owner design notes, unpublished mockups or another reviewer's latest UI recommendations. Do not ask for aesthetic preferences during this independent study; generate plausible alternatives, identify assumptions and leave choices open. Explicitly disclose prior exposure, and distinguish original ideas, historical ideas and current observations. If you must read a prior design document to clarify functionality, record what you read and why. Do not treat earlier screen placements, names, color choices or design proposals as mandatory for this study. Preserve approved author needs and safety constraints even when challenging their proposed presentation.

After initial independent concepts are written, reconcile functional coverage against:
- docs/implementation/pcc-product-evolution/PRODUCT-BLUEPRINT.md
- docs/implementation/pcc-product-evolution/DELIVERY-ROADMAP.md
- relevant currently assigned or completed work packages and actual source, if present.

Use prior documents to identify capabilities, constraints and implementation status, not as the visual answer. Distinguish implemented, in progress, planned, deferred, unverified and newly proposed features. Report the actual available revision or NO_GIT_HEAD and environment; do not assume current main equals a running preview. Do not alter previous research or execution instructions.

## 3. Neutral capability brief

PCC is a local-first visual creative partner for authors of short stories and complex long-form narratives. Its primary jobs are to turn a small premise into a creative world, understand existing manuscripts faithfully, discover new creative possibilities, and strengthen and revise an existing narrative. Creative discovery and development that preserves an existing story are distinct author intentions. The writer should remain in control and be able to return to prior work.

The current and planned capability families include the following. This is not a navigation tree or a list of required top-level screens. Choose how to organize and present them, including consolidation and contextual entry points.

| Capability family | Functional needs |
|---|---|
| Start and manage projects | New blank project, seed, sample, import, continue recent work, independent alternatives, project overview, history, recovery, exports, backups |
| Writing and reading | Chapter/scene structure, manuscript editing, exact source retention, formatted Markdown preview, reading, selected-text and cursor-based assistance, scene metadata, style guidance, generated story adoption |
| Narrative understanding | Entities, characters, attributes, relationships, established narrative facts vs beliefs/reports/inferences, story settings and rules, themes, plot, chronology, source evidence, story graph and multiple useful visual perspectives |
| Creative discovery | AI-led opportunities, directed and collaborative exploration, hidden connections, story seeds, mystery, foreshadowing, themes, surprising links, what-if scenarios |
| Iterative idea work | Per-item regeneration, refinement preserving an idea, suggested directions and additional directions, custom directions or concrete ideas, combine, edit, save, dismiss, multi-select, persistent exploration history and sessions |
| Question-led exploration | Optional adaptive AI interview, different questioning styles, custom answers, unanswered mysteries, branching choices, stop and preview anytime; source-grounded author questions about the story |
| Story development | Expand, continue, strengthen plot and pacing, deepen characters, improve scenes and dialogue/subtext, preserve author voice, compress, protect selected elements |
| Preferences and constraints | User-defined creative intensity, project/session creative preferences, explicit structural locks and semantic guidance, preserved elements and editable custom constraints |
| Review and changes | Consistency and continuity checks, scope-aware AI analysis, fixes, manuscript/model synchronization, source-linked findings, proposals, exact before/after, graph changes and uncertain impacts, edit, preview, explicit application, undo/revert, alternative project without automatic switching |
| Narrative intelligence | Structured and lexical local retrieval, optional local or remote embedding retrieval, coverage and source transparency, character knowledge and reader perspectives, narrative order vs event chronology, unresolved threads and qualitative tension |
| AI and storage configuration | Connections, models and reasoning, operation-specific availability, model discovery, optional embedding sources, usage/budgets, recovery and optional cloud backup, explicit consent and privacy; secondary image-generation capability remains |
| Long-running work | Truthful progress, cancellation, errors, partial results, preserved drafts, durable saves, restart/resume, no hidden inference or automatic acceptance |

Consider every existing feature discovered in the actual product even if omitted here. Include every approved planned capability in a final coverage ledger. Deferred/experimental ideas may be considered for future extensibility without claiming implementation or approval.

## 4. Boundaries and evidence

Create new Markdown research documents only inside docs/product-research/ui-01-independent-discovery/. Preserve this assignment unchanged. Do not modify product source, CSS, dependencies, lockfiles, existing documentation, configuration, tests, data, schemas, active work-package instructions or deployment. Do not use auto-fix, generate replacement app code, implement a prototype inside the product, or deploy. Conceptual ASCII wireframes, Mermaid diagrams, annotated layout descriptions, component sketches and design tokens inside Markdown are encouraged. If a safe existing image/sketch tool is actually available, optional static concept assets inside this directory only are allowed; no need to generate images, install tools or consume an external paid service. Label all concepts as proposed, not screenshots of implemented screens. No executable prototype artifact.

Inspect available preview without touching private manuscripts, credentials, user projects or production state. Use isolated synthetic states; if unavailable, limit yourself to read-only source or safe observations. No live personal provider calls, no cloud resource creation, no automated AI usage. Use already available synthetic or cached results and clearly marked illustrative data for populated, error and loading states. Any indispensable managed AI probe requires existing permission and bounded usage; otherwise describe a hypothetical state. No claim of user testing, accessibility conformance, external research, measurements or provider behavior without actual evidence.

For findings label observed in preview, confirmed in source, historical report, inferred, unverified, or proposal. Capture relevant route/component/symbol and reproduction or observation when possible. Distinguish behavior defects, discoverability, information architecture, visual design, content/terminology and accessibility. Evaluate root causes rather than only symptoms. If external reference tools are available, compare relevant patterns from contemporary writing tools, creative workspaces and visualization products, cite exact sources and dates; do not copy branding or pretend to have inspected unavailable products. External research is optional; internal evidence is required.

## 5. Comprehensive UX investigation

Audit all existing screens, overlays, panels, menus and major interaction paths. Use both first-time and returning author perspectives. Investigate how features are discovered, understood, invoked, configured, completed and revisited. Check how the layout behaves with empty, short, dense, long, multilingual and ambiguous narratives, not just the sample project.

Develop a current-state inventory and task-to-screen map. Identify duplicates, missing affordances, unclear terminology, navigation surprises, hidden features, wasted workspace, scrolling and resizing problems, competing controls, misplaced complex views, misleading or incomplete previews, unhelpful empty states, inaccessible actions and inconsistent design patterns. Include clear evidence and writer impact. Do not presume a problem just because the component is complex.

Walk through realistic end-to-end journeys:
- first launch, new premise, exploratory questions, story concept and manuscript creation;
- open/import an existing narrative, inspect source, explore structure, edit and analyze;
- write or revise a passage using contextual AI assistance and review its result;
- discover and develop an idea through multiple iterations, save it, leave and resume;
- investigate a character, event or relationship through narrative visualizations and author questions;
- strengthen a scene/chapter while preserving intentional story elements;
- review a continuity issue, examine evidence, compare fixes, apply or decline and undo;
- compare and save an alternative, then continue the original project;
- configure AI, understand available models and operations, optional search and backup, recover after a failed operation or unsaved draft.
Add missing journeys discovered from the capability inventory. For each show intended outcome, entry point, current friction/evidence, alternative interactions and success criteria. Compare number of meaningful steps and decisions qualitatively or with actual measured task traces; no fake usability statistics.

## 6. Divergent information architecture and interaction concepts

Develop at least three genuinely different coherent product-wide organizing models, not three color palettes of the same screen. Explore grouping by author intention, object/scene/context, task or workspace, and other arrangements you find appropriate. Alternatives may preserve or fundamentally replace current navigation; they may combine a simple everyday experience with advanced views, but must retain discoverability and functional reach. Explain when a user leaves or remains in a context, what stays visible, and how selection, draft, session and navigation state survive. Compare costs, advantages, possible confusion, scaling and accessibility.

Propose sitemap/navigation maps, capability-to-location mapping, meaningful names, primary actions and secondary actions. Investigate how the interface teaches unfamiliar concepts without requiring a manual: examples, descriptions, contextual help, progressive disclosure, first-use, search, command shortcuts and onboarding where useful. Do not rely solely on tooltips or hidden menus. Consider alternative approaches rather than mandating a wizard. Evaluate keyboard-first and pointer-based workflows, flexible panel sizing and large/small-screen layouts, native desktop and web constraints. Avoid unnecessary duplication and identify a single logical home for each operation with contextual shortcuts as appropriate.

Explore interaction models for AI as a partner: when to request help, how to communicate scope and direction, how to present options without crowding, distinguish new directions from concrete ideas, make editing and comparison clear, preserve alternatives, display safe approval boundaries and support uninterrupted work. Consider ways beyond current interface patterns. Keep unreviewed drafts distinct from applied narrative facts.

## 7. Visual design and creative data visualization

Propose at least three distinct visual design directions with a writer-specific rationale, not merely trendy colors. Evaluate editorial readability, focus, spaciousness, information density, clarity, emotional character and long-session comfort. Show representative desktop and constrained-width wireframes for each direction. Provide comparative evaluation and a recommended direction or hybrid, not a claim that the owner has selected one.

Develop a provisional design system: typography for manuscript vs interface, semantic hierarchy, light/dark themes, colors/tokens, spacing, control sizes, icons and labels, focus/hover/disabled/error/success, selection, borders, panels, dialog and navigation patterns, responsive behavior, keyboard and screen reader support, reduced motion, contrast and readable zoom. Include representative components and usage rules, with examples of good/bad application. Avoid blanket ornamental cards, gratuitous motion, tiny low-contrast text or visual complexity that reduces writing space. Do not sacrifice practical functionality for mockup beauty.

Give special attention to graph, mind map, timeline, relationship, epistemic knowledge and change/impact visualizations. Determine which represent different semantics and when a list/table or prose view is more appropriate. Show representative populated visual examples with labels, paths, selection, filtering, scale/zoom, uncertain vs established information, source linking and a coherent distinction between actual changes and speculative impacts. Consider large graphs, readable labels, isolated views and accessible nonvisual alternatives. Do not equate all relationships with causation or author order with chronology. Do not invent certainty for unknown chronology or knowledge.

Explore formatted writing and reading experiences, safe preview fidelity, long-form navigation, focus and editing; creative exploration and alternative histories; project overview and operational feedback; intelligible settings, provider availability and optional storage/retrieval. For all high-value concepts, show concrete screen states (empty, populated, pending, unavailable/error, success, recovery) and demonstrate where actions take the user. Do not use mock data as evidence that features work.

## 8. New opportunities and strategic prioritization

Go beyond the inventory. Invent UI affordances, visual interactions, workflows and creative features that neither the current design nor the functional brief anticipates. Identify which solve a concrete writer problem, what new capability would be required, alternatives, tradeoffs, feasibility, risks and validation. Be selective: no feature addition merely for novelty, and no removal of an approved capability without explaining how its underlying need is met and flagging an owner decision.

Compare functional-first vs UI-first vs staged information-architecture-plus-later-visual-overhaul strategies. Recommend when minimal usable structure should accompany implementation, when a genuine usability defect needs early correction, and what should wait for the full design-system redesign. Identify migration/rework risk and cross-package dependencies; do not automatically pause the active package. Preserve functional and data contracts, explicit provider permission, reliable local saves, honest progress, exact preview/apply/revert and independent alternative projects. Design should make these guarantees understandable, not hide or weaken them.

Prioritize findings and proposals with stable IDs, scope, evidence, author value, accessibility, dependencies, complexity/risk, candidate timing and future acceptance criteria. Offer alternatives and explain rejected or deferred directions. No ungrounded numerical scores. Identify which decisions need owner choice after the comparative UI study.

## 9. Six-Cycle Iterative Refinement

Use installed relevant Superpowers skills if available (brainstorming, systematic investigation, critical review, planning, verification); otherwise use equivalent techniques and report availability honestly. Research only. Conduct six substantive cycles:
1. Discover and frame: map user intents and actual screens; inspect representative states; record initial independent observations.
2. Investigate: trace interaction behavior and root causes, map journeys, identify evidence gaps and separate current/planned capability.
3. Diverge: develop distinct navigation, interaction and visual design alternatives and original ideas; preserve initial concepts before prior design reconciliation.
4. Challenge: evaluate writer tasks, accessibility, discoverability, scale, privacy, complexity, conflicts, loss of functionality and implementation impact; critique your own concepts.
5. Refine: improve promising directions into concrete layouts, states, examples, component rules and acceptance criteria; reconcile all approved functional coverage.
6. Integrate and verify: select a reasoned candidate or alternatives for later comparison, write a coherent research package and roadmap recommendations, document actual changes of mind and remaining uncertainties.

Do not merely produce six headings. Record meaningful iterations, rejected solutions and why, including shortcomings of your preferred design. Broad exploration is encouraged, but deliver useful synthesis.

## 10. Durable deliverables and completion

Write comprehensive English Markdown reports in the authorized directory. Suggested organization (choose filenames/structure if better):
- README.md: executive summary, research index, preferred direction(s) and decision agenda.
- 01-current-ui-ux-audit.md: inventory, findings, evidence and severity.
- 02-author-journeys-and-task-models.md: representative workflows and before/after maps.
- 03-independent-information-architecture.md: competing product-wide organizing concepts and coverage reconciliation.
- 04-interaction-patterns-and-feature-placement.md: detailed workflows, state models, progressive disclosure and naming.
- 05-visual-design-directions-and-design-system.md: distinct alternatives, concept wireframes, design rules and accessibility.
- 06-narrative-visualization-and-editor-experience.md: story visuals, writing/reading, comparison and creative experiences.
- 07-new-opportunities-and-prioritized-ui-roadmap.md: original ideas, dependencies, staged improvements and acceptance criteria.
- 08-six-cycle-review-and-coverage.md: actual refinements, evidence gaps, individual capability mapping, rejected alternatives and integrity checks.

No arbitrary length cap. Expand each important recommendation with actual examples, reasoning and counterexamples. Keep reports navigable and cross-linked; prioritize depth and actionable detail over repetition. Document findings progressively, including checkpoint status, completed sections and exact next unfinished investigation, so work survives timeout. Do not claim completion if substantive work is missing.

Before finishing, verify that all existing and planned functional families are covered, meaningful alternatives and representative wireframes exist, proposed new features are distinguished from approved capabilities, evidence is labeled, six cycles produced substantive refinement, files/links are valid, and only authorized new research documents/assets were created. Compare actual Git diff if available, otherwise documented pre/post workspace file inventory/hash excluding authorized outputs and explicitly listed transients. Report limitations rather than claim unsupported results.

Provide only a concise Turkish chat summary of the actual files, strongest findings, independent design directions, original ideas, important tradeoffs, limitations and completion status. Detailed work belongs in the files.

Stop after this independent UI research. Do not start comparative UI research, choose a final design on behalf of the owner, or implement anything.
