/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import type { OpportunityProposal } from '../../shared/narrativeTypes';
import type { OpportunityProposalStatus } from '../../lib/narrative/opportunityProposals';

interface OpportunityListProps {
  ordered: OpportunityProposal[];
  projectRevision: number;
  onTransition: (id: string, status: OpportunityProposalStatus, expectedRevision: number) => void;
  onSendToChangeReview?: (proposal: OpportunityProposal) => void;
}

const OpportunityList: React.FC<OpportunityListProps> = ({
  ordered,
  projectRevision,
  onTransition,
  onSendToChangeReview,
}) => {
  return (
    <section aria-labelledby="opportunity-list-title" className="space-y-2">
      <h4 id="opportunity-list-title" className="text-xs font-semibold">Saved ideas ({ordered.length})</h4>
      {ordered.length === 0 ? (
        <p className="text-xs text-gray-500">No opportunities saved for this project.</p>
      ) : (
        ordered.map((proposal) => {
          const fresh = proposal.lifecycleRevision === projectRevision;
          const transition = (status: OpportunityProposalStatus) =>
            onTransition(proposal.id, status, projectRevision);
          return (
            <article key={proposal.id} className="space-y-2 rounded border border-gray-200 p-3 text-xs dark:border-gray-700">
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <h5 className="font-semibold">{proposal.description}</h5>
                <div className="flex flex-wrap items-center gap-1">
                  <span
                    className={`rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase ${
                      proposal.origin === 'ai'
                        ? 'bg-indigo-100 text-indigo-800 dark:bg-indigo-950 dark:text-indigo-300'
                        : 'bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-300'
                    }`}
                  >
                    {proposal.origin === 'ai' ? 'AI Suggestion' : 'User Idea'}
                  </span>
                  {proposal.category && (
                    <span className="rounded bg-gray-100 px-1.5 py-0.5 text-[10px] capitalize dark:bg-gray-800">
                      {proposal.category}
                    </span>
                  )}
                  <span className="rounded bg-gray-100 px-2 py-0.5 capitalize dark:bg-gray-800">{proposal.status}</span>
                </div>
              </div>
              <dl className="grid grid-cols-1 gap-1 sm:grid-cols-2">
                <div><dt className="font-semibold">Source refs</dt><dd>{proposal.sourceRefs.join(', ') || 'None supplied'}</dd></div>
                <div><dt className="font-semibold">Rationale</dt><dd>{proposal.rationale}</dd></div>
                <div><dt className="font-semibold">Potential benefit</dt><dd>{proposal.benefit}</dd></div>
                <div><dt className="font-semibold">Trade-off</dt><dd>{proposal.tradeOff}</dd></div>
                <div><dt className="font-semibold">Assumptions</dt><dd>{proposal.assumptions.join('; ') || 'None supplied'}</dd></div>
                {proposal.options && proposal.options.length > 0 && (
                  <div className="sm:col-span-2">
                    <dt className="font-semibold">Concrete options</dt>
                    <dd>
                      <ul className="list-disc pl-4">
                        {proposal.options.map((opt, idx) => (
                          <li key={idx}>{opt}</li>
                        ))}
                      </ul>
                    </dd>
                  </div>
                )}
              </dl>
              <p className={fresh ? 'text-gray-500' : 'font-semibold text-amber-700 dark:text-amber-300'}>
                {fresh ? `Based on project revision ${proposal.baseRevision}.` : `Stale: based on revision ${proposal.baseRevision}; current revision is ${projectRevision}.`}
              </p>
              <div className="flex flex-wrap gap-2">
                {(proposal.status === 'pending' || proposal.status === 'deferred') && (
                  <>
                    {proposal.status === 'pending' ? (
                      <button type="button" className="underline" onClick={() => transition('deferred')}>Defer</button>
                    ) : (
                      <button type="button" className="underline" onClick={() => transition('pending')}>Reopen</button>
                    )}
                    <button type="button" className="underline disabled:opacity-50" disabled={!fresh} onClick={() => transition('staged')}>Stage for review</button>
                    <button type="button" className="underline" onClick={() => transition('rejected')}>Reject</button>
                  </>
                )}
                {proposal.status === 'staged' && (
                  <>
                    <button type="button" className="underline disabled:opacity-50" disabled={!fresh} onClick={() => transition('accepted')}>Accept idea</button>
                    <button type="button" className="underline" onClick={() => transition('rejected')}>Reject</button>
                  </>
                )}
                {(proposal.status === 'staged' || proposal.status === 'accepted') && onSendToChangeReview && (
                  <button
                    type="button"
                    onClick={() => onSendToChangeReview(proposal)}
                    className="rounded border border-blue-300 bg-blue-50 px-2 py-0.5 text-[11px] font-semibold text-blue-700 hover:bg-blue-100 dark:border-blue-800 dark:bg-blue-950 dark:text-blue-300"
                  >
                    Send to Change Review
                  </button>
                )}
              </div>
            </article>
          );
        })
      )}
    </section>
  );
};

export default OpportunityList;
