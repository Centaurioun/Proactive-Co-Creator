/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import type { InFlightTicketsMap } from '../projectController';

export type OperationActivityPhase =
  | 'waiting'
  | 'running'
  | 'cancel-requested'
  | 'completed'
  | 'partial'
  | 'cancelled'
  | 'failed';

export interface OperationActivityRecord {
  id: string;
  label: string;
  projectId: string;
  revision: number;
  phase: OperationActivityPhase;
  startedAt: number;
  updatedAt: number;
  completedUnits?: number;
  totalUnits?: number;
  unitLabel?: string;
  detail?: string;
  cancellable: boolean;
}

export type OperationActivityAction =
  | {
      type: 'START';
      record: Omit<OperationActivityRecord, 'updatedAt'>;
    }
  | {
      type: 'UPDATE_PROGRESS';
      id: string;
      phase?: 'waiting' | 'running';
      completedUnits?: number;
      totalUnits?: number;
      unitLabel?: string;
      detail?: string;
      now: number;
    }
  | {
      type: 'REQUEST_CANCEL';
      id: string;
      now: number;
    }
  | {
      type: 'SETTLE';
      id: string;
      phase: 'completed' | 'partial' | 'cancelled' | 'failed';
      detail?: string;
      completedUnits?: number;
      totalUnits?: number;
      now: number;
    }
  | {
      type: 'DISMISS';
      id: string;
    };

export function operationActivityReducer(
  state: readonly OperationActivityRecord[],
  action: OperationActivityAction
): OperationActivityRecord[] {
  switch (action.type) {
    case 'START': {
      const next: OperationActivityRecord = {
        ...action.record,
        updatedAt: action.record.startedAt,
      };
      return [...state.filter((item) => item.id !== next.id), next];
    }
    case 'UPDATE_PROGRESS':
      return state.map((item) => {
        if (item.id !== action.id) return item;
        if (
          item.phase === 'completed' ||
          item.phase === 'partial' ||
          item.phase === 'cancelled' ||
          item.phase === 'failed'
        ) {
          return item;
        }
        return {
          ...item,
          phase: item.phase === 'cancel-requested' ? 'cancel-requested' : (action.phase ?? item.phase),
          completedUnits: action.completedUnits ?? item.completedUnits,
          totalUnits: action.totalUnits ?? item.totalUnits,
          unitLabel: action.unitLabel ?? item.unitLabel,
          detail: action.detail ?? item.detail,
          updatedAt: action.now,
        };
      });
    case 'REQUEST_CANCEL':
      return state.map((item) => {
        if (item.id !== action.id) return item;
        if (item.phase !== 'waiting' && item.phase !== 'running') return item;
        return {
          ...item,
          phase: 'cancel-requested',
          detail: 'Cancel requested — waiting for active request to settle.',
          updatedAt: action.now,
        };
      });
    case 'SETTLE':
      return state.map((item) => {
        if (item.id !== action.id) return item;
        return {
          ...item,
          phase: action.phase,
          detail: action.detail ?? item.detail,
          completedUnits: action.completedUnits ?? item.completedUnits,
          totalUnits: action.totalUnits ?? item.totalUnits,
          cancellable: false,
          updatedAt: action.now,
        };
      });
    case 'DISMISS':
      return state.filter((item) => item.id !== action.id);
    default:
      return [...state];
  }
}

/**
 * Formats truthful operation progress using ONLY measured units (when known)
 * and real elapsed wall-clock seconds. Never fabricates percentage or ETA.
 */
export function formatOperationProgress(
  record: OperationActivityRecord,
  nowMs: number
): string {
  const elapsedSec = Math.max(0, Math.floor((nowMs - record.startedAt) / 1000));
  const elapsedText = `${elapsedSec}s elapsed`;

  if (record.phase === 'cancel-requested') {
    return `Cancel requested · ${elapsedText}`;
  }
  if (record.phase === 'cancelled') {
    return record.detail || 'Cancelled';
  }
  if (record.phase === 'failed') {
    return record.detail || 'Failed';
  }
  if (record.phase === 'partial') {
    const unitPart =
      typeof record.completedUnits === 'number' &&
      typeof record.totalUnits === 'number' &&
      record.totalUnits > 0
        ? `${record.completedUnits}/${record.totalUnits} ${record.unitLabel ?? 'items'} completed · `
        : '';
    return `${unitPart}${record.detail || 'Partial results preserved'}`;
  }
  if (record.phase === 'completed') {
    return record.detail || `Completed in ${elapsedSec}s`;
  }

  const phasePrefix = record.phase === 'waiting' ? 'Waiting' : 'Running';
  if (
    typeof record.completedUnits === 'number' &&
    typeof record.totalUnits === 'number' &&
    record.totalUnits > 0
  ) {
    return `${phasePrefix} (${record.completedUnits}/${record.totalUnits} ${record.unitLabel ?? 'items'}) · ${elapsedText}`;
  }
  return `${phasePrefix} · ${elapsedText}`;
}

export function filterOperationsForProject(
  records: readonly OperationActivityRecord[],
  projectId: string
): OperationActivityRecord[] {
  return records.filter((item) => item.projectId === projectId);
}

const TICKET_ACTION_LABELS: Record<string, string> = {
  analyze: 'Analyzing story idea',
  clarify: 'Refreshing clarifications',
  batch: 'Preparing batch edit',
  generate: 'Generating output',
  polish: 'Refining prompt',
  diagnostics: 'Running semantic diagnostics',
};

/**
 * Projects active AI tickets bound to the current project into uniform
 * OperationActivityRecord items for the shared activity strip.
 */
export function deriveTicketOperationActivities(
  inFlightTickets: InFlightTicketsMap,
  activeProjectId: string,
  activeRevision: number,
  startedAtByKey: ReadonlyMap<string, number>,
  cancelRequestedKeys: ReadonlySet<string>,
  nowMs: number
): OperationActivityRecord[] {
  const results: OperationActivityRecord[] = [];
  for (const [key, ticket] of Object.entries(inFlightTickets)) {
    if (!ticket || ticket.projectId !== activeProjectId) continue;
    const label = TICKET_ACTION_LABELS[ticket.action] ?? `Running ${ticket.action}`;
    const startedAt = ticket.startedAt ?? startedAtByKey.get(key) ?? nowMs;
    const isCancelRequested = cancelRequestedKeys.has(key);
    results.push({
      id: key,
      label,
      projectId: ticket.projectId,
      revision: ticket.baseRevision ?? activeRevision,
      phase: isCancelRequested ? 'cancel-requested' : 'running',
      startedAt,
      updatedAt: nowMs,
      cancellable: !isCancelRequested,
    });
  }
  return results;
}
