# Architecture and file ownership contract

This is the target map, not a claim that files already exist. Source inspected at main 0b34d01; inspect current main; PR2/3/6 are separate and not prerequisites. Existing root structure remains React/TS/Vite/Tailwind + Express/server + Gemini + Zod + IndexedDB/localStorage. Keep conventions; no wholesale src/ move or second state library. Names below are recommended stable boundaries; adjust to existing extracted modules if necessary, document actual path/interface map in phase handoff. New files only when they carry working responsibilities, not empty scaffolding. Reuse old public API adapters where feasible. 
```text
shared/
  types.ts                     existing domain contracts; compatible extensions
  schemas.ts                   existing validation; operation limits
  narrativeTypes.ts            versioned source/manuscript/claim/issue/patch contracts
  narrativeSchemas.ts          validate untrusted persistence, proposals, imports
lib/
  canonicalModel.ts            existing semantic mutation authority (extract focused pure functions)
  projectController.ts         existing transaction / ticket / save orchestration
  storageEngine.ts             existing durable authority, migrations, CAS, tombstones
  historyEngine.ts             existing undo/revision behavior, extend version refs
  consistencyChecker.ts        existing local checks
  promptBuilder.ts              confirmed context assembly
  narrative/
    manuscriptModel.ts         pure text/outline operations + lineage
    sourceRepository.ts        immutable sources/versions; adapter through durable authority
    evidenceRegistry.ts        verified spans, claims and projections
    issueRegistry.ts           lifecycle/dedupe/freshness
    changeAudit.ts             audit events/projections
    narrativeTransaction.ts    pure prepare/validate, delegate existing commit/save
    impactIndex.ts             bounded dependency projection/invalidation
    import/                   parser, segmentation, identity, proposal validation, assembly
    context/                  budgets, coverage, relevant context
    diagnostics/              semantic findings, fix and sync proposals
    projections/              relationship/mind/timeline views, overlay
    recovery/                 manifest, backup catalog, restore preview, export formatters
components/
  workspace/                  ProjectHub, WorkspaceNavigation, Write/Plan/Review layout
  manuscript/                 outline/editor/context, artifact adoption
  narrativeImport/            wizard/preview/review
  diagnostics/                issue detail, fixes, sync diff
  evidence/                   source viewer and audit view
  opportunities/              optional creative ideas
  visualization/              relationship, family, mind map, timeline
  recovery/                   backup/restore/export centers
  BeliefGraph.tsx             retain and share projections, accessible table
  ContextualInspector.tsx     extract relevant panels rather than expand monolith
  OutputGallery.tsx           preserve artifacts and add explicit adoption
  DecisionInboxPanel.tsx      existing decision workflows
  App.tsx                     composition, no new mega reducer
services/apiClient.ts          typed server request wrappers
server/
  routes.ts                   bounded validated routes, existing error handling
  aiService.ts                 existing generation semantics preserved
  narrative/                  extraction, diagnostic, fix, writing, opportunity AI contracts
tests/                        flat *.test.ts existing runner discovers; do not hide new tests
scripts/                      existing browser smoke and fixture harness + phased journeys
docs/implementation/narrative-workspace/
  handoff/                    phase-01.md ... phase-05.md (executor creates)
```
Ownership: client lib/components/services never import provider SDK or key; server owns AI and request schemas; pure domain helpers never perform I/O; only existing durable storage authority extended may commit; UI never writes IndexedDB directly; no new unsafe server file write path. No secrets in fixtures, logs or backups. Use dynamic imports/lazy views for heavy parser/editor/graph where measured beneficial; new dependencies individually justified pinned and lock generated via npm strict install, not install every latest. Avoid global base64 assets in localStorage. Target current supported browsers and active main runtime policy, handle unsupported external-folder API. Do not bypass lint/typecheck, remove tests or hide errors. 
   
## Shared contract — illustrative signatures to implement/adapt
Define concrete serializable validated types in Phase1, use stable names across phases. Do not paste as replacement for existing types. IDs nonempty typed strings generated deterministically where appropriate and persisted, reference validity checked per project. 
```ts
type VersionRef = { id: string; version: string; digest: string };
type EvidenceAnchor = {
  kind: 'original-source' | 'working-manuscript' | 'artifact' | 'canonical-field';
  projectId: string;
  record: VersionRef;
  blockId?: string;
  start?: number; // UTF-16 code units in immutable block text
  end?: number;   // exclusive
  excerpt?: string;
  fieldPath?: string; // validated canonical target for authored facts
};
type ClaimEvidence = {
  id: string; targetId: string; targetPath: string;
  anchors: EvidenceAnchor[];
  kind: 'explicit' | 'inferred' | 'belief' | 'reported' | 'ambiguous' | 'user-authored' | 'ai-suggested';
  approval: 'pending' | 'confirmed' | 'rejected';
  freshness: 'current' | 'needs-recheck' | 'historical';
  rationale: string; // concise public explanation
};
type IssueDisposition = 'open' | 'deferred' | 'needs-clarification' | 'proposed-fix' | 'resolved' | 'dismissed';
type NarrativeBase = { projectId: string; projectRevision: number; manuscriptVersion?: string };
type PatchPrecondition = { targetId: string; expectedDigest: string };
```
Issue also fingerprint/detector/severity/certainty/affected claim IDs/anchors/source scope/analysis run/version/disposition reason/times/resolution links. Audit event actor/time/action/before-after/target IDs/anchors/base+result version and reason; no append-only security claim beyond application semantics. Source original byte hash, parser version, text block hashes, chapter/paragraph only if real. Manuscript structure order arrays and stable blocks, revisions refer to immutable content, explicit split/merge lineage. Proposal has ID/base/preconditions/operations/sourceRefs/intent and validation; reject unknown kind/path/target, stale revision or digest, wrong project; no arbitrary eval or unrestricted JSON patch. 
Proposed pure API names: verifyEvidenceAnchor(anchor, record): boolean; applyManuscriptOperation(manuscript, operation): Result; prepareNarrativeTransaction(current, proposal): Result<PreparedChange>; commitPreparedChange delegates storage authority (async CAS, not two independent writes); mergeIssueFindings(previous, findings, runCoverage): registry; projectIssueOverlay(registry, visibleTargetIds): overlay; createBackupManifest(snapshotAndReferencedRecords): manifest; validateRestoreArchive(archive): Result<RestorePreview>. Exact Result types and signatures finalized in Phase1 task contract test; no later parallel duplicates.
  
## Transaction and migration invariants
1. Characterize existing migration/storage/undo/tickets/project lifecycle before changes; determine actual persistence stores/transaction scope, cache parity. Extend existing single writer, use atomic IDB transaction if feasible for commit records, source blobs, version pointers and audit. Else design journal with prepared/committed state, crash recovery and tested CAS, never two independent writes called atomic. Old project data read correctly, migration preserves all fields and refs, unknown future schemas reject/read-only, legacy files do not need fake manuscript source. Keep durable migration checkpoint and verify readback, rollback must not destroy edits made after migration; recovery path explicit. Do not mutate saved projects with unqualified prototype flags. If storage proof fails, preview-only draft using synthetic isolated data; don't enable writes/migration.
2. Stable text versions and source blobs outside repeated snapshots, pointers in project, audit and issue metadata versioned. Save dirty edits safely across navigation/switch/reload; account for IME composition; debounce grouping but no dropped last input. One logical accepted change increments project version and relevant manuscript version, atomically saves model/text/evidence/audit, undo/redo moves refs together, monotonic project revision; undo adds compensating audit event. Failed write retains retryable draft and old durable state, no false saved. No-op doesn't create revision. Restore copy remaps IDs consistently or uses project namespace with validated collision policy; source hashes may be shared only with correct ownership/refcount. Delete and tombstone prevent late result resurrection. Cross-tab same base conflicts surfaced, no last-writer loss.
3. Server AI response parsed via Zod, staged in draft not canonical; apply only explicit user approval and checked base/digest; run IDs + abort/retry budget, stale/late/cancel ignored. Validate exact quoted spans (UTF-16 start/end, same immutable source), unknown/unsupported claims pending or rejected, no model-generated proof. Manual graph changes may invalidate evidence but never rewrite source. Local checks automatic, semantic calls explicit. 
4. Export deterministic projections, sorted where order irrelevant but manuscript order preserved; safe filenames, truthful format/manifest, hashes checked at restore; ZIP extraction bounded/no traversal, no external URL fetch, no secrets. Browser storage quota/eviction and permission failures handled honestly.
5. Tests under existing runner; use synthetic fixtures including Turkish accents, surrogate pairs/combining marks, same name, cyclic relations, flashbacks, invalid references, long >8k, quota/CAS/late/cancel, invalid ZIP/DOCX. Test before/after for refactor; add failure tests before fixes. Unit/mock tests distinct from real browser and real model quality. 

## Active baseline override

Round 6 owner override (2026-11-24): Google AI Studio pulls main only. Use current working main, TypeScript 5.8.3 and existing Vite 6 toolchain. PR #3 and #6 intentionally DEFERRED until after Studio development and separate owner authorization. PR #2 and #1 remain untouched, not prerequisites. No TypeScript/Vite upgrades, dual compiler scripts, or deferred PR cherry-picks during phases. Feature-specific dependencies only if necessary, compatible and verified. Hosted compatibility of deferred upgrades is untested; current preview works per owner.
This supersedes any earlier integration-first/dual compiler instructions. Use existing main scripts; see 00-technical-preflight.md.
