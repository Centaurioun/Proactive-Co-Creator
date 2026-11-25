/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import { manuscriptSections } from '../../lib/narrative/manuscriptModel';
import type { CreativeProject } from '../../shared/types';

export type TimelineViewMode = 'narrative' | 'chronology';

export interface TimelinePanelProps {
  project: CreativeProject;
  timelineView: TimelineViewMode;
  onChangeTimelineView: (view: TimelineViewMode) => void;
  onJumpToSection?: (sectionId: string) => void;
}

const TimelinePanel: React.FC<TimelinePanelProps> = ({
  project,
  timelineView,
  onChangeTimelineView,
  onJumpToSection,
}) => {
  const sections = manuscriptSections(project);
  const chronologyRows = sections.map((section, idx) => {
    const note = section.chronology?.trim() ?? '';
    const isFlashback = /\b(flashback|earlier|prior|years?\s+ago|before|memory|prologue)\b/i.test(note);
    const isUncertain = /\b(uncertain|unknown|approx|maybe|tbd|\?)\b/i.test(note);
    return { section, narrativeIndex: idx + 1, note, isFlashback, isUncertain };
  });
  const sortedByChronology = [
    ...chronologyRows.filter((r) => r.note).sort((a, b) => a.note.localeCompare(b.note)),
    ...chronologyRows.filter((r) => !r.note),
  ];
  const displayedRows = timelineView === 'narrative' ? chronologyRows : sortedByChronology;

  return (
    <div className="flex-1 overflow-y-auto p-4 space-y-3 min-h-0">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h3 className="font-display text-sm font-bold text-gray-900 dark:text-gray-100">
            Story Timeline
          </h3>
          <p className="text-xs text-gray-500 dark:text-gray-400">
            Switch between Narrative Order (manuscript reading order) and Authored Story Chronology. No dates or hidden event order are invented.
          </p>
        </div>
        <div
          role="group"
          aria-label="Timeline ordering"
          className="flex rounded bg-gray-100 p-0.5 text-[11px] dark:bg-gray-800"
        >
          <button
            type="button"
            aria-pressed={timelineView === 'narrative'}
            onClick={() => onChangeTimelineView('narrative')}
            className={`rounded px-2 py-0.5 font-semibold ${
              timelineView === 'narrative'
                ? 'bg-white text-blue-600 shadow-xs dark:bg-gray-900 dark:text-blue-400'
                : 'text-gray-600 dark:text-gray-400'
            }`}
          >
            Narrative Order
          </button>
          <button
            type="button"
            aria-pressed={timelineView === 'chronology'}
            onClick={() => onChangeTimelineView('chronology')}
            className={`rounded px-2 py-0.5 font-semibold ${
              timelineView === 'chronology'
                ? 'bg-white text-blue-600 shadow-xs dark:bg-gray-900 dark:text-blue-400'
                : 'text-gray-600 dark:text-gray-400'
            }`}
          >
            Story Chronology
          </button>
        </div>
      </div>

      {sections.length === 0 ? (
        <p className="rounded border border-gray-200 p-3 text-xs text-gray-600 dark:border-gray-700 dark:text-gray-300">
          No current manuscript sections are available. Add scenes in Write or import a story to inspect the timeline.
        </p>
      ) : (
        <div className="overflow-x-auto rounded border border-gray-200 dark:border-gray-700">
          <table className="w-full border-collapse text-left text-xs">
            <caption className="sr-only">
              Manuscript order and authored chronology notes
            </caption>
            <thead className="bg-gray-50 text-gray-600 dark:bg-gray-800 dark:text-gray-300">
              <tr>
                <th scope="col" className="px-2.5 py-2">Order</th>
                <th scope="col" className="px-2.5 py-2">Section</th>
                <th scope="col" className="px-2.5 py-2">Chronology note</th>
                <th scope="col" className="px-2.5 py-2">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100 dark:divide-gray-800">
              {displayedRows.map(({ section, narrativeIndex, note, isFlashback, isUncertain }) => (
                <tr key={section.id}>
                  <td className="px-2.5 py-2 font-mono">#{narrativeIndex}</td>
                  <th scope="row" className="px-2.5 py-2 font-semibold">
                    <div className="flex flex-col items-start gap-1">
                      <span>{section.title || `Untitled ${section.kind}`}</span>
                      {onJumpToSection && (
                        <button
                          type="button"
                          onClick={() => onJumpToSection(section.id)}
                          className="text-[11px] font-medium text-blue-600 dark:text-blue-400 hover:underline"
                        >
                          Jump to scene →
                        </button>
                      )}
                    </div>
                  </th>
                  <td className="px-2.5 py-2">{note ? note : 'No chronology note recorded.'}</td>
                  <td className="px-2.5 py-2">
                    {isFlashback
                      ? 'Flashback / non-linear'
                      : isUncertain
                        ? 'Uncertain chronology'
                        : note
                          ? 'Authored; not date-verified'
                          : 'Undated / unspecified'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
};

export default TimelinePanel;
