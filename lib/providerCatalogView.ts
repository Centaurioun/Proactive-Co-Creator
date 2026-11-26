/** The inspected catalog never changes the active connection's model options. */
export function modelsForConnection<M>(connections: readonly { id: string; models: M[] }[], connectionId?: string): M[] {
  return connections.find(connection => connection.id === connectionId)?.models ?? [];
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
