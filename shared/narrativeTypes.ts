import type { z } from 'zod';
import type { artifactAnchorSchema, narrativeSchema, sectionSchema } from './narrativeSchemas.ts';

export type ManuscriptSection = z.infer<typeof sectionSchema>;
export type NarrativeRecords = z.infer<typeof narrativeSchema>;
export type ManuscriptVersion = NarrativeRecords['versions'][number];
export type ArtifactAnchor = z.infer<typeof artifactAnchorSchema>;
export type NarrativeIssue = NarrativeRecords['issues'][number];
export type OpportunityProposal = NonNullable<NarrativeRecords['opportunities']>[number];
