import React, { useMemo, useState } from 'react';
import { CreativeProject } from '../../shared/types';
import {
  CreativeLock,
  CreativeLockHardness,
  CreativeLockTargetKind,
  UnifiedProposal,
} from '../../shared/unifiedProposalTypes';
import {
  buildVisualChangeMap,
  ChangeMapDiffState,
} from '../../lib/narrative/proposals/changeMapProjector';
import {
  createCreativeLockRecord,
  listProjectCreativeLocks,
} from '../../lib/narrative/proposals/creativeLocks';
import {
  compileUnifiedProposalPreview,
  createUnifiedProposalEnvelope,
  updateUnifiedProposalSelectionOrEdits,
} from '../../lib/narrative/proposals/unifiedProposalEngine';
import { manuscriptSections } from '../../lib/narrative/manuscriptModel';

interface UnifiedProposalReviewModalProps {
  isOpen: boolean;
  onClose: () => void;
  project: CreativeProject;
  proposal: UnifiedProposal | null;
  lastUndoProposal?: UnifiedProposal | null;
  onApplyProposal: (proposal: UnifiedProposal) => Promise<{ ok: boolean; message?: string }>;
  onSaveProposalDraft?: (proposal: UnifiedProposal) => void;
  onSaveLocks?: (locks: CreativeLock[]) => void;
  initialTab?: 'diff' | 'changemap' | 'locks';
}

function diffStateColor(state: ChangeMapDiffState): {
  stroke: string;
  fill: string;
  badge: string;
} {
  if (state === 'added') {
    return {
      stroke: '#34d399',
      fill: '#064e3b',
      badge: 'bg-emerald-950/80 text-emerald-300 border-emerald-500/40',
    };
  }
  if (state === 'modified') {
    return {
      stroke: '#fbbf24',
      fill: '#78350f',
      badge: 'bg-amber-950/80 text-amber-300 border-amber-500/40',
    };
  }
  if (state === 'removed') {
    return {
      stroke: '#f87171',
      fill: '#7f1d1d',
      badge: 'bg-rose-950/80 text-rose-300 border-rose-500/40',
    };
  }
  return {
    stroke: '#64748b',
    fill: '#1e293b',
    badge: 'bg-slate-800 text-slate-300 border-slate-700',
  };
}

export const UnifiedProposalReviewModal: React.FC<UnifiedProposalReviewModalProps> = ({
  isOpen,
  onClose,
  project,
  proposal,
  lastUndoProposal,
  onApplyProposal,
  onSaveProposalDraft,
  onSaveLocks,
  initialTab = 'diff',
}) => {
  const [workingProposal, setWorkingProposal] = useState<UnifiedProposal | null>(proposal);
  const [prevProposal, setPrevProposal] = useState<UnifiedProposal | null>(proposal);
  const [activeTab, setActiveTab] = useState<'diff' | 'changemap' | 'locks'>(initialTab);
  const [prevOpenTabKey, setPrevOpenTabKey] = useState<string>(`${isOpen}:${initialTab}`);
  const [editingHunkId, setEditingHunkId] = useState<string | null>(null);
  const [editingModelOpId, setEditingModelOpId] = useState<string | null>(null);
  const [applying, setApplying] = useState(false);
  const [feedback, setFeedback] = useState<{ type: 'ok' | 'err'; text: string } | null>(null);

  // Creative Lock creation form state (`+ Add lock`)
  const [newLockHardness, setNewLockHardness] = useState<CreativeLockHardness>('hard-structural');
  const [newLockTargetKind, setNewLockTargetKind] = useState<CreativeLockTargetKind>('entity');
  const [newLockTargetLabel, setNewLockTargetLabel] = useState('');
  const [newLockAttributeKey, setNewLockAttributeKey] = useState('');
  const [newLockExpectedValue, setNewLockExpectedValue] = useState('');
  const [newLockRuleText, setNewLockRuleText] = useState('');

  if (proposal !== prevProposal) {
    const transitionedToApplied = Boolean(
      proposal &&
        prevProposal &&
        proposal.id === prevProposal.id &&
        proposal.status === 'applied'
    );
    setPrevProposal(proposal);
    setWorkingProposal(proposal);
    if (!transitionedToApplied) {
      setFeedback(null);
    }
    setEditingHunkId(null);
    setEditingModelOpId(null);
  }

  const openTabKey = `${isOpen}:${initialTab}`;
  if (openTabKey !== prevOpenTabKey) {
    setPrevOpenTabKey(openTabKey);
    if (isOpen) {
      setActiveTab(initialTab);
    }
  }

  const activeLocks = useMemo(() => listProjectCreativeLocks(project), [project]);

  const compiledPreview = useMemo(() => {
    if (!workingProposal) return null;
    return compileUnifiedProposalPreview(project, workingProposal);
  }, [project, workingProposal]);

  const changeMap = useMemo(() => {
    if (!workingProposal || !compiledPreview) return null;
    return buildVisualChangeMap(project, workingProposal, compiledPreview);
  }, [project, workingProposal, compiledPreview]);

  if (!isOpen) return null;

  const selectedSet = new Set(workingProposal?.selectedIds ?? []);

  const handleToggleItemSelection = (itemId: string) => {
    if (!workingProposal) return;
    const nextSelected = new Set(workingProposal.selectedIds);
    if (nextSelected.has(itemId)) {
      nextSelected.delete(itemId);
    } else {
      nextSelected.add(itemId);
    }
    const updated = updateUnifiedProposalSelectionOrEdits(workingProposal, {
      selectedIds: Array.from(nextSelected),
    });
    setWorkingProposal(updated);
    onSaveProposalDraft?.(updated);
  };

  const handleInlineEditHunkReplacement = (hunkId: string, newReplacementText: string) => {
    if (!workingProposal) return;
    const nextHunks = workingProposal.manuscriptHunks.map((h) =>
      h.id === hunkId ? { ...h, replacementText: newReplacementText } : h
    );
    const updated = updateUnifiedProposalSelectionOrEdits(workingProposal, {
      manuscriptHunks: nextHunks,
    });
    setWorkingProposal(updated);
    onSaveProposalDraft?.(updated);
  };

  const handleInlineEditModelOpValue = (opId: string, newAfterValue: string) => {
    if (!workingProposal) return;
    const nextOps = workingProposal.modelOperations.map((op) =>
      op.id === opId ? { ...op, afterValue: newAfterValue } : op
    );
    const updated = updateUnifiedProposalSelectionOrEdits(workingProposal, {
      modelOperations: nextOps,
    });
    setWorkingProposal(updated);
    onSaveProposalDraft?.(updated);
  };

  const handleAddCreativeLock = () => {
    if (!newLockTargetLabel.trim() && !newLockRuleText.trim()) return;
    const created = createCreativeLockRecord({
      projectId: project.id,
      hardness: newLockHardness,
      targetKind: newLockTargetKind,
      targetLabel: newLockTargetLabel.trim() || 'Custom Rule',
      attributeKey: newLockAttributeKey.trim() || undefined,
      expectedValue: newLockExpectedValue.trim() || undefined,
      ruleText:
        newLockRuleText.trim() ||
        `Protect ${newLockTargetLabel.trim() || 'target'} (${newLockHardness})`,
    });
    const nextLocks = [...activeLocks, created];
    onSaveLocks?.(nextLocks);
    setNewLockTargetLabel('');
    setNewLockAttributeKey('');
    setNewLockExpectedValue('');
    setNewLockRuleText('');
    setFeedback({
      type: 'ok',
      text: `Added ${created.hardness} Creative Lock "${created.targetLabel}".`,
    });
  };

  const handleRemoveLock = (lockId: string) => {
    const nextLocks = activeLocks.filter((l) => l.id !== lockId);
    onSaveLocks?.(nextLocks);
  };

  const handleToggleLockActive = (lockId: string) => {
    const nextLocks = activeLocks.map((l) =>
      l.id === lockId ? { ...l, active: !l.active, updatedAt: Date.now() } : l
    );
    onSaveLocks?.(nextLocks);
  };

  const handleApplySelected = async (targetProposal: UnifiedProposal | null = workingProposal) => {
    if (!targetProposal) return;
    setApplying(true);
    setFeedback(null);
    try {
      const res = await onApplyProposal(targetProposal);
      if (res.ok) {
        setFeedback({
          type: 'ok',
          text: res.message || `Applied "${targetProposal.title}" durably.`,
        });
      } else {
        setFeedback({
          type: 'err',
          text: res.message || 'Proposal apply blocked by validation or conflict check.',
        });
      }
    } catch (err) {
      setFeedback({
        type: 'err',
        text: err instanceof Error ? err.message : 'Proposal apply failed.',
      });
    } finally {
      setApplying(false);
    }
  };

  const nodeMap = new Map((changeMap?.nodes ?? []).map((n) => [n.id, n]));

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/85 p-4 backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
      aria-labelledby="unified-proposal-modal-title"
      data-testid="unified-proposal-review-modal"
    >
      <div className="flex max-h-[92vh] w-full max-w-5xl flex-col overflow-hidden rounded-2xl border border-slate-700 bg-slate-900 text-slate-100 shadow-2xl">
        {/* Header */}
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-800 px-6 py-4">
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <h2 id="unified-proposal-modal-title" className="text-lg font-bold text-white">
                {workingProposal ? workingProposal.title : 'Creative Locks & Unified Proposal Engine (E3)'}
              </h2>
              {workingProposal && (
                <span className="rounded border border-indigo-500/40 bg-indigo-950/70 px-2 py-0.5 font-mono text-[11px] text-indigo-300">
                  Base r{workingProposal.baseRevision} · Patch {compiledPreview?.patchDigest.slice(0, 8)}
                </span>
              )}
              {workingProposal?.provenance?.sessionId && (
                <span
                  data-testid="e3-provenance-badge"
                  className="rounded border border-emerald-500/40 bg-emerald-950/70 px-2 py-0.5 font-mono text-[11px] text-emerald-300"
                >
                  Origin: {workingProposal.originOperation} · Session {workingProposal.provenance.sessionId.slice(0, 12)}
                </span>
              )}
            </div>
            <p className="mt-0.5 text-xs text-slate-400">
              {workingProposal
                ? workingProposal.rationale
                : 'Manage Hard Structural Locks and Soft Advisory Constraints, or undo the last applied proposal.'}
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              data-testid="e3-stage-sample-proposal-btn"
              disabled={applying}
              onClick={() => {
                const sections = manuscriptSections(project);
                const firstSec = sections[0];
                const hunks = firstSec
                  ? [
                      {
                        id: 'sample-hunk-1',
                        sectionId: firstSec.id,
                        sectionTitle: firstSec.title || 'Opening Scene',
                        operation: 'insert' as const,
                        startOffset: firstSec.text.length,
                        endOffset: firstSec.text.length,
                        expectedText: '',
                        replacementText:
                          '\n\n[Draft Continuity Note: The brass astrolabe hummed softly against the stone archive table.]',
                        rationale: 'Add sensory continuity detail anchored to the current scene end.',
                        dependencyIds: [],
                      },
                    ]
                  : [];
                const firstEntity = project.snapshot.entities[0];
                const modelOps = firstEntity
                  ? [
                      {
                        id: 'sample-op-1',
                        targetType: 'attribute' as const,
                        action: 'update' as const,
                        targetId: firstEntity.id ?? firstEntity.name,
                        targetLabel: firstEntity.name,
                        field: 'Current Focus',
                        beforeValue:
                          firstEntity.attributes.find((a) => a.name === 'Current Focus')?.confirmedValue ?? '(unset)',
                        afterValue: 'Investigating the archive resonance',
                        rationale: 'Align character focus attribute with scene continuity.',
                        dependencyIds: [],
                      },
                    ]
                  : [];
                const sample = createUnifiedProposalEnvelope({
                  project,
                  originOperation: 'manual',
                  title: 'Sample Unified Continuity Proposal',
                  rationale:
                    'Demonstrates coordinated manuscript hunk and Story World model attribute update in a single atomic transaction.',
                  manuscriptHunks: hunks,
                  modelOperations: modelOps,
                });
                setWorkingProposal(sample);
                onSaveProposalDraft?.(sample);
                setActiveTab('diff');
                setFeedback(null);
              }}
              className="rounded-lg border border-indigo-500/40 bg-indigo-950/60 px-3 py-1.5 text-xs font-semibold text-indigo-200 hover:bg-indigo-900/60 disabled:opacity-50"
            >
              Stage Sample Proposal
            </button>
            {lastUndoProposal && (
              <button
                type="button"
                data-testid="e3-undo-last-proposal-btn"
                disabled={applying}
                onClick={() => void handleApplySelected(lastUndoProposal)}
                className="rounded-lg border border-amber-500/40 bg-amber-950/50 px-3 py-1.5 text-xs font-semibold text-amber-200 hover:bg-amber-900/60 disabled:opacity-50"
              >
                Undo Last Applied Proposal
              </button>
            )}
            <button
              type="button"
              data-testid="close-unified-proposal-modal-btn"
              onClick={onClose}
              className="rounded-lg border border-slate-700 px-3 py-1.5 text-xs text-slate-300 hover:bg-slate-800"
            >
              Close
            </button>
          </div>
        </div>

        {/* Navigation Tabs */}
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-800 bg-slate-950/60 px-6 py-2.5 text-xs">
          <div className="flex items-center gap-2">
            {workingProposal && (
              <>
                <button
                  type="button"
                  data-testid="e3-tab-diff"
                  onClick={() => setActiveTab('diff')}
                  className={`rounded-lg px-3 py-1.5 font-semibold ${
                    activeTab === 'diff'
                      ? 'bg-indigo-600 text-white'
                      : 'bg-slate-800 text-slate-300 hover:bg-slate-700'
                  }`}
                >
                  Exact Before / After Diff ({compiledPreview?.selectedHunkCount ?? 0} Hunks,{' '}
                  {compiledPreview?.selectedModelOpCount ?? 0} Model Ops)
                </button>
                <button
                  type="button"
                  data-testid="e3-tab-changemap"
                  onClick={() => setActiveTab('changemap')}
                  className={`rounded-lg px-3 py-1.5 font-semibold ${
                    activeTab === 'changemap'
                      ? 'bg-indigo-600 text-white'
                      : 'bg-slate-800 text-slate-300 hover:bg-slate-700'
                  }`}
                >
                  Visual Change Map (V7) ({changeMap?.nodes.length ?? 0} Nodes, {changeMap?.edges.length ?? 0} Edges)
                </button>
              </>
            )}
            <button
              type="button"
              data-testid="e3-tab-locks"
              onClick={() => setActiveTab('locks')}
              className={`rounded-lg px-3 py-1.5 font-semibold ${
                activeTab === 'locks' || !workingProposal
                  ? 'bg-amber-600 text-white'
                  : 'bg-slate-800 text-slate-300 hover:bg-slate-700'
              }`}
            >
              Creative Locks ({activeLocks.filter((l) => l.active).length} Active)
            </button>
          </div>

          {workingProposal?.status === 'applied' ? (
            <div className="flex items-center gap-2">
              <span
                data-testid="e3-applied-badge"
                className="rounded border border-emerald-500/40 bg-emerald-950/70 px-2.5 py-1 font-semibold text-emerald-200"
              >
                Applied Atomically
              </span>
            </div>
          ) : (
            compiledPreview && (
              <div className="flex items-center gap-2">
                {compiledPreview.hardBlockCount > 0 ? (
                  <span
                    data-testid="e3-hard-block-badge"
                    className="rounded border border-rose-500/40 bg-rose-950/70 px-2.5 py-1 font-semibold text-rose-200"
                  >
                    {compiledPreview.hardBlockCount} Hard Block(s) — Apply Disabled
                  </span>
                ) : (
                  <span
                    data-testid="e3-ready-badge"
                    className="rounded border border-emerald-500/40 bg-emerald-950/70 px-2.5 py-1 font-semibold text-emerald-200"
                  >
                    Validated &amp; Ready to Apply
                  </span>
                )}
              </div>
            )
          )}
        </div>

        {/* Feedback & Conflict Diagnostics */}
        {feedback && (
          <div
            data-testid="e3-feedback-banner"
            className={`mx-6 mt-3 rounded-lg border px-3.5 py-2 text-xs ${
              feedback.type === 'ok'
                ? 'border-emerald-500/40 bg-emerald-950/40 text-emerald-200'
                : 'border-rose-500/40 bg-rose-950/40 text-rose-200'
            }`}
          >
            {feedback.text}
          </div>
        )}

        {compiledPreview &&
          compiledPreview.diagnostics.length > 0 &&
          workingProposal?.status !== 'applied' && (
          <div
            data-testid="e3-diagnostics-list"
            className="mx-6 mt-3 space-y-1.5 rounded-xl border border-slate-800 bg-slate-950/80 p-3 text-xs"
          >
            {compiledPreview.diagnostics.map((diag) => (
              <div
                key={diag.id}
                data-testid={`e3-diagnostic-${diag.code}`}
                className={`flex items-start gap-2 rounded-lg border px-3 py-2 ${
                  diag.severity === 'hard-block'
                    ? 'border-rose-500/40 bg-rose-950/40 text-rose-200'
                    : 'border-amber-500/40 bg-amber-950/30 text-amber-200'
                }`}
              >
                <span className="rounded bg-black/40 px-1.5 py-0.5 font-mono text-[10px] uppercase">
                  {diag.severity} · {diag.code}
                </span>
                <span>{diag.message}</span>
              </div>
            ))}
          </div>
        )}

        {/* Main Content Area */}
        <div className="flex-1 overflow-y-auto p-6 space-y-4">
          {/* TAB 1: EXACT BEFORE / AFTER DIFF */}
          {activeTab === 'diff' && workingProposal && (
            <div className="space-y-4">
              {/* Manuscript Hunks */}
              {workingProposal.manuscriptHunks.length > 0 && (
                <div className="space-y-3">
                  <h3 className="text-xs font-bold uppercase tracking-wider text-slate-400">
                    Manuscript Diff Hunks ({workingProposal.manuscriptHunks.length})
                  </h3>
                  {workingProposal.manuscriptHunks.map((hunk) => {
                    const isSelected = selectedSet.has(hunk.id);
                    const isEditing = editingHunkId === hunk.id;
                    return (
                      <div
                        key={hunk.id}
                        data-testid={`e3-manuscript-hunk-${hunk.id}`}
                        className={`rounded-xl border p-4 space-y-3 ${
                          isSelected
                            ? 'border-indigo-500/40 bg-slate-950/80'
                            : 'border-slate-800 bg-slate-950/40 opacity-60'
                        }`}
                      >
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <label className="inline-flex cursor-pointer items-center gap-2 text-xs font-semibold text-white">
                            <input
                              type="checkbox"
                              data-testid={`e3-select-hunk-${hunk.id}`}
                              checked={isSelected}
                              onChange={() => handleToggleItemSelection(hunk.id)}
                              className="h-4 w-4 rounded border-slate-600 bg-slate-900 text-indigo-600"
                            />
                            <span>
                              {hunk.sectionTitle} · {hunk.operation.toUpperCase()} UTF-16 [{hunk.startOffset}..
                              {hunk.endOffset}]
                            </span>
                          </label>
                          <button
                            type="button"
                            data-testid={`e3-inline-edit-hunk-btn-${hunk.id}`}
                            onClick={() => setEditingHunkId(isEditing ? null : hunk.id)}
                            className="rounded border border-slate-700 bg-slate-800 px-2.5 py-1 text-xs text-slate-200 hover:bg-slate-700"
                          >
                            {isEditing ? 'Done Editing' : 'Edit Staged Text'}
                          </button>
                        </div>

                        <p className="text-xs text-slate-400">{hunk.rationale}</p>

                        <div className="grid gap-3 sm:grid-cols-2 text-xs">
                          <div className="rounded-lg border border-rose-500/30 bg-rose-950/20 p-3">
                            <div className="text-[10px] font-semibold uppercase text-rose-300">
                              Before (Base r{workingProposal.baseRevision})
                            </div>
                            <div className="mt-1.5 font-serif text-slate-200 whitespace-pre-wrap">
                              {hunk.expectedText || '(Insertion point — empty span)'}
                            </div>
                          </div>

                          <div className="rounded-lg border border-emerald-500/30 bg-emerald-950/20 p-3">
                            <div className="text-[10px] font-semibold uppercase text-emerald-300">
                              After (Staged Replacement)
                            </div>
                            {isEditing ? (
                              <textarea
                                data-testid={`e3-hunk-textarea-${hunk.id}`}
                                value={hunk.replacementText}
                                onChange={(e) => handleInlineEditHunkReplacement(hunk.id, e.target.value)}
                                rows={4}
                                className="mt-1.5 w-full rounded border border-emerald-500/50 bg-slate-950 p-2 font-serif text-xs text-white"
                              />
                            ) : (
                              <div className="mt-1.5 font-serif text-slate-100 whitespace-pre-wrap">
                                {hunk.replacementText || '(Deleted span)'}
                              </div>
                            )}
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}

              {/* Story Model Operations */}
              {workingProposal.modelOperations.length > 0 && (
                <div className="space-y-3">
                  <h3 className="text-xs font-bold uppercase tracking-wider text-slate-400">
                    Canonical Story Model Operations ({workingProposal.modelOperations.length})
                  </h3>
                  {workingProposal.modelOperations.map((op) => {
                    const isSelected = selectedSet.has(op.id);
                    const isEditing = editingModelOpId === op.id;
                    return (
                      <div
                        key={op.id}
                        data-testid={`e3-model-op-${op.id}`}
                        className={`rounded-xl border p-4 space-y-2.5 ${
                          isSelected
                            ? 'border-indigo-500/40 bg-slate-950/80'
                            : 'border-slate-800 bg-slate-950/40 opacity-60'
                        }`}
                      >
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <label className="inline-flex cursor-pointer items-center gap-2 text-xs font-semibold text-white">
                            <input
                              type="checkbox"
                              data-testid={`e3-select-op-${op.id}`}
                              checked={isSelected}
                              onChange={() => handleToggleItemSelection(op.id)}
                              className="h-4 w-4 rounded border-slate-600 bg-slate-900 text-indigo-600"
                            />
                            <span className="rounded bg-slate-800 px-2 py-0.5 font-mono text-[10px] uppercase text-indigo-300">
                              {op.action} {op.targetType}
                            </span>
                            <span>
                              {op.targetLabel}
                              {op.field ? ` · ${op.field}` : ''}
                            </span>
                          </label>
                          <div className="flex items-center gap-2">
                            {op.dependencyIds.length > 0 && (
                              <span className="rounded border border-slate-700 bg-slate-900 px-2 py-0.5 text-[10px] text-slate-400">
                                Depends on: {op.dependencyIds.join(', ')}
                              </span>
                            )}
                            {op.action !== 'delete' && (
                              <button
                                type="button"
                                data-testid={`e3-inline-edit-op-btn-${op.id}`}
                                onClick={() => setEditingModelOpId(isEditing ? null : op.id)}
                                className="rounded border border-slate-700 bg-slate-800 px-2.5 py-1 text-xs text-slate-200 hover:bg-slate-700"
                              >
                                {isEditing ? 'Done Editing' : 'Edit Value'}
                              </button>
                            )}
                          </div>
                        </div>

                        <p className="text-xs text-slate-400">{op.rationale}</p>

                        <div className="grid gap-3 sm:grid-cols-2 text-xs">
                          <div className="rounded-lg border border-slate-800 bg-slate-900/60 p-2.5">
                            <div className="text-[10px] uppercase text-slate-500">Before Value</div>
                            <div className="mt-1 text-slate-300">{op.beforeValue || '(None)'}</div>
                          </div>
                          <div className="rounded-lg border border-emerald-500/30 bg-emerald-950/20 p-2.5">
                            <div className="text-[10px] uppercase text-emerald-300">Proposed Value</div>
                            {isEditing ? (
                              <input
                                type="text"
                                data-testid={`e3-op-input-${op.id}`}
                                value={op.afterValue ?? ''}
                                onChange={(e) => handleInlineEditModelOpValue(op.id, e.target.value)}
                                className="mt-1 w-full rounded border border-emerald-500/50 bg-slate-950 px-2 py-1 text-xs text-white"
                              />
                            ) : (
                              <div className="mt-1 font-medium text-emerald-100">
                                {op.afterValue || (op.action === 'delete' ? '(Deleted / Excluded)' : '(Empty)')}
                              </div>
                            )}
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
              {/* Speculative Creative Consequences (explicitly separate from deterministic diff/model ops) */}
              {workingProposal.speculativeImpacts && workingProposal.speculativeImpacts.length > 0 && (
                <div
                  data-testid="e3-speculative-impacts-panel"
                  className="rounded-xl border border-amber-500/35 bg-amber-950/20 p-4 space-y-2 text-xs"
                >
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className="font-bold uppercase tracking-wider text-amber-200">
                      Speculative Creative Consequences (Non-Binding · Author Review)
                    </span>
                    <span className="rounded bg-amber-900/50 px-2 py-0.5 text-[10px] text-amber-200">
                      Does not mutate canon directly
                    </span>
                  </div>
                  <ul className="space-y-1 text-amber-100/90 list-disc pl-5">
                    {workingProposal.speculativeImpacts.map((impact) => (
                      <li key={impact.id}>
                        <strong>{impact.targetLabel}</strong> ({impact.targetKind}): {impact.summary}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          )}

          {/* TAB 2: V7 VISUAL CHANGE MAP (SVG + ACCESSIBLE TABLE) */}
          {activeTab === 'changemap' && changeMap && (
            <div className="space-y-4" data-testid="v7-visual-change-map">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <h3 className="text-sm font-semibold text-white">
                    Deterministic Visual Change Map (V7)
                  </h3>
                  <p className="text-xs text-slate-400">
                    Computed strictly from <code className="text-slate-200">base + validated patch + current selection</code>. Toggle any operation in the Diff tab to watch this projection re-compile live.
                  </p>
                </div>
                <div className="flex flex-wrap items-center gap-2 text-[11px]">
                  <span className="rounded border border-emerald-500/40 bg-emerald-950/60 px-2 py-0.5 text-emerald-300">
                    +{changeMap.summaryCounts.addedNodes} Nodes / +{changeMap.summaryCounts.addedEdges} Edges
                  </span>
                  <span className="rounded border border-amber-500/40 bg-amber-950/60 px-2 py-0.5 text-amber-300">
                    ~{changeMap.summaryCounts.modifiedNodes} Nodes / ~{changeMap.summaryCounts.modifiedEdges} Edges
                  </span>
                  <span className="rounded border border-rose-500/40 bg-rose-950/60 px-2 py-0.5 text-rose-300">
                    -{changeMap.summaryCounts.removedNodes} Nodes / -{changeMap.summaryCounts.removedEdges} Edges
                  </span>
                </div>
              </div>

              {/* SVG Graph Projection */}
              <div className="overflow-x-auto rounded-xl border border-slate-800 bg-slate-950 p-4">
                <svg
                  viewBox="0 0 680 320"
                  className="mx-auto h-72 w-full max-w-[680px]"
                  role="img"
                  aria-label="Visual Change Map SVG projection of affected narrative nodes and relationships"
                  data-testid="v7-change-map-svg"
                >
                  {/* Directed Edges */}
                  {changeMap.edges.map((edge) => {
                    const src = nodeMap.get(edge.sourceNodeId);
                    const tgt = nodeMap.get(edge.targetNodeId);
                    if (!src || !tgt) return null;
                    const colors = diffStateColor(edge.diffState);
                    const midX = (src.x + tgt.x) / 2;
                    const midY = (src.y + tgt.y) / 2;
                    return (
                      <g key={edge.id}>
                        <line
                          x1={src.x}
                          y1={src.y}
                          x2={tgt.x}
                          y2={tgt.y}
                          stroke={colors.stroke}
                          strokeWidth={2.5}
                          strokeDasharray={edge.diffState === 'removed' ? '6 4' : undefined}
                        />
                        <rect
                          x={midX - 58}
                          y={midY - 11}
                          width={116}
                          height={20}
                          rx={5}
                          fill="#0f172a"
                          stroke={colors.stroke}
                          strokeWidth={1}
                        />
                        <text
                          x={midX}
                          y={midY + 3}
                          textAnchor="middle"
                          fill="#e2e8f0"
                          fontSize={10}
                        >
                          {edge.label.slice(0, 18)}
                        </text>
                      </g>
                    );
                  })}

                  {/* Nodes */}
                  {changeMap.nodes.map((node) => {
                    const colors = diffStateColor(node.diffState);
                    return (
                      <g key={node.id} transform={`translate(${node.x}, ${node.y})`}>
                        <rect
                          x={-72}
                          y={-22}
                          width={144}
                          height={44}
                          rx={10}
                          fill={colors.fill}
                          stroke={colors.stroke}
                          strokeWidth={2}
                        />
                        <text
                          x={0}
                          y={-4}
                          textAnchor="middle"
                          fill="#ffffff"
                          fontSize={11}
                          fontWeight="bold"
                        >
                          {node.label.slice(0, 18)}
                        </text>
                        <text
                          x={0}
                          y={12}
                          textAnchor="middle"
                          fill="#cbd5e1"
                          fontSize={9}
                        >
                          {node.diffState.toUpperCase()} · {node.category}
                        </text>
                      </g>
                    );
                  })}
                </svg>
              </div>

              {/* Accessible Tabular Fallback */}
              <div className="overflow-x-auto rounded-xl border border-slate-800 bg-slate-950/70">
                <table
                  data-testid="v7-change-map-table"
                  className="w-full text-left text-xs text-slate-200"
                >
                  <thead className="border-b border-slate-800 bg-slate-900/80 text-[10px] uppercase text-slate-400">
                    <tr>
                      <th className="px-3.5 py-2">Target</th>
                      <th className="px-3.5 py-2">Kind</th>
                      <th className="px-3.5 py-2">Diff State</th>
                      <th className="px-3.5 py-2">Before</th>
                      <th className="px-3.5 py-2">After</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-800/70">
                    {changeMap.nodes.map((n) => (
                      <tr key={n.id}>
                        <td className="px-3.5 py-2 font-semibold text-white">{n.label}</td>
                        <td className="px-3.5 py-2 text-slate-400">{n.category}</td>
                        <td className="px-3.5 py-2">
                          <span className={`rounded border px-2 py-0.5 text-[10px] uppercase ${diffStateColor(n.diffState).badge}`}>
                            {n.diffState}
                          </span>
                        </td>
                        <td className="px-3.5 py-2 text-slate-400">{n.beforeSummary}</td>
                        <td className="px-3.5 py-2 text-slate-200">{n.afterSummary}</td>
                      </tr>
                    ))}
                    {changeMap.edges.map((e) => (
                      <tr key={e.id}>
                        <td className="px-3.5 py-2 font-semibold text-white">
                          {e.sourceLabel} → {e.targetLabel}
                        </td>
                        <td className="px-3.5 py-2 text-slate-400">relationship</td>
                        <td className="px-3.5 py-2">
                          <span className={`rounded border px-2 py-0.5 text-[10px] uppercase ${diffStateColor(e.diffState).badge}`}>
                            {e.diffState}
                          </span>
                        </td>
                        <td className="px-3.5 py-2 text-slate-400">{e.beforeLabel || '(None)'}</td>
                        <td className="px-3.5 py-2 text-slate-200">{e.afterLabel || '(Removed)'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {changeMap.speculativeDownstreamNotes.length > 0 && (
                <div className="rounded-xl border border-amber-500/30 bg-amber-950/20 p-3.5 space-y-1.5 text-xs">
                  <div className="font-semibold text-amber-200">
                    Speculative Downstream Review Hints (Non-Binding)
                  </div>
                  {changeMap.speculativeDownstreamNotes.map((note) => (
                    <div key={note.id} className="text-amber-300/90">
                      • <strong>{note.targetLabel}:</strong> {note.reason}
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* TAB 3: CREATIVE LOCKS MANAGER (`CE-06.5/06.6`, `OD-06`, `S-01`) */}
          {(activeTab === 'locks' || !workingProposal) && (
            <div className="space-y-4" data-testid="creative-locks-manager">
              <div>
                <h3 className="text-sm font-semibold text-white">
                  Creative Locks &amp; Constraints (Hard Structural vs. Soft Advisory)
                </h3>
                <p className="text-xs text-slate-400">
                  <strong className="text-rose-300">Hard Structural Locks</strong> deterministically block any proposal hunk or model operation that deletes or alters the locked target.{' '}
                  <strong className="text-amber-300">Soft Advisory Constraints</strong> inject into AI context and show non-blocking review warnings.
                </p>
              </div>

              {/* Repeatable + Add Lock Builder */}
              <div className="rounded-xl border border-slate-800 bg-slate-950/70 p-4 space-y-3 text-xs">
                <div className="font-semibold text-slate-200">+ Add Creative Lock or Custom Rule Row</div>
                <div className="grid gap-2.5 sm:grid-cols-3">
                  <select
                    aria-label="Lock hardness"
                    data-testid="new-lock-hardness-select"
                    value={newLockHardness}
                    onChange={(e) => setNewLockHardness(e.target.value as CreativeLockHardness)}
                    className="rounded border border-slate-700 bg-slate-900 px-2.5 py-1.5 text-slate-200"
                  >
                    <option value="hard-structural">Hard Structural Lock (Blocks Apply)</option>
                    <option value="soft-advisory">Soft Advisory Constraint (Warning Only)</option>
                  </select>

                  <select
                    aria-label="Lock target kind"
                    data-testid="new-lock-kind-select"
                    value={newLockTargetKind}
                    onChange={(e) => setNewLockTargetKind(e.target.value as CreativeLockTargetKind)}
                    className="rounded border border-slate-700 bg-slate-900 px-2.5 py-1.5 text-slate-200"
                  >
                    <option value="entity">Character / Entity</option>
                    <option value="attribute">Entity Attribute</option>
                    <option value="relationship">Relationship</option>
                    <option value="story_bible">Story Bible Field</option>
                    <option value="section">Manuscript Scene / Section</option>
                    <option value="custom-rule">Custom Text Constraint Row</option>
                  </select>

                  <input
                    type="text"
                    data-testid="new-lock-target-input"
                    placeholder="Target name (e.g. Arya, tone, Scene 1)"
                    value={newLockTargetLabel}
                    onChange={(e) => setNewLockTargetLabel(e.target.value)}
                    className="rounded border border-slate-700 bg-slate-900 px-2.5 py-1.5 text-slate-200"
                  />
                </div>

                <div className="grid gap-2.5 sm:grid-cols-3">
                  <input
                    type="text"
                    data-testid="new-lock-attr-input"
                    placeholder="Attribute / Field (optional, e.g. Role)"
                    value={newLockAttributeKey}
                    onChange={(e) => setNewLockAttributeKey(e.target.value)}
                    className="rounded border border-slate-700 bg-slate-900 px-2.5 py-1.5 text-slate-200"
                  />
                  <input
                    type="text"
                    data-testid="new-lock-expected-input"
                    placeholder="Required value / phrase (optional)"
                    value={newLockExpectedValue}
                    onChange={(e) => setNewLockExpectedValue(e.target.value)}
                    className="rounded border border-slate-700 bg-slate-900 px-2.5 py-1.5 text-slate-200"
                  />
                  <input
                    type="text"
                    data-testid="new-lock-rule-input"
                    placeholder="Rule rationale (e.g. Must remain alive through Act II)"
                    value={newLockRuleText}
                    onChange={(e) => setNewLockRuleText(e.target.value)}
                    className="rounded border border-slate-700 bg-slate-900 px-2.5 py-1.5 text-slate-200"
                  />
                </div>

                <div className="flex justify-end">
                  <button
                    type="button"
                    data-testid="add-creative-lock-btn"
                    onClick={handleAddCreativeLock}
                    className="rounded-lg bg-amber-600 px-3.5 py-1.5 text-xs font-semibold text-white hover:bg-amber-500"
                  >
                    + Add Lock
                  </button>
                </div>
              </div>

              {/* Active Locks Table */}
              {activeLocks.length > 0 ? (
                <div className="space-y-2">
                  {activeLocks.map((lock) => (
                    <div
                      key={lock.id}
                      data-testid="creative-lock-row"
                      className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-slate-800 bg-slate-950/80 px-4 py-3 text-xs"
                    >
                      <div className="space-y-0.5">
                        <div className="flex flex-wrap items-center gap-2">
                          <span
                            className={`rounded px-2 py-0.5 text-[10px] font-semibold uppercase ${
                              lock.hardness === 'hard-structural'
                                ? 'bg-rose-950 text-rose-300 border border-rose-500/40'
                                : 'bg-amber-950 text-amber-300 border border-amber-500/40'
                            }`}
                          >
                            {lock.hardness}
                          </span>
                          <span className="font-semibold text-white">
                            {lock.targetLabel}
                            {lock.attributeKey ? `.${lock.attributeKey}` : ''}
                          </span>
                          {lock.expectedValue && (
                            <span className="font-mono text-[11px] text-emerald-300">
                              = &ldquo;{lock.expectedValue}&rdquo;
                            </span>
                          )}
                          <span className="text-[11px] text-slate-500">v{lock.version}</span>
                        </div>
                        <div className="text-slate-400">{lock.ruleText}</div>
                      </div>
                      <div className="flex items-center gap-2">
                        <label className="inline-flex cursor-pointer items-center gap-1.5 text-xs text-slate-300">
                          <input
                            type="checkbox"
                            checked={lock.active}
                            onChange={() => handleToggleLockActive(lock.id)}
                            className="h-3.5 w-3.5 rounded border-slate-600 bg-slate-900"
                          />
                          Active
                        </label>
                        <button
                          type="button"
                          data-testid={`remove-lock-${lock.id}`}
                          onClick={() => handleRemoveLock(lock.id)}
                          className="rounded border border-rose-500/30 px-2 py-1 text-[11px] text-rose-300 hover:bg-rose-950/40"
                        >
                          Remove
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="rounded-xl border border-slate-800 bg-slate-950/50 p-6 text-center text-xs text-slate-400">
                  No Creative Locks defined yet. Add a hard structural lock or soft advisory constraint above.
                </div>
              )}
            </div>
          )}
        </div>

        {/* Footer Commit Bar */}
        {workingProposal && (
          <div className="flex flex-wrap items-center justify-between gap-3 border-t border-slate-800 bg-slate-950 px-6 py-4 text-xs">
            <div className="text-slate-400">
              Selected:{' '}
              <strong className="text-white">
                {(compiledPreview?.selectedHunkCount ?? 0) + (compiledPreview?.selectedModelOpCount ?? 0)}
              </strong>{' '}
              operation(s) · Target Base: <strong className="text-white">r{workingProposal.baseRevision}</strong>
            </div>
            <div className="flex items-center gap-2.5">
              <button
                type="button"
                onClick={onClose}
                className="rounded-lg border border-slate-700 bg-slate-800 px-3.5 py-2 text-xs font-medium text-slate-200 hover:bg-slate-700"
              >
                Cancel
              </button>
              <button
                type="button"
                data-testid="e3-apply-selected-changes-btn"
                disabled={!compiledPreview?.canApply || applying}
                onClick={() => void handleApplySelected(workingProposal)}
                className="rounded-lg bg-emerald-600 px-4 py-2 text-xs font-bold text-white hover:bg-emerald-500 disabled:opacity-40"
              >
                {applying ? 'Committing Atomically…' : 'Apply Selected Changes (CAS)'}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
