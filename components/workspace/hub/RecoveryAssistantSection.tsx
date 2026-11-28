/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import type { CreativeProject } from '../../../shared/types';
import type { HydrationWriteGate } from '../../../lib/controller/projectListSync';

interface RecoveryAssistantSectionProps {
  project: CreativeProject;
  backupCount: number;
  hydrationGate?: HydrationWriteGate;
  hasStorageAlert?: boolean;
  onExportJsonBackup?: () => void;
  onOpenReviewSync?: () => void;
}

export function RecoveryAssistantSection({
  project,
  backupCount,
  hydrationGate = 'ready',
  hasStorageAlert = false,
  onExportJsonBackup,
  onOpenReviewSync,
}: RecoveryAssistantSectionProps) {
  const isDurablySynced = project.persistedRevision === project.revision;

  return (
    <section
      aria-label="Recovery assistant"
      className="rounded-xl border border-[#dad8d2] bg-white p-5 shadow-sm dark:border-gray-700 dark:bg-gray-900"
    >
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="max-w-3xl">
          <h2 className="text-base font-semibold text-[#25262a] dark:text-gray-100">
            Recovery &amp; Storage Guide
          </h2>
          <p className="mt-1 text-sm text-gray-600 dark:text-gray-300">
            Your work is stored locally in this browser&apos;s IndexedDB database. For long-term archives or moving between devices, download a portable JSON backup below.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          {onExportJsonBackup && (
            <button
              type="button"
              onClick={onExportJsonBackup}
              className="min-h-10 rounded-lg bg-[#62445e] px-3.5 py-2 text-sm font-semibold text-white hover:bg-[#52374f] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#62445e]"
            >
              Export JSON Backup
            </button>
          )}
          {onOpenReviewSync && (
            <button
              type="button"
              onClick={onOpenReviewSync}
              className="min-h-10 rounded-lg border border-[#dad8d2] bg-[#fbfaf7] px-3.5 py-2 text-sm font-medium text-[#25262a] hover:bg-gray-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#62445e] dark:border-gray-700 dark:bg-gray-800 dark:text-gray-100 dark:hover:bg-gray-700"
            >
              Open Narrative Sync
            </button>
          )}
        </div>
      </div>

      <dl className="mt-4 grid gap-3 sm:grid-cols-3">
        <div className="rounded-lg border border-[#e8e5df] bg-[#fbfaf7] p-3 dark:border-gray-800 dark:bg-gray-950">
          <dt className="text-xs font-medium text-gray-500 dark:text-gray-400">Active Revision</dt>
          <dd className="mt-1 text-sm font-semibold text-[#25262a] dark:text-gray-100">
            Revision #{project.revision}
          </dd>
          <p className="mt-0.5 text-xs text-gray-600 dark:text-gray-400">
            {hasStorageAlert
              ? 'Attention needed — review the storage alert banner above.'
              : hydrationGate === 'unavailable'
                ? 'IndexedDB unavailable — export JSON to keep changes.'
                : isDurablySynced
                  ? 'Saved in browser storage.'
                  : 'Local changes pending durable sync.'}
          </p>
        </div>

        <div className="rounded-lg border border-[#e8e5df] bg-[#fbfaf7] p-3 dark:border-gray-800 dark:bg-gray-950">
          <dt className="text-xs font-medium text-gray-500 dark:text-gray-400">Browser Safety Backups</dt>
          <dd className="mt-1 text-sm font-semibold text-[#25262a] dark:text-gray-100">
            {backupCount} saved {backupCount === 1 ? 'snapshot' : 'snapshots'}
          </dd>
          <p className="mt-0.5 text-xs text-gray-600 dark:text-gray-400">
            Restoring a backup creates a separate copy by default so your active project stays untouched.
          </p>
        </div>

        <div className="rounded-lg border border-[#e8e5df] bg-[#fbfaf7] p-3 dark:border-gray-800 dark:bg-gray-950">
          <dt className="text-xs font-medium text-gray-500 dark:text-gray-400">Browser Storage Notice</dt>
          <dd className="mt-1 text-sm font-semibold text-[#25262a] dark:text-gray-100">
            Local-only persistence
          </dd>
          <p className="mt-0.5 text-xs text-gray-600 dark:text-gray-400">
            Clearing site data or private browsing can remove browser storage. Export periodic JSON or archive backups.
          </p>
        </div>
      </dl>

      <div className="mt-4 grid gap-3 border-t border-[#e8e5df] pt-4 text-xs text-gray-700 dark:border-gray-800 dark:text-gray-300 sm:grid-cols-2">
        <div>
          <p className="font-semibold text-[#25262a] dark:text-gray-100">
            Storage Conflict (Browser Persistence)
          </p>
          <p className="mt-1 leading-relaxed">
            Occurs when two browser tabs or an older cached copy diverge from the latest IndexedDB revision. Resolve it using the banner above (Reload Latest, Export Stored Copy, or Keep My Version after an automatic safety backup).
          </p>
        </div>
        <div>
          <p className="font-semibold text-[#25262a] dark:text-gray-100">
            Narrative Sync (Manuscript vs. Story Plan)
          </p>
          <p className="mt-1 leading-relaxed">
            Compares your written manuscript chapters against your Story Bible, characters, and relationships. Use the Review workspace to inspect and explicitly apply proposed updates in either direction.
          </p>
        </div>
      </div>
    </section>
  );
}
