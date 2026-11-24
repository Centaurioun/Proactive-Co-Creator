import React, { useMemo, useState } from 'react';
import type { OpportunityProposal } from '../../shared/narrativeTypes';
import type { CreativeProject } from '../../shared/types';
import type { OpportunityProposalStatus, OpportunityProposalInput } from '../../lib/narrative/opportunityProposals';
import { buildClientBudgetDisclosure } from '../../lib/narrative/aiBudgetClient';
import { manuscriptSections } from '../../lib/narrative/manuscriptModel';
import { validateExploredOpportunities } from '../../lib/narrative/projections/kinshipProjection';
import { requestCreativeOpportunities } from '../../services/apiClient';

const OPPORTUNITY_CATEGORIES = [
  'character arc',
  'relationships',
  'plot & stakes',
  'pacing',
  'themes',
  'foreshadowing',
  'worldbuilding',
  'voice & style',
] as const;

interface OpportunityCenterProps {
  project?: CreativeProject;
  projectId: string;
  projectRevision: number;
  proposals: OpportunityProposal[];
  aiConfigured?: boolean;
  onCreate: (input: OpportunityProposalInput, expectedRevision: number) => void;
  onTransition: (id: string, status: OpportunityProposalStatus, expectedRevision: number) => void;
  onSendToChangeReview?: (proposal: OpportunityProposal) => void;
}

const fieldClass = 'w-full rounded border border-gray-300 bg-white p-2 text-xs text-gray-900 dark:border-gray-700 dark:bg-gray-950 dark:text-gray-100';

export default function OpportunityCenter({
  project,
  projectId,
  projectRevision,
  proposals,
  aiConfigured = false,
  onCreate,
  onTransition,
  onSendToChangeReview,
}: OpportunityCenterProps) {
  const [description, setDescription] = useState('');
  const [sourceRefs, setSourceRefs] = useState('');
  const [rationale, setRationale] = useState('');
  const [benefit, setBenefit] = useState('');
  const [tradeOff, setTradeOff] = useState('');
  const [assumptions, setAssumptions] = useState('');

  // Explore Improvements (AI) state
  const [exploreScope, setExploreScope] = useState<'project' | 'scene' | 'character'>('project');
  const [exploreTargetId, setExploreTargetId] = useState('');
  const [selectedCategories, setSelectedCategories] = useState<string[]>(['character arc', 'plot & stakes', 'relationships']);
  const [customGoal, setCustomGoal] = useState('');
  const [exploring, setExploring] = useState(false);
  const [exploreStatus, setExploreStatus] = useState('');
  const [exploreError, setExploreError] = useState('');

  const ordered = proposals
    .filter((proposal) => proposal.projectId === projectId)
    .slice()
    .sort((a, b) => b.createdAt - a.createdAt || a.id.localeCompare(b.id));

  const sections = useMemo(() => (project ? manuscriptSections(project) : []), [project]);
  const characters = useMemo(
    () => (project ? project.snapshot.entities.filter((e) => !e.excluded && e.category === 'character') : []),
    [project]
  );

  const explorePayload = useMemo(() => {
    if (!project) return null;
    const confirmedEntities = project.snapshot.entities
      .filter((e) => !e.excluded && e.status === 'confirmed' && e.epistemicKind !== 'belief' && e.epistemicKind !== 'reported')
      .slice(0, 40)
      .map((e) => ({
        id: e.id ?? e.name,
        name: e.name,
        category: e.category,
        description: e.description?.slice(0, 400),
        status: e.status,
        attributes: e.attributes
          .filter((a) => a.status === 'confirmed' && a.name !== 'existence')
          .slice(0, 12)
          .map((a) => ({ id: a.id, name: a.name, value: a.confirmedValue ?? a.value[0]?.name ?? '', status: a.status })),
      }));
    const confirmedRels = project.snapshot.relationships
      .filter((r) => r.status === 'confirmed')
      .slice(0, 60)
      .map((r) => ({ id: r.id, sourceId: r.sourceId, targetId: r.targetId, source: r.source, target: r.target, label: r.label, status: r.status }));
    const storyBible: Record<string, string> = {};
    for (const [k, f] of Object.entries(project.snapshot.storyBible)) {
      if (f.status === 'confirmed' && f.value.trim()) storyBible[k] = f.value.trim().slice(0, 500);
    }
    const scopedSections =
      exploreScope === 'scene' && exploreTargetId
        ? sections.filter((s) => s.id === exploreTargetId)
        : sections.slice(0, 6);

    return {
      projectId: project.id,
      baseRevision: project.revision,
      scope: exploreScope,
      ...(exploreScope !== 'project' && exploreTargetId ? { scopeTargetId: exploreTargetId } : {}),
      categories: selectedCategories,
      ...(customGoal.trim() ? { customGoal: customGoal.trim() } : {}),
      entities: confirmedEntities,
      relationships: confirmedRels,
      storyBible,
      sections: scopedSections.map((s) => ({
        id: s.id,
        title: s.title || `${s.kind}`,
        kind: s.kind,
        text: s.text.slice(0, 4_000),
      })),
      existingTitles: ordered.map((o) => o.description.slice(0, 180)).slice(0, 40),
    };
  }, [project, exploreScope, exploreTargetId, selectedCategories, customGoal, sections, ordered]);

  const budgetDisclosure = useMemo(
    () => buildClientBudgetDisclosure('opportunities', `Explore Improvements (${exploreScope})`, explorePayload ?? ''),
    [explorePayload, exploreScope]
  );

  const handleExplore = async () => {
    if (!project || !explorePayload || exploring) return;
    if (!aiConfigured) {
      setExploreError('Server Gemini API key is not configured. Add a server key to run AI opportunity exploration.');
      return;
    }
    if (selectedCategories.length === 0) {
      setExploreError('Select at least one creative category.');
      return;
    }
    setExploring(true);
    setExploreError('');
    setExploreStatus('');
    try {
      const response = await requestCreativeOpportunities(explorePayload);
      const validated = validateExploredOpportunities(project, response.opportunities);
      if (validated.validInputs.length === 0) {
        setExploreStatus(
          validated.droppedDuplicates > 0
            ? `No new ideas added (${validated.droppedDuplicates} duplicate suggestion(s) skipped).`
            : 'No new opportunities returned for this scope.'
        );
      } else {
        for (const item of validated.validInputs) {
          onCreate(item, projectRevision);
        }
        const notes: string[] = [`Added ${validated.validInputs.length} AI suggestion(s) as pending ideas.`];
        if (validated.droppedDuplicates > 0) notes.push(`${validated.droppedDuplicates} duplicate(s) skipped.`);
        if (validated.strippedInvalidRefs > 0) notes.push(`${validated.strippedInvalidRefs} invalid ref(s) stripped.`);
        setExploreStatus(notes.join(' '));
      }
    } catch (cause) {
      setExploreError(cause instanceof Error ? cause.message : 'Opportunity exploration failed.');
    } finally {
      setExploring(false);
    }
  };

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
    <div className="flex-1 min-h-0 overflow-y-auto p-4 space-y-4">
      <header>
        <h3 className="font-display text-sm font-bold text-gray-900 dark:text-gray-100">Creative Opportunities</h3>
        <p className="text-xs text-gray-500 dark:text-gray-400">
          Optional story-improvement suggestions kept separate from diagnostics. Saving, staging, or accepting never changes your graph or manuscript until you explicitly send an idea to Change Review.
        </p>
      </header>

      {/* Explore Improvements (AI) */}
      {project && (
        <section aria-labelledby="explore-ai-heading" className="space-y-2.5 rounded border border-blue-200 bg-blue-50/30 p-3 dark:border-blue-900/60 dark:bg-blue-950/20">
          <h4 id="explore-ai-heading" className="text-xs font-semibold text-gray-900 dark:text-gray-100">
            Explore Improvements (AI)
          </h4>
          {!aiConfigured && (
            <p role="status" className="rounded border border-amber-300 bg-amber-50 p-2 text-[11px] text-amber-900 dark:border-amber-800 dark:bg-amber-950/50 dark:text-amber-200">
              AI exploration is unavailable because the server Gemini API key is not configured. You can still record, stage, and review manual ideas below.
            </p>
          )}
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 text-xs">
            <label className="space-y-1">
              <span className="font-medium">Scope</span>
              <select
                value={exploreScope}
                onChange={(e) => {
                  setExploreScope(e.target.value as 'project' | 'scene' | 'character');
                  setExploreTargetId('');
                }}
                className={fieldClass}
              >
                <option value="project">Whole Project</option>
                <option value="scene" disabled={sections.length === 0}>Specific Scene</option>
                <option value="character" disabled={characters.length === 0}>Specific Character</option>
              </select>
            </label>
            {exploreScope === 'scene' && (
              <label className="space-y-1">
                <span className="font-medium">Target Scene</span>
                <select value={exploreTargetId} onChange={(e) => setExploreTargetId(e.target.value)} className={fieldClass}>
                  <option value="">Choose scene…</option>
                  {sections.map((s) => (
                    <option key={s.id} value={s.id}>{s.title || `Untitled ${s.kind}`}</option>
                  ))}
                </select>
              </label>
            )}
            {exploreScope === 'character' && (
              <label className="space-y-1">
                <span className="font-medium">Target Character</span>
                <select value={exploreTargetId} onChange={(e) => setExploreTargetId(e.target.value)} className={fieldClass}>
                  <option value="">Choose character…</option>
                  {characters.map((c) => (
                    <option key={c.id ?? c.name} value={c.id ?? c.name}>{c.name}</option>
                  ))}
                </select>
              </label>
            )}
          </div>
          <fieldset className="space-y-1">
            <legend className="text-[11px] font-medium text-gray-700 dark:text-gray-300">Categories</legend>
            <div className="flex flex-wrap gap-1.5">
              {OPPORTUNITY_CATEGORIES.map((cat) => {
                const checked = selectedCategories.includes(cat);
                return (
                  <label key={cat} className="flex items-center gap-1 rounded border border-gray-200 bg-white px-2 py-0.5 text-[11px] dark:border-gray-700 dark:bg-gray-900">
                    <input
                      type="checkbox"
                      checked={checked}
                      onChange={(e) =>
                        setSelectedCategories((prev) =>
                          e.target.checked ? [...prev, cat] : prev.filter((item) => item !== cat)
                        )
                      }
                    />
                    <span className="capitalize">{cat}</span>
                  </label>
                );
              })}
            </div>
          </fieldset>
          <label className="block space-y-1 text-xs">
            <span className="font-medium">Optional focus goal</span>
            <input
              type="text"
              maxLength={500}
              value={customGoal}
              onChange={(e) => setCustomGoal(e.target.value)}
              placeholder="e.g. Raise tension before the dinner toast"
              className={fieldClass}
            />
          </label>
          <p className="text-[11px] text-gray-600 dark:text-gray-400 tabular-nums">
            Preflight: {budgetDisclosure.inputChars.toLocaleString()} / {budgetDisclosure.maxInputChars.toLocaleString()} chars · ~{budgetDisclosure.estimatedInputTokens.toLocaleString()} / {budgetDisclosure.maxInputTokens.toLocaleString()} est. tokens.
          </p>
          {budgetDisclosure.warning && <p role="alert" className="text-[11px] text-amber-800 dark:text-amber-300">{budgetDisclosure.warning}</p>}
          <button
            type="button"
            disabled={
              exploring ||
              !aiConfigured ||
              !budgetDisclosure.withinLimit ||
              selectedCategories.length === 0 ||
              (exploreScope !== 'project' && !exploreTargetId)
            }
            onClick={() => void handleExplore()}
            className="rounded bg-blue-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-blue-700 disabled:opacity-45"
          >
            {exploring ? 'Exploring ideas…' : 'Explore Improvements with AI'}
          </button>
          {exploreError && <p role="alert" className="text-xs text-red-700 dark:text-red-300">{exploreError}</p>}
          {exploreStatus && <p role="status" className="text-xs text-emerald-700 dark:text-emerald-300">{exploreStatus}</p>}
        </section>
      )}

      <form onSubmit={submit} className="space-y-2 rounded border border-gray-200 p-3 dark:border-gray-700">
        <h4 className="text-xs font-semibold">Record a manual opportunity</h4>
        <label className="block space-y-1 text-xs">Suggestion<textarea required value={description} onChange={(event) => setDescription(event.target.value)} className={fieldClass} rows={2} /></label>
        <label className="block space-y-1 text-xs">Source references <span className="text-gray-500">(one project ID or reference per line)</span><textarea value={sourceRefs} onChange={(event) => setSourceRefs(event.target.value)} className={fieldClass} rows={2} /></label>
        <label className="block space-y-1 text-xs">Rationale<textarea required value={rationale} onChange={(event) => setRationale(event.target.value)} className={fieldClass} rows={2} /></label>
        <label className="block space-y-1 text-xs">Potential benefit<textarea required value={benefit} onChange={(event) => setBenefit(event.target.value)} className={fieldClass} rows={2} /></label>
        <label className="block space-y-1 text-xs">Trade-off<textarea required value={tradeOff} onChange={(event) => setTradeOff(event.target.value)} className={fieldClass} rows={2} /></label>
        <label className="block space-y-1 text-xs">Assumptions <span className="text-gray-500">(one per line)</span><textarea value={assumptions} onChange={(event) => setAssumptions(event.target.value)} className={fieldClass} rows={2} /></label>
        <button type="submit" className="rounded bg-blue-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-blue-700">Save as pending idea</button>
      </form>

      <section aria-labelledby="opportunity-list-title" className="space-y-2">
        <h4 id="opportunity-list-title" className="text-xs font-semibold">Saved ideas ({ordered.length})</h4>
        {ordered.length === 0 ? (
          <p className="text-xs text-gray-500">No opportunities saved for this project.</p>
        ) : (
          ordered.map((proposal) => {
            const fresh = proposal.lifecycleRevision === projectRevision;
            const transition = (status: OpportunityProposalStatus) => onTransition(proposal.id, status, projectRevision);
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
    </div>
  );
}
