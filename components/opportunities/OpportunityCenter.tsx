import React, { useState } from 'react';
import type { OpportunityProposal } from '../../shared/narrativeTypes';
import type { OpportunityProposalStatus, OpportunityProposalInput } from '../../lib/narrative/opportunityProposals';

interface OpportunityCenterProps {
  projectId: string;
  projectRevision: number;
  proposals: OpportunityProposal[];
  onCreate: (input: OpportunityProposalInput, expectedRevision: number) => void;
  onTransition: (id: string, status: OpportunityProposalStatus, expectedRevision: number) => void;
}

const fieldClass = 'w-full rounded border border-gray-300 bg-white p-2 text-xs text-gray-900 dark:border-gray-700 dark:bg-gray-950 dark:text-gray-100';

export default function OpportunityCenter({ projectId, projectRevision, proposals, onCreate, onTransition }: OpportunityCenterProps) {
  const [description, setDescription] = useState('');
  const [sourceRefs, setSourceRefs] = useState('');
  const [rationale, setRationale] = useState('');
  const [benefit, setBenefit] = useState('');
  const [tradeOff, setTradeOff] = useState('');
  const [assumptions, setAssumptions] = useState('');
  const ordered = proposals.filter(proposal => proposal.projectId === projectId)
    .slice().sort((a, b) => b.createdAt - a.createdAt || a.id.localeCompare(b.id));

  const submit = (event: React.FormEvent) => {
    event.preventDefault();
    onCreate({
      description,
      sourceRefs: sourceRefs.split('\n'),
      rationale,
      benefit,
      tradeOff,
      assumptions: assumptions.split('\n'),
    }, projectRevision);
    setDescription(''); setSourceRefs(''); setRationale(''); setBenefit(''); setTradeOff(''); setAssumptions('');
  };

  return (
    <div className="flex-1 min-h-0 overflow-y-auto p-4 space-y-4">
      <header>
        <h3 className="font-display text-sm font-bold text-gray-900 dark:text-gray-100">Creative Opportunities</h3>
        <p className="text-xs text-gray-500 dark:text-gray-400">Save and review suggestions separately from diagnostics. Saving or staging never changes the graph or manuscript; accepting records the idea only.</p>
      </header>
      <form onSubmit={submit} className="space-y-2 rounded border border-gray-200 p-3 dark:border-gray-700">
        <h4 className="text-xs font-semibold">Record an opportunity</h4>
        <label className="block space-y-1 text-xs">Suggestion<textarea required value={description} onChange={event => setDescription(event.target.value)} className={fieldClass} rows={2} /></label>
        <label className="block space-y-1 text-xs">Source references <span className="text-gray-500">(one project ID or reference per line)</span><textarea value={sourceRefs} onChange={event => setSourceRefs(event.target.value)} className={fieldClass} rows={2} /></label>
        <label className="block space-y-1 text-xs">Rationale<textarea required value={rationale} onChange={event => setRationale(event.target.value)} className={fieldClass} rows={2} /></label>
        <label className="block space-y-1 text-xs">Potential benefit<textarea required value={benefit} onChange={event => setBenefit(event.target.value)} className={fieldClass} rows={2} /></label>
        <label className="block space-y-1 text-xs">Trade-off<textarea required value={tradeOff} onChange={event => setTradeOff(event.target.value)} className={fieldClass} rows={2} /></label>
        <label className="block space-y-1 text-xs">Assumptions <span className="text-gray-500">(one per line)</span><textarea value={assumptions} onChange={event => setAssumptions(event.target.value)} className={fieldClass} rows={2} /></label>
        <button type="submit" className="rounded bg-blue-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-blue-700">Save as pending idea</button>
      </form>
      <section aria-labelledby="opportunity-list-title" className="space-y-2">
        <h4 id="opportunity-list-title" className="text-xs font-semibold">Saved ideas ({ordered.length})</h4>
        {ordered.length === 0 ? <p className="text-xs text-gray-500">No opportunities saved for this project.</p> : ordered.map(proposal => {
          const fresh = proposal.lifecycleRevision === projectRevision;
          const transition = (status: OpportunityProposalStatus) => onTransition(proposal.id, status, projectRevision);
          return (
            <article key={proposal.id} className="space-y-2 rounded border border-gray-200 p-3 text-xs dark:border-gray-700">
              <div className="flex flex-wrap items-baseline justify-between gap-2"><h5 className="font-semibold">{proposal.description}</h5><span className="rounded bg-gray-100 px-2 py-0.5 capitalize dark:bg-gray-800">{proposal.status}</span></div>
              <dl className="grid grid-cols-1 gap-1 sm:grid-cols-2">
                <div><dt className="font-semibold">Source refs</dt><dd>{proposal.sourceRefs.join(', ') || 'None supplied'}</dd></div>
                <div><dt className="font-semibold">Rationale</dt><dd>{proposal.rationale}</dd></div>
                <div><dt className="font-semibold">Potential benefit</dt><dd>{proposal.benefit}</dd></div>
                <div><dt className="font-semibold">Trade-off</dt><dd>{proposal.tradeOff}</dd></div>
                <div><dt className="font-semibold">Assumptions</dt><dd>{proposal.assumptions.join('; ') || 'None supplied'}</dd></div>
              </dl>
              <p className={fresh ? 'text-gray-500' : 'font-semibold text-amber-700 dark:text-amber-300'}>
                {fresh ? `Based on project revision ${proposal.baseRevision}.` : `Stale: based on revision ${proposal.baseRevision}; current revision is ${projectRevision}.`}
              </p>
              <div className="flex flex-wrap gap-2">
                {(proposal.status === 'pending' || proposal.status === 'deferred') && <>
                  {proposal.status === 'pending' ? <button type="button" className="underline" onClick={() => transition('deferred')}>Defer</button> : <button type="button" className="underline" onClick={() => transition('pending')}>Reopen</button>}
                  <button type="button" className="underline disabled:opacity-50" disabled={!fresh} onClick={() => transition('staged')}>Stage for review</button>
                  <button type="button" className="underline" onClick={() => transition('rejected')}>Reject</button>
                </>}
                {proposal.status === 'staged' && <>
                  <button type="button" className="underline disabled:opacity-50" disabled={!fresh} onClick={() => transition('accepted')}>Accept idea</button>
                  <button type="button" className="underline" onClick={() => transition('rejected')}>Reject</button>
                </>}
              </div>
            </article>
          );
        })}
      </section>
    </div>
  );
}
