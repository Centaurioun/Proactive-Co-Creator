import type { ManuscriptSection } from '../../shared/narrativeTypes.ts';

export interface ManuscriptNavigation { chapters: Array<{ chapter: ManuscriptSection; scenes: ManuscriptSection[] }>; unchaptered: ManuscriptSection[]; orphaned: ManuscriptSection[] }
export function buildManuscriptNavigation(sections: ManuscriptSection[]): ManuscriptNavigation {
  const chapters = sections.filter(item => item.kind === 'chapter').map(chapter => ({ chapter, scenes: sections.filter(scene => scene.kind === 'scene' && scene.chapterId === chapter.id) }));
  const chapterIds = new Set(chapters.map(group => group.chapter.id));
  const scenes = sections.filter(item => item.kind === 'scene');
  return { chapters, unchaptered: scenes.filter(scene => !scene.chapterId), orphaned: scenes.filter(scene => !!scene.chapterId && !chapterIds.has(scene.chapterId)) };
}
export function filterManuscriptSections(sections: ManuscriptSection[], filter: { query?: string; chapterId?: string; chronology?: string }): ManuscriptSection[] {
  const query = filter.query?.toLocaleLowerCase() ?? '';
  return sections.filter(section => {
    if (filter.chapterId && !(section.id === filter.chapterId || section.chapterId === filter.chapterId)) return false;
    if (filter.chronology && section.chronology !== filter.chronology) return false;
    const searchText = [section.title, section.text, section.characters, section.pov, section.location, section.chronology, section.purpose].filter(Boolean).join('\n').toLocaleLowerCase();
    return !query || searchText.includes(query);
  });
}
