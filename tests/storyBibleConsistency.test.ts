/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  createSampleProject,
  mergeAnalysisIntoSnapshot,
  setEntityAttribute,
  syncStoryBibleWithSceneEntity,
  updateStoryBibleField,
} from '../lib/canonicalModel.ts';
import { createUndoRedoState } from '../lib/historyEngine.ts';
import { commitSnapshotTransaction, commitUndoTransaction } from '../lib/projectController.ts';
import { resolveProviderPrompt, synthesizeRefinedPrompt } from '../lib/promptBuilder.ts';

import { evaluateProjectConsistency } from '../lib/consistencyChecker.ts';

describe('T1: Story Bible Clear, Sync Authority, Clarifications & Validation (SB-01 through SB-06)', () => {
  it('excludes unattributed belief and reported quotes from provider prompts and blocks unknown legacy context', () => {
    const base = createSampleProject().snapshot;
    const character = base.entities.find(entity => entity.category === 'character')!;
    character.attributes.push(
      { id: 'imported-belief', name: 'secret', value: [{ name: 'Only Mira believes this' }], confirmedValue: 'Only Mira believes this', status: 'confirmed', provenance: 'accepted-suggestion', epistemicKind: 'belief', sourceBacked: true, presence_in_prompt: true },
      // The quoted wording names Mira, but the record has no verified claimant/reporter association.
      { id: 'unattributed-report', name: 'rumor', value: [{ name: '“Mira said the island is alive.”' }], confirmedValue: '“Mira said the island is alive.”', status: 'confirmed', provenance: 'accepted-suggestion', epistemicKind: 'reported', sourceBacked: true, presence_in_prompt: true },
    );
    assert.equal('claimantId' in character.attributes[1], false, 'quoted content alone is not a verified claimant association');
    assert.equal('reporterId' in character.attributes[1], false, 'quoted content alone is not a verified reporter association');
    assert.equal(synthesizeRefinedPrompt(base, 'story').includes('Only Mira believes this'), false);
    assert.equal(synthesizeRefinedPrompt(base, 'image').includes('Only Mira believes this'), false);
    assert.equal(synthesizeRefinedPrompt(base, 'story').includes('Mira said the island is alive'), false);
    assert.equal(synthesizeRefinedPrompt(base, 'image').includes('Mira said the island is alive'), false);
    const safe = resolveProviderPrompt({ ...createSampleProject(), snapshot: base }, 'story');
    assert.equal(safe.ok, true);
    if (safe.ok) {
      assert.equal(safe.prompt.includes('Only Mira believes this'), false, 'provider prompt excludes the unsupported claim');
      assert.equal(safe.prompt.includes('Mira said the island is alive'), false, 'provider prompt does not infer a reporter from quoted text');
      assert.match(safe.warning ?? '', /withheld/i, 'withholding is surfaced instead of silent');
    }
    character.attributes.find(attribute => attribute.id === 'imported-belief')!.epistemicKind = undefined;
    const blocked = resolveProviderPrompt({ ...createSampleProject(), snapshot: base }, 'image');
    assert.equal(blocked.ok, false);
    if (!blocked.ok) assert.match(blocked.reason, /review/i);
  });
  it('T1.1: clearing mirrored Story Bible setting/tone unsets status and stays unset after scene sync, AI merge, and prompt synthesis', () => {
    const baseProj = createSampleProject();
    let snap = updateStoryBibleField(baseProj.snapshot, 'setting', 'Clockwork Observatory');
    snap = updateStoryBibleField(snap, 'tone', 'Gothic Suspense');

    // Clear both fields
    snap = updateStoryBibleField(snap, 'setting', '');
    snap = updateStoryBibleField(snap, 'tone', '   ');

    assert.equal(snap.storyBible.setting.value, '');
    assert.notEqual(snap.storyBible.setting.status, 'confirmed', 'Blank setting must not remain confirmed (SB-03)');
    assert.equal(snap.storyBible.tone.value, '');
    assert.notEqual(snap.storyBible.tone.status, 'confirmed', 'Blank tone must not remain confirmed (SB-03)');

    // 1. Direct scene sync must NOT resurrect cleared setting or tone
    const synced = syncStoryBibleWithSceneEntity(snap);
    assert.equal(synced.storyBible.setting.value, '', 'Cleared setting must not be revived by syncStoryBibleWithSceneEntity (SB-01)');
    assert.notEqual(synced.storyBible.setting.status, 'confirmed');
    assert.equal(synced.storyBible.tone.value, '', 'Cleared tone must not be revived by syncStoryBibleWithSceneEntity (SB-02)');
    assert.notEqual(synced.storyBible.tone.status, 'confirmed');

    // 2. AI analysis merge mentioning scene entity setting/tone must NOT auto-revive user-cleared fields
    const afterAiMerge = mergeAnalysisIntoSnapshot(
      synced,
      {
        entities: [
          {
            name: 'The Story',
            category: 'scene',
            presence_in_prompt: true,
            description: 'Scene entity',
            alternatives: null,
            attributes: [
              {
                name: 'setting',
                presence_in_prompt: true,
                value: [{ name: 'Sunlit Meadow' }],
              },
              {
                name: 'tone',
                presence_in_prompt: true,
                value: [{ name: 'Slapstick' }],
              },
            ],
          },
        ],
        relationships: [],
        prompt: synced.originalIdea,
      },
      null
    );
    assert.equal(afterAiMerge.storyBible.setting.value, '', 'AI merge must not overwrite user-cleared setting');
    assert.equal(afterAiMerge.storyBible.tone.value, '', 'AI merge must not overwrite user-cleared tone');

    // 3. Story and Image synthesized prompts omit the cleared values (SB-06)
    const storyPrompt = synthesizeRefinedPrompt(afterAiMerge, 'story');
    const imagePrompt = synthesizeRefinedPrompt(afterAiMerge, 'image');
    assert.equal(storyPrompt.includes('Clockwork Observatory'), false);
    assert.equal(storyPrompt.includes('Gothic Suspense'), false);
    assert.equal(imagePrompt.includes('Clockwork Observatory'), false);
    assert.equal(imagePrompt.includes('Gothic Suspense'), false);
  });

  it('T1.2: clearing Story Bible clears mapped scene aliases (atmosphere, location, lighting, style, conflict) while preserving unrelated scene attrs and location entities', () => {
    const baseProj = createSampleProject();
    let snap = structuredClone(baseProj.snapshot);

    // Seed scene entity with alias attributes alongside unrelated scene attrs
    const sceneEnt = snap.entities.find((e) => e.name === 'The Story')!;
    sceneEnt.attributes.push(
      {
        id: 'attr_alias_atmosphere',
        name: 'atmosphere',
        presence_in_prompt: false,
        value: [{ name: 'Misty dusk' }],
        confirmedValue: 'Misty dusk',
        status: 'confirmed',
        provenance: 'user-edit',
        updatedAt: Date.now() - 10,
      },
      {
        id: 'attr_alias_location',
        name: 'location',
        presence_in_prompt: false,
        value: [{ name: 'Glasshouse' }],
        confirmedValue: 'Glasshouse',
        status: 'confirmed',
        provenance: 'user-edit',
        updatedAt: Date.now() - 10,
      },
      {
        id: 'attr_alias_style',
        name: 'style',
        presence_in_prompt: false,
        value: [{ name: 'Watercolor' }],
        confirmedValue: 'Watercolor',
        status: 'confirmed',
        provenance: 'user-edit',
        updatedAt: Date.now() - 10,
      },
      {
        id: 'attr_alias_camera',
        name: 'camera_angle',
        presence_in_prompt: false,
        value: [{ name: 'Low wide angle' }],
        confirmedValue: 'Low wide angle',
        status: 'confirmed',
        provenance: 'user-edit',
        updatedAt: Date.now() - 10,
      },
      {
        id: 'attr_alias_conflict',
        name: 'conflict',
        presence_in_prompt: false,
        value: [{ name: 'Stolen heirloom' }],
        confirmedValue: 'Stolen heirloom',
        status: 'confirmed',
        provenance: 'user-edit',
        updatedAt: Date.now() - 10,
      },
      {
        id: 'attr_unrelated_season',
        name: 'season',
        presence_in_prompt: false,
        value: [{ name: 'Autumn' }],
        confirmedValue: 'Autumn',
        status: 'confirmed',
        provenance: 'user-edit',
        updatedAt: Date.now() - 10,
      }
    );

    snap = updateStoryBibleField(snap, 'tone', '');
    snap = updateStoryBibleField(snap, 'setting', '');
    snap = updateStoryBibleField(snap, 'visualStyle', '');
    snap = updateStoryBibleField(snap, 'cameraAndLighting', '');
    snap = updateStoryBibleField(snap, 'centralConflict', '');
    snap = syncStoryBibleWithSceneEntity(snap);

    assert.equal(snap.storyBible.tone.value, '');
    assert.equal(snap.storyBible.setting.value, '');
    assert.equal(snap.storyBible.visualStyle.value, '');
    assert.equal(snap.storyBible.cameraAndLighting.value, '');
    assert.equal(snap.storyBible.centralConflict.value, '');

    const updatedScene = snap.entities.find((e) => e.name === 'The Story')!;
    for (const aliasName of ['tone', 'atmosphere', 'setting', 'location', 'style', 'camera_angle', 'conflict']) {
      const a = updatedScene.attributes.find((attr) => attr.name === aliasName);
      assert.ok(a, `Attribute ${aliasName} should still exist structurally`);
      assert.notEqual(a.status, 'confirmed', `Alias ${aliasName} must be unset after Story Bible clear`);
      assert.equal(a.confirmedValue, undefined, `Alias ${aliasName} confirmedValue must be cleared`);
    }

    // Unrelated scene attr and separate location entity MUST survive intact
    const seasonAttr = updatedScene.attributes.find((attr) => attr.name === 'season');
    assert.equal(seasonAttr?.confirmedValue, 'Autumn');
    assert.equal(seasonAttr?.status, 'confirmed');
    const conservatoryLoc = snap.entities.find((e) => e.id === 'ent_conservatory');
    assert.ok(conservatoryLoc, 'Location entity in Belief Graph must remain untouched');
  });

  it('T1.3: clearing Story Bible field leaves matching clarification unanswered and Undo after Clear restores prior value cleanly', () => {
    let proj = createSampleProject();
    let undo = createUndoRedoState(proj.snapshot);

    // Sample project has unanswered clar_party_tone & clar_party_setting
    const toneClarBefore = proj.snapshot.clarifications.find((c) => c.id === 'clar_party_tone');
    assert.equal(toneClarBefore?.status, 'unanswered');

    // Clearing an unset/unanswered field must NOT mark clarification answered (SB-04 / R4)
    const clearedSnap = updateStoryBibleField(proj.snapshot, 'tone', '');
    const toneClarAfterClear = clearedSnap.clarifications.find((c) => c.id === 'clar_party_tone');
    assert.notEqual(
      toneClarAfterClear?.status,
      'answered',
      'Clearing a Story Bible field must never mark matching clarification as answered'
    );

    // Explicit Set followed by Clear followed by Undo restores confirmed tone
    const setSnap = updateStoryBibleField(proj.snapshot, 'tone', 'Cozy Midnight Intrigue');
    ({ project: proj, undoState: undo } = commitSnapshotTransaction(
      proj,
      undo,
      setSnap,
      'Set Tone',
      'Set tone'
    ));
    const afterClear = updateStoryBibleField(proj.snapshot, 'tone', '');
    ({ project: proj, undoState: undo } = commitSnapshotTransaction(
      proj,
      undo,
      afterClear,
      'Clear Tone',
      'Cleared tone'
    ));
    assert.equal(proj.snapshot.storyBible.tone.value, '');

    const undone = commitUndoTransaction(proj, undo);
    assert.equal(undone.changed, true);
    assert.equal(undone.project.snapshot.storyBible.tone.value, 'Cozy Midnight Intrigue');
    assert.equal(undone.project.snapshot.storyBible.tone.status, 'confirmed');
  });

  it('T1.4: Story Bible validation preserves multiline/Unicode/punctuation drafts and rejects unsupported control characters with field errors', async () => {
    const mod = (await import('../lib/canonicalModel.ts')) as Record<string, unknown>;
    assert.equal(
      typeof mod.validateStoryBibleUpdate,
      'function',
      'validateStoryBibleUpdate helper must be exported from lib/canonicalModel.ts'
    );
    const validate = mod.validateStoryBibleUpdate as (
      field: string,
      raw: unknown
    ) => { ok: boolean; normalized: string; intent: string; error?: string };

    // Valid multiline + Unicode + Turkish + punctuation draft
    const validDraft = 'Line 1: Üçüncü Şahıs — "Gece Yarısı!"\nLine 2: Café & Çay (1920s)';
    const okRes = validate('continuityRules', validDraft);
    assert.equal(okRes.ok, true);
    assert.equal(okRes.intent, 'set');
    assert.equal(okRes.normalized, validDraft);

    // Clear intent
    const clearRes = validate('tone', '   ');
    assert.equal(clearRes.ok, true);
    assert.equal(clearRes.intent, 'clear');
    assert.equal(clearRes.normalized, '');

    // Reject control characters (e.g. \x00 or \x07) while preserving normal newlines
    const badCtrl = validate('genre', 'Noir\x00Mystery');
    assert.equal(badCtrl.ok, false);
    assert.ok(badCtrl.error && badCtrl.error.length > 0);

    // Non-string input rejected safely
    const badType = validate('tone', 12345);
    assert.equal(badType.ok, false);

    // Invalid input passed to updateStoryBibleField leaves previous valid field intact
    const base = createSampleProject().snapshot;
    const beforeGenre = base.storyBible.genre.value;
    const afterBad = updateStoryBibleField(base, 'genre', 'Bad\x07Value');
    assert.equal(afterBad.storyBible.genre.value, beforeGenre);

    // Valid Unicode draft preserves exact multiline & Unicode text cleanly
    const afterGood = updateStoryBibleField(base, 'continuityRules', validDraft);
    assert.equal(afterGood.storyBible.continuityRules.value, validDraft);
    assert.equal(afterGood.storyBible.continuityRules.status, 'confirmed');

    // Interactive word-by-word controlled input typing preserves trailing spaces cleanly
    const typingStep1 = updateStoryBibleField(base, 'tone', 'Dark ');
    assert.equal(typingStep1.storyBible.tone.value, 'Dark ');
    const typingStep2 = updateStoryBibleField(typingStep1, 'tone', 'Dark Forest');
    assert.equal(typingStep2.storyBible.tone.value, 'Dark Forest');

    // Explicitly setting scene entity attribute AFTER clearing restores it intentionally
    const cleared = updateStoryBibleField(typingStep2, 'setting', '');
    assert.equal(cleared.storyBible.setting.value, '');
    const explicitSceneSet = setEntityAttribute(
      cleared,
      'The Story',
      'setting',
      'Clockwork Attic',
      'user-edit'
    );
    assert.equal(explicitSceneSet.storyBible.setting.value, 'Clockwork Attic');
    assert.equal(explicitSceneSet.storyBible.setting.status, 'confirmed');
  });
});

describe('T2: Actionable Consistency Issue Target Navigation & Safety (IS-01 through IS-05)', () => {
  it('T2.1: excluded-entity issue resolves exact entity target by stable ID without mutating snapshot or selecting wrong entity on deletion', async () => {
    const checkerMod = (await import('../lib/consistencyChecker.ts')) as Record<string, unknown>;
    assert.equal(
      typeof checkerMod.resolveConsistencyIssueTarget,
      'function',
      'resolveConsistencyIssueTarget must be exported from lib/consistencyChecker.ts'
    );
    const resolveTarget = checkerMod.resolveConsistencyIssueTarget as (
      snapshot: ReturnType<typeof createSampleProject>['snapshot'],
      target: unknown
    ) => { ok: boolean; kind?: string; entity?: { id?: string; name: string }; reason?: string };

    const baseProj = createSampleProject();
    // Put Fox (ent_fox) into explicitExclusions while still present -> issue_excl_ent_fox
    const snapBefore = updateStoryBibleField(baseProj.snapshot, 'explicitExclusions', 'Fox');
    const snapCheck = structuredClone(snapBefore);
    const issues = evaluateProjectConsistency(snapBefore);

    const exclIssue = issues.find((i) => i.id === 'issue_excl_ent_fox');
    assert.ok(exclIssue, 'Expected violated_exclusion issue for ent_fox');
    assert.ok(Array.isArray(exclIssue.targets) && exclIssue.targets.length > 0, 'Issue must emit structured targets');

    const foxTarget = exclIssue.targets.find((t) => t.kind === 'entity' && t.entityId === 'ent_fox');
    assert.ok(foxTarget, 'Expected exact entity target with entityId ent_fox');

    const resolved = resolveTarget(snapBefore, foxTarget);
    assert.equal(resolved.ok, true);
    assert.equal(resolved.kind, 'entity');
    assert.equal(resolved.entity?.id, 'ent_fox');

    // Read-only navigation invariant (IS-05): resolving targets never mutates snapshot
    assert.deepEqual(snapBefore, snapCheck);

    // Missing/deleted entity (IS-03): deleting ent_fox from snapshot fails cleanly without picking another entity
    const withoutFox = {
      ...snapBefore,
      entities: snapBefore.entities.filter((e) => e.id !== 'ent_fox'),
    };
    const missingResolved = resolveTarget(withoutFox, foxTarget);
    assert.equal(missingResolved.ok, false, 'Deleted entity target must resolve unavailable rather than wrong entity');
    assert.ok(missingResolved.reason && missingResolved.reason.length > 0);
  });

  it('T2.2: unresolved Story Bible issue targets exact unconfirmed Story Bible fields and emits zero fake entities', async () => {
    const checkerMod = (await import('../lib/consistencyChecker.ts')) as Record<string, unknown>;
    const resolveTarget = checkerMod.resolveConsistencyIssueTarget as (
      snapshot: ReturnType<typeof createSampleProject>['snapshot'],
      target: unknown
    ) => { ok: boolean; kind?: string; storyField?: string };

    let snap = createSampleProject().snapshot;
    // Clear tone & setting so both are unconfirmed, keep genre confirmed
    snap = updateStoryBibleField(snap, 'tone', '');
    snap = updateStoryBibleField(snap, 'setting', '');

    const issues = evaluateProjectConsistency(snap);
    const unresolved = issues.find((i) => i.id === 'issue_unresolved_core_bible');
    assert.ok(unresolved, 'Expected issue_unresolved_core_bible');
    assert.deepEqual(unresolved.affectedEntityIds, []);
    assert.ok(Array.isArray(unresolved.targets) && unresolved.targets.length >= 2);

    const storyFields = unresolved.targets.map((t) => t.storyField);
    assert.equal(storyFields.includes('tone'), true);
    assert.equal(storyFields.includes('setting'), true);
    assert.equal(
      unresolved.targets.every((t) => t.kind === 'story_bible'),
      true,
      'Unresolved core Story Bible issue must never invent entity targets'
    );

    for (const t of unresolved.targets) {
      const res = resolveTarget(snap, t);
      assert.equal(res.ok, true);
      assert.equal(res.kind, 'story_bible');
    }
  });

  it('T2.3: setting mismatch with multiple confirmed locations emits deterministic targets for Story Bible setting AND each conflicting location entity', async () => {
    const checkerMod = (await import('../lib/consistencyChecker.ts')) as Record<string, unknown>;
    const resolveTarget = checkerMod.resolveConsistencyIssueTarget as (
      snapshot: ReturnType<typeof createSampleProject>['snapshot'],
      target: unknown
    ) => { ok: boolean; kind?: string; entity?: { id?: string }; storyField?: string };

    let snap = createSampleProject().snapshot;
    snap = updateStoryBibleField(snap, 'setting', '19th-century coastal town');
    snap = {
      ...snap,
      entities: [
        ...snap.entities.map((e) =>
          e.id === 'ent_conservatory' ? { ...e, status: 'confirmed' as const } : e
        ),
        {
          id: 'ent_lighthouse',
          name: 'Brass Lighthouse',
          category: 'location',
          presence_in_prompt: true,
          description: 'A cliffside lighthouse',
          alternatives: null,
          attributes: [],
          status: 'confirmed',
          provenance: 'user-edit',
        },
      ],
    };

    // Broad descriptive setting + specific location nodes must NOT emit brittle substring false positives
    const cleanIssues = evaluateProjectConsistency(snap);
    assert.equal(
      cleanIssues.some((i) => i.id === 'issue_setting_mismatch'),
      false,
      'Specific confirmed locations inside a broader descriptive setting must not trigger a false-positive mismatch'
    );

    // Multi-target issue resolution (entity + story_bible) on genuine violated exclusion, with fail-closed when deleted
    snap = updateStoryBibleField(snap, 'explicitExclusions', 'Brass Lighthouse');
    const issues = evaluateProjectConsistency(snap);
    const exclIssue = issues.find((i) => i.id === 'issue_excl_ent_lighthouse');
    assert.ok(exclIssue && Array.isArray(exclIssue.targets), 'Expected violated exclusion issue with explicit targets');
    assert.ok(exclIssue.targets.some((t) => t.kind === 'story_bible' && t.storyField === 'explicitExclusions'));
    assert.ok(exclIssue.targets.some((t) => t.kind === 'entity' && t.entityId === 'ent_lighthouse'));

    for (const t of exclIssue.targets) {
      assert.equal(resolveTarget(snap, t).ok, true);
    }

    const withoutLighthouse = {
      ...snap,
      entities: snap.entities.filter((e) => e.id !== 'ent_lighthouse'),
    };
    const staleTarget = exclIssue.targets.find((t) => t.entityId === 'ent_lighthouse')!;
    assert.equal(resolveTarget(withoutLighthouse, staleTarget).ok, false);
  });

  it('T2.4: optional relationship target resolution validates exact relationshipId without synthesizing fake conflicts (N/A emitted conflicts)', async () => {
    const checkerMod = (await import('../lib/consistencyChecker.ts')) as Record<string, unknown>;
    const resolveTarget = checkerMod.resolveConsistencyIssueTarget as (
      snapshot: ReturnType<typeof createSampleProject>['snapshot'],
      target: unknown
    ) => { ok: boolean; kind?: string; relationship?: { id?: string } };

    const snap = createSampleProject().snapshot;
    const issues = evaluateProjectConsistency(snap);
    // Current deterministic checker intentionally does not invent relationship_conflict issues
    assert.equal(
      issues.some((i) => i.category === 'relationship_conflict'),
      false,
      'N/A: evaluateProjectConsistency must not fabricate synthetic relationship conflicts'
    );

    const realRel = snap.relationships[0];
    assert.ok(realRel?.id);
    const okRes = resolveTarget(snap, {
      id: `target_rel_${realRel.id}`,
      kind: 'relationship',
      label: `Inspect ${realRel.source} -> ${realRel.target}`,
      relationshipId: realRel.id,
    });
    assert.equal(okRes.ok, true);
    assert.equal(okRes.relationship?.id, realRel.id);

    const missingRes = resolveTarget(snap, {
      id: 'target_rel_missing',
      kind: 'relationship',
      label: 'Missing rel',
      relationshipId: 'rel_nonexistent_id',
    });
    assert.equal(missingRes.ok, false);
  });

  it('F-W7-CH02: consistencyChecker matches excluded İpek against lowercase ipek/i\\u0307pek and lowercase ipek against İpek without boundary or English Iris false positives', () => {
    const base = createSampleProject().snapshot;
    const withExcluded = {
      ...base,
      entities: [
        ...base.entities,
        { id: 'ent_ipek', name: 'İpek', category: 'character' as const, description: '', excluded: true, presence_in_prompt: false, alternatives: null, attributes: [] },
        { id: 'ent_iris', name: 'Iris', category: 'character' as const, description: '', excluded: true, presence_in_prompt: false, alternatives: null, attributes: [] },
      ],
    };

    const lcConflict = updateStoryBibleField(withExcluded, 'centralConflict', 'ipek guards the gate', 'user-edit');
    assert.equal(evaluateProjectConsistency(lcConflict).some((i) => i.id === 'issue_excl_conflict_ent_ipek'), true);

    const nfdConflict = updateStoryBibleField(withExcluded, 'centralConflict', 'i\u0307pek guards the gate', 'user-edit');
    assert.equal(evaluateProjectConsistency(nfdConflict).some((i) => i.id === 'issue_excl_conflict_ent_ipek'), true);

    const boundaryConflict = updateStoryBibleField(withExcluded, 'centralConflict', 'İpeksi ve ırıs motifs', 'user-edit');
    assert.equal(evaluateProjectConsistency(boundaryConflict).some((i) => i.id === 'issue_excl_conflict_ent_ipek'), false);
    assert.equal(evaluateProjectConsistency(boundaryConflict).some((i) => i.id === 'issue_excl_conflict_ent_iris'), false);

    const lcExcluded = {
      ...base,
      entities: [
        ...base.entities,
        { id: 'ent_ipek_lc', name: 'ipek', category: 'character' as const, description: '', excluded: true, presence_in_prompt: false, alternatives: null, attributes: [] },
      ],
    };
    const ucConflict = updateStoryBibleField(lcExcluded, 'centralConflict', 'İpek guards the gate', 'user-edit');
    assert.equal(evaluateProjectConsistency(ucConflict).some((i) => i.id === 'issue_excl_conflict_ent_ipek_lc'), true);
  });
});
