import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createSampleProject } from '../lib/canonicalModel.ts';
import {
  buildReviewModelPayload,
  buildScopedDiagnosticPlan,
  buildScopedSyncPlan,
} from '../lib/narrative/review/scopedContextBuilder.ts';
import { convertSemanticFindingsToDiagnosticFindings } from '../lib/narrative/diagnostics/engine.ts';
import { extractConfirmedWritingContext } from '../lib/narrative/writing/selectionHelpers.ts';
import { evaluateProjectConsistency } from '../lib/consistencyChecker.ts';
import { analyzeNarrativeSync, type NarrativeAiClientLike } from '../server/narrative/narrativeAiService.ts';
import type { ManuscriptSection } from '../shared/narrativeTypes.ts';
import type { CreativeProject } from '../shared/types.ts';

function buildMultiChapterProject(sectionCount: number): { project: CreativeProject; sections: ManuscriptSection[] } {
  const base = createSampleProject();
  const sections: ManuscriptSection[] = Array.from({ length: sectionCount }, (_, idx) => ({
    id: `sec_${idx + 1}`,
    kind: idx === 0 ? 'chapter' : 'scene',
    title: `Chapter ${idx + 1}`,
    text:
      idx === sectionCount - 1
        ? `In Chapter ${idx + 1}, Mara claims the Brass Lighthouse was destroyed in 1892 while standing inside its intact lantern room.`
        : `Chapter ${idx + 1} narrative prose about the harbor mist and lantern shifts (${'story '.repeat(40)}).`,
    ...(idx === 1 ? { pov: 'Mara', location: 'Harbor Pier', chronology: 'Night 1' } : {}),
  }));

  const sectionVersions = sections.map((s, idx) => ({ id: `sv_${idx + 1}`, section: s }));
  const project: CreativeProject = {
    ...base,
    revision: 4,
    snapshot: {
      ...base.snapshot,
      manuscriptVersionId: 'mv_4',
      entities: [
        ...base.snapshot.entities,
        {
          id: 'ent_mara',
          name: 'Mara',
          category: 'character',
          presence_in_prompt: true,
          description: 'Keeper of the coastal beacon',
          alternatives: null,
          status: 'confirmed',
          provenance: 'user-edit',
          attributes: [
            {
              id: 'attr_mara_belief',
              name: 'rumored_traitor',
              value: [{ name: 'believed to be Captain Voss' }],
              confirmedValue: 'believed to be Captain Voss',
              status: 'confirmed',
              epistemicKind: 'belief',
              presence_in_prompt: false,
            },
          ],
        },
        {
          id: 'ent_rumor_ghost',
          name: 'Harbor Phantom',
          category: 'character',
          presence_in_prompt: false,
          description: 'Sailors report seeing a pale figure on the breakwater',
          alternatives: null,
          status: 'confirmed',
          epistemicKind: 'reported',
          attributes: [],
        },
        {
          id: 'ent_forbidden_magic',
          name: 'Arcane Portal',
          category: 'object',
          presence_in_prompt: false,
          description: 'Excluded supernatural device',
          alternatives: null,
          excluded: true,
          status: 'confirmed',
          attributes: [],
        },
      ],
      relationships: [
        {
          id: 'rel_1',
          sourceId: 'ent_mara',
          targetId: 'ent_conservatory',
          source: 'Mara',
          target: 'Glass Conservatory',
          label: 'guards',
          status: 'confirmed',
          presence_in_prompt: true,
        },
      ],
    },
    narrative: {
      versions: [
        { id: 'mv_1', sectionVersionIds: sectionVersions.slice(0, sectionCount - 1).map((sv) => sv.id) },
        { id: 'mv_4', sectionVersionIds: sectionVersions.map((sv) => sv.id) },
      ],
      sectionVersions,
      sources: [],
      claims: [
        {
          id: 'claim_1',
          targetId: 'attr_mara_belief',
          rationale: 'Mara suspects Voss based on the torn logbook',
          approval: 'confirmed',
          epistemicKind: 'belief',
          freshness: 'current',
          anchors: [
            { sourceId: 'sec_1', version: 'mv_4', digest: 'd1', start: 0, end: 10, excerpt: 'Chapter 1 ' },
          ],
        },
      ],
      issues: [],
      audit: [
        {
          id: 'aud_1',
          action: 'write',
          time: 1000,
          baseRevision: 3,
          resultRevision: 4,
          before: 'mv_1',
          after: 'mv_4',
          reason: 'Added final chapter',
        },
      ],
      syncState: {
        lastReviewedRevision: 3,
        lastReviewedAt: 900,
        lastDirection: 'manuscript-to-model',
        coverageNote: 'Reviewed through rev 3',
      },
    },
  };
  return { project, sections };
}

describe('WP01 M3 — Diagnostics, Sync, Writing Context & Consistency Checker', () => {
  it('covers chapter 10+ across bounded diagnostic and sync segments instead of silently dropping sections after index 8', () => {
    const { project, sections } = buildMultiChapterProject(11);
    const diagPlan = buildScopedDiagnosticPlan({
      project,
      sections,
      scope: 'full',
      maxSegmentChars: 1_500,
    });

    assert.ok(diagPlan.segments.length >= 2, 'Long manuscript must split into multiple bounded segments');
    const allCoveredDiag = new Set(diagPlan.segments.flatMap((s) => s.sectionIds));
    assert.equal(allCoveredDiag.has('sec_11'), true, 'Chapter 11 inconsistency must be included in full-scope segments');
    assert.equal(diagPlan.coverage.omittedSectionIds.length, 0);
    assert.match(diagPlan.coverage.summary, /bounded segment/i);

    const syncPlan = buildScopedSyncPlan({
      project,
      sections,
      direction: 'manuscript-to-model',
      maxSegmentChars: 1_500,
    });
    const allCoveredSync = new Set(syncPlan.segments.flatMap((s) => s.sectionIds));
    assert.equal(allCoveredSync.has('sec_11'), true, 'Sync must cover late sections beyond index 8');
  });

  it('implements real entity, scene, and changed scopes accurately', () => {
    const { project, sections } = buildMultiChapterProject(10);

    const entityPlan = buildScopedDiagnosticPlan({
      project,
      sections,
      scope: 'entity',
      scopeTargetId: 'ent_mara',
    });
    assert.deepEqual(entityPlan.coverage.coveredSectionIds, ['sec_10']);
    assert.equal(entityPlan.coverage.omittedSectionIds.length, 9);

    const changedPlan = buildScopedDiagnosticPlan({
      project,
      sections,
      scope: 'changed',
    });
    assert.deepEqual(changedPlan.coverage.coveredSectionIds, ['sec_10']);
    assert.equal(changedPlan.coverage.baselineRevision, 3);
  });

  it('retains belief and reported entries with explicit epistemic metadata instead of silently stripping them', () => {
    const { project } = buildMultiChapterProject(2);
    const model = buildReviewModelPayload(project);
    const phantom = model.entities.find((e) => e.id === 'ent_rumor_ghost');
    assert.ok(phantom, 'Reported entity must be retained with epistemic metadata');
    assert.equal(phantom.epistemicKind, 'reported');
    assert.ok(phantom.epistemicSource?.includes('reported'));

    const mara = model.entities.find((e) => e.id === 'ent_mara');
    const beliefAttr = mara?.attributes.find((a) => a.id === 'attr_mara_belief');
    assert.ok(beliefAttr, 'Belief attribute must be retained with epistemic label');
    assert.equal(beliefAttr.epistemicKind, 'belief');
    assert.match(beliefAttr.epistemicSource ?? '', /Mara suspects Voss/i);
  });

  it('resolves verbatim semantic evidenceQuote to real manuscript anchors and flags hallucinated quotes without accepting them', () => {
    const { sections } = buildMultiChapterProject(10);
    const verifiedQuote = 'Mara claims the Brass Lighthouse was destroyed in 1892';

    const findings = convertSemanticFindingsToDiagnosticFindings(
      [
        {
          title: 'Lighthouse destruction contradiction',
          description: 'Chapter 10 says the lighthouse was destroyed while characters stand inside it.',
          category: 'continuity',
          severity: 'error',
          certainty: 'confirmed',
          targetKind: 'section',
          sectionId: 'sec_10',
          evidenceQuote: verifiedQuote,
        },
        {
          title: 'Fabricated quote test',
          description: 'Claimed contradiction with non-existent quote.',
          category: 'continuity',
          severity: 'warning',
          certainty: 'possible',
          targetKind: 'section',
          sectionId: 'sec_10',
          evidenceQuote: 'This exact sentence does not exist anywhere in the draft.',
        },
      ],
      'proj_1',
      'semantic:full',
      sections,
      'mv_4'
    );

    assert.equal(findings[0].anchors.length, 1);
    assert.equal(findings[0].anchors[0].sourceId, 'sec_10');
    assert.equal(findings[0].anchors[0].excerpt, verifiedQuote);
    assert.equal(
      sections[9].text.slice(findings[0].anchors[0].start, findings[0].anchors[0].end),
      verifiedQuote
    );

    assert.equal(findings[1].anchors.length, 0, 'Hallucinated quote must never produce a fabricated anchor');
    assert.match(findings[1].reason, /Unverified evidence quote/i);
  });

  it('strictly enforces sync direction in normalizeSyncResponse for both directions', async () => {
    const mixedClient: NarrativeAiClientLike = {
      models: {
        countTokens: async () => ({ totalTokens: 120, source: 'provider-count' }),
        generateContent: async () => ({
          text: JSON.stringify({
            direction: 'manuscript-to-model',
            modelProposals: [
              {
                id: 'm1',
                kind: 'add_entity',
                title: 'Add Pier',
                rationale: 'Mentioned in draft',
                evidenceQuote: 'Harbor Pier',
                entityName: 'Harbor Pier',
                entityCategory: 'location',
                proposedValue: 'Main dock',
                isAssumption: false,
              },
            ],
            manuscriptPatches: [
              {
                id: 'p1',
                sectionId: 'sec_1',
                sectionTitle: 'Chapter 1',
                rationale: 'Align name',
                linkedModelChange: 'Rename',
                originalExcerpt: 'Harbor',
                proposedExcerpt: 'Port',
              },
            ],
            coverageNote: 'Checked section 1.',
          }),
        }),
      },
    };

    const m2m = await analyzeNarrativeSync(
      {
        direction: 'manuscript-to-model',
        projectId: 'p1',
        baseRevision: 1,
        sections: [{ id: 'sec_1', title: 'Chapter 1', kind: 'chapter', text: 'Harbor Pier' }],
        entities: [],
        relationships: [],
        storyBible: {},
      },
      undefined,
      mixedClient
    );
    assert.equal(m2m.direction, 'manuscript-to-model');
    assert.equal(m2m.modelProposals.length, 1);
    assert.equal(m2m.manuscriptPatches.length, 0);

    const modelToMs = await analyzeNarrativeSync(
      {
        direction: 'model-to-manuscript',
        projectId: 'p1',
        baseRevision: 1,
        sections: [{ id: 'sec_1', title: 'Chapter 1', kind: 'chapter', text: 'Harbor Pier' }],
        entities: [],
        relationships: [],
        storyBible: {},
      },
      undefined,
      mixedClient
    );
    assert.equal(modelToMs.direction, 'model-to-manuscript');
    assert.equal(modelToMs.modelProposals.length, 0);
    assert.equal(modelToMs.manuscriptPatches.length, 1);
  });

  it('enriches Writing Assistant context with scene metadata, preceding scene excerpt, relationships, exclusions, and separate epistemic notes', () => {
    const { project } = buildMultiChapterProject(3);
    const ctx = extractConfirmedWritingContext(project, 'sec_2');

    assert.equal(ctx.sceneMetadata?.pov, 'Mara');
    assert.equal(ctx.sceneMetadata?.location, 'Harbor Pier');
    assert.equal(ctx.precedingSceneContext?.sectionId, 'sec_1');
    assert.ok((ctx.precedingSceneContext?.excerpt.length ?? 0) > 10);
    assert.ok(ctx.relevantRelationships.some((r) => r.source === 'Mara' && r.label === 'guards'));
    assert.ok(ctx.explicitExclusions.includes('Arcane Portal'));
    assert.equal(ctx.confirmedEntities.some((e) => e.name === 'Harbor Phantom'), false, 'Reported entity stays out of confirmed world facts');
    assert.ok(ctx.epistemicNotes.some((n) => n.subject === 'Harbor Phantom' && n.kind === 'reported'));
    assert.ok(ctx.epistemicNotes.some((n) => n.subject === 'Mara' && n.kind === 'belief'));
  });

  it('fixes F-15 grammar spacing/pluralization and eliminates brittle setting_mismatch false positives', () => {
    const sample = createSampleProject().snapshot;
    sample.storyBible.genre = { value: 'Mystery', status: 'confirmed', provenance: 'user-edit', updatedAt: 1 };
    sample.storyBible.tone = { value: '', status: 'pending', provenance: 'ai-inferred', updatedAt: 1 };
    sample.storyBible.setting = { value: '19th-century coastal town', status: 'confirmed', provenance: 'user-edit', updatedAt: 1 };

    const issuesOne = evaluateProjectConsistency(sample);
    const coreOne = issuesOne.find((i) => i.id === 'issue_unresolved_core_bible');
    assert.ok(coreOne);
    assert.equal(coreOne.title, '1 core Story Bible property (Tone) awaiting confirmation');

    sample.storyBible.genre = { value: '', status: 'pending', provenance: 'ai-inferred', updatedAt: 1 };
    const issuesTwo = evaluateProjectConsistency(sample);
    const coreTwo = issuesTwo.find((i) => i.id === 'issue_unresolved_core_bible');
    assert.ok(coreTwo);
    assert.equal(coreTwo.title, '2 core Story Bible properties (Genre, Tone) awaiting confirmation');
    assert.equal(issuesTwo.some((i) => i.id === 'issue_setting_mismatch'), false);
  });
});
