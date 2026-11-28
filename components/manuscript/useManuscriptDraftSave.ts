/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import type { ArtifactAnchor, ManuscriptSection } from '../../shared/narrativeTypes';
import type { CreativeProject } from '../../shared/types';
import {
  applyManuscriptOperation,
  narrativeBase,
  type NarrativeBase,
} from '../../lib/narrative/manuscriptModel';
import type { StyleProfile } from '../../lib/narrative/context/styleProfile';
import type { DraftFlushResult } from '../../lib/controller/navigationFlush';
import { computeEditorDirtyAfterDraftDiscard } from './manuscriptEditorHelpers';

interface UseManuscriptDraftSaveOptions {
  project: CreativeProject;
  sections: ManuscriptSection[];
  styleProfile: StyleProfile;
  styleProfileDirty: boolean;
  enabled: boolean;
  isComposing: boolean;
  adopting: boolean;
  onSave: (
    base: NarrativeBase,
    sections: ManuscriptSection[],
    artifact?: ArtifactAnchor,
    styleProfile?: StyleProfile
  ) => Promise<void>;
  onDirty: (dirty: boolean) => void;
  onSaveSuccess: (savedStyleProfile: StyleProfile, hadArtifact: boolean) => void;
}

export function useManuscriptDraftSave({
  project,
  sections,
  styleProfile,
  styleProfileDirty,
  enabled,
  isComposing,
  adopting,
  onSave,
  onDirty,
  onSaveSuccess,
}: UseManuscriptDraftSaveOptions) {
  const [draft, setDraft] = useState<{
    base: NarrativeBase;
    sections: ManuscriptSection[];
    artifact?: ArtifactAnchor;
  } | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const inFlight = useRef(false);
  const inFlightPromiseRef = useRef<Promise<DraftFlushResult> | null>(null);
  const autosaveTimerRef = useRef<number | null>(null);

  const projectRef = useRef(project);
  const sectionsRef = useRef(sections);
  const draftRef = useRef(draft);
  const styleProfileRef = useRef(styleProfile);
  const styleProfileDirtyRef = useRef(styleProfileDirty);
  const enabledRef = useRef(enabled);
  const isComposingRef = useRef(isComposing);
  const adoptingRef = useRef(adopting);

  useEffect(() => {
    projectRef.current = project;
    sectionsRef.current = sections;
    draftRef.current = draft;
    styleProfileRef.current = styleProfile;
    styleProfileDirtyRef.current = styleProfileDirty;
    enabledRef.current = enabled;
    isComposingRef.current = isComposing;
    adoptingRef.current = adopting;
  });

  const clearScheduledAutosave = useCallback(() => {
    if (autosaveTimerRef.current !== null) {
      window.clearTimeout(autosaveTimerRef.current);
      autosaveTimerRef.current = null;
    }
  }, []);

  const edit = (next: ManuscriptSection[]) => {
    const nextDraft = { base: draftRef.current?.base ?? narrativeBase(projectRef.current), sections: next };
    draftRef.current = nextDraft;
    setDraft(nextDraft);
    if (!draft) setError('');
    onDirty(true);
  };

  const operate = (operation: Parameters<typeof applyManuscriptOperation>[1]) => {
    try {
      const currentSections = draftRef.current?.sections ?? sectionsRef.current;
      edit(applyManuscriptOperation(currentSections, operation));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'The edit could not be applied.');
    }
  };

  async function save(
    base: NarrativeBase,
    next: ManuscriptSection[],
    artifact?: ArtifactAnchor,
    nextStyleProfile = styleProfileRef.current
  ): Promise<DraftFlushResult> {
    clearScheduledAutosave();
    if (inFlight.current && inFlightPromiseRef.current) {
      return inFlightPromiseRef.current;
    }
    inFlight.current = true;
    const savedSnapshot = { base, sections: next, artifact };
    if (artifact) {
      draftRef.current = savedSnapshot;
      setDraft(savedSnapshot);
    }
    onDirty(true);
    setSaving(true);
    setError('');

    const run = (async (): Promise<DraftFlushResult> => {
      try {
        await onSave(base, next, artifact, nextStyleProfile);
        // Only clear draft if no newer edits arrived while saving.
        if (
          draftRef.current === null ||
          draftRef.current.sections === next
        ) {
          draftRef.current = null;
          setDraft(null);
          onDirty(false);
        }
        onSaveSuccess(nextStyleProfile, Boolean(artifact));
        return { ok: true, flushed: true };
      } catch (cause) {
        const message =
          cause instanceof Error ? cause.message : 'Save failed. Your draft is still open.';
        setError(message);
        return { ok: false, error: message };
      } finally {
        inFlight.current = false;
        inFlightPromiseRef.current = null;
        setSaving(false);
      }
    })();

    inFlightPromiseRef.current = run;
    return run;
  }

  // Timers and click handlers share the latest save callback. Failed writes require explicit retry.
  const saveRef = useRef(save);
  useEffect(() => {
    saveRef.current = save;
  });

  useEffect(() => {
    if (!draft || !enabled || isComposing || saving || error || adopting) return;
    autosaveTimerRef.current = window.setTimeout(() => {
      autosaveTimerRef.current = null;
      void saveRef.current(draft.base, draft.sections, draft.artifact);
    }, 900);
    return () => clearScheduledAutosave();
  }, [draft, enabled, isComposing, saving, error, adopting, clearScheduledAutosave]);

  const flushDraft = useCallback(async (): Promise<DraftFlushResult> => {
    clearScheduledAutosave();

    if (isComposingRef.current) {
      return { ok: false, error: 'Finish text composition before changing workspaces.' };
    }
    if (adoptingRef.current) {
      return { ok: false, error: 'Apply or cancel the open adoption dialog before leaving this workspace.' };
    }

    if (inFlightPromiseRef.current) {
      const inFlightResult = await inFlightPromiseRef.current;
      if (!inFlightResult.ok) return inFlightResult;
    }

    const pendingDraft = draftRef.current;
    const pendingStyleDirty = styleProfileDirtyRef.current;

    if (!pendingDraft && !pendingStyleDirty) {
      return { ok: true, flushed: false };
    }

    if (!enabledRef.current) {
      return {
        ok: false,
        error: 'Storage is not ready to save your draft yet. Export your draft if needed before leaving.',
      };
    }

    const base = pendingDraft?.base ?? narrativeBase(projectRef.current);
    const nextSections = pendingDraft?.sections ?? sectionsRef.current;
    return saveRef.current(base, nextSections, pendingDraft?.artifact, styleProfileRef.current);
  }, [clearScheduledAutosave]);

  const clearDraft = () => {
    clearScheduledAutosave();
    draftRef.current = null;
    setDraft(null);
    setError('');
    onDirty(computeEditorDirtyAfterDraftDiscard(styleProfileDirty));
  };

  return {
    draft,
    saving,
    error,
    edit,
    operate,
    save,
    flushDraft,
    clearDraft,
  };
}
