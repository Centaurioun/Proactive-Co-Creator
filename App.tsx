/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useCallback, useEffect, useRef } from 'react';
import BeliefGraph from './components/BeliefGraph';
import ClarificationCard from './components/ClarificationCard';
import Header from './components/Header';
import InfoModal from './components/InfoModal';
import OutputDisplay from './components/OutputGallery';
import PromptInput from './components/PromptInput';
import { buildGraphUpdates } from './lib/pendingUpdates';
import {
  analyzePromptToBeliefGraph,
  ClientApiError,
  generateClarifications,
  generateImagesFromPrompt,
  generateStoryFromPrompt,
  generateVideoFromPrompt,
  isAbortError,
  refinePromptWithAllUpdates,
} from './services/apiClient';
import type { BeliefState, Clarification, GenerationMode } from './shared/types';

type ToolTab = 'clarify' | 'graph' | 'attributes';
type MobileView = 'editor' | 'preview';

function getReadableErrorMessage(error: unknown, fallback: string): string {
  if (error instanceof ClientApiError) return error.message;
  if (error instanceof Error && error.message) return error.message;
  return fallback;
}

function App() {
  const [prompt, setPrompt] = useState('a cat hosting a party for its animal friends');

  const [isGraphLoading, setIsGraphLoading] = useState(false);
  const [isClarificationsLoading, setIsClarificationsLoading] = useState(false);
  const [isGenerating, setIsGenerating] = useState(false);
  const [isUpdatingPrompt, setIsUpdatingPrompt] = useState(false);

  const [isOutdated, setIsOutdated] = useState(false);
  const [showModeChangePopup, setShowModeChangePopup] = useState(false);
  const [showInfoModal, setShowInfoModal] = useState(false);
  const [mode, setMode] = useState<GenerationMode>('image');

  const modeRef = useRef<GenerationMode>(mode);
  const graphRequestIdRef = useRef(0);
  const clarifyRequestIdRef = useRef(0);
  const generationRequestIdRef = useRef(0);
  const graphAbortRef = useRef<AbortController | null>(null);
  const clarifyAbortRef = useRef<AbortController | null>(null);
  const generationAbortRef = useRef<AbortController | null>(null);
  const refineAbortRef = useRef<AbortController | null>(null);

  const [images, setImages] = useState<string[]>([]);
  const [imageWarning, setImageWarning] = useState<string | null>(null);
  const [story, setStory] = useState<string | null>(null);
  const [video, setVideo] = useState<string | null>(null);
  const [galleryErrors, setGalleryErrors] = useState<Record<GenerationMode, string | null>>({
    image: null,
    story: null,
    video: null,
  });
  const [analysisError, setAnalysisError] = useState<string | null>(null);
  const [clarificationError, setClarificationError] = useState<string | null>(null);

  const [beliefGraph, setBeliefGraph] = useState<BeliefState | null>(null);
  const [clarifications, setClarifications] = useState<Clarification[]>([]);
  const [answeredQuestions, setAnsweredQuestions] = useState<string[]>([]);
  const [skippedQuestions, setSkippedQuestions] = useState<string[]>([]);
  const [hasGenerated, setHasGenerated] = useState(false);

  const [lastAnalyzedPrompt, setLastAnalyzedPrompt] = useState<string | null>(null);
  const [lastAnalyzedMode, setLastAnalyzedMode] = useState<GenerationMode | null>(null);

  const [pendingAttributeUpdates, setPendingAttributeUpdates] = useState<Record<string, string>>(
    {}
  );
  const [pendingRelationshipUpdates, setPendingRelationshipUpdates] = useState<
    Record<string, string>
  >({});
  const [pendingClarificationAnswers, setPendingClarificationAnswers] = useState<
    Record<string, string>
  >({});

  const [activeToolTab, setActiveToolTab] = useState<ToolTab>('clarify');
  const [mobileView, setMobileView] = useState<MobileView>('editor');

  const [isDarkMode, setIsDarkMode] = useState(false);
  const [statusNotification, setStatusNotification] = useState<string | null>(null);

  useEffect(() => {
    if (isGenerating) {
      setMobileView('preview');
    }
  }, [isGenerating]);

  useEffect(() => {
    modeRef.current = mode;
  }, [mode]);

  useEffect(() => {
    if (isDarkMode) {
      document.documentElement.classList.add('dark');
      document.body.style.backgroundColor = '#111827';
    } else {
      document.documentElement.classList.remove('dark');
      document.body.style.backgroundColor = '#f3f4f6';
    }
  }, [isDarkMode]);

  useEffect(() => {
    return () => {
      graphAbortRef.current?.abort();
      clarifyAbortRef.current?.abort();
      generationAbortRef.current?.abort();
      refineAbortRef.current?.abort();
    };
  }, []);

  const clearPendingUpdates = () => {
    setPendingAttributeUpdates({});
    setPendingRelationshipUpdates({});
    setPendingClarificationAnswers({});
  };

  const handleModeChange = (newMode: GenerationMode) => {
    if (newMode === mode) return;

    graphRequestIdRef.current += 1;
    clarifyRequestIdRef.current += 1;
    generationRequestIdRef.current += 1;

    graphAbortRef.current?.abort();
    clarifyAbortRef.current?.abort();
    generationAbortRef.current?.abort();
    refineAbortRef.current?.abort();

    setMode(newMode);
    setIsGraphLoading(false);
    setIsClarificationsLoading(false);
    setIsGenerating(false);
    setIsUpdatingPrompt(false);
    setStatusNotification(null);
    setShowModeChangePopup(true);
  };

  const refreshAnalysis = useCallback(
    async (
      currentPrompt: string,
      currentAnsweredQuestions: string[],
      currentMode: GenerationMode
    ) => {
      graphAbortRef.current?.abort();
      clarifyAbortRef.current?.abort();
      const graphController = new AbortController();
      const clarifyController = new AbortController();
      graphAbortRef.current = graphController;
      clarifyAbortRef.current = clarifyController;

      const graphReqId = ++graphRequestIdRef.current;
      const clarifyReqId = ++clarifyRequestIdRef.current;
      const isGraphCurrent = () =>
        modeRef.current === currentMode && graphRequestIdRef.current === graphReqId;
      const isClarifyCurrent = () =>
        modeRef.current === currentMode && clarifyRequestIdRef.current === clarifyReqId;

      setIsGraphLoading(true);
      setIsClarificationsLoading(true);
      setAnalysisError(null);
      setClarificationError(null);

      const graphPromise = analyzePromptToBeliefGraph(
        currentPrompt,
        currentMode,
        graphController.signal
      )
        .then((graphStructure) => {
          if (isGraphCurrent()) {
            setBeliefGraph(graphStructure);
          }
        })
        .catch((error: unknown) => {
          if (isAbortError(error)) return;
          if (isGraphCurrent()) {
            setAnalysisError(
              getReadableErrorMessage(error, 'Failed to extract belief graph.')
            );
          }
        })
        .finally(() => {
          if (isGraphCurrent()) {
            setIsGraphLoading(false);
          }
        });

      const clarificationPromise = generateClarifications(
        currentPrompt,
        currentAnsweredQuestions,
        currentMode,
        clarifyController.signal
      )
        .then((generatedClarifications) => {
          if (isClarifyCurrent()) {
            setClarifications(generatedClarifications);
          }
        })
        .catch((error: unknown) => {
          if (isAbortError(error)) return;
          if (isClarifyCurrent()) {
            setClarificationError(
              getReadableErrorMessage(error, 'Failed to generate clarifications.')
            );
          }
        })
        .finally(() => {
          if (isClarifyCurrent()) {
            setIsClarificationsLoading(false);
          }
        });

      if (isGraphCurrent()) {
        setLastAnalyzedPrompt(currentPrompt);
        setLastAnalyzedMode(currentMode);
      }

      return Promise.all([graphPromise, clarificationPromise]);
    },
    []
  );

  const handleRefreshClarifications = useCallback(() => {
    clarifyAbortRef.current?.abort();
    const controller = new AbortController();
    clarifyAbortRef.current = controller;

    const requestId = ++clarifyRequestIdRef.current;
    const requestMode = mode;
    const isCurrent = () =>
      modeRef.current === requestMode && clarifyRequestIdRef.current === requestId;

    setIsClarificationsLoading(true);
    setClarificationError(null);
    setPendingClarificationAnswers({});
    setStatusNotification(null);

    const currentQuestions = clarifications.map((c) => c.question);
    const newSkipped = [...skippedQuestions, ...currentQuestions];
    setSkippedQuestions(newSkipped);

    const excludeList = [...answeredQuestions, ...newSkipped];

    generateClarifications(prompt, excludeList, requestMode, controller.signal)
      .then((newClarifications) => {
        if (isCurrent()) setClarifications(newClarifications);
      })
      .catch((error: unknown) => {
        if (isAbortError(error)) return;
        if (isCurrent()) {
          setClarificationError(
            getReadableErrorMessage(error, 'Failed to refresh clarifications.')
          );
        }
      })
      .finally(() => {
        if (isCurrent()) {
          setIsClarificationsLoading(false);
        }
      });
  }, [prompt, answeredQuestions, mode, clarifications, skippedQuestions]);

  const processRequest = useCallback(
    async (
      currentPrompt: string,
      currentAnsweredQuestions: string[],
      currentMode: GenerationMode,
      skipAnalysis: boolean = false,
      skipGeneration: boolean = false
    ) => {
      const genRequestId = ++generationRequestIdRef.current;
      const requestMode = currentMode;
      const isGenCurrent = () =>
        modeRef.current === requestMode && generationRequestIdRef.current === genRequestId;

      setGalleryErrors((prev) => ({ ...prev, [requestMode]: null }));

      if (!skipGeneration) {
        if (requestMode === 'image') {
          setImages([]);
          setImageWarning(null);
        } else if (requestMode === 'story') {
          setStory(null);
        } else if (requestMode === 'video') {
          setVideo(null);
        }
      }

      setIsOutdated(false);
      setStatusNotification(null);
      setShowModeChangePopup(false);

      if (!skipAnalysis) {
        setBeliefGraph(null);
        setClarifications([]);
        clearPendingUpdates();
        setSkippedQuestions([]);
      }

      const analysisPromise = !skipAnalysis
        ? refreshAnalysis(currentPrompt, currentAnsweredQuestions, currentMode)
        : Promise.resolve();

      let generationPromise = Promise.resolve();

      if (!skipGeneration) {
        generationAbortRef.current?.abort();
        const genController = new AbortController();
        generationAbortRef.current = genController;

        setIsGenerating(true);
        generationPromise = (async () => {
          try {
            if (requestMode === 'image') {
              const result = await generateImagesFromPrompt(
                currentPrompt,
                genController.signal
              );
              if (isGenCurrent()) {
                setImages(result.images);
                setImageWarning(result.warning);
              }
            } else if (requestMode === 'story') {
              const generatedStory = await generateStoryFromPrompt(
                currentPrompt,
                genController.signal
              );
              if (isGenCurrent()) setStory(generatedStory);
            } else if (requestMode === 'video') {
              const generatedVideo = await generateVideoFromPrompt(
                currentPrompt,
                (msg) => {
                  if (isGenCurrent()) setStatusNotification(msg);
                },
                genController.signal
              );
              if (isGenCurrent()) setVideo(generatedVideo);
            }
          } catch (error: unknown) {
            if (isAbortError(error)) return;
            if (isGenCurrent()) {
              const message = getReadableErrorMessage(
                error,
                `An unknown error occurred during ${requestMode} generation.`
              );
              setGalleryErrors((prev) => ({ ...prev, [requestMode]: message }));
            }
          } finally {
            if (isGenCurrent()) {
              setIsGenerating(false);
              setStatusNotification(null);
            }
          }
        })();
      }

      await Promise.all([analysisPromise, generationPromise]);
    },
    [refreshAnalysis]
  );

  const handlePromptSubmit = useCallback(() => {
    const trimmed = prompt.trim();
    if (!trimmed) return;
    setHasGenerated(true);

    const shouldSkipAnalysis =
      trimmed === lastAnalyzedPrompt && mode === lastAnalyzedMode && beliefGraph !== null;

    if (shouldSkipAnalysis) {
      void processRequest(trimmed, answeredQuestions, mode, true, false);
    } else {
      const newAnsweredQuestions: string[] = [];
      setAnsweredQuestions(newAnsweredQuestions);
      setClarifications([]);
      void processRequest(trimmed, newAnsweredQuestions, mode, false, false);
    }
  }, [
    prompt,
    mode,
    lastAnalyzedPrompt,
    lastAnalyzedMode,
    beliefGraph,
    answeredQuestions,
    processRequest,
  ]);

  const handleAnalyzeOnly = useCallback(() => {
    const trimmed = prompt.trim();
    if (!trimmed) return;
    const newAnsweredQuestions: string[] = [];
    setAnsweredQuestions(newAnsweredQuestions);
    setClarifications([]);
    void processRequest(trimmed, newAnsweredQuestions, mode, false, true);
  }, [prompt, mode, processRequest]);

  const handleApplyAllUpdates = async () => {
    if (isUpdatingPrompt) return;

    const requestMode = mode;
    const isCurrent = () => modeRef.current === requestMode;

    refineAbortRef.current?.abort();
    const controller = new AbortController();
    refineAbortRef.current = controller;

    setIsUpdatingPrompt(true);
    setStatusNotification(null);

    const qaPairs = Object.entries(pendingClarificationAnswers)
      .filter(([, answer]) => answer.trim().length > 0)
      .map(([question, answer]) => ({ question, answer: answer.trim() }));

    const graphUpdates = buildGraphUpdates(
      pendingAttributeUpdates,
      pendingRelationshipUpdates,
      beliefGraph?.relationships ?? []
    );

    const newAnsweredQuestions = [...answeredQuestions, ...qaPairs.map((a) => a.question)];

    try {
      const newRefinedPrompt = await refinePromptWithAllUpdates(
        prompt,
        qaPairs,
        graphUpdates,
        controller.signal
      );

      if (!isCurrent()) return;

      setAnsweredQuestions(newAnsweredQuestions);
      setPrompt(newRefinedPrompt);
      setIsOutdated(true);
      clearPendingUpdates();
      setSkippedQuestions([]);

      void refreshAnalysis(newRefinedPrompt, newAnsweredQuestions, requestMode);
    } catch (error: unknown) {
      if (isAbortError(error)) return;
      if (isCurrent()) {
        setGalleryErrors((prev) => ({
          ...prev,
          [requestMode]: getReadableErrorMessage(
            error,
            'Failed to refine prompt based on your changes.'
          ),
        }));
      }
    } finally {
      if (isCurrent()) {
        setIsUpdatingPrompt(false);
        setStatusNotification(null);
      }
    }
  };

  const ToolTabButton: React.FC<{ label: string; tab: ToolTab }> = ({ label, tab }) => (
    <button
      type="button"
      role="tab"
      aria-selected={activeToolTab === tab}
      onClick={() => setActiveToolTab(tab)}
      className={`flex-1 py-3 px-2 text-xs sm:text-sm font-semibold text-center transition-colors relative whitespace-nowrap focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-blue-500 ${
        activeToolTab === tab
          ? 'text-blue-700 dark:text-blue-300 bg-white dark:bg-gray-800 border-b-2 border-blue-600 dark:border-blue-400'
          : 'text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-gray-200 hover:bg-gray-100/70 dark:hover:bg-gray-800/70 border-b border-gray-200 dark:border-gray-700'
      }`}
    >
      {label}
    </button>
  );

  const pendingClarificationCount = Object.keys(pendingClarificationAnswers).length;
  const pendingGraphUpdatesCount =
    Object.keys(pendingAttributeUpdates).length +
    Object.keys(pendingRelationshipUpdates).length;
  const totalUpdateCount = pendingClarificationCount + pendingGraphUpdatesCount;

  return (
    <div
      className={`${
        isDarkMode ? 'dark' : ''
      } font-sans h-screen flex flex-col bg-gray-100 dark:bg-gray-900 text-gray-900 dark:text-gray-100 transition-colors duration-200 overflow-hidden`}
    >
      <Header
        isDarkMode={isDarkMode}
        toggleDarkMode={() => setIsDarkMode((prev) => !prev)}
        onShowInfo={() => setShowInfoModal(true)}
      />

      {statusNotification && (
        <div
          className="fixed top-20 left-1/2 -translate-x-1/2 z-[2000] animate-fade-in-down px-4 w-full max-w-md"
          role="status"
          aria-live="polite"
        >
          <div className="bg-amber-50 dark:bg-amber-900/95 border border-amber-300 dark:border-amber-700 text-amber-900 dark:text-amber-100 px-4 py-3 rounded-lg shadow-lg flex items-center gap-3 backdrop-blur-sm">
            <span className="text-sm font-medium flex-1">{statusNotification}</span>
            <button
              type="button"
              onClick={() => setStatusNotification(null)}
              className="text-amber-700 dark:text-amber-200 hover:text-amber-950 dark:hover:text-white p-1 rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-500"
              aria-label="Dismiss status notification"
            >
              <svg
                xmlns="http://www.w3.org/2000/svg"
                className="h-4 w-4"
                viewBox="0 0 20 20"
                fill="currentColor"
                aria-hidden="true"
              >
                <path
                  fillRule="evenodd"
                  d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z"
                  clipRule="evenodd"
                />
              </svg>
            </button>
          </div>
        </div>
      )}

      <main className="flex-1 flex flex-col w-full max-w-screen-2xl mx-auto xl:p-5 overflow-hidden min-h-0">
        <div className="flex-1 flex flex-col xl:grid xl:grid-cols-2 xl:gap-5 min-h-0">
          {/* Left Column: Prompt + Co-Creation Tools */}
          <section
            aria-label="Prompt editor and analysis tools"
            className={`flex flex-col bg-white dark:bg-gray-800 xl:rounded-lg xl:border border-gray-200 dark:border-gray-700 transition-colors duration-200 ${
              mobileView === 'editor' ? 'flex flex-1' : 'hidden xl:flex'
            } h-full overflow-hidden`}
          >
            <div className="flex-shrink-0 z-10 border-b border-gray-200 dark:border-gray-700">
              <PromptInput
                prompt={prompt}
                setPrompt={setPrompt}
                onSubmit={handlePromptSubmit}
                onAnalyze={handleAnalyzeOnly}
                isLoading={isGenerating || isUpdatingPrompt}
                isGenerating={isGenerating}
                isFirstRun={!hasGenerated}
                mode={mode}
                setMode={handleModeChange}
              />
            </div>

            <div
              role="tablist"
              aria-label="Co-creation analysis tools"
              className="flex flex-shrink-0 bg-gray-50 dark:bg-gray-900 border-b border-gray-200 dark:border-gray-700"
            >
              <ToolTabButton label="Clarifications" tab="clarify" />
              <ToolTabButton label="Belief Graph" tab="graph" />
              <ToolTabButton
                label={
                  mode === 'image'
                    ? 'Image Attributes'
                    : mode === 'video'
                      ? 'Video Attributes'
                      : 'Story Attributes'
                }
                tab="attributes"
              />
            </div>

            <div className="relative bg-gray-50/40 dark:bg-gray-900/30 flex-1 overflow-hidden flex flex-col min-h-[360px] pb-[3.5rem] xl:pb-0">
              {totalUpdateCount > 0 && (
                <div className="flex-shrink-0 bg-blue-50 dark:bg-blue-900/25 border-b border-blue-200 dark:border-blue-800 px-4 py-2.5 flex justify-between items-center z-20">
                  <div className="text-xs text-blue-900 dark:text-blue-200 font-medium tabular-nums">
                    {totalUpdateCount} pending change{totalUpdateCount !== 1 ? 's' : ''}
                  </div>
                  <button
                    type="button"
                    onClick={handleApplyAllUpdates}
                    disabled={isUpdatingPrompt}
                    className="bg-blue-600 hover:bg-blue-700 text-white text-xs font-semibold py-2 px-4 rounded-md flex items-center gap-2 transition-colors disabled:opacity-70 disabled:cursor-wait whitespace-nowrap focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
                  >
                    {isUpdatingPrompt ? (
                      <>
                        <svg
                          className="animate-spin h-3.5 w-3.5 text-white"
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
                        <span>Updating...</span>
                      </>
                    ) : (
                      <span>Update Prompt</span>
                    )}
                  </button>
                </div>
              )}

              <div
                role="tabpanel"
                className={`p-4 ${
                  activeToolTab === 'clarify' ? 'flex flex-col' : 'hidden'
                } h-full overflow-hidden`}
              >
                <ClarificationCard
                  clarifications={clarifications}
                  onRefresh={handleRefreshClarifications}
                  isLoading={isClarificationsLoading}
                  error={clarificationError}
                  pendingAnswers={pendingClarificationAnswers}
                  setPendingAnswers={setPendingClarificationAnswers}
                  prompt={prompt}
                />
              </div>

              <div
                role="tabpanel"
                className={`flex-1 w-full min-h-0 p-0 ${
                  activeToolTab !== 'clarify' ? 'flex flex-col' : 'hidden'
                }`}
              >
                <BeliefGraph
                  data={beliefGraph}
                  isLoading={isGraphLoading}
                  error={analysisError}
                  view={activeToolTab === 'attributes' ? 'attributes' : 'graph'}
                  pendingAttributeUpdates={pendingAttributeUpdates}
                  setPendingAttributeUpdates={setPendingAttributeUpdates}
                  pendingRelationshipUpdates={pendingRelationshipUpdates}
                  setPendingRelationshipUpdates={setPendingRelationshipUpdates}
                  currentPrompt={prompt}
                />
              </div>
            </div>
          </section>

          {/* Right Column: Output Preview */}
          <section
            aria-label="Generated output"
            className={`flex flex-col xl:flex ${
              mobileView === 'preview' ? 'flex' : 'hidden'
            } flex-1 h-full min-h-0 pb-[3.5rem] xl:pb-0`}
          >
            <OutputDisplay
              images={images}
              imageWarning={imageWarning}
              story={story}
              video={video}
              mode={mode}
              isLoading={isGenerating}
              statusMessage={statusNotification}
              error={galleryErrors[mode]}
              isOutdated={isOutdated}
            />
          </section>
        </div>
      </main>

      {/* Mobile Bottom Navigation */}
      <nav
        aria-label="Mobile view switcher"
        className="xl:hidden bg-white dark:bg-gray-800 border-t border-gray-200 dark:border-gray-700 flex justify-around px-2 py-1.5 z-[200] fixed bottom-0 left-0 right-0"
        style={{ paddingBottom: 'max(0.375rem, env(safe-area-inset-bottom))' }}
      >
        <button
          type="button"
          onClick={() => setMobileView('editor')}
          aria-current={mobileView === 'editor' ? 'page' : undefined}
          className={`flex-1 flex flex-col items-center justify-center py-1 rounded-lg transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 ${
            mobileView === 'editor'
              ? 'text-blue-600 dark:text-blue-400'
              : 'text-gray-600 dark:text-gray-400'
          }`}
        >
          <svg
            xmlns="http://www.w3.org/2000/svg"
            className="h-5 w-5 mb-0.5"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            aria-hidden="true"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z"
            />
          </svg>
          <span className="text-[11px] font-semibold">Editor</span>
        </button>

        <button
          type="button"
          onClick={() => setMobileView('preview')}
          aria-current={mobileView === 'preview' ? 'page' : undefined}
          className={`flex-1 flex flex-col items-center justify-center py-1 rounded-lg transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 ${
            mobileView === 'preview'
              ? 'text-blue-600 dark:text-blue-400'
              : 'text-gray-600 dark:text-gray-400'
          }`}
        >
          <svg
            xmlns="http://www.w3.org/2000/svg"
            className="h-5 w-5 mb-0.5"
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
          <span className="text-[11px] font-semibold">Preview</span>
        </button>
      </nav>

      <InfoModal isOpen={showInfoModal} onClose={() => setShowInfoModal(false)} />

      {showModeChangePopup && (
        <div className="fixed bottom-16 xl:bottom-4 right-4 z-[2000] animate-fade-in-up max-w-sm w-[calc(100%-2rem)]">
          <div
            role="status"
            className="bg-white dark:bg-gray-800 border border-amber-300 dark:border-amber-700 rounded-lg shadow-xl p-4 relative flex items-start gap-3"
          >
            <svg
              className="h-5 w-5 text-amber-500 flex-shrink-0 mt-0.5"
              xmlns="http://www.w3.org/2000/svg"
              viewBox="0 0 20 20"
              fill="currentColor"
              aria-hidden="true"
            >
              <path
                fillRule="evenodd"
                d="M8.257 3.099c.765-1.36 2.722-1.36 3.486 0l5.58 9.92c.75 1.334-.213 2.98-1.742 2.98H4.42c-1.53 0-2.493-1.646-1.743-2.98l5.58-9.92zM11 13a1 1 0 11-2 0 1 1 0 012 0zm-1-8a1 1 0 00-1 1v3a1 1 0 002 0V6a1 1 0 00-1-1z"
                clipRule="evenodd"
              />
            </svg>
            <div className="pr-6">
              <h3 className="text-sm font-semibold text-gray-900 dark:text-gray-100">
                Mode Changed
              </h3>
              <p className="mt-1 text-xs text-gray-600 dark:text-gray-300 leading-relaxed">
                The belief graph and clarifications are preserved from the previous mode for reference.
              </p>
            </div>
            <button
              type="button"
              onClick={() => setShowModeChangePopup(false)}
              className="absolute top-2.5 right-2.5 text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 p-1 rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
              aria-label="Dismiss mode change notice"
            >
              <svg
                xmlns="http://www.w3.org/2000/svg"
                className="h-4 w-4"
                viewBox="0 0 20 20"
                fill="currentColor"
                aria-hidden="true"
              >
                <path
                  fillRule="evenodd"
                  d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z"
                  clipRule="evenodd"
                />
              </svg>
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

export default App;
