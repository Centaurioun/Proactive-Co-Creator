/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { PROVIDER_PREFERENCES_STORAGE_KEY } from '../../services/apiClient';
import type {
  AiConnectionId,
  ProviderHubStatus,
  ProviderPreferences,
} from '../../server/providers/contracts';

const VALID_CONNECTION_IDS = new Set<AiConnectionId>([
  'gemini-managed',
  'gemini-personal',
  'chatgpt-plan',
  'openai-api',
]);

export const PROVIDER_CONNECTION_LABELS: Record<AiConnectionId, string> = {
  'gemini-managed': 'Gemini Managed',
  'gemini-personal': 'Gemini API',
  'chatgpt-plan': 'ChatGPT Plan',
  'openai-api': 'OpenAI API',
};

export interface ProviderStatusPillSummary {
  providerLabel: string;
  modelLabel: string;
  state: 'loading' | 'ready' | 'needs-attention' | 'offline';
  detail: string;
}

export function readStoredProviderPreferences(
  fallback: ProviderPreferences
): ProviderPreferences {
  if (typeof window === 'undefined') return fallback;
  try {
    const raw = window.localStorage.getItem(PROVIDER_PREFERENCES_STORAGE_KEY);
    if (!raw) return fallback;
    const parsed = JSON.parse(raw) as ProviderPreferences;
    if (!parsed || !VALID_CONNECTION_IDS.has(parsed.defaultConnectionId)) {
      return fallback;
    }
    return parsed;
  } catch {
    return fallback;
  }
}

export function summarizeActiveProviderPill(
  status: ProviderHubStatus | null,
  preferences: ProviderPreferences | null,
  loading: boolean,
  error: string | null
): ProviderStatusPillSummary {
  if (loading && !status) {
    return {
      providerLabel: 'AI',
      modelLabel: 'Checking…',
      state: 'loading',
      detail: 'Checking AI provider availability.',
    };
  }
  if (!status) {
    return {
      providerLabel: 'AI Offline',
      modelLabel: 'Unavailable',
      state: 'offline',
      detail: error ?? 'Could not reach local AI provider status.',
    };
  }

  const effectivePrefs = preferences ?? status.preferences;
  const connId = effectivePrefs.defaultConnectionId;
  const connection = status.connections.find((c) => c.id === connId);
  const providerLabel = PROVIDER_CONNECTION_LABELS[connId] ?? connId;

  const isConnected =
    connection?.state === 'connected' || connection?.state === 'available';

  if (!connection || !isConnected) {
    const reason =
      connection?.message ||
      (connection?.state
        ? `${providerLabel} is ${connection.state.replaceAll('-', ' ')}.`
        : 'Selected AI provider is unavailable.');
    return {
      providerLabel,
      modelLabel: 'Setup needed',
      state: 'needs-attention',
      detail: reason,
    };
  }

  const selectedModelId =
    effectivePrefs.defaultTextModelId ??
    (connId === 'chatgpt-plan'
      ? effectivePrefs.preferredTextModelsByConnection?.['chatgpt-plan']
      : undefined) ??
    connection.models[0]?.id;

  const matchedModel = selectedModelId
    ? connection.models.find((m) => m.id === selectedModelId)
    : undefined;
  const modelLabel = matchedModel?.displayName ?? selectedModelId ?? 'Default model';

  const imageNote =
    connId !== 'gemini-managed'
      ? ' Image generation remains Gemini Managed only.'
      : '';

  return {
    providerLabel,
    modelLabel,
    state: 'ready',
    detail: `Active text provider: ${providerLabel} (${modelLabel}).${imageNote}`,
  };
}

export function useProviderHubStatus() {
  const [status, setStatus] = useState<ProviderHubStatus | null>(null);
  const [preferences, setPreferences] = useState<ProviderPreferences | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const generationRef = useRef(0);

  const refresh = useCallback(async () => {
    const gen = ++generationRef.current;
    setLoading(true);
    try {
      const response = await fetch('/api/ai/provider-hub/status');
      if (!response.ok) {
        throw new Error(`Provider status failed (${response.status}).`);
      }
      const next = (await response.json()) as ProviderHubStatus;
      if (gen !== generationRef.current) return;
      setStatus(next);
      setPreferences(readStoredProviderPreferences(next.preferences));
      setError(null);
    } catch (cause) {
      if (gen !== generationRef.current) return;
      setError(
        cause instanceof Error ? cause.message : 'Could not load AI provider status.'
      );
    } finally {
      if (gen === generationRef.current) {
        setLoading(false);
      }
    }
  }, []);

  useEffect(() => {
    void Promise.resolve().then(() => refresh());
    const handleUpdate = () => {
      void refresh();
    };
    const handleStorage = (event: StorageEvent) => {
      if (event.key === PROVIDER_PREFERENCES_STORAGE_KEY) {
        void refresh();
      }
    };
    window.addEventListener('pcc:ai-preferences-changed', handleUpdate);
    window.addEventListener('storage', handleStorage);
    return () => {
      generationRef.current += 1;
      window.removeEventListener('pcc:ai-preferences-changed', handleUpdate);
      window.removeEventListener('storage', handleStorage);
    };
  }, [refresh]);

  const pillSummary = summarizeActiveProviderPill(status, preferences, loading, error);

  return {
    status,
    preferences,
    loading,
    error,
    pillSummary,
    refresh,
  };
}
