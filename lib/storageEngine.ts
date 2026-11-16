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
import {
  createUndoRedoState,
  isSnapshotSemanticallyEqual,
  type UndoRedoState,
} from './historyEngine.ts';
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
export const LOCAL_STORAGE_DELETED_IDS_KEY = 'proactive_co_creator_deleted_ids_v2';
const IDB_NAME = 'proactive_co_creator_db_v2';
const IDB_STORE = 'projects';

const deletedProjectIdsMemorySet = new Set<string>();

export interface StorageSaveResult {
  ok: boolean;
  saved?: boolean;
  conflictDetected?: boolean;
  quotaExceeded?: boolean;
  storedProject?: CreativeProject;
  persistedRevision?: number;
  authoritativeStore?: 'indexeddb' | 'localstorage';
  idbSaved?: boolean;
  localSaved?: boolean;
  cacheSynced?: boolean;
  cacheWarning?: string;
  error?: string;
}

export type IndexedDbLoadStatus = 'ok' | 'empty' | 'unavailable' | 'read_error';

export interface IndexedDbLoadResult {
  ok: boolean;
  status: IndexedDbLoadStatus;
  projects: CreativeProject[];
  corruptRecordCount: number;
  corruptRecordErrors: string[];
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
      undoHistory:
        obj.undoHistory &&
        typeof obj.undoHistory === 'object' &&
        Array.isArray((obj.undoHistory as { past?: unknown }).past) &&
        Array.isArray((obj.undoHistory as { future?: unknown }).future)
          ? (obj.undoHistory as CreativeProject['undoHistory'])
          : undefined,
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

export function getDeletedProjectIds(): Set<string> {
  const combined = new Set<string>(deletedProjectIdsMemorySet);
  if (typeof window === 'undefined') return combined;

  const readFromStorage = (storage: Storage | undefined) => {
    if (!storage) return;
    try {
      const raw = storage.getItem(LOCAL_STORAGE_DELETED_IDS_KEY);
      if (!raw) return;
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) {
        for (const id of parsed) {
          if (typeof id === 'string') {
            combined.add(id);
            deletedProjectIdsMemorySet.add(id);
          }
        }
      }
    } catch {
      // Ignore storage read error
    }
  };

  readFromStorage(window.localStorage);
  readFromStorage(window.sessionStorage);
  return combined;
}

export function recordDeletedProjectId(projectId: string): boolean {
  deletedProjectIdsMemorySet.add(projectId);
  if (typeof window === 'undefined') return false;

  const set = getDeletedProjectIds();
  set.add(projectId);
  const serialized = JSON.stringify(Array.from(set).slice(-200));

  try {
    window.sessionStorage?.setItem(LOCAL_STORAGE_DELETED_IDS_KEY, serialized);
  } catch {
    // Ignore sessionStorage error
  }

  if (!window.localStorage) return false;

  try {
    window.localStorage.setItem(LOCAL_STORAGE_DELETED_IDS_KEY, serialized);
    return true;
  } catch {
    // LocalStorage is at quota: compact non-authoritative localStorage cache so the small deletion tombstone can be durably persisted
    try {
      window.localStorage.removeItem(LOCAL_STORAGE_BACKUP_V2_KEY);
      window.localStorage.setItem(LOCAL_STORAGE_DELETED_IDS_KEY, serialized);
      return true;
    } catch {
      // Continue compaction
    }

    try {
      const rawProjects = window.localStorage.getItem(LOCAL_STORAGE_PROJECTS_KEY);
      if (rawProjects) {
        const parsed = JSON.parse(rawProjects) as Record<string, CreativeProject>;
        delete parsed[projectId];
        const compacted: Record<string, CreativeProject> = {};
        for (const [id, proj] of Object.entries(parsed)) {
          if (proj && typeof proj === 'object') {
            compacted[id] = {
              ...proj,
              artifacts: [],
              revisions: Array.isArray(proj.revisions) ? proj.revisions.slice(0, 1) : [],
              undoHistory: undefined,
            };
          }
        }
        try {
          window.localStorage.setItem(LOCAL_STORAGE_PROJECTS_KEY, JSON.stringify(compacted));
          window.localStorage.setItem(LOCAL_STORAGE_DELETED_IDS_KEY, serialized);
          return true;
        } catch {
          // If even compacted cache exceeds localStorage quota and IndexedDB is available, evict the non-authoritative cache key to guarantee tombstone durability
          const hasIdb = 'indexedDB' in window && Boolean(window.indexedDB);
          if (hasIdb) {
            window.localStorage.removeItem(LOCAL_STORAGE_PROJECTS_KEY);
            window.localStorage.setItem(LOCAL_STORAGE_DELETED_IDS_KEY, serialized);
            return true;
          }
        }
      }
    } catch {
      // In-memory and sessionStorage tombstones remain active
    }
    return false;
  }
}

export function clearDeletedProjectId(projectId: string): void {
  deletedProjectIdsMemorySet.delete(projectId);
  if (typeof window === 'undefined') return;
  for (const storage of [window.localStorage, window.sessionStorage]) {
    if (!storage) continue;
    try {
      const raw = storage.getItem(LOCAL_STORAGE_DELETED_IDS_KEY);
      const parsed = raw ? (JSON.parse(raw) as unknown) : [];
      const list = Array.isArray(parsed)
        ? parsed.filter((id): id is string => typeof id === 'string' && id !== projectId)
        : [];
      storage.setItem(LOCAL_STORAGE_DELETED_IDS_KEY, JSON.stringify(list));
    } catch {
      // Ignore storage error
    }
  }
}

export function simulateBrowserProcessRestartForTesting(): void {
  deletedProjectIdsMemorySet.clear();
  if (typeof window !== 'undefined' && window.sessionStorage) {
    try {
      window.sessionStorage.removeItem(LOCAL_STORAGE_DELETED_IDS_KEY);
    } catch {
      // Ignore sessionStorage error
    }
  }
}

function evaluateCasConflict(params: {
  existing: CreativeProject | undefined;
  candidate: CreativeProject;
  rawExpected?: number;
  forceOverwrite: boolean;
  storeLabel: 'localStorage' | 'IndexedDB';
}): StorageSaveResult | null {
  const { existing, candidate, rawExpected, forceOverwrite, storeLabel } = params;
  if (forceOverwrite || !existing) return null;

  const existingRev = typeof existing.revision === 'number' ? existing.revision : 1;
  const candidateRev = typeof candidate.revision === 'number' ? candidate.revision : 1;
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
    return null;
  }

  const baseRev = rawExpected !== undefined ? rawExpected : candidate.persistedRevision;

  if (baseRev !== undefined && existingRev > baseRev) {
    return {
      ok: false,
      saved: false,
      conflictDetected: true,
      storedProject: migrateProjectPayload(existing),
      error:
        storeLabel === 'IndexedDB'
          ? `IndexedDB has a newer revision (r${existingRev}) than expected base r${baseRev}.`
          : `Storage conflict detected: another tab saved revision r${existingRev} while this tab was based on r${baseRev}.`,
    };
  }

  if (candidateRev < existingRev) {
    return {
      ok: false,
      saved: false,
      conflictDetected: true,
      storedProject: migrateProjectPayload(existing),
      error: `Storage conflict detected: ${storeLabel} holds revision r${existingRev}, which is newer than candidate r${candidateRev}.`,
    };
  }

  if (
    baseRev !== undefined &&
    existingRev === baseRev &&
    candidateRev === baseRev
  ) {
    if (!isSnapshotSemanticallyEqual(existing.snapshot, candidate.snapshot)) {
      return {
        ok: false,
        saved: false,
        conflictDetected: true,
        storedProject: migrateProjectPayload(existing),
        error: `Storage conflict detected: ${storeLabel} already holds revision r${existingRev} with a divergent snapshot.`,
      };
    }
    if (existing.updatedAt > candidate.updatedAt) {
      return {
        ok: false,
        saved: false,
        conflictDetected: true,
        storedProject: migrateProjectPayload(existing),
        error: 'A newer version of this project was saved in another browser tab.',
      };
    }
  }

  return null;
}

export function saveProjectToLocalStorage(
  project: CreativeProject,
  expectedBaseRevisionOrOptions?:
    | number
    | { expectedPersistedRevision?: number; forceOverwrite?: boolean; allowDeleted?: boolean },
  options?: { forceOverwrite?: boolean; allowDeleted?: boolean }
): StorageSaveResult {
  if (typeof window === 'undefined' || !window.localStorage) {
    return { ok: false, saved: false, error: 'Browser localStorage is unavailable.' };
  }

  const normalizedForce =
    typeof expectedBaseRevisionOrOptions === 'object' && expectedBaseRevisionOrOptions !== null
      ? Boolean(expectedBaseRevisionOrOptions.forceOverwrite)
      : Boolean(options?.forceOverwrite);

  const allowDeleted =
    typeof expectedBaseRevisionOrOptions === 'object' && expectedBaseRevisionOrOptions !== null
      ? Boolean(expectedBaseRevisionOrOptions.allowDeleted)
      : Boolean(options?.allowDeleted);

  if (allowDeleted) {
    clearDeletedProjectId(project.id);
  } else if (getDeletedProjectIds().has(project.id)) {
    return {
      ok: false,
      saved: false,
      error: `Project "${project.id}" was deleted and cannot be resurrected by an in-flight save.`,
    };
  }

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

    const casConflict = evaluateCasConflict({
      existing,
      candidate: project,
      rawExpected,
      forceOverwrite: normalizedForce,
      storeLabel: 'localStorage',
    });
    if (casConflict) {
      return casConflict;
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
      const isQuota =
        (quotaErr instanceof Error &&
          (quotaErr.name === 'QuotaExceededError' || /quota/i.test(quotaErr.message))) ||
        false;
      // Never silently delete or strip user media on quota errors (AC15, F12).
      return {
        ok: false,
        saved: false,
        quotaExceeded: isQuota,
        persistedRevision: project.persistedRevision,
        error:
          quotaErr instanceof Error && quotaErr.message
            ? isQuota
              ? `Browser localStorage quota exceeded (${quotaErr.message}). Full project media remains intact in memory and IndexedDB. Export JSON or remove older image outputs to free space.`
              : quotaErr.message
            : 'Browser localStorage write failed.',
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

export function loadProjectsFromLocalStorage(options?: {
  skipAutoSeedIfEmpty?: boolean;
}): {
  projects: CreativeProject[];
  activeProjectId: string | null;
} {
  if (typeof window === 'undefined' || !window.localStorage) {
    deletedProjectIdsMemorySet.clear();
    if (options?.skipAutoSeedIfEmpty) {
      return { projects: [], activeProjectId: null };
    }
    const sample = createSampleProject();
    return { projects: [sample], activeProjectId: sample.id };
  }

  try {
    const rawDeleted = window.localStorage.getItem(LOCAL_STORAGE_DELETED_IDS_KEY);
    const raw = window.localStorage.getItem(LOCAL_STORAGE_PROJECTS_KEY);
    const activeId = window.localStorage.getItem(LOCAL_STORAGE_ACTIVE_ID_KEY);
    if (!rawDeleted && !raw && !activeId) {
      deletedProjectIdsMemorySet.clear();
    }
    const deletedIds = getDeletedProjectIds();
    if (!raw) {
      if (options?.skipAutoSeedIfEmpty) {
        return { projects: [], activeProjectId: activeId };
      }
      const sample = createSampleProject();
      saveProjectToLocalStorage(sample, undefined, { forceOverwrite: true, allowDeleted: true });
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
        const migrated = migrateProjectPayload(val);
        if (!deletedIds.has(migrated.id)) {
          projects.push(migrated);
        }
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
      if (options?.skipAutoSeedIfEmpty) {
        return { projects: [], activeProjectId: activeId };
      }
      const sample = createSampleProject();
      saveProjectToLocalStorage(sample, undefined, { forceOverwrite: true, allowDeleted: true });
      return { projects: [sample], activeProjectId: sample.id };
    }

    projects.sort((a, b) => b.updatedAt - a.updatedAt);
    const resolvedActiveId =
      activeId && projects.some((p) => p.id === activeId) ? activeId : projects[0].id;
    return { projects, activeProjectId: resolvedActiveId };
  } catch {
    if (options?.skipAutoSeedIfEmpty) {
      return { projects: [], activeProjectId: null };
    }
    const sample = createSampleProject();
    return { projects: [sample], activeProjectId: sample.id };
  }
}

export function deleteProjectFromLocalStorage(projectId: string): CreativeProject[] {
  deletedProjectIdsMemorySet.add(projectId);
  if (typeof window === 'undefined' || !window.localStorage) return [];
  try {
    const raw = window.localStorage.getItem(LOCAL_STORAGE_PROJECTS_KEY);
    if (!raw) {
      recordDeletedProjectId(projectId);
      return [];
    }
    const map = JSON.parse(raw) as Record<string, CreativeProject>;
    delete map[projectId];
    // Write the smaller projects map first so freeing space allows tombstone persistence even near quota
    try {
      window.localStorage.setItem(LOCAL_STORAGE_PROJECTS_KEY, JSON.stringify(map));
    } catch {
      // Quota compaction handled in recordDeletedProjectId below
    }
    recordDeletedProjectId(projectId);

    const deletedIds = getDeletedProjectIds();
    const remaining = Object.values(map)
      .map((p) => migrateProjectPayload(p))
      .filter((p) => !deletedIds.has(p.id));
    if (remaining.length === 0) {
      const sample = createSampleProject();
      clearDeletedProjectId(sample.id);
      map[sample.id] = sample;
      try {
        window.localStorage.setItem(LOCAL_STORAGE_PROJECTS_KEY, JSON.stringify(map));
        window.localStorage.setItem(LOCAL_STORAGE_ACTIVE_ID_KEY, sample.id);
      } catch {
        // Ignore quota error on fallback sample write
      }
      return [sample];
    }
    const sorted = remaining.sort((a, b) => b.updatedAt - a.updatedAt);
    const currentActiveId = window.localStorage.getItem(LOCAL_STORAGE_ACTIVE_ID_KEY);
    if (currentActiveId === projectId) {
      try {
        window.localStorage.setItem(LOCAL_STORAGE_ACTIVE_ID_KEY, sorted[0].id);
      } catch {
        // Ignore quota error on active ID update
      }
    }
    return sorted;
  } catch {
    recordDeletedProjectId(projectId);
    return [];
  }
}

export async function deleteProjectFromIndexedDb(
  projectId: string
): Promise<{ ok: boolean; error?: string }> {
  recordDeletedProjectId(projectId);
  if (typeof window === 'undefined' || !('indexedDB' in window) || !window.indexedDB) {
    return { ok: false, error: 'IndexedDB is unavailable in this environment.' };
  }

  return new Promise((resolve) => {
    let settled = false;
    const finish = (result: { ok: boolean; error?: string }) => {
      if (settled) return;
      settled = true;
      resolve(result);
    };

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
        try {
          const tx = db.transaction(IDB_STORE, 'readwrite');
          const store = tx.objectStore(IDB_STORE);
          const delReq = store.delete(projectId);
          delReq.onerror = () => {
            const errMsg =
              delReq.error?.message ?? tx.error?.message ?? 'IndexedDB delete request failed.';
            try {
              db.close();
            } catch {
              // Ignore close error
            }
            finish({ ok: false, error: errMsg });
          };
          tx.oncomplete = () => {
            try {
              db.close();
            } catch {
              // Ignore close error
            }
            finish({ ok: true });
          };
          tx.onerror = () => {
            const errMsg = tx.error?.message ?? 'IndexedDB delete transaction failed.';
            try {
              db.close();
            } catch {
              // Ignore close error
            }
            finish({ ok: false, error: errMsg });
          };
          tx.onabort = () => {
            const errMsg = tx.error?.message ?? 'IndexedDB delete transaction aborted.';
            try {
              db.close();
            } catch {
              // Ignore close error
            }
            finish({ ok: false, error: errMsg });
          };
        } catch (txErr) {
          try {
            db.close();
          } catch {
            // Ignore close error
          }
          finish({
            ok: false,
            error: txErr instanceof Error ? txErr.message : 'IndexedDB transaction setup failed.',
          });
        }
      };
      req.onerror = () =>
        finish({
          ok: false,
          error: req.error?.message ?? 'Failed to open IndexedDB for deletion.',
        });
    } catch (err) {
      finish({
        ok: false,
        error: err instanceof Error ? err.message : 'IndexedDB delete exception.',
      });
    }
  });
}

/**
 * Deletes a project from both localStorage and IndexedDB and records a deletion tombstone
 * so neither hydration nor in-flight autosave timers can resurrect it (F-06).
 */
export async function deleteProjectCompletely(projectId: string): Promise<{
  remaining: CreativeProject[];
  idbDeleted: boolean;
  tombstonePersisted?: boolean;
  error?: string;
}> {
  const remaining = deleteProjectFromLocalStorage(projectId);
  const tombstonePersisted = recordDeletedProjectId(projectId);
  const idbRes = await deleteProjectFromIndexedDb(projectId);
  // Never force-overwrite a surviving project's IndexedDB record with a potentially
  // older localStorage copy. The active-project autosave will persist any newly
  // created replacement sample through normal revision-aware persistence.
  // Deleting project A must not modify project B's durable data.
  return {
    remaining,
    idbDeleted: idbRes.ok,
    tombstonePersisted,
    error: idbRes.error,
  };
}

export async function saveProjectToIndexedDb(
  project: CreativeProject,
  expectedBaseRevisionOrOptions?:
    | number
    | { expectedPersistedRevision?: number; forceOverwrite?: boolean; allowDeleted?: boolean },
  options?: { forceOverwrite?: boolean; allowDeleted?: boolean }
): Promise<StorageSaveResult> {
  if (typeof window === 'undefined' || !('indexedDB' in window) || !window.indexedDB) {
    return { ok: false, saved: false, error: 'IndexedDB is unavailable in this environment.' };
  }
  const normalizedForce =
    typeof expectedBaseRevisionOrOptions === 'object' && expectedBaseRevisionOrOptions !== null
      ? Boolean(expectedBaseRevisionOrOptions.forceOverwrite)
      : Boolean(options?.forceOverwrite);
  const allowDeleted =
    typeof expectedBaseRevisionOrOptions === 'object' && expectedBaseRevisionOrOptions !== null
      ? Boolean(expectedBaseRevisionOrOptions.allowDeleted)
      : Boolean(options?.allowDeleted);

  if (allowDeleted) {
    clearDeletedProjectId(project.id);
  } else if (getDeletedProjectIds().has(project.id)) {
    return {
      ok: false,
      saved: false,
      error: `Project "${project.id}" was deleted and cannot be written to IndexedDB.`,
    };
  }

  const rawExpected =
    typeof expectedBaseRevisionOrOptions === 'number'
      ? expectedBaseRevisionOrOptions
      : expectedBaseRevisionOrOptions?.expectedPersistedRevision;

  return new Promise((resolve) => {
    let settled = false;
    const finish = (result: StorageSaveResult) => {
      if (settled) return;
      settled = true;
      resolve(result);
    };

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
        if (!allowDeleted && getDeletedProjectIds().has(project.id)) {
          try {
            db.close();
          } catch {
            // Ignore close error
          }
          finish({
            ok: false,
            saved: false,
            error: `Project "${project.id}" was deleted while opening IndexedDB.`,
          });
          return;
        }

        try {
          const tx = db.transaction(IDB_STORE, 'readwrite');
          const store = tx.objectStore(IDB_STORE);
          const getReq = store.get(project.id);

          getReq.onsuccess = () => {
            // Guard against delayed saves resurrecting a project deleted while `get` was in flight
            if (!allowDeleted && getDeletedProjectIds().has(project.id)) {
              try {
                tx.abort();
              } catch {
                // Ignore abort error
              }
              try {
                db.close();
              } catch {
                // Ignore close error
              }
              finish({
                ok: false,
                saved: false,
                error: `Project "${project.id}" was deleted before IndexedDB write could commit.`,
              });
              return;
            }

            const existing = getReq.result as CreativeProject | undefined;
            const casConflict = evaluateCasConflict({
              existing,
              candidate: project,
              rawExpected,
              forceOverwrite: normalizedForce,
              storeLabel: 'IndexedDB',
            });

            if (casConflict) {
              try {
                tx.abort();
              } catch {
                // Ignore abort error
              }
              try {
                db.close();
              } catch {
                // Ignore close error
              }
              finish(casConflict);
              return;
            }

            const nextRev = project.revision ?? 1;
            const putReq = store.put({
              ...project,
              schemaVersion: CURRENT_SCHEMA_VERSION,
              revision: nextRev,
              persistedRevision: nextRev,
            });
            putReq.onerror = () => {
              const errObj = putReq.error ?? tx.error;
              const errMsg = errObj?.message ?? 'IndexedDB put request failed.';
              const isQuota =
                errObj?.name === 'QuotaExceededError' || /quota/i.test(errMsg);
              try {
                db.close();
              } catch {
                // Ignore close error
              }
              finish({
                ok: false,
                saved: false,
                quotaExceeded: isQuota,
                persistedRevision: project.persistedRevision,
                error: errMsg,
              });
            };
          };

          getReq.onerror = () => {
            const errMsg =
              getReq.error?.message ?? tx.error?.message ?? 'IndexedDB read before write failed.';
            try {
              db.close();
            } catch {
              // Ignore close error
            }
            finish({ ok: false, saved: false, error: errMsg });
          };

          tx.oncomplete = () => {
            try {
              db.close();
            } catch {
              // Ignore close error
            }
            if (!allowDeleted && getDeletedProjectIds().has(project.id)) {
              void deleteProjectFromIndexedDb(project.id);
              finish({
                ok: false,
                saved: false,
                error: `Project "${project.id}" was deleted concurrently; rolled back IndexedDB write.`,
              });
              return;
            }
            finish({ ok: true, saved: true, persistedRevision: project.revision ?? 1 });
          };

          tx.onerror = () => {
            const errObj = tx.error;
            const errMsg = errObj?.message ?? 'IndexedDB transaction failed.';
            const isQuota =
              errObj?.name === 'QuotaExceededError' || /quota/i.test(errMsg);
            try {
              db.close();
            } catch {
              // Ignore close error
            }
            finish({
              ok: false,
              saved: false,
              quotaExceeded: isQuota,
              persistedRevision: project.persistedRevision,
              error: errMsg,
            });
          };

          tx.onabort = () => {
            const errObj = tx.error;
            const errMsg = errObj?.message ?? 'IndexedDB transaction aborted.';
            const isQuota =
              errObj?.name === 'QuotaExceededError' || /quota/i.test(errMsg);
            try {
              db.close();
            } catch {
              // Ignore close error
            }
            finish({
              ok: false,
              saved: false,
              quotaExceeded: isQuota,
              persistedRevision: project.persistedRevision,
              error: errMsg,
            });
          };
        } catch (txErr) {
          try {
            db.close();
          } catch {
            // Ignore close error
          }
          finish({
            ok: false,
            saved: false,
            error: txErr instanceof Error ? txErr.message : 'IndexedDB transaction exception.',
          });
        }
      };
      req.onerror = () =>
        finish({ ok: false, saved: false, error: req.error?.message ?? 'Failed to open IndexedDB.' });
    } catch (err) {
      finish({
        ok: false,
        saved: false,
        error: err instanceof Error ? err.message : 'IndexedDB exception.',
      });
    }
  });
}

/**
 * Persists a project with revision-based Compare-And-Swap (CAS) protection.
 * Persistence contract:
 * - When IndexedDB is available, IndexedDB is the single authoritative durable store (holding full snapshots,
 *   revision history, Undo/Redo history, and media artifacts) using an atomic read-check-put IndexedDB transaction.
 * - localStorage is treated strictly as a non-authoritative fast-hydration cache and legacy compatibility layer.
 * - A localStorage cache failure or stale localStorage entry never invalidates an already-committed IndexedDB write;
 *   instead, `saved: true` is returned alongside `cacheSynced: false` and `cacheWarning`.
 * - When IndexedDB is unavailable in the environment, falls back to localStorage as the durable store.
 */
export async function persistProjectDurably(
  project: CreativeProject,
  expectedBaseRevisionOrOptions?:
    | number
    | { expectedPersistedRevision?: number; forceOverwrite?: boolean; allowDeleted?: boolean },
  options?: { forceOverwrite?: boolean; allowDeleted?: boolean }
): Promise<StorageSaveResult> {
  const normalizedForce =
    typeof expectedBaseRevisionOrOptions === 'object' && expectedBaseRevisionOrOptions !== null
      ? Boolean(expectedBaseRevisionOrOptions.forceOverwrite)
      : Boolean(options?.forceOverwrite);
  const allowDeleted =
    typeof expectedBaseRevisionOrOptions === 'object' && expectedBaseRevisionOrOptions !== null
      ? Boolean(expectedBaseRevisionOrOptions.allowDeleted)
      : Boolean(options?.allowDeleted);
  const rawExpected =
    typeof expectedBaseRevisionOrOptions === 'number'
      ? expectedBaseRevisionOrOptions
      : expectedBaseRevisionOrOptions?.expectedPersistedRevision;

  if (allowDeleted) {
    clearDeletedProjectId(project.id);
  } else if (getDeletedProjectIds().has(project.id)) {
    return {
      ok: false,
      saved: false,
      error: `Project "${project.id}" was deleted and cannot be resurrected by an in-flight save.`,
    };
  }

  const hasLocalStorage =
    typeof window !== 'undefined' && Boolean(window.localStorage);
  const hasIndexedDb =
    typeof window !== 'undefined' && 'indexedDB' in window && Boolean(window.indexedDB);

  if (hasIndexedDb) {
    const idbRes = await saveProjectToIndexedDb(project, {
      expectedPersistedRevision: rawExpected,
      forceOverwrite: normalizedForce,
      allowDeleted,
    });

    if (!idbRes.saved) {
      return {
        ...idbRes,
        authoritativeStore: 'indexeddb',
        idbSaved: false,
      };
    }

    if (!allowDeleted && getDeletedProjectIds().has(project.id)) {
      await deleteProjectFromIndexedDb(project.id);
      return {
        ok: false,
        saved: false,
        authoritativeStore: 'indexeddb',
        idbSaved: false,
        error: `Project "${project.id}" was deleted during persistence.`,
      };
    }

    const committedRevision = idbRes.persistedRevision ?? (project.revision ?? 1);

    if (hasLocalStorage) {
      // Synchronize non-authoritative localStorage cache with the authoritative IndexedDB state
      const localRes = saveProjectToLocalStorage(
        {
          ...project,
          revision: committedRevision,
          persistedRevision: committedRevision,
        },
        {
          forceOverwrite: true,
          allowDeleted,
        }
      );

      if (!localRes.saved) {
        return {
          ok: true,
          saved: true,
          authoritativeStore: 'indexeddb',
          idbSaved: true,
          localSaved: false,
          cacheSynced: false,
          quotaExceeded: Boolean(localRes.quotaExceeded),
          cacheWarning:
            localRes.error ??
            'Authoritative IndexedDB save succeeded, but localStorage cache synchronization failed.',
          persistedRevision: committedRevision,
          error: localRes.error,
        };
      }

      return {
        ok: true,
        saved: true,
        authoritativeStore: 'indexeddb',
        idbSaved: true,
        localSaved: true,
        cacheSynced: true,
        persistedRevision: committedRevision,
      };
    }

    return {
      ok: true,
      saved: true,
      authoritativeStore: 'indexeddb',
      idbSaved: true,
      localSaved: false,
      cacheSynced: false,
      persistedRevision: committedRevision,
    };
  }

  const fallbackRes = saveProjectToLocalStorage(project, {
    expectedPersistedRevision: rawExpected,
    forceOverwrite: normalizedForce,
    allowDeleted,
  });
  return {
    ...fallbackRes,
    authoritativeStore: 'localstorage',
    idbSaved: false,
    localSaved: Boolean(fallbackRes.saved),
    cacheSynced: Boolean(fallbackRes.saved),
  };
}

/**
 * Loads projects from IndexedDB with explicit status differentiation so callers can distinguish:
 * - `'ok'`: 1 or more valid records loaded
 * - `'empty'`: database opened and read cleanly, 0 non-deleted valid records exist
 * - `'unavailable'`: IndexedDB API is not supported/present in this environment
 * - `'read_error'`: IndexedDB open, transaction, or getAll request failed (must NEVER be treated as empty storage)
 */
export async function loadProjectsFromIndexedDbDetailed(): Promise<IndexedDbLoadResult> {
  if (typeof window === 'undefined' || !('indexedDB' in window) || !window.indexedDB) {
    return {
      ok: false,
      status: 'unavailable',
      projects: [],
      corruptRecordCount: 0,
      corruptRecordErrors: [],
      error: 'IndexedDB is unavailable in this environment.',
    };
  }
  const deletedIds = getDeletedProjectIds();
  return new Promise((resolve) => {
    let settled = false;
    const finish = (res: IndexedDbLoadResult) => {
      if (settled) return;
      settled = true;
      resolve(res);
    };

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
        try {
          const tx = db.transaction(IDB_STORE, 'readonly');
          const store = tx.objectStore(IDB_STORE);
          const allReq = store.getAll();
          allReq.onsuccess = () => {
            const rawList = Array.isArray(allReq.result) ? allReq.result : [];
            const migrated: CreativeProject[] = [];
            let corruptRecordCount = 0;
            const corruptRecordErrors: string[] = [];

            for (const item of rawList) {
              try {
                const p = migrateProjectPayload(item);
                if (!deletedIds.has(p.id)) {
                  migrated.push(p);
                }
              } catch (migErr) {
                corruptRecordCount += 1;
                corruptRecordErrors.push(
                  migErr instanceof Error ? migErr.message : 'Corrupt or unsupported project record.'
                );
              }
            }
            try {
              db.close();
            } catch {
              // Ignore close error
            }
            const sorted = migrated.sort((a, b) => b.updatedAt - a.updatedAt);
            finish({
              ok: true,
              status: sorted.length > 0 ? 'ok' : 'empty',
              projects: sorted,
              corruptRecordCount,
              corruptRecordErrors,
            });
          };
          allReq.onerror = () => {
            const errMsg =
              allReq.error?.message ?? tx.error?.message ?? 'IndexedDB getAll read failed.';
            try {
              db.close();
            } catch {
              // Ignore close error
            }
            finish({
              ok: false,
              status: 'read_error',
              projects: [],
              corruptRecordCount: 0,
              corruptRecordErrors: [],
              error: errMsg,
            });
          };
          tx.onerror = () => {
            const errMsg = tx.error?.message ?? 'IndexedDB read transaction failed.';
            try {
              db.close();
            } catch {
              // Ignore close error
            }
            finish({
              ok: false,
              status: 'read_error',
              projects: [],
              corruptRecordCount: 0,
              corruptRecordErrors: [],
              error: errMsg,
            });
          };
          tx.onabort = () => {
            const errMsg = tx.error?.message ?? 'IndexedDB read transaction aborted.';
            try {
              db.close();
            } catch {
              // Ignore close error
            }
            finish({
              ok: false,
              status: 'read_error',
              projects: [],
              corruptRecordCount: 0,
              corruptRecordErrors: [],
              error: errMsg,
            });
          };
        } catch (txErr) {
          try {
            db.close();
          } catch {
            // Ignore close error
          }
          finish({
            ok: false,
            status: 'read_error',
            projects: [],
            corruptRecordCount: 0,
            corruptRecordErrors: [],
            error: txErr instanceof Error ? txErr.message : 'IndexedDB read transaction exception.',
          });
        }
      };
      req.onerror = () =>
        finish({
          ok: false,
          status: 'read_error',
          projects: [],
          corruptRecordCount: 0,
          corruptRecordErrors: [],
          error: req.error?.message ?? 'Failed to open IndexedDB for reading.',
        });
    } catch (err) {
      finish({
        ok: false,
        status: 'read_error',
        projects: [],
        corruptRecordCount: 0,
        corruptRecordErrors: [],
        error: err instanceof Error ? err.message : 'IndexedDB read exception.',
      });
    }
  });
}

export async function loadProjectsFromIndexedDb(): Promise<CreativeProject[]> {
  const res = await loadProjectsFromIndexedDbDetailed();
  return res.projects;
}

function isAutoSeededUntouchedSample(project: CreativeProject): boolean {
  return (
    project.id === 'proj_default_cat_party' &&
    (project.revision ?? 1) === 1 &&
    project.revisions.length <= 1 &&
    project.artifacts.length === 0
  );
}

function hasRevisionLineage(newer: CreativeProject, older: CreativeProject): boolean {
  const olderRev = older.revision ?? 1;
  if (olderRev <= 1 && older.revisions.length <= 1) {
    return true;
  }
  const olderHeadId = older.revisions[0]?.id;
  if (olderHeadId && newer.revisions.some((r) => r.id === olderHeadId)) {
    return true;
  }
  return newer.revisions.some(
    (r) =>
      r.revisionNumber === olderRev &&
      isSnapshotSemanticallyEqual(r.snapshot, older.snapshot)
  );
}

/**
 * Reconciles initial localStorage projects with asynchronous IndexedDB hydration (F-02, IA-04, IA-05).
 * Ensures that when IndexedDB holds a newer revision (e.g. r6 after a localStorage quota failure on r5),
 * the COMPLETE project (snapshot, revision, persistedRevision, revisions, artifacts, and undoState)
 * is recovered atomically without splicing old snapshots with newer artifacts.
 * Also detects and surfaces hydration conflicts rather than silently ignoring them.
 */
export function reconcileHydratedProjects(params: {
  localProjects: CreativeProject[];
  idbProjects: CreativeProject[];
  activeProject: CreativeProject;
  activeUndoState: UndoRedoState;
  hasLocalEditsSinceMount?: boolean;
  deletedProjectIds?: Iterable<string>;
  ignoreDivergenceConflict?: boolean;
}): {
  savedProjects: CreativeProject[];
  activeProject: CreativeProject;
  activeUndoState: UndoRedoState;
  upgradedFromIndexedDb: boolean;
  conflictWithHydrated: CreativeProject | null;
} {
  const {
    localProjects,
    idbProjects,
    activeProject,
    activeUndoState,
    hasLocalEditsSinceMount = false,
    deletedProjectIds,
    ignoreDivergenceConflict = false,
  } = params;

  const deletedSet = new Set<string>(deletedProjectIds ?? getDeletedProjectIds());
  const validLocal = localProjects.filter((p) => !deletedSet.has(p.id));
  const validIdb = idbProjects.filter((p) => !deletedSet.has(p.id));

  if (validIdb.length === 0) {
    const reconstructedUndo =
      activeUndoState.past.length === 0 &&
      activeUndoState.future.length === 0 &&
      (activeProject.revisions.length > 1 || Boolean(activeProject.undoHistory))
        ? createUndoRedoState(
            activeProject.snapshot,
            activeProject.revisions,
            activeProject.undoHistory
          )
        : activeUndoState;
    return {
      savedProjects: validLocal,
      activeProject,
      activeUndoState: reconstructedUndo,
      upgradedFromIndexedDb: false,
      conflictWithHydrated: null,
    };
  }

  // If localStorage only had an auto-seeded untouched sample because localStorage was empty/cleared,
  // while IndexedDB holds real user projects, do not let the fresh sample eclipse the user's IndexedDB project.
  const localWasOnlyAutoSample =
    !hasLocalEditsSinceMount &&
    validLocal.length === 1 &&
    isAutoSeededUntouchedSample(validLocal[0]) &&
    !validIdb.some((ip) => ip.id === validLocal[0].id);

  const mergedById = new Map<string, CreativeProject>();
  if (!localWasOnlyAutoSample) {
    for (const lp of validLocal) {
      mergedById.set(lp.id, lp);
    }
  }

  const divergenceConflictsById = new Map<string, CreativeProject>();

  for (const ip of validIdb) {
    const normalizedIp: CreativeProject = {
      ...ip,
      persistedRevision: ip.persistedRevision ?? ip.revision,
    };
    const lp = mergedById.get(ip.id);
    if (!lp) {
      mergedById.set(ip.id, normalizedIp);
      continue;
    }

    const idbRev = ip.revision ?? 1;
    const localRev = lp.revision ?? 1;

    if (idbRev > localRev) {
      if (!ignoreDivergenceConflict && !hasRevisionLineage(ip, lp)) {
        divergenceConflictsById.set(ip.id, normalizedIp);
      } else {
        // IndexedDB has a strictly newer revision on the same lineage: adopt the ENTIRE IndexedDB project atomically
        mergedById.set(ip.id, normalizedIp);
      }
    } else if (idbRev === localRev) {
      const sameSnapshot = isSnapshotSemanticallyEqual(lp.snapshot, ip.snapshot);
      if (!sameSnapshot && !ignoreDivergenceConflict) {
        // Divergent creative decisions at the same revision: preserve local in mergedById and surface IDB as conflict
        divergenceConflictsById.set(ip.id, normalizedIp);
      } else {
        // Choose a single complete winning record without splicing snapshots and revisions across stores
        const preferIdb =
          ip.artifacts.length > lp.artifacts.length ||
          ip.revisions.length > lp.revisions.length ||
          Boolean(ip.undoHistory && !lp.undoHistory) ||
          ip.updatedAt >= lp.updatedAt;
        const winner = preferIdb ? normalizedIp : lp;
        mergedById.set(ip.id, {
          ...winner,
          undoHistory: winner.undoHistory ?? ip.undoHistory ?? lp.undoHistory,
          persistedRevision: Math.max(
            ip.persistedRevision ?? idbRev,
            lp.persistedRevision ?? localRev
          ),
        });
      }
    } else {
      // localRev > idbRev: adopt the complete localStorage project without splicing old IDB artifacts
      if (!ignoreDivergenceConflict && !hasRevisionLineage(lp, ip)) {
        divergenceConflictsById.set(lp.id, normalizedIp);
      }
      mergedById.set(lp.id, {
        ...lp,
        persistedRevision: Math.max(
          lp.persistedRevision ?? localRev,
          ip.persistedRevision ?? idbRev
        ),
      });
    }
  }

  const savedProjects = Array.from(mergedById.values()).sort(
    (a, b) => b.updatedAt - a.updatedAt
  );

  const idbMatch = validIdb.find((ip) => ip.id === activeProject.id);
  const localMatch = validLocal.find((lp) => lp.id === activeProject.id);
  const reconciledActiveCandidate = mergedById.get(activeProject.id);

  if (!reconciledActiveCandidate) {
    const fallback = savedProjects[0] ?? activeProject;
    return {
      savedProjects,
      activeProject: fallback,
      activeUndoState: createUndoRedoState(
        fallback.snapshot,
        fallback.revisions,
        fallback.undoHistory
      ),
      upgradedFromIndexedDb: true,
      conflictWithHydrated: null,
    };
  }

  const idbRev = idbMatch?.revision ?? 0;
  const activeRev = activeProject.revision ?? 1;
  const basePersistedRev = activeProject.persistedRevision ?? 1;

  // If the user already edited the active project in memory since mount and IDB had a newer or divergent revision
  if (hasLocalEditsSinceMount) {
    const idbDivergedFromBase =
      Boolean(idbMatch) &&
      (idbRev > basePersistedRev ||
        (idbRev === basePersistedRev &&
          localMatch !== undefined &&
          !isSnapshotSemanticallyEqual(idbMatch!.snapshot, localMatch.snapshot)));

    if (idbDivergedFromBase && idbMatch) {
      return {
        savedProjects,
        activeProject,
        activeUndoState,
        upgradedFromIndexedDb: false,
        conflictWithHydrated: idbMatch,
      };
    }
    return {
      savedProjects: savedProjects.map((p) =>
        p.id === activeProject.id ? activeProject : p
      ),
      activeProject,
      activeUndoState,
      upgradedFromIndexedDb: false,
      conflictWithHydrated: null,
    };
  }

  const divergenceConflict = divergenceConflictsById.get(activeProject.id) ?? null;
  if (divergenceConflict) {
    return {
      savedProjects,
      activeProject,
      activeUndoState:
        activeUndoState.past.length === 0 &&
        activeUndoState.future.length === 0 &&
        (activeProject.revisions.length > 1 || Boolean(activeProject.undoHistory))
          ? createUndoRedoState(
              activeProject.snapshot,
              activeProject.revisions,
              activeProject.undoHistory
            )
          : activeUndoState,
      upgradedFromIndexedDb: false,
      conflictWithHydrated: divergenceConflict,
    };
  }

  const upgradedFromIndexedDb =
    Boolean(idbMatch) &&
    (idbRev > activeRev ||
      (idbRev === activeRev &&
        (idbMatch!.updatedAt > activeProject.updatedAt ||
          idbMatch!.artifacts.length > activeProject.artifacts.length ||
          idbMatch!.revisions.length > activeProject.revisions.length)));

  if (upgradedFromIndexedDb) {
    return {
      savedProjects,
      activeProject: reconciledActiveCandidate,
      activeUndoState: createUndoRedoState(
        reconciledActiveCandidate.snapshot,
        reconciledActiveCandidate.revisions,
        reconciledActiveCandidate.undoHistory
      ),
      upgradedFromIndexedDb: true,
      conflictWithHydrated: null,
    };
  }

  const finalUndoState =
    activeUndoState.past.length === 0 &&
    activeUndoState.future.length === 0 &&
    (reconciledActiveCandidate.revisions.length > 1 ||
      Boolean(reconciledActiveCandidate.undoHistory))
      ? createUndoRedoState(
          reconciledActiveCandidate.snapshot,
          reconciledActiveCandidate.revisions,
          reconciledActiveCandidate.undoHistory
        )
      : activeUndoState;

  return {
    savedProjects,
    activeProject: reconciledActiveCandidate,
    activeUndoState: finalUndoState,
    upgradedFromIndexedDb: false,
    conflictWithHydrated: null,
  };
}

/**
 * Reloads the truly latest valid projects across both IndexedDB and localStorage,
 * preserving complete snapshots, revisions, Undo/Redo history (including Redo future stack), and media artifacts.
 *
 * Non-destructive conflict & error contract (FIX 1 & FIX 2):
 * - If IndexedDB fails to read (`idbStatus === 'read_error'`), never overwrites IndexedDB or seeds sample data over it.
 * - If localStorage and IndexedDB hold divergent snapshots at the same revision or divergent lineages,
 *   does NOT silently overwrite the losing branch unless `options.resolution` is explicitly provided;
 *   returns `conflictDetected: true` with both `activeProject` (local) and `conflictProject` (IndexedDB) preserved.
 * - Verifies persistence results before reporting `persisted: true`.
 */
export async function reloadLatestProjectsFromStorage(
  preferredActiveProjectId?: string | null,
  options?: {
    resolution?: 'prefer-idb' | 'prefer-local';
  }
): Promise<{
  projects: CreativeProject[];
  activeProject: CreativeProject;
  activeUndoState: UndoRedoState;
  upgradedFromIndexedDb: boolean;
  idbStatus: IndexedDbLoadStatus;
  idbError?: string;
  corruptRecordCount?: number;
  conflictDetected?: boolean;
  conflictProject?: CreativeProject | null;
  alternateProject?: CreativeProject | null;
  persisted?: boolean;
  persistenceWarning?: string;
}> {
  const localData = loadProjectsFromLocalStorage({ skipAutoSeedIfEmpty: true });
  const idbLoad = await loadProjectsFromIndexedDbDetailed();
  const idbProjects = idbLoad.projects;
  const targetId = preferredActiveProjectId ?? localData.activeProjectId;

  // FIX 1: On IndexedDB read failure, never seed or overwrite IndexedDB
  if (idbLoad.status === 'read_error') {
    const fallbackProjects =
      localData.projects.length > 0 ? localData.projects : [createSampleProject()];
    const activeFallback =
      fallbackProjects.find((p) => p.id === targetId) ?? fallbackProjects[0];
    return {
      projects: fallbackProjects,
      activeProject: activeFallback,
      activeUndoState: createUndoRedoState(
        activeFallback.snapshot,
        activeFallback.revisions,
        activeFallback.undoHistory
      ),
      upgradedFromIndexedDb: false,
      idbStatus: 'read_error',
      idbError: idbLoad.error,
      corruptRecordCount: idbLoad.corruptRecordCount,
      conflictDetected: false,
      conflictProject: null,
      persisted: false,
      persistenceWarning: idbLoad.error,
    };
  }

  let initialCandidate =
    localData.projects.find((p) => p.id === targetId) ??
    idbProjects.find((p) => p.id === targetId) ??
    localData.projects[0] ??
    idbProjects[0];

  if (!initialCandidate) {
    initialCandidate = createSampleProject();
    saveProjectToLocalStorage(initialCandidate, undefined, {
      forceOverwrite: true,
      allowDeleted: true,
    });
  }

  const reconciled = reconcileHydratedProjects({
    localProjects: localData.projects.length > 0 ? localData.projects : [initialCandidate],
    idbProjects,
    activeProject: initialCandidate,
    activeUndoState: createUndoRedoState(
      initialCandidate.snapshot,
      initialCandidate.revisions,
      initialCandidate.undoHistory
    ),
    hasLocalEditsSinceMount: false,
    ignoreDivergenceConflict: Boolean(options?.resolution),
  });

  const localMatch = localData.projects.find((p) => p.id === reconciled.activeProject.id);
  const idbMatch = idbProjects.find((p) => p.id === reconciled.activeProject.id);

  // FIX 2: If a semantic divergence or lineage conflict exists and no explicit resolution was requested,
  // preserve both stores intact without destructive overwrites.
  if (reconciled.conflictWithHydrated && !options?.resolution) {
    const preservedLocal = localMatch ?? reconciled.activeProject;
    return {
      projects: reconciled.savedProjects,
      activeProject: preservedLocal,
      activeUndoState: createUndoRedoState(
        preservedLocal.snapshot,
        preservedLocal.revisions,
        preservedLocal.undoHistory
      ),
      upgradedFromIndexedDb: false,
      idbStatus: idbLoad.status,
      corruptRecordCount: idbLoad.corruptRecordCount,
      conflictDetected: true,
      conflictProject: reconciled.conflictWithHydrated,
      alternateProject: preservedLocal,
      persisted: false,
    };
  }

  let chosenActive = reconciled.activeProject;
  if (localMatch && idbMatch) {
    const idbRev = idbMatch.revision ?? 1;
    const localRev = localMatch.revision ?? 1;
    if (options?.resolution === 'prefer-idb') {
      chosenActive = { ...idbMatch, persistedRevision: idbRev };
    } else if (options?.resolution === 'prefer-local') {
      chosenActive = { ...localMatch, persistedRevision: localRev };
    } else if (idbRev > localRev) {
      chosenActive = { ...idbMatch, persistedRevision: idbRev };
    } else if (localRev > idbRev) {
      chosenActive = { ...localMatch, persistedRevision: localRev };
    } else {
      const preferIdb =
        idbMatch.artifacts.length > localMatch.artifacts.length ||
        idbMatch.revisions.length > localMatch.revisions.length ||
        Boolean(idbMatch.undoHistory && !localMatch.undoHistory) ||
        idbMatch.updatedAt >= localMatch.updatedAt;
      const winner = preferIdb ? idbMatch : localMatch;
      chosenActive = {
        ...winner,
        undoHistory: winner.undoHistory ?? idbMatch.undoHistory ?? localMatch.undoHistory,
        persistedRevision: idbRev,
      };
    }
  }

  const finalProjects = reconciled.savedProjects.map((p) =>
    p.id === chosenActive.id ? chosenActive : p
  );

  let persisted = false;
  let persistenceWarning: string | undefined;

  if (!getDeletedProjectIds().has(chosenActive.id)) {
    const idbSave =
      idbLoad.status !== 'unavailable'
        ? await saveProjectToIndexedDb(chosenActive, { forceOverwrite: true })
        : { ok: true, saved: true, persistedRevision: chosenActive.revision };
    const localSave = saveProjectToLocalStorage(chosenActive, { forceOverwrite: true });

    if (idbLoad.status !== 'unavailable') {
      persisted = Boolean(idbSave.saved);
      if (idbSave.saved && idbSave.persistedRevision !== undefined) {
        chosenActive = {
          ...chosenActive,
          persistedRevision: idbSave.persistedRevision,
        };
      }
      if (!idbSave.saved) {
        persistenceWarning = idbSave.error ?? 'Failed to synchronize reloaded project to IndexedDB.';
      } else if (!localSave.saved) {
        persistenceWarning =
          localSave.error ?? 'Synchronized to IndexedDB, but localStorage cache could not be updated.';
      }
    } else {
      persisted = Boolean(localSave.saved);
      if (!localSave.saved) {
        persistenceWarning = localSave.error;
      }
    }
  }

  return {
    projects: finalProjects.map((p) => (p.id === chosenActive.id ? chosenActive : p)),
    activeProject: chosenActive,
    activeUndoState: createUndoRedoState(
      chosenActive.snapshot,
      chosenActive.revisions,
      chosenActive.undoHistory
    ),
    upgradedFromIndexedDb:
      reconciled.upgradedFromIndexedDb || options?.resolution === 'prefer-idb',
    idbStatus: idbLoad.status,
    corruptRecordCount: idbLoad.corruptRecordCount,
    conflictDetected: false,
    conflictProject: null,
    persisted,
    persistenceWarning,
  };
}


