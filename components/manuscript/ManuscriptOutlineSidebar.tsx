/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import type { ManuscriptSection } from '../../shared/narrativeTypes';

export interface ManuscriptOutlineSidebarProps {
  outlineOpen: boolean;
  sections: ManuscriptSection[];
  visibleSections: ManuscriptSection[];
  chapters: ManuscriptSection[];
  chronologyMarkers: string[];
  selectedSectionId?: string;
  search: string;
  chapterFilter: string;
  chronologyFilter: string;
  enabled: boolean;
  saving: boolean;
  adopting: boolean;
  buttonClassName: string;
  fieldClassName: string;
  onAddSection: (kind: 'scene' | 'chapter') => void;
  onChangeSearch: (value: string) => void;
  onChangeChapterFilter: (value: string) => void;
  onChangeChronologyFilter: (value: string) => void;
  onSelectSection: (sectionId: string) => void;
}

const ManuscriptOutlineSidebar: React.FC<ManuscriptOutlineSidebarProps> = ({
  outlineOpen,
  sections,
  visibleSections,
  chapters,
  chronologyMarkers,
  selectedSectionId,
  search,
  chapterFilter,
  chronologyFilter,
  enabled,
  saving,
  adopting,
  buttonClassName,
  fieldClassName,
  onAddSection,
  onChangeSearch,
  onChangeChapterFilter,
  onChangeChronologyFilter,
  onSelectSection,
}) => {
  return (
    <aside
      id="manuscript-outline"
      className={`${outlineOpen ? 'block' : 'hidden'} min-w-0 rounded-xl border border-gray-200 bg-white p-4 dark:border-gray-800 dark:bg-gray-900 lg:block`}
      aria-label="Manuscript outline"
    >
      <h2 className="font-semibold">Outline</h2>
      <div className="mt-3 flex flex-wrap gap-2">
        <button
          className={buttonClassName}
          disabled={!enabled || saving || adopting}
          onClick={() => onAddSection('chapter')}
        >
          Add chapter
        </button>
        <button
          className={buttonClassName}
          disabled={!enabled || saving || adopting}
          onClick={() => onAddSection('scene')}
        >
          Add scene
        </button>
      </div>
      <label className="mt-4 block text-sm">
        Find in manuscript
        <input
          className={fieldClassName}
          value={search}
          onChange={(event) => onChangeSearch(event.target.value)}
        />
      </label>
      <label className="mt-3 block text-sm">
        Chapter
        <select
          className={fieldClassName}
          value={chapterFilter}
          onChange={(event) => onChangeChapterFilter(event.target.value)}
        >
          <option value="">All sections</option>
          {chapters.map((chapter, position) => (
            <option key={chapter.id} value={chapter.id}>
              {chapter.title || `Chapter ${position + 1}`}
            </option>
          ))}
          <option value="__unchaptered">Unchaptered scenes</option>
        </select>
      </label>
      <label className="mt-3 block text-sm">
        Story chronology
        <select
          className={fieldClassName}
          value={chronologyFilter}
          onChange={(event) => onChangeChronologyFilter(event.target.value)}
        >
          <option value="">All chronology markers</option>
          {chronologyMarkers.map((marker) => (
            <option key={marker} value={marker}>
              {marker}
            </option>
          ))}
        </select>
      </label>
      <ol className="mt-3 space-y-1">
        {visibleSections.map((section) => (
          <li key={section.id} className={section.chapterId ? 'pl-3' : ''}>
            <button
              type="button"
              disabled={adopting}
              onClick={() => onSelectSection(section.id)}
              aria-current={section.id === selectedSectionId ? 'true' : undefined}
              className="w-full rounded px-2 py-1.5 text-left break-words aria-[current=true]:bg-amber-100 dark:aria-[current=true]:bg-amber-950"
            >
              {section.title ||
                `${section.kind === 'chapter' ? 'Chapter' : 'Scene'} ${sections.indexOf(section) + 1}`}
              {section.kind === 'scene' && !section.chapterId ? (
                <span className="ml-2 text-xs text-gray-500">Unchaptered</span>
              ) : null}
              {section.kind === 'scene' &&
              section.chapterId &&
              !chapters.some((chapter) => chapter.id === section.chapterId) ? (
                <span className="ml-2 text-xs text-amber-700">Orphaned chapter link</span>
              ) : null}
            </button>
          </li>
        ))}
      </ol>
      {visibleSections.length === 0 && (
        <p className="mt-2 text-sm text-gray-600">No sections match these filters.</p>
      )}
    </aside>
  );
};

export default ManuscriptOutlineSidebar;
