/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useEffect, useState } from 'react';
import {
  formatOperationProgress,
  type OperationActivityRecord,
} from '../../lib/controller/useOperationActivity';

interface OperationActivityStripProps {
  operations: readonly OperationActivityRecord[];
  activeRevision: number;
  onCancelOperation?: (operationId: string) => void;
  onDismissOperation?: (operationId: string) => void;
}

const OperationActivityStrip: React.FC<OperationActivityStripProps> = ({
  operations,
  activeRevision,
  onCancelOperation,
  onDismissOperation,
}) => {
  const [nowMs, setNowMs] = useState(() => Date.now());
  const hasLiveOperation = operations.some(
    (op) =>
      op.phase === 'waiting' ||
      op.phase === 'running' ||
      op.phase === 'cancel-requested'
  );

  useEffect(() => {
    if (!hasLiveOperation) return;
    const timer = window.setInterval(() => {
      setNowMs(Date.now());
    }, 1_000);
    return () => window.clearInterval(timer);
  }, [hasLiveOperation]);

  if (operations.length === 0) return null;

  return (
    <div
      role="status"
      aria-live="polite"
      aria-label="Active operations"
      className="flex flex-wrap items-center gap-2 border-b border-pcc-line bg-pcc-canvas px-3 py-1.5 text-xs text-pcc-ink dark:border-pcc-dark-line dark:bg-pcc-dark-canvas dark:text-pcc-dark-ink sm:px-5"
    >
      {operations.map((op) => {
        const isLive =
          op.phase === 'waiting' ||
          op.phase === 'running' ||
          op.phase === 'cancel-requested';
        const progressLabel = formatOperationProgress(op, nowMs);
        const staleRevision = op.revision !== activeRevision;

        return (
          <div
            key={op.id}
            data-operation-phase={op.phase}
            className="inline-flex flex-wrap items-center gap-2 rounded-md border border-pcc-line bg-pcc-surface px-2.5 py-1 dark:border-pcc-dark-line dark:bg-pcc-dark-surface"
          >
            <span
              aria-hidden="true"
              className={`h-2 w-2 rounded-full ${
                op.phase === 'failed'
                  ? 'bg-red-500'
                  : op.phase === 'partial' || op.phase === 'cancel-requested'
                    ? 'bg-amber-500'
                    : op.phase === 'completed'
                      ? 'bg-emerald-600'
                      : 'bg-pcc-action'
              }`}
            />
            <span className="font-semibold">{op.label}</span>
            <span className="text-pcc-muted dark:text-pcc-dark-muted">
              {progressLabel}
            </span>
            {staleRevision && (
              <span className="text-amber-700 dark:text-amber-300">
                (started on r{op.revision})
              </span>
            )}
            {op.cancellable && onCancelOperation && isLive && (
              <button
                type="button"
                onClick={() => onCancelOperation(op.id)}
                className="rounded border border-pcc-line px-2 py-0.5 text-xs font-medium text-pcc-ink hover:bg-pcc-canvas focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-pcc-focus dark:border-pcc-dark-line dark:text-pcc-dark-ink dark:hover:bg-pcc-dark-canvas"
              >
                Cancel
              </button>
            )}
            {!isLive && onDismissOperation && (
              <button
                type="button"
                onClick={() => onDismissOperation(op.id)}
                className="text-pcc-muted hover:text-pcc-ink hover:underline dark:text-pcc-dark-muted dark:hover:text-pcc-dark-ink"
              >
                Dismiss
              </button>
            )}
          </div>
        );
      })}
    </div>
  );
};

export default OperationActivityStrip;
