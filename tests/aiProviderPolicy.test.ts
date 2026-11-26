import test from 'node:test';
import assert from 'node:assert/strict';
import { assertModelOperation, assertProviderOperation, describeChatGptModel, getDefaultConnectionForOperation, getSupportedReasoningLevels, hasSupportedOperation, reasoningParameter } from '../server/providers/policy';

test('ChatGPT plan route rejects image generation without falling back', () => {
  assert.throws(() => assertProviderOperation('chatgpt-plan', 'image'), /does not support image/);
});

test('Gemini remains the selected connection for image generation', () => {
  assert.equal(getDefaultConnectionForOperation('image'), 'gemini-managed');
});

test('reasoning choices use exact documented capabilities and default-only for unknown models', () => {
  const known = describeChatGptModel({ id: 'gpt-6.2-astra', displayName: 'Astra' });
  const unknown = describeChatGptModel({ id: 'model-from-catalog', displayName: 'Catalog model' });
  assert.deepEqual(getSupportedReasoningLevels(known), ['default', 'low', 'medium', 'high', 'extra-high', 'max']);
  assert.deepEqual(getSupportedReasoningLevels(unknown), ['default']);
  assert.deepEqual(reasoningParameter(unknown), {});
  assert.throws(() => reasoningParameter(unknown, 'high'), /not verified/);
  assert.throws(() => assertModelOperation(unknown, 'diagnostics'), /no verified capability/);
});

test('unsupported providers fail closed instead of selecting another billing path', () => {
  assert.throws(() => assertProviderOperation('openai-api', 'image'), /does not support image/);
});

test('ChatGPT plan text models are not advertised for PCC operations without enforced token budgets', () => {
  const model = describeChatGptModel({ id: 'gpt-6.2-sol', displayName: 'Sol' }, 'chatgpt-plan');
  assert.equal(model.textGeneration.state, 'supported');
  assert.equal(model.operationCapabilities.writing?.state, 'unsupported');
  assert.equal(model.operationCapabilities['narrative-import']?.state, 'unsupported');
  assert.equal(hasSupportedOperation(model), false);
  assert.throws(() => assertModelOperation(model, 'story'), /no verified capability/);
});

test('OpenAI API operation capability requires exact known model policy', () => {
  const verified = describeChatGptModel({ id: 'gpt-6.2-sol', displayName: 'Sol' }, 'openai-api');
  const unknown = describeChatGptModel({ id: 'account-listed-model', displayName: 'Listed' }, 'openai-api');
  assert.equal(verified.operationCapabilities.writing?.state, 'supported');
  assert.equal(hasSupportedOperation(verified), true);
  assert.equal(unknown.operationCapabilities.writing?.state, 'unknown');
  assert.equal(hasSupportedOperation(unknown), false);
});
