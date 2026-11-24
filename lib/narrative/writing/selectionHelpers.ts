import { isTextBoundary } from '../evidenceRegistry.ts';
import { getEffectiveAttributeValue } from '../../beliefGraphUtils.ts';
import type { CreativeProject } from '../../../shared/types.ts';

export interface ValidatedTextSelection {
  ok: boolean;
  start: number;
  end: number;
  selectedText: string;
  contextBefore: string;
  contextAfter: string;
  textDigest: string;
  error?: string;
}

export function computeTextDigest(text: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i += 1) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return `txt_${text.length}_${hash.toString(16).padStart(8, '0')}`;
}

/**
 * Validates UTF-16 selection bounds safely without splitting surrogate pairs,
 * returning bounded surrounding context and a text digest to detect concurrent edits.
 */
export function validateTextSelection(
  text: string,
  rawStart: number,
  rawEnd: number,
  contextWindowChars = 1500
): ValidatedTextSelection {
  const start = Math.max(0, Math.min(text.length, Math.trunc(rawStart)));
  const end = Math.max(start, Math.min(text.length, Math.trunc(rawEnd)));
  const textDigest = computeTextDigest(text);

  if (!isTextBoundary(text, start) || !isTextBoundary(text, end)) {
    return {
      ok: false,
      start,
      end,
      selectedText: '',
      contextBefore: '',
      contextAfter: '',
      textDigest,
      error: 'Selection splits a Unicode character pair. Adjust the cursor selection and retry.',
    };
  }

  let beforeStart = Math.max(0, start - contextWindowChars);
  while (beforeStart > 0 && !isTextBoundary(text, beforeStart)) beforeStart -= 1;

  let afterEnd = Math.min(text.length, end + contextWindowChars);
  while (afterEnd < text.length && !isTextBoundary(text, afterEnd)) afterEnd += 1;

  return {
    ok: true,
    start,
    end,
    selectedText: text.slice(start, end),
    contextBefore: text.slice(beforeStart, start),
    contextAfter: text.slice(end, afterEnd),
    textDigest,
  };
}

export function applyWritingSelectionEdit(params: {
  currentText: string;
  expectedDigest: string;
  start: number;
  end: number;
  proposedText: string;
  mode: 'replace' | 'insert-after';
}): { ok: true; nextText: string } | { ok: false; error: string } {
  const { currentText, expectedDigest, start, end, proposedText, mode } = params;
  if (computeTextDigest(currentText) !== expectedDigest) {
    return {
      ok: false,
      error: 'The section text was edited while this AI suggestion was generated. Copy the suggestion or re-run the assistant on the current text.',
    };
  }
  if (start < 0 || end < start || end > currentText.length || !isTextBoundary(currentText, start) || !isTextBoundary(currentText, end)) {
    return {
      ok: false,
      error: 'The original selection bounds are no longer valid.',
    };
  }
  if (mode === 'replace') {
    return {
      ok: true,
      nextText: currentText.slice(0, start) + proposedText + currentText.slice(end),
    };
  }
  const spacer = end > 0 && !currentText.slice(0, end).endsWith('\n') && !proposedText.startsWith('\n') ? '\n\n' : '';
  return {
    ok: true,
    nextText: currentText.slice(0, end) + spacer + proposedText + currentText.slice(end),
  };
}

/**
 * Extracts strictly confirmed canonical context and confirmed non-conflicting style guidance
 * for AI Writing Assistant requests. Unattributed beliefs, reported claims, and pending items are excluded.
 */
export function extractConfirmedWritingContext(
  project: CreativeProject,
  sectionId: string
): {
  confirmedEntities: Array<{ name: string; summary: string }>;
  confirmedStoryBible: Record<string, string>;
  styleGuidance: string[];
} {
  const confirmedEntities = project.snapshot.entities
    .filter((e) => !e.excluded && e.status === 'confirmed' && e.epistemicKind !== 'belief' && e.epistemicKind !== 'reported')
    .slice(0, 25)
    .map((e) => {
      const confirmedAttrs = e.attributes
        .filter(
          (a) =>
            a.name !== 'existence' &&
            a.name !== 'existence_in_image' &&
            a.status === 'confirmed' &&
            a.epistemicKind !== 'belief' &&
            a.epistemicKind !== 'reported'
        )
        .map((a) => `${a.name}: ${getEffectiveAttributeValue(a)}`)
        .slice(0, 6);
      const desc = e.description ? `${e.description.slice(0, 140)}` : '';
      return {
        name: e.name,
        summary: [desc, ...confirmedAttrs].filter(Boolean).join(' · ').slice(0, 380) || 'Confirmed entity',
      };
    });

  const confirmedStoryBible: Record<string, string> = {};
  for (const [key, field] of Object.entries(project.snapshot.storyBible)) {
    if (field.status === 'confirmed' && field.value.trim()) {
      confirmedStoryBible[key] = field.value.trim().slice(0, 480);
    }
  }

  // Include confirmed style observations relevant to the whole manuscript or this exact section
  const activeVersion = project.narrative?.versions.find(
    (v) => v.id === project.snapshot.manuscriptVersionId
  );
  const styleGuidance = (activeVersion?.styleProfile?.observations ?? [])
    .filter(
      (obs) =>
        obs.status === 'confirmed' &&
        (obs.scope.kind === 'manuscript' || obs.scope.sectionId === sectionId)
    )
    .slice(0, 8)
    .map((obs) => `${obs.trait} (${obs.interpretation}): ${obs.value}`);

  return { confirmedEntities, confirmedStoryBible, styleGuidance };
}
