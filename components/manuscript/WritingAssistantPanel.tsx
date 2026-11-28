import React, { useEffect, useMemo, useRef, useState } from 'react';
import type { ManuscriptSection } from '../../shared/narrativeTypes';
import type { CreativeProject } from '../../shared/types';
import type { WritingAssistAction, WritingAssistProposal } from '../../shared/narrativeAiSchemas';
import { buildClientBudgetDisclosure } from '../../lib/narrative/aiBudgetClient';
import {
  applyWritingSelectionEdit,
  computeTextDigest,
  extractConfirmedWritingContext,
  validateTextSelection,
} from '../../lib/narrative/writing/selectionHelpers';
import { requestWritingAssist } from '../../services/apiClient';
import { workspaceButton } from './ManuscriptEditor';

export function isWritingAssistResponseCurrent(
  requestEpoch: number,
  activeEpoch: number,
  requestSectionId: string,
  activeSectionId: string | undefined,
  aborted: boolean
): boolean {
  return !aborted && requestEpoch === activeEpoch && requestSectionId === activeSectionId;
}

export function resolveAlternativeTargetSectionId(generatedSectionId: string): string {
  return generatedSectionId;
}

type ActionOption = {
  id: WritingAssistAction;
  label: string;
  needsSelection?: boolean;
};

const ACTIONS: ActionOption[] = [
  { id: 'continue', label: 'Continue' },
  { id: 'rewrite', label: 'Rewrite', needsSelection: true },
  { id: 'clarity', label: 'Improve Clarity', needsSelection: true },
  { id: 'shorten', label: 'Shorten', needsSelection: true },
  { id: 'expand', label: 'Expand' },
  { id: 'dialogue', label: 'Dialogue' },
  { id: 'alternatives', label: 'Alternatives' },
  { id: 'custom', label: 'Custom' },
];

interface WritingAssistantPanelProps {
  project: CreativeProject;
  section: ManuscriptSection | undefined;
  selectionStart: number;
  selectionEnd: number;
  aiConfigured: boolean;
  disabled: boolean;
  onReplaceOrInsert: (nextText: string, label: string) => void;
  onCreateSceneFromProposal: (title: string, text: string) => void;
  onSaveAlternative: (alternative: {
    sectionId: string;
    action: WritingAssistAction;
    label: string;
    text: string;
    rationale: string;
    assumptions: string[];
  }) => void;
}

export default function WritingAssistantPanel({
  project,
  section,
  selectionStart,
  selectionEnd,
  aiConfigured,
  disabled,
  onReplaceOrInsert,
  onCreateSceneFromProposal,
  onSaveAlternative,
}: WritingAssistantPanelProps) {
  const [action, setAction] = useState<WritingAssistAction>('continue');
  const [customInstruction, setCustomInstruction] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [statusMessage, setStatusMessage] = useState('');
  const [generated, setGenerated] = useState<{
    sectionId: string;
    action: WritingAssistAction;
    start: number;
    end: number;
    expectedDigest: string;
    selectedText: string;
    proposals: WritingAssistProposal[];
  } | null>(null);

  const requestEpochRef = useRef(0);
  const abortControllerRef = useRef<AbortController | null>(null);
  const activeSectionIdRef = useRef<string | undefined>(section?.id);

  useEffect(() => {
    activeSectionIdRef.current = section?.id;
    requestEpochRef.current += 1;
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
      abortControllerRef.current = null;
      setLoading(false);
    }
  }, [section?.id]);

  useEffect(() => {
    return () => {
      requestEpochRef.current += 1;
      abortControllerRef.current?.abort();
      abortControllerRef.current = null;
    };
  }, []);

  const sectionText = section?.text ?? '';
  const validatedSelection = useMemo(
    () => validateTextSelection(sectionText, selectionStart, selectionEnd),
    [sectionText, selectionStart, selectionEnd]
  );

  const confirmedContext = useMemo(
    () => (section ? extractConfirmedWritingContext(project, section.id) : { confirmedEntities: [], confirmedStoryBible: {}, styleGuidance: [] }),
    [project, section]
  );

  const requestPreview = useMemo(() => {
    if (!section) return null;
    return {
      projectId: project.id,
      baseRevision: project.revision,
      manuscriptVersionId: project.snapshot.manuscriptVersionId,
      sectionId: section.id,
      sectionTitle: section.title || `${section.kind === 'chapter' ? 'Chapter' : 'Scene'}`,
      action,
      ...(action === 'custom' && customInstruction.trim() ? { customInstruction: customInstruction.trim() } : {}),
      ...(validatedSelection.selectedText ? { selectedText: validatedSelection.selectedText } : {}),
      contextBefore: validatedSelection.contextBefore,
      contextAfter: validatedSelection.contextAfter,
      confirmedEntities: confirmedContext.confirmedEntities,
      confirmedStoryBible: confirmedContext.confirmedStoryBible,
      styleGuidance: confirmedContext.styleGuidance,
    };
  }, [project.id, project.revision, project.snapshot.manuscriptVersionId, section, action, customInstruction, validatedSelection, confirmedContext]);

  const budgetDisclosure = useMemo(
    () =>
      buildClientBudgetDisclosure(
        'writing',
        section ? `Section "${section.title || section.kind}" (${action})` : 'No section selected',
        requestPreview ?? ''
      ),
    [section, action, requestPreview]
  );

  const activeOption = ACTIONS.find((a) => a.id === action);
  const missingRequiredSelection = Boolean(activeOption?.needsSelection && !validatedSelection.selectedText.trim());

  const isStale = Boolean(
    generated &&
      section &&
      (generated.sectionId !== section.id || computeTextDigest(section.text) !== generated.expectedDigest)
  );

  const savedAlternatives = useMemo(
    () =>
      (project.narrative?.writingAlternatives ?? []).filter(
        (alt) => !section || alt.sectionId === section.id
      ),
    [project.narrative?.writingAlternatives, section]
  );

  const handleRun = async () => {
    if (!section || !requestPreview || !validatedSelection.ok || loading) return;
    if (!aiConfigured) {
      setError('No AI provider is configured. Connect an AI provider in AI Settings to use the Writing Assistant.');
      return;
    }
    if (missingRequiredSelection) {
      setError(`Highlight text in the manuscript editor before running "${activeOption?.label}".`);
      return;
    }
    if (action === 'custom' && !customInstruction.trim()) {
      setError('Enter a custom instruction before running Custom assist.');
      return;
    }

    abortControllerRef.current?.abort();
    const controller = new AbortController();
    abortControllerRef.current = controller;
    const epoch = ++requestEpochRef.current;
    const requestSectionId = section.id;

    setLoading(true);
    setError('');
    setStatusMessage('');
    try {
      const response = await requestWritingAssist(requestPreview, controller.signal);
      if (
        !isWritingAssistResponseCurrent(
          epoch,
          requestEpochRef.current,
          requestSectionId,
          activeSectionIdRef.current,
          controller.signal.aborted
        )
      ) {
        return;
      }
      setGenerated({
        sectionId: requestSectionId,
        action,
        start: validatedSelection.start,
        end: validatedSelection.end,
        expectedDigest: validatedSelection.textDigest,
        selectedText: validatedSelection.selectedText,
        proposals: response.proposals,
      });
      setStatusMessage(`Generated ${response.proposals.length} reviewable draft proposal(s). No manuscript text has been changed.`);
    } catch (cause) {
      if (
        controller.signal.aborted ||
        epoch !== requestEpochRef.current ||
        requestSectionId !== activeSectionIdRef.current
      ) {
        return;
      }
      setError(cause instanceof Error ? cause.message : 'Writing Assistant request failed.');
    } finally {
      if (abortControllerRef.current === controller) {
        abortControllerRef.current = null;
      }
      if (epoch === requestEpochRef.current) {
        setLoading(false);
      }
    }
  };

  const applyProposal = (proposal: WritingAssistProposal, mode: 'replace' | 'insert-after') => {
    if (!section || !generated || generated.sectionId !== section.id) return;
    const applied = applyWritingSelectionEdit({
      currentText: section.text,
      expectedDigest: generated.expectedDigest,
      start: generated.start,
      end: generated.end,
      proposedText: proposal.text,
      mode,
    });
    if (!applied.ok) {
      setError(applied.error);
      return;
    }
    onReplaceOrInsert(applied.nextText, proposal.label);
    setGenerated(null);
    setError('');
    setStatusMessage(mode === 'replace' ? `Replaced selection with "${proposal.label}".` : `Inserted "${proposal.label}" after selection.`);
  };

  return (
    <details className="mb-4 rounded-lg border border-blue-200 bg-blue-50/30 p-3 dark:border-blue-900/60 dark:bg-blue-950/20">
      <summary className="cursor-pointer font-semibold text-sm text-gray-900 dark:text-gray-100">
        AI Writing Assistant (Selection-Aware · Review Before Applying)
      </summary>
      <div className="mt-3 space-y-3 text-xs">
        <p className="text-gray-600 dark:text-gray-300">
          Requests use only confirmed entities ({confirmedContext.confirmedEntities.length}), confirmed Story Bible fields ({Object.keys(confirmedContext.confirmedStoryBible).length}), and confirmed non-conflicting style notes ({confirmedContext.styleGuidance.length}). Unattributed beliefs and reported claims are excluded. Nothing edits your manuscript until you apply a proposal.
        </p>

        {!aiConfigured && (
          <p role="status" className="rounded border border-amber-300 bg-amber-50 p-2 text-amber-900 dark:border-amber-800 dark:bg-amber-950/50 dark:text-amber-200">
            AI Writing Assistant is unavailable because no AI provider is currently connected. Configure a provider in AI Settings; manual editing, saving, and style notes remain fully available.
          </p>
        )}

        <div className="flex flex-wrap gap-1.5" role="group" aria-label="Writing assistant action">
          {ACTIONS.map((opt) => (
            <button
              key={opt.id}
              type="button"
              aria-pressed={action === opt.id}
              onClick={() => {
                setAction(opt.id);
                setError('');
              }}
              className={`rounded border px-2.5 py-1 text-xs font-medium transition-colors ${
                action === opt.id
                  ? 'border-blue-600 bg-blue-600 text-white'
                  : 'border-gray-300 bg-white text-gray-800 hover:bg-gray-100 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-200 dark:hover:bg-gray-800'
              }`}
            >
              {opt.label}
            </button>
          ))}
        </div>

        {action === 'custom' && (
          <label className="block space-y-1">
            <span className="font-medium">Custom writing instruction</span>
            <input
              type="text"
              maxLength={600}
              value={customInstruction}
              onChange={(e) => setCustomInstruction(e.target.value)}
              placeholder="e.g. Deepen the sensory detail of the lantern light without introducing new characters"
              className="w-full rounded border border-gray-300 bg-white px-2.5 py-1.5 text-xs dark:border-gray-700 dark:bg-gray-950"
            />
          </label>
        )}

        <div className="rounded border border-gray-200 bg-white p-2.5 space-y-1 dark:border-gray-800 dark:bg-gray-900">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span className="font-semibold">
              {validatedSelection.selectedText
                ? `Selected passage: ${validatedSelection.selectedText.length.toLocaleString()} chars (offsets ${validatedSelection.start}–${validatedSelection.end})`
                : `Cursor at offset ${validatedSelection.start} (no text highlighted)`}
            </span>
            <span className="text-gray-500 dark:text-gray-400 tabular-nums">
              Preflight: {budgetDisclosure.inputChars.toLocaleString()} / {budgetDisclosure.maxInputChars.toLocaleString()} chars · ~{budgetDisclosure.estimatedInputTokens.toLocaleString()} / {budgetDisclosure.maxInputTokens.toLocaleString()} est. tokens
            </span>
          </div>
          {!validatedSelection.ok && validatedSelection.error && (
            <p role="alert" className="text-red-700 dark:text-red-300">{validatedSelection.error}</p>
          )}
          {budgetDisclosure.warning && (
            <p role="alert" className="text-amber-800 dark:text-amber-300">{budgetDisclosure.warning}</p>
          )}
          {missingRequiredSelection && (
            <p className="text-amber-800 dark:text-amber-300">
              Highlight a passage in the manuscript editor above to use &ldquo;{activeOption?.label}&rdquo;.
            </p>
          )}
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            className="rounded bg-blue-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-blue-700 disabled:opacity-45"
            disabled={
              disabled ||
              loading ||
              !section ||
              !aiConfigured ||
              !validatedSelection.ok ||
              !budgetDisclosure.withinLimit ||
              missingRequiredSelection ||
              (action === 'custom' && !customInstruction.trim())
            }
            onClick={() => void handleRun()}
          >
            {loading ? 'Generating proposals…' : `Generate ${activeOption?.label ?? 'AI'} Proposals`}
          </button>
          {generated && (
            <button type="button" className={workspaceButton} onClick={() => setGenerated(null)}>
              Dismiss Proposals
            </button>
          )}
        </div>

        {error && <p role="alert" className="text-red-700 dark:text-red-300 font-medium">{error}</p>}
        {statusMessage && <p role="status" className="text-emerald-700 dark:text-emerald-300 font-medium">{statusMessage}</p>}

        {generated && (
          <div className="space-y-2.5 pt-1">
            {isStale && (
              <p role="alert" className="rounded border border-amber-400 bg-amber-50 p-2 text-amber-900 dark:bg-amber-950/60 dark:text-amber-200">
                The manuscript section changed after these proposals were generated. Direct Replace/Insert is blocked to protect your edits — you can still create a New Scene, save as an Alternative, or re-run.
              </p>
            )}
            {generated.proposals.map((proposal) => (
              <article key={proposal.id} className="rounded border border-gray-300 bg-white p-3 space-y-2 dark:border-gray-700 dark:bg-gray-900">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <h4 className="font-semibold text-gray-900 dark:text-gray-100">{proposal.label}</h4>
                  <span className="rounded bg-blue-100 px-1.5 py-0.5 text-[10px] font-semibold uppercase text-blue-800 dark:bg-blue-950 dark:text-blue-300">
                    AI Draft Proposal
                  </span>
                </div>
                <p className="text-gray-600 dark:text-gray-300">{proposal.rationale}</p>
                {proposal.assumptions.length > 0 && (
                  <p className="text-[11px] text-gray-500 dark:text-gray-400">
                    Assumptions: {proposal.assumptions.join('; ')}
                  </p>
                )}
                <div className="grid gap-2 sm:grid-cols-2">
                  {generated.selectedText && (
                    <div className="rounded border border-red-200 bg-red-50/40 p-2 dark:border-red-900/60 dark:bg-red-950/20">
                      <div className="font-semibold text-[11px] text-red-800 dark:text-red-300 mb-1">Before (selected)</div>
                      <pre className="whitespace-pre-wrap break-words font-serif text-xs">{generated.selectedText}</pre>
                    </div>
                  )}
                  <div className={`${generated.selectedText ? '' : 'sm:col-span-2'} rounded border border-emerald-200 bg-emerald-50/40 p-2 dark:border-emerald-900/60 dark:bg-emerald-950/20`}>
                    <div className="font-semibold text-[11px] text-emerald-800 dark:text-emerald-300 mb-1">Proposed text</div>
                    <pre className="whitespace-pre-wrap break-words font-serif text-xs">{proposal.text}</pre>
                  </div>
                </div>
                <div className="flex flex-wrap gap-1.5 pt-1">
                  {generated.selectedText && (
                    <button
                      type="button"
                      disabled={isStale || disabled}
                      onClick={() => applyProposal(proposal, 'replace')}
                      className="rounded bg-blue-600 px-2.5 py-1 text-xs font-semibold text-white hover:bg-blue-700 disabled:opacity-40"
                    >
                      Replace Selection
                    </button>
                  )}
                  <button
                    type="button"
                    disabled={isStale || disabled}
                    onClick={() => applyProposal(proposal, 'insert-after')}
                    className={workspaceButton}
                  >
                    Insert After
                  </button>
                  <button
                    type="button"
                    disabled={disabled}
                    onClick={() => {
                      onCreateSceneFromProposal(`${section?.title || 'Scene'} — ${proposal.label}`, proposal.text);
                      setStatusMessage(`Created new scene from "${proposal.label}".`);
                    }}
                    className={workspaceButton}
                  >
                    New Scene
                  </button>
                  <button
                    type="button"
                    disabled={disabled || !generated.sectionId}
                    onClick={() => {
                      onSaveAlternative({
                        sectionId: resolveAlternativeTargetSectionId(generated.sectionId),
                        action: generated.action,
                        label: proposal.label,
                        text: proposal.text,
                        rationale: proposal.rationale,
                        assumptions: proposal.assumptions,
                      });
                      setStatusMessage(`Queued "${proposal.label}" for saving in Kept Alternatives.`);
                    }}
                    className={workspaceButton}
                  >
                    Keep Alternative
                  </button>
                </div>
              </article>
            ))}
          </div>
        )}

        {savedAlternatives.length > 0 && (
          <details className="rounded border border-gray-200 bg-white p-2.5 dark:border-gray-800 dark:bg-gray-900">
            <summary className="cursor-pointer font-semibold">
              Kept Alternatives for this section ({savedAlternatives.length})
            </summary>
            <div className="mt-2 space-y-2">
              {savedAlternatives.slice().reverse().map((alt) => (
                <article key={alt.id} className="rounded border border-gray-200 p-2 space-y-1 dark:border-gray-700">
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-semibold">{alt.label}</span>
                    <span className="text-[11px] text-gray-500">{new Date(alt.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
                  </div>
                  <p className="text-gray-600 dark:text-gray-300">{alt.rationale}</p>
                  <pre className="whitespace-pre-wrap break-words font-serif text-xs bg-gray-50 p-2 rounded dark:bg-gray-950">{alt.text}</pre>
                </article>
              ))}
            </div>
          </details>
        )}
      </div>
    </details>
  );
}
