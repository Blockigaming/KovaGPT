import { useEffect, useState } from "react";
import { ChevronDown, Check } from "lucide-react";
import { MODES, modesForTier, type ModeId, type Tier } from "@/lib/modes";
import { useLayout } from "@/hooks/use-mobile";
import { ModelSelector } from "@/components/ModelSelector";
import { MobileBottomSheet } from "@/components/MobileBottomSheet";
import {
  KOVA_VERSIONS,
  getKovaVersion,
  setKovaVersion,
  type KovaVersion,
} from "@/lib/kova-version";

/**
 * Adaptive model selector:
 *  - Desktop (pointer, >=1200): reuses the existing popover ModelSelector.
 *  - Mobile/tablet (touch or <1200): renders a native bottom sheet.
 */
export function ResponsiveModelSelector({
  mode,
  onChange,
  userTier = "free",
  compact = false,
  placement = "composer",
}: {
  mode: ModeId;
  onChange: (m: ModeId) => void;
  userTier?: Tier;
  compact?: boolean;
  placement?: "composer" | "topbar";
}) {
  const { isDesktop, interaction } = useLayout();
  const useSheet = !isDesktop || interaction === "touch";
  const [open, setOpen] = useState(false);
  const [version, setVersion] = useState<KovaVersion>("3.5");
  useEffect(() => {
    setVersion(getKovaVersion());
  }, []);
  const current = MODES.find((m) => m.id === mode) ?? MODES[0];

  if (!useSheet) {
    return (
      <ModelSelector
        mode={mode}
        onChange={onChange}
        userTier={userTier}
        compact={compact}
        placement={placement}
      />
    );
  }

  const topbar = placement === "topbar";

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-haspopup="dialog"
        aria-label={`Choose model: KovaGPT ${version} ${current.label}`}
        aria-expanded={open}
        data-testid="model-selector-trigger"
        className={`kova-model-trigger inline-flex items-center gap-1.5 font-medium transition active:bg-accent ${
          topbar
            ? "h-11 max-w-full rounded-lg bg-transparent px-2 text-[15px]"
            : `rounded-full bg-accent/70 ${
                compact ? "h-8 px-3.5 text-[13px]" : "h-9 px-4 text-sm"
              }`
        }`}
      >
        <span className="truncate text-foreground leading-none">
          {topbar ? "KovaGPT" : `Kova ${version}`}
          <span className="ml-1 text-muted-foreground font-normal">· {current.label}</span>
        </span>
        <ChevronDown className="w-4 h-4 text-muted-foreground" />
      </button>
      <MobileBottomSheet
        open={open}
        onOpenChange={setOpen}
        title="Intelligence"
        ariaLabel="Choose model"
      >
        {version === "3.5" ? (
          <div className="flex flex-col gap-1">
            {modesForTier(userTier).map((m) => {
              const selected = m.id === mode;
              return (
                <button
                  key={m.id}
                  type="button"
                  onClick={() => {
                    onChange(m.id);
                    setOpen(false);
                  }}
                  className="w-full"
                  data-testid={`model-option-${m.id}`}
                >
                  <div
                    className={`flex min-h-11 w-full items-center gap-3 rounded-xl px-4 py-3.5 text-left ${selected ? "bg-accent" : "hover:bg-accent/60 active:bg-accent"}`}
                  >
                    <span className="flex-1 text-base font-medium">{m.label}</span>
                    {selected && <Check className="h-5 w-5" aria-label="Selected" />}
                  </div>
                </button>
              );
            })}
          </div>
        ) : null}
        <div className="mt-3 pt-3 border-t border-border">
          <div className="px-1 pb-2 text-xs font-medium text-muted-foreground">
            KovaGPT version
          </div>
          <div className="flex flex-wrap gap-1.5">
            {KOVA_VERSIONS.map((v) => (
              <button
                key={v}
                type="button"
                onClick={() => {
                  setKovaVersion(v);
                  setVersion(v);
                }}
                className={`text-sm px-3 py-1.5 rounded-lg border transition ${
                  v === version
                    ? "bg-foreground text-background border-foreground"
                    : "bg-transparent text-foreground border-border active:bg-accent"
                }`}
              >
                Kova {v}
              </button>
            ))}
          </div>
        </div>
      </MobileBottomSheet>
    </>
  );
}
