/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  createStarterManuscriptSections,
  describeEmptyOutlineState,
  executeNavigationWithFlush,
  shouldAllowNonDestructiveOverlay,
} from '../lib/controller/navigationFlush.ts';
import { createEmptyStoryBible, createSampleProject, makeStableId } from '../lib/canonicalModel.ts';
import { createUndoRedoState } from '../lib/historyEngine.ts';
import { manuscriptSections, narrativeBase, prepareManuscriptChange } from '../lib/narrative/manuscriptModel.ts';
import { prepareBackupCopy } from '../lib/narrative/recovery.ts';
import type { CreativeProject, ProjectSnapshot } from '../shared/types.ts';

describe('WP01 M4: Flush-on-switch navigation, onboarding, and recovery invariants', () => {
  it('flushes a dirty manuscript draft durably before executing workspace navigation', async () => {
    const events: string[] = [];
    const notifications: string[] = [];
    let dirty = true;

    const ok = await executeNavigationWithFlush(
      {
        isDraftDirty: () => dirty,
        isRestorePending: () => false,
        isCompositionPending: () => false,
        flushDraft: async () => {
          events.push('flush');
          dirty = false;
          return { ok: true, flushed: true };
        },
        notify: (msg) => notifications.push(msg),
      },
      () => {
        events.push('navigate');
      }
    );

    assert.equal(ok, true);
    assert.deepEqual(events, ['flush', 'navigate']);
    assert.deepEqual(notifications, []);
  });

  it('stays on the open draft and notifies clearly when durable flush fails (CAS/quota/IDB error)', async () => {
    let navigated = false;
    const notifications: string[] = [];

    const ok = await executeNavigationWithFlush(
      {
        isDraftDirty: () => true,
        isRestorePending: () => false,
        isCompositionPending: () => false,
        flushDraft: async () => ({
          ok: false,
          error: 'Storage quota exceeded. Export your draft before leaving.',
        }),
        notify: (msg) => notifications.push(msg),
      },
      () => {
        navigated = true;
      }
    );

    assert.equal(ok, false);
    assert.equal(navigated, false);
    assert.equal(notifications.length, 1);
    assert.match(notifications[0], /quota exceeded/i);
  });

  it('preserves IME composition and active restore guards while allowing non-destructive AI Settings overlay', async () => {
    let flushCalled = false;
    let navigated = false;
    const notifications: string[] = [];

    const blockedByIme = await executeNavigationWithFlush(
      {
        isDraftDirty: () => true,
        isRestorePending: () => false,
        isCompositionPending: () => true,
        flushDraft: async () => {
          flushCalled = true;
          return { ok: true };
        },
        notify: (msg) => notifications.push(msg),
      },
      () => {
        navigated = true;
      }
    );
    assert.equal(blockedByIme, false);
    assert.equal(flushCalled, false);
    assert.equal(navigated, false);
    assert.match(notifications[0], /composition/i);

    const blockedByRestore = await executeNavigationWithFlush(
      {
        isDraftDirty: () => true,
        isRestorePending: () => true,
        isCompositionPending: () => false,
        flushDraft: async () => {
          flushCalled = true;
          return { ok: true };
        },
        notify: (msg) => notifications.push(msg),
      },
      () => {
        navigated = true;
      }
    );
    assert.equal(blockedByRestore, false);
    assert.equal(flushCalled, false);
    assert.match(notifications[1], /restore/i);

    // Opening AI Settings does not block on dirty draft, only on active IME composition.
    assert.equal(
      shouldAllowNonDestructiveOverlay({
        isCompositionPending: () => false,
        notify: (msg) => notifications.push(msg),
      }),
      true
    );
    assert.equal(
      shouldAllowNonDestructiveOverlay({
        isCompositionPending: () => true,
        notify: (msg) => notifications.push(msg),
      }),
      false
    );
  });

  it('separates empty-manuscript outline copy from filtered-empty copy (F-15)', () => {
    const emptyMsg = describeEmptyOutlineState(0, false);
    assert.doesNotMatch(emptyMsg, /match these filters/i);
    assert.match(emptyMsg, /Add chapter/i);

    const emptyEvenWithSearch = describeEmptyOutlineState(0, true);
    assert.doesNotMatch(emptyEvenWithSearch, /match these filters/i);

    const filteredEmpty = describeEmptyOutlineState(4, true);
    assert.equal(filteredEmpty, 'No sections match these filters.');
  });

  it('builds a schema-valid opt-in starter Chapter 1 + Opening Scene for new projects', () => {
    const now = Date.now();
    const snap: ProjectSnapshot = {
      originalIdea: 'A coastal lighthouse mystery.',
      refinedPrompt: 'A coastal lighthouse mystery.',
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
    const baseProj: CreativeProject = {
      schemaVersion: 3,
      revision: 1,
      id: makeStableId('proj'),
      name: 'Beacon Watch',
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
          summary: 'Created project "Beacon Watch"',
          changeCount: 0,
          snapshot: structuredClone(snap),
        },
      ],
    };

    const starterSections = createStarterManuscriptSections(baseProj.name, snap.originalIdea);
    assert.equal(starterSections.length, 2);
    assert.equal(starterSections[0].kind, 'chapter');
    assert.equal(starterSections[1].kind, 'scene');
    assert.equal(starterSections[1].chapterId, starterSections[0].id);

    const prepared = prepareManuscriptChange(
      baseProj,
      createUndoRedoState(baseProj.snapshot, baseProj.revisions),
      narrativeBase(baseProj),
      starterSections
    );
    assert.ok(prepared);
    const persistedSections = manuscriptSections(prepared.project);
    assert.equal(persistedSections.length, 2);
    assert.equal(persistedSections[0].title, 'Chapter 1');
    assert.equal(persistedSections[1].title, 'Opening Scene');
  });

  it('keeps Restore as Copy non-destructive with a distinct project ID', () => {
    const original = createSampleProject();
    const copy = prepareBackupCopy(original);
    assert.notEqual(copy.id, original.id);
    assert.equal(copy.revision, 1);
  });
});
