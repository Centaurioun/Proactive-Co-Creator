import type { CreativeProject, Entity, Relationship } from '../../../shared/types.ts';
import type { ManuscriptSection } from '../../../shared/narrativeTypes.ts';
import { buildDecisionInboxFromSnapshot, makeStableId } from '../../canonicalModel.ts';
import { computeSnapshotDigest, createUndoRedoState, recordProjectRevision, serializeUndoHistory } from '../../historyEngine.ts';
import { synthesizeRefinedPrompt } from '../../promptBuilder.ts';
import { validateNarrativeRecords } from '../evidenceRegistry.ts';
import { manuscriptSections } from '../manuscriptModel.ts';
import { ensureNarrativeEnvelope } from '../diagnostics/engine.ts';

export type AppendInsertPosition = 'beginning' | 'end' | { afterSectionId: string };
export type CrossProjectIdentityDecision = 'keep-separate' | 'link-to-existing';

export interface CrossProjectIdentityMatch {
  incomingEntityId: string;
  incomingEntityName: string;
  incomingCategory?: string;
  existingEntityId: string;
  existingEntityName: string;
  matchReason: string;
}

export function computeSectionsDigest(sections: readonly ManuscriptSection[]): string {
  const payload = JSON.stringify(sections.map((s) => ({ id: s.id, kind: s.kind, title: s.title, text: s.text })));
  let hash = 0x811c9dc5;
  for (let i = 0; i < payload.length; i += 1) {
    hash ^= payload.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return `ms_${sections.length}_${hash.toString(16).padStart(8, '0')}`;
}

function normalizeNameKey(name: string): string {
  return name.trim().toLowerCase().replace(/\s+/g, ' ');
}

function hashStrings(value: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < value.length; i += 1) {
    hash ^= value.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(36);
}

function makeUniqueStableId(prefix: string, usedIds: Set<string>): string {
  let candidate = makeStableId(prefix);
  while (usedIds.has(candidate)) {
    candidate = makeStableId(prefix);
  }
  usedIds.add(candidate);
  return candidate;
}

/**
 * Finds potential entity matches between an incoming imported project and an existing target project.
 * Never auto-merges by name; every match requires an explicit author decision.
 */
export function findCrossProjectIdentityMatches(
  targetProject: CreativeProject,
  incomingProject: CreativeProject
): CrossProjectIdentityMatch[] {
  const existing = targetProject.snapshot.entities.filter((e) => !e.excluded && e.category !== 'scene' && e.id);
  const incoming = incomingProject.snapshot.entities.filter((e) => !e.excluded && e.category !== 'scene' && e.id);
  const matches: CrossProjectIdentityMatch[] = [];

  for (const inc of incoming) {
    const incNames = new Set([normalizeNameKey(inc.name), ...(inc.aliases ?? []).map(normalizeNameKey)].filter(Boolean));
    for (const ex of existing) {
      const exNames = new Set([normalizeNameKey(ex.name), ...(ex.aliases ?? []).map(normalizeNameKey)].filter(Boolean));
      const matchedTerm = Array.from(incNames).find((term) => exNames.has(term));
      if (matchedTerm) {
        matches.push({
          incomingEntityId: inc.id!,
          incomingEntityName: inc.name,
          incomingCategory: inc.category,
          existingEntityId: ex.id!,
          existingEntityName: ex.name,
          matchReason:
            normalizeNameKey(inc.name) === normalizeNameKey(ex.name)
              ? `Exact name match ("${inc.name}")`
              : `Alias/name overlap ("${matchedTerm}")`,
        });
        break;
      }
    }
  }
  return matches;
}

export function detectDuplicateSourceInProject(
  targetProject: CreativeProject,
  incomingProject: CreativeProject
): boolean {
  const incomingSources = incomingProject.narrative?.sources ?? [];
  const existingSources = targetProject.narrative?.sources ?? [];
  return incomingSources.some((inc) =>
    existingSources.some((ex) => ex.digest === inc.digest)
  );
}

export function appendTargetBase(project: CreativeProject) {
  return {
    targetProjectId: project.id,
    expectedBaseRevision: project.revision,
    expectedManuscriptVersionId: project.snapshot.manuscriptVersionId ?? '',
    expectedBaseSnapshotDigest: computeSnapshotDigest(project.snapshot),
  };
}

export type AppendTargetBase = ReturnType<typeof appendTargetBase>;

export function matchesAppendTarget(project: CreativeProject, reviewed: AppendTargetBase): boolean {
  const current = appendTargetBase(project);
  return current.targetProjectId === reviewed.targetProjectId &&
    current.expectedBaseRevision === reviewed.expectedBaseRevision &&
    current.expectedManuscriptVersionId === reviewed.expectedManuscriptVersionId &&
    current.expectedBaseSnapshotDigest === reviewed.expectedBaseSnapshotDigest;
}

export interface ApplyAppendParams {
  targetProject: CreativeProject;
  incomingProject: CreativeProject;
  insertPosition: AppendInsertPosition;
  identityDecisions: Record<string, CrossProjectIdentityDecision>;
  expectedBaseRevision: number;
  expectedManuscriptVersionId?: string;
  expectedBaseSnapshotDigest?: string;
  allowDuplicateSource?: boolean;
}

function assertAppendPreconditions(params: ApplyAppendParams): CrossProjectIdentityMatch[] {
  const {
    targetProject,
    incomingProject,
    identityDecisions,
    expectedBaseRevision,
    expectedManuscriptVersionId,
    expectedBaseSnapshotDigest,
    allowDuplicateSource = false,
  } = params;

  if (targetProject.revision !== expectedBaseRevision) {
    throw new Error('The target project revision changed since append was previewed. Re-preview before applying.');
  }
  if (expectedManuscriptVersionId !== undefined && (targetProject.snapshot.manuscriptVersionId ?? '') !== expectedManuscriptVersionId) {
    throw new Error('The target manuscript version changed since append was previewed. Re-preview before applying.');
  }
  if (expectedBaseSnapshotDigest !== undefined && computeSnapshotDigest(targetProject.snapshot) !== expectedBaseSnapshotDigest) {
    throw new Error('The target project snapshot changed since append was previewed. Re-preview before applying.');
  }
  if (!allowDuplicateSource && detectDuplicateSourceInProject(targetProject, incomingProject)) {
    throw new Error('This exact source digest already exists in the target project. Confirm duplicate override only if intentional.');
  }
  const matches = findCrossProjectIdentityMatches(targetProject, incomingProject);
  const unresolved = matches.filter((m) => !identityDecisions[m.incomingEntityId]);
  if (unresolved.length > 0) {
    throw new Error(
      `Resolve ${unresolved.length} entity identity conflict(s) (${unresolved.map((u) => u.incomingEntityName).join(', ')}) before applying append.`
    );
  }
  return matches;
}

function mergeAppendedSections(
  existingSections: readonly ManuscriptSection[],
  incomingSections: readonly ManuscriptSection[],
  insertPosition: AppendInsertPosition,
): { mergedSections: ManuscriptSection[]; sectionIdMap: Map<string, string>; addedSectionCount: number } {
  const usedSectionIds = new Set(existingSections.map((s) => s.id));
  const sectionIdMap = new Map<string, string>();
  for (const sec of incomingSections) {
    sectionIdMap.set(sec.id, makeUniqueStableId('sec_app', usedSectionIds));
  }
  const remappedIncoming: ManuscriptSection[] = incomingSections.map((sec) => ({
    ...sec,
    id: sectionIdMap.get(sec.id)!,
    ...(sec.chapterId ? { chapterId: sectionIdMap.get(sec.chapterId) ?? sec.chapterId } : {}),
  }));
  let insertIndex = existingSections.length;
  if (insertPosition === 'beginning') {
    insertIndex = 0;
  } else if (typeof insertPosition === 'object') {
    const foundIdx = existingSections.findIndex((s) => s.id === insertPosition.afterSectionId);
    if (foundIdx < 0) throw new Error('The selected insertion point no longer exists in the target manuscript.');
    insertIndex = foundIdx + 1;
  }
  return {
    mergedSections: [...existingSections.slice(0, insertIndex), ...remappedIncoming, ...existingSections.slice(insertIndex)],
    sectionIdMap,
    addedSectionCount: remappedIncoming.length,
  };
}

function linkIncomingEntityToExisting(
  incEnt: Entity,
  existingEnt: Entity,
  usedAttrIds: Set<string>,
): void {
  existingEnt.aliases = Array.from(
    new Set([
      ...(existingEnt.aliases ?? []),
      ...(incEnt.name.toLowerCase() !== existingEnt.name.toLowerCase() ? [incEnt.name] : []),
      ...(incEnt.aliases ?? []),
    ])
  );
  const existingAttrNames = new Set(existingEnt.attributes.map((a) => a.name.toLowerCase()));
  for (const attr of incEnt.attributes) {
    if (attr.name === 'existence' || attr.name === 'existence_in_image') continue;
    if (!existingAttrNames.has(attr.name.toLowerCase())) {
      existingEnt.attributes.push({
        ...structuredClone(attr),
        id: makeUniqueStableId('attr_app', usedAttrIds),
        status: 'pending',
      });
    }
  }
}

function reconcileIncomingEntities(
  baseEntities: readonly Entity[],
  incomingEntities: readonly Entity[],
  matches: readonly CrossProjectIdentityMatch[],
  identityDecisions: Record<string, CrossProjectIdentityDecision>,
) {
  const matchByIncomingId = new Map(matches.map((m) => [m.incomingEntityId, m]));
  const entityIdMap = new Map<string, string>();
  const entityNameById = new Map<string, string>();
  const nextEntities: Entity[] = structuredClone([...baseEntities]);
  const usedEntityIds = new Set<string>();
  const usedAttrIds = new Set<string>();
  for (const ent of nextEntities) {
    if (ent.id) {
      usedEntityIds.add(ent.id);
      entityNameById.set(ent.id, ent.name);
    }
    for (const attr of ent.attributes) {
      if (attr.id) usedAttrIds.add(attr.id);
    }
  }
  let addedEntityCount = 0;
  let linkedEntityCount = 0;

  for (const incEnt of incomingEntities) {
    if (incEnt.category === 'scene') continue;
    const incId = incEnt.id ?? makeUniqueStableId('ent_app', usedEntityIds);
    const match = matchByIncomingId.get(incId);
    const decision = match ? identityDecisions[incId] : undefined;
    if (match && decision === 'link-to-existing') {
      entityIdMap.set(incId, match.existingEntityId);
      linkedEntityCount += 1;
      const existingEnt = nextEntities.find((e) => e.id === match.existingEntityId);
      if (existingEnt) linkIncomingEntityToExisting(incEnt, existingEnt, usedAttrIds);
    } else {
      const freshId = usedEntityIds.has(incId) ? makeUniqueStableId('ent_app', usedEntityIds) : incId;
      usedEntityIds.add(freshId);
      entityIdMap.set(incId, freshId);
      const exactSameName = match && decision === 'keep-separate' && normalizeNameKey(incEnt.name) === normalizeNameKey(match.existingEntityName);
      const disambiguatedName = exactSameName ? `${incEnt.name} (Appended)` : incEnt.name;
      nextEntities.push({
        ...structuredClone(incEnt),
        id: freshId,
        name: disambiguatedName,
        attributes: incEnt.attributes.map((a) => ({ ...structuredClone(a), id: makeUniqueStableId('attr_app', usedAttrIds) })),
      });
      entityNameById.set(freshId, disambiguatedName);
      addedEntityCount += 1;
    }
  }
  return { nextEntities, entityIdMap, entityNameById, addedEntityCount, linkedEntityCount };
}

function reconcileIncomingRelationships(
  baseRelationships: readonly Relationship[],
  incomingRelationships: readonly Relationship[],
  entityIdMap: Map<string, string>,
  entityNameById: Map<string, string>,
): Relationship[] {
  const nextRelationships: Relationship[] = structuredClone([...baseRelationships]);
  const usedRelIds = new Set(nextRelationships.map((r) => r.id).filter((id): id is string => Boolean(id)));
  for (const rel of incomingRelationships) {
    const mappedSourceId = rel.sourceId ? entityIdMap.get(rel.sourceId) : undefined;
    const mappedTargetId = rel.targetId ? entityIdMap.get(rel.targetId) : undefined;
    if (!mappedSourceId || !mappedTargetId || mappedSourceId === mappedTargetId) continue;
    const duplicate = nextRelationships.some(
      (r) => r.sourceId === mappedSourceId && r.targetId === mappedTargetId && r.label.toLowerCase() === rel.label.toLowerCase()
    );
    if (!duplicate) {
      nextRelationships.push({
        ...structuredClone(rel),
        id: makeUniqueStableId('rel_app', usedRelIds),
        sourceId: mappedSourceId,
        targetId: mappedTargetId,
        source: entityNameById.get(mappedSourceId) ?? rel.source,
        target: entityNameById.get(mappedTargetId) ?? rel.target,
      });
    }
  }
  return nextRelationships;
}

function remapIncomingNarrativeRecords(params: {
  targetNarrative: NonNullable<CreativeProject['narrative']>;
  incomingNarrative: NonNullable<CreativeProject['narrative']>;
  targetProjectId: string;
  nextRevision: number;
  entityIdMap: Map<string, string>;
  sectionIdMap: Map<string, string>;
}) {
  const { targetNarrative, incomingNarrative, targetProjectId, nextRevision, entityIdMap, sectionIdMap } = params;
  const usedSourceIds = new Set(targetNarrative.sources.map((s) => s.id));
  const sourceIdMap = new Map<string, string>();
  const remappedSources = incomingNarrative.sources.map((src) => {
    const newId = usedSourceIds.has(src.id) ? makeUniqueStableId('src_app', usedSourceIds) : src.id;
    usedSourceIds.add(newId);
    sourceIdMap.set(src.id, newId);
    return { ...src, id: newId };
  });

  const usedClaimIds = new Set(targetNarrative.claims.map((c) => c.id));
  const remappedClaims = incomingNarrative.claims.map((claim) => ({
    ...structuredClone(claim),
    id: makeUniqueStableId('claim_app', usedClaimIds),
    targetId: entityIdMap.get(claim.targetId) ?? sectionIdMap.get(claim.targetId) ?? claim.targetId,
    anchors: claim.anchors.map((a) => ({ ...a, sourceId: sourceIdMap.get(a.sourceId) ?? a.sourceId })),
  }));

  const usedPropIds = new Set((targetNarrative.proposals ?? []).map((p) => p.id));
  const remappedProposals = (incomingNarrative.proposals ?? []).map((prop) => ({
    ...structuredClone(prop),
    id: makeUniqueStableId('prop_app', usedPropIds),
    evidence: { ...prop.evidence, sourceId: sourceIdMap.get(prop.evidence.sourceId) ?? prop.evidence.sourceId },
  }));

  const usedIssueIds = new Set(targetNarrative.issues.map((i) => i.id));
  const usedFingerprints = new Set(targetNarrative.issues.map((i) => i.fingerprint));
  const remappedIssues = incomingNarrative.issues.map((issue) => {
    let fingerprint = issue.fingerprint;
    let suffix = 1;
    while (usedFingerprints.has(fingerprint)) {
      fingerprint = `${issue.fingerprint}:append-${suffix++}`;
    }
    usedFingerprints.add(fingerprint);
    return {
      ...structuredClone(issue),
      id: makeUniqueStableId('iss_app', usedIssueIds),
      fingerprint,
      anchors: issue.anchors.map((a) => ({ ...a, sourceId: sourceIdMap.get(a.sourceId) ?? a.sourceId })),
      affectedTargetIds: issue.affectedTargetIds.map((id) => entityIdMap.get(id) ?? sectionIdMap.get(id) ?? id),
    };
  });

  const usedOppIds = new Set((targetNarrative.opportunities ?? []).map((o) => o.id));
  const remappedOpportunities = (incomingNarrative.opportunities ?? []).map((opp) => ({
    ...structuredClone(opp),
    id: makeUniqueStableId('opp_app', usedOppIds),
    projectId: targetProjectId,
    baseRevision: nextRevision,
    lifecycleRevision: nextRevision,
    sourceRefs: opp.sourceRefs.map((ref) => sourceIdMap.get(ref) ?? ref),
    ...(opp.targetId ? { targetId: entityIdMap.get(opp.targetId) ?? sectionIdMap.get(opp.targetId) ?? opp.targetId } : {}),
  }));

  return { remappedSources, remappedClaims, remappedProposals, remappedIssues, remappedOpportunities };
}

/**
 * Produces an immutable, validated candidate project that durably appends an imported narrative
 * (sections, immutable source, claims, proposals, issues, opportunities, reconciled entities/relationships, audit, undo)
 * into an existing target project without auto-merging colliding entity identities.
 */
export function applyAppendToExistingProject(params: ApplyAppendParams): {
  candidateProject: CreativeProject;
  addedSectionCount: number;
  addedEntityCount: number;
  linkedEntityCount: number;
  intentId: string;
} {
  const matches = assertAppendPreconditions(params);
  const { targetProject, incomingProject, insertPosition, identityDecisions, expectedBaseRevision } = params;
  const baseTarget = ensureNarrativeEnvelope(targetProject);
  const targetNarrative = baseTarget.narrative!;
  const incomingNarrative = incomingProject.narrative;
  if (!incomingNarrative) throw new Error('Incoming import package is missing narrative records.');

  const { mergedSections, sectionIdMap, addedSectionCount } = mergeAppendedSections(
    manuscriptSections(baseTarget),
    manuscriptSections(incomingProject),
    insertPosition,
  );
  const { nextEntities, entityIdMap, entityNameById, addedEntityCount, linkedEntityCount } = reconcileIncomingEntities(
    baseTarget.snapshot.entities,
    incomingProject.snapshot.entities,
    matches,
    identityDecisions,
  );
  const nextRelationships = reconcileIncomingRelationships(
    baseTarget.snapshot.relationships,
    incomingProject.snapshot.relationships,
    entityIdMap,
    entityNameById,
  );

  const now = Date.now();
  const usedVersionIds = new Set(targetNarrative.versions.map((v) => v.id));
  const usedSectionVersionIds = new Set(targetNarrative.sectionVersions.map((sv) => sv.id));
  const nextVersionId = makeUniqueStableId('mv_app', usedVersionIds);
  const nextSectionVersions = [...targetNarrative.sectionVersions];
  const versionSectionIds: string[] = [];
  for (const sec of mergedSections) {
    const svId = makeUniqueStableId('sv_app', usedSectionVersionIds);
    nextSectionVersions.push({ id: svId, section: structuredClone(sec) });
    versionSectionIds.push(svId);
  }

  const records = remapIncomingNarrativeRecords({
    targetNarrative,
    incomingNarrative,
    targetProjectId: baseTarget.id,
    nextRevision: baseTarget.revision + 1,
    entityIdMap,
    sectionIdMap,
  });

  const nextSnapshot = {
    ...structuredClone(baseTarget.snapshot),
    manuscriptVersionId: nextVersionId,
    entities: nextEntities,
    relationships: nextRelationships,
  };
  nextSnapshot.decisions = buildDecisionInboxFromSnapshot(nextSnapshot);
  nextSnapshot.refinedPrompt = synthesizeRefinedPrompt(nextSnapshot);

  const prevUndo = createUndoRedoState(baseTarget.snapshot, baseTarget.revisions, baseTarget.undoHistory);
  const nextUndo = {
    past: [
      ...prevUndo.past,
      { id: makeStableId('undo_append'), label: `Append "${incomingProject.name}"`, timestamp: now, snapshot: structuredClone(baseTarget.snapshot) },
    ].slice(-40),
    present: structuredClone(nextSnapshot),
    future: [],
  };

  const activeExistingVersion = targetNarrative.versions.find((v) => v.id === baseTarget.snapshot.manuscriptVersionId);
  const usedAuditIds = new Set(targetNarrative.audit.map((a) => a.id));
  const revised = recordProjectRevision(
    {
      ...baseTarget,
      schemaVersion: 4,
      snapshot: nextSnapshot,
      undoHistory: serializeUndoHistory(nextUndo),
      narrative: {
        ...targetNarrative,
        versions: [
          ...targetNarrative.versions,
          { id: nextVersionId, sectionVersionIds: versionSectionIds, ...(activeExistingVersion?.styleProfile ? { styleProfile: activeExistingVersion.styleProfile } : {}) },
        ],
        sectionVersions: nextSectionVersions,
        sources: [...targetNarrative.sources, ...records.remappedSources],
        claims: [...targetNarrative.claims, ...records.remappedClaims],
        proposals: [...(targetNarrative.proposals ?? []), ...records.remappedProposals],
        issues: [...targetNarrative.issues, ...records.remappedIssues],
        ...(targetNarrative.opportunities?.length || records.remappedOpportunities.length
          ? { opportunities: [...(targetNarrative.opportunities ?? []), ...records.remappedOpportunities] }
          : {}),
        audit: [
          ...targetNarrative.audit,
          {
            id: makeUniqueStableId('audit_append', usedAuditIds),
            action: 'append',
            time: now,
            baseRevision: baseTarget.revision,
            resultRevision: baseTarget.revision + 1,
            ...(baseTarget.snapshot.manuscriptVersionId ? { before: baseTarget.snapshot.manuscriptVersionId } : {}),
            after: nextVersionId,
            reason: `Appended "${incomingProject.name}" (${addedSectionCount} sections, ${addedEntityCount} new entities, ${linkedEntityCount} linked entities).`,
          },
        ],
      },
    },
    `Append "${incomingProject.name}"`,
    `Appended ${addedSectionCount} section(s) from "${incomingProject.name}"`,
    addedSectionCount + addedEntityCount
  );

  validateNarrativeRecords(revised);
  const insertKey = typeof insertPosition === 'string' ? insertPosition : `after-${insertPosition.afterSectionId}`;
  const decisionHash = hashStrings(JSON.stringify(Object.entries(identityDecisions).sort(([a], [b]) => a.localeCompare(b))));
  const intentId = `append_${targetProject.id}_r${expectedBaseRevision}_${hashStrings(insertKey)}_${decisionHash}_${records.remappedSources[0]?.digest.slice(0, 12) ?? now.toString(36)}`;

  return { candidateProject: revised, addedSectionCount, addedEntityCount, linkedEntityCount, intentId };
}
