/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState } from 'react';
import type { OpportunityProposalInput } from '../../lib/narrative/opportunityProposals';

interface ManualOpportunityFormProps {
  projectRevision: number;
  fieldClass: string;
  onCreate: (input: OpportunityProposalInput, expectedRevision: number) => void;
}

const ManualOpportunityForm: React.FC<ManualOpportunityFormProps> = ({
  projectRevision,
  fieldClass,
  onCreate,
}) => {
  const [description, setDescription] = useState('');
  const [sourceRefs, setSourceRefs] = useState('');
  const [rationale, setRationale] = useState('');
  const [benefit, setBenefit] = useState('');
  const [tradeOff, setTradeOff] = useState('');
  const [assumptions, setAssumptions] = useState('');

  const submit = (event: React.FormEvent) => {
    event.preventDefault();
    onCreate(
      {
        description,
        sourceRefs: sourceRefs.split('\n'),
        rationale,
        benefit,
        tradeOff,
        assumptions: assumptions.split('\n'),
        origin: 'user',
      },
      projectRevision
    );
    setDescription('');
    setSourceRefs('');
    setRationale('');
    setBenefit('');
    setTradeOff('');
    setAssumptions('');
  };

  return (
    <form onSubmit={submit} className="space-y-2 rounded border border-gray-200 p-3 dark:border-gray-700">
      <h4 className="text-xs font-semibold">Record a manual opportunity</h4>
      <label className="block space-y-1 text-xs">
        Suggestion
        <textarea required value={description} onChange={(event) => setDescription(event.target.value)} className={fieldClass} rows={2} />
      </label>
      <label className="block space-y-1 text-xs">
        Source references <span className="text-gray-500">(one project ID or reference per line)</span>
        <textarea value={sourceRefs} onChange={(event) => setSourceRefs(event.target.value)} className={fieldClass} rows={2} />
      </label>
      <label className="block space-y-1 text-xs">
        Rationale
        <textarea required value={rationale} onChange={(event) => setRationale(event.target.value)} className={fieldClass} rows={2} />
      </label>
      <label className="block space-y-1 text-xs">
        Potential benefit
        <textarea required value={benefit} onChange={(event) => setBenefit(event.target.value)} className={fieldClass} rows={2} />
      </label>
      <label className="block space-y-1 text-xs">
        Trade-off
        <textarea required value={tradeOff} onChange={(event) => setTradeOff(event.target.value)} className={fieldClass} rows={2} />
      </label>
      <label className="block space-y-1 text-xs">
        Assumptions <span className="text-gray-500">(one per line)</span>
        <textarea value={assumptions} onChange={(event) => setAssumptions(event.target.value)} className={fieldClass} rows={2} />
      </label>
      <button type="submit" className="rounded bg-blue-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-blue-700">
        Save as pending idea
      </button>
    </form>
  );
};

export default ManualOpportunityForm;
