/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { computeSnapshotDigest, isSnapshotSemanticallyEqual } from '../historyEngine.ts';
import type { CreativeProject } from '../../shared/types.ts';
import { NARRATIVE_SCHEMA_VERSION, type StorageSaveResult, type DurableWriteOptions } from './constants.ts';
import { migrateProjectPayload } from './migration.ts';

const MAX_RECENT_INTENT_IDS = 50;
const INTENT_EXCLUDED_KEYS = new Set(['revision', 'persistedRevision', 'updatedAt', 'recentIntentIds']);

export function stableIntentSerialization(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? 'null';
  if (Array.isArray(value)) {
    let out = '[';
    for (let i = 0; i < value.length; i++) {
      if (i > 0) out += ',';
      out += stableIntentSerialization(value[i]);
    }
    return `${out}]`;
  }
  const record = value as Record<string, unknown>;
  const keys = Object.keys(record).sort();
  let out = '{';
  let wrote = false;
  for (let i = 0; i < keys.length; i++) {
    const key = keys[i];
    const entry = record[key];
    if (entry === undefined) continue;
    if (wrote) out += ',';
    out += `${JSON.stringify(key)}:${stableIntentSerialization(entry)}`;
    wrote = true;
  }
  return `${out}}`;
}

interface HashState {
  a: number;
  b: number;
}

function feedHashString(state: HashState, text: string): void {
  let { a, b } = state;
  for (let i = 0; i < text.length; i += 1) {
    const code = text.charCodeAt(i);
    a = Math.imul(a ^ code, 0x01000193);
    b = Math.imul(b ^ code, 0x85ebca6b);
  }
  state.a = a;
  state.b = b;
}

function feedHashChar(state: HashState, code: number): void {
  state.a = Math.imul(state.a ^ code, 0x01000193);
  state.b = Math.imul(state.b ^ code, 0x85ebca6b);
}

function hashStableValue(value: unknown, state: HashState, skipExcludedRootKeys: boolean): void {
  if (value === null || typeof value !== 'object') {
    feedHashString(state, JSON.stringify(value) ?? 'null');
    return;
  }
  if (Array.isArray(value)) {
    feedHashChar(state, 91); // '['
    for (let i = 0; i < value.length; i++) {
      if (i > 0) feedHashChar(state, 44); // ','
      hashStableValue(value[i], state, false);
    }
    feedHashChar(state, 93); // ']'
    return;
  }
  const record = value as Record<string, unknown>;
  const keys = Object.keys(record).sort();
  feedHashChar(state, 123); // '{'
  let wrote = false;
  for (let i = 0; i < keys.length; i++) {
    const key = keys[i];
    if (skipExcludedRootKeys && INTENT_EXCLUDED_KEYS.has(key)) continue;
    const entry = record[key];
    if (entry === undefined) continue;
    if (wrote) feedHashChar(state, 44); // ','
    feedHashString(state, JSON.stringify(key));
    feedHashChar(state, 58); // ':'
    hashStableValue(entry, state, false);
    wrote = true;
  }
  feedHashChar(state, 125); // '}'
}

export function intentOperationFingerprint(project: CreativeProject): string {
  const state: HashState = { a: 0x811c9dc5, b: 0x9e3779b9 };
  hashStableValue(project, state, true);
  return `${(state.a >>> 0).toString(16)}${(state.b >>> 0).toString(16)}`;
}

function areObjectsStableEqual(recA: Record<string, unknown>, recB: Record<string, unknown>): boolean {
  const keysA = Object.keys(recA);
  let definedCountA = 0;
  for (let i = 0; i < keysA.length; i++) {
    const key = keysA[i];
    const valA = recA[key];
    if (valA === undefined) continue;
    definedCountA++;
    const valB = recB[key];
    if (valB === undefined || !areStableValuesEqual(valA, valB)) {
      return false;
    }
  }
  const keysB = Object.keys(recB);
  let definedCountB = 0;
  for (let i = 0; i < keysB.length; i++) {
    if (recB[keysB[i]] !== undefined) definedCountB++;
  }
  return definedCountA === definedCountB;
}

export function areStableValuesEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (a === null || b === null || typeof a !== 'object' || typeof b !== 'object') {
    return (JSON.stringify(a) ?? 'null') === (JSON.stringify(b) ?? 'null');
  }
  if (Array.isArray(a) || Array.isArray(b)) {
    if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) return false;
    for (let i = 0; i < a.length; i++) {
      if (!areStableValuesEqual(a[i], b[i])) return false;
    }
    return true;
  }
  return areObjectsStableEqual(a as Record<string, unknown>, b as Record<string, unknown>);
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

function casConflictResult(
  error: string,
  storedProject?: CreativeProject
): StorageSaveResult {
  return {
    ok: false,
    saved: false,
    conflictDetected: true,
    ...(storedProject ? { storedProject } : {}),
    error,
  };
}

function evaluateSchemaAndIntentGuard(
  existing: CreativeProject | undefined,
  getNormalizedExisting: () => CreativeProject | undefined,
  candidate: CreativeProject,
  rawExpected: number | undefined,
  intentId: string | undefined,
  requireExactBase: boolean | undefined
): StorageSaveResult | null {
  const newerSchema =
    Boolean(existing) &&
    (existing!.schemaVersion > NARRATIVE_SCHEMA_VERSION ||
      (existing!.schemaVersion === NARRATIVE_SCHEMA_VERSION &&
        candidate.schemaVersion < NARRATIVE_SCHEMA_VERSION));
  if (newerSchema) {
    return casConflictResult('Storage contains a newer project schema.');
  }

  const existingIntent = intentId
    ? existing?.recentIntentIds?.find((id) => id.startsWith(`${intentId}:`) || id === intentId)
    : undefined;
  if (existing && intentId && existingIntent) {
    if (existingIntent !== intentRecordId(candidate, intentId, rawExpected)) {
      return casConflictResult(
        'This intent ID was already used for different operation content.',
        getNormalizedExisting()
      );
    }
    return {
      ok: true,
      saved: true,
      idempotentHit: true,
      persistedRevision: typeof existing.revision === 'number' ? existing.revision : 1,
      storedProject: getNormalizedExisting(),
    };
  }

  if (requireExactBase && (!existing || existing.revision !== rawExpected)) {
    return casConflictResult(
      'The durable project revision changed. Reload storage before retrying.',
      existing ? getNormalizedExisting() : undefined
    );
  }

  return null;
}

function evaluateSameRevisionDivergence(params: {
  existing: CreativeProject;
  normalizedExisting: CreativeProject;
  candidate: CreativeProject;
  getNormalizedCandidate: () => CreativeProject;
  existingRev: number;
  storeLabel: 'localStorage' | 'IndexedDB';
  requireExactBase?: boolean;
}): StorageSaveResult | null {
  const {
    existing,
    normalizedExisting,
    candidate,
    getNormalizedCandidate,
    existingRev,
    storeLabel,
    requireExactBase,
  } = params;

  const normalizedCandidate = getNormalizedCandidate();
  const snapshotsEqual =
    isSnapshotSemanticallyEqual(existing.snapshot, candidate.snapshot) ||
    isSnapshotSemanticallyEqual(normalizedExisting.snapshot, normalizedCandidate.snapshot);
  const narrativesDiffer = Boolean(
    requireExactBase &&
      !areStableValuesEqual(normalizedExisting.narrative, normalizedCandidate.narrative)
  );
  if (!snapshotsEqual || narrativesDiffer) {
    return casConflictResult(
      `Storage conflict detected: ${storeLabel} already holds revision r${existingRev} with a divergent ${snapshotsEqual ? 'narrative record' : 'snapshot'}.`,
      normalizedExisting
    );
  }
  if (existing.updatedAt > candidate.updatedAt) {
    return casConflictResult(
      'A newer version of this project was saved in another browser tab.',
      normalizedExisting
    );
  }
  return null;
}

function evaluateRevisionAndSnapshotCas(params: {
  existing: CreativeProject;
  normalizedExisting: CreativeProject;
  candidate: CreativeProject;
  getNormalizedCandidate: () => CreativeProject;
  rawExpected?: number;
  storeLabel: 'localStorage' | 'IndexedDB';
  requireExactBase?: boolean;
}): StorageSaveResult | null {
  const {
    existing,
    normalizedExisting,
    candidate,
    getNormalizedCandidate,
    rawExpected,
    storeLabel,
    requireExactBase,
  } = params;
  const existingRev = typeof existing.revision === 'number' ? existing.revision : 1;
  const candidateRev = typeof candidate.revision === 'number' ? candidate.revision : 1;

  if (typeof rawExpected === 'number' && rawExpected > 1_000_000_000_000) {
    return existing.updatedAt > rawExpected
      ? casConflictResult(
          'A newer version of this project was saved in another browser tab.',
          normalizedExisting
        )
      : null;
  }

  const baseRev = rawExpected !== undefined ? rawExpected : candidate.persistedRevision;
  if (baseRev !== undefined && existingRev > baseRev) {
    const msg =
      storeLabel === 'IndexedDB'
        ? `IndexedDB has a newer revision (r${existingRev}) than expected base r${baseRev}.`
        : `Storage conflict detected: another tab saved revision r${existingRev} while this tab was based on r${baseRev}.`;
    return casConflictResult(msg, normalizedExisting);
  }

  if (candidateRev < existingRev) {
    return casConflictResult(
      `Storage conflict detected: ${storeLabel} holds revision r${existingRev}, which is newer than candidate r${candidateRev}.`,
      normalizedExisting
    );
  }

  if (baseRev !== undefined && existingRev === baseRev && candidateRev === baseRev) {
    return evaluateSameRevisionDivergence({
      existing,
      normalizedExisting,
      candidate,
      getNormalizedCandidate,
      existingRev,
      storeLabel,
      requireExactBase,
    });
  }

  return null;
}

export function matchesObservedProject(
  actual: CreativeProject | undefined,
  expected: CreativeProject | null
): boolean {
  if (expected === null) return actual === undefined;
  if (actual === undefined) return false;
  if (actual === expected) return true;
  if (actual.id !== expected.id) return false;
  return areStableValuesEqual(safeMigrateExisting(actual), safeMigrateExisting(expected));
}

function checkExpectedBaseGuards(params: {
  existing: CreativeProject;
  normalizedExisting: CreativeProject;
  expectedBaseNarrative?: DurableWriteOptions['expectedBaseNarrative'];
  expectedManuscriptVersionId?: string;
  expectedBaseSnapshotDigest?: string;
  storeLabel: 'localStorage' | 'IndexedDB';
}): StorageSaveResult | null {
  const {
    existing,
    normalizedExisting,
    expectedBaseNarrative,
    expectedManuscriptVersionId,
    expectedBaseSnapshotDigest,
    storeLabel,
  } = params;

  if (
    expectedBaseNarrative !== undefined &&
    !areStableValuesEqual(normalizedExisting.narrative ?? null, expectedBaseNarrative)
  ) {
    return casConflictResult(
      'The durable narrative changed since this operation was prepared. Reload and review before retrying.',
      normalizedExisting
    );
  }

  if (
    expectedManuscriptVersionId !== undefined &&
    (normalizedExisting.snapshot.manuscriptVersionId ?? '') !== expectedManuscriptVersionId
  ) {
    return casConflictResult(
      `Storage conflict detected: ${storeLabel} holds a newer manuscript version than this change expected. Re-preview before applying.`,
      normalizedExisting
    );
  }

  if (
    expectedBaseSnapshotDigest !== undefined &&
    computeSnapshotDigest(existing.snapshot) !== expectedBaseSnapshotDigest &&
    computeSnapshotDigest(normalizedExisting.snapshot) !== expectedBaseSnapshotDigest
  ) {
    return casConflictResult(
      `Storage conflict detected: ${storeLabel} snapshot changed since this operation was prepared. Re-preview before applying.`,
      normalizedExisting
    );
  }

  return null;
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
  const { existing, candidate, rawExpected, expectedBaseProject, intentId, requireExactBase, forceOverwrite, storeLabel } = params;

  let cachedNormalizedExisting: CreativeProject | undefined;
  const getNormalizedExisting = () => {
    if (!existing) return undefined;
    if (!cachedNormalizedExisting) cachedNormalizedExisting = safeMigrateExisting(existing);
    return cachedNormalizedExisting;
  };

  let cachedNormalizedCandidate: CreativeProject | undefined;
  const getNormalizedCandidate = () => {
    if (!cachedNormalizedCandidate) cachedNormalizedCandidate = safeMigrateExisting(candidate);
    return cachedNormalizedCandidate;
  };

  const preGuard = evaluateSchemaAndIntentGuard(
    existing,
    getNormalizedExisting,
    candidate,
    rawExpected,
    intentId,
    requireExactBase
  );
  if (preGuard) return preGuard;

  if (expectedBaseProject !== undefined) {
    const matchesObserved =
      expectedBaseProject === null
        ? existing === undefined
        : existing !== undefined &&
          (existing === expectedBaseProject ||
            (existing.id === expectedBaseProject.id &&
              areStableValuesEqual(getNormalizedExisting(), safeMigrateExisting(expectedBaseProject))));
    if (!matchesObserved) {
      return casConflictResult(
        'The observed project changed in storage. Reload and review the latest version before retrying.',
        getNormalizedExisting()
      );
    }
  }

  if (forceOverwrite || !existing) return null;

  const normalizedExisting = getNormalizedExisting()!;
  const baseGuard = checkExpectedBaseGuards({
    existing,
    normalizedExisting,
    expectedBaseNarrative: params.expectedBaseNarrative,
    expectedManuscriptVersionId: params.expectedManuscriptVersionId,
    expectedBaseSnapshotDigest: params.expectedBaseSnapshotDigest,
    storeLabel,
  });
  if (baseGuard) return baseGuard;

  return evaluateRevisionAndSnapshotCas({
    existing,
    normalizedExisting,
    candidate,
    getNormalizedCandidate,
    rawExpected,
    storeLabel,
    requireExactBase,
  });
}
