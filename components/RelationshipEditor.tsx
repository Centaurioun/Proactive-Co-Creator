/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect, useLayoutEffect, useRef } from 'react';
import type { Candidate, Relationship } from '../shared/types';

export interface RelationshipEditorProps {
  rel: Relationship;
  currentLabel: string;
  position: { x: number; y: number };
  containerDimensions: { width: number; height: number };
  onChange: (newLabel: string) => void;
  onClose: () => void;
  isLoading: boolean;
}

const RelationshipEditor: React.FC<RelationshipEditorProps> = ({
  rel,
  currentLabel,
  position,
  containerDimensions,
  onChange,
  onClose,
  isLoading,
}) => {
  const editorRef = useRef<HTMLDivElement>(null);
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const previousFocusRef = useRef<HTMLElement | null>(null);
  const onCloseRef = useRef(onClose);
  const [customLabel, setCustomLabel] = useState('');
  const [adjustedStyle, setAdjustedStyle] = useState<React.CSSProperties>({
    left: position.x,
    top: position.y,
    opacity: 0,
    transform: 'translate(-50%, 8px)',
  });

  useEffect(() => {
    onCloseRef.current = onClose;
  }, [onClose]);

  useEffect(() => {
    previousFocusRef.current =
      document.activeElement instanceof HTMLElement ? document.activeElement : null;
    closeButtonRef.current?.focus();

    const handleClickOutside = (event: MouseEvent) => {
      if (editorRef.current && !editorRef.current.contains(event.target as Node)) {
        onCloseRef.current();
      }
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        onCloseRef.current();
        return;
      }
      if (event.key === 'Tab' && editorRef.current) {
        const focusables = editorRef.current.querySelectorAll<HTMLElement>(
          'button:not([disabled]), input:not([disabled]), [tabindex]:not([tabindex="-1"])'
        );
        if (focusables.length === 0) return;
        const first = focusables[0];
        const last = focusables[focusables.length - 1];
        if (event.shiftKey && document.activeElement === first) {
          event.preventDefault();
          last.focus();
        } else if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault();
          first.focus();
        }
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    window.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
      window.removeEventListener('keydown', handleKeyDown);
      previousFocusRef.current?.focus();
    };
  }, []);

  useLayoutEffect(() => {
    if (editorRef.current && containerDimensions.width > 0) {
      const { width, height } = editorRef.current.getBoundingClientRect();
      const padding = 16;

      let top = position.y + 12;
      let left = position.x;
      let transformX = '-50%';

      if (top + height > containerDimensions.height - padding) {
        top = position.y - height - 12;
        if (top < padding) top = padding;
      }

      const halfWidth = width / 2;
      if (left + halfWidth > containerDimensions.width - padding) {
        left = position.x - 12;
        transformX = '-100%';
      } else if (left - halfWidth < padding) {
        left = position.x + 12;
        transformX = '0%';
      }

      setAdjustedStyle({
        left,
        top,
        transform: `translate(${transformX}, 0)`,
        opacity: 1,
        transition: 'opacity 0.15s ease-out',
        touchAction: 'pan-y',
      });
    }
  }, [position, containerDimensions, rel.label, currentLabel]);

  const allOptions: Candidate[] = [
    { name: rel.label },
    ...(currentLabel !== rel.label ? [{ name: currentLabel }] : []),
    ...(rel.alternatives || []),
  ].filter((v, i, a) => a.findIndex((t) => t.name === v.name) === i);

  const handleCustomSubmit = () => {
    if (customLabel.trim()) {
      onChange(customLabel.trim());
      onClose();
    }
  };

  return (
    <div
      ref={editorRef}
      role="dialog"
      aria-modal="false"
      aria-label={`Edit relationship between ${rel.source} and ${rel.target}`}
      className="absolute bg-white/95 dark:bg-gray-800/95 backdrop-blur-sm p-3.5 rounded-lg border border-gray-300 dark:border-gray-600 shadow-xl z-40 w-64 max-h-[300px] overflow-y-auto flex flex-col"
      style={adjustedStyle}
      onPointerDown={(e) => e.stopPropagation()}
      onWheel={(e) => e.stopPropagation()}
    >
      <div className="flex justify-between items-center mb-2 flex-shrink-0">
        <h4 className="font-semibold text-sm text-gray-900 dark:text-gray-100">
          Edit Relationship
        </h4>
        <button
          ref={closeButtonRef}
          type="button"
          onClick={onClose}
          className="text-gray-500 hover:text-gray-800 dark:text-gray-400 dark:hover:text-gray-100 text-lg leading-none px-1.5 py-0.5 rounded focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
          aria-label="Close relationship editor"
        >
          &times;
        </button>
      </div>

      <p className="text-xs text-gray-500 dark:text-gray-400 mb-2">
        {rel.source} &rarr; {rel.target}
      </p>

      <div className="flex flex-col space-y-1 mb-3 flex-grow">
        {allOptions.map((alt) => {
          const isCurrent = currentLabel === alt.name;
          return (
            <button
              key={alt.name}
              type="button"
              disabled={isLoading}
              aria-pressed={isCurrent}
              onClick={() => {
                onChange(alt.name);
                onClose();
              }}
              className={`text-left text-sm py-1.5 px-2.5 rounded-md transition-colors w-full focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 ${
                isCurrent
                  ? 'bg-blue-100 dark:bg-blue-900 text-blue-900 dark:text-blue-100 font-semibold'
                  : 'hover:bg-gray-100 dark:hover:bg-gray-700 text-gray-800 dark:text-gray-200'
              } disabled:opacity-50`}
            >
              {alt.name}
            </button>
          );
        })}
      </div>

      <div className="pt-2 border-t border-gray-200 dark:border-gray-700 flex-shrink-0">
        <div className="flex gap-1.5">
          <input
            type="text"
            value={customLabel}
            onChange={(e) => setCustomLabel(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') handleCustomSubmit();
            }}
            placeholder="Type custom label..."
            aria-label="Custom relationship label"
            className="flex-grow text-xs border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 rounded-md p-1.5 focus:outline-none focus:ring-2 focus:ring-blue-500"
            disabled={isLoading}
          />
          <button
            type="button"
            onClick={handleCustomSubmit}
            disabled={isLoading || !customLabel.trim()}
            className="bg-blue-600 hover:bg-blue-700 text-white text-xs font-semibold px-2.5 rounded-md disabled:bg-gray-300 dark:disabled:bg-gray-600"
          >
            Save
          </button>
        </div>
      </div>
    </div>
  );
};

export default RelationshipEditor;
