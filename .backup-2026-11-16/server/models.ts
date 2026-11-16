/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Centralized Gemini model identifiers for Proactive Co-Creator 2.0.
 * Supports Story (primary) and Image (secondary) workflows.
 */
export const GEMINI_MODELS = {
  /** Structured graph analysis, adaptive clarification Q&A, natural-language batch editing, prompt refinement, and story generation. */
  text: 'gemini-4-hydrogen',
  /** Multi-image generation (up to 4 outputs). Requires a billing-enabled API key. */
  image: 'gemini-3.1-flash-lite-image',
} as const;
