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
import { inferEntityCategory, isSceneEntityName } from './beliefGraphUtils.ts';
import type {
  BatchEditAmbiguity,
  BatchEditProposalResult,
  Entity,
  ProjectSnapshot,
  ProposedOperation,
  StoryBibleFields,
} from '../shared/types.ts';

/**
 * Deterministic local natural-language batch instruction interpreter.
 * Parses multi-clause creative instructions into structured ProposedOperations,
 * resolves group memberships ("all animal guests", "all characters except the cat"),
 * detects pronoun ambiguities ("make him older"), and flags contradictions.
 */
export function interpretBatchInstructionLocally(
  instruction: string,
  snapshot: ProjectSnapshot
): BatchEditProposalResult {
  const trimmed = instruction.trim();
  const operations: ProposedOperation[] = [];
  const ambiguities: BatchEditAmbiguity[] = [];
  const warnings: string[] = [];

  if (!trimmed) {
    return { instruction: trimmed, operations, ambiguities, warnings };
  }

  const activeEntities = snapshot.entities.filter(
    (e) => !isSceneEntityName(e.name) && e.category !== 'scene' && !e.excluded
  );
  const characterEntities = activeEntities.filter(
    (e) => inferEntityCategory(e) === 'character'
  );

  // Split into sentences / clauses while keeping "but" / "except" attached when needed
  const sentences = trimmed
    .split(/(?:\.\s+|\n+|;\s*)/)
    .map((s) => s.replace(/[.!?]+$/, '').trim())
    .filter(Boolean);

  for (const sentence of sentences) {
    const lower = sentence.toLowerCase();

    // 1. Check for ambiguous pronouns ("make him ...", "make her ...", "make them ...")
    const pronounMatch = lower.match(/\b(?:make|set|change|keep)\s+(him|her|his|hers)\s+([a-z0-9\s-]+)/i);
    if (pronounMatch && characterEntities.length > 1) {
      // Check if an explicit character name is also in the same sentence
      const namedInSentence = characterEntities.filter((c) =>
        lower.includes(c.name.toLowerCase())
      );
      if (namedInSentence.length === 0) {
        ambiguities.push({
          phrase: sentence,
          reason: `Pronoun "${pronounMatch[1]}" could refer to multiple characters in the project.`,
          candidates: characterEntities.map((c) => c.name),
          clarifyingQuestion: `Which character should "${sentence}" apply to? (${characterEntities.map((c) => c.name).join(', ')})`,
        });
        continue;
      }
    }

    // 2. Check for "Change/Set the [party] setting/location to X" or "The party should be X rather than Y"
    const settingMatch = sentence.match(
      /(?:change|set|move|make)\s+(?:the\s+)?(?:party\s+|story\s+)?(?:setting|location|venue|scene)\s+(?:to|into|as)\s+(.+)/i
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
      continue;
    }

    // 3. Check for tone/mood instruction: "The party/story should be X rather than Y" or "Change tone to X"
    const toneRatherMatch = sentence.match(
      /(?:the\s+)?(?:party|story|mood|tone|atmosphere)\s+(?:should\s+be|is|becomes)\s+([a-z0-9\s-]+?)(?:\s+rather\s+than\s+[a-z0-9\s-]+|\s+instead\s+of\s+[a-z0-9\s-]+)?$/i
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
      continue;
    }

    // 4. Split sub-clauses on ", but " or " and " when they contain independent verbs
    const subClauses = sentence
      .split(/,\s*but\s+|\s+and\s+(?=(?:make|keep|introduce|add|remove|exclude|change|set)\b)/i)
      .map((c) => c.trim())
      .filter(Boolean);

    for (const clause of subClauses) {
      parseSingleClause(clause, snapshot, activeEntities, characterEntities, operations);
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

  return {
    instruction: trimmed,
    operations,
    ambiguities,
    warnings,
  };
}

function parseSingleClause(
  clause: string,
  snapshot: ProjectSnapshot,
  activeEntities: Entity[],
  characterEntities: Entity[],
  operations: ProposedOperation[]
): void {
  const lower = clause.toLowerCase();

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

  // B. Introduce / add relationship: "introduce a [hidden] <label> between [the] <entityA> and [the] <entityB>"
  const relBetweenMatch = clause.match(
    /(?:introduce|add|create|establish)\s+(?:a\s+|an\s+)?([a-z0-9\s-]+?)\s+between\s+(?:the\s+)?([a-z0-9\s]+?)\s+and\s+(?:the\s+)?([a-z0-9\s]+)$/i
  );
  if (relBetweenMatch) {
    const relLabel = relBetweenMatch[1].trim();
    const rawA = relBetweenMatch[2].replace(/^(the|a|an)\s+/i, '').trim();
    const rawB = relBetweenMatch[3].replace(/^(the|a|an)\s+/i, '').trim();
    const entA = findMatchingEntity(rawA, activeEntities);
    const entB = findMatchingEntity(rawB, activeEntities);
    const nameA = entA?.name ?? capitalizeWords(rawA);
    const nameB = entB?.name ?? capitalizeWords(rawB);

    const existingRel = snapshot.relationships.find(
      (r) =>
        (r.source.toLowerCase() === nameA.toLowerCase() &&
          r.target.toLowerCase() === nameB.toLowerCase()) ||
        (r.source.toLowerCase() === nameB.toLowerCase() &&
          r.target.toLowerCase() === nameA.toLowerCase())
    );

    operations.push({
      id: makeStableId('op'),
      type: existingRel ? 'update_relationship' : 'add_relationship',
      summary: `Relationship (${nameA} ↔ ${nameB}): ${existingRel?.label ?? 'None'} → ${relLabel}`,
      sourceEntityName: nameA,
      targetEntityName: nameB,
      relationshipId: existingRel?.id,
      previousValue: existingRel?.label ?? 'None',
      nextValue: relLabel,
      selected: true,
    });
    return;
  }

  // C. Remove / exclude entity: "remove/exclude [the] <entity>"
  const excludeMatch = clause.match(/^(?:remove|exclude|delete|omit)\s+(?:the\s+)?([a-z0-9\s]+)$/i);
  if (excludeMatch) {
    const targetRaw = excludeMatch[1].trim();
    const ent = findMatchingEntity(targetRaw, activeEntities);
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
    const ent = findMatchingEntity(oldRaw, activeEntities);
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

  // E. Targeted entity attribute edit: "(make|keep|set) [the] <entity> <trait>"
  const targetedMatch = clause.match(
    /^(?:make|keep|set)\s+(?:the\s+)?([a-z0-9\s]+?)\s+(young|elderly|old|ancient|middle-aged|mysterious|friendly|mischievous|gracious|shy|cautious|sly|cheerful|grumpy|[a-z0-9\s-]+)$/i
  );
  if (targetedMatch) {
    const rawEntity = targetedMatch[1].trim();
    const rawTrait = targetedMatch[2].trim();
    const matchedEntity = findMatchingEntity(rawEntity, activeEntities);

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
      if (
        existingOpIdx >= 0 &&
        lower.startsWith('keep ')
      ) {
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
  const clean = rawName.toLowerCase().replace(/^(the|a|an)\s+/, '').trim();
  return entities.find(
    (e) =>
      e.name.toLowerCase() === clean ||
      e.name.toLowerCase().replace(/^(the|a|an)\s+/, '').trim() === clean ||
      e.aliases?.some((a) => a.toLowerCase().replace(/^(the|a|an)\s+/, '').trim() === clean)
  );
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
 * Applies all selected ProposedOperations as a single atomic transaction on a ProjectSnapshot.
 */
export function applyProposedOperations(
  snapshot: ProjectSnapshot,
  operations: ProposedOperation[]
): { snapshot: ProjectSnapshot; appliedCount: number } {
  const selectedOps = operations.filter((op) => op.selected);
  if (selectedOps.length === 0) {
    return { snapshot, appliedCount: 0 };
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
            'user-edit'
          );
          appliedCount++;
        }
        break;
      }
      case 'remove_relationship': {
        if (op.sourceEntityName && op.targetEntityName) {
          next = removeRelationship(next, op.sourceEntityName, op.targetEntityName);
          appliedCount++;
        } else if (op.relationshipId) {
          next = removeRelationship(next, op.relationshipId);
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

  return { snapshot: next, appliedCount };
}
