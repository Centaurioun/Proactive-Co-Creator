import assert from 'node:assert/strict';
import test from 'node:test';
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
