/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState } from 'react';
import type { GenerationMode } from '../shared/types';

interface PromptInputProps {
  prompt: string;
  setPrompt: (prompt: string) => void;
  onSubmit: () => void;
  onAnalyze: () => void;
  isLoading: boolean;
  isGenerating: boolean;
  isFirstRun: boolean;
  mode: GenerationMode;
  setMode: (mode: GenerationMode) => void;
}

const PromptInput: React.FC<PromptInputProps> = ({
  prompt,
  setPrompt,
  onSubmit,
  onAnalyze,
  isLoading,
  isGenerating,
  isFirstRun,
  mode,
  setMode,
}) => {
  const [validationError, setValidationError] = useState<string | null>(null);
  const hasPromptText = prompt.trim().length > 0;

  const handleAnalyzeClick = (e: React.MouseEvent) => {
    e.preventDefault();
    if (!hasPromptText) {
      setValidationError('Enter a prompt before analyzing.');
      return;
    }
    setValidationError(null);
    onAnalyze();
  };

  const handleSubmitClick = (e: React.MouseEvent) => {
    e.preventDefault();
    if (!hasPromptText) {
      setValidationError('Enter a prompt before generating.');
      return;
    }
    setValidationError(null);
    onSubmit();
  };

  return (
    <div className="bg-white dark:bg-gray-800 flex flex-col transition-colors duration-200">
      <div className="px-4 py-2.5 border-b border-gray-100 dark:border-gray-700 bg-gray-50/50 dark:bg-gray-900/50 flex justify-between items-center">
        <label
          htmlFor="prompt-textarea"
          className="font-display text-sm md:text-base font-semibold text-gray-800 dark:text-gray-200"
        >
          Prompt
        </label>
        <span className="text-xs text-gray-500 dark:text-gray-400 font-mono tabular-nums">
          {prompt.length} chars
        </span>
      </div>

      <div className="p-3 md:p-4 flex flex-col gap-3">
        <div className={`w-full relative ${isLoading ? 'cursor-not-allowed' : ''}`}>
          <textarea
            id="prompt-textarea"
            value={prompt}
            onChange={(e) => {
              setPrompt(e.target.value);
              if (validationError && e.target.value.trim().length > 0) {
                setValidationError(null);
              }
            }}
            placeholder="Describe what you want to create (e.g. a cat hosting a party for its animal friends)..."
            className="w-full h-20 md:h-24 bg-white dark:bg-gray-700 border border-gray-300 dark:border-gray-600 rounded-lg p-3 text-gray-900 dark:text-gray-100 placeholder:text-gray-400 dark:placeholder:text-gray-400 focus:ring-2 focus:ring-blue-500 focus:border-blue-500 focus:outline-none resize-none text-sm md:text-base leading-relaxed transition-colors disabled:opacity-50 disabled:pointer-events-none"
            disabled={isLoading}
            aria-invalid={Boolean(validationError)}
          />
        </div>

        {validationError && (
          <p className="text-xs font-medium text-red-600 dark:text-red-400" role="alert">
            {validationError}
          </p>
        )}

        <div className="flex flex-col sm:flex-row justify-between items-stretch sm:items-center gap-2.5">
          <div
            role="group"
            aria-label="Generation mode"
            className={`flex bg-gray-100 dark:bg-gray-700 p-1 rounded-lg transition-colors overflow-x-auto max-w-full ${isLoading ? 'opacity-75' : ''}`}
          >
            <button
              type="button"
              onClick={() => setMode('image')}
              disabled={isLoading}
              aria-pressed={mode === 'image'}
              className={`flex items-center justify-center gap-1.5 px-3 py-1.5 min-h-[36px] rounded-md transition-colors text-xs md:text-sm font-medium whitespace-nowrap shrink-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 ${
                mode === 'image'
                  ? 'bg-white dark:bg-gray-600 text-blue-700 dark:text-blue-300 shadow-sm'
                  : 'text-gray-600 dark:text-gray-300 hover:text-gray-900 dark:hover:text-white'
              }`}
            >
              <svg
                xmlns="http://www.w3.org/2000/svg"
                className="h-4 w-4 shrink-0"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
                aria-hidden="true"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z"
                />
              </svg>
              <span>Image</span>
            </button>

            <button
              type="button"
              onClick={() => setMode('story')}
              disabled={isLoading}
              aria-pressed={mode === 'story'}
              className={`flex items-center justify-center gap-1.5 px-3 py-1.5 min-h-[36px] rounded-md transition-colors text-xs md:text-sm font-medium whitespace-nowrap shrink-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 ${
                mode === 'story'
                  ? 'bg-white dark:bg-gray-600 text-blue-700 dark:text-blue-300 shadow-sm'
                  : 'text-gray-600 dark:text-gray-300 hover:text-gray-900 dark:hover:text-white'
              }`}
            >
              <svg
                xmlns="http://www.w3.org/2000/svg"
                className="h-4 w-4 shrink-0"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
                aria-hidden="true"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.747 0 3.332.477 4.5 1.253v13C19.832 18.477 18.247 18 16.5 18c-1.746 0-3.332.477-4.5 1.253"
                />
              </svg>
              <span>Story</span>
            </button>

            <button
              type="button"
              onClick={() => setMode('video')}
              disabled={isLoading}
              aria-pressed={mode === 'video'}
              className={`flex items-center justify-center gap-1.5 px-3 py-1.5 min-h-[36px] rounded-md transition-colors text-xs md:text-sm font-medium whitespace-nowrap shrink-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 ${
                mode === 'video'
                  ? 'bg-white dark:bg-gray-600 text-blue-700 dark:text-blue-300 shadow-sm'
                  : 'text-gray-600 dark:text-gray-300 hover:text-gray-900 dark:hover:text-white'
              }`}
            >
              <svg
                xmlns="http://www.w3.org/2000/svg"
                className="h-4 w-4 shrink-0"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
                aria-hidden="true"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z"
                />
              </svg>
              <span>Video</span>
            </button>
          </div>

          <div className="flex gap-2 justify-end">
            <button
              type="button"
              onClick={handleAnalyzeClick}
              disabled={isLoading || !hasPromptText}
              className="bg-gray-100 hover:bg-gray-200 dark:bg-gray-700 dark:hover:bg-gray-600 disabled:opacity-50 disabled:cursor-not-allowed text-gray-800 dark:text-gray-100 font-semibold py-2 px-3.5 min-h-[40px] rounded-lg flex items-center justify-center transition-colors text-xs md:text-sm whitespace-nowrap shrink-0 border border-gray-200 dark:border-gray-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
            >
              <span>Analyze Prompt</span>
            </button>

            <button
              type="button"
              onClick={handleSubmitClick}
              disabled={isLoading || !hasPromptText}
              className="bg-blue-600 hover:bg-blue-700 disabled:bg-gray-300 dark:disabled:bg-gray-700 disabled:text-gray-500 dark:disabled:text-gray-400 disabled:cursor-not-allowed text-white font-semibold py-2 px-4 min-h-[40px] rounded-lg flex items-center justify-center gap-2 transition-colors text-xs md:text-sm whitespace-nowrap shrink-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-2 dark:focus-visible:ring-offset-gray-800"
            >
              {isGenerating && (
                <svg
                  className="animate-spin h-4 w-4 text-white"
                  xmlns="http://www.w3.org/2000/svg"
                  fill="none"
                  viewBox="0 0 24 24"
                  aria-hidden="true"
                >
                  <circle
                    className="opacity-25"
                    cx="12"
                    cy="12"
                    r="10"
                    stroke="currentColor"
                    strokeWidth="4"
                  />
                  <path
                    className="opacity-75"
                    fill="currentColor"
                    d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
                  />
                </svg>
              )}
              <span>{isFirstRun ? 'Generate' : 'Regenerate'}</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

export default PromptInput;
