/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { useEffect, useRef, useState } from 'react';
import type { ArtifactAnchor, ManuscriptSection } from '../../shared/narrativeTypes';
import type { CreativeProject } from '../../shared/types';
import {
  applyManuscriptOperation,
  narrativeBase,
  type NarrativeBase,
} from '../../lib/narrative/manuscriptModel';
import type { StyleProfile } from '../../lib/narrative/context/styleProfile';
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

  const edit = (next: ManuscriptSection[]) => {
    setDraft({ base: draft?.base ?? narrativeBase(project), sections: next });
    if (!draft) setError('');
    onDirty(true);
  };

  const operate = (operation: Parameters<typeof applyManuscriptOperation>[1]) => {
    try {
      const currentSections = draft?.sections ?? sections;
      edit(applyManuscriptOperation(currentSections, operation));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'The edit could not be applied.');
    }
  };

  async function save(
    base: NarrativeBase,
    next: ManuscriptSection[],
    artifact?: ArtifactAnchor,
    nextStyleProfile = styleProfile
  ) {
    if (inFlight.current) return;
    inFlight.current = true;
    if (artifact) setDraft({ base, sections: next, artifact });
    onDirty(true);
    setSaving(true);
    setError('');
    try {
      await onSave(base, next, artifact, nextStyleProfile);
      setDraft(null);
      onSaveSuccess(nextStyleProfile, Boolean(artifact));
      onDirty(false);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Save failed. Your draft is still open.');
    } finally {
      inFlight.current = false;
      setSaving(false);
    }
  }

  // Timers and click handlers share the latest save callback. Failed writes require explicit retry.
  const saveRef = useRef(save);
  useEffect(() => {
    saveRef.current = save;
  });
  useEffect(() => {
    if (!draft || !enabled || isComposing || saving || error || adopting) return;
    const timer = window.setTimeout(
      () => void saveRef.current(draft.base, draft.sections, draft.artifact),
      900
    );
    return () => window.clearTimeout(timer);
  }, [draft, enabled, isComposing, saving, error, adopting]);

  const clearDraft = () => {
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
    clearDraft,
  };
}
