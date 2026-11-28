/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import {
  tryGetEffectiveStoryProviderSelection,
  validateStoryProviderSelection,
  type AiProviderSelection,
} from '../../services/apiClient';

export const STORY_PROVIDER_FALLBACK: AiProviderSelection = {
  connectionId: 'gemini-managed',
};

export function readSafeStoryProviderSelection(): AiProviderSelection {
  const result = tryGetEffectiveStoryProviderSelection();
  return result.ok ? result.selection : STORY_PROVIDER_FALLBACK;
}

export function resolveStoryProviderPreflight(
  localActivation: boolean
): { ok: true; selection: AiProviderSelection } | { ok: false; errorMessage: string } {
  const result = tryGetEffectiveStoryProviderSelection();
  if (!result.ok) {
    return { ok: false, errorMessage: result.error.message };
  }
  const selected = result.selection;
  if (selected.connectionId === 'chatgpt-plan') {
    if (!localActivation) {
      return {
        ok: false,
        errorMessage:
          'ChatGPT Story is disabled for this local server process. No provider request was sent.',
      };
    }
    if (!selected.modelId) {
      return {
        ok: false,
        errorMessage:
          'Choose a verified ChatGPT account model explicitly in AI Settings. No provider request was sent.',
      };
    }
    const validation = validateStoryProviderSelection(selected, localActivation);
    if (!validation.ok) {
      return {
        ok: false,
        errorMessage: validation.reason,
      };
    }
  }
  return { ok: true, selection: selected };
}
