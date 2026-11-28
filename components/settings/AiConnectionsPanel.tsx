import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  invalidateAiProviderRequests,
  invalidateAiProviderRequestsForPreferenceChange,
  PROVIDER_PREFERENCES_STORAGE_KEY,
} from '../../services/apiClient';
import {
  buildDefaultConnectionPreferences,
  catalogPhasesForStatusRefresh,
  isCatalogSelectable,
  isModelSupportedForOperation,
  type CatalogRefreshPhase,
} from '../../lib/providerCatalogView';
import {
  createChatGptOAuthPollingController,
  type ChatGptOAuthState,
  type OAuthPollingController,
} from '../../lib/settings/oauthPollingController';
import {
  summarizeActiveProviderPill,
} from '../../lib/controller/useProviderHubStatus';
import type { AiOperation } from '../../server/aiBudget';
import type {
  AiConnectionId,
  AiModelDescriptor,
  AiReasoningLevel,
  ChatGptAuthorizeResponse,
  ChatGptDisconnectResponse,
  ProviderHubStatus,
  ProviderModelsResponse,
  ProviderPreferences,
} from '../../server/providers/contracts';
import { CONNECTION_LABELS, ConnectionCard, SETTINGS_BUTTON_CLASS } from './ConnectionCard';
import { ModelPreferencesSection } from './ModelPreferencesSection';
import { OperationOverridesSection } from './OperationOverridesSection';

const BASE = '/api/ai/provider-hub';
const VALID_CONNECTION_IDS = new Set<AiConnectionId>(['gemini-managed', 'gemini-personal', 'chatgpt-plan', 'openai-api']);

export type AiSettingsTabId = 'overview' | 'models' | 'overrides' | 'embeddings' | 'usage';

export const AI_SETTINGS_TABS: ReadonlyArray<{ id: AiSettingsTabId; label: string }> = [
  { id: 'overview', label: 'Overview & Connections' },
  { id: 'models', label: 'Models & Defaults' },
  { id: 'overrides', label: 'Operation Overrides' },
  { id: 'embeddings', label: 'Embeddings & Search' },
  { id: 'usage', label: 'Usage & Limits' },
];

async function requestJson<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${BASE}${path}`, {
    ...init,
    headers: { ...(init?.body ? { 'Content-Type': 'application/json' } : {}), ...init?.headers },
  });
  if (!response.ok) {
    let detail = `Request failed (${response.status}).`;
    try {
      const payload = await response.json() as { error?: { message?: string }; message?: string };
      detail = payload.error?.message ?? payload.message ?? detail;
    } catch { /* keep the safe status-only message */ }
    throw new Error(detail);
  }
  return response.json() as Promise<T>;
}

function readLocalStoredPreferences(fallback: ProviderPreferences): ProviderPreferences {
  const raw = window.localStorage.getItem(PROVIDER_PREFERENCES_STORAGE_KEY);
  if (!raw) return fallback;
  try {
    const parsed = JSON.parse(raw) as ProviderPreferences;
    if (!parsed || !VALID_CONNECTION_IDS.has(parsed.defaultConnectionId)) {
      throw new Error('Stored AI preferences are invalid.');
    }
    return parsed;
  } catch {
    throw new Error('Stored AI preferences are invalid. Open AI Settings and choose a valid connection before using AI.');
  }
}

export default function AiConnectionsPanel() {
  const [activeTab, setActiveTab] = useState<AiSettingsTabId>('overview');
  const [status, setStatus] = useState<ProviderHubStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [apiKey, setApiKey] = useState('');
  const [openAiApiKey, setOpenAiApiKeyInput] = useState('');
  const [preferences, setPreferences] = useState<ProviderPreferences | null>(null);
  const [catalogPhases, setCatalogPhases] = useState<Partial<Record<AiConnectionId, CatalogRefreshPhase>>>({});
  const [oauthState, setOAuthState] = useState<ChatGptOAuthState>({ phase: 'idle', message: '' });

  const statusRef = useRef<ProviderHubStatus | null>(null);
  const catalogPhasesRef = useRef<Partial<Record<AiConnectionId, CatalogRefreshPhase>>>({});
  const statusEpoch = useRef(0);
  const catalogEpochs = useRef(new Map<AiConnectionId, number>());
  const busyCountRef = useRef(0);
  const oauthControllerRef = useRef<OAuthPollingController | null>(null);
  const tabRefs = useRef<Array<HTMLButtonElement | null>>([]);

  const beginBusy = useCallback(() => {
    busyCountRef.current += 1;
    setBusy(true);
  }, []);

  const endBusy = useCallback(() => {
    busyCountRef.current = Math.max(0, busyCountRef.current - 1);
    setBusy(busyCountRef.current > 0);
  }, []);

  const updateCatalogPhases = useCallback((
    updater:
      | Partial<Record<AiConnectionId, CatalogRefreshPhase>>
      | ((prev: Partial<Record<AiConnectionId, CatalogRefreshPhase>>) => Partial<Record<AiConnectionId, CatalogRefreshPhase>>),
  ) => {
    setCatalogPhases(prev => {
      const next = typeof updater === 'function' ? updater(prev) : updater;
      catalogPhasesRef.current = next;
      return next;
    });
  }, []);

  const publishStatus = useCallback((next: ProviderHubStatus) => {
    statusRef.current = next;
    setStatus(next);
  }, []);

  const refresh = useCallback(async (preserveFreshPhases = false) => {
    const requestEpoch = ++statusEpoch.current;
    for (const id of catalogEpochs.current.keys()) {
      catalogEpochs.current.set(id, (catalogEpochs.current.get(id) ?? 0) + 1);
    }
    const cachedStatus = statusRef.current;
    if (cachedStatus) {
      updateCatalogPhases(catalogPhasesForStatusRefresh(cachedStatus.connections, catalogPhasesRef.current, preserveFreshPhases));
    }
    setLoading(true);
    setError('');
    try {
      const next = await requestJson<ProviderHubStatus>('/status');
      if (requestEpoch !== statusEpoch.current) return;
      publishStatus(next);
      if (!cachedStatus || preserveFreshPhases) {
        updateCatalogPhases(catalogPhasesForStatusRefresh(next.connections, catalogPhasesRef.current, preserveFreshPhases));
      }
      setPreferences(readLocalStoredPreferences(next.preferences));
      window.dispatchEvent(new Event('pcc:ai-preferences-changed'));
    } catch (cause) {
      if (requestEpoch === statusEpoch.current) {
        setError(cause instanceof Error ? cause.message : 'Could not load AI connection status.');
      }
    } finally {
      if (requestEpoch === statusEpoch.current) setLoading(false);
    }
  }, [publishStatus, updateCatalogPhases]);

  useEffect(() => { void Promise.resolve().then(() => refresh(false)); }, [refresh]);

  const connections = useMemo(() => status?.connections ?? [], [status?.connections]);

  const refreshModels = useCallback(async (connectionId: AiConnectionId): Promise<AiModelDescriptor[]> => {
    const requestStatusEpoch = statusEpoch.current;
    const requestEpoch = (catalogEpochs.current.get(connectionId) ?? 0) + 1;
    catalogEpochs.current.set(connectionId, requestEpoch);
    updateCatalogPhases(current => ({ ...current, [connectionId]: 'loading' }));
    beginBusy();
    setError('');
    try {
      const result = await requestJson<ProviderModelsResponse>(`/models?connectionId=${encodeURIComponent(connectionId)}`);
      if (requestStatusEpoch !== statusEpoch.current || catalogEpochs.current.get(connectionId) !== requestEpoch) return [];
      const currentStatus = statusRef.current;
      const target = currentStatus?.connections.find(item => item.id === connectionId);
      if (!currentStatus || !target || !['available', 'connected'].includes(target.state)) return [];
      publishStatus({
        ...currentStatus,
        connections: currentStatus.connections.map(item => item.id === connectionId
          ? { ...item, models: result.models, state: 'connected' }
          : item),
      });
      updateCatalogPhases(current => ({ ...current, [connectionId]: 'fresh' }));
      window.dispatchEvent(new Event('pcc:ai-preferences-changed'));
      return result.models;
    } catch (cause) {
      if (requestStatusEpoch !== statusEpoch.current || catalogEpochs.current.get(connectionId) !== requestEpoch) return [];
      updateCatalogPhases(current => ({ ...current, [connectionId]: 'failed' }));
      setError(cause instanceof Error ? cause.message : 'Could not load models.');
      return [];
    } finally {
      endBusy();
    }
  }, [beginBusy, endBusy, publishStatus, updateCatalogPhases]);

  const refreshModelsRef = useRef(refreshModels);
  useEffect(() => {
    refreshModelsRef.current = refreshModels;
  }, [refreshModels]);

  // Seamless ChatGPT OAuth polling + single targeted catalog load controller.
  useEffect(() => {
    const controller = createChatGptOAuthPollingController({
      fetchStatus: () => requestJson<ProviderHubStatus>('/status'),
      onStatusObserved: (observed) => {
        publishStatus(observed);
        try {
          setPreferences(readLocalStoredPreferences(observed.preferences));
        } catch {
          setPreferences(observed.preferences);
        }
        window.dispatchEvent(new Event('pcc:ai-preferences-changed'));
      },
      refreshChatGptCatalog: async () => {
        try {
          const models = await refreshModelsRef.current('chatgpt-plan');
          const phase = catalogPhasesRef.current['chatgpt-plan'];
          if (phase === 'failed') {
            return { ok: false, error: 'Model catalog request failed.' };
          }
          return { ok: true, modelCount: models.length };
        } catch (cause) {
          return {
            ok: false,
            error: cause instanceof Error ? cause.message : 'Could not load ChatGPT models.',
          };
        }
      },
      onStateChange: (next) => {
        setOAuthState(next);
        if (next.phase === 'ready') {
          setMessage(next.message);
        }
      },
    });
    oauthControllerRef.current = controller;

    const handleFocusOrVisibility = () => {
      if (document.visibilityState === 'hidden') return;
      void controller.triggerCheck();
    };
    window.addEventListener('focus', handleFocusOrVisibility);
    document.addEventListener('visibilitychange', handleFocusOrVisibility);

    return () => {
      window.removeEventListener('focus', handleFocusOrVisibility);
      document.removeEventListener('visibilitychange', handleFocusOrVisibility);
      controller.dispose();
      oauthControllerRef.current = null;
    };
  }, [publishStatus]);

  async function savePreferences(next: ProviderPreferences) {
    beginBusy();
    setError('');
    setMessage('');
    try {
      const previousRaw = window.localStorage.getItem(PROVIDER_PREFERENCES_STORAGE_KEY);
      await requestJson('/preferences', { method: 'PUT', body: JSON.stringify({ preferences: next }) });
      const nextRaw = JSON.stringify(next);
      window.localStorage.setItem(PROVIDER_PREFERENCES_STORAGE_KEY, nextRaw);
      invalidateAiProviderRequestsForPreferenceChange(previousRaw, nextRaw);
      setPreferences(next);
      window.dispatchEvent(new Event('pcc:ai-preferences-changed'));
      setMessage('AI preferences saved.');
      await refresh(true);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not save AI preferences.');
    } finally {
      endBusy();
    }
  }

  async function changeDefaultConnection(connectionId: AiConnectionId) {
    const models = await refreshModels(connectionId);
    if (!preferences) return;
    const next = buildDefaultConnectionPreferences(connectionId, models, preferences);
    if (!next.ok) {
      setError(next.error);
      return;
    }
    await savePreferences(next.preferences);
  }

  async function submitSessionKeyAndVerify(params: {
    connectionId: AiConnectionId;
    path: string;
    keyValue: string;
    clearInput: () => void;
    label: string;
    fallbackError: string;
  }) {
    if (!params.keyValue.trim()) return;
    beginBusy();
    setError('');
    setMessage('');
    try {
      await requestJson(params.path, { method: 'POST', body: JSON.stringify({ apiKey: params.keyValue }) });
      invalidateAiProviderRequests();
      params.clearInput();
      await refresh(false);
      const models = await refreshModels(params.connectionId);
      if (catalogPhasesRef.current[params.connectionId] === 'fresh') {
        setMessage(
          `${params.label} saved for this session and verified via metadata-only catalog lookup (${models.length} model${models.length === 1 ? '' : 's'} listed; no inference call was made).`
        );
      } else {
        setMessage(
          `${params.label} saved for this session, but the metadata catalog lookup failed. Check the key or retry Refresh model catalog.`
        );
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : params.fallbackError);
    } finally {
      endBusy();
    }
  }

  async function clearSessionKey(path: string, successMessage: string, fallbackError: string) {
    beginBusy();
    setError('');
    setMessage('');
    try {
      await requestJson(path, { method: 'DELETE' });
      invalidateAiProviderRequests();
      setMessage(successMessage);
      await refresh(false);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : fallbackError);
    } finally {
      endBusy();
    }
  }

  async function authorizeChatGpt() {
    beginBusy();
    setError('');
    setMessage('');
    const popup = window.open('about:blank', '_blank');
    if (popup) popup.opener = null;
    try {
      if (!popup) throw new Error('The browser blocked the authorization window. Allow a pop-up for this local PCC page and try again.');
      const result = await requestJson<ChatGptAuthorizeResponse>('/chatgpt/authorize', { method: 'POST' });
      const authorizationUrl = new URL(result.authorizationUrl, window.location.href);
      if (authorizationUrl.protocol !== 'https:' || authorizationUrl.origin !== 'https://auth.openai.com') {
        throw new Error('The authorization URL was not secure.');
      }
      popup.location.href = authorizationUrl.href;
      oauthControllerRef.current?.start();
    } catch (cause) {
      popup?.close();
      oauthControllerRef.current?.cancel();
      setError(cause instanceof Error ? cause.message : 'Could not start ChatGPT authorization.');
    } finally {
      endBusy();
    }
  }

  async function disconnectChatGpt() {
    oauthControllerRef.current?.cancel();
    beginBusy();
    setError('');
    setMessage('');
    invalidateAiProviderRequests();
    try {
      const result = await requestJson<ChatGptDisconnectResponse>('/chatgpt/disconnect', { method: 'POST' });
      const notices: Record<ChatGptDisconnectResponse['remoteRevocation'], string> = {
        acknowledged: 'ChatGPT disconnected from PCC. OpenAI confirmed revocation of the renewable session token; this does not remove the entire app authorization from your ChatGPT account.',
        'not-confirmed': 'ChatGPT disconnected from PCC. Remote revocation could not be confirmed. To remove any remaining app authorization, review connected apps in ChatGPT Settings.',
        'endpoint-unavailable': 'ChatGPT disconnected from PCC. To remove remaining account access, review connected apps in ChatGPT Settings.',
        'not-connected': 'ChatGPT is not connected.',
      };
      setMessage(notices[result.remoteRevocation]);
      await refresh(false);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not disconnect ChatGPT.');
    } finally {
      endBusy();
    }
  }

  async function changeOverride(operation: string, connectionId: AiConnectionId) {
    if (!preferences) return;
    const models = await refreshModels(connectionId);
    const preferredModelId = connectionId === 'chatgpt-plan'
      ? preferences.preferredTextModelsByConnection?.['chatgpt-plan']
      : undefined;
    const isSupported = (item: AiModelDescriptor) => {
      const opCap = item.operationCapabilities[operation as AiOperation];
      return item.availability.state === 'supported' &&
        (operation === 'image' ? item.imageGeneration.state === 'supported' : item.textGeneration.state === 'supported') &&
        opCap?.state === 'supported' &&
        opCap.value === true;
    };
    const model = (preferredModelId ? models.find(item => item.id === preferredModelId && isSupported(item)) : undefined)
      ?? models.find(isSupported);
    if (!model) {
      setError(`No verified ${operation === 'image' ? 'image' : 'text'} model is available for this connection. Refresh its catalog and try again.`);
      return;
    }
    const operationOverrides = {
      ...preferences.operationOverrides,
      [operation]: { connectionId, modelId: model.id, reasoningLevel: 'default' as AiReasoningLevel },
    };
    await savePreferences({ ...preferences, operationOverrides });
  }

  async function clearOverride(operation: string) {
    if (!preferences?.operationOverrides?.[operation]) return;
    const operationOverrides = { ...preferences.operationOverrides };
    delete operationOverrides[operation];
    await savePreferences({ ...preferences, operationOverrides });
  }

  async function selectOverrideModel(operation: string, modelId: string) {
    const current = preferences?.operationOverrides?.[operation];
    if (!preferences || !current) return;
    const connection = status?.connections.find(item => item.id === current.connectionId);
    const model = connection?.models.find(item => item.id === modelId);
    if (!connection || !isCatalogSelectable(connection.state, catalogPhases[current.connectionId])) {
      setError('Refresh this connection’s model catalog successfully before selecting from it.');
      return;
    }
    const preferredChatGptReasoning = preferences.preferredReasoningLevelsByConnection?.['chatgpt-plan'];
    if (!isModelSupportedForOperation(operation, current.connectionId, model, preferredChatGptReasoning)) {
      setError('This exact model is not verified for the selected operation. Refresh the account catalog and choose another model.');
      return;
    }
    const operationOverrides = {
      ...preferences.operationOverrides,
      [operation]: { connectionId: current.connectionId, modelId, reasoningLevel: 'default' as AiReasoningLevel },
    };
    await savePreferences({ ...preferences, operationOverrides });
  }

  async function selectOverrideReasoning(operation: string, reasoningLevel: AiReasoningLevel) {
    const current = preferences?.operationOverrides?.[operation];
    if (!preferences || !current) return;
    const operationOverrides = { ...preferences.operationOverrides, [operation]: { ...current, reasoningLevel } };
    await savePreferences({ ...preferences, operationOverrides });
  }

  const handleTabKeyDown = (event: React.KeyboardEvent<HTMLButtonElement>, index: number) => {
    let nextIndex: number;
    if (event.key === 'ArrowRight') nextIndex = (index + 1) % AI_SETTINGS_TABS.length;
    else if (event.key === 'ArrowLeft') nextIndex = (index - 1 + AI_SETTINGS_TABS.length) % AI_SETTINGS_TABS.length;
    else if (event.key === 'Home') nextIndex = 0;
    else if (event.key === 'End') nextIndex = AI_SETTINGS_TABS.length - 1;
    else return;
    event.preventDefault();
    setActiveTab(AI_SETTINGS_TABS[nextIndex].id);
    tabRefs.current[nextIndex]?.focus();
  };

  const activeSummary = useMemo(
    () => summarizeActiveProviderPill(status, preferences, loading, error || null),
    [status, preferences, loading, error]
  );

  return (
    <section aria-labelledby="ai-connections-heading" className="space-y-4">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 id="ai-connections-heading" className="text-base font-semibold text-gray-900 dark:text-gray-100">
            AI connections &amp; routing
          </h2>
          <p className="mt-1 text-sm text-gray-600 dark:text-gray-300">
            Manage provider connections, active models, per-operation routing, and usage transparency.
          </p>
        </div>
        <div
          className="inline-flex items-center gap-2 rounded-lg border border-pcc-line bg-pcc-canvas px-3 py-1.5 text-xs dark:border-pcc-dark-line dark:bg-pcc-dark-canvas"
          aria-label="Current active AI routing summary"
        >
          <span
            aria-hidden="true"
            className={`h-2 w-2 rounded-full ${
              activeSummary.state === 'ready'
                ? 'bg-emerald-600'
                : activeSummary.state === 'needs-attention'
                  ? 'bg-amber-500'
                  : activeSummary.state === 'offline'
                    ? 'bg-red-500'
                    : 'bg-gray-400'
            }`}
          />
          <span className="font-medium text-pcc-ink dark:text-pcc-dark-ink">
            {activeSummary.providerLabel}
          </span>
          <span className="text-pcc-muted dark:text-pcc-dark-muted">· {activeSummary.modelLabel}</span>
        </div>
      </header>

      <div
        role="tablist"
        aria-label="AI settings sections"
        className="flex flex-wrap gap-1 border-b border-pcc-line pb-2 dark:border-pcc-dark-line"
      >
        {AI_SETTINGS_TABS.map((tab, index) => {
          const isSelected = activeTab === tab.id;
          return (
            <button
              key={tab.id}
              ref={(el) => { tabRefs.current[index] = el; }}
              id={`ai-settings-tab-${tab.id}`}
              type="button"
              role="tab"
              aria-selected={isSelected}
              aria-controls={`ai-settings-panel-${tab.id}`}
              tabIndex={isSelected ? 0 : -1}
              onClick={() => setActiveTab(tab.id)}
              onKeyDown={(event) => handleTabKeyDown(event, index)}
              className={`min-h-10 rounded-md px-3 py-1.5 text-xs font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-pcc-focus sm:text-sm ${
                isSelected
                  ? 'bg-pcc-action text-white shadow-sm'
                  : 'text-pcc-muted hover:bg-pcc-canvas hover:text-pcc-ink dark:text-pcc-dark-muted dark:hover:bg-pcc-dark-canvas dark:hover:text-pcc-dark-ink'
              }`}
            >
              {tab.label}
            </button>
          );
        })}
      </div>

      {error && (
        <p role="alert" className="rounded border border-red-300 bg-red-50 p-3 text-sm text-red-900 dark:border-red-800 dark:bg-red-950/40 dark:text-red-200">
          {error}
        </p>
      )}
      {message && (
        <p role="status" aria-live="polite" className="rounded border border-green-300 bg-green-50 p-3 text-sm text-green-900 dark:border-green-800 dark:bg-green-950/40 dark:text-green-200">
          {message}
        </p>
      )}
      {oauthState.phase !== 'idle' && (
        <div
          role="status"
          aria-live="polite"
          data-oauth-phase={oauthState.phase}
          className="flex flex-wrap items-center justify-between gap-2 rounded border border-blue-200 bg-blue-50 p-3 text-sm text-blue-950 dark:border-blue-800 dark:bg-blue-950/50 dark:text-blue-100"
        >
          <span>{oauthState.message}</span>
          <div className="flex flex-wrap gap-2">
            {oauthState.phase === 'waiting-authorization' && (
              <>
                <button
                  type="button"
                  className={SETTINGS_BUTTON_CLASS}
                  onClick={() => void oauthControllerRef.current?.triggerCheck()}
                >
                  Check status now
                </button>
                <button
                  type="button"
                  className={SETTINGS_BUTTON_CLASS}
                  onClick={() => oauthControllerRef.current?.cancel()}
                >
                  Stop waiting
                </button>
              </>
            )}
            {oauthState.phase === 'timed-out' && (
              <button
                type="button"
                className={SETTINGS_BUTTON_CLASS}
                onClick={() => void refresh(false)}
              >
                Check status
              </button>
            )}
            {oauthState.phase === 'catalog-unavailable' && (
              <button
                type="button"
                className={SETTINGS_BUTTON_CLASS}
                disabled={busy}
                onClick={() => {
                  void refreshModels('chatgpt-plan').then((models) => {
                    if (catalogPhasesRef.current['chatgpt-plan'] === 'fresh') {
                      setOAuthState({
                        phase: 'ready',
                        message: `ChatGPT connected and ready (${models.length} verified model${models.length === 1 ? '' : 's'} loaded).`,
                      });
                    }
                  });
                }}
              >
                Retry Catalog
              </button>
            )}
          </div>
        </div>
      )}
      {loading && (
        <p role="status" aria-live="polite" className="text-sm text-gray-600 dark:text-gray-300">
          Loading connection status…
        </p>
      )}

      {status && (
        <>
          <div
            id="ai-settings-panel-overview"
            role="tabpanel"
            aria-labelledby="ai-settings-tab-overview"
            hidden={activeTab !== 'overview'}
            className="space-y-3"
          >
            <div className="rounded-lg border border-pcc-line bg-pcc-canvas p-3 text-xs text-pcc-ink dark:border-pcc-dark-line dark:bg-pcc-dark-canvas dark:text-pcc-dark-ink">
              <p className="font-semibold">Active Routing</p>
              <p className="mt-1 text-pcc-muted dark:text-pcc-dark-muted">{activeSummary.detail}</p>
            </div>

            {!status.localPersonalConnectionsAvailable && (
              <p className="rounded border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-200">
                Personal provider connections are unavailable in this environment.
              </p>
            )}

            <section aria-labelledby="connection-list-heading" className="space-y-3">
              <div className="flex items-center justify-between gap-2">
                <h3 id="connection-list-heading" className="text-sm font-semibold text-gray-900 dark:text-gray-100">
                  Available connections
                </h3>
                <button
                  type="button"
                  className={SETTINGS_BUTTON_CLASS}
                  disabled={loading || busy}
                  onClick={() => void refresh(false)}
                >
                  Refresh status
                </button>
              </div>
              {connections.map(connection => (
                <ConnectionCard
                  key={connection.id}
                  connection={connection}
                  selected={preferences?.defaultConnectionId === connection.id}
                  observedCount={status.usage.observedByConnection[connection.id]}
                  catalogPhase={catalogPhases[connection.id]}
                  localPersonalConnectionsAvailable={status.localPersonalConnectionsAvailable}
                  loading={loading}
                  busy={busy}
                  geminiKeyInput={apiKey}
                  openAiKeyInput={openAiApiKey}
                  onGeminiKeyInputChange={setApiKey}
                  onOpenAiKeyInputChange={setOpenAiApiKeyInput}
                  onRefreshModels={(id) => void refreshModels(id)}
                  onSaveGeminiKey={(event) => {
                    event.preventDefault();
                    void submitSessionKeyAndVerify({
                      connectionId: 'gemini-personal',
                      path: '/gemini-key',
                      keyValue: apiKey,
                      clearInput: () => setApiKey(''),
                      label: 'Gemini API key',
                      fallbackError: 'Could not save the Gemini key.',
                    });
                  }}
                  onRemoveGeminiKey={() => void clearSessionKey('/gemini-key', 'Gemini key removed.', 'Could not remove the Gemini key.')}
                  onSaveOpenAiKey={(event) => {
                    event.preventDefault();
                    void submitSessionKeyAndVerify({
                      connectionId: 'openai-api',
                      path: '/openai-api-key',
                      keyValue: openAiApiKey,
                      clearInput: () => setOpenAiApiKeyInput(''),
                      label: 'OpenAI API key',
                      fallbackError: 'Could not save the OpenAI API key.',
                    });
                  }}
                  onRemoveOpenAiKey={() => void clearSessionKey('/openai-api-key', 'OpenAI API key removed from this server session.', 'Could not remove the OpenAI API key.')}
                  onAuthorizeChatGpt={() => void authorizeChatGpt()}
                  onDisconnectChatGpt={() => void disconnectChatGpt()}
                />
              ))}
            </section>
          </div>

          <div
            id="ai-settings-panel-models"
            role="tabpanel"
            aria-labelledby="ai-settings-tab-models"
            hidden={activeTab !== 'models'}
            className="space-y-3 rounded border border-gray-200 p-4 dark:border-gray-700"
          >
            <h3 className="text-sm font-semibold text-gray-900 dark:text-gray-100">Models &amp; defaults</h3>
            {preferences && (
              <ModelPreferencesSection
                connections={connections}
                preferences={preferences}
                catalogPhases={catalogPhases}
                busy={busy}
                onChangeDefaultConnection={(id) => void changeDefaultConnection(id)}
                onSavePreferences={(next) => void savePreferences(next)}
                onSaveChatGptModelPreference={(modelId) => {
                  if (!modelId) return;
                  void savePreferences({
                    ...preferences,
                    preferredTextModelsByConnection: { ...preferences.preferredTextModelsByConnection, 'chatgpt-plan': modelId },
                    preferredReasoningLevelsByConnection: { ...preferences.preferredReasoningLevelsByConnection, 'chatgpt-plan': 'default' },
                  });
                }}
                onSaveChatGptReasoningPreference={(level) => void savePreferences({
                  ...preferences,
                  preferredReasoningLevelsByConnection: { ...preferences.preferredReasoningLevelsByConnection, 'chatgpt-plan': level },
                })}
              />
            )}
            <p className="text-xs text-gray-600 dark:text-gray-300">
              Models are available only when listed by the selected account. Advanced capabilities are enabled only when supported by documented evidence.
            </p>
          </div>

          <div
            id="ai-settings-panel-overrides"
            role="tabpanel"
            aria-labelledby="ai-settings-tab-overrides"
            hidden={activeTab !== 'overrides'}
            className="space-y-3 rounded border border-gray-200 p-4 dark:border-gray-700"
          >
            <h3 className="text-sm font-semibold text-gray-900 dark:text-gray-100">Operation overrides</h3>
            <p className="text-xs text-gray-600 dark:text-gray-300">
              Route individual writing, analysis, sync, or diagnostic operations to a specific verified connection and model without changing your global default.
            </p>
            {preferences && (
              <OperationOverridesSection
                connections={connections}
                preferences={preferences}
                catalogPhases={catalogPhases}
                busy={busy}
                onChangeOverride={(operation, connectionId) => void changeOverride(operation, connectionId)}
                onClearOverride={(operation) => void clearOverride(operation)}
                onSelectOverrideModel={(operation, modelId) => void selectOverrideModel(operation, modelId)}
                onSelectOverrideReasoning={(operation, level) => void selectOverrideReasoning(operation, level)}
              />
            )}
          </div>

          <div
            id="ai-settings-panel-embeddings"
            role="tabpanel"
            aria-labelledby="ai-settings-tab-embeddings"
            hidden={activeTab !== 'embeddings'}
            className="rounded border border-dashed border-pcc-line bg-pcc-canvas p-5 dark:border-pcc-dark-line dark:bg-pcc-dark-canvas"
          >
            <h3 className="text-sm font-semibold text-gray-900 dark:text-gray-100">
              Embeddings &amp; Semantic Search
            </h3>
            <p className="mt-2 text-sm text-gray-700 dark:text-gray-200">
              Not yet implemented — scheduled for WP02.
            </p>
            <p className="mt-1.5 text-xs leading-relaxed text-gray-600 dark:text-gray-300">
              Dedicated embedding provider configuration, local manuscript indexing, and semantic memory retrieval will be introduced in Work Package 02. No background embedding jobs or network calls are active in this version.
            </p>
          </div>

          <div
            id="ai-settings-panel-usage"
            role="tabpanel"
            aria-labelledby="ai-settings-tab-usage"
            hidden={activeTab !== 'usage'}
            className="space-y-4 rounded border border-gray-200 p-4 dark:border-gray-700"
          >
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h3 id="usage-heading" className="text-sm font-semibold text-gray-900 dark:text-gray-100">
                Usage &amp; limits
              </h3>
              <button
                type="button"
                className={SETTINGS_BUTTON_CLASS}
                disabled={loading || busy}
                onClick={() => void refresh(false)}
              >
                Refresh status
              </button>
            </div>

            <div className="rounded border border-pcc-line bg-pcc-canvas p-3 text-sm dark:border-pcc-dark-line dark:bg-pcc-dark-canvas">
              {status.usage.quota.state === 'known' ? (
                <p className="text-gray-800 dark:text-gray-100">
                  Remaining quota:{' '}
                  {typeof status.usage.quota.remaining === 'number'
                    ? status.usage.quota.remaining
                    : 'Not reported'}
                  {status.usage.quota.resetsAt
                    ? ` · resets ${new Date(status.usage.quota.resetsAt).toLocaleString()}`
                    : ''}
                </p>
              ) : (
                <p className="text-gray-700 dark:text-gray-200">
                  Quota is unknown. External provider account limits are not directly exposed to this app.
                </p>
              )}
            </div>

            <div>
              <h4 className="text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">
                Observed requests this server session
              </h4>
              <dl className="mt-2 grid gap-2 sm:grid-cols-2">
                {connections.map((conn) => (
                  <div
                    key={conn.id}
                    className="flex items-center justify-between rounded border border-gray-200 px-3 py-2 text-xs dark:border-gray-700"
                  >
                    <dt className="font-medium text-gray-800 dark:text-gray-100">
                      {CONNECTION_LABELS[conn.id]}
                    </dt>
                    <dd className="font-semibold text-gray-700 dark:text-gray-200">
                      {typeof status.usage.observedByConnection[conn.id] === 'number'
                        ? status.usage.observedByConnection[conn.id]
                        : 0}
                    </dd>
                  </div>
                ))}
              </dl>
            </div>

            <p className="text-xs leading-relaxed text-gray-600 dark:text-gray-300">
              All AI operations enforce server-side concurrency limits and token budgets before calling any provider. ChatGPT plan requests run single-attempt only with no automatic retry and no cross-provider billing fallback.
            </p>
          </div>
        </>
      )}
    </section>
  );
}
