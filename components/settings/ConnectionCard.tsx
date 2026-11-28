import React from 'react';
import {
  catalogStateLabel,
  isEligibleTextModel,
  safeEvidenceHref,
  supportedReasoningLevels,
  type CatalogRefreshPhase,
} from '../../lib/providerCatalogView';
import type {
  AiCapability,
  AiCapabilityEvidence,
  AiConnectionDescriptor,
  AiConnectionId,
  AiConnectionState,
  AiModelDescriptor,
} from '../../server/providers/contracts';

export const CONNECTION_LABELS: Record<AiConnectionId, string> = {
  'gemini-managed': 'Gemini managed',
  'gemini-personal': 'Gemini API key',
  'chatgpt-plan': 'ChatGPT plan',
  'openai-api': 'OpenAI API key',
};

export const SETTINGS_BUTTON_CLASS = 'rounded border border-gray-300 px-3 py-1.5 text-sm font-medium text-gray-800 hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-50 dark:border-gray-600 dark:text-gray-100 dark:hover:bg-gray-800';
export const SETTINGS_INPUT_CLASS = 'w-full rounded border border-gray-300 bg-white px-2.5 py-2 text-sm text-gray-900 dark:border-gray-600 dark:bg-gray-900 dark:text-gray-100';

type AnyCapability = AiCapability<boolean | number | readonly string[]> & { evidence?: AiCapabilityEvidence[] };

function stateLabel(state: AiConnectionState): string {
  return state.replaceAll('-', ' ');
}

function EvidenceLine({ proof }: { proof: AiCapabilityEvidence }) {
  const href = safeEvidenceHref(proof.reference);
  return (
    <span className="block text-gray-600 dark:text-gray-300">
      {proof.source} · {proof.transport} · {proof.modelSlug} · checked {proof.checkedAt} ·{' '}
      {href
        ? <a className="underline" href={href} target="_blank" rel="noreferrer">evidence</a>
        : <span>{proof.reference}</span>}
    </span>
  );
}

function ModelCapabilityList({ model }: { model: AiModelDescriptor }) {
  const entries: Array<[string, AnyCapability]> = [
    ['Account availability', model.availability],
    ['Text generation', model.textGeneration],
    ['Structured output', model.structuredOutput],
    ['Context limit', model.contextLimit],
    ['Output limit', model.outputLimit],
    ['Reasoning levels', model.reasoning],
    ...Object.entries(model.operationCapabilities)
      .filter((entry): entry is [string, AiCapability<boolean>] => entry[1] !== undefined)
      .map(([operation, capability]) => [`Operation ${operation}`, capability] as [string, AnyCapability]),
  ];

  return (
    <details className="mt-2">
      <summary className="cursor-pointer font-medium">Capability evidence · policy {model.capabilityPolicyVersion}</summary>
      <ul className="mt-1 space-y-1">
        {entries.map(([label, capability]) => (
          <li key={label} className="break-words">
            <span className="font-medium">{label}: {capability.state}</span>
            {capability.state === 'unknown' && capability.reason && <span> · {capability.reason}</span>}
            {('evidence' in capability ? capability.evidence ?? [] : []).map((proof, index) => (
              <EvidenceLine key={`${proof.reference}-${index}`} proof={proof} />
            ))}
          </li>
        ))}
      </ul>
    </details>
  );
}

interface SessionKeyFormProps {
  inputId: string;
  label: string;
  value: string;
  onChange: (next: string) => void;
  onSubmit: (event: React.FormEvent<HTMLFormElement>) => void;
  onRemove: () => void;
  saveLabel: string;
  removeLabel: string;
  helpText: string;
  busy: boolean;
}

function SessionKeyForm({
  inputId,
  label,
  value,
  onChange,
  onSubmit,
  onRemove,
  saveLabel,
  removeLabel,
  helpText,
  busy,
}: SessionKeyFormProps) {
  return (
    <div className="mt-3 space-y-2 border-t border-gray-200 pt-3 dark:border-gray-700">
      <form onSubmit={onSubmit} className="space-y-2">
        <label htmlFor={inputId} className="block text-sm font-medium text-gray-800 dark:text-gray-100">{label}</label>
        <input
          id={inputId}
          type="password"
          autoComplete="new-password"
          value={value}
          onChange={event => onChange(event.target.value)}
          className={SETTINGS_INPUT_CLASS}
          disabled={busy}
        />
        <p className="text-xs text-gray-600 dark:text-gray-300">{helpText}</p>
        <div className="flex flex-wrap gap-2">
          <button type="submit" className={SETTINGS_BUTTON_CLASS} disabled={busy || !value.trim()}>{saveLabel}</button>
          <button type="button" className={SETTINGS_BUTTON_CLASS} disabled={busy} onClick={onRemove}>{removeLabel}</button>
        </div>
      </form>
    </div>
  );
}

export interface ConnectionCardProps {
  connection: AiConnectionDescriptor;
  selected: boolean;
  observedCount: number | undefined;
  catalogPhase: CatalogRefreshPhase | undefined;
  localPersonalConnectionsAvailable: boolean;
  loading: boolean;
  busy: boolean;
  geminiKeyInput: string;
  openAiKeyInput: string;
  onGeminiKeyInputChange: (value: string) => void;
  onOpenAiKeyInputChange: (value: string) => void;
  onRefreshModels: (connectionId: AiConnectionId) => void;
  onSaveGeminiKey: (event: React.FormEvent<HTMLFormElement>) => void;
  onRemoveGeminiKey: () => void;
  onSaveOpenAiKey: (event: React.FormEvent<HTMLFormElement>) => void;
  onRemoveOpenAiKey: () => void;
  onAuthorizeChatGpt: () => void;
  onDisconnectChatGpt: () => void;
}

export function ConnectionCard({
  connection,
  selected,
  observedCount,
  catalogPhase,
  localPersonalConnectionsAvailable,
  loading,
  busy,
  geminiKeyInput,
  openAiKeyInput,
  onGeminiKeyInputChange,
  onOpenAiKeyInputChange,
  onRefreshModels,
  onSaveGeminiKey,
  onRemoveGeminiKey,
  onSaveOpenAiKey,
  onRemoveOpenAiKey,
  onAuthorizeChatGpt,
  onDisconnectChatGpt,
}: ConnectionCardProps) {
  const isAvailableOrConnected = ['available', 'connected'].includes(connection.state);
  const catalogLabel = catalogStateLabel(connection.state, connection.models.length, catalogPhase);

  return (
    <article className="rounded border border-gray-200 p-3 dark:border-gray-700">
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
      <p className="mt-2 text-xs text-gray-600 dark:text-gray-300">Observed requests: {typeof observedCount === 'number' ? observedCount : 'Not available'}</p>
      <button
        type="button"
        className={`${SETTINGS_BUTTON_CLASS} mt-2`}
        disabled={loading || busy || !isAvailableOrConnected}
        onClick={() => onRefreshModels(connection.id)}
      >
        Refresh model catalog
      </button>

      <details className="mt-3 space-y-2 rounded border border-gray-200 p-2 dark:border-gray-700">
        <summary className="cursor-pointer text-sm font-medium">Model catalog ({connection.models.length}) · {catalogLabel}</summary>
        {!isAvailableOrConnected && (
          <p className="text-xs text-gray-600 dark:text-gray-300">
            This connection is {stateLabel(connection.state)}. Catalog entries are retained for inspection and cannot be selected until the connection is available.
          </p>
        )}
        {connection.models.length === 0 ? (
          <p className="text-xs text-gray-600 dark:text-gray-300">
            {catalogLabel === 'refreshed; empty catalog' ? 'The latest account catalog is empty.' : 'No models are cached for this connection.'}
          </p>
        ) : (
          <ul aria-label={`${CONNECTION_LABELS[connection.id]} model catalog`} className="max-h-80 space-y-2 overflow-y-auto">
            {connection.models.map(model => (
              <li key={model.id} className="rounded border border-gray-200 p-2 text-xs dark:border-gray-700">
                <p className="break-words text-sm font-medium">{model.displayName}</p>
                <p className="break-all text-gray-600 dark:text-gray-300">{model.id}</p>
                <p>Catalog availability: {model.availability.state}</p>
                <p>Text operation eligibility: {isEligibleTextModel(model) ? 'At least one supported PCC operation' : 'Unavailable for active PCC text routing'}</p>
                <p>Reasoning registry: {model.reasoning.state === 'supported' ? supportedReasoningLevels(model.reasoning).join(', ') : 'Default only (explicit reasoning unverified or unsupported)'}</p>
                {connection.id === 'chatgpt-plan' && (
                  <p className="text-gray-600 dark:text-gray-300">
                    Verified ChatGPT plan models support PCC text and structured narrative operations (single-attempt, local token preflight). Image generation remains Gemini Managed only.
                  </p>
                )}
                <ModelCapabilityList model={model} />
              </li>
            ))}
          </ul>
        )}
      </details>

      {connection.id === 'gemini-personal' && localPersonalConnectionsAvailable && (
        <SessionKeyForm
          inputId="gemini-api-key"
          label="Gemini API key"
          value={geminiKeyInput}
          onChange={onGeminiKeyInputChange}
          onSubmit={onSaveGeminiKey}
          onRemove={onRemoveGeminiKey}
          saveLabel="Save key"
          removeLabel="Remove key"
          helpText="The key is kept in this server session’s memory and cleared when the server restarts. It is never saved in browser storage or on disk."
          busy={busy}
        />
      )}

      {connection.id === 'openai-api' && localPersonalConnectionsAvailable && (
        <SessionKeyForm
          inputId="openai-api-key"
          label="OpenAI API key"
          value={openAiKeyInput}
          onChange={onOpenAiKeyInputChange}
          onSubmit={onSaveOpenAiKey}
          onRemove={onRemoveOpenAiKey}
          saveLabel="Save API key"
          removeLabel="Remove API key"
          helpText="This key is held in server memory only and cleared when the server restarts. OpenAI API use is billed separately from a ChatGPT plan. Saving the key does not make a provider request; catalog refresh and AI use require your explicit action."
          busy={busy}
        />
      )}

      {connection.id === 'chatgpt-plan' && (
        <div className="mt-3 space-y-2 border-t border-gray-200 pt-3 dark:border-gray-700">
          <p className="text-xs text-gray-700 dark:text-gray-200">
            ChatGPT plan access uses your existing ChatGPT plan and is subject to OpenAI’s plan limits and terms. It is separate from OpenAI API billing; this app does not promise unlimited usage.
          </p>
          <p className="text-xs text-gray-600 dark:text-gray-300">
            Verified account models support text and structured narrative operations with documented reasoning levels, no automatic retries, and no cross-provider billing fallback. Image generation remains Gemini Managed only.
          </p>
          {connection.state === 'connected' ? (
            <button type="button" className={SETTINGS_BUTTON_CLASS} disabled={busy} onClick={onDisconnectChatGpt}>Disconnect ChatGPT</button>
          ) : (
            <button type="button" className={SETTINGS_BUTTON_CLASS} disabled={busy || connection.state === 'unsupported-environment'} onClick={onAuthorizeChatGpt}>Connect ChatGPT</button>
          )}
        </div>
      )}
    </article>
  );
}
