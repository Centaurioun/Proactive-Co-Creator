/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import type { GenerationMode } from '../../shared/types';

interface StoryProviderUsage {
  storyText: string;
  usage: {
    inputTokens?: number;
    outputTokens?: number;
    source: 'provider-observed' | 'estimate' | 'unknown';
  };
}

interface GeneratedOutputViewProps {
  mode: GenerationMode;
  isLoading: boolean;
  error: string | null;
  displayedOutdated: boolean;
  displayedStory: string | null;
  displayedImages: string[];
  imageWarning?: string | null;
  storyProviderSelection: { connectionId: string; modelId?: string; reasoningLevel?: string };
  chatGptStorySelected: boolean;
  chatGptStoryBlocked: boolean;
  chatGptStoryBlockReason: string;
  storyProviderUsage: StoryProviderUsage | null;
  onGenerate: () => void;
  onSelectImage: (image: string) => void;
}

const PLACEHOLDER_COUNT = 4;

const StoryBody: React.FC<{
  isLoading: boolean;
  displayedStory: string | null;
  chatGptStoryBlocked: boolean;
  chatGptStoryBlockReason: string;
  storyProviderSelection: { connectionId: string };
  storyProviderUsage: StoryProviderUsage | null;
  onGenerate: () => void;
}> = ({
  isLoading,
  displayedStory,
  chatGptStoryBlocked,
  chatGptStoryBlockReason,
  storyProviderSelection,
  storyProviderUsage,
  onGenerate,
}) => {
  if (isLoading) {
    return (
      <div className="py-8 text-center text-xs font-medium text-gray-600 dark:text-gray-300">
        Writing story from your confirmed Story Bible and Belief Graph...
      </div>
    );
  }
  if (!displayedStory) {
    return (
      <div className="p-6 text-center rounded-md border border-gray-200 dark:border-gray-800 bg-gray-50/50 dark:bg-gray-950/40 flex flex-col items-center justify-center gap-2">
        <p className="text-xs text-gray-600 dark:text-gray-400">
          No story generated yet. Confirm your creative decisions or click Generate Story when ready.
        </p>
        <button
          type="button"
          onClick={onGenerate}
          disabled={chatGptStoryBlocked}
          title={chatGptStoryBlocked ? chatGptStoryBlockReason : undefined}
          className="px-3.5 py-1.5 text-xs font-semibold bg-blue-600 hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50 text-white rounded-md transition-colors"
        >
          Generate Story from Confirmed Plan
        </button>
        {chatGptStoryBlocked && chatGptStoryBlockReason && (
          <p className="text-xs text-amber-900 dark:text-amber-200" role="status">{chatGptStoryBlockReason}</p>
        )}
      </div>
    );
  }
  return (
    <article className="p-4 bg-gray-50 dark:bg-gray-950/60 rounded-md border border-gray-200 dark:border-gray-800 space-y-2.5 leading-relaxed text-sm text-gray-800 dark:text-gray-200">
      {displayedStory
        .split('\n')
        .filter((line) => line.trim().length > 0)
        .map((paragraph, index) => (
          <p key={index}>{paragraph}</p>
        ))}
      {storyProviderSelection.connectionId === 'chatgpt-plan' &&
        storyProviderUsage &&
        displayedStory === storyProviderUsage.storyText && (
          <p className="border-t border-gray-200 pt-2 text-xs text-gray-600 dark:border-gray-700 dark:text-gray-300">
            {storyProviderUsage.usage.source === 'provider-observed'
              ? `Provider-observed usage: input ${storyProviderUsage.usage.inputTokens ?? 'not reported'} tokens; output ${storyProviderUsage.usage.outputTokens ?? 'not reported'} tokens.`
              : 'The provider did not report token usage for this response.'}
          </p>
        )}
    </article>
  );
};

const ImageGridBody: React.FC<{
  isLoading: boolean;
  displayedImages: string[];
  onSelectImage: (image: string) => void;
}> = ({ isLoading, displayedImages, onSelectImage }) => {
  if (isLoading) {
    return (
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {Array.from({ length: PLACEHOLDER_COUNT }, (_, index) => (
          <div
            key={index}
            className="aspect-square bg-gray-100 dark:bg-gray-800 rounded-md flex items-center justify-center border border-gray-200 dark:border-gray-700 text-xs text-gray-500"
          >
            Generating...
          </div>
        ))}
      </div>
    );
  }
  if (displayedImages.length > 0) {
    return (
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {displayedImages.map((image, index) => (
          <button
            key={index}
            type="button"
            onClick={() => onSelectImage(image)}
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
        ))}
      </div>
    );
  }
  return (
    <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
      {Array.from({ length: PLACEHOLDER_COUNT }, (_, index) => (
        <div
          key={index}
          className="aspect-square bg-gray-50 dark:bg-gray-950/50 rounded-md border border-gray-200 dark:border-gray-800 flex items-center justify-center text-xs text-gray-400 p-2 text-center"
        >
          Image Slot {index + 1} (Explicit user trigger required)
        </div>
      ))}
    </div>
  );
};

const GeneratedOutputView: React.FC<GeneratedOutputViewProps> = ({
  mode,
  isLoading,
  error,
  displayedOutdated,
  displayedStory,
  displayedImages,
  imageWarning,
  storyProviderSelection,
  chatGptStorySelected,
  chatGptStoryBlocked,
  chatGptStoryBlockReason,
  storyProviderUsage,
  onGenerate,
  onSelectImage,
}) => {
  return (
    <div className="flex-1 overflow-y-auto min-h-0 relative">
      {mode === 'story' && (
        <div
          className="mb-3 rounded-md border border-gray-200 bg-gray-50 px-3 py-2 text-xs text-gray-700 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-200"
          role="status"
        >
          <p className="font-semibold">
            Effective Story route:{' '}
            {storyProviderSelection.connectionId === 'chatgpt-plan'
              ? 'ChatGPT plan'
              : storyProviderSelection.connectionId}{' '}
            · model {storyProviderSelection.modelId ?? 'provider default / not selected'} · reasoning{' '}
            {storyProviderSelection.reasoningLevel ?? 'not selected'}.
          </p>
          {chatGptStorySelected && (
            <>
              <p className="mt-1">
                A request may consume included ChatGPT allowance or eligible credits. Failed, cancelled, incomplete, or uncertain requests may still count. PCC will not retry, continue, or fall back to Gemini or API billing; local cancellation may not stop work already received upstream.
              </p>
              <p className="mt-1">
                {chatGptStoryBlocked ? chatGptStoryBlockReason : 'This local server is enabled for explicit Story requests.'}
              </p>
            </>
          )}
        </div>
      )}
      {displayedOutdated && !isLoading && (displayedImages.length > 0 || displayedStory) && (
        <div className="mb-2.5 px-3 py-2 rounded-md bg-amber-50 dark:bg-amber-950/50 border border-amber-300 dark:border-amber-800 flex items-center justify-between gap-2 text-xs text-amber-900 dark:text-amber-200">
          <span>
            Story plan has been updated since this output was generated. Previous output is preserved below.
          </span>
          <button
            type="button"
            onClick={onGenerate}
            disabled={chatGptStoryBlocked}
            className="px-2.5 py-1 font-semibold bg-amber-600 hover:bg-amber-700 disabled:cursor-not-allowed disabled:opacity-50 text-white rounded whitespace-nowrap"
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
        <StoryBody
          isLoading={isLoading}
          displayedStory={displayedStory}
          chatGptStoryBlocked={chatGptStoryBlocked}
          chatGptStoryBlockReason={chatGptStoryBlockReason}
          storyProviderSelection={storyProviderSelection}
          storyProviderUsage={storyProviderUsage}
          onGenerate={onGenerate}
        />
      ) : (
        <ImageGridBody
          isLoading={isLoading}
          displayedImages={displayedImages}
          onSelectImage={onSelectImage}
        />
      )}
    </div>
  );
};

export default GeneratedOutputView;
