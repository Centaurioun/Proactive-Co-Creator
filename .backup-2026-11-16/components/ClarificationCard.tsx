/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect, useMemo } from 'react';
import type { Clarification } from '../shared/types';

interface ClarificationCardProps {
  clarifications: Clarification[];
  onRefresh: () => void;
  isLoading: boolean;
  error?: string | null;
  pendingAnswers: Record<string, string>;
  setPendingAnswers: React.Dispatch<React.SetStateAction<Record<string, string>>>;
  prompt?: string;
}

const ThinkingProcess: React.FC<{ prompt: string }> = ({ prompt = '' }) => {
  const [step, setStep] = useState(0);

  const steps = useMemo(() => {
    const baseSteps = [
      'Analyzing prompt for ambiguities...',
      'Identifying vague attributes...',
      'Detecting implicit entities...',
      'Evaluating semantic uncertainties...',
      'Drafting clarification questions...',
    ];

    if (prompt.length > 0) {
      const lowerPrompt = prompt.toLowerCase();
      if (lowerPrompt.includes('image') || lowerPrompt.includes('picture') || lowerPrompt.includes('scene')) {
        baseSteps.splice(1, 0, 'Scanning visual descriptors...');
      }
      if (lowerPrompt.includes('story') || lowerPrompt.includes('narrative') || lowerPrompt.includes('write')) {
        baseSteps.splice(1, 0, 'Evaluating narrative gaps...');
      }
      if (lowerPrompt.includes('video') || lowerPrompt.includes('movie')) {
        baseSteps.splice(1, 0, 'Checking temporal dynamics...');
      }
    }

    return baseSteps;
  }, [prompt]);

  useEffect(() => {
    const interval = setInterval(() => {
      setStep((s) => (s + 1) % steps.length);
    }, 2200);
    return () => clearInterval(interval);
  }, [steps]);

  return (
    <span className="text-sm font-medium text-gray-700 dark:text-gray-200 min-w-[240px] text-center">
      {steps[step]}
    </span>
  );
};

const ClarificationCard: React.FC<ClarificationCardProps> = ({
  clarifications,
  onRefresh,
  isLoading,
  error,
  pendingAnswers,
  setPendingAnswers,
  prompt = '',
}) => {
  const handleSelectOption = (question: string, option: string) => {
    setPendingAnswers((prev) => {
      if (prev[question] === option) {
        const next = { ...prev };
        delete next[question];
        return next;
      }
      return { ...prev, [question]: option };
    });
  };

  const handleCustomAnswerChange = (question: string, value: string) => {
    setPendingAnswers((prev) => {
      const next = { ...prev, [question]: value };
      if (!value.trim()) delete next[question];
      return next;
    });
  };

  return (
    <div className="bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700 transition-colors duration-200 h-full flex flex-col overflow-hidden relative">
      {isLoading && (
        <div
          className="absolute inset-0 bg-white/85 dark:bg-gray-900/85 backdrop-blur-sm flex items-center justify-center z-40 rounded-lg"
          role="status"
          aria-live="polite"
        >
          <div className="flex flex-col items-center p-6 bg-white dark:bg-gray-800 rounded-xl shadow-lg border border-gray-200 dark:border-gray-700 max-w-sm w-full mx-4">
            <svg
              className="animate-spin h-9 w-9 text-blue-600 dark:text-blue-400 mb-3"
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
            <ThinkingProcess prompt={prompt} />
          </div>
        </div>
      )}

      <div className={`flex flex-col h-full min-h-0 ${isLoading ? 'opacity-30 pointer-events-none' : ''}`}>
        {error && !isLoading ? (
          <div className="flex-grow p-4 flex flex-col items-center justify-center text-center" role="alert">
            <div className="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg p-6 max-w-md w-full">
              <p className="text-sm font-semibold text-red-800 dark:text-red-200 mb-1">
                Could not load clarifications
              </p>
              <p className="text-xs text-red-700 dark:text-red-300 mb-4">{error}</p>
              <button
                type="button"
                onClick={onRefresh}
                className="px-4 py-2 text-xs font-semibold rounded-lg bg-red-600 hover:bg-red-700 text-white transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-500"
              >
                Retry Clarifications
              </button>
            </div>
          </div>
        ) : clarifications.length === 0 && !isLoading ? (
          <div className="flex-grow p-4 flex flex-col">
            <div className="bg-gray-50 dark:bg-gray-900/50 border border-gray-200 dark:border-gray-700 rounded-lg flex flex-col items-center justify-center text-center text-gray-500 dark:text-gray-400 p-8 flex-grow">
              <svg
                xmlns="http://www.w3.org/2000/svg"
                className="h-11 w-11 mb-3 text-gray-400 dark:text-gray-500"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
                aria-hidden="true"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={1.5}
                  d="M8 10h.01M12 10h.01M16 10h.01M9 16H5a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v8a2 2 0 01-2 2h-5l-5 5v-5z"
                />
              </svg>
              <p className="text-sm font-medium">
                Clarifying questions will appear here after analyzing or generating a prompt.
              </p>
            </div>
          </div>
        ) : (
          <div className="flex flex-col h-full min-h-0">
            <div className="space-y-5 flex-grow overflow-y-auto p-4">
              {clarifications.map((item, index) => {
                const selectedAnswer = pendingAnswers[item.question] ?? '';
                const customText =
                  selectedAnswer && !item.options.includes(selectedAnswer) ? selectedAnswer : '';

                return (
                  <div
                    key={`${item.question}-${index}`}
                    className="border-b border-gray-100 dark:border-gray-700 pb-4 last:border-0 last:pb-0"
                  >
                    <p className="font-medium text-gray-900 dark:text-gray-100 mb-2.5 text-sm">
                      {item.question}
                    </p>
                    <div className="flex flex-wrap gap-2 mb-2.5" role="group" aria-label={item.question}>
                      {item.options.map((option) => {
                        const isSelected = selectedAnswer === option;
                        return (
                          <button
                            key={option}
                            type="button"
                            onClick={() => handleSelectOption(item.question, option)}
                            disabled={isLoading}
                            aria-pressed={isSelected}
                            className={`text-xs py-1.5 px-3 min-h-[34px] rounded-lg border transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 ${
                              isSelected
                                ? 'bg-blue-50 border-blue-500 text-blue-800 dark:bg-blue-900/60 dark:border-blue-400 dark:text-blue-100 font-semibold'
                                : 'bg-white border-gray-300 text-gray-700 hover:bg-gray-50 dark:bg-gray-700 dark:border-gray-600 dark:text-gray-200 dark:hover:bg-gray-600'
                            }`}
                          >
                            {option}
                          </button>
                        );
                      })}
                    </div>
                    <input
                      type="text"
                      value={customText}
                      onChange={(e) => handleCustomAnswerChange(item.question, e.target.value)}
                      placeholder="Or type a custom answer..."
                      aria-label={`Custom answer for: ${item.question}`}
                      disabled={isLoading}
                      className="w-full text-xs border border-gray-300 dark:border-gray-600 rounded-md px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 bg-gray-50 dark:bg-gray-900/50 focus:bg-white dark:focus:bg-gray-800 text-gray-900 dark:text-gray-100"
                    />
                  </div>
                );
              })}
            </div>

            {clarifications.length > 0 && (
              <div className="p-3.5 border-t border-gray-200 dark:border-gray-700 bg-gray-50/70 dark:bg-gray-800/70 flex flex-col sm:flex-row justify-between items-center gap-3 flex-shrink-0">
                <button
                  type="button"
                  onClick={onRefresh}
                  disabled={isLoading}
                  className="flex items-center gap-2 px-3.5 py-2 min-h-[38px] bg-white hover:bg-gray-100 dark:bg-gray-700 dark:hover:bg-gray-600 text-gray-800 dark:text-gray-100 rounded-lg text-xs sm:text-sm font-medium transition-colors border border-gray-300 dark:border-gray-600 disabled:opacity-50 disabled:cursor-not-allowed whitespace-nowrap shrink-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
                  title="Get different questions"
                >
                  <svg
                    xmlns="http://www.w3.org/2000/svg"
                    className="h-4 w-4"
                    fill="none"
                    viewBox="0 0 24 24"
                    stroke="currentColor"
                    aria-hidden="true"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2}
                      d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"
                    />
                  </svg>
                  <span>Refresh Questions</span>
                </button>
                <span className="text-xs text-gray-500 dark:text-gray-400 text-center sm:text-right">
                  Select options, then click &ldquo;Update Prompt&rdquo;.
                </span>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
};

export default ClarificationCard;
