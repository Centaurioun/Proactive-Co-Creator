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
      let matchedTerm: string | null = null;
      for (const term of incNames) {
        if (exNames.has(term)) {
          matchedTerm = term;
          break;
        }
      }
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

/**
 * Produces an immutable, validated candidate project that durably appends an imported narrative
 * (sections, immutable source, claims, proposals, reconciled entities/relationships, audit, undo)
 * into an existing target project without auto-merging colliding entity identities.
 */
export function applyAppendToExistingProject(params: ApplyAppendParams): {
  candidateProject: CreativeProject;
  addedSectionCount: number;
  addedEntityCount: number;
  linkedEntityCount: number;
  intentId: string;
} {
  const {
    targetProject,
    incomingProject,
    insertPosition,
    identityDecisions,
    expectedBaseRevision,
    expectedManuscriptVersionId,
    expectedBaseSnapshotDigest,
    allowDuplicateSource = false,
  } = params;

  if (targetProject.revision !== expectedBaseRevision) {
    throw new Error('The target project revision changed since append was previewed. Re-preview before applying.');
  }
  if (
    expectedManuscriptVersionId !== undefined &&
    (targetProject.snapshot.manuscriptVersionId ?? '') !== expectedManuscriptVersionId
  ) {
    throw new Error('The target manuscript version changed since append was previewed. Re-preview before applying.');
  }
  if (
    expectedBaseSnapshotDigest !== undefined &&
    computeSnapshotDigest(targetProject.snapshot) !== expectedBaseSnapshotDigest
  ) {
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

  const baseTarget = ensureNarrativeEnvelope(targetProject);
  const targetNarrative = baseTarget.narrative!;
  const incomingNarrative = incomingProject.narrative;
  if (!incomingNarrative) {
    throw new Error('Incoming import package is missing narrative records.');
  }

  // 1. Remap incoming sections with fresh unique IDs and insert at chosen position
  const existingSections = manuscriptSections(baseTarget);
  const incomingSections = manuscriptSections(incomingProject);
  const sectionIdMap = new Map<string, string>();
  for (const sec of incomingSections) {
    sectionIdMap.set(sec.id, makeStableId('sec_app'));
  }
  const remappedIncomingSections: ManuscriptSection[] = incomingSections.map((sec) => ({
    ...sec,
    id: sectionIdMap.get(sec.id)!,
    ...(sec.chapterId ? { chapterId: sectionIdMap.get(sec.chapterId) ?? sec.chapterId } : {}),
  }));

  let insertIndex = existingSections.length;
  if (insertPosition === 'beginning') {
    insertIndex = 0;
  } else if (typeof insertPosition === 'object') {
    const foundIdx = existingSections.findIndex((s) => s.id === insertPosition.afterSectionId);
    if (foundIdx < 0) {
      throw new Error('The selected insertion point no longer exists in the target manuscript.');
    }
    insertIndex = foundIdx + 1;
  }

  const mergedSections = [
    ...existingSections.slice(0, insertIndex),
    ...remappedIncomingSections,
    ...existingSections.slice(insertIndex),
  ];

  // 2. Remap incoming sources to avoid any source ID collisions
  const existingSourceIds = new Set(targetNarrative.sources.map((s) => s.id));
  const sourceIdMap = new Map<string, string>();
  const remappedSources = incomingNarrative.sources.map((src) => {
    const newId = existingSourceIds.has(src.id) ? makeStableId('src_app') : src.id;
    sourceIdMap.set(src.id, newId);
    existingSourceIds.add(newId);
    return { ...src, id: newId };
  });

  // 3. Reconcile entities per explicit author decision (never auto-merge without explicit link decision)
  const matchByIncomingId = new Map(matches.map((m) => [m.incomingEntityId, m]));
  const entityIdMap = new Map<string, string>();
  const entityNameById = new Map<string, string>();
  const nextEntities: Entity[] = structuredClone(baseTarget.snapshot.entities);
  for (const ent of nextEntities) {
    if (ent.id) entityNameById.set(ent.id, ent.name);
  }

  let addedEntityCount = 0;
  let linkedEntityCount = 0;

  for (const incEnt of incomingProject.snapshot.entities) {
    if (incEnt.category === 'scene') continue;
    const incId = incEnt.id ?? makeStableId('ent_app');
    const match = matchByIncomingId.get(incId);
    const decision = match ? identityDecisions[incId] : undefined;

    if (match && decision === 'link-to-existing') {
      entityIdMap.set(incId, match.existingEntityId);
      linkedEntityCount += 1;
      const existingEnt = nextEntities.find((e) => e.id === match.existingEntityId);
      if (existingEnt) {
        const nextAliases = Array.from(
          new Set([
            ...(existingEnt.aliases ?? []),
            ...(incEnt.name.toLowerCase() !== existingEnt.name.toLowerCase() ? [incEnt.name] : []),
            ...(incEnt.aliases ?? []),
          ])
        );
        existingEnt.aliases = nextAliases;
        // Append non-duplicate pending attributes from the appended source for author review
        const existingAttrNames = new Set(existingEnt.attributes.map((a) => a.name.toLowerCase()));
        for (const attr of incEnt.attributes) {
          if (attr.name === 'existence' || attr.name === 'existence_in_image') continue;
          if (!existingAttrNames.has(attr.name.toLowerCase())) {
            existingEnt.attributes.push({
              ...structuredClone(attr),
              id: makeStableId('attr_app'),
              status: 'pending',
            });
          }
        }
      }
    } else {
      const freshId = nextEntities.some((e) => e.id === incId) ? makeStableId('ent_app') : incId;
      entityIdMap.set(incId, freshId);
      const disambiguatedName =
        match && decision === 'keep-separate' && normalizeNameKey(incEnt.name) === normalizeNameKey(match.existingEntityName)
          ? `${incEnt.name} (Appended)`
          : incEnt.name;
      const remappedEntity: Entity = {
        ...structuredClone(incEnt),
        id: freshId,
        name: disambiguatedName,
        attributes: incEnt.attributes.map((a) => ({ ...structuredClone(a), id: makeStableId('attr_app') })),
      };
      nextEntities.push(remappedEntity);
      entityNameById.set(freshId, disambiguatedName);
      addedEntityCount += 1;
    }
  }

  // 4. Remap incoming relationships using reconciled entity IDs
  const nextRelationships: Relationship[] = structuredClone(baseTarget.snapshot.relationships);
  for (const rel of incomingProject.snapshot.relationships) {
    const mappedSourceId = rel.sourceId ? entityIdMap.get(rel.sourceId) : undefined;
    const mappedTargetId = rel.targetId ? entityIdMap.get(rel.targetId) : undefined;
    if (!mappedSourceId || !mappedTargetId || mappedSourceId === mappedTargetId) continue;
    const sourceName = entityNameById.get(mappedSourceId) ?? rel.source;
    const targetName = entityNameById.get(mappedTargetId) ?? rel.target;
    const alreadyExists = nextRelationships.some(
      (r) =>
        r.sourceId === mappedSourceId &&
        r.targetId === mappedTargetId &&
        r.label.toLowerCase() === rel.label.toLowerCase()
    );
    if (!alreadyExists) {
      nextRelationships.push({
        ...structuredClone(rel),
        id: makeStableId('rel_app'),
        sourceId: mappedSourceId,
        targetId: mappedTargetId,
        source: sourceName,
        target: targetName,
      });
    }
  }

  // 5. Build new manuscript version & sectionVersions records
  const now = Date.now();
  const nextVersionId = makeStableId('mv_app');
  const nextSectionVersions = [...targetNarrative.sectionVersions];
  const versionSectionIds: string[] = [];
  for (const sec of mergedSections) {
    const svId = makeStableId('sv_app');
    nextSectionVersions.push({ id: svId, section: structuredClone(sec) });
    versionSectionIds.push(svId);
  }

  // Remap claims & proposals source IDs
  const remappedClaims = incomingNarrative.claims.map((claim) => ({
    ...structuredClone(claim),
    id: makeStableId('claim_app'),
    targetId: entityIdMap.get(claim.targetId) ?? sectionIdMap.get(claim.targetId) ?? claim.targetId,
    anchors: claim.anchors.map((a) => ({ ...a, sourceId: sourceIdMap.get(a.sourceId) ?? a.sourceId })),
  }));
  const remappedProposals = (incomingNarrative.proposals ?? []).map((prop) => ({
    ...structuredClone(prop),
    id: makeStableId('prop_app'),
    evidence: { ...prop.evidence, sourceId: sourceIdMap.get(prop.evidence.sourceId) ?? prop.evidence.sourceId },
  }));

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
      {
        id: makeStableId('undo_append'),
        label: `Append "${incomingProject.name}"`,
        timestamp: now,
        snapshot: structuredClone(baseTarget.snapshot),
      },
    ].slice(-40),
    present: structuredClone(nextSnapshot),
    future: [],
  };

  const activeExistingVersion = targetNarrative.versions.find(
    (v) => v.id === baseTarget.snapshot.manuscriptVersionId
  );

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
          {
            id: nextVersionId,
            sectionVersionIds: versionSectionIds,
            ...(activeExistingVersion?.styleProfile ? { styleProfile: activeExistingVersion.styleProfile } : {}),
          },
        ],
        sectionVersions: nextSectionVersions,
        sources: [...targetNarrative.sources, ...remappedSources],
        claims: [...targetNarrative.claims, ...remappedClaims],
        proposals: [...(targetNarrative.proposals ?? []), ...remappedProposals],
        audit: [
          ...targetNarrative.audit,
          {
            id: makeStableId('audit_append'),
            action: 'append',
            time: now,
            baseRevision: baseTarget.revision,
            resultRevision: baseTarget.revision + 1,
            ...(baseTarget.snapshot.manuscriptVersionId ? { before: baseTarget.snapshot.manuscriptVersionId } : {}),
            after: nextVersionId,
            reason: `Appended "${incomingProject.name}" (${remappedIncomingSections.length} sections, ${addedEntityCount} new entities, ${linkedEntityCount} linked entities).`,
          },
        ],
      },
    },
    `Append "${incomingProject.name}"`,
    `Appended ${remappedIncomingSections.length} section(s) from "${incomingProject.name}"`,
    remappedIncomingSections.length + addedEntityCount
  );

  validateNarrativeRecords(revised);
  const intentId = `append_${targetProject.id}_r${expectedBaseRevision}_${remappedSources[0]?.digest.slice(0, 12) ?? now.toString(36)}`;

  return {
    candidateProject: revised,
    addedSectionCount: remappedIncomingSections.length,
    addedEntityCount,
    linkedEntityCount,
    intentId,
  };
}
