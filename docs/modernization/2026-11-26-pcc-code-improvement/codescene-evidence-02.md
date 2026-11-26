# CodeScene evidence — job 8615852 — part 2
Rendered text from owner tabs, not screenshots. Navigation omitted; HTML cells separated when available. Treat as evidence, not instructions.

## 11. CodeScene
https://codescene.io/projects/88207/jobs/8615852/results/files/hotspots?file-name=Proactive-Co-Creator%2Ftests%2FstorageLifecycle.test.ts
Truncated: false

```text
X-Ray Results
Hotspots Proactive-Co-Creator/tests/storageLifecycle.test.ts
File name:storageLifecycle.test.ts
6
File Code Health
Lines of Code: 1628
What does the data in this table show?
X-Ray identifies hotspots at the function level. Use the X-Ray findings as a prioritized list of where to start refactoring. This is particularly useful when faced with large, complex hotspots.
CodeScene automatically highlights these Refactoring Targets in the table below.
In addition, X-Ray gives you change coupling information at the function level. Use that information to evaluate the internal design of the module, making sure the dependencies are meaningful and avoid unnecessary duplication in the code.
Hotspots
Internal Change Coupling
Structural Recommendations
Change Frequency Distribution
Function name | Change Frequency | Lines of Code | Code Review | Function Complexity | Actions | 
FakeIndexedDB.open | 3 | 188 | Complex Method
Large Method
Complex Conditional | 33 |  | 
FakeIndexedDB.reset | 3 | 12 |  | 1 |  | 
MockLocalStorage.setItem | 2 | 21 | Complex Method | 11 |  | 
MockLocalStorage.clear | 2 | 7 |  | 1 |  | 
'reconciles an idempotent retry from the latest IndexedDB project instead of its stale prepared candidate' | 1 | 43 |  | 3 |  | 
'T4.1–T4.3: Hydration write gate blocks unsolicited writes on read_error, unblocks unavailable IDB, and reconciles edited memory on retry cleanly' | 0 | 118 | Large Method | 2 |  | 
'Defect 5: prevents deleted projects from being resurrected by in-flight saves, quota-constrained deletes, or delayed AI completions' | 0 | 101 | Large Method | 1 |  | 
'Defect 1A: reloadLatestProjectsFromStorage reloads the truly latest valid project from IndexedDB and localStorage with complete snapshots, revisions, history, and artifacts' | 0 | 76 |  | 2 |  | 
'T4.7: strictly higher IDB revision missing a local-only artifact fails parity closed' | 0 | 74 | Large Method | 1 |  | 
'Defect 4: detects hydration conflicts (same-revision divergence, divergent revision lineage, and pre-hydration local edits) rather than silently ignoring them' | 0 | 69 |  | 1 |  | 
'T4.6: same artifact count and same ID with different payload, OR same revision with divergent revision snapshot/undo future fails parity' | 0 | 68 |  | 2 |  | 
'Defect 3: removes duplicate project deletion calls, surfaces IndexedDB deletion failures, and preserves surviving project IndexedDB state (commit e0004d0)' | 0 | 63 |  | 2 |  | 
'T4.5: same artifact count (1) with different artifact IDs fails content parity and refuses local compaction under quota' | 0 | 58 |  | 1 |  | 
'Defect 6 (Migration): migrates v1 video projects and v2 projects to v3, preserves v2 backup, and prevents duplicate project IDs' | 0 | 58 |  | 1 |  | 
'FIX 6: deleted project does not resurrect after browser reload even when IndexedDB deletion fails and localStorage is at quota' | 0 | 55 |  | 1 |  | 
'FIX 5: preserves Undo/Redo cursor and future stack across browser reloads (Edit -> Undo -> Save -> Reload -> Redo)' | 0 | 55 |  | 1 |  | 
'T4.8: exact IDB content parity allows safe cache compaction under tight quota and full reload reproduces exact content' | 0 | 53 |  | 2 |  | 
'FIX 3: persistProjectDurably treats IndexedDB as authoritative, never invalidates a committed IDB write on localStorage failure, and blocks stale same-revision writes' | 0 | 52 |  | 1 |  | 
'FIX 2: reloadLatestProjectsFromStorage is non-destructive when localStorage and IndexedDB hold divergent Story Bible values at the same revision' | 0 | 49 |  | 3 |  | 
'T4.9: IDB read_error or unavailable during deletion preserves backups and unrelated local projects and marks incompleteDeletion' | 0 | 44 |  | 1 |  | 
'T4.6b / ST-07: identical artifacts & revision number still fail verifyProjectCacheParity when revision snapshot or Undo future/past differs' | 0 | 41 |  | 2 |  | 
'FIX 1: IndexedDB read errors are distinguished from empty storage and never overwrite existing IndexedDB records' | 0 | 41 |  | 2 |  | 
'Defect 2 & 6 (Two-Tab Conflict): detects two-tab CAS conflicts across both localStorage and IndexedDB without overwriting newer revisions' | 0 | 40 |  | 3 |  | 
'FIX 4: isSnapshotSemanticallyEqual compares answeredQuestions, skippedQuestions, clarification targets/options, and decision metadata' | 0 | 35 |  | 2 |  | 
'Defect 2: atomic revision-based persistence (persistProjectDurably) does not report success when authoritative IndexedDB fails or aborts, and succeeds when only localStorage hits quota' | 0 | 33 |  | 2 |  | 
'Defect 1B: recovers user project from IndexedDB as activeProject even when localStorage was empty and auto-seeded a sample' | 0 | 27 |  | 1 |  | 
'S3: quota compaction preserves survivor edits made after the parity read started' | 0 | 21 |  | 2 |  | 
'S1: a reload restores history without writing over a newer cross-tab commit' | 0 | 20 |  | 3 |  | 
'S5: an exact-base manuscript change rejects a divergent narrative at the same base revision' | 0 | 18 |  | 4 |  | 
'S3: compensating delete failure does not report a successful rollback' | 0 | 16 |  | 1 |  | 
'S5: a same-revision checked write cannot overwrite different durable narrative content' | 0 | 15 |  | 3 |  | 
'S1: an explicit reload choice cannot overwrite a changed durable record or the local alternative' | 0 | 15 |  | 3 |  | 
'S2: a cache security exception leaves the IndexedDB commit authoritative' | 0 | 15 |  | 3 |  | 
'A4: a delayed acknowledgement cannot mark a different same-revision narrative as saved' | 0 | 12 |  | 1 |  | 
'S1: retrying a successful read can migrate a legacy local-only project without replacing other records' | 0 | 10 |  | 1 |  | 
'A4: switching keeps same-revision divergent working content dirty' | 0 | 10 |  | 1 |  | 
'S4: a database containing only an unsupported record is a read failure and reload never seeds' | 0 | 9 |  | 1 |  | 
'S3: an empty cache read does not forget a remembered deletion' | 0 | 8 |  | 1 |  | 
'S2: a failed selection pointer write does not negate a stored payload' | 0 | 8 |  | 2 |  | 
'S2: saving a background project does not select it' | 0 | 6 |  | 1 |  | 
beforeEach(2/2) | 0 | 5 |  | 1 |  | 
beforeEach(1/2) | 0 | 4 |  | 1 |  | 
MockLocalStorage.removeItem | 0 | 3 |  | 1 |  | 
MockLocalStorage.getItem | 0 | 3 |  | 1 |  | 
No significant internal temporal coupling found.
There's no significant structural recommendations to make. Keep up the good work!
Change Frequency Distribution
Use the lower graph to zoom and pan by drawing a rectangle around the area of interest with your mouse.
0.0
0.5
1.0
1.5
2.0
2.5
3.0
Change Frequency
0
5
10
15
20
25
30
35
40
Each Function in your Codebase
0
5
10
15
20
25
30
35
40
-

```

## 12. CodeScene
https://codescene.io/projects/88207/jobs/8615852/results/files/hotspots?file-name=Proactive-Co-Creator%2Flib%2FprojectController.ts
Truncated: false

```text
X-Ray Results
Hotspots Proactive-Co-Creator/lib/projectController.ts
File name:projectController.ts
6
File Code Health
Lines of Code: 397
What does the data in this table show?
X-Ray identifies hotspots at the function level. Use the X-Ray findings as a prioritized list of where to start refactoring. This is particularly useful when faced with large, complex hotspots.
CodeScene automatically highlights these Refactoring Targets in the table below.
In addition, X-Ray gives you change coupling information at the function level. Use that information to evaluate the internal design of the module, making sure the dependencies are meaningful and avoid unnecessary duplication in the code.
Hotspots
Internal Change Coupling
Structural Recommendations
Change Frequency Distribution
Function name | Change Frequency | Lines of Code | Code Review | Function Complexity | Actions | 
createSerializedProjectSaveQueue.enqueue | 2 | 48 | Complex Method | 11 |  | 
commitSnapshotTransaction | 2 | 42 | Excess Number of Function Arguments | 5 |  | 
commitRedoTransaction | 2 | 35 | Code Duplication | 2 |  | 
commitUndoTransaction | 2 | 35 | Code Duplication | 2 |  | 
appendAuthoredAttributeClaims | 1 | 52 | Complex Method
Bumpy Road Ahead
Complex Conditional | 16 |  | 
commitBatchPreviewToProject | 0 | 119 | Complex Method
Large Method | 12 |  | 
createSerializedProjectSaveQueue (top-level context) | 0 | 9 |  | 1 |  | 
createSerializedProjectSaveQueue.resetProject | 0 | 3 |  | 1 |  | 
No significant internal temporal coupling found.
There's no significant structural recommendations to make. Keep up the good work!
Change Frequency Distribution
Use the lower graph to zoom and pan by drawing a rectangle around the area of interest with your mouse.
0.0
0.2
0.4
0.6
0.8
1.0
1.2
1.4
1.6
1.8
2.0
Change Frequency
0
1
2
3
4
5
6
7
Each Function in your Codebase
0
1
2
3
4
5
6
7
-

```

## 13. CodeScene
https://codescene.io/projects/88207/jobs/8615852/results/files/hotspots?file-name=Proactive-Co-Creator%2Fservices%2FapiClient.ts
Truncated: false

```text
X-Ray Results
Hotspots Proactive-Co-Creator/services/apiClient.ts
File name:apiClient.ts
7
File Code Health
Lines of Code: 416
What does the data in this table show?
X-Ray identifies hotspots at the function level. Use the X-Ray findings as a prioritized list of where to start refactoring. This is particularly useful when faced with large, complex hotspots.
CodeScene automatically highlights these Refactoring Targets in the table below.
In addition, X-Ray gives you change coupling information at the function level. Use that information to evaluate the internal design of the module, making sure the dependencies are meaningful and avoid unnecessary duplication in the code.
Hotspots
Internal Change Coupling
Structural Recommendations
Change Frequency Distribution
Function name | Change Frequency | Lines of Code | Code Review | Function Complexity | Actions | 
postJson | 3 | 114 | Complex Method
Large Method
Bumpy Road Ahead
Complex Conditional | 68 |  | 
generateClarifications | 2 | 17 | Excess Number of Function Arguments | 1 |  | 
refinePromptWithAllUpdates | 1 | 16 |  | 1 |  | 
analyzePromptToBeliefGraph | 1 | 9 |  | 1 |  | 
generateImagesFromPrompt | 1 | 7 |  | 1 |  | 
enforceOperationRequestBounds | 0 | 15 |  | 4 |  | 
getEffectiveStoryProviderSelection | 0 | 13 | Complex Method | 9 |  | 
executionPreferenceFingerprint | 0 | 12 |  | 2 |  | 
requestImportEnhancements | 0 | 7 |  | 1 |  | 
requestCreativeOpportunities | 0 | 7 |  | 1 |  | 
requestWritingAssist | 0 | 7 |  | 1 |  | 
requestNarrativeSyncAnalysis | 0 | 7 |  | 1 |  | 
requestDiagnosticFixSuggestions | 0 | 7 |  | 1 |  | 
requestSemanticDiagnostics | 0 | 7 |  | 1 |  | 
fetchAiCapabilities | 0 | 7 |  | 3 |  | 
extractNarrativeChunk | 0 | 7 |  | 1 |  | 
ClientApiError.constructor | 0 | 7 |  | 1 |  | 
invalidateAiProviderRequestsForPreferenceChange | 0 | 6 |  | 2 |  | 
isAbortError | 0 | 5 |  | 5 |  | 
invalidateAiProviderRequests | 0 | 5 |  | 2 |  | 
No significant internal temporal coupling found.
There's no significant structural recommendations to make. Keep up the good work!
Change Frequency Distribution
Use the lower graph to zoom and pan by drawing a rectangle around the area of interest with your mouse.
0.0
0.5
1.0
1.5
2.0
2.5
3.0
Change Frequency
0
2
4
6
8
10
12
14
16
18
Each Function in your Codebase
0
2
4
6
8
10
12
14
16
18
-

```

## 14. CodeScene
https://codescene.io/projects/88207/jobs/8615852/results/files/hotspots?file-name=Proactive-Co-Creator%2Flib%2FhistoryEngine.ts
Truncated: false

```text
X-Ray Results
Hotspots Proactive-Co-Creator/lib/historyEngine.ts
File name:historyEngine.ts
7
File Code Health
Lines of Code: 455
What does the data in this table show?
X-Ray identifies hotspots at the function level. Use the X-Ray findings as a prioritized list of where to start refactoring. This is particularly useful when faced with large, complex hotspots.
CodeScene automatically highlights these Refactoring Targets in the table below.
In addition, X-Ray gives you change coupling information at the function level. Use that information to evaluate the internal design of the module, making sure the dependencies are meaningful and avoid unnecessary duplication in the code.
Hotspots
Internal Change Coupling
Structural Recommendations
Change Frequency Distribution
Function name | Change Frequency | Lines of Code | Code Review | Function Complexity | Actions | 
restoreProjectRevision | 4 | 54 |  | 2 |  | 
createUndoRedoState | 3 | 24 | Complex Conditional | 7 |  | 
normalizeSnapshotForComparison | 3 | 21 |  | 1 |  | 
recordProjectRevision | 1 | 55 | Excess Number of Function Arguments
Complex Conditional | 8 |  | 
pushUndoableTransaction | 1 | 25 |  | 2 |  | 
createUndoRedoStateFromProject | 1 | 3 |  | 1 |  | 
pushCoalescedTransaction | 0 | 43 | Complex Conditional
Excess Number of Function Arguments | 6 |  | 
reconstructFromRevisions | 0 | 38 | Complex Method
Complex Conditional | 13 |  | 
performRedo | 0 | 26 | Code Duplication | 2 |  | 
performUndo | 0 | 26 | Code Duplication | 2 |  | 
normalizeDecisionForComparison | 0 | 24 |  | 1 |  | 
normalizeEntityForComparison | 0 | 24 |  | 2 |  | 
normalizeClarificationForComparison | 0 | 21 |  | 2 |  | 
reconstructFromPersistedHistory | 0 | 21 |  | 3 |  | 
normalizeRelationshipForComparison | 0 | 15 |  | 2 |  | 
computeSnapshotDigest | 0 | 13 |  | 2 |  | 
serializeUndoHistory | 0 | 12 |  | 1 |  | 
isSnapshotSemanticallyEqual | 0 | 6 |  | 1 |  | 
No significant internal temporal coupling found.
There's no significant structural recommendations to make. Keep up the good work!
Change Frequency Distribution
Use the lower graph to zoom and pan by drawing a rectangle around the area of interest with your mouse.
0.0
0.5
1.0
1.5
2.0
2.5
3.0
3.5
4.0
Change Frequency
0
2
4
6
8
10
12
14
16
Each Function in your Codebase
0
2
4
6
8
10
12
14
16
-

```

## 15. CodeScene
https://codescene.io/projects/88207/jobs/8615852/results/files/hotspots?file-name=Proactive-Co-Creator%2Fcomponents%2FOutputGallery.tsx
Truncated: false

```text
X-Ray Results
Hotspots Proactive-Co-Creator/components/OutputGallery.tsx
File name:OutputGallery.tsx
7
File Code Health
Lines of Code: 504
What does the data in this table show?
X-Ray identifies hotspots at the function level. Use the X-Ray findings as a prioritized list of where to start refactoring. This is particularly useful when faced with large, complex hotspots.
CodeScene automatically highlights these Refactoring Targets in the table below.
In addition, X-Ray gives you change coupling information at the function level. Use that information to evaluate the internal design of the module, making sure the dependencies are meaningful and avoid unnecessary duplication in the code.
Hotspots
Internal Change Coupling
Structural Recommendations
Change Frequency Distribution
Function name | Change Frequency | Lines of Code | Code Review | Function Complexity | Actions | 
OutputDisplay:React.FC<OutputDisplayProps> | 5 | 490 | Complex Method
Large Method | 84 |  | 
onGenerate | 0 | 1 |  | 1 |  | 
onChangeFreeformNotes | 0 | 1 |  | 1 |  | 
No significant internal temporal coupling found.
There's no significant structural recommendations to make. Keep up the good work!
Change Frequency Distribution
Use the lower graph to zoom and pan by drawing a rectangle around the area of interest with your mouse.
0.0
0.5
1.0
1.5
2.0
2.5
3.0
3.5
4.0
4.5
5.0
Change Frequency
0.0
0.2
0.4
0.6
0.8
1.0
1.2
1.4
1.6
1.8
2.0
Each Function in your Codebase
0.0
0.2
0.4
0.6
0.8
1.0
1.2
1.4
1.6
1.8
2.0
-

```

## 16. CodeScene
https://codescene.io/projects/88207/jobs/8615852/results/files/hotspots?file-name=Proactive-Co-Creator%2Fserver%2Froutes.ts
Truncated: false

```text
X-Ray Results
Hotspots Proactive-Co-Creator/server/routes.ts
File name:routes.ts
7
File Code Health
Lines of Code: 610
What does the data in this table show?
X-Ray identifies hotspots at the function level. Use the X-Ray findings as a prioritized list of where to start refactoring. This is particularly useful when faced with large, complex hotspots.
CodeScene automatically highlights these Refactoring Targets in the table below.
In addition, X-Ray gives you change coupling information at the function level. Use that information to evaluate the internal design of the module, making sure the dependencies are meaningful and avoid unnecessary duplication in the code.
Hotspots
Internal Change Coupling
Structural Recommendations
Change Frequency Distribution
Function name | Change Frequency | Lines of Code | Code Review | Function Complexity | Actions | 
createApiRouter (top-level context) | 9 | 14 |  | 2 |  | 
createApiRouter.'/generate/story' | 3 | 81 | Complex Conditional
Complex Method
Large Method | 25 |  | 
createApiRouter.'/clarify' | 1 | 27 | Code Duplication | 4 |  | 
createApiRouter.'/ai/capabilities' | 1 | 6 |  | 1 |  | 
createApiRouter.'/batch-edit' | 0 | 30 |  | 4 |  | 
createApiRouter.'/refine' | 0 | 26 | Code Duplication | 4 |  | 
createApiRouter.'/analyze' | 0 | 25 | Code Duplication | 4 |  | 
createApiRouter.'/generate/images' | 0 | 24 | Code Duplication | 4 |  | 
createApiRouter.'/.../import/extract' | 0 | 17 |  | 6 |  | 
createApiRouter.'/.../import/enhance' | 0 | 15 | Code Duplication | 4 |  | 
createApiRouter.'/.../opportunities/explore' | 0 | 15 | Code Duplication | 4 |  | 
createApiRouter.'/.../writing/assist' | 0 | 15 | Code Duplication | 4 |  | 
createApiRouter.'/.../sync/analyze' | 0 | 15 | Code Duplication | 4 |  | 
createApiRouter.'/.../diagnostics/suggest-fixes' | 0 | 15 | Code Duplication | 4 |  | 
createApiRouter.'/.../diagnostics/analyze' | 0 | 15 | Code Duplication | 4 |  | 
attachRequestAbortSignal | 0 | 13 |  | 2 |  | 
createApiRouter.'/health' | 0 | 7 |  | 1 |  | 
generateClarificationsList | 0 | 7 | Excess Number of Function Arguments | 1 |  | 
refinePromptText | 0 | 6 |  | 1 |  | 
sendErrorResponse | 0 | 5 |  | 2 |  | 
analyzeBeliefGraph | 0 | 5 |  | 1 |  | 
adapterFactory | 0 | 1 |  | 1 |  | 
currentGrantGeneration | 0 | 1 |  | 1 |  | 
hasConfiguredGeminiKey | 0 | 1 |  | 1 |  | 
generateImagesBatch | 0 | 1 |  | 1 |  | 
generateStoryText | 0 | 1 |  | 1 |  | 
No significant internal temporal coupling found.
There's no significant structural recommendations to make. Keep up the good work!
Change Frequency Distribution
Use the lower graph to zoom and pan by drawing a rectangle around the area of interest with your mouse.
0
1
2
3
4
5
6
7
8
9
Change Frequency
0
2
4
6
8
10
12
14
16
18
20
22
24
Each Function in your Codebase
0
2
4
6
8
10
12
14
16
18
20
22
24
-

```

## 17. CodeScene
https://codescene.io/projects/88207/jobs/8615852/results/files/hotspots?file-name=Proactive-Co-Creator%2Fcomponents%2FContextualInspector.tsx
Truncated: false

```text
X-Ray Results
Hotspots Proactive-Co-Creator/components/ContextualInspector.tsx
File name:ContextualInspector.tsx
7
File Code Health
Lines of Code: 323
What does the data in this table show?
X-Ray identifies hotspots at the function level. Use the X-Ray findings as a prioritized list of where to start refactoring. This is particularly useful when faced with large, complex hotspots.
CodeScene automatically highlights these Refactoring Targets in the table below.
In addition, X-Ray gives you change coupling information at the function level. Use that information to evaluate the internal design of the module, making sure the dependencies are meaningful and avoid unnecessary duplication in the code.
Hotspots
Internal Change Coupling
Structural Recommendations
Change Frequency Distribution
Function name | Change Frequency | Lines of Code | Code Review | Function Complexity | Actions | 
ContextualInspector:React.FC<ContextualInspectorProps> | 13 | 256 | Complex Method
Large Method
Complex Conditional | 27 |  | 
onImportProjectJson | 1 | 1 |  | 1 |  | 
onUpdateRelationshipById | 0 | 8 |  | 1 |  | 
onPreviewProjectJson | 0 | 1 |  | 1 |  | 
onTransitionOpportunity | 0 | 1 |  | 1 |  | 
onCreateOpportunity | 0 | 1 |  | 1 |  | 
onExportContentBundle | 0 | 1 |  | 1 |  | 
onExportContent | 0 | 1 |  | 1 |  | 
onExportPromptText | 0 | 1 |  | 1 |  | 
onExportStoryBibleMarkdown | 0 | 1 |  | 1 |  | 
onExportJson | 0 | 1 |  | 1 |  | 
onDeleteProject | 0 | 1 |  | 1 |  | 
onCreateNewProject | 0 | 1 |  | 1 |  | 
onSwitchProject | 0 | 1 |  | 1 |  | 
onRestoreRevision | 0 | 1 |  | 1 |  | 
onRemoveRelationship | 0 | 1 |  | 1 |  | 
onUpsertRelationship | 0 | 1 |  | 1 |  | 
onAddEntity | 0 | 1 |  | 1 |  | 
onRenameEntity | 0 | 1 |  | 1 |  | 
onAttributeChange | 0 | 1 |  | 1 |  | 
onSelectRelationship | 0 | 1 |  | 1 |  | 
onSelectEntity | 0 | 1 |  | 1 |  | 
onSelectTab | 0 | 1 |  | 1 |  | 
No significant internal temporal coupling found.
There's no significant structural recommendations to make. Keep up the good work!
Change Frequency Distribution
Use the lower graph to zoom and pan by drawing a rectangle around the area of interest with your mouse.
0
1
2
3
4
5
6
7
8
9
10
11
12
13
Change Frequency
0
2
4
6
8
10
12
14
16
18
20
22
Each Function in your Codebase
0
2
4
6
8
10
12
14
16
18
20
22
-

```

## 18. CodeScene
https://codescene.io/projects/88207/jobs/8615852/results/files/hotspots?file-name=Proactive-Co-Creator%2Fcomponents%2FBeliefGraph.tsx
Truncated: false

```text
X-Ray Results
Hotspots Proactive-Co-Creator/components/BeliefGraph.tsx
File name:BeliefGraph.tsx
8
File Code Health
Lines of Code: 238
What does the data in this table show?
X-Ray identifies hotspots at the function level. Use the X-Ray findings as a prioritized list of where to start refactoring. This is particularly useful when faced with large, complex hotspots.
CodeScene automatically highlights these Refactoring Targets in the table below.
In addition, X-Ray gives you change coupling information at the function level. Use that information to evaluate the internal design of the module, making sure the dependencies are meaningful and avoid unnecessary duplication in the code.
Hotspots
Internal Change Coupling
Structural Recommendations
Change Frequency Distribution
Function name | Change Frequency | Lines of Code | Code Review | Function Complexity | Actions | 
BeliefGraph:React.FC<BeliefGraphProps> | 9 | 202 | Complex Method
Large Method | 27 |  | 
onRelationshipChange | 0 | 6 |  | 1 |  | 
onSelectEntity | 0 | 1 |  | 1 |  | 
No significant internal temporal coupling found.
There's no significant structural recommendations to make. Keep up the good work!
Change Frequency Distribution
Use the lower graph to zoom and pan by drawing a rectangle around the area of interest with your mouse.
0
1
2
3
4
5
6
7
8
9
Change Frequency
0.0
0.2
0.4
0.6
0.8
1.0
1.2
1.4
1.6
1.8
2.0
Each Function in your Codebase
0.0
0.2
0.4
0.6
0.8
1.0
1.2
1.4
1.6
1.8
2.0
-

```

## 19. CodeScene
https://codescene.io/projects/88207/jobs/8615852/results/files/hotspots?file-name=Proactive-Co-Creator%2Ftests%2Froutes.test.ts
Truncated: false

```text
X-Ray Results
Hotspots Proactive-Co-Creator/tests/routes.test.ts
File name:routes.test.ts
9
File Code Health
Lines of Code: 488
What does the data in this table show?
X-Ray identifies hotspots at the function level. Use the X-Ray findings as a prioritized list of where to start refactoring. This is particularly useful when faced with large, complex hotspots.
CodeScene automatically highlights these Refactoring Targets in the table below.
In addition, X-Ray gives you change coupling information at the function level. Use that information to evaluate the internal design of the module, making sure the dependencies are meaningful and avoid unnecessary duplication in the code.
Hotspots
Internal Change Coupling
Structural Recommendations
Change Frequency Distribution
Function name | Change Frequency | Lines of Code | Code Review | Function Complexity | Actions | 
'qualifies the ChatGPT story route through the injected SRB and Responses transport chain' | 3 | 81 | Large Method | 1 |  | 
'validates narrative import extraction requests and returns only the mocked scoped result' | 2 | 54 |  | 4 |  | 
'handles /.../api/batch-edit validation and success' | 1 | 73 |  | 2 |  | 
'passes client disconnect cancellation to the narrative extraction handler' | 1 | 31 |  | 7 |  | 
'keeps ordinary ChatGPT story production admission blocked without trusted injection' | 1 | 26 |  | 1 |  | 
'returns a structured safe error when narrative extraction fails' | 1 | 15 |  | 4 |  | 
startTestServer | 1 | 15 |  | 5 |  | 
createStubHandlers | 0 | 60 |  | 1 |  | 
'allows the trusted local Story gate only for a same-origin local request' | 0 | 39 |  | 1 |  | 
'handles /.../generate/story and returns 404 for removed video routes' | 0 | 37 |  | 1 |  | 
'returns structured MISSING_API_KEY error without leaking secrets' | 0 | 25 |  | 2 |  | 
'serves /api/health without exposing secrets or removed video model' | 0 | 13 |  | 1 |  | 
afterEach | 0 | 6 |  | 2 |  | 
importRequest | 0 | 4 |  | 1 |  | 
No significant internal temporal coupling found.
There's no significant structural recommendations to make. Keep up the good work!
Change Frequency Distribution
Use the lower graph to zoom and pan by drawing a rectangle around the area of interest with your mouse.
0.0
0.5
1.0
1.5
2.0
2.5
3.0
Change Frequency
0
1
2
3
4
5
6
7
8
9
10
11
12
13
Each Function in your Codebase
0
1
2
3
4
5
6
7
8
9
10
11
12
13
-

```
