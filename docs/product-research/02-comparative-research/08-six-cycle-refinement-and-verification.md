# 08 — Six-Cycle Refinement History, Limitations & Boundary Verification

**Assignment:** `PCC-RESEARCH-02` (Sections 4 and 9)  
**Parent Index:** [`README.md`](./README.md)  
**Cross-References:** [`01-comparative-coverage-and-traceability.md`](./01-comparative-coverage-and-traceability.md) · [`02-functional-reassessment-and-trust.md`](./02-functional-reassessment-and-trust.md) · [`03-product-architecture-and-ux-alternatives.md`](./03-product-architecture-and-ux-alternatives.md) · [`04-creative-collaboration-and-proposal-lifecycle.md`](./04-creative-collaboration-and-proposal-lifecycle.md) · [`05-narrative-intelligence-and-visual-design.md`](./05-narrative-intelligence-and-visual-design.md) · [`06-integrated-creative-capability-portfolio.md`](./06-integrated-creative-capability-portfolio.md) · [`07-recommended-evolution-roadmap-and-owner-decisions.md`](./07-recommended-evolution-roadmap-and-owner-decisions.md)

---

## 1. Six-Cycle Iterative Refinement Record (Actual Changes of Mind & Pivots)

Per Assignment §4, this record documents **how our thinking genuinely changed** across all six cycles—including where we **corrected `PCC-RESEARCH-01`**, where we **challenged and refined `owner-brainstorming-2026-11-28.md`**, and where **new synthesis ideas emerged**.

### Cycle 1 — Read, Reconstruct and Map
- **Actions:** Read `owner-brainstorming-2026-11-28.md` (all 13 sections, `CE-01`–`CE-11`) alongside all 8 documents of `docs/product-research/01-independent-discovery/` (`F-01`–`F-15`, `C-01`–`C-08`, `R-01`–`R-20`). Decomposed every grouped `CE` section into **90+ distinct sub-capabilities** (`CE-01.1` through `CE-11.2`) in [`01-comparative-coverage-and-traceability.md`](./01-comparative-coverage-and-traceability.md).
- **Key Realization:** `PCC-RESEARCH-01` excelled at **empirical defect diagnosis, long-form scaling limits, chrome bloat, and epistemic lenses**, but had **major creative blind spots** that the owner register illuminated: (1) zero concept of *durable exploration sessions, per-card regeneration lineage, custom-input split, or Idea Library* (`CE-02`/`CE-03`), (2) zero distinction between *discovering new ideas* (`Creative Studio`) vs. *expanding/strengthening an existing draft without changing its plot* (`Story Development` + `Preservation Policy`, `CE-01.8`), (3) zero *source-grounded `Story Q&A`* (`CE-11.1`), and (4) zero *positive protection invariants* (`Creative Locks`, `CE-06.5` — PCC only protected *exclusions*). Conversely, the owner register listed 35+ compelling capabilities without yet confronting PCC's live backend failures (`F-02`, `F-03`, `F-04`), long-form prefix slicing (`F-05`), or the danger of feature/tab sprawl.

### Cycle 2 — Compare and Investigate (Critical Source Re-Verification)
- **Actions:** Directly re-inspected `server/aiService.ts`, `server/retry.ts`, `server/errors.ts`, `server/narrative/extractionService.ts`, `server/providers/geminiAdapter.ts`, `server/providers/runtime.ts`, `server/providers/chatgptResponses.ts`, `server/routes.ts`, `shared/schemas.ts`, `lib/nlBatchEngine.ts`, and `lib/nlBatch/operationValidation.ts` to stress-test `PCC-RESEARCH-01`'s causal claims (Assignment §6.6).
- **Major Self-Corrections Made to `PCC-RESEARCH-01`:**
  1. **Found the real `499 CANCELLED` timeout bug (`F-02`):** `PCC-RESEARCH-01` blamed `classifyWithSignal` in `aiService.ts`. Re-inspecting `server/retry.ts:20, 25, 83, 89, 95` proved **`withRetry()` itself unconditionally overwrites `signal.reason` with `AppApiError('CANCELLED', 499, false)`** across all 6 `aiService.ts` routes! Also downgraded "thinking budget caused 60s timeout" from confirmed cause to **Confirmed Code Omission + Strong Hypothesis** needing live A/B timing proof.
  2. **Corrected `F-03` (`batch-edit` missing `nextValue`):** `lib/nlBatch/operationValidation.ts:349-358` already blocks missing `nextValue` with `INVALID_VALUE`! Canon was never silently corrupted—the real defect is a server emission bug (`HTTP 200` with incomplete op) creating a dead-end client validation failure.
  3. **Disentangled `F-04` (`import/extract`):** Separated the redacted live `502 MODEL_UNSUPPORTED` (upstream cause still unconfirmed due to `geminiAdapter.ts:163-195` redaction) from the 3 source-confirmed structural defects (LLM UTF-16 offsets, `2048` cap, missing fence strip).
  4. **Separated `F-05` Policy vs. Bugs:** Preserved legitimate conservative input budgets while isolating the 3 actual defects (silent omission, broken `changed` scope, stripped `belief`/`reported`).

### Cycle 3 — Diverge (New Combinations Beyond Either Stream)
- **Actions:** Refused to merely pick Stream 1's 2-surface IA OR the Owner's 5-tab IA, and refused to merely merge two feature checklists.
- **Breakthroughs Created:**
  - Invented the **Hybrid "Calm Studio Shell"** (`03 §3`) separating **1 shared internal Narrative Core** from **5 calm spacious intent surfaces** (`Write`, `World`, `Studio`, `Develop`, `Review`) bridged by a lightweight passive `Write` Scene Margin and 1-click scoped handoffs.
  - Invented the **3-Tier Exploration Ladder** (`Session Draft → Saved Idea Branch → Independent Alternative Project`, `04 §5`) reconciling Stream 1's anti-Git stance with the Owner's durable branching & Multiverse needs.
  - Discovered **6 genuinely new synthesis concepts (`S-01`–`S-06`)** present in neither stream: *Lock & Constraint Conflict Preflight* (`S-01`), *Scene-Level Subtext & Belief-Clash Detector* (`S-02`), *Progressive Disclosure "Calm / Deep" Studio Dial* (`S-03`), *Story Q&A → Scoped Studio Bridge* (`S-04`), *Narrative Compression & Redundancy Lens* (`S-05`), and *Unified Patch-to-Visual Diff Projector* (`S-06`).

### Cycle 4 — Challenge (Attacking Both Streams and Our Own Ideas)
- **Where We Challenged Stream 1 (`01-independent-discovery`):**
  - *Challenged `R-12` (Pure 2-Surface + Deep Margin):* Proved via Layout A (`03 §3`) that a 360px side margin physically cramps multi-card comparison, direction rails, and Visual Change Maps—validating the owner's `CE-01` concern.
  - *Challenged `C-04` (Single Ephemeral Sandbox Only):* Too weak for novelists testing multi-chapter forks; upgraded to the 3-tier ladder + Alternative Projects.
  - *Challenged `C-05` (Seed-Only Interview):* Too narrow; generalized into the 4-mode voluntary `Grill Me` engine usable at inception OR any mid-manuscript scope.
  - *Challenged `C-07` (Near-Automatic Background Import Mapping):* Tightened to **explicit opt-in AI consent** after instant 0-AI text ingestion (`02 §4.1`).
- **Where We Challenged the Owner Register (`owner-brainstorming-2026-11-28.md`):**
  - *Challenged Feature & Screen Sprawl (`CE-01.8`, `CE-07`):* Implementing 9 Story Development modes + 25 `CE-07` capabilities as separate screens would recreate PCC's chrome overload. Consolidated cleanly into **5 Development lenses** and **8 cohesive creative workflows** over 3 shared engines—retaining every underlying writer need while flagging exact UI consolidation for owner confirmation.
  - *Challenged Free-Text Lock Enforceability (`CE-06.5`):* Unstructured prose constraints (*"keep it scientifically plausible"*) cannot be deterministically enforced; designed an honest **Two-Tier Lock System** (Hard Structural deterministic vs. Soft Semantic AI-checked + optional target grounding).
  - *Challenged Naming (`Idea Marketplace`, `CE-07.22`):* Renamed to **`Idea Library`** because "Marketplace" implies commerce/external sharing.
  - *Challenged Stateful `teach` Curriculum (`CE-09.4`) & Early `to-questionnaire` (`CE-09.2`):* Simplified `teach` into optional inline `Craft Note` tooltips and deferred async questionnaires and `Character Interview` roleplay to preserve core writing focus.
  - *Challenged Premature OpenAI Structured Outputs Assumption:* Flagged SIWC vs. OpenAI Responses API `text.format` compatibility as requiring external/live verification before implementation (`02 §5`).

### Cycle 5 — Refine and Make Actionable
- **Actions:** Grounded every major recommendation in concrete *Port Marrow* synthetic walkthroughs (stopped watch `03:17` + Ch. 7 radio signal full card lifecycle in `04 §1.3`; 20-chapter novel Ch. 18 contradiction recovery in `05 §1.3`; Nadia POV knowledge leak & `S-02` belief clash in `05 §2.2`; verbatim `Story Q&A` + `S-04` bridge in `05 §2.4`; Reverse Twist foreshadowing in `06 §2.2`), explicit TypeScript contracts (`CreativeSession`, `NarrativeMemoryIndex`, `TemporalKnowledgeEvent`), ASCII wireframes (`03 §3`, `04 §4.1`, `05 §3`), and deterministic test criteria.

### Cycle 6 — Integrate and Review
- **Actions:** Reconciled all streams into 4 competing strategies (`07 §1`), 4 shared architectural enablers (`07 §2`), a 5-stage outcome-based vertical-slice roadmap (`07 §3`) that ships real creative joy early without postponing everything behind a big rewrite, and an 8-item **Owner Decision Agenda (`OD-01`–`OD-08`)**. Verified full item-level traceability, zero broken cross-references, and strict workspace immutability (§4 below).

---

## 2. Methodology, Source Identifiers & Limitations Disclosure

1. **Source Identifiers Recorded (Assignment §2):**
   - Independent Discovery Package (`docs/product-research/01-independent-discovery/`): delivered at reference commit `eb526125255d2740a6fc3d8d9a3c6c798749232e` *(source identifier provided in assignment brief)*.
   - Owner Brainstorming Register (`docs/product-research/owner-brainstorming-2026-11-28.md`): preserved at reference commit `8b05f926754c3b8bda52a9bd458a88428c515231` *(source identifier provided in assignment brief)*.
   - **Sandbox Git Revision:** No `.git` directory exists in `/app/applet` (`NO_GIT_HEAD` / `NO_GIT_STATUS`). These commit SHAs are recorded as provenance identifiers only, not proven local Git HEADs. Workspace integrity is verified via full-tree SHA-256 checksums instead (§4).
2. **Skills & Reasoning Methods (Assignment §4):**
   - Superpowers skills (`brainstorming`, `systematic-debugging`, `receiving-code-review`, `writing-plans`, `verification-before-completion`) are **not installed** in this runtime environment. Equivalent structured multidisciplinary research, root-cause source verification, adversarial critique, and verification-before-completion discipline were applied directly without claiming unavailable skill invocations.
3. **Runtime & Verification Limitations (Assignment §3, §6.6, §9):**
   - No new live AI probes were executed in `PCC-RESEARCH-02` to avoid redundant provider consumption (Assignment §3: *"do not repeat the previous audit indiscriminately"*); all live observations cited come transparently from the `2026-11-28` bounded managed-Gemini run recorded in `PCC-RESEARCH-01`, freshly cross-checked against current source files.
   - **Remains Unverified Live:** Personal/external providers (`gemini-personal`, `chatgpt-plan`, `openai-api`), OpenAI SIWC vs. Responses API native `text.format` compatibility for future-dated slugs, raw upstream Gemini error behind `import/extract` `502 MODEL_UNSUPPORTED`, controlled `ThinkingLevel.LOW` A/B latency test on `generateStoryText`, live `generate/images`, live `opportunities/explore` body (prior `503`), malformed `.docx`/`.pdf` stress fixtures, and native desktop packaging.

---

## 3. Complete Item-Level Coverage Verification Tally

| Source Stream | Total Items / Sub-Items | Mapped in `01` Crosswalk | Covered in Deep-Dive Docs (`02`–`07`) | Untracked / Hidden Items |
|---|---|---|---|---|
| **Independent Findings (`F-01`–`F-15`)** | 15 | 15 / 15 (`01 §2`) | `02` (reassessed all 15 against source) | **0** |
| **Independent Concepts (`C-01`–`C-08`)** | 8 | 8 / 8 (`01 §3`) | `03`, `04`, `05`, `06` | **0** |
| **Independent Recommendations (`R-01`–`R-20`)** | 20 | 20 / 20 (`01 §3`) | `02`, `07` | **0** |
| **Owner Register (`CE-01`–`CE-11` unpacked)** | 11 groups → **84 explicit sub-IDs** (`CE-01.1`–`CE-11.2`) | 84 / 84 (`01 §4.1–§4.9`) | `03`, `04`, `05`, `06`, `07` | **0** |
| **New Synthesis Proposals (`S-01`–`S-06`)** | 6 | 6 / 6 (`01 §5.2`) | `03`, `04`, `05`, `06`, `07` | **0** |

---

## 4. Final Boundary & Workspace Integrity Verification (Assignment §9)

1. **Full Item-Level Coverage Across Both Streams:** **PASS** (§3 above — **133** mapped items/sub-items, zero group-level checkmarks hiding unexamined ideas).
2. **Explicit Owner Requirements Preserved or Flagged for Decision:** **PASS** — Separate spacious `Creative Studio` vs. `Story Development` (`03 §3`, `OD-01`), full card actions including custom-input `Suggest Directions` vs. `Generate Idea` (`04 §1`), durable autosaved sessions (`04 §2`), strict **no auto-switch** after `Save as Alternative Project` with `Continue Current Project` default + `Open Alternative` (`04 §5.2`), deterministic patch-derived Change Map (`04 §4.2`), repeatable free-text `Creative Locks` (`05 §5.4`), voluntary scoped `Grill Me` (`04 §6`), and approved user-facing name **`Story Q&A`** (`05 §2.4`).
3. **Major Disagreements, Alternatives & New Proposals Addressed:** **PASS** — 5 major cross-stream disagreements explicitly reconciled (`01 §5.1`), 3+ competing IA & evolution strategies compared (`03 §2`, `07 §1`), 6 original synthesis concepts (`S-01`–`S-06`) introduced (`06 §3`), and 8 explicit Owner Decisions (`OD-01`–`OD-08`) surfaced (`07 §4`).
4. **Evidence & Limitations Transparent:** **PASS** — Distinct evidence tags across all files, 4 explicit self-corrections to `PCC-RESEARCH-01` (`02 §1`), and explicit unverified boundary list (§2 above & `02 §5`).
5. **Roadmap Internally Coherent:** **PASS** — Dependencies (`E0 → E1/E2 → Stages 0–4`), exit criteria, and regression boundaries verified across `07 §2–§3`.
6. **Files Readable & Zero Broken Relative Links:** **PASS** — Verified programmatically across all 9 Markdown files in `docs/product-research/02-comparative-research/` after writing `README.md`.
7. **Strict Workspace Immutability (Only New Markdown Files in `docs/product-research/02-comparative-research/`):** **PASS (SHA-256 Verified):**
   - Pre-research workspace SHA-256 (all files excluding `node_modules/`, `dist/`, and `docs/product-research/02-comparative-research/`): `265896998ae9f928fc79a45e3eb3b8c084b86e4f135501666f0b90b9e6dfcf79`.
   - `docs/product-research/02-comparative-research/RESEARCH-ASSIGNMENT.md` SHA-256: `582303548be4af732918f8e264755fea9c1a9f8281b8aad6f9491a3e6de5f68f` (unchanged).
   - `docs/product-research/owner-brainstorming-2026-11-28.md` SHA-256: `c118c730dbf21f6053c20f841fb878487b72623a18dae2de5a1e2c30cf85feb0` (unchanged).
   - Entire `docs/product-research/01-independent-discovery/` directory included inside the unchanged workspace hash above.
   - Zero application code, tests, dependencies, configs, schemas, builds, or deployments touched.
