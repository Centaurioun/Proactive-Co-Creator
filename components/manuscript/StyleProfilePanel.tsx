/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState } from 'react';
import {
  createStyleObservation,
  reviewStyleObservation,
  selectStyleContext,
  type StyleProfile,
  type StyleTrait,
} from '../../lib/narrative/context/styleProfile';
import type { ManuscriptSection, NarrativeRecords } from '../../shared/narrativeTypes';
import { isTextBoundary } from '../../lib/narrative/evidenceRegistry';

export interface StyleProfilePanelProps {
  projectId: string;
  styleVersionKey: string;
  selectedSection?: ManuscriptSection;
  styleSources: NarrativeRecords['sources'];
  styleProfile: StyleProfile;
  styleProfileDirty: boolean;
  enabled: boolean;
  saving: boolean;
  isComposing: boolean;
  buttonClassName: string;
  fieldClassName: string;
  onChangeStyleProfile: React.Dispatch<React.SetStateAction<StyleProfile>>;
  onMarkDirty: () => void;
  onSaveStyleProfile: () => void;
}

const StyleProfilePanel: React.FC<StyleProfilePanelProps> = ({
  projectId,
  styleVersionKey,
  selectedSection,
  styleSources,
  styleProfile,
  styleProfileDirty,
  enabled,
  saving,
  isComposing,
  buttonClassName,
  fieldClassName,
  onChangeStyleProfile,
  onMarkDirty,
  onSaveStyleProfile,
}) => {
  const [previousStyleVersionKey, setPreviousStyleVersionKey] = useState(styleVersionKey);
  const [styleSourceId, setStyleSourceId] = useState('');
  const [styleTrait, setStyleTrait] = useState<StyleTrait>('voice');
  const [styleValue, setStyleValue] = useState('');
  const [styleExcerpt, setStyleExcerpt] = useState('');
  const [styleInterpretation, setStyleInterpretation] = useState<'observation' | 'interpretation'>(
    'observation'
  );
  const [styleScope, setStyleScope] = useState<'manuscript' | 'section'>('manuscript');
  const [styleError, setStyleError] = useState('');

  if (previousStyleVersionKey !== styleVersionKey) {
    setPreviousStyleVersionKey(styleVersionKey);
    setStyleSourceId('');
    setStyleError('');
  }

  const selectedStyleSource =
    styleSources.find(
      (source) => `${source.id}:${source.version}:${source.digest}` === styleSourceId
    ) ?? styleSources[0];

  function resolveStyleSource(ref: { recordId: string; version: string; digest: string }) {
    const source = styleSources.find(
      (item) => item.id === ref.recordId && item.version === ref.version && item.digest === ref.digest
    );
    return source ? { digest: source.digest, text: source.text } : undefined;
  }

  const currentStyleObservations = styleProfile.observations.filter((observation) => {
    const source = resolveStyleSource(observation.evidence);
    return (
      source !== undefined &&
      Number.isInteger(observation.evidence.start) &&
      Number.isInteger(observation.evidence.end) &&
      observation.evidence.start >= 0 &&
      observation.evidence.end > observation.evidence.start &&
      observation.evidence.end <= source.text.length &&
      observation.evidence.end - observation.evidence.start === observation.evidence.excerpt.length &&
      isTextBoundary(source.text, observation.evidence.start) &&
      isTextBoundary(source.text, observation.evidence.end) &&
      source.text.slice(observation.evidence.start, observation.evidence.end) ===
        observation.evidence.excerpt
    );
  });
  const staleStyleObservationCount = styleProfile.observations.length - currentStyleObservations.length;
  const currentStyleProfile = { ...styleProfile, observations: currentStyleObservations };
  const styleContext = selectedSection
    ? selectStyleContext(currentStyleProfile, projectId, selectedSection.id)
    : { guidance: [], conflicts: [] };

  function addStyleObservation() {
    const value = styleValue.trim();
    const source = selectedStyleSource;
    if (!source || !value || !styleExcerpt.trim() || (!selectedSection && styleScope === 'section')) {
      setStyleError(
        'Choose a source, add a style note and exact source excerpt, and select a section for section-specific notes.'
      );
      return;
    }
    if (styleValue.length > 240 || styleExcerpt.length > 2000) {
      setStyleError(
        'Style notes are limited to 240 characters and source excerpts to 2,000 characters.'
      );
      return;
    }
    const start = source.text.indexOf(styleExcerpt);
    if (
      start < 0 ||
      source.text.indexOf(styleExcerpt, start + 1) >= 0 ||
      !isTextBoundary(source.text, start) ||
      !isTextBoundary(source.text, start + styleExcerpt.length)
    ) {
      setStyleError('The exact excerpt must appear once in the selected project source.');
      return;
    }
    const observation = createStyleObservation({
      id: crypto.randomUUID(),
      trait: styleTrait,
      value,
      interpretation: styleInterpretation,
      scope:
        styleScope === 'section' && selectedSection
          ? { kind: 'section', sectionId: selectedSection.id }
          : { kind: 'manuscript' },
      evidence: {
        kind: 'source',
        recordId: source.id,
        version: source.version,
        digest: source.digest,
        start,
        end: start + styleExcerpt.length,
        excerpt: styleExcerpt,
      },
    });
    onChangeStyleProfile((profile) => ({
      ...profile,
      observations: [...profile.observations, observation],
    }));
    onMarkDirty();
    setStyleValue('');
    setStyleExcerpt('');
    setStyleError('');
  }

  function reviewStyle(id: string, status: 'confirmed' | 'rejected') {
    try {
      onChangeStyleProfile((profile) =>
        reviewStyleObservation(profile, id, status, resolveStyleSource)
      );
      onMarkDirty();
      setStyleError('');
    } catch (cause) {
      setStyleError(
        cause instanceof Error ? cause.message : 'This style note could not be reviewed.'
      );
    }
  }

  return (
    <details className="mb-4 rounded-lg border border-gray-200 p-3 dark:border-gray-800">
      <summary className="cursor-pointer font-semibold">User-reviewed style profile</summary>
      <p className="my-2 text-sm text-gray-600 dark:text-gray-300">
        Notes use existing imported sources and are separate from canonical facts. Save the profile to the project; no analysis or provider call is triggered.
      </p>
      <section
        aria-label="Confirmed style context"
        className="mb-3 rounded bg-gray-50 p-3 dark:bg-gray-950"
      >
        <h3 className="font-medium">
          Current style context
          {selectedSection ? ` · ${selectedSection.title || selectedSection.kind}` : ''}
        </h3>
        {styleContext.guidance.length ? (
          <ul className="mt-2 list-disc space-y-2 pl-5 text-sm">
            {styleContext.guidance.map((item) => (
              <li key={item.id}>
                <strong>{item.trait}:</strong> {item.value}{' '}
                <span className="text-gray-600 dark:text-gray-300">({item.interpretation})</span>
                <blockquote className="mt-1 border-l-2 border-gray-300 pl-2 text-xs">
                  {item.evidence.excerpt}
                </blockquote>
              </li>
            ))}
          </ul>
        ) : (
          <p className="mt-1 text-sm text-gray-600 dark:text-gray-300">
            No current confirmed style notes apply here.
          </p>
        )}
        {styleContext.conflicts.map((conflict) => (
          <p key={conflict.trait} role="status" className="mt-2 text-sm text-amber-800">
            Conflicting confirmed notes for {conflict.trait} are excluded.
          </p>
        ))}
      </section>
      {staleStyleObservationCount > 0 && (
        <p role="status" className="mb-3 rounded border border-amber-300 bg-amber-50 p-2 text-sm text-amber-900 dark:border-amber-800 dark:bg-amber-950/50 dark:text-amber-200">
          {staleStyleObservationCount} style {staleStyleObservationCount === 1 ? 'reference no longer matches' : 'references no longer match'} its imported source and are excluded from context.
        </p>
      )}
      {styleSources.length ? (
        <fieldset className="grid gap-3" disabled={!selectedStyleSource || saving}>
          <legend className="font-medium">Add a note for review</legend>
          <label className="grid gap-1 text-sm">
            Source record
            <select
              className={fieldClassName}
              value={
                selectedStyleSource
                  ? `${selectedStyleSource.id}:${selectedStyleSource.version}:${selectedStyleSource.digest}`
                  : ''
              }
              onChange={(event) => setStyleSourceId(event.target.value)}
            >
              {styleSources.map((source) => (
                <option
                  key={`${source.id}:${source.version}:${source.digest}`}
                  value={`${source.id}:${source.version}:${source.digest}`}
                >
                  {source.filename || 'Imported source'} · {source.version}
                </option>
              ))}
            </select>
          </label>
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="grid gap-1 text-sm">
              Trait
              <select
                className={fieldClassName}
                value={styleTrait}
                onChange={(event) => setStyleTrait(event.target.value as StyleTrait)}
              >
                <option value="pov">Point of view</option>
                <option value="voice">Voice</option>
                <option value="tense">Tense</option>
                <option value="rhythm">Rhythm</option>
                <option value="dialogue">Dialogue</option>
                <option value="atmosphere">Atmosphere</option>
              </select>
            </label>
            <label className="grid gap-1 text-sm">
              Note type
              <select
                className={fieldClassName}
                value={styleInterpretation}
                onChange={(event) =>
                  setStyleInterpretation(event.target.value as typeof styleInterpretation)
                }
              >
                <option value="observation">Observation</option>
                <option value="interpretation">Interpretation</option>
              </select>
            </label>
          </div>
          <label className="grid gap-1 text-sm">
            Style note
            <input
              className={fieldClassName}
              maxLength={240}
              value={styleValue}
              onChange={(event) => setStyleValue(event.target.value)}
              placeholder="Write a short note; nothing is inferred automatically."
            />
          </label>
          <label className="grid gap-1 text-sm">
            Exact source excerpt (must appear once)
            <textarea
              className={fieldClassName}
              maxLength={2000}
              rows={3}
              value={styleExcerpt}
              onChange={(event) => setStyleExcerpt(event.target.value)}
            />
          </label>
          <label className="grid gap-1 text-sm">
            Applies to
            <select
              className={fieldClassName}
              value={styleScope}
              onChange={(event) => setStyleScope(event.target.value as typeof styleScope)}
            >
              <option value="manuscript">Whole manuscript</option>
              <option value="section" disabled={!selectedSection}>
                Selected section only
              </option>
            </select>
          </label>
          <button
            type="button"
            className={`${buttonClassName} justify-self-start`}
            onClick={addStyleObservation}
          >
            Add pending note
          </button>
        </fieldset>
      ) : (
        <p className="mt-2 text-sm">
          No imported source records are available to anchor style notes.
        </p>
      )}
      {styleError && (
        <p role="alert" className="mt-2 text-sm text-red-700">
          {styleError}
        </p>
      )}
      {styleProfileDirty && (
        <button
          type="button"
          className={`${buttonClassName} mt-3`}
          disabled={!enabled || saving || isComposing}
          onClick={onSaveStyleProfile}
        >
          Save style profile
        </button>
      )}
      {styleProfile.observations.length > 0 && (
        <section aria-label="Style note review queue" className="mt-4 space-y-2">
          <h3 className="font-medium">Review queue</h3>
          {styleProfile.observations.map((item) => {
            const isCurrent = currentStyleObservations.some((current) => current.id === item.id);
            return (
              <article
                key={item.id}
                className="rounded border border-gray-200 p-3 text-sm dark:border-gray-700"
              >
                <p>
                  <strong>
                    {item.trait} · {item.interpretation}:
                  </strong>{' '}
                  {item.value}{' '}
                  <span className="ml-2">Status: {isCurrent ? item.status : 'stale source'}</span>
                </p>
                <blockquote className="my-2 border-l-2 border-gray-300 pl-2">
                  {item.evidence.excerpt}
                </blockquote>
                {item.status === 'pending' && (
                  <div className="flex flex-wrap gap-2">
                    <button
                      type="button"
                      className={buttonClassName}
                      disabled={!isCurrent || saving}
                      onClick={() => reviewStyle(item.id, 'confirmed')}
                    >
                      Confirm
                    </button>
                    <button
                      type="button"
                      className={buttonClassName}
                      disabled={saving}
                      onClick={() => reviewStyle(item.id, 'rejected')}
                    >
                      Reject
                    </button>
                  </div>
                )}
              </article>
            );
          })}
        </section>
      )}
    </details>
  );
};

export default StyleProfilePanel;
