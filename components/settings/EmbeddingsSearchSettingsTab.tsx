import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  CLOUDFLARE_EMBEDDING_MODELS,
  DEFAULT_EMBEDDING_PRIORITY_ORDER,
  EmbeddingBatchRequest,
  EmbeddingBatchResponse,
  EmbeddingHubStatusResponse,
  EmbeddingProviderId,
  EmbeddingRoutingMode,
} from '../../shared/embeddingSchema';
import { NarrativeMemoryIndexSnapshot } from '../../shared/narrativeMemoryTypes';
import { CreativeProject } from '../../shared/types';
import {
  deleteNarrativeMemoryIndex,
  ensureFreshNarrativeMemoryIndex,
  loadNarrativeMemoryIndex,
} from '../../lib/narrative/memory/indexRepository';
import {
  deleteProjectVectorsByNamespace,
  listProjectVectorNamespaces,
  runResumableSemanticIndexing,
  SemanticIndexingJobProgress,
  VectorNamespaceSummary,
} from '../../lib/narrative/memory/vectorRepository';

interface EmbeddingsSearchSettingsTabProps {
  project?: CreativeProject | null;
}

export const EmbeddingsSearchSettingsTab: React.FC<EmbeddingsSearchSettingsTabProps> = ({
  project,
}) => {
  const [hubStatus, setHubStatus] = useState<EmbeddingHubStatusResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  // Provider configuration inputs (secrets never echoed back from server)
  const [cfAccountId, setCfAccountId] = useState('');
  const [cfApiToken, setCfApiToken] = useState('');
  const [lmEndpointUrl, setLmEndpointUrl] = useState('http://127.0.0.1:1234');
  const [lmModelId, setLmModelId] = useState('text-embedding-qwen3-embedding-0.6b');
  const [geminiApiKey, setGeminiApiKey] = useState('');
  const [geminiUseManaged, setGeminiUseManaged] = useState(false);

  // Local Narrative Memory Index & Vector state
  const [localIndex, setLocalIndex] = useState<NarrativeMemoryIndexSnapshot | null>(null);
  const [vectorNamespaces, setVectorNamespaces] = useState<VectorNamespaceSummary[]>([]);
  const [indexingJob, setIndexingJob] = useState<SemanticIndexingJobProgress | null>(null);
  const [testingProvider, setTestingProvider] = useState<EmbeddingProviderId | null>(null);
  const abortControllerRef = useRef<AbortController | null>(null);

  const projectId = project?.id || 'default-project';

  const refreshStatusAndIndex = useCallback(async () => {
    try {
      const res = await fetch(`/api/ai/embeddings/status?projectId=${encodeURIComponent(projectId)}`);
      if (res.ok) {
        const data = (await res.json()) as EmbeddingHubStatusResponse;
        setHubStatus(data);
        const lm = data.providers['lm-studio-local'];
        if (lm?.endpointUrl) setLmEndpointUrl(lm.endpointUrl);
        if (lm?.selectedModelId) setLmModelId(lm.selectedModelId);
      }
    } catch {
      // Offline / local fallback
    }

    if (project) {
      const idx = await loadNarrativeMemoryIndex(project.id);
      setLocalIndex(idx);
      const ns = await listProjectVectorNamespaces(project.id);
      setVectorNamespaces(ns);
    }
    setLoading(false);
  }, [project, projectId]);

  useEffect(() => {
    void Promise.resolve().then(() => refreshStatusAndIndex());
  }, [refreshStatusAndIndex]);

  const updatePreferences = async (payload: Record<string, unknown>, feedback?: string) => {
    setErrorMessage(null);
    try {
      const res = await fetch('/api/ai/embeddings/preferences', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const data = await res.json();
      if (!res.ok) {
        setErrorMessage(data.error || 'Failed to update embedding preferences.');
        return;
      }
      setHubStatus(data as EmbeddingHubStatusResponse);
      if (feedback) setStatusMessage(feedback);
    } catch (err) {
      setErrorMessage(err instanceof Error ? err.message : 'Network error updating preferences.');
    }
  };

  const handleModeChange = (mode: EmbeddingRoutingMode) => {
    void updatePreferences({ routingMode: mode }, `Routing mode set to "${mode.toUpperCase()}".`);
  };

  const handleMovePriority = (providerId: EmbeddingProviderId, direction: -1 | 1) => {
    const order = [...(hubStatus?.priorityOrder ?? DEFAULT_EMBEDDING_PRIORITY_ORDER)];
    const idx = order.indexOf(providerId);
    if (idx === -1) return;
    const targetIdx = idx + direction;
    if (targetIdx < 0 || targetIdx >= order.length) return;
    const temp = order[idx];
    order[idx] = order[targetIdx];
    order[targetIdx] = temp;
    void updatePreferences({ priorityOrder: order }, 'Updated embedding provider priority order.');
  };

  const handleToggleProviderEnabled = (providerId: EmbeddingProviderId, enabled: boolean) => {
    void updatePreferences(
      {
        providerSettings: {
          [providerId]: { enabled },
        },
      },
      `${providerId} ${enabled ? 'enabled' : 'disabled'}.`
    );
  };

  const handleToggleProjectConsent = (consented: boolean) => {
    void updatePreferences(
      {
        projectConsent: {
          projectId,
          consented,
        },
      },
      consented
        ? 'Granted external embedding consent for this project.'
        : 'Revoked external embedding consent for this project.'
    );
  };

  const handleSaveCloudflare = async () => {
    setErrorMessage(null);
    setStatusMessage(null);
    try {
      const res = await fetch('/api/ai/embeddings/credentials/cloudflare', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          accountId: cfAccountId,
          apiToken: cfApiToken,
          selectedModelId: hubStatus?.providers['cloudflare-workers-ai']?.selectedModelId,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setErrorMessage(data.error || 'Failed to save Cloudflare credentials.');
        return;
      }
      setHubStatus(data as EmbeddingHubStatusResponse);
      setCfApiToken('');
      setStatusMessage('Cloudflare Workers AI credentials stored in server session memory.');
    } catch (err) {
      setErrorMessage(err instanceof Error ? err.message : 'Failed to save Cloudflare credentials.');
    }
  };

  const handleClearCloudflare = async () => {
    setErrorMessage(null);
    const res = await fetch('/api/ai/embeddings/credentials/cloudflare', { method: 'DELETE' });
    if (res.ok) {
      setHubStatus((await res.json()) as EmbeddingHubStatusResponse);
      setStatusMessage('Cleared Cloudflare Workers AI credentials.');
    }
  };

  const handleSaveLmStudio = async () => {
    setErrorMessage(null);
    setStatusMessage(null);
    try {
      const res = await fetch('/api/ai/embeddings/config/lm-studio', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          endpointUrl: lmEndpointUrl,
          selectedModelId: lmModelId,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setErrorMessage(data.error || 'Rejected LM Studio endpoint URL.');
        return;
      }
      setHubStatus(data as EmbeddingHubStatusResponse);
      setStatusMessage('Updated LM Studio loopback configuration.');
    } catch (err) {
      setErrorMessage(err instanceof Error ? err.message : 'Failed to save LM Studio endpoint.');
    }
  };

  const handleSaveGemini = async () => {
    setErrorMessage(null);
    setStatusMessage(null);
    try {
      const res = await fetch('/api/ai/embeddings/credentials/gemini', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          apiKey: geminiApiKey || undefined,
          useManagedKeyIfAvailable: geminiUseManaged,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setErrorMessage(data.error || 'Failed to configure Gemini Embedding 2.');
        return;
      }
      setHubStatus(data as EmbeddingHubStatusResponse);
      setGeminiApiKey('');
      setStatusMessage('Configured Gemini Embedding 2 adapter.');
    } catch (err) {
      setErrorMessage(err instanceof Error ? err.message : 'Failed to configure Gemini Embedding 2.');
    }
  };

  const handleTestProvider = async (providerId: EmbeddingProviderId) => {
    setTestingProvider(providerId);
    setErrorMessage(null);
    setStatusMessage(null);
    try {
      const res = await fetch('/api/ai/embeddings/test', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ providerId }),
      });
      const data = await res.json();
      if (data.status) {
        setHubStatus(data.status as EmbeddingHubStatusResponse);
      }
      if (res.ok && data.ok) {
        setStatusMessage(data.message);
      } else {
        setErrorMessage(data.message || data.error || `Connection test failed for ${providerId}.`);
      }
    } catch (err) {
      setErrorMessage(err instanceof Error ? err.message : 'Connection test failed.');
    } finally {
      setTestingProvider(null);
    }
  };

  const handleBuildOrUpdateLocalIndex = async (forceFullRebuild = false) => {
    if (!project) return;
    setErrorMessage(null);
    setStatusMessage('Building deterministic local structured & lexical index...');
    try {
      if (forceFullRebuild) {
        await deleteNarrativeMemoryIndex(project.id);
      }
      const snap = await ensureFreshNarrativeMemoryIndex(project, {
        previousIndex: forceFullRebuild ? null : localIndex,
      });
      setLocalIndex(snap);
      setStatusMessage(
        `Local Narrative Memory Index ready (r${snap.projectRevision}): ${snap.coverage.totalChunks} chunks (${snap.coverage.reusedChunksFromPreviousRevision} reused), ${snap.coverage.activeEntities} active entities, ${snap.coverage.totalRelationships} relationships, ${snap.coverage.uniqueTerms} lexical terms.`
      );
    } catch (err) {
      setErrorMessage(err instanceof Error ? err.message : 'Failed to build local index.');
    }
  };

  const handleBuildSemanticVectors = async () => {
    if (!project) return;
    setErrorMessage(null);
    setStatusMessage(null);

    const snap = localIndex ?? (await ensureFreshNarrativeMemoryIndex(project));
    setLocalIndex(snap);

    const controller = new AbortController();
    abortControllerRef.current = controller;

    const dispatchEmbedBatch = async (req: EmbeddingBatchRequest): Promise<EmbeddingBatchResponse> => {
      const res = await fetch('/api/ai/embeddings/embed', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        signal: controller.signal,
        body: JSON.stringify(req),
      });
      const payload = await res.json();
      if (!res.ok) {
        throw new Error(payload.error || `Embedding request failed with HTTP ${res.status}`);
      }
      return payload as EmbeddingBatchResponse;
    };

    try {
      const finalProgress = await runResumableSemanticIndexing({
        indexSnapshot: snap,
        dispatchEmbedBatch,
        signal: controller.signal,
        onProgress: (p) => setIndexingJob({ ...p }),
      });
      setIndexingJob(finalProgress);
      const ns = await listProjectVectorNamespaces(project.id);
      setVectorNamespaces(ns);
      await refreshStatusAndIndex();
      if (finalProgress.status === 'completed') {
        setStatusMessage(finalProgress.message || 'Semantic vector indexing completed.');
      } else if (finalProgress.status === 'error' || finalProgress.status === 'partial') {
        setErrorMessage(finalProgress.message || 'Semantic vector indexing stopped.');
      }
    } catch (err) {
      setErrorMessage(err instanceof Error ? err.message : 'Semantic indexing job failed.');
    } finally {
      abortControllerRef.current = null;
    }
  };

  const handleCancelSemanticIndexing = () => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
      setStatusMessage('Cancelling active semantic indexing job...');
    }
  };

  const handleDeleteVectors = async (namespaceKey?: string) => {
    if (!project) return;
    const count = await deleteProjectVectorsByNamespace(project.id, namespaceKey);
    const ns = await listProjectVectorNamespaces(project.id);
    setVectorNamespaces(ns);
    setStatusMessage(
      namespaceKey
        ? `Deleted ${count} vector(s) from namespace ${namespaceKey}.`
        : `Deleted all ${count} stored semantic vector(s) for this project.`
    );
  };

  const routingMode = hubStatus?.routingMode ?? 'off';
  const priorityOrder = hubStatus?.priorityOrder ?? DEFAULT_EMBEDDING_PRIORITY_ORDER;
  const hasProjectConsent = Boolean(hubStatus?.consentedProjectIds?.includes(projectId));

  return (
    <div
      id="ai-settings-panel-embeddings"
      role="tabpanel"
      aria-labelledby="ai-settings-tab-embeddings"
      data-testid="embeddings-search-settings-panel"
      className="space-y-4 rounded-xl border border-slate-800 bg-slate-950/60 p-4 text-xs text-slate-300"
    >
      {/* Header & Default-Off Guarantee */}
      <div className="flex flex-wrap items-start justify-between gap-3 border-b border-slate-800/80 pb-3">
        <div>
          <h4 className="text-sm font-semibold text-white">
            Embeddings &amp; Hybrid Search Architecture (E1)
          </h4>
          <p className="mt-1 text-slate-400">
            Independent from text generation. Structured and lexical BM25 indexing always runs 100% locally in your browser. Optional semantic vector providers are disabled (<strong className="text-slate-200">Off</strong>) by default.
          </p>
        </div>
        <span
          data-testid="embedding-routing-mode-badge"
          className={`rounded-md border px-2.5 py-1 text-[11px] font-semibold uppercase tracking-wide ${
            routingMode === 'off'
              ? 'border-slate-700 bg-slate-900 text-slate-300'
              : 'border-indigo-500/40 bg-indigo-950/60 text-indigo-300'
          }`}
        >
          Mode: {routingMode === 'off' ? 'Off (Local Only)' : routingMode === 'priority' ? 'Priority Order' : 'Use All Available'}
        </span>
      </div>

      {statusMessage && (
        <div
          data-testid="embeddings-status-banner"
          className="rounded-lg border border-emerald-500/30 bg-emerald-950/30 px-3 py-2 text-emerald-200"
        >
          {statusMessage}
        </div>
      )}
      {errorMessage && (
        <div
          data-testid="embeddings-error-banner"
          className="rounded-lg border border-rose-500/40 bg-rose-950/40 px-3 py-2 text-rose-200"
        >
          {errorMessage}
        </div>
      )}

      {/* 1. Local Narrative Memory Index Lifecycle Controls */}
      <section className="rounded-lg border border-slate-800 bg-slate-900/60 p-3.5">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <h5 className="font-semibold text-slate-100">
              1. Local Narrative Memory Index (Structured &amp; Lexical BM25)
            </h5>
            <p className="text-[11px] text-slate-400">
              Indexes working manuscript sections, immutable imported sources, entities, aliases, relationships, and epistemic facts with Turkish &amp; UTF-16 boundary support.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              data-testid="build-local-index-btn"
              onClick={() => void handleBuildOrUpdateLocalIndex(false)}
              disabled={!project}
              className="rounded-md bg-indigo-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-indigo-500 disabled:opacity-50"
            >
              Build / Update Local Index
            </button>
            <button
              type="button"
              data-testid="rebuild-local-index-btn"
              onClick={() => void handleBuildOrUpdateLocalIndex(true)}
              disabled={!project}
              className="rounded-md border border-slate-700 bg-slate-800 px-2.5 py-1.5 text-xs text-slate-200 hover:bg-slate-700 disabled:opacity-50"
            >
              Full Rebuild
            </button>
          </div>
        </div>

        {localIndex ? (
          <div
            data-testid="local-index-coverage-summary"
            className="mt-3 grid grid-cols-2 gap-2 rounded-md border border-slate-800 bg-slate-950/70 p-2.5 sm:grid-cols-4"
          >
            <div>
              <div className="text-[10px] uppercase text-slate-500">Revision / Status</div>
              <div className="font-mono text-xs font-semibold text-emerald-300">
                r{localIndex.projectRevision} · {localIndex.status.toUpperCase()}
              </div>
            </div>
            <div>
              <div className="text-[10px] uppercase text-slate-500">Chunks (Reused)</div>
              <div className="font-mono text-xs text-slate-200">
                {localIndex.coverage.totalChunks} ({localIndex.coverage.reusedChunksFromPreviousRevision} reused)
              </div>
            </div>
            <div>
              <div className="text-[10px] uppercase text-slate-500">Entities / Rels</div>
              <div className="font-mono text-xs text-slate-200">
                {localIndex.coverage.activeEntities} active / {localIndex.coverage.totalRelationships} rels
              </div>
            </div>
            <div>
              <div className="text-[10px] uppercase text-slate-500">Lexical Terms</div>
              <div className="font-mono text-xs text-slate-200">
                {localIndex.coverage.uniqueTerms} unique terms
              </div>
            </div>
          </div>
        ) : (
          <p className="mt-2 text-[11px] text-slate-400">
            No local index snapshot built yet for the active project. Click <strong className="text-slate-200">Build / Update Local Index</strong> or run a search to build it automatically.
          </p>
        )}
      </section>

      {/* 2. Semantic Routing Mode & Per-Project External Consent */}
      <section className="rounded-lg border border-slate-800 bg-slate-900/60 p-3.5 space-y-3">
        <div>
          <h5 className="font-semibold text-slate-100">
            2. Semantic Embedding Routing Mode
          </h5>
          <p className="text-[11px] text-slate-400">
            Choose how optional vector embeddings are routed when you explicitly trigger semantic indexing or semantic query fusion.
          </p>
        </div>

        <div className="grid gap-2 sm:grid-cols-3" role="radiogroup" aria-label="Semantic embedding routing mode">
          {(
            [
              {
                mode: 'off' as const,
                title: 'Off (Default)',
                desc: '100% local structured & BM25 search only. Zero embedding requests dispatched.',
              },
              {
                mode: 'priority' as const,
                title: 'Priority Order',
                desc: 'Uses the highest-priority enabled & eligible provider in your priority list.',
              },
              {
                mode: 'all' as const,
                title: 'Use All Available',
                desc: 'Queries all enabled & eligible providers in isolated namespaces and fuses ranks via RRF.',
              },
            ]
          ).map((opt) => (
            <button
              key={opt.mode}
              type="button"
              role="radio"
              aria-checked={routingMode === opt.mode}
              data-testid={`embedding-mode-${opt.mode}`}
              onClick={() => handleModeChange(opt.mode)}
              className={`rounded-lg border p-2.5 text-left transition ${
                routingMode === opt.mode
                  ? 'border-indigo-500 bg-indigo-950/50 text-white'
                  : 'border-slate-800 bg-slate-950/60 text-slate-300 hover:border-slate-700'
              }`}
            >
              <div className="font-semibold">{opt.title}</div>
              <div className="mt-1 text-[11px] text-slate-400">{opt.desc}</div>
            </button>
          ))}
        </div>

        <div className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-amber-500/20 bg-amber-950/20 px-3 py-2">
          <div className="max-w-xl">
            <div className="font-medium text-amber-200">
              Per-Project External Cloud Embedding Consent
            </div>
            <div className="text-[11px] text-amber-300/80">
              Required before Cloudflare Workers AI or Gemini Embedding 2 can receive text chunks from this project. Local LM Studio loopback does not send data outside your machine.
            </div>
          </div>
          <label className="inline-flex cursor-pointer items-center gap-2 text-xs font-semibold text-amber-100">
            <input
              type="checkbox"
              data-testid="external-embedding-consent-checkbox"
              checked={hasProjectConsent}
              onChange={(e) => handleToggleProjectConsent(e.target.checked)}
              className="h-4 w-4 rounded border-slate-600 bg-slate-900 text-indigo-600"
            />
            Allow external embeddings for this project
          </label>
        </div>
      </section>

      {/* 3. Priority-Ordered Provider Cards (Cloudflare -> LM Studio -> Gemini) */}
      <section className="space-y-3">
        <div className="flex items-center justify-between">
          <h5 className="font-semibold text-slate-100">
            3. Embedding Providers (Ordered by Priority)
          </h5>
          <span className="text-[11px] text-slate-400">
            Session Budget: {hubStatus?.consumedRequestsInSession ?? 0} / {hubStatus?.requestBudgetPerSession ?? 120} requests
          </span>
        </div>

        {!loading &&
          priorityOrder.map((providerId, index) => {
            const p = hubStatus?.providers[providerId];
            if (!p) return null;

            return (
              <div
                key={providerId}
                data-testid={`embedding-provider-card-${providerId}`}
                className="rounded-lg border border-slate-800 bg-slate-900/50 p-3.5 space-y-3"
              >
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <span className="inline-flex h-5 w-5 items-center justify-center rounded bg-slate-800 font-mono text-[11px] font-bold text-slate-300">
                      #{index + 1}
                    </span>
                    <span className="font-semibold text-white">{p.label}</span>
                    <span
                      className={`rounded px-2 py-0.5 text-[10px] font-semibold uppercase ${
                        p.connectionState === 'ready'
                          ? 'bg-emerald-950/70 text-emerald-300 border border-emerald-500/30'
                          : p.connectionState === 'unavailable'
                            ? 'bg-amber-950/70 text-amber-300 border border-amber-500/30'
                            : p.connectionState === 'unconfigured'
                              ? 'bg-slate-800 text-slate-400'
                              : 'bg-rose-950/70 text-rose-300 border border-rose-500/30'
                      }`}
                    >
                      Connection: {p.connectionState}
                    </span>
                    <span className="rounded bg-slate-800 px-2 py-0.5 text-[10px] text-slate-300">
                      Eligibility: {p.eligibilityState}
                    </span>
                  </div>

                  <div className="flex items-center gap-1.5">
                    <button
                      type="button"
                      aria-label={`Move ${p.label} up`}
                      disabled={index === 0}
                      onClick={() => handleMovePriority(providerId, -1)}
                      className="rounded border border-slate-700 bg-slate-800 px-2 py-1 text-[11px] hover:bg-slate-700 disabled:opacity-40"
                    >
                      ↑ Up
                    </button>
                    <button
                      type="button"
                      aria-label={`Move ${p.label} down`}
                      disabled={index === priorityOrder.length - 1}
                      onClick={() => handleMovePriority(providerId, 1)}
                      className="rounded border border-slate-700 bg-slate-800 px-2 py-1 text-[11px] hover:bg-slate-700 disabled:opacity-40"
                    >
                      ↓ Down
                    </button>
                    <label className="ml-2 inline-flex cursor-pointer items-center gap-1.5 text-xs font-medium text-slate-200">
                      <input
                        type="checkbox"
                        data-testid={`toggle-provider-${providerId}`}
                        checked={p.enabled}
                        onChange={(e) => handleToggleProviderEnabled(providerId, e.target.checked)}
                        className="h-3.5 w-3.5 rounded border-slate-600 bg-slate-900 text-indigo-600"
                      />
                      Enabled
                    </label>
                  </div>
                </div>

                <p className="text-[11px] text-slate-400">{p.costDisclosure}</p>

                {/* Provider-Specific Configuration Controls */}
                {providerId === 'cloudflare-workers-ai' && (
                  <div className="grid gap-2 sm:grid-cols-3">
                    <input
                      type="text"
                      placeholder={p.maskedAccountId ? `Account ID (${p.maskedAccountId})` : 'Cloudflare Account ID (hex)'}
                      value={cfAccountId}
                      onChange={(e) => setCfAccountId(e.target.value)}
                      data-testid="cf-account-id-input"
                      className="rounded border border-slate-700 bg-slate-950 px-2.5 py-1.5 text-xs text-slate-200"
                    />
                    <input
                      type="password"
                      placeholder={p.configured ? 'API Token (stored on server)' : 'Workers AI API Token'}
                      value={cfApiToken}
                      onChange={(e) => setCfApiToken(e.target.value)}
                      data-testid="cf-api-token-input"
                      className="rounded border border-slate-700 bg-slate-950 px-2.5 py-1.5 text-xs text-slate-200"
                    />
                    <select
                      aria-label="Cloudflare embedding model"
                      value={p.selectedModelId}
                      onChange={(e) =>
                        void updatePreferences({
                          providerSettings: {
                            'cloudflare-workers-ai': { selectedModelId: e.target.value },
                          },
                        })
                      }
                      className="rounded border border-slate-700 bg-slate-950 px-2.5 py-1.5 text-xs text-slate-200"
                    >
                      {CLOUDFLARE_EMBEDDING_MODELS.map((m) => (
                        <option key={m} value={m}>
                          {m}
                        </option>
                      ))}
                    </select>
                  </div>
                )}

                {providerId === 'lm-studio-local' && (
                  <div className="grid gap-2 sm:grid-cols-2">
                    <input
                      type="text"
                      placeholder="http://127.0.0.1:1234"
                      value={lmEndpointUrl}
                      onChange={(e) => setLmEndpointUrl(e.target.value)}
                      data-testid="lm-studio-endpoint-input"
                      className="rounded border border-slate-700 bg-slate-950 px-2.5 py-1.5 text-xs text-slate-200"
                    />
                    <input
                      type="text"
                      placeholder="Model ID (e.g. text-embedding-qwen3-embedding-0.6b)"
                      value={lmModelId}
                      onChange={(e) => setLmModelId(e.target.value)}
                      data-testid="lm-studio-model-input"
                      className="rounded border border-slate-700 bg-slate-950 px-2.5 py-1.5 text-xs text-slate-200"
                    />
                  </div>
                )}

                {providerId === 'gemini-embedding' && (
                  <div className="flex flex-wrap items-center gap-2">
                    <input
                      type="password"
                      placeholder={p.configured ? 'Gemini Key (configured)' : 'Personal Gemini API Key (optional)'}
                      value={geminiApiKey}
                      onChange={(e) => setGeminiApiKey(e.target.value)}
                      data-testid="gemini-embedding-key-input"
                      className="flex-1 rounded border border-slate-700 bg-slate-950 px-2.5 py-1.5 text-xs text-slate-200"
                    />
                    <label className="inline-flex items-center gap-1.5 text-xs text-slate-300">
                      <input
                        type="checkbox"
                        checked={geminiUseManaged}
                        onChange={(e) => setGeminiUseManaged(e.target.checked)}
                        className="h-3.5 w-3.5 rounded border-slate-600 bg-slate-900"
                      />
                      Use server environment key if available
                    </label>
                  </div>
                )}

                <div className="flex flex-wrap items-center justify-between gap-2 pt-1">
                  <div className="text-[11px] text-slate-400">
                    Model: <span className="font-mono text-slate-200">{p.selectedModelId}</span>
                    {p.lastObservedDimensions ? ` · ${p.lastObservedDimensions} dims` : ''}
                    {p.lastError ? (
                      <span className="ml-2 text-rose-300">· Last error: {p.lastError}</span>
                    ) : null}
                  </div>
                  <div className="flex items-center gap-2">
                    {providerId === 'cloudflare-workers-ai' && (
                      <>
                        <button
                          type="button"
                          onClick={() => void handleSaveCloudflare()}
                          data-testid="save-cloudflare-btn"
                          className="rounded bg-slate-800 px-2.5 py-1 text-xs font-medium text-white hover:bg-slate-700"
                        >
                          Save Credentials
                        </button>
                        {p.configured && (
                          <button
                            type="button"
                            onClick={() => void handleClearCloudflare()}
                            className="rounded border border-rose-500/40 px-2 py-1 text-xs text-rose-300 hover:bg-rose-950/40"
                          >
                            Clear
                          </button>
                        )}
                      </>
                    )}
                    {providerId === 'lm-studio-local' && (
                      <button
                        type="button"
                        onClick={() => void handleSaveLmStudio()}
                        data-testid="save-lm-studio-btn"
                        className="rounded bg-slate-800 px-2.5 py-1 text-xs font-medium text-white hover:bg-slate-700"
                      >
                        Save Loopback Config
                      </button>
                    )}
                    {providerId === 'gemini-embedding' && (
                      <button
                        type="button"
                        onClick={() => void handleSaveGemini()}
                        data-testid="save-gemini-embedding-btn"
                        className="rounded bg-slate-800 px-2.5 py-1 text-xs font-medium text-white hover:bg-slate-700"
                      >
                        Save Config
                      </button>
                    )}
                    <button
                      type="button"
                      data-testid={`test-provider-${providerId}`}
                      disabled={testingProvider === providerId}
                      onClick={() => void handleTestProvider(providerId)}
                      className="rounded border border-indigo-500/40 bg-indigo-950/40 px-2.5 py-1 text-xs font-medium text-indigo-200 hover:bg-indigo-900/50 disabled:opacity-50"
                    >
                      {testingProvider === providerId ? 'Testing…' : 'Test Connection'}
                    </button>
                  </div>
                </div>
              </div>
            );
          })}
      </section>

      {/* 4. Semantic Vector Namespaces & Explicit Indexing Trigger */}
      <section className="rounded-lg border border-slate-800 bg-slate-900/60 p-3.5 space-y-2.5">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <h5 className="font-semibold text-slate-100">
              4. Namespace-Isolated Semantic Vector Store
            </h5>
            <p className="text-[11px] text-slate-400">
              Vectors are keyed by provider, model, revision, dimensions, normalization, task instruction, and chunker version. Incompatible namespaces are never compared directly.
            </p>
          </div>
          <div className="flex items-center gap-2">
            {indexingJob?.status === 'running' ? (
              <button
                type="button"
                data-testid="cancel-semantic-index-btn"
                onClick={handleCancelSemanticIndexing}
                className="rounded-md bg-rose-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-rose-500"
              >
                Cancel Indexing
              </button>
            ) : (
              <button
                type="button"
                data-testid="build-semantic-vectors-btn"
                disabled={!project || routingMode === 'off'}
                onClick={() => void handleBuildSemanticVectors()}
                className="rounded-md bg-emerald-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-emerald-500 disabled:opacity-40"
              >
                Build Semantic Vectors (Explicit)
              </button>
            )}
            {vectorNamespaces.length > 0 && (
              <button
                type="button"
                data-testid="delete-all-vectors-btn"
                onClick={() => void handleDeleteVectors()}
                className="rounded-md border border-rose-500/40 px-2.5 py-1.5 text-xs text-rose-300 hover:bg-rose-950/40"
              >
                Delete All Vectors
              </button>
            )}
          </div>
        </div>

        {indexingJob && (
          <div
            data-testid="semantic-indexing-progress"
            className="rounded border border-slate-800 bg-slate-950/80 px-3 py-2 text-[11px]"
          >
            <span className="font-semibold uppercase text-indigo-300">{indexingJob.status}</span>:{' '}
            {indexingJob.completedChunks}/{indexingJob.totalChunks} chunks ({indexingJob.reusedChunks} reused,{' '}
            {indexingJob.consumedRequests} requests){indexingJob.message ? ` — ${indexingJob.message}` : ''}
          </div>
        )}

        {vectorNamespaces.length > 0 ? (
          <div className="space-y-1.5">
            {vectorNamespaces.map((ns) => (
              <div
                key={ns.namespace.namespaceKey}
                className="flex flex-wrap items-center justify-between gap-2 rounded border border-slate-800 bg-slate-950/60 px-2.5 py-1.5"
              >
                <div>
                  <div className="font-mono text-[11px] text-slate-200">
                    {ns.namespace.providerId} · {ns.namespace.modelId} ({ns.namespace.dimensions} dims)
                  </div>
                  <div className="text-[10px] text-slate-500">
                    {ns.vectorCount} vectors · Namespace: {ns.namespace.namespaceKey}
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => void handleDeleteVectors(ns.namespace.namespaceKey)}
                  className="rounded border border-slate-700 px-2 py-0.5 text-[10px] text-rose-300 hover:bg-rose-950/40"
                >
                  Delete Namespace
                </button>
              </div>
            ))}
          </div>
        ) : (
          <p className="text-[11px] text-slate-500">
            No semantic vectors stored for this project. Local lexical and structured search remain fully active.
          </p>
        )}
      </section>
    </div>
  );
};
