import React, { useMemo } from 'react';
import type { OpportunityProposal } from '../../shared/narrativeTypes';
import type { CreativeProject } from '../../shared/types';
import type { OpportunityProposalStatus, OpportunityProposalInput } from '../../lib/narrative/opportunityProposals';
import { manuscriptSections } from '../../lib/narrative/manuscriptModel';
import AiOpportunityExplorer from './AiOpportunityExplorer';
import ManualOpportunityForm from './ManualOpportunityForm';
import OpportunityList from './OpportunityList';

interface OpportunityCenterProps {
  project?: CreativeProject;
  projectId: string;
  projectRevision: number;
  proposals: OpportunityProposal[];
  opportunitiesAvailability?: { eligible: boolean; reason?: string };
  onCreate: (input: OpportunityProposalInput, expectedRevision: number) => void;
  onCreateBatch?: (inputs: OpportunityProposalInput[], expectedRevision: number) => void;
  onTransition: (id: string, status: OpportunityProposalStatus, expectedRevision: number) => void;
  onSendToChangeReview?: (proposal: OpportunityProposal) => void;
}

const fieldClass = 'w-full rounded border border-gray-300 bg-white p-2 text-xs text-gray-900 dark:border-gray-700 dark:bg-gray-950 dark:text-gray-100';

export default function OpportunityCenter({
  project,
  projectId,
  projectRevision,
  proposals,
  opportunitiesAvailability = { eligible: false, reason: 'AI opportunity exploration is unavailable.' },
  onCreate,
  onCreateBatch,
  onTransition,
  onSendToChangeReview,
}: OpportunityCenterProps) {
  const ordered = useMemo(
    () =>
      proposals
        .filter((proposal) => proposal.projectId === projectId)
        .slice()
        .sort((a, b) => b.createdAt - a.createdAt || a.id.localeCompare(b.id)),
    [proposals, projectId]
  );

  const sections = useMemo(() => (project ? manuscriptSections(project) : []), [project]);

  return (
    <div className="flex-1 min-h-0 overflow-y-auto p-4 space-y-4">
      <header>
        <h3 className="font-display text-sm font-bold text-gray-900 dark:text-gray-100">Creative Opportunities</h3>
        <p className="text-xs text-gray-500 dark:text-gray-400">
          Optional story-improvement suggestions kept separate from diagnostics. Saving, staging, or accepting never changes your graph or manuscript until you explicitly send an idea to Change Review.
        </p>
      </header>

      {project && (
        <AiOpportunityExplorer
          key={project.id}
          project={project}
          projectRevision={projectRevision}
          sections={sections}
          existingProposals={ordered}
          opportunitiesAvailability={opportunitiesAvailability}
          fieldClass={fieldClass}
          onCreate={onCreate}
          onCreateBatch={onCreateBatch}
        />
      )}

      <ManualOpportunityForm
        key={projectId}
        projectRevision={projectRevision}
        fieldClass={fieldClass}
        onCreate={onCreate}
      />

      <OpportunityList
        ordered={ordered}
        projectRevision={projectRevision}
        onTransition={onTransition}
        onSendToChangeReview={onSendToChangeReview}
      />
    </div>
  );
}
