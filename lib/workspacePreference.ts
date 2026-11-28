export type WorkspaceMode =
  | 'write'
  | 'plan'
  | 'world'
  | 'studio'
  | 'develop'
  | 'review'
  | 'projects'
  | 'import';

export type WorkspaceDisclosureMode = 'calm' | 'deep';

export type CompanionPaneKind =
  | 'none'
  | 'entity'
  | 'story-bible'
  | 'source'
  | 'qa'
  | 'studio'
  | 'story-map';

export interface CompanionPaneState {
  kind: CompanionPaneKind;
  targetId?: string;
  widthPercent: number;
}

export interface WorkspaceResumeBreadcrumb {
  projectId: string;
  mode: WorkspaceMode;
  label: string;
  sectionId?: string;
  entityId?: string;
  sessionId?: string;
  timestamp: number;
}

export interface WorkspacePreferenceStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

export const WORKSPACE_PREFERENCE_KEY = 'proactive_co_creator_workspace_preference_v1';
export const WORKSPACE_DISCLOSURE_KEY = 'proactive_co_creator_workspace_disclosure_v1';
export const WORKSPACE_COMPANION_KEY = 'proactive_co_creator_workspace_companion_v1';
export const WORKSPACE_RESUME_KEY = 'proactive_co_creator_workspace_resume_v1';

function browserPreferenceStorage(): WorkspacePreferenceStorage | null {
  try {
    return typeof window === 'undefined' ? null : window.localStorage;
  } catch {
    return null;
  }
}

const isPersistableWorkspaceMode = (value: unknown): value is WorkspaceMode =>
  value === 'write' ||
  value === 'plan' ||
  value === 'world' ||
  value === 'studio' ||
  value === 'develop' ||
  value === 'review';

export function readWorkspacePreference(
  storage: WorkspacePreferenceStorage | null | undefined
): WorkspaceMode {
  if (!storage) return 'write';
  try {
    const raw = storage.getItem(WORKSPACE_PREFERENCE_KEY);
    if (!raw) return 'write';
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') return 'write';
    const preference = parsed as { version?: unknown; mode?: unknown };
    return preference.version === 1 && isPersistableWorkspaceMode(preference.mode)
      ? preference.mode
      : 'write';
  } catch {
    return 'write';
  }
}

export function writeWorkspacePreference(
  storage: WorkspacePreferenceStorage | null | undefined,
  mode: WorkspaceMode
): boolean {
  if (!storage || !isPersistableWorkspaceMode(mode)) return false;
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

export function readBrowserDisclosurePreference(): WorkspaceDisclosureMode {
  const storage = browserPreferenceStorage();
  if (!storage) return 'calm';
  try {
    const raw = storage.getItem(WORKSPACE_DISCLOSURE_KEY);
    return raw === 'deep' ? 'deep' : 'calm';
  } catch {
    return 'calm';
  }
}

export function writeBrowserDisclosurePreference(
  mode: WorkspaceDisclosureMode
): boolean {
  const storage = browserPreferenceStorage();
  if (!storage) return false;
  try {
    storage.setItem(WORKSPACE_DISCLOSURE_KEY, mode);
    return true;
  } catch {
    return false;
  }
}

export function readBrowserCompanionState(): CompanionPaneState {
  const storage = browserPreferenceStorage();
  if (!storage) return { kind: 'none', widthPercent: 38 };
  try {
    const raw = storage.getItem(WORKSPACE_COMPANION_KEY);
    if (!raw) return { kind: 'none', widthPercent: 38 };
    const parsed = JSON.parse(raw) as Partial<CompanionPaneState>;
    const validKinds = new Set<CompanionPaneKind>([
      'none',
      'entity',
      'story-bible',
      'source',
      'qa',
      'studio',
      'story-map',
    ]);
    const kind = validKinds.has(parsed.kind as CompanionPaneKind)
      ? (parsed.kind as CompanionPaneKind)
      : 'none';
    const widthPercent =
      typeof parsed.widthPercent === 'number' &&
      parsed.widthPercent >= 25 &&
      parsed.widthPercent <= 60
        ? parsed.widthPercent
        : 38;
    return {
      kind,
      targetId: typeof parsed.targetId === 'string' ? parsed.targetId : undefined,
      widthPercent,
    };
  } catch {
    return { kind: 'none', widthPercent: 38 };
  }
}

export function writeBrowserCompanionState(state: CompanionPaneState): boolean {
  const storage = browserPreferenceStorage();
  if (!storage) return false;
  try {
    storage.setItem(WORKSPACE_COMPANION_KEY, JSON.stringify(state));
    return true;
  } catch {
    return false;
  }
}

export function readBrowserResumeBreadcrumb(
  projectId: string
): WorkspaceResumeBreadcrumb | null {
  const storage = browserPreferenceStorage();
  if (!storage) return null;
  try {
    const raw = storage.getItem(`${WORKSPACE_RESUME_KEY}:${projectId}`);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as WorkspaceResumeBreadcrumb;
    if (!parsed || parsed.projectId !== projectId) return null;
    return parsed;
  } catch {
    return null;
  }
}

export function writeBrowserResumeBreadcrumb(
  crumb: WorkspaceResumeBreadcrumb
): boolean {
  const storage = browserPreferenceStorage();
  if (!storage) return false;
  try {
    storage.setItem(`${WORKSPACE_RESUME_KEY}:${crumb.projectId}`, JSON.stringify(crumb));
    return true;
  } catch {
    return false;
  }
}
