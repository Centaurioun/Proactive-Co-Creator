import type { OpportunityProposal } from '../../shared/narrativeTypes.ts';
import type { CreativeProject } from '../../shared/types.ts';
import { recordProjectRevision } from '../historyEngine.ts';

export type OpportunityProposalInput = Pick<OpportunityProposal,
  'description' | 'sourceRefs' | 'rationale' | 'benefit' | 'tradeOff' | 'assumptions'>;
export type OpportunityProposalStatus = OpportunityProposal['status'];

function narrativeRecords(project: CreativeProject): NonNullable<CreativeProject['narrative']> {
  return project.narrative ?? { versions: [], sectionVersions: [], sources: [], claims: [], issues: [], audit: [] };
}

function requiredText(value: string, field: string): string {
  const trimmed = value.trim();
  if (!trimmed) throw new Error(`${field} is required.`);
  return trimmed;
}

export function createOpportunityProposal(
  project: CreativeProject,
  expectedRevision: number,
  input: OpportunityProposalInput,
): CreativeProject {
  if (project.revision !== expectedRevision) throw new Error('The project changed. Refresh before saving this opportunity.');
  const now = Date.now();
  const proposal: OpportunityProposal = {
    id: crypto.randomUUID(),
    projectId: project.id,
    baseRevision: expectedRevision,
    lifecycleRevision: expectedRevision + 1,
    description: requiredText(input.description, 'Description'),
    sourceRefs: [...new Set(input.sourceRefs.map(ref => ref.trim()).filter(Boolean))],
    rationale: requiredText(input.rationale, 'Rationale'),
    benefit: requiredText(input.benefit, 'Benefit'),
    tradeOff: requiredText(input.tradeOff, 'Trade-off'),
    assumptions: input.assumptions.map(item => item.trim()).filter(Boolean),
    status: 'pending',
    createdAt: now,
    updatedAt: now,
  };
  const records = narrativeRecords(project);
  const next = recordProjectRevision({
    ...project,
    narrative: { ...records, opportunities: [...(records.opportunities ?? []), proposal] },
  }, 'Save creative opportunity', proposal.description);
  const persistedProposal = { ...proposal, lifecycleRevision: next.revision };
  return {
    ...next,
    narrative: { ...narrativeRecords(next), opportunities: [...(records.opportunities ?? []), persistedProposal] },
  };
}

export function transitionOpportunityProposal(
  project: CreativeProject,
  proposalId: string,
  status: OpportunityProposalStatus,
  expectedRevision: number,
): CreativeProject {
  if (project.revision !== expectedRevision) throw new Error('The project changed. Refresh before updating this opportunity.');
  const records = narrativeRecords(project);
  const proposals = records.opportunities ?? [];
  const proposal = proposals.find(item => item.id === proposalId && item.projectId === project.id);
  if (!proposal) throw new Error('This opportunity is unavailable in the current project.');
  const allowed: Record<OpportunityProposalStatus, OpportunityProposalStatus[]> = {
    pending: ['deferred', 'staged', 'rejected'],
    deferred: ['pending', 'staged', 'rejected'],
    staged: ['pending', 'accepted', 'rejected'],
    accepted: [],
    rejected: [],
  };
  if (!allowed[proposal.status].includes(status)) throw new Error(`Cannot change an opportunity from ${proposal.status} to ${status}.`);
  if ((status === 'staged' || status === 'accepted') && proposal.lifecycleRevision !== project.revision) {
    throw new Error('This opportunity is stale because the project changed. Create a fresh proposal before staging or accepting it.');
  }
  const now = Date.now();
  const next = recordProjectRevision(project, `Opportunity ${status}`, `${proposal.description} — ${status}`);
  return {
    ...next,
    narrative: {
      ...records,
      opportunities: proposals.map(item => item.id === proposal.id
        ? { ...item, status, lifecycleRevision: next.revision, updatedAt: now }
        : item),
    },
  };
}
