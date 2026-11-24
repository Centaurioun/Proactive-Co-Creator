import type { NarrativeExtraction } from '../../../shared/importSchemas.ts';

export type ExtractionCategory = 'characters' | 'attributes' | 'relationships' | 'locations' | 'objects' | 'events' | 'story-bible' | 'themes-style' | 'continuity';

export function filterExtractionScope(extraction: NarrativeExtraction, categories: readonly ExtractionCategory[]): NarrativeExtraction {
  const selected = new Set(categories);
  const entityCategory = (category: NarrativeExtraction['entities'][number]['category']) => {
    if (category === 'character' || category === 'group') return selected.has('characters');
    if (category === 'location') return selected.has('locations');
    if (category === 'object') return selected.has('objects');
    if (category === 'event' || category === 'scene') return selected.has('events');
    return false;
  };
  const findingCategory = (category: NarrativeExtraction['findings'][number]['category']) => {
    if (category === 'character') return selected.has('characters');
    if (category === 'location') return selected.has('locations');
    if (category === 'object') return selected.has('objects');
    if (category === 'event') return selected.has('events');
    if (category === 'story-bible') return selected.has('story-bible');
    if (category === 'theme' || category === 'style') return selected.has('themes-style');
    return false;
  };
  return {
    findings: extraction.findings.filter(item => findingCategory(item.category)),
    entities: extraction.entities.filter(item => entityCategory(item.category) ||
      (selected.has('attributes') && item.attributes.length > 0)).map(item => ({
      ...item, attributes: selected.has('attributes') ? item.attributes : [],
    })),
    relationships: selected.has('relationships') ? extraction.relationships : [],
    ambiguities: selected.has('continuity') ? extraction.ambiguities : [],
  };
}
