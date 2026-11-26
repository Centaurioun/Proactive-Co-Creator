import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { invalidateAiProviderRequests } from '../../services/apiClient';
import { catalogStateLabel, isCatalogSelectable, isEligibleTextModel, modelsForConnection, type CatalogRefreshPhase } from '../../lib/providerCatalogView';
import type { AiReasoningLevel as ReasoningLevel } from '../../server/providers/contracts';

type AiConnectionId = 'gemini-managed' | 'gemini-personal' | 'chatgpt-plan' | 'openai-api';
interface AiCapabilityEvidence {
  source: string;
  reference: string;
  checkedAt: string;
  transport: string;
  modelSlug: string;
}
interface AiCapabilitySummary {
  state: 'supported' | 'unsupported' | 'unknown';
  value?: boolean | number | readonly ReasoningLevel[];
  reason?: string;
  evidence?: AiCapabilityEvidence[];
}
type ConnectionState =
  | 'available' | 'unconfigured' | 'connecting' | 'connected' | 'authorization-required'
  | 'expired' | 'unsupported-environment' | 'rate-limited' | 'quota-exhausted' | 'failed';

interface AiModelDescriptor {
  id: string;
  displayName: string;
  availability: AiCapabilitySummary;
  textGeneration: AiCapabilitySummary;
  imageGeneration: AiCapabilitySummary;
  reasoning: AiCapabilitySummary;
  structuredOutput: AiCapabilitySummary;
  contextLimit: AiCapabilitySummary;
  outputLimit: AiCapabilitySummary;
  operationCapabilities: Record<string, AiCapabilitySummary>;
  capabilityPolicyVersion: string;
}

function supportedReasoningLevels(capability?: AiCapabilitySummary): ReasoningLevel[] {
  return capability?.state === 'supported' && Array.isArray(capability.value)
    ? ['default', ...capability.value.filter((level): level is ReasoningLevel => typeof level === 'string')]
    : ['default'];
}

interface AiConnectionDescriptor {
  id: AiConnectionId;
  family: 'gemini' | 'openai';
  billing: 'host-managed-gemini' | 'gemini-api-key' | 'chatgpt-plan' | 'openai-api-key';
  state: ConnectionState;
  selectedModelId?: string;
  models: AiModelDescriptor[];
  message?: string;
  lastCheckedAt?: string;
}

interface ProviderPreferences {
  defaultConnectionId: AiConnectionId;
  defaultTextModelId?: string;
  defaultReasoningLevel?: ReasoningLevel;
  operationOverrides?: Record<string, {
    connectionId: AiConnectionId;
    modelId?: string;
    reasoningLevel?: ReasoningLevel;
  }>;
}

interface ProviderHubStatus {
  localPersonalConnectionsAvailable: boolean;
  connections: AiConnectionDescriptor[];
  preferences: ProviderPreferences;
  usage: {
    observedByConnection: Record<string, number>;
    quota: { state: 'known' | 'unknown'; remaining?: number; resetsAt?: string };
  };
}

const BASE = '/api/ai/provider-hub';
const OPERATIONS = [
  ['analyze', 'Analysis'], ['clarify', 'Clarifications'], ['refine', 'Prompt refinement'],
  ['batch-edit', 'Batch editing'], ['story', 'Story generation'], ['image', 'Image generation'],
  ['narrative-import', 'Narrative import'], ['writing', 'Writing assistance'],
] as const;
const PREFS_KEY = 'pcc.ai.providerPreferences.v1';
const CONNECTION_LABELS: Record<AiConnectionId, string> = {
  'gemini-managed': 'Gemini managed',
  'gemini-personal': 'Gemini API key',
  'chatgpt-plan': 'ChatGPT plan',
  'openai-api': 'OpenAI API key',
};

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

const buttonClass = 'rounded border border-gray-300 px-3 py-1.5 text-sm font-medium text-gray-800 hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-50 dark:border-gray-600 dark:text-gray-100 dark:hover:bg-gray-800';
const inputClass = 'w-full rounded border border-gray-300 bg-white px-2.5 py-2 text-sm text-gray-900 dark:border-gray-600 dark:bg-gray-900 dark:text-gray-100';

function stateLabel(state: ConnectionState): string {
  return state.replaceAll('-', ' ');
}

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

  const publishStatus = useCallback((next: ProviderHubStatus) => {
    statusRef.current = next;
    setStatus(next);
  }, []);

  const refresh = useCallback(async () => {
    const requestEpoch = ++statusEpoch.current;
    for (const id of catalogEpochs.current.keys()) catalogEpochs.current.set(id, (catalogEpochs.current.get(id) ?? 0) + 1);
    const cachedStatus = statusRef.current;
    if (cachedStatus) {
      const stalePhases: Partial<Record<AiConnectionId, CatalogRefreshPhase>> = {};
      for (const connection of cachedStatus.connections) stalePhases[connection.id] = 'stale';
      setCatalogPhases(stalePhases);
    }
    setLoading(true);
    setError('');
    try {
      const next = await requestJson<ProviderHubStatus>('/status');
      if (requestEpoch !== statusEpoch.current) return;
      publishStatus(next);
      if (!cachedStatus) {
        const initialPhases: Partial<Record<AiConnectionId, CatalogRefreshPhase>> = {};
        for (const connection of next.connections) {
          if (connection.models.length > 0) initialPhases[connection.id] = 'stale';
        }
        setCatalogPhases(initialPhases);
      }
      let saved = next.preferences;
      const raw = window.localStorage.getItem(PREFS_KEY);
      if (raw) {
        try {
          const parsed = JSON.parse(raw) as ProviderPreferences;
          if (!parsed || !['gemini-managed', 'gemini-personal', 'chatgpt-plan', 'openai-api'].includes(parsed.defaultConnectionId)) throw new Error('Stored AI preferences are invalid.');
          saved = parsed;
        } catch {
          throw new Error('Stored AI preferences are invalid. Open AI Settings and choose a valid connection before using AI.');
        }
      }
      setPreferences(saved);
    } catch (cause) {
      if (requestEpoch === statusEpoch.current) setError(cause instanceof Error ? cause.message : 'Could not load AI connection status.');
    } finally {
      if (requestEpoch === statusEpoch.current) setLoading(false);
    }
  }, [publishStatus]);

  useEffect(() => { void Promise.resolve().then(refresh); }, [refresh]);

  const connections = useMemo(() => status?.connections ?? [], [status?.connections]);
  const defaultConnection = connections.find(item => item.id === preferences?.defaultConnectionId);
  const modelOptions = modelsForConnection(connections, preferences?.defaultConnectionId);

  async function refreshModels(connectionId: AiConnectionId) {
    const requestStatusEpoch = statusEpoch.current;
    const requestEpoch = (catalogEpochs.current.get(connectionId) ?? 0) + 1;
    catalogEpochs.current.set(connectionId, requestEpoch);
    setCatalogPhases(current => ({ ...current, [connectionId]: 'loading' }));
    setBusy(true);
    setError('');
    try {
      const result = await requestJson<{ models: AiModelDescriptor[] }>(`/models?connectionId=${encodeURIComponent(connectionId)}`);
      if (requestStatusEpoch !== statusEpoch.current || catalogEpochs.current.get(connectionId) !== requestEpoch) return [];
      const currentStatus = statusRef.current;
      const target = currentStatus?.connections.find(item => item.id === connectionId);
      if (!currentStatus || !target || !['available', 'connected'].includes(target.state)) return [];
      invalidateAiProviderRequests();
      publishStatus({ ...currentStatus, connections: currentStatus.connections.map(item => item.id === connectionId
        ? { ...item, models: result.models, state: 'connected' }
        : item) });
      setCatalogPhases(current => ({ ...current, [connectionId]: 'fresh' }));
      return result.models;
    } catch (cause) {
      if (requestStatusEpoch !== statusEpoch.current || catalogEpochs.current.get(connectionId) !== requestEpoch) return [];
      setCatalogPhases(current => ({ ...current, [connectionId]: 'failed' }));
      setError(cause instanceof Error ? cause.message : 'Could not load models.');
      return [];
    } finally {
      if (catalogEpochs.current.get(connectionId) === requestEpoch) setBusy(false);
    }
  }

  async function savePreferences(next: ProviderPreferences) {
    setBusy(true);
    setError('');
    setMessage('');
    const previous = preferences;
    let previousRaw: string | null = null;
    try {
      previousRaw = window.localStorage.getItem(PREFS_KEY);
      window.localStorage.setItem(PREFS_KEY, JSON.stringify(next));
      invalidateAiProviderRequests();
      await requestJson('/preferences', { method: 'PUT', body: JSON.stringify({ preferences: next }) });
      setPreferences(next);
      setMessage('AI preferences saved.');
      await refresh();
    } catch (cause) {
      try {
        if (previousRaw === null) window.localStorage.removeItem(PREFS_KEY);
        else window.localStorage.setItem(PREFS_KEY, previousRaw);
      } catch { /* The request remains blocked until the user can repair browser storage. */ }
      setPreferences(previous);
      await refresh();
      setError(cause instanceof Error ? cause.message : 'Could not save AI preferences.');
    } finally {
      setBusy(false);
    }
  }

  async function changeDefaultConnection(connectionId: AiConnectionId) {
    const models = await refreshModels(connectionId);
    if (!preferences) return;
    const modelId = models.find(isEligibleTextModel)?.id;
    if (!modelId) {
      setError('No model has a verified PCC operation for this connection. Refresh its catalog or choose another connection.');
      return;
    }
    await savePreferences({ ...preferences, defaultConnectionId: connectionId, defaultTextModelId: modelId, defaultReasoningLevel: 'default' });
  }

  const currentDefaultCatalog = isCatalogSelectable(defaultConnection?.state ?? '', catalogPhases[preferences?.defaultConnectionId ?? 'gemini-managed']);
  const providerDefaultSelected = preferences?.defaultConnectionId === 'gemini-managed' && !preferences.defaultTextModelId;
  const defaultCatalogSelectable = currentDefaultCatalog || providerDefaultSelected;
  const selectedModel = defaultCatalogSelectable
    ? modelOptions.find(model => model.id === (preferences?.defaultTextModelId ?? defaultConnection?.selectedModelId))
    : undefined;
  const eligibleDefaultModels = currentDefaultCatalog ? modelOptions.filter(isEligibleTextModel) : [];
  const supportedReasoning = supportedReasoningLevels(selectedModel?.reasoning);

  async function saveGeminiKey(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!apiKey.trim()) return;
    setBusy(true); setError(''); setMessage('');
    try {
      await requestJson('/gemini-key', { method: 'POST', body: JSON.stringify({ apiKey }) });
      invalidateAiProviderRequests();
      setApiKey('');
      setMessage('Gemini key submitted. Connection status will update after verification.');
      await refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not save the Gemini key.');
    } finally { setBusy(false); }
  }

  async function removeGeminiKey() {
    setBusy(true); setError(''); setMessage('');
    try {
      await requestJson('/gemini-key', { method: 'DELETE' });
      invalidateAiProviderRequests();
      setMessage('Gemini key removed.');
      await refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not remove the Gemini key.');
    } finally { setBusy(false); }
  }

  async function saveOpenAiApiKey(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!openAiApiKey.trim()) return;
    setBusy(true); setError(''); setMessage('');
    try {
      await requestJson('/openai-api-key', { method: 'POST', body: JSON.stringify({ apiKey: openAiApiKey }) });
      invalidateAiProviderRequests();
      setOpenAiApiKeyInput('');
      setMessage('OpenAI API key saved for this server session. Refresh the catalog before selecting it.');
      await refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not save the OpenAI API key.');
    } finally { setBusy(false); }
  }

  async function removeOpenAiApiKey() {
    setBusy(true); setError(''); setMessage('');
    try {
      await requestJson('/openai-api-key', { method: 'DELETE' });
      invalidateAiProviderRequests();
      setMessage('OpenAI API key removed from this server session.');
      await refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not remove the OpenAI API key.');
    } finally { setBusy(false); }
  }

  async function authorizeChatGpt() {
    setBusy(true); setError(''); setMessage('');
    const popup = window.open('about:blank', '_blank');
    if (popup) popup.opener = null;
    try {
      if (!popup) throw new Error('The browser blocked the authorization window. Allow a pop-up for this local PCC page and try again.');
      const result = await requestJson<{ authorizationUrl: string }>('/chatgpt/authorize', { method: 'POST' });
      const authorizationUrl = new URL(result.authorizationUrl, window.location.href);
      if (authorizationUrl.protocol !== 'https:' || authorizationUrl.origin !== 'https://auth.openai.com') {
        throw new Error('The authorization URL was not secure.');
      }
      popup.location.href = authorizationUrl.href;
      setMessage('Authorization opened in a new tab. Refresh status after completing it.');
    } catch (cause) {
      popup?.close();
      setError(cause instanceof Error ? cause.message : 'Could not start ChatGPT authorization.');
    } finally { setBusy(false); }
  }

  async function disconnectChatGpt() {
    setBusy(true); setError(''); setMessage('');
    invalidateAiProviderRequests();
    try {
      const result = await requestJson<{ remoteRevocation: 'acknowledged' | 'not-confirmed' | 'endpoint-unavailable' | 'not-connected' }>('/chatgpt/disconnect', { method: 'POST' });
      const notices = {
        acknowledged: 'ChatGPT disconnected from PCC. OpenAI confirmed revocation of the renewable session token; this does not remove the entire app authorization from your ChatGPT account.',
        'not-confirmed': 'ChatGPT disconnected from PCC. Remote revocation could not be confirmed. To remove any remaining app authorization, review connected apps in ChatGPT Settings.',
        'endpoint-unavailable': 'ChatGPT disconnected from PCC. To remove remaining account access, review connected apps in ChatGPT Settings.',
        'not-connected': 'ChatGPT is not connected.',
      };
      setMessage(notices[result.remoteRevocation]);
      await refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not disconnect ChatGPT.');
    } finally { setBusy(false); }
  }

  async function changeOverride(operation: string, connectionId: AiConnectionId) {
    if (!preferences) return;
    const models = await refreshModels(connectionId);
    const model = models.find(item => item.availability.state === 'supported' &&
      (operation === 'image' ? item.imageGeneration.state === 'supported' : item.textGeneration.state === 'supported') &&
      item.operationCapabilities[operation]?.state === 'supported');
    if (!model) {
      setError(`No verified ${operation === 'image' ? 'image' : 'text'} model is available for this connection. Refresh its catalog and try again.`);
      return;
    }
    const overrides = { ...preferences.operationOverrides };
    overrides[operation] = { connectionId, modelId: model.id };
    await savePreferences({ ...preferences, operationOverrides: overrides });
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
    if (!model || model.availability.state !== 'supported' || model.operationCapabilities[operation]?.state !== 'supported' ||
      model.operationCapabilities[operation]?.value !== true) {
      setError('This exact model is not verified for the selected operation. Refresh the account catalog and choose another model.');
      return;
    }
    const operationOverrides = { ...preferences.operationOverrides, [operation]: { connectionId: current.connectionId, modelId, reasoningLevel: 'default' as ReasoningLevel } };
    await savePreferences({ ...preferences, operationOverrides });
  }

  async function selectOverrideReasoning(operation: string, reasoningLevel: ReasoningLevel) {
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

      {status && <>
        <section aria-labelledby="connection-list-heading" className="space-y-3">
          <h3 id="connection-list-heading" className="text-sm font-semibold text-gray-900 dark:text-gray-100">Available connections</h3>
          {connections.map(connection => {
            const observed = status.usage.observedByConnection[connection.id];
            const selected = preferences?.defaultConnectionId === connection.id;
            return <article key={connection.id} className="rounded border border-gray-200 p-3 dark:border-gray-700">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div>
                  <h4 className="text-sm font-semibold text-gray-900 dark:text-gray-100">{CONNECTION_LABELS[connection.id]}</h4>
                  <p className="mt-1 text-xs capitalize text-gray-600 dark:text-gray-300">
                    Status: <span className="font-medium">{stateLabel(connection.state)}</span>
                    {connection.lastCheckedAt && <> · checked {new Date(connection.lastCheckedAt).toLocaleString()}</>}
                  </p>
                </div>
                {selected && <span className="rounded bg-blue-50 px-2 py-1 text-xs font-medium text-blue-900 dark:bg-blue-950 dark:text-blue-200">Default</span>}
              </div>
              {connection.message && <p className="mt-2 text-sm text-gray-700 dark:text-gray-200">{connection.message}</p>}
              <p className="mt-2 text-xs text-gray-600 dark:text-gray-300">Observed requests: {typeof observed === 'number' ? observed : 'Not available'}</p>
              <button type="button" className={`${buttonClass} mt-2`} disabled={loading || busy || !['available', 'connected'].includes(connection.state)} onClick={() => void refreshModels(connection.id)}>Refresh model catalog</button>

              <details className="mt-3 space-y-2 rounded border border-gray-200 p-2 dark:border-gray-700">
                  <summary className="cursor-pointer text-sm font-medium">Model catalog ({connection.models.length}) · {catalogStateLabel(connection.state, connection.models.length, catalogPhases[connection.id])}</summary>
                  {!['available', 'connected'].includes(connection.state) && <p className="text-xs text-gray-600 dark:text-gray-300">This connection is {stateLabel(connection.state)}. Catalog entries are retained for inspection and cannot be selected until the connection is available.</p>}
                  {connection.models.length === 0 ? <p className="text-xs text-gray-600 dark:text-gray-300">{catalogStateLabel(connection.state, connection.models.length, catalogPhases[connection.id]) === 'refreshed; empty catalog' ? 'The latest account catalog is empty.' : 'No models are cached for this connection.'}</p> : (
                    <ul aria-label={CONNECTION_LABELS[connection.id] + ' model catalog'} className="max-h-80 space-y-2 overflow-y-auto">
                      {connection.models.map(model => (
                        <li key={model.id} className="rounded border border-gray-200 p-2 text-xs dark:border-gray-700">
                          <p className="break-words text-sm font-medium">{model.displayName}</p>
                          <p className="break-all text-gray-600 dark:text-gray-300">{model.id}</p>
                          <p>Catalog availability: {model.availability.state}</p>
                          <p>Text operation eligibility: {isEligibleTextModel(model) ? 'At least one supported PCC operation' : 'Unavailable for active PCC text routing'}</p>
                          <p>Reasoning registry: {model.reasoning.state === 'supported' ? supportedReasoningLevels(model.reasoning).join(', ') : 'Default only (explicit reasoning unverified or unsupported)'}</p>
                          {connection.id === 'chatgpt-plan' && <p className="text-gray-600 dark:text-gray-300">Registry metadata is informational; SIWC execution has not been live-qualified. PCC inference remains blocked by the current subscription budget policy.</p>}
                          <details className="mt-2">
                            <summary className="cursor-pointer font-medium">Capability evidence · policy {model.capabilityPolicyVersion}</summary>
                            <ul className="mt-1 space-y-1">
                              {([
                                ['Account availability', model.availability], ['Text generation', model.textGeneration],
                                ['Structured output', model.structuredOutput], ['Context limit', model.contextLimit],
                                ['Output limit', model.outputLimit], ['Reasoning levels', model.reasoning],
                                ...Object.entries(model.operationCapabilities).map(([operation, capability]) => [`Operation ${operation}`, capability] as [string, AiCapabilitySummary]),
                              ] as Array<[string, AiCapabilitySummary]>).map(([label, capability]) => <li key={label} className="break-words">
                                <span className="font-medium">{label}: {capability.state}</span>
                                {capability.state === 'unknown' && capability.reason && <span> · {capability.reason}</span>}
                                {(capability.evidence ?? []).map((proof, index) => <span key={`${proof.reference}-${index}`} className="block text-gray-600 dark:text-gray-300">
                                  {proof.source} · {proof.transport} · {proof.modelSlug} · checked {proof.checkedAt} · <a className="underline" href={proof.reference} target="_blank" rel="noreferrer">evidence</a>
                                </span>)}
                              </li>)}
                            </ul>
                          </details>
                        </li>
                      ))}
                    </ul>
                  )}
              </details>

              {connection.id === 'gemini-personal' && status.localPersonalConnectionsAvailable && <div className="mt-3 space-y-2 border-t border-gray-200 pt-3 dark:border-gray-700">
                <form onSubmit={saveGeminiKey} className="space-y-2">
                  <label htmlFor="gemini-api-key" className="block text-sm font-medium text-gray-800 dark:text-gray-100">Gemini API key</label>
                  <input id="gemini-api-key" type="password" autoComplete="new-password" value={apiKey} onChange={event => setApiKey(event.target.value)} className={inputClass} disabled={busy} />
                  <p className="text-xs text-gray-600 dark:text-gray-300">The key is kept in this server session’s memory and cleared when the server restarts. It is never saved in browser storage or on disk.</p>
                  <div className="flex flex-wrap gap-2">
                    <button type="submit" className={buttonClass} disabled={busy || !apiKey.trim()}>Save key</button>
                    <button type="button" className={buttonClass} disabled={busy} onClick={() => void removeGeminiKey()}>Remove key</button>
                  </div>
                </form>
              </div>}

              {connection.id === 'openai-api' && status.localPersonalConnectionsAvailable && <div className="mt-3 space-y-2 border-t border-gray-200 pt-3 dark:border-gray-700">
                <form onSubmit={saveOpenAiApiKey} className="space-y-2">
                  <label htmlFor="openai-api-key" className="block text-sm font-medium text-gray-800 dark:text-gray-100">OpenAI API key</label>
                  <input id="openai-api-key" type="password" autoComplete="new-password" value={openAiApiKey} onChange={event => setOpenAiApiKeyInput(event.target.value)} className={inputClass} disabled={busy} />
                  <p className="text-xs text-gray-600 dark:text-gray-300">This key is held in server memory only and cleared when the server restarts. OpenAI API use is billed separately from a ChatGPT plan. Saving the key does not make a provider request; catalog refresh and AI use require your explicit action.</p>
                  <div className="flex flex-wrap gap-2">
                    <button type="submit" className={buttonClass} disabled={busy || !openAiApiKey.trim()}>Save API key</button>
                    <button type="button" className={buttonClass} disabled={busy} onClick={() => void removeOpenAiApiKey()}>Remove API key</button>
                  </div>
                </form>
              </div>}

              {connection.id === 'chatgpt-plan' && <div className="mt-3 space-y-2 border-t border-gray-200 pt-3 dark:border-gray-700">
                <p className="text-xs text-gray-700 dark:text-gray-200">ChatGPT plan access uses your existing ChatGPT plan and is subject to OpenAI’s plan limits and terms. It is separate from OpenAI API billing; this app does not promise unlimited usage.</p>
                <p className="text-xs text-amber-800 dark:text-amber-200">Models may be listed, but PCC narrative operations are unavailable through this connection until exact input-token preflight and a hard output-token budget are supported.</p>
                {connection.state === 'connected'
                  ? <button type="button" className={buttonClass} disabled={busy} onClick={() => void disconnectChatGpt()}>Disconnect ChatGPT</button>
                  : <button type="button" className={buttonClass} disabled={busy || connection.state === 'unsupported-environment'} onClick={() => void authorizeChatGpt()}>Connect ChatGPT</button>}
              </div>}
            </article>;
          })}
        </section>

        <section aria-labelledby="usage-heading" className="rounded border border-gray-200 p-3 dark:border-gray-700">
          <h3 id="usage-heading" className="text-sm font-semibold text-gray-900 dark:text-gray-100">Usage and quota</h3>
          {status.usage.quota.state === 'known'
            ? <p className="mt-1 text-sm text-gray-700 dark:text-gray-200">Remaining quota: {typeof status.usage.quota.remaining === 'number' ? status.usage.quota.remaining : 'Not reported'}{status.usage.quota.resetsAt ? ` · resets ${new Date(status.usage.quota.resetsAt).toLocaleString()}` : ''}</p>
            : <p className="mt-1 text-sm text-gray-700 dark:text-gray-200">Quota is unknown. Provider limits are not available to this app.</p>}
          <button type="button" className={`${buttonClass} mt-2`} disabled={loading || busy} onClick={() => void refresh()}>Refresh status</button>
        </section>

        {!status.localPersonalConnectionsAvailable && <p className="rounded border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-200">Personal provider connections are unavailable in this environment.</p>}

        <section aria-labelledby="preferences-heading" className="space-y-3 rounded border border-gray-200 p-3 dark:border-gray-700">
          <h3 id="preferences-heading" className="text-sm font-semibold text-gray-900 dark:text-gray-100">Model preferences</h3>
          {preferences && <>
            <div>
              <label htmlFor="default-ai-connection" className="mb-1 block text-sm font-medium text-gray-800 dark:text-gray-100">Default connection</label>
              <select id="default-ai-connection" className={inputClass} value={preferences.defaultConnectionId} disabled={busy} onChange={event => void changeDefaultConnection(event.target.value as AiConnectionId)}>
                {connections.filter(item => item.state !== 'unsupported-environment' && (item.id === 'gemini-managed' || (item.state === 'connected' && item.models.some(isEligibleTextModel)))).map(item => <option key={item.id} value={item.id}>{CONNECTION_LABELS[item.id]}</option>)}
              </select>
            </div>
            <div>
              <label htmlFor="default-ai-model" className="mb-1 block text-sm font-medium text-gray-800 dark:text-gray-100">Default text model</label>
              <select id="default-ai-model" className={inputClass} value={preferences.defaultTextModelId ?? (preferences.defaultConnectionId === 'gemini-managed' ? '__provider_default__' : defaultConnection?.selectedModelId ?? '')} disabled={busy || !defaultCatalogSelectable || (preferences.defaultConnectionId !== 'gemini-managed' && eligibleDefaultModels.length === 0)} onChange={event => void savePreferences({ ...preferences, defaultTextModelId: event.target.value === '__provider_default__' ? undefined : event.target.value, defaultReasoningLevel: 'default' })}>
                {preferences.defaultConnectionId === 'gemini-managed' && <option value="__provider_default__">Gemini provider default</option>}
                {preferences.defaultTextModelId && !eligibleDefaultModels.some(model => model.id === preferences.defaultTextModelId) && <option value={preferences.defaultTextModelId}>Saved model unavailable · refresh or choose again</option>}
                {eligibleDefaultModels.length === 0 && preferences.defaultConnectionId !== 'gemini-managed' && <option value="">No verified PCC operations available</option>}
                {eligibleDefaultModels.map(model => <option key={model.id} value={model.id}>{model.displayName}</option>)}
              </select>
            </div>
            <div>
              <label htmlFor="default-reasoning" className="mb-1 block text-sm font-medium text-gray-800 dark:text-gray-100">Reasoning level</label>
              <select id="default-reasoning" className={inputClass} value={supportedReasoning.includes(preferences.defaultReasoningLevel ?? 'default') ? preferences.defaultReasoningLevel ?? 'default' : 'default'} disabled={busy || !defaultCatalogSelectable} onChange={event => void savePreferences({ ...preferences, defaultReasoningLevel: event.target.value as ReasoningLevel })}>
                {supportedReasoning.map(level => <option key={level} value={level}>{level}</option>)}
              </select>
              {selectedModel?.reasoning.state !== 'supported' && <p className="mt-1 text-xs text-gray-600 dark:text-gray-300">This model’s reasoning controls are unverified; provider default will be used.</p>}
            </div>
            <details className="pt-1">
              <summary className="cursor-pointer text-sm font-medium text-gray-800 dark:text-gray-100">Per-operation connection overrides</summary>
              <div className="mt-2 space-y-2">
                {OPERATIONS.filter(([operation]) => operation !== 'image').map(([operation, label]) => {
                  const override = preferences.operationOverrides?.[operation];
                  const connection = connections.find(item => item.id === override?.connectionId);
                  const operationModels = (connection && isCatalogSelectable(connection.state, catalogPhases[connection.id]) ? connection.models : []).filter(model => model.availability.state === 'supported' &&
                    model.operationCapabilities[operation]?.state === 'supported' && model.operationCapabilities[operation]?.value === true);
                  const chosenModel = operationModels.find(model => model.id === override?.modelId);
                  const reasoningLevels = supportedReasoningLevels(chosenModel?.reasoning);
                  return <div key={operation} className="space-y-2 rounded border border-gray-200 p-2 dark:border-gray-700">
                    <div className="grid grid-cols-1 items-center gap-1 sm:grid-cols-[minmax(0,1fr)_minmax(0,2fr)_auto]">
                      <label htmlFor={`override-${operation}`} className="text-sm text-gray-700 dark:text-gray-200">{label}</label>
                      <select id={`override-${operation}`} className={inputClass} disabled={busy} value={override?.connectionId ?? ''} onChange={event => event.target.value && void changeOverride(operation, event.target.value as AiConnectionId)}>
                        <option value="">Use default</option>
                        {connections.filter(item => item.state !== 'unsupported-environment' && (item.id === 'gemini-managed' || (item.state === 'connected' && item.models.some(model => model.operationCapabilities[operation]?.state === 'supported' && model.operationCapabilities[operation]?.value === true)))).map(item => <option key={item.id} value={item.id}>{CONNECTION_LABELS[item.id]}</option>)}
                      </select>
                      {override && <button type="button" className={buttonClass} disabled={busy} onClick={() => void clearOverride(operation)}>Use default</button>}
                    </div>
                    {override && <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                      <div>
                        <label htmlFor={`override-model-${operation}`} className="mb-1 block text-xs font-medium">Model for {label.toLowerCase()}</label>
                        <select id={`override-model-${operation}`} className={inputClass} disabled={busy || operationModels.length === 0} value={override.modelId ?? ''} onChange={event => void selectOverrideModel(operation, event.target.value)}>
                          {override.modelId && !operationModels.some(model => model.id === override.modelId) && <option value={override.modelId}>Saved model unavailable · refresh or choose again</option>}
                          {operationModels.length === 0 && <option value="">No verified model available</option>}
                          {operationModels.map(model => <option key={model.id} value={model.id}>{model.displayName} · {model.id}</option>)}
                        </select>
                      </div>
                      <div>
                        <label htmlFor={`override-reasoning-${operation}`} className="mb-1 block text-xs font-medium">Reasoning for {label.toLowerCase()}</label>
                        <select id={`override-reasoning-${operation}`} className={inputClass} disabled={busy || !chosenModel} value={reasoningLevels.includes(override.reasoningLevel ?? 'default') ? override.reasoningLevel ?? 'default' : 'default'} onChange={event => void selectOverrideReasoning(operation, event.target.value as ReasoningLevel)}>
                          {reasoningLevels.map(level => <option key={level} value={level}>{level}</option>)}
                        </select>
                        {chosenModel?.reasoning.state !== 'supported' && <p className="mt-1 text-xs text-gray-600 dark:text-gray-300">Explicit reasoning is unverified for this exact model; Default only.</p>}
                      </div>
                    </div>}
                  </div>;
                })}
                <p className="text-xs text-gray-600 dark:text-gray-300">Image generation currently requires Gemini Managed. It will not switch billing paths automatically when another connection is selected.</p>
                {preferences.operationOverrides?.image && <div className="flex flex-wrap items-center gap-2 text-xs text-amber-800 dark:text-amber-200">
                  <span>The saved image override is not qualified and will not be used.</span>
                  <button type="button" className={buttonClass} disabled={busy} onClick={() => void clearOverride('image')}>Remove image override</button>
                </div>}
              </div>
            </details>
          </>}
          <p className="text-xs text-gray-600 dark:text-gray-300">Models are available only when listed by the selected account. Advanced capabilities are enabled only when supported by documented evidence.</p>
        </section>

      </>}
    </section>
  );
}
