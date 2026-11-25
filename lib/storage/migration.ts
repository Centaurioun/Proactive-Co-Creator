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
  CreativeProject,
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

export function normalizeMigratedEntities(rawEntities: unknown[]): Entity[] {
  const results: Entity[] = [];
  for (const item of rawEntities) {
    if (!item || typeof item !== 'object') continue;
    const raw = item as Record<string, unknown>;
    if (typeof raw.name !== 'string' || !raw.name.trim()) continue;
    // Skip legacy 'The Video' scene entity or rename it to 'The Story'
    const rawName = raw.name.trim();
    const migratedName =
      rawName.toLowerCase() === 'the video' || rawName.toLowerCase() === 'video'
        ? 'The Story'
        : rawName;

    const rawAttrs = Array.isArray(raw.attributes) ? raw.attributes : [];
    const attributes: Entity['attributes'] = rawAttrs
      .filter((a): a is Record<string, unknown> => Boolean(a && typeof a === 'object'))
      .map((a) => {
        const vals = Array.isArray(a.value)
          ? a.value.map((v) =>
              typeof v === 'string'
                ? { name: v }
                : v && typeof v === 'object' && typeof (v as { name?: unknown }).name === 'string'
                  ? { name: (v as { name: string }).name }
                  : { name: 'Unknown' }
            )
          : [{ name: 'Unknown' }];
        const status: 'confirmed' | 'rejected' | 'pending' =
          a.status === 'confirmed'
            ? 'confirmed'
            : a.status === 'rejected'
              ? 'rejected'
              : a.presence_in_prompt
                ? 'confirmed'
                : 'pending';
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
          status,
          provenance:
            typeof a.provenance === 'string'
              ? (a.provenance as never)
              : a.presence_in_prompt
                ? ('prompt-explicit' as const)
                : ('ai-inferred' as const),
          ...(a.epistemicKind === undefined
            ? {}
            : { epistemicKind: epistemicKindSchema.parse(a.epistemicKind) }),
        };
      });

    const entity: Entity = {
      id: typeof raw.id === 'string' ? raw.id : makeStableId('ent'),
      name: migratedName,
      category:
        typeof raw.category === 'string' ? (raw.category as Entity['category']) : undefined,
      presence_in_prompt: Boolean(raw.presence_in_prompt),
      description: typeof raw.description === 'string' ? raw.description : '',
      alternatives: normalizeNameCandidates(raw.alternatives),
      attributes,
      status:
        raw.status === 'confirmed' || raw.status === 'rejected'
          ? raw.status
          : ('confirmed' as const),
      provenance:
        typeof raw.provenance === 'string' ? (raw.provenance as never) : 'imported',
      ...(raw.epistemicKind === undefined
        ? {}
        : { epistemicKind: epistemicKindSchema.parse(raw.epistemicKind) }),
      excluded: Boolean(raw.excluded),
      aliases: Array.isArray(raw.aliases)
        ? (raw.aliases as unknown[]).filter((s): s is string => typeof s === 'string')
        : [],
    };
    entity.category = inferEntityCategory(entity);
    results.push(entity);
  }
  return results;
}

export function normalizeMigratedRelationships(
  rawRelationships: unknown[],
  entities: Entity[]
): Relationship[] {
  const results: Relationship[] = [];
  for (const item of rawRelationships) {
    if (!item || typeof item !== 'object') continue;
    const raw = item as Record<string, unknown>;
    if (
      typeof raw.source !== 'string' ||
      typeof raw.target !== 'string' ||
      typeof raw.label !== 'string'
    ) {
      continue;
    }
    const srcEnt = entities.find(
      (e) => e.id === raw.sourceId || e.name.toLowerCase() === raw.source!.toString().toLowerCase()
    );
    const tgtEnt = entities.find(
      (e) => e.id === raw.targetId || e.name.toLowerCase() === raw.target!.toString().toLowerCase()
    );
    results.push({
      id: typeof raw.id === 'string' ? raw.id : makeStableId('rel'),
      sourceId: srcEnt?.id,
      targetId: tgtEnt?.id,
      source: srcEnt?.name ?? raw.source,
      target: tgtEnt?.name ?? raw.target,
      label: raw.label,
      alternatives: normalizeNameCandidates(raw.alternatives),
      status: raw.status === 'pending' || raw.status === 'rejected' ? raw.status : 'confirmed',
      provenance:
        typeof raw.provenance === 'string' ? (raw.provenance as never) : 'imported',
      ...(raw.epistemicKind === undefined
        ? {}
        : { epistemicKind: epistemicKindSchema.parse(raw.epistemicKind) }),
    });
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
    if (entry && typeof entry === 'object' && 'value' in entry) {
      const typedEntry = entry as {
        value?: unknown;
        status?: unknown;
        provenance?: unknown;
        updatedAt?: unknown;
        epistemicKind?: unknown;
        sourceBacked?: unknown;
      };
      baseBible[key] = {
        value: typeof typedEntry.value === 'string' ? typedEntry.value : '',
        status:
          typedEntry.status === 'confirmed' || typedEntry.status === 'rejected'
            ? typedEntry.status
            : 'pending',
        provenance:
          typeof typedEntry.provenance === 'string'
            ? (typedEntry.provenance as never)
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
  }
  return baseBible;
}

function migrateSnapshotPayload(
  obj: Record<string, unknown>,
  hasNarrative: boolean,
  now: number
): CreativeProject {
  const rawSnap = obj.snapshot as Record<string, unknown>;
  const rawMode = String(rawSnap.mode ?? 'story');
  const safeMode: GenerationMode = rawMode === 'image' ? 'image' : 'story';
  const hasImportedSourceEvidence = Boolean(
    hasNarrative &&
      obj.narrative &&
      typeof obj.narrative === 'object' &&
      Array.isArray((obj.narrative as { sources?: unknown }).sources) &&
      (obj.narrative as { sources: unknown[] }).sources.length > 0
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

  const normalizedRelationships = normalizeMigratedRelationships(
    Array.isArray(rawSnap.relationships) ? rawSnap.relationships : [],
    entities
  );
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

  const baseBible = normalizeStoryBibleEntries(rawSnap.storyBible, hasImportedSourceEvidence, now);

  let snapshot: ProjectSnapshot = {
    ...(hasNarrative ? { manuscriptVersionId: rawSnap.manuscriptVersionId as string | undefined } : {}),
    originalIdea,
    refinedPrompt: typeof rawSnap.refinedPrompt === 'string' ? rawSnap.refinedPrompt : '',
    freeformNotes: typeof rawSnap.freeformNotes === 'string' ? rawSnap.freeformNotes : '',
    mode: safeMode,
    entities,
    relationships,
    storyBible: baseBible,
    clarifications: Array.isArray(rawSnap.clarifications)
      ? (rawSnap.clarifications as ProjectSnapshot['clarifications'])
      : [],
    decisions: Array.isArray(rawSnap.decisions)
      ? (rawSnap.decisions as ProjectSnapshot['decisions'])
      : [],
    answeredQuestions: Array.isArray(rawSnap.answeredQuestions)
      ? (rawSnap.answeredQuestions as string[]).filter((q) => typeof q === 'string')
      : [],
    skippedQuestions: Array.isArray(rawSnap.skippedQuestions)
      ? (rawSnap.skippedQuestions as string[]).filter((q) => typeof q === 'string')
      : [],
  };

  snapshot = syncStoryBibleWithSceneEntity(snapshot);
  snapshot.decisions = buildDecisionInboxFromSnapshot(snapshot);
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

  const artifacts = Array.isArray(obj.artifacts)
    ? (obj.artifacts as CreativeProject['artifacts'])
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
        })
    : [];

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
    artifacts,
    revisions:
      Array.isArray(obj.revisions) && obj.revisions.length > 0
        ? (obj.revisions as CreativeProject['revisions']).map((r, idx) => ({
            ...r,
            revisionNumber: r.revisionNumber ?? Math.max(1, logicalRev - idx),
          }))
        : [
            {
              id: makeStableId('rev'),
              revisionNumber: logicalRev,
              timestamp: now,
              label: 'Imported Revision',
              summary: 'Migrated project state',
              changeCount: 0,
              snapshot: structuredClone(snapshot),
            },
          ],
    undoHistory:
      obj.undoHistory &&
      typeof obj.undoHistory === 'object' &&
      Array.isArray((obj.undoHistory as { past?: unknown }).past) &&
      Array.isArray((obj.undoHistory as { future?: unknown }).future)
        ? (obj.undoHistory as CreativeProject['undoHistory'])
        : undefined,
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

function migrateLegacyProjectPayload(
  obj: Record<string, unknown>,
  now: number
): CreativeProject {
  const legacyPrompt =
    typeof obj.prompt === 'string' && obj.prompt.trim()
      ? obj.prompt.trim()
      : typeof (obj.beliefGraph as { prompt?: unknown } | undefined)?.prompt === 'string'
        ? String((obj.beliefGraph as { prompt?: string }).prompt)
        : '';

  if (!legacyPrompt && !Array.isArray(obj.entities) && !obj.beliefGraph) {
    throw new Error('Malformed project JSON: missing snapshot or legacy beliefGraph fields.');
  }

  const rawMode = String(obj.mode ?? 'story');
  // Migrate 'video' mode safely to 'story' without losing data
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
    answeredQuestions: Array.isArray(obj.answeredQuestions)
      ? (obj.answeredQuestions as string[])
      : [],
    skippedQuestions: Array.isArray(obj.skippedQuestions)
      ? (obj.skippedQuestions as string[])
      : [],
  };

  snapshot = syncStoryBibleWithSceneEntity(snapshot);
  snapshot.decisions = buildDecisionInboxFromSnapshot(snapshot);
  snapshot.refinedPrompt = synthesizeRefinedPrompt(snapshot);

  const projectId = typeof obj.id === 'string' ? obj.id : makeStableId('proj');
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

  return {
    schemaVersion: CURRENT_SCHEMA_VERSION,
    id: projectId,
    name:
      typeof obj.name === 'string' && obj.name.trim()
        ? obj.name.trim()
        : (legacyPrompt || 'Migrated Project').slice(0, 48),
    createdAt: now,
    updatedAt: now,
    revision: 1,
    persistedRevision: 1,
    snapshot,
    artifacts,
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
 * Migrates older v0/v1/v2 saved project states (including legacy states with `mode: 'video'`)
 * into a valid schemaVersion 3 (or 4 narrative) CreativeProject without losing recoverable data.
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
    `## 1. Narrative & Creative Properties`,
    ``,
  ];

  const bibleEntries: Array<[string, keyof StoryBibleFields]> = [
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

  for (const [label, key] of bibleEntries) {
    const item = snapshot.storyBible[key];
    if (item && item.value.trim()) {
      lines.push(`- **${label}** (${item.status}): ${item.value.trim()}`);
    }
  }

  lines.push(``, `## 2. Entities & Characters`, ``);
  for (const ent of snapshot.entities) {
    if (ent.category === 'scene') continue;
    const statusBadge = ent.excluded ? 'Excluded' : ent.status ?? 'confirmed';
    lines.push(`### ${ent.name} (${ent.category ?? 'entity'} — ${statusBadge})`);
    if (ent.description) {
      lines.push(`${ent.description}`);
    }
    for (const attr of ent.attributes) {
      if (attr.name === 'existence' || attr.name === 'existence_in_image') continue;
      const val = attr.confirmedValue ?? attr.value[0]?.name ?? 'Unknown';
      lines.push(
        `- **${attr.name.replace(/_/g, ' ')}**: ${val} _(${attr.status ?? 'pending'}, ${attr.provenance ?? 'ai-inferred'})_`
      );
    }
    lines.push(``);
  }

  lines.push(`## 3. Relationships`, ``);
  for (const rel of snapshot.relationships) {
    lines.push(
      `- **${rel.source}** → _${rel.label}_ → **${rel.target}** (${rel.status ?? 'confirmed'})`
    );
  }

  lines.push(``, `## 4. Refined Prompt`, ``, '```text', snapshot.refinedPrompt, '```', ``);
  return lines.join('\n');
}
