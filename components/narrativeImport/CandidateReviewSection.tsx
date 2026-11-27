import type { CreativeProject } from '../../shared/types';
import type { ImportEnhancementProposal } from '../../shared/narrativeAiSchemas';
import type { ManuscriptSection } from '../../shared/narrativeTypes';
import type { ClientBudgetDisclosure } from '../../lib/narrative/aiBudgetClient';
import type { CrossProjectIdentityDecision, CrossProjectIdentityMatch } from '../../lib/narrative/import/appendApply';
import type { VerifiedExtraction } from '../../lib/narrative/import/proposalValidator';
import { workspaceButton } from '../manuscript/ManuscriptEditor';

interface CandidateReviewSectionProps {
  sourceOnlyMode: boolean;
  analysisComplete: boolean;
  progress: string;
  rejectedEvidenceCount: number;
  extraction: VerifiedExtraction;
  explicitProposalIds: string[];
  unclassifiedFindingsCount: number;
  scope: 'complete' | 'selective';
  identityMatches: Array<{ leftId: string; rightId: string; matchedName: string; reason: 'same-name' | 'alias-overlap' }>;
  acceptedIds: Set<string>;
  rejectedIds: Set<string>;
  creating: boolean;
  createError: string;
  strategy: 'faithful' | 'enhance';
  enhanceGoals: string;
  enhanceBudget: ClientBudgetDisclosure;
  enhanceBusy: boolean;
  enhanceError: string;
  enhancements: ImportEnhancementProposal[];
  acceptedEnhancementIds: Set<string>;
  aiConfigured: boolean;
  destination: 'new' | 'append';
  existingProjects: CreativeProject[];
  targetProject: CreativeProject | null;
  targetSections: ManuscriptSection[];
  insertPositionKey: string;
  appendTargetChanged: boolean;
  isDuplicateSource: boolean;
  allowDuplicateSource: boolean;
  crossProjectMatches: CrossProjectIdentityMatch[];
  identityDecisions: Record<string, CrossProjectIdentityDecision>;
  projectName: string;
  canAppendFeature: boolean;
  canCreateNew: boolean;
  canApplyAppend: boolean;
  onAcceptAllExplicit: () => void;
  onToggleAccepted: (id: string, checked: boolean) => void;
  onToggleRejected: (id: string, checked: boolean) => void;
  onEnhanceGoalsChange: (goals: string) => void;
  onRunStage2Enhancements: () => void;
  onToggleEnhancementAccepted: (id: string, checked: boolean) => void;
  onDestinationChange: (destination: 'new' | 'append') => void;
  onProjectNameChange: (name: string) => void;
  onSelectAppendTarget: (project: CreativeProject) => void;
  onInsertPositionChange: (key: string) => void;
  onAllowDuplicateSourceChange: (allowed: boolean) => void;
  onIdentityDecisionChange: (incomingEntityId: string, decision: CrossProjectIdentityDecision) => void;
  onCommitImport: () => void;
}

export function CandidateReviewSection(props: CandidateReviewSectionProps) {
  const {
    sourceOnlyMode, analysisComplete, progress, rejectedEvidenceCount, extraction, explicitProposalIds,
    unclassifiedFindingsCount, scope, identityMatches, acceptedIds, rejectedIds, creating, createError,
    strategy, enhanceGoals, enhanceBudget, enhanceBusy, enhanceError, enhancements, acceptedEnhancementIds,
    aiConfigured, destination, existingProjects, targetProject, targetSections, insertPositionKey,
    appendTargetChanged, isDuplicateSource, allowDuplicateSource, crossProjectMatches, identityDecisions,
    projectName, canAppendFeature, canCreateNew, canApplyAppend,
    onAcceptAllExplicit, onToggleAccepted, onToggleRejected, onEnhanceGoalsChange, onRunStage2Enhancements,
    onToggleEnhancementAccepted, onDestinationChange, onProjectNameChange, onSelectAppendTarget,
    onInsertPositionChange, onAllowDuplicateSourceChange, onIdentityDecisionChange, onCommitImport,
  } = props;

  return (
    <section className="space-y-4 rounded-xl border border-[#dad8d2] bg-white p-4 dark:border-gray-700 dark:bg-gray-900 sm:p-5" aria-labelledby="import-review-title">
      <h2 id="import-review-title" className="font-display text-xl font-semibold">
        {sourceOnlyMode ? '3. Confirm source-only destination' : '3. Review extracted candidates'}
      </h2>
      <p className="text-sm">
        {sourceOnlyMode
          ? 'No analysis was run. The complete inspected text remains the manuscript, and the source record carries its digest, parser metadata, and retention choice.'
          : `${analysisComplete ? 'All planned source segments were analyzed.' : `Partial analysis · ${progress}`}. Only confirmed findings enter the canonical graph; unchecked findings remain pending with evidence. Rejected quotes: ${rejectedEvidenceCount}. Duplicate names remain separate pending author review.`}
      </p>
      {!sourceOnlyMode && (
        <>
          <button
            type="button"
            className={workspaceButton}
            disabled={explicitProposalIds.length === 0 || creating}
            onClick={onAcceptAllExplicit}
          >
            Accept evidence-backed explicit findings ({explicitProposalIds.length})
          </button>

          {strategy === 'enhance' && (
            <Stage2EnhancementPanel
              enhanceGoals={enhanceGoals}
              enhanceBudget={enhanceBudget}
              enhanceBusy={enhanceBusy}
              enhanceError={enhanceError}
              enhancements={enhancements}
              acceptedEnhancementIds={acceptedEnhancementIds}
              aiConfigured={aiConfigured}
              onEnhanceGoalsChange={onEnhanceGoalsChange}
              onRunStage2Enhancements={onRunStage2Enhancements}
              onToggleEnhancementAccepted={onToggleEnhancementAccepted}
            />
          )}

          {destination === 'append' && targetProject && (
            <AppendIdentityReviewPanel
              targetProject={targetProject}
              isDuplicateSource={isDuplicateSource}
              allowDuplicateSource={allowDuplicateSource}
              crossProjectMatches={crossProjectMatches}
              identityDecisions={identityDecisions}
              onAllowDuplicateSourceChange={onAllowDuplicateSourceChange}
              onIdentityDecisionChange={onIdentityDecisionChange}
            />
          )}

          <ExtractionCandidatesList
            extraction={extraction}
            scope={scope}
            unclassifiedFindingsCount={unclassifiedFindingsCount}
            identityMatches={identityMatches}
            acceptedIds={acceptedIds}
            rejectedIds={rejectedIds}
            onToggleAccepted={onToggleAccepted}
            onToggleRejected={onToggleRejected}
          />
        </>
      )}

      <DestinationFieldset
        destination={destination}
        existingProjects={existingProjects}
        canAppendFeature={canAppendFeature}
        projectName={projectName}
        targetProject={targetProject}
        targetSections={targetSections}
        insertPositionKey={insertPositionKey}
        appendTargetChanged={appendTargetChanged}
        onDestinationChange={onDestinationChange}
        onProjectNameChange={onProjectNameChange}
        onSelectAppendTarget={onSelectAppendTarget}
        onInsertPositionChange={onInsertPositionChange}
      />

      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          className={workspaceButton}
          disabled={creating || (destination === 'new' ? !canCreateNew : !canApplyAppend)}
          onClick={onCommitImport}
        >
          {creating
            ? destination === 'append' ? 'Appending to project…' : 'Creating project…'
            : destination === 'append' ? `Append to "${targetProject?.name ?? 'Project'}"` : 'Create Project'}
        </button>
        {createError && <p role="alert" className="text-sm text-red-700 dark:text-red-300">{createError}</p>}
      </div>
    </section>
  );
}

function Stage2EnhancementPanel({
  enhanceGoals, enhanceBudget, enhanceBusy, enhanceError, enhancements, acceptedEnhancementIds, aiConfigured,
  onEnhanceGoalsChange, onRunStage2Enhancements, onToggleEnhancementAccepted,
}: {
  enhanceGoals: string;
  enhanceBudget: ClientBudgetDisclosure;
  enhanceBusy: boolean;
  enhanceError: string;
  enhancements: ImportEnhancementProposal[];
  acceptedEnhancementIds: Set<string>;
  aiConfigured: boolean;
  onEnhanceGoalsChange: (goals: string) => void;
  onRunStage2Enhancements: () => void;
  onToggleEnhancementAccepted: (id: string, checked: boolean) => void;
}) {
  return (
    <div className="space-y-2.5 rounded border border-indigo-200 bg-indigo-50/30 p-3 text-xs dark:border-indigo-900/60 dark:bg-indigo-950/20">
      <h3 className="font-semibold text-sm text-indigo-900 dark:text-indigo-200">
        Optional Stage 2: Post-Faithful Enhancement &amp; Correction Proposals
      </h3>
      <p>
        Faithful extraction above is complete and immutable. Optionally generate separate creative/correction suggestions saved as pending opportunities — never mixed into extracted facts or original source text.
      </p>
      <label className="block space-y-1">
        <span className="font-medium">Optional enhancement goals</span>
        <input
          type="text"
          maxLength={500}
          value={enhanceGoals}
          onChange={(e) => onEnhanceGoalsChange(e.target.value)}
          placeholder="e.g. Flag dialogue rhythm improvements or continuity corrections"
          className="w-full rounded border border-gray-300 bg-white px-2 py-1 dark:border-gray-700 dark:bg-gray-950"
        />
      </label>
      <p className="text-[11px] text-gray-600 dark:text-gray-400 tabular-nums">
        Preflight: {enhanceBudget.inputChars.toLocaleString()} / {enhanceBudget.maxInputChars.toLocaleString()} chars · ~{enhanceBudget.estimatedInputTokens.toLocaleString()} / {enhanceBudget.maxInputTokens.toLocaleString()} est. tokens.
      </p>
      <button
        type="button"
        disabled={enhanceBusy || !aiConfigured || !enhanceBudget.withinLimit}
        onClick={onRunStage2Enhancements}
        className="rounded bg-indigo-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-indigo-700 disabled:opacity-45"
      >
        {enhanceBusy ? 'Generating Stage 2 proposals…' : 'Generate Enhancement Proposals'}
      </button>
      {enhanceError && <p role="alert" className="text-red-700 dark:text-red-300">{enhanceError}</p>}
      {enhancements.length > 0 && (
        <div className="space-y-2 pt-1">
          {enhancements.map((enh) => (
            <article key={enh.id} className="rounded border border-indigo-200 bg-white p-2.5 space-y-1 dark:border-indigo-800 dark:bg-gray-900">
              <label className="flex items-center gap-2 font-semibold">
                <input
                  type="checkbox"
                  checked={acceptedEnhancementIds.has(enh.id)}
                  onChange={(e) => onToggleEnhancementAccepted(enh.id, e.target.checked)}
                />
                <span>{enh.title}</span>
                <span className="rounded bg-indigo-100 px-1.5 py-0.5 text-[10px] uppercase text-indigo-800 dark:bg-indigo-950 dark:text-indigo-300">
                  AI Enhancement · {enh.category}
                </span>
              </label>
              <p>{enh.rationale}</p>
              {enh.beforeExcerpt && <p className="text-red-700 dark:text-red-300">Before: {enh.beforeExcerpt}</p>}
              <p className="text-emerald-700 dark:text-emerald-300">Suggested: {enh.afterExcerpt}</p>
              {enh.assumptions.length > 0 && <p className="text-[11px] text-gray-500">Assumptions: {enh.assumptions.join('; ')}</p>}
            </article>
          ))}
        </div>
      )}
    </div>
  );
}

function AppendIdentityReviewPanel({
  targetProject, isDuplicateSource, allowDuplicateSource, crossProjectMatches, identityDecisions,
  onAllowDuplicateSourceChange, onIdentityDecisionChange,
}: {
  targetProject: CreativeProject;
  isDuplicateSource: boolean;
  allowDuplicateSource: boolean;
  crossProjectMatches: CrossProjectIdentityMatch[];
  identityDecisions: Record<string, CrossProjectIdentityDecision>;
  onAllowDuplicateSourceChange: (allowed: boolean) => void;
  onIdentityDecisionChange: (incomingEntityId: string, decision: CrossProjectIdentityDecision) => void;
}) {
  return (
    <div className="space-y-2.5 rounded border border-amber-300 bg-amber-50/40 p-3 text-xs dark:border-amber-800 dark:bg-amber-950/20">
      <h3 className="font-semibold text-sm">Append Conflict &amp; Identity Review ({targetProject.name})</h3>
      {isDuplicateSource && (
        <div className="rounded border border-red-300 bg-red-50/50 p-2 space-y-1 dark:border-red-800 dark:bg-red-950/30">
          <p className="font-semibold text-red-800 dark:text-red-300">
            Duplicate source detected: a source with the exact same SHA-256 digest already exists in &ldquo;{targetProject.name}&rdquo;.
          </p>
          <label className="flex items-center gap-2">
            <input type="checkbox" checked={allowDuplicateSource} onChange={(e) => onAllowDuplicateSourceChange(e.target.checked)} />
            I intentionally want to append this duplicate source again.
          </label>
        </div>
      )}
      {crossProjectMatches.length === 0 ? (
        <p className="text-emerald-800 dark:text-emerald-300">No entity name/alias collisions detected with &ldquo;{targetProject.name}&rdquo;.</p>
      ) : (
        <div className="space-y-2">
          <p>
            Found {crossProjectMatches.length} potential entity collision(s). Choose explicitly whether to keep separate or link to the existing entity before applying append.
          </p>
          {crossProjectMatches.map((match) => (
            <div key={match.incomingEntityId} className="flex flex-wrap items-center justify-between gap-2 rounded border border-amber-300 bg-white p-2 dark:border-amber-800 dark:bg-gray-900">
              <div>
                <span className="font-semibold">{match.incomingEntityName}</span> ↔ <span className="font-semibold">{match.existingEntityName}</span>
                <span className="ml-2 text-gray-500">({match.matchReason})</span>
              </div>
              <div className="flex items-center gap-3">
                <label className="flex items-center gap-1">
                  <input
                    type="radio"
                    name={`id-decision-${match.incomingEntityId}`}
                    checked={identityDecisions[match.incomingEntityId] === 'keep-separate'}
                    onChange={() => onIdentityDecisionChange(match.incomingEntityId, 'keep-separate')}
                  />
                  Keep Separate
                </label>
                <label className="flex items-center gap-1">
                  <input
                    type="radio"
                    name={`id-decision-${match.incomingEntityId}`}
                    checked={identityDecisions[match.incomingEntityId] === 'link-to-existing'}
                    onChange={() => onIdentityDecisionChange(match.incomingEntityId, 'link-to-existing')}
                  />
                  Link to Existing
                </label>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function ExtractionCandidatesList({
  extraction, scope, unclassifiedFindingsCount, identityMatches, acceptedIds, rejectedIds,
  onToggleAccepted, onToggleRejected,
}: {
  extraction: VerifiedExtraction;
  scope: 'complete' | 'selective';
  unclassifiedFindingsCount: number;
  identityMatches: Array<{ leftId: string; rightId: string; matchedName: string; reason: 'same-name' | 'alias-overlap' }>;
  acceptedIds: Set<string>;
  rejectedIds: Set<string>;
  onToggleAccepted: (id: string, checked: boolean) => void;
  onToggleRejected: (id: string, checked: boolean) => void;
}) {
  return (
    <div className="max-h-[55vh] space-y-3 overflow-auto">
      <h3 className="font-medium">Entities and attributes ({extraction.entities.length})</h3>
      {extraction.entities.map((entity) => (
        <article key={entity.id} className="rounded border p-3">
          <label className="flex gap-2 font-medium">
            <input type="checkbox" checked={acceptedIds.has(entity.id)} onChange={(event) => onToggleAccepted(entity.id, event.target.checked)} />
            {entity.name} · {entity.category} · {entity.kind}
          </label>
          <p>{entity.description || entity.rationale}</p>
          <EvidenceQuote evidence={entity.evidence} />
          {entity.attributes.map((attribute) => (
            <div key={attribute.id} className="ml-4 mt-2 border-l pl-3">
              <label className="flex gap-2">
                <input type="checkbox" checked={acceptedIds.has(attribute.id)} disabled={!acceptedIds.has(entity.id)} onChange={(event) => onToggleAccepted(attribute.id, event.target.checked)} />
                {attribute.name}: {attribute.value} · {attribute.kind}
              </label>
              <EvidenceQuote evidence={attribute.evidence} />
            </div>
          ))}
        </article>
      ))}
      <h3 className="font-medium">Directed relationships ({extraction.relationships.length})</h3>
      {extraction.relationships.map((relation) => (
        <article key={relation.id} className="rounded border p-3">
          <label className="flex gap-2">
            <input type="checkbox" checked={acceptedIds.has(relation.id)} onChange={(event) => onToggleAccepted(relation.id, event.target.checked)} />
            {relation.source} → {relation.target} · {relation.label} · {relation.kind}
          </label>
          <p>{relation.rationale}</p>
          <EvidenceQuote evidence={relation.evidence} />
        </article>
      ))}
      <h3 className="font-medium">Findings for review ({extraction.findings.length})</h3>
      {scope === 'complete' && unclassifiedFindingsCount > 0 && (
        <p role="status" className="rounded border border-amber-400 p-3 text-sm">
          {unclassifiedFindingsCount} unclassified findings retained for review. Complete segment coverage does not mean every fact or category was understood.
        </p>
      )}
      {extraction.findings.map((finding) => (
        <article key={finding.id} className="rounded border p-3">
          <label className="flex gap-2">
            <input type="checkbox" checked={acceptedIds.has(finding.id)} onChange={(event) => onToggleAccepted(finding.id, event.target.checked)} />
            {finding.title}: {finding.value} · {finding.category} · {finding.kind}
          </label>
          <p>{finding.rationale}</p>
          <EvidenceQuote evidence={finding.evidence} />
          <button type="button" className="text-sm underline" onClick={() => onToggleRejected(finding.id, !rejectedIds.has(finding.id))}>
            {rejectedIds.has(finding.id) ? 'Mark pending' : 'Reject finding'}
          </button>
        </article>
      ))}
      <h3 className="font-medium">Ambiguities and possible issues ({extraction.ambiguities.length})</h3>
      {extraction.ambiguities.map((issue) => (
        <article key={issue.id} className="rounded border border-amber-400 p-3">
          <p className="font-medium">{issue.title} · {issue.certainty}</p>
          <p>{issue.detail}</p>
          <p>{issue.rationale}</p>
          <EvidenceQuote evidence={issue.evidence} />
        </article>
      ))}
      {identityMatches.map((match) => (
        <p key={`${match.leftId}:${match.rightId}`} className="rounded border border-amber-400 p-3">
          Possible same identity: {match.matchedName}. The two proposals remain separate; the resulting issue will require clarification.
        </p>
      ))}
    </div>
  );
}

function DestinationFieldset({
  destination, existingProjects, canAppendFeature, projectName, targetProject, targetSections, insertPositionKey, appendTargetChanged,
  onDestinationChange, onProjectNameChange, onSelectAppendTarget, onInsertPositionChange,
}: {
  destination: 'new' | 'append';
  existingProjects: CreativeProject[];
  canAppendFeature: boolean;
  projectName: string;
  targetProject: CreativeProject | null;
  targetSections: ManuscriptSection[];
  insertPositionKey: string;
  appendTargetChanged: boolean;
  onDestinationChange: (dest: 'new' | 'append') => void;
  onProjectNameChange: (name: string) => void;
  onSelectAppendTarget: (project: CreativeProject) => void;
  onInsertPositionChange: (key: string) => void;
}) {
  return (
    <fieldset className="space-y-3 rounded-lg border border-[#dad8d2] bg-[#fbfaf7] p-4 dark:border-gray-700 dark:bg-gray-950" aria-labelledby="import-destination-title">
      <legend id="import-destination-title" className="font-semibold">4. Choose destination and commit</legend>
      <div className="flex flex-wrap gap-4 text-sm">
        <label className="flex items-center gap-2">
          <input type="radio" name="import-destination" checked={destination === 'new'} onChange={() => onDestinationChange('new')} />
          Create a new project
        </label>
        <label className="flex items-center gap-2">
          <input
            type="radio"
            name="import-destination"
            disabled={existingProjects.length === 0 || !canAppendFeature}
            checked={destination === 'append'}
            onChange={() => {
              onDestinationChange('append');
              const selected = targetProject ?? existingProjects[0];
              if (selected) onSelectAppendTarget(selected);
            }}
          />
          Append to an existing project
        </label>
      </div>
      {destination === 'new' ? (
        <label className="block max-w-xl space-y-1 text-sm font-medium" htmlFor="import-project-name">
          <span>New project name</span>
          <input id="import-project-name" className="min-h-10 w-full rounded-lg border border-[#dad8d2] bg-white px-3 font-normal dark:border-gray-700 dark:bg-gray-900" value={projectName} onChange={(event) => onProjectNameChange(event.target.value)} />
        </label>
      ) : (
        <div className="grid gap-3 rounded-lg border border-[#dad8d2] bg-white p-3 text-sm sm:grid-cols-2 dark:border-gray-700 dark:bg-gray-900">
          <label className="space-y-1">
            <span className="block font-semibold">Target project</span>
            <select
              value={targetProject?.id ?? ''}
              onChange={(event) => {
                const selected = existingProjects.find((item) => item.id === event.target.value);
                if (selected) onSelectAppendTarget(selected);
              }}
              className="min-h-10 w-full rounded border border-gray-300 bg-white px-2 dark:border-gray-700 dark:bg-gray-950"
            >
              {!targetProject && <option value="">Select a project</option>}
              {existingProjects.map((item) => <option key={item.id} value={item.id}>{item.name} · Revision {item.revision}</option>)}
            </select>
          </label>
          <label className="space-y-1">
            <span className="block font-semibold">Insert position</span>
            <select value={insertPositionKey} onChange={(event) => onInsertPositionChange(event.target.value)} className="min-h-10 w-full rounded border border-gray-300 bg-white px-2 dark:border-gray-700 dark:bg-gray-950">
              <option value="end">At the end</option>
              <option value="beginning">At the beginning</option>
              {targetSections.map((section, index) => <option key={section.id} value={section.id}>After {index + 1}: {section.title || `Untitled ${section.kind}`}</option>)}
            </select>
          </label>
          {appendTargetChanged && targetProject && (
            <div role="alert" className="sm:col-span-2">
              The target project changed. Review its insertion point and identity matches again.{' '}
              <button type="button" className="underline" onClick={() => onSelectAppendTarget(targetProject)}>Review updated target</button>
            </div>
          )}
          <p className="text-xs text-gray-600 dark:text-gray-400 sm:col-span-2">
            A verified safety checkpoint is created before appending. Matching identities stay separate unless you explicitly choose to link them. Appending is a separate commit.
          </p>
        </div>
      )}
    </fieldset>
  );
}

function EvidenceQuote({ evidence }: { evidence: VerifiedExtraction['findings'][number]['evidence'] }) {
  return (
    <blockquote className="whitespace-pre-wrap break-words border-l-2 pl-3 text-sm">
      <span>{evidence.excerpt}</span>
      <span className="mt-1 block text-xs text-gray-600 dark:text-gray-400">
        Source characters {evidence.start}–{evidence.end} · {evidence.sourceId.slice(0, 8)} · {evidence.version}
      </span>
    </blockquote>
  );
}
