/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useEffect, useState } from 'react';
import type { GenerationMode } from '../shared/types';

interface OutputDisplayProps {
  images: string[];
  imageWarning?: string | null;
  story: string | null;
  video: string | null;
  mode: GenerationMode;
  isLoading: boolean;
  statusMessage?: string | null;
  error: string | null;
  isOutdated: boolean;
}

const OutputDisplay: React.FC<OutputDisplayProps> = ({
  images,
  imageWarning,
  story,
  video,
  mode,
  isLoading,
  statusMessage,
  error,
  isOutdated,
}) => {
  const [selectedImage, setSelectedImage] = useState<string | null>(null);
  const [copiedStory, setCopiedStory] = useState(false);
  const placeholderCount = 4;

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
    if (!story) return;
    const element = document.createElement('a');
    const file = new Blob([story], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(file);
    element.href = url;
    element.download = 'generated_story.txt';
    document.body.appendChild(element);
    element.click();
    document.body.removeChild(element);
    setTimeout(() => URL.revokeObjectURL(url), 100);
  };

  const copyStory = async () => {
    if (!story) return;
    try {
      await navigator.clipboard.writeText(story);
      setCopiedStory(true);
      setTimeout(() => setCopiedStory(false), 2000);
    } catch {
      setCopiedStory(false);
    }
  };

  const renderImageContent = () => {
    if (isLoading) {
      return Array(placeholderCount)
        .fill(null)
        .map((_, index) => (
          <div
            key={index}
            className="aspect-square bg-gray-100 dark:bg-gray-700 rounded-lg flex items-center justify-center border border-gray-200 dark:border-gray-600"
          >
            <div className="flex flex-col items-center text-gray-500 dark:text-gray-300">
              <svg
                className="animate-spin h-7 w-7 text-blue-600 dark:text-blue-400"
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
              <span className="mt-2 text-xs font-medium">Generating...</span>
            </div>
          </div>
        ));
    }

    if (images.length > 0) {
      const content = images.map((image, index) => (
        <button
          key={index}
          type="button"
          onClick={() => setSelectedImage(image)}
          aria-label={`Preview generated image ${index + 1}`}
          className="aspect-square bg-gray-100 dark:bg-gray-700 rounded-lg overflow-hidden relative border border-gray-200 dark:border-gray-600 group cursor-zoom-in focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
        >
          <img
            src={image}
            alt={`Generated output ${index + 1}`}
            referrerPolicy="no-referrer"
            className="w-full h-full object-cover transition-transform duration-200 group-hover:scale-[1.03]"
          />
        </button>
      ));

      while (content.length < placeholderCount) {
        content.push(
          <div
            key={`missing-${content.length}`}
            className="aspect-square bg-gray-50 dark:bg-gray-800/50 rounded-lg border-2 border-dashed border-gray-200 dark:border-gray-700 flex flex-col items-center justify-center text-gray-500 dark:text-gray-400 p-3 text-center"
          >
            <svg
              xmlns="http://www.w3.org/2000/svg"
              className="h-7 w-7 mb-1.5 opacity-60"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              aria-hidden="true"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"
              />
            </svg>
            <span className="text-xs font-medium">Slot unavailable</span>
          </div>
        );
      }
      return content;
    }

    return Array(placeholderCount)
      .fill(null)
      .map((_, index) => (
        <div
          key={index}
          className="aspect-square bg-gray-50 dark:bg-gray-900/50 rounded-lg border border-gray-200 dark:border-gray-700 flex items-center justify-center"
        >
          <svg
            xmlns="http://www.w3.org/2000/svg"
            className="h-10 w-10 text-gray-300 dark:text-gray-600"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            aria-hidden="true"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={1.5}
              d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z"
            />
          </svg>
        </div>
      ));
  };

  const renderVideoContent = () => {
    if (isLoading) {
      return (
        <div
          className="h-full flex flex-col items-center justify-center text-gray-600 dark:text-gray-300 p-6 text-center"
          role="status"
          aria-live="polite"
        >
          <svg
            className="animate-spin h-9 w-9 text-blue-600 dark:text-blue-400"
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
          <span className="mt-3 text-sm font-medium">
            {statusMessage || 'Generating video...'}
          </span>
          <span className="mt-1 text-xs text-gray-500 dark:text-gray-400">
            Video synthesis typically takes 1–3 minutes.
          </span>
        </div>
      );
    }

    if (video) {
      return (
        <div className="flex flex-col items-center justify-center min-h-full w-full p-4">
          <div className="w-full max-w-lg bg-black rounded-lg overflow-hidden shadow-md border border-gray-300 dark:border-gray-700 shrink-0">
            <video controls className="w-full h-auto" src={video}>
              Your browser does not support video playback.
            </video>
          </div>
          <a
            href={video}
            download="generated-video.mp4"
            className="mt-4 inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-blue-600 hover:bg-blue-700 text-white text-sm font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
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
                d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4"
              />
            </svg>
            <span>Download Video</span>
          </a>
        </div>
      );
    }

    return (
      <div className="h-full bg-gray-50 dark:bg-gray-900/50 border border-gray-200 dark:border-gray-700 rounded-lg flex flex-col items-center justify-center text-center text-gray-500 dark:text-gray-400 p-8">
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
            d="M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z"
          />
        </svg>
        <p className="text-sm font-medium">Your generated video will appear here.</p>
      </div>
    );
  };

  const renderStoryContent = () => {
    if (isLoading) {
      return (
        <div
          className="h-full flex flex-col items-center justify-center text-gray-600 dark:text-gray-300"
          role="status"
          aria-live="polite"
        >
          <svg
            className="animate-spin h-9 w-9 text-blue-600 dark:text-blue-400"
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
          <span className="mt-3 text-sm font-medium">Writing story...</span>
        </div>
      );
    }

    if (story) {
      return (
        <article className="max-w-none p-5 bg-gray-50 dark:bg-gray-900/60 rounded-lg border border-gray-200 dark:border-gray-700 space-y-3 leading-relaxed text-[15px]">
          {story
            .split('\n')
            .filter((line) => line.trim().length > 0)
            .map((paragraph, index) => (
              <p key={index} className="text-gray-800 dark:text-gray-200">
                {paragraph}
              </p>
            ))}
        </article>
      );
    }

    return (
      <div className="h-full bg-gray-50 dark:bg-gray-900/50 border border-gray-200 dark:border-gray-700 rounded-lg flex flex-col items-center justify-center text-center text-gray-500 dark:text-gray-400 p-8">
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
            d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"
          />
        </svg>
        <p className="text-sm font-medium">Your creative story will appear here.</p>
      </div>
    );
  };

  const renderError = () => (
    <div
      className="h-full bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg flex flex-col items-center justify-center p-6 text-center"
      role="alert"
    >
      <svg
        xmlns="http://www.w3.org/2000/svg"
        className="h-11 w-11 text-red-500 dark:text-red-400"
        fill="none"
        viewBox="0 0 24 24"
        stroke="currentColor"
        aria-hidden="true"
      >
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth={2}
          d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
        />
      </svg>
      <h3 className="mt-3 font-semibold text-red-900 dark:text-red-200">Generation Failed</h3>
      <p className="mt-1.5 text-sm text-red-700 dark:text-red-300 max-w-md">{error}</p>
    </div>
  );

  return (
    <>
      <div className="bg-white dark:bg-gray-800 rounded-lg p-4 h-full border border-gray-200 dark:border-gray-700 flex flex-col relative overflow-hidden transition-colors duration-200">
        <div className="flex justify-between items-center mb-3 border-b border-gray-100 dark:border-gray-700 pb-2.5 flex-shrink-0">
          <h2 className="font-display text-base md:text-lg font-semibold text-gray-800 dark:text-gray-200">
            {mode === 'image'
              ? 'Image Generation'
              : mode === 'video'
                ? 'Video Generation'
                : 'Creative Writing'}
          </h2>

          {mode === 'story' && story && !isLoading && (
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={copyStory}
                className="px-2.5 py-1.5 rounded-md text-xs font-medium bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-200 hover:bg-gray-200 dark:hover:bg-gray-600 transition-colors flex items-center gap-1.5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
                aria-label="Copy story to clipboard"
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
                    d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z"
                  />
                </svg>
                <span>{copiedStory ? 'Copied' : 'Copy'}</span>
              </button>
              <button
                type="button"
                onClick={downloadStory}
                className="px-2.5 py-1.5 rounded-md text-xs font-medium bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-200 hover:bg-gray-200 dark:hover:bg-gray-600 transition-colors flex items-center gap-1.5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
                aria-label="Download story as text file"
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
                    d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4"
                  />
                </svg>
                <span>Download</span>
              </button>
            </div>
          )}
        </div>

        {mode === 'image' && imageWarning && !isLoading && !error && (
          <div
            className="mb-3 px-3 py-2 rounded-md bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-700 text-xs text-amber-800 dark:text-amber-200 flex-shrink-0"
            role="status"
          >
            {imageWarning}
          </div>
        )}

        <div className="flex-grow min-h-0 relative">
          {error ? (
            renderError()
          ) : mode === 'image' ? (
            <div className="h-full overflow-y-auto pr-1">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 pb-4">
                {renderImageContent()}
              </div>
            </div>
          ) : mode === 'video' ? (
            <div className="h-full overflow-y-auto pr-1">{renderVideoContent()}</div>
          ) : (
            <div className="h-full overflow-y-auto pr-1">{renderStoryContent()}</div>
          )}

          {isOutdated && !isLoading && (images.length > 0 || story || video) && (
            <div className="absolute inset-0 bg-white/60 dark:bg-gray-900/60 backdrop-blur-[2px] flex items-center justify-center z-10 rounded-lg pointer-events-none">
              <div className="bg-white dark:bg-gray-800 px-6 py-4 rounded-xl shadow-lg border border-gray-200 dark:border-gray-600 text-center pointer-events-auto">
                <div className="text-amber-500 mb-2 flex justify-center">
                  <svg
                    xmlns="http://www.w3.org/2000/svg"
                    className="h-7 w-7"
                    fill="none"
                    viewBox="0 0 24 24"
                    stroke="currentColor"
                    aria-hidden="true"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2}
                      d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"
                    />
                  </svg>
                </div>
                <h3 className="font-semibold text-gray-900 dark:text-gray-100 text-base">
                  Results Outdated
                </h3>
                <p className="text-gray-600 dark:text-gray-300 text-xs mt-1">
                  Prompt has changed. Click Regenerate to refresh.
                </p>
              </div>
            </div>
          )}
        </div>
      </div>

      {selectedImage && (
        <div
          className="fixed inset-0 z-[2000] bg-black/90 flex justify-center p-4 backdrop-blur-sm overflow-y-auto"
          onClick={() => setSelectedImage(null)}
          role="dialog"
          aria-modal="true"
          aria-label="Image full preview"
        >
          <button
            type="button"
            onClick={() => setSelectedImage(null)}
            className="fixed top-4 right-4 z-[2010] text-white/90 hover:text-white bg-black/50 hover:bg-black/70 rounded-lg p-2 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white"
            aria-label="Close image preview"
          >
            <svg
              xmlns="http://www.w3.org/2000/svg"
              className="h-6 w-6"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              aria-hidden="true"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M6 18L18 6M6 6l12 12"
              />
            </svg>
          </button>

          <div
            className="min-h-full w-full flex flex-col items-center justify-center pointer-events-none py-8 pb-20"
            onClick={(e) => e.stopPropagation()}
          >
            <img
              src={selectedImage}
              alt="Generated output full preview"
              referrerPolicy="no-referrer"
              className="max-w-full max-h-[75vh] md:max-h-[85vh] object-contain rounded-lg shadow-2xl pointer-events-auto"
            />

            <div className="mt-4 flex gap-3 pointer-events-auto flex-shrink-0">
              <a
                href={selectedImage}
                download="generated-image.png"
                className="bg-white text-gray-900 px-5 py-2.5 rounded-lg font-semibold hover:bg-gray-100 transition-colors flex items-center gap-2 shadow-lg text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
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
                    d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4"
                  />
                </svg>
                <span>Download Image</span>
              </a>
            </div>
          </div>
        </div>
      )}
    </>
  );
};

export default OutputDisplay;
