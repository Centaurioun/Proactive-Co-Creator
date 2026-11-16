/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import {
  addEntity,
  makeStableId,
  removeRelationship,
  renameEntity,
  setEntityAttribute,
  setEntityExistence,
  updateStoryBibleField,
  upsertRelationship,
} from './canonicalModel.ts';
import {
  findCandidateEntities,
  inferEntityCategory,
  isSceneEntityName,
} from './beliefGraphUtils.ts';
import type {
  BatchEditAmbiguity,
  BatchEditProposalResult,
  BatchInstructionClause,
  BatchValidationIssue,
  Entity,
  ProjectSnapshot,
  ProposedOperation,
  StoryBibleFields,
} from '../shared/types.ts';

/**
 * Deterministic local natural-language batch instruction interpreter.
 * Parses multi-clause creative instructions into structured ProposedOperations,
 * resolves group memberships ("all animal guests", "all characters except the cat"),
 * detects pronoun and partial-name ambiguities ("make him older"), flags contradictions,
 * and explicitly reports unhandled clauses so no instruction segment is silently dropped.
 */
export function interpretBatchInstructionLocally(
  instruction: string,
  snapshot: ProjectSnapshot,
  baseMeta?: { projectId?: string; revision?: number }
): BatchEditProposalResult {
  const trimmed = instruction.trim();
  const operations: ProposedOperation[] = [];
  const ambiguities: BatchEditAmbiguity[] = [];
  const warnings: string[] = [];
  const clauses: BatchInstructionClause[] = [];
  const unhandledClauses: string[] = [];

  if (!trimmed) {
    return {
      instruction: trimmed,
      operations,
      ambiguities,
      warnings,
      clauses,
      unhandledClauses,
      coverageComplete: false,
      baseProjectId: baseMeta?.projectId,
      baseRevision: baseMeta?.revision,
    };
  }

  const activeEntities = snapshot.entities.filter(
    (e) => !isSceneEntityName(e.name) && e.category !== 'scene' && !e.excluded && e.status !== 'rejected'
  );
  const characterEntities = activeEntities.filter(
    (e) => inferEntityCategory(e) === 'character'
  );

  // Split into sentences / clauses while keeping "but" / "except" attached when needed
  const sentences = trimmed
    .split(/(?:\.\s+|\n+|;\s*)/)
    .map((s) => s.replace(/[.!?]+$/, '').trim())
    .filter(Boolean);

  let clauseSeq = 1;

  for (const sentence of sentences) {
    // Split sub-clauses on ", but " or " and " when they contain independent verbs
    const subClauses = sentence
      .split(
        /,\s*but\s+|\s+and\s+(?=(?:make|keep|introduce|add|remove|exclude|delete|omit|change|set|move|rename|relate|connect|link|have)\b)/i
      )
      .map((c) => c.trim())
      .filter(Boolean);

    for (const rawClause of subClauses) {
      const clauseId = `clause_${clauseSeq++}`;
      const opsBefore = operations.length;
      const ambBefore = ambiguities.length;

      parseSingleClause(
        rawClause,
        clauseId,
        snapshot,
        activeEntities,
        characterEntities,
        operations,
        ambiguities
      );

      const producedOps = operations.slice(opsBefore);
      const producedAmb = ambiguities.slice(ambBefore);

      if (producedOps.length > 0) {
        for (const op of producedOps) {
          op.clauseId = clauseId;
          op.clauseText = rawClause;
        }
        clauses.push({
          id: clauseId,
          text: rawClause,
          status: 'parsed',
          operationIds: producedOps.map((op) => op.id),
        });
      } else if (producedAmb.length > 0) {
        clauses.push({
          id: clauseId,
          text: rawClause,
          status: 'ambiguous',
          operationIds: [],
          reason: producedAmb[0].reason,
        });
      } else {
        unhandledClauses.push(rawClause);
        const warningMsg = `Unhandled instruction clause: "${rawClause}" could not be mapped to a valid entity, attribute, relationship, or Story Bible field.`;
        if (!warnings.includes(warningMsg)) {
          warnings.push(warningMsg);
        }
        clauses.push({
          id: clauseId,
          text: rawClause,
          status: 'unhandled',
          operationIds: [],
          reason: 'Could not map this clause to a known entity, attribute, relationship, or Story Bible field.',
        });
      }
    }
  }

  // Enrich previousValues and detect contradictions across operations
  const targetValues = new Map<string, string>();
  for (const op of operations) {
    if (op.type === 'set_attribute' && op.entityName && op.attributeName && op.nextValue) {
      const key = `${op.entityName.toLowerCase()}::${op.attributeName.toLowerCase()}`;
      const prior = targetValues.get(key);
      if (prior && prior.toLowerCase() !== op.nextValue.toLowerCase()) {
        const msg = `Contradictory edits for ${op.entityName} → ${op.attributeName}: "${prior}" vs "${op.nextValue}".`;
        op.conflictWarning = msg;
        if (!warnings.includes(msg)) warnings.push(msg);
      }
      targetValues.set(key, op.nextValue);
    }
  }

  const coverageComplete =
    operations.length > 0 && unhandledClauses.length === 0 && ambiguities.length === 0;

  return {
    instruction: trimmed,
    operations,
    ambiguities,
    warnings,
    clauses,
    unhandledClauses,
    coverageComplete,
    baseProjectId: baseMeta?.projectId,
    baseRevision: baseMeta?.revision,
  };
}

function parseSingleClause(
  clause: string,
  _clauseId: string,
  snapshot: ProjectSnapshot,
  activeEntities: Entity[],
  characterEntities: Entity[],
  operations: ProposedOperation[],
  ambiguities: BatchEditAmbiguity[]
): void {
  const lower = clause.toLowerCase();

  // 1. Check for ambiguous pronouns ("make him ...", "make her ...", "make them ...")
  const pronounMatch = lower.match(/\b(?:make|set|change|keep)\s+(him|her|his|hers|them|their)\s+([a-z0-9\s-]+)/i);
  if (pronounMatch && characterEntities.length > 1) {
    const namedInClause = characterEntities.filter((c) =>
      lower.includes(c.name.toLowerCase())
    );
    if (namedInClause.length === 0) {
      ambiguities.push({
        phrase: clause,
        reason: `Pronoun "${pronounMatch[1]}" could refer to multiple characters in the project.`,
        candidates: characterEntities.map((c) => c.name),
        clarifyingQuestion: `Which character should "${clause}" apply to? (${characterEntities.map((c) => c.name).join(', ')})`,
      });
      return;
    }
  }

  // 2. Check for "Change/Set the [party] setting/location to X"
  const settingMatch = clause.match(
    /^(?:change|set|move|make)\s+(?:the\s+)?(?:party\s+|story\s+)?(?:setting|location|venue|scene)\s+(?:to|into|as)\s+(.+)$/i
  );
  if (settingMatch) {
    const nextSetting = settingMatch[1].replace(/[.]+$/, '').trim();
    operations.push({
      id: makeStableId('op'),
      type: 'update_story_bible',
      summary: `Story Setting: ${snapshot.storyBible.setting.value || 'Unspecified'} → ${nextSetting}`,
      storyField: 'setting',
      previousValue: snapshot.storyBible.setting.value || 'Unspecified',
      nextValue: nextSetting,
      selected: true,
    });

    const locationEnt = activeEntities.find((e) => inferEntityCategory(e) === 'location');
    if (locationEnt) {
      operations.push({
        id: makeStableId('op'),
        type: 'rename_entity',
        summary: `Location Entity: ${locationEnt.name} → ${nextSetting}`,
        entityId: locationEnt.id,
        entityName: locationEnt.name,
        newEntityName: nextSetting,
        previousValue: locationEnt.name,
        nextValue: nextSetting,
        selected: true,
      });
    }
    return;
  }

  // 3. Check for tone/mood/genre instruction: "The party/story should be X rather than Y" or "Change tone/genre to X"
  const toneRatherMatch = clause.match(
    /^(?:(?:change|set|make)\s+)?(?:the\s+)?(?:party|story|mood|tone|atmosphere)\s+(?:should\s+be|is|becomes|to|as)\s+([a-z0-9\s-]+?)(?:\s+rather\s+than\s+[a-z0-9\s-]+|\s+instead\s+of\s+[a-z0-9\s-]+)?$/i
  );
  if (toneRatherMatch) {
    const nextTone = toneRatherMatch[1].trim();
    operations.push({
      id: makeStableId('op'),
      type: 'update_story_bible',
      summary: `Story Tone: ${snapshot.storyBible.tone.value || 'Unspecified'} → ${nextTone}`,
      storyField: 'tone',
      previousValue: snapshot.storyBible.tone.value || 'Unspecified',
      nextValue: nextTone,
      selected: true,
    });
    return;
  }

  const genreMatch = clause.match(
    /^(?:change|set|make)\s+(?:the\s+)?(?:story\s+)?genre\s+(?:to|as)\s+(.+)$/i
  );
  if (genreMatch) {
    const nextGenre = genreMatch[1].trim();
    operations.push({
      id: makeStableId('op'),
      type: 'update_story_bible',
      summary: `Story Genre: ${snapshot.storyBible.genre.value || 'Unspecified'} → ${nextGenre}`,
      storyField: 'genre',
      previousValue: snapshot.storyBible.genre.value || 'Unspecified',
      nextValue: nextGenre,
      selected: true,
    });
    return;
  }

  // A. Group operations: "Make all [the] [animal] guests/friends/characters <value>[, except <exception>]"
  // or "All guests should be <value>, except <exception>"
  const groupMatchA = clause.match(
    /^(?:make|set|keep)\s+all\s+(?:the\s+)?(?:animal\s+)?(guests|friends|characters|animals)\s+([a-z0-9\s-]+?)(?:,?\s*(?:except|but\s+not)\s+(?:for\s+)?(?:the\s+)?([a-z0-9\s]+))?$/i
  );
  const groupMatchB = clause.match(
    /^all\s+(?:the\s+)?(?:animal\s+)?(guests|friends|characters|animals)\s+(?:should\s+be|are|become)\s+([a-z0-9\s-]+?)(?:,?\s*(?:except|but\s+not)\s+(?:for\s+)?(?:the\s+)?([a-z0-9\s]+))?$/i
  );

  const groupMatch = groupMatchA ?? groupMatchB;
  if (groupMatch) {
    const groupNoun = groupMatch[1].toLowerCase();
    const rawTrait = groupMatch[2].trim();
    const exceptionRaw = groupMatch[3]?.trim().toLowerCase();

    const { attributeName, attributeValue } = classifyTraitToAttribute(rawTrait);

    // Determine group members: "guests" or "friends" excludes the host ("Cat") by default
    let members = characterEntities.filter((e) => {
      if (groupNoun === 'guests' || groupNoun === 'friends') {
        const roleAttr = e.attributes.find((a) => a.name.toLowerCase() === 'role');
        const isHost =
          e.name.toLowerCase() === 'cat' ||
          roleAttr?.confirmedValue?.toLowerCase().includes('host') ||
          e.description.toLowerCase().includes('host');
        return !isHost;
      }
      return true;
    });

    if (exceptionRaw) {
      members = members.filter(
        (m) => !exceptionRaw.includes(m.name.toLowerCase()) && !m.name.toLowerCase().includes(exceptionRaw)
      );
      // If exception names a character not yet in entities (e.g. "except the wolf"), add or note it
      const existingException = activeEntities.find(
        (e) =>
          e.name.toLowerCase() === exceptionRaw.replace(/^(the|a|an)\s+/, '').trim()
      );
      if (!existingException && exceptionRaw.length > 1) {
        const cleanExcName = capitalizeWords(exceptionRaw.replace(/^(the|a|an)\s+/, '').trim());
        operations.push({
          id: makeStableId('op'),
          type: 'add_entity',
          summary: `Add Character: ${cleanExcName} (excluded from "${rawTrait}")`,
          entityName: cleanExcName,
          entityCategory: 'character',
          previousValue: 'Absent',
          nextValue: 'Present (contrasting guest)',
          selected: true,
        });
      }
    }

    for (const member of members) {
      const existingAttr = member.attributes.find(
        (a) => a.name.toLowerCase() === attributeName.toLowerCase()
      );
      const prevVal = existingAttr?.confirmedValue ?? existingAttr?.value[0]?.name ?? 'Unknown';
      operations.push({
        id: makeStableId('op'),
        type: 'set_attribute',
        summary: `${member.name} → ${capitalizeWords(attributeName)}: ${prevVal} → ${capitalizeWords(attributeValue)}`,
        entityId: member.id,
        entityName: member.name,
        attributeName,
        previousValue: prevVal,
        nextValue: capitalizeWords(attributeValue),
        selected: true,
      });
    }
    return;
  }

  // B1. Introduce / add relationship: "introduce a [hidden] <label> between [the] <entityA> and [the] <entityB>"
  const relBetweenMatch = clause.match(
    /^(?:introduce|add|create|establish)\s+(?:a\s+|an\s+)?([a-z0-9\s-]+?)\s+between\s+(?:the\s+)?([a-z0-9\s]+?)\s+and\s+(?:the\s+)?([a-z0-9\s]+)$/i
  );
  if (relBetweenMatch) {
    const relLabel = relBetweenMatch[1].trim();
    const rawA = relBetweenMatch[2].replace(/^(the|a|an)\s+/i, '').trim();
    const rawB = relBetweenMatch[3].replace(/^(the|a|an)\s+/i, '').trim();
    const candsA = findCandidateEntities(rawA, activeEntities);
    const candsB = findCandidateEntities(rawB, activeEntities);

    if (candsA.length > 1) {
      ambiguities.push({
        phrase: clause,
        reason: `Entity reference "${rawA}" matches multiple entities: ${candsA.map((c) => c.name).join(', ')}.`,
        candidates: candsA.map((c) => c.name),
        clarifyingQuestion: `Which entity did you mean by "${rawA}"?`,
      });
      return;
    }
    if (candsB.length > 1) {
      ambiguities.push({
        phrase: clause,
        reason: `Entity reference "${rawB}" matches multiple entities: ${candsB.map((c) => c.name).join(', ')}.`,
        candidates: candsB.map((c) => c.name),
        clarifyingQuestion: `Which entity did you mean by "${rawB}"?`,
      });
      return;
    }

    const entA = candsA[0];
    const entB = candsB[0];
    const nameA = entA?.name ?? capitalizeWords(rawA);
    const nameB = entB?.name ?? capitalizeWords(rawB);

    const existingSameDir = snapshot.relationships.find(
      (r) =>
        r.source.toLowerCase() === nameA.toLowerCase() &&
        r.target.toLowerCase() === nameB.toLowerCase() &&
        r.label.toLowerCase() === relLabel.toLowerCase()
    );

    operations.push({
      id: makeStableId('op'),
      type: existingSameDir ? 'update_relationship' : 'add_relationship',
      summary: `Directed Relationship (${nameA} → ${nameB}): ${existingSameDir?.label ?? 'New'} → ${relLabel}`,
      sourceEntityName: nameA,
      targetEntityName: nameB,
      relationshipId: existingSameDir?.id,
      previousValue: existingSameDir?.label ?? 'None',
      nextValue: relLabel,
      selected: true,
    });
    return;
  }

  // B2. Directed relationship clause: "relate/connect <A> to <B> as <label>" or "make <A> <verb> <B>"
  const directedRelAsMatch = clause.match(
    /^(?:relate|connect|link)\s+(?:the\s+)?([a-z0-9\s]+?)\s+to\s+(?:the\s+)?([a-z0-9\s]+?)\s+as\s+([a-z0-9\s_-]+)$/i
  );
  if (directedRelAsMatch) {
    const rawA = directedRelAsMatch[1].trim();
    const rawB = directedRelAsMatch[2].trim();
    const relLabel = directedRelAsMatch[3].trim();
    const entA = findMatchingEntity(rawA, activeEntities);
    const entB = findMatchingEntity(rawB, activeEntities);
    if (entA && entB) {
      operations.push({
        id: makeStableId('op'),
        type: 'add_relationship',
        summary: `Directed Relationship (${entA.name} → ${entB.name}): ${relLabel}`,
        sourceEntityName: entA.name,
        targetEntityName: entB.name,
        previousValue: 'None',
        nextValue: relLabel,
        selected: true,
      });
      return;
    }
  }

  const directedVerbMatch = clause.match(
    /^(?:make|have)\s+(?:the\s+)?([a-z0-9\s]+?)\s+(fear|distrust|admire|envy|trust|protect|resent|mentor|watch\s+closely|suspect|help|rival)\s+(?:the\s+)?([a-z0-9\s]+)$/i
  );
  if (directedVerbMatch) {
    const rawA = directedVerbMatch[1].trim();
    const relLabel = directedVerbMatch[2].trim();
    const rawB = directedVerbMatch[3].trim();
    const entA = findMatchingEntity(rawA, activeEntities);
    const entB = findMatchingEntity(rawB, activeEntities);
    if (entA && entB) {
      operations.push({
        id: makeStableId('op'),
        type: 'add_relationship',
        summary: `Directed Relationship (${entA.name} → ${entB.name}): ${relLabel}`,
        sourceEntityName: entA.name,
        targetEntityName: entB.name,
        previousValue: 'None',
        nextValue: relLabel,
        selected: true,
      });
      return;
    }
  }

  // C. Remove / exclude entity: "remove/exclude [the] <entity>"
  const excludeMatch = clause.match(/^(?:remove|exclude|delete|omit)\s+(?:the\s+)?([a-z0-9\s]+)$/i);
  if (excludeMatch) {
    const targetRaw = excludeMatch[1].trim();
    const candidates = findCandidateEntities(targetRaw, activeEntities);
    if (candidates.length > 1) {
      ambiguities.push({
        phrase: clause,
        reason: `Entity reference "${targetRaw}" matches multiple entities: ${candidates.map((c) => c.name).join(', ')}.`,
        candidates: candidates.map((c) => c.name),
        clarifyingQuestion: `Which entity should be excluded? (${candidates.map((c) => c.name).join(', ')})`,
      });
      return;
    }
    const ent = candidates[0];
    const name = ent?.name ?? capitalizeWords(targetRaw);
    operations.push({
      id: makeStableId('op'),
      type: 'exclude_entity',
      summary: `Exclude Entity: ${name} (Present → Absent)`,
      entityId: ent?.id,
      entityName: name,
      previousValue: 'Present',
      nextValue: 'Absent',
      destructive: true,
      selected: true,
    });
    return;
  }

  // D. Rename entity: "rename [the] <oldName> to <newName>"
  const renameMatch = clause.match(/^rename\s+(?:the\s+)?([a-z0-9\s]+?)\s+to\s+([a-z0-9\s]+)$/i);
  if (renameMatch) {
    const oldRaw = renameMatch[1].trim();
    const newRaw = renameMatch[2].trim();
    const candidates = findCandidateEntities(oldRaw, activeEntities);
    if (candidates.length > 1) {
      ambiguities.push({
        phrase: clause,
        reason: `Entity reference "${oldRaw}" matches multiple entities: ${candidates.map((c) => c.name).join(', ')}.`,
        candidates: candidates.map((c) => c.name),
        clarifyingQuestion: `Which entity should be renamed to "${newRaw}"?`,
      });
      return;
    }
    const ent = candidates[0];
    if (ent) {
      operations.push({
        id: makeStableId('op'),
        type: 'rename_entity',
        summary: `Rename Entity: ${ent.name} → ${newRaw}`,
        entityId: ent.id,
        entityName: ent.name,
        newEntityName: newRaw,
        previousValue: ent.name,
        nextValue: newRaw,
        selected: true,
      });
      return;
    }
  }

  // D2. Add entity: "add/introduce [a] character/guest/location [named] <Name>"
  const addEntMatch = clause.match(
    /^(?:add|introduce)\s+(?:a\s+|an\s+)?(?:new\s+)?(?:(character|guest|location|object|event)\s+)?(?:named\s+|called\s+)?([A-Z][a-z0-9\s-]*|[a-z0-9\s-]+)$/i
  );
  if (
    addEntMatch &&
    !lower.includes(' between ') &&
    (Boolean(addEntMatch[1]) || /\b(?:named|called)\b/i.test(clause))
  ) {
    const rawCat = addEntMatch[1]?.toLowerCase();
    const category =
      rawCat === 'location'
        ? 'location'
        : rawCat === 'object'
          ? 'object'
          : rawCat === 'event'
            ? 'event'
            : 'character';
    const cleanName = capitalizeWords(addEntMatch[2].replace(/^(the|a|an)\s+/i, '').trim());
    if (cleanName) {
      operations.push({
        id: makeStableId('op'),
        type: 'add_entity',
        summary: `Add ${capitalizeWords(category)}: ${cleanName}`,
        entityName: cleanName,
        entityCategory: category,
        previousValue: 'Absent',
        nextValue: 'Present',
        selected: true,
      });
      return;
    }
  }

  // E. Targeted entity attribute edit: "(make|keep|set) [the] <entity> <trait>"
  const targetedMatch = clause.match(
    /^(?:make|keep|set)\s+(?:the\s+)?([a-z0-9\s]+?)\s+(young|elderly|old|ancient|middle-aged|mysterious|friendly|mischievous|gracious|shy|cautious|sly|cheerful|grumpy|[a-z0-9\s-]+)$/i
  );
  if (targetedMatch) {
    const rawEntity = targetedMatch[1].trim();
    const rawTrait = targetedMatch[2].trim();
    const candidates = findCandidateEntities(rawEntity, activeEntities);

    if (candidates.length > 1) {
      ambiguities.push({
        phrase: clause,
        reason: `Entity reference "${rawEntity}" matches multiple entities: ${candidates.map((c) => c.name).join(', ')}.`,
        candidates: candidates.map((c) => c.name),
        clarifyingQuestion: `Which entity should "${clause}" apply to? (${candidates.map((c) => c.name).join(', ')})`,
      });
      return;
    }

    const matchedEntity = candidates[0];
    if (matchedEntity) {
      const { attributeName, attributeValue } = classifyTraitToAttribute(rawTrait);
      const existingAttr = matchedEntity.attributes.find(
        (a) => a.name.toLowerCase() === attributeName.toLowerCase()
      );
      const prevVal = existingAttr?.confirmedValue ?? existingAttr?.value[0]?.name ?? 'Unknown';
      const existingOpIdx = operations.findIndex(
        (op) =>
          op.type === 'set_attribute' &&
          op.entityName?.toLowerCase() === matchedEntity.name.toLowerCase() &&
          op.attributeName?.toLowerCase() === attributeName.toLowerCase() &&
          op.nextValue?.toLowerCase() !== capitalizeWords(attributeValue).toLowerCase()
      );

      // If an earlier group rule in the same instruction set this entity, and this is an explicit "keep the cat young" override, replace or supersede it cleanly unless both were explicit single-entity edits
      if (existingOpIdx >= 0 && lower.startsWith('keep ')) {
        operations.splice(existingOpIdx, 1);
      }

      operations.push({
        id: makeStableId('op'),
        type: 'set_attribute',
        summary: `${matchedEntity.name} → ${capitalizeWords(attributeName)}: ${prevVal} → ${capitalizeWords(attributeValue)}`,
        entityId: matchedEntity.id,
        entityName: matchedEntity.name,
        attributeName,
        previousValue: prevVal,
        nextValue: capitalizeWords(attributeValue),
        selected: true,
      });
    }
  }
}

function findMatchingEntity(rawName: string, entities: Entity[]): Entity | undefined {
  const candidates = findCandidateEntities(rawName, entities);
  return candidates.length === 1 ? candidates[0] : undefined;
}

function classifyTraitToAttribute(trait: string): {
  attributeName: string;
  attributeValue: string;
} {
  const lower = trait.toLowerCase().trim();
  if (/\b(young|elderly|old|ancient|middle-aged|teenage|aged|juvenile|senior)\b/.test(lower)) {
    return { attributeName: 'age', attributeValue: trait.trim() };
  }
  if (/\b(red|blue|orange|black|white|golden|silver|calico|tabby|tuxedo)\b/.test(lower)) {
    return { attributeName: 'color', attributeValue: trait.trim() };
  }
  if (/\b(host|guest|villain|detective|leader|observer)\b/.test(lower)) {
    return { attributeName: 'role', attributeValue: trait.trim() };
  }
  return { attributeName: 'personality', attributeValue: trait.trim() };
}

function capitalizeWords(str: string): string {
  if (!str) return str;
  return str.charAt(0).toUpperCase() + str.slice(1);
}

/**
 * Pre-validates all selected ProposedOperations against the target snapshot and optional revision.
 * Returns a list of validation issues. If non-empty, applyProposedOperations aborts atomically.
 */
export function validateProposedOperations(
  snapshot: ProjectSnapshot,
  operations: ProposedOperation[],
  options?: {
    expectedBaseRevision?: number;
    currentRevision?: number;
  }
): BatchValidationIssue[] {
  const issues: BatchValidationIssue[] = [];
  const selectedOps = operations.filter((op) => op.selected);

  if (
    options?.expectedBaseRevision !== undefined &&
    options?.currentRevision !== undefined &&
    options.expectedBaseRevision !== options.currentRevision
  ) {
    issues.push({
      operationId: 'batch_base',
      code: 'STALE_BASE',
      message: `Batch proposal was built against revision r${options.expectedBaseRevision}, but project is now at revision r${options.currentRevision}.`,
    });
  }

  // Track simulated entity availability across the batch so add_entity / rename_entity / exclude_entity
  // within the same batch are validated accurately.
  const simulatedEntities = snapshot.entities.map((e) => ({
    id: e.id,
    name: e.name,
    aliases: [...(e.aliases ?? [])],
    excluded: Boolean(e.excluded),
    rejected: e.status === 'rejected',
  }));

  const findSimEnt = (ref?: string) => {
    if (!ref) return undefined;
    const norm = ref.trim().toLowerCase();
    return simulatedEntities.find(
      (e) =>
        e.id === ref ||
        e.name.trim().toLowerCase() === norm ||
        e.aliases.some((a) => a.trim().toLowerCase() === norm)
    );
  };

  const seenAttrTargets = new Map<string, string>();
  const excludedInBatch = new Set<string>();

  for (const op of selectedOps) {
    switch (op.type) {
      case 'add_entity': {
        if (!op.entityName || !op.entityName.trim()) {
          issues.push({
            operationId: op.id,
            code: 'INVALID_VALUE',
            message: 'Add entity operation requires a non-empty entityName.',
          });
        } else {
          const existing = findSimEnt(op.entityName);
          if (existing) {
            existing.excluded = false;
            existing.rejected = false;
          } else {
            simulatedEntities.push({
              id: op.entityId ?? `sim_${op.id}`,
              name: op.entityName.trim(),
              aliases: [],
              excluded: false,
              rejected: false,
            });
          }
        }
        break;
      }
      case 'set_attribute':
      case 'add_attribute': {
        const targetRef = op.entityId ?? op.entityName;
        const ent = findSimEnt(targetRef);
        if (!ent || ent.excluded || ent.rejected) {
          issues.push({
            operationId: op.id,
            code: 'MISSING_TARGET',
            message: `Target entity "${op.entityName ?? op.entityId ?? 'Unknown'}" does not exist or is excluded in the current snapshot.`,
          });
          break;
        }
        if (!op.attributeName || !op.attributeName.trim() || !op.nextValue || !op.nextValue.trim()) {
          issues.push({
            operationId: op.id,
            code: 'INVALID_VALUE',
            message: `Attribute operation on "${ent.name}" requires both attributeName and nextValue.`,
          });
          break;
        }
        if (excludedInBatch.has(ent.name.toLowerCase())) {
          issues.push({
            operationId: op.id,
            code: 'CONFLICT',
            message: `Cannot set attribute "${op.attributeName}" on "${ent.name}" because the same batch excludes "${ent.name}".`,
          });
          break;
        }
        const attrKey = `${ent.name.toLowerCase()}::${op.attributeName.trim().toLowerCase()}`;
        const priorVal = seenAttrTargets.get(attrKey);
        if (priorVal && priorVal.toLowerCase() !== op.nextValue.trim().toLowerCase()) {
          issues.push({
            operationId: op.id,
            code: 'CONFLICT',
            message: `Conflicting values for ${ent.name} → ${op.attributeName} in the same batch: "${priorVal}" vs "${op.nextValue.trim()}".`,
          });
        }
        seenAttrTargets.set(attrKey, op.nextValue.trim());
        break;
      }
      case 'rename_entity': {
        const targetRef = op.entityId ?? op.entityName;
        const ent = findSimEnt(targetRef);
        if (!ent || ent.excluded || ent.rejected) {
          issues.push({
            operationId: op.id,
            code: 'MISSING_TARGET',
            message: `Entity "${op.entityName ?? op.entityId ?? 'Unknown'}" cannot be renamed because it does not exist or is excluded.`,
          });
          break;
        }
        if (!op.newEntityName || !op.newEntityName.trim()) {
          issues.push({
            operationId: op.id,
            code: 'INVALID_VALUE',
            message: `Rename operation for "${ent.name}" requires a non-empty newEntityName.`,
          });
          break;
        }
        ent.aliases.push(ent.name);
        ent.name = op.newEntityName.trim();
        break;
      }
      case 'exclude_entity': {
        const targetRef = op.entityId ?? op.entityName;
        const ent = findSimEnt(targetRef);
        if (!ent || ent.rejected) {
          issues.push({
            operationId: op.id,
            code: 'MISSING_TARGET',
            message: `Entity "${op.entityName ?? op.entityId ?? 'Unknown'}" cannot be excluded because it does not exist in the current snapshot.`,
          });
          break;
        }
        // Check if an earlier op in the same batch modified attributes on this entity
        for (const key of seenAttrTargets.keys()) {
          if (key.startsWith(`${ent.name.toLowerCase()}::`)) {
            issues.push({
              operationId: op.id,
              code: 'CONFLICT',
              message: `Cannot exclude "${ent.name}" in the same batch that modifies its attributes.`,
            });
            break;
          }
        }
        ent.excluded = true;
        excludedInBatch.add(ent.name.toLowerCase());
        break;
      }
      case 'add_relationship':
      case 'update_relationship': {
        const srcEnt = findSimEnt(op.sourceEntityName);
        const tgtEnt = findSimEnt(op.targetEntityName);
        if (!srcEnt || srcEnt.excluded || srcEnt.rejected) {
          issues.push({
            operationId: op.id,
            code: 'MISSING_TARGET',
            message: `Relationship source entity "${op.sourceEntityName ?? 'Unknown'}" does not exist or is excluded.`,
          });
        }
        if (!tgtEnt || tgtEnt.excluded || tgtEnt.rejected) {
          issues.push({
            operationId: op.id,
            code: 'MISSING_TARGET',
            message: `Relationship target entity "${op.targetEntityName ?? 'Unknown'}" does not exist or is excluded.`,
          });
        }
        if (!op.nextValue || !op.nextValue.trim()) {
          issues.push({
            operationId: op.id,
            code: 'INVALID_VALUE',
            message: 'Relationship operation requires a non-empty label.',
          });
        }
        break;
      }
      case 'remove_relationship': {
        if (op.relationshipId) {
          const exists = snapshot.relationships.some((r) => r.id === op.relationshipId);
          if (!exists) {
            issues.push({
              operationId: op.id,
              code: 'MISSING_TARGET',
              message: `Relationship "${op.relationshipId}" does not exist in the current snapshot.`,
            });
          }
        } else if (op.sourceEntityName && op.targetEntityName) {
          const sLower = op.sourceEntityName.trim().toLowerCase();
          const tLower = op.targetEntityName.trim().toLowerCase();
          const exists = snapshot.relationships.some(
            (r) => r.source.toLowerCase() === sLower && r.target.toLowerCase() === tLower
          );
          if (!exists) {
            issues.push({
              operationId: op.id,
              code: 'MISSING_TARGET',
              message: `Directed relationship from "${op.sourceEntityName}" to "${op.targetEntityName}" does not exist.`,
            });
          }
        } else {
          issues.push({
            operationId: op.id,
            code: 'MISSING_TARGET',
            message: 'Remove relationship operation is missing target relationship identifiers.',
          });
        }
        break;
      }
      case 'update_story_bible': {
        if (!op.storyField || !op.nextValue || !op.nextValue.trim()) {
          issues.push({
            operationId: op.id,
            code: 'INVALID_VALUE',
            message: 'Story Bible update operation requires a valid storyField and non-empty nextValue.',
          });
        }
        break;
      }
    }
  }

  return issues;
}

/**
 * Applies all selected ProposedOperations as a single atomic transaction on a ProjectSnapshot.
 * Pre-validates every selected operation; if any operation is invalid, stale, or conflicting,
 * aborts with zero partial mutations.
 */
export function applyProposedOperations(
  snapshot: ProjectSnapshot,
  operations: ProposedOperation[],
  options?: {
    expectedBaseRevision?: number;
    currentRevision?: number;
  }
): { snapshot: ProjectSnapshot; appliedCount: number; errors: BatchValidationIssue[] } {
  const selectedOps = operations.filter((op) => op.selected);
  if (selectedOps.length === 0) {
    return { snapshot, appliedCount: 0, errors: [] };
  }

  const errors = validateProposedOperations(snapshot, operations, options);
  if (errors.length > 0) {
    return { snapshot, appliedCount: 0, errors };
  }

  let next = structuredClone(snapshot);
  let appliedCount = 0;

  for (const op of selectedOps) {
    switch (op.type) {
      case 'set_attribute':
      case 'add_attribute': {
        const targetRef = op.entityId ?? op.entityName;
        if (targetRef && op.attributeName && op.nextValue !== undefined) {
          next = setEntityAttribute(
            next,
            targetRef,
            op.attributeName,
            op.nextValue,
            'user-edit'
          );
          appliedCount++;
        }
        break;
      }
      case 'add_entity': {
        if (op.entityName) {
          next = addEntity(
            next,
            op.entityName,
            op.entityCategory ?? 'character',
            op.nextValue ?? '',
            'user-edit'
          );
          appliedCount++;
        }
        break;
      }
      case 'rename_entity': {
        const targetRef = op.entityId ?? op.entityName;
        if (targetRef && op.newEntityName) {
          next = renameEntity(next, targetRef, op.newEntityName, 'user-edit');
          appliedCount++;
        }
        break;
      }
      case 'exclude_entity': {
        const targetRef = op.entityId ?? op.entityName;
        if (targetRef) {
          next = setEntityExistence(next, targetRef, false, 'user-edit');
          appliedCount++;
        }
        break;
      }
      case 'add_relationship':
      case 'update_relationship': {
        if (op.sourceEntityName && op.targetEntityName && op.nextValue) {
          next = upsertRelationship(
            next,
            op.sourceEntityName,
            op.targetEntityName,
            op.nextValue,
            'user-edit',
            { relationshipId: op.relationshipId }
          );
          appliedCount++;
        }
        break;
      }
      case 'remove_relationship': {
        if (op.relationshipId) {
          next = removeRelationship(next, op.relationshipId);
          appliedCount++;
        } else if (op.sourceEntityName && op.targetEntityName) {
          next = removeRelationship(next, op.sourceEntityName, op.targetEntityName);
          appliedCount++;
        }
        break;
      }
      case 'update_story_bible': {
        if (op.storyField && op.nextValue !== undefined) {
          next = updateStoryBibleField(
            next,
            op.storyField as keyof StoryBibleFields,
            op.nextValue,
            'user-edit'
          );
          appliedCount++;
        }
        break;
      }
    }
  }

  return { snapshot: next, appliedCount, errors: [] };
}
