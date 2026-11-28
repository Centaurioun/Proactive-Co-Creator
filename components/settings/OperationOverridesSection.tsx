import React from 'react';
import {
  isCatalogSelectable,
  PROVIDER_PREFERENCE_OPERATIONS,
  supportedReasoningLevels,
  type CatalogRefreshPhase,
} from '../../lib/providerCatalogView';
import type { AiOperation } from '../../server/aiBudget';
import type {
  AiConnectionDescriptor,
  AiConnectionId,
  AiModelDescriptor,
  AiReasoningLevel,
  ProviderPreferences,
} from '../../server/providers/contracts';
import { CONNECTION_LABELS, SETTINGS_BUTTON_CLASS, SETTINGS_INPUT_CLASS } from './ConnectionCard';

export interface OperationOverridesSectionProps {
  connections: AiConnectionDescriptor[];
  preferences: ProviderPreferences;
  catalogPhases: Partial<Record<AiConnectionId, CatalogRefreshPhase>>;
  busy: boolean;
  onChangeOverride: (operation: string, connectionId: AiConnectionId) => void;
  onClearOverride: (operation: string) => void;
  onSelectOverrideModel: (operation: string, modelId: string) => void;
  onSelectOverrideReasoning: (operation: string, reasoningLevel: AiReasoningLevel) => void;
}

function isModelEligibleForOverride(
  operation: string,
  _connectionId: AiConnectionId,
  model: AiModelDescriptor,
): boolean {
  const capability = model.operationCapabilities[operation as AiOperation];
  return model.availability.state === 'supported' && capability?.state === 'supported' && capability.value === true;
}

export function OperationOverridesSection({
  connections,
  preferences,
  catalogPhases,
  busy,
  onChangeOverride,
  onClearOverride,
  onSelectOverrideModel,
  onSelectOverrideReasoning,
}: OperationOverridesSectionProps) {
  return (
    <details className="pt-1">
      <summary className="cursor-pointer text-sm font-medium text-gray-800 dark:text-gray-100">Per-operation connection overrides</summary>
      <div className="mt-2 space-y-2">
        {PROVIDER_PREFERENCE_OPERATIONS.filter(([operation]) => operation !== 'image').map(([operation, label]) => {
          const override = preferences.operationOverrides?.[operation];
          const connection = connections.find(item => item.id === override?.connectionId);
          const operationModels = (connection && isCatalogSelectable(connection.state, catalogPhases[connection.id]) ? connection.models : [])
            .filter(model => isModelEligibleForOverride(operation, connection!.id, model));
          const chosenModel = operationModels.find(model => model.id === override?.modelId);
          const reasoningLevels = supportedReasoningLevels(chosenModel?.reasoning);

          return (
            <div key={operation} className="space-y-2 rounded border border-gray-200 p-2 dark:border-gray-700">
              {operation === 'story' && (() => {
                const connectionId = override?.connectionId ?? preferences.defaultConnectionId;
                const modelId = override?.modelId ?? preferences.defaultTextModelId ?? (connectionId === 'gemini-managed' ? 'provider default' : '');
                const reasoning = override?.reasoningLevel ?? preferences.defaultReasoningLevel ?? 'default';
                return (
                  <p className="text-xs text-gray-600 dark:text-gray-300">
                    Effective Story route: {CONNECTION_LABELS[connectionId]} · {modelId || 'model not selected'} · reasoning {reasoning}.{' '}
                    {connectionId === 'chatgpt-plan'
                      ? modelId
                        ? 'Uses your ChatGPT plan with bounded single-flight execution; no provider fallback will occur.'
                        : 'Select a verified ChatGPT account model above; no model substitution or provider fallback will occur.'
                      : 'Availability follows this provider’s configuration; no provider fallback will occur.'}
                  </p>
                );
              })()}
              <div className="grid grid-cols-1 items-center gap-1 sm:grid-cols-[minmax(0,1fr)_minmax(0,2fr)_auto]">
                <label htmlFor={`override-${operation}`} className="text-sm text-gray-700 dark:text-gray-200">{label}</label>
                <select
                  id={`override-${operation}`}
                  className={SETTINGS_INPUT_CLASS}
                  disabled={busy}
                  value={override?.connectionId ?? ''}
                  onChange={event => event.target.value && onChangeOverride(operation, event.target.value as AiConnectionId)}
                >
                  <option value="">Use default</option>
                  {connections.filter(item =>
                    item.state !== 'unsupported-environment' &&
                    (item.id === 'gemini-managed' || (item.state === 'connected' && item.models.some(model =>
                      isModelEligibleForOverride(operation, item.id, model))))).map(item => (
                    <option key={item.id} value={item.id}>{CONNECTION_LABELS[item.id]}</option>
                  ))}
                </select>
                {override && <button type="button" className={SETTINGS_BUTTON_CLASS} disabled={busy} onClick={() => onClearOverride(operation)}>Use default</button>}
              </div>
              {override && (
                <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                  <div>
                    <label htmlFor={`override-model-${operation}`} className="mb-1 block text-xs font-medium">Model for {label.toLowerCase()}</label>
                    <select
                      id={`override-model-${operation}`}
                      className={SETTINGS_INPUT_CLASS}
                      disabled={busy || operationModels.length === 0}
                      value={override.modelId ?? ''}
                      onChange={event => onSelectOverrideModel(operation, event.target.value)}
                    >
                      {override.modelId && !operationModels.some(model => model.id === override.modelId) && (
                        <option value={override.modelId}>Saved model unavailable · refresh or choose again</option>
                      )}
                      {operationModels.length === 0 && <option value="">No verified model available</option>}
                      {operationModels.map(model => <option key={model.id} value={model.id}>{model.displayName} · {model.id}</option>)}
                    </select>
                  </div>
                  <div>
                    <label htmlFor={`override-reasoning-${operation}`} className="mb-1 block text-xs font-medium">Reasoning for {label.toLowerCase()}</label>
                    <select
                      id={`override-reasoning-${operation}`}
                      className={SETTINGS_INPUT_CLASS}
                      disabled={busy || !chosenModel}
                      value={reasoningLevels.includes(override.reasoningLevel ?? 'default') ? override.reasoningLevel ?? 'default' : 'default'}
                      onChange={event => onSelectOverrideReasoning(operation, event.target.value as AiReasoningLevel)}
                    >
                      {reasoningLevels.map(level => <option key={level} value={level}>{level}</option>)}
                    </select>
                    {chosenModel?.reasoning.state !== 'supported' && (
                      <p className="mt-1 text-xs text-gray-600 dark:text-gray-300">Explicit reasoning is unverified for this exact model; Default only.</p>
                    )}
                  </div>
                </div>
              )}
            </div>
          );
        })}
        <p className="text-xs text-gray-600 dark:text-gray-300">Image generation currently requires Gemini Managed. It will not switch billing paths automatically when another connection is selected.</p>
        {preferences.operationOverrides?.image && (
          <div className="flex flex-wrap items-center gap-2 text-xs text-amber-800 dark:text-amber-200">
            <span>The saved image override is not qualified and will not be used.</span>
            <button type="button" className={SETTINGS_BUTTON_CLASS} disabled={busy} onClick={() => onClearOverride('image')}>Remove image override</button>
          </div>
        )}
      </div>
    </details>
  );
}
