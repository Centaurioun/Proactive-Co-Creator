# PCC — Master Code Improvement Report
2026-11-26 | Proposal for owner review; not implementation authorization.
Audited commit d5205d5095d987db925439722fe5504cdbe245bc; tree 3308d52499a81c644e3808567350269269cf96be. Repository Centaurioun/Proactive-Co-Creator. CodeScene project 88207 job 8615852, 26 Nov 16:06 GMT+3.

## 1. Karar ve kapsam
PCC'nin mevcut React/TypeScript/Vite/Node/Express, IndexedDB authoritative/localStorage cache mimarisini koru. PR17–19 birleşti; main kaynak ağacı son kabul edilen adayla eşit. Main CI [45825413392](https://github.com/Centaurioun/Proactive-Co-Creator/actions/runs/45825413392) başarılı. Önceki exact-head CI [45821665862](https://github.com/Centaurioun/Proactive-Co-Creator/actions/runs/45821665862) 4/4. Codex önce 437 unit, sonra 30 hedefli test bildirdi; burada tekrar çalıştırılmadı. #10 geçmişte zaten mevcut; #9 eski handoff, #13 görsel optimizasyonu kapalı. #2 önceki canonical refactoring, #3 dependency, #6 TS7 deneyi açık. Toplu merge etme. Codex yalnızca repo eşitlemesi yapacak. Antigravity mevcut kodun doğruluk, güvenlik, verimlilik, bakım, modülerlik ve test kalitesini geliştirecek. Yeni ürün özelliği, görsel/UI tasarımı, teknoloji göçü, canlı inference, deployment yok. Çalışan 127.0.0.1:4311 ve kullanıcı verileri korunacak. Tüm doğrulamalar izole sentetik ortamda.
Öneri: tek program, birbirinden ayrılmış kilometre taşları, münhasır dosya sahipliği ve tek integrator. Skor uğruna dosya bölme yok. Büyük yeniden yazım ve onlarca mikro onay yerine bağımlılıkları kontrollü paralellik. Gerçek hata için reproducer; refactoring için davranış karakterizasyonu; performans için ölçüm.

## 2. Kaynak ve sınırlar
[Dashboard](https://codescene.io/projects/88207/jobs/8615852/results), [hotspots](https://codescene.io/projects/88207/jobs/8615852/results/code/biomarkers), [system map](https://codescene.io/projects/88207/jobs/8615852/results/code/technical-debt/system-map#codehealth), [targets](https://codescene.io/projects/88207/jobs/8615852/results/code/technical-debt/system-map#refactoring-target-type), [coupling](https://codescene.io/projects/88207/jobs/8615852/results/code/temporal-coupling/by-commits). 19 açık sekme okundu: dashboard, hotspot listesi, iki map, coupling ve 14 X-Ray. Ham metin kanıtı codescene-evidence-01.md ve -02.md. Görsel marker renkleri/konumları, kesin analiz SHA, 3 önerilen hedefin ve 24 etkilenen dosyanın kimlikleri metinde görünmüyor. Görünen App.tsx, server.ts, nlBatchEngine.ts, storageEngine.ts, consistencyChecker.ts etiketleri hedef olduklarını kanıtlamaz. Scope/sha kickoff'ta doğrulanmalı. Architecture components tanımlanmamış, PR checks 0, coverage/delivery/team verisi yok. Coupling birlikte değişme göstergesi, nedensellik veya bug kanıtı değil. Test/implementation coupling faydalı olabilir.
Repo tree envanteri ve hedefli kaynak okuması yapıldı; tüm dosyaların satır satır audit'i, local test, dinamik profil, coverage, secret/dependency scan yapılmadı. W6 tam envanteri tamamlayacak. Bulguların statik veya hipotez statüsünü koru. X-Ray tamsayı sağlık gösterimi ile ondalık hotspot skoru aynı çözünürlükte değil. CodeScene LoC ile fiziksel satır farklı. Resmi yöntem: https://codescene.io/docs/guides/technical/code-health.html ve https://codescene.io/docs/guides/technical/prioritize-technical-debt.html.

## 3. Ölçümler
| Metric | 24 Nov job 8567730 (historical audit) | 26 Nov job 8615852 | Delta |
|---|---:|---:|---:|
| LoC | 22,200 | 51,054 | +28,854 |
| Map files | 53 | 197 | +144 |
| Hotspot health | 5.2 | 6.2 | +1.0 |
| Average rounded | 6.2 | 7.2 | +1.0 |
| System health | 6.25 | 7.24 | +0.99 |
| Red | 29% | 14% | -15 pp |
| Yellow | 51.2% | 57.7% | +6.5 pp |
| Green | 19.8% | 28.3% | +8.5 pp |
| Hotspot share | 37.7% | 8.6% | -29.1 pp |
| Effort in hotspots | 63% | 33.1% | -29.9 pp |
| Coupled entities by commits | 4 | 28 | +24 |
Scope değişti: bu farkları doğrudan iyileşme sayma. Hotspot'lar %8.6 iken efor %33.1 (yaklaşık 3.85 kat). 3 refactoring hedefi, 24 impacted files; across commits 3, between repos 0; exact pairs unavailable. Önceki rapor: https://github.com/Centaurioun/Proactive-Co-Creator/blob/4b9da6eb60f74e67f331ec233a92f8281f25f23c/docs/modernization/2026-11-24-codescene-technical-debt-audit.md . canonicalModel 1.84 eski skor; güncel listede yok, şu anki skor bilinmiyor.

## 4. 17/17 hotspot
P0/P1/P2/P3 önerilen mühendislik öncelikleri, CodeScene kategorisi değil. P0 veri/otorite, P1 yüksek kaldıraç, P2 sonraki, P3 koru/izle.
| ID | Path | LoC | commits | score | Issues | Work |
|---|---|---:|---:|---:|---|---|
| CS01 | App.tsx | 2681 | 33 | 3.87 | modularity, bumpy road, many conditionals, complex method | W4 P1 |
| CS02 | lib/storageEngine.ts | 742 | 18 | 4.66 | deep nested complexity, bumpy road, conditionals, complex method | W2 P0 |
| CS03 | components/narrativeImport/ImportWorkflow.tsx | 1269 | 18 | 5.41 | bumpy road, complex method/conditional | W3 P1 |
| CS04 | components/manuscript/ManuscriptEditor.tsx | 487 | 11 | 6.04 | bumpy road, complex method/conditional | W5 P1 |
| CS05 | components/settings/AiConnectionsPanel.tsx | 638 | 10 | 6.71 | bumpy road, complex method/conditional | W1 P1 |
| CS06 | tests/storageLifecycle.test.ts | 1628 | 9 | 6.88 | file size, complex/large method, conditional | W2 P2 |
| CS07 | lib/projectController.ts | 397 | 12 | 6.91 | bumpy road, complex method/conditional | W2 P0 |
| CS08 | services/apiClient.ts | 416 | 9 | 7.16 | bumpy road, complex method/conditional | W1 P1 |
| CS09 | lib/historyEngine.ts | 455 | 7 | 7.33 | complex method/conditional, duplication, args | W2 P1 |
| CS10 | components/OutputGallery.tsx | 504 | 7 | 7.67 | complex/large method | W5 P2 |
| CS11 | server/routes.ts | 610 | 10 | 7.68 | complexity, duplicated blocks, large method | W1 P1 |
| CS12 | components/ContextualInspector.tsx | 323 | 12 | 7.95 | complex/large method, primitive obsession | W5 P2 |
| CS13 | components/BeliefGraph.tsx | 238 | 10 | 8.98 | complex/large method | W5 P3 |
| CS14 | tests/routes.test.ts | 488 | 10 | 9.56 | large method, otherwise healthy | W1 P3 |
| CS15 | shared/narrativeSchemas.ts | 204 | 8 | 10 | low complexity | preserve |
| CS16 | server/narrative/extractionService.ts | 155 | 8 | 10 | low complexity | preserve |
| CS17 | shared/types.ts | — | 9 | N/A | no functions/methods, not zero health | W0 shared owner |

## 5. 14 X-Ray: hedefli teknik öneriler
Format: değişim/LoC/complexity. Tablolar evidence dosyalarında. CS15–17 için ayrı X-Ray açık değildi.
- App top-level 35/746; handlePreviewBatchInstruction 14/79/12, handlePolishPromptWithAi 14/56/10, handleImportProjectJson 13/62/26, handleCreateNewProject 12/94/14, saveManuscript 8/29/22, handleAppendToExistingProject 3/59/22, handleCreateImportedProject 3/42/22, handleKeyDown 2/27/13. Preview/polish coupling 92% (14 avg revisions), create/reset 90% (11), create/import JSON 88% (13). App L737–1099 narrative commit/recovery, L1462–1919 AI, L1923–2346 lifecycle. Mevcut aiTicketCoordinator, useProjectPersistence, projectListSync, reviewDiffModel ve workspace helper'larını tekrar kullan. Lifecycle, AI action ve import/export komutlarını ayrıştır, tek authority, mevcut ref/hook sırası, stale fence, navigation ve deletion.
- Storage: reloadLatestProjectsFromStorage 6/189/53, loadProjectsFromLocalStorage 8/84/24, saveProjectToLocalStorage 3/84/23, deleteProjectCompletely 5/63/13, persistProjectDurably 3/76/14. L672–860 plan, conflict result, revision write, cache sync iç içe. Mevcut hydrationReconciliation, cacheParity, casPolicy, indexedDbOperations, localProjectCache, migration üzerine kur. Pure planning/transaction/result mapping; CAS transaction dışına çıkarılmaz, read_error/unavailable/empty farklı, tombstone/cache parity korunur.
- Import: startAnalysis 9/207/78, refreshPlanContext 3/46/32, previewSource 7/45/18, restoreSavedCheckpoint 2/75/16, commitImport 1/33/15; top-level 18/924. L194,436,512–719,720,779. Plan validation, durable attempt/lease, provider/result verification, UI adapter. 12-call ceiling, exact source/plan/credential authority, partial coverage.
- ManuscriptEditor 10/448/127, resolveReturnSelection 0/17/9. Seçim/navigation, edit commands ve save adapter; mevcut manuscriptModel, selectionHelpers. Caret/focus/IME, dirty state, exact-base, explicit adoption.
- AiConnectionsPanel top-level 8/66/21, changeDefaultConnection 4/24/14, refreshModels 3/27/13, selectOverrideModel 2/19/22, changeOverride 1/24/13. Save/remove key duplication. Pure preference validation, execution-generation isolation, no secret persistence, no silent substitution.
- Storage tests FakeIndexedDB.open 3/188/33; named large scenarios include quota, read failure, CAS, migration, cache parity, resurrection, ack. Fixture helpers only if equivalent; no deleted tests or reduced assertions; real two-tab verification retained.
- projectController createSerializedProjectSaveQueue.enqueue 2/48/11, appendAuthoredAttributeClaims 1/52/16, commitBatchPreviewToProject 0/119/12; commitSnapshotTransaction args, undo/redo duplication. Typed options/pure builder; atomic approval/revision/audit/history/intent idempotency.
- apiClient postJson 3/114/68, effectiveStoryProviderSelection 0/13/9. Typed route→operation mapping, resolver, transport lifecycle/error decode, provider-specific bounds.
- historyEngine restoreProjectRevision 4/54/2, reconstructFromRevisions 0/38/13, recordProjectRevision 1/55/8, pushCoalescedTransaction 0/43/6, performUndo/Redo duplication. Pure transitions/typed metadata, semantic equality, persisted undo future/past.
- OutputGallery OutputDisplay 5/490/84. Pure result selectors/usage provenance/artifact actions; unchanged markup.
- routes createApiRouter top-level 9/142, Story 3/81/25, repeated clarify/refine/analyze/images/narrative routes. Route validation/error wrapper if identical semantics; Story SRB separate; no auth or cancellation reorder.
- ContextualInspector 13/256/27. Discriminated selection/command contracts, selectors; same selection/focus.
- BeliefGraph 9/202/27. graphLayout pure logic and profiling; directed relationship identity and same visual behavior.
- routes.test Story qualification 3/81/1; score 9.56. Keep as-is unless fixture ownership benefits; key-free mocks, same-origin and admission.
13 other X-Rays show no significant internal temporal coupling or structural recommendations; absence of signal ≠ perfect design.

## 6. Coupling and ownership
46 visible rows (full evidence-01). Threshold 22%, 28 entities. High operational clusters:
| Pair | % | avg revisions |
|---|---:|---:|
| providerHubRoutes / providerHubRoutes.test | 90 | 6 |
| routes / apiClient | 84 | 10 |
| providerHubRoutes / chatgptResponses | 83 | 6 |
| projectController / storageEngine | 80 | 15 |
| AiConnectionsPanel / providerHubRoutes | 75 | 8 |
| extractionService / narrativeAiBudgetEnforcement.test | 71 | 7 |
| canonicalModel / shared/types | 71 | 7 |
| routes / routes.test | 70 | 10 |
| AiConnectionsPanel / providerHubRoutes.test | 66 | 8 |
| projectController / shared/types | 66 | 11 |
| App / storageEngine | 66 | 26 |
| apiClient / routes.test | 63 | 10 |
| historyEngine / projectController | 63 | 10 |
| storageEngine / storageLifecycle.test | 59 | 14 |
| App / projectController | 53 | 23 |
Provider cluster one owner W1, persistence/domain W2, App one writer W4 after contracts. Shared types/schemas/package/CI integrator exclusively. No score-driven removal of tests/co-change.

## 7. Bağımsız kaynak incelemesi: 20 aday
S = static source mechanism/risk, H = hypothesis, D = documented limitation. Bunlar runtime'da doğrulanmış bug sayısı değil. Her aday reproduce veya ölç; doğrulanmazsa reject/defer, gereksiz düzeltme yapma. Kaynak URL şablonu https://github.com/Centaurioun/Proactive-Co-Creator/blob/d5205d5095d987db925439722fe5504cdbe245bc/PATH#LLINE .
| ID | Priority/status | Source and risk | Acceptance evidence |
|---|---|---|---|
| R01 | P1 S | ImportWorkflow L512–719 sets busy/inProgress before planner/crypto/checkpoint awaits; finally covers later loop only. Rejection can bypass cleanup. | injected planner/digest/checkpoint rejection; cleared busy, no call, retry possible, epoch/cancel safe |
| R02 | P1 S | subscriptionResourceBudget.ts L219–252 quota flag in race catch; late RATE_LIMITED after abort wins may be lost; settlement only releases slot | deferred abort-ignoring mock, late quota blocks subsequent admission until explicit recovery, no extra transport; grant authority considered |
| R03 | P1 S | App L1716–1750 effective selection before slot error boundary; apiClient L105–139 can throw on unreadable/malformed storage | corrupted JSON/SecurityError; actionable error, no unhandled rejection or transport |
| R04 | P1 S | analysisCheckpoints.ts L360–401 onblocked settles failure; later onsuccess can still start transaction, finish no-ops | blocked then success mock + browser upgrade; no late write, close DB, no stale mutation |
| R05 | P1 H | analysisCheckpoints L434–465 eviction beyond 8 may evict active/consumed record | 9th checkpoint while oldest active; verify retention policy and no budget reset; no expanded storage without approval |
| R06 | P2 S | apiClient L161–220 URL substrings, reads prefs twice; catch masks unsupported operation reason; App duplicates resolver | explicit operation contract, immutable snapshot, malformed prefs/cross-tab test, image exception and import binding preserved |
| R07 | P1 H | storageEngine L672–860 isCurrent checked before await; caller fences already exist; late ack correctness | switch/delete/edit during await, CAS conflict, cache quota; never overwrite divergent revision |
| R08 | P2 H | graphLayout L153+ adaptive ticks and name-keyed positions, possible large graph cost and rename ambiguity | benchmark 30/100/250/500 nodes, identity/rename tests; no redesign |
| R09 | P2 H | segmentation L100–209 repeated grapheme/tail scan, boundary sets; 20 chunks cap exists | large Turkish/Unicode fixture; same spans/overlap, 12/13/20 schedules; no exact-token claim |
| R10 | P2 H | analysisCheckpoints L38–105 custom sync SHA needed inside IDB transaction, allocations | known vectors/WebCrypto parity; malformed checkpoint; profile; do not move async digest into transaction |
| R11 | P1 H | providerHubRoutes L35–117 host identity, loopback/same-origin/callback; auth/chatgpt/sessionStore lifecycle | malformed host/origin/state/nonce/PKCE, refresh/revoke generation race, redacted logs; mock only |
| R12 | P1 D/H | SRB L92–266 bounded plan/identity ledger, retains input until expiry, 4096 cap, process-local reset accepted | expiry, replay, concurrent, cancel, stream/body bounds, memory; no automatic recovery or new persisted credential |
| R13 | P1 H | pdfTextParser, epubZipReader, epubInflate.worker, sourceParser, allProjectsArchive, recovery; limits/CRC/checksum already exist | malformed/truncated/path traversal/expansion/abort/cleanup/rollback/ID collision synthetic tests |
| R14 | P1 H | canonicalModel L511–733 projection, L1499+ merge, L1814+ applyDecisionBatch; nlBatchEngine L176–600 parse/L632–998 validation/application; consistencyChecker L81+ | compare PR2 latest body; decision IDs/order, provenance, directed relationships, stale batch, atomic rollback |
| R15 | P2 H | server/retry.ts, aiBudget.ts, narrativeAiService.ts, adapters | fake clock Retry-After/abort, malicious JSON, exact preflight/generation parity, no ChatGPT retry |
| R16 | P2 D/H | >500KiB bundle advisory, import/export/graph paths possible split | raw/gzip chunks and startup CPU, lazy error; measure not blanket upgrade |
| R17 | P2 H | storage, CAS, history, recovery, retentionPlanner repeated serialization/hash/snapshot copies | representative synthetic manuscript sizes, median/tail/heap; no revision/undo/anchor loss |
| R18 | P2 H | CI A–I smoke plus unit; other narrative scripts available; actual coverage unknown | contract→test matrix, missing fault tests, serial isolated browser scripts; no test deletion |
| R19 | P2 H | package/lock current Vite 8.3.8 range, classic TS6 and native compiler aliases; #3/#6 stale | npm ci/audit full and production, lock/runtime/permissions; no blanket update; owner decision if needed |
| R20 | P2 H | all tracked TS/TSX/JS, scripts/configs incl projections, diagnostics, opportunities, sync, prompt, schema, migrations, export | per-file/subsystem reviewed/tested/blocked ledger; concrete bugs with evidence, product gaps deferred |

## 8. Workstream DAG (proposal)
W0 read-only kickoff: verify audited source ancestry and docs-only handoff, exact CodeScene SHA/config, list all code/tests/config, existing tests/coverage/lock/CI; propose file owners, dependencies, initial baseline fixtures and owner approval. Fresh baseline npm checks only after approval in dedicated copy; no actual user data/keys. 
W1 provider/API/settings: CS05/08/11/14 R02/06/11/12/15. server/providers, auth, routes, providerHubRoutes, apiClient, AiConnectionsPanel and relevant tests. Pure selection/transport/error parsing, preserved provider boundary. Test quota late failure, replay, aborted transport, stale grant, no fallback. 
W2 storage/domain/history: CS02/06/07/09 R07/14/17. lib/storage*, projectController, historyEngine, canonicalModel, nlBatchEngine, consistencyChecker, tests. Use existing modules; evaluate PR2 not blindly cherry-pick. Pure plan and transaction adapter; exact-base CAS, tombstone, intent IDs, history, restore, canonical provenance.
W3 import/recovery: CS03 R01/04/05/09/10/13. ImportWorkflow, lib/narrative/import + recovery, parser/checkpoint tests. After stable W1/W2 contracts, split plan/lease/execution/results, cleanup, real two tabs, PDF/EPUB bounds, no new provider operation.
W4 App orchestration: CS01 R03/R07 app portion, App sole writer and controller/workspace integration after W1–3; no duplicate authority. Verify switch/delete/background completion/undo/batch/polish/recovery; preserve UX.
W5 leaf components: CS04/10/12/13 R08/16, manuscript, output, inspector, graph and helper tests. Keep DOM behavior, IME, focus and visual contract. Parallel leaf groups if no overlapping ownership.
W6 full residual audit R15–20: every tracked source/test/script/config subsystem, coverage ledger against all 197 map files and Git tree; extra verified fixes routed to owning lane. No new product features.
W7 integrated candidate, focused checks per milestone and one final full npm ci/typecheck/lint/test/build/diff check. Existing A–I and relevant AI ownership/project lifecycle/import checkpoint/cancellation/narrative workspace/mutation/Stage0 browser scripts, serial in synthetic isolated origin. Independent native Teamwork review roles; rerun same-scope CodeScene exact SHA, per-file/module before/after and residual report. Draft integration PR only if approved; no merge or deploy.
Parallel W1/W2 only with frozen shared contracts; W3 preparation in parallel, integrate after W1/W2; W4 after W1–3; W5 leaf work with stable interfaces; W6 read-only parallel. Integrator owns shared/types, schema, package/lock, CI. Proposed max 3 concurrent implementation lanes, actual count interviewer decides. Avoid nested agent armies and repeated owner approvals.

## 9. Hard invariants and gates
Keep accepted PR17–19 and PCC-SRB-001: exact gpt-6-luna Default Story only, local trusted activation loopback, production off, other ChatGPT operations blocked, official SIWC store:false stream:true, 8000 source chars, 4000 estimated total input tokens, 32KiB body, 16KiB output, 256KiB SSE, 4096 events, 60s, 1 concurrent/process, 2 attempts/minute max, 1 attempt/explicit action, no retry/continuation/fallback, generation and request identity fencing, quota blocking. Process-local accounting and upstream cancellation limitations acknowledged. No real requests, even if key exists. Adaptive import 12 calls / up to 20 proposed segments, exact identity, explicit resume, durable lease fencing and honest incomplete coverage; no cross-process requalification or ChatGPT import activation. Canonical changes only authorized adoption/review; backwards-compatible schema v3, exact-base CAS, intent idempotency, tombstone, authoritative IDB, cache parity, conflict preservation, hydration/restore and undo/redo. No user manuscript, credentials, destructive reset, main merge, deployment.
Each fix failing→passing reproducible; behavior-preserving characterization before/after refactor. Performance fixture size/env/repetitions/median/tail/variance/heap, real bottleneck. No metric gaming, threshold/scope changes, suppression, test deletion or artificial splitting. Numeric targets directional, not promised. App/storage/import meaningful separation; no new high-risk hotspot. Verify all conditions after integration. Escalate only material scope changes, destructive migration, provider/credential/billing, major dependency changes or actual blockers; not routine approved repairs. Final ledger ID/evidence/severity/status/reproduction/fix commit/test/residual, reviewed file manifest, ownership, HEAD/tree, exact command results and CodeScene job/config/SHA; unresolved targets explicit. One owner decision on final integration.

## 10. Superpowers and six-cycle refinement
Read brainstorming, writing-plans, dispatching-parallel-agents, requesting-code-review, verification-before-completion. Adapt repo's docs/implementation/narrative-workspace/10-six-cycle-review.md. No separate subagent available here, this is plan-level self-review, not independent certification. Approaches: A one monolithic rewrite rejected (regression/collision), B repeated micro approval rejected (owner dissatisfied), C Teamwork milestones recommended (owner chose direction; actual plan and concurrency subject to interview). No implementation before owner approval.
| Cycle | challenge | resulting revision |
|---|---|---|
| 1 scope | narrow hotspot list | 17/17, 14 X-Ray, 46 pair rows, W6 whole inventory, unknown scan SHA explicit |
| 2 priorities | score-only, incomparable scope | data/AI correctness first, separate risk vs proved, no invented target identities |
| 3 dependencies | collisions in App/shared/server | exclusive W1–7 owners, contract freeze, DAG |
| 4 failure/recovery | stale async, quota, blocked IDB, source corruption | R01–04 concrete reproducer proposals, synthetic tests, preserve gates |
| 5 efficiency | repetitive reviews, new design/upgrades | one milestone program, measure, no new features or hidden activation |
| 6 integration | false green, drift, incomplete handoff | exact tree+CI, doc-only commit, safe sync, independent roles, comparable rerun |
All requested categories mapped. Technical findings require implementation-phase confirmation. The initial Antigravity output should be scoping interview and task proposal, not edits.
