import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import * as catalogView from '../lib/providerCatalogView.ts';
import { catalogStateLabel, isCatalogSelectable, modelsForConnection, isEligibleTextModel, isSelectableTextPreferenceModel } from '../lib/providerCatalogView.ts';
import { GEMINI_MODELS } from '../server/models.ts';

test('refreshing a different catalog does not change the active model choices', () => {
  const gemini = [{ id: 'gemini' }];
  const chatgpt = [{ id: 'gpt-6.2-sol' }];
  const connections = [{ id: 'gemini-managed', models: gemini }, { id: 'chatgpt-plan', models: chatgpt }];
  assert.deepEqual(modelsForConnection(connections, 'gemini-managed'), gemini);
  assert.deepEqual(modelsForConnection(connections, 'chatgpt-plan'), chatgpt);
  assert.deepEqual(modelsForConnection(connections, 'openai-api'), []);
});

test('account catalog visibility is independent of active text-operation eligibility', () => {
  const blocked = { availability: { state: 'supported' }, textGeneration: { state: 'supported' }, operationCapabilities: { story: { state: 'unsupported' } } };
  assert.deepEqual(modelsForConnection([{ id: 'chatgpt-plan', models: [blocked] }], 'chatgpt-plan'), [blocked]);
  assert.equal(isEligibleTextModel(blocked), false);
  assert.equal(isEligibleTextModel({ ...blocked, operationCapabilities: { story: { state: 'supported', value: true } } }), true);
  assert.equal(isSelectableTextPreferenceModel(blocked), true);
  assert.equal(isSelectableTextPreferenceModel({ ...blocked, textGeneration: { state: 'unknown' } }), false);
  assert.equal(isSelectableTextPreferenceModel({ ...blocked, availability: { state: 'unsupported' } }), false);
});

test('ten account-visible entries preserve server order when Gemini is the active default', () => {
  const observed = ['gpt-6.2-sol', 'gpt-6.2-astra', 'gpt-6.1-terra', 'gpt-6.1-sol', 'gpt-6-astra', 'gpt-6-sol', 'gpt-6-luna', 'gpt-5.6-sol', 'gpt-5.6-terra', 'gpt-5.6-luna'];
  const models = observed.map(id => ({ id }));
  const connections = [{ id: 'gemini-managed', models: [{ id: 'gemini-flash' }] }, { id: 'chatgpt-plan', models }];
  assert.deepEqual(modelsForConnection(connections, 'gemini-managed'), [{ id: 'gemini-flash' }]);
  assert.deepEqual(modelsForConnection(connections, 'chatgpt-plan'), models);
  assert.deepEqual(models.map(model => model.id), observed);
});

test('catalog status distinguishes loading, fresh-empty, cached failure, and disconnected state', () => {
  assert.equal(catalogStateLabel('connected', 0, 'loading'), 'refreshing');
  assert.equal(catalogStateLabel('connected', 0, 'fresh'), 'refreshed; empty catalog');
  assert.equal(catalogStateLabel('connected', 2, 'failed'), 'refresh failed; showing stale cached entries');
  assert.equal(catalogStateLabel('connected', 2, 'stale'), 'stale cached entries; refresh to verify');
  assert.equal(catalogStateLabel('expired', 2), 'connection expired; catalog unavailable');
  assert.equal(catalogStateLabel('connected', 0), 'not yet refreshed');
});

test('catalog entries cannot be selected while a refresh is loading or has failed', () => {
  assert.equal(isCatalogSelectable('connected'), true);
  assert.equal(isCatalogSelectable('connected', 'fresh'), true);
  assert.equal(isCatalogSelectable('connected', 'loading'), false);
  assert.equal(isCatalogSelectable('connected', 'failed'), false);
  assert.equal(isCatalogSelectable('connected', 'stale'), false);
  assert.equal(isCatalogSelectable('expired', 'fresh'), false);
});

test('W1-D01: PROVIDER_PREFERENCE_OPERATIONS uses polish (not refine) and AiConnectionsPanel consumes it', () => {
  const mod = catalogView as Record<string, unknown>;
  const ops = mod.PROVIDER_PREFERENCE_OPERATIONS as ReadonlyArray<readonly [string, string]> | undefined;
  assert.ok(Array.isArray(ops), 'PROVIDER_PREFERENCE_OPERATIONS must be exported');
  assert.equal(ops.some(([op]) => op === 'polish'), true);
  assert.equal(ops.some(([op]) => op === 'refine'), false);

  const panelSource = fs.readFileSync(path.join(process.cwd(), 'components/settings/AiConnectionsPanel.tsx'), 'utf8');
  assert.equal(panelSource.includes("['refine', 'Prompt refinement']"), false);
});

test('W1-D13: safeEvidenceHref permits only http(s) URLs and rejects plain text or javascript URLs', () => {
  const mod = catalogView as Record<string, unknown>;
  const safeEvidenceHref = mod.safeEvidenceHref as ((ref: string) => string | undefined) | undefined;
  assert.equal(typeof safeEvidenceHref, 'function');
  assert.equal(safeEvidenceHref!('https://developers.openai.com/api/docs/models/gpt-6-luna'), 'https://developers.openai.com/api/docs/models/gpt-6-luna');
  assert.equal(safeEvidenceHref!('Gemini API models.list response'), undefined);
  assert.equal(safeEvidenceHref!('javascript:alert(1)'), undefined);
});

test('W1-D10 & W1-D14: preference save preserves fresh catalog phases and Story override treats undefined reasoning as default', () => {
  const mod = catalogView as Record<string, unknown>;
  const preservePhases = mod.catalogPhasesForStatusRefresh as
    | ((connections: readonly { id: string; models: unknown[] }[], current: Record<string, string | undefined>, preserveFresh: boolean) => Record<string, string>)
    | undefined;
  assert.equal(typeof preservePhases, 'function');
  const next = preservePhases!(
    [{ id: 'gemini-managed', models: [{ id: 'm1' }] }, { id: 'openai-api', models: [{ id: 'm2' }] }],
    { 'gemini-managed': 'fresh', 'openai-api': 'failed' },
    true,
  );
  assert.equal(next['gemini-managed'], 'fresh');
  assert.equal(next['openai-api'], 'stale');

  const canSelectStory = mod.isChatGptStoryModelSelectable as
    | ((model: { id: string; availability: { state: string }; textGeneration: { state: string } }, preferredReasoning?: string) => boolean)
    | undefined;
  assert.equal(typeof canSelectStory, 'function');
  assert.equal(canSelectStory!({ id: 'gpt-6-luna', availability: { state: 'supported' }, textGeneration: { state: 'supported' } }, undefined), true);
  assert.equal(canSelectStory!({ id: 'gpt-6-luna', availability: { state: 'supported' }, textGeneration: { state: 'supported' } }, 'medium'), false);
});

test('catalog proof survives modal reopen only for matching credential authority, policy and catalog', () => {
  const status = {
    capabilityPolicyVersion: 'test-policy',
    credentialAuthorityIds: { 'chatgpt-plan': 'process-a:grant-1' },
    connections: [{ id: 'chatgpt-plan', state: 'connected', models: [{ id: 'gpt-6-luna' }] }],
  };
  const fingerprint = catalogView.catalogVerificationFingerprint(status, 'chatgpt-plan');
  assert.ok(fingerprint);
  assert.equal(catalogView.catalogVerificationFingerprint(structuredClone(status), 'chatgpt-plan'), fingerprint);
  assert.notEqual(catalogView.catalogVerificationFingerprint({ ...status, credentialAuthorityIds: { 'chatgpt-plan': 'process-b:grant-1' } }, 'chatgpt-plan'), fingerprint);
  assert.notEqual(catalogView.catalogVerificationFingerprint({ ...status, capabilityPolicyVersion: 'changed' }, 'chatgpt-plan'), fingerprint);
  assert.notEqual(catalogView.catalogVerificationFingerprint({ ...status, connections: [{ ...status.connections[0], models: [{ id: 'other' }] }] }, 'chatgpt-plan'), fingerprint);
  assert.equal(catalogView.catalogVerificationFingerprint({ ...status, connections: [{ ...status.connections[0], state: 'expired' }] }, 'chatgpt-plan'), undefined);
  assert.equal(catalogView.catalogVerificationFingerprint({ ...status, credentialAuthorityIds: {} }, 'chatgpt-plan'), undefined);
});

test('unqualified ChatGPT operation preflight respects explicit overrides and never substitutes a provider', () => {
  const prefs = { defaultConnectionId: 'chatgpt-plan' as const };
  assert.match(catalogView.chatGptOperationBlockReason('analyze', prefs) ?? '', /only for local Story/);
  assert.match(catalogView.chatGptOperationBlockReason('writing', prefs) ?? '', /writing/);
  assert.equal(catalogView.chatGptOperationBlockReason('story', prefs), undefined);
  assert.equal(catalogView.chatGptOperationBlockReason('image', prefs), undefined);
  assert.equal(catalogView.chatGptOperationBlockReason('analyze', { ...prefs, operationOverrides: { analyze: { connectionId: 'gemini-personal' } } }), undefined);
  assert.ok(catalogView.chatGptOperationBlockReason('clarify', { defaultConnectionId: 'gemini-managed', operationOverrides: { clarify: { connectionId: 'chatgpt-plan' } } }));
});

test('operation eligibility merges each override field over the default route independently', () => {
  const model = (id: string, operation: string) => ({
    id, displayName: id, availability: { state: 'supported', value: true, evidence: [] },
    textGeneration: { state: 'supported', value: true, evidence: [] }, imageGeneration: { state: 'unknown', reason: 'n/a' },
    structuredOutput: { state: 'unknown', reason: 'n/a' }, contextLimit: { state: 'unknown', reason: 'n/a' }, outputLimit: { state: 'unknown', reason: 'n/a' },
    reasoning: { state: 'supported', value: ['default'], evidence: [] }, operationCapabilities: { [operation]: { state: 'supported', value: true, evidence: [] } }, capabilityPolicyVersion: 'test',
  });
  const status = { preferences: { defaultConnectionId: 'gemini-personal' as const, defaultTextModelId: 'default-model', defaultReasoningLevel: 'default' as const, operationOverrides: { analyze: { modelId: 'override-model' } } }, connections: [{ id: 'gemini-personal' as const, state: 'connected' as const, models: [model('default-model', 'clarify'), model('override-model', 'analyze')] }] };
  assert.deepEqual(catalogView.resolveOperationEligibility(status, 'analyze'), { eligible: true, connectionId: 'gemini-personal', modelId: 'override-model', reasoningLevel: 'default' });
});

test('Gemini Personal and OpenAI API require connected state and supported per-model operation capability', () => {
  const descriptor = (id: string, operation: string) => ({ id, displayName: id, availability: { state: 'supported' as const, value: true, evidence: [] }, textGeneration: { state: 'supported' as const, value: true, evidence: [] }, imageGeneration: { state: 'unsupported' as const, evidence: [] }, structuredOutput: { state: 'unknown' as const, reason: 'unknown' }, contextLimit: { state: 'unknown' as const, reason: 'unknown' }, outputLimit: { state: 'unknown' as const, reason: 'unknown' }, reasoning: { state: 'unknown' as const, reason: 'unknown' }, operationCapabilities: { [operation]: { state: 'supported' as const, value: true, evidence: [] } }, capabilityPolicyVersion: 'test' });
  for (const id of ['gemini-personal', 'openai-api'] as const) {
    const status = { preferences: { defaultConnectionId: id, defaultTextModelId: 'model' }, connections: [{ id, state: 'connected' as const, models: [descriptor('model', 'writing')] }] };
    assert.equal(catalogView.resolveOperationEligibility(status, 'writing').eligible, true);
  }
});

test('operation eligibility explains unconfigured, disconnected, and unknown capability states', () => {
  const pref = { defaultConnectionId: 'openai-api' as const, defaultTextModelId: 'm' };
  const model = { id: 'm', displayName: 'm', availability: { state: 'supported' as const, value: true, evidence: [] }, textGeneration: { state: 'supported' as const, value: true, evidence: [] }, imageGeneration: { state: 'unsupported' as const, evidence: [] }, structuredOutput: { state: 'unknown' as const, reason: 'unknown' }, contextLimit: { state: 'unknown' as const, reason: 'unknown' }, outputLimit: { state: 'unknown' as const, reason: 'unknown' }, reasoning: { state: 'unknown' as const, reason: 'unknown' }, operationCapabilities: { analyze: { state: 'unknown' as const, reason: 'No verified mapping for analyze.' } }, capabilityPolicyVersion: 'test' };
  const resolve = (state: 'unconfigured' | 'expired' | 'connected') => catalogView.resolveOperationEligibility({ preferences: pref, connections: [{ id: 'openai-api' as const, state, models: [model] }] }, 'analyze');
  assert.match(resolve('unconfigured').reason ?? '', /not configured/);
  assert.match(resolve('expired').reason ?? '', /expired/);
  assert.equal(resolve('connected').reason, 'No verified mapping for analyze.');
});

test('ChatGPT operations are Story-only, requiring local activation and exact Luna/Default selection', () => {
  const luna = { id: 'gpt-6-luna', displayName: 'GPT-6 Luna', availability: { state: 'supported' as const, value: true, evidence: [] }, textGeneration: { state: 'supported' as const, value: true, evidence: [] }, imageGeneration: { state: 'unsupported' as const, evidence: [] }, structuredOutput: { state: 'unknown' as const, reason: 'unknown' }, contextLimit: { state: 'unknown' as const, reason: 'unknown' }, outputLimit: { state: 'unknown' as const, reason: 'unknown' }, reasoning: { state: 'supported' as const, value: ['default'] as const, evidence: [] }, operationCapabilities: {}, capabilityPolicyVersion: 'test' };
  const base = { preferences: { defaultConnectionId: 'chatgpt-plan' as const, defaultTextModelId: 'gpt-6-luna', defaultReasoningLevel: 'default' as const }, connections: [{ id: 'chatgpt-plan' as const, state: 'connected' as const, models: [luna] }] };
  assert.match(catalogView.resolveOperationEligibility(base, 'analyze', true).reason ?? '', /only for local Story/);
  assert.match(catalogView.resolveOperationEligibility(base, 'story').reason ?? '', /not activated/);
  assert.equal(catalogView.resolveOperationEligibility(base, 'story', true).eligible, true);
  assert.match(catalogView.resolveOperationEligibility({ ...base, preferences: { ...base.preferences, defaultReasoningLevel: 'medium' } }, 'story', true).reason ?? '', /GPT-6 Luna with Default/);
});

test('managed Gemini accepts its available host route and provider default, while unconfigured stays blocked', () => {
  const preferences = { defaultConnectionId: 'gemini-managed' as const };
  const managed = { preferences, connections: [{ id: 'gemini-managed' as const, state: 'available' as const, selectedModelId: GEMINI_MODELS.text, models: [] }] };
  assert.deepEqual(catalogView.resolveOperationEligibility(managed, 'analyze'), { eligible: true, connectionId: 'gemini-managed', modelId: GEMINI_MODELS.text, reasoningLevel: 'default' });
  const providerDefault = { ...managed, connections: [{ ...managed.connections[0], selectedModelId: undefined }] };
  assert.deepEqual(catalogView.resolveOperationEligibility(providerDefault, 'analyze'), { eligible: true, connectionId: 'gemini-managed', reasoningLevel: 'default' });
  const unconfigured = { ...managed, connections: [{ ...managed.connections[0], state: 'unconfigured' as const }] };
  assert.match(catalogView.resolveOperationEligibility(unconfigured, 'analyze').reason ?? '', /not configured/);
});

test('managed Gemini catalog exception is limited to the exact configured default model', () => {
  type EligibilityPreferences = Parameters<typeof catalogView.resolveOperationEligibility>[0]['preferences'];
  const baseStatus = {
    connections: [{ id: 'gemini-managed' as const, state: 'available', selectedModelId: GEMINI_MODELS.text, models: [] }],
    preferences: { defaultConnectionId: 'gemini-managed', defaultReasoningLevel: 'default' } satisfies EligibilityPreferences,
  };
  const resolve = (preferences: EligibilityPreferences) =>
    catalogView.resolveOperationEligibility({ ...baseStatus, preferences }, 'analyze');

  const arbitraryMissingModel = resolve({ ...baseStatus.preferences, defaultTextModelId: 'unverified-gemini-model' });
  assert.equal(arbitraryMissingModel.eligible, false);
  assert.match(arbitraryMissingModel.reason ?? '', /not present in the gemini-managed catalog/);

  const configuredManagedDefault = resolve({ ...baseStatus.preferences, defaultTextModelId: GEMINI_MODELS.text });
  assert.equal(configuredManagedDefault.eligible, true);
  assert.equal(configuredManagedDefault.modelId, GEMINI_MODELS.text);

  const explicitOverride = catalogView.resolveOperationEligibility({
    ...baseStatus,
    preferences: {
      ...baseStatus.preferences,
      defaultTextModelId: GEMINI_MODELS.text,
      operationOverrides: { analyze: { modelId: 'unverified-gemini-override' } },
    },
  }, 'analyze');
  assert.equal(explicitOverride.eligible, false);
  assert.equal(explicitOverride.modelId, 'unverified-gemini-override');

  const catalogListedModel = catalogView.resolveOperationEligibility({
    ...baseStatus,
    connections: [{
      ...baseStatus.connections[0],
      models: [{
        id: 'verified-gemini-model',
        availability: { state: 'supported' },
        textGeneration: { state: 'supported' },
        reasoning: { state: 'supported', value: ['default'] },
        operationCapabilities: { analyze: { state: 'supported', value: true } },
      }],
    }],
    preferences: { ...baseStatus.preferences, defaultTextModelId: 'verified-gemini-model' },
  }, 'analyze');
  assert.equal(catalogListedModel.eligible, true);

  const unknownReasoning = catalogView.resolveOperationEligibility({
    ...baseStatus,
    preferences: { ...baseStatus.preferences, defaultTextModelId: 'unverified-gemini-model', defaultReasoningLevel: 'medium' as const },
  }, 'analyze');
  assert.equal(unknownReasoning.eligible, false);
});

test('ChatGPT unsupported operations explain policy before disconnected state; unverified reasoning is blocked', () => {
  const base = {
    preferences: { defaultConnectionId: 'chatgpt-plan' as const, defaultTextModelId: 'gpt-6-luna' },
    connections: [{ id: 'chatgpt-plan' as const, state: 'expired' as const, models: [] }],
  };
  assert.match(catalogView.resolveOperationEligibility(base, 'analyze').reason ?? '', /only for local Story/);
  const openAi = {
    preferences: { defaultConnectionId: 'openai-api' as const, defaultTextModelId: 'm', operationOverrides: { writing: { reasoningLevel: 'medium' as const } } },
    connections: [{ id: 'openai-api' as const, state: 'connected' as const, models: [{
      id: 'm', availability: { state: 'supported' }, textGeneration: { state: 'supported' },
      reasoning: { state: 'unknown', reason: 'not verified' },
      operationCapabilities: { writing: { state: 'supported', value: true } },
    }] }],
  };
  assert.match(catalogView.resolveOperationEligibility(openAi, 'writing').reason ?? '', /not verified/);
});

test('non-default reasoning is accepted only when the selected model lists that verified level', () => {
  const input = {
    preferences: { defaultConnectionId: 'openai-api' as const, defaultTextModelId: 'm', operationOverrides: { writing: { reasoningLevel: 'medium' as const } } },
    connections: [{ id: 'openai-api' as const, state: 'connected' as const, models: [{
      id: 'm', availability: { state: 'supported' }, textGeneration: { state: 'supported' },
      reasoning: { state: 'supported', value: ['medium'] },
      operationCapabilities: { writing: { state: 'supported', value: true } },
    }] }],
  };
  assert.equal(catalogView.resolveOperationEligibility(input, 'writing').eligible, true);
});

test('available API credentials prompt catalog verification, distinct from missing credentials or authorization', () => {
  const preferences = { defaultConnectionId: 'openai-api' as const, defaultTextModelId: 'm' };
  const resolveState = (state: 'available' | 'unconfigured' | 'authorization-required') => catalogView.resolveOperationEligibility({
    preferences, connections: [{ id: 'openai-api' as const, state, models: [] }],
  }, 'writing');
  assert.match(resolveState('available').reason ?? '', /credentials are present; refresh its model catalog/);
  assert.match(resolveState('unconfigured').reason ?? '', /not configured/);
  assert.match(resolveState('authorization-required').reason ?? '', /requires authorization/);
});
