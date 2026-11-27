import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  invalidateAiProviderRequests,
  invalidateAiProviderRequestsForPreferenceChange,
  PROVIDER_PREFERENCES_STORAGE_KEY,
} from '../../services/apiClient';
import {
  buildDefaultConnectionPreferences,
  catalogPhasesForStatusRefresh,
  catalogVerificationFingerprint,
  isCatalogSelectable,
  isModelSupportedForOperation,
  type CatalogRefreshPhase,
} from '../../lib/providerCatalogView';
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
import { ConnectionCard, SETTINGS_BUTTON_CLASS } from './ConnectionCard';
import { ModelPreferencesSection } from './ModelPreferencesSection';
import { OperationOverridesSection } from './OperationOverridesSection';

const BASE = '/api/ai/provider-hub';
const VALID_CONNECTION_IDS = new Set<AiConnectionId>(['gemini-managed', 'gemini-personal', 'chatgpt-plan', 'openai-api']);

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

// Renderer-process memory only, not localStorage. Reopening the modal may
// reuse proof only after a status check matches the same account authority.
const verifiedCatalogs = new Map<AiConnectionId, string>();

export default function AiConnectionsPanel() {
  const [status, setStatus] = useState<ProviderHubStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [apiKey, setApiKey] = useState('');
  const [openAiApiKey, setOpenAiApiKeyInput] = useState('');
  const [preferences, setPreferences] = useState<ProviderPreferences | null>(null);
  const [catalogPhases, setCatalogPhases] = useState<Partial<Record<AiConnectionId, CatalogRefreshPhase>>>({});

  const statusRef = useRef<ProviderHubStatus | null>(null);
  const statusEpoch = useRef(0);
  const catalogEpochs = useRef(new Map<AiConnectionId, number>());
  const busyCountRef = useRef(0);

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
    setCatalogPhases(updater);
  }, []);

  const publishStatus = useCallback((next: ProviderHubStatus) => {
    statusRef.current = next;
    setStatus(next);
    window.dispatchEvent(new Event('pcc:provider-hub-status-changed'));
  }, []);

  const refresh = useCallback(async (preserveFreshPhases = false) => {
    const requestEpoch = ++statusEpoch.current;
    for (const id of catalogEpochs.current.keys()) {
      catalogEpochs.current.set(id, (catalogEpochs.current.get(id) ?? 0) + 1);
    }
    if (!preserveFreshPhases) verifiedCatalogs.clear();
    const cachedStatus = statusRef.current;
    if (cachedStatus) {
      updateCatalogPhases(catalogPhasesForStatusRefresh(cachedStatus.connections, {}, false));
    }
    setLoading(true);
    setError('');
    try {
      const next = await requestJson<ProviderHubStatus>('/status');
      if (requestEpoch !== statusEpoch.current) return;
      publishStatus(next);
      const phases = catalogPhasesForStatusRefresh(next.connections, {}, false);
      for (const connection of next.connections) {
        const fingerprint = catalogVerificationFingerprint(next, connection.id);
        if (preserveFreshPhases && fingerprint !== undefined && verifiedCatalogs.get(connection.id) === fingerprint) {
          phases[connection.id] = 'fresh';
        } else {
          verifiedCatalogs.delete(connection.id);
        }
      }
      updateCatalogPhases(phases);
      setPreferences(readLocalStoredPreferences(next.preferences));
    } catch (cause) {
      if (requestEpoch === statusEpoch.current) {
        verifiedCatalogs.clear();
        setError(cause instanceof Error ? cause.message : 'Could not load AI connection status.');
      }
    } finally {
      if (requestEpoch === statusEpoch.current) setLoading(false);
    }
  }, [publishStatus, updateCatalogPhases]);

  useEffect(() => { void Promise.resolve().then(() => refresh(true)); }, [refresh]);

  const connections = useMemo(() => status?.connections ?? [], [status?.connections]);

  async function refreshModels(connectionId: AiConnectionId): Promise<AiModelDescriptor[]> {
    const requestStatusEpoch = statusEpoch.current;
    const requestEpoch = (catalogEpochs.current.get(connectionId) ?? 0) + 1;
    catalogEpochs.current.set(connectionId, requestEpoch);
    verifiedCatalogs.delete(connectionId);
    updateCatalogPhases(current => ({ ...current, [connectionId]: 'loading' }));
    beginBusy();
    setError('');
    try {
      const result = await requestJson<ProviderModelsResponse>(`/models?connectionId=${encodeURIComponent(connectionId)}`);
      if (requestStatusEpoch !== statusEpoch.current || catalogEpochs.current.get(connectionId) !== requestEpoch) return [];
      const currentStatus = statusRef.current;
      const target = currentStatus?.connections.find(item => item.id === connectionId);
      if (!currentStatus || !target || !['available', 'connected'].includes(target.state)) return [];
      const updatedStatus: ProviderHubStatus = {
        ...currentStatus,
        connections: currentStatus.connections.map(item => item.id === connectionId
          ? { ...item, models: result.models, state: 'connected' }
          : item),
      };
      publishStatus(updatedStatus);
      const fingerprint = catalogVerificationFingerprint(updatedStatus, connectionId);
      if (fingerprint !== undefined) verifiedCatalogs.set(connectionId, fingerprint);
      updateCatalogPhases(current => ({ ...current, [connectionId]: fingerprint === undefined ? 'stale' : 'fresh' }));
      return result.models;
    } catch (cause) {
      if (requestStatusEpoch !== statusEpoch.current || catalogEpochs.current.get(connectionId) !== requestEpoch) return [];
      updateCatalogPhases(current => ({ ...current, [connectionId]: 'failed' }));
      setError(cause instanceof Error ? cause.message : 'Could not load models.');
      return [];
    } finally {
      endBusy();
    }
  }

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

  async function submitSessionKey(params: {
    path: string;
    keyValue: string;
    clearInput: () => void;
    successMessage: string;
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
      setMessage(params.successMessage);
      await refresh(false);
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
      setMessage('Authorization opened in a new tab. Refresh status after completing it.');
    } catch (cause) {
      popup?.close();
      setError(cause instanceof Error ? cause.message : 'Could not start ChatGPT authorization.');
    } finally {
      endBusy();
    }
  }

  async function disconnectChatGpt() {
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
    if (operation === 'story' && connectionId === 'chatgpt-plan') {
      const modelId = preferences.preferredTextModelsByConnection?.['chatgpt-plan'];
      if (modelId !== 'gpt-6-luna' || (preferences.preferredReasoningLevelsByConnection?.['chatgpt-plan'] ?? 'default') !== 'default') {
        setError('ChatGPT Story is available only after saving GPT-6 Luna and Default reasoning as the exact account preference.');
        return;
      }
      const operationOverrides = { ...preferences.operationOverrides, story: { connectionId, modelId, reasoningLevel: 'default' as AiReasoningLevel } };
      await savePreferences({ ...preferences, operationOverrides });
      return;
    }
    const models = await refreshModels(connectionId);
    const model = models.find((item) => {
      const opCap = item.operationCapabilities[operation as AiOperation];
      return item.availability.state === 'supported' &&
        (operation === 'image' ? item.imageGeneration.state === 'supported' : item.textGeneration.state === 'supported') &&
        opCap?.state === 'supported' &&
        opCap.value === true;
    });
    if (!model) {
      setError(`No verified ${operation === 'image' ? 'image' : 'text'} model is available for this connection. Refresh its catalog and try again.`);
      return;
    }
    const operationOverrides = { ...preferences.operationOverrides, [operation]: { connectionId, modelId: model.id } };
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

  return (
    <section aria-labelledby="ai-connections-heading" className="space-y-4">
      <header>
        <h2 id="ai-connections-heading" className="text-base font-semibold text-gray-900 dark:text-gray-100">AI connections</h2>
        <p className="mt-1 text-sm text-gray-600 dark:text-gray-300">Choose how AI features connect and which model they use.</p>
      </header>

      {error && <p role="alert" className="rounded border border-red-300 bg-red-50 p-3 text-sm text-red-900 dark:border-red-800 dark:bg-red-950/40 dark:text-red-200">{error}</p>}
      {message && <p role="status" aria-live="polite" className="rounded border border-green-300 bg-green-50 p-3 text-sm text-green-900 dark:border-green-800 dark:bg-green-950/40 dark:text-green-200">{message}</p>}
      {loading && <p role="status" aria-live="polite" className="text-sm text-gray-600 dark:text-gray-300">Loading connection status…</p>}

      {status && (
        <>
          <section aria-labelledby="connection-list-heading" className="space-y-3">
            <h3 id="connection-list-heading" className="text-sm font-semibold text-gray-900 dark:text-gray-100">Available connections</h3>
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
                  void submitSessionKey({
                    path: '/gemini-key',
                    keyValue: apiKey,
                    clearInput: () => setApiKey(''),
                    successMessage: 'Gemini key submitted. Connection status will update after verification.',
                    fallbackError: 'Could not save the Gemini key.',
                  });
                }}
                onRemoveGeminiKey={() => void clearSessionKey('/gemini-key', 'Gemini key removed.', 'Could not remove the Gemini key.')}
                onSaveOpenAiKey={(event) => {
                  event.preventDefault();
                  void submitSessionKey({
                    path: '/openai-api-key',
                    keyValue: openAiApiKey,
                    clearInput: () => setOpenAiApiKeyInput(''),
                    successMessage: 'OpenAI API key saved for this server session. Refresh the catalog before selecting it.',
                    fallbackError: 'Could not save the OpenAI API key.',
                  });
                }}
                onRemoveOpenAiKey={() => void clearSessionKey('/openai-api-key', 'OpenAI API key removed from this server session.', 'Could not remove the OpenAI API key.')}
                onAuthorizeChatGpt={() => void authorizeChatGpt()}
                onDisconnectChatGpt={() => void disconnectChatGpt()}
              />
            ))}
          </section>

          <section aria-labelledby="usage-heading" className="rounded border border-gray-200 p-3 dark:border-gray-700">
            <h3 id="usage-heading" className="text-sm font-semibold text-gray-900 dark:text-gray-100">Usage and quota</h3>
            {status.usage.quota.state === 'known'
              ? <p className="mt-1 text-sm text-gray-700 dark:text-gray-200">Remaining quota: {typeof status.usage.quota.remaining === 'number' ? status.usage.quota.remaining : 'Not reported'}{status.usage.quota.resetsAt ? ` · resets ${new Date(status.usage.quota.resetsAt).toLocaleString()}` : ''}</p>
              : <p className="mt-1 text-sm text-gray-700 dark:text-gray-200">Quota is unknown. Provider limits are not available to this app.</p>}
            <button type="button" className={`${SETTINGS_BUTTON_CLASS} mt-2`} disabled={loading || busy} onClick={() => void refresh(true)}>Refresh status</button>
          </section>

          {!status.localPersonalConnectionsAvailable && (
            <p className="rounded border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-200">
              Personal provider connections are unavailable in this environment.
            </p>
          )}

          <section aria-labelledby="preferences-heading" className="space-y-3 rounded border border-gray-200 p-3 dark:border-gray-700">
            <h3 id="preferences-heading" className="text-sm font-semibold text-gray-900 dark:text-gray-100">Model preferences</h3>
            {preferences && (
              <>
                <ModelPreferencesSection
                  connections={connections}
                  preferences={preferences}
                  catalogPhases={catalogPhases}
                  busy={busy || loading}
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
                <OperationOverridesSection
                  connections={connections}
                  preferences={preferences}
                  catalogPhases={catalogPhases}
                  busy={busy || loading}
                  onChangeOverride={(operation, connectionId) => void changeOverride(operation, connectionId)}
                  onClearOverride={(operation) => void clearOverride(operation)}
                  onSelectOverrideModel={(operation, modelId) => void selectOverrideModel(operation, modelId)}
                  onSelectOverrideReasoning={(operation, level) => void selectOverrideReasoning(operation, level)}
                />
              </>
            )}
            <p className="text-xs text-gray-600 dark:text-gray-300">
              Models are available only when listed by the selected account. Advanced capabilities are enabled only when supported by documented evidence.
            </p>
          </section>
        </>
      )}
    </section>
  );
}
