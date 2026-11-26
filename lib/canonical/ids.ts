/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import type { DecisionProvenance, Entity } from '../../shared/types.ts';

let idCounter = 1;

export function makeStableId(prefix: string): string {
  const ts = Date.now().toString(36);
  const seq = (idCounter++).toString(36);
  return `${prefix}_${ts}_${seq}`;
}

export function isUserClearedStoryField(entry: {
  value: string;
  provenance?: DecisionProvenance;
}): boolean {
  return entry.provenance === 'user-edit' && entry.value.trim().length === 0;
}

export function findEntityByRef(entities: Entity[], entityIdOrName: string): Entity | undefined {
  const normTarget = entityIdOrName.trim().toLowerCase();
  return entities.find(
    (e) =>
      e.id === entityIdOrName ||
      e.name.trim().toLowerCase() === normTarget ||
      e.aliases?.some((a) => a.trim().toLowerCase() === normTarget)
  );
}
