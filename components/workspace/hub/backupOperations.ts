/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import type { ProjectBackup } from '../../../lib/narrative/recovery';

export interface GuardedBackupOperationParams {
  projectId: string;
  isBusy: () => boolean;
  setBusy: (busy: boolean) => void;
  setMessage: (message: string) => void;
  isCurrentTarget: (projectId: string) => boolean;
  listProjectBackups: (projectId: string) => Promise<ProjectBackup[]>;
  setBackups: (records: ProjectBackup[]) => void;
  operation: () => Promise<string>;
}

export async function runGuardedBackupOperation({
  projectId,
  isBusy,
  setBusy,
  setMessage,
  isCurrentTarget,
  listProjectBackups,
  setBackups,
  operation,
}: GuardedBackupOperationParams): Promise<void> {
  if (isBusy()) return;
  setBusy(true);
  setMessage('');
  try {
    const nextMessage = await operation();
    if (!isCurrentTarget(projectId)) return;
    setMessage(nextMessage);
    const records = await listProjectBackups(projectId);
    if (!isCurrentTarget(projectId)) return;
    setBackups(records);
  } catch (cause) {
    if (isCurrentTarget(projectId)) {
      setMessage(cause instanceof Error ? cause.message : 'Backup operation failed.');
    }
  } finally {
    setBusy(false);
  }
}

export interface ArchiveRestoreExecutionParams {
  setBusy: (busy: boolean) => void;
  setArchiveError: (error: string) => void;
  run: () => Promise<void>;
}

export async function runArchiveRestoreWithFinally({
  setBusy,
  setArchiveError,
  run,
}: ArchiveRestoreExecutionParams): Promise<void> {
  setBusy(true);
  setArchiveError('');
  try {
    await run();
  } catch (cause) {
    setArchiveError(cause instanceof Error ? cause.message : 'Archive restore failed.');
  } finally {
    setBusy(false);
  }
}
