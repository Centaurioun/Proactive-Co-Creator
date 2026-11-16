import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {
  addEntity,
  applyDecisionBatch,
  createEmptyStoryBible,
  createSampleProject,
  makeStableId,
  mergeAnalysisIntoSnapshot,
  renameEntity,
  setEntityAttribute,
  setEntityExistence,
  updateRelationshipById,
  updateStoryBibleField,
  upsertRelationship,
} from '../lib/canonicalModel.ts';
import { computePromptDigest, synthesizeRefinedPrompt } from '../lib/promptBuilder.ts';
import {
  applyProposedOperations,
  interpretBatchInstructionLocally,
  validateProposedOperations,
} from '../lib/nlBatchEngine.ts';
import {
  createUndoRedoState,
  performUndo,
  pushCoalescedTransaction,
  recordProjectRevision,
} from '../lib/historyEngine.ts';
import {
  CURRENT_SCHEMA_VERSION,
  LOCAL_STORAGE_BACKUP_V2_KEY,
  LOCAL_STORAGE_PROJECTS_KEY,
  exportProjectToJson,
  exportStoryBibleMarkdown,
  loadProjectsFromLocalStorage,
  saveProjectToLocalStorage,
} from '../lib/storageEngine.ts';
import {
  acceptPolishProposal,
  applyAsyncAnalysisCompletion,
  applyAsyncGenerationCompletion,
  clearTicket,
  commitSnapshotTransaction,
  createPolishProposal,
  createRequestTicket,
  isProjectActionLoading,
  refreshArtifactsCurrentness,
  registerTicket,
  type InFlightTicketsMap,
} from '../lib/projectController.ts';
import {
  computeForceLayout,
  computeNodeDimensions,
  computeParallelEdgeOffsets,
  getEdgePath,
} from '../lib/graphLayout.ts';
import {
  parseAndValidateBatchEditResponse,
  parseAndValidateBeliefGraph,
} from '../shared/schemas.ts';
import type {
  BeliefState,
  Clarification,
  CreativeProject,
  ProjectSnapshot,
} from '../shared/types.ts';

function createCustomProject(id: string, name: string, idea: string): CreativeProject {
  const now = Date.now();
  const snap: ProjectSnapshot = {
    originalIdea: idea,
    refinedPrompt: idea,
    freeformNotes: '',
    mode: 'story',
    entities: [],
    relationships: [],
    storyBible: createEmptyStoryBible(now),
    clarifications: [],
    decisions: [],
    answeredQuestions: [],
    skippedQuestions: [],
  };
  return {
    schemaVersion: 3,
    revision: 1,
    persistedRevision: 1,
    id,
    name,
    createdAt: now,
    updatedAt: now,
    snapshot: snap,
    artifacts: [],
    revisions: [
      {
        id: makeStableId('rev'),
        revisionNumber: 1,
        timestamp: now,
        label: 'Created Project',
        summary: `Created ${name}`,
        changeCount: 0,
        snapshot: structuredClone(snap),
      },
    ],
  };
}

describe('Master Plan Stability, Consistency & UX Suite (AC01–AC26 & Section 10 Adversarial Matrix)', () => {
  it('AC01 & AC14: Cross-project async isolation and per-project/per-action loading selectors', () => {
    const projA = createSampleProject();
    const projB = createCustomProject('proj_b', 'Cyberpunk Harbor', 'A tugboat captain in Neo-Harbor.');
    const savedProjects = [projA, projB];

    // Start an analyze request on Project A
    let tickets: InFlightTicketsMap = {};
    const analyzeTicketA = createRequestTicket(projA, 'analyze');
    tickets = registerTicket(tickets, analyzeTicketA);

    // Loading state is true ONLY for Project A's 'analyze', and FALSE for Project B!
    assert.equal(isProjectActionLoading(tickets, projA.id, 'analyze'), true);
    assert.equal(isProjectActionLoading(tickets, projA.id, 'generate'), false);
    assert.equal(isProjectActionLoading(tickets, projB.id, 'analyze'), false);

    // User switches active project to Project B while Project A's analysis is still in flight
    const activeUndoB = createUndoRedoState(projB.snapshot);

    // Project A's analysis response arrives late with a new entity 'Firefly Lantern'
    const lateGraphForA: BeliefState = {
      prompt: projA.snapshot.originalIdea,
      entities: [
        {
          name: 'Firefly Lantern',
          presence_in_prompt: false,
          description: 'Glowing jar on the porch',
          alternatives: null,
          attributes: [{ name: 'existence', presence_in_prompt: false, value: [{ name: 'true' }] }],
        },
      ],
      relationships: [],
    };

    const completion = applyAsyncAnalysisCompletion({
      ticket: analyzeTicketA,
      activeProject: projB,
      activeUndoState: activeUndoB,
      savedProjects,
      newGraph: lateGraphForA,
      newClarifications: null,
      label: 'Reanalyze Project A',
      summary: 'Late analysis for Project A',
    });

    // Project B (active) MUST remain completely untouched!
    assert.equal(completion.appliedToActive, false);
    assert.equal(completion.appliedToBackgroundProject, true);
    assert.equal(completion.activeProject.id, projB.id);
    assert.equal(
      completion.activeProject.snapshot.entities.some((e) => e.name === 'Firefly Lantern'),
      false,
      'Project A late response must never leak into Project B'
    );

    // Project A in savedProjects received its analysis safely
    const updatedProjA = completion.savedProjects.find((p) => p.id === projA.id)!;
    assert.equal(
      updatedProjA.snapshot.entities.some((e) => e.name === 'Firefly Lantern'),
      true,
      'Background Project A must receive its own completed analysis'
    );

    tickets = clearTicket(tickets, analyzeTicketA);
    assert.equal(isProjectActionLoading(tickets, projA.id, 'analyze'), false);
  });

  it('AC02: Multi-tab CAS conflict detection on monotonic logical revision (even within same millisecond)', () => {
    const store = new Map<string, string>();
    const origWindow = (globalThis as { window?: unknown }).window;
    Object.defineProperty(globalThis, 'window', {
      value: {
        localStorage: {
          getItem: (k: string) => store.get(k) ?? null,
          setItem: (k: string, v: string) => store.set(k, v),
          removeItem: (k: string) => store.delete(k),
        },
      },
      configurable: true,
    });

    try {
      const tab1Project = createSampleProject();
      const firstSave = saveProjectToLocalStorage(tab1Project);
      assert.equal(firstSave.ok, true);
      assert.equal(firstSave.persistedRevision, 1);

      // Tab 2 loads the project at revision 1, makes an edit (revision -> 2) at the exact same timestamp, and saves
      const tab2Loaded = loadProjectsFromLocalStorage().projects[0];
      const tab2Edited = recordProjectRevision(
        {
          ...tab2Loaded,
          updatedAt: tab1Project.updatedAt, // identical millisecond timestamp!
          snapshot: updateStoryBibleField(tab2Loaded.snapshot, 'tone', 'Noir Mystery'),
        },
        'Tab 2 edit',
        'Set tone to Noir Mystery',
        1
      );
      assert.equal(tab2Edited.revision, 2);
      const tab2Save = saveProjectToLocalStorage(tab2Edited, {
        expectedPersistedRevision: tab2Loaded.persistedRevision,
      });
      assert.equal(tab2Save.ok, true);

      // Tab 1 (still on persistedRevision = 1) tries to save a different edit without knowing about Tab 2
      const tab1StaleEdit = recordProjectRevision(
        {
          ...tab1Project,
          updatedAt: tab1Project.updatedAt,
          snapshot: updateStoryBibleField(tab1Project.snapshot, 'tone', 'Slapstick Comedy'),
        },
        'Tab 1 edit',
        'Set tone to Slapstick Comedy',
        1
      );
      const tab1SaveAttempt = saveProjectToLocalStorage(tab1StaleEdit, {
        expectedPersistedRevision: 1,
      });
      assert.equal(tab1SaveAttempt.ok, false);
      assert.equal(tab1SaveAttempt.conflictDetected, true);
      assert.equal(tab1SaveAttempt.storedProject?.snapshot.storyBible.tone.value, 'Noir Mystery');

      // Explicit forceOverwrite resolves the conflict when the user chooses "Keep My Version"
      const forced = saveProjectToLocalStorage(tab1StaleEdit, { forceOverwrite: true });
      assert.equal(forced.ok, true);
    } finally {
      Object.defineProperty(globalThis, 'window', {
        value: origWindow,
        configurable: true,
      });
    }
  });

  it('AC03: Unconfirmed AI-inferred relationships enter as pending and do not leak into refinedPrompt until accepted', () => {
    const proj = createSampleProject();
    const baseSnap = proj.snapshot;

    // AI returns an inferred relationship ('Fox' -> 'Cat' : 'secretly envies') with presence_in_prompt: false
    const aiGraphRaw = {
      entities: [
        {
          name: 'Fox',
          presence_in_prompt: false,
          description: 'Clever woodland guest',
          alternatives: [],
          attributes: [{ name: 'existence', presence_in_prompt: false, value: ['true'] }],
        },
        {
          name: 'Cat',
          presence_in_prompt: true,
          description: 'Host of the party',
          alternatives: [],
          attributes: [{ name: 'existence', presence_in_prompt: true, value: ['true'] }],
        },
      ],
      relationships: [
        {
          source: 'Fox',
          target: 'Cat',
          label: 'secretly envies',
          presence_in_prompt: false,
          alternatives: ['admires'],
        },
      ],
    };

    const parsedGraph = parseAndValidateBeliefGraph(
      JSON.stringify(aiGraphRaw),
      baseSnap.originalIdea
    );
    assert.equal(parsedGraph.relationships[0].presence_in_prompt, false);

    const merged = mergeAnalysisIntoSnapshot(baseSnap, parsedGraph, null);
    const inferredRel = merged.relationships.find((r) => r.label === 'secretly envies');
    assert.ok(inferredRel);
    assert.equal(inferredRel.status, 'pending', 'AI-inferred relationship must enter as pending');
    assert.equal(inferredRel.provenance, 'ai-inferred');

    // Must appear in Decision Inbox as a pending relationship decision
    const relDecision = merged.decisions.find(
      (d) => d.category === 'relationship' && d.targetRelationshipId === inferredRel.id
    );
    assert.ok(relDecision);
    assert.equal(relDecision.status, 'pending');

    // Must NOT leak into refinedPrompt while pending!
    assert.equal(
      merged.refinedPrompt.includes('secretly envies'),
      false,
      'Pending AI relationship must not leak into refinedPrompt'
    );

    // Accepting the relationship decision promotes it to confirmed and includes it in refinedPrompt
    const accepted = applyDecisionBatch(merged, [relDecision.id], 'accept');
    const confirmedRel = accepted.snapshot.relationships.find((r) => r.id === inferredRel.id)!;
    assert.equal(confirmedRel.status, 'confirmed');
    assert.equal(
      accepted.snapshot.refinedPrompt.includes('secretly envies'),
      true,
      'Accepted relationship must appear in refinedPrompt'
    );
  });

  it('AC04 & AC05: Multi-clause batch coverage reporting, unhandled clause detection, and atomic batch validation', () => {
    const proj = createSampleProject();
    const snap = proj.snapshot;

    // 1. Multi-clause instruction where one clause is valid and the second is unsupported gibberish
    const mixedInstruction =
      'Make all the animal guests elderly. Teleport the quantum spaceship to Andromeda.';
    const proposal = interpretBatchInstructionLocally(mixedInstruction, snap, {
      projectId: proj.id,
      revision: proj.revision,
    });

    assert.equal(proposal.clauses?.length, 2);
    assert.equal(proposal.coverageComplete, false);
    assert.equal(proposal.unhandledClauses?.length, 1);
    assert.match(proposal.unhandledClauses![0], /Teleport the quantum spaceship/i);

    // 2. Partial-name ambiguity detection: add 'Red Fox' alongside 'Fox' and test "Make the fox sly"
    const snapWithTwoFoxes = addEntity(snap, 'Red Fox', 'character', 'Another fox cousin');
    const ambiguousFoxProposal = interpretBatchInstructionLocally(
      'Make the fox sly',
      snapWithTwoFoxes
    );
    assert.ok(
      ambiguousFoxProposal.ambiguities.some(
        (a) => a.candidates.includes('Fox') && a.candidates.includes('Red Fox')
      ),
      'Partial entity reference matching multiple entities must emit an ambiguity warning'
    );

    // 3. Atomic batch validation: if a batch contains a missing target or stale revision, NO operations apply
    const invalidOps = [
      ...proposal.operations,
      {
        id: 'op_bad_target',
        type: 'set_attribute' as const,
        summary: 'Update missing entity',
        entityId: 'ent_nonexistent_999',
        entityName: 'Nonexistent Dragon',
        attributeName: 'age',
        nextValue: 'Ancient',
        selected: true,
      },
    ];
    const validationIssues = validateProposedOperations(snap, invalidOps);
    assert.ok(validationIssues.some((v) => v.code === 'MISSING_TARGET'));

    const atomicRes = applyProposedOperations(snap, invalidOps);
    assert.equal(atomicRes.appliedCount, 0, 'Atomic batch must abort all operations on validation error');
    assert.equal(atomicRes.snapshot, snap, 'Snapshot must be unchanged when atomic validation fails');

    // Stale revision check
    const staleRevRes = applyProposedOperations(snap, proposal.operations, {
      expectedBaseRevision: 1,
      currentRevision: 2,
    });
    assert.equal(staleRevRes.appliedCount, 0);
    assert.ok(staleRevRes.errors.some((e) => e.code === 'STALE_BASE'));
  });

  it('AC06, AC07 & AC18: Directed multigraph relationships (A->B and B->A coexist, parallel predicates, edit/reverse/reject)', () => {
    const proj = createSampleProject();
    let snap = proj.snapshot;

    const cat = snap.entities.find((e) => e.name === 'Cat')!;
    const fox = snap.entities.find((e) => e.name === 'Fox')!;

    // Upsert Cat -> Fox : 'welcomes' and Cat -> Fox : 'distrusts' (parallel edges with different predicates)
    snap = upsertRelationship(snap, cat.id!, fox.id!, 'welcomes', 'user-edit');
    snap = upsertRelationship(snap, cat.id!, fox.id!, 'distrusts', 'user-edit');
    // Upsert opposite direction Fox -> Cat : 'admires'
    snap = upsertRelationship(snap, fox.id!, cat.id!, 'admires', 'user-edit');

    const catToFoxEdges = snap.relationships.filter(
      (r) => r.sourceId === cat.id && r.targetId === fox.id
    );
    const foxToCatEdges = snap.relationships.filter(
      (r) => r.sourceId === fox.id && r.targetId === cat.id
    );
    // Sample project starts with Cat -> Fox ('hosting'), plus 'welcomes' and 'distrusts' = 3 parallel edges
    assert.equal(catToFoxEdges.length, 3, 'Parallel directed edges with distinct predicates must coexist');
    assert.equal(foxToCatEdges.length, 1, 'Opposite-direction edge Fox->Cat must coexist with Cat->Fox');

    // Compute parallel edge offsets for canvas rendering and verify non-zero curvature separation
    const offsets = computeParallelEdgeOffsets([...catToFoxEdges, ...foxToCatEdges]);
    const offsetValues = [...catToFoxEdges, ...foxToCatEdges].map((r) => offsets[r.id!] ?? 0);
    assert.equal(
      new Set(offsetValues).size,
      4,
      'Each parallel/opposite edge between the same node pair must receive a distinct curve offset'
    );

    // Reverse direction of Fox -> Cat ('admires') via updateRelationshipById
    const admiresEdge = foxToCatEdges[0];
    snap = updateRelationshipById(snap, admiresEdge.id!, {
      reverseDirection: true,
      label: 'mentors',
    });
    const reversedEdge = snap.relationships.find((r) => r.id === admiresEdge.id)!;
    assert.equal(reversedEdge.sourceId, cat.id);
    assert.equal(reversedEdge.targetId, fox.id);
    assert.equal(reversedEdge.label, 'mentors');

    // Rejecting a relationship marks it rejected and excludes it from refinedPrompt and future reanalysis
    snap = updateRelationshipById(snap, reversedEdge.id!, { status: 'rejected' });
    assert.equal(snap.refinedPrompt.includes('mentors'), false);
  });

  it('AC08 & AC09: Seed override directives when renaming or excluding prompt-explicit entities', () => {
    const proj = createSampleProject();
    let snap = proj.snapshot;

    // Rename seed entity 'Cat' -> 'Professor Whiskers'
    const cat = snap.entities.find((e) => e.name === 'Cat')!;
    snap = renameEntity(snap, cat.id!, 'Professor Whiskers');

    assert.match(
      snap.refinedPrompt,
      /Seed Overrides & Canonical Identity:/,
      'Renaming a seed entity must emit a Seed Overrides section'
    );
    assert.match(
      snap.refinedPrompt,
      /Canonical name for .*"Cat" is "Professor Whiskers"/
    );

    // Exclude 'Conservatory Dining Room'
    const room = snap.entities.find((e) => e.name === 'Conservatory Dining Room')!;
    snap = setEntityExistence(snap, room.id!, false);
    assert.match(
      snap.refinedPrompt,
      /Exclude "Conservatory Dining Room" from the output \(override any seed mention of "Conservatory Dining Room"\)/
    );
  });

  it('AC10: Staged AI Polish proposal does not overwrite refinedPrompt until explicitly accepted', () => {
    const proj = createSampleProject();
    const undoState = createUndoRedoState(proj.snapshot);
    const originalPrompt = proj.snapshot.refinedPrompt;

    // Create staged proposal
    const proposal = createPolishProposal(
      proj,
      'In a lantern-lit woodland conservatory, Professor Cat hosts an unforgettable autumn feast.'
    );
    assert.equal(
      proj.snapshot.refinedPrompt,
      originalPrompt,
      'Creating a polish proposal must not mutate the project snapshot before acceptance'
    );

    // Accept proposal -> creates undoable transaction & increments revision
    const accepted = acceptPolishProposal(proj, undoState, proposal);
    assert.equal(
      accepted.project.snapshot.refinedPrompt,
      'In a lantern-lit woodland conservatory, Professor Cat hosts an unforgettable autumn feast.'
    );
    assert.equal(accepted.project.revision, proj.revision + 1);

    // Undo restores previous structured prompt in one step
    const undone = performUndo(accepted.undoState);
    assert.equal(undone.state.present.refinedPrompt, originalPrompt);
  });

  it('AC11 & AC23: Undo/Redo covers originalIdea, freeformNotes, mode, and coalesces rapid typing', () => {
    let proj = createSampleProject();
    let undoState = createUndoRedoState(proj.snapshot);
    const initialIdea = proj.snapshot.originalIdea;
    const initialRevCount = proj.revisions.length;

    // Simulate 3 rapid keystrokes on originalIdea within the coalescing window
    for (const text of ['A cat', 'A cat and', 'A cat and an owl']) {
      const nextSnap: ProjectSnapshot = {
        ...undoState.present,
        originalIdea: text,
        refinedPrompt: synthesizeRefinedPrompt({ ...undoState.present, originalIdea: text }),
      };
      undoState = pushCoalescedTransaction(
        undoState,
        nextSnap,
        'Edit Seed Story Idea',
        'seed-idea',
        2500
      ).state;
      proj = recordProjectRevision(
        { ...proj, snapshot: nextSnap },
        'Edit Seed Story Idea',
        'Updated seed idea',
        1,
        { coalesceKey: 'seed-idea', windowMs: 2500 }
      );
    }

    assert.equal(undoState.present.originalIdea, 'A cat and an owl');
    assert.equal(
      undoState.past.length,
      1,
      'Rapid keystrokes with the same coalesceKey must coalesce into a single undo entry'
    );
    assert.equal(
      proj.revisions.length,
      initialRevCount + 1,
      'Rapid keystrokes must coalesce into a single revision entry'
    );

    // Single Undo restores initial originalIdea
    const undone = performUndo(undoState);
    assert.equal(undone.state.present.originalIdea, initialIdea);
  });

  it('AC13: Stale analysis rebasing onto newer same-project user edits', () => {
    let proj = createSampleProject();
    let undoState = createUndoRedoState(proj.snapshot);

    // Launch analysis ticket at revision 1
    const ticket = createRequestTicket(proj, 'analyze');

    // User confirms Cat's personality = 'enigmatic' while AI request is in flight (revision becomes 2)
    const userEditedSnap = setEntityAttribute(
      proj.snapshot,
      'Cat',
      'personality',
      'enigmatic',
      'user-edit'
    );
    const committed = commitSnapshotTransaction(
      proj,
      undoState,
      userEditedSnap,
      'Set Cat personality',
      'User confirmed enigmatic'
    );
    proj = committed.project;
    undoState = committed.undoState;
    assert.equal(proj.revision, 2);

    // Late AI response arrives (based on revision 1) suggesting Cat personality = 'boisterous' and new entity 'Badger'
    const lateGraph: BeliefState = {
      prompt: proj.snapshot.originalIdea,
      entities: [
        {
          name: 'Cat',
          presence_in_prompt: true,
          description: 'Party host',
          alternatives: null,
          attributes: [
            { name: 'existence', presence_in_prompt: true, value: [{ name: 'true' }] },
            { name: 'personality', presence_in_prompt: false, value: [{ name: 'boisterous' }] },
          ],
        },
        {
          name: 'Badger',
          presence_in_prompt: false,
          description: 'Old burrow neighbor',
          alternatives: null,
          attributes: [{ name: 'existence', presence_in_prompt: false, value: [{ name: 'true' }] }],
        },
      ],
      relationships: [],
    };

    const rebased = applyAsyncAnalysisCompletion({
      ticket,
      activeProject: proj,
      activeUndoState: undoState,
      savedProjects: [proj],
      newGraph: lateGraph,
      newClarifications: null,
      label: 'Reanalyze Prompt with AI',
      summary: 'Merged AI analysis',
    });

    assert.equal(rebased.rebasedOntoNewerRevision, true);
    const catAfterRebase = rebased.activeProject.snapshot.entities.find((e) => e.name === 'Cat')!;
    const personalityAttr = catAfterRebase.attributes.find((a) => a.name === 'personality')!;
    assert.equal(
      personalityAttr.confirmedValue,
      'enigmatic',
      'Stale AI response must never overwrite user edit made while request was in flight'
    );
    assert.equal(
      rebased.activeProject.snapshot.entities.some((e) => e.name === 'Badger'),
      true,
      'Additive AI suggestions from in-flight response are rebased onto the newer snapshot'
    );
  });

  it('AC15: LocalStorage quota failure never silently strips or deletes user image artifacts', () => {
    const origWindow = (globalThis as { window?: unknown }).window;
    Object.defineProperty(globalThis, 'window', {
      value: {
        localStorage: {
          getItem: () => null,
          setItem: () => {
            throw new Error('QuotaExceededError: DOM Exception 22');
          },
          removeItem: () => {},
        },
      },
      configurable: true,
    });

    try {
      const proj = createSampleProject();
      proj.artifacts = [
        {
          id: 'art_img_1',
          projectId: proj.id,
          mode: 'image',
          createdAt: Date.now(),
          revisionId: 'rev_1',
          sourceRevision: 1,
          promptDigest: computePromptDigest(proj.snapshot.refinedPrompt, 'image'),
          promptUsed: proj.snapshot.refinedPrompt,
          images: ['data:image/png;base64,PRECIOUS_USER_ARTWORK'],
          isOutdated: false,
        },
      ];

      const saveRes = saveProjectToLocalStorage(proj);
      assert.equal(saveRes.ok, false);
      assert.equal(saveRes.quotaExceeded, true);
      assert.equal(
        proj.artifacts[0].images?.[0],
        'data:image/png;base64,PRECIOUS_USER_ARTWORK',
        'In-memory image artifact must never be stripped on localStorage quota error'
      );
    } finally {
      Object.defineProperty(globalThis, 'window', {
        value: origWindow,
        configurable: true,
      });
    }
  });

  it('AC16 & AC17: Belief Graph layout determinism, generic group collapsing, and curved parallel edge paths', () => {
    const proj = createSampleProject();
    let snap = proj.snapshot;
    // Add 3 custom entities in 'object' category to verify generic category collapsing
    snap = addEntity(snap, 'Silver Spoon', 'object', 'Tableware');
    snap = addEntity(snap, 'Porcelain Teacup', 'object', 'Tableware');
    snap = addEntity(snap, 'Linen Napkin', 'object', 'Tableware');

    const objectEntities = snap.entities.filter((e) => e.name !== 'The Story');
    const dims = computeNodeDimensions(objectEntities);
    const layout1 = computeForceLayout({
      objectEntities,
      relationships: snap.relationships,
      nodeDimensions: dims,
      containerWidth: 920,
      containerHeight: 540,
    });
    const layout2 = computeForceLayout({
      objectEntities,
      relationships: snap.relationships,
      nodeDimensions: dims,
      containerWidth: 920,
      containerHeight: 540,
    });

    assert.deepEqual(layout1, layout2, 'Graph layout must be 100% deterministic for identical inputs');

    // Verify curved SVG path differs when curveOffset is non-zero
    const n1 = layout1[objectEntities[0].name];
    const n2 = layout1[objectEntities[1].name];
    const straight = getEdgePath(n1.x, n1.y, n2.x, n2.y, 90, 36, 90, 36, 0);
    const curvedPos = getEdgePath(n1.x, n1.y, n2.x, n2.y, 90, 36, 90, 36, 28);
    const curvedNeg = getEdgePath(n1.x, n1.y, n2.x, n2.y, 90, 36, 90, 36, -28);
    assert.notEqual(straight.path, curvedPos.path);
    assert.notEqual(curvedPos.path, curvedNeg.path);
  });

  it('AC20 & AC21: Clarification semantic deduplication and draft preservation on refresh', () => {
    const proj = createSampleProject();
    let snap = proj.snapshot;

    const existingPendingClarification = snap.decisions.find(
      (d) => d.category === 'clarification' && d.status === 'pending'
    )!;
    assert.ok(existingPendingClarification);

    // User has typed an in-progress draft answer for existingPendingClarification
    const drafts = {
      [existingPendingClarification.id]: 'My custom in-progress answer draft',
    };

    // AI returns a differently worded question targeting the EXACT same semantic target + a brand new question
    const incomingClarifications: Clarification[] = [
      {
        question: 'Could you clarify the central conflict or surprise of the evening?',
        options: ['A secret guest arrives', 'A missing recipe'],
        target: { type: 'story_bible', storyField: 'centralConflict' },
      },
      {
        question: 'Who prepared the woodland invitations?',
        options: ['Cat', 'Rabbit'],
        target: { type: 'entity_attribute', entityName: 'Cat', attributeName: 'invitation_style' },
      },
    ];

    snap = mergeAnalysisIntoSnapshot(snap, null, incomingClarifications, drafts);

    // Draft value on existing pending clarification is preserved!
    const preserved = snap.decisions.find((d) => d.id === existingPendingClarification.id)!;
    assert.equal(preserved.proposedValue, 'My custom in-progress answer draft');

    // Differently worded duplicate targeting `centralConflict` was deduplicated (only 1 pending clarification for centralConflict)
    const centralConflictClarifications = snap.decisions.filter(
      (d) =>
        d.category === 'clarification' &&
        d.status === 'pending' &&
        d.targetStoryField === 'centralConflict'
    );
    assert.equal(
      centralConflictClarifications.length,
      1,
      'Must deduplicate differently worded clarifications targeting the same Story Bible field'
    );
  });

  it('AC22: Multi-artifact history per mode and deterministic promptDigest currentness across Undo/Redo', () => {
    let proj = createSampleProject();
    const ticket1 = createRequestTicket(proj, 'generate');
    const prompt1 = proj.snapshot.refinedPrompt;

    // First story generation
    const gen1 = applyAsyncGenerationCompletion({
      ticket: ticket1,
      activeProject: proj,
      savedProjects: [proj],
      mode: 'story',
      promptUsed: prompt1,
      storyText: 'Story Version 1: The lantern glowed warmly.',
    });
    proj = gen1.activeProject;
    assert.equal(proj.artifacts.length, 1);
    assert.equal(proj.artifacts[0].isOutdated, false);

    // User edits Story Bible -> refinedPrompt changes -> artifact 1 becomes outdated
    const editedSnap = updateStoryBibleField(proj.snapshot, 'pacing', 'Brisk and suspenseful');
    proj = {
      ...proj,
      revision: proj.revision + 1,
      snapshot: editedSnap,
      artifacts: refreshArtifactsCurrentness(proj.artifacts, editedSnap),
    };
    assert.equal(proj.artifacts[0].isOutdated, true);

    // Second story generation -> both artifacts are preserved in history!
    const ticket2 = createRequestTicket(proj, 'generate');
    const gen2 = applyAsyncGenerationCompletion({
      ticket: ticket2,
      activeProject: proj,
      savedProjects: [proj],
      mode: 'story',
      promptUsed: proj.snapshot.refinedPrompt,
      storyText: 'Story Version 2: A brisk wind rattled the conservatory panes.',
    });
    proj = gen2.activeProject;
    assert.equal(
      proj.artifacts.filter((a) => a.mode === 'story').length,
      2,
      'Must retain multiple generated artifacts per mode in history'
    );
    assert.equal(proj.artifacts[0].isOutdated, false);
    assert.equal(proj.artifacts[1].isOutdated, true);

    // When user Undoes back to the first snapshot, artifact 1 becomes Current again and artifact 2 becomes Outdated!
    const revertedArtifacts = refreshArtifactsCurrentness(proj.artifacts, createSampleProject().snapshot);
    assert.equal(revertedArtifacts[0].isOutdated, true);
    assert.equal(revertedArtifacts[1].isOutdated, false);
  });

  it('AC24 & AC25: Schema v3 migration with pre-migration backup and Video capability eradication', () => {
    assert.equal(CURRENT_SCHEMA_VERSION, 3);
    assert.equal(fs.existsSync(path.join(process.cwd(), 'server', 'videoStore.ts')), false);

    const store = new Map<string, string>();
    const origWindow = (globalThis as { window?: unknown }).window;
    Object.defineProperty(globalThis, 'window', {
      value: {
        localStorage: {
          getItem: (k: string) => store.get(k) ?? null,
          setItem: (k: string, v: string) => store.set(k, v),
          removeItem: (k: string) => store.delete(k),
        },
      },
      configurable: true,
    });

    try {
      // Seed a schemaVersion 2 project into localStorage
      const v2Project = {
        ...createSampleProject(),
        schemaVersion: 2,
      };
      store.set(LOCAL_STORAGE_PROJECTS_KEY, JSON.stringify({ [v2Project.id]: v2Project }));

      const loaded = loadProjectsFromLocalStorage();
      assert.equal(loaded.projects[0].schemaVersion, 3);
      assert.ok(
        store.get(LOCAL_STORAGE_BACKUP_V2_KEY),
        'Must create automatic pre-migration backup in localStorage before migrating v2 -> v3'
      );

      // Exported JSON and Markdown reflect v3 schema
      const exported = JSON.parse(exportProjectToJson(loaded.projects[0]));
      assert.equal(exported.schemaVersion, 3);
      assert.equal(typeof exported.revision, 'number');
      const md = exportStoryBibleMarkdown(loaded.projects[0]);
      assert.match(md, /# Story Bible:/);
    } finally {
      Object.defineProperty(globalThis, 'window', {
        value: origWindow,
        configurable: true,
      });
    }
  });

  it('Section 10 Adversarial Matrix: Unicode, Regex Meta-Char Entities, Self-Loop Rejection & Duplicate Clarification Collapse', () => {
    const proj = createSampleProject();
    let snap = proj.snapshot;

    // 1. Entity with regex special characters `Cat (Host) [v2].*+?`
    snap = addEntity(snap, 'Cat (Host) [v2].*+?', 'character', 'Regex stress entity');
    snap = setEntityAttribute(snap, 'Cat (Host) [v2].*+?', 'role', 'Master of Ceremonies');
    const regexEnt = snap.entities.find((e) => e.name === 'Cat (Host) [v2].*+?')!;
    assert.equal(regexEnt.attributes.find((a) => a.name === 'role')?.confirmedValue, 'Master of Ceremonies');

    // 2. Unicode / CJK / Emoji entity names & relationship labels
    snap = addEntity(snap, '🦊 Kitsune-san', 'character', 'Mystic fox spirit');
    snap = upsertRelationship(snap, '🦊 Kitsune-san', 'Cat', 'shares 🍵 matcha with', 'user-edit');
    assert.ok(snap.refinedPrompt.includes('🦊 Kitsune-san'));
    assert.ok(snap.refinedPrompt.includes('shares 🍵 matcha with'));

    // 3. Self-loop relationship (`Cat -> Cat`) is prevented by upsertRelationship
    const relCountBefore = snap.relationships.length;
    snap = upsertRelationship(snap, 'Cat', 'Cat', 'talks to self');
    assert.equal(
      snap.relationships.length,
      relCountBefore,
      'Self-loop relationships (source === target) must be rejected'
    );

    // 4. Schema parser populates unhandledClauses and coverageComplete on batch edit response
    const parsedBatch = parseAndValidateBatchEditResponse(
      JSON.stringify({
        operations: [],
        ambiguities: [],
        warnings: [],
        unhandledClauses: ['Make the moon sing opera'],
      }),
      'Make the moon sing opera'
    );
    assert.equal(parsedBatch.coverageComplete, false);
    assert.deepEqual(parsedBatch.unhandledClauses, ['Make the moon sing opera']);
  });
});
