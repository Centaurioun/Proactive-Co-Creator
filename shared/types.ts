/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

export type GenerationMode = 'image' | 'story' | 'video';

export interface Candidate {
  name: string;
}

export interface Attribute {
  name: string;
  presence_in_prompt: boolean;
  value: Candidate[];
}

export interface Entity {
  name: string;
  presence_in_prompt: boolean;
  description: string;
  alternatives: Candidate[] | null;
  attributes: Attribute[];
}

export interface Relationship {
  source: string;
  target: string;
  label: string;
  alternatives?: Candidate[];
}

export interface BeliefState {
  entities: Entity[];
  relationships: Relationship[];
  prompt?: string;
}

export interface Clarification {
  question: string;
  options: string[];
}

export interface ClarificationAnswer {
  question: string;
  answer: string;
}

export type GraphUpdate =
  | { type: 'attribute'; entity: string; attribute: string; value: string }
  | { type: 'relationship'; source: string; target: string; oldLabel: string; newLabel: string };

export type ApiErrorCode =
  | 'MISSING_API_KEY'
  | 'AUTH_ERROR'
  | 'RATE_LIMITED'
  | 'MODEL_UNSUPPORTED'
  | 'SAFETY_BLOCKED'
  | 'INVALID_RESPONSE'
  | 'VALIDATION_ERROR'
  | 'TIMEOUT'
  | 'CANCELLED'
  | 'UPSTREAM_ERROR'
  | 'INTERNAL_ERROR';

export interface ApiErrorPayload {
  code: ApiErrorCode;
  message: string;
  retryable: boolean;
}

export interface ImageGenerationResult {
  images: string[];
  requestedCount: number;
  failedCount: number;
  warning: string | null;
}

export interface VideoJobStatusResult {
  status: 'in_progress' | 'completed' | 'failed' | 'cancelled';
  interactionId: string;
  videoUrl?: string;
  error?: string;
}
