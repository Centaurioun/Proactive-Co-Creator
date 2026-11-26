/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { findCandidateEntities, inferEntityCategory } from '../beliefGraphUtils.ts';
import { makeStableId } from '../canonical/ids.ts';
import type {
  BatchEditAmbiguity,
  Entity,
  ProjectSnapshot,
  ProposedOperation,
} from '../../shared/types.ts';

export interface ClauseParseContext {
  clause: string;
  lower: string;
  snapshot: ProjectSnapshot;
  activeEntities: Entity[];
  characterEntities: Entity[];
  operations: ProposedOperation[];
  ambiguities: BatchEditAmbiguity[];
}

export function capitalizeWords(str: string): string {
  if (!str) return str;
  return str.charAt(0).toUpperCase() + str.slice(1);
}

export function classifyTraitToAttribute(trait: string): {
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

function resolveEntityOrRecordAmbiguity(
  rawName: string,
  clause: string,
  activeEntities: Entity[],
  ambiguities: BatchEditAmbiguity[],
  questionBuilder: (candidates: Entity[]) => string
): { resolved: Entity | undefined; ambiguous: boolean } {
  const candidates = findCandidateEntities(rawName, activeEntities);
  if (candidates.length > 1) {
    ambiguities.push({
      phrase: clause,
      reason: `Entity reference "${rawName}" matches multiple entities: ${candidates.map((c) => c.name).join(', ')}.`,
      candidates: candidates.map((c) => c.name),
      clarifyingQuestion: questionBuilder(candidates),
    });
    return { resolved: undefined, ambiguous: true };
  }
  return { resolved: candidates[0], ambiguous: false };
}

function tryParsePronounAmbiguity(ctx: ClauseParseContext): boolean {
  const pronounMatch = ctx.lower.match(
    /\b(?:make|set|change|keep)\s+(him|her|his|hers|them|their)\s+([a-z0-9\s-]+)/i
  );
  if (!pronounMatch || ctx.characterEntities.length <= 1) return false;
  const namedInClause = ctx.characterEntities.filter((c) =>
    ctx.lower.includes(c.name.toLowerCase())
  );
  if (namedInClause.length > 0) return false;

  ctx.ambiguities.push({
    phrase: ctx.clause,
    reason: `Pronoun "${pronounMatch[1]}" could refer to multiple characters in the project.`,
    candidates: ctx.characterEntities.map((c) => c.name),
    clarifyingQuestion: `Which character should "${ctx.clause}" apply to? (${ctx.characterEntities.map((c) => c.name).join(', ')})`,
  });
  return true;
}

function tryParseSettingClause(ctx: ClauseParseContext): boolean {
  const settingMatch = ctx.clause.match(
    /^(?:change|set|move|make)\s+(?:the\s+)?(?:party\s+|story\s+)?(?:setting|location|venue|scene)\s+(?:to|into|as)\s+(.+)$/i
  );
  if (!settingMatch) return false;

  const nextSetting = settingMatch[1].replace(/[.]+$/, '').trim();
  ctx.operations.push({
    id: makeStableId('op'),
    type: 'update_story_bible',
    summary: `Story Setting: ${ctx.snapshot.storyBible.setting.value || 'Unspecified'} → ${nextSetting}`,
    storyField: 'setting',
    previousValue: ctx.snapshot.storyBible.setting.value || 'Unspecified',
    nextValue: nextSetting,
    selected: true,
  });

  const locationEnt = ctx.activeEntities.find((e) => inferEntityCategory(e) === 'location');
  if (locationEnt) {
    ctx.operations.push({
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
  return true;
}

function tryParseToneOrGenreClause(ctx: ClauseParseContext): boolean {
  const toneRatherMatch = ctx.clause.match(
    /^(?:(?:change|set|make)\s+)?(?:the\s+)?(?:party|story|mood|tone|atmosphere)\s+(?:should\s+be|is|becomes|to|as)\s+([a-z0-9\s-]+?)(?:\s+rather\s+than\s+[a-z0-9\s-]+|\s+instead\s+of\s+[a-z0-9\s-]+)?$/i
  );
  if (toneRatherMatch) {
    const nextTone = toneRatherMatch[1].trim();
    ctx.operations.push({
      id: makeStableId('op'),
      type: 'update_story_bible',
      summary: `Story Tone: ${ctx.snapshot.storyBible.tone.value || 'Unspecified'} → ${nextTone}`,
      storyField: 'tone',
      previousValue: ctx.snapshot.storyBible.tone.value || 'Unspecified',
      nextValue: nextTone,
      selected: true,
    });
    return true;
  }

  const genreMatch = ctx.clause.match(
    /^(?:change|set|make)\s+(?:the\s+)?(?:story\s+)?genre\s+(?:to|as)\s+(.+)$/i
  );
  if (genreMatch) {
    const nextGenre = genreMatch[1].trim();
    ctx.operations.push({
      id: makeStableId('op'),
      type: 'update_story_bible',
      summary: `Story Genre: ${ctx.snapshot.storyBible.genre.value || 'Unspecified'} → ${nextGenre}`,
      storyField: 'genre',
      previousValue: ctx.snapshot.storyBible.genre.value || 'Unspecified',
      nextValue: nextGenre,
      selected: true,
    });
    return true;
  }

  return false;
}

function tryParseGroupTraitClause(ctx: ClauseParseContext): boolean {
  const groupMatchA = ctx.clause.match(
    /^(?:make|set|keep)\s+all\s+(?:the\s+)?(?:animal\s+)?(guests|friends|characters|animals)\s+([a-z0-9\s-]+?)(?:,?\s*(?:except|but\s+not)\s+(?:for\s+)?(?:the\s+)?([a-z0-9\s]+))?$/i
  );
  const groupMatchB = ctx.clause.match(
    /^all\s+(?:the\s+)?(?:animal\s+)?(guests|friends|characters|animals)\s+(?:should\s+be|are|become)\s+([a-z0-9\s-]+?)(?:,?\s*(?:except|but\s+not)\s+(?:for\s+)?(?:the\s+)?([a-z0-9\s]+))?$/i
  );

  const groupMatch = groupMatchA ?? groupMatchB;
  if (!groupMatch) return false;

  const groupNoun = groupMatch[1].toLowerCase();
  const rawTrait = groupMatch[2].trim();
  const exceptionRaw = groupMatch[3]?.trim().toLowerCase();
  const { attributeName, attributeValue } = classifyTraitToAttribute(rawTrait);

  let members = ctx.characterEntities.filter((e) => {
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
    const cleanTarget = exceptionRaw.replace(/^(the|a|an)\s+/, '').trim();
    const existingException = ctx.activeEntities.find(
      (e) => e.name.toLowerCase() === cleanTarget
    );
    if (!existingException && exceptionRaw.length > 1) {
      const cleanExcName = capitalizeWords(cleanTarget);
      ctx.operations.push({
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
    ctx.operations.push({
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
  return true;
}

function tryParseRelationshipBetweenClause(ctx: ClauseParseContext): boolean {
  const relBetweenMatch = ctx.clause.match(
    /^(?:introduce|add|create|establish)\s+(?:a\s+|an\s+)?([a-z0-9\s-]+?)\s+between\s+(?:the\s+)?([a-z0-9\s]+?)\s+and\s+(?:the\s+)?([a-z0-9\s]+)$/i
  );
  if (!relBetweenMatch) return false;

  const relLabel = relBetweenMatch[1].trim();
  const rawA = relBetweenMatch[2].replace(/^(the|a|an)\s+/i, '').trim();
  const rawB = relBetweenMatch[3].replace(/^(the|a|an)\s+/i, '').trim();

  const resA = resolveEntityOrRecordAmbiguity(
    rawA,
    ctx.clause,
    ctx.activeEntities,
    ctx.ambiguities,
    () => `Which entity did you mean by "${rawA}"?`
  );
  if (resA.ambiguous) return true;

  const resB = resolveEntityOrRecordAmbiguity(
    rawB,
    ctx.clause,
    ctx.activeEntities,
    ctx.ambiguities,
    () => `Which entity did you mean by "${rawB}"?`
  );
  if (resB.ambiguous) return true;

  const nameA = resA.resolved?.name ?? capitalizeWords(rawA);
  const nameB = resB.resolved?.name ?? capitalizeWords(rawB);

  const existingSameDir = ctx.snapshot.relationships.find(
    (r) =>
      r.source.toLowerCase() === nameA.toLowerCase() &&
      r.target.toLowerCase() === nameB.toLowerCase() &&
      r.label.toLowerCase() === relLabel.toLowerCase()
  );

  ctx.operations.push({
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
  return true;
}

function tryParseDirectedRelationshipClause(ctx: ClauseParseContext): boolean {
  const directedRelAsMatch = ctx.clause.match(
    /^(?:relate|connect|link)\s+(?:the\s+)?([a-z0-9\s]+?)\s+to\s+(?:the\s+)?([a-z0-9\s]+?)\s+as\s+([a-z0-9\s_-]+)$/i
  );
  const directedVerbMatch = !directedRelAsMatch
    ? ctx.clause.match(
        /^(?:make|have)\s+(?:the\s+)?([a-z0-9\s]+?)\s+(fear|distrust|admire|envy|trust|protect|resent|mentor|watch\s+closely|suspect|help|rival)\s+(?:the\s+)?([a-z0-9\s]+)$/i
      )
    : null;

  if (!directedRelAsMatch && !directedVerbMatch) return false;

  const rawA = (directedRelAsMatch ? directedRelAsMatch[1] : directedVerbMatch![1]).trim();
  const rawB = (directedRelAsMatch ? directedRelAsMatch[2] : directedVerbMatch![3]).trim();
  const relLabel = (directedRelAsMatch ? directedRelAsMatch[3] : directedVerbMatch![2]).trim();

  const resA = resolveEntityOrRecordAmbiguity(
    rawA,
    ctx.clause,
    ctx.activeEntities,
    ctx.ambiguities,
    () => `Which entity did you mean by "${rawA}"?`
  );
  if (resA.ambiguous) return true;

  const resB = resolveEntityOrRecordAmbiguity(
    rawB,
    ctx.clause,
    ctx.activeEntities,
    ctx.ambiguities,
    () => `Which entity did you mean by "${rawB}"?`
  );
  if (resB.ambiguous) return true;

  if (resA.resolved && resB.resolved) {
    ctx.operations.push({
      id: makeStableId('op'),
      type: 'add_relationship',
      summary: `Directed Relationship (${resA.resolved.name} → ${resB.resolved.name}): ${relLabel}`,
      sourceEntityName: resA.resolved.name,
      targetEntityName: resB.resolved.name,
      previousValue: 'None',
      nextValue: relLabel,
      selected: true,
    });
    return true;
  }
  return false;
}

function tryParseExcludeOrRenameClause(ctx: ClauseParseContext): boolean {
  const excludeMatch = ctx.clause.match(/^(?:remove|exclude|delete|omit)\s+(?:the\s+)?([a-z0-9\s]+)$/i);
  if (excludeMatch) {
    const targetRaw = excludeMatch[1].trim();
    const res = resolveEntityOrRecordAmbiguity(
      targetRaw,
      ctx.clause,
      ctx.activeEntities,
      ctx.ambiguities,
      (candidates) => `Which entity should be excluded? (${candidates.map((c) => c.name).join(', ')})`
    );
    if (res.ambiguous) return true;

    const ent = res.resolved;
    const name = ent?.name ?? capitalizeWords(targetRaw);
    ctx.operations.push({
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
    return true;
  }

  const renameMatch = ctx.clause.match(/^rename\s+(?:the\s+)?([a-z0-9\s]+?)\s+to\s+([a-z0-9\s]+)$/i);
  if (renameMatch) {
    const oldRaw = renameMatch[1].trim();
    const newRaw = renameMatch[2].trim();
    const res = resolveEntityOrRecordAmbiguity(
      oldRaw,
      ctx.clause,
      ctx.activeEntities,
      ctx.ambiguities,
      () => `Which entity should be renamed to "${newRaw}"?`
    );
    if (res.ambiguous) return true;

    const ent = res.resolved;
    if (ent) {
      ctx.operations.push({
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
      return true;
    }
  }

  return false;
}

function tryParseAddEntityClause(ctx: ClauseParseContext): boolean {
  const addEntMatch = ctx.clause.match(
    /^(?:add|introduce)\s+(?:a\s+|an\s+)?(?:new\s+)?(?:(character|guest|location|object|event)\s+)?(?:named\s+|called\s+)?([A-Z][a-z0-9\s-]*|[a-z0-9\s-]+)$/i
  );
  if (
    !addEntMatch ||
    ctx.lower.includes(' between ') ||
    (!addEntMatch[1] && !/\b(?:named|called)\b/i.test(ctx.clause))
  ) {
    return false;
  }

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
  if (!cleanName) return false;

  ctx.operations.push({
    id: makeStableId('op'),
    type: 'add_entity',
    summary: `Add ${capitalizeWords(category)}: ${cleanName}`,
    entityName: cleanName,
    entityCategory: category,
    previousValue: 'Absent',
    nextValue: 'Present',
    selected: true,
  });
  return true;
}

function tryParseTargetedAttributeClause(ctx: ClauseParseContext): boolean {
  const targetedMatch = ctx.clause.match(
    /^(?:make|keep|set)\s+(?:the\s+)?([a-z0-9\s]+?)\s+(young|elderly|old|ancient|middle-aged|mysterious|friendly|mischievous|gracious|shy|cautious|sly|cheerful|grumpy|[a-z0-9\s-]+)$/i
  );
  if (!targetedMatch) return false;

  const rawEntity = targetedMatch[1].trim();
  const rawTrait = targetedMatch[2].trim();
  const res = resolveEntityOrRecordAmbiguity(
    rawEntity,
    ctx.clause,
    ctx.activeEntities,
    ctx.ambiguities,
    (candidates) => `Which entity should "${ctx.clause}" apply to? (${candidates.map((c) => c.name).join(', ')})`
  );
  if (res.ambiguous) return true;

  const matchedEntity = res.resolved;
  if (!matchedEntity) return false;

  const { attributeName, attributeValue } = classifyTraitToAttribute(rawTrait);
  const existingAttr = matchedEntity.attributes.find(
    (a) => a.name.toLowerCase() === attributeName.toLowerCase()
  );
  const prevVal = existingAttr?.confirmedValue ?? existingAttr?.value[0]?.name ?? 'Unknown';
  const existingOpIdx = ctx.operations.findIndex(
    (op) =>
      op.type === 'set_attribute' &&
      op.entityName?.toLowerCase() === matchedEntity.name.toLowerCase() &&
      op.attributeName?.toLowerCase() === attributeName.toLowerCase() &&
      op.nextValue?.toLowerCase() !== capitalizeWords(attributeValue).toLowerCase()
  );

  if (existingOpIdx >= 0 && ctx.lower.startsWith('keep ')) {
    ctx.operations.splice(existingOpIdx, 1);
  }

  ctx.operations.push({
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
  return true;
}

const CLAUSE_PARSERS = [
  tryParsePronounAmbiguity,
  tryParseSettingClause,
  tryParseToneOrGenreClause,
  tryParseGroupTraitClause,
  tryParseRelationshipBetweenClause,
  tryParseDirectedRelationshipClause,
  tryParseExcludeOrRenameClause,
  tryParseAddEntityClause,
  tryParseTargetedAttributeClause,
];

export function parseSingleClause(
  clause: string,
  _clauseId: string,
  snapshot: ProjectSnapshot,
  activeEntities: Entity[],
  characterEntities: Entity[],
  operations: ProposedOperation[],
  ambiguities: BatchEditAmbiguity[]
): void {
  const ctx: ClauseParseContext = {
    clause,
    lower: clause.toLowerCase(),
    snapshot,
    activeEntities,
    characterEntities,
    operations,
    ambiguities,
  };
  for (const parser of CLAUSE_PARSERS) {
    if (parser(ctx)) return;
  }
}
