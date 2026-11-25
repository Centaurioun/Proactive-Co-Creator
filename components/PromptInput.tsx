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
  compiledPromptLength?: number;
  maxPromptChars?: number;
}

const PromptInput: React.FC<PromptInputProps> = ({
  prompt,
  setPrompt,
  onSubmit,
  onAnalyze,
  isLoading,
  isGenerating,
  mode,
  setMode,
  compiledPromptLength,
  maxPromptChars = 8000,
}) => {
  const [validationError, setValidationError] = useState<string | null>(null);
  const hasPromptText = prompt.trim().length > 0;
  const effectiveLength = compiledPromptLength ?? prompt.trim().length;
  const isOverLimit = effectiveLength > maxPromptChars;

  const handleAnalyzeClick = (e: React.MouseEvent) => {
    e.preventDefault();
    if (!hasPromptText) {
      setValidationError('Enter a story or scene idea before analyzing.');
      return;
    }
    setValidationError(null);
    onAnalyze();
  };

  const handleSubmitClick = (e: React.MouseEvent) => {
    e.preventDefault();
    if (!hasPromptText) {
      setValidationError('Enter a story or scene idea before generating.');
      return;
    }
    setValidationError(null);
    onSubmit();
  };

  return (
    <div className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-lg px-3 py-2 flex flex-col gap-1.5 flex-shrink-0">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-1.5">
          <label
            htmlFor="prompt-textarea"
            className="font-display text-xs font-bold text-gray-900 dark:text-gray-100 whitespace-nowrap"
          >
            Original Story / Scene Seed
          </label>
          <span aria-hidden="true" className="text-gray-300 dark:text-gray-700">
            ·
          </span>
          <span
            className={`max-w-[48vw] break-words text-right text-[11px] font-mono tabular-nums leading-tight sm:max-w-none sm:whitespace-nowrap ${
              isOverLimit
                ? 'text-red-600 dark:text-red-400 font-semibold'
                : 'text-gray-500 dark:text-gray-400'
            }`}
            title="Seed characters and compiled prompt character limit (max 8,000 chars)"
          >
            {prompt.length.toLocaleString()} seed · {effectiveLength.toLocaleString()}/{maxPromptChars.toLocaleString()} compiled chars
          </span>
        </div>

        <div className="flex flex-wrap items-center gap-1.5">
          <div
            role="group"
            aria-label="Workspace mode"
            className="flex bg-gray-100 dark:bg-gray-800 p-0.5 rounded-md border border-gray-200 dark:border-gray-700"
          >
            <button
              type="button"
              onClick={() => setMode('story')}
              disabled={isLoading}
              aria-pressed={mode === 'story'}
              className={`px-2 py-0.5 text-xs font-semibold rounded transition-colors whitespace-nowrap ${
                mode === 'story'
                  ? 'bg-white dark:bg-gray-900 text-blue-600 dark:text-blue-400 shadow-xs'
                  : 'text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white'
              }`}
            >
              Story Mode
            </button>
            <button
              type="button"
              onClick={() => setMode('image')}
              disabled={isLoading}
              aria-pressed={mode === 'image'}
              className={`px-2 py-0.5 text-xs font-semibold rounded transition-colors whitespace-nowrap ${
                mode === 'image'
                  ? 'bg-white dark:bg-gray-900 text-blue-600 dark:text-blue-400 shadow-xs'
                  : 'text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white'
              }`}
            >
              Image Mode
            </button>
          </div>

          <button
            type="button"
            onClick={handleAnalyzeClick}
            disabled={isLoading || !hasPromptText}
            className="px-2.5 py-1 text-xs font-semibold rounded-md bg-gray-100 hover:bg-gray-200 dark:bg-gray-800 dark:hover:bg-gray-700 text-gray-900 dark:text-gray-100 border border-gray-300 dark:border-gray-700 transition-colors whitespace-nowrap disabled:opacity-50"
          >
            Reanalyze Idea
          </button>

          <button
            type="button"
            onClick={handleSubmitClick}
            disabled={isLoading || !hasPromptText}
            className="px-2.5 py-1 text-xs font-semibold rounded-md bg-blue-600 hover:bg-blue-700 text-white transition-colors whitespace-nowrap disabled:opacity-50"
          >
            {isGenerating
              ? 'Generating...'
              : mode === 'story'
                ? 'Generate Story'
                : 'Generate Images'}
          </button>
        </div>
      </div>

      <textarea
        id="prompt-textarea"
        rows={2}
        value={prompt}
        onChange={(e) => {
          setPrompt(e.target.value);
          if (validationError && e.target.value.trim().length > 0) {
            setValidationError(null);
          }
        }}
        placeholder="Describe your story or scene idea (e.g. A cat hosting a party for its animal friends, sitting around a table eating and chatting)..."
        className="w-full bg-gray-50 dark:bg-gray-800 border border-gray-300 dark:border-gray-700 rounded-md px-3 py-2 text-xs sm:text-sm text-gray-900 dark:text-gray-100 placeholder:text-gray-400 focus:ring-2 focus:ring-blue-500 focus:outline-none resize-none leading-relaxed"
        disabled={isLoading}
        aria-invalid={Boolean(validationError)}
      />

      {validationError && (
        <p className="text-xs font-medium text-red-600 dark:text-red-400" role="alert">
          {validationError}
        </p>
      )}
    </div>
  );
};

export default PromptInput;
