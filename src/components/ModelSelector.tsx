import { ChevronDown, Check, Lock } from "lucide-react";
import { useState, useRef, useEffect } from "react";
import { MODES, type ModeId, type Tier } from "@/lib/modes";
import { Link } from "@tanstack/react-router";
import {
  KOVA_VERSIONS,
  getKovaVersion,
  setKovaVersion,
  type KovaVersion,
} from "@/lib/kova-version";

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
  const [version, setVersion] = useState<KovaVersion>("3.5");
  useEffect(() => {
    setVersion(getKovaVersion());
  }, []);
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
        className={`inline-flex items-center gap-1.5 rounded-full bg-accent/70 hover:bg-accent transition ${
          compact ? "h-8 px-3.5 text-[13px]" : "h-9 px-4 text-sm"
        }`}
      >
        <span className="text-foreground font-medium leading-none tabular-nums">
          Kova {version}
          {version === "3.5" && (
            <span className="text-muted-foreground font-normal"> · {current.label}</span>
          )}
        </span>
        <ChevronDown className="w-4 h-4 text-muted-foreground" />
      </button>
      {open && (
        <div className="absolute bottom-full mb-2 left-0 w-56 rounded-xl border border-border bg-popover shadow-xl z-50 p-1 animate-in fade-in-0 zoom-in-95 slide-in-from-bottom-1 duration-150">
          {version === "3.5" && (
            <>
              <div className="px-3 pt-2 pb-1 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                Intelligence
              </div>
              {MODES.map((m) => {
                const locked = TIER_RANK[m.tier] > TIER_RANK[userTier];
                const badge = tierBadge(m.tier);
                const selected = m.id === mode;
                const inner = (
                  <div
                    className={`w-full text-left px-3 py-2 rounded-lg transition flex items-center gap-2 ${selected ? "bg-accent" : "hover:bg-accent/60"}`}
                  >
                    <span className="font-medium text-sm flex-1">{m.label}</span>
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
                    {locked && <Lock className="w-3 h-3 text-muted-foreground" />}
                    {selected && !locked && <Check className="w-4 h-4 text-foreground" />}
                  </div>
                );
                if (locked) {
                  return (
                    <Link
                      key={m.id}
                      to="/pricing"
                      onClick={() => setOpen(false)}
                      className="block opacity-70 hover:opacity-100 outline-none focus:outline-none focus-visible:ring-0"
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
                    className="w-full outline-none focus:outline-none focus-visible:ring-0"
                  >
                    {inner}
                  </button>
                );
              })}
            </>
          )}
          <div className="mt-1 pt-2 border-t border-border">
            <div className="px-3 pb-1 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
              Kova version
            </div>
            <div className="flex flex-wrap gap-1 px-2 pb-1.5">
              {KOVA_VERSIONS.map((v) => (
                <button
                  key={v}
                  type="button"
                  onClick={() => {
                    setKovaVersion(v);
                    setVersion(v);
                  }}
                  className={`text-[11px] px-2 py-1 rounded-full border transition ${
                    v === version
                      ? "bg-foreground text-background border-foreground"
                      : "bg-transparent text-foreground border-border hover:bg-accent"
                  }`}
                >
                  {v}
                </button>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
