import type { ConsistencyIssue, CreativeProject } from '../../shared/types';
import { workspaceButton } from '../manuscript/ManuscriptEditor';

interface Props {
  project: CreativeProject;
  checks: ConsistencyIssue[];
  openChecks: () => void;
  openHistory: () => void;
  openOutput: () => void;
  exportReport: (format: 'json' | 'md') => void;
}

export default function NarrativeReview({ project, checks, openChecks, openHistory, openOutput, exportReport }: Props) {
  const { issues = [], claims = [], audit = [] } = project.narrative ?? {};
  return (
    <main className="min-h-0 flex-1 overflow-auto p-4 sm:p-6">
      <div className="mx-auto max-w-4xl space-y-5">
        <h1 className="text-2xl font-bold">Review</h1>
        <div className="flex flex-wrap gap-2">
          <button className={workspaceButton} onClick={openChecks}>Local checks ({checks.length})</button>
          <button className={workspaceButton} onClick={openHistory}>Revision History</button>
          <button className={workspaceButton} onClick={openOutput}>Output Gallery</button>
        </div>
        <section className="space-y-3 rounded-lg border border-gray-300 p-4 dark:border-gray-700">
          <h2 className="font-semibold">Evidence &amp; Audit</h2>
          <p className="text-sm">Revision {project.revision} · {claims.length} evidence claims · {issues.length} registered issues</p>
          <div className="flex flex-wrap gap-2">
            <button className={workspaceButton} onClick={() => exportReport('json')}>Export report (.json)</button>
            <button className={workspaceButton} onClick={() => exportReport('md')}>Export report (.md)</button>
          </div>
          {issues.map(issue => <p key={issue.id}>{issue.title} · {issue.disposition} · {issue.freshness}</p>)}
          {claims.map(claim => (
            <details key={claim.id}>
              <summary>{claim.targetId} · {claim.approval} · {claim.freshness}</summary>
              <p>{claim.rationale}</p>
              {claim.anchors.map((anchor, index) => <blockquote className="whitespace-pre-wrap break-words" key={index}>{anchor.excerpt}</blockquote>)}
            </details>
          ))}
          {audit.length === 0 && <p className="text-sm">No manuscript audit entries yet.</p>}
          <ol className="space-y-2">
            {audit.slice().reverse().map(event => (
              <li key={event.id} className="break-words border-t border-gray-300 pt-2 dark:border-gray-700">
                <details>
                  <summary>{event.reason} · r{event.baseRevision} → r{event.resultRevision}</summary>
                  <p className="text-sm">{new Date(event.time).toLocaleString()} · {event.before ?? 'No manuscript'} → {event.after ?? 'No manuscript'}</p>
                  {event.artifact && <blockquote className="mt-2 whitespace-pre-wrap">{event.artifact.excerpt}</blockquote>}
                </details>
              </li>
            ))}
          </ol>
        </section>
        <p className="text-sm text-gray-600 dark:text-gray-300">Narrative Diagnostics is planned for Phase 3. Creative Opportunities is planned for Phase 4.</p>
      </div>
    </main>
  );
}
