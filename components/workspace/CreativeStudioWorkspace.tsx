import React, { useMemo, useState } from 'react';
import type { CreativeProject } from '../../shared/types';
import type {
  CreativeIdeaCard,
  CreativeIntensityLevel,
  CreativeSession,
  CreativeStudioMode,
  InterviewBehavioralMode,
  ReadingMarginNote,
} from '../../shared/creativeSessionTypes';
import type { UnifiedProposal } from '../../shared/unifiedProposalTypes';
import {
  addSessionCreativeLock,
  answerGuidedQuestion,
  appendGuidedQuestions,
  appendSuggestedDirections,
  attachIdeaReflection,
  buildAggregateUnifiedProposalFromCards,
  buildCreativeSessionBriefMarkdown,
  buildCreativeSessionContextPacket,
  buildUnifiedProposalFromIdeaCard,
  combineCreativeIdeaCards,
  createCreativeIdeaCard,
  createCreativeSession,
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
} from '../../lib/narrative/sessions/creativeSessionEngine';
import { executeGroundedCreativeAction } from '../../lib/narrative/sessions/creativeActionService';
import { manuscriptSections } from '../../lib/narrative/manuscriptModel';
import type { WorkspaceDisclosureMode } from '../../lib/workspacePreference';

interface CreativeStudioWorkspaceProps {
  project: CreativeProject;
  aiConfigured?: boolean;
  disclosureMode?: WorkspaceDisclosureMode;
  activeSessionId?: string | null;
  onSelectSessionId?: (sessionId: string | null) => void;
  onSaveCreativeData: (updates: {
    creativeSessions?: CreativeSession[];
    creativeIdeas?: CreativeIdeaCard[];
    readingMarginNotes?: ReadingMarginNote[];
  }) => void;
  onReviewUnifiedProposal: (proposal: UnifiedProposal) => void;
  onOpenContextInspector?: () => void;
  onNavigateToWorldOutput?: () => void;
  onJumpToSection?: (sectionId: string) => void;
}

const STUDIO_MODE_META: Array<{
  id: CreativeStudioMode;
  label: string;
  subtitle: string;
}> = [
  {
    id: 'discover',
    label: 'Discover with AI',
    subtitle: '2-step directions & concrete non-canonical idea cards',
  },
  {
    id: 'guided',
    label: 'Guided Exploration / Grill Me',
    subtitle: 'Dependency-aware adaptive questions & live draft sketch',
  },
  {
    id: 'focused',
    label: 'Focused Development',
    subtitle: 'Scoped craft, subtext & beat refinement on chosen canon',
  },
  {
    id: 'story-lab',
    label: 'Story Lab',
    subtitle: 'Safe exploratory "What-If" scenario sandbox (advanced sims in WP05)',
  },
];

const SHOW_ME_HOW_EXAMPLES = [
  {
    label: 'Escalation Dilemma',
    goal: 'Create a high-stakes choice where the protagonist’s loyalty compromises a hidden secret.',
    mode: 'discover' as CreativeStudioMode,
  },
  {
    label: 'Grill Me on Continuity',
    goal: 'Stress-test scene motives and reveal causal gaps before drafting the climax.',
    mode: 'guided' as CreativeStudioMode,
  },
  {
    label: 'What-If Betrayal Pivot',
    goal: 'Test an alternate causal branch where an ally withholds critical evidence.',
    mode: 'story-lab' as CreativeStudioMode,
  },
];

export const CreativeStudioWorkspace: React.FC<CreativeStudioWorkspaceProps> = ({
  project,
  aiConfigured = false,
  disclosureMode = 'calm',
  activeSessionId,
  onSelectSessionId,
  onSaveCreativeData,
  onReviewUnifiedProposal,
  onOpenContextInspector,
  onNavigateToWorldOutput,
}) => {
  const sessions = useMemo(
    () => project.narrative?.creativeSessions ?? [],
    [project.narrative?.creativeSessions]
  );
  const allIdeas = useMemo(
    () => project.narrative?.creativeIdeas ?? [],
    [project.narrative?.creativeIdeas]
  );
  const sections = useMemo(() => manuscriptSections(project), [project]);
  const entities = useMemo(
    () => (project.snapshot.entities ?? []).filter((e) => !e.excluded),
    [project.snapshot.entities]
  );

  const visibleSessions = useMemo(
    () => sessions.filter((s) => s.status !== 'dismissed'),
    [sessions]
  );

  const currentSession: CreativeSession | null = useMemo(() => {
    if (activeSessionId) {
      const found = sessions.find((s) => s.id === activeSessionId);
      if (found) return found;
    }
    return visibleSessions[0] ?? sessions[0] ?? null;
  }, [activeSessionId, sessions, visibleSessions]);

  // Shelf & modal states
  const [shelfTab, setShelfTab] = useState<
    'sessions' | 'collection' | 'history' | 'staged'
  >('sessions');
  const [collectionQuery, setCollectionQuery] = useState('');
  const [customInput, setCustomInput] = useState('');
  const [useServerAi, setUseServerAi] = useState(false);
  const [loadingAction, setLoadingAction] = useState<string | null>(null);
  const [statusNotice, setStatusNotice] = useState<string | null>(null);

  // Per-card interactive states
  const [selectedCardIds, setSelectedCardIds] = useState<Set<string>>(() => new Set());
  const [editingCardId, setEditingCardId] = useState<string | null>(null);
  const [editDraft, setEditDraft] = useState<{
    title: string;
    summary: string;
    rationale: string;
    tags: string;
    notes: string;
  }>({ title: '', summary: '', rationale: '', tags: '', notes: '' });
  const [developingCardId, setDevelopingCardId] = useState<string | null>(null);
  const [developNote, setDevelopNote] = useState('');
  const [comparingCardsOpen, setComparingCardsOpen] = useState(false);
  const [showDismissedIdeas, setShowDismissedIdeas] = useState(false);

  // Guided Exploration / Grill Me states
  const [questionDrafts, setQuestionDrafts] = useState<
    Record<string, { selected: string[]; custom: string }>
  >({});
  const [editingQuestionId, setEditingQuestionId] = useState<string | null>(null);
  const [briefModalOpen, setBriefModalOpen] = useState(false);

  // Session Lock quick add
  const [sessionLockLabel, setSessionLockLabel] = useState('');
  const [showExamples, setShowExamples] = useState(false);

  const sessionIdeas = useMemo(() => {
    if (!currentSession) return [];
    return allIdeas.filter(
      (c) =>
        c.sessionId === currentSession.id &&
        (showDismissedIdeas || c.status !== 'dismissed')
    );
  }, [allIdeas, currentSession, showDismissedIdeas]);

  const dismissedCount = useMemo(() => {
    if (!currentSession) return 0;
    return allIdeas.filter(
      (c) => c.sessionId === currentSession.id && c.status === 'dismissed'
    ).length;
  }, [allIdeas, currentSession]);

  const collectionIdeas = useMemo(() => {
    const q = collectionQuery.trim().toLowerCase();
    return allIdeas.filter((card) => {
      if (card.status === 'dismissed') return false;
      const inCollection =
        card.status === 'bookmarked' ||
        card.status === 'in-collection' ||
        card.status === 'staged' ||
        card.status === 'applied';
      if (!inCollection) return false;
      if (!q) return true;
      const active = getActiveIdeaVersion(card);
      return (
        active.title.toLowerCase().includes(q) ||
        active.summary.toLowerCase().includes(q) ||
        card.tags.some((t) => t.toLowerCase().includes(q))
      );
    });
  }, [allIdeas, collectionQuery]);

  const updateSessionRecord = (
    updatedSession: CreativeSession,
    updatedIdeas?: CreativeIdeaCard[]
  ) => {
    const exists = sessions.some((s) => s.id === updatedSession.id);
    const nextSessions = exists
      ? sessions.map((s) => (s.id === updatedSession.id ? updatedSession : s))
      : [updatedSession, ...sessions];
    onSaveCreativeData({
      creativeSessions: nextSessions,
      ...(updatedIdeas ? { creativeIdeas: updatedIdeas } : {}),
    });
  };

  const ensureWorkingSession = (
    overrideMode?: CreativeStudioMode,
    overrideGoal?: string
  ): CreativeSession => {
    if (currentSession) {
      if (
        (overrideMode && currentSession.mode !== overrideMode) ||
        (overrideGoal && currentSession.goal !== overrideGoal)
      ) {
        const updated: CreativeSession = {
          ...currentSession,
          mode: overrideMode ?? currentSession.mode,
          goal: overrideGoal ?? currentSession.goal,
          updatedAt: new Date().toISOString(),
        };
        updateSessionRecord(updated);
        return updated;
      }
      return currentSession;
    }
    const created = createCreativeSession(project, {
      mode: overrideMode ?? 'discover',
      goal: overrideGoal ?? '',
      scope: {
        kind: sections[0] ? 'section' : 'seed',
        sectionIds: sections[0] ? [sections[0].id] : [],
        entityIds: entities[0]?.id ? [entities[0].id] : [],
      },
    });
    onSaveCreativeData({
      creativeSessions: [created, ...sessions],
    });
    onSelectSessionId?.(created.id);
    return created;
  };

  const handleCreateNewSession = (preset?: {
    mode?: CreativeStudioMode;
    goal?: string;
    title?: string;
  }) => {
    const created = createCreativeSession(project, {
      title: preset?.title,
      mode: preset?.mode ?? 'discover',
      goal: preset?.goal ?? '',
      scope: {
        kind: sections[0] ? 'section' : 'seed',
        sectionIds: sections[0] ? [sections[0].id] : [],
        entityIds: entities[0]?.id ? [entities[0].id] : [],
      },
    });
    onSaveCreativeData({
      creativeSessions: [created, ...sessions],
    });
    onSelectSessionId?.(created.id);
    setSelectedCardIds(new Set());
    setStatusNotice(`Created persistent session "${created.title}".`);
  };

  const handleSuggestMoreDirections = async (surpriseMe = false) => {
    const session = ensureWorkingSession();
    setLoadingAction(surpriseMe ? 'surprise' : 'suggest-directions');
    try {
      if (surpriseMe) {
        const nextSession = appendSuggestedDirections(session, [
          {
            label: `Surprise Pivot: Invert the hidden loyalty in ${session.scope.focusSummary.slice(0, 32)}`,
            description:
              'Introduces an unexpected structural reversal that still honors active Creative Locks.',
            category: 'Surprise Me',
            selected: true,
            origin: 'surprise-me',
          },
        ]);
        updateSessionRecord(nextSession);
        setStatusNotice('Added Surprise Me direction without clearing your existing selections.');
        return;
      }

      const { response } = await executeGroundedCreativeAction(
        project,
        session,
        'suggest-directions',
        {
          customInput: customInput.trim(),
          useServerAi: useServerAi && aiConfigured,
        }
      );

      const additions =
        customInput.trim() && response.directions.length === 0
          ? [
              {
                label: customInput.trim(),
                description: 'Author-added custom direction',
                category: 'Custom Direction',
                selected: true,
                origin: 'user-custom' as const,
              },
            ]
          : response.directions.map((d) => ({
              ...d,
              origin: customInput.trim() ? ('user-custom' as const) : ('ai-suggested' as const),
              selected: false,
            }));

      const nextSession = appendSuggestedDirections(session, additions);
      updateSessionRecord(nextSession);
      if (customInput.trim()) setCustomInput('');
      setStatusNotice(
        `Appended ${additions.length} new direction(s); prior direction selections preserved.`
      );
    } finally {
      setLoadingAction(null);
    }
  };

  const handleGenerateDirectIdea = async () => {
    const session = ensureWorkingSession();
    setLoadingAction('generate-idea');
    try {
      const { response } = await executeGroundedCreativeAction(
        project,
        session,
        'generate-idea',
        {
          customInput: customInput.trim() || session.goal,
          useServerAi: useServerAi && aiConfigured,
        }
      );

      let workingSession = session;
      const newCards: CreativeIdeaCard[] = [];
      for (const idea of response.ideas) {
        const res = createCreativeIdeaCard(project, workingSession, {
          title: idea.title,
          summary: idea.summary,
          rationale: idea.rationale,
          epistemicStatus: idea.epistemicStatus,
          assumptions: idea.assumptions,
          possibleConsequences: idea.possibleConsequences,
          craftNote: idea.craftNote,
          patchBlueprint: idea.proposedProse
            ? {
                targetSectionId: session.scope.sectionIds[0] ?? sections[0]?.id,
                targetSectionTitle:
                  sections.find((s) => s.id === (session.scope.sectionIds[0] ?? sections[0]?.id))
                    ?.title.trim() || 'Untitled Scene',
                proposedProse: idea.proposedProse,
                operationMode: 'append-section',
              }
            : undefined,
        });
        workingSession = res.session;
        newCards.push(res.card);
      }

      updateSessionRecord(workingSession, [...newCards, ...allIdeas]);
      if (customInput.trim()) setCustomInput('');
      setStatusNotice(`Generated ${newCards.length} concrete idea card(s) directly from your prompt.`);
    } finally {
      setLoadingAction(null);
    }
  };

  const handleDiscoverFromSelectedDirections = async () => {
    const session = ensureWorkingSession();
    setLoadingAction('discover');
    try {
      const { response } = await executeGroundedCreativeAction(
        project,
        session,
        'discover',
        {
          customInput: customInput.trim() || session.goal,
          useServerAi: useServerAi && aiConfigured,
        }
      );

      let workingSession = appendSuggestedDirections(
        session,
        response.directions.map((d) => ({ ...d, origin: 'ai-suggested' }))
      );
      const createdCards: CreativeIdeaCard[] = [];
      for (const idea of response.ideas) {
        const res = createCreativeIdeaCard(project, workingSession, {
          title: idea.title,
          summary: idea.summary,
          rationale: idea.rationale,
          epistemicStatus: idea.epistemicStatus,
          assumptions: idea.assumptions,
          possibleConsequences: idea.possibleConsequences,
          craftNote: idea.craftNote,
          patchBlueprint: idea.proposedProse
            ? {
                targetSectionId: workingSession.scope.sectionIds[0] ?? sections[0]?.id,
                targetSectionTitle:
                  sections
                    .find((s) => s.id === (workingSession.scope.sectionIds[0] ?? sections[0]?.id))
                    ?.title.trim() || 'Untitled Scene',
                proposedProse: idea.proposedProse,
                operationMode: 'append-section',
              }
            : undefined,
        });
        workingSession = res.session;
        createdCards.push(res.card);
      }

      updateSessionRecord(workingSession, [...createdCards, ...allIdeas]);
      setStatusNotice(response.engineSummary);
    } finally {
      setLoadingAction(null);
    }
  };

  const handleRegenerateSingleCard = async (card: CreativeIdeaCard) => {
    if (!currentSession) return;
    setLoadingAction(`regen-${card.id}`);
    try {
      const { response } = await executeGroundedCreativeAction(
        project,
        currentSession,
        'regenerate-card',
        {
          targetCards: [card],
          useServerAi: useServerAi && aiConfigured,
        }
      );
      const regenIdea = response.ideas[0];
      if (!regenIdea) return;
      const nextIdeas = regenerateSingleIdeaCard(allIdeas, card.id, {
        title: regenIdea.title,
        summary: regenIdea.summary,
        rationale: regenIdea.rationale,
        epistemicStatus: regenIdea.epistemicStatus,
        assumptions: regenIdea.assumptions,
        possibleConsequences: regenIdea.possibleConsequences,
        craftNote: regenIdea.craftNote,
      });
      updateSessionRecord(
        { ...currentSession, updatedAt: new Date().toISOString() },
        nextIdeas
      );
      setStatusNotice(`Regenerated "${regenIdea.title}" (sibling cards & prior version preserved).`);
    } finally {
      setLoadingAction(null);
    }
  };

  const handleDevelopCardFurther = async (card: CreativeIdeaCard) => {
    if (!currentSession) return;
    setLoadingAction(`develop-${card.id}`);
    try {
      const { response } = await executeGroundedCreativeAction(
        project,
        currentSession,
        'develop-further',
        {
          targetCards: [card],
          customInput: developNote.trim(),
          useServerAi: useServerAi && aiConfigured,
        }
      );
      const dev = response.ideas[0];
      if (!dev) return;
      const updatedCard = developIdeaCardFurther(card, {
        title: dev.title,
        summary: dev.summary,
        rationale: dev.rationale,
        customDirectionNote: developNote.trim(),
        craftNote: dev.craftNote,
        possibleConsequences: dev.possibleConsequences,
      });
      const nextIdeas = allIdeas.map((c) => (c.id === card.id ? updatedCard : c));
      updateSessionRecord(
        { ...currentSession, updatedAt: new Date().toISOString() },
        nextIdeas
      );
      setDevelopingCardId(null);
      setDevelopNote('');
      setStatusNotice(`Developed linked version v${getActiveIdeaVersion(updatedCard).versionNumber}.`);
    } finally {
      setLoadingAction(null);
    }
  };

  const handleCardReflection = async (
    card: CreativeIdeaCard,
    action: 'explain-differently' | 'challenge-idea'
  ) => {
    if (!currentSession) return;
    setLoadingAction(`${action}-${card.id}`);
    try {
      const { response } = await executeGroundedCreativeAction(
        project,
        currentSession,
        action,
        {
          targetCards: [card],
          useServerAi: useServerAi && aiConfigured,
        }
      );
      const updated = attachIdeaReflection(card, {
        alternativeExplanation: response.alternativeExplanation,
        challengeCritique: response.challengeCritique,
        craftNote: response.craftNote,
      });
      const nextIdeas = allIdeas.map((c) => (c.id === card.id ? updated : c));
      updateSessionRecord(
        { ...currentSession, updatedAt: new Date().toISOString() },
        nextIdeas
      );
      setStatusNotice(response.engineSummary);
    } finally {
      setLoadingAction(null);
    }
  };

  const handleCombineSelectedCards = async () => {
    if (!currentSession) return;
    const chosen = sessionIdeas.filter((c) => selectedCardIds.has(c.id));
    if (chosen.length < 2) return;
    setLoadingAction('combine');
    try {
      const { response } = await executeGroundedCreativeAction(
        project,
        currentSession,
        'combine-ideas',
        {
          targetCards: chosen,
          useServerAi: useServerAi && aiConfigured,
        }
      );
      const syn = response.ideas[0];
      const { session: nextSession, combinedCard } = combineCreativeIdeaCards(
        project,
        currentSession,
        chosen,
        syn
          ? {
              title: syn.title,
              summary: syn.summary,
              rationale: syn.rationale,
              proposedProse: syn.proposedProse,
            }
          : undefined
      );
      updateSessionRecord(nextSession, [combinedCard, ...allIdeas]);
      setSelectedCardIds(new Set([combinedCard.id]));
      setStatusNotice(`Combined ${chosen.length} ideas into "${getActiveIdeaVersion(combinedCard).title}".`);
    } finally {
      setLoadingAction(null);
    }
  };

  const handleNextInterviewRound = async () => {
    const session = ensureWorkingSession('guided');
    setLoadingAction('ask-questions');
    try {
      const { response } = await executeGroundedCreativeAction(
        project,
        session,
        'ask-questions',
        {
          customInput: customInput.trim(),
          useServerAi: useServerAi && aiConfigured,
        }
      );
      const nextSession = appendGuidedQuestions(session, project, response.questions);
      updateSessionRecord(nextSession);
      setStatusNotice(response.engineSummary);
    } finally {
      setLoadingAction(null);
    }
  };

  const handleSubmitQuestionAnswer = (
    questionId: string,
    status: 'answered' | 'skipped' | 'deferred-mystery',
    useRecommended = false
  ) => {
    if (!currentSession) return;
    const draft = questionDrafts[questionId] ?? { selected: [], custom: '' };
    const result = answerGuidedQuestion(
      currentSession,
      allIdeas,
      questionId,
      {
        answerStatus: status,
        selectedOptions: draft.selected,
        customAnswer: draft.custom,
        useRecommended,
      }
    );
    updateSessionRecord(result.session, result.cards);
    setEditingQuestionId(null);
    if (result.forkedBranchId) {
      setStatusNotice(
        'Updated earlier answer on a new branch; dependent rounds preserved and marked outdated.'
      );
    } else {
      setStatusNotice('Recorded interview decision and updated non-canonical Draft Sketch.');
    }
  };

  const handleStopAndPreviewConcept = () => {
    if (!currentSession) return;
    const preview = synthesizeConceptPreviewFromSession(currentSession);
    updateSessionRecord({
      ...currentSession,
      conceptPreview: preview,
      updatedAt: new Date().toISOString(),
    });
    setStatusNotice('Synthesized live Concept Preview from current session state.');
  };

  const handleTurnConceptIntoProposal = () => {
    if (!currentSession) return;
    const concept =
      currentSession.conceptPreview ?? synthesizeConceptPreviewFromSession(currentSession);
    const { session: nextSession, card } = createCreativeIdeaCard(project, currentSession, {
      title: concept.title,
      summary: concept.summary,
      rationale: 'Converted from Guided Exploration Concept Preview.',
      possibleConsequences: concept.possibleConnections,
      craftNote: concept.craftNote,
    });
    const nextIdeas = [card, ...allIdeas];
    updateSessionRecord(nextSession, nextIdeas);
    const proposal = buildUnifiedProposalFromIdeaCard(project, nextSession, card);
    onReviewUnifiedProposal(proposal);
  };

  const knownCanonFacts = useMemo(
    () =>
      currentSession
        ? extractKnownCanonFactsForScope(project, currentSession.scope)
        : [],
    [project, currentSession]
  );

  const contextPacketSummary = useMemo(() => {
    if (!currentSession) return null;
    return buildCreativeSessionContextPacket(project, currentSession.scope).packet;
  }, [project, currentSession]);

  const activeSessionBriefMarkdown = useMemo(() => {
    if (!currentSession) return '';
    return buildCreativeSessionBriefMarkdown(project, currentSession, sessionIdeas);
  }, [project, currentSession, sessionIdeas]);

  const activeBranchQuestions = useMemo(() => {
    if (!currentSession) return [];
    return currentSession.questions.filter((q) => !q.isOutdated);
  }, [currentSession]);

  const outdatedQuestions = useMemo(() => {
    if (!currentSession) return [];
    return currentSession.questions.filter((q) => q.isOutdated);
  }, [currentSession]);

  return (
    <section
      aria-label="Creative Studio workspace"
      data-testid="creative-studio-workspace"
      className="flex h-full min-h-0 flex-1 flex-col overflow-hidden bg-pcc-canvas text-pcc-ink dark:bg-pcc-dark-canvas dark:text-pcc-dark-ink"
    >
      {/* Top Studio Header Bar */}
      <header className="flex flex-wrap items-center justify-between gap-3 border-b border-pcc-line bg-pcc-surface px-4 py-3 dark:border-pcc-dark-line dark:bg-pcc-dark-surface">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="font-display text-lg font-bold tracking-tight">
              Creative Studio
            </h1>
            <span className="rounded border border-amber-500/40 bg-amber-950/15 px-2 py-0.5 text-[10px] font-semibold uppercase text-amber-700 dark:text-amber-300">
              Non-Canonical Draft Space (E2)
            </span>
            {currentSession && (
              <span className="rounded border border-pcc-line px-2 py-0.5 font-mono text-[10px] text-pcc-muted dark:border-pcc-dark-line">
                Base r{currentSession.baseRevision} · Session Saved
              </span>
            )}
          </div>
          <p className="text-xs text-pcc-muted dark:text-pcc-dark-muted">
            Persistent ideation, adaptive Grill Me interviews, and direct Unified Proposal (E3) staging.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2 text-xs">
          <button
            type="button"
            data-testid="studio-show-examples-btn"
            onClick={() => setShowExamples((prev) => !prev)}
            className="min-h-9 rounded-lg border border-pcc-line px-2.5 py-1 font-medium hover:bg-pcc-canvas dark:border-pcc-dark-line dark:hover:bg-pcc-dark-canvas"
          >
            {showExamples ? 'Hide Examples' : 'Show Me How'}
          </button>
          {onOpenContextInspector && (
            <button
              type="button"
              onClick={onOpenContextInspector}
              className="min-h-9 rounded-lg border border-pcc-line px-2.5 py-1 font-medium hover:bg-pcc-canvas dark:border-pcc-dark-line dark:hover:bg-pcc-dark-canvas"
            >
              Context ({contextPacketSummary?.includedItems.length ?? 0} chunks)
            </button>
          )}
          <label className="inline-flex cursor-pointer items-center gap-1.5 rounded-lg border border-pcc-line px-2.5 py-1.5 dark:border-pcc-dark-line">
            <input
              type="checkbox"
              checked={useServerAi}
              disabled={!aiConfigured}
              onChange={(e) => setUseServerAi(e.target.checked)}
              className="h-3.5 w-3.5 rounded"
            />
            <span>Use Live AI {aiConfigured ? '' : '(Local E1 Synthesis Active)'}</span>
          </label>
          <button
            type="button"
            data-testid="studio-new-session-btn"
            onClick={() => handleCreateNewSession()}
            className="min-h-9 rounded-lg bg-pcc-action px-3 py-1.5 font-semibold text-white hover:bg-pcc-action-hover"
          >
            + New Session
          </button>
        </div>
      </header>

      {/* Show Me How Quick Examples (`UIRF-04`) */}
      {showExamples && (
        <div className="border-b border-pcc-line bg-pcc-canvas px-4 py-2.5 text-xs dark:border-pcc-dark-line dark:bg-pcc-dark-canvas">
          <div className="mb-1.5 font-semibold text-pcc-ink dark:text-pcc-dark-ink">
            Starter Workflows — Click to launch a persistent session:
          </div>
          <div className="flex flex-wrap gap-2">
            {SHOW_ME_HOW_EXAMPLES.map((ex) => (
              <button
                key={ex.label}
                type="button"
                onClick={() => {
                  handleCreateNewSession({
                    title: ex.label,
                    mode: ex.mode,
                    goal: ex.goal,
                  });
                  setShowExamples(false);
                }}
                className="rounded-lg border border-pcc-line bg-pcc-surface px-3 py-1.5 text-left hover:border-pcc-action dark:border-pcc-dark-line dark:bg-pcc-dark-surface"
              >
                <div className="font-semibold">{ex.label}</div>
                <div className="text-[11px] text-pcc-muted">{ex.goal}</div>
              </button>
            ))}
          </div>
        </div>
      )}

      {statusNotice && (
        <div
          data-testid="studio-status-banner"
          className="flex items-center justify-between gap-2 border-b border-emerald-500/30 bg-emerald-950/15 px-4 py-1.5 text-xs text-emerald-800 dark:text-emerald-200"
        >
          <span>{statusNotice}</span>
          <button
            type="button"
            onClick={() => setStatusNotice(null)}
            className="rounded px-1.5 py-0.5 text-[11px] hover:bg-black/10"
          >
            Dismiss
          </button>
        </div>
      )}

      {/* Main Split: Left Session/Collection Shelf + Spacious Workspace */}
      <div className="grid min-h-0 flex-1 lg:grid-cols-[18rem_minmax(0,1fr)]">
        {/* Left Navigation & Creative Collection Shelf */}
        <aside className="flex min-h-0 flex-col border-b border-pcc-line bg-pcc-surface/70 p-3 text-xs lg:border-b-0 lg:border-r dark:border-pcc-dark-line dark:bg-pcc-dark-surface/70">
          <div className="grid grid-cols-2 gap-1 rounded-lg border border-pcc-line bg-pcc-canvas p-0.5 dark:border-pcc-dark-line dark:bg-pcc-dark-canvas">
            {([
              ['sessions', `Sessions (${visibleSessions.length})`],
              ['collection', `Collection (${collectionIdeas.length})`],
              ['history', `History (${sessions.length})`],
              ['staged', `Queued`],
            ] as const).map(([key, label]) => (
              <button
                key={key}
                type="button"
                data-testid={`studio-shelf-tab-${key}`}
                onClick={() => setShelfTab(key)}
                className={`rounded-md px-2 py-1.5 text-[11px] font-semibold ${
                  shelfTab === key
                    ? 'bg-pcc-surface text-pcc-action shadow-sm dark:bg-pcc-dark-surface dark:text-pcc-dark-ink'
                    : 'text-pcc-muted hover:text-pcc-ink'
                }`}
              >
                {label}
              </button>
            ))}
          </div>

          <div className="mt-3 flex-1 space-y-2 overflow-y-auto">
            {shelfTab === 'sessions' && (
              <>
                {visibleSessions.length === 0 ? (
                  <div className="rounded-lg border border-dashed border-pcc-line p-4 text-center text-[11px] text-pcc-muted">
                    No active Creative Sessions yet. Start one with “+ New Session”.
                  </div>
                ) : (
                  visibleSessions.map((sess) => {
                    const isSelected = currentSession?.id === sess.id;
                    const count = allIdeas.filter(
                      (c) => c.sessionId === sess.id && c.status !== 'dismissed'
                    ).length;
                    return (
                      <div
                        key={sess.id}
                        data-testid={`studio-session-item-${sess.id}`}
                        className={`rounded-lg border p-2.5 transition-colors ${
                          isSelected
                            ? 'border-pcc-action bg-pcc-surface shadow-sm dark:bg-pcc-dark-surface'
                            : 'border-pcc-line bg-pcc-canvas/70 hover:bg-pcc-surface dark:border-pcc-dark-line dark:bg-pcc-dark-canvas/60'
                        }`}
                      >
                        <button
                          type="button"
                          onClick={() => {
                            onSelectSessionId?.(sess.id);
                            setSelectedCardIds(new Set());
                          }}
                          className="w-full text-left"
                        >
                          <div className="font-semibold text-pcc-ink dark:text-pcc-dark-ink">
                            {sess.title}
                          </div>
                          <div className="mt-0.5 text-[10px] text-pcc-muted">
                            {sess.mode} · {count} idea(s) · {sess.questions.length} Qs
                          </div>
                        </button>
                        <div className="mt-1.5 flex items-center gap-2 text-[10px]">
                          <button
                            type="button"
                            onClick={() =>
                              updateSessionRecord(
                                setCreativeSessionStatus(sess, 'archived')
                              )
                            }
                            className="text-pcc-muted hover:text-pcc-ink"
                          >
                            Archive
                          </button>
                          <button
                            type="button"
                            onClick={() =>
                              updateSessionRecord(
                                setCreativeSessionStatus(sess, 'dismissed')
                              )
                            }
                            className="text-rose-600 hover:underline dark:text-rose-400"
                          >
                            Dismiss
                          </button>
                        </div>
                      </div>
                    );
                  })
                )}
              </>
            )}

            {shelfTab === 'collection' && (
              <div className="space-y-2" data-testid="creative-collection-shelf">
                <input
                  type="text"
                  data-testid="collection-search-input"
                  value={collectionQuery}
                  onChange={(e) => setCollectionQuery(e.target.value)}
                  placeholder="Filter saved ideas or tags…"
                  className="w-full rounded-md border border-pcc-line bg-pcc-canvas px-2.5 py-1.5 text-xs dark:border-pcc-dark-line dark:bg-pcc-dark-canvas"
                />
                {collectionIdeas.length === 0 ? (
                  <p className="p-3 text-center text-[11px] text-pcc-muted">
                    Bookmark (“Save for Later”) any Idea Card to keep it in this project’s Creative Collection.
                  </p>
                ) : (
                  collectionIdeas.map((card) => {
                    const ver = getActiveIdeaVersion(card);
                    return (
                      <div
                        key={card.id}
                        className="rounded-lg border border-pcc-line bg-pcc-surface p-2.5 space-y-1 dark:border-pcc-dark-line dark:bg-pcc-dark-surface"
                      >
                        <div className="font-semibold">{ver.title}</div>
                        <div className="line-clamp-2 text-[11px] text-pcc-muted">
                          {ver.summary}
                        </div>
                        <div className="flex flex-wrap items-center justify-between gap-1 pt-1">
                          <span className="rounded bg-pcc-canvas px-1.5 py-0.5 text-[10px]">
                            {card.status} · v{ver.versionNumber}
                          </span>
                          {currentSession && (
                            <button
                              type="button"
                              onClick={() =>
                                onReviewUnifiedProposal(
                                  buildUnifiedProposalFromIdeaCard(project, currentSession, card)
                                )
                              }
                              className="font-semibold text-pcc-action hover:underline dark:text-blue-300"
                            >
                              Preview E3 →
                            </button>
                          )}
                        </div>
                      </div>
                    );
                  })
                )}
              </div>
            )}

            {shelfTab === 'history' && (
              <div className="space-y-2">
                {sessions.map((sess) => (
                  <div
                    key={sess.id}
                    className="rounded-lg border border-pcc-line bg-pcc-canvas p-2 space-y-1 dark:border-pcc-dark-line dark:bg-pcc-dark-canvas"
                  >
                    <div className="flex items-center justify-between gap-1">
                      <span className="font-semibold">{sess.title}</span>
                      <span className="rounded bg-pcc-surface px-1.5 py-0.5 text-[10px]">
                        {sess.status}
                      </span>
                    </div>
                    <div className="text-[10px] text-pcc-muted">
                      Branches: {sess.branches.length} · Updated{' '}
                      {new Date(sess.updatedAt).toLocaleTimeString([], {
                        hour: '2-digit',
                        minute: '2-digit',
                      })}
                    </div>
                    {sess.status !== 'active' && (
                      <button
                        type="button"
                        onClick={() => {
                          updateSessionRecord(setCreativeSessionStatus(sess, 'active'));
                          onSelectSessionId?.(sess.id);
                        }}
                        className="rounded border border-pcc-line px-2 py-0.5 text-[10px] font-semibold hover:bg-pcc-surface"
                      >
                        Restore Session
                      </button>
                    )}
                  </div>
                ))}
              </div>
            )}

            {shelfTab === 'staged' && (
              <div className="space-y-2">
                <div className="text-[11px] text-pcc-muted">
                  Recent Unified Proposals (E3) on this project:{' '}
                  {(project.narrative?.unifiedProposals ?? []).length}
                </div>
                {(project.narrative?.unifiedProposals ?? []).slice(-8).reverse().map((p) => (
                  <div
                    key={p.id}
                    className="rounded-lg border border-pcc-line bg-pcc-surface p-2 space-y-1 dark:border-pcc-dark-line dark:bg-pcc-dark-surface"
                  >
                    <div className="font-semibold">{p.title}</div>
                    <div className="text-[10px] text-pcc-muted">
                      {p.status} · {p.originOperation} · Base r{p.baseRevision}
                    </div>
                    <button
                      type="button"
                      onClick={() => onReviewUnifiedProposal(p)}
                      className="text-[11px] font-semibold text-pcc-action hover:underline"
                    >
                      Open in E3 Review
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>

          {onNavigateToWorldOutput && (
            <button
              type="button"
              onClick={onNavigateToWorldOutput}
              className="mt-3 rounded-lg border border-pcc-line bg-pcc-canvas px-3 py-2 text-left text-[11px] font-medium hover:bg-pcc-surface dark:border-pcc-dark-line dark:bg-pcc-dark-canvas"
            >
              Visuals &amp; Concept Art Studio →
            </button>
          )}
        </aside>

        {/* Right Primary Creative Canvas */}
        <div className="flex min-h-0 flex-1 flex-col overflow-y-auto p-4 space-y-4">
          {/* 4 Studio Mode Switcher */}
          <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
            {STUDIO_MODE_META.map((item) => {
              const active = (currentSession?.mode ?? 'discover') === item.id;
              return (
                <button
                  key={item.id}
                  type="button"
                  data-testid={`studio-mode-btn-${item.id}`}
                  onClick={() => ensureWorkingSession(item.id)}
                  className={`rounded-xl border p-3 text-left transition-all ${
                    active
                      ? 'border-pcc-action bg-pcc-surface shadow-sm ring-1 ring-pcc-action/30 dark:bg-pcc-dark-surface'
                      : 'border-pcc-line bg-pcc-surface/50 hover:bg-pcc-surface dark:border-pcc-dark-line dark:bg-pcc-dark-surface/50'
                  }`}
                >
                  <div className="text-xs font-bold text-pcc-ink dark:text-pcc-dark-ink">
                    {item.label}
                  </div>
                  <div className="mt-0.5 text-[11px] text-pcc-muted dark:text-pcc-dark-muted">
                    {item.subtitle}
                  </div>
                </button>
              );
            })}
          </div>

          {/* Scope, Creative Compass & Session Locks Bar */}
          {currentSession ? (
            <div className="pcc-canon-surface rounded-xl border p-3.5 space-y-3 text-xs shadow-sm">
              <div className="grid gap-3 md:grid-cols-3">
                <div>
                  <label className="block text-[10px] font-bold uppercase tracking-wide text-pcc-muted">
                    Scope &amp; Focus Target
                  </label>
                  <select
                    aria-label="Scope target scene"
                    value={currentSession.scope.sectionIds[0] ?? ''}
                    onChange={(e) => {
                      const secId = e.target.value;
                      const nextScope = {
                        ...currentSession.scope,
                        kind: secId ? ('section' as const) : ('project' as const),
                        sectionIds: secId ? [secId] : [],
                      };
                      const secIdx = sections.findIndex((s) => s.id === secId);
                      const secObj = secIdx >= 0 ? sections[secIdx] : undefined;
                      nextScope.focusSummary = secId
                        ? `Scene: ${secObj?.title.trim() || `Scene ${secIdx + 1}`}`
                        : 'Whole Project Canon';
                      updateSessionRecord({
                        ...currentSession,
                        scope: nextScope,
                        updatedAt: new Date().toISOString(),
                      });
                    }}
                    className="mt-1 w-full rounded-md border border-pcc-line bg-pcc-canvas px-2.5 py-1.5 dark:border-pcc-dark-line dark:bg-pcc-dark-canvas"
                  >
                    <option value="">Whole Project / Seed Scope</option>
                    {sections.map((s, idx) => (
                      <option key={s.id} value={s.id}>
                        Scene: {s.title.trim() || `Scene ${idx + 1}`}
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="block text-[10px] font-bold uppercase tracking-wide text-pcc-muted">
                    Creative Intensity
                  </label>
                  <select
                    aria-label="Creative intensity"
                    data-testid="studio-intensity-select"
                    value={currentSession.intensity}
                    onChange={(e) =>
                      updateSessionRecord({
                        ...currentSession,
                        intensity: e.target.value as CreativeIntensityLevel,
                        updatedAt: new Date().toISOString(),
                      })
                    }
                    className="mt-1 w-full rounded-md border border-pcc-line bg-pcc-canvas px-2.5 py-1.5 dark:border-pcc-dark-line dark:bg-pcc-dark-canvas"
                  >
                    <option value="subtle">Subtle (Minimal disruption)</option>
                    <option value="balanced">Balanced (Canon-harmonious turns)</option>
                    <option value="bold">Bold (High dramatic escalation)</option>
                    <option value="radical">Radical (Structural What-If)</option>
                  </select>
                </div>

                <div>
                  <label className="block text-[10px] font-bold uppercase tracking-wide text-pcc-muted">
                    Session Goal / Compass
                  </label>
                  <input
                    type="text"
                    data-testid="studio-goal-input"
                    value={currentSession.goal}
                    onChange={(e) =>
                      updateSessionRecord({
                        ...currentSession,
                        goal: e.target.value,
                        updatedAt: new Date().toISOString(),
                      })
                    }
                    placeholder="What should this session explore or solve?"
                    className="mt-1 w-full rounded-md border border-pcc-line bg-pcc-canvas px-2.5 py-1.5 dark:border-pcc-dark-line dark:bg-pcc-dark-canvas"
                  />
                </div>
              </div>

              {/* Session-Scoped Locks (`Deep` disclosure or always visible compact row) */}
              {(disclosureMode === 'deep' || currentSession.sessionLocks.length > 0) && (
                <div className="flex flex-wrap items-center gap-2 border-t border-pcc-line pt-2.5 dark:border-pcc-dark-line">
                  <span className="font-semibold text-pcc-muted">
                    Session Locks ({currentSession.sessionLocks.length}):
                  </span>
                  {currentSession.sessionLocks.map((lock) => (
                    <span
                      key={lock.id}
                      className="inline-flex items-center gap-1.5 rounded-md border border-amber-500/40 bg-amber-950/15 px-2 py-0.5 text-[11px]"
                    >
                      <span>🔒 {lock.targetLabel}</span>
                      <button
                        type="button"
                        onClick={() =>
                          updateSessionRecord(
                            removeSessionCreativeLock(currentSession, lock.id)
                          )
                        }
                        className="text-rose-500 hover:underline"
                      >
                        ×
                      </button>
                    </span>
                  ))}
                  <div className="ml-auto flex items-center gap-1.5">
                    <input
                      type="text"
                      value={sessionLockLabel}
                      onChange={(e) => setSessionLockLabel(e.target.value)}
                      placeholder="Lock entity or rule for this session…"
                      className="rounded-md border border-pcc-line bg-pcc-canvas px-2 py-1 text-[11px] dark:border-pcc-dark-line dark:bg-pcc-dark-canvas"
                    />
                    <button
                      type="button"
                      disabled={!sessionLockLabel.trim()}
                      onClick={() => {
                        const updated = addSessionCreativeLock(currentSession, {
                          targetKind: 'entity',
                          targetLabel: sessionLockLabel.trim(),
                        });
                        updateSessionRecord(updated);
                        setSessionLockLabel('');
                      }}
                      className="rounded-md border border-pcc-line px-2 py-1 text-[11px] font-semibold hover:bg-pcc-canvas disabled:opacity-45 dark:border-pcc-dark-line"
                    >
                      + Session Lock
                    </button>
                  </div>
                </div>
              )}
            </div>
          ) : (
            <div className="pcc-draft-surface rounded-xl p-6 text-center text-xs space-y-3">
              <div className="text-sm font-bold">Start a Persistent Creative Session</div>
              <p className="mx-auto max-w-lg text-pcc-muted">
                Every exploration, direction, interview answer, and idea card saves inside your project without creating noisy story revisions.
              </p>
              <button
                type="button"
                data-testid="studio-empty-start-btn"
                onClick={() => handleCreateNewSession()}
                className="rounded-lg bg-pcc-action px-4 py-2 font-semibold text-white hover:bg-pcc-action-hover"
              >
                Start Creative Session
              </button>
            </div>
          )}

          {/* GUIDED EXPLORATION / GRILL ME VIEW (`B4`) */}
          {currentSession && currentSession.mode === 'guided' && (
            <div className="space-y-4" data-testid="guided-exploration-view">
              {/* Behavioral Mode + Grounding Bar */}
              <div className="pcc-canon-surface rounded-xl border p-4 space-y-3 text-xs">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex flex-wrap items-center gap-1.5">
                    {([
                      ['inspire', 'Inspire Me'],
                      ['explore', 'Explore with Me'],
                      ['grill', 'Grill Me'],
                      ['challenge', 'Challenge Me'],
                    ] as Array<[InterviewBehavioralMode, string]>).map(([mKey, mLabel]) => (
                      <button
                        key={mKey}
                        type="button"
                        data-testid={`interview-mode-${mKey}`}
                        onClick={() =>
                          updateSessionRecord({
                            ...currentSession,
                            interviewMode: mKey,
                            updatedAt: new Date().toISOString(),
                          })
                        }
                        className={`rounded-lg border px-2.5 py-1.5 font-semibold ${
                          currentSession.interviewMode === mKey
                            ? 'border-pcc-action bg-pcc-action text-white'
                            : 'border-pcc-line bg-pcc-canvas hover:bg-pcc-surface dark:border-pcc-dark-line dark:bg-pcc-dark-canvas'
                        }`}
                      >
                        {mLabel}
                      </button>
                    ))}
                  </div>

                  <div className="flex flex-wrap items-center gap-2">
                    <button
                      type="button"
                      data-testid="guided-next-question-btn"
                      disabled={loadingAction === 'ask-questions'}
                      onClick={() => void handleNextInterviewRound()}
                      className="rounded-lg bg-pcc-action px-3 py-1.5 font-semibold text-white hover:bg-pcc-action-hover disabled:opacity-50"
                    >
                      {loadingAction === 'ask-questions'
                        ? 'Preparing Question…'
                        : activeBranchQuestions.length === 0
                          ? 'Start Question Round 1'
                          : 'Next Adaptive Question →'}
                    </button>
                    <button
                      type="button"
                      data-testid="guided-stop-preview-btn"
                      onClick={handleStopAndPreviewConcept}
                      className="rounded-lg border border-emerald-500/40 bg-emerald-950/15 px-3 py-1.5 font-semibold text-emerald-700 hover:bg-emerald-950/25 dark:text-emerald-300"
                    >
                      Stop &amp; Preview Concept
                    </button>
                    <button
                      type="button"
                      data-testid="guided-brief-btn"
                      onClick={() => setBriefModalOpen(true)}
                      className="rounded-lg border border-pcc-line px-3 py-1.5 font-medium hover:bg-pcc-canvas dark:border-pcc-dark-line"
                    >
                      Session Brief
                    </button>
                  </div>
                </div>

                {/* E1 Grounded Canon Facts Notice */}
                <div className="pcc-reference-surface rounded-lg p-2.5 text-[11px]">
                  <span className="font-semibold">
                    Established Canon Respected ({knownCanonFacts.length} facts from E1 Index — will not be re-asked):
                  </span>{' '}
                  <span className="text-pcc-muted">
                    {knownCanonFacts.slice(0, 2).join(' · ') ||
                      'No constraining canon facts yet (open seed exploration).'}
                  </span>
                </div>
              </div>

              <div className="grid gap-4 xl:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)]">
                {/* Left Column: Question Rounds */}
                <div className="space-y-3">
                  {activeBranchQuestions.length === 0 ? (
                    <div className="pcc-draft-surface rounded-xl p-6 text-center text-xs space-y-2">
                      <div className="font-semibold">
                        Voluntary Adaptive Interview Ready ({currentSession.interviewMode.toUpperCase()})
                      </div>
                      <p className="text-pcc-muted">
                        Click “Start Question Round 1” to examine open story tensions without repeating facts already established in your canon.
                      </p>
                    </div>
                  ) : (
                    activeBranchQuestions.map((q) => {
                      const draft = questionDrafts[q.id] ?? {
                        selected: q.selectedOptions,
                        custom: q.customAnswer,
                      };
                      const isEditing =
                        q.answerStatus === 'unanswered' || editingQuestionId === q.id;
                      return (
                        <div
                          key={q.id}
                          data-testid={`guided-question-card-${q.id}`}
                          className="pcc-canon-surface rounded-xl border p-4 space-y-3 text-xs shadow-sm"
                        >
                          <div className="flex flex-wrap items-center justify-between gap-2">
                            <span className="rounded bg-pcc-canvas px-2 py-0.5 font-mono text-[10px] font-semibold uppercase dark:bg-pcc-dark-canvas">
                              Round {q.roundNumber} · {q.mode} · {q.answerStatus}
                            </span>
                            {!isEditing && (
                              <button
                                type="button"
                                data-testid={`guided-edit-answer-btn-${q.id}`}
                                onClick={() => setEditingQuestionId(q.id)}
                                className="rounded border border-pcc-line px-2 py-0.5 text-[11px] font-medium hover:bg-pcc-canvas dark:border-pcc-dark-line"
                              >
                                Revise Answer (Retains Branch)
                              </button>
                            )}
                          </div>

                          <div className="text-sm font-bold text-pcc-ink dark:text-pcc-dark-ink">
                            {q.question}
                          </div>
                          <p className="text-[11px] text-pcc-muted">
                            <strong>Why this matters:</strong> {q.rationale}
                          </p>

                          {/* Recommended Answer Banner */}
                          <div className="rounded-lg border border-indigo-500/30 bg-indigo-950/10 p-2.5 text-[11px]">
                            <div className="font-semibold text-indigo-700 dark:text-indigo-300">
                              Recommended Starting Answer: {q.recommendedAnswer}
                            </div>
                            <div className="mt-0.5 text-pcc-muted">{q.recommendedWhy}</div>
                          </div>

                          {isEditing ? (
                            <div className="space-y-2.5">
                              <div className="space-y-1.5">
                                {q.options.map((opt) => {
                                  const checked = draft.selected.includes(opt);
                                  return (
                                    <label
                                      key={opt}
                                      className="flex cursor-pointer items-center gap-2 rounded-lg border border-pcc-line bg-pcc-canvas px-2.5 py-2 hover:border-pcc-action dark:border-pcc-dark-line dark:bg-pcc-dark-canvas"
                                    >
                                      <input
                                        type="checkbox"
                                        checked={checked}
                                        onChange={() => {
                                          const nextSelected = checked
                                            ? draft.selected.filter((x) => x !== opt)
                                            : [...draft.selected, opt];
                                          setQuestionDrafts((prev) => ({
                                            ...prev,
                                            [q.id]: { ...draft, selected: nextSelected },
                                          }));
                                        }}
                                        className="h-3.5 w-3.5 rounded"
                                      />
                                      <span>{opt}</span>
                                    </label>
                                  );
                                })}
                              </div>

                              <textarea
                                data-testid={`guided-custom-answer-${q.id}`}
                                value={draft.custom}
                                onChange={(e) =>
                                  setQuestionDrafts((prev) => ({
                                    ...prev,
                                    [q.id]: { ...draft, custom: e.target.value },
                                  }))
                                }
                                rows={2}
                                placeholder="Or write your own nuance / custom answer…"
                                className="w-full rounded-lg border border-pcc-line bg-pcc-canvas px-2.5 py-1.5 text-xs dark:border-pcc-dark-line dark:bg-pcc-dark-canvas"
                              />

                              <div className="flex flex-wrap gap-2">
                                <button
                                  type="button"
                                  data-testid={`guided-submit-answer-${q.id}`}
                                  onClick={() =>
                                    handleSubmitQuestionAnswer(q.id, 'answered', false)
                                  }
                                  className="rounded-lg bg-pcc-action px-3 py-1.5 font-semibold text-white hover:bg-pcc-action-hover"
                                >
                                  Save Answer
                                </button>
                                <button
                                  type="button"
                                  onClick={() =>
                                    handleSubmitQuestionAnswer(q.id, 'answered', true)
                                  }
                                  className="rounded-lg border border-indigo-500/40 px-2.5 py-1.5 font-medium text-indigo-700 dark:text-indigo-300"
                                >
                                  Accept Recommended
                                </button>
                                <button
                                  type="button"
                                  data-testid={`guided-skip-mystery-${q.id}`}
                                  onClick={() =>
                                    handleSubmitQuestionAnswer(q.id, 'deferred-mystery', false)
                                  }
                                  className="rounded-lg border border-pcc-line px-2.5 py-1.5 text-pcc-muted hover:bg-pcc-canvas dark:border-pcc-dark-line"
                                >
                                  Skip / Leave as Open Mystery
                                </button>
                              </div>
                            </div>
                          ) : (
                            <div className="rounded-lg border border-emerald-500/30 bg-emerald-950/10 p-2.5">
                              <div className="text-[10px] font-semibold uppercase text-emerald-700 dark:text-emerald-300">
                                Recorded Author Decision
                              </div>
                              <div className="mt-0.5 font-medium">
                                {[...q.selectedOptions, q.customAnswer]
                                  .filter(Boolean)
                                  .join(' · ') || 'Left as Open Mystery'}
                              </div>
                            </div>
                          )}
                        </div>
                      );
                    })
                  )}

                  {outdatedQuestions.length > 0 && (
                    <div
                      data-testid="guided-outdated-branch-section"
                      className="rounded-xl border border-amber-500/30 bg-amber-950/10 p-3 text-xs space-y-1.5"
                    >
                      <div className="font-semibold text-amber-700 dark:text-amber-300">
                        Retained Earlier Branch Items ({outdatedQuestions.length} marked outdated after backtrack):
                      </div>
                      {outdatedQuestions.map((oq) => (
                        <div key={oq.id} className="text-[11px] text-pcc-muted">
                          • Round {oq.roundNumber}: {oq.question} ({oq.selectedOptions.join(', ') || oq.customAnswer || oq.answerStatus})
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                {/* Right Column: Live Non-Canonical Draft Sketch + Concept Preview */}
                <div className="space-y-3">
                  <div
                    data-testid="live-draft-sketch-panel"
                    className="pcc-draft-surface rounded-xl p-4 space-y-3 text-xs"
                  >
                    <div className="flex items-center justify-between gap-2">
                      <div>
                        <h3 className="font-display text-sm font-bold">
                          Live Non-Canonical Draft Sketch
                        </h3>
                        <p className="text-[11px] text-pcc-muted">
                          Shows known canon alongside hypotheses &amp; author choices before any canon edit.
                        </p>
                      </div>
                    </div>
                    <div className="space-y-1.5">
                      {currentSession.draftSketch.nodes.map((node) => (
                        <div
                          key={node.id}
                          className="rounded-lg border border-pcc-line bg-pcc-surface p-2 dark:border-pcc-dark-line dark:bg-pcc-dark-surface"
                        >
                          <div className="flex items-center justify-between gap-2">
                            <span className="font-semibold">{node.label}</span>
                            <span className="rounded bg-pcc-canvas px-1.5 py-0.5 font-mono text-[10px] uppercase dark:bg-pcc-dark-canvas">
                              {node.epistemicLabel}
                            </span>
                          </div>
                          {node.detail && (
                            <p className="mt-0.5 text-[11px] text-pcc-muted">{node.detail}</p>
                          )}
                        </div>
                      ))}
                    </div>
                  </div>

                  {currentSession.conceptPreview && (
                    <div
                      data-testid="concept-preview-card"
                      className="pcc-canon-surface rounded-xl border p-4 space-y-2.5 text-xs shadow-sm"
                    >
                      <div className="text-[10px] font-bold uppercase tracking-wide text-emerald-700 dark:text-emerald-300">
                        Synthesized Concept Preview (Non-Canonical)
                      </div>
                      <h4 className="text-sm font-bold">
                        {currentSession.conceptPreview.title}
                      </h4>
                      <p className="leading-relaxed">
                        {currentSession.conceptPreview.summary}
                      </p>
                      {currentSession.conceptPreview.unresolvedQuestions.length > 0 && (
                        <div className="text-[11px] text-pcc-muted">
                          <strong>Open Mysteries:</strong>{' '}
                          {currentSession.conceptPreview.unresolvedQuestions.join(' | ')}
                        </div>
                      )}
                      <button
                        type="button"
                        data-testid="concept-preview-to-e3-btn"
                        onClick={handleTurnConceptIntoProposal}
                        className="w-full rounded-lg bg-emerald-600 px-3 py-2 font-bold text-white hover:bg-emerald-500"
                      >
                        Convert Concept &amp; Review in E3 →
                      </button>
                    </div>
                  )}
                </div>
              </div>
            </div>
          )}

          {/* DISCOVER / FOCUSED / STORY LAB VIEW (`B3`) */}
          {currentSession && currentSession.mode !== 'guided' && (
            <div className="space-y-4">
              {/* Step 1: Directions & Custom Dual-Action Box */}
              <div className="pcc-canon-surface rounded-xl border p-4 space-y-3 text-xs shadow-sm">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <h2 className="font-display text-sm font-bold">
                      Step 1 — Creative Directions ({currentSession.directions.length})
                    </h2>
                    <p className="text-[11px] text-pcc-muted">
                      Select one or more directions, add your own, or append new suggestions without losing current selections.
                    </p>
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <button
                      type="button"
                      data-testid="studio-suggest-more-directions-btn"
                      disabled={Boolean(loadingAction)}
                      onClick={() => void handleSuggestMoreDirections(false)}
                      className="rounded-lg border border-pcc-line px-2.5 py-1.5 font-semibold hover:bg-pcc-canvas disabled:opacity-50 dark:border-pcc-dark-line"
                    >
                      {loadingAction === 'suggest-directions'
                        ? 'Suggesting…'
                        : 'Suggest More Directions'}
                    </button>
                    <button
                      type="button"
                      data-testid="studio-surprise-me-btn"
                      disabled={Boolean(loadingAction)}
                      onClick={() => void handleSuggestMoreDirections(true)}
                      className="rounded-lg border border-amber-500/40 bg-amber-950/10 px-2.5 py-1.5 font-semibold text-amber-700 hover:bg-amber-950/20 dark:text-amber-300"
                    >
                      Surprise Me
                    </button>
                  </div>
                </div>

                {/* Directions Grid */}
                <div className="grid gap-2 md:grid-cols-2 xl:grid-cols-3">
                  {currentSession.directions.map((dir) => (
                    <label
                      key={dir.id}
                      data-testid={`direction-card-${dir.id}`}
                      className={`flex cursor-pointer items-start gap-2.5 rounded-lg border p-2.5 transition-colors ${
                        dir.selected
                          ? 'border-pcc-action bg-pcc-action/5 dark:bg-pcc-action/15'
                          : 'border-pcc-line bg-pcc-canvas/60 hover:bg-pcc-surface dark:border-pcc-dark-line dark:bg-pcc-dark-canvas/60'
                      }`}
                    >
                      <input
                        type="checkbox"
                        checked={dir.selected}
                        onChange={() =>
                          updateSessionRecord(
                            toggleCreativeDirection(currentSession, dir.id)
                          )
                        }
                        className="mt-0.5 h-4 w-4 rounded"
                      />
                      <div className="min-w-0">
                        <div className="font-semibold text-pcc-ink dark:text-pcc-dark-ink">
                          {dir.label}
                        </div>
                        {dir.description && (
                          <div className="mt-0.5 text-[11px] text-pcc-muted">
                            {dir.description}
                          </div>
                        )}
                        <div className="mt-1 text-[10px] font-mono uppercase text-pcc-muted">
                          {dir.category} · {dir.origin}
                        </div>
                      </div>
                    </label>
                  ))}
                </div>

                {/* Custom Input with Explicit TWO Actions (`Suggest Directions` vs `Generate Idea`) + Develop Selected */}
                <div className="flex flex-col gap-2 border-t border-pcc-line pt-3 sm:flex-row sm:items-center dark:border-pcc-dark-line">
                  <input
                    type="text"
                    data-testid="studio-custom-input"
                    value={customInput}
                    onChange={(e) => setCustomInput(e.target.value)}
                    placeholder="Write a custom direction or direct idea spark…"
                    className="flex-1 rounded-lg border border-pcc-line bg-pcc-canvas px-3 py-2 text-xs dark:border-pcc-dark-line dark:bg-pcc-dark-canvas"
                  />
                  <div className="flex flex-wrap items-center gap-2">
                    <button
                      type="button"
                      data-testid="studio-custom-suggest-directions-btn"
                      disabled={!customInput.trim() || Boolean(loadingAction)}
                      onClick={() => void handleSuggestMoreDirections(false)}
                      className="rounded-lg border border-pcc-line px-3 py-2 font-semibold hover:bg-pcc-canvas disabled:opacity-45 dark:border-pcc-dark-line"
                    >
                      + Suggest Directions
                    </button>
                    <button
                      type="button"
                      data-testid="studio-custom-generate-idea-btn"
                      disabled={!customInput.trim() || Boolean(loadingAction)}
                      onClick={() => void handleGenerateDirectIdea()}
                      className="rounded-lg border border-indigo-500/40 bg-indigo-950/15 px-3 py-2 font-semibold text-indigo-700 hover:bg-indigo-950/25 disabled:opacity-45 dark:text-indigo-300"
                    >
                      {loadingAction === 'generate-idea'
                        ? 'Generating…'
                        : '★ Generate Idea'}
                    </button>
                    <button
                      type="button"
                      data-testid="studio-develop-selected-btn"
                      disabled={Boolean(loadingAction)}
                      onClick={() => void handleDiscoverFromSelectedDirections()}
                      className="rounded-lg bg-pcc-action px-3.5 py-2 font-bold text-white hover:bg-pcc-action-hover disabled:opacity-50"
                    >
                      {loadingAction === 'discover'
                        ? 'Discovering…'
                        : 'Develop with Selected Directions'}
                    </button>
                  </div>
                </div>
              </div>

              {/* Step 2: Concrete Idea Cards & Multi-Select Toolbar (`GS-04`, `B3`) */}
              <div className="space-y-3">
                <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
                  <div className="flex items-center gap-2">
                    <h2 className="font-display text-sm font-bold">
                      Step 2 — Idea Cards ({sessionIdeas.length})
                    </h2>
                    {dismissedCount > 0 && (
                      <label className="inline-flex cursor-pointer items-center gap-1 text-[11px] text-pcc-muted">
                        <input
                          type="checkbox"
                          checked={showDismissedIdeas}
                          onChange={(e) => setShowDismissedIdeas(e.target.checked)}
                          className="h-3.5 w-3.5 rounded"
                        />
                        Show {dismissedCount} dismissed
                      </label>
                    )}
                  </div>

                  {/* Multi-Select Batch Toolbar (`GS-04`) */}
                  {selectedCardIds.size > 0 && (
                    <div
                      data-testid="studio-multi-select-toolbar"
                      className="flex flex-wrap items-center gap-1.5 rounded-lg border border-pcc-action/40 bg-pcc-surface px-2.5 py-1.5 shadow-sm dark:bg-pcc-dark-surface"
                    >
                      <span className="font-semibold text-pcc-action dark:text-blue-300">
                        {selectedCardIds.size} selected:
                      </span>
                      {selectedCardIds.size >= 2 && (
                        <>
                          <button
                            type="button"
                            data-testid="studio-combine-selected-btn"
                            disabled={loadingAction === 'combine'}
                            onClick={() => void handleCombineSelectedCards()}
                            className="rounded border border-pcc-line px-2 py-0.5 font-semibold hover:bg-pcc-canvas dark:border-pcc-dark-line"
                          >
                            Combine Selected
                          </button>
                          <button
                            type="button"
                            data-testid="studio-compare-selected-btn"
                            onClick={() => setComparingCardsOpen((prev) => !prev)}
                            className="rounded border border-pcc-line px-2 py-0.5 font-semibold hover:bg-pcc-canvas dark:border-pcc-dark-line"
                          >
                            {comparingCardsOpen ? 'Close Compare' : 'Compare'}
                          </button>
                        </>
                      )}
                      <button
                        type="button"
                        onClick={() => {
                          const nextIdeas = allIdeas.map((c) =>
                            selectedCardIds.has(c.id)
                              ? setIdeaCardStatus(c, 'bookmarked')
                              : c
                          );
                          updateSessionRecord(currentSession, nextIdeas);
                          setStatusNotice(`Saved ${selectedCardIds.size} card(s) to Creative Collection.`);
                        }}
                        className="rounded border border-pcc-line px-2 py-0.5 font-medium hover:bg-pcc-canvas dark:border-pcc-dark-line"
                      >
                        Save to Collection
                      </button>
                      <button
                        type="button"
                        data-testid="studio-batch-preview-e3-btn"
                        onClick={() => {
                          const chosen = sessionIdeas.filter((c) => selectedCardIds.has(c.id));
                          if (chosen.length === 0) return;
                          onReviewUnifiedProposal(
                            buildAggregateUnifiedProposalFromCards(
                              project,
                              currentSession,
                              chosen
                            )
                          );
                        }}
                        className="rounded bg-emerald-600 px-2.5 py-0.5 font-bold text-white hover:bg-emerald-500"
                      >
                        Preview Batch in E3 →
                      </button>
                    </div>
                  )}
                </div>

                {/* Side-by-side comparison drawer */}
                {comparingCardsOpen && selectedCardIds.size >= 2 && (
                  <div
                    data-testid="studio-compare-cards-panel"
                    className="grid gap-3 rounded-xl border border-indigo-500/40 bg-pcc-surface p-3.5 md:grid-cols-2 dark:bg-pcc-dark-surface"
                  >
                    {sessionIdeas
                      .filter((c) => selectedCardIds.has(c.id))
                      .map((card) => {
                        const ver = getActiveIdeaVersion(card);
                        return (
                          <div
                            key={card.id}
                            className="rounded-lg border border-pcc-line bg-pcc-canvas p-3 text-xs space-y-1.5 dark:border-pcc-dark-line dark:bg-pcc-dark-canvas"
                          >
                            <div className="font-bold">{ver.title} (v{ver.versionNumber})</div>
                            <div>{ver.summary}</div>
                            <div className="text-[11px] text-pcc-muted">{ver.rationale}</div>
                          </div>
                        );
                      })}
                  </div>
                )}

                {sessionIdeas.length === 0 ? (
                  <div className="pcc-draft-surface rounded-xl p-6 text-center text-xs text-pcc-muted">
                    Select creative directions above and click “Develop with Selected Directions” or type your own spark and click “★ Generate Idea”.
                  </div>
                ) : (
                  <div className="grid gap-3 md:grid-cols-2">
                    {sessionIdeas.map((card) => {
                      const activeVer = getActiveIdeaVersion(card);
                      const isSelected = selectedCardIds.has(card.id);
                      const isEditing = editingCardId === card.id;
                      const isDeveloping = developingCardId === card.id;

                      return (
                        <article
                          key={card.id}
                          data-testid={`idea-card-${card.id}`}
                          className={`pcc-draft-surface flex flex-col justify-between gap-3 rounded-xl p-4 text-xs shadow-sm ${
                            card.status === 'dismissed' ? 'opacity-60' : ''
                          }`}
                        >
                          <div className="space-y-2">
                            <div className="flex flex-wrap items-start justify-between gap-2">
                              <label className="inline-flex cursor-pointer items-center gap-2 font-bold text-sm text-pcc-ink dark:text-pcc-dark-ink">
                                <input
                                  type="checkbox"
                                  data-testid={`select-idea-card-${card.id}`}
                                  checked={isSelected}
                                  onChange={() => {
                                    setSelectedCardIds((prev) => {
                                      const next = new Set(prev);
                                      if (next.has(card.id)) next.delete(card.id);
                                      else next.add(card.id);
                                      return next;
                                    });
                                  }}
                                  className="h-4 w-4 rounded"
                                />
                                <span>{activeVer.title}</span>
                              </label>
                              <div className="flex flex-wrap items-center gap-1">
                                <span className="rounded bg-pcc-surface px-1.5 py-0.5 font-mono text-[10px] uppercase border border-pcc-line dark:bg-pcc-dark-surface dark:border-pcc-dark-line">
                                  {activeVer.epistemicStatus}
                                </span>
                                <span className="rounded bg-pcc-surface px-1.5 py-0.5 font-mono text-[10px] border border-pcc-line dark:bg-pcc-dark-surface dark:border-pcc-dark-line">
                                  {card.status}
                                </span>
                              </div>
                            </div>

                            {/* Version Lineage Pills (`v1`, `v2`, ...) */}
                            {card.versions.length > 1 && (
                              <div className="flex flex-wrap items-center gap-1">
                                <span className="text-[10px] text-pcc-muted">Versions:</span>
                                {card.versions.map((ver) => (
                                  <button
                                    key={ver.versionId}
                                    type="button"
                                    onClick={() => {
                                      const updated = selectIdeaCardVersion(card, ver.versionId);
                                      updateSessionRecord(
                                        currentSession,
                                        allIdeas.map((c) => (c.id === card.id ? updated : c))
                                      );
                                    }}
                                    className={`rounded px-1.5 py-0.5 font-mono text-[10px] ${
                                      ver.versionId === card.activeVersionId
                                        ? 'bg-pcc-action font-bold text-white'
                                        : 'bg-pcc-surface text-pcc-muted border border-pcc-line dark:bg-pcc-dark-surface'
                                    }`}
                                  >
                                    v{ver.versionNumber}
                                  </button>
                                ))}
                              </div>
                            )}

                            {isEditing ? (
                              <div className="space-y-2 rounded-lg border border-pcc-line bg-pcc-surface p-2.5 dark:bg-pcc-dark-surface">
                                <input
                                  type="text"
                                  data-testid={`edit-idea-title-${card.id}`}
                                  value={editDraft.title}
                                  onChange={(e) =>
                                    setEditDraft((prev) => ({ ...prev, title: e.target.value }))
                                  }
                                  className="w-full rounded border border-pcc-line bg-pcc-canvas px-2 py-1 text-xs dark:bg-pcc-dark-canvas"
                                />
                                <textarea
                                  data-testid={`edit-idea-summary-${card.id}`}
                                  value={editDraft.summary}
                                  onChange={(e) =>
                                    setEditDraft((prev) => ({ ...prev, summary: e.target.value }))
                                  }
                                  rows={3}
                                  className="w-full rounded border border-pcc-line bg-pcc-canvas px-2 py-1 text-xs dark:bg-pcc-dark-canvas"
                                />
                                <input
                                  type="text"
                                  value={editDraft.tags}
                                  onChange={(e) =>
                                    setEditDraft((prev) => ({ ...prev, tags: e.target.value }))
                                  }
                                  placeholder="Comma-separated tags (e.g. betrayal, act-2)"
                                  className="w-full rounded border border-pcc-line bg-pcc-canvas px-2 py-1 text-[11px] dark:bg-pcc-dark-canvas"
                                />
                                <div className="flex gap-1.5">
                                  <button
                                    type="button"
                                    data-testid={`save-edit-idea-${card.id}`}
                                    onClick={() => {
                                      const updated = updateCreativeIdeaCardContent(card, {
                                        title: editDraft.title,
                                        summary: editDraft.summary,
                                        rationale: editDraft.rationale,
                                        tags: editDraft.tags
                                          .split(',')
                                          .map((t) => t.trim())
                                          .filter(Boolean),
                                        notes: editDraft.notes,
                                        createNewVersion: true,
                                      });
                                      updateSessionRecord(
                                        currentSession,
                                        allIdeas.map((c) => (c.id === card.id ? updated : c))
                                      );
                                      setEditingCardId(null);
                                      setStatusNotice(`Saved manual edit as v${getActiveIdeaVersion(updated).versionNumber}.`);
                                    }}
                                    className="rounded bg-pcc-action px-2.5 py-1 text-[11px] font-semibold text-white"
                                  >
                                    Save as New Version
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() => setEditingCardId(null)}
                                    className="rounded border border-pcc-line px-2 py-1 text-[11px]"
                                  >
                                    Cancel
                                  </button>
                                </div>
                              </div>
                            ) : (
                              <>
                                <p className="leading-relaxed text-pcc-ink dark:text-pcc-dark-ink">
                                  {activeVer.summary}
                                </p>
                                <p className="text-[11px] text-pcc-muted">
                                  <strong>Grounding &amp; Rationale:</strong> {activeVer.rationale}
                                </p>
                                {activeVer.alternativeExplanation && (
                                  <div className="rounded border border-indigo-500/30 bg-indigo-950/10 p-2 text-[11px]">
                                    <strong>Structural Reframing:</strong>{' '}
                                    {activeVer.alternativeExplanation}
                                  </div>
                                )}
                                {activeVer.challengeCritique && (
                                  <div className="whitespace-pre-wrap rounded border border-amber-500/30 bg-amber-950/10 p-2 text-[11px]">
                                    <strong>Stress-Test Challenge:</strong>{' '}
                                    {activeVer.challengeCritique}
                                  </div>
                                )}
                                {activeVer.craftNote && (
                                  <div className="text-[11px] italic text-pcc-muted">
                                    Craft note: {activeVer.craftNote}
                                  </div>
                                )}
                              </>
                            )}

                            {isDeveloping && (
                              <div className="space-y-1.5 rounded-lg border border-pcc-line bg-pcc-surface p-2.5 dark:bg-pcc-dark-surface">
                                <input
                                  type="text"
                                  data-testid={`develop-note-input-${card.id}`}
                                  value={developNote}
                                  onChange={(e) => setDevelopNote(e.target.value)}
                                  placeholder="Optional refinement instruction (e.g. heighten dialogue tension)…"
                                  className="w-full rounded border border-pcc-line bg-pcc-canvas px-2 py-1 text-xs dark:bg-pcc-dark-canvas"
                                />
                                <div className="flex gap-1.5">
                                  <button
                                    type="button"
                                    data-testid={`confirm-develop-btn-${card.id}`}
                                    disabled={loadingAction === `develop-${card.id}`}
                                    onClick={() => void handleDevelopCardFurther(card)}
                                    className="rounded bg-pcc-action px-2.5 py-1 text-[11px] font-semibold text-white"
                                  >
                                    Generate Linked Version
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() => setDevelopingCardId(null)}
                                    className="rounded border border-pcc-line px-2 py-1 text-[11px]"
                                  >
                                    Cancel
                                  </button>
                                </div>
                              </div>
                            )}
                          </div>

                          {/* Card Action Bar */}
                          <div className="flex flex-wrap items-center gap-1.5 border-t border-pcc-line/70 pt-2.5 dark:border-pcc-dark-line/70">
                            <button
                              type="button"
                              data-testid={`card-preview-e3-btn-${card.id}`}
                              onClick={() =>
                                onReviewUnifiedProposal(
                                  buildUnifiedProposalFromIdeaCard(
                                    project,
                                    currentSession,
                                    card
                                  )
                                )
                              }
                              className="rounded-md bg-emerald-600 px-2.5 py-1 text-[11px] font-bold text-white hover:bg-emerald-500"
                            >
                              Preview &amp; Apply in E3
                            </button>
                            <button
                              type="button"
                              data-testid={`card-edit-btn-${card.id}`}
                              onClick={() => {
                                setEditingCardId(card.id);
                                setEditDraft({
                                  title: activeVer.title,
                                  summary: activeVer.summary,
                                  rationale: activeVer.rationale,
                                  tags: card.tags.join(', '),
                                  notes: card.notes,
                                });
                              }}
                              className="rounded-md border border-pcc-line bg-pcc-surface px-2 py-1 text-[11px] font-medium hover:bg-pcc-canvas dark:bg-pcc-dark-surface"
                            >
                              Edit Idea
                            </button>
                            <button
                              type="button"
                              data-testid={`card-regenerate-btn-${card.id}`}
                              disabled={loadingAction === `regen-${card.id}`}
                              onClick={() => void handleRegenerateSingleCard(card)}
                              className="rounded-md border border-pcc-line bg-pcc-surface px-2 py-1 text-[11px] font-medium hover:bg-pcc-canvas dark:bg-pcc-dark-surface"
                            >
                              {loadingAction === `regen-${card.id}` ? 'Regen…' : 'Regenerate'}
                            </button>
                            <button
                              type="button"
                              data-testid={`card-develop-btn-${card.id}`}
                              onClick={() => setDevelopingCardId(isDeveloping ? null : card.id)}
                              className="rounded-md border border-pcc-line bg-pcc-surface px-2 py-1 text-[11px] font-medium hover:bg-pcc-canvas dark:bg-pcc-dark-surface"
                            >
                              Develop Further
                            </button>
                            <button
                              type="button"
                              data-testid={`card-bookmark-btn-${card.id}`}
                              onClick={() => {
                                const nextStatus =
                                  card.status === 'bookmarked' ? 'draft' : 'bookmarked';
                                updateSessionRecord(
                                  currentSession,
                                  allIdeas.map((c) =>
                                    c.id === card.id ? setIdeaCardStatus(c, nextStatus) : c
                                  )
                                );
                              }}
                              className="rounded-md border border-pcc-line bg-pcc-surface px-2 py-1 text-[11px] font-medium hover:bg-pcc-canvas dark:bg-pcc-dark-surface"
                            >
                              {card.status === 'bookmarked' ? 'Saved ✓' : 'Save for Later'}
                            </button>
                            <button
                              type="button"
                              onClick={() =>
                                void handleCardReflection(card, 'explain-differently')
                              }
                              className="rounded-md border border-pcc-line bg-pcc-surface px-2 py-1 text-[11px] font-medium hover:bg-pcc-canvas dark:bg-pcc-dark-surface"
                            >
                              Explain Differently
                            </button>
                            <button
                              type="button"
                              onClick={() =>
                                void handleCardReflection(card, 'challenge-idea')
                              }
                              className="rounded-md border border-pcc-line bg-pcc-surface px-2 py-1 text-[11px] font-medium hover:bg-pcc-canvas dark:bg-pcc-dark-surface"
                            >
                              Challenge
                            </button>
                            {card.status === 'dismissed' ? (
                              <button
                                type="button"
                                data-testid={`card-restore-btn-${card.id}`}
                                onClick={() =>
                                  updateSessionRecord(
                                    currentSession,
                                    allIdeas.map((c) =>
                                      c.id === card.id
                                        ? restoreDismissedIdeaCard(c)
                                        : c
                                    )
                                  )
                                }
                                className="rounded-md border border-emerald-500/40 px-2 py-1 text-[11px] font-semibold text-emerald-700 dark:text-emerald-300"
                              >
                                Restore
                              </button>
                            ) : (
                              <button
                                type="button"
                                data-testid={`card-dismiss-btn-${card.id}`}
                                onClick={() =>
                                  updateSessionRecord(
                                    currentSession,
                                    allIdeas.map((c) =>
                                      c.id === card.id
                                        ? setIdeaCardStatus(c, 'dismissed')
                                        : c
                                    )
                                  )
                                }
                                className="rounded-md border border-rose-500/30 px-2 py-1 text-[11px] text-rose-600 hover:bg-rose-950/10 dark:text-rose-400"
                              >
                                Dismiss
                              </button>
                            )}
                          </div>
                        </article>
                      );
                    })}
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Session Brief / Handoff Modal (`CE-09.1`) */}
      {briefModalOpen && currentSession && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/80 p-4 backdrop-blur-sm"
          role="dialog"
          aria-modal="true"
          aria-label="Creative Session Brief"
          data-testid="creative-session-brief-modal"
        >
          <div className="flex max-h-[85vh] w-full max-w-2xl flex-col overflow-hidden rounded-2xl border border-slate-700 bg-slate-900 text-slate-100 shadow-2xl">
            <div className="flex items-center justify-between border-b border-slate-800 px-5 py-3">
              <h3 className="text-sm font-bold">Creative Session Brief &amp; Handoff</h3>
              <button
                type="button"
                onClick={() => setBriefModalOpen(false)}
                className="rounded border border-slate-700 px-2.5 py-1 text-xs hover:bg-slate-800"
              >
                Close
              </button>
            </div>
            <pre className="flex-1 overflow-y-auto whitespace-pre-wrap p-5 font-mono text-xs leading-relaxed text-slate-200">
              {activeSessionBriefMarkdown}
            </pre>
          </div>
        </div>
      )}
    </section>
  );
};
