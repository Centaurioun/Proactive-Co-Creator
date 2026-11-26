/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import type { GenerationArtifact, GenerationMode } from '../../shared/types';

export function resolveActiveArtifactSelection(
  artifacts: GenerationArtifact[],
  mode: GenerationMode,
  selectedArtifactId: string | null
): {
  modeArtifacts: GenerationArtifact[];
  activeArtifact: GenerationArtifact | null;
  validSelectedId: string | null;
} {
  const modeArtifacts = artifacts.filter((a) => a.mode === mode);
  const matched = selectedArtifactId
    ? modeArtifacts.find((a) => a.id === selectedArtifactId) ?? null
    : null;
  const activeArtifact = matched ?? modeArtifacts[0] ?? null;
  return {
    modeArtifacts,
    activeArtifact,
    validSelectedId: matched ? matched.id : null,
  };
}

export function shouldResetArtifactSelection(
  previousArtifactIds: string[],
  nextArtifactIds: string[],
  currentSelectedId: string | null
): boolean {
  if (!currentSelectedId) return false;
  if (!nextArtifactIds.includes(currentSelectedId)) return true;
  if (nextArtifactIds.length > 0 && nextArtifactIds[0] !== previousArtifactIds[0]) {
    return true;
  }
  return false;
}

export function shouldCloseLightbox(
  mode: GenerationMode,
  displayedImages: string[],
  selectedImage: string | null
): boolean {
  if (!selectedImage) return false;
  if (mode !== 'image') return true;
  return !displayedImages.includes(selectedImage);
}
