# Proactive Co-Creator 2.0 — Canonical Creative Data Model (`schemaVersion: 2`)

## 1. Design Principles

1. **Single Authoritative Source of Truth:** All workspace views (Decision Inbox, Belief Graph 2.0, Contextual Inspector, Story Bible, Refined Prompt, and Consistency Checker) read from and commit transactions to `CreativeProject` and its active `ProjectSnapshot`.
2. **Stable Internal IDs:** Every entity (`ent_*`), attribute (`attr_*`), relationship (`rel_*`), decision (`dec_*`), and revision (`rev_*`) has a stable internal identifier. Renaming an entity updates its display `name` and appends the previous name to `aliases[]` while keeping all relationship endpoints (`sourceId`, `targetId`) and decision links intact.
3. **Provenance & Approval Status Tracking:**
   - `DecisionProvenance`: `'prompt-explicit' | 'user-edit' | 'accepted-suggestion' | 'ai-inferred' | 'imported' | 'derived'`
   - `ApprovalStatus`: `'confirmed' | 'pending' | 'rejected'`
4. **Strict User Authority:** When AI reanalysis or clarification refresh runs (`mergeAnalysisIntoSnapshot`), any confirmed user edit, entity rename, or explicit exclusion (`excluded: true` / `existence: 'false'`) is strictly preserved. New AI discoveries are staged as `'pending'` proposals in the Decision Inbox.

---

## 2. Core Type Hierarchy (`shared/types.ts`)

```ts
export type GenerationMode = 'story' | 'image'; // Video generation removed in 2.0

export interface CreativeProject {
  schemaVersion: number; // Currently 2
  id: string;
  name: string;
  createdAt: number;
  updatedAt: number;
  snapshot: ProjectSnapshot;
  artifacts: GenerationArtifact[];
  revisions: ProjectRevision[];
}

export interface ProjectSnapshot {
  originalIdea: string;
  refinedPrompt: string;
  freeformNotes: string;
  mode: GenerationMode;
  entities: Entity[];
  relationships: Relationship[];
  storyBible: StoryBible;
  clarifications: Clarification[];
  decisions: DecisionItem[];
  answeredQuestions: string[];
  skippedQuestions: string[];
}
```

---

## 3. Bidirectional Story Bible & Scene Entity Synchronization

`syncStoryBibleWithSceneEntity` and `updateStoryBibleField` maintain deterministic synchronization between `snapshot.storyBible` and the `"The Story"` / `"The Image"` scene meta-entity attributes:
- Editing a Story Bible field (`genre`, `tone`, `narrativePerspective`, `intendedAudience`, `setting`, `themes`, `centralConflict`, `pacing`, `continuityRules`, `explicitExclusions`, `visualStyle`, `cameraAndLighting`) marks it `'confirmed'` with `'user-edit'` provenance and updates the corresponding scene attribute.
- Excluding an entity (`setEntityExistence(snapshot, id, false)`) sets `entity.excluded = true`, updates its `existence` attribute to `'false'` (`confirmed`), and appends the entity name to `storyBible.explicitExclusions`.

---

## 4. Legacy Migration (`migrateProjectPayload`)

- Accepts both `schemaVersion: 2` exports and legacy v0/v1 saved payloads.
- Safely converts legacy `mode: 'video'` projects to `mode: 'story'` and renames any legacy `'The Video'` scene entity to `'The Story'`, preserving all recoverable entities, attributes, relationships, stories, and images.
