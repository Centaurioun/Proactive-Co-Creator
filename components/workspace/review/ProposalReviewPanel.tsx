import type { ConsistencyIssueTarget, CreativeProject } from '../../../shared/types.ts';
import type { NarrativeIssue } from '../../../shared/narrativeTypes.ts';
import type { DiagnosticFixAlternative } from '../../../shared/narrativeAiSchemas.ts';
import { manuscriptSections } from '../../../lib/narrative/manuscriptModel.ts';
import type { PendingProposalReview, ProposalReviewContext } from './proposalReviewContext.ts';

interface Props {
  project: CreativeProject;
  issue: NarrativeIssue;
  alternative: DiagnosticFixAlternative;
  context: ProposalReviewContext;
  source: 'local' | 'ai';
  stale: boolean;
  onAccept?: () => void;
  onKeepCurrent: () => void;
  onRefreshLocal: () => void;
  onReturnToWriting?: (target?: ConsistencyIssueTarget, review?: PendingProposalReview) => void;
  onOpenTarget?: (targetId: string) => void;
  onOpenHistory: () => void;
}

function affectedLabel(project: CreativeProject, targetId: string): string {
  if (targetId.startsWith('story_bible:')) return `Story Bible · ${targetId.slice('story_bible:'.length)}`;
  const section = manuscriptSections(project).find((item) => item.id === targetId);
  if (section) return section.title || (section.kind === 'chapter' ? 'Chapter' : 'Scene');
  const entity = project.snapshot.entities.find((item) => item.id === targetId);
  if (entity) return `${entity.name} · ${entity.category ?? 'entity'}`;
  const relationship = project.snapshot.relationships.find((item) => item.id === targetId);
  if (relationship) return `${relationship.source} · ${relationship.label} · ${relationship.target}`;
  return targetId;
}

function currentValue(project: CreativeProject, alternative: DiagnosticFixAlternative): { label: string; value: string } | null {
  if (alternative.kind === 'manuscript_patch' && alternative.sectionId) {
    const section = manuscriptSections(project).find((item) => item.id === alternative.sectionId);
    if (section) return { label: section.title || 'Working Manuscript section', value: section.text };
  }
  if (alternative.kind === 'story_bible' && alternative.storyField) {
    const field = project.snapshot.storyBible[alternative.storyField];
    if (field) return { label: `Story Bible · ${alternative.storyField}`, value: field.value || '(empty)' };
  }
  if ((alternative.kind === 'entity_exclude' || alternative.kind === 'entity_attribute') && alternative.entityId) {
    const entity = project.snapshot.entities.find((item) => item.id === alternative.entityId);
    if (entity) {
      if (alternative.kind === 'entity_exclude') {
        return { label: `Belief Graph · ${entity.name}`, value: entity.excluded ? 'Excluded' : 'Present in the graph' };
      }
      const attributeName = alternative.attributeName || 'description';
      if (attributeName === 'description') return { label: `${entity.name} · description`, value: entity.description || '(empty)' };
      const attribute = entity.attributes.find((item) => item.name === attributeName);
      if (attribute) return {
        label: `${entity.name} · ${attribute.name}`,
          value: attribute.confirmedValue ?? (attribute.value.map((candidate) => candidate.name).join(', ') || '(empty)'),
      };
    }
  }
  if (alternative.kind === 'relationship_update' && alternative.relationshipId) {
    const relationship = project.snapshot.relationships.find((item) => item.id === alternative.relationshipId);
    if (relationship) return {
      label: 'Belief Graph relationship',
      value: `${relationship.source} · ${relationship.label} · ${relationship.target}`,
    };
  }
  return null;
}

function sourceAnchorStatus(project: CreativeProject, anchor: NarrativeIssue['anchors'][number]) {
  const source = project.narrative?.sources.find((item) => item.id === anchor.sourceId &&
    item.version === anchor.version && item.digest === anchor.digest);
  if (!source) return { label: `Source version ${anchor.version} · ${anchor.sourceId.slice(0, 8)}`, current: false, contextExcerpt: undefined };
  const blockIndex = source.blocks.findIndex((block) => anchor.start >= block.start && anchor.end <= block.end);
  const block = blockIndex >= 0 ? source.blocks[blockIndex] : undefined;
  const location = block?.label ?? (blockIndex >= 0 ? `Paragraph ${blockIndex + 1}` : `Characters ${anchor.start}–${anchor.end}`);
  const excerptMatches = source.text.slice(anchor.start, anchor.end) === anchor.excerpt;
  const contextStart = Math.max(0, anchor.start - 180);
  const contextEnd = Math.min(source.text.length, anchor.end + 180);
  return {
    label: `${source.filename ?? source.id} · ${location} · ${anchor.version}`,
    current: excerptMatches,
    contextExcerpt: source.text.slice(contextStart, contextEnd),
  };
}

function navigationTarget(project: CreativeProject, targetId: string): ConsistencyIssueTarget | undefined {
  if (targetId.startsWith('story_bible:')) {
    const field = targetId.slice('story_bible:'.length) as keyof CreativeProject['snapshot']['storyBible'];
    return field in project.snapshot.storyBible ? { id: targetId, kind: 'story_bible', label: field, storyField: field } : undefined;
  }
  const section = manuscriptSections(project).find((item) => item.id === targetId);
  if (section) return { id: targetId, kind: 'section', label: section.title || 'Open scene', sectionId: targetId };
  const relationship = project.snapshot.relationships.find((item) => item.id === targetId);
  if (relationship) return { id: targetId, kind: 'relationship', label: 'Open relationship', relationshipId: targetId };
  const entity = project.snapshot.entities.find((item) => item.id === targetId);
  return entity ? { id: targetId, kind: 'entity', label: 'Open entity', entityId: targetId } : undefined;
}

export default function ProposalReviewPanel({
  project,
  issue,
  alternative,
  context,
  source,
  stale,
  onAccept,
  onKeepCurrent,
  onRefreshLocal,
  onReturnToWriting,
  onOpenTarget,
  onOpenHistory,
}: Props) {
  const current = currentValue(project, alternative);
  const affectedTargetIds = [...new Set([...(issue.affectedTargetIds ?? []),
    ...(alternative.sectionId ? [alternative.sectionId] : []),
    ...(alternative.entityId ? [alternative.entityId] : []),
    ...(alternative.relationshipId ? [alternative.relationshipId] : []),
    ...(alternative.storyField ? [`story_bible:${alternative.storyField}`] : []),
  ])];

  const returnToWriting = () => {
    const targetId = alternative.sectionId ?? issue.affectedTargetIds?.[0];
    const target = targetId ? navigationTarget(project, targetId) : undefined;
    const review: PendingProposalReview = {
      projectId: context.projectId,
      issueId: issue.id,
      ...(target ? { target } : {}),
      alternative,
      source,
      context,
    };
    onReturnToWriting?.(target, review);
  };

  return (
    <section aria-labelledby={`proposal-review-${issue.id}`} className="space-y-3 rounded-lg border border-pcc-line bg-pcc-surface p-4 dark:border-pcc-dark-line dark:bg-pcc-dark-surface">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-xs font-semibold text-pcc-muted dark:text-pcc-dark-muted">REVIEW PROPOSAL</p>
          <h5 id={`proposal-review-${issue.id}`} className="mt-1 text-lg font-semibold">{issue.title}</h5>
          <p className="mt-1 text-xs text-pcc-muted dark:text-pcc-dark-muted">
            Current project · Revision {project.revision} · Proposal base · Revision {context.baseRevision} · {source === 'ai' ? 'AI-generated suggestion' : 'Local deterministic suggestion'}
          </p>
        </div>
        <span className={`rounded-full border px-3 py-1 text-xs font-semibold ${stale
          ? 'border-red-300 bg-red-50 text-red-800 dark:border-red-800 dark:bg-red-950/50 dark:text-red-200'
          : 'border-pcc-line bg-gray-50 text-gray-800 dark:border-pcc-dark-line dark:bg-gray-900 dark:text-gray-100'}`}>
          {stale ? `Stale · Rev ${context.baseRevision} → Rev ${project.revision}` : 'Ready for author review'}
        </span>
      </header>

      {stale && (
        <p role="alert" className="rounded border border-red-300 bg-red-50 p-3 text-sm text-red-900 dark:border-red-900 dark:bg-red-950/40 dark:text-red-100">
          The project changed after this proposal was generated. The old suggestion remains visible for comparison, but it cannot be applied. Refresh to create a new proposal from the current revision.
        </p>
      )}

      <div className="grid gap-3 xl:grid-cols-[minmax(0,1.25fr)_minmax(260px,.85fr)]">
        <div className="space-y-3">
          <div className="grid gap-3 md:grid-cols-2">
            <section aria-label="Current project value" className="min-w-0 rounded-lg border border-pcc-line bg-white p-3 dark:border-pcc-dark-line dark:bg-gray-950/30">
              <p className="text-xs font-semibold text-pcc-muted dark:text-pcc-dark-muted">CURRENT · REVISION {project.revision}</p>
              {current ? (
                <>
                  <h6 className="mt-2 text-sm font-semibold">{current.label}</h6>
                  <pre className="pcc-editorial mt-2 max-h-48 overflow-auto whitespace-pre-wrap break-words text-[15px] leading-6">{current.value}</pre>
                </>
              ) : (
                <p className="mt-2 text-sm text-pcc-muted dark:text-pcc-dark-muted">
                  The live target could not be resolved. The value saved with the proposal is shown as its recorded base below.
                </p>
              )}
              {!current && <pre className="mt-2 max-h-40 overflow-auto whitespace-pre-wrap break-words text-sm">{alternative.beforeText || '(no recorded base value)'}</pre>}
            </section>

            <section aria-label="Suggested change, not applied" className="min-w-0 rounded-lg border border-pcc-action/50 bg-blue-50/40 p-3 dark:border-pcc-action dark:bg-blue-950/20">
              <p className="text-xs font-semibold text-pcc-action dark:text-pcc-dark-ink">SUGGESTED CHANGE · BASE REVISION {context.baseRevision}</p>
              <h6 className="mt-2 text-sm font-semibold">{alternative.title}</h6>
              <p className="mt-1 text-xs text-pcc-muted dark:text-pcc-dark-muted">Scope: {alternative.affectedScope}</p>
              <pre className="pcc-editorial mt-2 max-h-48 overflow-auto whitespace-pre-wrap break-words text-[15px] leading-6">{alternative.afterText || '(no text change)'}</pre>
              <p className="mt-2 text-xs font-medium text-pcc-action dark:text-pcc-dark-muted">Not applied · This suggestion is not a confirmed story fact.</p>
            </section>
          </div>

          {affectedTargetIds.length > 0 && (
            <section aria-labelledby={`affected-${issue.id}`} className="rounded-lg border border-pcc-line p-3 dark:border-pcc-dark-line">
              <h6 id={`affected-${issue.id}`} className="text-xs font-semibold">Affected objects</h6>
              <ul className="mt-2 flex flex-wrap gap-2">
                {affectedTargetIds.map((targetId) => (
                  <li key={targetId}>
                    {onOpenTarget ? (
                      <button type="button" onClick={() => onOpenTarget(targetId)} className="min-h-9 rounded-md border border-pcc-line bg-white px-3 py-1.5 text-left text-xs font-medium text-pcc-action hover:bg-gray-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-pcc-focus dark:border-pcc-dark-line dark:bg-gray-950 dark:text-pcc-dark-ink">
                        {affectedLabel(project, targetId)}
                      </button>
                    ) : (
                      <span className="inline-flex min-h-9 items-center rounded-md border border-pcc-line px-3 py-1.5 text-xs dark:border-pcc-dark-line">{affectedLabel(project, targetId)}</span>
                    )}
                  </li>
                ))}
              </ul>
            </section>
          )}
        </div>

        <aside aria-label="Evidence and proposal provenance" className="space-y-3 rounded-lg border border-pcc-line p-3 dark:border-pcc-dark-line">
          <div>
            <p className="text-xs font-semibold text-pcc-muted dark:text-pcc-dark-muted">PROPOSAL · PROVENANCE</p>
            <p className="mt-1 text-sm">{alternative.reason}</p>
            {alternative.evidenceSummary && <p className="mt-2 text-xs text-pcc-muted dark:text-pcc-dark-muted">Proposal evidence summary: {alternative.evidenceSummary}</p>}
            {alternative.assumptions.length > 0 && (
              <ul className="mt-2 list-disc space-y-1 pl-5 text-xs text-pcc-muted dark:text-pcc-dark-muted">
                {alternative.assumptions.map((assumption, index) => <li key={`${index}-${assumption}`}>Assumption: {assumption}</li>)}
              </ul>
            )}
          </div>
          <div className="border-t border-pcc-line pt-3 dark:border-pcc-dark-line">
            <h6 className="text-xs font-semibold">Source evidence</h6>
            <p className="mt-1 text-xs text-pcc-muted dark:text-pcc-dark-muted">
              The proposal reasoning is an interpretation. These excerpts are attached to the tracked issue and do not by themselves verify the suggested change.
            </p>
            {issue.anchors.length === 0 ? (
              <p className="mt-2 text-xs text-pcc-muted dark:text-pcc-dark-muted">No source excerpt is attached to this issue.</p>
            ) : (
              <ul className="mt-2 space-y-2">
                {issue.anchors.map((anchor, index) => {
                  const source = sourceAnchorStatus(project, anchor);
                  return (
                    <li key={`${anchor.sourceId}-${anchor.version}-${anchor.start}-${index}`} className="rounded-md bg-pcc-evidence p-3 text-sm text-pcc-ink dark:bg-gray-900 dark:text-pcc-dark-ink">
                      <blockquote className="pcc-editorial whitespace-pre-wrap break-words leading-6">{anchor.excerpt}</blockquote>
                      <p className="mt-2 text-xs text-pcc-evidence-ink dark:text-pcc-dark-muted">{source.label}</p>
                      <p className="mt-1 text-xs font-medium">{source.current ? 'Excerpt matches this recorded source version.' : 'Recorded excerpt could not be verified against the stored source version.'}</p>
                      {source.contextExcerpt && (
                        <details className="mt-2 text-xs">
                          <summary className="cursor-pointer font-semibold">Inspect surrounding source text</summary>
                          <pre className="mt-2 max-h-40 overflow-auto whitespace-pre-wrap break-words border-t border-pcc-line pt-2 dark:border-pcc-dark-line">{source.contextExcerpt}</pre>
                        </details>
                      )}
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
          <button type="button" onClick={onOpenHistory} className="min-h-9 rounded-md border border-pcc-line px-3 py-1.5 text-xs font-semibold hover:bg-gray-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-pcc-focus dark:border-pcc-dark-line dark:hover:bg-gray-900">
            Open revision history
          </button>
        </aside>
      </div>

      <div className="flex flex-wrap items-center gap-2 border-t border-pcc-line pt-3 dark:border-pcc-dark-line">
        {stale ? (
          <>
            <button type="button" onClick={onRefreshLocal} className="min-h-10 rounded-md bg-pcc-action px-4 py-2 text-sm font-semibold text-white hover:bg-pcc-action-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-pcc-focus focus-visible:ring-offset-2">
              Refresh local proposal
            </button>
            <p className="text-xs text-pcc-muted dark:text-pcc-dark-muted">AI suggestions require a separate explicit request.</p>
          </>
        ) : alternative.kind !== 'manual_guidance' && onAccept ? (
          <button type="button" onClick={onAccept} className="min-h-10 rounded-md bg-pcc-action px-4 py-2 text-sm font-semibold text-white hover:bg-pcc-action-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-pcc-focus focus-visible:ring-offset-2">
            Accept this change
          </button>
        ) : (
          <p className="text-xs text-pcc-muted dark:text-pcc-dark-muted">Manual guidance only. Edit the target directly in the workspace.</p>
        )}
        <button type="button" onClick={onKeepCurrent} className="min-h-10 rounded-md border border-pcc-line bg-white px-4 py-2 text-sm font-semibold hover:bg-gray-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-pcc-focus dark:border-pcc-dark-line dark:bg-gray-950 dark:hover:bg-gray-900">
          Keep current text
        </button>
        {onReturnToWriting && (
          <button type="button" onClick={returnToWriting} className="min-h-10 rounded-md px-3 py-2 text-sm font-semibold text-pcc-action underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-pcc-focus dark:text-pcc-dark-ink">
            Return to writing
          </button>
        )}
      </div>
    </section>
  );
}
