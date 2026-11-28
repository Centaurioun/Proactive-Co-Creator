import React, { useMemo, useState } from 'react';
import type { CreativeProject } from '../../shared/types';
import { manuscriptSections } from '../../lib/narrative/manuscriptModel';
import type { CompanionPaneKind, WorkspaceMode } from '../../lib/workspacePreference';

export interface CommandPaletteActionItem {
  id: string;
  group: 'Navigation' | 'Scene' | 'Entity' | 'Creative Session' | 'Workspace Action';
  title: string;
  subtitle: string;
  keywords: string;
  run: () => void;
}

interface CommandPaletteModalProps {
  isOpen: boolean;
  onClose: () => void;
  project: CreativeProject;
  onNavigateWorkspace: (mode: WorkspaceMode) => void;
  onJumpToSection: (sectionId: string) => void;
  onInspectEntity: (entityId: string) => void;
  onOpenCreativeSession: (sessionId: string) => void;
  onOpenCompanion: (kind: CompanionPaneKind) => void;
  onOpenSearch: () => void;
  onOpenContextInspector: () => void;
  onOpenProposalsLocks: () => void;
}

export const CommandPaletteModal: React.FC<CommandPaletteModalProps> = ({
  isOpen,
  onClose,
  project,
  onNavigateWorkspace,
  onJumpToSection,
  onInspectEntity,
  onOpenCreativeSession,
  onOpenCompanion,
  onOpenSearch,
  onOpenContextInspector,
  onOpenProposalsLocks,
}) => {
  const [query, setQuery] = useState('');

  const handleClose = () => {
    setQuery('');
    onClose();
  };

  const items = useMemo<CommandPaletteActionItem[]>(() => {
    const list: CommandPaletteActionItem[] = [
      {
        id: 'nav-write',
        group: 'Navigation',
        title: 'Go to Write (Manuscript Studio)',
        subtitle: 'Open Working Manuscript · Yaz / Taslak Alanı',
        keywords: 'write yaz manuscript editor taslak',
        run: () => onNavigateWorkspace('write'),
      },
      {
        id: 'nav-world',
        group: 'Navigation',
        title: 'Go to World (Story Bible, Graph & Relationships)',
        subtitle: 'Inspect canonical entities, relationships, and Story Bible · Evren',
        keywords: 'world plan evren story bible graph',
        run: () => onNavigateWorkspace('world'),
      },
      {
        id: 'nav-studio',
        group: 'Navigation',
        title: 'Go to Creative Studio (Discover, Grill Me, Focused, Lab)',
        subtitle: 'Persistent sessions, ideation & interview · Yaratıcı Stüdyo',
        keywords: 'studio creative grill me discover keşfet yaratıcı stüdyo',
        run: () => onNavigateWorkspace('studio'),
      },
      {
        id: 'nav-develop',
        group: 'Navigation',
        title: 'Go to Story Development',
        subtitle: 'Scoped craft development & preservation policies · Hikaye Geliştirme',
        keywords: 'develop story development geliştirme craft',
        run: () => onNavigateWorkspace('develop'),
      },
      {
        id: 'nav-review',
        group: 'Navigation',
        title: 'Go to Review (Issues, Sync & History)',
        subtitle: 'Continuity review, sync & revision history · İnceleme',
        keywords: 'review sync issues inceleme geçmiş',
        run: () => onNavigateWorkspace('review'),
      },
      {
        id: 'nav-projects',
        group: 'Navigation',
        title: 'Go to Projects Hub',
        subtitle: 'Switch projects, backups & archives · Projeler',
        keywords: 'projects hub projeler yedek',
        run: () => onNavigateWorkspace('projects'),
      },
      {
        id: 'act-qa',
        group: 'Workspace Action',
        title: 'Open Story Q&A Companion',
        subtitle: 'Source-grounded canon Q&A side-by-side · Hikaye Soru-Cevap',
        keywords: 'qa question answer soru cevap canon',
        run: () => onOpenCompanion('qa'),
      },
      {
        id: 'act-search',
        group: 'Workspace Action',
        title: 'Open Narrative Search & Memory (E1)',
        subtitle: 'Hybrid keyword & semantic retrieval · Bellek Arama',
        keywords: 'search memory index arama bellek',
        run: onOpenSearch,
      },
      {
        id: 'act-inspector',
        group: 'Workspace Action',
        title: 'Open Context Inspector',
        subtitle: 'Inspect packed tokens, excluded sources & locks · Bağlam Denetçisi',
        keywords: 'context inspector token locks bağlam',
        run: onOpenContextInspector,
      },
      {
        id: 'act-e3',
        group: 'Workspace Action',
        title: 'Open Unified Proposal Review & Creative Locks (E3)',
        subtitle: 'Stage diffs, Visual Change Map (V7) & locks · Öneriler ve Kilitler',
        keywords: 'proposal diff change map locks e3 öneri kilit',
        run: onOpenProposalsLocks,
      },
    ];

    for (const sec of manuscriptSections(project).slice(0, 20)) {
      list.push({
        id: `sec-${sec.id}`,
        group: 'Scene',
        title: `Jump to Scene: ${sec.title || 'Untitled Scene'}`,
        subtitle: `${sec.kind} · ${(sec.text.match(/\S+/gu) ?? []).length} words`,
        keywords: `scene sahne chapter bölüm ${sec.title}`,
        run: () => onJumpToSection(sec.id),
      });
    }

    for (const ent of (project.snapshot.entities ?? []).filter((e) => !e.excluded).slice(0, 25)) {
      const entId = ent.id || ent.name;
      list.push({
        id: `ent-${entId}`,
        group: 'Entity',
        title: `Inspect Entity: ${ent.name}`,
        subtitle: `${ent.category || 'character'} · Open in World`,
        keywords: `entity karakter varlık ${ent.name} ${ent.category ?? ''}`,
        run: () => onInspectEntity(entId),
      });
    }

    for (const sess of (project.narrative?.creativeSessions ?? [])
      .filter((s) => s.status !== 'dismissed')
      .slice(0, 15)) {
      list.push({
        id: `sess-${sess.id}`,
        group: 'Creative Session',
        title: `Resume Session: ${sess.title}`,
        subtitle: `${sess.mode} · ${sess.scope.focusSummary}`,
        keywords: `session oturum ${sess.title} ${sess.mode} ${sess.scope.focusSummary}`,
        run: () => onOpenCreativeSession(sess.id),
      });
    }

    return list;
  }, [
    project,
    onNavigateWorkspace,
    onJumpToSection,
    onInspectEntity,
    onOpenCreativeSession,
    onOpenCompanion,
    onOpenSearch,
    onOpenContextInspector,
    onOpenProposalsLocks,
  ]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return items.slice(0, 14);
    return items
      .filter(
        (item) =>
          item.title.toLowerCase().includes(q) ||
          item.subtitle.toLowerCase().includes(q) ||
          item.keywords.toLowerCase().includes(q)
      )
      .slice(0, 18);
  }, [items, query]);

  if (!isOpen) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center bg-slate-950/75 px-4 pt-[12vh] backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
      aria-label="Command Palette"
      data-testid="command-palette-modal"
      onClick={(e) => {
        if (e.target === e.currentTarget) handleClose();
      }}
    >
      <div className="w-full max-w-2xl overflow-hidden rounded-2xl border border-pcc-line bg-pcc-surface shadow-2xl dark:border-pcc-dark-line dark:bg-pcc-dark-surface">
        <div className="flex items-center gap-2 border-b border-pcc-line px-4 py-3 dark:border-pcc-dark-line">
          <span className="rounded border border-pcc-line px-1.5 py-0.5 font-mono text-[10px] text-pcc-muted dark:border-pcc-dark-line">
            ⌘/Ctrl+K
          </span>
          <input
            type="text"
            autoFocus
            data-testid="command-palette-input"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Escape') handleClose();
              if (e.key === 'Enter' && filtered[0]) {
                filtered[0].run();
                handleClose();
              }
            }}
            placeholder="Search scenes, characters, sessions, or jump anywhere (EN / TR)…"
            className="w-full bg-transparent text-sm text-pcc-ink outline-none placeholder:text-pcc-muted dark:text-pcc-dark-ink"
          />
          <button
            type="button"
            onClick={handleClose}
            className="rounded px-2 py-1 text-xs text-pcc-muted hover:bg-pcc-canvas dark:hover:bg-pcc-dark-canvas"
          >
            Esc
          </button>
        </div>

        <div className="max-h-[55vh] divide-y divide-pcc-line/60 overflow-y-auto dark:divide-pcc-dark-line/60">
          {filtered.length === 0 ? (
            <div className="p-6 text-center text-xs text-pcc-muted">
              No matching command, scene, entity, or creative session.
            </div>
          ) : (
            filtered.map((item) => (
              <button
                key={item.id}
                type="button"
                data-testid={`command-item-${item.id}`}
                onClick={() => {
                  item.run();
                  handleClose();
                }}
                className="flex w-full items-center justify-between gap-3 px-4 py-2.5 text-left hover:bg-pcc-canvas focus-visible:bg-pcc-canvas focus-visible:outline-none dark:hover:bg-pcc-dark-canvas"
              >
                <div className="min-w-0">
                  <div className="truncate text-xs font-semibold text-pcc-ink dark:text-pcc-dark-ink">
                    {item.title}
                  </div>
                  <div className="truncate text-[11px] text-pcc-muted dark:text-pcc-dark-muted">
                    {item.subtitle}
                  </div>
                </div>
                <span className="shrink-0 rounded border border-pcc-line px-1.5 py-0.5 text-[10px] font-medium text-pcc-muted dark:border-pcc-dark-line">
                  {item.group}
                </span>
              </button>
            ))
          )}
        </div>
      </div>
    </div>
  );
};
