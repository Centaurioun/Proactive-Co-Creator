/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { computeSnapshotDigest, isSnapshotSemanticallyEqual } from '../historyEngine.ts';
import type { CreativeProject } from '../../shared/types.ts';
import { NARRATIVE_SCHEMA_VERSION, type StorageSaveResult, type DurableWriteOptions } from './constants.ts';
import { migrateProjectPayload } from './migration.ts';

const MAX_RECENT_INTENT_IDS = 50;

export function stableIntentSerialization(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? 'null';
  if (Array.isArray(value)) return `[${value.map(stableIntentSerialization).join(',')}]`;
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record)
    .sort()
    .filter((key) => record[key] !== undefined)
    .map((key) => `${JSON.stringify(key)}:${stableIntentSerialization(record[key])}`)
    .join(',')}}`;
}

export function intentOperationFingerprint(project: CreativeProject): string {
  const operationContent = Object.fromEntries(
    Object.entries(project).filter(
      ([key]) => !['revision', 'persistedRevision', 'updatedAt', 'recentIntentIds'].includes(key)
    )
  );
  const text = stableIntentSerialization(operationContent);
  let a = 0x811c9dc5;
  let b = 0x9e3779b9;
  for (let i = 0; i < text.length; i += 1) {
    const code = text.charCodeAt(i);
    a = Math.imul(a ^ code, 0x01000193);
    b = Math.imul(b ^ code, 0x85ebca6b);
  }
  return `${(a >>> 0).toString(16)}${(b >>> 0).toString(16)}`;
}

export function intentRecordId(
  project: CreativeProject,
  intentId?: string,
  expectedBaseRevision?: number
): string | undefined {
  const baseRevision = expectedBaseRevision ?? project.persistedRevision ?? 0;
  return intentId ? `${intentId}:${baseRevision}:${intentOperationFingerprint(project)}` : undefined;
}

export function mergeIntentIds(
  existing: CreativeProject | undefined,
  candidate: CreativeProject,
  intentId?: string,
  expectedBaseRevision?: number
): string[] | undefined {
  const record = intentRecordId(candidate, intentId, expectedBaseRevision);
  const combined = [
    ...(existing?.recentIntentIds ?? []),
    ...(candidate.recentIntentIds ?? []),
    ...(record ? [record] : []),
  ].filter((id): id is string => typeof id === 'string' && id.trim().length > 0);
  if (combined.length === 0) return undefined;
  const deduped: string[] = [];
  for (const id of combined) {
    if (!deduped.includes(id)) deduped.push(id);
  }
  return deduped.slice(-MAX_RECENT_INTENT_IDS);
}

export function safeMigrateExisting(existing: CreativeProject): CreativeProject {
  try {
    return migrateProjectPayload(existing);
  } catch {
    return existing;
  }
}

function evaluateSchemaAndIntentGuard(
  existing: CreativeProject | undefined,
  candidate: CreativeProject,
  rawExpected: number | undefined,
  intentId: string | undefined,
  requireExactBase: boolean | undefined
): StorageSaveResult | null {
  if (
    existing &&
    (existing.schemaVersion > NARRATIVE_SCHEMA_VERSION ||
      (existing.schemaVersion === NARRATIVE_SCHEMA_VERSION &&
        candidate.schemaVersion < NARRATIVE_SCHEMA_VERSION))
  ) {
    return {
      ok: false,
      saved: false,
      conflictDetected: true,
      error: 'Storage contains a newer project schema.',
    };
  }

  const existingIntent = intentId
    ? existing?.recentIntentIds?.find((id) => id.startsWith(`${intentId}:`) || id === intentId)
    : undefined;
  if (existing && intentId && existingIntent) {
    if (existingIntent !== intentRecordId(candidate, intentId, rawExpected)) {
      return {
        ok: false,
        saved: false,
        conflictDetected: true,
        storedProject: safeMigrateExisting(existing),
        error: 'This intent ID was already used for different operation content.',
      };
    }
    return {
      ok: true,
      saved: true,
      idempotentHit: true,
      persistedRevision: typeof existing.revision === 'number' ? existing.revision : 1,
      storedProject: safeMigrateExisting(existing),
    };
  }

  if (requireExactBase && (!existing || existing.revision !== rawExpected)) {
    return {
      ok: false,
      saved: false,
      conflictDetected: true,
      ...(existing ? { storedProject: safeMigrateExisting(existing) } : {}),
      error: 'The durable project revision changed. Reload storage before retrying.',
    };
  }

  return null;
}

function evaluateRevisionAndSnapshotCas(params: {
  existing: CreativeProject;
  normalizedExisting: CreativeProject;
  candidate: CreativeProject;
  rawExpected?: number;
  storeLabel: 'localStorage' | 'IndexedDB';
  requireExactBase?: boolean;
}): StorageSaveResult | null {
  const { existing, normalizedExisting, candidate, rawExpected, storeLabel, requireExactBase } = params;
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
        storedProject: normalizedExisting,
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
      storedProject: normalizedExisting,
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
      storedProject: normalizedExisting,
      error: `Storage conflict detected: ${storeLabel} holds revision r${existingRev}, which is newer than candidate r${candidateRev}.`,
    };
  }

  if (baseRev !== undefined && existingRev === baseRev && candidateRev === baseRev) {
    const snapshotsEqual =
      isSnapshotSemanticallyEqual(existing.snapshot, candidate.snapshot) ||
      isSnapshotSemanticallyEqual(
        normalizedExisting.snapshot,
        safeMigrateExisting(candidate).snapshot
      );
    const narrativesDiffer = requireExactBase &&
      stableIntentSerialization(normalizedExisting.narrative) !==
      stableIntentSerialization(safeMigrateExisting(candidate).narrative);
    if (!snapshotsEqual || narrativesDiffer) {
      return {
        ok: false,
        saved: false,
        conflictDetected: true,
        storedProject: normalizedExisting,
        error: `Storage conflict detected: ${storeLabel} already holds revision r${existingRev} with a divergent ${snapshotsEqual ? 'narrative record' : 'snapshot'}.`,
      };
    }
    if (existing.updatedAt > candidate.updatedAt) {
      return {
        ok: false,
        saved: false,
        conflictDetected: true,
        storedProject: normalizedExisting,
        error: 'A newer version of this project was saved in another browser tab.',
      };
    }
  }

  return null;
}

export function matchesObservedProject(actual: CreativeProject | undefined, expected: CreativeProject | null) {
  if (expected === null) return actual === undefined;
  return actual !== undefined &&
    stableIntentSerialization(safeMigrateExisting(actual)) === stableIntentSerialization(safeMigrateExisting(expected));
}

export function evaluateCasConflict(params: {
  existing: CreativeProject | undefined;
  candidate: CreativeProject;
  rawExpected?: number;
  expectedManuscriptVersionId?: string;
  expectedBaseSnapshotDigest?: string;
  expectedBaseProject?: CreativeProject | null;
  expectedBaseNarrative?: DurableWriteOptions['expectedBaseNarrative'];
  intentId?: string;
  requireExactBase?: boolean;
  forceOverwrite: boolean;
  storeLabel: 'localStorage' | 'IndexedDB';
}): StorageSaveResult | null {
  const {
    existing,
    candidate,
    rawExpected,
    expectedManuscriptVersionId,
    expectedBaseSnapshotDigest,
    expectedBaseProject,
    expectedBaseNarrative,
    intentId,
    requireExactBase,
    forceOverwrite,
    storeLabel,
  } = params;

  const preGuard = evaluateSchemaAndIntentGuard(
    existing,
    candidate,
    rawExpected,
    intentId,
    requireExactBase
  );
  if (preGuard) return preGuard;
  if (expectedBaseProject !== undefined && !matchesObservedProject(existing, expectedBaseProject)) {
    return {
      ok: false,
      saved: false,
      conflictDetected: true,
      storedProject: existing && safeMigrateExisting(existing),
      error: 'The observed project changed in storage. Reload and review the latest version before retrying.',
    };
  }
  if (forceOverwrite || !existing) return null;

  const normalizedExisting = safeMigrateExisting(existing);

  if (expectedBaseNarrative !== undefined &&
      stableIntentSerialization(normalizedExisting.narrative ?? null) !== stableIntentSerialization(expectedBaseNarrative)) {
    return {
      ok: false, saved: false, conflictDetected: true, storedProject: normalizedExisting,
      error: 'The durable narrative changed since this operation was prepared. Reload and review before retrying.',
    };
  }

  if (
    expectedManuscriptVersionId !== undefined &&
    (normalizedExisting.snapshot.manuscriptVersionId ?? '') !== expectedManuscriptVersionId
  ) {
    return {
      ok: false,
      saved: false,
      conflictDetected: true,
      storedProject: normalizedExisting,
      error: `Storage conflict detected: ${storeLabel} holds a newer manuscript version than this change expected. Re-preview before applying.`,
    };
  }

  if (
    expectedBaseSnapshotDigest !== undefined &&
    computeSnapshotDigest(existing.snapshot) !== expectedBaseSnapshotDigest &&
    computeSnapshotDigest(normalizedExisting.snapshot) !== expectedBaseSnapshotDigest
  ) {
    return {
      ok: false,
      saved: false,
      conflictDetected: true,
      storedProject: normalizedExisting,
      error: `Storage conflict detected: ${storeLabel} snapshot changed since this operation was prepared. Re-preview before applying.`,
    };
  }

  return evaluateRevisionAndSnapshotCas({
    existing,
    normalizedExisting,
    candidate,
    rawExpected,
    storeLabel,
    requireExactBase,
  });
}
