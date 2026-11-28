import assert from 'node:assert/strict';
import test from 'node:test';
import {
  validateAndNormalizeEmbeddingVectors,
  validateLmStudioLoopbackBaseUrl,
} from '../server/embeddings/adapters';
import { EmbeddingHubRuntime } from '../server/embeddings/embeddingRuntime';

test('LM Studio loopback SSRF validation strictly allows http loopback and rejects LAN/remote/HTTPS/credentials/subpaths', () => {
  assert.equal(validateLmStudioLoopbackBaseUrl('http://127.0.0.1:1234'), 'http://127.0.0.1:1234');
  assert.equal(validateLmStudioLoopbackBaseUrl('http://localhost:1234/v1'), 'http://localhost:1234');
  assert.equal(validateLmStudioLoopbackBaseUrl('http://[::1]:1234'), 'http://[::1]:1234');

  // Reject non-loopback LAN or cloud metadata IPs
  assert.throws(() => validateLmStudioLoopbackBaseUrl('http://192.168.1.50:1234'), /loopback/i);
  assert.throws(() => validateLmStudioLoopbackBaseUrl('http://169.254.169.254:80'), /loopback/i);
  assert.throws(() => validateLmStudioLoopbackBaseUrl('http://example.com:1234'), /loopback/i);

  // Reject HTTPS or non-HTTP protocols
  assert.throws(() => validateLmStudioLoopbackBaseUrl('https://127.0.0.1:1234'), /http:/i);
  assert.throws(() => validateLmStudioLoopbackBaseUrl('file:///etc/passwd'), /http:/i);

  // Reject embedded credentials, query strings, and arbitrary paths
  assert.throws(() => validateLmStudioLoopbackBaseUrl('http://admin:secret@127.0.0.1:1234'), /credentials/i);
  assert.throws(() => validateLmStudioLoopbackBaseUrl('http://127.0.0.1:1234?redirect=evil'), /query/i);
  assert.throws(() => validateLmStudioLoopbackBaseUrl('http://127.0.0.1:1234/admin/proxy'), /path/i);
});

test('validateAndNormalizeEmbeddingVectors enforces finite numbers, non-zero norm, exact count, consistent dimensions (>=8), and L2 normalization', () => {
  const normalized = validateAndNormalizeEmbeddingVectors(
    [
      [3, 4, 0, 0, 0, 0, 0, 0],
      [0, 5, 12, 0, 0, 0, 0, 0],
    ],
    2
  );
  assert.equal(normalized.dimensions, 8);
  assert.equal(normalized.vectors.length, 2);
  // [3,4,0,...] L2 norm is 5 -> [0.6, 0.8, 0,...]
  assert.ok(Math.abs(normalized.vectors[0][0] - 0.6) < 1e-6);
  assert.ok(Math.abs(normalized.vectors[0][1] - 0.8) < 1e-6);

  // Reject wrong vector count
  assert.throws(
    () => validateAndNormalizeEmbeddingVectors([[1, 0, 0, 0, 0, 0, 0, 0]], 2),
    /were requested/i
  );

  // Reject inconsistent dimensions within batch
  assert.throws(
    () =>
      validateAndNormalizeEmbeddingVectors(
        [
          [1, 0, 0, 0, 0, 0, 0, 0],
          [1, 0, 0, 0, 0, 0, 0, 0, 0],
        ],
        2
      ),
    /Inconsistent embedding dimensions/i
  );

  // Reject NaN / Infinity
  assert.throws(
    () => validateAndNormalizeEmbeddingVectors([[1, Number.NaN, 0, 0, 0, 0, 0, 0]], 1),
    /finite number/i
  );
  assert.throws(
    () => validateAndNormalizeEmbeddingVectors([[1, Number.POSITIVE_INFINITY, 0, 0, 0, 0, 0, 0]], 1),
    /finite number/i
  );

  // Reject zero-norm vector
  assert.throws(
    () => validateAndNormalizeEmbeddingVectors([[0, 0, 0, 0, 0, 0, 0, 0]], 1),
    /zero/i
  );
});

test('EmbeddingHubRuntime enforces Off-by-default, per-project external consent, Priority Order without silent fallback, and Use All Available', async () => {
  let fetchCalls = 0;
  let shouldCloudflareFail = false;

  const vecCf = [1, 0, 0, 0, 0, 0, 0, 0];
  const vecLm = [0, 1, 0, 0, 0, 0, 0, 0];
  const vecGm = [0, 0, 1, 0, 0, 0, 0, 0];

  const mockFetch = async (url: string): Promise<Response> => {
    fetchCalls += 1;
    if (url.includes('api.cloudflare.com')) {
      if (shouldCloudflareFail) {
        return new Response(JSON.stringify({ errors: [{ message: 'Cloudflare mock rate limit' }] }), {
          status: 429,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      return new Response(
        JSON.stringify({
          success: true,
          result: {
            shape: [1, 8],
            data: [vecCf],
          },
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      );
    }
    if (url.includes('127.0.0.1:1234/v1/models')) {
      return new Response(
        JSON.stringify({
          data: [{ id: 'Qwen3-Embedding-0.6B' }],
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      );
    }
    if (url.includes('127.0.0.1:1234/v1/embeddings')) {
      return new Response(
        JSON.stringify({
          data: [{ index: 0, embedding: vecLm }],
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      );
    }
    return new Response('Not found', { status: 404 });
  };

  const mockGeminiEmbed = async () => [vecGm];

  const runtime = new EmbeddingHubRuntime({
    fetchImpl: mockFetch,
    geminiEmbedFn: mockGeminiEmbed,
  });

  // 1. Default mode is strictly 'off' — zero network calls when embedBatch is called
  const initialStatus = runtime.getStatus('proj-1');
  assert.equal(initialStatus.routingMode, 'off');
  assert.equal(initialStatus.consentedProjectIds.includes('proj-1'), false);

  const offResult = await runtime.embedBatch({
    projectId: 'proj-1',
    projectRevision: 1,
    taskType: 'document',
    taskInstruction: 'narrative-passage',
    items: [{ id: 'c1', chunkDigest: 'd1', text: 'Sample text' }],
  });
  assert.ok(offResult.results.every((r) => r.status === 'skipped'));
  assert.equal(fetchCalls, 0);

  // 2. Configure Cloudflare & LM Studio & Gemini and enable them
  runtime.configureCloudflare({
    accountId: '0123456789abcdef0123456789abcdef',
    apiToken: 'cf_secret_token_1234567890',
    selectedModelId: '@cf/qwen/qwen3-embedding-0.6b',
  });
  runtime.configureLmStudio({
    endpointUrl: 'http://127.0.0.1:1234',
    selectedModelId: 'Qwen3-Embedding-0.6B',
  });
  runtime.configureGemini({
    apiKey: 'gemini_secret_key_1234567890',
    selectedModelId: 'gemini-embedding-2-preview',
  });
  runtime.updatePreferences({
    providerSettings: {
      'cloudflare-workers-ai': { enabled: true },
      'lm-studio-local': { enabled: true },
      'gemini-embedding': { enabled: true },
    },
  });

  // Verify status response never leaks credentials
  const statusJson = JSON.stringify(runtime.getStatus('proj-1'));
  assert.equal(statusJson.includes('cf_secret_token_1234567890'), false);
  assert.equal(statusJson.includes('gemini_secret_key_1234567890'), false);

  // 3. Switch to 'priority' WITHOUT granting external consent for 'proj-1':
  // Cloudflare is #1 in priority order, but lacks project external consent, so it is skipped and LM Studio Local (#2, local) is selected!
  runtime.updatePreferences({ routingMode: 'priority' });
  const noConsentBatch = await runtime.embedBatch({
    projectId: 'proj-1',
    projectRevision: 1,
    taskType: 'document',
    taskInstruction: 'narrative-passage',
    items: [{ id: 'c1', chunkDigest: 'd1', text: 'Local only text' }],
  });
  const cfSkipped = noConsentBatch.results.find((r) => r.providerId === 'cloudflare-workers-ai');
  const lmOk = noConsentBatch.results.find((r) => r.providerId === 'lm-studio-local');
  assert.equal(cfSkipped?.status, 'skipped');
  assert.equal(lmOk?.status, 'ok');
  assert.equal(lmOk?.namespace?.providerId, 'lm-studio-local');

  // 4. Grant external consent for 'proj-1': Cloudflare (#1 priority) is now selected
  runtime.updatePreferences({
    projectConsent: {
      projectId: 'proj-1',
      consented: true,
    },
  });
  assert.equal(runtime.getStatus('proj-1').consentedProjectIds.includes('proj-1'), true);
  assert.equal(runtime.getStatus('proj-other').consentedProjectIds.includes('proj-other'), false);

  const priorityBatch = await runtime.embedBatch({
    projectId: 'proj-1',
    projectRevision: 1,
    taskType: 'document',
    taskInstruction: 'narrative-passage',
    items: [{ id: 'c1', chunkDigest: 'd1', text: 'Cloudflare priority text' }],
  });
  const cfOk = priorityBatch.results.find((r) => r.providerId === 'cloudflare-workers-ai');
  assert.equal(cfOk?.status, 'ok');
  assert.equal(cfOk?.vectors?.length, 1);

  // 5. Verify NO silent cross-provider fallback in 'priority' mode when Cloudflare fails after dispatch
  shouldCloudflareFail = true;
  const failedPriorityBatch = await runtime.embedBatch({
    projectId: 'proj-1',
    projectRevision: 1,
    taskType: 'document',
    taskInstruction: 'narrative-passage',
    items: [{ id: 'c1', chunkDigest: 'd1', text: 'Should fail without silent fallback' }],
  });
  const cfErr = failedPriorityBatch.results.find((r) => r.providerId === 'cloudflare-workers-ai');
  const anyOk = failedPriorityBatch.results.find((r) => r.status === 'ok');
  assert.equal(cfErr?.status, 'error');
  assert.equal(anyOk, undefined);

  // 6. Switch to 'all' mode: queries all eligible providers into distinct namespaces
  shouldCloudflareFail = false;
  runtime.updatePreferences({ routingMode: 'all' });
  const allBatch = await runtime.embedBatch({
    projectId: 'proj-1',
    projectRevision: 1,
    taskType: 'document',
    taskInstruction: 'narrative-passage',
    items: [{ id: 'c1', chunkDigest: 'd1', text: 'Multi-provider text' }],
  });
  const okProviders = allBatch.results.filter((r) => r.status === 'ok').map((r) => r.providerId);
  assert.deepEqual(okProviders, ['cloudflare-workers-ai', 'lm-studio-local', 'gemini-embedding']);
  const namespaces = new Set(allBatch.results.map((r) => r.namespace?.namespaceKey));
  assert.equal(namespaces.size, 3);
});
