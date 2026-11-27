/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import {
  buildDecisionInboxFromSnapshot,
  createEmptyStoryBible,
  makeStableId,
  syncStoryBibleWithSceneEntity,
} from '../canonicalModel.ts';
import { inferEntityCategory } from '../beliefGraphUtils.ts';
import { computePromptDigest, synthesizeRefinedPrompt } from '../promptBuilder.ts';
import { validateNarrativeRecords } from '../narrative/evidenceRegistry.ts';
import { epistemicKindSchema } from '../../shared/narrativeSchemas.ts';
import type {
  ApprovalStatus,
  Attribute,
  CreativeProject,
  DecisionProvenance,
  Entity,
  GenerationMode,
  ProjectSnapshot,
  Relationship,
  StoryBible,
  StoryBibleFields,
} from '../../shared/types.ts';
import { CURRENT_SCHEMA_VERSION, NARRATIVE_SCHEMA_VERSION } from './constants.ts';

function isRecordSourceBacked(
  sourceBacked: unknown,
  provenance: unknown,
  hasImportedSourceEvidence: boolean
): boolean {
  return Boolean(
    sourceBacked === true ||
      provenance === 'imported' ||
      (hasImportedSourceEvidence && provenance === 'accepted-suggestion')
  );
}

function normalizeNameCandidates(rawList: unknown): Array<{ name: string }> {
  if (!Array.isArray(rawList)) return [];
  return rawList
    .map((alt) =>
      typeof alt === 'string'
        ? { name: alt }
        : alt && typeof alt === 'object' && typeof (alt as { name?: unknown }).name === 'string'
          ? { name: (alt as { name: string }).name }
          : { name: '' }
    )
    .filter((c) => Boolean(c.name));
}

function normalizeAttributeValues(rawVal: unknown): Array<{ name: string }> {
  if (!Array.isArray(rawVal)) return [{ name: 'Unknown' }];
  return rawVal.map((v) =>
    typeof v === 'string'
      ? { name: v }
      : v && typeof v === 'object' && typeof (v as { name?: unknown }).name === 'string'
        ? { name: (v as { name: string }).name }
        : { name: 'Unknown' }
  );
}

function resolveMigratedStatus(rawStatus: unknown, presenceInPrompt: unknown): ApprovalStatus {
  if (rawStatus === 'confirmed') return 'confirmed';
  if (rawStatus === 'rejected') return 'rejected';
  return presenceInPrompt ? 'confirmed' : 'pending';
}

function normalizeMigratedAttribute(a: Record<string, unknown>): Attribute {
  const vals = normalizeAttributeValues(a.value);
  return {
    id: typeof a.id === 'string' ? a.id : makeStableId('attr'),
    name: typeof a.name === 'string' ? a.name : 'property',
    presence_in_prompt: Boolean(a.presence_in_prompt),
    value: vals,
    confirmedValue:
      typeof a.confirmedValue === 'string'
        ? a.confirmedValue
        : a.presence_in_prompt
          ? vals[0]?.name
          : undefined,
    status: resolveMigratedStatus(a.status, a.presence_in_prompt),
    provenance:
      typeof a.provenance === 'string'
        ? (a.provenance as DecisionProvenance)
        : a.presence_in_prompt
          ? 'prompt-explicit'
          : 'ai-inferred',
    ...(typeof a.updatedAt === 'number' ? { updatedAt: a.updatedAt } : {}),
    ...(a.epistemicKind === undefined
      ? {}
      : { epistemicKind: epistemicKindSchema.parse(a.epistemicKind) }),
    ...(a.sourceBacked === true ? { sourceBacked: true } : {}),
  };
}

function normalizeSingleMigratedEntity(raw: Record<string, unknown>): Entity | null {
  if (typeof raw.name !== 'string' || !raw.name.trim()) return null;
  const rawName = raw.name.trim();
  const migratedName =
    rawName.toLowerCase() === 'the video' || rawName.toLowerCase() === 'video'
      ? 'The Story'
      : rawName;

  const rawAttrs = Array.isArray(raw.attributes) ? raw.attributes : [];
  const attributes = rawAttrs
    .filter((a): a is Record<string, unknown> => Boolean(a && typeof a === 'object'))
    .map(normalizeMigratedAttribute);

  const entity: Entity = {
    id: typeof raw.id === 'string' ? raw.id : makeStableId('ent'),
    name: migratedName,
    category: typeof raw.category === 'string' ? (raw.category as Entity['category']) : undefined,
    presence_in_prompt: Boolean(raw.presence_in_prompt),
    description: typeof raw.description === 'string' ? raw.description : '',
    alternatives: normalizeNameCandidates(raw.alternatives),
    attributes,
    status: raw.status === 'confirmed' || raw.status === 'rejected' ? raw.status : 'confirmed',
    provenance: typeof raw.provenance === 'string' ? (raw.provenance as DecisionProvenance) : 'imported',
    ...(typeof raw.groupId === 'string' && raw.groupId ? { groupId: raw.groupId } : {}),
    ...(raw.epistemicKind === undefined
      ? {}
      : { epistemicKind: epistemicKindSchema.parse(raw.epistemicKind) }),
    ...(raw.sourceBacked === true ? { sourceBacked: true } : {}),
    excluded: Boolean(raw.excluded),
    aliases: Array.isArray(raw.aliases)
      ? (raw.aliases as unknown[]).filter((s): s is string => typeof s === 'string')
      : [],
  };
  entity.category = inferEntityCategory(entity);
  return entity;
}

export function normalizeMigratedEntities(rawEntities: unknown[]): Entity[] {
  const results: Entity[] = [];
  for (const item of rawEntities) {
    if (!item || typeof item !== 'object') continue;
    const entity = normalizeSingleMigratedEntity(item as Record<string, unknown>);
    if (entity) results.push(entity);
  }
  return results;
}

function normalizeSingleMigratedRelationship(
  raw: Record<string, unknown>,
  entities: Entity[]
): Relationship | null {
  if (
    typeof raw.source !== 'string' ||
    typeof raw.target !== 'string' ||
    typeof raw.label !== 'string'
  ) {
    return null;
  }
  const srcLower = raw.source.toLowerCase();
  const tgtLower = raw.target.toLowerCase();
  const srcEnt = entities.find((e) => e.id === raw.sourceId || e.name.toLowerCase() === srcLower);
  const tgtEnt = entities.find((e) => e.id === raw.targetId || e.name.toLowerCase() === tgtLower);

  return {
    id: typeof raw.id === 'string' ? raw.id : makeStableId('rel'),
    sourceId: srcEnt?.id,
    targetId: tgtEnt?.id,
    source: srcEnt?.name ?? raw.source,
    target: tgtEnt?.name ?? raw.target,
    label: raw.label,
    alternatives: normalizeNameCandidates(raw.alternatives),
    status: raw.status === 'pending' || raw.status === 'rejected' ? raw.status : 'confirmed',
    provenance: typeof raw.provenance === 'string' ? (raw.provenance as DecisionProvenance) : 'imported',
    ...(typeof raw.presence_in_prompt === 'boolean'
      ? { presence_in_prompt: raw.presence_in_prompt }
      : {}),
    ...(typeof raw.evidenceExcerpt === 'string' ? { evidenceExcerpt: raw.evidenceExcerpt } : {}),
    ...(raw.epistemicKind === undefined
      ? {}
      : { epistemicKind: epistemicKindSchema.parse(raw.epistemicKind) }),
    ...(raw.sourceBacked === true ? { sourceBacked: true } : {}),
  };
}

export function normalizeMigratedRelationships(
  rawRelationships: unknown[],
  entities: Entity[]
): Relationship[] {
  const results: Relationship[] = [];
  for (const item of rawRelationships) {
    if (!item || typeof item !== 'object') continue;
    const rel = normalizeSingleMigratedRelationship(item as Record<string, unknown>, entities);
    if (rel) results.push(rel);
  }
  return results;
}

function normalizeStoryBibleEntries(
  rawStoryBible: unknown,
  hasImportedSourceEvidence: boolean,
  now: number
): StoryBible {
  const baseBible = createEmptyStoryBible(now);
  if (!rawStoryBible || typeof rawStoryBible !== 'object') {
    return baseBible;
  }
  const incomingBible = rawStoryBible as Record<string, unknown>;
  for (const key of Object.keys(baseBible) as Array<keyof StoryBibleFields>) {
    const entry = incomingBible[key];
    if (!entry || typeof entry !== 'object' || !('value' in entry)) continue;
    const typedEntry = entry as Record<string, unknown>;
    baseBible[key] = {
      value: typeof typedEntry.value === 'string' ? typedEntry.value : '',
      status:
        typedEntry.status === 'confirmed' || typedEntry.status === 'rejected'
          ? typedEntry.status
          : 'pending',
      provenance:
        typeof typedEntry.provenance === 'string'
          ? (typedEntry.provenance as DecisionProvenance)
          : 'imported',
      updatedAt: typeof typedEntry.updatedAt === 'number' ? typedEntry.updatedAt : now,
      ...(typedEntry.epistemicKind === undefined
        ? {}
        : { epistemicKind: epistemicKindSchema.parse(typedEntry.epistemicKind) }),
      ...(isRecordSourceBacked(
        typedEntry.sourceBacked,
        typedEntry.provenance,
        hasImportedSourceEvidence
      )
        ? { sourceBacked: true }
        : {}),
    };
  }
  return baseBible;
}

function applySourceBackedFlags(
  normalizedEntities: Entity[],
  normalizedRelationships: Relationship[],
  hasImportedSourceEvidence: boolean
): { entities: Entity[]; relationships: Relationship[] } {
  const entities = normalizedEntities.map((entity) => ({
    ...entity,
    ...(isRecordSourceBacked(entity.sourceBacked, entity.provenance, hasImportedSourceEvidence)
      ? { sourceBacked: true }
      : {}),
    attributes: entity.attributes.map((attribute) => ({
      ...attribute,
      ...(isRecordSourceBacked(
        attribute.sourceBacked,
        attribute.provenance,
        hasImportedSourceEvidence
      )
        ? { sourceBacked: true }
        : {}),
    })),
  }));

  const relationships = normalizedRelationships.map((relationship) => ({
    ...relationship,
    ...(isRecordSourceBacked(
      relationship.sourceBacked,
      relationship.provenance,
      hasImportedSourceEvidence
    )
      ? { sourceBacked: true }
      : {}),
  }));

  return { entities, relationships };
}

function migrateArtifacts(
  rawArtifacts: unknown,
  projectId: string,
  logicalRev: number,
  snapshot: ProjectSnapshot
): CreativeProject['artifacts'] {
  if (!Array.isArray(rawArtifacts)) return [];
  return (rawArtifacts as CreativeProject['artifacts'])
    .filter((a) => a && (a.mode === 'story' || a.mode === 'image'))
    .map((a) => {
      const digest = a.promptDigest ?? computePromptDigest(a.promptUsed ?? '', a.mode);
      return {
        ...a,
        projectId: a.projectId ?? projectId,
        sourceRevision: a.sourceRevision ?? logicalRev,
        promptDigest: digest,
        isOutdated: digest !== computePromptDigest(snapshot.refinedPrompt, a.mode),
      };
    });
}

function resolveSnapshotStringArray(val: unknown): string[] {
  return Array.isArray(val) ? (val as unknown[]).filter((q): q is string => typeof q === 'string') : [];
}

function resolveMigratedRevisions(
  rawRevisions: unknown,
  logicalRev: number,
  snapshot: ProjectSnapshot,
  now: number
): CreativeProject['revisions'] {
  if (Array.isArray(rawRevisions) && rawRevisions.length > 0) {
    return (rawRevisions as CreativeProject['revisions']).map((r, idx) => ({
      ...r,
      revisionNumber: r.revisionNumber ?? Math.max(1, logicalRev - idx),
    }));
  }
  return [
    {
      id: makeStableId('rev'),
      revisionNumber: logicalRev,
      timestamp: now,
      label: 'Imported Revision',
      summary: 'Migrated project state',
      changeCount: 0,
      snapshot: structuredClone(snapshot),
    },
  ];
}

function resolveMigratedUndoHistory(rawUndo: unknown): CreativeProject['undoHistory'] {
  if (
    rawUndo &&
    typeof rawUndo === 'object' &&
    Array.isArray((rawUndo as { past?: unknown }).past) &&
    Array.isArray((rawUndo as { future?: unknown }).future)
  ) {
    return rawUndo as CreativeProject['undoHistory'];
  }
  return undefined;
}

function migrateSnapshotPayload(
  obj: Record<string, unknown>,
  hasNarrative: boolean,
  now: number
): CreativeProject {
  const rawSnap = obj.snapshot as Record<string, unknown>;
  const safeMode: GenerationMode = String(rawSnap.mode ?? 'story') === 'image' ? 'image' : 'story';
  const narrativeObj = obj.narrative as { sources?: unknown } | undefined;
  const hasImportedSourceEvidence = Boolean(
    hasNarrative && narrativeObj && Array.isArray(narrativeObj.sources) && narrativeObj.sources.length > 0
  );

  const originalIdea =
    typeof rawSnap.originalIdea === 'string' && rawSnap.originalIdea.trim()
      ? rawSnap.originalIdea
      : typeof rawSnap.prompt === 'string'
        ? rawSnap.prompt
        : 'Untitled creative project';

  const normalizedEntities = normalizeMigratedEntities(
    Array.isArray(rawSnap.entities) ? rawSnap.entities : []
  );
  const normalizedRelationships = normalizeMigratedRelationships(
    Array.isArray(rawSnap.relationships) ? rawSnap.relationships : [],
    normalizedEntities
  );
  const { entities, relationships } = applySourceBackedFlags(
    normalizedEntities,
    normalizedRelationships,
    hasImportedSourceEvidence
  );

  let snapshot: ProjectSnapshot = {
    ...(hasNarrative ? { manuscriptVersionId: rawSnap.manuscriptVersionId as string | undefined } : {}),
    originalIdea,
    refinedPrompt: typeof rawSnap.refinedPrompt === 'string' ? rawSnap.refinedPrompt : '',
    freeformNotes: typeof rawSnap.freeformNotes === 'string' ? rawSnap.freeformNotes : '',
    mode: safeMode,
    entities,
    relationships,
    storyBible: normalizeStoryBibleEntries(rawSnap.storyBible, hasImportedSourceEvidence, now),
    clarifications: Array.isArray(rawSnap.clarifications)
      ? (rawSnap.clarifications as ProjectSnapshot['clarifications'])
      : [],
    decisions: Array.isArray(rawSnap.decisions)
      ? (rawSnap.decisions as ProjectSnapshot['decisions'])
      : [],
    answeredQuestions: resolveSnapshotStringArray(rawSnap.answeredQuestions),
    skippedQuestions: resolveSnapshotStringArray(rawSnap.skippedQuestions),
  };

  snapshot = syncStoryBibleWithSceneEntity(snapshot);
  const decisionProjectionTime =
    typeof obj.updatedAt === 'number' && Number.isFinite(obj.updatedAt)
      ? obj.updatedAt
      : typeof obj.createdAt === 'number' && Number.isFinite(obj.createdAt)
        ? obj.createdAt
        : now;
  snapshot.decisions = buildDecisionInboxFromSnapshot(snapshot, decisionProjectionTime);
  if (!snapshot.refinedPrompt.trim()) {
    snapshot.refinedPrompt = synthesizeRefinedPrompt(snapshot);
  }

  const projectId = typeof obj.id === 'string' && obj.id ? obj.id : makeStableId('proj');
  const logicalRev =
    typeof obj.revision === 'number' && obj.revision >= 1
      ? obj.revision
      : Array.isArray(obj.revisions) && obj.revisions.length > 0
        ? obj.revisions.length
        : 1;
  const persistedRev =
    typeof obj.persistedRevision === 'number' && obj.persistedRevision >= 1
      ? obj.persistedRevision
      : logicalRev;

  const project: CreativeProject = {
    schemaVersion: hasNarrative ? NARRATIVE_SCHEMA_VERSION : CURRENT_SCHEMA_VERSION,
    ...(hasNarrative ? { narrative: obj.narrative as CreativeProject['narrative'] } : {}),
    id: projectId,
    name:
      typeof obj.name === 'string' && obj.name.trim()
        ? obj.name.trim()
        : originalIdea.slice(0, 48),
    createdAt: typeof obj.createdAt === 'number' ? obj.createdAt : now,
    updatedAt: typeof obj.updatedAt === 'number' ? obj.updatedAt : now,
    revision: logicalRev,
    persistedRevision: persistedRev,
    snapshot,
    artifacts: migrateArtifacts(obj.artifacts, projectId, logicalRev, snapshot),
    revisions: resolveMigratedRevisions(obj.revisions, logicalRev, snapshot, now),
    undoHistory: resolveMigratedUndoHistory(obj.undoHistory),
    ...(Array.isArray(obj.recentIntentIds)
      ? {
          recentIntentIds: (obj.recentIntentIds as unknown[])
            .filter((id): id is string => typeof id === 'string' && id.trim().length > 0)
            .slice(-50),
        }
      : {}),
  };
  if (hasNarrative) validateNarrativeRecords(project);
  return project;
}

function buildLegacyArtifacts(
  obj: Record<string, unknown>,
  projectId: string,
  snapshot: ProjectSnapshot,
  now: number
): CreativeProject['artifacts'] {
  const artifacts: CreativeProject['artifacts'] = [];
  if (typeof obj.story === 'string' && obj.story.trim()) {
    artifacts.push({
      id: makeStableId('art_story'),
      projectId,
      mode: 'story',
      createdAt: now,
      revisionId: 'rev_migrated',
      sourceRevision: 1,
      promptUsed: snapshot.refinedPrompt,
      promptDigest: computePromptDigest(snapshot.refinedPrompt, 'story'),
      storyText: obj.story,
      isOutdated: false,
    });
  }
  if (Array.isArray(obj.images) && obj.images.length > 0) {
    artifacts.push({
      id: makeStableId('art_img'),
      projectId,
      mode: 'image',
      createdAt: now,
      revisionId: 'rev_migrated',
      sourceRevision: 1,
      promptUsed: snapshot.refinedPrompt,
      promptDigest: computePromptDigest(snapshot.refinedPrompt, 'image'),
      images: (obj.images as unknown[]).filter((i): i is string => typeof i === 'string'),
      isOutdated: false,
    });
  }
  return artifacts;
}

function extractLegacyPrompt(obj: Record<string, unknown>): string {
  if (typeof obj.prompt === 'string' && obj.prompt.trim()) return obj.prompt.trim();
  const beliefPrompt = (obj.beliefGraph as { prompt?: unknown } | undefined)?.prompt;
  return typeof beliefPrompt === 'string' ? beliefPrompt : '';
}

function migrateLegacyProjectPayload(
  obj: Record<string, unknown>,
  now: number
): CreativeProject {
  const legacyPrompt = extractLegacyPrompt(obj);
  if (!legacyPrompt && !Array.isArray(obj.entities) && !obj.beliefGraph) {
    throw new Error('Malformed project JSON: missing snapshot or legacy beliefGraph fields.');
  }

  const rawMode = String(obj.mode ?? 'story');
  const migratedMode: GenerationMode = rawMode === 'image' ? 'image' : 'story';
  const rawGraph =
    obj.beliefGraph && typeof obj.beliefGraph === 'object'
      ? (obj.beliefGraph as Record<string, unknown>)
      : obj;

  const entities = normalizeMigratedEntities(
    Array.isArray(rawGraph.entities) ? rawGraph.entities : []
  );
  const relationships = normalizeMigratedRelationships(
    Array.isArray(rawGraph.relationships) ? rawGraph.relationships : [],
    entities
  );

  let snapshot: ProjectSnapshot = {
    originalIdea: legacyPrompt || 'Migrated Creative Project',
    refinedPrompt: '',
    freeformNotes: '',
    mode: migratedMode,
    entities,
    relationships,
    storyBible: createEmptyStoryBible(now),
    clarifications: Array.isArray(obj.clarifications)
      ? (obj.clarifications as ProjectSnapshot['clarifications'])
      : [],
    decisions: [],
    answeredQuestions: resolveSnapshotStringArray(obj.answeredQuestions),
    skippedQuestions: resolveSnapshotStringArray(obj.skippedQuestions),
  };

  snapshot = syncStoryBibleWithSceneEntity(snapshot);
  snapshot.decisions = buildDecisionInboxFromSnapshot(snapshot);
  snapshot.refinedPrompt = synthesizeRefinedPrompt(snapshot);

  const projectId = typeof obj.id === 'string' ? obj.id : makeStableId('proj');
  const projectName =
    typeof obj.name === 'string' && obj.name.trim()
      ? obj.name.trim()
      : (legacyPrompt || 'Migrated Project').slice(0, 48);

  return {
    schemaVersion: CURRENT_SCHEMA_VERSION,
    id: projectId,
    name: projectName,
    createdAt: now,
    updatedAt: now,
    revision: 1,
    persistedRevision: 1,
    snapshot,
    artifacts: buildLegacyArtifacts(obj, projectId, snapshot, now),
    revisions: [
      {
        id: 'rev_migrated',
        revisionNumber: 1,
        timestamp: now,
        label: 'Migrated v1 Project',
        summary:
          rawMode === 'video'
            ? 'Migrated legacy video-mode project to Story mode, preserving all creative entities and outputs.'
            : 'Migrated legacy project state.',
        changeCount: 0,
        snapshot: structuredClone(snapshot),
      },
    ],
  };
}

/**
 * Migrates older v0/v1/v2 saved project states into valid schemaVersion 3 (or 4 narrative).
 */
export function migrateProjectPayload(raw: unknown): CreativeProject {
  if (!raw || typeof raw !== 'object') {
    throw new Error('Invalid project file: expected a JSON object.');
  }

  const obj = raw as Record<string, unknown>;
  if (typeof obj.schemaVersion === 'number' && obj.schemaVersion > NARRATIVE_SCHEMA_VERSION) {
    throw new Error(
      `Unsupported project schema version (${obj.schemaVersion}). This application supports up to schema version ${NARRATIVE_SCHEMA_VERSION}.`
    );
  }

  const hasNarrative = obj.schemaVersion === NARRATIVE_SCHEMA_VERSION;
  if (!hasNarrative && obj.narrative !== undefined) {
    throw new Error('Narrative data requires project schema 4.');
  }
  if (hasNarrative && (!obj.snapshot || typeof obj.snapshot !== 'object')) {
    throw new Error('Missing schema 4 project snapshot.');
  }

  const now = Date.now();
  if (obj.snapshot && typeof obj.snapshot === 'object') {
    return migrateSnapshotPayload(obj, hasNarrative, now);
  }
  return migrateLegacyProjectPayload(obj, now);
}

/**
 * Exports a CreativeProject as a formatted versioned JSON string.
 */
export function exportProjectToJson(project: CreativeProject): string {
  return JSON.stringify(
    {
      ...project,
      exportedAt: new Date().toISOString(),
    },
    null,
    2
  );
}

const MARKDOWN_BIBLE_ENTRIES: Array<[string, keyof StoryBibleFields]> = [
  ['Genre', 'genre'],
  ['Tone & Mood', 'tone'],
  ['Narrative Perspective', 'narrativePerspective'],
  ['Intended Audience', 'intendedAudience'],
  ['Setting', 'setting'],
  ['Themes', 'themes'],
  ['Central Conflict', 'centralConflict'],
  ['Pacing', 'pacing'],
  ['Continuity Rules', 'continuityRules'],
  ['Explicit Exclusions', 'explicitExclusions'],
  ['Visual Style', 'visualStyle'],
  ['Camera & Lighting', 'cameraAndLighting'],
];

function appendMarkdownStoryBibleSection(lines: string[], snapshot: ProjectSnapshot): void {
  lines.push(`## 1. Narrative & Creative Properties`, ``);
  for (const [label, key] of MARKDOWN_BIBLE_ENTRIES) {
    const item = snapshot.storyBible[key];
    if (item && item.value.trim()) {
      lines.push(`- **${label}** (${item.status}): ${item.value.trim()}`);
    }
  }
}

function appendMarkdownEntityAttributes(lines: string[], ent: Entity): void {
  for (const attr of ent.attributes) {
    if (attr.name === 'existence' || attr.name === 'existence_in_image') continue;
    const val = attr.confirmedValue ?? attr.value[0]?.name ?? 'Unknown';
    lines.push(
      `- **${attr.name.replace(/_/g, ' ')}**: ${val} _(${attr.status ?? 'pending'}, ${attr.provenance ?? 'ai-inferred'})_`
    );
  }
}

function appendMarkdownEntitiesSection(lines: string[], snapshot: ProjectSnapshot): void {
  lines.push(``, `## 2. Entities & Characters`, ``);
  for (const ent of snapshot.entities) {
    if (ent.category === 'scene') continue;
    const statusBadge = ent.excluded ? 'Excluded' : ent.status ?? 'confirmed';
    lines.push(`### ${ent.name} (${ent.category ?? 'entity'} — ${statusBadge})`);
    if (ent.description) lines.push(ent.description);
    appendMarkdownEntityAttributes(lines, ent);
    lines.push(``);
  }
}

/**
 * Exports the Story Bible and confirmed Entity/Relationship catalog as readable Markdown.
 */
export function exportStoryBibleMarkdown(project: CreativeProject): string {
  const { snapshot } = project;
  const lines: string[] = [
    `# Story Bible: ${project.name}`,
    ``,
    `> **Original Idea:** ${snapshot.originalIdea}`,
    `> **Primary Mode:** ${snapshot.mode === 'story' ? 'Story' : 'Image'}`,
    `> **Revision:** r${project.revision ?? 1}`,
    `> **Last Updated:** ${new Date(project.updatedAt).toISOString()}`,
    ``,
  ];

  appendMarkdownStoryBibleSection(lines, snapshot);
  appendMarkdownEntitiesSection(lines, snapshot);

  lines.push(`## 3. Relationships`, ``);
  for (const rel of snapshot.relationships) {
    lines.push(
      `- **${rel.source}** → _${rel.label}_ → **${rel.target}** (${rel.status ?? 'confirmed'})`
    );
  }

  lines.push(``, `## 4. Refined Prompt`, ``, '```text', snapshot.refinedPrompt, '```', ``);
  return lines.join('\n');
}
