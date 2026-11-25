export type SavePresentation = 'draft-unsaved' | 'project-unsaved' | 'saving' | 'saved' | 'conflict' | 'failed' | 'restoring';

export function getSavePresentation(input: {
  restoring: boolean;
  draftDirty: boolean;
  savePending: boolean;
  projectPersisted: boolean;
  storageState: 'conflict' | 'failed' | null;
}): SavePresentation {
  if (input.restoring) return 'restoring';
  if (input.storageState) return input.storageState;
  if (input.draftDirty) return 'draft-unsaved';
  if (input.savePending) return 'saving';
  return input.projectPersisted ? 'saved' : 'project-unsaved';
}
