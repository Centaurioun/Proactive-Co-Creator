/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useMemo, useState } from 'react';
import type { Entity, Relationship } from '../../shared/types';

export type PlanMobileTab = 'decisions' | 'graph' | 'inspector' | 'output';
export type PlanInspectorDestination = 'story-bible' | 'timeline' | 'mind-map' | 'opportunities';

export interface AdaptivePlanWorkspaceProps {
  projectName: string;
  pendingDecisionCount: number;
  mobileTab: PlanMobileTab;
  onMobileTabChange: (tab: PlanMobileTab) => void;
  entities: Entity[];
  relationships: Relationship[];
  selectedEntityId: string | null;
  selectedRelationshipId: string | null;
  onSelectEntity: (entity: Entity) => void;
  onSelectRelationship: (relationship: Relationship) => void;
  onOpenInspectorTab: (tab: PlanInspectorDestination) => void;
  outputExpanded: boolean;
  onToggleOutput: () => void;
  decisionInbox: React.ReactNode;
  graphCanvas: React.ReactNode;
  contextualInspector: React.ReactNode;
  generatedOutput: React.ReactNode;
  graphControls?: React.ReactNode;
}

function reviewLabel(status?: string, epistemicKind?: string): string {
  const kindLabel = epistemicKind === 'belief'
    ? 'Belief'
    : epistemicKind === 'reported'
      ? 'Reported'
      : epistemicKind === 'interpretation'
        ? 'Inference'
        : epistemicKind === 'ambiguous'
          ? 'Ambiguous'
          : epistemicKind === 'user-authored'
            ? 'Author canon'
            : '';
  const approvalLabel = status === 'confirmed'
    ? epistemicKind === 'user-authored' ? '' : 'Canon'
    : status === 'pending'
      ? 'Proposed'
      : status === 'rejected'
        ? 'Rejected'
        : '';
  return [kindLabel, approvalLabel].filter(Boolean).join(' · ') || 'Unreviewed';
}

const tabButtonClass =
  'inline-flex min-h-9 items-center rounded-lg border border-pcc-line bg-pcc-surface px-2.5 text-xs font-semibold text-pcc-ink shadow-sm hover:border-blue-300 hover:text-blue-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 dark:border-pcc-dark-line dark:bg-pcc-dark-surface dark:text-pcc-dark-ink dark:hover:border-blue-700 dark:hover:text-blue-300';

const AdaptivePlanWorkspace: React.FC<AdaptivePlanWorkspaceProps> = ({
  projectName,
  pendingDecisionCount,
  mobileTab,
  onMobileTabChange,
  entities,
  relationships,
  selectedEntityId,
  selectedRelationshipId,
  onSelectEntity,
  onSelectRelationship,
  onOpenInspectorTab,
  outputExpanded,
  onToggleOutput,
  decisionInbox,
  graphCanvas,
  contextualInspector,
  generatedOutput,
  graphControls,
}) => {
  const [showInbox, setShowInbox] = useState(false);
  const [showInspector, setShowInspector] = useState(true);
  const [entityQuery, setEntityQuery] = useState('');

  const visibleEntities = useMemo(() => {
    const query = entityQuery.trim().toLocaleLowerCase();
    return entities
      .filter((entity) => !entity.excluded && (entity.status ?? 'confirmed') !== 'rejected')
      .filter((entity) => !query || `${entity.name} ${entity.category ?? ''}`.toLocaleLowerCase().includes(query))
      .slice(0, 80);
  }, [entities, entityQuery]);

  const visibleRelationships = useMemo(() => {
    const query = entityQuery.trim().toLocaleLowerCase();
    return relationships
      .filter((relationship) => (relationship.status ?? 'confirmed') !== 'rejected')
      .filter((relationship) =>
        !query || `${relationship.source} ${relationship.label} ${relationship.target}`.toLocaleLowerCase().includes(query)
      )
      .slice(0, 80);
  }, [relationships, entityQuery]);

  const openInspector = (tab: PlanInspectorDestination) => {
    onOpenInspectorTab(tab);
    onMobileTabChange('inspector');
  };

  const decisionsClass = `min-h-0 flex-col overflow-hidden rounded-xl border border-pcc-line bg-pcc-surface dark:border-pcc-dark-line dark:bg-pcc-dark-canvas ${mobileTab === 'decisions' ? 'flex' : 'hidden'} ${showInbox ? 'xl:flex' : 'xl:hidden'}`;
  const canvasClass = `min-h-0 min-w-0 flex-col overflow-hidden rounded-xl border border-pcc-line bg-pcc-surface dark:border-pcc-dark-line dark:bg-pcc-dark-canvas ${mobileTab === 'graph' || mobileTab === 'output' ? 'flex' : 'hidden'} xl:flex`;
  const inspectorClass = `min-h-0 flex-col overflow-hidden rounded-xl border border-pcc-line bg-pcc-surface dark:border-pcc-dark-line dark:bg-pcc-dark-canvas ${mobileTab === 'inspector' ? 'flex' : 'hidden'} ${showInspector ? 'xl:flex' : 'xl:hidden'}`;

  return (
    <section
      aria-label="Story World and Canon Map workspace"
      className="flex h-full min-h-0 flex-col gap-2.5 overflow-hidden bg-pcc-canvas p-2.5 text-pcc-ink dark:bg-pcc-dark-canvas dark:text-pcc-dark-ink sm:gap-3 sm:p-3"
    >
      <header className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-pcc-line bg-pcc-surface px-3 py-2.5 shadow-sm dark:border-pcc-dark-line dark:bg-pcc-dark-surface sm:px-4">
        <div className="min-w-[150px]">
          <h1 className="font-display text-base font-bold tracking-tight sm:text-lg">
            World <span className="text-xs font-normal text-pcc-muted dark:text-pcc-dark-muted">· Story Bible, Canon Graph &amp; Relationships</span>
          </h1>
          <p className="max-w-[60ch] truncate text-xs text-pcc-muted dark:text-pcc-dark-muted" title={projectName}>
            {projectName} <span aria-hidden="true">/</span> narrative map &amp; entity canon
          </p>
        </div>

        <nav aria-label="World context tools" className="flex flex-wrap items-center gap-1.5">
          <button type="button" className={tabButtonClass} aria-expanded={showInbox} onClick={() => setShowInbox((value) => !value)}>
            Inbox <span className="ml-1 rounded-full bg-amber-100 px-1.5 py-0.5 text-[11px] text-amber-900 dark:bg-amber-950 dark:text-amber-200">{pendingDecisionCount}</span>
          </button>
          <button type="button" className={tabButtonClass} aria-expanded={showInspector} onClick={() => setShowInspector((value) => !value)}>
            Context
          </button>
          <button type="button" className={tabButtonClass} aria-expanded={outputExpanded} onClick={onToggleOutput}>
            Read output
          </button>
          <span aria-hidden="true" className="mx-0.5 hidden h-5 border-l border-pcc-line sm:block dark:border-pcc-dark-line" />
          <button type="button" className={`${tabButtonClass} hidden sm:inline-flex`} onClick={() => openInspector('story-bible')}>Story Bible</button>
          <button type="button" className={`${tabButtonClass} hidden sm:inline-flex`} onClick={() => openInspector('opportunities')}>Opportunities</button>
          <details className="relative hidden sm:block">
            <summary className={`${tabButtonClass} flex cursor-pointer list-none items-center`}>More views</summary>
            <div className="absolute right-0 z-20 mt-1 grid min-w-56 gap-1 rounded-lg border border-pcc-line bg-pcc-surface p-1.5 shadow-lg dark:border-pcc-dark-line dark:bg-pcc-dark-surface">
              <button type="button" className={`${tabButtonClass} justify-between text-left`} onClick={() => openInspector('timeline')}>
                <span>Timeline</span>
                <span className="rounded bg-amber-100 px-1.5 py-0.5 text-[10px] font-medium text-amber-900 dark:bg-amber-950 dark:text-amber-200">
                  Preview · Expands WP04
                </span>
              </button>
              <button type="button" className={`${tabButtonClass} justify-between text-left`} onClick={() => openInspector('mind-map')}>
                <span>Mind map</span>
                <span className="rounded bg-amber-100 px-1.5 py-0.5 text-[10px] font-medium text-amber-900 dark:bg-amber-950 dark:text-amber-200">
                  Preview · Expands WP04
                </span>
              </button>
            </div>
          </details>
        </nav>
      </header>

      <div className="hidden flex-wrap items-center gap-x-3 gap-y-1 rounded-lg border border-pcc-line/80 bg-pcc-surface/70 px-3 py-2 text-[11px] leading-4 text-pcc-muted dark:border-pcc-dark-line dark:bg-pcc-dark-surface/70 dark:text-pcc-dark-muted xl:flex" aria-label="Narrative evidence key">
        <span><strong className="text-pcc-ink dark:text-pcc-dark-ink">Canon</strong> confirmed</span>
        <span><strong className="text-pcc-ink dark:text-pcc-dark-ink">Belief</strong> held by a character</span>
        <span><strong className="text-pcc-ink dark:text-pcc-dark-ink">Inference</strong> interpretation</span>
        <span><strong className="text-pcc-ink dark:text-pcc-dark-ink">Proposed</strong> awaiting a decision</span>
        <span><strong className="text-pcc-ink dark:text-pcc-dark-ink">Questions</strong> stay in the inbox</span>
        <span><strong className="text-pcc-ink dark:text-pcc-dark-ink">Causation</strong> appears only in an explicit relationship</span>
      </div>
      <details className="rounded-lg border border-pcc-line/80 bg-pcc-surface/70 px-3 py-2 text-[11px] leading-4 text-pcc-muted dark:border-pcc-dark-line dark:bg-pcc-dark-surface/70 dark:text-pcc-dark-muted xl:hidden">
        <summary className="cursor-pointer font-semibold text-pcc-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-pcc-focus dark:text-pcc-dark-ink">Narrative evidence key</summary>
        <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1">
          <span><strong className="text-pcc-ink dark:text-pcc-dark-ink">Canon</strong> confirmed</span>
          <span><strong className="text-pcc-ink dark:text-pcc-dark-ink">Belief</strong> held by a character</span>
          <span><strong className="text-pcc-ink dark:text-pcc-dark-ink">Inference</strong> interpretation</span>
          <span><strong className="text-pcc-ink dark:text-pcc-dark-ink">Proposed</strong> awaiting a decision</span>
          <span><strong className="text-pcc-ink dark:text-pcc-dark-ink">Questions</strong> stay in the inbox</span>
          <span><strong className="text-pcc-ink dark:text-pcc-dark-ink">Causation</strong> appears only in an explicit relationship</span>
        </div>
      </details>

      {graphControls && (
        <details className="rounded-xl border border-pcc-line bg-pcc-surface px-3 py-2 dark:border-pcc-dark-line dark:bg-pcc-dark-surface xl:hidden">
          <summary className="cursor-pointer text-sm font-semibold text-pcc-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-pcc-focus dark:text-pcc-dark-ink">Story idea and generation</summary>
          <div className="mt-2">{graphControls}</div>
        </details>
      )}

      <div className={`grid min-h-0 flex-1 grid-cols-1 gap-2.5 xl:gap-3 ${
        showInbox && showInspector
          ? 'xl:grid-cols-[minmax(220px,0.82fr)_minmax(0,2.4fr)_minmax(250px,0.95fr)]'
          : showInbox
            ? 'xl:grid-cols-[minmax(250px,0.82fr)_minmax(0,2.4fr)]'
            : showInspector
              ? 'xl:grid-cols-[minmax(0,2.4fr)_minmax(250px,0.95fr)]'
              : 'xl:grid-cols-1'
      }`}>
        <aside className={decisionsClass} aria-label="Decision inbox">
          <div className="flex items-center justify-between border-b border-pcc-line px-3 py-2 dark:border-pcc-dark-line">
            <h2 className="text-sm font-semibold">Decision inbox</h2>
            <span className="text-xs text-pcc-muted dark:text-pcc-dark-muted">{pendingDecisionCount} pending</span>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto">{decisionInbox}</div>
        </aside>

        <main className={canvasClass} aria-label="Narrative graph and generated output">
          {graphControls && <div className="hidden shrink-0 xl:block">{graphControls}</div>}
          <div className={`min-h-0 flex-1 overflow-hidden ${mobileTab === 'graph' ? 'block' : 'hidden'} xl:block`}>{graphCanvas}</div>
          <section
            className={`flex-col overflow-hidden border-t border-pcc-line dark:border-pcc-dark-line ${
              mobileTab === 'output'
                ? 'flex min-h-0 flex-1'
                : outputExpanded
                  ? 'hidden xl:flex xl:h-[min(38vh,19rem)] xl:min-h-36 xl:shrink-0'
                  : 'hidden'
            }`}
            aria-label="Generated output reader"
          >
              <div className="flex items-center justify-between px-3 py-2">
                <h2 className="text-sm font-semibold">Generated output</h2>
                <button type="button" className="text-xs font-semibold text-blue-700 underline-offset-2 hover:underline dark:text-blue-300" onClick={() => onMobileTabChange('output')}>Open reader</button>
              </div>
              <div className="min-h-0 flex-1 overflow-y-auto px-2 pb-2">{generatedOutput}</div>
          </section>
        </main>

        <aside className={inspectorClass} aria-label="Contextual narrative inspector">
          <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
            <details className="shrink-0 border-b border-pcc-line dark:border-pcc-dark-line">
              <summary className="cursor-pointer px-3 py-2.5 text-xs font-semibold text-pcc-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-blue-500 dark:text-pcc-dark-ink">Navigate entities and relationships</summary>
              <div className="space-y-2 px-3 pb-3">
                <label className="sr-only" htmlFor="adaptive-plan-narrative-search">Search narrative map</label>
                <input
                  id="adaptive-plan-narrative-search"
                  type="search"
                  value={entityQuery}
                  onChange={(event) => setEntityQuery(event.target.value)}
                  placeholder="Find a character or relationship"
                  className="min-h-9 w-full rounded-md border border-pcc-line bg-pcc-surface px-2.5 text-xs text-pcc-ink placeholder:text-pcc-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 dark:border-pcc-dark-line dark:bg-pcc-dark-surface dark:text-pcc-dark-ink"
                />
                <ul className="max-h-36 space-y-0.5 overflow-y-auto" aria-label="Story entities">
                  {visibleEntities.map((entity) => (
                    <li key={entity.id ?? entity.name}>
                      <button
                        type="button"
                        aria-current={selectedEntityId === (entity.id ?? entity.name) ? 'true' : undefined}
                        onClick={() => {
                          onSelectEntity(entity);
                          onMobileTabChange('inspector');
                        }}
                        className="flex min-h-8 w-full items-center justify-between gap-2 rounded px-2 text-left text-xs hover:bg-pcc-canvas focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 dark:hover:bg-pcc-dark-line"
                      >
                        <span className="truncate">{entity.name}</span>
                        <span className="shrink-0 text-[10px] text-pcc-muted dark:text-pcc-dark-muted">{reviewLabel(entity.status, entity.epistemicKind)}</span>
                      </button>
                    </li>
                  ))}
                </ul>
                <ul className="max-h-36 space-y-0.5 overflow-y-auto border-t border-pcc-line pt-1 dark:border-pcc-dark-line" aria-label="Story relationships">
                  {visibleRelationships.map((relationship) => (
                    <li key={relationship.id ?? `${relationship.source}:${relationship.label}:${relationship.target}`}>
                      <button
                        type="button"
                        aria-current={selectedRelationshipId === relationship.id ? 'true' : undefined}
                        onClick={() => {
                          onSelectRelationship(relationship);
                          onMobileTabChange('inspector');
                        }}
                        className="flex min-h-8 w-full items-center justify-between gap-2 rounded px-2 text-left text-xs hover:bg-pcc-canvas focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 dark:hover:bg-pcc-dark-line"
                      >
                        <span className="min-w-0 truncate" title={`${relationship.source} — ${relationship.label} — ${relationship.target}`}>
                          {relationship.source} <span aria-hidden="true">→</span> {relationship.label} <span aria-hidden="true">→</span> {relationship.target}
                        </span>
                        <span className="shrink-0 text-[10px] text-pcc-muted dark:text-pcc-dark-muted">{reviewLabel(relationship.status, relationship.epistemicKind)}</span>
                      </button>
                    </li>
                  ))}
                  {visibleRelationships.length === 0 && <li className="px-2 py-1 text-xs text-pcc-muted">No matching relationships.</li>}
                </ul>
              </div>
            </details>
            <div className="min-h-0 flex-1 overflow-y-auto">{contextualInspector}</div>
          </div>
        </aside>
      </div>

    </section>
  );
};

export default AdaptivePlanWorkspace;
