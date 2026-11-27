import type { AiOperation } from '../aiBudget.ts';

export type AiConnectionId = 'gemini-managed' | 'gemini-personal' | 'chatgpt-plan' | 'openai-api';
export type AiProviderFamily = 'gemini' | 'openai';
export type AiBillingPath = 'host-managed-gemini' | 'gemini-api-key' | 'chatgpt-plan' | 'openai-api-key';
export type AiReasoningLevel = 'default' | 'none' | 'minimal' | 'low' | 'medium' | 'high' | 'extra-high' | 'max';
export type AiModality = 'text' | 'image';
export type AiCapabilityState = 'supported' | 'unsupported' | 'unknown';
export type AiCapabilityEvidenceSource = 'account-catalog' | 'official-documentation' | 'live-qualification';
export interface AiCapabilityEvidence {
  source: AiCapabilityEvidenceSource;
  reference: string;
  checkedAt: string;
  transport: string;
  modelSlug: string;
}
export type AiCapability<T> =
  | { state: 'supported'; value: T; evidence: AiCapabilityEvidence[] }
  | { state: 'unsupported'; evidence: AiCapabilityEvidence[] }
  | { state: 'unknown'; reason: string };
export type AiConnectionState =
  | 'available'
  | 'unconfigured'
  | 'connecting'
  | 'connected'
  | 'authorization-required'
  | 'expired'
  | 'unsupported-environment'
  | 'rate-limited'
  | 'quota-exhausted'
  | 'failed';

export interface AiModelDescriptor {
  id: string;
  displayName: string;
  availability: AiCapability<boolean>;
  textGeneration: AiCapability<boolean>;
  imageGeneration: AiCapability<boolean>;
  structuredOutput: AiCapability<boolean>;
  contextLimit: AiCapability<number>;
  outputLimit: AiCapability<number>;
  reasoning: AiCapability<readonly AiReasoningLevel[]>;
  operationCapabilities: Partial<Record<AiOperation, AiCapability<boolean>>>;
  capabilityPolicyVersion: string;
}

export interface AiConnectionDescriptor {
  id: AiConnectionId;
  family: AiProviderFamily;
  billing: AiBillingPath;
  state: AiConnectionState;
  selectedModelId?: string;
  models: AiModelDescriptor[];
  message?: string;
  lastCheckedAt?: string;
}

export interface AiProviderSelection {
  connectionId: AiConnectionId;
  modelId?: string;
  reasoningLevel?: AiReasoningLevel;
}

export interface AiProviderRequest {
  operation: AiOperation;
  modelId: string;
  input: string;
  instructions?: string;
  reasoningLevel?: AiReasoningLevel;
  maxInputBytes: number;
  maxOutputBytes: number;
  /** Provider-enforced hard generation ceiling when the billing transport supports it. */
  maxOutputTokens?: number;
  /** Existing provider-native generation settings that must survive routing. */
  responseMimeType?: string;
  thinkingConfig?: unknown;
  timeoutMs: number;
  signal?: AbortSignal;
  responseSchema?: unknown;
}

export interface AiTokenCount {
  tokens: number;
  source: 'provider-count' | 'estimate';
}

export interface AiProviderTextResult {
  text: string;
  usage?: {
    inputTokens?: number;
    outputTokens?: number;
    source: 'provider-observed' | 'estimate' | 'unknown';
  };
}

export interface AiProviderAdapter {
  readonly connectionId: AiConnectionId;
  readonly family: AiProviderFamily;
  readonly billing: AiBillingPath;
  listModels(signal?: AbortSignal): Promise<AiModelDescriptor[]>;
  countTokens(modelId: string, input: string, signal?: AbortSignal, instructions?: string, generation?: Pick<AiProviderRequest, 'responseSchema' | 'responseMimeType' | 'thinkingConfig'>): Promise<AiTokenCount>;
  generateText(request: AiProviderRequest): Promise<AiProviderTextResult>;
  generateImage?(request: AiProviderRequest): Promise<unknown>;
}

export interface ProviderPreferences {
  defaultConnectionId: AiConnectionId;
  defaultTextModelId?: string;
  defaultReasoningLevel?: AiReasoningLevel;
  /** Inert per-connection preferences; never used as execution authorization. */
  preferredTextModelsByConnection?: Partial<Record<AiConnectionId, string>>;
  preferredReasoningLevelsByConnection?: Partial<Record<AiConnectionId, AiReasoningLevel>>;
  operationOverrides?: Record<string, AiProviderSelection>;
}

export interface ProviderHubUsageSummary {
  observedByConnection: Record<string, number>;
  quota: { state: 'known' | 'unknown'; remaining?: number; resetsAt?: string };
}

export interface ProviderHubStatus {
  localPersonalConnectionsAvailable: boolean;
  capabilityPolicyVersion: string;
  credentialAuthorityIds: Record<AiConnectionId, string>;
  connections: AiConnectionDescriptor[];
  preferences: ProviderPreferences;
  usage: ProviderHubUsageSummary;
}

export interface ProviderModelsResponse {
  models: AiModelDescriptor[];
}

export interface ProviderPreferencesResponse {
  preferences: ProviderPreferences;
}

export interface ChatGptAuthorizeResponse {
  authorizationUrl: string;
}

export interface ChatGptDisconnectResponse {
  clearedLocally: boolean;
  remoteRevocation: 'acknowledged' | 'not-confirmed' | 'endpoint-unavailable' | 'not-connected';
}

export interface SessionKeySavedResponse {
  acceptedForThisSession: boolean;
  persistentStorage: boolean;
}

export interface SessionKeyClearedResponse {
  cleared: boolean;
}

export interface AiCapabilitiesOperationPolicy {
  model: string;
  maxInputChars: number;
  maxInputTokens: number;
  maxOutputTokens: number;
  timeoutMs: number;
  maxConcurrent: number;
  maxCallsPerMinute: number;
  description: string;
}

export interface AiCapabilitiesResponse {
  configured: boolean;
  textModel: string;
  imageModel: string;
  providerLimitsVerifiedLive: boolean;
  note: string;
  chatGptStoryLocalActivation: boolean;
  operations: Record<string, AiCapabilitiesOperationPolicy>;
}
