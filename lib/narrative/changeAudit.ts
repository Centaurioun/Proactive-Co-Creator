import type { ArtifactAnchor } from '../../shared/narrativeTypes.ts';
import type { CreativeProject } from '../../shared/types.ts';

export function recordNarrativeChange(
  before: CreativeProject,
  after: CreativeProject,
  action: NonNullable<CreativeProject['narrative']>['audit'][number]['action'],
  reason: string,
  artifact?: ArtifactAnchor,
): CreativeProject {
  if (!after.narrative || before.snapshot.manuscriptVersionId === after.snapshot.manuscriptVersionId) {
    return after;
  }
  return {
    ...after,
    narrative: {
      ...after.narrative,
      audit: [...after.narrative.audit, {
        id: crypto.randomUUID(),
        time: Date.now(),
        action,
        baseRevision: before.revision,
        resultRevision: after.revision,
        before: before.snapshot.manuscriptVersionId,
        after: after.snapshot.manuscriptVersionId,
        reason,
        artifact,
      }],
    },
  };
}
