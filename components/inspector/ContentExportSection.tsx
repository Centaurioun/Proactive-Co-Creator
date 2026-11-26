/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState } from 'react';

interface ContentExportSectionProps {
  contentExports: { id: string; label: string }[];
  onExportJson: () => void;
  onExportStoryBibleMarkdown: () => void;
  onExportPromptText: () => void;
  onExportManuscript?: () => void;
  onExportManuscriptDocx?: () => void;
  onExportManuscriptText?: () => void;
  onExportContent: (id: string) => void;
  onExportContentBundle: (ids: string[]) => void;
}

const ContentExportSection: React.FC<ContentExportSectionProps> = ({
  contentExports,
  onExportJson,
  onExportStoryBibleMarkdown,
  onExportPromptText,
  onExportManuscript,
  onExportManuscriptDocx,
  onExportManuscriptText,
  onExportContent,
  onExportContentBundle,
}) => {
  const [selectedExport, setSelectedExport] = useState('');
  const [selectedBundleExports, setSelectedBundleExports] = useState<string[]>([]);

  return (
    <>
      <h3 className="font-display text-sm font-bold text-gray-900 dark:text-gray-100">
        Export Content
      </h3>
      <div className="grid grid-cols-1 gap-2">
        <button
          type="button"
          onClick={onExportJson}
          className="w-full text-left px-3 py-2 text-xs font-semibold rounded border border-gray-200 dark:border-gray-700 bg-gray-50 hover:bg-gray-100 dark:bg-gray-800 dark:hover:bg-gray-700 text-gray-900 dark:text-gray-100 transition-colors"
        >
          Download Project Backup (.json)
        </button>
        <button
          type="button"
          onClick={onExportStoryBibleMarkdown}
          className="w-full text-left px-3 py-2 text-xs font-semibold rounded border border-gray-200 dark:border-gray-700 bg-gray-50 hover:bg-gray-100 dark:bg-gray-800 dark:hover:bg-gray-700 text-gray-900 dark:text-gray-100 transition-colors"
        >
          Export Story Bible as Markdown (.md)
        </button>
        <button
          type="button"
          onClick={onExportPromptText}
          className="w-full text-left px-3 py-2 text-xs font-semibold rounded border border-gray-200 dark:border-gray-700 bg-gray-50 hover:bg-gray-100 dark:bg-gray-800 dark:hover:bg-gray-700 text-gray-900 dark:text-gray-100 transition-colors"
        >
          Export Refined Prompt (.txt)
        </button>
      </div>

      <div className="flex flex-wrap gap-2 text-xs underline">
        {onExportManuscript && (
          <button type="button" onClick={onExportManuscript}>
            Download Working Manuscript (.md)
          </button>
        )}
        {onExportManuscriptDocx && (
          <button type="button" onClick={onExportManuscriptDocx}>
            Download Working Manuscript (.docx)
          </button>
        )}
        {onExportManuscriptText && (
          <button type="button" onClick={onExportManuscriptText}>
            Download Working Manuscript (.txt)
          </button>
        )}
      </div>

      {contentExports.length > 0 && (
        <div className="flex flex-col gap-2 text-xs">
          <label className="flex min-w-0 flex-col gap-1">
            Content to export
            <select
              className="max-w-full rounded border bg-transparent p-1"
              value={selectedExport}
              onChange={(event) => setSelectedExport(event.target.value)}
            >
              <option value="">Select content</option>
              {contentExports.map((entry) => (
                <option key={entry.id} value={entry.id}>
                  {entry.label}
                </option>
              ))}
            </select>
          </label>
          <button
            type="button"
            className="self-end underline disabled:opacity-50"
            disabled={!contentExports.some((entry) => entry.id === selectedExport)}
            onClick={() => onExportContent(selectedExport)}
          >
            Download selected content
          </button>
          <fieldset className="space-y-1 rounded border border-gray-200 p-2 dark:border-gray-700">
            <legend className="px-1 font-semibold">Content ZIP bundle</legend>
            {contentExports.map((entry) => (
              <label key={entry.id} className="flex items-start gap-2">
                <input
                  type="checkbox"
                  checked={selectedBundleExports.includes(entry.id)}
                  onChange={(event) =>
                    setSelectedBundleExports((previous) =>
                      event.target.checked
                        ? [...previous, entry.id]
                        : previous.filter((id) => id !== entry.id)
                    )
                  }
                />
                <span>{entry.label}</span>
              </label>
            ))}
            <p className="text-[11px] text-gray-500">
              ZIP includes a manifest and selected content. It is not a full project backup.
            </p>
            <button
              type="button"
              className="underline disabled:opacity-50"
              disabled={selectedBundleExports.length === 0}
              onClick={() => onExportContentBundle(selectedBundleExports)}
            >
              Download selected content ZIP
            </button>
          </fieldset>
        </div>
      )}
    </>
  );
};

export default ContentExportSection;
