/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  deriveTicketOperationActivities,
  filterOperationsForProject,
  formatOperationProgress,
  operationActivityReducer,
  type OperationActivityRecord,
} from '../lib/controller/useOperationActivity.ts';
import type { InFlightTicketsMap } from '../lib/projectController.ts';

describe('WP01 M6: Shared operation activity feedback & truthful progress', () => {
  it('tracks waiting -> running -> cancel-requested -> cancelled without fake % or ETA', () => {
    let state: OperationActivityRecord[] = [];
    state = operationActivityReducer(state, {
      type: 'START',
      record: {
        id: 'op-1',
        label: 'Semantic diagnostics',
        projectId: 'proj-a',
        revision: 4,
        phase: 'waiting',
        startedAt: 10_000,
        cancellable: true,
      },
    });
    assert.equal(state.length, 1);
    const waitingText = formatOperationProgress(state[0], 12_500);
    assert.equal(waitingText, 'Waiting · 2s elapsed');
    assert.doesNotMatch(waitingText, /%|ETA/i);

    state = operationActivityReducer(state, {
      type: 'UPDATE_PROGRESS',
      id: 'op-1',
      phase: 'running',
      completedUnits: 2,
      totalUnits: 5,
      unitLabel: 'segments',
      now: 14_000,
    });
    const runningText = formatOperationProgress(state[0], 15_000);
    assert.equal(runningText, 'Running (2/5 segments) · 5s elapsed');
    assert.doesNotMatch(runningText, /%|ETA/i);

    state = operationActivityReducer(state, {
      type: 'REQUEST_CANCEL',
      id: 'op-1',
      now: 16_000,
    });
    assert.equal(state[0].phase, 'cancel-requested');
    assert.match(formatOperationProgress(state[0], 17_000), /Cancel requested · 7s elapsed/);

    state = operationActivityReducer(state, {
      type: 'SETTLE',
      id: 'op-1',
      phase: 'cancelled',
      detail: 'Cancelled by author',
      now: 18_000,
    });
    assert.equal(state[0].phase, 'cancelled');
    assert.equal(state[0].cancellable, false);
    assert.equal(formatOperationProgress(state[0], 20_000), 'Cancelled by author');
  });

  it('preserves partial results cleanly with measured counts and dismisses cleanly', () => {
    let state = operationActivityReducer([], {
      type: 'START',
      record: {
        id: 'op-2',
        label: 'Narrative import',
        projectId: 'proj-a',
        revision: 2,
        phase: 'running',
        startedAt: 1_000,
        cancellable: true,
      },
    });

    state = operationActivityReducer(state, {
      type: 'SETTLE',
      id: 'op-2',
      phase: 'partial',
      completedUnits: 3,
      totalUnits: 4,
      detail: '3 chapters extracted before cancellation; partial draft preserved.',
      now: 9_000,
    });

    assert.equal(state[0].phase, 'partial');
    assert.match(
      formatOperationProgress(state[0], 10_000),
      /3\/4 items completed · 3 chapters extracted/
    );

    state = operationActivityReducer(state, { type: 'DISMISS', id: 'op-2' });
    assert.equal(state.length, 0);
  });

  it('binds ticket activities strictly to activeProjectId and exposes cancel-requested state', () => {
    const tickets: InFlightTicketsMap = {
      'proj-a::analyze': {
        requestId: 'req-1',
        projectId: 'proj-a',
        baseRevision: 7,
        action: 'analyze',
        mode: 'story',
        promptUsed: 'A coastal lighthouse mystery',
        promptDigest: 'digest-1',
        startedAt: 5_000,
      },
      'proj-b::generate': {
        requestId: 'req-2',
        projectId: 'proj-b',
        baseRevision: 3,
        action: 'generate',
        mode: 'story',
        promptUsed: 'Another story',
        promptDigest: 'digest-2',
        startedAt: 6_000,
      },
    };
    const started = new Map<string, number>([['proj-a::analyze', 5_000]]);
    const cancelSet = new Set<string>();

    const active = deriveTicketOperationActivities(tickets, 'proj-a', 7, started, cancelSet, 9_000);
    assert.equal(active.length, 1);
    assert.equal(active[0].label, 'Analyzing story idea');
    assert.equal(active[0].revision, 7);
    assert.equal(active[0].phase, 'running');
    assert.equal(active[0].cancellable, true);

    cancelSet.add('proj-a::analyze');
    const cancelling = deriveTicketOperationActivities(tickets, 'proj-a', 7, started, cancelSet, 10_000);
    assert.equal(cancelling[0].phase, 'cancel-requested');
    assert.equal(cancelling[0].cancellable, false);

    assert.equal(filterOperationsForProject(active, 'proj-b').length, 0);
  });
});
