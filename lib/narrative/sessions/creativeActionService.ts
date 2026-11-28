import { CreativeProject } from '../../../shared/types';
import {
  CreativeAiActionKind,
  CreativeStudioActionRequest,
  CreativeStudioActionResponse,
  CreativeStudioActionResponseSchema,
} from '../../../shared/narrativeAiSchemas';
import {
  CreativeIdeaCard,
  CreativeSession,
} from '../../../shared/creativeSessionTypes';
import { NarrativeMemoryIndexSnapshot } from '../../../shared/narrativeMemoryTypes';
import {
  buildCreativeSessionContextPacket,
  CreativeSessionContextPacket,
  extractKnownCanonFactsForScope,
  getActiveIdeaVersion,
} from './creativeSessionEngine';
import { requestCreativeStudioAction } from '../../../services/apiClient';

/**
 * PCC-EV-WP03 — Engine E2 + E1 Creative Collaboration Action Coordinator (`B3`, `B4`, `B5`).
 *
 * Bridges Creative Studio, Focused Development, Guided Exploration / Grill Me, and Story Q&A
 * with the Narrative Memory Index (E1) and the server `/api/narrative/opportunities/creative-action`
 * contract, while also providing a grounded local synthesis mode when the author chooses
 * local canon synthesis or when operating in offline/local-only projects.
 */

export function buildCreativeActionPayload(
  project: CreativeProject,
  session: CreativeSession,
  action: CreativeAiActionKind,
  options: {
    customInput?: string;
    targetCards?: CreativeIdeaCard[];
    language?: 'en' | 'tr';
    contextPacket?: CreativeSessionContextPacket;
    memoryIndex?: NarrativeMemoryIndexSnapshot | null;
  } = {}
): {
  payload: CreativeStudioActionRequest;
  contextPacket: CreativeSessionContextPacket;
} {
  const packet =
    options.contextPacket ??
    buildCreativeSessionContextPacket(
      project,
      session.scope,
      options.customInput || session.goal || session.scope.seedPrompt,
      `creative-studio:${action}`,
      options.memoryIndex
    ).packet;

  const knownCanonFacts = extractKnownCanonFactsForScope(project, session.scope);
  const selectedDirections = session.directions
    .filter((d) => d.selected)
    .map((d) => ({
      id: d.id,
      label: d.label,
      description: d.description,
      category: d.category,
    }));

  const targetCards = (options.targetCards ?? []).map((c) => {
    const v = getActiveIdeaVersion(c);
    return {
      id: c.id,
      title: v.title,
      summary: v.summary,
      rationale: v.rationale,
    };
  });

  const answeredQuestions = session.questions
    .filter((q) => !q.isOutdated && q.answerStatus === 'answered')
    .map((q) => ({
      question: q.question,
      answer: [...q.selectedOptions, q.customAnswer].filter(Boolean).join('; '),
    }));

  const contextBlocks = packet.includedItems
    .slice(0, 12)
    .map((item) => ({
      sourceId: item.sourceId || item.chunkId,
      label: item.label,
      category: item.category,
      excerpt: item.textExcerpt.slice(0, 320),
    }));

  const payload: CreativeStudioActionRequest = {
    action,
    projectId: project.id,
    projectTitle: project.name || 'Untitled Project',
    studioMode: session.mode,
    interviewMode: session.interviewMode,
    intensity: session.intensity,
    compassSummary: session.compassSummary,
    scopeSummary: session.scope.focusSummary,
    seedPrompt: session.scope.seedPrompt,
    customInput: options.customInput?.trim() ?? '',
    selectedDirections,
    existingDirections: session.directions.map((d) => d.label),
    targetCards,
    knownCanonFacts,
    answeredQuestions,
    contextBlocks,
    language: options.language ?? 'en',
  };

  return { payload, contextPacket: packet };
}

/**
 * Grounded local canon synthesis generator for Creative Studio actions (`B3`, `B4`, `B5`, `B7`).
 * Uses real E1 ContextInspectorPacket blocks, scope entities/scenes, selected directions,
 * and answered interview rounds to construct schema-validated `CreativeStudioActionResponse`
 * payloads deterministically when local synthesis is requested or as a resilient fallback.
 */
export function synthesizeGroundedCreativeActionResponse(
  req: CreativeStudioActionRequest
): CreativeStudioActionResponse {
  const topBlocks = req.contextBlocks.slice(0, 4);
  const primaryAnchor = topBlocks[0]?.label || req.scopeSummary || req.projectTitle;
  const secondaryAnchor = topBlocks[1]?.label || req.knownCanonFacts[0] || 'established timeline';
  const activeDirectionLabels =
    req.selectedDirections.map((d) => d.label).join(' + ') ||
    req.customInput ||
    'Character tension & thematic resonance';

  const intensityPrefix =
    req.intensity === 'radical'
      ? 'Radical Reversal'
      : req.intensity === 'bold'
        ? 'High-Stakes Escalation'
        : req.intensity === 'subtle'
          ? 'Subtle Nuance'
          : 'Balanced Development';

  switch (req.action) {
    case 'suggest-directions': {
      const customSeed = req.customInput.trim();
      const directions = [
        {
          label: customSeed
            ? `Reframe "${customSeed.slice(0, 48)}" through ${primaryAnchor}`
            : `Expose the unspoken friction in ${primaryAnchor}`,
          description: `Connects ${primaryAnchor} directly to ${secondaryAnchor} without breaking active constraints.`,
          category: 'Tension & Stakes',
        },
        {
          label: customSeed
            ? `Invert the expected cost of "${customSeed.slice(0, 44)}"`
            : `Force an irreversible character commitment around ${secondaryAnchor}`,
          description: `Applies ${req.intensity} creative intensity while honoring: ${req.compassSummary || 'core character voice'}.`,
          category: 'Character Agency',
        },
        {
          label: `Plant a sensory motif echoing ${primaryAnchor}`,
          description: `Creates a quiet structural callback that deepens thematic cohesion across scenes.`,
          category: 'Atmosphere & Motif',
        },
      ].filter((d) => !req.existingDirections.includes(d.label));

      return CreativeStudioActionResponseSchema.parse({
        action: 'suggest-directions',
        engineSummary: `Suggested ${directions.length} new E1-grounded directions anchored to ${primaryAnchor}.`,
        directions,
        ideas: [],
        questions: [],
      });
    }

    case 'generate-idea': {
      const promptFocus = req.customInput.trim() || activeDirectionLabels;
      return CreativeStudioActionResponseSchema.parse({
        action: 'generate-idea',
        engineSummary: `Generated a concrete idea card directly from "${promptFocus.slice(0, 60)}".`,
        directions: [],
        ideas: [
          {
            title: `${intensityPrefix}: ${promptFocus.slice(0, 56)}`,
            summary: `In ${primaryAnchor}, translate "${promptFocus}" into an immediate dramatic beat where every word spoken carries a tangible cost tied to ${secondaryAnchor}.`,
            rationale: `Directly realizes the author's custom prompt while staying grounded in ${topBlocks.length} E1 memory blocks.`,
            epistemicStatus: 'hypothesis',
            assumptions: [
              `Assumes ${primaryAnchor} remains the focal emotional anchor.`,
            ],
            possibleConsequences: [
              `Shifts downstream scene tension around ${secondaryAnchor}.`,
            ],
            craftNote: `Let physical subtext carry half the weight of the revelation rather than explicit dialogue exposition.`,
            proposedProse: `${req.customInput.trim() ? `${req.customInput.trim()}\n\n` : ''}The silence inside ${primaryAnchor} sharpened—every detail of ${secondaryAnchor} suddenly weighed on the next decision.`,
          },
        ],
        questions: [],
      });
    }

    case 'regenerate-card': {
      const target = req.targetCards[0];
      const prevTitle = target?.title || 'Creative Concept';
      return CreativeStudioActionResponseSchema.parse({
        action: 'regenerate-card',
        engineSummary: `Regenerated an alternative angle for "${prevTitle}" while preserving sibling cards and prior version history.`,
        directions: [],
        ideas: [
          {
            title: `${prevTitle} — Alternative Angle (${intensityPrefix})`,
            summary: `Instead of approaching ${primaryAnchor} head-on, pivot the beat through ${secondaryAnchor} so the revelation arrives via an unexpected contradiction (${activeDirectionLabels}).`,
            rationale: `Provides a distinct structural alternative to "${prevTitle}" using the same canonical anchors.`,
            epistemicStatus: 'hypothesis',
            assumptions: [
              `Preserves established canon facts (${req.knownCanonFacts.length} facts verified).`,
            ],
            possibleConsequences: [
              `Opens a sharper dramatic transition into the following scene.`,
            ],
            craftNote: `Contrast external calm with internal urgency to heighten pacing contrast.`,
            proposedProse: `Rather than forcing the confrontation immediately, the realization surfaced sideways through ${primaryAnchor}, recasting ${secondaryAnchor} in a colder light.`,
          },
        ],
        questions: [],
      });
    }

    case 'develop-further': {
      const target = req.targetCards[0];
      const baseTitle = target?.title || 'Idea';
      const baseSummary = target?.summary || '';
      const guidance = req.customInput.trim() || activeDirectionLabels;
      return CreativeStudioActionResponseSchema.parse({
        action: 'develop-further',
        engineSummary: `Developed "${baseTitle}" further with direction: ${guidance.slice(0, 64)}.`,
        directions: [],
        ideas: [
          {
            title: `${baseTitle} (Developed)`,
            summary: `${baseSummary} Pushing further via "${guidance}": anchor the turning point in ${primaryAnchor} with a concrete sensory action and an explicit consequence for ${secondaryAnchor}.`,
            rationale: `Preserves the core concept of "${baseTitle}" while deepening specificity and causal payoff.`,
            epistemicStatus: 'concrete-patch',
            assumptions: [
              `Retains the original card's core premise while layering ${guidance}.`,
            ],
            possibleConsequences: [
              `Creates a concrete hook ready for Unified Proposal (E3) staging.`,
            ],
            craftNote: `End the beat on an unresolved gesture or line of dialogue that propels the reader forward.`,
            proposedProse: `${baseSummary}\n\nDriven by ${guidance}, the tension within ${primaryAnchor} crystallized into an unmistakable turning point for ${secondaryAnchor}.`,
          },
        ],
        questions: [],
      });
    }

    case 'combine-ideas': {
      const titles = req.targetCards.map((c) => c.title).join(' + ');
      const summaries = req.targetCards.map((c) => c.summary).join(' ');
      return CreativeStudioActionResponseSchema.parse({
        action: 'combine-ideas',
        engineSummary: `Synthesized ${req.targetCards.length} selected ideas into a unified narrative beat.`,
        directions: [],
        ideas: [
          {
            title: `Synthesized Arc: ${titles.slice(0, 60)}`,
            summary: `Weaves together the selected threads (${titles}) around ${primaryAnchor}: ${summaries.slice(0, 260)}`,
            rationale: `Unifies ${req.targetCards.length} complementary concepts so they reinforce a single dramatic turn rather than competing for focus.`,
            epistemicStatus: 'concrete-patch',
            assumptions: [`Combines ${req.targetCards.length} author-selected cards.`],
            possibleConsequences: [
              `Consolidates scene momentum and reduces redundant exposition.`,
            ],
            craftNote: `Use a single shared physical detail to bridge the combined threads seamlessly.`,
            proposedProse: `${req.targetCards.map((c) => c.summary).join('\n\n')}`,
          },
        ],
        questions: [],
      });
    }

    case 'explain-differently': {
      const target = req.targetCards[0];
      return CreativeStudioActionResponseSchema.parse({
        action: 'explain-differently',
        engineSummary: `Reframed "${target?.title || 'Concept'}" in clear structural terms.`,
        directions: [],
        ideas: [],
        questions: [],
        alternativeExplanation: `Plain-Language Structural Framing: Think of "${target?.title || 'this beat'}" as a cause-and-effect lever in ${primaryAnchor}. First, the reader sees the familiar surface of ${secondaryAnchor}; second, ${activeDirectionLabels} introduces friction; third, the character must act before certainty is possible.`,
        craftNote: `When a beat feels abstract, translate the emotional shift into one concrete object or spatial boundary in the scene.`,
      });
    }

    case 'challenge-idea': {
      const target = req.targetCards[0];
      return CreativeStudioActionResponseSchema.parse({
        action: 'challenge-idea',
        engineSummary: `Stress-tested "${target?.title || 'Concept'}" against established canon and dramatic risk.`,
        directions: [],
        ideas: [],
        questions: [],
        challengeCritique: `Constructive Stress-Test of "${target?.title || 'this idea'}":\n1. Canon Friction Check: Verify that escalating ${primaryAnchor} now does not prematurely resolve the tension surrounding ${secondaryAnchor}.\n2. Agency Check: Ensure the turn happens because of an active character choice rather than convenient coincidence.\n3. Counter-Option: What if the character tries to conceal the truth here and fails by only one detail?`,
        craftNote: `A strong idea survives when its opposite is also plausible inside the scene.`,
      });
    }

    case 'ask-questions': {
      const modeLabel =
        req.interviewMode === 'grill'
          ? 'Grill Me (Continuity & Motive Stress-Test)'
          : req.interviewMode === 'challenge'
            ? 'Challenge Me (Assumption Breaker)'
            : req.interviewMode === 'inspire'
              ? 'Inspire Me (Imaginative Spark)'
              : 'Explore with Me (Collaborative Discovery)';

      const priorCount = req.answeredQuestions.length;
      const knownNote =
        req.knownCanonFacts.length > 0
          ? `Respecting ${req.knownCanonFacts.length} established canon facts (${req.knownCanonFacts[0].slice(0, 72)}).`
          : 'Starting from open seed scope.';

      return CreativeStudioActionResponseSchema.parse({
        action: 'ask-questions',
        engineSummary: `${modeLabel} — Round ${priorCount + 1} generated (${knownNote})`,
        directions: [],
        ideas: [],
        questions: [
          {
            question:
              req.interviewMode === 'grill'
                ? `In ${primaryAnchor}, what concrete price is the focal character unwilling to pay if ${secondaryAnchor} is exposed right now?`
                : req.interviewMode === 'challenge'
                  ? `What if the core assumption behind ${primaryAnchor} is slightly wrong—who benefits most from that misdirection?`
                  : req.interviewMode === 'inspire'
                    ? `What unexpected sensory detail or half-remembered promise in ${primaryAnchor} could transform the emotional tone of this moment?`
                    : `How should the shift in ${primaryAnchor} alter the balance of trust around ${secondaryAnchor}?`,
            rationale: `${modeLabel}: Probes an unstated dependency in ${primaryAnchor} without re-asking established canon facts.`,
            recommendedAnswer: `Anchor the turn in a personal obligation tied to ${secondaryAnchor} that forces an immediate, imperfect decision.`,
            recommendedWhy: `Keeps agency with the character while deepening continuity with ${primaryAnchor}.`,
            options: [
              `Anchor the turn in a personal obligation tied to ${secondaryAnchor}`,
              `Reveal a partial truth that protects an ally but creates new suspicion`,
              `Use an environmental or physical constraint in ${primaryAnchor} to force action`,
              `Deliberately withhold the answer in-scene as a slow-burn mystery`,
            ],
          },
        ],
      });
    }

    case 'preview-concept': {
      return CreativeStudioActionResponseSchema.parse({
        action: 'preview-concept',
        engineSummary: `Synthesized live non-canonical Concept Preview for ${primaryAnchor}.`,
        directions: [],
        ideas: [],
        questions: [],
        conceptPreview: {
          title: `Concept Synthesis: ${primaryAnchor}`,
          summary: `Combines ${activeDirectionLabels} with ${req.answeredQuestions.length} interview decisions around ${primaryAnchor} and ${secondaryAnchor}.`,
          possibleConnections: [
            `Direct continuity link to ${primaryAnchor}`,
            `Character pressure point on ${secondaryAnchor}`,
          ],
          unresolvedQuestions: [
            `How much of the consequence should be visible immediately versus delayed to the next chapter?`,
          ],
          craftNote: `Keep the concept non-canonical until you stage the exact prose or model operations in Unified Proposal Review (E3).`,
        },
      });
    }

    case 'story-qa': {
      const q = req.customInput.trim() || 'What is established in the current scope?';
      const cited = topBlocks.map((b) => b.sourceId);
      const excerpts = topBlocks
        .map((b) => `• [${b.label}]: "${b.excerpt.slice(0, 140)}"`)
        .join('\n');
      return CreativeStudioActionResponseSchema.parse({
        action: 'story-qa',
        engineSummary: `Answered story question using ${topBlocks.length} E1 local memory blocks.`,
        directions: [],
        ideas: [],
        questions: [],
        qaResult: {
          answer:
            topBlocks.length > 0
              ? `Based on the indexed project canon for "${q}":\n${excerpts}\n\nKnown Canon Facts (${req.knownCanonFacts.length}): ${req.knownCanonFacts.slice(0, 3).join(' | ') || 'None explicitly constrained.'}`
              : `No canonical passage in the local E1 index directly settles "${q}" yet—this is currently an open narrative gap ready for exploration in Creative Studio.`,
          citedSourceIds: cited,
          openGaps: [
            `The long-term fallout of "${q.slice(0, 56)}" on ${secondaryAnchor} remains open for author decision.`,
          ],
          suggestedStudioDirection: `Explore how "${q.slice(0, 48)}" can be dramatized inside ${primaryAnchor}.`,
        },
      });
    }

    case 'discover':
    case 'prepare-patch':
    default: {
      return CreativeStudioActionResponseSchema.parse({
        action: req.action,
        engineSummary: `Discovered 2 concrete E1-grounded idea cards and 2 directions for ${primaryAnchor}.`,
        directions: [
          {
            label: `Sharpen conflict inside ${primaryAnchor}`,
            description: `Use ${activeDirectionLabels} to create immediate dramatic friction.`,
            category: 'Scene Dynamics',
          },
          {
            label: `Echo ${secondaryAnchor} through subtext`,
            description: `Let unspoken history shape the dialogue rhythm.`,
            category: 'Subtext & Voice',
          },
        ],
        ideas: [
          {
            title: `${intensityPrefix} Beat: Turning Point in ${primaryAnchor}`,
            summary: `Bring ${activeDirectionLabels} to a head inside ${primaryAnchor}, forcing a visible shift in how ${secondaryAnchor} is understood.`,
            rationale: `Grounded in ${topBlocks.length} retrieved E1 memory blocks (${primaryAnchor}).`,
            epistemicStatus: 'hypothesis',
            assumptions: [`Preserves active project and session locks.`],
            possibleConsequences: [
              `Deepens continuity between ${primaryAnchor} and ${secondaryAnchor}.`,
            ],
            craftNote: `Anchor the emotional shift in a concrete sensory detail from ${primaryAnchor}.`,
            proposedProse: `Inside ${primaryAnchor}, the weight of ${secondaryAnchor} could no longer be sidestepped. Every word now carried the edge of an irreversible choice.`,
          },
          {
            title: `Subtextual Counter-Beat: Quiet Revelation around ${secondaryAnchor}`,
            summary: `Approach ${primaryAnchor} through restraint—reveal the pressure of ${secondaryAnchor} via what the characters refuse to acknowledge aloud.`,
            rationale: `Offers a tonal contrast (${req.compassSummary || 'literary restraint'}) on the same canonical foundation.`,
            epistemicStatus: 'inspiration',
            assumptions: [`Maintains current scene chronology.`],
            possibleConsequences: [
              `Plants a lingering question that can pay off in a subsequent scene.`,
            ],
            craftNote: `Use pacing and pause to let the reader infer the hidden motive before it is named.`,
            proposedProse: `Nothing was stated outright, yet the pause that followed in ${primaryAnchor} made the truth about ${secondaryAnchor} unmistakable.`,
          },
        ],
        questions: [],
      });
    }
  }
}

/**
 * Executes a Creative Studio action via the server AI endpoint when `useServerAi` is true,
 * or via grounded local E1 synthesis when `useServerAi` is false.
 */
export async function executeGroundedCreativeAction(
  project: CreativeProject,
  session: CreativeSession,
  action: CreativeAiActionKind,
  options: {
    customInput?: string;
    targetCards?: CreativeIdeaCard[];
    language?: 'en' | 'tr';
    useServerAi?: boolean;
    memoryIndex?: NarrativeMemoryIndexSnapshot | null;
  } = {}
): Promise<{
  response: CreativeStudioActionResponse;
  contextPacket: CreativeSessionContextPacket;
  usedLocalSynthesis: boolean;
}> {
  const { payload, contextPacket } = buildCreativeActionPayload(
    project,
    session,
    action,
    options
  );

  if (options.useServerAi) {
    try {
      const response = await requestCreativeStudioAction(payload);
      return {
        response,
        contextPacket,
        usedLocalSynthesis: false,
      };
    } catch {
      const fallback = synthesizeGroundedCreativeActionResponse(payload);
      return {
        response: fallback,
        contextPacket,
        usedLocalSynthesis: true,
      };
    }
  }

  const localResponse = synthesizeGroundedCreativeActionResponse(payload);
  return {
    response: localResponse,
    contextPacket,
    usedLocalSynthesis: true,
  };
}
