/** The inspected catalog never changes the active connection's model options. */
export function modelsForConnection<M>(connections: readonly { id: string; models: M[] }[], connectionId?: string): M[] {
  return connections.find(connection => connection.id === connectionId)?.models ?? [];
}

export type CatalogRefreshPhase = 'loading' | 'fresh' | 'failed' | 'stale';

export function isCatalogSelectable(connectionState: string, refreshPhase?: CatalogRefreshPhase): boolean {
  return ['available', 'connected'].includes(connectionState) && refreshPhase !== 'failed' && refreshPhase !== 'loading' && refreshPhase !== 'stale';
}

/** Account catalog display state stays separate from routing eligibility. */
export function catalogStateLabel(connectionState: string, modelCount: number, refreshPhase?: CatalogRefreshPhase): string {
  if (connectionState !== 'available' && connectionState !== 'connected') {
    return `connection ${connectionState}; catalog unavailable`;
  }
  if (refreshPhase === 'loading') return 'refreshing';
  if (refreshPhase === 'failed') return modelCount > 0 ? 'refresh failed; showing stale cached entries' : 'refresh failed; no cached entries';
  if (refreshPhase === 'fresh') return modelCount > 0 ? 'refreshed' : 'refreshed; empty catalog';
  if (refreshPhase === 'stale') return modelCount > 0 ? 'stale cached entries; refresh to verify' : 'status refreshed; model catalog not verified';
  return modelCount > 0 ? 'cached; refresh to verify current availability' : 'not yet refreshed';
}

interface EligibilityDescriptor {
  availability: { state: string };
  textGeneration: { state: string };
  operationCapabilities: Record<string, { state: string; value?: unknown }>;
}

export function isEligibleTextModel(model: EligibilityDescriptor): boolean {
  return model.availability.state === 'supported' && model.textGeneration.state === 'supported' &&
    Object.values(model.operationCapabilities).some(capability => capability.state === 'supported' && capability.value === true);
}

/** A saved preference needs verified text capability, not an enabled operation. */
export function isSelectableTextPreferenceModel(model: Pick<EligibilityDescriptor, 'availability' | 'textGeneration'>): boolean {
  return model.availability.state === 'supported' && model.textGeneration.state === 'supported';
}
