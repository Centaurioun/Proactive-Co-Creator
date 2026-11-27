/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useEffect, useRef, useState } from 'react';
import type {
  AiPolishProposal,
  GenerationArtifact,
  GenerationMode,
} from '../shared/types';
import GeneratedOutputView from './output/GeneratedOutputView';
import PolishProposalBanner from './output/PolishProposalBanner';
import PromptNotesView from './output/PromptNotesView';
import {
  resolveActiveArtifactSelection,
  shouldCloseLightbox,
  shouldResetArtifactSelection,
} from './output/outputGalleryHelpers';

export {
  resolveActiveArtifactSelection,
  shouldCloseLightbox,
  shouldResetArtifactSelection,
};

interface OutputDisplayProps {
  originalIdea: string;
  refinedPrompt: string;
  freeformNotes: string;
  onChangeFreeformNotes: (notes: string) => void;
  onPolishPromptWithAi?: () => void;
  polishAvailability?: { eligible: boolean; reason?: string };
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
  storyProviderSelection: { connectionId: string; modelId?: string; reasoningLevel?: string };
  storyBlockReason?: string | null;
  storyProviderUsage: { storyText: string; usage: { inputTokens?: number; outputTokens?: number; source: 'provider-observed' | 'estimate' | 'unknown' } } | null;
  mode: GenerationMode;
  isLoading: boolean;
  error: string | null;
  isOutdated: boolean;
  onGenerate: () => void;
  onAdoptStory?: (artifactId: string) => void;
}

const OutputDisplay: React.FC<OutputDisplayProps> = ({
  originalIdea,
  refinedPrompt,
  freeformNotes,
  onChangeFreeformNotes,
  onPolishPromptWithAi,
  polishAvailability = { eligible: false, reason: 'Prompt refinement is not currently eligible.' },
  isPolishingPrompt = false,
  polishProposal = null,
  isPolishStale = false,
  polishStaleReason = null,
  onAcceptPolishProposal,
  onRejectPolishProposal,
  artifacts = [],
  onAdoptStory,
  images,
  imageWarning,
  story,
  storyProviderSelection,
  storyBlockReason = null,
  storyProviderUsage,
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
  const [prevArtifactIds, setPrevArtifactIds] = useState<string[]>(() => artifacts.map((a) => a.id));

  const currentArtifactIds = artifacts.map((a) => a.id);
  if (
    currentArtifactIds.length !== prevArtifactIds.length ||
    currentArtifactIds.some((id, idx) => id !== prevArtifactIds[idx])
  ) {
    setPrevArtifactIds(currentArtifactIds);
    if (shouldResetArtifactSelection(prevArtifactIds, currentArtifactIds, selectedArtifactId)) {
      setSelectedArtifactId(null);
    }
  }

  const { modeArtifacts, activeArtifact } = resolveActiveArtifactSelection(
    artifacts,
    mode,
    selectedArtifactId
  );
  const displayedStory =
    mode === 'story' ? (activeArtifact?.storyText ?? story) : story;
  const displayedImages =
    mode === 'image' ? (activeArtifact?.images ?? images) : images;
  const displayedOutdated = activeArtifact ? activeArtifact.isOutdated : isOutdated;

  if (shouldCloseLightbox(mode, displayedImages, selectedImage)) {
    setSelectedImage(null);
  }

  const chatGptStorySelected = mode === 'story' && storyProviderSelection.connectionId === 'chatgpt-plan';
  const chatGptStoryBlocked = mode === 'story' && Boolean(storyBlockReason);
  const chatGptStoryBlockReason = storyBlockReason ?? '';

  const previousFocusRef = useRef<HTMLElement | null>(null);
  const lightboxDialogRef = useRef<HTMLDivElement | null>(null);
  const lightboxCloseRef = useRef<HTMLButtonElement | null>(null);
  const copyStoryTimerRef = useRef<number | null>(null);
  const copyPromptTimerRef = useRef<number | null>(null);
  const downloadUrlTimerRef = useRef<{ timer: number; url: string } | null>(null);

  useEffect(() => {
    return () => {
      if (copyStoryTimerRef.current !== null) window.clearTimeout(copyStoryTimerRef.current);
      if (copyPromptTimerRef.current !== null) window.clearTimeout(copyPromptTimerRef.current);
      if (downloadUrlTimerRef.current !== null) {
        window.clearTimeout(downloadUrlTimerRef.current.timer);
        URL.revokeObjectURL(downloadUrlTimerRef.current.url);
      }
    };
  }, []);

  const lightboxOpen = Boolean(selectedImage);
  useEffect(() => {
    if (!lightboxOpen) return;
    previousFocusRef.current =
      document.activeElement instanceof HTMLElement ? document.activeElement : null;
    lightboxCloseRef.current?.focus();

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        setSelectedImage(null);
        return;
      }
      if (event.key === 'Tab' && lightboxDialogRef.current) {
        const focusables = lightboxDialogRef.current.querySelectorAll<HTMLElement>(
          'a[href], button:not([disabled]), [tabindex]:not([tabindex="-1"])'
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
    window.addEventListener('keydown', handleKeyDown);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      previousFocusRef.current?.focus();
    };
  }, [lightboxOpen]);

  const downloadStory = () => {
    if (!displayedStory) return;
    if (downloadUrlTimerRef.current !== null) {
      window.clearTimeout(downloadUrlTimerRef.current.timer);
      URL.revokeObjectURL(downloadUrlTimerRef.current.url);
    }
    const element = document.createElement('a');
    const file = new Blob([displayedStory], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(file);
    element.href = url;
    element.download = 'generated_story.txt';
    document.body.appendChild(element);
    element.click();
    document.body.removeChild(element);
    const timer = window.setTimeout(() => {
      URL.revokeObjectURL(url);
      if (downloadUrlTimerRef.current?.timer === timer) {
        downloadUrlTimerRef.current = null;
      }
    }, 100);
    downloadUrlTimerRef.current = { timer, url };
  };

  const copyStory = async () => {
    if (!displayedStory) return;
    try {
      await navigator.clipboard.writeText(displayedStory);
      setCopiedStory(true);
      if (copyStoryTimerRef.current !== null) window.clearTimeout(copyStoryTimerRef.current);
      copyStoryTimerRef.current = window.setTimeout(() => {
        setCopiedStory(false);
        copyStoryTimerRef.current = null;
      }, 2000);
    } catch {
      setCopiedStory(false);
    }
  };

  const copyRefinedPrompt = async () => {
    try {
      await navigator.clipboard.writeText(refinedPrompt);
      setCopiedPrompt(true);
      if (copyPromptTimerRef.current !== null) window.clearTimeout(copyPromptTimerRef.current);
      copyPromptTimerRef.current = window.setTimeout(() => {
        setCopiedPrompt(false);
        copyPromptTimerRef.current = null;
      }, 2000);
    } catch {
      setCopiedPrompt(false);
    }
  };

  const hasDisplayedOutput =
    mode === 'story' ? Boolean(displayedStory) : displayedImages.length > 0;

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
                {displayedOutdated && hasDisplayedOutput ? ' · Outdated' : ''}
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
            {activeView === 'output' && mode === 'story' && activeArtifact?.storyText && onAdoptStory && (
              <button type="button" className="text-xs font-semibold underline"
                onClick={() => onAdoptStory(activeArtifact.id)}>Adopt in manuscript</button>
            )}
            {activeView === 'prompt' && (
              <>
                {onPolishPromptWithAi && (
                  <>
                    <button
                      type="button"
                      onClick={onPolishPromptWithAi}
                      disabled={isPolishingPrompt || !polishAvailability.eligible}
                      title={!polishAvailability.eligible ? polishAvailability.reason : undefined}
                      className="px-2.5 py-1 text-xs font-medium rounded bg-gray-100 hover:bg-gray-200 dark:bg-gray-800 dark:hover:bg-gray-700 text-gray-800 dark:text-gray-200 transition-colors whitespace-nowrap"
                    >
                      {isPolishingPrompt ? 'Polishing...' : 'AI Narrative Polish'}
                    </button>
                    {!polishAvailability.eligible && <span className="text-xs text-amber-800 dark:text-amber-300" role="status">{polishAvailability.reason}</span>}
                  </>
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
          <PolishProposalBanner
            polishProposal={polishProposal}
            isPolishStale={isPolishStale}
            polishStaleReason={polishStaleReason}
            isPolishingPrompt={isPolishingPrompt}
            onPolishPromptWithAi={onPolishPromptWithAi}
            polishAvailability={polishAvailability}
            onAcceptPolishProposal={onAcceptPolishProposal}
            onRejectPolishProposal={onRejectPolishProposal}
          />
        )}

        {activeView === 'prompt' ? (
          <PromptNotesView
            originalIdea={originalIdea}
            refinedPrompt={refinedPrompt}
            freeformNotes={freeformNotes}
            onChangeFreeformNotes={onChangeFreeformNotes}
          />
        ) : (
          <GeneratedOutputView
            mode={mode}
            isLoading={isLoading}
            error={error}
            displayedOutdated={displayedOutdated}
            displayedStory={displayedStory}
            displayedImages={displayedImages}
            imageWarning={imageWarning}
            storyProviderSelection={storyProviderSelection}
            chatGptStorySelected={chatGptStorySelected}
            chatGptStoryBlocked={chatGptStoryBlocked}
            chatGptStoryBlockReason={chatGptStoryBlockReason}
            storyProviderUsage={storyProviderUsage}
            onGenerate={onGenerate}
            onSelectImage={setSelectedImage}
          />
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
            ref={lightboxDialogRef}
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
                className="bg-white text-gray-900 px-4 py-2 rounded-lg font-semibold hover:bg-gray-100 text-xs focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
              >
                Download Image
              </a>
              <button
                ref={lightboxCloseRef}
                type="button"
                onClick={() => setSelectedImage(null)}
                className="bg-gray-800 text-white px-4 py-2 rounded-lg font-semibold hover:bg-gray-700 text-xs focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
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
