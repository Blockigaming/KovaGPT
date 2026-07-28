import type { ComponentType } from "react";

export type ExtensionSlot =
  | "navigation"
  | "command"
  | "context-provider"
  | "workspace-card"
  | "toolbar"
  | "composer-tool"
  | "settings-panel"
  | "dashboard-widget";
export type ExtensionContribution = Readonly<{
  id: string;
  extensionId: string;
  slot: ExtensionSlot;
  order?: number;
  component?: ComponentType;
  command?: { label: string; href?: string; keywords?: readonly string[] };
}>;
export type PlatformExtension = Readonly<{
  id: string;
  name: string;
  version: string;
  enabled?: boolean;
  contributions: readonly ExtensionContribution[];
}>;

class ExtensionRegistry {
  private extensions = new Map<string, PlatformExtension>();
  register(extension: PlatformExtension) {
    if (this.extensions.has(extension.id))
      throw new Error(`Extension already registered: ${extension.id}`);
    this.extensions.set(extension.id, Object.freeze(extension));
    return () => this.extensions.delete(extension.id);
  }
  list() {
    return [...this.extensions.values()];
  }
  contributions(slot: ExtensionSlot) {
    return this.list()
      .filter((extension) => extension.enabled !== false)
      .flatMap((extension) => extension.contributions.filter((item) => item.slot === slot))
      .sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
  }
}

export const extensionRegistry = new ExtensionRegistry();
