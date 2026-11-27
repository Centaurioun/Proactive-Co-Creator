/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

export function shouldOpenAdoptionOnPropChange(
  prevInitialArtifactId: string | undefined,
  nextInitialArtifactId: string | undefined
): boolean {
  return Boolean(nextInitialArtifactId && nextInitialArtifactId !== prevInitialArtifactId);
}

export function shouldBlockActionDuringComposition(isComposing: boolean): boolean {
  return isComposing;
}

export function resolveSplitOffset(
  previewSection: boolean,
  textareaSelectionStart: number | undefined,
  selectionRangeStart: number
): number {
  if (previewSection) return selectionRangeStart;
  return textareaSelectionStart ?? selectionRangeStart;
}

export function computeEditorDirtyAfterDraftDiscard(styleProfileDirty: boolean): boolean {
  return styleProfileDirty;
}
