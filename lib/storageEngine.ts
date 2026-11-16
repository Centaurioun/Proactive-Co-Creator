/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import {
  buildDecisionInboxFromSnapshot,
  createEmptyStoryBible,
  createSampleProject,
  makeStableId,
  syncStoryBibleWithSceneEntity,
} from './canonicalModel.ts';
import { inferEntityCategory } from './beliefGraphUtils.ts';
import { computePromptDigest, synthesizeRefinedPrompt } from './promptBuilder.ts';
import type {
  CreativeProject,
  Entity,
  GenerationMode,
  ProjectSnapshot,
  Relationship,
  StoryBibleFields,
} from '../shared/types.ts';

export const CURRENT_SCHEMA_VERSION = 3;
export const LOCAL_STORAGE_PROJECTS_KEY = 'proactive_co_creator_projects_v2';
export const LOCAL_STORAGE_ACTIVE_ID_KEY = 'proactive_co_creator_active_id_v2';
export const LOCAL_STORAGE_BACKUP_V2_KEY = 'proactive_co_creator_backup_v2';
const IDB_NAME = 'proactive_co_creator_db_v2';
const IDB_STORE = 'projects';

export interface StorageSaveResult {
  ok: boolean;
  saved?: boolean;
  conflictDetected?: boolean;
  quotaExceeded?: boolean;
  storedProject?: CreativeProject;
  persistedRevision?: number;
  error?: string;
}

/**
 * Migrates older v0/v1/v2 saved project states (including legacy states with `mode: 'video'`)
 * into a valid schemaVersion 3 CreativeProject without losing recoverable story or image data.
 */
export function migrateProjectPayload(raw: unknown): CreativeProject {
  if (!raw || typeof raw !== 'object') {
    throw new Error('Invalid project file: expected a JSON object.');
  }

  const obj = raw as Record<string, unknown>;

  if (typeof obj.schemaVersion === 'number' && obj.schemaVersion > CURRENT_SCHEMA_VERSION) {
    throw new Error(
      `Unsupported project schema version (${obj.schemaVersion}). This application supports up to schema version ${CURRENT_SCHEMA_VERSION}.`
    );
  }

  const now = Date.now();

  // Case 1: Already a v2/v3-like structure with `snapshot`
  if (obj.snapshot && typeof obj.snapshot === 'object') {
    const rawSnap = obj.snapshot as Record<string, unknown>;
    const rawMode = String(rawSnap.mode ?? 'story');
    const safeMode: GenerationMode = rawMode === 'image' ? 'image' : 'story';

    const originalIdea =
      typeof rawSnap.originalIdea === 'string' && rawSnap.originalIdea.trim()
        ? rawSnap.originalIdea
        : typeof rawSnap.prompt === 'string'
          ? rawSnap.prompt
          : 'Untitled creative project';

    const entities = normalizeMigratedEntities(
      Array.isArray(rawSnap.entities) ? rawSnap.entities : []
    );
    const relationships = normalizeMigratedRelationships(
      Array.isArray(rawSnap.relationships) ? rawSnap.relationships : [],
      entities
    );

    const baseBible = createEmptyStoryBible(now);
    if (rawSnap.storyBible && typeof rawSnap.storyBible === 'object') {
      const incomingBible = rawSnap.storyBible as Record<string, unknown>;
      for (const key of Object.keys(baseBible) as Array<keyof StoryBibleFields>) {
        const entry = incomingBible[key];
        if (entry && typeof entry === 'object' && 'value' in entry) {
          const typedEntry = entry as {
            value?: unknown;
            status?: unknown;
            provenance?: unknown;
            updatedAt?: unknown;
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
          };
        }
      }
    }

    let snapshot: ProjectSnapshot = {
      originalIdea,
      refinedPrompt:
        typeof rawSnap.refinedPrompt === 'string' ? rawSnap.refinedPrompt : '',
      freeformNotes:
        typeof rawSnap.freeformNotes === 'string' ? rawSnap.freeformNotes : '',
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

    const currentDigest = computePromptDigest(snapshot.refinedPrompt, snapshot.mode);
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

    void currentDigest;

    return {
      schemaVersion: CURRENT_SCHEMA_VERSION,
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
    };
  }

  // Case 2: Legacy v1 project or raw BeliefState payload (may have `mode: 'video'`, `prompt`, `beliefGraph`, `story`, `images`)
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

function normalizeMigratedEntities(rawEntities: unknown[]): Entity[] {
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
        };
      });

    const entity: Entity = {
      id: typeof raw.id === 'string' ? raw.id : makeStableId('ent'),
      name: migratedName,
      category:
        typeof raw.category === 'string' ? (raw.category as Entity['category']) : undefined,
      presence_in_prompt: Boolean(raw.presence_in_prompt),
      description: typeof raw.description === 'string' ? raw.description : '',
      alternatives: Array.isArray(raw.alternatives)
        ? raw.alternatives.map((alt) =>
            typeof alt === 'string'
              ? { name: alt }
              : alt && typeof alt === 'object' && typeof (alt as { name?: unknown }).name === 'string'
                ? { name: (alt as { name: string }).name }
                : { name: '' }
          ).filter((c) => Boolean(c.name))
        : [],
      attributes,
      status:
        raw.status === 'confirmed' || raw.status === 'rejected'
          ? raw.status
          : ('confirmed' as const),
      provenance:
        typeof raw.provenance === 'string' ? (raw.provenance as never) : 'imported',
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

function normalizeMigratedRelationships(
  rawRelationships: unknown[],
  entities: Entity[]
): Relationship[] {
  const results: Relationship[] = [];
  for (const item of rawRelationships) {
    if (!item || typeof item !== 'object') continue;
    const raw = item as Record<string, unknown>;
    if (typeof raw.source !== 'string' || typeof raw.target !== 'string' || typeof raw.label !== 'string') {
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
      alternatives: Array.isArray(raw.alternatives)
        ? raw.alternatives.map((alt) =>
            typeof alt === 'string'
              ? { name: alt }
              : alt && typeof alt === 'object' && typeof (alt as { name?: unknown }).name === 'string'
                ? { name: (alt as { name: string }).name }
                : { name: '' }
          ).filter((c) => Boolean(c.name))
        : [],
      status: raw.status === 'pending' || raw.status === 'rejected' ? raw.status : 'confirmed',
      provenance:
        typeof raw.provenance === 'string' ? (raw.provenance as never) : 'imported',
    });
  }
  return results;
}

/**
 * Exports a CreativeProject as a formatted versioned JSON string.
 */
export function exportProjectToJson(project: CreativeProject): string {
  return JSON.stringify(
    {
      ...project,
      schemaVersion: CURRENT_SCHEMA_VERSION,
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
      lines.push(`- **${attr.name.replace(/_/g, ' ')}**: ${val} _(${attr.status ?? 'pending'}, ${attr.provenance ?? 'ai-inferred'})_`);
    }
    lines.push(``);
  }

  lines.push(`## 3. Relationships`, ``);
  for (const rel of snapshot.relationships) {
    lines.push(`- **${rel.source}** → _${rel.label}_ → **${rel.target}** (${rel.status ?? 'confirmed'})`);
  }

  lines.push(``, `## 4. Refined Prompt`, ``, '```text', snapshot.refinedPrompt, '```', ``);
  return lines.join('\n');
}

// --- Browser Local Storage + IndexedDB Persistence Engine ---

export function saveProjectToLocalStorage(
  project: CreativeProject,
  expectedBaseRevisionOrOptions?:
    | number
    | { expectedPersistedRevision?: number; forceOverwrite?: boolean },
  options?: { forceOverwrite?: boolean }
): StorageSaveResult {
  if (typeof window === 'undefined' || !window.localStorage) {
    return { ok: false, saved: false, error: 'Browser localStorage is unavailable.' };
  }

  const normalizedForce =
    typeof expectedBaseRevisionOrOptions === 'object' && expectedBaseRevisionOrOptions !== null
      ? Boolean(expectedBaseRevisionOrOptions.forceOverwrite)
      : Boolean(options?.forceOverwrite);

  const rawExpected =
    typeof expectedBaseRevisionOrOptions === 'number'
      ? expectedBaseRevisionOrOptions
      : expectedBaseRevisionOrOptions?.expectedPersistedRevision;

  try {
    const raw = window.localStorage.getItem(LOCAL_STORAGE_PROJECTS_KEY);
    const map: Record<string, CreativeProject> = raw
      ? (JSON.parse(raw) as Record<string, CreativeProject>)
      : {};
    const existing = map[project.id];

    // Optimistic concurrency control (CAS) on monotonic logical revision (and legacy updatedAt fallback)
    if (!normalizedForce && existing) {
      const existingRev = typeof existing.revision === 'number' ? existing.revision : 1;
      const isTimestampExpectation =
        typeof rawExpected === 'number' && rawExpected > 1_000_000_000_000;

      if (isTimestampExpectation) {
        if (existing.updatedAt > rawExpected) {
          return {
            ok: false,
            saved: false,
            conflictDetected: true,
            storedProject: migrateProjectPayload(existing),
            error: 'A newer version of this project was saved in another browser tab.',
          };
        }
      } else {
        const baseRev =
          rawExpected !== undefined ? rawExpected : project.persistedRevision;

        if (baseRev !== undefined && existingRev > baseRev) {
          return {
            ok: false,
            saved: false,
            conflictDetected: true,
            storedProject: migrateProjectPayload(existing),
            error: `Storage conflict detected: another tab saved revision r${existingRev} while this tab was based on r${baseRev}.`,
          };
        }

        // Also detect concurrent edits where another tab wrote the same revision with a newer timestamp
        if (
          baseRev !== undefined &&
          existingRev === baseRev &&
          project.revision === baseRev &&
          existing.updatedAt > project.updatedAt
        ) {
          return {
            ok: false,
            saved: false,
            conflictDetected: true,
            storedProject: migrateProjectPayload(existing),
            error: 'A newer version of this project was saved in another browser tab.',
          };
        }
      }
    }

    const nextRevision = project.revision ?? 1;
    const projectToStore: CreativeProject = {
      ...project,
      schemaVersion: CURRENT_SCHEMA_VERSION,
      revision: nextRevision,
      persistedRevision: nextRevision,
    };

    map[project.id] = projectToStore;
    try {
      window.localStorage.setItem(LOCAL_STORAGE_PROJECTS_KEY, JSON.stringify(map));
    } catch (quotaErr) {
      // Never silently delete or strip user media on quota errors (AC15, F12).
      return {
        ok: false,
        saved: false,
        quotaExceeded: true,
        persistedRevision: project.persistedRevision,
        error:
          quotaErr instanceof Error && quotaErr.message
            ? `Browser localStorage quota exceeded (${quotaErr.message}). Full project media remains intact in memory and IndexedDB. Export JSON or remove older image outputs to free space.`
            : 'Browser localStorage quota exceeded. Full project media remains intact in memory and IndexedDB.',
      };
    }

    window.localStorage.setItem(LOCAL_STORAGE_ACTIVE_ID_KEY, project.id);
    return {
      ok: true,
      saved: true,
      persistedRevision: nextRevision,
    };
  } catch (err) {
    return {
      ok: false,
      saved: false,
      error: err instanceof Error ? err.message : 'Failed to write to local storage.',
    };
  }
}

export function loadProjectsFromLocalStorage(): {
  projects: CreativeProject[];
  activeProjectId: string | null;
} {
  if (typeof window === 'undefined' || !window.localStorage) {
    const sample = createSampleProject();
    return { projects: [sample], activeProjectId: sample.id };
  }

  try {
    const raw = window.localStorage.getItem(LOCAL_STORAGE_PROJECTS_KEY);
    const activeId = window.localStorage.getItem(LOCAL_STORAGE_ACTIVE_ID_KEY);
    if (!raw) {
      const sample = createSampleProject();
      saveProjectToLocalStorage(sample, undefined, { forceOverwrite: true });
      return { projects: [sample], activeProjectId: sample.id };
    }

    const parsed = JSON.parse(raw) as Record<string, unknown>;
    const projects: CreativeProject[] = [];
    let needsPreMigrationBackup = false;

    for (const val of Object.values(parsed)) {
      if (
        val &&
        typeof val === 'object' &&
        typeof (val as { schemaVersion?: unknown }).schemaVersion === 'number' &&
        ((val as { schemaVersion: number }).schemaVersion < CURRENT_SCHEMA_VERSION)
      ) {
        needsPreMigrationBackup = true;
      }
      try {
        projects.push(migrateProjectPayload(val));
      } catch {
        // Ignore corrupted individual entry without crashing workspace
      }
    }

    if (needsPreMigrationBackup) {
      try {
        if (!window.localStorage.getItem(LOCAL_STORAGE_BACKUP_V2_KEY)) {
          window.localStorage.setItem(LOCAL_STORAGE_BACKUP_V2_KEY, raw);
        }
      } catch {
        // Best-effort backup if quota is tight
      }
    }

    if (projects.length === 0) {
      const sample = createSampleProject();
      saveProjectToLocalStorage(sample, undefined, { forceOverwrite: true });
      return { projects: [sample], activeProjectId: sample.id };
    }

    projects.sort((a, b) => b.updatedAt - a.updatedAt);
    const resolvedActiveId =
      activeId && projects.some((p) => p.id === activeId) ? activeId : projects[0].id;
    return { projects, activeProjectId: resolvedActiveId };
  } catch {
    const sample = createSampleProject();
    return { projects: [sample], activeProjectId: sample.id };
  }
}

export function deleteProjectFromLocalStorage(projectId: string): CreativeProject[] {
  if (typeof window === 'undefined' || !window.localStorage) return [];
  try {
    const raw = window.localStorage.getItem(LOCAL_STORAGE_PROJECTS_KEY);
    if (!raw) return [];
    const map = JSON.parse(raw) as Record<string, CreativeProject>;
    delete map[projectId];
    const remaining = Object.values(map).map((p) => migrateProjectPayload(p));
    if (remaining.length === 0) {
      const sample = createSampleProject();
      map[sample.id] = sample;
      window.localStorage.setItem(LOCAL_STORAGE_PROJECTS_KEY, JSON.stringify(map));
      window.localStorage.setItem(LOCAL_STORAGE_ACTIVE_ID_KEY, sample.id);
      return [sample];
    }
    window.localStorage.setItem(LOCAL_STORAGE_PROJECTS_KEY, JSON.stringify(map));
    return remaining.sort((a, b) => b.updatedAt - a.updatedAt);
  } catch {
    return [];
  }
}

export async function saveProjectToIndexedDb(
  project: CreativeProject,
  expectedBaseRevisionOrOptions?:
    | number
    | { expectedPersistedRevision?: number; forceOverwrite?: boolean },
  options?: { forceOverwrite?: boolean }
): Promise<StorageSaveResult> {
  if (typeof window === 'undefined' || !('indexedDB' in window)) {
    return { ok: false, saved: false, error: 'IndexedDB is unavailable in this environment.' };
  }
  const normalizedForce =
    typeof expectedBaseRevisionOrOptions === 'object' && expectedBaseRevisionOrOptions !== null
      ? Boolean(expectedBaseRevisionOrOptions.forceOverwrite)
      : Boolean(options?.forceOverwrite);
  const rawExpected =
    typeof expectedBaseRevisionOrOptions === 'number'
      ? expectedBaseRevisionOrOptions
      : expectedBaseRevisionOrOptions?.expectedPersistedRevision;

  return new Promise((resolve) => {
    try {
      const req = window.indexedDB.open(IDB_NAME, 1);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains(IDB_STORE)) {
          db.createObjectStore(IDB_STORE, { keyPath: 'id' });
        }
      };
      req.onsuccess = () => {
        const db = req.result;
        const tx = db.transaction(IDB_STORE, 'readwrite');
        const store = tx.objectStore(IDB_STORE);
        const getReq = store.get(project.id);

        getReq.onsuccess = () => {
          const existing = getReq.result as CreativeProject | undefined;
          const baseRev =
            rawExpected !== undefined
              ? rawExpected
              : project.persistedRevision;

          if (
            !normalizedForce &&
            existing &&
            baseRev !== undefined &&
            (existing.revision ?? 1) > baseRev
          ) {
            db.close();
            resolve({
              ok: false,
              saved: false,
              conflictDetected: true,
              storedProject: migrateProjectPayload(existing),
              error: `IndexedDB has a newer revision (r${existing.revision ?? 1}) than expected base r${baseRev}.`,
            });
            return;
          }

          const nextRev = project.revision ?? 1;
          store.put({
            ...project,
            schemaVersion: CURRENT_SCHEMA_VERSION,
            revision: nextRev,
            persistedRevision: nextRev,
          });
        };

        tx.oncomplete = () => {
          db.close();
          resolve({ ok: true, saved: true, persistedRevision: project.revision ?? 1 });
        };
        tx.onerror = () => {
          const errMsg = tx.error?.message ?? 'IndexedDB transaction failed.';
          db.close();
          resolve({ ok: false, saved: false, error: errMsg });
        };
      };
      req.onerror = () =>
        resolve({ ok: false, saved: false, error: req.error?.message ?? 'Failed to open IndexedDB.' });
    } catch (err) {
      resolve({
        ok: false,
        saved: false,
        error: err instanceof Error ? err.message : 'IndexedDB exception.',
      });
    }
  });
}

export async function loadProjectsFromIndexedDb(): Promise<CreativeProject[]> {
  if (typeof window === 'undefined' || !('indexedDB' in window)) return [];
  return new Promise((resolve) => {
    try {
      const req = window.indexedDB.open(IDB_NAME, 1);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains(IDB_STORE)) {
          db.createObjectStore(IDB_STORE, { keyPath: 'id' });
        }
      };
      req.onsuccess = () => {
        const db = req.result;
        const tx = db.transaction(IDB_STORE, 'readonly');
        const store = tx.objectStore(IDB_STORE);
        const allReq = store.getAll();
        allReq.onsuccess = () => {
          const rawList = Array.isArray(allReq.result) ? allReq.result : [];
          const migrated: CreativeProject[] = [];
          for (const item of rawList) {
            try {
              migrated.push(migrateProjectPayload(item));
            } catch {
              // Ignore malformed record
            }
          }
          db.close();
          resolve(migrated.sort((a, b) => b.updatedAt - a.updatedAt));
        };
        allReq.onerror = () => {
          db.close();
          resolve([]);
        };
      };
      req.onerror = () => resolve([]);
    } catch {
      resolve([]);
    }
  });
}
