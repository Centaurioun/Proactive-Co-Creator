/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';

export type WorkspaceSection = 'workspace' | 'story-bible' | 'output' | 'history';

interface HeaderProps {
  isDarkMode: boolean;
  toggleDarkMode: () => void;
  onShowInfo: () => void;
  activeSection?: WorkspaceSection;
  onSelectSection?: (section: WorkspaceSection) => void;
  onLoadSampleProject?: () => void;
}

const Header: React.FC<HeaderProps> = ({
  isDarkMode,
  toggleDarkMode,
  onShowInfo,
  activeSection = 'workspace',
  onSelectSection,
  onLoadSampleProject,
}) => {
  return (
    <header className="bg-white dark:bg-gray-900 px-5 py-3 flex justify-between items-center gap-8 border-b border-gray-200 dark:border-gray-800 transition-colors duration-150 flex-shrink-0">
      {/* Zone 1: Single text element Brand wordmark */}
      <a
        href="#workspace"
        onClick={(e) => {
          e.preventDefault();
          onSelectSection?.('workspace');
        }}
        className="font-display text-lg font-bold tracking-tight text-gray-900 dark:text-gray-100 whitespace-nowrap shrink-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 rounded"
      >
        Proactive Co-Creator
      </a>

      {/* Zone 2: 4–5 clean single-line text navigation links */}
      <nav
        aria-label="Workspace navigation"
        className="hidden md:flex items-center gap-6 text-sm font-medium text-gray-600 dark:text-gray-300"
      >
        <button
          type="button"
          onClick={() => onSelectSection?.('workspace')}
          className={`hover:text-gray-900 dark:hover:text-white transition-colors whitespace-nowrap shrink-0 underline-offset-4 ${
            activeSection === 'workspace'
              ? 'text-blue-600 dark:text-blue-400 underline font-semibold'
              : 'hover:underline'
          }`}
        >
          Workspace
        </button>
        <button
          type="button"
          onClick={() => onSelectSection?.('story-bible')}
          className={`hover:text-gray-900 dark:hover:text-white transition-colors whitespace-nowrap shrink-0 underline-offset-4 ${
            activeSection === 'story-bible'
              ? 'text-blue-600 dark:text-blue-400 underline font-semibold'
              : 'hover:underline'
          }`}
        >
          Story Bible
        </button>
        <button
          type="button"
          onClick={() => onSelectSection?.('output')}
          className={`hover:text-gray-900 dark:hover:text-white transition-colors whitespace-nowrap shrink-0 underline-offset-4 ${
            activeSection === 'output'
              ? 'text-blue-600 dark:text-blue-400 underline font-semibold'
              : 'hover:underline'
          }`}
        >
          Prompt &amp; Output
        </button>
        <button
          type="button"
          onClick={() => onSelectSection?.('history')}
          className={`hover:text-gray-900 dark:hover:text-white transition-colors whitespace-nowrap shrink-0 underline-offset-4 ${
            activeSection === 'history'
              ? 'text-blue-600 dark:text-blue-400 underline font-semibold'
              : 'hover:underline'
          }`}
        >
          Revision History
        </button>
        <button
          type="button"
          onClick={onShowInfo}
          className="hover:text-gray-900 dark:hover:text-white hover:underline underline-offset-4 transition-colors whitespace-nowrap shrink-0"
        >
          About
        </button>
      </nav>

      {/* Zone 3: Primary action & theme switch */}
      <div className="flex items-center gap-2 shrink-0">
        {onLoadSampleProject && (
          <button
            type="button"
            onClick={onLoadSampleProject}
            className="hidden sm:inline-flex items-center px-3.5 py-2 min-h-[38px] text-xs font-semibold text-gray-800 dark:text-gray-100 bg-gray-100 dark:bg-gray-800 hover:bg-gray-200 dark:hover:bg-gray-700 rounded-lg border border-gray-200 dark:border-gray-700 transition-colors whitespace-nowrap shrink-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
          >
            Reset Sample Plan
          </button>
        )}

        <button
          type="button"
          onClick={toggleDarkMode}
          className="min-w-[38px] min-h-[38px] px-3 py-1.5 rounded-lg bg-gray-100 dark:bg-gray-800 text-gray-700 dark:text-gray-200 hover:bg-gray-200 dark:hover:bg-gray-700 border border-gray-200 dark:border-gray-700 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 flex items-center justify-center text-xs font-medium whitespace-nowrap shrink-0"
          title={isDarkMode ? 'Switch to Light Mode' : 'Switch to Dark Mode'}
          aria-label={isDarkMode ? 'Switch to light mode' : 'Switch to dark mode'}
          aria-pressed={isDarkMode}
        >
          {isDarkMode ? 'Light Theme' : 'Dark Theme'}
        </button>
      </div>
    </header>
  );
};

export default Header;
