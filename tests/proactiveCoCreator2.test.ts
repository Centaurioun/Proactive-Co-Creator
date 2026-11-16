import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {
  addEntity,
  applyDecisionBatch,
  createSampleProject,
  mergeAnalysisIntoSnapshot,
  removeRelationship,
  renameEntity,
  setEntityAttribute,
  setEntityExistence,
  updateStoryBibleField,
  upsertRelationship,
} from '../lib/canonicalModel.ts';
import { synthesizeRefinedPrompt } from '../lib/promptBuilder.ts';
import { applyProposedOperations, interpretBatchInstructionLocally } from '../lib/nlBatchEngine.ts';
import { evaluateProjectConsistency } from '../lib/consistencyChecker.ts';
import {
  createUndoRedoState,
  performRedo,
  performUndo,
  pushUndoableTransaction,
  recordProjectRevision,
  restoreProjectRevision,
} from '../lib/historyEngine.ts';
import {
  deleteProjectFromLocalStorage,
  exportProjectToJson,
  exportStoryBibleMarkdown,
  loadProjectsFromLocalStorage,
  migrateProjectPayload,
  saveProjectToLocalStorage,
} from '../lib/storageEngine.ts';
import { getEffectiveAttributeValue } from '../lib/beliefGraphUtils.ts';
import { GEMINI_MODELS } from '../server/models.ts';
import type { BeliefState, Clarification } from '../shared/types.ts';

describe('Proactive Co-Creator 2.0 Comprehensive Suite (Test Groups A–L & Scenarios 1–8)', () => {
  it('Test Group A — Video Removal & Legacy Video Project Migration', () => {
    // 1. server/videoStore.ts must not exist
    assert.equal(fs.existsSync(path.join(process.cwd(), 'server', 'videoStore.ts')), false);
    // 2. GEMINI_MODELS has only text and image
    assert.deepEqual(Object.keys(GEMINI_MODELS).sort(), ['image', 'text']);
    // 3. Default sample project mode is 'story'
    const sample = createSampleProject();
    assert.equal(sample.snapshot.mode, 'story');

    // 4. Legacy v1 saved project with mode='video' migrates cleanly to 'story' without losing data
    const legacyV1Payload = {
      id: 'proj_legacy_vid',
      name: 'Legacy Video Story',
      mode: 'video',
      prompt: 'A video camera filming a cat party in a theater.',
      entities: [
        {
          name: 'Cat',
          presence_in_prompt: true,
          description: 'A cat holding a party',
          alternatives: [{ name: 'Tabby' }],
          attributes: [
            { name: 'existence', presence_in_prompt: true, value: [{ name: 'true' }] },
            { name: 'mood', presence_in_prompt: false, value: [{ name: 'excited' }] },
          ],
        },
      ],
      relationships: [],
      story: 'The cat welcomed guests into the vintage theater.',
      images: ['data:image/png;base64,LEGACY_IMG'],
    };

    const migrated = migrateProjectPayload(legacyV1Payload);
    assert.ok(migrated);
    assert.equal(migrated.snapshot.mode, 'story');
    assert.equal(
      migrated.snapshot.originalIdea,
      'A video camera filming a cat party in a theater.'
    );
    assert.equal(migrated.snapshot.entities.some((e) => e.name === 'Cat'), true);
    assert.equal(migrated.artifacts.length, 2);
  });

  it('Test Group B — Canonical State, Stable IDs, Renames, Exclusions & User Authority', () => {
    const project = createSampleProject();
    let snap = project.snapshot;

    const cat = snap.entities.find((e) => e.name === 'Cat');
    assert.ok(cat?.id);
    const catId = cat.id!;

    // User sets Cat personality to 'secretive'
    snap = setEntityAttribute(snap, catId, 'personality', 'secretive', 'user-edit');
    const updatedCat = snap.entities.find((e) => e.id === catId)!;
    const personalityAttr = updatedCat.attributes.find((a) => a.name === 'personality')!;
    assert.equal(getEffectiveAttributeValue(personalityAttr), 'secretive');
    assert.equal(personalityAttr.status, 'confirmed');
    assert.equal(personalityAttr.provenance, 'user-edit');

    // Rename 'Cat' -> 'Professor Whiskers' and verify relationships preserve canonical ID & update endpoints
    snap = renameEntity(snap, catId, 'Professor Whiskers');
    const renamedCat = snap.entities.find((e) => e.id === catId)!;
    assert.equal(renamedCat.name, 'Professor Whiskers');
    assert.ok(renamedCat.aliases?.includes('Cat'));
    const hostingRel = snap.relationships.find((r) => r.sourceId === catId);
    assert.ok(hostingRel);
    assert.equal(hostingRel.source, 'Professor Whiskers');

    // Exclude an entity ('Conservatory Dining Room') and verify explicitExclusions list + prompt exclusion
    const conservatory = snap.entities.find((e) => e.name === 'Conservatory Dining Room')!;
    snap = setEntityExistence(snap, conservatory.id!, false);
    assert.equal(
      snap.storyBible.explicitExclusions.value.includes('Conservatory Dining Room'),
      true
    );

    // Reanalysis must NEVER overwrite user-confirmed attributes, renames, or exclusions
    const incomingAiGraph: BeliefState = {
      prompt: snap.originalIdea,
      entities: [
        {
          name: 'Cat', // old name before user rename!
          presence_in_prompt: true,
          description: 'AI generic description',
          alternatives: [{ name: 'Kitten' }],
          attributes: [
            { name: 'existence', presence_in_prompt: true, value: [{ name: 'true' }] },
            { name: 'personality', presence_in_prompt: false, value: [{ name: 'extroverted' }] },
          ],
        },
        {
          name: 'Conservatory Dining Room', // excluded by user!
          presence_in_prompt: false,
          description: 'AI tries to re-enable',
          alternatives: null,
          attributes: [
            { name: 'existence', presence_in_prompt: false, value: [{ name: 'true' }] },
          ],
        },
        {
          name: 'Acoustic Guitar', // new AI inferred entity
          presence_in_prompt: false,
          description: 'Instrument in the corner',
          alternatives: null,
          attributes: [
            { name: 'existence', presence_in_prompt: false, value: [{ name: 'true' }] },
          ],
        },
      ],
      relationships: [],
    };

    const merged = mergeAnalysisIntoSnapshot(snap, incomingAiGraph, []);
    const mergedCat = merged.entities.find((e) => e.id === catId)!;
    assert.equal(mergedCat.name, 'Professor Whiskers', 'User rename must survive reanalysis');
    const mergedPersonality = mergedCat.attributes.find((a) => a.name === 'personality')!;
    assert.equal(
      getEffectiveAttributeValue(mergedPersonality),
      'secretive',
      'User confirmed attribute must not be overwritten by AI suggestion'
    );
    const mergedConservatory = merged.entities.find((e) => e.id === conservatory.id)!;
    assert.equal(
      mergedConservatory.excluded,
      true,
      'User excluded entity must stay excluded after reanalysis'
    );
    assert.equal(merged.entities.some((e) => e.name === 'Acoustic Guitar'), true);
  });

  it('Test Group C & D — Decision Inbox Batch Operations, Conflict Detection & Clarifications 2.0', () => {
    const project = createSampleProject();
    const snap = project.snapshot;

    // Pending decisions exist in initial sample project
    const pendingItems = snap.decisions.filter((d) => d.status === 'pending');
    assert.ok(pendingItems.length >= 4);

    // Test atomic conflict rejection when two selected decisions target the same Story Bible field or entity attribute
    const targetItem = pendingItems[0];
    const syntheticConflictItem = {
      ...targetItem,
      id: 'dec_conflict_999',
      proposedValue: 'conflicting_value',
    };
    const snapWithConflict = {
      ...snap,
      decisions: [...snap.decisions, syntheticConflictItem],
    };
    const conflictResult = applyDecisionBatch(
      snapWithConflict,
      [targetItem.id, 'dec_conflict_999'],
      'accept'
    );
    assert.ok(conflictResult.conflicts.length > 0, 'Must detect conflicting batch selections');

    // Valid batch accept of 3 non-conflicting items updates Story Bible, Entity Attributes, and Refined Prompt
    const threeIds = pendingItems.slice(0, 3).map((d) => d.id);
    const batchAccepted = applyDecisionBatch(snap, threeIds, 'accept');
    assert.equal(batchAccepted.conflicts.length, 0);
    assert.equal(batchAccepted.appliedCount, 3);

    // Clarification answer targeting a Story Bible field updates Story Bible directly
    const conflictClarification = batchAccepted.snapshot.decisions.find(
      (d) => d.targetStoryField === 'centralConflict' && d.status === 'pending'
    );
    assert.ok(conflictClarification);
    const customAccepted = applyDecisionBatch(
      batchAccepted.snapshot,
      [conflictClarification.id],
      'accept',
      { [conflictClarification.id]: 'Midsummer Harvest Mystery' }
    );
    assert.equal(
      customAccepted.snapshot.storyBible.centralConflict.value,
      'Midsummer Harvest Mystery'
    );
    assert.equal(
      customAccepted.snapshot.storyBible.centralConflict.status,
      'confirmed'
    );

    // Refreshing clarifications preserves pending draft answers and avoids asking about already-confirmed targets
    const newAiClarifications: Clarification[] = [
      {
        question: 'What is the genre of the story?',
        options: ['Sci-Fi', 'Fable'],
        target: { type: 'story_bible', storyField: 'genre' }, // genre is already confirmed in sample project!
      },
      {
        question: 'What pacing should the dinner conversation have?',
        options: ['Brisk and witty', 'Slow and atmospheric'],
        target: { type: 'story_bible', storyField: 'pacing' },
      },
    ];
    const refreshed = mergeAnalysisIntoSnapshot(
      customAccepted.snapshot,
      null,
      newAiClarifications
    );
    const pendingClarifications = refreshed.decisions.filter(
      (d) => d.category === 'clarification' && d.status === 'pending'
    );
    assert.equal(
      pendingClarifications.some((d) => d.title.includes('genre of the story')),
      false,
      'Must deduplicate clarification whose Story Bible target is already confirmed'
    );
  });

  it('Test Group E — Belief Graph 2.0 Add/Remove Entities & Relationships Without Corrupting State', () => {
    const project = createSampleProject();
    let snap = project.snapshot;

    snap = addEntity(snap, 'Tea Kettle', 'object', 'Steaming copper kettle on the table');
    const kettle = snap.entities.find((e) => e.name === 'Tea Kettle');
    assert.ok(kettle?.id);

    const cat = snap.entities.find((e) => e.name === 'Cat')!;
    snap = upsertRelationship(snap, cat.id!, kettle.id!, 'pouring from', 'user-edit');
    const rel = snap.relationships.find(
      (r) => r.sourceId === cat.id && r.targetId === kettle.id
    );
    assert.ok(rel);
    assert.equal(rel.label, 'pouring from');

    snap = removeRelationship(snap, rel.id!);
    assert.equal(
      snap.relationships.some((r) => r.id === rel.id),
      false
    );
  });

  it('Test Group F — Natural-Language Batch Editing (Group Operations, Exceptions, Ambiguity & Partial Apply)', () => {
    const project = createSampleProject();
    const snap = project.snapshot;

    // 1. Canonical benchmark instruction:
    // "Make all the animal guests elderly, but keep the cat young. The party should be mysterious rather than cheerful."
    const instruction =
      'Make all the animal guests elderly, but keep the cat young. The party should be mysterious rather than cheerful.';
    const proposal = interpretBatchInstructionLocally(instruction, snap);

    assert.equal(proposal.warnings.length, 0);
    assert.ok(proposal.operations.length >= 4);

    // Verify animal guests (Rabbit, Fox) get age=Elderly
    const foxOp = proposal.operations.find(
      (op) => op.entityName === 'Fox' && op.attributeName === 'age'
    );
    assert.ok(foxOp);
    assert.equal(foxOp.nextValue?.toLowerCase(), 'elderly');

    // Verify exception: Cat gets age=Young
    const catOp = proposal.operations.find(
      (op) => op.entityName === 'Cat' && op.attributeName === 'age'
    );
    assert.ok(catOp);
    assert.equal(catOp.nextValue?.toLowerCase(), 'young');

    // Verify tone update: mysterious
    const toneOp = proposal.operations.find(
      (op) => op.type === 'update_story_bible' && op.storyField === 'tone'
    );
    assert.ok(toneOp);
    assert.equal(toneOp.nextValue?.toLowerCase(), 'mysterious');

    // 2. Partial operation deselection: uncheck Fox operation before applying
    const partialOps = proposal.operations.map((op) =>
      op.entityName === 'Fox' ? { ...op, selected: false } : op
    );
    const { snapshot: applied, appliedCount } = applyProposedOperations(snap, partialOps);
    assert.ok(appliedCount >= 3);

    const updatedCat = applied.entities.find((e) => e.name === 'Cat')!;
    assert.equal(
      getEffectiveAttributeValue(updatedCat.attributes.find((a) => a.name === 'age')!).toLowerCase(),
      'young'
    );
    const updatedRabbit = applied.entities.find((e) => e.name === 'Rabbit')!;
    assert.equal(
      getEffectiveAttributeValue(updatedRabbit.attributes.find((a) => a.name === 'age')!).toLowerCase(),
      'elderly'
    );
    const untouchedFox = applied.entities.find((e) => e.name === 'Fox')!;
    assert.equal(
      untouchedFox.attributes.find((a) => a.name === 'age')?.status,
      'pending',
      'Unselected operation in batch preview must not be confirmed'
    );
    assert.match(applied.storyBible.tone.value.toLowerCase(), /mysterious/);

    // 3. Second benchmark instruction: "All guests should be friendly, except the wolf."
    const friendlyProposal = interpretBatchInstructionLocally(
      'All guests should be friendly, except the wolf.',
      snap
    );
    const rabbitFriendly = friendlyProposal.operations.find(
      (op) => op.entityName === 'Rabbit' && op.attributeName === 'personality'
    );
    const wolfAdded = friendlyProposal.operations.find(
      (op) => op.type === 'add_entity' && op.entityName === 'Wolf'
    );
    assert.equal(rabbitFriendly?.nextValue?.toLowerCase(), 'friendly');
    assert.ok(wolfAdded);

    // 4. Ambiguous pronoun detection: "Make him older"
    const ambiguousProposal = interpretBatchInstructionLocally('Make him older', snap);
    assert.ok(
      ambiguousProposal.ambiguities.length > 0,
      'Ambiguous pronoun with multiple characters must emit an ambiguity entry'
    );
  });

  it('Test Group G & H — Consistency Checker, Undo/Redo Stack, Branch Invalidation & Revision Restore Safety', () => {
    const project = createSampleProject();
    const initialSnap = project.snapshot;
    let history = createUndoRedoState(initialSnap);

    // Consistency check detects violated exclusion when entity is listed in Explicit Exclusions while still Present
    const inconsistentSnap = updateStoryBibleField(
      initialSnap,
      'explicitExclusions',
      'Rabbit'
    );
    const issues = evaluateProjectConsistency(inconsistentSnap);
    assert.ok(
      issues.some((i) => i.category === 'violated_exclusion'),
      'Must flag excluded entity still marked Present in graph'
    );

    // Undo / Redo single transaction for batch edit
    const proposal = interpretBatchInstructionLocally(
      'Make all the animal guests elderly, but keep the cat young.',
      initialSnap
    );
    const { snapshot: afterBatch } = applyProposedOperations(initialSnap, proposal.operations);
    history = pushUndoableTransaction(history, afterBatch, 'Batch Edit: elderly guests');

    const undone = performUndo(history);
    assert.equal(undone.undoneLabel, 'Batch Edit: elderly guests');
    history = undone.state;
    const catAfterUndo = history.present.entities.find((e) => e.name === 'Cat')!;
    assert.equal(
      catAfterUndo.attributes.find((a) => a.name === 'age')?.status,
      'pending',
      'Undo must restore previous attribute state in one step'
    );

    const redone = performRedo(history);
    assert.equal(redone.redoneLabel, 'Batch Edit: elderly guests');
    history = redone.state;
    const catAfterRedo = history.present.entities.find((e) => e.name === 'Cat')!;
    assert.equal(
      getEffectiveAttributeValue(catAfterRedo.attributes.find((a) => a.name === 'age')!).toLowerCase(),
      'young'
    );

    // New action after Undo invalidates Redo branch cleanly
    history = performUndo(history).state;
    const manualEdit = updateStoryBibleField(history.present, 'pacing', 'Fast-paced');
    history = pushUndoableTransaction(history, manualEdit, 'Update pacing');
    assert.equal(history.future.length, 0, 'New action after undo must clear redo stack');

    // Named Revision & Non-destructive Restore (creates safety backup revision automatically)
    let projWithRev = recordProjectRevision(
      { ...project, snapshot: manualEdit },
      'Checkpoint Alpha',
      'Manual checkpoint',
      1
    );
    const checkpointId = projWithRev.revisions[0].id;
    const furtherEdited = updateStoryBibleField(
      projWithRev.snapshot,
      'genre',
      'Cyberpunk Noir'
    );
    projWithRev = { ...projWithRev, snapshot: furtherEdited };

    const restoredRes = restoreProjectRevision(projWithRev, history, checkpointId);
    assert.ok(restoredRes);
    assert.equal(
      restoredRes.project.snapshot.storyBible.genre.value,
      manualEdit.storyBible.genre.value
    );
    assert.ok(
      restoredRes.project.revisions.some((r) => r.label.includes('Before restoring')),
      'Restoring a revision must create a non-destructive safety backup first'
    );
  });

  it('Test Group I & J — LocalStorage Persistence, Multi-Tab Conflict Detection, JSON Export/Import & Markdown Export', () => {
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
      const project = createSampleProject();
      const firstSave = saveProjectToLocalStorage(project);
      assert.equal(firstSave.ok, true);
      assert.equal(Boolean(firstSave.conflictDetected), false);

      const loaded = loadProjectsFromLocalStorage();
      assert.equal(loaded.projects.length, 1);
      assert.equal(loaded.projects[0].id, project.id);

      // Simulate another tab saving a newer timestamp for the same project
      const newerExternalProject = {
        ...project,
        updatedAt: project.updatedAt + 60_000,
      };
      saveProjectToLocalStorage(newerExternalProject);

      // Saving stale project with older expectedMinUpdatedAt detects conflict
      const staleSave = saveProjectToLocalStorage(project, project.updatedAt);
      assert.equal(staleSave.conflictDetected, true);

      // JSON Export & Import Round-trip
      const jsonString = exportProjectToJson(project);
      const reimported = migrateProjectPayload(JSON.parse(jsonString));
      assert.ok(reimported);
      assert.equal(reimported.name, project.name);
      assert.equal(reimported.snapshot.entities.length, project.snapshot.entities.length);

      // Reject malformed import payloads gracefully
      assert.throws(() => migrateProjectPayload(null), /Invalid project file/);
      assert.throws(() => migrateProjectPayload({ invalid: true }), /Malformed project JSON/);

      // Story Bible Markdown export contains key sections
      const md = exportStoryBibleMarkdown(project);
      assert.match(md, /# Story Bible:/);
      assert.match(md, /## 1\. Narrative & Creative Properties/);
      assert.match(md, /## 2\. Entities & Characters/);
      assert.match(md, /## 4\. Refined Prompt/);

      // Delete project (automatically seeds fallback sample so workspace is never empty)
      const remaining = deleteProjectFromLocalStorage(project.id);
      assert.equal(remaining.length, 1);
    } finally {
      Object.defineProperty(globalThis, 'window', {
        value: origWindow,
        configurable: true,
      });
    }
  });

  it('Refined Prompt Synthesis — Incorporates Confirmed Decisions and Excludes Unconfirmed/Rejected Suggestions', () => {
    const project = createSampleProject();
    let snap = project.snapshot;

    // Pending AI suggestion ('Candlelit and inviting') must NOT be in refined prompt before acceptance
    assert.equal(
      snap.refinedPrompt.includes('Candlelit and inviting'),
      false,
      'Unconfirmed AI suggestion must not leak into refined prompt'
    );

    // Exclude Fox and verify explicit exclusion appears in Do NOT include
    const fox = snap.entities.find((e) => e.name === 'Fox')!;
    snap = setEntityExistence(snap, fox.id!, false);
    const promptAfterExclusion = synthesizeRefinedPrompt(snap);
    assert.match(promptAfterExclusion, /Do NOT include \(Explicit Exclusions\):.*Fox/);
  });
});
