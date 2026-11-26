/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useEffect, useMemo, useRef, useState } from 'react';
import type {
  BatchCommitResult,
  BatchEditProposalResult,
  DecisionItem,
  DecisionStatus,
} from '../shared/types';
import { BatchEditSection } from './workspace/inbox/BatchEditSection';
import { DecisionFilterBar, type DecisionGroupFilter } from './workspace/inbox/DecisionFilterBar';
import { DecisionListItem } from './workspace/inbox/DecisionListItem';

interface DecisionInboxPanelProps {
  decisions: DecisionItem[];
  activeProjectId?: string;
  activeRevision?: number;
  onApplyDecisions: (
    decisionIds: string[],
    action: 'accept' | 'reject' | 'defer',
    customValues?: Record<string, string>
  ) => void;
  onInspectDecisionTarget: (decision: DecisionItem) => void;
  onRefreshClarifications: (preserveDrafts?: Record<string, string>) => void;
  isClarificationsLoading: boolean;
  clarificationError: string | null;
  onPreviewBatchInstruction: (instruction: string) => Promise<BatchEditProposalResult | null>;
  onApplyBatchOperations: (preview: BatchEditProposalResult) => BatchCommitResult;
  onBatchPreviewChange?: (preview: BatchEditProposalResult | null) => void;
  onDraftValuesChange?: (drafts: Record<string, string>) => void;
  isBatchLoading: boolean;
}

const DecisionInboxPanel: React.FC<DecisionInboxPanelProps> = ({
  decisions,
  activeProjectId,
  activeRevision,
  onApplyDecisions,
  onInspectDecisionTarget,
  onRefreshClarifications,
  isClarificationsLoading,
  clarificationError,
  onPreviewBatchInstruction,
  onApplyBatchOperations,
  onBatchPreviewChange,
  onDraftValuesChange,
  isBatchLoading,
}) => {
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [draftValues, setDraftValues] = useState<Record<string, string>>({});
  const [editingCustomId, setEditingCustomId] = useState<string | null>(null);

  const [searchQuery, setSearchQuery] = useState('');
  const [groupFilter, setGroupFilter] = useState<DecisionGroupFilter>('all');
  const [statusFilter, setStatusFilter] = useState<'pending' | 'all' | DecisionStatus>('pending');

  const [batchInstruction, setBatchInstruction] = useState('');
  const [batchPreview, setBatchPreview] = useState<BatchEditProposalResult | null>(null);
  const [batchError, setBatchError] = useState<string | null>(null);
  const [lastFailedReason, setLastFailedReason] = useState<
    Extract<BatchCommitResult, { ok: false }>['reason'] | null
  >(null);
  const [acknowledgeUnhandledClauses, setAcknowledgeUnhandledClauses] = useState(false);

  const batchRunEpochRef = useRef(0);
  const mountedRef = useRef(true);
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      batchRunEpochRef.current += 1;
    };
  }, []);

  useEffect(() => {
    onBatchPreviewChange?.(batchPreview);
  }, [batchPreview, onBatchPreviewChange]);

  useEffect(() => {
    onDraftValuesChange?.(draftValues);
  }, [draftValues, onDraftValuesChange]);

  const isPreviewStale = Boolean(
    batchPreview &&
      ((activeProjectId &&
        batchPreview.baseProjectId &&
        batchPreview.baseProjectId !== activeProjectId) ||
        (activeRevision !== undefined &&
          batchPreview.baseRevision !== undefined &&
          batchPreview.baseRevision !== activeRevision))
  );

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

  const runBatchPreviewForText = async (instructionText: string) => {
    const trimmed = instructionText.trim();
    if (!trimmed) return;
    const epoch = ++batchRunEpochRef.current;
    setBatchError(null);
    setLastFailedReason(null);
    setAcknowledgeUnhandledClauses(false);
    try {
      const result = await onPreviewBatchInstruction(trimmed);
      if (!mountedRef.current || epoch !== batchRunEpochRef.current) return;
      if (result) setBatchPreview(result);
    } catch (err) {
      if (mountedRef.current && epoch === batchRunEpochRef.current) {
        setBatchError(err instanceof Error ? err.message : 'Failed to interpret batch instruction.');
      }
    }
  };

  const dismissBatchPreview = () => {
    batchRunEpochRef.current += 1;
    setBatchPreview(null);
    setBatchError(null);
    setLastFailedReason(null);
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
    if (!batchPreview.operations.some((o) => o.selected)) return;
    if ((batchPreview.unhandledClauses?.length ?? 0) > 0 && !acknowledgeUnhandledClauses) {
      setBatchError('Please acknowledge the unhandled instruction clauses before applying the partial batch.');
      return;
    }
    const result = onApplyBatchOperations(batchPreview);
    if (!result.ok) {
      setBatchError(result.message ?? 'Batch could not be applied.');
      setLastFailedReason(result.reason ?? null);
      return;
    }
    setBatchError(null);
    setLastFailedReason(null);
    setBatchPreview(null);
    setBatchInstruction('');
    setAcknowledgeUnhandledClauses(false);
  };

  return (
    <section
      aria-label="Creative Decisions and Batch Editor"
      className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-lg flex flex-col h-full min-h-0 overflow-hidden"
    >
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

      <BatchEditSection
        batchInstruction={batchInstruction}
        setBatchInstruction={setBatchInstruction}
        batchPreview={batchPreview}
        setBatchPreview={setBatchPreview}
        batchError={batchError}
        setBatchError={setBatchError}
        lastFailedReason={lastFailedReason}
        setLastFailedReason={setLastFailedReason}
        acknowledgeUnhandledClauses={acknowledgeUnhandledClauses}
        setAcknowledgeUnhandledClauses={setAcknowledgeUnhandledClauses}
        isBatchLoading={isBatchLoading}
        isPreviewStale={isPreviewStale}
        onRunBatchPreview={(e) => {
          e.preventDefault();
          void runBatchPreviewForText(batchInstruction);
        }}
        onRunBatchPreviewForText={runBatchPreviewForText}
        onDismissBatchPreview={dismissBatchPreview}
        onToggleOperationSelection={toggleOperationSelection}
        onCommitBatchOperations={handleCommitBatchOperations}
      />

      <DecisionFilterBar
        searchQuery={searchQuery}
        setSearchQuery={setSearchQuery}
        statusFilter={statusFilter}
        setStatusFilter={setStatusFilter}
        groupFilter={groupFilter}
        setGroupFilter={setGroupFilter}
        pendingCount={pendingCount}
        filteredCount={filteredDecisions.length}
        selectedCount={selectedIds.size}
        onSelectAllVisible={() => setSelectedIds(new Set(filteredDecisions.map((d) => d.id)))}
        onSelectNone={() => setSelectedIds(new Set())}
        onBatchAction={handleBatchAction}
      />

      {clarificationError && (
        <div className="px-3 py-2 bg-red-50 dark:bg-red-950/40 border-b border-red-200 dark:border-red-900 text-xs text-red-700 dark:text-red-300">
          {clarificationError}
        </div>
      )}

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
          filteredDecisions.map((item) => (
            <DecisionListItem
              key={item.id}
              item={item}
              isChecked={selectedIds.has(item.id)}
              activeValue={draftValues[item.id] ?? item.proposedValue}
              isCustomOpen={editingCustomId === item.id}
              onToggleSelect={toggleSelect}
              onInspectTarget={onInspectDecisionTarget}
              onChangeDraftValue={(id, value) => setDraftValues((prev) => ({ ...prev, [id]: value }))}
              onToggleCustomOpen={setEditingCustomId}
              onSingleAction={handleSingleAction}
            />
          ))
        )}
      </div>
    </section>
  );
};

export default DecisionInboxPanel;
