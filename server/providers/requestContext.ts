import { AsyncLocalStorage } from 'node:async_hooks';
import type { AiOperation } from '../aiBudget.ts';
import type { AiProviderSelection } from './contracts.ts';

export interface AiProviderRequestContext {
  selection: AiProviderSelection;
  operation: AiOperation;
}

const context = new AsyncLocalStorage<AiProviderRequestContext>();

export function runWithAiProviderContext<T>(value: AiProviderRequestContext, callback: () => T): T {
  return context.run(value, callback);
}

export function getAiProviderRequestContext(): AiProviderRequestContext | undefined {
  return context.getStore();
}
