import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import * as catalogView from '../lib/providerCatalogView.ts';
import { catalogStateLabel, isCatalogSelectable, modelsForConnection, isEligibleTextModel, isSelectableTextPreferenceModel } from '../lib/providerCatalogView.ts';

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
