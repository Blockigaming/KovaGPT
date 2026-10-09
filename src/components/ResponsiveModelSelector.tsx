import { useEffect } from "react";
import type { ModeId, Tier } from "@/lib/modes";
import { CORE_LAUNCH_MODE } from "@/lib/core-launch-policy.mjs";
import { NovaLogo } from "@/components/NovaLogo";

/** Models have no accepted serving contract yet. Keep selection inactive for every tier. */
export function ResponsiveModelSelector({
  mode,
  onChange,
}: {
  mode: ModeId;
  onChange: (mode: ModeId) => void;
  userTier?: Tier;
  compact?: boolean;
  placement?: "composer" | "topbar";
}) {
  useEffect(() => {
    if (mode !== CORE_LAUNCH_MODE) onChange(CORE_LAUNCH_MODE);
  }, [mode, onChange]);
  return (
    <span className="kova-model-static inline-flex h-10 min-w-0 select-none items-center gap-2 px-2.5 text-[15px] font-semibold tracking-[-0.015em] text-foreground">
      <NovaLogo decorative className="h-6 w-6" />
      <span className="truncate leading-none">KovaGPT</span>
    </span>
  );
}
