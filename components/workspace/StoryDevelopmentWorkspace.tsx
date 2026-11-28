import React, { useMemo, useState } from 'react';
import type { CreativeProject } from '../../shared/types';
import type { CreativeIdeaCard, CreativeSession } from '../../shared/creativeSessionTypes';
import type { UnifiedProposal } from '../../shared/unifiedProposalTypes';
import { manuscriptSections } from '../../lib/narrative/manuscriptModel';
import {
  buildCreativeSessionContextPacket,
  buildUnifiedProposalFromIdeaCard,
  createCreativeIdeaCard,
  createCreativeSession,
} from '../../lib/narrative/sessions/creativeSessionEngine';
import { executeGroundedCreativeAction } from '../../lib/narrative/sessions/creativeActionService';
import { listProjectCreativeLocks } from '../../lib/narrative/proposals/creativeLocks';
import type { WorkspaceDisclosureMode } from '../../lib/workspacePreference';

interface StoryDevelopmentWorkspaceProps {
  project: CreativeProject;
  aiConfigured?: boolean;
  disclosureMode?: WorkspaceDisclosureMode;
  onReviewUnifiedProposal: (proposal: UnifiedProposal) => void;
  onOpenCreativeLocks: () => void;
  onJumpToSection?: (sectionId: string) => void;
  onOpenInCreativeStudio?: (session: CreativeSession, card?: CreativeIdeaCard) => void;
}

const CRAFT_DEVELOPMENT_LENSES = [
  {
    id: 'expand-continue',
    label: 'Expand & Continue Beat',
    prompt: 'Extend the current scene momentum with grounded sensory detail and rising stakes.',
    action: 'develop-further' as const,
  },
  {
    id: 'character-depth',
    label: 'Deepen Character Subtext',
    prompt: 'Sharpen internal contradiction and nonverbal agency for the focal characters.',
    action: 'develop-further' as const,
  },
  {
    id: 'scene-dialogue',
    label: 'Tighten Scene & Dialogue',
    prompt: 'Increase dramatic compression, subtext, and turn-by-turn objective friction in dialogue.',
    action: 'develop-further' as const,
  },
  {
    id: 'pacing-structure',
    label: 'Pacing & Causal Turn',
    prompt: 'Calibrate beat rhythm so the scene pivot lands with earned causal inevitability.',
    action: 'discover' as const,
  },
];

export const StoryDevelopmentWorkspace: React.FC<StoryDevelopmentWorkspaceProps> = ({
  project,
  aiConfigured = false,
  onReviewUnifiedProposal,
  onOpenCreativeLocks,
  onJumpToSection,
  onOpenInCreativeStudio,
}) => {
  const sections = useMemo(() => manuscriptSections(project), [project]);
  const [selectedSectionId, setSelectedSectionId] = useState<string>(
    sections[0]?.id ?? ''
  );
  const [preservationPolicy, setPreservationPolicy] = useState(
    'Preserve existing POV, character voice, and timeline facts.'
  );
  const [customInstruction, setCustomInstruction] = useState('');
  const [useServerAi, setUseServerAi] = useState(false);
  const [loadingLensId, setLoadingLensId] = useState<string | null>(null);
  const [stagedProposal, setStagedProposal] = useState<UnifiedProposal | null>(null);

  const selectedSection = useMemo(
    () => sections.find((s) => s.id === selectedSectionId) ?? sections[0],
    [sections, selectedSectionId]
  );

  const activeLocks = useMemo(() => listProjectCreativeLocks(project), [project]);

  const handleRunCraftLens = async (lens: (typeof CRAFT_DEVELOPMENT_LENSES)[number]) => {
    setLoadingLensId(lens.id);
    try {
      const session = createCreativeSession(project, {
        title: `Story Dev: ${lens.label}`,
        mode: 'focused',
        scope: {
          kind: selectedSection ? 'section' : 'project',
          sectionIds: selectedSection ? [selectedSection.id] : [],
          entityIds: [],
        },
        goal: customInstruction.trim() || lens.prompt,
        compassSummary: preservationPolicy,
      });

      const { packet } = buildCreativeSessionContextPacket(
        project,
        session.scope,
        `${lens.prompt} ${customInstruction}`,
        'story-development'
      );

      const { response } = await executeGroundedCreativeAction(
        project,
        session,
        lens.action,
        {
          customInput: `${lens.prompt}${customInstruction.trim() ? ` Focus: ${customInstruction.trim()}` : ''}`,
          useServerAi: useServerAi && aiConfigured,
        }
      );

      const generated = response.ideas[0];
      const { session: nextSession, card } = createCreativeIdeaCard(project, session, {
        title: generated?.title || lens.label,
        summary: generated?.summary || response.engineSummary,
        rationale: `${generated?.rationale || lens.prompt} (${packet.includedItems.length} E1 chunks packed)`,
        epistemicStatus: 'concrete-patch',
        craftNote: generated?.craftNote,
        patchBlueprint: {
          targetSectionId: selectedSection?.id,
          targetSectionTitle: selectedSection?.title.trim() || 'Untitled Scene',
          proposedProse: generated?.proposedProse || generated?.summary || lens.prompt,
          operationMode: selectedSection ? 'append-section' : 'world-note',
        },
      });

      const rawProposal = buildUnifiedProposalFromIdeaCard(project, nextSession, card);
      const storyDevProposal: UnifiedProposal = {
        ...rawProposal,
        originOperation: 'story-development',
        title: `Story Development (${lens.label}): ${selectedSection?.title.trim() || project.name}`,
      };
      setStagedProposal(storyDevProposal);

      if (onOpenInCreativeStudio) {
        // Keep available for optional Studio handoff without navigating away
      }
    } finally {
      setLoadingLensId(null);
    }
  };

  return (
    <section
      aria-label="Story Development workspace"
      data-testid="story-development-workspace"
      className="flex h-full min-h-0 flex-1 flex-col overflow-y-auto bg-pcc-canvas p-4 text-xs text-pcc-ink dark:bg-pcc-dark-canvas dark:text-pcc-dark-ink space-y-4"
    >
      {/* Header */}
      <header className="pcc-canon-surface flex flex-wrap items-center justify-between gap-3 rounded-xl border p-4 shadow-sm">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="font-display text-lg font-bold tracking-tight">
              Story Development
            </h1>
            <span className="rounded border border-indigo-500/40 bg-indigo-950/15 px-2 py-0.5 text-[10px] font-semibold uppercase text-indigo-700 dark:text-indigo-300">
              Scoped Craft Workspace
            </span>
          </div>
          <p className="mt-0.5 text-xs text-pcc-muted dark:text-pcc-dark-muted">
            Develop existing scenes and character arcs against Two-Tier Creative Locks and stage directly to Unified Proposal Review (E3).
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={onOpenCreativeLocks}
            className="rounded-lg border border-amber-500/40 bg-amber-950/10 px-3 py-1.5 font-semibold text-amber-700 hover:bg-amber-950/20 dark:text-amber-300"
          >
            Creative Locks ({activeLocks.filter((l) => l.active).length} Active)
          </button>
          <label className="inline-flex cursor-pointer items-center gap-1.5 rounded-lg border border-pcc-line px-2.5 py-1.5 dark:border-pcc-dark-line">
            <input
              type="checkbox"
              checked={useServerAi}
              disabled={!aiConfigured}
              onChange={(e) => setUseServerAi(e.target.checked)}
              className="h-3.5 w-3.5 rounded"
            />
            <span>Use Live AI {aiConfigured ? '' : '(Local E1 Craft Synthesis)'}</span>
          </label>
        </div>
      </header>

      {/* Scope & Preservation Controls */}
      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_22rem]">
        <div className="space-y-4">
          <div className="pcc-canon-surface rounded-xl border p-4 space-y-3 shadow-sm">
            <div className="grid gap-3 sm:grid-cols-2">
              <div>
                <label className="block text-[10px] font-bold uppercase tracking-wide text-pcc-muted">
                  Target Scene / Section
                </label>
                <div className="mt-1 flex items-center gap-2">
                  <select
                    aria-label="Target scene"
                    data-testid="story-dev-scene-select"
                    value={selectedSection?.id ?? ''}
                    onChange={(e) => setSelectedSectionId(e.target.value)}
                    className="w-full rounded-md border border-pcc-line bg-pcc-canvas px-2.5 py-1.5 dark:border-pcc-dark-line dark:bg-pcc-dark-canvas"
                  >
                    {sections.length === 0 ? (
                      <option value="">No manuscript scenes yet (Project World Note mode)</option>
                    ) : (
                      sections.map((s, idx) => (
                        <option key={s.id} value={s.id}>
                          {s.title.trim() || `Scene ${idx + 1}`}
                        </option>
                      ))
                    )}
                  </select>
                  {selectedSection && onJumpToSection && (
                    <button
                      type="button"
                      onClick={() => onJumpToSection(selectedSection.id)}
                      className="shrink-0 rounded-md border border-pcc-line px-2.5 py-1.5 font-medium hover:bg-pcc-canvas dark:border-pcc-dark-line"
                    >
                      Edit
                    </button>
                  )}
                </div>
              </div>

              <div>
                <label className="block text-[10px] font-bold uppercase tracking-wide text-pcc-muted">
                  Preservation Policy
                </label>
                <input
                  type="text"
                  value={preservationPolicy}
                  onChange={(e) => setPreservationPolicy(e.target.value)}
                  className="mt-1 w-full rounded-md border border-pcc-line bg-pcc-canvas px-2.5 py-1.5 dark:border-pcc-dark-line dark:bg-pcc-dark-canvas"
                />
              </div>
            </div>

            <div>
              <label className="block text-[10px] font-bold uppercase tracking-wide text-pcc-muted">
                Specific Craft Goal (Optional)
              </label>
              <input
                type="text"
                data-testid="story-dev-instruction-input"
                value={customInstruction}
                onChange={(e) => setCustomInstruction(e.target.value)}
                placeholder="e.g. Heighten suspense before Arya opens the ledger…"
                className="mt-1 w-full rounded-md border border-pcc-line bg-pcc-canvas px-2.5 py-2 dark:border-pcc-dark-line dark:bg-pcc-dark-canvas"
              />
            </div>

            {/* Working Craft Lenses */}
            <div className="grid gap-2.5 sm:grid-cols-2">
              {CRAFT_DEVELOPMENT_LENSES.map((lens) => (
                <button
                  key={lens.id}
                  type="button"
                  data-testid={`story-dev-lens-${lens.id}`}
                  disabled={loadingLensId !== null}
                  onClick={() => void handleRunCraftLens(lens)}
                  className="rounded-xl border border-pcc-line bg-pcc-canvas p-3 text-left transition-colors hover:border-pcc-action hover:bg-pcc-surface disabled:opacity-50 dark:border-pcc-dark-line dark:bg-pcc-dark-canvas"
                >
                  <div className="font-bold text-pcc-ink dark:text-pcc-dark-ink">
                    {loadingLensId === lens.id ? 'Preparing Draft…' : lens.label}
                  </div>
                  <div className="mt-0.5 text-[11px] text-pcc-muted">
                    {lens.prompt}
                  </div>
                </button>
              ))}
            </div>
          </div>

          {/* Staged Proposal Output (`originOperation: 'story-development'`) */}
          {stagedProposal && (
            <div
              data-testid="story-dev-staged-proposal-card"
              className="pcc-draft-surface rounded-xl p-4 space-y-2.5"
            >
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="font-bold text-sm">{stagedProposal.title}</span>
                <span className="rounded bg-pcc-surface px-2 py-0.5 font-mono text-[10px] uppercase border border-pcc-line dark:bg-pcc-dark-surface">
                  Origin: {stagedProposal.originOperation} · Base r{stagedProposal.baseRevision}
                </span>
              </div>
              <p className="text-pcc-muted">{stagedProposal.rationale}</p>
              {stagedProposal.manuscriptHunks[0] && (
                <div className="rounded-lg border border-pcc-line bg-pcc-surface p-3 font-serif text-xs whitespace-pre-wrap dark:bg-pcc-dark-surface">
                  {stagedProposal.manuscriptHunks[0].replacementText}
                </div>
              )}
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  data-testid="story-dev-open-e3-btn"
                  onClick={() => onReviewUnifiedProposal(stagedProposal)}
                  className="rounded-lg bg-emerald-600 px-3.5 py-2 font-bold text-white hover:bg-emerald-500"
                >
                  Review &amp; Apply in E3 →
                </button>
              </div>
            </div>
          )}
        </div>

        {/* Right Column: Active Scene Excerpt + Honest WP04 Future Lenses */}
        <aside className="space-y-3">
          {selectedSection && (
            <div className="pcc-reference-surface rounded-xl p-3.5 space-y-2">
              <div className="text-[10px] font-bold uppercase tracking-wide text-pcc-evidence-ink dark:text-emerald-300">
                Canonical Scene Reference (Read-Only)
              </div>
              <div className="font-semibold">{selectedSection.title}</div>
              <div className="max-h-56 overflow-y-auto whitespace-pre-wrap font-serif text-xs leading-relaxed text-pcc-muted">
                {selectedSection.text || '(Empty scene)'}
              </div>
            </div>
          )}

          <div className="rounded-xl border border-pcc-line bg-pcc-surface p-3.5 space-y-2 dark:border-pcc-dark-line dark:bg-pcc-dark-surface">
            <div className="flex items-center justify-between gap-2">
              <span className="font-bold">Planned WP04 Craft Lenses</span>
              <span className="rounded bg-pcc-canvas px-1.5 py-0.5 font-mono text-[10px] text-pcc-muted dark:bg-pcc-dark-canvas">
                Roadmap WP04
              </span>
            </div>
            <p className="text-[11px] text-pcc-muted">
              Upcoming visual development overlays scheduled for WP04: Emotional Arc Overlay, Pacing &amp; Tension Curve, and Theme Threads Matrix.
            </p>
          </div>
        </aside>
      </div>
    </section>
  );
};
