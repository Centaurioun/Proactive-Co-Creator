/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useEffect, useMemo, useState } from 'react';
import AttributeEditor from './AttributeEditor';
import { getEffectiveAttributeValue, isSceneEntityName } from '../lib/beliefGraphUtils';
import { resolveConsistencyIssueTarget } from '../lib/consistencyChecker';
import { manuscriptSections } from '../lib/narrative/manuscriptModel';
import OpportunityCenter from './opportunities/OpportunityCenter';
import type { OpportunityProposalInput, OpportunityProposalStatus } from '../lib/narrative/opportunityProposals';
import { computePromptDigest } from '../lib/promptBuilder';
import type {
  ConsistencyIssue,
  ConsistencyIssueTarget,
  CreativeProject,
  Entity,
  EntityCategory,
  Relationship,
  StoryBibleFields,
} from '../shared/types';

export type RightPanelTab = 'inspector' | 'story-bible' | 'consistency' | 'history' | 'timeline' | 'opportunities';

interface ContextualInspectorProps {
  activeTab: RightPanelTab;
  onSelectTab: (tab: RightPanelTab) => void;
  project: CreativeProject;
  savedProjects: CreativeProject[];
  selectedEntity: Entity | null;
  selectedRelationship: Relationship | null;
  onSelectEntity: (entity: Entity | null) => void;
  onSelectRelationship: (relationship: Relationship | null) => void;
  onAttributeChange: (entityName: string, attributeName: string, newValue: string) => void;
  onRenameEntity: (entityIdOrName: string, newName: string) => void;
  onAddEntity: (name: string, category: EntityCategory, description: string) => void;
  onUpsertRelationship: (source: string, target: string, label: string) => void;
  onUpdateRelationshipById: (
    relationshipId: string,
    updates: {
      label?: string;
      status?: 'confirmed' | 'rejected' | 'pending';
      reverseDirection?: boolean;
    }
  ) => void;
  onRemoveRelationship: (relIdOrSource: string, target?: string) => void;
  onUpdateStoryBible: (field: keyof StoryBibleFields, value: string) => void;
  storyBibleErrors?: Partial<Record<keyof StoryBibleFields, string>>;
  focusedStoryBibleField?: { field: keyof StoryBibleFields; seq: number } | null;
  consistencyIssues: ConsistencyIssue[];
  onNavigateConsistencyTarget?: (target: ConsistencyIssueTarget) => void;
  onRestoreRevision: (revisionId: string) => void;
  onSwitchProject: (projectId: string) => void;
  onCreateNewProject: (name: string, initialPrompt: string) => void;
  onDeleteProject: (projectId: string) => void;
  onExportJson: () => void;
  onExportStoryBibleMarkdown: () => void;
  onExportPromptText: () => void;
  onExportManuscript?: () => void;
  historyTarget?: { id: string; sequence: number } | null;
  contentExports: { id: string; label: string }[];
  onExportContent: (id: string) => void;
  onExportContentBundle: (ids: string[]) => void;
  onCreateOpportunity: (input: OpportunityProposalInput, expectedRevision: number) => void;
  onTransitionOpportunity: (id: string, status: OpportunityProposalStatus, expectedRevision: number) => void;
  onPreviewProjectJson: (rawJson: string) => Promise<CreativeProject>;
  onImportProjectJson: (rawJson: string) => Promise<{ ok: boolean; error?: string }>;
  isLoading: boolean;
}

type StoryBibleDomain = 'core' | 'narrative' | 'constraints' | 'visual';

interface ConsistencyFixPreview {
  issueId: string;
  projectId: string;
  baseRevision: number;
  baseSnapshotDigest: string;
  baseSnapshotJson: string;
  entityId: string;
  before: string;
  after: string;
}

const STORY_BIBLE_DOMAINS: Array<{ id: StoryBibleDomain; label: string; description: string }> = [
  {
    id: 'core',
    label: 'World & Atmosphere',
    description: 'Foundational genre, mood, and primary backdrop',
  },
  {
    id: 'narrative',
    label: 'Narrative Arc & Voice',
    description: 'Perspective, pacing, themes, audience, and central tension',
  },
  {
    id: 'constraints',
    label: 'Canon & Exclusions',
    description: 'Continuity rules and elements that must never appear',
  },
  {
    id: 'visual',
    label: 'Visual & Camera Direction',
    description: 'Shared art direction and lighting for Image Mode',
  },
];

const STORY_BIBLE_CONFIG: Array<{
  key: keyof StoryBibleFields;
  label: string;
  shortLabel: string;
  domain: StoryBibleDomain;
  span: 'half' | 'full';
  placeholder: string;
  multiline?: boolean;
  examples?: string[];
}> = [
  {
    key: 'genre',
    label: 'Genre',
    shortLabel: 'Genre',
    domain: 'core',
    span: 'half',
    placeholder: 'e.g. Cozy Anthropomorphic Fable',
    examples: ['Cozy Anthropomorphic Fable', 'Woodland Mystery', 'Whimsical Fantasy'],
  },
  {
    key: 'tone',
    label: 'Tone & Atmosphere',
    shortLabel: 'Tone',
    domain: 'core',
    span: 'half',
    placeholder: 'e.g. Warm and whimsical',
    examples: ['Warm and whimsical', 'Mysterious & candlelit', 'Witty & theatrical'],
  },
  {
    key: 'setting',
    label: 'Primary Setting',
    shortLabel: 'Primary Setting',
    domain: 'core',
    span: 'full',
    placeholder: 'e.g. Lantern-lit conservatory dining room',
    examples: ['Lantern-lit conservatory dining room', 'Sunlit garden under string lights'],
  },
  {
    key: 'narrativePerspective',
    label: 'Narrative Perspective',
    shortLabel: 'Point of View',
    domain: 'narrative',
    span: 'half',
    placeholder: 'e.g. Third-person limited',
    examples: ['Third-person limited', 'Omniscient narrator', 'First-person host'],
  },
  {
    key: 'pacing',
    label: 'Pacing',
    shortLabel: 'Pacing',
    domain: 'narrative',
    span: 'half',
    placeholder: 'e.g. Unhurried conversational',
    examples: ['Unhurried conversational', 'Brisk & comedic', 'Slow-burn suspense'],
  },
  {
    key: 'themes',
    label: 'Themes',
    shortLabel: 'Core Themes',
    domain: 'narrative',
    span: 'half',
    placeholder: 'e.g. Hospitality, friendship',
    examples: ['Hospitality & belonging', 'Hidden secrets among friends'],
  },
  {
    key: 'intendedAudience',
    label: 'Intended Audience',
    shortLabel: 'Audience',
    domain: 'narrative',
    span: 'half',
    placeholder: 'e.g. General readers',
    examples: ['All-ages fable readers', 'Young adult', 'Literary fiction'],
  },
  {
    key: 'centralConflict',
    label: 'Central Conflict',
    shortLabel: 'Central Conflict',
    domain: 'narrative',
    span: 'full',
    placeholder: 'What drives tension or curiosity in the scene?',
    multiline: true,
    examples: ['A missing heirloom recipe card at the table', 'Keeping a midnight dish secret'],
  },
  {
    key: 'continuityRules',
    label: 'Continuity Rules & Plot Notes',
    shortLabel: 'Continuity Rules',
    domain: 'constraints',
    span: 'full',
    placeholder: 'Important canon rules or constraints...',
    multiline: true,
  },
  {
    key: 'explicitExclusions',
    label: 'Explicit Exclusions (Never Include)',
    shortLabel: 'Explicit Exclusions',
    domain: 'constraints',
    span: 'full',
    placeholder: 'Comma-separated items or characters to exclude',
  },
  {
    key: 'visualStyle',
    label: 'Visual Style (Shared for Image Mode)',
    shortLabel: 'Visual Style',
    domain: 'visual',
    span: 'half',
    placeholder: 'e.g. Storybook watercolor',
    examples: ['Storybook watercolor & ink', 'Painterly oil illustration', 'Cinematic 35mm'],
  },
  {
    key: 'cameraAndLighting',
    label: 'Camera & Lighting (Shared for Image Mode)',
    shortLabel: 'Camera & Lighting',
    domain: 'visual',
    span: 'half',
    placeholder: 'e.g. Warm candlelit glow',
    examples: ['Warm lantern glow, eye-level', 'Wide banquet table composition'],
  },
];

const ContextualInspector: React.FC<ContextualInspectorProps> = ({
  activeTab,
  onSelectTab,
  project,
  savedProjects,
  selectedEntity,
  selectedRelationship,
  onSelectEntity,
  onSelectRelationship,
  onAttributeChange,
  onRenameEntity,
  onAddEntity,
  onUpsertRelationship,
  onUpdateRelationshipById,
  onRemoveRelationship,
  onUpdateStoryBible,
  storyBibleErrors,
  focusedStoryBibleField,
  consistencyIssues,
  onNavigateConsistencyTarget,
  onRestoreRevision,
  onSwitchProject,
  onCreateNewProject,
  onDeleteProject,
  onExportJson,
  onExportStoryBibleMarkdown,
  onExportPromptText,
  onImportProjectJson,
  onPreviewProjectJson,
  onExportManuscript,
  historyTarget,
  contentExports,
  onExportContent,
  onExportContentBundle,
  onCreateOpportunity,
  onTransitionOpportunity,
  isLoading,
}) => {
  const { snapshot } = project;
  const snapshotJson = useMemo(() => JSON.stringify(snapshot), [snapshot]);
  const [consistencyFixPreview, setConsistencyFixPreview] = useState<ConsistencyFixPreview | null>(null);
  const previewIsStale = consistencyFixPreview !== null && (
    consistencyFixPreview.projectId !== project.id ||
    consistencyFixPreview.baseRevision !== (project.revision ?? 1) ||
    consistencyFixPreview.baseSnapshotDigest !== computePromptDigest(snapshotJson, snapshot.mode) ||
    consistencyFixPreview.baseSnapshotJson !== snapshotJson ||
    !consistencyIssues.some(issue => issue.id === consistencyFixPreview.issueId) ||
    !snapshot.entities.some(entity => entity.id === consistencyFixPreview.entityId)
  );
  const [renameDraft, setRenameDraft] = useState<string>('');
  const [newAttrName, setNewAttrName] = useState('');
  const [newAttrValue, setNewAttrValue] = useState('');
  const [newRelTarget, setNewRelTarget] = useState('');
  const [newRelLabel, setNewRelLabel] = useState('');
  const [relLabelDrafts, setRelLabelDrafts] = useState<Record<string, string>>({});
  const activeRelKey = selectedRelationship?.id ?? 'default';
  const activeRelLabel =
    relLabelDrafts[activeRelKey] ?? selectedRelationship?.label ?? '';

  // Story Bible view & filter state
  const [bibleViewMode, setBibleViewMode] = useState<'grid' | 'list'>('grid');
  const [bibleDomainFilter, setBibleDomainFilter] = useState<'all' | StoryBibleDomain>('all');
  const [bibleStatusFilter, setBibleStatusFilter] = useState<'all' | 'confirmed' | 'pending' | 'unset'>('all');
  const [lastHandledFocusSeq, setLastHandledFocusSeq] = useState<number>(0);

  if (
    focusedStoryBibleField &&
    activeTab === 'story-bible' &&
    focusedStoryBibleField.seq !== lastHandledFocusSeq
  ) {
    setLastHandledFocusSeq(focusedStoryBibleField.seq);
    if (bibleDomainFilter !== 'all') setBibleDomainFilter('all');
    if (bibleStatusFilter !== 'all') setBibleStatusFilter('all');
  }

  useEffect(() => {
    if (!focusedStoryBibleField || activeTab !== 'story-bible') return;
    const rafId = requestAnimationFrame(() => {
      const el = document.getElementById(`bible-${focusedStoryBibleField.field}`);
      if (el instanceof HTMLElement) {
        el.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
        el.focus();
      }
    });
    return () => cancelAnimationFrame(rafId);
  }, [focusedStoryBibleField, activeTab]);

  // New entity state
  const [newEntityName, setNewEntityName] = useState('');
  const [newEntityCategory, setNewEntityCategory] = useState<EntityCategory>('character');
  const [newEntityDesc, setNewEntityDesc] = useState('');

  // Import/New project state
  const [importJsonText, setImportJsonText] = useState('');
  const [selectedExport, setSelectedExport] = useState('');
  const [selectedBundleExports, setSelectedBundleExports] = useState<string[]>([]);
  useEffect(() => {
    if (activeTab !== 'history' || !historyTarget) return;
    const target = document.getElementById(historyTarget.id);
    target?.scrollIntoView({ block: 'start' });
    target?.focus({ preventScroll: true });
  }, [activeTab, historyTarget]);
  const [restorePreview, setRestorePreview] = useState<{ raw: string; project: CreativeProject } | null>(null);
  const [restoreBusy, setRestoreBusy] = useState(false);
  const [importMessage, setImportMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const [newProjName, setNewProjName] = useState('');
  const [newProjIdea, setNewProjIdea] = useState('');

  const objectEntities = snapshot.entities.filter(
    (e) => !isSceneEntityName(e.name) && e.category !== 'scene'
  );

  const entityRelationships = selectedEntity
    ? snapshot.relationships.filter(
        (r) =>
          r.sourceId === selectedEntity.id ||
          r.targetId === selectedEntity.id ||
          r.source.toLowerCase() === selectedEntity.name.toLowerCase() ||
          r.target.toLowerCase() === selectedEntity.name.toLowerCase()
      )
    : [];

  async function previewProjectBackup(raw: string) {
    setRestorePreview(null);
    setImportMessage(null);
    setRestoreBusy(true);
    try {
      const preview = await onPreviewProjectJson(raw);
      setRestorePreview({ raw, project: preview });
    } catch (cause) {
      setImportMessage({ ok: false, text: cause instanceof Error ? cause.message : 'Invalid backup.' });
    } finally {
      setRestoreBusy(false);
    }
  }

  const handleFileImport = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    event.target.value = '';
    void file.text().then(previewProjectBackup, () => setImportMessage({ ok: false, text: 'Backup file could not be read.' }));
  };

  return (
    <aside
      aria-label="Contextual Inspector and Story Bible"
      className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-lg flex flex-col h-full min-h-0 overflow-hidden"
    >
      {/* Top Segmented Mode Selector */}
      <div
        role="tablist"
        aria-label="Inspector views"
        className="grid grid-cols-6 gap-1 p-1.5 bg-gray-100 dark:bg-gray-950 border-b border-gray-200 dark:border-gray-800 flex-shrink-0"
      >
        {(
          [
            ['inspector', 'Inspector'],
            ['story-bible', 'Story Bible'],
            ['consistency', `Checks (${consistencyIssues.length})`],
            ['history', 'History'],
            ['timeline', 'Timeline'],
            ['opportunities', 'Ideas'],
          ] as const
        ).map(([key, label]) => (
          <button
            key={key}
            type="button"
            role="tab"
            aria-selected={activeTab === key}
            onClick={() => onSelectTab(key)}
            className={`px-1.5 py-1.5 text-[11px] font-semibold rounded transition-colors whitespace-nowrap text-center ${
              activeTab === key
                ? 'bg-white dark:bg-gray-800 text-blue-600 dark:text-blue-400 shadow-xs'
                : 'text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white'
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {/* Tab 1: Contextual Entity / Relationship Inspector */}
      {activeTab === 'inspector' && (
        <div className="flex-1 overflow-y-auto p-4 space-y-4 min-h-0">
          {selectedEntity ? (
            <div className="space-y-4">
              <div className="flex items-start justify-between gap-2 border-b border-gray-200 dark:border-gray-800 pb-3">
                <div>
                  <div className="text-[11px] text-gray-500 dark:text-gray-400 mb-0.5">
                    <span className="capitalize">{selectedEntity.category ?? 'entity'}</span>
                    <span aria-hidden="true"> · </span>
                    <span>
                      {selectedEntity.presence_in_prompt ? 'Explicit in prompt' : 'AI Inferred'}
                    </span>
                    <span aria-hidden="true"> · </span>
                    <span className="capitalize">{selectedEntity.status ?? 'confirmed'}</span>
                  </div>
                  <h3 className="font-display text-base font-bold text-gray-900 dark:text-gray-100">
                    {selectedEntity.name}
                  </h3>
                  {selectedEntity.description && (
                    <p className="text-xs text-gray-600 dark:text-gray-400 mt-1">
                      {selectedEntity.description}
                    </p>
                  )}
                </div>
                <button
                  type="button"
                  onClick={() => onSelectEntity(null)}
                  className="text-xs text-gray-500 hover:text-gray-900 dark:hover:text-white px-2 py-1 rounded border border-gray-200 dark:border-gray-700 whitespace-nowrap"
                >
                  All Entities
                </button>
              </div>

              {/* Rename Entity (preserves stable ID and relationships) */}
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  if (renameDraft.trim()) {
                    onRenameEntity(selectedEntity.id ?? selectedEntity.name, renameDraft.trim());
                    setRenameDraft('');
                  }
                }}
                className="flex gap-1.5 items-center"
              >
                <input
                  type="text"
                  value={renameDraft}
                  onChange={(e) => setRenameDraft(e.target.value)}
                  placeholder={`Rename "${selectedEntity.name}"...`}
                  aria-label={`Rename ${selectedEntity.name}`}
                  className="flex-1 min-w-0 text-xs bg-gray-50 dark:bg-gray-800 border border-gray-300 dark:border-gray-700 rounded px-2.5 py-1.5 text-gray-900 dark:text-gray-100"
                />
                <button
                  type="submit"
                  disabled={!renameDraft.trim()}
                  className="px-2.5 py-1.5 text-xs font-semibold bg-gray-900 dark:bg-gray-700 text-white rounded disabled:opacity-40 whitespace-nowrap"
                >
                  Rename
                </button>
              </form>

              {/* Attributes List */}
              <div>
                <h4 className="text-xs font-semibold text-gray-800 dark:text-gray-200 mb-2">
                  Attributes &amp; Existence
                </h4>
                <div className="divide-y divide-gray-100 dark:divide-gray-800 border border-gray-200 dark:border-gray-800 rounded-md px-2">
                  {selectedEntity.attributes.map((attr) => (
                    <AttributeEditor
                      key={attr.id ?? attr.name}
                      attribute={attr}
                      entity={selectedEntity}
                      onChange={onAttributeChange}
                      isLoading={isLoading}
                      pendingValue={attr.confirmedValue}
                    />
                  ))}
                </div>

                {/* Add Custom Attribute */}
                <form
                  onSubmit={(e) => {
                    e.preventDefault();
                    if (newAttrName.trim() && newAttrValue.trim()) {
                      onAttributeChange(
                        selectedEntity.name,
                        newAttrName.trim(),
                        newAttrValue.trim()
                      );
                      setNewAttrName('');
                      setNewAttrValue('');
                    }
                  }}
                  className="mt-2.5 flex gap-1.5"
                >
                  <input
                    type="text"
                    value={newAttrName}
                    onChange={(e) => setNewAttrName(e.target.value)}
                    placeholder="New attribute (e.g. outfit)"
                    aria-label="New attribute name"
                    className="w-1/2 text-xs bg-gray-50 dark:bg-gray-800 border border-gray-300 dark:border-gray-700 rounded px-2 py-1.5 text-gray-900 dark:text-gray-100"
                  />
                  <input
                    type="text"
                    value={newAttrValue}
                    onChange={(e) => setNewAttrValue(e.target.value)}
                    placeholder="Value (e.g. velvet vest)"
                    aria-label="New attribute value"
                    className="w-1/2 text-xs bg-gray-50 dark:bg-gray-800 border border-gray-300 dark:border-gray-700 rounded px-2 py-1.5 text-gray-900 dark:text-gray-100"
                  />
                  <button
                    type="submit"
                    disabled={!newAttrName.trim() && !newAttrValue.trim()}
                    className="px-2.5 py-1.5 text-xs font-semibold bg-blue-600 text-white rounded disabled:opacity-40 whitespace-nowrap"
                  >
                    Add
                  </button>
                </form>
              </div>

              {/* Connected Relationships */}
              <div>
                <h4 className="text-xs font-semibold text-gray-800 dark:text-gray-200 mb-2">
                  Connected Relationships ({entityRelationships.length})
                </h4>
                {entityRelationships.length > 0 ? (
                  <div className="space-y-1.5">
                    {entityRelationships.map((rel) => (
                      <div
                        key={rel.id ?? `${rel.source}-${rel.target}-${rel.label}`}
                        className="flex items-center justify-between gap-2 text-xs p-2 rounded border border-gray-200 dark:border-gray-800 bg-gray-50/50 dark:bg-gray-800/40"
                      >
                        <button
                          type="button"
                          onClick={() => {
                            onSelectEntity(null);
                            onSelectRelationship(rel);
                          }}
                          className="truncate text-left flex-1 hover:text-blue-600 dark:hover:text-blue-400"
                          title="Inspect & edit this directed relationship"
                        >
                          <span className="font-semibold text-gray-900 dark:text-gray-100">
                            {rel.source}
                          </span>{' '}
                          <span className="text-blue-600 dark:text-blue-400 font-medium">
                            {rel.label}
                          </span>{' '}
                          <span className="font-semibold text-gray-900 dark:text-gray-100">
                            {rel.target}
                          </span>
                          {rel.status === 'pending' && (
                            <span className="ml-1.5 text-[10px] px-1.5 py-0.5 rounded bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300">
                              pending
                            </span>
                          )}
                        </button>
                        <div className="flex items-center gap-1 shrink-0">
                          <button
                            type="button"
                            onClick={() => {
                              onSelectEntity(null);
                              onSelectRelationship(rel);
                            }}
                            className="text-blue-600 dark:text-blue-400 hover:underline text-xs px-1"
                          >
                            Edit
                          </button>
                          <button
                            type="button"
                            onClick={() =>
                              rel.id
                                ? onRemoveRelationship(rel.id)
                                : onRemoveRelationship(rel.source, rel.target)
                            }
                            className="text-gray-400 hover:text-red-600 text-xs px-1"
                            aria-label={`Remove relationship ${rel.source} ${rel.label} ${rel.target}`}
                          >
                            Remove
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="text-xs text-gray-500">No relationships linked yet.</p>
                )}

                <form
                  onSubmit={(e) => {
                    e.preventDefault();
                    if (newRelTarget && newRelLabel.trim()) {
                      onUpsertRelationship(selectedEntity.name, newRelTarget, newRelLabel.trim());
                      setNewRelLabel('');
                    }
                  }}
                  className="mt-2.5 flex gap-1.5"
                >
                  <select
                    aria-label="Target entity for relationship"
                    value={newRelTarget}
                    onChange={(e) => setNewRelTarget(e.target.value)}
                    className="w-2/5 text-xs bg-gray-50 dark:bg-gray-800 border border-gray-300 dark:border-gray-700 rounded px-2 py-1.5 text-gray-900 dark:text-gray-100"
                  >
                    <option value="">Target entity...</option>
                    {objectEntities
                      .filter((e) => e.name !== selectedEntity.name)
                      .map((e) => (
                        <option key={e.id ?? e.name} value={e.name}>
                          {e.name}
                        </option>
                      ))}
                  </select>
                  <input
                    type="text"
                    value={newRelLabel}
                    onChange={(e) => setNewRelLabel(e.target.value)}
                    placeholder="Relationship (e.g. seated beside)"
                    aria-label="Relationship label"
                    className="flex-1 min-w-0 text-xs bg-gray-50 dark:bg-gray-800 border border-gray-300 dark:border-gray-700 rounded px-2 py-1.5 text-gray-900 dark:text-gray-100"
                  />
                  <button
                    type="submit"
                    disabled={!newRelTarget || !newRelLabel.trim()}
                    className="px-2.5 py-1.5 text-xs font-semibold bg-blue-600 text-white rounded disabled:opacity-40 whitespace-nowrap"
                  >
                    Link
                  </button>
                </form>
              </div>
            </div>
          ) : selectedRelationship ? (
            <div className="space-y-3 p-3 rounded-lg border border-blue-200 dark:border-blue-800/60 bg-blue-50/30 dark:bg-blue-950/20">
              <div className="flex items-start justify-between gap-2">
                <div>
                  <span className="text-[10px] font-bold uppercase tracking-wider text-blue-600 dark:text-blue-400">
                    Directed Relationship Inspector
                  </span>
                  <h3 className="font-display text-sm font-bold text-gray-900 dark:text-gray-100 mt-0.5">
                    {selectedRelationship.source} &rarr; {selectedRelationship.target}
                  </h3>
                  <div className="flex flex-wrap items-center gap-1.5 mt-1">
                    <span
                      className={`text-[10px] px-1.5 py-0.5 rounded font-semibold uppercase ${
                        selectedRelationship.status === 'confirmed'
                          ? 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950/60 dark:text-emerald-300'
                          : selectedRelationship.status === 'rejected'
                          ? 'bg-red-100 text-red-800 dark:bg-red-950/60 dark:text-red-300'
                          : 'bg-amber-100 text-amber-800 dark:bg-amber-950/60 dark:text-amber-300'
                      }`}
                    >
                      {selectedRelationship.status ?? 'confirmed'}
                    </span>
                    {selectedRelationship.provenance && (
                      <span className="text-[11px] text-gray-500 dark:text-gray-400">
                        · {selectedRelationship.provenance}
                      </span>
                    )}
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => onSelectRelationship(null)}
                  className="text-xs text-blue-600 dark:text-blue-400 hover:underline font-medium shrink-0"
                >
                  All Entities
                </button>
              </div>

              {/* Direction & Status Controls */}
              <div className="flex flex-wrap items-center gap-1.5 pt-2 border-t border-blue-200/60 dark:border-blue-800/50">
                {selectedRelationship.id && (
                  <>
                    <button
                      type="button"
                      onClick={() =>
                        onUpdateRelationshipById(selectedRelationship.id!, {
                          reverseDirection: true,
                        })
                      }
                      className="text-xs font-semibold px-2.5 py-1 rounded bg-white dark:bg-gray-800 text-blue-700 dark:text-blue-300 border border-blue-200 dark:border-blue-700 hover:bg-blue-50"
                      title="Reverse edge direction (Source ⇄ Target)"
                    >
                      ⇄ Reverse Direction
                    </button>
                    <button
                      type="button"
                      onClick={() =>
                        onUpdateRelationshipById(selectedRelationship.id!, {
                          status: 'confirmed',
                        })
                      }
                      className={`text-xs font-semibold px-2.5 py-1 rounded border ${
                        selectedRelationship.status === 'confirmed'
                          ? 'bg-emerald-600 text-white border-emerald-600'
                          : 'bg-white dark:bg-gray-800 text-emerald-700 dark:text-emerald-300 border-emerald-300 dark:border-emerald-700'
                      }`}
                    >
                      Confirm
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        onUpdateRelationshipById(selectedRelationship.id!, {
                          status: 'rejected',
                        });
                        onSelectRelationship(null);
                      }}
                      className="text-xs font-semibold px-2.5 py-1 rounded bg-white dark:bg-gray-800 text-amber-700 dark:text-amber-300 border border-amber-300 dark:border-amber-700 hover:bg-amber-50"
                    >
                      Reject
                    </button>
                  </>
                )}
                <button
                  type="button"
                  onClick={() => {
                    if (selectedRelationship.id) {
                      onRemoveRelationship(selectedRelationship.id);
                    } else {
                      onRemoveRelationship(
                        selectedRelationship.source,
                        selectedRelationship.target
                      );
                    }
                    onSelectRelationship(null);
                  }}
                  className="text-xs font-semibold px-2.5 py-1 rounded bg-red-50 dark:bg-red-950/40 text-red-700 dark:text-red-300 border border-red-200 dark:border-red-800/60 hover:bg-red-100 ml-auto"
                >
                  Delete Edge
                </button>
              </div>

              {/* Edit Relationship Label */}
              {selectedRelationship.id && (
                <form
                  onSubmit={(e) => {
                    e.preventDefault();
                    if (!activeRelLabel.trim()) return;
                    onUpdateRelationshipById(selectedRelationship.id!, {
                      label: activeRelLabel.trim(),
                      status: 'confirmed',
                    });
                  }}
                  className="pt-2 border-t border-blue-200/60 dark:border-blue-800/50 space-y-2"
                >
                  <label
                    htmlFor="inspector-rel-label"
                    className="block text-xs font-semibold text-gray-700 dark:text-gray-300"
                  >
                    Relationship Predicate / Label
                  </label>
                  <div className="flex items-center gap-1.5">
                    <input
                      id="inspector-rel-label"
                      type="text"
                      value={activeRelLabel}
                      onChange={(e) =>
                        setRelLabelDrafts((prev) => ({
                          ...prev,
                          [activeRelKey]: e.target.value,
                        }))
                      }
                      placeholder="Relationship label..."
                      aria-label="Edit relationship label"
                      className="flex-1 text-xs rounded border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-900 px-2.5 py-1.5 text-gray-800 dark:text-gray-100"
                    />
                    <button
                      type="submit"
                      className="text-xs font-semibold px-3 py-1.5 rounded bg-blue-600 hover:bg-blue-700 text-white"
                    >
                      Save Label
                    </button>
                  </div>

                  {selectedRelationship.alternatives &&
                    selectedRelationship.alternatives.length > 0 && (
                      <div className="pt-1">
                        <span className="block text-[11px] text-gray-500 mb-1">
                          Suggested Alternatives (click to apply):
                        </span>
                        <div className="flex flex-wrap gap-1">
                          {selectedRelationship.alternatives.map((alt) => (
                            <button
                              key={alt.name}
                              type="button"
                              onClick={() => {
                                setRelLabelDrafts((prev) => ({
                                  ...prev,
                                  [activeRelKey]: alt.name,
                                }));
                                onUpdateRelationshipById(selectedRelationship.id!, {
                                  label: alt.name,
                                  status: 'confirmed',
                                });
                              }}
                              className="text-xs px-2 py-0.5 rounded bg-white dark:bg-gray-800 hover:bg-blue-50 dark:hover:bg-blue-950/50 text-gray-700 dark:text-gray-300 border border-gray-200 dark:border-gray-700 transition-colors"
                            >
                              {alt.name}
                            </button>
                          ))}
                        </div>
                      </div>
                    )}
                </form>
              )}
            </div>
          ) : (
            /* Unselected overview: Quick Entity Directory & Add Entity */
            <div className="space-y-4">
              <div>
                <h3 className="font-display text-sm font-bold text-gray-900 dark:text-gray-100 mb-1">
                  Story Elements Directory ({objectEntities.length})
                </h3>
                <p className="text-xs text-gray-500 dark:text-gray-400 mb-3">
                  Select any node on the Belief Graph or click an entity below to inspect and edit its attributes, provenance, and relationships.
                </p>

                <div className="divide-y divide-gray-200 dark:divide-gray-800 border border-gray-200 dark:border-gray-800 rounded-md">
                  {objectEntities.map((ent) => {
                    const confirmedCount = ent.attributes.filter(
                      (a) => a.status === 'confirmed' && a.name !== 'existence'
                    ).length;
                    return (
                      <button
                        key={ent.id ?? ent.name}
                        type="button"
                        onClick={() => onSelectEntity(ent)}
                        className="w-full text-left px-3 py-2.5 hover:bg-gray-50 dark:hover:bg-gray-800 flex items-center justify-between gap-2 transition-colors"
                      >
                        <div className="min-w-0">
                          <div className="text-xs font-semibold text-gray-900 dark:text-gray-100 truncate">
                            {ent.name}{' '}
                            {ent.excluded && (
                              <span className="text-red-600 dark:text-red-400 font-normal">
                                (Excluded)
                              </span>
                            )}
                          </div>
                          <div className="text-[11px] text-gray-500 dark:text-gray-400">
                            <span className="capitalize">{ent.category ?? 'entity'}</span>
                            <span aria-hidden="true"> · </span>
                            <span className="tabular-nums">{confirmedCount} confirmed traits</span>
                          </div>
                        </div>
                        <span className="text-xs text-blue-600 dark:text-blue-400 whitespace-nowrap">
                          Inspect &rarr;
                        </span>
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* Add New Entity Form */}
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  if (newEntityName.trim()) {
                    onAddEntity(
                      newEntityName.trim(),
                      newEntityCategory,
                      newEntityDesc.trim()
                    );
                    setNewEntityName('');
                    setNewEntityDesc('');
                  }
                }}
                className="p-3 rounded-md border border-gray-200 dark:border-gray-800 bg-gray-50/50 dark:bg-gray-950/40 space-y-2.5"
              >
                <h4 className="text-xs font-semibold text-gray-900 dark:text-gray-100">
                  Add New Entity to Graph
                </h4>
                <div className="flex gap-2">
                  <input
                    type="text"
                    value={newEntityName}
                    onChange={(e) => setNewEntityName(e.target.value)}
                    placeholder="Entity name (e.g. Owl)"
                    aria-label="New entity name"
                    className="flex-1 min-w-0 text-xs bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-700 rounded px-2.5 py-1.5 text-gray-900 dark:text-gray-100"
                  />
                  <select
                    aria-label="New entity category"
                    value={newEntityCategory}
                    onChange={(e) => setNewEntityCategory(e.target.value as EntityCategory)}
                    className="text-xs bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-700 rounded px-2 py-1.5 text-gray-800 dark:text-gray-200"
                  >
                    <option value="character">Character</option>
                    <option value="location">Location</option>
                    <option value="object">Object</option>
                    <option value="event">Event</option>
                    <option value="group">Group</option>
                  </select>
                </div>
                <input
                  type="text"
                  value={newEntityDesc}
                  onChange={(e) => setNewEntityDesc(e.target.value)}
                  placeholder="Short description..."
                  aria-label="New entity description"
                  className="w-full text-xs bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-700 rounded px-2.5 py-1.5 text-gray-900 dark:text-gray-100"
                />
                <button
                  type="submit"
                  disabled={!newEntityName.trim()}
                  className="w-full py-1.5 text-xs font-semibold bg-blue-600 hover:bg-blue-700 disabled:opacity-40 text-white rounded transition-colors"
                >
                  Add to Story Graph
                </button>
              </form>
            </div>
          )}
        </div>
      )}

      {/* Tab 2: Synchronized Story Bible (Structured Editable Grid & List View) */}
      {activeTab === 'story-bible' && (() => {
        const bibleStats = STORY_BIBLE_CONFIG.reduce(
          (acc, item) => {
            const f = snapshot.storyBible[item.key];
            const hasValue = f.value.trim().length > 0;
            if (!hasValue) {
              acc.unset += 1;
            } else if (f.status === 'confirmed') {
              acc.confirmed += 1;
            } else if (f.status === 'pending') {
              acc.pending += 1;
            } else {
              acc.unset += 1;
            }
            return acc;
          },
          { confirmed: 0, pending: 0, unset: 0 }
        );

        const pendingWithValues = STORY_BIBLE_CONFIG.filter(({ key }) => {
          const f = snapshot.storyBible[key];
          return f.status === 'pending' && f.value.trim().length > 0;
        });

        const matchesFilters = (item: (typeof STORY_BIBLE_CONFIG)[number]) => {
          if (bibleDomainFilter !== 'all' && item.domain !== bibleDomainFilter) {
            return false;
          }
          const f = snapshot.storyBible[item.key];
          const hasValue = f.value.trim().length > 0;
          if (bibleStatusFilter === 'confirmed') {
            return hasValue && f.status === 'confirmed';
          }
          if (bibleStatusFilter === 'pending') {
            return hasValue && f.status === 'pending';
          }
          if (bibleStatusFilter === 'unset') {
            return !hasValue;
          }
          return true;
        };

        const filteredItems = STORY_BIBLE_CONFIG.filter(matchesFilters);

        return (
          <div className="flex-1 overflow-y-auto p-3.5 space-y-3 min-h-0">
            {/* Story Bible Header & View Switcher */}
            <div className="flex flex-wrap items-start justify-between gap-2 pb-2.5 border-b border-gray-200 dark:border-gray-800">
              <div>
                <h3 className="font-display text-sm font-bold text-gray-900 dark:text-gray-100">
                  Synchronized Story Bible
                </h3>
                <p className="text-[11px] text-gray-500 dark:text-gray-400 mt-0.5 tabular-nums">
                  <span className="font-semibold text-emerald-700 dark:text-emerald-400">
                    {bibleStats.confirmed} confirmed
                  </span>
                  <span aria-hidden="true"> · </span>
                  <span className="font-semibold text-amber-700 dark:text-amber-400">
                    {bibleStats.pending} pending
                  </span>
                  <span aria-hidden="true"> · </span>
                  <span>{bibleStats.unset} unset</span>
                </p>
              </div>

              <div className="flex items-center gap-1.5">
                {pendingWithValues.length > 0 && (
                  <button
                    type="button"
                    onClick={() => {
                      for (const item of pendingWithValues) {
                        onUpdateStoryBible(item.key, snapshot.storyBible[item.key].value);
                      }
                    }}
                    className="px-2 py-1 text-[11px] font-semibold rounded bg-emerald-600 hover:bg-emerald-700 text-white transition-colors whitespace-nowrap"
                  >
                    Confirm Pending ({pendingWithValues.length})
                  </button>
                )}

                <div
                  role="group"
                  aria-label="Story Bible layout mode"
                  className="flex bg-gray-100 dark:bg-gray-800 p-0.5 rounded-md border border-gray-200 dark:border-gray-700"
                >
                  <button
                    type="button"
                    onClick={() => setBibleViewMode('grid')}
                    aria-pressed={bibleViewMode === 'grid'}
                    className={`px-2 py-0.5 text-[11px] font-semibold rounded transition-colors ${
                      bibleViewMode === 'grid'
                        ? 'bg-white dark:bg-gray-900 text-blue-600 dark:text-blue-400 shadow-xs'
                        : 'text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white'
                    }`}
                  >
                    Grid
                  </button>
                  <button
                    type="button"
                    onClick={() => setBibleViewMode('list')}
                    aria-pressed={bibleViewMode === 'list'}
                    className={`px-2 py-0.5 text-[11px] font-semibold rounded transition-colors ${
                      bibleViewMode === 'list'
                        ? 'bg-white dark:bg-gray-900 text-blue-600 dark:text-blue-400 shadow-xs'
                        : 'text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white'
                    }`}
                  >
                    List
                  </button>
                </div>
              </div>
            </div>

            {/* Domain & Status Filters */}
            <div className="flex flex-wrap items-center justify-between gap-1.5">
              <div
                role="group"
                aria-label="Filter Story Bible by domain"
                className="flex flex-wrap gap-1"
              >
                {(
                  [
                    ['all', 'All'],
                    ['core', 'World'],
                    ['narrative', 'Arc & Voice'],
                    ['constraints', 'Rules'],
                    ['visual', 'Visual'],
                  ] as const
                ).map(([domainKey, domainLabel]) => (
                  <button
                    key={domainKey}
                    type="button"
                    onClick={() => setBibleDomainFilter(domainKey)}
                    aria-pressed={bibleDomainFilter === domainKey}
                    className={`px-2 py-0.5 text-[11px] font-medium rounded border transition-colors ${
                      bibleDomainFilter === domainKey
                        ? 'border-blue-500 bg-blue-50 dark:bg-blue-950/60 text-blue-700 dark:text-blue-300 font-semibold'
                        : 'border-gray-200 dark:border-gray-800 bg-gray-50 dark:bg-gray-800/60 text-gray-600 dark:text-gray-400 hover:text-gray-900'
                    }`}
                  >
                    {domainLabel}
                  </button>
                ))}
              </div>

              <select
                aria-label="Filter Story Bible by status"
                value={bibleStatusFilter}
                onChange={(e) =>
                  setBibleStatusFilter(e.target.value as typeof bibleStatusFilter)
                }
                className="text-[11px] bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-700 rounded px-2 py-0.5 text-gray-700 dark:text-gray-200"
              >
                <option value="all">All ({STORY_BIBLE_CONFIG.length})</option>
                <option value="confirmed">Confirmed ({bibleStats.confirmed})</option>
                <option value="pending">Pending ({bibleStats.pending})</option>
                <option value="unset">Unset ({bibleStats.unset})</option>
              </select>
            </div>

            {filteredItems.length === 0 ? (
              <div className="p-4 text-center rounded-md border border-gray-200 dark:border-gray-800 bg-gray-50/50 dark:bg-gray-950/40 text-xs text-gray-500 dark:text-gray-400">
                No Story Bible fields match the active filter.
              </div>
            ) : bibleViewMode === 'grid' ? (
              /* Structured Domain-Grouped Editable Grid View */
              <div
                className="space-y-4"
                role="region"
                aria-label="Story Bible structured grid"
              >
                {STORY_BIBLE_DOMAINS.map((domainMeta) => {
                  const domainFields = filteredItems.filter(
                    (item) => item.domain === domainMeta.id
                  );
                  if (domainFields.length === 0) return null;

                  return (
                    <section
                      key={domainMeta.id}
                      aria-label={domainMeta.label}
                      className="space-y-2"
                    >
                      <div className="flex items-center justify-between gap-2">
                        <h4
                          title={domainMeta.description}
                          className="text-[11px] font-bold uppercase tracking-wider text-gray-600 dark:text-gray-300"
                        >
                          {domainMeta.label}
                        </h4>
                        <span className="text-[10px] text-gray-400 dark:text-gray-500 tabular-nums">
                          {domainFields.length} {domainFields.length === 1 ? 'field' : 'fields'}
                        </span>
                      </div>

                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                        {domainFields.map(
                          ({
                            key,
                            label,
                            shortLabel,
                            span,
                            placeholder,
                            multiline,
                            examples,
                          }) => {
                            const field = snapshot.storyBible[key];
                            const fieldError = storyBibleErrors?.[key];
                            const inputErrorId = `bible-error-${key}`;
                            const hasValue = field.value.trim().length > 0;
                            const isConfirmed = hasValue && field.status === 'confirmed';
                            const isPending = hasValue && field.status === 'pending';

                            return (
                              <div
                                key={key}
                                className={`${
                                  span === 'full' ? 'sm:col-span-2' : 'col-span-1'
                                } min-w-0 overflow-hidden rounded-md border p-2.5 flex flex-col justify-between gap-1.5 transition-colors ${
                                  isConfirmed
                                    ? 'border-emerald-200 dark:border-emerald-900/70 bg-emerald-50/20 dark:bg-emerald-950/15'
                                    : isPending
                                      ? 'border-amber-300 dark:border-amber-800 border-dashed bg-amber-50/25 dark:bg-amber-950/15'
                                      : 'border-gray-200 dark:border-gray-800 bg-gray-50/40 dark:bg-gray-950/30'
                                }`}
                              >
                                <div className="flex items-center justify-between gap-1.5 min-w-0">
                                  <label
                                    htmlFor={`bible-${key}`}
                                    title={label}
                                    className="text-xs font-semibold text-gray-900 dark:text-gray-100 truncate"
                                  >
                                    {shortLabel}
                                  </label>

                                  <span
                                    className={`text-[10px] px-1.5 py-0.2 rounded font-semibold uppercase tracking-wide shrink-0 ${
                                      isConfirmed
                                        ? 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950/80 dark:text-emerald-300'
                                        : isPending
                                          ? 'bg-amber-100 text-amber-800 dark:bg-amber-950/80 dark:text-amber-300'
                                          : 'bg-gray-200/70 text-gray-600 dark:bg-gray-800 dark:text-gray-400'
                                    }`}
                                  >
                                    {isConfirmed
                                      ? 'Confirmed'
                                      : isPending
                                        ? 'Pending'
                                        : 'Unset'}
                                  </span>
                                </div>

                                {multiline ? (
                                  <textarea
                                    id={`bible-${key}`}
                                    rows={2}
                                    value={field.value}
                                    onChange={(e) => onUpdateStoryBible(key, e.target.value)}
                                    placeholder={placeholder}
                                    aria-invalid={Boolean(fieldError)}
                                    aria-describedby={fieldError ? inputErrorId : undefined}
                                    className={`w-full text-xs bg-white dark:bg-gray-900 border rounded p-2 text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 resize-y ${
                                      fieldError
                                        ? 'border-red-500 focus:ring-red-500'
                                        : 'border-gray-300 dark:border-gray-700 focus:ring-blue-500'
                                    }`}
                                  />
                                ) : (
                                  <input
                                    id={`bible-${key}`}
                                    type="text"
                                    value={field.value}
                                    onChange={(e) => onUpdateStoryBible(key, e.target.value)}
                                    onBlur={(e) => {
                                      if (e.target.value !== e.target.value.trim()) {
                                        onUpdateStoryBible(key, e.target.value.trim());
                                      }
                                    }}
                                    placeholder={placeholder}
                                    aria-invalid={Boolean(fieldError)}
                                    aria-describedby={fieldError ? inputErrorId : undefined}
                                    className={`w-full text-xs bg-white dark:bg-gray-900 border rounded px-2 py-1.5 text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 ${
                                      fieldError
                                        ? 'border-red-500 focus:ring-red-500'
                                        : 'border-gray-300 dark:border-gray-700 focus:ring-blue-500'
                                    }`}
                                  />
                                )}
                                {fieldError && (
                                  <p
                                    id={inputErrorId}
                                    role="alert"
                                    className="text-[11px] font-medium text-red-600 dark:text-red-400"
                                  >
                                    {fieldError}
                                  </p>
                                )}

                                {/* Provenance, Quick Suggestion Chips & Confirm/Clear Actions */}
                                <div className="flex flex-wrap items-center justify-between gap-1 pt-0.5 min-w-0">
                                  {!hasValue && examples && examples.length > 0 ? (
                                    <div className="flex flex-wrap items-center gap-1 min-w-0">
                                      {examples.slice(0, 1).map((example) => (
                                        <button
                                          key={example}
                                          type="button"
                                          onClick={() => onUpdateStoryBible(key, example)}
                                          className="text-[10px] px-1.5 py-0.5 rounded border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-600 dark:text-gray-300 hover:border-blue-400 hover:text-blue-600 dark:hover:text-blue-300 truncate max-w-full"
                                          title={`Set ${shortLabel} to "${example}"`}
                                        >
                                          + {example}
                                        </button>
                                      ))}
                                    </div>
                                  ) : (
                                    <span className="text-[10px] text-gray-400 dark:text-gray-500 truncate">
                                      {field.provenance}
                                    </span>
                                  )}

                                  <div className="flex items-center gap-1.5 ml-auto shrink-0">
                                    {isPending && (
                                      <button
                                        type="button"
                                        onClick={() => onUpdateStoryBible(key, field.value)}
                                        className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-blue-600 hover:bg-blue-700 text-white"
                                        title={`Confirm ${label}`}
                                      >
                                        Confirm
                                      </button>
                                    )}
                                    {hasValue && (
                                      <button
                                        type="button"
                                        onClick={() => onUpdateStoryBible(key, '')}
                                        className="text-[10px] text-gray-400 hover:text-red-600 dark:hover:text-red-400"
                                        title={`Clear ${shortLabel}`}
                                      >
                                        Clear
                                      </button>
                                    )}
                                  </div>
                                </div>
                              </div>
                            );
                          }
                        )}
                      </div>
                    </section>
                  );
                })}
              </div>
            ) : (
              /* Classic Compact Vertical List View */
              <div className="space-y-3" role="region" aria-label="Story Bible list">
                {filteredItems.map(({ key, label, shortLabel, placeholder, multiline }) => {
                  const field = snapshot.storyBible[key];
                  const fieldError = storyBibleErrors?.[key];
                  const hasValue = Boolean(field.value.trim());
                  const inputErrorId = `bible-error-${key}`;
                  return (
                    <div key={key} className="space-y-1">
                      <div className="flex items-center justify-between text-xs">
                        <label
                          htmlFor={`bible-${key}`}
                          className="font-semibold text-gray-800 dark:text-gray-200"
                        >
                          {label}
                        </label>
                        <div className="text-[11px] text-gray-500 dark:text-gray-400 flex items-center gap-1.5">
                          <span className="capitalize">
                            {hasValue ? field.status : 'unset'}
                          </span>
                          <span aria-hidden="true">·</span>
                          <span>{field.provenance}</span>
                          {field.status !== 'confirmed' && hasValue && (
                            <button
                              type="button"
                              onClick={() => onUpdateStoryBible(key, field.value)}
                              className="text-blue-600 dark:text-blue-400 font-semibold hover:underline ml-1"
                            >
                              Confirm
                            </button>
                          )}
                          {hasValue && (
                            <button
                              type="button"
                              onClick={() => onUpdateStoryBible(key, '')}
                              className="text-gray-500 hover:text-red-600 dark:hover:text-red-400 font-medium ml-1"
                              title={`Clear ${shortLabel}`}
                            >
                              Clear
                            </button>
                          )}
                        </div>
                      </div>
                      {multiline ? (
                        <textarea
                          id={`bible-${key}`}
                          rows={2}
                          value={field.value}
                          onChange={(e) => onUpdateStoryBible(key, e.target.value)}
                          placeholder={placeholder}
                          aria-invalid={Boolean(fieldError)}
                          aria-describedby={fieldError ? inputErrorId : undefined}
                          className={`w-full text-xs bg-gray-50 dark:bg-gray-800 border rounded-md p-2 text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 ${
                            fieldError
                              ? 'border-red-500 focus:ring-red-500'
                              : 'border-gray-300 dark:border-gray-700 focus:ring-blue-500'
                          }`}
                        />
                      ) : (
                        <input
                          id={`bible-${key}`}
                          type="text"
                          value={field.value}
                          onChange={(e) => onUpdateStoryBible(key, e.target.value)}
                          onBlur={(e) => {
                            if (e.target.value !== e.target.value.trim()) {
                              onUpdateStoryBible(key, e.target.value.trim());
                            }
                          }}
                          placeholder={placeholder}
                          aria-invalid={Boolean(fieldError)}
                          aria-describedby={fieldError ? inputErrorId : undefined}
                          className={`w-full text-xs bg-gray-50 dark:bg-gray-800 border rounded-md px-2.5 py-1.5 text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 ${
                            fieldError
                              ? 'border-red-500 focus:ring-red-500'
                              : 'border-gray-300 dark:border-gray-700 focus:ring-blue-500'
                          }`}
                        />
                      )}
                      {fieldError && (
                        <p
                          id={inputErrorId}
                          role="alert"
                          className="text-[11px] font-medium text-red-600 dark:text-red-400"
                        >
                          {fieldError}
                        </p>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        );
      })()}

      {/* Tab 3: Consistency Checker */}
      {activeTab === 'consistency' && (
        <div className="flex-1 overflow-y-auto p-4 space-y-3 min-h-0">
          <div>
            <h3 className="font-display text-sm font-bold text-gray-900 dark:text-gray-100">
              Continuity &amp; Consistency Review
            </h3>
            <p className="text-xs text-gray-500 dark:text-gray-400">
              Detects contradicting character traits, incompatible settings, and violated exclusions without silently rewriting your story.
            </p>
          </div>

          {consistencyIssues.length === 0 ? (
            <div className="p-6 text-center rounded-md border border-emerald-200 dark:border-emerald-900/60 bg-emerald-50/40 dark:bg-emerald-950/20">
              <p className="text-xs font-semibold text-emerald-800 dark:text-emerald-300">
                No consistency conflicts detected.
              </p>
              <p className="text-xs text-emerald-700 dark:text-emerald-400 mt-1">
                All confirmed entities, exclusions, and Story Bible properties are aligned.
              </p>
            </div>
          ) : (
            <div className="space-y-2.5">
              {consistencyIssues.map((issue) => (
                <div
                  key={issue.id}
                  className={`p-3 rounded-md border text-xs space-y-1.5 ${
                    issue.severity === 'error'
                      ? 'border-red-300 dark:border-red-800 bg-red-50/50 dark:bg-red-950/30'
                      : 'border-amber-300 dark:border-amber-800 bg-amber-50/50 dark:bg-amber-950/30'
                  }`}
                >
                  <div className="text-[11px] font-medium text-gray-600 dark:text-gray-400">
                    <span className="uppercase font-semibold">{issue.severity}</span>
                    <span aria-hidden="true"> · </span>
                    <span>{issue.category.replace(/_/g, ' ')}</span>
                  </div>
                  <h4 className="font-semibold text-gray-900 dark:text-gray-100">{issue.title}</h4>
                  <p className="text-gray-700 dark:text-gray-300">{issue.description}</p>
                  {issue.suggestedFix && (
                    <p className="text-gray-600 dark:text-gray-400 italic">
                      Recommendation: {issue.suggestedFix}
                    </p>
                  )}
                  {issue.category === 'violated_exclusion' && !issue.id.startsWith('issue_excl_conflict_') &&
                    issue.targets?.some(target => target.kind === 'entity' && target.entityId && issue.id === `issue_excl_${target.entityId}`) && (
                    <button
                      type="button"
                      className="px-2.5 py-1 text-[11px] font-semibold rounded border border-indigo-300 dark:border-indigo-700 bg-white dark:bg-gray-900 text-indigo-700 dark:text-indigo-300 hover:bg-indigo-50 dark:hover:bg-indigo-950/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500"
                      onClick={() => {
                        const target = issue.targets?.find(item => item.kind === 'entity' && item.entityId && issue.id === `issue_excl_${item.entityId}`);
                        if (!target?.entityId) return;
                        const resolved = resolveConsistencyIssueTarget(snapshot, target);
                        if (!resolved.ok || resolved.kind !== 'entity') return;
                        const existence = resolved.entity.attributes.find(attribute => attribute.name === 'existence' || attribute.name === 'existence_in_image');
                        setConsistencyFixPreview({
                          issueId: issue.id,
                          projectId: project.id,
                          baseRevision: project.revision ?? 1,
                          baseSnapshotDigest: computePromptDigest(snapshotJson, snapshot.mode),
                          baseSnapshotJson: snapshotJson,
                          entityId: resolved.entity.id!,
                          before: existence ? `Present (${getEffectiveAttributeValue(existence)})` : 'Present (implicit; no existence field)',
                          after: 'Absent (proposed)',
                        });
                      }}
                    >
                      Preview possible fix
                    </button>
                  )}
                  {issue.targets && issue.targets.length > 0 && (
                    <div
                      className="flex flex-wrap items-center gap-1.5 pt-1"
                      aria-label={`Navigation targets for ${issue.title}`}
                    >
                      {issue.targets.map((target) => {
                        const resolved = resolveConsistencyIssueTarget(snapshot, target);
                        if (!resolved.ok) {
                          return (
                            <button
                              key={target.id}
                              type="button"
                              disabled
                              title={resolved.reason}
                              className="px-2 py-1 text-[11px] font-medium rounded border border-gray-300 dark:border-gray-700 bg-gray-100 dark:bg-gray-800 text-gray-500 dark:text-gray-400 cursor-not-allowed"
                            >
                              {target.label} (Unavailable)
                            </button>
                          );
                        }
                        return (
                          <button
                            key={target.id}
                            type="button"
                            onClick={() => onNavigateConsistencyTarget?.(target)}
                            className="px-2.5 py-1 text-[11px] font-semibold rounded border border-blue-300 dark:border-blue-700 bg-white dark:bg-gray-900 text-blue-700 dark:text-blue-300 hover:bg-blue-50 dark:hover:bg-blue-950/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 transition-colors"
                          >
                            {target.label}
                          </button>
                        );
                      })}
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
          {consistencyFixPreview && (
            <section aria-labelledby="consistency-fix-preview-heading" className="rounded-md border border-indigo-300 dark:border-indigo-700 p-3 space-y-2 text-xs">
              <div className="flex items-start justify-between gap-2">
                <h4 id="consistency-fix-preview-heading" className="font-semibold">Possible change preview</h4>
                <button type="button" className="underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500" onClick={() => setConsistencyFixPreview(null)}>
                  Close preview
                </button>
              </div>
              {previewIsStale ? (
                <p role="status" className="text-amber-800 dark:text-amber-200">
                  This proposal is unavailable because its project, revision, contents, finding, or target changed. Reopen a current finding to preview again.
                </p>
              ) : (
                <>
                  <dl className="grid gap-2 sm:grid-cols-2">
                    <div className="rounded border border-red-300 dark:border-red-800 p-2">
                      <dt className="font-semibold">Before</dt>
                      <dd>{consistencyFixPreview.before}</dd>
                    </div>
                    <div className="rounded border border-emerald-300 dark:border-emerald-800 p-2">
                      <dt className="font-semibold">Proposed after</dt>
                      <dd>{consistencyFixPreview.after}</dd>
                    </div>
                  </dl>
                  <p className="text-gray-600 dark:text-gray-300">Read-only preview · project {consistencyFixPreview.projectId} · revision r{consistencyFixPreview.baseRevision} · base {consistencyFixPreview.baseSnapshotDigest}</p>
                  <p className="font-medium">No project change has been made.</p>
                </>
              )}
            </section>
          )}
        </div>
      )}

      {activeTab === 'opportunities' && (
        <OpportunityCenter
          projectId={project.id}
          projectRevision={project.revision}
          proposals={project.narrative?.opportunities ?? []}
          onCreate={onCreateOpportunity}
          onTransition={onTransitionOpportunity}
        />
      )}

      {activeTab === 'timeline' && (() => {
        const sections = manuscriptSections(project);
        return (
          <div className="flex-1 overflow-y-auto p-4 space-y-3 min-h-0">
            <div>
              <h3 className="font-display text-sm font-bold text-gray-900 dark:text-gray-100">Story Timeline</h3>
              <p className="text-xs text-gray-500 dark:text-gray-400">
                Rows follow the current manuscript order. Chronology notes are shown as authored; no dates or event order are inferred.
              </p>
            </div>
            {sections.length === 0 ? (
              <p className="rounded border border-gray-200 p-3 text-xs text-gray-600 dark:border-gray-700 dark:text-gray-300">
                No current manuscript sections are available. The timeline is empty.
              </p>
            ) : (
              <div className="overflow-x-auto rounded border border-gray-200 dark:border-gray-700">
                <table className="w-full border-collapse text-left text-xs">
                  <caption className="sr-only">Current manuscript order and authored chronology notes</caption>
                  <thead className="bg-gray-50 text-gray-600 dark:bg-gray-800 dark:text-gray-300">
                    <tr>
                      <th scope="col" className="px-3 py-2">Authored order</th>
                      <th scope="col" className="px-3 py-2">Section</th>
                      <th scope="col" className="px-3 py-2">Chronology note</th>
                      <th scope="col" className="px-3 py-2">Temporal status</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100 dark:divide-gray-800">
                    {sections.map((section, index) => {
                      const note = section.chronology?.trim();
                      return (
                        <tr key={section.id}>
                          <td className="px-3 py-2 font-mono">{index + 1}</td>
                          <th scope="row" className="px-3 py-2 font-semibold">{section.title || `Untitled ${section.kind}`}</th>
                          <td className="px-3 py-2">{note ? `Authored note: ${note}` : 'No chronology note recorded.'}</td>
                          <td className="px-3 py-2">{note ? 'Authored; not date-verified' : 'Undated / unspecified'}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        );
      })()}

      {/* Tab 4: Revision History, Persistence, Export & Import */}
      {activeTab === 'history' && (
        <div className="flex-1 overflow-y-auto p-4 space-y-5 min-h-0">
          {/* Export & Import Section */}
          <div id="export-content" tabIndex={-1} className="space-y-2.5">
            <h3 className="font-display text-sm font-bold text-gray-900 dark:text-gray-100">
              Export Content
            </h3>
            <div className="grid grid-cols-1 gap-2">
              <button
                type="button"
                onClick={onExportJson}
                className="w-full text-left px-3 py-2 text-xs font-semibold rounded border border-gray-200 dark:border-gray-700 bg-gray-50 hover:bg-gray-100 dark:bg-gray-800 dark:hover:bg-gray-700 text-gray-900 dark:text-gray-100 transition-colors"
              >
                Download Project Backup (.json)
              </button>
              <button
                type="button"
                onClick={onExportStoryBibleMarkdown}
                className="w-full text-left px-3 py-2 text-xs font-semibold rounded border border-gray-200 dark:border-gray-700 bg-gray-50 hover:bg-gray-100 dark:bg-gray-800 dark:hover:bg-gray-700 text-gray-900 dark:text-gray-100 transition-colors"
              >
                Export Story Bible as Markdown (.md)
              </button>
              <button
                type="button"
                onClick={onExportPromptText}
                className="w-full text-left px-3 py-2 text-xs font-semibold rounded border border-gray-200 dark:border-gray-700 bg-gray-50 hover:bg-gray-100 dark:bg-gray-800 dark:hover:bg-gray-700 text-gray-900 dark:text-gray-100 transition-colors"
              >
                Export Refined Prompt (.txt)
              </button>
            </div>

            <div className="flex flex-wrap gap-2 text-xs underline">
              {onExportManuscript && <button onClick={onExportManuscript}>Download Working Manuscript (.md)</button>}
            </div>
            {contentExports.length > 0 && (
              <div className="flex flex-col gap-2 text-xs">
                <label className="flex min-w-0 flex-col gap-1">Content to export
                  <select className="max-w-full rounded border bg-transparent p-1" value={selectedExport}
                    onChange={event => setSelectedExport(event.target.value)}>
                    <option value="">Select content</option>
                    {contentExports.map(entry => <option key={entry.id} value={entry.id}>{entry.label}</option>)}
                  </select>
                </label>
                <button className="self-end underline disabled:opacity-50"
                  disabled={!contentExports.some(entry => entry.id === selectedExport)}
                  onClick={() => onExportContent(selectedExport)}>Download selected content</button>
                <fieldset className="space-y-1 rounded border border-gray-200 p-2 dark:border-gray-700">
                  <legend className="px-1 font-semibold">Content ZIP bundle</legend>
                  {contentExports.map(entry => (
                    <label key={entry.id} className="flex items-start gap-2">
                      <input type="checkbox" checked={selectedBundleExports.includes(entry.id)}
                        onChange={event => setSelectedBundleExports(previous => event.target.checked
                          ? [...previous, entry.id]
                          : previous.filter(id => id !== entry.id))} />
                      <span>{entry.label}</span>
                    </label>
                  ))}
                  <p className="text-[11px] text-gray-500">ZIP includes a manifest and selected content. It is not a full project backup.</p>
                  <button type="button" className="underline disabled:opacity-50" disabled={selectedBundleExports.length === 0}
                    onClick={() => onExportContentBundle(selectedBundleExports)}>Download selected content ZIP</button>
                </fieldset>
              </div>
            )}
            {/* Import JSON */}
            <div className="pt-2 space-y-2">
              <label className="block text-xs font-semibold text-gray-800 dark:text-gray-200">
                Restore Project Backup from JSON File or Paste JSON
              </label>
              <input
                type="file"
                accept=".json,application/json"
                onChange={handleFileImport}
                aria-label="Import project JSON file"
                className="block w-full text-xs text-gray-600 dark:text-gray-300 file:mr-2 file:py-1.5 file:px-3 file:rounded file:border-0 file:text-xs file:font-semibold file:bg-blue-50 file:text-blue-700 dark:file:bg-blue-950 dark:file:text-blue-300"
              />
              <div className="flex gap-1.5">
                <input
                  type="text"
                  value={importJsonText}
                  onChange={(e) => setImportJsonText(e.target.value)}
                  placeholder="Or paste raw project JSON here..."
                  aria-label="Paste project JSON"
                  className="flex-1 min-w-0 text-xs bg-gray-50 dark:bg-gray-800 border border-gray-300 dark:border-gray-700 rounded px-2.5 py-1.5 text-gray-900 dark:text-gray-100"
                />
                <button
                  type="button"
                  disabled={restoreBusy || !importJsonText.trim()}
                  onClick={() => void previewProjectBackup(importJsonText)}
                  className="px-2.5 py-1.5 text-xs font-semibold bg-blue-600 text-white rounded disabled:opacity-40 whitespace-nowrap"
                >
                  Preview JSON
                </button>
              </div>
              {restorePreview && (
                <div className="space-y-2 rounded border border-amber-400 p-3 text-xs">
                  <p className="break-words">{restorePreview.project.name} · Schema {restorePreview.project.schemaVersion} · Revision {restorePreview.project.revision}</p>
                  <p>A separate project will be created with the included manuscript, plan, artifacts and history.</p>
                  <button type="button" className="mr-2 underline" disabled={restoreBusy} onClick={async () => {
                    setRestoreBusy(true);
                    const result = await onImportProjectJson(restorePreview.raw);
                    setRestoreBusy(false);
                    setImportMessage({ ok: result.ok, text: result.ok ? 'Restored project copy saved.' : (result.error ?? 'Restore failed.') });
                    if (result.ok) { setRestorePreview(null); setImportJsonText(''); }
                  }}>Restore a copy</button>
                  <button type="button" className="underline" disabled={restoreBusy} onClick={() => setRestorePreview(null)}>Cancel</button>
                </div>
              )}
              {importMessage && (
                <p
                  role="alert"
                  className={`text-xs font-medium ${
                    importMessage.ok
                      ? 'text-emerald-600 dark:text-emerald-400'
                      : 'text-red-600 dark:text-red-400'
                  }`}
                >
                  {importMessage.text}
                </p>
              )}
            </div>
          </div>

          {/* Saved Local Projects Switcher */}
          <div id="project-management" tabIndex={-1} className="space-y-2 border-t border-gray-200 dark:border-gray-800 pt-4">
            <h3 className="font-display text-sm font-bold text-gray-900 dark:text-gray-100">
              Saved Local Projects ({savedProjects.length})
            </h3>
            <p className="text-[11px] text-gray-500 dark:text-gray-400">
              Automatically saved in browser storage (IndexedDB + localStorage).
            </p>
            <div className="space-y-1.5">
              {savedProjects.map((proj) => {
                const isCurrent = proj.id === project.id;
                return (
                  <div
                    key={proj.id}
                    className={`flex items-center justify-between gap-2 p-2 rounded border text-xs ${
                      isCurrent
                        ? 'border-blue-500 bg-blue-50/40 dark:bg-blue-950/30'
                        : 'border-gray-200 dark:border-gray-800'
                    }`}
                  >
                    <button
                      type="button"
                      onClick={() => onSwitchProject(proj.id)}
                      className="text-left flex-1 min-w-0"
                    >
                      <div className="font-semibold text-gray-900 dark:text-gray-100 truncate">
                        {proj.name}
                      </div>
                      <div className="text-[11px] text-gray-500 tabular-nums">
                        {proj.revisions.length} revisions · {proj.snapshot.mode} mode
                      </div>
                    </button>
                    {savedProjects.length > 1 && (
                      <button
                        type="button"
                        onClick={() => onDeleteProject(proj.id)}
                        className="text-gray-400 hover:text-red-600 px-1.5 py-0.5 text-xs"
                        aria-label={`Delete project ${proj.name}`}
                      >
                        Delete
                      </button>
                    )}
                  </div>
                );
              })}
            </div>

            <form
              onSubmit={(e) => {
                e.preventDefault();
                if (newProjName.trim() && newProjIdea.trim()) {
                  onCreateNewProject(newProjName.trim(), newProjIdea.trim());
                  setNewProjName('');
                  setNewProjIdea('');
                }
              }}
              className="pt-2 space-y-1.5"
            >
              <input
                type="text"
                value={newProjName}
                onChange={(e) => setNewProjName(e.target.value)}
                placeholder="New project title..."
                aria-label="New project title"
                className="w-full text-xs bg-gray-50 dark:bg-gray-800 border border-gray-300 dark:border-gray-700 rounded px-2.5 py-1.5 text-gray-900 dark:text-gray-100"
              />
              <input
                type="text"
                value={newProjIdea}
                onChange={(e) => setNewProjIdea(e.target.value)}
                placeholder="Initial story or scene idea..."
                aria-label="New project initial prompt"
                className="w-full text-xs bg-gray-50 dark:bg-gray-800 border border-gray-300 dark:border-gray-700 rounded px-2.5 py-1.5 text-gray-900 dark:text-gray-100"
              />
              <button
                type="submit"
                disabled={!newProjName.trim() || !newProjIdea.trim()}
                className="w-full py-1.5 text-xs font-semibold bg-gray-900 dark:bg-gray-700 text-white rounded disabled:opacity-40"
              >
                Create Project
              </button>
            </form>
          </div>

          {/* Durable Version History */}
          <div id="revision-history" tabIndex={-1} className="space-y-2 border-t border-gray-200 dark:border-gray-800 pt-4">
            <h3 className="font-display text-sm font-bold text-gray-900 dark:text-gray-100">
              Revision History ({project.revisions.length})
            </h3>
            <p className="text-[11px] text-gray-500 dark:text-gray-400">
              Restoring any revision preserves your current state as a safety checkpoint first.
            </p>
            <div className="space-y-2">
              {project.revisions.map((rev, idx) => (
                <div
                  key={rev.id}
                  className="p-2.5 rounded border border-gray-200 dark:border-gray-800 text-xs space-y-1"
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-semibold text-gray-900 dark:text-gray-100">
                      {rev.label}
                    </span>
                    {idx > 0 && (
                      <button
                        type="button"
                        onClick={() => onRestoreRevision(rev.id)}
                        className="px-2 py-0.5 text-[11px] font-semibold bg-blue-50 dark:bg-blue-950 text-blue-700 dark:text-blue-300 rounded border border-blue-200 dark:border-blue-800 hover:bg-blue-100"
                      >
                        Restore
                      </button>
                    )}
                  </div>
                  <p className="text-gray-600 dark:text-gray-400">{rev.summary}</p>
                  <div className="text-[10px] text-gray-400 font-mono tabular-nums">
                    {new Date(rev.timestamp).toLocaleTimeString()} · ID: {rev.id.slice(0, 12)}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </aside>
  );
};

export default ContextualInspector;
