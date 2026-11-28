/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import type { HydrationWriteGate } from '../../lib/projectController';
import type { CreativeProject } from '../../shared/types';
import { triggerProjectBackupDownload } from '../../lib/workspace/projectExports';

export interface StorageConflictAlert {
  type: 'conflict' | 'quota' | 'error';
  message: string;
  projectId: string;
  conflictingProject?: CreativeProject;
}

export interface StorageAlertBannerProps {
  storageAlert: StorageConflictAlert | null;
  hydrationGate: HydrationWriteGate;
  statusNotification: string | null;
  onReloadFromStorage: (prefer?: 'prefer-idb') => void;
  onForceOverwriteStorage: () => void;
  onExportBackupJson: () => void;
  onDismissStorageAlert: () => void;
  onDismissStatusNotification: () => void;
  canUndo?: boolean;
  undoLabel?: string;
  onUndo?: () => void;
}

const StorageAlertBanner: React.FC<StorageAlertBannerProps> = ({
  storageAlert,
  hydrationGate,
  statusNotification,
  onReloadFromStorage,
  onForceOverwriteStorage,
  onExportBackupJson,
  onDismissStorageAlert,
  onDismissStatusNotification,
  canUndo = false,
  undoLabel,
  onUndo,
}) => {
  const dismissStatusRef = React.useRef(onDismissStatusNotification);

  React.useEffect(() => {
    dismissStatusRef.current = onDismissStatusNotification;
  }, [onDismissStatusNotification]);

  React.useEffect(() => {
    if (!statusNotification) return;
    const timeout = window.setTimeout(() => dismissStatusRef.current(), 8_000);
    return () => window.clearTimeout(timeout);
  }, [statusNotification]);

  const visibleStorageAlert = hydrationGate === 'pending' ? null : storageAlert;

  return (
    <>
      {visibleStorageAlert && (
        <div
          role="alert"
          aria-label="Storage conflict or quota alert"
          className="bg-amber-50 dark:bg-amber-950/80 border-b border-amber-300 dark:border-amber-800 px-4 py-2.5 flex flex-wrap items-center justify-between gap-3 text-xs text-amber-950 dark:text-amber-100 flex-shrink-0 z-40"
        >
          <span className="font-medium">{visibleStorageAlert.message}</span>
          <div className="flex flex-wrap items-center gap-2">
            {visibleStorageAlert.type === 'conflict' && (
              <>
                <button
                  type="button"
                  onClick={() => onReloadFromStorage('prefer-idb')}
                  className="px-2.5 py-1 rounded font-semibold bg-amber-700 hover:bg-amber-800 text-white"
                >
                  Reload Latest from Storage
                </button>
                <button
                  type="button"
                  onClick={onForceOverwriteStorage}
                  className="px-2.5 py-1 rounded font-semibold bg-white dark:bg-gray-800 border border-amber-400 dark:border-amber-700 text-amber-900 dark:text-amber-200 hover:bg-amber-100"
                >
                  Keep My Version (Overwrite)
                </button>
              </>
            )}
            {visibleStorageAlert.type === 'error' && hydrationGate === 'blocked-read-error' && (
              <button
                type="button"
                onClick={() => onReloadFromStorage()}
                className="px-2.5 py-1 rounded font-semibold bg-amber-700 hover:bg-amber-800 text-white"
              >
                Retry Storage Read
              </button>
            )}
            <button
              type="button"
              onClick={onExportBackupJson}
              className="px-2.5 py-1 rounded font-medium bg-white dark:bg-gray-800 border border-amber-400 dark:border-amber-700 text-amber-900 dark:text-amber-200 hover:bg-amber-100"
            >
              Export Backup JSON
            </button>
            {visibleStorageAlert.conflictingProject && (
              <button
                type="button"
                onClick={() => {
                  const conflictProj = visibleStorageAlert.conflictingProject!;
                  triggerProjectBackupDownload(
                    conflictProj,
                    `r${conflictProj.revision}-stored-copy`
                  );
                }}
                className="px-2.5 py-1 rounded font-medium bg-white dark:bg-gray-800 border border-amber-400 dark:border-amber-700 text-amber-900 dark:text-amber-200 hover:bg-amber-100"
              >
                Export Stored Copy
              </button>
            )}
            <button
              type="button"
              onClick={onDismissStorageAlert}
              className="text-amber-700 dark:text-amber-300 hover:underline px-1"
            >
              Dismiss
            </button>
          </div>
        </div>
      )}

      {statusNotification && (
        <div
          className="fixed bottom-20 left-3 right-3 z-[1850] pointer-events-auto xl:right-4 xl:left-auto xl:w-full xl:max-w-md"
          role="status"
          aria-live="polite"
        >
          <div className="bg-gray-900 dark:bg-gray-800 border border-gray-700 text-white px-4 py-2.5 rounded-lg shadow-lg flex items-center justify-between gap-3 text-xs">
            <span className="font-medium">{statusNotification}</span>
            <div className="flex items-center gap-1 shrink-0">
              {canUndo && onUndo && (
                <button
                  type="button"
                  onClick={() => {
                    onUndo();
                    onDismissStatusNotification();
                  }}
                  title={undoLabel ? `Undo: ${undoLabel}` : 'Undo last change'}
                  className="min-h-9 rounded border border-gray-500 px-2.5 py-1 text-xs font-semibold text-white hover:bg-gray-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white"
                >
                  Undo
                </button>
              )}
              <button
                type="button"
                onClick={onDismissStatusNotification}
                className="min-h-11 min-w-11 inline-flex items-center justify-center text-gray-300 hover:text-white rounded"
                aria-label="Dismiss status notification"
              >
                &times;
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
};

export default StorageAlertBanner;
