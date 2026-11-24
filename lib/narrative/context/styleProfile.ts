export type StyleTrait = 'pov' | 'voice' | 'tense' | 'rhythm' | 'dialogue' | 'atmosphere';
export interface StyleEvidence { kind: 'source'; recordId: string; version: string; digest: string; start: number; end: number; excerpt: string }
export interface StyleObservationInput { id: string; trait: StyleTrait; value: string; interpretation: 'observation' | 'interpretation'; scope: { kind: 'manuscript' } | { kind: 'section'; sectionId: string }; evidence: StyleEvidence }
export interface StyleObservation extends StyleObservationInput { status: 'pending' | 'confirmed' | 'rejected' }
export interface StyleProfile { projectId: string; observations: StyleObservation[] }
export interface StyleSourceRef { recordId: string; version: string; digest: string }
export function createStyleProfile(projectId: string): StyleProfile { return { projectId, observations: [] }; }
export function createStyleObservation(input: StyleObservationInput): StyleObservation { return { ...input, status: 'pending' }; }
export function reviewStyleObservation(profile: StyleProfile, id: string, status: 'confirmed' | 'rejected', resolve: (ref: StyleSourceRef) => string | { digest: string; text: string } | undefined): StyleProfile {
  const observation = profile.observations.find(item => item.id === id);
  if (!observation) throw new Error('Style observation not found');
  if (status === 'confirmed') {
    const source = resolve(observation.evidence);
    const text = typeof source === 'string' ? source : source?.digest === observation.evidence.digest ? source.text : undefined;
    if (text === undefined || text.slice(observation.evidence.start, observation.evidence.end) !== observation.evidence.excerpt) throw new Error('Style evidence source span is stale or does not match');
  }
  return { ...profile, observations: profile.observations.map(item => item.id === id ? { ...item, status } : item) };
}
export function selectStyleContext(profile: StyleProfile, projectId: string, sectionId: string): { guidance: StyleObservation[]; conflicts: Array<{ trait: StyleTrait }> } {
  if (profile.projectId !== projectId) return { guidance: [], conflicts: [] };
  const relevant = profile.observations.filter(item => item.status === 'confirmed' && (item.scope.kind === 'manuscript' || item.scope.sectionId === sectionId));
  const byTrait = new Map<StyleTrait, StyleObservation[]>();
  for (const item of relevant) byTrait.set(item.trait, [...(byTrait.get(item.trait) ?? []), item]);
  const guidance: StyleObservation[] = [], conflicts: Array<{ trait: StyleTrait }> = [];
  for (const [trait, items] of byTrait) {
    const values = new Set(items.map(item => item.value));
    if (values.size > 1) conflicts.push({ trait }); else guidance.push(items[items.length - 1]);
  }
  return { guidance, conflicts };
}
