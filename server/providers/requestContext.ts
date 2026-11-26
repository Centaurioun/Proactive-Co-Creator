import { AsyncLocalStorage } from 'node:async_hooks';
import type { AiOperation } from '../aiBudget.ts';
import type { AiProviderSelection } from './contracts.ts';
import type { NarrativeExtractionRequest } from '../../shared/importSchemas.ts';

export interface AiProviderRequestContext {
  selection: AiProviderSelection;
  operation: AiOperation;
  providerPlanBinding?: NarrativeExtractionRequest['providerPlanBinding'];
}

const context = new AsyncLocalStorage<AiProviderRequestContext>();

export function runWithAiProviderContext<T>(value: AiProviderRequestContext, callback: () => T): T {
  return context.run(value, callback);
}

export function getAiProviderRequestContext(): AiProviderRequestContext | undefined {
  return context.getStore();
}
