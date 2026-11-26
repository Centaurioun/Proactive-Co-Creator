import fs from 'node:fs';
import path from 'node:path';
import type {
  CreativeProject,
  EntityCategory,
  GenerationArtifact,
  ProjectSnapshot,
} from '../shared/types.ts';
import {
  addEntity,
  buildDecisionInboxFromSnapshot,
  createEmptyStoryBible,
  createSampleProject,
  setEntityAttribute,
  setEntityExistence,
  syncStoryBibleWithSceneEntity,
  updateStoryBibleField,
  upsertRelationship,
} from '../lib/canonicalModel.ts';
import { migrateProjectPayload } from '../lib/storageEngine.ts';
import { computePromptDigest, synthesizeRefinedPrompt } from '../lib/promptBuilder.ts';
import { recordProjectRevision } from '../lib/historyEngine.ts';
import { refreshArtifactsCurrentness } from '../lib/projectController.ts';

export const STAGE0_FIXED_TIMESTAMP = 1763942400000; // 2025-11-24T00:00:00.000Z deterministic clock

function makePlaceholderSvgDataUrl(label: string, accent: string, bg: string): string {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="512" height="512" viewBox="0 0 512 512">
  <rect width="512" height="512" fill="${bg}"/>
  <rect x="24" y="24" width="464" height="464" rx="20" fill="none" stroke="${accent}" stroke-width="6" stroke-dasharray="14 8"/>
  <circle cx="256" cy="210" r="76" fill="${accent}" opacity="0.22"/>
  <text x="256" y="218" text-anchor="middle" font-family="sans-serif" font-size="24" font-weight="700" fill="${accent}">${label}</text>
  <text x="256" y="340" text-anchor="middle" font-family="monospace" font-size="16" fill="#475569">STAGE 0 PLACEHOLDER (0 API CALLS)</text>
  <text x="256" y="372" text-anchor="middle" font-family="monospace" font-size="14" fill="#64748b">1:1 Deterministic Fixture Image</text>
</svg>`;
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}

export function buildFxEmpty(): CreativeProject {
  const now = STAGE0_FIXED_TIMESTAMP;
  const emptySnapshot: ProjectSnapshot = {
    originalIdea: '',
    refinedPrompt: '',
    freeformNotes: '',
    mode: 'story',
    entities: [],
    relationships: [],
    storyBible: createEmptyStoryBible(now),
    clarifications: [],
    decisions: [],
    answeredQuestions: [],
    skippedQuestions: [],
  };

  return migrateProjectPayload({
    schemaVersion: 3,
    id: 'fx_empty_project',
    name: 'Untitled Creative Project',
    createdAt: now,
    updatedAt: now,
    revision: 1,
    snapshot: emptySnapshot,
    revisions: [
      {
        id: 'rev_fx_empty_1',
        revisionNumber: 1,
        timestamp: now,
        label: 'Initial blank workspace',
        summary: 'Empty fixture for first-run evaluation',
        changeCount: 0,
        snapshot: structuredClone(emptySnapshot),
      },
    ],
    artifacts: [],
  });
}

export function buildFxSimple(): CreativeProject {
  const base = createSampleProject(STAGE0_FIXED_TIMESTAMP);
  let snap = structuredClone(base.snapshot);
  snap = addEntity(
    snap,
    'Lantern Glade',
    'location',
    'A mossy clearing lit by hanging brass lanterns.',
    'user-edit',
    { atmosphere: 'Quiet dusk', lighting: 'Warm amber lanterns' }
  );
  snap = upsertRelationship(snap, 'Cat', 'Lantern Glade', 'decorates', 'user-edit', {
    status: 'confirmed',
  });
  snap = setEntityAttribute(snap, 'Fox', 'demeanor', 'observant and sly', 'ai-inferred');
  snap = syncStoryBibleWithSceneEntity(snap);
  snap.decisions = buildDecisionInboxFromSnapshot(snap);
  snap.refinedPrompt = synthesizeRefinedPrompt(snap, 'story');

  const raw: CreativeProject = {
    ...base,
    id: 'fx_simple_woodland',
    name: 'Woodland Lantern Mystery (FX-SIMPLE)',
    createdAt: STAGE0_FIXED_TIMESTAMP,
    updatedAt: STAGE0_FIXED_TIMESTAMP + 60_000,
    revision: 2,
    persistedRevision: 2,
    snapshot: snap,
    revisions: [
      ...base.revisions,
      {
        id: 'rev_fx_simple_2',
        revisionNumber: 2,
        timestamp: STAGE0_FIXED_TIMESTAMP + 60_000,
        label: 'Added Lantern Glade location',
        summary: 'Added Lantern Glade and Fox inferred demeanor for FX-SIMPLE',
        changeCount: 3,
        snapshot: structuredClone(snap),
      },
    ],
    artifacts: [],
  };

  return migrateProjectPayload(raw);
}

export function buildFxBusy(): CreativeProject {
  const simple = buildFxSimple();
  let snap = structuredClone(simple.snapshot);

  const extraEntities: Array<{
    name: string;
    category: EntityCategory;
    desc: string;
    attrs: Record<string, string>;
  }> = [
    { name: 'Badger', category: 'character', desc: 'Retired mapmaker guarding the cellar key.', attrs: { role: 'Archivist', mood: 'Cautious' } },
    { name: 'Owl', category: 'character', desc: 'Night watchman perched above the belfry.', attrs: { role: 'Lookout', eyewear: 'Brass spectacles' } },
    { name: 'Hedgehog', category: 'character', desc: 'Pastry chef carrying spiced walnut tarts.', attrs: { specialty: 'Walnut tarts', demeanor: 'Cheerful' } },
    { name: 'Otter', category: 'character', desc: 'River courier delivering sealed invitations.', attrs: { craft: 'Skiff ferryman', coat: 'Rain slicker' } },
    { name: 'Raven', category: 'character', desc: 'Excluded uninvited gossip from the northern ridge.', attrs: { reputation: 'Rumor-monger' } },
    { name: 'Clocktower Mill', category: 'location', desc: 'Waterwheel mill overlooking the clearing.', attrs: { condition: 'Weathered timber' } },
    { name: 'Silver Teapot', category: 'object', desc: 'Heirloom teapot missing its lid since dusk.', attrs: { material: 'Engraved silver', clue: 'Faint pine sap' } },
    { name: 'Sealed Ledger', category: 'object', desc: 'Guest list with one torn corner.', attrs: { status: 'Missing page 4' } },
    { name: 'Lantern Toast', category: 'event', desc: 'Midnight toast when the mystery note is read.', attrs: { timing: 'Midnight' } },
  ];

  for (const ent of extraEntities) {
    snap = addEntity(snap, ent.name, ent.category, ent.desc, 'user-edit', ent.attrs);
  }

  // Add AI-inferred attributes so >= 12 mixed decision items appear
  snap = setEntityAttribute(snap, 'Badger', 'alibi', 'Cataloguing maps in cellar', 'ai-inferred');
  snap = setEntityAttribute(snap, 'Owl', 'suspicion', 'Saw shadows near Clocktower Mill', 'ai-inferred');
  snap = setEntityAttribute(snap, 'Hedgehog', 'secret', 'Borrowed the Silver Teapot earlier', 'ai-inferred');
  snap = setEntityAttribute(snap, 'Otter', 'arrivalTime', 'Arrived late by river fog', 'ai-inferred');
  snap = setEntityAttribute(snap, 'Silver Teapot', 'inscription', 'Belongs to Cat family', 'ai-inferred');
  snap = setEntityAttribute(snap, 'Sealed Ledger', 'handwriting', 'Matches Fox quill nib', 'ai-inferred');

  // Exclude Raven explicitly (existence=false)
  snap = setEntityExistence(snap, 'Raven', false, 'user-edit');

  // Rich directed & parallel relationships
  snap = upsertRelationship(snap, 'Badger', 'Clocktower Mill', 'guards', 'user-edit', { status: 'confirmed' });
  snap = upsertRelationship(snap, 'Owl', 'Clocktower Mill', 'watches from', 'ai-inferred', { status: 'pending' });
  snap = upsertRelationship(snap, 'Hedgehog', 'Silver Teapot', 'polished', 'ai-inferred', { status: 'pending' });
  snap = upsertRelationship(snap, 'Otter', 'Cat', 'delivered mail to', 'user-edit', { status: 'confirmed' });
  snap = upsertRelationship(snap, 'Cat', 'Otter', 'thanked', 'user-edit', { status: 'confirmed' });
  snap = upsertRelationship(snap, 'Fox', 'Sealed Ledger', 'examined', 'ai-inferred', { status: 'pending' });
  snap = upsertRelationship(snap, 'Fox', 'Cat', 'suspects', 'ai-inferred', { status: 'pending' });
  snap = upsertRelationship(snap, 'Cat', 'Lantern Toast', 'schedules', 'user-edit', { status: 'confirmed' });

  // Deliberate consistency issue: exclude Fox in Story Bible while Fox exists in graph
  snap = updateStoryBibleField(snap, 'explicitExclusions', 'Fox', 'user-edit');
  snap = updateStoryBibleField(snap, 'genre', 'Cozy Woodland Whodunit', 'user-edit');
  snap = updateStoryBibleField(snap, 'visualStyle', 'Storybook gouache with warm brass highlights', 'user-edit');
  snap = syncStoryBibleWithSceneEntity(snap);

  // Build decisions with mixed pending/accepted/rejected/deferred states
  const builtDecisions = buildDecisionInboxFromSnapshot(snap);
  let rejectedSet = false;
  let deferredSet = false;
  snap.decisions = builtDecisions.map((d) => {
    if (d.status === 'pending' && !rejectedSet && d.title.toLowerCase().includes('inscription')) {
      rejectedSet = true;
      return { ...d, status: 'rejected' as const };
    }
    if (d.status === 'pending' && !deferredSet && d.title.toLowerCase().includes('arrivaltime')) {
      deferredSet = true;
      return { ...d, status: 'deferred' as const };
    }
    return d;
  });

  snap.refinedPrompt = synthesizeRefinedPrompt(snap, 'story');

  let project: CreativeProject = {
    ...simple,
    id: 'fx_busy_mystery',
    name: 'Lantern Mill Whodunit — Busy World (FX-BUSY)',
    updatedAt: STAGE0_FIXED_TIMESTAMP + 180_000,
    snapshot: snap,
  };
  project = recordProjectRevision(
    project,
    'Expanded world to 12+ entities',
    'Added characters, objects, parallel edges, and consistency check',
    18
  );

  const storyArtifact: GenerationArtifact = {
    id: 'art_busy_story_1',
    projectId: project.id,
    mode: 'story',
    createdAt: STAGE0_FIXED_TIMESTAMP + 170_000,
    revisionId: project.revisions[0]?.id ?? 'rev_1',
    sourceRevision: 1,
    promptUsed: simple.snapshot.refinedPrompt,
    promptDigest: computePromptDigest(simple.snapshot.refinedPrompt, 'story'),
    storyText: 'An earlier draft before Badger, Owl, and the missing Silver Teapot joined the evening.',
    isOutdated: true,
  };
  project.artifacts = refreshArtifactsCurrentness([storyArtifact], project.snapshot);
  project.persistedRevision = project.revision;
  return migrateProjectPayload(project);
}

export function buildFxOut(): CreativeProject {
  const simple = buildFxSimple();
  let project: CreativeProject = {
    ...simple,
    id: 'fx_output_gallery',
    name: 'Woodland Dinner — Outputs & History (FX-OUT)',
  };

  const oldPrompt = project.snapshot.refinedPrompt;
  const oldDigest = computePromptDigest(oldPrompt, 'story');
  const oldRevId = project.revisions[0]?.id ?? 'rev_1';

  const nextSnap = updateStoryBibleField(
    project.snapshot,
    'tone',
    'Warm candlelit mystery with gentle wit',
    'user-edit'
  );
  nextSnap.refinedPrompt = synthesizeRefinedPrompt(nextSnap, 'story');
  project = {
    ...project,
    snapshot: nextSnap,
  };
  project = recordProjectRevision(
    project,
    'Refined tone for output fixture',
    'Updated Story Bible tone before generating current outputs',
    1
  );

  const currentStoryPrompt = synthesizeRefinedPrompt(project.snapshot, 'story');
  const currentStoryDigest = computePromptDigest(currentStoryPrompt, 'story');
  const currentImagePrompt = synthesizeRefinedPrompt(project.snapshot, 'image');
  const currentImageDigest = computePromptDigest(currentImagePrompt, 'image');
  const currentRevId = project.revisions[project.revisions.length - 1]?.id ?? 'rev_current';

  const longStory = [
    'Beneath the canopy of Lantern Glade, Cat adjusted the last brass wick until amber light pooled across the cedar table. Pine needles hissed softly in the evening mist as footsteps crunched along the gravel path.',
    'Rabbit arrived first, clutching a cloth-wrapped basket of warm rosemary loaves and glancing nervously toward the shadows beyond the creek. "Are we certain everyone read the invitation?" Rabbit whispered, straightening a crooked bowtie.',
    'Before Cat could answer, Fox stepped smoothly into the ring of lantern light, coat brushed spotless and eyes already cataloguing every place setting. Fox offered a polite bow, yet lingered near the sideboard where the folded seating chart rested.',
    'Over steaming mugs of spiced apple cider, the conversation drifted from autumn harvests to the curious disappearance of the orchard bell. Each guest spoke warmly, though every remark carried a small, careful silence beneath it.',
    'When a distant chime echoed from the timber ridge, Cat set down the porcelain ladle and smiled. "It seems our dinner party has a second chapter," Cat murmured, lifting a lantern high enough to reveal muddy prints leading back toward the glade entrance.',
    'By the time dessert plates were cleared, old suspicions had softened into an unexpected alliance: Cat, Rabbit, and Fox agreed to trace the lantern trail together before the woodland fog closed in for good.',
  ].join('\n\n');

  const artifacts: GenerationArtifact[] = [
    {
      id: 'art_fx_out_story_current',
      projectId: project.id,
      mode: 'story',
      createdAt: STAGE0_FIXED_TIMESTAMP + 300_000,
      revisionId: currentRevId,
      sourceRevision: project.revision,
      promptUsed: currentStoryPrompt,
      promptDigest: currentStoryDigest,
      storyText: longStory,
      isOutdated: false,
    },
    {
      id: 'art_fx_out_images_current',
      projectId: project.id,
      mode: 'image',
      createdAt: STAGE0_FIXED_TIMESTAMP + 290_000,
      revisionId: currentRevId,
      sourceRevision: project.revision,
      promptUsed: currentImagePrompt,
      promptDigest: currentImageDigest,
      images: [
        makePlaceholderSvgDataUrl('Scene 1: Lantern Glade', '#b45309', '#fef3c7'),
        makePlaceholderSvgDataUrl('Scene 2: Cat Hosting', '#0f766e', '#ccfbf1'),
        makePlaceholderSvgDataUrl('Scene 3: Fox Observing', '#7c2d12', '#ffedd5'),
        makePlaceholderSvgDataUrl('Scene 4: Midnight Toast', '#1d4ed8', '#dbeafe'),
      ],
      isOutdated: false,
    },
    {
      id: 'art_fx_out_story_outdated',
      projectId: project.id,
      mode: 'story',
      createdAt: STAGE0_FIXED_TIMESTAMP + 60_000,
      revisionId: oldRevId,
      sourceRevision: 1,
      promptUsed: oldPrompt,
      promptDigest: oldDigest,
      storyText: 'Earlier revision story draft generated prior to the tone update. Retained to verify outdated-artifact badge and history comparison.',
      isOutdated: true,
    },
  ];

  project.artifacts = refreshArtifactsCurrentness(artifacts, project.snapshot);
  project.persistedRevision = project.revision;
  return migrateProjectPayload(project);
}

export function buildSyntheticGraphProject(entityCount: number): CreativeProject {
  const base = buildFxEmpty();
  let snap = structuredClone(base.snapshot);
  snap.originalIdea = `Synthetic benchmark world with ${entityCount} entities and deterministic topology.`;

  const categories: EntityCategory[] = ['character', 'location', 'object', 'event'];
  for (let i = 0; i < entityCount; i++) {
    const category = categories[i % categories.length];
    snap = addEntity(
      snap,
      `Node_${String(i + 1).padStart(3, '0')}`,
      category,
      `Synthetic ${category} #${i + 1} for graph performance baseline.`,
      'user-edit',
      {
        tier: `T${(i % 4) + 1}`,
        role: `${category}_${i + 1}`,
      }
    );
  }

  const edgeLabels = ['allies with', 'guards', 'investigates', 'travels to', 'carries'];
  for (let i = 0; i < entityCount; i++) {
    const src = `Node_${String(i + 1).padStart(3, '0')}`;
    const nextIdx = (i + 1) % entityCount;
    const dst = `Node_${String(nextIdx + 1).padStart(3, '0')}`;
    snap = upsertRelationship(snap, src, dst, edgeLabels[i % edgeLabels.length], 'user-edit', {
      status: 'confirmed',
    });
    if (i % 2 === 0 && entityCount >= 6) {
      const chordIdx = (i + Math.max(3, Math.floor(entityCount / 5))) % entityCount;
      if (chordIdx !== i) {
        const chordDst = `Node_${String(chordIdx + 1).padStart(3, '0')}`;
        snap = upsertRelationship(snap, src, chordDst, edgeLabels[(i + 2) % edgeLabels.length], 'ai-inferred', {
          status: 'pending',
        });
      }
    }
  }

  snap.decisions = buildDecisionInboxFromSnapshot(snap);
  snap.refinedPrompt = synthesizeRefinedPrompt(snap, 'story');

  return migrateProjectPayload({
    ...base,
    id: `fx_stress_${entityCount}`,
    name: `Synthetic Stress Graph (${entityCount} nodes)`,
    snapshot: snap,
  });
}

export function emitStage0FixtureBundle(outPath: string): void {
  const bundle = {
    generatedAt: new Date(STAGE0_FIXED_TIMESTAMP).toISOString(),
    schemaVersion: 3,
    fixtures: {
      'FX-EMPTY': buildFxEmpty(),
      'FX-SIMPLE': buildFxSimple(),
      'FX-BUSY': buildFxBusy(),
      'FX-OUT': buildFxOut(),
      'FX-STRESS-10': buildSyntheticGraphProject(10),
      'FX-STRESS-30': buildSyntheticGraphProject(30),
      'FX-STRESS-100': buildSyntheticGraphProject(100),
      'FX-STRESS-250': buildSyntheticGraphProject(250),
    },
  };
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, JSON.stringify(bundle, null, 2));
}

const invokedDirectly =
  process.argv[1] &&
  path.resolve(process.argv[1]) === path.resolve(decodeURIComponent(new URL(import.meta.url).pathname));
if (invokedDirectly) {
  const target = process.argv[2] || path.resolve(process.cwd(), '.playwright-cli/stage0-fixtures.json');
  emitStage0FixtureBundle(target);
  console.log(`STAGE0_FIXTURES_WRITTEN: ${target}`);
}
