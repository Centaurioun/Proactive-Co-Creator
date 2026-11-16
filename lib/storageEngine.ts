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
import { synthesizeRefinedPrompt } from './promptBuilder.ts';
import type {
  CreativeProject,
  Entity,
  GenerationMode,
  ProjectSnapshot,
  Relationship,
  StoryBibleFields,
} from '../shared/types.ts';

export const CURRENT_SCHEMA_VERSION = 2;
const LOCAL_STORAGE_PROJECTS_KEY = 'proactive_co_creator_projects_v2';
const LOCAL_STORAGE_ACTIVE_ID_KEY = 'proactive_co_creator_active_id_v2';
const IDB_NAME = 'proactive_co_creator_db_v2';
const IDB_STORE = 'projects';

export interface StorageSaveResult {
  ok: boolean;
  conflictDetected?: boolean;
  error?: string;
}

/**
 * Migrates older v0/v1 saved project states (including legacy states with `mode: 'video'`)
 * into a valid schemaVersion 2 CreativeProject without losing recoverable story or image data.
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

  // Case 1: Already a v2-like structure with `snapshot`
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

    return {
      schemaVersion: CURRENT_SCHEMA_VERSION,
      id: typeof obj.id === 'string' && obj.id ? obj.id : makeStableId('proj'),
      name:
        typeof obj.name === 'string' && obj.name.trim()
          ? obj.name.trim()
          : originalIdea.slice(0, 48),
      createdAt: typeof obj.createdAt === 'number' ? obj.createdAt : now,
      updatedAt: typeof obj.updatedAt === 'number' ? obj.updatedAt : now,
      snapshot,
      artifacts: Array.isArray(obj.artifacts)
        ? (obj.artifacts as CreativeProject['artifacts']).filter(
            (a) => a && (a.mode === 'story' || a.mode === 'image')
          )
        : [],
      revisions: Array.isArray(obj.revisions) && obj.revisions.length > 0
        ? (obj.revisions as CreativeProject['revisions'])
        : [
            {
              id: makeStableId('rev'),
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

  const artifacts: CreativeProject['artifacts'] = [];
  if (typeof obj.story === 'string' && obj.story.trim()) {
    artifacts.push({
      id: makeStableId('art_story'),
      mode: 'story',
      createdAt: now,
      revisionId: 'rev_migrated',
      promptUsed: snapshot.refinedPrompt,
      storyText: obj.story,
      isOutdated: false,
    });
  }
  if (Array.isArray(obj.images) && obj.images.length > 0) {
    artifacts.push({
      id: makeStableId('art_img'),
      mode: 'image',
      createdAt: now,
      revisionId: 'rev_migrated',
      promptUsed: snapshot.refinedPrompt,
      images: (obj.images as unknown[]).filter((i): i is string => typeof i === 'string'),
      isOutdated: false,
    });
  }

  return {
    schemaVersion: CURRENT_SCHEMA_VERSION,
    id: typeof obj.id === 'string' ? obj.id : makeStableId('proj'),
    name:
      typeof obj.name === 'string' && obj.name.trim()
        ? obj.name.trim()
        : (legacyPrompt || 'Migrated Project').slice(0, 48),
    createdAt: now,
    updatedAt: now,
    snapshot,
    artifacts,
    revisions: [
      {
        id: 'rev_migrated',
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
    const attributes = rawAttrs
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
          status:
            a.status === 'confirmed' || a.status === 'rejected'
              ? a.status
              : a.presence_in_prompt
                ? ('confirmed' as const)
                : ('pending' as const),
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
    lines.push(`- **${rel.source}** → _${rel.label}_ → **${rel.target}**`);
  }

  lines.push(``, `## 4. Refined Prompt`, ``, '```text', snapshot.refinedPrompt, '```', ``);
  return lines.join('\n');
}

// --- Browser Local Storage + IndexedDB Persistence Engine ---

function stripHeavyMediaForFallback(project: CreativeProject): CreativeProject {
  // Keep lightweight metadata for image artifacts if localStorage quota is tight
  return {
    ...project,
    artifacts: project.artifacts.map((art, idx) =>
      idx === 0
        ? art
        : {
            ...art,
            images: art.images ? art.images.slice(0, 1) : undefined,
          }
    ),
  };
}

export function saveProjectToLocalStorage(
  project: CreativeProject,
  expectedMinUpdatedAt?: number
): StorageSaveResult {
  if (typeof window === 'undefined' || !window.localStorage) {
    return { ok: false, error: 'Browser localStorage is unavailable.' };
  }

  try {
    const raw = window.localStorage.getItem(LOCAL_STORAGE_PROJECTS_KEY);
    const map: Record<string, CreativeProject> = raw ? (JSON.parse(raw) as Record<string, CreativeProject>) : {};
    const existing = map[project.id];

    // Multi-tab conflict detection: do not silently overwrite a newer timestamp from another tab
    if (
      expectedMinUpdatedAt !== undefined &&
      existing &&
      existing.updatedAt > expectedMinUpdatedAt
    ) {
      return {
        ok: false,
        conflictDetected: true,
        error: 'A newer version of this project was saved in another browser tab.',
      };
    }

    map[project.id] = project;
    try {
      window.localStorage.setItem(LOCAL_STORAGE_PROJECTS_KEY, JSON.stringify(map));
    } catch {
      // Quota fallback: trim older image base64 payloads while preserving all structured project data
      map[project.id] = stripHeavyMediaForFallback(project);
      window.localStorage.setItem(LOCAL_STORAGE_PROJECTS_KEY, JSON.stringify(map));
    }
    window.localStorage.setItem(LOCAL_STORAGE_ACTIVE_ID_KEY, project.id);
    return { ok: true };
  } catch (err) {
    return {
      ok: false,
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
      saveProjectToLocalStorage(sample);
      return { projects: [sample], activeProjectId: sample.id };
    }

    const parsed = JSON.parse(raw) as Record<string, unknown>;
    const projects: CreativeProject[] = [];
    for (const val of Object.values(parsed)) {
      try {
        projects.push(migrateProjectPayload(val));
      } catch {
        // Ignore corrupted individual entry without crashing workspace
      }
    }

    if (projects.length === 0) {
      const sample = createSampleProject();
      saveProjectToLocalStorage(sample);
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

export async function saveProjectToIndexedDb(project: CreativeProject): Promise<void> {
  if (typeof window === 'undefined' || !('indexedDB' in window)) return;
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
        tx.objectStore(IDB_STORE).put(project);
        tx.oncomplete = () => {
          db.close();
          resolve();
        };
        tx.onerror = () => {
          db.close();
          resolve();
        };
      };
      req.onerror = () => resolve();
    } catch {
      resolve();
    }
  });
}
