/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import type { ManuscriptSection } from '../../shared/narrativeTypes';

export interface DraftFlushResult {
  ok: boolean;
  flushed?: boolean;
  error?: string;
}

export interface NavigationFlushDeps {
  isDraftDirty: () => boolean;
  isRestorePending: () => boolean;
  isCompositionPending: () => boolean;
  flushDraft?: (() => Promise<DraftFlushResult>) | null;
  notify: (message: string) => void;
}

/**
 * Allows opening non-destructive overlays (such as AI Settings) even while a
 * manuscript draft is dirty, blocking only active IME text composition.
 */
export function shouldAllowNonDestructiveOverlay(deps: {
  isCompositionPending: () => boolean;
  notify: (message: string) => void;
}): boolean {
  if (deps.isCompositionPending()) {
    deps.notify('Finish text composition before opening settings.');
    return false;
  }
  return true;
}

/**
 * Flushes any pending unsaved manuscript draft durably before executing a
 * workspace or project navigation action. Preserves IME composition safety,
 * active restore safety, and never discards an unsaved draft if flush fails.
 */
export async function executeNavigationWithFlush(
  deps: NavigationFlushDeps,
  action: () => void | Promise<void>
): Promise<boolean> {
  if (deps.isCompositionPending()) {
    deps.notify('Finish text composition before changing workspaces.');
    return false;
  }

  if (deps.isRestorePending()) {
    deps.notify('Wait for the active backup restore to finish before leaving this workspace.');
    return false;
  }

  if (deps.isDraftDirty()) {
    if (!deps.flushDraft) {
      deps.notify('Save the open manuscript draft before leaving this workspace.');
      return false;
    }

    try {
      const result = await deps.flushDraft();
      if (!result.ok) {
        deps.notify(
          result.error ??
            'Could not save the open manuscript draft. Your draft is still open so you can retry or export it.'
        );
        return false;
      }
    } catch (cause) {
      deps.notify(
        cause instanceof Error
          ? cause.message
          : 'Could not save the open manuscript draft. Your draft is still open.'
      );
      return false;
    }

    // Re-check guards in case IME or restore began while awaiting durable flush.
    if (deps.isCompositionPending()) {
      deps.notify('Finish text composition before changing workspaces.');
      return false;
    }
    if (deps.isRestorePending()) {
      deps.notify('Wait for the active backup restore to finish before leaving this workspace.');
      return false;
    }
  }

  await action();
  return true;
}

/**
 * Separates empty-manuscript onboarding copy from filtered-empty copy (F-15).
 */
export function describeEmptyOutlineState(
  totalSectionCount: number,
  hasActiveFilter: boolean
): string {
  if (totalSectionCount === 0) {
    return 'No chapters or scenes yet. Start writing in the editor or click Add chapter or Add scene above.';
  }
  if (hasActiveFilter) {
    return 'No sections match these filters.';
  }
  return 'No visible sections.';
}

/**
 * Builds an opt-in starter Chapter 1 + Opening Scene pair for newly created
 * projects when the author explicitly opts into a starter outline.
 */
export function createStarterManuscriptSections(
  projectName: string,
  premise?: string
): ManuscriptSection[] {
  const chapterId = crypto.randomUUID();
  const sceneId = crypto.randomUUID();
  const trimmedPremise = premise?.trim() ?? '';
  const synopsis = trimmedPremise
    ? trimmedPremise.slice(0, 280)
    : `Opening scene for ${projectName.trim() || 'your story'}.`;

  return [
    {
      id: chapterId,
      kind: 'chapter',
      title: 'Chapter 1',
      text: '',
    },
    {
      id: sceneId,
      kind: 'scene',
      chapterId,
      title: 'Opening Scene',
      synopsis,
      text: '',
    },
  ];
}
