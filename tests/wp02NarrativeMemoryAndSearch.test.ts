import assert from 'node:assert/strict';
import test from 'node:test';
import { createSampleProject } from '../lib/canonicalModel';
import { createUndoRedoState } from '../lib/historyEngine';
import { buildEmbeddingNamespaceKey } from '../shared/embeddingSchema';
import {
  computeDeterministicDigest,
  foldDiacritics,
  isValidUtf16Boundary,
  normalizeUnicodeText,
  snapToValidUtf16Boundary,
  tokenizeForLexicalIndex,
} from '../lib/narrative/memory/textNormalization';
import { chunkNarrativeSection } from '../lib/narrative/memory/chunker';
import {
  buildNarrativeMemoryIndex,
  isNarrativeMemoryIndexFresh,
} from '../lib/narrative/memory/indexBuilder';
import {
  deleteNarrativeMemoryIndex,
  loadNarrativeMemoryIndex,
  saveNarrativeMemoryIndex,
} from '../lib/narrative/memory/indexRepository';
import {
  deleteProjectVectorsByNamespace,
  loadProjectVectorRecords,
  saveChunkVectorRecords,
  StoredChunkVectorRecord,
} from '../lib/narrative/memory/vectorRepository';
import { executeHybridNarrativeSearch } from '../lib/narrative/memory/hybridSearch';
import {
  manuscriptSections,
  narrativeBase,
  prepareManuscriptChange,
} from '../lib/narrative/manuscriptModel';
import type { ManuscriptSection } from '../shared/narrativeTypes';
import type { CreativeProject, Entity, Relationship } from '../shared/types';

function setProjectManuscriptSections(
  project: CreativeProject,
  sections: ManuscriptSection[]
): CreativeProject {
  const undo = createUndoRedoState(project.snapshot, project.revisions, project.undoHistory);
  const res = prepareManuscriptChange(project, undo, narrativeBase(project), sections);
  return res ? res.project : project;
}

function createRichTestProject(id = 'wp02-test-proj'): CreativeProject {
  const base = createSampleProject();
  const initialSections: ManuscriptSection[] = [
    {
      id: 'sec-1',
      kind: 'scene',
      title: 'İstanbul Şafak Vakti',
      text: 'İhsan ve Işık eski kütüphanede buluştu. 🔮 Gizemli usturlap masanın üzerinde parlıyordu.\n\nİkinci paragrafta Işık defteri açtı ve haritayı inceledi.',
    },
    {
      id: 'sec-2',
      kind: 'scene',
      title: 'Karanlık Mahzen',
      text: 'Üçüncü sahnede gizli geçitten mahzene indiler. Orada Kaptan Demir onları bekliyordu.',
    },
  ];
  const updated = setProjectManuscriptSections(base, initialSections);

  const entities: Entity[] = [
    {
      id: 'ent-ihsan',
      name: 'İhsan',
      type: 'character',
      category: 'character',
      aliases: ['Baş Arşivci İhsan'],
      status: 'confirmed',
      provenance: 'user',
      attributes: [
        {
          name: 'Unvan',
          value: [{ name: 'Harita Muhafızı', confidence: 'High' }],
          confirmedValue: 'Harita Muhafızı',
          status: 'confirmed',
          provenance: 'user',
        },
      ],
    },
    {
      id: 'ent-isik',
      name: 'Işık',
      type: 'character',
      category: 'character',
      aliases: ['Gezgin Işık'],
      status: 'confirmed',
      provenance: 'user',
      attributes: [],
    },
    {
      id: 'ent-demir',
      name: 'Kaptan Demir',
      type: 'character',
      category: 'character',
      aliases: ['Demir'],
      status: 'confirmed',
      provenance: 'user',
      attributes: [],
    },
  ];

  const relationships: Relationship[] = [
    {
      id: 'rel-1',
      source: 'İhsan',
      target: 'Işık',
      sourceId: 'ent-ihsan',
      targetId: 'ent-isik',
      label: 'mentors in cartography',
      status: 'confirmed',
      provenance: 'user',
    },
    {
      id: 'rel-2',
      source: 'Kaptan Demir',
      target: 'İhsan',
      sourceId: 'ent-demir',
      targetId: 'ent-ihsan',
      label: 'ambushes in cellar',
      status: 'confirmed',
      provenance: 'user',
    },
  ];

  return {
    ...updated,
    id,
    revision: 5,
    snapshot: {
      ...updated.snapshot,
      entities,
      relationships,
    },
  };
}

test('Turkish normalization & UTF-16 surrogate boundary safety', () => {
  assert.equal(normalizeUnicodeText('İSTANBUL IŞIK'), 'istanbul ışık');
  assert.equal(normalizeUnicodeText('İhsan Işık'), 'ihsan ışık');
  assert.equal(foldDiacritics('İstanbul Şafak ĞÜŞİÖÇ'), 'istanbul safak gusioc');

  const tokens = tokenizeForLexicalIndex('İhsan ile Işık kütüphanede buluştu.');
  assert.ok(tokens.includes('ihsan'));
  assert.ok(tokens.includes('ışık'));

  // Emoji surrogate pair test: '🔮' takes 2 UTF-16 code units
  const textWithEmoji = 'Başlangıç 🔮 Bitiş';
  const emojiStart = textWithEmoji.indexOf('🔮');
  assert.equal(isValidUtf16Boundary(textWithEmoji, emojiStart), true);
  assert.equal(isValidUtf16Boundary(textWithEmoji, emojiStart + 1), false);
  assert.equal(isValidUtf16Boundary(textWithEmoji, emojiStart + 2), true);
  assert.equal(snapToValidUtf16Boundary(textWithEmoji, emojiStart + 1, 'backward'), emojiStart);
  assert.equal(snapToValidUtf16Boundary(textWithEmoji, emojiStart + 1, 'forward'), emojiStart + 2);
});

test('Chunking preserves exact UTF-16 boundaries and reuses unchanged chunks across revisions', () => {
  const project = createRichTestProject('proj-chunk-reuse');
  const sections = manuscriptSections(project);
  const chunks = chunkNarrativeSection({
    sourceKind: 'manuscript',
    sectionId: sections[0].id,
    sectionTitle: sections[0].title,
    text: sections[0].text,
    presentationOrder: 0,
  });

  assert.ok(chunks.length >= 1);
  for (const c of chunks) {
    assert.equal(isValidUtf16Boundary(sections[0].text, c.startOffset), true);
    assert.equal(isValidUtf16Boundary(sections[0].text, c.endOffset), true);
    assert.equal(sections[0].text.slice(c.startOffset, c.endOffset), c.text);
  }

  const indexR5 = buildNarrativeMemoryIndex(project);
  assert.equal(isNarrativeMemoryIndexFresh(indexR5, project), true);

  // Modify only section 2 in revision 6 and verify section 1 chunks are reused
  const modifiedSections = [
    sections[0],
    {
      ...sections[1],
      text: `${sections[1].text} Yeni bir cümle eklendi.`,
    },
  ];
  const projectR6: CreativeProject = {
    ...setProjectManuscriptSections(project, modifiedSections),
    revision: 6,
  };
  assert.equal(isNarrativeMemoryIndexFresh(indexR5, projectR6), false);

  const indexR6 = buildNarrativeMemoryIndex(projectR6, indexR5);
  const sec1ChunksR5 = indexR5.chunks.filter((c) => c.sectionId === 'sec-1');
  const sec1ChunksR6 = indexR6.chunks.filter((c) => c.sectionId === 'sec-1');
  assert.deepEqual(
    sec1ChunksR5.map((c) => c.digest),
    sec1ChunksR6.map((c) => c.digest)
  );
});

test('E1 index indexes >100 entities and >110 relationships without 80/100 silent truncation', () => {
  const base = createRichTestProject('proj-large-world');
  const manyEntities: Entity[] = Array.from({ length: 105 }, (_, i) => ({
    id: `ent-${i}`,
    name: `Character_${i}`,
    type: 'character',
    category: 'character' as const,
    aliases: [`Alias_${i}`],
    status: 'confirmed' as const,
    provenance: 'user' as const,
    attributes: [],
  }));
  const manyRelationships: Relationship[] = Array.from({ length: 115 }, (_, i) => ({
    id: `rel-${i}`,
    source: `Character_${i % 105}`,
    target: `Character_${(i + 1) % 105}`,
    sourceId: `ent-${i % 105}`,
    targetId: `ent-${(i + 1) % 105}`,
    label: `allied_with_${i}`,
    status: 'confirmed' as const,
    provenance: 'user' as const,
  }));

  const largeProject: CreativeProject = {
    ...base,
    snapshot: {
      ...base.snapshot,
      entities: manyEntities,
      relationships: manyRelationships,
    },
  };

  const index = buildNarrativeMemoryIndex(largeProject);
  assert.equal(index.entities.length, 105);
  assert.equal(index.relationships.length, 115);

  // Search for entity #99 (beyond old 80 cap) and relationship #112 (beyond old 100 cap)
  const entitySearch = executeHybridNarrativeSearch(index, {
    query: 'Character_99',
    scope: 'story-model',
  });
  assert.ok(entitySearch.results.some((item) => item.entityId === 'ent-99'));

  const relSearch = executeHybridNarrativeSearch(index, {
    query: 'allied_with_112',
    scope: 'story-model',
  });
  assert.ok(relSearch.results.some((item) => item.relationshipId === 'rel-112'));
});

test('Hybrid retrieval fuses exact structured lookup, BM25, and namespace-isolated semantic vectors with spoiler boundary enforcement', async () => {
  const project = createRichTestProject('proj-hybrid-rrf');
  const index = buildNarrativeMemoryIndex(project);

  // 1. Turkish dotted/dotless search for "İhsan" and "Harita Muhafızı"
  const turkishRes = executeHybridNarrativeSearch(index, {
    query: 'İhsan Harita Muhafızı',
    scope: 'all',
  });
  assert.ok(turkishRes.results.length > 0);
  assert.ok(turkishRes.results.some((item) => item.entityId === 'ent-ihsan' || item.sectionId === 'sec-1'));

  // 2. Reader Spoiler Boundary: when maxPresentationOrder = 0 (Scene 1 only),
  // Scene 2 ("Kaptan Demir", "mahzene") and Kaptan Demir entity (first appearing in Scene 2) must be filtered out!
  const spoilerUnbounded = executeHybridNarrativeSearch(index, {
    query: 'Kaptan Demir mahzene',
    scope: 'all',
  });
  assert.ok(spoilerUnbounded.results.length > 0);

  const spoilerBounded = executeHybridNarrativeSearch(index, {
    query: 'Kaptan Demir mahzene',
    scope: 'all',
    maxPresentationOrder: 0,
  });
  assert.equal(spoilerBounded.results.length, 0);
  assert.ok(spoilerBounded.spoilerFilteredCount > 0);

  // 3. Semantic RRF Fusion with strict namespace isolation
  const nsLocal = {
    providerId: 'lm-studio-local' as const,
    modelId: 'Qwen3-Embedding-0.6B',
    dimensions: 4,
    taskInstruction: 'narrative-passage',
    namespaceKey: buildEmbeddingNamespaceKey({
      providerId: 'lm-studio-local',
      modelId: 'Qwen3-Embedding-0.6B',
      dimensions: 4,
      taskInstruction: 'narrative-passage',
    }),
  };
  const nsCloudflare = {
    providerId: 'cloudflare-workers-ai' as const,
    modelId: '@cf/qwen/qwen3-embedding-0.6b',
    dimensions: 4,
    taskInstruction: 'narrative-passage',
    namespaceKey: buildEmbeddingNamespaceKey({
      providerId: 'cloudflare-workers-ai',
      modelId: '@cf/qwen/qwen3-embedding-0.6b',
      dimensions: 4,
      taskInstruction: 'narrative-passage',
    }),
  };
  assert.notEqual(nsLocal.namespaceKey, nsCloudflare.namespaceKey);

  const sec1Chunk = index.chunks.find((c) => c.sectionId === 'sec-1')!;
  const storedVectors: StoredChunkVectorRecord[] = [
    {
      id: `${project.id}::${nsLocal.namespaceKey}::${sec1Chunk.id}`,
      projectId: project.id,
      projectRevision: project.revision,
      chunkId: sec1Chunk.id,
      chunkDigest: sec1Chunk.digest,
      namespace: nsLocal,
      vector: [1, 0, 0, 0],
      updatedAt: Date.now(),
    },
  ];

  // Querying with a Cloudflare vector must NOT match the LM Studio vector even though both have 4 dims
  const mismatchedNsSearch = executeHybridNarrativeSearch(index, {
    query: 'astrolabe',
    queryVectors: [{ namespace: nsCloudflare, vector: [1, 0, 0, 0] }],
    storedVectors,
  });
  const usedMismatched = mismatchedNsSearch.namespaceDiagnostics.filter((d) => d.status === 'used');
  assert.equal(usedMismatched.length, 0);

  // Querying with matching LM Studio namespace fuses semantic similarity via RRF
  const matchedNsSearch = executeHybridNarrativeSearch(index, {
    query: 'usturlap',
    queryVectors: [{ namespace: nsLocal, vector: [1, 0, 0, 0] }],
    storedVectors,
  });
  assert.ok(
    matchedNsSearch.namespaceDiagnostics.some(
      (d) => d.namespaceKey === nsLocal.namespaceKey && d.status === 'used'
    )
  );
  const topChunkHit = matchedNsSearch.results.find(
    (i) => i.kind === 'chunk' && i.sectionId === 'sec-1'
  );
  assert.ok(topChunkHit);
  assert.ok(topChunkHit.channels.some((c) => c.channel === 'semantic-vector'));
  assert.ok(topChunkHit.channels.some((c) => c.channel === 'lexical-bm25'));
});

test('Persistence repository & project deletion purge derived index and vector records', async () => {
  const project = createRichTestProject('proj-delete-cleanup');
  const index = buildNarrativeMemoryIndex(project);
  await saveNarrativeMemoryIndex(index);

  const loaded = await loadNarrativeMemoryIndex(project.id);
  assert.ok(loaded);
  assert.equal(loaded.projectId, project.id);

  const nsKey = 'lm-studio-local::test-model::dim4::narrative-passage';
  await saveChunkVectorRecords([
    {
      id: `${project.id}::${nsKey}::chunk-1`,
      projectId: project.id,
      projectRevision: project.revision,
      chunkId: 'chunk-1',
      chunkDigest: computeDeterministicDigest('chunk-1'),
      namespace: {
        providerId: 'lm-studio-local',
        modelId: 'test-model',
        dimensions: 4,
        taskInstruction: 'narrative-passage',
        namespaceKey: nsKey,
      },
      vector: [0.5, 0.5, 0.5, 0.5],
      updatedAt: Date.now(),
    },
  ]);

  const loadedVecs = await loadProjectVectorRecords(project.id);
  assert.equal(loadedVecs.length, 1);

  await deleteNarrativeMemoryIndex(project.id);
  await deleteProjectVectorsByNamespace(project.id);

  assert.equal(await loadNarrativeMemoryIndex(project.id), null);
  assert.equal((await loadProjectVectorRecords(project.id)).length, 0);
});
