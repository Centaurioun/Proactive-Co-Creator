/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useEffect } from 'react';

interface InfoModalProps {
  isOpen: boolean;
  onClose: () => void;
}

const InfoModal: React.FC<InfoModalProps> = ({ isOpen, onClose }) => {
  useEffect(() => {
    if (!isOpen) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        onClose();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  return (
    <div
      className="fixed inset-0 z-[3000] bg-black/50 flex items-center justify-center p-4 backdrop-blur-xs animate-fade-in"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-labelledby="info-modal-title"
    >
      <div
        className="bg-white dark:bg-gray-900 rounded-xl shadow-2xl max-w-lg w-full p-6 relative border border-gray-200 dark:border-gray-800"
        onClick={(e) => e.stopPropagation()}
      >
        <button
          type="button"
          onClick={onClose}
          className="absolute top-4 right-4 min-w-[36px] min-h-[36px] flex items-center justify-center rounded-lg text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
          aria-label="Close about dialog"
        >
          &times;
        </button>

        <div className="mb-5">
          <h2
            id="info-modal-title"
            className="font-display text-xl font-bold text-gray-900 dark:text-gray-100 mb-2"
          >
            Proactive Co-Creator 2.0
          </h2>
          <p className="text-xs sm:text-sm text-gray-600 dark:text-gray-300 leading-relaxed">
            An interactive story-planning and prompt-refinement workspace combining a Decision Inbox, Belief Graph 2.0, Synchronized Story Bible, and Natural-Language Batch Editing.
          </p>
        </div>

        <div className="space-y-2.5 text-xs text-gray-700 dark:text-gray-300">
          <div className="p-3 rounded-lg bg-gray-50 dark:bg-gray-800 border border-gray-200 dark:border-gray-700">
            <h3 className="font-semibold text-gray-900 dark:text-gray-100 mb-1">
              User Authority &amp; Provenance
            </h3>
            <p>
              AI suggestions are staged proposals in the Decision Inbox. Explicit user edits, entity renames, and exclusions are never overwritten during reanalysis.
            </p>
          </div>
          <div className="p-3 rounded-lg bg-gray-50 dark:bg-gray-800 border border-gray-200 dark:border-gray-700">
            <h3 className="font-semibold text-gray-900 dark:text-gray-100 mb-1">
              Local Persistence &amp; Export
            </h3>
            <p>
              Projects, confirmed decisions, and revision history are automatically saved in local browser storage (IndexedDB + localStorage) and can be exported as JSON or Markdown.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
};

export default InfoModal;
