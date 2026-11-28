import assert from 'node:assert/strict';
import test from 'node:test';
import { createSampleProject } from '../lib/canonicalModel';
import { createUndoRedoState } from '../lib/historyEngine';
import {
  manuscriptSections,
  narrativeBase,
  prepareManuscriptChange,
} from '../lib/narrative/manuscriptModel';
import { assembleOperationContext } from '../lib/narrative/context/contextAssembler';
import { resolveCitationDiffCard } from '../lib/narrative/context/citationAnchorResolver';
import {
  createCreativeLockRecord,
  upsertProjectCreativeLock,
} from '../lib/narrative/proposals/creativeLocks';
import {
  compileUnifiedProposalPreview,
  createUnifiedProposalEnvelope,
  prepareUnifiedProposalAtomicCommit,
  updateUnifiedProposalSelectionOrEdits,
} from '../lib/narrative/proposals/unifiedProposalEngine';
import { buildVisualChangeMap } from '../lib/narrative/proposals/changeMapProjector';
import type { ManuscriptSection } from '../shared/narrativeTypes';
import type { CreativeProject } from '../shared/types';

function setProjectManuscriptSections(
  project: CreativeProject,
  sections: ManuscriptSection[]
): CreativeProject {
  const undo = createUndoRedoState(project.snapshot, project.revisions, project.undoHistory);
  const res = prepareManuscriptChange(project, undo, narrativeBase(project), sections);
  return res ? res.project : project;
}

function createProposalTestProject(id = 'wp02-e3-proj'): CreativeProject {
  const base = createSampleProject();
  const sections: ManuscriptSection[] = [
    {
      id: 'sec-1',
      kind: 'scene',
      title: 'The Archive Vault',
      text: 'Lady Lyra opened the obsidian lockbox. Inside rested the Silver Compass.',
    },
    {
      id: 'sec-2',
      kind: 'scene',
      title: 'The Harbor Escape',
      text: 'Captain Thorne waited beside the schooner as fog rolled across the pier.',
    },
  ];
  const updated = setProjectManuscriptSections(base, sections);
  return {
    ...updated,
    id,
    revision: 10,
    snapshot: {
      ...updated.snapshot,
      entities: [
        {
          id: 'ent-lyra',
          name: 'Lady Lyra',
          type: 'character',
          category: 'character',
          aliases: ['Lyra'],
          status: 'confirmed',
          provenance: 'user',
          attributes: [
            {
              name: 'Status',
              value: [{ name: 'Alive', confidence: 'High' }],
              confirmedValue: 'Alive',
              status: 'confirmed',
              provenance: 'user',
            },
          ],
        },
        {
          id: 'ent-excluded',
          name: 'Excluded Phantom',
          type: 'character',
          category: 'character',
          excluded: true,
          status: 'confirmed',
          provenance: 'user',
          attributes: [],
        },
      ],
      relationships: [
        {
          id: 'rel-lyra-thorne',
          source: 'Lady Lyra',
          target: 'Captain Thorne',
          sourceId: 'ent-lyra',
          targetId: 'ent-thorne',
          label: 'trusts implicitly',
          status: 'confirmed',
          provenance: 'user',
        },
      ],
    },
  };
}

test('Context Inspector (UIC-01 / IR-02) accurately reports planned vs omitted items and reasons', () => {
  const project = createProposalTestProject();

  // 1. Scene-scoped context with spoiler boundary at presentationOrder = 0
  const sceneReport = assembleOperationContext(project, {
    operationIntent: 'writing-assist',
    activeSectionId: 'sec-1',
    scope: 'scene',
    maxPresentationOrder: 0,
    tokenBudget: 4000,
  });

  assert.ok(sceneReport.counts.requested > 0);
  assert.ok(sceneReport.counts.planned > 0);
  assert.ok(sceneReport.counts.omitted > 0);

  // Excluded entity must be omitted with reason 'excluded-entity'
  const excludedItem = sceneReport.items.find((i) => i.id === 'entity_ent-excluded');
  assert.ok(excludedItem);
  assert.equal(excludedItem.disposition, 'omitted');
  assert.equal(excludedItem.omissionReason, 'excluded-entity');

  // Section 2 chunk must be omitted because of spoiler boundary / scene scope
  const sec2Item = sceneReport.items.find((i) => i.sectionId === 'sec-2');
  assert.ok(sec2Item);
  assert.equal(sec2Item.disposition, 'omitted');
  assert.ok(
    sec2Item.omissionReason === 'spoiler-boundary' || sec2Item.omissionReason === 'scope-excluded'
  );

  // 2. Tight token budget triggers 'budget-cap' omission on non-pinned items
  const tightBudgetReport = assembleOperationContext(project, {
    operationIntent: 'diagnostics',
    activeSectionId: 'sec-1',
    scope: 'full',
    tokenBudget: 12,
  });
  assert.ok(
    tightBudgetReport.items.some(
      (i) => i.disposition === 'omitted' && i.omissionReason === 'budget-cap'
    )
  );
});

test('Citation Diff Card (UIC-02) verifies exact quotes, re-anchors shifted quotes, and flags ambiguous/modified passages', () => {
  const project = createProposalTestProject();
  const allSecs = manuscriptSections(project);
  const sec1 = allSecs[0];
  const quote = 'Inside rested the Silver Compass.';
  const origStart = sec1.text.indexOf(quote);
  const origEnd = origStart + quote.length;

  // 1. Exact UTF-16 match
  const exactCard = resolveCitationDiffCard(project, {
    id: 'cit-1',
    label: 'Compass discovery',
    sourceKind: 'manuscript',
    targetId: 'sec-1',
    anchoredRevision: 10,
    startOffset: origStart,
    endOffset: origEnd,
    archivedQuote: quote,
  });
  assert.equal(exactCard.status, 'verified-exact');
  assert.equal(exactCard.requiresAuthorReview, false);

  // 2. Clean text insertion before quote shifts offsets -> 'reanchored-unique'
  const shiftedProject = setProjectManuscriptSections(project, [
    {
      ...sec1,
      text: `At midnight, ${sec1.text}`,
    },
    allSecs[1],
  ]);
  const reanchoredCard = resolveCitationDiffCard(shiftedProject, {
    id: 'cit-1',
    label: 'Compass discovery',
    sourceKind: 'manuscript',
    targetId: 'sec-1',
    anchoredRevision: 10,
    startOffset: origStart,
    endOffset: origEnd,
    archivedQuote: quote,
  });
  assert.equal(reanchoredCard.status, 'reanchored-unique');
  assert.equal(reanchoredCard.requiresAuthorReview, false);
  assert.equal(reanchoredCard.resolvedSpan?.startOffset, origStart + 'At midnight, '.length);

  // 3. Duplicate occurrence in edited section -> 'stale-ambiguous' with requiresAuthorReview = true
  const ambiguousProject = setProjectManuscriptSections(project, [
    {
      ...sec1,
      text: `Prefix text. ${quote} Middle text. ${quote}`,
    },
    allSecs[1],
  ]);
  const ambiguousCard = resolveCitationDiffCard(ambiguousProject, {
    id: 'cit-1',
    label: 'Compass discovery',
    sourceKind: 'manuscript',
    targetId: 'sec-1',
    anchoredRevision: 10,
    startOffset: origStart,
    endOffset: origEnd,
    archivedQuote: quote,
  });
  assert.equal(ambiguousCard.status, 'stale-ambiguous');
  assert.equal(ambiguousCard.requiresAuthorReview, true);

  // 4. Modified quote in edited section -> 'stale-modified' with requiresAuthorReview = true
  const modifiedProject = setProjectManuscriptSections(project, [
    {
      ...sec1,
      text: 'Lady Lyra opened the obsidian lockbox. Inside rested the Golden Astrolabe.',
    },
    allSecs[1],
  ]);
  const modifiedCard = resolveCitationDiffCard(modifiedProject, {
    id: 'cit-1',
    label: 'Compass discovery',
    sourceKind: 'manuscript',
    targetId: 'sec-1',
    anchoredRevision: 10,
    startOffset: origStart,
    endOffset: origEnd,
    archivedQuote: quote,
  });
  assert.equal(modifiedCard.status, 'stale-modified');
  assert.equal(modifiedCard.requiresAuthorReview, true);
});

test('E3 UnifiedProposal enforces Hard Structural Locks vs Soft Advisory Constraints, dependencies, inline edit patchDigest, V7 Change Map, atomic commit, and Undo', () => {
  let project = createProposalTestProject('proj-e3-atomic');
  const sec1 = manuscriptSections(project)[0];

  // Add a Hard Structural Lock protecting Lady Lyra's Status = Alive
  const hardLock = createCreativeLockRecord({
    projectId: project.id,
    hardness: 'hard-structural',
    targetKind: 'attribute',
    targetId: 'ent-lyra',
    targetLabel: 'Lady Lyra',
    attributeKey: 'Status',
    expectedValue: 'Alive',
    ruleText: 'Lady Lyra must remain Alive throughout Act I.',
  });
  // Add a Soft Advisory Lock on The Archive Vault scene
  const softLock = createCreativeLockRecord({
    projectId: project.id,
    hardness: 'soft-advisory',
    targetKind: 'section',
    targetId: 'sec-1',
    targetLabel: 'The Archive Vault',
    ruleText: 'Keep pacing taut in the archive vault.',
  });
  const locks1 = upsertProjectCreativeLock(project, hardLock);
  project = {
    ...project,
    narrative: {
      ...project.narrative!,
      creativeLocks: locks1,
    },
  };
  const locks2 = upsertProjectCreativeLock(project, softLock);
  project = {
    ...project,
    narrative: {
      ...project.narrative!,
      creativeLocks: locks2,
    },
  };

  const compassStart = sec1.text.indexOf('Silver Compass');
  const compassEnd = compassStart + 'Silver Compass'.length;

  const proposal = createUnifiedProposalEnvelope({
    id: 'uprop-test-1',
    project,
    originOperation: 'manual',
    title: 'Upgrade Artifact & Character Status',
    rationale: 'Test atomic hunk + model operations with locks.',
    manuscriptHunks: [
      {
        id: 'hunk-1',
        sectionId: 'sec-1',
        sectionTitle: sec1.title,
        operation: 'replace',
        startOffset: compassStart,
        endOffset: compassEnd,
        expectedText: 'Silver Compass',
        replacementText: 'Celestial Compass',
        rationale: 'Rename compass artifact.',
        dependencyIds: ['op-violate-lock'],
      },
    ],
    modelOperations: [
      {
        id: 'op-violate-lock',
        targetType: 'attribute',
        action: 'update',
        targetId: 'ent-lyra',
        targetLabel: 'Lady Lyra',
        field: 'Status',
        beforeValue: 'Alive',
        afterValue: 'Missing',
        rationale: 'Mark Lady Lyra as Missing.',
        dependencyIds: [],
      },
    ],
  });

  // 1. Preview with hard lock violation must fail closed (canApply: false, HARD_CREATIVE_LOCK_VIOLATION)
  // while also reporting SOFT_CREATIVE_LOCK_ADVISORY on sec-1
  const blockedPreview = compileUnifiedProposalPreview(project, proposal);
  assert.equal(blockedPreview.canApply, false);
  assert.ok(blockedPreview.diagnostics.some((d) => d.code === 'HARD_CREATIVE_LOCK_VIOLATION'));
  assert.ok(blockedPreview.diagnostics.some((d) => d.code === 'SOFT_CREATIVE_LOCK_ADVISORY'));

  // 2. Deselecting 'op-violate-lock' while keeping 'hunk-1' which depends on 'op-violate-lock' triggers UNMET_DEPENDENCY
  const unmetDepProposal = updateUnifiedProposalSelectionOrEdits(proposal, {
    selectedIds: ['hunk-1'],
  });
  assert.notEqual(unmetDepProposal.patchDigest, proposal.patchDigest);
  const unmetPreview = compileUnifiedProposalPreview(project, unmetDepProposal);
  assert.equal(unmetPreview.canApply, false);
  assert.ok(unmetPreview.diagnostics.some((d) => d.code === 'UNMET_DEPENDENCY'));

  // 3. Edit 'op-violate-lock' inline so afterValue respects the hard lock ('Alive') and add a new attribute operation
  const editedProposal = updateUnifiedProposalSelectionOrEdits(proposal, {
    selectedIds: ['hunk-1', 'op-violate-lock'],
    manuscriptHunks: [
      {
        ...proposal.manuscriptHunks[0],
        replacementText: 'Starlight Compass',
        dependencyIds: [],
      },
    ],
    modelOperations: [
      {
        ...proposal.modelOperations[0],
        field: 'Current Artifact',
        beforeValue: '(none)',
        afterValue: 'Starlight Compass',
      },
    ],
  });
  assert.notEqual(editedProposal.patchDigest, proposal.patchDigest);

  const validPreview = compileUnifiedProposalPreview(project, editedProposal);
  assert.equal(validPreview.canApply, true);
  assert.equal(validPreview.hardBlockCount, 0);
  // Soft advisory warning remains visible but does not block apply
  assert.equal(validPreview.softWarningCount, 1);

  // 4. V7 Visual Change Map projection reflects the modified entity & manuscript section
  const changeMap = buildVisualChangeMap(project, editedProposal, validPreview);
  assert.ok(changeMap.nodes.some((n) => n.diffState === 'modified'));
  assert.equal(changeMap.summaryCounts.modifiedNodes >= 2, true);

  // 5. Atomic Commit applies manuscript hunk and model attribute in a single revision step
  const initialUndo = createUndoRedoState(project.snapshot, project.revisions, project.undoHistory);
  const committed = prepareUnifiedProposalAtomicCommit(project, initialUndo, editedProposal);
  assert.equal(committed.ok, true);
  if (!committed.ok) return;

  assert.equal(committed.project.revision, project.revision + 1);
  const postApplySection = manuscriptSections(committed.project)[0];
  assert.ok(postApplySection.text.includes('Starlight Compass'));
  const postApplyLyra = committed.project.snapshot.entities.find((e) => e.id === 'ent-lyra')!;
  assert.equal(
    postApplyLyra.attributes.find((a) => a.name === 'Current Artifact')?.confirmedValue,
    'Starlight Compass'
  );

  // 6. Idempotent duplicate apply rejection: attempting to re-apply the same proposal on committed.project fails closed
  const duplicateAttempt = prepareUnifiedProposalAtomicCommit(
    committed.project,
    committed.undoHistory,
    editedProposal
  );
  assert.equal(duplicateAttempt.ok, false);

  // 7. Undo via inverse proposal cleanly restores both manuscript text and entity attribute
  const undone = prepareUnifiedProposalAtomicCommit(
    committed.project,
    committed.undoHistory,
    committed.inverseProposal
  );
  assert.equal(undone.ok, true);
  if (!undone.ok) return;

  const restoredSection = manuscriptSections(undone.project)[0];
  assert.equal(restoredSection.text, sec1.text);
});
