import React from 'react';
import {
  isCatalogSelectable,
  isEligibleTextModel,
  isSelectableTextPreferenceModel,
  modelsForConnection,
  supportedReasoningLevels,
  type CatalogRefreshPhase,
} from '../../lib/providerCatalogView';
import type {
  AiConnectionDescriptor,
  AiConnectionId,
  AiReasoningLevel,
  ProviderPreferences,
} from '../../server/providers/contracts';
import { CONNECTION_LABELS, SETTINGS_INPUT_CLASS } from './ConnectionCard';

export interface ModelPreferencesSectionProps {
  connections: AiConnectionDescriptor[];
  preferences: ProviderPreferences;
  catalogPhases: Partial<Record<AiConnectionId, CatalogRefreshPhase>>;
  busy: boolean;
  onChangeDefaultConnection: (connectionId: AiConnectionId) => void;
  onSavePreferences: (next: ProviderPreferences) => void;
  onSaveChatGptModelPreference: (modelId: string) => void;
  onSaveChatGptReasoningPreference: (level: AiReasoningLevel) => void;
}

export function ModelPreferencesSection({
  connections,
  preferences,
  catalogPhases,
  busy,
  onChangeDefaultConnection,
  onSavePreferences,
  onSaveChatGptModelPreference,
  onSaveChatGptReasoningPreference,
}: ModelPreferencesSectionProps) {
  const defaultConnection = connections.find(item => item.id === preferences.defaultConnectionId);
  const modelOptions = modelsForConnection(connections, preferences.defaultConnectionId);
  const currentDefaultCatalog = isCatalogSelectable(defaultConnection?.state ?? '', catalogPhases[preferences.defaultConnectionId]);
  const providerDefaultSelected = preferences.defaultConnectionId === 'gemini-managed' && !preferences.defaultTextModelId;
  const defaultCatalogSelectable = currentDefaultCatalog || providerDefaultSelected;
  const selectedModel = defaultCatalogSelectable
    ? modelOptions.find(model => model.id === (preferences.defaultTextModelId ?? defaultConnection?.selectedModelId))
    : undefined;
  const eligibleDefaultModels = currentDefaultCatalog
    ? modelOptions.filter(model => preferences.defaultConnectionId === 'chatgpt-plan'
      ? isSelectableTextPreferenceModel(model)
      : isEligibleTextModel(model))
    : [];
  const supportedReasoning = supportedReasoningLevels(selectedModel?.reasoning);

  const chatGptConnection = connections.find(item => item.id === 'chatgpt-plan');
  const chatGptCatalogSelectable = isCatalogSelectable(chatGptConnection?.state ?? '', catalogPhases['chatgpt-plan']);
  const chatGptTextModels = (chatGptConnection?.models ?? []).filter(isSelectableTextPreferenceModel);
  const preferredChatGptModelId = preferences.preferredTextModelsByConnection?.['chatgpt-plan'];
  const preferredChatGptModel = chatGptTextModels.find(model => model.id === preferredChatGptModelId);
  const chatGptReasoningLevels = supportedReasoningLevels(preferredChatGptModel?.reasoning);
  const preferredChatGptReasoning = preferences.preferredReasoningLevelsByConnection?.['chatgpt-plan'] ?? 'default';

  const selectableDefaultConnections = connections.filter(item =>
    item.state !== 'unsupported-environment' &&
    (item.id === 'gemini-managed' || (item.state === 'connected' && item.models.some(model =>
      item.id === 'chatgpt-plan' ? isSelectableTextPreferenceModel(model) : isEligibleTextModel(model)))));

  return (
    <>
      <div>
        <label htmlFor="default-ai-connection" className="mb-1 block text-sm font-medium text-gray-800 dark:text-gray-100">Default connection</label>
        <select
          id="default-ai-connection"
          className={SETTINGS_INPUT_CLASS}
          value={preferences.defaultConnectionId}
          disabled={busy}
          onChange={event => onChangeDefaultConnection(event.target.value as AiConnectionId)}
        >
          {selectableDefaultConnections.map(item => <option key={item.id} value={item.id}>{CONNECTION_LABELS[item.id]}</option>)}
        </select>
      </div>
      <div>
        <label htmlFor="default-ai-model" className="mb-1 block text-sm font-medium text-gray-800 dark:text-gray-100">Default text model</label>
        <select
          id="default-ai-model"
          className={SETTINGS_INPUT_CLASS}
          value={preferences.defaultTextModelId ?? (preferences.defaultConnectionId === 'gemini-managed' ? '__provider_default__' : '')}
          disabled={busy || !defaultCatalogSelectable || (preferences.defaultConnectionId !== 'gemini-managed' && eligibleDefaultModels.length === 0)}
          onChange={event => onSavePreferences({
            ...preferences,
            defaultTextModelId: event.target.value === '__provider_default__' || !event.target.value ? undefined : event.target.value,
            defaultReasoningLevel: 'default',
          })}
        >
          {preferences.defaultConnectionId === 'gemini-managed' && <option value="__provider_default__">Gemini provider default</option>}
          {preferences.defaultConnectionId === 'chatgpt-plan' && !preferences.defaultTextModelId && <option value="">Choose a model explicitly</option>}
          {preferences.defaultTextModelId && !eligibleDefaultModels.some(model => model.id === preferences.defaultTextModelId) && (
            <option value={preferences.defaultTextModelId}>Saved model unavailable · refresh or choose again</option>
          )}
          {eligibleDefaultModels.length === 0 && preferences.defaultConnectionId !== 'gemini-managed' && (
            <option value="">{preferences.defaultConnectionId === 'chatgpt-plan' ? 'No verified text models available' : 'No verified PCC operations available'}</option>
          )}
          {eligibleDefaultModels.map(model => <option key={model.id} value={model.id}>{model.displayName}</option>)}
        </select>
      </div>
      <div>
        <label htmlFor="default-reasoning" className="mb-1 block text-sm font-medium text-gray-800 dark:text-gray-100">Reasoning level</label>
        <select
          id="default-reasoning"
          className={SETTINGS_INPUT_CLASS}
          value={supportedReasoning.includes(preferences.defaultReasoningLevel ?? 'default') ? preferences.defaultReasoningLevel ?? 'default' : 'default'}
          disabled={busy || !defaultCatalogSelectable || (preferences.defaultConnectionId === 'chatgpt-plan' && !selectedModel)}
          onChange={event => onSavePreferences({
            ...preferences,
            defaultReasoningLevel: event.target.value ? event.target.value as AiReasoningLevel : 'default',
          })}
        >
          {preferences.defaultConnectionId === 'chatgpt-plan' && preferences.defaultReasoningLevel && !supportedReasoning.includes(preferences.defaultReasoningLevel) && (
            <option value={preferences.defaultReasoningLevel}>Saved reasoning unavailable · choose again</option>
          )}
          {supportedReasoning.map(level => <option key={level} value={level}>{level}</option>)}
        </select>
        {preferences.defaultConnectionId === 'chatgpt-plan' && !preferences.defaultTextModelId && (
          <p className="mt-1 text-xs text-amber-800 dark:text-amber-200">
            ChatGPT is selected as the default connection. Choose an account model explicitly; no model fallback will be applied.
          </p>
        )}
        {selectedModel?.reasoning.state !== 'supported' && (
          <p className="mt-1 text-xs text-gray-600 dark:text-gray-300">This model’s reasoning controls are unverified; provider default will be used.</p>
        )}
      </div>

      <fieldset className="space-y-2 rounded border border-gray-200 p-3 dark:border-gray-700">
        <legend className="px-1 text-sm font-medium text-gray-800 dark:text-gray-100">ChatGPT plan model preference</legend>
        <p className="text-xs text-gray-600 dark:text-gray-300">
          This preference is saved independently of the default provider and does not send a request. Select ChatGPT plan under Default connection or per-operation overrides to route supported text and narrative operations through your ChatGPT plan.
        </p>
        {!chatGptConnection || chatGptConnection.state !== 'connected' ? (
          <p className="text-sm text-gray-700 dark:text-gray-200">Connect ChatGPT to choose a model from your account catalog.</p>
        ) : (
          <>
            <div>
              <label htmlFor="preferred-chatgpt-model" className="mb-1 block text-xs font-medium text-gray-700 dark:text-gray-200">Preferred ChatGPT text model</label>
              <select
                id="preferred-chatgpt-model"
                className={SETTINGS_INPUT_CLASS}
                disabled={busy || !chatGptCatalogSelectable || chatGptTextModels.length === 0}
                value={preferredChatGptModelId ?? ''}
                onChange={event => onSaveChatGptModelPreference(event.target.value)}
              >
                {!preferredChatGptModelId && <option value="">Choose a model from your account catalog</option>}
                {preferredChatGptModelId && !chatGptTextModels.some(model => model.id === preferredChatGptModelId) && (
                  <option value={preferredChatGptModelId}>Saved model unavailable or no longer verified · refresh or choose again</option>
                )}
                {chatGptTextModels.length === 0 && <option value="">No verified text models in the current catalog</option>}
                {chatGptTextModels.map(model => <option key={model.id} value={model.id}>{model.displayName} · {model.id}</option>)}
              </select>
            </div>
            <div>
              <label htmlFor="preferred-chatgpt-reasoning" className="mb-1 block text-xs font-medium text-gray-700 dark:text-gray-200">Preferred reasoning level</label>
              <select
                id="preferred-chatgpt-reasoning"
                className={SETTINGS_INPUT_CLASS}
                disabled={busy || !preferredChatGptModel}
                value={chatGptReasoningLevels.includes(preferredChatGptReasoning) ? preferredChatGptReasoning : 'default'}
                onChange={event => onSaveChatGptReasoningPreference(event.target.value as AiReasoningLevel)}
              >
                {chatGptReasoningLevels.map(level => <option key={level} value={level}>{level}</option>)}
              </select>
            </div>
            <p className="text-xs text-gray-600 dark:text-gray-300">
              Documented reasoning levels are selectable for verified models. ChatGPT plan supports text and structured narrative operations (excluding image generation) with local token estimates, single-attempt execution, and no automatic cross-provider fallback.
            </p>
            <p className="text-xs text-gray-600 dark:text-gray-300">
              Catalog order is preserved. Models without verified text-generation capability are not selectable. Missing or stale saved models are shown without automatic substitution.
            </p>
          </>
        )}
      </fieldset>
    </>
  );
}
