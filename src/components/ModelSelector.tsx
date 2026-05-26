import { ChevronDown, Check, Lock } from "lucide-react";
import { useState, useRef, useEffect } from "react";
import { MODES, type ModeId, type Tier } from "@/lib/modes";
import { Link } from "@tanstack/react-router";

const TIER_RANK: Record<Tier, number> = { free: 0, plus: 1, pro: 2 };

export function ModelSelector({
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
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const current = MODES.find((m) => m.id === mode) ?? MODES[0];

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  const tierBadge = (t: Tier) => {
    if (t === "plus") return "Plus";
    if (t === "pro") return "Pro";
    return null;
  };

  return (
    <div className="relative" ref={ref}>
      <button
        onClick={() => setOpen((v) => !v)}
        className={`flex items-center gap-1.5 rounded-lg hover:bg-accent transition ${
          compact ? "px-2.5 py-1 text-xs" : "px-3 py-1.5 text-sm font-medium"
        }`}
      >
        <span className="text-muted-foreground">Mode:</span>
        <span className="text-foreground">{current.label}</span>
        <ChevronDown className="w-3.5 h-3.5 text-muted-foreground" />
      </button>
      {open && (
        <div className="absolute bottom-full mb-2 left-0 w-80 rounded-xl border border-border bg-popover shadow-xl z-50 p-1 max-h-[60vh] overflow-y-auto">
          {MODES.map((m) => {
            const locked = TIER_RANK[m.tier] > TIER_RANK[userTier];
            const badge = tierBadge(m.tier);
            const inner = (
              <div className="w-full text-left px-3 py-2.5 rounded-lg hover:bg-accent transition flex items-start gap-2">
                <div className="flex-1 min-w-0">
                  <div className="font-medium text-sm flex items-center gap-1.5">
                    {m.label}
                    {badge && (
                      <span
                        className={`text-[10px] px-1.5 py-0.5 rounded-full font-semibold ${
                          m.tier === "pro"
                            ? "bg-foreground text-background"
                            : "bg-accent text-foreground"
                        }`}
                      >
                        {badge}
                      </span>
                    )}
                    {locked && <Lock className="w-3 h-3 text-muted-foreground ml-auto" />}
                  </div>
                  <div className="text-xs text-muted-foreground">{m.description}</div>
                </div>
                {m.id === mode && !locked && <Check className="w-4 h-4 mt-0.5 text-foreground" />}
              </div>
            );
            if (locked) {
              return (
                <Link
                  key={m.id}
                  to="/pricing"
                  onClick={() => setOpen(false)}
                  className="block opacity-70 hover:opacity-100"
                >
                  {inner}
                </Link>
              );
            }
            return (
              <button
                key={m.id}
                onClick={() => {
                  onChange(m.id);
                  setOpen(false);
                }}
                className="w-full"
              >
                {inner}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
