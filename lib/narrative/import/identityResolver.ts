import type { VerifiedExtraction } from './proposalValidator.ts';

function normalize(value: string): string {
  return value.normalize('NFKC').trim().toLocaleLowerCase('tr').replace(/\s+/g, ' ');
}

export interface IdentityMatchProposal {
  leftId: string;
  rightId: string;
  matchedName: string;
  reason: 'same-name' | 'alias-overlap';
  status: 'unresolved';
}

/** Finds possible cross-chunk identity collisions but never merges a pair. */
export function findPossibleIdentityMatches(entities: VerifiedExtraction['entities']): IdentityMatchProposal[] {
  const matches: IdentityMatchProposal[] = [];
  for (let leftIndex = 0; leftIndex < entities.length; leftIndex += 1) {
    const left = entities[leftIndex];
    for (let rightIndex = leftIndex + 1; rightIndex < entities.length; rightIndex += 1) {
      const right = entities[rightIndex];
      if (left.id === right.id || left.category !== right.category) continue;
      const leftName = normalize(left.name);
      const rightName = normalize(right.name);
      if (!leftName || !rightName) continue;
      const leftAliases = new Set(left.aliases.map(normalize).filter(Boolean));
      const rightAliases = new Set(right.aliases.map(normalize).filter(Boolean));
      const exactAliasOverlap = leftAliases.has(rightName) || rightAliases.has(leftName) ||
        [...leftAliases].some(alias => rightAliases.has(alias));
      if (leftName === rightName || exactAliasOverlap) matches.push({
        leftId: left.id, rightId: right.id,
        matchedName: leftName === rightName ? left.name : (leftAliases.has(rightName) ? right.name : left.name),
        reason: leftName === rightName ? 'same-name' : 'alias-overlap', status: 'unresolved',
      });
    }
  }
  return matches;
}
