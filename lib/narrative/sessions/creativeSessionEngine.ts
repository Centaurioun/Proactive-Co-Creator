import { CreativeProject, EntityCategory } from '../../../shared/types';
import { ManuscriptSection } from '../../../shared/narrativeTypes';
import {
  CreativeConceptPreview,
  CreativeDirectionOption,
  CreativeDraftSketch,
  CreativeIdeaCard,
  CreativeIdeaCardStatus,
  CreativeIdeaPatchBlueprint,
  CreativeIdeaSourceRef,
  CreativeIdeaVersion,
  CreativeIntensityLevel,
  CreativeSession,
  CreativeSessionScope,
  CreativeSessionStatus,
  CreativeStudioMode,
  GuidedQuestionAnswerStatus,
  GuidedQuestionItem,
  InterviewBehavioralMode,
  ReadingMarginNote,
  creativeIdeaCardSchema,
  creativeSessionSchema,
  readingMarginNoteSchema,
} from '../../../shared/creativeSessionTypes';
import {
  CreativeLock,
  UnifiedManuscriptHunk,
  UnifiedModelOperation,
  UnifiedProposal,
} from '../../../shared/unifiedProposalTypes';
import {
  computeProjectBaseSnapshotDigest,
  createUnifiedProposalEnvelope,
} from '../proposals/unifiedProposalEngine';
import { manuscriptSections } from '../manuscriptModel';
import { computeDeterministicDigest } from '../memory/textNormalization';
import { getOrBuildNarrativeMemoryIndexSync } from '../memory/indexRepository';
import {
  assembleOperationContext,
  ContextInspectorReport,
} from '../context/contextAssembler';
import { NarrativeMemoryIndexSnapshot } from '../../../shared/narrativeMemoryTypes';

export interface CreativeSessionContextPacket {
  report: ContextInspectorReport;
  includedItems: Array<{
    chunkId: string;
    sourceId: string;
    label: string;
    category: string;
    textExcerpt: string;
  }>;
}

/**
 * PCC-EV-WP03 — Engine E2: Persistent CreativeSession & Idea Lifecycle Engine.
 *
 * Pure, deterministic state transitions for:
 * - Creating and resuming persistent CreativeSessions (`B2`)
 * - Managing CreativeDirectionOptions (`Suggest More Directions` appends without clearing,
 *   custom direction vs generate idea, Surprise Me) (`B3`)
 * - Managing CreativeIdeaCards & version lineage (Per-card Regenerate preserving siblings,
 *   Develop Further creating linked version/child, Combine Selected, Save for Later / Bookmark,
 *   recoverable Dismiss / Restore, Edit Idea vs Preview Patch) (`B3`)
 * - Voluntary Adaptive Interview / Grill Me (4 modes, E1 local index grounding so known facts
 *   are not re-asked, answer recording, skip/open mystery, backtracking with branch retention
 *   that marks dependent items outdated rather than deleting them, live non-canonical draft sketch,
 *   Stop & Preview Concept, Session Brief / Handoff markdown) (`B4`)
 * - Bridging any Idea Card or Concept Preview into a typed Engine E3 `UnifiedProposal` draft (`B6`)
 * - Preserving canonical story revision & baseSnapshotDigest when persisting session metadata (`B2`).
 */

function makeId(prefix: string): string {
  const rand = Math.random().toString(36).slice(2, 9);
  return `${prefix}-${Date.now().toString(36)}-${rand}`;
}

export function getActiveManuscriptSections(project: CreativeProject): ManuscriptSection[] {
  return manuscriptSections(project);
}

export function getActiveIdeaVersion(card: CreativeIdeaCard): CreativeIdeaVersion {
  return (
    card.versions.find((v) => v.versionId === card.activeVersionId) ??
    card.versions[card.versions.length - 1]
  );
}

/**
 * Builds an E1 ContextInspectorReport-backed packet for a CreativeSession scope without invoking any AI call.
 */
export function buildCreativeSessionContextPacket(
  project: CreativeProject,
  scope: CreativeSessionScope,
  queryOverride?: string,
  _operationName = 'creative-studio',
  existingIndex?: NarrativeMemoryIndexSnapshot | null
): { packet: CreativeSessionContextPacket; index: NarrativeMemoryIndexSnapshot } {
  const index = getOrBuildNarrativeMemoryIndexSync(project, {
    previousIndex: existingIndex ?? null,
  });
  const sections = getActiveManuscriptSections(project);
  const focalSectionId =
    scope.passage?.sectionId ??
    scope.sectionIds[0] ??
    sections[0]?.id;

  const queryParts: string[] = [];
  if (queryOverride && queryOverride.trim()) {
    queryParts.push(queryOverride.trim());
  }
  if (scope.seedPrompt.trim()) {
    queryParts.push(scope.seedPrompt.trim());
  }
  if (scope.passage?.selectedText.trim()) {
    queryParts.push(scope.passage.selectedText.trim().slice(0, 240));
  }
  for (const entityId of scope.entityIds) {
    const entity = (project.snapshot.entities ?? []).find(
      (e) => e.id === entityId || e.name === entityId
    );
    if (entity) queryParts.push(entity.name);
  }
  const query = queryParts.join(' ') || project.name || 'story canon';

  const report = assembleOperationContext(project, {
    operationIntent: 'batch-edit',
    activeSectionId: focalSectionId,
    scope: scope.sectionIds.length > 0 ? 'scene' : 'full',
    changedSectionIds: scope.sectionIds,
    queryHint: query,
    tokenBudget: 2800,
    indexSnapshot: index,
  });

  const includedItems = report.items
    .filter((item) => item.disposition !== 'omitted')
    .map((item) => ({
      chunkId: item.id,
      sourceId: item.sectionId || item.id,
      label: item.label.trim() || item.sectionId || item.id,
      category: item.kind,
      textExcerpt: item.excerpt,
    }));

  return {
    packet: {
      report,
      includedItems,
    },
    index,
  };
}

/**
 * Extracts known canonical facts for the active scope so Grill Me / Guided Exploration
 * never wastes rounds asking for facts already established in the project (`CE-09.5`, `B4`).
 */
export function extractKnownCanonFactsForScope(
  project: CreativeProject,
  scope: CreativeSessionScope
): string[] {
  const facts: string[] = [];
  const sections = getActiveManuscriptSections(project);
  const allEntities = (project.snapshot.entities ?? []).filter((e) => !e.excluded);

  const relevantEntities =
    scope.entityIds.length > 0
      ? allEntities.filter(
          (e) =>
            (e.id && scope.entityIds.includes(e.id)) ||
            scope.entityIds.includes(e.name)
        )
      : allEntities.slice(0, 6);

  for (const entity of relevantEntities) {
    const cat = entity.category || 'character';
    const desc = (entity.description || '').trim();
    const attrs = (entity.attributes ?? [])
      .map((a) => `${a.name}: ${a.confirmedValue ?? a.value?.[0]?.name ?? ''}`)
      .filter((s) => !s.endsWith(': '))
      .slice(0, 3)
      .join(', ');
    if (desc || attrs) {
      facts.push(
        `[Canon ${cat}] ${entity.name}: ${[desc.slice(0, 120), attrs].filter(Boolean).join(' | ')}`
      );
    } else {
      facts.push(`[Canon ${cat}] ${entity.name} is an established ${cat}.`);
    }
  }

  const allRels = project.snapshot.relationships ?? [];
  const relevantRels =
    scope.relationshipIds.length > 0
      ? allRels.filter((r) => r.id && scope.relationshipIds.includes(r.id))
      : allRels
          .filter(
            (r) =>
              scope.entityIds.length === 0 ||
              scope.entityIds.includes(r.source) ||
              scope.entityIds.includes(r.target) ||
              (r.sourceId && scope.entityIds.includes(r.sourceId)) ||
              (r.targetId && scope.entityIds.includes(r.targetId))
          )
          .slice(0, 4);

  for (const rel of relevantRels) {
    facts.push(`[Canon Relationship] ${rel.source} -> ${rel.target} (${rel.label})`);
  }

  const targetSectionIds =
    scope.passage?.sectionId
      ? [scope.passage.sectionId]
      : scope.sectionIds.length > 0
        ? scope.sectionIds
        : sections.slice(0, 2).map((s) => s.id);

  for (const secId of targetSectionIds) {
    const sec = sections.find((s) => s.id === secId);
    if (sec && sec.text.trim()) {
      const snippet = sec.text.trim().replace(/\s+/g, ' ').slice(0, 180);
      facts.push(
        `[Canon Scene "${sec.title.trim() || 'Untitled Scene'}"] ${snippet}`
      );
    }
  }

  return facts;
}

export interface CreateCreativeSessionOptions {
  title?: string;
  mode?: CreativeStudioMode;
  interviewMode?: InterviewBehavioralMode;
  scope?: Partial<CreativeSessionScope>;
  goal?: string;
  customInstruction?: string;
  intensity?: CreativeIntensityLevel;
  compassSummary?: string;
  preservationConstraints?: string[];
  initialDirections?: CreativeDirectionOption[];
}

export function createCreativeSession(
  project: CreativeProject,
  options: CreateCreativeSessionOptions = {}
): CreativeSession {
  const now = new Date().toISOString();
  const baseSnapshotDigest = computeProjectBaseSnapshotDigest(project);
  const branchId = makeId('branch');
  const sections = getActiveManuscriptSections(project);

  const scopeKind = options.scope?.kind ?? (sections.length === 0 ? 'seed' : 'project');
  const scope: CreativeSessionScope = {
    kind: scopeKind,
    seedPrompt: options.scope?.seedPrompt ?? '',
    sectionIds: options.scope?.sectionIds ?? (sections[0] ? [sections[0].id] : []),
    entityIds: options.scope?.entityIds ?? [],
    relationshipIds: options.scope?.relationshipIds ?? [],
    eventIds: options.scope?.eventIds ?? [],
    passage: options.scope?.passage,
    focusSummary:
      options.scope?.focusSummary ??
      buildScopeFocusSummary(project, {
        kind: scopeKind,
        seedPrompt: options.scope?.seedPrompt ?? '',
        sectionIds: options.scope?.sectionIds ?? (sections[0] ? [sections[0].id] : []),
        entityIds: options.scope?.entityIds ?? [],
        relationshipIds: options.scope?.relationshipIds ?? [],
        eventIds: options.scope?.eventIds ?? [],
        passage: options.scope?.passage,
        focusSummary: '',
      }),
  };

  const defaultDirections: CreativeDirectionOption[] =
    options.initialDirections ?? buildDefaultDirectionsForScope(project, scope, now);

  const defaultSketch = buildInitialDraftSketchFromCanon(project, scope);

  const session: CreativeSession = {
    id: makeId('csession'),
    projectId: project.id,
    title:
      options.title?.trim() ||
      `${formatModeTitle(options.mode ?? 'discover')}: ${scope.focusSummary.slice(0, 48)}`,
    mode: options.mode ?? 'discover',
    interviewMode: options.interviewMode ?? 'explore',
    status: 'active',
    baseRevision: project.revision ?? 1,
    baseSnapshotDigest,
    scope,
    goal: options.goal ?? '',
    customInstruction: options.customInstruction ?? '',
    intensity: options.intensity ?? 'balanced',
    compassSummary:
      options.compassSummary ??
      'Preserve established character voice and timeline continuity while sharpening dramatic tension.',
    preservationConstraints: options.preservationConstraints ?? [
      'Respect active Creative Locks',
      'Keep established character voice consistent',
    ],
    sessionLocks: [],
    activeBranchId: branchId,
    branches: [
      {
        id: branchId,
        label: 'Main Exploration Branch',
        createdAt: now,
      },
    ],
    directions: defaultDirections,
    ideaCardIds: [],
    questions: [],
    draftSketch: defaultSketch,
    stagedProposalIds: [],
    createdAt: now,
    updatedAt: now,
  };

  return creativeSessionSchema.parse(session);
}

function formatModeTitle(mode: CreativeStudioMode): string {
  switch (mode) {
    case 'discover':
      return 'Discover';
    case 'guided':
      return 'Guided Exploration';
    case 'focused':
      return 'Focused Development';
    case 'story-lab':
      return 'Story Lab';
  }
}

export function buildScopeFocusSummary(
  project: CreativeProject,
  scope: CreativeSessionScope
): string {
  if (scope.passage && scope.passage.selectedText.trim()) {
    return `Passage in "${scope.passage.sectionTitle || 'Scene'}" (${scope.passage.selectedText.trim().slice(0, 36)}...)`;
  }
  const parts: string[] = [];
  const sections = getActiveManuscriptSections(project);
  if (scope.sectionIds.length > 0) {
    const names = scope.sectionIds
      .map((id) => {
        const idx = sections.findIndex((s) => s.id === id);
        const sec = idx >= 0 ? sections[idx] : undefined;
        return sec ? sec.title.trim() || `Scene ${idx + 1}` : undefined;
      })
      .filter(Boolean);
    if (names.length > 0) parts.push(`Scene: ${names.join(', ')}`);
  }
  if (scope.entityIds.length > 0) {
    const entities = project.snapshot.entities ?? [];
    const names = scope.entityIds
      .map((id) => entities.find((e) => e.id === id || e.name === id)?.name)
      .filter(Boolean);
    if (names.length > 0) parts.push(`Entities: ${names.join(', ')}`);
  }
  if (scope.seedPrompt.trim()) {
    parts.push(`Seed: "${scope.seedPrompt.trim().slice(0, 40)}"`);
  }
  return parts.join(' · ') || project.name || 'Whole Project Canon';
}

function buildDefaultDirectionsForScope(
  project: CreativeProject,
  scope: CreativeSessionScope,
  now: string
): CreativeDirectionOption[] {
  const entities = (project.snapshot.entities ?? []).filter((e) => !e.excluded);
  const firstEntity =
    entities.find((e) => (e.id && scope.entityIds.includes(e.id)) || scope.entityIds.includes(e.name)) ??
    entities[0];
  const sections = getActiveManuscriptSections(project);
  const firstSection =
    sections.find((s) => scope.sectionIds.includes(s.id)) ?? sections[0];

  return [
    {
      id: makeId('dir'),
      label: firstEntity
        ? `Escalate ${firstEntity.name}'s internal conflict & hidden cost`
        : 'Escalate protagonist internal conflict & hidden cost',
      description:
        'Force an immediate choice where protecting a core relationship compromises a personal secret.',
      category: 'Character & Agency',
      selected: true,
      origin: 'ai-suggested',
      createdAt: now,
    },
    {
      id: makeId('dir'),
      label: firstSection
        ? `Subvert expectations in "${firstSection.title.trim() || 'the active scene'}"`
        : 'Introduce an unexpected atmospheric reversal',
      description:
        'Turn a seemingly safe setting detail into an active obstacle or revelation anchor.',
      category: 'Scene & Atmosphere',
      selected: false,
      origin: 'ai-suggested',
      createdAt: now,
    },
    {
      id: makeId('dir'),
      label: 'Tighten causal link to overarching mystery',
      description:
        'Plant a concrete physical clue or contradictory testimony that pays off later.',
      category: 'Plot & Continuity',
      selected: false,
      origin: 'ai-suggested',
      createdAt: now,
    },
  ];
}

function buildInitialDraftSketchFromCanon(
  project: CreativeProject,
  scope: CreativeSessionScope
): CreativeDraftSketch {
  const nodes: CreativeDraftSketch['nodes'] = [];
  const edges: CreativeDraftSketch['edges'] = [];

  const allEntities = (project.snapshot.entities ?? []).filter((e) => !e.excluded);
  const entities =
    scope.entityIds.length > 0
      ? allEntities.filter(
          (e) =>
            (e.id && scope.entityIds.includes(e.id)) ||
            scope.entityIds.includes(e.name)
        )
      : allEntities.slice(0, 3);

  for (const entity of entities) {
    const entId = entity.id || entity.name;
    nodes.push({
      id: `sketch-canon-${entId}`,
      label: entity.name,
      kind: entity.category === 'location' ? 'location' : 'character',
      epistemicLabel: 'known-canon',
      detail: (entity.description || `Established ${entity.category || 'character'}`).slice(0, 120),
    });
  }

  if (nodes.length >= 2) {
    edges.push({
      id: `sketch-edge-${nodes[0].id}-${nodes[1].id}`,
      fromNodeId: nodes[0].id,
      toNodeId: nodes[1].id,
      relationLabel: 'canonical tension',
      epistemicLabel: 'known-canon',
    });
  }

  return { nodes, edges };
}

/**
 * Toggles selection of a direction option inside a CreativeSession.
 */
export function toggleCreativeDirection(
  session: CreativeSession,
  directionId: string
): CreativeSession {
  const now = new Date().toISOString();
  return creativeSessionSchema.parse({
    ...session,
    directions: session.directions.map((d) =>
      d.id === directionId ? { ...d, selected: !d.selected } : d
    ),
    updatedAt: now,
  });
}

/**
 * Appends new suggested directions without clearing or overwriting existing directions
 * or their current selection states (`CE-01`, `B3`: Suggest More Directions).
 */
export function appendSuggestedDirections(
  session: CreativeSession,
  newDirections: Array<{
    label: string;
    description?: string;
    category?: string;
    selected?: boolean;
    origin?: 'ai-suggested' | 'user-custom' | 'surprise-me';
  }>
): CreativeSession {
  const now = new Date().toISOString();
  const existingLabels = new Set(
    session.directions.map((d) => d.label.trim().toLowerCase())
  );
  const appended: CreativeDirectionOption[] = [];

  for (const item of newDirections) {
    const cleanLabel = item.label.trim();
    if (!cleanLabel) continue;
    if (existingLabels.has(cleanLabel.toLowerCase())) continue;
    existingLabels.add(cleanLabel.toLowerCase());
    appended.push({
      id: makeId('dir'),
      label: cleanLabel,
      description: item.description?.trim() ?? '',
      category: item.category?.trim() || 'Creative Direction',
      selected: item.selected ?? false,
      origin: item.origin ?? 'ai-suggested',
      createdAt: now,
    });
  }

  return creativeSessionSchema.parse({
    ...session,
    directions: [...session.directions, ...appended],
    updatedAt: now,
  });
}

/**
 * Creates a new `CreativeIdeaCard` linked to the session and active branch (`B3`).
 */
export function createCreativeIdeaCard(
  project: CreativeProject,
  session: CreativeSession,
  input: {
    title: string;
    summary: string;
    rationale?: string;
    directionIds?: string[];
    epistemicStatus?: CreativeIdeaVersion['epistemicStatus'];
    sourceRefs?: CreativeIdeaSourceRef[];
    assumptions?: string[];
    possibleConsequences?: string[];
    craftNote?: string;
    patchBlueprint?: CreativeIdeaPatchBlueprint;
    parentIdeaId?: string;
    combinedFromIdeaIds?: string[];
    tags?: string[];
  }
): { session: CreativeSession; card: CreativeIdeaCard } {
  const now = new Date().toISOString();
  const versionId = makeId('ideav');
  const cardId = makeId('idea');
  const sections = getActiveManuscriptSections(project);
  const defaultSection =
    sections.find((s) => session.scope.sectionIds.includes(s.id)) ?? sections[0];

  const version: CreativeIdeaVersion = {
    versionId,
    versionNumber: 1,
    title: input.title.trim() || 'Untitled Creative Idea',
    summary: input.summary.trim() || 'Exploratory narrative direction.',
    rationale:
      input.rationale?.trim() ||
      'Grounded in active scope and selected creative directions.',
    directionIds:
      input.directionIds ??
      session.directions.filter((d) => d.selected).map((d) => d.id),
    epistemicStatus: input.epistemicStatus ?? 'hypothesis',
    sourceRefs:
      input.sourceRefs ??
      (defaultSection
        ? [
            {
              sourceId: defaultSection.id,
              sourceKind: 'manuscript-section',
              label: defaultSection.title.trim() || 'Untitled Scene',
              excerpt: defaultSection.text.slice(0, 140),
              sectionDigest: computeDeterministicDigest(defaultSection.text),
            },
          ]
        : []),
    assumptions: input.assumptions ?? [],
    possibleConsequences: input.possibleConsequences ?? [],
    craftNote: input.craftNote,
    patchBlueprint:
      input.patchBlueprint ??
      (defaultSection
        ? {
            targetSectionId: defaultSection.id,
            targetSectionTitle: defaultSection.title.trim() || 'Untitled Scene',
            proposedProse: input.summary.trim(),
            operationMode: 'append-section',
          }
        : {
            proposedProse: input.summary.trim(),
            operationMode: 'world-note',
          }),
    isOutdated: false,
    createdAt: now,
  };

  const card: CreativeIdeaCard = creativeIdeaCardSchema.parse({
    id: cardId,
    projectId: project.id,
    sessionId: session.id,
    branchId: session.activeBranchId,
    activeVersionId: versionId,
    versions: [version],
    parentIdeaId: input.parentIdeaId,
    combinedFromIdeaIds: input.combinedFromIdeaIds ?? [],
    status: 'draft',
    tags: input.tags ?? [],
    notes: '',
    baseRevision: project.revision ?? 1,
    baseSnapshotDigest: computeProjectBaseSnapshotDigest(project),
    createdAt: now,
    updatedAt: now,
  });

  const updatedSession = creativeSessionSchema.parse({
    ...session,
    ideaCardIds: [...session.ideaCardIds, card.id],
    updatedAt: now,
  });

  return { session: updatedSession, card };
}

/**
 * Per-Card Regenerate (`CE-01`, `B3`):
 * Replaces the active version of ONLY the target card by appending a new version
 * to `card.versions[]` and setting `activeVersionId` to the new version, preserving
 * prior versions for comparison (`v1 -> v2`) and leaving all sibling cards untouched.
 */
export function regenerateSingleIdeaCard(
  cards: CreativeIdeaCard[],
  targetCardId: string,
  regenerated: {
    title: string;
    summary: string;
    rationale?: string;
    directionIds?: string[];
    epistemicStatus?: CreativeIdeaVersion['epistemicStatus'];
    sourceRefs?: CreativeIdeaSourceRef[];
    assumptions?: string[];
    possibleConsequences?: string[];
    craftNote?: string;
    patchBlueprint?: CreativeIdeaPatchBlueprint;
  }
): CreativeIdeaCard[] {
  const now = new Date().toISOString();
  return cards.map((card) => {
    if (card.id !== targetCardId) return card;
    const prevVersion = getActiveIdeaVersion(card);
    const nextVersionNumber =
      Math.max(...card.versions.map((v) => v.versionNumber), 0) + 1;
    const newVersionId = makeId('ideav');

    const newVersion: CreativeIdeaVersion = {
      versionId: newVersionId,
      versionNumber: nextVersionNumber,
      title: regenerated.title.trim() || prevVersion.title,
      summary: regenerated.summary.trim() || prevVersion.summary,
      rationale: regenerated.rationale?.trim() ?? prevVersion.rationale,
      directionIds: regenerated.directionIds ?? prevVersion.directionIds,
      epistemicStatus: regenerated.epistemicStatus ?? prevVersion.epistemicStatus,
      sourceRefs: regenerated.sourceRefs ?? prevVersion.sourceRefs,
      assumptions: regenerated.assumptions ?? prevVersion.assumptions,
      possibleConsequences:
        regenerated.possibleConsequences ?? prevVersion.possibleConsequences,
      craftNote: regenerated.craftNote ?? prevVersion.craftNote,
      patchBlueprint: regenerated.patchBlueprint ?? prevVersion.patchBlueprint,
      isOutdated: false,
      createdAt: now,
    };

    return creativeIdeaCardSchema.parse({
      ...card,
      activeVersionId: newVersionId,
      versions: [...card.versions, newVersion],
      updatedAt: now,
    });
  });
}

/**
 * Develop Further (`CE-01`, `CE-02`, `B3`):
 * Evolves an idea card by adding a linked new version (`vN+1`) on the card
 * while preserving the core concept and recording the refinement directions.
 */
export function developIdeaCardFurther(
  card: CreativeIdeaCard,
  refinement: {
    title: string;
    summary: string;
    rationale?: string;
    addedDirectionIds?: string[];
    customDirectionNote?: string;
    patchBlueprint?: CreativeIdeaPatchBlueprint;
    craftNote?: string;
    possibleConsequences?: string[];
  }
): CreativeIdeaCard {
  const now = new Date().toISOString();
  const activeVersion = getActiveIdeaVersion(card);
  const nextVersionNumber =
    Math.max(...card.versions.map((v) => v.versionNumber), 0) + 1;
  const newVersionId = makeId('ideav');

  const combinedDirections = Array.from(
    new Set([
      ...activeVersion.directionIds,
      ...(refinement.addedDirectionIds ?? []),
    ])
  );

  const newVersion: CreativeIdeaVersion = {
    versionId: newVersionId,
    versionNumber: nextVersionNumber,
    title: refinement.title.trim() || `${activeVersion.title} (Developed)`,
    summary: refinement.summary.trim(),
    rationale:
      refinement.rationale?.trim() ||
      (refinement.customDirectionNote
        ? `Developed further with direction: ${refinement.customDirectionNote}`
        : activeVersion.rationale),
    directionIds: combinedDirections,
    epistemicStatus: activeVersion.epistemicStatus,
    sourceRefs: activeVersion.sourceRefs,
    assumptions: activeVersion.assumptions,
    possibleConsequences:
      refinement.possibleConsequences ?? activeVersion.possibleConsequences,
    craftNote: refinement.craftNote ?? activeVersion.craftNote,
    patchBlueprint:
      refinement.patchBlueprint ??
      (activeVersion.patchBlueprint
        ? {
            ...activeVersion.patchBlueprint,
            proposedProse: refinement.summary.trim(),
          }
        : undefined),
    isOutdated: false,
    createdAt: now,
  };

  return creativeIdeaCardSchema.parse({
    ...card,
    activeVersionId: newVersionId,
    versions: [...card.versions, newVersion],
    updatedAt: now,
  });
}

/**
 * Manual Edit Idea (`B3`):
 * Edits the idea's conceptual title/summary/rationale/tags/notes (distinct from editing
 * concrete E3 patch hunks) and optionally records it as a clean new version so lineage is preserved.
 */
export function updateCreativeIdeaCardContent(
  card: CreativeIdeaCard,
  updates: {
    title?: string;
    summary?: string;
    rationale?: string;
    proposedProse?: string;
    tags?: string[];
    notes?: string;
    createNewVersion?: boolean;
  }
): CreativeIdeaCard {
  const now = new Date().toISOString();
  const active = getActiveIdeaVersion(card);

  if (updates.createNewVersion) {
    const nextVersionNumber =
      Math.max(...card.versions.map((v) => v.versionNumber), 0) + 1;
    const newVersionId = makeId('ideav');
    const newVersion: CreativeIdeaVersion = {
      ...active,
      versionId: newVersionId,
      versionNumber: nextVersionNumber,
      title: updates.title?.trim() ?? active.title,
      summary: updates.summary?.trim() ?? active.summary,
      rationale: updates.rationale?.trim() ?? active.rationale,
      patchBlueprint: active.patchBlueprint
        ? {
            ...active.patchBlueprint,
            proposedProse:
              updates.proposedProse ??
              updates.summary?.trim() ??
              active.patchBlueprint.proposedProse,
          }
        : undefined,
      createdAt: now,
    };

    return creativeIdeaCardSchema.parse({
      ...card,
      activeVersionId: newVersionId,
      versions: [...card.versions, newVersion],
      tags: updates.tags ?? card.tags,
      notes: updates.notes ?? card.notes,
      updatedAt: now,
    });
  }

  const updatedVersions = card.versions.map((v) =>
    v.versionId === card.activeVersionId
      ? {
          ...v,
          title: updates.title?.trim() ?? v.title,
          summary: updates.summary?.trim() ?? v.summary,
          rationale: updates.rationale?.trim() ?? v.rationale,
          patchBlueprint: v.patchBlueprint
            ? {
                ...v.patchBlueprint,
                proposedProse:
                  updates.proposedProse ??
                  updates.summary?.trim() ??
                  v.patchBlueprint.proposedProse,
              }
            : undefined,
        }
      : v
  );

  return creativeIdeaCardSchema.parse({
    ...card,
    versions: updatedVersions,
    tags: updates.tags ?? card.tags,
    notes: updates.notes ?? card.notes,
    updatedAt: now,
  });
}

/**
 * Selects a specific historical version on an idea card (`Compare Versions`).
 */
export function selectIdeaCardVersion(
  card: CreativeIdeaCard,
  versionId: string
): CreativeIdeaCard {
  if (!card.versions.some((v) => v.versionId === versionId)) {
    return card;
  }
  return creativeIdeaCardSchema.parse({
    ...card,
    activeVersionId: versionId,
    updatedAt: new Date().toISOString(),
  });
}

/**
 * Save for Later / Bookmark or Promote to Creative Collection (`IR-03`, `B3`).
 */
export function setIdeaCardStatus(
  card: CreativeIdeaCard,
  nextStatus: CreativeIdeaCardStatus
): CreativeIdeaCard {
  const now = new Date().toISOString();
  const previousStatusBeforeDismiss =
    nextStatus === 'dismissed'
      ? card.status !== 'dismissed'
        ? card.status
        : card.previousStatusBeforeDismiss ?? 'draft'
      : card.previousStatusBeforeDismiss;

  return creativeIdeaCardSchema.parse({
    ...card,
    status: nextStatus,
    previousStatusBeforeDismiss,
    updatedAt: now,
  });
}

/**
 * Restores a dismissed or archived idea card to its previous working status (`B3`).
 */
export function restoreDismissedIdeaCard(card: CreativeIdeaCard): CreativeIdeaCard {
  const restoredStatus: CreativeIdeaCardStatus =
    card.previousStatusBeforeDismiss &&
    card.previousStatusBeforeDismiss !== 'dismissed'
      ? card.previousStatusBeforeDismiss
      : 'draft';

  return creativeIdeaCardSchema.parse({
    ...card,
    status: restoredStatus,
    updatedAt: new Date().toISOString(),
  });
}

/**
 * Attaches an Explain Differently framing (`CE-09.3`) or Challenge critique (`CE-07`)
 * to the active version of an idea card.
 */
export function attachIdeaReflection(
  card: CreativeIdeaCard,
  reflection: {
    alternativeExplanation?: string;
    challengeCritique?: string;
    craftNote?: string;
  }
): CreativeIdeaCard {
  const now = new Date().toISOString();
  return creativeIdeaCardSchema.parse({
    ...card,
    versions: card.versions.map((v) =>
      v.versionId === card.activeVersionId
        ? {
            ...v,
            alternativeExplanation:
              reflection.alternativeExplanation ?? v.alternativeExplanation,
            challengeCritique:
              reflection.challengeCritique ?? v.challengeCritique,
            craftNote: reflection.craftNote ?? v.craftNote,
          }
        : v
    ),
    updatedAt: now,
  });
}

/**
 * Combines 2+ selected idea cards into a synthesized composite idea card (`GS-04`, `B3`),
 * preserving the original cards and recording `combinedFromIdeaIds` lineage.
 */
export function combineCreativeIdeaCards(
  project: CreativeProject,
  session: CreativeSession,
  selectedCards: CreativeIdeaCard[],
  synthesized?: {
    title?: string;
    summary?: string;
    rationale?: string;
    proposedProse?: string;
  }
): { session: CreativeSession; combinedCard: CreativeIdeaCard } {
  const activeVersions = selectedCards.map(getActiveIdeaVersion);
  const mergedDirectionIds = Array.from(
    new Set(activeVersions.flatMap((v) => v.directionIds))
  );
  const mergedSources = activeVersions.flatMap((v) => v.sourceRefs).slice(0, 6);
  const mergedTags = Array.from(
    new Set(selectedCards.flatMap((c) => c.tags).concat(['combined']))
  );

  const defaultTitle =
    synthesized?.title?.trim() ||
    `Combined: ${activeVersions.map((v) => v.title).join(' + ').slice(0, 72)}`;
  const defaultSummary =
    synthesized?.summary?.trim() ||
    activeVersions.map((v) => v.summary).join('\n\n');
  const defaultRationale =
    synthesized?.rationale?.trim() ||
    `Synthesized from ${selectedCards.length} selected ideas (${activeVersions.map((v) => v.title).join(', ')}).`;

  const firstBlueprint = activeVersions.find((v) => v.patchBlueprint)?.patchBlueprint;

  const { session: updatedSession, card: combinedCard } = createCreativeIdeaCard(
    project,
    session,
    {
      title: defaultTitle,
      summary: defaultSummary,
      rationale: defaultRationale,
      directionIds: mergedDirectionIds,
      sourceRefs: mergedSources,
      combinedFromIdeaIds: selectedCards.map((c) => c.id),
      tags: mergedTags,
      patchBlueprint: firstBlueprint
        ? {
            ...firstBlueprint,
            proposedProse: synthesized?.proposedProse?.trim() || defaultSummary,
          }
        : undefined,
    }
  );

  return { session: updatedSession, combinedCard };
}

/**
 * Adds a round of adaptive interview questions (`Grill Me` / `Guided Exploration`, `B4`).
 * Ensures `knownFactsUsed` is recorded so the author can see what canon facts were respected.
 */
export function appendGuidedQuestions(
  session: CreativeSession,
  project: CreativeProject,
  questionsInput: Array<{
    question: string;
    rationale?: string;
    recommendedAnswer?: string;
    recommendedWhy?: string;
    options?: string[];
    allowMultiple?: boolean;
    mode?: InterviewBehavioralMode;
  }>
): CreativeSession {
  const now = new Date().toISOString();
  const activeBranchQuestions = session.questions.filter(
    (q) => q.branchId === session.activeBranchId && !q.isOutdated
  );
  const nextRound =
    activeBranchQuestions.length > 0
      ? Math.max(...activeBranchQuestions.map((q) => q.roundNumber)) + 1
      : 1;
  const knownFacts = extractKnownCanonFactsForScope(project, session.scope);

  const created: GuidedQuestionItem[] = questionsInput.map((item, idx) => ({
    id: makeId('gquestion'),
    roundNumber: nextRound + idx,
    mode: item.mode ?? session.interviewMode,
    question: item.question.trim(),
    rationale:
      item.rationale?.trim() ||
      'Resolves an open structural dependency in the active scope.',
    recommendedAnswer:
      item.recommendedAnswer?.trim() ||
      item.options?.[0] ||
      'Anchor the choice in the protagonist’s primary flaw.',
    recommendedWhy:
      item.recommendedWhy?.trim() ||
      'Strengthens causal continuity with established canon.',
    options:
      item.options && item.options.length > 0
        ? item.options
        : [
            'Tie directly to an existing character secret',
            'Escalate immediate scene stakes through an external obstacle',
            'Keep ambiguous for now as a slow-burn mystery',
          ],
    allowMultiple: item.allowMultiple ?? true,
    knownFactsUsed: knownFacts.slice(0, 4),
    answerStatus: 'unanswered',
    selectedOptions: [],
    customAnswer: '',
    branchId: session.activeBranchId,
    isOutdated: false,
  }));

  return creativeSessionSchema.parse({
    ...session,
    questions: [...session.questions, ...created],
    updatedAt: now,
  });
}

/**
 * Records or edits an answer to a Guided Exploration / Grill Me question (`B2`, `B4`).
 *
 * CRITICAL BRANCH RETENTION RULE (`CE-08`, `B2`, `B4`):
 * When the author edits an earlier question that already has subsequent answered/generated
 * questions or idea cards depending on it, we DO NOT delete those subsequent items.
 * Instead:
 * - We create a new branch record and mark subsequent questions and idea versions in the
 *   previous sequence `isOutdated: true` so the author retains full branch history.
 * - Updates the live non-canonical draft sketch (`draftSketch`) and `conceptPreview` immediately.
 */
export function answerGuidedQuestion(
  session: CreativeSession,
  cards: CreativeIdeaCard[],
  questionId: string,
  answer: {
    answerStatus: GuidedQuestionAnswerStatus;
    selectedOptions?: string[];
    customAnswer?: string;
    useRecommended?: boolean;
  }
): { session: CreativeSession; cards: CreativeIdeaCard[]; forkedBranchId?: string } {
  const now = new Date().toISOString();
  const targetQuestion = session.questions.find((q) => q.id === questionId);
  if (!targetQuestion) {
    return { session, cards };
  }

  const wasAlreadyAnswered = targetQuestion.answerStatus !== 'unanswered';
  const hasLaterQuestions = session.questions.some(
    (q) =>
      q.branchId === targetQuestion.branchId &&
      !q.isOutdated &&
      q.roundNumber > targetQuestion.roundNumber
  );

  let nextBranchId = session.activeBranchId;
  let branches = session.branches;
  let forkedBranchId: string | undefined;

  if (wasAlreadyAnswered && hasLaterQuestions) {
    forkedBranchId = makeId('branch');
    nextBranchId = forkedBranchId;
    branches = [
      ...session.branches,
      {
        id: forkedBranchId,
        label: `Revised Q${targetQuestion.roundNumber} Branch (${new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })})`,
        parentBranchId: targetQuestion.branchId,
        forkedFromQuestionId: targetQuestion.id,
        createdAt: now,
      },
    ];
  }

  const resolvedSelected = answer.useRecommended
    ? [targetQuestion.recommendedAnswer]
    : answer.selectedOptions ?? [];
  const resolvedCustom = answer.customAnswer?.trim() ?? '';

  const updatedQuestions = session.questions.map((q) => {
    if (q.id === questionId) {
      return {
        ...q,
        answerStatus: answer.answerStatus,
        selectedOptions: resolvedSelected,
        customAnswer: resolvedCustom,
        answeredAt: now,
        branchId: nextBranchId,
        isOutdated: false,
      };
    }
    if (
      wasAlreadyAnswered &&
      hasLaterQuestions &&
      q.roundNumber > targetQuestion.roundNumber &&
      !q.isOutdated
    ) {
      return {
        ...q,
        isOutdated: true,
      };
    }
    return q;
  });

  const updatedCards =
    wasAlreadyAnswered && hasLaterQuestions
      ? cards.map((c) => {
          if (c.sessionId !== session.id) return c;
          return creativeIdeaCardSchema.parse({
            ...c,
            versions: c.versions.map((v) => ({ ...v, isOutdated: true })),
            updatedAt: now,
          });
        })
      : cards;

  const updatedSketch = updateDraftSketchFromQuestions(
    session.draftSketch,
    updatedQuestions
  );
  const updatedConcept = synthesizeConceptPreviewFromSession(
    session,
    updatedQuestions
  );

  const nextSession = creativeSessionSchema.parse({
    ...session,
    activeBranchId: nextBranchId,
    branches,
    questions: updatedQuestions,
    draftSketch: updatedSketch,
    conceptPreview: updatedConcept,
    updatedAt: now,
  });

  return {
    session: nextSession,
    cards: updatedCards,
    forkedBranchId,
  };
}

function updateDraftSketchFromQuestions(
  currentSketch: CreativeDraftSketch,
  questions: GuidedQuestionItem[]
): CreativeDraftSketch {
  const canonNodes = currentSketch.nodes.filter(
    (n) => n.epistemicLabel === 'known-canon'
  );
  const canonEdges = currentSketch.edges.filter(
    (e) => e.epistemicLabel === 'known-canon'
  );

  const dynamicNodes: CreativeDraftSketch['nodes'] = [];
  const dynamicEdges: CreativeDraftSketch['edges'] = [];

  for (const q of questions.filter((item) => !item.isOutdated)) {
    const nodeId = `sketch-q-${q.id}`;
    if (q.answerStatus === 'answered') {
      const answerSummary = [
        ...q.selectedOptions,
        q.customAnswer,
      ]
        .filter(Boolean)
        .join(' · ');
      dynamicNodes.push({
        id: nodeId,
        label: `Q${q.roundNumber}: ${answerSummary.slice(0, 44) || 'Author Decision'}`,
        kind: 'conflict',
        epistemicLabel: 'author-chosen',
        detail: `Question: ${q.question}\nDecision: ${answerSummary}`,
        sourceQuestionId: q.id,
      });
    } else if (
      q.answerStatus === 'skipped' ||
      q.answerStatus === 'deferred-mystery'
    ) {
      dynamicNodes.push({
        id: nodeId,
        label: `Open Mystery (Q${q.roundNumber})`,
        kind: 'mystery',
        epistemicLabel: 'open-mystery',
        detail: q.question,
        sourceQuestionId: q.id,
      });
    } else {
      dynamicNodes.push({
        id: nodeId,
        label: `Hypothesis: ${q.recommendedAnswer.slice(0, 38)}`,
        kind: 'theme',
        epistemicLabel: 'hypothesized',
        detail: q.question,
        sourceQuestionId: q.id,
      });
    }

    const anchorTarget = canonNodes[0]?.id ?? dynamicNodes[0]?.id;
    if (anchorTarget && anchorTarget !== nodeId) {
      dynamicEdges.push({
        id: `sketch-edge-${anchorTarget}-${nodeId}`,
        fromNodeId: anchorTarget,
        toNodeId: nodeId,
        relationLabel:
          q.answerStatus === 'answered'
            ? 'shapes'
            : q.answerStatus === 'deferred-mystery'
              ? 'unresolved mystery'
              : 'explores',
        epistemicLabel:
          q.answerStatus === 'answered'
            ? 'author-chosen'
            : q.answerStatus === 'deferred-mystery'
              ? 'open-mystery'
              : 'hypothesized',
      });
    }
  }

  return {
    nodes: [...canonNodes, ...dynamicNodes],
    edges: [...canonEdges, ...dynamicEdges],
  };
}

/**
 * Stop & Preview Concept (`CE-08`, `B4`):
 * Synthesizes a structured non-canonical Concept Preview from whatever questions
 * and directions have been answered/selected so far, even if 0 or 1 question was answered.
 */
export function synthesizeConceptPreviewFromSession(
  session: CreativeSession,
  questionsOverride?: GuidedQuestionItem[]
): CreativeConceptPreview {
  const now = new Date().toISOString();
  const questions = (questionsOverride ?? session.questions).filter(
    (q) => !q.isOutdated
  );
  const answered = questions.filter((q) => q.answerStatus === 'answered');
  const mysteries = questions.filter(
    (q) =>
      q.answerStatus === 'skipped' ||
      q.answerStatus === 'deferred-mystery' ||
      q.answerStatus === 'unanswered'
  );
  const selectedDirections = session.directions.filter((d) => d.selected);

  const summaryParts: string[] = [];
  if (session.goal.trim()) {
    summaryParts.push(`Goal: ${session.goal.trim()}`);
  }
  if (selectedDirections.length > 0) {
    summaryParts.push(
      `Active Directions: ${selectedDirections.map((d) => d.label).join('; ')}.`
    );
  }
  for (const q of answered) {
    const ans = [...q.selectedOptions, q.customAnswer].filter(Boolean).join('; ');
    if (ans) {
      summaryParts.push(`Round ${q.roundNumber} Decision: ${ans}.`);
    }
  }
  if (summaryParts.length === 0) {
    summaryParts.push(
      `Exploratory concept anchored on ${session.scope.focusSummary}. Ready to test directions or convert directly into an E3 proposal draft.`
    );
  }

  return {
    title: `${session.title} — Concept Preview`,
    summary: summaryParts.join(' '),
    possibleConnections: [
      `Anchored to ${session.scope.focusSummary}`,
      ...selectedDirections.map((d) => `${d.category}: ${d.label}`),
    ],
    unresolvedQuestions: mysteries.map((m) => m.question),
    craftNote:
      answered.length > 0
        ? 'Focus scene beats on the causal consequence of the author-chosen answers while leaving deferred mysteries off-stage.'
        : 'Select one high-friction direction or answer a single round to sharpen dramatic specificity.',
    updatedAt: now,
  };
}

/**
 * Generates a structured Markdown Creative Session Brief / Handoff (`CE-09.1`, `B4`)
 * summarizing scope, canonical facts used, selected directions, answered interview rounds,
 * open mysteries, and active idea cards.
 */
export function buildCreativeSessionBriefMarkdown(
  project: CreativeProject,
  session: CreativeSession,
  sessionCards: CreativeIdeaCard[]
): string {
  const knownFacts = extractKnownCanonFactsForScope(project, session.scope);
  const selectedDirs = session.directions.filter((d) => d.selected);
  const activeQuestions = session.questions.filter((q) => !q.isOutdated);
  const visibleCards = sessionCards.filter(
    (c) => c.sessionId === session.id && c.status !== 'dismissed'
  );

  const lines: string[] = [
    `# Creative Session Brief: ${session.title}`,
    ``,
    `- **Project:** ${project.name} (Base Revision #${session.baseRevision})`,
    `- **Studio Mode:** ${session.mode} (Interview Lens: ${session.interviewMode})`,
    `- **Scope:** ${session.scope.focusSummary}`,
    `- **Intensity & Compass:** ${session.intensity.toUpperCase()} — ${session.compassSummary}`,
    ``,
    `## 1. Established Canon Grounding (E1 Index)`,
    ...(knownFacts.length > 0
      ? knownFacts.map((f) => `- ${f}`)
      : [`- Seed exploration (no constraining canon facts in scope).`]),
    ``,
    `## 2. Selected Creative Directions`,
    ...(selectedDirs.length > 0
      ? selectedDirs.map((d) => `- **[${d.category}] ${d.label}** — ${d.description}`)
      : [`- No specific direction locked yet.`]),
    ``,
    `## 3. Adaptive Interview Decisions & Open Mysteries`,
    ...(activeQuestions.length > 0
      ? activeQuestions.map((q) => {
          const ans = [...q.selectedOptions, q.customAnswer]
            .filter(Boolean)
            .join('; ');
          return `- **Q${q.roundNumber} (${q.answerStatus.toUpperCase()}):** ${q.question}\n  - *Decision:* ${ans || 'Left open / deferred mystery'}`;
        })
      : [`- No interview rounds recorded.`]),
    ``,
    `## 4. Concrete Idea Cards & Version Lineage`,
    ...(visibleCards.length > 0
      ? visibleCards.map((c) => {
          const v = getActiveIdeaVersion(c);
          return `- **${v.title}** (v${v.versionNumber} · ${c.status} · ${v.epistemicStatus})\n  - ${v.summary}\n  - *Rationale:* ${v.rationale}`;
        })
      : [`- No idea cards generated yet.`]),
  ];

  return lines.join('\n');
}

/**
 * Converts a CreativeIdeaCard directly into a typed Engine E3 `UnifiedProposal` draft (`CE-04`, `B3`, `B6`).
 *
 * No redundant `Accept -> Send to Change Review` ceremony: the author clicks
 * `Preview & Apply in E3` on any card (or multi-select toolbar) and enters the
 * Unified Proposal Review Modal directly with full provenance and session locks.
 */
export function buildUnifiedProposalFromIdeaCard(
  project: CreativeProject,
  session: CreativeSession,
  card: CreativeIdeaCard
): UnifiedProposal {
  const version = getActiveIdeaVersion(card);
  const sections = getActiveManuscriptSections(project);
  const targetSectionId =
    version.patchBlueprint?.targetSectionId ??
    session.scope.passage?.sectionId ??
    session.scope.sectionIds[0] ??
    sections[0]?.id;
  const targetSection = sections.find((s) => s.id === targetSectionId);

  const provenance = {
    sessionId: session.id,
    branchId: card.branchId,
    ideaId: card.id,
    ideaVersionId: version.versionId,
    sourceAnchorIds: version.sourceRefs.map((r) => r.sourceId),
  };

  const speculativeImpacts = (version.possibleConsequences ?? []).map(
    (item, idx) => ({
      id: `impact-${card.id}-${idx}`,
      targetLabel: session.scope.focusSummary.slice(0, 240),
      targetKind: 'continuity' as const,
      summary: item.slice(0, 1000),
      epistemicKind: 'speculative-ripple' as const,
    })
  );

  if (
    version.patchBlueprint?.operationMode === 'create-entity' ||
    version.patchBlueprint?.operationMode === 'update-entity' ||
    (!targetSection && version.patchBlueprint?.entityName)
  ) {
    const existingEntity = (project.snapshot.entities ?? []).find(
      (e) =>
        e.name.toLowerCase() ===
        (version.patchBlueprint?.entityName ?? version.title).toLowerCase()
    );
    const entityName =
      version.patchBlueprint?.entityName ??
      existingEntity?.name ??
      version.title;
    const rawCat = (
      version.patchBlueprint?.entityType ??
      existingEntity?.category ??
      'character'
    ).toLowerCase();
    const validCats = new Set<EntityCategory>([
      'character',
      'location',
      'object',
      'event',
      'group',
      'scene',
    ]);
    const entityCategory: EntityCategory = validCats.has(rawCat as EntityCategory)
      ? (rawCat as EntityCategory)
      : 'character';

    const modelOp: UnifiedModelOperation = {
      id: `mop_idea_${card.id}_v${version.versionNumber}`,
      targetType: 'entity',
      action: existingEntity ? 'update' : 'create',
      targetId: existingEntity?.id ?? entityName,
      targetLabel: entityName.slice(0, 240),
      entityCategory,
      beforeValue: existingEntity?.description ?? '',
      afterValue:
        (version.patchBlueprint?.entitySummary ?? version.summary).slice(0, 50000),
      rationale: (version.rationale || version.summary).slice(0, 2000),
      dependencyIds: [],
    };

    return createUnifiedProposalEnvelope({
      project,
      originOperation: 'creative-session',
      title: `Studio Idea: ${version.title} (v${version.versionNumber})`.slice(0, 320),
      rationale: (version.rationale || version.summary).slice(0, 4000),
      manuscriptHunks: [],
      modelOperations: [modelOp],
      provenance,
      speculativeImpacts,
    });
  }

  if (targetSection) {
    const isPassageReplace =
      Boolean(session.scope.passage) &&
      session.scope.passage!.sectionId === targetSection.id &&
      session.scope.passage!.endOffset > session.scope.passage!.startOffset &&
      targetSection.text.slice(
        session.scope.passage!.startOffset,
        session.scope.passage!.endOffset
      ) === session.scope.passage!.selectedText;

    const startOffset = isPassageReplace
      ? session.scope.passage!.startOffset
      : targetSection.text.length;
    const endOffset = isPassageReplace
      ? session.scope.passage!.endOffset
      : targetSection.text.length;
    const expectedText = isPassageReplace
      ? session.scope.passage!.selectedText
      : '';
    const proposedProse =
      version.patchBlueprint?.proposedProse?.trim() || version.summary;
    const formattedProposedText =
      !isPassageReplace &&
      targetSection.text.length > 0 &&
      !targetSection.text.endsWith('\n')
        ? `\n\n${proposedProse}`
        : proposedProse;

    const hunk: UnifiedManuscriptHunk = {
      id: `hunk_idea_${card.id}_v${version.versionNumber}`,
      sectionId: targetSection.id,
      sectionTitle: (targetSection.title || 'Scene').slice(0, 240),
      operation: isPassageReplace ? 'replace' : 'insert',
      startOffset,
      endOffset,
      expectedText,
      replacementText: formattedProposedText,
      rationale: (version.rationale || version.summary).slice(0, 2000),
      dependencyIds: [],
    };

    return createUnifiedProposalEnvelope({
      project,
      originOperation: 'creative-session',
      title: `Studio Idea: ${version.title} (v${version.versionNumber})`.slice(0, 320),
      rationale: (version.rationale || version.summary).slice(0, 4000),
      manuscriptHunks: [hunk],
      modelOperations: [],
      provenance,
      speculativeImpacts,
    });
  }

  // Fallback when project has 0 sections: create a Story Bible centralConflict or themes update
  const currentConflict = project.snapshot.storyBible?.centralConflict?.value ?? '';
  const nextConflict = [currentConflict, version.summary].filter(Boolean).join('\n\n');
  const modelOp: UnifiedModelOperation = {
    id: `mop_idea_${card.id}_v${version.versionNumber}`,
    targetType: 'story_bible',
    action: 'update',
    targetId: 'centralConflict',
    targetLabel: 'Story Bible: centralConflict',
    field: 'centralConflict',
    beforeValue: currentConflict,
    afterValue: nextConflict,
    rationale: (version.rationale || version.summary).slice(0, 2000),
    dependencyIds: [],
  };

  return createUnifiedProposalEnvelope({
    project,
    originOperation: 'creative-session',
    title: `Studio Seed Concept: ${version.title}`.slice(0, 320),
    rationale: (version.rationale || version.summary).slice(0, 4000),
    manuscriptHunks: [],
    modelOperations: [modelOp],
    provenance,
    speculativeImpacts,
  });
}

/**
 * Builds an aggregate multi-target E3 `UnifiedProposal` from multiple selected
 * idea cards (`GS-04`, `B3`, `B6`).
 */
export function buildAggregateUnifiedProposalFromCards(
  project: CreativeProject,
  session: CreativeSession,
  selectedCards: CreativeIdeaCard[]
): UnifiedProposal {
  const individualProposals = selectedCards.map((c) =>
    buildUnifiedProposalFromIdeaCard(project, session, c)
  );
  const allHunks = individualProposals.flatMap((p) => p.manuscriptHunks);
  const allModelOps = individualProposals.flatMap((p) => p.modelOperations);

  // Merge hunks that insert/replace at the exact same section and offset range so they don't overlap
  const deduplicatedHunks: UnifiedManuscriptHunk[] = [];
  for (const h of allHunks) {
    const existing = deduplicatedHunks.find(
      (item) =>
        item.sectionId === h.sectionId &&
        item.startOffset === h.startOffset &&
        item.endOffset === h.endOffset
    );
    if (existing) {
      existing.replacementText = `${existing.replacementText}\n\n${h.replacementText.trim()}`;
      existing.rationale = `${existing.rationale} | ${h.rationale}`.slice(0, 2000);
    } else {
      deduplicatedHunks.push({ ...h });
    }
  }

  return createUnifiedProposalEnvelope({
    project,
    originOperation: 'creative-session',
    title: `Studio Batch (${selectedCards.length} Selected Ideas)`.slice(0, 320),
    rationale: `Combined proposal from session "${session.title}".`,
    manuscriptHunks: deduplicatedHunks,
    modelOperations: allModelOps,
    provenance: {
      sessionId: session.id,
      branchId: session.activeBranchId,
      ideaId: selectedCards[0]?.id,
      ideaVersionId: selectedCards[0]
        ? getActiveIdeaVersion(selectedCards[0]).versionId
        : undefined,
      sourceAnchorIds: selectedCards.map((c) => c.id),
    },
    speculativeImpacts: individualProposals.flatMap((p) => p.speculativeImpacts),
  });
}

/**
 * Adds a session-scoped Creative Lock (`scope: 'session'`, `B6`).
 */
export function addSessionCreativeLock(
  session: CreativeSession,
  lockInput: {
    targetKind: CreativeLock['targetKind'];
    targetId?: string;
    targetLabel: string;
    hardness?: CreativeLock['hardness'];
    ruleText?: string;
  }
): CreativeSession {
  const now = Date.now();
  const lock: CreativeLock = {
    id: makeId('slock'),
    projectId: session.projectId,
    scope: 'session',
    sessionId: session.id,
    hardness: lockInput.hardness ?? 'hard-structural',
    targetKind: lockInput.targetKind,
    targetId: lockInput.targetId,
    targetLabel: lockInput.targetLabel.slice(0, 240),
    forbidMutation: true,
    ruleText: (lockInput.ruleText?.trim() || 'Session-scoped preservation lock').slice(0, 1000),
    active: true,
    version: 1,
    createdAt: now,
    updatedAt: now,
  };

  return creativeSessionSchema.parse({
    ...session,
    sessionLocks: [...session.sessionLocks, lock],
    updatedAt: new Date(now).toISOString(),
  });
}

export function removeSessionCreativeLock(
  session: CreativeSession,
  lockId: string
): CreativeSession {
  return creativeSessionSchema.parse({
    ...session,
    sessionLocks: session.sessionLocks.filter((l) => l.id !== lockId),
    updatedAt: new Date().toISOString(),
  });
}

/**
 * Updates a CreativeSession's lifecycle status (`active`, `paused`, `completed`, `archived`, `dismissed`).
 */
export function setCreativeSessionStatus(
  session: CreativeSession,
  status: CreativeSessionStatus
): CreativeSession {
  return creativeSessionSchema.parse({
    ...session,
    status,
    updatedAt: new Date().toISOString(),
  });
}

/**
 * Creates a persistent anchor-bound Reading Margin Note (`UIC-06`, `B7`).
 */
export function createReadingMarginNote(
  project: CreativeProject,
  input: {
    sectionId: string;
    sectionTitle: string;
    sectionContent: string;
    startOffset: number;
    endOffset: number;
    quotedExcerpt: string;
    noteText: string;
    linkedSessionId?: string;
  }
): ReadingMarginNote {
  const now = new Date().toISOString();
  return readingMarginNoteSchema.parse({
    id: makeId('mnote'),
    projectId: project.id,
    sectionId: input.sectionId,
    sectionTitle: input.sectionTitle,
    baseRevision: project.revision ?? 1,
    textDigest: computeDeterministicDigest(input.sectionContent),
    startOffset: Math.max(0, input.startOffset),
    endOffset: Math.max(input.startOffset, input.endOffset),
    quotedExcerpt: input.quotedExcerpt,
    noteText: input.noteText.trim(),
    status: 'open',
    linkedSessionId: input.linkedSessionId,
    createdAt: now,
    updatedAt: now,
  });
}

/**
 * Non-revision-bumping metadata save helper (`B2`):
 * Updates `project.narrative.creativeSessions`, `creativeIdeas`, `readingMarginNotes`,
 * and/or `unifiedProposals` WITHOUT incrementing `project.revision` or mutating
 * `project.snapshot` or canonical manuscript `versions`.
 *
 * Guarantees that `computeProjectBaseSnapshotDigest(project)` remains 100% invariant!
 */
export function applyCreativeWorkspaceMetadataToProject(
  project: CreativeProject,
  updates: {
    creativeSessions?: CreativeSession[];
    creativeIdeas?: CreativeIdeaCard[];
    readingMarginNotes?: ReadingMarginNote[];
    unifiedProposals?: UnifiedProposal[];
    creativeLocks?: CreativeLock[];
  }
): CreativeProject {
  const currentNarrative = project.narrative ?? {
    versions: [],
    sectionVersions: [],
    sources: [],
    claims: [],
    issues: [],
    audit: [],
  };

  return {
    ...project,
    narrative: {
      ...currentNarrative,
      ...(updates.creativeSessions !== undefined
        ? { creativeSessions: updates.creativeSessions }
        : {}),
      ...(updates.creativeIdeas !== undefined
        ? { creativeIdeas: updates.creativeIdeas }
        : {}),
      ...(updates.readingMarginNotes !== undefined
        ? { readingMarginNotes: updates.readingMarginNotes }
        : {}),
      ...(updates.unifiedProposals !== undefined
        ? { unifiedProposals: updates.unifiedProposals }
        : {}),
      ...(updates.creativeLocks !== undefined
        ? { creativeLocks: updates.creativeLocks }
        : {}),
    },
  };
}
