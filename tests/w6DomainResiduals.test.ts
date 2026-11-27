/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { createSampleProject } from '../lib/canonicalModel.ts';
import { areSnapshotsSemanticallyEqual } from '../lib/canonical/snapshotEquality.ts';
import { createUndoRedoStateFromProject, recordProjectRevision } from '../lib/historyEngine.ts';
import { recordNarrativeChange } from '../lib/narrative/changeAudit.ts';
import { createStyleProfile } from '../lib/narrative/context/styleProfile.ts';
import { applyDiagnosticFixAlternative } from '../lib/narrative/diagnostics/engine.ts';
import { manuscriptSections, prepareManuscriptChange } from '../lib/narrative/manuscriptModel.ts';
import {
  createOpportunityProposal,
  transitionOpportunityProposal,
} from '../lib/narrative/opportunityProposals.ts';
import { validateProposedOperations } from '../lib/nlBatchEngine.ts';
import type { CreativeProject, ProposedOperation } from '../shared/types.ts';

const FIXED_TS = 1763942400000;

function makeNarrativeProject(versionId = 'ver_1'): CreativeProject {
  const base = createSampleProject(FIXED_TS);
  return {
    ...base,
    schemaVersion: 4,
    snapshot: {
      ...base.snapshot,
      manuscriptVersionId: versionId,
    },
    narrative: {
      versions: [{ id: versionId, sectionVersionIds: ['sv_1'] }],
      sectionVersions: [
        { id: 'sv_1', section: { id: 'sec_1', kind: 'scene', title: 'Opening', text: 'Cat sat at the table.' } },
      ],
      sources: [
        { id: 'src_1', version: 'v1', digest: 'd1', text: 'Cat sat at the table.', retention: 'extracted-only', blocks: [] },
      ],
      claims: [],
      issues: [],
      audit: [],
    },
  };
}

describe('W6-D16: Narrative changeAudit unit coverage', () => {
  it('returns after unchanged when narrative envelope is missing or manuscriptVersionId did not change', () => {
    const base = createSampleProject(FIXED_TS);
    const noNarrative = recordNarrativeChange(base, { ...base, revision: base.revision + 1 }, 'write', 'No narrative');
    assert.equal(noNarrative.narrative, undefined);

    const p1 = makeNarrativeProject('ver_1');
    const p2 = { ...structuredClone(p1), revision: p1.revision + 1 };
    const unchanged = recordNarrativeChange(p1, p2, 'write', 'Same version');
    assert.equal(unchanged, p2);
    assert.equal(unchanged.narrative?.audit.length, 0);
  });

  it('appends an audit entry with revision lineage and optional artifact when manuscriptVersionId changes', () => {
    const before = makeNarrativeProject('ver_1');
    const after: CreativeProject = {
      ...structuredClone(before),
      revision: before.revision + 1,
      snapshot: { ...structuredClone(before.snapshot), manuscriptVersionId: 'ver_2' },
    };
    const artifact = { artifactId: 'art_1', start: 0, end: 3, excerpt: 'Cat' };
    const audited = recordNarrativeChange(before, after, 'adopt', 'Adopt generated opener', artifact);
    assert.equal(audited.narrative?.audit.length, 1);
    const entry = audited.narrative!.audit[0];
    assert.ok(entry.id);
    assert.equal(entry.action, 'adopt');
    assert.equal(entry.baseRevision, before.revision);
    assert.equal(entry.resultRevision, after.revision);
    assert.equal(entry.before, 'ver_1');
    assert.equal(entry.after, 'ver_2');
    assert.equal(entry.reason, 'Adopt generated opener');
    assert.deepEqual(entry.artifact, artifact);
  });
});

describe('W6-D16: Narrative opportunityProposals unit coverage', () => {
  it('validates revision and required text fields, normalizes sourceRefs/assumptions, and creates pending proposal', () => {
    const project = makeNarrativeProject();
    assert.throws(
      () =>
        createOpportunityProposal(project, project.revision - 1, {
          description: 'Explore subplot',
          sourceRefs: ['sec_1'],
          rationale: 'Adds tension',
          benefit: 'Richer stakes',
          tradeOff: 'Longer middle act',
          assumptions: [],
        }),
      /changed/i
    );

    for (const [field, value] of [
      ['description', '   '],
      ['rationale', ''],
      ['benefit', '  '],
      ['tradeOff', '\t'],
    ] as const) {
      assert.throws(
        () =>
          createOpportunityProposal(project, project.revision, {
            description: 'Explore subplot',
            sourceRefs: ['sec_1'],
            rationale: 'Adds tension',
            benefit: 'Richer stakes',
            tradeOff: 'Longer middle act',
            assumptions: [],
            [field]: value,
          }),
        /required/i
      );
    }

    const created = createOpportunityProposal(project, project.revision, {
      description: '  Foreshadow the locked cellar  ',
      sourceRefs: [' sec_1 ', 'sec_1', '', 'ent_cat'],
      rationale: '  Connects Cat to the cellar mystery  ',
      benefit: '  Stronger payoff  ',
      tradeOff: '  Slightly slower reveal  ',
      assumptions: [' Cat knows the cellar exists ', '  '],
      origin: 'ai',
      category: 'foreshadowing',
      targetKind: 'section',
      targetId: 'sec_1',
      options: ['Add subtle sound cue', 'Mention rusted key'],
    });

    assert.equal(created.schemaVersion, 4);
    assert.equal(created.revision, project.revision + 1);
    const list = created.narrative?.opportunities ?? [];
    assert.equal(list.length, 1);
    const opp = list[0];
    assert.equal(opp.status, 'pending');
    assert.equal(opp.origin, 'ai');
    assert.equal(opp.description, 'Foreshadow the locked cellar');
    assert.deepEqual(opp.sourceRefs, ['sec_1', 'ent_cat']);
    assert.deepEqual(opp.assumptions, ['Cat knows the cellar exists']);
    assert.equal(opp.baseRevision, project.revision);
    assert.equal(opp.lifecycleRevision, created.revision);
    assert.deepEqual(opp.options, ['Add subtle sound cue', 'Mention rusted key']);
  });

  it('enforces transition rules, stale revision guards, and lifecycleRevision freshness', () => {
    const project = makeNarrativeProject();
    const withOpp = createOpportunityProposal(project, project.revision, {
      description: 'Deepen Fox rivalry',
      sourceRefs: ['ent_fox'],
      rationale: 'Clarifies motive',
      benefit: 'Higher tension',
      tradeOff: 'Extra scene',
      assumptions: ['Fox arrives early'],
    });
    const oppId = withOpp.narrative!.opportunities![0].id;

    // Unknown proposal or stale expectedRevision
    assert.throws(
      () => transitionOpportunityProposal(withOpp, 'missing_id', 'deferred', withOpp.revision),
      /unavailable/i
    );
    assert.throws(
      () => transitionOpportunityProposal(withOpp, oppId, 'deferred', withOpp.revision - 1),
      /changed/i
    );
    // Disallowed direct jump pending -> accepted
    assert.throws(
      () => transitionOpportunityProposal(withOpp, oppId, 'accepted', withOpp.revision),
      /Cannot change/i
    );

    // Valid lifecycle: pending -> deferred -> staged -> accepted (terminal)
    const deferred = transitionOpportunityProposal(withOpp, oppId, 'deferred', withOpp.revision);
    assert.equal(deferred.narrative!.opportunities![0].status, 'deferred');
    const staged = transitionOpportunityProposal(deferred, oppId, 'staged', deferred.revision);
    assert.equal(staged.narrative!.opportunities![0].status, 'staged');
    const accepted = transitionOpportunityProposal(staged, oppId, 'accepted', staged.revision);
    assert.equal(accepted.narrative!.opportunities![0].status, 'accepted');
    assert.throws(
      () => transitionOpportunityProposal(accepted, oppId, 'rejected', accepted.revision),
      /Cannot change/i
    );

    // Stale lifecycleRevision blocks staging/accepting after another revision, while allowing rejection
    const second = createOpportunityProposal(project, project.revision, {
      description: 'Add storm motif',
      sourceRefs: [],
      rationale: 'Atmosphere',
      benefit: 'Mood',
      tradeOff: 'Pacing',
      assumptions: [],
    });
    const secondId = second.narrative!.opportunities![0].id;
    const advanced = recordProjectRevision(second, 'Other edit', 'Unrelated change');
    assert.throws(
      () => transitionOpportunityProposal(advanced, secondId, 'staged', advanced.revision),
      /stale/i
    );
    const rejected = transitionOpportunityProposal(advanced, secondId, 'rejected', advanced.revision);
    assert.equal(rejected.narrative!.opportunities![0].status, 'rejected');
  });
});

describe('W6-D03..D07 Residual Edge Cases', () => {
  it('W6-D03: conflicting set_attribute after rename_entity on ID-less entity triggers CONFLICT', () => {
    const snap = createSampleProject(FIXED_TS).snapshot;
    snap.entities.push({
      name: 'Nameless',
      category: 'character',
      description: 'No id yet',
      presence_in_prompt: false,
      alternatives: null,
      attributes: [],
    });
    const ops: ProposedOperation[] = [
      { id: 'op1', type: 'set_attribute', summary: 'Set role', entityName: 'Nameless', attributeName: 'role', nextValue: 'Scout', selected: true },
      { id: 'op2', type: 'rename_entity', summary: 'Rename', entityName: 'Nameless', newEntityName: 'ScoutMaster', selected: true },
      { id: 'op3', type: 'set_attribute', summary: 'Conflicting role', entityName: 'ScoutMaster', attributeName: 'role', nextValue: 'Villain', selected: true },
    ];
    const issues = validateProposedOperations(snap, ops);
    assert.equal(issues.some((i) => i.code === 'CONFLICT'), true);
  });

  it('W6-D04: reordered storyBible still detects value mismatch', () => {
    const base = createSampleProject(FIXED_TS).snapshot;
    const reversedBible = Object.fromEntries(Object.entries(base.storyBible).reverse()) as typeof base.storyBible;
    reversedBible.tone = { ...reversedBible.tone, value: 'Completely Different Tone' };
    assert.equal(areSnapshotsSemanticallyEqual(base, { ...base, storyBible: reversedBible }), false);
  });

  it('W6-D06: applyDiagnosticFixAlternative covers manuscript_patch, relationship_update, missing relationshipId, and manual_guidance', () => {
    const proj = makeNarrativeProject();
    const undo = createUndoRedoStateFromProject(proj);

    assert.throws(
      () =>
        applyDiagnosticFixAlternative(
          proj,
          undo,
          'issue_1',
          {
            id: 'alt_manual',
            title: 'Manual',
            reason: 'Edit manually',
            assumptions: [],
            evidenceSummary: '',
            affectedScope: 'Manuscript',
            kind: 'manual_guidance',
            beforeText: '',
            afterText: '',
          },
          proj.revision
        ),
      /manual guidance/i
    );

    assert.throws(
      () =>
        applyDiagnosticFixAlternative(
          proj,
          undo,
          'issue_rel',
          {
            id: 'alt_rel_missing',
            title: 'Missing rel id',
            reason: 'Test',
            assumptions: [],
            evidenceSummary: '',
            affectedScope: 'Rel',
            kind: 'relationship_update',
            beforeText: 'old',
            afterText: 'new',
          },
          proj.revision
        ),
      /relationship ID/i
    );

    const patched = applyDiagnosticFixAlternative(
      proj,
      undo,
      'issue_patch',
      {
        id: 'alt_patch',
        title: 'Replace Cat with Fox',
        reason: 'Align scene',
        assumptions: [],
        evidenceSummary: '',
        affectedScope: 'Opening',
        kind: 'manuscript_patch',
        sectionId: 'sec_1',
        beforeText: 'Cat sat at the table.',
        afterText: 'Fox sat at the table.',
      },
      proj.revision
    );
    assert.equal(manuscriptSections(patched.project)[0].text, 'Fox sat at the table.');

    const relId = proj.snapshot.relationships[0].id!;
    const relUpdated = applyDiagnosticFixAlternative(
      patched.project,
      patched.undoState,
      'issue_rel_ok',
      {
        id: 'alt_rel',
        title: 'Update relationship label',
        reason: 'Clarify tie',
        assumptions: [],
        evidenceSummary: '',
        affectedScope: 'Rel',
        kind: 'relationship_update',
        relationshipId: relId,
        beforeText: proj.snapshot.relationships[0].label,
        afterText: 'mentors',
      },
      patched.project.revision
    );
    assert.equal(relUpdated.project.snapshot.relationships.find((r) => r.id === relId)?.label, 'mentors');
  });

  it('W6-D07: omitting styleProfile during manuscript edit preserves existing styleProfile', () => {
    const project = makeNarrativeProject();
    const initialStyle = {
      projectId: project.id,
      observations: [{
        id: 'obs_keep',
        trait: 'voice' as const,
        value: 'Sparse',
        interpretation: 'observation' as const,
        scope: { kind: 'manuscript' as const },
        evidence: { kind: 'source' as const, recordId: 'src_1', version: 'v1', digest: 'd1', start: 0, end: 3, excerpt: 'Cat' },
        status: 'confirmed' as const,
      }],
    };
    const withStyle = prepareManuscriptChange(
      project,
      createUndoRedoStateFromProject(project),
      { projectId: project.id, revision: project.revision, manuscriptVersionId: project.snapshot.manuscriptVersionId },
      manuscriptSections(project),
      undefined,
      initialStyle
    )!;
    const edited = prepareManuscriptChange(
      withStyle.project,
      withStyle.undoState,
      {
        projectId: project.id,
        revision: withStyle.project.revision,
        manuscriptVersionId: withStyle.project.snapshot.manuscriptVersionId,
      },
      [{ id: 'sec_1', kind: 'scene', title: 'Opening', text: 'Updated prose.' }],
      undefined,
      undefined
    )!;
    const version = edited.project.narrative!.versions.find(
      (v) => v.id === edited.project.snapshot.manuscriptVersionId
    )!;
    assert.equal(version.styleProfile?.observations.length, 1);
    assert.deepEqual(version.styleProfile, initialStyle);

    // Explicitly clearing with empty observations clears it
    const cleared = prepareManuscriptChange(
      edited.project,
      edited.undoState,
      {
        projectId: project.id,
        revision: edited.project.revision,
        manuscriptVersionId: edited.project.snapshot.manuscriptVersionId,
      },
      [{ id: 'sec_1', kind: 'scene', title: 'Opening', text: 'Updated prose.' }],
      undefined,
      createStyleProfile(project.id)
    )!;
    const clearedVer = cleared.project.narrative!.versions.find(
      (v) => v.id === cleared.project.snapshot.manuscriptVersionId
    )!;
    assert.equal(clearedVer.styleProfile, undefined);
  });
});
