export type ProviderKind = "ai" | "search" | "image" | "voice" | "research";
export type ProviderHealth = "available" | "degraded" | "unavailable";
export type ProviderAdapter<TRequest = unknown, TResponse = unknown> = Readonly<{
  id: string;
  kind: ProviderKind;
  capabilities: readonly string[];
  health: () => Promise<ProviderHealth>;
  execute: (request: TRequest, signal?: AbortSignal) => Promise<TResponse>;
}>;

class ProviderAdapterRegistry {
  private adapters = new Map<string, ProviderAdapter>();
  register<TRequest, TResponse>(adapter: ProviderAdapter<TRequest, TResponse>) {
    const key = `${adapter.kind}:${adapter.id}`;
    if (this.adapters.has(key)) throw new Error(`Provider adapter already registered: ${key}`);
    this.adapters.set(key, adapter as ProviderAdapter);
    return () => this.adapters.delete(key);
  }
  list(kind?: ProviderKind) {
    return [...this.adapters.values()].filter((adapter) => !kind || adapter.kind === kind);
  }
  resolve(kind: ProviderKind, capability: string) {
    return this.list(kind).find((adapter) => adapter.capabilities.includes(capability));
  }
}

export const providerAdapters = new ProviderAdapterRegistry();
