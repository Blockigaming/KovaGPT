import { useEffect, useState } from "react";
import { ChevronDown, Check, Lock } from "lucide-react";
import { Link } from "@tanstack/react-router";
import { MODES, type ModeId, type Tier } from "@/lib/modes";
import { useLayout } from "@/hooks/use-mobile";
import { ModelSelector } from "@/components/ModelSelector";
import { MobileBottomSheet } from "@/components/MobileBottomSheet";
import { KOVA_VERSIONS, getKovaVersion, setKovaVersion, type KovaVersion } from "@/lib/kova-version";

const TIER_RANK: Record<Tier, number> = { free: 0, plus: 1, pro: 2 };

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
}: {
  mode: ModeId;
  onChange: (m: ModeId) => void;
  userTier?: Tier;
  compact?: boolean;
}) {
  const { isDesktop, interaction } = useLayout();
  const useSheet = !isDesktop || interaction === "touch";
  const [open, setOpen] = useState(false);
  const [version, setVersion] = useState<KovaVersion>("3.5");
  useEffect(() => { setVersion(getKovaVersion()); }, []);
  const current = MODES.find((m) => m.id === mode) ?? MODES[0];

  if (!useSheet) {
    return <ModelSelector mode={mode} onChange={onChange} userTier={userTier} compact={compact} />;
  }

  const tierBadge = (t: Tier) => (t === "plus" ? "Plus" : t === "pro" ? "Pro" : null);

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-haspopup="dialog"
        aria-expanded={open}
        data-testid="model-selector-trigger"
        className={`inline-flex items-center gap-1.5 rounded-full bg-accent/70 active:bg-accent transition ${
          compact ? "h-8 px-3.5 text-[13px]" : "h-9 px-4 text-sm"
        }`}
      >
        <span className="text-foreground font-medium leading-none">{current.label}</span>
        <span className="text-muted-foreground leading-none text-[11px]">Kova {version}</span>
        <ChevronDown className="w-4 h-4 text-muted-foreground" />
      </button>
      <MobileBottomSheet open={open} onOpenChange={setOpen} title="Intelligence" ariaLabel="Choose model">
        <div className="flex flex-col gap-1">
          {MODES.map((m) => {
            const locked = TIER_RANK[m.tier] > TIER_RANK[userTier];
            const badge = tierBadge(m.tier);
            const selected = m.id === mode;
            const inner = (
              <div
                className={`w-full text-left px-4 py-3.5 rounded-xl min-h-11 flex items-center gap-3 ${
                  selected ? "bg-accent" : "hover:bg-accent/60 active:bg-accent"
                }`}
              >
                <span className="font-medium text-base flex-1">{m.label}</span>
                {badge && (
                  <span
                    className={`text-[11px] px-2 py-0.5 rounded-full font-semibold ${
                      m.tier === "pro" ? "bg-foreground text-background" : "bg-accent text-foreground"
                    }`}
                  >
                    {badge}
                  </span>
                )}
                {locked && <Lock className="w-4 h-4 text-muted-foreground" aria-label="Locked" />}
                {selected && !locked && <Check className="w-5 h-5 text-foreground" aria-label="Selected" />}
              </div>
            );
            if (locked) {
              return (
                <Link
                  key={m.id}
                  to="/pricing"
                  onClick={() => setOpen(false)}
                  className="block opacity-70 active:opacity-100"
                  aria-disabled="true"
                >
                  {inner}
                </Link>
              );
            }
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
                {inner}
              </button>
            );
          })}
        </div>
        <div className="mt-3 pt-3 border-t border-border">
          <div className="px-1 pb-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">Kova version</div>
          <div className="flex flex-wrap gap-1.5">
            {KOVA_VERSIONS.map((v) => (
              <button
                key={v}
                type="button"
                onClick={() => { setKovaVersion(v); setVersion(v); }}
                className={`text-sm px-3 py-1.5 rounded-full border transition ${
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
