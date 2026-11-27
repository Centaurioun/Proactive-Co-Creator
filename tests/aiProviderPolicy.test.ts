import test from 'node:test';
import assert from 'node:assert/strict';
import { assertModelOperation, assertProviderOperation, describeChatGptModel, getDefaultConnectionForOperation, getSupportedReasoningLevels, hasSupportedOperation, reasoningParameter } from '../server/providers/policy';

const observedAccountSlugs = [
  'gpt-6.2-sol', 'gpt-6.2-astra', 'gpt-6.1-terra', 'gpt-6.1-sol', 'gpt-6-astra',
  'gpt-6-sol', 'gpt-6-luna', 'gpt-5.6-sol', 'gpt-5.6-terra', 'gpt-5.6-luna',
];

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

test('all ten historically observed account slugs have exact API evidence while account catalog and SIWC eligibility stay distinct', () => {
  assert.equal(new Set(observedAccountSlugs).size, 10);
  for (const slug of observedAccountSlugs) {
    const accountModel = describeChatGptModel({ id: slug, displayName: slug }, 'chatgpt-plan');
    const apiModel = describeChatGptModel({ id: slug, displayName: slug }, 'openai-api');

    assert.ok(accountModel.availability.state === 'supported');
    assert.equal(accountModel.availability.evidence[0]?.source, 'account-catalog');
    assert.equal(accountModel.availability.evidence[0]?.modelSlug, slug);
    assert.ok(accountModel.textGeneration.state === 'supported');
    assert.equal(accountModel.textGeneration.evidence[0]?.source, 'official-documentation');
    assert.equal(accountModel.textGeneration.evidence[0]?.transport, 'openai-api-responses');
    assert.match(accountModel.textGeneration.evidence[0]?.reference ?? '', new RegExp(`/models/${slug}$`));
    assert.equal(accountModel.reasoning.state, 'supported');
    assert.deepEqual(getSupportedReasoningLevels(accountModel).includes('default'), true);
    assert.equal(accountModel.structuredOutput.state, 'supported');
    assert.equal(accountModel.contextLimit.state, 'supported');
    assert.equal(accountModel.outputLimit.state, 'unknown');
    assert.equal(accountModel.operationCapabilities.story?.state, 'unsupported');
    assert.ok(accountModel.operationCapabilities.story?.state === 'unsupported');
    assert.ok(accountModel.operationCapabilities.story.evidence.some(item => item.reference.endsWith('/preview-limitations')));
    assert.equal(hasSupportedOperation(accountModel), false);

    assert.ok(apiModel.availability.state === 'supported');
    assert.equal(apiModel.availability.evidence[0]?.source, 'account-catalog');
    assert.equal(apiModel.operationCapabilities.story?.state, 'supported');
    assert.equal(apiModel.outputLimit.state, 'supported');
  }
});

test('unknown exact account slugs stay default-only and do not gain transport or operation claims', () => {
  const model = describeChatGptModel({ id: 'gpt-6.2-sol-preview-unknown', displayName: 'Unlisted exact slug' }, 'chatgpt-plan');
  assert.ok(model.availability.state === 'supported');
  assert.equal(model.textGeneration.state, 'unknown');
  assert.equal(model.reasoning.state, 'unknown');
  assert.deepEqual(getSupportedReasoningLevels(model), ['default']);
  assert.equal(model.operationCapabilities.story?.state, 'unsupported');
  assert.equal(hasSupportedOperation(model), false);
});

test('desktop mode never advertises unqualified ChatGPT text operations', () => {
  const previous = process.env.PCC_DESKTOP_MODE;
  process.env.PCC_DESKTOP_MODE = '1';
  try {
    const model = describeChatGptModel({ id: 'gpt-6-luna', displayName: 'Luna' });
    for (const operation of ['analyze', 'clarify', 'polish', 'story', 'batch-edit', 'narrative-import', 'diagnostics', 'sync', 'writing', 'opportunities', 'import-enhance'] as const) {
      assert.equal(model.operationCapabilities[operation]?.state, 'unsupported', operation);
    }
    assert.equal(hasSupportedOperation(model), false);
  } finally {
    if (previous === undefined) delete process.env.PCC_DESKTOP_MODE;
    else process.env.PCC_DESKTOP_MODE = previous;
  }
});
