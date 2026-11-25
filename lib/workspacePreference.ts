export type WorkspaceMode = 'write' | 'plan' | 'review';

export interface WorkspacePreferenceStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

export const WORKSPACE_PREFERENCE_KEY = 'proactive_co_creator_workspace_preference_v1';

function browserPreferenceStorage(): WorkspacePreferenceStorage | null {
  try {
    return typeof window === 'undefined' ? null : window.localStorage;
  } catch {
    return null;
  }
}

const isWorkspaceMode = (value: unknown): value is WorkspaceMode =>
  value === 'write' || value === 'plan' || value === 'review';

export function readWorkspacePreference(storage: WorkspacePreferenceStorage | null | undefined): WorkspaceMode {
  if (!storage) return 'write';
  try {
    const raw = storage.getItem(WORKSPACE_PREFERENCE_KEY);
    if (!raw) return 'write';
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') return 'write';
    const preference = parsed as { version?: unknown; mode?: unknown };
    return preference.version === 1 && isWorkspaceMode(preference.mode) ? preference.mode : 'write';
  } catch {
    return 'write';
  }
}

export function writeWorkspacePreference(
  storage: WorkspacePreferenceStorage | null | undefined,
  mode: WorkspaceMode
): boolean {
  if (!storage || !isWorkspaceMode(mode)) return false;
  try {
    storage.setItem(WORKSPACE_PREFERENCE_KEY, JSON.stringify({ version: 1, mode }));
    return true;
  } catch {
    return false;
  }
}

export function readBrowserWorkspacePreference(): WorkspaceMode {
  return readWorkspacePreference(browserPreferenceStorage());
}

export function writeBrowserWorkspacePreference(mode: WorkspaceMode): boolean {
  return writeWorkspacePreference(browserPreferenceStorage(), mode);
}
