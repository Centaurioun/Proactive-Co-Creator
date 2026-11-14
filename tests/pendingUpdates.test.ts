import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { buildGraphUpdates, decodePairKey, encodePairKey } from '../lib/pendingUpdates.ts';
import type { Relationship } from '../shared/types.ts';

describe('lib/pendingUpdates', () => {
  it('encodes and decodes composite keys safely when names contain colons or quotes', () => {
    const entity = 'Hero: "The Fox"';
    const attribute = 'time:of:day';
    const key = encodePairKey(entity, attribute);

    assert.deepEqual(decodePairKey(key), [entity, attribute]);
    assert.equal(decodePairKey('invalid-json'), null);
    assert.equal(decodePairKey('["only-one"]'), null);
    assert.equal(decodePairKey('[1, 2]'), null);
  });

  it('builds attribute, existence removal, and relationship updates cleanly', () => {
    const relationships: Relationship[] = [
      { source: 'Cat: Host', target: 'Cake: Tiered', label: 'cuts' },
    ];

    const pendingAttributes = {
      [encodePairKey('Cat: Host', 'color')]: 'tuxedo',
      [encodePairKey('Balloon', 'existence')]: 'false',
    };
    const pendingRelationships = {
      [encodePairKey('Cat: Host', 'Cake: Tiered')]: 'admires',
      [encodePairKey('Missing', 'Node')]: 'ignores',
    };

    const updates = buildGraphUpdates(pendingAttributes, pendingRelationships, relationships);

    assert.deepEqual(updates, [
      { type: 'attribute', entity: 'Cat: Host', attribute: 'color', value: 'tuxedo' },
      { type: 'attribute', entity: 'Balloon', attribute: 'existence', value: 'false' },
      {
        type: 'relationship',
        source: 'Cat: Host',
        target: 'Cake: Tiered',
        oldLabel: 'cuts',
        newLabel: 'admires',
      },
    ]);
  });
});
