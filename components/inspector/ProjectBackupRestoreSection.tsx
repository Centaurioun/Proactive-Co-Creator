/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useEffect, useRef, useState } from 'react';
import type { CreativeProject } from '../../shared/types';

interface ProjectBackupRestoreSectionProps {
  onPreviewProjectJson: (rawJson: string) => Promise<CreativeProject>;
  onImportProjectJson: (rawJson: string) => Promise<{ ok: boolean; error?: string }>;
}

const ProjectBackupRestoreSection: React.FC<ProjectBackupRestoreSectionProps> = ({
  onPreviewProjectJson,
  onImportProjectJson,
}) => {
  const [importJsonText, setImportJsonText] = useState('');
  const [restorePreview, setRestorePreview] = useState<{
    raw: string;
    project: CreativeProject;
  } | null>(null);
  const [restoreBusy, setRestoreBusy] = useState(false);
  const [importMessage, setImportMessage] = useState<{ ok: boolean; text: string } | null>(null);

  const mountedRef = useRef(true);
  const requestEpochRef = useRef(0);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      requestEpochRef.current += 1;
    };
  }, []);

  async function previewProjectBackup(raw: string) {
    const epoch = ++requestEpochRef.current;
    setRestorePreview(null);
    setImportMessage(null);
    setRestoreBusy(true);
    try {
      const preview = await onPreviewProjectJson(raw);
      if (!mountedRef.current || epoch !== requestEpochRef.current) return;
      setRestorePreview({ raw, project: preview });
    } catch (cause) {
      if (!mountedRef.current || epoch !== requestEpochRef.current) return;
      setImportMessage({
        ok: false,
        text: cause instanceof Error ? cause.message : 'Invalid backup.',
      });
    } finally {
      if (mountedRef.current && epoch === requestEpochRef.current) {
        setRestoreBusy(false);
      }
    }
  }

  const handleFileImport = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    event.target.value = '';
    const epoch = ++requestEpochRef.current;
    void file
      .text()
      .then(
        (raw) => {
          if (!mountedRef.current || epoch !== requestEpochRef.current) return;
          return previewProjectBackup(raw);
        },
        () => {
          if (!mountedRef.current || epoch !== requestEpochRef.current) return;
          setImportMessage({ ok: false, text: 'Backup file could not be read.' });
        }
      );
  };

  const handleRestoreCopy = async () => {
    if (!restorePreview) return;
    const epoch = ++requestEpochRef.current;
    const raw = restorePreview.raw;
    setRestoreBusy(true);
    try {
      const result = await onImportProjectJson(raw);
      if (!mountedRef.current || epoch !== requestEpochRef.current) return;
      setImportMessage({
        ok: result.ok,
        text: result.ok
          ? 'Restored project copy saved.'
          : result.error ?? 'Restore failed.',
      });
      if (result.ok) {
        setRestorePreview(null);
        setImportJsonText('');
      }
    } catch (cause) {
      if (!mountedRef.current || epoch !== requestEpochRef.current) return;
      setImportMessage({
        ok: false,
        text: cause instanceof Error ? cause.message : 'Restore failed.',
      });
    } finally {
      if (mountedRef.current && epoch === requestEpochRef.current) {
        setRestoreBusy(false);
      }
    }
  };

  return (
    <div className="pt-2 space-y-2">
      <label className="block text-xs font-semibold text-gray-800 dark:text-gray-200">
        Restore Project Backup from JSON File or Paste JSON
      </label>
      <input
        type="file"
        accept=".json,application/json"
        onChange={handleFileImport}
        aria-label="Import project JSON file"
        className="block w-full text-xs text-gray-600 dark:text-gray-300 file:mr-2 file:py-1.5 file:px-3 file:rounded file:border-0 file:text-xs file:font-semibold file:bg-blue-50 file:text-blue-700 dark:file:bg-blue-950 dark:file:text-blue-300"
      />
      <div className="flex gap-1.5">
        <input
          type="text"
          value={importJsonText}
          onChange={(e) => setImportJsonText(e.target.value)}
          placeholder="Or paste raw project JSON here..."
          aria-label="Paste project JSON"
          className="flex-1 min-w-0 text-xs bg-gray-50 dark:bg-gray-800 border border-gray-300 dark:border-gray-700 rounded px-2.5 py-1.5 text-gray-900 dark:text-gray-100"
        />
        <button
          type="button"
          disabled={restoreBusy || !importJsonText.trim()}
          onClick={() => void previewProjectBackup(importJsonText)}
          className="px-2.5 py-1.5 text-xs font-semibold bg-blue-600 text-white rounded disabled:opacity-40 whitespace-nowrap"
        >
          Preview JSON
        </button>
      </div>
      {restorePreview && (
        <div className="space-y-2 rounded border border-amber-400 p-3 text-xs">
          <p className="break-words">
            {restorePreview.project.name} · Schema {restorePreview.project.schemaVersion} · Revision{' '}
            {restorePreview.project.revision}
          </p>
          <p>
            A separate project will be created with the included manuscript, plan, artifacts and history.
          </p>
          <button
            type="button"
            className="mr-2 underline"
            disabled={restoreBusy}
            onClick={() => void handleRestoreCopy()}
          >
            Restore a copy
          </button>
          <button
            type="button"
            className="underline"
            disabled={restoreBusy}
            onClick={() => setRestorePreview(null)}
          >
            Cancel
          </button>
        </div>
      )}
      {importMessage && (
        <p
          role="alert"
          className={`text-xs font-medium ${
            importMessage.ok
              ? 'text-emerald-600 dark:text-emerald-400'
              : 'text-red-600 dark:text-red-400'
          }`}
        >
          {importMessage.text}
        </p>
      )}
    </div>
  );
};

export default ProjectBackupRestoreSection;
