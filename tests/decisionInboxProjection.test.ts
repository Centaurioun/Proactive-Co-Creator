/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { buildDecisionInboxFromSnapshot, createSampleProject } from '../lib/canonicalModel.ts';
import type { Attribute, DecisionItem, Entity, ProjectSnapshot } from '../shared/types.ts';

const attribute = (name: string, value: string, status: Attribute['status'] = 'pending'): Attribute => ({
  name, presence_in_prompt: false, value: [{ name: value }], status,
});
const entity = (id: string, name: string, attributes: Attribute[]): Entity => ({
  id, name, category: 'character', presence_in_prompt: true,
  description: '', alternatives: null, attributes,
});
const decision = (id: string, overrides: Partial<DecisionItem> = {}): DecisionItem => ({
  id, category: 'attribute', title: id, description: '', provenance: 'ai-inferred',
  status: 'pending', groupKey: 'character', proposedValue: 'Previous choice', createdAt: 123,
  ...overrides,
});

function fixture(): ProjectSnapshot {
  return {
    ...createSampleProject(100).snapshot,
    entities: [
      entity('a', 'Fox', [
        attribute('age', 'young'),
        attribute('color', 'amber'),
        attribute('existence', 'yes'),
        attribute('unknown', 'Unknown'),
        { ...attribute('confirmed', 'old', 'confirmed'), confirmedValue: 'new' },
      ]),
      entity('b', 'Rabbit', [attribute('role', 'host')]),
      { ...entity('excluded', 'Wolf', [attribute('role', 'guest')]), excluded: true },
    ],
    relationships: [
      { id: 'r1', sourceId: 'a', targetId: 'b', source: 'Old Fox', target: 'Rabbit', label: 'trusts', status: 'pending', alternatives: [{ name: 'trusts' }, { name: 'knows' }] },
      { id: 'r2', sourceId: 'b', targetId: 'a', source: 'Rabbit', target: 'Fox', label: 'hosts', status: 'confirmed' },
      { id: 'r3', sourceId: 'excluded', targetId: 'a', source: 'Wolf', target: 'Fox', label: 'follows', status: 'pending' },
    ],
    clarifications: [
      { id: 'age', question: 'Fox age?', options: ['young', 'old'], category: 'character', target: { type: 'entity_attribute', entityId: 'a', entityName: 'FOX', attributeName: 'Age' }, status: 'unanswered' },
      { id: 'done', question: 'Resolved?', options: ['yes'], status: 'answered' },
      { id: 'skipped', question: 'Skipped?', options: ['yes'], status: 'skipped' },
      { id: 'stale', question: 'Old question?', options: ['yes'], status: 'outdated', outdatedReason: 'Target changed' },
    ],
    decisions: [
      decision('dec_clar_age', { category: 'clarification', proposedValue: 'old' }),
      decision('dec_clar_done', { category: 'clarification' }),
      decision('dec_clar_skipped', { category: 'clarification' }),
      decision('dec_attr_a_color', { status: 'deferred', proposedValue: 'green' }),
      decision('dec_attr_a_confirmed', { status: 'accepted' }),
      decision('dec_rel_r2', { category: 'relationship', status: 'accepted' }),
      decision('conflict', { category: 'conflict' }),
      decision('batch', { category: 'batch-operation' }),
      decision('terminal', { status: 'rejected' }),
      decision('obsolete-pending'),
    ],
  };
}

describe('Decision inbox projection characterization', () => {
  it('preserves phase ordering, stable identity, exclusions, duplicate suppression and retained decisions', () => {
    const snapshot = fixture();
    const before = structuredClone(snapshot);
    const items = buildDecisionInboxFromSnapshot(snapshot);
    assert.deepEqual(items.map((item) => item.id), [
      'dec_clar_age', 'dec_clar_done', 'dec_clar_skipped', 'dec_clar_stale',
      'dec_attr_a_color', 'dec_attr_a_confirmed', 'dec_attr_b_role',
      'dec_rel_r1', 'dec_rel_r2', 'conflict', 'batch', 'terminal',
    ]);
    assert.deepEqual(snapshot, before, 'Projection must not mutate the canonical snapshot');
    const byId = new Map(items.map((item) => [item.id, item]));
    assert.equal(byId.get('dec_clar_age')?.proposedValue, 'old');
    assert.equal(byId.get('dec_clar_age')?.createdAt, 123);
    assert.equal(byId.get('dec_clar_done')?.status, 'accepted');
    assert.equal(byId.get('dec_clar_skipped')?.status, 'rejected');
    assert.equal(byId.get('dec_clar_stale')?.status, 'outdated');
    assert.equal(byId.get('dec_clar_stale')?.explanation, 'Note: Target changed');
    assert.equal(byId.get('dec_attr_a_color')?.status, 'deferred');
    assert.equal(byId.get('dec_attr_a_color')?.proposedValue, 'green');
    assert.equal(byId.get('dec_attr_a_confirmed')?.proposedValue, 'new');
    assert.equal(byId.get('dec_rel_r1')?.title, 'Fox → Rabbit');
    assert.deepEqual(byId.get('dec_rel_r1')?.options, ['trusts', 'knows']);
    assert.equal(byId.get('dec_rel_r2')?.proposedValue, 'hosts');
  });

  it('does not suppress an attribute suggestion for an outdated clarification', () => {
    const snapshot = fixture();
    snapshot.clarifications[0].status = 'outdated';
    const items = buildDecisionInboxFromSnapshot(snapshot);
    assert.equal(items.find((item) => item.id === 'dec_clar_age')?.status, 'outdated');
    assert.equal(items.find((item) => item.id === 'dec_attr_a_age')?.proposedValue, 'young');
  });
});
