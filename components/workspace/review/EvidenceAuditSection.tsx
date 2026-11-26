/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import type { NarrativeRecords } from '../../../shared/narrativeTypes';
import { workspaceButton } from '../../manuscript/ManuscriptEditor';

interface EvidenceAuditSectionProps {
  revision: number;
  sources: NarrativeRecords['sources'];
  proposals: NonNullable<NarrativeRecords['proposals']>;
  claims: NarrativeRecords['claims'];
  issuesCount: number;
  audit: NarrativeRecords['audit'];
  exportReport: (format: 'json' | 'md') => void;
}

export const EvidenceAuditSection: React.FC<EvidenceAuditSectionProps> = ({
  revision,
  sources,
  proposals,
  claims,
  issuesCount,
  audit,
  exportReport,
}) => (
  <section className="space-y-3 rounded-lg border border-gray-300 p-4 dark:border-gray-700">
    <h2 className="font-semibold">Evidence &amp; Audit</h2>
    <p className="text-sm">Revision {revision} · {sources.length} sources · {claims.length} evidence claims · {issuesCount} registered issues</p>
    <div className="flex flex-wrap gap-2">
      <button type="button" className={workspaceButton} onClick={() => exportReport('json')}>Export report (.json)</button>
      <button type="button" className={workspaceButton} onClick={() => exportReport('md')}>Export report (.md)</button>
    </div>
    {sources.map((source) => (
      <details key={source.id} className="border-t border-gray-300 pt-3 dark:border-gray-700">
        <summary className="cursor-pointer font-medium">
          Source: {source.filename ?? source.id} · {source.retention === 'original-and-extracted' ? 'original file retained' : 'extracted text only'}
        </summary>
        <dl className="grid gap-1 py-2 text-sm sm:grid-cols-2">
          <div><dt className="font-medium">Type</dt><dd>{source.mediaType ?? 'Unknown'}</dd></div>
          <div><dt className="font-medium">Original byte length</dt><dd>{source.byteLength?.toLocaleString() ?? 'Unknown'}</dd></div>
          <div className="break-all"><dt className="font-medium">SHA-256</dt><dd>{source.digest}</dd></div>
          <div><dt className="font-medium">Parser version</dt><dd>{source.parserVersion ?? 'Unknown'}</dd></div>
          <div><dt className="font-medium">Extracted characters</dt><dd>{source.text.length.toLocaleString()}</dd></div>
          <div><dt className="font-medium">Original bytes</dt><dd>{source.originalBytesBase64 ? 'Included in project and full backup' : 'Not included; extracted text and evidence retained'}</dd></div>
        </dl>
        {source.analysisCoverage && (
          <div className="space-y-1 text-sm">
            <p>Analysis {source.analysisCoverage.complete ? 'complete' : 'incomplete'} · {source.analysisCoverage.scope} scope · {source.analysisCoverage.processedSpans.length} processed ranges · {source.analysisCoverage.failedSegments} unprocessed or failed segments · {source.analysisCoverage.calls} calls</p>
            <p>Categories: {source.analysisCoverage.categories.join(', ') || 'none'}</p>
            {source.analysisCoverage.instruction && <p>Import guidance: {source.analysisCoverage.instruction}</p>}
          </div>
        )}
        {source.blocks.length > 0 && (
          <p className="text-sm">{source.blocks.length} source blocks · {source.blocks.filter((block) => block.kind === 'heading').length} headings preserved with offsets</p>
        )}
      </details>
    ))}
    {proposals.length > 0 && (
      <section aria-labelledby="import-proposals-heading" className="space-y-3 border-t border-gray-300 pt-3 dark:border-gray-700">
        <h3 id="import-proposals-heading" className="font-semibold">Imported findings and proposals ({proposals.length})</h3>
        <p className="text-sm">Confirmed proposals were accepted during import. Pending and rejected items remain in this record for review.</p>
        {proposals.filter((proposal) => proposal.category === 'other').length > 0 && (
          <p role="status" className="rounded border border-amber-400 p-3 text-sm">
            {proposals.filter((proposal) => proposal.category === 'other').length} unclassified findings retained for review. This does not assert semantic completeness.
          </p>
        )}
        {proposals.map((proposal) => (
          <article key={proposal.id} className="space-y-1 rounded border border-gray-300 p-3 dark:border-gray-700">
            <h4 className="font-medium">{proposal.label} · {proposal.kind} · {proposal.category} · {proposal.epistemicKind ?? 'epistemic class unknown'} · {proposal.approval}</h4>
            {proposal.detail && <p className="text-sm">{proposal.detail}</p>}
            <p className="text-sm">{proposal.rationale}</p>
            <blockquote className="whitespace-pre-wrap break-words border-l-2 pl-3 text-sm">
              {proposal.evidence.excerpt}
              <span className="mt-1 block text-xs text-gray-600 dark:text-gray-400">Characters {proposal.evidence.start}–{proposal.evidence.end} · {proposal.evidence.sourceId.slice(0, 8)} · {proposal.evidence.version}</span>
            </blockquote>
          </article>
        ))}
      </section>
    )}
    {claims.map((claim) => (
      <details key={claim.id}>
        <summary>{claim.targetId} · {claim.approval} · {claim.freshness}</summary>
        <p>{claim.rationale}</p>
        {claim.anchors.map((anchor, index) => (
          <blockquote className="whitespace-pre-wrap break-words" key={index}>
            {anchor.excerpt}
            <span className="mt-1 block text-xs text-gray-600 dark:text-gray-400">Characters {anchor.start}–{anchor.end} · {anchor.sourceId.slice(0, 8)} · {anchor.version}</span>
          </blockquote>
        ))}
      </details>
    ))}
    {audit.length === 0 && <p className="text-sm">No manuscript audit entries yet.</p>}
    <ol className="space-y-2">
      {audit.slice().reverse().map((event) => (
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
);
