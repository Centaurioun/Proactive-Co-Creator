import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createSampleProject } from '../lib/canonicalModel';
import {
  addSessionCreativeLock,
  answerGuidedQuestion,
  appendGuidedQuestions,
  appendSuggestedDirections,
  applyCreativeWorkspaceMetadataToProject,
  attachIdeaReflection,
  buildAggregateUnifiedProposalFromCards,
  buildCreativeSessionBriefMarkdown,
  buildCreativeSessionContextPacket,
  buildUnifiedProposalFromIdeaCard,
  combineCreativeIdeaCards,
  createCreativeIdeaCard,
  createCreativeSession,
  createReadingMarginNote,
  developIdeaCardFurther,
  extractKnownCanonFactsForScope,
  getActiveIdeaVersion,
  regenerateSingleIdeaCard,
  removeSessionCreativeLock,
  restoreDismissedIdeaCard,
  selectIdeaCardVersion,
  setCreativeSessionStatus,
  setIdeaCardStatus,
  synthesizeConceptPreviewFromSession,
  toggleCreativeDirection,
  updateCreativeIdeaCardContent,
} from '../lib/narrative/sessions/creativeSessionEngine';
import {
  buildCreativeActionPayload,
  executeGroundedCreativeAction,
  synthesizeGroundedCreativeActionResponse,
} from '../lib/narrative/sessions/creativeActionService';
import {
  compileUnifiedProposalPreview,
  computeProjectBaseSnapshotDigest,
  prepareUnifiedProposalAtomicCommit,
} from '../lib/narrative/proposals/unifiedProposalEngine';
import { createUndoRedoState } from '../lib/historyEngine';
import { narrativeSchema } from '../shared/narrativeSchemas';
import {
  CreativeStudioActionRequestSchema,
  CreativeStudioActionResponseSchema,
} from '../shared/narrativeAiSchemas';
import { parseSafeMarkdownBlocks } from '../components/manuscript/SafeMarkdownReader';
import { computeLocalSceneInsights } from '../components/manuscript/LocalWritingInsightsBar';

const ROOT = path.resolve(process.cwd());

test('B2: CreativeSession metadata persists cleanly into narrativeSchema without changing canonical revision or baseSnapshotDigest', async () => {
  const baseProject = createSampleProject();
  const initialRev = baseProject.revision;
  const initialDigest = computeProjectBaseSnapshotDigest(baseProject);

  const session = createCreativeSession(baseProject, {
    title: 'Act I Escalation',
    mode: 'discover',
    goal: 'Explore hidden motive for the dinner guest',
  });
  const { session: withCard, card } = createCreativeIdeaCard(baseProject, session, {
    title: 'Poisoned Toast Redirect',
    summary: 'Host swaps goblets only after suspecting an ambush.',
    rationale: 'Heightens tension without breaking established canon.',
    epistemicStatus: 'hypothesis',
  });
  const marginNote = createReadingMarginNote(baseProject, {
    sectionId: 'sec-1',
    sectionTitle: 'Opening',
    sectionContent: 'Lantern light flickered across the hall.',
    startOffset: 0,
    endOffset: 24,
    quotedExcerpt: 'Lantern light flickered.',
    noteText: 'Consider foreshadowing the lockbox here.',
  });

  const updated = applyCreativeWorkspaceMetadataToProject(baseProject, {
    creativeSessions: [withCard],
    creativeIdeas: [card],
    readingMarginNotes: [marginNote],
  });

  assert.equal(updated.revision, initialRev, 'Session persistence must NOT increment canonical project.revision');
  assert.equal(
    computeProjectBaseSnapshotDigest(updated),
    initialDigest,
    'Session persistence must NOT mutate baseSnapshotDigest'
  );

  const parsed = narrativeSchema.safeParse(updated.narrative);
  assert.equal(parsed.success, true, 'narrativeSchema must validate creativeSessions, creativeIdeas, and readingMarginNotes');
  assert.equal(updated.narrative?.creativeSessions?.length, 1);
  assert.equal(updated.narrative?.creativeIdeas?.length, 1);
  assert.equal(updated.narrative?.readingMarginNotes?.length, 1);

  // Regression: newly added untitled scene (`title: ''`) must not fail sourceRefs.label min(1)
  const { prepareManuscriptChange, narrativeBase } = await import('../lib/narrative/manuscriptModel');
  const untitledUndo = createUndoRedoState(baseProject.snapshot, baseProject.revisions);
  const changed = prepareManuscriptChange(baseProject, untitledUndo, narrativeBase(baseProject), [
    {
      id: 'sec-untitled-1',
      kind: 'scene',
      title: '',
      text: 'Lantern light flickered across the wet flagstones.',
    },
  ]);
  assert.ok(changed);
  const untitledProject = changed.project;
  const untitledSess = createCreativeSession(untitledProject, {
    scope: { kind: 'section', sectionIds: ['sec-untitled-1'] },
  });
  assert.ok(untitledSess.scope.focusSummary.includes('Scene 1'));
  const { card: untitledCard } = createCreativeIdeaCard(untitledProject, untitledSess, {
    title: 'Untitled Scene Spark',
    summary: 'Foreshadow an unseen watcher by the hearth.',
  });
  assert.equal(untitledCard.versions[0].sourceRefs[0]?.label, 'Untitled Scene');
});

test('B3: Suggest More Directions appends without clearing existing selections, and Regenerate affects only target card with version lineage', () => {
  const project = createSampleProject();
  let session = createCreativeSession(project, {
    title: 'Discovery Run',
    mode: 'discover',
    goal: 'Deepen conflict',
  });
  const baseDirectionCount = session.directions.length; // 3 defaults with index 0 selected

  session = appendSuggestedDirections(session, [
    { label: 'Secret Debt', description: 'Reveal unpaid guild obligation', category: 'conflict' },
    { label: 'Missing Key', description: 'Archive key disappears mid-meal', category: 'plot-twist' },
  ]);
  const toggledDirId = session.directions[1].id;
  session = toggleCreativeDirection(session, toggledDirId);
  assert.equal(session.directions[1].selected, true);

  session = appendSuggestedDirections(session, [
    { label: 'Unlikely Truce', description: 'Rivals unite briefly', category: 'character' },
  ]);
  assert.equal(session.directions.length, baseDirectionCount + 3);
  assert.equal(session.directions[1].selected, true, 'Existing direction selection must remain preserved');

  const c1Res = createCreativeIdeaCard(project, session, {
    title: 'Sibling Card A',
    summary: 'Original summary A',
    rationale: 'Rationale A',
    epistemicStatus: 'hypothesis',
  });
  const c2Res = createCreativeIdeaCard(project, c1Res.session, {
    title: 'Sibling Card B',
    summary: 'Original summary B',
    rationale: 'Rationale B',
    epistemicStatus: 'hypothesis',
  });

  const regenCards = regenerateSingleIdeaCard(
    [c1Res.card, c2Res.card],
    c1Res.card.id,
    {
      title: 'Card A v2',
      summary: 'Regenerated summary A v2',
      rationale: 'Fresh angle while sibling stays intact',
    }
  );
  const regenCardA = regenCards.find((c) => c.id === c1Res.card.id)!;
  const siblingCardB = regenCards.find((c) => c.id === c2Res.card.id)!;
  assert.equal(regenCardA.versions.length, 2);
  assert.equal(getActiveIdeaVersion(regenCardA).title, 'Card A v2');
  assert.equal(siblingCardB.versions.length, 1, 'Sibling card B must remain untouched');
  assert.equal(getActiveIdeaVersion(siblingCardB).title, 'Sibling Card B');

  const reverted = selectIdeaCardVersion(regenCardA, regenCardA.versions[0].versionId);
  assert.equal(getActiveIdeaVersion(reverted).title, 'Sibling Card A');

  const developed = developIdeaCardFurther(reverted, {
    title: 'Card A Deepened',
    summary: 'Beat-by-beat expanded concept',
    rationale: 'Grounded in canon clues',
  });
  assert.equal(developed.versions.length, 3);
  assert.equal(getActiveIdeaVersion(developed).title, 'Card A Deepened');

  const edited = updateCreativeIdeaCardContent(reverted, {
    title: 'Author-Edited A',
    summary: 'Custom author prose sketch',
    createNewVersion: true,
  });
  assert.equal(getActiveIdeaVersion(edited).title, 'Author-Edited A');

  const combined = combineCreativeIdeaCards(project, c2Res.session, [edited, siblingCardB], {
    title: 'Combined Synthesis',
    summary: 'Merges Secret Debt with Missing Key',
    rationale: 'Unified structural payoff',
  });
  assert.equal(combined.combinedCard.versions.length, 1);
  assert.equal(combined.combinedCard.combinedFromIdeaIds.length, 2);

  const bookmarked = setIdeaCardStatus(edited, 'bookmarked');
  assert.equal(bookmarked.status, 'bookmarked');
  const dismissed = setIdeaCardStatus(bookmarked, 'dismissed');
  assert.equal(dismissed.status, 'dismissed');
  const restored = restoreDismissedIdeaCard(dismissed);
  assert.equal(restored.status, 'bookmarked');

  const reflected = attachIdeaReflection(restored, {
    alternativeExplanation: 'Think of it as a ticking clock disguised as hospitality.',
  });
  assert.equal(
    getActiveIdeaVersion(reflected).alternativeExplanation,
    'Think of it as a ticking clock disguised as hospitality.'
  );
});

test('B4: Guided Exploration / Grill Me grounds known E1 canon facts, marks downstream outdated on backtrack without deleting, and previews concept anytime', () => {
  const project = createSampleProject();
  const baseSession = createCreativeSession(project, {
    title: 'Grill Me on Antagonist Motive',
    mode: 'guided',
    interviewMode: 'grill',
    goal: 'Clarify motive without contradicting canon',
  });

  const knownFacts = extractKnownCanonFactsForScope(project, baseSession.scope);
  assert.ok(Array.isArray(knownFacts));

  // Even at 0 answered questions, Stop & Preview Concept works
  const earlyPreview = synthesizeConceptPreviewFromSession(baseSession);
  assert.ok(earlyPreview.title.length > 0);

  let session = appendGuidedQuestions(baseSession, project, [
    {
      question: 'What secret does the host protect at all costs?',
      rationale: 'Establishes root motive before scene escalations.',
      options: ['Forged treaty', 'Hidden heir'],
      recommendedAnswer: 'Forged treaty',
    },
    {
      question: 'Who suspects the secret first?',
      rationale: 'Depends on the nature of the secret.',
      options: ['Cat', 'Badger'],
      recommendedAnswer: 'Cat',
    },
  ]);

  const q1 = session.questions[0];
  const q2 = session.questions[1];

  const ans1 = answerGuidedQuestion(session, [], q1.id, {
    answerStatus: 'answered',
    selectedOptions: ['Forged treaty'],
    customAnswer: '',
  });
  session = ans1.session;

  const ans2 = answerGuidedQuestion(session, [], q2.id, {
    answerStatus: 'answered',
    selectedOptions: ['Cat'],
    customAnswer: '',
  });
  session = ans2.session;

  const cardRes = createCreativeIdeaCard(project, session, {
    title: 'Treaty Fallout Idea',
    summary: 'Follows from Forged treaty answer',
    rationale: 'Directly tied to Round 1',
    epistemicStatus: 'hypothesis',
  });
  session = cardRes.session;

  // Backtrack & revise Round 1 answer
  const revised = answerGuidedQuestion(session, [cardRes.card], q1.id, {
    answerStatus: 'answered',
    selectedOptions: ['Hidden heir'],
    customAnswer: '',
  });
  session = revised.session;

  const q1After = session.questions.find((q) => q.id === q1.id)!;
  const q2After = session.questions.find((q) => q.id === q2.id)!;
  assert.ok(revised.forkedBranchId, 'Revising an earlier answer with downstream rounds must fork a new branchId');
  assert.equal(q1After.branchId, revised.forkedBranchId);
  assert.equal(q2After.isOutdated, true, 'Downstream question must be marked isOutdated without deletion');
  assert.equal(session.questions.length, 2, 'History retention must NOT delete prior questions');
  assert.equal(
    revised.cards[0].versions.some((v) => v.isOutdated),
    true,
    'Linked session idea card versions must be marked outdated on branch backtrack'
  );
  assert.equal(
    session.draftSketch.nodes.some((n) => n.epistemicLabel === 'author-chosen'),
    true
  );

  const brief = buildCreativeSessionBriefMarkdown(project, session, revised.cards);
  assert.ok(brief.includes('Grill Me on Antagonist Motive'));

  const archived = setCreativeSessionStatus(session, 'archived');
  assert.equal(archived.status, 'archived');
});

test('B5: Grounded creative action payload builds E1 context packet and validates strict Zod schemas', async () => {
  const project = createSampleProject();
  const session = createCreativeSession(project, {
    title: 'Context Grounded Session',
    mode: 'discover',
    goal: 'Brainstorm opening twist grounded in Story Bible & manuscript',
  });

  const { packet } = buildCreativeSessionContextPacket(project, session.scope, 'opening dinner');
  assert.ok(packet.includedItems.length >= 0);

  const { payload } = buildCreativeActionPayload(project, session, 'discover');
  assert.equal(CreativeStudioActionRequestSchema.safeParse(payload).success, true);

  const localResp = synthesizeGroundedCreativeActionResponse(payload);
  assert.equal(CreativeStudioActionResponseSchema.safeParse(localResp).success, true);
  assert.ok(localResp.ideas.length >= 1);

  const execRes = await executeGroundedCreativeAction(project, session, 'story-qa', {
    customInput: 'What is already established in the opening dinner?',
    useServerAi: false,
  });
  assert.equal(execRes.usedLocalSynthesis, true);
  assert.ok(execRes.response.qaResult?.answer.length);
});

test('B6: D-13 creative-session & story-development origins + session locks compile into E3 CAS commits & D-10 durable check exists', () => {
  const project = createSampleProject();
  let session = createCreativeSession(project, {
    title: 'Bridge to E3',
    mode: 'discover',
    goal: 'Stage scene beat via UnifiedProposalEngine',
  });
  session = addSessionCreativeLock(session, {
    hardness: 'hard-structural',
    targetKind: 'custom-rule',
    targetLabel: 'Forbidden Phrase Check',
    ruleText: 'Do not include forbidden-token-xyz in staged text',
  });
  const firstSessionLockId = session.sessionLocks[0].id;
  assert.equal(session.sessionLocks[0].scope, 'session');

  const withSessionsProject = applyCreativeWorkspaceMetadataToProject(project, {
    creativeSessions: [session],
  });

  const { card } = createCreativeIdeaCard(withSessionsProject, session, {
    title: 'Candlelit Toast Scene Addition',
    summary: 'Adds a reflective toast paragraph anchored at the end of scene 1.',
    rationale: 'Preserves voice while deepening tension.',
    epistemicStatus: 'concrete-patch',
    patchBlueprint: {
      targetSectionId: withSessionsProject.narrative?.versions[0]?.sections[0]?.id,
      targetSectionTitle: 'Opening',
      operationMode: 'append-section',
      proposedProse: 'The lantern trembled against the frost on the pane.',
    },
  });

  const singleProposal = buildUnifiedProposalFromIdeaCard(withSessionsProject, session, card);
  assert.equal(singleProposal.originOperation, 'creative-session');
  assert.equal(singleProposal.provenance?.sessionId, session.id);

  const compiled = compileUnifiedProposalPreview(withSessionsProject, singleProposal);
  assert.equal(compiled.canApply, true);

  const undoState = createUndoRedoState(withSessionsProject.snapshot, withSessionsProject.revisions);
  const commit = prepareUnifiedProposalAtomicCommit(withSessionsProject, undoState, singleProposal);
  assert.equal(commit.ok, true);
  if (commit.ok) {
    assert.equal(commit.project.revision, withSessionsProject.revision + 1);
  }

  const aggProposal = buildAggregateUnifiedProposalFromCards(withSessionsProject, session, [card]);
  assert.equal(aggProposal.originOperation, 'creative-session');

  const cleanedSession = removeSessionCreativeLock(session, firstSessionLockId);
  assert.equal(cleanedSession.sessionLocks.length, 0);

  // Verify D-10 in App.tsx: flushProjectDurably must be awaited and checked before publishCurrentProject
  const appSource = fs.readFileSync(path.join(ROOT, 'App.tsx'), 'utf8');
  const applyFnStart = appSource.indexOf('const handleApplyUnifiedProposal');
  const applyFnSlice = appSource.slice(applyFnStart, applyFnStart + 1800);
  const flushIdx = applyFnSlice.indexOf('await flushProjectDurably');
  const publishIdx = applyFnSlice.indexOf('publishCurrentProject(');
  assert.ok(flushIdx > 0, 'D-10: handleApplyUnifiedProposal must await flushProjectDurably');
  assert.ok(
    publishIdx > flushIdx,
    'D-10: publishCurrentProject must only run AFTER await flushProjectDurably succeeds'
  );
  assert.ok(
    applyFnSlice.includes('if (!saveResult.saved)'),
    'D-10: handleApplyUnifiedProposal must fail closed if saveResult.saved is false'
  );
});

test('B7: SafeMarkdownReader renders structured Markdown literally without executing HTML tags, and LocalWritingInsightsBar computes local metrics cleanly', () => {
  const blocks = parseSafeMarkdownBlocks(
    '# Chapter One\n\n> Whispered vows\n\n- lantern\n- compass\n\n<script>alert(1)</script> Plain text continues.'
  );
  assert.equal(blocks[0]?.type, 'heading');
  assert.equal(blocks[1]?.type, 'blockquote');
  assert.equal(blocks[2]?.type, 'list');
  const para = blocks[3];
  assert.equal(para?.type, 'paragraph');
  if (para?.type === 'paragraph') {
    assert.ok(para.text.includes('<script>alert(1)</script>'), 'Raw HTML stays literal text source');
  }

  const insights = computeLocalSceneInsights(
    '"Stay quiet," whispered Cat. The shadows crossed the threshold quickly. Shadows lingered over the lantern, and shadows crept past the locked door.'
  );
  assert.ok(insights.wordCount > 15);
  assert.equal(insights.sentenceCount, 3);
  assert.ok(insights.dialogueRatioPercent > 0);
  assert.ok(insights.repeatedPhrases.some((r) => r.phrase === 'shadows' && r.count === 3));
});
