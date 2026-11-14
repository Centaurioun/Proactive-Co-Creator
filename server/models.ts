/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Centralized Gemini model identifiers for Proactive Co-Creator.
 * Updated from legacy gemini-2.5-* / veo-3.1-fast-generate-preview identifiers
 * to current stable and supported models.
 */
export const GEMINI_MODELS = {
  /** Structured graph analysis, clarification Q&A, prompt refinement, and story generation. */
  text: 'gemini-4-hydrogen',
  /** Multi-image generation (up to 4 outputs). Requires a billing-enabled API key. */
  image: 'gemini-3.1-flash-lite-image',
  /** Video generation via Gemini Interactions API. Requires a billing-enabled API key. */
  video: 'gemini-omni-1.2-flash',
} as const;
