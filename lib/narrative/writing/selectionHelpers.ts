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
 * Extracts strictly confirmed canonical context, bounded scene metadata, preceding scene excerpt,
 * confirmed relationships, explicit exclusions, and separately labeled epistemic notes
 * for AI Writing Assistant requests. Beliefs and reported claims are never merged into confirmed world facts.
 */
export function extractConfirmedWritingContext(
  project: CreativeProject,
  sectionId: string
): {
  confirmedEntities: Array<{ name: string; summary: string }>;
  confirmedStoryBible: Record<string, string>;
  styleGuidance: string[];
  sceneMetadata?: {
    kind: 'chapter' | 'scene';
    chapterTitle?: string;
    pov?: string;
    location?: string;
    chronology?: string;
    purpose?: string;
    synopsis?: string;
  };
  precedingSceneContext?: {
    sectionId: string;
    title: string;
    excerpt: string;
  };
  relevantRelationships: Array<{ source: string; target: string; label: string; epistemicKind?: string }>;
  epistemicNotes: Array<{ subject: string; kind: string; detail: string }>;
  explicitExclusions: string[];
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

  // Separately collect belief/reported epistemic notes so AI treats them as character perspective, never settled truth
  const epistemicNotes: Array<{ subject: string; kind: string; detail: string }> = [];
  for (const entity of project.snapshot.entities) {
    if (entity.excluded) continue;
    if (entity.epistemicKind === 'belief' || entity.epistemicKind === 'reported') {
      epistemicNotes.push({
        subject: entity.name.slice(0, 160),
        kind: entity.epistemicKind,
        detail: (entity.description || `${entity.epistemicKind} claim`).slice(0, 300),
      });
    }
    for (const attr of entity.attributes) {
      if (attr.epistemicKind === 'belief' || attr.epistemicKind === 'reported') {
        const val = attr.confirmedValue ?? attr.value[0]?.name ?? '';
        if (val) {
          epistemicNotes.push({
            subject: entity.name.slice(0, 160),
            kind: attr.epistemicKind,
            detail: `${attr.name}: ${val}`.slice(0, 300),
          });
        }
      }
    }
    if (epistemicNotes.length >= 15) break;
  }

  // Confirmed relationships involving non-excluded entities
  const excludedNames = new Set(
    project.snapshot.entities.filter((e) => e.excluded).map((e) => e.name.toLowerCase())
  );
  const relevantRelationships = project.snapshot.relationships
    .filter(
      (r) =>
        r.status === 'confirmed' &&
        !excludedNames.has(r.source.toLowerCase()) &&
        !excludedNames.has(r.target.toLowerCase())
    )
    .slice(0, 16)
    .map((r) => ({
      source: r.source.slice(0, 160),
      target: r.target.slice(0, 160),
      label: r.label.slice(0, 160),
      ...(r.epistemicKind ? { epistemicKind: r.epistemicKind } : {}),
    }));

  // Explicit exclusions from excluded entities + Story Bible explicitExclusions
  const bibleExclusions = (project.snapshot.storyBible.explicitExclusions?.value ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  const explicitExclusions = Array.from(
    new Set([
      ...project.snapshot.entities.filter((e) => e.excluded).map((e) => e.name.trim()).filter(Boolean),
      ...bibleExclusions,
    ])
  ).slice(0, 25);

  // Active manuscript sections for current scene metadata and immediately preceding scene excerpt
  const activeVersion = project.narrative?.versions.find(
    (v) => v.id === project.snapshot.manuscriptVersionId
  );
  const sectionByVersionId = new Map(
    (project.narrative?.sectionVersions ?? []).map((sv) => [sv.id, sv.section])
  );
  const orderedSections = (activeVersion?.sectionVersionIds ?? [])
    .map((id) => sectionByVersionId.get(id))
    .filter((s): s is NonNullable<typeof s> => Boolean(s));

  const currentIdx = orderedSections.findIndex((s) => s.id === sectionId);
  const currentSection = currentIdx >= 0 ? orderedSections[currentIdx] : undefined;
  let sceneMetadata:
    | {
        kind: 'chapter' | 'scene';
        chapterTitle?: string;
        pov?: string;
        location?: string;
        chronology?: string;
        purpose?: string;
        synopsis?: string;
      }
    | undefined;
  if (currentSection) {
    const parentChapter = currentSection.chapterId
      ? orderedSections.find((s) => s.id === currentSection.chapterId)
      : undefined;
    sceneMetadata = {
      kind: currentSection.kind,
      ...(parentChapter?.title ? { chapterTitle: parentChapter.title.slice(0, 200) } : {}),
      ...(currentSection.pov?.trim() ? { pov: currentSection.pov.trim().slice(0, 160) } : {}),
      ...(currentSection.location?.trim() ? { location: currentSection.location.trim().slice(0, 160) } : {}),
      ...(currentSection.chronology?.trim() ? { chronology: currentSection.chronology.trim().slice(0, 160) } : {}),
      ...(currentSection.purpose?.trim() ? { purpose: currentSection.purpose.trim().slice(0, 300) } : {}),
      ...(currentSection.synopsis?.trim() ? { synopsis: currentSection.synopsis.trim().slice(0, 500) } : {}),
    };
  }

  let precedingSceneContext: { sectionId: string; title: string; excerpt: string } | undefined;
  if (currentIdx > 0) {
    for (let i = currentIdx - 1; i >= 0; i -= 1) {
      const prev = orderedSections[i];
      const trimmed = prev.text.trim();
      if (!trimmed) continue;
      let start = Math.max(0, trimmed.length - 1_200);
      while (start < trimmed.length && !isTextBoundary(trimmed, start)) start += 1;
      precedingSceneContext = {
        sectionId: prev.id,
        title: (prev.title || prev.kind).slice(0, 200),
        excerpt: trimmed.slice(start),
      };
      break;
    }
  }

  // Include confirmed style observations relevant to the whole manuscript or this exact section
  const styleGuidance = (activeVersion?.styleProfile?.observations ?? [])
    .filter(
      (obs) =>
        obs.status === 'confirmed' &&
        (obs.scope.kind === 'manuscript' || obs.scope.sectionId === sectionId)
    )
    .slice(0, 8)
    .map((obs) => `${obs.trait} (${obs.interpretation}): ${obs.value}`);

  return {
    confirmedEntities,
    confirmedStoryBible,
    styleGuidance,
    ...(sceneMetadata ? { sceneMetadata } : {}),
    ...(precedingSceneContext ? { precedingSceneContext } : {}),
    relevantRelationships,
    epistemicNotes: epistemicNotes.slice(0, 15),
    explicitExclusions,
  };
}
