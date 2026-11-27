/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  buildDecisionInboxFromSnapshot,
  createSampleProject,
} from '../lib/canonicalModel.ts';
import { buildDecisionInboxFromSnapshot as projectDecisionInbox } from '../lib/decisionInboxProjection.ts';
import type { Clarification, DecisionItem, Entity, ProjectSnapshot, Relationship } from '../shared/types.ts';

function cloneSampleSnapshot(): ProjectSnapshot {
  return structuredClone(createSampleProject(1763942400000).snapshot);
}

describe('Decision Inbox Projection Characterization', () => {
  it('uses the current authoring clock when new decisions are projected outside migration', () => {
    const snapshot = cloneSampleSnapshot();
    snapshot.decisions = [];
    const originalNow = Date.now;
    let now = 500;
    Date.now = () => ++now;
    try {
      const first = projectDecisionInbox(snapshot);
      const second = projectDecisionInbox(snapshot);
      assert.ok(first.length > 0);
      assert.ok(first.every(({ createdAt }) => createdAt === 501));
      assert.ok(second.every(({ createdAt }) => createdAt === 502));
    } finally {
      Date.now = originalNow;
    }
  });

  it('preserves 4-phase ordering: clarification -> attribute/story-bible -> relationship -> retained', () => {
    const snap = cloneSampleSnapshot();
    const retainedConflict: DecisionItem = {
      id: 'dec_conflict_custom',
      category: 'conflict',
      title: 'Conflicting edit',
      description: 'Conflict',
      explanation: 'Conflict',
      provenance: 'user-edit',
      status: 'pending',
      groupKey: 'story',
      proposedValue: 'A',
      createdAt: 100,
    };
    const retainedBatch: DecisionItem = {
      id: 'dec_batch_custom',
      category: 'batch-operation',
      title: 'Batch op',
      description: 'Batch',
      explanation: 'Batch',
      provenance: 'user-edit',
      status: 'pending',
      groupKey: 'plot',
      proposedValue: 'B',
      createdAt: 100,
    };
    snap.decisions.push(retainedConflict, retainedBatch);

    const items = buildDecisionInboxFromSnapshot(snap);
    const categories = items.map((i) => i.category);

    const firstAttrIdx = categories.findIndex((c) => c === 'attribute' || c === 'story-bible');
    const lastClarIdx = categories.lastIndexOf('clarification');
    const firstRelIdx = categories.indexOf('relationship');
    const lastAttrIdx = Math.max(
      categories.lastIndexOf('attribute'),
      categories.lastIndexOf('story-bible')
    );
    const conflictIdx = categories.indexOf('conflict');
    const batchIdx = categories.indexOf('batch-operation');

    assert.ok(lastClarIdx >= 0 && firstAttrIdx > lastClarIdx, 'Clarifications precede attributes/story-bible');
    assert.ok(firstRelIdx > lastAttrIdx, 'Relationships follow attributes/story-bible');
    assert.ok(conflictIdx > firstRelIdx && batchIdx > firstRelIdx, 'Retained items appear in phase 4');
  });

  it('does not mutate the input snapshot', () => {
    const snap = cloneSampleSnapshot();
    const frozenSnapshotJson = JSON.stringify(snap);
    buildDecisionInboxFromSnapshot(snap);
    assert.equal(JSON.stringify(snap), frozenSnapshotJson);
  });

  it('suppresses pending attribute only when an active pending clarification targets the same entity+attribute, and does not suppress on outdated clarification', () => {
    const snap = cloneSampleSnapshot();
    // Cat has pending 'personality' AND pending clarification 'clar_cat_personality' targeting Cat -> personality
    const activeItems = buildDecisionInboxFromSnapshot(snap);
    assert.equal(
      activeItems.some((d) => d.id === 'dec_attr_ent_cat_personality'),
      false,
      'Pending clarification suppresses duplicate attribute decision'
    );

    // Mark the clarification outdated -> attribute decision must appear again
    const catClar = snap.clarifications.find((c) => c.id === 'clar_cat_personality')!;
    catClar.status = 'outdated';
    catClar.outdatedReason = 'Cat renamed or modified';
    const outdatedItems = buildDecisionInboxFromSnapshot(snap);
    const clarDec = outdatedItems.find((d) => d.id === 'dec_clar_clar_cat_personality');
    assert.equal(clarDec?.status, 'outdated');
    assert.equal(clarDec?.explanation, 'Note: Cat renamed or modified');
    assert.equal(
      outdatedItems.some((d) => d.id === 'dec_attr_ent_cat_personality'),
      true,
      'Outdated clarification must NOT suppress pending attribute decision'
    );
  });

  it('generates stable IDs and maps scene-entity attributes to story-bible category with groupKey=story', () => {
    const snap = cloneSampleSnapshot();
    const items = buildDecisionInboxFromSnapshot(snap);
    const toneSceneDec = items.find((d) => d.id === 'dec_attr_ent_story_scene_tone');
    assert.ok(toneSceneDec, 'Expected stable scene attribute decision ID');
    assert.equal(toneSceneDec.category, 'story-bible');
    assert.equal(toneSceneDec.groupKey, 'story');

    const relDec = items.find((d) => d.id === 'dec_rel_rel_table_conservatory');
    assert.ok(relDec, 'Expected stable relationship decision ID');
    assert.equal(relDec.category, 'relationship');
    assert.equal(relDec.targetRelationshipId, 'rel_table_conservatory');
  });

  it('skips excluded or rejected entities and relationships with excluded endpoints', () => {
    const snap = cloneSampleSnapshot();
    const excludedEntity: Entity = {
      id: 'ent_ghost',
      name: 'Ghost',
      category: 'character',
      presence_in_prompt: false,
      description: 'Excluded',
      alternatives: null,
      status: 'confirmed',
      provenance: 'ai-inferred',
      excluded: true,
      attributes: [
        {
          id: 'attr_ghost_mood',
          name: 'mood',
          presence_in_prompt: false,
          value: [{ name: 'Eerie' }],
          status: 'pending',
          provenance: 'ai-inferred',
        },
      ],
    };
    const rejectedEntity: Entity = {
      id: 'ent_rejected',
      name: 'Rejected',
      category: 'character',
      presence_in_prompt: false,
      description: 'Rejected',
      alternatives: null,
      status: 'rejected',
      provenance: 'ai-inferred',
      attributes: [
        {
          id: 'attr_rej_mood',
          name: 'mood',
          presence_in_prompt: false,
          value: [{ name: 'Grumpy' }],
          status: 'pending',
          provenance: 'ai-inferred',
        },
      ],
    };
    const relWithExcluded: Relationship = {
      id: 'rel_cat_ghost',
      sourceId: 'ent_cat',
      targetId: 'ent_ghost',
      source: 'Cat',
      target: 'Ghost',
      label: 'avoids',
      status: 'pending',
      provenance: 'ai-inferred',
    };
    snap.entities.push(excludedEntity, rejectedEntity);
    snap.relationships.push(relWithExcluded);

    const items = buildDecisionInboxFromSnapshot(snap);
    assert.equal(items.some((d) => d.targetEntityId === 'ent_ghost'), false);
    assert.equal(items.some((d) => d.targetEntityId === 'ent_rejected'), false);
    assert.equal(items.some((d) => d.targetRelationshipId === 'rel_cat_ghost'), false);
  });

  it('preserves terminal retained decisions without duplicating items emitted in phases 1-3', () => {
    const snap = cloneSampleSnapshot();
    const answeredClar: Clarification = {
      id: 'clar_answered_1',
      question: 'Answered q?',
      options: ['Yes', 'No'],
      status: 'answered',
      category: 'plot',
      impact: 'Test',
    };
    const prevClarDec: DecisionItem = {
      id: 'dec_clar_clar_answered_1',
      category: 'clarification',
      title: 'Answered q?',
      description: 'Test',
      explanation: 'Test',
      provenance: 'ai-inferred',
      status: 'pending',
      groupKey: 'plot',
      proposedValue: 'Yes',
      createdAt: 100,
    };
    const orphanTerminal: DecisionItem = {
      id: 'dec_orphan_deferred',
      category: 'attribute',
      title: 'Old attribute',
      description: 'Old',
      explanation: 'Old',
      provenance: 'ai-inferred',
      status: 'deferred',
      groupKey: 'character',
      proposedValue: 'Wait',
      createdAt: 100,
    };
    snap.clarifications.push(answeredClar);
    snap.decisions.push(prevClarDec, orphanTerminal);

    const items = buildDecisionInboxFromSnapshot(snap);
    const matchingClar = items.filter((d) => d.id === 'dec_clar_clar_answered_1');
    assert.equal(matchingClar.length, 1);
    assert.equal(matchingClar[0].status, 'accepted');
    assert.equal(items.some((d) => d.id === 'dec_orphan_deferred'), true);
  });

  it('handles sourceBacked / epistemic attributes cleanly without dropping provenance', () => {
    const snap = cloneSampleSnapshot();
    const cat = snap.entities.find((e) => e.id === 'ent_cat')!;
    cat.attributes.push({
      id: 'attr_cat_secret',
      name: 'secret',
      presence_in_prompt: false,
      value: [{ name: 'Keeps a golden key' }],
      status: 'pending',
      provenance: 'imported',
      epistemicKind: 'reported',
      sourceBacked: true,
    });

    const items = buildDecisionInboxFromSnapshot(snap);
    const dec = items.find((d) => d.id === 'dec_attr_ent_cat_secret');
    assert.ok(dec);
    assert.equal(dec.provenance, 'imported');
    assert.equal(dec.proposedValue, 'Keeps a golden key');
  });
});
