/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useMemo } from 'react';
import type {
  BatchEditProposalResult,
  DecisionItem,
  DecisionStatus,
  ProposedOperation,
} from '../shared/types';

interface DecisionInboxPanelProps {
  decisions: DecisionItem[];
  onApplyDecisions: (
    decisionIds: string[],
    action: 'accept' | 'reject' | 'defer',
    customValues?: Record<string, string>
  ) => void;
  onInspectDecisionTarget: (decision: DecisionItem) => void;
  onRefreshClarifications: (preserveDrafts?: Record<string, string>) => void;
  isClarificationsLoading: boolean;
  clarificationError: string | null;
  onPreviewBatchInstruction: (instruction: string) => Promise<BatchEditProposalResult>;
  onApplyBatchOperations: (operations: ProposedOperation[], instruction: string) => void;
  isBatchLoading: boolean;
}

const DecisionInboxPanel: React.FC<DecisionInboxPanelProps> = ({
  decisions,
  onApplyDecisions,
  onInspectDecisionTarget,
  onRefreshClarifications,
  isClarificationsLoading,
  clarificationError,
  onPreviewBatchInstruction,
  onApplyBatchOperations,
  isBatchLoading,
}) => {
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [draftValues, setDraftValues] = useState<Record<string, string>>({});
  const [editingCustomId, setEditingCustomId] = useState<string | null>(null);

  const [searchQuery, setSearchQuery] = useState('');
  const [groupFilter, setGroupFilter] = useState<'all' | 'clarification' | 'character' | 'setting' | 'story' | 'relationship'>('all');
  const [statusFilter, setStatusFilter] = useState<'pending' | 'all' | DecisionStatus>('pending');

  // Natural-language batch edit state
  const [batchInstruction, setBatchInstruction] = useState('');
  const [batchPreview, setBatchPreview] = useState<BatchEditProposalResult | null>(null);
  const [batchError, setBatchError] = useState<string | null>(null);
  const [acknowledgeUnhandledClauses, setAcknowledgeUnhandledClauses] = useState(false);

  const filteredDecisions = useMemo(() => {
    return decisions.filter((item) => {
      if (statusFilter !== 'all' && item.status !== statusFilter) return false;
      if (groupFilter === 'clarification' && item.category !== 'clarification') return false;
      if (groupFilter === 'relationship' && item.category !== 'relationship') return false;
      if (groupFilter === 'character' && item.groupKey !== 'character') return false;
      if (groupFilter === 'setting' && item.groupKey !== 'setting') return false;
      if (groupFilter === 'story' && item.groupKey !== 'story' && item.groupKey !== 'plot') return false;

      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase();
        const hay = `${item.title} ${item.description} ${item.targetEntityName ?? ''} ${item.targetAttributeName ?? ''} ${item.proposedValue}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [decisions, statusFilter, groupFilter, searchQuery]);

  const pendingCount = useMemo(
    () => decisions.filter((d) => d.status === 'pending').length,
    [decisions]
  );

  const toggleSelect = (id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const selectAllVisible = () => {
    setSelectedIds(new Set(filteredDecisions.map((d) => d.id)));
  };

  const selectNone = () => {
    setSelectedIds(new Set());
  };

  const handleBatchAction = (action: 'accept' | 'reject' | 'defer') => {
    const ids = Array.from(selectedIds).filter((id) =>
      filteredDecisions.some((d) => d.id === id)
    );
    if (ids.length === 0) return;
    onApplyDecisions(ids, action, draftValues);
    setSelectedIds(new Set());
  };

  const handleSingleAction = (id: string, action: 'accept' | 'reject' | 'defer', overrideValue?: string) => {
    const values = overrideValue !== undefined ? { ...draftValues, [id]: overrideValue } : draftValues;
    onApplyDecisions([id], action, values);
    setSelectedIds((prev) => {
      const next = new Set(prev);
      next.delete(id);
      return next;
    });
  };

  const handleRunBatchPreview = async (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = batchInstruction.trim();
    if (!trimmed) return;
    setBatchError(null);
    setAcknowledgeUnhandledClauses(false);
    try {
      const result = await onPreviewBatchInstruction(trimmed);
      setBatchPreview(result);
    } catch (err) {
      setBatchError(err instanceof Error ? err.message : 'Failed to interpret batch instruction.');
    }
  };

  const toggleOperationSelection = (opId: string) => {
    if (!batchPreview) return;
    setBatchPreview({
      ...batchPreview,
      operations: batchPreview.operations.map((op) =>
        op.id === opId ? { ...op, selected: !op.selected } : op
      ),
    });
  };

  const handleCommitBatchOperations = () => {
    if (!batchPreview) return;
    const selectedOps = batchPreview.operations.filter((o) => o.selected);
    if (selectedOps.length === 0) return;
    const hasUnhandled = (batchPreview.unhandledClauses?.length ?? 0) > 0;
    if (hasUnhandled && !acknowledgeUnhandledClauses) {
      setBatchError(
        'Please acknowledge the unhandled instruction clauses before applying the partial batch.'
      );
      return;
    }
    onApplyBatchOperations(batchPreview.operations, batchPreview.instruction);
    setBatchPreview(null);
    setBatchInstruction('');
    setAcknowledgeUnhandledClauses(false);
  };

  return (
    <section
      aria-label="Creative Decisions and Batch Editor"
      className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-lg flex flex-col h-full min-h-0 overflow-hidden"
    >
      {/* Panel Header */}
      <div className="px-4 py-3 border-b border-gray-200 dark:border-gray-800 flex items-center justify-between gap-2 flex-shrink-0">
        <div>
          <h2 className="font-display text-sm font-bold text-gray-900 dark:text-gray-100">
            Decision Inbox
          </h2>
          <p className="text-xs text-gray-500 dark:text-gray-400 tabular-nums">
            {pendingCount} pending · {decisions.filter((d) => d.status === 'accepted').length} confirmed
          </p>
        </div>

        <button
          type="button"
          onClick={() => onRefreshClarifications(draftValues)}
          disabled={isClarificationsLoading}
          className="px-3 py-1.5 min-h-[36px] text-xs font-semibold rounded-md bg-gray-100 hover:bg-gray-200 dark:bg-gray-800 dark:hover:bg-gray-700 text-gray-800 dark:text-gray-200 border border-gray-200 dark:border-gray-700 transition-colors whitespace-nowrap shrink-0 disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
        >
          {isClarificationsLoading ? 'Asking AI...' : 'More Questions'}
        </button>
      </div>

      {/* Natural-Language Batch Editing Section */}
      <div className="p-3 border-b border-gray-200 dark:border-gray-800 bg-gray-50/60 dark:bg-gray-950/50 flex-shrink-0">
        <form onSubmit={handleRunBatchPreview} className="flex flex-col gap-2">
          <div className="flex items-center justify-between">
            <label
              htmlFor="nl-batch-input"
              className="text-xs font-semibold text-gray-800 dark:text-gray-200"
            >
              Natural-Language Batch Edit
            </label>
            <button
              type="button"
              onClick={() =>
                setBatchInstruction(
                  'Make all the animal guests elderly, but keep the cat young. The party should be mysterious rather than cheerful.'
                )
              }
              className="text-[11px] text-blue-600 dark:text-blue-400 hover:underline whitespace-nowrap"
            >
              Try sample batch
            </button>
          </div>
          <div className="flex gap-1.5">
            <input
              id="nl-batch-input"
              type="text"
              value={batchInstruction}
              onChange={(e) => setBatchInstruction(e.target.value)}
              placeholder="e.g. Make all animal guests elderly, keep the cat young..."
              className="flex-1 min-w-0 text-xs bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-700 rounded-md px-2.5 py-2 text-gray-900 dark:text-gray-100 placeholder:text-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
            <button
              type="submit"
              disabled={isBatchLoading || !batchInstruction.trim()}
              className="px-3 py-2 min-h-[36px] text-xs font-semibold bg-blue-600 hover:bg-blue-700 disabled:bg-gray-300 dark:disabled:bg-gray-800 text-white rounded-md transition-colors whitespace-nowrap shrink-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
            >
              {isBatchLoading ? 'Parsing...' : 'Preview'}
            </button>
          </div>
        </form>

        {batchError && (
          <p className="mt-2 text-xs text-red-600 dark:text-red-400" role="alert">
            {batchError}
          </p>
        )}

        {/* Staged Natural-Language Batch Preview */}
        {batchPreview && (
          <div
            role="region"
            aria-label="Batch edit preview"
            className="mt-2.5 p-3 rounded-md bg-white dark:bg-gray-900 border border-blue-300 dark:border-blue-800 space-y-2.5"
          >
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold text-gray-900 dark:text-gray-100">
                Proposed Batch Operations ({batchPreview.operations.filter((o) => o.selected).length}/
                {batchPreview.operations.length})
              </span>
              <button
                type="button"
                onClick={() => setBatchPreview(null)}
                className="text-xs text-gray-500 hover:text-gray-800 dark:hover:text-gray-200"
              >
                Dismiss
              </button>
            </div>

            {batchPreview.ambiguities.length > 0 && (
              <div className="p-2.5 rounded bg-amber-50 dark:bg-amber-950/60 border border-amber-300 dark:border-amber-800 text-xs text-amber-900 dark:text-amber-200 space-y-1">
                <p className="font-semibold">Clarification Needed for Ambiguous Reference:</p>
                {batchPreview.ambiguities.map((amb, idx) => (
                  <div key={idx}>
                    <p>{amb.clarifyingQuestion}</p>
                    <div className="flex flex-wrap gap-1.5 mt-1.5">
                      {amb.candidates.map((cand) => (
                        <button
                          key={cand}
                          type="button"
                          onClick={() => {
                            const resolvedText = batchInstruction.replace(
                              /\b(him|her|them|his|hers)\b/i,
                              `the ${cand}`
                            );
                            setBatchInstruction(resolvedText);
                            void onPreviewBatchInstruction(resolvedText).then(setBatchPreview);
                          }}
                          className="px-2 py-1 text-[11px] font-medium bg-white dark:bg-gray-800 border border-amber-400 dark:border-amber-700 rounded hover:bg-amber-100 dark:hover:bg-gray-700"
                        >
                          Apply to {cand}
                        </button>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            )}

            {batchPreview.unhandledClauses && batchPreview.unhandledClauses.length > 0 && (
              <div
                role="alert"
                className="p-2.5 rounded bg-amber-50 dark:bg-amber-950/60 border border-amber-300 dark:border-amber-800 text-xs text-amber-900 dark:text-amber-200 space-y-1.5"
              >
                <p className="font-semibold">
                  Unhandled Instruction Clause ({batchPreview.unhandledClauses.length}):
                </p>
                <ul className="list-disc pl-4 space-y-0.5">
                  {batchPreview.unhandledClauses.map((clause, idx) => (
                    <li key={idx}>&ldquo;{clause}&rdquo;</li>
                  ))}
                </ul>
                {batchPreview.operations.length > 0 && (
                  <label className="flex items-center gap-2 pt-1 font-medium cursor-pointer">
                    <input
                      type="checkbox"
                      checked={acknowledgeUnhandledClauses}
                      onChange={(e) => setAcknowledgeUnhandledClauses(e.target.checked)}
                      className="rounded border-amber-400 text-amber-600 focus:ring-amber-500"
                    />
                    <span>Apply parsed operations only and skip unhandled clauses</span>
                  </label>
                )}
              </div>
            )}

            {batchPreview.warnings.length > 0 && (
              <div className="p-2 rounded bg-red-50 dark:bg-red-950/50 border border-red-200 dark:border-red-800 text-xs text-red-700 dark:text-red-300">
                {batchPreview.warnings.map((w, i) => (
                  <p key={i}>{w}</p>
                ))}
              </div>
            )}

            {batchPreview.operations.length > 0 ? (
              <div className="space-y-1.5 max-h-44 overflow-y-auto pr-1">
                {batchPreview.operations.map((op) => (
                  <label
                    key={op.id}
                    className="flex items-start gap-2 text-xs p-1.5 rounded hover:bg-gray-50 dark:hover:bg-gray-800 cursor-pointer"
                  >
                    <input
                      type="checkbox"
                      checked={op.selected}
                      onChange={() => toggleOperationSelection(op.id)}
                      className="mt-0.5 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                    />
                    <div className="flex-1 min-w-0">
                      <span className="font-medium text-gray-900 dark:text-gray-100 block">
                        {op.summary}
                      </span>
                      {op.destructive && (
                        <span className="text-[11px] text-red-600 dark:text-red-400">
                          Destructive operation — requires confirmation
                        </span>
                      )}
                    </div>
                  </label>
                ))}
              </div>
            ) : (
              batchPreview.ambiguities.length === 0 && (
                <p className="text-xs text-gray-500">
                  No structured operations matched. Try naming an entity, group (&ldquo;all animal guests&rdquo;), or story setting.
                </p>
              )
            )}

            {batchPreview.operations.length > 0 && (
              <div className="flex justify-end gap-2 pt-1">
                <button
                  type="button"
                  onClick={() => setBatchPreview(null)}
                  className="px-2.5 py-1.5 text-xs font-medium text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-800 rounded"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={handleCommitBatchOperations}
                  disabled={
                    batchPreview.operations.every((o) => !o.selected) ||
                    ((batchPreview.unhandledClauses?.length ?? 0) > 0 && !acknowledgeUnhandledClauses)
                  }
                  className="px-3 py-1.5 text-xs font-semibold bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 text-white rounded transition-colors"
                >
                  Apply Approved Batch ({batchPreview.operations.filter((o) => o.selected).length})
                </button>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Filters & Search */}
      <div className="p-3 border-b border-gray-200 dark:border-gray-800 space-y-2 flex-shrink-0">
        <div className="flex gap-2">
          <input
            type="search"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search decisions, characters, traits..."
            aria-label="Search decisions"
            className="flex-1 min-w-0 text-xs bg-gray-50 dark:bg-gray-800 border border-gray-300 dark:border-gray-700 rounded-md px-2.5 py-1.5 text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
          <select
            aria-label="Filter decisions by status"
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value as typeof statusFilter)}
            className="text-xs bg-gray-50 dark:bg-gray-800 border border-gray-300 dark:border-gray-700 rounded-md px-2 py-1.5 text-gray-800 dark:text-gray-200 focus:outline-none focus:ring-2 focus:ring-blue-500"
          >
            <option value="pending">Pending ({pendingCount})</option>
            <option value="deferred">Deferred</option>
            <option value="accepted">Confirmed</option>
            <option value="rejected">Rejected</option>
            <option value="all">All Statuses</option>
          </select>
        </div>

        {/* Category segmented filter buttons */}
        <div
          role="group"
          aria-label="Filter decisions by category"
          className="flex items-center gap-1 p-1 bg-gray-100 dark:bg-gray-800 rounded-md overflow-x-auto"
        >
          {(
            [
              ['all', 'All'],
              ['clarification', 'Questions'],
              ['character', 'Characters'],
              ['relationship', 'Relations'],
              ['setting', 'Setting'],
              ['story', 'Story'],
            ] as const
          ).map(([key, label]) => (
            <button
              key={key}
              type="button"
              onClick={() => setGroupFilter(key)}
              className={`flex-1 px-2 py-1 text-xs font-medium rounded transition-colors whitespace-nowrap shrink-0 ${
                groupFilter === key
                  ? 'bg-white dark:bg-gray-900 text-gray-900 dark:text-gray-100 shadow-xs'
                  : 'text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white'
              }`}
            >
              {label}
            </button>
          ))}
        </div>

        {/* Batch Selection Controls */}
        {filteredDecisions.length > 0 && (
          <div className="flex flex-wrap items-center justify-between gap-2 pt-1 text-xs">
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={selectAllVisible}
                className="text-blue-600 dark:text-blue-400 hover:underline font-medium whitespace-nowrap"
              >
                Select All ({filteredDecisions.length})
              </button>
              <span aria-hidden="true" className="text-gray-300 dark:text-gray-700">
                ·
              </span>
              <button
                type="button"
                onClick={selectNone}
                className="text-gray-500 dark:text-gray-400 hover:underline whitespace-nowrap"
              >
                Select None
              </button>
            </div>

            {selectedIds.size > 0 && (
              <div className="flex items-center gap-1.5">
                <button
                  type="button"
                  onClick={() => handleBatchAction('accept')}
                  className="px-2.5 py-1 bg-blue-600 hover:bg-blue-700 text-white font-semibold rounded transition-colors whitespace-nowrap tabular-nums"
                >
                  Accept Selected ({selectedIds.size})
                </button>
                <button
                  type="button"
                  onClick={() => handleBatchAction('defer')}
                  className="px-2 py-1 bg-gray-100 hover:bg-gray-200 dark:bg-gray-800 dark:hover:bg-gray-700 text-gray-700 dark:text-gray-300 font-medium rounded transition-colors whitespace-nowrap"
                >
                  Defer
                </button>
                <button
                  type="button"
                  onClick={() => handleBatchAction('reject')}
                  className="px-2 py-1 bg-gray-100 hover:bg-gray-200 dark:bg-gray-800 dark:hover:bg-gray-700 text-red-600 dark:text-red-400 font-medium rounded transition-colors whitespace-nowrap"
                >
                  Reject
                </button>
              </div>
            )}
          </div>
        )}
      </div>

      {clarificationError && (
        <div className="px-3 py-2 bg-red-50 dark:bg-red-950/40 border-b border-red-200 dark:border-red-900 text-xs text-red-700 dark:text-red-300">
          {clarificationError}
        </div>
      )}

      {/* Decision List */}
      <div className="flex-1 overflow-y-auto divide-y divide-gray-200 dark:divide-gray-800 min-h-0">
        {filteredDecisions.length === 0 ? (
          <div className="p-8 text-center text-gray-500 dark:text-gray-400 space-y-2">
            <p className="text-sm font-medium text-gray-700 dark:text-gray-300">
              {statusFilter === 'pending'
                ? 'All visible creative decisions are resolved.'
                : 'No decisions match your current filter.'}
            </p>
            <p className="text-xs">
              Click &ldquo;More Questions&rdquo; to explore additional story angles or switch the status filter above.
            </p>
          </div>
        ) : (
          filteredDecisions.map((item) => {
            const isChecked = selectedIds.has(item.id);
            const activeValue = draftValues[item.id] ?? item.proposedValue;
            const isCustomOpen = editingCustomId === item.id;

            return (
              <div
                key={item.id}
                className={`p-3.5 transition-colors ${
                  isChecked
                    ? 'bg-blue-50/40 dark:bg-blue-950/20'
                    : 'hover:bg-gray-50/60 dark:hover:bg-gray-800/40'
                }`}
              >
                {/* Unboxed metadata kicker with middle-dot separators */}
                <div className="flex items-center justify-between gap-2 text-[11px] text-gray-500 dark:text-gray-400 mb-1">
                  <div className="flex items-center gap-1.5 truncate">
                    <input
                      type="checkbox"
                      checked={isChecked}
                      onChange={() => toggleSelect(item.id)}
                      aria-label={`Select decision: ${item.title}`}
                      className="rounded border-gray-300 text-blue-600 focus:ring-blue-500 mr-1"
                    />
                    <span className="capitalize">{item.category.replace('-', ' ')}</span>
                    <span aria-hidden="true">·</span>
                    <span className="capitalize">{item.status}</span>
                    {item.targetEntityName && (
                      <>
                        <span aria-hidden="true">·</span>
                        <button
                          type="button"
                          onClick={() => onInspectDecisionTarget(item)}
                          className="text-blue-600 dark:text-blue-400 hover:underline truncate"
                        >
                          {item.targetEntityName}
                        </button>
                      </>
                    )}
                  </div>
                </div>

                {/* Primary Title */}
                <h3 className="text-xs sm:text-sm font-semibold text-gray-900 dark:text-gray-100 mb-1 leading-snug">
                  {item.title}
                </h3>

                <p className="text-xs text-gray-600 dark:text-gray-400 mb-2.5">
                  {item.description}
                </p>

                {/* Option choices */}
                {item.options && item.options.length > 0 && (
                  <div
                    role="group"
                    aria-label={`Options for ${item.title}`}
                    className="flex flex-wrap gap-1.5 mb-2.5"
                  >
                    {item.options.map((opt) => {
                      const isSelectedOpt = activeValue === opt;
                      return (
                        <button
                          key={opt}
                          type="button"
                          onClick={() =>
                            setDraftValues((prev) => ({ ...prev, [item.id]: opt }))
                          }
                          aria-pressed={isSelectedOpt}
                          className={`px-2.5 py-1 text-xs rounded border transition-colors ${
                            isSelectedOpt
                              ? 'bg-blue-50 dark:bg-blue-900/50 border-blue-500 text-blue-800 dark:text-blue-100 font-semibold'
                              : 'bg-white dark:bg-gray-800 border-gray-300 dark:border-gray-700 text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700'
                          }`}
                        >
                          {opt}
                        </button>
                      );
                    })}
                    <button
                      type="button"
                      onClick={() =>
                        setEditingCustomId(isCustomOpen ? null : item.id)
                      }
                      className="px-2 py-1 text-xs rounded border border-dashed border-gray-300 dark:border-gray-700 text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white"
                    >
                      Custom...
                    </button>
                  </div>
                )}

                {isCustomOpen && (
                  <div className="mb-2.5 flex gap-1.5">
                    <input
                      type="text"
                      value={activeValue}
                      onChange={(e) =>
                        setDraftValues((prev) => ({ ...prev, [item.id]: e.target.value }))
                      }
                      placeholder="Enter custom value..."
                      aria-label={`Custom value for ${item.title}`}
                      className="flex-1 text-xs bg-white dark:bg-gray-800 border border-blue-500 rounded px-2.5 py-1.5 text-gray-900 dark:text-gray-100 focus:outline-none"
                    />
                    <button
                      type="button"
                      onClick={() => {
                        setEditingCustomId(null);
                        handleSingleAction(item.id, 'accept', activeValue);
                      }}
                      className="px-2.5 py-1.5 text-xs font-semibold bg-blue-600 text-white rounded"
                    >
                      Save &amp; Accept
                    </button>
                  </div>
                )}

                {/* Individual Action Row */}
                <div className="flex items-center justify-between gap-2 pt-1">
                  <div className="flex items-center gap-1.5">
                    <button
                      type="button"
                      onClick={() => handleSingleAction(item.id, 'accept', activeValue)}
                      className="px-2.5 py-1 text-xs font-semibold bg-blue-600 hover:bg-blue-700 text-white rounded transition-colors whitespace-nowrap"
                    >
                      Accept
                    </button>
                    <button
                      type="button"
                      onClick={() => handleSingleAction(item.id, 'defer')}
                      className="px-2 py-1 text-xs font-medium text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-800 rounded transition-colors whitespace-nowrap"
                    >
                      Defer
                    </button>
                    <button
                      type="button"
                      onClick={() => handleSingleAction(item.id, 'reject')}
                      className="px-2 py-1 text-xs font-medium text-gray-500 hover:text-red-600 dark:text-gray-400 dark:hover:text-red-400 rounded transition-colors whitespace-nowrap"
                    >
                      Reject
                    </button>
                  </div>

                  {(item.targetEntityName || item.targetStoryField || item.targetRelationshipId) && (
                    <button
                      type="button"
                      onClick={() => onInspectDecisionTarget(item)}
                      className="text-xs text-gray-500 dark:text-gray-400 hover:text-blue-600 dark:hover:text-blue-400 whitespace-nowrap"
                    >
                      Inspect &rarr;
                    </button>
                  )}
                </div>
              </div>
            );
          })
        )}
      </div>
    </section>
  );
};

export default DecisionInboxPanel;
