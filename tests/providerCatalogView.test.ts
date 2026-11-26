import assert from 'node:assert/strict';
import test from 'node:test';
import { modelsForConnection, isEligibleTextModel } from '../lib/providerCatalogView.ts';

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
});
