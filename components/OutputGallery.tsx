/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useEffect, useState } from 'react';
import type {
  AiPolishProposal,
  GenerationArtifact,
  GenerationMode,
} from '../shared/types';

interface OutputDisplayProps {
  originalIdea: string;
  refinedPrompt: string;
  freeformNotes: string;
  onChangeFreeformNotes: (notes: string) => void;
  onPolishPromptWithAi?: () => void;
  isPolishingPrompt?: boolean;
  polishProposal?: AiPolishProposal | null;
  isPolishStale?: boolean;
  polishStaleReason?: string | null;
  onAcceptPolishProposal?: () => void;
  onRejectPolishProposal?: () => void;
  artifacts?: GenerationArtifact[];
  images: string[];
  imageWarning?: string | null;
  story: string | null;
  mode: GenerationMode;
  isLoading: boolean;
  error: string | null;
  isOutdated: boolean;
  onGenerate: () => void;
}

const OutputDisplay: React.FC<OutputDisplayProps> = ({
  originalIdea,
  refinedPrompt,
  freeformNotes,
  onChangeFreeformNotes,
  onPolishPromptWithAi,
  isPolishingPrompt = false,
  polishProposal = null,
  isPolishStale = false,
  polishStaleReason = null,
  onAcceptPolishProposal,
  onRejectPolishProposal,
  artifacts = [],
  images,
  imageWarning,
  story,
  mode,
  isLoading,
  error,
  isOutdated,
  onGenerate,
}) => {
  const [selectedImage, setSelectedImage] = useState<string | null>(null);
  const [copiedStory, setCopiedStory] = useState(false);
  const [copiedPrompt, setCopiedPrompt] = useState(false);
  const [activeView, setActiveView] = useState<'prompt' | 'output'>('output');
  const [selectedArtifactId, setSelectedArtifactId] = useState<string | null>(null);
  const placeholderCount = 4;

  const modeArtifacts = artifacts.filter((a) => a.mode === mode);
  const activeArtifact =
    modeArtifacts.find((a) => a.id === selectedArtifactId) ?? modeArtifacts[0] ?? null;
  const displayedStory =
    mode === 'story' ? (activeArtifact?.storyText ?? story) : story;
  const displayedImages =
    mode === 'image' ? (activeArtifact?.images ?? images) : images;
  const displayedOutdated = activeArtifact ? activeArtifact.isOutdated : isOutdated;

  useEffect(() => {
    if (!selectedImage) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setSelectedImage(null);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [selectedImage]);

  const downloadStory = () => {
    if (!displayedStory) return;
    const element = document.createElement('a');
    const file = new Blob([displayedStory], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(file);
    element.href = url;
    element.download = 'generated_story.txt';
    document.body.appendChild(element);
    element.click();
    document.body.removeChild(element);
    setTimeout(() => URL.revokeObjectURL(url), 100);
  };

  const copyStory = async () => {
    if (!displayedStory) return;
    try {
      await navigator.clipboard.writeText(displayedStory);
      setCopiedStory(true);
      setTimeout(() => setCopiedStory(false), 2000);
    } catch {
      setCopiedStory(false);
    }
  };

  const copyRefinedPrompt = async () => {
    try {
      await navigator.clipboard.writeText(refinedPrompt);
      setCopiedPrompt(true);
      setTimeout(() => setCopiedPrompt(false), 2000);
    } catch {
      setCopiedPrompt(false);
    }
  };

  return (
    <>
      <div className="bg-white dark:bg-gray-900 rounded-lg p-3.5 h-full border border-gray-200 dark:border-gray-800 flex flex-col relative overflow-hidden">
        {/* Header Bar */}
        <div className="flex flex-wrap justify-between items-center gap-2 mb-3 border-b border-gray-200 dark:border-gray-800 pb-2 flex-shrink-0">
          <div className="flex items-center gap-2">
            <div
              role="tablist"
              aria-label="Prompt and Generated Output views"
              className="flex bg-gray-100 dark:bg-gray-800 p-0.5 rounded-md"
            >
              <button
                type="button"
                role="tab"
                aria-selected={activeView === 'output'}
                onClick={() => setActiveView('output')}
                className={`px-3 py-1 text-xs font-semibold rounded transition-colors whitespace-nowrap ${
                  activeView === 'output'
                    ? 'bg-white dark:bg-gray-900 text-blue-600 dark:text-blue-400 shadow-xs'
                    : 'text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white'
                }`}
              >
                {mode === 'story' ? 'Generated Story' : 'Generated Images'}
                {isOutdated && (story || images.length > 0) ? ' · Outdated' : ''}
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={activeView === 'prompt'}
                onClick={() => setActiveView('prompt')}
                className={`px-3 py-1 text-xs font-semibold rounded transition-colors whitespace-nowrap ${
                  activeView === 'prompt'
                    ? 'bg-white dark:bg-gray-900 text-blue-600 dark:text-blue-400 shadow-xs'
                    : 'text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white'
                }`}
              >
                Refined Prompt &amp; Notes
              </button>
            </div>
          </div>

          <div className="flex items-center gap-2">
            {activeView === 'prompt' && (
              <>
                {onPolishPromptWithAi && (
                  <button
                    type="button"
                    onClick={onPolishPromptWithAi}
                    disabled={isPolishingPrompt}
                    className="px-2.5 py-1 text-xs font-medium rounded bg-gray-100 hover:bg-gray-200 dark:bg-gray-800 dark:hover:bg-gray-700 text-gray-800 dark:text-gray-200 transition-colors whitespace-nowrap"
                  >
                    {isPolishingPrompt ? 'Polishing...' : 'AI Narrative Polish'}
                  </button>
                )}
                <button
                  type="button"
                  onClick={copyRefinedPrompt}
                  className="px-2.5 py-1 text-xs font-medium rounded bg-gray-100 hover:bg-gray-200 dark:bg-gray-800 dark:hover:bg-gray-700 text-gray-800 dark:text-gray-200 transition-colors whitespace-nowrap"
                >
                  {copiedPrompt ? 'Copied Prompt' : 'Copy Prompt'}
                </button>
              </>
            )}

            {activeView === 'output' && modeArtifacts.length > 1 && (
              <select
                aria-label="Select generation history artifact"
                value={activeArtifact?.id ?? ''}
                onChange={(e) => setSelectedArtifactId(e.target.value)}
                className="text-xs bg-gray-100 dark:bg-gray-800 border border-gray-300 dark:border-gray-700 rounded px-2 py-1 text-gray-800 dark:text-gray-200"
              >
                {modeArtifacts.map((art, idx) => (
                  <option key={art.id} value={art.id}>
                    Run #{modeArtifacts.length - idx} (Rev {art.sourceRevision ?? 1}){' '}
                    {art.isOutdated ? '· Outdated' : '· Current'}
                  </option>
                ))}
              </select>
            )}

            {activeView === 'output' && mode === 'story' && displayedStory && !isLoading && (
              <>
                <button
                  type="button"
                  onClick={copyStory}
                  className="px-2.5 py-1 rounded text-xs font-medium bg-gray-100 dark:bg-gray-800 text-gray-700 dark:text-gray-200 hover:bg-gray-200 dark:hover:bg-gray-700 transition-colors"
                >
                  {copiedStory ? 'Copied' : 'Copy Story'}
                </button>
                <button
                  type="button"
                  onClick={downloadStory}
                  className="px-2.5 py-1 rounded text-xs font-medium bg-gray-100 dark:bg-gray-800 text-gray-700 dark:text-gray-200 hover:bg-gray-200 dark:hover:bg-gray-700 transition-colors"
                >
                  Download .txt
                </button>
              </>
            )}
          </div>
        </div>

        {/* Staged AI Polish Proposal Banner */}
        {polishProposal && (
          <div
            role="region"
            aria-label="Staged AI Polish Proposal"
            className={`mb-3 p-3 rounded-md border space-y-2 flex-shrink-0 ${
              isPolishStale
                ? 'bg-amber-50/90 dark:bg-amber-950/50 border-amber-300 dark:border-amber-800'
                : 'bg-indigo-50/80 dark:bg-indigo-950/50 border-indigo-300 dark:border-indigo-800'
            }`}
          >
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span
                className={`text-xs font-bold ${
                  isPolishStale
                    ? 'text-amber-900 dark:text-amber-200'
                    : 'text-indigo-900 dark:text-indigo-200'
                }`}
              >
                {isPolishStale
                  ? 'Stale AI Polish Proposal — Story Plan Changed Since Proposal'
                  : 'Staged AI Narrative Polish Proposal (Review Before Applying)'}
              </span>
              <div className="flex items-center gap-1.5">
                {isPolishStale && onPolishPromptWithAi && (
                  <button
                    type="button"
                    onClick={onPolishPromptWithAi}
                    disabled={isPolishingPrompt}
                    className="px-2.5 py-1 text-xs font-semibold rounded bg-amber-600 hover:bg-amber-700 text-white"
                  >
                    {isPolishingPrompt ? 'Re-polishing...' : 'Re-polish Current Prompt'}
                  </button>
                )}
                {onAcceptPolishProposal && !isPolishStale && (
                  <button
                    type="button"
                    onClick={onAcceptPolishProposal}
                    className="px-2.5 py-1 text-xs font-semibold rounded bg-indigo-600 hover:bg-indigo-700 text-white"
                  >
                    Accept Polished Prompt
                  </button>
                )}
                {onRejectPolishProposal && (
                  <button
                    type="button"
                    onClick={onRejectPolishProposal}
                    className="px-2.5 py-1 text-xs font-medium rounded bg-white dark:bg-gray-800 text-gray-700 dark:text-gray-300 border border-gray-300 dark:border-gray-700 hover:bg-gray-100"
                  >
                    Discard Proposal
                  </button>
                )}
              </div>
            </div>
            {isPolishStale && polishStaleReason && (
              <p className="text-xs text-amber-800 dark:text-amber-300" role="alert">
                {polishStaleReason}
              </p>
            )}
            <pre className="p-2 rounded bg-white dark:bg-gray-900 border border-indigo-200 dark:border-indigo-900 text-xs text-gray-800 dark:text-gray-200 whitespace-pre-wrap font-mono max-h-28 overflow-y-auto">
              {polishProposal.polishedPrompt || polishProposal.proposedPrompt}
            </pre>
          </div>
        )}

        {/* View 1: Refined Prompt & Author Notes */}
        {activeView === 'prompt' ? (
          <div className="flex-1 overflow-y-auto grid grid-cols-1 lg:grid-cols-2 gap-3 min-h-0">
            <div className="flex flex-col gap-1.5">
              <div className="text-xs font-semibold text-gray-800 dark:text-gray-200 flex items-center justify-between">
                <span>Derived Refined Prompt (From Confirmed Decisions)</span>
                <span className="text-[11px] font-normal text-gray-500">
                  Original idea: &ldquo;{originalIdea.slice(0, 38)}...&rdquo;
                </span>
              </div>
              <pre className="flex-1 p-3 rounded-md bg-gray-50 dark:bg-gray-950 border border-gray-200 dark:border-gray-800 text-xs text-gray-800 dark:text-gray-200 whitespace-pre-wrap font-mono leading-relaxed overflow-y-auto">
                {refinedPrompt}
              </pre>
            </div>

            <div className="flex flex-col gap-1.5">
              <label
                htmlFor="freeform-author-notes"
                className="text-xs font-semibold text-gray-800 dark:text-gray-200"
              >
                Freeform Author Notes (Preserved Across AI Reanalysis)
              </label>
              <textarea
                id="freeform-author-notes"
                value={freeformNotes}
                onChange={(e) => onChangeFreeformNotes(e.target.value)}
                placeholder="Add custom dialogue snippets, stylistic instructions, or pacing notes that AI reanalysis must never overwrite..."
                className="flex-1 min-h-[90px] p-2.5 rounded-md bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-700 text-xs text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none"
              />
            </div>
          </div>
        ) : (
          /* View 2: Generated Story or Images */
          <div className="flex-1 overflow-y-auto min-h-0 relative">
            {displayedOutdated && !isLoading && (displayedImages.length > 0 || displayedStory) && (
              <div className="mb-2.5 px-3 py-2 rounded-md bg-amber-50 dark:bg-amber-950/50 border border-amber-300 dark:border-amber-800 flex items-center justify-between gap-2 text-xs text-amber-900 dark:text-amber-200">
                <span>
                  Story plan has been updated since this output was generated. Previous output is preserved below.
                </span>
                <button
                  type="button"
                  onClick={onGenerate}
                  className="px-2.5 py-1 font-semibold bg-amber-600 hover:bg-amber-700 text-white rounded whitespace-nowrap"
                >
                  Regenerate Now
                </button>
              </div>
            )}

            {mode === 'image' && imageWarning && !isLoading && !error && (
              <div
                className="mb-2.5 px-3 py-2 rounded-md bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-700 text-xs text-amber-800 dark:text-amber-200"
                role="status"
              >
                {imageWarning}
              </div>
            )}

            {error ? (
              <div
                className="p-4 rounded-md bg-red-50 dark:bg-red-950/30 border border-red-200 dark:border-red-800 text-xs text-red-800 dark:text-red-200"
                role="alert"
              >
                <p className="font-semibold mb-1">Generation Failed</p>
                <p>{error}</p>
              </div>
            ) : mode === 'story' ? (
              isLoading ? (
                <div className="py-8 text-center text-xs font-medium text-gray-600 dark:text-gray-300">
                  Writing story from your confirmed Story Bible and Belief Graph...
                </div>
              ) : displayedStory ? (
                <article className="p-4 bg-gray-50 dark:bg-gray-950/60 rounded-md border border-gray-200 dark:border-gray-800 space-y-2.5 leading-relaxed text-sm text-gray-800 dark:text-gray-200">
                  {displayedStory
                    .split('\n')
                    .filter((line) => line.trim().length > 0)
                    .map((paragraph, index) => (
                      <p key={index}>{paragraph}</p>
                    ))}
                </article>
              ) : (
                <div className="p-6 text-center rounded-md border border-gray-200 dark:border-gray-800 bg-gray-50/50 dark:bg-gray-950/40 flex flex-col items-center justify-center gap-2">
                  <p className="text-xs text-gray-600 dark:text-gray-400">
                    No story generated yet. Confirm your creative decisions or click Generate Story when ready.
                  </p>
                  <button
                    type="button"
                    onClick={onGenerate}
                    className="px-3.5 py-1.5 text-xs font-semibold bg-blue-600 hover:bg-blue-700 text-white rounded-md transition-colors"
                  >
                    Generate Story from Confirmed Plan
                  </button>
                </div>
              )
            ) : (
              /* Image Mode */
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                {isLoading
                  ? Array(placeholderCount)
                      .fill(null)
                      .map((_, index) => (
                        <div
                          key={index}
                          className="aspect-square bg-gray-100 dark:bg-gray-800 rounded-md flex items-center justify-center border border-gray-200 dark:border-gray-700 text-xs text-gray-500"
                        >
                          Generating...
                        </div>
                      ))
                  : displayedImages.length > 0
                    ? displayedImages.map((image, index) => (
                        <button
                          key={index}
                          type="button"
                          onClick={() => setSelectedImage(image)}
                          aria-label={`Preview generated image ${index + 1}`}
                          className="aspect-square bg-gray-100 dark:bg-gray-800 rounded-md overflow-hidden relative border border-gray-200 dark:border-gray-700 group cursor-zoom-in"
                        >
                          <img
                            src={image}
                            alt={`Generated output ${index + 1}`}
                            referrerPolicy="no-referrer"
                            className="w-full h-full object-cover"
                          />
                        </button>
                      ))
                    : Array(placeholderCount)
                        .fill(null)
                        .map((_, index) => (
                          <div
                            key={index}
                            className="aspect-square bg-gray-50 dark:bg-gray-950/50 rounded-md border border-gray-200 dark:border-gray-800 flex items-center justify-center text-xs text-gray-400 p-2 text-center"
                          >
                            Image Slot {index + 1} (Explicit user trigger required)
                          </div>
                        ))}
              </div>
            )}
          </div>
        )}
      </div>

      {selectedImage && (
        <div
          className="fixed inset-0 z-[2000] bg-black/90 flex justify-center p-4 backdrop-blur-xs overflow-y-auto"
          onClick={() => setSelectedImage(null)}
          role="dialog"
          aria-modal="true"
          aria-label="Image full preview"
        >
          <div
            className="min-h-full w-full flex flex-col items-center justify-center py-8"
            onClick={(e) => e.stopPropagation()}
          >
            <img
              src={selectedImage}
              alt="Generated output full preview"
              referrerPolicy="no-referrer"
              className="max-w-full max-h-[75vh] object-contain rounded-lg shadow-2xl"
            />
            <div className="mt-4 flex gap-3">
              <a
                href={selectedImage}
                download="generated-image.png"
                className="bg-white text-gray-900 px-4 py-2 rounded-lg font-semibold hover:bg-gray-100 text-xs"
              >
                Download Image
              </a>
              <button
                type="button"
                onClick={() => setSelectedImage(null)}
                className="bg-gray-800 text-white px-4 py-2 rounded-lg font-semibold hover:bg-gray-700 text-xs"
              >
                Close Preview
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
};

export default OutputDisplay;
