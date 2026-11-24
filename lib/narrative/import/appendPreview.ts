import type { ManuscriptSection } from '../../../shared/narrativeTypes.ts';

export interface AppendSourceRef { id: string; version: string; digest: string }
export interface AppendTargetSnapshot {
  projectId: string; revision: number; manuscriptVersionId: string; manuscriptDigest: string;
  sections: ManuscriptSection[]; sources: AppendSourceRef[];
}
export interface AppendIdentityCandidate { incomingEntityId: string; existingEntityId: string; matchedName: string }
export interface AppendPreviewRequest {
  target: AppendTargetSnapshot; source: AppendSourceRef; incomingSections: ManuscriptSection[];
  insertAfterSectionId: string | null; proposalId: string; createId: () => string;
  identityCandidates?: AppendIdentityCandidate[];
}
export interface AppendPreview {
  projectId: string; revision: number; manuscriptVersionId: string; manuscriptDigest: string;
  source: AppendSourceRef; status: 'ready' | 'duplicate-source' | 'needs-identity-review'; canApply: false;
  sections: ManuscriptSection[]; identityConflicts: Array<AppendIdentityCandidate & { status: 'unresolved' }>;
}

export function createAppendPreview(request: AppendPreviewRequest): AppendPreview {
  const { target, source } = request;
  const duplicate = target.sources.some(item => item.id === source.id && item.version === source.version && item.digest === source.digest);
  const identityConflicts = (request.identityCandidates ?? []).map(item => ({ ...item, status: 'unresolved' as const }));
  if (duplicate) return { ...target, source, status: 'duplicate-source', canApply: false, sections: [...target.sections], identityConflicts };
  const insertion = request.insertAfterSectionId === null ? target.sections.length : target.sections.findIndex(item => item.id === request.insertAfterSectionId) + 1;
  if (insertion < 0 || (request.insertAfterSectionId !== null && insertion === 0)) throw new Error('Append insertion point does not exist');
  const remap = new Map<string, string>();
  for (const section of request.incomingSections) remap.set(section.id, request.createId());
  const added = request.incomingSections.map(section => ({ ...section, id: remap.get(section.id)!, ...(section.chapterId ? { chapterId: remap.get(section.chapterId) ?? section.chapterId } : {}) }));
  return {
    projectId: target.projectId, revision: target.revision, manuscriptVersionId: target.manuscriptVersionId,
    manuscriptDigest: target.manuscriptDigest, source, status: identityConflicts.length ? 'needs-identity-review' : 'ready',
    canApply: false, sections: [...target.sections.slice(0, insertion), ...added, ...target.sections.slice(insertion)], identityConflicts,
  };
}

export function revalidateAppendPreview(preview: AppendPreview, current: AppendTargetSnapshot): 'ready' | 'stale' | 'wrong-project' | 'duplicate-source' {
  if (preview.projectId !== current.projectId) return 'wrong-project';
  if (current.sources.some(item => item.id === preview.source.id && item.version === preview.source.version && item.digest === preview.source.digest)) return 'duplicate-source';
  if (preview.revision !== current.revision || preview.manuscriptVersionId !== current.manuscriptVersionId || preview.manuscriptDigest !== current.manuscriptDigest) return 'stale';
  return 'ready';
}
