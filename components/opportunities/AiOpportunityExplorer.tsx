/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useEffect, useMemo, useRef, useState } from 'react';
import type { ManuscriptSection, OpportunityProposal } from '../../shared/narrativeTypes';
import type { CreativeProject } from '../../shared/types';
import type { OpportunityProposalInput } from '../../lib/narrative/opportunityProposals';
import { buildClientBudgetDisclosure } from '../../lib/narrative/aiBudgetClient';
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

interface AiOpportunityExplorerProps {
  project: CreativeProject;
  projectRevision: number;
  sections: ManuscriptSection[];
  existingProposals: OpportunityProposal[];
  opportunitiesAvailability: { eligible: boolean; reason?: string };
  fieldClass: string;
  onCreate: (input: OpportunityProposalInput, expectedRevision: number) => void;
  onCreateBatch?: (inputs: OpportunityProposalInput[], expectedRevision: number) => void;
}

const AiOpportunityExplorer: React.FC<AiOpportunityExplorerProps> = ({
  project,
  projectRevision,
  sections,
  existingProposals,
  opportunitiesAvailability,
  fieldClass,
  onCreate,
  onCreateBatch,
}) => {
  const [exploreScope, setExploreScope] = useState<'project' | 'scene' | 'character'>('project');
  const [exploreTargetId, setExploreTargetId] = useState('');
  const [selectedCategories, setSelectedCategories] = useState<string[]>([
    'character arc',
    'plot & stakes',
    'relationships',
  ]);
  const [customGoal, setCustomGoal] = useState('');
  const [exploring, setExploring] = useState(false);
  const [exploreStatus, setExploreStatus] = useState('');
  const [exploreError, setExploreError] = useState('');

  const mountedRef = useRef(true);
  const requestEpochRef = useRef(0);
  const abortControllerRef = useRef<AbortController | null>(null);
  const activeProjectIdRef = useRef(project.id);

  useEffect(() => {
    mountedRef.current = true;
    activeProjectIdRef.current = project.id;
    return () => {
      mountedRef.current = false;
      requestEpochRef.current += 1;
      abortControllerRef.current?.abort();
      abortControllerRef.current = null;
    };
  }, [project.id]);

  const characters = useMemo(
    () => project.snapshot.entities.filter((e) => !e.excluded && e.category === 'character'),
    [project.snapshot.entities]
  );

  const explorePayload = useMemo(() => {
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
      existingTitles: existingProposals.map((o) => o.description.slice(0, 180)).slice(0, 40),
    };
  }, [project, exploreScope, exploreTargetId, selectedCategories, customGoal, sections, existingProposals]);

  const budgetDisclosure = useMemo(
    () => buildClientBudgetDisclosure('opportunities', `Explore Improvements (${exploreScope})`, explorePayload),
    [explorePayload, exploreScope]
  );

  const handleExplore = async () => {
    if (exploring) return;
    if (!opportunitiesAvailability.eligible) {
      setExploreError(opportunitiesAvailability.reason ?? 'AI opportunity exploration is unavailable.');
      return;
    }
    if (selectedCategories.length === 0) {
      setExploreError('Select at least one creative category.');
      return;
    }

    abortControllerRef.current?.abort();
    const controller = new AbortController();
    abortControllerRef.current = controller;
    const epoch = ++requestEpochRef.current;
    const requestProjectId = project.id;

    setExploring(true);
    setExploreError('');
    setExploreStatus('');
    try {
      const response = await requestCreativeOpportunities(explorePayload, controller.signal);
      if (
        !mountedRef.current ||
        controller.signal.aborted ||
        epoch !== requestEpochRef.current ||
        requestProjectId !== activeProjectIdRef.current
      ) {
        return;
      }
      const validated = validateExploredOpportunities(project, response.opportunities);
      if (validated.validInputs.length === 0) {
        setExploreStatus(
          validated.droppedDuplicates > 0
            ? `No new ideas added (${validated.droppedDuplicates} duplicate suggestion(s) skipped).`
            : 'No new opportunities returned for this scope.'
        );
      } else {
        if (onCreateBatch) {
          onCreateBatch(validated.validInputs, projectRevision);
        } else {
          validated.validInputs.forEach((item, idx) => {
            onCreate(item, projectRevision + idx);
          });
        }
        const notes: string[] = [`Added ${validated.validInputs.length} AI suggestion(s) as pending ideas.`];
        if (validated.droppedDuplicates > 0) notes.push(`${validated.droppedDuplicates} duplicate(s) skipped.`);
        if (validated.strippedInvalidRefs > 0) notes.push(`${validated.strippedInvalidRefs} invalid ref(s) stripped.`);
        setExploreStatus(notes.join(' '));
      }
    } catch (cause) {
      if (
        !mountedRef.current ||
        controller.signal.aborted ||
        epoch !== requestEpochRef.current ||
        requestProjectId !== activeProjectIdRef.current
      ) {
        return;
      }
      setExploreError(cause instanceof Error ? cause.message : 'Opportunity exploration failed.');
    } finally {
      if (abortControllerRef.current === controller) {
        abortControllerRef.current = null;
      }
      if (mountedRef.current && epoch === requestEpochRef.current) {
        setExploring(false);
      }
    }
  };

  return (
    <section aria-labelledby="explore-ai-heading" className="space-y-2.5 rounded border border-blue-200 bg-blue-50/30 p-3 dark:border-blue-900/60 dark:bg-blue-950/20">
      <h4 id="explore-ai-heading" className="text-xs font-semibold text-gray-900 dark:text-gray-100">
        Explore Improvements (AI)
      </h4>
      {!opportunitiesAvailability.eligible && (
        <p role="status" className="rounded border border-amber-300 bg-amber-50 p-2 text-[11px] text-amber-900 dark:border-amber-800 dark:bg-amber-950/50 dark:text-amber-200">
          AI exploration is unavailable: {opportunitiesAvailability.reason ?? 'not currently eligible.'} You can still record, stage, and review manual ideas below.
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
          !opportunitiesAvailability.eligible ||
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
  );
};

export default AiOpportunityExplorer;
