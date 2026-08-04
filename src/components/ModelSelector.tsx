import { ResponsiveModelSelector } from "@/components/ResponsiveModelSelector";

export type ModelSelectorProps = Parameters<typeof ResponsiveModelSelector>[0] & {
  placement?: "composer" | "topbar";
};

/**
 * Single source of truth for model picking. The adaptive implementation handles
 * desktop popovers, mobile bottom sheets, version grouping, and the
 * signed-out lock (guests stay on Instant and never see the picker).
 */
export const ModelSelector = ResponsiveModelSelector;
